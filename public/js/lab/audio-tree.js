/* ═══════════════════════════════════════════════════════════════════════════
   THE AUDIO LAB - AUDIO's tree and its gallery (phase V34.D, the owner 2026-10-22; moved into Merge's Library panel and
   the Library's Media shelf in V34.E - js/media-tree.js is not touched until then):

     Music
     SFX -> Favorites           every ★ (the built-in set's and the person's own)
            Built-in (lock)     the program's set, by its categories - read only
            My sounds           the person's own categories: Generated (lock) first, "+" makes one, a double press renames,
                                the ✕ deletes (its sounds to Uncategorized, or with them)

   A node pressed: its tiles in the gallery. Over the gallery, while SFX is open: the search (name and tags, as typed;
   Escape clears) and "find online" (js/lab/audio-online.js). A tile: its name, ★, the waveform; a press plays it, a
   second stops (js/lab/audio-play.js); its ⋯ (or the right button): Cut… (js/lab/audio-cut.js), rename, move, about,
   delete. Files from Explorer let go on a category of My sounds (or on Music) are brought in there; an own sound's tile let
   go on another category moves there.

   Server: GET /api/audio/lib/tree, /api/audio/lib/items, POST /api/audio/lib/fav (routes/audio-lib.js); the Library's own
   routes for the rest - /api/sounds/upload, /api/audio/music/upload, /api/library/item/:kind/:id, /api/library/cats.
   ═══════════════════════════════════════════════════════════════════════════ */

import * as Layers from '../layers.js';
import { askName } from '../name-box.js';
import { waveEl, playToggle, playing, onChange, secs, stop } from './audio-play.js';

const UNCAT = '__uncat__';
export const TILE_DRAG = 'application/x-ugc-lab-sound';
const KEY_NODE = 'ugc_lab_audio_node';
const KEY_OPEN = 'ugc_lab_audio_open';

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const ls = (k, fb) => { try { const v = localStorage.getItem(k); return v == null ? fb : JSON.parse(v); } catch (e) { return fb; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* a private window */ } };
async function api(url, opts) {
  const r = await fetch(url, opts);
  const d = await r.json().catch(() => null);
  if (!d || d.success === false) throw new Error((d && d.error) || ('status ' + r.status));
  return d;
}
const post = (url, body, method) => api(url, { method: method || 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });

let _tree = [];
let _sel = ls(KEY_NODE, 'sfx');
let _open = new Set(ls(KEY_OPEN, ['sfx', 'builtin', 'mine']));
let _q = '';
let _items = [];
let _treeHost = null, _galHost = null, _say = () => {}, _cutOpen = null, _onlineOpen = null;
let _reqN = 0;

const _isSfx = (key) => key !== 'music';
const _find = (key, nodes) => {
  for (const n of (nodes || _tree)) {
    if (n.key === key) return n;
    const c = n.children && _find(key, n.children);
    if (c) return c;
  }
  return null;
};
/** The categories of My sounds, for the windows that file into one: [{ id, label, locked }]. */
export function myCats() {
  const mine = _find('mine');
  return ((mine && mine.children) || []).filter(c => c.cat && c.cat !== UNCAT).map(c => ({ id: c.cat, label: c.name || c.label, locked: !!c.locked }));
}

