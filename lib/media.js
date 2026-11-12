'use strict';

/* media.js - between a file in the library and the address that reaches it.

   The address mirrors the folder (lib/layout.js): /media/<kind>/... is MEDIA_DIR, /projects/... is
   PROJECTS_DIR, /cache/... is CACHE_DIR. The two folders the program itself ships - /presets/ and
   /poses/ - are in PUBLIC_DIR; its built-in sounds - /sfx/ - are vendor/sfx/ (phase V34.C, laid out by
   tools/fetch-sfx.js: part of the program, never of the library); its built-in patterns - /patterns/ - are
   vendor/patterns/ (phase V65, tools/fetch-patterns.js), the same. Scratch (TEMP_DIR) has no address: it is worked in on disk and never
   served. Nothing else is a file, so there is one place that says so instead of a list of roots in
   every route. */

const fs = require('fs');
const path = require('path');
const { ROOT_DIR, MEDIA_DIR, PROJECTS_DIR, CACHE_DIR, PUBLIC_DIR, APP_DIR } = require('./config');

// The built-in sound set (phase V34.1): its addresses never change between versions - a project keeps them.
const SFX_DIR = path.join(APP_DIR, 'vendor', 'sfx');
// The built-in patterns (phase V65): the same kind of thing - read only, addresses kept by projects.
const PATTERNS_DIR = path.join(APP_DIR, 'vendor', 'patterns');

const LIBRARY_TOPS = { media: MEDIA_DIR, projects: PROJECTS_DIR, cache: CACHE_DIR };

// Inside `root` or nothing: no climbing out with ..
function inside(root, rel) {
  const base = path.resolve(root);
  const abs = path.resolve(base, rel);
  return abs.startsWith(base + path.sep) ? abs : null;
}

// An address -> the file it names, or null. The query string is not part of the file.
function toDisk(url) {
  const clean = String(url || '').split(/[?#]/)[0];
  let m = clean.match(/^\/(media|projects|cache)\/(.+)$/);
  if (m) return inside(LIBRARY_TOPS[m[1]], m[2]);
  m = clean.match(/^\/(presets|poses)\/(.+)$/);
  if (m) return inside(path.join(PUBLIC_DIR, m[1]), m[2]);
  m = clean.match(/^\/sfx\/(.+)$/);
  if (m) return inside(SFX_DIR, m[1]);
  m = clean.match(/^\/patterns\/(.+)$/);
  if (m) return inside(PATTERNS_DIR, m[1]);
  return null;
}

// The same, for READING a file that may have moved since the address was stored (lib/moves.js):
// when nothing is at the address and the memory knows where it went, that file. Never use it to
// pick where to write - an old name may belong to a new folder by now.
function toDiskExisting(url) {
  const abs = toDisk(url);
  if (abs && fs.existsSync(abs)) return abs;
  const moved = require('./moves').resolve(url);
  if (moved !== String(url || '')) {
    const there = toDisk(moved);
    if (there && fs.existsSync(there)) return there;
  }
  return abs;
}

// An address inside one of the given folders -> the file, or null. For a route that may only
// touch some kinds - deleting, say, generated clips but never a character sheet.
function toDiskWithin(url, dirs) {
  const abs = toDisk(url);
  if (!abs) return null;
  return dirs.some((d) => abs.startsWith(path.resolve(d) + path.sep)) ? abs : null;
}

// A file under media/, projects/ or cache/ -> its address, or null for a file anywhere else.
function toUrl(abs) {
  const rel = path.relative(ROOT_DIR, path.resolve(abs));
  const parts = rel.split(path.sep);
  if (parts.length < 2 || !LIBRARY_TOPS[parts[0]]) return null;
  return '/' + parts.join('/');
}

module.exports = { toDisk, toDiskExisting, toDiskWithin, toUrl, SFX_DIR, PATTERNS_DIR };
