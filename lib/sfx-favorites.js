'use strict';

// ════════════════════════════════════════════════════════════════════════════
// FAVOURITE BUILT-IN SOUNDS (phase V34.C; the owner 2026-10-22, (з6): "для избранного отдельная категория выше built-in")
// - SFX -> Favorites holds the ★ of every sound: one of the person's own (SFX -> My sounds) keeps its star on its own
// record (`favorite` in data/sounds.json, the Library's star too); a BUILT-IN one has no record in the library, so its
// star is kept here, by its address - a list of links, never a file (the set is the program's).
//
//   data/sfx-favorites.json   [{ path: '/sfx/<category>/<id>.ogg', at }]     in Export's media group; merged by `path`
//
//   list() -> [{ path, at }]     has(path)     set(path, on) -> on
// ════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const { writeFileAtomic } = require('./atomic-write');
const { DATA_DIR } = require('./config');

const FILE = path.join(DATA_DIR, 'sfx-favorites.json');

function list() {
  try { const l = JSON.parse(fs.readFileSync(FILE, 'utf8')); return Array.isArray(l) ? l.filter(x => x && x.path) : []; }
  catch (e) { return []; }
}
const _key = (p) => String(p || '').split('?')[0];
const has = (p) => list().some(x => x.path === _key(p));

function set(p, on) {
  const k = _key(p);
  if (!/^\/sfx\//.test(k)) throw Object.assign(new Error('only a built-in sound is starred here'), { status: 400 });
  const l = list().filter(x => x.path !== k);
  if (on) l.unshift({ path: k, at: new Date().toISOString() });
  fs.mkdirSync(DATA_DIR, { recursive: true });
  writeFileAtomic(FILE, JSON.stringify(l, null, 2));
  return !!on;
}

module.exports = { FILE, list, has, set };
