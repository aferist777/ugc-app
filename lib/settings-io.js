'use strict';

// ════════════════════════════════════════════════════════════════════════════
// ONE DOOR TO data/settings.json.
//
// Some files read this file on their own, each with its own few lines of
// readFileSync (lib/helpers.js and routes/settings.js write it too). That is fine
// while everything only READS - they all get the same answer - and stops being fine
// the moment two of them write, because read-modify-write from two places loses
// whichever finished first.
//
// This is the door NEW code uses, so the count stops growing and
// the writing half exists in one place.
//
// Two things worth knowing about the file:
//
//   It changes at runtime. Keys are pasted on the Admin page while the server
//   runs, so a value cached at boot is a value that goes stale in front of you.
//   Cached by mtime instead: re-read when the file moved, reused when it did not.
//
//   It holds the API keys. A truncated write is a lost key, so writes go to a
//   temp file and are renamed over the original - rename being the one filesystem
//   operation that cannot leave half a file behind.
// ════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');

const FILE = path.join(require('./config').DATA_DIR, 'settings.json');

let _cache = null;
let _mtime = 0;

function getSettings() {
  try {
    const st = fs.statSync(FILE);
    if (_cache && st.mtimeMs === _mtime) return _cache;
    _cache = JSON.parse(fs.readFileSync(FILE, 'utf8')) || {};
    _mtime = st.mtimeMs;
    return _cache;
  } catch (e) {
    // A missing or unreadable settings file is an empty one: every caller already
    // treats an absent key as "not configured", and throwing here would take the
    // whole page down over a file that is legitimately absent on a fresh install.
    return _cache || {};
  }
}

// The writing half: read fresh off the disk, change, write atomically - in one tick,
// so a save from the Keys tab cannot land between the read and the write. `fn` gets the settings and changes them in
// place; it must be synchronous.
function updateSettings(fn) {
  let cur = {};
  try { cur = JSON.parse(fs.readFileSync(FILE, 'utf8')) || {}; } catch (e) { cur = {}; }
  fn(cur);
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  require('./atomic-write').writeFileAtomic(FILE, JSON.stringify(cur, null, 2));
  _cache = null;
  return cur;
}

module.exports = { getSettings, updateSettings, FILE };
