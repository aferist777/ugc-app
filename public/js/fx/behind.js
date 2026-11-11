/* ═══════════════════════════════════════════════════════════════════════════
   BEHIND THE PERSON (phase V84 block 6, the owner 2026-11-11 "Делаем остальные блоки одним походом до конца" and "Да" to the
   model): video-effects-pack's scenes that put things BEHIND the person - Orbit, Icons around, Headline storm and its second kind,
   Formulas, Green screen, Green background, Paper cutout - and Mix's white silhouette. Each draws in the clip's window
   (js/fx/box.js), as the graphics of block 4 do (js/merge-v3/fx-draw.js gives `g` and `S`), and lays THE PERSON over what goes
   behind - S.person(): the picture cut by the person's mask (js/fx/person.js, MediaPipe's Selfie Segmenter on the window's picture
   now; null until it has loaded - then everything is drawn over the picture and the preview paints again when it comes). The
   pack's numbers - its shares of the frame, its timings, its palette 'minimal' -, its own drawings written again for the canvas
   (its random shapes from a random of their own: the same at every frame and every bake, not the pack's very ones).
   Page only.
   ═══════════════════════════════════════════════════════════════════════════ */

import { css, mixRgb, clamp01, ease, smooth, backOut, kf, rrect, font, textFont, text, textW, onColor, rngOf, grow, matrix } from './kit.js';
import { textsOf, faceAt } from './effects.js';

const R = Math.PI / 180;
const WHITE = [255, 255, 255];
const BLACK = [0, 0, 0];
const lerp = (a, b, k) => a + (b - a) * k;
const _fonts = (e) => (px, wt, txt) => textFont(e && e.font, px, wt, txt);

/** The face where the effect starts, in the window: { x, y, w, h } (its top-left and size, px) - the pack's face(). */
function _faceBox(S) {
  const f = faceAt(S.e && S.e.path, +((S.e && S.e.t0) || 0));
  const [cx, cy] = S.toBox(f[0] * S.W, f[1] * S.H);
  const fw = f[2] * S.W, fh = f[3] * S.H;
  return { x: cx - fw / 2, y: cy - fh / 2, w: fw, h: fh };
}
/** The person laid over what is behind them (the pack's back * (1 - m) + img * m). */
function _person(g, P, alpha = 1) {
  if (!P) return;
  g.save();
  g.globalAlpha = alpha;
  g.drawImage(P.cut, 0, 0);
  g.restore();
}
/** A scene drawn on a canvas of the window's size, then laid over the clip's picture at `k` (the pack's F.mix(img, scene, k)). */
function _lay(g, S, k, draw) {
  if (!(k > 0.003)) return;
  const C = S.canvas('bh-scene', S.w, S.h);
  const y = C.getContext('2d');
  y.save();
  y.clearRect(0, 0, S.w, S.h);
  draw(y);
  y.restore();
  g.save();
  g.globalAlpha = clamp01(k);
  g.drawImage(C, 0, 0);
  g.restore();
}
/** The pack's soft_shadow2: the shape `path` makes (centred at 0, 0, turned by `rot` degrees ccw, scaled by sc) as a blurred shadow. */
function _shadowOf(g, path, x, y, dx, dy, blur, alpha, sc = 1, rot = 0) {
  if (!(alpha > 0.003) || !(sc > 0.01)) return;
  g.save();
  g.filter = `blur(${Math.max(0.5, blur).toFixed(2)}px)`;
  g.translate(x + dx, y + dy);
  g.rotate(-rot * R);
  g.scale(sc, sc);
  path(g);
  g.fillStyle = `rgba(0,0,0,${Math.min(1, alpha).toFixed(3)})`;
  g.fill();
  g.restore();
}
/** A picture `img` drawn moved by dx, dy over w x h, its edges mirrored into the gap (the pack's warp with BORDER_REFLECT101). */
function _shifted(g, img, dx, dy, w, h) {
  for (const sx of [-1, 0, 1]) {
    for (const sy of [-1, 0, 1]) {
      const ox = dx + sx * w, oy = dy + sy * h;
      if (ox >= w || oy >= h || ox + w <= 0 || oy + h <= 0) continue;
      g.save();
      g.translate(ox + (sx ? w / 2 : 0), oy + (sy ? h / 2 : 0));
      g.scale(sx ? -1 : 1, sy ? -1 : 1);
      g.drawImage(img, sx ? -w / 2 : 0, sy ? -h / 2 : 0, w, h);
      g.restore();
    }
  }
}
/** A small canvas of this module's own (not the frame's). */
const _own = new Map();
function _canvas(name, w, h) {
  let c = _own.get(name);
  if (!c) { c = document.createElement('canvas'); _own.set(name, c); }
  w = Math.max(1, Math.ceil(w)); h = Math.max(1, Math.ceil(h));
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  return c;
}
/** A cache of drawings kept for their key (a size, colours), the last `n`. */
function _cache(n) {
  const m = new Map();
  return (key, make) => {
    if (m.has(key)) return m.get(key);
    const v = make();
    m.set(key, v);
    if (m.size > n) m.delete(m.keys().next().value);
    return v;
  };
}
/** An 8-pointed star's path (the pack's spark): points every 45 degrees from the top, the inner ones `inner` of r. */
function _star(g, x, y, r, inner) {
  g.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (-90 + i * 45) * R, rr = i % 2 === 0 ? r : r * inner;
    if (i) g.lineTo(x + rr * Math.cos(a), y + rr * Math.sin(a)); else g.moveTo(x + rr * Math.cos(a), y + rr * Math.sin(a));
  }
  g.closePath();
}
const _poly = (g, pts) => { g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); };

