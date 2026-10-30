'use strict';

/* routes/broll.js - THE B-ROLL ENGINE's doors (phase V62, block 1; lib/broll.js does the work).

   GET  /api/broll/:id/state            -> { success, state }   how far it has got - the page's field 2 follows it
   POST /api/broll/:id/find             -> { success, state }   find the B-roll of every sentence that has none, and lay it
   POST /api/broll/:id/mode  { mode }   -> { success, state }   'mixed' | 'video' | 'image': what is laid - laid again now

   The work is the SERVER's (CLAUDE.md, the generation journal's rule - though this is no paid generation: the stock is free and
   the agent's keywords are fractions of a cent, like the voices - no Alerts row, (во14)): a press starts it and answers at once;
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

module.exports = router;
