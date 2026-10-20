/* ═══════════════════════════════════════════════════════════════════════════
   MERGE v3 — "LIBRARY / captions": the preset tiles (phase K6c, 2026-10-03).

   While captions are picked on the timeline - a subtitle or text lane, one caption, several - the
   Library panel shows the 127 preset styles on the left and the settings of what is picked in the strip
   on the right (inspector.js). A press on a tile applies the preset to what is picked, at once and as one
   step to undo; the tile of the preset it wears is lit, and says `edited` when it was changed since.
   The tiles are always there when the window has room for them (phase S3, the owner 2026-10-05: the
   `presets` switch that folded them away is gone); a window too narrow shows the strip alone.

   A tile is a 2.5 s loop made by the SERVER with the render's own builder and ffmpeg
   (lib/caption-tiles.js) - what it shows is what the render draws: a dark square with the words in its
   middle (phase S1). Until it is made, the tile shows the preset's name in its own font and colour. The
   tiles are built ONCE and live outside the strip, which is rebuilt on every change: 127 animations
   rebuilt per press would be the page's whole evening.

   A TILE SHOWS ITS STILL, AND PLAYS ONLY UNDER THE CURSOR (phase V32, the owner 2026-10-20: every loop loaded at once, and
   slowly). The view asks for the stills alone - the frame at 0.3 s, made beside each loop (г1). The cursor on a tile asks for
   its loop (once; then kept) and plays it in the tile over the still, from its start every time (г2); the cursor gone, the
   loop finishes its round and the still comes back (г3) - back while it finishes, it plays on. The view hidden, another
   category or tab: the still at once.

   TWO TABS over them (phase V30, block 2, the owner's (с6), (с29)): `presets` - the tiles - and `text` - the words of the
   subtitle and text lanes as one document, in the tiles' place (caption-doc.js); the strip on the right stays. The tab
   last chosen is remembered.

   THE PERSON'S OWN (phase V30, block 5; the owner's (с13), (с45)-(с52)): `Mine` is the first category after All, and in All
   they stand first, newest first (с51); their tiles come and go with the list (my-presets.js) without the others being
   built again. A right-click on one opens Rename / Delete - deleted at once (с47); the app's tiles have no menu. An empty
   `Mine` says how to fill it.

   Which view shows, the header and the room are lib-views.js's; this only draws the tiles and the tabs.
   ═══════════════════════════════════════════════════════════════════════════ */

import { PRESETS, CATEGORIES } from '../captions/presets.js';
import { cssWeight } from '../captions/fonts.js';
import * as Doc from './caption-doc.js';
import * as MyPresets from './my-presets.js';
import * as Layers from '../layers.js';
import { askName } from '../name-box.js';
import { note } from './ask.js';

const LS_CAT = 'mv3_cap_cat_v1';
const LS_TAB = 'mv3_cap_tab_v1';
const TABS = [['presets', 'presets', 'The preset styles - a press applies one to what is picked'],
  ['text', 'text', 'The words of the subtitle and text lanes as one document - edit, cut and join lines, find and replace']];
const POLL_MS = 1500;
const MINE = 'mine';

// The `presets` switch's memory (K6), forgotten once - here and, through storage-sync, in ui-state.
try { if (localStorage.getItem('mv3_cap_tiles_v1') != null) localStorage.removeItem('mv3_cap_tiles_v1'); } catch (e) { /* a private window */ }

const _store = (k, fb) => { try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v == null ? fb : v; } catch (e) { return fb; } };
const _keep = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* a private window */ } };
const _el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

let _ui = null;
const _tiles = new Map();          // preset id -> { btn, box, ed, nm, ph, mine, img, over, loop, starting, end }
const _loops = new Map();          // a loop's address -> Promise<Blob>: asked at its first hover, then kept
const _counts = new Map();         // category ('' for All) -> its number on the chip
let _target = null;                // what show() was last told: the preset the pick wears
let _menu = null;
let _state = null;
let _timer = 0;
let _shown = false;
let _asked = false;
let _cat = _store(LS_CAT, '');
let _tab = _store(LS_TAB, 'presets') === 'text' ? 'text' : 'presets';
let _apply = null;
let _retries = 0;           // makes asked again for a set left incomplete (a restart, a make that could not start)
let _reading = false;

