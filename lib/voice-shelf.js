'use strict';

// ════════════════════════════════════════════════════════════════════════════
// VOICE SHELF — the catalogue of every voice we have taken, with our own demo.
//
// One entry per ElevenLabs voice id. It holds the things that do NOT survive on
// their own:
//
//   demo          the mp3 WE generated, our own read with tags performed
//   name, labels  what ElevenLabs calls it and how it is tagged
//   publicOwnerId the shared-library owner, so the voice can be added back
//
// That last one is the reason this store exists at all. A voice taken from the
// shared library occupies a slot in the account, and the account is where its
// name, tags and origin live — so deleting the slot to free space normally
// destroys everything we knew about the voice. Reading the account voice BEFORE
// the slot goes and keeping it here is what makes freeing a slot reversible:
// POST /v1/voices/add/<publicOwnerId>/<voiceId> brings it straight back.
//
// WHICH CHARACTER USES A VOICE IS NOT STORED HERE. It is read from
// characters.json when the shelf is built. A copy here would be a second answer
// to the same question, and the two would disagree the first time a voice is
// unbound.
// ════════════════════════════════════════════════════════════════════════════

const fs   = require('fs');
const path = require('path');
const axios = require('axios');

const { DATA_DIR } = require('./config');

const FILE     = path.join(DATA_DIR, 'voice-shelf.json');
const EL_BASE  = 'https://api.elevenlabs.io/v1';

// The tags a voice carries in ElevenLabs, in the order the info column reads them
// out. Fixed here so the page never has to guess an order from object keys.
const LABEL_KEYS = ['gender', 'age', 'accent', 'descriptive', 'language', 'use_case'];

const elKey = () => {
  try {
    const s = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'settings.json'), 'utf8'));
    return String(s.elevenLabsApiKey || process.env.ELEVENLABS_API_KEY || '').trim();
  } catch (e) { return String(process.env.ELEVENLABS_API_KEY || '').trim(); }
};

function read() {
  try {
    const v = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return Array.isArray(v) ? v.filter(Boolean) : [];
  } catch (e) { return []; }
}

function write(list) {
  fs.writeFileSync(FILE, JSON.stringify(Array.isArray(list) ? list : [], null, 2), 'utf8');
}

const get = (voiceId) => read().find(e => String(e.voiceId) === String(voiceId)) || null;

// MERGE, never replace. Two different moments write to one entry - the take knows
// the demo, a later read knows the tags - and a plain assignment from either would
// drop what the other had learned. Only keys actually present in `patch` are set.
function upsert(patch) {
  const voiceId = String((patch && patch.voiceId) || '').trim();
  if (!voiceId) throw new Error('a shelf entry needs a voiceId');
  const list = read();
  const at = list.findIndex(e => String(e.voiceId) === voiceId);
  const before = at >= 0 ? list[at] : { id: voiceId, voiceId, date: new Date().toISOString() };
  const next = { ...before };
  for (const [k, v] of Object.entries(patch)) if (v !== undefined) next[k] = v;
  next.id = next.id || voiceId;               // the library shelf addresses items by id
  if (at >= 0) list[at] = next; else list.push(next);
  write(list);
  return next;
}

function remove(voiceId) {
  const list = read();
  const next = list.filter(e => String(e.voiceId) !== String(voiceId));
  if (next.length === list.length) return null;
  const gone = list.find(e => String(e.voiceId) === String(voiceId));
  write(next);
  return gone;
}

// Everything the account knows about one voice. Returns null rather than throwing:
// every caller is doing something else that matters more (taking a voice, freeing a
// slot), and losing the tags is a worse entry, not a failed operation.
//
// `sharing.public_owner_id` plus the voice id is the pair that can add it back. For a
// voice copied from the shared library `sharing.original_voice_id` equals the account
// id - verified against the live account - so one id covers both, but the original is
// kept anyway for the case where they ever differ.
async function readFacts(voiceId) {
  const key = elKey();
  if (!key || !voiceId) return null;
  try {
    const r = await axios.get(`${EL_BASE}/voices/${encodeURIComponent(voiceId)}`,
      { headers: { 'xi-api-key': key }, timeout: 20000 });
    const d = r.data || {};
    const sh = d.sharing || {};
    const labels = {};
    for (const k of LABEL_KEYS) if (d.labels && d.labels[k]) labels[k] = String(d.labels[k]);
    return {
      name: String(d.name || ''),
      category: String(d.category || ''),
      labels,
      verifiedLanguages: Array.isArray(d.verified_languages) ? d.verified_languages.length : 0,
      previewUrl: String(d.preview_url || ''),
      publicOwnerId: String(sh.public_owner_id || ''),
      sharedVoiceId: String(sh.original_voice_id || ''),
      inAccount: true,
    };
  } catch (e) {
    // 404 is the ordinary case for a voice whose slot has already been freed.
    return null;
  }
}

// Free the account slot. Nothing here decides WHETHER it should go - callers own the
// shared-voice guard - so this is only the request and its bookkeeping.
async function releaseSlot(voiceId) {
  const key = elKey();
  if (!key) return { released: false, reason: 'no ElevenLabs key in settings' };
  try {
    await axios.delete(`${EL_BASE}/voices/${encodeURIComponent(voiceId)}`,
      { headers: { 'xi-api-key': key }, timeout: 20000 });
    return { released: true };
  } catch (e) {
    const d = (e.response && e.response.data) || {};
    const msg = String((d.detail && (d.detail.message || d.detail)) || d.message || e.message);
    // Already gone counts as released: the goal was an empty slot, and it is empty.
    //
    // By the MESSAGE, not the status. ElevenLabs answers a missing voice with 400 and
    // "A voice with ID 'x' was not found." - verified against the live account - so a status
    // check alone would read an absent slot as a failure and leave the shelf claiming the
    // voice is still in the account.
    if ((e.response && e.response.status === 404) || /not found/i.test(msg)) {
      return { released: true, already: true, reason: msg };
    }
    return { released: false, reason: msg };
  }
}

// Put a voice on the shelf at the moment it is taken, filling in the tags from the
// account in the same breath. The demo is OUR file and the caller has just written
// it; everything else is read back rather than guessed from the search card, so the
// entry says what ElevenLabs says.
async function register({ voiceId, name, demo, dur, publicOwnerId, sharedVoiceId, fromCharId, fromCharName }) {
  const facts = await readFacts(voiceId);
  return upsert({
    voiceId,
    name: (facts && facts.name) || name || '',
    demo: demo || undefined,
    dur: (typeof dur === 'number' && dur > 0) ? dur : undefined,
    category: facts ? facts.category : undefined,
    labels: facts ? facts.labels : undefined,
    verifiedLanguages: facts ? facts.verifiedLanguages : undefined,
    previewUrl: facts ? facts.previewUrl : undefined,
    // The card's owner id is authoritative at take time - it is what the add was made
    // with - and the account's copy is the fallback for a backfill.
    publicOwnerId: publicOwnerId || (facts && facts.publicOwnerId) || undefined,
    sharedVoiceId: sharedVoiceId || (facts && facts.sharedVoiceId) || undefined,
    accountRemoved: false,
    fromCharId: fromCharId || undefined,
    fromCharName: fromCharName || undefined,
  });
}

module.exports = { FILE, LABEL_KEYS, elKey, read, write, get, upsert, remove, readFacts, releaseSlot, register };
