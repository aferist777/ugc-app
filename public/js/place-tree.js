// THE PLACE PICKER - a folded tree. ONE small window for both: "save the piece to" after a stretch is chosen in any video (js/cut.js) and
// "move to…" of a REFERENCES post (js/references/post.js). Its rows wear the media tree's look (css/media-tree.css
// .mt-row) and do nothing else - no "+", ✕, menu or rename:
//
//   - everything is folded each time it opens, nothing is remembered;
//   - ▸, or a press on a branch that is not a place itself, opens or folds it;
//   - a press on a place picks it: the window closes and the caller gets { kind, cat, label, text } - or, with `confirm`
//     (the cut's "save the pieces to"), it is only CHOSEN (lit, its path at the foot) and the
//     foot's button picks it;
//   - "+" at the right of a kind's row and of every folder's that can hold a new folder: the name asked, the folder made there (POST /api/library/cats with its `parent` - a name that exists there gives that
//     one), and that is the place - with `confirm` it is chosen, shown in its branch;
//   - where the thing is now: a row on top ("Beside it"), marked in the tree too (.is-here);
//   - a place that cannot take it is grey, why in its tooltip - and so is a branch whose every place cannot.
//
// The places are js/media-targets.js placesOf; one window at a time.

import * as Layers from './layers.js';
import { placesOf } from './media-targets.js';
import { askName } from './name-box.js';
import * as T from './i18n/t.js';

const KIND_WORD = { references: T.t('REFERENCES'), uploads: T.t('Uploads'), birols: T.t('B-rolls'), hooks: T.t('Hooks'), images: T.t('IMAGES'),
  sounds: T.t('My sounds'), music: T.t('Music') };
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
 *   o.confirm      the foot's button (`'Save here'`): a press on a place only chooses it, the button picks
 *   o.onPick(to)   a place picked - the window is closed already
 */
