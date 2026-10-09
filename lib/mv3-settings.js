'use strict';

// ════════════════════════════════════════════════════════════════════════════
// MERGE'S OWN SETTINGS — the analyst's ladder, behind the gear.
//
// Its own file rather than a corner of data/settings.json, for the same reason everything else
// in this corner is its own: settings.json holds the API keys, is shared by every page, and a
// Merge preference has no business living next to a secret.
//
// ── The analyst ─────────────────────────────────────────────────────────────
// An ordered list of (aggregator, model) steps, tried in turn until one answers. One choice was
// not enough: the first rung is what usually runs, and the rest exist for the day it refuses.
//
// It reads what was typed AND the pictures attached to it, and writes the prompt the picture
// model is actually given - the one call in the pipeline whose taste shows in every picture, so
// it is worth choosing rather than inheriting. Which is why this file outlived the ladders that
// used to sit beside it: those decided who SERVES a model, and the panel now names that outright.
//
// Both rungs were proved to read a picture, not just a sentence: a hosted photograph went to
// each and came back described (2026-09-13).
// ════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');

const { DATA_DIR } = require('./config');
const { writeFileAtomic } = require('./atomic-write');

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
    id: 'kie', label: 'kie.ai',
    // The -openai suffix is not decoration: the bare spelling answers "The model is not
    // supported", and it does it inside a 200.
    models: ['gemini-3-8-flash-openai'],
  },
  {
    id: 'replicate', label: 'Replicate',
    // Its prompt and system field are named differently depending on who made the model - the
    // openai/ ones take system_prompt, everyone else takes system_instruction. Pictures go in
    // `images`, which is where its vision comes from.
    models: ['google/gemini-3.5-flash'],
  },
];

// kie first because it is the cheaper of the two and answers fastest, Replicate behind it - so a
// bad afternoon at one of them is not a bad afternoon for the analyst.
const WRITER_CHAIN = [
  { provider: 'kie', model: 'gemini-3-8-flash-openai' },
  { provider: 'replicate', model: 'google/gemini-3.5-flash' },
];

const MAX_WRITER_STEPS = 5;

function read() {
  let raw = {};
  try { raw = JSON.parse(fs.readFileSync(FILE, 'utf8')) || {}; } catch (e) {}
  return {
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
  writeFileAtomic(FILE, JSON.stringify(next, null, 2));
  return next;
}

/** A shallow merge, so the panel can send one field without carrying the rest. */
function patch(o) {
  const cur = read();
  const p = o || {};
  const next = {
    writer: _writer(Object.assign({}, cur.writer, p.writer || {})),
    skipDown: p.skipDown === undefined ? cur.skipDown : !!p.skipDown,
  };
  return write(next);
}

const writer = () => read().writer;

module.exports = { FILE, WRITER_PROVIDERS, WRITER_CHAIN, MAX_WRITER_STEPS,
                   read, patch, writer };
