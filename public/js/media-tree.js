/* ═══════════════════════════════════════════════════════════════════════════
   THE MEDIA TREE (phase V28.4 + V28.5, the owner 2026-10-12) - one module for both places that show the library's
   media: Merge's Library panel (js/merge-v3/library.js) and the Library's Media shelf (js/library/main.js). The
   gallery is on the left, this tree on the right:

     REFERENCES -> Files, Instagram (Posts, Reels), YouTube (Shorts, Videos), TikTok (Posts, Videos), Other  (phase TG)
     VIDEO   -> Generated (B-rolls -> categories, Talking heads -> projects), Hooks, Uploads -> categories
     IMAGES  -> its categories
     AUDIO   -> Music (-> highlights -> ten moods, V35), SFX -> ★ Favorites, Built-in (the program's set, read only),
                My sounds (categories)   (phase V34.E)

   It is read in one answer (GET /api/library/tree, routes/library.js _tree): every node { key, label, count, q?, kind?,
   cat?, locked?, empty?, loose?, children? }.

   FOLDERS (phase V35, the owner 2026-10-23, (т2), (у1)-(у3): "как будто папки в library"). A node is a folder, as in
   Explorer: pressing it SELECTS it, and the page shows its folders first as FOLDER TILES (foldersEl), then what lies
   directly in it - what has no category of its kind (`q` is what the shelf is asked for that; a node with no `q` holds
   only folders: VIDEO, AUDIO, SFX, Built-in, B-rolls, Talking heads, REFERENCES). There is no "Uncategorized" node and no
   "everything under it" any more. A folder tile pressed opens it - the tree opens to it; a tile let go on a folder tile
   or on a word of the PATH over the gallery (crumbsEl - "AUDIO / SFX / My sounds", each word a press away) goes there
   as on its row. A branch opens on a DOUBLE press of its row or a press of its ▸ (the owner, second round) - and (phase
   V39) under a tile dragged and held over its row for 0.6 s -, and what is open is remembered, so is the node selected -
   per page. The three top nodes are an accordion: one open, the others folded - what is open inside them stays as it
   was (a branch opened under a drag folds nothing).

   CATEGORIES, both ways the owner asked for: the chips' gestures - "+" on a kind's row makes one, a double press on
   its name renames it, the ✕ on hover deletes it (the media moved out of it into the kind itself, or deleted with them -
   then the projects using them are named) - and the same in a menu under the right button (on a folder tile too). The
   order is the server's: the locked first, the rest alphabetical, the EMPTY ones pale and last (second round: no order
   by hand any more). A REQUIRED category (lib/library-cats.js REQUIRED) - and Generated, Hooks, Uploads - carries a
   lock. A project of Talking heads is not a category: nothing is made, renamed or deleted there.

   A TILE LET GO ON A NODE: on a category of its kind - filed under it; on the kind itself - its category taken off (on
   B-rolls or on Generated: a B-roll with none, lying in Generated - the owner); on another kind of video (or one of its
   categories) - moved to that kind. A picture never becomes a clip, nor a clip a picture; a talking head is its
   project's and goes nowhere. A TRACK (V35, the owner's (ф3)): on Music - out of highlights; on highlights - into its
   root; on a mood - only the track that mood's preset made (lib/music-store.js `place`, V34.F; refused in words
   otherwise). A tile says what it is with setMediaDrag(); the kind rides in a type of its own, the only part of a drag a
   page can read before the drop. SEVERAL TILES (phase V54, js/tile-select.js): a picked tile dragged carries the others
   (`many`) and they go in ONE request (POST /api/library/batch/move) - each as one would; what cannot go stays and the
   status says why. Whether the node takes the drop is the dragged tile's question.

   FOLDERS IN FOLDERS (phase V54 block 6, the owner 2026-10-27/28, (зв19)-(зв22), (зв27), (зв33)-(зв46)): every kind with
   categories and Music hold folders in one another, with no limit of depth - they open ▸ one inside another. The word is
   "folder" everywhere (зв43). "New folder" - the "+" of a kind's row (at its top), the right button on a kind or a folder
   (inside it; a required one too, (зв27)), and the right button on the gallery's empty space (inside the open one; the page
   asks newFolder) - never in highlights, its moods, the sources' folders of REFERENCES (зв42), Built-in or a project of
   Talking heads (`holds`). A folder is renamed (a double press on its name, or the menu), deleted (✕, or the menu: what
   is in it goes up a level - its folders stay folders - or it goes with everything in it and under it, the projects using
   them named) and DRAGGED by its row or its tile onto another folder of its kind, or onto the kind's row (to its top);
   a branch held over opens as for a tile. The server refuses in words what cannot be (a name the place has, (зв35); a
   required one; into itself; a path too long, (зв34)) and the status line says so. A folder drag carries
   `application/x-ugc-folder` and `application/x-ugc-folder-kind-<kind>`.

   ENVIRONMENTS AND LOOKBOOKS IN IMAGES (phase V55, the owner 2026-10-28, (гн8)-(гн11)): two locked folders first in IMAGES
   (routes/library.js _madeFolders) - the pictures their generators made lie in them, and their `references` (the required
   uploads_environments / uploads_lookbooks, an IMAGES folder like any) inside. Such a node carries `make` (its kind) and
   `makeLabel`: its row has a "+" - and its menu an item - that opens the generator where the page says (`onMake`). A made
   picture moves nowhere, nothing is moved in but into references, and a folder goes into references, not into them - each
   refused IN WORDS when let go there.
   ═══════════════════════════════════════════════════════════════════════════ */

import * as A from './library/actions.js';
import * as Layers from './layers.js';
import { askName } from './name-box.js';

