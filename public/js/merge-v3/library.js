/* ═══════════════════════════════════════════════════════════════════════════
   MERGE v3 — the Library panel: the gallery on the left, the media tree on the right (phase V28.4, the owner
   2026-10-12: "в правом столбце древовидное отображение медиа директории ... при клике на главную категорию
   отображается все что есть по категории"). The tree is js/media-tree.js - the same one the Library's Media shelf
   shows; a sash between them, its width remembered, a double press for the default.

   The node selected in the tree is what the gallery shows - its `q` is what the media shelf is asked:

     GET /api/library/shelf/media?group=video|images|audio | filter=<kind>[&cat=<id>]
       -> { items, shown, total, filters, cats }

   Thumbnails ONLY. The grid points an <img> at `thumb` and nothing loads the full media until the viewer opens. A
   SOUND or a TRACK has no picture: its tile is a note with its length, and a press plays it right there - no window
   (the owner: "воспроизведение по клику на аудио без попапов. Клик в другом месте останавливает проигрывание").

   A tile is dragged onto a lane (it says what it is - video, picture or sound - and a lane takes only its own,
   timeline-b.js) or onto a node of the tree (another category, another kind of video - js/media-tree.js).

   The star and the ✕ go through js/library/actions.js - the Library page's own module, not a copy.
   ═══════════════════════════════════════════════════════════════════════════ */

import { openViewer, closeViewer, repaint as repaintViewer } from '../library/viewer.js';
import * as Layers from '../layers.js';
import { toggleFavorite, deleteItem, deleteQuestion, uploadVideos, uploadImages, uploadSounds, uploadMusic,
         loadCats, setCategory, setKind, KINDS, trimItem, createCategory } from '../library/actions.js';
import { trimmer } from './trim.js';
import { DRAG_TYPE, DRAG_MEDIA, markGone } from './store.js';
import { setOpenColumn } from './layout.js';
import { PICTURE_ACCEPT, isPictureFile } from '../picture-file.js';
import { askName } from '../name-box.js';
import { openPictures } from './picchat.js';
import * as Views from './lib-views.js';
import * as LK from '../library/links.js';
import { createTree, setMediaDrag } from '../media-tree.js';

const VIDEO = new Set(['birols', 'hooks', 'uploads']);
const AUDIO = new Set(['music', 'sounds']);
const AUDIO_ACCEPT = 'audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac,.opus';
const LS_TREE_W = 'mv3_lib_tree_w';
const TREE_DEF = 180, TREE_MIN = 120, TREE_MAX = 420;

let _items = [];      // what the grid is showing, and what the viewer pages through
let _tree = null;
let _node = null;     // the tree's selected node - what the gallery shows
let _seq = 0;         // guards against a slow response for a node you have left

const _kind = () => (_node && _node.kind) || '';
const _isImages = () => _kind() === 'images';
const _isAudio = () => AUDIO.has(_kind()) || (_node && _node.key === 'audio');
// Where a clip brought in lands: the kind selected, or Uploads under Video (the owner: "загрузка в него - в Uploads").
const _videoKind = () => (VIDEO.has(_kind()) ? _kind() : (_node && _node.key === 'video') ? 'uploads' : '');
const _catOf = () => (_node && _node.cat && !_node.uncat ? _node.cat : '');
const _mediaOf = (it) => (AUDIO.has(it.kind) ? 'audio' : it.kind === 'images' ? 'image' : 'video');

function _body() { return document.querySelector('#mv3-library .mv3-panel-body'); }

function _note(text, isError) {
  const b = _body();
  if (!b) return;
  b.textContent = '';
  const d = document.createElement('div');
  d.className = 'mv3-empty';
  const t = document.createElement('b');
  t.textContent = isError ? 'Could not load' : ((_node && _node.label) || 'Library');
  const s = document.createElement('span');
  s.textContent = text;
  d.appendChild(t); d.appendChild(s);
  b.appendChild(d);
}

// ── Hearing a sound or a track, right on its tile ──────────────────────────
// One at a time; a press anywhere else stops it.
let _hear = null;
function _stopHearing() {
  if (!_hear) return;
  try { _hear.audio.pause(); } catch (e) { /* gone */ }
  document.removeEventListener('mousedown', _hear.away, true);
  if (_hear.cell) _hear.cell.classList.remove('is-playing');
  _hear = null;
}
function _play(it, cell) {
  if (_hear && _hear.id === it.id) { _stopHearing(); return; }
  _stopHearing();
  const audio = new Audio(it.media);
  const away = (e) => { if (!cell.contains(e.target)) _stopHearing(); };
  _hear = { id: it.id, audio, cell, away };
  cell.classList.add('is-playing');
  audio.addEventListener('ended', () => { if (_hear && _hear.audio === audio) _stopHearing(); });
  document.addEventListener('mousedown', away, true);
  audio.play().catch(() => { _stopHearing(); _status('That file will not play', true); });
}

