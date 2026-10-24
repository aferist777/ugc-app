'use strict';

/* track-peaks.js - a sound's peaks for its waveform on Merge's lanes (phase V36, T4).

     GET /api/track-peaks?src=<address>
       the bytes of lib/track-peaks.js (one a peak, X-Peaks-Rate a second, 0..255 of the file's loudest), read once and
       kept in cache/peaks/; 404 when the address names no file. A film's sound is read the same way as a sound's.

     GET /api/track-pauses?src=<address>&from=<s>&to=<s>
       (phase V44) the pauses of the file's sound inside [from, to) - seconds of the FILE - by the noise floor of that
       stretch (lib/track-pauses.js): { success, from, to, floor, thr, pauses: [[a, b], ...] }; the loudness is read once
       and kept in cache/pauses/. The timeline's "cut silence" asks it for main audio's clips (js/merge-v3/tl-silence.js). */

const fs = require('fs');
const express = require('express');
const router = express.Router();
const { toDiskExisting } = require('../lib/media');
const PEAKS = require('../lib/track-peaks');
const PAUSES = require('../lib/track-pauses');

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

// A stretch of at most this much is listened to at once - three hours.
const MAX_SPAN = 3 * 3600;

router.get('/track-pauses', async (req, res) => {
  const abs = toDiskExisting(String(req.query.src || ''));
  if (!abs || !fs.existsSync(abs)) return res.status(404).json({ success: false, error: 'not a file of the library' });
  const from = Number(req.query.from), to = Number(req.query.to);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from < 0 || !(to > from) || to - from > MAX_SPAN) {
    return res.status(400).json({ success: false, error: 'from and to are seconds of the file, from before to' });
  }
  try {
    res.json({ success: true, ...(await PAUSES.pausesIn(abs, from, to)) });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;
