/* ════════════════════════════════════════════════════════════════════════════
   MERGE — a chat's PICKER of attachments (phase V13, the owner 2026-10-07; docs/local-app/PLAN.md "Фаза V13").

   The video chat has no right column: every "+" of its attachment zone opens this window for ONE place - a part
   of the zone (pictures | clips | sounds) and, with a recipe, its slot - and it shows only that kind:

     left    where it comes from - the Library's shelves of that kind, as the chat's description lists them - and
             "from this computer": files of this kind through the chat's own door, and every file let go over the
             window; each is filed under the project's category and goes straight into this place
     centre  a search by name, the categories of a shelf that has them (the project's own first), and the tiles:
             pictures at their own shape with a larger look while the pointer rests on one, clips as posters that
             play in their tile (▶ with the sound), sounds as rows to listen to

   A press puts the thing into the place the window was opened for (the shell keeps that slot armed while it is
   open), a second press takes it back off, and what is in the zone already wears the name of its place. The window
   stays open while the place has room and closes by itself when it has none (the owner's answer 2); Escape, the
   cross, `done` and a press beside it close it too. It is as big as the catalog (the owner's answer 3).

   It knows nothing of the chat: the shell opens it with what to show and what a press does (`openPick`), tells it
   when the zone changed (`pickChanged`) and what the chat has to say (`pickSay`).
   ════════════════════════════════════════════════════════════════════════════ */

import * as Layers from '../layers.js';
import { hoverPlayer } from './hover-play.js';

const PAGE = 120;                 // tiles drawn at once - the next ones as the grid is scrolled to its end
const LS_SRC = 'mv3_vpick_v1';    // { <kind>: <source id> } - where each kind was last taken from
const ALL = '';                   // the category "all"
const UNCAT = '__uncat__';        // routes/library.js: what has no category

let _w = null;                    // the open window
let _o = null;                    // what it was opened with
let _st = null;                   // what it shows
let _seq = 0;                     // a source read that is not the newest is dropped
const _cache = new Map();         // source id -> { items, cats, why } for one opening
const _catMemo = new Map();       // '<project>|<source>' -> the category last shown there, for the page's life
const _hp = hoverPlayer('pk-vid');
let _sound = null;                // { path, audio, btn } - the one sound being listened to

const _lc = (s) => String(s || '').trim().toLowerCase();
const _secs = (v) => (+v).toFixed(1).replace(/\.0$/, '') + ' s';
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
const _ar = (a) => { const p = String(a || '').split(':'); const v = (+p[0] || 0) / (+p[1] || 0); return v > 0 && isFinite(v) ? v : 0; };
function _stored() { try { return JSON.parse(localStorage.getItem(LS_SRC) || '') || {}; } catch (e) { return {}; } }
function _keep(v) { try { localStorage.setItem(LS_SRC, JSON.stringify(v)); } catch (e) { /* a private window */ } }

/**
 * Opens the picker on one place. `o`:
 *   kind      'image' | 'video' | 'audio'
 *   title     what is filled ("pictures · person"), `hint` the slot's own words
 *   project   { key, title } - the project's own category is shown first
 *   sources   [{ id, label, load() -> Promise<{ items, cats?, why? }>, empty? }]; an item is
 *             { path, name, sub?, cat?, thumb?, big?, poster?, aspect?, dur?, src? }
 *   start     the source to open on ('' - the one this kind was last taken from, else `first`)
 *   select    (phase V15) { srcs, path } - opened on a thing in the zone: the first of `srcs` that holds it is shown,
 *             in its category, the thing in view
 *   left()    how many more go into the place; mark(path) what it is in the zone ('' - not in it); room() the words
 *             of the place, when it is one that is there ('' - "N more go here")
 *   press(it) attach it, or take it off; why(it) why it cannot go ('' - it can)
 *   computer  { word, hint, open(), accepts(file), drop(files), lands } - `lands` is the source a file goes to
 *   link      (phase V27) { hint, add(url) -> Promise<words ('' - in its place)> } - a clip by a link; absent, no field
 *   onClose()
 */
