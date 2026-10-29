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
import { openViewer, repaint as repaintViewer } from './viewer.js';
// (phase TG, block 7) Cutting a piece out of any video - one module with Merge's panel and the post viewer.
import * as Cut from '../cut.js';
import * as A from './actions.js';
import * as V from './voices.js';
import * as SC from './scenarios.js';
import * as RE from './renders.js';
import * as INFO from './info.js';
import * as MK from './make.js';
import * as CM from './chmake.js';
// (phase V56, (ги7)) What is known about a made environment or lookbook, in the viewer's right column.
import { madeRows } from './made-rows.js';
import * as NR from './narrators.js';
import { PICTURE_ACCEPT } from '../picture-file.js';
import * as LK from './links.js';
import { createTree, setMediaDrag } from '../media-tree.js';
// (phase V58, the owner's (лк6)) New environment / New lookbook - the generators' window (sub-session P's module).
import { openGenerator } from '../gen-window.js';
// (phase V59) Generate music - Suno's window over Media (js/library/music-window.js, sub-session P's).
import * as MW from './music-window.js';
// (phase V34.E) Sound on the Media shelf: the waveform, the menu under the right button, the search and the online libraries
// - the same modules as Merge's Library panel.
import { waveEl } from '../sound/wave.js';
import { soundMenu, myCats } from '../sound/menu.js';
import { openOnline } from '../sound/online.js';
import * as SS from '../sound/shelf.js';
// (phase V54) The music player under the gallery while Music is open.
import { createPlayer } from '../sound/player.js';
// (phase V59.1) Music -> Lyrics: a saved text's tile and its viewer - one module with Merge's panel.
import * as LYR from '../sound/lyrics.js';
// (phase V54) Several tiles picked at once - Ctrl, Shift, a band - and what is done with them.
import * as TS from '../tile-select.js';
import * as Layers from '../layers.js';
import { openScenario } from '../scen-window.js';
import { talkingHead } from '../merge-v3/scen-api.js';
// (phase TG, block 5) REFERENCES: a post's tile, its hover of miniatures, the post viewer.
import * as RP from '../references/post.js';
// (after block 8) A downloaded YouTube video of REFERENCES -> YouTube -> Videos: To highlights, Delete twice.
import * as YT from '../references/yt.js';
import { showError } from '../notice.js';

const $ = (id) => document.getElementById(id);
const LS_SHELF = 'library_shelf_v1';
const LS_TREE_W = 'library_tree_w_v1';   // (phase V28.5) the media tree's width on Media

// (phase V56, the owner's п. 19 and (ги7)) Lookbooks and Environments are no shelves of their own any more: they are IMAGES ->
// Lookbooks / Environments on Media (phase V55), with their generators there. An old address or a remembered shelf of theirs
// lands there (_place, boot); the server's shelves stay - the talking head and the 3D Studio read them.
const SHELVES = {
  characters:   'Characters',
  media:        'Media',
  voices:       'Voices',
  renders:      'Renders',
  scenarios:    'Scenarios',
};

let _shelf = 'characters';
// MEDIA'S NODE (phase V28.5, the owner 2026-10-12: "полку media в library сделать таким же форматом - справа древовидный
// столбец, а слева уже галерея сама"): the media tree's selected node is what the grid shows - Video, a kind, a category;
// the kind and category rows went. The same tree as Merge's Library panel (js/media-tree.js).
let _tree = null;
// (phase V60, (пп1а)) null - Media is at its ROOTS: REFERENCES, VIDEO, IMAGES, AUDIO as folder tiles, the tree folded.
let _node = null;
// The node the tree opens on - an address's (boot); '' - the roots, whatever was looked at last.
let _treeStart = '';
const VIDEO = new Set(['birols', 'hooks', 'uploads']);
const AUDIO = new Set(['music', 'sounds', 'sfx']);
const _mkind = () => (_node && _node.kind) || '';
// (phase V34.E) The search over SFX - kept while SFX is looked at, let go of outside it.
let _q = '';
const _mcat = () => (_node && _node.cat && !_node.uncat ? _node.cat : '');

// THE SHELVES WHERE ONE TILE IS ALWAYS SELECTED (phase B, the owner 2026-09-29): opening one selects
// the top-left tile, there is no "nothing selected", and the right column says what the selected one
// is (js/library/info.js). Kept across a reload of the same shelf, dropped on leaving it. (Characters only
// since phase V56 took the Lookbooks and Environments shelves away.)
const PICKABLE = new Set(['characters']);
let _sel = '';
// (phase V59) More tiles outlined beside _sel on Media - a press of the music window made TWO tracks, and its Alerts row
// leads to both (?sel=<id>&sel=<id>).
let _selAlso = new Set();
let _items = [];
let _labelKeys = null;    // voices: the order to read a voice's tags in, from the server
let _reqId = 0;
// Media's three checks are owed once a read asked for them, and are run by whichever read lands
// last - a newer read that overtakes the one that asked must not drop them.
let _checksDue = false;
// THE MAKING AREAS (phases E, H, I): a shelf that makes its own things has one, shown in place of the
// shelf - Scenarios the generator, Characters New Character (Environments' and Lookbooks' generators are WINDOWS since
// phase V58 - _openGen, below). "New …" at the LEFT of the header opens it,
// "← …" in the same place brings the shelf back, read again. Leaving one only hides it: what it runs goes
// on. Each module answers init(hooks), open(opts) and close(), and none of them touches its host's
// `hidden` for good - _paintMake is the one writer, because it runs on every read of a shelf and an area
// painted anywhere else would be undone by the next read.
const MAKERS = {
  scenarios: {
    mod: MK, host: 'lib-make', label: 'New scenario', back: '← Scenarios',
    title: 'A new scenario - written by hand, or generated in a narrator’s voice',
    backTitle: 'Back to the list of scenarios - what is being written goes on',
  },
  characters: {
    mod: CM, host: 'lib-chmake', label: 'New Character', back: '← Characters',
    title: 'Make a character - from the parameters, a preset, a random face or your own picture',
    backTitle: 'Back to the characters - what is being made goes on',
  },
};
let _makingOn = '';       // the shelf whose making area is showing; '' = the shelf itself
// (phase V55, the owner's (гн10); phase V58, the owner's (лк6)) ON MEDIA: IMAGES -> Environments / Lookbooks' "+" (the
// tree's row, its menu, the bar's "New …") opens their generator as a WINDOW over the page (_openGen) - the gallery and the
// tree stay where they are.
const GEN = {
  environments: { label: 'New environment', title: 'Make an environment - from words, from a photo, or one already made changed' },
  lookbooks: { label: 'New lookbook', title: 'Make a lookbook - from words, from a photo, or one already made built on' },
  // (phase V59, the owner's (мг2а)) while Music or any folder under it is selected - the tracks go into that folder.
  music: { label: 'Generate music', title: 'Make music with Suno - Simple, Custom or Lyrics, in a window; the tracks go into the folder open' },
};
const MADE_KINDS = new Set(['environments', 'lookbooks']);
// The node selected is Environments or Lookbooks itself: its kind, else ''.
const _madeNode = () => (_shelf === 'media' && _node && _node.make && MADE_KINDS.has(_node.make) ? _node.make : '');
// The generator the bar's "New …" opens on the node selected: Environments' or Lookbooks' (the node itself), or (phase V59)
// Music's - on Music or any folder under it. Upload stays beside it there (Music takes files).
// (phase V59.1) Music -> Lyrics (kind 'lyrics', sub-session Q's) is a folder under Music too: the bar's "Generate music" stays.
const _musicish = (n) => !!n && (n.kind === 'music' || n.kind === 'lyrics');
const _genNode = () => _madeNode() || (_shelf === 'media' && _musicish(_node) ? 'music' : '');
// THE NARRATORS (phase V28.2, the owner 2026-10-12): an area on the Scenarios shelf over the list or over the generator -
// "Narrators" beside "New scenario", or the gear by the generator's Narrator field. `_makingOn` stays as it was under it,
// so "←" goes back to where it was opened from: the list ("← Scenarios") or the generator ("← Generate script").
let _narrOn = false;
// The next read of the shelf brings the selected tile into view (a character just saved lands ~23rd).
let _scrollSel = false;
let _drafts = [];         // the drafts heading the Scenarios list (phase E)

// The page's line: what was just done ("Saved", "Reading…"). A refusal or a failure (kind 'err') is a popup in the corner
// instead (phase V49.1, the owner's (пр28), (пр29); js/notice.js), and the line goes.
function _status(text, kind) {
  if (text && kind === 'err') { showError(text); text = ''; kind = ''; }
  const el = $('lib-status');
  if (!el) return;
  el.textContent = text || '';
  el.className = 'lib-status' + (kind ? ' ' + kind : '');
}

function _paintShelves() {
  document.querySelectorAll('.lib-shelf').forEach(b => b.classList.toggle('cur', b.dataset.kind === _shelf));
  _paintUpload();
  _paintMake();
  // Media's three checks show their buttons only there; leaving Media puts them away at once.
  if (_shelf !== 'media') for (const id of ['lib-dupes', 'lib-broken', 'lib-thumbs']) { const b = $(id); if (b) b.hidden = true; }
  // Media's tree, beside its grid.
  // (V38.6) Scenarios: the list at its own width on the left, a sash, the selected one on the right - a scenario's
  // column, or a draft's form. Elsewhere the draft's place is put away.
  const onSc = _shelf === 'scenarios';
  const split = $('lib-split');
  if (split) split.classList.toggle('is-scenarios', onSc);
  const scs = $('lib-sc-sash');
  if (scs) scs.hidden = !onSc;
  if (!onSc) { const dh = $('lib-sc-draft'); if (dh) dh.hidden = true; }
  const onMedia = _shelf === 'media' && !_makingOn;
  for (const id of ['lib-tree', 'lib-tree-sash']) { const e = $(id); if (e) e.hidden = !onMedia; }
  // (phase V34.E) The search over SFX goes with Media; it is painted again when the shelf is read (_paintSndHead).
  // (phase V35) So does the path to the node.
  if (!onMedia) for (const id of ['lib-snd-head', 'lib-crumbs']) { const h = $(id); if (h) h.hidden = true; }
}

