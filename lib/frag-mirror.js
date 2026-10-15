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
// ════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const MSTORE = require('./merge-store');
const LOUD = require('./loudness');
const PROJECTS = require('./projects-store');
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

// The words of a line, for the cell's name: the performance tags are directions, not words.
function _nameOf(line, n) {
  const said = String((line && (line.tagged || line.text)) || '');
  return said.replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || ('fragment ' + n);
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
 * @returns { key, cells, skipped } or null when there is nothing to mirror
 */
async function rebuild(projectId, opts) {
  const id = String(projectId || '').trim();
  if (!id) return null;
  const proj = (opts && opts.project) || PROJECTS.get(id);
  if (!proj) return null;
  const lines = Array.isArray(proj.lines) ? proj.lines : [];
  const key = 'sv3_' + id;

  // What each line contributes, in order. The frame is the one the line opens on, by the project's
  // own rule - the same one the page paints by (routes/scen3.js, _framePool/_frameOfLine).
  const SCEN = require('../routes/scen3');
  const pool = SCEN.framePool ? SCEN.framePool(proj) : [];
  const spread = String(((proj.video || {}).spread) || 'cycle');
  const sd = _seedance(proj);
  const sample = _bySample(proj);
  const cutAt = _sdCutsOf(proj, SCEN, sd);
  const cells = [];
  let skipped = 0;
  lines.forEach((line, i) => {
    if (line && line.removed) { skipped++; return; }   // taken off the script (phase Z): not in the cut
    const cut = cutAt.get(i);
    if (cut) {
      cells.push({ i, n: i + 1, sd: cut, take: { path: cut.audio, dur: cut.dur }, frame: null, clip: cut.clip, name: _nameOf(line, i + 1) });
      return;
    }
    if (sample) return;                                 // (V26.8) by the voice sample: no clip, no cell
    const take = _readOf(line);
    if (!take) { skipped++; return; }
    const frame = SCEN.frameOfLine ? SCEN.frameOfLine(pool, line, i, spread, id) : null;
    const clip = sd ? null : _clipOf(line, frame, take);
    cells.push({ i, n: i + 1, take, frame, clip, name: _nameOf(line, i + 1) });
  });

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
  // No timeline yet: the mirror makes one, the same shape a send from Scenarios makes.
  const fresh = tl || {
    title: now.slice(0, 10) + ' - ' + (String(proj.title || '').trim() || 'talking head'),
    createdAt: now, adv: null, owner: null, rev: 0, kind: 'blank', format: '9:16',
    tracks: [
      { id: 'v2', kind: 'video', name: 'video 2', linkId: 'a2', main: false, volume: null, speed: null, clips: [] },
      { id: 'v1', kind: 'video', name: 'main video', linkId: 'a1', main: true, volume: null, speed: null, clips: [] },
      { id: 'a1', kind: 'audio', name: 'main audio', linkId: 'v1', main: true, volume: null, speed: null, clips: [] },
      { id: 'a2', kind: 'audio', name: 'audio 2', linkId: 'v2', main: false, volume: null, speed: null, clips: [] },
      { id: 'subs', kind: 'subs', name: 'Subtitles', linkId: null, main: true, volume: null, speed: null, clips: [] },
    ],
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
  for (const c of cells) {
    // (phase V26.8, part 5) A LINE'S SEEDANCE CLIP: the picture muted, and under it the clip's own sound - Seedance
    // voiced the line itself - as a pair.
    if (c.sd) {
      const dur = c.sd.len;
      if (!(dur > 0)) continue;
      const srcDur = Math.max(dur, +c.clip.dur || dur);
      const half = {
        name: c.name, libId: null, frag: c.n, start: r2(at), dur: r2(dur), srcDur: r2(srcDur),
        trimIn: 0, trimOut: r2(Math.max(0, srcDur - dur)), speed: 1, reversed: false, ...fx,
        pairId: 'pm' + tag + '_' + c.n,
      };
      laidV.push({ ...half, id: 'smv' + tag + '_' + c.n, src: c.clip.path, poster: null, thumb: c.clip.thumb || null, volume: 0 });
      laidA.push({ ...half, id: 'sma' + tag + '_' + c.n, src: c.clip.path, poster: null, thumb: null, volume: 1 });
      at += dur;
      continue;
    }
    const dur = _cellDur(c.take, c.clip);
    if (!(dur > 0)) continue;
    const srcDur = c.clip ? Math.max(dur, +c.clip.dur || dur) : dur;
    const level = vol.get(c.take.path) != null ? vol.get(c.take.path) : 1;
    const half = {
      name: c.name, libId: null, frag: c.n,
      start: r2(at), dur: r2(dur), srcDur: r2(srcDur),
      // Past the end of the speech a lipsync clip keeps moving with nothing to say: that tail is
      // left off. A read has no tail at all.
      trimIn: 0, trimOut: r2(Math.max(0, srcDur - dur)),
      speed: 1, reversed: false, ...fx,
      pairId: c.clip ? ('pm' + tag + '_' + c.n) : null,
    };
    if (c.clip) {
      // THE CLIP COMES WITH ITS OWN SOUND (the owner, 2026-09-22): both halves are the one file,
      // the picture muted and the sound heard, and that pair stands where the read's cell stood.
      laidV.push({ ...half, id: 'smv' + tag + '_' + c.n, src: c.clip.path, poster: null, thumb: c.clip.thumb || null, volume: 0 });
      laidA.push({ ...half, id: 'sma' + tag + '_' + c.n, src: c.clip.path, poster: null, thumb: null, volume: level });
    } else {
      // No clip yet: the read alone. Nothing is laid on the video lane - there is no picture of
      // this line yet, and the frame is not one (the owner, 2026-09-22).
      laidA.push({ ...half, id: 'sma' + tag + '_' + c.n, src: c.take.path, poster: null, thumb: null, volume: level });
    }
    at += dur;
  }
  vLane.clips = keptV.concat(laidV);
  aLane.clips = keptA.concat(laidA);

  timelines[key] = {
    ...fresh,
    tracks,
    rev: (Number(fresh.rev) || 0) + 1,
    updatedAt: now,
  };
  MSTORE.write({ version: (Number(state.version) || 0) + 1, updatedAt: now, timelines, hidden: state.hidden, snapshots: state.snapshots });
  console.log('[frag-mirror] ' + key + ': ' + laidA.length + ' cells (' + laidV.length + ' with a clip)'
    + (skipped ? ', ' + skipped + ' line(s) not read yet' : '') + ', rev ' + timelines[key].rev);
  return { key, cells: laidA.length, clips: laidV.length, skipped };
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
  const lines = Array.isArray(proj && proj.lines) ? proj.lines : [];
  const SCEN = require('../routes/scen3');
  const pool = SCEN.framePool ? SCEN.framePool(proj) : [];
  const spread = String(((proj.video || {}).spread) || 'cycle');
  const sd = _seedance(proj);
  const sample = _bySample(proj);
  const cutAt = _sdCutsOf(proj, SCEN, sd);
  const out = [];
  lines.forEach((line, i) => {
    if (line && line.removed) return;                  // ...and the signature has to agree with it
    const cut = cutAt.get(i);
    if (cut) { out.push((i + 1) + ':' + cut.clip.path + ':' + (Math.round(cut.len * 100) / 100)); return; }
    if (sample) return;
    const take = _readOf(line);
    if (!take) return;
    const frame = SCEN.frameOfLine ? SCEN.frameOfLine(pool, line, i, spread, proj.id) : null;
    const clip = sd ? null : _clipOf(line, frame, take);
    out.push((i + 1) + ':' + (clip ? clip.path : take.path) + ':' + (Math.round(_cellDur(take, clip) * 100) / 100));
  });
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
  return a1.filter(c => Number(c && c.frag) > 0)
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
  touch(id, { project: proj });
}

// (phase V26.8) The read a line is read by, for the lines of a Seedance talking head (routes/scen3.js _sdView).
module.exports = { rebuild, touch, catchUp, readOf: _readOf };
