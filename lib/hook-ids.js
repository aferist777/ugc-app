'use strict';

// ════════════════════════════════════════════════════════════════════════════
// HOOK IDS — H01, H02, H03: a permanent number for every hook file.
//
// The naming pattern a finished creative goes to Meta under has a hook id in it
// (…_AUTH_H03_DrFauci_M), and until now that field was typed by hand from a title. It is
// filled from here instead: the hook lying at the very start of the Hooks lane names the
// render.
//
// A NUMBER IS GIVEN ONCE AND NEVER MOVES. It belongs to the FILE, not to a position in a
// list: delete the hook that had H07 and nothing shifts up, H07 simply never comes back
// and the next upload gets the next free number. That is the whole point - a creative
// rendered last month says H07, and H07 has to keep meaning the same piece of video.
//
// WHY ITS OWN FILE: the hooks' archive was once the browser's, pushed back over whatever the server wrote, and a
// number stored inside those records would have lived about two seconds. So the numbers live in data/hook-ids.json,
// which nothing but this file writes, keyed by the clip's path. (Its sweep of the whole archive went in phase V23:
// the page that called it is gone - a number is given when a hook is first asked about.)
// ════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./config');
const { writeFileAtomic } = require('./atomic-write');

const FILE = path.join(DATA_DIR, 'hook-ids.json');

// H01 through H99, then H100 and on - the pattern only asks for "Hxx" as a shape, and a
// hook library that outgrows two digits should not start reusing numbers to stay pretty.
const fmt = (n) => 'H' + String(n).padStart(2, '0');

// The key is the clip's web path, which is what a timeline clip carries and what the
// library record stores. Trimmed of a query string so the same file cannot be numbered
// twice under two spellings.
const keyOf = (p) => String(p || '').split('?')[0].trim();

function _load() {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    if (raw && typeof raw === 'object') {
      const byPath = (raw.byPath && typeof raw.byPath === 'object') ? raw.byPath : {};
      // `next` is trusted only as far as the numbers actually handed out: a file edited by
      // hand must never be able to make the registry give the same number twice.
      let high = 0;
      for (const v of Object.values(byPath)) { const n = parseInt(String(v).replace(/^H/i, ''), 10); if (n > high) high = n; }
      return { next: Math.max(Number(raw.next) || 1, high + 1), byPath };
    }
  } catch (e) { /* absent or unreadable: an empty registry is the honest answer */ }
  return { next: 1, byPath: {} };
}

function _save(reg) {
  writeFileAtomic(FILE, JSON.stringify(reg, null, 2));
}

/** The number this hook file already has, or null. */
function idFor(p) {
  const k = keyOf(p);
  return k ? (_load().byPath[k] || null) : null;
}

/** Every number given out so far: { "<path>": "H01" }. */
function map() { return _load().byPath; }

/**
 * Give a number to each of these files that has none, in the order handed in. Files that
 * already have one are left exactly as they are. Returns what was assigned, so a caller
 * can say so in the log.
 */
function assign(paths) {
  const reg = _load();
  const out = {};
  for (const p of (paths || [])) {
    const k = keyOf(p);
    if (!k || reg.byPath[k]) continue;
    reg.byPath[k] = fmt(reg.next++);
    out[k] = reg.byPath[k];
  }
  if (Object.keys(out).length) _save(reg);
  return out;
}

/**
 * THE SAME NUMBER FOR A SHORTER HOOK. A hook trimmed in the library is written to a new file,
 * and a number keyed by path would otherwise make it a new hook with a new number - while it is
 * the same hook, shortened, and a creative named H07 last month should still be findable by
 * H07. The new path gets the old path's number; the old path keeps it too, because a timeline
 * made before the trim still points at the original file and still has to resolve to H07.
 * Returns the number carried, or null when the original had none.
 */
function carry(fromPath, toPath) {
  const reg = _load();
  const from = keyOf(fromPath), to = keyOf(toPath);
  const id = from && reg.byPath[from];
  if (!id || !to) return null;
  if (reg.byPath[to] === id) return id;
  reg.byPath[to] = id;
  _save(reg);
  return id;
}

module.exports = { idFor, map, assign, carry, fmt, keyOf, FILE };