// ── The making areas ────────────────────────────────────────────────────────
function _paintMake() {
  if (_makingOn && _makingOn !== _shelf) _makingOn = '';
  if (_narrOn && _shelf !== 'scenarios') _narrOn = false;
  // (phase V55, V58) On Media, Environments or Lookbooks selected: "New environment" / "New lookbook" opens the generator's
  // window over the page - there is nothing to come back from, so no "←".
  const g = _genNode();
  const m = g ? GEN[g] : MAKERS[_shelf];
  const nb = $('lib-new'), bb = $('lib-back'), split = $('lib-split'), nr = $('lib-narr');
  if (nb) {
    nb.hidden = g ? false : (!m || !!_makingOn || _narrOn);
    if (m) { nb.textContent = m.label; nb.title = m.title; }
  }
  if (bb) {
    bb.hidden = g ? true : (!m || !(_makingOn || _narrOn));
    if (g) bb.textContent = '';
    else if (_narrOn) {
      bb.textContent = _makingOn ? '← Generate script' : '← Scenarios';
      bb.title = _makingOn ? 'Back to the generator, as it was' : 'Back to the list of scenarios';
    } else if (m) { bb.textContent = m.back; bb.title = m.backTitle; }
  }
  if (nr) nr.hidden = _shelf !== 'scenarios' || _narrOn;
  if (split) split.hidden = !!_makingOn || _narrOn;
  for (const k of Object.keys(MAKERS)) {
    const h = $(MAKERS[k].host);
    if (h) h.hidden = !(_makingOn === k && !_narrOn);
  }
  const nh = $('lib-narrators');
  if (nh) nh.hidden = !_narrOn;
  _paintPlayer();
}

// (phase V55, (гн10); phase V58, the owner's (лк6), (лк7)) THE GENERATOR OF ENVIRONMENTS OR LOOKBOOKS - the same window a
// talking head's "where" / "who" open (sub-session P's module), the size of the almanac, over the page: the gallery and the
// tree stay where they are, the folder selected behind it. What it makes lands in that folder - the tree's numbers and,
// while the folder is open, the gallery are read again.
// What the window says to Alerts (`where`): the generator's address - a row still running, or failed, opens the window
// again - and the old chat's `spot`, so a row that ended leads to the picture outlined in its folder
// (alerts-bell.js `_hrefOf`) and a row running is picked up by the window opened again here.
const GEN_WHERE = {
  environments: { page: 'library', href: '/library?shelf=media&kind=environments&make=1', label: 'Library · New environment', spot: { view: 'envmake' } },
  lookbooks: { page: 'library', href: '/library?shelf=media&kind=lookbooks&make=1', label: 'Library · New lookbook', spot: { view: 'lbmake' } },
};
const GEN_KIND = { environments: 'environment', lookbooks: 'lookbook' };
const _genWins = {};          // the window open per kind - pressed again, the same one stays
async function _openGen(kind, fromTree) {
  if (kind === 'music') return _openMusic(fromTree);
  if (!MADE_KINDS.has(kind)) return;
  if (_shelf === 'media' && _tree && (!_node || _node.key !== kind)) {
    _tree.select(kind, false);
    _node = _tree.selected();
    await _load({ checks: false });
  }
  if (_genWins[kind] && _genWins[kind].alive()) return;
  try {
    _genWins[kind] = openGenerator({
      kind: GEN_KIND[kind],
      where: () => GEN_WHERE[kind],
      onMade: (path) => _genLanded(kind, path),
      onClose: () => { _genWins[kind] = null; },
    });
  } catch (e) { _status((e && e.message) || 'The generator did not open', 'err'); }
}
// Something the window made landed (whether or not the window is still open): the numbers, and - while the gallery shows
// that folder - the gallery, the new picture outlined (its id there is its file name).
function _genLanded(kind, path) {
  if (_tree) _tree.load();
  _counts();
  if (_shelf === 'media' && _node && _node.key === kind) {
    if (path) { _sel = String(path).split('/').pop(); _selAlso = new Set(); _scrollSel = true; }
    _load({ keepScroll: true, checks: false });
  }
}

// (phase V59, the owner 2026-10-29: "создать попап с генератором музыки как в merge ... в library") GENERATE MUSIC - Suno's
// window over Media (js/library/music-window.js), the size of the almanac, the gallery and the tree staying behind it.
// From Music's "+" in the tree (and its menu, and the address ?shelf=media&kind=music&make=1): Music itself, selected; from
// the bar's "Generate music": the folder selected - Music or one under it. The tracks go there ((мг4а); highlights and its
// moods take only a mood's preset - the window and the server say so). `lyric` (phase V59.1) - a saved text's "use in custom"
// (the event `ugc:lyric-use`, sub-session Q's tile and viewer): the window on Custom with it, the gallery staying where it is.
async function _openMusic(fromTree, lyric) {
  if (_shelf !== 'media' || !_tree) return;
  if ((fromTree || !_musicish(_node)) && (!_node || _node.key !== 'music')) {
    _tree.select('music', false);
    _node = _tree.selected();
    await _load({ checks: false });
  }
  const at = _musicish(_node) ? _node : null;
  try {
    await MW.open({ place: () => _musicPlace(at), anchor: $('lib-grid'), onLanded: _musicLanded, onSaved: _lyricsSaved, lyric });
  } catch (e) { _status((e && e.message) || 'The music generator did not open', 'err'); }
}
// (phase V59.1) A text saved by the window into Music -> Lyrics: the tree's numbers again, and the gallery while it shows Lyrics.
async function _lyricsSaved() {
  if (_tree) { await _tree.load(); _node = _tree.selected() || _node; }
  _counts();
  if (_shelf === 'media' && _node && _node.key === 'music:lyrics') await _load({ keepScroll: true, checks: false });
}
// The folder the window puts its tracks into, as the window wants it: its key, its folder's id, and its path under Music.
function _musicPlace(n) {
  if (!n) return { key: 'music', label: 'Music' };
  let trail = '';
  try {
    const names = [...(_tree.crumbsEl(n).querySelectorAll('.mt-crumb'))].map(e => e.textContent);
    const i = names.indexOf('Music');
    trail = i >= 0 ? names.slice(i + 1).join(' / ') : '';
  } catch (e) { trail = ''; }
  return { key: n.key, cat: n.cat || '', folder: n.folder || '', label: n.label, trail: trail || n.label };
}
// A press of the window landed (open or closed): the tree's numbers again, and - while the gallery shows the folder its tracks
// went into - the gallery, both tracks outlined.
async function _musicLanded(gen, dest) {
  if (_tree) { await _tree.load(); _node = _tree.selected() || _node; }
  _counts();
  if (_shelf !== 'media' || !_node || _node.kind !== 'music') return;
  const ids = ((gen && gen.results) || []).map(r => String(r.id || '')).filter(Boolean);
  if (dest && _node.key === dest.node && ids.length) {
    _sel = ids[0];
    _selAlso = new Set(ids.slice(1));
    _scrollSel = true;
  }
  await _load({ keepScroll: true, checks: false });
}

// ── The music player (phase V54, the owner's (зв12)-(зв15), (зв25)) ─────────
// A bar under the gallery (not under the tree's column), there while Music is open (its root, highlights, its moods) -
// out of the grid, so drawing the grid again stops nothing. Leaving Music stops it and hides it; back, the same track where it was.
let _player = null;
const _inMusic = () => _shelf === 'media' && !_makingOn && !!_node && _node.kind === 'music';
function _paintPlayer() {
  if (_player) _player.show(_inMusic());
}

// The open shelf's area, in place of the shelf. Lines typed into a scenario are stored first (phase V28.2:
// they save themselves), and a picture shelf's column lets go first - a voice demo must not play on under
// the area.
async function _openMaker(opts) {
  const m = MAKERS[_shelf];
  if (!m) return;
  if (_shelf === 'scenarios') SC.flush();
  if (PICKABLE.has(_shelf)) INFO.leave();
  _makingOn = _shelf;
  if (_narrOn) { _narrOn = false; NR.close(); }   // an Alerts row leads into the generator from the narrators
  _paintMake();
  _status('');
  await m.mod.open(opts || {});
}

// The shelf back, read again - something may have been made. `then` runs before the read (to choose
// what it selects), `after` once it has been: a read ends by clearing the status line, so anything said
// has to come after it.
async function _closeMaker(then, after) {
  if (!_makingOn) return;
  const m = MAKERS[_makingOn];
  // (V38.6) Back from the generator on the draft it was writing: that draft selected, its form on the right.
  const dr = _makingOn === 'scenarios' ? MK.currentDraft() : '';
  await m.mod.close();
  _makingOn = '';
  if (dr) SC.select('d:' + dr);
  if (_narrOn) { _narrOn = false; NR.close(); }
  _paintMake();
  if (then) then();
  await _load({ keepScroll: true });
  _counts();
  if (after) after();
}

// The narrators in place of the list or the generator: hidden, not closed - neither loses anything, and
// lines typed into the open scenario are where they were on the way back.
async function _openNarrators() {
  if (_shelf !== 'scenarios' || _narrOn) return;
  _narrOn = true;
  _paintMake();
  _status('');
  await NR.open();
}

function _closeNarrators() {
  if (!_narrOn) return;
  _narrOn = false;
  NR.close();
  _paintMake();
}

// ── "New scenario": blank or narrator (phase V28.2) ──────────────────────────
// The owner 2026-10-12: "при нажатии new scenario делаем дропдаун с выбором blank и narrator. blank будет открывать попап,
// как при создании сценария в merge, а при клике narrator переходить в generate script". Blank is Merge's own scenario
// window (js/scen-window.js): saved - the shelf again, on it; used - a talking head made from it, and Merge opened on it.
// A menu like Merge's "+ new project": a layer, so Escape and a press outside close it, and the same press does too.
let _newPop = null;
function _closeNewMenu() {
  if (!_newPop) return;
  const p = _newPop;
  _newPop = null;
  p.el.remove();
  document.removeEventListener('mousedown', p.away, true);
  Layers.close(p.layer);
}

function _newMenu(anchor) {
  if (_newPop) { _closeNewMenu(); return; }
  const menu = document.createElement('div');
  menu.className = 'mv3-plus-menu';
  const item = (label, sub, on) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'mv3-plus-item';
    const t = document.createElement('span');
    t.textContent = label;
    const s = document.createElement('small');
    s.textContent = sub;
    b.append(t, s);
    b.addEventListener('click', (e) => { e.stopPropagation(); _closeNewMenu(); on(); });
    menu.appendChild(b);
  };
  item('blank', 'write the lines yourself', _newBlank);
  item('narrator', 'generate a script in a narrator’s voice - from a source or a topic', () => _openMaker());
  document.body.appendChild(menu);
  const r = anchor.getBoundingClientRect();
  menu.style.left = Math.round(Math.max(6, Math.min(window.innerWidth - menu.offsetWidth - 6, r.left))) + 'px';
  menu.style.top = Math.round(r.bottom + 4) + 'px';
  const away = (e) => { if (!menu.contains(e.target) && !anchor.contains(e.target)) _closeNewMenu(); };
  _newPop = { el: menu, away, layer: Layers.open(menu, { modal: false, name: 'new scenario', onEsc: _closeNewMenu }) };
  document.addEventListener('mousedown', away, true);
}

