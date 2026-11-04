/* ═══════════════════════════════════════════════════════════════════════════
   MERGE v3 — the captions view's `text` tab: the lanes of words as ONE DOCUMENT (phase V30, block 2, the owner
   2026-10-15).

   In place of the preset tiles (the `presets` tab), the lines of the subtitle lane and, under it, of each text lane -
   a line of the document is a caption, in time order, its start pale on the left and a dot where a person corrected
   it. The settings strip on the right stays what it is. What the document does is captions/doc.js (pure); here is only
   the page:
     - a press on a line puts the playhead on its start and picks it on the timeline - the document stays whole and
       lights the lines picked (the owner's (с25));
     - typing in a line is written when the line is left - a press elsewhere, the arrows past its edge, Tab, Escape -
       as ONE step to undo (the owner's (с27)); a heard line keeps its timing (retext). Enter cuts the line between its
       words, Delete at its end joins it with the next one, Backspace at its start with the one before - at once. A
       word carried across the end of a line goes with its time. Typed lines are cut by their letters, and a typed
       line joined to a heard one becomes part of it (с26). Text lanes are cut and joined only within themselves (с28);
     - a talking head's lines of the script never join - refused, and said under the document;
     - find and replace above it: the count, every match lit, Enter the next, Shift+Enter the one before; `replace`,
       `replace all` (ONE step to undo); `Aa` the case, `W` whole words (с30). Over the subtitles and the text lanes.
   The keys are the document's own (`data-own-keys`: the timeline's Delete never reaches them); a window on top owns
   the keyboard (Layers.blocked). Ctrl+Z in a line being typed is the field's own; in a line not touched, or on the
   document, it is the project's undo - the pick waits on the lane meanwhile, so a line it took back does not close the
   view (the view follows the pick), and comes back on the line the cursor was in.

   While a line holds typing not written yet, nothing is painted over it: the store holds a newer copy back
   (Store.setTyping - the inspector's, which counts this view's fields too), and a line that changed meanwhile is not
   written over - said under the document with what was typed.
   ═══════════════════════════════════════════════════════════════════════════ */

import * as Store from './store.js';
import * as History from './history.js';
import * as Layers from '../layers.js';
import { rewriteLines, rewriteEach, selectClipById, selectTrackById, selectedIds, selectedTrack, onSelChange } from './timeline-b.js';
import { seek } from './preview-b.js';
import { note } from './ask.js';
import { linesOf, textOfLine, isWordsLane, editLine, splitLine, joinLines, rewrite, matcher, matchesIn, replaceIn } from '../captions/doc.js';
import { isHeard } from '../captions/heard.js';
import { isCorrected } from '../captions/words.js';

const _el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
// 0:12.4 - minutes and seconds to a tenth.
const _fmt = (t) => { const v = Math.round(Math.max(0, +t || 0) * 10) / 10; const m = Math.floor(v / 60); const s = v - m * 60; return m + ':' + (s < 10 ? '0' : '') + s.toFixed(1); };
const _fmt2 = (t) => { const v = Math.max(0, +t || 0); const m = Math.floor(v / 60); const s = v - m * 60; return m + ':' + (s < 10 ? '0' : '') + s.toFixed(2); };
const _esc = (s) => String(s).replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));

let _ui = null;
let _shown = false;
let _wired = false;
let _key = null;                  // the project the rows are of
const _rows = new Map();          // caption id -> { el, ta, bd, t, c, trackId, heard }
const _secs = new Map();          // lane id -> { el, head, list }
let _order = [];                  // caption ids, in the document's order (lanes after one another)
let _painting = false;            // a paint is putting the focus back: no pick, no seek, nothing written
let _applying = false;            // a change of ours is being written: the line it came from takes the new text
let _fromDoc = false;             // the pick was made here: the document does not scroll to it
const Q = { text: '', rep: '', cased: false, whole: false };
let _hits = [];                   // [{ id, trackId, from, to }] in the document's order
let _cur = -1;
let _msgTimer = 0;
let _last = null;                 // the line last given the focus - what the view's going writes

