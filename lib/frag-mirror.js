'use strict';

// ════════════════════════════════════════════════════════════════════════════
// THE TIMELINE AS A MIRROR OF THE SCRIPT.
//
// A talking head is not laid by hand: the workshop makes the reads, the frames and the clips of
// every line, and the cut of them is simply the lines in order. So the project's own timeline -
// `sv3_<project id>` - holds those cells and keeps them true, and the person edits everything
// else around them.
//
//   a line read, with a clip      a PAIR of the CLIP's own file: its picture on main video, its
//                                 own sound on main audio, as long as the read, the hallucinated
//                                 tail trimmed off. The clip replaces that line's sound cell
//   a line read, no clip yet      nothing: a talking head's cut is its pictures; the lines after
//                                 it close up
//   a line not read yet           nothing. The lines after it close up:
//                                 a gap for something that does not exist is not a cut
//   a line taken off              nothing, the same way: it is not in the video. It keeps its
//                                 place in the script and comes back with it
//
// THE ORDER IS THE SCRIPT'S, never the order things were made in: reading line 7 before line 3
// puts 7 after 3 on the timeline, because the cut is the script.
//
// WHOSE CELL IS WHOSE. Every cell this module lays carries `frag` - the number of its line
// (lib/timeline-shape.js keeps it). A rebuild removes the cells with `frag` from the two main lanes
// and lays them again; a cell without `frag` is the person's - dropped from the library, trimmed,
// moved - and is never touched, whichever lane it is on. That is the whole safety rule here, and
// it is why `frag` has to survive the normaliser.
// Two exceptions (_plan): a cell of an older send that the mirror lays again goes (lib/timeline-twins.js),
// and a line not on the timeline yet is not laid where the person's sound on main audio already holds it.
//
// WHEN. After anything that changes what a line has: a read spoken, a clip filed, the words
// edited, the frame a line opens on changed (picked, switched off, reordered, a new set drawn),
// a take picked. The callers fire and forget - a mirror that could not be built must never fail
// the generation that prompted it.
//
// The loudness of the reads is levelled: the quiet ones up to the loudest, measured on the read
// itself (lib/loudness.js).
//
// THE CAPTIONS OF A LINE. Every sound cell carries `voice` - the address of what the line says
// (cellsOf) - and so does every page of the subtitle lane heard from it (lib/captions-job.js). Laying the cut again moves
// those pages with their cell, and takes away the pages of a take that is no longer in it (_followCells); a line that got
// a sound it did not have is heard by itself (lib/captions-auto.js).
// ════════════════════════════════════════════════════════════════════════════

//
// A LINE WITH CUTS (lib/line-cuts.js): what cut silence took out of a line lives in the line (`cuts`, bound to its
// take), and the line is laid as the pieces of its file those cuts leave, end to end - a pair (or a sound) each, the sound
// fading 15 ms into and out of each seam; the lines after it close up. Its captions go with the whole line, first piece to last.

const fs = require('fs');
const path = require('path');
const MSTORE = require('./merge-store');
const LOUD = require('./loudness');
const PROJECTS = require('./projects-store');
const LC = require('./line-cuts');
const TWINS = require('./timeline-twins');
const { toDisk } = require('./media');
// The interface's words (lib/i18n.js): the names the mirror gives a cell or a new timeline.
const I18N = require('./i18n');

const VOL_MAX = 4;                       // the ceiling the editor's own volume slider has
const r2 = (v) => Math.round(v * 100) / 100;

// The read a line is read BY, and whether it still says the line's words. The same rule the page
// uses (public/js/merge-v3/scen-api.js, takeOf/isRead) - written here too because
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
// the rule - made from the words the line says now and lipsynced to the read it has now (a read
// again is another performance; a clip with no read recorded counts as fresh). A clip CHOSEN
// BY HAND (`chosen`) is the line's whatever it was made from - `stale`
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
// How long a line's cell is: the read's length - or a stale clip's own, which carries its own sound.
const _cellDur = (take, clip) => Math.max(0, +((clip && clip.stale && +clip.dur > 0) ? clip.dur : (take && take.dur)) || 0);
/** How long a line of cellsOf is uncut: the read's (or a stale clip's) length. */
const lineDurOf = (c) => _cellDur(c && c.take, c && c.clip);

