/* ═══════════════════════════════════════════════════════════════════════════
   MERGE v3 — the timeline of a BLANK project.

   The second of two. js/merge-v3/timeline.js belongs to projects that arrive from
   Scenarios: six fixed tracks, a read on Main that everything else is timed against,
   and an Overlays panel that hands an arrangement back to the scenario. None of that
   is true here. A blank project is assembled in Merge from nothing, so its tracks are
   created and deleted by hand and their order is the layer order.

   The two are deliberately SEPARATE modules rather than one with a switch. The
   talking-head path is debugged and shipping; a shared file would mean every change
   made for blank projects is a change to it, and the way that ends is a render that
   used to work.

   How the lanes are arranged, and why it is not decorative:

       video 2        \
       main video      |  the video block, TOP IS THE TOP LAYER
       ---------------- <- the middle line
       main audio      |  the audio block, mirrored
       audio 2        /
       Subtitles          pinned under both

   A pair - a video track and the audio track carrying that same media's sound - sits
   the same distance either side of the middle line. That is the whole reason the two
   blocks are glued there: being a pair needs no badge, no colour and no line drawn
   between them, because it is where they are.

   Pairing is stored as a LINK on the track, never worked out from the number. Numbers
   are renumbered when a track is deleted, and an audio track added on its own - a music
   bed - has no counterpart above it at all.

   PHASE SCOPE. Lanes can be created and destroyed; clips can be dropped onto them in pairs
   where the media has a sound, and dragged - along a lane and across lanes, both halves
   together. The insert rule for main, and trimming, come next.
   ═══════════════════════════════════════════════════════════════════════════ */

import * as Store from './store.js';
import { DRAG_TYPE, isStill, STILL_DUR } from './store.js';

// MAIN PLUS THREE, each side. The ceiling is also enforced by the server when it stores a
// timeline, because it belongs to the project rather than to a button that could be missed.
const MAX_PER_SIDE = 4;

const HOST = 'mv3-tl';

let _on = false;        // is this module the one currently showing?

const _host = () => document.getElementById(HOST);

// The label column's width is shared with the talking-head timeline and with the CSS
// (--mv3-lbl-w): the playhead is positioned in pixels, so all three have to agree.
const LBL_W = 78;
// The square column sits to the LEFT of the labels, so the lanes begin 20px further in than
// the label width alone says. The playhead is positioned in pixels from the timeline's left
// edge; using LBL_W by itself put the line over the names it was meant to stand beside.
const SQ_W = 20;
const GUTTER = SQ_W + LBL_W;

// A drop is placed at the pointer and may cover what is already there: these lanes are
// LAYERS, and which one shows is decided by the lane's place in the list rather than by
// keeping clips apart. Main is a sequence and behaves differently - that lands with the
// insert rule, next phase.
const FALLBACK_DUR = 3;



const _isMainVideo = (t) => !!t && t.kind === 'video' && !!t.main;
const _zoom = () => {
  const z = document.getElementById('mv3-zoom');
  return z ? (parseInt(z.value, 10) || 60) : 60;
};
const _id = () => 'c' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);

// ── Creating and destroying lanes ───────────────────────────────────────────
// Numbers are positions, counted from the seam outwards, and they are re-assigned after
// every change. That is why they are labels and never identities: the identity is the id,
// which is made once and never reused.
//
// Re-assigning also keeps a pair on matching numbers for free. The audio zone is held in
// mirror order, so the track opposite `video 3` is the third one down on the audio side -
// and so it is called `audio 3` without anyone having to arrange it.
function _renumber(tracks) {
  const vids = tracks.filter(t => t.kind === 'video');
  const auds = tracks.filter(t => t.kind === 'audio');
  // Video is listed top-first, so the seam is the END of that block; audio is listed from
  // the seam outwards already.
  vids.slice().reverse().forEach((t, i) => { t.main = i === 0; t.name = i === 0 ? 'main video' : 'video ' + (i + 1); });
  auds.forEach((t, i) => { t.main = i === 0; t.name = i === 0 ? 'main audio' : 'audio ' + (i + 1); });
}

// An id nothing else holds. Reusing a number would be enough for the name but not for this:
// a clip remembers the track it is on, and a recycled id would silently adopt the clips of
// a track that was deleted.
function _freshId(tracks, prefix) {
  let n = tracks.length + 1;
  while (tracks.some(t => t.id === prefix + n)) n++;
  return prefix + n;
}

const _count = (tracks, kind) => tracks.filter(t => t.kind === kind).length;

