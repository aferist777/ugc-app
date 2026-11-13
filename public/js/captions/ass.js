/* ═══════════════════════════════════════════════════════════════════════════
   CAPTIONS — the .ass file, ONE builder for the render and the preview.

   Burnt by libass through ffmpeg's `ass` filter (lib/mv3b-render.js), and drawn by the same libass in
   the page (layer.js), so the screen and the file are one drawing.

   A PAGE IS LAID OUT ONCE. What a word does while it is spoken is a timed switch (`\t` at the word's
   moments, `\kf` for the fill), never a new layout - and what would change the layout or the boxes is
   drawn in a layer of its own (checked on our ffmpeg frame by frame):
     layer +0  the line's box, ONE run for the whole page (a box drawn word by word leaves dark seams
               where the boxes of a semi-transparent line overlap);
     layer +1  the box behind the spoken word (`box`): every word's box clear but the spoken one's,
               the spaces in clear blocks of their own so the box sits round the word only;
     layer +2  the letters - outlined, with their shadow; a word being popped steps aside here;
     layer +3  the pop or the jump (`pop`, `bounce`): the same text, every word clear but the spoken
               one, which grows - so scaling it never moves its neighbours or the other line.
   Every layer has the same font, size, spacing and scale, so libass lays the words in the same places
   in all of them (a border or a shadow does not move a glyph). Four layers per lane: lane i is 4i..4i+3,
   so a higher lane is still drawn on top. A style that needs none of this - no box with timed words,
   no box or pop effect - is one event.

   A caption's words carry their times from its own start ({w, s, e, k}); they are used only while they
   still SAY the caption's text - a line corrected by hand is drawn as typed, untimed, rather than the
   old words being burnt over it. A word marked `k` wears the marked colour (style.js markedColour)
   for its whole page in every effect - in karaoke and sweep before AND after it is sung; in color and box
   it turns the text's colour while it is spoken, so it still flashes and its letters stay off the box.
   Casing is applied here, to what is drawn - never to the stored text.

   A TYPED line of the subtitle lane plays the spoken word too: its words are timed by
   their letters over the whole line (words.js typedWords) here, where it is drawn - nothing stored, the line stays typed for
   every other rule. A text lane's lines are titles: drawn as typed.

   THE LINES ARE BROKEN HERE, not by libass: pages.js breakLines() says where - no line wider
   than 0.78 of the frame, the most even, never on a weak word - and the break is written as \N between
   the SAME two words in every layer, so the layers cannot part. libass's own wrap (0.88, the margins)
   is only a safety net. A line somebody typed with a line break is drawn as typed; a page holding a
   word wider than a line is drawn in a smaller size, in a style row of its own, until it fits.
   How a page is drawn - its words, breaks and size - is place.js drawnPage, the same rule the editor's rectangle
   of the page is worked out by; a page that would run past an edge of the frame is moved back inside in its
   \pos, and one that fits is written where it is.

   A TEXT LINE WITH AN ENTRANCE, AN EXIT, A PLATE, A TILT OR A GLOW is drawn by text-fx.js in its lane's four
   layers, with a style row of its own; every other line is drawn here. A line in a font without Cyrillic
   that holds a Cyrillic letter is drawn whole in the font's twin (fonts.js drawnFamily).

   A SUBTITLE PAGE WITH AN IN OR AN OUT is drawn here in the same layers, moving as a whole (page-fx.js
   says how): from its own place, its In inside its own events - the words' moments untouched - and its Out in a second set of
   events over its last moments, the words carried on from where they were (_shift). A page without them has no
   motion tags; `at-once` (an In chosen to be none) only takes the preset's `appear` away.

   A SUBTITLE LANE IN TWO ROWS (style.js `rows`) is drawn by its plan (place.js rowsPlan): each page from its In, played
   before its first word, to the end of its Out, played after its end, whole in between for at least 0.8 s, every other page in
   the second row - the same layers, the words' moments the page's. A lane without it is drawn in one row.

   PURE: it returns a string.
   ═══════════════════════════════════════════════════════════════════════════ */

