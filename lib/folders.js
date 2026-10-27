'use strict';

// ════════════════════════════════════════════════════════════════════════════
// A FOLDER OF THE MEDIA TREE WITH EVERYTHING IN IT (phase V54 block 6, the owner 2026-10-27/28, (зв19)-(зв22), (зв27),
// (зв33)-(зв46)): renamed, moved into another folder of its kind, or emptied - its content one level up - and gone.
// The list is lib/library-cats.js; a file's place is lib/shelf-files.js; every move goes through lib/relocate.js (the
// files with their derivatives, every store and project rewritten, the old addresses remembered by lib/moves.js).
//
//   rename(kind, id, label)            its name and its folder on the disk; every folder under it follows
//   move(kind, id, parent)             into another folder of its kind ('' - the kind itself)
//   empty(kind, id, into, { byHand })  what is in it - its files and its folders - into `into` (its parent, when it is
//                                      deleted keeping what is in it; another folder, when a project's merges), and it goes
//   recordsIn(kind, ids)               the records lying directly in those folders (a delete with its files, usage)
//
// THE DISK FIRST, THE LIST AFTER: a folder is renamed or moved on the disk in ONE relocate (one pair of folders, however
// much is under it), and only then does the list say so - a move refused by Windows (a file held by another program)
// leaves the list as it was. A folder with nothing in it yet has no folder on the disk: only the list changes.
//
// WHAT IS REFUSED, in words (409 unless said): a required category (lib/library-cats.js REQUIRED: it stays at the top,
// named as the code looks for it); a folder into itself or one under it; a name already in that place - moved there or
// lifted there by hand (the owner's (зв35): "отказать словами"); a path too long for the disk (зв34, 400). What the app
// does by itself (a project renamed onto a folder of the new name, a draft let go of, a second "Generated" folded into
// the first) never stops on a name: a folder of a taken name is given "Name (2)".
// ════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const LC = require('./library-cats');
const R = require('./relocate');
const SHELF = require('./shelf-files');
const { DATA_DIR } = require('./config');
const { writeFileAtomic } = require('./atomic-write');

const _err = (status, message) => Object.assign(new Error(message), { status });
const _lc = (s) => String(s || '').trim().toLowerCase();

// ── The records a kind keeps ───────────────────────────────────────────────
// { read, write, inKind } - B-roll and Uploads share one store and are told apart by a flag.
function storeOf(kind) {
  if (kind === 'images') { const S = require('./images-store'); return { read: S.read, write: S.write, inKind: (e) => !!e }; }
  if (kind === 'sounds') { const S = require('./sounds-store'); return { read: S.read, write: S.write, inKind: (e) => !!e }; }
  if (kind === 'music') { const S = require('./music-store'); return { read: S.read, write: S.write, inKind: (e) => !!e }; }
  if (kind === 'references') {
    const S = require('./references-store');
    return { read: S.read, write: (l) => S.apply((list) => { list.splice(0, list.length, ...l); }), inKind: (e) => !!e };
  }
  if (kind === 'hooks') {
    const F = path.join(DATA_DIR, 'hooks-archive.json');
    const read = () => { try { const l = JSON.parse(fs.readFileSync(F, 'utf8')); return Array.isArray(l) ? l : []; } catch (e) { return []; } };
    return { read, write: (l) => writeFileAtomic(F, JSON.stringify(l, null, 2)), inKind: (e) => !!e };
  }
  if (kind === 'birols' || kind === 'uploads') {
    const S = require('./birols-store');
    const isUp = (e) => !!(e && (e.source === 'upload' || e.categoryId === LC.UPLOADS_CAT));
    return { read: S.read, write: S.write, inKind: (e) => !!e && isUp(e) === (kind === 'uploads') };
  }
  throw _err(400, 'no folders in "' + kind + '"');
}

/** The records lying directly in any of the folders `ids`. */
function recordsIn(kind, ids) {
  const want = new Set((ids || []).map(String));
  const st = storeOf(kind);
  return st.read().filter((e) => st.inKind(e) && want.has(String(e.categoryId || '')));
}

