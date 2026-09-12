/* ═══════════════════════════════════════════════════════════════════════════
   MERGE v3 — the timeline: track rows, ruler, playhead, zoom.

   The six tracks and their order are the previous editor's, read out of
   js/mergev2-timeline.js rather than guessed:

     Birols · Hooks · Main · Halfers · Music · Subtitles

   Birols, Hooks, Main and Halfers keep their colours from there too (#7a5cae,
   #b05010, #3a6ea5, #1a6a6a). Music and Subtitles never had a track colour - they
   were drawn by their own functions - so those two are picked here.

   NO CLIPS YET. This is the ruler, the rows and the two sliders, working: the model
   that fills the lanes is the next piece. What is deliberately absent is a second
   copy of `timeline_data_v2` - the old editor kept every session's layout in that
   one localStorage key, which is what let one stale tab revert every project at
   once. Whatever fills these lanes gets a server owner first.

   Zoom is px/sec on the same 1..240 scale the old editor used, and it is stored
   (localStorage -> mirrored to /api/ui-state by storage-sync), because it is a
   working preference and not a per-visit accident.
   ═══════════════════════════════════════════════════════════════════════════ */

import * as History from './history.js';
import * as Store from './store.js';
import { DRAG_TYPE, isStill, STILL_DUR } from './store.js';

const LS_ZOOM = 'mv3_tl_zoom';

// TOP TO BOTTOM, and the order is not cosmetic: it IS the compositing order. The higher
// a track sits here, the higher its layer in the frame - so Birols overlays Hooks, which
// overlays Halfers, which overlays Main. js/merge-v3/preview.js derives its draw order by
// reversing this list, so the two can never disagree about what is on top.
const TRACKS = [
  { scope: 'biro',   label: 'Birols',    color: '#7a5cae' },
  { scope: 'hook',   label: 'Hooks',     color: '#b05010' },
  { scope: 'halfer', label: 'Halfers',   color: '#1a6a6a' },
  { scope: 'seg',    label: 'Main',      color: '#3a6ea5' },
  { scope: 'music',  label: 'Music',     color: '#2e7d5b' },
  { scope: 'subs',   label: 'Subtitles', color: '#5d6470' },
];

// The tracks that put pixels on the frame, TOP LAYER FIRST. Music is heard, not drawn;
// subtitles are drawn by their own pass once they exist. The order is the ffmpeg overlay
// chain read backwards - Main is the picture, hooks and birols go over it in that order
// (see buildPayload), and the halfer band goes over those. It used to put Halfers UNDER
// the other two, which meant a birol crossing a halfer covered the band on screen and sat
// beneath it in the file.
export const VISUAL_TRACKS = ['halfer', 'biro', 'hook', 'seg'];

// A clip on Main that came from the library is an INSERT, not a fragment of the read: no
// line was written for it and the sequence was not timed around it. Same lane, because it
// takes its turn in the same sequence - but its own colour, because telling one from the
// other at a glance is the whole reason it is allowed on that lane. `libId` is what says
// which is which: it is set by a library drop and null on everything the import writes.
const INSERT_COLOR = '#8a3a5c';
const _isInsert = (scope, c) => scope === 'seg' && !!c.libId;

// The width of the sticky label column. Also in css/merge-v3.css as --mv3-lbl-w;
// the playhead is positioned in px, so the two have to agree.
const LBL_W = 78;
// With no project open there is nothing to measure, so the ruler spans a minute.
// Replaced by the model's real duration once there is one.
const PLACEHOLDER_DUR = 60;

let _at = 0;        // playhead, seconds
let _dur = PLACEHOLDER_DUR;

function _zoom() {
  const z = document.getElementById('mv3-zoom');
  return z ? (parseInt(z.value, 10) || 60) : 60;
}

function _fmtClock(t) {
  const s = Math.max(0, t);
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  return m + ':' + (rest < 10 ? '0' : '') + rest.toFixed(1);
}