// ── Building ────────────────────────────────────────────────────────────────
/** The document, built once into the captions view (captions-view.js). */
export function mount(host) {
  if (_ui || !host) return;
  const root = _el('div', 'mv3-doc');
  // Find and replace.
  const find = _el('div', 'mv3-doc-find');
  const r1 = _el('div', 'mv3-doc-fr');
  const q = _el('input', 'mv3-doc-q u-in is-s');
  q.type = 'text';
  q.placeholder = 'find';
  q.spellcheck = false;
  q.setAttribute('aria-label', 'Find in the subtitles and the text lanes');
  const count = _el('span', 'mv3-doc-n');
  const opt = (label, title, key) => {
    const b = _el('button', 'mv3-doc-opt u-btn is-s', label);
    b.type = 'button';
    b.title = title;
    b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', () => {
      Q[key] = !Q[key];
      b.classList.toggle('is-on', Q[key]);
      b.setAttribute('aria-pressed', Q[key] ? 'true' : 'false');
      _cur = 0;
      _search(true);
    });
    return b;
  };
  r1.append(q, count, opt('Aa', 'Match case', 'cased'), opt('W', 'Whole words only', 'whole'));
  const r2 = _el('div', 'mv3-doc-fr');
  const rep = _el('input', 'mv3-doc-r u-in is-s');
  rep.type = 'text';
  rep.placeholder = 'replace with';
  rep.spellcheck = false;
  const one = _el('button', 'mv3-c-btn u-btn is-s', 'replace');
  one.type = 'button';
  one.title = 'Replace the lit match and go on to the next';
  const all = _el('button', 'mv3-c-btn u-btn is-s', 'replace all');
  all.type = 'button';
  all.title = 'Replace every match - one step to undo';
  r2.append(rep, one, all);
  find.append(r1, r2);
  // The lines.
  const body = _el('div', 'mv3-doc-body');
  body.tabIndex = -1;
  body.dataset.ownKeys = '1';
  body.setAttribute('aria-label', 'The text of the subtitles and the text lanes');
  const msg = _el('div', 'mv3-doc-msg');
  msg.hidden = true;
  const help = _el('div', 'mv3-doc-help', 'Enter cuts a line · Delete at its end joins the next · Backspace at its start '
    + 'the one before · Tab, ↑ ↓ the next line · a line is written when you leave it');
  root.append(find, body, msg, help);
  host.appendChild(root);
  _ui = { root, q, count, rep, one, all, body, msg };

  q.addEventListener('input', () => { Q.text = q.value; _cur = 0; _search(true); });
  q.addEventListener('keydown', (e) => {
    if (Layers.blocked()) return;
    if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); _step(e.shiftKey ? -1 : 1); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); body.focus({ preventScroll: true }); }
  });
  rep.addEventListener('input', () => { Q.rep = rep.value; });
  rep.addEventListener('keydown', (e) => {
    if (Layers.blocked()) return;
    if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); _replaceOne(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); body.focus({ preventScroll: true }); }
  });
  one.addEventListener('click', _replaceOne);
  all.addEventListener('click', _replaceAll);
  body.addEventListener('keydown', _bodyKeys);
  _wire();
}

function _wire() {
  if (_wired) return;
  _wired = true;
  Store.onChange(() => { if (_shown) paint(); });
  onSelChange(() => { if (_shown) _paintSel(!_fromDoc); });
}

/** The tab is up (true) or not. Leaving it writes a line being typed, as leaving the line would. */
export function setShown(on) {
  const was = _shown;
  _shown = !!on && !!_ui;
  if (_shown && !was) { paint(); _paintSel(true); }
  if (!_shown && was) _flushTyping();
}

// ── Painting ────────────────────────────────────────────────────────────────
function _lanes() {
  const tl = Store.timeline();
  const lanes = ((tl && tl.tracks) || []).filter(isWordsLane);
  // The subtitles first, then the text lanes in the order they were made.
  return lanes.filter(t => t.kind === 'subs').concat(lanes.filter(t => t.kind !== 'subs'));
}

// The nodes of a parent in this order, moving only what is out of place (a focused field moved loses its focus).
function _place(parent, nodes) {
  const want = new Set(nodes);
  for (const n of [...parent.children]) if (!want.has(n)) n.remove();
  let at = parent.firstChild;
  for (const n of nodes) {
    if (n === at) { at = at.nextSibling; continue; }
    parent.insertBefore(n, at);
  }
}

