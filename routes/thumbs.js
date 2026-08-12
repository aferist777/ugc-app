'use strict';

// GET /api/thumb?src=/uploads/x.jpg&v=frame
//
// The one door to a resized image. The pages point an <img> here instead of at the original, and
// the first request makes the derivative; every request after is a cached file.
//
// Cached hard on purpose: the key includes the source's mtime, so a regenerated image gets a
// different URL rather than a stale picture. That means the browser can keep these forever.

const express = require('express');
const router = express.Router();

const { ensureThumb, VARIANTS } = require('../lib/thumbs');

router.get('/thumb', async (req, res) => {
  const src = String(req.query.src || '');
  const v = String(req.query.v || '');
  if (!src || !VARIANTS[v]) {
    return res.status(400).json({ success: false, error: 'src and a known v are required',
      variants: Object.keys(VARIANTS) });
  }
  try {
    const abs = await ensureThumb(src, v);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.sendFile(abs);
  } catch (e) {
    // A missing source is the page asking for something that has been deleted - a 404 is the
    // honest answer, and the <img> shows its broken state rather than the server pretending.
    const code = /no such image/.test(e.message) ? 404 : 500;
    res.status(code).json({ success: false, error: e.message });
  }
});
module.exports = router;
