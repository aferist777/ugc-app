/* ════════════════════════════════════════════════════════════════════════════
   MERGE — a chat's PICKER of attachments (phase V13, the owner 2026-10-07; docs/local-app/PLAN.md "Фаза V13").

   The video chat has no right column: every "+" of its attachment zone opens this window for ONE place - a part
   of the zone (pictures | clips | sounds) and, with a recipe, its slot - and it shows only that kind:

     left    where it comes from - the Library's shelves of that kind, as the chat's description lists them - and
             "from this computer": files of this kind through the chat's own door, and every file let go over the
             window; each is filed into the root of its kind (phase V56) and goes straight into this place
     centre  a search by name, the categories of a shelf that has them (the project's own first), and the tiles:
             pictures at their own shape with a larger look while the pointer rests on one, clips as posters that
             play in their tile (▶ with the sound), sounds as rows to listen to

   A press puts the thing into the place the window was opened for (the shell keeps that slot armed while it is
   open), a second press takes it back off, and what is in the zone already wears the name of its place. The window
   stays open while the place has room and closes by itself when it has none (the owner's answer 2); Escape, the
   cross, `done` and a press beside it close it too. It is as big as the catalog (the owner's answer 3).

   It knows nothing of the chat: the shell opens it with what to show and what a press does (`openPick`), tells it
   when the zone changed (`pickChanged`) and what the chat has to say (`pickSay`).

   THE WINDOW WITH THE TREE (phase V55, the owner 2026-10-28, (гн1)-(гн4), (гн6): "попапы для прикрепления медиа ... давай
   сделаем аккуратней. типа размером как попап альманаха. в попапе слева дерево, а с права файлы с папками"). The chats
   open it with `tree` - the pictures chat, the video chat and the frames chat; the 3D Studio opens the window above, as
   it was (гн4). It is the almanac's size (860×560), over the middle of the chat (`anchor`):

     left    what is not a folder as rows (`sources`: characters & looks, made in this project, voices), under them the
             media tree of that kind (js/media-tree.js, `tree.roots`: pictures REFERENCES and IMAGES, clips REFERENCES
             and VIDEO, sounds AUDIO) - a node pressed opens its folder
     right   the path, a search by name - in the open folder and every folder under it -, the folder's own folders as
             tiles (a press opens one), then what lies DIRECTLY in it (the tree's `q`, V35; a REFERENCES post gives its
             files of this kind one by one - js/folder-column.js filesOf)
     foot    "from this computer…" (and a clip by a link), what the chat says, "done"; files let go over the window come
             in as before.

   A press attaches or takes off, and the window stays open while the place has room - as before. Opened on a thing in
   the zone, it opens where the thing is: its row, else its folder (folder-column.js locateFile).

   PHASE V56 (the owner's check of V55 2026-10-28, п. 1, 2, 9; (ги1)-(ги4), (ги8)):
     - "characters & looks" pressed: in place of the tree, the CHARACTERS - the ones with the most looks first, the first
       shown at once; the pointer resting on one shows its sheet and its looks on the right, and the last one stays when
       the pointer leaves the list; a look pressed is attached. Pressed again, the row lets go and the tree comes back on
       IMAGES (a row's loader answers `groups` - chat-sources.js people).
     - Only the folders holding this kind - in them or under them -, each with how many (createTree `shape` with
       folder-column.js folderIndex / pruneTree): no empty folders, no folders of clips among the pictures. What a folder
       shows and a search looks through is that same reading.
     - A file brought in (let go over the window, "+ from this computer…", a link) lies in the kind's root - IMAGES,
       VIDEO -> Uploads, My sounds (the chats' upload routes) - and the window opens that root with it in view (`home`).
     - No larger look while the pointer rests on a picture (the old window keeps it - the 3D Studio's).

   PHASE V57 (the owner's check of V56 2026-10-29, п. 6, 8, 10, 12; (ок1)-(ок4)):
     - Clips: only the ones the chosen model takes by their length (`tree.fit`, the video chat's - its limits are lib/
       video-models.js's, given to the page in the matrix); the folders count only those, so REFERENCES -> YouTube ->
       Videos (long videos) is gone by itself. The window is read anew at every opening - another model, another limit.
     - A file let go over the window or taken by "+ from this computer…" goes INTO THE FOLDER OPEN in it (`pickFolder`):
       a folder of the person's own in IMAGES / VIDEO -> Uploads / My sounds; anything else open - a row, REFERENCES, a
       made Environments / Lookbooks, a required folder - is the kind's root (the server says the last word: nothing goes
       into the references of Environments / Lookbooks by hand). The window stays on the folder it went into, the file
       in view and attached (`pickRefresh` `at`).
     - A picture's LINK let go over the window (from a browser) is downloaded by the server into the same folder
       (`computer.link`); a page's link is refused in words.
     - (V57's openChoose for talking head's who / where moved into their own windows in phase V58 - js/merge-v3/wk-setup.js,
       wk-env.js on js/gen-window.js.)

   PHASE V58 (the owner's check of V57 2026-10-29, п. 6; (лк1), (лк2)): a ✕ in the corner of every picture of a folder,
   pressed twice ("really?" - "used in N projects"), deletes it from the library as its shelf does (js/del-x.js); the window
   reads itself again and the chat lets go of it (`removed`).
   ════════════════════════════════════════════════════════════════════════════ */

import * as Layers from '../layers.js';
// (phase V73 block 2) The 3D Studio's page keeps its look (б1-13а): its cross keeps the glyph, everywhere else the part draws it.
const OLD_LOOK = () => !!document.querySelector('link[href="css/studio3d.css"]');
import { hoverPlayer } from './hover-play.js';
import { createTree } from '../media-tree.js';
import { nodeFiles, folderIndex, pruneTree, filesUnder, locateFile } from '../folder-column.js';
import { delX, canDelete, deleteFile, usageWords, filesOf as delFiles, titleOf } from '../del-x.js';
// (phase V73 block 2, step 2b) Being read, nothing here, could not be read - the shared parts, the reason a popup in the
// corner. The 3D Studio's page keeps its own line, `.pk-none`, and no popup (its look is its own, б1-13а).
import { emptyEl, loadingEl, failedEl, cap } from '../ui-state.js';
import { showError } from '../notice.js';

const PAGE = 120;                 // tiles drawn at once - the next ones as the grid is scrolled to its end
const LS_SRC = 'mv3_vpick_v1';    // { <kind>: <source id> } - where each kind was last taken from
const ALL = '';                   // the category "all"
const UNCAT = '__uncat__';        // routes/library.js: what has no category

let _w = null;                    // the open window
let _o = null;                    // what it was opened with
let _st = null;                   // what it shows
let _seq = 0;                     // a source read that is not the newest is dropped
const _cache = new Map();         // source id -> { items, cats, why } for one opening
const _catMemo = new Map();       // '<project>|<source>' -> the category last shown there, for the page's life
const _hp = hoverPlayer('pk-vid');
let _sound = null;                // { path, audio, btn } - the one sound being listened to
// (phase V55) The window with the tree: { tree, node, index, shapeOn, groups, group, all, qT } (_openTree) - null for the
// window without it.
let _t = null;

