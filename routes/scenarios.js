'use strict';

const express = require('express');
const path    = require('path');
const fs      = require('fs');
const axios   = require('axios');
const router  = express.Router();

const { SCENARIOS_DIR, DETAILS_DIR } = require('../lib/config');
const { createThumbnail } = require('../lib/helpers');

const ASSIGNMENTS_FILE = path.join(SCENARIOS_DIR, '_assignments.json');

function loadAssignments() {
  if (!fs.existsSync(ASSIGNMENTS_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(ASSIGNMENTS_FILE, 'utf8')); } catch { return {}; }
}

// ── Details ───────────────────────────────────────────────────────────────────
router.post('/details/upload', async (req, res) => {
  const { imageBase64, imageUrl, name } = req.body;
  if (!imageBase64 && !imageUrl) return res.status(400).json({ success: false, error: 'Нет данных' });
  const safeName = (name || '').trim().replace(/[^a-zA-Zа-яА-ЯёЁ0-9_\- ]/g, '').trim() || `detail_${Date.now()}`;
  const filename = `${safeName}.jpg`;
  const destPath = path.join(DETAILS_DIR, filename);
  try {
    if (imageBase64) {
      fs.writeFileSync(destPath, Buffer.from(imageBase64, 'base64'));
    } else {
      const resp = await axios({ method: 'GET', url: imageUrl, responseType: 'arraybuffer', timeout: 15000 });
      fs.writeFileSync(destPath, Buffer.from(resp.data));
    }
    const tp = path.join(DETAILS_DIR, 'thumbs', filename);
    createThumbnail(destPath, tp).catch(e => console.warn('[thumb]', e.message));
    res.json({ success: true, filename, name: safeName });
  } catch (err) {
    res.status(502).json({ success: false, error: err.message });
  }
});

router.get('/details', (_req, res) => {
  const files = fs.readdirSync(DETAILS_DIR)
    .filter(f => /\.(jpg|jpeg|png)$/i.test(f))
    .map(f => {
      const thumbName = f.replace(/\.[^.]+$/, '') + '.jpg';
      const tp = path.join(DETAILS_DIR, 'thumbs', thumbName);
      return {
        file:      f,
        name:      f.replace(/\.[^.]+$/, ''),
        path:      `/details/${f}`,
        thumbPath: fs.existsSync(tp) ? `/details/thumbs/${thumbName}` : `/details/${f}`,
        mtime:     fs.statSync(path.join(DETAILS_DIR, f)).mtimeMs,
      };
    })
    .sort((a, b) => b.mtime - a.mtime);
  res.json({ success: true, files });
});

// ── Scenario assignments (must be before /:filename) ─────────────────────────
router.get('/scenarios/assignments', (_req, res) => {
  res.json({ success: true, assignments: loadAssignments() });
});

router.post('/scenarios/assignments', (req, res) => {
  const { assignments } = req.body;
  if (!assignments || typeof assignments !== 'object')
    return res.status(400).json({ success: false, error: 'Неверные данные' });
  fs.writeFileSync(ASSIGNMENTS_FILE, JSON.stringify(assignments, null, 2), 'utf8');
  res.json({ success: true });
});

// ── Scenarios ─────────────────────────────────────────────────────────────────
router.post('/scenarios/upload', (req, res) => {
  const { textBase64, name } = req.body;
  if (!textBase64) return res.status(400).json({ success: false, error: 'Нет данных' });
  const text      = Buffer.from(textBase64, 'base64').toString('utf8');
  const safeName  = (name || '').trim().replace(/[^a-zA-Zа-яА-ЯёЁ0-9_\- ]/g, '').trim() || `Сценарий_${Date.now()}`;
  const filename  = `${safeName}.txt`;
  fs.writeFileSync(path.join(SCENARIOS_DIR, filename), text, 'utf8');
  res.json({ success: true, filename, name: safeName });
});

router.delete('/scenarios/delete', (req, res) => {
  const { filename } = req.body;
  if (!filename) return res.status(400).json({ success: false, error: 'Нет имени файла' });
  const safe = path.basename(filename);
  if (!safe.endsWith('.txt')) return res.status(400).json({ success: false, error: 'Неверный файл' });
  const fp = path.join(SCENARIOS_DIR, safe);
  if (!fs.existsSync(fp)) return res.status(404).json({ success: false, error: 'Не найден' });
  fs.unlinkSync(fp);
  res.json({ success: true });
});

router.get('/scenarios', (_req, res) => {
  const files = fs.readdirSync(SCENARIOS_DIR)
    .filter(f => f.endsWith('.txt') && f !== '_assignments.json')
    .map(f => ({ file: f, name: f.replace(/\.txt$/, ''), mtime: fs.statSync(path.join(SCENARIOS_DIR, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  res.json({ success: true, files });
});

router.get('/scenarios/:filename', (req, res) => {
  const filename = path.basename(req.params.filename);
  if (!filename.endsWith('.txt')) return res.status(400).json({ success: false, error: 'Неверный файл' });
  const fp = path.join(SCENARIOS_DIR, filename);
  if (!fs.existsSync(fp)) return res.status(404).json({ success: false, error: 'Не найден' });
  const lines = fs.readFileSync(fp, 'utf8').split('\n').filter(l => l.trim());
  res.json({ success: true, lines });
});

module.exports = router;
