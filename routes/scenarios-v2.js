'use strict';

// ════════════════════════════════════════════════════════════════════════
// SCENARIOS V2 — self-contained scenario store (parallel to legacy v1).
// A v2 scenario owns everything: script lines (with per-line role + prop),
// roles bound to saved characters, and a prop pool. Generation reuses the
// existing /api/scenarios/ai/generate (type/mode/roles aware). Production
// (casting → projects) lands in later phases.
//   GET    /api/scenarios-v2/list      list (lightweight)
//   GET    /api/scenarios-v2/:id       full record
//   POST   /api/scenarios-v2           upsert (by id)
//   DELETE /api/scenarios-v2/:id       remove
// ════════════════════════════════════════════════════════════════════════

const express = require('express');
const fs      = require('fs');
const path    = require('path');
const router  = express.Router();

const { DATA_DIR } = require('../lib/config');
const FILE = path.join(DATA_DIR, 'scenarios-v2.json');

function _load() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return []; }
}
function _save(list) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(list, null, 2), 'utf8');
  fs.renameSync(tmp, FILE);
}

// Lightweight list — enough for the Saved cards without shipping every line.
router.get('/scenarios-v2/list', (_req, res) => {
  const list = _load();
  res.json({
    success: true,
    scenarios: list.map(s => ({
      id: s.id, title: s.title, type: s.type, mode: s.mode,
      roles: s.roles || [], sceneCount: (s.lines || []).length,
      product: s.product || '', createdAt: s.createdAt, updatedAt: s.updatedAt,
    })),
  });
});

router.get('/scenarios-v2/:id', (req, res) => {
  const s = _load().find(x => String(x.id) === String(req.params.id));
  if (!s) return res.status(404).json({ success: false, error: 'not found' });
  res.json({ success: true, scenario: s });
});

// Upsert by id (id supplied by the client so save = update; omitted = create).
router.post('/scenarios-v2', (req, res) => {
  try {
    const b = req.body || {};
    const list = _load();
    const now = new Date().toISOString();
    const id = b.id || Date.now();
    let rec = list.find(x => String(x.id) === String(id));
    if (rec) {
      Object.assign(rec, b, { id, updatedAt: now });
    } else {
      rec = { ...b, id, createdAt: now, updatedAt: now };
      list.unshift(rec);
    }
    _save(list);
    res.json({ success: true, scenario: rec });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.delete('/scenarios-v2/:id', (req, res) => {
  const list = _load().filter(x => String(x.id) !== String(req.params.id));
  _save(list);
  res.json({ success: true });
});

module.exports = router;
