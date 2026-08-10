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

function _card(it, extra) {
  const card = document.createElement('div');
  card.className = 'lib-card';
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
      const looks = document.createElement('span');
      looks.textContent = (it.meta.looks || 0) + ' looks';
      sub.appendChild(looks);
      if (it.meta.voices) { const v = document.createElement('span'); v.textContent = '· voice'; sub.appendChild(v); }
    }
    const card = _card(it, sub);
    if (_shelf === 'characters') {
      card.classList.toggle('cur', it.id === _char);
      card.addEventListener('click', () => _pickCharacter(it));
    }
    grid.appendChild(card);
  }
}

// ── Characters: the looks of the selected one, in the last third ─────────────
async function _pickCharacter(it) {
  const pane = $('lib-looks');
  const head = $('lib-looks-head');
  const grid = $('lib-looks-grid');
  if (!pane || !grid) return;

  if (_char === it.id) {           // clicking the selected character closes the pane
    _char = '';
    pane.hidden = true;
    _renderGrid();
    return;
  }
  _char = it.id;
  _renderGrid();                   // repaint so the selection ring moves
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
    for (const l of d.items) grid.appendChild(_card(l));
  } catch (e) {
    grid.textContent = '';
    const err = document.createElement('div');
    err.className = 'lib-empty';
    err.textContent = e.message;
    grid.appendChild(err);
  }
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

  _load();
  _counts();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
