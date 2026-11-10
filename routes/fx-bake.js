'use strict';

/* fx-bake.js - the bake engine's window side (phase V84 block 3; lib/fx-bake.js does the work).

     GET  /api/fx-bake/next?wait=1       the app's hidden bake window asks for a stretch to draw (held open ~25 s)
     GET  /api/fx-bake/frames/:id        that stretch's frames as the clip lies in the frame, raw I420
     POST /api/fx-bake/:id/chunk?n=<k>   a piece of the drawn stretch's H.264 stream (Annex B), raw bytes; k frames done
     POST /api/fx-bake/:id/done          { frames, msPerFrame, codec } - the stream is whole
     POST /api/fx-bake/:id/fail          { error }
     GET  /api/fx-bake/state             is the window there, what is waiting

   Loopback only, like the whole server: the window is the app's own. */

const express = require('express');
const router = express.Router();
const FXB = require('../lib/fx-bake');

router.get('/fx-bake/next', (req, res) => FXB.next(req, res));
router.get('/fx-bake/frames/:id', (req, res) => { FXB.frames(req, res).catch(() => { try { res.status(500).end(); } catch (e) { /* gone */ } }); });
router.post('/fx-bake/:id/chunk', express.raw({ type: 'application/octet-stream', limit: '512mb' }), (req, res) => FXB.chunk(req, res));
router.post('/fx-bake/:id/done', (req, res) => { FXB.done(req, res).catch((e) => res.status(500).json({ success: false, error: e.message })); });
router.post('/fx-bake/:id/fail', (req, res) => FXB.fail(req, res));
router.get('/fx-bake/state', (_req, res) => res.json({ success: true, ...FXB.state() }));

module.exports = router;
