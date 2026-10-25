/* ═══════════════════════════════════════════════════════════════════════════
   CAPTIONS — A TEXT LINE WITH ITS ENTRANCE AND ITS EXIT (phase V42; the owner's (о14)-(о17), (ц1)-(ц4), 2026-10-24).

   A line of a TEXT lane (a title, a hook, a label) that wears an entrance, an exit, a plate, a tilt or a glow is drawn here;
   any other is drawn by ass.js as it always was (usesFx). ONE module for the render, the preview's libass (JASSUB) and the
   preset tiles (lib/caption-tiles.js), like the rest of captions/.

   A line is drawn as UNITS: the whole block, its rows, its words or its letters - whatever its motions move (the finer of
   the two). Every unit sits where libass lays it (place.js drawnPage / boxOf, the letters' own advances in measure.js) and is
   drawn \an5 at its own middle, so it can grow, turn and travel about itself. A motion is a function of its progress p
   (0..1) saying how far the unit is off its rest: {dx, dy} ems, {s, sx, sy} percent, {rz} degrees, {a} 0..1 seen, {blur} px,
   {fsp} ems of extra spacing, {cl, cr} a wipe's clip as fractions of the line's width, {rgb} ems of a glitch's colour split.
   It is SAMPLED into short pieces (60-80 ms): each piece is one event moving linearly (\move, \t) to the next sample, so any
   curve - an overshoot, a bounce - is drawn by libass alone, the same in the preview and the render. A motion of the whole
   block put on finer units moves them as one block: they grow, turn and shrink about the block's middle.

   Layers of a line (four, as a caption lane has): +0 the plate (\p drawings: box, rounded, pill, marker, underline, circle,
   tag, sticker - one drawing, its overlapping paths filled once), +1 the glow or a glitch's colour copies, +2 the letters'
   outline and shadow when the units are many (a unit's outline must not cover its neighbour's letters), +3 the letters.

   Motions and timings are our own, after ideas from FFCreator lib/animate/effects.js (MIT), Remocn (MIT), Animista (BSD),
   Magic UI (MIT), RVE remotion-templates (MIT per its README) and lyger-Aegisub-Scripts (MIT) - no code taken.

   PURE: it returns lines of an .ass file.
   ═══════════════════════════════════════════════════════════════════════════ */

import { cased } from './style.js';
import { hexToAss, assTime, assText } from './ass.js';
import { drawnPage, boxOf } from './place.js';
import { meter, padOf } from './measure.js';
import { assFace, fontOf } from './fonts.js';

// ── Small things ────────────────────────────────────────────────────────────
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const outC = (t) => 1 - Math.pow(1 - t, 3);
const inC = (t) => t * t * t;
const inOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const outBack = (t, k) => 1 + (k + 1) * Math.pow(t - 1, 3) + k * Math.pow(t - 1, 2);
function outBounce(t) {
  const n = 7.5625, d = 2.75;
  if (t < 1 / d) return n * t * t;
  if (t < 2 / d) { t -= 1.5 / d; return n * t * t + 0.75; }
  if (t < 2.5 / d) { t -= 2.25 / d; return n * t * t + 0.9375; }
  t -= 2.625 / d;
  return n * t * t + 0.984375;
}
const seg = (p, a, b) => clamp((p - a) / (b - a), 0, 1);
const R = Math.round;
const f1 = (v) => String(Math.round(v * 10) / 10);
const hex2 = (n) => clamp(R(n), 0, 255).toString(16).toUpperCase().padStart(2, '0');
const col = (hex) => hexToAss(hex, 0).replace(/^&H00/, '&H') + '&';
const opaque = (opacity) => 255 * (1 - clamp(+opacity, 0, 1));
// A deterministic jitter in -1..1: a glitch draws the same in the preview and the render.
const jit = (i, k) => { const x = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453; return (x - Math.floor(x)) * 2 - 1; };
const pop = (p, from, over, at) => (p < at ? lerp(from, over, outC(p / at)) : lerp(over, 100, inOut((p - at) / (1 - at))));

