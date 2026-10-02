/* ═══════════════════════════════════════════════════════════════════════════
   CAPTIONS — the .ass file, ONE builder for the render and the preview (phase K0, 2026-10-03).

   Burnt by libass through ffmpeg's `ass` filter (lib/mv3b-render.js), and - from phase K4 - drawn by
   the same libass in the page, so the screen and the file are one drawing. Moved here from
   lib/mv3b-subs.js, which now only hands it to the server.

   K0 keeps the output of every existing project exactly as it was (a stand compares it with the old
   builder on every caption lane of the owner's library) and adds a caption's own style: each different
   resulting style is a style of its own in the file. The effects, the casing and the fixed shadow arrive
   in K3.

   PURE: it returns a string.
   ═══════════════════════════════════════════════════════════════════════════ */

import { resolveStyle, withAuto, anchorOf } from './style.js';

// &HAABBGGRR - alpha first and the channels backwards, which is the format and not a mistake.
export function hexToAss(hex, alpha) {
  const h = String(hex || '#000000').replace('#', '').padEnd(6, '0');
  const a = Math.max(0, Math.min(255, Math.round(alpha == null ? 0 : alpha)));
  const two = (n) => n.toString(16).toUpperCase().padStart(2, '0');
  return '&H' + two(a) + h.slice(4, 6).toUpperCase() + h.slice(2, 4).toUpperCase() + h.slice(0, 2).toUpperCase();
}

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

// Per-word colour, the libass way: the line arrives in `secondary` and each word flips to `primary` as
// it is spoken; \k counts in centiseconds. A word is {w, s, e} from the caption's own start. A PAUSE IS
// A SYLLABLE OF ITS OWN: \k carries a length, not a moment, so the moments are rounded once and the
// lengths taken between them - no word lights early by the length of a pause, and nothing drifts.
export function karaokeLine(words) {
  const out = [];
  let cursor = 0;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const s = Math.max(cursor, Math.round((+w.s || 0) * 100));
    const e = Math.max(s, Math.round((+w.e || 0) * 100));
    if (s > cursor) out.push('{\\k' + (s - cursor) + '}');
    out.push('{\\k' + (e - s) + '}' + assText(w.w) + (i < words.length - 1 ? ' ' : ''));
    cursor = e;
  }
  return out.join('');
}

// One [V4+ Styles] entry.
function styleLine(name, st, a, w, h) {
  // Margins are what libass wraps a long line against, even with an explicit position.
  const margin = Math.round(w * 0.06);
  // A BOX IS DRAWN IN THE OUTLINE'S COLOUR: libass fills BorderStyle 3 with OutlineColour.
  const box = st.borderStyle === 'box';
  const boxAlpha = Math.round((1 - Math.max(0, Math.min(1, +st.backAlpha || 0))) * 255);
  return [
    name, st.font, Math.round(st.size),
    hexToAss(st.primary, 0), hexToAss(st.secondary, 0),
    box ? hexToAss(st.backColor, boxAlpha) : hexToAss(st.outlineColor, 0), hexToAss(st.backColor, boxAlpha),
    st.bold ? -1 : 0, st.italic ? -1 : 0, 0, 0,
    100, 100, 0, 0,
    st.borderStyle === 'box' ? 3 : 1,
    (+st.outline || 0), (+st.shadow || 0),
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
    used.push({ name: 'S' + used.length, st, a: anchorOf(st, w, h), clips, lane: track.style });
  }
  if (!used.length) return '';
  const first = used[0].st;

  // A caption's own style: one entry per DIFFERENT result, named after its lane.
  const extra = [];
  const own = new Map();                 // lane index + override -> {name, st, a}
  const styleOf = (u, i, c) => {
    if (!c.style || typeof c.style !== 'object' || !Object.keys(c.style).length) return u;
    const key = i + '|' + JSON.stringify(c.style);
    if (!own.has(key)) {
      const st = withAuto(resolveStyle(u.lane, c.style), w, h);
      const s = { name: u.name + 'o' + own.size, st, a: anchorOf(st, w, h) };
      own.set(key, s);
      extra.push(s);
    }
    return own.get(key);
  };

  const lines = [];
  used.forEach((u, layer) => {
    for (const c of u.clips) {
      const s = styleOf(u, layer, c);
      const blur = (+s.st.blur || 0) > 0 ? '\\blur' + (+s.st.blur).toFixed(1) : '';
      const start = Math.max(0, +c.start || 0);
      const end = start + Math.max(0.05, +c.dur || 0);
      const words = s.st.effect === 'karaoke' && Array.isArray(c.words) && c.words.length ? c.words : null;
      const body = words ? karaokeLine(words) : assText(c.name);
      // The position is stated on every line, so a caption moved on its own needs nothing else.
      const tags = '{\\an' + s.a.an + '\\pos(' + Math.round(s.a.x) + ',' + Math.round(s.a.y) + ')' + blur + '}';
      lines.push('Dialogue: ' + layer + ',' + assTime(start) + ',' + assTime(end) + ','
                 + s.name + ',,0,0,0,,' + tags + body);
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
