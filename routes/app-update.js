'use strict';

// "The app was updated" (phase V23, lib/app-update.js):
//   GET  /api/app/update             { changed, was, now, subject, app, announced, renderBusy }
//   POST /api/app/update/announced   the short notice was shown - once for every page of this run

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

module.exports = router;
