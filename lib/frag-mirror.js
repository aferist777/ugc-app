'use strict';

// ════════════════════════════════════════════════════════════════════════════
// THE TIMELINE AS A MIRROR OF THE SCRIPT (docs/local-app/PLAN.md, phase T').
//
// A talking head is not laid by hand: the workshop makes the reads, the frames and the clips of
// every line, and the cut of them is simply the lines in order. So the project's own timeline -
// `sv3_<project id>` - holds those cells and keeps them true, and the person edits everything
// else around them.
//
//   a line read, with a clip      a PAIR of the CLIP's own file: its picture on main video, its
//                                 own sound on main audio, as long as the read, the hallucinated
//                                 tail trimmed off. The clip replaces that line's sound cell
//   a line read, no clip yet      the read alone, on main audio. Nothing on the video lane: there
//                                 is no picture yet, and a frame held for five seconds is not one
//   a line not read yet           nothing. The lines after it close up (the owner's decision):
//                                 a gap for something that does not exist is not a cut
//   a line taken off (phase Z)    nothing, the same way: it is not in the video. It keeps its
//                                 place in the script and comes back with it
//
// THE ORDER IS THE SCRIPT'S, never the order things were made in: reading line 7 before line 3
// puts 7 after 3 on the timeline, because the cut is the script.
//
// WHOSE CELL IS WHOSE. Every cell this module lays carries `frag` - the number of its line
// (routes/mergev3.js, _clipOf). A rebuild removes the cells with `frag` from the two main lanes
// and lays them again; a cell without `frag` is the person's - dropped from the library, trimmed,
// moved - and is never touched, whichever lane it is on. That is the whole safety rule here, and
// it is why `frag` has to survive the normaliser.
//
// WHEN. After anything that changes what a line has: a read spoken, a clip filed, the words
// edited, the frame a line opens on changed (picked, switched off, reordered, a new set drawn),
// a take picked. The callers fire and forget - a mirror that could not be built must never fail
// the generation that prompted it.
//
// The loudness of the reads is levelled the way an import from Scenarios levels it: the quiet
// ones up to the loudest, measured on the read itself (lib/loudness.js).
//
// THE CAPTIONS OF A LINE (phase V30, block 1). Every sound cell carries `voice` - the address of what the line says
// (cellsOf) - and so does every page of the subtitle lane heard from it (lib/captions-job.js). Laying the cut again moves
// those pages with their cell, and takes away the pages of a take that is no longer in it (_followCells); a line that got
// a sound it did not have is heard by itself (lib/captions-auto.js).
// ════════════════════════════════════════════════════════════════════════════

//
// A LINE WITH CUTS (phase V44, lib/line-cuts.js): what cut silence took out of a line lives in the line (`cuts`, bound to its
// take), and the line is laid as the pieces of its file those cuts leave, end to end - a pair (or a sound) each, the sound
// fading 15 ms into and out of each seam; the lines after it close up. Its captions go with the whole line, first piece to last.

const fs = require('fs');
const path = require('path');
const MSTORE = require('./merge-store');
const LOUD = require('./loudness');
const PROJECTS = require('./projects-store');
const LC = require('./line-cuts');
const { toDisk } = require('./media');

const VOL_MAX = 4;                       // the ceiling the editor's own volume slider has
const r2 = (v) => Math.round(v * 100) / 100;

// The read a line is read BY, and whether it still says the line's words. The same rule the page
// and the counters use (public/js/merge-v3/scen-api.js, takeOf/isRead) - written here too because
// the server cannot import a browser module, and a second opinion about what "read" means would
// be a second video.
function _takeOf(line) {
  const audio = (line && line.audio) || {};
  const tagged = String((line && line.tagged) || '').trim();
  return tagged
    ? { take: audio.tagged || null, said: tagged }
    : { take: audio.plain || null, said: String((line && line.text) || '') };
}
function _readOf(line) {
  const { take, said } = _takeOf(line);
  return (take && take.path && take.said === said) ? take : null;
}

