/* ═══════════════════════════════════════════════════════════════════════════
   MERGE v3 — captions for a BLANK project, on this side of the wire.

   The client half of lib/mv3b-subs.js. That file writes the .ass libass burns; this one
   draws the same words on the preview canvas, groups a transcript into lines, and turns an
   audio timeline into something the speech-to-text endpoint understands.

   THE STYLE DEFAULTS ARE COPIED, not imported: the other file is CommonJS on the server and
   this one is a module in a browser. Two copies of a dozen numbers, and the alternative was a
   build step. If a default moves, it moves in both - they are the same eleven lines.

   WHAT MUST AGREE is where a caption sits and how big it is. anchorOf() here is anchorOf()
   there, and the size is scaled by the same ratio, because a caption that sits differently on
   the screen and in the file is a caption nobody can place.
   ═══════════════════════════════════════════════════════════════════════════ */

export const DEF = {
  font: 'Arial', size: 60, bold: true, italic: false,
  primary: '#ffffff', secondary: '#8a9099',
  outlineColor: '#000000', shadowColor: '#000000',
  backColor: '#000000', backAlpha: 0,
  outline: 3, shadow: 0, blur: 0,
  borderStyle: 'outline', pos: 'bottom', tx: 0, ty: 0,
  wrap: true, wordsPerLine: 0, karaoke: false, sizeAuto: true,
};

// The frame the style is authored against - PlayResX/Y in the .ass, and the size the render
// actually comes out at.
const RENDER = { '9:16': { w: 1080, h: 1920 }, '16:9': { w: 1920, h: 1080 } };
export const renderFrame = (fmt) => RENDER[fmt] || RENDER['9:16'];

// ── What the format decides, until somebody decides otherwise ───────────────
// A 9:16 frame is a column: eight words across it come out as a paragraph in a shoe box, so
// the line breaks earlier and the letters are bigger relative to the frame. Sideways there is
// room to read a whole clause at once.
//
// These are DEFAULTS and not rules: the moment either is set by hand the manual value wins and
// changing the format stops moving it. `wordsPerLine: 0` and `sizeAuto` are what "still
// automatic" looks like in the stored style - a number nobody chose.
export function autoWordsPerLine(fmt) { return fmt === '16:9' ? 8 : 4; }
export function autoSize(fmt) {
  const f = renderFrame(fmt);
  return Math.round(f.h * (fmt === '16:9' ? 0.050 : 0.035));
}

/** The style as everything downstream should read it, with the automatic parts filled in. */
export function styleOf(track, fmt) {
  const st = Object.assign({}, DEF, (track && track.style) || {});
  if (st.sizeAuto !== false) st.size = autoSize(fmt);
  if (!(+st.wordsPerLine > 0)) st.wordsPerLine = autoWordsPerLine(fmt);
  return st;
}

/** Where a caption sits, in pixels of whatever frame it is given. Mirrors lib/mv3b-subs.js. */
export function anchorOf(style, w, h) {
  const base = style.pos === 'top' ? 0.10 : style.pos === 'center' ? 0.50 : 0.88;
  return {
    x: w / 2 + (+style.tx || 0) * w,
    y: h * base + (+style.ty || 0) * h,
    an: style.pos === 'top' ? 8 : style.pos === 'center' ? 5 : 2,
  };
}

export function subsTrack(tl) {
  return (((tl && tl.tracks) || []).find(t => t && t.kind === 'subs')) || null;
}

// The transcript's one lane and the text lanes above it. Two kinds because they are two
// things: one is what was said, cut up by a machine; the others are what somebody typed.
//
// RETURNED BOTTOM LANE FIRST, which is the reverse of the list. Everything downstream draws in
// the order it is given, so this is what makes higher-in-the-column mean on-top - the same rule
// the video lanes have always had, now that the text lanes sit above the subtitles.
export function captionLanes(tl) {
  return ((tl && tl.tracks) || [])
    .filter(t => t && (t.kind === 'subs' || t.kind === 'text'))
    .reverse();
}

// ── Drawing ─────────────────────────────────────────────────────────────────
// Outline first and text over it, with a round join: a stroke drawn after the fill eats half
// the letter, and a mitred join grows spikes off every sharp corner of a bold face.
function _line(ctx, text, x, y, st, scale) {
  if (st.shadow > 0) {
    ctx.save();
    ctx.fillStyle = st.shadowColor;
    ctx.globalAlpha = 0.75;
    ctx.fillText(text, x + st.shadow * scale, y + st.shadow * scale);
    ctx.restore();
  }
  if (st.outline > 0) {
    ctx.lineWidth = st.outline * 2 * scale;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = st.outlineColor;
    ctx.strokeText(text, x, y);
  }
  ctx.fillText(text, x, y);
}