// ── the tree ─────────────────────────────────────────────────────────────────
function _row(n, depth) {
  const row = el('div', 'mt-row la-row' + (n.key === _sel ? ' is-sel' : '') + (n.empty ? ' is-empty' : '')
    + (depth === 0 ? ' is-group' : ''));
  row.style.paddingLeft = (depth * 12) + 'px';
  row.dataset.key = n.key;
  const tw = el('button', 'mt-tw' + (_open.has(n.key) ? ' is-open' : ''), n.children && n.children.length ? '▸' : '');
  tw.type = 'button';
  if (!(n.children && n.children.length)) tw.disabled = true;
  tw.addEventListener('click', (e) => { e.stopPropagation(); _toggle(n.key); });
  row.appendChild(tw);
  const name = el('span', 'mt-name', (n.fav ? '★ ' : '') + n.label);
  row.appendChild(name);
  if (n.locked) {
    const lock = el('span', 'mt-lock', '🔒');
    lock.title = n.key === 'builtin' || n.key.startsWith('builtin:') ? 'Built into the app - read only' : 'Required - the app files into it by this name';
    row.appendChild(lock);
  }
  // "+" on My sounds: a new category. ✕ on an own category.
  if (n.key === 'mine') {
    const add = el('button', 'mt-act mt-add', '+');
    add.type = 'button';
    add.title = 'A new category in My sounds';
    add.addEventListener('click', (e) => { e.stopPropagation(); _newCat(add); });
    row.appendChild(add);
  }
  if (n.key.startsWith('mine:') && n.cat !== UNCAT && !n.locked) {
    const x = el('button', 'mt-act mt-x', '✕');
    x.type = 'button';
    x.title = 'Delete this category';
    x.addEventListener('click', (e) => { e.stopPropagation(); _delCat(n, x); });
    row.appendChild(x);
  }
  row.appendChild(el('span', 'mt-n', String(n.count || 0)));
  row.addEventListener('click', () => select(n.key));
  row.addEventListener('dblclick', (e) => {
    if (n.key.startsWith('mine:') && n.cat !== UNCAT && !n.locked) { e.preventDefault(); _renameCat(n, row); }
    else if (n.children && n.children.length) _toggle(n.key);
  });
  _dropTarget(row, n);
  return row;
}
function _paintTree() {
  if (!_treeHost) return;
  _treeHost.textContent = '';
  const box = el('div', 'mt la-tree');
  const walk = (nodes, depth) => {
    for (const n of nodes) {
      box.appendChild(_row(n, depth));
      if (n.children && n.children.length && _open.has(n.key)) walk(n.children, depth + 1);
    }
  };
  walk(_tree, 0);
  _treeHost.appendChild(box);
}
function _toggle(key) {
  if (_open.has(key)) _open.delete(key); else _open.add(key);
  lsSet(KEY_OPEN, [..._open]);
  _paintTree();
}

/** Read the tree again (after anything changed) and the open node's tiles. */
export async function refresh() {
  try { _tree = (await api('/api/audio/lib/tree')).nodes || []; }
  catch (e) { _say('The tree could not be read: ' + e.message, true); return; }
  if (!_find(_sel)) _sel = 'sfx';
  _paintTree();
  await _loadItems();
}

/** Open a node (and its branch). */
export async function select(key) {
  _sel = key;
  lsSet(KEY_NODE, key);
  // Its parents open.
  const path = [];
  const walk = (nodes, trail) => {
    for (const n of nodes) {
      if (n.key === key) { path.push(...trail); return true; }
      if (n.children && walk(n.children, trail.concat(n.key))) return true;
    }
    return false;
  };
  walk(_tree, []);
  for (const k of path) _open.add(k);
  lsSet(KEY_OPEN, [..._open]);
  if (!_isSfx(key)) _q = '';
  _paintTree();
  await _loadItems();
}

/** Where a made thing lies: music -> Music, a sound -> My sounds -> its category. */
export function nodeOf(kind, categoryId) {
  if (kind === 'music') return 'music';
  return 'mine:' + (categoryId || UNCAT);
}