// ── Orbit ───────────────────────────────────────────────────────────────────
// Seven minimal icons (spark, wave, play, burst, CC, Aa, scissors: white tiles, thin dark glyphs) circle on a dotted tilted ring
// round the person - its back half and the icons there behind them, the front half in front (under the chin for a far face, round
// the head for a close-up). The pack's 1.55 s.
const ORBIT_KINDS = ['spark', 'wave', 'play', 'burst', 'cc', 'aa', 'cut'];
function _orbitIcon(g, kind, s, fill, ink, line) {
  rrect(g, -s / 2, -s / 2, s, s, s * 0.28);
  g.fillStyle = css(fill);
  g.fill();
  g.lineWidth = Math.max(1, s * 0.022);
  g.strokeStyle = css(line);
  g.stroke();
  const th = Math.max(2, s * 0.052);
  g.fillStyle = css(ink);
  g.strokeStyle = css(ink);
  g.lineWidth = th;
  g.lineCap = 'round';
  if (kind === 'spark') { _star(g, 0, 0, 0.27 * s, 0.20); g.fill(); }
  else if (kind === 'wave') {
    g.beginPath();
    [0.10, 0.20, 0.30, 0.18, 0.08].forEach((hh, i) => { const x = s * (0.28 + 0.11 * i) - s / 2; g.moveTo(x, -s * hh); g.lineTo(x, s * hh); });
    g.stroke();
  } else if (kind === 'play') { _poly(g, [[-0.10 * s, -0.21 * s], [-0.10 * s, 0.21 * s], [0.22 * s, 0]]); g.fill(); }
  else if (kind === 'burst') {
    g.beginPath();
    for (let i = 0; i < 8; i++) { const a = i * 45 * R; g.moveTo(0.07 * s * Math.cos(a), 0.07 * s * Math.sin(a)); g.lineTo(0.27 * s * Math.cos(a), 0.27 * s * Math.sin(a)); }
    g.stroke();
  } else if (kind === 'cc' || kind === 'aa') {
    text(g, kind === 'cc' ? 'CC' : 'Aa', 0, 0, { font: font((kind === 'cc' ? 0.36 : 0.38) * s, 700), color: ink, align: 'center' });
  } else if (kind === 'cut') {
    const d = 0.18 * s;
    g.beginPath();
    g.moveTo(-d, -d); g.lineTo(d, d); g.moveTo(-d, d); g.lineTo(d, -d);
    g.stroke();
    g.lineWidth = Math.max(2, s * 0.04);
    for (const sx of [-1, 1]) { g.beginPath(); g.arc(sx * d, d * 1.15, Math.max(2, 0.085 * s), 0, 2 * Math.PI); g.stroke(); }
  }
}
/** The ring's dashes (3 degrees, 3.6 apart, turning 40 a second) - the back or the front half, white with a faint dark edge. */
function _orbitRing(g, cx, cy, rx, ry, tilt, phase, thick, op, front, col, u) {
  if (!(op > 0.005)) return;
  const dash = 3.0, gap = 3.6;
  g.save();
  g.beginPath();
  let a = (phase % (dash + gap)) - (dash + gap);
  while (a < 360) {
    if ((Math.sin((a + dash / 2) * R) > 0) === front) {
      g.moveTo(cx + Math.cos(tilt) * rx * Math.cos(a * R) - Math.sin(tilt) * ry * Math.sin(a * R),
        cy + Math.sin(tilt) * rx * Math.cos(a * R) + Math.cos(tilt) * ry * Math.sin(a * R));
      g.ellipse(cx, cy, rx, ry, tilt, a * R, (a + dash) * R);
    }
    a += dash + gap;
  }
  g.lineWidth = thick;
  g.filter = `blur(${(1.6 * u).toFixed(2)}px)`;
  g.strokeStyle = css(BLACK, 0.30 * op);
  g.stroke();
  g.filter = 'none';
  g.strokeStyle = css(col, op);
  g.stroke();
  g.restore();
}
function orbit(g, S) {
  const { w, h, u, opt, col } = S;
  const t = S.tau;
  if (t > 1.55) return;
  const P = S.person();
  const fb = _faceBox(S);
  const k = clamp01((fb.w / w - 0.40) / 0.12);
  const cx = lerp(0.5 * w, fb.x + fb.w / 2, k);
  const cy = lerp(Math.min(0.70 * h, fb.y + fb.h * 0.5 + 0.24 * h), fb.y + fb.h / 2 + 0.06 * h, k);
  let rx = lerp(0.455 * w, 0.44 * w, k);
  const ry = lerp(0.155 * h, 0.19 * h, k);
  rx = Math.max(0.12 * w, Math.min(rx, cx - 0.075 * w, w - 0.075 * w - cx));
  const size = 0.113 * w * (1 + 0.18 * k) * (opt.size || 1);
  const sp = opt.speed != null ? opt.speed : 1;
  const tilt = -13 * R, ct = Math.cos(tilt), st = Math.sin(tilt);
  const fadeOut = 1 - smooth(1.35, 1.55, t);
  const ringA = smooth(0, 0.3, t) * fadeOut * 0.90;
  const thick = Math.max(1.5, 0.0032 * w);
  const line = mixRgb(col.tile, col.glyph, 0.12);
  const th0 = 150 * R + 2 * Math.PI * t * sp / 2.1;
  const items = ORBIT_KINDS.map((kind, i) => {
    const th = th0 + 2 * Math.PI * i / ORBIT_KINDS.length;
    const z = Math.sin(th);
    const ex = rx * Math.cos(th), ey = ry * z;
    const life = backOut(clamp01((t - 0.04 * i) / 0.28)) * fadeOut;
    return { z, x: cx + ex * ct - ey * st, y: cy + ex * st + ey * ct, kind, sc: (0.80 + 0.20 * (z + 1) / 2) * life };
  }).sort((a, b) => a.z - b.z);
  const tile = (it, dy, bl, a) => {
    _shadowOf(g, (y) => rrect(y, -size / 2, -size / 2, size, size, size * 0.28), it.x, it.y, 0, dy, bl, a, it.sc);
    g.save();
    g.translate(it.x, it.y);
    g.scale(it.sc, it.sc);
    _orbitIcon(g, it.kind, size, col.tile, col.glyph, line);
    g.restore();
  };
  _orbitRing(g, cx, cy, rx, ry, tilt, t * 40 * sp, thick, ringA, false, col.ring, u);
  for (const it of items) if (it.z < 0 && it.sc > 0.08) tile(it, 0.006 * h, 0.008 * w, 0.30);
  _person(g, P);
  _orbitRing(g, cx, cy, rx, ry, tilt, t * 40 * sp, thick, ringA, true, col.ring, u);
  for (const it of items) if (it.z >= 0 && it.sc > 0.08) tile(it, 0.007 * h, 0.009 * w, 0.32);
}

// ── Icons around ────────────────────────────────────────────────────────────
// Eight glossy colour squircles with white glyphs (music, picture, chat, play, chart, document, spark, bolt) circle on a flat
// tilted ring round the head - some behind the person, some in front; no ring drawn. The pack's 2 s.
const GLOSS_KINDS = ['music', 'image', 'chat', 'play', 'bars', 'doc', 'spark', 'bolt'];
const _glossCache = _cache(40);
/** The glyph of `kind` on a canvas s x s: its shapes filled with `col`, its holes cut out. */
function _glyph(kind, s, col) {
  const c = _canvas('gly', s, s);
  const g = c.getContext('2d');
  g.clearRect(0, 0, s, s);
  g.fillStyle = css(col);
  const P = (pts) => _poly(g, pts.map(([x, y]) => [x * s, y * s]));
  const rr = (x0, y0, x1, y1, r) => rrect(g, x0 * s, y0 * s, (x1 - x0) * s, (y1 - y0) * s, r * s);
  const circ = (x, y, r) => { g.beginPath(); g.arc(x * s, y * s, r * s, 0, 2 * Math.PI); };
  const hole = (draw) => { g.save(); g.globalCompositeOperation = 'destination-out'; draw(); g.fill(); g.restore(); };
  if (kind === 'music') {
    g.beginPath(); g.ellipse(0.38 * s, 0.69 * s, 0.125 * s, 0.092 * s, -22 * R, 0, 2 * Math.PI); g.fill();
    g.fillRect(0.485 * s, 0.27 * s, 0.055 * s, 0.42 * s);
    P([[0.50, 0.27], [0.50, 0.36], [0.74, 0.47], [0.74, 0.37]]); g.fill();
  } else if (kind === 'image') {
    rr(0.20, 0.24, 0.80, 0.76, 0.06); g.fill();
    hole(() => rr(0.245, 0.285, 0.755, 0.715, 0.035));
    P([[0.27, 0.70], [0.43, 0.46], [0.55, 0.62], [0.63, 0.52], [0.73, 0.70]]); g.fill();
    circ(0.66, 0.36, 0.06); g.fill();
  } else if (kind === 'chat') {
    rr(0.19, 0.25, 0.81, 0.63, 0.10); g.fill();
    P([[0.33, 0.60], [0.33, 0.80], [0.52, 0.60]]); g.fill();
    for (const x of [0.36, 0.50, 0.64]) hole(() => circ(x, 0.44, 0.04));
  } else if (kind === 'play') { P([[0.36, 0.27], [0.36, 0.73], [0.76, 0.50]]); g.fill(); }
  else if (kind === 'bars') {
    for (const [x0, y0, x1] of [[0.25, 0.54, 0.37], [0.44, 0.34, 0.56], [0.63, 0.44, 0.75]]) { rr(x0, y0, x1, 0.75, 0.025); g.fill(); }
  } else if (kind === 'doc') {
    P([[0.30, 0.21], [0.57, 0.21], [0.72, 0.37], [0.72, 0.79], [0.30, 0.79]]); g.fill();
    for (const y of [0.52, 0.62, 0.71]) hole(() => rr(0.38, y - 0.017, 0.64, y + 0.017, 0.012));
    hole(() => P([[0.57, 0.21], [0.57, 0.37], [0.72, 0.37]]));
  } else if (kind === 'spark') {
    _star(g, 0.46 * s, 0.54 * s, 0.31 * s, 0.075 / 0.31); g.fill();
    _star(g, 0.73 * s, 0.27 * s, 0.10 * s, 0.3); g.fill();
  } else if (kind === 'bolt') { P([[0.56, 0.17], [0.31, 0.55], [0.48, 0.55], [0.42, 0.84], [0.70, 0.43], [0.52, 0.43]]); g.fill(); }
  return c;
}
/** A glossy squircle s px: a colour from light to a little dark, a soft light band on top, its glyph with a small shadow, a light rim. */
function _glossIcon(kind, s, col) {
  s = Math.max(8, Math.round(s));
  return _glossCache(kind + '|' + s + '|' + col.join(','), () => {
    const c = document.createElement('canvas');
    c.width = s; c.height = s;
    const g = c.getContext('2d');
    const top = mixRgb(col, WHITE, 0.30), bot = mixRgb(col, BLACK, 0.16);
    rrect(g, 0, 0, s, s, 0.30 * s);
    g.save();
    g.clip();
    const gr = g.createLinearGradient(0, 0, 0, s);
    gr.addColorStop(0, css(top));
    gr.addColorStop(1, css(bot));
    g.fillStyle = gr;
    g.fillRect(0, 0, s, s);
    const gl = g.createLinearGradient(0, 0, 0, 0.5 * s);
    for (let q = 0; q <= 5; q++) gl.addColorStop(q / 5, css(WHITE, Math.pow(1 - q / 5, 1.6) * 0.20));
    g.fillStyle = gl;
    g.fillRect(0, 0, s, 0.5 * s);
    const ink = col[0] + col[1] + col[2] > 520 ? onColor(col) : WHITE;
    const shade = _glyph(kind, s, bot.map((v) => v * 0.5));
    g.save();
    g.filter = `blur(${(0.012 * s).toFixed(2)}px)`;
    g.globalAlpha = 0.28;
    g.drawImage(shade, 0, 0.012 * s);
    g.restore();
    g.drawImage(_glyph(kind, s, ink), 0, 0);
    rrect(g, 0, 0, s, s, 0.30 * s);
    g.lineWidth = 0.04 * s;
    g.strokeStyle = css(WHITE, 0.12);
    g.stroke();
    g.restore();
    return c;
  });
}
function iconsaround(g, S) {
  const { w, h, opt, col } = S;
  const t = S.tau;
  if (t > 2.0) return;
  const P = S.person();
  const fb = _faceBox(S);
  const fcx = fb.x + fb.w / 2, fcy = fb.y + fb.h / 2;
  const k = clamp01((fb.w / w - 0.30) / 0.20);
  const cx = fcx, cy = fcy + 0.16 * fb.h;
  let rx = Math.max(0.37 * w, Math.min(0.44 * w, 0.85 * fb.w + 0.11 * w));
  rx = Math.max(0.22 * w, Math.min(rx, cx - 0.085 * w, w - 0.085 * w - cx));
  const ry = Math.max(0.075 * h, 0.36 * rx);
  const s = 0.108 * w * (1 + 0.12 * k) * (opt.size || 1);
  const sp = opt.speed != null ? opt.speed : 1;
  const pop = [col.c1, col.c2, col.c3];
  const cols = [pop[0], pop[1], pop[2], mixRgb(pop[0], pop[2], 0.5), pop[2], pop[0], pop[1], mixRgb(pop[1], pop[0], 0.5)];
  const tilt = -10 * R, ct = Math.cos(tilt), st = Math.sin(tilt);
  const th0 = 200 * R + 2 * Math.PI * t * sp / 3.6;
  const fade = 1 - smooth(1.72, 1.98, t);
  const items = GLOSS_KINDS.map((kind, i) => {
    const th = th0 + 2 * Math.PI * i / GLOSS_KINDS.length;
    const z = Math.sin(th);
    const ex = rx * Math.cos(th), ey = ry * z;
    const life = backOut(clamp01((t - 0.05 * i) / 0.30)) * fade;
    return { z, x: cx + ex * ct - ey * st, y: cy + ex * st + ey * ct + 0.004 * h * Math.sin(2.4 * t + i), kind, col: cols[i],
      sc: (0.80 + 0.20 * (z + 1) / 2) * life };
  }).sort((a, b) => a.z - b.z);
  const draw = (it, dy, bl, a) => {
    _shadowOf(g, (y) => rrect(y, -s / 2, -s / 2, s, s, 0.30 * s), it.x, it.y, 0, dy, bl, a, it.sc);
    const ic = _glossIcon(it.kind, s, it.col);
    g.save();
    g.translate(it.x, it.y);
    g.scale(it.sc * s / ic.width, it.sc * s / ic.width);
    g.drawImage(ic, -ic.width / 2, -ic.height / 2);
    g.restore();
  };
  for (const it of items) if (it.z < 0 && it.sc > 0.06) draw(it, 0.007 * h, 0.010 * w, 0.30);
  _person(g, P);
  for (const it of items) if (it.z >= 0 && it.sc > 0.06) draw(it, 0.008 * h, 0.011 * w, 0.34);
}

