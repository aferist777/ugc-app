'use strict';

/* relocate.js - move files in the library and every stored path that points at them.

   The one way a file changes place while the app runs (docs/local-app/PLAN.md, phase 2): a project
   or a category renamed, a clip given another category or kind, a category deleted, a project
   deleted with files other projects still use. In that order:
     1. the files move, each with what is derived from it and lives beside it - thumbs/<name>.jpg,
        thumbs/<name>_thumb.jpg, preview/<name>.jpg, <file>.norm (the loudness mark);
     2. every store is rewritten: the JSON files in data/ and every project's project.json and
        merge/*.json, values and object keys alike, and the localStorage mirror in ui-state.json,
        whose values are JSON inside strings;
     3. lib/moves.js remembers old -> new, for the pages that are still open;
     4. (phase V54, (зв37)) what is cached for a moved file - the preview's copy of a film, /api/thumb's sizes of a
        picture - is renamed to the key its new path gives (lib/cache-carry.js), so nothing is made again.

   A move is a pair of addresses. A folder pair ends in '/' on both sides and moves everything under
   it; a file pair names one file. Paths are rewritten whole - a string that IS the address, or
   starts with a moved folder - never inside running text. */

const fs = require('fs');
const path = require('path');
const { DATA_DIR, PROJECTS_DIR } = require('./config');
const { toDisk } = require('./media');
const { writeFileAtomic } = require('./atomic-write');
const moves = require('./moves');

// Stores that hold no library paths, or must not be rewritten: the memory of moves itself.
const SKIP_STORES = new Set(['moves.json', 'settings.json', 'pending-tasks.json']);

const _isLib = (s) => s.startsWith('/media/') || s.startsWith('/projects/');

// Every JSON file a stored path can live in.
function storeFiles() {
  const out = [];
  try {
    for (const f of fs.readdirSync(DATA_DIR)) {
      if (f.endsWith('.json') && !SKIP_STORES.has(f)) out.push(path.join(DATA_DIR, f));
    }
  } catch (e) { /* no data yet */ }
  let projects = [];
  try { projects = fs.readdirSync(PROJECTS_DIR, { withFileTypes: true }).filter((d) => d.isDirectory()); } catch (e) { /* none */ }
  for (const d of projects) {
    const dir = path.join(PROJECTS_DIR, d.name);
    if (fs.existsSync(path.join(dir, 'project.json'))) out.push(path.join(dir, 'project.json'));
    try {
      for (const f of fs.readdirSync(path.join(dir, 'merge'))) if (f.endsWith('.json')) out.push(path.join(dir, 'merge', f));
    } catch (e) { /* no timelines */ }
    // A scene of the 3D Studio (lib/studio3d-store.js): its pictures, its photo and its recordings are addresses.
    try {
      for (const f of fs.readdirSync(path.join(dir, '3d'))) if (f.endsWith('.json')) out.push(path.join(dir, '3d', f));
    } catch (e) { /* not a scene */ }
    // A highlights project (phase V33.1, lib/highlights-store.js): its fragments' pictures and pieces are addresses.
    if (fs.existsSync(path.join(dir, 'highlights.json'))) out.push(path.join(dir, 'highlights.json'));
    // (phase V78) THIS PROJECT's links (lib/project-links.js): each names its file by its address.
    if (fs.existsSync(path.join(dir, 'links.json'))) out.push(path.join(dir, 'links.json'));
  }
  return out;
}

