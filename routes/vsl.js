'use strict';

// VSL video library — long pre-made videos the user overlays inserts onto in
// Merge's VSL mode. Files live in /vsl (gitignored, like /hooks); metadata the
// browser probes after upload (duration / dimensions) is kept in vsl/_meta.json
// so the picker can show it without re-probing every load.
const express      = require('express');
const path         = require('path');
const fs           = require('fs');
const { execFile } = require('child_process');
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

// Extract frame at 0.5 s → JPEG thumbnail (same pattern as hooks)
function extractThumb(videoPath, thumbPath) {
  return new Promise(resolve => {
    const args = ['-ss', '0.5', '-i', videoPath, '-frames:v', '1', '-q:v', '3', '-y', thumbPath];
    execFile(ffmpegPath, args, { timeout: 30000 }, err => {
      resolve(!err && fs.existsSync(thumbPath));
    });
  });
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

  const meta = _readMeta();
  meta[filename] = { name: safeName, size, uploadedAt: new Date().toISOString() };
  _writeMeta(meta);

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
router.get('/vsl/list', (_req, res) => {
  try {
    const meta  = _readMeta();
    const files = fs.readdirSync(VSL_DIR)
      .filter(f => ALLOWED_EXTS.includes(path.extname(f).toLowerCase()));
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
  const meta = _readMeta();
  if (meta[safe]) { delete meta[safe]; _writeMeta(meta); }
  res.json({ success: true });
});

module.exports = router;
