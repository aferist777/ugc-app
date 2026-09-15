'use strict';

/* media.js - between a file in the library and the address that reaches it.

   The address mirrors the folder (lib/layout.js): /media/<kind>/... is MEDIA_DIR, /cache/... is
   CACHE_DIR. The two folders the program itself ships - /presets/ and /poses/ - are in
   PUBLIC_DIR, and /temp_public/ and /temp_files/ are scratch. Nothing else is a file, so there is
   one place that says so instead of a list of roots in every route. */

const path = require('path');
const { ROOT_DIR, MEDIA_DIR, CACHE_DIR, PUBLIC_DIR, TEMP_DIR, TEMP_PUBLIC_DIR } = require('./config');

// Inside `root` or nothing: no climbing out with ..
function inside(root, rel) {
  const base = path.resolve(root);
  const abs = path.resolve(base, rel);
  return abs.startsWith(base + path.sep) ? abs : null;
}

// An address -> the file it names, or null. The query string is not part of the file.
function toDisk(url) {
  const clean = String(url || '').split(/[?#]/)[0];
  let m = clean.match(/^\/(media|cache)\/(.+)$/);
  if (m) return inside(m[1] === 'media' ? MEDIA_DIR : CACHE_DIR, m[2]);
  m = clean.match(/^\/(presets|poses)\/(.+)$/);
  if (m) return inside(path.join(PUBLIC_DIR, m[1]), m[2]);
  m = clean.match(/^\/(temp_public|temp_files)\/(.+)$/);
  if (m) return inside(m[1] === 'temp_public' ? TEMP_PUBLIC_DIR : TEMP_DIR, m[2]);
  return null;
}

// An address inside one of the given folders -> the file, or null. For a route that may only
// touch some kinds - deleting, say, generated clips but never a character sheet.
function toDiskWithin(url, dirs) {
  const abs = toDisk(url);
  if (!abs) return null;
  return dirs.some((d) => abs.startsWith(path.resolve(d) + path.sep)) ? abs : null;
}

// A file under media/ or cache/ -> its address, or null for a file anywhere else.
function toUrl(abs) {
  const rel = path.relative(ROOT_DIR, path.resolve(abs));
  const parts = rel.split(path.sep);
  if (parts.length < 2 || (parts[0] !== 'media' && parts[0] !== 'cache')) return null;
  return '/' + parts.join('/');
}

module.exports = { toDisk, toDiskWithin, toUrl };