// The clip of a line: the one made from the frame the line OPENS on - picked by hand or given by
// the rule - made from the words the line says now and lipsynced to the read it has now (phase V23:
// a read again is another performance; a clip with no read recorded counts as fresh). A clip CHOSEN
// BY HAND (`chosen`, V23, the owner 2026-10-09) is the line's whatever it was made from - `stale`
// says so, and such a clip stands for its own length: its sound is its own, not the read's.
function _clipOf(line, frame, take) {
  const id = String((frame || {}).id || '');
  const variant = String((line && line.tagged) || '').trim() ? 'tagged' : 'plain';
  const takes = ((line && line.video) || {})[variant] || [];
  if (!takes.length) return null;
  const said = variant === 'tagged' ? String(line.tagged || '') : String(line.text || '');
  const isFresh = (c) => !!id && c.fromFrame === id && c.said === said && (!c.fromAudio || !take || c.fromAudio === take.path);
  const hand = String(((line.chosen || {})[variant]) || '');
  const chosen = hand ? takes.find(c => c && c.path && c.id === hand) : null;
  if (chosen) return isFresh(chosen) ? chosen : Object.assign({}, chosen, { stale: true });
  const fresh = takes.filter(c => c && c.path && isFresh(c));
  if (!fresh.length) return null;
  const picked = fresh.find(c => c.id === String(((line.pick || {})[variant]) || ''));
  return picked || fresh[fresh.length - 1];
}
// (phase V26.8, the owner 2026-10-13) THE TIMELINE LAYS THE CLIPS OF THE PROJECT'S MODE: a project filmed by Seedance
// keeps the Kling clips it had, and lays none of them - its lines lie as their reads until Seedance's own clips are made.
const _seedance = (proj) => require('./th-video').isSeedance(String(((proj && proj.video) || {}).model || ''));
// (the sixth round, the owner's answer (я6)) ...and filmed by its voice sample, its lines are not read at all: only the
// lines with their clip lie on the timeline, each with the clip's own sound; a line without one lies nowhere.
const _bySample = (proj) => _seedance(proj) && String(((proj && proj.video) || {}).sound || '') === 'sample';
// (phase V26.8, part 5) ...and when they ARE made: the lines with a Seedance clip (routes/scen3.js sdCuts), by line.
function _sdCutsOf(proj, SCEN, sd) {
  const cuts = sd && SCEN.sdCuts ? (SCEN.sdCuts(proj) || []) : [];
  return new Map(cuts.map(c => [c.line, c]));
}

// How long a line's cell is: the read's length - or a stale clip's own, which carries its own sound.
const _cellDur = (take, clip) => Math.max(0, +((clip && clip.stale && +clip.dur > 0) ? clip.dur : (take && take.dur)) || 0);
/** (phase V44) How long a line of cellsOf is uncut: a Seedance clip's speech, else the read's (or a stale clip's) length. */
const lineDurOf = (c) => (c && c.sd ? Math.max(0, +c.sd.len || 0) : _cellDur(c && c.take, c && c.clip));

// The words of a line without its performance tags - they are directions, not words. What the line SAYS, for the
// captions taken from the script (phase V30, block 1), and the start of it, for the cell's name.
const _saidOf = (line) => String((line && (line.tagged || line.text)) || '').replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim();
function _nameOf(line, n) {
  return _saidOf(line).slice(0, 120) || ('fragment ' + n);
}

/**
 * The lines in the cut, in order: what each one lays and what it SAYS. The one rule both the mirror and the captions
 * read (phase V30, block 1 - lib/captions-job.js hears a talking head line by line).
 *
 * `voice` - the address of the sound the line's cell speaks: a read speaks itself, and so does a Kling clip made on it
 * (lipsynced to that very read - the clip's sound IS the read, so a clip filed later is not heard again); a Seedance clip
 * voices the line itself, and a clip chosen by hand from another read stands with its own sound - those speak the clip.
 * The captions of a line carry the same address, which is how they find their cell when the cut is laid again: a line
 * put in moves the NUMBERS of the lines below it, never the file of a take.
 * @returns [{ i, n, take, frame, clip, sd, name, said, voice }] with `skipped` - lines not read yet or taken off
 */