// Adaptive tick step: the smallest "nice" interval that keeps labels ~70px apart, so
// a long timeline at low zoom stays readable instead of turning into a grey bar.
const NICE_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
function _tickLabel(s) {
  return s >= 60 ? (Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0')) : (s + 's');
}

function _paintRuler(ruler, pps) {
  ruler.textContent = '';
  const step = NICE_STEPS.find(s => s * pps >= 70) || 600;
  for (let s = 0; s <= Math.ceil(_dur); s += step) {
    const tick = document.createElement('div');
    tick.className = 'mv3-tick';
    tick.style.left = (s * pps) + 'px';
    const cap = document.createElement('span');
    cap.textContent = _tickLabel(s);
    tick.appendChild(cap);
    ruler.appendChild(tick);
  }
}

function _applyWidths() {
  const pps = _zoom();
  const inner = document.querySelector('#mv3-tl .mv3-tl-inner');
  if (!inner) return;
  const w = Math.ceil(_dur * pps) + 40;
  inner.style.width = (LBL_W + w) + 'px';
  inner.querySelectorAll('.mv3-tl-lane, .mv3-tl-ruler').forEach(el => { el.style.width = w + 'px'; });
  const ruler = inner.querySelector('.mv3-tl-ruler');
  if (ruler) _paintRuler(ruler, pps);
  _paintClips(pps);
  _paintPlayhead();
  const pill = document.getElementById('mv3-tl-pps');
  if (pill) pill.textContent = String(pps);
}

// ── Selection ───────────────────────────────────────────────────────────────
// Either one clip or one whole track:
//     { kind:'clip',  scope, id }   |   { kind:'track', scope }   |   null
//
// Two kinds rather than two variables, because they are mutually exclusive - the
// inspector shows one thing, and a state where both a clip and a track were "selected"
// would have to pick anyway.
//
// Kept here rather than in the store: which clip you are looking at is a property of
// this view, not of the project. Saving it would make one tab's cursor jump because
// another tab clicked something.
let _sel = null;
const MIN_DUR = 0.1;

const _selSubs = [];
export function onSelect(cb) {
  if (typeof cb !== 'function') return;
  _selSubs.push(cb);
  try { cb(_sel); } catch (e) {}
}
function _afterSel() {
  _markSel();
  for (const cb of _selSubs) { try { cb(_sel); } catch (e) {} }
}

const _isSelClip = (scope, id) => !!_sel && _sel.kind === 'clip' && _sel.scope === scope && _sel.id === id;

// ── Several at once ─────────────────────────────────────────────────────────
// A SECOND, separate selection, deliberately. The one above is what the Inspector reads, and
// it is single by nature: a panel of settings for four clips at once has no honest meaning.
// This one is for the band - picking a stretch of the cut to move or throw away - and keeping
// them apart is what lets the band exist without rewriting the Inspector's contract.
//
// Keyed scope|id and not by element: this timeline is rebuilt from the model on every change,
// so a set of elements would be stale the moment anything moved.
// THE BAND IS FOR OVERLAYS AND CAPTIONS. Main is the read: its clips are the spoken cut, end
// to end, and they carry the whole timing of the video. Sweeping a rectangle over that and
// moving or deleting several at once is not an edit anybody means to make - it is what happens
// on the way to selecting something else. Music is out for a different reason: it is a bed,
// one clip laid the length of the film, and there is nothing there to sweep.
//
// Captions ARE in. They arrive from a transcription, which is why they were left out at first,
// and that turned out to be the argument for including them: when a read is re-timed the words
// need moving as a block, and moving thirty of them one at a time is not an edit anybody means
// to make either.
const BAND_SCOPES = ['biro', 'hook', 'halfer', 'subs'];

const _multi = new Set();
const _mk = (scope, id) => scope + '|' + id;
export function multiCount() { return _multi.size; }
export function deleteMulti() { _deleteSelected(); }
const _isMulti = (scope, id) => _multi.has(_mk(scope, id));

function _clearMulti() {
  if (!_multi.size) return;
  _multi.clear();
  _afterSel();
}

let _band = null;

// Everything the band TOUCHES, not everything it encloses. The lanes are 24px tall and clips
// are routinely wider than the screen, so a band that had to contain a clip would never
// catch one.
function _bandDown(e) {
  if (e.button !== 0) return;
  const host = document.getElementById('mv3-tl');
  if (!host || !host.contains(e.target)) return;
  if (e.target.closest('.mv3-clip') || e.target.closest('.mv3-tl-lbl')) return;
  if (!e.target.closest('.mv3-tl-lane')) return;
  const el = document.createElement('div');
  el.className = 'mv3-band';
  document.body.appendChild(el);
  _band = { x0: e.clientX, y0: e.clientY, el, add: e.shiftKey, moved: false };
  if (!e.shiftKey) _multi.clear();
}

function _bandMove(e) {
  if (!_band) return;
  const x = Math.min(_band.x0, e.clientX), y = Math.min(_band.y0, e.clientY);
  const w = Math.abs(e.clientX - _band.x0), h = Math.abs(e.clientY - _band.y0);
  if (w > 3 || h > 3) _band.moved = true;
  Object.assign(_band.el.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px' });
  const box = { l: x, t: y, r: x + w, b: y + h };
  document.querySelectorAll('#mv3-tl .mv3-clip').forEach(c => {
    const q = c.getBoundingClientRect();
    const scope = c.parentElement.dataset.scope || (c.closest('.mv3-tl-row') || {}).dataset?.scope;
    if (!BAND_SCOPES.includes(scope)) return;
    const key = _mk(scope, c.dataset.id);
    const hit = q.left < box.r && q.right > box.l && q.top < box.b && q.bottom > box.t;
    if (hit) _multi.add(key);
    else if (!_band.add) _multi.delete(key);
  });
  _afterSel();
}

function _bandUp() {
  if (!_band) return;
  _band.el.remove();
  _band = null;
  // A press that never became a drag is a click on bare lane, and that is a seek now - the
  // sweep it did not become leaves the selection exactly as it was, single or multiple. Esc
  // clears either; a new sweep replaces the multiple one.
  _afterSel();
}

export function selected() { return _sel; }
export function selectClip(scope, id) {
  _sel = (scope && id) ? { kind: 'clip', scope, id } : null;
  _afterSel();
}
export function selectTrack(scope) {
  _sel = scope ? { kind: 'track', scope } : null;
  _afterSel();
}
export function clearSelection() { _sel = null; _afterSel(); }

function _markSel() {
  document.querySelectorAll('#mv3-tl .mv3-clip').forEach(b => {
    const _sc = b.parentElement.dataset.scope;
    b.classList.toggle('is-sel', _isSelClip(_sc, b.dataset.id) || _isMulti(_sc, b.dataset.id));
  });
  // A selected TRACK lights its whole row: what is being edited is the row, and marking
  // only its label would read as "the label is selected".
  document.querySelectorAll('#mv3-tl .mv3-tl-row[data-scope]').forEach(r => {
    r.classList.toggle('is-sel', !!_sel && _sel.kind === 'track' && _sel.scope === r.dataset.scope);
  });
}

// ── The overlay lanes ───────────────────────────────────────────────────────
// Birols, Hooks and Halfers are the same kind of thing: something laid over the cut. Main
// is the cut itself and cannot take two clips at once - a second one there is a picture
// the compositor has no rule for. The three overlay lanes can: laying one insert over
// another, to cover a join or to run two takes into each other, is what they are for. And
// because they are the same kind of thing, a clip may be dragged from any of them to any
// other; only what the lane MAKES of it changes.
//
// Which one shows is array order: the preview draws a track's clips in the order they are
// stored and the renderer chains its overlays the same way, so "on top" and "last in the
// list" are one fact, not two that can disagree. Moving a clip is what says which one you
// mean to see, so a move puts it last.
const OVERLAY_SCOPES = ['biro', 'hook', 'halfer'];
const _canOverlap = (scope) => OVERLAY_SCOPES.includes(scope);

// The room a clip has on its lane. Where clips may not overlap, "previous" is the furthest
// end at or before this clip and "next" the nearest start at or after it; clamping to those
// is what keeps a drag from pushing one clip through another instead of repairing overlaps
// afterwards. Where they may, there is nothing to clamp to.
function _room(clips, c, scope) {
  if (_canOverlap(scope)) return { prevEnd: 0, nextStart: Infinity };
  let prevEnd = 0, nextStart = Infinity;
  const cs = +c.start, ce = cs + (+c.dur);
  for (const o of clips) {
    if (o.id === c.id) continue;
    const s = +o.start, e = s + (+o.dur);
    if (e <= cs + 0.001) { if (e > prevEnd) prevEnd = e; }
    else if (s >= ce - 0.001) { if (s < nextStart) nextStart = s; }
  }
  return { prevEnd, nextStart };
}

// REMOVING A FRAGMENT FROM MAIN CLOSES THE GAP BEHIND IT.
//
// Main is a sequence, so a hole in it is black picture and silence - never what somebody
// meant by cutting a piece out. Everything that begins after the removed stretch therefore
// slides left by exactly its length: the rest of Main, and with it the overlays and captions
// pinned to the picture (_ripple), so a birol stays over the shot it was placed against.
//
// By the SAME distance, all of it. Nothing is clamped to the join, because clamping is how
// three overlays end up stacked on one instant. What lay entirely INSIDE the removed stretch
// is left where it is rather than dragged backwards past the cut - it has nothing to be
// measured against any more, and it is still there to be moved or removed by hand.
//
// Only Main. A hole in an overlay lane is precisely what removing an overlay means, and
// music is not pinned to a shot at all (see RIPPLE_SCOPES).
function _cutOut(tl, scope, id) {
  const tr = tl.tracks[scope];
  if (!tr) return;
  const c = (tr.clips || []).find(x => x.id === id);
  tr.clips = (tr.clips || []).filter(x => x.id !== id);
  if (!c || scope !== 'seg') return;
  const dur = +c.dur || 0;
  _ripple(tl, (+c.start || 0) + dur, -dur);
  _markSubsStale(tl);
}

// The captions are the words being said at that moment, and a cut changes which words those
// are. Sliding them keeps them off the wrong shot but cannot mend a sentence cut in half -
// only the audio as it now stands can, through Whisper. So the project remembers that it was
// cut under existing captions, and the top bar says so until they are made again. On the
// track, not in a variable: it has to survive a reload, and an undo has to take it back.
function _markSubsStale(tl) {
  const subs = tl.tracks && tl.tracks.subs;
  if (subs && Array.isArray(subs.clips) && subs.clips.length) subs.stale = true;
}

/** Removing a clip from somewhere other than the lane itself - the inspector's Remove
 *  buttons. Through the same door as the X on the clip, so Main closes up behind it there
 *  too; two ways of removing a fragment that left the timeline in two different shapes is
 *  exactly the kind of disagreement this file keeps in one place. */
export function removeClip(scope, id) { Store.mutate(tl => _cutOut(tl, scope, id)); }

// Deletes a CLIP. A selected track is not a thing you can delete - the six tracks are
// the editor, not content - so this is a no-op rather than a guess.
function _deleteSelected() {
  // The band wins when it holds anything: it is the more deliberate of the two, and the
  // single selection is usually just whatever was last clicked on the way to drawing it.
  if (_multi.size) {
    const jobs = [..._multi].map(k => k.split('|'));
    _multi.clear();
    _sel = null;
    _afterSel();
    Store.mutate(tl => {
      // Rightmost first. Each cut is measured where it was made, and closing a gap only
      // moves what is to the right of it - so working backwards leaves every cut still to
      // come sitting at the time it was read at.
      const at = ([scope, id]) => {
        const tr = tl.tracks[scope];
        const c = tr && (tr.clips || []).find(x => x.id === id);
        return c ? (+c.start || 0) : 0;
      };
      for (const [scope, id] of jobs.slice().sort((a, b) => at(b) - at(a))) _cutOut(tl, scope, id);
    });
    return;
  }
  if (!_sel || _sel.kind !== 'clip') return;
  const { scope, id } = _sel;
  _sel = null;
  _afterSel();
  Store.mutate(tl => _cutOut(tl, scope, id));
}

// ── Asking first, on every lane ─────────────────────────────────────────────
// The X sits a few pixels from the surface the clip is dragged by, so the press that
// removes a clip is easy to make by accident - and on a lane where clips overlap it is
// easy to hit the wrong one. It opens a question instead of doing the deed.
//
// This began on Main alone, on the reasoning that everywhere else holds a library clip
// one drag from being back. That undersold the loss: an overlay carries its placement,
// its trim, its volume and its effects, and none of that comes back with the file. The
// question is cheap; re-doing the work is not.
let _ask = null;

function _closeAsk() {
  if (!_ask) return;
  _ask.el.remove();
  document.removeEventListener('mousedown', _ask.away, true);
  document.removeEventListener('keydown', _ask.key, true);
  window.removeEventListener('scroll', _closeAsk, true);
  _ask = null;
}

function _askDelete(btn, scope, id) {
  _closeAsk();
  selectClip(scope, id);                      // so it is plain WHICH clip is in question

  const el = document.createElement('div');
  el.className = 'mv3-ask';
  const t = document.createElement('span');
  t.className = 'mv3-ask-t';
  t.textContent = 'Remove?';
  const yes = document.createElement('button');
  yes.type = 'button'; yes.className = 'mv3-ask-b is-yes'; yes.textContent = 'Yes';
  const no = document.createElement('button');
  no.type = 'button'; no.className = 'mv3-ask-b'; no.textContent = 'No';
  el.append(t, yes, no);
  document.body.appendChild(el);

  // Fixed to the viewport and parked on the body: inside the lane the timeline's own
  // scrolling would clip it, and a lane is 24px tall - there is no room to open into.
  // Above the X by preference, below it when the timeline is near the top of the screen.
  const r = btn.getBoundingClientRect();
  const w = el.offsetWidth, h = el.offsetHeight;
  const left = Math.max(6, Math.min(window.innerWidth - w - 6, r.left + r.width / 2 - w / 2));
  const above = r.top - h - 6;
  el.style.left = Math.round(left) + 'px';
  el.style.top = Math.round(above >= 6 ? above : r.bottom + 6) + 'px';

  const away = (e) => { if (!el.contains(e.target)) _closeAsk(); };
  const key = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); _closeAsk(); }
    // Delete and Backspace are wired to _deleteSelected on the document. With the question
    // open they would answer it from behind, which is the one thing this is here to stop.
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); e.stopPropagation(); }
  };
  _ask = { el, away, key };
  document.addEventListener('mousedown', away, true);
  document.addEventListener('keydown', key, true);
  window.addEventListener('scroll', _closeAsk, true);

  yes.addEventListener('mousedown', (e) => {
    e.preventDefault(); e.stopPropagation();
    _closeAsk();
    selectClip(scope, id);
    _deleteSelected();
  });
  no.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); _closeAsk(); });
}

