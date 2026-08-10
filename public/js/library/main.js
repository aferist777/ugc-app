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
import { renderCatBar, closeConfirm } from './cats-bar.js';

const $ = (id) => document.getElementById(id);
const LS_SHELF = 'library_shelf_v1';
const LS_FILTER = 'library_filter_v1';
const LS_CAT = 'library_cat_v1';
const LS_CATS_H = 'library_cats_h_v1';   // the height you dragged the category row to

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
let _first = true;      // the page's very first read, for restoring a remembered filter

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

// The kind and category are remembered, so every place that changes them goes through
// here — one writer means the stored pair and the live pair cannot drift apart.
function _setFilter(filter, cat) {
  _filter = filter || '';
  _cat = cat || '';
  try {
    localStorage.setItem(LS_FILTER, _filter);
    localStorage.setItem(LS_CAT, _cat);
  } catch (e) {}
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
  const catBar = $('lib-cats-wrap');
  if (!label || !box || !catBar) return;

  if (!filters || !filters.length) { label.textContent = ''; box.textContent = ''; }
  else {
    label.textContent = 'Kind';
    _chips(box, filters, _filter, (id) => {
      _setFilter(id, '');          // a category belongs to a kind, so it resets with it
      _load();
    });
  }
  // Every kind has categories now, so the row is always there on Media. It carries its own
  // gestures — add, rename, reorder, delete — which is why it is a component and not _chips.
  catBar.hidden = _shelf !== 'media';
  if (catBar.hidden) return;
  renderCatBar($('lib-cats'), cats || [], {
    kind: _filter,
    cur: _cat,
    onFilter: (id) => { _setFilter(_filter, id); _load(); },
    status: _status,
    reload: () => _load(),
    refreshCats: _loadCats,
  });
  _applyCatHeight();
}

// ── The category row's height ───────────────────────────────────────────────
// Grows with its contents up to FIVE rows of chips, then scrolls. The sash at the bottom
// edge overrides that: once you have dragged it, your height is used instead — still capped
// at five rows, so adding categories can never push the grid off the screen.
const CAT_ROWS_MAX = 5;

// One row's worth of pixels, measured rather than assumed: chip padding and font come from
// the stylesheet, and a guessed 23px would drift the moment either changed.
function _catRowPx() {
  const bar = $('lib-bar-cats');
  const chip = bar && bar.querySelector('.lib-filter');
  if (!chip) return 30;
  const h = chip.getBoundingClientRect().height;
  const gap = parseFloat(getComputedStyle($('lib-cats')).rowGap || '4') || 4;
  return h + gap;
}
function _catBarPad() {
  const bar = $('lib-bar-cats');
  if (!bar) return 12;
  const cs = getComputedStyle(bar);
  return (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
}
function _catMaxPx() { return Math.round(_catRowPx() * CAT_ROWS_MAX + _catBarPad()); }

function _applyCatHeight() {
  const wrap = $('lib-cats-wrap');
  const bar = $('lib-bar-cats');
  if (!wrap || !bar || wrap.hidden) return;
  const max = _catMaxPx();
  let stored = null;
  try { stored = parseInt(localStorage.getItem(LS_CATS_H) || '', 10); } catch (e) {}
  if (stored && !isNaN(stored)) {
    bar.style.height = Math.max(Math.round(_catRowPx() + _catBarPad()), Math.min(stored, max)) + 'px';
  } else {
    // No sash set: let the content decide, bounded by five rows.
    bar.style.height = '';
    bar.style.maxHeight = max + 'px';
    return;
  }
  bar.style.maxHeight = max + 'px';
}

function _wireCatSash() {
  const sash = $('lib-cats-sash');
  const bar = $('lib-bar-cats');
  if (!sash || !bar) return;
  sash.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const y0 = e.clientY;
    const h0 = bar.getBoundingClientRect().height;
    const min = Math.round(_catRowPx() + _catBarPad());
    const max = _catMaxPx();
    document.body.classList.add('lib-rowresize');
    const move = (ev) => {
      const h = Math.max(min, Math.min(max, Math.round(h0 + (ev.clientY - y0))));
      bar.style.height = h + 'px';
      bar.style.maxHeight = max + 'px';
    };
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      document.body.classList.remove('lib-rowresize');
      try { localStorage.setItem(LS_CATS_H, String(Math.round(bar.getBoundingClientRect().height))); } catch (e) {}
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  });
  // Double click the sash to hand the height back to the content.
  sash.addEventListener('dblclick', () => {
    try { localStorage.removeItem(LS_CATS_H); } catch (e) {}
    _applyCatHeight();
  });
}

