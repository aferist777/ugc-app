/* ═══════════════════════════════════════════════════════════════════════════
   MERGE v3 — a heard caption's WORDS, one by one (phase K10b, 2026-10-03).

   Under the line's text in the strip, its words as chips: the word and, small, where it starts. A chip
   pressed is PICKED and the preview goes to its start - exactly there, the sound too (preview-b seek
   `exact`); nothing plays by itself (the owner's answer 4): Space plays, and a preview already playing goes
   on playing, from that word. The picked word has a row of its own: the word in a field, and
     A  make it stand out (`k`) - a look, not a correction          K
     ✂  cut it in two at the playhead                               S
     ⇥  join it with the next word                                  M
     ✕  take it out (its time becomes a pause)                      Delete
     +  put a word after it                                         Insert
   and its time on the timeline. The words list keeps its own keys while it has the focus (by the key's
   PLACE, e.code, so the Russian layout works): ← → the word before or after, Enter or F2 edit it, [ and ]
   move its start a hundredth of a second (with Shift its end - a series of presses is ONE undo step),
   Escape lets go of the word and a second Escape of the line. In the field: Enter keeps, Escape takes it
   back, Tab keeps and goes on to the next word - from the last one, to the next line.

   Every change is ONE Store.mutate through timeline-b `editWords`, decided by words.js before anything
   changes; a refusal is said in words under the row. The strip is rebuilt whole on every store change, so
   what this block is in the middle of - the picked word, the field and its text, the focus - lives here, by
   the caption's id, and is put back on every paint; after an undo the picked word is found by its start.

   The list is ONE focusable element with plain chips inside (no buttons: a focused button presses itself on
   Enter and Space), marked `data-own-keys` - the timeline's Delete leaves it alone (timeline-b.js).
   ═══════════════════════════════════════════════════════════════════════════ */

import * as Layers from '../layers.js';
import { editWords, playhead, onPlayhead, selectClipById, revealSelection, nextCaption } from './timeline-b.js';
import { seek } from './preview-b.js';
import { replaceAt, insertAt, removeAt, joinAt, cutAt, markAt, edgeAt, LIMITS } from '../captions/words.js';
import { timedWords } from '../captions/pages.js';
import { note } from './ask.js';

const S = {
  clip: null, track: null,   // the caption whose words are shown
  start: 0, dur: 0,          // its place, as painted
  words: [],                 // its words, as painted (timedWords)
  sel: null,                 // the picked word's index
  at: null,                  // its start - finds it again after an undo moved the words
  edit: null,                // the field: { mode: 'edit'|'insert', i, w, s, value, a, b } (a, b the selection)
  focusClip: null,           // the list (or the field) had the focus when the strip was rebuilt, for this caption
  want: null,                // { clip, edit } - open this caption on its first word (Tab from the line before)
  listFor: null,             // a caption whose words are not painted yet but will be: its list takes the focus then
  msg: null,                 // { clip, text } - a refusal, said under the row
};
let _box = null, _list = null, _painting = false, _wired = false;

const _el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const _fmt = (t) => { const v = Math.max(0, +t || 0), m = Math.floor(v / 60), s = v - m * 60; return m + ':' + (s < 10 ? '0' : '') + s.toFixed(2); };

// ── The strip's side ────────────────────────────────────────────────────────
/** Before the strip is emptied: remember whether the words had the focus, so the paint can give it back. */
export function beforeRepaint() {
  _painting = true;
  const a = document.activeElement;
  S.focusClip = (_box && a && _box.contains(a)) ? S.clip : null;
  // The field's text and caret - only into the edit that field belongs to: a commit that moved on to the next
  // word has opened a new one, which the old field must not overwrite.
  if (S.edit && _box) {
    const f = _box.querySelector('.mv3-wd-in');
    if (f && a === f && f.__edit === S.edit) { S.edit.value = f.value; S.edit.a = f.selectionStart; S.edit.b = f.selectionEnd; }
  }
}
/** After it is painted again. */
export function afterRepaint() { _painting = false; }

/**
 * The selection is about to change (inspector, onSelChange): the open field is written into ITS line first -
 * the ids it was opened with, whatever is picked now.
 */
