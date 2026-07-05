'use strict';
const express = require('express');
const fs      = require('fs');
const path    = require('path');
const router  = express.Router();
const DATA_DIR = path.join(__dirname, '..', 'data');

function _read(name, fallback = []) {
  try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, name + '.json'), 'utf8')); }
  catch { return fallback; }
}
function _write(name, value) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(path.join(DATA_DIR, name + '.json'), JSON.stringify(value, null, 2), 'utf8');
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
const MAX_VAL = 200000;   // skip oversized values (cache blobs don't belong here)
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
    for (const k of Object.keys(set)) {
      const v = set[k];
      if (typeof k !== 'string' || typeof v !== 'string' || v.length > MAX_VAL) continue;
      if (cur[k] !== v) { cur[k] = v; changed = true; }
    }
    for (const k of del) { if (typeof k === 'string' && (k in cur)) { delete cur[k]; changed = true; } }
    if (changed) _writeAtomic(UI_STATE, cur);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

module.exports = router;
