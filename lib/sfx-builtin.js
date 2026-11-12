'use strict';

// ════════════════════════════════════════════════════════════════════════════
// THE BUILT-IN SOUNDS (phase V34.1; the set is V34.B's - tools/build-sfx.js, installed by tools/fetch-sfx.js) - SFX ->
// Built-in: part of the PROGRAM, in vendor/sfx/, served at /sfx/ (server.js, lib/media.js toDisk). Read only: never
// deleted, renamed, moved or exported; a new version only adds. Until the set is installed, Built-in is empty.
//
//   vendor/sfx/sfx.json  { format, version, built, categories: [{ id, name, count }], sources: [...],
//                          sounds: [{ id, name, category, file, tags, duration, channels, peaks (64 points, 0..100),
//                                     author, authorUrl, license, licenseUrl, source, url, via, original }] }
//
//   read() -> { version, categories: [{ id, label, count }], sounds: [{ id, path, name, category, categoryLabel, tags,
//               dur, wave, author, authorUrl, license, licenseUrl, source, url }] }      read again when the file changes
// ════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const { SFX_DIR } = require('./media');

const FILE = path.join(SFX_DIR, 'sfx.json');
let _cache = null;            // { mtime, data }

const EMPTY = { version: '', categories: [], sounds: [] };

function read() {
  let st;
  try { st = fs.statSync(FILE); } catch (e) { _cache = null; return EMPTY; }
  if (_cache && _cache.mtime === st.mtimeMs) return _cache.data;
  let raw;
  try { raw = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) {
    console.warn('[sfx] vendor/sfx/sfx.json could not be read:', e.message);
    return EMPTY;
  }
  const cats = (Array.isArray(raw.categories) ? raw.categories : []).filter(c => c && c.id)
    .map(c => ({ id: String(c.id), label: String(c.name || c.id) }));
  const labelOf = new Map(cats.map(c => [c.id, c.label]));
  const sounds = (Array.isArray(raw.sounds) ? raw.sounds : []).filter(s => s && s.file).map(s => {
    const file = String(s.file);
    return {
      id: String(s.id || file), path: '/sfx/' + file, name: String(s.name || path.posix.basename(file).replace(/\.[^.]+$/, '')),
      category: String(s.category || ''), categoryLabel: labelOf.get(String(s.category || '')) || String(s.category || ''),
      tags: (Array.isArray(s.tags) ? s.tags : []).map(String),
      dur: +s.duration || 0,
      wave: (Array.isArray(s.peaks) ? s.peaks : []).map(v => Math.round(+v)),
      author: String(s.author || ''), authorUrl: String(s.authorUrl || ''),
      license: String(s.license || ''), licenseUrl: String(s.licenseUrl || ''),
      source: String(s.source || ''), url: String(s.url || ''),
    };
  });
  for (const c of cats) c.count = sounds.filter(s => s.category === c.id).length;
  const data = { version: String(raw.version || ''), categories: cats, sounds };
  _cache = { mtime: st.mtimeMs, data };
  return data;
}

const byPath = (p) => read().sounds.find(s => s.path === String(p || '').split('?')[0]) || null;

module.exports = { FILE, read, byPath };
