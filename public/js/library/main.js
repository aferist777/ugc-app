// LIBRARY — boot, shelf switching and reading (Ph18.1 + Ph18.2).
//
// The page is deliberately its own thing: none of the legacy gallery / obrazy / refs
// modules load here. Every shelf arrives from /api/library/shelf/:kind in one shape,
// including the filter row that shelf offers, so the page never has to know where a
// particular kind of thing is stored.
//
// Cards are always <img>. A clip with no thumbnail shows a striped tile — the old
// shelf downloaded whole videos to paint small cards, which is what made it heavy.

import { initNav } from '../app-nav.js';

const $ = (id) => document.getElementById(id);
const LS_SHELF = 'library_shelf_v1';
const LS_FILTER = 'library_filter_v1';

const SHELVES = {
  characters:   'Characters',
  lookbooks:    'Lookbooks',
  environments: 'Environments',
  obrazy:       'Obrazy',
  media:        'Media',
};
// What the filter row is called for the shelves that have one.
const FILTER_LABEL = { obrazy: 'Character', media: 'Kind' };

let _shelf = 'characters';
let _filter = '';
let _items = [];
let _io = null;                 // lazy-loads thumbs as cards scroll in
let _reqId = 0;                 // guards against a slow shelf landing after a fast one

function _status(text, kind) {
  const el = $('lib-status');
  if (!el) return;
  el.textContent = text || '';
  el.className = 'lib-status' + (kind ? ' ' + kind : '');
}

function _paintShelves() {
  document.querySelectorAll('.lib-shelf').forEach(b => b.classList.toggle('cur', b.dataset.kind === _shelf));
}

function _paintFilters(filters) {
  const label = $('lib-bar-label');
  const box = $('lib-filters');
  if (!label || !box) return;
  box.textContent = '';
  if (!filters || !filters.length) { label.textContent = ''; return; }
  label.textContent = FILTER_LABEL[_shelf] || 'Filter';
  const opts = [{ id: '', label: 'All' }].concat(filters);
  for (const o of opts) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'lib-filter' + (o.id === _filter ? ' cur' : '');
    b.textContent = o.label;
    b.addEventListener('click', () => {
      if (_filter === o.id) return;
      _filter = o.id;
      try { localStorage.setItem(LS_FILTER, _filter); } catch (e) {}
      _load();
    });
    box.appendChild(b);
  }
}

// One observer per render, so cards removed by a shelf switch stop being watched.
function _observer() {
  if (_io) { try { _io.disconnect(); } catch (e) {} }
  if (!('IntersectionObserver' in window)) { _io = null; return null; }
  _io = new IntersectionObserver((entries, obs) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      const img = e.target;
      if (img.dataset.src) { img.src = img.dataset.src; delete img.dataset.src; }
      obs.unobserve(img);
    }
  }, { root: $('lib-grid'), rootMargin: '300px 0px' });
  return _io;
}

function _renderGrid() {
  const grid = $('lib-grid');
  if (!grid) return;
  grid.textContent = '';
  const io = _observer();

  if (!_items.length) {
    const e = document.createElement('div');
    e.className = 'lib-empty';
    e.textContent = 'Nothing on this shelf' + (_filter ? ' with this filter.' : ' yet.');
    grid.appendChild(e);
    return;
  }

  for (const it of _items) {
    const card = document.createElement('div');
    card.className = 'lib-card';
    card.title = it.name + (it.meta && it.meta.character ? '\n' + it.meta.character : '');

    const img = document.createElement('img');
    img.className = 'lib-thumb' + (it.thumb ? '' : ' lib-thumb-pending');
    img.alt = it.name;
    img.decoding = 'async';
    if (it.thumb) {
      img.dataset.src = it.thumb;
      if (io) io.observe(img); else img.src = it.thumb;
    }
    card.appendChild(img);

    const name = document.createElement('div');
    name.className = 'lib-name';
    name.textContent = it.name;
    card.appendChild(name);

    grid.appendChild(card);
  }
}

async function _load() {
  const my = ++_reqId;
  _status('Reading…');
  _paintShelves();
  try {
    const url = '/api/library/shelf/' + _shelf + (_filter ? '?filter=' + encodeURIComponent(_filter) : '');
    const d = await (await fetch(url)).json();
    if (my !== _reqId) return;                       // a newer shelf won
    if (!d || !d.success) throw new Error((d && d.error) || 'read failed');
    _items = d.items || [];
    _paintFilters(d.filters);
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

// Counts on the switcher, so a shelf says how much is in it before you open it.
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
  _shelf = kind;
  _filter = '';
  try { localStorage.setItem(LS_SHELF, kind); localStorage.setItem(LS_FILTER, ''); } catch (e) {}
  _load();
}

function boot() {
  initNav();
  try {
    const saved = localStorage.getItem(LS_SHELF);
    if (saved && SHELVES[saved]) _shelf = saved;
    _filter = localStorage.getItem(LS_FILTER) || '';
  } catch (e) {}

  document.querySelectorAll('.lib-shelf').forEach(b => {
    b.addEventListener('click', () => _select(b.dataset.kind));
  });

  _load();
  _counts();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
