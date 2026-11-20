'use strict';

// GET /api/thumb?src=/media/images/x.jpg&v=frame
//
// The one door to a resized image. The pages point an <img> here instead of at the original, and
// the first request makes the derivative; every request after is a cached file.
//
// Revalidated, not cached hard: the address names the source and the size, not a version, so a
// regenerated image - or a new size table - answers at the same address. sendFile's ETag makes the
// check a 304 when nothing changed. (The desktop window has no HTTP cache at all.)

const express = require('express');
const router = express.Router();

const { ensureThumb, VARIANTS } = require('../lib/thumbs');
const I18N = require('../lib/i18n');

router.get('/thumb', async (req, res) => {
  const src = String(req.query.src || '');
  const v = String(req.query.v || '');
  if (!src || !VARIANTS[v]) {
    return res.status(400).json({ success: false, error: I18N.t('src and a known v are required'),
      variants: Object.keys(VARIANTS) });
  }
  try {
    const abs = await ensureThumb(src, v);
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(abs);
  } catch (e) {
    // A missing source is the page asking for something that has been deleted - a 404 is the
    // honest answer, and the <img> shows its broken state rather than the server pretending.
    const code = e && e.missing ? 404 : 500;
    res.status(code).json({ success: false, error: e.message });
  }
});
module.exports = router;
