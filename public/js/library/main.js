// LIBRARY — shelves, filters and the character/looks split.
//
// The page is deliberately its own thing: none of the legacy gallery / obrazy / refs
// modules load here. Every shelf arrives from /api/library/shelf/:kind in one shape,
// along with the filter rows that shelf offers, so the page never has to know where a
// particular kind of thing is stored.
//
// Cards are always <img>. A clip with no thumbnail shows a striped tile — the old shelf
// downloaded whole videos to paint small cards, which is what made it heavy.

import { initNav } from '../app-nav.js';
import { openViewer } from './viewer.js';
import * as A from './actions.js';

const $ = (id) => document.getElementById(id);
const LS_SHELF = 'library_shelf_v1';
const LS_FILTER = 'library_filter_v1';
const LS_CAT = 'library_cat_v1';

const SHELVES = {
  characters:   'Characters',
  lookbooks:    'Lookbooks',
  environments: 'Environments',
  media:        'Media',
};

let _shelf = 'characters';
let _filter = '';         // media: kind
let _cat = '';            // media: birol category
let _char = '';           // characters: the selected character
let _items = [];
let _reqId = 0;

function _status(text, kind) {
  const el = $('lib-status');
  if (!el) return;
  el.textContent = text || '';
  el.className = 'lib-status' + (kind ? ' ' + kind : '');
}

function _paintShelves() {
  document.querySelectorAll('.lib-shelf').forEach(b => b.classList.toggle('cur', b.dataset.kind === _shelf));
  _paintUpload();
}

// One chip row. `cur` is the selected id, `onPick` gets the new one.
function _chips(box, filters, cur, onPick) {
  box.textContent = '';
  const opts = [{ id: '', label: 'All' }].concat(filters || []);
  for (const o of opts) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'lib-filter' + (o.id === cur ? ' cur' : '');
    b.textContent = o.label;
    b.addEventListener('click', () => { if (o.id !== cur) onPick(o.id); });
    box.appendChild(b);
  }
}

function _paintFilters(filters, cats) {
  const label = $('lib-bar-label');
  const box = $('lib-filters');
  const catBar = $('lib-bar-cats');
  if (!label || !box || !catBar) return;

  if (!filters || !filters.length) { label.textContent = ''; box.textContent = ''; }
  else {
    label.textContent = 'Kind';
    _chips(box, filters, _filter, (id) => {
      _filter = id; _cat = '';
      try { localStorage.setItem(LS_FILTER, id); localStorage.setItem(LS_CAT, ''); } catch (e) {}
      _load();
    });
  }
  // Categories are a birols thing; they make no sense under Uploads or Hooks.
  const showCats = (cats && cats.length && (_filter === '' || _filter === 'birols'));
  catBar.hidden = !showCats;
  if (showCats) {
    _chips($('lib-cats'), cats, _cat, (id) => {
      _cat = id;
      try { localStorage.setItem(LS_CAT, id); } catch (e) {}
      _load();
    });
  }
}

// ── Actions ─────────────────────────────────────────────────────────────────
// Which ones an item offers is a property of its shelf, not of the UI: a lookbook file
// has no favourite flag to set and no category to file it under, a character's name is
// a label while a lookbook's name IS its filename. One list, used by both the card menu
// and the viewer's action row, so the two can never offer different things.
const _FAVABLE = new Set(['birols', 'uploads', 'hooks']);
const _CATABLE = new Set(['birols', 'uploads']);

function _actionsFor(it) {
  const out = [];
  if (A.CAN_RENAME.has(it.kind)) out.push({ id: 'rename', label: 'Rename' });
  if (_FAVABLE.has(it.kind)) {
    const on = !!(it.meta && it.meta.favorite);
    out.push({ id: 'fav', label: on ? 'Unfavourite' : 'Favourite' });
  }
  if (_CATABLE.has(it.kind)) out.push({ id: 'cat', label: 'Category' });
  out.push({ id: 'del', label: 'Delete', danger: true });
  return out;
}

