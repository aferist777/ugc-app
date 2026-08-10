'use strict';

// Server-side persistence for the Hooks archive. Mirrors the localStorage key
// `hooks_archive_v1` (used by scen-hooks.js) into data/hooks-archive.json so
// the hooks metadata can be exported, imported, and survives cache wipes.
// Architecture mirrors routes/biroly.js — the client owns the source of truth
// in LS, a tiny background script periodically pushes the snapshot here, and
// data-io.js packs/restores this file as part of the "hooks" Import/Export
// category. Also exposes a one-shot cleanup endpoint that deletes orphan
// hook files on disk (files in hooks/ that aren't referenced by any LS entry).

const express = require('express');
const fs      = require('fs');
const path    = require('path');
const router  = express.Router();

const { DATA_DIR, HOOKS_DIR, HOOKS_THUMB_DIR } = require('../lib/config');
const HOOKS_FILE = path.join(DATA_DIR, 'hooks-archive.json');

function _load() {
  try { return JSON.parse(fs.readFileSync(HOOKS_FILE, 'utf8')); }
  catch { return []; }
}
function _save(list) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(HOOKS_FILE, JSON.stringify(list, null, 2), 'utf8');
}

router.get('/hooks/state', (_req, res) => {
  res.json({ success: true, list: _load() });
});

router.post('/hooks/state', (req, res) => {
  const { list } = req.body || {};
  if (!Array.isArray(list)) return res.status(400).json({ success: false, error: 'list:array required' });
  try {
    _save(list);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── POST /api/hooks/clean-orphans ───────────────────────────────────────────
// Body: { keepFilenames: string[] } — list of hook filenames the client wants
// to preserve. Anything in HOOKS_DIR not in that set is deleted. Skips the
// thumbs/ subdir; matching thumb_<basename>.jpg is also removed.
router.post('/hooks/clean-orphans', (req, res) => {
  const keep = Array.isArray(req.body?.keepFilenames) ? new Set(req.body.keepFilenames) : null;
  if (!keep) return res.status(400).json({ success: false, error: 'keepFilenames:array required' });
  let removed = 0;
  try {
    for (const f of fs.readdirSync(HOOKS_DIR)) {
      if (f === 'thumbs') continue;
      if (keep.has(f)) continue;
      const abs = path.join(HOOKS_DIR, f);
      try {
        const st = fs.statSync(abs);
        if (st.isDirectory()) continue;
        fs.unlinkSync(abs);
        removed++;
      } catch {}
      const thumb = path.join(HOOKS_THUMB_DIR, path.basename(f, path.extname(f)) + '_thumb.jpg');
      if (fs.existsSync(thumb)) { try { fs.unlinkSync(thumb); } catch {} }
    }
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
  console.log(`[hooks-cleanup] removed ${removed} orphan hook files`);
  res.json({ success: true, removed });
});

module.exports = router;
