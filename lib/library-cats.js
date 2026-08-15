'use strict';

// ════════════════════════════════════════════════════════════════════════════
// LIBRARY CATEGORIES — the Library's own category vocabulary, one list per kind.
//
//   data/library-cats.json
//   { birols:  { own: [{id,label}], order: [id,...], hidden: [id,...] },
//     uploads: { own: [...],        order: [...],    hidden: [...] },
//     hooks:   { own: [...],        order: [...],    hidden: [...] } }
//
// Two things own categories, and keeping them apart is the whole point of this file:
//
//   - The BIROLS TAB owns biroly.json `cats`. Those entries carry `systemPrompt` and
//     `promptVersions`, which the birol generator's prompt editor reads, and their ARRAY
//     ORDER is read by the Scenarios birols column (public/js/scen-birolys.js). Nothing
//     here ever writes that list — a rename or a reorder from the Library would have
//     silently rewritten a generator prompt's owner or reshuffled another page.
//   - The LIBRARY owns this file. Categories added here never appear in the Birols tab.
//
// A category added in the Birols tab DOES show up here. It can be renamed and deleted, but
// only ever in the Library's own terms: renaming FORKS (a Library category takes the new name
// and the clips move into it) and deleting resolves its clips and adds its id to `hidden`.
// The generator keeps its category either way.
//
// `hidden` is what makes "deleted from the Library, back when you generate into it again"
// work without any repair step. A generator category is shown when it HOLDS CLIPS or is not
// hidden — so once its clips are gone it disappears, and the moment a new generation writes
// records carrying that id it is back under the generator's own name. Nothing is written
// during a read, so the two cannot drift.
//
// Hooks and uploads have no generator list at all, so for them everything is Library-owned.
// ════════════════════════════════════════════════════════════════════════════

const fs   = require('fs');
const path = require('path');
const { DATA_DIR } = require('./config');

const FILE        = path.join(DATA_DIR, 'library-cats.json');
const BIROLY_FILE = path.join(DATA_DIR, 'biroly.json');

// `images` is a kind like the others: its own category list, so naming one "Screenshots"
// does not put it in the dropdown of every video clip. read() fills in a missing kind from
// _blank(), so an existing library-cats.json needs no migration.
const KINDS = ['birols', 'uploads', 'hooks', 'images'];
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
      .map(c => ({ id: String(c.id), label: String(c.label || c.id) }));
    out[k].order = (Array.isArray(src.order) ? src.order : []).map(String);
    out[k].hidden = (Array.isArray(src.hidden) ? src.hidden : []).map(String);
  }
  return out;
}

function write(state) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(state, null, 2), 'utf8');
}

// The Birols tab's categories. Read-only from here.
function genCats() {
  const bir = _readJson(BIROLY_FILE, {});
  return (Array.isArray(bir.cats) ? bir.cats : [])
    .filter(c => c && c.id)
    .map(c => ({ id: String(c.id), label: String(c.label || c.name || c.id) }));
}