// ── The motions ─────────────────────────────────────────────────────────────
// `by`: what moves - 'block' (the whole text), 'row', 'word', 'letter'. `unit`: the share of the motion's length one of many
// units takes (the rest is the stagger; 0 - at once, one after another). `steps`: drawn as still frames per second (a
// flicker, a glitch), not tweened. `clipRow`: seen only inside its row while it moves (a slot). `cursor`: a typewriter's.
// ENTER: p 0 hidden -> 1 at rest. LEAVE: p 0 at rest -> 1 gone. Keyed by style.js ENTERS / LEAVES.
export const ENTER = {
  none: { by: 'block', f: () => ({}) },
  fade: { by: 'block', f: (p) => ({ a: outC(p) }) },
  pop: { by: 'block', f: (p) => ({ a: seg(p, 0, 0.3), s: pop(p, 30, 112, 0.6) }) },
  zoom: { by: 'block', f: (p) => ({ a: outC(seg(p, 0, 0.7)), s: lerp(260, 100, outC(p)), blur: lerp(10, 0, outC(p)) }) },
  grow: { by: 'block', f: (p) => ({ a: outC(seg(p, 0, 0.5)), s: lerp(40, 100, outBack(p, 1.2)) }) },
  rise: { by: 'block', f: (p) => ({ a: outC(seg(p, 0, 0.8)), dy: lerp(0.7, 0, outC(p)) }) },
  'from-left': { by: 'block', f: (p) => ({ a: outC(seg(p, 0, 0.6)), dx: lerp(-2.2, 0, outC(p)) }) },
  'from-right': { by: 'block', f: (p) => ({ a: outC(seg(p, 0, 0.6)), dx: lerp(2.2, 0, outC(p)) }) },
  drop: { by: 'block', f: (p) => ({ a: seg(p, 0, 0.15), dy: lerp(-2.5, 0, outBounce(p)) }) },
  // (phase V49) From the top with no bounce - the subtitles' new In; a text line wearing it moves the same way.
  'from-top': { by: 'block', f: (p) => ({ a: outC(seg(p, 0, 0.8)), dy: lerp(-0.7, 0, outC(p)) }) },
  blur: { by: 'block', f: (p) => ({ a: outC(p), blur: lerp(14, 0, outC(p)), s: lerp(106, 100, outC(p)) }) },
  stretch: { by: 'block', f: (p) => ({ a: outC(seg(p, 0, 0.6)), fsp: lerp(0.55, 0, outC(p)), sx: lerp(118, 100, outC(p)) }) },
  swing: { by: 'block', f: (p) => ({ a: seg(p, 0, 0.25), rz: lerp(-14, 0, outBack(p, 2.6)), s: lerp(60, 100, outBack(p, 1.6)) }) },
  wipe: { by: 'block', f: (p) => ({ cr: inOut(p) }) },
  'mask-rise': { by: 'row', unit: 0.75, clipRow: true, f: (p) => ({ dy: lerp(1.05, 0, outC(p)) }) },
  rows: { by: 'row', unit: 0.7, f: (p) => ({ a: outC(seg(p, 0, 0.7)), dy: lerp(0.8, 0, outC(p)) }) },
  words: { by: 'word', unit: 0.55, f: (p) => ({ a: outC(seg(p, 0, 0.6)), dy: lerp(0.55, 0, outC(p)) }) },
  'words-pop': { by: 'word', unit: 0.5, f: (p) => ({ a: seg(p, 0, 0.25), s: pop(p, 20, 116, 0.6) }) },
  letters: { by: 'letter', unit: 0.45, f: (p) => ({ a: outC(seg(p, 0, 0.7)), dy: lerp(0.45, 0, outC(p)) }) },
  'letters-pop': { by: 'letter', unit: 0.4, f: (p) => ({ a: seg(p, 0, 0.2), s: pop(p, 0, 125, 0.55) }) },
  'letters-drop': { by: 'letter', unit: 0.5, f: (p) => ({ a: seg(p, 0, 0.12), dy: lerp(-1.6, 0, outBounce(p)), rz: lerp(18, 0, outC(p)) }) },
  typewriter: { by: 'letter', unit: 0, cursor: true, f: (p) => ({ a: p > 0 ? 1 : 0 }) },
  glitch: { by: 'block', steps: 28, f: (p, i) => (p >= 1 ? {} : {
    a: p < 0.08 ? 0 : (jit(i, 3) > -0.55 ? 1 : 0.25), dx: jit(i, 1) * 0.18 * (1 - p), dy: jit(i, 2) * 0.05 * (1 - p),
    rgb: (0.06 + 0.12 * Math.abs(jit(i, 4))) * (1 - p), sx: 100 + jit(i, 5) * 12 * (1 - p) }) },
  flicker: { by: 'block', steps: 24, f: (p) => ({ a: p >= 1 ? 1 : [0, 0.9, 0, 0, 1, 0.2, 1, 0.6, 1, 1][Math.min(9, Math.floor(p * 10))] }) },
};

