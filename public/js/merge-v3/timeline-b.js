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
import { askDelete, short, note } from './ask.js';
import { DRAG_TYPE, DRAG_MEDIA, isStill, STILL_DUR } from './store.js';
import { locked, lanesChanged } from './layout.js';
import { recutClips, recutSome, timedWords } from '../captions/pages.js';
import { retext, isCorrected } from '../captions/words.js';
import { linesOf as docLines, editLine as docEditLine } from '../captions/doc.js';
import * as History from './history.js';
import { isHeard } from '../captions/heard.js';
// (phase V33.2) A filled clip's window over time, kept as the render reads it.
import { normalize as normalizeFrame } from '../framing/path.js';
import { normalize as normalizeCrop } from '../framing/crop.js';
// (phase V65) A clip's opacity and blend mode - one rule for the page and the server.
import { normalizeOpacity, normalizeBlend } from '../overlay/look.js';
import { normalizeColor } from '../overlay/color.js';
import { normalizePitch } from '../sound/pitch.js';
// (phase V84) A clip's effects: the field, its frames on the clip, "Add effect…" at its right button.
import { normalizeFx, spanOf as fxSpanOf } from '../fx/params.js';
import { effectOf as fxEffectOf } from '../fx/effects.js';
import * as FXUI from './fx-ui.js';
// (phase V74) Main video's patterns - a list on its lane (overlay/pattern.js).
import { normalizeLayers } from '../overlay/pattern.js';
// (phase V40, tails (а) and (б)) The subtitles on a split frame's seam, put right in the same step as whatever changed it.
import { placeBySplit } from '../captions/split.js';
// (phase V36, T4) A sound's waveform on its clip.
import { paintWaves, paintWaveAs, onPeaks } from './tl-wave.js';
// (phase V36, T5) A stretch cut out of every lane, the rest moved left.
import { cutRefused, cutScope, rippleCut, MIN_CUT, silenceCut, silenceRefused, mapThrough } from './tl-cut.js';
import { wireSilence, refreshSilence, paintSilence, openSilence } from './tl-silence.js';
import { wireMerge, offerMerge, refreshMerge } from './tl-merge.js';
// (phase V51, points 2 and 4) Ctrl+C / Ctrl+V of the picked clips and text lines - the buffer and the paste.
import { wireClip, copyPicked, paste } from './tl-clip.js';
// (phase V49.1) Refusals and failures in the corner of popups.
import { showError } from '../notice.js';
// (phase V73 block 5, 5c) The lanes' squares, the link mark and the stretch's label as Lucide's icons; its seconds in mono.
import { icon, iconEl } from '../icons.js';
import { figures } from '../num.js';

// A lane's name as it is shown: sentence case ("Main video") - the stored name stays as it is ("main video").
const _shownName = (n) => { const s = String(n || ''); return s.charAt(0).toUpperCase() + s.slice(1); };

// MAIN PLUS THREE, each side. The ceiling is also enforced by the server when it stores a
// timeline, because it belongs to the project rather than to a button that could be missed.
const MAX_PER_SIDE = 4;

const HOST = 'mv3-tl';

let _on = false;        // is this module the one currently showing?

const _host = () => document.getElementById(HOST);

// The label column's width is shared with the CSS (--mv3-lbl-w): the playhead is positioned in pixels,
// so both have to agree. 84 since phase S4 - at 78 "MAIN VIDEO" with its link mark ended in "…". 88 since phase V73 block 5,
// 5c: "Main video" in 500 11 px with its link icon ended in "…" by a pixel at 84.
const LBL_W = 88;
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
  // The new video lane goes on TOP - a new layer sits over what is already there.
  const firstVideo = t.findIndex(x => x.kind === 'video');
  t.splice(firstVideo < 0 ? 0 : firstVideo, 0, v);
  // Its sound goes at the far end of the audio block, which is the mirror of the same place - unless the audio side is full
  // already (beds of music): then the lane is silent, as one whose sound lane was deleted (phase V41: a fifth audio lane was
  // made here, and the server's ceiling dropped one of them on the save).
  if (_count(t, 'audio') < MAX_PER_SIDE) {
    const a = { id: _freshId(t, 'a'), kind: 'audio', name: '', linkId: v.id, main: false,
                volume: null, speed: null, clips: [] };
    v.linkId = a.id;
    const lastAudio = t.map(x => x.kind).lastIndexOf('audio');
    t.splice(lastAudio + 1, 0, a);
  }
  _renumber(t);
  return v;
}

// Inside a mutation: an audio lane on its own at the far end of the audio block - a bed. Null at the ceiling.
function _newAudioLane(t) {
  if (_count(t, 'audio') >= MAX_PER_SIDE) return null;
  const a = { id: _freshId(t, 'a'), kind: 'audio', name: '', linkId: null, main: false,
              volume: null, speed: null, clips: [] };
  const lastAudio = t.map(x => x.kind).lastIndexOf('audio');
  if (lastAudio >= 0) t.splice(lastAudio + 1, 0, a);
  else {
    // No audio lane at all: after the video block, before the words.
    const words = t.findIndex(x => x.kind === 'subs' || x.kind === 'text');
    t.splice(words < 0 ? t.length : words, 0, a);
  }
  _renumber(t);
  return a;
}

/** (phase V66) Inside a mutation: a bed lane at the far end of the audio block (a highlights fragment's music) - null at the ceiling. */
export function newBedLane(tracks) { return _newAudioLane(tracks); }

export function addAudioTrack() {
  Store.mutate(tl => { _newAudioLane(tl.tracks); });
}

// Deleting is asymmetric, and deliberately: a video lane taken away takes its sound with it,
// because the two were one piece of media. A sound lane taken away leaves the picture, which
// simply goes quiet - that is a real thing to want and the only way to mute a lane outright.
// TWO TEXT LANES AND NO MORE. Subtitles are one lane because they are one transcript; typed
// text is a title and a caption and a credit, which is two things at once often enough to be
// worth a second lane and never three - a third is a stack nobody can read past.
export const MAX_TEXT = 2;

export function addTextTrack() {
  Store.mutate(tl => { _newTextLane(tl.tracks); });
}

