#!/usr/bin/env node
// Bring the scenario TEXTS out of an older checkout into this app's scenario library.
//
// The two apps are not versions of one store: the old one kept scenarios in
// data/scenarios-v2.json and, separately, an edit session per project in
// data/edit-state.json whose cells each carry one spoken line. The new store wants
// { title, lines[{text}], roles[0].gender } and nothing else is required. So this
// reads the old files and POSTs through the running app's own API - the schema is
// never written by hand from out here.
//
// What it deliberately does NOT bring: the generated media. Those paths point into
// the OTHER checkout's uploads/, and the new fragment model stores audio and video as
// records with provenance (said/fromAudio/fromFrame/preset), not as bare paths. That
// is a separate migration, with the files copied first.
//
//   node scripts/import-old-scenarios.js --dry-run
//   node scripts/import-old-scenarios.js
//   node scripts/import-old-scenarios.js --old /root/ugc-test/data --api http://localhost:3000
//
// Re-running is safe: every record carries a stable id derived from its source, so a
// second run updates the same scenarios instead of making a second copy of each.

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : dflt;
};
const DRY = args.includes('--dry-run');
const OLD = flag('old', '/root/ugc-test/data');
const API = flag('api', 'http://localhost:3000') + '/api/scen3';
const MIN_LINES = 5;

// The narrator's gender is required by the new store and lives on roles[0].gender.
// Old records say "any" there, so it is recovered from the role first and from the
// title marker ("- f -" / "- m -") second. Anything still unknown is REPORTED, never
// guessed: a scenario filed under the wrong narrator is worse than one left behind.
function genderOf(title, roles) {
  const r = (roles || []).find(x => /^(male|female)$/i.test((x && x.gender) || ''));
  if (r) return r.gender.toLowerCase();
  if (/\s-\s?f\s?-\s/i.test(title)) return 'female';
  if (/\s-\s?m\s?-\s/i.test(title)) return 'male';
  return null;
}
const slug = (s) => String(s).replace(/[^a-z0-9]+/gi, '_').slice(0, 44);
const readJson = (p, dflt) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return dflt; } };

function collect() {
  const take = [], leave = [];

  const S = readJson(path.join(OLD, 'scenarios-v2.json'), []);
  for (const s of (Array.isArray(S) ? S : (S.items || S.scenarios || S.list || []))) {
    const title = String((s && s.title) || '').trim();
    const lines = ((s && s.lines) || []).map(l => ({ text: String((l && l.text) || '').trim() })).filter(l => l.text);
    const gender = genderOf(title, s && s.roles);
    if (lines.length < MIN_LINES || !gender) { leave.push({ title, n: lines.length, why: !gender ? 'no gender' : 'too few lines' }); continue; }
    take.push({
      id: 'mig_v2_' + ((s && s.id) || slug(title)), title, lines, gender,
      // The server coerces `vertical` to a string; the old value is {id,label}, which
      // would arrive as "[object Object]" if passed straight through.
      vertical: (s.vertical && (s.vertical.label || s.vertical.id)) || '',
    });
  }

  const E = readJson(path.join(OLD, 'edit-state.json'), {});
  for (const key of Object.keys((E && E.sessions) || {})) {
    const s = E.sessions[key] || {};
    const title = String(s.title || '').trim();
    const lines = (s.cells || []).map(c => ({ text: String((c && c.line) || '').trim() })).filter(l => l.text);
    const gender = genderOf(title, null);
    if (lines.length < MIN_LINES || !gender) { leave.push({ title: title || key, n: lines.length, why: !gender ? 'no gender' : 'too few lines' }); continue; }
    take.push({ id: 'mig_es_' + slug(key), title: title || 'untitled', lines, gender, vertical: '' });
  }
  return { take, leave };
}

async function libCount() {
  try {
    const d = await (await fetch(API + '/scenarios?lib=library1')).json();
    return (d.scenarios || d.items || d.list || []).length;
  } catch (e) { return '?'; }
}

(async () => {
  const { take, leave } = collect();
  console.log('source   :', OLD);
  console.log('target   :', API, DRY ? '(DRY RUN - nothing is written)' : '');
  console.log('ready    :', take.length, '| skipped:', leave.length);

  if (DRY) {
    take.forEach(c => console.log('  +', c.gender, '|', String(c.lines.length).padStart(2), 'lines |', c.title.slice(0, 55)));
    console.log('\nskipped (left where they are):');
    leave.slice(0, 15).forEach(s => console.log('  -', String(s.title).slice(0, 50), '| lines:', s.n, '|', s.why));
    if (leave.length > 15) console.log('  ...and', leave.length - 15, 'more');
    return;
  }

  console.log('library1 before:', await libCount());
  let ok = 0, fail = 0;
  for (const c of take) {
    const body = {
      id: c.id, title: c.title, lines: c.lines, vertical: c.vertical,
      roles: [{ id: 'r0', name: 'Presenter', gender: c.gender }],
    };
    try {
      const r = await fetch(API + '/scenarios', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const d = await r.json();
      if (d && d.success) { ok++; console.log('  +', c.gender, '|', String(c.lines.length).padStart(2), 'lines |', c.title.slice(0, 50)); }
      else { fail++; console.log('  FAIL', c.title.slice(0, 45), '->', (d && d.error) || ('HTTP ' + r.status)); }
    } catch (e) { fail++; console.log('  ERR ', c.title.slice(0, 45), '->', e.message); }
  }
  console.log('\nimported:', ok, '| failed:', fail, '| library1 after:', await libCount());
})();
