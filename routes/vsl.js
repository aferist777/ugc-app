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
const router       = express.Router();

const { VSL_DIR, VSL_THUMBS_DIR } = require('../lib/config');

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

// ── Optimize-for-fast-render (ingest keyframe pass) ───────────────────────────
// One-time background re-encode that forces a keyframe every second (closed
// GOP, no scene-cut keyframes) so the smart-copy renderer can stream-copy
// untouched spans with frame-accurate, dense cut boundaries. The original is
// preserved under vsl/originals/; the optimized file replaces it at the same
// path so existing projects keep working. Codec params match the final render
// (H.264 main/4.0, yuv420p, AAC 44.1k stereo) for clean concat-copy.
const ORIGINALS_DIR = path.join(VSL_DIR, 'originals');
try { if (!fs.existsSync(ORIGINALS_DIR)) fs.mkdirSync(ORIGINALS_DIR, { recursive: true }); } catch {}

const KEYINT_SECONDS = 1;        // a keyframe every second
const _optimizeQueue = [];       // filenames pending optimize
let _optimizeBusy = false;

function _probeFps(abs) {
  return new Promise(resolve => {
    const proc = spawn(ffmpegPath, ['-hide_banner', '-i', abs], { stdio: ['ignore', 'ignore', 'pipe'] });
    let s = '';
    proc.stderr.on('data', c => { s += c.toString(); });
    proc.on('close', () => { const m = s.match(/([\d.]+)\s*fps/); resolve(m ? Math.round(parseFloat(m[1])) || 30 : 30); });
    proc.on('error', () => resolve(30));
  });
}

function _enqueueOptimize(filename) {
  if (!_optimizeQueue.includes(filename)) _optimizeQueue.push(filename);
  _pumpOptimize();
}
function _pumpOptimize() {
  if (_optimizeBusy) return;
  const filename = _optimizeQueue.shift();
  if (!filename) return;
  _optimizeBusy = true;
  _optimizeVsl(filename).catch(e => console.warn('[vsl/optimize]', filename, e.message))
    .finally(() => { _optimizeBusy = false; setImmediate(_pumpOptimize); });
}

async function _optimizeVsl(filename) {
  const abs = path.join(VSL_DIR, filename);
  if (!fs.existsSync(abs)) return;
  const meta = _readMeta();
  if (!meta[filename]) meta[filename] = {};
  if (meta[filename].optimized) return;          // already done
  meta[filename].optimizing = true; meta[filename].optimizeError = null; _writeMeta(meta);

  const tmp = path.join(VSL_DIR, `_opt_${filename}`);
  try {
    const fps = await _probeFps(abs);
    const g   = String(Math.max(1, Math.round(fps * KEYINT_SECONDS)));
    const args = [
      '-hide_banner', '-i', abs,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
      '-profile:v', 'main', '-level', '4.0', '-pix_fmt', 'yuv420p',
      '-g', g, '-keyint_min', g, '-sc_threshold', '0', '-force_key_frames', `expr:gte(t,n_forced*${KEYINT_SECONDS})`,
      '-c:a', 'aac', '-b:a', '192k', '-ar', '44100', '-ac', '2',
      '-threads', '2',                              // leave CPU for a concurrent render on the 4-vCPU box
      '-movflags', '+faststart', '-y', tmp,
    ];
    console.log(`[vsl/optimize] start ${filename} (fps=${fps}, keyint=${g})`);
    await new Promise((resolve, reject) => {
      const proc = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
      let err = '';
      proc.stderr.on('data', c => { err = (err + c.toString()).slice(-1000); });
      proc.on('close', code => code === 0 ? resolve() : reject(new Error('optimize failed (' + code + '): ' + err.slice(-200))));
      proc.on('error', reject);
    });

    // Preserve the original, then swap the optimized file into place atomically.
    const orig = path.join(ORIGINALS_DIR, filename);
    if (!fs.existsSync(orig)) fs.renameSync(abs, orig); else fs.unlinkSync(abs);
    fs.renameSync(tmp, abs);

    const m2 = _readMeta();
    if (!m2[filename]) m2[filename] = {};
    m2[filename].optimizing = false;
    m2[filename].optimized = true;
    m2[filename].keyint = KEYINT_SECONDS;
    _writeMeta(m2);
    console.log(`[vsl/optimize] done ${filename}`);
  } catch (e) {
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch {}
    const m3 = _readMeta();
    if (m3[filename]) { m3[filename].optimizing = false; m3[filename].optimizeError = (e.message || 'error').slice(0, 200); _writeMeta(m3); }
    throw e;   // surfaced by the queue pump's logger
  }
}

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
    name: safeName, size, uploadedAt: new Date().toISOString(), optimizing: true,
    duration: pm.duration || 0, width: pm.width || 0, height: pm.height || 0,
  };
  _writeMeta(meta);

  // Background: re-encode with dense forced keyframes so smart-copy renders are
  // fast + frame-accurate. The original file stays usable immediately; the
  // optimized file swaps in when ready (serialized, one at a time).
  _enqueueOptimize(filename);

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
    const out = files.map(f => {
      const m  = meta[f] || {};
      const tn = path.basename(f, path.extname(f)) + '_thumb.jpg';
      let st = null; try { st = fs.statSync(path.join(VSL_DIR, f)); } catch {}
      return {
        file: f,
        url:  `/vsl/${f}`,
        name: m.name || path.basename(f, path.extname(f)),
        thumb: fs.existsSync(path.join(VSL_THUMBS_DIR, tn)) ? `/vsl/thumbs/${tn}` : null,
        size: m.size || (st ? st.size : 0),
        uploadedAt: m.uploadedAt || (st ? st.mtime.toISOString() : null),
        duration: m.duration || null,    // probed by the browser after upload
        width:    m.width    || null,
        height:   m.height   || null,
        optimizing: !!m.optimizing,       // background keyframe re-encode in progress
        optimized:  !!m.optimized,        // dense keyframes ready → smart-copy renders
        optimizeError: m.optimizeError || null,
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
  const origFp = path.join(ORIGINALS_DIR, safe);   // preserved pre-optimize copy
  if (fs.existsSync(origFp)) try { fs.unlinkSync(origFp); } catch {}
  const meta = _readMeta();
  if (meta[safe]) { delete meta[safe]; _writeMeta(meta); }
  res.json({ success: true });
});

module.exports = router;
