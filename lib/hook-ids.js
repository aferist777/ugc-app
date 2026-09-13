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
// WHY ITS OWN FILE, and this matters. data/hooks-archive.json is owned by the BROWSER:
// the Hooks page keeps the archive in localStorage and hooks-server-sync.js pushes the
// whole thing here every couple of seconds, overwriting whatever the server wrote. A
// number stored inside those records would live about two seconds. So the numbers live in
// data/hook-ids.json, which nothing but this file writes, keyed by the clip's path.
// ════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const { DATA_DIR, HOOKS_DIR } = require('./config');

const FILE = path.join(DATA_DIR, 'hook-ids.json');
const ARCHIVE = path.join(DATA_DIR, 'hooks-archive.json');
const FILM = /\.(mp4|webm|mov|m4v)$/i;

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
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(reg, null, 2), 'utf8');
  fs.renameSync(tmp, FILE);
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
 * Every hook there is, numbered - oldest first, so the numbers run in the order the hooks
 * were actually made. Called at boot and after every push from the browser; a hook that
 * already has a number costs one lookup.
 *
 * TWO PLACES, because the archive is not the whole truth. It is the browser's list, and a
 * hook can be on a timeline while being absent from it - deleted from the shelf, or filed
 * by a browser whose copy never reached this server. Found one like that on a real project:
 * a hook pinned to the start of the cut, on disk, with no record. So the hooks DIRECTORY is
 * read as well, after the archive - a film sitting in hooks/ is a hook by where it lives.
 * Hooks kept elsewhere (an upload that was filed as one) are known only through the archive.
 */
function sweep() {
  const want = [];

  let list = [];
  try { const raw = JSON.parse(fs.readFileSync(ARCHIVE, 'utf8')); list = Array.isArray(raw) ? raw : []; }
  catch (e) { list = []; }
  const dated = list.filter(h => h && h.videoPath)
    .map((h, i) => ({ p: h.videoPath, at: Date.parse(h.date || '') || 0, i }))
    // Oldest first; anything without a readable date keeps its place in the list, behind
    // the dated ones, rather than jumping to the front as "1970".
    .sort((a, b) => (a.at && b.at) ? (a.at - b.at) : (a.at ? -1 : b.at ? 1 : a.i - b.i));
  for (const x of dated) want.push(x.p);

  try {
    const files = fs.readdirSync(HOOKS_DIR)
      .filter(f => FILM.test(f))
      .map(f => { let at = 0; try { at = fs.statSync(path.join(HOOKS_DIR, f)).mtimeMs; } catch (e) {} return { p: '/hooks/' + f, at }; })
      .sort((a, b) => a.at - b.at);
    for (const x of files) want.push(x.p);
  } catch (e) { /* no hooks directory yet: the archive is all there is */ }

  return assign(want);
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

module.exports = { idFor, map, assign, carry, sweep, fmt, keyOf, FILE };