function _newBlank() {
  // Once saved the shelf is read again on it - the lines typed into the open one are stored before its column is
  // painted over (js/library/scenarios.js).
  openScenario(null, {
    closeOnSave: true,
    saved: (rec) => {
      _counts();
      if (_shelf !== 'scenarios' || _makingOn) return;
      SC.select(rec.id);
      _load({ keepScroll: true }).then(() => _status('Saved “' + (rec.title || 'untitled') + '”'));
    },
    // Merge's "use": the talking head made from it, and Merge opened on its setup.
    use: async (rec) => {
      const key = await talkingHead(rec.id);
      location.href = '/merge?p=' + encodeURIComponent(key) + '&step=setup';
    },
  });
}

// ── The media tree (phase V28.5) ─────────────────────────────────────────────
// Made once, read again with the shelf; a node pressed reads the shelf for it. What comes in with no category - an
// upload, a link - shows: a category selected gives way to its kind (Video shows every kind).
function _initTree() {
  const host = $('lib-tree');
  if (!host || _tree) return _tree;
  _tree = createTree(host, {
    // (phase V60, (пп1а), (пп2а)) Nothing selected is the roots; the path begins with "Media", which goes back to them.
    page: 'lib', home: 'Media', start: _treeStart,
    status: (t, bad) => _status(t, bad ? 'err' : ''),
    onSelect: (n) => {
      _node = n || null;
      _sel = '';
      _selAlso = new Set();
      if (_tsel) _tsel.clear();         // another folder: nothing picked
      if (_shelf === 'media') _load({ checks: false });
    },
    // (phase V55, (гн10)) Environments / Lookbooks' "+": their generator's window (phase V58).
    // (phase V59) Music's "+": the music window, on Music itself.
    onMake: (n) => { if (_shelf === 'media' && n && n.make) _openGen(n.make, true); },
    onChanged: (what) => (_shelf === 'media'
      ? _load({ keepScroll: true, checks: !!(what && (what.deleted || what.moved)) }).then(() => _counts()) : null),
    // (phase V34.E) Sounds from Explorer let go on Music, SFX or a category of My sounds go there.
    takesFiles: (n) => _shelf === 'media' && !!SS.filesTo(n),
    onFiles: (n, files) => { _tree.select(n.key, true); _upload(files); },
  });
  return _tree;
}

function _showLanded(kind) {
  // (phase V35) What came in with no category lies in its kind - a B-roll's in Generated - and a folder shows only what
  // lies directly in it: a node elsewhere gives way to that kind.
  const home = kind === 'birols' ? 'generated' : kind;
  // (phase V60) From the roots too.
  if (!_tree || (_node && _node.key === home)) return false;
  _tree.select(home, false);
  _node = _tree.selected();
  return true;
}

// The tree's width: dragged and remembered, a double press for the default. It is on the right: dragging LEFT widens it.
const TREE_DEF = 240, TREE_MIN = 150, TREE_MAX = 480;
function _wireTreeSash() {
  const sash = $('lib-tree-sash');
  const box = $('lib-tree');
  if (!sash || !box) return;
  const apply = (w) => {
    const v = Math.max(TREE_MIN, Math.min(TREE_MAX, Math.round(w)));
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
    document.body.classList.add('lib-colresize');
    const move = (ev) => apply(base - (ev.clientX - from));
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      document.body.classList.remove('lib-colresize');
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

// (V38.6, the owner: "делаем sash в полке scenarios (запоминается положение - двигаем влево вправо)") The Scenarios
// list's width: dragged and remembered, a double press for the usual 360 px ((щ5)); the right side takes the rest.
const LS_SC_W = 'lib_sc_list_w';
const SC_DEF = 360, SC_MIN = 220, SC_RIGHT_MIN = 420;
function _wireScSash() {
  const sash = $('lib-sc-sash');
  const split = $('lib-split');
  if (!sash || !split) return;
  const apply = (w) => {
    const max = Math.max(SC_MIN, (split.clientWidth || 1200) - SC_RIGHT_MIN);
    const v = Math.max(SC_MIN, Math.min(max, Math.round(w)));
    split.style.setProperty('--sc-list-w', v + 'px');
    return v;
  };
  let saved = 0;
  try { saved = parseInt(localStorage.getItem(LS_SC_W) || '', 10); } catch (e) { saved = 0; }
  split.style.setProperty('--sc-list-w', (saved || SC_DEF) + 'px');
  const keep = (v) => { try { localStorage.setItem(LS_SC_W, String(v)); } catch (e) { /* a private window */ } };
  sash.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const from = e.clientX;
    const grid = $('lib-grid');
    const base = grid ? grid.getBoundingClientRect().width : (saved || SC_DEF);
    let w = base;
    document.body.classList.add('lib-colresize');
    const move = (ev) => { w = apply(base + (ev.clientX - from)); };
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      document.body.classList.remove('lib-colresize');
      keep(w);
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  });
  sash.addEventListener('dblclick', () => keep(apply(SC_DEF)));
}

// (V38.6, the owner: "если черновик, то с полями") A draft selected in the list: the generator's form on the shelf's
// right (js/library/make.js mount) - the sources stay out of it, they belong to "New scenario → narrator". The draft on
// show already is only shown again, as it was.
async function _showDraftHere(id) {
  const host = $('lib-sc-draft'), info = $('lib-info');
  if (!host) return;
  if (info) info.hidden = true;
  host.hidden = false;
  if (MK.embeddedDraft() === String(id)) return;
  MK.mount(host);
  if (!(await MK.openDraft(id))) { SC.select(''); await _load({ keepScroll: true }); }
}
function _hideDraftHere() {
  const host = $('lib-sc-draft');
  if (!host || host.hidden) return;
  host.hidden = true;
  MK.close();                                     // what is typed is saved; what runs goes on
}
// The draft rows again - a stage started or landed in the form on the shelf - without reading the scenario on show.
async function _refreshDraftRows() {
  if (_shelf !== 'scenarios' || _makingOn) return;
  try {
    const dd = await fetch('/api/scriptgen/drafts').then(r => r.json());
    if (!dd || !dd.success) return;
    _drafts = dd.drafts || [];
  } catch (e) { return; }
  if (_shelf !== 'scenarios' || _makingOn) return;
  const grid = $('lib-grid');
  const top = grid ? grid.scrollTop : 0;
  _renderGrid();
  if (grid) grid.scrollTop = top;
}

// ── Actions ─────────────────────────────────────────────────────────────────
// Which ones an item offers is a property of its shelf, not of the UI: a lookbook file
// has no favourite flag to set and no category to file it under, a character's name is
// a label while a lookbook's name IS its filename. The viewer's action row reads it.
const _FAVABLE = new Set(['birols', 'uploads', 'hooks', 'images', 'sounds', 'music', 'sfx']);
// Which kinds a record can be CONVERTED between. Not the same set as the ones that can be
// starred: an image and a clip are different files in different stores, and there is no
// meaning to turning a picture into a birol. The server refuses it too - see the /kind route.
const _KINDABLE = new Set(['birols', 'uploads', 'hooks']);
// All three kinds can be filed under a category. Hook records already carried categoryId —
// public/js/scen-hooks.js has always written it — so this offers a control for data that
// was already there.
const _CATABLE = new Set(['birols', 'uploads', 'hooks', 'images', 'sounds']);

// (second round) A talking head is its project's while the project lives - nothing is done to it from here; one kept from a
// deleted project (`meta.kept`) is the library's and is deleted like anything.
const _fixed = (it) => (it.kind === 'heads' && !(it.meta && it.meta.kept))
  // (phase TG, block 6; after block 8 in REFERENCES -> YouTube -> Videos) A downloaded YouTube video is a source of the
  // scenarios: no star, no cross, not moved - watched, sent to highlights and deleted (twice) in its viewer.
  || it.kind === 'youtube';

function _actionsFor(it) {
  const out = [];
  if (it.kind === 'youtube') return YT.ytActions(it);
  if (_fixed(it)) return out;
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
  // A character whose sheet is being made is left alone until it lands (phase H6).
  if ((id === 'rename' || id === 'del') && it.kind === 'characters' && it.meta && it.meta.sheetRunning) {
    return { msg: 'Its 4K sheet is being made - wait for it, or let it go in Alerts first', err: true };
  }
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
  // (block 6) A video of YOUTUBE into a new highlights project, chosen in its popup already.
  if (id === 'hl') { location.href = '/merge?source=' + encodeURIComponent((it.meta && it.meta.source) || it.id); return { changed: false }; }
  // (after block 8, the owner's (Y4)) A downloaded YouTube video deleted as a source - the second press within a few seconds.
  if (id === 'srcdel') {
    const r = await YT.ytDelete(it);
    if (r.armed) return { actionsOnly: true, msg: r.msg };
    _items = _items.filter(x => x !== it);
    return { removed: true, reload: true, msg: 'Source deleted' };
  }
  if (id === 'del' && it.kind === 'references') {
    // (phase TG) A post of REFERENCES goes with its files - its own route.
    if (!confirm(await RP.deleteQuestion(it))) return { changed: false };
    const r = await fetch('/api/references/' + encodeURIComponent(it.id), { method: 'DELETE' }).then(x => x.json());
    if (!r || !r.success) throw new Error((r && r.error) || 'not deleted');
    _items = _items.filter(x => x !== it);
    return { removed: true, reload: true, msg: 'Post deleted' };
  }
  if (id === 'del') {
    if (!confirm(await A.deleteQuestion(it))) return { changed: false };
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
  // Something gone - deleted, or moved to another kind - is what can change Media's checks; and the tree's numbers.
  if (r.reload || r.removed) {
    if (_shelf === 'media' && _tree) await _tree.load();
    await _load({ keepScroll: true, checks: !!r.removed });
    _counts();
  }
  else if (r.changed) { _renderGrid(); _showSelected(); }
  if (r.msg) _status(r.msg, r.err ? 'err' : '');
}

// (phase TG, the owner 2026-10-21: "счетчик не обновился в library после скачивания поста") A post the Telegram bot
// brought in while this page is open: the tree's numbers, the shelves' counts and Media's gallery read again (the
// signal is js/alerts-bell.js's, which also chimes).
window.addEventListener('ugc-references', () => {
  if (_tree) _tree.load();
  _counts();
  if (_shelf === 'media' && !_makingOn) _load({ keepScroll: true, checks: false });
});

// (phase TG) A post of REFERENCES in the post viewer (js/references/post.js), paging through the posts on view; a post
// deleted there reads the shelf and the tree again.
function _openPost(it, file) {
  const posts = _items.filter(x => x.kind === 'references');
  const at = posts.findIndex(x => String(x.id) === String(it.id));
  if (at < 0) { _status('That post is no longer here', 'err'); return; }
  // Deleted, moved, or a piece cut out of it into a new clip (block 7) - the post viewer says which itself.
  RP.openPost(posts, at, { file, onChanged: (w) => _apply({ removed: !!(w && w.deleted), reload: true, msg: (w && w.deleted) ? 'Post deleted' : '' }) });
}

// (phase V59.1) A saved text of Music -> Lyrics, whole, in the viewer - paging through the texts here (js/sound/lyrics.js):
// Copy, Use in Custom, Rename, Delete; renamed or deleted, the gallery and the tree are read again.
function _openLyric(it) {
  LYR.openLyrics(_items, it, {
    status: (t, bad) => _status(t, bad ? 'err' : ''),
    changed: async () => { if (_tree) await _tree.load(); await _load({ keepScroll: true, checks: false }); _counts(); },
  });
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
  Cut.reset();
  openViewer(items, at, {
    onIndex: typeof follow === 'function' ? (_i, item) => follow(item) : null,
    actionsFor: _actionsFor,
    // A video is cut into new pieces under the stage; a piece shows its whole video on a tick (js/cut.js).
    underStage: (item, video) => Cut.underStage(item, video, {
      say: (t, err) => _status(t, err ? 'err' : ''),
      onSaved: (r) => _apply({ reload: true, msg: 'Saved as a new clip in ' + r.where + '.' }),
    }),
    videoSrc: Cut.videoSrc,
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
          () => [{ id: '', label: '— no folder —' }].concat(_catsFor(item.kind, (item.meta && item.meta.categoryId) || '')),
          (id) => _setCat(item, id), 'Folder')]);
      }
      const orig = Cut.originalRow(item, repaintViewer);
      if (orig) rows.push(orig);
      // (phase V55) A made environment or lookbook in IMAGES: what is known about it, as its shelf's column says.
      rows.push(...madeRows(item));
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
let _catsByKind = { birols: [], uploads: [], hooks: [], sounds: [] };
// (phase V54 block 6, (зв45)) A folder in a folder reads as its path - "Товары / Обувь / Лето" - in the tree's order.
// (phase V57) The references of Environments / Lookbooks (`closed`) take nothing by hand: offered only as where the item
// already is (`current`), and not to be chosen.
const _catsFor = (kind, current) => (_catsByKind[kind] || []).filter(c => !c.closed || c.id === current).map(c => Object.assign({}, c,
  { label: Array.isArray(c.trail) && c.trail.length ? c.trail.join(' / ') : (c.title || c.label) }, c.closed ? { disabled: true } : {}));