const _mmss = (s) => {
  if (!(s > 0)) return '';
  const m = Math.floor(s / 60);
  return m + ':' + String(Math.round(s - m * 60)).padStart(2, '0');
};

// ── One tile ────────────────────────────────────────────────────────────────
// Square, thumbnail only, with two controls that appear on hover: the star at the
// top left, the ✕ at the top right. Both stopPropagation - without it either one
// would also open the viewer underneath.
function _tile(it, list) {
  const cell = document.createElement('div');
  const audio = AUDIO.has(it.kind);
  cell.className = 'mv3-tile' + (audio ? ' is-sound' : '') + (it.meta && it.meta.favorite ? ' is-fav' : '');
  // No menu on a tile (phase V23, the owner: one rule everywhere): "Save image as" would save the miniature.
  cell.addEventListener('contextmenu', (e) => e.preventDefault());
  // Which file, so a tile can be found by what it shows (reveal, below).
  cell.dataset.media = String(it.media || '').split('?')[0];
  const hid = (it.meta || {}).hookId || null;
  cell.title = [hid, it.name, it.meta && it.meta.style, _mmss(it.dur)].filter(Boolean).join(' · ');

  if (audio) {
    const note = document.createElement('span');
    note.className = 'mv3-tile-note';
    note.textContent = '♪';
    cell.appendChild(note);
    const nm = document.createElement('span');
    nm.className = 'mv3-tile-sname';
    nm.textContent = it.name || '';
    cell.appendChild(nm);
    if (it.dur) {
      const d = document.createElement('span');
      d.className = 'mv3-tile-dur';
      d.textContent = _mmss(it.dur);
      cell.appendChild(d);
    }
  } else if (it.thumb) {
    const img = document.createElement('img');
    // lazy + async: a group runs to hundreds of clips and most are below the fold.
    img.loading = 'lazy';
    img.decoding = 'async';
    // A picture's miniature is the 440px tier, as on the Library page: a tile is ~100px (phase J4).
    img.src = String(it.thumb).replace('&v=card', '&v=strip');
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
      // Reload rather than re-sorting here: favourites-first is the SERVER's ordering.
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
    // This removes the record AND its files from disk, so it asks first - with the Library page's own wording, and the
    // projects that use it (phase V28.4).
    del.disabled = true;
    if (!confirm(await deleteQuestion(it))) { del.disabled = false; return; }
    try {
      if (_hear && _hear.id === it.id) _stopHearing();
      await deleteItem(it);
      markGone(it.media);
      await _reload();
    } catch (err) { alert(err.message); del.disabled = false; }
  });
  cell.appendChild(del);

  // Draggable onto a timeline lane - what it is rides along (DRAG_MEDIA), and the lane decides whether it takes it -
  // and onto a node of the tree (setMediaDrag).
  cell.draggable = true;
  cell.addEventListener('dragstart', (e) => {
    e.dataTransfer.effectAllowed = 'copyMove';
    const media = _mediaOf(it);
    e.dataTransfer.setData(DRAG_TYPE, JSON.stringify({
      libId: it.id, src: it.media, thumb: it.thumb || null, name: it.name || '',
      // Which shelf it came off. Blank projects need it: a birol lands with its sound switched OFF.
      group: it.kind,
      // Carried so the clip can be laid down at its real width immediately. 0 means the
      // shelf does not know, and the lane will read it off the file instead.
      dur: +it.dur || 0,
      media,
      // (phase V28.4) A track of music lies under the rest as a bed: half volume, never transcribed.
      bed: it.kind === 'music',
    }));
    e.dataTransfer.setData(DRAG_MEDIA + media, '1');
    setMediaDrag(e.dataTransfer, it);
    cell.classList.add('is-dragging');
  });
  cell.addEventListener('dragend', () => cell.classList.remove('is-dragging'));

  if (audio) cell.addEventListener('click', () => _play(it, cell));
  else cell.addEventListener('click', () => openViewer(list, list.indexOf(it), _viewerOpts()));
  return cell;
}

// ── What can be done to a clip from inside the viewer ───────────────────────
// A clip is sorted while it is being LOOKED AT - that is when you know what it is. So the viewer carries the KIND and
// the CATEGORY in the right column (the same calls as the Library page, js/library/actions.js), a way to make a
// category that does not exist yet, and - for a clip somebody uploaded - the one trim it is allowed.
const CATABLE = new Set(['birols', 'uploads', 'hooks', 'images']);
// The kinds a clip can be moved between. These three and no others: a still lives in a
// different store and is not a clip to be re-filed as one.
const KINDABLE = new Set(['birols', 'uploads', 'hooks']);
const NEW_CAT = '__new__';
let _allCats = null;