// ── Split at the playhead ───────────────────────────────────────────────────
// One clip becomes two that play the same source continuously: the first keeps the head of
// the segment, the second picks up exactly where it left off. That is what trimIn is for -
// the second half starts further into the file, by however much timeline the first half
// consumed (times its speed, since a sped-up second of timeline eats more than a second of
// source).
export function splitSelected() {
  if (!_sel || _sel.kind !== 'clip') return { ok: false, why: 'nothing selected' };
  const { scope, id } = _sel;
  const tl = Store.timeline();
  const tr = tl && tl.tracks[scope];
  const c = tr && tr.clips.find(x => x.id === id);
  if (!c) return { ok: false, why: 'nothing selected' };
  const durA = _at - c.start;
  const durB = c.dur - durA;
  // Refuse rather than make a sliver: a 0.05s clip is not an edit, it is litter.
  if (durA < MIN_DUR || durB < MIN_DUR) return { ok: false, why: 'the playhead is not inside the clip' };

  const speed = +c.speed || 1;
  const r2 = (v) => Math.round(v * 100) / 100;
  Store.mutate(d => {
    const t = d.tracks[scope];
    const a = t && t.clips.find(x => x.id === id);
    if (!a) return;
    const b = JSON.parse(JSON.stringify(a));
    b.id = a.id + '_s' + Date.now().toString(36).slice(-4);
    b.start = r2(_at);
    b.dur = r2(durB);
    b.trimIn = r2((+a.trimIn || 0) + durA * speed);
    // b keeps a's trimOut: the tail of the source is still where it was.
    a.dur = r2(durA);
    if (+a.srcDur > 0) a.trimOut = Math.max(0, r2(a.srcDur - (+a.trimIn || 0) - a.dur * speed));
    t.clips.push(b);
  });
  // Select the second half: after a cut, the part you have not looked at yet is the one you
  // are about to work on. Found by its start rather than by remembering the generated id.
  const t2 = Store.timeline().tracks[scope];
  const made = t2.clips.find(x => x.id !== id && x.start === Math.round(_at * 100) / 100);
  if (made) selectClip(scope, made.id);
  return { ok: true };
}