export const LEAVE = {
  none: { by: 'block', f: () => ({}) },
  fade: { by: 'block', f: (p) => ({ a: 1 - p }) },
  pop: { by: 'block', f: (p) => ({ a: 1 - seg(p, 0.7, 1), s: p < 0.3 ? lerp(100, 110, outC(p / 0.3)) : lerp(110, 0, inC((p - 0.3) / 0.7)) }) },
  zoom: { by: 'block', f: (p) => ({ a: 1 - inC(p), s: lerp(100, 230, inC(p)), blur: lerp(0, 10, p) }) },
  shrink: { by: 'block', f: (p) => ({ a: 1 - seg(p, 0.4, 1), s: lerp(100, 30, inC(p)) }) },
  rise: { by: 'block', f: (p) => ({ a: 1 - seg(p, 0.2, 1), dy: lerp(0, -0.7, inC(p)) }) },
  sink: { by: 'block', f: (p) => ({ a: 1 - seg(p, 0.2, 1), dy: lerp(0, 0.7, inC(p)) }) },
  'to-left': { by: 'block', f: (p) => ({ a: 1 - seg(p, 0.4, 1), dx: lerp(0, -2.2, inC(p)) }) },
  'to-right': { by: 'block', f: (p) => ({ a: 1 - seg(p, 0.4, 1), dx: lerp(0, 2.2, inC(p)) }) },
  fall: { by: 'block', f: (p) => ({ a: 1 - seg(p, 0.6, 1), dy: lerp(0, 3, inC(p)), rz: lerp(0, -10, inC(p)) }) },
  blur: { by: 'block', f: (p) => ({ a: 1 - inC(p), blur: lerp(0, 14, p), s: lerp(100, 106, p) }) },
  stretch: { by: 'block', f: (p) => ({ a: 1 - seg(p, 0.3, 1), fsp: lerp(0, 0.55, inC(p)), sx: lerp(100, 118, inC(p)) }) },
  wipe: { by: 'block', f: (p) => ({ cl: inOut(p) }) },
  'mask-sink': { by: 'row', unit: 0.75, clipRow: true, f: (p) => ({ dy: lerp(0, 1.05, inC(p)) }) },
  rows: { by: 'row', unit: 0.7, f: (p) => ({ a: 1 - seg(p, 0.3, 1), dy: lerp(0, -0.8, inC(p)) }) },
  words: { by: 'word', unit: 0.55, f: (p) => ({ a: 1 - seg(p, 0.3, 1), dy: lerp(0, -0.55, inC(p)) }) },
  letters: { by: 'letter', unit: 0.45, f: (p) => ({ a: 1 - seg(p, 0.3, 1), dy: lerp(0, 0.45, inC(p)) }) },
  'letters-fall': { by: 'letter', unit: 0.5, f: (p) => ({ a: 1 - seg(p, 0.6, 1), dy: lerp(0, 1.8, inC(p)), rz: lerp(0, -25, inC(p)) }) },
  backspace: { by: 'letter', unit: 0, cursor: true, reverse: true, f: (p) => ({ a: p > 0 ? 0 : 1 }) },
  glitch: { by: 'block', steps: 28, f: (p, i) => (p <= 0 ? {} : {
    a: p > 0.92 ? 0 : (jit(i, 7) > -0.55 ? 1 : 0.25), dx: jit(i, 1) * 0.18 * p, dy: jit(i, 2) * 0.05 * p,
    rgb: (0.06 + 0.12 * Math.abs(jit(i, 4))) * p, sx: 100 + jit(i, 5) * 12 * p }) },
  flicker: { by: 'block', steps: 24, f: (p) => ({ a: p <= 0 ? 1 : [1, 0.3, 1, 0, 0.8, 0, 0, 0.5, 0, 0][Math.min(9, Math.floor(p * 10))] }) },
};

// The old way a text line arrived (`appear`, K3), read as an entrance when the line has none of the new.
const APPEAR_AS = { pop: 'pop', fade: 'fade', slide: 'rise' };
// `at-once` (phase V49): an entrance chosen to be none - the old way goes too.
const enterOf = (st) => (st.enter === 'at-once' ? 'none' : st.enter && st.enter !== 'none' ? st.enter : APPEAR_AS[st.appear] || 'none');

/** Is this text line drawn here (an entrance, an exit, a plate, a tilt or a glow) - or by ass.js, as it always was? */
export function usesFx(st) {
  const s = st || {};
  return (!!s.enter && s.enter !== 'none' && s.enter !== 'at-once') || (!!s.leave && s.leave !== 'none') || (!!s.plate && s.plate !== 'none')
    || Math.abs(+s.tilt || 0) > 0.05 || (+s.glow || 0) > 0;
}

