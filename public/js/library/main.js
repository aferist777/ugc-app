// LIBRARY — boot and shelf switching (Ph18.1).
//
// The page is deliberately its own thing: it does not load the legacy gallery /
// obrazy / refs modules, and it reads shelves through one endpoint that returns the
// same shape for every kind. This step wires the frame — the switcher, the filter
// row and the grid; reading real shelves lands in Ph18.2.

import { initNav } from '../app-nav.js';

const $ = (id) => document.getElementById(id);
const LS_SHELF = 'library_shelf_v1';
const LS_FILTER = 'library_filter_v1';

// What each shelf filters BY. Media is one shelf with three kinds behind it, because
// birols and uploads already share one archive and hooks will likely join them.
const SHELVES = {
  characters:   { label: 'Characters',   filter: null },
  lookbooks:    { label: 'Lookbooks',    filter: null },
  environments: { label: 'Environments', filter: null },
  obrazy:       { label: 'Obrazy',       filter: 'character' },
  media:        { label: 'Media',        filter: 'kind', options: [
                   { id: 'birols',  label: 'Birols' },
                   { id: 'uploads', label: 'Uploads' },
                   { id: 'hooks',   label: 'Hooks' },
                 ] },
};

let _shelf = 'characters';
let _filter = '';

function _status(text, kind) {
  const el = $('lib-status');
  if (!el) return;
  el.textContent = text || '';
  el.className = 'lib-status' + (kind ? ' ' + kind : '');
}

function _paintShelves() {
  document.querySelectorAll('.lib-shelf').forEach(b => {
    b.classList.toggle('cur', b.dataset.kind === _shelf);
  });
}

// The filter row is per shelf: kinds for Media, characters for Obrazy (filled in
// Ph18.2 from the character store), nothing for the three asset shelves.
function _paintFilters() {
  const spec = SHELVES[_shelf] || {};
  const label = $('lib-bar-label');
  const box = $('lib-filters');
  if (!label || !box) return;
  box.textContent = '';
  if (!spec.filter) { label.textContent = ''; return; }
  label.textContent = spec.filter === 'kind' ? 'Kind' : 'Character';
  const opts = [{ id: '', label: 'All' }].concat(spec.options || []);
  for (const o of opts) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'lib-filter' + (o.id === _filter ? ' cur' : '');
    b.textContent = o.label;
    b.addEventListener('click', () => {
      _filter = o.id;
      try { localStorage.setItem(LS_FILTER, _filter); } catch (e) {}
      _paintFilters();
      _render();
    });
    box.appendChild(b);
  }
}

// Ph18.1 draws the frame only. The grid says what it will hold so the page is
// honest about being unfinished rather than looking broken.
function _render() {
  const grid = $('lib-grid');
  if (!grid) return;
  grid.textContent = '';
  const spec = SHELVES[_shelf] || {};
  const note = document.createElement('div');
  note.className = 'lib-empty';
  note.textContent = spec.label + ' — reading this shelf lands in the next step.';
  grid.appendChild(note);
  $('lib-count').textContent = spec.label;
}

function _select(kind) {
  if (!SHELVES[kind]) return;
  _shelf = kind;
  _filter = '';
  try { localStorage.setItem(LS_SHELF, kind); localStorage.setItem(LS_FILTER, ''); } catch (e) {}
  _paintShelves();
  _paintFilters();
  _render();
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

  _paintShelves();
  _paintFilters();
  _render();
  _status('');
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
