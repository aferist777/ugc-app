/* ═══════════════════════════════════════════════════════════════════════════
   THE OVERLAYS (phase V84 block 4b, the owner 2026-11-11, (б4-1)-(б4-13)) - graphics drawn over a clip's picture: Sparkle, Rainbow
   glow, Color frame, Frame break, Digital zoom's viewfinder. video-effects-pack's scenes (MIT; its numbers and timings, written
   again for the canvas) - drawn by the PAGE ONLY: live by the preview, baked for the render by the app's window with this very code
   (js/merge-v3/fx-draw.js applyFx, the last step; lib/fx-bake.js). Each is draw(g, S):
     g   a 2D context set up on the clip's WINDOW (js/fx/box.js windowOf - the frame for main video, an insert's own rectangle with
         its turn, the owner's (б4-11)): (0, 0) its top-left corner, clipped to it
     S   { w, h - the window's size, u - its width / 1080 (the pack's pixels), tau - the effect's own time (an 'intro' stretched to its
         length), live - seconds since it began, e - the effect (its id seeds every random), col - its colours [r, g, b] by key,
         opt - its settings by key (js/fx/effects.js colorsOf / optsOf), canvas(name, w, h) - a scratch canvas,
         toBox(x, y) - a point of the frame (pixels) in the window, W, H - the frame }
   ═══════════════════════════════════════════════════════════════════════════ */

import { rngOf, css, mixRgb, clamp01, ease, smooth, backOut, rrPath, rrect, font } from './kit.js';
import { faceAt, dzoomAt } from './effects.js';

const WHITE = [255, 255, 255];
const INK = [26, 26, 28];

/** HSV (h in degrees, s and v 0..1) -> [r, g, b] (OpenCV's HSV2BGR, as the pack's rainbow). */
function hsv(h, s, v) {
  const hh = (((h % 360) + 360) % 360) / 60;
  const c = v * s, x = c * (1 - Math.abs((hh % 2) - 1)), m = v - c;
  const [r, g, b] = hh < 1 ? [c, x, 0] : hh < 2 ? [x, c, 0] : hh < 3 ? [0, c, x] : hh < 4 ? [0, x, c] : hh < 5 ? [x, 0, c] : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

// ── Sparkle ─────────────────────────────────────────────────────────────────
// 62 white four-ray sparkles (Amount), each twinkling on a period of its own (0.28-0.9 s) at a new place every time: a soft core and
// two rays fading out, added to the picture (the pack's sparkle: `img + layer`).
function sparkle(g, S) {
  const { w, h, u, e, col, opt } = S;
  const t = S.live;
  const c = col.spark;
  const N = Math.round(opt.amount);
  const th = 1.65 * u;
  g.save();
  g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < N; i++) {
    const r1 = rngOf(e.id, 'sp', i);
    const period = r1.range(0.28, 0.9), off = r1.range(0, period);
    const q = (t + off) / period;
    const n = Math.floor(q);
    const env = Math.pow(Math.max(0, Math.sin(Math.PI * (q - n))), 1.2);
    if (env < 0.03) continue;
    const r2 = rngOf(e.id, 'sp', i, n);
    const x = r2.range(0, w), y = r2.range(0, h);
    const size = Math.exp(r2.range(Math.log(0.7), Math.log(3.6))) * u * opt.size;
    const ray = size * (r2() < 0.30 ? r2.range(9, 18) : r2.range(2.5, 5.5));
    // The core: 1.4 x a Gaussian of 0.55 its size, clipped at 1.
    const sg = 0.55 * size;
    const core = g.createRadialGradient(x, y, 0, x, y, 3 * sg);
    for (const k of [0, 0.5, 1, 1.5, 2, 2.5, 3]) core.addColorStop(k / 3, css(c, env * Math.min(1, 1.4 * Math.exp(-k * k / 2))));
    g.fillStyle = core;
    g.fillRect(x - 3 * sg, y - 3 * sg, 6 * sg, 6 * sg);
    // The rays: 0.9 x exp(-|d| / 0.55 ray) along, thin across.
    const L = 3 * 0.55 * ray;
    for (const vert of [false, true]) {
      const lg = vert ? g.createLinearGradient(x, y - L, x, y + L) : g.createLinearGradient(x - L, y, x + L, y);
      for (const k of [0, 0.5, 1, 1.5, 2, 2.5, 3]) {
        const a = css(c, env * 0.9 * Math.exp(-k));
        lg.addColorStop(0.5 - k / 6, a);
        lg.addColorStop(0.5 + k / 6, a);
      }
      g.fillStyle = lg;
      if (vert) g.fillRect(x - th / 2, y - L, th, 2 * L);
      else g.fillRect(x - L, y - th / 2, 2 * L, th);
    }
  }
  g.restore();
}

