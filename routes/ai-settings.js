'use strict';

// ════════════════════════════════════════════════════════════════════════════
// ADMIN -> AI SETTINGS.
//
//   GET /api/ai-settings    the agents' ladder, its cap, and every aggregator with its models and whether it can be
//                           asked now (`off`: '' or why not - no key, its key refused at the last check)
//   PUT /api/ai-settings    { agents: [{ provider, model }] } - the new order, written whole; answers as GET
//
// The ladder itself is lib/agents.js. The key verdicts are the key-health check's (lib/keys-health.js - free calls,
// cached half an hour), asked before answering so a refused key shows as refused the first time the tab opens.
// ════════════════════════════════════════════════════════════════════════════

const express = require('express');
const router = express.Router();

const AGENTS = require('../lib/agents');
const I18N = require('../lib/i18n');

async function _state() {
  try { await require('../lib/keys-health').getHealth(); } catch (e) { /* no verdict is no refusal */ }
  return AGENTS.state();
}

router.get('/ai-settings', async (_req, res) => {
  try {
    res.json({ success: true, ...(await _state()) });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.put('/ai-settings', async (req, res) => {
  try {
    const list = (req.body || {}).agents;
    if (!Array.isArray(list) || !list.length) return res.status(400).json({ success: false, error: I18N.t('the ladder needs a step') });
    AGENTS.setLadder(list);
    res.json({ success: true, ...(await _state()) });
  } catch (e) {
    res.status(400).json({ success: false, error: e.message });
  }
});

module.exports = router;
