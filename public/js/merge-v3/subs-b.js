/* ═══════════════════════════════════════════════════════════════════════════
   MERGE v3 — captions drawn by the page itself, on this side of the wire.

   This file draws the words on the preview canvas until libass in the page is up, or when it did not
   start (captions/layer.js).
   HOW A CAPTION LOOKS - the fields, the defaults, where it sits - is public/js/captions/style.js, the
   one module the server's builder reads too (phase K0), so the screen and the file cannot disagree
   over a default.
   ═══════════════════════════════════════════════════════════════════════════ */

import { DEF, renderFrame, autoSize, autoWordsPerLine, anchorOf, captionLanes, resolveStyle }
  from '../captions/style.js';
import { cssWeight, fontOf } from '../captions/fonts.js';
import { fitText, tokensOf } from '../captions/pages.js';
import { spells, typedWords } from '../captions/words.js';
import { pageBox, rowsPlan, pageKey } from '../captions/place.js';

// The canvas font for a style: the shipped family, quoted ("Exo 2 Black" starts a token with a digit),
// at the weight its @font-face is declared at (css/caption-fonts.css, K5).
const _css = (st, px) => (st.italic ? 'italic ' : '') + cssWeight(st.font, st.bold) + ' ' + px + 'px "'
  + st.font + '", "Liberation Sans", sans-serif';

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
// The line is the font table's (fonts.js - libass's own measure of the file); the canvas only says
// where the baseline sits in it, and that only once the web font has arrived - measured before, the
// fallback's numbers would stay for the session.
const _faces = new Map();
function _faceOf(ctx, st) {
  const css = _css(st, 100);
  if (_faces.has(css)) return _faces.get(css);
  const loaded = !document.fonts || document.fonts.check(css);
  if (!loaded && document.fonts) document.fonts.load(css).catch(() => {});
  ctx.save();
  ctx.font = css;
  const m = ctx.measureText('Hg');
  ctx.restore();
  const up = +m.fontBoundingBoxAscent || 0, down = +m.fontBoundingBoxDescent || 0;
  const face = { line: fontOf(st.font).line, ascent: (up + down > 0) ? up / (up + down) : 0.8 };
  if (loaded) _faces.set(css, face);
  return face;
}

function _paintLane(ctx, tr, at, W, H, fmt) {
  if (!tr || !(tr.clips || []).length) return;
  // The style speaks in frame pixels; the canvas is a smaller frame of the same shape.
  const frame = renderFrame(fmt);
  const scale = H / frame.h;
  // (phase V71) A lane in two rows: a page from its In to the end of its Out, standing still in its row (captions/place.js rowsPlan).
  const plan = tr.kind === 'subs' ? rowsPlan(tr, frame.w, frame.h) : null;
  let n = -1;
  const live = plan
    ? tr.clips.filter(c => { if (!c || !c.name || !((+c.dur) > 0)) return false; n++; const r = plan.get(pageKey(c, n)); return !!r && at >= r.from && at < r.to; })
    : tr.clips.filter(c => c && c.name && at >= (+c.start || 0) && at < (+c.start || 0) + (+c.dur || 0));
  if (!live.length) return;

  for (const c of live) {
    // The lane's style, or this caption's own on top of it (phase K0).
    let st = styleOf(tr, fmt, c);
    // LINES WHERE THE FILE BREAKS THEM (K2): the .ass is broken by pages.js, not by libass, so the same
    // rule says where here - and a page holding a word wider than a line is drawn smaller, as there. A
    // line break typed into a caption is a break in both.
    // Typed text is broken in each paragraph it was typed in, at breakable blanks only (review K2).
    // The words only while they spell the text, as the file has them (ass.js) - and a typed line of the subtitle lane
    // timed by its letters, as the file times it (phase V30, block 1, words.js typedWords), paragraphs as typed.
    const heard = Array.isArray(c.words) && c.words.length;
    const typed = st.effect === 'karaoke' && !heard && tr.kind === 'subs' ? typedWords(c.name, +c.dur || 0) : null;
    const words = typed ? typed.words : (st.effect === 'karaoke' && spells(c.words, c.name) ? c.words : null);
    let paras = words ? [words.map(w => String(w.w))] : String(c.name).split('\n').map(tokensOf);
    if (typed) {
      paras = [];
      let k = 0;
      for (const n of typed.paras) { paras.push(typed.words.slice(k, k + n).map(w => String(w.w))); k += n; }
    }
    let counts = [];
    if (paras.some(p => p.length)) {
      const fit = fitText(paras, st, frame.w);
      if (fit.size < st.size) st = Object.assign({}, st, { size: fit.size });
      counts = fit.lines;
    }
    const face = _faceOf(ctx, st);
    // A line is the size the style names; the letters inside it are smaller (see _faceOf).
    const lh = Math.max(6, st.size * scale);
    const px = lh / face.line;
    const a = anchorOf(st, W, H);
    // Never off the frame (phase V30, block 3, (с34)): moved back inside by what the .ass moves it by.
    const pb = pageBox(c, tr.style, tr.kind === 'subs', frame.w, frame.h, plan ? tr : null);
    a.x += pb.dx * scale; a.y += (pb.dy + (pb.lift || 0)) * scale;
    ctx.save();
    ctx.font = _css(st, px.toFixed(1));
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    const lines = [];
    let base = 0;                                      // the first word of the paragraph, in `words`
    paras.forEach((p, n) => {
      if (!p.length) { lines.push({ text: '', words: null }); return; }
      let i = 0;
      for (const k of (counts[n] || [p.length])) {
        lines.push({ text: p.slice(i, i + k).join(' '), words: words ? words.slice(base + i, base + i + k) : null });
        i += k;
      }
      base += p.length;
    });
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

