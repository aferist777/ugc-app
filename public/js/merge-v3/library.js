/* ═══════════════════════════════════════════════════════════════════════════
   MERGE v3 — the Library panel: four groups, category filter, thumbnails, popup.

   The backend already had exactly this shape. `media` is ONE shelf holding every
   kind, split by a filter, and it hands back the category list for whichever
   kind is open:

     GET /api/library/shelf/media?filter=birols|hooks|uploads|images[&cat=<id>]
       -> { items, shown, total, filters, cats }

   so the four buttons and the dropdown are one endpoint, and the numbers they show
   come from the same response that fills the grid. A count here cannot disagree with
   what clicking it yields.

   There is no "all" button any more: it showed every group mixed together, and
   the category filter has no meaning across them (a birol tag and a hook tag are
   different lists). Every view is one group now.

   Thumbnails ONLY. The grid points an <img> at `thumb` and nothing loads the full
   media until the popup opens. For a clip that is a jpg already on disk; for an
   image it is /api/thumb, so even a 4K still never reaches a 65px cell.

   The star and the ✕ go through js/library/actions.js - the Library page's own
   module, not a copy. That matters for more than tidiness: those functions patch the
   matching localStorage key after the server write, and its header explains why. The
   birol and hook archives are browser-owned and pushed as whole snapshots by
   biroly-server-sync.js from whatever page is open, so writing only to the server
   here would let an open Birols tab push its stale copy back and resurrect exactly
   what was just deleted.
   ═══════════════════════════════════════════════════════════════════════════ */

import { openViewer } from '../library/viewer.js';
import { toggleFavorite, deleteItem, deleteWarning, uploadVideos, uploadImages } from '../library/actions.js';
import { DRAG_TYPE } from './store.js';
import { setOpenColumn } from './layout.js';

const LS_TAB = 'mv3_lib_tab';
const TABS = ['birols', 'hooks', 'uploads', 'images'];
// Stills are a kind on the same shelf as the clips, so the only thing this group does
// differently is what it accepts on the way in - one endpoint instead of two, because
// data/images.json is server-owned. Everything else is the same request.
const _isImages = () => _tab === 'images';
// One key per group: the category lists are per-group, so a category chosen in birols
// means nothing in hooks and must not be carried across.
const catKey = (tab) => 'mv3_lib_cat_' + tab;

let _items = [];      // what the grid is showing, and what the popup pages through
let _tab = 'birols';
let _cat = '';
let _seq = 0;         // guards against a slow response for a group you have left

function _body() { return document.querySelector('#mv3-library .mv3-panel-body'); }

function _note(text, isError) {
  const b = _body();
  if (!b) return;
  b.textContent = '';
  const d = document.createElement('div');
  d.className = 'mv3-empty';
  const t = document.createElement('b');
  t.textContent = isError ? 'Could not load' : _tab;
  const s = document.createElement('span');
  s.textContent = text;
  d.appendChild(t); d.appendChild(s);
  b.appendChild(d);
}