// ── Rainbow glow ────────────────────────────────────────────────────────────
// A diagonal rainbow along the window's edges, turning 288 degrees a second (Speed), laid by `screen` (the pack measured it so:
// d + a·c·(1 - d) - the canvas's screen with an alpha is exactly that). The glow: 0.97·exp(-d / L) from each edge, the two edges'
// added as 1 - (1 - a)(1 - b) (Width - L, Strength - its alpha).
const _masks = new Map();
function _edgeMask(w, h, width) {
  const key = Math.round(w) + 'x' + Math.round(h) + '|' + width.toFixed(3);
  let cv = _masks.get(key);
  if (cv) return cv;
  if (_masks.size > 8) _masks.clear();
  const W = Math.max(1, Math.round(w)), H = Math.max(1, Math.round(h));
  const strip = (n, len) => {
    const s = document.createElement('canvas');
    s.width = n; s.height = 1;
    const sg = s.getContext('2d');
    const img = sg.createImageData(n, 1);
    for (let i = 0; i < n; i++) img.data[i * 4 + 3] = Math.round(255 * 0.97 * Math.exp(-Math.min(i, n - 1 - i) / len));
    sg.putImageData(img, 0, 0);
    return s;
  };
  cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const m = cv.getContext('2d');
  m.drawImage(strip(W, 0.0444 * W * width), 0, 0, W, H);
  // The other way: a strip turned.
  const v = strip(H, 0.048 * H * width);
  m.save();
  m.translate(W, 0);
  m.rotate(Math.PI / 2);
  m.drawImage(v, 0, 0, H, W);
  m.restore();
  _masks.set(key, cv);
  return cv;
}
function rainbow(g, S) {
  const { w, h, opt } = S;
  const R = S.canvas('rb', w, h);
  const r = R.getContext('2d');
  r.setTransform(w, 0, 0, h, 0, 0);
  // Along x/w - y/h (-1 at the bottom-left corner, 1 at the top-right): the hue 236 + 288·t·speed + 360·that.
  const grad = r.createLinearGradient(0, 1, 1, 0);
  const base = 236 + 288 * S.live * (opt.speed != null ? opt.speed : 1);
  const STOPS = 48;
  for (let i = 0; i <= STOPS; i++) grad.addColorStop(i / STOPS, css(hsv(base + 360 * (-1 + 2 * i / STOPS), 235 / 255, 1)));
  r.fillStyle = grad;
  r.fillRect(0, 0, 1, 1);
  r.setTransform(1, 0, 0, 1, 0, 0);
  r.globalCompositeOperation = 'destination-in';
  r.drawImage(_edgeMask(w, h, opt.width), 0, 0, R.width, R.height);
  r.globalCompositeOperation = 'source-over';
  g.save();
  g.globalCompositeOperation = 'screen';
  for (let k = opt.strength; k > 0.001; k -= 1) {
    g.globalAlpha = Math.min(1, k);
    g.drawImage(R, 0, 0);
  }
  g.restore();
}

