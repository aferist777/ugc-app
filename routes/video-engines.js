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
const multer  = require('multer');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const router  = express.Router();

const { UPLOADS_DIR, ROOT_DIR, DATA_DIR } = require('../lib/config');
const { uploadToPublicHost, normalizeVideoForBrowser, noteHostFailure } = require('../lib/helpers');
const { isFetchFailure } = require('../lib/img-providers');
const VT = require('../lib/video-thumb');
const VP = require('../lib/video-providers');
// The same analyst the picture window uses - one ladder, one set of eyes.
const AGENT = require('../lib/mv3-agent');

const KIE_BASE = 'https://api.kie.ai';
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

const _settings = () => { try { return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')); } catch { return {}; } };
const _kieHeaders = () => ({ Authorization: 'Bearer ' + ((_settings().kieApiKey || '').trim()), 'Content-Type': 'application/json' });

// ── A motion reference the user brings in ───────────────────────────────────
//
//   POST /api/video/reference    multipart, field `video`  -> { videoPath, thumbPath, duration, w, h }
//
// Filed on the Uploads shelf as it arrives. It is a clip the user found and will want again -
// the same dance drives any number of pictures - and leaving it as a loose file would mean
// finding it once and losing it.
//
// The models take 3 to 30 seconds and at most 100MB, but the WHOLE file is not what is
// judged here: the window cuts a segment out of it before submitting. So this refuses only
// what can never be used - a file too big to upload at all - and hands back the length so the
// trimmer can hold its handles inside the bounds.
const VID_EXTS  = ['.mp4', '.mov', '.m4v', '.webm'];
const VID_MIMES = ['video/mp4', 'video/quicktime', 'video/x-m4v', 'video/webm'];
const _refUpload = multer({
  storage: multer.diskStorage({
    destination: (_q, _f, cb) => { try { fs.mkdirSync(UPLOADS_DIR, { recursive: true }); } catch (e) {} cb(null, UPLOADS_DIR); },
    filename: (_q, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, 'ref_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6) + (VID_EXTS.includes(ext) ? ext : '.mp4'));
    },
  }),
  limits: { fileSize: 300 * 1024 * 1024 },
  fileFilter: (_q, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, VID_MIMES.includes(file.mimetype) || VID_EXTS.includes(ext));
  },
});

// Length and frame size, straight from ffmpeg's own report on the file. ffprobe is not
// shipped with ffmpeg-static, so this reads what `ffmpeg -i` prints to stderr - the same
// trick _hasAudioStream has used here for years.
function _probe(abs) {
  return new Promise((resolve) => {
    const proc = spawn(ffmpegPath, ['-hide_banner', '-i', abs], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    let out = '';
    proc.stderr.on('data', c => { out += c.toString(); });
    proc.on('close', () => {
      const d = out.match(/Duration:\s*(\d+):(\d+):(\d+\.?\d*)/);
      const wh = out.match(/,\s*(\d{2,5})x(\d{2,5})[\s,]/);
      resolve({
        duration: d ? (+d[1] * 3600 + +d[2] * 60 + parseFloat(d[3])) : 0,
        w: wh ? +wh[1] : 0,
        h: wh ? +wh[2] : 0,
      });
    });
    proc.on('error', () => resolve({ duration: 0, w: 0, h: 0 }));
  });
}

router.post('/video/reference', _refUpload.single('video'), async (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, error: 'no file' });
  const videoPath = '/uploads/' + req.file.filename;
  const abs = path.join(UPLOADS_DIR, req.file.filename);
  try {
    const meta = await _probe(abs);
    if (!(meta.duration > 0)) throw new Error('that file does not look like a video');
    // A poster frame, so the slot never has to load the clip to show something.
    let thumbPath = null;
    try { thumbPath = (await VT.makeThumb(videoPath)).thumb; }
    catch (e) { console.warn('[video/reference] thumb failed:', e.message); }

    // Onto the Uploads shelf. Same two-step every video upload takes: the record store is
    // browser-owned, so the server writes it through this endpoint and hands back lsKey for
    // the page to patch its local copy - see routes/library.js.
    let item = null, lsKey = null;
    try {
      const filed = await axios.post('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/library/media/record', {
        videoPath, thumbPath, kind: 'uploads',
        name: String(req.file.originalname || 'motion reference').replace(/\.[^.]+$/, '').slice(0, 90),
      }, { timeout: 15000 });
      item = filed.data && filed.data.item;
      lsKey = filed.data && filed.data.lsKey;
    } catch (e) {
      // Filing is a convenience; the clip is on disk and usable either way.
      console.warn('[video/reference] could not file it on the shelf:', e.response?.data?.error || e.message);
    }

    res.json({ success: true, videoPath, thumbPath, duration: meta.duration, w: meta.w, h: meta.h, item, lsKey });
  } catch (e) {
    try { fs.unlinkSync(abs); } catch (e2) {}
    res.status(400).json({ success: false, error: e.message });
  }
});

router.use('/video/reference', (err, _req, res, _next) => {
  res.status(400).json({ success: false, error: (err && err.message) || 'upload failed' });
});

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