// ── Headline storm ──────────────────────────────────────────────────────────
// Black and white news ribbons, tagged BREAKING / JUST IN / UPDATE, fly in from both sides one after another, drift and fly out: most
// behind the person, three in front under the chin. Their words the person's (empty ones left out, the rest dealt round the nine).
// (tag, kind, y share, angle ccw, left edge share, from, start) - the pack's _HS.
const HS = [['BREAKING', 'white', 0.222, -5.5, 0.01, 'L', 0.00], ['JUST IN', 'white', 0.285, 3.0, 0.30, 'R', 0.14],
  ['BREAKING', 'black', 0.345, -5.0, -0.02, 'L', 0.28], ['', 'white', 0.395, -6.5, 0.60, 'R', 0.42], ['BREAKING', 'white', 0.455, 4.0, -0.35, 'L', 0.52],
  ['JUST IN', 'black', 0.525, -3.5, 0.10, 'R', 0.62], ['UPDATE', 'black', 0.625, -2.5, 0.52, 'R', 0.76], ['JUST IN', 'white', 0.700, 3.0, 0.52, 'R', 0.88],
  ['BREAKING', 'white', 0.765, -5.0, -0.04, 'L', 1.0]];
const HS_FRONT = { 3: 0.070, 5: 0.135, 7: 0.205 };   // the ribbons crossing IN FRONT: how far under the chin (a share of the height)
/** The person's words in order, the empty ones left out, upper case. */
const _words = (e) => Object.values(textsOf(e)).map((v) => String(v || '').trim().toUpperCase()).filter(Boolean);
function headlinestorm(g, S) {
  const { w, h, e, col } = S;
  const t = S.tau;
  if (t > 2.05) return;
  const words = _words(e);
  const P = S.person();
  const F = _fonts(e);
  const fb = _faceBox(S);
  const dyoff = Math.max(-0.25 * h, Math.min(0.1 * h, (fb.y + fb.h * 0.5) - 0.43 * h)) * 0.9;
  const outK = smooth(1.82, 2.0, t);
  const fh = 0.038 * h, fs = 0.040 * w, ts = 0.016 * w;
  const card = col.card, ink = col.ink;
  const front = [];
  const strip = (i, cx, cy, ang, shA, shDy, shBl) => {
    const [tag, kind] = HS[i];
    const txt = words[i % words.length];
    const light = kind === 'white';
    const tagBg = light ? ink : mixRgb(card, ink, 0.05), tagInk = light ? WHITE : ink;
    const tw = textW(g, txt, F(fs, 900, txt));
    const tagW = tag ? textW(g, tag, font(ts, 700), 0.06 * ts) + 0.02 * w : 0;
    const total = tagW + tw + 0.04 * w;
    _shadowOf(g, (y) => { y.beginPath(); y.rect(-total / 2, -fh / 2, total, fh); }, cx, cy, 0, shDy, shBl, shA, 1, ang);
    g.save();
    g.translate(cx, cy);
    g.rotate(-ang * R);
    g.translate(-total / 2, -fh / 2);
    g.fillStyle = css(light ? card : ink);
    g.fillRect(0, 0, total, fh);
    if (tag) {
      g.fillStyle = css(tagBg);
      g.fillRect(0, 0, tagW, fh);
      text(g, tag, 0.01 * w, fh / 2, { font: font(ts, 700), color: tagInk, align: 'left', spacing: 0.06 * ts });
    }
    text(g, txt, tagW + 0.02 * w, fh / 2, { font: F(fs, 900, txt), color: light ? ink : card, align: 'left' });
    g.restore();
    return total;
  };
  if (words.length) {
    for (let i = 0; i < HS.length; i++) {
      const [, , yf, ang, lf, side, t0] = HS[i];
      const k = ease(clamp01((t - t0) / 0.42));
      if (k <= 0.001) continue;
      const txt = words[i % words.length];
      const tagW = HS[i][0] ? textW(g, HS[i][0], font(ts, 700), 0.06 * ts) + 0.02 * w : 0;
      const bw = tagW + textW(g, txt, F(fs, 900, txt)) + 0.04 * w;
      const dir = side === 'L' ? 1 : -1;
      let left = lerp(-dir * 1.25 * w, lf * w, k) + (t - t0 > 0.4 ? 0.012 * w * (t - t0 - 0.4) : 0) * dir;
      left = lerp(left, -dir * 1.4 * w, outK);
      const cx = left + bw / 2;
      if (HS_FRONT[i] != null) {
        const cy = Math.min(0.93 * h, fb.y + fb.h + HS_FRONT[i] * h) + 0.004 * h * Math.sin(t * 3 + i);
        front.push([i, cx, cy, ang]);
        continue;
      }
      const cy = yf * h + dyoff * (0.3 + 0.7 * Math.min(1, yf / 0.5)) + 0.004 * h * Math.sin(t * 3 + i);
      strip(i, cx, cy, ang, 0.22 * (1 - outK), 0.004 * h, 0.004 * w);
    }
  }
  _person(g, P);
  for (const [i, cx, cy, ang] of front) strip(i, cx, cy, ang, 0.28 * (1 - outK), 0.005 * h, 0.006 * w);
}