/** The document again from the store - cheap: rows are kept by caption and only what changed is written. */
export function paint() {
  if (!_ui) return;
  const key = Store.key();
  if (key !== _key) { _key = key; _say(''); }
  const a = document.activeElement;
  const focusRow = _rowOf(a);
  const keep = focusRow ? { id: focusRow.c.id, a: a.selectionStart, b: a.selectionEnd } : null;
  _painting = true;
  try {
    const lanes = _lanes();
    const secs = [];
    const order = [];
    const seen = new Set();
    const canEdit = Store.canEdit();
    for (const t of lanes) {
      let sec = _secs.get(t.id);
      if (!sec) {
        sec = { el: _el('div', 'mv3-doc-sec'), head: _el('div', 'mv3-doc-sh'), list: _el('div', 'mv3-doc-lines') };
        sec.el.append(sec.head, sec.list);
        _secs.set(t.id, sec);
      }
      sec.el.dataset.track = t.id;
      const lines = linesOf(t);
      const name = t.name || (t.kind === 'subs' ? 'Subtitles' : 'Text');
      const head = name + ' · ' + lines.length + (lines.length === 1 ? ' line' : ' lines');
      if (sec.head.textContent !== head) sec.head.textContent = head;
      const nodes = [];
      let voice = null;
      for (const c of lines) {
        let r = _rows.get(c.id);
        if (!r) { r = _makeRow(); _rows.set(c.id, r); }
        _fill(r, c, t, canEdit);
        // Where one line of the script gives way to the next: a talking head's captions never join across it.
        const v = String(c.voice || '');
        r.el.classList.toggle('is-seam', voice != null && !!v && !!voice && v !== voice);
        if (v) voice = v;
        nodes.push(r.el);
        order.push(c.id);
        seen.add(c.id);
      }
      if (!lines.length) {
        sec.empty = sec.empty || _el('div', 'mv3-doc-none');
        sec.empty.textContent = t.kind === 'subs' ? 'No lines yet - Generate from the sound, or Add a line, in the strip.' : 'No lines yet - Add a line in the strip.';
        nodes.push(sec.empty);
      }
      _place(sec.list, nodes);
      secs.push(sec.el);
    }
    for (const [id] of _rows) if (!seen.has(id)) _rows.delete(id);
    for (const [id] of _secs) if (!lanes.some(t => t.id === id)) _secs.delete(id);
    _place(_ui.body, secs);
    _order = order;
    // The focus where it was: on its line, or - the line gone into another - on the one now at its place.
    if (keep && document.activeElement !== (_rows.get(keep.id) || {}).ta) {
      const r = _rows.get(keep.id);
      if (r) { r.ta.focus({ preventScroll: true }); _caret(r.ta, keep.a, keep.b); }
    }
  } finally {
    _painting = false;
  }
  _search(false);
  _paintSel(false);
  _ui.one.disabled = _ui.all.disabled = !Store.canEdit();
}

function _makeRow() {
  const el = _el('div', 'mv3-doc-row');
  const t = _el('span', 'mv3-doc-t');
  const x = _el('div', 'mv3-doc-x');
  const bd = _el('div', 'mv3-doc-bd');
  bd.setAttribute('aria-hidden', 'true');
  const ta = _el('textarea', 'mv3-doc-in');
  ta.rows = 1;
  ta.spellcheck = false;
  ta.setAttribute('autocomplete', 'off');
  x.append(bd, ta);
  el.append(t, x);
  const r = { el, ta, bd, t, c: null, trackId: '', heard: false, sig: '' };
  ta.__doc = r;
  // The time takes the press to its line's start.
  t.addEventListener('mousedown', (e) => { e.preventDefault(); ta.focus({ preventScroll: true }); _caret(ta, 0, 0); });
  ta.addEventListener('focus', () => _onFocus(r));
  ta.addEventListener('blur', (e) => _onBlur(r, e));
  ta.addEventListener('keydown', (e) => _rowKeys(e, r));
  ta.addEventListener('input', () => { _paintMarks(r); if (Q.text) _search(false); });
  return r;
}

