/* ═══════════════════════════════════════════════════════════════════════════
   THE GRAPHICS' KIT (phase V84 block 4b) - what every effect that draws on the frame shares: the preview and the app's bake window
   draw with this one code (js/merge-v3/fx-draw.js applyFx -> js/fx/overlays.js and the blocks to come). Page only (canvas).
     fontsReady()          Inter in four weights for the canvas ('UGC FX Inter': 400, 500 - the interface's files; 700, 900 - the
                           captions') - the bake window waits for it before its first frame, the preview draws once it is there
     font(px, weight)      the canvas's font string
     rngOf(...keys)        a random of its own for those keys (an effect's id and numbers) - the same at every frame and every bake
     hexRgb, mixRgb, css   colours as [r, g, b]
     rrect(g, x, y, w, h, r)   a rounded rectangle's path
     ease, smooth, backOut, clamp01, kf   the timing curves video-effects-pack's scenes use
   ═══════════════════════════════════════════════════════════════════════════ */

export { ease, smooth, kf } from './effects.js';

export const clamp01 = (x) => Math.max(0, Math.min(1, x));
/** video-effects-pack's back_out: past 1 and back - the pop of a thing that appears. */
export function backOut(x, k = 1.7) {
  const v = clamp01(x) - 1;
  return 1 + (k + 1) * v * v * v + k * v * v;
}

// ── Fonts ──────────────────────────────────────────────────────────────────
export const FAMILY = 'UGC FX Inter';
const FACES = [
  ['400', '/fonts/ui/Inter-Regular.woff2'],
  ['500', '/fonts/ui/Inter-Medium.woff2'],
  ['700', '/fonts/captions/Inter-Bold.ttf'],
  ['900', '/fonts/captions/Inter-Black.ttf'],
];
let _fonts = null;
/** Inter loaded for the canvas (once). Resolves even when a file is missing - the canvas then draws in its own sans. */
export function fontsReady() {
  if (_fonts) return _fonts;
  if (typeof FontFace === 'undefined' || typeof document === 'undefined') { _fonts = Promise.resolve(false); return _fonts; }
  _fonts = Promise.all(FACES.map(([weight, url]) => {
    const f = new FontFace(FAMILY, `url(${url})`, { weight, style: 'normal' });
    return f.load().then((ff) => { document.fonts.add(ff); return true; }).catch(() => false);
  })).then((all) => all.every(Boolean));
  return _fonts;
}
export const font = (px, weight = 700) => `${weight} ${Math.max(1, Math.round(px * 100) / 100)}px "${FAMILY}", sans-serif`;

// ── A random of its own ────────────────────────────────────────────────────
function _hash(keys) {
  let h = 2166136261;
  const s = keys.map(String).join('|');
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
/** A random 0..1 of its own for `keys` (mulberry32) - its sequence the same at every frame and every bake. */
export function rngOf(...keys) {
  let a = _hash(keys);
  const next = () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next.range = (lo, hi) => lo + (hi - lo) * next();
  next.normal = () => Math.sqrt(-2 * Math.log(Math.max(1e-9, next()))) * Math.cos(2 * Math.PI * next());
  return next;
}

// ── Colours ────────────────────────────────────────────────────────────────
export const HEX_RE = /^#[0-9a-f]{6}$/i;
export function hexRgb(h) {
  const s = HEX_RE.test(String(h || '')) ? String(h).slice(1) : 'ffffff';
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
}
export const mixRgb = (a, b, k) => a.map((v, i) => Math.round(v + (b[i] - v) * k));
export const css = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${Math.max(0, Math.min(1, a))})`;

// ── Shapes ─────────────────────────────────────────────────────────────────
/** A rounded rectangle's path on `g` (begun here). */
export function rrect(g, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  g.beginPath();
  g.moveTo(x + rr, y);
  g.lineTo(x + w - rr, y);
  g.arcTo(x + w, y, x + w, y + rr, rr);
  g.lineTo(x + w, y + h - rr);
  g.arcTo(x + w, y + h, x + w - rr, y + h, rr);
  g.lineTo(x + rr, y + h);
  g.arcTo(x, y + h, x, y + h - rr, rr);
  g.lineTo(x, y + rr);
  g.arcTo(x, y, x + rr, y, rr);
  g.closePath();
}

/**
 * A closed rounded rectangle's outline as points every `step` px, clockwise from the top-left corner's end - video-effects-pack's
 * _rr_path; with each point's share of the way round (`s`) and the way out of it (`nx`, `ny`).
 */
export function rrPath(x0, y0, x1, y1, r, step) {
  const pts = [];
  const seg = (xa, ya, xb, yb) => {
    const n = Math.max(2, Math.floor(Math.hypot(xb - xa, yb - ya) / step));
    for (let k = 0; k < n; k++) pts.push([xa + (xb - xa) * k / n, ya + (yb - ya) * k / n]);
  };
  const arc = (cx, cy, a0, a1) => {
    const n = Math.max(4, Math.floor(r * Math.abs((a1 - a0) * Math.PI / 180) / step));
    for (let k = 0; k < n; k++) { const a = (a0 + (a1 - a0) * k / n) * Math.PI / 180; pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
  };
  seg(x0 + r, y0, x1 - r, y0); arc(x1 - r, y0 + r, -90, 0);
  seg(x1, y0 + r, x1, y1 - r); arc(x1 - r, y1 - r, 0, 90);
  seg(x1 - r, y1, x0 + r, y1); arc(x0 + r, y1 - r, 90, 180);
  seg(x0, y1 - r, x0, y0 + r); arc(x0 + r, y0 + r, 180, 270);
  // The way round and the way out of each point.
  const n = pts.length;
  const len = new Array(n);
  let tot = 0;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    len[i] = Math.hypot(b[0] - a[0], b[1] - a[1]);
    tot += len[i];
  }
  let acc = 0;
  return pts.map((p, i) => {
    const b = pts[(i + 1) % n];
    const d = len[i] || 1;
    const tx = (b[0] - p[0]) / d, ty = (b[1] - p[1]) / d;
    const out = { x: p[0], y: p[1], s: acc / tot, nx: ty, ny: -tx };
    acc += len[i];
    return out;
  });
}