// ── Headline storm 2 ────────────────────────────────────────────────────────
// The screen darkens, three lightning bolts strike with a flash, coloured headline plates fly in from the sides - some behind the
// person, some in front under the chin - and the frame shakes for a moment. The pack's 2.1 s.
// (colour 0-3, centre x share, anchored at the face's top or the chin, dy, angle ccw, from, start, in front)
const HS2 = [[0, 0.46, 'top', -0.72, -3.0, 'L', 0.00, false], [2, 0.74, 'top', 0.18, 3.0, 'R', 0.08, false],
  [1, 0.26, 'top', 0.62, -4.0, 'L', 0.16, false], [3, 0.40, 'chin', 0.050, -2.0, 'L', 0.24, true], [1, 0.64, 'chin', 0.105, 2.5, 'R', 0.32, true],
  [2, 0.45, 'chin', 0.160, -2.0, 'L', 0.40, true], [0, 0.70, 'top', 1.05, 3.0, 'R', 0.20, false]];
/** A lightning bolt from the top edge down to y1: a jagged line and two side branches - from a random of its own. */
function _bolt(rnd, w, h, x0, y1) {
  const pts = [[x0, -0.02 * h]];
  let x = x0, y = -0.02 * h;
  while (y < y1) { y += rnd.range(0.030, 0.060) * h; x += rnd.range(-0.055, 0.055) * w; pts.push([x, y]); }
  const branches = [];
  for (let j = 0; j < 2; j++) {
    const k = 2 + j * 3;
    if (k >= pts.length) continue;
    let [bx, by] = pts[k];
    const br = [[bx, by]];
    for (let q = 0; q < 4; q++) { bx += rnd.range(-0.05, 0.07) * w * (j ? 1 : -1); by += rnd.range(0.02, 0.04) * h; br.push([bx, by]); }
    branches.push(br);
  }
  return { pts, branches };
}
function headlinestorm2(g, S) {
  const { w, h, u, e, col } = S;
  const t = S.tau;
  if (t > 2.1) return;
  const words = _words(e);
  const P = S.person();
  const F = _fonts(e);
  const fb = _faceBox(S);
  const fills = [col.c1, col.c2, col.c3, col.c4];
  const ink = col.c3;
  const dim = 0.26 * smooth(0.22, 0.42, t) * (1 - smooth(1.55, 1.85, t));
  const outK = smooth(1.82, 2.05, t);
  // The picture darkened (the plates behind are not).
  if (dim > 0.002) { g.save(); g.fillStyle = css(BLACK, dim); g.fillRect(0, 0, w, h); g.restore(); }
  const fs = 0.040 * w, ph = 0.080 * w, r = 0.012 * w;
  const plate = (i, x, y, ang, shA, shDy, shBl) => {
    const fill = fills[HS2[i][0]];
    const txt = words[i % words.length];
    const pw = textW(g, txt, F(fs, 900, txt)) + 0.075 * w;
    _shadowOf(g, (q) => rrect(q, -pw / 2, -ph / 2, pw, ph, r), x, y, 0, shDy, shBl, shA, 1, ang);
    g.save();
    g.translate(x, y);
    g.rotate(-ang * R);
    rrect(g, -pw / 2, -ph / 2, pw, ph, r);
    g.fillStyle = css(fill);
    g.fill();
    g.lineWidth = Math.max(1, 1.6 * u);
    g.strokeStyle = css(fill.join() !== ink.join() ? ink : mixRgb(ink, WHITE, 0.25));
    g.stroke();
    text(g, txt, 0, 0, { font: F(fs, 900, txt), color: onColor(fill), align: 'center' });
    g.restore();
  };
  const front = [];
  if (words.length) {
    HS2.forEach(([, cxf, anc, dy, ang, side, t0, isFront], i) => {
      const k = ease(clamp01((t - t0) / 0.40));
      if (k <= 0.001) return;
      let y = anc === 'chin' ? Math.min(0.93 * h, fb.y + fb.h + dy * h) : fb.y + dy * fb.h;
      y = Math.max(0.08 * h, Math.min(0.95 * h, y)) + 0.004 * h * Math.sin(2.6 * t + i);
      const dir = side === 'L' ? 1 : -1;
      const start = side === 'L' ? -0.9 * w : 1.9 * w;
      let x = lerp(start, cxf * w, k) + (t - t0 > 0.4 ? 0.010 * w * (t - t0 - 0.4) : 0) * dir;
      x = lerp(x, start, outK);
      if (isFront) front.push([i, x, y, ang]);
      else plate(i, x, y, ang, 0.15 * (1 - outK), 0.003 * h, 0.004 * w);
    });
  }
  // The person, darkened as the picture is.
  if (P) {
    const pc = S.canvas('bh-pd', w, h);
    const x = pc.getContext('2d');
    x.clearRect(0, 0, w, h);
    x.drawImage(P.cut, 0, 0);
    if (dim > 0.002) { x.globalCompositeOperation = 'source-atop'; x.fillStyle = css(BLACK, dim); x.fillRect(0, 0, w, h); x.globalCompositeOperation = 'source-over'; }
    g.drawImage(pc, 0, 0);
  }
  for (const [i, x, y, ang] of front) plate(i, x, y, ang, 0.22 * (1 - outK), 0.004 * h, 0.005 * w);
  // Lightning: three bolts, each with its glow and a white flash.
  let fl = 0;
  [0.50, 0.72, 0.95].forEach((tb, bi) => {
    const tt = t - tb;
    if (!(tt >= 0 && tt < 0.15)) return;
    const f = 1 - tt / 0.15;
    const rnd = rngOf('hs2-bolt', bi);
    const x0 = (0.30 + 0.20 * bi + rnd.range(-0.05, 0.05)) * w;
    const b = _bolt(rnd, w, h, x0, (0.62 + 0.08 * bi) * h);
    const B = S.canvas('bh-bolt', w, h);
    const y = B.getContext('2d');
    y.clearRect(0, 0, w, h);
    y.strokeStyle = '#ffffff';
    y.lineJoin = 'round';
    y.lineCap = 'round';
    y.lineWidth = Math.max(2, 4 * u);
    y.beginPath(); b.pts.forEach(([px, py], q) => (q ? y.lineTo(px, py) : y.moveTo(px, py))); y.stroke();
    y.lineWidth = Math.max(1, 2 * u);
    for (const br of b.branches) { y.beginPath(); br.forEach(([px, py], q) => (q ? y.lineTo(px, py) : y.moveTo(px, py))); y.stroke(); }
    // The glow (the pack's 2.2 x a wide blur + 1.2 x a narrow one, light blue): the core's blurs laid in that colour.
    const G = S.canvas('bh-glow', w, h);
    const z = G.getContext('2d');
    z.clearRect(0, 0, w, h);
    z.drawImage(B, 0, 0);
    z.globalCompositeOperation = 'source-in';
    z.fillStyle = css([170, 225, 255]);
    z.fillRect(0, 0, w, h);
    z.globalCompositeOperation = 'source-over';
    g.save();
    for (const [sg, n] of [[0.012 * w, 2.2], [0.004 * w, 1.2]]) {
      g.filter = `blur(${sg.toFixed(2)}px)`;
      for (let a = n; a > 0.01; a -= 1) { g.globalAlpha = Math.min(1, a) * f; g.drawImage(G, 0, 0); }
    }
    g.filter = 'none';
    g.globalAlpha = f;
    g.drawImage(B, 0, 0);
    g.restore();
    fl = Math.max(fl, 0.34 * Math.pow(f, 1.5));
  });
  if (fl > 0.01) { g.save(); g.fillStyle = css(WHITE, fl); g.fillRect(0, 0, w, h); g.restore(); }
  // The camera shaking, settling down: the window moved, its edge rows repeated into the gap.
  const sk = 6 * u * Math.exp(-Math.max(0, t - 0.45) / 0.55) * smooth(0.40, 0.50, t) * (1 - smooth(1.7, 1.9, t));
  if (sk > 0.3) {
    const dx = sk * Math.sin(2 * Math.PI * 3.3 * t), dy = sk * 0.8 * Math.sin(2 * Math.PI * 4.1 * t + 1.0);
    const now = S.picture();
    const C = S.canvas('bh-shake', w, h);
    const y = C.getContext('2d');
    y.clearRect(0, 0, w, h);
    _shifted(y, now, dx, dy, w, h);
    g.drawImage(C, 0, 0);
  }
}