// (phase V26.6, the owner's check 2026-10-31) The window's look is css/mv3-imagen.css: Merge and the 3D Studio link it,
// the Library does not - New prop's "from IMAGES…" opened it there with no look, under the window. So it puts the sheet in
// itself the first time, as js/gen-window.js does, and stays hidden until the sheet has come.
let _css = null;                  // a promise - the sheet in
let _cssIn = false;
export function ensurePickCss() {
  if (_css) return _css;
  const had = [...document.querySelectorAll('link[rel="stylesheet"]')].some(l => String(l.href).split('?')[0].endsWith('/css/mv3-imagen.css'));
  if (had) { _cssIn = true; return (_css = Promise.resolve()); }
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = '/css/mv3-imagen.css';
  _css = new Promise((res) => { l.onload = l.onerror = () => { _cssIn = true; res(); }; });
  document.head.appendChild(l);
  return _css;
}
function _styled(ov) {
  if (_cssIn) return;
  ov.style.visibility = 'hidden';
  ensurePickCss().then(() => { ov.style.visibility = ''; });
}

const _lc = (s) => String(s || '').trim().toLowerCase();
const _secs = (v) => (+v).toFixed(1).replace(/\.0$/, '') + ' s';
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
const _ar = (a) => { const p = String(a || '').split(':'); const v = (+p[0] || 0) / (+p[1] || 0); return v > 0 && isFinite(v) ? v : 0; };
function _stored() { try { return JSON.parse(localStorage.getItem(LS_SRC) || '') || {}; } catch (e) { return {}; } }
function _keep(v) { try { localStorage.setItem(LS_SRC, JSON.stringify(v)); } catch (e) { /* a private window */ } }

/**
 * Opens the picker on one place. `o`:
 *   kind      'image' | 'video' | 'audio'
 *   title     what is filled ("pictures · person"), `hint` the slot's own words
 *   project   { key, title } - the project's own category is shown first
 *   sources   [{ id, label, load() -> Promise<{ items, cats?, why? }>, empty? }]; an item is
 *             { path, name, sub?, cat?, thumb?, big?, poster?, aspect?, dur?, src? }
 *   start     the source to open on ('' - the one this kind was last taken from, else `first`)
 *   select    (phase V15) { srcs, path } - opened on a thing in the zone: the first of `srcs` that holds it is shown,
 *             in its category, the thing in view
 *   left()    how many more go into the place; mark(path) what it is in the zone ('' - not in it); room() the words
 *             of the place, when it is one that is there ('' - "N more go here")
 *   press(it) attach it, or take it off; why(it) why it cannot go ('' - it can)
 *   computer  { word, hint, open(), accepts(file), drop(files), lands, link(url)? } - `lands` is the source a file goes to;
 *             `link` (V57) a picture's link let go over the window - resolves with what to say ('' - in)
 *   link      (phase V27) { hint, add(url) -> Promise<words ('' - in its place)> } - a clip by a link; absent, no field
 *   make      (phase V26.6) { label, title, on() } - the place's own way to make what goes into it, a button in the foot
 *             (the frames chat's product place: "+ new prop")
 *   onClose()
 *   removed(path)  (V58) a picture of the window deleted by its ✕ - the chat lets go of it
 *   tree      (phase V55) the window with the tree: { roots, page, fallback, type, map(file) -> item, home } - the media
 *             tree's top nodes, the key it remembers its branches under, the node opened the first time, what of a folder
 *             is shown ('photo' | 'video' | 'audio'), how one of its files becomes an item and (V56) the node a file brought
 *             in lies in. Then `sources` are the rows above the tree (`unless`: a path in the tree that makes the row
 *             needless; a loader may answer `groups` [{ key, label, sub, n, items }] - shown in place of the tree, V56),
 *             `start` is a list of 'row:<id>' / 'node:<key>[/<label>…]' tried in order, `select.srcs` the rows that may
 *             hold the thing, and `anchor` the chat the window stands over. (V57) `fit(it)` - only what it takes is shown and
 *             counted (a clip by its seconds, `it.dur`); `note` - what the window says of that beside the slot's words.
 */
export function openPick(o) {
  closePick();
  ensurePickCss();
  if (o.tree) { _openTree(o); return; }
  _o = o;
  _cache.clear();
  const last = _stored()[o.kind];
  const has = (id) => !!id && o.sources.some(s => s.id === id);
  const sel = o.select && o.select.path ? { path: o.select.path, srcs: (o.select.srcs || []).filter(has) } : null;
  const src = sel && sel.srcs.length ? sel.srcs[0] : has(o.start) ? o.start : has(last) ? last : has(o.first) ? o.first : (o.sources[0] || {}).id;
  _st = { src, cat: ALL, q: '', items: [], cats: [], why: '', failed: null, list: [], drawn: 0, loading: false, sel: sel && sel.srcs.length ? sel : null };
  _build();
  _paintHead();
  _paintSources();
  _load();
  setTimeout(() => { if (_w) _w.q.focus(); }, 0);
}

export function closePick() {
  if (!_w) return;
  const o = _o;
  _hp.stop();
  _quiet();
  _peekHide();
  if (_w.io) _w.io.disconnect();
  clearTimeout(_w.shut);
  if (_w.place) window.removeEventListener('resize', _w.place);
  if (_t) clearTimeout(_t.qT);
  Layers.close(_w.layer);
  _w.ov.remove();
  _w = null;
  _o = null;
  _st = null;
  _t = null;
  if (o && typeof o.onClose === 'function') o.onClose();
}

/** The zone changed: the marks and the room follow - and a place with no room left closes the window. */
export function pickChanged() {
  if (!_w) return;
  _paintHead();
  for (const t of _w.grid.querySelectorAll('[data-path]')) _paintMark(t, t.dataset.path);
  if (_o.left() <= 0) {
    clearTimeout(_w.shut);
    // A moment to see the mark land.
    _w.shut = setTimeout(() => { if (_w && _o.left() <= 0) closePick(); }, 180);
  }
}

/** What the chat has to say while the window is open - an upload, a part that goes, why something was not taken. */
export function pickSay(t) {
  if (_w) _w.said.textContent = t || '';
}

/** A file came in through the door of this kind: its shelf is read again. `paths` - (phase V56) what came in; `at` -
 *  (V57) the node of the tree it went into (the kind's root when none). */
export function pickRefresh(sourceId, paths, at) {
  if (!_w) return;
  // (phase V56, (ги4); V57, (ок2)) With the tree: the window opens the folder the file went into - the open one, or the
  // kind's root (`tree.home`) - the file in view.
  if (_t) {
    if (!_t.tree) return;
    const p = [].concat(paths || []).filter(Boolean);
    _refreshTree(false, p.length ? { node: at || _o.tree.home || '', path: p[p.length - 1] } : null);
    return;
  }
  _cache.delete(sourceId);
  if (_st.src === sourceId) _load(true);
}

/**
 * (phase V57, the owner's (ок2): "она в попапе падает в корневую images либо в папку которую создал пользователь и кинул в
 * нее") Where a file brought in through the open window goes: the id of the folder open in it when that is a folder of
 * the person's own of the kind's root (IMAGES, VIDEO -> Uploads, My sounds) - '' for the root: a row, REFERENCES, a made
 * Environments / Lookbooks, a required (locked) folder. The server checks it again (routes/mv3-img.js `_folderFor`).
 */
export function pickFolder() {
  if (!_w || !_t || !_t.tree || _st.src || !_t.node) return '';
  const home = _t.tree.node(_o.tree.home || '');
  const n = _t.node;
  return home && n.kind && n.kind === home.kind && n.cat && !n.locked ? String(n.cat) : '';
}