// ── Changing lanes ──────────────────────────────────────────────────────────
// The overlay lane the pointer is over, or null for anywhere else. Read from the lanes
// themselves rather than from the pointer's ancestry: the block being dragged sits under
// the cursor the whole time, so elementFromPoint would only ever answer "the clip".
function _laneUnder(y) {
  for (const lane of document.querySelectorAll('#mv3-tl .mv3-tl-lane')) {
    if (!_canOverlap(lane.dataset.scope)) continue;
    const r = lane.getBoundingClientRect();
    if (y >= r.top && y <= r.bottom) return lane;
  }
  return null;
}

// A clip changing lanes changes what it IS. A Halfer is a band pinned to an edge; a Birol
// or a Hook covers the frame, or is a rectangle placed on it. Carrying the old lane's
// fields across would leave a band wearing a picture-in-picture transform, which the
// renderer reads as neither one thing nor the other.
// A halfer has no placement AT ALL now, so the four transform fields are cleared on the way
// in and nothing writes them again. The band's own three replace the two words it used.
function _reshape(c, scope) {
  if (scope === 'halfer') {
    c.tx = null; c.ty = null; c.tw = null; c.angle = null;
    // Left alone when already set, so a clip moved out of the lane and back keeps its band.
    if (c.halferPos == null) c.halferPos = c.halferAlign === 'bottom' ? 0 : 100;
    if (c.halferThick == null) c.halferThick = 40;
    if (c.halferKeep == null) c.halferKeep = c.valign === 'bottom' ? 0 : 100;
    c.halferAlign = null; c.valign = null;   // superseded by the numbers above
  } else {
    c.halferAlign = null; c.rotation = null; c.valign = null;
    c.halferPos = null; c.halferThick = null; c.halferKeep = null;
  }
}

// ── Dragging a clip: move, or trim by either edge ───────────────────────────
// The gesture moves the DOM and NOTHING else, then commits once on release. Two reasons,
// both learned the hard way: routing every mousemove through the store would rebuild the
// very element under the pointer (the repaint replaces blocks wholesale), and it would
// write one undo step per pixel.
function _wireClip(b, c, scope, pps, clips) {
  const begin = (e, mode) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();          // the lane below would otherwise seek as well
    selectClip(scope, c.id);

    const x0 = e.clientX;
    // GRABBING ONE OF SEVERAL TAKES THEM ALL, and they travel the same seconds.
    //
    // Sideways only, and only for a move: where a group of clips from three different lanes
    // should land when dragged onto one lane has no obvious answer, and guessing at it would
    // scatter a selection irretrievably. A trim is about one clip's length and stays that way.
    //
    // Captured here, once - the starts as well as the blocks - because the gesture moves the
    // DOM and nothing else, and reading the store mid-drag would answer with the state before
    // the drag on every frame.
    const group = (mode === 'move' && _multi.size > 1 && _isMulti(scope, c.id))
      ? [..._multi].map(k => {
          const i = k.indexOf('|');
          return { scope: k.slice(0, i), id: k.slice(i + 1) };
        })
        .filter(g => !(g.scope === scope && g.id === c.id))
        .map(g => {
          const tl = Store.timeline();
          const tr = tl && tl.tracks && tl.tracks[g.scope];
          const x = tr && (tr.clips || []).find(y => y.id === g.id);
          return x ? { ...g, at: +x.start,
                       el: document.querySelector('#mv3-tl .mv3-tl-row[data-scope="' + g.scope
                            + '"] .mv3-clip[data-id="' + g.id + '"]') } : null;
        })
        .filter(g => g && g.el)
      : [];

    const { prevEnd, nextStart } = _room(clips, c, scope);
    const speed = +c.speed || 1;
    const trimIn = +c.trimIn || 0;
    // How much timeline length the untrimmed tail of the source can still supply.
    const maxFromSource = (+c.srcDur > 0) ? ((+c.srcDur - trimIn) / speed) : Infinity;

    // ── Ripple: trimming on Main takes the length out of the sequence ────────
    // Main is one continuous read, so shortening a fragment there must not leave a hole
    // where the words used to be - everything after it slides over by what was cut. The
    // clip itself keeps its place, including when the HEAD is trimmed: the seconds given
    // up come out of the sequence rather than turning into silence in front of it.
    //
    // A trim that ripples is also not clamped by the neighbour it would otherwise run
    // into, because that neighbour is what moves out of the way. The overlay lanes are
    // untouched: an insert sits at a moment chosen against the cut, and closing a gap
    // there would drag it off the thing it was placed against.
    const ripple = (scope === 'seg' && mode !== 'move');
    // The blocks that ride along, captured once. They move with the DOM during the gesture
    // for the same reason the dragged block does - so what is released is what was shown.
    const riders = !ripple ? [] : clips
      .filter(x => x.id !== c.id && (+x.start) >= (+c.start) + (+c.dur) - 0.001)
      .map(x => ({ at: +x.start, el: b.parentElement.querySelector('.mv3-clip[data-id="' + x.id + '"]') }))
      .filter(r => r.el);

    document.body.classList.add(mode === 'move' ? 'mv3-clipmove' : 'mv3-cliptrim');
    const next = { start: +c.start, dur: +c.dur, trimIn };
    // Which lane the clip will land on. Only a move can change it - a trim is a gesture
    // about length, and dragging an edge a few pixels off the lane should not rehome it.
    let land = scope;

    // How far the HAND has to travel before this is a drag rather than a click. Measured in
    // page pixels and not in seconds: at a high zoom one pixel is a hundredth of a second, so
    // without this a clip crept every time it was merely picked - and a group of them crept
    // together, which is the same mistake multiplied.
    const SLOP = 3;
    let started = false;

    const move = (ev) => {
      if (!started) {
        if (Math.abs(ev.clientX - x0) < SLOP && Math.abs(ev.clientY - e.clientY) < SLOP) return;
        started = true;
      }
      const d = (ev.clientX - x0) / pps;      // seconds of timeline
      if (mode === 'move' && group.length) {
        // One delta for everybody, and nobody may be pushed before the start of the film -
        // so the whole set stops when its earliest member reaches zero, keeping the spacing
        // that was selected.
        //
        // NOTHING ELSE CLAMPS IT. A single clip stops at its neighbours; a group does not,
        // because the neighbours of five clips on three lanes are not one boundary and
        // picking one of them would be arbitrary. What was selected moves where it is put,
        // and if it lands over something unselected, that is what was asked for.
        const floor = Math.min(c.start, ...group.map(g => g.at));
        const dd = Math.max(-floor, d);
        next.start = c.start + dd;
        for (const g of group) g.el.style.left = ((g.at + dd) * pps) + 'px';
      } else if (mode === 'move') {
        const hi = (nextStart === Infinity) ? Infinity : nextStart - c.dur;
        next.start = Math.max(prevEnd, Math.min(hi, c.start + d));
        // Follow the pointer between the overlay lanes, and MOVE the block as it goes: the
        // gesture is already the DOM one and nothing else, so the clip crossing lanes under
        // the cursor is the honest preview of what release will do. Leaving the lane
        // altogether keeps the last overlay lane it was over rather than snapping home -
        // the pointer strays off a 24px lane constantly while dragging sideways.
        if (_canOverlap(scope)) {
          const lane = _laneUnder(ev.clientY);
          if (lane && lane.dataset.scope !== land) {
            land = lane.dataset.scope;
            lane.appendChild(b);
            // Takes the lane's colour on the way in, so the block says what it is about to
            // become rather than what it was.
            b.style.background = (TRACKS.find(x => x.scope === land) || {}).color || b.style.background;
          }
        }
      } else if (mode === 'trim-r') {
        const hi = Math.min(ripple ? Infinity : (nextStart - c.start), maxFromSource);
        next.dur = Math.max(MIN_DUR, Math.min(hi, c.dur + d));
      } else {
        // Left edge: moving it right eats into the source (trimIn grows), moving it left
        // gives back what was already trimmed - and can never give back more than that.
        const lo = ripple ? -(trimIn / speed) : Math.max(prevEnd - c.start, -(trimIn / speed));
        const dd = Math.max(lo, Math.min(c.dur - MIN_DUR, d));
        // Rippling, the clip does not move: the head it gives up leaves the sequence, so
        // the block shortens from its far edge and the rest of the track comes to meet it.
        next.start = ripple ? c.start : c.start + dd;
        next.dur = c.dur - dd;
        next.trimIn = trimIn + dd * speed;
      }
      b.style.left = (next.start * pps) + 'px';
      b.style.width = Math.max(2, next.dur * pps) + 'px';
      if (riders.length) {
        const delta = next.dur - c.dur;
        for (const r of riders) r.el.style.left = ((r.at + delta) * pps) + 'px';
      }
    };

    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      document.body.classList.remove('mv3-clipmove', 'mv3-cliptrim');
      const moved = Math.abs(next.start - c.start) > 0.001 || Math.abs(next.dur - c.dur) > 0.001
                 || land !== scope;
      if (!moved) {
        // A PLAIN CLICK PARKS THE PLAYHEAD IN THE MIDDLE OF WHAT WAS CLICKED. Selecting a
        // clip is nearly always a prelude to looking at it, and having to then find it with
        // the ruler is a second gesture for one intention. The middle rather than the start
        // because a clip's first frames are its transition - the least representative part
        // of it - and because on Main the start is a cut, where two fragments meet.
        //
        // Here and not on mousedown: this branch is what already distinguishes a click from
        // a drag, so a trim or a move is not interrupted by the picture jumping first.
        // seek() and not setPlayhead(), because the preview should follow.
        seek((+c.start || 0) + (+c.dur || 0) / 2);
        return _markSel();                    // select, change nothing about the clip
      }
      Store.mutate(tl => {
        const tr = tl.tracks[scope];
        const t = tr && tr.clips.find(x => x.id === c.id);
        if (!t) return;
        const r2 = (v) => Math.round(v * 100) / 100;
        t.start = r2(next.start);
        t.dur = r2(next.dur);
        t.trimIn = r2(Math.max(0, next.trimIn));
        // Derived, so it can never disagree with the other three.
        t.trimOut = (+t.srcDur > 0) ? Math.max(0, r2(t.srcDur - t.trimIn - t.dur * (t.speed || 1))) : 0;
        // The rest of the group, in the SAME mutation - one undo step for one thing the
        // person did, however many blocks moved while they did it.
        if (group.length) {
          const dd = next.start - (+c.start);
          for (const g of group) {
            const gt = tl.tracks[g.scope] && tl.tracks[g.scope].clips.find(x => x.id === g.id);
            if (gt) gt.start = r2(Math.max(0, g.at + dd));
          }
        }
        // The sequence closes up (or opens) by exactly what the trim took or gave back.
        // Read off the committed length rather than the gesture, so the clamps that shaped
        // it are the ones the rest of the track obeys too.
        if (ripple) _ripple(tl, (+c.start) + (+c.dur), t.dur - (+c.dur));
        const to = (land !== scope) ? tl.tracks[land] : null;
        if (to) {
          tr.clips = tr.clips.filter(x => x !== t);
          _reshape(t, land);
          to.clips = to.clips.concat(t);      // arriving in front, like any other move
        } else if (_canOverlap(scope)) {
          // Last in the list is front-most. Only worth doing where clips can cover each
          // other - on the other lanes it would churn the order for nothing to look at.
          tr.clips = tr.clips.filter(x => x !== t).concat(t);
        }
      });
      // The selection followed the clip, not the lane it used to be on.
      if (land !== scope) selectClip(land, c.id);
    };

    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  };

  b.addEventListener('mousedown', (e) => begin(e, 'move'));
  b.querySelector('.mv3-clip-h.l').addEventListener('mousedown', (e) => begin(e, 'trim-l'));
  b.querySelector('.mv3-clip-h.r').addEventListener('mousedown', (e) => begin(e, 'trim-r'));
  // Delete is a button on the clip, not only a key: the report on the old editor is that
  // its keyboard shortcuts did not work, so the visible control is the one that counts.
  b.querySelector('.mv3-clip-del').addEventListener('mousedown', (e) => {
    e.preventDefault(); e.stopPropagation();
    _askDelete(e.currentTarget, scope, c.id);
  });
}

