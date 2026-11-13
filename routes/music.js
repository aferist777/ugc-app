'use strict';

// Music for the timeline: the small library of the tracks kept (made by "generate audio" - routes/audio-gen.js - or
// brought in from this computer).
//
//   POST   /api/audio/music/upload           multipart 'music' -> { item }   a track from this computer
//   GET    /api/audio/music/highlights       Music -> highlights: { moods: [{ id, label, about, tracks }], root }
//   GET    /api/audio/music/:id/place        where a track lies: { folder, mood, moodMade, moods }
//   POST   /api/audio/music/:id/place        { folder: '' | 'highlights', mood? } - a mood only for what its preset made
//
// The list itself is lib/music-store.js (data/suno-lib.json): read, starred, renamed and deleted (with its file) as
// the Library's Media shelf's kind 'music' (routes/library.js) - Audio -> Music in the media tree, in the Library and
// in Merge's Library panel.
//
// TWO TRACKS PER GENERATION: Suno makes two variants at once, and both are kept -
// two files, `suno_<task>_1.mp3` and `_2.mp3`, and two records side by side, "<title> · 1" and "<title> · 2", with
// the generation (`gen`) and the variant (`variant`) on them. Only the server writes them (lib/audio-gens.js), and a
// page follows the generation's Alerts row (lib/gen-jobs.js) and reads the list.
//
// The address keeps its /audio/ prefix: the media tree's Music calls it.

const express    = require('express');
const path       = require('path');
const fs         = require('fs');
const crypto     = require('crypto');
const multer     = require('multer');
const { MEDIA } = require('../lib/config');
const MUSIC = require('../lib/music-store');

const router = express.Router();

// ── A track from this computer ─────────────────────────────────────────────
// Into media/work first (multer), then lib/music-store.js measures it, moves it into media/audio/ and files it first.
const MUSIC_EXTS = ['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.oga', '.flac', '.opus'];
const _uploadMusic = multer({
  storage: multer.diskStorage({
    destination: (_q, _f, cb) => { try { fs.mkdirSync(MEDIA.work, { recursive: true }); } catch (e) { /* exists */ } cb(null, MEDIA.work); },
    filename: (_q, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      const stem = require('../lib/names').folderName(path.basename(file.originalname, path.extname(file.originalname)), 'track');
      cb(null, stem + '_' + crypto.randomBytes(2).toString('hex') + (MUSIC_EXTS.includes(ext) ? ext : '.mp3'));
    },
  }),
  limits: { fileSize: 200 * 1024 * 1024 },
  fileFilter: (_q, file, cb) => cb(null, /^audio\//.test(file.mimetype) || MUSIC_EXTS.includes(path.extname(file.originalname).toLowerCase())),
});

router.post('/audio/music/upload', _uploadMusic.single('music'), async (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, error: 'no music - mp3, wav, m4a, aac, ogg, flac or opus' });
  try {
    const name = String((req.body || {}).name || '').trim() || path.basename(req.file.originalname).replace(/\.[^.]+$/, '');
    // Let go on an own folder of Music: into it.
    const item = await MUSIC.add('/media/work/' + req.file.filename, { name, categoryId: String((req.body || {}).cat || '') });
    res.json({ success: true, item });
  } catch (e) {
    try { fs.unlinkSync(req.file.path); } catch (er) { /* gone or moved */ }
    res.status(400).json({ success: false, error: e.message });
  }
});

router.use('/audio/music/upload', (err, _req, res, _next) => {
  res.status(400).json({ success: false, error: (err && err.message) || 'upload failed' });
});

// ── Music -> highlights and its moods (the rule is lib/music-store.js `place`) ──────────
// The list the highlights popup offers: every track in highlights - its root and its ten mood folders.
router.get('/audio/music/highlights', (_req, res) => {
  try { res.json({ success: true, ...MUSIC.highlights() }); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});
// Where a track lies: { folder: '' | 'highlights', mood, moodMade }.
router.get('/audio/music/:id/place', (req, res) => {
  const rec = MUSIC.read().find(x => x && String(x.id) === String(req.params.id || ''));
  if (!rec) return res.status(404).json({ success: false, error: 'no such track' });
  res.json({ success: true, ...MUSIC.placeOf(rec), moods: MUSIC.moods() });
});
// Put it somewhere: { folder: '' | 'highlights', mood? } - a mood folder only for the track its preset made (409 otherwise).
router.post('/audio/music/:id/place', (req, res) => {
  const b = req.body || {};
  try { res.json({ success: true, ...MUSIC.place(req.params.id, { folder: b.folder, mood: b.mood }) }); }
  catch (e) { res.status(e.status || 500).json({ success: false, error: e.message }); }
});

module.exports = router;