// ── The plates ──────────────────────────────────────────────────────────────
// Coordinates are the drawing's own, from 0,0; the drawing is placed \an5 at its middle.
function _rrect(x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  const X = (v) => R(x + v), Y = (v) => R(y + v);
  if (r < 1) return 'm ' + X(0) + ' ' + Y(0) + ' l ' + X(w) + ' ' + Y(0) + ' ' + X(w) + ' ' + Y(h) + ' ' + X(0) + ' ' + Y(h);
  const k = r * 0.4477;                                   // 1 - 0.5523: a quarter circle's control points
  return 'm ' + X(r) + ' ' + Y(0) + ' l ' + X(w - r) + ' ' + Y(0)
    + ' b ' + X(w - k) + ' ' + Y(0) + ' ' + X(w) + ' ' + Y(k) + ' ' + X(w) + ' ' + Y(r)
    + ' l ' + X(w) + ' ' + Y(h - r)
    + ' b ' + X(w) + ' ' + Y(h - k) + ' ' + X(w - k) + ' ' + Y(h) + ' ' + X(w - r) + ' ' + Y(h)
    + ' l ' + X(r) + ' ' + Y(h)
    + ' b ' + X(k) + ' ' + Y(h) + ' ' + X(0) + ' ' + Y(h - k) + ' ' + X(0) + ' ' + Y(h - r)
    + ' l ' + X(0) + ' ' + Y(r)
    + ' b ' + X(0) + ' ' + Y(k) + ' ' + X(k) + ' ' + Y(0) + ' ' + X(r) + ' ' + Y(0);
}
function _ellipse(x, y, w, h) {
  const rx = w / 2, ry = h / 2, cx = x + rx, cy = y + ry, kx = rx * 0.5523, ky = ry * 0.5523;
  const P = (a, b) => R(a) + ' ' + R(b);
  return 'm ' + P(cx, y) + ' b ' + P(cx + kx, y) + ' ' + P(x + w, cy - ky) + ' ' + P(x + w, cy)
    + ' b ' + P(x + w, cy + ky) + ' ' + P(cx + kx, y + h) + ' ' + P(cx, y + h)
    + ' b ' + P(cx - kx, y + h) + ' ' + P(x, cy + ky) + ' ' + P(x, cy)
    + ' b ' + P(x, cy - ky) + ' ' + P(cx - kx, y) + ' ' + P(cx, y);
}
// A highlighter's stroke: a slanted band with ragged ends.
function _marker(x, y, w, h) {
  const s = h * 0.18;
  const P = (a, b) => R(a) + ' ' + R(b);
  return 'm ' + P(x + s, y + h * 0.06) + ' l ' + P(x + w * 0.5, y) + ' ' + P(x + w, y + h * 0.1) + ' ' + P(x + w - s * 0.6, y + h * 0.55)
    + ' ' + P(x + w - s, y + h) + ' ' + P(x + w * 0.45, y + h * 0.94) + ' ' + P(x, y + h * 0.88) + ' ' + P(x + s * 0.5, y + h * 0.45);
}

/**
 * The plate round the rows' letters (`rows`: the ink of each row, [{x, y, w, h}] frame pixels) as ONE drawing:
 * { path, stripe, x, y, w, h } - the paths in the drawing's own coordinates and where its box sits on the frame; `stripe` a
 * tag's accent, drawn over the same box. `kind`: style.js PLATES, or 'box' (a box look, `pad` pixels round the letters).
 * Null for none.
 */
export function plateOf(kind, rows, em, pad) {
  if (!rows.length || !kind || kind === 'none') return null;
  const parts = [];
  const P = { round: [0.38, 0.22], pill: [0.62, 0.26], tag: [0.42, 0.22], sticker: [0.5, 0.3] }[kind];
  const x0 = Math.min(...rows.map((r) => r.x)), x1 = Math.max(...rows.map((r) => r.x + r.w));
  const y0 = Math.min(...rows.map((r) => r.y)), y1 = Math.max(...rows.map((r) => r.y + r.h));
  if (kind === 'circle') {
    const w = (x1 - x0) * 1.22 + em * 0.6, h = (y1 - y0) * 1.5 + em * 0.6;
    parts.push([(x0 + x1) / 2 - w / 2, (y0 + y1) / 2 - h / 2, w, h]);
  } else if (kind === 'sticker') {
    parts.push([x0 - P[0] * em, y0 - P[1] * em, x1 - x0 + 2 * P[0] * em, y1 - y0 + 2 * P[1] * em]);
  } else {
    for (const r of rows) {
      if (kind === 'marker') parts.push([r.x - 0.22 * em, r.y - r.h * 0.14, r.w + 0.44 * em, r.h * 1.3]);
      else if (kind === 'underline') parts.push([r.x - 0.04 * em, r.y + r.h + 0.1 * em, r.w + 0.08 * em, Math.max(4, 0.11 * em)]);
      else if (kind === 'box') parts.push([r.x - pad, r.y - pad, r.w + 2 * pad, r.h + 2 * pad]);
      else parts.push([r.x - P[0] * em, r.y - P[1] * em, r.w + 2 * P[0] * em, r.h + 2 * P[1] * em]);
    }
  }
  const x = Math.min(...parts.map((p) => p[0])), y = Math.min(...parts.map((p) => p[1]));
  const w = Math.max(...parts.map((p) => p[0] + p[2])) - x, h = Math.max(...parts.map((p) => p[1] + p[3])) - y;
  const path = parts.map(([px, py, pw, ph]) => {
    const lx = px - x, ly = py - y;
    if (kind === 'circle') return _ellipse(lx, ly, pw, ph);
    if (kind === 'marker') return _marker(lx, ly, pw, ph);
    if (kind === 'pill' || kind === 'underline') return _rrect(lx, ly, pw, ph, ph / 2);
    if (kind === 'round' || kind === 'sticker') return _rrect(lx, ly, pw, ph, Math.min(ph * 0.28, em * 0.35));
    return _rrect(lx, ly, pw, ph, 0);
  }).join(' ');
  // A tag's stripe on the left of each row's box. Its drawing spans the plate's whole box (two points that draw nothing - libass
  // counts them in a drawing's box), so placed at the same middle it lands where the plate is.
  const stripe = kind !== 'tag' ? '' : 'm 0 0 l 0 0 m ' + R(w) + ' ' + R(h) + ' l ' + R(w) + ' ' + R(h) + ' '
    + parts.map(([px, py, , ph]) => _rrect(px - x, py - y, Math.max(6, em * 0.14), ph, 0)).join(' ');
  return { path, stripe, x, y, w, h };
}

