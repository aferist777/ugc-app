/* ═══════════════════════════════════════════════════════════════════════════
   CAPTIONS — a stretch of time cut out of a line (phase V36, T5).

   Merge cuts a stretch [a, b) out of EVERY lane and closes the gap (js/merge-v3/tl-cut.js); this is what happens to one
   line of a subtitle or text lane. The rule the owner was given (docs/local-app/PLAN.md, phase V34, "как пересчитываются
   субтитры", 2026-10-23):

     a line wholly before a        stays as it is
     a line wholly after b         moves left by b - a, its words untouched (they are timed from the line's start)
     a line wholly inside          goes
     a line the cut crosses        loses the words whose MIDDLE is inside the cut; the rest keep their moments, those after
                                   the cut moved left with it; its text is put together again from what is left. Where no
                                   word goes (only silence was cut) the text stays exactly as it was. Nothing is heard again.
                                   A line whose first word went starts at its first word left, one whose last went ends
                                   at its last - not over the silence a gone word leaves (the captions' document's rule).
     a typed line, a title         (no words) is moved, or shortened by the part of it inside the cut; one left shorter
                                   than MIN goes.

   Pure: a line in, the new line (a copy; the same object when nothing changes) or null out. Every mark of a word stays
   with it (`h` corrected, `k` stand out); the line keeps every other field (its id, style, place, `voice`).
   ═══════════════════════════════════════════════════════════════════════════ */

import { isHeard } from './heard.js';
import { timedWords } from './pages.js';

const r2 = (v) => Math.round(v * 100) / 100;
const EPS = 1e-6;
/** A line left on screen for less than this goes. */
export const MIN = 0.05;

/**
 * Cut [a, b) out of a caption line `c` ({ start, dur, name, words? }) and close the gap.
 * @returns {object|null} the line after the cut (`c` itself when the cut is wholly after it), or null when it goes
 */
export function cutLine(c, a, b) {
  if (!c) return null;
  a = r2(+a || 0); b = r2(+b || 0);
  if (!(b > a)) return c;
  const D = b - a;
  const s = +c.start || 0;
  const e = s + (+c.dur || 0);
  if (e <= a + EPS) return c;
  if (s >= b - EPS) return { ...c, start: r2(s - D) };
  if (s >= a - EPS && e <= b + EPS) return null;
  // A moment of the timeline before the cut -> after it: inside the cut is its start.
  const map = (t) => (t <= a ? t : t >= b ? t - D : a);
  const ns = r2(map(s));
  let ne = r2(map(e));
  if (!isHeard(c)) {
    if (ne - ns < MIN - EPS) return null;
    return { ...c, start: ns, dur: r2(ne - ns) };
  }
  // A line rewritten before K10 is timed for its text first: the person's text is what stays.
  const words = timedWords(c);
  let dropped = 0;
  const kept = [];
  words.forEach((w, i) => {
    const ws = s + (+w.s || 0), we = s + (+w.e || 0);
    const mid = (ws + we) / 2;
    if (mid >= a - EPS && mid < b - EPS) { dropped++; return; }
    kept.push({ ...w, i, s: r2(Math.max(0, map(ws) - ns)), e: r2(Math.max(0, map(we) - ns)) });
  });
  if (!kept.length) return null;
  // EDGES FOLLOW THE WORDS (as the captions' document keeps them, doc.js): a line whose first word went starts at its
  // first word left, one whose last word went ends at its last - not up over the silence the gone word leaves.
  let from = 0;
  if (kept[0].i !== 0) from = kept[0].s;
  const lastWord = kept[kept.length - 1];
  if (lastWord.i !== words.length - 1) ne = r2(ns + lastWord.e);
  const out0 = kept.map(({ i, ...w }) => (from ? { ...w, s: r2(w.s - from), e: r2(w.e - from) } : w));
  const start = r2(ns + from);
  // A word kept runs to its end: the line is at least as long as its words.
  ne = Math.max(ne, r2(start + Math.max(...out0.map((w) => w.e))));
  if (ne - start < MIN - EPS) return null;
  const out = { ...c, start, dur: r2(ne - start), words: out0 };
  // Only silence was cut: the text is what it was (words timed for a rewritten text spell it). Words went: the text is
  // what is left of them, as a split does.
  if (dropped) out.name = kept.map((w) => w.w).join(' ');
  return out;
}
