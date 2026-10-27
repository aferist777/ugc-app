/* ═══════════════════════════════════════════════════════════════════════════
   MERGE v3 — the Library panel: the gallery on the left, the media tree on the right (phase V28.4, the owner
   2026-10-12: "в правом столбце древовидное отображение медиа директории ... при клике на главную категорию
   отображается все что есть по категории"). The tree is js/media-tree.js - the same one the Library's Media shelf
   shows; a sash between them, its width remembered, a double press for the default.

   The node selected in the tree is what the gallery shows - since V35 as a FOLDER (the owner 2026-10-23, (т2)): the path
   to it, its folders as tiles (js/media-tree.js foldersEl), then what lies directly in it - its `q`, what the media shelf
   is asked (none for a node that only holds folders):

     GET /api/library/shelf/media?filter=<kind>[&cat=<id>|__uncat__][&src=…][&folder=…&mood=…] | group=sfxall&q=<words>
       -> { items, shown, total, filters, cats }

   Thumbnails ONLY. The grid points an <img> at `thumb` and nothing loads the full media until the viewer opens. A
   SOUND or a TRACK has no picture: its tile is a note with its length, and a press plays it right there - no window
   (the owner: "воспроизведение по клику на аудио без попапов. Клик в другом месте останавливает проигрывание").

   A tile is dragged onto a lane (it says what it is - video, picture or sound - and a lane takes only its own,
   timeline-b.js) or onto a node of the tree (another category, another kind of video - js/media-tree.js).

   The star and the ✕ go through js/library/actions.js - the Library page's own module, not a copy.

   (phase V34.E) AUDIO -> SFX: ★ Favorites, Built-in (the program's set - read only), My sounds. A sound's tile carries its
   waveform, and - the one tile with a menu (the owner's (р2)) - the right button: Cut…, Rename, Move to, About, Delete
   (js/sound/menu.js). Over the grid of SFX: the search and "find online…" (js/sound/shelf.js, js/sound/online.js).
   ═══════════════════════════════════════════════════════════════════════════ */

import { openViewer, closeViewer, repaint as repaintViewer } from '../library/viewer.js';
// (phase TG, block 5) REFERENCES: a post's tile, its hover of miniatures, the post viewer.
import * as RP from '../references/post.js';
// (after block 8) A downloaded YouTube video of REFERENCES -> YouTube -> Videos: To highlights, Delete twice.
import * as YT from '../references/yt.js';
import * as Layers from '../layers.js';
import { toggleFavorite, deleteItem, deleteQuestion, uploadVideos, uploadImages, uploadSounds, uploadMusic,
         loadCats, setCategory, setKind, KINDS, createCategory } from '../library/actions.js';
// (phase TG, block 7) Cutting a piece out of any video - one module with the Library page and the post viewer.
import * as Cut from '../cut.js';
import { DRAG_TYPE, DRAG_MEDIA, markGone } from './store.js';
// (phase V54, (зв29)) The Cut window's "to timeline": the piece at the playhead - the timeline's own function (sub-session B).
import { placeSoundPiece } from './timeline-b.js';
import { setOpenColumn } from './layout.js';
import { PICTURE_ACCEPT, isPictureFile } from '../picture-file.js';
import { askName } from '../name-box.js';
import { openPictures } from './picchat.js';
import * as Views from './lib-views.js';
import * as LK from '../library/links.js';
import { showError } from '../notice.js';
import { createTree, setMediaDrag } from '../media-tree.js';
// (phase V34.E) Sound on the shelf: the waveform, the menu under the right button, the search and the online libraries.
import { waveEl } from '../sound/wave.js';
import { soundMenu, myCats } from '../sound/menu.js';
import { openOnline } from '../sound/online.js';
import * as SS from '../sound/shelf.js';
// (phase V54) Several tiles picked at once - one module with the Library page.
import * as TS from '../tile-select.js';

const VIDEO = new Set(['birols', 'hooks', 'uploads']);
const AUDIO = new Set(['music', 'sounds', 'sfx']);
const AUDIO_ACCEPT = 'audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac,.opus';
const LS_TREE_W = 'mv3_lib_tree_w';
const TREE_DEF = 180, TREE_MIN = 120, TREE_MAX = 420;

