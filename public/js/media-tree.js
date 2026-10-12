/* ═══════════════════════════════════════════════════════════════════════════
   THE MEDIA TREE (phase V28.4 + V28.5, the owner 2026-10-12) - one module for both places that show the library's
   media: Merge's Library panel (js/merge-v3/library.js) and the Library's Media shelf (js/library/main.js). The
   gallery is on the left, this tree on the right:

     Video   -> B-rolls, Hooks, Uploads -> their categories
     Images  -> its categories
     Audio   -> Music, SFX -> categories

   It is read in one answer (GET /api/library/tree, routes/library.js _tree): every node { key, label, count, q, kind?,
   cat?, locked?, empty?, uncat?, children? }. Pressing a node SELECTS it and the page shows everything under it
   (`q` is what the shelf is asked: a group, or a kind and a category). Branches open by their ▸ (the owner) and what
   is open is remembered, so is the node selected - per page.

   CATEGORIES, both ways the owner asked for: the chips' gestures - "+" on a kind's row makes one, a double press on
   its name renames it, the ✕ on hover deletes it (the media moved to Uncategorized, or deleted with them - then the
   projects using them are named), pressing and dragging puts it in another place - and the same three in a menu
   under the right button. A REQUIRED category (lib/library-cats.js REQUIRED) carries a lock: never renamed, deleted
   or moved, and always first. An EMPTY one is pale and last (the server orders them).

   A TILE LET GO ON A NODE: on a category of its kind - filed under it; on Uncategorized - its category taken off; on
   another kind of video (or one of its categories) - moved to that kind. A picture never becomes a clip, nor a clip
   a picture. A tile says what it is with setMediaDrag(); the kind rides in a type of its own, the only part of a
   drag a page can read before the drop.
   ═══════════════════════════════════════════════════════════════════════════ */

import * as A from './library/actions.js';
import * as Layers from './layers.js';
import { askName } from './name-box.js';

export const MEDIA_DRAG = 'application/x-ugc-media';
const KIND_TYPE = 'application/x-ugc-kind-';
const UNCAT = '__uncat__';
const VIDEO = new Set(['birols', 'hooks', 'uploads']);
const CATABLE = new Set(['birols', 'hooks', 'uploads', 'images', 'sounds']);
const NOUN = { birols: 'clip', hooks: 'clip', uploads: 'clip', images: 'picture', sounds: 'sound', music: 'track' };
const DRAG_SLOP = 4;

const _plural = (n, word) => n + ' ' + word + (n === 1 ? '' : 's');

/** A tile being dragged says what it is - for a tree's node to take it. `it` is a shelf item. */
export function setMediaDrag(dt, it) {
  if (!dt || !it || !it.kind) return;
  dt.setData(MEDIA_DRAG, JSON.stringify({ kind: it.kind, id: String(it.id), name: it.name || '', cat: (it.meta && it.meta.categoryId) || '' }));
  dt.setData(KIND_TYPE + it.kind, '1');
}

function _dragKind(dt) {
  const t = Array.from((dt && dt.types) || []).find(x => x.startsWith(KIND_TYPE));
  return t ? t.slice(KIND_TYPE.length) : '';
}

// What letting an item of kind `from` go on a node does: 'cat' (file it there), 'kind' (another kind of video), or ''.
function _dropAction(n, from) {
  if (!n || !n.kind || !from) return '';
  if (n.kind === from) return n.cat ? 'cat' : '';
  if (VIDEO.has(n.kind) && VIDEO.has(from)) return 'kind';
  return '';
}

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

const LOCK_SVG = '<svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true"><path fill="currentColor" d="M8 1a3.5 3.5 0 0 0-3.5 3.5V7H4a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1h-.5V4.5A3.5 3.5 0 0 0 8 1zm-2 6V4.5a2 2 0 1 1 4 0V7H6z"/></svg>';

