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

import { familyOf, isShipped } from './fonts.js';

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
// How a heard lane is cut (phase V30, block 4, (с12)): `pages` - a few words a page (K2); `sentences` - classic
// subtitles, a sentence or a part of one, two lines of up to 42 characters, 1-7 s (pages.js SENT). The LANE's, never
// a line's (с43): resolveStyle takes it from the lane only.
export const CUTS = ['pages', 'sentences'];
// A TEXT line's entrance and exit (phase V42, the owner's (о15); captions/text-fx.js draws them, its ENTER / LEAVE are keyed by
// these names): what moves - the whole line, its rows, its words or its letters - and how; `enterDur` / `leaveDur` their
// lengths, s. A SUBTITLE page has In and Out too since phase V49 (the owner's (пр16)-(пр18)): whole-page motions only, drawn by
// captions/page-fx.js, lengths automatic. On a subtitle lane `none` is "not chosen": the
// preset's own way of arriving (`appear`) - and `at-once`, chosen, arrives with nothing, whatever the preset does ((пр20)).
export const ENTERS = ['none', 'fade', 'pop', 'zoom', 'grow', 'rise', 'from-left', 'from-right', 'drop', 'blur', 'stretch', 'swing',
  'wipe', 'mask-rise', 'rows', 'words', 'words-pop', 'letters', 'letters-pop', 'letters-drop', 'typewriter', 'glitch', 'flicker',
  'from-top', 'at-once'];
export const LEAVES = ['none', 'fade', 'pop', 'zoom', 'shrink', 'rise', 'sink', 'to-left', 'to-right', 'fall', 'blur', 'stretch', 'wipe',
  'mask-sink', 'rows', 'words', 'letters', 'letters-fall', 'backspace', 'glitch', 'flicker'];
// What a text line stands on besides a box (`borderStyle`): a plate drawn round its letters (text-fx.js plateOf), in the box's
// colour and opacity (`backColor`, `backAlpha`); `plateIn` / `plateOut` - its own entrance and exit ('' - the text's).
export const PLATES = ['none', 'round', 'pill', 'marker', 'underline', 'circle', 'tag', 'sticker'];

// SEVERAL PRESETS AND ANIMATIONS AT ONCE on the subtitle lane (phase V49, point 8c; the owner's (пр17), (пр21), (пр22)): the
// lane's `mix` - the looks dealt, one entry per preset ({ preset, ...LOOK_KEYS }: what a preset's own section of the strip
// changes) - and `anims` - the animations dealt, 'in|out' pairs; `mixSeed` - the deal's seed, new at every press. A page dealt
// one wears REFERENCES, never a copy: `mixP` - its entry of `mix`, `mixA` - its pair of `anims`, `mixS` - the seed it was
// dealt with (captions/mix.js deals them). A mix is two entries or more - one is no mix. SPARSE: written only when set, so a
// style without a mix is stored, saved as a preset and drawn exactly as before.
export const LOOK_KEYS = ['font', 'bold', 'italic', 'casing', 'primary', 'secondary', 'highlight', 'marked', 'outlineColor',
  'shadowColor', 'backColor', 'backAlpha', 'shadowAlpha', 'outline', 'shadow', 'blur', 'scaleX', 'scaleY', 'spacing', 'borderStyle',
  'effect', 'appear'];