let _items = [];      // what the grid is showing, and what the viewer pages through
let _tree = null;
let _node = null;     // the tree's selected node - what the gallery shows
let _seq = 0;         // guards against a slow response for a node you have left

const _kind = () => (_node && _node.kind) || '';
const _isImages = () => _kind() === 'images';
const _isAudio = () => AUDIO.has(_kind()) || (_node && (_node.key === 'audio' || SS.isSfx(_node)));
// (phase V34.E) The search over SFX - kept while SFX is looked at, let go of outside it.
let _q = '';
// Where a clip brought in lands: the kind selected, or Uploads under Video (the owner: "загрузка в него - в Uploads").
// (second round) Generated takes B-rolls (with no category - they lie in it); Talking heads takes nothing.
const _videoKind = () => (VIDEO.has(_kind()) ? _kind() : (_node && _node.key === 'video') ? 'uploads'
  : (_node && _node.key === 'generated') ? 'birols' : '');
const _isHeads = () => _kind() === 'heads';
// Where a clip brought in lands, in words: a B-roll comes in with no category - into Generated itself.
const _landName = (kind) => _tree.homeName(kind);
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
// (second round) A talking head is its project's while the project lives: no star, no cross, no category - looked at, and
// dragged onto a lane of any project. One kept from a deleted project (`meta.kept`) is the library's, and goes like any.
// (phase TG, block 6) A video of YOUTUBE is a source of the scenarios - onto a lane and to highlights, never deleted here.
const _fixed = (it) => (it.kind === 'heads' && !(it.meta && it.meta.kept)) || it.kind === 'youtube';