// ── The window ──────────────────────────────────────────────────────────────
function _build() {
  const ov = el('div', 'pk-ov');
  const box = el('div', 'pk');
  const head = el('div', 'pk-head');
  const h = el('h3', null, '');
  const hint = el('span', 'pk-hint', '');
  const left = el('span', 'pk-room', '');
  const x = el('button', 'pk-close u-btn is-s is-icon is-quiet u-x', OLD_LOOK() ? '✕' : '');
  x.type = 'button';
  x.title = 'Close (Esc)';
  head.append(h, hint, left, x);

  const side = el('div', 'pk-side');
  const main = el('div', 'pk-main');
  const bar = el('div', 'pk-bar');
  const q = document.createElement('input');
  q.type = 'search';
  q.className = 'pk-q u-in is-s';
  q.placeholder = 'search by name';
  q.spellcheck = false;
  const cat = document.createElement('select');
  cat.className = 'pk-cat u-in is-s';
  cat.title = 'A folder of this shelf';
  const count = el('span', 'pk-count', '');
  bar.append(q, cat, count);
  const grid = el('div', 'pk-grid');
  // NO MENU ON A TILE (phase V23, as on the Library's shelves, V13.1): the window's own "Save image as" would save the
  // miniature, not the file. The hover's video and the sound rows are tiles too.
  grid.addEventListener('contextmenu', (e) => { if (e.target.closest && e.target.closest('.pk-tile')) e.preventDefault(); });
  main.append(bar, grid);
  const body = el('div', 'pk-body');
  body.append(side, main);

  const foot = el('div', 'pk-foot');
  const said = el('span', 'pk-said', '');
  const done = el('button', 'mv3-c-btn pk-done u-btn', 'Done');
  done.type = 'button';
  foot.append(said, done);

  const drop = el('div', 'pk-drop', '');
  box.append(head, body, foot, drop);
  ov.appendChild(box);
  document.body.appendChild(ov);
  _styled(ov);

  const layer = Layers.open(ov, { name: 'attachment picker', onEsc: closePick });
  x.addEventListener('click', closePick);
  done.addEventListener('click', closePick);
  ov.addEventListener('mousedown', (e) => { if (e.target === ov) closePick(); });
  q.addEventListener('input', () => { _st.q = q.value; _paintGrid(); });
  cat.addEventListener('change', () => {
    _st.cat = cat.value;
    _catMemo.set(_memoKey(), _st.cat);
    _paintGrid();
  });
  grid.addEventListener('scroll', _peekHide, { passive: true });

  _takeFiles(ov, box);

  _w = { ov, box, h, hint, left, side, q, cat, count, grid, said, drop, layer, io: null, shut: 0, sentinel: null };
  drop.textContent = 'Let go to add ' + (_o.computer.word || 'them') + ' from this computer';
}

