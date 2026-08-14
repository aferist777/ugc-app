// LIBRARY — the actions: rename, favourite, category, delete, upload.
//
// Every action is server-first: the endpoint writes the data file, and only then does
// this module patch the matching localStorage key.
//
// That second write is not belt-and-braces, it is the whole trick. biroly.json,
// hooks-archive.json and obrazy.json are owned by the BROWSER — biroly-server-sync.js
// and friends push a whole-localStorage snapshot every 2s from whatever page is open.
// Those loops hash localStorage each tick and push only when it changed, so:
//   - patch localStorage too, and an open Birols tab agrees and stays quiet;
//   - skip it, and the next edit in that tab pushes a snapshot built on the stale copy,
//     silently resurrecting whatever was deleted here.
// If the key is absent (this browser has never opened Birols) there is nothing to
// clobber and nothing to patch.

const CHAR_KIND = 'characters';

function _lsRead(key) {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return undefined;              // absent: no local copy to keep in step
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : undefined;
  } catch (e) { return undefined; }
}
function _lsPatch(key, id, patch) {
  if (!key) return;
  const list = _lsRead(key);
  if (!list) return;
  const it = list.find(x => x && String(x.id) === String(id));
  if (!it) return;
  Object.assign(it, patch);
  try { localStorage.setItem(key, JSON.stringify(list)); } catch (e) {}
}
function _lsDrop(key, id) {
  if (!key) return;
  const list = _lsRead(key);
  if (!list) return;
  const next = list.filter(x => !(x && String(x.id) === String(id)));
  if (next.length === list.length) return;
  try { localStorage.setItem(key, JSON.stringify(next)); } catch (e) {}
}
function _lsUnshift(key, rec) {
  if (!key || !rec) return;
  const list = _lsRead(key);
  if (!list) return;
  if (list.some(x => x && x.videoPath === rec.videoPath)) return;
  list.unshift(rec);
  try { localStorage.setItem(key, JSON.stringify(list)); } catch (e) {}
}

async function _json(url, opts) {
  const r = await fetch(url, opts);
  const d = await r.json().catch(() => null);
  if (!d || !d.success) throw new Error((d && d.error) || ('HTTP ' + r.status));
  return d;
}

// ── Thumbnails ──────────────────────────────────────────────────────────────
// The grid draws 72px cards, but a clip can have no thumbnail at all (the card then loads
// the VIDEO to show one frame) or a "thumbnail" that is really the full 720x1280 frame.
// Both are the same symptom - a shelf that costs megabytes to look at - and the server
// already knows how to tell them apart and fix them, one clip at a time:
//   /api/media/thumbs/audit  which of these need work, by reading the image header
//   /api/media/thumb         make exactly one
// One at a time is the server's rule, not a limitation here: a sweep of the whole library
// must not saturate the box while a render is running.
export async function auditThumbs(items) {
  const payload = items
    .filter(it => it && it.media && /\.(mp4|webm|mov|mkv|m4v)(\?|$)/i.test(String(it.media)))
    .map(it => ({ id: it.id, video: it.media }));
  if (!payload.length) return { need: [], ok: 0, missing: [], total: 0 };
  return _json('/api/media/thumbs/audit', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items: payload }),
  });
}

// Make one thumbnail and REMEMBER it. The file alone changes nothing on the shelf: the
// media shelf reads `thumb` from the record, so the path has to reach the store, and the
// store is browser-owned - hence the same PATCH + localStorage patch as every other edit.
export async function fixThumb(it) {
  const d = await _json('/api/media/thumb', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ video: it.media }),
  });
  const p = await _json(_itemUrl(it), {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ thumbPath: d.thumbPath }),
  });
  _lsPatch(p.lsKey, it.id, { thumbPath: d.thumbPath });
  return d.thumbPath;
}

// ── Rename ──────────────────────────────────────────────────────────────────
// Only the shelves whose name is a LABEL and nothing else.
//   - lookbooks / environments: the name IS the filename, and look records point at
//     those filenames, so renaming the file would quietly break them.
//   - looks (obrazy): a look's folder on disk is slug(name)_shortId(id), so the name is
//     part of a path. The stored image URLs would still resolve, but anything that
//     re-derives the folder from the record — lib/obrazy-store.js findObrazFolderById,
//     which the pose-variations endpoint uses to decide where to write — would point at
//     a folder that does not exist. Renaming a look safely means moving the folder and
//     rewriting every URL in the record; that belongs with the looks rework, not here.
export const CAN_RENAME = new Set([CHAR_KIND, 'birols', 'uploads', 'hooks']);

