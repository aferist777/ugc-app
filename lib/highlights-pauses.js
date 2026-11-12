'use strict';

/* highlights-pauses.js - a lecture's pauses shortened (phase V69 P12b, the owner's (хп76), (хп99), (хп100); docs/local-app/plan/
   "Фаза V69", П12б - the measurement on lectures 20 and 01).

   A lecture is a third silence: the lecturer writes on the board and dictates. Its fragments are cut with every pause LONGER
   THAN OVER (0.8 s) shortened to KEEP (0.3 s) - by the rule of Merge's button S: silent is below the stretch's own noise floor
   (lib/track-pauses.js), the cut keeps half of KEEP after the sound before it and half before the sound after
   (public/js/sound/pause-cuts.js cutsOfPauses). Measured: 11-13 % of a lecture goes, ~6 seams a minute.

   ONE READING FOR THE AGENT AND THE CUT ((хп99)): the source's whole sound is read once, before the agent is asked (~40 s for
   2.5 h, kept in cache/pauses/ by lib/track-pauses.js), in CHUNK-second stretches - each its own noise floor, as button S finds
   it on a clip of about that length; pauses meeting at a stretch's edge are one. From those pauses:
     clockOf(pauses)        the CLOCK OF THE SPEECH - where a moment of the video lands once its pauses are shortened: the agent
                            is told its sentences' times on it, and lib/highlights-agent.js parse measures a moment by it, so a
                            moment asked 30-60 s is 30-60 s cut;
     cutsIn(pauses, a, b)   the cuts inside a piece [a, b] of the video ({ a, b } in the video's seconds, its edges walls) -
                            lib/highlights-cut.js layOut lays the piece as the stretches between them. */

const TP = require('./track-pauses');

const OVER = 0.8;       // s: a pause longer than this is shortened ...
const KEEP = 0.3;       // ... to this
const CHUNK = 60;       // s of the source a noise floor is measured over
const TOUCH = 0.02;     // s: two pauses this close at a chunk's edge are one

let _pc = null;
const _cuts = () => (_pc || (_pc = require('../public/js/sound/pause-cuts.js')));

const r3 = (v) => Math.round(v * 1000) / 1000;

/**
 * The pauses longer than OVER in the sound of the file at `abs` (`seconds` long), the file's seconds: [[a, b], ...] in order.
 * Read once (the cache), chunk by chunk; `onFrac(0..1)` follows it, `signal` stops it between chunks.
 */
async function pausesOf(abs, seconds, { onFrac, signal } = {}) {
  const total = Math.max(0, +seconds || 0);
  if (!(total > 0)) return [];
  // One ffmpeg for the whole sound first - the chunks then read the kept pieces.
  await TP.pausesIn(abs, 0, total);
  const all = [];
  for (let a = 0; a < total; a += CHUNK) {
    if (signal && signal.aborted) throw Object.assign(new Error('cancelled'), { cancelled: true });
    const r = await TP.pausesIn(abs, a, Math.min(total, a + CHUNK));
    for (const p of r.pauses || []) {
      const last = all[all.length - 1];
      if (last && p[0] - last[1] <= TOUCH) last[1] = Math.max(last[1], p[1]);
      else all.push([p[0], p[1]]);
    }
    if (onFrac) onFrac(Math.min(1, (a + CHUNK) / total));
  }
  return all.filter(([a, b]) => b - a > OVER).map(([a, b]) => [r3(a), r3(b)]);
}

/** The cuts of the whole video, { a, b } in its seconds. */
const _allCuts = (pauses) => _cuts().cutsOfPauses(pauses || [], KEEP, []);

/** The clock of the speech: t (the video's second) -> where it lands with every pause longer than OVER shortened to KEEP. */
function clockOf(pauses) {
  const cuts = _allCuts(pauses);
  const map = _cuts().mapThrough;
  return (t) => map(cuts, +t || 0);
}

/** The cuts inside the piece [a, b] of the video (its seconds), { a, b } in order - the piece's edges are walls. */
function cutsIn(pauses, a, b) {
  const inside = (pauses || []).filter(([x, y]) => y > a && x < b).map(([x, y]) => [Math.max(a, x), Math.min(b, y)]).filter(([x, y]) => y - x > OVER);
  return _cuts().cutsOfPauses(inside, KEEP, [a, b]).filter((c) => c.a > a && c.b < b);
}

module.exports = { OVER, KEEP, CHUNK, pausesOf, clockOf, cutsIn };
