/* ═══════════════════════════════════════════════════════════════════════════
   CAPTIONS — the .ass file, ONE builder for the render and the preview (phases K0, K3; 2026-10-03).

   Burnt by libass through ffmpeg's `ass` filter (lib/mv3b-render.js), and - from phase K4 - drawn by
   the same libass in the page, so the screen and the file are one drawing.

   ONE PAGE IS ONE EVENT. What happens to a word while it is spoken - a colour, a box behind it, a short
   pop, a jump, a fill - is a switch at that word's moment inside the page's own event (`\t` with the
   word's times, `\kf` for the fill), never a new event per word: the page is laid out once and does not
   jump, and its entrance (pop, fade, slide) plays once. Checked on our ffmpeg frame by frame: a colour
   switch inside one event, a box behind ONE word (BorderStyle 3 - boxes are drawn per run, and every
   run's box is clear but the spoken word's), a pop of one word, \kf from the unsung colour to the sung.
   Each word's block starts with \r, so nothing one word does leaks into the next.

   A caption carries its words with times from its own start ({w, s, e, k}); without words (a line typed
   by hand) there is nothing to time and the page is drawn whole. A word marked `k` wears the highlight
   for the whole page. The casing is applied here, to what is drawn - never to the stored text.

   PURE: it returns a string.
   ═══════════════════════════════════════════════════════════════════════════ */

import { resolveStyle, withAuto, anchorOf, cased } from './style.js';
import { assFace } from './fonts.js';

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
export function karaokeLine(words, tag, casing) {
  const k = tag || '\\k';
  const out = [];
  let cursor = 0;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const s = Math.max(cursor, Math.round((+w.s || 0) * 100));
    const e = Math.max(s, Math.round((+w.e || 0) * 100));
    if (s > cursor) out.push('{\\k' + (s - cursor) + '}');
    out.push('{' + k + (e - s) + '}' + assText(cased(w.w, casing)) + (i < words.length - 1 ? ' ' : ''));
    cursor = e;
  }
  return out.join('');
}

// ── The effects ─────────────────────────────────────────────────────────────
const ms = (sec) => Math.max(0, Math.round((+sec || 0) * 1000));

// How the page arrives, the part that is repeated in every word's block (it is the text's own scale;
// \r would otherwise undo it from the second word on). \fad and \move are the event's and go once.
function _arrive(st) {
  return st.appear === 'pop' ? '\\fscx85\\fscy85\\t(0,140,\\fscx100\\fscy100)' : '';
}

// What one word does while it is spoken. `t` its moments in ms from the page's start.
function _wordTags(st, w) {
  const s = ms(w.s), e = Math.max(ms(w.e), s + 1);
  const hl = tagColour(st.highlight), prim = tagColour(st.primary);
  if (w.k) return '\\1c' + hl;                              // marked to stand out: the whole page
  switch (st.effect) {
    case 'color':
      return '\\t(' + s + ',' + (s + 1) + ',\\1c' + hl + ')\\t(' + e + ',' + (e + 1) + ',\\1c' + prim + ')';
    case 'box': {
      // The box behind every run is there but clear; the spoken word's is not.
      return '\\t(' + s + ',' + (s + 1) + ',\\3c' + hl + '\\3a&H00&)\\t(' + e + ',' + (e + 1) + ',\\3c' + tagColour(st.backColor) + '\\3a' + _baseBoxAlpha(st) + ')';
    }
    case 'pop':
      // Mostly upward: a word that grows sideways pushes its neighbours.
      return '\\t(' + s + ',' + (s + 80) + ',\\fscx108\\fscy125\\1c' + hl + ')\\t(' + (s + 80) + ',' + (s + 170) + ',\\fscx100\\fscy100)'
        + '\\t(' + e + ',' + (e + 1) + ',\\1c' + prim + ')';
    case 'bounce':
      return '\\t(' + s + ',' + (s + 60) + ',\\fscy132\\1c' + hl + ')\\t(' + (s + 60) + ',' + (s + 140) + ',\\fscy100)'
        + '\\t(' + e + ',' + (e + 1) + ',\\1c' + prim + ')';
    default:
      return '';
  }
}

// The box behind a word that is not being spoken: the line's own box when the style has one, clear
// otherwise.
const _baseBoxAlpha = (st) => (st.borderStyle === 'box' ? tagAlpha(st.backAlpha) : '&HFF&');

function _body(c, st) {
  const words = Array.isArray(c.words) && c.words.length ? c.words : null;
  const arrive = _arrive(st);
  const blur = (+st.blur || 0) > 0 ? '\\blur' + (+st.blur).toFixed(1) : '';
  if (words && st.effect === 'karaoke') return (arrive ? '{' + arrive + '}' : '') + karaokeLine(words, '\\k', st.casing);
  if (words && st.effect === 'sweep') return (arrive ? '{' + arrive + '}' : '') + karaokeLine(words, '\\kf', st.casing);
  const timed = words && (['color', 'box', 'pop', 'bounce'].includes(st.effect) || words.some(w => w.k));
  if (!timed) return (arrive ? '{' + arrive + '}' : '') + assText(cased(c.name, st.casing));
  const box = st.effect === 'box' ? '\\3c' + tagColour(st.backColor) + '\\3a' + _baseBoxAlpha(st) : '';
  return words.map((w, i) => '{\\r' + blur + arrive + box + _wordTags(st, w) + '}'
    + assText(cased(w.w, st.casing)) + (i < words.length - 1 ? ' ' : '')).join('');
}

