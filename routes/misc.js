'use strict';

const express = require('express');
const fs      = require('fs');
const path    = require('path');
const axios   = require('axios');
const router  = express.Router();

const {
  KIE_BASE, LOGS_DIR, LOG_FILE,
  UPLOADS_DIR, CHARACTERS_DIR, LOOKBOOKS_DIR, ENVIRONMENTS_DIR,
  DETAILS_DIR, REFS_DIR, SCENES_DIR, HOOKS_DIR, FINALS_DIR,
  ARCHIVE_DIR, ARCHIVE_SUBDIRS,
} = require('../lib/config');
const { kieHeaders, uploadToPublicHost, createThumbnail, generateMissingThumbs } = require('../lib/helpers');

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

// ── Sync media: scan project folders, generate missing thumbnails, report counts ─
// Used after manually dropping files into media dirs so galleries pick them up
// with proper thumbnails on next load. Galleries themselves already read FS
// directly (see routes/gallery.js listImages), so the file appearing is automatic;
// this endpoint just ensures thumbnails exist for them.
router.post('/sync', async (_req, res) => {
  const IMG_RE = /\.(jpg|jpeg|png|webp)$/i;
  const VID_RE = /\.(mp4|webm|mov|mkv)$/i;

  function countFiles(dir, re) {
    if (!fs.existsSync(dir)) return 0;
    try { return fs.readdirSync(dir).filter(f => re.test(f)).length; }
    catch { return 0; }
  }
  function countThumbs(dir) {
    const t = path.join(dir, 'thumbs');
    if (!fs.existsSync(t)) return 0;
    try { return fs.readdirSync(t).filter(f => IMG_RE.test(f)).length; }
    catch { return 0; }
  }

  const archiveDirs = ARCHIVE_SUBDIRS.map(s => path.join(ARCHIVE_DIR, s));
  const imageDirs = [
    CHARACTERS_DIR, LOOKBOOKS_DIR, ENVIRONMENTS_DIR,
    UPLOADS_DIR, DETAILS_DIR, REFS_DIR, SCENES_DIR,
    ...archiveDirs,
  ];

  const results = {};
  for (const d of imageDirs) {
    const name   = path.basename(d);
    const parent = path.basename(path.dirname(d));
    const key    = parent === 'archive' ? `archive/${name}` : name;
    const files  = countFiles(d, IMG_RE);
    const thumbsBefore = countThumbs(d);
    results[key] = { files, thumbsBefore };
  }
  results.hooks  = { files: countFiles(HOOKS_DIR,  VID_RE) };
  results.finals = { files: countFiles(FINALS_DIR, VID_RE) };

  try {
    await generateMissingThumbs(imageDirs);
  } catch (e) {
    console.warn('[sync] generateMissingThumbs error:', e.message);
  }

  let newThumbsTotal = 0;
  for (const d of imageDirs) {
    const name   = path.basename(d);
    const parent = path.basename(path.dirname(d));
    const key    = parent === 'archive' ? `archive/${name}` : name;
    const after  = countThumbs(d);
    const created = Math.max(0, after - (results[key].thumbsBefore || 0));
    results[key].newThumbs = created;
    delete results[key].thumbsBefore;
    newThumbsTotal += created;
  }

  console.log(`[sync] complete: ${newThumbsTotal} new thumbnails created`);
  res.json({ success: true, newThumbsTotal, results });
});

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
