'use strict';

// ════════════════════════════════════════════════════════════════════════════
// ONE FOLDER FOLDED INTO ANOTHER of its kind (lib/required-cats.js: a second required folder of the same name folded into
// the first).
//
//   merge(kind, from, into)    the records of category `from` into category `into` with their files; `from` goes
//
// What is in it goes with it as lib/folders.js moves it: its own folders too ("Name (2)" when the place has one of that
// name - the app never stops on a name).
// ════════════════════════════════════════════════════════════════════════════

const FOLDERS = require('./folders');

// Into the category `into`: its folders, its records with their files, then the old chip and its folder (lib/folders.js).
function merge(kind, from, into) {
  return FOLDERS.empty(kind, from.id, into.id, { byHand: false }).records;
}

module.exports = { merge };
