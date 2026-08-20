'use strict';

/* ═══════════════════════════════════════════════════════════════════════════
   MERGE v3 — captions for a BLANK project, as an .ass file.

   Burnt by libass through ffmpeg's `ass` filter, which is what the other workflow uses too -
   and the reason both do is that libass is the only one of the options that can draw an
   outline, a shadow and a per-word colour flip without a filter per caption.

   Ported rather than imported, like everything else on this side. What is NOT carried over is
   the half of routes/ffmpeg.js's builder that serves presets this panel does not offer -
   rotations, appearance animations, three karaoke dialects. Those are settings, and a setting
   with no control is a thing that can only be wrong.

   THE ONE THING THIS MUST AGREE WITH is anchorOf() as the preview reads it. A caption's place
   is computed here and drawn there, and if the two disagree the export moves the words
   somewhere the screen never showed them.

   PURE. It returns a string; writing it and handing ffmpeg the path is the route's job.
   ═══════════════════════════════════════════════════════════════════════════ */

const DEF = {
  font: 'Arial', size: 60, bold: true, italic: false,
  primary: '#ffffff', secondary: '#8a9099',
  outlineColor: '#000000', shadowColor: '#000000',
  backColor: '#000000', backAlpha: 0,
  outline: 3, shadow: 0, blur: 0,
  borderStyle: 'outline', pos: 'bottom', tx: 0, ty: 0,
  wrap: true, wordsPerLine: 0, karaoke: false, sizeAuto: true,
};

// WHAT THE FORMAT DECIDES, until somebody decides otherwise - and the same two numbers
// public/js/merge-v3/subs-b.js uses, because the screen and the file have to agree about how
// big a caption is as much as about where it sits. `sizeAuto` false and a wordsPerLine above
// zero are what "somebody chose this" looks like in a stored style.
const autoSize = (h, w) => Math.round(h * (w > h ? 0.050 : 0.035));

function withAuto(style, w, h) {
  const st = Object.assign({}, DEF, style || {});
  if (st.sizeAuto !== false) st.size = autoSize(h, w);
  return st;
}

// &HAABBGGRR - alpha first and the channels backwards, which is the format and not a mistake.
function hexToAss(hex, alpha) {
  const h = String(hex || '#000000').replace('#', '').padEnd(6, '0');
  const a = Math.max(0, Math.min(255, Math.round(alpha == null ? 0 : alpha)));
  const two = (n) => n.toString(16).toUpperCase().padStart(2, '0');
  return '&H' + two(a) + h.slice(4, 6).toUpperCase() + h.slice(2, 4).toUpperCase() + h.slice(0, 2).toUpperCase();
}

// H:MM:SS.cc, centiseconds - the format's own resolution. Rounding up would let a caption
// outlive the shot it belongs to, so it rounds down.
function assTime(t) {
  const v = Math.max(0, +t || 0);
  const h = Math.floor(v / 3600);
  const m = Math.floor((v - h * 3600) / 60);
  const s = Math.floor(v - h * 3600 - m * 60);
  const cs = Math.floor((v - Math.floor(v)) * 100);
  return h + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0') + '.' + String(cs).padStart(2, '0');
}

/**
 * WHERE A CAPTION SITS, in frame pixels. The anchor is a third of a decision - top, middle or
 * bottom of the frame - and the offset moves it from there, as a fraction of the frame so it
 * means the same thing at 9:16 and 16:9 and on a preview canvas of another size entirely.
 *
 * `an` is libass's numpad alignment: which point of the text box lands on (x, y).
 */
function anchorOf(style, w, h) {
  const st = Object.assign({}, DEF, style || {});
  const base = st.pos === 'top' ? 0.10 : st.pos === 'center' ? 0.50 : 0.88;
  return {
    x: w / 2 + (+st.tx || 0) * w,
    y: h * base + (+st.ty || 0) * h,
    an: st.pos === 'top' ? 8 : st.pos === 'center' ? 5 : 2,
  };
}

// Braces open an override block in this format, so a caption containing one would turn the
// rest of the line into instructions. Swapped for parentheses rather than dropped: somebody
// wrote them, and a missing bracket reads as a typo the author will hunt for.
function assText(s) {
  return String(s || '')
    .replace(/\r/g, '')
    .replace(/\{/g, '(').replace(/\}/g, ')')
    .replace(/\n/g, '\\N');
}

// Per-word colour, the way libass does it: the line arrives in `secondary` and each word flips
// to `primary` as it is spoken. \k counts in centiseconds.
//
// A word is {w, s, e} with its times measured from the caption's own start - the shape the
// project file stores, and the one public/js/merge-v3/subs-b.js writes and reads.
function karaokeLine(words) {
  const out = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const dur = Math.max(0, (+w.e || 0) - (+w.s || 0));
    out.push('{\\k' + Math.max(1, Math.round(dur * 100)) + '}' + assText(w.w)
             + (i < words.length - 1 ? ' ' : ''));
  }
  return out.join('');
}