// ── Actions ─────────────────────────────────────────────────────────────────
// Which ones an item offers is a property of its shelf, not of the UI: a lookbook file
// has no favourite flag to set and no category to file it under, a character's name is
// a label while a lookbook's name IS its filename. One list, used by both the card menu
// and the viewer's action row, so the two can never offer different things.
const _FAVABLE = new Set(['birols', 'uploads', 'hooks']);
// All three kinds can be filed under a category. Hook records already carried categoryId —
// public/js/scen-hooks.js has always written it — so this offers a control for data that
// was already there.
const _CATABLE = new Set(['birols', 'uploads', 'hooks']);

function _actionsFor(it) {
  const out = [];
  if (A.CAN_RENAME.has(it.kind)) out.push({ id: 'rename', label: 'Rename' });
  if (_FAVABLE.has(it.kind)) {
    const on = !!(it.meta && it.meta.favorite);
    out.push({ id: 'fav', label: on ? 'Unfavourite' : 'Favourite' });
  }
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
    // reload, not repaint: the card has to jump to the front, and that order is the
    // server's (favourites first, then date). A local repaint would leave it where it was.
    return { reload: true, msg: fav ? 'Added to favourites' : 'Removed from favourites' };
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
  if (r.reload || r.removed) { await _load({ keepScroll: true }); _counts(); }
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
  // By id, not by identity. A card holds the item object it was rendered from, and a
  // reload replaces every object in _items — so indexOf() on a card that outlived a
  // reload returns -1, which clamped to 0 and opened whatever happened to be first.
  let at = items.indexOf(it);
  if (at < 0) at = items.findIndex(x => x && String(x.id) === String(it.id) && x.kind === it.kind);
  if (at < 0) { _status('That item is no longer on this shelf', 'err'); return; }
  openViewer(items, at, {
    actionsFor: _actionsFor,
    // Kind and category belong in the right column rather than the button row: they are
    // states to read off, not actions to fire, and a <select> shows the current value.
    extraRows: (item) => {
      const rows = [];
      if (_FAVABLE.has(item.kind)) {
        rows.push(['kind', _picker('lib-view-sel', item.kind, () => A.KINDS,
          (k) => _setKind(item, k), 'Which kind of clip this is')]);
      }
      if (_CATABLE.has(item.kind)) {
        rows.push(['category', _picker('lib-view-sel', (item.meta && item.meta.categoryId) || '',
          () => [{ id: '', label: '— no category —' }].concat(_catsFor(item.kind)),
          (id) => _setCat(item, id), 'Category')]);
      }
      return rows;
    },
    onAction: async (id, item) => {
      const r = await _runAction(id, item);
      await _apply(r);
      return r;
    },
  });
}

// One list per kind, fetched once per page and shared by every dropdown rather than
// re-requested per card. A card offers the list belonging to ITS kind — with the All filter
// the grid holds all three kinds at once, so one list would be the wrong one two thirds of
// the time.
let _catsByKind = { birols: [], uploads: [], hooks: [] };
const _catsFor = (kind) => _catsByKind[kind] || [];
async function _loadCats() {
  try { _catsByKind = await A.loadCats(); } catch (e) { _catsByKind = { birols: [], uploads: [], hooks: [] }; }
  // Merge builds its media-bar category filters from localStorage, so a name given here has
  // to be written there too or Merge would never offer it.
  A.mirrorCatsToMerge(_catsByKind);
}

