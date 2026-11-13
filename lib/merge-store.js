'use strict';

/* merge-store.js - Merge's timelines, each a file in the folder of its project.

   projects/<folder>/merge/<title>.json holds one timeline: the record routes/mergev3.js keeps,
   plus its key. data/merge.json keeps only the store's counter and when it last moved.

   WHERE A TIMELINE LIVES. A talking head's or a voiceover's (key sv3_<project id>[_n]), in that
   project's folder. A copy (`from`), beside the timeline it was copied from. Made in Merge, in a folder of
   its own - a Merge project, kind 'merge' in data/project-list.json, named after the title; the
   folder follows a rename of the title while it holds that timeline alone. The file is named after
   the title (lib/names.js) and follows it too.

   routes/mergev3.js sees one state - { version, updatedAt, timelines } - through read() and
   write(). write() compares against what is on disk and touches only the timelines that changed,
   and deletes the files of timelines that are gone. */

const fs = require('fs');
const path = require('path');
const { DATA_DIR, PROJECTS_DIR } = require('./config');
const { writeFileAtomic } = require('./atomic-write');
const { folderName, uniqueFile } = require('./names');

const STATE_FILE = path.join(DATA_DIR, 'merge.json');
const SUB = 'merge';

let _idx = null;        // Map key -> { folder, file, mtimeMs, json }
let _stamp = -1;        // data/merge.json's modification time when _idx was built or last written by us

const _stateMtime = () => { try { return fs.statSync(STATE_FILE).mtimeMs; } catch (e) { return 0; } };

const _mergeDir = (folder) => path.join(PROJECTS_DIR, folder, SUB);
const _abs = (e) => path.join(_mergeDir(e.folder), e.file);

