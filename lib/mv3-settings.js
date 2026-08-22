'use strict';

// ════════════════════════════════════════════════════════════════════════════
// MERGE'S OWN SETTINGS — the ladder, the writer, and the defaults behind the gear.
//
// Its own file rather than a corner of data/settings.json, for the same reason everything else
// in this corner is its own: settings.json holds the API keys, is shared by every page, and a
// Merge preference has no business living next to a secret.
//
// ── What a ladder is ────────────────────────────────────────────────────────
// For one engine, the order its aggregators are tried in. Only the ORDER is stored, never the
// list: which aggregators can serve an engine is a fact about the outside world and belongs to
// the table. Storing the list here would mean a model added to the table never appears until
// somebody edited these settings too, and one removed would be offered forever.
//
// Nothing is written until somebody changes something. An engine with no stored order uses the
// table's own, which is what it did before this file existed.
//
// ── The writer ──────────────────────────────────────────────────────────────
// A LADDER, like the picture models have: an ordered list of (aggregator, model) steps, tried
// in turn until one answers. One choice was not enough for the same reason it is not enough for
// pictures - the first rung is what usually runs, and the rest exist for the day it refuses.
//
// It is the one call in the pipeline whose taste shows in every picture, so it is worth
// choosing rather than inheriting.
// ════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');

const { DATA_DIR } = require('./config');

const FILE = path.join(DATA_DIR, 'mv3-settings.json');

// Who can do the writing, and what they answer to.
//
// EXACTLY THE LIST THE CHARACTER PAGE USES, and nothing else. Those ids are the ones this app
// has established it can actually reach for language work, and the list is a LIMIT here rather
// than a suggestion - which is why the panel offers a choice of them instead of a box to type
// into. A model that works somewhere is not the same as a model that works here.
//
// Asked again from this side before being written down, with the writer's own system prompt and
// its JSON envelope rather than Character's vision prompt: every id below came back with a
// usable prompt.
//
// What that turned up on the way, and it is worth keeping: kie's `gpt-5-4` answers "The model is
// not supported" INSIDE an HTTP 200, and `gpt-5-2` does not answer inside a minute. Both were in
// an earlier version of this list, guessed from the app's own text cascade, and the first was
// the third rung of the default chain - dead the whole time, because a caller that trusts the
// status code reads a refusal as an empty answer.
//
// Replicate IS here, and the reason it nearly was not is worth writing down. The Character
// page marks it "pending - no chat transport", and that comment is simply older than the code:
// helpers grew _callReplicateVision later, with a dialect per model family, and the vision
// ladder has been calling it ever since. Repeating the comment instead of reading the code cost
// this list an entire aggregator. All four of its models were then asked the writer's job
// directly, and all four answered.
const WRITER_PROVIDERS = [
  {
    id: 'openrouter', label: 'OpenRouter',
    models: [
      'openai/gpt-5.6-luna',
      'google/gemini-3.7-flash',
      'google/gemini-3.1-flash-lite',
      'google/gemini-2.5-flash',
    ],
  },
  {
    id: 'replicate', label: 'Replicate',
    // Its prompt and system field are named differently depending on who made the model - the
    // openai/ ones take system_prompt, everyone else takes system_instruction.
    models: [
      'openai/gpt-5.6-luna',
      'google/gemini-3.5-flash',
      'google/gemini-3-flash',
      'google/gemini-2.5-flash',
    ],
  },
  {
    id: 'kie', label: 'kie.ai',
    // The -openai suffix is not decoration: the bare spellings answer "The model is not
    // supported", and they do it inside a 200.
    models: [
      'gemini-3-7-flash-openai',
      'gemini-3-6-flash-openai',
      'gemini-3-5-flash-openai',
      'gemini-3-flash',
      'gemini-2.5-flash',
    ],
  },
];

