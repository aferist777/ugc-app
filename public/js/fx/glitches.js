/* ═══════════════════════════════════════════════════════════════════════════
   THE GLITCHES (phase V84 block 5, the owner 2026-11-11 "делаем остальные блоки одним походом до конца") - Cursed, Slice up,
   Slice merge, Liquid glass: video-effects-pack's effects (MIT; their tone curve, keys at 30 a second, bands and lens written again
   for the canvas). Drawn by the page only - live by the preview, baked for the render by the app's window with this code. Each is
   draw(g, S) on the clip's window (js/fx/overlays.js says what g and S are). Their randomness is the effect's own (js/fx/kit.js
   rngOf - by its id and the frame), the same in the preview and in the file.
   ═══════════════════════════════════════════════════════════════════════════ */

import { css, clamp01, ease, smooth, kf, rngOf, hblur, matrix, lumaTables, flash } from './kit.js';
import { faceAt } from './effects.js';

const _face = (S) => {
  const f = faceAt(S.e && S.e.path, +((S.e && S.e.t0) || 0));
  const [cx, cy] = S.toBox(f[0] * S.W, f[1] * S.H);
  return { x: cx - f[2] * S.W / 2, y: cy - f[3] * S.H / 2, w: f[2] * S.W, h: f[3] * S.H };
};
const interp = (x, xs, ys) => {
  if (x <= xs[0]) return ys[0];
  for (let i = 1; i < xs.length; i++) if (x <= xs[i]) return ys[i - 1] + (ys[i] - ys[i - 1]) * (x - xs[i - 1]) / (xs[i] - xs[i - 1]);
  return ys[ys.length - 1];
};

// ── Cursed ──────────────────────────────────────────────────────────────────
// A green night-vision tone (the pack's measured curve: the luma to R, G, B), a strong vignette, now and then a flipped ghost of
// the frame, grain, torn tracking bands, pink dashes and rows shoved sideways - new every frame.
const CUR = [[8, 30, 39, 23], [24, 40, 50, 33], [40, 51, 64, 42], [56, 66, 81, 55], [72, 81, 98, 67], [88, 98, 116, 81], [104, 110, 134, 92],
  [120, 124, 155, 111], [136, 133, 176, 125], [152, 140, 199, 142], [168, 152, 222, 161], [184, 156, 236, 178], [200, 170, 250, 200], [216, 172, 250, 205]];
