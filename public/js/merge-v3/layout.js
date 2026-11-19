/* ═══════════════════════════════════════════════════════════════════════════
   MERGE v3 — the shell's geometry: two sashes, the left column and its stack.

   The left column holds the switchable pair (Library / Inspector) with the timeline
   under it; the preview takes the whole height on the right. The vertical sash sets
   the column's width, the horizontal one the timeline's height inside the column.

   Sizes are kept in localStorage, which storage-sync.js mirrors to the server
   (/api/ui-state) - so a dragged sash survives a different browser, not just a
   reload. That is the whole reason these are plain string keys and not, say, a
   CSS custom property nobody can persist.

   Every size is CLAMPED against the live viewport on the way in as well as on
   the way out. Storing a raw pixel width is only safe if a narrower window
   re-clamps it: a 900px left column restored into a 1000px window would leave
   the preview 60px wide, and nothing on the page would explain why.
   ═══════════════════════════════════════════════════════════════════════════ */

import { key as storeKey, timeline as storeTimeline } from './store.js';
// The interface's words (`t` is a lane here, so the module's words are T.t).
import * as T from '../i18n/t.js';

// "...2" keys on purpose: a width saved under an earlier key - a 360px column beside a full-width
// timeline - would put the timeline in a 360px box.
const LS_LEFT_W = 'mv3_left_w2';
const LS_TL_H   = 'mv3_timeline_h2';
const LS_TL_IN  = 'mv3_timeline_h2_in';   // the project the kept height was dragged in
const LS_OPEN   = 'mv3_open_col';

// The column carries the timeline, so it takes most of the window by default; the
// preview is a vertical and is happy with what is left.
const _defLeft = () => Math.round(window.innerWidth * 0.6);
const DEF_TL_H   = 290;

const SPINE_W     = 42;    // .mv3-col.is-collapsed in css/merge-v3.css: 34px and a 4px margin each side
const SASH        = 6;     // must match .mv3-sash in css/merge-v3.css - the 6 px gap between panels
const EDGES       = 12;    // .mv3-work's own 6 px of the base at the left and the right edge
// Wide enough that the Library header's crumbs fit, the gallery keeps a column of tiles beside the media tree, and
// the timeline under it shows its label column and a few seconds of lane.
const MIN_PANEL   = 380;   // narrowest the OPEN panel may get, beside the spine
const MIN_PREVIEW = 340;   // the 9:16 stage stops being worth looking at below this
const MIN_TL_H    = 120;   // the floor until the open project's lanes have been measured (below)
const MIN_TL_ABS  = 60;    // the header and the ruler: never less, whatever the window
const MIN_WORK_H  = 220;   // the pair above the timeline never gets shorter than this
const BAR_H       = 10;    // the lanes' horizontal scrollbar (app-shell.css ::-webkit-scrollbar)

function _num(key, def) {
  let v = null;
  try { v = parseInt(localStorage.getItem(key) || '', 10); } catch (e) {}
  return (v && !isNaN(v)) ? v : def;
}

// ── Left column width ──────────────────────────────────────────────────────
/** The widest the column can be in this window - what the panel holds with the corner moved. */
export const columnMax = () => _clampLeft(Number.MAX_SAFE_INTEGER);

function _clampLeft(px) {
  const lo = SPINE_W + MIN_PANEL;
  const hi = Math.max(lo, window.innerWidth - MIN_PREVIEW - SASH - EDGES);
  return Math.round(Math.max(lo, Math.min(px, hi)));
}
function _applyLeft(px) {
  const el = document.getElementById('mv3-left');
  if (el) el.style.width = _clampLeft(px) + 'px';
}
function _leftNow() {
  const el = document.getElementById('mv3-left');
  return el ? el.getBoundingClientRect().width : _defLeft();
}

