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
import { DRAG_TYPE } from './store.js';

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

// The tracks that put pixels on the frame, top layer first. Music is heard, not drawn;
// subtitles are drawn by their own pass once they exist.
export const VISUAL_TRACKS = ['biro', 'hook', 'halfer', 'seg'];

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
    b.classList.toggle('is-sel', _isSelClip(b.parentElement.dataset.scope, b.dataset.id));
  });
  // A selected TRACK lights its whole row: what is being edited is the row, and marking
  // only its label would read as "the label is selected".
  document.querySelectorAll('#mv3-tl .mv3-tl-row[data-scope]').forEach(r => {
    r.classList.toggle('is-sel', !!_sel && _sel.kind === 'track' && _sel.scope === r.dataset.scope);
  });
}

// The room a clip has on its lane. Neighbours never overlap (the drop rule guarantees
// it), so "previous" is the furthest end at or before this clip and "next" the nearest
// start at or after it. Clamping to these is what keeps a drag from pushing one clip
// through another instead of having to repair overlaps afterwards.
function _room(clips, c) {
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

// Deletes a CLIP. A selected track is not a thing you can delete - the six tracks are
// the editor, not content - so this is a no-op rather than a guess.
function _deleteSelected() {
  if (!_sel || _sel.kind !== 'clip') return;
  const { scope, id } = _sel;
  _sel = null;
  _afterSel();
  Store.mutate(tl => {
    const tr = tl.tracks[scope];
    if (tr) tr.clips = tr.clips.filter(c => c.id !== id);
  });
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
    const { prevEnd, nextStart } = _room(clips, c);
    const speed = +c.speed || 1;
    const trimIn = +c.trimIn || 0;
    // How much timeline length the untrimmed tail of the source can still supply.
    const maxFromSource = (+c.srcDur > 0) ? ((+c.srcDur - trimIn) / speed) : Infinity;

    document.body.classList.add(mode === 'move' ? 'mv3-clipmove' : 'mv3-cliptrim');
    const next = { start: +c.start, dur: +c.dur, trimIn };

    const move = (ev) => {
      const d = (ev.clientX - x0) / pps;      // seconds of timeline
      if (mode === 'move') {
        const hi = (nextStart === Infinity) ? Infinity : nextStart - c.dur;
        next.start = Math.max(prevEnd, Math.min(hi, c.start + d));
      } else if (mode === 'trim-r') {
        const hi = Math.min(nextStart - c.start, maxFromSource);
        next.dur = Math.max(MIN_DUR, Math.min(hi, c.dur + d));
      } else {
        // Left edge: moving it right eats into the source (trimIn grows), moving it left
        // gives back what was already trimmed - and can never give back more than that.
        const lo = Math.max(prevEnd - c.start, -(trimIn / speed));
        const dd = Math.max(lo, Math.min(c.dur - MIN_DUR, d));
        next.start = c.start + dd;
        next.dur = c.dur - dd;
        next.trimIn = trimIn + dd * speed;
      }
      b.style.left = (next.start * pps) + 'px';
      b.style.width = Math.max(2, next.dur * pps) + 'px';
    };

    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      document.body.classList.remove('mv3-clipmove', 'mv3-cliptrim');
      const moved = Math.abs(next.start - c.start) > 0.001 || Math.abs(next.dur - c.dur) > 0.001;
      if (!moved) return _markSel();          // a plain click: select, change nothing
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
      });
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
    selectClip(scope, c.id);
    _deleteSelected();
  });
}

// Rebuilt wholesale rather than patched: the store hands over a whole timeline on
// every change (including an undo, which can differ arbitrarily), so diffing here
// would be a second model to keep in step for no gain at this size.
function _paintClips(pps) {
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
      b.style.background = colour;
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
// How long is it? The shelf does not say, so ask the browser. Resolves 0 rather than
// rejecting: a clip that will not report its length must not take the placement down
// with it - it gets the fallback below and can be trimmed by hand.
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

// Where a drop actually lands. Dropping ON an existing clip would stack two of them in
// the same stretch of lane, which no renderer can resolve - so the placement slides to
// the end of whatever it hit, and keeps sliding while it keeps hitting.
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
    marker().style.left = Math.max(0, e.clientX - rect.left) + 'px';
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

    const srcDur = await _probeDuration(data.src);
    const dur = srcDur > 0 ? srcDur : FALLBACK_DUR;

    Store.mutate(tl => {
      const track = tl.tracks[scope];
      if (!track) return;
      track.clips.push({
        id: 'c' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36),
        src: data.src, thumb: data.thumb || null, name: data.name || '',
        libId: data.libId || null,
        start: _freeStart(track.clips, want, dur),
        dur: Math.round(dur * 100) / 100,
        srcDur: Math.round(srcDur * 100) / 100,
        trimIn: 0, trimOut: 0, speed: 1,
        // Explicit, so the inspector's slider reads what you will actually hear rather
        // than an inherited blank: anything laid over the frame arrives SILENT and is
        // raised on purpose. Main carries the voice, so it arrives at full.
        volume: scope === 'seg' ? 1 : 0,
        reversed: false,
        transition: null, animation: null, filter: null,
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
    // Pressing bare lane or ruler also deselects. A clip's own handler stops propagation,
    // so this only fires where there is nothing.
    clearSelection();
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
  if (!host) return;
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
    if (!_sel) return;
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); _deleteSelected(); }
  });

  // The length is DERIVED from the clips, never stored: a stored duration is one more
  // value that can disagree with the thing it describes. Until there are clips, the
  // placeholder minute keeps the ruler and the playhead meaningful.
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
