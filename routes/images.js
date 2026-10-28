'use strict';

// IMAGES — bringing a still picture into the library.
//
//   POST /api/images/upload     multipart, field `image`  -> files it and returns the record
//
// One step, unlike a video upload. That one is two calls (POST /api/biroly/upload puts the
// file down, POST /api/library/media/record files it) because biroly.json is browser-owned:
// the server may make files for it but must never write the store, or the next localStorage
// push would overwrite what it wrote. data/images.json has no browser copy, so the record can
// be written in the same request that receives the file - and lib/images-store makes the
// thumbnails on the way through, so nothing arrives on a shelf without them.

const express = require('express');
const fs      = require('fs');
const path    = require('path');
const multer  = require('multer');
const router  = express.Router();

const { MEDIA } = require('../lib/config');
const IMG = require('../lib/images-store');
const LC  = require('../lib/library-cats');

// The extension is KEPT rather than normalised to .jpg. A PNG with the background erased is
// one of the things this shelf is for, and rewriting it to .jpg would flatten the
// transparency onto black before anything had a chance to look at it. Any OTHER picture - AVIF,
// GIF, TIFF, a phone's HEIC - is taken and turned into a JPEG once it is down (phase V24,
// lib/image-in.js): it used to be turned away as "no file", or kept in a format the aggregators
// refuse.
const IMGIN = require('../lib/image-in');
const _upload = multer({
  storage: multer.diskStorage({
    destination: (_q, _f, cb) => { try { fs.mkdirSync(MEDIA.work, { recursive: true }); } catch (e) {} cb(null, MEDIA.work); },
    filename: (_q, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      // shot_ rather than img_ for a frame off the preview: the prefix is the only clue on
      // disk about where a file came from, and these accumulate fast.
      const pre = /\/images\/shot$/.test(String(_q.path || '')) ? 'shot_' : 'img_';
      cb(null, pre + Date.now() + '_' + Math.random().toString(36).slice(2, 6) + (IMGIN.IN_EXTS.includes(ext) ? ext : '.png'));
    },
  }),
  limits: { fileSize: 64 * 1024 * 1024 },
  fileFilter: (_q, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, /^image\//.test(file.mimetype) || IMGIN.IN_EXTS.includes(ext));
  },
});

router.post('/images/upload', _upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, error: 'no file' });
  // (phase V57, the owner's (ок2)) Not into the references of Environments / Lookbooks: only the photos their generators
  // are given lie there (lib/library-cats.js closedWhy) - the file brought goes, refused in words.
  const shut = LC.closedWhy('images', String((req.body || {}).categoryId || ''));
  if (shut) {
    try { fs.rmSync(req.file.path, { force: true }); } catch (x) { /* it is going anyway */ }
    return res.status(409).json({ success: false, error: shut });
  }
  let abs = req.file.path;
  try { abs = await IMGIN.sendableFile(abs); }
  catch (e) {
    try { fs.rmSync(req.file.path, { force: true }); } catch (x) { /* it is going anyway */ }
    return res.status(e.status || 400).json({ success: false, error: e.message });
  }
  const imagePath = '/media/work/' + path.basename(abs);    // IMG.add moves it to its category's folder
  const raw = String((req.body || {}).name || '').trim();
  const name = raw.replace(/[^\wа-яА-ЯёЁ\- .]/g, '').trim()
    || path.basename(req.file.originalname, path.extname(req.file.originalname));
  try {
    const { item, added } = await IMG.add(imagePath, {
      name,
      source: 'upload',
      categoryId: String((req.body || {}).categoryId || ''),
      categoryLabel: String((req.body || {}).categoryLabel || ''),
    });
    res.json({ success: true, item, added });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.use('/images/upload', (err, _req, res, _next) => {
  res.status(400).json({ success: false, error: (err && err.message) || 'upload failed' });
});

// ── A picture the page cannot show, made one it can ─────────────────────────
//
//   POST /api/images/sendable     { dataUrl }  -> { dataUrl, converted, from }
//
// (phase V24) A phone's HEIC picked in a field that shows its picture before anything is sent - the
// makers of Setup, New Character: the browser cannot draw a HEIC, so the page asks for it as a JPEG
// first (js/picture-file.js). Nothing is written anywhere; the bytes go back as they came, or as a JPEG.
router.post('/images/sendable', async (req, res) => {
  try {
    const raw = String((req.body || {}).dataUrl || '').replace(/^data:[^;,]*;base64,/i, '');
    const pic = await IMGIN.sendable(Buffer.from(raw, 'base64'));
    res.json({ success: true, converted: pic.converted, from: pic.from, dataUrl: 'data:' + pic.type + ';base64,' + pic.buf.toString('base64') });
  } catch (e) {
    res.status(e.status || 500).json({ success: false, error: e.message });
  }
});

// ── A frame off the Merge preview ───────────────────────────────────────────
//
//   POST /api/images/shot     multipart, field `image`  -> the filed record
//
// Its own endpoint rather than /images/upload with a category in the body, because the
// category has to EXIST and the client should not have to find that out. LC.add is
// idempotent by label - it hands back the existing chip rather than making a second one
// with the same name - so this can simply ask for it every time.
router.post('/images/shot', _upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, error: 'no file' });
  const imagePath = '/media/work/' + req.file.filename;      // IMG.add moves it to its category's folder
  try {
    // THE CAPTIONS, burnt in here (phase K4): the page draws them with libass on a canvas it cannot
    // read back, so the frame arrives without them and the render's own libass adds them, from the
    // project's timeline at that moment. A picture without them is still a picture - said, not lost.
    // The page sends the captions it shows (a save may be half a second behind); the stored timeline
    // is the fallback.
    const key = String((req.body || {}).key || '');
    if ((req.body || {}).at != null) {
      try {
        let tl = null;
        try { tl = JSON.parse(String((req.body || {}).captions || '')); } catch (e) { tl = null; }
        if (!(tl && Array.isArray(tl.tracks)) && key) tl = require('../lib/merge-store').read().timelines[key];
        if (tl && Array.isArray(tl.tracks)) await require('../lib/caption-shot').burn(req.file.path, tl, +req.body.at);
      } catch (e) { console.warn('[images/shot] the captions could not be drawn:', e.message); }
    }
    const { cat } = LC.add('images', 'Screenshots');
    const { item } = await IMG.add(imagePath, {
      name: String((req.body || {}).name || '').trim().slice(0, 120) || 'screenshot',
      source: 'screenshot',
      categoryId: cat.id,
      categoryLabel: cat.label,
      // What it was a picture OF. The project and the moment are the only two facts that
      // make one screenshot tellable from another once there are twenty of them.
      meta: {
        project: String((req.body || {}).project || '') || null,
        at: (req.body || {}).at != null ? +req.body.at : null,
      },
    });
    res.json({ success: true, item });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.use('/images/shot', (err, _req, res, _next) => {
  res.status(400).json({ success: false, error: (err && err.message) || 'could not save the shot' });
});

module.exports = router;
