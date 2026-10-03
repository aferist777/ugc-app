/* ═══════════════════════════════════════════════════════════════════════════
   CAPTIONS — the .ass file, ONE builder for the render and the preview (phases K0, K3; 2026-10-03).

   Burnt by libass through ffmpeg's `ass` filter (lib/mv3b-render.js), and drawn by the same libass in
   the page (layer.js, K4), so the screen and the file are one drawing.

   A PAGE IS LAID OUT ONCE. What a word does while it is spoken is a timed switch (`\t` at the word's
   moments, `\kf` for the fill), never a new layout - and what would change the layout or the boxes is
   drawn in a layer of its own (after the K3 review, checked on our ffmpeg frame by frame):
     layer +0  the line's box, ONE run for the whole page (a box drawn word by word left dark seams
               where the boxes of a semi-transparent line overlapped);
     layer +1  the box behind the spoken word (`box`): every word's box clear but the spoken one's,
               the spaces in clear blocks of their own so the box sits round the word only;
     layer +2  the letters - outlined, with their shadow; a word being popped steps aside here;
     layer +3  the pop or the jump (`pop`, `bounce`): the same text, every word clear but the spoken
               one, which grows - so scaling it never moves its neighbours or the other line.
   Every layer has the same font, size, spacing and scale, so libass lays the words in the same places
   in all of them (a border or a shadow does not move a glyph). Four layers per lane: lane i is 4i..4i+3,
   so a higher lane is still drawn on top. A style that needs none of this - no box with timed words,
   no box or pop effect - is one event, as it always was.

   A caption's words carry their times from its own start ({w, s, e, k}); they are used only while they
   still SAY the caption's text - a line corrected by hand is drawn as typed, untimed, rather than the
   old words being burnt over it. A word marked `k` wears the highlight for its whole page. Casing is
   applied here, to what is drawn - never to the stored text.

   THE LINES ARE BROKEN HERE, not by libass (phase K2): pages.js breakLines() says where - no line wider
   than 0.78 of the frame, the most even, never on a weak word - and the break is written as \N between
   the SAME two words in every layer, so the layers cannot part. libass's own wrap (0.88, the margins)
   is only a safety net now. A line somebody typed with a line break is drawn as typed; a page holding a
   word wider than a line is drawn in a smaller size, in a style row of its own, until it fits.

   PURE: it returns a string.
   ═══════════════════════════════════════════════════════════════════════════ */

import { resolveStyle, withAuto, anchorOf, cased } from './style.js';
import { assFace } from './fonts.js';
import { padOf } from './measure.js';
import { fitPage, fitText, tokensOf } from './pages.js';

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
export function karaokeLine(words, tag, casing, brk) {
  const k = tag || '\\k';
  const out = [];
  let cursor = 0;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const s = Math.max(cursor, Math.round((+w.s || 0) * 100));
    const e = Math.max(s, Math.round((+w.e || 0) * 100));
    if (s > cursor) out.push('{\\k' + (s - cursor) + '}');
    out.push('{' + k + (e - s) + '}' + assText(cased(w.w, casing)) + _gap(i, words.length, brk));
    cursor = e;
  }
  return out.join('');
}

// What follows word i of n: a space, a line break, or nothing after the last.
const _gap = (i, n, brk) => (i < n - 1 ? (brk && brk.has(i) ? '\\N' : ' ') : '');
// The page's text, the lines broken where the page breaks (a set of word indices a line ends at).
const _joined = (tokens, brk) => tokens.map((t, i) => t + _gap(i, tokens.length, brk)).join('');
// Line counts as the set of word indices a line ends at (the last line's end is no break).
const _breaks = (counts) => {
  const brk = new Set();
  let at = -1;
  for (const k of (counts || []).slice(0, -1)) { at += k; brk.add(at); }
  return brk.size ? brk : null;
};

// ── What a style needs ──────────────────────────────────────────────────────
const ms = (sec) => Math.max(0, Math.round((+sec || 0) * 1000));
const BOXY = (st) => st.borderStyle === 'box' || st.borderStyle === 'boxline';

/** Drawn in more than one event per page (see the header). */
export function layered(st) {
  return st.effect === 'box' || st.effect === 'pop' || st.effect === 'bounce' || (BOXY(st) && st.effect !== 'none');
}

// The words, while they still say the caption's text; a line edited by hand has none to time.
const _norm = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
function _wordsOf(c) {
  const w = Array.isArray(c.words) && c.words.length ? c.words : null;
  if (!w) return null;
  return _norm(w.map(x => x.w).join(' ')) === _norm(c.name) ? w : null;
}