// A picture opens at the 2048px preview tier, never the 4K original (phase J4).
const _viewerOpts = () => ({
  extraRows: _viewerRows, underStage: _underStage,
  showSrc: (it) => (it.kind === 'images' ? '/api/thumb?src=' + encodeURIComponent(it.media) + '&v=main' : null),
});

function _viewerRows(item) {
  if (!item) return [];
  const rows = [];
  if (KINDABLE.has(item.kind)) rows.push(['kind', _kindSelect(item)]);
  if (CATABLE.has(item.kind)) rows.push(['category', _categorySelect(item)]);
  // Said once and quietly: it cannot be done again, and what it was cut to is worth knowing.
  const tr = item.meta && item.meta.trimmed;
  if (tr) rows.push(['trimmed', (+tr.in).toFixed(1) + 's – ' + (+tr.out).toFixed(1) + 's of the upload']);
  return rows;
}

// ── kind ──
// Moving a clip to another kind moves it off this shelf, so the viewer closes and the grid is read again.
function _kindSelect(item) {
  const sel = document.createElement('select');
  sel.className = 'lib-view-sel';
  sel.title = 'Which kind of clip this is';
  for (const k of KINDS) {
    const o = document.createElement('option');
    o.value = k.id; o.textContent = k.label;
    sel.appendChild(o);
  }
  sel.value = item.kind;
  sel.addEventListener('change', async () => {
    const to = sel.value;
    if (to === item.kind) return;
    sel.disabled = true;
    try {
      await setKind(item, to);
      const label = (KINDS.find(k => k.id === to) || {}).label || to;
      closeViewer();
      _status('Moved to ' + label + 's.');
      setTimeout(() => _status(''), 2400);
      await _reload();
    } catch (e) {
      _status('Could not move it: ' + e.message, true);
      sel.value = item.kind;
      sel.disabled = false;
    }
  });
  return sel;
}

// ── category, and making one ──
// The whole list for the item's kind - a new clip belongs in a category that may still be empty. The first line makes
// a new one, named in a small box and given to this clip in the same breath.
function _categorySelect(item) {
  const sel = document.createElement('select');
  sel.className = 'lib-view-sel';
  sel.title = 'Which category this is filed under';
  let current = (item.meta && item.meta.categoryId) || '';

  const fill = (list) => {
    sel.textContent = '';
    const make = document.createElement('option');
    make.value = NEW_CAT; make.textContent = '+ category';
    sel.appendChild(make);
    const none = document.createElement('option');
    none.value = ''; none.textContent = '— no category —';
    sel.appendChild(none);
    for (const c of (list || [])) {
      const o = document.createElement('option');
      o.value = c.id; o.textContent = c.title || c.label;
      sel.appendChild(o);
    }
    sel.value = current;
    // One this clip points at that is not in the list any more still reads as itself.
    if (sel.value !== current) {
      const o = document.createElement('option');
      o.value = current; o.textContent = current; sel.appendChild(o); sel.value = current;
    }
  };
  const refill = async () => {
    try { _allCats = await loadCats(); } catch (e) { _allCats = _allCats || {}; }
    fill((_allCats || {})[item.kind] || []);
  };
  fill([]);
  refill();

  const file = async (id, label) => {
    sel.disabled = true;
    try {
      await setCategory(item, id, label);
      current = id;
      if (item.meta) item.meta.categoryId = id;
      _status('Filed under ' + (label || 'no category') + '.');
      setTimeout(() => _status(''), 2200);
      // The grid behind may be one category: the clip may have to leave it - read again, the counts too.
      _reload();
    } catch (e) {
      _status('Could not change the category: ' + e.message, true);
      sel.value = current;
    } finally {
      sel.disabled = false;
    }
  };

  sel.addEventListener('change', () => {
    if (sel.value === NEW_CAT) {
      sel.value = current;                 // the choice is not made until the name is
      _askCategoryName(sel, item.kind, async (cat) => {
        await refill();
        sel.value = cat.id;
        await file(cat.id, cat.label);
      });
      return;
    }
    const id = sel.value;
    const c = (((_allCats || {})[item.kind]) || []).find(x => x.id === id);
    file(id, id ? (c ? c.label : ((sel.selectedOptions[0] || {}).textContent || '')) : '');
  });
  return sel;
}

// A new category, named beside the dropdown it came from (js/name-box.js). A name already on the
// list is refused in the box rather than made twice.
async function _askCategoryName(anchor, kind, onMade) {
  const cat = await askName({
    anchor, title: 'New ' + kind.replace(/s$/, '') + ' category', okLabel: 'Create', maxLength: 60,
    check: (name) => {
      const taken = ((_allCats || {})[kind] || []).find(c => String(c.label).toLowerCase() === name.toLowerCase());
      return taken ? 'There is already a category called ' + (taken.title || taken.label) + '.' : '';
    },
    submit: async (name) => (await createCategory(kind, name)).cat,
  });
  if (cat) await onMade(cat);
}

