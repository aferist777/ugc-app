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

// ── Edit-tab sessions (object map, keyed by sessionKey) ─────────────────────
// Mirrors the localStorage key `edit_frozen_sessions_v1` so all the user's
// talking-head / scenario / timeline work stored under Edit-tab survives a
// cache wipe and follows them across browsers/devices. Server-as-truth flow
// is driven by public/js/library-server-sync.js.
router.get('/userdata/edit-sessions', (_req, res) => {
  res.json({ success: true, value: _read('edit-sessions', {}) });
});
router.post('/userdata/edit-sessions', (req, res) => {
  const { value } = req.body;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return res.status(400).json({ success: false, error: 'value must be an object' });
  }
  try { _write('edit-sessions', value); res.json({ success: true }); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

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

module.exports = router;
