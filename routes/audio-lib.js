'use strict';

// ════════════════════════════════════════════════════════════════════════════
// SOUND ON THE SHELVES - what Merge's Library panel and the Library's Media shelf ask beside the Library's own routes
// (phase V34.C-D; the lab's tree, tiles and star went with the lab in V34.F - the media tree is routes/library.js):
//
//   POST /api/audio/cut { src, in, out, cat }      a piece of any sound as a NEW sound in My sounds (lib/audio-cut.js)
//   GET  /api/audio/online?q=&page=                Openverse, CC0 only (lib/openverse.js)
//   POST /api/audio/online/add { id, cat, label }  a found sound into My sounds
// ════════════════════════════════════════════════════════════════════════════

const express = require('express');

const router = express.Router();

router.post('/audio/cut', async (req, res) => {
  const b = req.body || {};
  try {
    const item = await require('../lib/audio-cut').cut(String(b.src || ''), +b.in, +b.out, { cat: String(b.cat || '') });
    res.json({ success: true, item });
  } catch (e) { res.status(e.status || 500).json({ success: false, error: e.message }); }
});

router.get('/audio/online', async (req, res) => {
  try { res.json({ success: true, ...(await require('../lib/openverse').search(req.query.q, req.query.page)) }); }
  catch (e) { res.status(e.status || 500).json({ success: false, error: e.message }); }
});

router.post('/audio/online/add', async (req, res) => {
  const b = req.body || {};
  try {
    const r = await require('../lib/openverse').add(String(b.id || ''), { cat: String(b.cat || ''), label: String(b.label || '') });
    res.json({ success: true, item: r.item, added: r.added });
  } catch (e) { res.status(e.status || 500).json({ success: false, error: e.message }); }
});

module.exports = router;