// ── Timeline height ────────────────────────────────────────────────────────
// THE FLOOR IS THE OPEN PROJECT'S LANES: the timeline is tall enough that every lane fits, the sound lane included.
// With a 40 px audio lane, the ruler stuck to the top and the words block to the bottom, a fixed floor of 120 px would
// leave ~7 px of the audio lane in sight when a chat or the captions view puts the timeline on its floor. So the floor is
// what the lanes take - the header, the deleted-files notice, the ruler, every lane, the seam and
// the horizontal scrollbar - measured from what is drawn, not from the scroll box (_measureFloor), again whenever the lanes
// are built (a project opened, a lane added or taken away: lanesChanged) and when the window or the notice changes. (The
// sash may go below it - the hand is never held by the lanes, see _proj.) Every "the timeline to its minimum" (a chat,
// captions, scenarios, highlights, a new project, a talking head's Setup) means to it. A window too short for it keeps the
// panel above its MIN_WORK_H and the lanes scroll.
let _floor = MIN_TL_H;
// The arrangement asked for the timeline at its minimum (roomForWork, roomForTimeline) and nothing was dragged since: it
// follows the lanes down as well as up. Kept as 'floor' in place of a height.
let _atFloor = false;
// THE HEIGHT IS THE PROJECT'S. Another project opened is fitted to ITS lanes, so the tall timeline of a project with
// many lanes does not stay over a talking head with few; a height DRAGGED is the person's in the
// project it was dragged in only (a reload of that project keeps it, LS_TL_IN); and the hand is never held by the floor -
// it may take the timeline below its lanes (they scroll), down to MIN_TL_H; only the automatic places use the floor.
let _proj = null;          // the project the timeline was last fitted in; null - none since the page opened
let _panelFloor = false;   // a chat put the timeline on its floor (panelRoom) and nothing was dragged since
// A highlights fragment is its project's: moving between fragments is not another project.
const _projOf = (k) => String(k || '').replace(/^(hl_[^_]+)_\d+$/, '$1');
const _follows = () => _atFloor || (_panelOn && _panelFloor);
// AN EMPTY TIMELINE IS AT ITS MINIMUM. Lanes
// with no clip and no line on any of them (a subtitle or a text line is a clip of its lane) have nothing to show, so their
// floor is the hand's minimum, MIN_TL_H, not their height (_measureFloor); and a project opened with nothing on it goes to
// that floor whatever height was kept for it (lanesChanged) - in any project and on any step, because every automatic
// place (a talking head's setup and timeline, highlights, a chat, a new project) puts the timeline on its floor. A clip
// laid: the floor is the lanes' again and a timeline following it goes up to them; the hand drags as ever.
function _empty() {
  const t = storeTimeline();
  return !!t && Array.isArray(t.tracks) && t.tracks.every(l => !(l && Array.isArray(l.clips) && l.clips.length));
}

function _measureFloor() {
  const panel = document.getElementById('mv3-timeline');
  const tl = document.getElementById('mv3-tl');
  const inner = tl && tl.querySelector(':scope > .mv3b-inner');
  if (!panel || !tl || !inner) return _floor;
  // A highlights group's buttons in place of the timeline (hl-group.js): as tall as they need - their padding and the
  // buttons.
  const btns = panel.classList.contains('is-hlg') ? panel.querySelector(':scope > .mv3-hlg-panel') : null;
  if (btns && btns.lastElementChild) {
    const cs = getComputedStyle(btns);
    const last = btns.lastElementChild;
    return Math.ceil(last.offsetTop + last.offsetHeight + (parseFloat(cs.paddingBottom) || 0) + (parseFloat(cs.borderTopWidth) || 0));
  }
  let h = 0;
  // Everything of the panel above the lanes' box: its header, and the notice about deleted files when it shows.
  // Not what lies OVER the panel (a highlights group's buttons, absolute): it would measure the panel by itself.
  for (const ch of panel.children) if (ch !== tl && getComputedStyle(ch).position !== 'absolute') h += ch.offsetHeight;
  // The lanes as drawn: the ruler, the blocks and the seam - not the playhead or a drawn stretch, which lie over them.
  for (const ch of inner.children) {
    if (getComputedStyle(ch).position === 'absolute') continue;
    h += ch.offsetHeight;
  }
  // Nothing on the lanes: the minimum, not their height.
  return _empty() ? Math.min(MIN_TL_H, Math.ceil(h + BAR_H)) : Math.ceil(h + BAR_H);
}

