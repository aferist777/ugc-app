'use strict';

/* moves.js - the memory of where a file went.

   A file in the library moves when what it belongs to changes: a project or a category is
   renamed, a clip gets another category or kind, a category is deleted (its files go to nocat), a
   project is deleted (what other projects still use goes to media/work). The move rewrites every
   store on the spot (lib/relocate.js), but a page opened before it still holds the old address -
   in an <img>, and in the record it is about to save. So the old address is remembered, in
   data/moves.json:
     - a request for a file that is not there follows the memory with a redirect (server.js);
     - the body of every POST / PUT / PATCH to /api is rewritten through it before a route reads
       it, so a stale save puts the new address into the store instead of the old one back;
     - a reader that opens a file by its address follows it too (lib/media.js toDiskExisting).

   An entry is a file ('/media/birols/Cats/x.mp4' -> '/media/birols/Dogs/x.mp4') or a folder, both
   sides ending in '/' ('/projects/Old/' -> '/projects/New/'). Chains are followed and folded as they
   are recorded. When a new folder is made under a name that used to redirect, the entries under
   that name are forgotten - or the new folder's own files would be sent away. An entry is kept for 30 days. */

const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./config');
const { writeFileAtomic } = require('./atomic-write');

const FILE = path.join(DATA_DIR, 'moves.json');
const HOPS = 10;
// A move is remembered for 30 days: every store was rewritten at the move, and a page
// opened before it is long closed. Older entries are not followed, and go from the file at the start (prune).
const KEEP_MS = 30 * 24 * 3600 * 1000;
const _old = (e, now) => { const t = Date.parse(e.at); return t > 0 && t < now - KEEP_MS; };

let _cache = null;          // { mtimeMs, entries: [{from, to, at}], old: how many were too old }

function _load() {
  let mtimeMs = 0;
  try { mtimeMs = fs.statSync(FILE).mtimeMs; } catch (e) { /* no moves yet */ }
  if (_cache && _cache.mtimeMs === mtimeMs) return _cache;
  let entries = [];
  let old = 0;
  if (mtimeMs) {
    try {
      const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
      const now = Date.now();
      entries = (Array.isArray(raw && raw.entries) ? raw.entries : [])
        .filter((e) => e && typeof e.from === 'string' && typeof e.to === 'string' && e.from !== e.to);
      const kept = entries.filter((e) => !_old(e, now));
      old = entries.length - kept.length;
      entries = kept;
    } catch (e) { entries = []; }
  }
  _cache = { mtimeMs, entries, old };
  return _cache;
}

/** At the start: the entries older than 30 days go from the file. How many went. */
function prune() {
  const c = _load();
  if (c.old) _save(c.entries);
  return c.old;
}

function _save(entries) {
  writeFileAtomic(FILE, JSON.stringify({ entries }, null, 2));
  _cache = null;
}

const _isFolder = (s) => s.endsWith('/');
const _isLibraryPath = (s) => s.startsWith('/media/') || s.startsWith('/projects/');

// One step: the entry that applies to `clean`, or null. A file entry beats a folder entry; of
// folder entries, the longest wins.
function _step(clean, entries) {
  let best = null;
  for (const e of entries) {
    if (_isFolder(e.from)) {
      if (clean.startsWith(e.from) && (!best || (_isFolder(best.from) && e.from.length > best.from.length))) best = e;
    } else if (clean === e.from) {
      return e;
    }
  }
  return best;
}

// An address -> where it lives now. The query string rides along. Unknown addresses come back as
// they were.
function resolve(url) {
  const s = String(url || '');
  const cut = s.search(/[?#]/);
  let clean = cut >= 0 ? s.slice(0, cut) : s;
  const tail = cut >= 0 ? s.slice(cut) : '';
  if (!_isLibraryPath(clean)) return s;
  const { entries } = _load();
  if (!entries.length) return s;
  for (let i = 0; i < HOPS; i++) {
    const e = _step(clean, entries);
    if (!e) break;
    const next = _isFolder(e.from) ? e.to + clean.slice(e.from.length) : e.to;
    if (next === clean) break;
    clean = next;
  }
  return clean + tail;
}

// Remember moves: [{from, to}]. A folder move names both sides with a trailing '/'.
function record(pairs) {
  const add = (pairs || []).filter((p) => p && p.from && p.to && p.from !== p.to);
  if (!add.length) return;
  const now = new Date().toISOString();
  let entries = _load().entries.slice();
  for (const p of add) {
    // Fold: what used to lead to the old place now leads to the new one.
    entries = entries.map((e) => {
      if (_isFolder(p.from) && e.to.startsWith(p.from)) return { ...e, to: p.to + e.to.slice(p.from.length) };
      if (!_isFolder(p.from) && e.to === p.from) return { ...e, to: p.to };
      return e;
    }).filter((e) => e.from !== e.to);
    // The same "from" recorded again replaces the old entry.
    entries = entries.filter((e) => e.from !== p.from);
    entries.push({ from: p.from, to: p.to, at: now });
  }
  _save(entries);
}

// A folder is being made at `prefix` (ending in '/'): nothing under it redirects any more.
function forget(prefix) {
  const p = String(prefix || '');
  if (!p) return;
  const { entries } = _load();
  const keep = entries.filter((e) => !e.from.startsWith(p));
  if (keep.length !== entries.length) _save(keep);
}

// Every library address inside a parsed value - values and object keys - resolved.
function rewriteValue(v) {
  if (!_load().entries.length) return v;
  const walk = (x) => {
    if (typeof x === 'string') return _isLibraryPath(x) ? resolve(x) : x;
    if (Array.isArray(x)) return x.map(walk);
    if (x && typeof x === 'object') {
      const out = {};
      for (const [k, y] of Object.entries(x)) out[_isLibraryPath(k) ? resolve(k) : k] = walk(y);
      return out;
    }
    return x;
  };
  return walk(v);
}

// Express: rewrite the JSON body of a write before any route reads it.
function rewriteBodies(req, _res, next) {
  if ((req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH')
      && req.body && typeof req.body === 'object' && _load().entries.length) {
    req.body = rewriteValue(req.body);
  }
  next();
}

// Express, after the static mounts: a file that was not found but has moved is redirected.
function redirectMissing(req, res, next) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  let url;
  try { url = decodeURIComponent(req.baseUrl + req.path); } catch (e) { return next(); }
  const to = resolve(url);
  if (to === url) return next();
  const q = req.originalUrl.indexOf('?');
  res.redirect(307, encodeURI(to) + (q >= 0 ? req.originalUrl.slice(q) : ''));
}

module.exports = { resolve, record, forget, prune, rewriteValue, rewriteBodies, redirectMissing, FILE };
