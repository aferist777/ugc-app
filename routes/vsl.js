'use strict';

// VSL video library — long pre-made videos the user overlays inserts onto in
// Merge's VSL mode. Files live in /vsl (gitignored, like /hooks); metadata the
// browser probes after upload (duration / dimensions) is kept in vsl/_meta.json
// so the picker can show it without re-probing every load.
const express      = require('express');
const path         = require('path');
const fs           = require('fs');
const { execFile, spawn } = require('child_process');
const ffmpegPath   = require('ffmpeg-static');
const multer       = require('multer');
const axios        = require('axios');
const router       = express.Router();

const { VSL_DIR, VSL_THUMBS_DIR, HOOKS_DIR, HOOKS_THUMB_DIR } = require('../lib/config');
const SP            = require('../lib/scenario-prompts');   // per-vertical reference-sources store
const SETTINGS_FILE = path.join(__dirname, '..', 'data', 'settings.json');
function _orKey() { try { const s = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')); return String(s.openRouterApiKey || '').trim(); } catch { return ''; } }

const META_FILE = path.join(VSL_DIR, '_meta.json');
function _readMeta() { try { return JSON.parse(fs.readFileSync(META_FILE, 'utf8')); } catch { return {}; } }
function _writeMeta(m) { fs.writeFileSync(META_FILE, JSON.stringify(m, null, 2), 'utf8'); }

const MAX_FILE_SIZE = 6 * 1024 * 1024 * 1024; // 6 GB — VSLs run up to ~50 min
const ALLOWED_EXTS  = ['.mp4', '.webm', '.mov', '.avi', '.mkv'];
const ALLOWED_MIMES = ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-msvideo', 'video/avi', 'video/x-matroska'];

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, VSL_DIR),
  filename:    (req, file, cb) => {
    const ext     = path.extname(file.originalname).toLowerCase();
    const safeExt = ALLOWED_EXTS.includes(ext) ? ext : '.mp4';
    const ts      = Date.now();
    const rnd     = Math.random().toString(36).slice(2, 6);
    cb(null, `vsl_${ts}_${rnd}${safeExt}`);
  },
});
const upload = multer({
  storage,
  limits:     { fileSize: MAX_FILE_SIZE },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ALLOWED_MIMES.includes(file.mimetype) || ALLOWED_EXTS.includes(ext)) cb(null, true);
    else cb(new Error(`Unsupported format: ${ext}`), false);
  },
});

// Probe duration + pixel dimensions from ffmpeg's -i header (no ffprobe dep).
// Server-side so the timeline never depends on the BROWSER being able to decode
// the raw upload (exotic codecs, or a file still mid-optimize) — see buildModel.
function probeMeta(videoPath) {
  return new Promise(resolve => {
    const proc = spawn(ffmpegPath, ['-hide_banner', '-i', videoPath], { stdio: ['ignore', 'ignore', 'pipe'] });
    let s = '';
    proc.stderr.on('data', c => { s += c.toString(); });
    proc.on('close', () => {
      const dm = s.match(/Duration:\s*(\d+):(\d+):(\d+\.?\d*)/);
      const vm = s.match(/Video:.*?(\d{2,5})x(\d{2,5})/);
      resolve({
        duration: dm ? (+dm[1]) * 3600 + (+dm[2]) * 60 + (+dm[3]) : 0,
        width:  vm ? +vm[1] : 0,
        height: vm ? +vm[2] : 0,
      });
    });
    proc.on('error', () => resolve({ duration: 0, width: 0, height: 0 }));
  });
}

// Extract frame at 0.5 s → JPEG thumbnail (same pattern as hooks)
function extractThumb(videoPath, thumbPath) {
  return new Promise(resolve => {
    const args = ['-ss', '0.5', '-i', videoPath, '-frames:v', '1', '-q:v', '3', '-y', thumbPath];
    execFile(ffmpegPath, args, { timeout: 30000 }, err => {
      resolve(!err && fs.existsSync(thumbPath));
    });
  });
}

// ── Proxy generation (lightweight edit/preview copy) ──────────────────────────
// On upload we keep the ORIGINAL untouched (render + hook extraction read it) and
// build a small ~540p proxy in the background: H.264, low bitrate, faststart, and
// a forced keyframe every second (closed GOP) for smooth scrubbing and precise
// double-click trim points. The browser preview/timeline play the proxy so a
// 50-min VSL never bogs down the editor. Lives at /vsl/proxies/<file>.
const PROXIES_DIR = path.join(VSL_DIR, 'proxies');
const MASTERS_DIR = path.join(VSL_DIR, 'masters');   // full-res dense-keyframe render masters
try { if (!fs.existsSync(PROXIES_DIR)) fs.mkdirSync(PROXIES_DIR, { recursive: true }); } catch {}
try { if (!fs.existsSync(MASTERS_DIR)) fs.mkdirSync(MASTERS_DIR, { recursive: true }); } catch {}