import { resolveStyle, withAuto, anchorOf, cased, markedColour } from './style.js';
import { assFace, drawnFamily } from './fonts.js';
import { padOf } from './measure.js';
import { spells } from './words.js';
import { drawnPage, boxOf, gapAfter as _gap, rowsPlan, pageKey } from './place.js';
import { textLine, usesFx } from './text-fx.js';
import { pageMotion, placeTags, motionTags, popScale, axisOf, awayFrom } from './page-fx.js';

// &HAABBGGRR - alpha first and the channels backwards, which is the format and not a mistake.
export function hexToAss(hex, alpha) {
  const h = String(hex || '#000000').replace('#', '').padEnd(6, '0');
  const a = Math.max(0, Math.min(255, Math.round(alpha == null ? 0 : alpha)));
  const two = (n) => n.toString(16).toUpperCase().padStart(2, '0');
  return '&H' + two(a) + h.slice(4, 6).toUpperCase() + h.slice(2, 4).toUpperCase() + h.slice(0, 2).toUpperCase();
}
// The same colour inside an override tag (\1c&HBBGGRR&), which has no alpha of its own.
const tagColour = (hex) => hexToAss(hex, 0).replace(/^&H00/, '&H') + '&';
// An opacity 0..1 as an override alpha (\3a&HAA&): 0 is solid in this format.
const tagAlpha = (opacity) => '&H' + Math.round((1 - Math.max(0, Math.min(1, +opacity || 0))) * 255).toString(16).toUpperCase().padStart(2, '0') + '&';

// H:MM:SS.cc, centiseconds - the format's own resolution. Rounded down, so a caption never outlives
// the shot it belongs to.
export function assTime(t) {
  const v = Math.max(0, +t || 0);
  const h = Math.floor(v / 3600);
  const m = Math.floor((v - h * 3600) / 60);
  const s = Math.floor(v - h * 3600 - m * 60);
  const cs = Math.floor((v - Math.floor(v)) * 100);
  return h + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0') + '.' + String(cs).padStart(2, '0');
}

// Braces open an override block, so a caption containing one would turn the rest of the line into
// instructions: swapped for parentheses rather than dropped.
export function assText(s) {
  return String(s || '')
    .replace(/\r/g, '')
    .replace(/\{/g, '(').replace(/\}/g, ')')
    .replace(/\n/g, '\\N');
}

// Per-word colour, the libass way: a syllable is `secondary` before its time and `primary` after. \k
// switches at once, \kf fills from the left. A PAUSE IS A SYLLABLE OF ITS OWN: \k carries a length, not
// a moment, so the moments are rounded once and the lengths taken between them - no word lights early by
// the length of a pause, and nothing drifts.
// A MARKED word (`k`) wears its colour before AND after it is sung - both colours of its syllable -
// and the next word takes the style's two back explicitly (\r would start the colours over, not the
// timing). `mark`: { on, prim, sec } as override colours, or nothing - a line without a marked word is
// written with no mark colours.
export function karaokeLine(words, tag, casing, brk, mark) {
  const k = tag || '\\k';
  const out = [];
  let cursor = 0;
  let marked = false;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const s = Math.max(cursor, Math.round((+w.s || 0) * 100));
    const e = Math.max(s, Math.round((+w.e || 0) * 100));
    if (s > cursor) out.push('{\\k' + (s - cursor) + '}');
    let col = '';
    if (mark && w.k) col = '\\1c' + mark.on + '\\2c' + mark.on;
    else if (mark && marked) col = '\\1c' + mark.prim + '\\2c' + mark.sec;
    marked = !!(mark && w.k);
    out.push('{' + col + k + (e - s) + '}' + assText(cased(w.w, casing)) + _gap(i, words.length, brk));
    cursor = e;
  }
  return out.join('');
}

// ── What a style needs ──────────────────────────────────────────────────────
const ms = (sec) => Math.max(0, Math.round((+sec || 0) * 1000));
const BOXY = (st) => st.borderStyle === 'box' || st.borderStyle === 'boxline';

