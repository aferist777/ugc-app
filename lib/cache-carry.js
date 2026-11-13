'use strict';

/* cache-carry.js - what is cached for a file follows it when it moves.

   The preview's small copy of a film (lib/preview-proxy.js) and the sizes /api/thumb serves of a picture (lib/thumbs.js)
   are keyed by the file's full path and modified time. A file that moves keeps its time but not its path, so both would be
   made again: a folder of 200 clips moved into another would mean 200 films transcoded in the background and every card cut
   again when first seen. lib/relocate.js calls carry() after its moves: each entry is renamed to the key the new path
   gives, by the modules' own key functions (cachePathAt, thumbPathAt). One that cannot be renamed is simply made again
   when it is next needed - nothing here ever fails a move.

     carry(pairs)   pairs [{ from, to }] as lib/relocate.js moved them: a file, or a folder (both ending in '/') - every
                    file now under its new place counts, found where it was by the same relative path.
                    -> { proxies, thumbs } renamed */

const fs = require('fs');
const path = require('path');
const { toDisk } = require('./media');

const FILM = /\.(mp4|mov|webm|m4v|mkv)$/i;
const STILL = /\.(jpe?g|png|webp|gif)$/i;

function _walk(dir, rel, out) {
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
  for (const d of ents) {
    const r = rel ? rel + path.sep + d.name : d.name;
    if (d.isDirectory()) _walk(path.join(dir, d.name), r, out);
    else if (d.isFile() && (FILM.test(d.name) || STILL.test(d.name))) out.push(r);
  }
}

function carry(pairs) {
  const moved = [];             // [old absolute path, new absolute path]
  for (const p of pairs || []) {
    if (!p || !p.from || !p.to) continue;
    if (p.from.endsWith('/')) {
      const a = toDisk(p.from + '.'), b = toDisk(p.to + '.');
      if (!a || !b) continue;
      const rels = [];
      _walk(b, '', rels);
      for (const r of rels) moved.push([path.join(a, r), path.join(b, r)]);
    } else if (FILM.test(p.to) || STILL.test(p.to)) {
      const a = toDisk(p.from), b = toDisk(p.to);
      if (a && b) moved.push([a, b]);
    }
  }
  const out = { proxies: 0, thumbs: 0 };
  if (!moved.length) return out;
  const PP = require('./preview-proxy');
  const TH = require('./thumbs');
  const rename = (from, to, kind) => {
    try {
      if (!fs.existsSync(from) || fs.existsSync(to)) return;
      fs.renameSync(from, to);
      out[kind]++;
    } catch (e) { /* made again when it is next needed */ }
  };
  const variants = Object.keys(TH.VARIANTS || {});
  for (const [a, b] of moved) {
    let st;
    try { st = fs.statSync(b); } catch (e) { continue; }
    if (FILM.test(b)) {
      for (const h of PP.HEIGHTS) for (const rev of [false, true]) rename(PP.cachePathAt(a, st.mtimeMs, h, rev), PP.cachePathAt(b, st.mtimeMs, h, rev), 'proxies');
    }
    for (const v of variants) for (const ext of ['.jpg', '.webp']) rename(TH.thumbPathAt(a, st.mtimeMs, v, ext), TH.thumbPathAt(b, st.mtimeMs, v, ext), 'thumbs');
  }
  return out;
}

module.exports = { carry };
