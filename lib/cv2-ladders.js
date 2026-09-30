'use strict';

// ════════════════════════════════════════════════════════════════════════════
// CHARACTER v2's LADDERS — what to try, in what order, when the first thing fails.
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
// FOUR ladders, one per thing the page can start:
//
//   create      the portrait from the parameters          text to image
//   reference   the portrait from a photo you gave it     image to image
//   sheet       the 4K reference sheet                    image to image, 16:9
//   vision      reading a photo - the analyzer and the framing agent
//
// The defaults are what the page did before ladders existed, deliberately: `create`
// and `reference` start as ONE step because they are cheap and frequent and failing
// fast is kinder than a minute of silence, while `sheet` starts with every aggregator
// that carries its engine, because that is the cascade it already had and quietly
// making it less reliable would be a poor trade.
// ════════════════════════════════════════════════════════════════════════════

const { getSettings, patchSettings } = require('./settings-io');
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
  vision:    { kind: 'llm' },
};

// ── The vision models, per aggregator ───────────────────────────────────────
// Every id below answered a live call with this page's own analyzer prompt and a
// real photo, and returned the same {ok, who, change} shape. Nothing is listed that
// has not.
//
// kie's ids carry the -openai suffix because the bare spellings answer "The model is
// not supported" - inside an HTTP 200, so a caller that trusts the status code reads
// the refusal as an empty answer and moves on none the wiser.
//
// Replicate is listed but PENDING, which is a third thing and not a softer "down". Its key
// being refused is a fact about today; what keeps it out of a run is that this app has no
// chat transport for Replicate at all - every language call it makes goes to OpenRouter or
// kie.ai. So the models are kept, because the choice of them was real and should survive
// until the transport exists, and a step on them is stepped over with that as the reason
// rather than tried and failed.
//
// Saying "in development" rather than hiding it: an option that vanishes looks like a
// mistake in the list, and the day the transport lands the choice is already made.
// NO OPENROUTER in any of the four (phase H, the owner 2026-10-01: "убираем openrouter из создания
// персонажа"). The owner's key is refused, and every sheet began with that refusal and a 2K step. It is
// not an aggregator these ladders know any more, so a stored ladder that still names it is read without
// those steps (_fixImg / _fixLlm drop a step whose aggregator is not here) - nothing has to be rewritten.
const VISION = {
  'kie.ai': {
    models: ['gemini-2.5-flash', 'gemini-3-5-flash-openai', 'gemini-3-6-flash-openai',
             'gemini-3-7-flash-openai', 'gemini-3-flash'],
  },
  'replicate': {
    models: ['google/gemini-2.5-flash', 'google/gemini-3-flash',
             'google/gemini-3.5-flash', 'openai/gpt-5.6-luna'],
  },
};

const visionModels = (agg) => ((VISION[agg] && VISION[agg].models) || []);
const visionPending = (agg) => ((VISION[agg] && VISION[agg].pending) || '');

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
  vision: [
    { provider: 'replicate', model: 'google/gemini-2.5-flash' },
    { provider: 'kie.ai',    model: 'gemini-3-5-flash-openai' },
  ],
};

// ── What is actually on offer ───────────────────────────────────────────────
// Built from the same table that submits, so a ladder can never be saved holding a
// pairing that fails the moment it is used.
function optionsFor(op) {
  const spec = OPS[op];
  if (!spec) return null;
  if (spec.kind === 'llm') {
    return {
      kind: 'llm',
      providers: Object.keys(VISION).map(id => ({
        id,
        models: visionModels(id).slice().sort(),
        // Present and choosable, but it will be stepped over until this is empty.
        pending: visionPending(id),
      })),
    };
  }
  const providers = [];
  for (const [agg, mx] of Object.entries(AGG_TO_MATRIX)) {
    const engines = Object.keys(ENGINES)
      .filter(e => providersFor(e, spec.dir).includes(mx))
      .sort()
      .map(e => ({ id: e, label: ENGINES[e].label, tiers: ENGINES[e].tiers, def: ENGINES[e].def }));
    if (engines.length) providers.push({ id: agg, engines });
  }
  return { kind: 'img', dir: spec.dir, providers };
}

// Every pairing this operation could ever hold - the real ceiling on a ladder's length.
function pairCount(op) {
  const o = optionsFor(op);
  if (!o) return 0;
  return o.providers.reduce((n, p) => n + (o.kind === 'llm' ? p.models.length : p.engines.length), 0);
}

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

function _fixLlm(step) {
  const list = visionModels(step && step.provider);
  if (!list.length) return null;
  const model = list.includes(step.model) ? step.model : list[0];
  return { provider: step.provider, model };
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
    const s = spec.kind === 'llm' ? _fixLlm(raw) : _fixImg(op, raw);
    if (!s) continue;
    const key = s.provider + '|' + (s.engine || s.model);
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

// Written whole, per operation. The three that were not touched are written back
// unchanged so the object in settings.json always holds all four - a half-written
// map would let a later read fall through to a default nobody chose.
function setLadder(op, steps) {
  if (!OPS[op]) throw new Error('unknown operation: ' + op);
  const all = getLadders();
  all[op] = normalise(op, steps);
  patchSettings({ [KEY]: all });
  return all[op];
}

module.exports = {
  KEY, OPS, MAX_STEPS, DEFAULTS, VISION,
  AGG_TO_MATRIX, 
  visionModels, visionPending,
  optionsFor, pairCount, normalise, getLadders, getLadder, setLadder,
};
