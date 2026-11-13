/* ═══════════════════════════════════════════════════════════════════════════
   COPIES AND MOMENTS - Details, Clasp,
   Film strip, Split, Grid dive, PiP delay, Split screen: video-effects-pack's effects (MIT; their frame-by-frame keys at 30 a
   second, sizes and timings written again for the canvas). Drawn by the page only - live by the preview, baked for the render by
   the app's window with this code (js/merge-v3/fx-draw.js applyFx). Each is draw(g, S) on the clip's window (js/fx/overlays.js
   says what g and S are); S.picture() - the window's picture now, S.frame(t) - the clip's file at another second (Grid dive's
   tiles, PiP delay's late copy - the server's pictures, js/fx/kit.js momentAt; null until they are there), S.tf - the file's
   second now.
   ═══════════════════════════════════════════════════════════════════════════ */

import { css, clamp01, ease, backOut, kf, rrect, text, textFont, textW, shadow, onColor, hblur, flash, coverOf } from './kit.js';
import { textsOf, faceAt } from './effects.js';

const WHITE = [255, 255, 255];
const BLACK = [0, 0, 0];
/** numpy's interp: y at x along points xs (rising) - clamped at the ends. */
function interp(x, xs, ys) {
  if (x <= xs[0]) return ys[0];
  for (let i = 1; i < xs.length; i++) if (x <= xs[i]) return ys[i - 1] + (ys[i] - ys[i - 1]) * (x - xs[i - 1]) / (xs[i] - xs[i - 1]);
  return ys[ys.length - 1];
}
/** The face where the effect starts, in the window (top-left, size). */
function _face(S) {
  const f = faceAt(S.e && S.e.path, +((S.e && S.e.t0) || 0));
  const [cx, cy] = S.toBox(f[0] * S.W, f[1] * S.H);
  return { x: cx - f[2] * S.W / 2, y: cy - f[3] * S.H / 2, w: f[2] * S.W, h: f[3] * S.H };
}
/** The picture zoomed by s about the window's middle, then moved by tx, ty (the pack's warp). */
function _warp(g, pic, w, h, s, tx = 0, ty = 0) {
  g.save();
  g.translate(w / 2 + tx, h / 2 + ty);
  g.scale(s, s);
  g.drawImage(pic, -w / 2, -h / 2, w, h);
  g.restore();
}
/** A frame of the file laid over x, y, w, h as `cover`; the picture now while the server's pictures are not there. */
function _drawFrame(g, im, fallback, x, y, w, h) {
  if (im && im.naturalWidth) {
    const [sx, sy, sw, sh] = coverOf(im.naturalWidth, im.naturalHeight, w, h);
    g.drawImage(im, sx, sy, sw, sh, x, y, w, h);
  } else g.drawImage(fallback, x, y, w, h);
}

// ── Details ─────────────────────────────────────────────────────────────────
// A small flash; the background blurs (21 px); five photo cards of the clip land one after another, each flashing white; then a
// flash and a zoom back from 112 %.
const CARDS = [[19, 0.278, 0.700, 0.345, -6.0], [25, 0.239, 0.281, 0.348, 2.0], [31, 0.678, 0.251, 0.354, -1.2],
  [37, 0.726, 0.703, 0.357, 1.0], [41, 0.500, 0.501, 0.343, 0.0]];
function details(g, S) {
  const { w, h, u } = S;
  const f = S.tau * 30;
  if (f > 95) return;
  const pic = S.picture();
  if (f >= 7 && f <= 13) flash(g, 0.55 * Math.max(0, 1 - Math.abs(f - 9.5) / 3), [252, 248, 240], 0, 0, w, h);
  if (f >= 12 && f < 82) {
    const sig = kf(f, [[12, 0.1], [16, 21 * u]]);
    if (sig > 0.5) {
      g.save();
      g.globalAlpha = f < 16 ? ease((f - 12) / 3.5) : 1;
      g.filter = `blur(${sig.toFixed(2)}px)`;
      g.drawImage(pic, 0, 0, w, h);
      g.restore();
    }
    for (const [fa, cx, cy, wf, rot] of CARDS) {
      if (f < fa) continue;
      const cw = w * wf, ch = h * wf, b = Math.max(1, 3 * u);
      g.save();
      g.translate(cx * w, cy * h);
      g.rotate(-rot * Math.PI / 180);
      g.fillStyle = css([238, 238, 238]);
      g.fillRect(-cw / 2 - b, -ch / 2 - b, cw + 2 * b, ch + 2 * b);
      g.drawImage(pic, -cw / 2, -ch / 2, cw, ch);
      flash(g, Math.max(0, 1 - (f - fa) / 4), WHITE, -cw / 2, -ch / 2, cw, ch);
      g.restore();
    }
  }
  if (f >= 82 && f <= 94) {
    const k = ease((f - 84) / 9);
    _warp(g, pic, w, h, 1.12 - 0.12 * k);
    flash(g, 0.9 * (1 - k), [250, 250, 250], 0, 0, w, h);
  }
}