// pairs [{from, to}] -> a function from an address to where it is now (the same string when it
// did not move). A file pair beats a folder pair; the longest folder wins.
function mapper(pairs) {
  const files = new Map();
  const folders = [];
  for (const p of pairs || []) {
    if (!p || !p.from || !p.to || p.from === p.to) continue;
    if (p.from.endsWith('/')) folders.push(p); else files.set(p.from, p.to);
  }
  folders.sort((a, b) => b.from.length - a.from.length);
  return (s) => {
    if (typeof s !== 'string' || !_isLib(s)) return s;
    const cut = s.search(/[?#]/);
    const clean = cut >= 0 ? s.slice(0, cut) : s;
    const tail = cut >= 0 ? s.slice(cut) : '';
    if (files.has(clean)) return files.get(clean) + tail;
    for (const f of folders) if (clean.startsWith(f.from)) return f.to + clean.slice(f.from.length) + tail;
    return s;
  };
}

// A parsed store with every address mapped. `count.n` counts the strings that changed.
function rewriteValue(v, map, count = { n: 0 }) {
  if (typeof v === 'string') {
    const next = map(v);
    if (next !== v) count.n++;
    return next;
  }
  if (Array.isArray(v)) return v.map((x) => rewriteValue(x, map, count));
  if (v && typeof v === 'object') {
    const out = {};
    for (const [k, x] of Object.entries(v)) {
      const nk = map(k);
      if (nk !== k) count.n++;
      out[nk] = rewriteValue(x, map, count);
    }
    return out;
  }
  return v;
}

// ui-state.json mirrors localStorage: every value is a string, and many are JSON.
function _rewriteUiState(state, map, count) {
  const out = {};
  for (const [k, v] of Object.entries(state || {})) {
    if (typeof v !== 'string' || !/\/(media|projects)\//.test(v)) { out[k] = v; continue; }
    let parsed;
    try { parsed = JSON.parse(v); } catch (e) { parsed = undefined; }
    if (parsed !== undefined && typeof parsed === 'object') {
      const before = count.n;
      const next = rewriteValue(parsed, map, count);
      out[k] = count.n !== before ? JSON.stringify(next) : v;
    } else {
      out[k] = rewriteValue(v, map, count);
    }
  }
  return out;
}

// Rewrite every store through `pairs`. Returns { files, strings } changed.
function rewriteStores(pairs) {
  const map = mapper(pairs);
  let files = 0, strings = 0;
  for (const file of storeFiles()) {
    let raw;
    try { raw = fs.readFileSync(file, 'utf8'); } catch (e) { continue; }
    // Cheap test first: a store that names none of the moved addresses is left alone.
    if (!(pairs || []).some((p) => raw.includes(p.from.replace(/\/$/, '')))) continue;
    let data;
    try { data = JSON.parse(raw); } catch (e) { continue; }
    const count = { n: 0 };
    const next = path.basename(file) === 'ui-state.json' && path.dirname(file) === DATA_DIR
      ? _rewriteUiState(data, map, count)
      : rewriteValue(data, map, count);
    if (!count.n) continue;
    writeFileAtomic(file, JSON.stringify(next, null, 2));
    files++; strings += count.n;
  }
  return { files, strings };
}

const _pause = new Int32Array(new SharedArrayBuffer(4));
const _sleep = (ms) => { Atomics.wait(_pause, 0, 0, ms); };
const BUSY = new Set(['EPERM', 'EACCES', 'EBUSY']);

// Rename, or copy and delete when the two places are on different drives. On Windows a file some
// process still has open refuses the rename (EPERM): background work was asked to let go before
// the move (lib/file-release.js), so this waits a little for it - about two seconds in all - and
// says so if the file is still held.
function _move(fromAbs, toAbs) {
  fs.mkdirSync(path.dirname(toAbs), { recursive: true });
  for (let attempt = 1; ; attempt++) {
    try {
      fs.renameSync(fromAbs, toAbs);
      return;
    } catch (e) {
      if (e.code === 'EXDEV') {
        fs.cpSync(fromAbs, toAbs, { recursive: true });
        fs.rmSync(fromAbs, { recursive: true, force: true });
        return;
      }
      if (!BUSY.has(e.code) || attempt >= 7) {
        if (BUSY.has(e.code)) e.message = `${path.basename(fromAbs)} is in use by another program - try again in a moment (${e.code})`;
        throw e;
      }
      _sleep(40 * 2 ** (attempt - 1));
    }
  }
}

// What lives beside a file and belongs to it: [absolute path, name it takes when the file is
// called `newName`] for the ones that exist.
function siblingsOf(fileAbs, newName) {
  const dir = path.dirname(fileAbs);
  const name = path.basename(fileAbs);
  const stem = name.replace(/\.[^.]+$/, '');
  const newStem = newName.replace(/\.[^.]+$/, '');
  const out = [
    [path.join(dir, 'thumbs', stem + '.jpg'), path.join('thumbs', newStem + '.jpg')],
    [path.join(dir, 'thumbs', stem + '_thumb.jpg'), path.join('thumbs', newStem + '_thumb.jpg')],
    [path.join(dir, 'preview', stem + '.jpg'), path.join('preview', newStem + '.jpg')],
    [fileAbs + '.norm', newName + '.norm'],
  ];
  return out.filter(([abs]) => fs.existsSync(abs));
}

// Move one file (address -> address) with its siblings. Returns the address pairs that moved.
function moveFile(fromUrl, toUrl) {
  const fromAbs = toDisk(fromUrl);
  const toAbs = toDisk(toUrl);
  if (!fromAbs || !toAbs) throw new Error(`not a library address: ${!fromAbs ? fromUrl : toUrl}`);
  if (!fs.existsSync(fromAbs)) return [];
  if (fs.existsSync(toAbs)) throw new Error(`already taken: ${toUrl}`);
  const newName = path.basename(toAbs);
  const fromDir = path.posix.dirname(fromUrl);
  const toDir = path.posix.dirname(toUrl);
  const siblings = siblingsOf(fromAbs, newName);
  // The file first: if it cannot move, nothing has.
  _move(fromAbs, toAbs);
  const pairs = [{ from: fromUrl, to: toUrl }];
  // Then what is derived from it. One that cannot move stays behind - it is made again from the
  // file when it is next needed.
  for (const [abs, rel] of siblings) {
    const dest = path.join(path.dirname(toAbs), rel);
    if (fs.existsSync(dest)) continue;         // an older derivative of the same name: leave both
    try {
      _move(abs, dest);
    } catch (e) {
      console.warn('[relocate] left behind', path.basename(abs), '-', e.message);
      continue;
    }
    const relFrom = path.relative(path.dirname(fromAbs), abs).split(path.sep).join('/');
    pairs.push({ from: `${fromDir}/${relFrom}`, to: `${toDir}/${rel.split(path.sep).join('/')}` });
  }
  return pairs;
}

// Move a whole folder (addresses ending in '/'). Returns its pair.
function moveFolder(fromUrl, toUrl) {
  const fromAbs = toDisk(fromUrl + '.');
  const toAbs = toDisk(toUrl + '.');
  if (!fromAbs || !toAbs) throw new Error(`not a library folder: ${!fromAbs ? fromUrl : toUrl}`);
  if (!fs.existsSync(fromAbs)) return [];
  if (fs.existsSync(toAbs)) throw new Error(`already taken: ${toUrl}`);
  _move(fromAbs, toAbs);
  return [{ from: fromUrl, to: toUrl }];
}

// The whole operation: { files: [[fromUrl, toUrl]], folders: [[fromUrl/, toUrl/]] }.
// Moves on disk, rewrites the stores, remembers. Returns { pairs, files, strings }.
function relocate({ files = [], folders = [] } = {}) {
  // Background work reading any of these lets go first (lib/file-release.js).
  require('./file-release').release([...folders.map(([from]) => toDisk(from + '.')), ...files.map(([from]) => toDisk(from))]);
  const pairs = [];
  let failure = null;
  try {
    for (const [from, to] of folders) pairs.push(...moveFolder(from, to));
    for (const [from, to] of files) pairs.push(...moveFile(from, to));
  } catch (e) {
    failure = e;
  }
  // Whatever did move is written into the stores and remembered even when a later move failed -
  // otherwise the stores would point at files that are no longer there.
  let done = { files: 0, strings: 0 };
  if (pairs.length) {
    done = rewriteStores(pairs);
    moves.record(pairs);
    try { require('./cache-carry').carry(pairs); } catch (e) { console.warn('[relocate] the cache did not follow:', e.message); }
  }
  if (failure) throw failure;
  return { pairs, ...done };
}

module.exports = { relocate, moveFile, moveFolder, rewriteStores, rewriteValue, mapper, storeFiles, siblingsOf };
