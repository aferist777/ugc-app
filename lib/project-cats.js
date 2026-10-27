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
//   renamed   the category takes the new name, its folder moves with every path under it (lib/folders.js
//             rename), and the copies of the label on its records follow - as the Library's own rename
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
// (phase V54 block 6, (зв40)) Folders in folders: a project's category is found by its name AT THE TOP FIRST, then anywhere in
// its kind - moved into another folder ("Clients"), it stays the project's: renamed there, merged with a folder of the new
// name beside it, let go of there. What is in it goes with it as lib/folders.js moves it: its own folders too ("Name (2)"
// when the place has one of that name - the app never stops on a name).
// ════════════════════════════════════════════════════════════════════════════

const LC = require('./library-cats');
const FOLDERS = require('./folders');

const KINDS = ['images', 'birols', 'uploads', 'sounds'];

function _store(kind) {
  if (kind === 'images') { const IMG = require('./images-store'); return { read: IMG.read, write: IMG.write, inKind: (e) => !!e }; }
  if (kind === 'sounds') { const SND = require('./sounds-store'); return { read: SND.read, write: SND.write, inKind: (e) => !!e }; }
  const B = require('./birols-store');
  const isUp = (e) => !!(e && (e.source === 'upload' || e.categoryId === LC.UPLOADS_CAT));
  return { read: B.read, write: B.write, inKind: (e) => !!e && isUp(e) === (kind === 'uploads') };
}


function _one(kind, oldLabel, newLabel) {
  const state = LC.read();
  const cat = LC.findByName(state, kind, oldLabel);
  if (!cat || LC.isLocked(kind, cat.id, state)) return '';
  // A folder of the new name beside it takes what is in it; none - it is renamed (its records' copy of the name too).
  const target = LC.siblingNamed(state, kind, cat.parent, newLabel, cat.id);
  if (!target) { FOLDERS.rename(kind, cat.id, newLabel); return 'renamed'; }
  merge(kind, cat, target);
  return 'merged';
}

// Into the category `into`: its folders, its records with their files, then the old chip and its folder (lib/folders.js).
function merge(kind, from, into) {
  return FOLDERS.empty(kind, from.id, into.id, { byHand: false }).records;
}

// What is in it one level up - at the top, into its kind (Uncategorized) - and the chip gone.
function _release(kind, label) {
  const state = LC.read();
  const cat = LC.findByName(state, kind, label);
  if (!cat || LC.isLocked(kind, cat.id, state)) return '';
  FOLDERS.empty(kind, cat.id, cat.parent, { byHand: false });
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
      const cat = LC.findByName(LC.read(), kind, label);
      if (!cat) continue;
      const st = _store(kind);
      n += st.read().filter(e => st.inKind(e) && String(e.categoryId || '') === cat.id).length;
    } catch (e) { /* that shelf unread */ }
  }
  return n;
}

// One shelf's category of that name let go of (lib/required-cats.js: B-roll's "Generated" of the first round).
const releaseIn = (kind, label) => _release(kind, label);

module.exports = { follow, release, releaseIn, filedUnder, merge, KINDS };
