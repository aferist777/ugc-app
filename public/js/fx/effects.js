/* ═══════════════════════════════════════════════════════════════════════════
   A CLIP'S EFFECTS - THE TABLE (phase V84, the owner 2026-11-09/10; docs/local-app/plan/, "Фаза V84", "Подфаза 3 — V84"). ONE
   module for the page and the server: js/merge-v3/fx-draw.js draws by it, lib/fx-render.js tells ffmpeg the same numbers.

   The effects are video-effects-pack's (NeuroLena, MIT - github.com/neurolena1/video-effects-pack): its timings, its curves and
   its measured camera paths, written again in JS. Each effect is a set of NUMBERS AS A FUNCTION OF ITS OWN TIME τ (seconds from
   its start; a stretched one is read at τ × its length / the length given):
     s, ax, ay      the picture scaled by s about the point (ax, ay) - shares of the frame; none - the clip's middle
     col            a colour matrix in RGB, 3 rows of [r, g, b, offset], channels 0..1, clamped after
     ch             the channels moved apart: { rx, ry, gx, gy, bx, by } - pixels of a frame 1080 wide (u)
     px             pixelated in blocks of px u
     vig            the vignette's strength 0..1 (vigAt - its mask)
     lines          the speed lines' strength 0..1 (linesOf - where they lie)
     mv             (block 1b) a measured camera's move { a, b, e, f }: x' = a·x − b·y + e, y' = b·x + a·y + f, e and f shares of the
                    frame's width and height (tables.js); `cover` - zoomed about the middle just enough to leave no empty corner
     glow           Soft sway's soft focus 0..1: 0.88 of the picture blurred by 1.3 u and 0.12 of it blurred by 14 u
     blurV          a vertical blur, σ in u;  stripes - the glitch's dark lines 0..1 (stripesAt);  grain - the glitch's grain 0..1
     blur           (block 1c) a blur both ways, σ in u (Snap zoom's snaps)
     jitter         (block 3) the glitch's column jitter { seed } (jitterOf) - drawn by the page only. An effect with `engine: true`
                    is drawn by the page's code alone, the preview live and the render from a copy the app's window BAKES with
                    that code (lib/fx-bake.js) - on every video lane (block 4a, the owner's (б4-1): above main with its alpha)
     mosaic         (block 1c) the face's oval of blocks: { x, y (its middle), w, h (its size) } - shares of the frame
   `kind` 'intro' - a moment of its own length (`dur`), stretched to 0.8-2 (`lo`, `hi`) of it; 'loop' - for as long as it is on.
   ═══════════════════════════════════════════════════════════════════════════ */

import { MOTION, SWING_PURPLE, SWING_TEAL } from './tables.js';

export const FX_VERSION = 1;

const clamp01 = (x) => Math.max(0, Math.min(1, x));
/** smoothstep 0..1 - video-effects-pack's ease(). */
export const ease = (x) => { const v = clamp01(x); return v * v * (3 - 2 * v); };
/** smoothstep from a to b. */
export const smooth = (a, b, t) => ease((t - a) / Math.max(1e-6, b - a));
/** Piecewise linear keys [[t, v], ...], held past both ends. */
export function kf(t, pts) {
  if (t <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    if (t <= pts[i][0]) {
      const [t0, v0] = pts[i - 1], [t1, v1] = pts[i];
      return v0 + (v1 - v0) * ((t - t0) / ((t1 - t0) || 1));
    }
  }
  return pts[pts.length - 1][1];
}

// ── Colour matrices: 3 rows of [r, g, b, offset] ────────────────────────────
export const COL_ID = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
/** B after A: B(A(x)). */
export function colThen(A, B) {
  const out = new Array(12);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) out[r * 4 + c] = B[r * 4] * A[c] + B[r * 4 + 1] * A[4 + c] + B[r * 4 + 2] * A[8 + c];
    out[r * 4 + 3] = B[r * 4] * A[3] + B[r * 4 + 1] * A[7] + B[r * 4 + 2] * A[11] + B[r * 4 + 3];
  }
  return out;
}
const _scaleCol = (k) => [k, 0, 0, 0, 0, k, 0, 0, 0, 0, k, 0];
const _addCol = (o) => [1, 0, 0, o, 0, 1, 0, o, 0, 0, 1, o];

// ── The effects' own numbers ────────────────────────────────────────────────
// Drop in: 80 % -> 100 % on black over 22 frames of 30 (video-effects-pack's _DROP).
const DROP = [[0, .80], [1, .804], [2, .807], [3, .811], [4, .819], [5, .822], [6, .831], [7, .841], [8, .852], [9, .865],
  [10, .88], [11, .896], [12, .915], [13, .933], [14, .95], [15, .963], [16, .97], [17, .979], [18, .985], [19, .99], [20, .996], [22, 1.0]];

function _quick(t) {
  let s = 1 + 0.20 * (1 - Math.pow(1 - clamp01(t / 0.2), 3));
  if (t > 1.25) s = 1 + 0.20 * (1 - ease((t - 1.25) / 0.65));
  const a = 18 * Math.max(0, 1 - t / 0.5);
  const k = Math.max(0, 1 - t / 0.35);
  return { s, ch: a > 0.4 ? { rx: a, bx: -a } : null, lines: k > 0.02 ? k : 0 };
}

function _bw(t) {
  const k = smooth(0, 0.35, t) * (1 - smooth(1.45, 1.9, t));
  if (k <= 0.003) return {};
  const c = 1 + 0.10 * k, m = 128 / 255;
  const w = [0.299, 0.587, 0.114].map((x) => k * c * x);
  const off = k * (m - m * c);
  return { col: [1 - k + w[0], w[1], w[2], off, w[0], 1 - k + w[1], w[2], off, w[0], w[1], 1 - k + w[2], off] };
}