export function openPlaces(anchor, o) {
  closePlaces();
  const opt = o || {};
  const why = typeof opt.why === 'function' ? opt.why : () => '';
  const roots = placesOf(opt.tree || [], opt.places);
  const here = opt.here || null;
  const isHere = (to) => !!(here && to && to.kind === here.kind && (to.cat || '') === (here.cat || ''));

  // Every node by its key; why each cannot be pressed to pick (a branch with no place of its own: when all its places
  // cannot take it - a `newIn` child, the "+", always can); the place the thing is in now.
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
  let chosen = null;                 // { to, key } - with `confirm`: the place chosen, not yet picked
  const box = el('div', 'ref-move mtp-box u-menu is-float' + (opt.cls ? ' ' + opt.cls : ''));
  box.appendChild(el('div', 'ref-move-title', opt.title || T.t('Where to?')));
  const list = el('div', 'ref-move-list mt mtp');
  list.setAttribute('role', 'tree');
  box.appendChild(list);
  // With `confirm`: the foot - the place chosen, in words, and the button that picks it.
  let footText = null, footGo = null;
  if (opt.confirm) {
    const foot = el('div', 'mtp-foot');
    footText = el('span', 'mtp-chosen', T.t('Choose a folder'));
    footGo = el('button', 'u-btn is-s is-main', opt.confirm);
    footGo.type = 'button';
    footGo.disabled = true;
    footGo.addEventListener('click', () => { if (!chosen) return; const to = chosen.to; closePlaces(); opt.onPick(to); });
    foot.append(footText, footGo);
    box.appendChild(foot);
  }
  const choose = (p) => {
    chosen = { to: p.to, key: p.key };
    if (footText) { footText.textContent = p.to.text || p.to.label || ''; footText.title = footText.textContent; }
    if (footGo) footGo.disabled = false;
    paint();
  };
  // The folders a row holds besides its "+" (a `newIn` child is the row's "+", never a row of its own).
  const kidsOf = (p) => (p.children || []).filter(c => !c.newIn);
  const addOf = (p) => (p.children || []).find(c => c.newIn) || null;

  function row(p, depth, top) {
    const has = !top && kidsOf(p).length > 0;
    const no = off.get(p.key) || '';
    const b = el('button', 'mt-row mtp-row' + (depth === 0 && !top ? ' is-group' : '') + (p.to ? ' is-place' : '')
      + (p.to && isHere(p.to) ? ' is-here' : '') + (no ? ' is-off' : '')
      + (chosen && p.to && chosen.to.kind === p.to.kind && (chosen.to.cat || '') === (p.to.cat || '') ? ' is-sel' : ''));
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
      tw.title = open.has(p.key) ? T.t('Fold') : T.t('Open');
      tw.addEventListener('click', (e) => { e.stopPropagation(); if (e.detail < 2) toggle(p.key); });
    }
    b.appendChild(tw);
    b.appendChild(el('span', 'mt-name', top ? p.to.text : p.label));
    // The count in brackets right after the name, the lock at the right edge - the media tree's way.
    if (!top && !p.newIn && p.count != null) b.appendChild(el('span', 'mt-n', '(' + p.count + ')'));
    if (p.locked && !top) {
      const lock = el('span', 'mt-lock');
      lock.innerHTML = LOCK_SVG;
      b.appendChild(lock);
    }
    // "+": a new folder in this one.
    const add = top ? null : addOf(p);
    if (add) {
      const plus = el('span', 'mtp-add', '+');
      plus.setAttribute('role', 'button');
      plus.title = T.t('New folder in {place}', { place: add.newIn.label || KIND_WORD[add.newIn.kind] || add.newIn.kind });
      plus.addEventListener('click', (e) => { e.stopPropagation(); if (e.detail < 2) _newFolder(add.newIn, plus, p); });
      b.appendChild(plus);
    }
    b.title = no || (p.to ? p.to.text : (open.has(p.key) ? T.t('Fold {name}', { name: p.label }) : T.t('Open {name}', { name: p.label })));
    // The second press of a double one (the media tree's way to open a branch) does nothing: it would fold what the first
    // opened, or pick a row that came under the pointer.
    b.addEventListener('click', (e) => {
      if (e.detail > 1) return;
      if (p.to && !no) {
        if (opt.confirm) { choose(p); return; }
        closePlaces(); opt.onPick(p.to); return;
      }
      if (has) toggle(p.key);
    });
    return b;
  }

  function paint() {
    const top = list.scrollTop;
    list.textContent = '';
    if (hereNode) {
      list.appendChild(el('div', 'ref-move-head', T.t('Beside it')));
      list.appendChild(row(hereNode, 0, true));
      list.appendChild(el('div', 'mtp-sep'));
    }
    const walk = (p, d) => {
      list.appendChild(row(p, d));
      if (open.has(p.key)) for (const c of kidsOf(p)) walk(c, d + 1);
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

  async function _newFolder(at, b, parentNode) {
    const kind = at.kind;
    const cat = await askName({
      anchor: b, title: T.t('New folder in {place}', { place: at.label || KIND_WORD[kind] || kind }), okLabel: T.t('Create'), maxLength: 60,
      submit: async (name) => {
        const r = await fetch('/api/library/cats', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ kind, label: name, parent: at.parent || '' }) }).then(x => x.json());
        if (!r || !r.success) throw new Error((r && r.error) || T.t('not made'));
        return r.cat;
      },
    });
    if (!cat) return;
    const to = { kind, cat: cat.id, label: cat.label, text: ((parentNode && (parentNode.to ? parentNode.to.text : parentNode.label)) || KIND_WORD[kind] || kind) + ' · ' + cat.label };
    if (!opt.confirm) { closePlaces(); opt.onPick(to); return; }
    // Chosen, and shown where it was made: a row of its own in the opened branch.
    if (parentNode) {
      const node = { key: 'made:' + kind + ':' + cat.id, label: cat.label, count: 0, locked: false, to,
        children: [{ key: 'new:made:' + cat.id, label: '+', newIn: { kind, parent: cat.id, label: cat.label } }] };
      if (!(parentNode.children || []).some(c => c.to && c.to.kind === kind && c.to.cat === cat.id)) {
        parentNode.children = parentNode.children || [];
        const at2 = parentNode.children.findIndex(c => c.newIn);
        parentNode.children.splice(at2 < 0 ? parentNode.children.length : at2, 0, node);
        byKey.set(node.key, node);
      }
      open.add(parentNode.key);
      choose((parentNode.children || []).find(c => c.to && c.to.kind === kind && c.to.cat === cat.id) || node);
    } else choose({ key: 'made:' + cat.id, to });
  }

  paint();
  document.body.appendChild(box);
  const above = _place(box, anchor, opt);
  // Above the anchor the window would grow upwards as branches open, moving the rows under the pointer: its height is
  // reserved now - as tall as everything opened would be, as far as there is room.
  if (above) {
    const room = parseFloat(box.style.maxHeight) || 460;
    for (const [k, p] of byKey) if (kidsOf(p).length) open.add(k);
    paint();
    box.style.maxHeight = 'none';
    const full = box.offsetHeight;
    open.clear();
    paint();
    box.style.maxHeight = room + 'px';
    box.style.height = Math.min(full, room) + 'px';
  }
  const away = (e) => {
    if (box.contains(e.target) || anchor.contains(e.target) || (e.target.closest && e.target.closest('.nm-box, .bub'))) return;
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