// How the page arrives, repeated in every word's block (\r would undo it from the second word on).
// \fad and \move are the event's and go once (_place).
const _arrive = (st) => (st.appear === 'pop' ? '\\fscx85\\fscy85\\t(0,140,\\fscx100\\fscy100)' : '');
const _blur = (st) => ((+st.blur || 0) > 0 ? '\\blur' + (+st.blur).toFixed(1) : '');
const _times = (w) => { const s = ms(w.s); return [s, Math.max(ms(w.e), s + 1)]; };

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
function _textBody(c, st, words, page) {
  const arrive = _arrive(st), blur = _blur(st);
  const head = (arrive || blur) ? '{' + blur + arrive + '}' : '';
  const brk = page.brk;
  if (words && st.effect === 'karaoke') return head + karaokeLine(words, '\\k', st.casing, brk);
  if (words && st.effect === 'sweep') return head + karaokeLine(words, '\\kf', st.casing, brk);
  const perWord = words && (['color', 'pop', 'bounce'].includes(st.effect) || words.some(w => w.k));
  if (!perWord) return head + assText(cased(page.text, st.casing));
  const hl = tagColour(st.highlight), prim = tagColour(st.primary);
  return words.map((w, i) => {
    const [s, e] = _times(w);
    let t = '';
    if (st.effect === 'pop' || st.effect === 'bounce') {
      // The spoken word is drawn by the layer above, grown; here it steps aside for its moment.
      t = (w.k ? '\\1c' + hl : '') + '\\t(' + s + ',' + (s + 1) + ',\\alpha&HFF&)\\t(' + e + ',' + (e + 1) + ',\\alpha&H00&)';
    } else if (w.k) {
      t = '\\1c' + hl;                                    // marked to stand out: the whole page
    } else if (st.effect === 'color') {
      t = '\\t(' + s + ',' + (s + 1) + ',\\1c' + hl + ')\\t(' + e + ',' + (e + 1) + ',\\1c' + prim + ')';
    }
    return '{\\r' + blur + arrive + t + '}' + assText(cased(w.w, st.casing)) + _gap(i, words.length, brk);
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
function _lineBoxBody(st, page) {
  return '{' + _arrive(st) + '\\1a&HFF&\\2a&HFF&\\3c' + tagColour(st.backColor) + '\\3a' + tagAlpha(st.backAlpha) + '}'
    + assText(cased(page.text, st.casing));
}

// ── layer +1: the box behind the spoken word ───────────────────────────────
function _wordBoxBody(st, words, brk) {
  const arrive = _arrive(st), hl = tagColour(st.highlight);
  const clear = '\\1a&HFF&\\2a&HFF&\\3a&HFF&';
  return words.map((w, i) => {
    const [s, e] = _times(w);
    return '{\\r' + arrive + clear + '\\t(' + s + ',' + (s + 1) + ',\\3c' + hl + '\\3a&H00&)\\t(' + e + ',' + (e + 1) + ',\\3a&HFF&)}'
      + assText(cased(w.w, st.casing)) + (i < words.length - 1 ? '{\\r' + arrive + clear + '}' + _gap(i, words.length, brk) : '');
  }).join('');
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
  const make = (name, st) => ({ name, st, a: { ...anchorOf(st, w, h), h }, layered: layered(st) });
  for (const track of list) {
    const clips = ((track && track.clips) || []).filter(c => c && c.name && (+c.dur) > 0);
    if (!clips.length) continue;
    const s = make('S' + used.length, withAuto(resolveStyle(track.style), w, h));
    used.push({ ...s, clips, lane: track.style });
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
      const s = make(u.name + 'o' + own.size, withAuto(resolveStyle(u.lane, c.style), w, h));
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
      const z = make(s.name + 'z' + shrunk.size, Object.assign({}, s.st, { size }));
      shrunk.set(key, z);
      extra.push(z);
    }
    return shrunk.get(key);
  };

  const lines = [];
  const dlg = (layer, start, end, style, text) => lines.push('Dialogue: ' + layer + ',' + assTime(start) + ','
    + assTime(end) + ',' + style + ',,0,0,0,,' + text);
  used.forEach((u, lane) => {
    const L = lane * 4;
    for (const c of u.clips) {
      let s = styleOf(u, lane, c);
      const start = Math.max(0, +c.start || 0);
      const end = start + Math.max(0.05, +c.dur || 0);
      const words = _wordsOf(c);
      // Where the page breaks into lines: between its words - or, typed, in each paragraph as typed, at
      // breakable blanks only (a no-break space stays where it is). A typed line that needs no break is
      // drawn exactly as typed, its spaces and all (review K2).
      const page = { brk: null, text: String(c.name) };
      if (words) {
        const tokens = words.map(x => String(x.w));
        const fit = fitPage(tokens, s.st, w);
        if (fit.size < Math.round(+s.st.size || 0)) s = smaller(s, fit.size);
        page.brk = _breaks(fit.lines);
        page.text = _joined(tokens, page.brk);
      } else {
        const paras = String(c.name).split('\n').map(tokensOf);
        if (paras.some(p => p.length)) {
          const fit = fitText(paras, s.st, w);
          if (fit.size < Math.round(+s.st.size || 0)) s = smaller(s, fit.size);
          if (fit.lines.some(l => l.length > 1)) page.text = paras.map((p, i) => _joined(p, _breaks(fit.lines[i]))).join('\n');
        }
      }
      const place = _place(s.st, s.a);
      if (s.layered && BOXY(s.st)) dlg(L, start, end, s.name + 'b', place + _lineBoxBody(s.st, page));
      if (s.layered && s.st.effect === 'box' && words) dlg(L + 1, start, end, s.name + 'b', place + _wordBoxBody(s.st, words, page.brk));
      dlg(L + 2, start, end, s.name, place + _textBody(c, s.st, words, page));
      if (s.layered && (s.st.effect === 'pop' || s.st.effect === 'bounce') && words) dlg(L + 3, start, end, s.name, place + _popBody(s.st, words, page.brk));
    }
  });

  const styles = [];
  for (const s of used.concat(extra)) {
    styles.push('Style: ' + textStyle(s.name, s.st, s.a, w, h, s.layered));
    if (s.layered && (BOXY(s.st) || s.st.effect === 'box')) styles.push('Style: ' + boxStyle(s.name + 'b', s.st, s.a, w, h));
  }

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