// Runs one action and reports what the caller has to do about it. `removed` means the
// item is gone, so whoever is showing it has to stop.
async function _runAction(id, it) {
  if (id === 'rename') {
    const name = await A.renameItem(it);
    if (name) it.name = name;
    return { changed: !!name, msg: name ? 'Renamed' : '' };
  }
  if (id === 'fav') {
    const fav = await A.toggleFavorite(it);
    it.meta = it.meta || {}; it.meta.favorite = fav;
    return { changed: true, msg: fav ? 'Added to favourites' : 'Removed from favourites' };
  }
  if (id === 'cat') {
    const cats = await A.loadCats();
    const cur = (it.meta && it.meta.categoryId) || '';
    // A numbered prompt beats a bespoke submenu here: the category list is short, and
    // this way the same code works from the card menu and from inside the viewer.
    const lines = cats.map((c, i) => (i + 1) + '. ' + c.label + (c.id === cur ? '  (current)' : ''));
    const ans = prompt('File "' + it.name + '" under:\n\n' + (lines.join('\n') || '(no categories yet)')
      + '\n\nType a number, or 0 for none.', '');
    if (ans == null) return { changed: false };
    const n = parseInt(String(ans).trim(), 10);
    if (isNaN(n) || n < 0 || n > cats.length) return { changed: false, msg: 'Not a category number', err: true };
    const c = n === 0 ? { id: '', label: '' } : cats[n - 1];
    await A.setCategory(it, c.id, c.label);
    it.meta = it.meta || {}; it.meta.categoryId = c.id;
    // the category chips carry counts, so the row has to be rebuilt
    return { changed: true, reload: true, msg: n === 0 ? 'Category cleared' : ('Filed under ' + c.label) };
  }
  if (id === 'del') {
    if (!confirm(A.deleteWarning(it))) return { changed: false };
    await A.deleteItem(it);
    _items = _items.filter(x => x !== it);
    return { removed: true, reload: true, msg: 'Deleted' };
  }
  return { changed: false };
}

// Repaint for whatever an action changed, THEN report it: _load() ends with _status('')
// and would swallow a message set before it.
async function _apply(r) {
  if (!r) return;
  if (r.reload || r.removed) { await _load(); _counts(); }
  else if (r.changed) { _renderGrid(); _refreshLooks(); }
  if (r.msg) _status(r.msg, r.err ? 'err' : '');
}

// The card menu. Right-click, because the cards are 68px wide and per-card buttons at
// that size are a worse target than a menu is.
let _menu = null;
function _closeMenu() { if (_menu) { _menu.remove(); _menu = null; } }
document.addEventListener('click', _closeMenu);
document.addEventListener('scroll', _closeMenu, true);

function _openMenu(ev, it) {
  ev.preventDefault();
  _closeMenu();
  const m = document.createElement('div');
  m.className = 'lib-menu';
  const add = (label, danger, on) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'lib-menu-item' + (danger ? ' danger' : '');
    b.textContent = label;
    b.addEventListener('click', on);
    m.appendChild(b);
  };
  add('Open', false, () => { _closeMenu(); _open(it); });
  for (const a of _actionsFor(it)) {
    add(a.label, a.danger, async () => {
      _closeMenu();
      let r = null;
      try { r = await _runAction(a.id, it); } catch (e) { _status(e.message, 'err'); return; }
      await _apply(r);
    });
  }
  document.body.appendChild(m);
  // Keep it on screen: near the cursor, but flipped when it would hang off an edge.
  const r = m.getBoundingClientRect();
  m.style.left = Math.min(ev.clientX, window.innerWidth  - r.width  - 6) + 'px';
  m.style.top  = Math.min(ev.clientY, window.innerHeight - r.height - 6) + 'px';
  _menu = m;
}

// Open in the viewer, with the same actions available there.
function _open(it, list) {
  const items = list || _items;
  openViewer(items, items.indexOf(it), {
    actionsFor: _actionsFor,
    onAction: async (id, item) => {
      const r = await _runAction(id, item);
      await _apply(r);
      return r;
    },
  });
}