// ── Clasp ───────────────────────────────────────────────────────────────────
// Black; black-and-white opens from the left like a zip (a sliver running ahead of it); a diagonal wipe brings the colour in,
// zoomed 150 %, with a shadow along its edge; the zoom lets go into the clip with a double exposure; a flash.
function clasp(g, S) {
  const { w, h, u } = S;
  const f = S.tau * 30;
  if (f > 70) return;
  const pic = S.picture();
  g.fillStyle = '#000';
  if (f < 8) { g.fillRect(0, 0, w, h); return; }
  const edge = kf(f, [[8, 0.0], [14, 0.25], [20, 0.55], [28, 0.80], [38, 0.86]]) * w;
  const gray = (x0, x1) => {
    if (x1 <= x0) return;
    g.save();
    g.beginPath();
    g.rect(x0, 0, x1 - x0, h);
    g.clip();
    g.filter = 'grayscale(1)';
    g.drawImage(pic, 0, 0, w, h);
    g.restore();
  };
  const zoomed = () => _warp(g, pic, w, h, 1.5, 0, -0.10 * h);
  if (f < 46) {
    g.fillRect(0, 0, w, h);
    gray(0, edge);
    if (f < 36) { const sx0 = Math.min(w, edge + 0.09 * w); gray(sx0, Math.min(w, sx0 + 0.07 * w)); }
    if (f >= 38) {
      // The wipe: x = xb - 0.35 W/H (y - H/2); a skewed space makes it a straight edge at xb.
      const p = ease((f - 37) / 8);
      const xb = w * (1.25 - 1.55 * p), k = 0.35 * w / h;
      g.save();
      g.transform(1, 0, -k, 1, k * h / 2, 0);
      g.beginPath();
      g.rect(xb, -h, 3 * w, 3 * h);
      g.clip();
      g.setTransform(g.getTransform().multiply(new DOMMatrix([1, 0, k, 1, -k * h / 2, 0])));
      zoomed();
      g.restore();
      g.save();
      g.transform(1, 0, -k, 1, k * h / 2, 0);
      const sh = g.createLinearGradient(xb - 14 * u, 0, xb, 0);
      sh.addColorStop(0, 'rgba(0,0,0,0)');
      sh.addColorStop(1, 'rgba(0,0,0,0.35)');
      g.fillStyle = sh;
      g.fillRect(xb - 14 * u, -h, 14 * u, 3 * h);
      g.restore();
    }
  } else {
    zoomed();
    g.save();
    g.globalAlpha = ease((f - 45) / 2.5);
    g.drawImage(pic, 0, 0, w, h);
    g.restore();
    if (f > 49) {
      g.save();
      g.globalAlpha = 0.8 * Math.sin(Math.PI * clamp01((f - 49) / 6));
      zoomed();
      g.restore();
    }
  }
  let fa = 0.9 * Math.exp(-(((f - 56.5) / 3) ** 2));
  if (f > 58) fa = Math.max(fa, 0.5 * Math.max(0, 1 - (f - 58) / 12));
  flash(g, fa, [250, 250, 250], 0, 0, w, h);
}

