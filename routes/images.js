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

const { UPLOADS_DIR } = require('../lib/config');
const IMG = require('../lib/images-store');
const LC  = require('../lib/library-cats');

const EXTS  = ['.jpg', '.jpeg', '.png', '.webp'];
const MIMES = ['image/jpeg', 'image/png', 'image/webp'];

// The extension is KEPT rather than normalised to .jpg. A PNG with the background erased is
// one of the things this shelf is for, and rewriting it to .jpg would flatten the
// transparency onto black before anything had a chance to look at it.
const _upload = multer({
  storage: multer.diskStorage({
    destination: (_q, _f, cb) => { try { fs.mkdirSync(UPLOADS_DIR, { recursive: true }); } catch (e) {} cb(null, UPLOADS_DIR); },
    filename: (_q, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      // shot_ rather than img_ for a frame off the preview: the prefix is the only clue on
      // disk about where a file came from, and these accumulate fast.
      const pre = /\/images\/shot$/.test(String(_q.path || '')) ? 'shot_' : 'img_';
      cb(null, pre + Date.now() + '_' + Math.random().toString(36).slice(2, 6) + (EXTS.includes(ext) ? ext : '.png'));
    },
  }),
  limits: { fileSize: 64 * 1024 * 1024 },
  fileFilter: (_q, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, MIMES.includes(file.mimetype) || EXTS.includes(ext));
  },
});

router.post('/images/upload', _upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, error: 'no file' });
  const imagePath = '/uploads/' + req.file.filename;
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
  const imagePath = '/uploads/' + req.file.filename;
  try {
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