// Against the column it lives in, not the page: the bar above is not room it can take. `hand`: a height the person
// set - held by MIN_TL_H, not by the lanes' floor.
function _clampTl(px, hand) {
  const col = document.getElementById('mv3-left');
  const h = col ? col.getBoundingClientRect().height : window.innerHeight;
  const room = h - MIN_WORK_H - SASH;
  const lo = Math.max(MIN_TL_ABS, Math.min(hand ? Math.min(MIN_TL_H, _floor) : _floor, room));
  const hi = Math.max(lo, room);
  return Math.round(Math.max(lo, Math.min(px, hi)));
}

/**
 * The lanes were built again (js/merge-v3/timeline-b.js, the end of _build) - or the window, or the notice over them,
 * changed: the floor is measured again. Another project: fitted to its lanes - unless this is the page's first build
 * and the height kept was dragged in this very project. Then: following its lanes, it goes to them, up or down; a height
 * the person set stays, only kept inside the column.
 */
export function lanesChanged() {
  _floor = _measureFloor();
  const k = _projOf(storeKey());
  // No project yet (the page's first build, before one is read): nothing to fit to - the next build has it.
  if (k && k !== _proj) {
    const keep = _proj === null && !_atFloor && _keptIn() === k;
    _proj = k;
    // An empty one goes to its minimum even over a height kept for it.
    if (!keep || _empty()) _atFloor = true;
  }
  const now = _tlNow();
  const to = _follows() ? _clampTl(0) : _clampTl(now, true);
  if (Math.abs(now - to) < 1) return;
  _applyTl(to, !_follows());
  _placeCross();
}

/** The timeline fitted to what it shows now - its lanes, or a highlights group's buttons - and following it again. */
export function fitTimeline() { _fitLanes(); _placeCross(); }

function _applyTl(px, hand) {
  const el = document.getElementById('mv3-timeline');
  if (el) el.style.height = _clampTl(px, hand) + 'px';
}
// The project the kept height was dragged in.
function _keptIn() {
  try { return localStorage.getItem(LS_TL_IN) || ''; } catch (e) { return ''; }
}
// The person takes the height: it stops following the lanes, the chat's floor included.
function _byHand() { _atFloor = false; _panelFloor = false; }
// A double click on the timeline's sash (or the crossing) fits it to the open project's lanes - the head, the ruler and
// the lanes as drawn, an empty timeline its minimum - and it follows them again, as when a project is opened.
function _fitLanes() {
  _atFloor = true;
  _panelFloor = false;
  _floor = _measureFloor();
  _applyTl(_clampTl(0));
}
function _tlNow() {
  const el = document.getElementById('mv3-timeline');
  return el ? el.getBoundingClientRect().height : DEF_TL_H;
}

// ── The lock ────────────────────────────────────────────────────────────────
// While a talking head is being BUILT - setup is open (js/merge-v3/workshop.js) - the timeline and
// the Library are not where the work is: the cut is laid from the fragments, and until then a clip
// dragged in from the Library would be a clip on a timeline nobody is editing. So the timeline is
// locked - blurred (css/merge-v3.css, body.mv3-locked), inert to the pointer and the keyboard - and
// the Library is folded, Setup open in its place, and it opens only with the timeline step, which
// lifts the lock first.
let _locked = false;

export function lock(on) {
  const want = !!on;
  if (want === _locked) return;
  _locked = want;
  document.body.classList.toggle('mv3-locked', want);
  // The timeline sleeps. The Library is not frozen but FOLDED.
  const tl = document.getElementById('mv3-timeline');
  if (tl) tl.inert = want;
  if (want) setOpenColumn('inspector');
  softLock(_soft);
}

/** Is the lock on? The timeline's own keys ask before they act (js/merge-v3/timeline-b.js). */
export const locked = () => _locked;

