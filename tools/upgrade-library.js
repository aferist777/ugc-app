'use strict';

/* upgrade-library.js - what the layout 6 upgrade (lib/library-upgrade.js) does to a library.

       node tools/upgrade-library.js --library <library>                   a dry run: reads only
       node tools/upgrade-library.js --library <library> --list <file>     ...and every move into <file>
       node tools/upgrade-library.js --library <library> --apply           the upgrade itself

   The app upgrades a library by itself when it starts; this is for looking before it does, and
   for trying it on a copy. The dry run also checks the plan: no two files given one place, no
   place already taken, and no path the stores use left pointing at nothing afterwards.
   Never --apply to a library the app has open - files would move under a running server. */

const fs = require('fs');
const path = require('path');
const U = require('../lib/library-upgrade');

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const LIB = opt('--library') && path.resolve(opt('--library'));
const LIST = opt('--list') && path.resolve(opt('--list'));
const APPLY = args.includes('--apply');

function fail(msg) { console.error(`[upgrade] ${msg}`); process.exit(1); }
if (!LIB) fail('usage: node tools/upgrade-library.js --library <library> [--list <file>] [--apply]');
if (!fs.existsSync(path.join(LIB, 'data'))) fail(`${LIB} has no data/ - not a library`);
if (LIST && (LIST === LIB || LIST.startsWith(LIB + path.sep))) fail('--list must be written outside the library');

const MB = (b) => `${(b / 1048576).toFixed(0)} MB`;
const layout = U.layoutOf(LIB);
console.log(`library: ${LIB}\nlayout:  ${layout === 0 ? 'empty' : layout}`);

if (APPLY) {
  const r = U.upgrade(LIB, { log: (s) => console.log(s) });
  if (!r.upgraded && !(r.timelines && r.timelines.converted) && !(r.twins && r.twins.dropped)
    && !(r.language && r.language.records)) console.log('nothing to upgrade');
  process.exit(r.newlyMissing && r.newlyMissing.length ? 2 : 0);
}
// The timelines' step reads projects/*/merge/, which a layout 5 library does not have yet: counted
// here only for a library already in layout 6.
if (layout === 6) {
  let talking = 0;
  const P = path.join(LIB, 'projects');
  for (const d of (fs.existsSync(P) ? fs.readdirSync(P) : [])) {
    const M = path.join(P, d, 'merge');
    for (const f of (fs.existsSync(M) ? fs.readdirSync(M).filter((x) => x.endsWith('.json')) : [])) {
      try { const doc = JSON.parse(fs.readFileSync(path.join(M, f), 'utf8')); if (doc.tracks && !Array.isArray(doc.tracks) && doc.kind !== 'blank') talking++; } catch (e) { /* unreadable */ }
    }
  }
  console.log(talking ? `talking-head timelines to rewrite: ${talking}` : 'no talking-head timelines');
  // (V26.8) The doubled cells of an old send (lib/timeline-twins.js), counted without writing.
  const tw = require('../lib/timeline-twins').dropLibrary(LIB, { dry: true });
  console.log(tw.dropped ? `doubled cells of an old send to take off: ${tw.dropped} in ${tw.timelines} timeline(s)` : 'no doubled cells');
  for (const w of tw.which) console.log(`  ${w}`);
  // (V29) A scenario's language in the stores (lib/drop-language.js), counted without writing.
  const lg = require('../lib/drop-language').dropLibrary(LIB, { dry: true });
  console.log(lg.records ? `scenario language to take out: ${lg.records} record(s) in ${lg.stores} store(s)` : 'no scenario language');
  for (const w of lg.which) console.log(`  ${w}`);
}
if (layout !== 5) { console.log('nothing to upgrade'); process.exit(0); }

const t0 = Date.now();
const p = U.plan(LIB, { backup: 'backups/<date> layout 6' });
const r = p.report;
console.log(`planned in ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);
console.log(`projects ${r.projects}, timelines ${r.timelines} (${r.mergeProjects} in Merge projects of their own), new categories ${r.newCategories}`);
console.log('files to move:');
for (const [k, n] of Object.entries(r.place).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(6)}  ${k}`);
console.log(`  ${String(p.moves.length).padStart(6)}  in all, with what belongs to them (thumbnails, previews)`);
console.log(`already in place ${r.inPlace}, staying where they are ${r.kept}`);
console.log(`nothing uses ${r.unreferenced} files, ${MB(r.unreferencedBytes)} - set aside:`);
for (const [k, b] of Object.entries(r.unreferencedBy).sort((a, c) => c[1].bytes - a[1].bytes)) {
  console.log(`  ${String(b.files).padStart(6)}  ${MB(b.bytes).padStart(8)}  ${k}`);
}