// ── Color frame ─────────────────────────────────────────────────────────────
// A thin frame of light pops up inside the window (4.5 % and 2.7 % in, corners 7.5 % of its width): its colour flows round
// through three shades (Speed), a bright comet runs round it, a soft halo out and in (Glow); 0.85 % of the width thick (Width).
const _paths = new Map();
function _framePts(w, h) {
  const key = Math.round(w) + 'x' + Math.round(h);
  let p = _paths.get(key);
  if (p) return p;
  if (_paths.size > 8) _paths.clear();
  const mx = 0.045 * w, my = 0.027 * h;
  p = rrPath(mx, my, w - mx, h - my, 0.075 * w, Math.max(2, 3 * w / 1080));
  _paths.set(key, p);
  return p;
}
/** The frame's colour at `s` of the way round, its colours flowing by `phase`. */
function _cfCol(s, acc, phase) {
  const x = (((s + phase) % 1) + 1) % 1 * acc.length;
  const i = Math.floor(x) % acc.length;
  let f = x - Math.floor(x);
  f = f * f * (3 - 2 * f);
  return mixRgb(acc[i], acc[(i + 1) % acc.length], f);
}
// The frame's three colours: Color 1 - 3 (by default #FF5A36 and its lighter and darker shades - the pack's one-accent rule).
const _frameCols = (col) => [col.c1, col.c2, col.c3];
/** A blurred copy of `src` laid on `f` at strength `k` (over 1: again). */
function _halo(f, src, sigma, k) {
  f.save();
  f.filter = `blur(${Math.max(0.5, sigma).toFixed(2)}px)`;
  for (let a = k; a > 0.001; a -= 1) { f.globalAlpha = Math.min(1, a); f.drawImage(src, 0, 0); }
  f.restore();
}
function _cfDraw(g, S, t, pop, op) {
  const { w, h, u, opt } = S;
  const acc = _frameCols(S.col);
  const pts = _framePts(w, h);
  const n = pts.length;
  const sc = 0.94 + 0.06 * Math.min(1, pop);
  const th = 0.0085 * w * opt.width;
  const ph = t * 0.30 * (opt.speed != null ? opt.speed : 1);
  const head = ((t * 0.55 * (opt.speed != null ? opt.speed : 1)) % 1 + 1) % 1;
  const O = S.canvas('cfo', w, h);
  const o = O.getContext('2d');
  const C = S.canvas('cfc', w, h);
  const cm = C.getContext('2d');
  for (const x of [o, cm]) { x.setTransform(sc, 0, 0, sc, (w / 2) * (1 - sc), (h / 2) * (1 - sc)); x.lineCap = 'round'; }
  const STEP = Math.max(1, Math.round(n / 220));
  o.lineWidth = th;
  for (let i = 0; i < n; i += STEP) {
    const a = pts[i], b = pts[(i + STEP) % n];
    const cl = _cfCol(a.s, acc, ph);
    o.strokeStyle = css(cl);
    o.beginPath(); o.moveTo(a.x, a.y); o.lineTo(b.x, b.y); o.stroke();
    // The comet: 13 % of the way round behind its head, whiter and thicker towards it.
    const dd = (((head - a.s) % 1) + 1) % 1;
    if (dd < 0.13) {
      const k = Math.pow(1 - dd / 0.13, 1.6);
      if (k > 0.02) {
        cm.strokeStyle = css(mixRgb(cl, WHITE, 0.85 * k));
        cm.lineWidth = th * (1 + 0.5 * k);
        cm.beginPath(); cm.moveTo(a.x, a.y); cm.lineTo(b.x, b.y); cm.stroke();
      }
    }
  }
  const F = S.canvas('cff', w, h);
  const f = F.getContext('2d');
  _halo(f, O, 0.030 * w, 0.80 * opt.glow);
  _halo(f, O, 0.010 * w, 0.90 * opt.glow);
  f.drawImage(O, 0, 0);
  f.drawImage(C, 0, 0);
  g.save();
  g.globalAlpha = Math.min(1, op);
  g.drawImage(F, 0, 0);
  g.restore();
}
function colorframe(g, S) {
  const t = S.tau;
  const pop = backOut(clamp01(t / 0.2));
  const op = clamp01(t / 0.12) * (1 - smooth(1.6, 1.9, t));
  if (op > 0.01) _cfDraw(g, S, t, pop, op);
}