function _card(it, extra) {
  const card = document.createElement('div');
  card.className = 'lib-card' + (it.meta && it.meta.favorite ? ' fav' : '');
  card.title = it.name + (it.meta && it.meta.character ? '\n' + it.meta.character : '');

  // The ratio lives on the box: an <img> with no loaded source contributes no height,
  // which collapsed the rows and killed the grid's scrolling.
  const box = document.createElement('div');
  box.className = 'lib-thumb-box' + (it.thumb ? '' : ' lib-thumb-pending');
  const img = document.createElement('img');
  img.className = 'lib-thumb';
  img.alt = it.name;
  img.decoding = 'async';
  // Native lazy: the browser fetches what is near the viewport and nothing else. A
  // hand-rolled observer looked equivalent but handed out no src at all in a view that
  // does not composite, leaving every card blank.
  img.loading = 'lazy';
  if (it.thumb) img.src = it.thumb;
  box.appendChild(img);
  card.appendChild(box);

  const name = document.createElement('div');
  name.className = 'lib-name';
  name.textContent = it.name;
  card.appendChild(name);

  if (extra) card.appendChild(extra);
  return card;
}

function _renderGrid() {
  const grid = $('lib-grid');
  if (!grid) return;
  grid.textContent = '';
  // each shelf shapes its own cards (see library.css): sheets are wide, lookbooks square
  grid.className = 'lib-grid is-' + _shelf;

  if (!_items.length) {
    const e = document.createElement('div');
    e.className = 'lib-empty';
    e.textContent = 'Nothing on this shelf' + (_filter || _cat ? ' with this filter.' : ' yet.');
    grid.appendChild(e);
    return;
  }

  for (const it of _items) {
    let sub = null;
    if (_shelf === 'characters') {
      sub = document.createElement('div');
      sub.className = 'lib-sub';
      const n = it.meta.looks || 0;
      const looks = document.createElement('span');
      looks.textContent = n + (n === 1 ? ' look' : ' looks');
      sub.appendChild(looks);
      if (it.meta.voices) { const v = document.createElement('span'); v.textContent = '· voice'; sub.appendChild(v); }
    }
    const card = _card(it, sub);
    if (_shelf === 'characters') {
      // A character card's job is to select: one click shows its looks beside the grid.
      // The sheet itself opens on double click, so both actions live on the same card.
      card.classList.toggle('cur', it.id === _char);
      card.addEventListener('click', () => _pickCharacter(it));
      card.addEventListener('dblclick', () => _open(it));
    } else {
      card.addEventListener('click', () => _open(it));
    }
    card.addEventListener('contextmenu', (e) => _openMenu(e, it));
    grid.appendChild(card);
  }
}

// ── Characters: the looks of the selected one, in the last third ─────────────
async function _pickCharacter(it) {
  const pane = $('lib-looks');
  if (!pane) return;

  if (_char === it.id) {           // clicking the selected character closes the pane
    _char = '';
    pane.hidden = true;
    _renderGrid();
    return;
  }
  _char = it.id;
  _renderGrid();                   // repaint so the selection ring moves
  await _loadLooks(it);
}

// Kept apart from the selecting so anything that changes a look — a rename, a delete —
// can repaint the pane without re-toggling the character.
async function _loadLooks(it) {
  const pane = $('lib-looks');
  const head = $('lib-looks-head');
  const grid = $('lib-looks-grid');
  if (!pane || !grid) return;
  pane.hidden = false;
  head.textContent = it.name + ' — looks';
  grid.textContent = '';

  try {
    const d = await (await fetch('/api/library/looks/' + encodeURIComponent(it.id))).json();
    if (!d || !d.success) throw new Error((d && d.error) || 'read failed');
    if (!d.items.length) {
      const e = document.createElement('div');
      e.className = 'lib-empty';
      e.textContent = 'No looks for this character yet.';
      grid.appendChild(e);
      return;
    }
    head.textContent = it.name + ' — ' + d.items.length + ' look' + (d.items.length === 1 ? '' : 's');
    for (const l of d.items) {
      const c = _card(l);
      c.addEventListener('click', () => _open(l, d.items));
      c.addEventListener('contextmenu', (e) => _openMenu(e, l));
      grid.appendChild(c);
    }
  } catch (e) {
    grid.textContent = '';
    const err = document.createElement('div');
    err.className = 'lib-empty';
    err.textContent = e.message;
    grid.appendChild(err);
  }
}

// Repaint the open looks pane against the server again. Deleting or renaming a look
// leaves the pane showing what used to be there, and the pane is a second list of the
// same records — it has to be re-read, not patched.
function _refreshLooks() {
  if (_shelf !== 'characters' || !_char) return;
  const c = _items.find(x => String(x.id) === String(_char));
  if (c) _loadLooks(c);
}