function _pixelate(t) {
  let b;
  if (t < 0.25) b = 1 + (48 - 1) * ease(t / 0.25);
  else if (t < 1.2) b = 48;
  else b = 48 + (1 - 48) * ease((t - 1.2) / 0.55);
  return b > 1.5 ? { px: b } : {};
}

function _heart(t) {
  const f = (t * 30) % 15;
  if (!(f > 2.2 && f < 13)) return {};
  const b = Math.sin(Math.PI * (f - 2.2) / 10.8);
  return { s: 1 + 0.139 * b, col: _addCol(46 / 255 * Math.min(1, b * 1.4)) };
}

// ── Block 1b: the measured cameras (video-effects-pack's motion_matrix) ──
/** The camera of `name` at τ - its table played forwards and back - as a similarity, e and f shares of the frame. */
export function motionAt(name, t) {
  const tb = MOTION[name];
  const rows = tb.m, step = tb.step;
  const dur = (rows.length - 1) * step / tb.fps;
  let u = t % (2 * dur);
  if (u > dur) u = 2 * dur - u;
  const pos = u * tb.fps / step;
  const i = Math.min(Math.floor(pos), rows.length - 1), fr = pos - i;
  const a = rows[i], b = rows[Math.min(i + 1, rows.length - 1)];
  const m = a.map((v, j) => v + (b[j] - v) * fr);
  // Measured on 270 x 480: its turn and scale as one similarity (the same angle on a frame of any shape), its move in shares.
  return { a: (m[0] + m[4]) / 2, b: (m[3] - m[1]) / 2, e: m[2] / 270, f: m[5] / 480, raw: m };
}

const tri = (x) => { const v = ((x % 1) + 1) % 1; return 1 - Math.abs(2 * v - 1); };
function _swing(t) {
  const u = tri(t / 1.0);
  const col = [];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 4; c++) {
      const v = SWING_PURPLE[r][c] * (1 - u) + SWING_TEAL[r][c] * u;
      col.push(c === 3 ? v / 255 : v);
    }
  }
  const m = motionAt('colorswing', t);
  // (block 2) Its ECHO - at the purple peaks the pack mixes in a frame from another moment (found by matching its frames to the
  // source): [t0, t1, from dt0 to dt1 s, at alpha a0 to a1], a 6 s cycle. The frame is the clip's file's (js/fx/kit.js momentAt).
  const tt = ((t % 6) + 6) % 6;
  let echo = null;
  for (const [t0, t1, d0, d1, a0, a1] of SWING_ECHO) {
    if (tt >= t0 && tt <= t1) { const u2 = (tt - t0) / (t1 - t0); echo = { dt: d0 + (d1 - d0) * u2, a: a0 + (a1 - a0) * u2 }; break; }
  }
  return { col, mv: { a: m.a, b: m.b, e: m.e, f: m.f }, cover: true, ...(echo ? { echo } : {}) };
}
const SWING_ECHO = [[0.933, 1.167, -0.21, -0.21, 0.4, 0.6], [1.967, 2.1, 0.33, 0.33, 0.1, 0.4], [2.9, 3.2, -0.08, -0.42, 0.3, 0.6],
  [3.8, 4.13, 0.67, 0.42, 0.5, 0.1], [4.87, 5.1, -0.42, -0.42, 0.3, 0.5]];
export { SWING_ECHO };

// A seeded random a frame pair (the glitch's own, the same in the page and the file).
function _rngOf(n) { return _rng((Math.imul(n + 1, 2654435761) ^ 0x9E3779B9) >>> 0); }
// The glitch of the Hook set - video-effects-pack's vglitch without its per-column jitter (block 5): the green channel along the
// measured path, the blue the other way, the red jumping down now and then; a little brighter; smeared down; dark lines; grain.
function _glitch(t) {
  const i = Math.floor(t * 30 + 1e-6);
  const m = motionAt('vglitch', t).raw;
  const gx = m[2] * 4, gy = m[5] * 4;
  const rnd = _rngOf(i >> 1);
  const jump = rnd() < 0.6 ? rnd() * 45 : 0;
  return {
    ch: { gx, gy, bx: -gx, ry: jump },
    col: [1.1, 0, 0, 8 / 255, 0, 1.1, 0, 8 / 255, 0, 0, 1.1, 8 / 255],
    blurV: 2.6, stripes: 1, grain: 1,
    // (block 3) its column jitter - bands of 7 u, each moved down by its own random amount (σ 5 u), new every two frames: drawn by
    // the page's code only (fx-draw.js) - for the render baked by the app's window (lib/fx-bake.js) on every video lane.
    jitter: { seed: (i >> 1) + 1 },
  };
}

// ── Block 3: drawn by the page's code only (the bake engine) ────────────────
/**
 * The glitch's column jitter on a frame W wide: { bw (px), dy: [px a band] } - video-effects-pack's vglitch: bands of 7 u (3 px
 * at least), each moved down by a normal random of σ 5 u, from `seed` (the frame pair's).
 */
export function jitterOf(W, seed) {
  const u = W / 1080;
  const bw = Math.max(3, Math.round(7 * u));
  const n = Math.ceil(W / bw);
  const rnd = _rng((Math.imul(seed, 2246822519) ^ 0x51ED270B) >>> 0);
  const dy = new Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.max(1e-9, rnd()), b = rnd();
    dy[i] = 5 * u * Math.sqrt(-2 * Math.log(a)) * Math.cos(2 * Math.PI * b);
  }
  return { bw, dy };
}
/** The version of the page-drawn effects and of the bake - a copy made by another is made again (lib/fx-bake.js). 2 - block 4a:
 *  the window converts the colours itself, as ffmpeg does (the owner's app, 2026-11-11: a copy came out a little flatter). */
