'use strict';

/* track-peaks.js - a sound's peaks for its waveform on Merge's lanes (phase V36, T4).

     GET /api/track-peaks?src=<address>
       the bytes of lib/track-peaks.js (one a peak, X-Peaks-Rate a second, 0..255 of the file's loudest), read once and
       kept in cache/peaks/; 404 when the address names no file. A film's sound is read the same way as a sound's. */

const express = require('express');
const router = express.Router();
const { toDiskExisting } = require('../lib/media');
const PEAKS = require('../lib/track-peaks');

router.get('/track-peaks', async (req, res) => {
  const abs = toDiskExisting(String(req.query.src || ''));
  if (!abs) return res.status(404).json({ success: false, error: 'not a file of the library' });
  try {
    const buf = await PEAKS.peaksOf(abs);
    res.set('Content-Type', 'application/octet-stream');
    res.set('X-Peaks-Rate', String(PEAKS.RATE));
    res.set('Cache-Control', 'no-cache');
    res.send(buf);
  } catch (e) {
    res.status(404).json({ success: false, error: e.message });
  }
});

module.exports = router;