// A VOICEOVER'S TIMELINE UNDER SETUP is not blurred once something lies on it:
// seen as it is, still locked - its keys and its clips asleep - and a press on it is the way back to the timeline step
// (js/merge-v3/workshop.js listens for it). Soft only while the lock is on.
let _soft = false;
export function softLock(on) {
  _soft = !!on;
  const want = _locked && _soft;
  document.body.classList.toggle('mv3-lock-soft', want);
  const tl = document.getElementById('mv3-timeline');
  if (tl) tl.inert = _locked && !want;
}

// ── Which panel came forward ────────────────────────────────────────────────
// Told to whoever cares which of the pair is open: the Library's views take the room only while the
// panel can be seen (js/merge-v3/lib-views.js).
const _opened = [];
export function onColumnOpen(fn) { if (typeof fn === 'function') _opened.push(fn); }

// ── Which of the two left panels is open ───────────────────────────────────
// Exactly one, always. There is deliberately no "both closed" state: the pair is
// a switch, and a switch with an off position would just be a third layout to
// keep working.
export function setOpenColumn(which) {
  // Not the Library while the lock is on: setup is open, and the Library comes with the timeline
  // step, which lifts the lock before it opens it.
  if (which === 'library' && _locked) return;
  const was = document.querySelector('.mv3-col:not(.is-collapsed)');
  document.querySelectorAll('.mv3-col').forEach(c => {
    c.classList.toggle('is-collapsed', c.dataset.col !== which);
  });
  try { localStorage.setItem(LS_OPEN, which); } catch (e) {}
  if (!was || was.dataset.col !== which) for (const fn of _opened) { try { fn(which); } catch (e) { /* the switch is made */ } }
}

// ── Sash dragging ──────────────────────────────────────────────────────────
// `sign` is which way the pointer has to move to make the panel BIGGER. Both hang off an edge
// of the window, so both are -1: the column off the right edge, the timeline off the bottom.
function _wireSash(sash, { axis, sign, get, set, save, reset }) {
  if (!sash) return;
  const cls = axis === 'x' ? 'mv3-resize-v' : 'mv3-resize-h';
  sash.addEventListener('mousedown', (e) => {
    e.preventDefault();
    // The timeline's height dragged is the person's from now on: it stops following the lanes (in this project).
    if (axis === 'y') _byHand();
    const from = axis === 'x' ? e.clientX : e.clientY;
    const base = get();
    document.body.classList.add(cls);
    const move = (ev) => set(base + ((axis === 'x' ? ev.clientX : ev.clientY) - from) * sign);
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      document.body.classList.remove(cls);
      save();
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  });
  // Double click hands the size back to the default, same as the Library sash.
  sash.addEventListener('dblclick', () => { reset(); save(); });
}

// ── The crossing ────────────────────────────────────────────────────────────
// The two sashes meet at one point: the corner they share, moved in one drag rather than one sash
// after the other. It lives on the vertical sash and is kept at the horizontal
// one's height - both sizes are inline styles, so the only way to know where they cross is
// to measure it after every change.
function _placeCross() {
  const cross = document.getElementById('mv3-sash-x');
  const v = document.getElementById('mv3-sash-v');
  const h = document.getElementById('mv3-sash-h');
  if (!cross || !v || !h) return;
  const top = h.getBoundingClientRect().top + h.getBoundingClientRect().height / 2
    - v.getBoundingClientRect().top;
  cross.style.top = Math.round(top) + 'px';
}

function _wireCross() {
  const v = document.getElementById('mv3-sash-v');
  if (!v || document.getElementById('mv3-sash-x')) return;
  const cross = document.createElement('div');
  cross.className = 'mv3-sash-x';
  cross.id = 'mv3-sash-x';
  cross.title = T.t('Drag to resize the column and the timeline at once · double-click to reset both');
  v.appendChild(cross);
  _placeCross();

  cross.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();                       // not also a drag of the sash underneath
    const x0 = e.clientX, y0 = e.clientY;
    const left0 = _leftNow(), tl0 = _tlNow();
    _byHand();
    document.body.classList.add('mv3-resize-xy');
    const move = (ev) => {
      // The column hangs off the right edge, so it GROWS as the pointer goes left...
      _applyLeft(left0 - (ev.clientX - x0));
      // ...and the timeline hangs off the bottom, so it GROWS as the pointer goes up.
      _applyTl(tl0 - (ev.clientY - y0), true);
      _placeCross();
    };
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      document.body.classList.remove('mv3-resize-xy');
      _save();
      _placeCross();
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  });
  cross.addEventListener('dblclick', (e) => {
    e.stopPropagation();
    _byHand();
    _applyLeft(_defLeft());
    _fitLanes();
    _save();
    _placeCross();
  });
}

