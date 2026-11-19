/* ═══════════════════════════════════════════════════════════════════════════
   THE PATTERNS OF MAIN VIDEO - ONE module for the page and the server:
   js/merge-v3/preview-b.js draws by it, lib/pattern-bake.js and lib/mv3b-render.js render by it, js/merge-v3/patterns-ui.js
   offers its tiles and settings, timeline-b.js and lib/timeline-shape.js keep them.

   A pattern (the app's set, lib/patterns-builtin.js: an address under /patterns/, overlay/look.js isPattern) is never placed,
   fitted or cropped: its file - a SEAMLESS tile, white on transparent - is laid over the WHOLE frame, repeated. One corner of
   the tiles sits at the frame's middle; they turn about it.

   A pattern is no clip: it is a LAYER of main video - a list `patterns` on the MAIN VIDEO LANE (the bottom video lane,
   mainLane), TOP LAYER FIRST as the lanes are listed, each { src, pattern?, opacity?, blend? } - its address, the settings
   below, its opacity and blend mode by overlay/look.js's rules, only what differs from the defaults kept (normalizeLayer); one
   entry per pattern of the set, with no limit of how many. It covers the WHOLE main video, from 0 to its end (mainEnd),
   following it, OVER EVERY VIDEO LANE and under the text and the subtitles: the preview and the render both draw layersOf() -
   the bottom layer first, each as a clip of that stretch, known by its layer id. No lane of its own.

   `pattern: { scale, color, angle, move, speed, dir }`, every field optional (absent = the default):
     scale  0.25..4 (25-400 %), 1: a 2160 px file then covers the frame's long side; a 1080 px tile (noise,
            film grain) is laid at the same density - it repeats twice there.
     color  '#rrggbb', white: the white of the file becomes this colour, its transparency kept.
     angle  0..359 degrees, 0: the tiles turned about the frame's middle, standing still.
     move   'none' | 'rotate' | 'drift': a turn about the middle, or a slide one way; a pattern lands still.
     speed  rotate: 0.5..20 degrees a second (2); drift: 5..200 px a second of a frame 1080 px across its short side (20).
     dir    rotate: 'cw' | 'ccw'; drift: 'e' 'ne' 'n' 'nw' 'w' 'sw' 's' 'se' (the eight arrows; 'e' to the right).
   `t` everywhere is the layer's own seconds - the timeline's (it starts at 0).
   ═══════════════════════════════════════════════════════════════════════════ */

import { normalizeOpacity, normalizeBlend, isPattern } from './look.js';
import * as T from '../i18n/t.js';

export const REF = 2160;         // the file size whose pixel, at 100 %, is a frame's long side / 2160
export const SCALE = { min: 0.25, max: 4, step: 0.05 };
export const ROTATE = { min: 0.5, max: 20, step: 0.5, def: 2 };
export const DRIFT = { min: 5, max: 200, step: 5, def: 20 };
export const MOVES = [['none', T.t('Still')], ['rotate', T.t('Rotate')], ['drift', T.t('Drift')]];
// The eight ways of a drift: id, arrow, the angle on the screen (0 = to the right, counter-clockwise as on a map).
export const DIRS = [['e', '→', 0], ['ne', '↗', 45], ['n', '↑', 90], ['nw', '↖', 135],
  ['w', '←', 180], ['sw', '↙', 225], ['s', '↓', 270], ['se', '↘', 315]];
const DIR_IDS = new Set(DIRS.map(d => d[0]));

