'use strict';

const express = require('express');
const fs      = require('fs');
const path    = require('path');
const router  = express.Router();

const SETTINGS_FILE = path.join(require('../lib/config').DATA_DIR, 'settings.json');

// Fields that hold live credentials. Their VALUES must never be sent to the browser — the
// page only needs to know a key is set and show a masked hint. The server reads the real
// values straight off disk on every request path (audio.js, video-engines.js, helpers.js,
// …), so redacting the HTTP view changes no behaviour. This is the companion to the app-wide
// login gate in lib/access-gate.js: even a signed-in browser never receives a raw key, so a
// leaked screen-share, a browser extension, or a future open endpoint can't hand them out.
//
// r2SecretAccessKey is here; r2AccountId, r2AccessKeyId, r2Bucket and r2PublicBase are not.
// Those four are identifiers, not credentials - useless without the secret, and worth seeing at
// a glance to check which bucket an install is pointed at. Masking them would only hide whether
// the field is filled in correctly.
const SECRET_KEYS = [
  'kieApiKey', 'replicateApiKey', 'imgbbApiKey',
  'elevenLabsApiKey', 'groqApiKey', 'openRouterApiKey',
  'r2SecretAccessKey',
  // The Partner ingest key (lib/partner.js): a finished render goes to their
  // dashboard with it. Their spec asks for an env var; the settings file is our equivalent.
  'partnerApiKey',
];

// WHO MAY TOUCH A SECRET. Every signed-in page reads GET /settings - engine defaults, column
// widths, the chosen image engine live there - so the read stays open and safeView keeps the
// secrets out of it. Reading a secret back, or writing one, is the admin's alone. The Keys tab
// on /admin is the only place that does either; a non-admin gets a plain 403.
function isAdmin(req) { return !!(req.user && req.user.role === 'admin'); }

function loadSettings() {
  try { return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')); }
  catch { return { imageEngine: 'nano-banana-2' }; }
}

function saveSettings(obj) {
  const dir = path.dirname(SETTINGS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(obj, null, 2), 'utf8');
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
      if (SECRET_KEYS.includes(k)) {
        if (!isAdmin(req)) return res.status(403).json({ success: false, error: 'admin only: ' + k });
        if (looksMasked(v)) continue; // ignore echoed masks
        // An empty value is a removal, not a key that happens to be empty.
        if (v == null || String(v).trim() === '') { gone.push(k); continue; }
      }
      clean[k] = v;
    }
    const updated = { ...current, ...clean };
    for (const k of gone) delete updated[k];
    saveSettings(updated);
    res.json(safeView(updated));
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
