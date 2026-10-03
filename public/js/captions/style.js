/* ═══════════════════════════════════════════════════════════════════════════
   CAPTIONS — how a caption looks, ONE copy for the server and the page (phase K0, 2026-10-03).

   The defaults used to live in four places - lib/mv3b-subs.js, js/merge-v3/subs-b.js, the store's
   whitelist in routes/mergev3.js and the converter - "copied, not imported", for want of a build step.
   A module under public/ is imported by the page and require()d by the server (Node 24 loads an ES
   module that way), so there is one now, and a field added here is a field both sides know.

   A STYLE belongs to a lane (`track.style`) and, partially, to one caption (`clip.style`, the owner
   2026-10-03: a fragment can wear a style of its own); what a caption is drawn with is the lane's style
   with the caption's on top - resolveStyle(). The stored lane style is normalised on every save
   (normalizeStyle: clamps, defaults, unknown keys dropped); a caption's own is normalised the same way
   but keeps only what it sets (normalizeOverride).

   Colours are #rrggbb; opacity is its own field (0 = clear, 1 = solid) - `backAlpha` for the box,
   `shadowAlpha` for the shadow. Sizes are in pixels of the frame the render comes out at (1080x1920 or
   1920x1080) and `size` is the height of the font's LINE, the way the .ass format means it.
   ═══════════════════════════════════════════════════════════════════════════ */

import { familyOf } from './fonts.js';

// What the active word does (phase K3 draws all of them; K0 knows them):
//   none     every word looks the same
//   karaoke  each word turns `primary` the moment it is spoken, `secondary` before - the old toggle
//   color    the word being spoken wears `highlight`
//   box      a box in `highlight` behind the word being spoken
//   pop      the word being spoken grows for a moment, in `highlight`
//   bounce   the word being spoken jumps up for a moment, in `highlight`
//   sweep    each word fills with `primary` from left to right as it is spoken
export const EFFECTS = ['none', 'karaoke', 'color', 'box', 'pop', 'bounce', 'sweep'];
// How a page of words arrives.
export const APPEARS = ['none', 'pop', 'fade', 'slide'];
// Applied when the caption is drawn, never stored in the text: switching style must not rewrite words.
export const CASINGS = ['none', 'upper', 'lower', 'title'];
// outline: letters outlined; box: a box behind each line; boxline: a box AND outlined letters.
export const BORDERS = ['outline', 'box', 'boxline'];
export const POSITIONS = ['top', 'center', 'bottom'];

export const DEF = {
  preset: '',                     // the preset this style was made from - what "back to the preset" restores
  font: 'Liberation Sans', size: 60, bold: true, italic: false,
  // libass's karaoke convention: a word is `secondary` before it is spoken and `primary` after.
  primary: '#ffffff', secondary: '#8a9099', highlight: '#ffe14d',
  outlineColor: '#000000', shadowColor: '#000000', backColor: '#000000',
  backAlpha: 0, shadowAlpha: 0.75,
  outline: 3, shadow: 0, blur: 0,
  scaleX: 100, scaleY: 100, spacing: 0,
  borderStyle: 'outline', pos: 'bottom', tx: 0, ty: 0,
  wrap: true, wordsPerLine: 0, lines: 2,
  effect: 'none', appear: 'none', casing: 'none',
  sizeAuto: true,
};

// ── One rule per field, for the whole style and for a caption's part of it ──
const HEX = /^#[0-9a-fA-F]{6}$/;
const NUM = (lo, hi, round) => (v) => {
  if (v == null || v === '' || isNaN(+v)) return undefined;
  const n = Math.max(lo, Math.min(hi, +v));
  return round ? Math.round(n) : n;
};
const ONE = (list) => (v) => (list.includes(v) ? v : undefined);
const BOOL = (v) => (v == null ? undefined : !!v);
const COLOUR = (v) => (HEX.test(String(v)) ? String(v).toLowerCase() : undefined);
const TEXT = (n) => (v) => (v == null ? undefined : String(v).slice(0, n));

const RULES = {
  preset: TEXT(60),
  // Always a shipped font (fonts.js): an old project's Arial is stored as Liberation Sans (K5).
  font: (v) => { const s = String(v == null ? '' : v).trim().slice(0, 60); return s ? familyOf(s) : undefined; },
  size: NUM(20, 200),
  bold: BOOL, italic: BOOL,
  primary: COLOUR, secondary: COLOUR, highlight: COLOUR,
  outlineColor: COLOUR, shadowColor: COLOUR, backColor: COLOUR,
  backAlpha: NUM(0, 1), shadowAlpha: NUM(0, 1),
  outline: NUM(0, 10), shadow: NUM(0, 10), blur: NUM(0, 10),
  // Percent, wider than any slider: a style written by hand or by a later build is not reshaped.
  scaleX: NUM(25, 400), scaleY: NUM(25, 400),
  spacing: NUM(-10, 40),
  borderStyle: ONE(BORDERS),
  pos: ONE(POSITIONS),
  // The base offset, as fractions of the frame; a caption may be moved off the edge while composing.
  tx: NUM(-1, 1), ty: NUM(-1, 1),
  wrap: BOOL,
  wordsPerLine: NUM(0, 12, true),
  lines: NUM(1, 3, true),
  effect: ONE(EFFECTS), appear: ONE(APPEARS), casing: ONE(CASINGS),
  sizeAuto: BOOL,
};

