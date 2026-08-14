#!/usr/bin/env node
// Bring the voice CATALOGUE out of an older checkout onto this app's voice shelf.
//
// The voices themselves were never local: they live in the ElevenLabs account, and both
// apps only ever kept a catalogue pointing at them. So this is not a media migration -
// it is re-registering ids we already own.
//
// The old file (data/custom-voices.json) knows WHICH voices are ours and little else:
// { id, voiceId, name, gender:'f'|'m', desc, createdAt, characterId }. ElevenLabs knows
// the truth about each one, so the account is read once and used as the source for name,
// category, labels and preview; the old file only decides which ids to ask about. A voice
// the account no longer has is REPORTED, not imported - a shelf entry that cannot be
// spoken is worse than an absent one.
//
//   node scripts/import-old-voices.js --dry-run
//   node scripts/import-old-voices.js
//   node scripts/import-old-voices.js --old /root/ugc-test/data
//
// Re-running is safe: the shelf upserts by voiceId, so a second run refreshes the same
// entries rather than adding duplicates.

const fs = require('fs');
const path = require('path');
const shelf = require('../lib/voice-shelf');

const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : dflt;
};
const DRY = args.includes('--dry-run');
const OLD = flag('old', '/root/ugc-test/data');

const SETTINGS = path.join(__dirname, '..', 'data', 'settings.json');
const readJson = (p, dflt) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return dflt; } };

const GENDER = { f: 'female', m: 'male', female: 'female', male: 'male' };

(async () => {
  const raw = readJson(path.join(OLD, 'custom-voices.json'), []);
  const old = Array.isArray(raw) ? raw : (raw.voices || raw.items || []);
  const wanted = old.filter(v => v && v.voiceId);
  console.log('source :', OLD);
  console.log('old catalogue:', old.length, '| with a voiceId:', wanted.length);
  if (!wanted.length) return;

  const key = String((readJson(SETTINGS, {}).elevenLabsApiKey) || '').trim();
  if (!key) { console.log('\nNo ElevenLabs key in data/settings.json - cannot check which voices still exist. Aborting.'); return; }

  // One request for the whole account, rather than one per voice.
  let account = new Map();
  try {
    const r = await fetch('https://api.elevenlabs.io/v1/voices', { headers: { 'xi-api-key': key } });
    const d = await r.json();
    for (const v of (d.voices || [])) account.set(String(v.voice_id), v);
    console.log('account has:', account.size, 'voices');
  } catch (e) {
    console.log('\nCould not read the ElevenLabs account:', e.message, '- aborting rather than importing unverified ids.');
    return;
  }

  const have = new Set(shelf.read().map(e => String(e.voiceId)));
  const live = [], dead = [];
  for (const v of wanted) (account.has(String(v.voiceId)) ? live : dead).push(v);

  console.log('\nstill in the account:', live.length, '| gone:', dead.length, '| already on the shelf:', live.filter(v => have.has(String(v.voiceId))).length);
  if (dead.length) {
    console.log('\ngone from ElevenLabs (not imported):');
    dead.slice(0, 10).forEach(v => console.log('  -', String(v.name || v.voiceId).slice(0, 50)));
    if (dead.length > 10) console.log('  ...and', dead.length - 10, 'more');
  }

  if (DRY) {
    console.log('\nwould import (DRY RUN - nothing written):');
    live.forEach(v => console.log('  +', (GENDER[String(v.gender || '').toLowerCase()] || '?').padEnd(6), '|', String(v.name || '').slice(0, 46), have.has(String(v.voiceId)) ? '(refresh)' : ''));
    return;
  }

  let n = 0;
  for (const v of live) {
    const el = account.get(String(v.voiceId)) || {};
    const labels = { ...(el.labels || {}) };
    // The old file's gender and description are kept only where the account has nothing
    // to say - its own labels are the better source.
    if (!labels.gender && GENDER[String(v.gender || '').toLowerCase()]) labels.gender = GENDER[String(v.gender || '').toLowerCase()];
    if (!labels.descriptive && v.desc) labels.descriptive = String(v.desc);
    shelf.upsert({
      voiceId: String(v.voiceId),
      id: String(v.voiceId),                       // the shelf addresses items by id, and new entries use the voiceId
      name: String(el.name || v.name || '').trim() || String(v.voiceId),
      date: v.createdAt || new Date().toISOString(),
      category: el.category || 'cloned',
      labels,
      previewUrl: el.preview_url || '',
      // `characterId` from the old store is deliberately dropped: it points at a character
      // in the OTHER checkout, and a dangling owner is worse than none.
    });
    n++;
    console.log('  +', String(v.name || v.voiceId).slice(0, 50));
  }
  console.log('\nimported/refreshed:', n, '| shelf now:', shelf.read().length);
})();