// Files let go anywhere over the window come in through the door of this kind - and only there: the Library panel's own
// drop is under the window and must never file them a second time.
// (phase V57, (ок4)) A LINK let go here too - a picture's, dragged from a browser - where the chat takes one
// (`computer.link`): the server downloads it into the folder open (dropLink below).
function _takeFiles(ov, box) {
  const types = (e) => [...((e.dataTransfer && e.dataTransfer.types) || [])];
  const ours = (e) => types(e).some(t => /^application\/x-/i.test(t));
  const files = (e) => types(e).includes('Files') || (!!(_o && _o.computer.link) && !ours(e) && types(e).includes('text/uri-list'));
  let depth = 0;
  ov.addEventListener('dragenter', (e) => { if (!files(e)) return; e.preventDefault(); depth++; box.classList.add('is-drop'); _dropWords(); });
  ov.addEventListener('dragleave', (e) => { if (!files(e)) return; depth = Math.max(0, depth - 1); if (!depth) box.classList.remove('is-drop'); });
  ov.addEventListener('dragover', (e) => {
    if (!files(e)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
  });
  ov.addEventListener('drop', (e) => {
    if (!files(e)) return;
    e.preventDefault();
    e.stopPropagation();
    depth = 0;
    box.classList.remove('is-drop');
    const all = [...((e.dataTransfer && e.dataTransfer.files) || [])];
    if (!all.length && _o.computer.link) {
      const url = dropLink(e.dataTransfer);
      if (!url) { pickSay('Only ' + _o.computer.word + ' here.'); return; }
      pickSay('downloading the picture…');
      Promise.resolve(_o.computer.link(url)).then((why) => { if (_w) pickSay(why || ''); });
      return;
    }
    const mine = all.filter(f => _o.computer.accepts(f));
    if (!mine.length) { pickSay('Only ' + _o.computer.word + ' here.'); return; }
    _o.computer.drop(mine);
  });
}

// What the drop says while something is held over the window: where it will go - the folder open, else the root.
function _dropWords() {
  if (!_w || !_w.drop) return;
  const word = (_o.computer && _o.computer.word) || 'them';
  let where = '';
  if (_t && _t.tree) {
    const cat = pickFolder();
    const n = cat ? _t.node : _t.tree.node(_o.tree.home || '');
    where = n ? ' into ' + (n.label || '') : '';
  }
  _w.drop.textContent = 'Let go to add ' + word + where;
}

/**
 * (phase V57, the owner's (ок4)) The address of what was dragged from a browser: the picture itself when the drag carries
 * one (`<img src>` of its HTML - a picture inside a link gives the picture, not the page), else the link. '' - none, or one
 * of this app's own (a tile dragged inside the window is not a download).
 */
export function dropLink(dt) {
  if (!dt) return '';
  const get = (t) => { try { return String(dt.getData(t) || ''); } catch (e) { return ''; } };
  const ok = (u) => /^(https?:\/\/\S+|data:image\/[a-z0-9.+-]+;base64,)/i.test(u) && !u.startsWith(location.origin + '/');
  const html = get('text/html');
  const m = /<img\b[^>]*?\bsrc\s*=\s*["']([^"']+)["']/i.exec(html);
  if (m) {
    const src = m[1].replace(/&amp;/g, '&');
    if (ok(src)) return src;
  }
  const list = get('text/uri-list').split(/\r?\n/).map(s => s.trim()).filter(s => s && !s.startsWith('#'));
  const plain = get('text/plain').trim();
  return [list[0] || '', plain].find(u => u && ok(u)) || '';
}

function _paintHead() {
  const o = _o;
  // (phase V73 block 4) the window with the tree: its title in sentence case ("Pictures · first frame 1"); the old window as it was
  _w.h.textContent = o.tree ? cap(o.title) : o.title;
  // (phase V57, (ок1)) What the window leaves out, beside the slot's own words ("clips up to 15 s - Seedance 2.0").
  const note = (o.tree && o.tree.note) || '';
  const hint = [o.hint || '', note].filter(Boolean).join(' · ');
  _w.hint.textContent = hint;
  _w.hint.title = hint;
  const n = Math.max(0, o.left());
  const words = typeof o.room === 'function' ? o.room() : '';
  _w.left.textContent = words || (n ? (n === 1 ? 'one more goes here' : n + ' more go here') : 'no room left');
}

function _paintSources() {
  if (_t) { _paintRows(); return; }
  const S = _w.side;
  S.textContent = '';
  S.appendChild(el('div', 'pk-lab', 'From the library'));
  for (const s of _o.sources) {
    const b = el('button', 'pk-src' + (s.id === _st.src ? ' on' : ''), s.label);
    b.type = 'button';
    b.addEventListener('click', () => {
      if (_st.src === s.id) return;
      _st.src = s.id;
      const m = _stored();
      m[_o.kind] = s.id;
      _keep(m);
      _paintSources();
      _load();
    });
    S.appendChild(b);
  }
  const c = _o.computer;
  S.appendChild(el('div', 'pk-lab', 'From this computer'));
  const up = el('button', 'pk-src is-up', '+ Choose ' + (c.word || 'files') + '…');
  up.type = 'button';
  up.addEventListener('click', () => c.open());
  S.appendChild(up);
  S.appendChild(el('div', 'pk-up-note', (c.hint ? c.hint + ' ' : '') + 'Or let files go anywhere over this window.'));
  // (phase V27) A clip by a link, where the description takes one (`link`): the server downloads it and it goes into
  // this place - the place says how far meanwhile.
  const L = _o.link;
  if (!L) return;
  S.appendChild(el('div', 'pk-lab', 'From a link'));
  const row = el('div', 'pk-link');
  const inp = document.createElement('input');
  inp.type = 'text';
  inp.className = 'u-in is-s';
  inp.placeholder = 'YouTube, TikTok, Instagram…';
  const b = el('button', 'pk-link-go u-btn is-s', 'Add');
  b.type = 'button';
  row.appendChild(inp);
  row.appendChild(b);
  S.appendChild(row);
  const said = el('div', 'pk-up-note', L.hint || '');
  S.appendChild(said);
  const go = async () => {
    const url = inp.value.trim();
    if (!/^https?:\/\/\S+$/i.test(url)) { said.textContent = 'That is not a link.'; return; }
    inp.value = '';
    b.disabled = true;
    said.textContent = 'Coming in - its place says how far.';
    const why = await L.add(url);
    if (!_w || !said.isConnected) return;
    b.disabled = false;
    said.textContent = why || 'In, and in its place.';
  };
  b.addEventListener('click', go);
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
}

const _memoKey = () => (_o.project.key || '') + '|' + _st.src;

// (phase V73 block 2, (б2-19)) A read that FAILED is not an empty shelf or folder: the grid says "<what> did not load" with
// Try again (`retry`), the reason is a popup. Not cached, so Try again reads it again. The 3D Studio's page: its old line.
function _failedAs(got, what, retry) {
  if (!got || !got.failed) return null;
  if (OLD_LOOK()) return null;
  showError(what + ' did not load: ' + (got.reason || got.why || 'it could not be read'));
  return { what, retry };
}
const _none = (text, icon) => (OLD_LOOK() ? el('div', 'pk-none', text) : emptyEl(text, { icon }));
const _kindIcon = () => (_o.kind === 'audio' ? 'music' : _o.kind === 'video' ? 'film' : 'image');

// ── A source ────────────────────────────────────────────────────────────────
async function _load(keepCat) {
  const mine = ++_seq;
  const s = _o.sources.find(x => x.id === _st.src);
  if (!s) return;
  _hp.stop();
  _quiet();
  _peekHide();
  let got = _cache.get(s.id);
  if (!got) {
    _st.loading = true;
    _paintGrid();
    try { got = await s.load(); } catch (e) { got = { items: [], cats: [], why: 'it could not be read', failed: true, reason: e && e.message }; }
    if (!_w || mine !== _seq) return;
    _st.loading = false;
    got = got || { items: [], cats: [], why: 'it could not be read', failed: true };
    if (!got.failed || OLD_LOOK()) _cache.set(s.id, got);
  }
  _st.items = got.items || [];
  _st.cats = (got.cats || []).filter(c => c && c.id && (+c.count > 0 || c.id === _st.cat));
  _st.why = got.why || '';
  _st.failed = _failedAs(got, s.label || 'The shelf', () => _load(keepCat));
  // (phase V15) Opened on a thing in the zone: on its shelf - the next that may hold it when this one does not -, in its
  // category, the thing in view.
  let it = null;
  if (_st.sel) {
    it = _st.items.find(x => x.path === _st.sel.path) || null;
    if (!it) {
      const next = _st.sel.srcs[_st.sel.srcs.indexOf(_st.src) + 1];
      if (next) { _st.src = next; _paintSources(); _load(); return; }
      _st.sel = null;
    }
  }
  if (it) _st.cat = it.cat && _st.cats.some(c => c.id === it.cat) ? it.cat : ALL;
  else if (!keepCat) {
    // The category last shown here in this project, else the project's own, else all of them.
    const was = _catMemo.get(_memoKey());
    const own = _st.cats.find(c => c.id !== UNCAT && _lc(c.name) === _lc(_o.project.title));
    _st.cat = (was != null && (was === ALL || _st.cats.some(c => c.id === was))) ? was : own ? own.id : ALL;
  } else if (_st.cat !== ALL && !_st.cats.some(c => c.id === _st.cat)) _st.cat = ALL;
  _paintCats();
  _paintGrid();
  if (it) { _st.sel = null; _reveal(it.path); }
}

// The thing the window was opened on: drawn, in view, blinking once.
function _reveal(path) {
  if (!_w) return;
  const i = _st.list.findIndex(x => x.path === path);
  if (i < 0) return;
  while (_st.drawn <= i) _more();
  const t = [..._w.grid.querySelectorAll('[data-path]')].find(x => x.dataset.path === path);
  if (!t) return;
  t.classList.add('is-sel');
  requestAnimationFrame(() => { if (t.isConnected) t.scrollIntoView({ block: 'center', inline: 'nearest' }); });
  setTimeout(() => t.classList.remove('is-sel'), 1600);
}

function _paintCats() {
  const sel = _w.cat;
  sel.textContent = '';
  sel.hidden = !_st.cats.length;
  if (!_st.cats.length) return;
  const opt = (v, t) => { const e = document.createElement('option'); e.value = v; e.textContent = t; return e; };
  sel.appendChild(opt(ALL, 'all · ' + _st.items.length));
  for (const c of _st.cats) sel.appendChild(opt(c.id, c.label || c.name || c.id));
  sel.value = _st.cat;
}

function _shown() {
  const q = _lc(_st.q);
  return _st.items.filter(it => {
    if (_st.cat !== ALL && (_st.cat === UNCAT ? !!it.cat : it.cat !== _st.cat)) return false;
    return !q || _lc(it.name).includes(q) || _lc(it.sub).includes(q);
  });
}

// ── The tiles ───────────────────────────────────────────────────────────────
function _paintGrid() {
  if (!_w) return;
  const G = _w.grid;
  _hp.stop();
  _quiet();
  _peekHide();
  if (_w.io) { _w.io.disconnect(); _w.io = null; }
  G.textContent = '';
  G.scrollTop = 0;
  G.classList.toggle('is-rows', _o.kind === 'audio');
  if (_st.loading) { G.appendChild(OLD_LOOK() ? el('div', 'pk-none', 'reading…') : loadingEl('reading…')); _w.count.textContent = ''; return; }
  // (phase V55) With the tree: the open folder's own folders first, as tiles - not while a search looks deeper.
  const node = _t && !_st.src ? _t.node : null;
  const look = _st.q.trim();
  const fold = node && !look ? _t.tree.foldersEl(node) : null;
  if (fold) G.appendChild(fold);
  _st.list = _shown();
  _st.drawn = 0;
  _w.count.textContent = _st.list.length === _st.items.length ? String(_st.items.length) : _st.list.length + ' of ' + _st.items.length;
  // The folder's own folders stay over it (the tree drew them, not this read).
  if (_st.failed) { G.appendChild(failedEl(_st.failed.what, _st.failed.retry)); _w.count.textContent = ''; return; }
  if (!_st.list.length && node) {
    const words = look ? 'Nothing here or in the folders under it is called “' + look + '”.' : _st.why || (fold ? '' : 'Nothing in this folder.');
    if (words) G.appendChild(_none(words, look ? 'search' : 'folder'));
    return;
  }
  if (!_st.list.length) {
    const src = _o.sources.find(x => x.id === _st.src) || {};
    G.appendChild(_none(_st.items.length ? (_st.q ? 'Nothing here is called “' + _st.q.trim() + '”.' : 'Nothing in this folder.')
      : (_st.why || src.empty || 'Nothing on this shelf.'), _st.items.length ? (_st.q ? 'search' : 'folder') : _kindIcon()));
    return;
  }
  _more();
}

// The next portion, and a watch on the grid's end for the one after it.
function _more() {
  const G = _w.grid;
  if (_w.sentinel) _w.sentinel.remove();
  const end = Math.min(_st.list.length, _st.drawn + PAGE);
  for (let i = _st.drawn; i < end; i++) G.appendChild(_o.kind === 'audio' ? _soundRow(_st.list[i]) : _tile(_st.list[i]));
  _st.drawn = end;
  if (end >= _st.list.length) return;
  const s = el('div', 'pk-sentinel');
  G.appendChild(s);
  _w.sentinel = s;
  if (!_w.io) {
    _w.io = new IntersectionObserver((es) => { if (_w && es.some(e => e.isIntersecting)) _more(); }, { root: G, rootMargin: '400px' });
  }
  _w.io.observe(s);
}

function _paintMark(t, path) {
  const m = _o.mark(path);
  t.classList.toggle('is-on', !!m);
  let b = t.querySelector('.pk-mark');
  if (m) {
    if (!b) { b = el('span', 'pk-mark'); (t.querySelector('.pk-box') || t).appendChild(b); }
    b.textContent = m;
  } else if (b) b.remove();
}

// The line under a name - a look's character, a shelf's category; not the category the dropdown has chosen already.
const _subOf = (it) => (it.sub && !(_st.cat !== ALL && it.cat === _st.cat) ? it.sub : '');

// A press: in, or back out. One that cannot go says why and stays as it is.
function _press(it) {
  _peekHide();
  const on = !!_o.mark(it.path);
  // The place filled a moment ago and the window is about to close: a second press goes nowhere else.
  const why = on ? '' : _o.left() <= 0 ? 'No room left here.' : _o.why(it);
  if (why) { pickSay(why); return; }
  pickSay('');
  _o.press(it);
}

// A picture or a clip: its box at its own shape (a fixed height, the width its shape's), the name under it.
function _tile(it) {
  const t = el('div', 'pk-tile');
  t.dataset.path = it.path;
  const hit = el('button', 'pk-hit');
  hit.type = 'button';
  hit.title = it.name + (it.sub ? ' · ' + it.sub : '');
  const box = el('span', 'pk-box');
  const known = _ar(it.aspect);
  // On the tile, so the name under the box is cut to the box's width rather than widening it.
  t.style.setProperty('--ar', String(known || (_o.kind === 'video' ? 9 / 16 : 0.75)));
  const src = it.thumb || '';
  if (src) {
    const img = document.createElement('img');
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    // A shape nobody wrote down is the picture's own, once it has loaded.
    if (!known) img.addEventListener('load', () => { if (img.naturalWidth && img.naturalHeight) t.style.setProperty('--ar', String(img.naturalWidth / img.naturalHeight)); }, { once: true });
    img.addEventListener('error', () => { img.remove(); box.classList.add('is-blank'); }, { once: true });
    img.src = src;
    box.appendChild(img);
  } else box.classList.add('is-blank');
  if (it.dur) box.appendChild(el('span', 'pk-dur', _secs(it.dur)));
  hit.appendChild(box);
  t.appendChild(hit);
  t.appendChild(el('span', 'pk-cap', it.name || ''));
  if (_subOf(it)) t.appendChild(el('span', 'pk-sub', _subOf(it)));
  const why = _o.why(it);
  if (why) { t.classList.add('is-off'); t.appendChild(el('span', 'pk-why', why)); hit.title += ' - ' + why; }
  hit.addEventListener('click', () => _press(it));
  if (_o.kind === 'video' && it.src) {
    // The clip plays in its tile while the pointer rests there; ▶ plays it at once with its sound.
    t.addEventListener('pointerenter', () => _hp.on(t, box, it.src));
    t.addEventListener('pointerleave', () => _hp.off(t));
    const play = el('button', 'pk-play', '▶');
    play.type = 'button';
    play.title = 'Play it with its sound';
    play.addEventListener('click', () => {
      if (_hp.loud(t)) { _hp.stop(); play.textContent = '▶'; return; }
      for (const p of _w.grid.querySelectorAll('.pk-play')) p.textContent = '▶';
      _quiet();
      _hp.on(t, box, it.src, { loud: true });
      play.textContent = '■';
    });
    t.appendChild(play);
  } else if (it.big && !_t) {
    // The larger look is the old window's (the 3D Studio's): the window with the tree has none (phase V56, (ги8)).
    hit.addEventListener('pointerenter', () => _peekShow(it.big, t));
    hit.addEventListener('pointerleave', _peekHide);
  }
  // (phase V58, (лк1), (лк2)) A picture of a folder: its ✕ - pressed twice, it goes from the library.
  if (_t && _t.tree && _o.kind === 'image' && it._f && canDelete(it._f)) {
    const f = it._f;
    t.appendChild(delX({
      host: t, title: titleOf(f),
      ask: () => usageWords(delFiles(f)),
      run: () => deleteFile(f),
      done: () => {
        if (typeof _o.removed === 'function') { try { _o.removed(f.path); } catch (e) { /* the chat's */ } }
        _refreshTree(false);
      },
    }));
  }
  _paintMark(t, it.path);
  return t;
}

// A sound: a row with its name, its shelf's category, its length, ▶ to listen.
function _soundRow(it) {
  const t = el('div', 'pk-tile is-sound');
  t.dataset.path = it.path;
  const hit = el('button', 'pk-hit');
  hit.type = 'button';
  hit.title = it.name || '';
  const box = el('span', 'pk-box');
  box.appendChild(el('span', 'pk-note', '♪'));
  const words = el('span', 'pk-snd');
  words.appendChild(el('span', 'pk-cap', it.name || 'sound'));
  if (_subOf(it)) words.appendChild(el('span', 'pk-sub', _subOf(it)));
  box.appendChild(words);
  if (it.dur) box.appendChild(el('span', 'pk-dur', _secs(it.dur)));
  hit.appendChild(box);
  t.appendChild(hit);
  const why = _o.why(it);
  if (why) { t.classList.add('is-off'); t.appendChild(el('span', 'pk-why', why)); hit.title += ' - ' + why; }
  hit.addEventListener('click', () => _press(it));
  const play = el('button', 'pk-play', '▶');
  play.type = 'button';
  play.title = 'Listen';
  play.addEventListener('click', () => {
    if (_sound && _sound.path === it.path) { _quiet(); return; }
    _quiet();
    _hp.stop();
    const audio = new Audio(it.src || it.path);
    _sound = { path: it.path, audio, btn: play };
    play.textContent = '■';
    const back = () => { if (_sound && _sound.audio === audio) { _sound = null; play.textContent = '▶'; } };
    audio.addEventListener('ended', back, { once: true });
    audio.addEventListener('error', back, { once: true });
    audio.play().catch(back);
  });
  t.appendChild(play);
  _paintMark(t, it.path);
  return t;
}

// The sound being listened to stops.
function _quiet() {
  const s = _sound;
  if (!s) return;
  _sound = null;
  try { s.audio.pause(); } catch (e) { /* gone */ }
  if (s.btn) s.btn.textContent = '▶';
}

// ── THE WINDOW WITH THE TREE (phase V55) ────────────────────────────────────
const W_TREE = 860, H_TREE = 560;          // the almanac's size (vhelp.js)

function _openTree(o) {
  _o = o;
  _cache.clear();
  // index - the files of this kind in every folder (folder-column.js folderIndex), shapeOn - the tree deals them itself
  // (createTree `shape`); groups / group / all - a row read in groups (characters & looks) and the group shown.
  _t = { tree: null, node: null, index: null, shapeOn: false, groups: null, group: '', all: [], qT: 0 };
  _st = { src: '', cat: ALL, q: '', items: [], cats: [], why: '', failed: null, list: [], drawn: 0, loading: true, sel: null };
  _buildTree();
  _paintHead();
  _paintGrid();
  _startTree();
  setTimeout(() => { if (_w) _w.q.focus(); }, 0);
}

function _buildTree() {
  const T = _o.tree;
  const ov = el('div', 'pk-ov is-tree');
  // (phase V73 block 4) the one window frame (css/app-shell.css .u-win): its head - the title, then the slot's words and
  // "one more goes here" as quiet notes, the 28 px ✕ -, its foot with "done" the gold one at the right
  const box = el('div', 'pk is-tree u-win is-float');
  box.setAttribute('role', 'dialog');
  const head = el('div', 'pk-head u-win-head');
  const h = el('h3', 'u-win-title', '');
  const hint = el('span', 'pk-hint u-win-sub', '');
  const left = el('span', 'pk-room u-win-sub', '');
  const x = el('button', 'pk-close u-btn is-icon is-quiet u-x', OLD_LOOK() ? '✕' : '');
  x.type = 'button';
  x.title = 'Close (Esc)';
  head.append(h, hint, left, x);

  // Left: the rows that are not folders, then the tree - or, while a row read in groups is open, its groups (V56).
  const side = el('div', 'pk-side');
  const rows = el('div', 'pk-rows');
  const people = el('div', 'pk-people');
  const treeHost = el('div', 'pk-tree');
  side.append(rows, people, treeHost);
  // Right: the path, the search, the folders and the files.
  const main = el('div', 'pk-main');
  const bar = el('div', 'pk-bar');
  const path = el('div', 'pk-path');
  const q = document.createElement('input');
  q.type = 'search';
  q.className = 'pk-q u-in is-s';
  q.placeholder = 'search here and deeper';
  q.title = 'By name - in the open folder and every folder under it';
  q.spellcheck = false;
  // Kept for the code the rows share with the window above: rows have no categories, so it stays hidden.
  const cat = document.createElement('select');
  cat.className = 'pk-cat u-in is-s';
  cat.hidden = true;
  const count = el('span', 'pk-count', '');
  bar.append(path, q, count);
  const grid = el('div', 'pk-grid');
  grid.addEventListener('contextmenu', (e) => { if (e.target.closest && e.target.closest('.pk-tile')) e.preventDefault(); });
  main.append(bar, grid);
  const body = el('div', 'pk-body');
  body.append(side, main);

  // The foot: this computer (and a clip by a link), what the chat says, done.
  const foot = el('div', 'pk-foot u-win-foot');
  const c = _o.computer;
  const up = el('button', 'pk-up u-btn is-s', '+ From this computer…');
  up.type = 'button';
  up.title = (c.hint ? c.hint + ' ' : '') + 'Or let files go anywhere over this window.';
  up.addEventListener('click', () => c.open());
  foot.appendChild(up);
  // (phase V26.6, the owner's (пр3)) The place's own way to make what goes into it: the product place's "+ new prop".
  const M = _o.make;
  if (M && typeof M.on === 'function') {
    const mk = el('button', 'pk-up is-make u-btn is-s is-gen', M.label || '+ new');
    mk.type = 'button';
    if (M.title) mk.title = M.title;
    mk.addEventListener('click', () => M.on());
    foot.appendChild(mk);
  }
  const L = _o.link;
  if (L) {
    const row = el('div', 'pk-link');
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.className = 'u-in is-s';
    inp.placeholder = 'a link - YouTube, TikTok, Instagram…';
    inp.title = L.hint || '';
    const b = el('button', 'pk-link-go u-btn is-s', 'Add');
    b.type = 'button';
    row.append(inp, b);
    foot.appendChild(row);
    const go = async () => {
      const url = inp.value.trim();
      if (!/^https?:\/\/\S+$/i.test(url)) { pickSay('That is not a link.'); return; }
      inp.value = '';
      b.disabled = true;
      pickSay('Coming in - its place says how far.');
      const why = await L.add(url);
      if (!_w || !b.isConnected) return;
      b.disabled = false;
      pickSay(why || 'In, and in its place.');
    };
    b.addEventListener('click', go);
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
  }
  const said = el('span', 'pk-said u-status is-line', '');
  const done = el('button', 'mv3-c-btn pk-done u-btn is-main', 'Done');
  done.type = 'button';
  foot.append(said, done);

  const drop = el('div', 'pk-drop', 'Let go to add ' + (c.word || 'them') + ' from this computer');
  box.append(head, body, foot, drop);
  ov.appendChild(box);
  document.body.appendChild(ov);
  _styled(ov);

  const layer = Layers.open(ov, { name: 'attachment picker', onEsc: closePick });
  x.addEventListener('click', closePick);
  done.addEventListener('click', closePick);
  ov.addEventListener('mousedown', (e) => { if (e.target === ov) closePick(); });
  q.addEventListener('input', () => {
    _st.q = q.value;
    if (_st.src) _rowShow(); else _searchTree();
  });
  _takeFiles(ov, box);
  const place = () => _placeTree(box);
  window.addEventListener('resize', place);
  _w = { ov, box, h, hint, left, side, rows, people, treeHost, path, q, cat, count, grid, said, drop, layer, io: null, shut: 0, sentinel: null, place };
  place();

  const t = _t;
  _t.tree = createTree(treeHost, {
    page: T.page, roots: T.roots, fallback: T.fallback,
    // (phase V56, the owner's п. 2, (ги2)) Only the folders holding this kind - in them or under them -, each counting
    // them; the files read for that are what a folder shows and what a search looks through.
    // (phase V57, (ок1)) ...and of those only what `fit` takes - the clips the chosen model takes by their length.
    shape: async (nodes) => {
      const idx = await folderIndex(nodes, T.type, null, T.fit || null).catch(() => null);
      if (!idx) return nodes;
      t.shapeOn = true;
      t.index = idx;
      return pruneTree(nodes, idx);
    },
    status: (text) => pickSay(text),
    onSelect: (n) => _openNode(n),
    // A folder made, renamed or moved here: the tree reads itself again; what is open is read again too.
    onChanged: () => _refreshTree(true),
  });
}

// Over the middle of the chat, the almanac's size, never past the page.
function _placeTree(box) {
  const W = window.innerWidth, H = window.innerHeight, M = 8;
  const w = Math.min(W_TREE, W - 2 * M), h = Math.min(H_TREE, H - 2 * M);
  const a = _o && _o.anchor && _o.anchor.isConnected ? _o.anchor.getBoundingClientRect() : null;
  const cx = a && a.width ? a.left + a.width / 2 : W / 2;
  const cy = a && a.height ? a.top + a.height / 2 : H / 2;
  box.style.width = w + 'px';
  box.style.height = h + 'px';
  box.style.left = Math.round(Math.max(M, Math.min(W - w - M, cx - w / 2))) + 'px';
  box.style.top = Math.round(Math.max(M, Math.min(H - h - M, cy - h / 2))) + 'px';
}

// A path in the tree - 'images', 'images/Environments' - as a node's key ('' when it is not there).
function _pathKey(p) {
  if (!_t || !_t.tree) return '';
  const [k, ...labels] = String(p || '').split('/');
  let n = _t.tree.node(k);
  for (const lb of labels) {
    if (!n) return '';
    n = (n.children || []).find(c => String(c.name || c.label).toLowerCase() === lb.toLowerCase()) || null;
  }
  return n ? n.key : '';
}

// The rows to show: a row whose place the tree has now is needless (`unless`).
const _rows = () => (_o.sources || []).filter(s => !(s.unless && _pathKey(s.unless)));

function _paintRows() {
  const R = _w.rows;
  R.textContent = '';
  const vis = _rows();
  for (const s of vis) {
    const b = el('button', 'pk-src' + (s.id === _st.src ? ' on' : ''), s.label);
    b.type = 'button';
    // (phase V56, the owner's п. 1) Pressed again, the open row lets go: the tree comes back, on the kind's root.
    b.title = s.id === _st.src ? 'Press again to go back to the folders' : '';
    b.addEventListener('click', () => { if (_st.src === s.id) _leaveRow(); else _openRow(s.id); });
    R.appendChild(b);
  }
  R.hidden = !vis.length;
  // While a row is open, the tree's selected node is not lit.
  _w.treeHost.classList.toggle('is-rowon', !!_st.src);
}

// The left side: the rows, then the tree - or the open row's groups in its place (characters & looks: the characters).
function _paintSide() {
  _paintRows();
  const P = _w.people;
  const on = !!(_st.src && _t.groups);
  _w.side.classList.toggle('is-people', on);
  P.textContent = '';
  if (!on) return;
  for (const g of _t.groups) {
    const b = el('button', 'pk-person' + (g.key === _t.group ? ' on' : ''));
    b.type = 'button';
    b.dataset.key = g.key;
    b.title = g.label + (g.sub ? ' · ' + g.sub : '');
    b.append(el('span', 'pk-person-t', g.label), el('span', 'pk-person-n', String(g.n)));
    // The pointer resting on a row shows its things; the last one stays when the pointer leaves the list (the owner).
    b.addEventListener('pointerenter', () => _pickGroup(g.key));
    b.addEventListener('click', () => _pickGroup(g.key));
    P.appendChild(b);
  }
}

function _pickGroup(key) {
  if (!_t || !_t.groups || _t.group === key) return;
  _t.group = key;
  for (const b of _w.people.children) b.classList.toggle('on', b.dataset.key === key);
  _paintPath();
  _rowShow();
}

function _paintPath() {
  const P = _w.path;
  P.textContent = '';
  if (_st.src) {
    const s = _rows().find(x => x.id === _st.src);
    const g = _t.groups ? _t.groups.find(x => x.key === _t.group) : null;
    const box = el('div', 'mt-crumbs');
    box.appendChild(el('span', 'mt-crumb is-top' + (g ? '' : ' is-here'), s ? s.label : ''));
    if (g) { box.appendChild(el('span', 'mt-crumb-sep', '/')); box.appendChild(el('span', 'mt-crumb is-here', g.label)); }
    P.appendChild(box);
  } else if (_t.node) P.appendChild(_t.tree.crumbsEl(_t.node));
}

// A file of a folder as the window's item - its file kept (`_f`), for its ✕ (phase V58).
const _itemOf = (f) => { const it = _o.tree.map(f); return it ? Object.assign(it, { _f: f }) : null; };

// (phase V57, (ок1)) What the window may show at all: everything, unless the tree says what it takes (`fit`).
const _fits = (x) => !(_o && _o.tree && typeof _o.tree.fit === 'function') || !!_o.tree.fit(x);

async function _rowItems(s) {
  let got = _cache.get(s.id);
  if (!got) {
    try { got = await s.load(); } catch (e) { got = { items: [], cats: [], why: 'it could not be read', failed: true, reason: e && e.message }; }
    got = got || { items: [], cats: [], why: 'it could not be read', failed: true };
    // A row shows only what the window takes too (the clips made in this project, by their length).
    if (got.items) got = Object.assign({}, got, { items: got.items.filter(_fits) });
    if (Array.isArray(got.groups)) got.groups = got.groups.map(g => Object.assign({}, g, { items: (g.items || []).filter(_fits) })).filter(g => g.items.length);
    if (!got.failed || OLD_LOOK()) _cache.set(s.id, got);
  }
  return got;
}

// The files of this kind in every folder: the tree's own reading dealt them when it takes `shape` - else read here.
async function _freshIndex() {
  const t = _t;
  if (!t || t.shapeOn) return;
  const nodes = (_o.tree.roots || []).map(k => t.tree.node(k)).filter(Boolean);
  let why = '';
  t.reading = true;                                   // (2b-2) a search meanwhile waits, it is not told the folders failed
  let idx = null;
  try {
    idx = nodes.length ? await folderIndex(nodes, _o.tree.type, null, _o.tree.fit || null).catch((e) => { why = (e && e.message) || ''; return null; }) : null;
  } finally { t.reading = false; }
  if (_t === t) { t.index = idx; t.indexError = idx ? '' : why; if (idx) t.indexSaid = false; }
}

// Where the window opens: on the thing it was opened on - its row, else its folder -, else the first of `start` that is
// there, else where this kind was last taken from (a row, or the tree's own node).
async function _startTree() {
  const o = _o;
  await _t.tree.load();
  if (!_w || _o !== o) return;
  await _freshIndex();
  if (!_w || _o !== o) return;
  _paintRows();
  const path = o.select && o.select.path;
  if (path) {
    for (const id of o.select.srcs || []) {
      const s = _rows().find(x => x.id === id);
      if (!s) continue;
      const got = await _rowItems(s);
      if (!_w || _o !== o) return;
      if ((got.items || []).some(x => x.path === path)) { _openRow(id, path); return; }
    }
    const key = await locateFile(path, o.tree.roots).catch(() => '');
    if (!_w || _o !== o) return;
    if (key && _t.tree.node(key)) { _t.tree.select(key, false); _openNode(_t.tree.node(key), path); return; }
  }
  for (const s of [].concat(o.start || [])) if (s && _go(s)) return;
  const last = String(_stored()[o.kind] || '');
  if (last.startsWith('row:') && _go(last)) return;
  const n = _t.tree.selected();
  if (n) _openNode(n);
  else if (_rows()[0]) _openRow(_rows()[0].id);
  else { _st.loading = false; _paintGrid(); }
}

function _go(s) {
  if (s.startsWith('row:')) {
    const id = s.slice(4);
    if (!_rows().some(x => x.id === id)) return false;
    _openRow(id);
    return true;
  }
  if (s.startsWith('node:')) {
    const k = _pathKey(s.slice(5));
    if (!k) return false;
    _t.tree.select(k, false);
    _openNode(_t.tree.node(k));
    return true;
  }
  return false;
}

// A row: its things - or, read in groups (characters & looks), its groups on the left in place of the tree, the first
// shown (the one holding `reveal`, the one shown before a reading again); the thing `reveal` in view.
async function _openRow(id, reveal) {
  const s = _rows().find(x => x.id === id);
  if (!s || !_t) return;
  _st.src = id;
  _t.node = null;
  _st.cat = ALL;
  _st.cats = [];
  const m = _stored();
  m[_o.kind] = 'row:' + id;
  _keep(m);
  _paintCats();
  const mine = ++_seq;
  _hp.stop();
  _quiet();
  if (!_cache.has(id)) { _t.groups = null; _paintSide(); _paintPath(); _st.loading = true; _paintGrid(); }
  const got = await _rowItems(s);
  if (!_w || mine !== _seq || _st.src !== id) return;
  _st.loading = false;
  _st.why = got.why || '';
  _st.failed = _failedAs(got, s.label || 'The shelf', () => _openRow(id, reveal));
  _t.all = got.items || [];
  _t.groups = Array.isArray(got.groups) && got.groups.length ? got.groups : null;
  if (_t.groups) {
    const g = (reveal && _t.groups.find(x => x.items.some(i => i.path === reveal)))
      || _t.groups.find(x => x.key === _t.group) || _t.groups[0];
    _t.group = g.key;
  }
  _paintSide();
  _paintPath();
  _rowShow();
  if (reveal) _reveal(reveal);
}

// What the open row shows: the group shown - or, while a search is typed, everything of the row.
function _rowShow() {
  if (!_w || !_st.src) return;
  const g = _t.groups ? _t.groups.find(x => x.key === _t.group) : null;
  _st.items = g && !_st.q.trim() ? g.items : _t.all;
  _paintGrid();
}

// (phase V56, the owner's п. 1: "повторный клик по кнопке characters & looks снимает выделение этой кнопки и показывает
// содержание корневой images") The open row let go of: the tree on the kind's own root - IMAGES, VIDEO, AUDIO.
function _leaveRow() {
  const roots = _o.tree.roots || [];
  const k = [roots[roots.length - 1]].concat(roots).find(x => x && _t.tree.node(x));
  _t.groups = null;
  if (k) { _t.tree.select(k, false); _openNode(_t.tree.node(k)); return; }
  _st.src = '';
  _st.items = [];
  _st.failed = null;
  _paintSide();
  _paintPath();
  _paintGrid();
}

async function _openNode(n, reveal) {
  if (!_w || !_t || !n) return;
  _st.src = '';
  _t.node = n;
  _t.groups = null;
  _st.cat = ALL;
  _st.cats = [];
  const m = _stored();
  m[_o.kind] = 'tree';
  _keep(m);
  _paintSide();
  _paintPath();
  _paintCats();
  if (_st.q.trim()) { _searchTree(true); return; }
  const mine = ++_seq;
  _hp.stop();
  _quiet();
  let got;
  if (_t.index) got = { items: (_t.index.direct.get(n.key) || []).map(_itemOf).filter(Boolean), why: '' };
  else {
    // The folders could not be read in one go: this one by itself.
    _st.loading = true;
    _paintGrid();
    try { got = { items: (await nodeFiles(n, _o.tree.type)).filter(_fits).map(_itemOf).filter(Boolean), why: '' }; }
    catch (e) { got = { items: [], why: e.message || 'the folder could not be read', failed: true }; }
    if (!_w || mine !== _seq) return;
  }
  _st.loading = false;
  _st.items = got.items;
  _st.why = got.why;
  _st.failed = _failedAs(got, n.label || n.name || 'The folder', () => _openNode(n, reveal));
  _paintGrid();
  if (reveal) _reveal(reveal);
}

// A search in the open folder and every folder under it - in what was read for the tree.
function _searchTree(now) {
  clearTimeout(_t.qT);
  const run = () => {
    const n = _t && _t.node;
    if (!_w || !n) return;
    if (!_st.q.trim()) { _openNode(n); return; }
    ++_seq;
    _st.loading = false;
    _st.failed = null;
    // (phase V73 block 2, the owner's (2b-2) а) The folders not read in one go - a search needs them all: "The folders did not
    // load" with Try again (which reads them again), the reason a popup once - not at every letter typed (б2-19).
    // ...but while they are being read (again) it is only "Reading…" - no popup, no failure ((2b-2)): the read runs the search
    // again when it is done.
    if (!_t.index && _t.reading && !OLD_LOOK()) {
      _st.items = [];
      _st.why = '';
      _st.loading = true;
      _paintGrid();
      return;
    }
    if (!_t.index && !OLD_LOOK()) {
      const t = _t;
      if (!t.indexSaid) { t.indexSaid = true; showError('The folders did not load', { detail: t.indexError || 'they could not be read in one go' }); }
      _st.items = [];
      _st.why = '';
      _st.failed = { what: 'The folders', retry: async () => {
        t.indexSaid = false;
        _st.failed = null;
        _st.loading = true;
        _paintGrid();
        await _freshIndex();
        if (_t !== t || !_w) return;
        _st.loading = false;
        _searchTree(true);
      } };
      _paintGrid();
      return;
    }
    _st.items = _t.index ? filesUnder(n, _t.index).map(_itemOf).filter(Boolean) : [];
    _st.why = _t.index ? '' : 'the folders could not be read';
    _paintGrid();
  };
  if (now) run(); else _t.qT = setTimeout(run, 180);
}

// Something came in, or a folder changed: the tree and what it holds are read again - the tree too, unless it did that
// itself. `land` { node, path } (phase V56, (ги4)): a file brought in - the window opens the kind's root it went into, the
// file in view.
async function _refreshTree(treeDone, land) {
  const t = _t;
  if (!t) return;
  _cache.clear();
  // (phase V73 block 2, (2b-2)) The folders are being read AGAIN: a search typed meanwhile waits ("Reading…") - nothing failed,
  // the index is only not back yet. The `_openNode` at the end runs the search again once it is.
  t.reading = true;
  try {
    if (!treeDone) { if (t.shapeOn) t.index = null; await t.tree.load(); }
    if (!t.shapeOn) t.index = null;
    await _freshIndex();
  } finally { t.reading = false; }
  if (_t !== t || !_w) return;
  _paintRows();
  if (land && land.node && t.tree.node(land.node)) {
    t.tree.select(land.node, false);
    _openNode(t.tree.node(land.node), land.path);
    return;
  }
  if (_st.src) { if (_rows().some(x => x.id === _st.src)) _openRow(_st.src); else _leaveRow(); return; }
  const n = (t.node && t.tree.node(t.node.key)) || t.tree.selected();
  if (n) _openNode(n);
}

// ── The larger look at a picture ────────────────────────────────────────────
// Over the half of the window away from the tile, so it never covers what the pointer is on.
let _peek = null;
function _peekShow(src, tile) {
  _peekHide();
  if (!_w) return;
  const g = _w.grid.getBoundingClientRect();
  const r = tile.getBoundingClientRect();
  const box = el('div', 'pk-peek');
  const img = document.createElement('img');
  img.src = src;
  box.appendChild(img);
  // The box is the picture's own size within these - a tall one is not framed in a wide box.
  const w = Math.max(160, Math.min(560, g.width / 2 - 24));
  const h = Math.max(160, g.height - 24);
  img.style.maxWidth = (w - 12) + 'px';
  img.style.maxHeight = (h - 12) + 'px';
  const leftHalf = (r.left + r.width / 2) < (g.left + g.width / 2);
  if (leftHalf) box.style.right = Math.round(window.innerWidth - g.right + 12) + 'px';
  else box.style.left = Math.round(g.left + 12) + 'px';
  box.style.top = Math.round(g.top + 12) + 'px';
  document.body.appendChild(box);
  _peek = box;
}
function _peekHide() {
  if (_peek) { _peek.remove(); _peek = null; }
}
