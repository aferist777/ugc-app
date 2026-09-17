'use strict';

// Music for the timeline: Suno tracks made through kie.ai, and the small library of the ones kept.
//
//   POST   /api/audio/suno/generate          { style, title, ... } -> { taskId }
//   GET    /api/audio/suno/status/:taskId    pending | success { audioPath } | failed
//   GET    /api/audio/suno/library           { list }
//   POST   /api/audio/suno/library           { id, title, audioPath, style }
//   DELETE /api/audio/suno/library/:id
//
// The addresses keep their /audio/ prefix: Merge's music lane and the Library's music shelf call
// them. Everything else the old routes/audio.js held - voices and voice design, TTS, avatars,
// speech-to-text, sound effects and the Birols pipeline - went with the pages that used it.

const express    = require('express');
const path       = require('path');
const fs         = require('fs');
const axios      = require('axios');
const ffmpegPath = require('ffmpeg-static');
const { writeFileAtomic } = require('../lib/atomic-write');
const { KIE_BASE, MEDIA, TEMP_DIR, DATA_DIR } = require('../lib/config');
const { kieHeaders } = require('../lib/helpers');

const router = express.Router();

// ── Suno music library ────────────────────────────────────────────────────────
const SUNO_LIB_FILE = path.join(DATA_DIR, 'suno-lib.json');
function _loadSunoLib() {
  try { return JSON.parse(fs.readFileSync(SUNO_LIB_FILE, 'utf8')); } catch { return []; }
}
function _saveSunoLib(list) {
  try { writeFileAtomic(SUNO_LIB_FILE, JSON.stringify(list, null, 2)); } catch {}
}

// POST /api/audio/suno/generate
// Body: { style, title, negativeTags, styleWeight, weirdnessConstraint, model, targetDuration }
// targetDuration (sec) is informational — Suno V4/V5 in customMode always generates two
// ~1:30-2:30 variants per request, which the status endpoint concatenates (crossfade) into a
// single 3-5 min track. We log the target to help debugging; downstream concat doesn't gate on it.
// The asking itself, as a function: the server asks again when somebody presses retry in the
// Alerts list, and that has to be the same request.
async function _submitSuno(b) {
  const { style, title, negativeTags, styleWeight, weirdnessConstraint, model = 'V4_5PLUS', targetDuration } = b || {};
  if (!style) throw Object.assign(new Error('a style is needed'), { status: 400 });
  const BG_SUFFIX = ', background music for UGC short video, non-intrusive, subtle energy, no lyrics';
  const fullStyle = (style + BG_SUFFIX).slice(0, 1000);
  if (targetDuration) console.log(`[audio/suno/generate] target ${targetDuration}s — will concat both Suno variants for ~3-5 min coverage`);
  const taskRes = await axios.post(
      `${KIE_BASE}/api/v1/generate`,
      {
        prompt: '',
        customMode: true,
        instrumental: true,
        model,
        style: fullStyle,
        title: (title || 'UGC Background').slice(0, 80),
        negativeTags: negativeTags || 'vocals, lyrics, metal, aggressive, heavy, noise',
        styleWeight:         styleWeight         ?? 0.7,
        weirdnessConstraint: weirdnessConstraint ?? 0.3,
        callBackUrl: 'https://example.com/callback',
      },
      { headers: kieHeaders(), timeout: 30000 }
    );
  const taskId = taskRes.data?.data?.taskId || taskRes.data?.taskId;
  if (!taskId) throw Object.assign(new Error('kie.ai did not answer with a taskId'), { status: 502 });
  return taskId;
}

router.post('/audio/suno/generate', async (req, res) => {
  const b = req.body || {};
  try {
    const taskId = await _submitSuno(b);
    // FROM MERGE: a row in the journal, and the server sees it through and files the track.
    let alertId = '';
    if (b.where) {
      try {
        alertId = JOBS.submitted({
          kind: 'music', what: 'music',
          title: 'Music · ' + String(b.title || b.style || '').replace(/\s+/g, ' ').trim().slice(0, 60),
          where: b.where, engine: String(b.model || 'V4_5PLUS'), taskIds: [taskId],
          job: { type: 'music', params: { request: { ...b, where: null } } },
        }).id;
      } catch (e) { console.warn('[audio/suno/generate] could not write the alert:', e.message); }
    }
    res.json({ success: true, taskId, alertId });
  } catch (err) {
    console.error('[audio/suno/generate]', err.response?.data || err.message);
    res.status(err.status || 502).json({ success: false, error: err.response?.data?.msg || err.message });
  }
});