/** What a press on a tile does - the inspector knows what is picked. */
export function onApply(fn) { _apply = typeof fn === 'function' ? fn : null; }

function _build() {
  const host = document.getElementById('mv3-cap');
  if (!host || _ui) return;
  host.textContent = '';
  const top = _el('div', 'mv3-cap-top');
  const chips = _el('div', 'mv3-cap-cats');
  // `Mine` first after All (с51); its number and All's move with the person's list (_paintCounts).
  const all = [['', 'All', 0], [MINE, 'Mine', 0]].concat(CATEGORIES.map((c) => [c.id, c.label, PRESETS.filter((p) => p.category === c.id).length]));
  for (const [id, label, n] of all) {
    const b = _el('button', 'mv3-cap-cat', label);
    b.type = 'button';
    b.dataset.cat = id;
    const num = _el('span', 'mv3-cap-n', ' ' + n);
    b.appendChild(num);
    _counts.set(id, num);
    b.addEventListener('click', () => _setCat(id));
    chips.appendChild(b);
  }
  const status = _el('div', 'mv3-cap-status');
  top.appendChild(chips);
  top.appendChild(status);
  const tabs = _el('div', 'mv3-cap-tabs');
  tabs.setAttribute('role', 'tablist');
  for (const [id, label, title] of TABS) {
    const b = _el('button', 'mv3-cap-tab', label);
    b.type = 'button';
    b.dataset.tab = id;
    b.title = title;
    b.setAttribute('role', 'tab');
    b.addEventListener('click', () => _setTab(id));
    tabs.appendChild(b);
  }
  const grid = _el('div', 'mv3-cap-grid');
  // An empty `Mine` says how to fill it; the person's tiles go between it and the app's first (_syncMine).
  const empty = _el('div', 'mv3-cap-empty', 'Nothing here yet. Give a lane or a line the look you want in the settings on the right, '
    + 'then press "save as my preset" at their top - the look is kept here, to put on any lane or line.');
  empty.hidden = true;
  grid.appendChild(empty);
  for (const p of PRESETS) {
    const t = _tile(p, false);
    grid.appendChild(t.btn);
    _tiles.set(p.id, t);
  }
  const presets = _el('div', 'mv3-cap-pane');
  presets.append(top, grid);
  const text = _el('div', 'mv3-cap-pane');
  host.append(tabs, presets, text);
  Doc.mount(text);
  _ui = { host, tabs, presets, text, top, chips, status, grid, empty, firstApp: grid.children[1] || null };
  _syncMine();
  _paintCat();
  _paintTab();
}

// One tile: the still when it is made (the loop under the cursor), until then the name in the preset's own font and colour.
function _tile(p, mine) {
  const btn = _el('button', 'mv3-cap-tile');
  btn.type = 'button';
  btn.dataset.id = p.id;
  btn.dataset.cat = mine ? MINE : p.category;
  btn.title = _title(p.name, mine);
  const box = _el('div', 'mv3-cap-box');
  const ph = _el('span', 'mv3-cap-ph', p.name);
  const s = p.style || {};
  ph.style.fontFamily = '"' + s.font + '", "Liberation Sans", sans-serif';
  ph.style.fontWeight = String(cssWeight(s.font, s.bold));
  ph.style.color = s.primary || '#ffffff';
  if (s.casing === 'upper') ph.style.textTransform = 'uppercase';
  box.appendChild(ph);
  const name = _el('div', 'mv3-cap-name');
  const nm = _el('span', 'mv3-cap-nm', p.name);
  name.appendChild(nm);
  const ed = _el('span', 'mv3-cap-ed', 'edited');
  ed.hidden = true;
  name.appendChild(ed);
  btn.appendChild(box);
  btn.appendChild(name);
  const t = { btn, box, ed, nm, ph, mine };
  btn.addEventListener('click', () => { if (_apply) _apply(p.id); });
  btn.addEventListener('pointerenter', () => _enter(t));
  btn.addEventListener('pointerleave', () => _leave(t));
  if (mine) btn.addEventListener('contextmenu', (e) => { e.preventDefault(); _openMenu(e, p.id, btn); });
  return t;
}