function _tile(it, list) {
  const cell = document.createElement('div');
  const audio = AUDIO.has(it.kind);
  cell.className = 'mv3-tile' + (audio ? ' is-sound' : '') + (it.meta && it.meta.favorite ? ' is-fav' : '');
  // (phase V54) What js/tile-select.js picks it by.
  cell.dataset.key = it.kind + ':' + it.id;
  // No menu on a tile (phase V23, the owner: one rule everywhere): "Save image as" would save the miniature.
  // (phase V34.E, the owner's (р2)) The exception: a sound's or a track's menu - Cut…, Rename, Move to, About, Delete.
  cell.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    // (phase V54) Several picked, this one among them: their menu - Move to…, the star, Delete N.
    const many = _pickedWith(it);
    if (many) { _manyMenu(many, e); return; }
    if (audio) {
      soundMenu(it, e, {
        status: (t, bad) => { _status(t, bad); if (t && !bad) setTimeout(() => _status(''), 3000); },
        changed: () => _reload(), stop: () => _stopHearing(),
        // (phase V54) Merge has no player: every sound - a track too - is cut in the Cut window, and "to timeline" lays
        // the piece at the playhead (one undo step; refused in words on a highlights project's own timeline).
        toTimeline: (piece) => placeSoundPiece(piece),
        del: async (x) => {
          if (!confirm(await deleteQuestion(x))) return;
          try { if (_hear && _hear.id === x.id) _stopHearing(); await deleteItem(x); markGone(x.media); await _reload(); }
          catch (err) { _status(err.message, true); }
        },
      });
    }
  });
  // Which file, so a tile can be found by what it shows (reveal, below).
  cell.dataset.media = String(it.media || '').split('?')[0];
  cell.title = it.kind === 'heads'
    ? [(it.meta || {}).project, it.name, _mmss(it.dur), (it.meta || {}).used ? 'on a timeline' : ''].filter(Boolean).join(' · ')
    : [it.name, it.meta && it.meta.style, _mmss(it.dur)].filter(Boolean).join(' · ')
      + (audio ? '\na press plays it · the right button: cut, ' + (it.kind === 'sfx' ? 'about' : 'rename, about, delete') : '');

  if (audio) {
    const note = document.createElement('span');
    note.className = 'mv3-tile-note';
    note.textContent = '♪';
    cell.appendChild(note);
    const nm = document.createElement('span');
    nm.className = 'mv3-tile-sname';
    nm.textContent = it.name || '';
    cell.appendChild(nm);
    // (phase V34.E) Its waveform (lib/audio-wave.js; a built-in sound's comes with the set).
    cell.appendChild(waveEl((it.meta || {}).wave, 'snd-twave'));
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

  // A talking head: its line's number, and a mark when this take is on a timeline (the one the project uses).
  if (it.kind === 'heads') {
    const tag = document.createElement('span');
    tag.className = 'mv3-tile-hid' + ((it.meta || {}).used ? ' is-used' : '');
    tag.textContent = (it.meta || {}).line ? 'L' + it.meta.line : '';
    if (tag.textContent) cell.appendChild(tag);
  }

  // (phase TG, block 5) A post of REFERENCES: its count and its hover of miniatures; a press opens the post viewer; the
  // cross deletes the post ("really?" on the cross itself). Onto a lane - block 5d.
  if (it.kind === 'references') {
    const open = (post, file) => {
      const posts = list.filter(x => x.kind === 'references');
      RP.openPost(posts, posts.indexOf(post), { file, onChanged: () => _reload() });
    };
    // A file onto a lane (block 5d): what a lane takes rides along, as a clip's or a picture's does.
    const toLane = (dt, post, f) => {
      const media = f.type === 'video' ? 'video' : 'image';
      dt.effectAllowed = 'copyMove';
      dt.setData(DRAG_TYPE, JSON.stringify({ libId: post.id, src: f.path, thumb: f.thumb || null, name: post.name || '',
        group: media === 'image' ? 'images' : 'uploads', dur: +f.dur || 0, media, bed: false }));
      dt.setData(DRAG_MEDIA + media, '1');
    };
    RP.decorate(cell, it, open, { dragFile: toLane });
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'mv3-tile-btn mv3-tile-del';
    del.textContent = '✕';
    del.title = 'Delete this post and its files';
    del.addEventListener('click', async (e) => {
      e.stopPropagation();
      // Asked as every tile here asks - with the projects that hold its files (block 5d).
      del.disabled = true;
      if (!confirm(await RP.deleteQuestion(it))) { del.disabled = false; return; }
      try {
        const r = await fetch('/api/references/' + encodeURIComponent(it.id), { method: 'DELETE' }).then(x => x.json());
        if (!r || !r.success) throw new Error((r && r.error) || 'not deleted');
        await _reload();
      } catch (err) { showError(err.message); del.disabled = false; }
    });
    cell.appendChild(del);
    // Onto a node of the tree (block 5b) - within REFERENCES, or a post of one file out of it.
    cell.draggable = true;
    cell.addEventListener('dragstart', (e) => {
      // A post of one file goes onto a lane as that file; any post goes onto a node of the tree (block 5b).
      const files = (it.meta && it.meta.items) || [];
      if (files.length === 1 && !(it.meta && it.meta.remote)) toLane(e.dataTransfer, it, files[0]);
      else e.dataTransfer.effectAllowed = 'move';
      setMediaDrag(e.dataTransfer, it, _pickedWith(it));
    });
    cell.addEventListener('click', () => open(it, 0));
    return cell;
  }

  if (_fixed(it)) {
    cell.draggable = true;
    cell.addEventListener('dragstart', (e) => {
      e.dataTransfer.effectAllowed = 'copy';
      e.dataTransfer.setData(DRAG_TYPE, JSON.stringify({ libId: it.id, src: it.media, thumb: it.thumb || null, name: it.name || '',
        group: it.kind, dur: +it.dur || 0, media: 'video', bed: false }));
      e.dataTransfer.setData(DRAG_MEDIA + 'video', '1');
      cell.classList.add('is-dragging');
    });
    cell.addEventListener('dragend', () => cell.classList.remove('is-dragging'));
    cell.addEventListener('click', () => openViewer(list, list.indexOf(it), _viewerOpts()));
    return cell;
  }

  const star = document.createElement('button');
  if (it.kind === 'heads') star.hidden = true;            // a kept talking head: no favourite to set
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
    } catch (err) { showError(err.message); star.disabled = false; }
  });
  cell.appendChild(star);

  const del = document.createElement('button');
  // (phase V34.E) A built-in sound is the app's: a star, never a cross.
  if (it.kind === 'sfx') del.hidden = true;
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
    } catch (err) { showError(err.message); del.disabled = false; }
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
    // (phase V54) A picked tile carries the others picked onto the tree (a lane still takes this one alone, (зв18)).
    setMediaDrag(e.dataTransfer, it, _pickedWith(it));
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
const _viewerOpts = () => {
  Cut.reset();
  return _viewerOptsOf();
};
const _viewerOptsOf = () => ({
  extraRows: _viewerRows, underStage: _underStage, videoSrc: Cut.videoSrc,
  // (block 6) A video of YOUTUBE: a new highlights project on it, chosen in its popup already.
  actionsFor: (it) => (it && it.kind === 'youtube' ? YT.ytActions(it) : []),
  onAction: async (id, it) => {
    if (id === 'srcdel') {
      let r;
      try { r = await YT.ytDelete(it); } catch (e) { _status('Not deleted: ' + e.message, true); return { actionsOnly: true }; }
      if (r.armed) { _status(r.msg); return { actionsOnly: true }; }
      _status('Source deleted.');
      _load();
      if (_tree) _tree.load();
      return { removed: true };
    }
    if (id !== 'hl') return null;
    closeViewer();
    if (window.__ugcHighlightsFrom) window.__ugcHighlightsFrom('', '', (it.meta && it.meta.source) || it.id);
    return null;
  },
  showSrc: (it) => (it.kind === 'images' ? '/api/thumb?src=' + encodeURIComponent(it.media) + '&v=main' : null),
});

