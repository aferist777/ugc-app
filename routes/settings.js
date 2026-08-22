'use strict';

const express = require('express');
const fs      = require('fs');
const path    = require('path');
const router  = express.Router();

const SETTINGS_FILE = path.join(__dirname, '..', 'data', 'settings.json');

// Fields that hold live credentials. Their VALUES must never be sent to the browser — the
// page only needs to know a key is set and show a masked hint. The server reads the real
// values straight off disk on every request path (audio.js, video-engines.js, helpers.js,
// …), so redacting the HTTP view changes no behaviour. This is the companion to the app-wide
// login gate in lib/access-gate.js: even a signed-in browser never receives a raw key, so a
// leaked screen-share, a browser extension, or a future open endpoint can't hand them out.
const SECRET_KEYS = [
  'kieApiKey', 'replicateApiKey', 'imgbbApiKey',
  'elevenLabsApiKey', 'groqApiKey', 'openRouterApiKey',
];

function loadSettings() {
  try { return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')); }
  catch { return { imageEngine: 'nano-banana-2' }; }
}

function saveSettings(obj) {
  const dir = path.dirname(SETTINGS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(obj, null, 2), 'utf8');
}

function maskPreview(v) {
  const s = String(v || '');
  if (!s) return '';
  if (s.length <= 8) return '••••';
  return s.slice(0, 4) + '…' + s.slice(-4);
}

// A browser-safe projection: every non-secret field verbatim, and for each secret only
// whether it is set (secretsSet) plus a masked hint (secretsPreview) — never the value.
function safeView(s) {
  const settings = { ...s };
  const secretsSet = {};
  const secretsPreview = {};
  for (const k of SECRET_KEYS) {
    secretsSet[k]     = !!(s[k] && String(s[k]).trim());
    secretsPreview[k] = maskPreview(s[k]);
    delete settings[k];
  }
  return { success: true, settings, secretsSet, secretsPreview };
}

// A masked hint that safeView produced must never be written back as if it were a real key:
// a client that echoed the field would otherwise overwrite the stored secret with dots.
function looksMasked(v) {
  const s = String(v || '');
  return s.includes('…') || /^[•·*]+/.test(s);
}

router.get('/settings', (_req, res) => {
  res.json(safeView(loadSettings()));
});

// The eye-reveal in the Brain popup: hand back ONE secret's real value on explicit request.
// This sits behind the app-wide login gate (server.js), so only a signed-in browser reaches it,
// and the value leaves the server only on this click — never with GET /settings.
router.get('/settings/reveal', (req, res) => {
  const key = String(req.query.key || '');
  if (!SECRET_KEYS.includes(key)) return res.status(400).json({ success: false, error: 'unknown key' });
  res.json({ success: true, key, value: String(loadSettings()[key] || '') });
});

router.post('/settings', (req, res) => {
  try {
    const current  = loadSettings();
    const incoming = (req.body && typeof req.body === 'object') ? req.body : {};
    const clean = {};
    for (const [k, v] of Object.entries(incoming)) {
      if (SECRET_KEYS.includes(k) && looksMasked(v)) continue; // ignore echoed masks
      clean[k] = v;
    }
    const updated = { ...current, ...clean };
    saveSettings(updated);
    res.json(safeView(updated));
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
