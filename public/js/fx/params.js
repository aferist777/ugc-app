/* ═══════════════════════════════════════════════════════════════════════════
   A CLIP'S EFFECTS - WHERE THEY ARE AND WHAT THEY ADD UP TO (phase V84; docs/local-app/plan/, "Подфаза 3 — V84"). ONE module for
   the page (js/merge-v3/preview-b.js through fx-draw.js, inspector, timeline) and the server (lib/timeline-shape.js,
   lib/fx-render.js - require()d as overlay/color.js is).

   THE RECORD on a clip of a video lane, a film or a picture - `fx`, absent when it has none:
     [{ id, k, t0, len }]   k - the effect (effects.js EFFECTS); t0 - the FILE's second it starts at (a trim, a split, a copy, cut
                            silence keep it on the same moment of the picture, as the frame's path does - framing/path.js); len -
                            its length in the timeline's seconds, absent - to the clip's end. A list in the order they were added.
   THE OWNER'S (эф4): an effect covers the whole clip - added, it starts with the clip; a moment of its own length ('intro') lasts
   that length (the clip's, when shorter), one that goes on ('loop') lasts to the clip's end; the inspector moves its start and end.
   Its clock τ is the timeline's seconds from where it starts (a clip played faster gets through it in fewer seconds of the file).

   WHAT THEY ADD UP TO (paramsAt): every effect running at a moment, read at its τ, made ONE set of numbers - always in this order:
   the colour matrix, then the move, then the channels, the pixels, (block 1c) the face's mosaic and the blur, the vignette, the
   lines. (block 1c) An effect by the face keeps where the face is in `path` (effects.js faceAt) - found by the page when it is
   added (js/merge-v3/fx-ui.js), the same numbers for the preview and the render. The move is a similarity in the
   frame's PIXELS - { a, b, e, f }: x' = a·x − b·y + e, y' = b·x + a·y + f - each effect's after the one before it (the list's
   order); colours likewise; channels add up; the pixel block, the vignette and the lines take the largest.
   `anchor` - the clip's middle, shares of the frame: the middle of the frame for a clip of main video or one covering the frame,
   the middle of its box for an insert (the render knows it from the same fields).
   ═══════════════════════════════════════════════════════════════════════════ */

import { effectOf, COL_ID, colThen, MOSAIC_BLOCK } from './effects.js';

export const FX_MAX = 20;
const r3 = (x) => Math.round(x * 1000) / 1000;
const STILL_RE = /\.(jpe?g|png|webp|avif|bmp)$/i;
const _still = (c) => !!c && STILL_RE.test(String(c.src || '').split('?')[0]);
const _rev = (c) => !!(c && c.reversed && !_still(c));
const _sp = (c) => (+(c && c.speed) > 0 ? +c.speed : 1);

/** An effect's length range in the timeline's seconds - [lo, hi]; a 'loop' any length from 0.3 s. */
export function lengthRange(k) {
  const d = effectOf(k);
  if (!d) return [0.3, 3600];
  if (d.kind !== 'intro') return [0.3, 3600];
  return [r3(d.dur * d.lo), r3(d.dur * d.hi)];
}

/** What is stored: every effect the program knows, its numbers valid - or null, and the field is left off the clip. */
export function normalizeFx(list) {
  if (!Array.isArray(list)) return null;
  const out = [];
  const seen = new Set();
  for (const e of list) {
    if (!e || typeof e !== 'object' || !effectOf(e.k) || !Number.isFinite(+e.t0)) continue;
    let id = String(e.id || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32);
    if (!id || seen.has(id)) id = 'fx' + out.length + '_' + Math.round(Math.abs(+e.t0) * 1000).toString(36);
    seen.add(id);
    const one = { id, k: String(e.k), t0: r3(Math.max(0, +e.t0)) };
    if (e.len != null && Number.isFinite(+e.len) && +e.len > 0) {
      const [lo, hi] = lengthRange(one.k);
      one.len = r3(Math.max(lo, Math.min(hi, +e.len)));
    }
    // (block 1c) Where the face is - an effect by the face only: [[the file's second, x, y, w, h], ...] (effects.js faceAt), and
    // `pk` - how the clip lay in the frame when it was found (js/merge-v3/fx-ui.js).
    if (effectOf(one.k).face) {
      const path = normalizePath(e.path);
      if (path) one.path = path;
      if (typeof e.pk === 'string' && /^[a-z0-9]{1,12}$/.test(e.pk)) one.pk = e.pk;
    }
    out.push(one);
    if (out.length >= FX_MAX) break;
  }
  return out.length ? out : null;
}

