'use strict';

// The looks whose files are all gone (POST /obrazy/prune-missing). A look is deleted through
// DELETE /library/item/:kind/:id, which moves its files through lib/relocate.js; the old DELETE /obrazy/:id, which wiped the folder past it, went in phase C.

const express = require('express');
const fs      = require('fs');
const { writeFileAtomic } = require('../lib/atomic-write');
const path    = require('path');
const router  = express.Router();

const { ROOT_DIR, OBRAZY_FILE } = require('../lib/config');

// ── POST /api/obrazy/prune-missing ──────────────────────────────────────────
// Removes "orphan" obrazy whose image files are ALL missing on disk (left behind
// by deleted media) so they stop 404-ing in the Looks row. Conservative: an obraz is
// KEPT if ANY of its images (char or a variation) still exists on disk.
function _existsUnderRoot(url) {
  if (!url || typeof url !== 'string') return false;
  const rel  = url.split('?')[0].replace(/^\/+/, '');
  if (!rel) return false;
  const abs  = path.resolve(ROOT_DIR, rel);
  const root = path.resolve(ROOT_DIR);
  if (abs !== root && !abs.startsWith(root + path.sep)) return false;   // escape guard
  try { return fs.existsSync(abs) && fs.statSync(abs).isFile(); } catch { return false; }
}
function _obrazImageUrls(o) {
  const out = [];
  if (o && typeof o.char === 'string') out.push(o.char);
  if (o && Array.isArray(o.variations)) for (const v of o.variations) {
    if (v && v !== 'error' && typeof v === 'string') out.push(v);
  }
  return out;
}
router.post('/obrazy/prune-missing', (_req, res) => {
  try {
    // obrazy.json — drop entries with no surviving image file
    let obrazy = [];
    try { obrazy = JSON.parse(fs.readFileSync(OBRAZY_FILE, 'utf8')); } catch {}
    if (!Array.isArray(obrazy)) obrazy = [];
    const removedObrazy = [];
    const keptObrazy = obrazy.filter(o => {
      const hasImage = _obrazImageUrls(o).some(_existsUnderRoot);
      if (!hasImage) { removedObrazy.push({ id: o && o.id, name: (o && o.name) || '' }); return false; }
      return true;
    });
    if (removedObrazy.length) writeFileAtomic(OBRAZY_FILE, JSON.stringify(keptObrazy, null, 2));

    res.json({ success: true, removedObrazy, obrazy: keptObrazy });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;
