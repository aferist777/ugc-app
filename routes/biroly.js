'use strict';

// Server-side persistence for the Biroly tab. Mirrors three localStorage keys
// the browser uses (biroly_cats, biroly_slots_v2, biroly_archive_v1) into a
// single data/biroly.json so the data survives cache wipes, can be backed up,
// and can be transferred between instances via the Import/Export popup.
//
// Sync strategy is identical to data/obrazy.json: the client owns the source
// of truth in localStorage, but a tiny background script periodically pushes
// the current LS state here. On page load the client reads server state first
// and only falls back to its existing LS if the server has nothing.

const express = require('express');
const fs      = require('fs');
const path    = require('path');
const router  = express.Router();

const { DATA_DIR } = require('../lib/config');
const BIROLY_FILE  = path.join(DATA_DIR, 'biroly.json');

function _load() {
  try { return JSON.parse(fs.readFileSync(BIROLY_FILE, 'utf8')); }
  catch { return { cats: [], slots: {}, archive: [] }; }
}
function _save(state) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(BIROLY_FILE, JSON.stringify(state, null, 2), 'utf8');
}

router.get('/biroly/state', (_req, res) => {
  res.json({ success: true, state: _load() });
});

router.post('/biroly/state', (req, res) => {
  const { cats, slots, archive } = req.body || {};
  if (!Array.isArray(cats) || (slots && typeof slots !== 'object') || !Array.isArray(archive)) {
    return res.status(400).json({ success: false, error: 'cats:array, slots:object, archive:array required' });
  }
  try {
    _save({ cats, slots: slots || {}, archive });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;
