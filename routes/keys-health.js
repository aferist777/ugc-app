'use strict';

// GET /api/keys/health          the cached verdict, re-probing when it has gone stale
// GET /api/keys/health?force=1  probe now, whatever the cache says
//
// A thin door. Everything it knows is in lib/keys-health.js, because the ladder runner
// reads the same verdict and neither of them should own it.

const express = require('express');
const router = express.Router();

const H = require('../lib/keys-health');

router.get('/keys/health', async (req, res) => {
  try {
    const force = String((req.query && req.query.force) || '') === '1';
    res.json(H.shape(await H.getHealth({ force })));
  } catch (e) {
    res.status(502).json({ success: false, error: e.message });
  }
});

module.exports = router;