// A <select> for one field of one item. Options are filled on first interaction, not up
// front: 218 cards times 14 categories is 3000 <option> nodes nobody has looked at.
function _picker(cls, current, options, onPick, title) {
  const sel = document.createElement('select');
  sel.className = cls;
  if (title) sel.title = title;
  let filled = false;
  const fill = () => {
    if (filled) return;
    filled = true;
    sel.textContent = '';
    for (const o of options()) {
      const opt = document.createElement('option');
      opt.value = o.id; opt.textContent = o.label;
      if (o.id === current) opt.selected = true;
      sel.appendChild(opt);
    }
  };
  // one option to start with, so the closed control still reads correctly
  const shown = document.createElement('option');
  shown.value = current;
  shown.textContent = (options().find(o => o.id === current) || { label: '— none —' }).label;
  sel.appendChild(shown);
  sel.addEventListener('mousedown', fill);
  sel.addEventListener('focus', fill);
  sel.addEventListener('keydown', fill);
  // A card's select sits on a card that opens the viewer on click; without this every
  // attempt to change a category would open the clip instead.
  sel.addEventListener('click', (e) => e.stopPropagation());
  sel.addEventListener('change', (e) => { e.stopPropagation(); onPick(sel.value); });
  return sel;
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

  // Hover controls, on the thumbnail itself: the star top left, the cross top right.
  // The star is the one control that stays visible once it is on — that is the whole
  // point of starring something. Both stop propagation so neither opens the viewer.
  if (_FAVABLE.has(it.kind)) {
    const star = document.createElement('button');
    star.type = 'button';
    star.className = 'lib-star';
    star.textContent = '★';
    star.title = (it.meta && it.meta.favorite) ? 'Remove from favourites' : 'Add to favourites';
    star.addEventListener('click', async (e) => {
      e.stopPropagation();
      star.disabled = true;
      try { await _apply(await _runAction('fav', it)); } catch (err) { _status(err.message, 'err'); }
    });
    box.appendChild(star);
  }
  const x = document.createElement('button');
  x.type = 'button';
  x.className = 'lib-x';
  x.textContent = '✕';
  x.title = 'Delete';
  x.addEventListener('click', async (e) => {
    e.stopPropagation();
    try { await _apply(await _runAction('del', it)); } catch (err) { _status(err.message, 'err'); }
  });
  box.appendChild(x);
  card.appendChild(box);

  const name = document.createElement('div');
  name.className = 'lib-name';
  name.textContent = it.name;
  card.appendChild(name);

  // Second line: which category this clip is filed under, changeable in place. Only
  // where a category means something — hooks and the image shelves have none.
  if (_CATABLE.has(it.kind)) {
    card.appendChild(_picker('lib-cat-sel', (it.meta && it.meta.categoryId) || '',
      () => [{ id: '', label: '— no category —' }].concat(_catsFor(it.kind)),
      (id) => _setCat(it, id), 'Category'));
  }

  if (extra) card.appendChild(extra);
  return card;
}

async function _setKind(it, kind) {
  const label = (A.KINDS.find(k => k.id === kind) || {}).label || kind;
  try {
    await A.setKind(it, kind);
    it.kind = kind;
    await _apply({ removed: true, reload: true, msg: 'Moved to ' + label + 's' });
  } catch (e) { _status(e.message, 'err'); }
}