export function leave() {
  S.listFor = null;
  if (S.edit) {
    const e = S.edit;
    const typed = String(e.value == null ? '' : e.value);
    // Refused, it cannot stay on screen: the pick is moving to another line, whose strip replaces this one. So it
    // is said in a note that stays until it is read, with what was typed to put in again (review K10) - opened
    // once the new pick is painted, over it on the timeline, and not closed by the scrolling that brings it in.
    if (!_commit('none')) {
      const why = (S.msg && S.msg.text) || 'That cannot be done';
      const head = e.mode === 'insert' ? 'The word after «' + e.w + '» was not put in.' : 'The correction of «' + e.w + '» was not applied.';
      const sub = why + (typed.trim() ? ' - you typed: «' + typed + '»' : '');
      S.edit = null;
      _say('');
      setTimeout(() => {
        const at = document.querySelector('.mv3b-clip.is-sel') || document.getElementById('mv3-over') || document.body;
        note(at, head, sub, { stay: true });
      }, 0);
    }
  }
  S.focusClip = null;
}

/**
 * The focus onto this caption's words (Enter in its text) - kept through the paint the text's change makes.
 * True when the words of that caption are on screen and took it; false when they are not (a line whose words
 * no longer spell its text has no words shown) - the caller keeps the focus somewhere then (review K10).
 */
export function focusList(clipId, later) {
  if (S.clip === clipId && _list && _list.isConnected) {
    S.focusClip = clipId;
    _list.focus({ preventScroll: true });
    return document.activeElement === _list;
  }
  // `later`: the text was just changed, so the line is about to be timed and painted with its words - they take it.
  if (later) { S.listFor = clipId; return true; }
  return false;
}

/** Was this caption asked to open with the focus in its text (Tab from the line before, onto a typed one)? */
export function wantsText(clipId) {
  if (!S.want || S.want.clip !== clipId) return false;
  S.want = null;
  return true;
}

// ── Painting ────────────────────────────────────────────────────────────────
/** The words of one heard caption, into the strip. */
export function paint(host, track, clip, opts) {
  _wire();
  if (S.clip !== clip.id) { S.clip = clip.id; S.sel = null; S.at = null; S.edit = null; S.msg = null; }
  S.track = track.id;
  S.start = +clip.start || 0;
  S.dur = +clip.dur || 0;
  const words = timedWords(clip);
  S.words = words;
  let focus = S.focusClip === clip.id ? (S.edit ? 'field' : 'list') : null;
  if (S.listFor === clip.id) focus = 'list';
  S.listFor = null;
  if (S.want && S.want.clip === clip.id) {
    // Arrived by Tab from the line before: its first word, the field open.
    S.sel = words.length ? 0 : null;
    S.at = null;
    S.edit = S.sel != null ? _openState('edit', 0) : null;
    focus = S.edit ? 'field' : 'list';
    S.want = null;
  }
  _find();
  if (focus === 'field' && !S.edit) focus = 'list';

  const box = _el('div', 'mv3-wd');
  box.dataset.ownKeys = '1';
  // A word that stands out is shown in the colour it wears in the picture.
  if (opts && opts.mark) box.style.setProperty('--mark', opts.mark);
  const list = _el('div', 'mv3-wd-list');
  list.tabIndex = 0;
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', 'The words of this line');
  words.forEach((w, i) => {
    const chip = _el('span', 'mv3-wd-chip');
    chip.id = 'mv3-wd-' + i;
    chip.dataset.i = String(i);
    chip.setAttribute('role', 'option');
    if (w.k) chip.classList.add('is-k');
    if (w.h) chip.classList.add('is-h');
    if ((+w.s || 0) >= S.dur - 1e-6) chip.classList.add('is-after');
    chip.appendChild(_el('span', 'mv3-wd-w', String(w.w)));
    chip.appendChild(_el('span', 'mv3-wd-t', (+w.s || 0).toFixed(2)));
    chip.title = String(w.w) + ' · ' + _fmt(S.start + (+w.s || 0)) + (w.h ? ' · corrected' : '') + (w.k ? ' · stands out' : '')
      + ((+w.s || 0) >= S.dur - 1e-6 ? " · after the line's end - never lit" : '');
    // The pick is made on the press, so a double click lands on the same chip and opens it.
    chip.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const at = +w.s || 0;
      // An open field is written first - which repaints the strip: the word is found again by its start.
      // A refused one keeps the field, its words said under it, and nothing else happens: picking another word
      // would throw the correction away without a word (review K10).
      if (S.edit && !_commit('none')) { _focusField(); return; }
      if (_list) _list.focus({ preventScroll: true });
      let j = i;
      if (S.words[j] !== w) {
        j = 0;
        S.words.forEach((x, k) => { if (Math.abs((+x.s || 0) - at) < Math.abs((+S.words[j].s || 0) - at)) j = k; });
      }
      _pick(j);
    });
    chip.addEventListener('dblclick', () => _open('edit'));
    list.appendChild(chip);
  });
  box.appendChild(list);
  const rowHost = _el('div', 'mv3-wd-pick');
  box.appendChild(rowHost);
  const msg = _el('div', 'mv3-wd-msg');
  box.appendChild(msg);
  box.appendChild(_el('div', 'mv3-wd-help', 'Click a word to put the playhead on it. ← → move · Enter edits · Delete '
    + 'takes it out · K stands out · S cuts at the playhead · M joins · Insert adds after · [ ] move its start (Shift: its end)'));
  box.addEventListener('keydown', _keys);
  host.appendChild(box);
  _box = box;
  _list = list;
  _paintPick();
  _say(S.msg && S.msg.clip === clip.id ? S.msg.text : '');
  _lit(playhead());
  if (focus === 'list') list.focus({ preventScroll: true });
  else if (focus === 'field') _focusField();
  S.focusClip = null;
}

