// THE PLACE PICKER (phase V39, the owner 2026-10-24: "когда пользователь нажимает CUT показывать деревом со
// сворачиванием категорий. и в "move to" тоже - и чтобы основные категории были свернуты, а не полным списком
// показывались"). ONE small window for both: "save the piece to" after a stretch is chosen in any video (js/cut.js) and
// "move to…" of a REFERENCES post (js/references/post.js). Its rows wear the media tree's look (css/media-tree.css
// .mt-row) and do nothing else - no "+", ✕, menu or rename:
//
//   - everything is folded each time it opens, nothing is remembered (the owner's (о1));
//   - ▸, or a press on a branch that is not a place itself, opens or folds it;
//   - a press on a place picks it: the window closes and the caller gets { kind, cat, label, text };
//   - "+ new folder…" is the last row of a kind's branch and of every folder's (phase V54, (зв44)): the name asked, the
//     folder made there (POST /api/library/cats with its `parent` - a name that exists there gives that one), and that is
//     the place;
//   - where the thing is now: a row on top ("BESIDE IT"), marked in the tree too (.is-here);
//   - a place that cannot take it is grey, why in its tooltip - and so is a branch whose every place cannot.
//
// The places are js/media-targets.js placesOf; one window at a time.

import * as Layers from './layers.js';
import { placesOf } from './media-targets.js';
import { askName } from './name-box.js';

const KIND_WORD = { references: 'REFERENCES', uploads: 'Uploads', birols: 'B-rolls', hooks: 'Hooks', images: 'IMAGES', sounds: 'My sounds', music: 'Music' };
const LOCK_SVG = '<svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true"><path fill="currentColor" d="M8 1a3.5 3.5 0 0 0-3.5 3.5V7H4a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1h-.5V4.5A3.5 3.5 0 0 0 8 1zm-2 6V4.5a2 2 0 1 1 4 0V7H6z"/></svg>';

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

let _open = null;      // { box, layer, away }

export function closePlaces() {
  if (!_open) return;
  const o = _open;
  _open = null;
  o.box.remove();
  Layers.close(o.layer);
  document.removeEventListener('mousedown', o.away, true);
}

/**
 * Open the window by `anchor`.
 *   o.title        its first line
 *   o.tree         the media tree's nodes (GET /api/library/tree)
 *   o.places       placesOf's options { images, refHome, newCats }
 *   o.here         { kind, cat } - where the thing is now (a row on top), or null
 *   o.why(to)      why a place cannot take it ('' - it can)
 *   o.above        open above the anchor while there is room (else below it)
 *   o.alignRight   right edges together (else left edges)
 *   o.cls          a class of the caller's for the window
 *   o.name         its layer's name
 *   o.onPick(to)   a place chosen - the window is closed already
 */
