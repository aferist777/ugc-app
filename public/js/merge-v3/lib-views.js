/* ═══════════════════════════════════════════════════════════════════════════
   MERGE v3 — the Library panel's views, ONE owner (phase K6b, 2026-10-03; several chats since V1).

   The panel shows the shelf, a CHAT (the pictures chat of phase J - and, from phase V3, the video chat:
   each is chat-shell.js with its own description), or the captions view (phase K6: preset tiles beside the
   settings of the captions picked on the timeline). Two kinds of state, kept apart:
     the BASE      the shelf or one chat - remembered per project HERE (viewOf / rememberView), told by
                   the chats; a chat takes or lets go of only ITS OWN base, so two chats never reset each
                   other on a project switch;
     the OVERLAY   captions - it belongs to what is PICKED (inspector.js says when), never remembered:
                   the pick does not survive a reload, and letting go of it puts the base back.
   What shows is the overlay over the base. This module alone writes what follows from that: the panel's
   class (is-chat / is-captions) and which chat's box and buttons show (is-shown), the header - the CRUMBS
   "Library / generate image / generate video / captions", always there, the one showing lit, any other one press
   away (phase V18.2, the owner 2026-10-08) - and THE ROOM - the corner of the sashes as far left and down
   as it goes while a chat or the captions view can be SEEN, the arrangement there was before put back when
   neither is (layout.js panelRoom). There used to be two owners of the room, and leaving the chat while
   captions showed would have put the corner back under it.
   ═══════════════════════════════════════════════════════════════════════════ */

import { panelRoom, onColumnOpen } from './layout.js';

const $ = (id) => document.getElementById(id);

// Which view each project was left on: { projectKey: 'pictures' | 'videos' }. It was the pictures chat's own
// ('mv3_pc_view_v1', { key: 'chat' }) until V1; read once into this one and dropped.
const LS_VIEW = 'mv3_lib_view_v1';
const LS_VIEW_OLD = 'mv3_pc_view_v1';

let _base = 'shelf';         // 'shelf' or the name of a chat
let _caps = false;           // the captions view is up
let _held = false;           // the room is taken
let _frame = 0;
let _capsBack = null;        // what letting go of the captions does (the pick released)
let _capsOpen = null;        // what the "captions" crumb does from another view (the subtitle lane picked)
// The chats, by name: { root, head, headL, crumb } element ids (headL: buttons right beside the crumb - the video
// chat's catalog, phase V6), onBack (leave it for the shelf), onYield (another chat took the base), onCrumb (its crumb
// pressed from another view).
const _chats = new Map();

/** What shows: 'captions', the name of a chat, or 'shelf'. */
export const top = () => (_caps ? 'captions' : _base);
export const isCaptions = () => _caps;
/** A chat is the base (whether or not the captions are over it) - the shelf's own drop stands down. */
export const isChat = () => _base !== 'shelf';

/** A chat says who it is, where its box, buttons and crumb are, and what pressing back and the crumb do. */
export function registerChat(name, o) {
  const c = Object.assign({ root: '', head: '', headL: '', crumb: '', crumbTitle: '', onBack: null, onYield: null, onCrumb: null }, o || {});
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

/** The inspector says whether the captions view is up. */
export function setCaptions(on) {
  if (_caps === !!on) return;
  _caps = !!on;
  _paint();
}

/** What letting go of the captions does ("Library" or a chat's crumb pressed over them). */
export function onBack(view, fn) { if (view === 'captions') _capsBack = fn; }
/** What the "captions" crumb does from another view (phase V18.2: the inspector picks the subtitle lane). */
export function onOpen(view, fn) { if (view === 'captions') _capsOpen = fn; }

// ── The view each project was left on ──────────────────────────────────────
function _views() {
  let v = {};
  try { v = JSON.parse(localStorage.getItem(LS_VIEW) || '') || {}; } catch (e) { v = {}; }
  let old = null;
  try { old = JSON.parse(localStorage.getItem(LS_VIEW_OLD) || 'null'); } catch (e) { old = null; }
  if (old && typeof old === 'object') {
    for (const k of Object.keys(old)) if (old[k] === 'chat' && !(k in v)) v[k] = 'pictures';
    try { localStorage.setItem(LS_VIEW, JSON.stringify(v)); localStorage.removeItem(LS_VIEW_OLD); } catch (e) { /* a private window */ }
  }
  return v;
}

/** The chat a project was left on ('' for the shelf). */
export const viewOf = (key) => String(_views()[key || ''] || '');

/** A chat came forward (`name`) or was left (`null`) on this project - only its own mark is taken away. */
export function rememberView(key, name, was) {
  const v = _views();
  const k = key || '';
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
  }
  const title = $('mv3-lib-title');
  if (title) {
    title.classList.toggle('is-link', t !== 'shelf');
    title.title = t === 'shelf' ? '' : 'Back to the Library';
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
    const head = $(c.head);
    if (head) head.hidden = !on;
    const headL = c.headL ? $(c.headL) : null;
    if (headL) headL.hidden = !on;
  }
  const cap = $('mv3-lib-cap');
  if (cap) {
    cap.classList.toggle('is-on', t === 'captions');
    cap.title = t === 'captions' ? '' : 'The subtitle lane - its look and the caption presets';
  }
  _room();
}

export function initViews() {
  onColumnOpen(() => _room());
  // "Library" always lands on the shelf: the captions let go of, then the chat under them left.
  const title = $('mv3-lib-title');
  if (title) {
    title.addEventListener('click', (e) => {
      if (top() === 'shelf') return;
      e.stopPropagation();
      if (_caps && _capsBack) _capsBack();
      const c = _chats.get(_base);
      if (c && c.onBack) c.onBack();
    });
  }
  const cap = $('mv3-lib-cap');
  if (cap) cap.addEventListener('click', (e) => { e.stopPropagation(); if (top() !== 'captions' && _capsOpen) _capsOpen(); });
  _paint();
}