// ── The layout ──────────────────────────────────────────────────────────────
/**
 * Where everything of a text line sits on a w x h frame, as libass lays it: the block's middle, each row's ink, and the units
 * a motion moves - rows, words, letters - each with its text and its middle. `st`: resolved, its size set.
 */
export function layoutOf(text, st, w, h, dur) {
  const drawn = drawnPage({ name: String(text) }, st, false, w, dur);
  const s = drawn.shrink ? Object.assign({}, st, { size: drawn.shrink }) : st;
  const box = boxOf(drawn, s, w, h);
  const m = meter(s);
  const lh = (+s.size || 60) * ((+s.scaleY || 100) / 100);
  const sx = (+s.scaleX || 100) / 100;
  const sp = (+s.spacing || 0) * sx;
  const cx = box.ax;
  const cy = box.an === 8 ? box.ay + box.th / 2 : box.an === 2 ? box.ay - box.th / 2 : box.ay;
  const top = cy - box.th / 2;
  const ink = fontOf(s.font).ink || [0, 0];
  const rows = [], words = [], letters = [];
  const lines = drawn.lines.map((l) => cased(l, s.casing));
  lines.forEach((line, i) => {
    const chars = [...line];
    const adv = chars.map((ch) => m.run(ch).a * m.em * sx);
    const lw = adv.reduce((a, b) => a + b, 0) + sp * Math.max(0, chars.length - 1);
    const left = cx - lw / 2;
    const y = top + (i + 0.5) * lh;
    rows.push({ text: assText(line), x: cx, y, row: i, ink: { x: left, y: top + i * lh + ink[0] * lh, w: lw, h: lh * (1 - ink[0] - ink[1]) } });
    let at = left, word = null;
    chars.forEach((ch, k) => {
      if (/\s/.test(ch)) word = null;
      else {
        letters.push({ text: assText(ch), x: at + adv[k] / 2, y, row: i, left: at, right: at + adv[k], letter: true });
        if (!word) { word = { text: '', l: at, r: 0, y, row: i }; words.push(word); }
        word.text += ch;
        word.r = at + adv[k];
      }
      at += adv[k] + sp;
    });
  });
  for (const wd of words) { wd.x = (wd.l + wd.r) / 2; wd.text = assText(wd.text); }
  return { st: s, em: m.em, lh, cx, cy, rows, words, letters, block: { text: lines.map(assText).join('\\N'), x: cx, y: cy, block: true } };
}

// ── The events ──────────────────────────────────────────────────────────────
// A state's alpha tags for the parts a layer draws: `base` - each part's own opacity (1 fill, 3 outline, 4 shadow).
function _alphas(a, base) {
  let t = '';
  for (const k of Object.keys(base)) t += '\\' + k + 'a&H' + hex2(255 - clamp(a, 0, 1) * (255 - opaque(base[k]))) + '&';
  return t;
}
const REST = { dx: 0, dy: 0, sx: 100, sy: 100, rz: 0, a: 1, blur: 0, fsp: 0, cl: 0, cr: 1, rgb: 0 };
function _full(part) {
  const o = Object.assign({}, REST, part || {});
  if (part && part.s != null) { o.sx = (part.sx != null ? part.sx : 100) * part.s / 100; o.sy = (part.sy != null ? part.sy : 100) * part.s / 100; }
  return o;
}
const ORDER = ['block', 'row', 'word', 'letter'];

/**
 * The events of ONE text line: `line` {text, start, end}; `st` its style (resolved, its size set, in the font it is drawn in -
 * fonts.js withTwin); `name` the .ass style it is drawn with; `L` its first layer. Answers { events, styles } - lines of the
 * file's [Events] and [V4+ Styles].
 */
