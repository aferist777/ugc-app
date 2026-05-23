'use strict';

/* ═════════════════════════════════════════════════════════════════════════════
   GEN TIMINGS — per-model+resolution rolling timing samples.

   Used by the talking-head flow to show "~M:SS estimated remaining" next to
   the cancel ✕ in the activity-row. The browser sends a sample after each
   successful generation; the server keeps the last N=10 per (model+resolution)
   key in data/gen-timings.json.

   Sample: { audioSec, durationSec, recordedAt }
   Rate ratio = durationSec / audioSec — the multiplier that turns the audio
   length of a NEW clip into an estimated generation time.

   Seed: prunaai/p-video-avatar @ 720p starts with one virtual sample
   (8s audio → 19.3s gen, taken from the model's default example) so the very
   first run already has a baseline.
   ═════════════════════════════════════════════════════════════════════════════ */

const express = require('express');
const fs      = require('fs');
const path    = require('path');
const router  = express.Router();

const { DATA_DIR } = require('../lib/config');
const TIMINGS_FILE = path.join(DATA_DIR, 'gen-timings.json');

const MAX_SAMPLES_PER_KEY = 10;

// Virtual seed samples — only consulted when a real key has 0 samples.
const SEED_RATIOS = {
  'prunaai/p-video-avatar|720p':  [{ audioSec: 8, durationSec: 19.3, recordedAt: 0, _seed: true }],
};

function _key(modelId, resolution) {
  return `${modelId}|${resolution || ''}`;
}

function _load() {
  if (!fs.existsSync(TIMINGS_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(TIMINGS_FILE, 'utf8')); }
  catch { return {}; }
}
function _save(obj) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(TIMINGS_FILE, JSON.stringify(obj, null, 2), 'utf8');
}

// Compute average ratio from samples. Falls back to seed when empty.
function _avgRatio(samples, seedKey) {
  if (!samples || !samples.length) {
    const seed = SEED_RATIOS[seedKey];
    if (seed && seed.length) return seed[0].durationSec / seed[0].audioSec;
    return null;
  }
  const ratios = samples
    .filter(s => s && s.audioSec > 0 && s.durationSec > 0)
    .map(s => s.durationSec / s.audioSec);
  if (!ratios.length) return null;
  // Drop top/bottom outlier when we have 4+ samples.
  if (ratios.length >= 4) {
    ratios.sort((a, b) => a - b);
    ratios.shift(); ratios.pop();
  }
  return ratios.reduce((a, b) => a + b, 0) / ratios.length;
}

// ── POST /api/gen-timings/record ─────────────────────────────────────────────
// Body: { modelId, resolution, audioSec, durationSec }
router.post('/gen-timings/record', (req, res) => {
  try {
    const { modelId, resolution = '', audioSec, durationSec } = req.body || {};
    if (!modelId || !(audioSec > 0) || !(durationSec > 0)) {
      return res.status(400).json({ success: false, error: 'modelId + positive audioSec + durationSec required' });
    }
    const all  = _load();
    const key  = _key(modelId, resolution);
    const arr  = Array.isArray(all[key]) ? all[key] : [];
    arr.push({ audioSec: +audioSec, durationSec: +durationSec, recordedAt: Date.now() });
    while (arr.length > MAX_SAMPLES_PER_KEY) arr.shift();
    all[key] = arr;
    _save(all);
    res.json({ success: true, samples: arr.length, ratio: _avgRatio(arr, key) });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── GET /api/gen-timings ─────────────────────────────────────────────────────
// Returns { ratios: { "<modelId>|<resolution>": <number>, ... } }.
// Includes seed-only keys so the very first generation also gets a countdown.
router.get('/gen-timings', (_req, res) => {
  const all = _load();
  const ratios = {};
  for (const [k, samples] of Object.entries(all)) {
    const r = _avgRatio(samples, k);
    if (r != null) ratios[k] = r;
  }
  // Add seed-only keys that aren't in `all` yet.
  for (const [k, _samples] of Object.entries(SEED_RATIOS)) {
    if (!(k in ratios)) {
      const r = _avgRatio([], k);
      if (r != null) ratios[k] = r;
    }
  }
  res.json({ success: true, ratios });
});

module.exports = router;
