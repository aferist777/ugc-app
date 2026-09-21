'use strict';

// ════════════════════════════════════════════════════════════════════════════
// THE TIMELINE AS A MIRROR OF THE SCRIPT (docs/local-app/PLAN.md, phase T').
//
// A talking head is not laid by hand: the workshop makes the reads, the frames and the clips of
// every line, and the cut of them is simply the lines in order. So the project's own timeline -
// `sv3_<project id>` - holds those cells and keeps them true, and the person edits everything
// else around them.
//
//   a line read, with a clip      a PAIR: the clip's picture on main video, its sound on main
//                                 audio, as long as the read, the hallucinated tail trimmed off
//   a line read, no clip yet      the same pair, but the picture half is the FRAME the line opens
//                                 on, held as a poster for the length of the read
//   a line not read yet           nothing. The lines after it close up (the owner's decision):
//                                 a gap for something that does not exist is not a cut
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
// the rule - and made from the words the line says now.
function _clipOf(line, frame) {
  const id = String((frame || {}).id || '');
  if (!id) return null;
  const variant = String((line && line.tagged) || '').trim() ? 'tagged' : 'plain';
  const takes = ((line && line.video) || {})[variant] || [];
  if (!takes.length) return null;
  const said = variant === 'tagged' ? String(line.tagged || '') : String(line.text || '');
  const fresh = takes.filter(c => c && c.path && c.fromFrame === id && c.said === said);
  if (!fresh.length) return null;
  const picked = fresh.find(c => c.id === String(((line.pick || {})[variant]) || ''));
  return picked || fresh[fresh.length - 1];
}

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
  const cells = [];
  let skipped = 0;
  lines.forEach((line, i) => {
    const take = _readOf(line);
    if (!take) { skipped++; return; }
    const frame = SCEN.frameOfLine ? SCEN.frameOfLine(pool, line, i, spread, id) : null;
    const clip = _clipOf(line, frame);
    cells.push({ i, n: i + 1, take, frame, clip, name: _nameOf(line, i + 1) });
  });

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

  const vol = await _levels(cells.map(c => c.take.path));
  const tag = id.slice(-6);
  const fx = { transition: null, animation: null, filter: null };
  const laidV = [];
  const laidA = [];
  let at = 0;
  for (const c of cells) {
    const dur = Math.max(0, +c.take.dur || 0);
    if (!(dur > 0)) continue;
    const srcDur = c.clip ? Math.max(dur, +c.clip.dur || dur) : dur;
    const half = {
      name: c.name, libId: null, frag: c.n,
      start: r2(at), dur: r2(dur), srcDur: r2(srcDur),
      // Past the end of the speech a lipsync clip keeps moving with nothing to say: that tail is
      // left off. A poster has no tail at all.
      trimIn: 0, trimOut: r2(Math.max(0, srcDur - dur)),
      speed: 1, reversed: false, ...fx,
      pairId: 'pm' + tag + '_' + c.n,
    };
    laidV.push({
      ...half, id: 'smv' + tag + '_' + c.n,
      src: c.clip ? c.clip.path : null,
      // With no clip the picture is the frame, held for the length of the read.
      poster: c.clip ? null : ((c.frame && (c.frame.preview || c.frame.path)) || null),
      thumb: c.clip ? (c.clip.thumb || null) : null,
      volume: 0,
    });
    laidA.push({
      ...half, id: 'sma' + tag + '_' + c.n,
      // The sound is the READ, whether or not a clip exists: the clip was lipsynced to that very
      // file, so the two are the same performance, and the read is the one that is always there.
      src: c.take.path, thumb: null, poster: null,
      volume: vol.get(c.take.path) != null ? vol.get(c.take.path) : 1,
    });
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
  console.log('[frag-mirror] ' + key + ': ' + laidV.length + ' cells'
    + (skipped ? ', ' + skipped + ' line(s) not read yet' : '') + ', rev ' + timelines[key].rev);
  return { key, cells: laidV.length, skipped };
}

/** Fire and forget: a mirror that could not be built must never fail the work that prompted it. */
function touch(projectId, opts) {
  Promise.resolve()
    .then(() => rebuild(projectId, opts))
    .catch(e => console.warn('[frag-mirror] could not re-lay ' + projectId + ':', e.message));
}

module.exports = { rebuild, touch };
