'use strict';

// ════════════════════════════════════════════════════════════════════════════
// CUTS INSIDE A TALKING HEAD'S LINE.
// A talking head's timeline is a mirror of its script (lib/frag-mirror.js): a cut made only on the timeline
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

// ── Lines merged into one file ──────────────────────────────────────────────
// Merge can make one file of a talking head's lines in a row (js/merge-v3/tl-merge.js, lib/merge-clips.js). The merged
// cell stays the mirror's: `frag` - its first line's number, `merge` - what it holds, line by line:
//
//   merge = [{ n, voice, pieces: [[trimIn, dur, at]] }]   each line's take, and its pieces: where in the line's own file,
//                                                         how long, and where in the merged file they play
//
// The save writes it on the FIRST line of the run (`line.merge = { src, dur, video, lines }`), and the mirror lays the run
// as ONE cell for as long as its lines are still those takes, one after another in the cut - matched by take (`voice`),
// not by number: a line put in above moves the numbers. Another read, words or clip of any of them: the merge is let go of,
// the lines are laid one by one again (the file stays in the project's folder).

const _num = (v) => Number.isFinite(+v) ? +v : NaN;

/** A merge's lines, every piece valid - or null. */
function normalizeMergeLines(m) {
  if (!Array.isArray(m) || !m.length) return null;
  const out = [];
  for (const e of m.slice(0, 500)) {
    if (!e || !e.voice) return null;
    const pieces = (Array.isArray(e.pieces) ? e.pieces : []).filter((p) => Array.isArray(p) && p.length >= 3 && p.slice(0, 3).every((x) => Number.isFinite(+x)) && +p[1] > 0)
      .map((p) => [r3(Math.max(0, +p[0])), r3(+p[1]), r3(Math.max(0, +p[2]))]).sort((a, b) => a[2] - b[2]);
    if (!pieces.length) return null;
    out.push({ n: Number.isInteger(+e.n) && +e.n > 0 ? +e.n : 0, voice: String(e.voice).slice(0, 600), pieces });
  }
  return out.length >= 1 ? out : null;
}

/** A line's stored merge - { src, dur, video, lines } - or null. */
function normalizeMerge(m) {
  if (!m || typeof m !== 'object' || !m.src || !(_num(m.dur) > 0)) return null;
  const lines = normalizeMergeLines(m.lines);
  return lines && lines.length >= 1 ? { src: String(m.src).slice(0, 600), dur: r3(+m.dur), video: !!m.video, lines } : null;
}

/**
 * Cells with a merged cell spread into the pieces of the lines it holds - cells of their own with each line's `voice` and
 * its file's window (`trimIn`), where they play on the timeline: what the captions and the save read a line by.
 */
function expand(cells) {
  const out = [];
  for (const c of (cells || [])) {
    const m = c && normalizeMergeLines(c.merge);
    if (!m) { out.push(c); continue; }
    m.forEach((e, k) => e.pieces.forEach(([tin, dur, at], q) => out.push({ ...c, id: c.id + '~' + k + '_' + q, merge: undefined, merged: true,
      frag: e.n || c.frag, voice: e.voice, start: r3((+c.start || 0) + at), dur, trimIn: tin, speed: 1 })));
  }
  return out;
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
    const lanes = Array.isArray(tracks) ? tracks : [];
    const a1 = (lanes.find((t) => t && t.id === 'a1') || {}).clips || [];
    const v1 = (lanes.find((t) => t && t.id === 'v1') || {}).clips || [];
    const mirror = a1.filter((c) => Number(c && c.frag) > 0);
    // Every line's pieces - a merged cell's lines spread out.
    const byVoice = new Map();
    for (const c of expand(mirror)) {
      if (!c.voice) continue;
      if (!byVoice.has(c.voice)) byVoice.set(c.voice, []);
      byVoice.get(c.voice).push(c);
    }
    const cells = MIRROR.cellsOf(proj);
    // The merges the timeline holds, on the first line of each - its lines still those takes, in that order.
    const merges = new Map();
    for (const c of mirror) {
      const m = normalizeMergeLines(c.merge);
      if (!m) continue;
      const k = cells.findIndex((x) => x.voice === m[0].voice);
      if (k < 0 || !m.every((e, q) => cells[k + q] && cells[k + q].voice === e.voice)) continue;
      const video = v1.some((x) => x.pairId && x.pairId === c.pairId);
      merges.set(cells[k].i, normalizeMerge({ src: c.src, dur: c.dur, video, lines: m.map((e, q) => ({ ...e, n: cells[k + q].n })) }));
    }
    const changes = [];
    for (const cell of cells) {
      const line = proj.lines[cell.i] || {};
      const change = {};
      const pieces = byVoice.get(cell.voice);
      if (pieces && pieces.length) {
        const list = derive(pieces, MIRROR.lineDurOf(cell));
        const want = list.length ? normalize({ voice: cell.voice, list }) : null;
        if (JSON.stringify(want) !== JSON.stringify(normalize(line.cuts))) change.cuts = want;
      }
      const wantM = merges.get(cell.i) || null;
      if (JSON.stringify(wantM) !== JSON.stringify(normalizeMerge(line.merge))) change.merge = wantM;
      if (Object.keys(change).length) changes.push([cell.i, change]);
    }
    if (!changes.length) return 0;
    PROJECTS.apply(projectId, (p) => {
      for (const [i, change] of changes) {
        if (!p.lines[i]) continue;
        for (const [k, v] of Object.entries(change)) { if (v) p.lines[i][k] = v; else delete p.lines[i][k]; }
      }
    });
    console.log('[line-cuts] ' + projectId + ': ' + changes.length + ' line(s) cut or merged differently now');
    return changes.length;
  } catch (e) {
    console.warn('[line-cuts] not read from the timeline:', e.message);
    return 0;
  }
}

module.exports = { normalize, cutsOf, piecesOf, derive, placer, fromTimeline, normalizeMerge, normalizeMergeLines, expand,
  SEAM_FADE, MIN_PIECE };
