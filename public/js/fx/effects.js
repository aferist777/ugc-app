/* ═══════════════════════════════════════════════════════════════════════════
   A CLIP'S EFFECTS - THE TABLE (phase V84, the owner 2026-11-09/10; docs/local-app/plan/, "Фаза V84", "Подфаза 3 — V84"). ONE
   module for the page and the server: js/merge-v3/fx-draw.js draws by it, lib/fx-render.js tells ffmpeg the same numbers.

   The effects are video-effects-pack's (NeuroLena, MIT - github.com/neurolena1/video-effects-pack): its timings, its curves and
   its measured camera paths, written again in JS. Each effect is a set of NUMBERS AS A FUNCTION OF ITS OWN TIME τ (seconds from
   its start; a stretched one is read at τ × its length / the length given):
     s, ax, ay      the picture scaled by s about the point (ax, ay) - shares of the frame; none - the clip's middle
     dx, dy         then moved, shares of the frame's width and height
     col            a colour matrix in RGB, 3 rows of [r, g, b, offset], channels 0..1, clamped after
     ch             the channels moved apart: { rx, ry, gx, gy, bx, by } - pixels of a frame 1080 wide (u)
     px             pixelated in blocks of px u
     vig            the vignette's strength 0..1 (vigAt - its mask)
     lines          the speed lines' strength 0..1 (linesOf - where they lie)
   `kind` 'intro' - a moment of its own length (`dur`), stretched to 0.8-2 (`lo`, `hi`) of it; 'loop' - for as long as it is on.
   ═══════════════════════════════════════════════════════════════════════════ */

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

/**
 * Every effect: { name, group, kind, dur, lo, hi, about, at(τ) -> numbers }. The groups are the list's (js/merge-v3/fx-ui.js).
 * The order here is the list's order.
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
};

export const GROUPS = [['motion', 'Zoom & motion'], ['color', 'Color & light']];

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