// The picked word again, after the words changed under it: the same index while it still starts where it
// did, else the word that starts nearest that moment.
function _find() {
  const ws = S.words;
  if (S.sel == null || !ws.length) { S.sel = null; S.at = null; return; }
  if (S.sel >= ws.length) S.sel = ws.length - 1;
  if (S.at != null && Math.abs((+ws[S.sel].s || 0) - S.at) > 0.005) {
    let best = 0;
    ws.forEach((w, i) => { if (Math.abs((+w.s || 0) - S.at) < Math.abs((+ws[best].s || 0) - S.at)) best = i; });
    S.sel = best;
  }
  S.at = +ws[S.sel].s || 0;
  if (S.edit && S.edit.mode === 'edit' && (S.edit.i !== S.sel || ws[S.sel].w !== S.edit.w)) S.edit = null;
}

function _paintPick() {
  if (!_box) return;
  const host = _box.querySelector('.mv3-wd-pick');
  host.textContent = '';
  _list.querySelectorAll('.mv3-wd-chip').forEach((c) => c.classList.toggle('is-sel', +c.dataset.i === S.sel));
  if (S.sel == null) { _list.removeAttribute('aria-activedescendant'); return; }
  _list.setAttribute('aria-activedescendant', 'mv3-wd-' + S.sel);
  const chip = _list.querySelector('#mv3-wd-' + S.sel);
  if (chip && chip.scrollIntoView) chip.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  const w = S.words[S.sel];
  const n = S.words.length;
  const row = _el('div', 'mv3-wd-row');
  const f = _el('input', 'mv3-wd-in u-in is-s');
  f.type = 'text';
  f.maxLength = LIMITS.word;
  f.spellcheck = false;
  const ins = S.edit && S.edit.mode === 'insert';
  f.value = S.edit ? S.edit.value : String(w.w);
  // What the field was painted with: a field that still holds it has nothing of the person's (store.js setTyping).
  f.__painted = S.edit ? (S.edit.mode === 'edit' ? S.edit.w : '') : String(w.w);
  f.placeholder = ins ? 'a word after «' + String(w.w) + '»' : '';
  if (ins) f.classList.add('is-insert');
  // The field belongs to ONE edit (f.__edit): opened by focusing it, written by its typing, kept on its blur.
  f.__edit = S.edit;
  f.addEventListener('focus', () => { if (!S.edit) S.edit = _openState('edit', S.sel); f.__edit = S.edit; });
  f.addEventListener('input', () => { if (S.edit && f.__edit === S.edit) S.edit.value = f.value; });
  f.addEventListener('keydown', _fieldKeys);
  // Kept when the focus leaves it - but not when only the WINDOW does (Alt+Tab): the field still has the focus
  // inside the page, and taking it away there left nothing focused, where Delete takes the whole line.
  f.addEventListener('blur', () => { if (!_painting && S.edit && f.__edit === S.edit && document.activeElement !== f) _commit('none'); });
  row.appendChild(f);
  const btn = (label, title, fn, off, cls) => {
    const b = _el('button', 'mv3-wd-btn u-btn is-s is-icon' + (cls ? ' ' + cls : ''), label);
    b.type = 'button';
    b.title = title;
    b.tabIndex = -1;
    b.disabled = !!off;
    // The focus stays on the list: a pressed button that kept it would play the preview on Space AND press
    // itself again.
    b.addEventListener('pointerdown', (e) => e.preventDefault());
    // An open field is kept first, back onto the list (a refused one stops here, its words said); the list keeps
    // the focus after the operation too - a focus left on nothing makes the next Delete the TIMELINE's, and it
    // takes the whole line (review K10).
    b.addEventListener('click', () => { if (S.edit && !_commit('list')) return; fn(); if (!S.edit) _keepFocus(); });
    row.appendChild(b);
    return b;
  };
  btn('A', w.k ? 'Stands out - press to make it an ordinary word (K)' : 'Make this word stand out, for the whole page (K)', _mark, false, w.k ? 'is-on' : '');
  btn('✂', 'Cut it in two at the playhead (S) - or type a space in it where it splits', _cut);
  btn('⇥', 'Join it with the next word (M)', _join, S.sel >= n - 1);
  btn('✕', n > 1 ? 'Take this word out - its time becomes a pause (Delete)' : ONLY, _remove, n <= 1);
  btn('+', 'Put a word after it (Insert)', () => _open('insert'));
  _box.querySelector('.mv3-wd-pick').appendChild(row);
  const s = S.start + (+w.s || 0), e = S.start + (+w.e || 0);
  const time = _el('div', 'mv3-wd-time', _fmt(s) + ' → ' + _fmt(e) + ' · ' + Math.max(0, (+w.e || 0) - (+w.s || 0)).toFixed(2) + ' s'
    + ((+w.s || 0) >= S.dur - 1e-6 ? " · after the line's end - never lit" : ''));
  host.appendChild(time);
}

