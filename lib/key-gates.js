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
const I18N = require('./i18n');

// What a place can need. `field` - the settings field of a key; `health` - its id in lib/keys-health.js. `label` - its
// name in the interface's language, said when the state is asked (never at load: the language is taken at the start).
const ATOMS = {
  kie:        { label: () => 'kie.ai', field: 'kieApiKey', health: 'kie.ai' },
  replicate:  { label: () => 'Replicate', field: 'replicateApiKey', health: 'replicate' },
  elevenlabs: { label: () => 'ElevenLabs', field: 'elevenLabsApiKey', health: 'elevenlabs' },
  groq:       { label: () => 'Groq', field: 'groqApiKey', health: 'groq' },
  pixabay:    { label: () => 'Pixabay', field: 'pixabayApiKey', health: 'pixabay' },
  cloudflare: { label: () => 'Cloudflare', field: 'cloudflareApiToken', health: 'cloudflare' },
  telegram:   { label: () => I18N.t('the Telegram bot'), field: 'telegramBotToken', health: 'telegram' },
  freesound:  { label: () => 'Freesound', field: 'freesoundApiKey', health: 'freesound' },
  ladder:     { label: () => I18N.t('an AI key for the agents (kie.ai, Replicate, Claude or OpenRouter)') },
  whisper:    { label: () => I18N.t('the speech model on this computer (free)') },
};

// Every place, what it needs and why, in the words the popup says - in the interface's language, said when asked.
const PLACES = {
  pictures:   { label: () => I18N.t('The pictures chat'), needs: [['kie', 'replicate']], why: () => I18N.t('pictures are made on kie.ai or Replicate') },
  videos:     { label: () => I18N.t('The video chat'), needs: [['kie', 'replicate']], why: () => I18N.t('clips are made on kie.ai or Replicate') },
  attach:     { label: () => I18N.t('Attaching a picture or a clip'), needs: [['cloudflare']], why: () => I18N.t('the models fetch what is attached by a link your Cloudflare bucket hosts') },
  writer:     { label: () => I18N.t('The writer'), needs: [['ladder']], why: () => I18N.t('the writer is an agent of the ladder on AI settings') },
  sound:      { label: () => I18N.t('Generate audio'), needs: [['kie', 'elevenlabs']], why: () => I18N.t('music and sounds are made by Suno on kie.ai or by ElevenLabs') },
  suno:       { label: () => 'Suno', needs: [['kie']], why: () => I18N.t('Suno is reached through kie.ai') },
  eleven:     { label: () => 'ElevenLabs', needs: [['elevenlabs']], why: () => I18N.t('this mode is made by ElevenLabs') },
  environment: { label: () => I18N.t('New environment'), needs: [['kie'], ['ladder']], why: () => I18N.t('the place is drawn on kie.ai after an agent reads the idea') },
  lookbook:   { label: () => I18N.t('New lookbook'), needs: [['kie'], ['ladder']], why: () => I18N.t('the outfit is drawn on kie.ai after an agent reads the idea') },
  character:  { label: () => I18N.t('New Character'), needs: [['replicate'], ['cloudflare']], why: () => I18N.t('the portrait is made on Replicate, the 4K sheet from it by a public link') },
  voices:     { label: () => I18N.t('ElevenLabs voices'), needs: [['elevenlabs']], why: () => I18N.t('the voices are ElevenLabs\' library') },
  assistant:  { label: () => I18N.t('The assistant'), needs: [['ladder']], why: () => I18N.t('it answers with a model of the agents\' ladder') },
  talking:    { label: () => I18N.t('Talking head'), needs: [['elevenlabs'], ['kie'], ['cloudflare'], ['ladder']], why: () => I18N.t('the lines are read by ElevenLabs, the frames and clips made on kie.ai from pictures your Cloudflare bucket hosts, the prompts written by an agent') },
  voiceover:  { label: () => I18N.t('Voiceover'), needs: [['elevenlabs'], ['ladder'], ['pixabay']], why: () => I18N.t('the script is read by ElevenLabs, the B-roll found on Pixabay by an agent\'s queries') },
  highlights: { label: () => I18N.t('Highlights'), needs: [['ladder'], ['groq', 'whisper']], why: () => I18N.t('the words are heard by Groq or this computer, the moments found by an agent') },
  hearing:    { label: () => I18N.t('Hearing the words'), needs: [['groq', 'whisper']], why: () => I18N.t('the words are heard by Groq or by this computer') },
  scenarios:  { label: () => I18N.t('The scenario generator'), needs: [['ladder']], why: () => I18N.t('the script is written by an agent of the ladder') },
  sources:    { label: () => I18N.t('Sources'), needs: [['replicate'], ['ladder']], why: () => I18N.t('a source is transcribed on Replicate and its topics found by an agent') },
  prop:       { label: () => I18N.t('New prop'), needs: [['ladder']], why: () => I18N.t('an agent looks at the photo and writes what the product is') },
  online:     { label: () => I18N.t('Finding sounds online'), needs: [['freesound']], why: () => I18N.t('the sound effects are found on Freesound') },
  references: { label: () => I18N.t('REFERENCES'), needs: [['telegram']], why: () => I18N.t('REFERENCES is what your Telegram bot receives') },
};

