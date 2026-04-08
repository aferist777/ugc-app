'use strict';

const express = require('express');
const path    = require('path');
const fs      = require('fs');
const router  = express.Router();

const { CHARACTERS_DIR, LOOKBOOKS_DIR, ENVIRONMENTS_DIR,
        ARCHIVE_DIR, ARCHIVE_SUBDIRS, GALLERY_MAP } = require('../lib/config');

function listImages(dir, urlPrefix) {
  return fs.readdirSync(dir)
    .filter(f => /\.(jpg|jpeg|png)$/i.test(f))
    .map(f => ({ file: f, mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)
    .map(({ file }) => ({ path: `${urlPrefix}/${file}`, name: file.replace(/\.[^.]+$/, '') }));
}

// ── Gallery lists ─────────────────────────────────────────────────────────────
router.get('/gallery/characters',   (_req, res) => res.json({ success: true, files: listImages(CHARACTERS_DIR,   '/characters') }));
router.get('/gallery/lookbooks',    (_req, res) => res.json({ success: true, files: listImages(LOOKBOOKS_DIR,    '/lookbooks') }));
router.get('/gallery/environments', (_req, res) => res.json({ success: true, files: listImages(ENVIRONMENTS_DIR, '/environments') }));

// ── Archive list by subfolder ─────────────────────────────────────────────────
router.get('/archive/:subfolder', (req, res) => {
  const { subfolder } = req.params;
  if (!ARCHIVE_SUBDIRS.includes(subfolder))
    return res.status(400).json({ success: false, error: 'Unknown subfolder' });
  res.json({ success: true, files: listImages(path.join(ARCHIVE_DIR, subfolder), `/archive/${subfolder}`) });
});

// ── Move to archive ───────────────────────────────────────────────────────────
router.post('/gallery/archive', (req, res) => {
  const { filePath } = req.body;
  if (!filePath) return res.status(400).json({ success: false, error: 'Нет пути' });
  const parts = filePath.replace(/^\//, '').split('/');
  const map = GALLERY_MAP[parts[0]];
  if (!map || !parts[1]) return res.status(400).json({ success: false, error: 'Неверный путь' });
  const src  = path.join(map.dir, parts[1]);
  const dest = path.join(ARCHIVE_DIR, map.archiveSub, parts[1]);
  if (!fs.existsSync(src)) return res.status(404).json({ success: false, error: 'Файл не найден' });
  fs.renameSync(src, dest);
  res.json({ success: true });
});

// ── Restore from archive ──────────────────────────────────────────────────────
router.post('/gallery/restore', (req, res) => {
  const { filePath } = req.body;
  if (!filePath) return res.status(400).json({ success: false, error: 'Нет пути' });
  const parts = filePath.replace(/^\//, '').split('/'); // ['archive','character','foo.jpg']
  const entry = Object.values(GALLERY_MAP).find(v => v.archiveSub === parts[1]);
  if (!entry || !parts[2]) return res.status(400).json({ success: false, error: 'Неверный путь' });
  const src  = path.join(ARCHIVE_DIR, parts[1], parts[2]);
  const dest = path.join(entry.dir, parts[2]);
  if (!fs.existsSync(src)) return res.status(404).json({ success: false, error: 'Файл не найден' });
  fs.renameSync(src, dest);
  res.json({ success: true });
});

// ── Permanent delete from archive ────────────────────────────────────────────
router.delete('/archive/delete', (req, res) => {
  const { filePath } = req.body;
  if (!filePath) return res.status(400).json({ success: false, error: 'Нет пути' });
  const parts = filePath.replace(/^\//, '').split('/');
  if (parts[0] !== 'archive' || parts.length !== 3)
    return res.status(400).json({ success: false, error: 'Неверный путь' });
  const absPath = path.join(ARCHIVE_DIR, parts[1], parts[2]);
  if (!fs.existsSync(absPath)) return res.status(404).json({ success: false, error: 'Файл не найден' });
  fs.unlinkSync(absPath);
  res.json({ success: true });
});

module.exports = router;
