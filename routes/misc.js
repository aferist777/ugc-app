'use strict';

const express = require('express');
const fs      = require('fs');
const axios   = require('axios');
const router  = express.Router();

const { KIE_BASE, LOGS_DIR, LOG_FILE } = require('../lib/config');
const { kieHeaders } = require('../lib/helpers');

// ── Balance ───────────────────────────────────────────────────────────────────
router.get('/balance', async (_req, res) => {
  try {
    const r       = await axios.get(`${KIE_BASE}/api/v1/chat/credit`, { headers: kieHeaders(), timeout: 10000 });
    const credits = r.data?.data ?? 0;
    const dollars = Math.round((credits / 8) * 0.04 * 100) / 100;
    res.json({ success: true, credits, dollars });
  } catch (err) {
    res.status(502).json({ success: false, error: err.message });
  }
});

// ── Generation log ────────────────────────────────────────────────────────────
router.post('/log/entry', (req, res) => {
  const { type, mediaUrl, creditsBefore, creditsAfter } = req.body;
  if (!type || !mediaUrl) return res.status(400).json({ success: false, error: 'Неверные данные' });
  const cost     = (creditsBefore != null && creditsAfter != null) ? ` | -${(creditsBefore - creditsAfter).toFixed(2)} кр.` : '';
  const ts       = new Date().toLocaleString('ru-RU');
  const line     = `[${ts}] ${type} | ${mediaUrl}${cost}\n`;
  const existing = fs.existsSync(LOG_FILE) ? fs.readFileSync(LOG_FILE, 'utf8') : '';
  fs.writeFileSync(LOG_FILE, line + existing, 'utf8');
  res.json({ success: true });
});

router.get('/log', (_req, res) => {
  if (!fs.existsSync(LOG_FILE)) return res.json({ success: true, entries: [] });
  const entries = fs.readFileSync(LOG_FILE, 'utf8').split('\n').filter(l => l.trim());
  res.json({ success: true, entries });
});

module.exports = router;