// The words of a line without its performance tags - they are directions, not words. What the line SAYS, for the
// captions taken from the script, and the start of it, for the cell's name.
const _saidOf = (line) => String((line && (line.tagged || line.text)) || '').replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim();
function _nameOf(line, n) {
  return _saidOf(line).slice(0, 120) || ('fragment ' + n);
}

/**
 * The lines in the cut, in order: what each one lays and what it SAYS. The one rule both the mirror and the captions
 * read (lib/captions-job.js hears a talking head line by line).
 *
 * `voice` - the address of the sound the line's cell speaks: a read speaks itself, and so does a Kling clip made on it
 * (lipsynced to that very read - the clip's sound IS the read, so a clip filed later is not heard again); a clip chosen by
 * hand from another read stands with its own sound - it speaks the clip.
 * The captions of a line carry the same address, which is how they find their cell when the cut is laid again: a line
 * put in moves the NUMBERS of the lines below it, never the file of a take.
 * @returns [{ i, n, take, frame, clip, name, said, voice }] with `skipped` - lines not read yet, without a clip, or
 *   taken off
 */
function cellsOf(proj) {
  const id = String((proj && proj.id) || '');
  const lines = Array.isArray(proj && proj.lines) ? proj.lines : [];
  // The frame is the one the line opens on, by the project's own rule - the same one the page paints by
  // (routes/scen3.js, _framePool/_frameOfLine).
  const SCEN = require('../routes/scen3');
  const pool = SCEN.framePool ? SCEN.framePool(proj) : [];
  const spread = String(((proj && proj.video) || {}).spread || 'cycle');
  // A voiceover's reads are its picture's timing: no model, no clips.
  const voiceover = String((proj && proj.type) || '') === 'voiceover';
  const cells = [];
  let skipped = 0;
  lines.forEach((line, i) => {
    if (line && line.removed) { skipped++; return; }   // taken off the script: not in the cut
    const said = _saidOf(line);
    const take = _readOf(line);
    if (!take) { skipped++; return; }
    // A VOICEOVER has no clips: every read lies as sound, end to end, in the script's order.
    if (voiceover) { cells.push({ i, n: i + 1, take, frame: null, clip: null, name: _nameOf(line, i + 1), said, voice: take.path }); return; }
    // A READ WITHOUT ITS CLIP LIES
    // NOWHERE: a talking head's timeline holds the lines that have their picture - a line without a take filmed on it
    // (a stale one, or one chosen by hand, still lies). The lines
    // after it close up, as after a line not read yet. Read lines laid as sound alone are the voiceover project's.
    const frame = SCEN.frameOfLine ? SCEN.frameOfLine(pool, line, i, spread, id) : null;
    const clip = _clipOf(line, frame, take);
    if (!clip) { skipped++; return; }
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

// Where every line goes, in the script's order, end to end: the cells the mirror lays on main video (`laidV`)
// and main audio (`laidA`), before anything on the timeline is looked at. `vol` - each read's level (_levels); `tag` - the
// last six of the project's id, in every id.
function _layout(cells, nowProj, vol, tag) {
  const laidV = [];
  const laidA = [];
  let at = 0;
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
    // LINES MERGED INTO ONE FILE, from this one on (lib/line-cuts.js): ONE cell - a pair when it was made from
    // pictures, a sound when from reads alone - for as long as the lines are still those takes, one after another.
    const m = LC.normalizeMerge(((nowProj.lines || [])[c.i] || {}).merge);
    if (m && m.lines.every((e, q) => cells[ci + q] && cells[ci + q].voice === e.voice)) {
      const half = { name: I18N.tn(m.lines.length, 'merged · {n} lines', 'merged · {n} lines'), libId: null, frag: c.n, start: r2(at), dur: r2(m.dur), srcDur: r2(m.dur),
        trimIn: 0, trimOut: 0, speed: 1, reversed: false, pairId: m.video ? 'pm' + tag + '_' + c.n + '_m' : null };
      if (m.video) laidV.push({ ...half, id: 'smv' + tag + '_' + c.n + '_m', src: m.src, thumb: null, volume: 0 });
      laidA.push({ ...half, id: 'sma' + tag + '_' + c.n + '_m', src: m.src, thumb: null, volume: 1,
        merge: m.lines.map((e, q) => ({ ...e, n: cells[ci + q].n })) });
      at += m.dur;
      ci += m.lines.length - 1;
      continue;
    }
    const dur = _cellDur(c.take, c.clip);
    if (!(dur > 0)) continue;
    const srcDur = c.clip ? Math.max(dur, +c.clip.dur || dur) : dur;
    const level = vol.get(c.take.path) != null ? vol.get(c.take.path) : 1;
    // Past the end of the speech a lipsync clip keeps moving with nothing to say: that tail is left off (trimOut). A read
    // has no tail at all.
    const half = { name: c.name, libId: null, frag: c.n, speed: 1, reversed: false, pairId: c.clip ? ('pm' + tag + '_' + c.n) : null };
    if (c.clip) {
      // THE CLIP COMES WITH ITS OWN SOUND: both halves are the one file,
      // the picture muted and the sound heard, and that pair stands where the read's cell stood.
      lay(c, dur, srcDur, half,
        { id: 'smv' + tag + '_' + c.n, src: c.clip.path, thumb: c.clip.thumb || null, volume: 0 },
        { id: 'sma' + tag + '_' + c.n, src: c.clip.path, thumb: null, volume: level, voice: c.voice });
    } else {
      // No clip yet: the read alone. Nothing is laid on the video lane - there is no picture of
      // this line yet, and the frame is not one.
      lay(c, dur, srcDur, half, null,
        { id: 'sma' + tag + '_' + c.n, src: c.take.path, thumb: null, volume: level, voice: c.voice });
    }
  }
  return { laidV, laidA };
}

// ── What a lay puts on the main lanes ──
// A talking head's timeline may already hold its lines' sound on main audio as cells of the person's - the cells of an
// older send (`sg…`), a merge of lines laid as the person's cell; laid over them, the voice would sound twice. So a lay
// looks at the timeline first:
//   - THE OLD SEND'S CELLS IT LAYS AGAIN go (lib/timeline-twins.js twinsOf: the same file on the same main lane, over the
//     same time; a pair whole or not at all) - in the lay itself, not only at the next start, the timeline copied first;
//   - A LINE THE PERSON'S SOUND ALREADY HOLDS is not laid: a line that is not on the timeline now, where the person's
//     audible cells on main audio (not the mirror's, not a twin that goes) cover at least half of its stretch. Its time
//     stays its own - the lines after it lie where the cut puts them -, so the person's cell keeps its place in the cut.
//     A line ON the timeline now is laid as always, whatever lies over it.
// Settled together: the twins against what is laid, what is held against the person's cells left - until nothing moves.
const HOLD = 0.5;
const _isMirror = (c) => Number(c && c.frag) > 0;
const _addr = (s) => String(s || '').split(/[?#]/)[0];
const _count = (m) => [...((m && m.values()) || [])].reduce((n, s) => n + s.size, 0);
// How much of [s, e] the cells cover, each counted once.
function _covered(cells, s, e) {
  const ws = cells.map(c => [Math.max(s, +c.start || 0), Math.min(e, (+c.start || 0) + (+c.dur || 0))]).filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0]);
  let n = 0, to = s;
  for (const [a, b] of ws) { if (b > to) { n += b - Math.max(a, to); to = b; } }
  return n;
}
/**
 * The lay on these lanes: { laidV, laidA } the mirror's cells, { keptV, keptA } the person's that stay, `held` the numbers of
 * the lines the person's sound holds, `twins` the old send's cells that go (Map lane -> Set of ids). `tracks` - the
 * timeline's lanes as they are now ([] for a timeline not made yet). Changes nothing.
 */
function _plan(cells, nowProj, vol, tag, tracks) {
  const full = _layout(cells, nowProj, vol, tag);
  const lanes = Array.isArray(tracks) ? tracks.filter(t => t && Array.isArray(t.clips)) : [];
  const laneOf = (id) => (lanes.find(t => t.id === id) || { clips: [] }).clips;
  const keptV0 = laneOf('v1').filter(c => !_isMirror(c));
  const keptA0 = laneOf('a1').filter(c => !_isMirror(c));
  // On the timeline now: the lines its mirror cells speak - a cell without `voice` by its line's number.
  const nowA = LC.expand(laneOf('a1').filter(_isMirror));
  const voices = new Set(nowA.filter(c => c.voice).map(c => c.voice));
  const bare = new Set(nowA.filter(c => !c.voice).map(c => Number(c.frag)));
  // Each line as laid - a merged run is one, by its first line: its stretch, its takes.
  const lines = new Map();
  for (const c of full.laidA) {
    const n = Number(c.frag);
    const g = lines.get(n) || { s: Infinity, e: -Infinity, voices: [] };
    g.s = Math.min(g.s, +c.start || 0);
    g.e = Math.max(g.e, (+c.start || 0) + (+c.dur || 0));
    for (const x of (Array.isArray(c.merge) ? c.merge : [c])) if (x && x.voice) g.voices.push(x.voice);
    lines.set(n, g);
  }
  const there = (n, g) => g.voices.some(v => voices.has(v)) || bare.has(n);
  const audible = (c) => !!(c && c.src) && !(c.volume != null && !(+c.volume > 0));
  let held = new Set();
  let out = null;
  for (let round = 0; round < 10; round++) {
    const laidV = full.laidV.filter(c => !held.has(Number(c.frag)));
    const laidA = full.laidA.filter(c => !held.has(Number(c.frag)));
    const twins = TWINS.twinsOf({ tracks: lanes.map(t => (t.id === 'v1' ? { ...t, clips: keptV0.concat(laidV) }
      : t.id === 'a1' ? { ...t, clips: keptA0.concat(laidA) } : t)) });
    const goneV = twins.get('v1') || new Set();
    const goneA = twins.get('a1') || new Set();
    out = { laidV, laidA, held, twins, keptV: keptV0.filter(c => !goneV.has(c.id)), keptA: keptA0.filter(c => !goneA.has(c.id)) };
    const theirs = out.keptA.filter(audible);
    const next = new Set();
    for (const [n, g] of lines) if (g.e > g.s && !there(n, g) && _covered(theirs, g.s, g.e) >= HOLD * (g.e - g.s)) next.add(n);
    if (next.size === held.size && [...next].every(n => held.has(n))) break;
    held = next;
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
  // MEASURED FIRST, and everything after it in ONE tick. A timeline read before this await and
  // written after it would lose whatever landed in those seconds - captions laid from the sound, a
  // page's save, a timeline made meanwhile - to the copy read before, and a timeline created
  // meanwhile would be deleted with its folder (lib/merge-store.js, write).
  const vol = await _levels(cells.map(c => c.take.path));

  const state = MSTORE.read();
  const timelines = state.timelines || {};
  const now = new Date().toISOString();
  const tl = timelines[key];
  // No timeline yet: the mirror makes one - the lanes every new timeline has (lib/timeline-shape.js: main video, main audio,
  // Subtitles).
  const fresh = tl || {
    title: now.slice(0, 10) + ' - ' + (String(proj.title || '').trim() || I18N.t('talking head')),
    createdAt: now, adv: null, rev: 0, kind: 'blank', format: '9:16',
    tracks: require('./timeline-shape').emptyBlank().tracks,
  };
  const tracks = Array.isArray(fresh.tracks) ? fresh.tracks.map(t => ({ ...t, clips: [...(t.clips || [])] })) : [];
  const vLane = tracks.find(t => t.id === 'v1');
  const aLane = tracks.find(t => t.id === 'a1');
  if (!vLane || !aLane) return null;

  // The lines' cuts as they are NOW: a save may have written them while the reads were measured.
  const nowProj = PROJECTS.get(id) || proj;
  // The person's cells stay exactly where they are; only the mirror's are re-laid - less the lines the person's own sound on
  // main audio already holds, and without the old send's cells it lays again (_plan).
  const plan = _plan(cells, nowProj, vol, id.slice(-6), tracks);
  const laidV = plan.laidV;
  const laidA = plan.laidA;
  const oldA = aLane.clips.filter(_isMirror);
  _carryLook(vLane.clips.filter(_isMirror), laidV);
  _carryPitch(oldA, laidA);
  const twins = _count(plan.twins);
  // The timeline as it was, before the old send's cells go (lib/timeline-twins.js keep) - written in this same tick.
  if (twins && tl) TWINS.keep(MSTORE.locate(key), { log: (m) => console.log(m) });
  vLane.clips = plan.keptV.concat(laidV);
  aLane.clips = plan.keptA.concat(laidA);
  _followCells(tracks, oldA, laidA);

  timelines[key] = {
    ...fresh,
    tracks,
    rev: (Number(fresh.rev) || 0) + 1,
    updatedAt: now,
  };
  MSTORE.write({ version: (Number(state.version) || 0) + 1, updatedAt: now, timelines });
  // A line has a sound it did not have - a read, a read at a new speed, a line put back: its captions are
  // heard by themselves a moment later (lib/captions-auto.js). A frame picked, or a Kling clip filed on the same read, is not.
  if (!(opts && opts.noHearing) && _newVoice(LC.expand(oldA), LC.expand(laidA))) require('./captions-auto').kick(id);
  // A voiceover's B-roll follows its voice: a line read again, taken off or put back moves its sentences.
  if (String(proj.type || '') === 'voiceover') { try { require('./broll').relay(id); } catch (e) { /* its own trouble */ } }
  return { key, cells: laidA.length, clips: laidV.length, skipped };
}

// ── The look the person gave a line's picture stays with it ──
// A line's cells are laid anew every time (a new take, its words, its frame, its cuts), and whatever the person set on the
// picture of one - Fit / Fill and the side kept, a crop, a PiP and its edges, a placement, a Halfer band - would go with the
// old cell. It is carried onto the new one: from the old cell of the same id (the same piece of the same line - the ids are the
// line's number and the piece's), else from the line's first old picture cell, else nothing. The face path (`frame`) only
// while the file is the same: it is a path over THAT file's seconds. The cell's own timing, file, sound and ids are the
// mirror's, never carried. The fields are the picture's of lib/timeline-shape.js.
const LOOK = ['fit', 'cropAlign', 'crop', 'pip', 'tx', 'ty', 'tw', 'angle', 'feather', 'radius', 'outline', 'outlineColor', 'color',
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
    // Its effects too, while the file is the same: they stand on the file's seconds (public/js/fx/params.js).
    if (Array.isArray(was.fx) && was.fx.length && was.src === c.src) c.fx = _copy(was.fx);
  }
}

// ── A line's pitch stays with it ──
// A new take, the line read again, the cut laid anew: the pitch the person gave a line's sound (public/js/sound/pitch.js) is
// carried onto its new cell - from the old cell of the same id, else from the line's first old sound cell. A line that had no
// cell takes THE VOICE'S pitch when every old sound cell of the mirror had one and the same (main audio's pitch set for the
// lane): the voice of the project stays one voice. The level is not carried - the mirror evens it.
function _carryPitch(oldA, laidA) {
  if (!oldA.length || !oldA.some(c => c && c.pitch)) return;
  const byId = new Map(oldA.map(c => [String(c.id), c]));
  const key = (c) => JSON.stringify((c && c.pitch) || null);
  const one = oldA.every(c => key(c) === key(oldA[0])) ? oldA[0].pitch : null;
  for (const c of laidA) {
    const was = byId.get(String(c.id)) || oldA.find(o => Number(o.frag) === Number(c.frag));
    const p = was ? was.pitch : one;
    if (p) c.pitch = _copy(p);
  }
}

// ── The captions of a line go with it ──────────────────────────────────────
// A page of the subtitle lane laid from a line carries the line's `voice` (lib/captions-job.js). In the same tick the cut is
// laid again, such a page moves by as much as its cell did - a shift the person gave it by hand stays - and never runs past
// the cell's end; a page whose cell is gone (the line read again, its words changed, taken off) goes, corrected or not: its
// words were that take's. Typed lines and pages without a voice are the person's and stay where they are. Changes `tracks`.
// A line cut into pieces is ONE span here - its first piece's start to its last piece's end; the lines
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

// Did the cut gain a sound? A cell without `voice` is known by its line and its file.
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
// The mirror re-lays on events - a read, a clip, an edit - and a project whose timeline is behind
// its lines has no event left to give: it would sit there with a full script and an empty timeline.
// So opening a project asks this, and it rebuilds only
// when what lies on the two main lanes is not what the lines say it should be.
//
// Cheap on purpose: one timeline file, one pass over the lines, no loudness measured unless a
// rebuild actually happens.
function _wantSig(proj) {
  // The same cells the mirror lays (cellsOf) - a taken-off line is not in them, and the signature agrees with it; a line
  // with cuts as its pieces.
  const out = [];
  const cells = cellsOf(proj);
  for (let ci = 0; ci < cells.length; ci++) {
    const c = cells[ci];
    // Lines merged, still those takes in a row: one cell.
    const m = LC.normalizeMerge((proj.lines[c.i] || {}).merge);
    if (m && m.lines.every((e, q) => cells[ci + q] && cells[ci + q].voice === e.voice)) {
      out.push(c.n + ':' + m.src + ':' + (Math.round(m.dur * 100) / 100));
      ci += m.lines.length - 1;
      continue;
    }
    const src = c.clip ? c.clip.path : c.take.path;
    const dur = lineDurOf(c);
    if (!(dur > 0)) continue;
    for (const [s, e] of LC.piecesOf(dur, LC.cutsOf(proj.lines[c.i], c.voice))) out.push(c.n + ':' + src + ':' + (Math.round((e - s) * 100) / 100));
  }
  return out.join('|');
}
// The timeline's file as it is on the disk, or null.
function _docOf(key) {
  try {
    const at = MSTORE.locate(key);
    if (!at) return null;
    const { PROJECTS_DIR } = require('./config');
    return JSON.parse(fs.readFileSync(path.join(PROJECTS_DIR, at.folder, 'merge', at.file), 'utf8'));
  } catch (e) { return null; }
}
const _a1Of = (doc) => ((Array.isArray(doc && doc.tracks) ? doc.tracks : []).find(t => t && t.id === 'a1') || {}).clips || [];
// The mirror's cells of main audio, in time: line, file, length.
function _sigOf(a1) {
  return a1.filter(_isMirror).slice().sort((x, y) => (+x.start || 0) - (+y.start || 0))
    .map(c => c.frag + ':' + c.src + ':' + (Math.round((+c.dur || 0) * 100) / 100)).join('|');
}

// ── The voices of cells that have none ──
// A mirror cell without `voice` does not say which take of its line it speaks: a merge of such cells is laid
// as the person's cell (js/merge-v3/tl-merge.js), and cut silence on them is never written into the lines (lib/line-cuts.js
// reads a line's pieces by their voice). Opening the project gives each its voice, in one tick, nothing else of it changed:
// the voice of the cell the mirror lays for that line now when it is the same file; else, when it plays one of its line's
// reads, that read (a read speaks itself). A cell matching neither is left as it is.
function _voiceOf(cell, byN, proj) {
  const n = Number(cell.frag);
  const src = _addr(cell.src);
  const c = byN.get(n);
  if (c && c.voice && _addr(c.clip ? c.clip.path : c.take.path) === src) return c.voice;
  const audio = (((proj && proj.lines) || [])[n - 1] || {}).audio || {};
  for (const k of ['plain', 'tagged']) if (audio[k] && audio[k].path && _addr(audio[k].path) === src) return String(audio[k].path);
  return null;
}
function _fillVoices(key, proj, doc) {
  const bare = _a1Of(doc).filter(c => _isMirror(c) && !c.voice && !(Array.isArray(c.merge) && c.merge.length));
  if (!bare.length) return 0;
  let cells = [];
  try { cells = cellsOf(proj); } catch (e) { cells = []; }
  const byN = new Map(cells.map(c => [c.n, c]));
  const give = new Map();
  for (const c of bare) { const v = _voiceOf(c, byN, proj); if (v) give.set(String(c.id), { src: _addr(c.src), voice: v }); }
  if (!give.size) return 0;
  let n = 0;
  MSTORE.update(key, (t) => {
    const lane = (Array.isArray(t.tracks) ? t.tracks : []).find(x => x && x.id === 'a1');
    for (const c of (lane && lane.clips) || []) {
      const g = _isMirror(c) && !c.voice ? give.get(String(c.id)) : null;
      if (g && g.src === _addr(c.src)) { c.voice = g.voice; n++; }
    }
    return n ? undefined : false;
  });
  if (n) console.log('[frag-mirror] ' + key + ': ' + n + ' cell(s) laid before the voices were written told which take they speak');
  return n;
}

/** Lay it again only if it is out of date - the question an opening project asks. */
function catchUp(projectId, opts) {
  const id = String(projectId || '').trim();
  if (!id) return;
  const proj = (opts && opts.project) || PROJECTS.get(id);
  if (!proj || !Array.isArray(proj.lines) || !proj.lines.length) return;
  const key = 'sv3_' + id;
  const doc = _docOf(key);
  const settled = () => { try { _fillVoices(key, proj, doc); } catch (e) { console.warn('[frag-mirror] ' + key + ': voices not written:', e.message); } };
  let want = '';
  try { want = _wantSig(proj); } catch (e) { return; }
  if (!want) { settled(); return; }                   // nothing read yet: nothing to lay
  const have = doc ? _sigOf(_a1Of(doc)) : null;
  // Up to date, with no cell of an old send doubling it (lib/timeline-twins.js - the lay takes those off).
  if (have === want && !_count(TWINS.twinsOf(doc))) { settled(); return; }
  // Behind - or only seemingly: the lines the person's own sound holds are not laid (_plan), and a timeline that
  // is what a lay would make of it, with no cell of an old send to take off, is up to date.
  let plan = null;
  try { plan = doc ? _plan(cellsOf(proj), proj, new Map(), id.slice(-6), doc.tracks) : null; } catch (e) { plan = null; }
  if (plan && !_count(plan.twins) && _sigOf(plan.laidA) === have) { settled(); return; }
  console.log('[frag-mirror] ' + id + ': the timeline is behind the script, laying it again');
  // Opening a project is no new take: its captions are heard at the next one, or a press.
  touch(id, { project: proj, noHearing: true });
}

module.exports = { rebuild, touch, catchUp, cellsOf, lineDurOf, _followCells, _newVoice, _plan, _fillVoices, _carryPitch };