function cellsOf(proj) {
  const id = String((proj && proj.id) || '');
  const lines = Array.isArray(proj && proj.lines) ? proj.lines : [];
  // The frame is the one the line opens on, by the project's own rule - the same one the page paints by
  // (routes/scen3.js, _framePool/_frameOfLine).
  const SCEN = require('../routes/scen3');
  const pool = SCEN.framePool ? SCEN.framePool(proj) : [];
  const spread = String(((proj && proj.video) || {}).spread || 'cycle');
  const sd = _seedance(proj);
  const sample = _bySample(proj);
  const cutAt = _sdCutsOf(proj, SCEN, sd);
  const cells = [];
  let skipped = 0;
  lines.forEach((line, i) => {
    if (line && line.removed) { skipped++; return; }   // taken off the script (phase Z): not in the cut
    const said = _saidOf(line);
    const cut = cutAt.get(i);
    if (cut) {
      cells.push({ i, n: i + 1, sd: cut, take: { path: cut.audio, dur: cut.dur }, frame: null, clip: cut.clip, name: _nameOf(line, i + 1),
        said, voice: cut.clip.path });
      return;
    }
    if (sample) return;                                 // (V26.8) by the voice sample: no clip, no cell
    const take = _readOf(line);
    if (!take) { skipped++; return; }
    const frame = SCEN.frameOfLine ? SCEN.frameOfLine(pool, line, i, spread, id) : null;
    const clip = sd ? null : _clipOf(line, frame, take);
    cells.push({ i, n: i + 1, take, frame, clip, name: _nameOf(line, i + 1), said, voice: (clip && clip.stale) ? clip.path : take.path });
  });
  cells.skipped = skipped;
  return cells;
}

// Bringing the quiet reads up to the loudest, exactly as an import does. Measured on the mp3 -
// what was generated is where the fault lives - and only for the reads that are in this cut.
async function _levels(paths) {
  const out = new Map();
  const ms = [];
  for (const p of paths) {
    let m = null;
    try { m = await LOUD.measure(toDisk(p)); } catch (e) { m = null; }
    ms.push({ p, m });
  }
  const loudest = ms.reduce((a, x) => (x.m && x.m.lufs != null && (a == null || x.m.lufs > a) ? x.m.lufs : a), null);
  for (const { p, m } of ms) {
    let vol = 1;
    if (m && loudest != null) {
      const db = LOUD.gainFor(m, loudest);
      vol = Math.round(Math.min(VOL_MAX, Math.pow(10, (db || 0) / 20)) * 1000) / 1000;
    }
    out.set(p, vol);
  }
  return out;
}

/**
 * Lay the script on its project's timeline again.
 * @param projectId  the scenarios project - its timeline is `sv3_<id>`
 * @param opts.project the project record, when the caller already has it in hand
 * @param opts.noHearing a lay that only catches up (an opened project behind its script, the captions' own run writing the
 *        voices): no line has a NEW take, so nothing is heard by itself - an old project is heard at its next take or press
 * @returns { key, cells, skipped } or null when there is nothing to mirror
 */