// The page's own tags: where it sits, how it arrives, its blur.
function _place(st, a) {
  const x = Math.round(a.x), y = Math.round(a.y);
  const pos = st.appear === 'slide'
    ? '\\move(' + x + ',' + (y + Math.round(40 * (a.h / 1920))) + ',' + x + ',' + y + ',0,180)'
    : '\\pos(' + x + ',' + y + ')';
  const fade = (st.appear === 'fade' || st.appear === 'slide') ? '\\fad(' + (st.appear === 'fade' ? 160 : 120) + ',0)' : '';
  const blur = (+st.blur || 0) > 0 ? '\\blur' + (+st.blur).toFixed(1) : '';
  return '{\\an' + a.an + pos + fade + blur + '}';
}

// One [V4+ Styles] entry.
function styleLine(name, st, a, w, h) {
  // Margins are what libass wraps a long line against, even with an explicit position.
  const margin = Math.round(w * 0.06);
  const face = assFace(st.font, st.bold);
  const boxAlpha = Math.round((1 - Math.max(0, Math.min(1, +st.backAlpha || 0))) * 255);
  const shadowAlpha = Math.round((1 - Math.max(0, Math.min(1, st.shadowAlpha == null ? 0.75 : +st.shadowAlpha))) * 255);
  // How the letters are bordered:
  //   1 an outline (OutlineColour), and the shadow in BackColour;
  //   3 a box in OutlineColour (that is how libass fills it), its shadow in BackColour - and the
  //     spoken-word box rides on the same, one run at a time;
  //   4 a box in BackColour AND an outline in OutlineColour.
  let bs = 1, outlineCol = hexToAss(st.outlineColor, 0), backCol = hexToAss(st.shadowColor, shadowAlpha), outline = +st.outline || 0;
  if (st.borderStyle === 'boxline') {
    bs = 4; backCol = hexToAss(st.backColor, boxAlpha);
  } else if (st.borderStyle === 'box' || st.effect === 'box') {
    bs = 3;
    outlineCol = hexToAss(st.backColor, st.borderStyle === 'box' ? boxAlpha : 255);
    // A box needs room around the letters, whatever the outline was.
    outline = Math.max(outline, st.effect === 'box' ? 10 : 0);
  }
  return [
    name, face.family, Math.round(st.size),
    hexToAss(st.primary, 0), hexToAss(st.secondary, 0), outlineCol, backCol,
    face.bold, st.italic ? -1 : 0, 0, 0,
    Math.round(+st.scaleX || 100), Math.round(+st.scaleY || 100), +st.spacing || 0, 0,
    bs, outline, (+st.shadow || 0),
    a.an, margin, margin, Math.round(h * 0.05), 1,
  ].join(',');
}

/**
 * Every lane that holds words, burnt into ONE file: a style per lane, and one more for every caption
 * that wears a style of its own. Lanes are given bottom lane first (style.js captionLanes); the Layer is
 * the lane's index, so a higher lane is drawn on top.
 */
export function buildAss(lanes, w, h) {
  const list = (Array.isArray(lanes) ? lanes : [lanes]).filter(Boolean);
  const used = [];
  for (const track of list) {
    const clips = ((track && track.clips) || []).filter(c => c && c.name && (+c.dur) > 0);
    if (!clips.length) continue;
    const st = withAuto(resolveStyle(track.style), w, h);
    used.push({ name: 'S' + used.length, st, a: { ...anchorOf(st, w, h), h }, clips, lane: track.style });
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
      const st = withAuto(resolveStyle(u.lane, c.style), w, h);
      const s = { name: u.name + 'o' + own.size, st, a: { ...anchorOf(st, w, h), h } };
      own.set(key, s);
      extra.push(s);
    }
    return own.get(key);
  };

  const lines = [];
  used.forEach((u, layer) => {
    for (const c of u.clips) {
      const s = styleOf(u, layer, c);
      const start = Math.max(0, +c.start || 0);
      const end = start + Math.max(0.05, +c.dur || 0);
      lines.push('Dialogue: ' + layer + ',' + assTime(start) + ',' + assTime(end) + ','
                 + s.name + ',,0,0,0,,' + _place(s.st, s.a) + _body(c, s.st));
    }
  });

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
  ].concat(used.concat(extra).map(u => 'Style: ' + styleLine(u.name, u.st, u.a, w, h))).concat([
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ]);

  return head.concat(lines).join('\n') + '\n';
}
