/* ════════════════════════════════════════════════════════════════════════════
   MERGE — the video chat's PROMPT REFERENCE, the ALMANAC (the button at the foot of the chat's left column).

   A window IN THE MIDDLE over the page darkened and a little blurred - as the sound almanac, the one rule of the windows
   (css/app-shell.css) -, half the size of the attachment picker. Laid out like a reference book: the SECTIONS on the left
   - Camera movement with its seven categories, the others "in development", each saying what it will hold - and the
   TIPS of the open one on the right: a still that plays while the pointer rests on it, the name, the category and the
   words. A press COPIES the tip: a note says it was copied - over the prompt field
   when it is in sight, else at the foot -, and the window stays open for the next one. Escape, the cross and a press on
   the dark around it close it.

   The sections are data: public/presets/helper/index.json lists them, each ready one with its file (camera.json, made
   by tools/fetch-camera.js). A section is added there, not here.
   ════════════════════════════════════════════════════════════════════════════ */

import * as Layers from '../layers.js';
// Being read, nothing here, could not be read - the shared parts; the reason a popup in the corner.
import { emptyEl, loadingEl, failedEl } from '../ui-state.js';
import { showError } from '../notice.js';

const BASE = '/presets/helper/';
const LS = 'mv3_vhelp_v1';            // { sec, cat } - where the reference was left
const W_MAX = 860, H_MAX = 560;       // half the attachment picker

let _index = null;                    // index.json, read once
const _files = new Map();             // section id -> its file, read once
let _w = null;                        // the open window
let _st = { sec: '', cat: '', q: '' };
let _toastT = 0;

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
// A read that fails says why: the index or a section's file is "did not load" with Try again, never
// "nothing here".
const _read = (url) => fetch(url).then((r) => { if (!r.ok) throw new Error('the app answered ' + r.status); return r.json(); });
function _stored() { try { return JSON.parse(localStorage.getItem(LS) || '') || {}; } catch (e) { return {}; } }
function _keep() { try { localStorage.setItem(LS, JSON.stringify({ sec: _st.sec, cat: _st.cat })); } catch (e) { /* a private window */ } }
const _lc = (s) => String(s || '').toLowerCase();

/**
 * Opens the reference - the almanac at the foot of the chat's column (`anchor`) - in the middle of the page. `field()` is the prompt field a
 * copied tip is for - asked at every copy, so the note stands over the one typed in last. `note()`: a line over the
 * camera tips for the chosen model, or ''.
 */
export async function openHelp(o) {
  // The almanac pressed again: the window it opened closes.
  if (_w && _w.anchor === o.anchor) { closeHelp(); return; }
  closeHelp();
  const was = _stored();
  _st = { sec: was.sec || '', cat: was.cat || '', q: '' };
  _build(o);
  await _start();
}

// The index first (read once), then the section left open.
async function _start() {
  if (!_w) return;
  if (!_index) {
    _w.list.replaceChildren(loadingEl('reading…'));
    let why = '';
    try {
      const d = await _read(BASE + 'index.json');
      if (d && Array.isArray(d.sections) && d.sections.length) _index = d;
      else why = 'it lists no sections';
    } catch (e) { why = e.message || 'it could not be read'; }
    if (!_w) return;
    if (!_index) {
      showError('The reference could not be read.', { detail: why });
      _paintSide();
      _w.q.parentElement.hidden = true;
      _w.list.replaceChildren(failedEl('The reference', () => _start()));
      return;
    }
  }
  const secs = (_index && _index.sections) || [];
  if (!secs.some(s => s.id === _st.sec)) _st.sec = (secs.find(s => s.file) || secs[0] || {}).id || '';
  await _open(_st.sec, true);
  if (_w) _w.q.focus();
}

export function closeHelp() {
  if (!_w) return;
  const w = _w;
  _w = null;
  window.removeEventListener('resize', w.place);
  Layers.close(w.layer);
  w.ov.remove();
}

// ── The window ──────────────────────────────────────────────────────────────
function _build(o) {
  // Over the page darkened and blurred: a modal layer - a press on the dark closes it.
  const ov = el('div', 'hp-ov');
  // the one window frame (css/app-shell.css .u-win): its head - the name, a quiet note, the 28 px ✕
  const box = el('div', 'hp u-win is-float');
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-label', 'Almanac');
  const head = el('div', 'hp-head u-win-head');
  head.append(el('b', 'u-win-title', 'Almanac'), el('span', 'hp-sub u-win-sub', 'press a tip to copy it'));
  const x = el('button', 'hp-x u-btn is-icon is-quiet u-x', '');
  x.type = 'button';
  x.title = 'Close (Esc)';
  head.appendChild(x);
  const side = el('nav', 'hp-side');
  const main = el('div', 'hp-main');
  const bar = el('div', 'hp-bar');
  const q = document.createElement('input');
  q.type = 'search';
  q.className = 'hp-q u-in is-s';
  q.placeholder = 'search';
  q.spellcheck = false;
  const count = el('span', 'hp-count', '');
  bar.append(q, count);
  const note = el('div', 'hp-note');
  note.hidden = true;
  const list = el('div', 'hp-list');
  main.append(bar, note, list);
  const body = el('div', 'hp-body');
  body.append(side, main);
  box.append(head, body);
  ov.appendChild(box);
  document.body.appendChild(ov);

  const fieldOf = () => (typeof o.field === 'function' ? o.field() : o.field);
  const place = () => _place(box);
  _w = { ov, box, side, main, q, count, note, list, anchor: o.anchor, fieldOf, noteOf: o.note, layer: null, place };
  _w.layer = Layers.open(ov, { name: 'prompt reference', onEsc: closeHelp });
  ov.addEventListener('mousedown', (e) => { if (e.target === ov) closeHelp(); });
  window.addEventListener('resize', place);
  x.addEventListener('click', closeHelp);
  q.addEventListener('input', () => { _st.q = q.value; _paintList(); });
  place();
}