function _fill(r, c, t, canEdit) {
  r.c = c;
  r.trackId = t.id;
  r.heard = isHeard(c);
  r.el.dataset.id = c.id;
  const start = +c.start || 0, end = start + (+c.dur || 0);
  const tt = _fmt(start);
  if (r.t.textContent !== tt) r.t.textContent = tt;
  const fixed = r.heard && isCorrected(c);
  r.t.title = _fmt2(start) + ' → ' + _fmt2(end) + (r.heard ? ' · heard' + (fixed ? ', corrected by hand' : '') : ' · typed');
  r.el.classList.toggle('is-fix', fixed);
  r.el.classList.toggle('is-typed', !r.heard);
  r.ta.readOnly = !canEdit;
  const text = textOfLine(c);
  // Never over typing not written yet - unless it is our own change being written from this very line.
  const dirty = r.ta.__painted != null && r.ta.value !== r.ta.__painted;
  if (!dirty || _applying) {
    if (r.ta.value !== text) {
      const f = document.activeElement === r.ta;
      const a = r.ta.selectionStart, b = r.ta.selectionEnd;
      r.ta.value = text;
      if (f) _caret(r.ta, a, b);
    }
    r.ta.__painted = text;
  }
}

const _caret = (ta, a, b) => { const n = ta.value.length; try { ta.setSelectionRange(Math.min(n, a == null ? n : a), Math.min(n, b == null ? (a == null ? n : a) : b)); } catch { /* not a text field any more */ } };
const _rowOf = (el) => (el && el.__doc && _rows.get(el.__doc.c && el.__doc.c.id) === el.__doc ? el.__doc : null);
// A line brought into view by scrolling the document alone - scrollIntoView scrolls every box around it too, and the
// panel's own boxes would slide.
function _into(el) {
  const body = _ui && _ui.body;
  if (!body || !el || !el.isConnected) return;
  const b = body.getBoundingClientRect(), r = el.getBoundingClientRect();
  if (r.top < b.top) body.scrollTop -= (b.top - r.top) + 4;
  else if (r.bottom > b.bottom) body.scrollTop += Math.min(r.top - b.top, r.bottom - b.bottom + 4);
}

// The picked lines lit; the lane picked, its head. `reveal`: the first picked line brought into view (a pick made
// on the timeline, or the view just opened).
function _paintSel(reveal) {
  if (!_ui) return;
  const sel = new Set(selectedIds());
  const lane = selectedTrack();
  let first = null;
  for (const id of _order) {
    const r = _rows.get(id);
    if (!r) continue;
    const on = sel.has(id);
    r.el.classList.toggle('is-sel', on);
    if (on && !first) first = r;
  }
  for (const [id, sec] of _secs) sec.head.classList.toggle('is-sel', !!lane && lane.id === id);
  if (reveal && first && document.activeElement !== first.ta) _into(first.el);
}

// ── Messages ────────────────────────────────────────────────────────────────
function _say(text, ok) {
  if (!_ui) return;
  if (_msgTimer) { clearTimeout(_msgTimer); _msgTimer = 0; }
  _ui.msg.classList.toggle('is-ok', !!ok);
  _ui.msg.textContent = text || '';
  _ui.msg.hidden = !text;
  if (text) _msgTimer = setTimeout(() => { _msgTimer = 0; if (_ui) { _ui.msg.hidden = true; _ui.msg.textContent = ''; } }, 12000);
}

// ── A line: picked, written, cut, joined ────────────────────────────────────
function _onFocus(r) {
  _last = r;
  if (_painting) return;
  const c = r.c;
  if (!c) return;
  const sel = selectedIds();
  if (!(sel.length === 1 && sel[0] === c.id)) {
    _fromDoc = true;
    try { selectClipById(c.id); } finally { _fromDoc = false; }
  }
  seek(+c.start || 0, { exact: true });
}