// ── Checks ──
const problems = [];
const lower = (s) => s.toLowerCase();
const dests = new Map();
for (const [from, to] of [...p.moves, ...p.unreferenced]) {
  const k = lower(to);
  if (dests.has(k)) problems.push(`two files for one place: ${dests.get(k)} and ${from} -> ${to}`);
  dests.set(k, from);
  if (fs.existsSync(path.join(LIB, to))) problems.push(`the place is taken: ${from} -> ${to}`);
}
const map = new Map(p.moves);
const setAside = new Set(p.unreferenced.map(([f]) => lower(f)));
const stores = U.readStores(LIB);
const before = new Set(U.missingPaths(LIB));
const { writes, deletes } = U.buildStores(stores, p, map);
// After: every file where the plan puts it. A path names a file when it was moved there, or when it
// was not moved and neither set aside nor missing already.
const back = new Map(p.moves.map(([f, t]) => [lower(t), f]));
const namesFile = (u) => {
  const src = back.get(lower(u)) || u;
  if (setAside.has(lower(src))) return false;
  return fs.existsSync(path.join(LIB, src));
};
const after = { data: {}, docs: {} };
for (const [rel, v] of Object.entries(writes)) {
  if (rel.startsWith('data/')) after.data[rel.slice(5)] = v; else after.docs[rel] = v;
}
for (const [f, v] of Object.entries(stores.data)) if (!(`data/${f}` in writes) && !deletes.includes(`data/${f}`)) after.data[f] = v;
for (const [rel, v] of Object.entries(stores.docs)) if (!(rel in writes)) after.docs[rel] = v;
const usedAfter = new Set();
const collect = (v) => {
  if (typeof v === 'string') { if (/^\/(media|projects)\//.test(v)) usedAfter.add(v.split(/[?#]/)[0]); return; }
  if (Array.isArray(v)) { v.forEach(collect); return; }
  if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { if (/^\/(media|projects)\//.test(k)) usedAfter.add(k.split(/[?#]/)[0]); collect(x); }
};
for (const [f, v] of Object.entries(after.data)) {
  if (f === 'ui-state.json') {
    for (const [k, x] of Object.entries(v)) {
      if (U.DEAD_UI_KEYS.has(k) || typeof x !== 'string') continue;
      try { collect(JSON.parse(x)); } catch (e) { collect(x); }
    }
  } else if (f === 'biroly.json') collect(v.archive);
  else collect(v);
}
for (const v of Object.values(after.docs)) collect(v);
const lost = [...usedAfter].filter((u) => !before.has(back.get(lower(u)) || u) && !namesFile(u));
for (const u of lost.slice(0, 20)) problems.push(`would name no file: ${u}`);
if (lost.length > 20) problems.push(`...and ${lost.length - 20} more`);

console.log(`\nstores: ${Object.keys(writes).length} written, ${deletes.length} removed (${deletes.join(', ')})`);
console.log(`paths the stores use that name no file already: ${before.size}`);
console.log(problems.length ? `\nPROBLEMS (${problems.length}):\n  ${problems.join('\n  ')}` : '\nchecks: no two files for one place, no place taken, no used path left pointing at nothing');

if (LIST) {
  const lines = [];
  lines.push('# project folders');
  for (const [, id, folder] of p.projects) lines.push(`project\t${id}\t${folder}`);
  for (const e of p.mergeProjects) lines.push(`merge project\t${e.id}\t${e.folder}`);
  lines.push('# timelines');
  for (const [key, folder, file] of p.timelines) lines.push(`timeline\t${key}\t${folder}/merge/${file}`);
  lines.push('# categories');
  for (const [k, c] of Object.entries(p.cats)) for (const x of c.own) lines.push(`category\t${k}\t${x.id}\t${x.label}\t${x.folder}`);
  lines.push('# moves');
  for (const [f, t] of p.moves) lines.push(`move\t${f}\t${t}`);
  lines.push('# set aside');
  for (const [f] of p.unreferenced) lines.push(`aside\t${f}`);
  fs.writeFileSync(LIST, lines.join('\n') + '\n');
  console.log(`\nthe whole plan: ${LIST}`);
}
process.exit(problems.length ? 2 : 0);
