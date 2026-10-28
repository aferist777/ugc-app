// THE FOLDER COLUMN (phase V55, the owner 2026-10-28, (гн7), (гн13): "в правом столбце чата изображений нужно в дропдауне
// сделать дерево, а ниже показывать изображения"; "показывать плитками, иначе как мне выбирать медиа которое хочу
// прикрепить"). ONE module for a narrow column of pictures to point at - the pictures chat's right column (js/merge-v3/
// chat-shell.js). (The Images column of the old New environment / New lookbook chat went with it in phase V58 - the
// generators are windows now, js/gen-window.js.)
//
//   - on top a DROPDOWN of the media tree (GET /api/library/tree, only `roots`), worn as "Move to…" wears it
//     (css/media-tree.css .mtp-row, css/references.css .ref-move) - folded but for the way to what is open; a first row
//     that is not a folder ("this project", `own`) when the caller has one; "‹" beside it goes up a level;
//   - under it the FOLDERS of the one open, as tiles - pressed, one opens;
//   - then what lies DIRECTLY in it (its `q`, the media tree's rule since V35): the pictures, each its own shape, stacked
//     in columns. A REFERENCES post gives its pictures one by one (`files`).
//   - (phase V56, (ги2), (ги3)) only the folders holding files of that type - in them or under them - are offered, and
//     their number is how many of those (typedTree: the shelf read once per kind, its answer dealt to the folders).
//   - (phase V58, (лк1), (лк2)) a ✕ in the corner of every picture of a folder, pressed twice ("really?" - "used in N
//     projects" when timelines hold it), deletes it from the library the way its shelf does (js/del-x.js); the column
//     reads itself again and tells the caller (`onDeleted`).
//
// The tiles are the caller's (`tile(it)`): what a press does, its mark, a drag. Nothing is remembered unless `lsKey`.
//
// The helpers under it - readTree, folderIndex, pruneTree, filesUnder, filesOf, locateFile - are the attachment window's
// too (js/merge-v3/chat-pick.js, phase V55): a node's files are read by its `q`, never by a list of the app's folders.

import * as Layers from './layers.js';
import { delX, canDelete, deleteFile, usageWords, filesOf as delFiles, titleOf } from './del-x.js';

const UNCAT = '__uncat__';
const FOLDER_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M3 6.5A2.5 2.5 0 0 1 5.5 4h4.2c.6 0 1.2.24 1.65.66L12.8 6H18.5A2.5 2.5 0 0 1 21 8.5v9a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5v-11z"/></svg>';
const LOCK_SVG = '<svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true"><path fill="currentColor" d="M8 1a3.5 3.5 0 0 0-3.5 3.5V7H4a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1h-.5V4.5A3.5 3.5 0 0 0 8 1zm-2 6V4.5a2 2 0 1 1 4 0V7H6z"/></svg>';

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const _json = (url) => fetch(url).then(r => r.json()).catch(() => null);

// ── The tree and the files of its nodes ─────────────────────────────────────

/** The media tree's top nodes `roots` (by key, in that order) -> { nodes, byKey, parentOf } or null when unread. */
export async function readTree(roots) {
  const d = await _json('/api/library/tree');
  if (!d || !d.success) return null;
  const all = d.nodes || [];
  const nodes = Array.isArray(roots) && roots.length ? roots.map(k => all.find(n => n.key === k)).filter(Boolean) : all;
  const byKey = new Map();
  const parentOf = new Map();
  const walk = (list, p) => { for (const n of list) { byKey.set(n.key, n); if (p) parentOf.set(n.key, p.key); if (n.children) walk(n.children, n); } };
  walk(nodes, null);
  return { nodes, byKey, parentOf };
}

const RX = {
  photo: /\.(jpe?g|png|webp|gif|avif|bmp)(\?|$)/i,
  video: /\.(mp4|mov|m4v|webm|mkv|avi)(\?|$)/i,
  audio: /\.(mp3|wav|m4a|aac|ogg|oga|flac|opus)(\?|$)/i,
};
const _ar = (w, h) => (w > 0 && h > 0 ? w + ':' + h : '');