// Rebuilt wholesale rather than patched: the store hands over a whole timeline on
// every change (including an undo, which can differ arbitrarily), so diffing here
// would be a second model to keep in step for no gain at this size.
function _paintClips(pps) {
  // Every clip element is about to be replaced, including the X an open question is
  // pinned to - so the question goes with it rather than hanging over a stale spot.
  _closeAsk();
  const t = Store.timeline();
  document.querySelectorAll('#mv3-tl .mv3-tl-lane').forEach(lane => {
    lane.querySelectorAll('.mv3-clip').forEach(el => el.remove());
    const scope = lane.dataset.scope;
    const track = t && t.tracks && t.tracks[scope];
    if (!track) return;
    const colour = (TRACKS.find(x => x.scope === scope) || {}).color || '#555';
    const clips = track.clips || [];
    for (const c of clips) {
      const b = document.createElement('div');
      b.className = 'mv3-clip' + (_isSelClip(scope, c.id) ? ' is-sel' : '');
      b.dataset.id = c.id;
      b.style.left = (c.start * pps) + 'px';
      b.style.width = Math.max(2, c.dur * pps) + 'px';
      b.style.background = _isInsert(scope, c) ? INSERT_COLOR : colour;
      // A PICTURE WEARS ITSELF. Lane colour says which track a clip is on, which is exactly
      // what does not distinguish a still from the clips around it - a birol and an image on
      // the Birols lane would be the same rectangle with different words in it. Stretching
      // the thumbnail across the block makes it unmistakable on any lane, and says WHICH
      // picture as well. background-size: 100% 100% on purpose: the block is resized by
      // trimming, and a cover-crop would show a different part of the picture at every width,
      // which reads as the content changing when only the length did.
      if (isStill(c) && c.thumb) {
        b.classList.add('is-still');
        b.style.backgroundImage = 'url("' + c.thumb.replace(/"/g, '%22') + '")';
        b.style.backgroundSize = '100% 100%';
      }
      b.title = (c.name || '') + ' · ' + c.dur.toFixed(2) + 's'
        + (c.trimIn ? ' · in +' + c.trimIn.toFixed(2) + 's' : '')
        + (c.trimOut ? ' · out -' + c.trimOut.toFixed(2) + 's' : '');

      const cap = document.createElement('span');
      cap.className = 'mv3-clip-cap';
      cap.textContent = c.name || '';
      b.appendChild(cap);

      for (const side of ['l', 'r']) {
        const h = document.createElement('div');
        h.className = 'mv3-clip-h ' + side;
        b.appendChild(h);
      }
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'mv3-clip-del';
      del.textContent = '✕';
      del.title = 'Remove from the timeline (the library keeps the clip)';
      b.appendChild(del);

      lane.appendChild(b);
      _wireClip(b, c, scope, pps, clips);
    }
  });
}