export function openPick(o) {
  closePick();
  _o = o;
  _cache.clear();
  const last = _stored()[o.kind];
  const has = (id) => !!id && o.sources.some(s => s.id === id);
  const sel = o.select && o.select.path ? { path: o.select.path, srcs: (o.select.srcs || []).filter(has) } : null;
  const src = sel && sel.srcs.length ? sel.srcs[0] : has(o.start) ? o.start : has(last) ? last : has(o.first) ? o.first : (o.sources[0] || {}).id;
  _st = { src, cat: ALL, q: '', items: [], cats: [], why: '', list: [], drawn: 0, loading: false, sel: sel && sel.srcs.length ? sel : null };
  _build();
  _paintHead();
  _paintSources();
  _load();
  setTimeout(() => { if (_w) _w.q.focus(); }, 0);
}

export function closePick() {
  if (!_w) return;
  const o = _o;
  _hp.stop();
  _quiet();
  _peekHide();
  if (_w.io) _w.io.disconnect();
  clearTimeout(_w.shut);
  Layers.close(_w.layer);
  _w.ov.remove();
  _w = null;
  _o = null;
  _st = null;
  if (o && typeof o.onClose === 'function') o.onClose();
}

/** The zone changed: the marks and the room follow - and a place with no room left closes the window. */
export function pickChanged() {
  if (!_w) return;
  _paintHead();
  for (const t of _w.grid.querySelectorAll('[data-path]')) _paintMark(t, t.dataset.path);
  if (_o.left() <= 0) {
    clearTimeout(_w.shut);
    // A moment to see the mark land.
    _w.shut = setTimeout(() => { if (_w && _o.left() <= 0) closePick(); }, 180);
  }
}

/** What the chat has to say while the window is open - an upload, a part that goes, why something was not taken. */
export function pickSay(t) {
  if (_w) _w.said.textContent = t || '';
}

/** A file came in through the door of this kind: its shelf is read again. */
export function pickRefresh(sourceId) {
  if (!_w) return;
  _cache.delete(sourceId);
  if (_st.src === sourceId) _load(true);
}