const _env = () => String(process.env.UGC_KEYS_OPEN || '').trim() === '1';
const _desktop = () => !!(process.versions && process.versions.electron);

/** Every place open whatever the keys: a stand on the fake aggregator, or the guide's camera. Never the desktop app. */
function allOpen() {
  if (_desktop()) return false;
  if (_env()) return true;
  try { return require('./fake-agg').on(); } catch (e) { return false; }
}

// One atom: null when it is there, else why not - `code` the page tests ('nokey' | 'refused' | 'unchecked' |
// 'unladdered' | 'uninstalled' | 'undownloaded'), `reason` a refusal's own words (the key check's).
function _atom(id, s) {
  const a = ATOMS[id];
  if (id === 'ladder') {
    const AG = require('./agents');
    const steps = AG.ladder();
    if (steps.some(st => !AG.offWhy(st.provider))) return null;
    // Is there a working key the ladder does not use? Then the fix is the ladder's order, not a key.
    const unused = AG.PROVIDERS.some(p => !steps.some(st => st.provider === p.id) && !AG.offWhy(p.id));
    return { code: unused ? 'unladdered' : 'nokey' };
  }
  if (id === 'whisper') {
    const L = require('./whisper-local');
    if (!L.hasProgram()) return { code: 'uninstalled' };
    return L.hasModel() ? null : { code: 'undownloaded' };
  }
  if (!String(s[a.field] || '').trim()) return { code: 'nokey' };
  const H = require('./keys-health');
  if (H.isDown(a.health)) return { code: 'refused', reason: H.reasonFor(a.health) || '' };
  if (id === 'cloudflare') {
    try { if (!require('./r2').isConfigured()) return { code: 'unchecked' }; } catch (e) { return { code: 'unchecked' }; }
  }
  return null;
}

// Why an atom is not there, in the interface's language.
function _whyOf(x) {
  switch (x.code) {
    case 'nokey': return I18N.t('no key');
    case 'refused': return x.reason ? I18N.t('refused: {why}', { why: x.reason }) : I18N.t('refused');
    case 'unchecked': return I18N.t('not checked');
    case 'unladdered': return I18N.t('not in the ladder');
    case 'uninstalled': return I18N.t('not installed');
    case 'undownloaded': return I18N.t('not downloaded');
    default: return '';
  }
}

/** One place: { open, missing: [[{ id, label, code, why, reason }]] - the groups none of whose members is there }. */
function place(id, cache) {
  const p = PLACES[id];
  if (!p) return { open: true, missing: [] };
  if (allOpen()) return { open: true, missing: [] };
  let s = {};
  try { s = getSettings() || {}; } catch (e) { s = {}; }
  const of = (a) => { if (!(a in cache)) cache[a] = _atom(a, s); return cache[a]; };
  const missing = p.needs
    .filter(group => !group.some(a => !of(a)))
    .map(group => group.map((a) => {
      const x = of(a);
      return { id: a, label: ATOMS[a].label(), code: x.code, why: _whyOf(x), ...(x.reason ? { reason: x.reason } : {}) };
    }));
  return { open: !missing.length, missing };
}

/** Every place for the page, with its words. */
function state() {
  const cache = {};
  const places = {};
  for (const id of Object.keys(PLACES)) {
    places[id] = Object.assign({ label: PLACES[id].label(), why: PLACES[id].why() }, place(id, cache));
  }
  return { success: true, all: allOpen(), places };
}

module.exports = { ATOMS, PLACES, place: (id) => place(id, {}), state, allOpen };