/** Drawn in more than one event per page (see the header). */
export function layered(st) {
  return st.effect === 'box' || st.effect === 'pop' || st.effect === 'bounce' || (BOXY(st) && st.effect !== 'none');
}

// The words, while they still spell the caption's text (words.js); a line they no longer spell has none to time.
const _wordsOf = (c) => (spells(c.words, c.name) ? c.words : null);

// How the page arrives, repeated in every word's block (\r would undo it from the second word on).
// \fad and \move are the event's and go once (_place).
const _arrive = (st) => (st.appear === 'pop' ? '\\fscx85\\fscy85\\t(0,140,\\fscx100\\fscy100)' : '');
const _blur = (st) => ((+st.blur || 0) > 0 ? '\\blur' + (+st.blur).toFixed(1) : '');
const _times = (w) => { const s = ms(w.s); return [s, Math.max(ms(w.e), s + 1)]; };
// A word's look switched while it is spoken: `base` always, `on` from its start, `after` from its end. A word an Out's events
// find spoken and over (`done`) or being spoken (`on`) - _shift - starts in that state.
function _sw(w, base, on, after) {
  if (w.was === 'done') return base + after;
  const [s, e] = _times(w);
  if (w.was === 'on') return base + on + '\\t(' + e + ',' + (e + 1) + ',' + after + ')';
  return base + '\\t(' + s + ',' + (s + 1) + ',' + on + ')\\t(' + e + ',' + (e + 1) + ',' + after + ')';
}

// The words as an event that starts `off` ms into the page sees them (an Out's): their times from that event's
// start, `t0` the start before it was cut at 0 (s), and what each was by then. `off` below 0 - an event starting
// before the page (an In played before its first word): the words come that much later in it.
function _shift(words, off) {
  if (!words || !off) return words;
  const o = off / 1000;
  return words.map((w) => {
    const s = +w.s || 0, e = +w.e || 0;
    const x = Object.assign({}, w, { s: Math.max(0, s - o), e: Math.max(0, e - o), t0: s - o });
    if (e <= o) { x.was = 'done'; x.s = 0; x.e = 0; } else if (s < o) x.was = 'on';
    return x;
  });
}
// A page's time in centiseconds as assTime writes it - the moment libass starts an event at.
const _cs = (t) => { const v = Math.max(0, +t || 0); return Math.floor(v) * 100 + Math.floor((v - Math.floor(v)) * 100); };

// The page's own tags: where it sits, how it arrives.
function _place(st, a) {
  const x = Math.round(a.x), y = Math.round(a.y);
  const pos = st.appear === 'slide'
    ? '\\move(' + x + ',' + (y + Math.round(40 * (a.h / 1920))) + ',' + x + ',' + y + ',0,180)'
    : '\\pos(' + x + ',' + y + ')';
  const fade = (st.appear === 'fade' || st.appear === 'slide') ? '\\fad(' + (st.appear === 'fade' ? 160 : 120) + ',0)' : '';
  return '{\\an' + a.an + pos + fade + '}';
}

