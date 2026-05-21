'use strict';

const express = require('express');
const path    = require('path');
const fs      = require('fs');
const router  = express.Router();

const { CHARACTERS_DIR, LOOKBOOKS_DIR, ENVIRONMENTS_DIR, GALLERY_MAP } = require('../lib/config');
const { createThumbnail } = require('../lib/helpers');

function thumbPath(dir, file) {
  return path.join(dir, 'thumbs', file.replace(/\.[^.]+$/, '') + '.jpg');
}

function listImages(dir, urlPrefix) {
  return fs.readdirSync(dir)
    .filter(f => /\.(jpg|jpeg|png)$/i.test(f))
    .map(f => ({ file: f, mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)
    .map(({ file }) => {
      const tp = thumbPath(dir, file);
      const thumbName = file.replace(/\.[^.]+$/, '') + '.jpg';
      return {
        path:      `${urlPrefix}/${file}`,
        thumbPath: fs.existsSync(tp) ? `${urlPrefix}/thumbs/${thumbName}` : `${urlPrefix}/${file}`,
        name:      file.replace(/\.[^.]+$/, ''),
      };
    });
}

// ── Gallery lists ─────────────────────────────────────────────────────────────
router.get('/gallery/characters', (_req, res) => {
  // Exclude auto-generated pose variations — only manually saved characters ("Сейв перса")
  const files = listImages(CHARACTERS_DIR, '/characters').filter(f => !f.name.startsWith('posevar_'));
  res.json({ success: true, files });
});
router.get('/gallery/lookbooks',    (_req, res) => res.json({ success: true, files: listImages(LOOKBOOKS_DIR,    '/lookbooks') }));
router.get('/gallery/environments', (_req, res) => res.json({ success: true, files: listImages(ENVIRONMENTS_DIR, '/environments') }));

// ── Delete from gallery — permanent unlink, no archive ───────────────────────
// Route name kept as /gallery/archive for backward compat with existing UI
// callers, but the behaviour is now: file + thumb get removed from disk
// immediately. Previously this moved files into archive/<sub>/. The Library
// archive panel and Restore flow were removed at the same time — saving disk
// space matters more than recoverable trash for the partner-test workflow.
router.post('/gallery/archive', (req, res) => {
  const { filePath } = req.body;
  if (!filePath) return res.status(400).json({ success: false, error: 'Нет пути' });
  const parts = filePath.replace(/^\//, '').split('/');
  const map = GALLERY_MAP[parts[0]];
  if (!map || !parts[1]) return res.status(400).json({ success: false, error: 'Неверный путь' });
  const src   = path.join(map.dir, parts[1]);
  if (!fs.existsSync(src)) return res.status(404).json({ success: false, error: 'Файл не найден' });
  fs.unlinkSync(src);
  const srcThumb = thumbPath(map.dir, parts[1]);
  if (fs.existsSync(srcThumb)) fs.unlinkSync(srcThumb);
  res.json({ success: true });
});

module.exports = router;
