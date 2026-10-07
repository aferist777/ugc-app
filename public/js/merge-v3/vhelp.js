/* ════════════════════════════════════════════════════════════════════════════
   MERGE — the video chat's PROMPT REFERENCE, the ALMANAC (phase V14, the owner 2026-10-07; since V15 the button at the
   foot of the chat's left column - it was "/" by the send; docs/local-app/PLAN.md "Фаза V14", "Фаза V15").

   A small window beside the column, clear of the prompt field it serves - the chat's box, or a card's prompt, whichever
   was typed in last -, half the size of the attachment picker, laid out like a reference book: the SECTIONS on the left
   - Camera movement with its seven categories, the others "in development", each saying what it will hold - and the
   TIPS of the open one on the right: a still that plays while the pointer rests on it, the name, the category and the
   words. A press COPIES the tip (the owner's answer 3): the tip blinks, a note over the prompt field says it was copied,
   and the window stays open for the next one. Escape, the cross, the button again and a press anywhere else close it.

   The sections are data: public/presets/helper/index.json lists them, each ready one with its file (camera.json, made
   by tools/fetch-camera.js). A section is added there, not here.
   ════════════════════════════════════════════════════════════════════════════ */

import * as Layers from '../layers.js';

const BASE = '/presets/helper/';
const LS = 'mv3_vhelp_v1';            // { sec, cat } - where the reference was left
const W_MAX = 860, H_MAX = 560;       // half the attachment picker (the owner)

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
const _json = (url) => fetch(url).then(r => (r.ok ? r.json() : null)).catch(() => null);
function _stored() { try { return JSON.parse(localStorage.getItem(LS) || '') || {}; } catch (e) { return {}; } }
function _keep() { try { localStorage.setItem(LS, JSON.stringify({ sec: _st.sec, cat: _st.cat })); } catch (e) { /* a private window */ } }
const _lc = (s) => String(s || '').toLowerCase();

export const helpOpen = () => !!_w;

/**
 * Opens the reference beside `anchor` (the button pressed). `field()` is the prompt field a copied tip is for - asked
 * at every copy, so the note stands over the one typed in last. `prefer`: 'beside' (the almanac at the foot of the
 * chat's column - the window right of it), 'above' or 'below' (clear of the field). `note()`: a line over the camera
 * tips for the chosen model, or ''.
 */
export async function openHelp(o) {
  // The almanac pressed again: the window it opened closes.
  if (_w && _w.anchor === o.anchor) { closeHelp(); return; }
  closeHelp();
  const was = _stored();
  _st = { sec: was.sec || '', cat: was.cat || '', q: '' };
  _build(o);
  if (!_index) _index = await _json(BASE + 'index.json');
  if (!_w) return;
  const secs = (_index && _index.sections) || [];
  if (!secs.some(s => s.id === _st.sec)) _st.sec = (secs.find(s => s.file) || secs[0] || {}).id || '';
  await _open(_st.sec, true);
  if (_w) _w.q.focus();
}

export function closeHelp() {
  if (!_w) return;
  const w = _w;
  _w = null;
  document.removeEventListener('mousedown', w.away, true);
  window.removeEventListener('resize', w.place);
  Layers.close(w.layer);
  w.box.remove();
}

// ── The window ──────────────────────────────────────────────────────────────
function _build(o) {
  const box = el('div', 'hp');
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-label', 'Almanac');
  const head = el('div', 'hp-head');
  head.append(el('b', null, 'Almanac'), el('span', 'hp-sub', 'press a tip to copy it'));
  const x = el('button', 'hp-x', '✕');
  x.type = 'button';
  x.title = 'Close (Esc)';
  head.appendChild(x);
  const side = el('nav', 'hp-side');
  const main = el('div', 'hp-main');
  const bar = el('div', 'hp-bar');
  const q = document.createElement('input');
  q.type = 'search';
  q.className = 'hp-q';
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
  document.body.appendChild(box);

  const fieldOf = () => (typeof o.field === 'function' ? o.field() : o.field);
  const place = () => _place(box, o.anchor, o.prefer, fieldOf());
  // A press anywhere but in the window - or on the button that opened it, which toggles - closes it.
  const away = (e) => {
    const t = e.target;
    if (!t || box.contains(t) || (o.anchor && (o.anchor === t || o.anchor.contains(t)))) return;
    closeHelp();
  };
  _w = { box, side, main, q, count, note, list, anchor: o.anchor, fieldOf, noteOf: o.note, layer: null, away, place };
  _w.layer = Layers.open(box, { name: 'prompt reference', modal: false, onEsc: closeHelp });
  document.addEventListener('mousedown', away, true);
  window.addEventListener('resize', place);
  x.addEventListener('click', closeHelp);
  q.addEventListener('input', () => { _st.q = q.value; _paintList(); });
  place();
}