// ── the one trim an upload is allowed ──
// Under the video, and only for a clip that was uploaded by hand and has not been trimmed yet.
// Saving asks once, because it cannot be undone here: the file is cut, the clip on the shelf
// becomes the cut, and the trimmer goes away for good. The original stays on disk where it was,
// so a timeline that already uses the clip is not touched.
function _underStage(item, video) {
  if (!item || !KINDABLE.has(item.kind)) return null;
  if (!(item.meta && item.meta.trimmable)) return null;

  const wrap = document.createElement('div');
  wrap.className = 'mv3-trimbox';
  const t = trimmer(video);
  wrap.appendChild(t.el);
  const save = document.createElement('button');
  save.type = 'button';
  save.className = 'mv3-trimbox-save';
  save.textContent = 'Save trim';
  save.title = 'Cut the clip to this stretch. It can be done once, and not undone here.';
  wrap.appendChild(save);

  save.addEventListener('click', async () => {
    const { in: a, out: b, dur } = t.get();
    if (!(dur > 0)) return;
    if (a <= 0.05 && b >= dur - 0.05) { _status('Move a handle first - that is the whole clip.', true); return; }
    if (!confirm('Trim this clip to ' + a.toFixed(1) + 's – ' + b.toFixed(1) + 's?\n\n'
      + 'This can be done once. The library will show only the trimmed clip from now on, and there is '
      + 'no way back to the full length here. Projects that already use it are not affected.')) return;
    save.disabled = true;
    save.textContent = 'Trimming…';
    try {
      const patch = await trimItem(item, a, b);
      // The same object the grid and the viewer both hold: changed in place, so the viewer can
      // simply draw it again - now playing the short file, without a trimmer.
      item.media = patch.videoPath;
      if (patch.thumbPath) item.thumb = patch.thumbPath;
      item.dur = patch.duration || item.dur;
      item.meta = Object.assign({}, item.meta, { trimmable: false, trimmed: patch.trimmed });
      t.destroy();
      repaintViewer();
      _status('Trimmed to ' + (b - a).toFixed(1) + ' s.');
      setTimeout(() => _status(''), 2400);
      _load();
    } catch (e) {
      save.disabled = false;
      save.textContent = 'Save trim';
      _status('Could not trim it: ' + e.message, true);
    }
  });
  return wrap;
}

// The upload cell, first in the grid. A tile-sized target rather than a header button because that is where files are
// dropped, and the two ways in should look like the same thing. What it offers follows the node (the owner): clips -
// a file or a link; pictures - a file, or made here; a sound or a track - a file.
function _plusTile() {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'mv3-tile mv3-plus';
  b.textContent = '+';
  b.title = _isImages() ? 'Add a picture to Images - from this computer, or made here'
    : _isAudio() ? 'Add music or sounds from this computer'
    : 'Add videos to ' + _tree.kindLabel(_videoKind()) + ' - from this computer or by a link; or drop files or a link anywhere on this panel';
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    _plusMenu(b);
  });
  return b;
}

let _pickFor = '';        // what the file dialog is open for: '' (the node's own), 'music' or 'sounds'
function _pickFiles(what) {
  const inp = document.getElementById('mv3-lib-file');
  if (!inp) return;
  _pickFor = what || '';
  inp.accept = _isImages() ? PICTURE_ACCEPT : _isAudio() ? AUDIO_ACCEPT : 'video/*';
  inp.click();
}

// ── The ways something gets onto the shelf ──────────────────────────────────
// A small menu under the plus rather than a second tile beside it: they are answers to
// one question - where is this coming from.
let _plus = null;

