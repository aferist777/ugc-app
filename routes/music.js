'use strict';

// Music for the timeline: the small library of the tracks kept (made by "generate audio" - routes/audio-gen.js - or
// brought in from this computer).
//
//   POST   /api/audio/music/upload           multipart 'music' -> { item }   a track from this computer (phase V28.4)
//
// The list itself is lib/music-store.js (data/suno-lib.json): read, starred, renamed and deleted (with its file) as
// the Library's Media shelf's kind 'music' (routes/library.js) - Audio -> Music in the media tree, in the Library and
// in Merge's Library panel. Its own list and delete routes went with the Music shelf and the music panel's list.
//
// TWO TRACKS PER GENERATION (phase V23, the owner 2026-10-09): Suno makes two variants at once, and both are kept -
// two files, `suno_<task>_1.mp3` and `_2.mp3`, and two records side by side, "<title> · 1" and "<title> · 2", with
// the generation (`gen`) and the variant (`variant`) on them. Only the server writes them (lib/audio-gens.js), and a
// page follows the generation's Alerts row (lib/gen-jobs.js) and reads the list. Older generations were joined into
// one file; their variants were not kept apart, and they stay as they are.
//
// The address keeps its /audio/ prefix: the media tree's Music calls it. Everything else the old routes/audio.js held - voices and voice design, TTS, avatars,
// speech-to-text, sound effects and the Birols pipeline - went with the pages that used it.

const express    = require('express');
const path       = require('path');
const fs         = require('fs');
const crypto     = require('crypto');
const multer     = require('multer');
const { MEDIA } = require('../lib/config');
const MUSIC = require('../lib/music-store');

const router = express.Router();

// ── Suno music library ────────────────────────────────────────────────────────
const _loadSunoLib = () => MUSIC.read();
function _saveSunoLib(list) {
  try { MUSIC.write(list); } catch (e) { console.warn('[music] the list was not written:', e.message); }
}

// ONE RECORD PER FILE (phase V23). Until then the music panel wrote a second record of every track the server had
// filed already (`suno_<time>` beside `suno_<task>`): the one named after its file stays, the others go. At start.
function _dedupeSunoLib() {
  const list = _loadSunoLib();
  if (!Array.isArray(list) || !list.length) return 0;
  const stem = (p) => String(p || '').split('/').pop().replace(/\.[^.]+$/, '');
  const best = new Map();
  for (const t of list) {
    if (!t || !t.audioPath) continue;
    const was = best.get(t.audioPath);
    if (!was || (t.id === stem(t.audioPath) && was.id !== stem(was.audioPath))) best.set(t.audioPath, t);
  }
  const keep = list.filter(t => !t || !t.audioPath || best.get(t.audioPath) === t);
  if (keep.length === list.length) return 0;
  _saveSunoLib(keep);
  console.log('[music] ' + (list.length - keep.length) + ' second record(s) of the same track removed');
  return list.length - keep.length;
}
try { _dedupeSunoLib(); } catch (e) { console.warn('[music] the music list was not tidied:', e.message); }

// (phase V34.E, the owner's (м10)) POST /api/audio/suno/generate went with the generator of the audio lane's inspector:
// music is made in Merge's "/ generate audio" (routes/audio-gen.js). Its rows from before are followed and asked again by
// lib/audio-gens.js (`legacyBody`).

// ── A track from this computer (phase V28.4, the owner 2026-10-12: "музыка - пока тоже файл") ─────────────
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
    const item = await MUSIC.add('/media/work/' + req.file.filename, { name });
    res.json({ success: true, item });
  } catch (e) {
    try { fs.unlinkSync(req.file.path); } catch (er) { /* gone or moved */ }
    res.status(400).json({ success: false, error: e.message });
  }
});

router.use('/audio/music/upload', (err, _req, res, _next) => {
  res.status(400).json({ success: false, error: (err && err.message) || 'upload failed' });
});

module.exports = router;
