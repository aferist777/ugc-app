'use strict';

// ════════════════════════════════════════════════════════════════════════════
// REFERENCES, MADE TO A MODEL'S MEASURE (phase V2 pictures; V7 adds clips - docs/local-app/PLAN.md "V-H").
//
// Every model x aggregator record (lib/video-models.js) says what it takes: the formats, the megabytes, the
// shortest and the longest side, the shape. A picture of the Library rarely matches all of them - a WEBP from
// Images where Kling motion control takes only JPEG and PNG, a 4K sheet over a 10 MB cap, a phone photo with
// its rotation in EXIF - so it is fitted here, in memory, and handed to the host (lib/helpers.js
// uploadToPublicHost). The library file is never touched.
//
// What cannot be fitted without changing the picture's meaning - a shape outside the model's range - is
// refused in words before anything is paid; cropping somebody's character to make it fit would be worse.
// ════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const DEF = { formats: ['jpg', 'png', 'webp'], mb: 10, minPx: 300, maxPx: 4096, ratio: [0.4, 2.5] };
const EXT = { jpeg: 'jpg', jpg: 'jpg', png: 'png', webp: 'webp' };

/**
 * One picture for one model x aggregator record: { buf, ext, w, h } within its limits, or an Error in words.
 */
async function image(abs, pair) {
  const lim = Object.assign({}, DEF, (pair && pair.limits && pair.limits.image) || {});
  const label = (pair && pair.label) || 'this model';
  const meta = await sharp(fs.readFileSync(abs)).metadata();
  // The sides as a person sees them: EXIF orientations 5-8 swap them.
  let w = meta.width || 0, h = meta.height || 0;
  if ((meta.orientation || 1) >= 5) { const t = w; w = h; h = t; }
  if (!w || !h) throw new Error('the picture could not be read: ' + path.basename(abs));
  const r = w / h;
  if (r < lim.ratio[0] || r > lim.ratio[1]) {
    throw new Error('the picture is ' + w + 'x' + h + ' - ' + label + ' takes shapes between ' + _shape(lim.ratio[0]) + ' and ' + _shape(lim.ratio[1]));
  }
  let scale = 1;
  if (Math.max(w, h) > lim.maxPx) scale = lim.maxPx / Math.max(w, h);
  if (Math.min(w, h) * scale < lim.minPx) scale = lim.minPx / Math.min(w, h);
  const W = Math.round(w * scale), H = Math.round(h * scale);
  if (Math.max(W, H) > lim.maxPx) {
    throw new Error('the picture is ' + w + 'x' + h + ' - too narrow for ' + label + ' (each side ' + lim.minPx + '-' + lim.maxPx + ' px)');
  }

  const fmt = EXT[String(meta.format || '').toLowerCase()] || '';
  const raw = fs.statSync(abs).size;
  const fine = scale === 1 && lim.formats.includes(fmt) && raw <= lim.mb * 1024 * 1024 && (meta.orientation || 1) === 1;
  if (fine) return { buf: fs.readFileSync(abs), ext: fmt, w, h };

  // Re-encoded: PNG keeps a transparent cut-out where PNG is taken, anything else becomes a JPEG.
  const keepPng = fmt === 'png' && meta.hasAlpha && lim.formats.includes('png');
  for (const q of [92, 85, 75, 65, 55]) {
    let p = sharp(fs.readFileSync(abs)).rotate();
    if (scale !== 1) p = p.resize(W, H, { fit: 'fill' });
    const buf = keepPng ? await p.png({ compressionLevel: 9 }).toBuffer() : await p.jpeg({ quality: q, mozjpeg: true }).toBuffer();
    if (buf.length <= lim.mb * 1024 * 1024) return { buf, ext: keepPng ? 'png' : 'jpg', w: W, h: H };
    if (keepPng) break;
  }
  throw new Error('the picture stays over ' + lim.mb + ' MB for ' + label + ' however it is saved');
}

function _shape(r) {
  // 0.4 -> 2:5, 2.5 -> 5:2, 0.5 -> 1:2
  for (let b = 1; b <= 10; b++) { const a = Math.round(r * b); if (Math.abs(a / b - r) < 0.01) return a + ':' + b; }
  return r.toFixed(2);
}

module.exports = { image };