// ── Film strip ──────────────────────────────────────────────────────────────
// The clip shrinks to 80 % and rolls off to the left with two dimmed cards after it, all with reflections and a smear of speed; a
// tiny strip of cards; then a bright card flies in from the right and grows back to the whole frame.
const CX1 = [[0, 0.5], [12, 0.5], [18, 0.48], [24, 0.385], [30, 0.244], [36, 0.04], [46, -0.2]];
function strip(g, S) {
  const { w, h, u } = S;
  const f = S.tau * 30;
  if (f >= 114) return;
  const pic = S.picture();
  g.fillStyle = '#000';
  g.fillRect(0, 0, w, h);
  const cy = h / 2;
  // A card of scale s at cx - dimmed by `dim` (and softened, the pack's dim), smeared sideways by `smear` px, its reflection `refl`.
  const card = (x, cx, s, dim, smear, refl) => {
    const cw = w * s, ch = h * s;
    const filt = [dim < 1 ? `brightness(${dim}) blur(${(1.5 * u).toFixed(2)}px)` : '', smear > 2 ? hblur(0.29 * smear) : ''].filter(Boolean).join(' ') || 'none';
    x.save();
    x.filter = filt;
    x.drawImage(pic, cx - cw / 2, cy - ch / 2, cw, ch);
    x.restore();
    const rh = Math.min(ch * 0.45, h - (cy + ch / 2));
    if (rh > 4 && refl > 0) {
      const R = S.canvas('refl', cw, rh);
      const r = R.getContext('2d');
      r.save();
      r.filter = filt;
      r.translate(0, ch);
      r.scale(1, -1);
      r.drawImage(pic, 0, 0, cw, ch);
      r.restore();
      r.globalCompositeOperation = 'destination-in';
      const gr = r.createLinearGradient(0, 0, 0, rh);
      gr.addColorStop(0, `rgba(0,0,0,${refl})`);
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      r.fillStyle = gr;
      r.fillRect(0, 0, cw, rh);
      x.save();
      x.globalCompositeOperation = 'lighten';
      x.drawImage(R, cx - cw / 2, cy + ch / 2);
      x.restore();
    }
  };
  if (f < 46) {
    const s1 = kf(f, [[0, 1.0], [6, 0.94], [12, 0.81], [36, 0.80], [46, 0.78]]);
    const cx1 = kf(f, CX1) * w, pitch = w * s1 * 1.03;
    const mv = Math.abs(kf(f + 1, CX1) - kf(f - 1, CX1)) * w;
    for (const k of [2, 1]) card(g, cx1 + k * pitch, s1, k === 1 ? 0.42 : 0.28, 0, 0.18);
    card(g, cx1, s1, 1, mv > 25 * u ? Math.min(mv * 0.5, 80 * u) : 0, 0.30);
  }
  const a2 = kf(f, [[40, 0], [44, 1], [80, 1], [98, 0]]);
  if (a2 > 0.01) {
    const s2 = kf(f, [[40, 0.78], [48, 0.30], [200, 0.30]]);
    const cw = w * s2, ch = h * s2, pitch = cw * 1.08;
    const cxm = (f < 60 ? 0.54 : 0.5) * w;
    const T = S.canvas('tiny', w, h);
    const t = T.getContext('2d');
    for (const k of [-3, -2, -1, 1, 2, 3]) card(t, cxm + k * pitch, s2, Math.abs(k) === 1 ? 0.42 : 0.28, 0, 0.18);
    if (f < 58) card(t, cxm, s2, 1, 0, 0.30);
    g.save();
    g.globalCompositeOperation = 'lighten';
    g.globalAlpha = a2;
    g.drawImage(T, 0, 0);
    g.restore();
    if (f >= 44 && f <= 72) {
      g.fillStyle = css([235, 235, 235]);
      g.fillRect(cxm - cw * 0.55, cy + ch / 2 + 2, cw * 0.5, Math.max(1, 3 * u));
    }
  }
  if (f >= 56) {
    const s3 = kf(f, [[56, 0.70], [66, 0.70], [72, 0.72], [78, 0.74], [84, 0.75], [90, 0.79], [96, 0.85], [102, 0.91], [108, 0.97], [114, 1.0]]);
    const cx3 = kf(f, [[56, 1.40], [66, 1.12], [72, 0.98], [78, 0.78], [84, 0.64], [90, 0.55], [96, 0.52], [102, 0.51], [108, 0.5], [114, 0.5]]) * w;
    const bl = kf(f, [[56, 70], [72, 55], [84, 30], [96, 10], [104, 0]]) * u;
    card(g, cx3, s3, 1, bl, 0.25);
  }
}

