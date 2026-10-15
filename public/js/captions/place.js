/* ═══════════════════════════════════════════════════════════════════════════
   CAPTIONS — where a page is on the frame, ONE answer for everything that asks (phase V30, block 3, K7).

   A page is drawn by libass (ass.js, the render and the preview's JASSUB), but the editor has to know
   where it is without asking libass: to pick a caption with a press on the preview, to outline what is
   picked, to drag it, and to tell whether it lies under a platform's buttons. So its rectangle is worked
   out here by the SAME rules that break it into lines (pages.js breakLines / fitPage / fitText, the letters'
   own advances in measure.js - within ~2% of libass, which does no kerning): the widest line, the lines one
   above the other at the style's size less what the font's letters leave empty at the top and the bottom
   (fonts.js `ink`), the outline or the box's padding and the shadow round them, placed
   from the anchor (style.js anchorOf) by libass's alignment - a bottom page grows up from its anchor, a top
   one down, a middle one both ways.

   A PAGE NEVER LEAVES THE FRAME (the owner's (с34)): a rectangle that runs past an edge is moved back
   inside by just that much - ass.js writes the moved place into the page's \pos, the preview's painter
   (subs-b.js) draws it there, so the screen, the render and the screenshot agree. A page that fits is
   written exactly as before.

   PURE, and shared: the page imports it, the server require()s it (lib/mv3b-subs.js, through ass.js).
   ═══════════════════════════════════════════════════════════════════════════ */

import { resolveStyle, withAuto, anchorOf, captionLanes, POSITIONS } from './style.js';
import { meter, edgeOf } from './measure.js';
import { fontOf } from './fonts.js';
import { fitPage, fitText, tokensOf } from './pages.js';
import { spells, typedWords } from './words.js';

// What follows word i of n: a space, a line break, or nothing after the last.
export const gapAfter = (i, n, brk) => (i < n - 1 ? (brk && brk.has(i) ? '\\N' : ' ') : '');
// The page's text, the lines broken where the page breaks (a set of word indices a line ends at).
const _joined = (tokens, brk) => tokens.map((t, i) => t + gapAfter(i, tokens.length, brk)).join('');
// Line counts as the set of word indices a line ends at (the last line's end is no break).
const _breaks = (counts) => {
  const brk = new Set();
  let at = -1;
  for (const k of (counts || []).slice(0, -1)) { at += k; brk.add(at); }
  return brk.size ? brk : null;
};
// Tokens in lines of `counts`, each line its words joined by a space.
const _lines = (tokens, counts) => {
  const out = [];
  let i = 0;
  for (const k of counts) { out.push(tokens.slice(i, i + k).join(' ')); i += k; }
  return out;
};

/**
 * HOW A CAPTION IS DRAWN AS A PAGE in style `st` (resolved, its size filled in - style.js withAuto) on a frame
 * `w` wide, lasting `dur` seconds: the words it is timed by (its own while they spell its text; a typed line of
 * the subtitle lane with a spoken word - `subs` - timed by its letters, phase V30 block 1), where its lines
 * break (`brk`, word indices), the text as written into the .ass, the lines as drawn (for measuring), and the
 * smaller size it is drawn at when a word is wider than a line (`shrink`, else null). ass.js draws by it.
 */