// Filing one clip under a category, from wherever the control is. Repaints through
// _apply so the chip counts and the filtered view stay honest.
async function _setCat(it, id) {
  const c = _catsFor(it.kind).find(x => x.id === id) || { id: '', label: '' };
  try {
    await A.setCategory(it, c.id, c.label);
    it.meta = it.meta || {}; it.meta.categoryId = c.id;
    await _apply({ changed: true, reload: true, msg: c.id ? ('Filed under ' + c.label) : 'Category cleared' });
  } catch (e) { _status(e.message, 'err'); }
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

async function _load(opts) {
  const grid0 = $('lib-grid');
  const scroll = (opts && opts.keepScroll && grid0) ? grid0.scrollTop : null;
  const my = ++_reqId;
  closeConfirm();          // never leave one pointing at a chip that is about to be replaced
  _status('Reading…');
  _paintShelves();
  // the looks pane belongs to Characters only
  const pane = $('lib-looks');
  if (pane && _shelf !== 'characters') { pane.hidden = true; _char = ''; }
  try {
    // The kind and category are Media's, and they are now REMEMBERED across shelf
    // switches — so they must not be sent to a shelf that has no such kinds. Sending a
    // remembered filter=uploads to Characters matched nothing and emptied the shelf.
    const q = [];
    if (_shelf === 'media') {
      if (_filter) q.push('filter=' + encodeURIComponent(_filter));
      if (_cat) q.push('cat=' + encodeURIComponent(_cat));
    }
    const url = '/api/library/shelf/' + _shelf + (q.length ? '?' + q.join('&') : '');
    const d = await (await fetch(url)).json();
    if (my !== _reqId) return;
    if (!d || !d.success) throw new Error((d && d.error) || 'read failed');
    _items = d.items || [];
    // A remembered kind or category can outlive what it pointed at — a category emptied,
    // a filter saved before the shelf changed shape. Drop it AND read again: resetting the
    // chip alone left the grid showing the empty result the dead filter had returned.
    // This recurses at most once, because the reset filter is always a valid one.
    if (_shelf === 'media') {
      const kindRow = (d.filters || []).find(f => f.id === _filter);
      // On the FIRST load only, a remembered kind that now holds nothing is dropped too.
      // Clicking an empty kind should show it empty — that is a deliberate choice — but
      // opening the page onto an empty shelf reads as a broken page, and a filter with
      // nothing behind it is not a place worth being returned to.
      const emptyOnOpen = _first && kindRow && d.shown === 0;
      const deadKind = _filter && !kindRow;
      const deadCat = _cat && !(d.cats || []).some(c => c.id === _cat);
      _first = false;
      if (deadKind || deadCat || emptyOnOpen) {
        _setFilter((deadKind || emptyOnOpen) ? '' : _filter, '');
        return _load();
      }
    }
    _first = false;
    _paintFilters(d.filters, d.cats);
    _renderGrid();
    const label = SHELVES[_shelf] || _shelf;
    $('lib-count').textContent = label + ' · ' + d.shown + (d.shown !== d.total ? ' of ' + d.total : '');
    _refreshLooks();       // the pane is a second list of the same records
    if (scroll != null) { const g = $('lib-grid'); if (g) g.scrollTop = scroll; }
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

// Switching shelves KEEPS the kind and category. They only mean anything on Media, and
// clearing them on the way past every other shelf is what made the page forget where you
// were: leave Media, come back, and you were staring at everything again.
function _select(kind) {
  if (!SHELVES[kind] || kind === _shelf) return;
  _shelf = kind;
  try { localStorage.setItem(LS_SHELF, kind); } catch (e) {}
  _load();
}

// ── Upload ──────────────────────────────────────────────────────────────────
// Only on Media: it is the one shelf whose contents are files you bring in rather than
// things the app made. The button lands them under the Uploads filter.
function _paintUpload() {
  const btn = $('lib-upload');
  if (!btn) return;
  btn.hidden = _shelf !== 'media';
  // Say where the files will land, so pressing it is never a surprise.
  const k = A.KINDS.find(x => x.id === _filter);
  btn.textContent = k ? ('Upload to ' + k.label + 's') : 'Upload';
  btn.title = 'Add video files to ' + (k ? k.label + 's' : 'Uploads');
}

async function _upload(files) {
  const list = Array.from(files || []);
  if (!list.length) return;
  const btn = $('lib-upload');
  if (btn) btn.disabled = true;
  // The open kind decides where the clips are filed: looking at Hooks and pressing Upload
  // means "add hooks". With no kind chosen ("All") they go to Uploads, which is what a
  // file you brought in from outside is. The CATEGORY filter is deliberately ignored —
  // a clip arrives unfiled and you file it afterwards, from the card or the viewer.
  const target = A.KINDS.some(k => k.id === _filter) ? _filter : 'uploads';
  const r = await A.uploadVideos(list, target, (i, n, name) => _status('Uploading ' + i + '/' + n + ' — ' + name));
  if (btn) btn.disabled = false;
  // Land on the kind the clips went to, so they are visible without hunting.
  if (r.ok) {
    _setFilter(target, '');
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

  _wireCatSash();
  window.addEventListener('resize', _applyCatHeight);
  _loadCats().then(_load);
  _counts();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