async function _load() {
  const my = ++_reqId;
  _status('Reading…');
  _paintShelves();
  // the looks pane belongs to Characters only
  const pane = $('lib-looks');
  if (pane && _shelf !== 'characters') { pane.hidden = true; _char = ''; }
  try {
    const q = [];
    if (_filter) q.push('filter=' + encodeURIComponent(_filter));
    if (_cat) q.push('cat=' + encodeURIComponent(_cat));
    const url = '/api/library/shelf/' + _shelf + (q.length ? '?' + q.join('&') : '');
    const d = await (await fetch(url)).json();
    if (my !== _reqId) return;
    if (!d || !d.success) throw new Error((d && d.error) || 'read failed');
    _items = d.items || [];
    _paintFilters(d.filters, d.cats);
    _renderGrid();
    const label = SHELVES[_shelf] || _shelf;
    $('lib-count').textContent = label + ' · ' + d.shown + (d.shown !== d.total ? ' of ' + d.total : '');
    _refreshLooks();       // the pane is a second list of the same records
    _status('');
  } catch (e) {
    if (my !== _reqId) return;
    _items = [];
    _renderGrid();
    _status(e.message, 'err');
  }
}

async function _counts() {
  try {
    const d = await (await fetch('/api/library/counts')).json();
    if (!d || !d.success) return;
    document.querySelectorAll('.lib-shelf').forEach(b => {
      const n = d.counts[b.dataset.kind];
      const el = b.querySelector('.lib-n');
      if (el) el.textContent = (n == null) ? '' : String(n);
    });
  } catch (e) { /* the counts are a nicety, not the page */ }
}

function _select(kind) {
  if (!SHELVES[kind] || kind === _shelf) return;
  _shelf = kind; _filter = ''; _cat = '';
  try {
    localStorage.setItem(LS_SHELF, kind);
    localStorage.setItem(LS_FILTER, '');
    localStorage.setItem(LS_CAT, '');
  } catch (e) {}
  _load();
}

// ── Upload ──────────────────────────────────────────────────────────────────
// Only on Media: it is the one shelf whose contents are files you bring in rather than
// things the app made. The button lands them under the Uploads filter.
function _paintUpload() {
  const btn = $('lib-upload');
  if (!btn) return;
  btn.hidden = _shelf !== 'media';
}

async function _upload(files) {
  const list = Array.from(files || []);
  if (!list.length) return;
  const btn = $('lib-upload');
  if (btn) btn.disabled = true;
  const r = await A.uploadVideos(list, (i, n, name) => _status('Uploading ' + i + '/' + n + ' — ' + name));
  if (btn) btn.disabled = false;
  // Land on the shelf the clips went to, so they are visible without hunting.
  if (r.ok) {
    _filter = 'uploads'; _cat = '';
    try { localStorage.setItem(LS_FILTER, 'uploads'); localStorage.setItem(LS_CAT, ''); } catch (e) {}
    await _load();
    _counts();
  }
  // After the reload, never before: _load() signs off with _status('') and would wipe this.
  _status(r.ok === r.total
    ? ('Uploaded ' + r.ok + (r.ok === 1 ? ' clip' : ' clips'))
    : (r.ok + ' of ' + r.total + ' uploaded'), r.ok === r.total ? '' : 'err');
}

function boot() {
  initNav();
  try {
    const saved = localStorage.getItem(LS_SHELF);
    if (saved && SHELVES[saved]) _shelf = saved;
    _filter = localStorage.getItem(LS_FILTER) || '';
    _cat = localStorage.getItem(LS_CAT) || '';
  } catch (e) {}

  document.querySelectorAll('.lib-shelf').forEach(b => {
    b.addEventListener('click', () => _select(b.dataset.kind));
  });

  const btn = $('lib-upload');
  const inp = $('lib-file');
  if (btn && inp) {
    btn.addEventListener('click', () => inp.click());
    // Copy the FileList into an array BEFORE clearing the input: input.files is live,
    // so `inp.value = ''` empties the very list you are holding and the upload sees
    // nothing. Clearing is still needed, or picking the same file twice fires no change.
    inp.addEventListener('change', () => {
      const files = Array.from(inp.files || []);
      inp.value = '';
      _upload(files);
    });
  }

  _load();
  _counts();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