// ── Formulas ────────────────────────────────────────────────────────────────
// Chalk maths and a few right triangles drift on the background BEHIND the person, each fading in, hanging and fading out on its
// own cycle - for as long as the effect is on. 26 of them where they do not overlap and stay inside the window, from a random of the
// effect's own.
const FORMULAS = ['E = mc²', 'a² + b² = c²', '∫ f(x) dx', 'A = πr²', 'F = ma', 'V = IR', 'sin²θ + cos²θ = 1', 'x = (−b ± √(b² − 4ac)) / 2a',
  'e^(iπ) + 1 = 0', 'Σ 1/n² = π²/6', 'λ = h / p', 'v = s / t', 'P = F / A', 'Δx · Δp ≥ ħ/2', 'c² = a² + b²', '∞ ≠ 0', '√2 ≈ 1.414', 'π ≈ 3.14159'];
const _fmCache = _cache(4);
let _chalkTile = null;
/** Chalk's grain: a tile of soft random spots that rub the strokes thinner here and there (the pack's 0.62 + 0.9 (grain - 0.5) + 0.38). */
function _chalk() {
  if (_chalkTile) return _chalkTile;
  const n = 128;
  const rnd = rngOf('chalk');
  const v = new Float32Array(n * n);
  for (let i = 0; i < v.length; i++) v[i] = rnd();
  const c = document.createElement('canvas');
  c.width = n; c.height = n;
  const x = c.getContext('2d');
  const id = x.createImageData(n, n);
  for (let yy = 0; yy < n; yy++) {
    for (let xx = 0; xx < n; xx++) {
      let s = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += v[((yy + dy + n) % n) * n + ((xx + dx + n) % n)] * (dx || dy ? (dx && dy ? 0.0625 : 0.125) : 0.25);
      const j = (yy * n + xx) * 4;
      id.data[j + 3] = Math.round(255 * Math.max(0, Math.min(1, 0.9 * (0.5 - s))));
    }
  }
  x.putImageData(id, 0, 0);
  _chalkTile = c;
  return c;
}
/** A patch of chalk: its canvas (white, turned), its size. */
function _chalkPatch(draw, pw, ph, ang) {
  const a = ang * R, cs = Math.abs(Math.cos(a)), sn = Math.abs(Math.sin(a));
  const nw = Math.ceil(ph * sn + pw * cs) + 4, nh = Math.ceil(ph * cs + pw * sn) + 4;
  const c = document.createElement('canvas');
  c.width = nw; c.height = nh;
  const x = c.getContext('2d');
  x.translate(nw / 2, nh / 2);
  x.rotate(-a);
  x.translate(-pw / 2, -ph / 2);
  draw(x);
  x.setTransform(1, 0, 0, 1, 0, 0);
  x.globalCompositeOperation = 'destination-out';
  x.fillStyle = x.createPattern(_chalk(), 'repeat');
  x.fillRect(0, 0, nw, nh);
  return c;
}
function _formulaItems(g, S) {
  const { w, h, e } = S;
  return _fmCache(`${(e && e.id) || ''}|${Math.round(w)}x${Math.round(h)}`, () => {
    const rnd = rngOf('formulas', (e && e.id) || '');
    const pool = () => { const a = FORMULAS.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
    let names = pool();
    const items = [], boxes = [];
    const pad = 0.012 * w, mx = 0.03 * w;
    for (let k = 0; k < 26; k++) {
      const ang = rnd.range(-12, 12);
      let p = null;
      if (k % 6 === 2) {
        const size = w * rnd.range(0.11, 0.15), n = size * 1.5;
        p = _chalkPatch((x) => {
          x.strokeStyle = '#ffffff';
          x.lineJoin = 'round';
          x.lineWidth = Math.max(2, size * 0.045);
          _poly(x, [[0.12 * n, 0.82 * n], [0.88 * n, 0.82 * n], [0.12 * n, 0.18 * n]]);
          x.stroke();
          const s = 0.12 * n;
          x.lineWidth = Math.max(1, size * 0.03);
          x.strokeRect(0.12 * n, 0.82 * n - s, s, s);
        }, n, n, ang);
      } else {
        for (let tries = 0; tries < 4 && !p; tries++) {
          if (!names.length) names = pool();
          const txt = names.pop();
          const size = w * rnd.range(0.046, 0.068);
          const f = font(size, 700);
          const u = w / 1080;
          const tw = textW(g, txt, f) + 24 * u, th = size * 1.25 + 24 * u;
          if (tw > w - 2 * mx) continue;
          p = _chalkPatch((x) => text(x, txt, 12 * u, th / 2, { font: f, color: WHITE, align: 'left' }), tw, th, ang);
        }
      }
      if (!p) continue;
      const pw = p.width, phh = p.height;
      for (let tries = 0; tries < 80; tries++) {
        const cx = rnd.range(mx + pw / 2, w - mx - pw / 2), cy = rnd.range(0.03 * h + phh / 2, 0.97 * h - phh / 2);
        const bx = [cx - pw / 2 - pad, cy - phh / 2 - pad, cx + pw / 2 + pad, cy + phh / 2 + pad];
        if (boxes.every((o) => bx[2] < o[0] || bx[0] > o[2] || bx[3] < o[1] || bx[1] > o[3])) {
          boxes.push(bx);
          items.push({ p, cx, cy, period: rnd.range(3.0, 4.4), off: rnd.range(0, 4.4), fl: rnd.range(0, 6.28) });
          break;
        }
      }
    }
    return items;
  });
}
function formulas(g, S) {
  const { w, h, col } = S;
  const t = S.tau;
  const P = S.person();
  const items = _formulaItems(g, S);
  const C = S.canvas('bh-fm', w, h);
  const x = C.getContext('2d');
  x.clearRect(0, 0, w, h);
  for (const it of items) {
    const p = ((t + it.off) % it.period) / it.period;
    const e = ease(p / 0.16) * (1 - ease((p - 0.80) / 0.16));
    if (e <= 0.01) continue;
    const x0 = it.cx - it.p.width / 2 + 0.006 * w * Math.sin(0.9 * t + it.fl);
    const y0 = it.cy - it.p.height / 2 + 0.004 * h * Math.sin(0.7 * t + it.fl * 1.7) - (1 - e) * 0.01 * h;
    x.globalAlpha = e;
    x.drawImage(it.p, x0, y0);
  }
  x.globalAlpha = 1;
  // In the chalk's colour; nothing over the person (the pack's A * (1 - clip(m * 1.15)) - the mask taken twice).
  x.globalCompositeOperation = 'source-in';
  x.fillStyle = css(col.chalk);
  x.fillRect(0, 0, w, h);
  if (P) { x.globalCompositeOperation = 'destination-out'; x.drawImage(P.mask, 0, 0); x.drawImage(P.mask, 0, 0); }
  x.globalCompositeOperation = 'source-over';
  g.save();
  g.globalAlpha = 0.92;
  g.drawImage(C, 0, 0);
  g.restore();
}

// ── Green screen ────────────────────────────────────────────────────────────
// A green curtain behind the person, then from 1.1 s a sunset sky with a city skyline opens from the bottom in an arc. The pack's 2.05 s.
const _gsCache = _cache(4);
/** The curtain: folds across (two waves), darker to the sides and towards the floor. */
function _curtain(w, h) {
  return _gsCache('c|' + w + 'x' + h, () => {
    const W = Math.max(1, Math.round(w)), H = Math.max(1, Math.round(h));
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const x = c.getContext('2d');
    const id = x.createImageData(W, H);
    const row = new Float32Array(W * 3);
    for (let i = 0; i < W; i++) {
      const fold = 0.5 + 0.5 * Math.cos(2 * Math.PI * i / (0.082 * W)) * 0.6 + 0.2 * Math.cos(2 * Math.PI * i / (0.041 * W) + 1.0);
      const side = 1 - 0.22 * Math.abs(i / W - 0.5) * 2;
      row[i * 3] = (22 + 22 * fold) * side; row[i * 3 + 1] = (120 + 70 * fold) * side; row[i * 3 + 2] = (55 + 22 * fold) * side;
    }
    for (let j = 0; j < H; j++) {
      const v = 1 - 0.2 * Math.max(0, Math.min(1, j / Math.max(1, H - 1) - 0.55));
      for (let i = 0; i < W; i++) {
        const q = (j * W + i) * 4;
        id.data[q] = row[i * 3] * v; id.data[q + 1] = row[i * 3 + 1] * v; id.data[q + 2] = row[i * 3 + 2] * v; id.data[q + 3] = 255;
      }
    }
    x.putImageData(id, 0, 0);
    return c;
  });
}
/** The sky: deep blue to violet to orange at the horizon; dark buildings with lit windows and a tower. */
function _skyline(w, h) {
  return _gsCache('s|' + w + 'x' + h, () => {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h));
    const x = c.getContext('2d');
    const gr = x.createLinearGradient(0, 0, 0, h);
    for (const [p, rgb] of [[0, [28, 52, 205]], [0.30, [40, 62, 215]], [0.50, [110, 75, 205]], [0.62, [200, 90, 150]], [0.70, [240, 110, 95]], [0.80, [250, 140, 70]], [1, [250, 140, 70]]]) gr.addColorStop(p, css(rgb));
    x.fillStyle = gr;
    x.fillRect(0, 0, w, h);
    const rnd = rngOf('skyline');
    const base = 0.93 * h, dark = css([10, 10, 14]), lit = css([255, 110, 60]);
    let bx = -0.02 * w;
    while (bx < w) {
      const bw = rnd.range(0.07, 0.14) * w, bh = rnd.range(0.28, 0.62) * h;
      const y0 = base - bh;
      x.fillStyle = dark;
      x.fillRect(bx, y0, bw, h - y0);
      if (rnd() < 0.4) x.fillRect(bx + bw * 0.2, y0 - 0.012 * h, bw * 0.6, 0.012 * h);
      const cols = Math.max(2, Math.floor(bw / (0.022 * w)));
      const rows = Math.floor(bh / (0.026 * h));
      x.fillStyle = lit;
      for (let ci = 0; ci < cols; ci++) {
        for (let ry = 0; ry < rows; ry++) {
          if (rnd() < 0.38) {
            const wx = bx + bw * (ci + 0.5) / cols, wy = y0 + 0.015 * h + ry * 0.026 * h;
            x.fillRect(wx - 0.003 * w, wy - 0.003 * w, 0.006 * w, 0.006 * w);
          }
        }
      }
      bx += bw + rnd.range(0, 0.012) * w;
    }
    const tx = 0.69 * w;
    x.fillStyle = dark;
    x.fillRect(tx - 0.006 * w, 0.18 * h, 0.012 * w, 0.20 * h);
    x.beginPath(); x.ellipse(tx, 0.38 * h, 0.03 * w, 0.012 * h, 0, 0, 2 * Math.PI); x.fill();
    x.fillRect(tx - 0.012 * w, 0.38 * h, 0.024 * w, 0.08 * h);
    x.fillRect(tx - 0.05 * w, 0.46 * h, 0.10 * w, base - 0.46 * h);
    x.fillRect(0, base, w, h - base);
    return c;
  });
}
function greenscreen(g, S) {
  const { w, h } = S;
  const t = S.tau;
  if (t > 2.05) return;
  const k = smooth(0, 0.1, t) * (1 - smooth(1.85, 2.05, t));
  const P = S.person();
  const r = t > 1.1 ? ease(clamp01((t - 1.1) / 0.32)) * 1.45 * h : 0;
  _lay(g, S, k, (y) => {
    y.drawImage(_curtain(w, h), 0, 0, w, h);
    if (r > 0) {
      y.save();
      y.beginPath();
      y.arc(0.5 * w, 1.05 * h, r, 0, 2 * Math.PI);
      y.clip();
      y.drawImage(_skyline(w, h), 0, 0, w, h);
      y.restore();
    }
    if (P) y.drawImage(P.cut, 0, 0);
  });
}

