/* ═══════════════════════════════════════════════════════════════════════════
   CAPTIONS — where a page is on the frame, ONE answer for everything that asks.

   A page is drawn by libass (ass.js, the render and the preview's JASSUB), but the editor has to know
   where it is without asking libass: to pick a caption with a press on the preview, to outline what is
   picked, to drag it, and to tell whether it lies under a platform's buttons. So its rectangle is worked
   out here by the SAME rules that break it into lines (pages.js breakLines / fitPage / fitText, the letters'
   own advances in measure.js - within ~2% of libass, which does no kerning): the widest line, the lines one
   above the other at the style's size less what the font's letters leave empty at the top and the bottom
   (fonts.js `ink`), the outline or the box's padding and the shadow round them, placed
   from the anchor (style.js anchorOf) by libass's alignment - a bottom page grows up from its anchor, a top
   one down, a middle one both ways.

   A PAGE NEVER LEAVES THE FRAME: a rectangle that runs past an edge is moved back
   inside by just that much - ass.js writes the moved place into the page's \pos, the preview's painter
   (subs-b.js) draws it there, so the screen and the render agree. A page that fits is
   written where it is.

   TWO ROWS (style.js `rows`): rowsPlan says, for every page of such a
   lane, WHEN it is on screen and in WHICH ROW - the one answer ass.js draws by and the preview picks, outlines and marks by (pagesAt,
   pageBox). A page is whole while its words are spoken: its In before its first word, its Out after its end; it stays at least
   0.8 s, but is gone before the next page of its row comes in, and for that time its Out and that In play shorter - never under half
   their length while it can stay longer. Every other page is in the second row - over the lane's place by a usual page's height and
   0.15 of a line (higher beside a taller page; UNDER it for a lane at the top of the frame); after a pause long enough for
   one page to go and the next to come, the first row again. A page with a place of its own has its rows from its place. The pages
   themselves - their times on the timeline - are not touched: it is how they are drawn.

   PURE, and shared: the page imports it, the server require()s it (lib/mv3b-subs.js, through ass.js).
   ═══════════════════════════════════════════════════════════════════════════ */

import { resolveStyle, withAuto, anchorOf, captionLanes, POSITIONS, rowsOn } from './style.js';
import { meter, edgeOf, LINE_MAX } from './measure.js';
import { fontOf, withTwin, drawnFamily } from './fonts.js';
import { fitPage, fitText, tokensOf } from './pages.js';
import { spells, typedWords } from './words.js';
import { motionLens } from './page-fx.js';

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
 * the subtitle lane with a spoken word - `subs` - timed by its letters), where its lines
 * break (`brk`, word indices), the text as written into the .ass, the lines as drawn (for measuring), and the
 * smaller size it is drawn at when a word is wider than a line (`shrink`, else null). ass.js draws by it.
 * In a font dealt over its preset's (`st.fitTo`) the page is cut in the preset's font and `shrink` is the size that
 * gives it the width it has there (_fitted) - larger as well as smaller.
 */