// ── categories ───────────────────────────────────────────────────────────────
async function _newCat(anchor) {
  const name = await askName({
    anchor, title: 'New category in My sounds', placeholder: 'e.g. Whooshes', okLabel: 'make',
    submit: async (label) => (await post('/api/library/cats', { kind: 'sounds', label })).cat,
  });
  if (name && name.id) { await refresh(); select('mine:' + name.id); }
}
async function _renameCat(n, anchor) {
  const done = await askName({
    anchor, title: 'Rename the category', value: n.name || n.label, select: true, okLabel: 'rename',
    submit: async (label) => (await post('/api/library/cats/' + encodeURIComponent(n.cat), { kind: 'sounds', label }, 'PATCH')).cat,
  });
  if (done) refresh();
}
function _delCat(n, anchor) {
  const pop = el('div', 'mt-pop');
  pop.appendChild(el('div', 'mt-pop-head', 'Delete "' + (n.name || n.label) + '"?'));
  const mk = (val, text, on) => {
    const lab = el('label', 'mt-pop-row');
    const r = el('input');
    r.type = 'radio'; r.name = 'la-del'; r.value = val; r.checked = !!on;
    lab.append(r, el('span', null, text));
    return lab;
  };
  pop.appendChild(mk('move', 'Keep its ' + n.count + ' sound' + (n.count === 1 ? '' : 's') + ' - into Uncategorized', true));
  pop.appendChild(mk('delete', 'Delete its sounds too', false));
  const btns = el('div', 'mt-pop-btns');
  const no = el('button', 'mt-pop-btn', 'cancel');
  const yes = el('button', 'mt-pop-btn is-danger', 'delete');
  btns.append(no, yes);
  pop.appendChild(btns);
  document.body.appendChild(pop);
  const r = anchor.getBoundingClientRect();
  pop.style.left = Math.max(8, Math.min(window.innerWidth - 310, r.left - 150)) + 'px';
  pop.style.top = Math.min(window.innerHeight - pop.offsetHeight - 8, r.bottom + 6) + 'px';
  const layer = Layers.open(pop, { modal: true, onEsc: () => close() });
  const close = () => { pop.remove(); Layers.close(layer); };
  no.addEventListener('click', close);
  yes.addEventListener('click', async () => {
    const mode = pop.querySelector('input[name="la-del"]:checked').value;
    yes.disabled = true;
    try {
      await api('/api/library/cats/' + encodeURIComponent(n.cat) + '?kind=sounds&media=' + mode, { method: 'DELETE' });
      close();
      if (_sel === n.key) _sel = 'mine';
      refresh();
    } catch (e) { yes.disabled = false; _say(e.message, true); }
  });
}

// ── letting go on the tree ───────────────────────────────────────────────────
function _catOf(n) {
  if (n.key === 'mine') return '';
  if (n.key.startsWith('mine:')) return n.cat === UNCAT ? '' : n.cat;
  return null;
}
function _dropTarget(row, n) {
  const takesFiles = n.key === 'music' || _catOf(n) !== null;
  if (!takesFiles) return;
  row.addEventListener('dragover', (e) => {
    const types = Array.from(e.dataTransfer.types || []);
    const files = types.includes('Files');
    const tile = types.includes(TILE_DRAG) && _catOf(n) !== null;
    if (!files && !tile) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = files ? 'copy' : 'move';
    row.classList.add('is-drop');
  });
  row.addEventListener('dragleave', () => row.classList.remove('is-drop'));
  row.addEventListener('drop', async (e) => {
    row.classList.remove('is-drop');
    const files = Array.from(e.dataTransfer.files || []);
    const tile = e.dataTransfer.getData(TILE_DRAG);
    if (!files.length && !tile) return;
    e.preventDefault();
    if (files.length) return bringIn(files, n);
    let it = null;
    try { it = JSON.parse(tile); } catch (er) { return; }
    if (!it || it.kind !== 'sounds') { _say('Only your own sounds move between categories - cut a built-in one to make it yours (⋯ → Cut…).', true); return; }
    const cat = _catOf(n);
    const label = cat ? ((myCats().find(c => c.id === cat) || {}).label || '') : '';
    try {
      await post('/api/library/item/sounds/' + encodeURIComponent(it.id), { categoryId: cat, categoryLabel: label }, 'PATCH');
      _say('"' + it.name + '" moved to ' + (label || 'Uncategorized') + '.');
      refresh();
    } catch (er) { _say(er.message, true); }
  });
}