function _onBlur(r, e) {
  setTimeout(() => Store.typingDone(), 0);
  if (_painting || _applying) return;
  if (r.ta.value === r.ta.__painted) return;
  // Only the WINDOW lost the focus (Alt+Tab): the line still has it in the page - nothing is left yet.
  if (document.activeElement === r.ta) return;
  const to = e && e.relatedTarget;
  const why = _apply(r);
  if (!why) return;
  if (to && _rowOf(to)) {
    // Moving on in the document: back to this line, its words said under the document.
    setTimeout(() => { if (r.ta.isConnected) { r.ta.focus({ preventScroll: true }); } }, 0);
  } else {
    const typed = r.ta.value;
    r.ta.value = r.ta.__painted;
    _paintMarks(r);
    if (_shown) _say('Not written: ' + why + '. You typed: «' + typed + '»');
    else note(document.getElementById('mv3-lib-cap') || document.body, 'A line of the captions was not written.', why + ' - you typed: «' + typed + '»', { stay: true });
  }
}

/** The line's typing written into it - one step to undo. @returns null, or why it was not. */
function _apply(r) {
  const ta = r.ta;
  if (!r.c || ta.value === ta.__painted) return null;
  const text = ta.value;
  _applying = true;
  let res;
  try { res = rewriteLines(r.trackId, [r.c.id], [ta.__painted], (t, i, mk) => editLine(t, i, text, mk)); } finally { _applying = false; }
  if (res.why) { _say(res.why); return res.why; }
  _say('');
  // Written as the store holds it now - also while the view is away, when no paint follows the change.
  const lane = (((Store.timeline() || {}).tracks) || []).find(t => t.id === r.trackId);
  const c = lane && (lane.clips || []).find(x => x.id === r.c.id);
  if (c) { const name = textOfLine(c); if (ta.value !== name) ta.value = name; ta.__painted = name; }
  return null;
}

// The line before or after in the document (`d`), across lanes; null at an end.
function _near(id, d) {
  const i = _order.indexOf(id);
  const j = i + d;
  return i >= 0 && j >= 0 && j < _order.length ? _rows.get(_order[j]) : null;
}

// Onto the line `d` away: this one written first (refused - the cursor stays, and it is said).
function _go(r, d, where) {
  const pos = _order.indexOf(r.c.id);
  const off = r.ta.selectionStart;
  if (_apply(r)) return;
  let to = _rows.get(r.c.id) ? _near(r.c.id, d) : (d > 0 ? _rows.get(_order[pos]) : _rows.get(_order[pos - 1]));
  if (!to) return;
  to.ta.focus({ preventScroll: true });
  _into(to.el);
  _caret(to.ta, where === 'keep' ? off : (d > 0 && where === 'start' ? 0 : to.ta.value.length));
}

function _focusLine(id, at) {
  const r = _rows.get(id);
  if (!r) return;
  r.ta.focus({ preventScroll: true });
  _into(r.el);
  _caret(r.ta, at, at);
}

// Enter: the line cut where the cursor is - its typing and all - between its words; the cursor on the second half.
function _split(r) {
  const ta = r.ta;
  const a = ta.selectionStart, b = ta.selectionEnd;
  const text = ta.value.slice(0, a) + ta.value.slice(b);
  if (!text.slice(0, a).trim()) return;                      // at the start: nothing goes before it
  if (!text.slice(a).trim()) {                               // at the end: the line written, on to the next one
    if (text !== ta.value) ta.value = text;
    _go(r, 1, 'start');
    return;
  }
  const painted = ta.__painted;
  _applying = true;
  let res;
  try { res = rewriteLines(r.trackId, [r.c.id], [painted], (t, i, mk) => splitLine(t, i, text, a, mk)); } finally { _applying = false; }
  if (res.why) { _say(res.why); return; }
  _say('');
  if (res.ids[1]) _focusLine(res.ids[1], 0);
}

