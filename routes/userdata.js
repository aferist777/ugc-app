'use strict';
const express = require('express');
const fs      = require('fs');
const { writeFileAtomic } = require('../lib/atomic-write');
const path    = require('path');
const router  = express.Router();
const DATA_DIR = require('../lib/config').DATA_DIR;

function _read(name, fallback = []) {
  try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, name + '.json'), 'utf8')); }
  catch { return fallback; }
}
function _write(name, value) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  writeFileAtomic(path.join(DATA_DIR, name + '.json'), JSON.stringify(value, null, 2));
}

router.get('/userdata/obrazy',   (_req, res) => res.json({ success: true, list: _read('obrazy') }));
router.get('/userdata/projects', (_req, res) => res.json({ success: true, list: _read('projects') }));

router.post('/userdata/obrazy', (req, res) => {
  const { list } = req.body;
  if (!Array.isArray(list)) return res.status(400).json({ success: false, error: 'list must be array' });
  try { _write('obrazy', list); res.json({ success: true }); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/userdata/projects', (req, res) => {
  const { list } = req.body;
  if (!Array.isArray(list)) return res.status(400).json({ success: false, error: 'list must be array' });
  try { _write('projects', list); res.json({ success: true }); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── Edit-tab sessions ───────────────────────────────────────────────────────
// Edit/Merge projects are NOT stored here. They live in data/edit-state.json via
// routes/edit.js (/api/edit-state), the single source of truth (version-polled by
// public/js/edit-sync.js). The old /api/userdata/edit-sessions mirror was removed
// to de-race session storage (it duplicated the data and caused reload loops).

// ── Geni history (array) ────────────────────────────────────────────────────
// Mirrors the localStorage key `all_geni_v1` (full generation history).
router.get('/userdata/geni', (_req, res) => {
  res.json({ success: true, value: _read('geni', []) });
});
router.post('/userdata/geni', (req, res) => {
  const { value } = req.body;
  if (!Array.isArray(value)) {
    return res.status(400).json({ success: false, error: 'value must be an array' });
  }
  try { _write('geni', value); res.json({ success: true }); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── Generic UI-state KV: server-backed mirror of localStorage ─────────────────
// Flat { key:string -> value:string }, same shape as localStorage. GET returns
// the whole blob; POST does a PER-KEY merge ({set:{...}, del:[...]}) so a stale
// tab can never clobber the whole store (data-incident lesson). Atomic write.
const UI_STATE = 'ui-state';
// 4MB, matching public/js/storage-sync.js. It was 200000 here AND there, and both sides
// dropped an oversized value in silence - so the saved Merge projects stopped being mirrored
// at 260KB and the server kept serving a 149KB copy as if it were current. The server is the
// source of truth for this app; a value being big is not a reason to quietly refuse it.
// Anything still over the line is logged and named in the response.
const MAX_VAL = 4000000;
function _writeAtomic(name, value) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const p = path.join(DATA_DIR, name + '.json'), tmp = p + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(tmp, p);
}
router.get('/ui-state', (_req, res) => {
  res.json({ success: true, state: _read(UI_STATE, {}) });
});
router.post('/ui-state', (req, res) => {
  try {
    const cur = _read(UI_STATE, {}) || {};
    const set = (req.body && req.body.set && typeof req.body.set === 'object') ? req.body.set : {};
    const del = (req.body && Array.isArray(req.body.del)) ? req.body.del : [];
    let changed = false;
    const skipped = [];
    for (const k of Object.keys(set)) {
      const v = set[k];
      if (typeof k !== 'string' || typeof v !== 'string') continue;
      if (v.length > MAX_VAL) {
        skipped.push({ key: k, kb: Math.round(v.length / 1024) });
        continue;
      }
      if (cur[k] !== v) { cur[k] = v; changed = true; }
    }
    for (const k of del) { if (typeof k === 'string' && (k in cur)) { delete cur[k]; changed = true; } }
    if (changed) _writeAtomic(UI_STATE, cur);
    if (skipped.length) {
      console.warn('[ui-state] NOT stored, over the ' + Math.round(MAX_VAL / 1024) + 'KB ceiling: '
        + skipped.map(s => s.key + ' (' + s.kb + 'KB)').join(', '));
    }
    res.json({ success: true, skipped });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

module.exports = router;
