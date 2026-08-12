'use strict';

const express = require('express');
const fs      = require('fs');
const path    = require('path');
const axios   = require('axios');
const router  = express.Router();

const { KIE_BASE, LOGS_DIR, LOG_FILE, UPLOADS_DIR, TEMP_PUBLIC_DIR } = require('../lib/config');
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

// ── Public host — own-server replacement for tmpfiles.org and friends ───────
// Saves an uploaded buffer to TEMP_PUBLIC_DIR and returns an absolute public
// URL that kie.ai (or any external puller) can fetch. PUBLIC_HOST_URL env var
// is the externally-reachable base (e.g. http://203.0.113.10:3000 on prod);
// when unset we fall back to req.protocol + Host header (works for local dev
// but won't be reachable from outside).
// Body: { imageBase64, ext? }
router.post('/public-host', (req, res) => {
  const { imageBase64, ext = 'jpg' } = req.body || {};
  if (!imageBase64) return res.json({ success: false, error: 'imageBase64 is required' });
  try {
    if (!fs.existsSync(TEMP_PUBLIC_DIR)) fs.mkdirSync(TEMP_PUBLIC_DIR, { recursive: true });
    const safeExt = String(ext).replace(/[^a-z0-9]/gi, '').slice(0, 4) || 'jpg';
    const name    = `pub_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${safeExt}`;
    const abs     = path.join(TEMP_PUBLIC_DIR, name);
    fs.writeFileSync(abs, Buffer.from(imageBase64, 'base64'));
    const base = (process.env.PUBLIC_HOST_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
    res.json({ success: true, url: `${base}/temp_public/${name}` });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

// One-shot cleanup of /temp_public/ — files older than CLEANUP_TTL_MS are
// unlinked. Runs every hour. Files are intentionally short-lived: kie.ai
// downloads them within seconds of upload, then they're useless.
const _PUBLIC_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
function _cleanupTempPublic() {
  if (!fs.existsSync(TEMP_PUBLIC_DIR)) return;
  try {
    const now = Date.now();
    const files = fs.readdirSync(TEMP_PUBLIC_DIR);
    let removed = 0;
    for (const f of files) {
      const abs = path.join(TEMP_PUBLIC_DIR, f);
      try {
        const st = fs.statSync(abs);
        if (now - st.mtimeMs > _PUBLIC_TTL_MS) { fs.unlinkSync(abs); removed++; }
      } catch {}
    }
    if (removed) console.log(`[temp_public] cleaned up ${removed} expired file(s)`);
  } catch (e) { console.warn('[temp_public] cleanup error:', e.message); }
}
setInterval(_cleanupTempPublic, 60 * 60 * 1000); // hourly
setTimeout(_cleanupTempPublic, 30 * 1000);      // first sweep 30s after boot

// ── Generation log ────────────────────────────────────────────────────────────
router.post('/log/entry', (req, res) => {
  const { type, mediaUrl, creditsBefore, creditsAfter } = req.body;
  if (!type || !mediaUrl) return res.status(400).json({ success: false, error: 'Неверные данные' });
  const costCredits = (creditsBefore != null && creditsAfter != null) ? creditsBefore - creditsAfter : null;
  const cost = costCredits != null
    ? ` | -${costCredits.toFixed(2)} кр. (-$${(costCredits / 8 * 0.04).toFixed(4)})`
    : '';
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

// ── Test tab helpers ──────────────────────────────────────────────────────────

// ── GET /api/recover-tasks ────────────────────────────────────────────────────
// Checks all pending tasks and recovers completed ones. Called by the frontend
// on page load (and can be triggered manually).
router.get('/recover-tasks', async (_req, res) => {
  try {
    const { resolveAll } = require('../lib/pending-tasks');
    const recovered = await resolveAll();
    res.json({ success: true, recovered: recovered.length, items: recovered });
  } catch (err) {
    console.error('[recover-tasks]', err.message);
    res.status(502).json({ success: false, error: err.message });
  }
});

module.exports = router;
