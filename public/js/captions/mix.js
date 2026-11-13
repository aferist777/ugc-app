/* ═══════════════════════════════════════════════════════════════════════════
   CAPTIONS — SEVERAL PRESETS AND ANIMATIONS DEALT ONTO THE PAGES.

   With Shift, several preset tiles - and several animation tiles - are picked for the SUBTITLE lane (only there), and
   every page wears one of each at random: two pages in a row never the same preset. The lane keeps what was picked
   (style.js: `mix` - one look per preset, what its own section of the strip changes; `anims` - the 'in|out' pairs; `mixSeed`) and
   a page only REFERENCES its share (`mixP`, `mixA` and the seed it was dealt with, `mixS`) - so a preset's section changed in
   the strip is every one of its pages at once, and style.js resolveStyle draws a page with the look and the pair it was dealt.

   DEALT AT THE PRESS - a new seed - and again whenever pages are made (a re-cut, Generate, a fragment laid): a page keeps what
   it was dealt with this seed unless its neighbour before it has the same preset; a new page - or one that must change - is
   dealt by a number made from the seed and its moment, so the same pages dealt again come out the same (a re-cut that changes
   nothing changes nothing). A lane without a mix has the references taken away.

   FONTS: the lane's `fonts` are dealt the same way - `mixF`, the page's font, two pages in a
   row never the same - when there are two or more (one font is every page's and needs no reference); the same seed, so picking
   fonts keeps the presets and animations dealt as they were.

   PURE, and shared: pages.js deals in its re-cuts, the server (lib/captions-job.js, lib/highlights-cut.js) when it lays a lane.
   ═══════════════════════════════════════════════════════════════════════════ */

import { mixOf, animsOf, fontsOf } from './style.js';

/** The fields a deal puts on a page's own style. */
export const REFS = ['mixP', 'mixA', 'mixS', 'mixF'];

/** A page's own style without what a deal put on it - its own look and place; null when nothing is left. */
export function withoutRefs(st) {
  if (!st || typeof st !== 'object') return null;
  if (!REFS.some((k) => k in st)) return st;
  const o = Object.assign({}, st);
  for (const k of REFS) delete o[k];
  return Object.keys(o).length ? o : null;
}

/** What a deal put on a page's style ({ mixP, mixA, mixS } as set), null for none. */
export function refsOf(st) {
  if (!st || typeof st !== 'object') return null;
  const o = {};
  for (const k of REFS) if (st[k] !== undefined) o[k] = st[k];
  return Object.keys(o).length ? o : null;
}

/** A seed for a press: a deal unlike the last. */
export const newSeed = () => Math.floor(Math.random() * 2147483646) + 1;

// Fonts are dealt when there are two or more.
const _fontsDealt = (st) => { const f = fontsOf(st); return f && f.length >= 2 ? f : null; };

/** Is there anything to deal on this lane - a mix, animations, fonts, or references left from one? */
export function needsDeal(lane) {
  const st = (lane && lane.style) || {};
  if (mixOf(st) || animsOf(st) || _fontsDealt(st)) return true;
  return ((lane && lane.clips) || []).some((c) => c && c.style && REFS.some((k) => c.style[k] !== undefined));
}

// A number in [0, 1) from the seed, a page's moment (centiseconds) and what is dealt: the same page dealt again gets the same.
function _rnd(seed, cs, salt) {
  let h = (seed ^ Math.imul(cs + 1, 0x9e3779b1) ^ Math.imul(salt + 7, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * The fonts dealt ANEW - after a press on the fonts tab: every page's font picked again from the lane's `fonts` (by the
 * seed and its moment, so the same press twice deals the same), its preset and animation kept as they were dealt.
 */
export function redealFonts(clips, laneStyle) {
  for (const c of (clips || [])) {
    if (!c || !c.style || c.style.mixF === undefined) continue;
    const st = Object.assign({}, c.style);
    delete st.mixF;
    if (Object.keys(st).length) c.style = st; else delete c.style;
  }
  return deal(clips, laneStyle);
}

/**
 * DEAL the lane's mix onto its pages (`clips` - the lane's, changed in place): every page with words, in time order, an entry of
 * `mix`, a pair of `anims` and one of `fonts` (see the header). `laneStyle` - the lane's style as it is now. Returns how many pages changed.
 */
export function deal(clips, laneStyle) {
  const lane = laneStyle || {};
  const mix = mixOf(lane), an = animsOf(lane), fo = _fontsDealt(lane);
  const seed = Number.isInteger(lane.mixSeed) ? lane.mixSeed : 0;
  const list = (clips || []).filter((c) => c && c.name).sort((a, b) => (+a.start || 0) - (+b.start || 0));
  let prevP = -1, prevA = -1, prevF = -1, changed = 0;
  for (const c of list) {
    const before = JSON.stringify(c.style || null);
    const st = Object.assign({}, c.style || {});
    const cs = Math.round((+c.start || 0) * 100);
    const kept = st.mixS === seed;
    const pick = (n, cur, prev, salt) => {
      if (kept && Number.isInteger(cur) && cur < n && (cur !== prev || n < 2)) return cur;
      const opts = [];
      for (let k = 0; k < n; k++) if (k !== prev || n < 2) opts.push(k);
      return opts[Math.floor(_rnd(seed, cs, salt) * opts.length)];
    };
    if (mix) { st.mixP = pick(mix.length, st.mixP, prevP, 1); prevP = st.mixP; } else delete st.mixP;
    if (an) { st.mixA = pick(an.length, st.mixA, prevA, 2); prevA = st.mixA; } else delete st.mixA;
    if (fo) { st.mixF = pick(fo.length, st.mixF, prevF, 3); prevF = st.mixF; } else delete st.mixF;
    if (mix || an || fo) st.mixS = seed; else delete st.mixS;
    if (Object.keys(st).length) c.style = st; else delete c.style;
    if (JSON.stringify(c.style || null) !== before) changed++;
  }
  return changed;
}
