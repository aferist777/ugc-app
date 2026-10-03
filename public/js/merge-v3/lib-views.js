/* ═══════════════════════════════════════════════════════════════════════════
   MERGE v3 — the Library panel's views, ONE owner (phase K6b, 2026-10-03).

   The panel shows the shelf, the pictures chat (phase J), or the captions view (phase K6: preset tiles
   beside the settings of the captions picked on the timeline). Two kinds of state, kept apart:
     the BASE      shelf or chat - remembered per project by the chat (picchat.js), told here;
     the OVERLAY   captions - it belongs to what is PICKED (inspector.js says when), never remembered:
                   the pick does not survive a reload, and letting go of it puts the base back.
   What shows is the overlay over the base. This module alone writes what follows from that: the panel's
   class (is-chat / is-captions), the header ("Library" a link back, "/ generate image", "/ captions"),
   and THE ROOM - the corner of the sashes as far left and down as it goes while the chat or the captions
   view can be SEEN, the arrangement there was before put back when neither is (layout.js panelRoom).
   There used to be two owners of the room, and leaving the chat while captions showed would have put the
   corner back under it.
   ═══════════════════════════════════════════════════════════════════════════ */

import { panelRoom, onColumnOpen } from './layout.js';

const $ = (id) => document.getElementById(id);

let _base = 'shelf';         // 'shelf' | 'chat'
let _talk = false;           // the project has a conversation: the pale "/ generate image" on the shelf
let _caps = false;           // the captions view is up
let _held = false;           // the room is taken
let _frame = 0;
const _back = { chat: null, captions: null };    // what "Library" does in each view
const _crumb = { chat: null };                    // what the pale crumb opens

/** What shows: 'captions', 'chat' or 'shelf'. */
export const top = () => (_caps ? 'captions' : _base);
export const isCaptions = () => _caps;

/** The chat says what the base is, and whether the project has a conversation to come back to. */
export function setBase(view, talk) {
  _base = view === 'chat' ? 'chat' : 'shelf';
  if (talk !== undefined) _talk = !!talk;
  _paint();
}

/** The inspector says whether the captions view is up. */
export function setCaptions(on) {
  if (_caps === !!on) return;
  _caps = !!on;
  _paint();
}

/** The captions view let go of (the pick released) - when the panel is asked to show the shelf or the chat. */
export function toBase() { if (_caps && _back.captions) _back.captions(); }

/** What "Library" in the header does, per view; what the pale crumb opens. */
export function onBack(view, fn) { if (view in _back) _back[view] = fn; }
export function onCrumb(fn) { _crumb.chat = fn; }

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
    const want = top() !== 'shelf' && _libraryOpen();
    if (want === _held) return;
    _held = want;
    panelRoom(want);
  });
}

/** A project opened, or the page came back: a room left taken by an earlier visit is given back. */
export function sync() {
  if (top() === 'shelf' && !_held) panelRoom(false);
  _room();
}

function _paint() {
  const t = top();
  const panel = $('mv3-library');
  if (panel) {
    panel.classList.toggle('is-chat', t === 'chat');
    panel.classList.toggle('is-captions', t === 'captions');
  }
  const title = $('mv3-lib-title');
  if (title) {
    title.classList.toggle('is-link', t !== 'shelf');
    title.title = t === 'captions' ? 'Let go of the captions - back to the Library'
      : t === 'chat' ? 'Back to the Library' : '';
  }
  const gen = $('mv3-lib-gen');
  if (gen) {
    gen.hidden = !(t === 'chat' || (t === 'shelf' && _talk));
    gen.classList.toggle('is-on', t === 'chat');
    gen.title = t === 'chat' ? '' : 'Back to the conversation about pictures';
  }
  const cap = $('mv3-lib-cap');
  if (cap) {
    cap.hidden = t !== 'captions';
    cap.classList.toggle('is-on', t === 'captions');
  }
  const head = $('mv3-pc-head');
  if (head) head.hidden = t !== 'chat';
  _room();
}

export function initViews() {
  onColumnOpen(() => _room());
  const title = $('mv3-lib-title');
  if (title) {
    title.addEventListener('click', (e) => {
      const fn = _back[top()];
      if (!fn) return;
      e.stopPropagation();
      fn();
    });
  }
  const gen = $('mv3-lib-gen');
  if (gen) gen.addEventListener('click', (e) => { e.stopPropagation(); if (top() === 'shelf' && _crumb.chat) _crumb.chat(); });
  _paint();
}