// Records placed where their category says: a post with its files (lib/references-store.js), any other through
// lib/shelf-files.js - one relocate for all of them.
function _place(kind, recs) {
  if (!recs.length) return;
  if (kind === 'references') { require('./references-store').placePosts(recs); return; }
  SHELF.placeRecords(recs.map((rec) => ({ kind, rec })));
}

// The copy of a folder's name its records keep (`categoryLabel`) - every one lying directly in it.
function _relabel(kind, id, label) {
  const st = storeOf(kind);
  const list = st.read();
  let n = 0;
  for (const e of list) if (st.inKind(e) && String(e.categoryId || '') === String(id)) { e.categoryLabel = label; n++; }
  if (n) st.write(list);
}

// A folder's files on the disk from one path to another - one relocate, or two when only the case changes (Windows sees
// one name: through a temporary one). Nothing there yet - nothing to move.
function _moveDir(kind, from, to) {
  if (!from || from === to) return;
  const base = LC.kindUrl(kind);
  const fromAbs = path.join(LC.kindDir(kind), ...from.split('/'));
  if (!fs.existsSync(fromAbs)) return;
  if (from.toLowerCase() === to.toLowerCase()) {
    const tmp = to + ' ~' + Date.now().toString(36);
    R.relocate({ folders: [[base + from + '/', base + tmp + '/']] });
    R.relocate({ folders: [[base + tmp + '/', base + to + '/']] });
    return;
  }
  R.relocate({ folders: [[base + from + '/', base + to + '/']] });
}

// What a place is called, for a refusal: a folder's name, or the kind's.
const KIND_WORD = { birols: 'B-rolls', uploads: 'Uploads', hooks: 'Hooks', images: 'IMAGES', sounds: 'My sounds', references: 'REFERENCES', music: 'Music' };
const _placeName = (state, kind, id) => (id ? LC.titleOf((LC.byIdOf(state, kind, id) || {}).label) : (KIND_WORD[kind] || kind));

// The one a folder must be before anything is done to it.
function _own(state, kind, id, verb) {
  const c = LC.byIdOf(state, kind, id);
  if (!c) throw _err(404, 'That folder is not there any more.');
  if (LC.isLocked(kind, id, state)) throw _err(409, 'This folder is required - it cannot be ' + verb + '. Folders inside it can.');
  if (!c.folder) { LC.folderOf(kind, id, c.label); return LC.byIdOf(LC.read(), kind, id); }
  return c;
}

/** Its name, and its folder on the disk with everything under it. */
function rename(kind, id, label) {
  const name = String(label || '').trim().slice(0, 60);
  if (!name) throw _err(400, 'A folder needs a name.');
  let state = LC.read();
  const c = _own(state, kind, id, 'renamed');
  state = LC.read();
  if (name === c.label) return c;
  const twin = LC.siblingNamed(state, kind, c.parent, name, c.id);
  if (twin) throw _err(409, 'There is already a folder called "' + LC.titleOf(twin.label) + '" in ' + _placeName(state, kind, c.parent) + '.');
  const next = LC.pathFor(state, kind, name, c.parent, c.id);
  const why = LC.tooLong(LC.deepestFor(state, kind, c.id, next));
  if (why) throw _err(400, why);
  _moveDir(kind, c.folder, next);
  state = LC.read();
  const now = LC.byIdOf(state, kind, c.id);
  now.label = name;
  LC.setPath(state, kind, c.id, next);
  LC.write(state);
  _relabel(kind, c.id, name);
  return now;
}

