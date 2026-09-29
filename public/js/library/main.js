// LIBRARY — shelves, filters, and on the picture shelves the right column about the selected tile.
//
// The page is deliberately its own thing: none of the legacy gallery / obrazy / refs
// modules load here. Every shelf arrives from /api/library/shelf/:kind in one shape,
// along with the filter rows that shelf offers, so the page never has to know where a
// particular kind of thing is stored.
//
// Cards are always <img>. A clip with no thumbnail shows a striped tile — the old shelf
// downloaded whole videos to paint small cards, which is what made it heavy.

import { initNav } from '../app-nav.js';
import { mountLibSwitch } from '../lib-switch.js';
import { openViewer } from './viewer.js';
import * as A from './actions.js';
import { renderCatBar, closeConfirm } from './cats-bar.js';
import * as V from './voices.js';
import * as MU from './music.js';
import * as SC from './scenarios.js';
import * as INFO from './info.js';

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
  voices:       'Voices',
  music:        'Music',
  renders:      'Renders',
  scenarios:    'Scenarios',
};

let _shelf = 'characters';
let _filter = '';         // media: kind
let _cat = '';            // media: birol category

// THE SHELVES WHERE ONE TILE IS ALWAYS SELECTED (phase B, the owner 2026-09-29): opening one selects
// the top-left tile, there is no "nothing selected", and the right column says what the selected one
// is (js/library/info.js). Kept across a reload of the same shelf, dropped on leaving it.
const PICKABLE = new Set(['characters', 'lookbooks', 'environments']);
let _sel = '';
let _items = [];
let _labelKeys = null;    // voices: the order to read a voice's tags in, from the server
let _reqId = 0;
// Media's three checks are owed once a read asked for them, and are run by whichever read lands
// last - a newer read that overtakes the one that asked must not drop them.
let _checksDue = false;
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
  // Media's three checks show their buttons only there; leaving Media puts them away at once.
  if (_shelf !== 'media') for (const id of ['lib-dupes', 'lib-broken', 'lib-thumbs']) { const b = $(id); if (b) b.hidden = true; }
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
    reload: (o) => _load(o),
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
// a label while a lookbook's name IS its filename. The viewer's action row reads it.
const _FAVABLE = new Set(['birols', 'uploads', 'hooks', 'images']);
// Which kinds a record can be CONVERTED between. Not the same set as the ones that can be
// starred: an image and a clip are different files in different stores, and there is no
// meaning to turning a picture into a birol. The server refuses it too - see the /kind route.
const _KINDABLE = new Set(['birols', 'uploads', 'hooks']);
// All three kinds can be filed under a category. Hook records already carried categoryId —
// public/js/scen-hooks.js has always written it — so this offers a control for data that
// was already there.
const _CATABLE = new Set(['birols', 'uploads', 'hooks', 'images']);

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
  // Something gone - deleted, or moved to another kind - is what can change Media's checks.
  if (r.reload || r.removed) { await _load({ keepScroll: true, checks: !!r.removed }); _counts(); }
  else if (r.changed) { _renderGrid(); _showSelected(); }
  if (r.msg) _status(r.msg, r.err ? 'err' : '');
}