export async function renameItem(it) {
  const next = prompt('Rename', it.name || '');
  if (next == null) return null;
  const name = String(next).trim();
  if (!name || name === it.name) return null;
  if (it.kind === CHAR_KIND) {
    // characters.json has one writer and it also handles the character's voice.
    await _json('/api/char-store/' + encodeURIComponent(it.id), {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
  } else {
    const d = await _json(_itemUrl(it), {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    _lsPatch(d.lsKey, it.id, { name });
  }
  return name;
}

// ── Favourite ───────────────────────────────────────────────────────────────
export async function toggleFavorite(it) {
  const favorite = !(it.meta && it.meta.favorite);
  const d = await _json(_itemUrl(it), {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ favorite }),
  });
  _lsPatch(d.lsKey, it.id, { favorite });
  return favorite;
}

// ── Category ────────────────────────────────────────────────────────────────
// Every list at once, keyed by kind. A card's dropdown must offer its OWN kind's list, and
// the All filter shows all three kinds in one grid, so one request beats one per card.
export async function loadCats() {
  try { return (await _json('/api/library/cats')).byKind || {}; } catch (e) { return {}; }
}

// ── Category vocabulary: create, rename, reorder, delete ─────────────────────
// Renaming or deleting a category rewrites `categoryId`/`categoryLabel` across many records
// at once, so the localStorage mirror is patched the same way rather than per record. Every
// endpoint reports which store it touched (`lsKey`) and how many records moved.
const _isUploadRec = (e) => !!(e && (e.source === 'upload' || e.categoryId === '__uploads__'));
const _ofKind = (e, kind) => (kind === 'hooks' ? true : _isUploadRec(e) === (kind === 'uploads'));

function _lsReassign(key, kind, fromId, toId, toLabel) {
  if (!key) return;
  const list = _lsRead(key);
  if (!list) return;
  let n = 0;
  for (const e of list) {
    if (!_ofKind(e, kind) || String((e && e.categoryId) || '') !== String(fromId)) continue;
    e.categoryId = toId || '';
    e.categoryLabel = toLabel || '';
    if (kind === 'uploads') e.source = 'upload';
    n++;
  }
  if (n) { try { localStorage.setItem(key, JSON.stringify(list)); } catch (e) {} }
}
function _lsDropByCat(key, kind, catId) {
  if (!key) return;
  const list = _lsRead(key);
  if (!list) return;
  const next = list.filter(e => !(_ofKind(e, kind) && String((e && e.categoryId) || '') === String(catId)));
  if (next.length !== list.length) { try { localStorage.setItem(key, JSON.stringify(next)); } catch (e) {} }
}

// The Merge media bars build their category filters from these localStorage keys
// (getTypeCategories in public/js/biroly-archive.js), so a name given here has to be
// written there too or Merge would never offer it. Birols are left alone on purpose —
// that list belongs to the Birols tab.
const MERGE_CAT_KEYS = { hooks: 'hooks_cats', uploads: 'uploads_cats' };
function _mirrorToMerge(byKind) {
  for (const [kind, key] of Object.entries(MERGE_CAT_KEYS)) {
    const cats = (byKind && byKind[kind]) || [];
    try { localStorage.setItem(key, JSON.stringify(cats.map(c => ({ id: c.id, label: c.label })))); } catch (e) {}
  }
}

export async function addCat(kind, label) {
  const d = await _json('/api/library/cats', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind, label }),
  });
  return d;                            // { cat, created } — created:false means it existed
}

// Two outcomes, decided by the server: a Library category renames in place, while a
// Birols-tab category FORKS — a Library category takes the new name and the clips move into
// it, leaving the Birols tab's own category untouched.
export async function renameCat(kind, id, label) {
  const d = await _json('/api/library/cats/' + encodeURIComponent(id), {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind, label }),
  });
  if (d.moved) _lsReassign(d.lsKey, kind, id, d.cat.id, d.cat.label);
  return d;
}

export async function setCatOrder(kind, order) {
  return _json('/api/library/cats/order', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind, order }),
  });
}

// mode 'move' clears the category off its clips; mode 'delete' removes the clips and their
// files. The caller is responsible for having said which, in words, before getting here.
export async function deleteCat(kind, id, mode) {
  const d = await _json('/api/library/cats/' + encodeURIComponent(id)
    + '?kind=' + encodeURIComponent(kind) + '&media=' + (mode === 'delete' ? 'delete' : 'move'),
    { method: 'DELETE' });
  if (d.mode === 'delete') _lsDropByCat(d.lsKey, kind, id);
  else _lsReassign(d.lsKey, kind, id, '', '');
  return d;
}