function _closePlus() {
  if (!_plus) return;
  _plus.el.remove();
  document.removeEventListener('mousedown', _plus.away, true);
  Layers.close(_plus.layer);
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

  if (_isImages()) {
    item('load from local', 'pictures from this computer', () => _pickFiles());
    // The pictures chat, in this panel's place (phase J).
    item('generate', 'make one with a model', () => openPictures());
  } else if (_isAudio()) {
    if (_kind() !== 'sounds') item('music from this computer', 'a track - mp3, wav, m4a…', () => _pickFiles('music'));
    if (_kind() !== 'music') item('sounds from this computer', 'sound effects, into SFX' + (_catOf() ? ' · ' + _node.label : ''), () => _pickFiles('sounds'));
  } else {
    item('load from local', 'video files from this computer', () => _pickFiles());
    // (phase V27) A clip by a link - the field opens where the menu was.
    item('from a link', 'YouTube, TikTok, Instagram and other sites', () => _linkBox(anchor));
  }

  // Fixed to the viewport and parked on the body: the panel scrolls and clips its own
  // children, and the grid is the thing being scrolled.
  document.body.appendChild(el);
  const r = anchor.getBoundingClientRect();
  const w = el.offsetWidth, h = el.offsetHeight;
  el.style.left = Math.round(Math.max(6, Math.min(window.innerWidth - w - 6, r.left))) + 'px';
  const below = r.bottom + 4;
  el.style.top = Math.round(below + h <= window.innerHeight - 6 ? below : Math.max(6, r.top - h - 4)) + 'px';

  const away = (e) => { if (!el.contains(e.target) && e.target !== anchor) _closePlus(); };
  // A menu, not a window: Escape closes it first and the page keeps its shortcuts.
  const layer = Layers.open(el, { modal: false, name: 'add menu', onEsc: _closePlus });
  _plus = { el, away, layer };
  document.addEventListener('mousedown', away, true);
  window.addEventListener('scroll', _closePlus, true);
}

// ── By a link (phase V27) ───────────────────────────────────────────────────
// The field under the plus, where its menu was: paste, Enter or "add". The server downloads it (lib/link-queue.js) into
// the kind selected (Uploads under Video), as a file brought in; the panel's status line says how far, with a cross.
function _linkBox(anchor) {
  if (_plus) _closePlus();
  const kind = _videoKind();
  if (!kind) return;
  const el = document.createElement('div');
  el.className = 'mv3-plus-menu mv3-link-box';
  const inp = document.createElement('input');
  inp.type = 'text';
  inp.placeholder = 'a link - YouTube, TikTok, Instagram…';
  const go = document.createElement('button');
  go.type = 'button';
  go.className = 'mv3-link-go';
  go.textContent = 'add';
  const row = document.createElement('div');
  row.className = 'mv3-link-row';
  row.appendChild(inp);
  row.appendChild(go);
  el.appendChild(row);
  const note = document.createElement('small');
  note.textContent = 'Into ' + _tree.kindLabel(kind) + ', at the best quality, without a login - one link, or several separated by spaces.';
  el.appendChild(note);
  const add = () => {
    const urls = LK.parseLinks(inp.value);
    if (!urls.length) { note.textContent = 'That is not a link.'; note.classList.add('is-bad'); return; }
    _closePlus();
    _addLinks(urls);
  };
  go.addEventListener('click', (e) => { e.stopPropagation(); add(); });
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });

  document.body.appendChild(el);
  const r = anchor.getBoundingClientRect();
  const w = el.offsetWidth, h = el.offsetHeight;
  el.style.left = Math.round(Math.max(6, Math.min(window.innerWidth - w - 6, r.left))) + 'px';
  const below = r.bottom + 4;
  el.style.top = Math.round(below + h <= window.innerHeight - 6 ? below : Math.max(6, r.top - h - 4)) + 'px';
  const away = (e) => { if (!el.contains(e.target) && e.target !== anchor) _closePlus(); };
  const layer = Layers.open(el, { modal: false, name: 'add by a link', onEsc: _closePlus });
  _plus = { el, away, layer };
  document.addEventListener('mousedown', away, true);
  window.addEventListener('scroll', _closePlus, true);
  setTimeout(() => inp.focus(), 0);
}

let _linking = null;      // { ids, total, kind, landed } while links come in

// The status line with a cross that stops the link coming in.
function _linkStatus(text, runId) {
  _status(text);
  const el = document.getElementById('mv3-lib-status');
  if (!el || !runId) return;
  const x = document.createElement('button');
  x.type = 'button';
  x.className = 'mv3-lib-stop';
  x.textContent = '✕';
  x.title = 'Stop this download';
  x.addEventListener('click', () => LK.stopLink(runId));
  el.appendChild(x);
}

// What came in is filed with no category: a node that would not show it gives way to its kind (Video shows them all).
function _showLanded(kind) {
  if (!_node || _node.key === 'video' || _node.key === kind) return false;
  if (_node.key === 'audio' && AUDIO.has(kind)) return false;
  _tree.select(kind, true);
  return true;
}