// Why the two + buttons do different things, and why that is not an inconsistency: a video
// track is a piece of media with a picture AND a sound, so it arrives with the lane its sound
// will land on. An audio track added on its own is a music bed - there is no picture to pair
// it with, and inventing an empty video lane for it would be a lane nobody asked for.
export function addVideoTrack() {
  Store.mutate(tl => {
    const t = tl.tracks;
    if (_count(t, 'video') >= MAX_PER_SIDE) return;
    const v = { id: _freshId(t, 'v'), kind: 'video', name: '', linkId: null, main: false,
                volume: null, speed: null, clips: [] };
    const a = { id: _freshId(t.concat(v), 'a'), kind: 'audio', name: '', linkId: v.id, main: false,
                volume: null, speed: null, clips: [] };
    v.linkId = a.id;
    // The new video lane goes on TOP - a new layer sits over what is already there - and its
    // sound goes at the far end of the audio block, which is the mirror of the same place.
    const firstVideo = t.findIndex(x => x.kind === 'video');
    t.splice(firstVideo < 0 ? 0 : firstVideo, 0, v);
    const lastAudio = t.map(x => x.kind).lastIndexOf('audio');
    t.splice(lastAudio + 1, 0, a);
    _renumber(t);
  });
}

export function addAudioTrack() {
  Store.mutate(tl => {
    const t = tl.tracks;
    if (_count(t, 'audio') >= MAX_PER_SIDE) return;
    const a = { id: _freshId(t, 'a'), kind: 'audio', name: '', linkId: null, main: false,
                volume: null, speed: null, clips: [] };
    const lastAudio = t.map(x => x.kind).lastIndexOf('audio');
    t.splice(lastAudio + 1, 0, a);
    _renumber(t);
  });
}

// Deleting is asymmetric, and deliberately: a video lane taken away takes its sound with it,
// because the two were one piece of media. A sound lane taken away leaves the picture, which
// simply goes quiet - that is a real thing to want and the only way to mute a lane outright.
export function removeTrack(id) {
  Store.mutate(tl => {
    const t = tl.tracks;
    const me = t.find(x => x.id === id);
    if (!me || me.main || me.kind === 'subs') return;

    const doomed = new Set([me.id]);
    if (me.kind === 'video' && me.linkId) doomed.add(me.linkId);

    for (let i = t.length - 1; i >= 0; i--) if (doomed.has(t[i].id)) t.splice(i, 1);
    // Whatever pointed at something that is gone now points at nothing.
    for (const x of t) if (x.linkId && doomed.has(x.linkId)) x.linkId = null;
    _renumber(t);
  });
}

// ── Dropping media ──────────────────────────────────────────────────────────
// A film is a picture AND a sound, so it lands as TWO clips that know about each other: one
// on the video lane, one on the lane paired with it. They share a pairId, which is what makes
// them one piece of media rather than two things that happen to line up.
//
// A PICTURE IS NOT. There is no sound in it to put anywhere, so it lands as one clip with no
// partner and no link - and the paired audio lane is simply not used. The lane stays paired,
// because the next thing dropped on it may well be a film.
//
// A BIROL lands muted. It is a piece of footage cut for its picture; playing its sound over
// the read underneath is almost never what is wanted, and turning it on is one click in the
// inspector. Volume 0 rather than a missing clip, so there is something to click.
function _drop(trackId, want, data) {
  const still = isStill({ src: data.src });
  const known = still ? 0 : (+data.dur || 0);
  const dur = still ? STILL_DUR : (known > 0 ? known : FALLBACK_DUR);
  const at = Math.round(Math.max(0, want) * 100) / 100;
  const pairId = 'p' + _id().slice(1);

  Store.mutate(tl => {
    const t = tl.tracks;
    const track = t.find(x => x.id === trackId);
    if (!track || track.kind === 'subs') return;

    // EVERY lane here takes the moment it was given, main included. A blank project is not a
    // read: there is no spoken cut whose timing has to stay whole, so a clip belongs where it
    // was put. Snapping it to a join and pushing the neighbours along is right in a scenario
    // project - and the talking-head timeline still does it - but here it only moves things
    // the person did not touch.

    const base = {
      src: data.src, thumb: data.thumb || null, name: data.name || '',
      libId: data.libId || null,
      start: at, dur: Math.round(dur * 100) / 100,
      srcDur: known > 0 ? Math.round(known * 100) / 100 : 0,
      trimIn: 0, trimOut: 0, speed: 1, reversed: false,
      transition: null, animation: null, filter: null,
    };

    // Dropped straight onto an audio lane: sound only, and audible - somebody putting a file
    // on the audio side means to hear it.
    if (track.kind === 'audio') {
      track.clips.push({ ...base, id: _id(), volume: 1, pairId: null });
      return;
    }

    const mate = still ? null : (track.linkId ? t.find(x => x.id === track.linkId) : null);
    const vid = { ...base, id: _id(), volume: 0, pairId: mate ? pairId : null };
    track.clips.push(vid);
    if (mate) {
      mate.clips.push({
        ...base, id: _id(), pairId,
        // The one thing the two halves do not share.
        volume: String(data.group || '') === 'birols' ? 0 : 1,
      });
      mate.clips.sort((a, b) => a.start - b.start);
    }
  });
}