// ── layer +2: the letters ───────────────────────────────────────────────────
// `head`: a moving page's own tags for every block - its motion, and the blur when the motion does not set it -
// in place of how a page arrives.
function _textBody(c, st, words, page, head0) {
  const arrive = head0 != null ? head0 : _arrive(st), blur = head0 != null ? '' : _blur(st);
  const head = (arrive || blur) ? '{' + blur + arrive + '}' : '';
  const brk = page.brk;
  const anyMark = !!(words && words.some(w => w.k));
  const mk = anyMark ? tagColour(markedColour(st)) : '';
  if (words && (st.effect === 'karaoke' || st.effect === 'sweep')) {
    const mark = anyMark ? { on: mk, prim: tagColour(st.primary), sec: tagColour(st.secondary) } : null;
    // An Out's events find a word half filled: it is shown filled - a fill cannot start in its middle.
    const ws = st.effect === 'sweep' ? words.map(w => (w.was === 'on' ? Object.assign({}, w, { e: 0 }) : w)) : words;
    return head + karaokeLine(ws, st.effect === 'sweep' ? '\\kf' : '\\k', st.casing, brk, mark);
  }
  const perWord = words && (['color', 'pop', 'bounce'].includes(st.effect) || anyMark);
  if (!perWord) return head + assText(cased(page.text, st.casing));
  const hl = tagColour(st.highlight), prim = tagColour(st.primary);
  return words.map((w, i) => {
    let t = '';
    if (st.effect === 'pop' || st.effect === 'bounce') {
      // The spoken word is drawn by the layer above, grown; here it steps aside for its moment.
      t = _sw(w, w.k ? '\\1c' + mk : '', '\\alpha&HFF&', '\\alpha&H00&');
    } else if (w.k && (st.effect === 'color' || st.effect === 'box')) {
      // Marked, the whole page - and while it is spoken it turns the text's colour: a flash where every
      // other word lights up, and letters that do not sink into a box of the same colour.
      t = _sw(w, '\\1c' + mk, '\\1c' + prim, '\\1c' + mk);
    } else if (w.k) {
      t = '\\1c' + mk;                                    // marked to stand out: the whole page
    } else if (st.effect === 'color') {
      t = _sw(w, '', '\\1c' + hl, '\\1c' + prim);
    }
    return '{\\r' + blur + arrive + t + '}' + assText(cased(w.w, st.casing)) + _gap(i, words.length, brk);
  }).join('');
}

// ── layer +3 on a moving page: its size is the page's times its growth (page-fx.js popScale) ──
function _popBodyMoving(st, words, brk, part, base, head) {
  const hl = tagColour(st.highlight);
  const grow = st.effect === 'pop' ? { x: 112, y: 125, up: 80, down: 170 } : { x: 100, y: 132, up: 60, down: 140 };
  return words.map((w, i) => {
    const at = w.was === 'done' ? -1e9 : w.t0 != null ? Math.round(w.t0 * 1000) : ms(w.s);
    return '{\\r' + head + '\\alpha&HFF&\\1c' + hl + _sw(w, '', '\\alpha&H00&', '\\alpha&HFF&') + popScale(part, base, at, grow) + '}'
      + assText(cased(w.w, st.casing)) + _gap(i, words.length, brk);
  }).join('');
}

// ── layer +3: the spoken word grows ─────────────────────────────────────────
function _popBody(st, words, brk) {
  const arrive = _arrive(st), blur = _blur(st), hl = tagColour(st.highlight);
  const pop = st.effect === 'pop';
  const grow = pop ? '\\fscx112\\fscy125' : '\\fscy132';
  const up = pop ? 80 : 60, down = pop ? 170 : 140;
  return words.map((w, i) => {
    const [s, e] = _times(w);
    return '{\\r' + blur + arrive + '\\alpha&HFF&\\1c' + hl
      + '\\t(' + s + ',' + (s + 1) + ',\\alpha&H00&)\\t(' + s + ',' + (s + up) + ',' + grow + ')'
      + '\\t(' + (s + up) + ',' + (s + down) + ',\\fscx100\\fscy100)\\t(' + e + ',' + (e + 1) + ',\\alpha&HFF&)}'
      + assText(cased(w.w, st.casing)) + _gap(i, words.length, brk);
  }).join('');
}

// ── layer +0: the line's box, one run ───────────────────────────────────────
function _lineBoxBody(st, page, head) {
  return '{' + (head != null ? head : _arrive(st)) + '\\1a&HFF&\\2a&HFF&\\3c' + tagColour(st.backColor) + '\\3a' + tagAlpha(st.backAlpha) + '}'
    + assText(cased(page.text, st.casing));
}

