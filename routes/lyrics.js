'use strict';

// ════════════════════════════════════════════════════════════════════════════
// SAVED LYRICS - AUDIO -> Music -> Lyrics (the store is lib/lyrics-store.js). Generate music saves
// into it (its Lyrics' "save", Custom's "save" by the Lyrics field) and reads it (Custom's list of saved texts); the media
// tree's node `music:lyrics` shows it as tiles (routes/library.js).
//
//   GET    /api/audio/lyrics                                   -> { success, items } - newest first
//   POST   /api/audio/lyrics        { title, text, from, gen? } -> { success, item, already? } - the same `gen` with the same
//                                                                  text: `already` and the one saved before, no second
//   PATCH  /api/audio/lyrics/:id    { title?, text? }           -> { success, item }
//
// A refusal is { success: false, error } in words, with its status.
// ════════════════════════════════════════════════════════════════════════════

const express = require('express');
const LY = require('../lib/lyrics-store');

const router = express.Router();

const _fail = (res, e) => res.status(e.status || 500).json({ success: false, error: e.message });

router.get('/audio/lyrics', (req, res) => {
  try { res.json({ success: true, items: LY.list() }); } catch (e) { _fail(res, e); }
});

router.post('/audio/lyrics', (req, res) => {
  try {
    const r = LY.add(req.body || {});
    res.json(Object.assign({ success: true, item: r.item }, r.already ? { already: true } : {}));
  } catch (e) { _fail(res, e); }
});

router.patch('/audio/lyrics/:id', (req, res) => {
  try { res.json({ success: true, item: LY.patch(req.params.id, req.body || {}) }); } catch (e) { _fail(res, e); }
});

module.exports = router;