export const MIX_MAX = 40;
// FONTS DEALT (phase V68 P4, the owner's (хп8), (хп10), (хп11), 2026-11-01): a lane's `fonts` - the families picked in the fonts
// tab, any lane - draw its pages over the preset's own font (one: every page; several: each page the one it was dealt, `mixF`,
// two in a row never the same - mix.js). Colours, edges and motion stay the preset's. A page dealt a font keeps the WIDTH it has
// in the preset's font (`fitTo` of the resolved style - place.js drawnPage scales it); a page whose own style names a font is
// the hand's and is left alone. None picked - the preset's font, the style stored and drawn exactly as before.
// THE PLACE HELD (phase V66, the owner's (хо13), 2026-11-03): a subtitle lane whose place was set for several highlights fragments at
// once (`hold: true`) keeps its place (pos, tx, ty) when a preset is put on it - the place on the screen is about the platform's
// buttons, not about the look (preset-use.js keepMotion). Nothing is drawn by it: a style without it is stored as before.
// TWO ROWS (phase V71, the owner's (хо18)-(хо22), (хо29), 2026-11-03): a subtitle lane with `rows: 2` is drawn by place.js rowsPlan -
// a page's In before its first word, its Out after its end, every other page in a second row, a page fully seen at least 0.8 s. The
// lane's, never a preset's (preset-use.js); no field - one row, every page drawn exactly as before.
const SPARSE = ['mix', 'anims', 'mixSeed', 'mixP', 'mixA', 'mixS', 'fonts', 'mixF', 'hold', 'rows'];
/** The fields a held place keeps over a preset (phase V66). */
export const PLACE_KEYS = ['pos', 'tx', 'ty'];
/** (phase V71) Is a subtitle lane's style in two rows? */
export const rowsOn = (lane) => !!lane && +lane.rows === 2;

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
  wrap: true, wordsPerLine: 0, lines: 2, cut: 'pages',
  effect: 'none', appear: 'none', casing: 'none',
  sizeAuto: true,
  // The colour of a word marked to stand out (`k`, K10b) - '' is automatic (markedColour).
  marked: '',
  // A text line's (phase V42): its entrance and exit and their lengths, the plate behind it, its tilt (degrees, counter-
  // clockwise) and its glow (0 none; '' colour - the text's). The accent of a tag's stripe and of a typewriter's cursor is
  // `highlight` - a text lane has no spoken word to light.
  enter: 'none', enterDur: 0.5, leave: 'none', leaveDur: 0.4,
  plate: 'none', plateIn: '', plateOut: '', tilt: 0, glow: 0, glowColor: '',
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
  cut: ONE(CUTS),
  effect: ONE(EFFECTS), appear: ONE(APPEARS), casing: ONE(CASINGS),
  sizeAuto: BOOL,
  marked: (v) => (v === '' ? '' : COLOUR(v)),
  enter: ONE(ENTERS), enterDur: NUM(0.05, 3), leave: ONE(LEAVES), leaveDur: NUM(0.05, 3),
  plate: ONE(PLATES), plateIn: (v) => (v === '' ? '' : ONE(ENTERS)(v)), plateOut: (v) => (v === '' ? '' : ONE(LEAVES)(v)),
  tilt: NUM(-15, 15), glow: NUM(0, 10), glowColor: (v) => (v === '' ? '' : COLOUR(v)),
  // (phase V49) The mix - a lane's - and a page's references into it.
  mix: (v) => {
    if (!Array.isArray(v)) return undefined;
    const out = [];
    for (const e of v.slice(0, MIX_MAX)) {
      if (!e || typeof e !== 'object') continue;
      const o = {};
      const id = RULES.preset(e.preset);
      if (id) o.preset = id;
      for (const k of LOOK_KEYS) { const x = RULES[k](e[k]); if (x !== undefined) o[k] = x; }
      if (Object.keys(o).length) out.push(o);
    }
    return out.length ? out : undefined;
  },
  anims: (v) => {
    if (!Array.isArray(v)) return undefined;
    const out = v.slice(0, MIX_MAX).map(String).filter((x) => { const [a, b] = x.split('|'); return ENTERS.includes(a) && LEAVES.includes(b); });
    return out.length ? out : undefined;
  },
  mixSeed: NUM(0, 2147483647, true), mixS: NUM(0, 2147483647, true),
  mixP: NUM(0, MIX_MAX - 1, true), mixA: NUM(0, MIX_MAX - 1, true),
  // (V68 P4) Shipped families only, each once; a name the app does not ship is dropped, not read as the fallback.
  fonts: (v) => {
    if (!Array.isArray(v)) return undefined;
    const out = [];
    for (const x of v.slice(0, MIX_MAX)) {
      const f = isShipped(x) ? familyOf(x) : '';
      if (f && !out.includes(f)) out.push(f);
    }
    return out.length ? out : undefined;
  },
  mixF: NUM(0, MIX_MAX - 1, true),
  // (V66) A lane's place held over presets - only ever true; false is no field at all.
  hold: (v) => (v === true ? true : undefined),
  // (V71) Two rows - only ever 2; one row is no field at all.
  rows: (v) => (+v === 2 ? 2 : undefined),
};

// ── A word marked to stand out ──────────────────────────────────────────────
// Automatic, the colour of the spoken word - unless that is the colour of the text (23 presets of 127: a
// marked word would not stand out at all), or, where a word is coloured as it is sung (karaoke, sweep), the
// colour it is sung or waits in, or the colour of a box drawn behind it. Then the first of yellow, red, blue
// that is far enough from them.
const MARK_TRY = ['#ffe14d', '#ef4444', '#38bdf8'];
const _rgb = (hex) => { const h = String(hex || '#000000').replace('#', ''); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) || 0); };
const _far = (a, b) => { const x = _rgb(a), y = _rgb(b); return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]) >= 80; };