export const MEDIA_DRAG = 'application/x-ugc-media';
const KIND_TYPE = 'application/x-ugc-kind-';
const UNCAT = '__uncat__';
const VIDEO = new Set(['birols', 'hooks', 'uploads']);
const CATABLE = new Set(['birols', 'hooks', 'uploads', 'images', 'sounds', 'references', 'music']);
// (phase V54) A folder being dragged: what it is, and its kind as a type of its own (readable before the drop).
const FOLDER_DRAG = 'application/x-ugc-folder';
const FOLDER_KIND = 'application/x-ugc-folder-kind-';
let _dragging = null;       // { kind, id, key, label } while a folder of this page is dragged
const NOUN = { birols: 'clip', hooks: 'clip', uploads: 'clip', images: 'picture', sounds: 'sound', music: 'track', references: 'post', sfx: 'sound' };
// (phase V55) What the generators of IMAGES -> Environments / Lookbooks made: their own kinds, never moved.
const MADE = { environments: 'Environments', lookbooks: 'Lookbooks' };
const MADE_SAYS = {
  environments: 'A made environment stays in Environments - its description, 3D layout and the videos filmed there point at it',
  lookbooks: 'A made lookbook stays in Lookbooks - its description and the looks dressed in it point at it',
};
// (phase TG, block 5b) What a post of REFERENCES holds, readable while it is dragged: one video, one picture, or 'several'.
const REF_TYPE = 'application/x-ugc-refmedia-';

const _plural = (n, word) => n + ' ' + word + (n === 1 ? '' : 's');

/** A tile being dragged says what it is - for a tree's node to take it. `it` is a shelf item; `many` - (phase V54) the
 *  picked tiles it is one of, when there are several (js/tile-select.js). */
export function setMediaDrag(dt, it, many) {
  if (!dt || !it || !it.kind) return;
  const m = it.meta || {};
  // (phase V35) A track says where it lies in Music: in highlights (`folder`), in a mood of it (`mood`).
  const several = Array.isArray(many) && many.length > 1
    ? many.map(x => ({ kind: x.kind, id: String(x.id) })) : null;
  dt.setData(MEDIA_DRAG, JSON.stringify({ kind: it.kind, id: String(it.id), name: it.name || '', cat: m.categoryId || '',
    folder: m.folder || '', mood: m.mood || '', ...(several ? { many: several } : {}) }));
  dt.setData(KIND_TYPE + it.kind, '1');
  if (it.kind === 'references') {
    const files = (it.meta && it.meta.items) || [];
    dt.setData(REF_TYPE + (files.length === 1 && !(it.meta && it.meta.remote) ? files[0].type : 'several'), '1');
  }
}

function _refType(dt) {
  const t = Array.from((dt && dt.types) || []).find(x => x.startsWith(REF_TYPE));
  return t ? t.slice(REF_TYPE.length) : '';
}

function _dragKind(dt) {
  const t = Array.from((dt && dt.types) || []).find(x => x.startsWith(KIND_TYPE));
  return t ? t.slice(KIND_TYPE.length) : '';
}

// Where a node files what is let go on it: { kind, cat } ('' = no category), or null where nothing goes. Generated and
// B-rolls are a B-roll with no category (lying in Generated); a kind takes it with no category; Talking heads takes
// nothing; Music and its folders take a track (`folder`, `mood` - V35).
function _target(n) {
  if (!n) return null;
  if (n.key === 'generated') return { kind: 'birols', cat: '' };
  // (phase V55) Environments / Lookbooks: only their generator files there - what is let go is refused in words.
  if (MADE[n.kind]) return { kind: n.kind, cat: '', made: true };
  if (n.kind === 'music') return { kind: 'music', cat: n.cat || '', name: n.cat ? (n.name || n.label) : '', folder: n.folder || '', mood: n.mood || '' };
  // (phase TG, block 5b) REFERENCES: its own categories file a post; the root and the sources' folders let it go back to
  // its source's folder.
  if (n.kind === 'references') { const c = n.cat && n.cat !== UNCAT ? n.cat : ''; return { kind: 'references', cat: c, name: c ? (n.name || n.label) : '' }; }
  // (block 6) YOUTUBE is the Sources' - nothing is filed into it, nothing of it moves.
  // (phase V34.E) Built-in (kind `sfx`) is the program's: nothing is filed into it.
  if (!n.kind || n.kind === 'heads' || n.kind === 'youtube' || n.kind === 'sfx') return null;
  const cat = n.cat && n.cat !== UNCAT ? n.cat : '';
  return { kind: n.kind, cat, name: cat ? (n.name || n.label) : '' };
}

// What letting an item of kind `from` go on a node does: 'cat' (file it there), 'kind' (another kind of video), 'ref' (a
// post within REFERENCES), 'out' (a post of one video or one picture out of it - the owner: a post of several goes by its
// files, from its viewer), or ''.
function _dropAction(n, from, refType) {
  const t = _target(n);
  if (!t || !from) return '';
  // (phase V34.E, the owner's (р4)) A built-in sound let go on My sounds is refused - in words.
  if (from === 'sfx') return t.kind === 'sounds' ? 'refuse' : '';
  // (phase V55, (гн9)) A made environment or lookbook goes nowhere - refused in words wherever it is let go but its own
  // folder; a picture let go on Environments / Lookbooks is refused in words too (a photo goes into references).
  if (MADE[from]) return t.kind === from ? '' : 'refuse';
  if (t.made) return (from === 'images' || (from === 'references' && refType === 'photo')) ? 'refuse' : '';
  // (phase V35) A track goes between Music, highlights and its moods - and nowhere else; nothing else goes there.
  if (from === 'music' || t.kind === 'music') return from === t.kind ? 'place' : '';
  if (from === 'references') {
    if (t.kind === 'references') return 'ref';
    if (refType === 'video' && VIDEO.has(t.kind)) return 'out';
    if (refType === 'photo' && t.kind === 'images') return 'out';
    return '';
  }
  if (t.kind === 'references') return '';
  if (t.kind === from) return 'cat';
  if (VIDEO.has(t.kind) && VIDEO.has(from)) return 'kind';
  return '';
}

// WHAT IS NEW (phase TG, the owner 2026-10-21: "выделять строку в дереве зеленым цветом, типа которые непросмотренные
// библиотеки куда добавилось что-то новое"). The server says when the newest thing under each node came (`newest`); a node
// is NEW - green - while that is later than when it was last opened. Opening a node sees it and everything under it; a
// branch is green while any node under it is. Kept for the whole app (the Library and Merge alike): seen in one, seen in
// both. The first time ever, everything there is counts as seen.
const LS_SEEN = 'ugc_tree_seen_v1';

function _ls(key, fallback) {
  try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch (e) { return fallback; }
}
function _lsSet(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) { /* a private window */ } }

function _el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