const _num = (v, lo, hi, dflt) => { const n = +v; return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : dflt; };
const _hex = (v) => (/^#[0-9a-f]{6}$/i.test(String(v || '')) ? String(v).toLowerCase() : '#ffffff');

/** A pattern's settings (`c.pattern` of an entry of main video's `patterns`), every field filled in. */
export function of(c) {
  const p = (c && c.pattern) || {};
  const move = ['rotate', 'drift'].includes(p.move) ? p.move : 'none';
  const lim = move === 'drift' ? DRIFT : ROTATE;
  return {
    scale: Math.round(_num(p.scale, SCALE.min, SCALE.max, 1) * 100) / 100,
    color: _hex(p.color),
    angle: Math.round(((_num(p.angle, -360, 720, 0) % 360) + 360) % 360),
    move,
    speed: move === 'none' ? 0 : Math.round(_num(p.speed, lim.min, lim.max, lim.def) * 10) / 10,
    dir: move === 'drift' ? (DIR_IDS.has(p.dir) ? p.dir : 'e') : (p.dir === 'ccw' ? 'ccw' : 'cw'),
  };
}

/** What is stored: only what differs from the defaults, or null when nothing does. */
export function normalize(p) {
  if (!p || typeof p !== 'object') return null;
  const f = of({ pattern: p });
  const out = {};
  if (f.scale !== 1) out.scale = f.scale;
  if (f.color !== '#ffffff') out.color = f.color;
  if (f.angle) out.angle = f.angle;
  if (f.move !== 'none') { out.move = f.move; out.speed = f.speed; out.dir = f.dir; }
  return Object.keys(out).length ? out : null;
}

/** One tile's side in frame pixels - whole pixels, the same in the preview and the render. */
export function tileSize(fileSize, W, H, scale) {
  return Math.max(2, Math.round((+fileSize || REF) * Math.max(W, H) / REF * (+scale || 1)));
}

/** The tiles' turn at `t`, in degrees, clockwise on the screen. */
export function angleAt(f, t) {
  return f.angle + (f.move === 'rotate' ? (f.dir === 'ccw' ? -1 : 1) * f.speed * Math.max(0, +t || 0) : 0);
}

/** A drift's speed on the screen, frame pixels a second: { vx, vy } (y down); 0 when it does not drift. */
export function driftVelocity(f, W, H) {
  if (f.move !== 'drift') return { vx: 0, vy: 0 };
  const d = DIRS.find(x => x[0] === f.dir) || DIRS[0];
  const px = f.speed * Math.min(W, H) / 1080;
  const a = d[2] * Math.PI / 180;
  return { vx: px * Math.cos(a), vy: -px * Math.sin(a) };
}

/** How far the tiles have slid by `t`, frame pixels on the screen. */
export function driftAt(f, t, W, H) {
  const v = driftVelocity(f, W, H);
  const s = Math.max(0, +t || 0);
  return { x: v.vx * s, y: v.vy * s };
}

/** The frame's diagonal, rounded up to an EVEN number of tiles - a square that covers the frame at any turn, a tile corner
 *  at its middle (the render's baked square, lib/pattern-bake.js). */
export function coverSide(tile, W, H) {
  const n = Math.ceil(Math.hypot(W, H) / tile);
  return (n + (n % 2)) * tile;
}

// ── The patterns of main video ──────────────────────────────────────────────

/** One entry of main video's `patterns` as stored: { src, pattern?, opacity?, blend? }, or null when it is no pattern. */
export function normalizeLayer(p) {
  if (!p || typeof p !== 'object' || !isPattern(p.src)) return null;
  const out = { src: String(p.src).split(/[?#]/)[0] };
  const pt = normalize(p.pattern);
  if (pt) out.pattern = pt;
  const op = normalizeOpacity(p.opacity);
  if (op != null) out.opacity = op;
  const bl = normalizeBlend(p.blend);
  if (bl) out.blend = bl;
  return out;
}

/** The whole list as stored - top layer first, each pattern once (the first kept), no limit of how many. */
export function normalizeLayers(list) {
  const out = [];
  const seen = new Set();
  for (const p of (Array.isArray(list) ? list : [])) {
    const x = normalizeLayer(p);
    if (!x || seen.has(x.src)) continue;
    seen.add(x.src);
    out.push(x);
  }
  return out;
}

/** The main video lane - the bottom video lane (tracks are listed top first) - or null. */
export function mainLane(tl) {
  const vids = ((tl && tl.tracks) || []).filter((t) => t && t.kind === 'video');
  return vids.length ? vids[vids.length - 1] : null;
}

/** Where main video ends, in seconds of the timeline - 0 when nothing is on it. */
export function mainEnd(tl) {
  const m = mainLane(tl);
  let end = 0;
  for (const c of ((m && m.clips) || [])) if (c && c.src) end = Math.max(end, (+c.start || 0) + (+c.dur || 0));
  return end;
}

/** The id a layer is known by while it is drawn (the preview's live patches, the render's baked tiles). */
export const layerId = (src) => 'pattern:' + String(src || '');

/** What is drawn over the video lanes: main video's patterns as clips of 0..its end, the BOTTOM layer first; [] for none. */
export function layersOf(tl) {
  const m = mainLane(tl);
  const list = normalizeLayers(m && m.patterns);
  const end = mainEnd(tl);
  if (!list.length || !(end > 0)) return [];
  return list.slice().reverse().map((p) => ({ ...p, id: layerId(p.src), start: 0, dur: end, layer: true }));
}
