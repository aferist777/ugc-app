'use strict';

const express = require('express');
const fs      = require('fs');
const path    = require('path');
const axios   = require('axios');
const router  = express.Router();

const { KIE_BASE, LOGS_DIR, LOG_FILE, UPLOADS_DIR } = require('../lib/config');
const { kieHeaders, uploadToPublicHost, createThumbnail } = require('../lib/helpers');

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

// ── Restart server ────────────────────────────────────────────────────────────
router.post('/restart', (_req, res) => {
  res.json({ success: true });
  setTimeout(() => process.exit(0), 300);
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

// ── Upload face blob → server path ───────────────────────────────────────────
router.post('/upload-face', async (req, res) => {
  const { imageBase64 } = req.body;
  if (!imageBase64) return res.status(400).json({ success: false, error: 'Нет imageBase64' });
  try {
    const filename  = `face_${Date.now()}.jpg`;
    const filePath  = path.join(UPLOADS_DIR, filename);
    const thumbPath = path.join(UPLOADS_DIR, 'thumbs', filename.replace(/\.[^.]+$/, '') + '.jpg');
    fs.writeFileSync(filePath, Buffer.from(imageBase64, 'base64'));
    await createThumbnail(filePath, thumbPath);
    res.json({ success: true, imagePath: `/uploads/${filename}` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Test tab helpers ──────────────────────────────────────────────────────────

// Upload a base64 image to the public host and return its URL
router.post('/test/upload-b64', async (req, res) => {
  const { imageBase64 } = req.body;
  if (!imageBase64) return res.status(400).json({ success: false, error: 'Нет imageBase64' });
  try {
    const buf = Buffer.from(imageBase64, 'base64');
    const url = await uploadToPublicHost(buf);
    res.json({ success: true, url });
  } catch (err) {
    res.status(502).json({ success: false, error: err.message });
  }
});

// Forward a raw kie.ai task payload and return the response as-is
router.post('/test/task', async (req, res) => {
  try {
    const r = await axios.post(
      `${KIE_BASE}/api/v1/jobs/createTask`,
      req.body,
      { headers: kieHeaders(), timeout: 30000 }
    );
    res.json(r.data);
  } catch (err) {
    console.error('[test/task]', err.response?.data || err.message);
    res.status(502).json({ success: false, error: err.response?.data?.msg || err.message });
  }
});

module.exports = router;