const FOLDER_SVG = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M3 6.5A2.5 2.5 0 0 1 5.5 4h4.2c.6 0 1.2.24 1.65.66L12.8 6H18.5A2.5 2.5 0 0 1 21 8.5v9a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5v-11z"/></svg>';
const LOCK_SVG = '<svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true"><path fill="currentColor" d="M8 1a3.5 3.5 0 0 0-3.5 3.5V7H4a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1h-.5V4.5A3.5 3.5 0 0 0 8 1zm-2 6V4.5a2 2 0 1 1 4 0V7H6z"/></svg>';

/**
 * Build a tree in `host`.
 *   o.page        'mv3' | 'lib' | ... - what it remembers (open branches, the node selected) is kept under this, so two
 *                 trees of different pages never share it (what is NEW stays shared - seen in one, seen in all)
 *   o.roots       (phase V54) only these top nodes, by key - ['video'] shows VIDEO alone; omitted - all of them
 *   o.fallback    the node selected when none is remembered (one of `roots` when they are given)
 *   o.status(text, bad)   say something
 *   o.onSelect(node)      a node was chosen (also once the first read lands)
 *   o.onChanged(what)     the library changed from here (a category made, renamed, deleted; a tile moved) - read the
 *                         gallery again; the tree reads itself again
 *   o.takesFiles(node)    (phase V34.E) whether files from Explorer may be let go on this node's row
 *   o.onFiles(node, files)  they were
 *   o.onMake(node, anchor)  (phase V55) the "+" of a node with `make` (IMAGES -> Environments / Lookbooks) - open its
 *                         generator ('environments' | 'lookbooks' in node.make); without it the node has no "+"
 * -> { el, load(), select(key), selectFor(kind, cat), selected(), node(key), kindLabel(kind) }
 */