// ── Split ───────────────────────────────────────────────────────────────────
// Black; the clip slides in from the right; it re-tiles into columns 1/2, 1/3, 1/4 wide (the same crop, from the pack's places) and
// back to one; black and white bars run across.
const SP_W = [[0, 1.0], [22, 1.0], [25, 0.5], [40, 0.5], [50, 1 / 3], [58, 1 / 3], [66, 0.25], [80, 0.25], [93, 1.0]];
function split(g, S) {
  const { w, h } = S;
  const f = S.tau * 30;
  if (f >= 97) return;
  const pic = S.picture();
  g.fillStyle = '#000';
  if (f < 5) { g.fillRect(0, 0, w, h); return; }
  if (f < 10) {
    const xo = w * (1 - ease((f - 5) / 5));
    g.fillRect(0, 0, w, h);
    if (w - xo > 1) g.drawImage(pic, 0, 0, (w - xo) * pic.width / w, pic.height, xo, 0, w - xo, h);
    return;
  }
  const wt = kf(f, SP_W);
  if (wt < 0.999) {
    const start = interp(wt, [0.25, 1 / 3, 0.5, 1.0], [0.381, 0.36, 0.374, 0.0]);
    const cw = Math.max(2, Math.round(wt * w));
    const x0 = Math.min(w - cw, Math.round(start * w));
    const sxs = pic.width / w;
    for (let x = 0; x < w; x += cw) g.drawImage(pic, x0 * sxs, 0, cw * sxs, pic.height, x, 0, cw, h);
    if (f >= 44) g.drawImage(pic, (w - cw) * sxs, 0, cw * sxs, pic.height, 0, 0, cw, h);
  }
  const bar = (x0, x1, a, col) => flash(g, a, col, x0, 0, x1 - x0, h);
  if (f >= 78 && f < 82) bar(0, 0.25 * w, 0.97, BLACK);
  if (f >= 82 && f < 88) bar(0.25 * w, 0.5 * w, 0.97 * (1 - ease((f - 85) / 3)), [252, 252, 252]);
  if (f >= 88 && f < 91) bar(0.5 * w, 0.75 * w, 0.30, [60, 60, 60]);
  if (f >= 91 && f < 97) bar(0.75 * w, w, 0.97 * (1 - ease((f - 93) / 4)), [252, 252, 252]);
}

// ── Grid dive ───────────────────────────────────────────────────────────────
// The frame pulls back (to 20 %) into a tilted wall of tiles on a light ground - each tile another moment of the clip, 0.07 s
// apart - and dives back in.
const GD_S = [[0.0, 1.0], [0.033, 0.96], [0.15, 0.20], [0.27, 0.19], [0.62, 0.20], [0.70, 0.5], [0.80, 1.0]];
function griddive(g, S) {
  const { w, h } = S;
  const t = S.tau;
  const s = kf(t, GD_S);
  if (s >= 0.999 || t > 0.85) return;
  const pic = S.picture();
  const ang = -3.0 * (1 - s) / 0.8;
  const pitch = 1.18;
  const tw = Math.max(2, s * w), th = Math.max(2, s * h);
  const px = pitch * s * w, py = pitch * s * h;
  const ni = Math.ceil(w * 0.9 / px) + 1, nj = Math.ceil(h * 0.9 / py) + 1, cols = 2 * ni + 1;
  const gap = Math.max(2, 0.012 * w * Math.min(1, s * 3));
  g.fillStyle = css([243, 247, 250]);
  g.fillRect(0, 0, w, h);
  g.save();
  g.translate(w / 2, h / 2);
  g.rotate(-ang * Math.PI / 180);
  g.translate(-w / 2, -h / 2);
  for (let j = -nj; j <= nj; j++) {
    for (let i = -ni; i <= ni; i++) {
      const cx = w / 2 + i * px, cy = h / 2 + j * py;
      const x0 = cx - tw / 2, y0 = cy - th / 2;
      if (x0 + tw < -w * 0.2 || x0 > w * 1.2 || y0 + th < -h * 0.2 || y0 > h * 1.2) continue;
      g.fillStyle = css([228, 230, 232]);
      g.fillRect(x0 - gap, y0 - gap, tw + 2 * gap, th + 2 * gap);
      if (i === 0 && j === 0) g.drawImage(pic, x0, y0, tw, th);
      else _drawFrame(g, S.frame(S.tf + (j * cols + i) * 0.07), pic, x0, y0, tw, th);
    }
  }
  g.restore();
}