// Both sizes, written together: the crossing moves both, and saving one of them would
// leave the next reload with half of the arrangement.
function _save() {
  // While the panel holds the room its arrangement is not the person's: what is dragged then is not kept.
  if (_panelOn) return;
  try {
    localStorage.setItem(LS_LEFT_W, String(Math.round(_leftNow())));
    _keepTl();
  } catch (e) { /* a private window */ }
}
// The timeline at its minimum is kept as 'floor' - it follows the lanes after a reload too; else its height, and
// the project it was set in.
const _tlKept = () => (_atFloor ? 'floor' : String(Math.round(_tlNow())));
function _keepTl() {
  localStorage.setItem(LS_TL_H, _tlKept());
  if (_atFloor) localStorage.removeItem(LS_TL_IN);
  else if (_proj) localStorage.setItem(LS_TL_IN, _proj);
}

/**
 * THE TIMELINE STEP'S ARRANGEMENT: the timeline as tall as its
 * lanes need - measured as drawn, because lanes are not all one height - and the column 30px
 * narrower than its widest, so the preview is a little wider than setup leaves it. Clamped like
 * any drag: the panel above keeps its floor, and lanes that still do not fit scroll.
 * "As tall as its lanes" is the floor itself (_measureFloor - the scroll box's scrollHeight could only grow), and the
 * timeline keeps following it.
 */
export function roomForTimeline() {
  _floor = _measureFloor();
  _atFloor = true;
  _stepRoom(_clampLeft(Number.MAX_SAFE_INTEGER) - 30, 0);
}

/**
 * THE MOST ROOM THERE IS FOR THE WORK. A new project is opened to be
 * built, and building happens in the panel: the column takes everything the preview can spare and
 * the timeline shrinks to its floor, which puts the corner at the far left and the very bottom.
 * Saved like any drag, because it IS the arrangement from now on - until the next drag. Setup
 * comes back to it too.
 */
export function roomForWork() {
  // Clamped to what the preview can spare, and to the timeline's floor - its lanes' height, which it follows.
  _floor = _measureFloor();
  _atFloor = true;
  _stepRoom(_clampLeft(Number.MAX_SAFE_INTEGER), 0);
}

// A STEP'S ARRANGEMENT while a chat holds the room: it becomes what leaving the chat
// comes back to, and the chat keeps its corner - otherwise the step would draw over the chat's room, and
// leaving the chat would bring back an arrangement from another step.
function _stepRoom(left, tl) {
  if (_panelOn) {
    let back = null;
    try { back = JSON.parse(localStorage.getItem(LS_ROOM) || 'null'); } catch (e) { back = null; }
    if (back) {
      try { localStorage.setItem(LS_ROOM, JSON.stringify({ left: Math.round(_clampLeft(left)), tl: Math.round(_clampTl(tl)) })); } catch (e) { /* a private window */ }
      _applyLeft(Number.MAX_SAFE_INTEGER);
      _applyTl(0);
      _placeCross();
      return;
    }
  }
  _applyLeft(left);
  _applyTl(tl);
  _placeCross();
  _save();
}

/**
 * THE PANEL TAKES THE ROOM, AND GIVES IT BACK: a chat in the Library
 * panel - and the captions view - moves the corner as far left and down as it goes, and leaving it puts
 * back the arrangement there was before, whatever was dragged meanwhile. The arrangement to come back to
 * is kept apart (`mv3_pc_room_v1`) and the panel's own is never saved as the person's - a reload while it
 * shows finds the one to come back to still there.
 */
