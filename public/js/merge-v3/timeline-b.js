/* ═══════════════════════════════════════════════════════════════════════════
   MERGE v3 — the timeline.

   Merge's one editor (docs/local-app/PLAN.md, phase 3): a project is an ordered list of lanes,
   created and deleted by hand, and their order is the layer order. A project sent from Scenarios
   arrives as its cut on the main lanes; the talking-head editor's projects were rewritten into
   this shape at startup (lib/timeline-convert.js).

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

   ═══════════════════════════════════════════════════════════════════════════ */

import * as Store from './store.js';
import * as Layers from '../layers.js';
import * as Views from './lib-views.js';
import { askDelete, short } from './ask.js';
import { DRAG_TYPE, DRAG_MEDIA, isStill, STILL_DUR } from './store.js';
import { locked } from './layout.js';
import { recutClips, recutSome, timedWords } from '../captions/pages.js';
import { retext, isCorrected } from '../captions/words.js';
import { linesOf as docLines, editLine as docEditLine } from '../captions/doc.js';
import * as History from './history.js';
import { isHeard } from '../captions/heard.js';

// MAIN PLUS THREE, each side. The ceiling is also enforced by the server when it stores a
// timeline, because it belongs to the project rather than to a button that could be missed.
const MAX_PER_SIDE = 4;

const HOST = 'mv3-tl';

let _on = false;        // is this module the one currently showing?

const _host = () => document.getElementById(HOST);

// The label column's width is shared with the CSS (--mv3-lbl-w): the playhead is positioned in pixels,
// so both have to agree. 84 since phase S4 - at 78 "MAIN VIDEO" with its link mark ended in "…".
const LBL_W = 84;
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



const _zoom = () => {
  const z = document.getElementById('mv3-zoom');
  return z ? (parseInt(z.value, 10) || 60) : 60;
};
// A counter as well as the clock: a re-cut makes hundreds of ids in one millisecond, and the clock and a
// random number alone gave two captions one id a few times in a hundred presses (review K6). The parts are
// separated, so a short counter and a long random number cannot spell the same id as the reverse.
let _idSeq = 0;
const _id = () => 'c' + Date.now().toString(36) + '-' + (_idSeq++).toString(36) + '-' + Math.floor(Math.random() * 1e4).toString(36);

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
  // Text lanes are numbered from one and none of them is main: there is no original among
  // them the way there is one video lane the others are made beside.
  tracks.filter(t => t.kind === 'text').forEach((t, i) => { t.main = false; t.name = 'text ' + (i + 1); });
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
  Store.mutate(tl => { _newVideoLane(tl.tracks); });
}

