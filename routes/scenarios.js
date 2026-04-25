'use strict';

const express = require('express');
const path    = require('path');
const fs      = require('fs');
const axios   = require('axios');
const router  = express.Router();

const { SCENARIOS_DIR, SCENARIOS_ARCHIVE_DIR, DETAILS_DIR,
        CHARACTERS_DIR, LOOKBOOKS_DIR, ENVIRONMENTS_DIR, SCENES_DIR, TEMP_DIR, UPLOADS_DIR,
      } = require('../lib/config');
const { createThumbnail, callAI, uploadToPublicHost } = require('../lib/helpers');
const { getPrompt } = require('../lib/prompts');

const ASSIGNMENTS_FILE  = path.join(SCENARIOS_DIR, '_assignments.json');
const DATA_DIR          = path.join(__dirname, '..', 'data');
const DETAILS_META_FILE = path.join(DATA_DIR, 'details-meta.json');

function loadAssignments() {
  if (!fs.existsSync(ASSIGNMENTS_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(ASSIGNMENTS_FILE, 'utf8')); } catch { return {}; }
}

function loadDetailsMeta() {
  if (!fs.existsSync(DETAILS_META_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(DETAILS_META_FILE, 'utf8')); } catch { return {}; }
}

function saveDetailsMeta(meta) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DETAILS_META_FILE, JSON.stringify(meta, null, 2), 'utf8');
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
  const meta = loadDetailsMeta();
  const files = fs.readdirSync(DETAILS_DIR)
    .filter(f => /\.(jpg|jpeg|png)$/i.test(f))
    .map(f => {
      const thumbName = f.replace(/\.[^.]+$/, '') + '.jpg';
      const tp = path.join(DETAILS_DIR, 'thumbs', thumbName);
      const m  = meta[f] || {};
      return {
        file:        f,
        name:        m.displayName || f.replace(/\.[^.]+$/, ''),
        size:        m.size        || '',
        description: m.description || '',
        path:        `/details/${f}`,
        thumbPath:   fs.existsSync(tp) ? `/details/thumbs/${thumbName}` : `/details/${f}`,
        mtime:       fs.statSync(path.join(DETAILS_DIR, f)).mtimeMs,
      };
    })
    .sort((a, b) => b.mtime - a.mtime);
  res.json({ success: true, files });
});

