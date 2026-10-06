'use strict';

// ════════════════════════════════════════════════════════════════════════════
// A PROJECT'S CATEGORY FOLLOWS ITS NAME (review V2r) - on every shelf its chats file into: Images (the pictures
// chat), B-roll (the video chat's clips), Uploads (clips brought in through the video chat), Sounds (sounds brought in
// through it - phase V7). The category is
// the project's title (lib/mv3-gens.js catLabelFor), found without case, as LC.add finds it when it files.
//
//   follow(oldLabel, newLabel) -> { images, birols, uploads, sounds }: 'renamed' | 'merged' | '' (none there) | 'failed'
//
//   renamed   the category takes the new name, its folder moves with every path under it (lib/shelf-files.js
//             renameCategory), and the copies of the label on its records follow - as the Library's own rename
//   merged    the shelf already has a category of the new name - one a deleted project left, say: the records
//             go into THAT one with their files (lib/shelf-files.js placeRecords) and the old category goes.
//             Renamed instead, the shelf would hold two of one name, and LC.add files into the first it finds.
// Each shelf on its own: one that fails - a folder held open while a clip lands - leaves the others done.
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
  if (!cat) return '';
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
  // Into the category of that name: the records, then their files, then the old chip and its folder.
  const list = st.read();
  const ids = new Set();
  for (const e of list) {
    if (!st.inKind(e) || String(e.categoryId || '') !== cat.id) continue;
    e.categoryId = target.id;
    e.categoryLabel = target.label;
    ids.add(String(e.id));
  }
  if (ids.size) {
    st.write(list);
    SHELF.placeRecords(st.read().filter(e => e && ids.has(String(e.id))).map(rec => ({ kind, rec })));
  }
  const folder = cat.folder;
  LC.remove(kind, cat.id);
  SHELF.dropEmptyFolder(kind, folder);
  return 'merged';
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

module.exports = { follow, KINDS };