/** (block 1c) A face's path as it is kept: at most PATH_MAX samples in the order of their seconds, each five numbers. */
export const PATH_MAX = 1500;
const r4 = (x) => Math.round(x * 10000) / 10000;
export function normalizePath(list) {
  if (!Array.isArray(list)) return null;
  const out = [];
  let last = -1;
  for (const p of list) {
    if (!Array.isArray(p) || p.length < 5) continue;
    const v = p.slice(0, 5).map(Number);
    if (!v.every(Number.isFinite) || v[0] < 0 || v[0] <= last) continue;
    if (!(v[3] > 0 && v[4] > 0)) continue;
    last = v[0];
    out.push([r3(v[0]), r4(v[1]), r4(v[2]), r4(Math.min(4, v[3])), r4(Math.min(4, v[4]))]);
    if (out.length >= PATH_MAX) break;
  }
  return out.length ? out : null;
}

/** Whether a clip has any effect at all. */
export const hasFx = (c) => !!(c && Array.isArray(c.fx) && c.fx.length);

/** The FILE's second clip `c` shows at the timeline's moment `t` (preview-b.js fileTimeAt's rule). */
export function fileAt(c, t) {
  const sp = _sp(c);
  const into = Math.max(0, Math.min(+c.dur || 0, (+t) - (+c.start || 0))) * sp;
  return _rev(c) ? (+c.trimIn || 0) + (+c.dur || 0) * sp - into : (+c.trimIn || 0) + into;
}

/** The timeline's moment the clip shows the file's second `tf` - where an effect starting there starts. */
export function timeOfFile(c, tf) {
  const sp = _sp(c);
  const start = +c.start || 0, trim = +c.trimIn || 0;
  return _rev(c) ? start + (trim + (+c.dur || 0) * sp - tf) / sp : start + (tf - trim) / sp;
}

/**
 * Where effect `e` of clip `c` runs on the timeline: { a, b, len, whole } - a its start, b its end (cut to the clip), len its
 * own length (its stretch is read against it), `whole` - it runs to the clip's end by itself ('loop' with no length).
 */
export function spanOf(c, e) {
  const d = effectOf(e && e.k);
  const s = +c.start || 0, end = s + (+c.dur || 0);
  const a = timeOfFile(c, +e.t0 || 0);
  const whole = !(e.len > 0) && !!d && d.kind !== 'intro';
  let len = e.len > 0 ? +e.len : (d && d.kind === 'intro' ? d.dur : Math.max(0, end - a));
  if (!(len > 0)) len = 0;
  return { a, b: Math.min(end, a + len), len, whole };
}

/** A new effect `k` for clip `c` - the owner's (эф4): from the clip's start; an 'intro' its length, or the clip's when shorter. */
export function newEffect(c, k, id) {
  const d = effectOf(k);
  if (!d) return null;
  const e = { id: id || ('fx' + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36)), k, t0: r3(fileAt(c, +c.start || 0)) };
  if (d.kind === 'intro') {
    const [lo, hi] = lengthRange(k);
    e.len = r3(Math.max(lo, Math.min(hi, Math.min(d.dur, +c.dur || d.dur))));
  }
  return e;
}

/**
 * The same effect moved to start `from` seconds into the clip and end `to` seconds into it (the inspector's Start / End): t0 the
 * file's second shown there; the length to `to`, kept in its range (an 'intro'); a 'loop' to the clip's end gets no length.
 */
export function placeEffect(c, e, from, to) {
  const dur = +c.dur || 0;
  const s = +c.start || 0;
  const a = Math.max(0, Math.min(dur, +from || 0));
  const out = { ...e, t0: r3(fileAt(c, s + a)) };
  const d = effectOf(e.k);
  let len = Math.max(0.05, (+to || 0) - a);
  if (d && d.kind !== 'intro' && a + len >= dur - 0.01) { delete out.len; return out; }
  const [lo, hi] = lengthRange(e.k);
  out.len = r3(Math.max(lo, Math.min(hi, len)));
  return out;
}

/** The clip's middle for its effects, shares of the frame (see the header). */
export function anchorOf(c, main) {
  if (main) return { x: 0.5, y: 0.5 };
  const placed = c && c.tw != null && +c.tw > 0;
  const crop = !!(c && c.crop && !c.crop.off);
  if (!placed && !crop) return { x: 0.5, y: 0.5 };
  const x = c.tx == null ? 0.5 : Math.max(0, Math.min(1, +c.tx));
  const y = c.ty == null ? 0.5 : Math.max(0, Math.min(1, +c.ty));
  return { x, y };
}