// One aggregator's best, its own fallback, then the other aggregator - so a bad afternoon at one
// of them is not a bad afternoon for the writer.
const WRITER_CHAIN = [
  { provider: 'openrouter', model: 'openai/gpt-5.6-luna' },
  { provider: 'openrouter', model: 'google/gemini-3.7-flash' },
  { provider: 'kie', model: 'gemini-3-7-flash-openai' },
];

const MAX_WRITER_STEPS = 5;

const EMPTY = {
  // engineId -> ordered provider ids. Absent means "the table's order".
  ladders: {},
  // { on, chain } - on is the resting state of the ✎ button.
  writer: { on: true, chain: WRITER_CHAIN },
  // Whether a ladder may step over an aggregator whose key is known to be down. On by default:
  // a step that cannot possibly work is a step that only costs the wait.
  skipDown: true,
};

function read() {
  let raw = {};
  try { raw = JSON.parse(fs.readFileSync(FILE, 'utf8')) || {}; } catch (e) {}
  return {
    ladders: (raw.ladders && typeof raw.ladders === 'object') ? raw.ladders : {},
    writer: _writer(raw.writer),
    skipDown: raw.skipDown !== false,
  };
}

// The writer was one model before it was a ladder. A stored `model` becomes the first rung, so
// nobody's choice is thrown away by the shape changing under it.
function _writer(w) {
  const raw = w || {};
  let chain = Array.isArray(raw.chain) ? raw.chain : null;
  if (!chain && typeof raw.model === 'string' && raw.model.trim()) {
    chain = [{ provider: 'openrouter', model: raw.model.trim() }];
  }
  chain = (chain || WRITER_CHAIN)
    .filter(r => r && r.model && WRITER_PROVIDERS.some(p => p.id === r.provider))
    .map(r => ({ provider: String(r.provider), model: String(r.model).trim() }))
    // A rung naming a model that is not on the list is dropped. The list is the set this app
    // has established it can reach, so a rung outside it is a rung that only costs the wait -
    // and one written before the list was corrected is exactly the thing worth clearing out.
    .filter(r => {
      const p = WRITER_PROVIDERS.find(x => x.id === r.provider);
      return (p.models || []).includes(r.model);
    })
    .slice(0, MAX_WRITER_STEPS);
  return { on: raw.on !== false, chain: chain.length ? chain : WRITER_CHAIN.slice() };
}

function write(next) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8');
  fs.renameSync(tmp, FILE);
  return next;
}

/** A shallow merge, so the panel can send one field without carrying the rest. */
function patch(o) {
  const cur = read();
  const p = o || {};
  const next = {
    ladders: Object.assign({}, cur.ladders, p.ladders || {}),
    writer: _writer(Object.assign({}, cur.writer, p.writer || {})),
    skipDown: p.skipDown === undefined ? cur.skipDown : !!p.skipDown,
  };
  // A ladder set to null is a ladder REMOVED - back to the table's own order, which is a
  // different thing from an empty list and worth being able to say.
  for (const k of Object.keys(p.ladders || {})) {
    if (p.ladders[k] == null) delete next.ladders[k];
  }
  return write(next);
}

/**
 * The order to try aggregators for one engine.
 *
 * `all` is what the table says can serve it, already filtered for direction, tier and
 * references. The stored order is applied ON TOP of that: anything stored but no longer usable
 * drops out, anything usable but not stored goes on the end. So an engine that gains an
 * aggregator gains it here too, without anybody editing anything.
 */
function ladderFor(engineId, all) {
  const list = (all || []).slice();
  const want = read().ladders[engineId];
  if (!Array.isArray(want) || !want.length) return list;
  const first = want.filter(p => list.includes(p));
  const rest = list.filter(p => !first.includes(p));
  return first.concat(rest);
}

const writer = () => read().writer;

module.exports = { FILE, EMPTY, WRITER_PROVIDERS, WRITER_CHAIN, MAX_WRITER_STEPS,
                   read, patch, ladderFor, writer };