async function _loadCats() {
  try { _catsByKind = await A.loadCats(); } catch (e) { _catsByKind = { birols: [], uploads: [], hooks: [], sounds: [] }; }
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
      if (o.disabled) opt.disabled = true;
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
  // (phase V55) A made environment or lookbook in IMAGES (the media shelf's) comes with its door address already.
  if (String(it.thumb || '').startsWith('/api/thumb?')) return String(it.thumb).replace('&v=card', '&v=strip');
  if (!_SIZED.has(it.kind)) return it.thumb || '';
  const src = it.thumb || it.media;
  return src ? _door(src) : '';
}

// One sound heard at a time on the Media shelf: a press on its card plays it there - no window - and a press on it again,
// or anywhere else, stops it (the owner, V28.4: "воспроизведение по клику на аудио без попапов").
let _hearing = null;
function _stopHearing() {
  if (!_hearing) return;
  try { _hearing.audio.pause(); } catch (e) { /* gone */ }
  document.removeEventListener('mousedown', _hearing.away, true);
  _hearing.card.classList.remove('is-playing');
  _hearing = null;
}
function _hearToggle(it, card) {
  if (_hearing && _hearing.id === it.id) { _stopHearing(); return; }
  _stopHearing();
  const audio = new Audio(it.media);
  const away = (e) => { if (!card.contains(e.target)) _stopHearing(); };
  _hearing = { id: it.id, audio, card, away };
  card.classList.add('is-playing');
  audio.addEventListener('ended', () => { if (_hearing && _hearing.audio === audio) _stopHearing(); });
  document.addEventListener('mousedown', away, true);
  audio.play().catch(() => { _stopHearing(); _status('That file will not play', 'err'); });
}

function _card(it, extra) {
  const card = document.createElement('div');
  card.className = 'lib-card' + (it.meta && it.meta.favorite ? ' fav' : '');
  card.dataset.id = String(it.id);
  // (phase V54) What js/tile-select.js picks it by - on Media.
  if (_shelf === 'media') card.dataset.key = it.kind + ':' + it.id;
  card.title = it.name + (it.meta && it.meta.character ? '\n' + it.meta.character : '');

  // The ratio lives on the box: an <img> with no loaded source contributes no height,
  // which collapsed the rows and killed the grid's scrolling.
  const src = _tileSrc(it);
  const box = document.createElement('div');
  box.className = 'lib-thumb-box' + (src ? '' : ' lib-thumb-pending');
  if (LYR.isLyrics(it)) {
    // (phase V59.1) A saved text: its title and first lines; a press opens it whole (_openLyric).
    box.className = 'lib-thumb-box lib-thumb-text';
    box.appendChild(LYR.tileFace(it));
    card.title = LYR.tileTitle(it);
  } else if (AUDIO.has(it.kind)) {
    // A sound or a track has no picture: a note and its length; the card plays it (_hearToggle).
    box.className = 'lib-thumb-box lib-thumb-sound';
    const note = document.createElement('span');
    note.className = 'lib-snd';
    note.textContent = '♪';
    box.appendChild(note);
    // (phase V34.E) Its waveform (lib/audio-wave.js; a built-in sound's comes with the set).
    box.appendChild(waveEl((it.meta || {}).wave, 'snd-twave'));
    if (it.dur) {
      const d = document.createElement('span');
      d.className = 'lib-snd-dur';
      const m = Math.floor(it.dur / 60);
      d.textContent = m ? m + ':' + String(Math.round(it.dur - m * 60)).padStart(2, '0') : (+it.dur).toFixed(1) + ' s';
      box.appendChild(d);
    }
  } else {
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
  }

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
  // (phase V34.E) A built-in sound is the app's: a star, never a cross.
  if (!_fixed(it) && it.kind !== 'sfx') {
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
  }
  card.appendChild(box);

  const name = document.createElement('div');
  name.className = 'lib-name';
  // (second round) A talking head: its project and line in the tooltip, and a mark when this take is on a timeline.
  if (it.kind === 'heads') {
    const m = it.meta || {};
    card.title = [m.project, it.name, m.used ? 'on a timeline' : ''].filter(Boolean).join('\n');
    if (m.used) {
      const tag = document.createElement('b');
      tag.className = 'lib-hid is-used';
      tag.textContent = 'in use';
      name.appendChild(tag);
    }
  }
  name.appendChild(document.createTextNode(it.name));
  // (phase V35, the owner's (т1)) A sound or a track is a square, as in Merge: its name inside it, under the note.
  // (phase V59.1) A saved text has its title on its face already.
  if (AUDIO.has(it.kind)) box.appendChild(name); else if (!LYR.isLyrics(it)) card.appendChild(name);
  // A sound's or a track's name is changed where it is read - it has no window to do it in.
  if (AUDIO.has(it.kind) && it.kind !== 'sfx') {
    name.title = it.name + (it.meta && it.meta.style ? ' · ' + it.meta.style : '') + ' - a double press renames it';
    name.addEventListener('dblclick', async (e) => {
      e.stopPropagation();
      try { await _apply(await _runAction('rename', it)); } catch (err) { _status(err.message, 'err'); }
    });
  }
  // (phase V28.5) On Media a card is dragged onto a node of the tree - another category, another kind of video (not a
  // talking head, which is its project's).
  if (_shelf === 'media' && !_fixed(it)) {
    card.draggable = true;
    // (phase V54) A picked tile carries the others picked with it.
    card.addEventListener('dragstart', (e) => { e.dataTransfer.effectAllowed = 'move'; setMediaDrag(e.dataTransfer, it, _pickedWith(it)); });
  }

  // Second line: which category this clip is filed under, changeable in place. Only
  // where a category means something — hooks and the image shelves have none.
  if (_CATABLE.has(it.kind)) {
    card.appendChild(_picker('lib-cat-sel', (it.meta && it.meta.categoryId) || '',
      () => [{ id: '', label: '— no folder —' }].concat(_catsFor(it.kind, (it.meta && it.meta.categoryId) || '')),
      (id) => _setCat(it, id), 'Folder'));
  }

  if (extra) card.appendChild(extra);
  // (phase TG) A post of REFERENCES: how many files, and its miniatures on hover - a press on one opens the post on it.
  if (it.kind === 'references') RP.decorate(card, it, (post, file) => _openPost(post, file));
  // NO MENU ON A TILE (phase B7, the owner 2026-09-29) - the page's is gone, and the window's own
  // ("Copy image / Save image as", desktop/main.js) must not open in its place: it would save this
  // miniature, not the file. What the old menu offered is in the viewer and on the tile.
  // (phase V34.E, the owner's (р2)) The exception: a sound's or a track's menu - Cut…, Rename, Move to, About, Delete.
  card.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    // (phase V54) Several picked, this one among them: their menu - Move to…, the star, Delete N.
    const many = _pickedWith(it);
    if (many) { _manyMenu(many, e); return; }
    if (!AUDIO.has(it.kind)) return;
    soundMenu(it, e, {
      status: (t, bad) => _status(t, bad ? 'err' : ''),
      stop: () => { _stopHearing(); if (_player) _player.pause(); },
      changed: async () => { if (_tree) await _tree.load(); await _load({ keepScroll: true }); _counts(); },
      del: async (x) => {
        try { _stopHearing(); await _apply(await _runAction('del', x)); if (_player) _player.forget(x.id); }
        catch (err) { _status(err.message, 'err'); }
      },
      // (phase V54, (зв14)) A track's "Cut…" opens it in the player, a piece marked; SFX and My sounds - the Cut window.
      cut: (x) => (x.kind === 'music' && _player && _inMusic() ? (_player.open(x, { cut: true }), true) : false),
    });
  });
  return card;
}

