'use strict';

/* migrate-library.js - brings a server-era install's library into a desktop-app library.

       node tools/migrate-library.js --from <server install> --to <library>            (a dry run)
       node tools/migrate-library.js --from <server install> --to <library> --apply

   Without --apply nothing is written anywhere: it says what it would copy, what it leaves behind
   and why, and whether anything stands in the way. The server install is only ever read, so the
   old app keeps working while and after this runs.

   WHAT IT DOES
     - copies every media file to its folder in media/ (lib/layout.js says which), keeping its
       modified time - several shelves sort by it. That is layout 5, the desktop library before
       project folders: the copy is then upgraded to layout 6 (lib/library-upgrade.js), which
       sorts it into project, shelf and category folders and sets aside what nothing uses;
     - rewrites every server-era path inside the stores it copies (/uploads/x.jpg becomes
       /media/images/x.jpg) - whole values, keys, and paths inside longer strings alike;
     - carries the settings over without the retired keys, and fills empty key fields from the
       old install's .env, where the server kept R2 and some others. Values are never printed;
     - checks, afterwards, that every path the new stores hold is a file that exists and that no
       server-era path is left in them, and writes the report to <library>/logs/.
   Running it again is safe: a file already copied with the same size and time is skipped.

   WHAT IT LEAVES BEHIND, on purpose (decided with the owner - docs/local-app/PLAN.md):
     - what belongs to the server: its users and session secret, logs, scratch (temp_files,
       temp_public), old export volumes (data/exports), data/backups, the character trace log;
     - queues of unfinished work: on a new library they describe jobs that will never come back;
     - features the desktop app no longer has, with their stores and their files: the first
       Scenarios (scenarios/, scenarios-v2), the old UGC editor, Edit v2, VSL, references and
       details, Pose Studio's models, the custom options' pictures, the old renders' records
       (SKIP_MEDIA and SKIP_STORES below);
     - caches the app makes again: thumbnails, pose previews, voice previews.
   The check afterwards counts paths into what was left out on purpose apart from paths lost.

   It refuses a library of the desktop app (layout 6) - merging into one went with Import (phase V54, the owner
   2026-10-28): migrate into a new folder and open that. It refuses to write stores over a folder that already has
   some - pass --overwrite-stores when replacing them is the intention. */

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { fromLegacy, rewriteLegacyValue, legacyPathsIn, LEGACY_LEFT_OUT, STORES_LEFT_OUT } = require('../lib/layout');
const { writeFileAtomic } = require('../lib/atomic-write');
const UPGRADE = require('../lib/library-upgrade');

// ── arguments ───────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const FROM = opt('--from') && path.resolve(opt('--from'));
const TO = opt('--to') && path.resolve(opt('--to'));
const APPLY = args.includes('--apply');
const OVERWRITE_STORES = args.includes('--overwrite-stores');

function fail(msg) { console.error(`[migrate] ${msg}`); process.exit(1); }
if (!FROM || !TO) fail('usage: node tools/migrate-library.js --from <server install> --to <library> [--apply] [--overwrite-stores]');
const within = (a, b) => a === b || a.startsWith(b + path.sep);
if (within(TO, FROM) || within(FROM, TO)) fail('--from and --to must be separate folders, neither inside the other');
// A library of the desktop app is not migrated into (merging went with Import, phase V54).
if (fs.existsSync(TO) && UPGRADE.layoutOf(TO) === 6 && fs.existsSync(path.join(TO, 'data'))) {
  fail(`${TO} is a library of the desktop app already - migrate into a new folder and open that`);
}
const LIB = TO;
if (!fs.existsSync(path.join(FROM, 'data')) || !fs.existsSync(path.join(FROM, 'uploads'))) {
  fail(`${FROM} does not look like a server-era install (no data/ and uploads/ in it)`);
}

// ── what is copied ──────────────────────────────────────────────────────────
// Folder in the server install -> the address prefix its files had.
const MEDIA_SOURCES = [
  ['uploads', '/uploads'], ['characters', '/characters'], ['obrazy', '/obrazy'], ['lookbooks', '/lookbooks'],
  ['environments', '/environments'], ['refs', '/refs'], ['details', '/details'], ['finals', '/finals'],
  ['hooks', '/hooks'], ['scenes', '/scenes'], ['archive', '/archive'],
  // Written into public/ while the server ran. Both are left out now; walked only to say so.
  ['public/voice-previews', '/voice-previews'], ['public/models', '/models'],
];
// What is left out: lib/layout.js.
const SKIP_MEDIA = LEGACY_LEFT_OUT;
const SKIP_STORES = STORES_LEFT_OUT;
// Folders inside data/ that are copied whole (and rewritten, being JSON).
const DATA_DIRS = ['transcripts'];
const LEFT_BEHIND = ['data/exports', 'data/backups', 'data/ass_cache', 'data/uploads', 'data/cop-images',
  'data/cv2-trace.jsonl', 'data/.session-secret', 'data/.obrazy-migrated', 'temp_files', 'temp_public',
  'logs', 'vsl', 'scenarios'];

