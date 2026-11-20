'use strict';

// ════════════════════════════════════════════════════════════════════════════
// A FOLDER OF THE MEDIA TREE WITH EVERYTHING IN IT: renamed, moved into another folder of its kind, or emptied - its
// content one level up - and gone.
// The list is lib/library-cats.js; a file's place is lib/shelf-files.js; every move goes through lib/relocate.js (the
// files with their derivatives, every store and project rewritten, the old addresses remembered by lib/moves.js).
//
//   rename(kind, id, label)            its name and its folder on the disk; every folder under it follows
//   move(kind, id, parent)             into another folder of its kind ('' - the kind itself)
//   empty(kind, id, into, { byHand })  what is in it - its files and its folders - into `into` (its parent, when it is
//                                      deleted keeping what is in it; another folder, when a second required one is
//                                      folded into the first), and it goes
//
// THE DISK FIRST, THE LIST AFTER: a folder is renamed or moved on the disk in ONE relocate (one pair of folders, however
// much is under it), and only then does the list say so - a move refused by Windows (a file held by another program)
// leaves the list as it was. A folder with nothing in it yet has no folder on the disk: only the list changes.
//
// WHAT IS REFUSED, in words (409 unless said): a required category (lib/library-cats.js REQUIRED: it stays at the top,
// named as the code looks for it); a folder into itself or one under it; a name already in that place - moved there or
// lifted there by hand; a path too long for the disk (400). What the app
// does by itself (a second "Generated" folded into the first) never stops on a name: a folder of a taken name is given
// "Name (2)".
// ════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const LC = require('./library-cats');
const R = require('./relocate');
const SHELF = require('./shelf-files');
const { DATA_DIR } = require('./config');
const { writeFileAtomic } = require('./atomic-write');
const I18N = require('./i18n');

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
    const isUp = (e) => !!(e && e.source === 'upload');
    return { read: S.read, write: S.write, inKind: (e) => !!e && isUp(e) === (kind === 'uploads') };
  }
  throw _err(400, I18N.t('no folders in "{kind}"', { kind }));
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

// What a place is called, for a refusal: a folder's name, or the kind's - in the interface's language.
const KIND_WORD = { birols: 'B-rolls', uploads: 'Uploads', hooks: 'Hooks', images: 'IMAGES', sounds: 'My sounds', references: 'REFERENCES', music: 'Music' };
const _kindWord = (kind) => ({ birols: I18N.t('B-rolls'), uploads: I18N.t('Uploads'), hooks: I18N.t('Hooks'), images: I18N.t('IMAGES'),
  sounds: I18N.t('My sounds'), references: I18N.t('REFERENCES'), music: I18N.t('Music') })[kind] || kind;
const _placeName = (state, kind, id) => (id ? LC.shownName(state, kind, LC.byIdOf(state, kind, id) || {}) : _kindWord(kind));

// The one a folder must be before anything is done to it.
const REQUIRED_SAYS = {
  renamed: () => I18N.t('This folder is required - it cannot be renamed. Folders inside it can.'),
  moved: () => I18N.t('This folder is required - it cannot be moved. Folders inside it can.'),
  deleted: () => I18N.t('This folder is required - it cannot be deleted. Folders inside it can.'),
};
function _own(state, kind, id, verb) {
  const c = LC.byIdOf(state, kind, id);
  if (!c) throw _err(404, I18N.t('That folder is not there any more.'));
  if (LC.isLocked(kind, id, state)) throw _err(409, REQUIRED_SAYS[verb]());
  return c;
}

/** Its name, and its folder on the disk with everything under it. */
function rename(kind, id, label) {
  const name = String(label || '').trim().slice(0, 60);
  if (!name) throw _err(400, I18N.t('A folder needs a name.'));
  let state = LC.read();
  const c = _own(state, kind, id, 'renamed');
  state = LC.read();
  if (name === c.label) return c;
  const twin = LC.siblingNamed(state, kind, c.parent, name, c.id);
  if (twin) {
    throw _err(409, I18N.t('There is already a folder called "{name}" in {place}.',
      { name: LC.shownName(state, kind, twin), place: _placeName(state, kind, c.parent) }));
  }
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
  if (p && !LC.byIdOf(state, kind, p)) throw _err(404, I18N.t('The folder to put it in is not there any more.'));
  if (p && LC.isUnder(state, kind, p, c.id)) throw _err(409, I18N.t('A folder cannot go into itself or into a folder inside it.'));
  // Not into the references of Environments / Lookbooks (lib/library-cats.js closedWhy).
  const shut = LC.closedWhy(kind, p, state);
  if (shut) throw _err(409, shut);
  // A B-roll folder stays in its model's folder (lib/model-folders.js).
  if (kind === 'birols') {
    const why = require('./model-folders').moveWhy(state, c.id, p);
    if (why) throw _err(409, why);
  }
  const twin = LC.siblingNamed(state, kind, p, c.label, c.id);
  if (twin) {
    throw _err(409, I18N.t('There is already a folder called "{name}" in {place} - rename one of them first.',
      { name: LC.shownName(state, kind, twin), place: _placeName(state, kind, p) }));
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
 * folder off the disk. By hand a folder of a name `into` has already is refused before anything moves; by the app
 * it is given "Name (2)". -> { records, folders }
 */
function empty(kind, id, into, opts) {
  const byHand = !!(opts && opts.byHand);
  let state = LC.read();
  const c = _own(state, kind, id, 'deleted');
  state = LC.read();
  // "The kind itself" of a B-roll folder is its model's folder - B-rolls lie in nothing else.
  const to = String(into || '') || (kind === 'birols' ? require('./model-folders').rootOf(state, c.id) : '');
  if (to && !LC.byIdOf(state, kind, to)) throw _err(404, I18N.t('The folder to put it in is not there any more.'));
  if (to && LC.isUnder(state, kind, to, c.id)) throw _err(409, I18N.t('A folder cannot go into itself or into a folder inside it.'));
  const kids = LC.kidsOf(state, kind, c.id);
  if (byHand) {
    const clash = kids.filter((k) => { const t = LC.siblingNamed(state, kind, to, k.label, k.id); return t && t.id !== c.id; });
    if (clash.length) {
      throw _err(409, I18N.t('{place} has a folder called "{name}" already, and so has "{folder}" - rename one of them first. Nothing was changed.',
        { place: _placeName(state, kind, to), name: LC.titleOf(clash[0].label), folder: LC.titleOf(c.label) }));
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

module.exports = { storeOf, rename, move, empty, KIND_WORD };
