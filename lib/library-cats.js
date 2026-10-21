'use strict';

// ════════════════════════════════════════════════════════════════════════════
// LIBRARY CATEGORIES — one list per kind, and the folder each category's files live in.
//
//   data/library-cats.json
//   { birols:  { own: [{id, label, folder}], order: [id,...], hidden: [] },
//     uploads: { ... }, hooks: { ... }, images: { ... } }
//
// A category is a folder (docs/local-app/PLAN.md, phase 2): its files are in
// media/<kind>/<folder>/, and an item with no category is in media/<kind>/nocat/. The folder is
// named after the label (lib/names.js), unique within the kind, and remembered here - so a
// rename renames the folder it has, rather than guessing it again from a label that has changed.
// Moving the files is lib/shelf-files.js; this file only keeps the list.
//
// The Birols generator's own list (biroly.json `cats`) is gone with the Birols page: those
// categories became ordinary Library categories when the library was upgraded to layout 6.
//
// An ORPHAN is an id that records carry but no list knows - from an import, or a hand-edited
// store. It still shows, named from the records, and adopt() turns it into a real category the
// first time its files need a folder.
// ════════════════════════════════════════════════════════════════════════════

const fs   = require('fs');
const { writeFileAtomic } = require('./atomic-write');
const path = require('path');
const { DATA_DIR } = require('./config');
const { folderName, uniqueName } = require('./names');
const { NOCAT } = require('./layout');

const FILE = path.join(DATA_DIR, 'library-cats.json');

const KINDS = ['birols', 'uploads', 'hooks', 'images', 'sounds',
  // (phase TG, block 5b) REFERENCES' own categories - a folder each under media/references/, beside the sources' folders.
  'references'];
// The sources' folders of REFERENCES (lib/references-store.js): an own category never takes one of their names.
const REF_SOURCES = ['files', 'instagram', 'youtube', 'tiktok', 'other'];
// THE REQUIRED CATEGORIES (phase V28.4, the owner 2026-10-12): the ones the code files into BY NAME - the pictures the chats
// make ("Generated", lib/mv3-gens.js), Merge's screenshots (routes/images.js), the photos the Library's chats are given
// (routes/makechat.js) - so a rename would make the code start a new one beside it and a delete would bring it back. They
// are always there (lib/required-cats.js makes them at start), first in their branch of the media tree, with a lock: never
// renamed or deleted (routes/library.js refuses). (The video chat's clips have no category since the second round: they
// are VIDEO -> Generated -> Uncategorized, a B-roll with none.)
const REQUIRED = {
  images: ['Generated', 'Screenshots', 'uploads_environments', 'uploads_lookbooks'],
};
// What the tree calls two of them (the owner, second round: "вместо photo сделай References"): the stored name stays - it
// is what the code looks for.
const TITLES = { uploads_environments: 'Environment references', uploads_lookbooks: 'Lookbook references' };
const titleOf = (label) => TITLES[String(label || '')] || String(label || '');
const _lc = (s) => String(s || '').trim().toLowerCase();
// Where a label stands among its kind's required ones; -1 for any other.
const requiredAt = (kind, label) => (REQUIRED[kind] || []).findIndex(l => _lc(l) === _lc(label));
// The synthetic chips. Neither is a stored category: "all" is the absence of a filter and
// "uncategorized" is the absence of a category, so neither can be renamed, moved or deleted.
const UNCAT = '__uncat__';
// The legacy marker that used to mean "this is an upload". It is a flag, never a category.
const UPLOADS_CAT = '__uploads__';

const _readJson = (f, fallback) => {
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return fallback; }
};

function _blank() {
  const s = {};
  for (const k of KINDS) s[k] = { own: [], order: [], hidden: [] };
  return s;
}

// Always hand back the full shape, whatever is on disk. A half-written or hand-edited file
// should cost a missing category, not a crash on every shelf read.
function read() {
  const raw = _readJson(FILE, null) || {};
  const out = _blank();
  for (const k of KINDS) {
    const src = raw[k] || {};
    out[k].own = (Array.isArray(src.own) ? src.own : [])
      .filter(c => c && c.id)
      .map(c => ({ id: String(c.id), label: String(c.label || c.id), folder: c.folder ? String(c.folder) : '' }));
    out[k].order = (Array.isArray(src.order) ? src.order : []).map(String);
    out[k].hidden = (Array.isArray(src.hidden) ? src.hidden : []).map(String);
  }
  return out;
}

function write(state) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  writeFileAtomic(FILE, JSON.stringify(state, null, 2));
}