router.delete('/details/:filename', (req, res) => {
  const { filename } = req.params;
  const filePath = path.join(DETAILS_DIR, filename);
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    const thumbName = filename.replace(/\.[^.]+$/, '') + '.jpg';
    const thumbPath = path.join(DETAILS_DIR, 'thumbs', thumbName);
    if (fs.existsSync(thumbPath)) fs.unlinkSync(thumbPath);
    const meta = loadDetailsMeta();
    delete meta[filename];
    saveDetailsMeta(meta);

    // Cascade: remove matching entries from refs.json
    try {
      const { REFS_FILE } = require('../lib/config');
      if (fs.existsSync(REFS_FILE)) {
        const refs = JSON.parse(fs.readFileSync(REFS_FILE, 'utf8'));
        const filtered = refs.filter(r => r.detailFile !== filename);
        if (filtered.length !== refs.length)
          fs.writeFileSync(REFS_FILE, JSON.stringify(filtered, null, 2), 'utf8');
      }
    } catch (e) { console.warn('[details/delete cascade]', e.message); }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.patch('/details/meta/:filename', (req, res) => {
  const { filename } = req.params;
  const { displayName, size, description } = req.body;
  const meta = loadDetailsMeta();
  if (!meta[filename]) meta[filename] = {};
  if (displayName  !== undefined) meta[filename].displayName  = displayName;
  if (size         !== undefined) meta[filename].size         = size;
  if (description  !== undefined) meta[filename].description  = description;
  saveDetailsMeta(meta);
  res.json({ success: true });
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

// ── Rename scenario (renames file on disk, updates assignments keys) ──────────
router.patch('/scenarios/rename', (req, res) => {
  const { filename, newName } = req.body;
  if (!filename || !newName) return res.status(400).json({ success: false, error: 'Нет данных' });
  const safe = path.basename(filename);
  if (!safe.endsWith('.txt')) return res.status(400).json({ success: false, error: 'Неверный файл' });
  const src = path.join(SCENARIOS_DIR, safe);
  if (!fs.existsSync(src)) return res.status(404).json({ success: false, error: 'Не найден' });
  const safeName = newName.trim().replace(/[^a-zA-Zа-яА-ЯёЁ0-9_\- ]/g, '').trim();
  if (!safeName) return res.status(400).json({ success: false, error: 'Некорректное название' });
  let destName = `${safeName}.txt`;
  let dest = path.join(SCENARIOS_DIR, destName);
  if (path.resolve(dest) !== path.resolve(src) && fs.existsSync(dest)) {
    destName = `${safeName}_${Date.now()}.txt`;
    dest = path.join(SCENARIOS_DIR, destName);
  }
  fs.renameSync(src, dest);
  // Rekey assignments: replace all keys starting with old filename prefix
  try {
    const a = loadAssignments();
    const rekeyed = {};
    Object.entries(a).forEach(([k, v]) => {
      if (k.startsWith(safe + '__')) rekeyed[destName + '__' + k.slice(safe.length + 2)] = v;
      else rekeyed[k] = v;
    });
    fs.writeFileSync(ASSIGNMENTS_FILE, JSON.stringify(rekeyed, null, 2), 'utf8');
  } catch {}
  res.json({ success: true, filename: destName, name: safeName });
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

// Move scenario to archive (replaces hard-delete)
router.delete('/scenarios/delete', (req, res) => {
  const { filename } = req.body;
  if (!filename) return res.status(400).json({ success: false, error: 'Нет имени файла' });
  const safe = path.basename(filename);
  if (!safe.endsWith('.txt')) return res.status(400).json({ success: false, error: 'Неверный файл' });
  const src = path.join(SCENARIOS_DIR, safe);
  if (!fs.existsSync(src)) return res.status(404).json({ success: false, error: 'Не найден' });
  // Avoid overwriting existing archive entry — append timestamp if collision
  let destName = safe;
  let dest = path.join(SCENARIOS_ARCHIVE_DIR, destName);
  if (fs.existsSync(dest)) {
    destName = safe.replace(/\.txt$/, '') + '_' + Date.now() + '.txt';
    dest = path.join(SCENARIOS_ARCHIVE_DIR, destName);
  }
  fs.renameSync(src, dest);
  res.json({ success: true, archived: destName });
});

// List archived scenarios
router.get('/scenarios/archive', (_req, res) => {
  const files = fs.readdirSync(SCENARIOS_ARCHIVE_DIR)
    .filter(f => f.endsWith('.txt'))
    .map(f => ({ file: f, name: f.replace(/(_\d+)?\.txt$/, ''), mtime: fs.statSync(path.join(SCENARIOS_ARCHIVE_DIR, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  res.json({ success: true, files });
});

// Restore scenario from archive
router.post('/scenarios/restore', (req, res) => {
  const { filename } = req.body;
  if (!filename) return res.status(400).json({ success: false, error: 'Нет имени файла' });
  const safe = path.basename(filename);
  const src = path.join(SCENARIOS_ARCHIVE_DIR, safe);
  if (!fs.existsSync(src)) return res.status(404).json({ success: false, error: 'Не найден в архиве' });
  // Strip timestamp suffix added on conflict
  const origName = safe.replace(/_\d+\.txt$/, '.txt');
  let destName = origName;
  let dest = path.join(SCENARIOS_DIR, destName);
  if (fs.existsSync(dest)) {
    destName = origName.replace(/\.txt$/, '') + '_restored_' + Date.now() + '.txt';
    dest = path.join(SCENARIOS_DIR, destName);
  }
  fs.renameSync(src, dest);
  res.json({ success: true, restored: destName });
});

// Permanently delete from archive
router.delete('/scenarios/archive/purge', (req, res) => {
  const { filename } = req.body;
  if (!filename) return res.status(400).json({ success: false, error: 'Нет имени файла' });
  const safe = path.basename(filename);
  const fp = path.join(SCENARIOS_ARCHIVE_DIR, safe);
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

// ── Analyze образ + asset interaction (Gemini → 3 variants) ──────────────────
function urlToFilePath(urlPath) {
  if (!urlPath) return null;
  const s = urlPath.split('?')[0];
  const map = [
    ['/characters/',   CHARACTERS_DIR],
    ['/lookbooks/',    LOOKBOOKS_DIR],
    ['/environments/', ENVIRONMENTS_DIR],
    ['/details/',      DETAILS_DIR],
    ['/scenes/',       SCENES_DIR],
    ['/temp_files/',   TEMP_DIR],
    ['/uploads/',      UPLOADS_DIR],
  ];
  for (const [prefix, dir] of map) {
    if (s.startsWith(prefix)) return path.join(dir, s.slice(prefix.length));
  }
  return null;
}

router.post('/scenarios/analyze', async (req, res) => {
  const { activePath, assetPath, assetSize } = req.body;
  if (!activePath || !assetPath)
    return res.status(400).json({ success: false, error: 'Нет путей к изображениям' });

  const activeFile = urlToFilePath(activePath);
  const assetFile  = urlToFilePath(assetPath);
  if (!activeFile || !fs.existsSync(activeFile))
    return res.status(400).json({ success: false, error: 'Активное изображение не найдено' });
  if (!assetFile || !fs.existsSync(assetFile))
    return res.status(400).json({ success: false, error: 'Изображение предмета не найдено' });

  try {
    const [activeUrl, assetUrl] = await Promise.all([
      uploadToPublicHost(fs.readFileSync(activeFile)),
      uploadToPublicHost(fs.readFileSync(assetFile)),
    ]);

    const sizeClause   = (assetSize || '').trim() ? ` — real dimensions: ${assetSize.trim()} (use for accurate scale in each generated prompt; include the dimension figure in prompt text)` : '';
    const systemPrompt = getPrompt('SCENARIO_ANALYZE_PROMPT')
      .replace(/\{assetSizeClause\}/g, sizeClause);

    const rawText = await callAI([{
      role: 'user',
      content: [
        { type: 'text',      text: systemPrompt },
        { type: 'image_url', image_url: { url: activeUrl } },
        { type: 'image_url', image_url: { url: assetUrl  } },
      ],
    }], { timeout: 45000 });
    console.log('[scenarios/analyze] rawText:', rawText.slice(0, 400));
    const match   = rawText.match(/\[[\s\S]*\]/);
    let variants  = [];
    if (match) {
      try { variants = JSON.parse(match[0]); } catch (e) { console.warn('[scenarios/analyze] JSON parse error:', e.message, '| raw match:', match[0].slice(0, 200)); }
    } else {
      console.warn('[scenarios/analyze] no JSON array found in rawText');
    }
    variants = variants.filter(v => v?.label && v?.prompt).slice(0, 3);
    console.log('[scenarios/analyze] variants count:', variants.length);
    if (!variants.length) throw new Error('Gemini не вернул варианты');

    res.json({ success: true, variants });
  } catch (err) {
    console.error('[scenarios/analyze]', err.response?.data || err.message);
    res.status(502).json({ success: false, error: err.response?.data?.msg || err.message });
  }
});

module.exports = router;