// 3 - block 6: the person's mask (the magazine's head in front of its title).
export const ENGINE_VERSION = 3;

// ── Block 1c: by the face ──────────────────────────────────────────────────
// Where the face is, an effect keeps in `path` (js/fx/params.js normalizeFx): [[the file's second, x, y, w, h], ...] five a
// second over the clip - the face's middle and size in shares of the FRAME, where it shows on the screen (js/merge-v3/fx-ui.js
// finds it when the effect is added). No path - video-effects-pack's own place of a face in a vertical frame.
export const FACE_DEFAULT = [0.503, 0.354, 0.352, 0.198];
/** The face in the path at the file's second `tf` - [x, y, w, h], between two samples on a straight line, held past both ends. */
export function faceAt(path, tf) {
  if (!Array.isArray(path) || !path.length) return FACE_DEFAULT;
  if (!(tf > path[0][0])) return path[0].slice(1, 5);
  for (let i = 1; i < path.length; i++) {
    if (tf <= path[i][0]) {
      const a = path[i - 1], b = path[i];
      const r = (tf - a[0]) / ((b[0] - a[0]) || 1);
      return [1, 2, 3, 4].map((j) => a[j] + (b[j] - a[j]) * r);
    }
  }
  return path[path.length - 1].slice(1, 5);
}

// Snap zoom: three snaps in on the face (video-effects-pack's snapzoom): its zoom by these keys, less the larger the face already
// is (a face 0.21 of the frame's width is the design's), about the face's middle 0.45 of its height down; a blur on each snap (the
// sample's radial zoom blur is an ordinary one here - the owner's (эф9) б).
const SNAP = [[0, 2.1], [0.08, 2.1], [0.30, 1.45], [1.05, 1.58], [1.12, 1.58], [1.22, 1.95], [1.9, 2.05], [1.98, 2.05], [2.08, 1.0], [2.45, 1.0]];
function _snap(t, e) {
  const f = faceAt(e && e.path, +((e && e.t0) || 0));
  const k = Math.max(0.45, Math.min(1, 0.21 / Math.max(1e-3, f[2])));
  let bl = 0;
  if (t < 0.3) bl = 0.45 * (1 - t / 0.3);
  else if (t > 1.1 && t < 1.3) bl = 0.40 * Math.sin(Math.PI * (t - 1.1) / 0.2);
  else if (t > 1.95 && t < 2.2) bl = 0.45 * Math.sin(Math.PI * (t - 1.95) / 0.25);
  return { s: 1 + (kf(t, SNAP) - 1) * k, ax: f[0], ay: f[1] - 0.05 * f[3], blur: bl > 0.05 ? 0.0045 * 1080 * bl / 0.4 : 0 };
}
// Face mosaic: an oval of blocks over the face (video-effects-pack's mosaic: half-axes 0.62 and 0.63 of the face's box, its middle
// a little right and down), following the face; its size the face's where the effect starts.
export const MOSAIC_BLOCK = 26;
function _mosaic(t, e, tf) {
  const f0 = faceAt(e && e.path, +((e && e.t0) || 0));
  const f = faceAt(e && e.path, tf);
  return { mosaic: { x: f[0] + 0.005 * f0[2], y: f[1] + 0.005 * f0[3], w: 1.24 * f0[2], h: 1.26 * f0[3] } };
}