async function rebuild(projectId, opts) {
  const id = String(projectId || '').trim();
  if (!id) return null;
  const proj = (opts && opts.project) || PROJECTS.get(id);
  if (!proj) return null;
  const key = 'sv3_' + id;

  // What each line contributes, in order (cellsOf).
  const cells = cellsOf(proj);
  const skipped = cells.skipped;

  // Measured on the READ even for a line that has a clip: the mp3 is what was generated and where
  // the unevenness lives, and the clip's sound is that same take.
  //
  // MEASURED FIRST, and everything after it in ONE tick (phase K1). The timeline used to be read
  // before this await and written after it: whatever landed in those seconds - captions laid from
  // the sound, a page's save, a timeline made meanwhile - was overwritten by the copy read before,
  // and a timeline created meanwhile was deleted with its folder (lib/merge-store.js, write).
  const vol = await _levels(cells.map(c => c.take.path));

  const state = MSTORE.read();
  const timelines = state.timelines || {};
  const now = new Date().toISOString();
  const tl = timelines[key];
  // No timeline yet: the mirror makes one - the lanes every new timeline has (lib/timeline-shape.js: main video, main audio,
  // Subtitles - phase V41, the owner's (о11)).
  const fresh = tl || {
    title: now.slice(0, 10) + ' - ' + (String(proj.title || '').trim() || 'talking head'),
    createdAt: now, adv: null, owner: null, rev: 0, kind: 'blank', format: '9:16',
    tracks: require('./timeline-shape').emptyBlank().tracks,
  };
  const tracks = Array.isArray(fresh.tracks) ? fresh.tracks.map(t => ({ ...t, clips: [...(t.clips || [])] })) : [];
  const vLane = tracks.find(t => t.id === 'v1');
  const aLane = tracks.find(t => t.id === 'a1');
  if (!vLane || !aLane) return null;

  // The person's cells stay exactly where they are; only the mirror's are re-laid.
  const mineGone = (lane) => lane.clips.filter(c => !(Number(c && c.frag) > 0));
  const keptV = mineGone(vLane);
  const keptA = mineGone(aLane);

  const tag = id.slice(-6);
  const fx = { transition: null, animation: null, filter: null };
  const laidV = [];
  const laidA = [];
  let at = 0;
  // (phase V44) The lines' cuts as they are NOW: a save may have written them while the reads were measured.
  const nowProj = PROJECTS.get(id) || proj;
  // A line laid as the pieces of its file its cuts leave (lib/line-cuts.js) - the whole line when it has none: each piece a
  // pair (`v` and `a`) or a sound (`a` alone), the first keeping the line's ids, the sound fading at a seam a cut made.
  const lay = (c, dur, srcDur, half, v, a) => {
    for (const [k, [s, e]] of LC.piecesOf(dur, LC.cutsOf((nowProj.lines || [])[c.i], c.voice)).entries()) {
      const suf = k ? '_' + k : '';
      const piece = { ...half, start: r2(at), dur: r2(e - s), srcDur: r2(srcDur), trimIn: r2(s), trimOut: r2(Math.max(0, srcDur - e)),
        pairId: half.pairId ? half.pairId + suf : null };
      if (v) laidV.push({ ...piece, ...v, id: v.id + suf });
      laidA.push({ ...piece, ...a, id: a.id + suf,
        ...(s > 0.0005 ? { fadeIn: LC.SEAM_FADE } : {}), ...(e < dur - 0.0005 ? { fadeOut: LC.SEAM_FADE } : {}) });
      at += e - s;
    }
  };
  for (let ci = 0; ci < cells.length; ci++) {
    const c = cells[ci];
    // (phase V45) LINES MERGED INTO ONE FILE, from this one on (lib/line-cuts.js): ONE cell - a pair when it was made from
    // pictures, a sound when from reads alone - for as long as the lines are still those takes, one after another.
    const m = LC.normalizeMerge(((nowProj.lines || [])[c.i] || {}).merge);
    if (m && m.lines.every((e, q) => cells[ci + q] && cells[ci + q].voice === e.voice)) {
      const half = { name: 'merged · ' + m.lines.length + ' lines', libId: null, frag: c.n, start: r2(at), dur: r2(m.dur), srcDur: r2(m.dur),
        trimIn: 0, trimOut: 0, speed: 1, reversed: false, ...fx, pairId: m.video ? 'pm' + tag + '_' + c.n + '_m' : null };
      if (m.video) laidV.push({ ...half, id: 'smv' + tag + '_' + c.n + '_m', src: m.src, poster: null, thumb: null, volume: 0 });
      laidA.push({ ...half, id: 'sma' + tag + '_' + c.n + '_m', src: m.src, poster: null, thumb: null, volume: 1,
        merge: m.lines.map((e, q) => ({ ...e, n: cells[ci + q].n })) });
      at += m.dur;
      ci += m.lines.length - 1;
      continue;
    }
    // (phase V26.8, part 5) A LINE'S SEEDANCE CLIP: the picture muted, and under it the clip's own sound - Seedance
    // voiced the line itself - as a pair.
    if (c.sd) {
      const dur = c.sd.len;
      if (!(dur > 0)) continue;
      const srcDur = Math.max(dur, +c.clip.dur || dur);
      const half = { name: c.name, libId: null, frag: c.n, speed: 1, reversed: false, ...fx, pairId: 'pm' + tag + '_' + c.n };
      lay(c, dur, srcDur, half,
        { id: 'smv' + tag + '_' + c.n, src: c.clip.path, poster: null, thumb: c.clip.thumb || null, volume: 0 },
        { id: 'sma' + tag + '_' + c.n, src: c.clip.path, poster: null, thumb: null, volume: 1, voice: c.voice });
      continue;
    }
    const dur = _cellDur(c.take, c.clip);
    if (!(dur > 0)) continue;
    const srcDur = c.clip ? Math.max(dur, +c.clip.dur || dur) : dur;
    const level = vol.get(c.take.path) != null ? vol.get(c.take.path) : 1;
    // Past the end of the speech a lipsync clip keeps moving with nothing to say: that tail is left off (trimOut). A read
    // has no tail at all.
    const half = { name: c.name, libId: null, frag: c.n, speed: 1, reversed: false, ...fx, pairId: c.clip ? ('pm' + tag + '_' + c.n) : null };
    if (c.clip) {
      // THE CLIP COMES WITH ITS OWN SOUND (the owner, 2026-09-22): both halves are the one file,
      // the picture muted and the sound heard, and that pair stands where the read's cell stood.
      lay(c, dur, srcDur, half,
        { id: 'smv' + tag + '_' + c.n, src: c.clip.path, poster: null, thumb: c.clip.thumb || null, volume: 0 },
        { id: 'sma' + tag + '_' + c.n, src: c.clip.path, poster: null, thumb: null, volume: level, voice: c.voice });
    } else {
      // No clip yet: the read alone. Nothing is laid on the video lane - there is no picture of
      // this line yet, and the frame is not one (the owner, 2026-09-22).
      lay(c, dur, srcDur, half, null,
        { id: 'sma' + tag + '_' + c.n, src: c.take.path, poster: null, thumb: null, volume: level, voice: c.voice });
    }
  }
  const oldA = aLane.clips.filter(c => Number(c && c.frag) > 0);
  _carryLook(vLane.clips.filter(c => Number(c && c.frag) > 0), laidV);
  vLane.clips = keptV.concat(laidV);
  aLane.clips = keptA.concat(laidA);
  const caps = _followCells(tracks, oldA, laidA);

  timelines[key] = {
    ...fresh,
    tracks,
    rev: (Number(fresh.rev) || 0) + 1,
    updatedAt: now,
  };
  MSTORE.write({ version: (Number(state.version) || 0) + 1, updatedAt: now, timelines, hidden: state.hidden, snapshots: state.snapshots });
  console.log('[frag-mirror] ' + key + ': ' + laidA.length + ' cells (' + laidV.length + ' with a clip)'
    + (skipped ? ', ' + skipped + ' line(s) not read yet' : '')
    + (caps.moved || caps.gone ? ', captions: ' + caps.moved + ' moved, ' + caps.gone + ' gone' : '') + ', rev ' + timelines[key].rev);
  // A line has a sound it did not have - a read, a Seedance clip, a read at a new speed, a line put back: its captions are
  // heard by themselves a moment later (lib/captions-auto.js). A frame picked, or a Kling clip filed on the same read, is not.
  if (!(opts && opts.noHearing) && _newVoice(LC.expand(oldA), LC.expand(laidA))) require('./captions-auto').kick(id);
  return { key, cells: laidA.length, clips: laidV.length, skipped };
}

