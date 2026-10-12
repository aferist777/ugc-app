'use strict';

// ════════════════════════════════════════════════════════════════════════════
// A PROJECT'S CATEGORY FOLLOWS ITS NAME (review V2r) - on every shelf its chats file into: Images (the pictures
// chat), B-roll (the video chat's clips), Uploads (clips brought in through the video chat), Sounds (sounds brought in
// through it - phase V7). The category is
// the project's title (lib/mv3-gens.js catLabelFor), found without case, as LC.add finds it when it files.
//
//   follow(oldLabel, newLabel) -> { images, birols, uploads, sounds }: 'renamed' | 'merged' | '' (none there) | 'failed'
//   release(label)              -> { images, birols, uploads, sounds }: 'released' | '' (none there) | 'failed'
//   filedUnder(label)           -> how many records the category of that name holds, every shelf together
//
//   renamed   the category takes the new name, its folder moves with every path under it (lib/shelf-files.js
//             renameCategory), and the copies of the label on its records follow - as the Library's own rename
//   merged    the shelf already has a category of the new name - one a deleted project left, say: the records
//             go into THAT one with their files (lib/shelf-files.js placeRecords) and the old category goes.
//             Renamed instead, the shelf would hold two of one name, and LC.add files into the first it finds.
//   released  (phase V20, the owner 2026-10-08: a draft not saved) the records go to Uncategorized with their files -
//             the shelf's nocat folder, every path following - and the category goes; the Library's own "delete the
//             category, keep what is in it".
// Each shelf on its own: one that fails - a folder held open while a clip lands - leaves the others done.
// (phase V28.4) A REQUIRED category (lib/library-cats.js REQUIRED - "Generated", "Screenshots"...) is never renamed or
// let go of here: a project with no title files under "Generated", and renaming or deleting that project must not take
// the category with it. Merging INTO one is fine.
//   merge(kind, from, into)    the records of category `from` into category `into` with their files; `from` goes
// ════════════════════════════════════════════════════════════════════════════

const LC = require('./library-cats');
const SHELF = require('./shelf-files');

const KINDS = ['images', 'birols', 'uploads', 'sounds'];

function _store(kind) {
  if (kind === 'images') { const IMG = require('./images-store'); return { read: IMG.read, write: IMG.write, inKind: (e) => !!e }; }
  if (kind === 'sounds') { const SND = require('./sounds-store'); return { read: SND.read, write: SND.write, inKind: (e) => !!e }; }
  const B = require('./birols-store');
  const isUp = (e) => !!(e && (e.source === 'upload' || e.categoryId === LC.UPLOADS_CAT));
  return { read: B.read, write: B.write, inKind: (e) => !!e && isUp(e) === (kind === 'uploads') };
}

const _same = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

function _one(kind, oldLabel, newLabel) {
  const own = ((LC.read()[kind] || {}).own) || [];
  const cat = own.find(c => _same(c.label, oldLabel));
  if (!cat || LC.isLocked(kind, cat.id)) return '';
  const target = own.find(c => c.id !== cat.id && _same(c.label, newLabel));
  const st = _store(kind);
  if (!target) {
    const done = SHELF.renameCategory(kind, cat.id, newLabel);
    const list = st.read();
    let n = 0;
    for (const e of list) if (st.inKind(e) && String(e.categoryId || '') === cat.id) { e.categoryLabel = done.label; n++; }
    if (n) st.write(list);
    return 'renamed';
  }
  merge(kind, cat, target);
  return 'merged';
}

// Into the category `into`: the records, then their files, then the old chip and its folder.
function merge(kind, from, into) {
  const st = _store(kind);
  const list = st.read();
  const ids = new Set();
  for (const e of list) {
    if (!st.inKind(e) || String(e.categoryId || '') !== from.id) continue;
    e.categoryId = into.id;
    e.categoryLabel = into.label;
    ids.add(String(e.id));
  }
  if (ids.size) {
    st.write(list);
    SHELF.placeRecords(st.read().filter(e => e && ids.has(String(e.id))).map(rec => ({ kind, rec })));
  }
  const folder = from.folder;
  LC.remove(kind, from.id);
  SHELF.dropEmptyFolder(kind, folder);
  return ids.size;
}

function _release(kind, label) {
  const own = ((LC.read()[kind] || {}).own) || [];
  const cat = own.find(c => _same(c.label, label));
  if (!cat || LC.isLocked(kind, cat.id)) return '';
  const st = _store(kind);
  const list = st.read();
  const ids = new Set();
  for (const e of list) {
    if (!st.inKind(e) || String(e.categoryId || '') !== cat.id) continue;
    e.categoryId = '';
    e.categoryLabel = '';
    ids.add(String(e.id));
  }
  if (ids.size) {
    st.write(list);
    SHELF.placeRecords(st.read().filter(e => e && ids.has(String(e.id))).map(rec => ({ kind, rec })));
  }
  const folder = cat.folder;
  LC.remove(kind, cat.id);
  SHELF.dropEmptyFolder(kind, folder);
  return 'released';
}

function release(label) {
  const out = {};
  if (!String(label || '').trim()) return out;
  for (const kind of KINDS) {
    try { out[kind] = _release(kind, label); }
    catch (e) { out[kind] = 'failed'; console.warn('[project-cats] ' + kind + ': the category "' + label + '" was not let go of -', e.message); }
  }
  return out;
}

function follow(oldLabel, newLabel) {
  const out = {};
  // The same words: nothing to do. Only the case changed: renamed (the folder goes through a temporary name).
  if (String(oldLabel || '').trim() === String(newLabel || '').trim()) return out;
  for (const kind of KINDS) {
    try { out[kind] = _one(kind, oldLabel, newLabel); }
    catch (e) { out[kind] = 'failed'; console.warn('[project-cats] ' + kind + ': the category "' + oldLabel + '" did not follow -', e.message); }
  }
  return out;
}

// (phase V20) What a draft filed - pictures, clips, sounds brought in or made - counts as something to ask about.
function filedUnder(label) {
  let n = 0;
  if (!String(label || '').trim()) return n;
  for (const kind of KINDS) {
    try {
      const cat = (((LC.read()[kind] || {}).own) || []).find(c => _same(c.label, label));
      if (!cat) continue;
      const st = _store(kind);
      n += st.read().filter(e => st.inKind(e) && String(e.categoryId || '') === cat.id).length;
    } catch (e) { /* that shelf unread */ }
  }
  return n;
}

module.exports = { follow, release, filedUnder, merge, KINDS };