function newId() {
  return 'libcat_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// A folder name for `label` no other category of the kind has; nocat is never one.
function _folderFor(state, kind, label, exceptId) {
  const taken = state[kind].own.filter(c => c.id !== exceptId && c.folder).map(c => c.folder).concat([NOCAT]);
  if (kind === 'references') for (const s of REF_SOURCES) taken.push(s, s[0].toUpperCase() + s.slice(1), s.toUpperCase());
  return uniqueName(folderName(label, 'category'), taken);
}

// ── The chip list for one kind ───────────────────────────────────────────────
// `counts` is { categoryId: n } for the records in scope, so the caller decides whether
// that means one kind or all of them. `labelFor` supplies a fallback name for an id that
// is in no list - see the orphan note above.
//
// kind === null means the "All" filter: the union of every list. Category ids are unique,
// so filtering by one is still unambiguous; only the row gets longer.
function listFor(kind, counts, labelFor) {
  const state = read();
  const kinds = kind ? [kind] : KINDS;
  const seen = new Map();          // id -> { id, label, own, kind }
  for (const k of kinds) for (const c of state[k].own) if (!seen.has(c.id)) seen.set(c.id, { id: c.id, label: c.label, own: true, kind: k });

  for (const id of Object.keys(counts || {})) {
    if (!id || id === UPLOADS_CAT || seen.has(id)) continue;
    seen.set(id, { id, label: (labelFor && labelFor(id)) || id, own: false, orphan: true, kind: kind || 'birols' });
  }

  // The stored order first, then anything it has not heard of yet. Newcomers go last.
  const order = [];
  for (const k of kinds) for (const id of state[k].order) if (seen.has(id) && !order.includes(id)) order.push(id);
  for (const id of seen.keys()) if (!order.includes(id)) order.push(id);

  return order.map(id => {
    const c = seen.get(id);
    return { id: c.id, label: c.label, own: !!c.own, orphan: !!c.orphan, kind: c.kind, count: (counts && counts[id]) || 0,
      // (phase V28.4) Required, and what the tree calls it.
      locked: !!c.own && isLocked(c.kind, c.id, state), title: titleOf(c.label) };
  });
}

// (phase V28.4) A required category - the FIRST of its kind with a required name (LC.add files into the first it finds;
// lib/required-cats.js folds any second one into it at start).
function isLocked(kind, id, state) {
  const own = (((state || read())[kind] || {}).own) || [];
  const c = own.find(x => x.id === String(id));
  if (!c || requiredAt(kind, c.label) < 0) return false;
  return own.find(x => _lc(x.label) === _lc(c.label)) === c;
}

// Is this id the Library's to change? Every listed category is.
function isOwn(kind, id) {
  const state = read();
  const kinds = kind ? [kind] : KINDS;
  return kinds.some(k => state[k].own.some(c => c.id === String(id)));
}

function find(kind, id) {
  const state = read();
  return (state[kind] ? state[kind].own : []).find(c => c.id === String(id)) || null;
}

// ── Mutations ───────────────────────────────────────────────────────────────
// Each is read-modify-write inside one call, so two of them cannot interleave.

function add(kind, label) {
  const name = String(label || '').trim().slice(0, 60);
  if (!name) throw new Error('a category needs a name');
  const state = read();
  if (!state[kind]) throw new Error(`no such kind "${kind}"`);
  // Same name as one already there means the user is asking for something that exists: hand
  // back that one instead of making a second chip with the same label and a different id.
  const existing = state[kind].own.find(c => c.label.toLowerCase() === name.toLowerCase());
  if (existing) {
    if (!existing.folder) { existing.folder = _folderFor(state, kind, existing.label, existing.id); write(state); }
    return { cat: existing, created: false };
  }
  const cat = { id: newId(), label: name, folder: _folderFor(state, kind, name, null) };
  state[kind].own.push(cat);
  state[kind].order.push(cat.id);
  write(state);
  return { cat, created: true };
}

// An orphan id made a real category, under the label its records carry.
function adopt(kind, id, label) {
  const state = read();
  if (!state[kind]) throw new Error(`no such kind "${kind}"`);
  const have = state[kind].own.find(c => c.id === String(id));
  if (have) return have;
  const name = String(label || '').trim().slice(0, 60) || String(id);
  const cat = { id: String(id), label: name, folder: _folderFor(state, kind, name, null) };
  state[kind].own.push(cat);
  state[kind].order.push(cat.id);
  write(state);
  return cat;
}

// Renames the label and picks the folder name that goes with it. Returns { cat, from } - `from`
// is the folder the files are in now; lib/shelf-files.js moves them to `cat.folder`.
function rename(kind, id, label) {
  const name = String(label || '').trim().slice(0, 60);
  if (!name) throw new Error('a category needs a name');
  const state = read();
  const entry = (state[kind] ? state[kind].own : []).find(c => c.id === String(id));
  if (!entry) throw new Error('not a library category');
  if (isLocked(kind, id, state)) throw new Error('this category is required - it cannot be renamed');
  const from = entry.folder || _folderFor(state, kind, entry.label, entry.id);
  entry.label = name;
  entry.folder = _folderFor(state, kind, name, entry.id);
  write(state);
  return { cat: entry, from };
}

function remove(kind, id) {
  const state = read();
  if (!state[kind]) throw new Error(`no such kind "${kind}"`);
  if (isLocked(kind, id, state)) throw new Error('this category is required - it cannot be deleted');
  const before = state[kind].own.length;
  state[kind].own = state[kind].own.filter(c => c.id !== String(id));
  if (state[kind].own.length === before) throw new Error('not a library category');
  state[kind].order = state[kind].order.filter(x => x !== String(id));
  state[kind].hidden = state[kind].hidden.filter(x => x !== String(id));
  write(state);
}

// The folder an item of `kind` in category `id` lives in: nocat for none, the category's folder
// otherwise - made up (and remembered) for a category that has none yet, and an orphan id adopted
// under `label` when the list does not know it.
function folderOf(kind, id, label) {
  const cid = String(id || '');
  if (!cid || cid === UNCAT || cid === UPLOADS_CAT) return NOCAT;
  const state = read();
  if (!state[kind]) return NOCAT;
  const entry = state[kind].own.find(c => c.id === cid);
  if (entry) {
    if (!entry.folder) { entry.folder = _folderFor(state, kind, entry.label, entry.id); write(state); }
    return entry.folder;
  }
  return adopt(kind, cid, label || cid).folder;
}

module.exports = {
  FILE, KINDS, UNCAT, UPLOADS_CAT, REQUIRED,
  read, write, listFor, isOwn, find, isLocked, requiredAt, titleOf,
  add, adopt, rename, remove, newId, folderOf,
};