function _say(text) {
  S.msg = text ? { clip: S.clip, text } : null;
  const m = _box && _box.querySelector('.mv3-wd-msg');
  if (m) { m.textContent = text || ''; m.hidden = !text; }
}

// The word being spoken at the playhead, lit while the preview plays (onPlayhead: every frame).
function _lit(t) {
  if (!_list || !_list.isConnected) return;
  const rel = (+t || 0) - S.start;
  let now = -1;
  S.words.forEach((w, i) => { if (rel >= (+w.s || 0) - 1e-6 && rel < (+w.e || 0) - 1e-6) now = i; });
  _list.querySelectorAll('.mv3-wd-chip').forEach((c) => c.classList.toggle('is-now', +c.dataset.i === now));
}

function _wire() {
  if (_wired) return;
  _wired = true;
  onPlayhead(_lit);
}

// ── Picking ─────────────────────────────────────────────────────────────────
function _pick(i) {
  if (i == null || i < 0 || i >= S.words.length) return;
  S.sel = i;
  S.at = +S.words[i].s || 0;
  S.edit = null;
  _say('');
  _paintPick();
  // The preview goes to the word - exactly, the sound too; a preview that plays goes on playing from it.
  seek(S.start + S.at, { exact: true });
}

function _unpick() {
  S.sel = null; S.at = null; S.edit = null;
  _say('');
  _paintPick();
}

function _move(d) {
  if (!S.words.length) return;
  _pick(S.sel == null ? (d > 0 ? 0 : S.words.length - 1) : Math.max(0, Math.min(S.words.length - 1, S.sel + d)));
}

// ── The field ───────────────────────────────────────────────────────────────
function _openState(mode, i) {
  const w = S.words[i];
  return { mode, i, w: w ? String(w.w) : '', s: w ? +w.s || 0 : 0, value: mode === 'edit' && w ? String(w.w) : '', a: null, b: null };
}

function _open(mode) {
  if (S.sel == null) return;
  S.edit = _openState(mode, S.sel);
  _say('');
  _paintPick();
  _focusField(true);
}

function _focusField(all) {
  const f = _box && _box.querySelector('.mv3-wd-in');
  if (!f) return;
  f.focus({ preventScroll: true });
  if (all || S.edit == null || S.edit.a == null) f.select();
  else f.setSelectionRange(S.edit.a, S.edit.b);
}