// One lane's [V4+ Styles] entry, named so its own Dialogue lines can point at it.
function styleLine(name, st, a, w, h) {
  // Margins still have to be given even with an explicit position: they are what libass wraps
  // a long line against, so a caption with none would run off both edges of the frame.
  const margin = Math.round(w * 0.06);
  return [
    name, st.font, Math.round(st.size),
    hexToAss(st.primary, 0), hexToAss(st.secondary, 0),
    hexToAss(st.outlineColor, 0), hexToAss(st.backColor, Math.round((1 - (+st.backAlpha || 0)) * 255)),
    st.bold ? -1 : 0, st.italic ? -1 : 0, 0, 0,
    100, 100, 0, 0,
    st.borderStyle === 'box' ? 3 : 1,
    (+st.outline || 0), (+st.shadow || 0),
    a.an, margin, margin, Math.round(h * 0.05), 1,
  ].join(',');
}

/**
 * Every lane that holds words, burnt into ONE file with a style each.
 *
 * One file rather than one per lane because that is what the format is for: a style block and
 * events that name their style. Chaining an `ass` filter per lane would decode the picture
 * again for every one of them, to draw text on it.
 */
function buildAss(lanes, w, h) {
  const list = (Array.isArray(lanes) ? lanes : [lanes]).filter(Boolean);
  const used = [];
  for (const track of list) {
    const clips = ((track && track.clips) || []).filter(c => c && c.name && (+c.dur) > 0);
    if (!clips.length) continue;
    const st = withAuto(track.style, w, h);
    used.push({ name: 'S' + used.length, st, a: anchorOf(st, w, h), clips });
  }
  if (!used.length) return '';
  const first = used[0].st;

  const head = [
    '[Script Info]',
    'ScriptType: v4.00+',
    'PlayResX: ' + Math.round(w),
    'PlayResY: ' + Math.round(h),
    'WrapStyle: ' + (first.wrap ? 0 : 2),
    // Sizes are written against PlayRes above, so they have to scale with it - without this a
    // caption authored at 1080 wide comes out hairline on a 1920 render.
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour,'
      + ' Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle,'
      + ' Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
  ].concat(used.map(u => 'Style: ' + styleLine(u.name, u.st, u.a, w, h))).concat([
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ]);

  const lines = [];
  used.forEach((u, layer) => {
    const blur = (+u.st.blur || 0) > 0 ? '\\blur' + (+u.st.blur).toFixed(1) : '';
    for (const c of u.clips) {
      const start = Math.max(0, +c.start || 0);
      const end = start + Math.max(0.05, +c.dur || 0);
      const words = u.st.karaoke && Array.isArray(c.words) && c.words.length ? c.words : null;
      const body = words ? karaokeLine(words) : assText(c.name);
      // The position is stated on every line rather than left to the style, because a caption
      // may be nudged on its own one day and a line that already carries its place will not
      // need the file rebuilt differently for it.
      const tags = '{\\an' + u.a.an + '\\pos(' + Math.round(u.a.x) + ',' + Math.round(u.a.y) + ')' + blur + '}';
      // Layer decides who is on top where two lanes write over the same moment - later lane,
      // higher layer, which is the order they are listed in.
      lines.push('Dialogue: ' + layer + ',' + assTime(start) + ',' + assTime(end) + ','
                 + u.name + ',,0,0,0,,' + tags + body);
    }
  });

  return head.concat(lines).join('\n') + '\n';
}

// Windows paths inside a filter argument: the separators have to turn round and the drive
// colon has to be escaped, or ffmpeg reads `C:` as the start of another option.
const escapeFilterPath = (p) => String(p).replace(/\\/g, '/').replace(/:/g, '\\:');

/** The lane captions live on, or null. One of it, always. */
function subsTrack(timeline) {
  const t = (timeline && timeline.tracks) || [];
  return t.find(x => x && x.kind === 'subs') || null;
}

/**
 * Every lane that holds words, BOTTOM LANE FIRST - the subtitles, then the text lanes above
 * them in reverse. The order is the layer order: later gets the higher Layer and wins an
 * overlap, so higher in the column means on top, the same rule the pictures follow. It must
 * match captionLanes() in public/js/merge-v3/subs-b.js, or the screen and the file disagree
 * about which line is in front.
 */
function captionLanes(timeline) {
  return ((timeline && timeline.tracks) || [])
    .filter(x => x && (x.kind === 'subs' || x.kind === 'text'))
    .reverse();
}

module.exports = { buildAss, anchorOf, escapeFilterPath, subsTrack, captionLanes, hexToAss, assTime,
                   withAuto, autoSize, DEF };