export function drawnPage(c, st, subs, w, dur) {
  if (st && st.fitTo) return _fitted(c, st, subs, w, dur);
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

// THE SIZE BY WIDTH: a page drawn in a font dealt over its preset's keeps the width it has in
// the preset's font - cut there (the same words a line, so nothing about the cut changes), then drawn at the size that makes its
// widest line as wide: between half and twice the size (a hair-thin Six Caps would grow threefold), and never wider than a
// line of the frame. Both widths in the line's own drawn font - a Russian line in its twin.
const FIT_MIN = 0.5, FIT_MAX = 2;
function _fitted(c, st, subs, w, dur) {
  const ref = Object.assign({}, st, { font: drawnFamily(st.fitTo, c && c.name) });
  delete ref.fitTo;
  const out = drawnPage(c, ref, subs, w, dur);
  const own = Math.round(+st.size || 0);
  const at = out.shrink || own;
  // The widest line at a size: its letters alone (the outline does not grow with them), or as drawn, edges on.
  const widest = (s, size, edges) => {
    const z = Object.assign({}, s, { size });
    const m = meter(z);
    const around = edges ? 0 : 2 * edgeOf(z) + Math.max(0, +z.shadow || 0);
    return Math.max(0, ...out.lines.map((l) => (String(l).length ? m.text(l) - around : 0)));
  };
  const wr = widest(ref, at);
  if (!(wr > 0 && widest(st, at) > 0)) return out;
  // The letters grow with the size, a style's spacing does not: the size found in a few steps, each from the width it gives.
  let k = 1;
  for (let step = 0; step < 4; step++) {
    const wc = widest(st, at * k);
    if (!(wc > 0) || Math.abs(wc - wr) < 0.5) break;
    k = Math.max(FIT_MIN, Math.min(FIT_MAX, k * wr / wc));
  }
  let size = Math.max(8, Math.round(at * k));
  const lim = LINE_MAX * w;
  for (let guard = 0; guard < 200 && size > 8 && widest(st, size, true) > lim; guard++) size--;
  out.shrink = size !== own ? size : null;
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
  // Back inside the frame - past it by more than half a pixel. Wider than the frame (never, with lines of 0.78):
  // centred.
  const fit = (p, size, room) => (size >= room ? (room - size) / 2 - p : p < -0.5 ? -p : p + size > room + 0.5 ? room - size - p : 0);
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
 * `track` - its lane, given: a page of a lane in two rows comes back where its row draws it (`lift`, px down; the
 * place it is measured from - `dx`, `dy`, `ax`, `ay` less the lift - stays the lane's or its own).
 */
export function pageBox(c, laneStyle, subs, W, H, track) {
  const own = c && c.style && typeof c.style === 'object' && Object.keys(c.style).length ? c.style : null;
  // In the font it is drawn in: a line with a Cyrillic letter in a font without them is drawn in the twin.
  const st = withTwin(withAuto(resolveStyle(laneStyle, own), W, H), c && c.name);
  const start = Math.max(0, +c.start || 0);
  const dur = Math.max(0.05, +c.dur || 0);
  const b = boxOf(drawnPage(c, st, subs, W, (start + dur) - start), st, W, H);
  b.st = st;
  const r = track ? rowOf(track, c, W, H) : null;
  return r && r.lift ? lifted(b, r.lift) : b;
}

/** A page's rectangle moved `lift` pixels down (up when less than 0) - into its row; `lift` said on it. */
export function lifted(b, lift) {
  const out = Object.assign({}, b, { y: b.y + lift, ay: b.ay + lift, lift });
  out.lines = (b.lines || []).map((l) => Object.assign({}, l, { y: l.y + lift }));
  return out;
}

/**
 * Every page on screen at `t` (seconds), in the order they are drawn - the subtitles first, the text lanes over
 * them: [{ track, clip, lane, box }]. What is on top is LAST.
 * On a lane in two rows a page is on screen from its In to the end of its Out, in its row (rowsPlan): `box` - where
 * it is drawn, `box0` - where its place puts it (what a drag moves from).
 */
export function pagesAt(tl, t, W, H) {
  const out = [];
  captionLanes(tl).forEach((tr, lane) => {
    const plan = tr.kind === 'subs' ? rowsPlan(tr, W, H) : null;
    let i = -1;
    for (const c of (tr.clips || [])) {
      if (!c || !c.name || !((+c.dur) > 0)) continue;
      i++;
      const s = Math.max(0, +c.start || 0), e = s + Math.max(0.05, +c.dur || 0);
      const r = plan ? plan.get(pageKey(c, i)) : null;
      if (r ? (t < r.from || t >= r.to) : (t < s || t >= e)) continue;
      const box0 = pageBox(c, tr.style, tr.kind === 'subs', W, H);
      out.push({ track: tr, clip: c, lane, box: r && r.lift ? lifted(box0, r.lift) : box0, box0 });
    }
  });
  return out;
}

// ── TWO ROWS ─────────────────────────────────────────────────────────────────
/** The rule's numbers: a page whole at least `minOn` s; rows `gap` of a line apart; an Out and an In kept at `share` of their length
 *  at least while a page can stay longer; a pause `reset` s longer than an Out and an In - the first row again. Not settings. */
export const ROWS = { minOn: 0.8, gap: 0.15, share: 0.5, reset: 0.05 };

/** A page's key in its lane's plan: its id - or its place among the lane's drawn pages (`i`), for a page without one. */
export const pageKey = (c, i) => (c && c.id) || '#' + i;

const _plans = new Map();      // the last plans worked out, by what they were worked out from
const PLANS_KEPT = 12;

/**
 * THE PLAN OF A SUBTITLE LANE IN TWO ROWS on a W x H frame: null for any other lane; else a Map from each drawn page's key (pageKey,
 * among the pages with words and a length, in the lane's order) to { S, E - its time on the timeline; H - whole on screen until;
 * inL, outL - its In before S and its Out after H, seconds (0 - none); from, to - on screen; row 0 | 1; lift - px down (up when
 * less than 0) its row moves it; other - 'up' | 'down', where the other row is (page-fx.js awayFrom) }.
 */
export function rowsPlan(track, W, H) {
  if (!track || track.kind !== 'subs' || !rowsOn(track.style)) return null;
  const clips = (track.clips || []).filter((c) => c && c.name && (+c.dur) > 0);
  const sig = W + 'x' + H + JSON.stringify([track.style, clips.map((c) => [c.id || '', c.start, c.dur, c.name, c.style || null,
    Array.isArray(c.words) ? c.words.map((w) => w && w.w).join(' ') : null])]);
  const had = _plans.get(sig);
  if (had) { _plans.delete(sig); _plans.set(sig, had); return had; }
  const plan = _rowsOf(track.style, clips, W, H);
  _plans.set(sig, plan);
  if (_plans.size > PLANS_KEPT) _plans.delete(_plans.keys().next().value);
  return plan;
}

/** A page's row and times on its lane (rowsPlan) - null when the lane is in one row. */
export function rowOf(track, c, W, H) {
  const plan = rowsPlan(track, W, H);
  if (!plan) return null;
  const i = (track.clips || []).filter((x) => x && x.name && (+x.dur) > 0).indexOf(c);
  return plan.get(pageKey(c, i)) || null;
}

function _rowsOf(laneStyle, clips, W, H) {
  const laneSt = withAuto(resolveStyle(laneStyle), W, H);
  const gap = ROWS.gap * (+laneSt.size || 60) * ((+laneSt.scaleY || 100) / 100);
  // A lane at the top of the frame has its second row under it; in the middle and at the bottom, over it.
  const under = laneSt.pos === 'top';
  const P = clips.map((c, i) => {
    const box = pageBox(c, laneStyle, true, W, H);
    const lens = motionLens(box.st);
    const S = Math.max(0, +c.start || 0);
    return { key: pageKey(c, i), i, S, E: S + Math.max(0.05, +c.dur || 0), box, inF: lens ? lens.enter : 0, outF: lens ? lens.leave : 0 };
  }).sort((a, b) => a.S - b.S || a.i - b.i);
  // The rows: every other page, the first row again after a pause the last one can leave and this one come in.
  for (let i = 0; i < P.length; i++) {
    const p = P[i], q = P[i - 1];
    p.inL = Math.min(p.inF, p.S);
    p.outL = p.outF;
    p.H = p.E;
    p.row = !q || p.S - q.E >= q.outF + p.inF + ROWS.reset ? 0 : 1 - q.row;
  }
  // How long each stays whole: at least minOn - but gone before the next page of its row comes in; the reading time first, the Out
  // and that In playing shorter for it, down to `share` of their length; with no room even for that, shorter still.
  for (let i = 0; i < P.length; i++) {
    const p = P[i];
    let j = i + 1;
    while (j < P.length && P[j].row !== p.row) j++;
    const n = P[j];
    const want = Math.max(p.E, p.S + ROWS.minOn);
    if (!n) { p.H = want; continue; }
    const need = p.outF + n.inF;
    p.H = Math.max(p.E, Math.min(want, n.S - need * ROWS.share));
    const room = Math.max(0, n.S - p.H);
    if (room < need) {
      const k = need > 0 ? room / need : 0;
      p.outL = Math.min(p.outL, p.outF * k);
      n.inL = Math.min(n.inL, n.inF * k);
    }
  }
  // The second row: a usual page's height and the gap from the first - more beside a page of the first row that is taller -, and
  // never out of the frame.
  const hs = P.map((p) => p.box.h).sort((a, b) => a - b);
  const L0 = (hs[hs.length >> 1] || 0) + gap;
  const out = new Map();
  for (let i = 0; i < P.length; i++) {
    const p = P[i];
    let lift = 0;
    if (p.row === 1) {
      let L = L0;
      for (const nb of [P[i - 1], P[i + 1]]) {
        if (!nb || nb.row !== 0) continue;
        const need = under
          ? (nb.box.y + nb.box.h - nb.box.ay) + (p.box.ay - p.box.y)
          : (nb.box.ay - nb.box.y) + (p.box.y + p.box.h - p.box.ay);
        L = Math.max(L, need + gap);
      }
      lift = under ? Math.max(0, Math.min(L, H - p.box.y - p.box.h)) : -Math.max(0, Math.min(L, p.box.y));
    }
    const other = (p.row === 0) === under ? 'down' : 'up';
    out.set(p.key, { S: p.S, E: p.E, H: p.H, inL: p.inL, outL: p.outL, from: p.S - p.inL, to: p.H + p.outL, row: p.row, lift, other });
  }
  return out;
}

/** A point in a rectangle (a little slack round it, `pad` pixels). */
export const inBox = (p, b, pad) => !!b && p.x >= b.x - (pad || 0) && p.x <= b.x + b.w + (pad || 0)
  && p.y >= b.y - (pad || 0) && p.y <= b.y + b.h + (pad || 0);

/** Does a caption's own style set where it sits? Then its lane's place does not move it. */
export const ownPlace = (c) => !!(c && c.style && typeof c.style === 'object'
  && (c.style.pos != null || c.style.tx != null || c.style.ty != null));

const _clampOff = (v) => Math.max(-1, Math.min(1, Math.round(v * 10000) / 10000));

/**
 * WHERE A PAGE DRAGGED by (dx, dy) frame pixels lands, from its place `from` ({pos, tx,
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
