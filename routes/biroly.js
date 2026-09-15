'use strict';

// Server-side persistence for the Biroly tab. Mirrors three localStorage keys
// the browser uses (biroly_cats, biroly_slots_v2, biroly_archive_v1) into a
// single data/biroly.json so the data survives cache wipes, can be backed up,
// and can be transferred between instances via the Import/Export popup.
//
// Sync strategy is identical to data/obrazy.json: the client owns the source
// of truth in localStorage, but a tiny background script periodically pushes
// the current LS state here. On page load the client reads server state first
// and only falls back to its existing LS if the server has nothing.

const express = require('express');
const fs      = require('fs');
const { writeFileAtomic } = require('../lib/atomic-write');
const path    = require('path');
const axios   = require('axios');
const multer  = require('multer');
const router  = express.Router();

const { DATA_DIR, MEDIA } = require('../lib/config');
const VT = require('../lib/video-thumb');
const BIROLY_FILE  = path.join(DATA_DIR, 'biroly.json');

function _load() {
  try { return JSON.parse(fs.readFileSync(BIROLY_FILE, 'utf8')); }
  catch { return { cats: [], slots: {}, archive: [] }; }
}
function _save(state) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  writeFileAtomic(BIROLY_FILE, JSON.stringify(state, null, 2));
}

router.get('/biroly/state', (_req, res) => {
  res.json({ success: true, state: _load() });
});