export function drawnPage(c, st, subs, w, dur) {
  let words = spells(c.words, c.name) ? c.words : null;
  const typed = (!words && subs && st.effect !== 'none' && !(Array.isArray(c.words) && c.words.length))
    ? typedWords(c.name, dur) : null;
  const own = Math.round(+st.size || 0);
  const out = { words, brk: null, text: String(c.name), lines: String(c.name).split('\n'), shrink: null };
  if (typed) {
    // Each paragraph broken by the rule, and a break between the paragraphs, as typed.
    const paras = [];
    let k = 0;
    for (const n of typed.paras) { paras.push(typed.words.slice(k, k + n).map(x => String(x.w))); k += n; }
    const fit = fitText(paras, st, w);
    if (fit.size < own) out.shrink = fit.size;
    const counts = [].concat(...fit.lines);
    const tokens = typed.words.map(x => String(x.w));
    out.brk = _breaks(counts);
    out.text = _joined(tokens, out.brk);
    out.lines = _lines(tokens, counts);
    out.words = typed.words;
  } else if (words) {
    const tokens = words.map(x => String(x.w));
    const fit = fitPage(tokens, st, w);
    if (fit.size < own) out.shrink = fit.size;
    out.brk = _breaks(fit.lines);
    out.text = _joined(tokens, out.brk);
    out.lines = _lines(tokens, fit.lines.length ? fit.lines : [tokens.length]);
  } else {
    // Typed: each paragraph at breakable blanks only; drawn exactly as typed when no paragraph needs a break.
    const paras = String(c.name).split('\n').map(tokensOf);
    if (paras.some(p => p.length)) {
      const fit = fitText(paras, st, w);
      if (fit.size < own) out.shrink = fit.size;
      if (fit.lines.some(l => l.length > 1)) {
        out.text = paras.map((p, i) => _joined(p, _breaks(fit.lines[i]))).join('\n');
        out.lines = [].concat(...paras.map((p, i) => (p.length ? _lines(p, fit.lines[i]) : [''])));
      }
    }
  }
  return out;
}

// How far a page's text block sits above its anchor, for libass's alignment: a bottom page (2) ends at its
// anchor, a middle one (5) is centred on it, a top one (8) starts at it.
const _lift = (an, th) => (an === 2 ? th : an === 5 ? th / 2 : 0);
const BASE = { top: 0.10, center: 0.50, bottom: 0.88 };
const AN = { top: 8, center: 5, bottom: 2 };

/**
 * THE PAGE'S RECTANGLE on a W x H frame of the render (pixels), drawn as `drawn` (drawnPage) in `st`.
 * @returns {x, y, w, h} the whole drawing, edges and shadow on; `lines` - each line's own rectangle; `dx`, `dy` -
 *   how far it was moved to stay inside the frame (0 when it fits); `ax`, `ay`, `an` - the anchor it is drawn
 *   from (moved by dx, dy); `th`, `edge`, `shadow` - the text block's height and what stands round it.
 */
export function boxOf(drawn, st, W, H) {
  const s = drawn.shrink ? Object.assign({}, st, { size: drawn.shrink }) : st;
  const m = meter(s);
  const edge = edgeOf(s);
  const sh = Math.max(0, +s.shadow || 0);
  const around = 2 * edge + sh;
  const lh = (+s.size || 60) * ((+s.scaleY || 100) / 100);
  const n = Math.max(1, drawn.lines.length);
  const widths = drawn.lines.map((l) => (String(l).length ? m.text(l) - around : 0));
  const iw = Math.max(0, ...widths);
  const th = n * lh;
  // The lines are laid at the font's whole line; the letters fill less of it (fonts.js `ink`).
  const ink = fontOf(s.font).ink || [0, 0];
  const up = ink[0] * lh, down = ink[1] * lh;
  const a = anchorOf(s, W, H);
  const top = a.y - _lift(a.an, th);
  let x = a.x - iw / 2 - edge, y = top + up - edge;
  const w = iw + around, h = th - up - down + around;
  // Back inside the frame (с34). Wider than the frame (never, with lines of 0.78): centred.
  const fit = (p, size, room) => (size >= room ? (room - size) / 2 - p : p < 0 ? -p : p + size > room ? room - size - p : 0);
  const dx = fit(x, w, W), dy = fit(y, h, H);
  x += dx; y += dy;
  const lines = [];
  widths.forEach((lw, i) => {
    if (!lw) return;
    lines.push({ x: a.x + dx - lw / 2 - edge, y: top + dy + i * lh + up - edge, w: lw + around, h: lh - up - down + around });
  });
  return { x, y, w, h, dx, dy, ax: a.x + dx, ay: a.y + dy, an: a.an, th, up, edge, shadow: sh, lines };
}

/**
 * A caption's page on the frame: its style resolved from its lane's (`laneStyle`) with its own on top, drawn as
 * ass.js draws it. `subs` - it is on the subtitle lane. See boxOf for what comes back; `st` - the style.
 */
export function pageBox(c, laneStyle, subs, W, H) {
  const own = c && c.style && typeof c.style === 'object' && Object.keys(c.style).length ? c.style : null;
  const st = withAuto(resolveStyle(laneStyle, own), W, H);
  const start = Math.max(0, +c.start || 0);
  const dur = Math.max(0.05, +c.dur || 0);
  const b = boxOf(drawnPage(c, st, subs, W, (start + dur) - start), st, W, H);
  b.st = st;
  return b;
}