const CUR_TABLES = [1, 2, 3].map((c) => Array.from({ length: 33 }, (_, i) => interp(i * 255 / 32, CUR.map((r) => r[0]), CUR.map((r) => r[c])) / 255));
const CUR_VIG = [[0, 0.2, 0.55, 0.8, 1.1, 1.6], [1, 1, 0.94, 0.84, 0.74, 0.62]];
const CUR_GHOST = [[0, 10.5], [46, 49], [83, 90], [94, 102]];
let _noise = null;
function _noiseTile() {
  if (_noise) return _noise;
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 256;
  const x = cv.getContext('2d');
  const img = x.createImageData(256, 256);
  const r = rngOf('cursed-noise');
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.max(0, Math.min(255, 128 + r.normal() * 40));
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  _noise = cv;
  return cv;
}
function cursed(g, S) {
  const { w, h, u, e } = S;
  const frame = Math.floor(S.live * 30 + 1e-6);
  const rnd = rngOf(e.id, 'cu', frame);
  const pic = S.picture();
  g.save();
  g.filter = lumaTables('cursed', CUR_TABLES);
  g.drawImage(pic, 0, 0, w, h);
  g.restore();
  const ff = ((S.live % 6) + 6) % 6 * 30;
  if (CUR_GHOST.some(([a, b]) => ff >= a && ff < b)) {
    // The toned picture flipped upside down, 105 % about the middle, a little up - 32 % over it.
    g.save();
    g.globalAlpha = 0.32;
    g.translate(w / 2, h / 2 - 0.05 * h);
    g.scale(1.05, -1.05);
    g.drawImage(S.picture(), -w / 2, -h / 2, w, h);
    g.restore();
  }
  // The vignette: the frame times v(r), r the distance from the middle in half-widths and half-heights.
  g.save();
  g.translate(w / 2, h / 2);
  g.scale(w / 2, h / 2);
  const vg = g.createRadialGradient(0, 0, 0, 0, 0, 1.6);
  CUR_VIG[0].forEach((r, i) => vg.addColorStop(r / 1.6, `rgba(0,0,0,${(1 - CUR_VIG[1][i]).toFixed(3)})`));
  g.fillStyle = vg;
  g.fillRect(-1.2, -1.2, 2.4, 2.4);
  g.restore();
  // Grain: a tile of noise, a new place every frame.
  g.save();
  g.globalCompositeOperation = 'overlay';
  g.globalAlpha = 0.10;
  g.filter = `blur(${(0.7 * u).toFixed(2)}px)`;
  const pat = g.createPattern(_noiseTile(), 'repeat');
  g.translate(-rnd() * 256, -rnd() * 256);
  g.fillStyle = pat;
  g.fillRect(0, 0, w + 512, h + 512);
  g.restore();
  // Tracking noise: wide smeared bands, lifted grey.
  const bands = 3 + Math.floor(rnd() * 5);
  const now = S.picture();
  for (let i = 0; i < bands; i++) {
    const y = rnd() * h, bh = Math.max(2, rnd.range(3, 14) * u), bw = rnd.range(40, 160) * u;
    g.save();
    g.beginPath();
    g.rect(0, y, w, bh);
    g.clip();
    g.filter = `${hblur(0.29 * bw)} brightness(0.65)`;
    g.drawImage(now, 0, 0, w, h);
    g.filter = 'none';
    g.globalCompositeOperation = 'lighter';
    g.fillStyle = 'rgb(75,75,75)';
    g.fillRect(0, y, w, bh);
    g.restore();
  }
  // Short bright pink dashes.
  const dashes = 10 + Math.floor(rnd() * 17);
  for (let i = 0; i < dashes; i++) {
    const y = rnd() * h, dh = Math.max(1, rnd.range(1, 3) * u), x0 = rnd() * w, ln = rnd.range(15, 140) * u;
    g.fillStyle = css([rnd.range(205, 255), rnd.range(190, 255), rnd.range(170, 235)], 0.7);
    g.fillRect(x0, y, ln, dh);
  }
  // A few rows shoved sideways.
  const rows = Math.floor(rnd() * 4);
  if (rows) {
    const snap = S.picture();
    for (let i = 0; i < rows; i++) {
      const y = rnd() * h * 0.95, rh = Math.max(2, rnd.range(6, 30) * u), sh = rnd.normal() * 30 * u;
      g.save();
      g.beginPath();
      g.rect(0, y, w, rh);
      g.clip();
      g.drawImage(snap, sh, 0, w, h);
      g.drawImage(snap, sh - Math.sign(sh) * w, 0, w, h);
      g.restore();
    }
  }
}

// ── Slice up ────────────────────────────────────────────────────────────────
// A 2x zoom on the face fills the frame above a cut edge that creeps up (frame by frame keys of the pack); blown-out mirrored
// blocks and dark smeared blocks flicker over it.
const SU_B = [[0, 1], [12, 1], [13, 0.8], [26, 0.8], [27, 0.5], [32, 0.5], [33, 0.6], [59, 0.6], [60, 0.4], [71, 0.4], [72, 0.3], [83, 0.3], [84, 0.16], [88, 0.08], [91, 0]];
const SU_EV = [[15, 19, 'w', 0.80, 0.95], [20, 23, 'g', 0.52, 0.72], [24, 32, 'w', 0.50, 0.95], [35, 48, 'w', 0.60, 0.82],
  [60, 66, 'g', 0.52, 0.64], [69, 84, 'w', 0.43, 0.70], [85, 93, 'w', 0.55, 0.66]];
function sliceup(g, S) {
  const { w, h, u } = S;
  const f = S.tau * 30;
  if (f >= 94) return;
  const pic = S.picture();
  const fb = _face(S);
  const cx = Math.min(Math.max(fb.x + fb.w / 2, w / 4), 3 * w / 4), cy = Math.min(Math.max(fb.y + fb.h * 0.45, h / 4), 3 * h / 4);
  const yb = kf(f, SU_B) * h;
  const sx = pic.width / w, sy = pic.height / h;
  if (yb > 0.5) {
    g.save();
    g.beginPath();
    g.rect(0, 0, w, yb);
    g.clip();
    g.drawImage(pic, (cx - w / 4) * sx, (cy - h / 4) * sy, (w / 2) * sx, (h / 2) * sy, 0, 0, w, h);
    g.restore();
  }
  for (const [a, b, kind, y0f, y1f] of SU_EV) {
    if (!(f >= a && f < b)) continue;
    const y0 = y0f * h, y1 = y1f * h;
    const snap = S.picture();
    g.save();
    g.beginPath();
    g.rect(0, y0, w, y1 - y0);
    g.clip();
    if (kind === 'w') {
      g.translate(w, 0);
      g.scale(-1, 1);
      g.filter = `blur(${(5 * u).toFixed(2)}px) brightness(1.15)`;
      g.drawImage(snap, 0, 0, w, h);
      g.setTransform(g.getTransform().multiply(new DOMMatrix([-1, 0, 0, 1, w, 0])));
      g.filter = 'none';
      g.globalCompositeOperation = 'lighter';
      g.fillStyle = 'rgb(120,120,120)';
    } else {
      g.filter = `blur(${(8 * u).toFixed(2)}px) ${hblur(0.29 * 120 * u)} brightness(0.45)`;
      g.drawImage(snap, 0, 0, w, h);
      g.filter = 'none';
      g.globalCompositeOperation = 'lighter';
      g.fillStyle = 'rgb(12,12,12)';
    }
    g.fillRect(0, y0, w, y1 - y0);
    g.restore();
  }
}