// ── The sticker's outline (Green background, Paper cutout) ──────────────────
/** The person's mask grown into a sticker's outline (kit.js grow) - a canvas w x h of colour `rgb` - or null without the person. */
function _sticker(S, P, id, r, wob, cells, seed, rgb) {
  if (!P) return null;
  const { w, h } = S;
  const C = S.canvas('bh-st-' + id, w, h);
  const x = C.getContext('2d');
  x.clearRect(0, 0, w, h);
  x.filter = grow(id, r, w, wob, cells, seed);
  x.drawImage(P.mask, 0, 0);
  x.filter = 'none';
  x.globalCompositeOperation = 'source-in';
  x.fillStyle = css(rgb);
  x.fillRect(0, 0, w, h);
  x.globalCompositeOperation = 'source-over';
  return C;
}
/** A shape `sh` (a canvas of its alpha) as a shadow in `rgb`: moved by dx, dy, blurred, at `alpha`. */
function _shapeShadow(y, S, sh, dx, dy, blur, alpha, rgb = BLACK) {
  if (!sh || !(alpha > 0.003)) return;
  const C = S.canvas('bh-shd', S.w, S.h);
  const x = C.getContext('2d');
  x.clearRect(0, 0, S.w, S.h);
  x.drawImage(sh, 0, 0);
  x.globalCompositeOperation = 'source-in';
  x.fillStyle = css(rgb);
  x.fillRect(0, 0, S.w, S.h);
  x.globalCompositeOperation = 'source-over';
  y.save();
  y.filter = `blur(${Math.max(0.5, blur).toFixed(2)}px)`;
  y.globalAlpha = Math.min(1, alpha);
  y.drawImage(C, dx, dy);
  y.restore();
}

