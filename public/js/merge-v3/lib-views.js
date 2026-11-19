/* ═══════════════════════════════════════════════════════════════════════════
   MERGE v3 — the Library panel's views, ONE owner.

   The panel shows the shelf, a view registered the way a chat is (below - among them the scenarios a talking
   head is made from, scen-pick.js, its crumb "scenarios /" left of "Library" and hidden in a
   talking head), or the captions view (preset tiles beside the settings of the captions picked on
   the timeline). Two kinds of state, kept apart:
     the BASE      the shelf or one chat - remembered per project HERE (viewOf / rememberView), told by
                   the chats; a chat takes or lets go of only ITS OWN base, so two chats never reset each
                   other on a project switch;
     the OVERLAY   captions - it belongs to what is PICKED (inspector.js says when), never remembered:
                   the pick does not survive a reload, and letting go of it puts the base back.
   What shows is the overlay over the base. This module alone writes what follows from that: the panel's
   class (is-chat / is-captions) and which chat's box and buttons show (is-shown), the header - the CRUMBS
   "Library / captions", always there, the one showing lit, any other one press away - and THE ROOM - the corner of the
   sashes as far left and down as it goes while a chat or the captions view can be SEEN, the arrangement there was before
   put back when neither is (layout.js panelRoom). One owner of the room: leaving the chat while captions show must not
   put the corner back under them.

   THE PICTURES CHAT AND THE VIDEO CHAT ARE WINDOWS (chat-window.js) - hosted chats
   that register nothing here. What is registered the way a chat is: the scenarios (scen-pick.js), a highlights
   project's tiles (highlights.js), a voiceover's B-roll piece (broll-view.js). The sound is a window too:
   js/sound/sound-window.js.
   ═══════════════════════════════════════════════════════════════════════════ */

import { panelRoom, onColumnOpen } from './layout.js';
import { showError } from '../notice.js';
import { homeOf, isHome } from '../highlights/keys.js';
import * as T from '../i18n/t.js';

const $ = (id) => document.getElementById(id);

// Which view each project was left on: { projectKey: <a view's name> }.
const LS_VIEW = 'mv3_lib_view_v1';

let _base = 'shelf';         // 'shelf' or the name of a chat
let _caps = false;           // the captions view is up
let _held = false;           // the room is taken
let _frame = 0;
let _capsBack = null;        // what letting go of the captions does (the pick released)
let _capsOpen = null;        // what the "captions" crumb does from another view (the subtitle lane picked)
// The views registered the way a chat is, by name: { root, crumb } element ids, onBack (leave it for the shelf), onYield
// (another view took the base), onCrumb (its crumb pressed from another view).
const _chats = new Map();

/** What shows: 'captions', the name of a chat, or 'shelf'. */
export const top = () => (_caps ? 'captions' : _base);
export const isCaptions = () => _caps;
/** A chat is the base (whether or not the captions are over it) - the shelf's own drop stands down. */
export const isChat = () => _base !== 'shelf';

/** A view says who it is, where its box and crumb are, and what pressing back and the crumb do. */
export function registerChat(name, o) {
  const c = Object.assign({ root: '', crumb: '', crumbTitle: '', onBack: null, onYield: null, onCrumb: null }, o || {});
  _chats.set(name, c);
  // Its crumb opens it from any view - the shelf, the other chat, the captions (the chat's own open lets go of
  // them); pressed while the chat shows, it does nothing - and never reaches the panel header, whose press folds
  // the panel.
  const crumb = $(c.crumb);
  if (crumb) crumb.addEventListener('click', (e) => { e.stopPropagation(); if (top() !== name && c.onCrumb) c.onCrumb(); });
  _paint();
}

/**
 * A chat says whether it is the base. It can take the base from another chat (that one is told, onYield) but can
 * only let go of its own.
 */
export function setBase(name, on) {
  const c = _chats.get(name);
  if (!c) return;
  if (on && _base !== name) {
    const was = _chats.get(_base);
    _base = name;
    if (was && was.onYield) was.onYield();
  } else if (!on && _base === name) _base = 'shelf';
  _paint();
}

/** The captions view let go of (the pick released) - when the panel is asked to show the shelf or a chat. */
export function toBase() { if (_caps && _capsBack) _capsBack(); }

/** Whatever chat is the base leaves it for the shelf - the Library is asked to show something on it. */
export function toShelf() {
  const c = _chats.get(_base);
  if (c && c.onBack) c.onBack();
}