// Deleting is asymmetric for the same reason it is asymmetric for lanes: the picture owns the
// sound, not the other way round. Removing the picture removes the piece of media; removing
// the sound leaves the picture, silent.
export function removeClip(trackId, clipId) {
  Store.mutate(tl => {
    const t = tl.tracks;
    const track = t.find(x => x.id === trackId);
    if (!track) return;
    const c = (track.clips || []).find(x => x.id === clipId);
    if (!c) return;
    track.clips = track.clips.filter(x => x.id !== clipId);
    if (track.kind === 'video' && c.pairId) {
      for (const other of t) {
        if (other.kind !== 'audio') continue;
        other.clips = (other.clips || []).filter(x => x.pairId !== c.pairId);
      }
    } else if (track.kind === 'audio' && c.pairId) {
      // The picture stays and keeps its pairId pointing at nothing, which is exactly what an
      // unpaired clip is - the same state an image has had since it landed.
      for (const other of t) {
        if (other.kind !== 'video') continue;
        for (const x of (other.clips || [])) if (x.pairId === c.pairId) x.pairId = null;
      }
    }
  });
}

// ── Selecting several at once ───────────────────────────────────────────────
// Drag across empty lane and a band follows the pointer; everything it TOUCHES is taken,
// not only what it encloses. Enclosure sounds tidier and is wrong here: lanes are 24px tall
// and clips are often wider than the screen, so a band that had to contain a clip could
// never catch one.
//
// Held by id rather than by element, because the timeline is rebuilt from the model on every
// change - a set of elements would be stale the moment anything moved.
const _sel = new Set();
let _band = null;

function _clearSel() {
  if (!_sel.size) return;
  _sel.clear();
  document.querySelectorAll('.mv3b-clip.is-sel').forEach(el => el.classList.remove('is-sel'));
  _afterSelB();
}

const _selSubs = [];
export function onSelChange(cb) { if (typeof cb === 'function') _selSubs.push(cb); }
function _afterSelB() { for (const cb of _selSubs) { try { cb(_sel.size); } catch (e) {} } }

function _paintSel() {
  document.querySelectorAll('.mv3b-clip').forEach(el => {
    el.classList.toggle('is-sel', _sel.has(el.dataset.clip));
  });
  _afterSelB();
}

function _beginBand(e) {
  if (e.button !== 0 || e.target.closest('.mv3b-clip')) return;
  const host = _host();
  if (!host || !host.contains(e.target)) return;
  const x0 = e.clientX, y0 = e.clientY;
  const el = document.createElement('div');
  el.className = 'mv3b-band';
  document.body.appendChild(el);
  _band = { x0, y0, el, add: e.shiftKey };
  if (!e.shiftKey) _clearSel();
  e.preventDefault();
}

// The band takes ANY clip here, main lanes included - the opposite of the talking-head
// timeline, and on purpose.
//
// There, Main is a read that arrived from a scenario: its clips are the spoken cut, they hold
// the whole timing of the video, and sweeping a rectangle over them is not an edit anybody
// means to make. Here nothing arrived from anywhere. A blank project is assembled by hand
// from the first clip on, main included, so withholding the main lanes from the one gesture
// that picks several things would be withholding them from their own editor.
const _bandable = (el) => !!el.closest('.mv3b-row');