// ── The loop under the cursor (phase V32; the owner's (г2), (г3)) ──────────
// Played from a fresh blob address each time: the same address would go on from the frame it was left at.
function _loopOf(url) {
  let p = _loops.get(url);
  if (!p) {
    p = fetch(url).then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.blob(); });
    p.catch(() => _loops.delete(url));                // not got: the next hover asks again
    _loops.set(url, p);
  }
  return p;
}

async function _enter(t) {
  t.over = true;
  if (t.end) { clearTimeout(t.end); t.end = 0; }      // back while it finishes its round: it plays on
  if (t.loop || t.starting || !t.img || !_state || _tab !== 'presets') return;
  t.starting = true;
  let url = null;
  try {
    url = URL.createObjectURL(await _loopOf(_state.base + encodeURIComponent(t.btn.dataset.id) + '.webp'));
    const img = new Image();
    img.className = 'mv3-cap-img';
    img.alt = '';
    img.draggable = false;
    img.src = url;
    await img.decode();
    // Left before it could start - the cursor, the view, the tile: nothing is shown, the still stays.
    if (!t.over || !_shown || !t.btn.isConnected || t.btn.hidden) return;
    t.box.appendChild(img);
    t.loop = { img, url, since: performance.now() };
    url = null;
    // Its round is counted from the frame it is first painted in.
    requestAnimationFrame(() => { if (t.loop && t.loop.img === img) t.loop.since = performance.now(); });
  } catch (e) {
    /* the loop could not be had: the still stays */
  } finally {
    t.starting = false;
    if (url) URL.revokeObjectURL(url);
  }
}

// The cursor gone: the loop plays to the end of its round, then the still (г3) - a little early rather than late, where the
// next round's first frame would flash (empty, for a fade).
function _leave(t) {
  t.over = false;
  if (!t.loop || t.end) return;
  const round = ((_state && _state.loop) || 2.5) * 1000;
  const left = round - ((performance.now() - t.loop.since) % round);
  t.end = setTimeout(() => { t.end = 0; _stop(t); }, Math.max(0, left - 40));
}

function _stop(t) {
  if (t.end) { clearTimeout(t.end); t.end = 0; }
  if (!t.loop) return;
  t.loop.img.remove();
  URL.revokeObjectURL(t.loop.url);
  t.loop = null;
}

// The still at once, without finishing the round: the view hidden, another tab, a tile hidden or gone.
function _stopNow(t) {
  t.over = false;
  _stop(t);
}
const _title = (name, mine) => name + ' - apply to what is picked' + (mine ? '. Right-click to rename or delete it' : '');

// THE PERSON'S TILES follow their list: a deleted one goes, a new one comes, a renamed one says its new name - newest
// first, before the app's. The 131 are not touched.
function _syncMine() {
  if (!_ui) return;
  const list = MyPresets.list();
  const want = new Set(list.map((p) => p.id));
  for (const [id, t] of [..._tiles]) if (t.mine && !want.has(id)) { _stopNow(t); t.btn.remove(); _tiles.delete(id); }
  for (const p of list) {
    let t = _tiles.get(p.id);
    if (!t) { t = _tile(p, true); _tiles.set(p.id, t); }
    else if (t.nm.textContent !== p.name) {
      t.nm.textContent = p.name;
      t.ph.textContent = p.name;
      t.btn.title = _title(p.name, true);
    }
    _ui.grid.insertBefore(t.btn, _ui.firstApp);
  }
  _paintCounts();
  _paintCat();
  _light();
  _paintState();
}

function _paintCounts() {
  const n = MyPresets.list().length;
  if (_counts.has('')) _counts.get('').textContent = ' ' + (PRESETS.length + n);
  if (_counts.has(MINE)) _counts.get(MINE).textContent = ' ' + n;
}

// The tile of the preset the pick wears is lit, and says `edited` when it was changed since.
function _light() {
  const t = _target || {};
  for (const [id, x] of _tiles) {
    const on = !!t.preset && id === t.preset;
    x.btn.classList.toggle('is-on', on);
    x.ed.hidden = !(on && t.edited);
  }
}