// ── Adding them up ──────────────────────────────────────────────────────────
// A similarity { a, b, e, f }: x' = a·x − b·y + e, y' = b·x + a·y + f.
const MOVE_ID = { a: 1, b: 0, e: 0, f: 0 };
/** B after A. */
function moveThen(A, B) {
  return {
    a: B.a * A.a - B.b * A.b,
    b: B.b * A.a + B.a * A.b,
    e: B.a * A.e - B.b * A.f + B.e,
    f: B.b * A.e + B.a * A.f + B.f,
  };
}
/** One effect's move in pixels of a W x H frame: scaled by s about (ax, ay), turned by rot degrees about the middle, moved. */
function _moveOf(n, W, H, anchor) {
  const s = n.s != null ? +n.s : 1;
  const rot = +n.rot || 0;
  const ax = (n.ax != null ? +n.ax : anchor.x) * W, ay = (n.ay != null ? +n.ay : anchor.y) * H;
  let m = { ...MOVE_ID };
  if (rot) {
    const th = rot * Math.PI / 180, c = Math.cos(th), si = Math.sin(th), cx = W / 2, cy = H / 2;
    m = { a: c, b: si, e: cx - (c * cx - si * cy), f: cy - (si * cx + c * cy) };
  }
  if (s !== 1) m = moveThen(m, { a: s, b: 0, e: ax - s * ax, f: ay - s * ay });
  if (n.dx || n.dy) m = moveThen(m, { a: 1, b: 0, e: (+n.dx || 0) * W, f: (+n.dy || 0) * H });
  // (block 1b) A measured camera's move, its e and f shares of the frame.
  if (n.mv) m = moveThen(m, { a: +n.mv.a, b: +n.mv.b, e: (+n.mv.e || 0) * W, f: (+n.mv.f || 0) * H });
  return m;
}

/** How much the moved picture must be zoomed about the frame's middle to cover the whole frame (no empty corner) - 1 or more. */
function _coverFactor(m, W, H) {
  const inv = (q, k) => {
    // q through (scale k about the middle ∘ m) backwards: m⁻¹ of the point scaled back about the middle.
    const x = W / 2 + (q[0] - W / 2) / k, y = H / 2 + (q[1] - H / 2) / k;
    const det = m.a * m.a + m.b * m.b;
    const dx = x - m.e, dy = y - m.f;
    return [(m.a * dx + m.b * dy) / det, (-m.b * dx + m.a * dy) / det];
  };
  const inside = (k) => [[0, 0], [W, 0], [0, H], [W, H]].every((q) => {
    const p = inv(q, k);
    return p[0] >= -0.5 && p[0] <= W + 0.5 && p[1] >= -0.5 && p[1] <= H + 0.5;
  });
  if (inside(1)) return 1;
  let lo = 1, hi = 1.6;
  for (let i = 0; i < 24; i++) { const k = (lo + hi) / 2; if (inside(k)) hi = k; else lo = k; }
  return hi;
}
// ONE zoom for the whole effect - the largest its camera ever needs (over its measured path, sampled at 30 a second): the frame
// does not breathe with the sway, and the render's scaler keeps one size (built once, not at every frame).
const _covers = new Map();
function _coverOf(k, W, H) {
  const key = k + '|' + W + 'x' + H;
  if (_covers.has(key)) return _covers.get(key);
  const d = effectOf(k);
  let most = 1;
  for (let i = 0; i <= 12 * 30; i++) {
    const n = d.at(i / 30) || {};
    if (n.mv) most = Math.max(most, _coverFactor(_moveOf(n, W, H, { x: 0.5, y: 0.5 }), W, H));
  }
  most = Math.ceil(most * 1000) / 1000;
  _covers.set(key, most);
  return most;
}

/**
 * Every effect of clip `c` running at the timeline's moment `t`, added up for a W x H frame (pixels): null when none runs, else
 * { move: { a, b, e, f } | null, col: [12] | null, ch: { rx, ry, gx, gy, bx, by } | null (u), px (u) | 0, vig 0..1, lines 0..1 }.
 */