/**
 * What a shelf answer holds of one TYPE - 'photo' | 'video' | 'audio' - as files:
 *   { path, name, aspect, w, h, thumb, dur, kind, libId, item }  (`item` - the shelf's own record)
 * A REFERENCES post gives its files of that type one by one (a long video kept as a tile has none); a downloaded YouTube
 * video is a video; anything else is taken when its file is of the type.
 */
export function filesOf(items, type) {
  const t = RX[type] ? type : 'photo';
  const out = [];
  for (const i of items || []) {
    if (!i || !i.media) continue;
    const m = i.meta || {};
    if (i.kind === 'references') {
      const files = (Array.isArray(m.items) ? m.items : []).filter(f => f && f.path && f.type === t);
      files.forEach((f, k) => out.push({
        path: f.path, name: String(i.name || 'post') + (files.length > 1 ? ' · ' + (k + 1) + ' of ' + files.length : ''),
        aspect: _ar(+f.w, +f.h), w: +f.w || 0, h: +f.h || 0, thumb: f.thumb || '', dur: +f.dur || 0,
        kind: 'references', libId: '', item: i,
      }));
      continue;
    }
    if (i.kind === 'youtube') {
      if (t === 'video') out.push({ path: i.media, name: i.name || '', aspect: _ar(+m.w, +m.h), w: +m.w || 0, h: +m.h || 0, thumb: i.thumb || '', dur: +i.dur || 0, kind: i.kind, libId: String(i.id || ''), item: i });
      continue;
    }
    if (!RX[t].test(String(i.media))) continue;
    out.push({ path: i.media, name: i.name || '', aspect: _ar(+m.w, +m.h), w: +m.w || 0, h: +m.h || 0, thumb: i.thumb || '',
      dur: +(i.dur || m.dur) || 0, kind: i.kind || '', libId: String(i.id || ''), item: i });
  }
  return out;
}

/** What lies DIRECTLY in a node (its `q`), as files of `type`. A node with no `q` holds only folders: []. */
export async function nodeFiles(node, type) {
  if (!node || !node.q) return [];
  const d = await _json('/api/library/shelf/media?' + new URLSearchParams(node.q));
  if (!d || !d.success) throw new Error((d && d.error) || 'the shelf could not be read');
  return filesOf(d.items, type);
}

// ── Only the folders that hold the type wanted (phase V56, the owner 2026-10-28, п. 2, (ги2), (ги3)) ──
// "отображать только те папки в которых есть изображения и писать их количество. не показываем пустые папки и не
// показываем в выборе изображения папки с видео": a folder is offered only when files of the type lie in it or in a folder
// under it, and its number is how many - every one under it too. One rule for the attachment window (js/merge-v3/
// chat-pick.js), the pictures chat's right column and the Images column of New environment / New lookbook (below).

const _Q_KEYS = ['filter', 'cat', 'src', 'folder', 'mood'];
const ANYCAT = '__cat__';
// A folder's query the shelf answers by these keys alone is answered here from its kind's whole answer (_inQ, the
// shelf's own filters) - one request per kind; any other query (★ Favorites' group, "some category") is read by itself.
const _grouped = (q) => !!q && !!q.filter && Object.keys(q).every(k => _Q_KEYS.includes(k)) && q.cat !== ANYCAT;

/**
 * The files of `type` in every folder of a tree (`nodes` - readTree's, or the media tree's, before anything is left out):
 *   -> { direct: Map(key -> files lying directly in it), total: Map(key -> how many in it and under it) }
 * `cache` (a Map) keeps the shelf's answers for one reading. A kind that could not be read throws.
 * `fit(file)` (phase V57, the owner's (ок1)) - only the files it takes are counted and shown: the video chat's window
 * leaves out the clips longer than the chosen model takes.
 */
