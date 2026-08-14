#!/usr/bin/env node
// Drop overlay snapshots that were pinned automatically.
//
// Keeping a render used to freeze the overlay arrangement as a side effect, and a snapshot
// OUTRANKS the live timeline - so those pins keep being served to other projects long after
// the timeline has moved on, which is the surprise the explicit Save was added to end.
// Every existing snapshot predates that button, so none of them was chosen: they all go.
//
// Nothing else is touched. Timelines, clips and renders are untouched; a project simply
// goes back to offering its CURRENT arrangement, which is what it would have offered had
// the automatic pin never happened.
//
//   node scripts/clear-overlay-snapshots.js --dry-run
//   node scripts/clear-overlay-snapshots.js
//
// The version counter is bumped so any open tab notices the file moved under it rather
// than writing over this.

const fs = require('fs');
const path = require('path');

const DRY = process.argv.includes('--dry-run');
const FILE = path.join(__dirname, '..', 'data', 'merge-v3.json');

let cur;
try { cur = JSON.parse(fs.readFileSync(FILE, 'utf8')); }
catch (e) { console.log('no merge-v3.json to clean (' + e.message + ')'); process.exit(0); }

const snaps = cur.snapshots || {};
const keys = Object.keys(snaps);
console.log('timelines:', Object.keys(cur.timelines || {}).length, '| pinned arrangements:', keys.length);
for (const k of keys) {
  const t = snaps[k] || {};
  const n = Object.values(t.tracks || {}).reduce((s, tr) => s + ((tr && tr.clips) || []).length, 0);
  console.log('  -', String(t.title || k).slice(0, 44), '|', n, 'clips | pinned', String(t.at || '').slice(0, 10));
}
if (!keys.length) { console.log('nothing to clear'); process.exit(0); }
if (DRY) { console.log('\nDRY RUN - nothing written'); process.exit(0); }

// tmp + rename, like every other writer here: a half-written store is worse than a stale one.
const next = { version: (+cur.version || 0) + 1, updatedAt: new Date().toISOString(),
               timelines: cur.timelines || {}, hidden: cur.hidden || [], snapshots: {} };
const tmp = FILE + '.tmp';
fs.writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8');
fs.renameSync(tmp, FILE);
console.log('\ncleared', keys.length, 'pinned arrangement(s); version ->', next.version);