// ── Green background ────────────────────────────────────────────────────────
// A bright green background - dots, faint diagonal stripes in two corners, soft lights drifting over it -, rounded frames growing
// from the middle, tracking marks with their X / Y, and the person a sticker with a white wavy outline. The pack's 2.1 s.
const _gbCache = _cache(4);
function _greenBase(w, h, rgb) {
  return _gbCache(`${w}x${h}|${rgb.join(',')}`, () => {
    const W = Math.max(1, Math.round(w)), H = Math.max(1, Math.round(h));
    const u = W / 1080;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const x = c.getContext('2d');
    const top = mixRgb(rgb, WHITE, 0.10), bot = mixRgb(rgb, BLACK, 0.10);
    const id = x.createImageData(W, H);
    const rnd = rngOf('greenbg-noise');
    for (let j = 0; j < H; j++) {
      const v = j / H;
      const r0 = top[0] + (bot[0] - top[0]) * v, g0 = top[1] + (bot[1] - top[1]) * v, b0 = top[2] + (bot[2] - top[2]) * v;
      for (let i = 0; i < W; i++) {
        const n = (rnd() - 0.5) * 10.4;
        const q = (j * W + i) * 4;
        id.data[q] = r0 + n; id.data[q + 1] = g0 + n; id.data[q + 2] = b0 + n; id.data[q + 3] = 255;
      }
    }
    x.putImageData(id, 0, 0);
    // The dots, every 34 u, a row in two shifted by half.
    x.fillStyle = css(WHITE, 0.18);
    const step = 34 * u;
    for (let j = 0; j * step < H + step; j++) {
      for (let i = 0; i * step < W + step; i++) {
        x.beginPath(); x.arc(i * step + (j % 2 ? step / 2 : 0), j * step, 1.5 * u, 0, 2 * Math.PI); x.fill();
      }
    }
    // Faint dark stripes in the top-left and bottom-right corners.
    const lam = 0.55 / (1 / (W * W) + 1 / (H * H));
    for (const corner of [0, 1]) {
      const L = _canvas('gb-st', W, H);
      const y = L.getContext('2d');
      y.clearRect(0, 0, W, H);
      y.strokeStyle = css([0, 90, 0]);
      y.lineWidth = 5 * u;
      y.beginPath();
      for (let k = -40; k < 60; k++) {
        const x0 = k * 22 * u;
        if (!corner) { y.moveTo(x0, 0); y.lineTo(x0 - 0.30 * H, 0.30 * H); } else { y.moveTo(W - x0, H); y.lineTo(W - x0 + 0.30 * H, H - 0.30 * H); }
      }
      y.stroke();
      const p0 = corner ? [W, H] : [0, 0];
      const p1 = corner ? [W - lam / W, H - lam / H] : [lam / W, lam / H];
      const gr = y.createLinearGradient(p0[0], p0[1], p1[0], p1[1]);
      gr.addColorStop(0, 'rgba(0,0,0,1)');
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      y.globalCompositeOperation = 'destination-in';
      y.fillStyle = gr;
      y.fillRect(0, 0, W, H);
      y.globalCompositeOperation = 'source-over';
      x.save();
      x.globalAlpha = 0.16;
      x.drawImage(L, 0, 0);
      x.restore();
    }
    return c;
  });
}
const MARKS = [[0.13, 0.27, 0.00], [0.87, 0.36, 0.12], [0.12, 0.60, 0.24], [0.88, 0.69, 0.36]];
function greenbg(g, S) {
  const { w, h, u, col } = S;
  const t = S.tau;
  if (t > 2.1) return;
  const k = smooth(0, 0.14, t) * (1 - smooth(1.88, 2.1, t));
  if (k <= 0.002) return;
  const P = S.person();
  const st = _sticker(S, P, 'gb', 0.018 * w, 0.0045 * w, 11, Math.floor(t * 9), col.outline);
  _lay(g, S, k, (y) => {
    y.drawImage(_greenBase(w, h, col.bg), 0, 0, w, h);
    // Soft lights drifting over the green.
    y.save();
    y.globalCompositeOperation = 'lighter';
    [[0.25, 0.22, 0.34], [0.80, 0.55, 0.40], [0.35, 0.88, 0.32]].forEach(([bx, by, br], i) => {
      const px = (bx + 0.05 * Math.sin(0.8 * t + i * 2)) * w, py = (by + 0.04 * Math.cos(0.7 * t + i)) * h;
      const R0 = br * w;
      const gr = y.createRadialGradient(px, py, 0, px, py, 1.6 * R0);
      for (let q = 0; q <= 8; q++) { const rr = q / 8 * 1.6; gr.addColorStop(q / 8, css(WHITE, 0.22 * Math.exp(-1.6 * rr * rr))); }
      y.fillStyle = gr;
      y.fillRect(px - 1.6 * R0, py - 1.6 * R0, 3.2 * R0, 3.2 * R0);
    });
    y.restore();
    // Rounded frames growing from the middle and fading.
    for (let j = 0; j < 3; j++) {
      const ph = (t * 0.45 + j / 3) % 1;
      const sc = 0.30 + 0.85 * ph;
      const fw = 0.90 * w * sc, fh = 0.52 * h * sc;
      rrect(y, w / 2 - fw / 2, 0.47 * h - fh / 2, fw, fh, 0.07 * w * sc);
      y.lineWidth = 3.5 * u;
      y.strokeStyle = css(WHITE, Math.pow(Math.sin(Math.PI * ph), 1.3) * 0.34);
      y.stroke();
    }
    // The tracking marks.
    MARKS.forEach(([mx, my, t0], i) => {
      const life = backOut(clamp01((t - 0.15 - t0) / 0.28));
      if (life <= 0.02) return;
      const x = (mx + 0.008 * Math.sin(2.2 * t + i * 1.7)) * w, yy = (my + 0.006 * Math.cos(1.9 * t + i)) * h;
      const r = 0.020 * w * life;
      y.save();
      y.strokeStyle = css(WHITE, 0.92);
      y.lineWidth = Math.max(2, 2.5 * u);
      y.beginPath(); y.arc(x, yy, r, 0, 2 * Math.PI); y.stroke();
      y.beginPath();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { y.moveTo(x + dx * r * 1.15, yy + dy * r * 1.15); y.lineTo(x + dx * r * 2.0, yy + dy * r * 2.0); }
      y.stroke();
      y.restore();
      const fsz = 0.0185 * w;
      text(y, `X${(x / w).toFixed(2)} Y${(yy / h).toFixed(2)}`, x, yy + r * 3.1, { font: font(fsz, 700), color: WHITE, align: 'center', alpha: clamp01(life), spacing: 0.04 * fsz });
    });
    // The sticker: its shadow, its white outline, the person on it.
    if (st) {
      _shapeShadow(y, S, st, 0.004 * w, 0.008 * w, 0.007 * w, 0.26, [10, 70, 10]);
      y.drawImage(st, 0, 0);
    }
    if (P) y.drawImage(P.cut, 0, 0);
  });
}

// ── Paper cutout ────────────────────────────────────────────────────────────
// The person cut out with scissors - a sticker with a white outline - on light paper: a torn strip behind the head, a big dark disc,
// a star, two dots, a white bar, each piece with its shadow lying on the table; the paper shifts a little every 0.1 s (stop-motion).
// The pack's 1.87 s.
const _ppCache = _cache(6);
/** The paper's grain as a gain about 1: soft mottling at three scales and a fine grain (the pack's _paper_gain, without its fibres). */
function _paperGain(W, H) {
  return _ppCache('gain|' + W + 'x' + H, () => {
    const rnd = rngOf('paper-gain');
    // The three mottlings added up on a quarter-size grid (they are soft), then read off it for every pixel with the grain.
    const qw = Math.max(2, Math.ceil(W / 4)), qh = Math.max(2, Math.ceil(H / 4));
    const q = new Float32Array(qw * qh);
    for (const [frac, amp] of [[0.02, 0.016], [0.07, 0.012], [0.30, 0.008]]) {
      const gw = Math.max(2, Math.round(W * frac)), gh = Math.max(2, Math.round(H * frac));
      const grid = new Float32Array(gw * gh);
      for (let i = 0; i < grid.length; i++) grid[i] = rnd.normal();
      for (let j = 0; j < qh; j++) {
        const fy = j / qh * (gh - 1), y0 = Math.floor(fy), y1 = Math.min(gh - 1, y0 + 1), ky = fy - y0;
        for (let i = 0; i < qw; i++) {
          const fx = i / qw * (gw - 1), x0 = Math.floor(fx), x1 = Math.min(gw - 1, x0 + 1), kx = fx - x0;
          const a = grid[y0 * gw + x0] + (grid[y0 * gw + x1] - grid[y0 * gw + x0]) * kx;
          const b = grid[y1 * gw + x0] + (grid[y1 * gw + x1] - grid[y1 * gw + x0]) * kx;
          q[j * qw + i] += (a + (b - a) * ky) * amp;
        }
      }
    }
    const out = new Float32Array(W * H);
    for (let j = 0; j < H; j++) {
      const fy = Math.min(qh - 1.001, j / 4), y0 = Math.floor(fy), ky = fy - y0;
      const dy = j / H - 0.5;
      for (let i = 0; i < W; i++) {
        const fx = Math.min(qw - 1.001, i / 4), x0 = Math.floor(fx), kx = fx - x0;
        const a = q[y0 * qw + x0] + (q[y0 * qw + x0 + 1] - q[y0 * qw + x0]) * kx;
        const b = q[(y0 + 1) * qw + x0] + (q[(y0 + 1) * qw + x0 + 1] - q[(y0 + 1) * qw + x0]) * kx;
        const dx = i / W - 0.5;
        out[j * W + i] = 1 + a + (b - a) * ky + (rnd() - 0.5) * 0.12 - 0.10 * (dx * dx + dy * dy) / 0.5;
      }
    }
    return out;
  });
}
/** Smooth random of `n` values from `m` knots (the pack's cubic resize of a short normal row), plus a jagged part. */
function _tornEdge(rnd, n, amp) {
  const knots = Array.from({ length: 14 }, () => rnd.normal() * amp * 0.5);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const f = i / (n - 1) * 13, k = Math.min(12, Math.floor(f)), r = f - k;
    const p0 = knots[Math.max(0, k - 1)], p1 = knots[k], p2 = knots[k + 1], p3 = knots[Math.min(13, k + 2)];
    const v = 0.5 * ((2 * p1) + (-p0 + p2) * r + (2 * p0 - 5 * p1 + 4 * p2 - p3) * r * r + (-p0 + 3 * p1 - 3 * p2 + p3) * r * r * r);
    out[i] = v + rnd.normal() * amp * 0.22;
  }
  return out;
}
/** The paper with its pieces for stop-motion frame `v` (0-2): a canvas w x h. */
function _paperBg(w, h, v, col) {
  const W = Math.max(1, Math.round(w)), H = Math.max(1, Math.round(h));
  return _ppCache(`bg|${W}x${H}|${v}|${col.paper.join()}|${col.shapes.join()}|${col.outline.join()}`, () => {
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const x = c.getContext('2d');
    const rnd = rngOf('paper', v);
    const j = (a) => a + rnd.range(-1, 1) * 0.0035 * W;
    x.fillStyle = css(col.paper);
    x.fillRect(0, 0, W, H);
    // One piece of paper: its two shadows (a tight dark one and a wide soft one), its colour, a slightly darker cut edge.
    const piece = (path, rgb, lift = 1, shadowed = true) => {
      if (shadowed) {
        for (const [dx, dy, bl, a] of [[0.0012 * W, 0.0022 * W, 0.0018 * W, 0.34], [0.006 * W * lift, 0.012 * W * lift, 0.011 * W * lift, 0.20]]) {
          x.save();
          x.filter = `blur(${Math.max(0.6, bl).toFixed(2)}px)`;
          x.translate(dx, dy);
          path(x);
          x.fillStyle = css(BLACK, a);
          x.fill();
          x.restore();
        }
      }
      path(x);
      x.fillStyle = css(rgb);
      x.fill();
      x.save();
      path(x);
      x.clip();
      x.filter = 'blur(0.8px)';
      x.lineWidth = 2;
      x.strokeStyle = css(BLACK, 0.18);
      x.stroke();
      x.restore();
    };
    const disk = (cx, cy, r) => (y) => { y.beginPath(); y.arc(cx, cy, r, 0, 2 * Math.PI); };
    // A torn strip behind the head: a white core with both long edges wobbly, its coloured top layer torn a little short of it.
    const n = 120, ang = (-6 + rnd.range(-0.6, 0.6)) * R, yc = 0.455 * H, thick = 0.070 * H;
    const xs = Array.from({ length: n }, (_, i) => -0.08 * W + 1.16 * W * i / (n - 1));
    const base = xs.map((xx) => yc + (xx - 0.5 * W) * Math.tan(ang));
    const e1 = _tornEdge(rnd, n, 0.0035 * H), e2 = _tornEdge(rnd, n, 0.0035 * H);
    const e3 = _tornEdge(rnd, n, 0.004 * H), e4 = _tornEdge(rnd, n, 0.004 * H);
    const band = (topOf, botOf) => (y) => {
      y.beginPath();
      xs.forEach((xx, i) => (i ? y.lineTo(xx, topOf(i)) : y.moveTo(xx, topOf(i))));
      for (let i = n - 1; i >= 0; i--) y.lineTo(xs[i], botOf(i));
      y.closePath();
    };
    piece(band((i) => base[i] - thick / 2 + e1[i], (i) => base[i] + thick / 2 + e2[i]), col.outline, 0.8);
    piece(band((i) => base[i] - thick / 2 + 0.0055 * H + e3[i], (i) => base[i] + thick / 2 - 0.0055 * H + e4[i]), mixRgb(col.shapes, col.paper, 0.04), 1, false);
    // A big disc, a small star, two dots, one white bar.
    piece(disk(j(0.795 * W), j(0.255 * H), 0.195 * W), col.shapes, 1.2);
    const sx = j(0.108 * W), sy = j(0.283 * H);
    piece((y) => _star(y, sx, sy, 0.075 * W, 0.30), col.shapes);
    piece(disk(j(0.075 * W), j(0.585 * H), 0.030 * W), mixRgb(col.shapes, col.paper, 0.57), 0.7);
    piece(disk(j(0.915 * W), j(0.60 * H), 0.018 * W), col.shapes, 0.7);
    const bang = (-9 + rnd.range(-0.7, 0.7)) * R, bcx = j(0.16 * W), bcy = j(0.70 * H);
    piece((y) => { y.beginPath(); const ca = Math.cos(bang), sa = Math.sin(bang), hw = 0.29 * W, hh = 0.017 * H;
      _poly(y, [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([px, py]) => [bcx + px * ca - py * sa, bcy + px * sa + py * ca])); }, col.outline, 0.8);
    // The paper's grain over all of it.
    const gain = _paperGain(W, H);
    const id = x.getImageData(0, 0, W, H);
    for (let i = 0, q = 0; i < gain.length; i++, q += 4) {
      const k = gain[i];
      id.data[q] = id.data[q] * k; id.data[q + 1] = id.data[q + 1] * k; id.data[q + 2] = id.data[q + 2] * k;
    }
    x.putImageData(id, 0, 0);
    return c;
  });
}
function papercutout(g, S) {
  const { w, h, col } = S;
  const t = S.tau;
  if (t > 1.87) return;
  const k = smooth(0, 0.1, t) * (1 - smooth(1.75, 1.87, t));
  if (k <= 0.002) return;
  const v = Math.floor(t * 10) % 3;
  const P = S.person();
  const st = _sticker(S, P, 'pp', 0.026 * w, 0.0073 * w, 5, 300 + v, col.outline);
  _lay(g, S, k, (y) => {
    y.drawImage(_paperBg(w, h, v, col), 0, 0, w, h);
    if (st) {
      _shapeShadow(y, S, st, 0.0012 * w, 0.0022 * w, 0.0018 * w, 0.34);
      _shapeShadow(y, S, st, 0.006 * w, 0.012 * w, 0.011 * w, 0.20);
      y.drawImage(st, 0, 0);
    }
    if (P) y.drawImage(P.cut, 0, 0);
  });
}