// ── A HIGHLIGHTS PROJECT's keys ─────────────────────────────────────────────
// Its own timeline hl_<id> - its home, open while no fragment is - and a fragment's hl_<id>_<n> (highlights.js KEY_RE). The chats
// talk in ONE conversation per highlights project: a fragment's key is its home's wherever a chat keys by project (the thread,
// what it made, the view it was left on, what was being written); and nothing is laid on the home, which is never rendered.
/** The key a chat's conversation is kept under: a highlights fragment's is its project's home, any other key is itself. */
export const chatKey = homeOf;
/** The open timeline is a highlights project's own (no fragment open). */
export const isHlHome = isHome;
/** What a drag of a chat's result says there. */
export const NO_FRAGMENT = [T.t('Open a fragment first.'), T.t('Press a fragment\'s tile in highlights - this is the project\'s own timeline, and nothing on it is rendered.')];
/**
 * Said wherever something would be laid on the home - a chat's result dragged
 * there and a drop on its lanes, refused on release: a popup (js/notice.js) with "to highlights", which brings the tiles back
 * (the highlights view's own crumb, highlights.js) and lets the popup go.
 */
export function noFragment() {
  showError(NO_FRAGMENT[0], { detail: NO_FRAGMENT[1], action: { label: T.t('To highlights'), run: () => {
    const c = _chats.get('highlights');
    if (c && c.onCrumb) c.onCrumb();
  } } });
}

/** A highlights project is open: its crumbs are "highlights / Library / captions" (css/mv3-highlights.css). */
export function setHighlights(on) {
  const panel = $('mv3-library');
  if (panel) panel.classList.toggle('is-hl', !!on);
}

/** The inspector says whether the captions view is up. */
export function setCaptions(on) {
  if (_caps === !!on) return;
  _caps = !!on;
  _paint();
}

/** What letting go of the captions does ("Library" or a chat's crumb pressed over them). */
export function onBack(view, fn) { if (view === 'captions') _capsBack = fn; }
/** What the "captions" crumb does from another view (the inspector picks the subtitle lane). */
export function onOpen(view, fn) { if (view === 'captions') _capsOpen = fn; }

// THE CAPTIONS OF WHAT IS NOT ON THE TIMELINE - a highlights project's ticked fragments. A base
// view may offer the captions view a target of its own while nothing is picked:
//   wants()       its crumb would open it now (fragments ticked)
//   open()        the crumb was pressed: it is up until let go of
//   active()      it is up
//   release()     let go of ("Library", the base's own crumb)
//   render(host)  its strip drawn into the inspector's strip; returns the tiles' target { preset, edited, apply, readOnly }
// The inspector still decides what the captions view shows - a pick on the timeline comes first - so there is one owner of it.
let _alt = null;
let _altPaint = null;
export function captionsAlt(p) { _alt = p || null; }
export const altCaptions = () => (_alt && _alt.active() ? _alt : null);
export const altWants = () => !!(_alt && _alt.wants());
export function altOpen() { if (_alt) _alt.open(); if (_altPaint) _altPaint(); _altTell(); }
export function altRelease() { if (_alt) _alt.release(); _altTell(); }
/** The inspector says how to paint again when the alternative target changes (its fragments ticked or not). */
export function onAltChange(fn) { _altPaint = fn; }
export function altChanged() { if (_altPaint) _altPaint(); _altTell(); }
// Whoever wants to know that the alternative was opened, let go of or painted again (hl-group.js: «example» on the preview).
const _altSeen = new Set();
export function onAltShown(fn) { if (typeof fn === 'function') _altSeen.add(fn); }
function _altTell() { for (const fn of _altSeen) { try { fn(); } catch (e) { /* the next one still hears */ } } }

// A LANE'S NAME pressed may lead to another strip than the lane's own - a highlights project's
// ticked fragments: Subtitles, main audio and the music lane give the common settings of all of them (hl-group.js).
//   wants(track)         that strip instead of the lane's own now
//   render(host, track)  drawn into the inspector's strip; returns the captions tiles' target, or null
let _laneAlt = null;
export function laneAlt(p) { _laneAlt = p || null; }
export const laneAltFor = (track) => (_laneAlt && track && _laneAlt.wants(track) ? _laneAlt : null);
// A block of a view's ON TOP of a lane's own strip, or of a clip's on it - a highlights fragment's music (the choice of
// another of the standard tracks):
//   wants(track, clip)        that block now (clip - the clip picked on the lane, or none for the lane's name)
//   render(host, track, clip)
let _laneExtra = null;
export function laneExtra(p) { _laneExtra = p || null; }
export const laneExtraFor = (track, clip) => (_laneExtra && track && _laneExtra.wants(track, clip || null) ? _laneExtra : null);