export function textLine(line, st, name, L, w, h) {
  const start = Math.max(0, +line.start || 0), end = Math.max(start + 0.05, +line.end || start + 3);
  const life = end - start;
  const lay = layoutOf(line.text, st, w, h, life);
  const em = lay.em;
  const events = [];
  const out = (layer, t0, t1, text) => {
    if (t1 - t0 >= 0.005) events.push('Dialogue: ' + (L + layer) + ',' + assTime(t0) + ',' + assTime(t1) + ',' + name + ',,0,0,0,,' + text);
  };
  const enter = ENTER[enterOf(st)] || ENTER.none, leave = LEAVE[st.leave] || LEAVE.none;
  const inDur = enter === ENTER.none ? 0 : clamp(+st.enterDur || 0.5, 0.05, life * 0.5);
  const outDur = leave === LEAVE.none ? 0 : clamp(+st.leaveDur || 0.4, 0.05, life * 0.5);
  const by = ORDER[Math.max(ORDER.indexOf(enter.by), ORDER.indexOf(leave.by))];
  const units = by === 'letter' ? lay.letters : by === 'word' ? lay.words : by === 'row' ? lay.rows : [lay.block];
  const many = by !== 'block';

  // A box look (borderStyle, no plate) is a plate too here: libass's own box could not move with the letters.
  const boxy = (!st.plate || st.plate === 'none') && (st.borderStyle === 'box' || st.borderStyle === 'boxline');
  const kind = boxy ? 'box' : st.plate;
  const bord = boxy && st.borderStyle === 'box' ? 0 : (+st.outline || 0);
  const shad = +st.shadow || 0;
  const shadowA = st.shadowAlpha == null ? 0.75 : +st.shadowAlpha;
  const face = assFace(st.font, st.bold);
  const styles = ['Style: ' + [name, face.family, R(lay.st.size), hexToAss(st.primary, 0), hexToAss(st.secondary, 0),
    hexToAss(st.outlineColor, 0), hexToAss(st.shadowColor, R(opaque(shadowA))), face.bold, st.italic ? -1 : 0, 0, 0,
    R(+st.scaleX || 100), R(+st.scaleY || 100), 0, 0, 1, bord, shad, 5, 0, 0, 0, 1].join(',')];
  const ALL = { 1: 1, 3: 1, 4: shadowA }, EDGE = { 3: 1, 4: shadowA }, FILL = { 1: 1 };

  // When each unit's part of a motion runs: its delay in the motion and how long it takes.
  const timing = (mo, dur, reverse) => {
    const groups = mo.by === 'letter' ? lay.letters.length : mo.by === 'word' ? lay.words.length : mo.by === 'row' ? lay.rows.length : 1;
    const groupOf = (u) => {
      if (mo.by === 'letter') return lay.letters.indexOf(u);
      if (mo.by === 'word') return u.letter ? lay.words.findIndex((wd) => u.row === wd.row && u.x >= wd.l - 0.5 && u.x <= wd.r + 0.5) : lay.words.indexOf(u);
      if (mo.by === 'row') return u.block ? 0 : u.row;
      return 0;
    };
    const share = groups > 1 ? (mo.unit != null ? mo.unit : 0.5) : 1;
    const ud = mo.unit === 0 ? 0 : dur * share;
    const stagger = groups > 1 ? (mo.unit === 0 ? dur / groups : (dur - ud) / (groups - 1)) : 0;
    return units.map((u) => { let g = Math.max(0, groupOf(u)); if (reverse) g = groups - 1 - g; return { d: g * stagger, ud }; });
  };
  const tin = timing(enter, inDur, false);
  const tout = timing(leave, outDur, !!leave.reverse);

  const tilt = +st.tilt || 0;
  const rad = -tilt * Math.PI / 180;                       // ASS turns counter-clockwise; the frame's y runs down
  const turn = (x, y) => {
    const ox = x - lay.cx, oy = y - lay.cy;
    return [lay.cx + ox * Math.cos(rad) - oy * Math.sin(rad), lay.cy + ox * Math.sin(rad) + oy * Math.cos(rad)];
  };
  const inks = lay.rows.map((r) => r.ink);
  const bx0 = Math.min(...inks.map((r) => r.x)) - em * 0.7, bx1 = Math.max(...inks.map((r) => r.x + r.w)) + em * 0.7;
  const spacing = +st.spacing || 0;
  const glow = +st.glow || 0;
  const glowCol = col(st.glowColor || st.primary);

  // ONE unit over one stretch of time, from state A to state B (linearly): its events on every layer it is drawn on.
  // `mo` - the motion it is in (its row clip), none at rest.
  const piece = (u, t0, t1, A, B, still, mo) => {
    if (t1 - t0 < 0.005) return;
    if (A.a <= 0.003 && B.a <= 0.003) return;
    if (A.cr - A.cl <= 0.001 && B.cr - B.cl <= 0.001) return;
    const ms = R((t1 - t0) * 1000);
    const at = (S) => {
      let ox = u.x - lay.cx, oy = u.y - lay.cy;
      if (S.blk) {                                         // the block's motion: the unit keeps its place in the block
        ox *= S.sx / 100; oy *= S.sy / 100;
        const r = -S.rz * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
        [ox, oy] = [ox * c - oy * s, ox * s + oy * c];
      }
      const [x, y] = turn(lay.cx + ox, lay.cy + oy);
      return [x + S.dx * em, y + S.dy * em];
    };
    const pa = at(A), pb = at(B);
    const pos = still || (R(pa[0]) === R(pb[0]) && R(pa[1]) === R(pb[1])) ? '\\pos(' + R(pa[0]) + ',' + R(pa[1]) + ')'
      : '\\move(' + R(pa[0]) + ',' + R(pa[1]) + ',' + R(pb[0]) + ',' + R(pb[1]) + ')';
    const clipOf = (S) => {
      if (S.cl <= 0 && S.cr >= 1 && !(mo && mo.clipRow)) return '';
      let y0 = 0, y1 = h;
      if (mo && mo.clipRow) { const r = lay.rows[u.row || 0].ink; y0 = r.y - em * 0.12; y1 = r.y + r.h + em * 0.12; }
      return '\\clip(' + R(lerp(bx0, bx1, S.cl)) + ',' + R(y0) + ',' + R(lerp(bx0, bx1, S.cr)) + ',' + R(y1) + ')';
    };
    const ca = clipOf(A), cb = still ? '' : clipOf(B);
    // Letters are drawn one by one with no spacing of their own (it is in their places); a word, a row and the block with it.
    const geo = (S, blur) => '\\fscx' + f1(S.sx) + '\\fscy' + f1(S.sy) + '\\frz' + f1(tilt + S.rz)
      + '\\blur' + f1(blur != null ? blur : S.blur) + (u.letter ? '' : '\\fsp' + f1(spacing + S.fsp * em));
    const body = (base, look, blur) => {
      const sa = geo(A, blur) + _alphas(A.a, base), sb = geo(B, blur) + _alphas(B.a, base) + (cb !== ca ? cb : '');
      return '{\\an5\\q2' + pos + look + ca + (still || sa === sb ? sa : sa + '\\t(0,' + ms + ',' + sb + ')') + '}' + u.text;
    };
    if (glow > 0) {
      const g = glow * em * 0.1;
      out(1, t0, t1, body({ 1: 0.55, 3: 0.55 }, '\\1c' + glowCol + '\\3c' + glowCol + '\\bord' + f1(g) + '\\shad0', g));
    }
    if (A.rgb > 0.001) {                                   // a glitch's colour split: a red and a cyan copy apart by `rgb`
      for (const [k, c] of [[-1, '#ff2a55'], [1, '#22e4ff']]) {
        out(1, t0, t1, '{\\an5\\q2\\pos(' + R(pa[0] + k * A.rgb * em) + ',' + R(pa[1]) + ')\\bord0\\shad0\\1c' + col(c)
          + geo(A) + _alphas(A.a * 0.85, FILL) + '}' + u.text);
      }
    }
    if (many && (bord > 0 || shad > 0)) {
      out(2, t0, t1, body(EDGE, '\\1a&HFF&'));
      out(3, t0, t1, body(FILL, '\\bord0\\shad0'));
    } else out(3, t0, t1, body(ALL, ''));
  };

  // A motion drawn over [t0, t0 + dur]: sampled into pieces, or still frames for a stepped one.
  const run = (u, mo, t0, dur, idx, entering) => {
    if (dur <= 0.004) return;
    const f = (p, k) => {
      const S = _full(mo.f(p, k == null ? idx : k + idx * 31));
      if (mo.by === 'block' && !u.block) S.blk = true;
      return S;
    };
    if (mo.steps) {
      const n = Math.max(2, R(dur * mo.steps));
      for (let k = 0; k < n; k++) {
        const S = f(entering ? k / n : (k + 1) / n, k);
        piece(u, t0 + dur * k / n, t0 + dur * (k + 1) / n, S, S, true, mo);
      }
      return;
    }
    const n = clamp(Math.ceil(dur / (u.block ? 0.06 : 0.08)), 1, 12);
    for (let k = 0; k < n; k++) piece(u, t0 + dur * k / n, t0 + dur * (k + 1) / n, f(k / n), f((k + 1) / n), false, mo);
  };

  units.forEach((u, i) => {
    const a0 = start + tin[i].d, a1 = a0 + tin[i].ud;       // its entrance
    const b0 = end - outDur + tout[i].d, b1 = b0 + tout[i].ud;  // its exit
    if (a0 > start) { const S = _full(enter.f(0, i)); piece(u, start, a0, S, S, true, enter); }
    run(u, enter, a0, a1 - a0, i, true);
    piece(u, a1, Math.max(a1, b0), _full({}), _full({}), true, null);
    run(u, leave, b0, b1 - b0, i, false);
    if (leave.unit !== 0 && b1 < end) { const S = _full(leave.f(1, i)); piece(u, b1, end, S, S, true, leave); }
  });

  // A typewriter's cursor: after the last letter written, blinking while the line rests; going back on a backspace.
  if ((enter.cursor || leave.cursor) && lay.letters.length) {
    const L1 = lay.letters;
    const bw = Math.max(4, em * 0.09), bh = lay.lh * 0.62;
    const cur = (x, y, t0, t1) => {
      const [px, py] = turn(x + em * 0.12, y);
      out(3, t0, t1, '{\\an5\\q2\\pos(' + R(px) + ',' + R(py) + ')\\frz' + f1(tilt) + '\\bord0\\shad0\\blur0\\1c' + col(st.highlight || st.primary)
        + '\\p1}' + _rrect(0, 0, bw, bh, 0) + '{\\p0}');
    };
    const inAt = (k) => start + tin[k].d;
    const outAt = (k) => end - outDur + tout[k].d;
    const last = L1[L1.length - 1];
    let from = start;
    if (enter.cursor) {
      cur(L1[0].left - em * 0.12, L1[0].y, start, inAt(0));
      for (let k = 0; k < L1.length; k++) cur(L1[k].right, L1[k].y, inAt(k), k + 1 < L1.length ? inAt(k + 1) : inAt(k) + 0.05);
      from = inAt(L1.length - 1) + 0.05;
    }
    const until = leave.cursor ? end - outDur : Math.min(end - outDur, from + 1.2);
    for (let t = from, on = true; t < until; t += 0.4, on = !on) if (on) cur(last.right, last.y, t, Math.min(until, t + 0.4));
    if (leave.cursor) {
      for (let k = L1.length - 1; k >= 0; k--) {
        const prev = k > 0 ? L1[k - 1] : null;
        cur(prev ? prev.right : L1[0].left - em * 0.12, (prev || L1[0]).y, outAt(k), k > 0 ? outAt(k - 1) : end);
      }
    }
  }

  // The plate: its own entrance and exit when the style gives them, else the text's - on the whole plate.
  // A box look is drawn as libass draws its own: round each row's whole line, its margin the outline (a 'box') or padOf.
  const pad = boxy ? (st.borderStyle === 'box' && (+st.outline || 0) > 0 ? +st.outline : padOf(st)) : 0;
  const plateRows = boxy ? lay.rows.map((r) => ({ x: r.ink.x, y: r.y - lay.lh / 2, w: r.ink.w, h: lay.lh })) : inks;
  const plate = plateOf(kind, plateRows, em, pad);
  if (plate) {
    const pen = ENTER[st.plateIn] || (enter.by === 'block' ? enter : ENTER.fade);
    const pleave = LEAVE[st.plateOut] || (leave.by === 'block' ? leave : LEAVE.fade);
    const pIn = pen === ENTER.none ? 0 : (inDur || clamp(+st.enterDur || 0.5, 0.05, life * 0.5));
    const pOut = pleave === LEAVE.none ? 0 : (outDur || clamp(+st.leaveDur || 0.4, 0.05, life * 0.5));
    const ring = kind === 'circle';
    const alpha = +st.backAlpha || 0;
    const base = ring ? { 3: alpha } : { 1: alpha, 4: kind === 'sticker' ? 0.55 * alpha : 0 };
    const shadow = kind === 'sticker' ? '\\shad' + f1(em * 0.08) + '\\4c&H000000&' : '\\shad0';
    const [px0, py0] = turn(plate.x + plate.w / 2, plate.y + plate.h / 2);
    const draw = (A, B, t0, t1, still, path, colour) => {
      if (t1 - t0 < 0.005 || (A.a <= 0.003 && B.a <= 0.003) || (A.cr - A.cl <= 0.001 && B.cr - B.cl <= 0.001)) return;
      const ms = R((t1 - t0) * 1000);
      const pa = [px0 + A.dx * em, py0 + A.dy * em], pb = [px0 + B.dx * em, py0 + B.dy * em];
      const pos = still || (R(pa[0]) === R(pb[0]) && R(pa[1]) === R(pb[1])) ? '\\pos(' + R(pa[0]) + ',' + R(pa[1]) + ')'
        : '\\move(' + R(pa[0]) + ',' + R(pa[1]) + ',' + R(pb[0]) + ',' + R(pb[1]) + ')';
      const geo = (S) => '\\fscx' + f1(S.sx) + '\\fscy' + f1(S.sy) + '\\frz' + f1(tilt + S.rz) + '\\blur' + f1(S.blur);
      const clip = (S) => (S.cl <= 0 && S.cr >= 1 ? '' : '\\clip(' + R(lerp(plate.x, plate.x + plate.w, S.cl)) + ',0,'
        + R(lerp(plate.x, plate.x + plate.w, S.cr)) + ',' + h + ')');
      const ca = clip(A), cb = still ? '' : clip(B);
      const look = ring ? '\\1a&HFF&\\3c' + colour + '\\bord' + f1(Math.max(3, em * 0.09)) : '\\1c' + colour + '\\bord0';
      const sa = geo(A) + _alphas(A.a, base), sb = geo(B) + _alphas(B.a, base) + (cb !== ca ? cb : '');
      out(0, t0, t1, '{\\an5\\q2' + pos + look + shadow + ca + (still || sa === sb ? sa : sa + '\\t(0,' + ms + ',' + sb + ')') + '\\p1}' + path + '{\\p0}');
    };
    const runP = (mo, t0, dur, entering, path, colour) => {
      if (dur <= 0.004) return;
      if (mo.steps) {
        const n = Math.max(2, R(dur * mo.steps));
        for (let k = 0; k < n; k++) { const S = _full(mo.f(entering ? k / n : (k + 1) / n, k)); draw(S, S, t0 + dur * k / n, t0 + dur * (k + 1) / n, true, path, colour); }
        return;
      }
      const n = clamp(Math.ceil(dur / 0.06), 1, 12);
      for (let k = 0; k < n; k++) draw(_full(mo.f(k / n, k)), _full(mo.f((k + 1) / n, k)), t0 + dur * k / n, t0 + dur * (k + 1) / n, false, path, colour);
    };
    const paths = [[plate.path, col(st.backColor || '#000000')]].concat(plate.stripe ? [[plate.stripe, col(st.highlight || '#ffe14d')]] : []);
    for (const [path, colour] of paths) {
      runP(pen, start, pIn, true, path, colour);
      draw(_full({}), _full({}), start + pIn, end - pOut, true, path, colour);
      runP(pleave, end - pOut, pOut, false, path, colour);
    }
  }
  return { events, styles };
}
