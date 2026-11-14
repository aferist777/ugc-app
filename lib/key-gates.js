'use strict';

// ════════════════════════════════════════════════════════════════════════════
// WHICH PLACES OF THE APP CAN BE USED WITH THE KEYS THAT ARE THERE.
//
// A place that needs a key the library does not have is closed on the page BEFORE anything is chosen or written:
// a generator's window does not open, a talking head's setup is blurred, REFERENCES is locked - and a press says
// which key is missing, with the way to Admin -> API keys. The routes still refuse in words as they did; this is
// only the page knowing in advance.
//
// A place NEEDS GROUPS, every one of them; a group is a list of things any ONE of which will do:
//   [['kie', 'replicate']]                      kie.ai or Replicate
//   [['kie'], ['cloudflare'], ['ladder']]       kie.ai, and Cloudflare, and the agents' ladder
// A key counts when its field is filled and the last check did not refuse it (lib/keys-health.js - unknown is not
// refused: before the first check nothing is proven). Cloudflare counts once its key passed its own check (R2 is
// then set up, lib/r2.js). The ladder counts when a step of the ladder ordered on AI settings can be asked
// (lib/agents.js offWhy). The speech model is not a key: it counts when this computer can hear (lib/whisper-local.js).
//
// Everything is open with the fake aggregator (a stand runs end to end for free) and with UGC_KEYS_OPEN=1 - the
// server the guide's pictures are taken with (tools/guide-shots.js), on a library that holds no keys. Neither
// ever applies inside the desktop app.
// ════════════════════════════════════════════════════════════════════════════

const { getSettings } = require('./settings-io');

// What a place can need. `field` - the settings field of a key; `health` - its id in lib/keys-health.js.
const ATOMS = {
  kie:        { label: 'kie.ai', field: 'kieApiKey', health: 'kie.ai' },
  replicate:  { label: 'Replicate', field: 'replicateApiKey', health: 'replicate' },
  elevenlabs: { label: 'ElevenLabs', field: 'elevenLabsApiKey', health: 'elevenlabs' },
  groq:       { label: 'Groq', field: 'groqApiKey', health: 'groq' },
  pixabay:    { label: 'Pixabay', field: 'pixabayApiKey', health: 'pixabay' },
  cloudflare: { label: 'Cloudflare', field: 'cloudflareApiToken', health: 'cloudflare' },
  telegram:   { label: 'the Telegram bot', field: 'telegramBotToken', health: 'telegram' },
  ladder:     { label: 'an AI key for the agents (kie.ai, Replicate, Claude or OpenRouter)' },
  whisper:    { label: 'the speech model on this computer (free)' },
};

// Every place, what it needs and why, in the words the popup says.
const PLACES = {
  pictures:   { label: 'The pictures chat', needs: [['kie', 'replicate']], why: 'pictures are made on kie.ai or Replicate' },
  videos:     { label: 'The video chat', needs: [['kie', 'replicate']], why: 'clips are made on kie.ai or Replicate' },
  attach:     { label: 'Attaching a picture or a clip', needs: [['cloudflare']], why: 'the models fetch what is attached by a link your Cloudflare bucket hosts' },
  writer:     { label: 'The writer', needs: [['ladder']], why: 'the writer is an agent of the ladder on AI settings' },
  sound:      { label: 'Generate audio', needs: [['kie', 'elevenlabs']], why: 'music and sounds are made by Suno on kie.ai or by ElevenLabs' },
  suno:       { label: 'Suno', needs: [['kie']], why: 'Suno is reached through kie.ai' },
  eleven:     { label: 'ElevenLabs', needs: [['elevenlabs']], why: 'this mode is made by ElevenLabs' },
  environment: { label: 'New environment', needs: [['kie'], ['ladder']], why: 'the place is drawn on kie.ai after an agent reads the idea' },
  lookbook:   { label: 'New lookbook', needs: [['kie'], ['ladder']], why: 'the outfit is drawn on kie.ai after an agent reads the idea' },
  character:  { label: 'New Character', needs: [['replicate'], ['cloudflare']], why: 'the portrait is made on Replicate, the 4K sheet from it by a public link' },
  voices:     { label: 'ElevenLabs voices', needs: [['elevenlabs']], why: 'the voices are ElevenLabs\' library' },
  assistant:  { label: 'The assistant', needs: [['ladder']], why: 'it answers with a model of the agents\' ladder' },
  talking:    { label: 'Talking head', needs: [['elevenlabs'], ['kie'], ['cloudflare'], ['ladder']], why: 'the lines are read by ElevenLabs, the frames and clips made on kie.ai from pictures your Cloudflare bucket hosts, the prompts written by an agent' },
  voiceover:  { label: 'Voiceover', needs: [['elevenlabs'], ['ladder'], ['pixabay']], why: 'the script is read by ElevenLabs, the B-roll found on Pixabay by an agent\'s queries' },
  highlights: { label: 'Highlights', needs: [['ladder'], ['groq', 'whisper']], why: 'the words are heard by Groq or this computer, the moments found by an agent' },
  hearing:    { label: 'Hearing the words', needs: [['groq', 'whisper']], why: 'the words are heard by Groq or by this computer' },
  scenarios:  { label: 'The scenario generator', needs: [['ladder']], why: 'the script is written by an agent of the ladder' },
  sources:    { label: 'Sources', needs: [['replicate'], ['ladder']], why: 'a source is transcribed on Replicate and its topics found by an agent' },
  references: { label: 'REFERENCES', needs: [['telegram']], why: 'REFERENCES is what your Telegram bot receives' },
};