export async function folderIndex(nodes, type, cache, fit) {
  const C = cache || new Map();
  const read = (q) => {
    const k = JSON.stringify(q);
    if (!C.has(k)) {
      C.set(k, _json('/api/library/shelf/media?' + new URLSearchParams(q)).then((d) => {
        if (!d || !d.success) throw new Error((d && d.error) || 'the shelf could not be read');
        return d.items || [];
      }));
    }
    return C.get(k);
  };
  const all = [];
  const byKey = new Map();
  const walk = (list) => { for (const n of list || []) { all.push(n); byKey.set(n.key, n); walk(n.children); } };
  walk(nodes);
  const kinds = [...new Set(all.filter(n => _grouped(n.q)).map(n => n.q.filter))];
  const own = all.filter(n => n.q && !_grouped(n.q));
  const [kindRecs, ownRecs] = await Promise.all([Promise.all(kinds.map(f => read({ filter: f }))), Promise.all(own.map(n => read(n.q)))]);
  const recsOf = new Map(kinds.map((f, i) => [f, kindRecs[i]]));
  const ownOf = new Map(own.map((n, i) => [n.key, ownRecs[i]]));
  const foldersOf = (s) => (((byKey.get('references:' + s) || {}).children) || []).map(c => String(c.ref || '').split('/')[1]).filter(Boolean);
  const direct = new Map();
  for (const n of all) {
    if (!n.q) continue;
    const recs = ownOf.has(n.key) ? ownOf.get(n.key) : (recsOf.get(n.q.filter) || []).filter(i => _inQ(i, n.q, foldersOf));
    const seen = new Set();
    direct.set(n.key, filesOf(recs, type).filter(f => (seen.has(f.path) ? false : (seen.add(f.path), true)) && (!fit || fit(f))));
  }
  // How many under each - a file in two folders (★ Favorites and its own) counted once.
  const total = new Map();
  const under = (n) => {
    const s = new Set((direct.get(n.key) || []).map(f => f.path));
    for (const c of n.children || []) for (const p of under(c)) s.add(p);
    total.set(n.key, s.size);
    return s;
  };
  for (const n of nodes || []) under(n);
  return { direct, total };
}

/** The tree with only the folders that hold files of the index's type, each counting them (`count`). Copies - `nodes` is
 *  left as it was. */
export function pruneTree(nodes, idx) {
  const keep = (list) => (list || []).filter(n => (idx.total.get(n.key) || 0) > 0).map((n) => {
    const c = Object.assign({}, n, { count: idx.total.get(n.key), empty: false });
    if (n.children) { c.children = keep(n.children); if (!c.children.length) delete c.children; }
    return c;
  });
  return keep(nodes);
}

/** Every file of the index under a node - in it and in every folder under it, each once (a search "here and deeper"). */
export function filesUnder(node, idx) {
  const out = [];
  const seen = new Set();
  const walk = (n) => {
    for (const f of idx.direct.get(n.key) || []) if (!seen.has(f.path)) { seen.add(f.path); out.push(f); }
    for (const c of n.children || []) walk(c);
  };
  if (node) walk(node);
  return out;
}

/** readTree, with only the folders holding files of `type` - readTree's answer plus `index` (folderIndex's), or null. */
export async function typedTree(roots, type, cache) {
  const t = await readTree(roots);
  if (!t) return null;
  const index = await folderIndex(t.nodes, type, cache);
  const nodes = pruneTree(t.nodes, index);
  const byKey = new Map();
  const parentOf = new Map();
  const walk = (list, p) => { for (const n of list) { byKey.set(n.key, n); if (p) parentOf.set(n.key, p.key); if (n.children) walk(n.children, n); } };
  walk(nodes, null);
  return { nodes, byKey, parentOf, index };
}

// Which shelf kind a library address is read from, by its folder (lib/layout.js MEDIA) - '' when none of the tree's.
const _KIND_DIR = [['/media/images/', 'images'], ['/media/references/', 'references'], ['/media/birols/', 'birols'],
  ['/media/uploads/', 'uploads'], ['/media/hooks/', 'hooks'], ['/media/sounds/', 'sounds'], ['/media/audio/', 'music'],
  // (phase V55, sub-session Q) the generated environments and lookbooks - IMAGES -> Environments / Lookbooks
  ['/media/locations/', 'environments'], ['/media/lookbooks/', 'lookbooks']];
