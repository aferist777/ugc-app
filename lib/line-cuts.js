'use strict';

// ════════════════════════════════════════════════════════════════════════════
// CUTS INSIDE A TALKING HEAD'S LINE (phase V44, the owner 2026-10-24: (ы5) "надо бы и тишину внутри строк резать", (ы9) А,
// (ы10) А, (ы11)). A talking head's timeline is a mirror of its script (lib/frag-mirror.js): a cut made only on the timeline
// would be laid away by the next lay. So what is cut out of a line lives IN THE LINE (project.json):
//
//   line.cuts = { voice, list: [[a, b], ...] }    stretches of the line's own sound left out, in seconds of its file (a
//                                                 mirror cell plays its file from 0), bound to the take they were cut in
//                                                 (`voice`, lib/frag-mirror.js cellsOf): another read, other words,
//                                                 another clip chosen - the line is laid whole again
//
// THE TIMELINE SAYS WHAT IS CUT. Merge cuts a line as it cuts any clip (js/merge-v3/tl-cut.js: its cell becomes pieces of
// its file laid end to end, its captions and everything after it moved left, one step to undo) and saves; the save
// (routes/mergev3.js PUT) reads the pieces of every line back into `line.cuts` (fromTimeline) - so Ctrl+Z, a save of the
// undone timeline, gives the line its pauses back. The mirror lays a line with cuts as those pieces again (piecesOf), the
// captions are heard from the whole line and laid through its cuts (placer).
// ════════════════════════════════════════════════════════════════════════════

const MIN_PIECE = 0.02;            // s: a piece of a line shorter than this is not laid
const GAP = 0.005;                 // s: two pieces closer than this in the file play on - no cut between them
const SEAM_FADE = 0.015;           // s: a sound fades out into a cut and in out of it (as js/merge-v3/tl-cut.js SEAM_FADE)
const r3 = (v) => Math.round(v * 1000) / 1000;

/** A stored `cuts` record, every stretch valid, in order and apart - or null. */
function normalize(c) {
  if (!c || typeof c !== 'object' || !c.voice || !Array.isArray(c.list)) return null;
  const list = c.list.filter((p) => Array.isArray(p) && p.length >= 2 && Number.isFinite(+p[0]) && Number.isFinite(+p[1]) && +p[1] - +p[0] > GAP)
    .map((p) => [r3(Math.max(0, +p[0])), r3(+p[1])]).sort((x, y) => x[0] - y[0]).slice(0, 2000);
  const out = [];
  for (const p of list) {
    const last = out[out.length - 1];
    if (last && p[0] <= last[1] + GAP) last[1] = Math.max(last[1], p[1]); else out.push(p);
  }
  return out.length ? { voice: String(c.voice).slice(0, 600), list: out } : null;
}

/** The cuts of `line` that belong to the take speaking now (`voice`), [[a, b]] - none for another take. */
function cutsOf(line, voice) {
  const c = normalize(line && line.cuts);
  return c && voice && c.voice === String(voice) ? c.list : [];
}

/** What of a line `dur` long is laid, given its cuts: [[from, to]] of its file, in order - the whole line when none. */
function piecesOf(dur, cuts) {
  const d = Math.max(0, +dur || 0);
  const out = [];
  let at = 0;
  for (const [a, b] of (cuts || [])) {
    if (b <= at) continue;
    if (a >= d) break;
    if (a - at >= MIN_PIECE) out.push([r3(at), r3(Math.min(a, d))]);
    at = Math.max(at, b);
  }
  if (d - at >= MIN_PIECE) out.push([r3(at), r3(d)]);
  // Nothing left would be a line that is not there: it is laid whole rather than lost.
  return out.length ? out : [[0, r3(d)]];
}

/**
 * The cuts a line's pieces on the timeline say: the stretches of [0, dur] of its file no piece plays. `pieces` - its cells,
 * { trimIn, dur, speed }. [] - the line plays whole.
 */