const _env = () => String(process.env.UGC_KEYS_OPEN || '').trim() === '1';
const _desktop = () => !!(process.versions && process.versions.electron);

/** Every place open whatever the keys: a stand on the fake aggregator, or the guide's camera. Never the desktop app. */
function allOpen() {
  if (_desktop()) return false;
  if (_env()) return true;
  try { return require('./fake-agg').on(); } catch (e) { return false; }
}

// One atom: '' when it is there, else why not ('no key' | 'refused: …' | 'not checked' | …).
function _atom(id, s) {
  const a = ATOMS[id];
  if (id === 'ladder') {
    const AG = require('./agents');
    const steps = AG.ladder();
    if (steps.some(st => !AG.offWhy(st.provider))) return '';
    // Is there a working key the ladder does not use? Then the fix is the ladder's order, not a key.
    const unused = AG.PROVIDERS.some(p => !steps.some(st => st.provider === p.id) && !AG.offWhy(p.id));
    return unused ? 'not in the ladder' : 'no key';
  }
  if (id === 'whisper') {
    const L = require('./whisper-local');
    if (!L.hasProgram()) return 'not installed';
    return L.hasModel() ? '' : 'not downloaded';
  }
  if (!String(s[a.field] || '').trim()) return 'no key';
  const H = require('./keys-health');
  if (H.isDown(a.health)) return 'refused' + (H.reasonFor(a.health) ? ': ' + H.reasonFor(a.health) : '');
  if (id === 'cloudflare') {
    try { if (!require('./r2').isConfigured()) return 'not checked'; } catch (e) { return 'not checked'; }
  }
  return '';
}

/** One place: { open, missing: [[{ id, label, why }]] - the groups none of whose members is there }. */
function place(id, cache) {
  const p = PLACES[id];
  if (!p) return { open: true, missing: [] };
  if (allOpen()) return { open: true, missing: [] };
  let s = {};
  try { s = getSettings() || {}; } catch (e) { s = {}; }
  const of = (a) => { if (!(a in cache)) cache[a] = _atom(a, s); return cache[a]; };
  const missing = p.needs
    .filter(group => !group.some(a => !of(a)))
    .map(group => group.map(a => ({ id: a, label: ATOMS[a].label, why: of(a) })));
  return { open: !missing.length, missing };
}

/** Every place for the page, with its words. */
function state() {
  const cache = {};
  const places = {};
  for (const id of Object.keys(PLACES)) {
    places[id] = Object.assign({ label: PLACES[id].label, why: PLACES[id].why }, place(id, cache));
  }
  return { success: true, all: allOpen(), places };
}

module.exports = { ATOMS, PLACES, place: (id) => place(id, {}), state, allOpen };