// ── Several tiles picked (phase V54 block 5, (зв17)) ────────────────────────
// js/tile-select.js picks them on Media; let go on the tree they go in one request (js/media-tree.js), and here are the
// right button's menu and Delete for them.
let _tsel = null;
const _keyOf = (it) => it.kind + ':' + it.id;
// The picked items when `it` is one of several picked - else null.
function _pickedWith(it) {
  if (!_tsel || _tsel.size() < 2 || !_tsel.has(_keyOf(it))) return null;
  const keys = new Set(_tsel.keys());
  return _items.filter(x => keys.has(_keyOf(x)));
}
function _picked() {
  if (!_tsel) return [];
  const keys = new Set(_tsel.keys());
  return _items.filter(x => keys.has(_keyOf(x)));
}
async function _afterMany(d, verb, deleted) {
  if (deleted && _player) for (const x of _picked()) _player.forget(x.id);
  if (_tree) await _tree.load();
  await _load({ keepScroll: true, checks: !!deleted });
  _counts();
  if (d) _status(TS.saidOf(d, verb), !d.done && (d.skipped || []).length ? 'err' : '');
}
function _manyMenu(items, e) {
  const n = items.length;
  const starable = items.filter(x => !['references', 'heads', 'youtube', 'lyrics'].includes(x.kind) && !MADE_KINDS.has(x.kind));
  const allFav = starable.length && starable.every(x => x.meta && x.meta.favorite);
  // (phase V55, (гн9)) What the generators of Environments / Lookbooks made moves nowhere - said where "Move to…" was.
  const madeOnly = items.every(x => MADE_KINDS.has(x.kind));
  TS.menuAt(e.clientX, e.clientY, [
    // (phase V59.1) Saved texts stay in Music -> Lyrics.
    items.every(LYR.isLyrics) ? ['Move to…', 'texts stay in Music → Lyrics', null]
    : madeOnly ? ['Move to…', 'made by its generator - it stays where it is', null]
      : ['Move to…', n + ' items - each where it can go', () => TS.moveMany(e.clientX, e.clientY, items, {
        done: (d) => _afterMany(null, '', false).then(() => d),
        status: (t, bad) => _status(t, bad ? 'err' : ''),
      })],
    [allFav ? '★ Remove from favourites' : '★ Add to favourites', !starable.length ? 'they have no star' : starable.length < n ? 'some of them have no star' : '',
      starable.length ? async () => {
        try { _afterMany(await TS.batch('favorite', starable, { favorite: !allFav }), allFav ? 'taken off favourites' : 'in favourites'); }
        catch (err) { _status(err.message, 'err'); }
      } : null],
    ['Delete ' + n, 'with their files - asked first', () => _deleteMany(items), true],
  ]);
}
async function _deleteMany(all) {
  // The app's own sounds, a project's talking head and a YouTube source (two presses on its tile) are not deleted here -
  // the question names only what will go (as in Merge).
  const items = all.filter(x => x.kind !== 'sfx' && !_fixed(x));
  if (!items.length) { _status('Nothing picked here can be deleted - built-in sounds, a project\'s talking heads and YouTube sources stay', 'err'); return; }
  if (items.length > TS.BATCH_MAX) { _status('At most ' + TS.BATCH_MAX + ' at once - ' + items.length + ' are picked.', 'err'); return; }
  // One alone: the question it always had.
  if (items.length === 1) {
    try { await _apply(await _runAction('del', items[0])); if (_player) _player.forget(items[0].id); } catch (err) { _status(err.message, 'err'); }
    return;
  }
  if (!confirm(await TS.deleteQuestion(items))) return;
  _stopHearing();
  try { await _afterMany(await TS.batch('delete', items), 'deleted', true); }
  catch (err) { _status(err.message, 'err'); }
}

// (phase V35, the owner's (у2)) The path to Media's node at the left of the bar - "AUDIO / SFX / My sounds", every word a
// press away (js/media-tree.js crumbsEl); a tile let go on a word goes there.
function _paintCrumbs() {
  const host = $('lib-crumbs');
  if (!host) return;
  // (phase V60, (пп2а)) "Media" first - alone at the roots, a press away from any folder.
  const on = _shelf === 'media' && !_makingOn && !!_tree;
  host.hidden = !on;
  host.textContent = '';
  if (on) host.appendChild(_tree.crumbsEl(_node));
}

// (phase V34.E) Over SFX: the search, and "find online…" - "find «words» online" when the words found nothing here (р3).
function _paintSndHead() {
  _paintCrumbs();
  const host = $('lib-snd-head');
  if (!host) return;
  const on = _shelf === 'media' && !_makingOn && SS.isSfx(_node);
  host.hidden = !on;
  host.textContent = '';
  if (!on) return;
  host.appendChild(SS.searchHead({ q: _q, found: _items.length > 0,
    onSearch: (q) => { _q = q; _load({ checks: false }); }, onOnline: (q) => _online(q) }));
}
async function _online(q) {
  openOnline({ cats: await myCats(), cat: _node && _node.kind === 'sounds' && _mcat() ? _mcat() : '', q,
    stop: () => _stopHearing(),
    added: async () => { if (_tree) await _tree.load(); await _load({ keepScroll: true }); _counts(); } });
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
  const c = _catsFor(it.kind, id).find(x => x.id === id) || { id: '', label: '' };
  try {
    await A.setCategory(it, c.id, c.label);
    it.meta = it.meta || {}; it.meta.categoryId = c.id;
    await _apply({ changed: true, reload: true, msg: c.id ? ('In ' + c.label) : 'Out of its folder' });
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
  // Scenarios are text, so they are rows too, and one is always selected with the right column
  // about it - see js/library/scenarios.js (phase D5).
  if (_shelf === 'scenarios') {
    // reload, not a local patch: a saved scenario changes its line count, and that count is the
    // store's answer rather than the editor's.
    SC.render(_items, {
      reload: () => _load({ keepScroll: true }), status: _status, counts: _counts,
      // (V38.6) A draft is selected like a scenario, its form on the right; one made elsewhere is
      // selected once the list has been read with it.
      drafts: _drafts, showDraft: _showDraftHere, hideDraft: _hideDraftHere,
      openDraft: (id) => { SC.select('d:' + id); return _load({ keepScroll: true }); },
    });
    return;
  }
  // (phase V23) Renders are rows of projects, each opening a strip of its renders - js/library/renders.js. The cards
  // are the shelf's own; the viewer pages inside the project.
  if (_shelf === 'renders') {
    RE.render(_items, { card: _card, open: (it, list) => _open(it, list) });
    return;
  }
  _stopHearing();
  grid.textContent = '';
  // each shelf shapes its own cards (see library.css): sheets are wide, lookbooks square
  grid.className = 'lib-grid is-' + _shelf;
  // (phase V35, the owner's (т1), (т3)) Sounds and tracks are square cards; a folder of horizontal videos (YouTube ->
  // Videos, the node's `tiles: 'wide'`) has 16:9 ones - css/library.css.
  if (_shelf === 'media') {
    grid.classList.toggle('is-sound', _items.length > 0 && _items.every(x => AUDIO.has(x.kind)));
    // (phase V59.1) Music -> Lyrics: cards of text.
    grid.classList.toggle('is-text', _items.length > 0 && _items.every(LYR.isLyrics));
    grid.classList.toggle('is-wide', !!(_node && _node.tiles === 'wide'));
  }
  // (phase V35, the owner's (т2)) Media is a folder: its folders first as tiles (js/media-tree.js), then what lies
  // directly in it. A search over SFX shows what it found in all of SFX, with no folders. (phase V60) At the roots: the four
  // top nodes as folder tiles.
  const searching = _shelf === 'media' && !!(_q && SS.isSfx(_node));
  const folders = _shelf === 'media' && !searching && _tree ? _tree.foldersEl(_node) : null;
  if (folders) grid.appendChild(folders);

  if (!_items.length) {
    if (folders) return;
    const e = document.createElement('div');
    e.className = 'lib-empty';
    e.textContent = _shelf === 'media' ? (searching ? 'Nothing with "' + _q + '" in SFX.'
      // (phase V59.1) Music -> Lyrics: where its texts come from.
      : _mkind() === 'lyrics' ? 'No saved lyrics yet - Generate music saves them here (its Lyrics, or "save" by Custom\'s Lyrics).'
      : 'Nothing here' + (_node && _node.cat ? ' in this folder.' : ' yet.')) : 'Nothing on this shelf yet.';
    grid.appendChild(e);
    return;
  }
  // The viewer pages through what it can show - not the sounds and tracks, which play on their cards.
  const seen = _items.filter(x => !AUDIO.has(x.kind));

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
      // Its 4K sheet is still being made (phase H6): the tile shows the face until it lands.
      if (it.meta.sheetRunning) {
        const s = document.createElement('span');
        s.className = 'lib-sub-run';
        s.textContent = '· sheet…';
        s.title = 'The 4K reference sheet is being made - it replaces the face when it lands';
        sub.appendChild(s);
      }
    }
    const card = _card(it, sub);
    if (PICKABLE.has(_shelf)) {
      // A picture shelf's tile SELECTS: the right column says what it is, and the enlarged view is
      // the column's picture pressed. Pressing the selected one again reads the column again (B4).
      card.classList.toggle('cur', String(it.id) === _sel);
      card.addEventListener('click', () => _pick(it));
    } else {
      // (phase V28.1) Media opens a tile in the viewer and selects nothing - but one arrived at from elsewhere (a
      // vertical video sent onto Uploads, "show") is outlined, so it is found at once.
      if (_shelf === 'media') card.classList.toggle('cur', String(it.id) === _sel || _selAlso.has(String(it.id)));
      // (phase V54) A track in Music plays in the player; SFX and My sounds on their cards, as before.
      if (it.kind === 'music' && _player && _inMusic()) card.addEventListener('click', () => { _stopHearing(); _player.open(it); });
      else if (AUDIO.has(it.kind)) card.addEventListener('click', () => _hearToggle(it, card));
      else if (it.kind === 'references') card.addEventListener('click', () => _openPost(it, 0));
      else if (LYR.isLyrics(it)) card.addEventListener('click', () => _openLyric(it));
      else card.addEventListener('click', () => _open(it, _shelf === 'media' ? seen : null));
    }
    grid.appendChild(card);
  }
  if (_player && _shelf === 'media') { _player.sync(_items); _player.mark(grid); }
  if (_tsel) _tsel.refresh();
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
  // A character's voice or gender changed in its column (phase H7): the tiles say so, the column stays.
  changed: () => {
    const g = $('lib-grid');
    const top = g ? g.scrollTop : 0;
    _renderGrid();
    if (g) g.scrollTop = top;
  },
  openLook: (l, list) => _open(l, list),
  card: (l) => _card(l),
};