function _moveBand(e) {
  if (!_band) return;
  const x = Math.min(_band.x0, e.clientX), y = Math.min(_band.y0, e.clientY);
  const w = Math.abs(e.clientX - _band.x0), h = Math.abs(e.clientY - _band.y0);
  Object.assign(_band.el.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px' });
  const box = { l: x, t: y, r: x + w, b: y + h };
  document.querySelectorAll('.mv3b-clip').forEach(c => {
    if (!_bandable(c)) return;
    const q = c.getBoundingClientRect();
    const hit = q.left < box.r && q.right > box.l && q.top < box.b && q.bottom > box.t;
    if (hit) _sel.add(c.dataset.clip);
    else if (!_band.add) _sel.delete(c.dataset.clip);
  });
  _paintSel();
}

function _endBand() {
  if (!_band) return;
  _band.el.remove();
  _band = null;
}

// Everything selected, deleted in one go. A pair still goes as a pair - removeClip owns that
// rule, and running it per clip keeps the one place that knows it.
function _deleteSelected() {
  if (!_sel.size) return;
  const tl = Store.timeline();
  if (!tl || !Array.isArray(tl.tracks)) return;
  const jobs = [];
  for (const t of tl.tracks) for (const c of (t.clips || [])) if (_sel.has(c.id)) jobs.push([t.id, c.id]);
  _clearSel();
  for (const [tid, cid] of jobs) removeClip(tid, cid);
}

// ── Dragging ────────────────────────────────────────────────────────────────
// A pair moves as ONE. Grab either half and both travel: the same seconds along the lane,
// and across lanes to the two that answer each other. Anything else lets a picture and its
// own sound drift apart, and nothing would tell you it had happened until playback.
//
// Feedback during the drag is written straight onto the elements; the model is touched once,
// on release. Mutating per mousemove would file a hundred undo steps for one gesture and
// repaint the whole timeline under the pointer.
let _drag = null;

// Where a clip may go: video to video, audio to audio. A subtitle lane takes neither.
function _laneUnder(y, kind) {
  const rows = [...document.querySelectorAll('.mv3b-row.is-' + kind)];
  for (const r of rows) {
    const b = r.getBoundingClientRect();
    if (y >= b.top && y <= b.bottom) return r;
  }
  return null;
}

// The lane the partner belongs on, given where the grabbed half is going. Null when that
// lane has no counterpart - which is a real state: an audio lane can be deleted out from
// under a video one, and then the picture simply has nowhere to keep its sound.
function _mateLane(tracks, destId, myKind) {
  const dest = tracks.find(t => t.id === destId);
  if (!dest || !dest.linkId) return null;
  const mate = tracks.find(t => t.id === dest.linkId);
  return (mate && mate.kind !== myKind) ? mate : null;
}

// How near an edge counts as grabbing it. Wide enough to hit without aiming, narrow enough
// that a short clip still has a middle to drag by - below twice this a clip is all edge, so
// the band shrinks with it rather than swallowing the whole thing.
const EDGE = 6;

function _edgeOf(e, el) {
  const r = el.getBoundingClientRect();
  const m = Math.min(EDGE, Math.max(2, r.width / 3));
  if (e.clientX - r.left <= m) return 'in';
  if (r.right - e.clientX <= m) return 'out';
  return null;
}

function _beginDrag(e, t, c, el) {
  if (e.button !== 0) return;
  const tl = Store.timeline();
  const tracks = (tl && tl.tracks) || [];
  const mateTrack = c.pairId
    ? tracks.find(x => x.id !== t.id && (x.clips || []).some(y => y.pairId === c.pairId))
    : null;
  const mateClip = mateTrack ? mateTrack.clips.find(y => y.pairId === c.pairId) : null;

  // Grabbing one of several takes them all, and they travel the same seconds. Sideways only:
  // where a group of clips from four different lanes should land when dragged onto one lane
  // has no obvious answer, and guessing at it would scatter a selection irretrievably.
  //
  // A selected clip brings its OTHER HALF whether or not the band happened to touch it. The
  // band sweeps one lane at a time, so selecting three pictures never selects their sounds -
  // and moving pictures while their sound stayed put is exactly the drift the pairing exists
  // to prevent.
  const group = [];
  if (_sel.has(c.id) && _sel.size > 1) {
    const pairs = new Set();
    for (const t of tracks) for (const x of (t.clips || [])) if (_sel.has(x.id) && x.pairId) pairs.add(x.pairId);
    const taken = new Set([c.id, mateClip ? mateClip.id : null]);
    for (const t of tracks) for (const x of (t.clips || [])) {
      if (taken.has(x.id)) continue;
      if (!_sel.has(x.id) && !(x.pairId && pairs.has(x.pairId))) continue;
      taken.add(x.id);
      group.push({ id: x.id, start0: +x.start,
                   el: document.querySelector(`.mv3b-clip[data-clip="${x.id}"]`) });
    }
  }

  const edge = _edgeOf(e, el);

  _drag = {
    edge,
    dur0: +c.dur, trimIn0: +c.trimIn || 0, srcDur: +c.srcDur || 0,
    group: edge ? [] : group,
    x0: e.clientX, start0: +c.start,
    id: c.id, from: t.id, kind: t.kind, to: t.id,
    mate: mateClip ? { id: mateClip.id, from: mateTrack.id, kind: mateTrack.kind, to: mateTrack.id } : null,
    el, mateEl: mateClip ? document.querySelector(`.mv3b-clip[data-clip="${mateClip.id}"]`) : null,
    start: +c.start, moved: false,
  };
  document.body.classList.add('mv3b-dragging');
  e.preventDefault();
}

function _moveDrag(e) {
  if (!_drag) return;
  const z = _zoom();
  const dx = (e.clientX - _drag.x0) / z;

  // TRIMMING, not moving. The left edge takes from the front - the clip starts later and
  // begins further into its source - and the right edge takes from the back. A source with a
  // known length is the ceiling: a clip cannot be stretched past the film it is made of. A
  // still has no such length, which is why srcDur 0 means "no ceiling" rather than "empty".
  if (_drag.edge) {
    _drag.moved = true;
    const room = _drag.srcDur > 0 ? _drag.srcDur : Infinity;
    if (_drag.edge === 'in') {
      const lo = -_drag.trimIn0;
      const hi = _drag.dur0 - 0.1;
      const d = Math.max(lo, Math.min(hi, dx));
      _drag.start = Math.max(0, Math.round((_drag.start0 + d) * 100) / 100);
      _drag.dur = Math.round((_drag.dur0 - d) * 100) / 100;
      _drag.trimIn = Math.max(0, Math.round((_drag.trimIn0 + d) * 100) / 100);
      _drag.el.style.left = (_drag.start * z) + 'px';
    } else {
      const hi = room === Infinity ? Infinity : (room - _drag.trimIn0);
      const d = Math.max(0.1 - _drag.dur0, Math.min(hi - _drag.dur0, dx));
      _drag.dur = Math.round((_drag.dur0 + d) * 100) / 100;
    }
    _drag.el.style.width = Math.max(2, _drag.dur * z) + 'px';
    if (_drag.mateEl) {
      _drag.mateEl.style.left = ((_drag.start != null ? _drag.start : _drag.start0) * z) + 'px';
      _drag.mateEl.style.width = Math.max(2, _drag.dur * z) + 'px';
    }
    return;
  }

  const next = Math.max(0, Math.round((_drag.start0 + dx) * 100) / 100);
  if (Math.abs(next - _drag.start) > 0.001) _drag.moved = true;
  _drag.start = next;
  _drag.el.style.left = (next * z) + 'px';
  const dd = next - _drag.start0;
  for (const g of _drag.group) if (g.el) g.el.style.left = (Math.max(0, g.start0 + dd) * z) + 'px';

  // A group travels sideways only - see the note where it is collected.
  const row = _drag.group.length ? null : _laneUnder(e.clientY, _drag.kind);
  if (row && row.dataset.track !== _drag.to) {
    _drag.to = row.dataset.track;
    _drag.moved = true;
    row.querySelector('.mv3b-lane').appendChild(_drag.el);
  }

  if (_drag.mate && _drag.mateEl) {
    _drag.mateEl.style.left = (next * z) + 'px';
    const tracks = (Store.timeline() || {}).tracks || [];
    const mateDest = _mateLane(tracks, _drag.to, _drag.kind);
    const want = mateDest ? mateDest.id : _drag.mate.from;
    if (want !== _drag.mate.to) {
      _drag.mate.to = want;
      const r = document.querySelector(`.mv3b-row[data-track="${want}"] .mv3b-lane`);
      if (r) r.appendChild(_drag.mateEl);
    }
    // The destination has no lane for the sound. Say so while the pointer is still down,
    // rather than letting go and discovering the picture arrived alone.
    _drag.mateEl.classList.toggle('is-orphaning', !mateDest);
  }
}

function _endDrag() {
  if (!_drag) return;
  const d = _drag;
  _drag = null;
  document.body.classList.remove('mv3b-dragging');
  // Pressed and let go without moving: that is a click, and a click on a clip selects it.
  // One clip, replacing whatever the band had - picking a single thing is how you say "this
  // is the one I want to change", and keeping the old set would make the inspector talk
  // about something else.
  if (!d.moved) {
    _sel.clear();
    _sel.add(d.id);
    _paintSel();
    _repaint();
    return;
  }

  // A trim never changes lanes, so it is settled on its own and the move below is skipped.
  if (d.edge) {
    Store.mutate(tl => {
      const t = tl.tracks;
      const apply = (id) => {
        for (const tr of t) {
          const c = (tr.clips || []).find(x => x.id === id);
          if (!c) continue;
          const was = +c.dur;
          if (d.edge === 'in') { c.start = d.start; c.trimIn = d.trimIn; }
          c.dur = d.dur;
          return;
        }
      };
      apply(d.id);
      if (d.mate) apply(d.mate.id);
      for (const tr of t) if (tr.kind === 'audio') (tr.clips || []).sort((a, b) => a.start - b.start);
    });
    return;
  }

  Store.mutate(tl => {
    const t = tl.tracks;
    const move = (id, fromId, toId) => {
      const from = t.find(x => x.id === fromId);
      const to = t.find(x => x.id === toId) || from;
      if (!from || !to) return null;
      const i = (from.clips || []).findIndex(x => x.id === id);
      if (i < 0) return null;
      const [c] = from.clips.splice(i, 1);
      c.start = d.start;
      to.clips.push(c);
      if (to.kind === 'audio') to.clips.sort((a, b) => a.start - b.start);
      return c;
    };
    const dd = d.start - d.start0;
    for (const g of d.group) {
      for (const tr of t) {
        const c2 = (tr.clips || []).find(x => x.id === g.id);
        if (c2) { c2.start = Math.max(0, Math.round((g.start0 + dd) * 100) / 100); break; }
      }
    }

    const vid = move(d.id, d.from, d.to);
    if (d.mate) {
      const dest = _mateLane(t, d.to, d.kind);
      const mate = move(d.mate.id, d.mate.from, dest ? dest.id : d.mate.from);
      // No lane for the sound where the picture went: the two stop being one piece of media
      // rather than following each other into lanes that do not answer.
      if (!dest && vid && mate) { vid.pairId = null; mate.pairId = null; }
    }
  });
}

function _repaint() { if (_on) _build(); }

const _hasClip = (e) => Array.from((e.dataTransfer && e.dataTransfer.types) || []).indexOf(DRAG_TYPE) >= 0;

function _wireLane(lane, t) {
  if (t.kind === 'subs') return;
  lane.addEventListener('dragover', (e) => {
    if (!_hasClip(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    lane.classList.add('is-drop');
  });
  lane.addEventListener('dragleave', () => lane.classList.remove('is-drop'));
  lane.addEventListener('drop', (e) => {
    if (!_hasClip(e)) return;
    e.preventDefault();
    lane.classList.remove('is-drop');
    let data = null;
    try { data = JSON.parse(e.dataTransfer.getData(DRAG_TYPE)); } catch (err) { return; }
    if (!data || !data.src) return;
    const r = lane.getBoundingClientRect();
    _drop(t.id, (e.clientX - r.left) / _zoom(), data);
  });
}

// ── The confirm, anchored to the square that asked for it ───────────────────
// A popup rather than an armed second click: an armed button says nothing about what it is
// about to remove, and these lanes look alike. It closes on the next click anywhere, so it
// can never be left hanging over the timeline.
let _ask = null;

function _closeAsk() {
  if (_ask) { _ask.remove(); _ask = null; }
}

function _confirm(anchor, text, onYes) {
  _closeAsk();
  const el = document.createElement('div');
  el.className = 'mv3b-ask';
  const p = document.createElement('div');
  p.className = 'mv3b-ask-t';
  p.textContent = text;
  el.appendChild(p);

  const row = document.createElement('div');
  row.className = 'mv3b-ask-r';
  const no = document.createElement('button');
  no.type = 'button'; no.className = 'mv3-btn sm'; no.textContent = 'Cancel';
  no.addEventListener('click', (e) => { e.stopPropagation(); _closeAsk(); });
  const yes = document.createElement('button');
  yes.type = 'button'; yes.className = 'mv3-btn sm danger'; yes.textContent = 'Delete';
  yes.addEventListener('click', (e) => { e.stopPropagation(); _closeAsk(); onYes(); });
  row.append(no, yes);
  el.appendChild(row);

  document.body.appendChild(el);
  _ask = el;
  const a = anchor.getBoundingClientRect();
  el.style.left = Math.round(Math.min(a.right + 6, window.innerWidth - el.offsetWidth - 8)) + 'px';
  el.style.top = Math.round(Math.min(a.top, window.innerHeight - el.offsetHeight - 8)) + 'px';
  setTimeout(() => document.addEventListener('click', _closeAsk, { once: true }), 0);
}

function _lane(t) {
  const row = document.createElement('div');
  row.className = 'mv3b-row is-' + t.kind + (t.main ? ' is-main' : '');
  row.dataset.track = t.id;

  // The square column. A main lane carries the + that makes another of its kind; every lane
  // made that way carries the - that takes it away again. The subtitle lane gets neither:
  // there is one of it, always.
  const box = document.createElement('div');
  box.className = 'mv3b-box';
  if (t.kind !== 'subs') {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'mv3b-sq';
    const tl = Store.timeline();
    const all = (tl && Array.isArray(tl.tracks)) ? tl.tracks : [];
    if (t.main) {
      const full = _count(all, t.kind) >= MAX_PER_SIDE;
      btn.textContent = '+';
      btn.disabled = full;
      btn.title = full
        ? 'Three ' + t.kind + ' tracks beside the main one is the limit'
        : (t.kind === 'video'
            ? 'Add a video track, and the audio track its sound will land on'
            : 'Add an audio track on its own - for music, with no picture paired to it');
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (t.kind === 'video') addVideoTrack(); else addAudioTrack();
      });
    } else {
      btn.textContent = '\u2212';
      btn.title = t.kind === 'video'
        ? 'Remove ' + t.name + ' and the audio track paired with it'
        : 'Remove ' + t.name + ' - any video paired with it stays, and goes silent';
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        _confirm(btn, 'Delete ' + t.name + '?' +
          (t.kind === 'video' && t.linkId ? ' Its audio track goes too.' : ''),
          () => removeTrack(t.id));
      });
    }
    box.appendChild(btn);
  }
  row.appendChild(box);

  // The pair is normally readable from the layout - matching distance either side of the
  // seam. It stops being readable the moment an audio lane is deleted out from under a video
  // one, which is allowed on purpose: the counts stop matching and no arrangement can mirror
  // them. So the link is also stated, by the partner's NAME and with a mark on the label.
  const all = ((Store.timeline() || {}).tracks) || [];
  const mate = t.linkId ? all.find(x => x.id === t.linkId) : null;
  const lbl = document.createElement('div');
  lbl.className = 'mv3b-lbl' + (mate ? ' is-linked' : '');
  const nm = document.createElement('span');
  nm.textContent = t.name;
  lbl.appendChild(nm);
  if (mate) {
    const mk = document.createElement('span');
    mk.className = 'mv3b-link';
    mk.textContent = '⚭';
    lbl.appendChild(mk);
  }
  lbl.title = mate
    ? (t.kind === 'video' ? t.name + ' - its sound is on ' + mate.name
                          : t.name + ' - carries the sound of ' + mate.name)
    : (t.kind === 'video' ? t.name + ' - silent, no audio track paired with it' : t.name);
  row.appendChild(lbl);

  const lane = document.createElement('div');
  lane.className = 'mv3b-lane';
  for (const c of (t.clips || [])) lane.appendChild(_clipEl(t, c));
  // Selection survives the rebuild: it is held by id for exactly this reason.
  
  _wireLane(lane, t);
  row.appendChild(lane);

  return row;
}