// ── The window ──────────────────────────────────────────────────────────────
function _build() {
  const ov = el('div', 'pk-ov');
  const box = el('div', 'pk');
  const head = el('div', 'pk-head');
  const h = el('h3', null, '');
  const hint = el('span', 'pk-hint', '');
  const left = el('span', 'pk-room', '');
  const x = el('button', 'pk-close', '✕');
  x.type = 'button';
  x.title = 'Close (Esc)';
  head.append(h, hint, left, x);

  const side = el('div', 'pk-side');
  const main = el('div', 'pk-main');
  const bar = el('div', 'pk-bar');
  const q = document.createElement('input');
  q.type = 'search';
  q.className = 'pk-q';
  q.placeholder = 'search by name';
  q.spellcheck = false;
  const cat = document.createElement('select');
  cat.className = 'pk-cat';
  cat.title = 'A folder of this shelf';
  const count = el('span', 'pk-count', '');
  bar.append(q, cat, count);
  const grid = el('div', 'pk-grid');
  // NO MENU ON A TILE (phase V23, as on the Library's shelves, V13.1): the window's own "Save image as" would save the
  // miniature, not the file. The hover's video and the sound rows are tiles too.
  grid.addEventListener('contextmenu', (e) => { if (e.target.closest && e.target.closest('.pk-tile')) e.preventDefault(); });
  main.append(bar, grid);
  const body = el('div', 'pk-body');
  body.append(side, main);

  const foot = el('div', 'pk-foot');
  const said = el('span', 'pk-said', '');
  const done = el('button', 'mv3-c-btn pk-done', 'done');
  done.type = 'button';
  foot.append(said, done);

  const drop = el('div', 'pk-drop', '');
  box.append(head, body, foot, drop);
  ov.appendChild(box);
  document.body.appendChild(ov);

  const layer = Layers.open(ov, { name: 'attachment picker', onEsc: closePick });
  x.addEventListener('click', closePick);
  done.addEventListener('click', closePick);
  ov.addEventListener('mousedown', (e) => { if (e.target === ov) closePick(); });
  q.addEventListener('input', () => { _st.q = q.value; _paintGrid(); });
  cat.addEventListener('change', () => {
    _st.cat = cat.value;
    _catMemo.set(_memoKey(), _st.cat);
    _paintGrid();
  });
  grid.addEventListener('scroll', _peekHide, { passive: true });

  // Files let go anywhere over the window come in through the door of this kind - and only there: the Library
  // panel's own drop is under the window and must never file them a second time.
  const files = (e) => [...((e.dataTransfer && e.dataTransfer.types) || [])].includes('Files');
  let depth = 0;
  ov.addEventListener('dragenter', (e) => { if (!files(e)) return; e.preventDefault(); depth++; box.classList.add('is-drop'); });
  ov.addEventListener('dragleave', (e) => { if (!files(e)) return; depth = Math.max(0, depth - 1); if (!depth) box.classList.remove('is-drop'); });
  ov.addEventListener('dragover', (e) => {
    if (!files(e)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
  });
  ov.addEventListener('drop', (e) => {
    if (!files(e)) return;
    e.preventDefault();
    e.stopPropagation();
    depth = 0;
    box.classList.remove('is-drop');
    const all = [...((e.dataTransfer && e.dataTransfer.files) || [])];
    const mine = all.filter(f => _o.computer.accepts(f));
    if (!mine.length) { pickSay('Only ' + _o.computer.word + ' here.'); return; }
    _o.computer.drop(mine);
  });

  _w = { ov, box, h, hint, left, side, q, cat, count, grid, said, drop, layer, io: null, shut: 0, sentinel: null };
  drop.textContent = 'Let go to add ' + (_o.computer.word || 'them') + ' from this computer';
}

function _paintHead() {
  const o = _o;
  _w.h.textContent = o.title;
  _w.hint.textContent = o.hint || '';
  _w.hint.title = o.hint || '';
  const n = Math.max(0, o.left());
  const words = typeof o.room === 'function' ? o.room() : '';
  _w.left.textContent = words || (n ? (n === 1 ? 'one more goes here' : n + ' more go here') : 'no room left');
}

function _paintSources() {
  const S = _w.side;
  S.textContent = '';
  S.appendChild(el('div', 'pk-lab', 'from the library'));
  for (const s of _o.sources) {
    const b = el('button', 'pk-src' + (s.id === _st.src ? ' on' : ''), s.label);
    b.type = 'button';
    b.addEventListener('click', () => {
      if (_st.src === s.id) return;
      _st.src = s.id;
      const m = _stored();
      m[_o.kind] = s.id;
      _keep(m);
      _paintSources();
      _load();
    });
    S.appendChild(b);
  }
  const c = _o.computer;
  S.appendChild(el('div', 'pk-lab', 'from this computer'));
  const up = el('button', 'pk-src is-up', '+ choose ' + (c.word || 'files') + '…');
  up.type = 'button';
  up.addEventListener('click', () => c.open());
  S.appendChild(up);
  S.appendChild(el('div', 'pk-up-note', (c.hint ? c.hint + ' ' : '') + 'Or let files go anywhere over this window.'));
  // (phase V27) A clip by a link, where the description takes one (`link`): the server downloads it and it goes into
  // this place - the place says how far meanwhile.
  const L = _o.link;
  if (!L) return;
  S.appendChild(el('div', 'pk-lab', 'from a link'));
  const row = el('div', 'pk-link');
  const inp = document.createElement('input');
  inp.type = 'text';
  inp.placeholder = 'YouTube, TikTok, Instagram…';
  const b = el('button', 'pk-link-go', 'add');
  b.type = 'button';
  row.appendChild(inp);
  row.appendChild(b);
  S.appendChild(row);
  const said = el('div', 'pk-up-note', L.hint || '');
  S.appendChild(said);
  const go = async () => {
    const url = inp.value.trim();
    if (!/^https?:\/\/\S+$/i.test(url)) { said.textContent = 'That is not a link.'; return; }
    inp.value = '';
    b.disabled = true;
    said.textContent = 'Coming in - its place says how far.';
    const why = await L.add(url);
    if (!_w || !said.isConnected) return;
    b.disabled = false;
    said.textContent = why || 'In, and in its place.';
  };
  b.addEventListener('click', go);
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
}

const _memoKey = () => (_o.project.key || '') + '|' + _st.src;

// ── A source ────────────────────────────────────────────────────────────────
async function _load(keepCat) {
  const mine = ++_seq;
  const s = _o.sources.find(x => x.id === _st.src);
  if (!s) return;
  _hp.stop();
  _quiet();
  _peekHide();
  let got = _cache.get(s.id);
  if (!got) {
    _st.loading = true;
    _paintGrid();
    try { got = await s.load(); } catch (e) { got = null; }
    if (!_w || mine !== _seq) return;
    _st.loading = false;
    got = got || { items: [], cats: [], why: 'it could not be read' };
    _cache.set(s.id, got);
  }
  _st.items = got.items || [];
  _st.cats = (got.cats || []).filter(c => c && c.id && (+c.count > 0 || c.id === _st.cat));
  _st.why = got.why || '';
  // (phase V15) Opened on a thing in the zone: on its shelf - the next that may hold it when this one does not -, in its
  // category, the thing in view.
  let it = null;
  if (_st.sel) {
    it = _st.items.find(x => x.path === _st.sel.path) || null;
    if (!it) {
      const next = _st.sel.srcs[_st.sel.srcs.indexOf(_st.src) + 1];
      if (next) { _st.src = next; _paintSources(); _load(); return; }
      _st.sel = null;
    }
  }
  if (it) _st.cat = it.cat && _st.cats.some(c => c.id === it.cat) ? it.cat : ALL;
  else if (!keepCat) {
    // The category last shown here in this project, else the project's own, else all of them.
    const was = _catMemo.get(_memoKey());
    const own = _st.cats.find(c => c.id !== UNCAT && _lc(c.name) === _lc(_o.project.title));
    _st.cat = (was != null && (was === ALL || _st.cats.some(c => c.id === was))) ? was : own ? own.id : ALL;
  } else if (_st.cat !== ALL && !_st.cats.some(c => c.id === _st.cat)) _st.cat = ALL;
  _paintCats();
  _paintGrid();
  if (it) { _st.sel = null; _reveal(it.path); }
}

// The thing the window was opened on: drawn, in view, blinking once.
function _reveal(path) {
  if (!_w) return;
  const i = _st.list.findIndex(x => x.path === path);
  if (i < 0) return;
  while (_st.drawn <= i) _more();
  const t = [..._w.grid.querySelectorAll('[data-path]')].find(x => x.dataset.path === path);
  if (!t) return;
  t.classList.add('is-sel');
  requestAnimationFrame(() => { if (t.isConnected) t.scrollIntoView({ block: 'center', inline: 'nearest' }); });
  setTimeout(() => t.classList.remove('is-sel'), 1600);
}

function _paintCats() {
  const sel = _w.cat;
  sel.textContent = '';
  sel.hidden = !_st.cats.length;
  if (!_st.cats.length) return;
  const opt = (v, t) => { const e = document.createElement('option'); e.value = v; e.textContent = t; return e; };
  sel.appendChild(opt(ALL, 'all · ' + _st.items.length));
  for (const c of _st.cats) sel.appendChild(opt(c.id, c.label || c.name || c.id));
  sel.value = _st.cat;
}

function _shown() {
  const q = _lc(_st.q);
  return _st.items.filter(it => {
    if (_st.cat !== ALL && (_st.cat === UNCAT ? !!it.cat : it.cat !== _st.cat)) return false;
    return !q || _lc(it.name).includes(q) || _lc(it.sub).includes(q);
  });
}

// ── The tiles ───────────────────────────────────────────────────────────────
function _paintGrid() {
  if (!_w) return;
  const G = _w.grid;
  _hp.stop();
  _quiet();
  _peekHide();
  if (_w.io) { _w.io.disconnect(); _w.io = null; }
  G.textContent = '';
  G.scrollTop = 0;
  G.classList.toggle('is-rows', _o.kind === 'audio');
  if (_st.loading) { G.appendChild(el('div', 'pk-none', 'reading…')); _w.count.textContent = ''; return; }
  _st.list = _shown();
  _st.drawn = 0;
  _w.count.textContent = _st.list.length === _st.items.length ? String(_st.items.length) : _st.list.length + ' of ' + _st.items.length;
  if (!_st.list.length) {
    const src = _o.sources.find(x => x.id === _st.src) || {};
    G.appendChild(el('div', 'pk-none', _st.items.length ? (_st.q ? 'Nothing here is called “' + _st.q.trim() + '”.' : 'Nothing in this folder.')
      : (_st.why || src.empty || 'Nothing on this shelf.')));
    return;
  }
  _more();
}

// The next portion, and a watch on the grid's end for the one after it.
function _more() {
  const G = _w.grid;
  if (_w.sentinel) _w.sentinel.remove();
  const end = Math.min(_st.list.length, _st.drawn + PAGE);
  for (let i = _st.drawn; i < end; i++) G.appendChild(_o.kind === 'audio' ? _soundRow(_st.list[i]) : _tile(_st.list[i]));
  _st.drawn = end;
  if (end >= _st.list.length) return;
  const s = el('div', 'pk-sentinel');
  G.appendChild(s);
  _w.sentinel = s;
  if (!_w.io) {
    _w.io = new IntersectionObserver((es) => { if (_w && es.some(e => e.isIntersecting)) _more(); }, { root: G, rootMargin: '400px' });
  }
  _w.io.observe(s);
}

function _paintMark(t, path) {
  const m = _o.mark(path);
  t.classList.toggle('is-on', !!m);
  let b = t.querySelector('.pk-mark');
  if (m) {
    if (!b) { b = el('span', 'pk-mark'); (t.querySelector('.pk-box') || t).appendChild(b); }
    b.textContent = m;
  } else if (b) b.remove();
}

// The line under a name - a look's character, a shelf's category; not the category the dropdown has chosen already.
const _subOf = (it) => (it.sub && !(_st.cat !== ALL && it.cat === _st.cat) ? it.sub : '');

// A press: in, or back out. One that cannot go says why and stays as it is.
function _press(it) {
  _peekHide();
  const on = !!_o.mark(it.path);
  // The place filled a moment ago and the window is about to close: a second press goes nowhere else.
  const why = on ? '' : _o.left() <= 0 ? 'No room left here.' : _o.why(it);
  if (why) { pickSay(why); return; }
  pickSay('');
  _o.press(it);
}

// A picture or a clip: its box at its own shape (a fixed height, the width its shape's), the name under it.
function _tile(it) {
  const t = el('div', 'pk-tile');
  t.dataset.path = it.path;
  const hit = el('button', 'pk-hit');
  hit.type = 'button';
  hit.title = it.name + (it.sub ? ' · ' + it.sub : '');
  const box = el('span', 'pk-box');
  const known = _ar(it.aspect);
  // On the tile, so the name under the box is cut to the box's width rather than widening it.
  t.style.setProperty('--ar', String(known || (_o.kind === 'video' ? 9 / 16 : 0.75)));
  const src = it.thumb || '';
  if (src) {
    const img = document.createElement('img');
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    // A shape nobody wrote down is the picture's own, once it has loaded.
    if (!known) img.addEventListener('load', () => { if (img.naturalWidth && img.naturalHeight) t.style.setProperty('--ar', String(img.naturalWidth / img.naturalHeight)); }, { once: true });
    img.addEventListener('error', () => { img.remove(); box.classList.add('is-blank'); }, { once: true });
    img.src = src;
    box.appendChild(img);
  } else box.classList.add('is-blank');
  if (it.dur) box.appendChild(el('span', 'pk-dur', _secs(it.dur)));
  hit.appendChild(box);
  t.appendChild(hit);
  t.appendChild(el('span', 'pk-cap', it.name || ''));
  if (_subOf(it)) t.appendChild(el('span', 'pk-sub', _subOf(it)));
  const why = _o.why(it);
  if (why) { t.classList.add('is-off'); t.appendChild(el('span', 'pk-why', why)); hit.title += ' - ' + why; }
  hit.addEventListener('click', () => _press(it));
  if (_o.kind === 'video' && it.src) {
    // The clip plays in its tile while the pointer rests there; ▶ plays it at once with its sound.
    t.addEventListener('pointerenter', () => _hp.on(t, box, it.src));
    t.addEventListener('pointerleave', () => _hp.off(t));
    const play = el('button', 'pk-play', '▶');
    play.type = 'button';
    play.title = 'Play it with its sound';
    play.addEventListener('click', () => {
      if (_hp.loud(t)) { _hp.stop(); play.textContent = '▶'; return; }
      for (const p of _w.grid.querySelectorAll('.pk-play')) p.textContent = '▶';
      _quiet();
      _hp.on(t, box, it.src, { loud: true });
      play.textContent = '■';
    });
    t.appendChild(play);
  } else if (it.big) {
    hit.addEventListener('pointerenter', () => _peekShow(it.big, t));
    hit.addEventListener('pointerleave', _peekHide);
  }
  _paintMark(t, it.path);
  return t;
}

// A sound: a row with its name, its shelf's category, its length, ▶ to listen.
function _soundRow(it) {
  const t = el('div', 'pk-tile is-sound');
  t.dataset.path = it.path;
  const hit = el('button', 'pk-hit');
  hit.type = 'button';
  hit.title = it.name || '';
  const box = el('span', 'pk-box');
  box.appendChild(el('span', 'pk-note', '♪'));
  const words = el('span', 'pk-snd');
  words.appendChild(el('span', 'pk-cap', it.name || 'sound'));
  if (_subOf(it)) words.appendChild(el('span', 'pk-sub', _subOf(it)));
  box.appendChild(words);
  if (it.dur) box.appendChild(el('span', 'pk-dur', _secs(it.dur)));
  hit.appendChild(box);
  t.appendChild(hit);
  const why = _o.why(it);
  if (why) { t.classList.add('is-off'); t.appendChild(el('span', 'pk-why', why)); hit.title += ' - ' + why; }
  hit.addEventListener('click', () => _press(it));
  const play = el('button', 'pk-play', '▶');
  play.type = 'button';
  play.title = 'Listen';
  play.addEventListener('click', () => {
    if (_sound && _sound.path === it.path) { _quiet(); return; }
    _quiet();
    _hp.stop();
    const audio = new Audio(it.src || it.path);
    _sound = { path: it.path, audio, btn: play };
    play.textContent = '■';
    const back = () => { if (_sound && _sound.audio === audio) { _sound = null; play.textContent = '▶'; } };
    audio.addEventListener('ended', back, { once: true });
    audio.addEventListener('error', back, { once: true });
    audio.play().catch(back);
  });
  t.appendChild(play);
  _paintMark(t, it.path);
  return t;
}

// The sound being listened to stops.
function _quiet() {
  const s = _sound;
  if (!s) return;
  _sound = null;
  try { s.audio.pause(); } catch (e) { /* gone */ }
  if (s.btn) s.btn.textContent = '▶';
}

// ── The larger look at a picture ────────────────────────────────────────────
// Over the half of the window away from the tile, so it never covers what the pointer is on.
let _peek = null;
function _peekShow(src, tile) {
  _peekHide();
  if (!_w) return;
  const g = _w.grid.getBoundingClientRect();
  const r = tile.getBoundingClientRect();
  const box = el('div', 'pk-peek');
  const img = document.createElement('img');
  img.src = src;
  box.appendChild(img);
  // The box is the picture's own size within these - a tall one is not framed in a wide box.
  const w = Math.max(160, Math.min(560, g.width / 2 - 24));
  const h = Math.max(160, g.height - 24);
  img.style.maxWidth = (w - 12) + 'px';
  img.style.maxHeight = (h - 12) + 'px';
  const leftHalf = (r.left + r.width / 2) < (g.left + g.width / 2);
  if (leftHalf) box.style.right = Math.round(window.innerWidth - g.right + 12) + 'px';
  else box.style.left = Math.round(g.left + 12) + 'px';
  box.style.top = Math.round(g.top + 12) + 'px';
  document.body.appendChild(box);
  _peek = box;
}
function _peekHide() {
  if (_peek) { _peek.remove(); _peek = null; }
}