/** Files from this computer, into a node: Music, or a category of My sounds (one after another). */
export async function bringIn(files, n) {
  const node = n || _find(_sel) || _find('mine');
  const toMusic = node && node.key === 'music';
  const cat = toMusic ? '' : (_catOf(node) || '');
  const audio = files.filter(f => /^audio\//.test(f.type) || /\.(mp3|wav|m4a|aac|ogg|oga|flac|opus|webm)$/i.test(f.name));
  if (!audio.length) { _say('Those are not sounds - mp3, wav, m4a, aac, ogg, flac or opus.', true); return; }
  let ok = 0;
  const bad = [];
  for (let i = 0; i < audio.length; i++) {
    _say('Bringing in ' + (i + 1) + ' of ' + audio.length + ': ' + audio[i].name + '…');
    const fd = new FormData();
    fd.append(toMusic ? 'music' : 'sound', audio[i]);
    if (!toMusic) fd.append('categoryId', cat);
    try { await api(toMusic ? '/api/audio/music/upload' : '/api/sounds/upload', { method: 'POST', body: fd }); ok++; }
    catch (e) { bad.push(audio[i].name + ': ' + e.message); }
  }
  _say(ok + ' brought in' + (bad.length ? ' · not: ' + bad.join('; ') : '') + '.', !!bad.length);
  await refresh();
  if (ok) select(toMusic ? 'music' : 'mine:' + (cat || UNCAT));
}

// ── the gallery ──────────────────────────────────────────────────────────────
async function _loadItems() {
  const n = ++_reqN;
  const q = _isSfx(_sel) ? _q : '';
  let d;
  try { d = await api('/api/audio/lib/items?node=' + encodeURIComponent(_sel) + '&q=' + encodeURIComponent(q)); }
  catch (e) { if (n === _reqN) _say('The sounds could not be read: ' + e.message, true); return; }
  if (n !== _reqN) return;
  _items = d.items || [];
  _paintGallery(d.total || _items.length);
}

let _searchEl = null;
function _paintGallery(total) {
  if (!_galHost) return;
  const node = _find(_sel);
  const keepFocus = _searchEl && document.activeElement === _searchEl;
  const caret = keepFocus ? _searchEl.selectionStart : 0;
  _galHost.textContent = '';
  const head = el('div', 'la-gal-head');
  const title = el('div', 'la-gal-title');
  title.appendChild(el('b', null, node ? node.label : ''));
  title.appendChild(el('span', 'la-muted', ' · ' + total));
  head.appendChild(title);
  if (_isSfx(_sel)) {
    const s = el('input', 'la-search');
    s.type = 'search';
    s.placeholder = 'search SFX - name or tag (whoosh, click, pop…)';
    s.value = _q;
    let t = 0;
    s.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { _q = s.value.trim(); _loadItems(); }, 180); });
    s.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && s.value) { e.preventDefault(); e.stopPropagation(); s.value = ''; _q = ''; _loadItems(); }
    });
    head.appendChild(s);
    _searchEl = s;
    const on = el('button', 'la-btn', 'find online…');
    on.type = 'button';
    on.title = 'Search free (CC0) sound libraries - Freesound and Wikimedia Commons through Openverse - and the galleries to download from yourself';
    on.addEventListener('click', () => { if (_onlineOpen) _onlineOpen(_catOf(node || {}) || ''); });
    head.appendChild(on);
  } else _searchEl = null;
  if (node && (node.key === 'music' || _catOf(node) !== null)) {
    const add = el('button', 'la-btn', '+ files');
    add.type = 'button';
    add.title = 'Bring sounds in from this computer - or drop them from Explorer onto a category in the tree';
    add.addEventListener('click', () => {
      const inp = el('input');
      inp.type = 'file'; inp.multiple = true; inp.accept = 'audio/*,.opus';
      inp.addEventListener('change', () => bringIn(Array.from(inp.files || []), node));
      inp.click();
    });
    head.appendChild(add);
  }
  _galHost.appendChild(head);
  if (keepFocus && _searchEl) { _searchEl.focus(); try { _searchEl.setSelectionRange(caret, caret); } catch (e) { /* type=search */ } }

  const grid = el('div', 'la-grid');
  if (!_items.length) {
    const why = _q ? 'Nothing with "' + _q + '" here.'
      : _sel === 'fav' ? 'No favourites yet - the ★ on any sound puts it here.'
      : _sel.startsWith('builtin') ? 'The built-in set is not installed yet (it comes with the next npm install).'
      : 'Nothing here yet - drop files from Explorer onto this category, or make some with the constructor.';
    grid.appendChild(el('div', 'la-empty', why));
  }
  for (const it of _items) grid.appendChild(_tile(it));
  _galHost.appendChild(grid);
}