// ── One tile ────────────────────────────────────────────────────────────────
// Square, thumbnail only, with two controls that appear on hover: the star at the
// top left, the ✕ at the top right. Both stopPropagation - without it either one
// would also open the popup underneath.
function _tile(it, i) {
  const cell = document.createElement('div');
  cell.className = 'mv3-tile' + (it.meta && it.meta.favorite ? ' is-fav' : '');
  const hid = (it.meta || {}).hookId || null;
  cell.title = [hid, it.name, it.kind, (it.meta || {}).categoryId].filter(Boolean).join(' · ');

  if (it.thumb) {
    const img = document.createElement('img');
    // lazy + async: a group runs to hundreds of clips and most are below the fold.
    img.loading = 'lazy';
    img.decoding = 'async';
    img.src = it.thumb;
    img.alt = it.name || '';
    // A thumb whose file has gone would otherwise leave a broken-image glyph, which
    // reads as a bug in the grid rather than as a missing file.
    img.addEventListener('error', () => {
      img.remove();
      const s = document.createElement('span');
      s.className = 'mv3-tile-none';
      s.textContent = 'missing';
      cell.appendChild(s);
    }, { once: true });
    cell.appendChild(img);
  } else {
    const s = document.createElement('span');
    s.className = 'mv3-tile-none';
    s.textContent = 'no thumb';
    cell.appendChild(s);
  }

  // THE HOOK'S NUMBER, on the tile. It is what the render window puts in the creative's
  // name (lib/hook-ids.js), so which hook is H01 has to be answerable by looking rather
  // than by opening each one. Bottom left, out of the way of the star and the cross.
  if (hid) {
    const tag = document.createElement('span');
    tag.className = 'mv3-tile-hid';
    tag.textContent = hid;
    cell.appendChild(tag);
  }

  const star = document.createElement('button');
  star.type = 'button';
  star.className = 'mv3-tile-btn mv3-tile-star';
  star.textContent = '★';
  star.title = (it.meta && it.meta.favorite) ? 'Remove from favourites' : 'Add to favourites';
  star.addEventListener('click', async (e) => {
    e.stopPropagation();
    star.disabled = true;
    try {
      await toggleFavorite(it);
      // Reload rather than re-sorting here: favourites-first is the SERVER's ordering
      // (see _mediaShelf), and a second comparator in the page is a second answer that
      // would drift. A starred clip has to jump to the top left, which is what this does.
      await _load();
    } catch (err) { alert(err.message); star.disabled = false; }
  });
  cell.appendChild(star);

  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'mv3-tile-btn mv3-tile-del';
  del.textContent = '✕';
  del.title = 'Delete from the library';
  del.addEventListener('click', async (e) => {
    e.stopPropagation();
    // This removes the record AND its files from disk, so it asks first - with the
    // Library page's own wording, so the same action never reads two ways.
    if (!confirm(deleteWarning(it))) return;
    del.disabled = true;
    try {
      await deleteItem(it);
      await _load();
    } catch (err) { alert(err.message); del.disabled = false; }
  });
  cell.appendChild(del);

  // Draggable onto a timeline lane. What the payload does NOT carry is the kind: the
  // lane it lands on decides that. The old editor filed a drop by what was dragged,
  // which is how clips dropped on the Halfers lane ended up on the Birols track.
  cell.draggable = true;
  cell.addEventListener('dragstart', (e) => {
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData(DRAG_TYPE, JSON.stringify({
      libId: it.id, src: it.media, thumb: it.thumb || null, name: it.name || '',
      // Which shelf it came off. Blank projects need it: a birol lands with its sound
      // switched OFF, and nothing else about the payload says it is one. The talking-head
      // timeline never reads this.
      group: _tab,
      // Carried so the clip can be laid down at its real width immediately. 0 means the
      // shelf does not know, and the lane will read it off the file instead.
      dur: +it.dur || 0,
    }));
    cell.classList.add('is-dragging');
  });
  cell.addEventListener('dragend', () => cell.classList.remove('is-dragging'));

  cell.addEventListener('click', () => openViewer(_items, i));
  return cell;
}

// The upload cell, first in the grid. A tile-sized target rather than a header
// button because that is where files are dropped, and the two ways in should look
// like the same thing. It takes the top-left slot, so favourites lead the CLIPS
// rather than the grid.
function _plusTile() {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'mv3-tile mv3-plus';
  b.textContent = '+';
  b.title = _isImages()
    ? 'Add a picture to images - from this computer, or made here'
    : 'Add video files to ' + _tab + ' - click, or drop files anywhere on this panel';
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    // Pictures can be MADE as well as found, so on that shelf the plus asks which. On the
    // others there is one answer, and a menu with one item is a click nobody asked for.
    if (_isImages()) _plusMenu(b);
    else _pickFiles();
  });
  return b;
}

function _pickFiles() {
  const inp = document.getElementById('mv3-lib-file');
  if (inp) inp.click();
}

// ── The two ways a picture gets onto the shelf ──────────────────────────────
// A small menu under the plus rather than a second tile beside it: they are two answers to
// one question - where is this picture coming from - and two tiles would read as two
// different things to add.
let _plus = null;

function _closePlus() {
  if (!_plus) return;
  _plus.el.remove();
  document.removeEventListener('mousedown', _plus.away, true);
  document.removeEventListener('keydown', _plus.key, true);
  window.removeEventListener('scroll', _closePlus, true);
  _plus = null;
}