// ── Mix ─────────────────────────────────────────────────────────────────────
// Black and white; diagonal slats of the colour picture - the SAME picture slid along the diagonal - close in from both sides with a
// soft shadow on the grey; the person's silhouette fills white, a flash, and the colour comes back. The pack's 4.2 s, by frames of 30.
const MIX_U1 = [[9, 560], [14, 460], [21, 410], [28, 365], [35, 325], [42, 285], [49, 235], [56, 175], [63, 168], [70, 162], [77, 156], [84, 150], [91, 145], [98, 140]];
const MIX_U2 = [[22, -460], [24, -440], [28, -380], [35, -300], [42, -240], [49, -190], [56, -150], [63, -154], [70, -158], [77, -162], [84, -166], [98, -172]];
const GREY = [[0.299, 0.587, 0.114, 0], [0.299, 0.587, 0.114, 0], [0.299, 0.587, 0.114, 0]];
function mix(g, S) {
  const { w, h } = S;
  const f = S.tau * 30;
  if (f >= 130) return;
  const pic = S.picture();
  const P = f >= 96 ? S.person() : null;
  const k = w / 540;
  const sl = 0.463;                       // the diagonal: u = (x - 0.463 y) / k
  // The picture in black and white.
  g.save();
  g.clearRect(0, 0, w, h);
  g.filter = matrix('mix-grey', GREY);
  g.drawImage(pic, 0, 0);
  g.restore();
  // The half-plane of u above (side 1) or below (side -1) u0, as a path.
  const half = (y, u0, side) => {
    const c = u0 * k, big = 4 * (w + h);
    y.beginPath();
    if (side > 0) _poly(y, [[c, 0], [c + big, 0], [c + sl * h + big, h], [c + sl * h, h]]);
    else _poly(y, [[c, 0], [c - big, 0], [c + sl * h - big, h], [c + sl * h, h]]);
  };
  if (f >= 9) {
    const u1 = kf(f, MIX_U1), u2 = f >= 22 ? kf(f, MIX_U2) : -1e6;
    for (const [u0, side, dx, dy] of [[u1, 1, 0.154 * w, -0.164 * h], [u2, -1, -0.157 * w, 0.162 * h]]) {
      if (u0 < -1e5) continue;
      g.save();
      half(g, u0, side);
      g.clip();
      _shifted(g, pic, dx, dy, w, h);
      g.restore();
      // The slat's soft shadow on the grey: 0.32 at its edge, gone 22 units (of 540 px) in.
      g.save();
      half(g, u0, -side);
      g.clip();
      const lam = -side * 22 * k / (1 + sl * sl);
      const gr = g.createLinearGradient(u0 * k, 0, u0 * k + lam, -sl * lam);
      gr.addColorStop(0, css(BLACK, 0.32));
      gr.addColorStop(1, css(BLACK, 0));
      g.fillStyle = gr;
      g.fillRect(0, 0, w, h);
      g.restore();
    }
  }
  if (f >= 96) {
    // The person of the slid copy fills white.
    const a = ease((f - 96) / 14);
    if (P && a > 0.003) {
      const C = S.canvas('bh-mix', w, h);
      const x = C.getContext('2d');
      x.clearRect(0, 0, w, h);
      x.drawImage(P.mask, -0.157 * w, 0.162 * h);
      x.globalCompositeOperation = 'source-in';
      x.fillStyle = '#ffffff';
      x.fillRect(0, 0, w, h);
      x.globalCompositeOperation = 'source-over';
      g.save();
      g.globalAlpha = a;
      g.drawImage(C, 0, 0);
      g.restore();
    }
    const fl = ease((f - 111) / 6);
    if (fl > 0.003) { g.save(); g.fillStyle = css(WHITE, fl); g.fillRect(0, 0, w, h); g.restore(); }
    if (f >= 118) {
      g.save();
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, w, h);
      g.globalAlpha = ease((f - 118) / 9);
      g.drawImage(pic, 0, 0);
      g.restore();
    }
  }
}

/** Every effect of this module by its effect's `draw` key. */
export const BEHIND = { orbit, iconsaround, headlinestorm, headlinestorm2, formulas, greenscreen, greenbg, papercutout, mix };