// Open in the viewer, with the same actions available there. `follow` is told every item the viewer
// steps to: a picture shelf moves its selection with it, so closing the viewer leaves you on the one
// you were looking at (phase B5).
function _open(it, list, follow) {
  const items = list || _items;
  // By id, not by identity. A card holds the item object it was rendered from, and a
  // reload replaces every object in _items — so indexOf() on a card that outlived a
  // reload returns -1, which clamped to 0 and opened whatever happened to be first.
  let at = items.indexOf(it);
  if (at < 0) at = items.findIndex(x => x && String(x.id) === String(it.id) && x.kind === it.kind);
  if (at < 0) { _status('That item is no longer on this shelf', 'err'); return; }
  openViewer(items, at, {
    onIndex: typeof follow === 'function' ? (_i, item) => follow(item) : null,
    actionsFor: _actionsFor,
    // Kind and category belong in the right column rather than the button row: they are
    // states to read off, not actions to fire, and a <select> shows the current value.
    extraRows: (item) => {
      const rows = [];
      if (_KINDABLE.has(item.kind)) {
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

// A TILE SHOWS A MINIATURE, never the picture itself (phase B1, the owner 2026-09-29). The shelf's
// `thumb` for a character, a look, a lookbook or an environment is the thumbs/ copy beside it - and,
// where there is none, the original: a 5504px sheet of 6.6 MB in a 190px tile. So those tiles go
// through the thumbnail door, from the copy when there is one and from the original when not, made
// once and cached (lib/thumbs.js `strip`). The shelf's own shape stays: the Character page reads it
// too, and wraps `thumb` in the same door itself.
//
// A still on Media too (phase D3): its shelf `thumb` is the 640px copy, already a door address, so the
// tile is sized from the picture itself. A clip keeps its poster - 320px, a miniature already, and a
// static file, which the door would only make slower.
const _SIZED = new Set(['characters', 'obrazy', 'lookbooks', 'environments']);
const _door = (src) => '/api/thumb?src=' + encodeURIComponent(src) + '&v=strip';
function _tileSrc(it) {
  if (it.kind === 'images') return it.media ? _door(it.media) : '';
  if (!_SIZED.has(it.kind)) return it.thumb || '';
  const src = it.thumb || it.media;
  return src ? _door(src) : '';
}

function _card(it, extra) {
  const card = document.createElement('div');
  card.className = 'lib-card' + (it.meta && it.meta.favorite ? ' fav' : '');
  card.dataset.id = String(it.id);
  // A hook's permanent number (lib/hook-ids.js): what the render window puts into the name
  // of every creative that opens with this hook, so it belongs where the hook is chosen.
  const hookId = (it.meta && it.meta.hookId) || null;
  card.title = it.name + (it.meta && it.meta.character ? '\n' + it.meta.character : '');

  // The ratio lives on the box: an <img> with no loaded source contributes no height,
  // which collapsed the rows and killed the grid's scrolling.
  const src = _tileSrc(it);
  const box = document.createElement('div');
  box.className = 'lib-thumb-box' + (src ? '' : ' lib-thumb-pending');
  const img = document.createElement('img');
  img.className = 'lib-thumb';
  img.alt = it.name;
  img.decoding = 'async';
  // Native lazy: the browser fetches what is near the viewport and nothing else. A
  // hand-rolled observer looked equivalent but handed out no src at all in a view that
  // does not composite, leaving every card blank.
  img.loading = 'lazy';
  if (src) img.src = src;
  box.appendChild(img);

  // A render with no poster could not be opened by ffmpeg, which means the file is truncated
  // and no player will open it either. Said on the card, because the alternative is a card that
  // looks merely slow to load and plays nothing when clicked.
  if (it.meta && it.meta.unreadable) {
    box.classList.add('lib-thumb-broken');
    const bad = document.createElement('span');
    bad.className = 'lib-broken-tag';
    bad.textContent = 'unreadable';
    bad.title = 'The file is truncated - the render did not finish writing, so it cannot be played.';
    box.appendChild(bad);
  }

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
  if (hookId) {
    const tag = document.createElement('b');
    tag.className = 'lib-hid';
    tag.textContent = hookId;
    name.appendChild(tag);
  }
  name.appendChild(document.createTextNode(it.name));
  card.appendChild(name);

  // Second line: which category this clip is filed under, changeable in place. Only
  // where a category means something — hooks and the image shelves have none.
  if (_CATABLE.has(it.kind)) {
    card.appendChild(_picker('lib-cat-sel', (it.meta && it.meta.categoryId) || '',
      () => [{ id: '', label: '— no category —' }].concat(_catsFor(it.kind)),
      (id) => _setCat(it, id), 'Category'));
  }

  if (extra) card.appendChild(extra);
  // NO MENU ON A TILE (phase B7, the owner 2026-09-29) - the page's is gone, and the window's own
  // ("Copy image / Save image as", desktop/main.js) must not open in its place: it would save this
  // miniature, not the file. What the old menu offered is in the viewer and on the tile.
  card.addEventListener('contextmenu', (e) => e.preventDefault());
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
  // Voices are rows, not cards, and their info column is permanent - a shelf shaped
  // differently enough that it draws itself. See js/library/voices.js.
  if (_shelf === 'voices') {
    V.render(_items, {
      status: _status,
      labelKeys: _labelKeys,
      reload: () => _load({ keepScroll: true }),
      // The character's own sheet, in the same viewer every other shelf opens into. A list
      // of one: this sheet is reached from a voice, so there is nothing to page through.
      openSheet: (c) => c.sheet && openViewer([{ id: c.id, name: c.name, kind: 'characters',
        media: c.sheet, thumb: c.thumb, meta: {} }], 0, {}),
    });
    return;
  }
  // Music is rows for the same reason Voices are: there is no picture, and a grid of it
  // would be identical grey squares told apart only by their captions.
  if (_shelf === 'music') {
    MU.render(_items, { status: _status, reload: () => _load({ keepScroll: true }) });
    return;
  }
  // Scenarios are text, so they are rows too, and one is always selected with the right column
  // about it - see js/library/scenarios.js (phase D5).
  if (_shelf === 'scenarios') {
    // reload, not a local patch: a saved scenario changes its line count, and that count is the
    // store's answer rather than the editor's.
    SC.render(_items, { reload: () => _load({ keepScroll: true }), status: _status, counts: _counts });
    return;
  }
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
    if (PICKABLE.has(_shelf)) {
      // A picture shelf's tile SELECTS: the right column says what it is, and the enlarged view is
      // the column's picture pressed. Pressing the selected one again reads the column again (B4).
      card.classList.toggle('cur', String(it.id) === _sel);
      card.addEventListener('click', () => _pick(it));
    } else {
      card.addEventListener('click', () => _open(it));
    }
    grid.appendChild(card);
  }
}

// ── The selected tile, and the right column about it (phase B) ──────────────
function _paintSel() {
  document.querySelectorAll('#lib-grid .lib-card').forEach(c => c.classList.toggle('cur', c.dataset.id === _sel));
}

// Select a tile - or, when it is the selected one already, read its column again.
function _pick(it) {
  _sel = String(it.id);
  _paintSel();
  INFO.show(_shelf, it, _infoHooks);
}

// After every read of a picture shelf: the selection stays where it was while that tile is still
// there, and otherwise falls on the top-left one - a shelf just opened, the selected tile just
// deleted.
function _showSelected() {
  if (!PICKABLE.has(_shelf)) return;
  let it = _items.find(x => String(x.id) === _sel);
  if (!it) {
    it = _items[0] || null;
    _sel = it ? String(it.id) : '';
    _paintSel();
  }
  if (it) INFO.show(_shelf, it, _infoHooks);
  else INFO.empty(SHELVES[_shelf] || _shelf);
}

// What the column asks of the page: the viewer - with the selection following its steps - and a
// look's card, the same card the grid draws, cross and all.
const _infoHooks = {
  open: (it) => _open(it, null, (item) => { if (String(item.id) !== _sel) _pick(item); }),
  openLook: (l, list) => _open(l, list),
  card: (l) => _card(l),
};

async function _load(opts) {
  const grid0 = $('lib-grid');
  const scroll = (opts && opts.keepScroll && grid0) ? grid0.scrollTop : null;
  if (opts && opts.checks) _checksDue = true;
  const my = ++_reqId;
  closeConfirm();          // never leave one pointing at a chip that is about to be replaced
  _status('Reading…');
  _paintShelves();
  // The right column belongs to the picture shelves, where it says what the selected tile is, and to
  // Voices and Scenarios, whose modules fill it with the selected row. Every other shelf has the
  // whole width.
  if (!PICKABLE.has(_shelf) && _shelf !== 'voices' && _shelf !== 'scenarios') INFO.hide();
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
    _labelKeys = d.labelKeys || null;      // the tag order the voices shelf reads out
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
        return _load(opts);        // with what was asked of the first read, checks included
      }
    }
    _first = false;
    _paintFilters(d.filters, d.cats);
    _renderGrid();
    _showSelected();       // the column follows the shelf it was read with
    // MEDIA'S CHECKS ONLY WHEN THEY CAN HAVE CHANGED (phase D3, the owner 2026-09-29): entering Media,
    // and after an upload, a delete, a kind change, a category deleted with its clips, a clean or a
    // repair. They used to run on every read - every filter chip, every star - and twice as the
    // page opened; Thumbnails re-reads the whole shelf and opens every poster's header, and the
    // tiles' own pictures waited behind all of it.
    if (_checksDue) { _checksDue = false; _runChecks(); }
    if (scroll != null) { const g = $('lib-grid'); if (g) g.scrollTop = scroll; }
    _status('');
  } catch (e) {
    if (my !== _reqId) return;
    _items = [];
    _renderGrid();
    _showSelected();
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
  // Lines typed into a scenario and not saved are not thrown away without a word.
  if (_shelf === 'scenarios' && SC.unsaved()
    && !confirm('The lines of the open scenario have changes that are not saved. Leave them?')) return;
  if (_shelf === 'voices') V.leave();      // a demo must not keep playing into another shelf
  if (_shelf === 'music') MU.stopPreview();  // nor a backing track
  if (_shelf === 'scenarios') SC.leave();  // and an open line editor must not be waiting on return
  if (PICKABLE.has(_shelf)) INFO.leave();  // nor a character's voice, or an answer on its way
  _shelf = kind;
  _sel = '';                               // a shelf opens on its top-left tile (B2)
  try { localStorage.setItem(LS_SHELF, kind); } catch (e) {}
  _load({ checks: kind === 'media' });
}

// All three at once. Each one looks at the shelf again after its answer: one that lands after
// Media was left must not show its button on another shelf.
function _runChecks() {
  return Promise.all([_checkDupes(), _checkBroken(), _checkThumbs()]);
}

// ── Broken records ──────────────────────────────────────────────────────────
// Invisible until you notice the count: every shelf hides a record whose file is gone, so it
// shows up only as the gap between "shown" and "total".
let _broken = null;
async function _checkBroken() {
  const btn = $('lib-broken');
  if (!btn) return;
  if (_shelf !== 'media') { btn.hidden = true; return; }
  try { _broken = await A.findBroken(); } catch (e) { _broken = null; }
  if (_shelf !== 'media') { btn.hidden = true; return; }
  const n = _broken && _broken.total;
  btn.hidden = !n;
  if (n) {
    btn.textContent = 'Broken: ' + n;
    btn.title = n + ' record' + (n === 1 ? '' : 's') + ' whose file is not on disk';
  }
}

async function _cleanBroken() {
  if (!_broken || !_broken.total) return;
  const NL = String.fromCharCode(10);
  const lines = ['Records pointing at a file that is not there.', ''];
  for (const kind of ['birols', 'uploads', 'hooks']) {
    const b = (_broken.media || {})[kind];
    if (!b) continue;
    for (const e of b.missingFile) lines.push('  ' + kind + ': ' + e.name + '   - ' + e.why);
    for (const e of b.noFile) lines.push('  ' + kind + ': ' + e.name + '   - ' + e.why + (e.status ? ' (status ' + e.status + ')' : ''));
  }
  for (const l of (_broken.looks || [])) lines.push('  look: ' + l.name + '   - every image is gone');
  lines.push('');
  lines.push('The records are removed. There is no file to delete - that is the point.');
  lines.push('A generation still running is never swept.');
  lines.push('', 'Go ahead?');
  if (!confirm(lines.join(NL))) return;

  const btn = $('lib-broken');
  if (btn) btn.disabled = true;
  try {
    const r = await A.cleanBroken();
    await _load();
    _counts();
    await _runChecks();
    const parts = [];
    if (r.media) parts.push(r.media + ' media record' + (r.media === 1 ? '' : 's'));
    if (r.looks) parts.push(r.looks + ' look' + (r.looks === 1 ? '' : 's'));
    if (r.geni) parts.push(r.geni + ' history entr' + (r.geni === 1 ? 'y' : 'ies'));
    _status(parts.length ? ('Removed ' + parts.join(', ') + '; no files were deleted') : 'Nothing to remove');
  } catch (e) { _status(e.message, 'err'); }
  if (btn) btn.disabled = false;
}

// ── Duplicates ──────────────────────────────────────────────────────────────
// Only shows itself when there is something to clean, and says how much. Two records on one
// file is not a normal state, so a permanent control would be clutter.
let _dupes = null;
async function _checkDupes() {
  const btn = $('lib-dupes');
  if (!btn) return;
  if (_shelf !== 'media') { btn.hidden = true; return; }
  try { _dupes = await A.findDupes(); } catch (e) { _dupes = null; }
  if (_shelf !== 'media') { btn.hidden = true; return; }
  const n = _dupes && _dupes.total;
  btn.hidden = !n;
  if (n) {
    btn.textContent = 'Duplicates: ' + n;
    btn.title = n + ' record' + (n === 1 ? '' : 's') + ' point at a file another record already uses';
  }
}

async function _cleanDupes() {
  if (!_dupes || !_dupes.total) return;
  const g = _dupes.groups;
  const moves = _dupes.categoryChanges;
  const NL = String.fromCharCode(10);
  // Built as lines and joined, so the message stays readable in the source.
  const lines = [
    _dupes.total + ' record' + (_dupes.total === 1 ? '' : 's') + ' share a file with another record.',
    '',
    'The extra records are removed. NO file is deleted — the copy that stays uses',
    'the same video and the same thumbnail.',
    '',
    'Keeping the record that knows more (a prompt first, then the earlier one):',
  ];
  for (const x of g.slice(0, 6)) {
    lines.push('  keep ' + x.keep.name + '   —   drop ' + x.drop.map(d => d.name).join(', '));
  }
  if (g.length > 6) lines.push('  … and ' + (g.length - 6) + ' more');
  if (moves) {
    lines.push('');
    lines.push(moves + ' clip' + (moves === 1 ? '' : 's') + ' will show under a different category,');
    lines.push('because the copies disagreed and the kept one wins.');
  }
  lines.push('', 'Go ahead?');
  if (!confirm(lines.join(NL))) return;
  const btn = $('lib-dupes');
  if (btn) btn.disabled = true;
  try {
    const d = await A.cleanDupes();
    await _load();
    _counts();
    await _runChecks();
    _status('Removed ' + d.count + ' duplicate record' + (d.count === 1 ? '' : 's') + '; no files were deleted');
  } catch (e) { _status(e.message, 'err'); }
  if (btn) btn.disabled = false;
}

// ── Thumbnails ──────────────────────────────────────────────────────────────
// Same shape as Broken and Duplicates: invisible until there is something to fix, and the
// count is the whole message. A clip qualifies when it has no thumbnail, or when what it
// calls a thumbnail is really the full frame - both make the shelf cost megabytes to draw.
let _thumbs = null, _linked = false;
async function _checkThumbs() {
  const btn = $('lib-thumbs');
  if (!btn) return;
  if (_shelf !== 'media') { btn.hidden = true; return; }
  try {
    // The WHOLE shelf, not the filtered view. Duplicates and Broken both count across the
    // library, and a repair whose number moved with the selected chip would be worse than
    // useless: "fix the thumbnails" has to mean all of them, not the 21 currently on screen.
    const d = await (await fetch('/api/library/shelf/media')).json();
    const all = (d && d.items) || [];
    _thumbs = await A.auditThumbs(all);
    _thumbs.byId = new Map(all.map(it => [String(it.id), it]));

    // The blank cards are mostly not missing thumbnails - they are thumbnails the record
    // lost track of, and pointing at one costs a write, not a transcode. That is cheap
    // enough to just do, and leaving it behind a button meant staring at an empty grid
    // in both this page and Merge, which reads the same records. Generation stays on the
    // button: a hundred ffmpeg runs on page open, while a render is going, is not repair.
    const link = (_thumbs.link || []).filter(x => _thumbs.byId.has(String(x.id)));
    if (link.length && !_linked) {
      _linked = true;                                   // once per page - a failure must not loop
      _status('Reconnecting ' + link.length + ' thumbnail' + (link.length === 1 ? '' : 's') + '...');
      let done = 0;
      for (const x of link) {
        try { await A.linkThumb(_thumbs.byId.get(String(x.id)), x.thumb); done++; } catch (e) {}
      }
      _status(done ? ('Reconnected ' + done + ' thumbnail' + (done === 1 ? '' : 's')) : '');
      // Redraws the grid with the new posters - only if Media is still what is open: a reload of
      // another shelf would repaint Scenarios' column over lines being typed.
      if (_shelf === 'media') await _load({ keepScroll: true });
      return _checkThumbs();                            // and counts again; _linked stops a loop
    }
  } catch (e) { _thumbs = null; }
  if (_shelf !== 'media') { btn.hidden = true; return; }
  const n = _thumbs && _thumbs.need ? _thumbs.need.length : 0;
  btn.hidden = !n;
  if (n) {
    btn.textContent = 'Thumbnails: ' + n;
    btn.title = n + ' clip' + (n === 1 ? '' : 's') + ' with no thumbnail, or one that is really a full frame';
  }
}

async function _fixThumbs() {
  const need = (_thumbs && _thumbs.need) || [];
  if (!need.length) return;
  const btn = $('lib-thumbs');
  const NL = String.fromCharCode(10);
  const lines = [
    need.length + ' clip' + (need.length === 1 ? ' needs' : 's need') + ' a thumbnail.',
    '',
    'Each one is read once and a 320px poster is written next to it. Nothing is',
    'deleted and no clip is re-encoded.',
  ];
  // Said up front rather than discovered halfway: a clip whose file lives on another
  // machine cannot be fixed here, and its card will stay as it is.
  const gone = (_thumbs.missing || []).length;
  if (gone) lines.push('', gone + ' more ' + (gone === 1 ? 'is' : 'are') + ' not on this machine and will be skipped.');
  lines.push('', 'One at a time, so a render in progress keeps its CPU. Go ahead?');
  if (!confirm(lines.join(NL))) return;

  if (btn) btn.disabled = true;
  const byId = _thumbs.byId || new Map(_items.map(it => [String(it.id), it]));
  let done = 0, failed = 0;
  for (const n of need) {
    const it = byId.get(String(n.id));
    if (!it) { failed++; continue; }
    try { await A.fixThumb(it); done++; } catch (e) { failed++; }
    if (btn) btn.textContent = 'Thumbnails ' + (done + failed) + '/' + need.length;
  }
  await _load();
  _counts();
  await _runChecks();
  _status(
    'Made ' + done + ' thumbnail' + (done === 1 ? '' : 's') +
    (failed ? ('; ' + failed + ' could not be read') : ''),
    failed && !done ? 'err' : '',
  );
  if (btn) btn.disabled = false;
}

// ── Upload ──────────────────────────────────────────────────────────────────
// Only on Media: it is the one shelf whose contents are files you bring in rather than
// things the app made. The button lands them under the Uploads filter.
function _paintUpload() {
  const btn = $('lib-upload');
  const inp = $('lib-file');
  if (!btn) return;
  btn.hidden = _shelf !== 'media';
  if (btn.hidden) return;
  // The open KIND decides what can be brought in, so on Images the picker offers pictures
  // and nothing else. Same button, same shelf - only what it accepts changes.
  if (_filter === 'images') {
    btn.textContent = 'Upload images';
    btn.title = 'Add pictures to the library. A PNG keeps its transparency.';
    if (inp) inp.accept = 'image/*';
    return;
  }
  if (inp) inp.accept = 'video/*';
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
  if (_filter === 'images') {
    const ri = await A.uploadImages(list, (i, n, name) => _status('Uploading ' + i + '/' + n + ' - ' + name));
    if (btn) btn.disabled = false;
    if (ri.ok) { await _load({ checks: true }); _counts(); }
    _status(ri.ok === ri.total
      ? ('Uploaded ' + ri.ok + (ri.ok === 1 ? ' image' : ' images'))
      : (ri.ok + ' of ' + ri.total + ' uploaded'), ri.ok === ri.total ? '' : 'err');
    return;
  }
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
    await _load({ checks: true });
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

  const dup = $('lib-dupes');
  if (dup) dup.addEventListener('click', _cleanDupes);
  const brk = $('lib-broken');
  if (brk) brk.addEventListener('click', _cleanBroken);
  const thb = $('lib-thumbs');
  if (thb) thb.addEventListener('click', _fixThumbs);

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

  // Which library you are in, above the shelves. Mounted rather than written into the
  // markup so both library pages get the same list from one place.
  mountLibSwitch(document.getElementById('lib-shelves'));

  _wireCatSash();
  window.addEventListener('resize', _applyCatHeight);
  _loadCats().then(() => _load({ checks: true }));
  _counts();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