const PROXY_HEIGHT   = 540;      // proxy short side (preview is ~480px tall anyway)
const KEYINT_SECONDS = 1;        // a keyframe every second (scrub + trim precision)
const _proxyQueue = [];          // filenames pending proxy build
let _proxyBusy = false;

function _probeFps(abs) {
  return new Promise(resolve => {
    const proc = spawn(ffmpegPath, ['-hide_banner', '-i', abs], { stdio: ['ignore', 'ignore', 'pipe'] });
    let s = '';
    proc.stderr.on('data', c => { s += c.toString(); });
    proc.on('close', () => { const m = s.match(/([\d.]+)\s*fps/); resolve(m ? Math.round(parseFloat(m[1])) || 30 : 30); });
    proc.on('error', () => resolve(30));
  });
}

function _enqueueProxy(filename) {
  if (!_proxyQueue.includes(filename)) _proxyQueue.push(filename);
  _pumpProxy();
}
function _pumpProxy() {
  if (_proxyBusy) return;
  const filename = _proxyQueue.shift();
  if (!filename) return;
  _proxyBusy = true;
  _makeProxy(filename).catch(e => console.warn('[vsl/proxy]', filename, e.message))
    .finally(() => { _proxyBusy = false; setImmediate(_pumpProxy); });
}

async function _makeProxy(filename) {
  const abs = path.join(VSL_DIR, filename);
  if (!fs.existsSync(abs)) return;
  const meta = _readMeta();
  if (!meta[filename]) meta[filename] = {};
  if (meta[filename].proxyReady && fs.existsSync(path.join(PROXIES_DIR, filename))) return;   // already built
  meta[filename].proxying = true; meta[filename].proxyError = null; _writeMeta(meta);

  const out = path.join(PROXIES_DIR, filename);
  const tmp = path.join(PROXIES_DIR, `_tmp_${filename}`);
  try {
    const fps = await _probeFps(abs);
    const g   = String(Math.max(1, Math.round(fps * KEYINT_SECONDS)));
    const args = [
      '-hide_banner', '-i', abs,
      // Scale the SHORTER side to PROXY_HEIGHT (portrait -> width=H, landscape -> height=H), even dims.
      '-vf', `scale='if(gt(iw,ih),-2,${PROXY_HEIGHT})':'if(gt(iw,ih),${PROXY_HEIGHT},-2)':flags=fast_bilinear`,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26',
      '-profile:v', 'main', '-pix_fmt', 'yuv420p',
      '-g', g, '-keyint_min', g, '-sc_threshold', '0', '-force_key_frames', `expr:gte(t,n_forced*${KEYINT_SECONDS})`,
      '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-ac', '2',
      '-threads', '2',                              // leave CPU for a concurrent render on the 4-vCPU box
      '-movflags', '+faststart', '-y', tmp,
    ];
    console.log(`[vsl/proxy] start ${filename} (fps=${fps}, ${PROXY_HEIGHT}p, keyint=${g})`);
    await new Promise((resolve, reject) => {
      const proc = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
      let err = '';
      proc.stderr.on('data', c => { err = (err + c.toString()).slice(-1000); });
      proc.on('close', code => code === 0 ? resolve() : reject(new Error('proxy failed (' + code + '): ' + err.slice(-200))));
      proc.on('error', reject);
    });
    fs.renameSync(tmp, out);

    const m2 = _readMeta();
    if (!m2[filename]) m2[filename] = {};
    m2[filename].proxying = false;
    m2[filename].proxyReady = true;
    m2[filename].keyint = KEYINT_SECONDS;
    _writeMeta(m2);
    console.log(`[vsl/proxy] done ${filename}`);
  } catch (e) {
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch {}
    const m3 = _readMeta();
    if (m3[filename]) { m3[filename].proxying = false; m3[filename].proxyError = (e.message || 'error').slice(0, 200); _writeMeta(m3); }
    throw e;   // surfaced by the queue pump's logger
  }
}