const _isIn = (v, want) => (want === UNCAT ? !v : String(v || '') === String(want));

// Whether a shelf record lies DIRECTLY in a node of the query `q` - the server's rule (routes/library.js _inNode), for the
// keys a folder's query has; a query with any other key is not guessed at.
function _inQ(i, q, foldersOf) {
  const m = i.meta || {};
  for (const k of Object.keys(q)) if (!['filter', 'cat', 'src', 'folder', 'mood'].includes(k)) return false;
  if (q.filter && i.kind !== q.filter && !(q.filter === 'references' && i.kind === 'youtube')) return false;
  if (q.src) {
    const [s, fo] = String(q.src).split('/');
    const site = i.kind === 'youtube' ? 'youtube' : m.source;
    if (m.categoryId || site !== s) return false;
    if (fo && (fo === UNCAT ? foldersOf(s).includes(m.folder) : m.folder !== fo)) return false;
  }
  if (q.folder && !_isIn(m.folder, q.folder)) return false;
  if (q.mood && !_isIn(m.mood, q.mood)) return false;
  if (q.cat) { const c = m.categoryId || ''; if (q.cat === ANYCAT || (q.cat === UNCAT ? !!c : c !== q.cat)) return false; }
  return true;
}

/**
 * The folder of the media tree (only `roots`) a file lies directly in -> its key, or '' when it is not found there. A
 * picture of a REFERENCES post is found by its post.
 */
export async function locateFile(path, roots) {
  const want = String(path || '').split('?')[0];
  const kind = (_KIND_DIR.find(([d]) => want.startsWith(d)) || [])[1] || '';
  if (!kind) return '';
  const [t, d] = await Promise.all([readTree(roots), _json('/api/library/shelf/media?filter=' + kind)]);
  if (!t || !d || !d.success) return '';
  const rec = (d.items || []).find(i => String(i.media || '').split('?')[0] === want
    || (i.kind === 'references' && ((i.meta || {}).items || []).some(f => f && f.path === want)));
  if (!rec) return '';
  const foldersOf = (s) => (((t.byKey.get('references:' + s) || {}).children) || []).map(c => String(c.ref || '').split('/')[1]).filter(Boolean);
  let hit = '';
  const walk = (n) => { if (hit) return; if (n.q && _inQ(rec, n.q, foldersOf)) { hit = n.key; return; } for (const c of n.children || []) walk(c); };
  t.nodes.forEach(walk);
  return hit;
}

// ── The column ──────────────────────────────────────────────────────────────

/**
 * createFolderColumn(host, o) - builds the column in `host` (emptied).
 *   o.roots        the tree's top nodes offered, by key - ['references', 'images']
 *   o.files        'photo' (default) | 'video' | 'audio' - what of a folder is shown
 *   o.own          { label, empty } - a first row that is not a folder ("this project"); its pictures are the caller's,
 *                  given with setOwn(items) - each { path, name, aspect, state, ... } as the caller's tile takes it
 *   o.start        what is open first: 'own', a node's key - else what `lsKey` remembers, else `own`, else roots[0]
 *   o.lsKey        localStorage key to remember what is open (omitted - nothing remembered)
 *   o.tile(it)     -> an element for a picture: it is a file of filesOf (or an own item); the caller wires its press,
 *                  its mark and its drag. Required.
 *   o.lead()       -> an element put first among the pictures (a "+" tile), or null
 *   o.cols(width)  -> how many columns of pictures fit the list's width, its padding left out (default: 3 from 330 px, 2 from
 *                  150 px, else 1)
 *   o.empty        words for an empty folder (default 'Nothing in this folder.')
 *   o.onChange(sel)  what is open changed - sel { own: true } or { node }
 *   o.title        the dropdown's first line (default 'Show')
 *   o.del          false - no ✕ on the pictures (V58: there is one by default); o.onDeleted(file) after one went
 * -> { el, load(), reload(), paint(), setOwn(items), select(key), selected(), isOwn(), items(), close() }
 *    load()   reads the tree (and what is open); reload() - the tree and what is open read again (after an upload);
 *    paint()  the pictures drawn again - the caller's marks changed, or the column's width.
 */