// A style written before `effect` existed said karaoke with a switch.
function _legacy(st) {
  if (st && st.effect == null && st.karaoke != null) return { ...st, effect: st.karaoke ? 'karaoke' : 'none' };
  return st;
}

/** A lane's whole style as it is STORED: every field, each valid, nothing unknown. */
export function normalizeStyle(st) {
  const src = _legacy(st && typeof st === 'object' ? st : {});
  const out = {};
  for (const k of Object.keys(DEF)) {
    const v = RULES[k](src[k]);
    out[k] = v === undefined ? DEF[k] : v;
  }
  // "Still the format's suggestion" unless somebody said otherwise.
  out.sizeAuto = src.sizeAuto !== false;
  return out;
}

/** A caption's own part of a style: only the fields it sets, each valid. Null when it sets none. */
export function normalizeOverride(st) {
  if (!st || typeof st !== 'object') return null;
  const src = _legacy(st);
  const out = {};
  for (const k of Object.keys(DEF)) {
    if (src[k] === undefined) continue;
    const v = RULES[k](src[k]);
    if (v !== undefined) out[k] = v;
  }
  return Object.keys(out).length ? out : null;
}

/**
 * What a caption is DRAWN with: the defaults, the lane's style, the caption's own on top. Not clamped -
 * a stored style has been normalised already, and a render must draw what the screen showed.
 */
export function resolveStyle(laneStyle, clipStyle) {
  const lane = _legacy(laneStyle || {});
  const own = clipStyle ? _legacy(clipStyle) : null;
  const st = Object.assign({}, DEF, lane, own || {});
  delete st.karaoke;                       // read as `effect` above (_legacy)
  st.font = familyOf(st.font);             // a shipped font, whatever an old project named (K5)
  return st;
}

// ── The frame ───────────────────────────────────────────────────────────────
const RENDER = { '9:16': { w: 1080, h: 1920 }, '16:9': { w: 1920, h: 1080 } };
export const renderFrame = (fmt) => RENDER[fmt] || RENDER['9:16'];

// WHAT THE FORMAT DECIDES until somebody decides otherwise: a 9:16 frame is a column, so a line breaks
// earlier and its letters are bigger relative to the frame. `sizeAuto` and `wordsPerLine: 0` are what
// "still automatic" looks like in a stored style.
export const autoSizePx = (h, w) => Math.round(h * (w > h ? 0.050 : 0.035));
export const autoSize = (fmt) => { const f = renderFrame(fmt); return autoSizePx(f.h, f.w); };
export const autoWordsPerLine = (fmt) => (fmt === '16:9' ? 8 : 4);

/** The style with the format's automatic size filled in, for a frame of w x h. */
export function withAuto(style, w, h) {
  const st = Object.assign({}, style);
  if (st.sizeAuto !== false) st.size = autoSizePx(h, w);
  return st;
}

/**
 * WHERE A CAPTION SITS, in pixels of a w x h frame. The anchor is top, middle or bottom of the frame and
 * the offset moves it from there, as a fraction of the frame. `an` is libass's numpad alignment.
 */
export function anchorOf(style, w, h) {
  const st = style || DEF;
  const base = st.pos === 'top' ? 0.10 : st.pos === 'center' ? 0.50 : 0.88;
  return {
    x: w / 2 + (+st.tx || 0) * w,
    y: h * base + (+st.ty || 0) * h,
    an: st.pos === 'top' ? 8 : st.pos === 'center' ? 5 : 2,
  };
}

/**
 * Every lane that holds words, BOTTOM LANE FIRST - the subtitles, then the text lanes above them in
 * reverse. The order is the layer order: later is drawn on top.
 */
export function captionLanes(timeline) {
  return ((timeline && timeline.tracks) || [])
    .filter(x => x && (x.kind === 'subs' || x.kind === 'text'))
    .reverse();
}

/**
 * A caption's words as stored: {w, s, e} with times from the caption's own start, and `k` when the word
 * is marked to stand out (K10). At most 200 to a caption.
 */
export function normalizeWords(words) {
  if (!Array.isArray(words)) return null;
  const num = (v) => (v == null || isNaN(+v) ? 0 : Math.max(0, +v));
  return words.slice(0, 200)
    .filter(w => w && w.w != null)
    .map(w => {
      const o = { w: String(w.w).slice(0, 60), s: num(w.s), e: num(w.e) };
      if (w.k) o.k = true;
      // A word a person changed, put in, cut, joined or moved (K10): the line is theirs - Generate keeps it.
      if (w.h) o.h = true;
      return o;
    });
}

/** The text as it is SHOWN: the style's casing applied, the stored words left as they are. */
export function cased(text, casing) {
  const s = String(text == null ? '' : text);
  if (casing === 'upper') return s.toLocaleUpperCase();
  if (casing === 'lower') return s.toLocaleLowerCase();
  if (casing === 'title') return s.toLocaleLowerCase().replace(/(^|[\s"«(\-])(\p{L})/gu, (m, a, b) => a + b.toLocaleUpperCase());
  return s;
}
