'use strict';

// ════════════════════════════════════════════════════════════════════════════
// LIBRARY CATEGORIES — one list per kind, and the folder each category's files live in.
//
//   data/library-cats.json
//   { birols:  { own: [{id, label, folder, parent?}], hidden: [] },
//     uploads: { ... }, hooks: { ... }, images: { ... }, sounds: { ... }, references: { ... }, music: { ... } }
// Every list goes in the tree's order - `listFor`; an `order: [id,...]` an older program kept beside `own` is not read,
// and is left out the next time the file is written.
//
// A category is a folder: its files are in media/<kind>/<folder>/, and an item with
// no category is in media/<kind>/nocat/ (Music: media/audio/ itself). The folder is named
// after the label (lib/names.js), unique among its siblings, and remembered here - so a rename renames the folder it
// has, rather than guessing it again from a label that has changed. Moving the files is lib/shelf-files.js and
// lib/folders.js; this file keeps the list and answers questions about it.
//
// FOLDERS IN FOLDERS: a category may sit inside another of its kind, with no limit of depth - IMAGES -> Products ->
// Shoes -> Summer. `parent` is the id of the one it is in (none - the kind itself); `folder` is its WHOLE path from the
// kind's folder, "Products/Shoes/Summer" (a top one's is one name - so a list without parents is already right, and a
// program that knows nothing of parents still finds the files). A record of a file names the folder it lies DIRECTLY in
// (`categoryId`); an id never changes, whatever is renamed or moved. A name is one folder's within one place (case
// aside); two places may each have one.
//   - Music has folders of its own: kind `music`, on the disk media/audio/<path>/.
//   - A path is at most PATH_MAX characters: sharp, which reads and writes every picture and thumbnail, and
//     Windows Explorer cannot open a file whose whole path is past 260 characters (with long paths off; ffmpeg can). A library at C:\Users\<name>\OneDrive\Desktop\<folder>\library (~53) + \media\references\ (18) + a
//     folder + \thumbs\ (8) + a file name of up to 80 leaves 100 for the folder.
//   - Inside a folder the names `thumbs` and `preview` are its files' derivatives' (lib/relocate.js siblingsOf), and
//     `nocat` is the kind's: a folder of that name is given "thumbs (2)" on the disk (its label stays).
//
// An ORPHAN is an id that records carry but no list knows - from a hand-edited store. It
// still shows, named from the records, and adopt() turns it into a real category (at the top) the first time its files
// need a folder.
// ════════════════════════════════════════════════════════════════════════════

const fs   = require('fs');
const { writeFileAtomic } = require('./atomic-write');
const path = require('path');
const { DATA_DIR, MEDIA } = require('./config');
const { folderName, uniqueName } = require('./names');
const { NOCAT } = require('./layout');

const FILE = path.join(DATA_DIR, 'library-cats.json');

const KINDS = ['birols', 'uploads', 'hooks', 'images', 'sounds',
  // REFERENCES' own categories - a folder each under media/references/, beside the sources' folders.
  'references',
  // Music's own folders, beside highlights and its moods (which are fields of a track).
  'music'];
