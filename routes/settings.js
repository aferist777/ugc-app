'use strict';

const express = require('express');
const fs      = require('fs');
const path    = require('path');
const router  = express.Router();

const SETTINGS_FILE = path.join(__dirname, '..', 'data', 'settings.json');

function loadSettings() {
  try { return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')); }
  catch { return { imageEngine: 'nano-banana-2' }; }
}

function saveSettings(obj) {
  const dir = path.dirname(SETTINGS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(obj, null, 2), 'utf8');
}

router.get('/settings', (req, res) => {
  res.json({ success: true, settings: loadSettings() });
});

router.post('/settings', (req, res) => {
  try {
    const current = loadSettings();
    const updated = { ...current, ...req.body };
    saveSettings(updated);
    res.json({ success: true, settings: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
