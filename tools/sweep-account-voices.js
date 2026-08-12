'use strict';

// ════════════════════════════════════════════════════════════════════════════
// SWEEP THE ELEVENLABS ACCOUNT down to the voices we actually keep.
//
//   node tools/sweep-account-voices.js              what it would delete
//   node tools/sweep-account-voices.js --write      do it
//   node tools/sweep-account-voices.js --write --limit 1
//                                                   one voice, to prove the key can
//
// KEEP = the voices on data/voice-shelf.json, which is the store that holds a name, its
// tags, its shared-library owner and our own demo. Everything else in the account goes:
// premade defaults nobody uses, the old Voice Design experiments, the orphans left over
// from taking voices before there was anywhere to record them.
//
// The protected set is the shelf UNION everything a character or a look still references.
// The shelf should already be a superset of that; if it is not, the extra reference is
// protected anyway and the difference is reported. A sweep must never be the thing that
// discovers a store was stale.
//
// Nothing is archived on the way out. A `generated` or `cloned` voice has no shared-library
// owner - verified on three of them - so deleting it is final either way, and the voices we
// want to keep are the ones already on the shelf.
// ════════════════════════════════════════════════════════════════════════════

const fs    = require('fs');
const path  = require('path');
const axios = require('axios');

const ROOT = path.join(__dirname, '..');
const VS   = require(path.join(ROOT, 'lib', 'voice-shelf'));

const WRITE = process.argv.includes('--write');
const LIMIT = (() => {
  const at = process.argv.indexOf('--limit');
  const n = at >= 0 ? parseInt(process.argv[at + 1], 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : Infinity;
})();

const EL = 'https://api.elevenlabs.io/v1';
const rd = (f, fallback) => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'data', f), 'utf8')); } catch (e) { return fallback; } };
const pause = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const key = VS.elKey();
  if (!key) { console.error('no ElevenLabs key in data/settings.json'); process.exit(1); }
  const H = { headers: { 'xi-api-key': key }, timeout: 25000 };

  // ── what we keep ──
  const shelf = new Set(VS.read().map(e => String(e.voiceId)));
  const chars = (() => { const c = rd('characters.json', []); return Array.isArray(c) ? c : (c.characters || []); })();
  const referenced = new Set();
  for (const c of chars.filter(Boolean)) {
    if (c.voice) referenced.add(String(c.voice));
    for (const v of (Array.isArray(c.voices) ? c.voices : [])) if (v && v.voiceId) referenced.add(String(v.voiceId));
  }
  for (const o of (rd('obrazy.json', []) || [])) if (o && o.voice) referenced.add(String(o.voice));

  const keep = new Set([...shelf, ...referenced]);
  const strays = [...referenced].filter(id => !shelf.has(id));
  console.log(`keep: ${keep.size}  (shelf ${shelf.size}, referenced by a character or look ${referenced.size})`);
  if (strays.length) {
    console.log('  NOTE: referenced but NOT on the shelf - protected anyway:');
    for (const id of strays) console.log('        ' + id);
  }
  console.log('');

  // ── what the account holds ──
  let voices = [];
  try {
    voices = (await axios.get(`${EL}/voices`, H)).data.voices || [];
  } catch (e) {
    console.error('cannot list the account:', e.response && e.response.status, e.message);
    process.exit(1);
  }
  // Premade voices are not ours to delete. They are the platform defaults, injected into every
  // account's list with is_owner null; DELETE answers 400 "voice_does_not_exist" and they stay
  // put - measured on two of them. They occupy no slot either, so sweeping them is not a thing
  // that can be done OR a thing worth doing. Named here rather than attempted, so the report
  // says why instead of showing 21 identical refusals.
  const premade = voices.filter(v => v.category === 'premade' && !keep.has(String(v.voice_id)));
  const doomed = voices.filter(v => !keep.has(String(v.voice_id)) && v.category !== 'premade');
  const kept = voices.filter(v => keep.has(String(v.voice_id)));

  const byCat = {};
  for (const v of doomed) byCat[v.category] = (byCat[v.category] || 0) + 1;
  console.log(`account: ${voices.length}  keeping ${kept.length}  deleting ${doomed.length}`
    + `  untouchable ${premade.length} premade`);
  console.log('  to delete by category: ' + (Object.entries(byCat).map(([c, n]) => c + ' ' + n).join(', ') || 'none'));
  console.log('  premade defaults stay: no API deletes them, and they hold no slot');
  console.log('');
  for (const v of kept) console.log('  KEEP   ' + v.voice_id + '  ' + (v.name || '').slice(0, 48));
  console.log('');

  if (!WRITE) {
    for (const v of doomed) console.log('  would delete  ' + v.category.padEnd(13) + v.voice_id + '  ' + (v.name || '').slice(0, 44));
    console.log('');
    console.log(`nothing done - pass --write to delete these ${doomed.length}`);
    return;
  }

  // ── the sweep ──
  // One at a time. A parallel burst against a rate limit half-applies, and a half-swept
  // account is harder to reason about than a slow one.
  let gone = 0;
  const failed = [];
  for (const v of doomed.slice(0, LIMIT === Infinity ? doomed.length : LIMIT)) {
    const r = await VS.releaseSlot(v.voice_id);
    if (r.released) {
      gone++;
      console.log('  deleted ' + v.category.padEnd(13) + v.voice_id + '  ' + (v.name || '').slice(0, 44)
        + (r.already ? '  (was already gone)' : ''));
    } else {
      failed.push({ id: v.voice_id, category: v.category, name: v.name, reason: r.reason });
      console.log('  KEPT    ' + v.category.padEnd(13) + v.voice_id + '  ' + (v.name || '').slice(0, 30) + '  <- ' + r.reason);
    }
    await pause(150);
  }

  // ── the legacy catalog ──
  // data/custom-voices.json is the old designed-voices list. Only entries pointing at a voice
  // we keep survive; on this data that is none of them, which is the point - most of its rows
  // were already pointing at voices the account no longer had.
  const cv = rd('custom-voices.json', []);
  if (Array.isArray(cv) && cv.length) {
    const survive = cv.filter(x => x && keep.has(String(x.voiceId)));
    if (survive.length !== cv.length) {
      fs.writeFileSync(path.join(ROOT, 'data', 'custom-voices.json'), JSON.stringify(survive, null, 2), 'utf8');
      console.log('');
      console.log(`custom-voices.json: ${cv.length} -> ${survive.length} entries`);
    }
  }

  console.log('');
  console.log(`deleted ${gone}, refused ${failed.length}`);
  for (const f of failed) console.log('  ' + f.category + ' ' + f.id + ': ' + f.reason);
  const after = (await axios.get(`${EL}/voices`, H)).data.voices || [];
  console.log(`account now holds ${after.length}` + (LIMIT !== Infinity ? '  (limited run)' : ''));
})().catch(e => { console.error('failed:', e.message); process.exit(1); });