// Every timeline file under projects/, read once and then kept by modification time.
function _scan() {
  const idx = new Map();
  let dirs = [];
  try { dirs = fs.readdirSync(PROJECTS_DIR, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch (e) { /* none */ }
  for (const folder of dirs) {
    let files = [];
    try { files = fs.readdirSync(_mergeDir(folder)).filter((f) => f.toLowerCase().endsWith('.json')); } catch (e) { continue; }
    for (const file of files) {
      const abs = path.join(_mergeDir(folder), file);
      try {
        const json = fs.readFileSync(abs, 'utf8');
        const doc = JSON.parse(json);
        const key = String(doc.key || file.replace(/\.json$/i, ''));
        if (idx.has(key)) { console.warn('[merge-store] two files hold timeline', key, '- keeping', idx.get(key).folder); continue; }
        idx.set(key, { folder, file, mtimeMs: fs.statSync(abs).mtimeMs, json: JSON.stringify(doc) });
      } catch (e) {
        console.warn('[merge-store] unreadable timeline file', abs, '-', e.message);
      }
    }
  }
  return idx;
}

// The index, refreshed: a file that changed is read again; one that went (a folder renamed or
// deleted under us) sends the whole thing back to a scan, and so does a data/merge.json this
// process did not write - another writer may have added timelines.
function _index() {
  const stamp = _stateMtime();
  if (!_idx || stamp !== _stamp) { _idx = _scan(); _stamp = stamp; return _idx; }
  for (const e of _idx.values()) {
    let mtimeMs;
    try { mtimeMs = fs.statSync(_abs(e)).mtimeMs; } catch (err) { _idx = _scan(); return _idx; }
    if (mtimeMs !== e.mtimeMs) {
      try {
        e.json = JSON.stringify(JSON.parse(fs.readFileSync(_abs(e), 'utf8')));
        e.mtimeMs = mtimeMs;
      } catch (err) { _idx = _scan(); return _idx; }
    }
  }
  return _idx;
}

// Files may have arrived or moved behind the store's back (a project renamed or deleted).
function invalidate() { _idx = null; _stamp = -1; }

function _readState() {
  try {
    const s = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    return { version: Number(s.version) || 0, updatedAt: s.updatedAt || null };
  } catch (e) { return { version: 0, updatedAt: null }; }
}

// ── Reading ─────────────────────────────────────────────────────────────────
function read() {
  const idx = _index();
  const { version, updatedAt } = _readState();
  const timelines = {};
  for (const [key, e] of idx) {
    const doc = JSON.parse(e.json);
    delete doc.key;
    timelines[key] = doc;
  }
  return { version, updatedAt, timelines };
}

// ONE timeline as read() gives it, or null - parsing only that one (the captions' state is asked every second
// and a half while a job runs, and a talking head's lines are looked at on every new take).
function one(key) {
  const e = _index().get(String(key));
  if (!e) return null;
  const doc = JSON.parse(e.json);
  delete doc.key;
  return doc;
}

// THE draft's key - asked on every read of a chat, so cheaply: the cached texts are searched, and only the
// one that says so is read.
function draftKey() {
  for (const [key, e] of _index()) {
    if (e.json.indexOf('"draft":true') < 0) continue;
    try { if (JSON.parse(e.json).draft === true) return key; } catch (err) { /* unreadable: not the draft */ }
  }
  return '';
}

// Which project folder a timeline belongs to, and its entry in the project list.
function locate(key) {
  const e = _index().get(String(key));
  return e ? { folder: e.folder, file: e.file, url: `/projects/${e.folder}/${SUB}/${e.file}` } : null;
}

/**
 * locate() for SEVERAL - Map key -> { folder, file, url } - with the index looked at once. Each locate() looks at every
 * timeline's file on the disk (_index), so asking it of every timeline is N x N looks: ~1.7 s for 299 timelines on each
 * press of Merge's project picker.
 */
function locateMany(keys) {
  const idx = _index();
  const out = new Map();
  for (const key of (keys || []).map(String)) {
    const e = idx.get(key);
    if (e) out.set(key, { folder: e.folder, file: e.file, url: `/projects/${e.folder}/${SUB}/${e.file}` });
  }
  return out;
}

// ── Writing ─────────────────────────────────────────────────────────────────
function _fileName(folder, title, exceptFile) {
  let taken = [];
  try { taken = fs.readdirSync(_mergeDir(folder)); } catch (e) { /* new folder */ }
  if (exceptFile) taken = taken.filter((f) => f.toLowerCase() !== exceptFile.toLowerCase());
  return uniqueFile(folderName(title, 'timeline') + '.json', taken);
}

// A new timeline's folder: its Scenarios project, the folder of the timeline it was copied from,
// or a Merge project of its own.
function _placeFor(key, t, idx) {
  const PROJECTS = require('./projects-store');
  const m = /^sv3_([^_]+)(?:_\d+)?$/.exec(key);
  if (m) {
    const p = PROJECTS.entry(m[1]);
    if (p) return p.folder;
  }
  // A highlights project's timelines - its own and its fragments' - are in its folder.
  const h = require('../public/js/highlights/keys.js').parseKey(key);
  if (h) {
    const p = PROJECTS.entry(h.id);
    if (p && p.kind === 'highlights') return p.folder;
  }
  if (t && t.from && idx.has(String(t.from))) return idx.get(String(t.from)).folder;
  const folder = PROJECTS._newFolder((t && t.title) || 'Untitled', 'merge project');
  const now = new Date().toISOString();
  PROJECTS._writeList([{ id: key, name: String((t && t.title) || ''), folder, kind: 'merge', createdAt: (t && t.createdAt) || now,
    updatedAt: (t && t.updatedAt) || now }, ...PROJECTS.entries()]);
  return folder;
}

// A Merge project's folder is named after its timeline - while it holds that timeline alone. A highlights project's
// after its OWN timeline, hl_<id>, whatever else is in it: the picker renames the project by that one.
function _followTitle(key, e, title, idx) {
  const PROJECTS = require('./projects-store');
  const KEYS = require('../public/js/highlights/keys.js');
  const hl = KEYS.isHome(key) ? KEYS.parseKey(key).id : '';
  const p = hl ? PROJECTS.entries().find((x) => x.kind === 'highlights' && x.id === hl && x.folder === e.folder)
    : PROJECTS.entries().find((x) => x.kind === 'merge' && x.folder === e.folder);
  if (!p) return;
  const siblings = [...idx.values()].filter((x) => x.folder === e.folder);
  if (!hl && siblings.length !== 1) return;
  PROJECTS._renameFolder(p, title);          // moves the folder, rewrites stored paths under it
  p.name = String(title || '');
  PROJECTS._writeList(PROJECTS.entries().map((x) => (x.id === p.id ? { ...x, name: p.name, folder: p.folder } : x)));
  for (const x of siblings) x.folder = p.folder;
  e.folder = p.folder;
  if (hl) require('./highlights-store').named(p.id, p.name);
}

function write(state) {
  const idx = _index();
  const timelines = (state && state.timelines) || {};

  for (const [key, t] of Object.entries(timelines)) {
    const prev = idx.get(key);
    const prevDoc = prev ? JSON.parse(prev.json) : {};
    const doc = { key, ...t };
    const json = JSON.stringify(doc);

    if (!prev) {
      const folder = _placeFor(key, t, idx);
      const file = _fileName(folder, t.title);
      const e = { folder, file, mtimeMs: 0, json };
      fs.mkdirSync(_mergeDir(folder), { recursive: true });
      writeFileAtomic(_abs(e), JSON.stringify(doc, null, 2));
      e.mtimeMs = fs.statSync(_abs(e)).mtimeMs;
      idx.set(key, e);
      continue;
    }
    if (String(prevDoc.title || '') !== String(t.title || '')) {
      _followTitle(key, prev, t.title, idx);
      const file = _fileName(prev.folder, t.title, prev.file);
      if (file !== prev.file) {
        const from = path.join(_mergeDir(prev.folder), prev.file);
        const to = path.join(_mergeDir(prev.folder), file);
        if (fs.existsSync(from)) fs.renameSync(from, to);
        prev.file = file;
      }
    }
    if (json !== prev.json) {
      writeFileAtomic(_abs(prev), JSON.stringify(doc, null, 2));
      prev.json = json;
      prev.mtimeMs = fs.statSync(_abs(prev)).mtimeMs;
    }
  }

  // Timelines that are gone: their files go, and a Merge project left with none goes with them.
  for (const [key, e] of [...idx]) {
    if (Object.prototype.hasOwnProperty.call(timelines, key)) continue;
    try { fs.unlinkSync(_abs(e)); } catch (err) { /* already gone */ }
    // What was heard in it goes too (lib/subs-store.js).
    try { fs.unlinkSync(path.join(PROJECTS_DIR, e.folder, 'subs', key + '.json')); } catch (err) { /* none */ }
    idx.delete(key);
    const PROJECTS = require('./projects-store');
    const p = PROJECTS.entries().find((x) => x.kind === 'merge' && x.folder === e.folder);
    if (p && ![...idx.values()].some((x) => x.folder === e.folder)) {
      fs.rmSync(path.join(PROJECTS_DIR, e.folder), { recursive: true, force: true });
      PROJECTS._writeList(PROJECTS.entries().filter((x) => x.id !== p.id));
    }
  }

  const version = Number(state && state.version) || 0;
  const updatedAt = (state && state.updatedAt) || new Date().toISOString();
  const cur = _readState();
  if (cur.version !== version || cur.updatedAt !== updatedAt) {
    writeFileAtomic(STATE_FILE, JSON.stringify({ version, updatedAt }, null, 2));
    if (_idx) _stamp = _stateMtime();
  }
}

/**
 * ONE TIMELINE read, changed and written in ONE tick - the way a project is
 * (PROJECTS.apply). write() takes the whole map and deletes every timeline missing from it, so a
 * writer that read, awaited something and then wrote would put back an old copy of everything that
 * changed meanwhile - and delete what was made meanwhile. Do the slow work first, then this.
 * `fn(t)` changes the record in place and must not await; returning false means nothing changed
 * (no write, no new rev). Returns the record as stored, or null when there is no such timeline.
 */
function update(key, fn) {
  const s = read();
  const t = s.timelines[String(key)];
  if (!t) return null;
  const out = fn(t);
  if (out && typeof out.then === 'function') throw new Error('merge-store.update(fn) must not await');
  if (out === false) return t;
  t.rev = (Number(t.rev) || 0) + 1;
  t.updatedAt = new Date().toISOString();
  write({ ...s, version: (Number(s.version) || 0) + 1, updatedAt: t.updatedAt });
  return t;
}

/**
 * SEVERAL TIMELINES read, changed and written in ONE tick, EACH BY ITSELF. update() reads and writes the whole store for one
 * timeline - for 299 of them, 26 MB of JSON, ~0.15 s -, and a highlights group's change of 20 fragments would do that 20
 * times while the server could answer nothing else. Here the index is looked at once, each timeline's
 * own text parsed and - when `fn` changed it - its file written; the store's counter moves once. `fn(t, key)` changes the record
 * in place and must not await; false - nothing changed (no write, no new rev). A title changed goes the long way (write()), which follows it with the
 * file. Timelines that are not there are skipped. Returns the keys written.
 * `opts.own` - the caller sets rev and updatedAt itself (a page's save, routes/mergev3.js PUT): they are left as fn
 * leaves them.
 */
function updateMany(keys, fn, opts) {
  const own = !!(opts && opts.own);
  const idx = _index();
  const now = new Date().toISOString();
  const done = [];
  const retitled = [];
  for (const key of [...new Set((keys || []).map(String))]) {
    const e = idx.get(key);
    if (!e) continue;
    const doc = JSON.parse(e.json);
    delete doc.key;
    const title = String(doc.title || '');
    const out = fn(doc, key);
    if (out && typeof out.then === 'function') throw new Error('merge-store.updateMany(fn) must not await');
    if (out === false) continue;
    if (!own) {
      doc.rev = (Number(doc.rev) || 0) + 1;
      doc.updatedAt = now;
    }
    if (String(doc.title || '') !== title) { retitled.push([key, doc]); continue; }
    const next = { key, ...doc };
    const json = JSON.stringify(next);
    if (json !== e.json) {
      writeFileAtomic(_abs(e), JSON.stringify(next, null, 2));
      e.json = json;
      e.mtimeMs = fs.statSync(_abs(e)).mtimeMs;
    }
    done.push(key);
  }
  if (retitled.length) {
    const s = read();
    for (const [key, doc] of retitled) { s.timelines[key] = doc; done.push(key); }
    write({ ...s, version: (Number(s.version) || 0) + 1, updatedAt: now });
  } else if (done.length) {
    const cur = _readState();
    writeFileAtomic(STATE_FILE, JSON.stringify({ version: cur.version + 1, updatedAt: now }, null, 2));
    if (_idx) _stamp = _stateMtime();
  }
  return done;
}

/** The store's counter - read() gives it with every timeline parsed; this reads data/merge.json alone. */
function stateVersion() { return _readState().version; }

/** SEVERAL timelines as one() gives each - Map key -> record - with the index looked at once. */
function many(keys) {
  const idx = _index();
  const out = new Map();
  for (const key of (keys || []).map(String)) {
    const e = idx.get(key);
    if (!e || out.has(key)) continue;
    const doc = JSON.parse(e.json);
    delete doc.key;
    out.set(key, doc);
  }
  return out;
}

// ONE set of export settings on several timelines at once - a highlights project's ticked fragments rendered
// together. No new rev: the settings are not the timeline (as POST /api/mv3/adv). Returns how many took them.
function setAdv(keys, adv) {
  const s = read();
  let n = 0;
  for (const k of (keys || [])) {
    const t = s.timelines[String(k)];
    if (!t) continue;
    t.adv = (adv && typeof adv === 'object') ? adv : null;
    n++;
  }
  if (n) write({ ...s, version: (Number(s.version) || 0) + 1, updatedAt: new Date().toISOString() });
  return n;
}

// At start: a folder holding timelines but no project.json, that the project list does not know,
// is a Merge project carried over from another library - it joins the list.
function sync() {
  const PROJECTS = require('./projects-store');
  const idx = _index();
  const entries = PROJECTS.entries();
  const known = new Set(entries.map((e) => e.folder.toLowerCase()));
  const add = [];
  for (const [key, e] of idx) {
    if (known.has(e.folder.toLowerCase())) continue;
    if (fs.existsSync(path.join(PROJECTS_DIR, e.folder, 'project.json'))) continue;
    known.add(e.folder.toLowerCase());
    const doc = JSON.parse(e.json);
    add.push({ id: key, name: String(doc.title || e.folder), folder: e.folder, kind: 'merge', createdAt: doc.createdAt || null, updatedAt: doc.updatedAt || null });
  }
  if (add.length) PROJECTS._writeList([...add, ...entries]);
  return { added: add.length };
}

module.exports = { read, one, many, stateVersion, write, update, updateMany, setAdv, locate, locateMany, draftKey, invalidate, sync, STATE_FILE };
