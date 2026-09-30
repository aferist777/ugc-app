'use strict';

// GET /api/random-face - a random face to seed a character with (TPDNE in New Character), never
// written to disk.
//
// Everything else this file held - GET /api/status (the Character page's own poll; a portrait is
// followed through its Alerts row now), the first Character page's generation, pose variations, the
// reference sheet, edit-pose, the log bridge and Pose Studio - went with the pages that used it.

const express = require('express');
const axios   = require('axios');
const router  = express.Router();


// ── GET /api/random-face — a random face from thispersondoesnotexist.com ──────
// EPHEMERAL: returned as a data URL, never written to disk. The face only
// exists to seed the 4K reference sheet (Save character sends it as base64).
router.get('/random-face', async (_req, res) => {
  try {
    // The site now serves an HTML shell at "/" — the actual face lives at /random-person.jpeg.
    const response = await axios({ method: 'GET', url: 'https://thispersondoesnotexist.com/random-person.jpeg', responseType: 'arraybuffer', timeout: 15000, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36', 'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8' } });
    const ct = String(response.headers['content-type'] || '');
    const buf = Buffer.from(response.data);
    // TPDNE sometimes serves an HTML interstitial instead of the JPEG — reject it
    // so the client can simply re-click instead of showing a broken face.
    if (!ct.startsWith('image/') || buf.length < 10000) throw new Error('TPDNE returned non-image (' + (ct || 'unknown') + ') — try again');
    res.json({ success: true, dataUrl: 'data:' + ct + ';base64,' + buf.toString('base64') });
  } catch (err) {
    res.status(502).json({ success: false, error: err.message });
  }
});

module.exports = router;
