'use strict';

// ════════════════════════════════════════════════════════════════════════════
// THE CHARACTER LADDERS — what to try, in what order, when the first thing fails: for New Character on
// the Library's Characters shelf (the portrait, an edit, the 4K sheet). Reading a picture is the agents' ladder
// (lib/agents.js, phase V25 - Admin -> AI settings); the `vision` ladder that was here went into it. There is no
// editor for them any more - it went with the Character page's settings in phase H8 - so what the
// library's settings.json holds (cv2Ladders), repaired below, or the defaults, is the setting.
//
// This file is POLICY and nothing else. It holds no idea of how to reach kie.ai or
// what Replicate wants in a request body: that is lib/img-providers.js, and it stays
// shared, because "which engine exists on which aggregator" is a fact about the
// outside world and every page needs the same answer to it.
//
// What lives here is this page's opinion: the order to try things in, how far down
// to let it go, and what a step is allowed to change. Scenarios will get its own
// opinion later, against different models - and when it does, the model REGISTRY at
// the bottom is the part to lift out, not the ladders themselves.
//
// A step is one attempt at one pairing. img-providers.submitImage() is already
// exactly that primitive - one pairing, one try, no opinions - so nothing there had
// to change: a ladder is a loop around a function that already existed.
//
// THREE ladders, one per picture the page can start:
//
//   create      the portrait from the parameters          text to image
//   reference   the portrait from a photo you gave it     image to image
//   sheet       the 4K reference sheet                    image to image, 16:9
//
// A stored `cv2Ladders.vision` (before V25) is read by nothing.
//
// The defaults are what the page did before ladders existed, deliberately: `create`
// and `reference` start as ONE step because they are cheap and frequent and failing
// fast is kinder than a minute of silence, while `sheet` starts with every aggregator
// that carries its engine, because that is the cascade it already had and quietly
// making it less reliable would be a poor trade.
// ════════════════════════════════════════════════════════════════════════════

const { getSettings } = require('./settings-io');
// providersFor() rather than reading the table by hand: it already answers "who can
// serve this engine in this direction", and asking it means this file cannot drift
// from the matrix the submit actually uses.
const { ENGINES, providersFor } = require('./img-providers');

const KEY = 'cv2Ladders';

// Five is the cap, and it is about waiting rather than money. A refused submit costs
// nothing; a step that TIMES OUT costs the wait. Measured on one bad afternoon:
// Replicate refused in 4s, kie went silent for 189s. A ladder of ten is a page that
// says nothing for half an hour before admitting defeat.
const MAX_STEPS = 5;

const OPS = {
  create:    { kind: 'img', dir: 't2i' },
  reference: { kind: 'img', dir: 'i2i' },
  sheet:     { kind: 'img', dir: 'i2i' },
};

// img-providers speaks 'kie'; the health check and the page speak 'kie.ai', which is
// what the aggregator calls itself. Translated in one place rather than everywhere.
const AGG_TO_MATRIX = { 'kie.ai': 'kie', 'replicate': 'replicate' };

const DEFAULTS = {
  // `z-turbo` is the engine's ID; `z-image-turbo` is what it is CALLED. The matrix is
  // keyed by the first and displays the second, and they are not the same string for
  // four of the seven engines.
  create: [
    { provider: 'replicate', engine: 'z-turbo', quality: '2K' },
  ],
  reference: [
    { provider: 'replicate', engine: 'nano-banana-2', quality: '2K' },
  ],
  // The cascade the sheet already had, written down instead of hard-coded.
  sheet: [
    { provider: 'replicate',  engine: 'nano-banana-2', quality: '4K' },
    { provider: 'kie.ai',     engine: 'nano-banana-2', quality: '4K' },
  ],
};

// ── Repair, rather than refuse ──────────────────────────────────────────────
// A stored ladder can name an engine that has been dropped, a tier a model no longer
// offers, or an aggregator that never carried the pairing. Passing that on means a
// 422 halfway through a save; dropping the whole ladder means losing a choice over a
// typo. So each step is mended where it can be and dropped only when it cannot.
function _fixImg(op, step) {
  const spec = OPS[op];
  const agg = AGG_TO_MATRIX[step && step.provider] ? step.provider : null;
  if (!agg) return null;
  const mx = AGG_TO_MATRIX[agg];
  const serves = (e) => !!(ENGINES[e] && providersFor(e, spec.dir).includes(mx));
  const engine = serves(step.engine) ? step.engine : null;
  if (!engine) return null;                        // this aggregator cannot draw it: not repairable
  const tiers = ENGINES[engine].tiers || [];
  const quality = tiers.includes(step.quality) ? step.quality : (ENGINES[engine].def || tiers[0] || '');
  return { provider: agg, engine, quality };
}

// A ladder with the same pairing twice is a ladder that fails the same way twice, so
// duplicates are dropped rather than kept as a second chance that is not one.
// `_fallback` guards the one line below that calls this function again. A default that
// cannot itself be repaired - an engine id mistyped as its label, which is exactly what
// happened once - turns "fall back to the default" into an unbounded recursion, and the
// page answers "Maximum call stack size exceeded" instead of naming the broken default.
function normalise(op, steps, _fallback) {
  const spec = OPS[op];
  if (!spec) return [];
  const seen = new Set();
  const out = [];
  for (const raw of (Array.isArray(steps) ? steps : [])) {
    const s = _fixImg(op, raw);
    if (!s) continue;
    const key = s.provider + '|' + s.engine;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
    if (out.length >= MAX_STEPS) break;
  }
  // Never empty: an operation with no ladder is a button that cannot run. The default
  // is the last word, not the stored value, precisely so a bad save cannot brick a page.
  if (out.length) return out;
  if (_fallback) {
    // The default itself did not survive its own repair, which means this file is
    // wrong rather than the stored value. Say so once, out loud, instead of looping.
    console.error('[cv2-ladders] the default for "' + op + '" does not match the engine matrix:',
      JSON.stringify(DEFAULTS[op]));
    return [];
  }
  return normalise(op, DEFAULTS[op], true);
}

function getLadders() {
  const stored = (getSettings() || {})[KEY] || {};
  const out = {};
  for (const op of Object.keys(OPS)) out[op] = normalise(op, stored[op] || DEFAULTS[op]);
  return out;
}

function getLadder(op) {
  return OPS[op] ? getLadders()[op] : [];
}


module.exports = {
  KEY, OPS, MAX_STEPS, DEFAULTS,
  AGG_TO_MATRIX,
  normalise, getLadders, getLadder,
};
