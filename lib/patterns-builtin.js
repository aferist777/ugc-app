'use strict';

// ════════════════════════════════════════════════════════════════════════════
// THE BUILT-IN PATTERNS (phase V65; the set is tools/build-patterns.js's, installed by tools/fetch-patterns.js) - IMAGES ->
// Patterns: part of the PROGRAM, in vendor/patterns/, served at /patterns/ (server.js, lib/media.js toDisk). Read only:
// never deleted, renamed, moved or copied into a library; a new version only adds. Until the set is installed, Patterns
// is empty. Each file is a seamless tile, white on transparent, laid over video on the timeline.
//
//   vendor/patterns/patterns.json  { format, version, built, patterns: [{ id, name, file, thumb, size, author, license,
//                                    licenseUrl, source, url, original, changed }] }
//
//   read() -> { version, patterns: [{ id, name, path, thumb, size, author, license, licenseUrl, source, url, original,
//               changed }] }      read again when the file changes
// ════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const { PATTERNS_DIR } = require('./media');

const FILE = path.join(PATTERNS_DIR, 'patterns.json');
let _cache = null;            // { mtime, data }

const EMPTY = { version: '', patterns: [] };
const PREFIX = '/patterns/';

function read() {
  let st;
  try { st = fs.statSync(FILE); } catch (e) { _cache = null; return EMPTY; }
  if (_cache && _cache.mtime === st.mtimeMs) return _cache.data;
  let raw;
  try { raw = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) {
    console.warn('[patterns] vendor/patterns/patterns.json could not be read:', e.message);
    return EMPTY;
  }
  const list = (Array.isArray(raw.patterns) ? raw.patterns : []).filter(p => p && p.id && p.file).map(p => ({
    id: String(p.id), name: String(p.name || p.id),
    path: PREFIX + String(p.file).replace(/\\/g, '/').replace(/^\/+/, ''),
    thumb: p.thumb ? PREFIX + String(p.thumb).replace(/\\/g, '/').replace(/^\/+/, '') : null,
    size: +p.size || 2160,
    author: String(p.author || ''), license: String(p.license || ''), licenseUrl: String(p.licenseUrl || ''),
    source: String(p.source || ''), url: String(p.url || ''), original: String(p.original || ''), changed: String(p.changed || ''),
  }));
  const data = { version: String(raw.version || ''), patterns: list };
  _cache = { mtime: st.mtimeMs, data };
  return data;
}

// Whether an address is one of the set's (a clip's `src`, a tile's `media`).
const isPattern = (p) => String(p || '').split('?')[0].startsWith(PREFIX);
const byPath = (p) => read().patterns.find(x => x.path === String(p || '').split('?')[0]) || null;

module.exports = { FILE, PREFIX, read, isPattern, byPath };