const RETIRED_KEYS = ['imgbbApiKey', 'partnerApiKey', 'partnerUrl'];
const ENV_KEYS = {
  KIE_AI_API_KEY: 'kieApiKey', GROQ_API_KEY: 'groqApiKey', REPLICATE_API_TOKEN: 'replicateApiKey',
  R2_ACCOUNT_ID: 'r2AccountId', R2_ACCESS_KEY_ID: 'r2AccessKeyId', R2_SECRET_ACCESS_KEY: 'r2SecretAccessKey',
  R2_BUCKET: 'r2Bucket', R2_PUBLIC_BASE: 'r2PublicBase',
};

// ── helpers ─────────────────────────────────────────────────────────────────
const MB = (b) => `${(b / 1048576).toFixed(1)} MB`;
const lines = [];
const say = (s = '') => { lines.push(s); console.log(s); };

function walkFiles(root, visit) {
  let entries;
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = path.join(root, e.name);
    if (e.isDirectory()) walkFiles(p, visit);
    else if (e.isFile()) visit(p);
  }
}

function sizeOf(rel) {
  const abs = path.join(FROM, rel);
  if (!fs.existsSync(abs)) return null;
  if (fs.statSync(abs).isFile()) return fs.statSync(abs).size;
  let b = 0;
  walkFiles(abs, (p) => { b += fs.statSync(p).size; });
  return b;
}