function _plusMenu(anchor) {
  if (_plus) { _closePlus(); return; }               // the same press closes it again

  const el = document.createElement('div');
  el.className = 'mv3-plus-menu';

  const item = (label, sub, on) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'mv3-plus-item';
    const t = document.createElement('span');
    t.textContent = label;
    b.appendChild(t);
    if (sub) {
      const s = document.createElement('small');
      s.textContent = sub;
      b.appendChild(s);
    }
    b.addEventListener('click', (e) => { e.stopPropagation(); _closePlus(); on(); });
    el.appendChild(b);
  };

  item('load from local', 'pictures from this computer', _pickFiles);
  // Loaded on demand: the picture window is a thousand lines and a stylesheet, and most
  // visits to this panel never open it.
  item('generate', 'make one with a model', async () => {
    try {
      const M = await import('./imagen.js');
      await M.openImagen();
    } catch (err) {
      _status('Could not open the picture window: ' + ((err && err.message) || err), true);
    }
  });

  // Fixed to the viewport and parked on the body: the panel scrolls and clips its own
  // children, and the grid is the thing being scrolled.
  document.body.appendChild(el);
  const r = anchor.getBoundingClientRect();
  const w = el.offsetWidth, h = el.offsetHeight;
  el.style.left = Math.round(Math.max(6, Math.min(window.innerWidth - w - 6, r.left))) + 'px';
  const below = r.bottom + 4;
  el.style.top = Math.round(below + h <= window.innerHeight - 6 ? below : Math.max(6, r.top - h - 4)) + 'px';

  const away = (e) => { if (!el.contains(e.target) && e.target !== anchor) _closePlus(); };
  const key = (e) => { if (e.key === 'Escape') { e.preventDefault(); _closePlus(); } };
  _plus = { el, away, key };
  document.addEventListener('mousedown', away, true);
  document.addEventListener('keydown', key, true);
  window.addEventListener('scroll', _closePlus, true);
}

function _paint() {
  const b = _body();
  if (!b) return;
  b.textContent = '';
  const grid = document.createElement('div');
  grid.className = 'mv3-grid';
  grid.appendChild(_plusTile());
  // An empty shelf still gets the grid - it is how files get onto it in the first
  // place, so replacing it with an "empty" placard would hide the only way in.
  if (!_items.length) {
    const s = document.createElement('span');
    s.className = 'mv3-grid-note';
    s.textContent = _cat ? 'nothing in this category' : 'empty - drop files here';
    b.appendChild(grid);
    b.appendChild(s);
    return;
  }
  _items.forEach((it, i) => grid.appendChild(_tile(it, i)));
  b.appendChild(grid);
}

// ── Upload ──────────────────────────────────────────────────────────────────
// uploadVideos() is the Library page's own two-step: /api/biroly/upload owns the
// file AND makes its thumbnail, then /api/library/media/record files the record
// under the given kind. So a drop lands in whichever group is open, and the new
// tile arrives with a real thumbnail rather than a full video in a 65px box.
const VIDEO_RE = /\.(mp4|webm|mov|m4v|avi|mkv)$/i;

function _status(text, bad) {
  const el = document.getElementById('mv3-lib-status');
  if (!el) return;
  el.textContent = text || '';
  el.hidden = !text;
  el.classList.toggle('is-bad', !!bad);
}

// Locked while files are in flight: switching group mid-upload would file the rest
// of the batch under a different kind than the one you dropped them on.
function _lock(on) {
  document.querySelectorAll('#mv3-library .mv3-seg-btn').forEach(b => { b.disabled = on; });
  const sel = document.getElementById('mv3-lib-cat');
  if (sel) sel.disabled = on;
  document.querySelectorAll('#mv3-library .mv3-plus').forEach(b => { b.disabled = on; });
}

const IMAGE_RE = /\.(jpe?g|png|webp)$/i;

