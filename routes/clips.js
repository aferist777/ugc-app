'use strict';

// Clips in the Library: bringing a local video in, and the poster frames the shelves draw.
//
//   POST /api/biroly/upload          multipart 'video' -> { name, videoPath, thumbPath }
//   POST /api/media/thumbs/audit     which clips need a thumbnail
//   POST /api/media/thumb            make one
//
// The upload keeps its /biroly/ address - the Library and Merge post to it.

const express = require('express');
const fs      = require('fs');
const path    = require('path');
const multer  = require('multer');
const router  = express.Router();

const { MEDIA } = require('../lib/config');
const VT = require('../lib/video-thumb');
const I18N = require('../lib/i18n');

// ── Upload: bring a local video into the library ────────────────────────────
// The file lands in media/work/ and moves to its shelf's folder when POST /library/media/record
// files it (lib/shelf-files.js). A real thumbnail is made on the way in, beside it, so the shelf
// never has to load the video itself to show a poster frame.
const UPL_EXTS  = ['.mp4', '.webm', '.mov', '.avi', '.mkv'];
const UPL_MIMES = ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-msvideo', 'video/x-matroska'];
const _upload = multer({
  storage: multer.diskStorage({
    destination: (_q, _f, cb) => { try { fs.mkdirSync(MEDIA.work, { recursive: true }); } catch (e) {} cb(null, MEDIA.work); },
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
// The media shelf draws 72px cards. A clip with no thumbnail makes the card load the
// VIDEO to show one frame, and a "thumbnail" that is the full 720x1280 frame weighs
// 14MB across the shelf. These two endpoints let the page fix
// that at the press of Media's "⋯" -> Thumbnails, incrementally.
//
// The server only MAKES files here. Remembering the thumbnail on the clip's record is the page's
// next call (saveThumbPath in public/js/library/actions.js, through routes/library.js).

// Which of these clips actually need work. Cheap: a stat plus an image header read.
//
// The question is not "does a thumbnail file exist" but "does the CARD have one", and the
// card draws `thumbPath` off the record. Those two disagree far more often than they agree:
// measured on a live library, 211 of 339 records were blank while the file was sitting
// right there, and 4 more pointed at a file that had since gone. Judging by the derived
// path alone would call every one of them healthy, while the grid of cards stays empty.
//
// So each item is answered against the RECORD first, and falls into one of three:
//   ok    the record points at a real, small thumbnail - nothing to do
//   link  a good file exists but the record does not point at it - a write, no ffmpeg
//   need  no usable file at all, or the one there is a full frame - a transcode
// `link` is the cheap majority - done at the press without a question.
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
    if (!video) return res.status(400).json({ success: false, error: I18N.t('video required') });
    const abs = VT.localFromUrl(video);
    if (!abs || !fs.existsSync(abs)) return res.status(404).json({ success: false, error: I18N.t('video not on disk') });
    const r = await VT.makeThumb(video);
    res.json({ success: true, thumbPath: r.thumb, width: r.w, bytes: r.bytes });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// What is in a file: length, frame size, whether it has sound (lib/media-probe.js). The video chat asks it for a
// clip or a sound attached without its length (hooks carry none) - the part that goes is picked on the page.
//   GET /api/media/probe?src=<address>   -> { duration, w, h, audio }
router.get('/media/probe', async (req, res) => {
  try {
    const src = String(req.query.src || '');
    // A library address only, and one that has moved since the page took it is followed (lib/moves.js).
    const abs = src ? require('../lib/media').toDiskExisting(src) : null;
    if (!abs || !fs.existsSync(abs)) return res.status(404).json({ success: false, error: I18N.t('not on disk') });
    const p = await require('../lib/media-probe').probe(abs);
    res.json({ success: true, ...p });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/biroly/upload', _upload.single('video'), async (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, error: I18N.t('no file') });
  const videoPath = '/media/work/' + req.file.filename;
  const raw = String((req.body || {}).name || '').trim();
  const name = raw.replace(/[^\wа-яА-ЯёЁ\- .]/g, '').trim()
    || path.basename(req.file.filename, path.extname(req.file.filename));
  // A failed thumbnail is not a failed upload: the clip is already on disk, and
  // Media's "⋯" -> Thumbnails makes it.
  let thumbPath = null;
  try { thumbPath = (await VT.makeThumb(videoPath)).thumb; }
  catch (e) { console.warn('[biroly/upload] thumb failed:', e.message); }
  // No proxy warm-up here: the file is about to move to its shelf's folder, and filing it
  // (POST /library/media/record) queues the proxy from there.
  res.json({ success: true, name, videoPath, thumbPath });
});
router.use('/biroly/upload', (err, _req, res, _next) => {
  res.status(400).json({ success: false, error: (err && err.message) || I18N.t('upload failed') });
});

module.exports = router;
