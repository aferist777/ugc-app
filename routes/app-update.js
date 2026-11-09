'use strict';

// "The app was updated" (phase V23, lib/app-update.js):
//   GET  /api/app/update             { changed, was, now, subject, app, announced, renderBusy }
//   POST /api/app/update/announced   the short notice was shown - once for every page of this run
//   POST /api/app/update/check       (phase V83) a friend's copy: ask the shell's updater to check now

const express = require('express');
const UPD = require('../lib/app-update');

const router = express.Router();

router.get('/app/update', (_req, res) => {
  try { res.json({ success: true, ...UPD.state() }); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/app/update/announced', (_req, res) => {
  UPD.announce();
  res.json({ success: true });
});

// (phase V83, block B5) Admin -> This computer's "Check now": the updater is the shell's (desktop/updater.js), so the
// server only passes the ask on - the page reads GET /api/app/update for what came of it.
router.post('/app/update/check', (_req, res) => {
  const port = process.parentPort;
  if (!port || !process.env.UGC_HOME) return res.status(409).json({ success: false, error: 'This copy is not updated through the launcher.' });
  port.postMessage({ type: 'update-check' });
  res.json({ success: true, asked: true });
});

module.exports = router;