// ── The look the person gave a line's picture stays with it (phase V51, the owner's (пр53)) ──
// A line's cells are laid anew every time (a new take, its words, its frame, its cuts), and whatever the person set on the
// picture of one - Fit / Fill and the side kept, a crop, a PiP and its edges, a placement, a Halfer band - went with the old
// cell. It is carried onto the new one: from the old cell of the same id (the same piece of the same line - the ids are the
// line's number and the piece's), else from the line's first old picture cell, else nothing. The face path (`frame`) only
// while the file is the same: it is a path over THAT file's seconds. The cell's own timing, file, sound and ids are the
// mirror's, never carried. The fields are the picture's of lib/timeline-shape.js.
const LOOK = ['fit', 'cropAlign', 'crop', 'pip', 'tx', 'ty', 'tw', 'angle', 'feather', 'radius', 'outline', 'outlineColor',
  'halfer', 'halferPos', 'halferThick', 'halferKeep', 'rotation'];
const _copy = (v) => (v && typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : v);
function _carryLook(oldV, laidV) {
  if (!oldV.length) return;
  const byId = new Map(oldV.map(c => [String(c.id), c]));
  for (const c of laidV) {
    const was = byId.get(String(c.id)) || oldV.find(o => Number(o.frag) === Number(c.frag));
    if (!was) continue;
    for (const k of LOOK) if (was[k] != null) c[k] = _copy(was[k]);
    if (was.frame && was.src === c.src) c.frame = _copy(was.frame);
  }
}