// Delete at the end (`d` 1: with the next line), Backspace at the start (-1: with the one before) - on the same lane.
function _join(r, d) {
  const lane = ((Store.timeline() || {}).tracks || []).find(t => t.id === r.trackId);
  const lines = lane ? linesOf(lane) : [];
  const i = lines.findIndex(c => c.id === r.c.id);
  const other = lines[i + d];
  if (i < 0 || !other) { _say(d > 0 ? 'The last line of this lane - nothing after it to join' : 'The first line of this lane - nothing before it to join'); return; }
  const ta = r.ta;
  const cur = ta.value;
  let res, caret;
  _applying = true;
  try {
    if (d > 0) {
      const left = cur.replace(/\s+$/u, '');
      caret = left.length + (left && textOfLine(other).trim() ? 1 : 0);
      res = rewriteLines(r.trackId, [r.c.id, other.id], [ta.__painted, textOfLine(other)], (t, k, mk) => joinLines(t, k, cur, mk));
    } else {
      const left = textOfLine(other).replace(/\s+$/u, '');
      const right = cur.replace(/^\s+/u, '');
      caret = left.length + (left && right ? 1 : 0);
      res = rewriteLines(r.trackId, [other.id, r.c.id], [textOfLine(other), ta.__painted],
        (t, k, mk) => rewrite(t, k, k + 2, [left && right ? left + ' ' + right : left + right], mk));
    }
  } finally { _applying = false; }
  if (res.why) { _say(res.why); return; }
  _say('');
  if (res.ids[0]) _focusLine(res.ids[0], caret);
}

// Is the cursor at the edge of the field the arrow goes towards - the line before or after is next?
function _atEdge(ta, d) {
  const lh = parseFloat(getComputedStyle(ta).lineHeight) || 18;
  if (ta.clientHeight < lh * 1.6) return true;                 // one line on screen
  return d < 0 ? ta.selectionStart === 0 && ta.selectionEnd === 0 : ta.selectionStart === ta.value.length;
}

function _rowKeys(e, r) {
  if (Layers.blocked() || e.isComposing) return;
  const ta = r.ta;
  if (e.ctrlKey || e.metaKey) {
    if (e.altKey) return;
    const key = String(e.key || '').toLowerCase();
    const k = /^[a-z]$/.test(key) ? key : (e.code === 'KeyZ' ? 'z' : e.code === 'KeyY' ? 'y' : e.code === 'KeyF' ? 'f' : key);
    if (k === 'f') { e.preventDefault(); _focusFind(); return; }
    // The field's own undo while it holds typing; the project's once it does not.
    if ((k === 'z' || k === 'y') && ta.value === ta.__painted) { e.preventDefault(); _undo(k === 'y' || e.shiftKey); }
    return;
  }
  if (e.altKey) return;
  const collapsed = ta.selectionStart === ta.selectionEnd;
  switch (e.key) {
    case 'Enter':
      // A typed line takes a line break of its own (Shift+Enter); a heard one has none.
      if (e.shiftKey) { if (r.heard) e.preventDefault(); return; }
      e.preventDefault();
      if (!ta.readOnly) _split(r);
      return;
    case 'Delete':
      if (collapsed && ta.selectionStart === ta.value.length && !ta.readOnly) { e.preventDefault(); _join(r, 1); }
      return;
    case 'Backspace':
      if (collapsed && ta.selectionStart === 0 && !ta.readOnly) { e.preventDefault(); _join(r, -1); }
      return;
    case 'Tab':
      e.preventDefault();
      _go(r, e.shiftKey ? -1 : 1, 'end');
      return;
    case 'ArrowUp':
    case 'ArrowDown': {
      const d = e.key === 'ArrowUp' ? -1 : 1;
      if (e.shiftKey || !_atEdge(ta, d) || !_near(r.c.id, d)) return;
      e.preventDefault();
      _go(r, d, 'keep');
      return;
    }
    case 'Escape':
      e.preventDefault();
      e.stopPropagation();
      // Left: written (refused - it stays in the field, said under the document). A second Escape lets go of the pick.
      if (_apply(r)) return;
      _ui.body.focus({ preventScroll: true });
      return;
    default:
  }
}

// The document itself has the focus (after Escape): the arrows and Enter go back into a line, Ctrl+Z is the undo.
function _bodyKeys(e) {
  if (e.target !== _ui.body || Layers.blocked()) return;
  if (e.ctrlKey || e.metaKey) {
    if (e.altKey) return;
    const key = String(e.key || '').toLowerCase();
    const k = /^[a-z]$/.test(key) ? key : (e.code === 'KeyZ' ? 'z' : e.code === 'KeyY' ? 'y' : e.code === 'KeyF' ? 'f' : key);
    if (k === 'f') { e.preventDefault(); _focusFind(); }
    else if (k === 'z' || k === 'y') { e.preventDefault(); e.stopPropagation(); _undo(k === 'y' || e.shiftKey); }
    return;
  }
  const sel = selectedIds().find(id => _rows.has(id));
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === 'F2') {
    e.preventDefault();
    const id = sel || (e.key === 'ArrowUp' ? _order[_order.length - 1] : _order[0]);
    if (id) _focusLine(id, (_rows.get(id) || { ta: { value: '' } }).ta.value.length);
  } else if (e.code === 'Space' || e.key === ' ') {
    e.preventDefault();                                      // the preview plays (its own key); the document does not scroll
  }
}

