'use strict';

// ════════════════════════════════════════════════════════════════════════════
// GENERATE AUDIO (phase V34.C, the owner 2026-10-22) - the server of the "generate audio" constructor: Merge's view
// "/ generate audio" (V34.E, js/merge-v3/audchat.js; the lab page /lab/audio of V34.D went in V34.F). The records and the journal are lib/audio-gens.js; the
// engines' field names lib/audio-engines.js.
//
//   GET    /api/audio/catalog         the engines, their modes, models, chips, prices; whether the keys, the almanac and
//                                     the writer's rules are there
//   POST   /api/audio/gen             { mode, ...the mode's fields, where, project? } -> { gen }   a press: the record and
//                                     its Alerts row NOW, the asking behind the answer
//   GET    /api/audio/gens?limit=&project=   the history, newest first - of one project when it is named (Merge's "Made
//                                     here", V34.E: the draft's are the drafts' one list)
//   GET    /api/audio/gens/:id        one record (the page follows a press with it)
//   DELETE /api/audio/gens/:id        off the history - never its files
//
// Stopping one is Alerts' own cross (POST /api/alerts/:id/cancel): one way to let go, whichever page asks.
// ════════════════════════════════════════════════════════════════════════════

const express = require('express');
const fs = require('fs');
const path = require('path');
const { PUBLIC_DIR } = require('../lib/config');
const ENG = require('../lib/audio-engines');
const AG = require('../lib/audio-gens');

const router = express.Router();

router.get('/audio/catalog', (_req, res) => {
  try {
    const c = ENG.catalog();
    // V34.A's files, read when they exist: the gold almanac button and the simple mode's writer.
    c.almanac = fs.existsSync(path.join(PUBLIC_DIR, 'js', 'audio', 'almanac-data.js'));
    c.writerRules = fs.existsSync(path.join(__dirname, '..', 'lib', 'audio-writer-rules.js'));
    c.fake = require('../lib/fake-agg').on();
    res.json({ success: true, ...c });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/audio/gen', (req, res) => {
  const b = req.body || {};
  try {
    const g = AG.create(String(b.mode || ''), b, b.where || null, { project: String(b.project || '') });
    res.json({ success: true, gen: g, price: ENG.price(g.req) });
  } catch (e) {
    if (!e.status) console.warn('[audio/gen]', e.message);
    res.status(e.status || 500).json({ success: false, error: e.message });
  }
});

router.get('/audio/gens', (req, res) => {
  try { res.json({ success: true, items: AG.list(req.query.limit, String(req.query.project || '')) }); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.get('/audio/gens/:id', (req, res) => {
  const g = AG.get(req.params.id);
  if (!g) return res.status(404).json({ success: false, error: 'not found' });
  res.json({ success: true, gen: g });
});

router.delete('/audio/gens/:id', (req, res) => {
  const r = AG.remove(req.params.id);
  if (r.code !== 200) return res.status(r.code).json({ success: false, error: r.error });
  res.json({ success: true });
});

module.exports = router;