async function _addLinks(urls) {
  const kind = _videoKind();
  if (!kind) return;
  let jobs;
  try { jobs = await LK.addLinks(urls, { kind, from: 'merge' }); }
  catch (e) { _status(e.message, true); return; }
  if (_linking) { _linking.ids.push(...jobs.map(j => j.id)); _linking.total += jobs.length; return; }
  _linking = { ids: jobs.map(j => j.id), total: jobs.length, kind, landed: new Set(), reading: null };
  let ended = [];
  for (;;) {
    const ids = _linking.ids.slice();
    ended = await LK.follow(ids, (list) => {
      const done = list.filter(j => !LK.isLive(j)).length;
      const run = list.find(j => j.state === 'running');
      const fresh = list.filter(j => j.state === 'done' && !_linking.landed.has(j.id));
      if (fresh.length) {
        fresh.forEach(j => _linking.landed.add(j.id));
        if (!_showLanded(_linking.kind)) _linking.reading = _reload();
        else _linking.reading = _tree.load();
      }
      if (run) _linkStatus('link ' + Math.min(done + 1, _linking.total) + '/' + _linking.total + ' · ' + LK.shortStep(run.step), run.id);
    });
    if (_linking.ids.length === ids.length) break;
  }
  if (_linking.reading) await _linking.reading.catch(() => {});
  const ok = ended.filter(j => j.state === 'done');
  const bad = ended.filter(j => j.state === 'error');
  const stopped = ended.filter(j => j.state === 'stopped').length;
  const clips = ok.reduce((n, j) => n + (j.items || []).length, 0);
  _linking = null;
  _status(!bad.length && !stopped ? (clips + ' added')
    : (ok.length + ' of ' + ended.length + ' added' + (stopped ? ' · ' + stopped + ' stopped' : '') + (bad.length ? ' - ' + bad[0].error : '')),
  !!bad.length);
}

function _paint() {
  _stopHearing();
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
    s.textContent = _node && _node.cat ? 'nothing in this category' : 'empty - drop files here';
    b.appendChild(grid);
    b.appendChild(s);
    return;
  }
  // The viewer pages through what it can show - not the sounds, which play on their tiles.
  const seen = _items.filter(it => !AUDIO.has(it.kind));
  _items.forEach((it) => grid.appendChild(_tile(it, seen)));
  b.appendChild(grid);
}

// ── Upload ──────────────────────────────────────────────────────────────────
// Into the node selected: clips into its kind (Uploads under Video), pictures onto Images, sounds into SFX (the category
// selected, if one is), tracks into Music. Filed with no category - the node gives way to its kind when it would not
// show them.
const VIDEO_RE = /\.(mp4|webm|mov|m4v|avi|mkv)$/i;
const AUDIO_RE = /\.(mp3|wav|m4a|aac|ogg|oga|flac|opus)$/i;

function _status(text, bad) {
  const el = document.getElementById('mv3-lib-status');
  if (!el) return;
  el.textContent = text || '';
  el.hidden = !text;
  el.classList.toggle('is-bad', !!bad);
}

// Locked while files are in flight: another node mid-upload would file the rest elsewhere.
function _lock(on) {
  document.querySelectorAll('#mv3-library .mv3-plus').forEach(b => { b.disabled = on; });
  const t = document.getElementById('mv3-lib-tree');
  if (t) t.classList.toggle('is-locked', on);
}