// ── layer +1: the box behind the spoken word ───────────────────────────────
function _wordBoxBody(st, words, brk, head) {
  const arrive = head != null ? head : _arrive(st), hl = tagColour(st.highlight);
  const clear = '\\1a&HFF&\\2a&HFF&\\3a&HFF&';
  return words.map((w, i) => {
    return '{\\r' + arrive + _sw(w, clear, '\\3c' + hl + '\\3a&H00&', '\\3a&HFF&') + '}'
      + assText(cased(w.w, st.casing)) + (i < words.length - 1 ? '{\\r' + arrive + clear + '}' + _gap(i, words.length, brk) : '');
  }).join('');
}

/**
 * A SUBTITLE PAGE THAT MOVES: its In in its own events [start, the Out's start], its Out in a second set over its
 * last moments - each set in the layers a page of its style has (see the header). `dlg` writes an event.
 */
function _movingPage(dlg, M, s, L, start, end, box, drawn) {
  const c0 = _cs(start), c1 = _cs(end);
  // The Out's events start where its length before the end falls - at a centisecond, as libass starts them.
  const cOut = M.leave ? Math.max(c0 + 1, Math.min(c1 - 1, _cs(end - M.leave.ms / 1000))) : c1;
  const sets = [{ part: M.enter, t0: start, t1: M.leave ? cOut / 100 : end, off: 0, ev: (cOut - c0) * 10 }];
  if (M.leave) sets.push({ part: M.leave, t0: cOut / 100, t1: end, off: (cOut - c0) * 10, ev: (c1 - cOut) * 10 });
  _drawSets(dlg, s, L, box, drawn, sets, 0);
}

/**
 * The events of a moving page: `sets` [{ part (page-fx.js, or null - at rest), t0, t1 (s), off (ms - the words' shift, _shift), ev
 * (the event's length, ms) }], each in the layers a page of its style has (see the header), drawn `lift` px down (its row).
 */
function _drawSets(dlg, s, L, box, drawn, sets, lift) {
  const st = s.st;
  const words = drawn.words;
  const page = { brk: drawn.brk, text: drawn.text };
  // Where it is drawn at rest - as a page without motion (_place) - and the middle of its text block (place.js boxOf): the
  // anchor less how far the block hangs from it, plus half of it.
  const ax = s.a.x + box.dx, ay = s.a.y + box.dy + lift;
  const hang = box.an === 2 ? box.th : box.an === 5 ? box.th / 2 : 0;
  const cx = box.ax, cy = box.ay - hang + box.th / 2 + lift;
  const grows = box.an === 2 ? box.th / 2 : box.an === 8 ? -box.th / 2 : 0;
  const base0 = { sx: +st.scaleX || 100, sy: +st.scaleY || 100, lh: (+st.size || 60) * ((+st.scaleY || 100) / 100), blur: +st.blur || 0, grows };
  for (const x of sets) {
    const ws = _shift(words, x.off);
    const axis = axisOf(x.part, s.a.an);
    const base = Object.assign({}, base0, { axis });
    const boxBase = Object.assign({}, base, { blur: 0 });
    const place = placeTags(x.part, s.a.an, ax, ay, cx, cy, axis, x.ev);
    const blur = x.part && x.part.keys.blur ? '' : _blur(st);
    const head = blur + motionTags(x.part, base);
    if (s.layered && BOXY(st)) dlg(L, x.t0, x.t1, s.name + 'b', place + _lineBoxBody(st, page, motionTags(x.part, boxBase)));
    if (s.layered && st.effect === 'box' && ws) dlg(L + 1, x.t0, x.t1, s.name + 'b', place + _wordBoxBody(st, ws, page.brk, motionTags(x.part, boxBase)));
    dlg(L + 2, x.t0, x.t1, s.name, place + _textBody(null, st, ws, page, head));
    if (s.layered && (st.effect === 'pop' || st.effect === 'bounce') && ws) {
      dlg(L + 3, x.t0, x.t1, s.name, place + _popBodyMoving(st, ws, page.brk, x.part, base, blur + motionTags(x.part, base, true)));
    }
  }
}