// ── Frame break ─────────────────────────────────────────────────────────────
// The same frame holds 0.42 s, cracks grow into it, and it shatters: 48 shards of its own colour fly, turn and fall, 70 pieces of
// confetti follow, a ring of light goes out.
const FB_T0 = 0.42;
const _fbs = new Map();
function _fbBuild(S) {
  const { w, h, e, opt } = S;
  const key = e.id + '|' + Math.round(w) + 'x' + Math.round(h) + '|' + opt.width + '|' + S.col.c1 + S.col.c2 + S.col.c3;
  let B = _fbs.get(key);
  if (B) return B;
  if (_fbs.size > 8) _fbs.clear();
  const rnd = rngOf(e.id, 'fb');
  const pts = _framePts(w, h);
  const n = pts.length;
  const th = 0.0085 * w * opt.width * 1.25;
  const acc = _frameCols(S.col);
  const cx = w / 2, cy = h / 2;
  const cuts = [];
  for (let k = 0; k < 48; k++) cuts.push(Math.floor(n * k / 48 + rnd.range(-0.25, 0.25) * n / 48));
  const cs = cuts.map((v) => ((v % n) + n) % n).sort((a, b) => a - b);
  cs.push(cs[0] + n);
  const shards = [];
  for (let gi = 0; gi < cs.length - 1; gi++) {
    const a = cs[gi], b = cs[gi + 1];
    if (b - a < 2) continue;
    const m = Math.min(6, Math.max(2, b - a + 1));
    const ids = [];
    for (let q = 0; q < m; q++) { const id = Math.round(a + (b - a) * q / (m - 1)) % n; if (!ids.includes(id)) ids.push(id); }
    const col = _cfCol(pts[ids[Math.floor(ids.length / 2)]].s, acc, FB_T0 * 0.30 * (opt.speed != null ? opt.speed : 1));
    const outer = ids.map((i) => [pts[i].x + pts[i].nx * th / 2, pts[i].y + pts[i].ny * th / 2]);
    const inner = ids.map((i) => [pts[i].x - pts[i].nx * th / 2, pts[i].y - pts[i].ny * th / 2]).reverse();
    const poly = outer.concat(inner);
    const gx = poly.reduce((s, p) => s + p[0], 0) / poly.length, gy = poly.reduce((s, p) => s + p[1], 0) / poly.length;
    const dl = Math.hypot(gx - cx, gy - cy) || 1;
    const ra = rnd.range(0, 6.283);
    const dx = 0.5 * (gx - cx) / dl + 0.5 * Math.cos(ra), dy = 0.5 * (gy - cy) / dl + 0.5 * Math.sin(ra);
    const sp = rnd.range(0.22, 0.65) * w;
    shards.push({ pc: poly.map((p) => [p[0] - gx, p[1] - gy]), gx, gy, col, vx: dx * sp, vy: dy * sp - 0.22 * h * rnd(),
      wv: rnd.range(-8, 8), ph: rnd.range(0, 6.28), fl: rnd.range(4, 9) });
  }
  const conf = [];
  for (let k = 0; k < 70; k++) {
    const p = pts[Math.floor(rnd() * n) % n];
    const dl = Math.hypot(p.x - cx, p.y - cy) || 1;
    let dx = (p.x - cx) / dl, dy = (p.y - cy) / dl;
    if (rnd() < 0.5) { dx = -dx; dy = -dy; }
    const sp = rnd.range(0.25, 0.8) * w;
    conf.push({ gx: p.x, gy: p.y, vx: dx * sp + rnd.normal() * 0.2 * w, vy: dy * sp + rnd.normal() * 0.2 * w - 0.25 * h * rnd(),
      s: rnd.range(0.008, 0.017) * w, wv: rnd.range(-8, 8), ci: Math.floor(rnd() * 4) % 4, d: rnd.range(0, 0.15) });
  }
  const cracks = [];
  for (let k = 0; k < 11; k++) {
    const p = pts[Math.floor(rnd() * n) % n];
    const ix = -p.nx, iy = -p.ny;
    const line = [[p.x + p.nx * th * 0.6, p.y + p.ny * th * 0.6]];
    let x = p.x, y = p.y;
    for (let q = 0; q < 6; q++) {
      const st = rnd.range(0.012, 0.03) * w, side = rnd.normal() * 0.012 * w;
      x += ix * st - iy * side;
      y += iy * st + ix * side;
      line.push([x, y]);
    }
    cracks.push(line);
  }
  B = { shards, conf, cracks, cols: [acc[0], acc[1], acc[2], WHITE] };
  _fbs.set(key, B);
  return B;
}
function framebreak(g, S) {
  const { w, h, u, opt } = S;
  const t = S.tau;
  const B = _fbBuild(S);
  if (t < FB_T0) {
    const pop = backOut(clamp01(t / 0.2));
    _cfDraw(g, S, t, pop, clamp01(t / 0.12));
    const kc = clamp01((t - 0.22) / 0.20);
    if (kc > 0) {
      const sc = 0.94 + 0.06 * Math.min(1, pop);
      g.save();
      g.setTransform(g.getTransform().multiply(new DOMMatrix([sc, 0, 0, sc, (w / 2) * (1 - sc), (h / 2) * (1 - sc)])));
      g.lineCap = 'round';
      g.lineJoin = 'round';
      for (const cr of B.cracks) {
        const m = Math.max(2, Math.floor(1 + kc * (cr.length - 1)));
        for (const [lw, c] of [[3.2 * u, WHITE], [1.3 * u, INK]]) {
          g.strokeStyle = css(c);
          g.lineWidth = lw;
          g.beginPath();
          cr.slice(0, m).forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])));
          g.stroke();
        }
      }
      g.restore();
    }
    return;
  }
  const tb = t - FB_T0;
  const G = 2.4 * h;
  const fade = 1 - smooth(0.95, 1.32, tb);
  const O = S.canvas('fbo', w, h);
  const o = O.getContext('2d');
  for (const s of B.shards) {
    const px = s.gx + s.vx * tb, py = s.gy + s.vy * tb + 0.5 * G * tb * tb;
    const a = s.wv * tb, sx = Math.cos(s.ph + s.fl * tb), ca = Math.cos(a), sa = Math.sin(a);
    o.fillStyle = css(s.col);
    o.beginPath();
    s.pc.forEach((p, i) => {
      const x = p[0] * sx, y = p[1];
      const X = px + x * ca - y * sa, Y = py + x * sa + y * ca;
      if (i) o.lineTo(X, Y); else o.moveTo(X, Y);
    });
    o.closePath();
    o.fill();
  }
  const Cf = S.canvas('fbc', w, h);
  const cf = Cf.getContext('2d');
  for (const f of B.conf) {
    const te = tb - f.d;
    if (te <= 0) continue;
    const px = f.gx + f.vx * te, py = f.gy + f.vy * te + 0.5 * 0.9 * G * te * te;
    const a = f.wv * te, ca = Math.cos(a), sa = Math.sin(a), fx = Math.cos(3 * te + f.ci);
    cf.fillStyle = css(B.cols[f.ci % 4]);
    cf.beginPath();
    [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([qx, qy], i) => {
      const x = qx * f.s * fx, y = qy * f.s;
      const X = px + x * ca - y * sa, Y = py + x * sa + y * ca;
      if (i) cf.lineTo(X, Y); else cf.moveTo(X, Y);
    });
    cf.closePath();
    cf.fill();
  }
  g.save();
  _halo(g, O, 0.014 * w, 0.85 * fade * opt.glow);
  g.globalAlpha = Math.max(0, fade);
  g.drawImage(O, 0, 0);
  g.drawImage(Cf, 0, 0);
  g.restore();
  const kw = clamp01(tb / 0.55);
  if (kw < 1) {
    g.save();
    g.strokeStyle = css(WHITE, 0.55 * (1 - kw));
    g.lineWidth = Math.max(2, 7 * u * (1 - kw));
    g.beginPath();
    g.arc(w / 2, h / 2, ease(kw) * 0.62 * Math.hypot(w, h), 0, 2 * Math.PI);
    g.stroke();
    g.restore();
  }
}

