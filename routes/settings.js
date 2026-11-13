'use strict';

const express = require('express');
const fs      = require('fs');
const { writeFileAtomic } = require('../lib/atomic-write');
const path    = require('path');
const router  = express.Router();

const SETTINGS_FILE = path.join(require('../lib/config').DATA_DIR, 'settings.json');

// Fields that hold live credentials. Their VALUES must never be sent to the browser — the
// page only needs to know a key is set and show a masked hint. The server reads the real
// values straight off disk on every request path (helpers.js, settings-io.js, …), so redacting
// the HTTP view changes no behaviour. Even on one machine with one person a
// raw key in the page is a key in a screen-share or a browser extension's reach.
//
// r2AccountId and r2Bucket (written by the Cloudflare key's check) are identifiers, not credentials, and stay in view.
const SECRET_KEYS = [
  'anthropicApiKey', 'kieApiKey', 'replicateApiKey',
  'elevenLabsApiKey', 'groqApiKey', 'openRouterApiKey',
  // The secret of the R2 fields of older versions: nothing reads it, and a library that
  // still holds it never shows it (the key's check wipes it, lib/cloudflare.js).
  'r2SecretAccessKey',
  // the one Cloudflare key - R2 and the Telegram receiver (lib/cloudflare.js)
  'cloudflareApiToken',
  // the person's own bot, made at @BotFather (lib/telegram.js)
  'telegramBotToken',
  // the person's Freesound account - finding CC0 sound effects online (lib/freesound.js)
  'freesoundApiKey',
  // the person's Pixabay key - a voiceover's B-roll (lib/pixabay.js); it goes in the request's address
  'pixabayApiKey',
];
// Written by the server only: the Cloudflare key's id, once its check passed (lib/cloudflare.js) - what lib/r2.js makes
// its pair from. A page cannot set it, and a key replaced or removed drops it: a new key is R2's only once IT passed.
const SERVER_ONLY = ['cloudflareTokenId'];

function loadSettings() {
  try { return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')); }
  catch { return {}; }
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

// There is no reveal. A key's full value never leaves the server through HTTP at all: the Keys
// tab shows the mask above, and reading a whole one means reading data/settings.json.

router.post('/settings', async (req, res) => {
  try {
    const current  = loadSettings();
    const incoming = (req.body && typeof req.body === 'object') ? req.body : {};
    const clean = {};
    const gone = [];
    for (const [k, v] of Object.entries(incoming)) {
      if (SERVER_ONLY.includes(k)) continue;
      if (SECRET_KEYS.includes(k)) {
        if (looksMasked(v)) continue; // ignore echoed masks
        // An empty value is a removal, not a key that happens to be empty.
        if (v == null || String(v).trim() === '') { gone.push(k); continue; }
      }
      clean[k] = v;
    }
    const changed = (k) => gone.includes(k)
      || (k in clean && String(clean[k]).trim() !== String(current[k] || '').trim());
    // The Telegram receiver goes down while the keys that put it up are still here: the old bot key to
    // point the bot nowhere, the old Cloudflare key to delete the Worker. The page connects the bot again after the save.
    if (changed('telegramBotToken') || changed('cloudflareApiToken')) {
      try { await require('../lib/telegram').dropReceiver(); }
      catch (e) { console.warn('[settings] the Telegram receiver could not be taken down:', e.message); }
    }
    const updated = { ...loadSettings(), ...clean };
    for (const k of gone) delete updated[k];
    if (changed('cloudflareApiToken')) delete updated.cloudflareTokenId;
    saveSettings(updated);
    res.json(safeView(updated));
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
