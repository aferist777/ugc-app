'use strict';

// WHAT IS KNOWN ABOUT A PICTURE ON A FLAT SHELF - a lookbook, an environment.
//
// Those two shelves are directories, not records (routes/library.js, FILE_SHELVES): the file IS
// the entry, and there is nowhere on it to write down what the agent said when it made it. So
// what is known lives beside the shelf, in a store keyed by the picture's address:
//
//   data/scen3-lookbook-meta.json   { "<path>": { gender, description, prompt, from, at } }
//   data/scen3-env-meta.json        { "<path>": { description, prompt, from, at } }
//   data/props-meta.json            { "<path>": { name, words, description, by, at } }   (phase V26.6, IMAGES -> Props:
//                                   the product's name, the person's own words as typed, the agent's description - lib/props.js)
//
// Keyed by address, so a move rewrites the keys along with every other store (lib/relocate.js), and a picture deleted
// off its shelf takes its entry with it (drop) instead of leaving an orphan behind. A picture
// made before any of this has no entry, and every reader treats that as "nothing known".

const fs = require('fs');
const path = require('path');
const { writeFileAtomic } = require('./atomic-write');
const { DATA_DIR } = require('./config');

const FILES = {
  lookbooks: path.join(DATA_DIR, 'scen3-lookbook-meta.json'),
  environments: path.join(DATA_DIR, 'scen3-env-meta.json'),
  props: path.join(DATA_DIR, 'props-meta.json'),
};

function _file(kind) {
  const f = FILES[kind];
  if (!f) throw new Error('no meta store for "' + kind + '"');
  return f;
}

function read(kind) {
  try {
    const d = JSON.parse(fs.readFileSync(_file(kind), 'utf8'));
    return (d && typeof d === 'object' && !Array.isArray(d)) ? d : {};
  } catch (e) {
    return {};
  }
}

function write(kind, m) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  writeFileAtomic(_file(kind), JSON.stringify(m, null, 2));
}

/** Forget one picture. Answers whether there was anything to forget. */
function drop(kind, url) {
  if (!FILES[kind]) return false;
  const m = read(kind);
  if (!Object.prototype.hasOwnProperty.call(m, url)) return false;
  delete m[url];
  write(kind, m);
  return true;
}

// (phase V23) An environment's `geometry` was written once (phase W3a) and never read by anything: it is dropped from
// the store the first time the app starts with this, and nothing writes it again.
(function _dropGeometry() {
  try {
    const m = read('environments');
    let n = 0;
    for (const k of Object.keys(m)) {
      if (m[k] && typeof m[k] === 'object' && Object.prototype.hasOwnProperty.call(m[k], 'geometry')) { delete m[k].geometry; n++; }
    }
    if (n) { write('environments', m); console.log('[shelf-meta] an unused field dropped from ' + n + ' environment(s)'); }
  } catch (e) { /* the store as it is */ }
})();

module.exports = { FILES, read, write, drop };
