'use strict';

// ════════════════════════════════════════════════════════════════════════════
// A CLIP'S EFFECTS - THE PICTURES THE RENDER LAYS OVER IT (phase V84; docs/local-app/plan/, "Подфаза 3 — V84"). The vignette's
// mask and Quick zoom's speed lines, made ONCE per frame size from public/js/fx/effects.js - the very numbers the preview draws
// by (js/merge-v3/fx-draw.js) - and kept in cache/fx/ (what is made again when missing).
//
//   prepare(timeline, { w, h }) -> Promise<{ vig?, lines?, stripes?: abs, ovals?: { 'WxH': abs } }>   only what the timeline's
//   effects use (block 1c: the face mosaic's oval, one a size)
// ════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const { CACHE_DIR } = require('./config');
const FX = require('../public/js/fx/effects.js');
const P = require('../public/js/fx/params.js');

const DIR = path.join(CACHE_DIR, 'fx');

function _usedKeys(timeline) {
  const ks = new Set();
  for (const t of ((timeline && timeline.tracks) || [])) {
    if (t.kind !== 'video') continue;
    for (const c of (t.clips || [])) for (const e of (P.normalizeFx(c.fx) || [])) ks.add(e.k);
  }
  return ks;
}

async function _write(abs, make) {
  if (fs.existsSync(abs)) return abs;
  fs.mkdirSync(DIR, { recursive: true });
  const tmp = abs + '.' + process.pid + '.tmp.png';
  await make(tmp);
  try { fs.renameSync(tmp, abs); } catch (e) { fs.rmSync(tmp, { force: true }); if (!fs.existsSync(abs)) throw e; }
  return abs;
}

/** The vignette: black, its alpha the darkness at each pixel (effects.js vigAt). */
function vignette(w, h) {
  const abs = path.join(DIR, `vig-v${FX.FX_VERSION}-${w}x${h}.png`);
  return _write(abs, async (tmp) => {
    const sharp = require('sharp');
    const buf = Buffer.alloc(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) buf[(y * w + x) * 4 + 3] = Math.round(255 * FX.vigAt(x + 0.5, y + 0.5, w, h));
    }
    await sharp(buf, { raw: { width: w, height: h, channels: 4 } }).png().toFile(tmp);
  });
}

/** Quick zoom's speed lines: white, round ends, on nothing (effects.js linesOf). */
function lines(w, h) {
  const abs = path.join(DIR, `lines-v${FX.FX_VERSION}-${w}x${h}.png`);
  return _write(abs, async (tmp) => {
    const sharp = require('sharp');
    const f = (v) => (Math.round(v * 100) / 100).toString();
    const ls = FX.linesOf(w, h).map((l) => `<line x1="${f(l.x0)}" y1="${f(l.y0)}" x2="${f(l.x1)}" y2="${f(l.y1)}" stroke-width="${f(l.w)}"/>`);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><g stroke="#ffffff" stroke-linecap="round">${ls.join('')}</g></svg>`;
    await sharp(Buffer.from(svg)).png().toFile(tmp);
  });
}

/** (block 1b) The glitch's dark lines: black, its alpha the darkness of each column (effects.js stripesAt). */
function stripes(w, h) {
  const abs = path.join(DIR, `stripes-v${FX.FX_VERSION}-${w}x${h}.png`);
  return _write(abs, async (tmp) => {
    const sharp = require('sharp');
    const buf = Buffer.alloc(w * h * 4);
    const col = new Uint8Array(w);
    for (let x = 0; x < w; x++) col[x] = Math.round(255 * FX.stripesAt(x + 0.5, w));
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) buf[(y * w + x) * 4 + 3] = col[x];
    await sharp(buf, { raw: { width: w, height: h, channels: 4 } }).png().toFile(tmp);
  });
}

/** (block 1c) The face mosaic's oval: white inside, black around, w x h (its alpha in the render - lib/fx-render.js). */
function oval(w, h) {
  const abs = path.join(DIR, `oval-v${FX.FX_VERSION}-${w}x${h}.png`);
  return _write(abs, async (tmp) => {
    const sharp = require('sharp');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="#000"/>` +
      `<ellipse cx="${w / 2}" cy="${h / 2}" rx="${w / 2}" ry="${h / 2}" fill="#fff"/></svg>`;
    await sharp(Buffer.from(svg)).flatten({ background: '#000000' }).toColourspace('b-w').png().toFile(tmp);
  });
}

async function prepare(timeline, { w, h }) {
  const ks = _usedKeys(timeline);
  const out = {};
  if (!ks.size) return out;
  if ([...ks].some((k) => k === 'vignette')) out.vig = await vignette(w, h);
  if ([...ks].some((k) => k === 'quickzoom')) out.lines = await lines(w, h);
  if ([...ks].some((k) => k === 'glitch')) out.stripes = await stripes(w, h);
  if (ks.has('mosaic')) {
    out.ovals = {};
    for (const t of ((timeline && timeline.tracks) || [])) {
      if (t.kind !== 'video') continue;
      for (const c of (t.clips || [])) {
        const sz = P.mosaicSizeOf({ ...c, fx: P.normalizeFx(c.fx) }, w, h);
        if (sz && !out.ovals[sz.w + 'x' + sz.h]) out.ovals[sz.w + 'x' + sz.h] = await oval(sz.w, sz.h);
      }
    }
  }
  return out;
}

module.exports = { prepare, vignette, lines, stripes, oval, DIR };
