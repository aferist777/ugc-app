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

module.exports = router;