// The field kept: `then` - 'none' (where it was: the focus has gone elsewhere), 'list' (back to the words),
// 'next' / 'prev' (on to that word, the field open - from the last word, on to the next line). The operations
// are pure, so where the pick and the field land is worked out BEFORE the change: the change repaints the
// strip at once, inside the mutation.
const ONLY = "The line's only word - «Remove this line» below takes the line";
const _sameWords = (a, b) => a.length === b.length && a.every((x, i) => {
  const y = b[i];
  return String(x.w) === String(y.w) && Math.abs((+x.s || 0) - (+y.s || 0)) < 0.005 && Math.abs((+x.e || 0) - (+y.e || 0)) < 0.005
    && !!x.k === !!y.k && !!x.h === !!y.h;
});
function _commit(then) {
  const e = S.edit;
  if (!e) return true;
  const v = String(e.value == null ? '' : e.value);
  const n = S.words.length;
  let op = null;
  if (e.mode === 'edit') {
    if (v.trim() === e.w) op = null;
    else if (!v.trim()) {
      if (n <= 1) { _say(ONLY); return false; }
      op = (ws) => removeAt(ws, e.i);
    } else op = (ws) => replaceAt(ws, e.i, v, S.dur);
  } else if (v.trim()) op = (ws) => insertAt(ws, e.i + 1, v, S.dur);
  let W = S.words;
  if (op) {
    const r = op(S.words);
    if (!r || r.why) { _say((r && r.why) || 'That cannot be done'); return false; }
    W = r.words || [];
    // An edit that gives the same words back (two spaces where one was) is no change: the store would make none
    // and paint nothing, and the field would stay focused belonging to no edit - typing and Enter did nothing
    // (review K10). It goes the way of an unchanged field.
    if (_sameWords(W, S.words)) op = null;
  }
  // The words the field made begin at `first`; `made` of them (a word with a space is two, marks alone none).
  const first = e.mode === 'edit' ? e.i : e.i + 1;
  const made = (e.mode === 'edit' ? 1 : 0) + (W.length - n);
  let to = made > 0 ? first : Math.min(e.i, W.length - 1);
  let open = false, jump = null;
  if (then === 'next' || then === 'prev') {
    let t = then === 'next' ? first + made : first - 1;
    if (then === 'next' && t >= W.length) jump = nextCaption(S.clip);
    if (!jump) { to = Math.max(0, Math.min(W.length - 1, t)); open = true; }
  }
  const was = { sel: S.sel, at: S.at, focus: S.focusClip };
  S.sel = W.length ? to : null;
  S.at = null;
  S.edit = open && W[to] ? { mode: 'edit', i: to, w: String(W[to].w), s: +W[to].s || 0, value: String(W[to].w), a: null, b: null } : null;
  S.focusClip = (open || then === 'list') ? S.clip : null;
  if (op && !_apply(op, e.i)) {
    // Refused (the line changed meanwhile, or this project cannot be edited): the field as it was.
    S.sel = was.sel; S.at = was.at; S.edit = e; S.focusClip = was.focus;
    _paintPick();
    _focusField();
    return false;
  }
  if (!op) {
    _paintPick();
    if (open) _focusField(true);
    else if (then === 'list' && _list) _list.focus({ preventScroll: true });
  }
  if (jump) {
    S.want = { clip: jump.clip.id, edit: true };
    selectClipById(jump.clip.id);
    revealSelection();
    const ws = timedWords(jump.clip);
    seek((+jump.clip.start || 0) + (ws.length ? +ws[0].s || 0 : 0), { exact: true });
  } else if (open && S.sel != null && S.words[S.sel]) {
    seek(S.start + (+S.words[S.sel].s || 0), { exact: true });
  }
  return true;
}

function _fieldKeys(e) {
  if (Layers.blocked()) return;
  if (e.key === 'Enter') {
    e.preventDefault(); e.stopPropagation();
    _commit('list');
  } else if (e.key === 'Escape') {
    e.preventDefault(); e.stopPropagation();
    S.edit = null;
    _say('');
    _paintPick();
    if (_list) _list.focus({ preventScroll: true });
  } else if (e.key === 'Tab') {
    e.preventDefault(); e.stopPropagation();
    _commit(e.shiftKey ? 'prev' : 'next');
  }
}

// ── The operations ──────────────────────────────────────────────────────────
// One change through timeline-b editWords: word `i` must still be the one shown (a lay or a save may have
// moved the words meanwhile), and words.js decides. False when refused - said under the row.
function _apply(op, i, opts) {
  const shown = S.words[i] || null;
  const r = editWords(S.track, S.clip, (ws, c) => {
    if (shown && (!ws[i] || ws[i].w !== shown.w || Math.abs((+ws[i].s || 0) - (+shown.s || 0)) > 0.005)) {
      return { why: 'The line has changed meanwhile - pick the word again' };
    }
    return op(ws, c);
  }, opts);
  if (r && r.why) { _say(r.why); return false; }
  return true;
}