/**
 * A PAGE OF A LANE IN TWO ROWS, drawn by its plan `R` (place.js rowsPlan): its In over [S - inL, S], whole until H, its
 * Out over [H, H + outL], in its row; a move up or down turned away from the other row (page-fx.js awayFrom). Not moving at all (no
 * In or Out, or no room for them) - one set of events over [S, H], arriving with nothing.
 */
function _rowPage(dlg, s, L, R, box, drawn, c) {
  const M = pageMotion(s.st, 0, { enter: R.inL, leave: R.outL });
  const enter = M ? awayFrom(M.enter, R.other) : null, leave = M ? awayFrom(M.leave, R.other) : null;
  if (!enter && !leave) {
    const st = s.st.appear !== 'none' ? Object.assign({}, s.st, { appear: 'none' }) : s.st;
    const place = _place(st, { ...s.a, x: s.a.x + box.dx, y: s.a.y + box.dy + R.lift });
    const words = drawn.words, page = { brk: drawn.brk, text: drawn.text };
    if (s.layered && BOXY(st)) dlg(L, R.S, R.H, s.name + 'b', place + _lineBoxBody(st, page));
    if (s.layered && st.effect === 'box' && words) dlg(L + 1, R.S, R.H, s.name + 'b', place + _wordBoxBody(st, words, page.brk));
    dlg(L + 2, R.S, R.H, s.name, place + _textBody(c, st, words, page));
    if (s.layered && (st.effect === 'pop' || st.effect === 'bounce') && words) dlg(L + 3, R.S, R.H, s.name, place + _popBody(st, words, page.brk));
    return;
  }
  // The events start at centiseconds, as libass starts them (_cs); each written half a centisecond in, so assTime gives that one.
  const c0 = _cs(R.S - (enter ? R.inL : 0));
  const cH = Math.max(c0 + 1, _cs(R.H));
  const cE = leave ? Math.max(cH + 1, _cs(R.H + R.outL)) : cH;
  const at = (cs) => (cs + 0.5) / 100;
  const sets = [{ part: enter, t0: at(c0), t1: at(cH), off: Math.round((c0 / 100 - R.S) * 1000), ev: (cH - c0) * 10 }];
  if (leave) sets.push({ part: leave, t0: at(cH), t1: at(cE), off: Math.round((cH / 100 - R.S) * 1000), ev: (cE - cH) * 10 });
  _drawSets(dlg, s, L, box, drawn, sets, R.lift);
}

// ── The [V4+ Styles] entries ────────────────────────────────────────────────
const _alpha255 = (opacity, dflt) => Math.round((1 - Math.max(0, Math.min(1, opacity == null ? dflt : +opacity))) * 255);

function _styleRow(name, st, a, w, h, bs, outlineCol, backCol, outline, shadow) {
  const face = assFace(st.font, st.bold);
  return [
    name, face.family, Math.round(st.size),
    hexToAss(st.primary, 0), hexToAss(st.secondary, 0), outlineCol, backCol,
    face.bold, st.italic ? -1 : 0, 0, 0,
    Math.round(+st.scaleX || 100), Math.round(+st.scaleY || 100), +st.spacing || 0, 0,
    bs, outline, shadow,
    a.an, Math.round(w * 0.06), Math.round(w * 0.06), Math.round(h * 0.05), 1,
  ].join(',');
}