router.post('/biroly/state', (req, res) => {
  const { cats, slots, archive } = req.body || {};
  if (!Array.isArray(cats) || (slots && typeof slots !== 'object') || !Array.isArray(archive)) {
    return res.status(400).json({ success: false, error: 'cats:array, slots:object, archive:array required' });
  }
  try {
    _save({ cats, slots: slots || {}, archive });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── Uploads tab: bring a local video into the library ───────────────────────
// This used to post to /api/hooks/upload, which went with the hooks feature and
// left the button doing nothing. Its own endpoint now: the file lands in uploads/
// next to every other library clip, and a real thumbnail is made on the way in so
// the shelf never has to load the video itself to show a poster frame.
const UPL_EXTS  = ['.mp4', '.webm', '.mov', '.avi', '.mkv'];
const UPL_MIMES = ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-msvideo', 'video/x-matroska'];
const _upload = multer({
  storage: multer.diskStorage({
    destination: (_q, _f, cb) => { try { fs.mkdirSync(MEDIA.clips, { recursive: true }); } catch (e) {} cb(null, MEDIA.clips); },
    filename: (_q, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, 'upl_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6) + (UPL_EXTS.includes(ext) ? ext : '.mp4'));
    },
  }),
  limits: { fileSize: 512 * 1024 * 1024 },
  fileFilter: (_q, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, UPL_MIMES.includes(file.mimetype) || UPL_EXTS.includes(ext));
  },
});

// ── Thumbnail sweep ─────────────────────────────────────────────────────────
// The media shelf draws 72px cards. Most of the library had no thumbnail (so the
// card loaded the VIDEO to show one frame) or a "thumbnail" that was the full
// 720x1280 frame - 14MB across the shelf. These two endpoints let the page fix
// that on load, incrementally.
//
// The server only MAKES files here; it does not touch data/biroly.json. That store
// is owned by the browser (biroly-server-sync pushes localStorage up every 2s), so
// a server-side write would be overwritten on the next push. The client records
// thumbPath in its own archive and the normal sync carries it up.

// Which of these clips actually need work. Cheap: a stat plus an image header read.
//
// The question is not "does a thumbnail file exist" but "does the CARD have one", and the
// card draws `thumbPath` off the record. Those two disagree far more often than they agree:
// measured on a live library, 211 of 339 records were blank while the file was sitting
// right there, and 4 more pointed at a file that had since gone. Judging by the derived
// path alone called every one of them healthy, which is exactly what an empty grid of
// cards was telling us it was not.
//
// So each item is answered against the RECORD first, and falls into one of three:
//   ok    the record points at a real, small thumbnail - nothing to do
//   link  a good file exists but the record does not point at it - a write, no ffmpeg
//   need  no usable file at all, or the one there is a full frame - a transcode
// `link` is the cheap majority and is what makes the automatic pass on page open safe.
router.post('/media/thumbs/audit', async (req, res) => {
  try {
    const items = Array.isArray((req.body || {}).items) ? req.body.items : [];
    const need = [], link = [], missing = [];
    let ok = 0;
    const usable = async (url) => {
      const abs = url ? VT.localFromUrl(url) : null;
      if (!abs || !fs.existsSync(abs)) return false;
      const w = await VT.imageWidth(abs);
      return w > 0 && w <= VT.MAX_OK_W;          // a full frame is not a thumbnail
    };
    for (const it of items) {
      const video = String((it && it.video) || '');
      if (!video) continue;
      const abs = VT.localFromUrl(video);
      if (!abs || !fs.existsSync(abs)) { missing.push(it.id); continue; }   // not on this machine
      if (await usable(it && it.thumb)) { ok++; continue; }
      const derived = VT.thumbUrlFor(video);
      if (await usable(derived)) link.push({ id: it.id, thumb: derived });
      else need.push({ id: it.id, video });
    }
    res.json({ success: true, need, link, ok, missing, total: items.length });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// One clip, one thumbnail. Driven one at a time by the page so a sweep of the whole
// library cannot saturate a 4-vCPU box while a render is running.
router.post('/media/thumb', async (req, res) => {
  try {
    const video = String((req.body || {}).video || '');
    if (!video) return res.status(400).json({ success: false, error: 'video required' });
    const abs = VT.localFromUrl(video);
    if (!abs || !fs.existsSync(abs)) return res.status(404).json({ success: false, error: 'video not on disk' });
    const r = await VT.makeThumb(video);
    res.json({ success: true, thumbPath: r.thumb, width: r.w, bytes: r.bytes });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/biroly/upload', _upload.single('video'), async (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, error: 'no file' });
  const videoPath = '/media/clips/' + req.file.filename;
  const raw = String((req.body || {}).name || '').trim();
  const name = raw.replace(/[^\wа-яА-ЯёЁ\- .]/g, '').trim()
    || path.basename(req.file.filename, path.extname(req.file.filename));
  // A failed thumbnail is not a failed upload: the clip is already on disk, and the
  // sweep will pick it up on the next page load.
  let thumbPath = null;
  try { thumbPath = (await VT.makeThumb(videoPath)).thumb; }
  catch (e) { console.warn('[biroly/upload] thumb failed:', e.message); }
  // The Merge preview's proxy, queued now so the clip plays smoothly the first time it is
  // dropped on a lane.
  try { require('./ffmpeg').warmProxies([videoPath], 480); } catch (e) {}
  res.json({ success: true, name, videoPath, thumbPath });
});
router.use('/biroly/upload', (err, _req, res, _next) => {
  res.status(400).json({ success: false, error: (err && err.message) || 'upload failed' });
});

// ════════════════════════════════════════════════════════════════════════════
//  SERVER-SIDE BIROL GENERATION WORKER
//  Generate -> the server runs the whole pipeline (prompt -> image -> upload ->
//  video, or t2v direct) to completion in the BACKGROUND, reusing the existing
//  /api endpoints over internal HTTP. Each stage's taskId is persisted, so:
//   - the client can leave any tab; generation keeps going server-side;
//   - a server restart RESUMES from the last checkpoint (polls the saved taskId,
//     never re-submits an already-running stage);
//   - the client just polls status from any page and toasts on completion.
// ════════════════════════════════════════════════════════════════════════════
const GEN_JOBS_FILE = path.join(DATA_DIR, 'biroly-gen-jobs.json');
let _genJobs = {};
try { _genJobs = JSON.parse(fs.readFileSync(GEN_JOBS_FILE, 'utf8')) || {}; } catch { _genJobs = {}; }
function _saveGenJobs() {
  try { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); writeFileAtomic(GEN_JOBS_FILE, JSON.stringify(_genJobs)); } catch {}
}
function _patchJob(jobId, patch) { const j = _genJobs[jobId]; if (!j) return j; Object.assign(j, patch); _saveGenJobs(); return j; }

const _SELF  = () => `http://127.0.0.1:${process.env.PORT || 3000}`;
const _sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function _api(method, pathname, body) {
  const r = await axios({ method, url: _SELF() + pathname, data: body, timeout: 120000, validateStatus: () => true });
  return r.data;
}
async function _pollStatus(statusPath, { maxMs = 360000, intervalMs = 4000 } = {}) {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    await _sleep(intervalMs);
    let d; try { d = await _api('get', statusPath); } catch { continue; }
    if (d && d.state === 'success') return d;
    if (d && d.state === 'failed')  throw new Error(d.error || 'task failed');
  }
  throw new Error('Timed out (6 min)');
}
function _vidStatusPath(eng, taskId, flow) {
  if (eng === 'prunaai/p-video') return `/api/video/p-video/status/${encodeURIComponent(taskId)}`;
  if (flow === 't2v')            return `/api/video/grok-text/status/${encodeURIComponent(taskId)}`;
  return `/api/video/grok/status/${encodeURIComponent(taskId)}`;
}

// Image stage: resume the saved taskId if present (no re-submit), else submit
// the selected engine with a Seedream fallback.
async function _imageStage(jobId) {
  const job = _genJobs[jobId], p = job.params;
  if (job.imagePath) return;
  _patchJob(jobId, { stage: 'image' });
  if (job.imageTaskId) {
    const r = await _pollStatus(`/api/status/${encodeURIComponent(job.imageTaskId)}`);
    _patchJob(jobId, { imagePath: r.imagePath, thumbPath: r.thumbPath || null });
    return;
  }
  const engines = [p.imageEngine || 'seedream'];
  if ((p.imageEngine || 'seedream') !== 'seedream') engines.push('seedream');
  let lastErr;
  for (const eng of engines) {
    try {
      const sub = await _api('post', '/api/biroly/gen-image', { prompt: job.frame1Prompt, imageEngine: eng, engineParams: p.imageEngineParams || {} });
      if (!sub || !sub.success || !sub.taskId) throw new Error((sub && sub.error) || 'gen-image failed');
      _patchJob(jobId, { imageTaskId: sub.taskId });
      const r = await _pollStatus(`/api/status/${encodeURIComponent(sub.taskId)}`);
      _patchJob(jobId, { imagePath: r.imagePath, thumbPath: r.thumbPath || null });
      return;
    } catch (e) { lastErr = e; _patchJob(jobId, { imageTaskId: null }); }
  }
  throw lastErr || new Error('image generation failed');
}

// Video stage: resume the saved taskId if present (no re-submit), else submit.
async function _videoStage(jobId, imageUrl) {
  const job = _genJobs[jobId], p = job.params;
  if (job.videoPath) return;
  _patchJob(jobId, { stage: 'video' });
  const vEng = p.videoEngine || 'grok';
  const isP  = vEng === 'prunaai/p-video';
  if (!job.videoTaskId) {
    let vr;
    if (p.flow === 't2v') {
      vr = isP
        ? await _api('post', '/api/video/p-video',   { prompt: p.prompt, params: p.pVideoParams || {} })
        : await _api('post', '/api/video/grok-text',  { prompt: p.prompt, duration: p.duration || '6', resolution: p.resolution || '480p', aspectRatio: p.aspectRatio || '9:16', mode: p.mode || 'normal' });
    } else {
      vr = isP
        ? await _api('post', '/api/video/p-video', { prompt: p.prompt, imageUrl, params: p.pVideoParams || {} })
        : await _api('post', '/api/video/grok',    { imageUrl, prompt: p.prompt, aspectRatio: p.aspectRatio || '9:16', videoEngine: vEng, duration: p.duration || '6', resolution: p.resolution || '480p', mode: p.mode || 'normal' });
    }
    if (!vr || !vr.success || !vr.taskId) throw new Error((vr && vr.error) || 'video submit failed');
    _patchJob(jobId, { videoTaskId: vr.taskId });
  }
  const vd = await _pollStatus(_vidStatusPath(vEng, _genJobs[jobId].videoTaskId, p.flow));
  _patchJob(jobId, { videoPath: vd.videoPath });
  // A birol just made: its Merge preview proxy goes into the queue at once.
  try { if (vd.videoPath) require('./ffmpeg').warmProxies([vd.videoPath], 480); } catch (e) {}
}

async function _runGen(jobId) {
  const job = _genJobs[jobId]; if (!job) return;
  const p = job.params || {};
  try {
    if (p.flow === 't2v') {
      await _videoStage(jobId, null);
    } else {
      if (!job.frame1Prompt) {
        _patchJob(jobId, { stage: 'frame-prompt' });
        const r = await _api('post', '/api/biroly/analyze-for-first-frame', { animationPrompt: p.prompt });
        if (!r || !r.success) throw new Error((r && r.error) || 'frame prompt failed');
        _patchJob(jobId, { frame1Prompt: r.framePrompt });
      }
      await _imageStage(jobId);
      const up = await _api('post', '/api/upload-public', { imagePath: _genJobs[jobId].imagePath });
      if (!up || !up.success || !up.url) throw new Error((up && up.error) || 'image upload failed');
      await _videoStage(jobId, up.url);
    }
    _patchJob(jobId, { status: 'done', stage: 'done', finishedAt: Date.now() });
  } catch (e) {
    _patchJob(jobId, { status: 'error', stage: 'error', error: String((e && e.message) || e).slice(0, 300), finishedAt: Date.now() });
  }
}

// POST /api/biroly/generate -> { jobId }. Body carries the gen config (mode,
// flow, prompt, imageEngine, videoEngine, *Params, birolyId, name, duration...).
router.post('/biroly/generate', (req, res) => {
  const jobId = 'bgen_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
  const body  = req.body || {};
  _genJobs[jobId] = {
    jobId, status: 'running', stage: 'start', params: body,
    birolyId: body.birolyId || null, name: body.name || '',
    frame1Prompt: body.frame1Prompt || null, imageTaskId: null, imagePath: body.imagePath || null,
    thumbPath: body.thumbPath || null, videoTaskId: null, videoPath: null,
    createdAt: Date.now(),
  };
  _saveGenJobs();
  res.json({ success: true, jobId });
  _runGen(jobId).catch(e => _patchJob(jobId, { status: 'error', error: String((e && e.message) || e) }));
});

// GET /api/biroly/generate/status/:jobId
router.get('/biroly/generate/status/:jobId', (req, res) => {
  const j = _genJobs[req.params.jobId];
  if (!j) return res.json({ success: false, error: 'job not found' });
  res.json({ success: true, jobId: j.jobId, status: j.status, stage: j.stage,
    imagePath: j.imagePath || null, thumbPath: j.thumbPath || null, videoPath: j.videoPath || null,
    error: j.error || null, birolyId: j.birolyId || null, name: j.name || '' });
});

// GET /api/biroly/generate/active -> running + recently-finished jobs (the
// client poller uses this to apply results + toast on any page).
router.get('/biroly/generate/active', (_req, res) => {
  const cutoff = Date.now() - 6 * 60 * 60 * 1000;
  const jobs = Object.values(_genJobs)
    .filter(j => j.status === 'running' || (j.finishedAt && j.finishedAt > cutoff))
    .map(j => ({ jobId: j.jobId, status: j.status, stage: j.stage, videoPath: j.videoPath || null,
      thumbPath: j.thumbPath || null, imagePath: j.imagePath || null, error: j.error || null,
      birolyId: j.birolyId || null, name: j.name || '' }));
  res.json({ success: true, jobs });
});

// DELETE /api/biroly/generate/:jobId -> cancel / forget (best effort).
router.delete('/biroly/generate/:jobId', (req, res) => {
  const j = _genJobs[req.params.jobId];
  if (j && j.status === 'running') j.status = 'cancelled';
  delete _genJobs[req.params.jobId]; _saveGenJobs();
  res.json({ success: true });
});

// Resume interrupted jobs after a server restart (re-attaches to saved taskIds).
(function _resumeGenJobs() {
  let n = 0;
  for (const jobId of Object.keys(_genJobs)) {
    if (_genJobs[jobId].status === 'running') { n++; setTimeout(() => _runGen(jobId).catch(() => {}), 1500); }
  }
  if (n) console.log(`[biroly-gen] resuming ${n} interrupted generation job(s) after restart`);
})();

module.exports = router;