async function _upload(files, what) {
  const list = Array.from(files || []);
  if (!list.length) return;
  if (_isImages()) return _uploadAs(list.filter(isPictureFile), list.length, 'images', 'image', (l, on) => uploadImages(l, on));
  if (_isAudio()) {
    const to = what || (_kind() === 'music' ? 'music' : _kind() === 'sounds' ? 'sounds' : '');
    if (!to) { _status('Pick Music or SFX in the tree first - or press + and say which', true); return; }
    const snd = list.filter(f => /^audio\//.test(f.type || '') || AUDIO_RE.test(f.name || ''));
    if (to === 'music') return _uploadAs(snd, list.length, 'music', 'track', (l, on) => uploadMusic(l, on));
    const cat = _kind() === 'sounds' ? _catOf() : '';
    return _uploadAs(snd, list.length, 'sounds', 'sound', (l, on) => uploadSounds(l, on, cat));
  }
  const kind = _videoKind();
  if (!kind) return;
  const vids = list.filter(f => /^video\//.test(f.type || '') || VIDEO_RE.test(f.name || ''));
  return _uploadAs(vids, list.length, kind, 'clip', (l, on) => uploadVideos(l, kind, on));
}

async function _uploadAs(good, all, kind, noun, send) {
  const skipped = all - good.length;
  if (!good.length) { _status('Only ' + noun + 's can go here', true); return; }
  _lock(true);
  _status('uploading 0/' + good.length + '…');
  let r = null;
  try {
    r = await send(good, (i, n, name) => _status('uploading ' + i + '/' + n + ' · ' + name));
    const failed = r.total - r.ok;
    _status(failed ? (failed + ' of ' + r.total + ' failed') + (skipped ? ', ' + skipped + ' skipped' : '')
                   : (r.ok + ' added') + (skipped ? ', ' + skipped + ' skipped (not a ' + noun + ')' : ''), !!failed);
  } catch (e) {
    _status(e.message, true);
  } finally {
    _lock(false);
    // The shelf sorts newest first, so what came in lands beside the +.
    if (r && r.ok && kind !== 'sounds' && _showLanded(kind)) await _tree.load();
    else await _reload();
  }
}

// Only OS-file drags are ours. An internal drag carries no 'Files' type, which is
// how dragging a tile onto a timeline lane later stays untouched by this.
const _hasFiles = (e) => Array.from((e.dataTransfer && e.dataTransfer.types) || []).indexOf('Files') >= 0;

function _wireDrop() {
  const panel = document.getElementById('mv3-library');
  if (!panel) return;
  // (phase V27) A LINK let go over the shelf (dragged out of a browser) comes in as a clip of the kind selected - not
  // over a chat or the captions, which take nothing of the kind, and not on Images or Audio.
  // A tile of this panel being dragged to a lane is not a link, whatever else the browser put on it.
  const linkHere = (e) => LK.dragHasLink(e.dataTransfer) && ![...e.dataTransfer.types].includes(DRAG_TYPE)
    && !!_videoKind() && !Views.isChat() && !Views.isCaptions();
  panel.addEventListener('dragover', (e) => {
    if (!_hasFiles(e) && linkHere(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; panel.classList.add('is-drop'); return; }
    if (!_hasFiles(e)) return;
    e.preventDefault();
    // A chat takes its own drops - as attachments, filed once (js/merge-v3/chat-shell.js). A file
    // let go of elsewhere on the panel then is nobody's, but it must not replace the page either - nor over
    // the captions view, where the shelf is hidden (K6).
    if (Views.isChat() || Views.isCaptions()) {
      if (!(e.target && e.target.closest && e.target.closest('.mv3-pc.is-shown'))) e.dataTransfer.dropEffect = 'none';
      return;
    }
    e.dataTransfer.dropEffect = 'copy';
    panel.classList.add('is-drop');
  });
  panel.addEventListener('dragleave', (e) => {
    // Ignore leaves onto children, or the highlight flickers off over every tile.
    if (!e.relatedTarget || !panel.contains(e.relatedTarget)) panel.classList.remove('is-drop');
  });
  panel.addEventListener('drop', (e) => {
    if (!_hasFiles(e) && linkHere(e)) {
      const urls = LK.linksIn(e.dataTransfer);
      if (!urls.length) return;
      e.preventDefault();
      panel.classList.remove('is-drop');
      _addLinks(urls);
      return;
    }
    if (!_hasFiles(e)) return;
    e.preventDefault();
    if (Views.isChat() || Views.isCaptions()) return;
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

// ── Reading the shelf for the node selected ─────────────────────────────────
async function _load() {
  const mine = ++_seq;
  if (!_node) return;
  _note('loading…');
  const q = new URLSearchParams(_node.q || {});
  try {
    const d = await fetch('/api/library/shelf/media?' + q).then(r => r.json());
    if (mine !== _seq) return;                 // a later click already won
    if (!d || !d.success) throw new Error((d && d.error) || 'shelf refused');
    _items = (d.items || []).filter(i => i && i.media);
    _paint();
  } catch (e) {
    if (mine !== _seq) return;
    _note(e.message, true);
  }
}

// The gallery and the tree's numbers together - after anything that adds, deletes or moves.
function _reload() { return Promise.all([_load(), _tree ? _tree.load() : null]); }

// Show a particular kind, optionally on one of its categories by NAME, and open the panel if it is the folded one.
// Used after a screenshot: the picture has just been filed under "Screenshots", and being shown where beats being told.
export async function showGroup(kind, catLabel) {
  if (!_tree) return;
  setOpenColumn('library');
  Views.toBase();
  Views.toShelf();
  await _tree.load();
  const k = _tree.node(kind);
  if (!k) return;
  const want = String(catLabel || '').toLowerCase();
  const c = want ? (k.children || []).find(x => String(x.name || x.label).toLowerCase() === want) : null;
  _tree.select(c ? c.key : kind, true);
}

// ── One file, shown on its shelf (phase L4, the owner 2026-09-23) ───────────
// Where the Alerts row of a picture or a clip that has landed leads (js/alerts-bell.js, js/merge-v3/main.js): its kind
// and category selected in the tree, its tile in view and lit until the shelf is painted again.
const _KIND_OF_PATH = [['/media/birols/', 'birols'], ['/media/uploads/', 'uploads'], ['/media/hooks/', 'hooks'],
  ['/media/images/', 'images'], ['/media/sounds/', 'sounds'], ['/media/audio/', 'music']];
export async function reveal(path) {
  const want = String(path || '').split('?')[0];
  if (!want || !_tree) return false;
  setOpenColumn('library');
  Views.toBase();
  Views.toShelf();
  // Its kind by where it lives - a clip of B-roll's archive under media/uploads/ is an upload.
  const kind = (_KIND_OF_PATH.find(([p]) => want.startsWith(p)) || [])[1] || 'images';
  let it = null;
  try {
    const d = await fetch('/api/library/shelf/media?filter=' + kind).then(r => r.json());
    it = ((d && d.items) || []).find(x => String(x.media || '').split('?')[0] === want) || null;
  } catch (e) { it = null; }
  if (!it) {
    _status(kind === 'images' ? 'That picture is no longer on the shelf' : 'That clip is no longer on the shelf', true);
    setTimeout(() => _status(''), 5000);
    return false;
  }
  await _tree.load();
  const cat = String((it.meta || {}).categoryId || '');
  _tree.selectFor(kind, cat || '__uncat__', false);
  _node = _tree.selected();
  await _load();
  const cell = [...document.querySelectorAll('#mv3-library .mv3-tile')].find(c => c.dataset.media === want);
  if (!cell) return false;
  cell.classList.add('is-found');
  // A frame later: the step a talking head was just switched to lays the page out again first
  // (js/merge-v3/layout.js, roomForTimeline), and the panel's height is part of where "centre" is.
  requestAnimationFrame(() => cell.scrollIntoView({ block: 'center', behavior: 'smooth' }));
  return true;
}

// ── The sash between the gallery and the tree ───────────────────────────────
// The tree is on the right: dragging LEFT makes it wider. Remembered; a double press gives the default back.
function _wireTreeSash() {
  const sash = document.getElementById('mv3-lib-sash');
  const box = document.getElementById('mv3-lib-tree');
  if (!sash || !box) return;
  const apply = (w) => {
    // Never more than 60% of the row: the gallery keeps room for a column of tiles in a narrow panel.
    const row = box.parentElement ? box.parentElement.getBoundingClientRect().width : 0;
    const max = row > 0 ? Math.max(TREE_MIN, Math.min(TREE_MAX, row * 0.6)) : TREE_MAX;
    const v = Math.max(TREE_MIN, Math.min(max, Math.round(w)));
    box.style.flexBasis = v + 'px';
    return v;
  };
  let saved = 0;
  try { saved = parseInt(localStorage.getItem(LS_TREE_W) || '', 10); } catch (e) { saved = 0; }
  apply(saved || TREE_DEF);
  sash.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const from = e.clientX;
    const base = box.getBoundingClientRect().width;
    document.body.classList.add('mv3-resize-v');
    const move = (ev) => apply(base - (ev.clientX - from));
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      document.body.classList.remove('mv3-resize-v');
      try { localStorage.setItem(LS_TREE_W, String(Math.round(box.getBoundingClientRect().width))); } catch (err) { /* a private window */ }
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  });
  sash.addEventListener('dblclick', () => {
    apply(TREE_DEF);
    try { localStorage.setItem(LS_TREE_W, String(TREE_DEF)); } catch (e) { /* a private window */ }
  });
}

export function initLibrary() {
  const inp = document.getElementById('mv3-lib-file');
  if (inp) {
    inp.addEventListener('change', () => {
      // Copy the FileList BEFORE clearing the input: input.files is live, so
      // `value = ''` empties the very list you are about to read. Clearing is still
      // needed, or picking the same file twice fires no change event.
      const files = Array.from(inp.files || []);
      inp.value = '';
      _upload(files, _pickFor);
    });
  }
  _wireDrop();
  _wireTreeSash();
  // Back from the pictures chat with something made or added: the shelf reads again (phase J).
  window.addEventListener('mv3:lib-reload', () => _reload());

  // (phase V28.4) The shelf buttons the panel had (birols / hooks / uploads / images) were remembered as `mv3_lib_tab`:
  // the first time, the tree opens on the same one; the old keys go.
  let fallback = 'birols';
  try {
    const old = localStorage.getItem('mv3_lib_tab');
    if (old && ['birols', 'hooks', 'uploads', 'images'].includes(old)) fallback = old;
    for (const k of Object.keys(localStorage)) if (k === 'mv3_lib_tab' || k.startsWith('mv3_lib_cat_')) localStorage.removeItem(k);
  } catch (e) { /* a private window */ }

  const host = document.getElementById('mv3-lib-tree');
  if (!host) return;
  host.addEventListener('click', (e) => e.stopPropagation());     // the folded column's press must not see it
  _tree = createTree(host, {
    page: 'mv3', fallback,
    status: (t, bad) => { _status(t, bad); if (t && !bad) setTimeout(() => _status(''), 3000); },
    onSelect: (n) => { _node = n; _load(); },
    onChanged: () => _load(),        // awaited by the tree before it says what was done
  });
  _tree.load().then(() => { _node = _tree.selected(); _load(); });
}
