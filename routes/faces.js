'use strict';

/* faces.js - the faces of a film (lib/faces.js does the work).

     GET  /api/faces/next?wait=1      the app's hidden faces window asks for a film to count (held open ~25 s)
     GET  /api/faces/frames/:id       that film's frames, raw RGBA, five a second
     POST /api/faces/:id/done         { frames: [[[x, y, w, h, score], ...], ...], model, delegate, msPerFrame }
     POST /api/faces/:id/fail         { error }
     GET  /api/faces/state            is the window there, what it is counting
     GET  /api/faces/of?src=<address>[&full=1] where one film stands: ready (its faces with full=1) | counting | waiting |
                                      failed | none
     POST /api/faces/find { src }     count one film's faces (a clip's "follow the face" switch) - answers at once

   Loopback only, like the whole server: the window is the app's own. */

const express = require('express');
const fs = require('fs');
const router = express.Router();

const FACES = require('../lib/faces');
const { MEDIA_DIR, PROJECTS_DIR } = require('../lib/config');
const { toDiskWithin } = require('../lib/media');

const _film = (src) => {
  const s = String(src || '');
  if (!/\.(mp4|mov|webm|m4v)$/i.test(s.split('?')[0])) return null;
  const abs = toDiskWithin(s, [MEDIA_DIR, PROJECTS_DIR]);
  return abs && fs.existsSync(abs) ? abs : null;
};

router.get('/faces/next', (req, res) => FACES.next(req, res));
router.get('/faces/frames/:id', (req, res) => FACES.frames(req, res));
router.post('/faces/:id/done', (req, res) => { FACES.done(req, res).catch((e) => res.status(500).json({ success: false, error: e.message })); });
router.post('/faces/:id/fail', (req, res) => FACES.fail(req, res));
router.get('/faces/state', (_req, res) => res.json({ success: true, ...FACES.state() }));
router.get('/faces/of', (req, res) => {
  const abs = _film(req.query.src);
  if (!abs) return res.status(404).json({ success: false, error: 'not a film on the disk' });
  res.json({ success: true, ...FACES.status(abs, String(req.query.full || '') === '1') });
});
router.post('/faces/find', (req, res) => {
  const abs = _film((req.body || {}).src);
  if (!abs) return res.status(404).json({ success: false, error: 'not a film on the disk' });
  // A film that could not be counted a moment ago (no window) is asked again: the window may be there now.
  FACES.find(abs).catch((e) => { if (!e.cancelled && !e.noWorker) console.warn('[faces] find:', e.message); });
  res.json({ success: true, ...FACES.status(abs), worker: FACES.workerSeen() });
});

module.exports = router;
