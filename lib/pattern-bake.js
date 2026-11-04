'use strict';

// ════════════════════════════════════════════════════════════════════════════
// A PATTERN'S TILES MADE READY FOR THE RENDER (phase V65 block 5, the owner 2026-10-31, (пз8), (пз14)-(пз17);
// docs/local-app/plan/, "Фаза V65"). A pattern of main video (phase V74: public/js/overlay/pattern.js layersOf - an address
// under /patterns/) is its file - a seamless tile - repeated over the whole frame by public/js/overlay/pattern.js's rule, the preview's own (js/merge-v3/preview-b.js _drawPattern).
// ffmpeg has no tiling of its own worth the name, so the tiles are laid here, ONCE per look, by sharp, into the library's
// cache (cache/patterns/, made again when missing) - and lib/mv3b-render.js only moves what was laid:
//   still  - the frame itself: tiles of its size and colour, turned by its angle, cut to the frame (W x H);
//   rotate - a square as wide as the frame's diagonal, a tile corner at its middle: ffmpeg turns it by t and cuts the frame;
//   drift  - that square and a tile more on each side: ffmpeg slides a window over it by t (wrapping by a tile - the
//            tiles repeat), turns it by the angle and cuts the frame.
//   bake(timeline) -> Map layer id -> { src (a /cache/ address), mode, side, tile, f (pattern.js of()) }
// A pattern whose file cannot be read is left out: the render lays it as a picture and says so.
// ════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');
const { CACHE_DIR } = require('./config');
const { toDisk, toUrl } = require('./media');
const PAT = require('../public/js/overlay/pattern.js');

const DIR = path.join(CACHE_DIR, 'patterns');
const KEEP_DAYS = 14;
const VERSION = 1;

const _clear = { r: 0, g: 0, b: 0, alpha: 0 };

// The tiles of one look laid over a square `side` px wide, a tile corner at its middle (side is an even number of tiles).
async function _square(abs, f, tile, side) {
  let one = sharp(abs).resize(tile, tile, { kernel: 'lanczos3', fit: 'fill' }).ensureAlpha();
  if (f.color !== '#ffffff') {
    const buf = await one.png().toBuffer();
    one = sharp(buf).composite([{ input: { create: { width: tile, height: tile, channels: 4, background: f.color } }, blend: 'in' }]);
  }
  const tileBuf = await one.png().toBuffer();
  return sharp({ create: { width: side, height: side, channels: 4, background: _clear } })
    .composite([{ input: tileBuf, tile: true, left: 0, top: 0 }]).png({ compressionLevel: 1 }).toBuffer();
}

// The cache's old files go after KEEP_DAYS untouched - a look not rendered for two weeks is laid again when it is.
function _sweep() {
  let names = [];
  try { names = fs.readdirSync(DIR); } catch (e) { return; }
  const old = Date.now() - KEEP_DAYS * 86400000;
  for (const n of names) {
    const p = path.join(DIR, n);
    try { if (fs.statSync(p).mtimeMs < old) fs.unlinkSync(p); } catch (e) { /* in use, or gone */ }
  }
}

async function bake(timeline, frameSize) {
  const out = new Map();
  const tl = timeline || {};
  const { w: W, h: H } = frameSize;
  // (phase V74) The patterns of main video, as the render lays them (overlay/pattern.js layersOf) - known by their layer id.
  const clips = PAT.layersOf(tl);
  if (!clips.length) return out;
  fs.mkdirSync(DIR, { recursive: true });
  _sweep();
  for (const c of clips) {
    try {
      const abs = toDisk(c.src);
      if (!abs || !fs.existsSync(abs)) continue;
      const f = PAT.of(c);
      const size = (await sharp(abs).metadata()).width || PAT.REF;
      const tile = PAT.tileSize(size, W, H, f.scale);
      const cover = PAT.coverSide(tile, W, H);
      const mode = f.move;
      const side = mode === 'drift' ? cover + 2 * tile : cover;
      const key = crypto.createHash('sha1').update(JSON.stringify({ v: VERSION, src: c.src, at: fs.statSync(abs).mtimeMs,
        W, H, tile, side, color: f.color, angle: mode === 'none' ? f.angle : 0, mode: mode === 'none' ? 'still' : 'square' }))
        .digest('hex').slice(0, 20);
      const file = path.join(DIR, key + '.png');
      if (!fs.existsSync(file)) {
        const sq = await _square(abs, f, tile, side);
        let png = sq;
        if (mode === 'none') {
          // Turned about its middle (sharp turns about the middle and grows the canvas), then the frame cut from the middle.
          let img = sharp(sq);
          let s = side;
          if (f.angle) {
            const turned = await img.rotate(f.angle, { background: _clear }).png({ compressionLevel: 1 }).toBuffer();
            s = (await sharp(turned).metadata()).width;
            img = sharp(turned);
          }
          png = await img.extract({ left: Math.round((s - W) / 2), top: Math.round((s - H) / 2), width: W, height: H })
            .png({ compressionLevel: 6 }).toBuffer();
        }
        const tmp = file + '.' + process.pid + '.tmp';
        fs.writeFileSync(tmp, png);
        fs.renameSync(tmp, file);
      } else {
        try { const now = new Date(); fs.utimesSync(file, now, now); } catch (e) { /* the sweep may take it a day early */ }
      }
      out.set(c.id, { src: toUrl(file), mode: mode === 'none' ? 'still' : mode, side, tile, f });
    } catch (e) {
      console.warn('[patterns] could not lay out', c.src, '-', e.message);
    }
  }
  return out;
}

module.exports = { bake, DIR };
