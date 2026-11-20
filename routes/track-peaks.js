'use strict';

/* track-peaks.js - a sound's peaks for its waveform on Merge's lanes.

     GET /api/track-peaks?src=<address>
       the bytes of lib/track-peaks.js (one a peak, X-Peaks-Rate a second, 0..255 of the file's loudest), read once and
       kept in cache/peaks/; 404 when the address names no file. A film's sound is read the same way as a sound's.

     GET /api/track-pauses?src=<address>&from=<s>&to=<s>
       the pauses of the file's sound inside [from, to) - seconds of the FILE - by the noise floor of that
       stretch (lib/track-pauses.js): { success, from, to, floor, thr, pauses: [[a, b], ...] }; the loudness is read once
       and kept in cache/pauses/. The timeline's "cut silence" asks it for main audio's clips (js/merge-v3/tl-silence.js).

     GET /api/pitch-copy?src=<address>&st=<semitones>&shift=1&rev=1
       the file at another pitch (lib/pitch-copy.js): answered when the copy is made - { success, url } (an address
       under /cache/pitch/), made once and kept; `shift` - the timbre moves with the pitch, `rev` - from the sound played
       backwards. The preview plays it in place of the file (js/merge-v3/preview-b.js). */

const fs = require('fs');
const express = require('express');
const router = express.Router();
const { toDiskExisting, toUrl } = require('../lib/media');
const PEAKS = require('../lib/track-peaks');
const PAUSES = require('../lib/track-pauses');
const PITCH = require('../lib/pitch-copy');
const { normalizePitch } = require('../public/js/sound/pitch.js');
const I18N = require('../lib/i18n');

router.get('/track-peaks', async (req, res) => {
  const abs = toDiskExisting(String(req.query.src || ''));
  if (!abs) return res.status(404).json({ success: false, error: I18N.t('not a file of the library') });
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
  if (!abs || !fs.existsSync(abs)) return res.status(404).json({ success: false, error: I18N.t('not a file of the library') });
  const from = Number(req.query.from), to = Number(req.query.to);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from < 0 || !(to > from) || to - from > MAX_SPAN) {
    return res.status(400).json({ success: false, error: I18N.t('from and to are seconds of the file, from before to') });
  }
  try {
    res.json({ success: true, ...(await PAUSES.pausesIn(abs, from, to)) });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.get('/pitch-copy', async (req, res) => {
  const abs = toDiskExisting(String(req.query.src || ''));
  if (!abs || !fs.existsSync(abs)) return res.status(404).json({ success: false, error: I18N.t('not a file of the library') });
  const p = normalizePitch({ st: Number(req.query.st), shift: String(req.query.shift || '') === '1' });
  if (!p) return res.status(400).json({ success: false, error: I18N.t('st is semitones, -12 to 12, not 0') });
  try {
    const copy = await PITCH.copyOf(abs, p, { rev: String(req.query.rev || '') === '1' });
    const url = toUrl(copy);
    if (!url) throw new Error(I18N.t('the copy is not in the library'));
    res.json({ success: true, url });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;