function newId() {
  return 'libcat_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// ── The chip list for one kind ───────────────────────────────────────────────
// `counts` is { categoryId: n } for the records in scope, so the caller decides whether
// that means one kind or all of them. `labelFor` supplies a fallback name for an id that
// is in no list — see the orphan note below.
//
// kind === null means the "All" filter: the union of every list. Category ids are unique,
// so filtering by one is still unambiguous; only the row gets longer.
function listFor(kind, counts, labelFor) {
  const state = read();
  const kinds = kind ? [kind] : KINDS;
  const seen = new Map();          // id -> { id, label, own }
  const push = (c, own, ownerKind) => { if (!seen.has(c.id)) seen.set(c.id, { id: c.id, label: c.label, own, kind: ownerKind }); };

  // Birols inherits the generator's list; nothing else has one. A generator category the
  // Library has deleted stays out of sight while it holds nothing — see the `hidden` note at
  // the top. It is not filtered out when it has clips, because then hiding it would hide them.
  if (!kind || kind === 'birols') {
    const hidden = new Set(state.birols.hidden);
    for (const c of genCats()) {
      if (hidden.has(c.id) && !((counts || {})[c.id] > 0)) continue;
      push(c, false, 'birols');
    }
  }
  for (const k of kinds) for (const c of state[k].own) push(c, true, k);

  // An id that records carry but no list knows. It should not happen once deleting a
  // category always resolves its records, but it can arrive from an import, from a clip
  // that changed kind, or from a hand-edited store — and a category that vanishes from
  // the chips takes its clips out of reach with it. So it shows, named from the record.
  for (const id of Object.keys(counts || {})) {
    if (!id || id === UPLOADS_CAT || seen.has(id)) continue;
    // An orphan has no owning list, so acting on it targets the kind being listed;
    // on the union that is birols, the only kind with a list it could have come from.
    seen.set(id, { id, label: (labelFor && labelFor(id)) || id, own: false, orphan: true, kind: kind || 'birols' });
  }

  // The stored order first, then anything it has not heard of yet — a category just made
  // in the Birols tab, or an orphan. Newcomers go last rather than jumping the queue.
  const order = [];
  for (const k of kinds) for (const id of state[k].order) if (seen.has(id) && !order.includes(id)) order.push(id);
  for (const id of seen.keys()) if (!order.includes(id)) order.push(id);

  return order.map(id => {
    const c = seen.get(id);
    return { id: c.id, label: c.label, own: !!c.own, orphan: !!c.orphan, kind: c.kind, count: (counts && counts[id]) || 0 };
  });
}

// Is this id the Library's to change? Only its own entries are.
function isOwn(kind, id) {
  const state = read();
  const kinds = kind ? [kind] : KINDS;
  return kinds.some(k => state[k].own.some(c => c.id === String(id)));
}
function ownerKindOf(id) {
  const state = read();
  return KINDS.find(k => state[k].own.some(c => c.id === String(id))) || null;
}

// ── Mutations ───────────────────────────────────────────────────────────────
// Each is read-modify-write inside one call, so two of them cannot interleave.

function add(kind, label) {
  const name = String(label || '').trim().slice(0, 60);
  if (!name) throw new Error('a category needs a name');
  const state = read();
  if (!state[kind]) throw new Error(`no such kind "${kind}"`);
  // Same name as one already offered for this kind — including the Birols tab's — means
  // the user is asking for something that exists. Hand back that one instead of making a
  // second chip with the same label and a different id.
  const existing = (kind === 'birols' ? genCats() : []).concat(state[kind].own)
    .find(c => c.label.toLowerCase() === name.toLowerCase());
  if (existing) return { cat: existing, created: false };

  const cat = { id: newId(), label: name };
  state[kind].own.push(cat);
  state[kind].order.push(cat.id);
  write(state);
  return { cat, created: true };
}

function rename(kind, id, label) {
  const name = String(label || '').trim().slice(0, 60);
  if (!name) throw new Error('a category needs a name');
  const state = read();
  const entry = (state[kind] ? state[kind].own : []).find(c => c.id === String(id));
  if (!entry) throw new Error('not a library category');
  entry.label = name;
  write(state);
  return entry;
}

// Deleting a generator category cannot remove it — it is not ours — so it is hidden instead.
// Renaming one lands here too: after the fork its clips have moved out, so it goes out of
// sight until a generation fills it again.
function hide(kind, id) {
  const state = read();
  if (!state[kind]) throw new Error(`no such kind "${kind}"`);
  if (!state[kind].hidden.includes(String(id))) state[kind].hidden.push(String(id));
  state[kind].order = state[kind].order.filter(x => x !== String(id));
  write(state);
}

// Is this a category the Birols generator owns? Those are hidden rather than deleted.
function isGen(id) {
  return genCats().some(c => c.id === String(id));
}

function remove(kind, id) {
  const state = read();
  if (!state[kind]) throw new Error(`no such kind "${kind}"`);
  const before = state[kind].own.length;
  state[kind].own = state[kind].own.filter(c => c.id !== String(id));
  if (state[kind].own.length === before) throw new Error('not a library category');
  state[kind].order = state[kind].order.filter(x => x !== String(id));
  state[kind].hidden = state[kind].hidden.filter(x => x !== String(id));
  write(state);
}

// The chips the page shows, in the order it shows them. Ids that are not this kind's are
// ignored rather than rejected: the row can hold a Birols-tab category or an orphan, and
// the order is a display concern, so it may name anything currently on screen.
function setOrder(kind, ids) {
  const state = read();
  if (!state[kind]) throw new Error(`no such kind "${kind}"`);
  const clean = [];
  for (const raw of (Array.isArray(ids) ? ids : [])) {
    const id = String(raw);
    if (!id || id === UNCAT || clean.includes(id)) continue;
    clean.push(id);
  }
  state[kind].order = clean;
  write(state);
  return clean;
}

module.exports = {
  KINDS, UNCAT, UPLOADS_CAT,
  read, write, genCats, listFor, isOwn, ownerKindOf, isGen,
  add, rename, remove, hide, setOrder, newId,
};