// The letters' style. Layered, it is always outlined letters (border style 1) - the boxes are drawn
// by the box style; on its own it is the whole look:
//   1 an outline (OutlineColour), the shadow in BackColour;
//   3 a box in OutlineColour (that is how libass fills it);
//   4 a box in BackColour AND an outline in OutlineColour.
function textStyle(name, st, a, w, h, isLayered) {
  const shadowCol = hexToAss(st.shadowColor, _alpha255(st.shadowAlpha, 0.75));
  if (isLayered || !BOXY(st)) {
    // A 'box' look has no letter outline - its letters stand on the box.
    const outline = (isLayered && st.borderStyle === 'box') ? 0 : (+st.outline || 0);
    return _styleRow(name, st, a, w, h, 1, hexToAss(st.outlineColor, 0), shadowCol, outline, +st.shadow || 0);
  }
  const boxAlpha = _alpha255(st.backAlpha, 0);
  if (st.borderStyle === 'boxline') {
    return _styleRow(name, st, a, w, h, 4, hexToAss(st.outlineColor, 0), hexToAss(st.backColor, boxAlpha), padOf(st), +st.shadow || 0);
  }
  return _styleRow(name, st, a, w, h, 3, hexToAss(st.backColor, boxAlpha), shadowCol,
    (+st.outline || 0) > 0 ? +st.outline : padOf(st), +st.shadow || 0);
}

// The boxes' style (layers +0 and +1): border style 3, colours set by the events, no shadow.
function boxStyle(name, st, a, w, h) {
  return _styleRow(name, st, a, w, h, 3, hexToAss(st.backColor, _alpha255(st.backAlpha, 0)), '&HFF000000', padOf(st), 0);
}

/**
 * Every lane that holds words, burnt into ONE file: a style per lane, and one more for every caption
 * that wears a style of its own (and a box style beside each that needs one). Lanes are given bottom
 * lane first (style.js captionLanes).
 */
