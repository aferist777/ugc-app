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
const { writeFileAtomic } = require('../lib/atomic-write');
const path    = require('path');
const router  = express.Router();

const { DATA_DIR, HOOKS_DIR, HOOKS_THUMB_DIR } = require('../lib/config');
const HOOK_IDS = require('../lib/hook-ids');
const HOOKS_FILE = path.join(DATA_DIR, 'hooks-archive.json');

// Every hook has a permanent number - H01, H02 - and it is what the render window puts in
// the creative's name. Given out here because this is where a hook first reaches the
// server, whichever page made it; see lib/hook-ids.js for why the numbers cannot live in
// the archive records themselves. Once at boot for whatever is already there.
try {
  const first = HOOK_IDS.sweep();
  const n = Object.keys(first).length;
  if (n) console.log(`[hooks] numbered ${n} hook${n === 1 ? '' : 's'}, latest ${Object.values(first).pop()}`);
} catch (e) { console.warn('[hooks] numbering failed:', e.message); }

function _load() {
  try { return JSON.parse(fs.readFileSync(HOOKS_FILE, 'utf8')); }
  catch { return []; }
}
function _save(list) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  writeFileAtomic(HOOKS_FILE, JSON.stringify(list, null, 2));
}

router.get('/hooks/state', (_req, res) => {
  res.json({ success: true, list: _load() });
});

// ── GET /api/hooks/ids ───────────────────────────────────────────────────────
// { "<clip path>": "H01" } for every hook that has been numbered. The Library grid reads
// it to put the number on the tile; the render window gets its one number from the
// timeline instead (routes/mergev3.js, /mv3/timeline/:key/source).
router.get('/hooks/ids', (_req, res) => {
  try { res.json({ success: true, ids: HOOK_IDS.map() }); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/hooks/state', (req, res) => {
  const { list } = req.body || {};
  if (!Array.isArray(list)) return res.status(400).json({ success: false, error: 'list:array required' });
  try {
    _save(list);
    // A hook that has just appeared gets its number now, so it is there before anyone can
    // drop the clip on a lane. Ones that have a number keep it, and a hook deleted from the
    // list keeps its number reserved - nothing is renumbered, ever.
    try { HOOK_IDS.sweep(); } catch (e) {}
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