// Cut [in, out] out of the reference and hand back a public URL for it. Re-encoded rather
// than stream-copied: a copy starts at the nearest keyframe before the in-point, which for a
// motion reference means the movement begins somewhere other than where it was chosen.
async function _clipUrl(webPath, inS, outS) {
  const clean = String(webPath).replace(/^\/+/, '');
  const src = path.join(ROOT_DIR, clean);
  if (!fs.existsSync(src)) throw new Error('the reference clip is not on disk any more');
  const a = Math.max(0, Number(inS) || 0);
  const b = Number(outS) || 0;
  const dur = b > a ? (b - a) : 0;
  if (!(dur > 0)) throw new Error('choose a segment of the reference clip first');

  const out = path.join(UPLOADS_DIR, 'refcut_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6) + '.mp4');
  await new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, [
      '-hide_banner', '-loglevel', 'error',
      '-ss', a.toFixed(3), '-t', dur.toFixed(3), '-i', src,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', '-y', out,
    ], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    let err = '';
    proc.stderr.on('data', c => { err += c.toString(); });
    proc.on('close', code => code === 0 ? resolve() : reject(new Error('could not cut the reference: ' + err.slice(-200))));
    proc.on('error', reject);
  });
  // verify: a paid job dies ten seconds after being charged if the renderer cannot read this,
  // so it is worth one round trip to read it back first.
  return await uploadToPublicHost(fs.readFileSync(out), {
    forceFresh: true, ext: 'mp4', verify: true,
  });
}

// WHERE EACH JOB'S INPUTS WERE PUT. A container that cannot read them fails a third of a
// second after starting and says only "Connection aborted" - which host it could not reach is
// not in the error, and without it there is nothing to set aside. Small and in memory: it is
// only needed between a submit and its first failed poll.
const _hosted = new Map();
const _remember = (taskId, urls) => {
  _hosted.set(taskId, urls.filter(Boolean));
  if (_hosted.size > 200) _hosted.delete(_hosted.keys().next().value);
};

/* ── The analyst, before anything is spent ───────────────────────────────────
   POST /api/video/think { text, imagePath } -> { prompt, writer } | { prompt, fell }

   The picture and the sentence go to the same analyst the picture window uses, and it writes
   the motion prompt: English, because these models read English, and about what CHANGES rather
   than about what is in the frame - the frame is the picture, and re-describing it is how a
   video model ends up redrawing the face instead of moving it.

   Its own call rather than something folded into the submit, because the two fail separately
   and the window has to be able to say WHICH: an analyst that could not be reached is a video
   made from the words as typed, and a model that refused is no video at all.

   A failure here is answered with the words as typed and `fell` saying why. Nothing about
   polishing is worth losing the job over. */
router.post('/video/think', async (req, res) => {
  const b = req.body || {};
  try {
    const text = String(b.text || '').trim();
    if (!text) return res.status(400).json({ success: false, error: 'nothing was said' });
    let imageUrl = '';
    try { imageUrl = b.imagePath ? await _publicUrl(b.imagePath) : ''; }
    catch (err) { console.warn('[video/think] could not host the picture -', err.message); }
    const out = await AGENT.thinkMotion({ text, imageUrl });
    res.json({ success: true, ...out });
  } catch (err) {
    res.status(502).json({ success: false, error: String(err.message || err).slice(0, 300) });
  }
});

router.post('/video/animate', async (req, res) => {
  const { engine, provider, prompt, imagePath, imageUrl: direct,
          videoPath, videoIn, videoOut, params = {} } = req.body || {};
  try {
    const imageUrl = direct || await _publicUrl(imagePath);
    // The motion reference, cut to the chosen segment first. The models take 3-30s and the
    // whole file is usually longer, so what goes out is the piece rather than the source -
    // and it is what the price was quoted on.
    let videoUrl = null;
    if (videoPath) videoUrl = await _clipUrl(videoPath, videoIn, videoOut);
    const out = await VP.submitVideo({ engine, provider, prompt, imageUrl, videoUrl, params });
    _remember(out.taskId, [imageUrl, videoUrl]);
    console.log('[video/animate]', out.engine, 'via', out.provider,
      (out.duration == null ? 'clip-length' : out.duration + 's'), '->', out.taskId);
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
        const why = String(pred?.error || pred?.status);
        // A failure to READ the inputs is not a failure of the model, and the fix is a
        // different host rather than a different prompt. The hosts we used are set aside for
        // ten minutes, so pressing Animate again picks somewhere else by itself - that is the
        // same rescue the image path has had since Replicate first refused to read imgbb.
        //
        // Not resubmitted here on its own: a retry is a charge, and a charge is the user's to
        // make. What this does is make the next press land somewhere that can be read.
        if (isFetchFailure({ message: why })) {
          const set = (_hosted.get(taskId) || []).map(u => noteHostFailure(u)).filter(Boolean);
          _hosted.delete(taskId);
          return res.json({ success: true, state: 'failed',
            error: 'the model could not download the files we gave it'
              + (set.length ? ' from ' + [...new Set(set)].join(' / ') : '')
              + '. Press Animate again - they will be put somewhere else.' });
        }
        return res.json({ success: true, state: 'failed', error: why });
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