// The folder of a kind under media/ - its own name, but Music's files are in media/audio/.
const DIR = { music: 'audio' };
const dirName = (kind) => DIR[kind] || kind;
const kindDir = (kind) => MEDIA[dirName(kind)];
const kindUrl = (kind) => '/media/' + dirName(kind) + '/';
// The sources' folders of REFERENCES (lib/references-store.js): an own category never takes one of their names.
const REF_SOURCES = ['files', 'instagram', 'youtube', 'tiktok', 'other'];
// Inside any folder: its files' derivatives (lib/relocate.js siblingsOf).
const RESERVED = ['thumbs', 'preview'];
const PATH_MAX = 100;
// THE REQUIRED CATEGORIES: the ones the code files into BY NAME - the pictures the chats
// make ("Generated", lib/mv3-gens.js), Merge's screenshots (routes/images.js), the photos New environment / New lookbook
// are given (routes/scen3.js _fileRef) - so a rename would make the code start a new one beside it and a delete would bring
// it back. They are always there (lib/required-cats.js makes them at start), at the TOP of their kind, first in their branch
// of the media tree, with a lock: never renamed, moved or deleted (routes/library.js refuses) - folders inside them are
// fine, but for uploads_environments / uploads_lookbooks: nothing goes into them by hand (`closedWhy`).
// (The video chat's clips need no required category: they are B-rolls in their model's folder - MODEL_PREFIX below.)
// SFX -> My sounds -> Generated: the sound effects Suno and ElevenLabs make
// (lib/audio-gens.js) - filed by this name, so it is required too.
// "Stock" - where the B-roll engine files what it downloads from the stock: videos into
// VIDEO -> Uploads -> Stock, pictures into IMAGES -> Stock (lib/broll.js).
const REQUIRED = {
  images: ['Generated', 'Screenshots', 'uploads_environments', 'uploads_lookbooks', 'Stock'],
  sounds: ['Generated'],
  uploads: ['Stock'],
};
// What the tree calls two of them: the stored name stays - it is what the code looks for.
const TITLES = { uploads_environments: 'Environment references', uploads_lookbooks: 'Lookbook references' };
const titleOf = (label) => TITLES[String(label || '')] || String(label || '');
const _lc = (s) => String(s || '').trim().toLowerCase();
// Names in the tree's order (routes/library.js _abc): no case, numbers as numbers - "file 9" before "file 10".
const _abc = (a, b) => String(a || '').localeCompare(String(b || ''), 'en', { numeric: true, sensitivity: 'base' });
// Where a label stands among its kind's required ones; -1 for any other.
const requiredAt = (kind, label) => (REQUIRED[kind] || []).findIndex(l => _lc(l) === _lc(label));
// The synthetic "no category": what a query sends for the items with none. It is not a stored
// category, so it can never be renamed, moved or deleted.
const UNCAT = '__uncat__';
// THE FOLDERS OF THE MODELS - VIDEO -> Generated -> Grok classic, Seedance 2.5...: B-roll
// categories at the top whose id is `model_<model>` (lib/model-folders.js makes and fills them). The app's: locked - never
// renamed, moved or deleted -, folders inside them (the groups) are the person's. Only they lie at the top of B-rolls.
const MODEL_PREFIX = 'model_';
const isModelId = (id) => /^model_[a-z0-9]{1,30}$/.test(String(id || ''));
const MODELS_TOP = 'Generated holds the folders of the models that made the clips - a folder goes inside one of them (Grok classic, Seedance 2.5…).';

const _readJson = (f, fallback) => {
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return fallback; }
};

function _blank() {
  const s = {};
  for (const k of KINDS) s[k] = { own: [], hidden: [] };
  return s;
}

// Always hand back the full shape, whatever is on disk. A half-written or hand-edited file
// should cost a missing category, not a crash on every shelf read. A parent that is not there, or a
// circle of parents, puts the folder at the top.
function read() {
  const raw = _readJson(FILE, null) || {};
  const out = _blank();
  for (const k of KINDS) {
    const src = raw[k] || {};
    out[k].own = (Array.isArray(src.own) ? src.own : [])
      .filter(c => c && c.id)
      .map(c => ({ id: String(c.id), label: String(c.label || c.id), folder: c.folder ? String(c.folder) : '',
        parent: c.parent ? String(c.parent) : '' }));
    const byId = new Map(out[k].own.map(c => [c.id, c]));
    for (const c of out[k].own) {
      const seen = new Set([c.id]);
      for (let p = c.parent; p; p = (byId.get(p) || {}).parent) {
        if (!byId.has(p) || seen.has(p)) { c.parent = ''; break; }
        seen.add(p);
      }
    }
    out[k].hidden = (Array.isArray(src.hidden) ? src.hidden : []).map(String);
  }
  return out;
}

function write(state) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  // A folder at the top is written with no `parent`.
  const out = {};
  for (const k of Object.keys(state)) {
    const s = state[k] || {};
    out[k] = Object.assign({}, s, { own: (s.own || []).map(c => (c.parent
      ? { id: c.id, label: c.label, folder: c.folder, parent: c.parent } : { id: c.id, label: c.label, folder: c.folder })) });
  }
  writeFileAtomic(FILE, JSON.stringify(out, null, 2));
}