// ── The captions of a line go with it (phase V30, block 1) ──────────────────
// A page of the subtitle lane laid from a line carries the line's `voice` (lib/captions-job.js). In the same tick the cut is
// laid again, such a page moves by as much as its cell did - a shift the person gave it by hand stays - and never runs past
// the cell's end; a page whose cell is gone (the line read again, its words changed, taken off) goes, corrected or not: its
// words were that take's. Typed lines and pages without a voice are the person's and stay where they are. Changes `tracks`.
// (phase V44) A line cut into pieces is ONE span here - its first piece's start to its last piece's end; (phase V45) the lines
// of a merged cell each their own span inside it.
function _spans(cells) {
  const out = new Map();
  for (const c of LC.expand(cells)) {
    if (!c || !c.voice) continue;
    const s = +c.start || 0, e = s + (+c.dur || 0);
    const was = out.get(c.voice);
    out.set(c.voice, was ? { start: Math.min(was.start, s), end: Math.max(was.end, e) } : { start: s, end: e });
  }
  return out;
}
function _followCells(tracks, oldA, laidA) {
  const subs = tracks.find(t => t && t.kind === 'subs');
  const out = { moved: 0, gone: 0 };
  if (!subs || !(subs.clips || []).some(c => c && c.voice)) return out;
  const was = _spans(oldA);
  const now = _spans(laidA);
  const next = [];
  for (const p of subs.clips) {
    if (!p || !p.voice) { next.push(p); continue; }
    const cell = now.get(p.voice);
    if (!cell) { out.gone++; continue; }
    const old = was.get(p.voice);
    const start = r2(Math.max(0, (+p.start || 0) + (old ? cell.start - old.start : 0)));
    let dur = +p.dur || 0;
    const end = cell.end;
    if (start < end && start + dur > end + 0.005) dur = Math.max(0.1, r2(end - start));
    if (start === +p.start && dur === +p.dur) { next.push(p); continue; }
    out.moved++;
    next.push({ ...p, start, dur });
  }
  if (out.moved || out.gone) subs.clips = next.sort((a, b) => (+a.start || 0) - (+b.start || 0));
  return out;
}

// Did the cut gain a sound? A cell laid before the voices were written has none: it is known by its line and its file.
function _newVoice(oldA, laidA) {
  const had = new Set();
  for (const c of oldA) {
    if (c.voice) { had.add(c.voice); continue; }
    const same = laidA.find(x => x.frag === c.frag && x.src === c.src);
    had.add(same ? same.voice : c.src);
  }
  return laidA.some(c => c.voice && !had.has(c.voice));
}