export function buildAss(lanes, w, h) {
  const list = (Array.isArray(lanes) ? lanes : [lanes]).filter(Boolean);
  const used = [];
  // A LANE HOLDING A MARKED WORD: a page with one is written word by word, and on a 'box' look
  // with no spoken effect - one event, a box per run of letters - the semi-transparent boxes of the runs overlap
  // in dark seams. Such a lane is drawn layered, the box once under the page; a lane without one is not affected.
  const make = (name, st, marks) => ({ name, st, a: { ...anchorOf(st, w, h), h }, marks: !!marks,
    layered: layered(st) || (!!marks && st.borderStyle === 'box' && st.effect === 'none') });
  for (const track of list) {
    const clips = ((track && track.clips) || []).filter(c => c && c.name && (+c.dur) > 0);
    if (!clips.length) continue;
    const marks = clips.some(c => { const ws = _wordsOf(c); return !!ws && ws.some(x => x && x.k); });
    const s = make('S' + used.length, withAuto(resolveStyle(track.style), w, h), marks);
    used.push({ ...s, clips, lane: track.style, subs: track.kind === 'subs', track });
  }
  if (!used.length) return '';
  const first = used[0].st;

  // A caption's own style: one entry per DIFFERENT result, named after its lane.
  const extra = [];
  const own = new Map();
  const styleOf = (u, i, c) => {
    if (!c.style || typeof c.style !== 'object' || !Object.keys(c.style).length) return u;
    const key = i + '|' + JSON.stringify(c.style);
    if (!own.has(key)) {
      const s = make(u.name + 'o' + own.size, withAuto(resolveStyle(u.lane, c.style), w, h), u.marks);
      own.set(key, s);
      extra.push(s);
    }
    return own.get(key);
  };

  // A page holding a word wider than a line: the same style at the size it fits at.
  const shrunk = new Map();
  const smaller = (s, size) => {
    const key = s.name + '|' + size;
    if (!shrunk.has(key)) {
      const z = make(s.name + 'z' + shrunk.size, Object.assign({}, s.st, { size }), s.marks);
      shrunk.set(key, z);
      extra.push(z);
    }
    return shrunk.get(key);
  };

  // A line in a font without Cyrillic that holds a Cyrillic letter: the same style in the font's twin.
  const twins = new Map();
  const twinned = (s, text) => {
    const fam = drawnFamily(s.st.font, text);
    if (fam === s.st.font) return s;
    const key = s.name + '|' + fam;
    if (!twins.has(key)) {
      const z = make(s.name + 't' + twins.size, Object.assign({}, s.st, { font: fam }), s.marks);
      twins.set(key, z);
      extra.push(z);
    }
    return twins.get(key);
  };
  // The text lines drawn by text-fx.js, and their own style rows.
  const fxStyles = [];

  const lines = [];
  const dlg = (layer, start, end, style, text) => lines.push('Dialogue: ' + layer + ',' + assTime(start) + ','
    + assTime(end) + ',' + style + ',,0,0,0,,' + text);
  used.forEach((u, lane) => {
    const L = lane * 4;
    // A subtitle lane in two rows: every page by its plan.
    const plan = u.subs ? rowsPlan(u.track, w, h) : null;
    u.clips.forEach((c, i) => {
      let s = twinned(styleOf(u, lane, c), c.name);
      const start = Math.max(0, +c.start || 0);
      const end = start + Math.max(0.05, +c.dur || 0);
      if (!u.subs && usesFx(s.st)) {
        const fx = textLine({ text: c.name, start, end }, s.st, s.name + 'x' + fxStyles.length, L, w, h);
        fxStyles.push(...fx.styles);
        lines.push(...fx.events);
        return;
      }
      // Where the page breaks into lines: between its words - or, typed, in each paragraph as typed, at
      // breakable blanks only (a no-break space stays where it is). A typed line that needs no break is
      // drawn exactly as typed, its spaces and all. A typed line of the subtitle lane with a
      // spoken word is timed by its letters. One rule with the editor's rectangle (place.js).
      const drawn = drawnPage(c, s.st, u.subs, w, end - start);
      const box = boxOf(drawn, s.st, w, h);
      if (drawn.shrink) s = smaller(s, drawn.shrink);
      const R = plan ? plan.get(pageKey(c, i)) : null;
      if (R) { _rowPage(dlg, s, L, R, box, drawn, c); return; }
      // A subtitle page with an In or an Out moves (page-fx.js); any other is drawn without motion.
      const M = u.subs ? pageMotion(s.st, end - start) : null;
      if (M) { _movingPage(dlg, M, s, L, start, end, box, drawn); return; }
      const words = drawn.words;
      const page = { brk: drawn.brk, text: drawn.text };
      // An In chosen to be none (`at-once`) arrives with nothing - the preset's way of arriving goes.
      const st = s.st.enter === 'at-once' && s.st.appear !== 'none' ? Object.assign({}, s.st, { appear: 'none' }) : s.st;
      // Never off the frame: a page past an edge is drawn moved back inside.
      const place = _place(st, (box.dx || box.dy) ? { ...s.a, x: s.a.x + box.dx, y: s.a.y + box.dy } : s.a);
      if (s.layered && BOXY(st)) dlg(L, start, end, s.name + 'b', place + _lineBoxBody(st, page));
      if (s.layered && st.effect === 'box' && words) dlg(L + 1, start, end, s.name + 'b', place + _wordBoxBody(st, words, page.brk));
      dlg(L + 2, start, end, s.name, place + _textBody(c, st, words, page));
      if (s.layered && (st.effect === 'pop' || st.effect === 'bounce') && words) dlg(L + 3, start, end, s.name, place + _popBody(st, words, page.brk));
    });
  });

  const styles = [];
  for (const s of used.concat(extra)) {
    styles.push('Style: ' + textStyle(s.name, s.st, s.a, w, h, s.layered));
    if (s.layered && (BOXY(s.st) || s.st.effect === 'box')) styles.push('Style: ' + boxStyle(s.name + 'b', s.st, s.a, w, h));
  }
  styles.push(...fxStyles);

  const head = [
    '[Script Info]',
    'ScriptType: v4.00+',
    'PlayResX: ' + Math.round(w),
    'PlayResY: ' + Math.round(h),
    'WrapStyle: ' + (first.wrap ? 0 : 2),
    // Sizes are written against PlayRes, so they scale with it.
    'ScaledBorderAndShadow: yes',
    // No colour matrix: the page draws on a canvas and the render converts on its own.
    'YCbCr Matrix: None',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour,'
      + ' Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle,'
      + ' Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
  ].concat(styles).concat([
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ]);

  return head.concat(lines).join('\n') + '\n';
}
