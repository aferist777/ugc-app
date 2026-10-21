'use strict';

// ════════════════════════════════════════════════════════════════════════════
// REFERENCES (phase TG) - what the Telegram bot brought in (lib/references-store.js, lib/references-intake.js).
//
//   GET /api/references   -> { sources: [{ id, label, folders }], posts: [post] }   newest first
//
// The page (the media tree's REFERENCES branch, the post viewer, moving and trimming) is block 5.
// ════════════════════════════════════════════════════════════════════════════

const express = require('express');
const REFS = require('../lib/references-store');

const router = express.Router();

router.get('/references', (_req, res) => {
  try { res.json({ success: true, sources: REFS.SOURCES, posts: REFS.read() }); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// DELETE /api/references/:id   -> { removed: [file names] }
// The post and its files go - each file with what is derived from it (its thumbnail, a preview copy: lib/relocate.js
// siblingsOf) - the record first, in one tick, then the files.
router.delete('/references/:id', (req, res) => {
  try {
    const id = String(req.params.id);
    const gone = REFS.apply((list) => {
      const i = list.findIndex(p => p && String(p.id) === id);
      return i < 0 ? null : list.splice(i, 1)[0];
    });
    if (!gone) return res.status(404).json({ success: false, error: 'no such post' });
    const fs = require('fs');
    const path = require('path');
    const { toDiskWithin } = require('../lib/media');
    const { MEDIA } = require('../lib/config');
    const { siblingsOf } = require('../lib/relocate');
    // Only what another post does not point at (a file is one post's - this is a guard, not a rule in use).
    const used = new Set();
    for (const p of REFS.read()) for (const m of (p.media || [])) { if (m.path) used.add(m.path); if (m.thumb) used.add(m.thumb); }
    const urls = [gone.poster, ...(gone.media || []).flatMap(m => [m.path, m.thumb])].filter(u => u && !used.has(u));
    const removed = [];
    for (const u of urls) {
      const abs = toDiskWithin(u, [MEDIA.references]);
      if (!abs) continue;
      let derived = [];
      try { derived = siblingsOf(abs, path.basename(abs)).map(([a]) => a); } catch (e) { derived = []; }
      try { fs.rmSync(abs, { force: true }); removed.push(path.basename(abs)); } catch (e) { /* held: left */ }
      for (const d of derived) { try { fs.rmSync(d, { force: true }); } catch (e) { /* held */ } }
    }
    res.json({ success: true, removed });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

module.exports = router;
