'use strict';

// ════════════════════════════════════════════════════════════════════════════
// BACKFILL THE VOICE SHELF from the voices already saved on characters.
//
//   node tools/backfill-voice-shelf.js            what it would write
//   node tools/backfill-voice-shelf.js --write    write it
//
// Every voice taken before lib/voice-shelf.js existed lives only as an entry in
// characters.json: an id, a name and our demo file. Its TAGS and its shared-library
// OWNER are readable from the account and nowhere else - and the account slot is
// exactly what gets freed later to make room. So this has to run while those slots
// are still there; afterwards there is nothing left to read.
//
// Only voices with our own demo on disk are shelved. That is what the shelf is for:
// a voice you can still hear after its slot is gone. data/custom-voices.json is
// deliberately left out - those 16 designed voices never had a demo recorded.
//
// Idempotent: upsert merges by voice id, so running it twice changes nothing.
// ════════════════════════════════════════════════════════════════════════════

const fs   = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const VS   = require(path.join(ROOT, 'lib', 'voice-shelf'));

const WRITE = process.argv.includes('--write');
const CHARS = path.join(ROOT, 'data', 'characters.json');

const onDisk = (webPath) => {
  if (!webPath) return false;
  try { return fs.existsSync(path.join(ROOT, String(webPath).split('?')[0].replace(/^\/+/, ''))); }
  catch (e) { return false; }
};
const abs = (webPath) => path.join(ROOT, String(webPath).split('?')[0].replace(/^\/+/, ''));

// Off ffmpeg's own header dump, the same trick routes/scen3.js uses when it records a
// demo. Only the entries character-v2 wrote are missing a duration - the Scenarios studio
// has always saved one - so this fills the gap rather than replacing anything.
function audioDur(file) {
  return new Promise(resolve => {
    let out = '';
    try {
      const proc = require('child_process').spawn(require('ffmpeg-static'),
        ['-hide_banner', '-i', file], { stdio: ['ignore', 'ignore', 'pipe'] });
      proc.stderr.on('data', c => { out += c.toString(); });
      proc.on('error', () => resolve(0));
      proc.on('close', () => {
        const m = out.match(/Duration:\s*(\d+):(\d+):(\d+\.?\d*)/);
        resolve(m ? (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]) : 0);
      });
    } catch (e) { resolve(0); }
  });
}

(async () => {
  let chars = [];
  try {
    const raw = JSON.parse(fs.readFileSync(CHARS, 'utf8'));
    chars = Array.isArray(raw) ? raw : (raw.characters || []);
  } catch (e) {
    console.error('cannot read characters.json:', e.message);
    process.exit(1);
  }

  // One row per voice id, remembering which character it was found on. A voice on two
  // characters is still one voice, so the first sighting names it.
  //
  // The Scenarios voice studio writes a fuller entry than character-v2 does - it keeps
  // `ownerId`, `dur`, `description` and the labels it saw on the search card. Read those
  // too: they are the same facts the account would give, already saved, and they are the
  // fallback for a voice whose slot cannot be read any more.
  const found = new Map();
  for (const c of chars) {
    if (!c || !Array.isArray(c.voices)) continue;
    for (const v of c.voices) {
      const id = String((v && v.voiceId) || '').trim();
      if (!id || found.has(id)) continue;
      found.set(id, { voiceId: id, name: v.name || '', demo: v.sample || '',
                      ownerId: v.ownerId || '', dur: v.dur || 0,
                      description: v.description || '', labels: v.labels || null,
                      charId: String(c.id), charName: c.name || '' });
    }
  }

  const rows = [...found.values()];
  const shelved = rows.filter(r => onDisk(r.demo));
  const skipped = rows.filter(r => !onDisk(r.demo));

  console.log(`characters: ${chars.length}  voices found: ${rows.length}  with a demo on disk: ${shelved.length}`);
  for (const r of skipped) console.log(`  SKIP ${r.voiceId}  ${r.name}  (no demo file: ${r.demo || 'none'})`);
  console.log('');

  const already = new Set(VS.read().map(e => String(e.voiceId)));

  for (const r of shelved) {
    const facts = await VS.readFacts(r.voiceId);
    if (!r.dur) r.dur = Math.round((await audioDur(abs(r.demo))) * 100) / 100;
    const tags = facts ? VS.LABEL_KEYS.map(k => facts.labels[k]).filter(Boolean).join(' / ') : '';
    console.log(`  ${already.has(r.voiceId) ? 'update' : 'NEW   '} ${r.voiceId}  ${(facts && facts.name) || r.name}`);
    console.log(`         used by: ${r.charName}`);
    console.log(`         account: ${facts ? facts.category + ', slot present' : 'NOT READABLE - the slot is already gone'}`);
    if (facts) {
      console.log(`         tags   : ${tags || '(none)'}    verified languages: ${facts.verifiedLanguages}`);
      console.log(`         owner  : ${facts.publicOwnerId || '(none - not from the shared library)'}`);
    }
    console.log(`         demo   : ${r.demo}`);

    if (WRITE) {
      // The account first, the saved entry second. Both are the same facts; the account is
      // the one that cannot have gone stale.
      const kept = {};
      if (r.labels) for (const k of VS.LABEL_KEYS) if (r.labels[k]) kept[k] = String(r.labels[k]);
      const labels = (facts && Object.keys(facts.labels).length) ? facts.labels
                   : (Object.keys(kept).length ? kept : undefined);
      VS.upsert({
        voiceId: r.voiceId,
        name: (facts && facts.name) || r.name || '',
        demo: r.demo,
        dur: r.dur || undefined,
        description: r.description || undefined,
        category: (facts && facts.category) || (r.labels && r.labels.category) || undefined,
        labels,
        verifiedLanguages: facts ? facts.verifiedLanguages : undefined,
        previewUrl: facts ? facts.previewUrl : undefined,
        publicOwnerId: (facts && facts.publicOwnerId) || r.ownerId || undefined,
        sharedVoiceId: facts ? facts.sharedVoiceId : undefined,
        // A voice whose slot cannot be read is either gone from the account or was never
        // in it. Either way the shelf should not claim it is still there.
        accountRemoved: facts ? false : true,
        fromCharId: r.charId,
        fromCharName: r.charName,
      });
    }
  }

  console.log('');
  console.log(WRITE ? `written: ${VS.read().length} entries in ${VS.FILE}`
                    : 'nothing written - pass --write to commit this');
})().catch(e => { console.error('failed:', e.message); process.exit(1); });
