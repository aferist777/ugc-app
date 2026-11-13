'use strict';

/* routes/broll.js - THE B-ROLL ENGINE's doors (lib/broll.js does the work).

   GET  /api/broll/:id/state            -> { success, state }   how far it has got - the page's field 2 follows it
   POST /api/broll/:id/find             -> { success, state }   find the B-roll of every sentence that has none, and lay it
   POST /api/broll/:id/mode  { mode }   -> { success, state }   'mixed' | 'video' | 'image': what is laid - laid again now

   The work is the SERVER's (this is no paid generation: the stock is free and the agent's keywords are fractions of a cent,
   like the voices - so no Alerts row): a press starts it and answers at once;
   the page asks for the state while it runs. One run per project. */

const express = require('express');
const router = express.Router();
const BR = require('../lib/broll');

const _fail = (res, e) => res.status(e && e.status ? e.status : 500).json({ success: false, error: (e && e.message) || String(e) });

router.get('/broll/:id/state', (req, res) => {
  try { res.json({ success: true, state: BR.state(String(req.params.id)) }); } catch (e) { _fail(res, e); }
});

router.post('/broll/:id/find', (req, res) => {
  try { res.json({ success: true, state: BR.find(String(req.params.id)) }); } catch (e) { _fail(res, e); }
});

router.post('/broll/:id/mode', (req, res) => {
  try { res.json({ success: true, state: BR.setMode(String(req.params.id), String((req.body || {}).mode || '')) }); } catch (e) { _fail(res, e); }
});

// ── Another item for a piece, from the Library panel ──
//   GET  /api/broll/:id/piece/:cell            -> { success, piece }  its sentence's batch (lib/broll.js piece)
//   GET  /api/broll/:id/thumb/:item            -> the item's picture
//   POST /api/broll/:id/swap  { cell, item }   -> { success, state }  the piece takes that item - chosen by hand
router.get('/broll/:id/piece/:cell', (req, res) => {
  try { res.json({ success: true, piece: BR.piece(String(req.params.id), String(req.params.cell)) }); } catch (e) { _fail(res, e); }
});

router.get('/broll/:id/thumb/:item', async (req, res) => {
  try {
    const t = await BR.thumbOf(String(req.params.id), String(req.params.item));
    if (t.redirect) return res.redirect(t.redirect);
    res.set('Cache-Control', 'private, max-age=3600');
    res.sendFile(t.file);
  } catch (e) { _fail(res, e); }
});

router.post('/broll/:id/swap', (req, res) => {
  try {
    const b = req.body || {};
    res.json({ success: true, state: BR.swap(String(req.params.id), String(b.cell || ''), String(b.item || '')) });
  } catch (e) { _fail(res, e); }
});

module.exports = router;