// ── PiP delay ───────────────────────────────────────────────────────────────
// A window in the lower right shows the same clip half a second late (Delay) - its head and chin -, a coloured bar with a
// blinking REC and a counter on top, an ink border; it pops in, tilts and floats.
function pipdelay(g, S) {
  const { w, h, u, opt } = S;
  const t = S.tau;
  const pop = backOut(clamp01(t / 0.28)) * (1 - ease(clamp01((t - 1.85) / 0.25)));
  if (pop <= 0.02) return;
  const pic = S.picture();
  const rad = opt.corners != null ? opt.corners : 1;
  const late = S.frame(S.tf - (opt.delay != null ? opt.delay : 0.5));
  const ww = 0.50 * w, wh = 0.50 * w * 0.88, barh = 44 * u;
  const fb = _face(S);
  const cw = Math.min(w, Math.max(fb.w * 2.7, 0.35 * w)), ch = cw * (wh - barh) / ww;
  const cx0 = Math.min(Math.max(fb.x + fb.w / 2, cw / 2), w - cw / 2), cy0 = Math.min(Math.max(fb.y + fb.h * 0.62, ch / 2), h - ch / 2);
  const W2 = S.canvas('pip', ww, wh);
  const x = W2.getContext('2d');
  x.fillStyle = css(S.col.card);
  x.fillRect(0, 0, ww, wh);
  // The late picture: the head's window of the frame - read off the file's frame laid as the window lays it (cover).
  if (late && late.naturalWidth) {
    const [sx, sy, sw, sh] = coverOf(late.naturalWidth, late.naturalHeight, w, h);
    const k = sw / w;
    x.drawImage(late, sx + (cx0 - cw / 2) * k, sy + (cy0 - ch / 2) * (sh / h), cw * k, ch * (sh / h), 0, barh, ww, wh - barh);
  } else x.drawImage(pic, cx0 - cw / 2, cy0 - ch / 2, cw, ch, 0, barh, ww, wh - barh);
  x.fillStyle = css(S.col.accent);
  x.fillRect(0, 0, ww, barh);
  const on = onColor(S.col.accent);
  if (0.5 + 0.5 * Math.sin(S.live * 9) > 0.35) {
    x.beginPath();
    x.arc(26 * u, barh / 2, 8 * u, 0, 2 * Math.PI);
    x.fillStyle = css([235, 50, 50]);
    x.fill();
  }
  text(x, 'REC', 46 * u, barh / 2, { font: textFont(null, 20 * u, 700), color: on });
  const cnt = '0:' + String(Math.min(59, Math.floor(S.live * 10))).padStart(2, '0');
  text(x, cnt, ww - 20 * u, barh / 2, { font: textFont(null, 18 * u, 500), color: on, align: 'right' });
  const bwd = 4 * u;
  const cx = 0.70 * w, cy = 0.745 * h + 0.006 * h * Math.sin(S.live * 2.6);
  const rot = 2.6 * Math.sin(S.live * 2.0 + 0.5);
  g.save();
  g.translate(cx, cy);
  g.rotate(-rot * Math.PI / 180);
  g.scale(pop, pop);
  const outer = () => rrect(g, -ww / 2, -wh / 2, ww, wh, 14 * u * rad);
  shadow(g, outer, 0, 0.012 * h, 0.014 * w, 0.30);
  outer();
  g.fillStyle = css(S.col.ink);
  g.fill();
  rrect(g, -ww / 2 + bwd, -wh / 2 + bwd, ww - 2 * bwd, wh - 2 * bwd, Math.max(1, 12 * u * rad));
  g.clip();
  g.drawImage(W2, -ww / 2, -wh / 2);
  g.restore();
}

// ── Split screen ────────────────────────────────────────────────────────────
// The screen splits across: the frame on top, the same frame zoomed on the face (Zoom, 135 %) below; the halves slide in from the
// top and the bottom in 0.3 s with a line between them - a caption on it when written.
function splitscreen(g, S) {
  const { w, h, u, e, opt } = S;
  const t = S.tau;
  const ein = ease(clamp01(t / 0.3)), eout = ease(clamp01((t - 1.65) / 0.25)), k = ein * (1 - eout);
  if (k <= 0.002) return;
  const pic = S.picture();
  const fb = _face(S);
  const fcx = fb.x + fb.w / 2, fcy = fb.y + fb.h * 0.40;
  const z = opt.zoom != null ? opt.zoom : 1.35;
  const h2 = Math.floor(h / 2);
  const dy = (1 - k) * h2;
  const sy = pic.height / h;
  if (dy < h2) {
    g.drawImage(pic, 0, dy * sy, pic.width, (h2 - dy) * sy, 0, 0, w, h2 - dy);
    g.save();
    g.beginPath();
    g.rect(0, h2 + dy, w, h - h2 - dy);
    g.clip();
    g.translate(0, dy);
    g.translate(fcx, fcy);
    g.scale(z, z);
    g.translate(-fcx, -fcy);
    g.drawImage(pic, 0, 0, w, h);
    g.restore();
  }
  g.fillStyle = css(S.col.card);
  const lw = Math.max(2, 4 * u);
  g.fillRect(0, h2 - lw / 2, w, lw);
  const lab = String(textsOf(e).caption || '').trim();
  if (lab) {
    const fnt = textFont(e.font, 24 * u, 700, lab);
    const tw = textW(g, lab, fnt) + 40 * u, th = 46 * u;
    rrect(g, w / 2 - tw / 2, h2 - th / 2, tw, th, 23 * u);
    g.fillStyle = css(S.col.card);
    g.fill();
    text(g, lab, w / 2, h2, { font: fnt, color: S.col.text, align: 'center' });
  }
}

/** Every effect of this module by its effect's `draw` key. */
export const COPIES = { details, clasp, strip, split, griddive, pipdelay, splitscreen };