// WHAT LANDS IS SEEN BY THE SHELF. While a character's tile says "sheet…" (phase H6) - and on Renders while posters are
// made - the shelf is asked every ten seconds, and its tiles drawn again when the answer differs: the face on a tile turns
// into its sheet. (Lookbooks and Environments were watched so until phase V56 took their shelves away.)
let _sheetT = null;
let _shelfRunning = 0;    // what the last read of Renders said is being made there
const _watched = (kind, items, running) => (kind === 'characters'
  ? (items || []).some(it => it && it.meta && it.meta.sheetRunning)
  // (phase V23) Renders: while posters are being made in the background (lib/render-posters.js).
  : kind === 'renders' && running > 0);
const _shelfSig = (items, running) => (items || [])
  .map(it => String(it.id) + (it && it.meta && it.meta.sheetRunning ? '*' : '') + (it && it.thumb ? '+' : '')
    + ((it && it.meta && it.meta.dur) ? '~' : '')).join() + '|' + (running || 0);

function _watchShelf() {
  clearTimeout(_sheetT);
  _sheetT = null;
  const kind = _shelf;
  if (_makingOn || !_watched(kind, _items, _shelfRunning)) return;
  const was = _shelfSig(_items, _shelfRunning);
  _sheetT = setTimeout(async () => {
    _sheetT = null;
    if (_shelf !== kind || _makingOn) return;
    try {
      const d = await (await fetch('/api/library/shelf/' + kind)).json();
      if (_shelf === kind && !_makingOn && d && d.success) {
        _shelfRunning = d.running || 0;
        if (_shelfSig(d.items, d.running) !== was) {
          // The tiles again, the column left alone (review H): it may be in the middle of a voice search,
          // a Save or a description being written. The items keep their identity - the column holds one
          // of them - and take the new fields.
          const old = new Map(_items.map(it => [String(it.id), it]));
          _items = (d.items || []).map(n => { const o = old.get(String(n.id)); return o ? Object.assign(o, n) : n; });
          const g = $('lib-grid');
          const top = g ? g.scrollTop : 0;
          _renderGrid();
          if (g) g.scrollTop = top;
          const cur = _items.find(it => String(it.id) === _sel);
          if (cur) INFO.setPicture(kind, cur);
          // The selected one gone, or none yet (the first picture landing on an empty shelf): one is
          // always selected on a picture shelf, so the column follows the top-left tile (review I).
          else _showSelected();
          _counts();
        }
      }
    } catch (e) { /* asked again next round */ }
    _watchShelf();
  }, 10000);
}