// Inside a mutation: a text lane, or null at the ceiling (phase V51: a paste makes one too).
function _newTextLane(t) {
  if (_count(t, 'text') >= MAX_TEXT) return null;
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
  return row;
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

// `make` ('video' | 'audio', phase V41, the owner's (о12)): let go above the top video lane or below the bottom audio one,
// the clip goes onto a lane made for it IN THE SAME STEP - a pair of video and its sound, or a sound lane on its own; one
// undo takes both away. Returns { dur, lane } - the clip's length on the timeline and the lane it went on - or null when
// nothing was laid.
function _drop(trackId, want, data, make) {
  const still = isStill({ src: data.src });
  const known = still ? 0 : (+data.dur || 0);
  const dur = still ? STILL_DUR : (known > 0 ? known : FALLBACK_DUR);
  const at = Math.round(Math.max(0, want) * 100) / 100;
  const pairId = 'p' + _id().slice(1);
  // Made up here so the clips can be found again by the measurement below.
  const vidId = _id(), audId = _id();
  let laid = false;
  // (phase V74) A pattern is no clip any more - it is picked in the strip of main video (patterns-ui.js), and nothing offers
  // one to be let go here.

  const ok = Store.mutate(tl => {
    const t = tl.tracks;
    let track = null;
    if (make) {
      if (!_laneTakes(make, data.media)) return;
      track = make === 'video' ? _newVideoLane(t) : _newAudioLane(t);
    } else track = t.find(x => x.id === trackId);
    // Words lanes hold words: a file dropped on a text lane became a caption reading its file name.
    if (!track || track.kind === 'subs' || track.kind === 'text') return;
    if (!_laneTakes(track.kind, data.media)) return;
    laid = track.id;

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
      // (phase V34.E) A sound of SFX - own or built-in: full volume, never transcribed (captions/heard.js isBed).
      else if (data.group === 'sounds' || data.group === 'sfx') track.clips.push({ ...base, id: vidId, volume: 1, sfx: true, pairId: null });
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

  if (!ok) laid = false;
  if (laid && !still && !(known > 0)) _measure([vidId, audId], data.src);
  return laid ? { dur: Math.round(dur * 100) / 100, lane: laid } : null;
}

// Deleting is asymmetric for the same reason it is asymmetric for lanes: the picture owns the
// sound, not the other way round. Removing the picture removes the piece of media; removing
// the sound leaves the picture, silent.
export function removeClip(trackId, clipId) {
  Store.mutate(tl => { _removeIn(tl.tracks, trackId, clipId); });
}

// Inside a mutation: the clip off its lane, by the rule above.
function _removeIn(t, trackId, clipId) {
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
}

// ── Selecting several at once ───────────────────────────────────────────────
// Shift held, drag across empty lane and a band follows the pointer (without Shift that drag is the playhead's - phase
// V36, T2); everything it TOUCHES is taken,
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
  // (phase V49.1) Nor in the corner of popups: closing one changes nothing on the timeline.
  // (phase V66.1) Nor on the buttons of a highlights project's ticked fragments over the timeline - they pick the lanes.
  if (t.closest('#mv3-over, #mv3-cap, #mv3-lib-cap, .mv3b-lbl, .mv3b-clip, .sv3-toasts, .mv3-hlg-panel')) return;
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

// (phase V51, point 3, the owner's (пр51)) PICKED CLIPS LET GO OF THEMSELVES at a press anywhere else, as a lane does - the
// Library, the tiles of highlights, the page around - and the strip of their settings slides back. Not a press in that strip
// or the captions view (they are being set there), on the buttons over the timeline (split, cut silence, undo, the transport,
// the zoom, FIT - they work on the pick), on the ruler (the playhead walks over the picked clip), in a window, a menu or a
// popup on top ("Merge N clips into one?" among them); not on a clip or a lane's name (they pick, Shift adds). On the lanes
// the band decides: pressed and let go on bare lane it lets go (_endBand), a sweep picks. On the PREVIEW the press is the
// preview's first: on a picture it picks or moves it (place-b.js), on a page of captions it picks that (cap-place.js) - only
// a press on neither lets go (_afterPreviewPress). Captured, so a control that keeps its own mousedown still counts.
const _onPreview = (t) => !!(t && t.tagName === 'CANVAS' && t.closest && t.closest('#mv3-stage'));
const _brollUp = () => !!document.querySelector('#mv3-br.is-shown');
let _pvPress = null;           // the pick as a press on the preview found it, until that press has been the preview's
let _pvPicked = false;         // that press picked the picture under it (place-b.js selectClipById) - the one picked already too
function _awayFromClip(e) {
  _pvPress = null;
  _pvPicked = false;
  if (!_on || !_sel.size || e.button !== 0 || locked() || Layers.blocked()) return;
  const t = e.target;
  if (!t || !t.closest) return;
  if (_onPreview(t)) { _pvPress = [..._sel].join(' '); return; }
  // (phase V62, the owner 2026-10-31: "выделение не снимается с фрагмента таймлайна пока пользователь не сменит крошку") Nor in
  // the view "b-roll" of the Library panel and on its crumb: another item is chosen there FOR the picked piece.
  if (t.closest('#mv3-over, #mv3-cap, #mv3-lib-cap, #mv3-br, #mv3-lib-br, .sv3-toasts, #mv3-timeline > .mv3-panel-head, .mv3b-row.is-ruler, .mv3b-clip, .mv3b-lbl')) return;
  // While that view is up, nothing but another crumb of the panel lets the pick go (a clip or the band on the lanes picks anew).
  if (_brollUp() && !t.closest('#mv3-lib-title, .mv3-lib-crumb')) return;
  // While the captions view is up, "Library" and a chat's crumb let the pick go by their own click (lib-views.js toBase).
  if (Views.isCaptions() && t.closest('#mv3-lib-title, .mv3-lib-crumb')) return;
  const top = Layers.top();
  if (top && top.el && top.el.contains && top.el.contains(t)) return;
  const host = _host();
  if (host && host.contains(t) && e.clientX >= host.getBoundingClientRect().left + GUTTER && !t.closest('.mv3b-box')) return;
  _clearSel();
}
function _afterPreviewPress(e) {
  const was = _pvPress;
  _pvPress = null;
  if (was == null || !_on || !_sel.size || e.button !== 0 || _brollUp()) return;
  // A picture picked, moved, sized or turned, a page of captions taken: the preview's gesture, not a press away.
  if (_pvPicked || e.defaultPrevented || [..._sel].join(' ') !== was || (_keepPick && _keepPick(e))) return;
  _clearSel();
}

const _selSubs = [];
export function onSelChange(cb) { if (typeof cb === 'function') _selSubs.push(cb); }
// HOW MANY THINGS ARE SELECTED, which a track counts towards: the listener on the other side
// opens the panel when something is picked, and a lane is something.
function _afterSelB() {
  const n = _sel.size + (_selTrack ? 1 : 0);
  for (const cb of _selSubs) { try { cb(n); } catch { /* a listener's own trouble */ } }
  // (phase V44) "cut silence" is live while there is something picked to cut in.
  refreshSilence();
  // (phase V45) An offer to merge belongs to the pick it was made for.
  refreshMerge();
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

// THE PLAYHEAD GOES WHERE THE PRESS IS, AND FOLLOWS IT WHILE HELD (phase V36, T2; the owner 2026-10-23, (у9), (ф6): "я мог
// перетаскивать плейхед только кликнув на него, если я промахивался то он не перетаскивался"): a press on the ruler or on bare
// timeline - a lane where no clip is, the seam, the room between the blocks - puts the playhead there and drags it until the
// button is let go. A press on a clip still takes the clip; the band that picks several is drawn with Shift held.
// The moment under the pointer is read off the lanes' left edge - the same GUTTER the playhead is drawn from.
function _timeAtX(x) {
  const host = _host();
  const inner = host && host.querySelector('.mv3b-inner');
  if (!inner) return 0;
  return Math.max(0, (x - inner.getBoundingClientRect().left - GUTTER) / _zoom());
}

// PLAYING, THE PLAYHEAD DRAGGED HOLDS IT STILL (phase V41, the owner's (о9): "как в CapCut и Premiere"): the press pauses
// the preview, the picture follows the pointer, and playing goes on from where the button is let go - not past the end.
function _scrub(e) {
  e.preventDefault();
  const P = _P;
  const held = !!(P && P.isPlaying && P.isPlaying());
  if (held) P.pause();
  _seekTo(_timeAtX(e.clientX));
  document.body.classList.add('mv3-scrubbing');
  const move = (ev) => _seekTo(_timeAtX(ev.clientX));
  const up = () => {
    document.removeEventListener('mousemove', move);
    document.removeEventListener('mouseup', up);
    document.body.classList.remove('mv3-scrubbing');
    if (held && _playhead < P.duration() - 0.05) P.play();
  };
  document.addEventListener('mousemove', move);
  document.addEventListener('mouseup', up);
}

function _beginBand(e) {
  // Not from the label or the square beside it: that is the track's own handle, and a drag starting there is a
  // mis-aimed click rather than the beginning of a rectangle - nor a seek.
  if (e.button !== 0 || e.target.closest('.mv3b-clip') || e.target.closest('.mv3b-lbl') || e.target.closest('.mv3b-box')
      || e.target.closest('.mv3b-ruler')) return;
  const host = _host();
  if (!host || !host.contains(e.target)) return;
  // In the frozen gutter on the left (the squares and the names stay there whatever the scroll), even between the blocks
  // where no name is drawn: nothing.
  if (e.clientX < host.getBoundingClientRect().left + GUTTER) return;
  // (phase V45, the owner's (ю4): "плейхед мы можем двигать только по линейке, выделение в поле дорожек выделяет фрагменты
  // дорожек (без shift)") A press on bare lanes and a sweep is the BAND - it picks what it touches, in place of what was
  // picked, or added to it with Shift held; let go without sweeping, it lets go of the pick. The playhead is the ruler's.
  const x0 = e.clientX, y0 = e.clientY;
  const el = document.createElement('div');
  el.className = 'mv3b-band';
  document.body.appendChild(el);
  // The moment the press becomes a sweep, _moveBand takes what it touches; Esc clears without sweeping.
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
    // (phase V36, T5) Clips picked: a drawn stretch goes, so Delete means them.
    _letRangeGo();
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
  // The panels held still while the band was swept (gesture()); now they follow what it picked - and (phase V45) clips in a
  // row are offered to be merged.
  if (b.moved) { _afterSelB(); offerMerge(); }
  // PRESSED ON BARE LANE and let go without sweeping: whatever was picked is let go of - the strip of its settings slides
  // away and the Library is what is left (phase L6). The playhead stays: since phase V45 (ю4) it is moved by the ruler only.
  if (!b.moved && !b.add) _clearSel();
}

// Everything selected, deleted in one go. A pair still goes as a pair - _removeIn owns that
// rule, and running it per clip keeps the one place that knows it. (phase V54, the owner's (зв11) б) ONE mutation - one step
// to undo, however many there were: "Delete N clips" and the Delete key took N steps.
function _deleteSelected() {
  if (!_sel.size) return;
  const tl = Store.timeline();
  if (!tl || !Array.isArray(tl.tracks)) return;
  const jobs = [];
  for (const t of tl.tracks) for (const c of (t.clips || [])) if (_sel.has(c.id)) jobs.push([t.id, c.id]);
  _clearSel();
  if (jobs.length) Store.mutate(x => { for (const [tid, cid] of jobs) _removeIn(x.tracks, tid, cid); });
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

// Where a clip may go: video to video, audio to audio. A subtitle lane takes neither. Not a lane scrolled under the ruler or
// the words block stuck to the floor (phase V41): what cannot be seen there takes nothing.
function _laneUnder(y, kind) {
  const host = _host();
  const cover = host ? [...host.querySelectorAll('.mv3b-row.is-ruler, .mv3b-zone.is-subs.has-words')] : [];
  if (kind === 'video' || kind === 'audio') {
    for (const c of cover) { const b = c.getBoundingClientRect(); if (y >= b.top && y <= b.bottom) return null; }
  }
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

// ── A stretch drawn over a wave, cut out of every lane (phase V36, T5) ──────
// The owner 2026-10-23, (у8): "протянуть мышью по волне и Delete" - the stretch goes from EVERY lane and what is after it
// moves left (js/merge-v3/tl-cut.js; captions by js/captions/cut.js). A sound clip has two places to press: the strip on
// top with its name takes the clip as every clip is taken (moved, picked by a click), the WAVE under it draws a stretch
// of time - as in a sound editor; its edges still trim. The stretch is drawn across all lanes; Delete cuts it, Escape or
// a press on a clip lets it go; a press on the ruler or bare lane keeps it (to listen to it before cutting).
// (phase V82, the owner 2026-11-09) Not every lane when the sound under it is tied to no picture: the stretch remembers the
// lane it was drawn on, and tl-cut.js cutScope says what it cuts - every lane, or that lane alone (and the subtitles with main
// audio); the band is drawn over what it cuts.
let _range = null;              // { a, b, lane } in timeline seconds, while a stretch is drawn
let _ranging = null;            // the gesture drawing it
const WAVE_TOP = 12;            // where a sound clip's wave begins, px below its top (css/mv3-timeline.css)

function _onWave(e, el) {
  if (!el.querySelector('.mv3b-wave') || _edgeOf(e, el)) return false;
  return e.clientY - el.getBoundingClientRect().top >= WAVE_TOP;
}

function _beginRange(e, t, c, el) {
  _ranging = { x0: e.clientX, t0: _timeAtX(e.clientX), moved: false, id: c.id, lane: t.id };
  e.preventDefault();
}

function _moveRange(e) {
  if (!_ranging) return;
  if (!_ranging.moved) {
    if (Math.abs(e.clientX - _ranging.x0) < SLOP) return;
    _ranging.moved = true;
    // What is picked now is the stretch: the clips let go, so Delete can mean only one thing.
    _clearSel();
    document.body.classList.add('mv3b-ranging');
  }
  const end = Math.max(Store.duration(), 0);
  const t1 = Math.min(end, _timeAtX(e.clientX));
  const t0 = Math.min(end, _ranging.t0);
  _range = { a: _r2(Math.min(t0, t1)), b: _r2(Math.max(t0, t1)), lane: _ranging.lane };
  _paintRange();
}

function _endRange(e) {
  if (!_ranging) return;
  const g = _ranging;
  _ranging = null;
  document.body.classList.remove('mv3b-ranging');
  if (g.moved) {
    if (_range && _range.b - _range.a < MIN_CUT) { _range = null; _paintRange(); }
    return;
  }
  // A click on the wave: the clip is picked, as a click on any clip picks it - and a stretch drawn before goes.
  _letRangeGo();
  // (phase V45, (ю4)) With Shift held it is added to the pick, or taken out of it.
  if (e && e.shiftKey) { _togglePick(g.id); return; }
  _selBack = null;
  _sel.clear();
  _selTrack = '';
  _sel.add(g.id);
  _paintSel();
}

// (phase V45, the owner's (ю4): "с зажатым shift выделение по одному фрагменту кликом") A clip clicked with Shift held joins
// the pick - or leaves it - and clips in a row are offered to be merged.
function _togglePick(id) {
  _selBack = null;
  _selTrack = '';
  if (_sel.has(id)) _sel.delete(id); else _sel.add(id);
  _paintSel();
  offerMerge();
}

function _letRangeGo() {
  if (!_range) return;
  _range = null;
  _paintRange();
}

// What the drawn stretch cuts (phase V82): every lane, or its own lane alone - tl-cut.js cutScope.
function _rangeScope() {
  if (!_range || !_range.lane) return { all: true };
  return cutScope(Store.timeline(), _range.lane, _range.a, _range.b);
}

// The stretch over the lanes: one element in the stack, under the playhead and the frozen names - and a copy inside the
// words block while it sticks to the floor (phase V41: it is a layer of its own over the lanes, and the stretch cuts its
// lines too). Its label lives in the ruler, which stays in sight. (phase V82) A stretch that cuts its own lane alone lies in
// that lane only - and in the subtitle lanes when it is main audio.
function _paintRange() {
  refreshSilence();
  const host = _host();
  const inner = host && host.querySelector('.mv3b-inner');
  if (!inner) return;
  inner.querySelectorAll('.mv3b-range').forEach(el => el.remove());
  if (!_range) { inner.querySelectorAll('.mv3b-range-t').forEach(el => el.remove()); return; }
  const z = _zoom();
  const w = Math.max(1, (_range.b - _range.a) * z) + 'px';
  const scope = _rangeScope();
  const band = () => { const el = document.createElement('div'); el.className = 'mv3b-range'; return el; };
  if (scope.all) {
    const words = inner.querySelector(':scope > .mv3b-zone.is-subs.has-words');
    for (const p of [inner, words]) {
      if (!p) continue;
      const el = band();
      // Under the playhead's line, which shares its layer (phase V49.1): put before it.
      p.insertBefore(el, p.querySelector(':scope > .mv3b-head'));
      el.style.left = (GUTTER + _range.a * z) + 'px';
      el.style.width = w;
    }
  } else {
    const tl = Store.timeline();
    for (const t of ((tl && tl.tracks) || [])) {
      if (t.id !== scope.lane && !(scope.subs && t.kind === 'subs')) continue;
      const lane = inner.querySelector(`.mv3b-row[data-track="${CSS.escape(t.id)}"] .mv3b-lane`);
      if (!lane) continue;
      const el = band();
      el.classList.add('is-lane');
      lane.appendChild(el);
      el.style.left = (_range.a * z) + 'px';
      el.style.width = w;
    }
  }
  const ruler = inner.querySelector('.mv3b-ruler');
  if (!ruler) return;
  let lbl = ruler.querySelector('.mv3b-range-t');
  if (!lbl) {
    // (phase V41) THE LABEL IS A BUTTON: a press cuts, as Delete does. Its own press is not the ruler's (a seek).
    lbl = document.createElement('button');
    lbl.type = 'button';
    lbl.className = 'mv3b-range-t';
    lbl.addEventListener('mousedown', (e) => { e.stopPropagation(); e.preventDefault(); });
    lbl.addEventListener('click', (e) => { e.stopPropagation(); cutRange(); });
    // (phase V73 block 5, 5c) Lucide's scissors in place of "✂", the seconds in mono
    lbl.append(iconEl('scissors', 10), document.createElement('span'));
    ruler.appendChild(lbl);
  }
  lbl.title = scope.all
    ? 'Cut this stretch out of every lane - or press Delete'
    : 'Cut this stretch out of this lane only - no picture is tied to this sound. Or press Delete';
  lbl.style.left = (_range.a * z + 2) + 'px';
  lbl.lastChild.replaceChildren(figures((_range.b - _range.a).toFixed(2) + ' s · Delete'));
}

/**
 * Cut the drawn stretch out of every lane and move what is after it left - one step to undo. A talking head's lines are
 * not cut (its script lays them): refused in words, on the stretch. The playhead goes to where the cut was. (phase V82) A
 * sound tied to no picture is cut out of its own lane alone (tl-cut.js cutScope).
 */
export function cutRange() {
  if (!_range) return { ok: false, why: 'Draw a stretch over a wave first' };
  const { a, b, lane } = _range;
  const why = cutRefused(Store.timeline(), a, b, _rangeScope());
  if (why) {
    const at = _host() && _host().querySelector('.mv3b-range-t, .mv3b-range');
    if (at) note(at, 'Not cut', why);
    return { ok: false, why };
  }
  _clearSel();
  const ok = Store.mutate(tl => rippleCut(tl, a, b, { newId: _id, isStill, only: lane ? cutScope(tl, lane, a, b) : null }));
  _range = null;
  _paintRange();
  if (ok) _seekTo(a);
  return { ok: !!ok };
}

// ── Cut silence (phase V44) ─────────────────────────────────────────────────
// The window is js/merge-v3/tl-silence.js; the pick it listens in and the cut are the timeline's.

// What "cut silence" listens in (ы1): the stretch drawn over a wave, or the time the picked clips take (each its own) -
// null with nothing picked.
function _silenceSpan() {
  if (_range) return [[_range.a, _range.b]];
  if (!_sel.size) return null;
  const tl = Store.timeline();
  const out = [];
  for (const t of ((tl && tl.tracks) || [])) {
    for (const c of (t.clips || [])) if (_sel.has(c.id) && +c.dur > 0) out.push([+c.start || 0, (+c.start || 0) + (+c.dur || 0)]);
  }
  out.sort((x, y) => x[0] - y[0]);
  const joined = [];
  for (const p of out) {
    const last = joined[joined.length - 1];
    if (last && p[0] <= last[1]) last[1] = Math.max(last[1], p[1]); else joined.push(p);
  }
  return joined.length ? joined : null;
}

// Every pause found, shortened at once on every lane - one step to undo (js/merge-v3/tl-cut.js silenceCut). The playhead
// stays on the moment it was on; the pick goes (its clips were cut into pieces).
function _silenceCut(cuts) {
  const why = silenceRefused(Store.timeline(), cuts);
  if (why) return { ok: false, why };
  const at = mapThrough(cuts, _playhead);
  _clearSel();
  const ok = Store.mutate(tl => silenceCut(tl, cuts, { newId: _id, isStill }));
  if (!ok) return { ok: false, why: Store.status() || 'Not cut' };
  _range = null;
  _paintRange();
  _seekTo(at);
  return { ok: true };
}

function _beginDrag(e, t, c, el) {
  if (e.button !== 0) return;
  // (phase V36, T5) On a sound's wave the press draws a stretch of time, not the clip.
  if (t.kind === 'audio' && _onWave(e, el)) { _beginRange(e, t, c, el); return; }
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
    // (phase V82, (тб5)) Played backwards, the timeline's left edge is the END of the file's window: trims mirror.
    reversed: !!c.reversed && !isStill(c),
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

// (phase V82) A clip's wave as its edge is being dragged - its start, length and trimIn are the hand's until it lets go.
function _waveAsDragged(el) {
  const cv = el && el.querySelector(':scope > canvas.mv3b-wave');
  const c = el && el.__clip;
  if (!cv || !c || !_drag) return;
  const now = { ...c, start: _drag.start != null ? _drag.start : c.start, dur: _drag.dur != null ? _drag.dur : c.dur,
    trimIn: _drag.trimIn != null ? _drag.trimIn : c.trimIn };
  paintWaveAs(_host(), cv, now, _zoom(), GUTTER);
}

// (phase V82, the owner 2026-11-09: "призрачный обрезок показывать слева и справа при сдвиге краев") The clip as it was when an
// edge was taken, faint and under it - a sound with its wave: what the edge trims shows beside the clip, left or right; what an
// edge adds needs none (the clip shows it). Gone with the next build, or at the let-go.
function _ghostOf(el) {
  if (!el || !el.parentElement) return null;
  const g = document.createElement('div');
  g.className = 'mv3b-ghost' + (el.classList.contains('is-audio') ? ' is-audio' : '');
  g.style.left = el.style.left;
  g.style.width = el.style.width;
  g.style.top = el.offsetTop + 'px';
  g.style.height = el.offsetHeight + 'px';
  if (el.style.backgroundImage) g.style.backgroundImage = el.style.backgroundImage;
  el.parentElement.insertBefore(g, el);
  if (el.__clip && el.querySelector(':scope > canvas.mv3b-wave')) {
    const cv = document.createElement('canvas');
    cv.className = 'mv3b-wave';
    g.appendChild(cv);
    g.__clip = { ...el.__clip };
    paintWaveAs(_host(), cv, g.__clip, _zoom(), GUTTER);
  }
  return g;
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
    // (phase V49) The shortest a trim leaves a clip is 0.1 s - or the clip's own length when it is shorter already (a piece a
    // cut left): grabbing the edge of a piece of 0.05 s made it 0.1 s, and it ran over the piece beside it.
    const minD = Math.min(0.1, _drag.dur0);
    const rev = _drag.reversed;
    // (phase V82) The ghost of the clip as it was, under it: what an edge takes off shows beside it while the hand moves.
    if (!_drag.ghosts) _drag.ghosts = [_ghostOf(_drag.el), _ghostOf(_drag.mateEl)].filter(Boolean);
    if (_drag.edge === 'in') {
      // A caption has no source behind its front edge: it may be pulled back as far as the start. (phase V82) Nothing is
      // pulled back past the timeline's start - the clip stopped at 0 while its length grew on, and what it played slid.
      // Backwards, pulling it back takes the file AFTER its window.
      let lo = -_drag.start0;
      if (!_drag.words) lo = Math.max(lo, rev ? (room === Infinity ? -Infinity : _drag.dur0 - (room - _drag.trimIn0) / sp) : -_drag.trimIn0 / sp);
      const hi = _drag.dur0 - minD;
      const d = Math.max(Math.min(0, lo), Math.min(hi, dx));
      _drag.start = Math.max(0, Math.round((_drag.start0 + d) * 100) / 100);
      _drag.dur = Math.round((_drag.dur0 - d) * 100) / 100;
      // Backwards, the left edge is the window's end: where the file is read from stays.
      _drag.trimIn = rev ? _drag.trimIn0 : Math.max(0, Math.round((_drag.trimIn0 + d * sp) * 100) / 100);
      _drag.el.style.left = (_drag.start * z) + 'px';
    } else {
      // Backwards, the right edge is the window's START: it may be pulled on only while the file has a beginning before it.
      const hi = rev ? _drag.dur0 + _drag.trimIn0 / sp : (room === Infinity ? Infinity : (room - _drag.trimIn0) / sp);
      const d = Math.max(minD - _drag.dur0, Math.min(hi - _drag.dur0, dx));
      _drag.dur = Math.round((_drag.dur0 + d) * 100) / 100;
      if (rev) _drag.trimIn = Math.max(0, Math.round((_drag.trimIn0 - d * sp) * 100) / 100);
    }
    _drag.el.style.width = Math.max(2, _drag.dur * z) + 'px';
    if (_drag.mateEl) {
      _drag.mateEl.style.left = ((_drag.start != null ? _drag.start : _drag.start0) * z) + 'px';
      _drag.mateEl.style.width = Math.max(2, _drag.dur * z) + 'px';
    }
    // (phase V82, the owner 2026-11-09) The wave stays where its sound is: drawn again for the clip as the edge leaves it - only
    // the part trimmed goes, nothing slides with the edge.
    _waveAsDragged(_drag.el);
    _waveAsDragged(_drag.mateEl);
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
  for (const g of (d.ghosts || [])) g.remove();
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
    // (phase V36, T5) A clip picked lets a drawn stretch go: Delete is the clip's again.
    _letRangeGo();
    // (phase V45, (ю4)) With Shift held, one clip at a time: added to the pick, or taken out of it.
    if (e && e.shiftKey) { _togglePick(d.id); return; }
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
          // (phase V82, (тб5)) Backwards, the right edge moves where the file is read from.
          if (d.edge === 'out' && d.reversed && d.trimIn != null) c.trimIn = d.trimIn;
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

// ── Files from Explorer (phase V41, the owner's (о13), (о13а)) ──────────────
// Let go on a lane or where a drop makes one (_wireGhost), each file is COPIED INTO THE LIBRARY first - a video onto
// VIDEO -> Uploads with no category, a picture into IMAGES, a sound into AUDIO -> Music; the same file never twice
// (lib/drop-file.js, POST /api/mv3/drop-file) - and then laid as a tile from the Library is: at the pointer, the next one
// straight after it on the same lane. What the lane does not take is said, not laid. Several at once go one after another.
const _hasFiles = (e) => Array.from((e.dataTransfer && e.dataTransfer.types) || []).indexOf('Files') >= 0;
const _FILE_RE = { video: /\.(mp4|webm|mov|m4v|avi|mkv)$/i, audio: /\.(mp3|wav|m4a|aac|ogg|oga|flac|opus)$/i,
                   image: /\.(jpe?g|png|webp|gif|avif|tiff?|bmp|heic|heif)$/i };

function _typeMedia(type) {
  const t = String(type || '');
  return /^video\//.test(t) ? 'video' : /^image\//.test(t) ? 'image' : /^audio\//.test(t) ? 'audio' : '';
}
// While the files are dragged only their types can be read: one kind for all of them, or '' (mixed, or not known yet).
function _fileMedia(dt) {
  const kinds = new Set(Array.from((dt && dt.items) || []).filter(i => i.kind === 'file').map(i => _typeMedia(i.type)));
  return kinds.size === 1 ? [...kinds][0] : '';
}
function _mediaOfFile(f) {
  const m = _typeMedia(f && f.type);
  if (m) return m;
  const n = String((f && f.name) || '');
  return Object.keys(_FILE_RE).find(k => _FILE_RE[k].test(n)) || '';
}

// (phase V78) The same way in for THIS PROJECT's uploads (js/merge-v3/library.js): the file into its place in the library, a
// link to it into the folder open there.
export const mediaOfFile = (f) => _mediaOfFile(f);
export const sendFileToLibrary = (f, onProgress) => _sendFile(f, onProgress);

// The file into the library: asked by its name, size and time first (a file dropped before is not sent again), then sent
// with its progress. Resolves with what a lane lays.
async function _sendFile(f, onProgress) {
  const meta = { name: f.name, size: f.size, lastModified: f.lastModified || 0 };
  try {
    const k = await fetch('/api/mv3/drop-file/known', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(meta) }).then(r => r.json());
    if (k && k.success && k.item) return k.item;
  } catch { /* sent the long way */ }
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    // Before the file: the server names the copy by it (a part's own name arrives in latin1).
    fd.append('name', f.name);
    fd.append('size', String(f.size));
    fd.append('lastModified', String(f.lastModified || 0));
    fd.append('file', f, f.name);
    const x = new XMLHttpRequest();
    x.open('POST', '/api/mv3/drop-file');
    x.responseType = 'json';
    x.upload.onprogress = (ev) => { if (ev.lengthComputable && onProgress) onProgress(ev.loaded / ev.total); };
    x.onload = () => {
      const r = x.response;
      if (r && r.success && r.item) resolve(r.item);
      else reject(new Error((r && r.error) || ('refused (' + x.status + ')')));
    };
    x.onerror = () => reject(new Error('the file did not reach the app'));
    x.send(fd);
  });
}

// One line over the timeline's top right while files go in, and what came of it for a few seconds after. A refusal or a
// failure is a popup in the corner instead (phase V49.1, the owner's (пр28), (пр29); js/notice.js) - and the line goes.
let _dropNote = null, _dropNoteT = 0;
function _dropSay(text, bad, stay) {
  const host = _host();
  if (!host) return;
  clearTimeout(_dropNoteT);
  if (text && bad) { showError(text); text = ''; }
  if (!text) { if (_dropNote) _dropNote.remove(); _dropNote = null; return; }
  if (!_dropNote) { _dropNote = document.createElement('div'); _dropNote.className = 'mv3b-dropnote'; document.body.appendChild(_dropNote); }
  const r = host.getBoundingClientRect();
  _dropNote.style.top = Math.round(r.top + 22) + 'px';
  _dropNote.style.right = Math.round(window.innerWidth - r.right + 8) + 'px';
  _dropNote.textContent = text;
  if (!stay) _dropNoteT = setTimeout(() => _dropSay(''), 3000);
}

// (phase V49.1, the owner's (пр33)) A HIGHLIGHTS PROJECT'S OWN TIMELINE takes nothing: it is open while no fragment is, and it
// is never rendered. A drag over its lanes is taken as anywhere (a Library tile cannot be told "no" at its start - the media
// tree takes it too); LET GO, it is refused - before a file from Explorer is copied into the library - with a popup and
// "to highlights" (lib-views.js noFragment). True when refused.
function _refusedHome(e) {
  if (!Views.isHlHome(Store.key())) return false;
  e.preventDefault();
  Views.noFragment();
  return true;
}

let _dropping = false;
async function _dropFiles(files, place) {
  const list = (files || []).filter(f => f && _mediaOfFile(f));
  const skipped = (files || []).length - list.length;
  if (!list.length) { _dropSay('Only videos, pictures and sounds go on the timeline', true); return; }
  if (_dropping) { _dropSay('Files are still going in - wait for them, then drop these', true); return; }
  _dropping = true;
  let trackId = place.trackId || '', make = place.make || '', at = Math.max(0, +place.at || 0);
  let laid = 0, copied = 0;
  const bad = [];
  try {
    for (let i = 0; i < list.length; i++) {
      const f = list[i];
      const media = _mediaOfFile(f);
      const lane = make || (((Store.timeline() || {}).tracks || []).find(x => x.id === trackId) || {}).kind;
      if (!_laneTakes(lane, media)) {
        bad.push(f.name + ' - ' + ({ video: 'a video', image: 'a picture', audio: 'a sound' }[media]) + ' does not go on '
          + (lane === 'audio' ? 'an audio' : 'a ' + (lane || '')) + ' lane');
        continue;
      }
      const head = (list.length > 1 ? (i + 1) + '/' + list.length + ' · ' : '') + f.name;
      _dropSay('into the library · ' + head, false, true);
      let item = null;
      try { item = await _sendFile(f, (p) => _dropSay('into the library ' + Math.round(p * 100) + '% · ' + head, false, true)); }
      catch (err) { bad.push(f.name + ' - ' + ((err && err.message) || 'not taken')); continue; }
      copied++;
      const r = _drop(trackId, at, item, make);
      if (!r) { bad.push(f.name + ' - ' + (Store.status() || 'not laid')); continue; }
      laid++;
      // The next one straight after it, on the same lane - the one just made, for a drop that made one.
      trackId = r.lane; make = ''; at = _r2(at + r.dur);
    }
  } finally {
    _dropping = false;
  }
  if (copied) window.dispatchEvent(new CustomEvent('mv3:lib-reload'));
  if (skipped) bad.push(skipped + (skipped === 1 ? ' file is' : ' files are') + ' not a video, a picture or a sound');
  if (bad.length) _dropSay((laid ? laid + ' laid · ' : '') + bad.join(' · '), true);
  else _dropSay(laid === 1 ? 'Laid, and kept in the library' : laid + ' laid, and kept in the library');
}

function _wireLane(lane, t) {
  if (t.kind === 'subs' || t.kind === 'text') return;
  lane.addEventListener('dragover', (e) => {
    // (phase V41) Files from Explorer too - what they are is readable while they are dragged (_fileMedia).
    const files = !_hasClip(e) && _hasFiles(e);
    if (!_hasClip(e) && !files) return;
    if (!_laneTakes(t.kind, files ? _fileMedia(e.dataTransfer) : _mediaOfDrag(e.dataTransfer))) { e.dataTransfer.dropEffect = 'none'; return; }
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    lane.classList.add('is-drop');
  });
  lane.addEventListener('dragleave', () => lane.classList.remove('is-drop'));
  lane.addEventListener('drop', (e) => {
    // (phase V49.1, (пр33)) A highlights project's own timeline: refused here, on release - a tile, a red clip's
    // replacement and files alike, before anything is copied.
    if ((_hasClip(e) || _hasFiles(e)) && _refusedHome(e)) { lane.classList.remove('is-drop'); return; }
    if (!_hasClip(e) && _hasFiles(e)) {
      e.preventDefault();
      lane.classList.remove('is-drop');
      const r = lane.getBoundingClientRect();
      _dropFiles(Array.from(e.dataTransfer.files || []), { trackId: t.id, at: (e.clientX - r.left) / _zoom() });
      return;
    }
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

// ── A lane made by a drop (phase V41, the owner's (о12)) ────────────────────
// A tile held over the RULER - above the top video lane - shows the ghost of a new pair, a video lane and its sound lane, and
// where the clip will lie on them; held BELOW THE BOTTOM AUDIO LANE (the room under it, or over the words block) - the ghost
// of a new audio lane. Let go there: the lanes are made and the clip laid on them in one step (_drop `make`). Taken away:
// the ghost goes. Not past the ceiling - four lanes a side - and not for what the side does not take (a sound above, a
// picture below). Held over a lane, it is that lane's drop, as before.
let _ghost = null;          // { side, media, rows: [element], at }
let _dragData = null;       // what a tile of this page carries while it is dragged - read at its dragstart, for the length

function _ghostDur(media) {
  const d = _dragData;
  if (media === 'image' || (d && d.src && isStill({ src: d.src }))) return STILL_DUR;
  return d && +d.dur > 0 ? +d.dur : FALLBACK_DUR;
}

const _onLane = (tg) => !!(tg && tg.closest && tg.closest('.mv3b-row.is-video .mv3b-lane, .mv3b-row.is-audio .mv3b-lane'));

// Which new lane a drag here would make: 'video' (over the ruler, or over that ghost pair), 'audio' (below the bottom media
// lane, over the words block, or over that ghost), or '' (over a lane - its own drop - or between the blocks).
function _sideAt(e) {
  const host = _host();
  const inner = host && host.querySelector('.mv3b-inner');
  const tg = e.target && e.target.closest ? e.target : null;
  if (!inner || !tg || !host.contains(tg)) return '';
  const g = tg.closest('.mv3b-row.is-ghost');
  if (g) return g.dataset.side || '';
  if (tg.closest('.mv3b-row.is-ruler')) return 'video';
  if (tg.closest('.mv3b-row.is-video, .mv3b-row.is-audio, .mv3b-seam')) return '';
  const words = inner.querySelector(':scope > .mv3b-zone.is-subs');
  if (words && words.contains(tg)) return 'audio';
  const rows = inner.querySelectorAll('.mv3b-row.is-video, .mv3b-row.is-audio');
  const last = rows[rows.length - 1];
  return last && e.clientY > last.getBoundingClientRect().bottom ? 'audio' : '';
}

function _ghostRow(kind, side, label, withClip) {
  const row = document.createElement('div');
  row.className = 'mv3b-row is-ghost is-ghost-' + kind;
  row.dataset.side = side;
  const box = document.createElement('div');
  box.className = 'mv3b-box';
  box.innerHTML = icon('plus', 12);                 // (phase V73 block 5, 5c) Lucide's, as the lanes' squares
  const lbl = document.createElement('div');
  lbl.className = 'mv3b-lbl';
  lbl.textContent = _shownName(label);
  const lane = document.createElement('div');
  lane.className = 'mv3b-lane';
  if (withClip) {
    const c = document.createElement('div');
    c.className = 'mv3b-ghost-clip is-' + kind;
    lane.appendChild(c);
  }
  row.append(box, lbl, lane);
  return row;
}

function _showGhost(side, media, clientX) {
  const host = _host();
  const inner = host && host.querySelector('.mv3b-inner');
  if (!inner) return;
  if (!_ghost || _ghost.side !== side || _ghost.media !== media || !_ghost.rows.every(r => r.isConnected)) {
    _hideGhost();
    const tracks = (Store.timeline() || {}).tracks || [];
    const vz = inner.querySelector(':scope > .mv3b-zone.is-video');
    const az = inner.querySelector(':scope > .mv3b-zone.is-audio');
    const ruler = inner.querySelector(':scope > .mv3b-row.is-ruler');
    const rows = [];
    const putAudio = (row) => {
      if (az) az.appendChild(row);
      else (vz || ruler).after(row);
      rows.push(row);
    };
    if (side === 'video') {
      const v = _ghostRow('video', side, 'new video', true);
      if (vz) vz.insertBefore(v, vz.firstChild); else ruler.after(v);
      rows.push(v);
      // Its sound lane comes with it - with the clip's sound on it, unless it is a picture (_newVideoLane).
      if (_count(tracks, 'audio') < MAX_PER_SIDE) putAudio(_ghostRow('audio', side, 'new audio', media !== 'image'));
      // In sight: the new lane is the top one, and the lanes may be scrolled under the ruler.
      host.scrollTop = 0;
    } else {
      putAudio(_ghostRow('audio', side, 'new audio', true));
      // In sight: the words block stuck to the floor may cover the bottom lanes.
      if (host.scrollHeight > host.clientHeight) host.scrollTop = host.scrollHeight;
    }
    _ghost = { side, media, rows, at: 0 };
  }
  const z = _zoom();
  const t = _r2(_timeAtX(clientX));
  const w = Math.max(2, _ghostDur(media) * z);
  for (const r of _ghost.rows) {
    const c = r.querySelector('.mv3b-ghost-clip');
    if (c) { c.style.left = (t * z) + 'px'; c.style.width = w + 'px'; }
  }
  _ghost.at = t;
}

function _hideGhost() {
  if (!_ghost) return;
  for (const r of _ghost.rows) r.remove();
  _ghost = null;
}

function _wireGhost(host) {
  host.addEventListener('dragover', (e) => {
    const clip = _hasClip(e), files = !clip && _hasFiles(e);
    if (!_on || locked() || (!clip && !files)) return;
    const media = clip ? _mediaOfDrag(e.dataTransfer) : _fileMedia(e.dataTransfer);
    const side = _sideAt(e);
    const tracks = (Store.timeline() || {}).tracks || [];
    if (!side || !_laneTakes(side, media) || _count(tracks, side) >= MAX_PER_SIDE) {
      _hideGhost();
      if (!_onLane(e.target)) e.dataTransfer.dropEffect = 'none';
      return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    _showGhost(side, media, e.clientX);
  });
  host.addEventListener('dragleave', (e) => { if (!e.relatedTarget || !host.contains(e.relatedTarget)) _hideGhost(); });
  host.addEventListener('drop', (e) => {
    const g = _ghost;
    _hideGhost();
    if (!g || !_on || _onLane(e.target)) return;
    // (phase V49.1, (пр33)) Nor a lane made by a drop, on a highlights project's own timeline.
    if (_refusedHome(e)) return;
    if (!_hasClip(e) && _hasFiles(e)) {
      e.preventDefault();
      _dropFiles(Array.from(e.dataTransfer.files || []), { make: g.side, at: g.at });
      return;
    }
    if (!_hasClip(e)) return;
    e.preventDefault();
    let data = null;
    try { data = JSON.parse(e.dataTransfer.getData(DRAG_TYPE)); } catch { return; }
    if (data && data.src) _drop(null, g.at, data, g.side);
  });
  // The length of what is dragged, for the ghost: a tile's dragstart has set it by the time it reaches the document.
  document.addEventListener('dragstart', (e) => {
    _dragData = null;
    if (!_hasClip(e)) return;
    try { _dragData = JSON.parse(e.dataTransfer.getData(DRAG_TYPE)); } catch { _dragData = null; }
  });
  document.addEventListener('dragend', () => { _dragData = null; _hideGhost(); });
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
    btn.className = 'mv3b-sq u-btn is-icon is-quiet';
    const all = ((Store.timeline() || {}).tracks) || [];
    if (t.kind === 'subs') {
      const full = _count(all, 'text') >= MAX_TEXT;
      btn.innerHTML = icon('plus', 12);
      btn.disabled = full;
      btn.title = full ? 'Two text lanes is the limit'
                       : 'Add a lane for text you type yourself';
      btn.addEventListener('click', (e) => { e.stopPropagation(); addTextTrack(); });
    } else {
      btn.innerHTML = icon('minus', 12);
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
    btn.className = 'mv3b-sq u-btn is-icon is-quiet';
    const tl = Store.timeline();
    const all = (tl && Array.isArray(tl.tracks)) ? tl.tracks : [];
    if (t.main) {
      const full = _count(all, t.kind) >= MAX_PER_SIDE;
      btn.innerHTML = icon('plus', 12);
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
      btn.innerHTML = icon('minus', 12);
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
  nm.textContent = _shownName(t.name);              // (phase V73 block 5, 5c; (к17)) sentence case, 500 11 px
  lbl.appendChild(nm);
  if (mate) {
    const mk = document.createElement('span');
    mk.className = 'mv3b-link';
    mk.innerHTML = icon('link', 10);                // Lucide's link in place of "⚭"
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
  const over = t.kind === 'audio' ? _overlaps(t.clips || []) : null;
  for (const c of (t.clips || [])) lane.appendChild(_clipEl(t, c, over && over.get(c.id)));
  // Selection survives the rebuild: it is held by id for exactly this reason.
  
  _wireLane(lane, t);
  row.appendChild(lane);

  return row;
}

// (phase V49, the owner's (пр2) а: "наложенная сверху часть была прозрачной, чтобы было видно звуковую волну на нижней
// дорожке") WHERE A SOUND LIES OVER AN EARLIER ONE ON ITS LANE: a clip is drawn over every clip before it in the lane's list
// (sorted by start), so for each clip the stretches it shares with any of those - in seconds from its own start, joined.
// Over them it is see-through and its own wave faint (tl-wave.js), so the wave under it shows; the rest of it as before.
function _overlaps(clips) {
  const out = new Map();
  for (let i = 1; i < clips.length; i++) {
    const c = clips[i];
    const s = +c.start || 0, e = s + (+c.dur || 0);
    const xs = [];
    for (let j = 0; j < i; j++) {
      const o = clips[j];
      const a = Math.max(s, +o.start || 0), b = Math.min(e, (+o.start || 0) + (+o.dur || 0));
      if (b - a > 0.005) xs.push([a - s, b - s]);
    }
    if (!xs.length) continue;
    xs.sort((x, y) => x[0] - y[0]);
    const joined = [];
    for (const x of xs) {
      const last = joined[joined.length - 1];
      if (last && x[0] <= last[1]) last[1] = Math.max(last[1], x[1]); else joined.push(x.slice());
    }
    out.set(c.id, joined);
  }
  return out;
}

function _fxFrames(el, c) {
  const d = +c.dur || 0;
  if (!(d > 0)) return;
  el.classList.add('has-fx');
  const rows = [];                // the end of the last frame in each row
  const made = [];
  for (const e of c.fx) {
    const fd = fxEffectOf(e.k);
    if (!fd) continue;
    const sp = fxSpanOf(c, e);
    const a = Math.max(0, sp.a - (+c.start || 0)), b = Math.min(d, sp.b - (+c.start || 0));
    if (!(b > a + 1e-3)) continue;
    let r = rows.findIndex((end) => end <= a + 1e-3);
    if (r < 0) { r = rows.length; rows.push(b); } else rows[r] = b;
    const f = document.createElement('span');
    f.className = 'mv3b-fx';
    f.style.left = (a / d * 100).toFixed(3) + '%';
    f.style.width = ((b - a) / d * 100).toFixed(3) + '%';
    f.title = fd.name + ' · ' + a.toFixed(2) + '–' + b.toFixed(2) + ' s of the clip - press to open it';
    f.textContent = fd.name;
    f.addEventListener('mousedown', () => FXUI.focus(c.id, e.id));
    el.appendChild(f);
    made.push([f, r]);
  }
  // As many rows as effects run at once, each a share of the clip's height (three at most - more share the last).
  const n = Math.min(3, rows.length);
  if (n > 1) {
    for (const [f, r] of made) {
      const k = Math.min(r, n - 1);
      f.style.top = `calc(${(k / n * 100).toFixed(3)}% + 1px)`;
      f.style.bottom = 'auto';
      f.style.height = `calc(${(100 / n).toFixed(3)}% - 2px)`;
    }
  }
}

function _clipEl(t, c, over) {
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
  // (phase V36, T4) A SOUND SHOWS ITS WAVE - a sound, a track of music, a film's own sound: the peaks of the part of its
  // file it plays, drawn by tl-wave.js for what can be seen (after the build, on scroll, when the peaks arrive). The name
  // sits in the strip above it (css/mv3-timeline.css).
  if (t.kind === 'audio' && c.src && !Store.isGone(c)) {
    const wave = document.createElement('canvas');
    wave.className = 'mv3b-wave';
    el.appendChild(wave);
    el.__clip = c;
  }
  // (phase V49, (пр2) а) Over an earlier sound of its lane this one is see-through - its fill stops there (_overlaps).
  const d = +c.dur || 0;
  if (over && over.length && d > 0 && !Store.isGone(c)) {
    const pc = (v) => (Math.max(0, Math.min(d, v)) / d * 100).toFixed(3) + '%';
    const stops = [];
    let at = 0;
    for (const [a, b] of over) {
      stops.push(`var(--surface-2) ${pc(at)} ${pc(a)}`, `transparent ${pc(a)} ${pc(b)}`);
      at = b;
    }
    stops.push(`var(--surface-2) ${pc(at)} 100%`);
    el.style.backgroundColor = 'transparent';
    el.style.backgroundImage = `linear-gradient(90deg, ${stops.join(', ')})`;
    el.classList.add('has-over');
    el.__over = over;
  }
  // (phase V84, the owner's (эф4), (эф5)) A CLIP WITH EFFECTS is another colour, and each effect is a FRAME on it - its left and
  // right edges where it starts and ends, its name in it; two at once - two rows. Pressed, the clip is picked as ever and the
  // effect opens in the inspector (fx-ui.js).
  if (t.kind === 'video' && Array.isArray(c.fx) && c.fx.length && !Store.isGone(c)) _fxFrames(el, c);
  const cap = document.createElement('span');
  cap.className = 'mv3b-clip-t';
  cap.textContent = (Store.isGone(c) ? 'Deleted · ' : '') + (c.name || '');   // (V73 block 5, 5c; (к17)) sentence case
  el.appendChild(cap);

  if (_sel.has(c.id)) el.classList.add('is-sel');
  // A cross on the clip, not only the Delete key: the key needs the clip selected first, and
  // "select then press a key" is two steps to undo one mistake. It asks before acting for the
  // same reason the track squares do - a video clip takes its sound with it, and that is worth
  // saying out loud before it happens rather than after.
  const x = document.createElement('button');
  x.type = 'button';
  x.className = 'mv3b-clipx u-onpic is-del u-x';
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
    if (_drag || _ranging) return;
    // (phase V36, T5) Over a sound's wave the pointer draws a stretch of time; over its strip it takes the clip.
    el.style.cursor = _edgeOf(e, el) ? 'ew-resize' : (t.kind === 'audio' && _onWave(e, el) ? 'text' : 'grab');
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

// The marks of the ruler, from 0 to `upTo` seconds - drawn again when the lanes widen (_widen).
function _ticks(lane, upTo) {
  lane.querySelectorAll(':scope > .mv3b-tick').forEach(el => el.remove());
  const z = _zoom(), st = _step(z);
  const frag = document.createDocumentFragment();
  for (let t = 0; t <= upTo; t += st) {
    const m = document.createElement('span');
    m.className = 'mv3b-tick';
    m.style.left = (t * z) + 'px';
    m.textContent = _fmtT(Math.round(t * 10) / 10);
    frag.appendChild(m);
  }
  lane.insertBefore(frag, lane.firstChild);
}

// HOW WIDE THE LANES ARE (phase V49.1, the owner's report: "названия дорожек пропадают при прокрутке вправо"). Clips and
// marks lie absolute, so the content was only ever as wide as the box it is seen in - and a sticky name cannot leave its
// row: one box-width to the right it slid away with it, and so did the rows' lines, the seam, the ruler's and the words
// block's backgrounds, the drop, the right-click and the band. So the content is given its width: the film (at least ten
// seconds, as the ruler counts) and a mark more, room for the end to come to the middle of the box, and never narrower
// than the box. In px of lane, right of the frozen names.
function _lanesWidth(end) {
  const host = _host();
  const z = _zoom(), st = _step(z);
  const strip = Math.max(0, (host ? host.clientWidth : 0) - GUTTER);
  return Math.ceil(Math.max((Math.max(end, 10) + st) * z + 60, end * z + strip / 2, strip));
}

const _endOf = (tracks) => {
  let end = 0;
  for (const t of tracks || []) for (const c of (t.clips || [])) end = Math.max(end, (+c.start) + (+c.dur));
  return end;
};

// The box was resized (a sash, the window): the width and the ruler's marks follow - not the whole build.
let _builtW = -1;
function _widen() {
  const host = _host();
  const inner = host && host.querySelector('.mv3b-inner');
  if (!_on || !inner || host.clientWidth === _builtW) return;
  _builtW = host.clientWidth;
  const w = _lanesWidth(_endOf(((Store.timeline() || {}).tracks) || []));
  inner.style.width = (GUTTER + w) + 'px';
  const lane = inner.querySelector('.mv3b-ruler');
  if (lane) _ticks(lane, w / _zoom());
}

function _ruler(upTo) {
  const row = document.createElement('div');
  row.className = 'mv3b-row is-ruler';
  const box = document.createElement('div');
  box.className = 'mv3b-box';
  const lbl = document.createElement('div');
  lbl.className = 'mv3b-lbl';
  row.append(box, lbl);

  const lane = document.createElement('div');
  lane.className = 'mv3b-lane mv3b-ruler';
  const z = _zoom();
  _ticks(lane, upTo);
  // Pressing the ruler moves the playhead - the same gesture as every other editor - and HELD, it scrubs: the playhead
  // and the picture follow the pointer until it is let go. The ruler touches no pick; bare lane lets it go (_beginBand).
  lane.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    _scrub(e);
  });
  // The playhead's tip, here rather than on the line (phase V41): the ruler stays on top while the lanes scroll.
  const tip = document.createElement('div');
  tip.className = 'mv3b-head-tip';
  tip.style.left = (_playhead * z) + 'px';
  lane.appendChild(tip);
  row.appendChild(lane);
  return row;
}

// The playhead is one element over the whole stack, not a mark per lane: it is one moment,
// and drawing it per lane makes it possible for them to disagree. (phase V49.1) It goes UNDER the frozen names, not over
// them: over the clips, under the names (merge-v3.css) - so the ruler and the words block stuck to the floor, which cover
// the lanes, each carry their own piece of it (the tip's stem; a copy, as a stretch drawn to cut has one), placed with it.
function _head() {
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

// The preview, once loaded (initTimelineB): it imports this module, so it is reached by a dynamic import - and held, so a
// seek reaches it in the same moment rather than a promise later.
let _P = null;

// The line over the stack and its tip in the ruler, where _playhead says.
function _placeHead() {
  const host = _host();
  if (!host) return;
  const z = _zoom();
  for (const el of host.querySelectorAll('.mv3b-head')) el.style.left = (GUTTER + _playhead * z) + 'px';
  const tip = host.querySelector('.mv3b-head-tip');
  if (tip) tip.style.left = (_playhead * z) + 'px';
}

function _seekTo(t) {
  const at = Math.max(0, Math.round((+t || 0) * 100) / 100);
  _playhead = at;
  _placeHead();
  _headMoved();
  // The preview is the other half of this workflow, and the playhead belongs to both. seek()
  // calls setPlayhead back, which is harmless: it writes the same number this just wrote.
  // THE MOMENT GIVEN, not _playhead read later (phase V41): while playing, the preview's next frame wrote its own time into
  // _playhead before the import answered, and the seek went to where playing already was - a press seemed to do nothing.
  if (_P) _P.seek(at);
  else import('./preview-b.js').then(P => { _P = P; P.seek(at); }).catch(() => {});
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

// ── ALT + WHEEL ZOOMS (phase V49.1, the owner's (пр27) а) ───────────────────
// Over the timeline, Alt held: a notch of the wheel is x1.2 closer (up) or farther (down), in the slider's range and in
// whole px/sec, and the PLAYHEAD STAYS WHERE IT IS ON SCREEN - the slider's own rule held still instead of centred. A
// playhead off screen is put in the middle, as the slider does. A touchpad's small deltas add up to notches; whatever
// arrives within one frame is applied once (each change rebuilds the lanes). The slider, its number and the kept value
// follow: the slider is set and told (bar.js keeps it, the input listener below rebuilds), then the scroll is put back.
// Plain wheel and Shift + wheel are the browser's, as before; Alt + Shift is Windows' layout switch and is left alone.
const NOTCH_PX = 100;       // one notch of a mouse wheel, in the pixels Chromium reports
let _wheelAcc = 0;          // notches gathered since the last frame (+ = farther)
let _wheelAsked = false;

function _onWheel(e) {
  if (!e.altKey || e.shiftKey || e.ctrlKey || e.metaKey) return;
  if (!_on || locked() || !Store.hasProject()) return;
  const dy = +e.deltaY || 0;
  if (!dy) return;
  e.preventDefault();
  _wheelAcc += e.deltaMode === 1 ? dy / 3 : e.deltaMode === 2 ? dy : dy / NOTCH_PX;
  if (_wheelAsked) return;
  _wheelAsked = true;
  // A frame, with a timer behind it for a window that is not being drawn (rAF waits for one that is).
  const go = () => { if (!_wheelAsked) return; _wheelAsked = false; _wheelZoom(); };
  requestAnimationFrame(go);
  setTimeout(go, 50);
}

function _wheelZoom() {
  const host = _host();
  const z = document.getElementById('mv3-zoom');
  if (!host || !z || !_on) { _wheelAcc = 0; return; }
  const acc = _wheelAcc;
  const lo = +z.min || 1, hi = +z.max || 240;
  const was = _zoom();
  let next = Math.round(was * Math.pow(1.2, -acc));
  // At a low zoom x1.2 rounds back to the same whole number: a full notch still moves it by one.
  if (next === was && Math.abs(acc) >= 1) next = was - Math.sign(acc);
  next = Math.max(lo, Math.min(hi, next));
  if (next === was) {
    // Less than a notch from a touchpad: kept until it adds up. At the end of the range: nothing to keep.
    if (Math.abs(acc) >= 1 || (acc > 0 ? was <= lo : was >= hi)) _wheelAcc = 0;
    return;
  }
  _wheelAcc = 0;
  // Where the playhead is on screen now: from the lanes' left edge, inside the strip right of the frozen names.
  const strip = host.clientWidth - GUTTER;
  const off = _playhead * was - host.scrollLeft;
  const seen = strip > 0 && off >= 0 && off <= strip;
  z.value = String(next);
  z.dispatchEvent(new Event('input'));       // the number, the kept value, the lanes rebuilt and the playhead centred
  if (seen) host.scrollLeft = Math.max(0, _playhead * next - off);
}

export const playhead = () => _playhead;
export function setPlayhead(t) {
  _playhead = Math.max(0, +t || 0);
  _placeHead();
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
  Store.mutate(tl => { made = _cutIn(tl.tracks || [], clip.id, at); });
  // The second half is selected: after a cut, the part not looked at yet is the one about to be
  // worked on.
  if (made) selectClipById(made);
  return { ok: true };
}

// (phase V77) A CLIP CUT AT `at` inside a mutation - Split's rule, also "Into the cut" of a result made from a frame
// (js/merge-v3/tl-gen.js): the clip and its pair's half under the cut, each the right half straight after the original. The
// right half's id, or null when `at` is not inside it.
function _cutIn(tracks, clipId, at) {
  let clip = null;
  for (const t of tracks) { clip = (t.clips || []).find(x => x.id === clipId) || null; if (clip) break; }
  if (!clip || !(at > (+clip.start) && at < (+clip.start) + (+clip.dur))) return null;
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
  let made = null;
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
  return made;
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
  // (phase V73 block 5, 5c; the owner's (б5-17) а) a line one step lighter with a red icon and plain words, the count in mono
  const mark = iconEl('circle-alert', 14);
  mark.classList.add('mv3-tl-gone-i');
  el.appendChild(mark);
  const t = document.createElement('span');
  t.appendChild(figures(n + (n === 1 ? ' piece of media' : ' pieces of media') + ' of this project ' + (n === 1 ? 'was' : 'were')
    + ' deleted from the library - red on the timeline. Let a tile from the Library go on a red clip to replace it, or remove it.'));
  el.appendChild(t);
  const x = document.createElement('button');
  x.type = 'button';
  x.className = 'mv3-tl-gone-x u-btn is-s is-icon is-quiet u-x';
  x.title = 'Close - the clips stay red';
  x.addEventListener('click', () => { _goneShut = key; _paintGone(); });
  el.appendChild(x);
}

// (phase V73 block 5, 5c; the owner's (б5-14) а) AN EMPTY TIMELINE SAYS WHAT GOES ON IT - quiet words over the middle of its lanes
// while no lane holds a clip (a subtitle or a text line is a clip of its lane, as layout.js _empty counts). Not in a highlights
// project (its own timeline takes nothing, a fragment holds its pieces); under setup the sheet hides them. From under the ruler
// to the panel's foot, right of the frozen names - laid over the lanes, so they do not scroll away and a drop goes through.
function _paintEmpty(tracks, inner) {
  const el = document.getElementById('mv3-tl-empty');
  const host = _host();
  if (!el || !host) return;
  const key = String(Store.key() || '');
  const empty = !!key && !/^hl_/.test(key) && tracks.every(t => !(t && Array.isArray(t.clips) && t.clips.length));
  el.hidden = !empty;
  if (!empty) return;
  const ruler = inner && inner.querySelector(':scope > .mv3b-row.is-ruler');
  el.style.top = (host.offsetTop + (ruler ? ruler.offsetHeight : 0)) + 'px';
  el.style.left = (host.offsetLeft + GUTTER) + 'px';
}

function _build() {
  const host = _host();
  if (!host) return;
  // (phase V75, the owner's (кп8): "прокрутка уходила") The lanes are rebuilt whole on every change - a clip moved on the
  // preview too -, and emptied for a moment the scroll box lost its place: the same timeline is shown where it was looked at.
  const keepX = host.scrollLeft, keepY = host.scrollTop;
  host.textContent = '';
  _paintGone();

  const tl = Store.timeline();
  const tracks = (tl && Array.isArray(tl.tracks)) ? tl.tracks : [];

  // THE PICK FOLLOWS THE TIMELINE (K6b): another project's pick is let go of - every project's subtitle
  // lane is "subs", so a picked lane stayed picked in the next one - and so is a clip that is gone (a
  // re-cut, a lay by the server), which "N clips selected" still counted.
  let lost = false;
  const key = Store.key();
  const opened = key !== _selKey;
  if (opened) {
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
  // (phase V49.1) The content as wide as the film and its margin (_lanesWidth), the ruler's marks across all of it.
  const lanesW = _lanesWidth(_endOf(tracks));
  inner.style.width = (GUTTER + lanesW) + 'px';
  _builtW = host.clientWidth;
  inner.appendChild(_ruler(lanesW / _zoom()));

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
  // (phase V41, the owner's (о10)) While it holds lines it sticks to the bottom of the window (merge-v3.css) - empty, it would
  // only hide the lanes under it.
  if (subs) {
    if (tracks.some(t => (t.kind === 'subs' || t.kind === 'text') && (t.clips || []).length)) subs.classList.add('has-words');
    inner.appendChild(subs);
    // (phase V49.1) Stuck to the floor it covers the lanes and the playhead under it: its own copy of the line.
    if (subs.classList.contains('has-words')) subs.appendChild(_head());
  }

  inner.appendChild(_head());
  host.appendChild(inner);
  _paintEmpty(tracks, inner);
  // What is brought into view (a picked lane, a clip) stops short of the ruler and the words block that cover the lanes.
  host.style.scrollPaddingTop = '19px';
  host.style.scrollPaddingBottom = (subs && subs.classList.contains('has-words')) ? subs.offsetHeight + 'px' : '';
  // (phase V36, T1) Another timeline opens at its start - the preview put the playhead at 0 (preview-b.js _toStart), and
  // the lanes are shown from there, not scrolled to where the last one was looked at.
  if (opened) host.scrollLeft = 0;
  else { host.scrollLeft = keepX; host.scrollTop = keepY; }
  // (phase V36, T4) The waves of what can be seen - laid out now, so they are drawn at once.
  paintWaves(host, _zoom(), GUTTER);
  // (phase V36, T5) A stretch drawn belongs to the timeline it was drawn on.
  if (opened) _range = null;
  _paintRange();
  // (phase V44) The glow of the pauses "cut silence" found, on the lanes just built.
  paintSilence();
  // (phase V49, (пр15)) The timeline is never shorter than its lanes: the floor follows what was just built (layout.js).
  lanesChanged();
}

// The waves again, once per frame however many scroll events come - with a timer behind the frame, for a window that is
// not being drawn (rAF waits for one that is).
let _wavesAsked = false;
function _wavesSoon() {
  if (_wavesAsked) return;
  _wavesAsked = true;
  const go = () => { if (!_wavesAsked) return; _wavesAsked = false; if (_on) paintWaves(_host(), _zoom(), GUTTER); };
  requestAnimationFrame(go);
  setTimeout(go, 50);
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
  // (phase V51) A press on the preview that found a picture under it - the one picked already as well: not a press away.
  if (id && _pvPress != null) _pvPicked = true;
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
const CLIP_FIELDS = new Set(['volume', 'dur', 'speed', 'reversed', 'fit', 'cropAlign', 'frame',
                             'transition', 'animation', 'filter',
                             'tx', 'ty', 'tw', 'angle', 'feather',
                             'halfer', 'halferPos', 'halferThick', 'halferKeep', 'rotation',
                             // (phase V49, point 3) A main clip as a picture in the picture, its corners and outline.
                             'pip', 'radius', 'outline', 'outlineColor',
                             // (phase V51, point 1) A piece of the clip's file, cut first (framing/crop.js).
                             'crop',
                             // (phase V54, the owner's (зв11) а) A sound's own fades - offered by the inspector since V23 and
                             // never let through: the slider stayed where it was let go, and nothing was written.
                             'fadeIn', 'fadeOut',
                             // (phase V65, (пз5)) How much of a clip of a video lane is seen, and (пз7) how it mixes with
                             // what is under it (overlay/look.js).
                             'opacity', 'blend',
                             // (phase V75, (кп5)) Its colour correction (overlay/color.js).
                             'color',
                             // (phase V76) A sound at another pitch (sound/pitch.js); (тн9) the frame the app gave a highlights
                             // clip, kept while the frame of several is changed (hl-group.js).
                             'pitch', 'frameWas',
                             // (phase V84) Its effects (fx/params.js).
                             'fx']);

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

// (phase V49) No clip is made LONGER by the floor of a length: a piece a cut left shorter than 0.1 s stays its length (the
// timeline keeps clips down to 0.02 s, lib/timeline-shape.js) - at 0.1 it ran over the piece after it, which the render
// and the preview then played twice.
const _minDur = (c) => Math.max(0.02, Math.min(0.1, +c.dur || 0.1));

function _write(c, key, value) {
  if (key === 'volume') { c.volume = Math.max(0, Math.min(4, +value || 0)); return; }
  // (phase V54) Seconds of the timeline, as js/sound/fades.js reads them for the preview and the render (which keep them inside
  // the clip); to the millisecond, so the 15 ms of a seam (cut silence) survive; none is null - lib/timeline-shape.js's shape.
  if (key === 'fadeIn' || key === 'fadeOut') { const v = +value; c[key] = v > 0 ? Math.min(30, Math.round(v * 1000) / 1000) : null; return; }
  if (key === 'dur') { c.dur = Math.max(_minDur(c), _r2(+value || 0)); return; }
  if (key === 'speed') {
    // Same content, faster = shorter. What stays put is the SLICE OF SOURCE in play; what
    // the number changes is how long it takes to get through it. Nothing is clamped against
    // the neighbour the way the other timeline clamps: clips here may overlap, and the one
    // in front simply wins.
    const sp = Math.max(0.25, Math.min(4, +value || 1));
    const srcLen = (+c.dur || 0) * (+c.speed || 1);
    c.speed = sp;
    c.dur = Math.max(0.02, _r2(srcLen / sp));
    return;
  }
  if (key === 'reversed') { c.reversed = !!value; return; }
  // (phase V65) 0..1 in hundredths; fully seen takes the field off.
  if (key === 'opacity') { const v = normalizeOpacity(value); if (v == null) delete c.opacity; else c.opacity = v; return; }
  // (phase V65) A blend mode's id; none takes the field off.
  if (key === 'blend') { const v = normalizeBlend(value); if (v == null) delete c.blend; else c.blend = v; return; }
  // (phase V75) The values that are not neutral; neutral takes the field off.
  if (key === 'color') { const v = normalizeColor(value); if (v == null) delete c.color; else c.color = v; return; }
  // (phase V76) { st, shift } - semitones and the timbre moving with them; 0 takes the field off.
  if (key === 'pitch') { const v = normalizePitch(value); if (v == null) delete c.pitch; else c.pitch = v; return; }
  // (phase V84) [{ id, k, t0, len }] - the effects the program knows; none takes the field off.
  if (key === 'fx') { const v = normalizeFx(value); if (v) c.fx = v; else delete c.fx; return; }
  // (phase V76, (тн9)) { frame } - the app's frame of a highlights clip, null for none; no value takes the field off.
  if (key === 'frameWas') { if (value && typeof value === 'object') c.frameWas = { frame: normalizeFrame(value.frame) || null }; else delete c.frameWas; return; }
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
  // (phase V49, point 3, the owner's (пр8)-(пр11)) A MAIN clip shown as a picture in the picture over a blurred copy of itself
  // (preview-b.js _pipRect, lib/mv3b-render.js): the switch, then the look - its corners rounded (a share of its shorter
  // side, 0.5 round ends), an outline (a share of the frame's width) and its colour. The look stays when the switch goes off.
  if (key === 'pip') { c.pip = value ? true : null; return; }
  if (key === 'radius') { c.radius = (value == null || !(+value > 0)) ? null : Math.min(0.5, +value); return; }
  if (key === 'outline') { c.outline = (value == null || !(+value > 0)) ? null : Math.min(0.05, +value); return; }
  if (key === 'outlineColor') { c.outlineColor = /^#[0-9a-f]{6}$/i.test(String(value || '')) ? String(value).toLowerCase() : null; return; }
  // (phase V51, point 1) THE CROP - { x, y, w, h } in shares of the file, `off` when remembered and not applied; null takes it off.
  if (key === 'crop') { const k = normalizeCrop(value); if (k) c.crop = k; else delete c.crop; return; }
  // All five the panel offers. Only three were let through, so top and bottom quietly wrote
  // centre - which the preview and the render then showed, as if the choice had been made.
  if (key === 'cropAlign') {
    c.cropAlign = ['left', 'center', 'right', 'top', 'bottom'].indexOf(String(value)) >= 0 ? String(value) : 'center';
    return;
  }
  // (phase V33.2) THE FRAME'S PATH - following the face, the middle, the whole frame over its blur, two bands - or none,
  // and the fixed `cropAlign` frames the clip again.
  if (key === 'frame') {
    const f = normalizeFrame(value);
    if (f) c.frame = f; else delete c.frame;
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

// ── The timeline's media into the generation chats and back (phase V77, js/merge-v3/tl-gen.js) ─────────────────────────────
// A moment of the timeline inside a clip -> the moment of its FILE (played backwards, the clip's start is its window's end).
function _fileAt(c, t) {
  const sp = +c.speed || 1;
  const x = Math.max(0, Math.min(+c.dur || 0, t - (+c.start || 0)));
  return c.reversed ? (+c.trimIn || 0) + ((+c.dur || 0) - x) * sp : (+c.trimIn || 0) + x * sp;
}
// ...and back: the moment of the timeline a moment of the clip's file is shown at.
function _tlAt(c, f) {
  const sp = +c.speed || 1;
  const x = c.reversed ? ((+c.trimIn || 0) + (+c.dur || 0) * sp - f) / sp : (f - (+c.trimIn || 0)) / sp;
  return (+c.start || 0) + x;
}

/**
 * (phase V77, the owner's (тч3а)) THE CLIP A FRAME OF THE PREVIEW IS OF - for the frame buttons right of "cut silence": the
 * picked video clip when one is picked and the playhead is on it, else the topmost video clip under the playhead (the lanes
 * above main first; on a lane the later clip is the one drawn). A talking head's line is never one (the mirror's, (тч11а)), nor
 * a red clip. -> { trackId, clipId, fileT, at } | null
 */
export function frameTarget() {
  const tl = Store.timeline();
  const at = _playhead;
  const on = (c) => c && c.src && c.frag == null && !Store.isGone(c) && at >= (+c.start || 0) && at < (+c.start || 0) + (+c.dur || 0);
  const vids = ((tl && tl.tracks) || []).filter(t => t.kind === 'video');
  const pick = _sel.size === 1 ? [..._sel][0] : '';
  for (const t of vids) {
    const c = pick && (t.clips || []).find(x => x.id === pick);
    if (on(c)) return { trackId: t.id, clipId: c.id, fileT: isStill(c) ? 0 : _fileAt(c, at), at };
  }
  for (const t of vids) {
    const cs = (t.clips || []).filter(on);
    const c = cs[cs.length - 1];
    if (c) return { trackId: t.id, clipId: c.id, fileT: isStill(c) ? 0 : _fileAt(c, at), at };
  }
  return null;
}

// What a file is like, asked of the browser (its length, its shape) - 0 when it cannot be read in a few seconds.
function _probe(src, video) {
  return new Promise((resolve) => {
    const el = video ? document.createElement('video') : new Image();
    let done = false;
    const end = (v) => { if (done) return; done = true; try { el.removeAttribute('src'); if (video) el.load(); } catch (e) { /* gone */ } resolve(v); };
    setTimeout(() => end({ dur: 0, w: 0, h: 0 }), 6000);
    if (video) {
      el.preload = 'metadata';
      el.addEventListener('loadedmetadata', () => end({ dur: +el.duration || 0, w: el.videoWidth || 0, h: el.videoHeight || 0 }), { once: true });
    } else el.addEventListener('load', () => end({ dur: 0, w: el.naturalWidth || 0, h: el.naturalHeight || 0 }), { once: true });
    el.addEventListener('error', () => end({ dur: 0, w: 0, h: 0 }), { once: true });
    el.src = src;
  });
}

// The look a clip was given that a result laid in its place keeps (lib/frag-mirror.js LOOK, with V65's opacity and blend).
const GEN_LOOK = ['fit', 'cropAlign', 'crop', 'pip', 'tx', 'ty', 'tw', 'angle', 'feather', 'radius', 'outline', 'outlineColor', 'color',
  'halfer', 'halferPos', 'halferThick', 'halferKeep', 'rotation', 'opacity', 'blend'];

/**
 * (phase V77, the owner's (тч10), (тч10а)-(тч10в)) A RESULT OF A CHAT LAID BACK where the thing it was made from came from -
 * the button under it (js/merge-v3/tl-gen.js backButton). One mutation, one step to undo. By what was done (`o.act`):
 *   edit         the picture's FILE replaced - its place, length and look stay; its crop (shares of the file) only on a picture
 *                of the same shape
 *   animate, ref the new clip in the clip's place: from its second, no longer than it was - nothing after it moves; the look
 *                carried (the crop only on a frame of the same shape); the old clip's sound half goes with it
 *   continue     INSERTED right after the clip: what is after it on that lane moves on by the new clip's length, with the
 *                sound halves of what moves; the other lanes stay ((тч10в) а)
 *   frame-vid    the same, inserted INTO A CUT at the frame's moment - the clip cut there by Split's rule (_cutIn)
 *   frame-pic    a picture on the lane above the clip's lane, at the frame's moment, 10 s, over what is there
 * `item` - { kind: 'image' | 'video', src, thumb, libId, name, dur, w, h }. -> { ok, lane, at } | { ok: false, why }
 */
export async function genBack(o, item) {
  if (!_on) return { ok: false, why: 'The timeline is not showing.' };
  if (!o || !item || !item.src) return { ok: false, why: 'Nothing to lay.' };
  if (Store.key() !== o.key) return { ok: false, why: 'Its project is not the one open.' };
  const find = (tracks) => {
    for (const t of tracks || []) { const c = (t.clips || []).find(x => x.id === o.clipId); if (c) return { t, c }; }
    return null;
  };
  const now = find((Store.timeline() || {}).tracks);
  if (!now) return { ok: false, why: 'The clip is not on the timeline any more.' };
  const video = item.kind === 'video';
  let dur = video ? (+item.dur || 0) : 0;
  let w = +item.w || 0, h = +item.h || 0;
  if (video && !(dur > 0 && w > 0 && h > 0)) {
    const p = await _probe(item.src, true);
    if (!(dur > 0)) dur = p.dur;
    if (!(w > 0 && h > 0)) { w = p.w; h = p.h; }
  }
  if (video && !(dur > 0)) return { ok: false, why: 'The new clip\'s length could not be read.' };
  dur = _r2(dur);
  const inPlace = o.act === 'edit' || o.act === 'animate' || o.act === 'ref';
  // The crop is a piece of the FILE in shares of it: it carries only onto a file of the same shape.
  let sameShape = false;
  if (inPlace && now.c.crop) {
    const was = await _probe(now.c.src, !isStill(now.c));
    if (!(w > 0 && h > 0)) { const p = await _probe(item.src, video); w = p.w; h = p.h; }
    sameShape = was.w > 0 && was.h > 0 && w > 0 && h > 0 && Math.abs((was.w / was.h) / (w / h) - 1) < 0.01;
  }
  const base = (at, len) => ({
    src: item.src, thumb: item.thumb || (video ? null : item.src), name: String(item.name || '').slice(0, 200), libId: item.libId || null,
    start: _r2(at), dur: _r2(len), srcDur: video ? dur : 0, trimIn: 0, trimOut: 0, speed: 1, reversed: false,
    transition: null, animation: null, filter: null,
  });
  // A film on `track` at `at`: its picture there, its sound on the lane paired with it (as a drop lays one).
  const layFilm = (tracks, track, at, len, look) => {
    const id = _id();
    const mate = track.linkId ? tracks.find(x => x.id === track.linkId) : null;
    const pairId = mate ? 'p' + _id().slice(1) : null;
    track.clips.push(Object.assign(base(at, len), look || {}, { id, volume: 0, pairId }));
    if (mate) {
      mate.clips.push(Object.assign(base(at, len), { id: _id(), pairId, volume: 1 }));
      mate.clips.sort((a, b) => a.start - b.start);
    }
    return id;
  };
  // The frame's moment on the timeline: a film's by the moment of its file (the clip may have moved or been trimmed since), a
  // picture's - it has no moments of its own - where the playhead was.
  const _momentOf = (c) => (isStill(c) ? (o.at != null ? +o.at : +c.start || 0) : _tlAt(c, +o.fileT || 0));
  let out = null;
  const ok = Store.mutate(tl => {
    const tracks = tl.tracks || [];
    const f = find(tracks);
    if (!f) { out = { ok: false, why: 'The clip is not on the timeline any more.' }; return; }
    const { t, c } = f;
    const look = {};
    for (const k of GEN_LOOK) if (c[k] != null && (k !== 'crop' || sameShape)) look[k] = JSON.parse(JSON.stringify(c[k]));
    if (o.act === 'edit') {
      if (video) { out = { ok: false, why: 'A clip does not go in place of a picture this way.' }; return; }
      c.src = item.src; c.thumb = item.thumb || item.src; c.name = String(item.name || c.name || '').slice(0, 200); c.libId = item.libId || null;
      if (!sameShape) delete c.crop;
      delete c.frame;
      out = { ok: true, id: c.id, lane: t.name, at: +c.start || 0 };
      return;
    }
    if (inPlace) {
      if (!video) { out = { ok: false, why: 'A picture does not go in place of a clip this way.' }; return; }
      const at = +c.start || 0;
      const len = Math.min(dur, +c.dur || dur);
      _removeIn(tracks, t.id, c.id);
      const id = layFilm(tracks, t, at, len, look);
      out = { ok: true, id, lane: t.name, at };
      return;
    }
    if (o.act === 'frame-pic') {
      if (video) { out = { ok: false, why: 'Only a picture goes above it.' }; return; }
      const at = Math.max(+c.start || 0, Math.min((+c.start || 0) + (+c.dur || 0), _momentOf(c)));
      const vids = tracks.filter(x => x.kind === 'video');
      const i = vids.indexOf(t);
      const over = i > 0 ? vids[i - 1] : _newVideoLane(tracks);
      if (!over) { out = { ok: false, why: 'There is no lane above it, and four video lanes is the most.' }; return; }
      const id = _id();
      over.clips.push(Object.assign(base(at, STILL_DUR), { id, volume: 0, pairId: null }));
      out = { ok: true, id, lane: over.name, at: _r2(at) };
      return;
    }
    // continue / frame-vid: inserted, what is after it on this lane moving on.
    if (!video) { out = { ok: false, why: 'Only a clip is inserted.' }; return; }
    const s0 = +c.start || 0, e0 = s0 + (+c.dur || 0);
    let at = e0;
    if (o.act === 'frame-vid') {
      at = _r2(_momentOf(c));
      // Too near an end to cut: before the clip, or after it.
      if (at - s0 < MIN_SPLIT) at = s0;
      else if (e0 - at < MIN_SPLIT) at = e0;
      else _cutIn(tracks, c.id, at);
    }
    at = _r2(at);
    const moved = new Set();
    for (const x of t.clips) {
      if ((+x.start || 0) < at - 0.005) continue;
      x.start = _r2((+x.start || 0) + dur);
      if (x.pairId) moved.add(x.pairId);
    }
    for (const other of tracks) {
      if (other === t || !moved.size) continue;
      for (const x of (other.clips || [])) if (x.pairId && moved.has(x.pairId)) x.start = _r2((+x.start || 0) + dur);
      if (other.kind === 'audio') other.clips.sort((a, b) => a.start - b.start);
    }
    const id = layFilm(tracks, t, at, dur, null);
    out = { ok: true, id, lane: t.name, at };
  });
  if (!out) return { ok: false, why: (!ok && Store.status()) || 'The timeline did not take it.' };
  if (!out.ok) return out;
  return { ok: true, lane: out.lane || '', at: out.at || 0 };
}

// A sound lane below main audio with nothing on it in [a, b) - "audio 2" first, then on outwards; null when every one is taken
// there. Main audio is the film's own sound and is never chosen.
function _freeSoundLane(tracks, a, b) {
  const auds = (tracks || []).filter(x => x.kind === 'audio');
  for (const t of auds.slice(1)) {
    const busy = (t.clips || []).some(c => (+c.start || 0) < b - 0.005 && (+c.start || 0) + (+c.dur || 0) > a + 0.005);
    if (!busy) return t;
  }
  return null;
}

/**
 * (phase V54, the owner's (зв29)) A PIECE OF A SOUND at the playhead - "to timeline" of the Cut window: the same file cut by
 * `trimIn` and `dur` (no new file), on the first audio lane under main audio that is free for the whole piece, or a new one
 * made in the same step; at the ceiling it is refused in words. One step to undo; the piece laid is picked. A highlights
 * project's own timeline takes nothing ("Open a fragment first."). `kind` - 'music' lays a bed (half volume, never heard for
 * captions), 'sfx' / 'sounds' a sound effect (full volume, never heard), anything else a sound at full volume.
 * Returns { ok, lane, at } or { ok: false, why }.
 */
export function placeSoundPiece({ src, name, libId, kind, trimIn, dur, srcDur } = {}) {
  if (!_on) return { ok: false, why: 'The timeline is not showing' };
  if (!src) return { ok: false, why: 'There is no sound to lay' };
  if (Views.isHlHome(Store.key())) { Views.noFragment(); return { ok: false, why: Views.NO_FRAGMENT[0] }; }
  if (locked()) return { ok: false, why: 'The talking head is being built - the timeline takes nothing until it is done' };
  const len = _r2(+dur || 0);
  if (!(len >= 0.05)) return { ok: false, why: 'The piece is too short to lay' };
  const whole = _r2(Math.max(0, +srcDur || 0));
  const tin = _r2(Math.max(0, Math.min(+trimIn || 0, whole > 0 ? Math.max(0, whole - len) : Infinity)));
  const at = _r2(Math.max(0, _playhead));
  const id = _id();
  const k = String(kind || '');
  let lane = '', full = false;
  const ok = Store.mutate(tl => {
    const t = tl.tracks || [];
    const to = _freeSoundLane(t, at, at + len) || _newAudioLane(t);
    if (!to) { full = true; return; }
    to.clips.push({
      id, src: String(src), thumb: null, name: String(name || '').slice(0, 200), libId: libId || null,
      start: at, dur: len, srcDur: whole, trimIn: tin, trimOut: whole > 0 ? _r2(Math.max(0, whole - tin - len)) : 0,
      speed: 1, reversed: false, transition: null, animation: null, filter: null, pairId: null,
      volume: k === 'music' ? 0.5 : 1,
      ...(k === 'music' ? { bed: true } : (k === 'sfx' || k === 'sounds') ? { sfx: true } : {}),
    });
    to.clips.sort((x, y) => (+x.start || 0) - (+y.start || 0));
    lane = to.name;
  });
  if (full) return { ok: false, why: 'No audio lane is free there - four is the limit. Move the playhead, or clear a lane.' };
  if (!ok || !lane) return { ok: false, why: Store.status() || 'The piece could not be laid' };
  selectClipById(id);
  return { ok: true, lane, at };
}

/**
 * (phase V81, the owner 2026-11-09: "правой кнопкой добавить на таймлайн ... добавить раздельно или добавить сразу одним файлом")
 * FRAGMENTS OF ONE VIDEO laid on main video one after another from the playhead - each a clip of that file cut by `trimIn` and
 * `dur` (no new file; a join made first is one fragment of its own file), with its sound on main video's paired lane when the
 * file has one - as a tile let go there: the neighbours are not moved. One step to undo; the last laid is picked. A highlights
 * project's own timeline takes nothing ("Open a fragment first.").
 *   parts [{ in, out }] of the file; file { src, name, thumb, dur, kind, libId, sound }
 * Returns { ok, n, at } or { ok: false, why }.
 */
export function placeVideoPieces(parts, file) {
  if (!_on) return { ok: false, why: 'The timeline is not showing' };
  const f = file || {};
  if (!f.src) return { ok: false, why: 'There is no video to lay' };
  if (Views.isHlHome(Store.key())) { Views.noFragment(); return { ok: false, why: Views.NO_FRAGMENT[0] }; }
  if (locked()) return { ok: false, why: 'The talking head is being built - the timeline takes nothing until it is done' };
  const list = (parts || []).filter((p) => p && +p.out - +p.in >= 0.05).sort((a, b) => +a.in - +b.in);
  if (!list.length) return { ok: false, why: 'Nothing to lay' };
  const whole = _r2(Math.max(0, +f.dur || 0));
  const at = _r2(Math.max(0, _playhead));
  const mm = (s) => { const t = Math.max(0, Math.round(+s || 0)); return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0'); };
  const ids = [];
  const ok = Store.mutate(tl => {
    const t = tl.tracks || [];
    const main = t.find(x => x.kind === 'video' && x.main) || t.find(x => x.kind === 'video');
    if (!main) return;
    const mate = f.sound && main.linkId ? t.find(x => x.id === main.linkId && x.kind === 'audio') : null;
    let s = at;
    for (const p of list) {
      const tin = _r2(Math.max(0, +p.in)), len = _r2(+p.out - +p.in);
      const one = list.length === 1 && tin <= 0.01 && (!(whole > 0) || len >= whole - 0.01);
      const base = {
        src: String(f.src), thumb: f.thumb || null, name: (String(f.name || '') + (one ? '' : ' · ' + mm(tin) + '–' + mm(tin + len))).slice(0, 200),
        libId: f.libId || null, start: s, dur: len, srcDur: whole, trimIn: tin,
        trimOut: whole > 0 ? _r2(Math.max(0, whole - tin - len)) : 0,
        speed: 1, reversed: false, transition: null, animation: null, filter: null,
      };
      const pairId = mate ? 'p' + _id().slice(1) : null;
      const id = _id();
      ids.push(id);
      main.clips.push({ ...base, id, volume: 0, pairId });
      if (mate) mate.clips.push({ ...base, id: _id(), pairId, volume: String(f.kind || '') === 'birols' ? 0 : 1 });
      s = _r2(s + len);
    }
    if (mate) mate.clips.sort((x, y) => (+x.start || 0) - (+y.start || 0));
  });
  if (!ok || !ids.length) return { ok: false, why: Store.status() || 'Not laid' };
  selectClipById(ids[ids.length - 1]);
  return { ok: true, n: ids.length, at };
}

// (phase V40, tail (а), the owner 2026-10-24: "Fit / Fill и Shift пересчитывают субтитры на шве") A clip's fit or its frame
// - Fit / Fill, the Shift slider - decides whether its picture is split into bands: the subtitles' places on the seam are
// worked out again IN THE SAME STEP (public/js/captions/split.js), as the Framing switch does (framing-ui.js).
// (phase V51) So do a crop, a PiP and a placement (`tw`) - put on, taken off or sized: a cropped or placed clip covers nothing.
const SPLIT_KEYS = new Set(['fit', 'frame', 'crop', 'pip', 'tw']);

export function setClipFields(trackId, clipId, patch) {
  Store.mutate(tl => {
    const t = (tl.tracks || []).find(x => x.id === trackId);
    const c = t && (t.clips || []).find(x => x.id === clipId);
    if (!c) return;
    for (const k of Object.keys(patch || {})) if (CLIP_FIELDS.has(k)) _write(c, k, patch[k]);
    if (Object.keys(patch || {}).some(k => SPLIT_KEYS.has(k))) placeBySplit(tl);
  });
}

/**
 * (phase V49, (пр9)) Fields on SEVERAL clips in ONE mutation - one undo step: a PiP switched on, sized or moved for every main
 * clip picked at once. `items` - [{ trackId, clipId, patch }], each its own patch.
 */
export function setClipsFields(items) {
  const list = (items || []).filter(x => x && x.trackId && x.clipId && x.patch);
  if (!list.length) return false;
  return Store.mutate(tl => {
    let split = false;
    for (const it of list) {
      const t = (tl.tracks || []).find(x => x.id === it.trackId);
      const c = t && (t.clips || []).find(x => x.id === it.clipId);
      if (!c) continue;
      for (const k of Object.keys(it.patch)) if (CLIP_FIELDS.has(k)) { _write(c, k, it.patch[k]); if (SPLIT_KEYS.has(k)) split = true; }
    }
    if (split) placeBySplit(tl);
  });
}

/**
 * (phase V54, the owner's (зв8)) LEVELS HEARD WHILE A SLIDER IS HELD - the shift of several sound clips at once. Held HERE, never
 * in the store (the planning session's check: written into the live timeline, a save already due, or a newer copy adopted
 * meanwhile, carried levels nobody let go of - or the old ones were put back into a timeline that had replaced them): the
 * preview reads them every frame (preview-b.js _sounds, liveVolumeOf) and plays them at once. `list` - [{ clipId, volume }];
 * `null` lets go. The release lets go and writes the new levels with setClipsFields - ONE step.
 */
let _liveVol = null;           // clipId -> the level the preview plays while the slider is held
export function setLiveVolumes(list) {
  _liveVol = (Array.isArray(list) && list.length)
    ? new Map(list.map(x => [String(x.clipId), Math.max(0, Math.min(4, +x.volume || 0))])) : null;
}
/** The level a held slider gives this clip, or null - the preview's (preview-b.js _sounds). */
export const liveVolumeOf = (id) => (_liveVol && _liveVol.has(String(id)) ? _liveVol.get(String(id)) : null);

/** (phase V49) Every clip picked, with its lane - [{ track, clip }], in the lanes' order. */
export function selectedClips() {
  if (!_sel.size) return [];
  const out = [];
  for (const t of ((Store.timeline() || {}).tracks || [])) for (const c of (t.clips || [])) if (_sel.has(c.id)) out.push({ track: t, clip: c });
  return out;
}

/** (phase V49) The main video lane - the bottom one, the one a PiP belongs to - or null. */
export function mainVideo(tl) {
  const vids = (((tl || Store.timeline()) || {}).tracks || []).filter(t => t.kind === 'video');
  return vids.length ? vids[vids.length - 1] : null;
}

/** (phase V74) The patterns of main video - top layer first (overlay/pattern.js normalizeLayers); [] when none. */
export function patternsOf(tl) {
  const m = mainVideo(tl);
  return normalizeLayers(m && m.patterns);
}

/**
 * (phase V74) Main video's patterns become `list` - ONE undo step. Emptied, the field stays as [] when it was there (a lane's
 * field the page took off would lose to the server's copy in a merge, store.js _mergeTrack) - the server keeps none then.
 */
export function setPatterns(list) {
  return Store.mutate(tl => {
    const m = mainVideo(tl);
    if (!m) return;
    const next = normalizeLayers(list);
    if (next.length || m.patterns) m.patterns = next;
  });
}

export function setClipField(trackId, clipId, key, value) {
  if (!CLIP_FIELDS.has(key)) return;
  Store.mutate(tl => {
    const t = (tl.tracks || []).find(x => x.id === trackId);
    const c = t && (t.clips || []).find(x => x.id === clipId);
    if (!c) return;
    _write(c, key, value);
    if (c.pairId && PAIRED.has(key)) {
      for (const other of (tl.tracks || [])) {
        for (const x of (other.clips || [])) if (x !== c && x.pairId === c.pairId) _write(x, key, value);
      }
    }
    if (SPLIT_KEYS.has(key)) placeBySplit(tl);
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
// (phase V49, (пр14) а) The three effects are no longer offered - nor stamped: what a lane offers is its framing.
const STAMP_FIELDS = new Set(['fit', 'cropAlign']);

export function stampTrack(trackId, patch) {
  Store.mutate(tl => {
    const t = (tl.tracks || []).find(x => x.id === trackId);
    if (!t) return;
    for (const k of Object.keys(patch || {})) {
      if (!STAMP_FIELDS.has(k)) continue;
      for (const c of (t.clips || [])) _write(c, k, patch[k]);
    }
    if (Object.keys(patch || {}).some(k => SPLIT_KEYS.has(k))) placeBySplit(tl);
  });
}

/**
 * Back to nothing: the framing, on the lane's clips.
 *
 * It deliberately leaves speed, trims, placement and levels alone. Those are edits made by
 * hand, one clip at a time, and wiping them from a button called "reset" would be exactly the
 * surprise the stamp warning exists to prevent. (phase V49, (пр14) а) Nor the effects any more: they are not offered, and
 * what a project already has of them stays in its file for the phase that brings them back.
 */
export function resetTrack(trackId) {
  Store.mutate(tl => {
    const t = (tl.tracks || []).find(x => x.id === trackId);
    if (!t) return;
    for (const c of (t.clips || [])) {
      c.fit = null; c.cropAlign = null;
    }
    placeBySplit(tl);            // (V40) a fitted clip is never split: its subtitles go back off the seam
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
export function setSubsStyle(trackId, patch, cut, after) {
  let pages = null;
  Store.mutate(tl => {
    const t = _words(tl, trackId);
    if (!t) return;
    t.style = Object.assign({}, t.style || {}, patch || {});
    if (cut && t.kind === 'subs') pages = _recutLane(tl, t);
    if (typeof after === 'function') after(t, tl);   // (phase V49, S3) runs inside the same mutation - one undo step
  });
  return pages;
}

// THE HEARD LINES CUT AGAIN, inside a mutation (K2). The lines somebody typed stay the very same
// objects - their ids, their own style, their place - so a merge with another save still knows them;
// the pages cut from the heard words carry the own look of the lines they came from.
// (phase V40, tail (б), the owner 2026-10-24: "пресет на открытом фрагменте тоже") The new pages carry their words' places; on a
// split frame which of them is on the seam is worked out again for them (public/js/captions/split.js) - the same step.
function _recutLane(tl, t) {
  const clips = recutClips(t, tl, _id);
  if (!clips) return null;
  t.clips = clips;
  placeBySplit(tl);
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
    // (V40, tail (б)) Pages cut again: their places on a split frame's seam worked out again.
    if (made) placeBySplit(tl);
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
    placeBySplit(tl);          // (V40, tail (б)) the pages cut again, on a split frame's seam or not
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
  box.className = 'mv3-plus-menu u-menu is-float';
  const item = (label, sub, title, on) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'mv3-plus-item u-mi';
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
  item('generate image', 'the pictures chat · drag a picture onto a lane',
    'Make a picture with a model - it lands on the images shelf; drag it from the chat onto a lane',
    () => import('./picchat.js').then(m => m.openPictures())
      .catch(err => console.warn('[timeline] the pictures chat did not open:', (err && err.message) || err)));
  // The video chat, the same place (phase V3).
  item('generate video', 'the video chat · drag a clip onto a lane',
    'Make a clip with a model - it lands on the B-roll shelf; drag it from the chat onto a lane',
    () => import('./vidchat.js').then(m => m.openVideos())
      .catch(err => console.warn('[timeline] the video chat did not open:', (err && err.message) || err)));

  _showCtx(box, e);
}

// The menu fixed to the viewport and parked on the body, where the pointer was.
function _showCtx(box, e) {
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

// ── The right button on a clip (phase V54, block 2, the owner's (зв3), (зв4); phase V77, (тч1), (тч2), (тч11а)) ──────────────────
// A clip of a VIDEO lane - not a red clip whose file is gone - has a menu. (phase V77) The generation chats WITH this clip
// (js/merge-v3/tl-gen.js): a picture - "Animate…" (the video chat, the picture as its first frame) and "Change…" (the pictures
// chat); a film - "Continue…" (its last frame as the video chat's first frame), "As a reference…" (the part the timeline plays)
// and "Frame to the pictures chat…" (the frame at the playhead, else the first one it shows). A talking head's line has none of
// them (the mirror's, (тч11а)). (phase V54) A film's "Video to Music…" puts THIS clip, as it is seen, into the sound window's
// Video to Music (js/merge-v3/audchat.js); the server makes the clip into a file and lays the track under it on a lane of its
// own (V77, (тч14)). A highlights project's own timeline: "Open a fragment first.". Nothing is picked by it.
function _ctxItem(box, label, sub, title, on) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'mv3-plus-item u-mi';
  b.title = title;
  const s = document.createElement('span');
  s.textContent = label;
  const m = document.createElement('small');
  m.textContent = sub;
  b.append(s, m);
  b.addEventListener('click', (ev) => {
    ev.stopPropagation();
    _closeCtx();
    if (Views.isHlHome(Store.key())) { Views.noFragment(); return; }
    on();
  });
  box.appendChild(b);
}
function _clipMenu(e) {
  if (!_on || locked()) return;
  const host = _host();
  const el = e.target && e.target.closest ? e.target.closest('.mv3b-clip') : null;
  if (!host || !el || !host.contains(el)) return;
  const tl = Store.timeline();
  const t = ((tl && tl.tracks) || []).find(x => x.id === el.dataset.track);
  const c = t && (t.clips || []).find(x => x.id === el.dataset.clip);
  if (!t || !c || t.kind !== 'video' || Store.isGone(c) || !c.src) return;
  const still = isStill(c);
  const line = c.frag != null;
  if (still && line) return;
  e.preventDefault();
  _closeCtx();
  const box = document.createElement('div');
  box.className = 'mv3-plus-menu u-menu is-float';
  const at = _playhead;
  const gen = (act) => import('./tl-gen.js').then(G => G.fromClip(act, { trackId: t.id, clipId: c.id, at }))
    .catch(err => showError('The chat did not open', { detail: (err && err.message) || String(err) }));
  // (phase V84, (р8), (эф4)) An effect on the whole clip - first, the list of effects in the menu's place.
  if (!c.halfer) {
    _ctxItem(box, 'Add effect…', 'on the whole clip · its start and end in the inspector',
      'Add an effect to this clip - it covers the whole clip; its start and end move in the inspector, Ctrl+Z takes it off',
      () => FXUI.openList(e, (k) => FXUI.addTo(t, c, k)));
  }
  if (!line && still) {
    _ctxItem(box, 'Animate…', 'the video chat · this picture as the first frame',
      'Open the video chat with this picture as the first frame of a new clip', () => gen('animate'));
    _ctxItem(box, 'Change…', 'the pictures chat · this picture to change',
      'Open the pictures chat with this picture - say what to change in it', () => gen('edit'));
  }
  if (!line && !still) {
    const onIt = at >= (+c.start || 0) && at <= (+c.start || 0) + (+c.dur || 0);
    _ctxItem(box, 'Continue…', 'the video chat · its last frame as the first frame',
      'Open the video chat with the last frame of this clip as the first frame of a new clip that continues it', () => gen('continue'));
    _ctxItem(box, 'As a reference…', 'the video chat · the part the timeline plays',
      'Open the video chat with this clip as a reference - the part of its file the timeline plays', () => gen('ref'));
    _ctxItem(box, 'Frame to the pictures chat…', onIt ? 'the frame at the playhead' : 'its first frame',
      'Open the pictures chat with a frame of this clip - its own file, clean, at its size; saved in IMAGES → Screenshots', () => gen('frame-pic'));
  }
  if (!still) {
    const usd = 0.15 * (+c.dur || 0) / 60;
    _ctxItem(box, 'Video to Music…', 'ElevenLabs scores this clip · ' + (Math.round((+c.dur || 0) * 10) / 10) + ' s · ≈ $' + usd.toFixed(3),
      'Music made for this clip by ElevenLabs - laid under it on a sound lane of its own when it comes', () => {
        // The strip of a pick would cover the Library panel the clip goes to.
        _clearSel();
        import('./audchat.js').then(A => A.videoToMusicFromClip({ key: Store.key(), trackId: t.id, clipId: c.id }))
          .catch(err => showError('Video to Music did not open', { detail: (err && err.message) || String(err) }));
      });
  }
  _showCtx(box, e);
}

// The field (or a block that keeps its own keys - a caption's words) left focused when the timeline was pressed: blurred
// after the press's own mouseup, so Delete and Escape are the timeline's again.
let _pressIn = false;
function _letFieldGo() {
  if (!_pressIn) return;
  _pressIn = false;
  const a = document.activeElement;
  const host = _host();
  if (!a || a === document.body || !a.blur || (host && host.contains(a))) return;
  const field = /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName || '') || !!a.isContentEditable
    || !!(a.closest && a.closest('[data-own-keys]'));
  if (field) a.blur();
}

export function initTimelineB() {
  Store.onChange(() => { if (_on) _build(); });
  // (phase V36, T4) The waves follow the scroll and the panel's width, and are drawn when a file's peaks arrive.
  const host = _host();
  if (host) {
    host.addEventListener('scroll', _wavesSoon, { passive: true });
    // (phase V49.1) A wider box: the lanes and the ruler reach across it (_widen), then the waves.
    // Out of the observer's own turn: a width set inside it may resize the box again (a scroll bar), a loop it reports.
    if (window.ResizeObserver) new ResizeObserver(() => { setTimeout(_widen, 0); _wavesSoon(); }).observe(host);
    // (phase V41) A press on the timeline is not in the field last used (the zoom slider, a select of the format, a text of
    // the inspector) - every press here keeps the focus where it was (preventDefault, so a drag selects no text), and
    // Delete then counted as typing in that field. Let go of at the release, once the gesture's own work is done.
    host.addEventListener('mousedown', () => { _pressIn = true; }, true);
    // (phase V41) A drop above the top video lane or below the bottom audio one makes its lane.
    _wireGhost(host);
    // (phase V49.1, (пр27)) Alt + wheel zooms toward the playhead. Not passive: the page's own scroll is held back.
    host.addEventListener('wheel', _onWheel, { passive: false });
  }
  onPeaks(_wavesSoon);
  import('./preview-b.js').then(P => { _P = P; }).catch(() => {});
  const z = document.getElementById('mv3-zoom');
  if (z) z.addEventListener('input', () => { if (_on) { _build(); _centreOnPlayhead(); } });
  // On the document, not the clip: the pointer routinely leaves a 20px-tall element during a
  // drag, and a listener on the clip would drop the gesture the moment it did.
  document.addEventListener('mousemove', _moveDrag);
  document.addEventListener('mouseup', _endDrag);
  // (phase V36, T5) A stretch drawn over a wave follows the pointer the same way.
  document.addEventListener('mousemove', _moveRange);
  document.addEventListener('mouseup', _endRange);
  document.addEventListener('mousedown', (e) => { if (_on) _beginBand(e); });
  document.addEventListener('mousedown', _awayFromLane, true);
  // (phase V51, point 3) Picked clips too - a press on the preview is decided once the preview has had it.
  document.addEventListener('mousedown', _awayFromClip, true);
  document.addEventListener('mousedown', _afterPreviewPress);
  document.addEventListener('contextmenu', _laneMenu);
  document.addEventListener('contextmenu', _clipMenu);
  document.addEventListener('mousemove', _moveBand);
  document.addEventListener('mouseup', _endBand);
  document.addEventListener('mouseup', _letFieldGo);
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
    // (phase V36, T5) Escape lets a drawn stretch go first; the next one lets go of the pick.
    if (e.key === 'Escape' && !texty) { if (_range) _letRangeGo(); else _clearSel(); }
    // Not while typing: the inspector has fields, and Delete there means a character. And not in a block that
    // keeps its own keys (the words of a caption, where Delete takes a WORD).
    if ((e.key === 'Delete' || e.key === 'Backspace') && !typing && !(e.target.closest && e.target.closest('[data-own-keys]'))) {
      e.preventDefault();
      // (phase V36, T5) A stretch drawn over a wave: cut out of every lane. Otherwise the picked clips go.
      if (_range) cutRange();
      else _deleteSelected();
    }
    // (phase V51) Ctrl+C copies the picked clips and text lines, Ctrl+V lays them (tl-clip.js) - by the printed letter when
    // it is a Latin one, by the key's place in another alphabet ("С" and "М" in the Russian layout), as bar.js reads Ctrl+Z.
    // Not in a text field or a block that keeps its own keys: there they copy and paste text.
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && !texty && !(e.target.closest && e.target.closest('[data-own-keys]'))) {
      const key = String(e.key || '').toLowerCase();
      const k = /^[a-z]$/.test(key) ? key : (e.code === 'KeyC' ? 'c' : e.code === 'KeyV' ? 'v' : key);
      if (k === 'c' && !e.repeat) copyPicked();
      else if (k === 'v') { e.preventDefault(); if (!e.repeat) paste(); }
    }
    // (phase V44, (ы6)) S opens "cut silence" - by the key's place, so "Ы" in the Russian layout is the same key.
    if (e.code === 'KeyS' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey && !e.repeat
        && !(e.target.closest && e.target.closest('[data-own-keys]'))) {
      e.preventDefault();
      openSilence();
    }
  });
  // (phase V44) The button right of ⏩ and its window.
  wireSilence({ span: _silenceSpan, zoom: _zoom, gutter: GUTTER, host: _host, cut: _silenceCut });
  // (phase V45) Clips in a row picked: "merge?".
  wireMerge({ ids: () => [..._sel], newId: _id, select: (id) => { if (id) selectClipById(id); } });
  // (phase V51) Ctrl+C / Ctrl+V: the pick, ids, the playhead, what is laid picked, and the lanes a paste may have to make.
  wireClip({ ids: () => [..._sel], newId: _id, playhead: () => _playhead, select: _pickIds,
             video: _newVideoLane, audio: _newAudioLane, text: _newTextLane });
}

// (phase V51) These clips picked, in place of the pick - what a paste laid.
function _pickIds(ids) {
  _selBack = null;
  _sel.clear();
  _selTrack = '';
  for (const id of (ids || [])) _sel.add(String(id));
  _paintSel();
}


export const isMounted = () => _on;
export { LBL_W };