export { _mirrorToMerge as mirrorCatsToMerge };
// Both fields go, not just the id: the label is a denormalised copy that
// public/js/biroly-archive.js reads to draw a heading, and without it that heading falls back
// to "Category (abc123)". Renaming a category rewrites the same copy for the same reason.
export async function setCategory(it, categoryId, categoryLabel) {
  const d = await _json(_itemUrl(it), {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ categoryId, categoryLabel: categoryLabel || '' }),
  });
  // categoryLabel is carried alongside categoryId everywhere else in the archive;
  // keep the local copy consistent with it rather than half-updated.
  _lsPatch(d.lsKey, it.id, { categoryId, categoryLabel: categoryLabel || '' });
  return categoryId;
}

// ── Kind ────────────────────────────────────────────────────────────────────
// birols <-> uploads is one field in one store; anything involving hooks is a record
// moving between two files. The server does both so a move cannot land half-applied;
// here the job is only to keep the local copies in step, which for a cross-store move
// means dropping from one key and prepending to the other.
export const KINDS = [
  { id: 'birols',  label: 'Birol' },
  { id: 'uploads', label: 'Upload' },
  { id: 'hooks',   label: 'Hook' },
];

export async function setKind(it, kind) {
  if (kind === it.kind) return it.kind;
  const d = await _json(_itemUrl(it) + '/kind', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind }),
  });
  if (d.fromLsKey && d.fromLsKey !== d.lsKey) {
    _lsDrop(d.fromLsKey, it.id);
    _lsUnshift(d.lsKey, d.item);
  } else if (d.item) {
    // Same store: mirror exactly the fields the server decided. Moving to birols leaves
    // `source` undefined, and JSON.stringify drops undefined keys, so assigning it is
    // how the field gets removed from the local copy too.
    _lsPatch(d.lsKey, it.id, { source: d.item.source, categoryId: d.item.categoryId });
  }
  return kind;
}

// ── Delete ──────────────────────────────────────────────────────────────────
// What goes with the record differs per shelf, so the confirmation says it out loud.
// A character takes its ElevenLabs voice with it (unless another character shares it) —
// that is not recoverable, so it is spelled out rather than implied.
export function deleteWarning(it) {
  if (it.kind === CHAR_KIND) {
    const n = (it.meta && it.meta.looks) || 0;
    return 'Delete the character "' + (it.name || '') + '"?\n\n'
      + 'Its record goes, and its ElevenLabs voice too unless another character uses it.\n'
      + (n ? 'Its ' + n + ' look' + (n === 1 ? '' : 's') + ' stay on the Characters shelf until deleted separately.\n' : '')
      + '\nThe character sheet file stays on disk.';
  }
  if (it.kind === 'obrazy') {
    const v = (it.meta && it.meta.variations) || 0;
    return 'Delete the look "' + (it.name || '') + '"?\n\n'
      + 'Its folder goes with it' + (v ? ' — the look image and ' + v + ' pose variation' + (v === 1 ? '' : 's') : '') + '.';
  }
  if (it.kind === 'lookbooks' || it.kind === 'environments') {
    return 'Delete the file "' + (it.name || '') + '"?\n\nThe image and its thumbnail are removed from disk.';
  }
  // A render is a finished video and the only copy: there is no record it can be rebuilt from,
  // and re-rendering costs what it cost the first time. So this warning carries the weight -
  // the size, and the fact that nothing else holds it.
  if (it.kind === 'renders') {
    const mb = (it.meta && it.meta.sizeMb) || 0;
    return 'Delete the render "' + (it.name || '') + '"?\n\n'
      + 'The video' + (mb ? ' (' + mb + ' MB)' : '') + ' and its poster are removed from disk.\n'
      + 'This is the only copy - re-rendering is the only way back.';
  }
  return 'Delete "' + (it.name || '') + '"?\n\nThe clip and its thumbnail are removed from disk.';
}

export async function deleteItem(it) {
  if (it.kind === CHAR_KIND) {
    await _json('/api/char-store/' + encodeURIComponent(it.id), { method: 'DELETE' });
    return true;
  }
  const d = await _json(_itemUrl(it), { method: 'DELETE' });
  _lsDrop(d.lsKey, it.id);
  return true;
}