// Inside a mutation. Returns the new video lane, or null at the ceiling.
function _newVideoLane(t) {
  if (_count(t, 'video') >= MAX_PER_SIDE) return null;
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
  return v;
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
// TWO TEXT LANES AND NO MORE. Subtitles are one lane because they are one transcript; typed
// text is a title and a caption and a credit, which is two things at once often enough to be
// worth a second lane and never three - a third is a stack nobody can read past.
export const MAX_TEXT = 2;

export function addTextTrack() {
  Store.mutate(tl => {
    const t = tl.tracks;
    if (_count(t, 'text') >= MAX_TEXT) return;
    const row = { id: _freshId(t, 'x'), kind: 'text', name: '', linkId: null, main: false,
                  volume: null, speed: null, clips: [],
                  // Not where the subtitles are. Two sets of words in the same place is one
                  // set of words on top of another, and the second lane is usually a title.
                  style: { pos: t.some(x => x.kind === 'text') ? 'center' : 'top' } };
    // Immediately ABOVE the subtitles, which are the floor. A second text lane lands above the
    // first, so the newest is nearest the picture and the subtitles never move.
    let at = t.findIndex(x => x.kind === 'subs');
    if (at < 0) at = t.length;
    t.splice(at, 0, row);
    _renumber(t);
  });
}

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
// A FILM LANDS AT ITS FULL LENGTH, always. The library usually knows how long one is and the
// clip is made that length outright; when it does not, the browser is asked - the file is
// being fetched for the preview anyway - and the clip is corrected the moment the answer
// comes back. Leaving it at a guessed three seconds would silently cut the film, and the cut
// would look like a decision somebody made.
function _measure(ids, src) {
  const v = document.createElement('video');
  v.preload = 'metadata';
  v.addEventListener('loadedmetadata', () => {
    const d = Math.round((+v.duration || 0) * 100) / 100;
    if (!(d > 0)) return;
    Store.mutate(tl => {
      for (const t of (tl.tracks || [])) {
        for (const c of (t.clips || [])) {
          if (!ids.includes(c.id)) continue;
          c.dur = d;
          c.srcDur = d;
        }
      }
    });
  }, { once: true });
  v.addEventListener('error', () => {}, { once: true });
  v.src = src;
}

// (phase V28.4, the owner 2026-10-12: "чтобы не происходила мешанины") WHAT A LANE TAKES: a video lane - films and
// pictures; an audio lane - sounds, music and films (a film's sound). A tile says what it is (DRAG_MEDIA, js/merge-v3/
// library.js); one that does not say is taken as before.
function _laneTakes(kind, media) {
  if (!media) return true;
  if (kind === 'video') return media === 'video' || media === 'image';
  if (kind === 'audio') return media === 'video' || media === 'audio';
  return false;
}
function _mediaOfDrag(dt) {
  const t = Array.from((dt && dt.types) || []).find(x => x.startsWith(DRAG_MEDIA));
  return t ? t.slice(DRAG_MEDIA.length) : '';
}

// (phase V28.4, the owner 2026-10-12: "при бросить из библиотеки может быть разница в длительности, поэтому не обрезая и
// не укорачивая но начало на той же секунде") A TILE LET GO ON A RED CLIP takes its place: the new file from the same
// second, at its own length - not cut, not shortened - with the clip's volume, speed and effects. A film replacing one
// half of a film's pair replaces both; a picture has no sound, so the sound half of the pair goes; a sound on the sound
// half lets go of the picture (it stays red until replaced too).
function _replace(trackId, clipId, data) {
  const still = isStill({ src: data.src });
  const known = still ? 0 : (+data.dur || 0);
  const r2 = (v) => Math.round(v * 100) / 100;
  const measure = [];
  Store.mutate(tl => {
    const t = tl.tracks;
    const track = t.find(x => x.id === trackId);
    if (!track || !_laneTakes(track.kind, data.media)) return;
    const c = (track.clips || []).find(x => x.id === clipId);
    if (!c) return;
    const put = (x) => {
      const sp = Math.max(0.25, Math.min(4, +x.speed || 1));
      x.src = data.src; x.thumb = data.thumb || null; x.name = data.name || ''; x.libId = data.libId || null;
      x.srcDur = known > 0 ? r2(known) : 0;
      x.trimIn = 0; x.trimOut = 0;
      // A picture keeps the place's length (it has none of its own); a film or a sound takes its own.
      if (!still) x.dur = known > 0 ? r2(known / sp) : x.dur;
      if (!still && !(known > 0)) measure.push(x.id);
    };
    put(c);
    if (!c.pairId) return;
    for (const other of t) {
      if (other === track) continue;
      for (const o of [...(other.clips || [])]) {
        if (o.pairId !== c.pairId) continue;
        if (data.media === 'video') { put(o); continue; }
        if (still && other.kind === 'audio') { other.clips = other.clips.filter(x => x !== o); c.pairId = null; continue; }
        o.pairId = null; c.pairId = null;
      }
    }
  });
  if (measure.length) _measure(measure, data.src);
}

function _drop(trackId, want, data) {
  const still = isStill({ src: data.src });
  const known = still ? 0 : (+data.dur || 0);
  const dur = still ? STILL_DUR : (known > 0 ? known : FALLBACK_DUR);
  const at = Math.round(Math.max(0, want) * 100) / 100;
  const pairId = 'p' + _id().slice(1);
  // Made up here so the clips can be found again by the measurement below.
  const vidId = _id(), audId = _id();

  Store.mutate(tl => {
    const t = tl.tracks;
    const track = t.find(x => x.id === trackId);
    // Words lanes hold words: a file dropped on a text lane became a caption reading its file name.
    if (!track || track.kind === 'subs' || track.kind === 'text') return;
    if (!_laneTakes(track.kind, data.media)) return;

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
    // on the audio side means to hear it. A TRACK OF MUSIC (phase V28.4) lies as it is, from where it was let go: a bed
    // under the voices - half volume, never transcribed (captions/heard.js isBed) - and where two beds overlap on
    // one lane they cross into each other by themselves (js/merge-v3/fades.js).
    if (track.kind === 'audio') {
      if (data.bed) track.clips.push({ ...base, id: vidId, volume: 0.5, bed: true, pairId: null });
      else track.clips.push({ ...base, id: vidId, volume: 1, pairId: null });
      return;
    }

    const mate = still ? null : (track.linkId ? t.find(x => x.id === track.linkId) : null);
    const vid = { ...base, id: vidId, volume: 0, pairId: mate ? pairId : null };
    track.clips.push(vid);
    if (mate) {
      mate.clips.push({
        ...base, id: audId, pairId,
        // The one thing the two halves do not share.
        volume: String(data.group || '') === 'birols' ? 0 : 1,
      });
      mate.clips.sort((a, b) => a.start - b.start);
    }
  });

  if (!still && !(known > 0)) _measure([vidId, audId], data.src);
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

// A WHOLE TRACK can be the thing selected, and never at the same time as a clip. The two
// answer different questions - "this piece" and "this lane" - and a panel trying to be about
// both would be about neither. So they share one deselect and take turns.
let _selTrack = '';

function _clearSel() {
  _selBack = null;
  if (!_sel.size && !_selTrack) return;
  _sel.clear();
  _selTrack = '';
  document.querySelectorAll('.mv3b-clip.is-sel').forEach(el => el.classList.remove('is-sel'));
  document.querySelectorAll('.mv3b-row.is-selT').forEach(el => el.classList.remove('is-selT'));
  _afterSelB();
}

function _selectTrack(id) {
  _selBack = null;
  _sel.clear();
  _selTrack = String(id || '');
  _paintSel();
}

// A LANE PICKED LETS GO OF ITSELF at a press anywhere else (the owner, 2026-10-06): the preview, the Library, the
// ruler, the page around - the pick goes and the strip of its settings slides back. Not a press in the strip itself
// (the lane is being set there), not in a window or a menu on top (a question the strip asked), and not on a lane's
// name or a clip: those pick something else. Captured, so a control that keeps its own mousedown still counts.
function _awayFromLane(e) {
  if (!_on || !_selTrack || e.button !== 0) return;
  const t = e.target;
  if (!t || !t.closest) return;
  // Nor in the captions view beside the strip - its preset tiles and their categories set the lane too - nor on the
  // Library's "captions" crumb that picked it (phase V18.2: a press on a category let go of the lane, and the panel went
  // back to the chat under it).
  if (t.closest('#mv3-over, #mv3-cap, #mv3-lib-cap, .mv3b-lbl, .mv3b-clip')) return;
  // Nor, while the captions view is up, on "Library" or a chat's crumb: their own click lets the pick go (lib-views.js
  // toBase). Let go here, at the mousedown, the panel jumped back from the corner under the pointer and the click never
  // landed - "generate video" pressed over the captions showed the shelf (phase V23.5).
  if (Views.isCaptions() && t.closest('#mv3-lib-title, .mv3-lib-crumb')) return;
  const top = Layers.top();
  if (top && top.el && top.el.contains && top.el.contains(t)) return;
  // Nor on a page of captions on the preview (phase V30, block 3): that press picks a lane or moves it (cap-place.js).
  if (_keepPick && _keepPick(e)) return;
  _clearSel();
}

let _keepPick = null;
/** A press that is not "away" from a picked lane though it lands outside the timeline - the preview's caption pages. */
export function keepPickOn(fn) { _keepPick = typeof fn === 'function' ? fn : null; }

const _selSubs = [];
export function onSelChange(cb) { if (typeof cb === 'function') _selSubs.push(cb); }
// HOW MANY THINGS ARE SELECTED, which a track counts towards: the listener on the other side
// opens the panel when something is picked, and a lane is something.
function _afterSelB() {
  const n = _sel.size + (_selTrack ? 1 : 0);
  for (const cb of _selSubs) { try { cb(n); } catch { /* a listener's own trouble */ } }
}

function _paintSel() {
  document.querySelectorAll('.mv3b-clip').forEach(el => {
    el.classList.toggle('is-sel', _sel.has(el.dataset.clip));
  });
  document.querySelectorAll('.mv3b-row').forEach(el => {
    el.classList.toggle('is-selT', !!_selTrack && el.dataset.track === _selTrack);
  });
  _afterSelB();
}

function _beginBand(e) {
  // Not from the label: that is the track's own handle, and a drag starting there is a
  // mis-aimed click rather than the beginning of a rectangle.
  if (e.button !== 0 || e.target.closest('.mv3b-clip') || e.target.closest('.mv3b-lbl') || e.target.closest('.mv3b-ruler')) return;
  const host = _host();
  if (!host || !host.contains(e.target)) return;
  const x0 = e.clientX, y0 = e.clientY;
  const el = document.createElement('div');
  el.className = 'mv3b-band';
  document.body.appendChild(el);
  // The selection is not cleared HERE: a press on bare lane is a seek until it moves, and a
  // sweep that is adding (Shift) keeps what was picked. The moment the press becomes a sweep,
  // _moveBand replaces the selection (or adds to it); let go without sweeping and _endBand
  // clears it. Esc clears without sweeping.
  _band = { x0, y0, el, add: e.shiftKey, moved: false, lane: e.target.closest('.mv3b-lane') };
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
  // A few pixels of wobble under a click is still a click. Past that it is a sweep, and a
  // sweep that is not adding starts from nothing - once, when it becomes one.
  if (!_band.moved) {
    if (w <= 3 && h <= 3) return;
    _band.moved = true;
    _selBack = null;
    if (!_band.add) _clearSel();
  }
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
  const b = _band;
  b.el.remove();
  _band = null;
  // The panels held still while the band was swept (gesture()); now they follow what it picked.
  if (b.moved) _afterSelB();
  // PRESSED ON BARE LANE and let go without sweeping: a seek to the moment under the pointer,
  // AND letting go of whatever was picked - the strip of its settings slides away and the Library
  // is what is left (phase L6, the owner 2026-09-23). It used to keep the pick, so that seeking to
  // look at a clip did not take it out of the panel; that gesture is the RULER's now, which seeks
  // and touches nothing else.
  if (!b.moved && b.lane) {
    const r = b.lane.getBoundingClientRect();
    _seekTo((b.x0 - r.left) / _zoom());
    if (!b.add) _clearSel();
  }
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
    dur0: +c.dur, trimIn0: +c.trimIn || 0, srcDur: +c.srcDur || 0, speed: +c.speed || 1,
    group: edge ? [] : group,
    x0: e.clientX, y0: e.clientY, start0: +c.start,
    id: c.id, from: t.id, kind: t.kind, to: t.id,
    words: t.kind === 'subs' || t.kind === 'text',
    mate: mateClip ? { id: mateClip.id, from: mateTrack.id, kind: mateTrack.kind, to: mateTrack.id } : null,
    el, mateEl: mateClip ? document.querySelector(`.mv3b-clip[data-clip="${mateClip.id}"]`) : null,
    start: +c.start, moved: false,
    // (review V7) A still is no clip for the video chat: it lights no part of the zone.
    still: isStill(c),
  };
  document.body.classList.add('mv3b-dragging');
  e.preventDefault();
}

// How far the HAND has to travel before this is a drag rather than a click. Measured in page
// pixels, not in seconds of timeline: at a high zoom one pixel of movement is a hundredth of a
// second and the clip would creep every time it was picked - and worse, the commit rebuilt the
// timeline, so the element under the pointer was replaced and a double click could never land
// on the same node twice. Nobody presses a mouse button without moving it a little.
const SLOP = 3;

// (phase V7) THE VIDEO CHAT'S ATTACHMENTS TAKE A CLIP FROM A LANE: let go over the part of the zone that takes it
// ([data-drop-kind] - clips from a video lane, sounds from either), the part of its file the lane plays goes there as a
// reference, and the timeline stays as it was. The part is held lit while the clip is over it.
let _dropEl = null;
function _dropAt(e, kind) {
  const at = document.elementFromPoint(e.clientX, e.clientY);
  const z = at && at.closest ? at.closest('[data-drop-kind]') : null;
  if (!z) return null;
  const k = z.dataset.dropKind;
  return (k === 'audio' || (k === 'video' && kind === 'video')) ? z : null;
}
function _hintDrop(el) {
  if (_dropEl === el) return;
  if (_dropEl) _dropEl.classList.remove('is-drop');
  _dropEl = el;
  if (el) el.classList.add('is-drop');
}
function _clipOut(d, kind) {
  let c = null;
  for (const t of ((Store.timeline() || {}).tracks || [])) { c = (t.clips || []).find(x => x.id === d.id); if (c) break; }
  if (!c || !c.src || isStill(c)) return;
  const sp = +c.speed || 1;
  const from = Math.max(0, +c.trimIn || 0);
  const r2 = (v) => Math.round(v * 100) / 100;
  window.dispatchEvent(new CustomEvent('mv3:clip-out', { detail: {
    kind, src: c.src, thumb: c.thumb || '', name: c.name || '', libId: c.libId || '',
    in: r2(from), out: r2(from + (+c.dur || 0) * sp), srcDur: +c.srcDur || 0,
  } }));
}

function _moveDrag(e) {
  if (!_drag) return;
  if (!_drag.moved && Math.abs(e.clientX - _drag.x0) < SLOP && Math.abs(e.clientY - _drag.y0) < SLOP) return;
  // Past the slop the hand has really gone somewhere - up out of the lanes too, which moves no clip.
  _drag.far = true;
  if (!_drag.edge && !_drag.words) _hintDrop(_drag.still ? null : _dropAt(e, _drag.kind));
  const z = _zoom();
  const dx = (e.clientX - _drag.x0) / z;

  // TRIMMING, not moving. The left edge takes from the front - the clip starts later and
  // begins further into its source - and the right edge takes from the back. A source with a
  // known length is the ceiling: a clip cannot be stretched past the film it is made of. A
  // still has no such length, which is why srcDur 0 means "no ceiling" rather than "empty".
  if (_drag.edge) {
    _drag.moved = true;
    const room = _drag.srcDur > 0 ? _drag.srcDur : Infinity;
    // TIMELINE SECONDS ARE NOT SOURCE SECONDS once a clip has a speed. The pointer moves in
    // timeline seconds and the trim is spent in source seconds, so the two are converted
    // between rather than treated as the same number - at 2x, dragging the front in by a
    // second eats two seconds of film.
    const sp = _drag.speed || 1;
    if (_drag.edge === 'in') {
      // A caption has no source behind its front edge: it may be pulled back as far as the start.
      const lo = _drag.words ? -_drag.start0 : -_drag.trimIn0 / sp;
      const hi = _drag.dur0 - 0.1;
      const d = Math.max(lo, Math.min(hi, dx));
      _drag.start = Math.max(0, Math.round((_drag.start0 + d) * 100) / 100);
      _drag.dur = Math.round((_drag.dur0 - d) * 100) / 100;
      _drag.trimIn = Math.max(0, Math.round((_drag.trimIn0 + d * sp) * 100) / 100);
      _drag.el.style.left = (_drag.start * z) + 'px';
    } else {
      const hi = room === Infinity ? Infinity : (room - _drag.trimIn0) / sp;
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

function _endDrag(e) {
  if (!_drag) return;
  const d = _drag;
  _drag = null;
  document.body.classList.remove('mv3b-dragging');
  // Let go over the video chat's attachments (phase V7): the clip goes there, the lanes are drawn back as they were.
  const into = (d.far && !d.edge && !d.words && !d.still && e && e.clientX != null) ? _dropAt(e, d.kind) : null;
  _hintDrop(null);
  if (into) {
    _clipOut(d, into.dataset.dropKind);
    _build();
    return;
  }
  // (review V7) Let go over a chat but not on a part that takes it: nothing happens - not a move of the clip along its
  // lane by however far the hand travelled.
  if (d.far && !d.edge && e && e.clientX != null) {
    const at = document.elementFromPoint(e.clientX, e.clientY);
    if (at && at.closest && at.closest('#mv3-vc, #mv3-pc')) { _build(); return; }
  }
  // Pressed and let go without moving: that is a click, and a click on a clip selects it.
  // One clip, replacing whatever the band had - picking a single thing is how you say "this
  // is the one I want to change", and keeping the old set would make the inspector talk
  // about something else.
  if (!d.moved) {
    _selBack = null;
    _sel.clear();
    _selTrack = '';
    _sel.add(d.id);
    // NO REBUILD. _paintSel toggles the classes, which is the whole of what a selection looks
    // like - and rebuilding threw away the very element the pointer was on, so the second half
    // of a double click landed on a different node and the double click never happened.
    _paintSel();
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
          if (d.edge === 'in') {
            // A CAPTION'S WORDS KEEP THEIR MOMENTS (phase K0): their times run from the caption's
            // start, so moving the start moved every word by as much - the highlight ran late after a
            // trim. They are shifted back, and a word now before the start is dropped.
            if (isHeard(c)) {
              // A line rewritten before K10 is timed for its text first - the person's text is what stays.
              const words = timedWords(c);
              const sh = Math.round(((+d.start || 0) - (+c.start || 0)) * 100) / 100;
              const left = words
                .map(w => ({ ...w, s: Math.round(((+w.s || 0) - sh) * 100) / 100, e: Math.round(((+w.e || 0) - sh) * 100) / 100 }))
                .filter(w => w.e > 0)
                .map(w => ({ ...w, s: Math.max(0, w.s) }));
              if (!left.length) {
                // Every word cut off: what is left is the text, as typed.
                c.words = null;
              } else {
                // Words cut off leave the text too, as a split does - the text and its words say the same.
                if (left.length < words.length || words !== c.words) c.name = left.map(w => w.w).join(' ');
                c.words = left;
              }
            }
            c.start = d.start;
            c.trimIn = d.words ? 0 : d.trimIn;
          } else if (isHeard(c) && (+d.dur || 0) < (+c.dur || 0)) {
            // THE BACK EDGE IS THE FRONT'S MIRROR (K10): a word the edge passes goes, from the words and from
            // the text, and one the edge cuts through ends at the edge. Only what the edge CROSSES (review K10): a
            // word that lay past the old end already (a trim before K10) was not touched by this one and stays.
            const words = timedWords(c);
            const end = Math.round((+d.dur || 0) * 100) / 100;
            const was = Math.round((+c.dur || 0) * 100) / 100;
            const crossed = (w) => (+w.s || 0) < was - 1e-6;
            const left = words.filter(w => !crossed(w) || (+w.s || 0) < end)
              .map(w => (crossed(w) && (+w.e || 0) > end ? { ...w, e: end } : w));
            if (!left.length) c.words = null;
            else {
              if (left.length < words.length || words !== c.words) c.name = left.map(w => w.w).join(' ');
              c.words = left;
            }
          }
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

const _hasClip = (e) => Array.from((e.dataTransfer && e.dataTransfer.types) || []).indexOf(DRAG_TYPE) >= 0;

function _wireLane(lane, t) {
  if (t.kind === 'subs' || t.kind === 'text') return;
  lane.addEventListener('dragover', (e) => {
    if (!_hasClip(e)) return;
    if (!_laneTakes(t.kind, _mediaOfDrag(e.dataTransfer))) { e.dataTransfer.dropEffect = 'none'; return; }
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
    try { data = JSON.parse(e.dataTransfer.getData(DRAG_TYPE)); } catch { return; }
    if (!data || !data.src) return;
    // On a red clip: in its place (phase V28.4).
    const red = e.target && e.target.closest ? e.target.closest('.mv3b-clip.is-gone') : null;
    if (red && red.dataset.track === t.id) { _replace(t.id, red.dataset.clip, data); return; }
    const r = lane.getBoundingClientRect();
    _drop(t.id, (e.clientX - r.left) / _zoom(), data);
  });
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
  // The subtitle lane's square makes TEXT lanes rather than another of itself: there is one
  // transcript and no second one to have, but somebody typing their own words wants a lane
  // for them that the transcription will not overwrite.
  if (t.kind === 'subs' || t.kind === 'text') {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'mv3b-sq';
    const all = ((Store.timeline() || {}).tracks) || [];
    if (t.kind === 'subs') {
      const full = _count(all, 'text') >= MAX_TEXT;
      btn.textContent = '+';
      btn.disabled = full;
      btn.title = full ? 'Two text lanes is the limit'
                       : 'Add a lane for text you type yourself';
      btn.addEventListener('click', (e) => { e.stopPropagation(); addTextTrack(); });
    } else {
      btn.textContent = '\u2212';
      btn.title = 'Remove ' + t.name + ' and the lines on it';
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        askDelete(btn, 'Delete ' + t.name + '?',
          (t.clips || []).length ? (t.clips.length === 1 ? 'Its line goes with it.'
                                                         : 'Its ' + t.clips.length + ' lines go with it.') : '',
          () => removeTrack(t.id));
      });
    }
    box.appendChild(btn);
  } else if (t.kind !== 'subs') {
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
        askDelete(btn, 'Delete ' + t.name + '?',
          t.kind === 'video' && t.linkId ? 'Its audio track goes with it.' : '',
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
  lbl.title = (mate
    ? (t.kind === 'video' ? t.name + ' - its sound is on ' + mate.name
                          : t.name + ' - carries the sound of ' + mate.name)
    : (t.kind === 'video' ? t.name + ' - silent, no audio track paired with it' : t.name))
    + '. Click for its settings.';
  // The NAME is what picks the lane, not the whole row: the row is mostly lane, and a click
  // on lane already means something - it moves the playhead there.
  lbl.addEventListener('mousedown', (e) => { e.stopPropagation(); e.preventDefault(); });
  // A second press on the name lets the lane go and the strip of its settings slides away (the owner, 2026-10-06).
  lbl.addEventListener('click', (e) => { e.stopPropagation(); if (_selTrack === t.id && !_sel.size) _clearSel(); else _selectTrack(t.id); });
  if (_selTrack === t.id) row.classList.add('is-selT');
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
                 (t.kind === 'audio' && !(+c.volume) ? ' is-muted' : '') +
                 (t.kind === 'video' && c.halfer ? ' is-halfer' : '');
  el.dataset.clip = c.id;
  el.dataset.track = t.id;
  // (phase V28.4) Its file was deleted from the library: red, to be replaced (a tile let go on it) or removed.
  if (Store.isGone(c)) {
    el.classList.add('is-gone');
    el.title = (c.name || 'This clip') + ' - its file was deleted from the library. Let a tile from the Library go on it to replace it, or remove it.';
  }
  el.style.left = (c.start * _zoom()) + 'px';
  el.style.width = Math.max(2, c.dur * _zoom()) + 'px';
  if (c.thumb && t.kind === 'video') el.style.backgroundImage = `url('${c.thumb}')`;

  // A HEARD LINE CORRECTED BY HAND carries a small mark (K10b, the owner's answer 6): it is kept by Generate
  // and goes with "back to what was heard". The words themselves are in the strip, not on the clip.
  const fixed = t.kind === 'subs' && isHeard(c) && isCorrected(c);
  if (fixed) {
    el.classList.add('is-fixed');
    const m = document.createElement('span');
    m.className = 'mv3b-fix';
    el.appendChild(m);
  }
  const cap = document.createElement('span');
  cap.className = 'mv3b-clip-t';
  cap.textContent = (Store.isGone(c) ? 'deleted · ' : '') + (c.name || '');
  el.appendChild(cap);

  if (_sel.has(c.id)) el.classList.add('is-sel');
  // A cross on the clip, not only the Delete key: the key needs the clip selected first, and
  // "select then press a key" is two steps to undo one mistake. It asks before acting for the
  // same reason the track squares do - a video clip takes its sound with it, and that is worth
  // saying out loud before it happens rather than after.
  const x = document.createElement('button');
  x.type = 'button';
  x.className = 'mv3b-clipx';
  x.textContent = '×';
  x.title = 'Remove this clip';
  x.addEventListener('mousedown', (e) => e.stopPropagation());   // not a drag
  x.addEventListener('click', (e) => {
    e.stopPropagation();
    askDelete(x, 'Remove ' + short(c.name) + '?',
      t.kind === 'video' && c.pairId ? 'Its sound goes with it.'
        : (t.kind === 'audio' && c.pairId ? 'The picture stays, and goes silent.' : ''),
      () => removeClip(t.id, c.id));
  });
  el.appendChild(x);

  el.addEventListener('mousemove', (e) => {
    if (_drag) return;
    el.style.cursor = _edgeOf(e, el) ? 'ew-resize' : 'grab';
  });
  el.addEventListener('mousedown', (e) => _beginDrag(e, t, c, el));
  // A PICTURE OPENS ITS GENERATOR ON A DOUBLE CLICK. It is the one thing a still is usually
  // put on a timeline to become, and reaching the panel to press a button for it is two moves
  // for something the clip itself can answer. Safe from here: that window writes nothing to
  // any timeline - what it makes goes to the library, and getting it onto the montage is a
  // drag like anything else there.


  el.title = (c.name || 'clip') + (fixed ? ' - corrected by hand' : '') +
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
    if (e.button !== 0) return;
    e.preventDefault();
    const r = lane.getBoundingClientRect();
    const to = (x) => _seekTo((x - r.left) / _zoom());
    to(e.clientX);
    // HELD, it scrubs: the playhead and the picture follow the pointer until it is let go.
    document.body.classList.add('mv3-scrubbing');
    const move = (ev) => to(ev.clientX);
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      document.body.classList.remove('mv3-scrubbing');
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
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

// THE CLOCK ABOVE THE TIMELINE, and the controls that depend on where the playhead is (split).
// Told on every move, which during playback is every frame - so both are a few assignments.
const _headSubs = [];
export function onPlayhead(cb) { if (typeof cb === 'function') _headSubs.push(cb); }
const _clockText = (t) => {
  const s = Math.max(0, t), m = Math.floor(s / 60), r = s - m * 60;
  return m + ':' + (r < 10 ? '0' : '') + r.toFixed(1);
};
function _headMoved() {
  if (!_on) return;
  const c = document.getElementById('mv3-tl-clock');
  if (c) c.textContent = _clockText(_playhead);
  for (const cb of _headSubs) { try { cb(_playhead); } catch { /* a listener's own trouble */ } }
}

function _seekTo(t) {
  _playhead = Math.max(0, Math.round((+t || 0) * 100) / 100);
  const el = _host() && _host().querySelector('.mv3b-head');
  if (el) el.style.left = (GUTTER + _playhead * _zoom()) + 'px';
  _headMoved();
  // The preview is the other half of this workflow, and the playhead belongs to both. seek()
  // calls setPlayhead back, which is harmless: it writes the same number this just wrote.
  import('./preview-b.js').then(P => P.seek(_playhead)).catch(() => {});
}

// ZOOM HOLDS THE PLAYHEAD. Leaving the scroll alone anchors the view to a pixel, and a pixel
// is a different second at every zoom - so the timeline slid sideways under the eye and the
// playhead could end up off screen. Zooming in is looking closer at the moment you are on, so
// that moment is what stays, in the middle of the lanes. The frozen gutter (the square and
// the track name, both sticky) never scrolls, so the strip to centre in begins after it.
// Same rule as the talking-head timeline, which owns the same scroll box.
function _centreOnPlayhead() {
  const host = _host();
  if (!host) return;
  const strip = host.clientWidth - GUTTER;
  if (strip <= 0) return;
  host.scrollLeft = Math.max(0, _playhead * _zoom() - strip / 2);
}

export const playhead = () => _playhead;
export function setPlayhead(t) {
  _playhead = Math.max(0, +t || 0);
  const el = _host() && _host().querySelector('.mv3b-head');
  if (el) el.style.left = (GUTTER + _playhead * _zoom()) + 'px';
  _headMoved();
}

// ── FIT ─────────────────────────────────────────────────────────────────────
// The zoom at which the whole timeline is on screen at once, measured from the scroll box at the
// moment of asking - the columns beside it and its own height are both draggable. The slider is
// moved, not just the drawing, and told so, which is what redraws the lanes and remembers it.
export function fit() {
  const host = _host();
  if (!host || !_on) return;
  const tl = Store.timeline();
  let end = 0;
  for (const t of ((tl && tl.tracks) || [])) for (const c of (t.clips || [])) end = Math.max(end, (+c.start) + (+c.dur));
  const avail = host.clientWidth - GUTTER - 12;
  if (avail <= 0) return;
  const z = document.getElementById('mv3-zoom');
  if (!z) return;
  z.value = String(Math.max(+z.min || 1, Math.min(+z.max || 240, Math.floor(avail / Math.max(end, 1)))));
  z.dispatchEvent(new Event('input'));
  host.scrollLeft = 0;                               // fitted means from the start
}

// ── Split at the playhead ───────────────────────────────────────────────────
// One clip becomes two that play the same source without a seam: the second picks up exactly
// where the first stops. A clip with a sound twin is cut with it, and the two new halves are a
// pair of their own. A line of captions is cut between its words.
const MIN_SPLIT = 0.1;

export function canSplit() {
  if (!_on) return { ok: false, why: 'Nothing to cut here' };
  const one = selectedOne();
  if (!one) return { ok: false, why: 'Select one clip to cut it at the playhead' };
  const s = +one.clip.start, e = s + (+one.clip.dur);
  if (_playhead - s < MIN_SPLIT || e - _playhead < MIN_SPLIT) return { ok: false, why: 'Put the playhead inside the selected clip' };
  // A heard caption is cut BETWEEN its words: a half with none would keep the whole text as a typed copy
  // of the page - and a page stays up past its last word, so that was most of its tail (review K2).
  const words = isHeard(one.clip) ? timedWords(one.clip) : null;
  if (words) {
    // The same rounded moment the cut uses (review K10): a word picked in the strip puts the playhead on its
    // start exactly, and the float difference came out a hair past it - the last word was refused, and a cut
    // before the first word gave a typed copy of the whole text.
    const left = _r2(_r2(_playhead) - s);
    if (!words.some(w => _r2(+w.s) >= left) || !words.some(w => _r2(+w.s) < left)) {
      return { ok: false, why: 'No word starts on that side of the playhead - drag the edge of the line to shorten it' };
    }
  }
  return { ok: true };
}

export function splitAtPlayhead() {
  const can = canSplit();
  if (!can.ok) return can;
  const { clip } = selectedOne();
  const at = _r2(_playhead);
  let made = null;
  Store.mutate(tl => {
    const tracks = tl.tracks || [];
    const newPair = clip.pairId ? 'p' + _id().slice(1) : null;
    const cut = (t, c) => {
      const sp = +c.speed || 1;
      const left = _r2(at - (+c.start));
      const right = _r2((+c.start) + (+c.dur) - at);
      const b = JSON.parse(JSON.stringify(c));
      b.id = _id();
      b.start = at;
      b.dur = right;
      // (phase V23) A sound's fade belongs to its own end: the left half keeps the fade in, the right the fade out.
      delete b.fadeIn;
      delete c.fadeOut;
      if (c.reversed) {
        // Played backwards, the first half on the timeline is the END of the source window.
        b.trimIn = _r2(+c.trimIn || 0);
        c.trimIn = _r2((+c.trimIn || 0) + right * sp);
      } else {
        b.trimIn = _r2((+c.trimIn || 0) + left * sp);
      }
      c.dur = left;
      if (isHeard(c)) {
        // A line rewritten before K10 is timed for its text first: the halves carry the person's words.
        const words = timedWords(c);
        // A word ends where its half does (K10): the left half's last word used to run on past the cut.
        const w0 = words.filter(w => _r2(+w.s) < left).map(w => ((+w.e) > left ? { ...w, e: left } : w));
        // The whole word, mark and all (K2: the right half used to lose `k`).
        const w1 = words.filter(w => _r2(+w.s) >= left)
          .map(w => ({ ...w, s: _r2(Math.max(0, (+w.s) - left)), e: _r2(Math.max(0, (+w.e) - left)) }));
        c.words = w0.length ? w0 : null;
        b.words = w1.length ? w1 : null;
        if (c.words) c.name = c.words.map(w => w.w).join(' ');
        if (b.words) b.name = b.words.map(w => w.w).join(' ');
      }
      if (newPair && b.pairId) b.pairId = newPair;
      // Straight after the original: on a video lane the order of the clips is which one shows,
      // and the second half belongs where the whole clip was.
      t.clips.splice(t.clips.indexOf(c) + 1, 0, b);
      if (t.kind === 'audio') t.clips.sort((x, y) => x.start - y.start);
      return b;
    };
    for (const t of tracks) {
      const c = (t.clips || []).find(x => x.id === clip.id);
      if (c) { made = cut(t, c).id; break; }
    }
    if (clip.pairId) {
      for (const t of tracks) {
        const m = (t.clips || []).find(x => x.id !== clip.id && x.pairId === clip.pairId && (+x.start) < at && (+x.start) + (+x.dur) > at);
        if (m) { cut(t, m); break; }
      }
    }
  });
  // The second half is selected: after a cut, the part not looked at yet is the one about to be
  // worked on.
  if (made) selectClipById(made);
  return { ok: true };
}

// The project the pick was made in (K6b).
let _selKey = null;
// A press that cut the picked captions again moved the pick onto their new pages; this remembers the pick
// before and after it, so Ctrl+Z puts the old pick back and redo the new one (review K6). Any pick made by
// hand forgets it.
let _selBack = null;

// (phase V28.4) THE NOTICE OVER THE TIMELINE: media of this project were deleted from the library - said as it opens, until
// closed (for this opening) or until no red clip is left.
let _goneShut = '';
function _paintGone() {
  const el = document.getElementById('mv3-tl-gone');
  if (!el) return;
  const n = Store.goneCount();
  const key = String(Store.key() || '');
  if (!n || _goneShut === key) { el.hidden = true; el.textContent = ''; if (!n && _goneShut === key) _goneShut = ''; return; }
  el.hidden = false;
  el.textContent = '';
  const t = document.createElement('span');
  t.textContent = n + (n === 1 ? ' piece of media' : ' pieces of media') + ' of this project ' + (n === 1 ? 'was' : 'were')
    + ' deleted from the library - red on the timeline. Let a tile from the Library go on a red clip to replace it, or remove it.';
  el.appendChild(t);
  const x = document.createElement('button');
  x.type = 'button';
  x.className = 'mv3-tl-gone-x';
  x.textContent = '✕';
  x.title = 'Close - the clips stay red';
  x.addEventListener('click', () => { _goneShut = key; _paintGone(); });
  el.appendChild(x);
}

function _build() {
  const host = _host();
  if (!host) return;
  host.textContent = '';
  _paintGone();

  const tl = Store.timeline();
  const tracks = (tl && Array.isArray(tl.tracks)) ? tl.tracks : [];

  // THE PICK FOLLOWS THE TIMELINE (K6b): another project's pick is let go of - every project's subtitle
  // lane is "subs", so a picked lane stayed picked in the next one - and so is a clip that is gone (a
  // re-cut, a lay by the server), which "N clips selected" still counted.
  let lost = false;
  const key = Store.key();
  if (key !== _selKey) {
    _selKey = key;
    if (_sel.size || _selTrack) { _sel.clear(); _selTrack = ''; lost = true; }
  } else if (_sel.size || _selTrack) {
    const have = new Set();
    for (const t of tracks) for (const c of (t.clips || [])) have.add(c.id);
    for (const id of [..._sel]) if (!have.has(id)) { _sel.delete(id); lost = true; }
    if (_selTrack && !tracks.some(t => t.id === _selTrack)) { _selTrack = ''; lost = true; }
  }
  if (_selBack) {
    const depth = History.depth().undo;
    const have = new Set();
    for (const t of tracks) for (const c of (t.clips || [])) have.add(c.id);
    const now = [..._sel];
    const swap = (from, to) => now.every(id => from.has(id)) && [...to].every(id => have.has(id));
    const put = (ids) => { _sel.clear(); for (const id of ids) _sel.add(id); lost = true; };
    if (depth === _selBack.depth - 1 && swap(_selBack.after, _selBack.before)) put(_selBack.before);
    else if (depth === _selBack.depth && swap(_selBack.before, _selBack.after)) put(_selBack.after);
  }
  if (lost) queueMicrotask(_afterSelB);

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
  // The words zone, and it is PINNED TO THE BOTTOM rather than glued under the audio block.
  // Subtitles are the floor of a timeline - they belong to the whole film rather than to the
  // lane above them - and stuck to the audio they moved every time a lane was added or taken
  // away, which is exactly the kind of thing the eye should be able to stop tracking.
  //
  // Text lanes sit ABOVE the subtitles, in the order they were made.
  const subs  = zone('is-subs',  t => t.kind === 'subs' || t.kind === 'text');

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

// Take over the timeline panel - once, from main.js, when the store first has something to show.
export function mount() {
  _on = true;
  document.body.classList.add('mv3-blank');
  _build();
}

export const multiCount = () => _sel.size;

/** Pick one clip, by id - what a click on the PREVIEW means. */
export function selectClipById(id) {
  if (!id || (_sel.size === 1 && _sel.has(id))) return;
  _selBack = null;
  _sel.clear();
  _selTrack = '';
  _sel.add(String(id));
  _paintSel();
}

/** Pick a whole lane, by id - what the Library's "captions" crumb means (phase V18.2): the subtitle lane. */
export function selectTrackById(id) {
  if (!id || (_selTrack === String(id) && !_sel.size)) return;
  _selectTrack(id);
}

/** The selected lane, or null. The inspector asks for this the way it asks for a clip. */
export function selectedTrack() {
  if (!_selTrack) return null;
  const tl = Store.timeline();
  return ((tl && tl.tracks) || []).find(t => t.id === _selTrack) || null;
}

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

// ── Setting one field on one clip ───────────────────────────────────────────
// Everything the inspector offers goes through here, so there is one place that knows a
// change has to be saved and redrawn - and one place that decides what a field means.
//
// NAMED FIELDS ONLY. A key that is not on this list is refused rather than written: a
// misspelt one would otherwise sit on the clip forever as a property nothing reads, and the
// control that wrote it would look like it worked.
const CLIP_FIELDS = new Set(['volume', 'dur', 'speed', 'reversed', 'fit', 'cropAlign',
                             'transition', 'animation', 'filter',
                             'tx', 'ty', 'tw', 'angle', 'feather',
                             'halfer', 'halferPos', 'halferThick', 'halferKeep', 'rotation']);

// THE TWO HALVES OF A PAIR ARE ONE PIECE OF MEDIA. Anything that changes how long it runs or
// which way it runs has to reach both, or the picture and its sound drift apart - and a
// drift is noticed on the export, not while it is being made. Volume is not on this list on
// purpose: it is the one thing the two halves have always disagreed about, which is what
// lets a birol land muted.
const PAIRED = new Set(['dur', 'speed', 'reversed']);
// Effects are NOT on that list: they belong to the picture. The mix reads level, speed,
// direction and trim off a sound clip and nothing else, so a fade written onto one would be
// a setting with nothing to act on.

const _r2 = (v) => Math.round(v * 100) / 100;

function _write(c, key, value) {
  if (key === 'volume') { c.volume = Math.max(0, Math.min(4, +value || 0)); return; }
  if (key === 'dur') { c.dur = Math.max(0.1, _r2(+value || 0)); return; }
  if (key === 'speed') {
    // Same content, faster = shorter. What stays put is the SLICE OF SOURCE in play; what
    // the number changes is how long it takes to get through it. Nothing is clamped against
    // the neighbour the way the other timeline clamps: clips here may overlap, and the one
    // in front simply wins.
    const sp = Math.max(0.25, Math.min(4, +value || 1));
    const srcLen = (+c.dur || 0) * (+c.speed || 1);
    c.speed = sp;
    c.dur = Math.max(0.1, _r2(srcLen / sp));
    return;
  }
  if (key === 'reversed') { c.reversed = !!value; return; }
  if (key === 'fit') { c.fit = (value === 'fill') ? 'fill' : 'fit'; return; }
  // WHERE AN INSERT SITS, all of it in fractions of the frame so a placement means the same
  // thing after the format changes. `tw: null` is not "zero wide" - it is "not placed", which
  // is a different state and the one every clip starts in.
  if (key === 'tw') { c.tw = (value == null) ? null : Math.max(0.04, Math.min(4, +value || 0)); return; }
  if (key === 'tx' || key === 'ty') {
    c[key] = (value == null) ? null : Math.max(0, Math.min(1, +value || 0));
    return;
  }
  if (key === 'angle') { c.angle = (value == null) ? null : Math.max(-180, Math.min(180, +value || 0)); return; }
  if (key === 'feather') { c.feather = (value == null) ? null : Math.max(0, Math.min(0.45, +value || 0)); return; }
  // All five the panel offers. Only three were let through, so top and bottom quietly wrote
  // centre - which the preview and the render then showed, as if the choice had been made.
  if (key === 'cropAlign') {
    c.cropAlign = ['left', 'center', 'right', 'top', 'bottom'].indexOf(String(value)) >= 0 ? String(value) : 'center';
    return;
  }
  // A HALFER BAND (lib/mv3b-render.js bandGeom): a switch and four numbers. The numbers stay on the
  // clip when the switch goes off, so turning it back on finds the band where it was left.
  if (key === 'halfer') { c.halfer = value ? true : null; return; }
  if (key === 'halferPos' || key === 'halferKeep') { c[key] = Math.round(Math.max(0, Math.min(100, +value || 0))); return; }
  if (key === 'halferThick') { c.halferThick = Math.round(Math.max(5, Math.min(100, +value || 0))); return; }
  if (key === 'rotation') { c.rotation = [0, 90, 180, 270].indexOf(+value) >= 0 ? +value : 90; return; }
  // THE THREE EFFECTS, taken as names rather than checked against a list. The list lives in
  // two places already - the panel that offers them and the graph that builds them - and a
  // third copy here would be the one that goes stale. An unknown name is harmless by
  // construction: every switch that reads these falls through to no effect at all.
  if (key === 'transition' || key === 'animation' || key === 'filter') {
    const v = String(value || 'none').slice(0, 24);
    c[key] = (v === 'none') ? null : v;
  }
}

/**
 * Several fields on one clip, in ONE mutation - which is what a placement is: putting a
 * picture on the frame sets its middle, its width and sometimes its turn, and that is one
 * thing the person did, not four.
 */
/**
 * A PICTURE FROM THE PICTURE WINDOW, onto the lane directly above main video at the playhead -
 * over whatever is already there at that moment: clips on a lane may cover one another, and the
 * later one in the lane is drawn on top, so the one underneath stays where it was. With no lane
 * above main (only main exists) one is made in the same step, as + would make it. One mutation,
 * one undo. The new clip is selected, so its panel is the one open.
 *
 * Returns { ok, lane, at } or { ok: false, why }.
 */
export function placeAbove(data, opts) {
  if (!_on) return { ok: false, why: 'The timeline is not showing' };
  const at = _r2(Math.max(0, _playhead));
  const id = _id();
  let lane = '';
  const ok = Store.mutate(tl => {
    const t = tl.tracks || [];
    const vids = t.filter(x => x.kind === 'video');
    let over = vids.length > 1 ? vids[vids.length - 2] : null;
    if (!over) over = _newVideoLane(t);
    if (!over) return;
    over.clips.push({
      id, src: data.src, thumb: data.thumb || data.src, name: String(data.name || '').slice(0, 200),
      libId: data.libId || null, start: at, dur: STILL_DUR, srcDur: 0, trimIn: 0, trimOut: 0,
      speed: 1, reversed: false, transition: null, animation: null, filter: null,
      volume: 0, pairId: null,
    });
    lane = over.name;
  });
  if (!ok || !lane) return { ok: false, why: Store.status() || 'The picture could not be placed' };
  if (!opts || opts.select !== false) selectClipById(id);
  return { ok: true, lane, at };
}

// A CLIP onto the same lane a picture goes to (phase V3, the video chat's "to timeline"): placed by _drop, so it
// arrives at its real length with its sound twin on the lane's linked audio lane, as a clip dropped from the shelf
// does. The lane is made first when there is none - a second step only then; otherwise one undo takes the clip off.
export function placeClipAbove(data) {
  if (!_on) return { ok: false, why: 'The timeline is not showing' };
  const at = _r2(Math.max(0, _playhead));
  let laneId = '', lane = '';
  const find = (t) => { const vids = t.filter(x => x.kind === 'video'); return vids.length > 1 ? vids[vids.length - 2] : null; };
  const now = find((Store.timeline() || {}).tracks || []);
  if (now) { laneId = now.id; lane = now.name; }
  else {
    Store.mutate(tl => { const over = _newVideoLane(tl.tracks || []); if (over) { laneId = over.id; lane = over.name; } });
  }
  if (!laneId) return { ok: false, why: Store.status() || 'The clip could not be placed' };
  _drop(laneId, at, data || {});
  return { ok: true, lane, at };
}

export function setClipFields(trackId, clipId, patch) {
  Store.mutate(tl => {
    const t = (tl.tracks || []).find(x => x.id === trackId);
    const c = t && (t.clips || []).find(x => x.id === clipId);
    if (!c) return;
    for (const k of Object.keys(patch || {})) if (CLIP_FIELDS.has(k)) _write(c, k, patch[k]);
  });
}

export function setClipField(trackId, clipId, key, value) {
  if (!CLIP_FIELDS.has(key)) return;
  Store.mutate(tl => {
    const t = (tl.tracks || []).find(x => x.id === trackId);
    const c = t && (t.clips || []).find(x => x.id === clipId);
    if (!c) return;
    _write(c, key, value);
    if (!c.pairId || !PAIRED.has(key)) return;
    for (const other of (tl.tracks || [])) {
      for (const x of (other.clips || [])) if (x !== c && x.pairId === c.pairId) _write(x, key, value);
    }
  });
}

// ── A value written onto every clip of a lane ───────────────────────────────
// THE STAMP, and it is a stamp rather than an inherited default: choosing a filter for a lane
// writes it into each clip on it, overwriting whatever each one had. That is what the other
// editor does, it is what people expect of a track setting, and it destroys per-clip work in
// one click - which is why Store.mutate takes a history snapshot first and the panel says so
// out loud above the controls.
//
// Volume is NOT stamped and never will be: it is a master that multiplies, so the lane and the
// clip both mean something. Anything on this list means the same thing on a lane as on a clip,
// which is the test for whether stamping it makes sense at all.
const STAMP_FIELDS = new Set(['transition', 'animation', 'filter', 'fit', 'cropAlign']);

export function stampTrack(trackId, patch) {
  Store.mutate(tl => {
    const t = (tl.tracks || []).find(x => x.id === trackId);
    if (!t) return;
    for (const k of Object.keys(patch || {})) {
      if (!STAMP_FIELDS.has(k)) continue;
      for (const c of (t.clips || [])) _write(c, k, patch[k]);
    }
  });
}

/**
 * Back to nothing: the effects and the framing, on the lane's clips.
 *
 * It deliberately leaves speed, trims, placement and levels alone. Those are edits made by
 * hand, one clip at a time, and wiping them from a button called "reset" would be exactly the
 * surprise the stamp warning exists to prevent.
 */
export function resetTrack(trackId) {
  Store.mutate(tl => {
    const t = (tl.tracks || []).find(x => x.id === trackId);
    if (!t) return;
    for (const c of (t.clips || [])) {
      c.transition = null; c.animation = null; c.filter = null;
      c.fit = null; c.cropAlign = null;
    }
  });
}

// ── Captions ────────────────────────────────────────────────────────────────
// A caption is a CLIP like any other: it sits at a moment, it has a length, it is dragged and
// trimmed by its edges and it is removed by its cross. What it does not have is a source -
// which is exactly the state a still already lives in here, so nothing on the timeline needed
// teaching about it. Its text is `name`, the same field every clip carries.

const CAP_DUR = 1.6;

const _words = (tl, id) => (tl.tracks || []).find(x => x.id === id
  && (x.kind === 'subs' || x.kind === 'text'));

/** Put one line on a lane, at a moment - the playhead, when the panel asks. */
export function addCaption(trackId, at, text) {
  Store.mutate(tl => {
    const t = _words(tl, trackId);
    if (!t) return;
    t.clips = (t.clips || []).concat([{
      id: _id(), src: null, thumb: null, name: String(text || 'New line'),
      start: Math.max(0, Math.round((+at || 0) * 100) / 100), dur: CAP_DUR,
      srcDur: 0, trimIn: 0, trimOut: 0, speed: 1, reversed: false,
      transition: null, animation: null, filter: null, volume: null, pairId: null,
    }]).sort((a, b) => a.start - b.start);
  });
}

/**
 * How the subtitle lane is listened to, one field at a time: `{ lang }` - an ISO code, or 'auto' to let
 * the listener tell (phase K1) - and/or `{ engine }` - 'local' for this computer, 'cloud' for Groq
 * (phase K1b). The defaults are not stored. The lines themselves are laid by the server
 * (lib/captions-job.js), not here.
 */
export function setSubsListen(trackId, patch) {
  Store.mutate(tl => {
    const t = (tl.tracks || []).find(x => x.id === trackId && x.kind === 'subs');
    if (!t) return;
    const next = Object.assign({}, t.listen || {}, patch || {});
    if (!next.lang || next.lang === 'auto') delete next.lang;
    if (next.engine !== 'local') delete next.engine;
    t.listen = Object.keys(next).length ? next : null;
  });
}

/**
 * One caption's own text. A TYPED line takes it as it is. A HEARD line keeps its timing (phase K10): the
 * words that stay keep their moments, a word spelled otherwise the moment of its place, new words share
 * the time of what they replace (words.js retext) - they used to be dropped, and the line coloured as one
 * piece. An empty heard line is taken off the lane, in the same step. @returns null, or { why } when the
 * text cannot be timed (no room in the line, too many words) - nothing is changed then.
 */
export function setCaptionText(trackId, clipId, text) {
  let why = null;
  Store.mutate(tl => {
    const t = _words(tl, trackId);
    const c = t && (t.clips || []).find(x => x.id === clipId);
    // Gone (a lay replaced it, or it was deleted): said, not swallowed - the caller still holds what was typed.
    if (!c) { why = 'That line is not on the lane any more'; return; }
    if (!isHeard(c)) { c.name = String(text || '').slice(0, 400); return; }
    const r = retext(c.words, text, c.dur);
    if (r.why) { why = r.why; return; }
    if (r.remove) { t.clips = t.clips.filter(x => x !== c); return; }
    c.words = r.words;
    c.name = r.name;
  });
  return why ? { why } : null;
}

/**
 * A heard caption's words changed by one of the word editor's operations (words.js - replaceAt, cutAt...,
 * K10b): `op(words, clip)` returns { words, name }, { remove: true } or { why }. ONE mutation, one step to
 * undo; nothing is changed when it refuses. `opts.merge`: a series tag - [ and ] pressed twenty times are
 * one step (history.js). @returns null, or { why }.
 */
export function editWords(trackId, clipId, op, opts) {
  let why = null;
  const done = Store.mutate(tl => {
    const t = _words(tl, trackId);
    const c = t && (t.clips || []).find(x => x.id === clipId);
    if (!c || !isHeard(c)) { why = 'That line is not on the lane any more'; return; }
    // A line rewritten before K10 is timed for its text first: the operation works on what is shown.
    const r = op(timedWords(c), c);
    if (!r || r.why) { why = (r && r.why) || 'That cannot be done'; return; }
    if (r.remove) { t.clips = t.clips.filter(x => x !== c); return; }
    c.words = r.words;
    c.name = r.name;
  }, opts);
  if (!why && !done) why = Store.status() || 'This project cannot be edited here';
  return why ? { why } : null;
}

// ── The captions view's document (phase V30, block 2) ───────────────────────
const DOC_CHANGED = 'The line has changed meanwhile - your text was not written over it';
const DOC_GONE = 'That line is not on the lane any more';

/**
 * Lines of a lane of words rewritten from the document (captions/doc.js): `ids` - the lines, next to each other in the
 * document; `painted` - their texts as the document showed them (a line that reads otherwise now was changed meanwhile,
 * by a lay or another device, and nothing is written over it); `op(track, from, makeId)` - doc.js editLine, splitLine,
 * joinLines or rewrite with its texts. ONE mutation, one step to undo; nothing changes when it refuses.
 *
 * THE PICK STAYS ON A LINE. The captions view - and the document in it - follows the pick, so a picked line that went
 * into another (a join) hands the pick to that line, and a picked line taken off (its text emptied) to its neighbour or,
 * with none, to its lane - before the change, or the view would close under the cursor while the store said so.
 * @returns { ids: the new lines, in order } or { why }
 */
export function rewriteLines(trackId, ids, painted, op) {
  const want = (ids || []).map(String);
  if (!want.length || typeof op !== 'function') return { why: DOC_GONE };
  const run = (tl) => {
    const t = _words(tl, trackId);
    if (!t) return { why: DOC_GONE };
    const lines = docLines(t);
    const from = lines.findIndex(c => c.id === want[0]);
    if (from < 0) return { why: DOC_GONE };
    for (let k = 0; k < want.length; k++) {
      const c = lines[from + k];
      if (!c || c.id !== want[k]) return { why: DOC_CHANGED };
      if (painted && painted[k] != null && String(c.name || '') !== String(painted[k])) return { why: DOC_CHANGED };
    }
    const r = op(t, from, _id);
    return r && !r.why ? Object.assign({ t, from, lines }, r) : (r || { why: 'That cannot be done' });
  };
  // A dry run on the timeline as it is: which picked lines go, and where the pick goes with them.
  const dry = run(Store.timeline() || { tracks: [] });
  if (dry.why) return { why: dry.why };
  const was = { sel: new Set(_sel), track: _selTrack };
  const gone = want.filter(id => !dry.ids.includes(id));
  const moved = gone.some(id => _sel.has(id));
  if (moved) {
    _selBack = null;
    for (const id of gone) _sel.delete(id);
    if (dry.ids.length) _sel.add(want[0]);
    else {
      const nb = dry.lines[dry.from + want.length] || dry.lines[dry.from - 1];
      if (nb) _sel.add(nb.id);
      else if (!_sel.size) _selTrack = String(trackId);
    }
  }
  let res = null;
  const done = Store.mutate(tl => {
    const r = run(tl);
    res = r;
    if (!r.why) r.t.clips = r.clips;
  });
  if (!done || !res || res.why) {
    if (moved) { _sel.clear(); for (const id of was.sel) _sel.add(id); _selTrack = was.track; }
    return { why: (res && res.why) || Store.status() || 'This project cannot be edited here' };
  }
  if (moved) _paintSel();
  return { ids: res.ids };
}

/**
 * Many lines given new texts in ONE mutation - "replace all" (phase V30, block 2): `edits` [{ trackId, id, painted,
 * text }]. A line that cannot take its text (a limit; changed meanwhile) is left as it is and named in `refused`; the
 * rest are written. A picked line emptied by it hands the pick to its lane. @returns { done, refused: [{ id, why }] }
 */
export function rewriteEach(edits) {
  const list = (edits || []).filter(e => e && e.id);
  const apply = (tl) => {
    const out = { done: 0, refused: [], removed: [] };
    const byLane = new Map();
    for (const e of list) {
      if (!byLane.has(e.trackId)) byLane.set(e.trackId, []);
      byLane.get(e.trackId).push(e);
    }
    for (const [trackId, mine] of byLane) {
      const t = _words(tl, trackId);
      if (!t) { for (const e of mine) out.refused.push({ id: e.id, why: DOC_GONE }); continue; }
      // From the last line back: an emptied line taken off moves none of the others.
      const order = docLines(t).map(c => c.id);
      mine.sort((a, b) => order.indexOf(b.id) - order.indexOf(a.id));
      for (const e of mine) {
        const lines = docLines(t);
        const i = lines.findIndex(c => c.id === e.id);
        if (i < 0) { out.refused.push({ id: e.id, why: DOC_GONE }); continue; }
        if (e.painted != null && String(lines[i].name || '') !== String(e.painted)) { out.refused.push({ id: e.id, why: DOC_CHANGED }); continue; }
        const r = docEditLine(t, i, e.text, _id);
        if (r.why) { out.refused.push({ id: e.id, why: r.why }); continue; }
        t.clips = r.clips;
        if (!r.ids.length) out.removed.push({ id: e.id, trackId });
        out.done++;
      }
    }
    return out;
  };
  const tl0 = Store.timeline();
  if (!tl0) return { done: 0, refused: list.map(e => ({ id: e.id, why: DOC_GONE })) };
  const dry = apply(JSON.parse(JSON.stringify(tl0)));
  if (!dry.done) return { done: 0, refused: dry.refused };
  const was = { sel: new Set(_sel), track: _selTrack };
  const lost = dry.removed.filter(x => _sel.has(x.id));
  if (lost.length) {
    _selBack = null;
    for (const x of dry.removed) _sel.delete(x.id);
    if (!_sel.size) _selTrack = String(lost[0].trackId);
  }
  let res = null;
  const done = Store.mutate(tl => { res = apply(tl); });
  if (!done || !res) {
    if (lost.length) { _sel.clear(); for (const id of was.sel) _sel.add(id); _selTrack = was.track; }
    return { done: 0, refused: list.map(e => ({ id: e.id, why: Store.status() || 'This project cannot be edited here' })) };
  }
  if (lost.length) _paintSel();
  return { done: res.done, refused: res.refused };
}

/** The caption after this one on its lane, by start - for proofreading on into the next line (K10b). */
export function nextCaption(clipId) {
  const tl = Store.timeline();
  for (const t of ((tl && tl.tracks) || [])) {
    const i = (t.clips || []).findIndex(x => x.id === clipId);
    if (i < 0) continue;
    if (t.kind !== 'subs' && t.kind !== 'text') return null;
    const s = +t.clips[i].start || 0;
    let best = null, bi = -1;
    t.clips.forEach((x, j) => {
      if (j === i || !x || !x.name) return;
      const xs = +x.start || 0;
      if (xs < s || (xs === s && j < i)) return;
      if (!best || xs < (+best.start || 0) || (xs === (+best.start || 0) && j < bi)) { best = x; bi = j; }
    });
    return best ? { track: t, clip: best } : null;
  }
  return null;
}

/**
 * How every caption looks. One style for the lane - they are one set of subtitles.
 *
 * `cut`: the heard lines are cut again by the rules (pages.js) in the SAME mutation - from the lane as it
 * is at that moment, with the style just set. Changing how many words go on a page, or anything that
 * makes a line wider, changes both the setting and the pages it cuts, and two mutations would be two
 * steps to undo for one thing the person did once. Returns the pages laid, or null.
 */
export function setSubsStyle(trackId, patch, cut) {
  let pages = null;
  Store.mutate(tl => {
    const t = _words(tl, trackId);
    if (!t) return;
    t.style = Object.assign({}, t.style || {}, patch || {});
    if (cut && t.kind === 'subs') pages = _recutLane(tl, t);
  });
  return pages;
}

// THE HEARD LINES CUT AGAIN, inside a mutation (K2). The lines somebody typed stay the very same
// objects - their ids, their own style, their place - so a merge with another save still knows them;
// the pages cut from the heard words carry the own look of the lines they came from.
function _recutLane(tl, t) {
  const clips = recutClips(t, tl, _id);
  if (!clips) return null;
  t.clips = clips;
  return clips.filter(isHeard).length;
}

/**
 * The frame's shape, and the heard captions cut again for it - a frame of another width and another
 * automatic size is another set of pages. ONE mutation: one step to undo (it used to be two).
 */
export function setFormat(fmt) {
  return Store.mutate(tl => {
    tl.format = fmt;
    for (const t of (tl.tracks || [])) if (t && t.kind === 'subs') _recutLane(tl, t);
  });
}

/**
 * A CAPTION'S OWN STYLE (phase K0, the owner 2026-10-03): `patch` over the lane's style for these
 * captions - merged into what they already set - or, given null, back to the lane's style. One step to
 * undo however many captions.
 */
export function setCaptionStyle(clipIds, style, opts) {
  const ids = new Set((clipIds || []).map(String));
  if (!ids.size) return;
  const o = opts || {};
  let made = null;
  let gone = null;
  // The pick follows the re-cut only when it was on those captions: a lane's "reset" of the lines with a
  // style of their own must leave the LANE picked (review K6).
  const follow = [...ids].some(id => _sel.has(id));
  const before = new Set(_sel);
  // ONE mutation across every lane of words: a band can take captions of the subtitles and of a text lane
  // at once, and that is one step to undo (K6).
  Store.mutate(tl => {
    for (const t of (tl.tracks || [])) {
      if (!t || (t.kind !== 'subs' && t.kind !== 'text')) continue;
      let touched = false;
      for (const c of (t.clips || [])) {
        if (!ids.has(c.id)) continue;
        touched = true;
        // `style` may be worked out per caption (review K6: Behind fills a box only where there was none).
        const s = typeof style === 'function' ? style(c, t) : style;
        if (s == null) delete c.style;
        // A preset is a whole style (every field), so it REPLACES what the caption wore; a field changed by
        // hand goes on top of it.
        else if (o.replace) c.style = JSON.parse(JSON.stringify(s));
        else c.style = Object.assign({}, c.style || {}, s);
      }
      // A look that changes the cut cuts the picked heard captions again - only them (recutSome).
      if (touched && o.cut && t.kind === 'subs') {
        const r = recutSome(t, tl, ids, _id);
        if (r) {
          gone = (gone || []).concat((t.clips || []).filter(c => ids.has(c.id) && Array.isArray(c.words) && c.words.length).map(c => c.id));
          t.clips = r.clips;
          made = (made || []).concat(r.made);
        }
      }
    }
  });
  // The pick follows its words onto the pages cut from them.
  if (made && follow) {
    for (const id of (gone || [])) _sel.delete(id);
    for (const id of made) _sel.add(id);
    _selBack = { before, after: new Set(_sel), depth: History.depth().undo };
    _paintSel();
  }
}

/**
 * These heard captions cut again by the lane's rules, and only them (K10b, `re-cut this line`: a line grown
 * longer than a page by corrections - a correction itself never cuts). One step to undo; the pick moves onto
 * the new pages and comes back with the undo (`_selBack`). @returns the ids of the new pages, or null.
 */
export function recutLines(trackId, clipIds) {
  const ids = new Set((clipIds || []).map(String));
  let made = null, gone = null;
  const before = new Set(_sel);
  Store.mutate(tl => {
    const t = (tl.tracks || []).find(x => x.id === trackId && x.kind === 'subs');
    if (!t) return;
    const r = recutSome(t, tl, ids, _id);
    if (!r) return;
    gone = (t.clips || []).filter(c => ids.has(c.id) && isHeard(c)).map(c => c.id);
    t.clips = r.clips;
    made = r.made;
  });
  if (made && [...ids].some(id => _sel.has(id))) {
    for (const id of (gone || [])) _sel.delete(id);
    for (const id of made) _sel.add(id);
    _selBack = { before, after: new Set(_sel), depth: History.depth().undo };
    _paintSel();
  }
  return made;
}

// ── The pick, as the panels ask about it (K6) ───────────────────────────────
/** The ids picked. */
export const selectedIds = () => [..._sel];

/** The picked captions - when EVERY picked clip is a caption on a lane of words: [{ track, clip }]; else null. */
export function selectedCaptions() {
  if (!_sel.size) return null;
  const tl = Store.timeline();
  const out = [];
  for (const t of ((tl && tl.tracks) || [])) {
    for (const c of (t.clips || [])) {
      if (!_sel.has(c.id)) continue;
      if (t.kind !== 'subs' && t.kind !== 'text') return null;
      out.push({ track: t, clip: c });
    }
  }
  return out.length ? out : null;
}

/**
 * A band is being swept across the lanes. The captions view and the room it takes must not come and go
 * under the pointer while it is: taking the room shrinks the timeline and moves the lanes away from a band
 * drawn in screen pixels, which emptied the pick, which gave the room back... every frame (review K6).
 */
export const gesture = () => !!(_band && _band.moved);

/** Let go of the pick - "Library" in the captions view's header, a shelf asked for. */
export function clearSelection() { _clearSel(); }

/** The picked lane, or the first picked clip, scrolled into view - the timeline may have just shrunk. */
export function revealSelection() {
  const el = document.querySelector('.mv3b-row.is-selT, .mv3b-clip.is-sel');
  if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

/** The other half of a pair, if this clip has one. The panel says so out loud. */
export function mateOf(clipId) {
  const tl = Store.timeline();
  const tracks = (tl && tl.tracks) || [];
  let me = null, mineTrack = null;
  for (const t of tracks) {
    const c = (t.clips || []).find(x => x.id === clipId);
    if (c) { me = c; mineTrack = t; break; }
  }
  if (!me || !me.pairId) return null;
  for (const t of tracks) {
    if (t === mineTrack) continue;
    const c = (t.clips || []).find(x => x.pairId === me.pairId);
    if (c) return { track: t, clip: c };
  }
  return null;
}
export const deleteMulti = () => _deleteSelected();

// ── The right-click on bare lane (phase L3, the owner 2026-09-23) ───────────
// The playhead goes to the moment under the pointer, and a menu asks what to make THERE. A picture:
// the pictures chat (phase J), whose `to timeline` lays what it makes at the playhead - and what it makes is
// on the images shelf either way (lib/mv3-gens.js). A video: not yet - its window is being rebuilt
// around what a clip is made from (words, a picture), so the row is there, says so and does nothing.
// A right-click on a clip or on a lane's name is not this menu's.
let _ctx = null;
function _closeCtx() {
  if (!_ctx) return;
  _ctx.el.remove();
  document.removeEventListener('mousedown', _ctx.away, true);
  window.removeEventListener('scroll', _closeCtx, true);
  Layers.close(_ctx.layer);
  _ctx = null;
}

function _laneMenu(e) {
  if (!_on || locked()) return;
  const host = _host();
  const t = e.target;
  if (!host || !t || !t.closest || !host.contains(t)) return;
  if (t.closest('.mv3b-clip') || t.closest('.mv3b-lbl')) return;
  const lane = t.closest('.mv3b-lane');
  if (!lane) return;
  e.preventDefault();
  _closeCtx();
  _seekTo((e.clientX - lane.getBoundingClientRect().left) / _zoom());

  const box = document.createElement('div');
  box.className = 'mv3-plus-menu';
  const item = (label, sub, title, on) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'mv3-plus-item';
    b.title = title;
    const s = document.createElement('span');
    s.textContent = label;
    b.appendChild(s);
    const m = document.createElement('small');
    m.textContent = sub;
    b.appendChild(m);
    b.disabled = !on;
    if (on) b.addEventListener('click', (ev) => { ev.stopPropagation(); _closeCtx(); on(); });
    box.appendChild(b);
  };
  // The pictures chat, in the Library panel's place (phase J).
  item('generate image', 'the pictures chat · "to timeline" puts it here',
    'Make a picture with a model - it lands on the images shelf, and "to timeline" lays it at the playhead',
    () => import('./picchat.js').then(m => m.openPictures())
      .catch(err => console.warn('[timeline] the pictures chat did not open:', (err && err.message) || err)));
  // The video chat, the same place (phase V3).
  item('generate video', 'the video chat · "to timeline" puts it here',
    'Make a clip with a model - it lands on the B-roll shelf, and "to timeline" lays it at the playhead',
    () => import('./vidchat.js').then(m => m.openVideos())
      .catch(err => console.warn('[timeline] the video chat did not open:', (err && err.message) || err)));

  // Fixed to the viewport and parked on the body, where the pointer was.
  document.body.appendChild(box);
  const w = box.offsetWidth, h = box.offsetHeight;
  box.style.left = Math.round(Math.max(6, Math.min(window.innerWidth - w - 6, e.clientX))) + 'px';
  box.style.top = Math.round(Math.max(6, Math.min(window.innerHeight - h - 6, e.clientY))) + 'px';
  const away = (ev) => { if (!box.contains(ev.target)) _closeCtx(); };
  // A menu, not a window: Escape closes it first and the page keeps its shortcuts (js/layers.js).
  const layer = Layers.open(box, { modal: false, name: 'timeline menu', onEsc: _closeCtx });
  _ctx = { el: box, away, layer };
  document.addEventListener('mousedown', away, true);
  window.addEventListener('scroll', _closeCtx, true);
}

export function initTimelineB() {
  Store.onChange(() => { if (_on) _build(); });
  const z = document.getElementById('mv3-zoom');
  if (z) z.addEventListener('input', () => { if (_on) { _build(); _centreOnPlayhead(); } });
  // On the document, not the clip: the pointer routinely leaves a 20px-tall element during a
  // drag, and a listener on the clip would drop the gesture the moment it did.
  document.addEventListener('mousemove', _moveDrag);
  document.addEventListener('mouseup', _endDrag);
  document.addEventListener('mousedown', (e) => { if (_on) _beginBand(e); });
  document.addEventListener('mousedown', _awayFromLane, true);
  document.addEventListener('contextmenu', _laneMenu);
  document.addEventListener('mousemove', _moveBand);
  document.addEventListener('mouseup', _endBand);
  document.addEventListener('keydown', (e) => {
    if (!_on) return;
    if (Layers.blocked()) return;          // a window on top owns the keyboard (js/layers.js)
    if (locked()) return;                  // a talking head is being built: the timeline is asleep (js/merge-v3/layout.js)
    // A key something nearer took for itself (the word editor, K10b) is not the timeline's.
    if (e.defaultPrevented) return;
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target.tagName || '')) || !!e.target.isContentEditable;
    // Escape in a TEXT field takes back what was typed there - it does not let go of the line (K10b: it used to,
    // and the caption's text field lost what was typed with the pick). A select, a slider, a colour, a checkbox
    // left focused is not typing: Escape lets go of the pick there as it always did (review K10).
    const t0 = e.target;
    const texty = t0.tagName === 'TEXTAREA' || !!t0.isContentEditable
      || (t0.tagName === 'INPUT' && /^(text|search|number|email|url|tel|password|)$/.test(String(t0.type || '')));
    if (e.key === 'Escape' && !texty) _clearSel();
    // Not while typing: the inspector has fields, and Delete there means a character. And not in a block that
    // keeps its own keys (the words of a caption, where Delete takes a WORD).
    if ((e.key === 'Delete' || e.key === 'Backspace') && !typing && !(e.target.closest && e.target.closest('[data-own-keys]'))) {
      e.preventDefault();
      _deleteSelected();
    }
  });
}


export const isMounted = () => _on;
export { LBL_W };