// In the middle of the page, half the attachment picker - smaller on a small window.
function _place(box) {
  const w = Math.min(W_MAX, innerWidth - 32), h = Math.min(H_MAX, innerHeight - 32);
  box.style.width = w + 'px';
  box.style.height = h + 'px';
  box.style.left = Math.round((innerWidth - w) / 2) + 'px';
  box.style.top = Math.round((innerHeight - h) / 2) + 'px';
}

// ── The sections ────────────────────────────────────────────────────────────
async function _open(id, keepCat) {
  if (!_w) return;
  const sec = ((_index && _index.sections) || []).find(s => s.id === id);
  _st.sec = id;
  if (!keepCat) _st.cat = '';
  _st.q = '';
  _w.q.value = '';
  if (sec && sec.file && !_files.has(id)) {
    _paintSide();
    _w.list.replaceChildren(loadingEl('reading…'));
    let d = null;
    try { d = await _read(BASE + sec.file); }
    catch (e) {
      if (!_w || _st.sec !== id) return;
      showError(sec.label + ' did not load: ' + (e.message || 'it could not be read'));
      _w.q.parentElement.hidden = true;
      _w.note.hidden = true;
      _w.list.replaceChildren(failedEl(sec.label, () => _open(id, true)));
      return;
    }
    _files.set(id, d || { items: [], cats: [] });
    if (!_w || _st.sec !== id) return;
  }
  const f = _files.get(id);
  if (f && _st.cat && !(f.cats || []).some(c => c.id === _st.cat)) _st.cat = '';
  _keep();
  _paintSide();
  _paintList();
}

function _paintSide() {
  const S = _w.side;
  S.textContent = '';
  const secs = (_index && _index.sections) || [];
  // An index that did not load: the list on the right says so, with Try again.
  if (!secs.length) return;
  for (const s of secs) {
    const ready = !!s.file;
    const on = s.id === _st.sec;
    const b = el('button', 'hp-sec' + (on ? ' on' : '') + (ready ? '' : ' is-soon'));
    b.type = 'button';
    b.appendChild(el('span', 'nm', s.label));
    const f = _files.get(s.id);
    if (ready && f) b.appendChild(el('small', null, String((f.items || []).length)));
    if (!ready) b.appendChild(el('i', null, 'In development'));
    b.title = s.about || '';
    b.addEventListener('click', () => { if (_st.sec !== s.id || _st.cat) _open(s.id); });
    S.appendChild(b);
    // The open section's categories under it.
    if (on && ready && f && (f.cats || []).length) {
      const cats = [{ id: '', label: 'All', count: (f.items || []).length }].concat(f.cats);
      for (const c of cats) {
        const cb = el('button', 'hp-cat' + (c.id === _st.cat ? ' on' : ''));
        cb.type = 'button';
        cb.append(el('span', 'nm', c.label), el('small', null, String(c.count)));
        cb.addEventListener('click', () => { _st.cat = c.id; _keep(); _paintSide(); _paintList(); });
        S.appendChild(cb);
      }
    }
  }
}

// ── The tips ────────────────────────────────────────────────────────────────
function _paintList() {
  const L = _w.list;
  L.textContent = '';
  L.scrollTop = 0;
  const sec = ((_index && _index.sections) || []).find(s => s.id === _st.sec);
  const bar = _w.q.parentElement;
  if (!sec) { bar.hidden = true; _w.note.hidden = true; return; }
  if (!sec.file) {
    // In development: what it will hold, and that it is coming.
    bar.hidden = true;
    _w.note.hidden = true;
    const soon = el('div', 'hp-soon');
    soon.append(el('b', null, sec.label), el('i', null, 'In development'), el('p', null, sec.about || ''),
      el('p', 'hp-soon-more', 'This part of the reference is being filled in step by step.'));
    L.appendChild(soon);
    return;
  }
  bar.hidden = false;
  const f = _files.get(sec.id) || { items: [], cats: [] };
  const catOf = new Map((f.cats || []).map(c => [c.id, c.label]));
  const words = sec.id === 'camera' && typeof _w.noteOf === 'function' ? _w.noteOf() : '';
  _w.note.textContent = words || '';
  _w.note.hidden = !words;
  const q = _lc(_st.q).trim();
  const shown = (f.items || []).filter(it => (!_st.cat || it.cat === _st.cat)
    && (!q || _lc(it.name).includes(q) || _lc(it.prompt).includes(q) || _lc(catOf.get(it.cat)).includes(q)));
  const all = (f.items || []).filter(it => !_st.cat || it.cat === _st.cat).length;
  _w.count.textContent = shown.length === all ? String(all) : shown.length + ' of ' + all;
  if (!shown.length) { L.appendChild(emptyEl(q ? 'Nothing here is called “' + _st.q.trim() + '”.' : 'Nothing here yet.', { icon: q ? 'search' : 'film' })); return; }
  for (const it of shown) L.appendChild(_tile(it, catOf.get(it.cat) || ''));
  if (f.source && f.source.url) {
    const src = el('div', 'hp-src');
    const a = el('a', null, f.source.name || f.source.url);
    a.href = f.source.url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    src.append('From ', a, ' - a free reference for AI filmmakers.');
    L.appendChild(src);
  }
}