/**
 * Build a tree in `host`.
 *   o.page        'mv3' | 'lib' - what it remembers is kept under this
 *   o.fallback    the node selected when none is remembered
 *   o.status(text, bad)   say something
 *   o.onSelect(node)      a node was chosen (also once the first read lands)
 *   o.onChanged(what)     the library changed from here (a category made, renamed, deleted; a tile moved) - read the
 *                         gallery again; the tree reads itself again
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
  let suppressClick = false;
  let loaded = false;       // the first answer has been painted

  const el = _el('div', 'mt');
  el.setAttribute('role', 'tree');
  host.appendChild(el);

  function _index(list, parent) {
    for (const n of list) {
      byKey.set(n.key, n);
      if (parent) parentOf.set(n.key, parent.key);
      if (n.children) _index(n.children, n);
    }
  }

  async function load() {
    let d;
    try { d = await fetch('/api/library/tree').then(r => r.json()); }
    catch (e) { opt.status('Could not read the media tree: ' + e.message, true); return nodes; }
    if (!d || !d.success) { opt.status((d && d.error) || 'Could not read the media tree', true); return nodes; }
    nodes = d.nodes || [];
    byKey.clear(); parentOf.clear();
    _index(nodes, null);
    // A remembered node that is not there any more (a category deleted, renamed elsewhere): its kind, else the fallback -
    // and the page is told, once it has had its first answer (it reads the gallery for the first one itself).
    const before = sel;
    if (!byKey.has(sel)) {
      const kind = String(sel).split(':')[0];
      sel = byKey.has(kind) ? kind : (byKey.has(opt.fallback) ? opt.fallback : ((nodes[0] || {}).key || ''));
      _lsSet(K_SEL, sel);
    }
    _openTo(sel);
    paint();
    if (loaded && sel !== before && byKey.has(sel)) opt.onSelect(byKey.get(sel));
    loaded = true;
    return nodes;
  }

  function _openTo(key) {
    let p = parentOf.get(key);
    let changed = false;
    while (p) { if (!open.has(p)) { open.add(p); changed = true; } p = parentOf.get(p); }
    if (changed) _lsSet(K_OPEN, [...open]);
    return changed;
  }

  // The selection moved, nothing opened: the rows stay - a double press on a name must find the row it began on.
  function _mark() {
    for (const r of el.querySelectorAll('.mt-row')) r.classList.toggle('is-sel', r.dataset.key === sel);
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
    const isGroup = !n.kind;
    const isCat = !!n.cat && !n.uncat;
    const row = _el('div', 'mt-row' + (isGroup ? ' is-group' : '') + (n.key === sel ? ' is-sel' : '')
      + (n.empty ? ' is-empty' : '') + (n.locked ? ' is-locked' : '') + (isCat ? ' is-cat' : ''));
    row.dataset.key = n.key;
    row.setAttribute('role', 'treeitem');
    row.style.paddingLeft = (4 + depth * 13) + 'px';
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
    name.title = n.locked ? n.label + ' - required: it cannot be renamed or deleted'
      : n.empty ? n.label + ' - empty' : n.label;
    row.appendChild(name);
    if (n.locked) {
      const lock = _el('span', 'mt-lock');
      lock.innerHTML = LOCK_SVG;
      lock.title = 'Required - it cannot be renamed or deleted';
      row.appendChild(lock);
    }
    // A kind that can have categories: "+" makes one.
    if (n.kind && !n.cat && CATABLE.has(n.kind)) {
      const add = _el('button', 'mt-act mt-add', '+');
      add.type = 'button';
      add.tabIndex = -1;
      add.title = 'New ' + (n.label || n.kind) + ' category';
      add.addEventListener('click', (e) => { e.stopPropagation(); _newCat(n, add); });
      row.appendChild(add);
    }
    if (isCat && n.own && !n.locked) {
      const x = _el('button', 'mt-act mt-x', '✕');
      x.type = 'button';
      x.tabIndex = -1;
      x.title = 'Delete this category';
      x.addEventListener('mousedown', (e) => e.stopPropagation());
      x.addEventListener('click', (e) => { e.stopPropagation(); _askDelete(n, row); });
      row.appendChild(x);
    }
    row.appendChild(_el('span', 'mt-n', String(n.count || 0)));

    row.addEventListener('click', () => {
      if (suppressClick) { suppressClick = false; return; }
      select(n.key, true);
    });
    if (isCat && n.own && !n.locked) {
      name.addEventListener('dblclick', (e) => { e.stopPropagation(); _rename(n, row); });
      _wireReorder(row, n);
    }
    row.addEventListener('contextmenu', (e) => { e.preventDefault(); _menu(n, row, e.clientX, e.clientY); });

    // A tile let go here.
    row.addEventListener('dragover', (e) => {
      if (!_dropAction(n, _dragKind(e.dataTransfer))) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
      row.classList.add('is-drop');
    });
    row.addEventListener('dragleave', () => row.classList.remove('is-drop'));
    row.addEventListener('drop', (e) => {
      row.classList.remove('is-drop');
      if (!_dropAction(n, _dragKind(e.dataTransfer))) return;
      e.preventDefault();
      e.stopPropagation();
      let it = null;
      try { it = JSON.parse(e.dataTransfer.getData(MEDIA_DRAG)); } catch (err) { return; }
      if (it) _take(n, it);
    });
    return row;
  }

  function toggle(key) {
    if (open.has(key)) open.delete(key); else open.add(key);
    _lsSet(K_OPEN, [...open]);
    paint();
  }

  function select(key, fire) {
    if (!byKey.has(key)) return;
    sel = key;
    _lsSet(K_SEL, sel);
    if (_openTo(key)) paint(); else _mark();
    const row = el.querySelector('.mt-row.is-sel');
    if (row) row.scrollIntoView({ block: 'nearest' });
    if (fire) opt.onSelect(byKey.get(key));
  }

  function selectFor(kind, cat, fire = true) {
    const want = cat ? kind + ':' + cat : kind;
    select(byKey.has(want) ? want : kind, fire);
  }

  const kindLabel = (kind) => ((byKey.get(kind) || {}).label) || kind;

  async function _after(msg, what) {
    await load();
    opt.onChanged(what || {});
    if (msg) opt.status(msg);
  }

  // ── A tile let go on a node ──
  async function _take(n, it) {
    const act = _dropAction(n, it.kind);
    const catId = n.cat && n.cat !== UNCAT ? n.cat : '';
    const catName = catId ? (n.name || n.label) : '';
    const item = { kind: it.kind, id: it.id, meta: { categoryId: it.cat || '' } };
    try {
      if (act === 'cat') {
        if ((it.cat || '') === catId) return;
        await A.setCategory(item, catId, catName);
        await _after('"' + (it.name || 'It') + '" is in ' + (catId ? n.label : 'Uncategorized'), { moved: it });
      } else if (act === 'kind') {
        // Off its own kind's category first: a category is one kind's, and kept across it would come back as a stray.
        if (it.cat) await A.setCategory(item, '', '');
        await A.setKind(item, n.kind);
        if (catId) await A.setCategory({ kind: n.kind, id: it.id }, catId, catName);
        await _after('"' + (it.name || 'It') + '" moved to ' + kindLabel(n.kind) + (catId ? ' · ' + n.label : ''), { moved: it });
      }
    } catch (e) { opt.status('Could not move it: ' + e.message, true); await load(); }
  }

  // ── Categories ──
  function _siblingCats(kind) {
    const k = byKey.get(kind);
    return ((k && k.children) || []).filter(c => c.cat && !c.uncat);
  }

  async function _newCat(n, anchor) {
    const kind = n.kind;
    const cat = await askName({
      anchor, title: 'New ' + (n.label || kind) + ' category', okLabel: 'Create', maxLength: 60,
      check: (name) => {
        const taken = _siblingCats(kind).find(c => String(c.name || c.label).toLowerCase() === name.toLowerCase());
        return taken ? 'There is already a category called ' + taken.label + '.' : '';
      },
      submit: async (name) => (await A.addCat(kind, name)).cat,
    });
    if (!cat) return;
    open.add(kind);
    _lsSet(K_OPEN, [...open]);
    await _after('Made the category "' + cat.label + '"', { cats: kind });
  }

  async function _rename(n, anchor) {
    const next = await askName({
      anchor, title: 'Rename category', value: n.name || n.label, okLabel: 'Rename', maxLength: 60,
      check: (name) => {
        const taken = _siblingCats(n.kind).find(c => c.key !== n.key && String(c.name || c.label).toLowerCase() === name.toLowerCase());
        return taken ? 'There is already a category called ' + taken.label + '.' : '';
      },
      submit: async (name) => {
        if (name === (n.name || n.label)) return null;
        return (await A.renameCat(n.kind, n.cat, name)).cat;
      },
    });
    if (!next) return;
    await _after('Renamed to "' + next.label + '"', { cats: n.kind });
  }

  // Delete: the media to Uncategorized (the safe one, chosen), or deleted with it - and then the projects using them
  // are named (lib/timeline-media.js usage): there they turn red.
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
    box.appendChild(_el('div', 'mt-pop-head', 'Delete "' + n.label + '"?'));
    const lab = _el('label', 'mt-pop-row');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = true;                       // the safe branch is the default
    lab.appendChild(cb);
    lab.appendChild(_el('span', null, count ? 'Move its ' + _plural(count, noun) + ' to Uncategorized' : 'Nothing in it to move'));
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
      const keep = cb.checked || !count;
      note.textContent = keep ? 'The ' + noun + 's stay on the disk.' : 'Its ' + _plural(count, noun) + ' will be deleted from the disk. This cannot be undone.';
      go.textContent = keep ? 'Delete category' : 'Delete category and ' + _plural(count, noun);
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
    const layer = Layers.open(box, { modal: false, name: 'delete a category', onEsc: _closePop });
    _pop = { el: box, away, layer };
    document.addEventListener('mousedown', away, true);
    cancel.addEventListener('click', _closePop);
    go.addEventListener('click', async () => {
      const mode = (cb.checked || !count) ? 'move' : 'delete';
      go.disabled = true; cancel.disabled = true;
      try {
        const d = await A.deleteCat(n.kind, n.cat, mode);
        _closePop();
        const msg = d.mode === 'delete'
          ? 'Deleted the category and ' + _plural(d.affected || 0, noun)
          : 'Deleted the category' + (d.affected ? '; ' + _plural(d.affected, noun) + ' moved to Uncategorized' : '');
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
    const kindNode = n.kind && !n.cat && CATABLE.has(n.kind) ? n : (n.cat ? byKey.get(n.kind) : null);
    if (kindNode && CATABLE.has(kindNode.kind)) items.push(['New category', 'in ' + kindNode.label, () => _newCat(kindNode, row)]);
    if (n.cat && !n.uncat) {
      if (n.locked) items.push(['Required', 'it cannot be renamed or deleted', null]);
      else if (n.own) {
        items.push(['Rename', n.label, () => _rename(n, row)]);
        items.push(['Delete', 'the category - its media stay, or go with it', () => _askDelete(n, row)]);
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
    const layer = Layers.open(m, { modal: false, name: 'category menu', onEsc: _closeMenu });
    _m = { el: m, away, layer };
    document.addEventListener('mousedown', away, true);
    window.addEventListener('scroll', _closeMenu, true);
  }

  // ── Another place for a category: press it and drag ──
  // Among its kind's own categories (never above the required ones, which are always first). The server keeps the
  // empty ones last whatever the order says.
  function _wireReorder(row, n) {
    row.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      const y0 = e.clientY;
      let moving = false;
      const move = (ev) => {
        if (!moving) {
          if (Math.abs(ev.clientY - y0) < DRAG_SLOP) return;
          moving = true;
          row.classList.add('is-moving');
          el.classList.add('is-reordering');
        }
        const over = document.elementFromPoint(ev.clientX, ev.clientY);
        const target = over && over.closest ? over.closest('.mt-row.is-cat') : null;
        if (!target || target === row || target.parentElement !== el) return;
        const tn = byKey.get(target.dataset.key);
        if (!tn || tn.kind !== n.kind || tn.locked || !tn.own) return;
        const r = target.getBoundingClientRect();
        el.insertBefore(row, ev.clientY > r.top + r.height / 2 ? target.nextSibling : target);
      };
      const up = async () => {
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
        if (!moving) return;
        row.classList.remove('is-moving');
        el.classList.remove('is-reordering');
        suppressClick = true;
        setTimeout(() => { suppressClick = false; }, 0);
        const ids = [...el.querySelectorAll('.mt-row.is-cat')]
          .map(r => byKey.get(r.dataset.key)).filter(c => c && c.kind === n.kind && c.own && !c.locked).map(c => c.cat);
        const locked = _siblingCats(n.kind).filter(c => c.locked).map(c => c.cat);
        try {
          await A.setCatOrder(n.kind, locked.concat(ids));
          await _after('Order saved', { cats: n.kind });
        } catch (err) { opt.status(err.message, true); await load(); }
      };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    });
  }

  return {
    el, load, select, selectFor, kindLabel,
    selected: () => byKey.get(sel) || null,
    node: (key) => byKey.get(key) || null,
  };
}