// ── The person's tile's menu: Rename / Delete (с47 - at once) ───────────────
function _closeMenu() {
  if (!_menu) return;
  _menu.el.remove();
  document.removeEventListener('mousedown', _menu.away, true);
  window.removeEventListener('scroll', _closeMenu, true);
  Layers.close(_menu.layer);
  _menu = null;
}

function _openMenu(ev, id, tile) {
  _closeMenu();
  const p = MyPresets.byId(id);
  if (!p) return;
  const el = _el('div', 'mv3-plus-menu');
  const item = (label, sub, on, danger) => {
    const b = _el('button', 'mv3-plus-item' + (danger ? ' is-danger' : ''));
    b.type = 'button';
    b.appendChild(_el('span', null, label));
    if (sub) b.appendChild(_el('small', null, sub));
    b.addEventListener('click', (e) => { e.stopPropagation(); _closeMenu(); on(); });
    el.appendChild(b);
  };
  // Anchored on the TILE: the menu is gone by the time these run.
  item('Rename', p.name, () => _rename(p, tile));
  item('Delete', 'at once - lanes and lines that wear it keep their look', () => _delete(p, tile), true);
  document.body.appendChild(el);
  const w = el.offsetWidth, h = el.offsetHeight;
  el.style.left = Math.round(Math.max(6, Math.min(window.innerWidth - w - 6, ev.clientX))) + 'px';
  el.style.top = Math.round(Math.max(6, Math.min(window.innerHeight - h - 6, ev.clientY))) + 'px';
  const away = (e) => { if (!el.contains(e.target)) _closeMenu(); };
  const layer = Layers.open(el, { modal: false, name: 'preset menu', onEsc: _closeMenu });
  _menu = { el, away, layer };
  // On the next tick: this very right-click is still travelling, and it would close the menu it just opened.
  setTimeout(() => { if (_menu && _menu.el === el) document.addEventListener('mousedown', away, true); }, 0);
  window.addEventListener('scroll', _closeMenu, true);
}

function _rename(p, tile) {
  // A taken name is refused in the window, in the server's words (с45); the same name is no change.
  return askName({
    anchor: tile, title: 'Rename preset', value: p.name, okLabel: 'Rename', maxLength: 60,
    submit: (name) => (name === p.name ? null : MyPresets.rename(p.id, name)),
  });
}

async function _delete(p, tile) {
  try { await MyPresets.remove(p.id); } catch (e) { if (tile.isConnected) note(tile, 'The preset was not deleted.', e.message); }
}

/**
 * A preset just saved from the strip, shown: `Mine` when another category hides it, scrolled to and marked for a moment.
 * The tab is left as it is - the person may be in the text.
 */
export function showMine(id) {
  const t = _tiles.get(id);
  if (!_ui || !t) return;
  if (_cat && _cat !== MINE) _setCat(MINE);
  if (_tab !== 'presets') return;
  t.btn.classList.add('is-new');
  setTimeout(() => t.btn.classList.remove('is-new'), 2000);
  if (t.btn.scrollIntoView) t.btn.scrollIntoView({ block: 'nearest' });
}

function _setTab(id) {
  _tab = id === 'text' ? 'text' : 'presets';
  _keep(LS_TAB, _tab);
  _paintTab();
  Doc.setShown(_shown && _tab === 'text');
  if (_tab === 'presets') revealLit();
  else for (const t of _tiles.values()) _stopNow(t);
}

function _paintTab() {
  if (!_ui) return;
  for (const b of _ui.tabs.children) {
    const on = b.dataset.tab === _tab;
    b.classList.toggle('is-on', on);
    b.setAttribute('aria-selected', on ? 'true' : 'false');
  }
  _ui.presets.hidden = _tab !== 'presets';
  _ui.text.hidden = _tab !== 'text';
}

function _setCat(id) {
  _cat = id || '';
  _keep(LS_CAT, _cat);
  _paintCat();
  // The category looked at is made first.
  if (_state && _state.making && _cat) _read(true);
}

function _paintCat() {
  if (!_ui) return;
  for (const b of _ui.chips.children) b.classList.toggle('is-on', (b.dataset.cat || '') === _cat);
  for (const t of _tiles.values()) {
    t.btn.hidden = !!_cat && t.btn.dataset.cat !== _cat;
    if (t.btn.hidden) _stopNow(t);
  }
  _ui.empty.hidden = !(_cat === MINE && !MyPresets.list().length);
}