function _clipEl(t, c) {
  const el = document.createElement('div');
  el.className = 'mv3b-clip is-' + t.kind + (c.pairId ? ' is-paired' : '') +
                 (t.kind === 'audio' && !(+c.volume) ? ' is-muted' : '');
  el.dataset.clip = c.id;
  el.dataset.track = t.id;
  el.style.left = (c.start * _zoom()) + 'px';
  el.style.width = Math.max(2, c.dur * _zoom()) + 'px';
  if (c.thumb && t.kind === 'video') el.style.backgroundImage = `url('${c.thumb}')`;

  const cap = document.createElement('span');
  cap.className = 'mv3b-clip-t';
  cap.textContent = c.name || '';
  el.appendChild(cap);

  if (_sel.has(c.id)) el.classList.add('is-sel');
  el.addEventListener('mousemove', (e) => {
    if (_drag) return;
    el.style.cursor = _edgeOf(e, el) ? 'ew-resize' : 'grab';
  });
  el.addEventListener('mousedown', (e) => _beginDrag(e, t, c, el));

  el.title = (c.name || 'clip') +
    (t.kind === 'audio' && !(+c.volume) ? ' - silent; turn its sound on in the inspector' : '') +
    (c.pairId ? '' : (t.kind === 'video' ? ' - no sound of its own' : ''));
  return el;
}