const LS_ROOM = 'mv3_pc_room_v1';
let _panelOn = false;                    // a chat holds the room right now
export function panelRoom(on) {
  _panelOn = !!on;
  let back = null;
  try { back = JSON.parse(localStorage.getItem(LS_ROOM) || 'null'); } catch (e) { back = null; }
  if (on) {
    if (!back) {
      // With whether it was following its lanes - so a height dragged under the chat does not come back as the person's.
      try { localStorage.setItem(LS_ROOM, JSON.stringify({ left: Math.round(_leftNow()), tl: Math.round(_tlNow()), floor: _atFloor })); } catch (e) { /* a private window */ }
    }
    _panelFloor = true;                      // until the person drags it
    _applyLeft(Number.MAX_SAFE_INTEGER);     // clamped to what the preview can spare
    _applyTl(0);                             // ...and to the timeline's floor
    _placeCross();
    return;
  }
  _panelFloor = false;
  if (!back) return;
  try { localStorage.removeItem(LS_ROOM); } catch (e) { /* a private window */ }
  if (back.floor) _atFloor = true;
  _applyLeft(+back.left || _defLeft());
  // Back at the lanes' height when that is what it was at - they may have changed while the panel was up, and
  // another project may have been opened meanwhile.
  _applyTl(_atFloor ? 0 : (+back.tl || DEF_TL_H), !_atFloor);
  _placeCross();
  _save();
}

export function initLayout() {
  let open = null;
  try { open = localStorage.getItem(LS_OPEN); } catch (e) {}
  setOpenColumn(open === 'inspector' ? 'inspector' : 'library');

  _applyLeft(_num(LS_LEFT_W, _defLeft()));
  let keptTl = null;
  try { keptTl = localStorage.getItem(LS_TL_H); } catch (e) { /* a private window */ }
  _atFloor = keptTl === 'floor';
  _applyTl(_atFloor ? 0 : _num(LS_TL_H, DEF_TL_H), !_atFloor);

  // A collapsed column is one big button. Clicking the open one does nothing on
  // purpose - collapsing it would leave the left side with no panel at all.
  document.querySelectorAll('.mv3-col').forEach(col => {
    col.addEventListener('click', () => {
      if (!col.classList.contains('is-collapsed')) return;
      setOpenColumn(col.dataset.col);
    });
  });

  // The column is on the RIGHT of the preview, so it grows as the pointer goes LEFT.
  _wireSash(document.getElementById('mv3-sash-v'), {
    axis: 'x', sign: -1,
    get: _leftNow, set: (px) => { _applyLeft(px); _placeCross(); },
    reset: () => { _applyLeft(_defLeft()); _placeCross(); },
    save: () => { if (_panelOn) return; try { localStorage.setItem(LS_LEFT_W, String(Math.round(_leftNow()))); } catch (e) {} },
  });

  _wireSash(document.getElementById('mv3-sash-h'), {
    axis: 'y', sign: -1,
    get: _tlNow, set: (px) => { _applyTl(px, true); _placeCross(); },
    reset: () => { _fitLanes(); _placeCross(); },
    save: () => { if (_panelOn) return; try { _keepTl(); } catch (e) {} },
  });

  _wireCross();

  // Re-clamp when the window changes, or a size that fitted yesterday's window
  // squeezes today's preview to nothing. The crossing follows whatever that leaves.
  // The floor too: the notice over the lanes may wrap onto another line in a narrower column.
  window.addEventListener('resize', () => { _applyLeft(_leftNow()); _applyTl(_tlNow(), !_follows()); lanesChanged(); _placeCross(); });
  // The notice about deleted files shown, closed or wrapped by a dragged column: the floor is measured again.
  const gone = document.getElementById('mv3-tl-gone');
  if (gone && window.ResizeObserver) {
    let h = -1;
    new ResizeObserver(() => { const now = gone.offsetHeight; if (now !== h) { h = now; lanesChanged(); } }).observe(gone);
  }
}
