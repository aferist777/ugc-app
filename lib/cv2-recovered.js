'use strict';

// WHAT CAME BACK WHILE NOBODY WAS LOOKING.
//
// A generation is submitted by the server but collected by the BROWSER: _poll asks every
// second and a half until the picture lands. Leave the page and that stops - the aggregator
// finishes, and the result has nobody to hand it to.
//
// lib/pending-tasks.js is the net underneath: every submit is filed with a destination tag,
// and resolveAll() later downloads whatever finished. What it could not do is tell the page,
// so a recovered portrait became a file on disk that no screen ever mentioned.
//
// This is the short list between those two: things that were rescued and have not yet been
// put anywhere a person can see. On a file rather than in memory, because the whole point is
// surviving the moment nobody was watching - and a restart is exactly such a moment.
//
// A sheet is not on this list. It is written straight onto the character record by
// routes/char-store, so by the time anyone asks it is already where it belongs; the entry
// exists only so the log can say so and offer to open the character.

const fs = require('fs');
const { writeFileAtomic } = require('./atomic-write');
const path = require('path');
const { DATA_DIR } = require('./config');

const FILE = path.join(DATA_DIR, 'cv2-recovered.json');
const MAX = 40;

// The tags routes/character-v2 and routes/char-store file their submits under. Anything else
// belongs to another page and is none of this one's business.
const MINE = {
  'cv2-create':    { kind: 'portrait', label: 'a portrait built from the parameters' },
  'cv2-reference': { kind: 'portrait', label: 'a portrait built from a reference' },
  'char-sheet':    { kind: 'sheet',    label: 'a 4K character sheet' },
};

function read() {
  try { const j = JSON.parse(fs.readFileSync(FILE, 'utf8')); return Array.isArray(j) ? j : []; }
  catch (e) { return []; }
}

function write(list) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    writeFileAtomic(FILE, JSON.stringify(list.slice(-MAX), null, 2));
  } catch (e) {
    console.warn('[cv2-recovered] write failed:', e.message);
  }
}

// Takes resolveAll()'s output whole and keeps only what this page can place. Returns the
// entries it added, so a caller can say "two finished while you were away" without re-reading.
function note(items, atIso) {
  const list = read();
  const added = [];
  for (const it of (Array.isArray(items) ? items : [])) {
    const spec = MINE[it && it.type];
    if (!spec || !it.imagePath) continue;
    // Idempotent on the path: recovery runs on every page load, and the same file arriving
    // twice should not become two cards offering the same picture. Checked against what is
    // already stored AND what this batch has added - resolveAll can hand back the same file
    // twice in one call, and a check against the file alone lets that pair through.
    if (list.some(x => x.imagePath === it.imagePath)) continue;
    if (added.some(x => x.imagePath === it.imagePath)) continue;
    const entry = {
      id: 'rc' + (list.length + added.length + 1) + '-' + String(it.imagePath).split(/[\\/]/).pop(),
      kind: spec.kind,
      label: spec.label,
      type: it.type,
      imagePath: it.imagePath,
      charId: (it.meta && it.meta.charId) || '',
      at: atIso || '',
    };
    added.push(entry);
  }
  if (added.length) write(list.concat(added));
  return added;
}

function list() { return read(); }

// Removed once it has been placed - or dismissed, which is the same thing from here: this
// list is about what is still owed to the screen, not a history. The trace is the history.
function drop(id) {
  const before = read();
  const after = before.filter(x => x.id !== id);
  if (after.length !== before.length) write(after);
  return before.length - after.length;
}

function clear() { write([]); }

module.exports = { note, list, drop, clear, MINE, FILE };
