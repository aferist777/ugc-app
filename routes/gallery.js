'use strict';

const express = require('express');
const path    = require('path');
const fs      = require('fs');
const router  = express.Router();

const { CHARACTERS_DIR, LOOKBOOKS_DIR, ENVIRONMENTS_DIR } = require('../lib/config');
const { toDisk, toUrl } = require('../lib/media');
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
router.get('/gallery/lookbooks',    (_req, res) => res.json({ success: true, files: listImages(LOOKBOOKS_DIR,    toUrl(LOOKBOOKS_DIR)) }));
router.get('/gallery/environments', (_req, res) => res.json({ success: true, files: listImages(ENVIRONMENTS_DIR, toUrl(ENVIRONMENTS_DIR)) }));

// ── Delete from gallery — permanent unlink, no archive ───────────────────────
// Route name kept as /gallery/archive for backward compat with existing UI
// callers, but the behaviour is now: file + thumb get removed from disk
// immediately. Previously this moved files into archive/<sub>/. The Library
// archive panel and Restore flow were removed at the same time — saving disk
// space matters more than recoverable trash for the partner-test workflow.
router.post('/gallery/archive', (req, res) => {
  const { filePath } = req.body;
  if (!filePath) return res.status(400).json({ success: false, error: 'Нет пути' });
  // A picture straight inside one of the three shelves, never anything deeper or elsewhere.
  const src = toDisk(filePath);
  const dir = src && [CHARACTERS_DIR, LOOKBOOKS_DIR, ENVIRONMENTS_DIR].find((d) => path.dirname(src) === path.resolve(d));
  if (!dir) return res.status(400).json({ success: false, error: 'Неверный путь' });
  if (!fs.existsSync(src)) return res.status(404).json({ success: false, error: 'Файл не найден' });
  fs.unlinkSync(src);
  const srcThumb = thumbPath(dir, path.basename(src));
  if (fs.existsSync(srcThumb)) fs.unlinkSync(srcThumb);
  res.json({ success: true });
});

module.exports = router;