function _paintState() {
  if (!_ui || !_state) return;
  for (const id of (_state.ready || [])) {
    const t = _tiles.get(id);
    if (!t || t.img) continue;
    const img = new Image();
    img.className = 'mv3-cap-img';
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.draggable = false;
    img.addEventListener('load', () => t.box.classList.add('is-ready'));
    // The still (phase V32); the loop is asked for under the cursor (_enter).
    img.src = _state.base + encodeURIComponent(id) + (_state.still || '.first.webp');
    t.box.appendChild(img);
    t.img = img;
  }
  const n = (_state.ready || []).length;
  _ui.status.textContent = _state.making ? 'making the previews ' + n + '/' + _state.total + (_state.waiting ? ' - waiting for the render' : '')
    : _state.error ? 'the previews could not be made (' + _state.error + ') - the styles still apply'
    : (_state.failed || []).length ? (_state.failed.length + ' previews could not be made - the styles still apply')
    : _incomplete(_state) ? 'previews ' + n + '/' + _state.total : '';
  _ui.status.hidden = !_ui.status.textContent;
}

// A set the server is not making and has not finished: a make lost to a restart, or one that could not start.
const _incomplete = (s) => !!s && !s.making && ((s.ready || []).length + (s.failed || []).length) < s.total;

async function _read(make) {
  if (_timer) { clearTimeout(_timer); _timer = 0; }
  // One read at a time: a repaint during a read used to start a second chain of reads (review K6).
  if (_reading) return;
  _reading = true;
  let d = null;
  try {
    d = make
      ? await fetch('/api/mv3/captions/tiles/make', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ first: _cat || null }) }).then((r) => r.json())
      : await fetch('/api/mv3/captions/tiles').then((r) => r.json());
  } catch (e) { d = null; }
  _reading = false;
  if (d && d.success) { _state = d; _paintState(); }
  if (!d && make) _asked = false;                     // the make never reached the server: the next show asks again
  if (d && (d.making || !_incomplete(d))) _retries = 0;
  // Asked again, a few times and further apart, when the set is incomplete and nothing is making it (review K6:
  // after a server restart the page stopped asking, and the rest of the tiles stayed names).
  if (_shown && d && d.success && _incomplete(d) && _retries < 3) {
    _retries++;
    _timer = setTimeout(() => { _timer = 0; if (_shown) _read(true); }, 2000 * Math.pow(2, _retries));
  } else if (_shown && (!d || d.making)) _timer = setTimeout(() => { _timer = 0; if (_shown) _read(false); }, POLL_MS);
}

/**
 * The view is up for what is picked: `preset` - the id it wears ('' for none), `edited` - changed since.
 * Cheap and safe to call on every repaint.
 */
export function show(target) {
  _build();
  if (!_ui) return;
  _shown = true;
  const t = target || {};
  _target = t;
  _light();
  _ui.host.classList.toggle('is-ro', !!t.readOnly);
  Doc.setShown(_tab === 'text');
  if (!_asked) { _asked = true; _read(true); }
  else if (_state && (_state.making || _incomplete(_state)) && !_timer && !_reading) _read(!_state.making);
}

export function hide() {
  _shown = false;
  _closeMenu();
  for (const t of _tiles.values()) _stopNow(t);
  Doc.setShown(false);
  if (_timer) { clearTimeout(_timer); _timer = 0; }
}

/** The lit tile brought into view - when the view comes up on a pick that wears a preset. */
export function revealLit() {
  if (!_ui || _tab !== 'presets') return;
  const lit = _ui.grid.querySelector('.mv3-cap-tile.is-on:not([hidden])');
  if (lit && lit.scrollIntoView) lit.scrollIntoView({ block: 'nearest' });
}

// The person's list changed (saved, renamed, deleted): their tiles follow, and the set is asked again - the server makes a
// new one's tile first (lib/caption-tiles.js mineChanged).
MyPresets.onChange(() => {
  if (!_ui) return;
  _syncMine();
  if (_shown) _read(true);
  else _asked = false;
});