function newId() {
  return 'libcat_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// ── The tree, on a state ─────────────────────────────────────────────────────
const own = (state, kind) => ((state[kind] || {}).own) || [];
const byIdOf = (state, kind, id) => own(state, kind).find(c => c.id === String(id || '')) || null;
const kidsOf = (state, kind, parent) => own(state, kind).filter(c => c.parent === String(parent || ''));
const segOf = (c) => String((c && c.folder) || '').split('/').pop();

/** The ids of a folder and every folder under it, the folder first. */
function subtreeOf(state, kind, id) {
  const out = [];
  const walk = (x) => { out.push(x); for (const c of kidsOf(state, kind, x)) walk(c.id); };
  if (byIdOf(state, kind, id)) walk(String(id));
  return out;
}

/** Whether `id` is `anc` or lies under it. */
function isUnder(state, kind, id, anc) {
  for (let c = byIdOf(state, kind, id); c; c = byIdOf(state, kind, c.parent)) if (c.id === String(anc)) return true;
  return false;
}

/** Its names from the top: ['Products', 'Shoes', 'Summer']. */
function trailOf(state, kind, id) {
  const out = [];
  for (let c = byIdOf(state, kind, id); c; c = byIdOf(state, kind, c.parent)) out.unshift(titleOf(c.label));
  return out;
}

// A folder's whole path ('' - the kind itself, or no such folder).
const _pathOf = (state, kind, id) => ((byIdOf(state, kind, id) || {}).folder || '');

// The names a folder in `parent` must not take: its siblings' folders, the derivatives' folders, the kind's nocat (and at
// the top of REFERENCES its sources'), and any folder on the disk there already - but its own, when it is there itself.
function _taken(state, kind, parent, exceptId) {
  const p = String(parent || '');
  const me = exceptId ? byIdOf(state, kind, exceptId) : null;
  const mineHere = me && me.parent === p ? segOf(me).toLowerCase() : '';
  const taken = kidsOf(state, kind, p).filter(c => c.id !== exceptId && c.folder).map(segOf).concat(RESERVED, [NOCAT]);
  if (kind === 'references' && !p) for (const s of REF_SOURCES) taken.push(s);
  const parentPath = p ? _pathOf(state, kind, p) : '';
  try {
    const at = path.join(kindDir(kind), ...parentPath.split('/').filter(Boolean));
    for (const d of fs.readdirSync(at, { withFileTypes: true })) {
      if (d.isDirectory() && d.name.toLowerCase() !== mineHere) taken.push(d.name);
    }
  } catch (e) { /* not on the disk yet */ }
  return taken;
}

// The one name (a path segment) for a folder labelled `label` in `parent`.
function _segFor(state, kind, label, parent, exceptId) {
  return uniqueName(folderName(label, 'category'), _taken(state, kind, parent, exceptId));
}

/** The whole path a folder labelled `label` would have in `parent` ('' - the top). */
function pathFor(state, kind, label, parent, exceptId) {
  const parentPath = parent ? _pathOf(state, kind, parent) : '';
  return (parentPath ? parentPath + '/' : '') + _segFor(state, kind, label, parent, exceptId);
}

/** A folder of that name in `parent` already, or null. */
function siblingNamed(state, kind, parent, label, exceptId) {
  return kidsOf(state, kind, parent).find(c => c.id !== exceptId && _lc(c.label) === _lc(label)) || null;
}

/** A path too long for the disk - why, in words, or ''. */
function tooLong(p) {
  return String(p || '').length > PATH_MAX
    ? 'That is too deep: the folder\'s path would be ' + String(p).length + ' characters, and the disk takes ' + PATH_MAX
      + ' here (a picture in it could not be opened). Use a shorter name, or put it higher.'
    : '';
}

/** The longest path under a folder if its own path became `next` (the folder itself included). */
function deepestFor(state, kind, id, next) {
  const c = byIdOf(state, kind, id);
  let max = String(next || '');
  if (!c || !c.folder) return max;
  for (const sub of subtreeOf(state, kind, id).slice(1)) {
    const x = byIdOf(state, kind, sub);
    if (x && x.folder.startsWith(c.folder + '/')) {
      const p = next + x.folder.slice(c.folder.length);
      if (p.length > max.length) max = p;
    }
  }
  return max;
}

/** A folder's new path, every folder under it following - on the state (written by the caller). */
function setPath(state, kind, id, next) {
  const c = byIdOf(state, kind, id);
  if (!c) return;
  const from = c.folder;
  for (const x of own(state, kind)) {
    if (x.id === c.id) continue;
    if (from && isUnder(state, kind, x.id, c.id) && x.folder.startsWith(from + '/')) x.folder = next + x.folder.slice(from.length);
  }
  c.folder = next;
}

// ── The chip list for one kind ───────────────────────────────────────────────
// `counts` is { categoryId: n } for the records in scope, so the caller decides whether
// that means one kind or all of them. `labelFor` supplies a fallback name for an id that
// is in no list - see the orphan note above.
//
// kind === null means the "All" filter: the union of every list. Category ids are unique,
// so filtering by one is still unambiguous; only the row gets longer.
// Each says where it is: `parent`, and `trail` - its names from the top.
// In the tree's order: in each folder the locked first, then by name; a folder's own folders right after it.
function listFor(kind, counts, labelFor) {
  const state = read();
  const kinds = kind ? [kind] : KINDS;
  const seen = new Map();          // id -> { id, label, parent, own, kind }
  for (const k of kinds) for (const c of state[k].own) if (!seen.has(c.id)) seen.set(c.id, { id: c.id, label: c.label, parent: c.parent, own: true, kind: k });

  for (const id of Object.keys(counts || {})) {
    if (!id || seen.has(id)) continue;
    seen.set(id, { id, label: (labelFor && labelFor(id)) || id, parent: '', own: false, orphan: true, kind: kind || 'birols' });
  }

  const rows = [...seen.values()].map(c => ({ id: c.id, label: c.label, parent: c.parent || '', own: !!c.own,
    orphan: !!c.orphan, kind: c.kind, count: (counts && counts[c.id]) || 0,
    // Required, and what the tree calls it.
    locked: !!c.own && isLocked(c.kind, c.id, state), title: titleOf(c.label),
    trail: c.own ? trailOf(state, c.kind, c.id) : [titleOf(c.label)] }));
  const kids = new Map();          // parent -> its folders (a parent not listed - the top)
  for (const r of rows) {
    const p = seen.has(r.parent) ? r.parent : '';
    if (!kids.has(p)) kids.set(p, []);
    kids.get(p).push(r);
  }
  const out = [];
  const walk = (p) => {
    const here = (kids.get(p) || []).sort((a, b) => (Number(b.locked) - Number(a.locked)) || _abc(a.title, b.title));
    for (const r of here) { out.push(r); walk(r.id); }
  };
  walk('');
  return out;
}

// A required category - the FIRST of its kind AT THE TOP with a required name (LC.add files into the first it
// finds; lib/required-cats.js folds any second one into it at start). A folder of that name inside another is the person's.
function isLocked(kind, id, state) {
  const list = own(state || read(), kind);
  const c = list.find(x => x.id === String(id));
  // A model's folder of B-rolls is the app's.
  if (c && kind === 'birols' && !c.parent && isModelId(c.id)) return true;
  if (!c || c.parent || requiredAt(kind, c.label) < 0) return false;
  return list.find(x => !x.parent && _lc(x.label) === _lc(c.label)) === c;
}

// THE REFERENCES OF ENVIRONMENTS AND LOOKBOOKS ARE CLOSED TO THE HAND: the required
// uploads_environments / uploads_lookbooks (IMAGES -> Environments / Lookbooks -> references, routes/library.js _madeFolders)
// and every folder under them take only the photos their generators are given (routes/scen3.js _fileRef), which file
// through lib/images-store.js add with the category's id and ask nothing here. Every way in by hand is refused in words
// with `closedWhy`: a tile or several filed there (routes/library.js _patchOne, the batch), a folder made or moved there
// (`make`, lib/folders.js move), an upload (routes/images.js), a post's picture (routes/references.js); the code filing by
// a name never lands under them (`findByName`). Out of them, renamed, deleted - as any folder.
const CLOSED = { uploads_environments: ['Environments', 'New environment', 'an environment'],
  uploads_lookbooks: ['Lookbooks', 'New lookbook', 'a lookbook'] };
/** Why nothing goes into this folder by hand, in words - '' for any other. */
function closedWhy(kind, id, state) {
  if (kind !== 'images' || !id) return '';
  const st = state || read();
  for (let c = byIdOf(st, kind, id); c; c = byIdOf(st, kind, c.parent)) {
    const g = !c.parent && CLOSED[_lc(c.label)];
    if (g && isLocked(kind, c.id, st)) {
      return 'Nothing goes into ' + g[0] + ' / references by hand - only the photo ' + g[1] + ' makes ' + g[2] + ' from lands there.';
    }
  }
  return '';
}

// Is this id the Library's to change? Every listed category is.
function isOwn(kind, id) {
  const state = read();
  const kinds = kind ? [kind] : KINDS;
  return kinds.some(k => state[k].own.some(c => c.id === String(id)));
}

function find(kind, id) {
  return byIdOf(read(), kind, id);
}

/** A folder by its name, as the code files by name: at the top first, then anywhere in the kind - a project's
 *  folder moved into another keeps getting its project's files - but never one under the references of
 *  Environments / Lookbooks (`closedWhy`). null - none. */
function findByName(state, kind, label) {
  const list = own(state, kind);
  return list.find(c => !c.parent && _lc(c.label) === _lc(label))
    || list.find(c => _lc(c.label) === _lc(label) && !closedWhy(kind, c.id, state)) || null;
}

// ── Mutations ───────────────────────────────────────────────────────────────
// Each is read-modify-write inside one call, so two of them cannot interleave. Renaming and moving a folder - its files
// move too - is lib/folders.js.

// FILED UNDER A NAME (the code's way: a project's category, "Generated", "Screenshots"...): the folder of that name - at
// the top first, then anywhere in the kind (findByName) -, or a new one at the top. Same name as one already there means
// the caller is asking for something that exists: that one is handed back instead of a second chip of the same label.
function add(kind, label) {
  const name = String(label || '').trim().slice(0, 60);
  if (!name) throw new Error('a category needs a name');
  const state = read();
  if (!state[kind]) throw new Error(`no such kind "${kind}"`);
  const existing = findByName(state, kind, name);
  if (existing) return { cat: existing, created: false };
  const cat = { id: newId(), label: name, folder: pathFor(state, kind, name, '', null), parent: '' };
  state[kind].own.push(cat);
  write(state);
  return { cat, created: true };
}

// A NEW FOLDER WHERE THE PERSON ASKED ("New folder" in the tree, the gallery, a place picker): in `parent`
// ('' - the kind itself). A name already there hands that one back. Refused: no such parent, a path too long.
function make(kind, label, parent) {
  const name = String(label || '').trim().slice(0, 60);
  if (!name) throw Object.assign(new Error('A folder needs a name.'), { status: 400 });
  const state = read();
  if (!state[kind]) throw Object.assign(new Error(`no such kind "${kind}"`), { status: 400 });
  const p = String(parent || '');
  if (p && !byIdOf(state, kind, p)) throw Object.assign(new Error('That folder is not there any more.'), { status: 404 });
  // The top of B-rolls is the models' (lib/model-folders.js): a folder is made inside one of them.
  if (kind === 'birols' && !p) throw Object.assign(new Error(MODELS_TOP), { status: 409 });
  // Not in the references of Environments / Lookbooks.
  const shut = closedWhy(kind, p, state);
  if (shut) throw Object.assign(new Error(shut), { status: 409 });
  const existing = siblingNamed(state, kind, p, name, null);
  if (existing) return { cat: existing, created: false };
  const folder = pathFor(state, kind, name, p, null);
  const why = tooLong(folder);
  if (why) throw Object.assign(new Error(why), { status: 400 });
  const cat = { id: newId(), label: name, folder, parent: p };
  state[kind].own.push(cat);
  write(state);
  return { cat, created: true };
}

// An orphan id made a real category (at the top), under the label its records carry.
function adopt(kind, id, label) {
  const state = read();
  if (!state[kind]) throw new Error(`no such kind "${kind}"`);
  const have = byIdOf(state, kind, id);
  if (have) return have;
  const name = String(label || '').trim().slice(0, 60) || String(id);
  const cat = { id: String(id), label: name, folder: pathFor(state, kind, name, '', null), parent: '' };
  state[kind].own.push(cat);
  write(state);
  return cat;
}

// Out of the list, with every folder under it (what was in them is the caller's - lib/folders.js).
function remove(kind, id) {
  const state = read();
  if (!state[kind]) throw new Error(`no such kind "${kind}"`);
  if (isLocked(kind, id, state)) throw new Error('this category is required - it cannot be deleted');
  const gone = new Set(subtreeOf(state, kind, id));
  if (!gone.size) throw new Error('not a library category');
  state[kind].own = state[kind].own.filter(c => !gone.has(c.id));
  state[kind].hidden = state[kind].hidden.filter(x => !gone.has(x));
  write(state);
}

// The folder an item of `kind` in category `id` lives in, from the kind's folder: nocat for none (Music: '' - its own
// folder), the category's path otherwise - and an orphan id adopted under `label` when the list does not know it.
function folderOf(kind, id, label) {
  const none = kind === 'music' ? '' : NOCAT;
  const cid = String(id || '');
  if (!cid || cid === UNCAT) return none;
  const state = read();
  if (!state[kind]) return none;
  const entry = byIdOf(state, kind, cid);
  if (entry) return entry.folder;
  return adopt(kind, cid, label || cid).folder;
}

module.exports = {
  FILE, KINDS, UNCAT, REQUIRED, PATH_MAX, RESERVED, MODEL_PREFIX, isModelId, MODELS_TOP,
  read, write, listFor, isOwn, find, findByName, isLocked, requiredAt, titleOf, closedWhy,
  add, make, adopt, remove, newId, folderOf,
  // the tree, on a state (lib/folders.js)
  dirName, kindDir, kindUrl, byIdOf, kidsOf, subtreeOf, isUnder, trailOf, pathFor, siblingNamed, setPath, deepestFor, tooLong, segOf,
};