function derive(pieces, dur) {
  const ws = (pieces || []).map((c) => [+c.trimIn || 0, (+c.trimIn || 0) + (+c.dur || 0) * (+c.speed > 0 ? +c.speed : 1)])
    .sort((x, y) => x[0] - y[0]);
  const out = [];
  let at = 0;
  for (const [s, e] of ws) {
    if (s - at > GAP) out.push([r3(at), r3(s)]);
    at = Math.max(at, e);
  }
  const d = +dur || 0;
  if (d - at > GAP) out.push([r3(at), r3(d)]);
  return out;
}

/**
 * Where a moment of a line's FILE lands on the timeline, from its pieces there ({ start, dur, trimIn, speed }): inside a
 * piece - its place; in a cut - `side` 'next' the next piece's start, 'prev' the last one's end; null when no piece is
 * near. `inCut(f)` - is that moment cut out; `covers(f0, f1)` - is any of that stretch still played.
 */
function placer(pieces) {
  const ps = (pieces || []).map((c) => ({ start: +c.start || 0, sp: +c.speed > 0 ? +c.speed : 1, a: +c.trimIn || 0,
    b: (+c.trimIn || 0) + (+c.dur || 0) * (+c.speed > 0 ? +c.speed : 1) })).sort((x, y) => x.a - y.a);
  const find = (f) => ps.find((p) => f >= p.a - 1e-6 && f < p.b + 1e-6);
  return {
    at(f, side) {
      const p = find(f);
      if (p) return p.start + (Math.min(f, p.b) - p.a) / p.sp;
      if (side === 'prev') { const q = ps.filter((x) => x.b <= f).pop(); return q ? q.start + (q.b - q.a) / q.sp : null; }
      const q = ps.find((x) => x.a >= f);
      return q ? q.start : null;
    },
    inCut: (f) => !find(f),
    // Does any piece play a part of [f0, f1] - is anything of a word there still heard?
    covers: (f0, f1) => ps.some((p) => p.a < f1 - 1e-6 && p.b > f0 + 1e-6),
    start: ps.length ? Math.min(...ps.map((p) => p.start)) : 0,
    end: ps.length ? Math.max(...ps.map((p) => p.start + (p.b - p.a) / p.sp)) : 0,
  };
}

/**
 * A talking head's timeline just saved: the cuts its lines' pieces say, written into their lines in one tick - only the
 * lines whose cuts changed, only for the take each line speaks now (a page that has not caught up with a new take writes
 * nothing for it). Never throws. @returns how many lines changed
 */
function fromTimeline(projectId, tracks) {
  try {
    const PROJECTS = require('./projects-store');
    const MIRROR = require('./frag-mirror');
    const proj = PROJECTS.get(projectId);
    if (!proj || !Array.isArray(proj.lines)) return 0;
    const a1 = ((Array.isArray(tracks) ? tracks : []).find((t) => t && t.id === 'a1') || {}).clips || [];
    const byVoice = new Map();
    for (const c of a1) {
      if (!(Number(c && c.frag) > 0) || !c.voice) continue;
      if (!byVoice.has(c.voice)) byVoice.set(c.voice, []);
      byVoice.get(c.voice).push(c);
    }
    const changes = [];
    for (const cell of MIRROR.cellsOf(proj)) {
      const pieces = byVoice.get(cell.voice);
      if (!pieces || !pieces.length || pieces.some((c) => +c.frag !== cell.n)) continue;
      const list = derive(pieces, MIRROR.lineDurOf(cell));
      const want = list.length ? normalize({ voice: cell.voice, list }) : null;
      const have = normalize(proj.lines[cell.i] && proj.lines[cell.i].cuts);
      if (JSON.stringify(want) !== JSON.stringify(have)) changes.push([cell.i, want]);
    }
    if (!changes.length) return 0;
    PROJECTS.apply(projectId, (p) => {
      for (const [i, want] of changes) {
        if (!p.lines[i]) continue;
        if (want) p.lines[i].cuts = want; else delete p.lines[i].cuts;
      }
    });
    console.log('[line-cuts] ' + projectId + ': ' + changes.length + ' line(s) cut differently now');
    return changes.length;
  } catch (e) {
    console.warn('[line-cuts] not read from the timeline:', e.message);
    return 0;
  }
}

module.exports = { normalize, cutsOf, piecesOf, derive, placer, fromTimeline, SEAM_FADE, MIN_PIECE };