function _tile(it) {
  const t = el('div', 'la-tile' + (it.path === playing() ? ' is-playing' : ''));
  t.dataset.path = it.path;
  const top = el('div', 'la-tile-top');
  top.appendChild(el('span', 'la-tile-name', it.name));
  const star = el('button', 'la-star' + (it.fav ? ' on' : ''), it.fav ? '★' : '☆');
  star.type = 'button';
  star.title = it.fav ? 'Take it out of Favorites' : 'Into Favorites';
  star.addEventListener('click', async (e) => {
    e.stopPropagation();
    try { await post('/api/audio/lib/fav', { kind: it.kind, id: it.id, path: it.path, on: !it.fav }); it.fav = !it.fav; refresh(); }
    catch (er) { _say(er.message, true); }
  });
  top.appendChild(star);
  const more = el('button', 'la-more', '⋯');
  more.type = 'button';
  more.title = 'Cut, rename, move, about, delete';
  more.addEventListener('click', (e) => { e.stopPropagation(); _menu(it, more); });
  top.appendChild(more);
  t.appendChild(top);
  t.appendChild(waveEl(it.wave));
  const foot = el('div', 'la-tile-foot');
  foot.appendChild(el('span', null, secs(it.dur)));
  const where = it.kind === 'builtin' ? it.categoryLabel : it.kind === 'music' ? (it.source === 'upload' ? 'brought in' : it.source) : (it.categoryLabel || 'Uncategorized');
  foot.appendChild(el('span', 'la-muted', where));
  t.appendChild(foot);
  t.title = it.name + (it.tags && it.tags.length ? '\n' + it.tags.join(', ') : '');
  t.addEventListener('click', () => playToggle(it.path, t));
  t.addEventListener('contextmenu', (e) => { e.preventDefault(); _menu(it, t, e); });
  t.draggable = true;
  t.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData(TILE_DRAG, JSON.stringify({ kind: it.kind, id: it.id, name: it.name, path: it.path, dur: it.dur }));
    e.dataTransfer.setData('text/plain', it.path);
    e.dataTransfer.effectAllowed = 'copyMove';
  });
  return t;
}

// The tile's menu: what can be done with this sound.
let _menuEl = null, _menuLayer = null;
function _closeMenu() {
  if (_menuEl) { _menuEl.remove(); _menuEl = null; }
  if (_menuLayer) { Layers.close(_menuLayer); _menuLayer = null; }
  document.removeEventListener('mousedown', _away, true);
}
function _away(e) { if (_menuEl && !_menuEl.contains(e.target)) _closeMenu(); }
function _menu(it, anchor, ev) {
  _closeMenu();
  const m = el('div', 'mv3-plus-menu la-menu');
  const item = (label, sub, fn, danger) => {
    const b = el('button', 'mv3-plus-item' + (danger ? ' is-danger' : ''));
    b.type = 'button';
    b.appendChild(el('span', null, label));
    if (sub) b.appendChild(el('small', null, sub));
    b.addEventListener('click', () => { _closeMenu(); fn(); });
    m.appendChild(b);
  };
  item('Cut…', 'a piece of it as a new sound in My sounds', () => { if (_cutOpen) _cutOpen(it); });
  if (it.kind !== 'builtin') {
    item('Rename', '', async () => {
      const done = await askName({ anchor, title: 'Rename', value: it.name, select: true, okLabel: 'rename',
        submit: async (name) => post('/api/library/item/' + it.kind + '/' + encodeURIComponent(it.id), { name }, 'PATCH') });
      if (done) refresh();
    });
  }
  if (it.kind === 'sounds') {
    for (const c of [{ id: '', label: 'Uncategorized' }].concat(myCats())) {
      if ((it.categoryId || '') === c.id) continue;
      item('Move to ' + c.label, '', async () => {
        try { await post('/api/library/item/sounds/' + encodeURIComponent(it.id), { categoryId: c.id, categoryLabel: c.id ? c.label : '' }, 'PATCH'); refresh(); }
        catch (e) { _say(e.message, true); }
      });
    }
  }
  item('About', 'where it came from, its licence', () => _about(it, anchor));
  if (it.kind !== 'builtin') item('Delete', it.kind === 'music' ? 'the track and its file' : 'the sound and its file', () => _delete(it), true);
  document.body.appendChild(m);
  const r = anchor.getBoundingClientRect();
  const x = ev ? ev.clientX : r.left, y = ev ? ev.clientY : r.bottom + 4;
  m.style.left = Math.max(8, Math.min(window.innerWidth - m.offsetWidth - 8, x)) + 'px';
  m.style.top = Math.max(8, Math.min(window.innerHeight - m.offsetHeight - 8, y)) + 'px';
  _menuEl = m;
  _menuLayer = Layers.open(m, { modal: false, onEsc: _closeMenu });
  setTimeout(() => document.addEventListener('mousedown', _away, true), 0);
}