export function createFolderColumn(host, o) {
  const opt = Object.assign({ files: 'photo', empty: 'Nothing in this folder.', title: 'Show' }, o || {});
  const OWN = 'own';
  let tree = null;              // typedTree's answer - only the folders holding files of `files`, and their files
  let sel = '';                 // OWN or a node's key
  let wanted = '';              // a folder asked for while it held nothing of the type - opened once it does (an upload)
  let ownItems = [];
  let files = [];               // what lies in the node open
  let state = 'idle';           // 'reading' | 'ready' | 'error'
  let why = '';
  let loads = 0;
  let menu = null;              // the dropdown, while open

  host.textContent = '';
  const root = el('div', 'fc');
  const head = el('div', 'fc-head');
  const up = el('button', 'fc-up', '‹');
  up.type = 'button';
  const pick = el('button', 'fc-pick');
  pick.type = 'button';
  pick.setAttribute('aria-haspopup', 'tree');
  const pickName = el('span', 'fc-pick-t', '');
  const pickN = el('span', 'fc-pick-n', '');
  pick.append(pickName, pickN, el('span', 'fc-pick-v', '▾'));
  head.append(up, pick);
  const body = el('div', 'fc-body');
  const folders = el('div', 'fc-folders');
  const list = el('div', 'fc-list');
  body.append(folders, list);
  root.append(head, body);
  host.appendChild(root);

  const stored = () => { if (!opt.lsKey) return ''; try { return String(JSON.parse(localStorage.getItem(opt.lsKey) || '""') || ''); } catch (e) { return ''; } };
  const remember = () => { if (!opt.lsKey) return; try { localStorage.setItem(opt.lsKey, JSON.stringify(sel)); } catch (e) { /* a private window */ } };
  const node = (k) => (tree ? tree.byKey.get(k) || null : null);
  const parentKey = (k) => (tree ? tree.parentOf.get(k) || '' : '');
  const pathOf = (k) => { const out = []; for (let x = k; x && node(x); x = parentKey(x)) out.unshift(node(x).label); return out; };

  function _valid(k) { return (k === OWN && !!opt.own) || !!node(k); }
  function _fallback() { return opt.own ? OWN : ((tree && tree.nodes[0]) || {}).key || ''; }

  async function load() {
    const mine = ++loads;
    // The first reading says so; a reading again keeps what is shown until the answer is in.
    if (!tree && sel !== OWN) { state = 'reading'; paint(); }
    let t = null;
    let err = '';
    try { t = await typedTree(opt.roots, opt.files); } catch (e) { err = e.message || 'the folders could not be read'; }
    if (mine !== loads) return;
    if (t) tree = t;
    if (wanted && _valid(wanted)) { sel = wanted; remember(); }
    wanted = '';
    if (!sel) {
      const want = [opt.start, stored()].find(k => k && _valid(k));
      sel = want || _fallback();
    } else if (!_valid(sel)) {
      // A folder deleted or renamed elsewhere, or with nothing of the type left: the nearest that is still there.
      sel = _fallback();
    }
    _paintHead();
    if (!t && err) { state = 'error'; why = err; paint(); return; }
    _read();
  }

  async function reload() {
    await load();
  }

  // What lies in the folder open - from the reading of the tree, so its number and its tiles agree.
  function _read() {
    if (sel === OWN) { state = 'ready'; why = ''; paint(); return; }
    files = (tree && tree.index.direct.get(sel)) || [];
    state = 'ready';
    why = '';
    paint();
  }

  function select(k) {
    // A folder with nothing of the type is not offered; asked for (where an upload went), it opens at the next reading.
    if (!_valid(k)) { if (k) wanted = k; return; }
    const same = k === sel;
    sel = k;
    remember();
    _paintHead();
    if (!same) body.scrollTop = 0;
    _read();
    if (typeof opt.onChange === 'function') opt.onChange(sel === OWN ? { own: true } : { node: node(sel) });
  }

  function _paintHead() {
    const own = sel === OWN;
    const n = node(sel);
    const path = own ? [opt.own.label] : pathOf(sel);
    pickName.textContent = path.length ? path[path.length - 1] : '…';
    pick.title = (path.join(' / ') || '') + ' - press to choose another folder';
    pickN.textContent = own ? String(ownItems.length) : n ? String(n.count || 0) : '';
    const p = own ? '' : parentKey(sel);
    up.hidden = !p;
    up.title = p ? 'Up to ' + node(p).label : '';
  }

  // The folders of the one open, as tiles - pressed, one opens.
  function _paintFolders() {
    folders.textContent = '';
    const n = sel === OWN ? null : node(sel);
    const kids = (n && n.children) || [];
    folders.hidden = !kids.length;
    for (const c of kids) {
      const t = el('button', 'fc-ftile' + (c.empty ? ' is-empty' : ''));
      t.type = 'button';
      t.title = c.label + ' · ' + (c.count || 0);
      const ic = el('span', 'fc-ficon');
      ic.innerHTML = FOLDER_SVG;
      t.appendChild(ic);
      t.appendChild(el('span', 'fc-fname', c.label));
      if (c.locked) { const l = el('span', 'fc-lock'); l.innerHTML = LOCK_SVG; t.appendChild(l); }
      t.appendChild(el('span', 'fc-fn', String(c.count || 0)));
      t.addEventListener('click', () => select(c.key));
      folders.appendChild(t);
    }
  }

  const _cols = (w) => (typeof opt.cols === 'function' ? opt.cols(w) : (w >= 330 ? 3 : w >= 150 ? 2 : 1));
  const _ratio = (ar) => { const p = String(ar || '').split(':'); const v = (+p[0] || 0) / (+p[1] || 0); return v > 0 && isFinite(v) ? v : 9 / 16; };

  /** The pictures drawn again - in columns, each into the shorter one, every tile its own shape. */
  function paint() {
    _paintHead();
    _paintFolders();
    const top = body.scrollTop;
    const own = sel === OWN;
    const shown = own ? ownItems : files;
    const lead = typeof opt.lead === 'function' ? opt.lead() : null;
    if (state === 'reading' && !own) { list.replaceChildren(el('div', 'fc-none', 'reading…')); return; }
    if (state === 'error' && !own) { list.replaceChildren(el('div', 'fc-none', why)); return; }
    if (!shown.length) {
      const n = own ? null : node(sel);
      // A folder that holds folders says nothing of its own emptiness - its tiles are above.
      const words = own ? (opt.own.empty || 'Nothing here yet.') : n && (!n.q || (n.children && n.children.length)) ? '' : opt.empty;
      list.replaceChildren(...[words ? el('div', 'fc-none', words) : null, lead].filter(Boolean));
      return;
    }
    const n = Math.max(1, _cols(list.clientWidth));
    const H = new Array(n).fill(0);
    const boxes = [];
    for (let i = 0; i < n; i++) boxes.push(el('div', 'fc-col'));
    if (lead) { boxes[0].appendChild(lead); H[0] += 0.5; }
    for (const it of shown) {
      let k = 0;
      for (let j = 1; j < n; j++) if (H[j] < H[k]) k = j;
      H[k] += 1 / _ratio(it.aspect);
      const t = opt.tile(it);
      if (t && !own && opt.del !== false && canDelete(it)) {
        t.appendChild(delX({
          host: t, title: titleOf(it),
          ask: () => usageWords(delFiles(it)),
          run: () => deleteFile(it),
          done: () => { reload(); if (typeof opt.onDeleted === 'function') opt.onDeleted(it); },
        }));
      }
      if (t) boxes[k].appendChild(t);
    }
    list.replaceChildren(...boxes);
    body.scrollTop = top;
  }

  // ── The dropdown ──
  function _closeMenu() {
    if (!menu) return;
    const m = menu;
    menu = null;
    m.box.remove();
    Layers.close(m.layer);
    document.removeEventListener('mousedown', m.away, true);
    pick.classList.remove('is-open');
  }

  function _openMenu() {
    if (menu) { _closeMenu(); return; }
    if (!tree && !opt.own) return;
    const open = new Set();
    for (let k = parentKey(sel); k; k = parentKey(k)) open.add(k);
    const box = el('div', 'ref-move mtp-box fc-menu');
    box.appendChild(el('div', 'ref-move-title', opt.title));
    const lst = el('div', 'ref-move-list mt mtp');
    lst.setAttribute('role', 'tree');
    box.appendChild(lst);

    const row = (n, depth, ownRow) => {
      const has = !ownRow && !!(n.children && n.children.length);
      const key = ownRow ? OWN : n.key;
      const b = el('button', 'mt-row mtp-row is-place' + (depth === 0 && !ownRow ? ' is-group' : '') + (key === sel ? ' is-here' : '') + (n.empty ? ' is-empty' : ''));
      b.type = 'button';
      b.dataset.key = key;
      b.setAttribute('role', 'treeitem');
      if (has) b.setAttribute('aria-expanded', open.has(key) ? 'true' : 'false');
      b.style.paddingLeft = (3 + depth * 11) + 'px';
      const tw = el('span', 'mt-tw' + (has && open.has(key) ? ' is-open' : ''), has ? '▸' : '');
      if (has) {
        tw.title = open.has(key) ? 'Fold' : 'Open';
        tw.addEventListener('click', (e) => { e.stopPropagation(); if (open.has(key)) open.delete(key); else open.add(key); paintMenu(); });
      }
      b.appendChild(tw);
      b.appendChild(el('span', 'mt-name', ownRow ? opt.own.label : n.label));
      if (!ownRow && n.locked) { const l = el('span', 'mt-lock'); l.innerHTML = LOCK_SVG; b.appendChild(l); }
      b.appendChild(el('span', 'mt-n', String(ownRow ? ownItems.length : (n.count || 0))));
      b.title = ownRow ? opt.own.label : pathOf(key).join(' / ');
      b.addEventListener('click', () => { _closeMenu(); select(key); });
      return b;
    };
    function paintMenu() {
      const top = lst.scrollTop;
      lst.textContent = '';
      if (opt.own) {
        lst.appendChild(row({}, 0, true));
        lst.appendChild(el('div', 'mtp-sep'));
      }
      const walk = (n, d) => { lst.appendChild(row(n, d)); if (n.children && open.has(n.key)) for (const c of n.children) walk(c, d + 1); };
      for (const n of (tree ? tree.nodes : [])) walk(n, 0);
      lst.scrollTop = top;
    }
    paintMenu();
    document.body.appendChild(box);
    // Under the button, at least as wide as the column, never past the screen - then its list scrolls.
    const r = pick.getBoundingClientRect();
    const W = window.innerWidth, H = window.innerHeight, M = 8;
    const w = Math.max(240, Math.round(root.getBoundingClientRect().width));
    box.style.width = w + 'px';
    box.style.maxHeight = Math.round(Math.max(160, Math.min(520, H - r.bottom - 6 - M))) + 'px';
    box.style.left = Math.round(Math.max(M, Math.min(r.right - w, W - w - M))) + 'px';
    box.style.top = Math.round(r.bottom + 4) + 'px';
    const here = lst.querySelector('.is-here');
    if (here) here.scrollIntoView({ block: 'nearest' });
    const away = (e) => { if (box.contains(e.target) || pick.contains(e.target)) return; _closeMenu(); };
    document.addEventListener('mousedown', away, true);
    menu = { box, away, layer: Layers.open(box, { modal: false, name: 'folder column', onEsc: _closeMenu }) };
    pick.classList.add('is-open');
  }

  pick.addEventListener('click', _openMenu);
  up.addEventListener('click', () => { const p = parentKey(sel); if (p) select(p); });

  return {
    el: root,
    load,
    reload,
    paint,
    setOwn: (items) => { ownItems = Array.isArray(items) ? items : []; if (sel === OWN) paint(); else _paintHead(); },
    select,
    selected: () => (sel === OWN ? { own: true } : { node: node(sel) }),
    isOwn: () => sel === OWN,
    items: () => (sel === OWN ? ownItems : files),
    close: _closeMenu,
  };
}
