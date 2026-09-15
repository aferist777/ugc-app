'use strict';

const express = require('express');
const path    = require('path');
const fs      = require('fs');
const router  = express.Router();

const { LOOKBOOKS_DIR, ENVIRONMENTS_DIR } = require('../lib/config');
const { toUrl } = require('../lib/media');

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

module.exports = router;