// ── Dropping a library clip onto a lane ─────────────────────────────────────
// How long is it? For the sources the shelf has no recorded length for, ask the browser.
// Resolves 0 rather than rejecting: a clip that will not report its length must not take
// the placement down with it - it gets the fallback below and can be trimmed by hand.
function _probeDuration(src) {
  return new Promise(resolve => {
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.addEventListener('loadedmetadata', () => resolve(v.duration || 0), { once: true });
    v.addEventListener('error', () => resolve(0), { once: true });
    v.src = src;
  });
}
const FALLBACK_DUR = 3;

// Where an insert goes INTO a sequence: at the nearest join between two fragments, never
// inside one. Main is a read, and dropping halfway through a fragment means "before or
// after this one" - the nearer edge is the one meant. Splitting the fragment to make room
// would cut a sentence in half and leave two clips where the words say there is one.
function _nearestJoin(clips, want) {
  let best = 0, gap = Math.abs(want);
  for (const c of clips) {
    for (const edge of [+c.start, (+c.start) + (+c.dur)]) {
      const d = Math.abs(edge - want);
      if (d < gap) { gap = d; best = edge; }
    }
  }
  return Math.round(best * 100) / 100;
}

// Set a clip's length outright, obeying the same rule a trim does: on Main the sequence
// closes up or opens by exactly the difference, everywhere else the clip simply changes
// width. Exported because the inspector offers a still a typed duration - a picture has no
// source length to trim against, so a number is the honest control - and the ripple rule
// must have ONE home. Writing the shift a second time in the inspector is how the three
// copies of the stacking rule came about, and they disagreed.
export function setClipDur(scope, id, dur) {
  const next = Math.max(MIN_DUR, Math.round((+dur || 0) * 100) / 100);
  Store.mutate(tl => {
    const tr = tl.tracks[scope];
    const c = tr && (tr.clips || []).find(x => x.id === id);
    if (!c) return;
    const was = +c.dur || 0;
    if (Math.abs(next - was) < 0.005) return;
    c.dur = next;
    if (scope === 'seg') _ripple(tl, (+c.start) + was, next - was);
  });
}

// Everything from a point on, moved by delta. This is the one operation a sequence needs
// that a free lane does not: room is made and given back by sliding the rest of the track,
// never by leaving a hole in it or letting two clips share a stretch.
function _shiftFrom(clips, at, delta) {
  if (!(Math.abs(delta) > 0.001)) return;
  for (const o of clips) {
    if ((+o.start) >= at - 0.001) o.start = Math.round(((+o.start) + delta) * 100) / 100;
  }
}

// WHAT ELSE MOVES when the Main sequence opens or closes. Everything pinned to the picture:
// the overlays, which sit at a moment chosen against a particular shot, and the captions,
// which are the words being spoken at that moment. Music does NOT move - a bed is not pinned
// to a shot, and shifting it would either tear a hole in it or knock it off its beat.
//
// This used to shift Main alone. Every insert therefore left the captions where they were,
// so the words ran ahead of the voice by exactly the length of the insert - silently, and
// visible only on playback. It is the same fault as the subtitles that drifted at render
// time, and it has the same answer: one rule, in one place, applied to every lane the
// picture carries.
const RIPPLE_SCOPES = ['seg', 'biro', 'hook', 'halfer', 'subs'];

function _ripple(tl, at, delta) {
  if (!tl || !(Math.abs(delta) > 0.001)) return;
  for (const k of RIPPLE_SCOPES) {
    const tr = tl.tracks && tl.tracks[k];
    if (tr && Array.isArray(tr.clips)) _shiftFrom(tr.clips, at, delta);
  }
}

// Where a drop actually lands, on the lanes that hold one clip at a time and do not shift
// to make room. Dropping ON an existing clip would stack two of them over the same stretch,
// so the placement slides to the end of whatever it hit, and keeps sliding while it keeps
// hitting. Main and the overlay lanes each have their own rule and never come here.
function _freeStart(clips, want, dur) {
  let at = Math.max(0, want);
  let guard = 0;
  let moved = true;
  while (moved && guard++ < 200) {
    moved = false;
    for (const c of clips) {
      const s = +c.start, e = s + (+c.dur);
      if (at < e && (at + dur) > s) { at = e; moved = true; }
    }
  }
  return Math.round(at * 100) / 100;
}

const _hasClip = (e) => Array.from((e.dataTransfer && e.dataTransfer.types) || []).indexOf(DRAG_TYPE) >= 0;

