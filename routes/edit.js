/* ═══════════════════════════════════════════════════════════════════════════
   routes/edit.js — Edit v2 maintenance endpoints.

   DELETE /api/edit/session-files  body: { paths: ["/uploads/…", "/finals/…"] }
   Deletes a project's generated files. ONLY /uploads/* and /finals/* are
   touched — library dirs (obrazy, details, characters, …) are never deleted,
   even if a stray path is passed. Includes a path-escape guard. Returns count.
   ═══════════════════════════════════════════════════════════════════════════ */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { UPLOADS_DIR, FINALS_DIR } = require('../lib/config');

function _resolveSafe(url) {
  if (typeof url !== 'string') return null;
  let base, rest;
  if (url.startsWith('/uploads/'))      { base = UPLOADS_DIR; rest = url.slice('/uploads/'.length); }
  else if (url.startsWith('/finals/'))  { base = FINALS_DIR;  rest = url.slice('/finals/'.length); }
  else return null;
  const root = path.resolve(base);
  const abs  = path.resolve(root, rest);
  if (abs !== root && !abs.startsWith(root + path.sep)) return null; // escape guard
  return abs;
}

router.delete('/edit/session-files', (req, res) => {
  const { paths } = req.body || {};
  if (!Array.isArray(paths)) return res.json({ success: false, error: 'paths[] required' });
  let deleted = 0;
  for (const url of paths) {
    const abs = _resolveSafe(url);
    if (!abs) continue;
    try { if (fs.existsSync(abs) && fs.statSync(abs).isFile()) { fs.unlinkSync(abs); deleted++; } } catch {}
  }
  res.json({ success: true, deleted });
});

module.exports = router;