// ── Block 4b: Digital zoom's zoom (its viewfinder - js/fx/overlays.js) ─────────────────────────────────────────────────────
// video-effects-pack's digitalzoom: in on the face 1.6x, then 2.6x, a sharp way back (Zoom scales it), less the larger the face is;
// about the face's middle 0.45 of its height down, which a hand's shake moves 24 times a second (Shake); a blur on the way back (the
// pack's radial one an ordinary one here, as Snap zoom's).
const DZOOM = [[0, 1.0], [0.12, 1.0], [0.30, 1.6], [0.72, 1.6], [0.88, 2.6], [1.50, 2.62], [1.62, 2.62], [1.80, 1.0], [2.05, 1.0]];
/** Digital zoom at its own second `t`: { s, ax, ay (shares of the frame), shown - the zoom its viewfinder reads, blur (u) }. */
export function dzoomAt(t, e) {
  const o = optsOf(e);
  const f = faceAt(e && e.path, +((e && e.t0) || 0));
  const k = Math.max(0.45, Math.min(1, 0.21 / Math.max(1e-3, f[2])));
  const s0 = kf(t, DZOOM);
  let jx = 0, jy = 0;
  if (t > 0.3 && t < 1.7 && o.shake > 0) {
    const r = _rng((Math.imul(Math.floor(t * 24) + 7, 2654435761) ^ _idSeed(e)) >>> 0);
    const n = () => Math.sqrt(-2 * Math.log(Math.max(1e-9, r()))) * Math.cos(2 * Math.PI * r());
    jx = n() * 1.2 * o.shake / 1080;
    jy = n() * 1.2 * o.shake / 1920;
  }
  const bl = t > 1.62 && t < 1.8 ? 0.22 * Math.sin(Math.PI * (t - 1.62) / 0.18) * k : 0;
  return { s: 1 + (s0 - 1) * k * o.zoom, ax: f[0] + jx, ay: f[1] - 0.05 * f[3] + jy, shown: 1 + (s0 - 1) * o.zoom,
    blur: bl > 0.02 ? 0.0045 * 1080 * bl / 0.4 : 0 };
}
function _dzoom(t, e) {
  const z = dzoomAt(t, e);
  return { s: z.s, ax: z.ax, ay: z.ay, blur: z.blur };
}
const _none = () => ({});
// (block 4c, the owner's (б4-13) б, в, г) A card's place up or down (a share of its window), its size and its corners.
const CARD_OPTS = [['place', 'Place', -0.4, 0.4, 0.01, 0, 'pos'], ['size', 'Size', 0.6, 1.5, 0.05, 1, 'x'], ['corners', 'Corners', 0, 1, 0.05, 1, 'pct']];
function _idSeed(e) {
  const s = String((e && e.id) || '');
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
// Color frame's and Frame break's three colours: #FF5A36 and its lighter and darker shades (the pack's one-accent rule).
const FRAME_COLORS = [['c1', 'Color 1', '#ff5a36'], ['c2', 'Color 2', '#ffb5a5'], ['c3', 'Color 3', '#b33f26']];

/**
 * Every effect: { name, group, kind, dur, lo, hi, about, face?, at(τ, the effect, the file's second) -> numbers }. The groups are
 * the list's (js/merge-v3/fx-ui.js); `face` - it needs where the face is (its `path`). The order here is the list's order.
 */
export const EFFECTS = {
  quickzoom: { name: 'Quick zoom', group: 'motion', kind: 'intro', dur: 1.9, lo: 0.85, hi: 2,
    about: 'A hard push in to 120 %, the colours split and speed lines for a moment, then a calm way back.', at: _quick },
  smoothzoomout: { name: 'Smooth zoom out', group: 'motion', kind: 'intro', dur: 1.45, lo: 0.8, hi: 2,
    about: 'From 120 % back to the whole frame in a second, smooth at both ends.',
    at: (t) => ({ s: t < 0.12 ? 1 + 0.20 * ease(t / 0.12) : 1 + 0.20 * (1 - ease((t - 0.12) / 1.0)) }) },
  dropin: { name: 'Drop in', group: 'motion', kind: 'intro', dur: 0.8, lo: 0.8, hi: 2,
    about: 'The clip drops in from 80 % to its full size over black.', at: (t) => ({ s: kf(t * 30, DROP) }) },
  heartbeat: { name: 'Heartbeat', group: 'motion', kind: 'loop',
    about: 'A zoom pulse to 114 % with a flash of light, twice a second.', at: _heart },
  pulse: { name: 'Pulse', group: 'motion', kind: 'loop',
    about: 'A 4 % push in and quick jolts up and down - a camera on the beat.',
    at: (t) => { const m = motionAt('pulse', t); return { mv: { a: m.a, b: m.b, e: m.e, f: m.f } }; } },
  soft: { name: 'Soft sway', group: 'motion', kind: 'loop', engine: true,
    about: 'A slow sway with a tilt of up to 3.5 degrees and a soft focus.',
    at: (t) => { const m = motionAt('soft', t); return { mv: { a: m.a, b: m.b, e: m.e, f: m.f }, cover: true, glow: 1 }; } },
  bwframe: { name: 'Black & white', group: 'color', kind: 'intro', dur: 1.9, lo: 0.8, hi: 2,
    about: 'The colour goes in 0.35 s, a little more contrast, and comes back.', at: _bw },
  fadeblack: { name: 'Fade to black', group: 'color', kind: 'intro', dur: 1.75, lo: 0.8, hi: 2,
    about: 'To black in 0.8 s, a short hold, back in 0.4 s.',
    at: (t) => { const k = ease(t / 0.8) * (1 - ease((t - 1.35) / 0.4)); return k > 0.001 ? { col: _scaleCol(1 - k) } : {}; } },
  vignette: { name: 'Vignette', group: 'color', kind: 'intro', dur: 1.55, lo: 0.8, hi: 2,
    about: 'The edges darken for a moment and clear again.',
    at: (t) => { const k = smooth(0, 0.35, t) * (1 - smooth(1.10, 1.55, t)); return k > 0.003 ? { vig: k } : {}; } },
  pixelate: { name: 'Pixelate', group: 'color', kind: 'intro', dur: 1.8, lo: 0.8, hi: 2,
    about: 'The whole frame turns to blocks of up to 48 px and back.', at: _pixelate },
  colorswing: { name: 'Color swing', group: 'color', kind: 'loop', engine: true, moments: 'echo',
    about: 'The colour swings purple - teal - purple once a second, the camera sways, and at its purple peaks a frame from another moment echoes in.', at: _swing },
  glitch: { name: 'Glitch', group: 'glitch', kind: 'loop', engine: true,
    about: 'The colour channels tear apart, the columns jitter, dark lines and grain - the glitch of the Hook set.', at: _glitch },
  snapzoom: { name: 'Snap zoom', group: 'face', kind: 'intro', dur: 2.45, lo: 0.7, hi: 2, face: true,
    about: 'Three sharp snaps in on the face - 145 %, 195 %, then back - with a blur on each snap.', at: _snap },
  mosaic: { name: 'Face mosaic', group: 'face', kind: 'loop', face: true,
    about: 'An oval of blocks hides the face and follows it.', at: _mosaic },
  // (block 4b) Graphics over the picture - drawn by the page only (js/fx/overlays.js; baked for the render, `engine`), inside the
  // clip's window (js/fx/box.js, the owner's (б4-11)); their colours and settings are the person's (б4-12, б4-13).
  sparkle: { name: 'Sparkle', group: 'overlay', kind: 'loop', engine: true, draw: 'sparkle',
    colors: [['spark', 'Sparkles', '#ffffff']],
    opts: [['amount', 'Amount', 20, 150, 1, 62, 'n'], ['size', 'Size', 0.5, 2, 0.05, 1, 'x']],
    about: 'Four-ray sparkles twinkle all over the picture, each at a new place every time.', at: _none },
  rainbow: { name: 'Rainbow glow', group: 'overlay', kind: 'loop', engine: true, draw: 'rainbow',
    opts: [['speed', 'Speed', 0, 3, 0.05, 1, 'x'], ['width', 'Width', 0.5, 2, 0.05, 1, 'x'], ['strength', 'Strength', 0.3, 1.5, 0.05, 1, 'x']],
    about: 'A rainbow glows along the edges and turns round them.', at: _none },
  colorframe: { name: 'Color frame', group: 'overlay', kind: 'intro', dur: 1.9, lo: 0.8, hi: 2, engine: true, draw: 'colorframe',
    colors: FRAME_COLORS,
    opts: [['width', 'Width', 0.5, 3, 0.05, 1, 'x'], ['glow', 'Glow', 0, 2, 0.05, 1, 'x'], ['speed', 'Speed', 0, 3, 0.05, 1, 'x']],
    about: 'A thin frame of light pops up: its colour flows round it, a bright comet runs along it, a soft glow out and in.', at: _none },
  framebreak: { name: 'Frame break', group: 'overlay', kind: 'intro', dur: 1.75, lo: 0.8, hi: 2, engine: true, draw: 'framebreak',
    colors: FRAME_COLORS,
    opts: [['width', 'Width', 0.5, 3, 0.05, 1, 'x'], ['glow', 'Glow', 0, 2, 0.05, 1, 'x']],
    about: 'The same frame of light holds a moment, cracks and shatters - its pieces fly and fall, confetti and a ring of light follow.', at: _none },
  digitalzoom: { name: 'Digital zoom', group: 'overlay', kind: 'intro', dur: 2.05, lo: 0.7, hi: 2, engine: true, draw: 'digitalzoom', face: true,
    colors: [['accent', 'Accent', '#ff5722'], ['lines', 'Lines', '#ffffff']],
    opts: [['zoom', 'Zoom', 0.5, 1.5, 0.05, 1, 'x'], ['shake', 'Shake', 0, 2, 0.05, 1, 'x']],
    about: 'A camera\'s viewfinder - REC, a timecode, the zoom read out - zooms in on the face 1.6x, then 2.6x, with a hand\'s shake, and snaps back.', at: _dzoom },
  // (block 4c) Cards with the person's words (`texts`), in any of the captions' fonts (`font`), standing as long as they are set
  // (`hold` - the moment that stands, the owner's (б4-3)); js/fx/cards.js draws them.
  checklistpop: { name: 'Checklist pop', group: 'card', kind: 'intro', dur: 1.84, lo: 0.7, hold: 1.55, engine: true, draw: 'checklistpop',
    texts: [['i1', 'Item 1', 'Edit'], ['i2', 'Item 2', 'Captions'], ['i3', 'Item 3', 'Effects'], ['i4', 'Item 4', '']],
    colors: [['card', 'Card', '#fcfcfc'], ['text', 'Text', '#1a1a1c'], ['accent', 'Ticks', '#1a1a1c']], opts: CARD_OPTS,
    about: 'White pills with a tick pop in from the right one after another.', at: _none },
  checklist2: { name: 'Checklist', group: 'card', kind: 'intro', dur: 2.0, lo: 0.7, hold: 1.68, engine: true, draw: 'checklist2',
    texts: [['title', 'Title', 'CHECKLIST'], ['i1', 'Item 1', 'TITLES'], ['i2', 'Item 2', 'TRANSITIONS'], ['i3', 'Item 3', 'GRAPHICS'],
      ['i4', 'Item 4', ''], ['i5', 'Item 5', '']],
    colors: [['card', 'Card', '#fcfcfc'], ['text', 'Text', '#1a1a1c'], ['accent', 'Accent', '#ff5a36']], opts: CARD_OPTS,
    about: 'A card with a title and a list: the circles turn into ticks one after another, sparks, a bar of progress.', at: _none },
  growthchart: { name: 'Growth chart', group: 'card', kind: 'intro', dur: 2.3, lo: 0.7, hold: 1.8, engine: true, draw: 'growthchart',
    texts: [['title', 'Title', 'GROWTH'], ['number', 'Number', '120'], ['note', 'Note', 'SAMPLE DATA']],
    colors: [['card', 'Card', '#fcfcfc'], ['text', 'Text', '#1a1a1c'], ['accent', 'Line', '#ff5a36']], opts: CARD_OPTS,
    about: 'A chart card: the line of growth draws itself, a counter runs up to your number, a dot pulses at its end.', at: _none },
  chat: { name: 'Chat', group: 'card', kind: 'intro', dur: 2.03, lo: 0.7, hold: 1.55, engine: true, draw: 'chat',
    texts: [['request', 'Request', 'Edit this video, caption every word, then add these effects.'], ['i1', 'Item 1', 'Cut the pauses'],
      ['i2', 'Item 2', 'Caption every word'], ['i3', 'Item 3', 'Add the effects'], ['name', 'Assistant', 'Assistant']],
    colors: [['bg', 'Background', '#eeeeec'], ['card', 'Window', '#fcfcfc'], ['text', 'Text', '#1a1a1c'], ['accent', 'Accent', '#1a1a1c']],
    opts: [['corners', 'Corners', 0, 1, 0.05, 1, 'pct']],
    about: 'The clip shrinks into a card and lands in a chat with an AI under the request; the reply ticks its list, then the clip opens back.', at: _none },
  // (block 4d) Screens: the window turned into a scene with the clip inside it - js/fx/screens.js draws them.
  phonemock: { name: 'Phone app', group: 'card', kind: 'intro', dur: 1.16, lo: 0.7, hold: 0.9, engine: true, draw: 'phonemock',
    texts: [['name', 'Name', 'yourname'], ['caption', 'Caption', '20 video effects, all made with AI...']],
    colors: [['bg', 'Background', '#eeeeec'], ['body', 'Phone', '#0e0e10']], opts: [['size', 'Size', 0.8, 1.2, 0.02, 1, 'x']],
    about: 'The clip shrinks into a phone\'s screen with a short-video app round it - a heart, comments, a name, a caption.', at: _none },
  phonemock2: { name: 'Phone', group: 'card', kind: 'intro', dur: 2.0, lo: 0.7, hold: 1.0, engine: true, draw: 'phonemock2',
    texts: [['caption', 'Caption over it', '']],
    colors: [['bg', 'Background', '#eeeeec'], ['body', 'Phone', '#1a1a1c']], opts: [['size', 'Size', 0.8, 1.2, 0.02, 1, 'x']],
    about: 'The clip shrinks into a phone on a plain background and opens back; a caption over the phone when you write one.', at: _none },
  screeninscreen: { name: 'Screen in screen', group: 'card', kind: 'intro', dur: 1.5, lo: 0.7, hold: 0.8, engine: true, draw: 'screeninscreen', face: true,
    colors: [['bg', 'Background', '#ffffff'], ['frame', 'Frame', '#242628']], opts: [['border', 'Border', 0, 3, 0.1, 1, 'x']],
    about: 'The vertical clip turns into a wide screen - from the hair to the chin - on white, and back.', at: _none },
  magazine: { name: 'Magazine cover', group: 'card', kind: 'intro', dur: 2.15, lo: 0.7, hold: 1.3, engine: true, draw: 'magazine', face: true, person: true,
    texts: [['name', 'Masthead', 'MAGAZINE'], ['head1', 'Line 1', 'VIDEO &'], ['head2', 'Line 2 (plate)', 'EDITING'], ['big', 'Number', '15+'],
      ['biglabel', 'Under the number', 'EFFECTS'], ['sub1', 'Bottom 1', 'EDITING SECRETS'], ['sub2', 'Bottom 2', 'TITLES · GRAPHICS · TRANSITIONS'],
      ['issue', 'Issue', 'ISSUE NO. 1'], ['date', 'Date', '']],
    colors: [['bg', 'Background', '#eeeeec'], ['accent', 'Plate', '#ff5a36'], ['text', 'Text', '#ffffff']],
    opts: [['corners', 'Corners', 0, 1, 0.05, 1, 'pct'], ['barcode', 'Barcode', 0, 1, 1, 1, 'bool']],
    about: 'The clip becomes a magazine cover: the issue and date, the masthead over the hair, a big number and a line on a plate under the chin, a barcode.', at: _none },
  // (block 2) Copies and moments - js/fx/copies.js draws them; Grid dive and PiP delay show other moments of the clip (`moments`).
  details: { name: 'Details', group: 'copies', kind: 'intro', dur: 3.0, lo: 0.7, hi: 2, engine: true, draw: 'details',
    about: 'The background blurs, five photo cards of the clip land one after another with a flash, then a flash and back.', at: _none },
  clasp: { name: 'Clasp', group: 'copies', kind: 'intro', dur: 2.5, lo: 0.7, hi: 2, engine: true, draw: 'clasp',
    about: 'Black, then black-and-white opens like a zip, a diagonal wipe into colour and a flash.', at: _none },
  strip: { name: 'Film strip', group: 'copies', kind: 'intro', dur: 3.7, lo: 0.7, hi: 2, engine: true, draw: 'strip',
    about: 'The clip shrinks into a strip of cards with reflections, rolls away and flies back to full frame.', at: _none },
  split: { name: 'Split', group: 'copies', kind: 'intro', dur: 3.1, lo: 0.7, hi: 2, engine: true, draw: 'split',
    about: 'Black, the clip slides in and multiplies into 2, 3 and 4 copies side by side, white bars, and back.', at: _none },
  griddive: { name: 'Grid dive', group: 'copies', kind: 'intro', dur: 0.85, lo: 0.8, hi: 2, engine: true, draw: 'griddive', moments: 'grid',
    about: 'The frame pulls back into a tilted wall of tiles - each another moment of the clip - and dives back in.', at: _none },
  pipdelay: { name: 'PiP delay', group: 'copies', kind: 'intro', dur: 2.1, lo: 0.7, hold: 1.0, engine: true, draw: 'pipdelay', face: true, moments: 'delay',
    colors: [['accent', 'Bar', '#ff5a36'], ['card', 'Window', '#fcfcfc'], ['ink', 'Border', '#1a1a1c']],
    opts: [['delay', 'Delay', 0.2, 1.0, 0.05, 0.5, 's'], ['corners', 'Corners', 0, 1, 0.05, 1, 'pct']],
    about: 'A window with REC in the corner shows the same clip half a second late - the head and the chin - tilting and floating.', at: _none },
  splitscreen: { name: 'Split screen', group: 'copies', kind: 'intro', dur: 1.9, lo: 0.7, hold: 1.0, engine: true, draw: 'splitscreen', face: true,
    texts: [['caption', 'Caption on the line', '']],
    colors: [['card', 'Line', '#fcfcfc'], ['text', 'Text', '#1a1a1c']], opts: [['zoom', 'Zoom', 1.1, 2.0, 0.05, 1.35, 'x']],
    about: 'The screen splits: the frame on top, the same frame zoomed on the face below, sliding in with a line between them.', at: _none },
  // (block 5) Glitches - js/fx/glitches.js.
  cursed: { name: 'Cursed', group: 'glitch', kind: 'loop', engine: true, draw: 'cursed',
    about: 'A green night-vision tone, a flipped ghost now and then, torn tracking bands, pink dashes and grain.', at: _none },
  sliceup: { name: 'Slice up', group: 'glitch', kind: 'intro', dur: 3.1, lo: 0.7, hi: 2, engine: true, draw: 'sliceup', face: true,
    about: 'A 2x zoom on the face; its cut edge creeps up the frame with flickering blocks.', at: _none },
  slicemerge: { name: 'Slice merge', group: 'glitch', kind: 'loop', engine: true, draw: 'slicemerge',
    about: 'A warm tone; the frame is cut into four bands zoomed and shifted apart, with flashes - every 3 s.', at: _none },
  liquidglass: { name: 'Liquid glass', group: 'glitch', kind: 'intro', dur: 1.55, lo: 0.7, hi: 2, engine: true, draw: 'liquidglass', face: true,
    opts: [['size', 'Size', 0.6, 1.6, 0.05, 1, 'x']],
    about: 'A big glass lens glides over the face, magnifying and bending the picture, its rim catching the light.', at: _none },
  // (block 6) Behind the person - js/fx/behind.js: what goes behind is drawn first, then the person cut out by their mask (MediaPipe's
  // segmenter on the window's picture as it is - js/fx/person.js, `person`), then what goes in front.
  orbit: { name: 'Orbit', group: 'behind', kind: 'intro', dur: 1.55, lo: 0.7, hi: 2, engine: true, draw: 'orbit', face: true, person: true,
    colors: [['tile', 'Tiles', '#fcfcfc'], ['glyph', 'Icons', '#1a1a1c'], ['ring', 'Ring', '#ffffff']],
    opts: [['size', 'Size', 0.6, 1.5, 0.05, 1, 'x'], ['speed', 'Speed', 0.3, 2, 0.05, 1, 'x']],
    about: 'Seven white icons circle round the person on a dotted ring - its back half passes behind them, the front half in front.', at: _none },
  iconsaround: { name: 'Icons around', group: 'behind', kind: 'intro', dur: 2.0, lo: 0.7, hi: 2, engine: true, draw: 'iconsaround', face: true, person: true,
    colors: [['c1', 'Color 1', '#ff5a36'], ['c2', 'Color 2', '#111111'], ['c3', 'Color 3', '#8e8e8a']],
    opts: [['size', 'Size', 0.6, 1.5, 0.05, 1, 'x'], ['speed', 'Speed', 0.3, 2, 0.05, 1, 'x']],
    about: 'Eight glossy colour icons circle round the head on a flat tilted ring - some behind the person, some in front.', at: _none },
  headlinestorm: { name: 'Headline storm', group: 'behind', kind: 'intro', dur: 2.05, lo: 0.7, hi: 2, engine: true, draw: 'headlinestorm', face: true, person: true,
    texts: [['h1', 'Headline 1', 'AI NOW EDITS VIDEO'], ['h2', 'Headline 2', '20 EFFECTS. ONE PROMPT.'], ['h3', 'Headline 3', 'EDITORS ON NOTICE'],
      ['h4', 'Headline 4', 'EVERY WORD CAPTIONED'], ['h5', 'Headline 5', 'NO TIMELINE NEEDED'], ['h6', 'Headline 6', 'THE AI EDIT IS HERE'],
      ['h7', 'Headline 7', 'MADE WITH AI'], ['h8', 'Headline 8', '20 EFFECTS INSIDE'], ['h9', 'Headline 9', 'AI EDITS']],
    colors: [['card', 'Light', '#fcfcfc'], ['ink', 'Dark', '#1a1a1c']],
    about: 'Black and white news ribbons - BREAKING, JUST IN - fly in from both sides: most behind the person, three in front under the chin.', at: _none },
  headlinestorm2: { name: 'Headline storm 2', group: 'behind', kind: 'intro', dur: 2.1, lo: 0.7, hi: 2, engine: true, draw: 'headlinestorm2', face: true, person: true,
    texts: [['h1', 'Headline 1', 'EDITING STARTED'], ['h2', 'Headline 2', 'THIS VIDEO'], ['h3', 'Headline 3', 'ONE MORE EFFECT'], ['h4', 'Headline 4', 'WATCH TILL THE END'],
      ['h5', 'Headline 5', 'NO TIMELINE'], ['h6', 'Headline 6', 'ALL BY PROMPT'], ['h7', 'Headline 7', 'DONE']],
    colors: [['c1', 'Color 1', '#ff5a36'], ['c2', 'Color 2', '#fcfcfc'], ['c3', 'Color 3', '#1a1a1c'], ['c4', 'Color 4', '#f0f0f0']],
    about: 'The screen darkens, three lightning bolts strike, coloured headline plates fly in - some behind the person, some in front - and the frame shakes.', at: _none },
  formulas: { name: 'Formulas', group: 'behind', kind: 'loop', engine: true, draw: 'formulas', person: true,
    colors: [['chalk', 'Chalk', '#ffffff']],
    about: 'Chalk formulas and triangles drift on the background behind the person, each fading in and out on its own.', at: _none },
  greenscreen: { name: 'Green screen', group: 'behind', kind: 'intro', dur: 2.05, lo: 0.7, hi: 2, engine: true, draw: 'greenscreen', person: true,
    about: 'A green curtain behind the person, then a sunset sky with a city skyline opens from the bottom in an arc.', at: _none },
  greenbg: { name: 'Green background', group: 'behind', kind: 'intro', dur: 2.1, lo: 0.7, hi: 2, engine: true, draw: 'greenbg', person: true,
    colors: [['bg', 'Background', '#26c840'], ['outline', 'Outline', '#ffffff']],
    about: 'A bright green background with soft lights, growing frames and tracking marks; the person a sticker with a white wavy outline.', at: _none },
  papercutout: { name: 'Paper cutout', group: 'behind', kind: 'intro', dur: 1.87, lo: 0.7, hi: 2, engine: true, draw: 'papercutout', person: true,
    colors: [['paper', 'Paper', '#f0eae0'], ['shapes', 'Shapes', '#201e1e'], ['outline', 'Outline', '#fcfcfc']],
    about: 'The person as a sticker with a white outline on light paper: a dark disc, a star, dots, a torn strip, a stop-motion jitter.', at: _none },
  mix: { name: 'Mix', group: 'copies', kind: 'intro', dur: 4.2, lo: 0.7, hi: 2, engine: true, draw: 'mix', person: true,
    about: 'Black and white; diagonal slats of the colour picture close in from both sides, the person turns white, a flash, and the colour is back.', at: _none },
};

/** Sets of effects laid at once - each one an effect of its own on the clip afterwards (the owner's (эф8)). */
export const SETS = {
  hook: { name: 'Hook', about: 'An opening with impact: Quick zoom with a short glitch over its first 0.7 s.',
    items: [{ k: 'quickzoom' }, { k: 'glitch', len: 0.7 }] },
  // (block 4d, the owner's (б4-9)) Each at its moment of the pack (`at` - seconds into the clip); a clip too short - earlier, ending with it.
  glowup: { name: 'Glow-up', about: 'Sparkles over the whole clip and a frame of light from 0.4 s.',
    items: [{ k: 'sparkle' }, { k: 'colorframe', at: 0.4 }] },
  coverstory: { name: 'Cover story', about: 'Black & white from the start, then the clip turns into a magazine cover from 2.2 s.',
    items: [{ k: 'bwframe' }, { k: 'magazine', at: 2.2 }] },
  aichat: { name: 'AI chat', about: 'The clip lands in a chat with an AI from 0.3 s, then a checklist pops in from 2.8 s.',
    items: [{ k: 'chat', at: 0.3 }, { k: 'checklistpop', at: 2.8 }] },
  // (block 5) The pack's party: constant energy over the whole clip.
  party: { name: 'Party', about: 'Color swing, a beat Pulse and Sparkle over the whole clip.',
    items: [{ k: 'colorswing' }, { k: 'pulse' }, { k: 'sparkle' }] },
};

export const GROUPS = [['motion', 'Zoom & motion'], ['color', 'Color & light'], ['face', 'Face'], ['overlay', 'Overlays'], ['card', 'Cards'],
  ['copies', 'Copies'], ['glitch', 'Glitches'], ['behind', 'Behind']];

/** (block 4c) An effect's words by key - its own (`txt`; '' - not drawn), else the table's. */
export function textsOf(e) {
  const d = effectOf(e && e.k);
  const out = {};
  for (const [key, , def] of ((d && d.texts) || [])) {
    const v = e && e.txt ? e.txt[key] : undefined;
    out[key] = typeof v === 'string' ? v : def;
  }
  return out;
}

/** (block 4b) An effect's colours by key - its own (`col`), else the table's - '#rrggbb'. */
export function colorsOf(e) {
  const d = effectOf(e && e.k);
  const out = {};
  for (const [key, , def] of ((d && d.colors) || [])) {
    const v = e && e.col && e.col[key];
    out[key] = /^#[0-9a-f]{6}$/i.test(String(v || '')) ? String(v).toLowerCase() : def;
  }
  return out;
}
/** (block 4b) An effect's settings by key - its own (`opt`, kept in its range), else the table's. */
export function optsOf(e) {
  const d = effectOf(e && e.k);
  const out = {};
  for (const [key, , lo, hi, , def] of ((d && d.opts) || [])) {
    const v = e && e.opt ? Number(e.opt[key]) : NaN;
    out[key] = Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : def;
  }
  return out;
}

/** The effect's own description, or null for a key the program does not know. */
export const effectOf = (k) => (Object.prototype.hasOwnProperty.call(EFFECTS, k) ? EFFECTS[k] : null);

// ── The vignette's mask and the speed lines - drawn by the page, baked by the server, by the same numbers ─────────────────
/** The vignette's darkness at a point of a W x H frame, 0..0.95. */
export function vigAt(x, y, W, H) {
  const r = Math.sqrt(Math.pow((x - W / 2) / (W * 0.62), 2) + Math.pow((y - H / 2) / (H * 0.62), 2));
  return 0.95 * Math.pow(clamp01((r - 0.45) / 0.60), 1.5);
}

// A small seeded random (mulberry32): the same lines in the page and in the file.
function _rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Quick zoom's speed lines on a W x H frame: [{ x0, y0, x1, y1, w }] in pixels - 46 white rays from the middle, of a fixed
 * length (the owner's (эф9) г: they only fade), drawn at 55 % of the effect's `lines`.
 */
export function linesOf(W, H) {
  const rnd = _rng(5);
  const u = W / 1080, diag = Math.hypot(W, H) / 2, out = [];
  for (let i = 0; i < 46; i++) {
    const an = rnd() * 2 * Math.PI;
    const r0 = (0.30 + rnd() * 0.25) * diag;
    const r1 = r0 + (0.18 + rnd() * 0.24) * diag * 0.8;
    const w = (1.5 + rnd() * 2) * u;
    out.push({ x0: W / 2 + r0 * Math.cos(an), y0: H / 2 + r0 * Math.sin(an), x1: W / 2 + r1 * Math.cos(an), y1: H / 2 + r1 * Math.sin(an), w });
  }
  return out;
}
export const LINES_ALPHA = 0.55;

// ── The glitch's dark lines: one down every 21.5 u, 30 % darker at its middle ──
/** The darkness of the glitch's lines at column x of a frame W wide, 0..0.3. */
export function stripesAt(x, W) {
  const u = W / 1080;
  const ph = ((x / (21.5 * u)) % 1 + 1) % 1;
  return 0.30 * clamp01(1 - Math.abs(ph - 0.12) / 0.11);
}