// THE PROJECT'S UNDO from the document. The pick waits on the lane while the step is taken back - a line it took back
// would leave the pick on nothing and close the view - and comes back: on the line the cursor was in, or the lines that
// were picked, where they still are.
function _undo(redo) {
  const a = document.activeElement;
  const r = _rowOf(a);
  const pos = r ? _order.indexOf(r.c.id) : -1;
  const off = r ? r.ta.selectionStart : 0;
  const picked = selectedIds();
  const lane = r ? r.trackId : (((selectedTrack() || {}).id) || (picked.length && _rows.get(picked[0]) ? _rows.get(picked[0]).trackId : ''));
  if (!(redo ? History.canRedo() : History.canUndo())) return;
  if (picked.length && lane) { _fromDoc = true; try { selectTrackById(lane); } finally { _fromDoc = false; } }
  if (redo) History.redo(); else History.undo();
  if (r) {
    // The line gone (a cut taken back): the line of its lane that holds its moment now - the one it went back into.
    const holds = () => {
      const t0 = +r.c.start || 0;
      for (const id of _order) {
        const x = _rows.get(id);
        if (x && x.trackId === r.trackId && (+x.c.start || 0) <= t0 + 1e-6 && t0 < (+x.c.start || 0) + (+x.c.dur || 0)) return id;
      }
      return _order[Math.max(0, Math.min(pos, _order.length - 1))];
    };
    const id = _rows.has(r.c.id) ? r.c.id : holds();
    if (id) {
      const to = _rows.get(id);
      to.ta.blur();
      _focusLine(id, id === r.c.id ? off : to.ta.value.length);
      return;
    }
  }
  const back = picked.filter(id => _rows.has(id));
  if (back.length) { _fromDoc = true; try { selectClipById(back[0]); } finally { _fromDoc = false; } }
  if (_ui) _ui.body.focus({ preventScroll: true });
}

// A line being typed when the view goes away (the pick went to a clip of another kind): written now; refused - said.
// Later, not inside the paint of the strip that is hiding the view (the write repaints it).
function _flushTyping() {
  const r = _last;
  if (!r || !r.c || r.ta.value === r.ta.__painted) return;
  setTimeout(() => {
    if (_rows.get(r.c.id) !== r || r.ta.value === r.ta.__painted) return;
    const typed = r.ta.value;
    const why = _apply(r);
    if (why) {
      r.ta.value = r.ta.__painted;
      note(document.getElementById('mv3-lib-cap') || document.body, 'A line of the captions was not written.', why + ' - you typed: «' + typed + '»', { stay: true });
    }
  }, 0);
}

function _focusFind() {
  if (!_ui) return;
  _ui.q.focus({ preventScroll: true });
  _ui.q.select();
}

// ── Find and replace ────────────────────────────────────────────────────────
const _re = () => matcher(Q.text, { cased: Q.cased, whole: Q.whole });

// Every match in the document, the count, the lit ones. `reveal`: the current one brought into view and picked.
function _search(reveal) {
  if (!_ui) return;
  const re = _re();
  const hits = [];
  if (re) {
    for (const id of _order) {
      const r = _rows.get(id);
      if (!r) continue;
      for (const [from, to] of matchesIn(r.ta.value, re)) hits.push({ id, trackId: r.trackId, from, to });
    }
  }
  _hits = hits;
  if (!hits.length) _cur = -1;
  else if (_cur < 0 || _cur >= hits.length) _cur = 0;
  _ui.count.textContent = !Q.text ? '' : hits.length ? (_cur + 1) + ' of ' + hits.length : 'no matches';
  _ui.count.classList.toggle('is-none', !!Q.text && !hits.length);
  for (const id of _order) { const r = _rows.get(id); if (r) _paintMarks(r); }
  if (reveal && _cur >= 0) _reveal(hits[_cur]);
}