/** The colour a marked word (`k`) wears: the style's `marked`, or the automatic one. */
export function markedColour(st) {
  const s = st || DEF;
  if (HEX.test(String(s.marked || ''))) return String(s.marked).toLowerCase();
  const sung = s.effect === 'karaoke' || s.effect === 'sweep';
  // ...and, where a box is drawn behind the words, the box's colour (review K10: Highlighter Yellow Sweep's
  // marked word came out yellow on its yellow box).
  const boxed = (s.borderStyle === 'box' || s.borderStyle === 'boxline') && +s.backAlpha > 0;
  const ok = (c) => HEX.test(String(c || '')) && _far(c, s.primary || DEF.primary) && (!sung || _far(c, s.secondary || DEF.secondary))
    && (!boxed || _far(c, s.backColor || DEF.backColor));
  return [s.highlight].concat(MARK_TRY).find(ok) || MARK_TRY[0];
}

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
  for (const k of SPARSE) { const v = RULES[k](src[k]); if (v !== undefined) out[k] = v; }
  return out;
}

/** A caption's own part of a style: only the fields it sets, each valid. Null when it sets none. */
export function normalizeOverride(st) {
  if (!st || typeof st !== 'object') return null;
  const src = _legacy(st);
  const out = {};
  for (const k of Object.keys(DEF).concat(SPARSE)) {
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
  // A page dealt from its lane's mix (phase V49): the look and the animation it was dealt, under what it sets itself.
  const dealt = own ? dealtOf(lane, own) : null;
  // (V68 P4) A font dealt from the lane's `fonts` goes over the preset's (and the mix look's), under the page's own.
  const fd = fontDealt(lane, own);
  const st = Object.assign({}, DEF, lane, dealt, fd ? { font: fd } : null, own || {});
  delete st.karaoke;                       // read as `effect` above (_legacy)
  st.font = familyOf(st.font);             // a shipped font, whatever an old project named (K5)
  if (fd && !(own && own.font != null)) {
    // The font the page would have had - the one whose width it keeps (place.js drawnPage).
    const before = familyOf(Object.assign({}, DEF, lane, dealt).font);
    if (before !== st.font) st.fitTo = before;
  }
  // The cut is the lane's (phase V30, block 4, (с43)): a Classic preset put on a line gives it the look only.
  st.cut = lane.cut === 'sentences' ? 'sentences' : 'pages';
  return st;
}

/** The lane's mix when it is one - two looks or more - else null. */
export const mixOf = (lane) => (lane && Array.isArray(lane.mix) && lane.mix.length >= 2 ? lane.mix : null);
/** The lane's animations dealt - two pairs or more - else null. */
export const animsOf = (lane) => (lane && Array.isArray(lane.anims) && lane.anims.length >= 2 ? lane.anims : null);
/** The lane's fonts dealt (V68 P4) - one or more families - else null. */
export const fontsOf = (lane) => (lane && Array.isArray(lane.fonts) && lane.fonts.length ? lane.fonts : null);

/** The font a page wears from its lane's `fonts`: the one font, or the one it was dealt (`mixF`); null for none. */
export function fontDealt(laneStyle, clipStyle) {
  const fo = fontsOf(laneStyle);
  if (!fo) return null;
  if (fo.length === 1) return fo[0];
  const k = clipStyle && clipStyle.mixF;
  return Number.isInteger(k) && fo[k] ? fo[k] : null;
}

/** The style a page is CUT and measured by: the preset's font where a font is dealt over it (V68 P4) - else itself. */
export function cutStyle(st) {
  if (!st || !st.fitTo) return st;
  const o = Object.assign({}, st, { font: st.fitTo });
  delete o.fitTo;
  return o;
}

/** A pair 'in|out' as { enter, leave }. */
export const pairOf = (p) => { const [enter, leave] = String(p || '').split('|'); return { enter: enter || 'none', leave: leave || 'none' }; };

/**
 * What a page was dealt from its lane's mix (phase V49): the look of its entry of `mix` and its pair of `anims` - {} when it
 * was dealt nothing, or its references point at nothing (the mix gone or shorter: the lane's own look then).
 */
export function dealtOf(laneStyle, clipStyle) {
  const lane = laneStyle || {}, own = clipStyle || {};
  const out = {};
  const mix = mixOf(lane);
  if (mix && Number.isInteger(own.mixP) && mix[own.mixP]) Object.assign(out, mix[own.mixP]);
  const an = animsOf(lane);
  if (an && Number.isInteger(own.mixA) && an[own.mixA]) Object.assign(out, pairOf(an[own.mixA]));
  return out;
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