/** Fire and forget: a mirror that could not be built must never fail the work that prompted it. */
function touch(projectId, opts) {
  Promise.resolve()
    .then(() => rebuild(projectId, opts))
    .catch(e => console.warn('[frag-mirror] could not re-lay ' + projectId + ':', e.message));
}

// ── Catching up with what was already made ──────────────────────────────────
// The mirror re-lays on events - a read, a clip, an edit - and a project finished BEFORE it
// existed has no event left to give: it would sit there with a full script and an empty timeline
// (the owner's, 2026-09-21, is exactly that). So opening a project asks this, and it rebuilds only
// when what lies on the two main lanes is not what the lines say it should be.
//
// Cheap on purpose: one timeline file, one pass over the lines, no loudness measured unless a
// rebuild actually happens.
function _wantSig(proj) {
  // The same cells the mirror lays (cellsOf) - a taken-off line is not in them, and the signature agrees with it; a line
  // with cuts (phase V44) as its pieces.
  const out = [];
  const cells = cellsOf(proj);
  for (let ci = 0; ci < cells.length; ci++) {
    const c = cells[ci];
    // (phase V45) Lines merged, still those takes in a row: one cell.
    const m = LC.normalizeMerge((proj.lines[c.i] || {}).merge);
    if (m && m.lines.every((e, q) => cells[ci + q] && cells[ci + q].voice === e.voice)) {
      out.push(c.n + ':' + m.src + ':' + (Math.round(m.dur * 100) / 100));
      ci += m.lines.length - 1;
      continue;
    }
    const src = c.sd ? c.clip.path : (c.clip ? c.clip.path : c.take.path);
    const dur = lineDurOf(c);
    if (!(dur > 0)) continue;
    for (const [s, e] of LC.piecesOf(dur, LC.cutsOf(proj.lines[c.i], c.voice))) out.push(c.n + ':' + src + ':' + (Math.round((e - s) * 100) / 100));
  }
  return out.join('|');
}
function _haveSig(key) {
  let doc = null;
  try {
    const at = MSTORE.locate(key);
    if (!at) return null;
    const { PROJECTS_DIR } = require('./config');
    doc = JSON.parse(fs.readFileSync(path.join(PROJECTS_DIR, at.folder, 'merge', at.file), 'utf8'));
  } catch (e) { return null; }
  const lanes = Array.isArray(doc && doc.tracks) ? doc.tracks : [];
  const a1 = (lanes.find(t => t.id === 'a1') || {}).clips || [];
  return a1.filter(c => Number(c && c.frag) > 0).slice().sort((x, y) => (+x.start || 0) - (+y.start || 0))
    .map(c => c.frag + ':' + c.src + ':' + (Math.round((+c.dur || 0) * 100) / 100)).join('|');
}

/** Lay it again only if it is out of date - the question an opening project asks. */
function catchUp(projectId, opts) {
  const id = String(projectId || '').trim();
  if (!id) return;
  const proj = (opts && opts.project) || PROJECTS.get(id);
  if (!proj || !Array.isArray(proj.lines) || !proj.lines.length) return;
  let want = '';
  try { want = _wantSig(proj); } catch (e) { return; }
  if (!want) return;                                  // nothing read yet: nothing to lay
  const have = _haveSig('sv3_' + id);
  if (have === want) return;
  console.log('[frag-mirror] ' + id + ': the timeline is behind the script, laying it again');
  // Opening a project is no new take: its captions are heard at the next one, or a press (phase V30, block 1).
  touch(id, { project: proj, noHearing: true });
}

// (phase V26.8) The read a line is read by, for the lines of a Seedance talking head (routes/scen3.js _sdView).
module.exports = { rebuild, touch, catchUp, readOf: _readOf, cellsOf, lineDurOf, _followCells, _newVoice };
