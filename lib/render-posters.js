'use strict';

// ════════════════════════════════════════════════════════════════════════════
// A RENDER'S POSTER AND LENGTH, MADE IN THE BACKGROUND (phase V23, the owner 2026-10-09).
//
// The Renders shelf (routes/library.js) used to call a render with no poster "unreadable" - and one of the owner's was
// a whole file that simply never got its poster. Now the shelf hands this every render it lists, and one at a time,
// behind the page:
//   - a render with no poster gets one (lib/video-thumb.js makeThumb); only a file ffmpeg CANNOT open is unreadable,
//     and that is remembered for the file as it is - its size and its time - so it is tried again only once it changes;
//   - its length is measured once (lib/media-probe.js) for the shelf's strips.
// A file written in the last half minute is left alone: a render being named and given its poster by the result window
// is still the export's.
//
// Kept in `cache/render-posters.json`: what is made again when missing.
// ════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const { CACHE_DIR, MEDIA } = require('./config');
const { writeFileAtomic } = require('./atomic-write');

const FILE = path.join(CACHE_DIR, 'render-posters.json');
const FRESH_MS = 30 * 1000;

let _db = null;
const _queue = [];
const _queued = new Set();
let _busy = false;

function _read() {
  if (_db) return _db;
  try { _db = JSON.parse(fs.readFileSync(FILE, 'utf8')) || {}; } catch (e) { _db = {}; }
  return _db;
}
function _save() {
  try { writeFileAtomic(FILE, JSON.stringify(_db || {}, null, 1)); } catch (e) { console.warn('[render-posters] not saved:', e.message); }
}

/** What is known of one render, as the file is now: { dur, failed } - or {} when it was never looked at, or changed. */
function info(rel, st) {
  const r = _read()[rel];
  if (!r || !st || r.size !== st.size || Math.round(r.mtime) !== Math.round(st.mtimeMs)) return {};
  return { dur: +r.dur || 0, failed: String(r.failed || '') };
}

/**
 * The shelf's renders, handed over as it lists them: { rel, abs, url, hasThumb, st }. Queued: one without a poster
 * that has not failed as it is, and one whose length is not known. Returns how many are waiting.
 */
function want(list) {
  const now = Date.now();
  for (const x of list || []) {
    if (!x || !x.st || _queued.has(x.rel)) continue;
    if (now - x.st.mtimeMs < FRESH_MS) continue;
    const k = info(x.rel, x.st);
    if (k.failed) continue;
    if (x.hasThumb && k.dur) continue;
    _queued.add(x.rel);
    _queue.push(x);
  }
  _next();
  return _queued.size;
}

const waiting = () => _queued.size;

async function _one(x) {
  const VT = require('./video-thumb');
  const probe = require('./media-probe').probe;
  let st;
  try { st = fs.statSync(x.abs); } catch (e) { return; }                 // gone meanwhile
  const rec = { size: st.size, mtime: Math.round(st.mtimeMs), dur: 0, failed: '' };
  if (!x.hasThumb) {
    try { await VT.makeThumb(x.url); }
    catch (e) { rec.failed = String(e.message || 'ffmpeg could not open it').slice(0, 200); }
  }
  if (!rec.failed) {
    try { rec.dur = Math.round(((await probe(x.abs)).duration || 0) * 100) / 100; } catch (e) { rec.dur = 0; }
  }
  _read()[x.rel] = rec;
  _save();
  if (rec.failed) console.warn('[render-posters] ' + x.rel + ' - ' + rec.failed);
}

async function _next() {
  if (_busy) return;
  const x = _queue.shift();
  if (!x) return;
  _busy = true;
  try { await _one(x); }
  catch (e) { console.warn('[render-posters]', x.rel, e.message); }
  finally {
    _queued.delete(x.rel);
    _busy = false;
    setImmediate(_next);
  }
}

// A render renamed or moved (lib/relocate.js) is a new key: the old one is simply never asked about again, and a
// render deleted leaves a line nobody reads. Trimmed to what is still in the renders folder when it grows.
function tidy(rels) {
  const db = _read();
  const keep = new Set(rels || []);
  let n = 0;
  for (const k of Object.keys(db)) if (!keep.has(k)) { delete db[k]; n++; }
  if (n) _save();
  return n;
}

module.exports = { info, want, waiting, tidy, FILE, RENDERS: MEDIA.renders };