// Clear of the button pressed AND of the field it serves - above both when there is room there (the chat's input),
// below both for a card's prompt -, so the field stays in sight for the note and the paste; the right edge at the
// button, the whole window inside the page (a window too small for that is the one case it covers them).
function _place(box, anchor, prefer, field) {
  const a = anchor ? anchor.getBoundingClientRect() : { top: innerHeight - 60, bottom: innerHeight - 30, right: innerWidth - 20 };
  const f = field && field.isConnected ? field.getBoundingClientRect() : null;
  // (phase V15) 'beside': the almanac at the foot of the chat's left column - the window stands right of the column,
  // above the prompt field when there is room there, else under it, else level with the button's foot. A narrow chat
  // (its settings folded over the box) leaves too little room right of the button: the window then stands over both.
  if (prefer === 'beside' && innerWidth - a.right - 20 >= 640) {
    const left = a.right + 8;
    const w = Math.min(W_MAX, innerWidth - left - 12);
    let top, h;
    if (f && f.width && f.top - 16 >= 320) { h = Math.min(H_MAX, f.top - 16); top = f.top - 8 - h; }
    else if (f && f.width && innerHeight - f.bottom - 16 >= 320) { h = Math.min(H_MAX, innerHeight - f.bottom - 16); top = f.bottom + 8; }
    else { h = Math.max(220, Math.min(H_MAX, a.bottom - 16)); top = Math.max(8, a.bottom - h); }
    box.style.width = w + 'px';
    box.style.height = h + 'px';
    box.style.left = Math.round(left) + 'px';
    box.style.top = Math.round(top) + 'px';
    return;
  }
  const r = f && f.width ? { top: Math.min(a.top, f.top), bottom: Math.max(a.bottom, f.bottom), right: a.right } : a;
  const w = Math.min(W_MAX, innerWidth - 24);
  const above = r.top - 16, below = innerHeight - r.bottom - 16;
  const up = prefer === 'below' ? !(below >= 320 || below >= above) : (above >= 320 || above >= below);
  const h = Math.max(220, Math.min(H_MAX, up ? above : below));
  box.style.width = w + 'px';
  box.style.height = h + 'px';
  box.style.left = Math.round(Math.max(12, Math.min(innerWidth - w - 12, r.right - w))) + 'px';
  box.style.top = Math.round(up ? Math.max(8, r.top - 8 - h) : Math.min(innerHeight - h - 8, r.bottom + 8)) + 'px';
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
    _w.list.replaceChildren(el('div', 'hp-none', 'reading…'));
    const d = await _json(BASE + sec.file);
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
  if (!secs.length) { S.appendChild(el('div', 'hp-none', 'The reference could not be read.')); return; }
  for (const s of secs) {
    const ready = !!s.file;
    const on = s.id === _st.sec;
    const b = el('button', 'hp-sec' + (on ? ' on' : '') + (ready ? '' : ' is-soon'));
    b.type = 'button';
    b.appendChild(el('span', 'nm', s.label));
    const f = _files.get(s.id);
    if (ready && f) b.appendChild(el('small', null, String((f.items || []).length)));
    if (!ready) b.appendChild(el('i', null, 'in development'));
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
    soon.append(el('b', null, sec.label), el('i', null, 'in development'), el('p', null, sec.about || ''),
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
  if (!shown.length) { L.appendChild(el('div', 'hp-none', q ? 'Nothing here is called “' + _st.q.trim() + '”.' : 'Nothing here yet.')); return; }
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
  const t = el('button', 'hp-tile');
  t.type = 'button';
  // The whole of the words under the pointer - the tile shows four lines of them.
  t.title = it.prompt + '\n\nPress to copy it, then paste it into your prompt.';
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
  t.append(pv, words, el('span', 'hp-copy', 'copy'));
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
  tile.classList.remove('is-blink', 'is-fail');
  void tile.offsetWidth;
  tile.classList.add(ok ? 'is-blink' : 'is-fail');
  setTimeout(() => tile.classList.remove('is-blink', 'is-fail'), 1000);
  _toast(_w.fieldOf(), ok ? 'Copied: ' + it.name + ' - paste it into the prompt (Ctrl+V)' : 'Could not copy - the words are selected: copy them yourself', !ok);
  // Not copied: its words are selected, one Ctrl+C away.
  if (!ok) _select(tile.querySelector('.hp-text'));
}

function _select(node) {
  if (!node) return;
  try { const r = document.createRange(); r.selectNodeContents(node); const s = window.getSelection(); s.removeAllRanges(); s.addRange(r); } catch (e) { /* nothing to select */ }
}

// The note over the prompt field (the owner: "всплывашка на промпте") - on the field itself, gone by itself.
function _toast(field, words, bad) {
  for (const old of document.querySelectorAll('.hp-toast')) old.remove();
  clearTimeout(_toastT);
  const t = el('div', 'hp-toast' + (bad ? ' is-bad' : ''), words);
  document.body.appendChild(t);
  const r = field && field.isConnected ? field.getBoundingClientRect() : null;
  if (r && r.width) {
    t.style.left = Math.round(Math.max(8, Math.min(innerWidth - t.offsetWidth - 8, r.left + 10))) + 'px';
    t.style.top = Math.round(Math.max(8, r.top + Math.min(r.height, 44) / 2 - t.offsetHeight / 2)) + 'px';
  } else {
    t.style.left = Math.round((innerWidth - t.offsetWidth) / 2) + 'px';
    t.style.top = Math.round(innerHeight - t.offsetHeight - 24) + 'px';
  }
  requestAnimationFrame(() => t.classList.add('on'));
  _toastT = setTimeout(() => { t.classList.remove('on'); setTimeout(() => t.remove(), 250); }, 2400);
}