// Karaoke: the line arrives in `secondary` and each word flips to `primary` as it is spoken -
// libass's convention, and the same one the .ass writes, so the two show the same thing.
// A WORD IS {w, s, e} AND ITS TIMES ARE RELATIVE to the caption's own start. That is the shape
// the project file has always stored, and relative is the right half of it: dragging a caption
// along the lane keeps the highlight in step, where absolute offsets would need rewriting on
// every move and one missed rewrite is a highlight running ahead of the voice.
function _karaokeLine(ctx, words, x, y, st, scale, into) {
  const gap = ctx.measureText(' ').width;
  let total = 0;
  for (const w of words) total += ctx.measureText(w.w).width;
  total += gap * Math.max(0, words.length - 1);
  let cx = x - total / 2;
  for (const w of words) {
    const wide = ctx.measureText(w.w).width;
    ctx.fillStyle = (into >= (+w.s || 0)) ? st.primary : st.secondary;
    _line(ctx, w.w, cx + wide / 2, y, st, scale);
    cx += wide + gap;
  }
}

function _wrap(ctx, text, maxWidth) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const w of words) {
    const next = line ? line + ' ' + w : w;
    if (line && ctx.measureText(next).width > maxWidth) { lines.push(line); line = w; }
    else line = next;
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

/**
 * Every caption showing at this moment, onto the preview canvas.
 * @param fmt the project's format - the style is authored against that frame, not this one
 */
export function paintCaptions(ctx, tl, at, W, H, fmt) {
  // In lane order, so a text lane listed after the subtitles draws over them - the same order
  // the .ass gives its layers.
  for (const tr of captionLanes(tl)) _paintLane(ctx, tr, at, W, H, fmt);
}

function _paintLane(ctx, tr, at, W, H, fmt) {
  if (!tr || !(tr.clips || []).length) return;
  const live = tr.clips.filter(c => c && c.name && at >= (+c.start || 0)
                                 && at < (+c.start || 0) + (+c.dur || 0));
  if (!live.length) return;

  const st = styleOf(tr, fmt);
  // The style speaks in frame pixels; the canvas is a smaller frame of the same shape.
  const scale = H / renderFrame(fmt).h;
  const px = Math.max(6, st.size * scale);
  const a = anchorOf(st, W, H);
  const margin = W * 0.06;

  ctx.save();
  ctx.font = (st.italic ? 'italic ' : '') + (st.bold ? '700 ' : '400 ') + px.toFixed(1) + 'px '
           + st.font + ', Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';

  for (const c of live) {
    const words = st.karaoke && Array.isArray(c.words) && c.words.length ? c.words : null;
    const lines = words ? [words.map(w => w.w).join(' ')]
                        : (st.wrap ? _wrap(ctx, c.name, W - margin * 2) : [String(c.name)]);
    const lh = px * 1.18;
    // The anchor is the BOTTOM of the block for a bottom caption and its middle for a centred
    // one, so a second line grows upward rather than off the frame.
    const blockTop = a.an === 8 ? a.y
                   : a.an === 5 ? a.y - (lines.length * lh) / 2
                   : a.y - lines.length * lh;

    if (st.borderStyle === 'box' && st.backAlpha > 0) {
      let wide = 0;
      for (const l of lines) wide = Math.max(wide, ctx.measureText(l).width);
      ctx.save();
      ctx.globalAlpha = Math.min(1, st.backAlpha);
      ctx.fillStyle = st.backColor;
      ctx.fillRect(a.x - wide / 2 - px * 0.25, blockTop, wide + px * 0.5, lines.length * lh);
      ctx.restore();
    }

    lines.forEach((text, i) => {
      const y = blockTop + (i + 1) * lh - px * 0.24;      // baseline inside the line box
      if (words && i === 0) { _karaokeLine(ctx, words, a.x, y, st, scale, at - (+c.start || 0)); return; }
      ctx.fillStyle = st.primary;
      _line(ctx, text, a.x, y, st, scale);
    });
  }
  ctx.restore();
}

// ── Turning a transcript into captions ──────────────────────────────────────
// Grouped by COUNT rather than by pause. A pause is where a sentence ends, which sounds like
// the better rule until it meets someone who speaks without them - the lines then run to
// fifteen words and off both sides of the frame. A count cannot do that.
export function groupWords(words, perLine) {
  const n = Math.max(1, Math.round(perLine || 4));
  const out = [];
  for (let i = 0; i < words.length; i += n) {
    const chunk = words.slice(i, i + n).filter(w => String(w.text || '').trim());
    if (!chunk.length) continue;
    const start = +chunk[0].start || 0;
    const end = Math.max(start + 0.2, +chunk[chunk.length - 1].end || start + 0.4);
    out.push({
      name: chunk.map(w => String(w.text).trim()).join(' '),
      start: Math.round(start * 100) / 100,
      dur: Math.round((end - start) * 100) / 100,
      // {w, s, e}, and the times measured from the caption rather than from the film - the
      // shape the project stores, and the only one that survives a save.
      words: chunk.map(w => ({
        w: String(w.text).trim(),
        s: Math.round(((+w.start || 0) - start) * 100) / 100,
        e: Math.round(((+w.end || 0) - start) * 100) / 100,
      })),
    });
  }
  return out;
}

// ── Cutting the same transcript a different way ─────────────────────────────
// The words are still here. Every generated caption carries the timings of the words in it, so
// changing how many go on a line is arithmetic on what the lane already holds - no listening,
// no waiting and nothing to pay for. Asking for the transcription again to move a slider would
// be charging somebody for a decision they are still making.

/** Every transcribed word on the lane, put back into timeline coordinates. */
export function wordsOf(track) {
  const out = [];
  for (const c of ((track && track.clips) || [])) {
    if (!Array.isArray(c.words) || !c.words.length) continue;
    const base = +c.start || 0;
    for (const w of c.words) {
      if (!w || !String(w.w || '').trim()) continue;
      out.push({ text: String(w.w), start: base + (+w.s || 0), end: base + (+w.e || 0) });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/**
 * The lane re-cut into lines of a new length, or null when there is no transcript to re-cut.
 *
 * LINES SOMEBODY TYPED ARE LEFT ALONE. They have no word timings - there is nothing to cut
 * them by - and re-flowing a sentence written by hand into somebody else's line length is
 * rewriting their work to fit a slider.
 */
export function regroup(track, perLine) {
  const words = wordsOf(track);
  if (!words.length) return null;
  const typed = ((track && track.clips) || [])
    .filter(c => c && c.name && !(Array.isArray(c.words) && c.words.length))
    .map(c => ({ name: c.name, start: +c.start || 0, dur: +c.dur || 1, words: null }));
  return groupWords(words, perLine).concat(typed).sort((a, b) => a.start - b.start);
}

// ── The sound, as the transcriber wants it ──────────────────────────────────
// One flat run of audio laid end to end, silence where the timeline is silent, so the words
// come back already in timeline coordinates and need no shifting.
//
// MUSIC IS NOT LISTENED TO. A bed runs under the whole video, and heard as sound it took the
// ground from every voice on top of it - the captions came out of the song. A bed says so on the
// clip (`bed`, music.js); a bed laid before that was said is known by what it is: a music-panel
// clip (id m...), no picture half, a track from the music shelf.
//
// OVERLAPS ARE NOT REPRESENTABLE in a flat run, and two people talking at once is not something a
// transcript can hold either. The main audio lane - where the voice is - keeps its ground; every
// other lane is only heard where the main one is silent. Among those, the earlier clip keeps the
// ground and a later one is taken from where the first leaves off.
const isBed = (c) => !!c && (c.bed === true
  || (/^m[0-9a-z]/.test(String(c.id || '')) && !c.pairId && /^\/media\/audio\//.test(String(c.src || ''))));

export function segmentsFor(tl) {
  const main = [], rest = [];
  for (const tr of ((tl && tl.tracks) || [])) {
    if (tr.kind !== 'audio') continue;
    const master = (tr.volume == null) ? 1 : +tr.volume;
    if (!(master > 0)) continue;
    for (const c of (tr.clips || [])) {
      const v = ((c.volume == null) ? 1 : +c.volume) * master;
      if (!(v > 0) || !c.src || isBed(c)) continue;
      (tr.main ? main : rest).push(c);
    }
  }
  // Pieces of sound in timeline order, each a stretch of one clip: [start, end, clip].
  const pieces = [];
  const lay = (clips, blocked) => {
    const took = [];
    let at = 0;
    for (const c of clips.slice().sort((a, b) => (+a.start) - (+b.start))) {
      let s = Math.max(+c.start || 0, at);
      const e = (+c.start || 0) + (+c.dur || 0);
      if (e <= s + 0.01) continue;                          // wholly under something earlier
      // Cut around what an earlier layer already holds.
      for (const [bs, be] of blocked) {
        if (be <= s || bs >= e) continue;
        if (bs > s + 0.01) took.push([s, bs, c]);
        s = Math.max(s, be);
      }
      if (e > s + 0.01) took.push([s, e, c]);
      at = e;
    }
    return took;
  };
  const held = lay(main, []);
  pieces.push(...held, ...lay(rest, held.map(([s, e]) => [s, e]).sort((a, b) => a[0] - b[0])));
  pieces.sort((a, b) => a[0] - b[0]);

  const segs = [];
  let at = 0;
  const r2 = (v) => Math.round(v * 100) / 100;
  for (const [s0, e, c] of pieces) {
    const s = Math.max(s0, at);
    if (e <= s + 0.01) continue;
    const sp = +c.speed > 0 ? +c.speed : 1;
    const crop = (+c.trimIn || 0) + (s - (+c.start || 0)) * sp;
    if (s > at + 0.01) segs.push({ src: '', dur: r2(s - at) });
    segs.push({ src: c.src, crop: r2(crop), speed: sp, dur: r2(e - s), voiceOnly: false });
    at = e;
  }
  return segs;
}

/** Is there anything to transcribe at all? */
export const hasSound = (tl) => segmentsFor(tl).some(s => s.src);