// An operation from the list or the row: the pick goes to `after` and the focus back to the list.
function _run(op, after, opts) {
  const was = { sel: S.sel, at: S.at };
  const i = S.sel;
  _say('');
  S.sel = after;
  S.at = null;
  if (_apply(op, i, opts)) { _keepFocus(); return true; }
  S.sel = was.sel; S.at = was.at;
  _paintPick();
  _keepFocus();
  return false;
}

// The focus on the words list - the one painted now (an operation repaints the strip inside the mutation).
function _keepFocus() {
  if (_list && _list.isConnected && document.activeElement !== _list) _list.focus({ preventScroll: true });
}

function _mark() {
  if (S.sel == null) return;
  const i = S.sel;
  _run((ws) => markAt(ws, i, !ws[i].k), i);
}

function _cut() {
  if (S.sel == null) return;
  const i = S.sel, at = playhead() - S.start;
  _run((ws) => cutAt(ws, i, at), i + 1);
}

function _join() {
  if (S.sel == null) return;
  const i = S.sel;
  _run((ws) => joinAt(ws, i), i);
}

function _remove() {
  if (S.sel == null) return;
  const n = S.words.length;
  if (n <= 1) { _say(ONLY); return; }
  const i = S.sel;
  _run((ws) => removeAt(ws, i), i < n - 1 ? i : i - 1);
}

// [ and ]: an edge a hundredth of a second; a series is one undo step (history.js), and the preview stays on
// the word's start, to be heard from there.
function _nudge(d, side) {
  if (S.sel == null) return;
  const i = S.sel;
  const ok = _run((ws) => edgeAt(ws, i, side, (+ws[i][side] || 0) + d * 0.01, S.dur), i,
    { merge: 'nudge:' + S.clip + ':' + i + ':' + side });
  if (ok && S.words[i]) seek(S.start + (+S.words[i].s || 0), { exact: true });
}

// The key's place when an event comes without one (some synthetic events, some remote keyboards): the
// character, in either layout.
const CODE_OF = {
  '[': 'BracketLeft', '{': 'BracketLeft', 'х': 'BracketLeft', 'Х': 'BracketLeft',
  ']': 'BracketRight', '}': 'BracketRight', 'ъ': 'BracketRight', 'Ъ': 'BracketRight',
  k: 'KeyK', K: 'KeyK', 'л': 'KeyK', 'Л': 'KeyK', s: 'KeyS', S: 'KeyS', 'ы': 'KeyS', 'Ы': 'KeyS',
  m: 'KeyM', M: 'KeyM', 'ь': 'KeyM', 'Ь': 'KeyM', ' ': 'Space', '+': 'NumpadAdd',
};

function _keys(e) {
  if (e.target && e.target.tagName === 'INPUT') return;         // the field has its own keys
  if (Layers.blocked()) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;               // Ctrl+Z is the timeline's undo
  const c = e.code || CODE_OF[e.key] || '';
  let done = true;
  if (c === 'ArrowLeft' || c === 'ArrowUp') _move(-1);
  else if (c === 'ArrowRight' || c === 'ArrowDown') _move(1);
  else if (c === 'Home') _pick(0);
  else if (c === 'End') _pick(S.words.length - 1);
  else if (e.key === 'Enter' || c === 'F2') _open('edit');
  else if (c === 'Delete' || c === 'Backspace' || e.key === 'Delete') _remove();
  else if (c === 'KeyK') _mark();
  else if (c === 'KeyS') _cut();
  else if (c === 'KeyM') _join();
  else if (e.key === 'Insert' || c === 'Insert' || c === 'NumpadAdd' || (c === 'Equal' && e.shiftKey)) _open('insert');
  else if (c === 'BracketLeft' || c === 'BracketRight') _nudge(c === 'BracketLeft' ? -1 : 1, e.shiftKey ? 'e' : 's');
  else if (c === 'Escape') { if (S.sel != null) _unpick(); else done = false; }
  // Space plays the preview (its own handler, further up) - the list only keeps it from scrolling the strip.
  else if (c === 'Space') { e.preventDefault(); return; }
  else done = false;
  if (done) { e.preventDefault(); e.stopPropagation(); }
}
