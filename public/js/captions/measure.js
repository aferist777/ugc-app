/* ═══════════════════════════════════════════════════════════════════════════
   CAPTIONS — how wide a line is drawn, in pixels of the render's frame (phase K2, 2026-10-03).

   A page is cut, and broken into lines, to a WIDTH: no line wider than LINE_MAX of the frame. libass
   wraps only at 0.88 (the styles' 6% margins), so what stays inside 0.78 is never wrapped by it, and
   the rest is room for a popped word (+12%) and for the table's own error.

   The widths are the letters' own advances, read from the shipped font files (advances.js, made by
   tools/caption-advances.js) - their sum matches what libass draws within ~2%: it does no kerning. One
   em is the style's size over the font's line (an .ass Fontsize is the height of the LINE); spacing is
   added between letters and scaled with them, as libass does; the outline - or the box's padding - and
   the shadow stand out round the letters. A letter the font lacks is measured, and drawn, in PT Sans.
   The text is measured as it is SHOWN, with the style's casing.

   PURE, and shared: the page imports it, the server require()s it (lib/mv3b-subs.js).
   ═══════════════════════════════════════════════════════════════════════════ */

import { ADVANCES, CHARS } from './advances.js';
import { fontOf } from './fonts.js';
import { cased } from './style.js';

/** The widest a line of captions may be, as a fraction of the frame's width. */
export const LINE_MAX = 0.78;

const IDX = new Map([...CHARS].map((c, i) => [c, i]));
const _tables = new Map();
function _table(file) {
  let t = _tables.get(file);
  if (!t) {
    const src = ADVANCES[file] || ADVANCES['LiberationSans-Regular.ttf'];
    const per = src.split(',').map(Number);
    // What a character outside the table counts as: the font's average lowercase Latin letter.
    let sum = 0;
    for (let c = 0x61; c <= 0x7a; c++) sum += per[IDX.get(String.fromCharCode(c))] || 0;
    t = { per, avg: sum / 26 / 1000 };
    _tables.set(file, t);
  }
  return t;
}

// The file a style is drawn from: the bold one where the family ships both and the style says bold.
function _fileOf(font, bold) {
  const f = fontOf(font);
  const b = f.bold === 'style' ? !!bold : !!f.bold;
  return (b && f.files[700]) || f.files[400] || f.files[700];
}

const ZERO = /[\p{M}\p{Cf}]/u;

// No-break spaces are measured as the space they look like (review K2); the narrow one as half of it.
const NBSP = { ' ': 1, ' ': 1, ' ': 0.5 };

// One character's advance in em.
function _adv(t, fb, ch) {
  if (NBSP[ch]) return _adv(t, fb, ' ') * NBSP[ch];
  let i = IDX.get(ch);
  if (i === undefined) {
    const base = ch.normalize('NFD')[0];          // é, ü, ç... - the letter under the accent
    if (base !== ch) i = IDX.get(base);
  }
  if (i !== undefined) {
    const v = t.per[i] || fb.per[i];
    if (v) return v / 1000;
  }
  if (ZERO.test(ch)) return 0;
  return ch.codePointAt(0) >= 0x2e80 ? 1 : t.avg;  // CJK, emoji: a full em
}

// A box needs room round the letters - with none, libass draws no box at all (ass.js uses it too).
export const padOf = (st) => Math.max(+st.outline || 0, 2, Math.round((+st.size || 60) * 0.08));
const BOXY = (st) => st.borderStyle === 'box' || st.borderStyle === 'boxline';

/** How far the drawing stands out on EACH side of the letters: the outline, or the box round them. */
export function edgeOf(st) {
  // A box drawn as the letters' own border (one event) is padded by the outline; layered - a box with any
  // effect, ass.js layered() - it is the box style's, padOf (review K2: measured short by the difference).
  if (st.borderStyle === 'box' && (st.effect || 'none') === 'none') return (+st.outline || 0) > 0 ? +st.outline : padOf(st);
  if (BOXY(st) || st.effect === 'box') return padOf(st);
  return +st.outline || 0;
}

/**
 * A measure for one style (resolved, its size filled in - style.js withAuto): `text(s)` is the width a
 * line saying s is drawn at; `run(s)` the letters alone as {a: advance in em, n: characters}, for a
 * caller that adds words up; `width(a, n)` turns such a sum into pixels with the edges on.
 */
export function meter(st) {
  const f = fontOf(st.font);
  const t = _table(_fileOf(st.font, st.bold));
  const fb = _table(_fileOf('PT Sans', f.bold === 'style' ? !!st.bold : !!f.bold));
  const em = (+st.size || 60) / f.line;
  const sx = (+st.scaleX || 100) / 100;
  const sp = +st.spacing || 0;
  const edge = 2 * edgeOf(st) + Math.max(0, +st.shadow || 0);
  const run = (s) => {
    let a = 0, n = 0;
    for (const ch of cased(s, st.casing)) { a += _adv(t, fb, ch); n++; }
    return { a, n };
  };
  const width = (a, n) => (a * em + sp * Math.max(0, n - 1)) * sx + edge;
  const space = _adv(t, fb, ' ');
  return { em, space, run, width, text: (s) => { const r = run(s); return width(r.a, r.n); } };
}