/** Into another folder of its kind ('' - the kind itself), with everything under it. */
function move(kind, id, parent) {
  let state = LC.read();
  const c = _own(state, kind, id, 'moved');
  state = LC.read();
  const p = String(parent || '');
  if (p === c.parent) return c;
  if (p && !LC.byIdOf(state, kind, p)) throw _err(404, 'The folder to put it in is not there any more.');
  if (p && LC.isUnder(state, kind, p, c.id)) throw _err(409, 'A folder cannot go into itself or into a folder inside it.');
  const twin = LC.siblingNamed(state, kind, p, c.label, c.id);
  if (twin) {
    throw _err(409, 'There is already a folder called "' + LC.titleOf(twin.label) + '" in ' + _placeName(state, kind, p)
      + ' - rename one of them first.');
  }
  const next = LC.pathFor(state, kind, c.label, p, c.id);
  const why = LC.tooLong(LC.deepestFor(state, kind, c.id, next));
  if (why) throw _err(400, why);
  _moveDir(kind, c.folder, next);
  state = LC.read();
  const now = LC.byIdOf(state, kind, c.id);
  LC.setPath(state, kind, c.id, next);
  now.parent = p;
  LC.write(state);
  return now;
}

/**
 * Everything in a folder into `into` ('' - the kind itself; its parent when it is deleted keeping what is in it), and the
 * folder gone. Its folders go first, each in one relocate written at once (a later one refused by Windows leaves the
 * earlier ones right); then its own records, placed in one relocate; then the folder out of the list, its emptied
 * folder off the disk. By hand a folder of a name `into` has already is refused before anything moves (зв35); by the app
 * it is given "Name (2)". -> { records, folders }
 */
function empty(kind, id, into, opts) {
  const byHand = !!(opts && opts.byHand);
  let state = LC.read();
  const c = _own(state, kind, id, 'deleted');
  state = LC.read();
  const to = String(into || '');
  if (to && !LC.byIdOf(state, kind, to)) throw _err(404, 'The folder to put it in is not there any more.');
  if (to && LC.isUnder(state, kind, to, c.id)) throw _err(409, 'A folder cannot go into itself or into a folder inside it.');
  const kids = LC.kidsOf(state, kind, c.id);
  if (byHand) {
    const clash = kids.filter((k) => { const t = LC.siblingNamed(state, kind, to, k.label, k.id); return t && t.id !== c.id; });
    if (clash.length) {
      throw _err(409, _placeName(state, kind, to) + ' has a folder called "' + LC.titleOf(clash[0].label) + '" already, and so has "'
        + LC.titleOf(c.label) + '" - rename one of them first. Nothing was changed.');
    }
    for (const k of kids) {
      const why = LC.tooLong(LC.deepestFor(state, kind, k.id, LC.pathFor(state, kind, k.label, to, k.id)));
      if (why) throw _err(400, why);
    }
  }
  // Its folders, one level up (or into `into`).
  for (const k0 of kids) {
    state = LC.read();
    const k = LC.byIdOf(state, kind, k0.id);
    if (!k) continue;
    let label = k.label;
    if (!byHand) {
      const taken = new Set(LC.kidsOf(state, kind, to).filter((x) => x.id !== c.id).map((x) => _lc(x.label)));
      for (let n = 2; taken.has(_lc(label)); n++) label = k.label.slice(0, 55) + ' (' + n + ')';
    }
    const next = LC.pathFor(state, kind, label, to, k.id);
    _moveDir(kind, k.folder || '', next);
    state = LC.read();
    const now = LC.byIdOf(state, kind, k.id);
    LC.setPath(state, kind, k.id, next);
    now.parent = to;
    now.label = label;
    LC.write(state);
    if (label !== k.label) _relabel(kind, k.id, label);
  }
  // Its own records - and their files.
  const target = to ? LC.byIdOf(LC.read(), kind, to) : null;
  const st = storeOf(kind);
  const list = st.read();
  const ids = new Set();
  for (const e of list) {
    if (!st.inKind(e) || String(e.categoryId || '') !== c.id) continue;
    e.categoryId = to;
    e.categoryLabel = target ? target.label : '';
    if (kind === 'references') e.handled = true;      // moved by hand is seen - not news in the tree
    ids.add(String(e.id));
  }
  if (ids.size) {
    st.write(list);
    _place(kind, st.read().filter((e) => e && ids.has(String(e.id))));
  }
  // And the folder.
  LC.remove(kind, c.id);
  SHELF.dropEmptyFolder(kind, c.folder);
  return { records: ids.size, folders: kids.length };
}

module.exports = { storeOf, recordsIn, rename, move, empty, KIND_WORD };