// ── Upload ──────────────────────────────────────────────────────────────────
// Two steps on purpose: /api/biroly/upload owns the file and its thumbnail, and it
// deliberately does not touch the archive; the record is filed after. onEach reports
// progress so a batch of big clips does not look like a hung page.
// `kind` decides which store the record goes into — the page passes whichever kind is
// open. The FILE always lands in uploads/ whatever the kind is: the record stores its
// url rather than deriving it, so the folder carries no meaning and one upload endpoint
// (with its one thumbnail step) serves all three.
export async function uploadVideos(files, kind, onEach) {
  let ok = 0;
  const list = Array.from(files || []);
  for (let i = 0; i < list.length; i++) {
    const f = list[i];
    if (onEach) onEach(i + 1, list.length, f.name);
    try {
      const fd = new FormData();
      fd.append('video', f);
      fd.append('name', f.name.replace(/\.[^.]+$/, ''));
      const up = await _json('/api/biroly/upload', { method: 'POST', body: fd });
      const rec = await _json('/api/library/media/record', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoPath: up.videoPath, thumbPath: up.thumbPath, name: up.name, kind }),
      });
      _lsUnshift(rec.lsKey, rec.item);
      ok++;
    } catch (e) { /* one bad file must not stop the batch */ }
  }
  return { ok, total: list.length };
}

// ── Broken records ──────────────────────────────────────────────────────────
// Records whose file is not there. Every shelf hides them (each checks the file exists), so
// they are invisible but still counted - the "128 total, 127 shown" gap.
//
// Cleaning is two calls on purpose. Media records are this module's own store, but looks are
// already handled by POST /api/obrazy/prune-missing, which drops looks with no surviving image
// AND sweeps geni.json alongside; reusing it beats writing that logic twice. It hands back the
// kept lists, and those MUST be written to localStorage: obrazy and all_geni_v1 are
// browser-owned, so leaving the local copies stale would let the next 2s push restore them.
export async function findBroken() {
  return _json('/api/library/broken');
}

export async function cleanBroken() {
  const out = { media: 0, looks: 0, geni: 0 };

  const d = await _json('/api/library/broken/clean', { method: 'POST' });
  out.media = d.count || 0;
  const byKey = {};
  for (const r of (d.dropped || [])) (byKey[r.lsKey] = byKey[r.lsKey] || []).push(r.id);
  for (const [key, ids] of Object.entries(byKey)) {
    const list = _lsRead(key);
    if (!list) continue;
    const gone = new Set(ids.map(String));
    const next = list.filter(e => !(e && gone.has(String(e.id))));
    if (next.length !== list.length) { try { localStorage.setItem(key, JSON.stringify(next)); } catch (e) {} }
  }

  try {
    const p = await _json('/api/obrazy/prune-missing', { method: 'POST' });
    out.looks = (p.removedObrazy || []).length;
    out.geni = p.removedGeniCount || 0;
    // write back what the server kept, or the local copies would push the removed ones again
    if (Array.isArray(p.obrazy)) { try { localStorage.setItem('obrazy', JSON.stringify(p.obrazy)); } catch (e) {} }
    if (Array.isArray(p.geni))   { try { localStorage.setItem('all_geni_v1', JSON.stringify(p.geni)); } catch (e) {} }
  } catch (e) { out.looksError = e.message; }

  return out;
}

// ── Duplicates ──────────────────────────────────────────────────────────────
// Records pointing at the same file, not clips that look alike — so there is nothing to
// compare visually. Reporting is free; cleaning drops the redundant records and never touches
// a file, because the copy that stays needs the same video and the same thumbnail.
export async function findDupes() {
  return _json('/api/library/dupes');
}

// The localStorage patch is what makes this stick. This store belongs to the browser: an open
// Birols or Character tab pushes its whole localStorage every 2s, so dropping the records only
// on the server would be undone within seconds by that push.
export async function cleanDupes() {
  const d = await _json('/api/library/dupes/clean', { method: 'POST' });
  const byKey = {};
  for (const r of (d.dropped || [])) (byKey[r.lsKey] = byKey[r.lsKey] || []).push(r.id);
  for (const [key, ids] of Object.entries(byKey)) {
    const list = _lsRead(key);
    if (!list) continue;
    const gone = new Set(ids.map(String));
    const next = list.filter(e => !(e && gone.has(String(e.id))));
    if (next.length !== list.length) { try { localStorage.setItem(key, JSON.stringify(next)); } catch (e) {} }
  }
  return d;
}

// Media records live under their kind (birols / uploads / hooks); the file shelves are
// addressed by filename, which is their id.
function _itemUrl(it) {
  return '/api/library/item/' + encodeURIComponent(it.kind) + '/' + encodeURIComponent(it.id);
}