function _viewerRows(item) {
  if (!item) return [];
  const rows = [];
  if (KINDABLE.has(item.kind)) rows.push(['kind', _kindSelect(item)]);
  if (CATABLE.has(item.kind)) rows.push(['category', _categorySelect(item)]);
  // A piece: its whole video, shown on a tick (js/cut.js).
  const orig = Cut.originalRow(item, repaintViewer);
  if (orig) rows.push(orig);
  // A clip trimmed the old way, once (before phase TG): what it was cut to.
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

// ── cutting a piece (phase TG, block 7) ──
// Under any video of the shelf (js/cut.js): the stretch, "Cut…", where the new clip goes - the grid and the tree read
// again for it. The video itself is not touched.
function _underStage(item, video) {
  return Cut.underStage(item, video, {
    say: (t, err) => _status(t, !!err),
    onSaved: (r) => {
      Promise.resolve(_load()).then(() => _status('Saved as a new clip in ' + r.where + '.'));
      if (_tree) _tree.load();
    },
  });
}

// The upload cell, first in the grid. A tile-sized target rather than a header button because that is where files are
// dropped, and the two ways in should look like the same thing. What it offers follows the node (the owner): clips -
// a file or a link; pictures - a file, or made here; a sound or a track - a file.
function _plusTile() {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'mv3-tile mv3-plus';
  b.textContent = '+';
  if (_isHeads()) {
    b.disabled = true;
    b.title = 'Talking heads come from the talking-head projects - drag one onto a lane to use it here';
    return b;
  }
  // (phase V35) REFERENCES fills itself: the Telegram bot's posts, the pieces cut from a video, the sources downloaded.
  if (_kind() === 'references') {
    b.disabled = true;
    b.title = 'REFERENCES fills itself - the Telegram bot\'s posts, pieces cut from a video, the YouTube sources';
    return b;
  }
  // (phase V34.E) Built-in is the app's, Favorites the starred - nothing is brought in there.
  if (_node && (SS.isBuiltin(_node) || _node.key === 'sfx-fav')) {
    b.disabled = true;
    b.title = _node.key === 'sfx-fav' ? 'Favorites are the starred sounds - the ★ on a tile' : 'Built into the app - read only';
    return b;
  }
  b.title = _isImages() ? 'Add a picture to Images - from this computer, or made here'
    : _isAudio() ? 'Add music or sounds from this computer'
    : 'Add videos to ' + _landName(_videoKind()) + ' - from this computer or by a link; or drop files or a link anywhere on this panel';
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
    if (_kind() !== 'sounds' && !SS.isSfx(_node)) item('music from this computer', 'a track - mp3, wav, m4a…', () => _pickFiles('music'));
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
  note.textContent = 'Into ' + _landName(kind) + ', at the best quality, without a login - one link, or several separated by spaces.';
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

// What came in is filed with no category: it lies in its kind (V35: a folder shows only what lies directly in it), so a
// node elsewhere gives way to that kind - a B-roll's is Generated.
function _showLanded(kind) {
  const home = kind === 'birols' ? 'generated' : kind;
  if (!_node || _node.key === home) return false;
  _tree.select(home, true);
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

// (phase V34.E) "find online…": the free libraries' search; found sounds go into My sounds and the shelf is read again.
async function _online(q) {
  openOnline({ cats: await myCats(), cat: _node && _node.kind === 'sounds' && _node.cat && _node.cat !== SS.UNCAT ? _node.cat : '',
    q, stop: () => _stopHearing(), added: () => _reload() });
}

// (phase V35, the owner's (т2), (у2)) The gallery is a folder: the path to it over everything ("AUDIO / SFX / My sounds",
// every word a press away), its folders as tiles, then what lies directly in it. A search over SFX shows what it found in
// all of SFX, with no folders.
function _paint() {
  _stopHearing();
  const b = _body();
  if (!b) return;
  b.textContent = '';
  if (_tree && _node) b.appendChild(_tree.crumbsEl(_node));
  const searching = !!(_q && SS.isSfx(_node));
  if (SS.isSfx(_node)) {
    b.appendChild(SS.searchHead({ q: _q, found: _items.length > 0, onSearch: (q) => { _q = q; _load(); }, onOnline: (q) => _online(q) }));
  }
  const folders = !searching && _tree && _node ? _tree.foldersEl(_node) : null;
  if (folders) b.appendChild(folders);
  const grid = document.createElement('div');
  // (phase V35, the owner's (т3), (у4)) A folder of horizontal videos (YouTube -> Videos) has 16:9 tiles.
  grid.className = 'mv3-grid' + (_node && _node.tiles === 'wide' ? ' is-wide' : '');
  grid.appendChild(_plusTile());
  // An empty shelf still gets the grid - it is how files get onto it in the first
  // place, so replacing it with an "empty" placard would hide the only way in. A folder of folders says nothing.
  if (!_items.length) {
    b.appendChild(grid);
    if (folders) return;
    const s = document.createElement('span');
    s.className = 'mv3-grid-note';
    s.textContent = searching ? 'nothing with "' + _q + '" in SFX' : _node && _node.cat ? 'nothing in this category'
      : _node && !_node.q ? 'empty' : 'empty - drop files here';
    b.appendChild(s);
    return;
  }
  // The viewer pages through what it can show - not the sounds, which play on their tiles.
  const seen = _items.filter(it => !AUDIO.has(it.kind));
  _items.forEach((it) => grid.appendChild(_tile(it, seen)));
  b.appendChild(grid);
  if (_tsel) _tsel.refresh();
}

// ── Several tiles picked (phase V54 block 5, (зв17)) ────────────────────────
// js/tile-select.js picks them in the gallery; let go on the tree they go in one request (js/media-tree.js); here are
// the right button's menu and Delete for them.
let _tsel = null;
const _keyOf = (it) => it.kind + ':' + it.id;
function _pickedWith(it) {
  if (!_tsel || _tsel.size() < 2 || !_tsel.has(_keyOf(it))) return null;
  const keys = new Set(_tsel.keys());
  return _items.filter(x => keys.has(_keyOf(x)));
}
async function _afterMany(d, verb) {
  await _reload();
  if (d) _status(TS.saidOf(d, verb), !d.done && (d.skipped || []).length > 0);
}
function _manyMenu(items, e) {
  const n = items.length;
  const starable = items.filter(x => !['references', 'heads', 'youtube'].includes(x.kind));
  const allFav = starable.length && starable.every(x => x.meta && x.meta.favorite);
  TS.menuAt(e.clientX, e.clientY, [
    ['Move to…', n + ' items - each where it can go', () => TS.moveMany(e.clientX, e.clientY, items, {
      done: () => _reload(), status: (t, bad) => _status(t, bad),
    })],
    [allFav ? '★ Remove from favourites' : '★ Add to favourites', starable.length < n ? 'posts have no star' : '',
      starable.length ? async () => {
        try { await _afterMany(await TS.batch('favorite', starable, { favorite: !allFav }), allFav ? 'taken off favourites' : 'in favourites'); }
        catch (err) { _status(err.message, true); }
      } : null],
    ['Delete ' + n, 'with their files - asked first', () => _deleteMany(items), true],
  ]);
}
async function _deleteMany(all) {
  const items = all.filter(x => x.kind !== 'sfx' && x.kind !== 'youtube' && !_fixed(x));
  if (!items.length) { _status('Nothing picked here can be deleted - built-in sounds and a project\'s talking heads stay', true); return; }
  if (items.length > TS.BATCH_MAX) { _status('At most ' + TS.BATCH_MAX + ' at once - ' + items.length + ' are picked.', true); return; }
  const q = items.length === 1 ? await deleteQuestion(items[0]) : await TS.deleteQuestion(items);
  if (!confirm(q)) return;
  _stopHearing();
  try {
    const d = await TS.batch('delete', items);
    // Red on the timelines only what really went: not one the server refused, nor a file it spared for another record.
    const stayed = new Set((d.skipped || []).map(x => x.kind + ':' + x.id));
    const gone = new Set(d.removed || []);
    for (const x of items) {
      const base = String(x.media || '').split('?')[0].split('/').pop();
      if (!stayed.has(_keyOf(x)) && base && gone.has(base)) markGone(x.media);
    }
    await _afterMany(d, 'deleted');
  } catch (err) { _status(err.message, true); }
}

// ── Upload ──────────────────────────────────────────────────────────────────
// Into the node selected: clips into its kind (Uploads under Video), pictures onto Images, sounds into SFX (the category
// selected, if one is), tracks into Music. Filed with no category - the node gives way to its kind when it would not
// show them.
const VIDEO_RE = /\.(mp4|webm|mov|m4v|avi|mkv)$/i;
const AUDIO_RE = /\.(mp3|wav|m4a|aac|ogg|oga|flac|opus)$/i;

// The panel's line: uploads and links coming in, and what came of them. A refusal or a failure is a popup in the corner
// instead (phase V49.1, the owner's (пр28), (пр29); js/notice.js) - seen while a chat or highlights covers the line - and the
// line goes.
function _status(text, bad) {
  if (text && bad) { showError(text); text = ''; }
  const el = document.getElementById('mv3-lib-status');
  if (!el) return;
  el.textContent = text || '';
  el.hidden = !text;
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
    const into = SS.filesTo(_node);
    const to = what || (into ? into.kind : '');
    if (!to) { _status(SS.isBuiltin(_node) || (_node && _node.key === 'sfx-fav') ? 'Built-in and Favorites take no files - pick My sounds or a category of it'
      : 'Pick Music or SFX in the tree first - or press + and say which', true); return; }
    const snd = list.filter(f => /^audio\//.test(f.type || '') || AUDIO_RE.test(f.name || ''));
    if (to === 'music') return _uploadAs(snd, list.length, 'music', 'track', (l, on) => uploadMusic(l, on));
    const cat = _kind() === 'sounds' ? _catOf() : '';
    return _uploadAs(snd, list.length, 'sounds', 'sound', (l, on) => uploadSounds(l, on, cat));
  }
  const kind = _videoKind();
  if (!kind) { if (_isHeads()) _status('Talking heads come from the talking-head projects', true); return; }
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
  if (!SS.isSfx(_node)) _q = '';
  // (phase V35) What lies directly in the node (its `q`) - none in a node that only holds folders; a search over SFX looks
  // through all of SFX, whichever of its folders is open (the owner's (у3)).
  const qo = _q ? { group: 'sfxall', q: _q } : _node.q;
  if (!qo) { _items = []; _paint(); return; }
  _note('loading…');
  const q = new URLSearchParams(qo);
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

// (phase TG) A post the Telegram bot brought in while Merge is open: the tree's numbers and the gallery read again (the
// signal is js/alerts-bell.js's, which also chimes).
window.addEventListener('ugc-references', () => { _reload(); });

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
    onSelect: (n) => { _node = n; if (_tsel) _tsel.clear(); _load(); },
    onChanged: () => _load(),        // awaited by the tree before it says what was done
    // (phase V34.E) Sounds from Explorer let go on Music, SFX or a category of My sounds go there.
    takesFiles: (n) => !!SS.filesTo(n),
    onFiles: (n, files) => { _tree.select(n.key, true); _upload(files); },
  });
  _tree.load().then(() => { _node = _tree.selected(); _load(); });
  // (phase V54) Several tiles picked in the gallery (js/tile-select.js) - while the shelf is what the panel shows.
  const body = _body();
  if (body) {
    _tsel = TS.createSelection({
      host: body, tile: '.mv3-grid .mv3-tile[data-key]',
      active: () => !!body.querySelector('.mv3-grid') && body.offsetParent !== null,
      onDelete: (keys) => _deleteMany(_items.filter(x => keys.includes(_keyOf(x)))),
    });
  }
}