export function paramsAt(c, t, W, H, main) {
  if (!hasFx(c)) return null;
  const s = +c.start || 0, end = s + (+c.dur || 0);
  if (!(t >= s - 1e-6 && t < end)) return null;
  const anchor = anchorOf(c, main);
  const tf = fileAt(c, t);
  let move = null, col = null, ch = null, px = 0, vig = 0, lines = 0, glow = 0, blurV = 0, stripes = 0, grain = 0, cover = 1, any = false;
  let blur = 0, mos = null, jitter = null;
  for (const e of c.fx) {
    const d = effectOf(e.k);
    if (!d) continue;
    const sp = spanOf(c, e);
    if (!(t >= sp.a - 1e-6 && t < sp.b)) continue;
    let tau = t - sp.a;
    if (d.kind === 'intro' && sp.len > 0) tau = tau * d.dur / sp.len;
    const n = d.at(Math.max(0, tau), e, tf) || {};
    any = true;
    if (n.blur > blur) blur = +n.blur;
    if (n.mosaic && !mos) mos = n.mosaic;
    // (block 3; block 4a - every lane) What only the page draws: the render lays the copy the app's window baked with this code.
    if (n.jitter && d.engine && !jitter) jitter = n.jitter;
    if ((n.s != null && Math.abs(n.s - 1) > 1e-6) || n.rot || n.dx || n.dy || n.mv) move = moveThen(move || MOVE_ID, _moveOf(n, W, H, anchor));
    if (n.cover) cover = Math.max(cover, _coverOf(e.k, W, H));
    if (n.col) col = colThen(col || COL_ID, n.col);
    if (n.ch) {
      ch = ch || { rx: 0, ry: 0, gx: 0, gy: 0, bx: 0, by: 0 };
      for (const k of Object.keys(ch)) ch[k] += +n.ch[k] || 0;
    }
    if (n.px > px) px = +n.px;
    if (n.vig > vig) vig = +n.vig;
    if (n.lines > lines) lines = +n.lines;
    if (n.glow > glow) glow = +n.glow;
    if (n.blurV > blurV) blurV = +n.blurV;
    if (n.stripes > stripes) stripes = +n.stripes;
    if (n.grain > grain) grain = +n.grain;
  }
  if (!any) return null;
  if (move && cover > 1) move = moveThen(move, { a: cover, b: 0, e: W / 2 - cover * W / 2, f: H / 2 - cover * H / 2 });
  // (block 1c) The mosaic's box in pixels: the face's middle carried by the move (the oval sits on the face where the move puts
  // it), the size the clip's one (mosaicSizeOf - the render has one mask a clip), the corner on a whole pixel.
  let mosaic = null;
  if (mos) {
    let cx = mos.x * W, cy = mos.y * H;
    if (move) { const x = move.a * cx - move.b * cy + move.e; cy = move.b * cx + move.a * cy + move.f; cx = x; }
    const sz = mosaicSizeOf(c, W, H) || _evenBox(mos.w * W, mos.h * H);
    mosaic = { x: Math.round(cx - sz.w / 2), y: Math.round(cy - sz.h / 2), w: sz.w, h: sz.h, b: MOSAIC_BLOCK };
  }
  return { move, col, ch, px, vig, lines, glow, blurV, stripes, grain, blur, mosaic, jitter };
}

/**
 * (block 3) Where clip `c` needs the bake engine: the timeline's stretches [[a, b], ...] of its effects with `engine: true`,
 * merged - there every effect of the clip is drawn by the page's code in the app's window (lib/fx-bake.js) and the render lays
 * that copy (lib/mv3b-render.js). Block 4a (the owner's (б4-1)): on every video lane - above main the copy carries its alpha.
 * None on a band (the halfer's) - nothing is drawn there.
 */
export function engineSpans(c) {
  if (!hasFx(c) || c.halfer || c.layer) return [];
  const out = [];
  for (const e of c.fx) {
    const d = effectOf(e.k);
    if (!d || !d.engine) continue;
    const s = spanOf(c, e);
    if (s.b > s.a + 1e-4) out.push([Math.max(+c.start || 0, s.a), s.b]);
  }
  out.sort((x, y) => x[0] - y[0]);
  const m = [];
  for (const sp of out) {
    const l = m[m.length - 1];
    if (l && sp[0] <= l[1] + 1e-4) l[1] = Math.max(l[1], sp[1]);
    else m.push(sp.slice());
  }
  return m;
}

const _evenBox = (w, h) => ({ w: Math.max(2, Math.round(w / 2) * 2), h: Math.max(2, Math.round(h / 2) * 2) });
/**
 * (block 1c) The size in pixels of a W x H frame of clip `c`'s face mosaic - its first mosaic's, at its start (one size a clip:
 * the render lays one oval mask, lib/fx-assets.js) - or null when it has none.
 */
export function mosaicSizeOf(c, W, H) {
  const e = (Array.isArray(c && c.fx) ? c.fx : []).find((x) => x && x.k === 'mosaic');
  if (!e) return null;
  const n = effectOf('mosaic').at(0, e, +e.t0 || 0).mosaic;
  return _evenBox(n.w * W, n.h * H);
}

/** Whether a set of numbers leaves the picture as it is. */
export function isPlain(p) {
  if (!p) return true;
  const m = p.move;
  const still = !m || (Math.abs(m.a - 1) < 1e-6 && Math.abs(m.b) < 1e-6 && Math.abs(m.e) < 1e-3 && Math.abs(m.f) < 1e-3);
  const colId = !p.col || p.col.every((v, i) => Math.abs(v - COL_ID[i]) < 1e-5);
  const chZ = !p.ch || Object.values(p.ch).every((v) => Math.abs(v) < 0.5);
  return still && colId && chZ && !(p.px > 1.5) && !(p.vig > 0.002) && !(p.lines > 0.002)
    && !(p.glow > 0.002) && !(p.blurV > 0.05) && !(p.stripes > 0.002) && !(p.grain > 0.002) && !(p.blur > 0.05) && !p.mosaic && !p.jitter;
}