// ── Digital zoom (its viewfinder - the zoom itself is a move, effects.js dzoomAt) ──────────────────────────────────────────
// Corners, REC with its dot, a running timecode, the zoom read out in a pill, and for a moment a focus box on the eyes (the pack's
// stands at one place; here on the face found).
function digitalzoom(g, S) {
  const { w, h, u, e, col, opt } = S;
  const t = S.tau;
  const env = smooth(0.04, 0.2, t) * (1 - smooth(1.9, 2.05, t));
  if (env < 0.01) return;
  const line = col.lines, acc = col.accent;
  g.save();
  g.globalAlpha = env;
  g.lineCap = 'round';
  g.strokeStyle = css(line);
  g.lineWidth = Math.max(2, 0.004 * w);
  const L = 0.06 * w;
  for (const [x, y, sx, sy] of [[0.058, 0.121, 1, 1], [0.942, 0.121, -1, 1], [0.058, 0.772, 1, -1], [0.942, 0.772, -1, -1]]) {
    const px = x * w, py = y * h;
    g.beginPath();
    g.moveTo(px + sx * L, py);
    g.lineTo(px, py);
    g.lineTo(px, py + sy * L);
    g.stroke();
  }
  const ty = 0.1195 * h;
  g.fillStyle = css(acc);
  g.beginPath();
  g.arc(0.074 * w, ty, 0.006 * w, 0, 2 * Math.PI);
  g.fill();
  g.textBaseline = 'middle';
  const fs = 0.0155 * w;
  g.font = font(fs, 700);
  g.letterSpacing = (0.08 * fs).toFixed(2) + 'px';
  g.textAlign = 'left';
  g.fillStyle = css(line);
  g.fillText('REC', 0.088 * w, ty);
  g.letterSpacing = '0px';
  g.font = font(fs, 500);
  g.textAlign = 'right';
  g.fillStyle = css(line, 0.92);
  g.fillText('00:42:' + String(16 + (Math.floor(Math.max(0, t) * 2) % 8)).padStart(2, '0'), 0.942 * w, ty);
  // The zoom read out - what the zoom is (its Zoom setting counted).
  const z = dzoomAt(t, e);
  g.fillStyle = 'rgba(30,30,30,0.55)';
  const pw = 0.115 * w, ph = 0.0285 * h;
  rrect(g, 0.5 * w - pw / 2, ty - ph / 2, pw, ph, 0.0142 * h);
  g.fill();
  g.font = font(0.0165 * w, 700);
  g.textAlign = 'center';
  g.fillStyle = css(line);
  g.fillText(z.shown.toFixed(1) + '×', 0.5 * w, ty);
  // The focus box on the eyes, 0.2-0.8 s - where the zoom puts them.
  if (t > 0.2 && t < 0.8) {
    const fa = smooth(0.2, 0.3, t) * (1 - smooth(0.65, 0.8, t));
    const f = faceAt(e.path, +e.t0 || 0);
    const ax = z.ax * S.W, ay = z.ay * S.H;
    const ex = f[0] * S.W, ey = (f[1] - 0.1 * f[3]) * S.H;
    const [bx, by] = S.toBox(ax + z.s * (ex - ax), ay + z.s * (ey - ay));
    const bw = 0.25 * w, bh = 0.055 * h, k = 14 * u;
    g.globalAlpha = env * fa * 0.9;
    g.strokeStyle = css(acc);
    g.lineWidth = Math.max(1.5, 2 * u);
    const x0 = bx - bw / 2, x1 = bx + bw / 2, y0 = by - bh / 2, y1 = by + bh / 2;
    g.beginPath();
    for (const [x, y, dx, dy] of [[x0, y0, 1, 1], [x1, y0, -1, 1], [x0, y1, 1, -1], [x1, y1, -1, -1]]) {
      g.moveTo(x + dx * k, y); g.lineTo(x, y); g.lineTo(x, y + dy * k);
    }
    g.stroke();
  }
  g.restore();
}

/** Every scene by its effect's `draw` key. */
export const SCENES = { sparkle, rainbow, colorframe, framebreak, digitalzoom };