// ── The ruler, and the line that says where you are ─────────────────────────
// Seconds every so often, chosen against the zoom so the marks never crowd: at 9 px/sec a
// tick a second is a smear, and at 120 it is a tick every inch. The step climbs through a
// short ladder rather than by arithmetic, because 1-2-5-10 reads as time and 1-3-7 does not.
const STEPS = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
function _step(z) {
  for (const s of STEPS) if (s * z >= 56) return s;
  return STEPS[STEPS.length - 1];
}

function _fmtT(v) {
  const m = Math.floor(v / 60), s = v - m * 60;
  return m + ':' + (s < 10 ? '0' : '') + (s % 1 ? s.toFixed(1) : s.toFixed(0));
}

function _ruler(dur) {
  const row = document.createElement('div');
  row.className = 'mv3b-row is-ruler';
  const box = document.createElement('div');
  box.className = 'mv3b-box';
  const lbl = document.createElement('div');
  lbl.className = 'mv3b-lbl';
  row.append(box, lbl);

  const lane = document.createElement('div');
  lane.className = 'mv3b-lane mv3b-ruler';
  const z = _zoom(), st = _step(z);
  for (let t = 0; t <= dur + st; t += st) {
    const m = document.createElement('span');
    m.className = 'mv3b-tick';
    m.style.left = (t * z) + 'px';
    m.textContent = _fmtT(Math.round(t * 10) / 10);
    lane.appendChild(m);
  }
  // Pressing the ruler moves the playhead - the same gesture as every other editor, and the
  // only way to reach a moment that has no clip under it.
  lane.addEventListener('mousedown', (e) => {
    const r = lane.getBoundingClientRect();
    _seekTo((e.clientX - r.left) / _zoom());
  });
  row.appendChild(lane);
  return row;
}

