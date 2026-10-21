'use strict';

// ════════════════════════════════════════════════════════════════════════════
// THE ONE CLOUDFLARE KEY (phase TG) - Admin -> API keys, the row "Cloudflare" (lib/cloudflare.js).
//
//   GET  /api/cloudflare          -> { tokenSet, inUse, account, bucket, checking, check: { at, ok, steps } | null }
//   POST /api/cloudflare/check    -> the same, after the check ran: the key, the account, the bucket, an upload
// ════════════════════════════════════════════════════════════════════════════

const express = require('express');
const CF = require('../lib/cloudflare');

const router = express.Router();

router.get('/cloudflare', (_req, res) => {
  try { res.json({ success: true, ...CF.view() }); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/cloudflare/check', async (_req, res) => {
  try {
    await CF.check();
    res.json({ success: true, ...CF.view() });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

module.exports = router;
