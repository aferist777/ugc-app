'use strict';

/* stock.js - WHERE THE B-ROLL ENGINE'S VIDEOS AND PICTURES COME FROM (phase V62; docs/local-app/plan/ "Фаза V62"). ONE module, so
   the engine (lib/broll.js) never knows which site answered:

     ready()                      '' when there is a stock to ask, else why not - in words
     search({ query, kind, n })   -> [{ id, site, kind: 'video'|'image', w, h, dur, thumb, preview, page, author, tags }]
                                  `kind` 'video' or 'image'; vertical and horizontal both (the owner's (во7)); `n` at most
     fetchFile(item)              -> { file, ext } - the item downloaded whole into scratch (TEMP_DIR); the engine COPIES it into
                                  the library (CLAUDE.md: scratch and the library can be on different drives)

   THE STOCK IS PIXABAY (V62's block 3, lib/pixabay.js) - the owner's free key on Admin -> API keys. Without a key, on a stand
   with the fake aggregator on (lib/fake-agg.js - a stand's own library, never the app), THE FAKE STOCK answers instead: any
   query, with items of its own whose files are made here - a few seconds of ffmpeg's test pattern, a coloured picture with the
   query on it - vertical and horizontal, so the engine is checked end to end without a site. A key set wins over the fake. */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const FAKE = require('./fake-agg');
const PIXABAY = require('./pixabay');
const { TEMP_DIR } = require('./config');

// Which stock answers: Pixabay with a key, the fake one on a stand without.
const _src = () => (PIXABAY.has() ? 'pixabay' : FAKE.on() ? 'fake' : '');

function ready() {
  return _src() ? '' : 'no Pixabay key - set it on Admin → API keys (free, pixabay.com → API docs)';
}

async function search(o) {
  const src = _src();
  if (!src) throw Object.assign(new Error(ready()), { status: 409 });
  return src === 'pixabay' ? PIXABAY.search(o || {}) : _fakeSearch(o || {});
}

async function fetchFile(item) {
  if (item && item.site === 'pixabay') return PIXABAY.fetchFile(item);
  if (item && item.site === 'fake' && FAKE.on()) return _fakeFetch(item);
  throw Object.assign(new Error(ready() || 'this item\'s stock is not here'), { status: 409 });
}

/** A local copy of an item's picture, for the panel's tiles (Pixabay's - kept a day); null - draw it yourself (the fake). */
async function thumbFile(item) {
  return item && item.site === 'pixabay' ? PIXABAY.thumbFile(item) : null;
}

// ── THE FAKE STOCK ──────────────────────────────────────────────────────────
// A query always finds `n` items of each kind, the same ones for the same query: ids from a hash of the query and the number.
// Every third one horizontal. A video of 6-12 s.
const _hash = (s) => crypto.createHash('sha1').update(String(s)).digest('hex');
function _fakeSearch({ query, kind, n }) {
  const q = String(query || '').trim().toLowerCase() || 'stock';
  const out = [];
  const want = Math.max(1, Math.min(40, +n || 12));
  for (let i = 0; i < want; i++) {
    const h = _hash(kind + '|' + q + '|' + i).slice(0, 10);
    const wide = i % 3 === 2;
    out.push({
      id: 'fake:' + kind + ':' + h, site: 'fake', kind,
      w: wide ? 1920 : 1080, h: wide ? 1080 : 1920,
      dur: kind === 'video' ? 6 + (parseInt(h.slice(0, 2), 16) % 7) : 0,
      thumb: '', preview: '', page: '', author: 'fake stock', tags: q, query: q,
      hue: parseInt(h.slice(2, 4), 16) % 360,
    });
  }
  return out;
}

function _ffmpeg(args) {
  return new Promise((resolve, reject) => {
    let err = '';
    const p = spawn(require('ffmpeg-static'), ['-hide_banner', '-loglevel', 'error', '-y', ...args],
      { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    p.stderr.on('data', (c) => { err += c; });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error('ffmpeg: ' + err.trim().slice(0, 200)))));
  });
}

async function _fakeFetch(item) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
  const base = path.join(TEMP_DIR, 'stock_' + String(item.id).replace(/[^a-z0-9]/gi, '_') + '_' + Date.now());
  if (item.kind === 'video') {
    const file = base + '.mp4';
    const hue = (+item.hue || 0) - 180;
    await _ffmpeg(['-f', 'lavfi', '-i', `testsrc2=size=${item.w}x${item.h}:rate=30`, '-t', String(item.dur || 8),
      '-vf', `hue=h=${hue}`, '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-preset', 'ultrafast', '-an', file]);
    return { file, ext: '.mp4' };
  }
  const file = base + '.jpg';
  const sharp = require('sharp');
  const text = String(item.query || '').replace(/[<>&"]/g, ' ').slice(0, 40);
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${item.w}" height="${item.h}">`
    + `<rect width="100%" height="100%" fill="hsl(${+item.hue || 0},55%,45%)"/>`
    + `<text x="50%" y="50%" font-size="${Math.round(item.w / 16)}" fill="white" text-anchor="middle" font-family="Arial">${text}</text></svg>`);
  await sharp(svg).jpeg({ quality: 85 }).toFile(file);
  return { file, ext: '.jpg' };
}

module.exports = { ready, search, fetchFile, thumbFile };