// ── Render master (lazy, on first export) ─────────────────────────────────────
// A one-time full-res re-encode of the original with a forced keyframe every
// second (near-lossless crf 16, H.264 main/4.0) so the smart-copy renderer can
// stream-copy untouched spans with frame-accurate boundaries and high copy
// ratio. Built on demand with live progress; the original is kept. Once present,
// VSL renders point at /vsl/masters/<file>. Re-encoded insert windows use the
// matching encoder so seams have no visible quality jump.
const _masterJobs = new Map();   // id -> { progress, done, error, master }
function _masterJobId() { return 'mj_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

router.post('/vsl/master', (req, res) => {
  const safe = path.basename(String((req.body && req.body.file) || ''));
  const abs  = path.join(VSL_DIR, safe);
  if (!safe || !fs.existsSync(abs)) return res.status(404).json({ success: false, error: 'VSL not found' });
  const out = path.join(MASTERS_DIR, safe);
  if (fs.existsSync(out)) {                       // already built
    const m = _readMeta(); if (m[safe]) { m[safe].masterReady = true; _writeMeta(m); }
    return res.json({ success: true, ready: true, master: `/vsl/masters/${safe}` });
  }
  const id  = _masterJobId();
  const job = { progress: 0, done: false, error: null, master: null, proc: null };
  _masterJobs.set(id, job);
  res.json({ success: true, jobId: id });

  const tmp = path.join(MASTERS_DIR, `_tmp_${safe}`);
  (async () => {
    let duration = 0;
    try {
      const meta = _readMeta(); duration = (meta[safe] && meta[safe].duration) || (await probeMeta(abs)).duration || 0;
      const fps = await _probeFps(abs);
      const g   = String(Math.max(1, Math.round(fps * KEYINT_SECONDS)));
      const args = [
        '-hide_banner', '-i', abs,
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16',
        '-profile:v', 'main', '-level', '4.0', '-pix_fmt', 'yuv420p',
        '-g', g, '-keyint_min', g, '-sc_threshold', '0', '-force_key_frames', `expr:gte(t,n_forced*${KEYINT_SECONDS})`,
        '-c:a', 'aac', '-b:a', '192k', '-ar', '44100', '-ac', '2',
        '-threads', '3',
        '-progress', 'pipe:1', '-movflags', '+faststart', '-y', tmp,
      ];
      console.log(`[vsl/master] start ${safe} (fps=${fps}, keyint=${g}, dur=${Math.round(duration)}s)`);
      await new Promise((resolve, reject) => {
        const proc = spawn(ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
        job.proc = proc;
        let errTail = '';
        proc.stdout.on('data', c => {
          const mm = c.toString().match(/out_time_us=(\d+)/g);
          if (mm && duration > 0) { const us = parseInt(mm[mm.length - 1].slice(12), 10); job.progress = Math.min(0.99, (us / 1e6) / duration); }
        });
        proc.stderr.on('data', c => { errTail = (errTail + c.toString()).slice(-1000); });
        proc.on('close', code => {
          job.proc = null;
          if (job.killed) return reject(new Error('cancelled'));
          code === 0 ? resolve() : reject(new Error('master failed (' + code + '): ' + errTail.slice(-200)));
        });
        proc.on('error', reject);
      });
      fs.renameSync(tmp, out);
      const m2 = _readMeta(); if (!m2[safe]) m2[safe] = {}; m2[safe].masterReady = true; _writeMeta(m2);
      job.progress = 1; job.master = `/vsl/masters/${safe}`; job.done = true;
      console.log(`[vsl/master] done ${safe}`);
    } catch (e) {
      try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch {}
      job.error = (e.message || 'error').slice(0, 200); job.done = true;
    }
    setTimeout(() => _masterJobs.delete(id), 5 * 60 * 1000).unref?.();
  })();
});

router.get('/vsl/master/:id', (req, res) => {
  const job = _masterJobs.get(req.params.id);
  if (!job) return res.status(404).json({ success: false, error: 'No such job' });
  res.json({ success: true, progress: job.progress, done: job.done, error: job.error, master: job.master });
});

router.delete('/vsl/master/:id', (req, res) => {
  const job = _masterJobs.get(req.params.id);
  if (!job) return res.status(404).json({ success: false, error: 'No such job' });
  if (job.proc) { job.killed = true; try { job.proc.kill('SIGKILL'); } catch {} }
  res.json({ success: true });
});

// ── Transcription (Parakeet via OpenRouter) ───────────────────────────────────
// Extract the audio from the VSL proxy (light) and transcribe it to plain text
// for use as scenario reference context. Tries the WHOLE file first; if the
// upstream rejects/times out (60s cap) it splits the audio into ~chunks and
// concatenates the text. Returns text only (timed subtitles are a separate Groq
// pass — see VSL-S4). Stored on meta[file].transcript so it persists.
const PARAKEET_MODEL = 'nvidia/parakeet-tdt-0.6b-v3';
const _txJobs = new Map();   // id -> { progress, done, error, text, killed }
function _txJobId() { return 'tx_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

// Extract a small mono 16k mp3 (ideal for ASR, keeps the payload small).
function _extractAudioMp3(srcAbs, outAbs, ssSec, durSec) {
  return new Promise((resolve, reject) => {
    const args = ['-hide_banner'];
    if (ssSec != null) args.push('-ss', String(ssSec));
    args.push('-i', srcAbs);
    if (durSec != null) args.push('-t', String(durSec));
    args.push('-vn', '-ac', '1', '-ar', '16000', '-c:a', 'libmp3lame', '-b:a', '64k', '-y', outAbs);
    const proc = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = ''; proc.stderr.on('data', c => { err = (err + c.toString()).slice(-600); });
    proc.on('close', code => code === 0 ? resolve() : reject(new Error('audio extract failed (' + code + '): ' + err.slice(-160))));
    proc.on('error', reject);
  });
}

async function _parakeetTranscribe(mp3Abs) {
  const key = _orKey();
  if (!key) throw new Error('No OpenRouter API key (set it in Brain)');
  const data = fs.readFileSync(mp3Abs).toString('base64');
  const r = await axios.post('https://openrouter.ai/api/v1/audio/transcriptions', {
    model: PARAKEET_MODEL,
    input_audio: { data, format: 'mp3' },
  }, {
    headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    timeout: 180000, maxBodyLength: Infinity, maxContentLength: Infinity,
  });
  return (r.data && r.data.text) || '';
}

// Kick off (or resume) transcription for a file. State is tracked BOTH in the
// ephemeral _txJobs map (for the legacy job poll) AND on meta[file] (txState /
// txProgress / txError / transcript) so the inspector can poll by file and the
// status survives a server restart. Auto-called on upload; idempotent unless
// force is set. Returns the job id (or null if skipped).
function _startTranscription(safe, { force = false } = {}) {
  safe = path.basename(String(safe || ''));
  if (!safe) return null;
  const proxyAbs = path.join(PROXIES_DIR, safe);
  const srcAbs = fs.existsSync(proxyAbs) ? proxyAbs : path.join(VSL_DIR, safe);
  if (!fs.existsSync(srcAbs)) return null;

  const meta0 = _readMeta();
  const m0 = meta0[safe] || (meta0[safe] = {});
  if (!force) {
    if (m0.transcript) return null;            // already transcribed
    if (m0.txState === 'running') return null;  // already in flight
  }
  const id  = _txJobId();
  const job = { progress: 0, done: false, error: null, text: '' };
  _txJobs.set(id, job);
  m0.txState = 'running'; m0.txProgress = 0; m0.txError = null; m0.txJobId = id;
  _writeMeta(meta0);
  const _patchMeta = patch => { const m = _readMeta(); if (m[safe]) { Object.assign(m[safe], patch); _writeMeta(m); } };

  const mp3 = path.join(VSL_DIR, `_tx_${safe}.mp3`);
  const _cleanup = [mp3];
  (async () => {
    try {
      await _extractAudioMp3(srcAbs, mp3);
      const sizeMB = fs.statSync(mp3).size / (1024 * 1024);
      // Attempt 1: the whole file (works for short VSLs).
      try {
        console.log(`[vsl/transcribe] ${safe}: whole file ${sizeMB.toFixed(1)}MB via ${PARAKEET_MODEL}`);
        job.text = await _parakeetTranscribe(mp3);
      } catch (whole) {
        // Attempt 2: chunk by duration. The binding limit is the upstream 60s
        // request timeout (Parakeet is ~realtime-fast), so chunk by TIME.
        console.warn(`[vsl/transcribe] ${safe}: whole-file failed (${(whole.message||'').slice(0,80)}) — chunking`);
        const meta = _readMeta();
        const dur = (meta[safe] && meta[safe].duration) || (await probeMeta(srcAbs)).duration || 0;
        if (!(dur > 0)) throw whole;
        const CHUNK = 480;                       // 8-min chunks
        const nChunks = Math.ceil(dur / CHUNK);
        const parts = [];
        for (let i = 0; i < nChunks; i++) {
          if (job.killed) throw new Error('cancelled');
          const chunkMp3 = path.join(VSL_DIR, `_tx_${safe}_c${i}.mp3`);
          _cleanup.push(chunkMp3);
          await _extractAudioMp3(srcAbs, chunkMp3, i * CHUNK, CHUNK);
          parts.push((await _parakeetTranscribe(chunkMp3)).trim());
          try { fs.unlinkSync(chunkMp3); } catch {}
          job.progress = (i + 1) / nChunks;
          _patchMeta({ txProgress: job.progress });
          console.log(`[vsl/transcribe] ${safe}: chunk ${i + 1}/${nChunks} done`);
        }
        job.text = parts.filter(Boolean).join(' ');
      }
      job.progress = 1; job.done = true;
      _patchMeta({ transcript: job.text, txState: 'done', txProgress: 1, txError: null, txJobId: null });
      // If a vertical was already chosen (user picked it before transcription
      // finished), write the transcript into that vertical's sources now.
      const vbound = (_readMeta()[safe] || {}).vertical;
      if (vbound) { try { SP.upsertSource('marketing', vbound, safe, job.text); } catch {} }
      console.log(`[vsl/transcribe] ${safe}: done (${job.text.length} chars)`);
    } catch (e) {
      const msg = (e.response && e.response.data && (e.response.data.error && (e.response.data.error.message || e.response.data.error) || JSON.stringify(e.response.data))) || e.message || 'error';
      job.error = String(msg).slice(0, 300); job.done = true;
      _patchMeta({ txState: 'error', txError: job.error, txJobId: null });
      console.warn('[vsl/transcribe]', safe, 'FAILED:', job.error);
    } finally {
      for (const f of _cleanup) { try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch {} }
    }
    setTimeout(() => _txJobs.delete(id), 10 * 60 * 1000).unref?.();
  })();
  return id;
}

router.post('/vsl/transcribe', (req, res) => {
  const safe = path.basename(String((req.body && req.body.file) || ''));
  if (!safe) return res.status(400).json({ success: false, error: 'file required' });
  const proxyAbs = path.join(PROXIES_DIR, safe);
  const srcAbs = fs.existsSync(proxyAbs) ? proxyAbs : path.join(VSL_DIR, safe);
  if (!fs.existsSync(srcAbs)) return res.status(404).json({ success: false, error: 'VSL not found' });
  const id = _startTranscription(safe, { force: !!(req.body && req.body.force) });
  res.json({ success: true, jobId: id, alreadyRunning: !id });
});

router.get('/vsl/transcribe/:id', (req, res) => {
  const job = _txJobs.get(req.params.id);
  if (!job) return res.status(404).json({ success: false, error: 'No such job' });
  res.json({ success: true, progress: job.progress, done: job.done, error: job.error, text: job.done && !job.error ? job.text : undefined });
});

// Meta-based status for one file — the inspector polls this (persists across
// restarts; reflects both auto-started and manual jobs).
router.get('/vsl/transcribe-status', (req, res) => {
  const safe = path.basename(String(req.query.file || ''));
  const m = _readMeta()[safe] || {};
  const hasTranscript = !!(m.transcript && m.transcript.length);
  res.json({
    success: true,
    state:   m.txState || (hasTranscript ? 'done' : 'idle'),
    progress: m.txProgress != null ? m.txProgress : (hasTranscript ? 1 : 0),
    error:   m.txError || null,
    hasTranscript,
    chars:   hasTranscript ? m.transcript.length : 0,
    vertical: m.vertical || null,
  });
});

// Bind this VSL's transcript to a vertical: copy the transcript into the
// vertical's reference-sources store (keyed by the VSL file id, so re-binding
// replaces) and remember the vertical on the VSL meta. Autosaved by the
// inspector on every vertical select/change.
router.post('/vsl/bind-vertical', (req, res) => {
  const safe  = path.basename(String((req.body && req.body.file) || ''));
  const vid   = String((req.body && req.body.vid) || '').trim();
  const theme = String((req.body && req.body.theme) || 'marketing');
  if (!safe || !vid) return res.status(400).json({ success: false, error: 'file and vid required' });
  const meta = _readMeta();
  const m = meta[safe];
  if (!m) return res.status(404).json({ success: false, error: 'VSL not found' });
  const prev = m.vertical;
  // If re-binding to a different vertical, drop the old vertical's copy.
  if (prev && prev !== vid) { try { SP.removeSource(theme, prev, safe); } catch {} }
  if (m.transcript) { try { SP.upsertSource(theme, vid, safe, m.transcript); } catch {} }
  m.vertical = vid; _writeMeta(meta);
  res.json({ success: true, vertical: vid, bound: !!m.transcript });
});

// ── POST /api/vsl/upload — multipart; field "video" + optional text "name" ────
router.post('/vsl/upload', upload.single('video'), async (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, error: 'No file' });
  const { filename, path: filePath, size } = req.file;
  const rawName  = (req.body.name || '').trim();
  const safeName = rawName.replace(/[^a-zA-Zа-яА-ЯёЁ0-9_\- .]/g, '').trim()
    || path.basename(req.file.originalname, path.extname(req.file.originalname));

  const thumbFilename = path.basename(filename, path.extname(filename)) + '_thumb.jpg';
  const thumbAbsPath  = path.join(VSL_THUMBS_DIR, thumbFilename);
  const thumbOk       = await extractThumb(filePath, thumbAbsPath);

  // Server-side probe so duration/dimensions are known immediately, regardless
  // of whether the browser can decode this codec.
  const pm = await probeMeta(filePath);

  const meta = _readMeta();
  meta[filename] = {
    name: safeName, size, uploadedAt: new Date().toISOString(), proxying: true,
    duration: pm.duration || 0, width: pm.width || 0, height: pm.height || 0,
  };
  _writeMeta(meta);

  // Background: build a light ~540p proxy for smooth editing/preview. The
  // original stays usable immediately (timeline uses its server-probed
  // duration); the proxy swaps in for preview when ready (serialized).
  _enqueueProxy(filename);

  // Background: auto-transcribe (Parakeet) so the Main-track inspector can show
  // progress and the user can bind the transcript to a vertical. Uses the
  // original's audio (proxy isn't ready yet); network-bound, so it runs fine
  // alongside the proxy encode.
  try { _startTranscription(filename); } catch (e) { console.warn('[vsl/transcribe] auto-start', e.message); }

  return res.json({
    success: true,
    filename,
    name:    safeName,
    url:     `/vsl/${filename}`,
    thumb:   thumbOk ? `/vsl/thumbs/${thumbFilename}` : null,
  });
});

// Multer errors (file too large, bad mime type) → readable JSON
router.use('/vsl/upload', (err, req, res, next) => {
  if (err) return res.status(400).json({ success: false, error: err.message });
  next(err);
});

// ── GET /api/vsl/list — library with merged metadata, newest first ────────────
router.get('/vsl/list', async (_req, res) => {
  try {
    let meta    = _readMeta();
    const files = fs.readdirSync(VSL_DIR)
      .filter(f => ALLOWED_EXTS.includes(path.extname(f).toLowerCase()));
    // Backfill server-probed duration/dimensions for files uploaded before the
    // server-probe existed (so the timeline works without a browser decode).
    const missing = files.filter(f => !(meta[f] && meta[f].duration > 0));
    if (missing.length) {
      await Promise.all(missing.map(async f => {
        const pm = await probeMeta(path.join(VSL_DIR, f));
        if (pm.duration > 0) { const m = _readMeta(); m[f] = Object.assign({}, m[f], { duration: pm.duration, width: pm.width, height: pm.height }); _writeMeta(m); }
      }));
      meta = _readMeta();
    }
    // Backfill a proxy for files that have none (e.g. uploaded before proxies
    // existed) and aren't already building one.
    files.forEach(f => {
      const m = meta[f] || {};
      const hasProxy = fs.existsSync(path.join(PROXIES_DIR, f));
      if (!hasProxy && !m.proxying && !m.proxyError) _enqueueProxy(f);
    });
    const out = files.map(f => {
      const m  = meta[f] || {};
      const tn = path.basename(f, path.extname(f)) + '_thumb.jpg';
      let st = null; try { st = fs.statSync(path.join(VSL_DIR, f)); } catch {}
      const proxyReady  = !!m.proxyReady && fs.existsSync(path.join(PROXIES_DIR, f));
      const masterReady = fs.existsSync(path.join(MASTERS_DIR, f));
      return {
        file: f,
        url:  `/vsl/${f}`,                // ORIGINAL — hook extraction + master build read this
        proxy: proxyReady ? `/vsl/proxies/${f}` : null,   // light preview/edit copy
        master: masterReady ? `/vsl/masters/${f}` : null, // full-res dense-KF render source (smart-copy)
        masterReady,
        name: m.name || path.basename(f, path.extname(f)),
        thumb: fs.existsSync(path.join(VSL_THUMBS_DIR, tn)) ? `/vsl/thumbs/${tn}` : null,
        size: m.size || (st ? st.size : 0),
        uploadedAt: m.uploadedAt || (st ? st.mtime.toISOString() : null),
        duration: m.duration || null,
        width:    m.width    || null,
        height:   m.height   || null,
        proxying:   !!m.proxying && !proxyReady,   // proxy build in progress
        proxyReady: proxyReady,                    // proxy available for preview
        proxyError: m.proxyError || null,
        fragments: Array.isArray(m.fragments) ? m.fragments : null,   // saved scene-cut boundaries (reused by new projects)
        txState:   m.txState || (m.transcript ? 'done' : 'idle'),     // transcription state
        hasTranscript: !!(m.transcript && m.transcript.length),
        vertical:  m.vertical || null,                               // bound marketing vertical
      };
    }).sort((a, b) => String(b.uploadedAt || '').localeCompare(String(a.uploadedAt || '')));
    res.json({ success: true, videos: out });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── POST /api/vsl/meta — browser-probed duration/dimensions ───────────────────
router.post('/vsl/meta', (req, res) => {
  const { file, duration, width, height, name } = req.body || {};
  if (!file) return res.status(400).json({ success: false, error: 'file required' });
  const safe = path.basename(String(file));
  if (!fs.existsSync(path.join(VSL_DIR, safe))) return res.status(404).json({ success: false, error: 'Not found' });
  const meta = _readMeta();
  const m = meta[safe] = meta[safe] || {};
  if (duration > 0) m.duration = +duration;
  if (width  > 0)  m.width    = Math.round(+width);
  if (height > 0)  m.height   = Math.round(+height);
  if (name && String(name).trim()) m.name = String(name).trim();
  _writeMeta(meta);
  res.json({ success: true, meta: m });
});

// ── POST /api/vsl/save-fragments — remember a slice so new projects reuse it ───
// boundaries = cut points (source seconds). null/empty clears the saved slice.
router.post('/vsl/save-fragments', (req, res) => {
  const { file, boundaries } = req.body || {};
  if (!file) return res.status(400).json({ success: false, error: 'file required' });
  const safe = path.basename(String(file));
  if (!fs.existsSync(path.join(VSL_DIR, safe))) return res.status(404).json({ success: false, error: 'Not found' });
  const meta = _readMeta();
  const m = meta[safe] = meta[safe] || {};
  if (Array.isArray(boundaries) && boundaries.length) {
    m.fragments = boundaries.map(Number).filter(n => isFinite(n) && n > 0).sort((a, b) => a - b);
  } else {
    delete m.fragments;
  }
  _writeMeta(meta);
  res.json({ success: true, count: (m.fragments || []).length });
});

// ── Scene detection (slice into fragments) ────────────────────────────────────
// Decode-only pass: ffmpeg select='gt(scene,T)' + showinfo emits a stderr line
// per detected cut; no re-encode, no output file. Progress comes from
// -progress pipe:1 (out_time_us / duration). Jobs are in-memory (single user).
const _sceneJobs = new Map();   // id → {progress, cuts, boundaries, done, error, proc}
const SCENE_MIN_GAP = 0.6;      // s — collapse rapid-fire cuts (flashes)

router.post('/vsl/scenes', (req, res) => {
  const { file, threshold } = req.body || {};
  if (!file) return res.status(400).json({ success: false, error: 'file required' });
  const safe = path.basename(String(file));
  const abs  = path.join(VSL_DIR, safe);
  if (!fs.existsSync(abs)) return res.status(404).json({ success: false, error: 'Not found' });
  const t = Math.min(0.9, Math.max(0.02, parseFloat(threshold) || 0.2));

  const id  = 'sc_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const job = { progress: 0, cuts: 0, boundaries: [], done: false, error: null, proc: null };
  _sceneJobs.set(id, job);

  // Downscale before the scene filter: the score is resolution-independent
  // enough, and it keeps the decode pass cheap on long files.
  const vf = `scale=320:-2:flags=fast_bilinear,select='gt(scene\\,${t})',showinfo`;
  const args = ['-hide_banner', '-i', abs, '-vf', vf, '-an', '-f', 'null', '-progress', 'pipe:1', '-'];
  const proc = spawn(ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  job.proc = proc;

  let duration = 0;            // parsed from the stderr header
  let errTail = '';
  proc.stderr.on('data', (c) => {
    const s = c.toString();
    errTail = (errTail + s).slice(-2000);
    if (!duration) {
      const m = s.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
      if (m) duration = (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]);
    }
    // showinfo lines carry the presentation time of each selected (cut) frame
    let mm; const re = /pts_time:([\d.]+)/g;
    while ((mm = re.exec(s)) !== null) {
      const pt = parseFloat(mm[1]);
      if (isFinite(pt)) { job.boundaries.push(pt); job.cuts = job.boundaries.length; }
    }
  });
  proc.stdout.on('data', (c) => {
    const m = c.toString().match(/out_time_us=(\d+)/g);
    if (m && duration > 0) {
      const us = parseInt(m[m.length - 1].slice(12), 10);
      job.progress = Math.min(0.99, (us / 1e6) / duration);
    }
  });
  proc.on('close', (code) => {
    job.proc = null;
    if (job.killed) { job.error = 'cancelled'; job.done = true; return; }
    if (code !== 0) { job.error = 'scene detect failed (' + code + '): ' + errTail.slice(-200); job.done = true; return; }
    // Sort + collapse boundaries closer than SCENE_MIN_GAP (keep the first),
    // and drop cuts hugging the very start/end of the file.
    const sorted = job.boundaries.slice().sort((a, b) => a - b);
    const out = [];
    for (const b of sorted) {
      if (b < 0.5) continue;
      if (duration > 0 && b > duration - 0.5) continue;
      if (out.length && b - out[out.length - 1] < SCENE_MIN_GAP) continue;
      out.push(Math.round(b * 1000) / 1000);
    }
    job.boundaries = out;
    job.cuts = out.length;
    job.duration = duration;
    job.progress = 1;
    job.done = true;
  });
  proc.on('error', (e) => { job.error = e.message; job.done = true; job.proc = null; });

  res.json({ success: true, jobId: id });
});

router.get('/vsl/scenes/:id', (req, res) => {
  const job = _sceneJobs.get(req.params.id);
  if (!job) return res.status(404).json({ success: false, error: 'No such job' });
  const out = { success: true, progress: job.progress, cuts: job.cuts, done: job.done, error: job.error };
  if (job.done && !job.error) { out.boundaries = job.boundaries; out.duration = job.duration || 0; }
  if (job.done) setTimeout(() => _sceneJobs.delete(req.params.id), 5 * 60 * 1000).unref?.();
  res.json(out);
});

router.delete('/vsl/scenes/:id', (req, res) => {
  const job = _sceneJobs.get(req.params.id);
  if (!job) return res.status(404).json({ success: false, error: 'No such job' });
  if (job.proc) { job.killed = true; try { job.proc.kill('SIGKILL'); } catch {} }
  res.json({ success: true });
});

// ── POST /api/vsl/extract-hook — cut [start,end] from the ORIGINAL → hooks lib ─
// The fragment is re-encoded from the full-quality original (input -ss + decode
// = frame-accurate), saved into /hooks like a normal hook so it shows in the
// library. The client then registers it in the hooks archive.
router.post('/vsl/extract-hook', async (req, res) => {
  const { file, start, end } = req.body || {};
  const safe = path.basename(String(file || ''));
  const abs  = path.join(VSL_DIR, safe);
  const s = Math.max(0, parseFloat(start) || 0);
  const e = parseFloat(end) || 0;
  if (!safe || !fs.existsSync(abs)) return res.status(404).json({ success: false, error: 'VSL not found' });
  if (!(e > s)) return res.status(400).json({ success: false, error: 'end must be greater than start' });
  const rawName  = String((req.body && req.body.name) || '').trim();
  const safeName = rawName.replace(/[^a-zA-Zа-яА-ЯёЁ0-9_\- .]/g, '').trim() || ('clip ' + s.toFixed(1) + '-' + e.toFixed(1));

  if (!fs.existsSync(HOOKS_DIR)) fs.mkdirSync(HOOKS_DIR, { recursive: true });
  if (!fs.existsSync(HOOKS_THUMB_DIR)) fs.mkdirSync(HOOKS_THUMB_DIR, { recursive: true });
  const hookName = `hook_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.mp4`;
  const outAbs   = path.join(HOOKS_DIR, hookName);
  const args = [
    '-hide_banner', '-ss', s.toFixed(3), '-i', abs, '-t', (e - s).toFixed(3),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18',
    '-profile:v', 'main', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '160k', '-ar', '44100', '-ac', '2',
    '-movflags', '+faststart', '-y', outAbs,
  ];
  try {
    await new Promise((resolve, reject) => {
      const proc = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
      let err = ''; proc.stderr.on('data', c => { err = (err + c.toString()).slice(-1000); });
      proc.on('close', code => code === 0 ? resolve() : reject(new Error('cut failed (' + code + '): ' + err.slice(-200))));
      proc.on('error', reject);
    });
    const thumbFilename = path.basename(hookName, '.mp4') + '_thumb.jpg';
    const thumbOk = await extractThumb(outAbs, path.join(HOOKS_THUMB_DIR, thumbFilename));
    res.json({
      success: true, filename: hookName, name: safeName,
      videoPath: `/hooks/${hookName}`,
      thumbPath: thumbOk ? `/hooks/thumbs/${thumbFilename}` : null,
    });
  } catch (err) {
    try { if (fs.existsSync(outAbs)) fs.unlinkSync(outAbs); } catch {}
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── DELETE /api/vsl/delete — remove video + thumb + meta entry ────────────────
router.delete('/vsl/delete', (req, res) => {
  const { file } = req.body || {};
  if (!file) return res.status(400).json({ success: false, error: 'file required' });
  const safe = path.basename(String(file));
  const fp   = path.join(VSL_DIR, safe);
  if (!fs.existsSync(fp)) return res.status(404).json({ success: false, error: 'Not found' });
  fs.unlinkSync(fp);
  const thumbFp = path.join(VSL_THUMBS_DIR, path.basename(safe, path.extname(safe)) + '_thumb.jpg');
  if (fs.existsSync(thumbFp)) try { fs.unlinkSync(thumbFp); } catch {}
  const proxyFp = path.join(PROXIES_DIR, safe);    // light preview/edit copy
  if (fs.existsSync(proxyFp)) try { fs.unlinkSync(proxyFp); } catch {}
  const masterFp = path.join(MASTERS_DIR, safe);   // render master
  if (fs.existsSync(masterFp)) try { fs.unlinkSync(masterFp); } catch {}
  const meta = _readMeta();
  if (meta[safe]) { delete meta[safe]; _writeMeta(meta); }
  res.json({ success: true });
});

module.exports = router;