// The same flow with one call instead of two: data/images.json is server-owned, so
// /api/images/upload takes the file, makes the thumbnails and files the record in one
// request. Nothing here has to unshift into localStorage afterwards.
async function _uploadImages(files) {
  const pics = (files || []).filter(f => /^image\//.test(f.type || '') || IMAGE_RE.test(f.name || ''));
  const skipped = (files || []).length - pics.length;
  if (!pics.length) {
    _status('Only pictures can go on this shelf', true);
    return;
  }
  _lock(true);
  _status('uploading 0/' + pics.length + '…');
  try {
    const r = await uploadImages(pics, (i, n, name) => _status('uploading ' + i + '/' + n + ' · ' + name));
    const failed = r.total - r.ok;
    _status(failed ? (failed + ' of ' + r.total + ' failed') + (skipped ? ', ' + skipped + ' not an image' : '')
                   : (r.ok + ' added') + (skipped ? ', ' + skipped + ' skipped (not an image)' : ''), !!failed);
    // Filed with no category, so a category filter would hide what you just added.
    if (r.ok && _cat) {
      _cat = '';
      try { localStorage.setItem(catKey(_tab), ''); } catch (e2) {}
    }
  } catch (e) {
    _status(e.message, true);
  } finally {
    _lock(false);
    await _load();
  }
}

async function _upload(files) {
  if (_isImages()) return _uploadImages(files);
  const vids = (files || []).filter(f => /^video\//.test(f.type || '') || VIDEO_RE.test(f.name || ''));
  const skipped = (files || []).length - vids.length;
  if (!vids.length) {
    _status('Only video files can go on this shelf', true);
    return;
  }
  _lock(true);
  _status('uploading 0/' + vids.length + '…');
  try {
    const r = await uploadVideos(vids, _tab, (i, n, name) => _status('uploading ' + i + '/' + n + ' · ' + name));
    const failed = r.total - r.ok;
    _status(failed ? (failed + ' of ' + r.total + ' failed') + (skipped ? ', ' + skipped + ' not video' : '')
                   : (r.ok + ' added') + (skipped ? ', ' + skipped + ' skipped (not video)' : ''), !!failed);
    // A new record is filed with NO category (/api/library/media/record takes only the
    // kind), so with a category filter on, an upload would land outside the current view
    // and read as having done nothing. Clearing the filter is the only way the files you
    // just added are the files you see.
    if (r.ok && _cat) {
      _cat = '';
      try { localStorage.setItem(catKey(_tab), ''); } catch (e2) {}
    }
  } catch (e) {
    _status(e.message, true);
  } finally {
    _lock(false);
    await _load();      // the shelf sorts newest first, so the new clips land beside the +
  }
}

// Only OS-file drags are ours. An internal drag carries no 'Files' type, which is
// how dragging a tile onto a timeline lane later stays untouched by this.
const _hasFiles = (e) => Array.from((e.dataTransfer && e.dataTransfer.types) || []).indexOf('Files') >= 0;

function _wireDrop() {
  const panel = document.getElementById('mv3-library');
  if (!panel) return;
  panel.addEventListener('dragover', (e) => {
    if (!_hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    panel.classList.add('is-drop');
  });
  panel.addEventListener('dragleave', (e) => {
    // Ignore leaves onto children, or the highlight flickers off over every tile.
    if (!e.relatedTarget || !panel.contains(e.relatedTarget)) panel.classList.remove('is-drop');
  });
  panel.addEventListener('drop', (e) => {
    if (!_hasFiles(e)) return;
    e.preventDefault();
    panel.classList.remove('is-drop');
    _upload(Array.from((e.dataTransfer && e.dataTransfer.files) || []));
  });

  // A miss must not navigate. Dropping a file on a page the browser thinks is not
  // interested REPLACES it with the file - losing whatever was open.
  for (const ev of ['dragover', 'drop']) {
    window.addEventListener(ev, (e) => {
      if (!_hasFiles(e) || panel.contains(e.target)) return;
      e.preventDefault();
    });
  }
}

// ── The category dropdown ───────────────────────────────────────────────────
// Options come from the response, and the server builds them BEFORE applying the
// category filter - so choosing one does not make every other option read 0.
//
// EMPTY CATEGORIES ARE NOT OFFERED. The category lists are shared across groups
// (a tag made for hooks is in the same list a birol can use), so most groups only
// ever fill a handful of them; listing the rest made the dropdown mostly dead
// options that lead to an empty grid. Uncategorized is dropped by the same rule -
// it is a count like any other, and at 0 there is nothing behind it.
//
// Returns true when the selected category is no longer on offer, so the caller can
// reload. Resetting it here alone would leave the select reading "all" over a grid
// that is still filtered by the category that vanished.
function _paintCats(cats, groupCount) {
  const sel = document.getElementById('mv3-lib-cat');
  if (!sel) return false;
  sel.textContent = '';
  const all = document.createElement('option');
  all.value = '';
  all.textContent = 'all' + (groupCount != null ? ' · ' + groupCount : '');
  sel.appendChild(all);
  for (const c of (cats || [])) {
    if (!(+c.count > 0)) continue;
    const o = document.createElement('option');
    o.value = c.id;
    o.textContent = c.label || c.name || c.id;
    sel.appendChild(o);
  }
  const dropped = !!_cat && !Array.from(sel.options).some(o => o.value === _cat);
  if (dropped) {
    _cat = '';
    try { localStorage.setItem(catKey(_tab), ''); } catch (e) {}
  }
  sel.value = _cat;
  return dropped;
}

// The counts sit on the buttons' tooltips rather than in their labels: the labels are
// the group names, and three labels plus three numbers do not fit the header.
function _paintCounts(d) {
  for (const f of (d.filters || [])) {
    const el = document.querySelector(`.mv3-seg-btn[data-tab="${f.id}"]`);
    const n = String(f.label || '').split('·').pop().trim();
    if (el && n) el.title = f.id + ' · ' + n;
  }
}

function _groupCount(d) {
  const f = (d.filters || []).find(x => x.id === _tab);
  const n = f ? parseInt(String(f.label).split('·').pop().trim(), 10) : NaN;
  return isNaN(n) ? null : n;
}

async function _load() {
  const mine = ++_seq;
  _note('loading…');
  const q = new URLSearchParams({ filter: _tab });
  if (_cat) q.set('cat', _cat);
  try {
    const d = await fetch('/api/library/shelf/media?' + q).then(r => r.json());
    if (mine !== _seq) return;                 // a later click already won
    if (!d || !d.success) throw new Error((d && d.error) || 'shelf refused');
    _items = (d.items || []).filter(i => i && i.media);
    _paintCounts(d);
    // The selected category can stop existing between loads - the last clip in it gets
    // deleted, or moved to another group. Then this list is the wrong one and has to be
    // fetched again unfiltered. Terminates after one retry: _cat is '' by now, and the
    // "all" option is always present.
    if (_paintCats(d.cats, _groupCount(d))) return _load();
    _paint();
  } catch (e) {
    if (mine !== _seq) return;
    _note(e.message, true);
  }
}

function _setTab(tab) {
  _tab = TABS.indexOf(tab) >= 0 ? tab : 'birols';
  document.querySelectorAll('.mv3-seg-btn').forEach(b => {
    b.classList.toggle('is-on', b.dataset.tab === _tab);
  });
  try {
    localStorage.setItem(LS_TAB, _tab);
    _cat = localStorage.getItem(catKey(_tab)) || '';
  } catch (e) { _cat = ''; }
  _load();
}

// Show a particular group, optionally scrolled to one category, and open the panel if it
// is the collapsed one. Used after a screenshot: the picture has just been filed somewhere,
// and being shown where beats being told.
//
// The category is matched by LABEL rather than id because the caller knows what it asked
// the server for ("Screenshots") and not which id that resolved to. A label that is not in
// this group's list simply leaves the filter alone rather than emptying the grid.
export async function showGroup(tab, catLabel) {
  if (TABS.indexOf(tab) < 0) return;
  setOpenColumn('library');
  _setTab(tab);
  if (!catLabel) return;
  // _setTab kicks off its own load; this one runs after it and is what actually filters.
  await _load();
  const sel = document.getElementById('mv3-lib-cat');
  const opt = sel && [...sel.options].find(o => o.textContent.split('·')[0].trim().toLowerCase() === String(catLabel).toLowerCase());
  if (!opt) return;
  _cat = opt.value;
  try { localStorage.setItem(catKey(_tab), _cat); } catch (e) {}
  await _load();
}

export function initLibrary() {
  document.querySelectorAll('.mv3-seg-btn').forEach(b => {
    b.addEventListener('click', (e) => {
      // The collapsed column is itself a button that opens the panel; without this a
      // click on a group button would bubble up and read as "open me" as well.
      e.stopPropagation();
      _setTab(b.dataset.tab);
    });
  });

  const sel = document.getElementById('mv3-lib-cat');
  if (sel) {
    sel.addEventListener('click', (e) => e.stopPropagation());
    sel.addEventListener('change', () => {
      _cat = sel.value || '';
      try { localStorage.setItem(catKey(_tab), _cat); } catch (e) {}
      _load();
    });
  }

  const inp = document.getElementById('mv3-lib-file');
  if (inp) {
    inp.addEventListener('change', () => {
      // Copy the FileList BEFORE clearing the input: input.files is live, so
      // `value = ''` empties the very list you are about to read. Clearing is still
      // needed, or picking the same file twice fires no change event.
      const files = Array.from(inp.files || []);
      inp.value = '';
      _upload(files);
    });
  }
  _wireDrop();

  let saved = null;
  try { saved = localStorage.getItem(LS_TAB); } catch (e) {}
  _setTab(saved && saved !== 'media' ? saved : 'birols');
}