// ── The view each project was left on ──────────────────────────────────────
function _views() {
  let v = {};
  try { v = JSON.parse(localStorage.getItem(LS_VIEW) || '') || {}; } catch (e) { v = {}; }
  return v;
}

/** The chat a project was left on ('' for the shelf). A highlights project's fragments share its home's mark. */
export const viewOf = (key) => String(_views()[chatKey(key)] || '');

/** A chat came forward (`name`) or was left (`null`) on this project - only its own mark is taken away. */
export function rememberView(key, name, was) {
  const v = _views();
  const k = chatKey(key);
  if (name) v[k] = name;
  else if (!was || v[k] === was) delete v[k];
  try { localStorage.setItem(LS_VIEW, JSON.stringify(v)); } catch (e) { /* a private window */ }
}

function _libraryOpen() {
  const lib = $('mv3-library');
  return !!lib && !lib.classList.contains('is-collapsed');
}

// The room follows what shows, a frame later - so a talking head's step lays its own arrangement first
// (layout.js keeps that as what leaving comes back to, _stepRoom).
function _room() {
  if (_frame) cancelAnimationFrame(_frame);
  _frame = requestAnimationFrame(() => {
    _frame = 0;
    // Asked for by sync(): decided here, a frame later, when every chat has said what it is on this project -
    // one chat leaving and another taking the base in the same tick would otherwise see the shelf between.
    if (_syncWanted && top() === 'shelf' && !_held) panelRoom(false);
    _syncWanted = false;
    const want = top() !== 'shelf' && _libraryOpen();
    if (want === _held) return;
    _held = want;
    panelRoom(want);
  });
}

/** A project opened, or the page came back: a room left taken by an earlier visit is given back. */
let _syncWanted = false;
export function sync() {
  _syncWanted = true;
  _room();
}

function _paint() {
  const t = top();
  const panel = $('mv3-library');
  if (panel) {
    panel.classList.toggle('is-chat', _chats.has(t));
    panel.classList.toggle('is-captions', t === 'captions');
    // The scenarios with the media tree beside them (css/merge-v3.css, merge-v3/library.js).
    panel.classList.toggle('is-scen', t === 'scenarios');
  }
  const title = $('mv3-lib-title');
  if (title) {
    // A link always: it leads to the Library's roots, from the shelf too.
    title.classList.add('is-link');
    title.title = T.t('The Library - REFERENCES, VIDEO, IMAGES, AUDIO');
    // Blue while the gallery is what shows; white over a view or the captions.
    title.classList.toggle('is-on', t === 'shelf');
  }
  for (const [name, c] of _chats) {
    const on = t === name;
    const root = $(c.root);
    if (root) root.classList.toggle('is-shown', on);
    const crumb = $(c.crumb);
    if (crumb) {
      crumb.classList.toggle('is-on', on);
      crumb.title = on ? '' : (c.crumbTitle || '');
    }
  }
  const cap = $('mv3-lib-cap');
  if (cap) {
    cap.classList.toggle('is-on', t === 'captions');
    cap.title = t === 'captions' ? '' : T.t('The subtitle lane - its look and the caption presets');
  }
  _room();
}

/** What "Library" does once the shelf is back: the panel's roots (js/merge-v3/library.js toRoots). */
let _toRoots = null;
export function onLibraryRoots(fn) { _toRoots = typeof fn === 'function' ? fn : null; }

export function initViews() {
  onColumnOpen(() => _room());
  // "Library" always lands on the shelf: the captions let go of, then the chat under them left - and on the shelf's
  // ROOTS, from the shelf itself too. A folded column's press is the column's (it opens it).
  const title = $('mv3-lib-title');
  if (title) {
    title.addEventListener('click', (e) => {
      if (!_libraryOpen()) return;
      e.stopPropagation();
      if (_caps && _capsBack) _capsBack();
      const c = _chats.get(_base);
      if (c && c.onBack) c.onBack();
      if (_toRoots) _toRoots();
    });
  }
  const cap = $('mv3-lib-cap');
  if (cap) cap.addEventListener('click', (e) => { e.stopPropagation(); if (top() !== 'captions' && _capsOpen) _capsOpen(); });
  _paint();
}
