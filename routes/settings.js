'use strict';

const express = require('express');
const fs      = require('fs');
const { writeFileAtomic } = require('../lib/atomic-write');
const path    = require('path');
const router  = express.Router();

const SETTINGS_FILE = path.join(require('../lib/config').DATA_DIR, 'settings.json');

// Fields that hold live credentials. Their VALUES must never be sent to the browser — the
// page only needs to know a key is set and show a masked hint. The server reads the real
// values straight off disk on every request path (audio.js, video-engines.js, helpers.js,
// …), so redacting the HTTP view changes no behaviour. Even on one machine with one person a
// raw key in the page is a key in a screen-share or a browser extension's reach.
//
// r2SecretAccessKey is here; r2AccountId, r2AccessKeyId, r2Bucket and r2PublicBase are not.
// Those four are identifiers, not credentials - useless without the secret, and worth seeing at
// a glance to check which bucket an install is pointed at. Masking them would only hide whether
// the field is filled in correctly.
const SECRET_KEYS = [
  'kieApiKey', 'replicateApiKey',
  'elevenLabsApiKey', 'groqApiKey', 'openRouterApiKey',
  'r2SecretAccessKey',
];

// Keys of services this app no longer talks to: imgBB, and Partner's ingest. A library
// carried over from the server version still holds them, and they are not in SECRET_KEYS any
// more - so they are kept out of the page by name, and dropped from the file on the next save.
const RETIRED_KEYS = ['imgbbApiKey', 'partnerApiKey', 'partnerUrl'];

function loadSettings() {
  try { return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')); }
  catch { return { imageEngine: 'nano-banana-2' }; }
}

function saveSettings(obj) {
  const dir = path.dirname(SETTINGS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  writeFileAtomic(SETTINGS_FILE, JSON.stringify(obj, null, 2));
}

// The first six and the last four: enough to tell two keys apart, never enough to use one.
// Short values show less, so a mask can never be most of the key.
function maskPreview(v) {
  const s = String(v || '');
  if (!s) return '';
  if (s.length < 8) return '••••';
  if (s.length < 14) return s.slice(0, 2) + '…' + s.slice(-2);
  return s.slice(0, 6) + '…' + s.slice(-4);
}

// R2 is the one provider that can also be configured through the environment, because it was
// there before the popup had fields for it. A field left empty here is therefore ambiguous -
// unset, or covered by .env - so the view says which, and the popup can stop looking broken on
// an install that works. Only whether each is present; never the value.
const R2_ENV = {
  r2AccountId:       'R2_ACCOUNT_ID',
  r2AccessKeyId:     'R2_ACCESS_KEY_ID',
  r2SecretAccessKey: 'R2_SECRET_ACCESS_KEY',
  r2Bucket:          'R2_BUCKET',
  r2PublicBase:      'R2_PUBLIC_BASE',
};

function envFallback(s) {
  const out = {};
  for (const [field, envName] of Object.entries(R2_ENV)) {
    const stored = s[field] && String(s[field]).trim();
    out[field] = !stored && !!String(process.env[envName] || '').trim();
  }
  return out;
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
  for (const k of RETIRED_KEYS) delete settings[k];
  return { success: true, settings, secretsSet, secretsPreview, envFallback: envFallback(s) };
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

// There is no reveal. A key's full value never leaves the server through HTTP at all: the Keys
// tab shows the mask above, and reading a whole one means reading data/settings.json.

router.post('/settings', (req, res) => {
  try {
    const current  = loadSettings();
    const incoming = (req.body && typeof req.body === 'object') ? req.body : {};
    const clean = {};
    const gone = [];
    for (const [k, v] of Object.entries(incoming)) {
      if (RETIRED_KEYS.includes(k)) continue;
      if (SECRET_KEYS.includes(k)) {
        if (looksMasked(v)) continue; // ignore echoed masks
        // An empty value is a removal, not a key that happens to be empty.
        if (v == null || String(v).trim() === '') { gone.push(k); continue; }
      }
      clean[k] = v;
    }
    const updated = { ...current, ...clean };
    for (const k of [...gone, ...RETIRED_KEYS]) delete updated[k];
    saveSettings(updated);
    res.json(safeView(updated));
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