// Every path a store holds, in its values and its keys (some stores are indexed by path). A string
// that IS a path is taken whole - render names carry spaces; a longer one is searched.
function mediaPathsIn(v, out) {
  if (typeof v === 'string') {
    if (/^\/(?:media|cache)\//.test(v)) out.push(v.split(/[?#]/)[0]);
    else for (const m of v.matchAll(/\/(?:media|cache)\/[^"'\s)\\<>?#&]+/g)) out.push(m[0]);
  } else if (Array.isArray(v)) v.forEach((x) => mediaPathsIn(x, out));
  else if (v && typeof v === 'object') Object.entries(v).forEach(([k, x]) => { mediaPathsIn(k, out); mediaPathsIn(x, out); });
  return out;
}

// ── plan ────────────────────────────────────────────────────────────────────
const copies = [];                       // { src, dest, size, mtime, url, to }
const skipped = new Map();               // reason -> [count, bytes]
const skippedTo = new Set();             // where the files left out would have gone - for the check
const unmapped = [];
const perFolder = new Map();             // media/clips -> [count, bytes]
for (const [dir, prefix] of MEDIA_SOURCES) {
  walkFiles(path.join(FROM, dir), (src) => {
    const rel = path.relative(path.join(FROM, dir), src).split(path.sep).join('/');
    const url = `${prefix}/${rel}`;
    const st = fs.statSync(src);
    const skip = SKIP_MEDIA.find(([re]) => re.test(url));
    if (skip) {
      const s = skipped.get(skip[1]) || [0, 0]; s[0]++; s[1] += st.size; skipped.set(skip[1], s);
      const would = fromLegacy(url);
      if (would) skippedTo.add(would);
      return;
    }
    const to = fromLegacy(url);
    if (!to) { unmapped.push(url); return; }
    const dest = path.join(LIB, ...to.slice(1).split('/'));
    copies.push({ src, dest, size: st.size, mtime: st.mtime, url, to });
    const folder = to.split('/').slice(1, 3).join('/');
    const f = perFolder.get(folder) || [0, 0]; f[0]++; f[1] += st.size; perFolder.set(folder, f);
  });
}
const byDest = new Map();
const collisions = [];
for (const c of copies) {
  const key = c.dest.toLowerCase();       // Windows and macOS file names ignore case
  if (byDest.has(key)) collisions.push(`${byDest.get(key).url} and ${c.url} -> ${c.to}`);
  else byDest.set(key, c);
}

const stores = [];                       // paths relative to data/, the same in both libraries
const DATA = path.join(FROM, 'data');
const sourceOf = (rel) => path.join(DATA, ...rel.split('/'));
for (const e of fs.readdirSync(DATA, { withFileTypes: true })) {
  if (e.isFile() && e.name.endsWith('.json')) {
    if (SKIP_STORES[e.name]) { const s = skipped.get(`data/${e.name}: ${SKIP_STORES[e.name]}`) || [0, 0]; s[0]++; skipped.set(`data/${e.name}: ${SKIP_STORES[e.name]}`, s); continue; }
    stores.push(e.name);
  }
}
for (const d of DATA_DIRS) {
  walkFiles(path.join(DATA, d), (p) => stores.push(path.relative(DATA, p).split(path.sep).join('/')));
}
const existingStores = stores.filter((s) => fs.existsSync(path.join(LIB, 'data', s)));

// Paths the old stores ALREADY pointed at nothing with - a deleted file whose record stayed. The
// check after copying has to tell those apart from anything this run loses.
const OLD_DISK = { 'voice-previews': 'public/voice-previews', models: 'public/models' };
const brokenBefore = new Set();
function legacyPathsInValue(v, out) {
  if (typeof v === 'string') {
    if (fromLegacy(v)) out.push(v.split(/[?#]/)[0]);
    else out.push(...legacyPathsIn(v));
  } else if (Array.isArray(v)) v.forEach((x) => legacyPathsInValue(x, out));
  else if (v && typeof v === 'object') Object.entries(v).forEach(([k, x]) => { legacyPathsInValue(k, out); legacyPathsInValue(x, out); });
  return out;
}
for (const rel of stores) {
  let value;
  try { value = JSON.parse(fs.readFileSync(sourceOf(rel), 'utf8')); } catch { continue; }
  for (const hit of legacyPathsInValue(value, [])) {
    const [, top, ...rest] = hit.split('/');
    if (!fs.existsSync(path.join(FROM, ...(OLD_DISK[top] || top).split('/'), ...rest))) {
      const to = fromLegacy(hit);
      if (to) brokenBefore.add(to);
    }
  }
}

// ── report the plan ─────────────────────────────────────────────────────────
say(`[migrate] ${APPLY ? 'APPLYING' : 'dry run'} - from ${FROM}`);
say(`[migrate]            to ${TO}`);
say('');
say('media, by folder:');
let totalBytes = 0;
for (const [f, [n, b]] of [...perFolder.entries()].sort()) { say(`  ${f.padEnd(20)} ${String(n).padStart(6)} files ${MB(b).padStart(11)}`); totalBytes += b; }
say(`  ${'total'.padEnd(20)} ${String(copies.length).padStart(6)} files ${MB(totalBytes).padStart(11)}`);
say('');
say(`stores: ${stores.length} to copy, with their paths rewritten`);
say(`  ${brokenBefore.size} of the paths in them already point at nothing in the old install (deleted files)`);
say('');
say('skipped:');
for (const [why, [n, b]] of skipped) say(`  ${String(n).padStart(6)} ${b ? MB(b).padStart(10) : ''.padStart(10)}  ${why}`);
say('left behind:');
for (const rel of LEFT_BEHIND) { const b = sizeOf(rel); if (b != null) say(`  ${rel.padEnd(28)} ${MB(b)}`); }
say('');
if (unmapped.length) { say(`NOT MAPPED - ${unmapped.length} files lib/layout.js has no place for:`); unmapped.slice(0, 30).forEach((u) => say(`  ${u}`)); }
if (collisions.length) { say(`COLLISIONS - ${collisions.length} files would land on the same name:`); collisions.slice(0, 30).forEach((c) => say(`  ${c}`)); }
if (existingStores.length && !OVERWRITE_STORES) {
  say(`STORES ALREADY THERE - ${existingStores.length} in ${path.join(LIB, 'data')}: ${existingStores.slice(0, 8).join(', ')}${existingStores.length > 8 ? ', ...' : ''}`);
  say('  pass --overwrite-stores to replace them');
}
const blocked = unmapped.length || collisions.length || (existingStores.length && !OVERWRITE_STORES);

if (!APPLY) {
  say('');
  say(blocked ? '[migrate] dry run: fix the above before --apply' : '[migrate] dry run: nothing stands in the way - run again with --apply');
  process.exit(blocked ? 1 : 0);
}
if (blocked) fail('refusing to apply - see above');

// ── apply ───────────────────────────────────────────────────────────────────
(async () => {
  const t0 = Date.now();
  let copied = 0, same = 0, copiedBytes = 0, lastNote = Date.now();
  for (const c of copies) {
    try {
      const st = fs.statSync(c.dest);
      if (st.size === c.size && Math.abs(st.mtimeMs - c.mtime.getTime()) < 2000) { same++; continue; }
    } catch { /* not there yet */ }
    fs.mkdirSync(path.dirname(c.dest), { recursive: true });
    const part = c.dest + '.part';
    await fs.promises.copyFile(c.src, part);
    fs.utimesSync(part, c.mtime, c.mtime);
    fs.renameSync(part, c.dest);
    copied++; copiedBytes += c.size;
    if (Date.now() - lastNote > 5000) {
      lastNote = Date.now();
      console.log(`[migrate] ${copied + same}/${copies.length} files, ${MB(copiedBytes)} copied`);
    }
  }
  say('');
  say(`copied ${copied} files (${MB(copiedBytes)}), ${same} already in place, in ${Math.round((Date.now() - t0) / 1000)}s`);

  // Stores, rewritten.
  const env = fs.existsSync(path.join(FROM, '.env')) ? dotenv.parse(fs.readFileSync(path.join(FROM, '.env'))) : {};
  let rewritten = 0;
  const written = [];
  for (const rel of stores) {
    const src = sourceOf(rel);
    let value;
    try { value = JSON.parse(fs.readFileSync(src, 'utf8')); }
    catch (e) { say(`  ! ${rel} is not valid JSON (${e.message}) - copied as it was`); value = undefined; }
    const dest = path.join(LIB, 'data', ...rel.split('/'));
    if (value === undefined) { fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.copyFileSync(src, dest); continue; }
    const counter = { n: 0 };
    let next = rewriteLegacyValue(value, counter);
    if (rel === 'settings.json') {
      for (const k of RETIRED_KEYS) delete next[k];
      const moved = [];
      for (const [envName, field] of Object.entries(ENV_KEYS)) {
        if (!String(next[field] || '').trim() && String(env[envName] || '').trim()) { next[field] = env[envName].trim(); moved.push(field); }
      }
      if (moved.length) say(`  settings: filled from the old .env - ${moved.join(', ')}`);
    }
    writeFileAtomic(dest, JSON.stringify(next, null, 2));
    rewritten += counter.n;
    written.push([rel, next]);
  }
  say(`stores: ${written.length} written, ${rewritten} paths rewritten`);

  // Check: every path the new stores hold is a file that is there - or was already missing.
  let paths = 0, stillBroken = 0, leftOut = 0;
  const lost = new Map();
  for (const [rel, value] of written) {
    for (const p of mediaPathsIn(value, [])) {
      paths++;
      if (fs.existsSync(path.join(LIB, ...p.slice(1).split('/')))) continue;
      if (brokenBefore.has(p)) { stillBroken++; continue; }
      if (skippedTo.has(p)) { leftOut++; continue; }
      const l = lost.get(rel) || []; l.push(p); lost.set(rel, l);
    }
  }
  const lostCount = [...lost.values()].reduce((n, l) => n + l.length, 0);
  say(`check: ${paths} paths in the new stores; ${stillBroken} point at nothing as they already did; `
    + `${leftOut} point at files left out on purpose; ${lostCount} LOST by this run`);
  for (const [rel, l] of lost) say(`  ${l.length} in ${rel}, e.g. ${l[0]}`);

  // And no server-era path is left in them: one the map had no place for would stay as it was, and
  // the check above - which looks for the new paths - would never see it.
  const untranslated = written.map(([rel, value]) => [rel, legacyPathsIn(JSON.stringify(value))]).filter(([, l]) => l.length);
  say(`check: ${untranslated.reduce((n, [, l]) => n + l.length, 0)} server-era paths left untranslated`);
  for (const [rel, l] of untranslated) say(`  ${l.length} in ${rel}, e.g. ${l[0]}`);

  // Layout 6: sorted into folders, what nothing uses set aside.
  const up = UPGRADE.upgrade(LIB, { log: (s) => say(s) });
  if (up.upgraded) say(`upgrade: ${up.report.unreferenced} files nothing uses set aside in ${up.backup}; ${up.newlyMissing.length} paths lost by it`);

  const logDir = path.join(TO, 'logs');
  fs.mkdirSync(logDir, { recursive: true });
  const logFile = path.join(logDir, `migration-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`);
  fs.writeFileSync(logFile, lines.join('\n') + '\n');
  console.log(`[migrate] done - report in ${logFile}`);
})().catch((e) => fail(e.stack || e.message));