// ── Slice merge ─────────────────────────────────────────────────────────────
// A warm tone; every 3 s the frame is cut into four bands, each zoomed (140-165 %) and shifted to its own place, a band flashing
// white for a moment; cream flashes at the start and near the end of each round.
const WARM = [[0.935, 0.080, -0.052, 6.5], [0.005, 0.979, -0.020, -0.7], [-0.052, 0.051, 0.878, 5.0]];
const SM_BANDS = [[0.0, 0.1875, 1.40, 0.358, 0.187], [0.1875, 0.50, 1.35, 0.630, 0.384], [0.50, 0.8125, 1.50, 0.333, 0.602], [0.8125, 1.0, 1.65, 0.697, 0.792]];
function slicemerge(g, S) {
  const { w, h, e } = S;
  const cycle = Math.floor(S.live / 3);
  const f = (S.live - cycle * 3) * 30;
  const pic = S.picture();
  const B = S.canvas('sm', w, h);
  const b = B.getContext('2d');
  b.filter = matrix('warm', WARM);
  b.drawImage(pic, 0, 0, w, h);
  b.filter = 'none';
  g.drawImage(B, 0, 0, w, h);
  const k = kf(f, [[0, 0], [9, 0], [10, 0], [24, 1], [50, 1], [54, 0.6], [58, 0]]);
  if (k > 0.001) {
    const ek = ease(k);
    SM_BANDS.forEach(([a, bb, z, cx, cy], bi) => {
      const yc = (a + bb) / 2;
      const zz = 1 + (z - 1) * ek, ccx = 0.5 + (cx - 0.5) * ek, ccy = yc + (cy - yc) * ek;
      g.save();
      g.beginPath();
      g.rect(0, a * h, w, (bb - a) * h);
      g.clip();
      g.transform(zz, 0, 0, zz, 0.5 * w - zz * ccx * w, yc * h - zz * ccy * h);
      g.drawImage(B, 0, 0, w, h);
      g.restore();
      const r = rngOf(e.id, 'sm', bi, cycle);
      const fl = r.range(26, 52);
      if (f >= fl && f < fl + 2.2 && r() < 0.7) flash(g, 0.75, [255, 248, 238], 0, a * h, w, (bb - a) * h);
    });
  }
  const cream = [253, 246, 235];
  flash(g, kf(f, [[4, 0], [9, 0.97], [11, 0.97], [13, 0]]), cream, 0, 0, w, h);
  flash(g, kf(f, [[53, 0], [55, 1.0], [57, 1.0], [59.5, 0]]), cream, 0, 0, w, h);
  flash(g, kf(f, [[62, 0], [64.5, 0.35], [68, 0]]), cream, 0, 0, w, h);
}

