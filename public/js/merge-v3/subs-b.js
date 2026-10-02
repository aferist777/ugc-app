/* ═══════════════════════════════════════════════════════════════════════════
   MERGE v3 — captions for a BLANK project, on this side of the wire.

   This file draws the words on the preview canvas, groups a transcript into lines, and turns an
   audio timeline into something the speech-to-text endpoint understands. HOW A CAPTION LOOKS - the
   fields, the defaults, where it sits - is public/js/captions/style.js, the one module the server's
   builder reads too (phase K0), so the screen and the file cannot disagree over a default.
   ═══════════════════════════════════════════════════════════════════════════ */

import { DEF, renderFrame, autoSize, autoWordsPerLine, anchorOf, captionLanes, resolveStyle }
  from '../captions/style.js';

export { DEF, renderFrame, autoSize, autoWordsPerLine, anchorOf, captionLanes };

/**
 * The style as everything downstream should read it, with the automatic parts filled in - the lane's,
 * or, given a caption, that caption's own on top of it (phase K0).
 */
export function styleOf(track, fmt, clip) {
  const st = resolveStyle(track && track.style, clip && clip.style);
  if (st.sizeAuto !== false) st.size = autoSize(fmt);
  if (!(+st.wordsPerLine > 0)) st.wordsPerLine = autoWordsPerLine(fmt);
  return st;
}

export function subsTrack(tl) {
  return (((tl && tl.tracks) || []).find(t => t && t.kind === 'subs')) || null;
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

// LINES WHERE LIBASS BREAKS THEM. The render wraps a caption in libass (WrapStyle 0), and a preview
// that broke it anywhere else would show the words in places the file does not. libass fills each
// line as far as the frame less the style's margins allows, then evens the lines out: the last word
// of a line moves down to the next while that brings the two closer in width, until nothing moves.
// Returns [from, to) ranges into `words`.
function _lines(ctx, words, maxWidth) {
  if (!words.length) return [[0, 0]];
  const space = ctx.measureText(' ').width;
  const wide = words.map(w => ctx.measureText(w).width);
  const span = (a, b) => { let s = 0; for (let i = a; i < b; i++) s += wide[i]; return s + space * Math.max(0, b - a - 1); };
  const starts = [0];
  for (let i = 1; i < words.length; i++) {
    if (span(starts[starts.length - 1], i + 1) > maxWidth) starts.push(i);
  }
  for (let moved = true, guard = 0; moved && guard < 200; guard++) {
    moved = false;
    for (let k = 1; k < starts.length; k++) {
      const a = starts[k - 1], b = starts[k], c = k + 1 < starts.length ? starts[k + 1] : words.length;
      if (b - a < 2) continue;
      if (Math.abs(span(a, b - 1) - span(b - 1, c)) < Math.abs(span(a, b) - span(b, c))) { starts[k] = b - 1; moved = true; }
    }
  }
  return starts.map((s, k) => [s, k + 1 < starts.length ? starts[k + 1] : words.length]);
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

// HOW BIG LIBASS DRAWS A SIZE. An .ass Fontsize is the height of the font's line - its ascent and
// descent together - and not the em a CSS pixel size names, so the same number draws a smaller
// letter in the file (Arial: 60 is an em of about 54). Measured once per face off the canvas's own
// metrics for it, which are the same tables libass reads.
const _faces = new Map();
function _faceOf(ctx, st) {
  const css = (st.italic ? 'italic ' : '') + (st.bold ? '700 ' : '400 ') + '100px ' + st.font + ', Arial, sans-serif';
  if (_faces.has(css)) return _faces.get(css);
  ctx.save();
  ctx.font = css;
  const m = ctx.measureText('Hg');
  ctx.restore();
  const up = +m.fontBoundingBoxAscent || 0, down = +m.fontBoundingBoxDescent || 0;
  const face = (up + down > 0) ? { line: (up + down) / 100, ascent: up / (up + down) } : { line: 1.15, ascent: 0.8 };
  _faces.set(css, face);
  return face;
}

function _paintLane(ctx, tr, at, W, H, fmt) {
  if (!tr || !(tr.clips || []).length) return;
  const live = tr.clips.filter(c => c && c.name && at >= (+c.start || 0)
                                 && at < (+c.start || 0) + (+c.dur || 0));
  if (!live.length) return;

  // The style speaks in frame pixels; the canvas is a smaller frame of the same shape.
  const scale = H / renderFrame(fmt).h;
  // The style's margins in the .ass (public/js/captions/ass.js styleLine), what libass wraps against.
  const margin = W * 0.06;

  for (const c of live) {
    // The lane's style, or this caption's own on top of it (phase K0).
    const st = styleOf(tr, fmt, c);
    const face = _faceOf(ctx, st);
    // A line is the size the style names; the letters inside it are smaller (see _faceOf).
    const lh = Math.max(6, st.size * scale);
    const px = lh / face.line;
    const a = anchorOf(st, W, H);
    ctx.save();
    ctx.font = (st.italic ? 'italic ' : '') + (st.bold ? '700 ' : '400 ') + px.toFixed(1) + 'px '
             + st.font + ', Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    const words = st.effect === 'karaoke' && Array.isArray(c.words) && c.words.length ? c.words : null;
    // Karaoke captions wrap like any other - they ran off both edges on screen while the file wrapped
    // them. A line break typed into a caption is a break in both.
    const lines = [];
    if (words) {
      const tokens = words.map(w => String(w.w));
      for (const [from, to] of (st.wrap ? _lines(ctx, tokens, W - margin * 2) : [[0, tokens.length]])) {
        lines.push({ text: tokens.slice(from, to).join(' '), words: words.slice(from, to) });
      }
    } else {
      for (const para of String(c.name).split('\n')) {
        const tokens = para.split(/\s+/).filter(Boolean);
        for (const [from, to] of (st.wrap ? _lines(ctx, tokens, W - margin * 2) : [[0, tokens.length]])) {
          lines.push({ text: tokens.slice(from, to).join(' '), words: null });
        }
      }
    }
    // The anchor is the BOTTOM of the block for a bottom caption and its middle for a centred
    // one, so a second line grows upward rather than off the frame.
    const blockTop = a.an === 8 ? a.y
                   : a.an === 5 ? a.y - (lines.length * lh) / 2
                   : a.y - lines.length * lh;

    // A box behind each LINE, as libass draws it: the line's own width, padded by the outline size.
    if (st.borderStyle === 'box' && st.backAlpha > 0) {
      const pad = Math.max(1, (+st.outline || 0) * scale);
      ctx.save();
      ctx.globalAlpha = Math.min(1, st.backAlpha);
      ctx.fillStyle = st.backColor;
      lines.forEach((ln, i) => {
        const wide = ctx.measureText(ln.text).width;
        ctx.fillRect(a.x - wide / 2 - pad, blockTop + i * lh - pad, wide + pad * 2, lh + pad * 2);
      });
      ctx.restore();
    }

    lines.forEach((ln, i) => {
      const y = blockTop + i * lh + lh * face.ascent;     // the baseline, where libass puts it in the line
      if (ln.words) { _karaokeLine(ctx, ln.words, a.x, y, st, scale, at - (+c.start || 0)); return; }
      ctx.fillStyle = st.primary;
      _line(ctx, ln.text, a.x, y, st, scale);
    });
    ctx.restore();
  }
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