export function openPlaces(anchor, o) {
  closePlaces();
  const opt = o || {};
  const why = typeof opt.why === 'function' ? opt.why : () => '';
  const roots = placesOf(opt.tree || [], opt.places);
  const here = opt.here || null;
  const isHere = (to) => !!(here && to && to.kind === here.kind && (to.cat || '') === (here.cat || ''));

  // Every node by its key; why each cannot be pressed to pick (a branch with no place of its own: when all its places
  // cannot take it - "+ new category…" always can); the place the thing is in now.
  const byKey = new Map();
  const off = new Map();
  let hereNode = null;
  const mark = (p) => {
    byKey.set(p.key, p);
    if (p.newIn) return [''];
    const own = p.to ? [why(p.to) || ''] : [];
    if (p.to && !hereNode && isHere(p.to)) hereNode = p;
    const below = [];
    for (const c of p.children || []) below.push(...mark(c));
    const no = p.to ? own[0] : (below.length && below.every(Boolean) ? below[0] : '');
    if (no) off.set(p.key, no);
    return own.concat(below);
  };
  roots.forEach(mark);

  const open = new Set();
  const box = el('div', 'ref-move mtp-box u-menu is-float' + (opt.cls ? ' ' + opt.cls : ''));
  box.appendChild(el('div', 'ref-move-title', opt.title || 'Where to?'));
  const list = el('div', 'ref-move-list mt mtp');
  list.setAttribute('role', 'tree');
  box.appendChild(list);

  function row(p, depth, top) {
    const has = !top && !!(p.children && p.children.length);
    const no = off.get(p.key) || '';
    const b = el('button', 'mt-row mtp-row' + (depth === 0 && !top ? ' is-group' : '') + (p.to ? ' is-place' : '')
      + (p.newIn ? ' is-newcat' : '') + (p.to && isHere(p.to) ? ' is-here' : '') + (no ? ' is-off' : ''));
    b.type = 'button';
    b.dataset.key = p.key;
    b.dataset.depth = String(depth);
    if (top) b.dataset.top = '1';
    b.setAttribute('role', 'treeitem');
    if (has) b.setAttribute('aria-expanded', open.has(p.key) ? 'true' : 'false');
    if (no) b.setAttribute('aria-disabled', 'true');
    b.style.paddingLeft = (3 + depth * 11) + 'px';
    const tw = el('span', 'mt-tw' + (has && open.has(p.key) ? ' is-open' : ''), has ? '▸' : '');
    if (has) {
      tw.title = open.has(p.key) ? 'Fold' : 'Open';
      tw.addEventListener('click', (e) => { e.stopPropagation(); if (e.detail < 2) toggle(p.key); });
    }
    b.appendChild(tw);
    b.appendChild(el('span', 'mt-name', top ? p.to.text : p.label));
    if (p.locked && !top) {
      const lock = el('span', 'mt-lock');
      lock.innerHTML = LOCK_SVG;
      b.appendChild(lock);
    }
    if (!top && !p.newIn && p.count != null) b.appendChild(el('span', 'mt-n', String(p.count)));
    b.title = no || (p.newIn ? 'Make a new folder in ' + (p.newIn.label || KIND_WORD[p.newIn.kind] || p.newIn.kind) + ' - and that is the place'
      : p.to ? p.to.text : (open.has(p.key) ? 'Fold ' : 'Open ') + p.label);
    // The second press of a double one (the media tree's way to open a branch) does nothing: it would fold what the first
    // opened, or pick a row that came under the pointer.
    b.addEventListener('click', (e) => {
      if (e.detail > 1) return;
      if (p.newIn) { _newFolder(p.newIn, b); return; }
      if (p.to && !no) { closePlaces(); opt.onPick(p.to); return; }
      if (has) toggle(p.key);
    });
    return b;
  }

  function paint() {
    const top = list.scrollTop;
    list.textContent = '';
    if (hereNode) {
      list.appendChild(el('div', 'ref-move-head', 'BESIDE IT'));
      list.appendChild(row(hereNode, 0, true));
      list.appendChild(el('div', 'mtp-sep'));
    }
    const walk = (p, d) => {
      list.appendChild(row(p, d));
      if (p.children && open.has(p.key)) for (const c of p.children) walk(c, d + 1);
    };
    roots.forEach(p => walk(p, 0));
    list.scrollTop = top;
  }

  // Opened: what came out under it is scrolled into sight, the branch's own row kept in sight first.
  function toggle(key) {
    const opening = !open.has(key);
    if (opening) open.add(key); else open.delete(key);
    paint();
    if (!opening) return;
    const rows = [...list.querySelectorAll('.mtp-row:not([data-top])')];
    const i = rows.findIndex(r => r.dataset.key === key);
    if (i < 0) return;
    const d = +rows[i].dataset.depth;
    let j = i;
    while (j + 1 < rows.length && +rows[j + 1].dataset.depth > d) j++;
    const from = rows[i].offsetTop, to = rows[j].offsetTop + rows[j].offsetHeight;
    if (to > list.scrollTop + list.clientHeight) list.scrollTop = Math.min(from, to - list.clientHeight);
  }

  async function _newFolder(at, b) {
    const kind = at.kind;
    const cat = await askName({
      anchor: b, title: 'New folder in ' + (at.label || KIND_WORD[kind] || kind), okLabel: 'Create', maxLength: 60,
      submit: async (name) => {
        const r = await fetch('/api/library/cats', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ kind, label: name, parent: at.parent || '' }) }).then(x => x.json());
        if (!r || !r.success) throw new Error((r && r.error) || 'not made');
        return r.cat;
      },
    });
    if (!cat) return;
    closePlaces();
    opt.onPick({ kind, cat: cat.id, label: cat.label, text: cat.label });
  }

  paint();
  document.body.appendChild(box);
  const above = _place(box, anchor, opt);
  // Above the anchor the window would grow upwards as branches open, moving the rows under the pointer: its height is
  // reserved now - as tall as everything opened would be, as far as there is room.
  if (above) {
    const room = parseFloat(box.style.maxHeight) || 460;
    for (const [k, p] of byKey) if (p.children) open.add(k);
    paint();
    box.style.maxHeight = 'none';
    const full = box.offsetHeight;
    open.clear();
    paint();
    box.style.maxHeight = room + 'px';
    box.style.height = Math.min(full, room) + 'px';
  }
  const away = (e) => {
    if (box.contains(e.target) || anchor.contains(e.target) || (e.target.closest && e.target.closest('.nm-box'))) return;
    closePlaces();
  };
  document.addEventListener('mousedown', away, true);
  _open = { box, away, layer: Layers.open(box, { name: opt.name || 'places', onEsc: closePlaces }) };
}

// By the anchor, on the side asked for while there is room for a good part of the tree, never past the screen - then its
// list scrolls. Below the anchor the window grows downwards as branches open. -> whether it is above.
function _place(box, anchor, o) {
  const r = anchor.getBoundingClientRect();
  const W = window.innerWidth, H = window.innerHeight, M = 8, G = 6;
  const upRoom = r.top - G - M, downRoom = H - r.bottom - G - M;
  const up = o.above ? (upRoom >= 260 || upRoom >= downRoom) : !(downRoom >= 260 || downRoom >= upRoom);
  box.style.maxHeight = Math.round(Math.max(140, Math.min(460, up ? upRoom : downRoom))) + 'px';
  const bw = box.offsetWidth;
  box.style.left = Math.round(Math.max(M, Math.min(o.alignRight ? r.right - bw : r.left, W - bw - M))) + 'px';
  if (up) { box.style.top = 'auto'; box.style.bottom = Math.round(H - r.top + G) + 'px'; }
  else { box.style.bottom = 'auto'; box.style.top = Math.round(r.bottom + G) + 'px'; }
  return up;
}