// ── Liquid glass ────────────────────────────────────────────────────────────
// A glass lens (a fifth of the width, Size) glides over the face along the pack's path: it magnifies its middle 1.28x and squeezes
// towards the rim (drawn in 80 rings, each zoomed by the lens's rule), the colours part a little at the rim, a white veil, a bright
// arc of light at the upper left and a darker one at the lower right.
const LG = [[0.0, -0.50, 0.15], [0.27, -0.18, 0.09], [0.54, -0.10, 0.10], [0.81, 0.04, 0.07], [1.09, -0.07, 0.07], [1.50, -0.07, 0.07]];
const CH = { r: [[1, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], g: [[0, 0, 0, 0], [0, 1, 0, 0], [0, 0, 0, 0]], b: [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 1, 0]] };
function liquidglass(g, S) {
  const { w, h, opt } = S;
  const t = S.tau;
  const env = smooth(0, 0.2, t) * (1 - smooth(1.3, 1.55, t));
  if (env < 0.01) return;
  const pic = S.picture();
  const fb = _face(S);
  const cx = interp(t, LG.map((p) => p[0]), LG.map((p) => p[1])) * w + fb.x + fb.w / 2;
  const cy = interp(t, LG.map((p) => p[0]), LG.map((p) => p[2])) * h + fb.y + fb.h / 2;
  const R = 0.205 * w * (opt.size != null ? opt.size : 1);
  const L = S.canvas('lens', w, h);
  const x = L.getContext('2d');
  // Rings: few in the middle, where the lens hardly bends, many towards the rim (64 - a ring's own zoom leaves no visible step).
  const edges = [];
  for (let i = 0; i <= 16; i++) edges.push(0.5 * i / 16);
  for (let i = 1; i <= 64; i++) edges.push(0.5 + 0.5 * i / 64);
  // Disks from the rim inwards, each the picture zoomed by its ring's rule: a smaller disk covers the middle of the one before - no
  // seam between rings (the channels drawn 2 px wider than the disk laid, so its soft edge stays outside). At the rim the colours part (the pack's chromatic offset, 0.108 r^3): its three channels added up apart.
  const T = S.canvas('lens-t', w, h);
  const tx = T.getContext('2d');
  const zoomed = (c, r1, k, filt, add, grow = 0) => {
    c.save();
    c.beginPath();
    c.arc(cx, cy, r1 * R + grow, 0, 2 * Math.PI);
    c.clip();
    if (filt) c.filter = filt;
    if (add) c.globalCompositeOperation = 'lighter';
    c.translate(cx, cy);
    c.scale(k, k);
    c.translate(-cx, -cy);
    c.drawImage(pic, 0, 0, w, h);
    c.restore();
  };
  for (let i = edges.length - 2; i >= 0; i--) {
    const r1 = edges[i + 1], rm = (edges[i] + r1) / 2;
    const f = 0.78 + 0.34 * Math.pow(rm, 3.2);
    if (rm < 0.55) { zoomed(x, r1, 1 / f); continue; }
    const ca = 0.108 * Math.pow(rm, 3);
    tx.clearRect(cx - r1 * R - 4, cy - r1 * R - 4, 2 * r1 * R + 8, 2 * r1 * R + 8);
    zoomed(tx, r1, 1 / (f - ca), matrix('ch-b', CH.b), true, 2);
    zoomed(tx, r1, 1 / f, matrix('ch-g', CH.g), true, 2);
    zoomed(tx, r1, 1 / (f + ca), matrix('ch-r', CH.r), true, 2);
    x.save();
    x.beginPath();
    x.arc(cx, cy, r1 * R, 0, 2 * Math.PI);
    x.clip();
    x.drawImage(T, 0, 0, w, h);
    x.restore();
  }
  // The veil and the rim's light and shade.
  const vg = x.createRadialGradient(cx, cy, 0, cx, cy, R);
  for (const q of [0, 0.25, 0.5, 0.75, 0.9, 1]) vg.addColorStop(q, `rgba(255,255,255,${(0.07 * Math.sqrt(1 - q)).toFixed(4)})`);
  x.fillStyle = vg;
  x.beginPath();
  x.arc(cx, cy, R, 0, 2 * Math.PI);
  x.fill();
  if (typeof x.createConicGradient === 'function') {
    for (const [sign, gain, col] of [[1, 140, '255,255,255'], [-1, 60, '0,0,0']]) {
      const cg = x.createConicGradient(0, cx, cy);
      for (let d = 0; d <= 360; d += 10) {
        const c = Math.cos(d * Math.PI / 180 + 2.3);
        const a = sign > 0 ? clamp01(c * 0.9 + 0.1) : clamp01(-c * 0.6);
        cg.addColorStop(d / 360, `rgba(${col},${(a * gain / 255).toFixed(3)})`);
      }
      x.strokeStyle = cg;
      x.lineWidth = 0.07 * R;
      x.beginPath();
      x.arc(cx, cy, 0.965 * R, 0, 2 * Math.PI);
      x.stroke();
    }
  }
  g.save();
  g.globalAlpha = env;
  g.beginPath();
  g.arc(cx, cy, R, 0, 2 * Math.PI);
  g.clip();
  g.drawImage(L, 0, 0, w, h);
  g.restore();
}

/** Every glitch by its effect's `draw` key. */
export const GLITCHES = { cursed, sliceup, slicemerge, liquidglass };
