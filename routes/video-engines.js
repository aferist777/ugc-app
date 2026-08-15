'use strict';

// ════════════════════════════════════════════════════════════════════════════
// ANIMATING A PICTURE — one door, whichever engine and aggregator is chosen.
//
//   GET  /api/video/engines?dir=i2v          the matrix, for the pickers
//   POST /api/video/animate                  -> { taskId, engine, provider }
//   GET  /api/video/animate/status/:taskId   -> pending | success + videoPath
//
// The existing video routes are one pair per engine: /api/video/p-video with its own status
// endpoint, /api/video/grok with another. That was workable while the page knew which engine
// it wanted before it was written. A picker does not: the caller now chooses at press time,
// and having it also choose which URL to poll would put the matrix in two places.
//
// So the status route reads the taskId's own prefix instead. 'repl:' is a Replicate
// prediction, anything else is a kie job - which is exactly the rule resolveTask has used
// since long before any of this, and it means the client polls one URL forever.
// ════════════════════════════════════════════════════════════════════════════

const express = require('express');
const fs      = require('fs');
const path    = require('path');
const axios   = require('axios');
const router  = express.Router();

const { UPLOADS_DIR, ROOT_DIR, DATA_DIR } = require('../lib/config');
const { uploadToPublicHost, normalizeVideoForBrowser } = require('../lib/helpers');
const VP = require('../lib/video-providers');

const KIE_BASE = 'https://api.kie.ai';
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

const _settings = () => { try { return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')); } catch { return {}; } };
const _kieHeaders = () => ({ Authorization: 'Bearer ' + ((_settings().kieApiKey || '').trim()), 'Content-Type': 'application/json' });

router.get('/video/engines', (req, res) => {
  const dir = String(req.query.dir || 'i2v');
  try { res.json({ success: true, dir, engines: VP.listVideoEngines(dir) }); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// The picture has to become a URL the renderer can fetch: both aggregators pull the
// reference themselves, and our :3000 is not reachable from either.
async function _publicUrl(imagePath) {
  const clean = String(imagePath || '').split('?')[0].replace(/^\/+/, '');
  const abs = path.join(ROOT_DIR, clean);
  if (!clean || !fs.existsSync(abs)) throw new Error('no such picture: ' + imagePath);
  const ext = (path.extname(abs) || '.png').slice(1).toLowerCase();
  return await uploadToPublicHost(fs.readFileSync(abs), { forceFresh: true, ext });
}

router.post('/video/animate', async (req, res) => {
  const { engine, provider, prompt, imagePath, imageUrl: direct, params = {} } = req.body || {};
  if (!prompt) return res.status(400).json({ success: false, error: 'a prompt is required' });
  try {
    const imageUrl = direct || await _publicUrl(imagePath);
    const out = await VP.submitVideo({ engine, provider, prompt, imageUrl, params });
    console.log('[video/animate]', out.engine, 'via', out.provider, out.duration + 's ->', out.taskId);
    res.json({ success: true, ...out });
  } catch (err) {
    // Replicate hides the useful half in `detail`; kie in `msg`. Surfacing the raw message
    // instead would show "Request failed with status code 422" and nothing about which field.
    const detail = err.response?.data?.detail || err.response?.data?.msg
      || err.response?.data?.title || err.message;
    console.error('[video/animate] ERROR:', JSON.stringify(err.response?.data || err.message).slice(0, 400));
    res.status(502).json({ success: false, error: detail });
  }
});

// Whatever the output shape is, find the URL in it. Replicate returns a string, a list or an
// object depending on the model; kie returns a JSON string in resultJson.
function _extract(out) {
  if (!out) return null;
  if (typeof out === 'string') return out;
  if (Array.isArray(out)) { for (const it of out) { const u = _extract(it); if (u) return u; } return null; }
  if (typeof out === 'object') return out.url || out.video || out.video_url || null;
  return null;
}

// A GENERATION THAT IS NEVER TICKED STAYS ON DISK, ON PURPOSE. The window files only what
// was chosen, so the rest end up here as files with no record - invisible everywhere, because
// every shelf is built from records and the three sweeps that do read this directory
// (biroly/scan-uploads, the orphan pass and refresh-all-thumbs) all filter on grok_*.
//
// Deliberate, not a leak: the clip was paid for, and deleting it because it lost a comparison
// is a decision the app should not make on its own. The `anim_` prefix is what keeps it out of
// the Birols orphan recovery - renaming these would start surfacing rejected takes there.
async function _save(remoteUrl, tag) {
  const filename = `anim_${tag}_${Date.now()}.mp4`;
  const destPath = path.join(UPLOADS_DIR, filename);
  const r = await axios({ url: remoteUrl, method: 'GET', responseType: 'arraybuffer', timeout: 180000 });
  fs.writeFileSync(destPath, Buffer.from(r.data));
  // The concat pipeline cannot decode every profile a model emits; this is the same pass
  // every other generated clip goes through on the way in. Safe here - the file is an mp4,
  // and the normaliser refuses stills.
  try { await normalizeVideoForBrowser(destPath); }
  catch (e) { console.warn('[video/animate] normalize failed:', e.message); }
  return `/uploads/${filename}`;
}

router.get('/video/animate/status/:taskId', async (req, res) => {
  const taskId = String(req.params.taskId || '');
  if (!taskId) return res.status(400).json({ success: false, error: 'taskId required' });
  try {
    // ── Replicate ──
    if (taskId.startsWith('repl:')) {
      const id = taskId.slice(5);
      const key = (_settings().replicateApiKey || '').trim();
      if (!key) return res.json({ success: true, state: 'failed', error: 'Replicate token is not configured' });
      const pred = (await axios.get(`https://api.replicate.com/v1/predictions/${id}`, {
        headers: { Authorization: 'Bearer ' + key }, timeout: 15000,
      })).data;
      if (pred?.status === 'failed' || pred?.status === 'canceled') {
        return res.json({ success: true, state: 'failed', error: pred?.error || pred?.status });
      }
      if (pred?.status !== 'succeeded') return res.json({ success: true, state: 'pending' });
      const url = _extract(pred.output);
      if (!url) return res.json({ success: true, state: 'failed', error: 'the model returned no video' });
      return res.json({ success: true, state: 'success', videoPath: await _save(url, 'repl' + id.slice(-8)) });
    }

    // ── kie.ai ──
    const data = (await axios.get(`${KIE_BASE}/api/v1/jobs/recordInfo`, {
      params: { taskId }, headers: _kieHeaders(), timeout: 15000,
    })).data?.data;
    const state = data?.state;
    if (state === 'fail' || state === 'failed') {
      return res.json({ success: true, state: 'failed', error: data?.failMsg || data?.failCode || 'the model refused it' });
    }
    if (state !== 'success') return res.json({ success: true, state: 'pending' });
    let url = null;
    try {
      const parsed = JSON.parse(data.resultJson);
      url = (parsed.resultUrls && parsed.resultUrls[0]) || parsed.video_url || parsed.url || null;
    } catch (e) {}
    if (!url) return res.json({ success: true, state: 'failed', error: 'the model returned no video' });
    return res.json({ success: true, state: 'success', videoPath: await _save(url, 'kie' + String(taskId).slice(-8)) });
  } catch (err) {
    console.error('[video/animate/status]', err.response?.data || err.message);
    res.status(502).json({ success: false, error: err.message });
  }
});

module.exports = router;