/**
 * Every page on screen at `t` (seconds), in the order they are drawn - the subtitles first, the text lanes over
 * them: [{ track, clip, lane, box }]. What is on top is LAST.
 */
export function pagesAt(tl, t, W, H) {
  const out = [];
  captionLanes(tl).forEach((tr, lane) => {
    for (const c of (tr.clips || [])) {
      if (!c || !c.name || !((+c.dur) > 0)) continue;
      const s = Math.max(0, +c.start || 0), e = s + Math.max(0.05, +c.dur || 0);
      if (t < s || t >= e) continue;
      out.push({ track: tr, clip: c, lane, box: pageBox(c, tr.style, tr.kind === 'subs', W, H) });
    }
  });
  return out;
}

/** A point in a rectangle (a little slack round it, `pad` pixels). */
export const inBox = (p, b, pad) => !!b && p.x >= b.x - (pad || 0) && p.x <= b.x + b.w + (pad || 0)
  && p.y >= b.y - (pad || 0) && p.y <= b.y + b.h + (pad || 0);

/** Does a caption's own style set where it sits? Then its lane's place does not move it (с31). */
export const ownPlace = (c) => !!(c && c.style && typeof c.style === 'object'
  && (c.style.pos != null || c.style.tx != null || c.style.ty != null));

const _clampOff = (v) => Math.max(-1, Math.min(1, Math.round(v * 10000) / 10000));

/**
 * WHERE A PAGE DRAGGED by (dx, dy) frame pixels lands (the owner's (с8), (с33)), from its place `from` ({pos, tx,
 * ty} of the style that places it) and its rectangle before the drag (`box`, boxOf). The rectangle stays inside
 * the frame. It SNAPS - unless `o.free` (Alt) - to the vertical middle (tx 0) and to the three anchors: near one,
 * Where becomes that anchor and the offset nothing. Elsewhere the offset from the anchor in Where changes (how
 * the lines grow does not). `o.vertical` (Shift): up and down only. `o.near`: how close snaps, in frame pixels.
 * @returns { pos, tx, ty, snapX, snapY (the anchor snapped to, or ''), mx, my (how far the page moved, in pixels -
 *   what moves the other captions picked with it) }
 */
export function dragPlace(from, box, dx, dy, W, H, o) {
  const opt = o || {};
  const near = opt.near != null ? +opt.near : 0.015 * H;
  const pos0 = POSITIONS.includes(from && from.pos) ? from.pos : 'bottom';
  const tx0 = +(from && from.tx) || 0, ty0 = +(from && from.ty) || 0;
  let mx = opt.vertical ? 0 : +dx || 0;
  let my = +dy || 0;
  // Inside the frame: the rectangle as it is drawn now (already moved back inside, box.dx/dy) may go no further.
  mx = Math.max(-box.x, Math.min(W - box.x - box.w, mx));
  my = Math.max(-box.y, Math.min(H - box.y - box.h, my));
  // Across: the offset of where it is DRAWN (an out-of-frame place is read as where it shows).
  let tx = opt.vertical ? tx0 : tx0 + (box.dx + mx) / W;
  let snapX = false;
  if (!opt.free && !opt.vertical && Math.abs(tx * W) < near) { snapX = true; mx += -tx * W; tx = 0; }
  // Down: the anchors first.
  const top = box.y + my;
  let pos = pos0, ty = ty0 + (box.dy + my) / H, snapY = '';
  if (!opt.free) {
    let best = near, at = 0;
    for (const k of POSITIONS) {
      const y = BASE[k] * H - _lift(AN[k], box.th) + box.up - box.edge;
      if (Math.abs(top - y) <= best) { best = Math.abs(top - y); snapY = k; at = y; }
    }
    if (snapY) { pos = snapY; ty = 0; my += at - top; }
  }
  return { pos, tx: _clampOff(tx), ty: _clampOff(ty), snapX, snapY, mx, my };
}

/** The y of an anchor's snapping line on a H-high frame - where a page placed there starts or ends. */
export const anchorY = (k, H) => BASE[k] * H;