async function _delete(it) {
  let where = [];
  try { where = (await post('/api/library/usage', { media: [it.path] })).projects || []; } catch (e) { where = []; }
  const used = where.length ? '\n\nIt is on the timeline of: ' + where.map(p => p.title).join(', ') + ' - those clips will turn red.' : '';
  // A plain question: the window is the app's, and the page's own boxes are names only.
  if (!window.confirm('Delete "' + it.name + '" and its file?' + used)) return;
  try {
    if (playing() === it.path) stop();
    await api('/api/library/item/' + it.kind + '/' + encodeURIComponent(it.id), { method: 'DELETE' });
    refresh();
  } catch (e) { _say(e.message, true); }
}

function _about(it, anchor) {
  const pop = el('div', 'mt-pop la-about');
  pop.appendChild(el('div', 'mt-pop-head', it.name));
  const row = (k, v, href) => {
    if (!v) return;
    const r = el('div', 'la-about-row');
    r.appendChild(el('span', 'la-muted', k));
    if (href) { const a = el('a', null, v); a.href = href; a.target = '_blank'; a.rel = 'noopener'; r.appendChild(a); }
    else r.appendChild(el('span', null, v));
    pop.appendChild(r);
  };
  const i = it.info || {};
  row('length', secs(it.dur));
  row('where', it.kind === 'builtin' ? 'Built-in · ' + it.categoryLabel : it.kind === 'music' ? 'Music' : 'My sounds · ' + (it.categoryLabel || 'Uncategorized'));
  row('file', it.path, it.path);
  row('from', i.from);
  row('author', i.author, i.authorUrl || '');
  row('licence', i.license, i.licenseUrl || '');
  row('page', i.url, i.url);
  if (i.preview) row('note', 'Freesound\'s preview (~128 kbit/s) - the original needs a Freesound sign-in');
  row('credit', i.attribution);
  row('made by', i.engine ? (i.engine === 'eleven' ? 'ElevenLabs' : 'Suno') + ' · ' + i.mode : '');
  row('asked', i.prompt);
  row('style', i.style);
  if (it.original) row('cut from', it.original.name + ' · ' + it.original.in + '–' + it.original.out + ' s');
  if (it.tags && it.tags.length) row('tags', it.tags.join(', '));
  const btns = el('div', 'mt-pop-btns');
  const ok = el('button', 'mt-pop-btn', 'close');
  btns.appendChild(ok);
  pop.appendChild(btns);
  document.body.appendChild(pop);
  const r = anchor.getBoundingClientRect();
  pop.style.left = Math.max(8, Math.min(window.innerWidth - pop.offsetWidth - 8, r.left)) + 'px';
  pop.style.top = Math.max(8, Math.min(window.innerHeight - pop.offsetHeight - 8, r.bottom + 6)) + 'px';
  const layer = Layers.open(pop, { modal: true, onEsc: () => close() });
  const close = () => { pop.remove(); Layers.close(layer); };
  ok.addEventListener('click', close);
}

/**
 * Put the tree and the gallery on the page.
 * opts: { say(text, bad), cut(item), online(catId) } - the page's status line, the cut window, the online popup.
 */
export function mount(treeHost, galHost, opts) {
  const o = opts || {};
  _treeHost = treeHost;
  _galHost = galHost;
  _say = o.say || _say;
  _cutOpen = o.cut || null;
  _onlineOpen = o.online || null;
  // The playing tile is lit wherever it is drawn again.
  onChange((p) => {
    if (!_galHost) return;
    for (const t of _galHost.querySelectorAll('.la-tile')) t.classList.toggle('is-playing', !!p && t.dataset.path === p);
  });
  // Files let go on the gallery go into the open node, when it takes files.
  galHost.addEventListener('dragover', (e) => {
    const n = _find(_sel);
    if (!n || !(n.key === 'music' || _catOf(n) !== null)) return;
    if (!Array.from(e.dataTransfer.types || []).includes('Files')) return;
    e.preventDefault();
    galHost.classList.add('is-drop');
  });
  galHost.addEventListener('dragleave', (e) => { if (!galHost.contains(e.relatedTarget)) galHost.classList.remove('is-drop'); });
  galHost.addEventListener('drop', (e) => {
    galHost.classList.remove('is-drop');
    const files = Array.from(e.dataTransfer.files || []);
    if (!files.length) return;
    e.preventDefault();
    bringIn(files, _find(_sel));
  });
  return refresh();
}