// The playhead is one element over the whole stack, not a mark per lane: it is one moment,
// and drawing it per lane makes it possible for them to disagree.
function _head(dur) {
  const el = document.createElement('div');
  el.className = 'mv3b-head';
  el.style.left = (GUTTER + _playhead * _zoom()) + 'px';
  return el;
}

let _playhead = 0;
function _seekTo(t) {
  _playhead = Math.max(0, Math.round((+t || 0) * 100) / 100);
  const el = _host() && _host().querySelector('.mv3b-head');
  if (el) el.style.left = (GUTTER + _playhead * _zoom()) + 'px';
  // The preview is the other half of this workflow, and the playhead belongs to both. seek()
  // calls setPlayhead back, which is harmless: it writes the same number this just wrote.
  import('./preview-b.js').then(P => P.seek(_playhead)).catch(() => {});
}

export const playhead = () => _playhead;
export function setPlayhead(t) {
  _playhead = Math.max(0, +t || 0);
  const el = _host() && _host().querySelector('.mv3b-head');
  if (el) el.style.left = (GUTTER + _playhead * _zoom()) + 'px';
}

function _build() {
  const host = _host();
  if (!host) return;
  host.textContent = '';

  const tl = Store.timeline();
  const tracks = (tl && Array.isArray(tl.tracks)) ? tl.tracks : [];

  const inner = document.createElement('div');
  inner.className = 'mv3b-inner';
  let end = 0;
  for (const t of tracks) for (const c of (t.clips || [])) end = Math.max(end, (+c.start) + (+c.dur));
  inner.appendChild(_ruler(Math.max(end, 10)));

  // The video block, then the audio block, then subtitles. Read off the track kinds
  // rather than off positions in the list, so a list that arrives in an odd order still
  // draws as three zones instead of interleaving them.
  const zone = (cls, of) => {
    const rows = tracks.filter(of);
    if (!rows.length) return null;
    const z = document.createElement('div');
    z.className = 'mv3b-zone ' + cls;
    rows.forEach(t => z.appendChild(_lane(t)));
    return z;
  };

  const video = zone('is-video', t => t.kind === 'video');
  const audio = zone('is-audio', t => t.kind === 'audio');
  const subs  = zone('is-subs',  t => t.kind === 'subs');

  if (video) inner.appendChild(video);
  // The seam the two blocks are glued at. A real element and not a border, because the
  // pairing is read off distance from it and it has to be findable in the DOM to test.
  if (video && audio) {
    const seam = document.createElement('div');
    seam.className = 'mv3b-seam';
    inner.appendChild(seam);
  }
  if (audio) inner.appendChild(audio);
  if (subs) inner.appendChild(subs);

  inner.appendChild(_head());
  host.appendChild(inner);
}

