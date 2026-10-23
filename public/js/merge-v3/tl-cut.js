/* ═══════════════════════════════════════════════════════════════════════════
   MERGE v3 — a stretch of time cut out of every lane, the rest moved left (phase V36, T5).

   The owner, 2026-10-23, (у8): "чтобы можно было подрезать пользователю вручную тишину со смещением" - a stretch drawn
   over a waveform and Delete: the stretch goes from EVERY lane, and everything after it moves left by its length, so a
   picture and its sound stay together. Inside one mutation (js/merge-v3/timeline-b.js cutRange) - one step to undo.

     a clip wholly before the cut       stays
     a clip wholly after it             moves left
     a clip wholly inside               goes
     a clip the cut's start crosses     loses its tail (a reversed clip: the part of its file at the window's start)
     a clip the cut's end crosses       loses its head and starts where the cut was
     a clip across the whole cut        a film or a sound becomes two pieces playing on from where each was (a pair's two
                                        halves cut alike, the right pieces a pair of their own, as split makes them); a
                                        still is only shortened
     a caption line, a title            js/captions/cut.js: words inside go, the rest move, nothing heard again

   A TALKING HEAD's lines are laid by its script (lib/frag-mirror.js: cells with `frag`, and the caption pages bound to a
   line by `voice`): the mirror lays them again by the script, so they are never cut or moved here (the owner's (ф7)) -
   a cut that would reach one is refused in words; a pause inside a line goes by reading the line again.
   ═══════════════════════════════════════════════════════════════════════════ */

import { cutLine } from '../captions/cut.js';

const r2 = (v) => Math.round(v * 100) / 100;
const EPS = 1e-6;
/** The shortest stretch worth cutting. */
export const MIN_CUT = 0.05;

const _end = (c) => (+c.start || 0) + (+c.dur || 0);
const _words = (t) => t && (t.kind === 'subs' || t.kind === 'text');

/** Why [a, b) cannot be cut out of `tl`, in words - or '' when it can. */
export function cutRefused(tl, a, b) {
  if (!tl || !Array.isArray(tl.tracks)) return 'Nothing is open to cut';
  if (!(b - a >= MIN_CUT)) return 'Draw a longer stretch over the wave to cut it out';
  for (const t of tl.tracks) {
    for (const c of (t.clips || [])) {
      // A line of a talking head that ends after the cut's start would be cut or moved.
      if ((c.frag != null || (_words(t) && c.voice)) && _end(c) > a + EPS) {
        return 'The lines of the talking head are laid by its script and are not cut here - a pause inside a line goes '
          + 'by reading the line again. Cut after the last line, on your own clips.';
      }
    }
  }
  return '';
}

/**
 * Cut [a, b) out of every lane of `tl` (a timeline being mutated) and close the gap.
 * `opts.newId()` - an id for a clip's right piece; `opts.isStill(c)` - a picture, which is shortened rather than split.
 */
export function rippleCut(tl, a, b, opts) {
  a = r2(+a || 0); b = r2(+b || 0);
  const D = r2(b - a);
  if (!(D > 0)) return;
  const newId = (opts && opts.newId) || (() => 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7));
  const isStill = (opts && opts.isStill) || (() => false);
  // The right pieces of a pair cut through become a pair of their own - one new pair id for both halves.
  const pairs = new Map();
  const pairOf = (p) => { if (!pairs.has(p)) pairs.set(p, 'p' + newId().replace(/^c/, '')); return pairs.get(p); };

  for (const t of (tl.tracks || [])) {
    if (!Array.isArray(t.clips)) continue;
    const out = [];
    for (const c of t.clips) {
      if (_words(t)) {
        const n = cutLine(c, a, b);
        if (n) out.push(n);
        continue;
      }
      const s = +c.start || 0, e = _end(c);
      const sp = +c.speed || 1;
      const tin = +c.trimIn || 0;
      const still = isStill(c);
      if (e <= a + EPS) { out.push(c); continue; }
      if (s >= b - EPS) { c.start = r2(s - D); out.push(c); continue; }
      if (s >= a - EPS && e <= b + EPS) continue;
      if (s < a && e > b) {
        if (still) { c.dur = r2(c.dur - D); out.push(c); continue; }
        // Two pieces: [s, a) and [b, e) of the clip, the second now starting at a.
        const left = r2(a - s), right = r2(e - b);
        const piece = JSON.parse(JSON.stringify(c));
        piece.id = newId();
        piece.start = a;
        piece.dur = right;
        // A sound's fade belongs to its own end (as a split leaves it): the left keeps the fade in, the right the fade out.
        delete piece.fadeIn;
        delete c.fadeOut;
        if (c.reversed) {
          // Played backwards, the timeline's first part is the END of the file's window: the right piece keeps its start.
          piece.trimIn = r2(tin);
          c.trimIn = r2(tin + (c.dur - left) * sp);
        } else {
          piece.trimIn = r2(tin + (b - s) * sp);
        }
        c.dur = left;
        if (c.pairId) piece.pairId = pairOf(c.pairId);
        // On a video lane the order is which one shows: the second piece belongs where the whole clip was.
        out.push(c, piece);
        continue;
      }
      if (s < a) {
        // The tail goes. Backwards, the tail of the timeline is the start of the file's window.
        const cut = r2(e - a);
        if (c.reversed && !still) c.trimIn = r2(tin + cut * sp);
        c.dur = r2(a - s);
        out.push(c);
        continue;
      }
      // The head goes (s in the cut, e after it): the rest starts where the cut was.
      const cut = r2(b - s);
      if (!c.reversed && !still) c.trimIn = r2(tin + cut * sp);
      c.start = a;
      c.dur = r2(e - b);
      out.push(c);
    }
    t.clips = out;
    if (t.kind === 'audio') t.clips.sort((x, y) => x.start - y.start);
  }
}
