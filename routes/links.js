'use strict';

// ════════════════════════════════════════════════════════════════════════════
// LINKS — the yt-dlp the app reads links with (phase V27).
//
//   GET  /api/ytdlp          -> { available, version, copy, channel, checking, checkedAt, why, result, from, to, error }
//   POST /api/ytdlp/check    -> the same, after a check for a newer nightly build
//
// Admin -> This computer shows it (public/js/admin-local.js): which yt-dlp, whose copy (the app's,
// or the one kept current in the library's cache/yt-dlp/), and what the last check found. The
// checks themselves run on their own (lib/ytdlp.js startChecks); the button is for "just in case".
// ════════════════════════════════════════════════════════════════════════════

const express = require('express');
const YTDLP = require('../lib/ytdlp');

const router = express.Router();

// The first probe of a run starts a whole Python, over a second and up to thirty on a cold disk:
// the page is answered in time with what is known, and asks again.
const PROBE_WAIT_MS = 8000;

router.get('/ytdlp', async (_req, res) => {
  try {
    const late = new Promise(r => setTimeout(() => r(null), PROBE_WAIT_MS));
    const s = await Promise.race([YTDLP.status(), late]);
    res.json(s ? { success: true, ...s } : { success: true, probing: true, channel: YTDLP.CHANNEL });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/ytdlp/check', async (_req, res) => {
  try { res.json({ success: true, ...(await YTDLP.checkNow()) }); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

module.exports = router;
