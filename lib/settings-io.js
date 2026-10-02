'use strict';

// ════════════════════════════════════════════════════════════════════════════
// ONE DOOR TO data/settings.json.
//
// Fourteen files read this file today, each with its own three lines of
// readFileSync-and-hope. That is fine while everything only READS - they all get
// the same answer - and stops being fine the moment two of them write, because
// read-modify-write from two places loses whichever finished first.
//
// This is not a refactor of those fourteen. They keep working exactly as they do;
// nothing about them changes. It is the door NEW code uses, so the count stops
// growing and the writing half exists in one place from the start.
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

// Shallow merge, so a caller can write one field without holding the rest. Nested
// objects are REPLACED rather than merged - a ladder is a whole list, and merging
// one into its predecessor would leave rungs nobody asked for.
function patchSettings(patch) {
  const next = { ...getSettings(), ...(patch || {}) };
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = FILE + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8');
  fs.renameSync(tmp, FILE);
  _cache = next;
  try { _mtime = fs.statSync(FILE).mtimeMs; } catch (e) { _mtime = 0; }
  return next;
}

module.exports = { getSettings, patchSettings, FILE };