function _wireLaneDrop(lane) {
  const marker = () => {
    let m = lane.querySelector('.mv3-drop-mark');
    if (!m) { m = document.createElement('div'); m.className = 'mv3-drop-mark'; lane.appendChild(m); }
    return m;
  };
  lane.addEventListener('dragover', (e) => {
    if (!_hasClip(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    lane.classList.add('is-drop');
    const rect = lane.getBoundingClientRect();
    const px = Math.max(0, e.clientX - rect.left);
    // On Main the mark stands at the join the insert will actually open, not under the
    // cursor: the drop snaps, and a mark that did not would promise a place nothing lands.
    const tl = Store.timeline();
    const snap = (lane.dataset.scope === 'seg' && tl)
      ? _nearestJoin(tl.tracks.seg.clips || [], px / _zoom()) * _zoom()
      : px;
    marker().style.left = snap + 'px';
  });
  lane.addEventListener('dragleave', (e) => {
    if (!e.relatedTarget || !lane.contains(e.relatedTarget)) {
      lane.classList.remove('is-drop');
      const m = lane.querySelector('.mv3-drop-mark'); if (m) m.remove();
    }
  });
  lane.addEventListener('drop', async (e) => {
    if (!_hasClip(e)) return;
    e.preventDefault();
    lane.classList.remove('is-drop');
    const m = lane.querySelector('.mv3-drop-mark'); if (m) m.remove();

    let data = null;
    try { data = JSON.parse(e.dataTransfer.getData(DRAG_TYPE)); } catch (err) { return; }
    if (!data || !data.src) return;

    const scope = lane.dataset.scope;
    const rect = lane.getBoundingClientRect();
    const want = Math.max(0, (e.clientX - rect.left) / _zoom());

    // The clip lands NOW. Waiting for _probeDuration first meant nothing appeared until the
    // head of the file had been fetched, which over a network is seconds and reads as a
    // broken editor. The library sends the length it has recorded since the clip was made,
    // so the usual drop is laid down at its true width with nothing to correct. Only a
    // source the shelf knows no duration for - a hook, an older record - starts at the
    // placeholder and is resized once the file answers, and that resize is the reason to
    // prefer the known value: a clip that changes width after it lands looks like a bug.
    // A picture is not a film: there is no length in the file to ask for, so it is given
    // one. Ten seconds - long enough to read, short enough that trimming down is the
    // common direction. srcDur stays 0, which is what lets it stretch either way without
    // a source running out; see the maxFromSource note in the trim.
    const still = isStill({ src: data.src });
    const known = still ? 0 : (+data.dur || 0);
    const dur = still ? STILL_DUR : (known > 0 ? known : FALLBACK_DUR);
    const id = 'c' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);

    Store.mutate(tl => {
      const track = tl.tracks[scope];
      if (!track) return;
      // On Main the drop makes ROOM for itself: the sequence opens at the nearest join and
      // everything from there on moves right by the insert's length. Anywhere else in the
      // read there is no room to be had - the fragments are already end to end - so a drop
      // that did not push would either land on top of a fragment or be refused outright.
      const at = (scope === 'seg') ? _nearestJoin(track.clips, want) : 0;
      if (scope === 'seg') _ripple(tl, at, dur);
      track.clips.push({
        id,
        src: data.src, thumb: data.thumb || null, name: data.name || '',
        libId: data.libId || null,
        start: scope === 'seg' ? at
             : _canOverlap(scope) ? Math.round(Math.max(0, want) * 100) / 100
                                  : _freeStart(track.clips, want, dur),
        dur: Math.round(dur * 100) / 100,
        srcDur: known > 0 ? Math.round(known * 100) / 100 : 0,
        trimIn: 0, trimOut: 0, speed: 1,
        // Explicit, and its own from the moment it lands. Following the track was tried and
        // taken out again: what it gave was a master slider, and what it cost was knowing at a
        // glance what any one clip is set to. Levels here are set per clip, by hand.
        volume: scope === 'seg' ? 1 : 0,
        reversed: false,
        transition: null, animation: null, filter: null,
      });
    });

    // Nothing more to do when the length came with the clip - or when there was never a
    // length to come. _probeDuration asks a <video> element, which a PNG answers with an
    // error, so running it for a still is a wasted round trip with no answer at the end.
    if (known > 0 || still) return;

    // Otherwise: the correction, once the file has told us how long it is. It only writes
    // into a clip still exactly as it was dropped - srcDur unknown, length still the
    // placeholder. Trim or resize it in those few hundred milliseconds and that is an edit;
    // overwriting it here would undo a deliberate act with a stale answer.
    _probeDuration(data.src).then(srcDur => {
      if (!(srcDur > 0)) return;
      Store.mutate(tl => {
        const tr = tl.tracks[scope];
        const c = tr && tr.clips.find(x => x.id === id);
        if (!c || c.srcDur) return;
        const was = c.dur;
        c.srcDur = Math.round(srcDur * 100) / 100;
        if (c.dur === Math.round(dur * 100) / 100) c.dur = c.srcDur;
        // Main opened a gap the size of the placeholder. The real length has to be paid for
        // out of the same sequence, or the insert would grow into the fragment after it.
        if (scope === 'seg') _ripple(tl, c.start + was, c.dur - was);
      });
    });
  });
}

// Whether Split can act depends on where the playhead is, which changes on every frame of
// playback - so it is repainted from here rather than only on selection or store changes.
let _splitPaint = null;

function _paintPlayhead() {
  const ph = document.querySelector('#mv3-tl .mv3-tl-ph');
  if (ph) ph.style.left = (LBL_W + _at * _zoom()) + 'px';
  const clock = document.getElementById('mv3-tl-clock');
  if (clock) clock.textContent = _fmtClock(_at);
  if (_splitPaint) _splitPaint();
}

// Two ways in, and the difference matters. seek() is "the user moved the playhead" and
// tells whoever is listening (the preview follows it). setPlayhead() is "the clock moved"
// and only repaints - the preview calls it on every frame while playing, and notifying
// back would be a feedback loop between the two.
const _seekSubs = [];
export function onSeek(cb) { if (typeof cb === 'function') _seekSubs.push(cb); }
export function playheadAt() { return _at; }

export function setPlayhead(t) {
  _at = Math.max(0, Math.min(_dur, t));
  _paintPlayhead();
}

export function seek(t) {
  setPlayhead(t);
  for (const cb of _seekSubs) { try { cb(_at); } catch (e) {} }
}

// Click seeks, and holding scrubs - the old ruler behaved this way and it is the one
// interaction people expect from a timeline. Wired on the ruler AND on every lane, so
// you can seek from wherever the pointer already is.
function _wireScrub(el) {
  el.addEventListener('mousedown', (e) => {
    e.preventDefault();
    // Seeking is ALL this does. Pressing bare lane or ruler used to deselect as well, so
    // moving the playhead to look at a clip you had just picked took the Inspector off it -
    // the two gestures share the lane, and the second was undoing the first. The selection
    // now stays until something else is picked or Esc clears it.
    const rect = el.getBoundingClientRect();
    const pps = _zoom();
    const to = (clientX) => seek((clientX - rect.left) / pps);
    to(e.clientX);
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
}

function _build() {
  const host = document.getElementById('mv3-tl');
  if (!host || !_mounted) return;
  host.textContent = '';

  const inner = document.createElement('div');
  inner.className = 'mv3-tl-inner';

  // Ruler row. Its label cell is the corner: empty, but it has to be there or the
  // ruler would start 78px left of the lanes below it.
  const rr = document.createElement('div');
  rr.className = 'mv3-tl-row is-ruler';
  const corner = document.createElement('div');
  corner.className = 'mv3-tl-lbl is-corner';
  const ruler = document.createElement('div');
  ruler.className = 'mv3-tl-ruler';
  rr.appendChild(corner); rr.appendChild(ruler);
  inner.appendChild(rr);
  _wireScrub(ruler);

  for (const t of TRACKS) {
    const row = document.createElement('div');
    row.className = 'mv3-tl-row';
    row.dataset.scope = t.scope;

    const lbl = document.createElement('div');
    lbl.className = 'mv3-tl-lbl';
    lbl.textContent = t.label;
    lbl.title = 'Settings for the whole ' + t.label + ' track';
    // The colour swatch is how a lane is identified at a glance once clips land in it,
    // so it is on the label rather than on the clips alone.
    lbl.style.borderLeft = '3px solid ' + t.color;
    // The track name IS the control for track-wide settings - the same gesture the old
    // editor used, so the muscle memory carries over.
    lbl.addEventListener('click', () => selectTrack(t.scope));

    const lane = document.createElement('div');
    lane.className = 'mv3-tl-lane';
    lane.dataset.scope = t.scope;
    _wireScrub(lane);
    _wireLaneDrop(lane);

    row.appendChild(lbl); row.appendChild(lane);
    inner.appendChild(row);
  }

  const ph = document.createElement('div');
  ph.className = 'mv3-tl-ph';
  inner.appendChild(ph);

  host.appendChild(inner);
}

// ── FIT ─────────────────────────────────────────────────────────────────────
// The zoom at which the whole timeline is on screen at once. Measured from the
// scroll box, not the window: the left column and the timeline's own height are
// both draggable, so the available width is only knowable at the moment of asking.
//
// clientWidth rather than getBoundingClientRect: the box scrolls, and clientWidth
// is the part actually visible after any vertical scrollbar has taken its cut.
function _fit() {
  const host = document.getElementById('mv3-tl');
  if (!host) return;
  const avail = host.clientWidth - LBL_W - 12;      // 12: the same slack _applyWidths leaves
  if (avail <= 0 || !_dur) return;
  const pps = Math.max(1, Math.min(240, Math.floor(avail / _dur)));
  const z = document.getElementById('mv3-zoom');
  // Move the SLIDER, not just the drawing: leaving the two disagreeing means the
  // next nudge of the slider jumps back to wherever its thumb happened to be.
  if (z) z.value = String(pps);
  try { localStorage.setItem(LS_ZOOM, String(pps)); } catch (e) {}
  _applyWidths();
  host.scrollLeft = 0;                               // fitted means "from the start"
}

// ── ZOOM HOLDS THE PLAYHEAD ─────────────────────────────────────────────────
// Changing the zoom used to leave the scroll position alone, which anchors the view to a
// PIXEL: at 60 px/sec that pixel is a different second than it is at 200, so pulling the
// slider slid the timeline sideways under the eye and the playhead could leave the screen
// entirely. Zooming in is a way of looking closer at the moment you are on, so that moment
// is what stays put - in the middle of the lanes, where there is room on both sides of it.
//
// The label column is sticky and never scrolls, so the strip the playhead has to be centred
// in starts after it, and the scroll position is measured from the lane's own zero.
// Negative clamps to 0; past the end the browser clamps by itself.
function _centreOnPlayhead() {
  // Not while the blank editor holds the panel: it listens to the same slider and keeps its
  // own playhead, and two modules scrolling one box would fight over it.
  if (!_mounted) return;
  const host = document.getElementById('mv3-tl');
  if (!host) return;
  const strip = host.clientWidth - LBL_W;
  if (strip <= 0) return;
  host.scrollLeft = Math.max(0, _at * _zoom() - strip / 2);
}

function _wireHistoryButtons() {
  const u = document.getElementById('mv3-undo');
  const r = document.getElementById('mv3-redo');
  if (u) u.addEventListener('click', () => { History.undo(); });
  if (r) r.addEventListener('click', () => { History.redo(); });
  // The buttons paint themselves from the stack, so they can never claim there is
  // something to undo when there is not.
  History.onChange(() => {
    const d = History.depth();
    if (u) { u.disabled = !History.canUndo(); u.title = 'Undo' + (d.undo ? ' (' + d.undo + ')' : ' - nothing yet'); }
    if (r) { r.disabled = !History.canRedo(); r.title = 'Redo' + (d.redo ? ' (' + d.redo + ')' : ' - nothing yet'); }
  });
}

// The talking-head timeline owns the panel unless a blank project is open. Both modules
// draw into the same element, so exactly one of them may hold it at a time - the dispatcher
// in main.js decides which, and neither module guesses.
let _mounted = true;

export function mount() {
  _mounted = true;
  _build();
  // AND THE WIDTHS. _build fills the lanes; what gives them their size against the zoom is
  // _applyWidths, which used to run only on a zoom change or on Fit. Coming back from the
  // other workflow therefore drew clips into lanes with no width - an empty-looking timeline
  // that appeared the moment Fit was pressed, which is what made it look like a repaint bug.
  _applyWidths();
}
export function unmount() { _mounted = false; }
export const isMounted = () => _mounted;

export function initTimeline() {
  _build();

  const z = document.getElementById('mv3-zoom');
  if (z) {
    let saved = null;
    try { saved = parseInt(localStorage.getItem(LS_ZOOM) || '', 10); } catch (e) {}
    if (saved && !isNaN(saved)) z.value = String(Math.max(1, Math.min(240, saved)));
    // input, not change: the ruler has to follow the slider while it is being dragged.
    z.addEventListener('input', () => {
      _applyWidths();
      _centreOnPlayhead();          // the moment you are on is what the zoom is about
      try { localStorage.setItem(LS_ZOOM, String(_zoom())); } catch (e) {}
    });
  }

  const fit = document.getElementById('mv3-fit');
  if (fit) fit.addEventListener('click', _fit);

  const split = document.getElementById('mv3-split');
  if (split) {
    split.addEventListener('click', () => {
      const r = splitSelected();
      // A refusal says why in the button's own tooltip and title rather than in an alert:
      // it is a "not now", not an error.
      split.title = r.ok ? 'Cut the selected clip at the playhead' : r.why;
    });
    // Enabled only when there is something to cut, so the button reports the state instead
    // of accepting a click and doing nothing.
    const paint = () => {
      const s = _sel;
      let can = false;
      if (s && s.kind === 'clip') {
        const tr = (Store.timeline() || { tracks: {} }).tracks[s.scope];
        const c = tr && tr.clips.find(x => x.id === s.id);
        if (c) can = (_at - c.start) >= MIN_DUR && (c.start + c.dur - _at) >= MIN_DUR;
      }
      split.disabled = !can;
    };
    onSelect(paint);
    Store.onChange(paint);
    _splitPaint = paint;      // the playhead moves far more often than either of those
  }
  // Re-fitting on resize is NOT wired on purpose: FIT is an action, not a mode, and
  // a window resize silently changing the zoom you chose is worse than a scrollbar.

  _wireHistoryButtons();

  // Keys are a shortcut for the buttons, never the only way: Delete also lives on the
  // clip itself. Ignored while typing, or a stray Backspace in a field would eat a clip.
  document.addEventListener('keydown', (e) => {
    const t = e.target;
    if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
    if (e.key === 'Escape') { clearSelection(); return; }
    // EITHER KIND OF SELECTION. The guard used to ask only about the single one, and a band
    // selection can arrive without it. So Delete did nothing after a sweep, on any lane,
    // while the panel said it was the shortcut for the button it was offering.
    if (!_sel && !_multi.size) return;
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); _deleteSelected(); }
  });

  // The length is DERIVED from the clips, never stored: a stored duration is one more
  // value that can disagree with the thing it describes. Until there are clips, the
  // placeholder minute keeps the ruler and the playhead meaningful.
  document.addEventListener('mousedown', _bandDown);
  document.addEventListener('mousemove', _bandMove);
  document.addEventListener('mouseup', _bandUp);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') _clearMulti();
  });

  Store.onChange(() => {
    const d = Store.duration();
    _dur = d > 0 ? d : PLACEHOLDER_DUR;
    if (_at > _dur) _at = _dur;
    _applyWidths();
    _paintStatus();
  });

  _applyWidths();
}

// The store speaks up for exactly one reason worth interrupting for: a write was
// refused because someone else moved the timeline, and an edit was lost. Silence there
// is indistinguishable from the bug this store exists to prevent.
function _paintStatus() {
  const el = document.getElementById('mv3-tl-status');
  if (!el) return;
  const s = Store.status();
  el.textContent = s || '';
  el.hidden = !s;
}