function _tile(it, catLabel) {
  // No popup under the pointer: the tile shows its words, a press copies them.
  const t = el('button', 'hp-tile');
  t.type = 'button';
  const pv = el('span', 'hp-pv');
  if (it.still) {
    const img = document.createElement('img');
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.src = BASE + it.still;
    pv.appendChild(img);
    // The move plays while the pointer rests on it.
    if (it.loop) {
      t.addEventListener('pointerenter', () => { img.src = BASE + it.loop; });
      t.addEventListener('pointerleave', () => { img.src = BASE + it.still; });
    }
  } else pv.classList.add('is-blank');
  const words = el('span', 'hp-words');
  const nm = el('span', 'hp-name', it.name);
  if (catLabel) nm.appendChild(el('i', null, catLabel));
  words.append(nm, el('span', 'hp-text', it.prompt));
  // "copy" wears the quiet button - the whole tip is still what is pressed
  t.append(pv, words, el('span', 'hp-copy u-btn is-s is-quiet', 'Copy'));
  t.addEventListener('click', () => _copy(it, t));
  return t;
}

// ── Copying ─────────────────────────────────────────────────────────────────
async function _toClipboard(text) {
  if (navigator.clipboard && window.isSecureContext) {
    // A browser that asks the person first can leave the promise hanging - after a second the fallback below, still
    // within the press's moment of activation.
    const ok = await Promise.race([
      navigator.clipboard.writeText(text).then(() => true, () => false),
      new Promise(r => setTimeout(() => r(false), 1000)),
    ]);
    if (ok) return true;
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
  ta.remove();
  return ok;
}

async function _copy(it, tile) {
  const ok = await _toClipboard(it.prompt);
  if (!_w) return;
  // no blinking: the note on the prompt field says it was copied; a tip not copied is outlined red a moment
  tile.classList.remove('is-fail');
  if (!ok) { tile.classList.add('is-fail'); setTimeout(() => tile.classList.remove('is-fail'), 1000); }
  _toast(_w.fieldOf(), ok ? 'Copied: ' + it.name + ' - paste it into the prompt (Ctrl+V)' : 'Could not copy - the words are selected: copy them yourself', !ok);
  // Not copied: its words are selected, one Ctrl+C away.
  if (!ok) _select(tile.querySelector('.hp-text'));
}

function _select(node) {
  if (!node) return;
  try { const r = document.createRange(); r.selectNodeContents(node); const s = window.getSelection(); s.removeAllRanges(); s.addRange(r); } catch (e) { /* nothing to select */ }
}

// The note over the prompt field - on the field itself, gone by itself.
function _toast(field, words, bad) {
  for (const old of document.querySelectorAll('.hp-toast')) old.remove();
  clearTimeout(_toastT);
  const t = el('div', 'hp-toast' + (bad ? ' is-bad' : ''), words);
  document.body.appendChild(t);
  const r = field && field.isConnected ? field.getBoundingClientRect() : null;
  // The window stands in the middle: a field under it - the note at the window's foot instead.
  const b = _w && _w.box ? _w.box.getBoundingClientRect() : null;
  const under = !!(r && r.width && b && r.left < b.right && r.right > b.left && r.top < b.bottom && r.bottom > b.top);
  if (under) {
    t.style.left = Math.round(Math.max(8, b.left + (b.width - t.offsetWidth) / 2)) + 'px';
    t.style.top = Math.round(b.bottom - t.offsetHeight - 12) + 'px';
  } else if (r && r.width) {
    t.style.left = Math.round(Math.max(8, Math.min(innerWidth - t.offsetWidth - 8, r.left + 10))) + 'px';
    t.style.top = Math.round(Math.max(8, r.top + Math.min(r.height, 44) / 2 - t.offsetHeight / 2)) + 'px';
  } else {
    t.style.left = Math.round((innerWidth - t.offsetWidth) / 2) + 'px';
    t.style.top = Math.round(innerHeight - t.offsetHeight - 24) + 'px';
  }
  requestAnimationFrame(() => t.classList.add('on'));
  _toastT = setTimeout(() => { t.classList.remove('on'); setTimeout(() => t.remove(), 250); }, 2400);
}