// Take over the timeline panel. Called by the dispatcher in main.js when a blank project
// is opened; the talking-head module is told to stand down first.
export function mount() {
  _on = true;
  document.body.classList.add('mv3-blank');
  _build();
}

export function unmount() {
  _on = false;
  _closeAsk();
  document.body.classList.remove('mv3-blank');
}

export const multiCount = () => _sel.size;

// The one selected clip, with the lane it is on - null unless exactly one is chosen. The
// inspector asks for this; a panel of settings only means something for a single clip.
export function selectedOne() {
  if (_sel.size !== 1) return null;
  const id = [..._sel][0];
  const tl = Store.timeline();
  for (const t of ((tl && tl.tracks) || [])) {
    const c = (t.clips || []).find(x => x.id === id);
    if (c) return { track: t, clip: c };
  }
  return null;
}

// Set one field on one clip. Everything the panel offers goes through here, so there is one
// place that knows a change has to be saved and redrawn.
export function setClipField(trackId, clipId, key, value) {
  Store.mutate(tl => {
    const t = (tl.tracks || []).find(x => x.id === trackId);
    const c = t && (t.clips || []).find(x => x.id === clipId);
    if (!c) return;
    if (key === 'volume') c.volume = Math.max(0, Math.min(4, +value || 0));
    else if (key === 'dur') c.dur = Math.max(0.1, Math.round((+value || 0) * 100) / 100);
  });
}
export const deleteMulti = () => _deleteSelected();

export function initTimelineB() {
  Store.onChange(() => { if (_on) _build(); });
  const z = document.getElementById('mv3-zoom');
  if (z) z.addEventListener('input', () => { if (_on) _build(); });
  // On the document, not the clip: the pointer routinely leaves a 20px-tall element during a
  // drag, and a listener on the clip would drop the gesture the moment it did.
  document.addEventListener('mousemove', _moveDrag);
  document.addEventListener('mouseup', _endDrag);
  document.addEventListener('mousedown', (e) => { if (_on) _beginBand(e); });
  document.addEventListener('mousemove', _moveBand);
  document.addEventListener('mouseup', _endBand);
  document.addEventListener('keydown', (e) => {
    if (!_on) return;
    if (e.key === 'Escape') _clearSel();
    // Not while typing: the inspector has fields, and Delete there means a character.
    if ((e.key === 'Delete' || e.key === 'Backspace') &&
        !/^(INPUT|TEXTAREA|SELECT)$/.test((e.target.tagName || ''))) {
      e.preventDefault();
      _deleteSelected();
    }
  });
}

// Exposed so a test can drive the rule rather than the mouse - the arithmetic of a synthetic
// drag is not what is worth checking here.
export { _drop as __drop };

export const isMounted = () => _on;
export { LBL_W };