export function createTree(host, o) {
  const opt = Object.assign({ page: 'lib', fallback: 'video', status: () => {}, onSelect: () => {}, onChanged: () => {} }, o || {});
  const K_OPEN = opt.page + '_tree_open_v1';
  const K_SEL = opt.page + '_tree_sel_v1';
  let nodes = [];
  const byKey = new Map();
  const parentOf = new Map();
  let open = new Set(_ls(K_OPEN, ['video', 'audio']));
  let sel = String(_ls(K_SEL, '') || opt.fallback);
  let loaded = false;       // the first answer has been painted
  let lastPress = { key: '', at: 0 };

  const el = _el('div', 'mt');
  el.setAttribute('role', 'tree');
  host.appendChild(el);

  // (phase V54) Whether folders can be made in a node: a kind's own node, or a folder of one - not the app's (`noAdd`:
  // highlights, its moods, the sources' folders, Built-in) and not a project of Talking heads.
  const holds = (n) => !!n && !!n.kind && CATABLE.has(n.kind) && !n.noAdd && !n.project && !n.builtin && !n.ref
    && (n.cat ? (n.own || n.locked) && !n.orphan : n.key === n.kind);
  // A folder: a category of a kind (an orphan too); one that is the person's to move.
  const isFolder = (n) => !!n && !!n.cat && !n.uncat && !n.project && !n.builtin && CATABLE.has(n.kind);
  const movable = (n) => isFolder(n) && !!n.own && !n.locked;
  const kidFolders = (n) => (((n && byKey.get(n.key)) || {}).children || []).filter(isFolder);
  const isUnderKey = (key, anc) => { for (let k = key; k; k = parentOf.get(k)) if (k === anc) return true; return false; };
  // A dragged folder may go into this node: one of its kind that holds folders, not itself or under it, not where it is.
  const takesFolder = (n) => !!_dragging && !!n && n.kind === _dragging.kind && holds(n) && !isUnderKey(n.key, _dragging.key)
    && parentOf.get(_dragging.key) !== n.key;
  // (phase V55) An IMAGES folder let go on Environments / Lookbooks - refused in words (its references takes it).
  const refusesFolder = (n) => !!_dragging && !!n && !!MADE[n.kind] && !!n.make && _dragging.kind === 'images';
  const _hasType = (dt, t) => Array.from((dt && dt.types) || []).some(x => x === t || x.startsWith(t));

  function _index(list, parent) {
    for (const n of list) {
      byKey.set(n.key, n);
      if (parent) parentOf.set(n.key, parent.key);
      if (n.children) _index(n.children, n);
    }
  }

  let seen = _ls(LS_SEEN, null);
  let fresh = new Set();          // the keys of the nodes shown green
  function _computeNew() {
    if (!seen || typeof seen !== 'object') {
      seen = {};
      const all = (list) => { for (const n of list) { seen[n.key] = n.newest || 0; if (n.children) all(n.children); } };
      all(nodes);
      _lsSet(LS_SEEN, seen);
    }
    // A node seen for the first time - an own category just made, a post just filed into it - is seen as it is: nothing
    // came into it from outside (the owner 2026-10-22: categories lit "at random" after a move).
    let met = false;
    const meet = (list) => { for (const n of list) { if (!(n.key in seen)) { seen[n.key] = n.newest || 0; met = true; } if (n.children) meet(n.children); } };
    meet(nodes);
    if (met) _lsSet(LS_SEEN, seen);
    // The node being looked at sees what lands in it.
    const cur = byKey.get(sel);
    if (cur) _seeAll(cur, false);
    fresh = new Set();
    const walk = (n) => {
      let g = false;
      if (n.children && n.children.length) { for (const c of n.children) if (walk(c)) g = true; }
      else g = (n.newest || 0) > (seen[n.key] || 0);
      if (g) fresh.add(n.key);
      return g;
    };
    for (const n of nodes) walk(n);
  }
  function _seeAll(n, save = true) {
    const go = (x) => { if ((x.newest || 0) > (seen[x.key] || 0)) seen[x.key] = x.newest || 0; if (x.children) x.children.forEach(go); };
    go(n);
    if (save) _lsSet(LS_SEEN, seen);
  }

  async function load() {
    let d;
    try { d = await fetch('/api/library/tree').then(r => r.json()); }
    catch (e) { opt.status('Could not read the media tree: ' + e.message, true); return nodes; }
    if (!d || !d.success) { opt.status((d && d.error) || 'Could not read the media tree', true); return nodes; }
    nodes = d.nodes || [];
    // (phase V54) A tree of some roots only - Merge's Video to Music shows VIDEO alone.
    if (Array.isArray(opt.roots) && opt.roots.length) nodes = nodes.filter(n => opt.roots.includes(n.key));
    byKey.clear(); parentOf.clear();
    _index(nodes, null);
    // A remembered node that is not there any more (a category deleted, renamed elsewhere): its kind, else the fallback -
    // and the page is told, once it has had its first answer (it reads the gallery for the first one itself).
    const before = sel;
    if (!byKey.has(sel)) {
      // (phase V35) A remembered "Uncategorized" is gone too: what it held lies in its kind - a B-roll's in Generated.
      const kind = sel === 'birols:' + UNCAT ? 'generated' : String(sel).split(':')[0];
      sel = byKey.has(kind) ? kind : (byKey.has(opt.fallback) ? opt.fallback : ((nodes[0] || {}).key || ''));
      _lsSet(K_SEL, sel);
    }
    _openTo(sel);
    _computeNew();
    paint();
    if (loaded && sel !== before && byKey.has(sel)) opt.onSelect(byKey.get(sel));
    loaded = true;
    return nodes;
  }

  // The top nodes are an accordion (the owner): opening one folds the others; what is open inside them stays.
  const _isTop = (key) => nodes.some(n => n.key === key);
  function _openOne(key) {
    open.add(key);
    if (_isTop(key)) for (const n of nodes) if (n.key !== key) open.delete(n.key);
  }

  function _openTo(key) {
    let p = parentOf.get(key);
    let changed = false;
    while (p) { if (!open.has(p)) { _openOne(p); changed = true; } p = parentOf.get(p); }
    if (changed) _lsSet(K_OPEN, [...open]);
    return changed;
  }

  // The selection moved, nothing opened: the rows stay - a double press on a name must find the row it began on.
  function _mark() {
    for (const r of el.querySelectorAll('.mt-row')) {
      r.classList.toggle('is-sel', r.dataset.key === sel);
      r.classList.toggle('is-new', fresh.has(r.dataset.key));
    }
  }

  function paint() {
    const top = el.scrollTop;
    el.textContent = '';
    for (const n of nodes) _rows(n, 0);
    el.scrollTop = top;
  }

  function _rows(n, depth) {
    el.appendChild(_row(n, depth));
    if (n.children && n.children.length && open.has(n.key)) for (const c of n.children) _rows(c, depth + 1);
  }

  function _row(n, depth) {
    const isGroup = depth === 0;
    const isCat = !!n.cat && !n.uncat && !n.project;
    const row = _el('div', 'mt-row' + (isGroup ? ' is-group' : '') + (n.key === sel ? ' is-sel' : '') + (fresh.has(n.key) ? ' is-new' : '')
      + (n.empty ? ' is-empty' : '') + (n.locked ? ' is-locked' : '') + (isCat ? ' is-cat' : '')
      // (phase V56) Environments / Lookbooks - their names gold in the Library's tree (css/library.css), not in Merge's.
      + (n.make ? ' is-made' : ''));
    row.dataset.key = n.key;
    row.setAttribute('role', 'treeitem');
    row.style.paddingLeft = (3 + depth * 11) + 'px';
    const has = !!(n.children && n.children.length);
    if (has) row.setAttribute('aria-expanded', open.has(n.key) ? 'true' : 'false');

    const tw = _el('button', 'mt-tw', has ? '▸' : '');
    tw.type = 'button';
    tw.tabIndex = -1;
    if (has) {
      tw.classList.toggle('is-open', open.has(n.key));
      tw.title = open.has(n.key) ? 'Fold' : 'Open';
      tw.addEventListener('click', (e) => { e.stopPropagation(); toggle(n.key); });
    } else tw.disabled = true;
    row.appendChild(tw);

    const name = _el('span', 'mt-name', n.label);
    name.title = _tipOf(n);
    row.appendChild(name);
    if (n.locked) {
      const lock = _el('span', 'mt-lock');
      lock.innerHTML = LOCK_SVG;
      lock.title = n.tip || (n.builtin ? 'Built into the app - read only' : 'Required - it cannot be renamed, moved or deleted');
      row.appendChild(lock);
    }
    // A kind that can have folders: "+" makes one at its top.
    if (holds(n) && !n.cat) {
      const add = _el('button', 'mt-act mt-add', '+');
      add.type = 'button';
      add.tabIndex = -1;
      add.title = 'New folder in ' + (n.label || n.kind);
      add.addEventListener('click', (e) => { e.stopPropagation(); _newFolder(n, add); });
      row.appendChild(add);
    }
    // (phase V55, (гн10), (гн11)) Environments / Lookbooks: "+" opens their generator - where, the page says (`onMake`).
    if (n.make && typeof opt.onMake === 'function') {
      const mk = _el('button', 'mt-act mt-add mt-make', '+');
      mk.type = 'button';
      mk.tabIndex = -1;
      mk.title = n.makeLabel + ' - opens the generator';
      mk.addEventListener('click', (e) => { e.stopPropagation(); opt.onMake(n, mk); });
      row.appendChild(mk);
    }
    if (isCat && n.own && !n.locked) {
      const x = _el('button', 'mt-act mt-x', '✕');
      x.type = 'button';
      x.tabIndex = -1;
      x.title = 'Delete this folder';
      x.addEventListener('mousedown', (e) => e.stopPropagation());
      x.addEventListener('click', (e) => { e.stopPropagation(); _askDelete(n, row); });
      row.appendChild(x);
    }
    row.appendChild(_el('span', 'mt-n', String(n.count || 0)));

    // A press selects; the second press of a double one does not read the gallery again.
    row.addEventListener('click', () => {
      const again = lastPress.key === n.key && Date.now() - lastPress.at < 450;
      lastPress = { key: n.key, at: Date.now() };
      if (again && n.key === sel) return;
      select(n.key, true);
    });
    // A double press opens or folds a branch (the owner, second round); on a category's name it renames it.
    if (has) row.addEventListener('dblclick', (e) => { e.preventDefault(); toggle(n.key); });
    if (isCat && n.own && !n.locked) name.addEventListener('dblclick', (e) => { e.stopPropagation(); _rename(n, row); });
    row.addEventListener('contextmenu', (e) => { e.preventDefault(); _menu(n, row, e.clientX, e.clientY); });
    _takesDrops(row, n);
    if (has) row.addEventListener('dragover', (e) => _spring(n, e));
    if (movable(n)) _draggable(row, n);
    return row;
  }

  // ── A folded branch opens under a drag (phase V39, the owner 2026-10-24: "если пользователь перетаскивает плитку на
  // дерево, а категории закрыты, то открывать категорию, на которую навел пользователь"; (о2) 0.6 s) ──
  // A tile - or files from Explorer - held over a folded branch's row for 0.6 s opens it: a root or a category, whether it
  // takes the drop itself or not (VIDEO, AUDIO do not), so the drop can go straight into a folder under it. Only rows below
  // it come out, so the row under the pointer stays where it is: no accordion fold of the other roots mid-drag. What
  // opened stays open. Keyed by the node, not its row - a paint replaces every row; any dragover off that row, a drop or
  // the drag's end forgets it.
  const SPRING_MS = 600;
  let spring = null;            // { key, timer, watch }
  function _unspring() {
    if (!spring) return;
    clearTimeout(spring.timer);
    document.removeEventListener('dragover', spring.watch, true);
    document.removeEventListener('drop', _unspring, true);
    document.removeEventListener('dragend', _unspring, true);
    spring = null;
  }
  function _spring(n, e) {
    if (open.has(n.key) || (spring && spring.key === n.key)) return;
    const types = Array.from((e.dataTransfer && e.dataTransfer.types) || []);
    if (!types.includes(MEDIA_DRAG) && !types.includes('Files') && !types.includes(FOLDER_DRAG)) return;
    _unspring();
    const watch = (ev) => {
      const r = ev.target && ev.target.closest ? ev.target.closest('.mt-row') : null;
      if (!r || r.dataset.key !== n.key || !el.contains(r)) _unspring();
    };
    const timer = setTimeout(() => {
      _unspring();
      if (open.has(n.key) || !byKey.has(n.key)) return;
      open.add(n.key);
      _lsSet(K_OPEN, [...open]);
      paint();
    }, SPRING_MS);
    spring = { key: n.key, timer, watch };
    document.addEventListener('dragover', watch, true);
    document.addEventListener('drop', _unspring, true);
    document.addEventListener('dragend', _unspring, true);
  }

  // A tile let go here - or (phase V34.E) files from Explorer, on a node that takes them (the page says, `takesFiles`).
  // The same on a node's row, its folder tile and its word in the path (phase V35).
  function _takesDrops(target, n) {
    const _files = (e) => Array.from((e.dataTransfer && e.dataTransfer.types) || []).includes('Files')
      && typeof opt.takesFiles === 'function' && opt.takesFiles(n);
    target.addEventListener('dragover', (e) => {
      // (phase V54) A folder dragged onto a folder of its kind, or the kind's row.
      if (_hasType(e.dataTransfer, FOLDER_DRAG)) {
        // (phase V55) An IMAGES folder over Environments / Lookbooks: taken, to be refused in words (not lit).
        if (refusesFolder(n)) { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'move'; return; }
        if (!takesFolder(n)) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';
        target.classList.add('is-drop');
        return;
      }
      if (_files(e)) {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'copy';
        target.classList.add('is-drop');
        return;
      }
      if (!_dropAction(n, _dragKind(e.dataTransfer), _refType(e.dataTransfer))) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
      target.classList.add('is-drop');
    });
    target.addEventListener('dragleave', () => target.classList.remove('is-drop'));
    target.addEventListener('drop', (e) => {
      target.classList.remove('is-drop');
      if (_hasType(e.dataTransfer, FOLDER_DRAG)) {
        if (refusesFolder(n)) {
          e.preventDefault();
          e.stopPropagation();
          _dragging = null;
          opt.status(MADE[n.kind] + ' holds only what its generator made and its references - put the folder into references', true);
          return;
        }
        if (!takesFolder(n)) return;
        e.preventDefault();
        e.stopPropagation();
        const d = _dragging;
        _dragging = null;
        _moveFolder(d, n);
        return;
      }
      if (_files(e)) {
        e.preventDefault();
        e.stopPropagation();
        opt.onFiles(n, Array.from(e.dataTransfer.files || []));
        return;
      }
      if (!_dropAction(n, _dragKind(e.dataTransfer), _refType(e.dataTransfer))) return;
      e.preventDefault();
      e.stopPropagation();
      let it = null;
      try { it = JSON.parse(e.dataTransfer.getData(MEDIA_DRAG)); } catch (err) { return; }
      if (it) _take(n, it, _refType(e.dataTransfer));
    });
  }

  // ── Folders in the gallery (phase V35) ──
  // A node opened from its folder tile or its word in the path: selected, its own branch opened too, as Explorer's tree
  // follows the folder you went into.
  function openNode(key) {
    const n = byKey.get(key);
    if (!n) return;
    if (n.children && n.children.length && !open.has(key)) { _openOne(key); _lsSet(K_OPEN, [...open]); }
    select(key, true, true);
  }

  // What a node's tooltip says: the server's own word (`tip`), else what it is.
  const _tipOf = (n) => n.tip || (n.builtin ? n.label + ' - built into the app: read only'
    : n.locked ? n.label + ' - required: it cannot be renamed, moved or deleted'
    : n.empty ? n.label + ' - empty' : n.label);

  /** The folders of a node, as tiles - first in its gallery. null when it has none. */
  function foldersEl(node) {
    const n = node && byKey.get(node.key);
    if (!n || !n.children || !n.children.length) return null;
    const box = _el('div', 'mt-folders');
    for (const c of n.children) {
      const t = _el('button', 'mt-ftile' + (c.empty ? ' is-empty' : '') + (c.locked ? ' is-locked' : '') + (fresh.has(c.key) ? ' is-new' : ''));
      t.type = 'button';
      t.dataset.key = c.key;
      t.title = _tipOf(c) + ' · ' + _plural(c.count || 0, 'item');
      const ic = _el('span', 'mt-ficon');
      ic.innerHTML = FOLDER_SVG;
      t.appendChild(ic);
      const nm = _el('span', 'mt-fname', c.label);
      t.appendChild(nm);
      if (c.locked) {
        const lock = _el('span', 'mt-lock');
        lock.innerHTML = LOCK_SVG;
        t.appendChild(lock);
      }
      t.appendChild(_el('span', 'mt-fn', String(c.count || 0)));
      t.addEventListener('click', () => openNode(c.key));
      t.addEventListener('contextmenu', (e) => { e.preventDefault(); _menu(c, t, e.clientX, e.clientY); });
      _takesDrops(t, c);
      if (movable(c)) _draggable(t, c);
      box.appendChild(t);
    }
    return box;
  }

  /** The path to a node over its gallery - "AUDIO / SFX / My sounds"; every word but the last opens its folder. */
  function crumbsEl(node) {
    const box = _el('div', 'mt-crumbs');
    const chain = [];
    for (let k = node && node.key; k && byKey.has(k); k = parentOf.get(k)) chain.unshift(byKey.get(k));
    chain.forEach((c, i) => {
      if (i) box.appendChild(_el('span', 'mt-crumb-sep', '/'));
      const last = i === chain.length - 1;
      const w = _el(last ? 'span' : 'button', 'mt-crumb' + (last ? ' is-here' : '') + (i === 0 ? ' is-top' : ''), c.label);
      if (!last) {
        w.type = 'button';
        w.title = 'Open ' + c.label;
        w.addEventListener('click', () => openNode(c.key));
      }
      _takesDrops(w, c);
      box.appendChild(w);
    });
    return box;
  }

  function toggle(key) {
    if (open.has(key)) open.delete(key); else _openOne(key);
    _lsSet(K_OPEN, [...open]);
    paint();
  }

  function select(key, fire, repaint) {
    if (!byKey.has(key)) return;
    sel = key;
    _lsSet(K_SEL, sel);
    // Opened: it and everything under it are seen - and its branch is green only while something else in it is new.
    _seeAll(byKey.get(key));
    _computeNew();
    if (_openTo(key) || repaint) paint(); else _mark();
    const row = el.querySelector('.mt-row.is-sel');
    if (row) row.scrollIntoView({ block: 'nearest' });
    if (fire) opt.onSelect(byKey.get(key));
  }

  // A kind and a category, as a node: no category is the kind itself - a B-roll's is Generated (V35: no Uncategorized).
  function selectFor(kind, cat, fire = true) {
    const none = !cat || cat === UNCAT;
    const want = none ? (kind === 'birols' ? 'generated' : kind) : kind + ':' + cat;
    select(byKey.has(want) ? want : kind, fire);
  }

  const kindLabel = (kind) => ((byKey.get(kind) || {}).label) || kind;
  // Where what has no category of a kind lies, in words (V35): the kind itself - a B-roll's, Generated.
  const homeName = (kind) => (kind === 'birols' ? 'Generated' : kindLabel(kind));
  // A place in Music, in words: "Music", "Music · highlights", "highlights · calm".
  const musicPlace = (folder, mood) => (mood ? 'highlights · ' + (((byKey.get('music:highlights:' + mood)) || {}).label || mood)
    : folder ? 'Music · highlights' : 'Music');

  // After the page has read its gallery again - a read may end by clearing the status line.
  async function _after(msg, what) {
    await load();
    try { await opt.onChanged(what || {}); } catch (e) { /* the page says its own */ }
    if (msg) opt.status(msg);
  }

  // ── A tile let go on a node ──
  async function _take(n, it, refType) {
    const act = _dropAction(n, it.kind, refType);
    const t = _target(n);
    if (!act || !t) return;
    if (act === 'refuse') {
      opt.status(MADE[it.kind] ? MADE_SAYS[it.kind]
        : t.made ? 'Only ' + (t.kind === 'lookbooks' ? 'New lookbook' : 'New environment') + ' puts pictures into ' + MADE[t.kind]
          + ' (+ on it) - a photo goes into its references'
        : 'A built-in sound stays in Built-in - ★ puts it in Favorites, Cut… (the right button) makes a piece of your own', true);
      return;
    }
    const item = { kind: it.kind, id: it.id, meta: { categoryId: it.cat || '' } };
    // Where it is now, in words: a B-roll with no category lies in Generated, the rest in their kind.
    const where = t.cat ? n.label : homeName(t.kind);
    // (phase V54) Several picked tiles: one request; each goes as it would alone, or stays and says why.
    if (Array.isArray(it.many) && it.many.length > 1) { await _takeMany(n, t, it.many, where); return; }
    try {
      // (phase V35, the owner's (ф3)) A track: into Music, the highlights folder, or the one mood its preset made it for -
      // the rule is the store's (lib/music-store.js place, V34.F); a refusal comes back in words.
      if (act === 'place') {
        // (phase V54) An own folder of Music: the track is filed there (and leaves highlights).
        if (t.cat) {
          if ((it.cat || '') === t.cat) return;
          await A.setCategory(item, t.cat, t.name);
          await _after('"' + (it.name || 'It') + '" is in ' + n.label, { moved: it });
          return;
        }
        if ((it.folder || '') === t.folder && (it.mood || '') === t.mood && !it.cat) return;
        const r = await fetch('/api/audio/music/' + encodeURIComponent(it.id) + '/place', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ folder: t.folder, mood: t.mood }),
        }).then(x => x.json()).catch(() => null);
        if (!r || !r.success) { opt.status((r && r.error) || 'Could not move the track', true); return; }
        await _after('"' + (it.name || 'It') + '" is in ' + musicPlace(r.folder, r.mood), { moved: it });
        return;
      }
      // (phase TG, block 5b) A post: filed within REFERENCES, or - one video, one picture - out of it into VIDEO or IMAGES.
      if (act === 'ref' || act === 'out') {
        if (act === 'ref' && (it.cat || '') === t.cat) return;
        const r = await fetch('/api/references/' + encodeURIComponent(it.id) + '/move', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ files: 'all', to: { kind: t.kind, cat: t.cat, label: t.name } }),
        }).then(x => x.json());
        if (!r || !r.success) throw new Error((r && r.error) || 'not moved');
        if (r.skipped && r.skipped.length && !r.moved) throw new Error(r.skipped[0].why);
        const there = act === 'ref' ? (t.cat ? 'REFERENCES · ' + n.label : 'its source\'s folder in REFERENCES') : where;
        await _after('"' + (it.name || 'It') + '" is in ' + there, { moved: it });
        return;
      }
      if (act === 'cat') {
        if ((it.cat || '') === t.cat) return;
        await A.setCategory(item, t.cat, t.name);
        await _after('"' + (it.name || 'It') + '" is in ' + where, { moved: it });
      } else if (act === 'kind') {
        // Off its own kind's category first: a category is one kind's, and kept across it would come back as a stray.
        if (it.cat) await A.setCategory(item, '', '');
        await A.setKind(item, t.kind);
        if (t.cat) await A.setCategory({ kind: t.kind, id: it.id }, t.cat, t.name);
        await _after('"' + (it.name || 'It') + '" moved to ' + (t.kind === 'birols' && !t.cat ? where : kindLabel(t.kind) + (t.cat ? ' · ' + n.label : '')), { moved: it });
      }
    } catch (e) { opt.status('Could not move it: ' + e.message, true); await load(); }
  }

  async function _takeMany(n, t, many, where) {
    const there = t.kind === 'music' ? (t.cat ? n.label : musicPlace(t.folder, t.mood))
      : t.kind === 'references' ? (t.cat ? 'REFERENCES · ' + n.label : 'their sources\' folders in REFERENCES') : where;
    let r = null;
    try {
      r = await fetch('/api/library/batch/move', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: many, to: { kind: t.kind, cat: t.cat || '', label: t.name || '', folder: t.folder || '', mood: t.mood || '' } }),
      }).then(x => x.json());
      if (!r || !r.success) throw new Error((r && r.error) || 'not moved');
    } catch (e) { opt.status('Could not move them: ' + e.message, true); await load(); return; }
    const sk = r.skipped || [];
    const whys = [...new Set(sk.map(x => x.why))].slice(0, 3).join('; ');
    const msg = (r.done ? _plural(r.done, 'item') + ' in ' + there : 'Nothing moved') + (sk.length ? ' · ' + sk.length + ' stayed: ' + whys : '');
    await _after(sk.length && !r.done ? '' : msg, { moved: { many } });
    if (sk.length && !r.done) opt.status(msg, true);
  }

  // ── Folders (phase V54) ──
  const _lcName = (c) => String(c.name || c.label).toLowerCase();

  // A folder dragged by its row or its tile.
  function _draggable(target, n) {
    target.draggable = true;
    target.addEventListener('dragstart', (e) => {
      if (!e.dataTransfer) return;
      _dragging = { kind: n.kind, id: n.cat, key: n.key, label: n.label };
      e.dataTransfer.setData(FOLDER_DRAG, JSON.stringify(_dragging));
      e.dataTransfer.setData(FOLDER_KIND + n.kind, '1');
      e.dataTransfer.effectAllowed = 'move';
      e.stopPropagation();
      document.addEventListener('dragend', () => { _dragging = null; }, { once: true });
    });
  }

  async function _newFolder(n, anchor) {
    if (!holds(n)) return;
    const kind = n.kind;
    const cat = await askName({
      anchor, title: 'New folder in ' + (n.label || kind), okLabel: 'Create', maxLength: 60,
      check: (name) => {
        const taken = kidFolders(n).find(c => _lcName(c) === name.toLowerCase());
        return taken ? 'There is already a folder called ' + taken.label + ' here.' : '';
      },
      submit: async (name) => (await A.addFolder(kind, name, n.cat || '')).cat,
    });
    if (!cat) return;
    open.add(n.key);
    _lsSet(K_OPEN, [...open]);
    await _after('Made the folder "' + cat.label + '"', { cats: kind });
  }

  async function _rename(n, anchor) {
    const parent = byKey.get(parentOf.get(n.key));
    const next = await askName({
      anchor, title: 'Rename folder', value: n.name || n.label, okLabel: 'Rename', maxLength: 60,
      check: (name) => {
        const taken = kidFolders(parent).find(c => c.key !== n.key && _lcName(c) === name.toLowerCase());
        return taken ? 'There is already a folder called ' + taken.label + ' here.' : '';
      },
      submit: async (name) => {
        if (name === (n.name || n.label)) return null;
        return (await A.renameCat(n.kind, n.cat, name)).cat;
      },
    });
    if (!next) return;
    await _after('Renamed to "' + next.label + '"', { cats: n.kind });
  }

  // Into another folder of its kind, or the kind's top (`t` is the kind's own node). Refused in words by the server.
  async function _moveFolder(d, t) {
    if (!d || !t) return;
    let r = null;
    try {
      r = await fetch('/api/library/cats/' + encodeURIComponent(d.id) + '/move', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: d.kind, parent: t.cat || '' }),
      }).then(x => x.json());
    } catch (e) { r = { success: false, error: e.message }; }
    if (!r || !r.success) { opt.status((r && r.error) || 'Could not move the folder', true); return; }
    open.add(t.key);
    _lsSet(K_OPEN, [...open]);
    await _after('"' + d.label + '" is in ' + (t.cat ? t.label : (t.label || kindLabel(d.kind))) + ' now', { cats: d.kind, moved: { folder: d.id } });
  }

  // Delete (phase V54, (зв46)): what is in it ONE LEVEL UP - its files into the folder it is in (at the top, the kind
  // itself), its folders that folder's (the safe one, chosen) - or deleted with everything in it and under it, and then the
  // projects using them are named (lib/timeline-media.js usage): there they turn red.
  let _pop = null;
  function _closePop() {
    if (!_pop) return;
    _pop.el.remove();
    document.removeEventListener('mousedown', _pop.away, true);
    Layers.close(_pop.layer);
    _pop = null;
  }

  function _askDelete(n, anchor) {
    _closePop();
    _closeMenu();
    const box = _el('div', 'mt-pop');
    const count = n.count || 0;
    const noun = NOUN[n.kind] || 'item';
    // Its folders, all the way down.
    let folders = 0;
    const walk = (x) => { for (const c of kidFolders(x)) { folders++; walk(c); } };
    walk(n);
    // Where what is in it goes - the folder it is in; at the top, the kind itself (V35: no Uncategorized), a post back to
    // its source's folder, a track into Music.
    const up = byKey.get(parentOf.get(n.key));
    const home = up && up.cat ? '"' + up.label + '"'
      : n.kind === 'references' ? 'their sources\' folders' : n.kind === 'music' ? 'Music' : homeName(n.kind);
    box.appendChild(_el('div', 'mt-pop-head', 'Delete "' + n.label + '"?'));
    if (count || folders) box.appendChild(_el('div', 'mt-pop-note', 'Inside: ' + [count ? _plural(count, noun) : '', folders ? _plural(folders, 'folder') : ''].filter(Boolean).join(' and ') + '.'));
    const lab = _el('label', 'mt-pop-row');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = true;                       // the safe branch is the default
    lab.appendChild(cb);
    lab.appendChild(_el('span', null, (count || folders) ? 'Move what is in it up into ' + home + (folders ? ' - its folders stay folders' : '') : 'Nothing in it to move'));
    box.appendChild(lab);
    const note = _el('div', 'mt-pop-note');
    box.appendChild(note);
    const used = _el('div', 'mt-pop-used');
    box.appendChild(used);
    const btns = _el('div', 'mt-pop-btns');
    const cancel = _el('button', 'mt-pop-btn', 'Cancel');
    cancel.type = 'button';
    const go = _el('button', 'mt-pop-btn', '');
    go.type = 'button';
    btns.appendChild(cancel);
    btns.appendChild(go);
    box.appendChild(btns);

    let projects = null;
    const paintPop = () => {
      const keep = cb.checked || (!count && !folders);
      note.textContent = keep ? (count ? 'The ' + noun + 's stay on the disk.' : '')
        : count ? 'Its ' + _plural(count, noun) + (folders ? ' - in it and in every folder under it -' : '') + ' will be deleted from the disk. This cannot be undone.'
        : 'Its folders go with it.';
      go.textContent = keep ? 'Delete folder' : count ? 'Delete folder and ' + _plural(count, noun) : 'Delete folder and its folders';
      go.classList.toggle('is-danger', !keep);
      used.textContent = '';
      used.hidden = keep || !projects || !projects.length;
      if (!used.hidden) {
        used.appendChild(_el('div', 'mt-pop-used-head', 'Used in ' + _plural(projects.length, 'project') + ' - there it turns red, to be replaced or removed:'));
        for (const p of projects.slice(0, 8)) used.appendChild(_el('div', 'mt-pop-used-row', '«' + p.title + '» · ' + _plural(p.clips, 'clip')));
        if (projects.length > 8) used.appendChild(_el('div', 'mt-pop-used-row', '… and ' + (projects.length - 8) + ' more'));
      }
    };
    cb.addEventListener('change', paintPop);
    paintPop();
    if (count) {
      fetch('/api/library/usage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: n.kind, cat: n.cat }) })
        .then(r => r.json()).then(d => { projects = (d && d.projects) || []; if (_pop && _pop.el === box) paintPop(); })
        .catch(() => { /* named only when it can be */ });
    }

    document.body.appendChild(box);
    const r = anchor.getBoundingClientRect();
    const w = box.getBoundingClientRect();
    box.style.left = Math.round(Math.max(6, Math.min(r.right - w.width, window.innerWidth - w.width - 6))) + 'px';
    box.style.top = Math.round(Math.min(r.bottom + 4, window.innerHeight - w.height - 6)) + 'px';
    const away = (e) => { if (!box.contains(e.target)) _closePop(); };
    const layer = Layers.open(box, { modal: false, name: 'delete a folder', onEsc: _closePop });
    _pop = { el: box, away, layer };
    document.addEventListener('mousedown', away, true);
    cancel.addEventListener('click', _closePop);
    go.addEventListener('click', async () => {
      const mode = (cb.checked || (!count && !folders)) ? 'move' : 'delete';
      go.disabled = true; cancel.disabled = true;
      try {
        const d = await A.deleteCat(n.kind, n.cat, mode);
        _closePop();
        const msg = d.mode === 'delete'
          ? 'Deleted the folder and ' + _plural(d.affected || 0, noun)
          : 'Deleted the folder' + (d.affected || d.folders ? '; what was in it is in ' + home : '');
        await _after(msg, { cats: n.kind, deleted: d.mode === 'delete' });
      } catch (e) {
        _closePop();
        opt.status(e.message, true);
      }
    });
  }

  // ── The menu under the right button ──
  let _m = null;
  function _closeMenu() {
    if (!_m) return;
    _m.el.remove();
    document.removeEventListener('mousedown', _m.away, true);
    window.removeEventListener('scroll', _closeMenu, true);
    Layers.close(_m.layer);
    _m = null;
  }

  function _menu(n, row, x, y) {
    _closeMenu();
    const items = [];
    // (phase V54) A new folder INSIDE the one pressed (зв19).
    if (holds(n)) items.push(['New folder', 'in ' + n.label, () => _newFolder(n, row)]);
    // (phase V55) Environments / Lookbooks: their generator; what they hold is the app's to keep where it is.
    if (n.make && typeof opt.onMake === 'function') {
      items.push([n.makeLabel, 'opens the generator', () => opt.onMake(n, row)]);
      items.push(['Required', 'what its generator made stays here - open it or delete it', null]);
    }
    if (n.cat && !n.uncat && !n.project) {
      if (n.builtin) items.push(['Built-in', 'part of the app - read only', null]);
      else if (n.locked) items.push(['Required', 'it cannot be renamed, moved or deleted', null]);
      else if (n.own) {
        items.push(['Rename', n.label, () => _rename(n, row)]);
        items.push(['Delete', 'the folder - what is in it goes up a level, or with it', () => _askDelete(n, row)]);
      }
    }
    if (!items.length) return;
    const m = _el('div', 'mv3-plus-menu mt-menu');
    for (const [label, sub, on] of items) {
      const b = _el('button', 'mv3-plus-item');
      b.type = 'button';
      b.appendChild(_el('span', null, label));
      if (sub) b.appendChild(_el('small', null, sub));
      if (on) b.addEventListener('click', (e) => { e.stopPropagation(); _closeMenu(); on(); });
      else b.disabled = true;
      m.appendChild(b);
    }
    document.body.appendChild(m);
    const w = m.offsetWidth, h = m.offsetHeight;
    m.style.left = Math.round(Math.max(6, Math.min(window.innerWidth - w - 6, x))) + 'px';
    m.style.top = Math.round(Math.max(6, Math.min(window.innerHeight - h - 6, y))) + 'px';
    const away = (e) => { if (!m.contains(e.target)) _closeMenu(); };
    const layer = Layers.open(m, { modal: false, name: 'folder menu', onEsc: _closeMenu });
    _m = { el: m, away, layer };
    document.addEventListener('mousedown', away, true);
    window.addEventListener('scroll', _closeMenu, true);
  }

  return {
    el, load, select, selectFor, kindLabel, openNode, foldersEl, crumbsEl, homeName,
    // (phase V54) the gallery's empty space: "New folder" inside the open node, when it holds folders
    holds: (node) => holds(node && byKey.get(node.key)),
    newFolder: (node, anchor) => _newFolder(node && byKey.get(node.key), anchor),
    selected: () => byKey.get(sel) || null,
    node: (key) => byKey.get(key) || null,
  };
}