// Helper: FFmpeg-concatenate two MP3 URLs into a single file with crossfade.
// Suno returns 2 ~1:30-2:30 variants per request (sunoData[0] and sunoData[1]) — we
// download both, then chain them via acrossfade=d=1 for a ~3-5 minute background
// track. The crossfade hides the timbre shift between the two variants.
async function _concatSunoVariants(urlA, urlB, taskId) {
  const tmpA = path.join(TEMP_DIR, `suno_tmp_${taskId}_a.mp3`);
  const tmpB = path.join(TEMP_DIR, `suno_tmp_${taskId}_b.mp3`);
  // NAMED AFTER THE TASK, not the clock: this answer is asked for twice now - by the window that
  // is watching and by the server's runner (lib/gen-jobs.js) - and a name with the time in it
  // made every extra reading another copy of the same track.
  const outName = `suno_${taskId}.mp3`;
  const outPath = path.join(MEDIA.audio, outName);
  if (fs.existsSync(outPath)) return outName;

  const [resA, resB] = await Promise.all([
    axios({ url: urlA, method: 'GET', responseType: 'arraybuffer', timeout: 90000 }),
    axios({ url: urlB, method: 'GET', responseType: 'arraybuffer', timeout: 90000 }),
  ]);
  fs.writeFileSync(tmpA, Buffer.from(resA.data));
  fs.writeFileSync(tmpB, Buffer.from(resB.data));

  await new Promise((resolve, reject) => {
    const { spawn } = require('child_process');
    const args = [
      '-y',
      '-i', tmpA,
      '-i', tmpB,
      '-filter_complex', '[0:a][1:a]acrossfade=d=1:c1=tri:c2=tri[a]',
      '-map', '[a]',
      '-c:a', 'libmp3lame',
      '-b:a', '192k',
      outPath,
    ];
    // ffmpegPath, not the bare name. This line asked the PATH for an ffmpeg and there is
    // none on it here, so every concat since it was written has thrown ENOENT and quietly
    // fallen back to the first variant alone - half the track, with the other half already
    // downloaded and sitting next to it. Everything else in this file uses ffmpeg-static.
    const proc = spawn(ffmpegPath, args, { windowsHide: true });
    let stderr = '';
    proc.stderr.on('data', c => { stderr += c.toString(); });
    proc.on('error', reject);
    proc.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg concat failed (${code}): ${stderr.slice(-300)}`));
    });
  });

  // Clean up temp files (don't await — fire-and-forget)
  fs.unlink(tmpA, () => {});
  fs.unlink(tmpB, () => {});
  return outName;
}

// GET /api/audio/suno/status/:taskId
// WHERE THE ANSWER ABOUT ONE TRACK COMES FROM, whoever is asking: the window that is watching it,
// or the server's own runner (lib/gen-jobs.js) for somebody who has walked away. Downloading and
// joining happen once per task, so both may ask and one file lands.
async function _pollSuno(taskId) {
  const statusRes = await axios.get(
    `${KIE_BASE}/api/v1/generate/record-info`,
    { params: { taskId }, headers: kieHeaders(), timeout: 15000 }
  );
  const data   = statusRes.data?.data;
  const status = data?.status;  // PENDING | TEXT_SUCCESS | FIRST_SUCCESS | SUCCESS | *_FAILED
  const FAILED = ['CREATE_TASK_FAILED', 'GENERATE_AUDIO_FAILED', 'SENSITIVE_WORD_ERROR', 'CALLBACK_EXCEPTION'];

  // Only treat as success once BOTH variants are ready (Suno fills sunoData[0]
  // at FIRST_SUCCESS then sunoData[1] later at SUCCESS). If we concat too early
  // we'd only get one ~2 min track. So gate on SUCCESS specifically.
  if (status === 'SUCCESS') {
    const urlA = data?.response?.sunoData?.[0]?.audioUrl;
    const urlB = data?.response?.sunoData?.[1]?.audioUrl;
    if (!urlA) return { state: 'pending' };
    // If only one variant came back (rare), save it alone — better than failing.
    if (!urlB) {
      const filename = `suno_${taskId}.mp3`;
      const destPath = path.join(MEDIA.audio, filename);
      if (!fs.existsSync(destPath)) {
        const r = await axios({ url: urlA, method: 'GET', responseType: 'arraybuffer', timeout: 90000 });
        fs.writeFileSync(destPath, Buffer.from(r.data));
      }
      return { state: 'success', audioPath: `/media/audio/${filename}`, concatenated: false };
    }
    // Both variants present — concat via crossfade into one 3-5 min track.
    try {
      const outName = await _concatSunoVariants(urlA, urlB, taskId);
      return { state: 'success', audioPath: `/media/audio/${outName}`, concatenated: true };
    } catch (e) {
      console.error('[audio/suno/status] concat failed, falling back to single track:', e.message);
      const filename = `suno_${taskId}.mp3`;
      const destPath = path.join(MEDIA.audio, filename);
      if (!fs.existsSync(destPath)) {
        const r = await axios({ url: urlA, method: 'GET', responseType: 'arraybuffer', timeout: 90000 });
        fs.writeFileSync(destPath, Buffer.from(r.data));
      }
      return { state: 'success', audioPath: `/media/audio/${filename}`, concatenated: false };
    }
  }
  if (FAILED.includes(status)) return { state: 'failed', error: data?.errorMessage || status };
  // FIRST_SUCCESS = first variant ready, second still cooking — keep polling
  return { state: 'pending', stage: status };
}

router.get('/audio/suno/status/:taskId', async (req, res) => {
  const { taskId } = req.params;
  try {
    res.json({ success: true, ...(await _pollSuno(taskId)) });
  } catch (err) {
    console.error('[audio/suno/status]', err.response?.data || err.message);
    res.status(502).json({ success: false, error: err.message });
  }
});

// ── Alerts ──────────────────────────────────────────────────────────────────
// A track asked for in Merge is a row in the journal, and the server sees it through: five
// minutes is long enough to walk away from, and the link Suno hands back does not wait
// (docs/local-app/PLAN.md, "Alerts"). Unlike a clip, a finished track IS filed - the music shelf
// is where it belongs, and there is nothing to choose between.
const JOBS = require('../lib/gen-jobs');

JOBS.register('music', {
  timeoutMs: 30 * 60 * 1000,
  poll: (rec) => _pollSuno(rec.taskIds[0]),
  file: async (rec, out) => {
    const r = ((rec.job || {}).params || {}).request || {};
    const id = 'suno_' + rec.taskIds[0];
    const lib = _loadSunoLib();
    if (!lib.some(x => x && x.id === id)) {
      lib.unshift({
        id, title: String(r.title || 'UGC Background').slice(0, 80), audioPath: out.audioPath,
        style: String(r.style || ''), createdAt: new Date().toISOString(),
      });
      _saveSunoLib(lib);
    }
    return { path: out.audioPath, media: 'audio', title: String(r.title || '') };
  },
  submit: async (request) => ({ taskId: await _submitSuno(request || {}) }),
});


// GET /api/audio/suno/library
router.get('/audio/suno/library', (_req, res) => res.json({ success: true, list: _loadSunoLib() }));

// POST /api/audio/suno/library — save a generated track
router.post('/audio/suno/library', (req, res) => {
  const { id, title, audioPath, style } = req.body;
  if (!id || !audioPath) return res.status(400).json({ success: false, error: 'id and audioPath required' });
  const lib = _loadSunoLib();
  lib.unshift({ id, title: title || 'Untitled', audioPath, style: style || '', createdAt: new Date().toISOString() });
  _saveSunoLib(lib);
  res.json({ success: true });
});

// DELETE /api/audio/suno/library/:id
router.delete('/audio/suno/library/:id', (req, res) => {
  _saveSunoLib(_loadSunoLib().filter(t => t.id !== req.params.id));
  res.json({ success: true });
});

module.exports = router;