// The matches of one line, lit behind its text (the field is clear over a copy of it laid out the same way).
function _paintMarks(r) {
  const mine = _hits.filter(h => h.id === (r.c && r.c.id));
  const cur = _cur >= 0 ? _hits[_cur] : null;
  const v = r.ta.value;
  const sig = mine.length ? v + '\u0000' + mine.map(h => h.from + ':' + h.to + (h === cur ? '*' : '')).join(',') : '';
  if (sig === r.sig) return;
  r.sig = sig;
  if (!mine.length) { r.bd.textContent = ''; return; }
  let html = '', at = 0;
  for (const h of mine) {
    if (h.from < at || h.to > v.length) continue;            // the field moved on since: the next search lays them again
    html += _esc(v.slice(at, h.from)) + '<mark' + (h === cur ? ' class="is-cur"' : '') + '>' + _esc(v.slice(h.from, h.to)) + '</mark>';
    at = h.to;
  }
  // A last line break takes a line in the field: the copy gets one too.
  r.bd.innerHTML = html + _esc(v.slice(at)) + (v.endsWith('\n') ? ' ' : '');
}

function _reveal(h, pick) {
  const r = h && _rows.get(h.id);
  if (!r) return;
  _into(r.el);
  if (!pick) return;
  const sel = selectedIds();
  if (!(sel.length === 1 && sel[0] === h.id)) { _fromDoc = true; try { selectClipById(h.id); } finally { _fromDoc = false; } }
  seek(+r.c.start || 0, { exact: true });
}

function _step(d) {
  if (!_hits.length) { _search(false); return; }
  _cur = (_cur + d + _hits.length) % _hits.length;
  _ui.count.textContent = (_cur + 1) + ' of ' + _hits.length;
  for (const id of _order) { const r = _rows.get(id); if (r) _paintMarks(r); }
  _reveal(_hits[_cur], true);
}

function _replaceOne() {
  if (!Store.canEdit()) return;
  _search(false);
  const h = _cur >= 0 ? _hits[_cur] : null;
  const r = h && _rows.get(h.id);
  if (!r) return;
  const nth = _hits.filter(x => x.id === h.id).indexOf(h);
  const text = replaceIn(r.ta.value, _re(), Q.rep, nth);
  const painted = r.ta.__painted;
  _applying = true;
  let res;
  try { res = rewriteLines(h.trackId, [h.id], [painted], (t, i, mk) => editLine(t, i, text, mk)); } finally { _applying = false; }
  if (res.why) { _say(res.why); return; }
  _say('');
  // The same place in the list is the next match now.
  _search(false);
  if (_hits.length) { _cur = Math.min(_cur, _hits.length - 1); _step(0); }
}

function _replaceAll() {
  if (!Store.canEdit()) return;
  _search(false);
  const re = _re();
  if (!re || !_hits.length) return;
  const edits = [];
  const done = new Set();
  for (const h of _hits) {
    if (done.has(h.id)) continue;
    done.add(h.id);
    const r = _rows.get(h.id);
    if (!r) continue;
    edits.push({ trackId: h.trackId, id: h.id, painted: r.ta.__painted, text: replaceIn(r.ta.value, re, Q.rep) });
  }
  const n = _hits.length;
  _applying = true;
  let res;
  try { res = rewriteEach(edits); } finally { _applying = false; }
  const bad = res.refused || [];
  _cur = 0;
  _search(false);
  if (!res.done) _say('Nothing was replaced' + (bad.length ? ': ' + bad[0].why : ''));
  else _say('Replaced ' + n + (n === 1 ? ' match' : ' matches') + ' in ' + res.done + (res.done === 1 ? ' line' : ' lines')
    + (bad.length ? ' - ' + bad.length + (bad.length === 1 ? ' line was' : ' lines were') + ' left as ' + (bad.length === 1 ? 'it was' : 'they were') + ': ' + bad[0].why : '') + '. One step to undo.', !bad.length);
}
