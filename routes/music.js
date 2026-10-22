'use strict';

// Music for the timeline: Suno tracks made through kie.ai, and the small library of the ones kept.
//
//   POST   /api/audio/suno/generate          { style, title, where, ... } -> { genId, alertId }   (lib/audio-gens.js)
//   POST   /api/audio/music/upload           multipart 'music' -> { item }   a track from this computer (phase V28.4)
//
// The list itself is lib/music-store.js (data/suno-lib.json): read, starred, renamed and deleted (with its file) as
// the Library's Media shelf's kind 'music' (routes/library.js) - Audio -> Music in the media tree, in the Library and
// in Merge's Library panel. Its own list and delete routes went with the Music shelf and the music panel's list.
//
// TWO TRACKS PER GENERATION (phase V23, the owner 2026-10-09): Suno makes two variants at once, and both are kept -
// two files, `suno_<task>_1.mp3` and `_2.mp3`, and two records side by side, "<title> · 1" and "<title> · 2", with
// the generation (`gen`) and the variant (`variant`) on them. Merge's music panel lays the other variant after the
// one chosen when that one is shorter than the video, crossing into it over three seconds (merge-v3/music.js).
// Only the server writes them: the panel follows the generation's Alerts row (lib/gen-jobs.js) and reads the list.
// Older generations were joined into one file; their variants were not kept apart, and they stay as they are.
//
// The addresses keep their /audio/ prefix: Merge's music panel and the media tree's Music call
// them. Everything else the old routes/audio.js held - voices and voice design, TTS, avatars,
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

// POST /api/audio/suno/generate - Merge's generator in the audio lane's inspector (phase A7, V23).
// Body: { style, title, negativeTags, styleWeight, weirdnessConstraint, model, targetDuration, where } -> { genId, alertId }
//
// (phase V34.C, the owner 2026-10-22) On kie.ai's NEW Suno address (jobs/createTask, model V6 - V4.5+ is discontinued)
// and by the journal's rule: the row is written AT THE PRESS, `asked` before the money, the server follows the task,
// downloads both tracks once and files them as "<title> · 1" / "· 2" (lib/audio-gens.js - the job type 'music' is there
// now, rows from before V34 are followed on the old address to their end). `targetDuration` is sent as Suno V6's
// `duration` (10-360 s) - a length it keeps, not a hint any more.
const AG = require('../lib/audio-gens');

router.post('/audio/suno/generate', (req, res) => {
  const b = req.body || {};
  try {
    const g = AG.create('custom', AG.legacyBody(b), b.where || null);
    res.json({ success: true, genId: g.id, alertId: g.alertId });
  } catch (err) {
    console.error('[audio/suno/generate]', err.message);
    res.status(err.status || 500).json({ success: false, error: err.message });
  }
});


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