async function _load(opts) {
  const grid0 = $('lib-grid');
  const scroll = (opts && opts.keepScroll && grid0) ? grid0.scrollTop : null;
  if (opts && opts.checks) _checksDue = true;
  const my = ++_reqId;
  _status('Reading…');
  _paintShelves();
  // The right column belongs to the picture shelves, where it says what the selected tile is, and to
  // Voices and Scenarios, whose modules fill it with the selected row. Every other shelf has the
  // whole width.
  if (!PICKABLE.has(_shelf) && _shelf !== 'voices' && _shelf !== 'scenarios') INFO.hide();
  try {
    // Media: what lies directly in the node the media tree has selected (its `q`; phase V35: the folders are drawn
    // from the tree, a node that only holds folders asks for nothing) - or a search over all of SFX (the owner's (у3)).
    if (!(_shelf === 'media' && SS.isSfx(_node))) _q = '';
    const mq = _shelf === 'media' ? (_q ? { group: 'sfxall', q: _q } : (_node && _node.q) || null) : null;
    const qs = new URLSearchParams(mq || {});
    const q = qs.toString();
    const url = '/api/library/shelf/' + _shelf + (q ? '?' + q : '');
    // Scenarios: the drafts head the list (phase E4), read beside the shelf.
    const draftsP = _shelf === 'scenarios'
      ? fetch('/api/scriptgen/drafts').then(r => r.json()).catch(() => null) : null;
    const d = (_shelf === 'media' && !mq) ? { success: true, items: [] } : await (await fetch(url)).json();
    if (my !== _reqId) return;
    if (!d || !d.success) throw new Error((d && d.error) || 'read failed');
    if (draftsP) {
      const dd = await draftsP;
      if (my !== _reqId) return;
      _drafts = (dd && dd.success && dd.drafts) || [];
    }
    _items = d.items || [];
    _paintSndHead();
    _labelKeys = d.labelKeys || null;      // the tag order the voices shelf reads out
    _shelfRunning = d.running || 0;
    _renderGrid();
    _showSelected();       // the column follows the shelf it was read with
    // MEDIA'S CHECKS ONLY WHEN THEY CAN HAVE CHANGED (phase D3, the owner 2026-09-29): entering Media,
    // and after an upload, a delete, a kind change, a category deleted with its clips, a clean or a
    // repair. They used to run on every read - every filter chip, every star - and twice as the
    // page opened; Thumbnails re-reads the whole shelf and opens every poster's header, and the
    // tiles' own pictures waited behind all of it.
    if (_checksDue) { _checksDue = false; _runChecks(); }
    if (scroll != null) { const g = $('lib-grid'); if (g) g.scrollTop = scroll; }
    if (_scrollSel) {
      _scrollSel = false;
      const c = document.querySelector('#lib-grid .lib-card.cur');
      if (c) c.scrollIntoView({ block: 'nearest' });
    }
    _watchShelf();
    _status('');
  } catch (e) {
    if (my !== _reqId) return;
    _items = [];
    _paintSndHead();
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
  if (!SHELVES[kind]) return;
  // The open shelf's button pressed while its making area shows goes back to the shelf, as "← …" does
  // (phase F4); pressing the open shelf otherwise does nothing.
  if (kind === _shelf) {
    if (_makingOn) _closeMaker();
    else _closeNarrators();
    return;
  }
  if (_shelf === 'voices') V.leave();      // a demo must not keep playing into another shelf
  if (_shelf === 'media') _stopHearing();  // nor a sound or a track
  if (_shelf === 'scenarios') SC.leave();  // and the lines typed are stored, an answer on its way dropped
  // A making area is hidden, not stopped: a draft typed into is saved now, what it runs goes on.
  if (_makingOn) { MAKERS[_makingOn].mod.close(); _makingOn = ''; }
  if (_narrOn) { NR.close(); _narrOn = false; }
  if (PICKABLE.has(_shelf)) INFO.leave();  // nor a character's voice, or an answer on its way
  _shelf = kind;
  _sel = '';                               // a shelf opens on its top-left tile (B2)
  _selAlso = new Set();
  if (_tsel) _tsel.clear();
  try { localStorage.setItem(LS_SHELF, kind); } catch (e) {}
  _load({ checks: kind === 'media' });
}

// (phase V60, the owner 2026-10-29, (пп1а): "чтобы не рандомная папка открывалась при нажатии полки, а показывались все
// корневые папки") Media's ROOTS: nothing selected in the tree, every branch folded, the gallery the four top nodes. The
// shelf pressed - from another shelf, or on Media again - opens there; an address with a folder opens on its folder.
function _toRoots() {
  if (_tree) _tree.home(false);
  _node = null;
  _q = '';
  _sel = '';
  _selAlso = new Set();
  if (_tsel) _tsel.clear();
}
function _pressShelf(kind) {
  if (kind !== 'media' || !_tree) { _select(kind); return; }
  const here = _shelf === 'media';
  _toRoots();
  if (!here) { _select('media'); return; }
  _stopHearing();
  _load({ checks: false });
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
    lines.push(moves + ' clip' + (moves === 1 ? '' : 's') + ' will show in a different folder,');
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
  // (phase V55) Environments / Lookbooks take only what their generator made: "New …" stands in the bar instead.
  // (phase V60) At the roots nothing is brought in - a root is opened first.
  btn.hidden = _shelf !== 'media' || !_node || !!_madeNode();
  // (phase V27) Clips come by a link too - B-rolls, Uploads, Hooks, not pictures or sounds.
  const lk = $('lib-link');
  if (lk) {
    lk.hidden = !_linkKind();
    lk.title = 'Add videos from YouTube, TikTok, Instagram and other sites to ' + _landName(_linkKind())
      + ' - one link per line, or let a link go over the shelf';
  }
  if (btn.hidden) return;
  // The NODE selected in the media tree decides what can be brought in and where it lands (phase V28.5).
  const kind = _mkind();
  btn.disabled = false;
  if (kind === 'images') {
    btn.textContent = 'Upload images';
    // (phase V57) In the references of Environments / Lookbooks it says why not, and a press says it again (`_shut`).
    btn.title = _shut() || 'Add pictures to the library. A PNG keeps its transparency.';
    if (inp) inp.accept = PICTURE_ACCEPT;
    return;
  }
  // (phase V34.E) Built-in is the app's, Favorites the starred: nothing is brought in there. SFX itself takes sounds.
  if (_node && (SS.isBuiltin(_node) || _node.key === 'sfx-fav')) {
    btn.textContent = 'Upload';
    btn.disabled = true;
    btn.title = _node.key === 'sfx-fav' ? 'Favorites are the starred sounds - the ★ on a card' : 'Built into the app - read only';
    return;
  }
  if (kind === 'sounds' || (_node && _node.key === 'sfx-all')) {
    btn.textContent = 'Upload sounds';
    btn.title = 'Add sounds - mp3, wav, m4a, ogg, flac - into SFX' + (_mcat() ? ', the folder selected' : '') + '.';
    if (inp) inp.accept = 'audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac,.opus';
    return;
  }
  if (kind === 'music') {
    btn.textContent = 'Upload music';
    btn.title = 'Add tracks - mp3, wav, m4a, ogg, flac - to Music.';
    if (inp) inp.accept = 'audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac,.opus';
    return;
  }
  if (_node && _node.key === 'audio') {
    btn.textContent = 'Upload';
    btn.disabled = true;
    btn.title = 'Pick Music or SFX in the tree first';
    return;
  }
  if (kind === 'heads') {
    btn.textContent = 'Upload';
    btn.disabled = true;
    btn.title = 'Talking heads come from the talking-head projects - nothing is uploaded here';
    return;
  }
  // (phase V59.1) Music -> Lyrics: texts saved by Generate music - no file.
  if (kind === 'lyrics') {
    btn.textContent = 'Upload';
    btn.disabled = true;
    btn.title = 'Lyrics holds the texts saved from Generate music (its Lyrics, or "save" by Custom\'s Lyrics) - nothing is uploaded here';
    return;
  }
  if (inp) inp.accept = 'video/*';
  // Say where the files will land, so pressing it is never a surprise.
  btn.textContent = 'Upload to ' + _landName(_linkKind());
  btn.title = 'Add video files to ' + _landName(_linkKind());
}

// ── By a link (phase V27) ───────────────────────────────────────────────────
// The kind a link's clip goes to, as an upload's would: the kind selected, Uploads under Video; '' where no clip goes.
// Where a clip brought in lands, in words (second round): a B-roll comes in with no category - into Generated itself.
function _landName(kind) {
  if (kind === 'birols') return 'Generated';
  const k = A.KINDS.find(x => x.id === kind);
  return k ? k.label + 's' : 'Uploads';
}

function _linkKind() {
  if (_shelf !== 'media' || !_node) return '';
  if (VIDEO.has(_mkind())) return _mkind();
  // (second round) Generated takes B-rolls (with no category - they lie in it); Talking heads takes nothing.
  if (_node.key === 'generated') return 'birols';
  return _node.key === 'video' ? 'uploads' : '';
}

let _linking = null;      // { ids, total, kind } while links are being brought in

function _openLinks(prefill) {
  const kind = _linkKind();
  if (!kind) return;
  LK.openLinkWindow({ where: _landName(kind), prefill, onAdd: (urls) => _addLinks(urls, kind) });
}

async function _addLinks(urls, kind) {
  let jobs;
  try { jobs = await LK.addLinks(urls, { kind, from: 'media' }); }
  catch (e) { _status(e.message, 'err'); return; }
  // More while some still come in: they join the same count.
  if (_linking) { _linking.ids.push(...jobs.map(j => j.id)); _linking.total += jobs.length; return; }
  _linking = { ids: jobs.map(j => j.id), total: jobs.length, kind, landed: new Set() };
  const stop = $('lib-link-stop');
  let ended = [];
  for (;;) {
    const ids = _linking.ids.slice();
    ended = await LK.follow(ids, (list) => {
      const done = list.filter(j => !LK.isLive(j)).length;
      const run = list.find(j => j.state === 'running');
      // Each clip in shows on the shelf at once - the kind it went to, first.
      const fresh = list.filter(j => j.state === 'done' && !_linking.landed.has(j.id));
      if (fresh.length) {
        fresh.forEach(j => _linking.landed.add(j.id));
        if (_shelf === 'media') _showLanded(_linking.kind);
        _linking.reading = (_tree ? _tree.load() : Promise.resolve()).then(() => _load({ checks: true })).then(() => _counts());
      }
      if (stop) { stop.hidden = !run; stop.dataset.id = run ? run.id : ''; }
      if (run) _status('link ' + Math.min(done + 1, _linking.total) + '/' + _linking.total + ' · ' + LK.shortStep(run.step));
    });
    // Links added while these came in are followed too.
    if (_linking.ids.length === ids.length) break;
  }
  if (stop) stop.hidden = true;
  // After the last read of the shelf, never before: _load() signs off with _status('') and would wipe the word.
  if (_linking.reading) await _linking.reading.catch(() => {});
  const ok = ended.filter(j => j.state === 'done');
  const bad = ended.filter(j => j.state === 'error');
  const stopped = ended.filter(j => j.state === 'stopped').length;
  const clips = ok.reduce((n, j) => n + (j.items || []).length, 0);
  _linking = null;
  _status(!bad.length && !stopped ? ('Added ' + clips + (clips === 1 ? ' clip' : ' clips'))
    : (ok.length + ' of ' + ended.length + ' added' + (stopped ? ' · ' + stopped + ' stopped' : '')
      + (bad.length ? ' - ' + bad[0].error : '')), bad.length ? 'err' : '');
}

// (phase V57, the owner's (ок2)) The node selected is the references of Environments / Lookbooks or a folder in them: nothing
// goes there by hand - why, in words (js/media-tree.js closedSays); '' anywhere else.
function _shut() { return _shelf === 'media' && _tree && _node ? _tree.closedSays(_node) : ''; }

async function _upload(files) {
  const list = Array.from(files || []);
  if (!list.length) return;
  if (_shut()) { _status(_shut(), 'err'); return; }
  const btn = $('lib-upload');
  if (btn) btn.disabled = true;
  const kind = _mkind();
  const landed = async (k) => { _showLanded(k); if (_tree) await _tree.load(); await _load({ checks: true }); _counts(); };
  if (kind === 'images') {
    const ri = await A.uploadImages(list, (i, n, name) => _status('Uploading ' + i + '/' + n + ' - ' + name));
    if (btn) btn.disabled = false;
    if (ri.ok) await landed('images');
    _status(ri.ok === ri.total
      ? ('Uploaded ' + ri.ok + (ri.ok === 1 ? ' image' : ' images'))
      : (ri.ok + ' of ' + ri.total + ' uploaded'), ri.ok === ri.total ? '' : 'err');
    return;
  }
  if (kind === 'music') {
    // (phase V54) Into the own folder of Music selected, if one is.
    const rm = await A.uploadMusic(list, (i, n, name) => _status('Uploading ' + i + '/' + n + ' - ' + name), _mcat());
    if (btn) btn.disabled = false;
    if (rm.ok) await landed('music');
    _status(rm.ok === rm.total
      ? ('Uploaded ' + rm.ok + (rm.ok === 1 ? ' track' : ' tracks'))
      : (rm.ok + ' of ' + rm.total + ' uploaded - only sound files are taken'), rm.ok === rm.total ? '' : 'err');
    return;
  }
  if (_node && (SS.isBuiltin(_node) || _node.key === 'sfx-fav')) {
    if (btn) btn.disabled = false;
    _status('Built-in and Favorites take no files - pick My sounds or a folder of it', 'err');
    return;
  }
  if (kind === 'sounds' || (_node && _node.key === 'sfx-all')) {
    // Into the category selected, if one is - so it stays where it is looked at.
    const cat = kind === 'sounds' ? _mcat() : '';
    const rs = await A.uploadSounds(list, (i, n, name) => _status('Uploading ' + i + '/' + n + ' - ' + name), cat);
    if (btn) btn.disabled = false;
    if (rs.ok) { if (_tree) await _tree.load(); await _load({ checks: true }); _counts(); }
    _status(rs.ok === rs.total
      ? ('Uploaded ' + rs.ok + (rs.ok === 1 ? ' sound' : ' sounds'))
      : (rs.ok + ' of ' + rs.total + ' uploaded - only sound files are taken'), rs.ok === rs.total ? '' : 'err');
    return;
  }
  if (_node && _node.key === 'audio') { if (btn) btn.disabled = false; _status('Pick Music or SFX in the tree first', 'err'); return; }
  if (kind === 'heads') { if (btn) btn.disabled = false; _status('Talking heads come from the talking-head projects', 'err'); return; }
  if (kind === 'lyrics') { _status('Music → Lyrics holds only texts - saved from Generate music', 'err'); return; }
  // The kind selected decides where the clips are filed: looking at Hooks and pressing Upload means "add hooks"; under
  // Video they go to Uploads, which is what a file brought in from outside is. They arrive with no category - filed
  // afterwards, on the tree or in the viewer - and the kind is shown so they are seen.
  const target = _linkKind() || 'uploads';
  const r = await A.uploadVideos(list, target, (i, n, name) => _status('Uploading ' + i + '/' + n + ' — ' + name));
  if (btn) btn.disabled = false;
  if (r.ok) await landed(target);
  // After the reload, never before: _load() signs off with _status('') and would wipe this.
  _status(r.ok === r.total
    ? ('Uploaded ' + r.ok + (r.ok === 1 ? ' clip' : ' clips'))
    : (r.ok + ' of ' + r.total + ' uploaded'), r.ok === r.total ? '' : 'err');
}

// ── An address to land on (phase H5) ─────────────────────────────────────────
// What an Alerts row leads to: ?shelf=characters&make=1 is the making area (a portrait or a sheet being
// made there), ?shelf=characters&sel=<id> a character on the shelf, selected and in view, ?shelf=scenarios&make=1&src=<id>
// the generator on a source (phase V28.1: a source being added is a row of its own), ?shelf=scenarios&make=1&draft=<id> the
// generator on a draft (phase V38.1: the way back from Admin -> AI settings), ?shelf=media&kind=environments&make=1 (phase V56)
// the generator of Environments - its window over Media since phase V58, where the old chat's Alerts rows lead too -, ?shelf=media&kind=environments&sel=<file> a picture outlined there - and the old
// ?shelf=environments|lookbooks[&make=1|&sel=] of the shelves that went land in the same places. Read when the
// page loads, and - when the Library is already open - taken from the Alerts list without loading the
// page again (`ugc:goto`, js/alerts-bell.js), which would throw away a wait in progress.
function _place(u) {
  const q = u.searchParams;
  let kind = q.get('shelf') || '';
  // (phase V28.5) The Music shelf is Media -> Audio -> Music: an old address lands there.
  if (kind === 'music') return { kind: 'media', sel: q.get('sel') || '', make: false, src: '', draft: '', mkind: 'music' };
  // (phase V59) Several tiles outlined: ?sel=<id>&sel=<id> - the first is `sel`, the others `also`.
  const also = q.getAll('sel').slice(1).filter(Boolean);
  const make = q.get('make') === '1';
  // (phase V56) The shelves of Environments and Lookbooks went: their folder on Media - `made` its generator opened there.
  if (MADE_KINDS.has(kind)) return { kind: 'media', sel: q.get('sel') || '', also, make: false, src: '', draft: '', mkind: kind, made: make ? kind : '' };
  if (!SHELVES[kind]) return null;
  // `kind` (phase V28.1): Media's kind to open on - a vertical video sent onto Uploads is shown there, outlined (`sel`).
  const mkind = kind === 'media' ? (q.get('kind') || '') : '';
  // (phase V59) ?shelf=media&kind=music&make=1 - the music window, over Music.
  return { kind, sel: q.get('sel') || '', also, make, src: q.get('src') || '', draft: q.get('draft') || '', mkind,
    made: make && (MADE_KINDS.has(mkind) || mkind === 'music') ? mkind : '' };
}

// What the making area opens on: a source, a draft (V38.1), or a clean form.
const _makeOpts = (p) => (p.src ? { sourceId: p.src } : p.draft ? { draftId: p.draft } : undefined);

async function _goToPlace(p) {
  if (!p) return;
  // Media's kind first (the tree's node): switching to the shelf reads it with it. (phase V60) Media with no folder named:
  // its roots.
  if (p.mkind && _tree) { _tree.select(p.mkind, false); _node = _tree.selected(); }
  else if (p.kind === 'media' && !p.made && _tree) _toRoots();
  if (p.kind !== _shelf) {
    _select(p.kind);
    if (_shelf !== p.kind) return;
  }
  _closeNarrators();                              // what the address names is under them
  // (V38.6) A draft named - "← back" from AI settings, a link - is the draft selected on the shelf, its form on the right.
  if (p.make && p.kind === 'scenarios' && p.draft && !p.src) {
    if (_makingOn) await _closeMaker(() => SC.select('d:' + p.draft));
    else { SC.select('d:' + p.draft); await _load({ keepScroll: true }); }
    return;
  }
  if (p.make && MAKERS[p.kind]) {
    if (_makingOn !== p.kind) await _openMaker(_makeOpts(p));
    // The generator on show, asked for one of its sources: that source, without starting a clean form.
    else if (p.kind === 'scenarios' && p.src) await MK.showSource(p.src);
    // ...or for a draft (V38.1): that draft.
    else if (p.kind === 'scenarios' && p.draft) await MK.open({ draftId: p.draft });
    // Already showing: asked to look again - a row it shows may have been started again from Alerts
    // (review I). Not the generator, whose open() starts a clean form.
    else if (p.kind !== 'scenarios') await MAKERS[p.kind].mod.open({});
    return;
  }
  const outline = () => { if (p.sel) { _sel = p.sel; _selAlso = new Set(p.also || []); _scrollSel = true; } };
  if (_makingOn) await _closeMaker(outline);
  else if (p.sel || p.mkind || p.kind === 'media') {
    outline();
    await _load({ keepScroll: !p.mkind && p.kind !== 'media' });
  }
  // (phase V56, V58) Environments' or Lookbooks' generator: its window, over their folder.
  if (p.made) await _openGen(p.made);
}

window.addEventListener('ugc:goto', (e) => {
  let u;
  try { u = new URL((e.detail && e.detail.href) || '', location.href); } catch (err) { return; }
  if (u.pathname !== location.pathname) return;
  const p = _place(u);
  if (!p) return;
  e.preventDefault();
  _goToPlace(p);
});

function boot() {
  initNav();
  try {
    const saved = localStorage.getItem(LS_SHELF);
    if (saved && SHELVES[saved]) _shelf = saved;
    // (phase V28.5) The Music shelf is Media -> Audio -> Music now; (phase V56) Lookbooks and Environments are IMAGES'
    // folders on Media - a remembered shelf of theirs opens there, once.
    else if (saved === 'music' || MADE_KINDS.has(saved)) {
      _shelf = 'media';
      localStorage.setItem(LS_SHELF, 'media');
      _treeStart = saved;
    }
    // (phase V60) The kind and category rows of before V28.5 are forgotten: Media opens on its roots.
    for (const k of ['library_filter_v1', 'library_cat_v1', 'library_cats_h_v1']) localStorage.removeItem(k);
  } catch (e) {}
  // The address wins over the remembered shelf, and is then taken off it: a reload is not a second
  // arrival from Alerts.
  let arrive = null;
  try { arrive = _place(new URL(location.href)); } catch (e) { arrive = null; }
  if (arrive) {
    _shelf = arrive.kind;
    try { localStorage.setItem(LS_SHELF, arrive.kind); } catch (e) {}
    if (arrive.sel) { _sel = arrive.sel; _selAlso = new Set(arrive.also || []); _scrollSel = true; }
    // (V38.6) A draft named: selected on the shelf, not the generator opened on it.
    if (arrive.kind === 'scenarios' && arrive.make && arrive.draft && !arrive.src) { SC.select('d:' + arrive.draft); arrive.make = false; }
    // (phase V60) A folder named: the tree opens on it; none - Media's roots.
    _treeStart = arrive.mkind || '';
    try { history.replaceState(null, '', location.pathname); } catch (e) { /* the address stays */ }
  }

  // (phase V60) Media pressed opens on its roots (_pressShelf).
  document.querySelectorAll('.lib-shelf').forEach(b => {
    b.addEventListener('click', () => _pressShelf(b.dataset.kind));
  });

  const dup = $('lib-dupes');
  if (dup) dup.addEventListener('click', _cleanDupes);
  const brk = $('lib-broken');
  if (brk) brk.addEventListener('click', _cleanBroken);
  const thb = $('lib-thumbs');
  if (thb) thb.addEventListener('click', _fixThumbs);

  MK.init({
    status: _status,
    counts: _counts,
    // "open" beside "Saved": the list again, on that scenario.
    openScenario: (id) => _closeMaker(() => SC.select(id)),
    // The gear by the Narrator field (phase V28.2): the narrators, and "← Generate script" back.
    narrators: _openNarrators,
    // (V38.6) The form on the shelf: "← topics" opens the generator on the draft's source and its topics (the owner's
    // (щ3)); a save selects the new scenario; a discard reads the list again; a stage started or landed repaints the rows.
    openSource: (id) => _openMaker({ sourceId: id }),
    saved: async (id, text) => { SC.select(id); await _load({ keepScroll: true }); _counts(); if (text) _status(text, 'ok'); },
    discarded: () => { SC.select(''); return _load({ keepScroll: true }); },
    draftsChanged: _refreshDraftRows,
  });
  CM.init({
    // Done: the shelf again, on the character just made - selected, in view, its column open.
    onSaved: (id, name) => _closeMaker(
      () => { if (id) { _sel = String(id); _scrollSel = true; } },
      () => _status(name ? 'Saved “' + name + '” - its voices are chosen in the column on the right' : 'Saved')),
  });
  const nb = $('lib-new');
  // Scenarios asks which (phase V28.2); the other shelves open their making area; (phase V55, V58) on Media, Environments
  // or Lookbooks selected, their generator's window.
  // (phase V59) On Music or a folder under it, "Generate music" - its window.
  if (nb) nb.addEventListener('click', () => (_genNode() ? _openGen(_genNode()) : _shelf === 'scenarios' ? _newMenu(nb) : _openMaker()));
  const bb = $('lib-back');
  if (bb) bb.addEventListener('click', () => (_narrOn ? _closeNarrators() : _closeMaker()));
  const nr = $('lib-narr');
  if (nr) nr.addEventListener('click', _openNarrators);

  const btn = $('lib-upload');
  const inp = $('lib-file');
  if (btn && inp) {
    // (phase V57) Refused in words before the file window opens - in the references of Environments / Lookbooks.
    btn.addEventListener('click', () => { if (_shut()) { _status(_shut(), 'err'); return; } inp.click(); });
    // Copy the FileList into an array BEFORE clearing the input: input.files is live,
    // so `inp.value = ''` empties the very list you are holding and the upload sees
    // nothing. Clearing is still needed, or picking the same file twice fires no change.
    inp.addEventListener('change', () => {
      const files = Array.from(inp.files || []);
      inp.value = '';
      _upload(files);
    });
  }
  // (phase V27) By a link: the window, the stop of the one coming in, and a link let go over the shelf.
  const lk = $('lib-link');
  if (lk) lk.addEventListener('click', () => _openLinks(''));
  const stop = $('lib-link-stop');
  if (stop) stop.addEventListener('click', () => { if (stop.dataset.id) LK.stopLink(stop.dataset.id); });
  const main = document.querySelector('.lib-main');
  if (main) {
    main.addEventListener('dragover', (e) => {
      if (!_linkKind() || _makingOn || !LK.dragHasLink(e.dataTransfer)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    });
    main.addEventListener('drop', (e) => {
      if (!_linkKind() || _makingOn || !LK.dragHasLink(e.dataTransfer)) return;
      const urls = LK.linksIn(e.dataTransfer);
      if (!urls.length) return;
      e.preventDefault();
      _openLinks(urls.join('\n'));
    });
  }

  _wireTreeSash();
  _wireScSash();
  _initTree();
  // (phase V59) The music window's presses still being made (a reload) - the gallery read again when they land.
  MW.follow({ onLanded: _musicLanded, onSaved: _lyricsSaved });
  // (phase V59.1) "use in custom" on a saved text - its tile or its viewer (js/sound/lyrics.js, which closes the viewer first).
  window.addEventListener('ugc:lyric-use', (e) => { const l = e && e.detail; if (l && String(l.text || '').trim()) _openMusic(false, l); });
  // (phase V54) Several tiles picked on Media (js/tile-select.js).
  const grid = $('lib-grid');
  if (grid) {
    _tsel = TS.createSelection({
      host: grid, tile: '.lib-card[data-key]',
      active: () => _shelf === 'media' && !_makingOn,
      onDelete: (keys) => _deleteMany(_items.filter(x => keys.includes(_keyOf(x)))),
    });
    // (phase V54 block 6) The right button on the gallery's EMPTY space: "New folder" inside the open folder - when it
    // holds folders (js/media-tree.js holds). On a tile or a folder tile their own menus answer.
    grid.addEventListener('contextmenu', (e) => {
      if (!(_shelf === 'media' && !_makingOn) || !_tree || !_node) return;
      // (phase V57) In the references of Environments / Lookbooks: "New folder" is there, not to be pressed, saying why.
      const shut = _shut();
      if (!shut && !_tree.holds(_node)) return;
      if (e.target.closest && e.target.closest('[data-key], .mt-ftile, button, select, input, textarea, a')) return;
      e.preventDefault();
      if (shut) { TS.menuAt(e.clientX, e.clientY, [['New folder', 'not here - nothing goes into references by hand', null]]); return; }
      const here = _node;
      TS.menuAt(e.clientX, e.clientY, [['New folder', 'in ' + here.label, async () => {
        const mark = document.createElement('div');
        mark.style.cssText = 'position:fixed;left:' + e.clientX + 'px;top:' + e.clientY + 'px;width:1px;height:1px;pointer-events:none';
        document.body.appendChild(mark);
        try { await _tree.newFolder(here, mark); } finally { mark.remove(); }
      }]]);
    });
  }
  // (phase V54) The music player, and Space for it - not in a field, not under a window (js/layers.js).
  const ph = $('lib-player');
  if (ph) {
    _player = createPlayer(ph, {
      status: (t, bad) => _status(t, bad ? 'err' : ''),
      changed: async () => { if (_tree) await _tree.load(); await _load({ keepScroll: true }); _counts(); },
    });
    document.addEventListener('keydown', (e) => {
      if (e.key !== ' ' || e.repeat || e.ctrlKey || e.altKey || e.metaKey || !_player.shown() || !_player.current()) return;
      if (Layers.blocked()) return;
      const t = e.target;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      e.preventDefault();
      _player.toggle();
    });
  }
  Promise.all([_loadCats(), _tree ? _tree.load() : null]).then(() => { _node = _tree ? _tree.selected() : null; return _load({ checks: true }); }).then(() => {
    // Only if the shelf it asked for is still the open one: a shelf pressed while the page was still
    // reading is the person's choice, and its own area is not opened in its place (review I).
    if (arrive && arrive.make && MAKERS[arrive.kind] && _shelf === arrive.kind && !_makingOn) _openMaker(_makeOpts(arrive));
    // (phase V56, V58) An address of Environments' or Lookbooks' generator: its window, over Media - unless another folder was
    // pressed meanwhile.
    else if (arrive && arrive.made && _shelf === 'media' && _node && _node.key === arrive.made) _openGen(arrive.made);
  });
  _counts();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
