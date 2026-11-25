// THE SIDE MENU - the app's one menu: a narrow column along the window's left edge, the whole height, on every page but
// the 3D Studio's (js/app-nav.js builds it; its look is css/app-nav.css). Folded it is a column of square tiles; the
// pointer resting on it for OPEN_MS unfolds it to the right OVER the page, each tile with its word - the page never
// moves. It folds again FOLD_MS after the pointer leaves it, or at once by its top button "Collapse"; folded by that
// press with the pointer still on it, it waits for the pointer to leave before it unfolds again. A press on one of its
// things that opens something there (a list, a window, the other screen mode) folds it the same way, so the menu never
// stands over what was opened. With a mouse button held - a tile being dragged past the edge - it does not unfold.
//
// The lists its tiles open (the render queue, Alerts) stand right of the FOLDED column, their top at their tile's
// (placeBeside); the notices' corner stays at the top right (js/notice.js).

import { NAV_ICONS } from './nav-icons.js';

const OPEN_MS = 200;
const FOLD_MS = 1000;

let _nav = null;
let _openT = 0;
let _foldT = 0;
let _held = false;       // folded by a press with the pointer on it: no unfolding until it leaves

const _el = (tag, cls) => { const e = document.createElement(tag); if (cls) e.className = cls; return e; };

/** The square tile with the thing's icon, for an item of the menu. */
function _tile(kind) {
  const ico = _el('span', 'sn-ico');
  ico.insertAdjacentHTML('beforeend', NAV_ICONS[kind] || '');
  return ico;
}

/** An existing link or button made an item of the menu - its tile and its word; its own listeners, id and classes stay. */
export function dress(el, kind, label) {
  const word = _el('span', 'sn-t');
  word.textContent = label;
  el.replaceChildren(_tile(kind), word);
  el.classList.add('sn-item');
  return el;
}

/** A new item of the menu: a button (or a link, `tag` 'a'). */
export function sideItem(kind, label, tag = 'button') {
  const el = _el(tag);
  if (tag === 'button') el.type = 'button';
  return dress(el, kind, label);
}

/** A group of items; `cls` names it. */
export function sideGroup(cls) { return _el('div', 'sn-grp' + (cls ? ' ' + cls : '')); }

/** The top button: the app's sign while the menu is folded, "Collapse" in its place while it is unfolded. */
export function foldButton(label) {
  const b = sideItem('app', label);
  b.classList.add('sn-fold');
  b.querySelector('.sn-ico').insertAdjacentHTML('beforeend', NAV_ICONS.fold);
  b.setAttribute('aria-label', label);
  b.addEventListener('click', () => { if (_nav && _nav.classList.contains('is-open')) foldNow(); });
  return b;
}

function _unfold() {
  if (!_nav) return;
  _nav.classList.add('is-open');
}

/** Fold at once; with the pointer still on the menu it stays folded until the pointer leaves and comes back. */
export function foldNow() {
  clearTimeout(_openT);
  clearTimeout(_foldT);
  if (!_nav) return;
  _nav.classList.remove('is-open');
  _held = _nav.matches(':hover');
}

/** A list opened by one of the menu's tiles: right of the folded column, its top at the tile's, kept inside the window.
 *  False when `btn` is not the menu's - the list then places itself as it always has. */
export function placeBeside(btn, el) {
  if (!_nav || !btn || !_nav.contains(btn)) return false;
  const w = parseFloat(getComputedStyle(_nav).getPropertyValue('--sn-w')) || 56;
  const r = btn.getBoundingClientRect();
  // the tallest the list may grow to, so a list that fills in after it opens is not pushed past the window's foot
  const most = parseFloat(getComputedStyle(el).maxHeight);
  const h = Math.max(el.offsetHeight, Number.isFinite(most) ? most : 0);
  el.style.left = Math.round(w + 6) + 'px';
  el.style.right = 'auto';
  el.style.top = Math.round(Math.max(8, Math.min(r.top, window.innerHeight - h - 8))) + 'px';
  return true;
}

/** Start the menu's unfolding and folding on `nav` (already built with its groups). */
export function startSide(nav) {
  _nav = nav;
  nav.classList.add('is-side');
  nav.addEventListener('pointerenter', (e) => {
    clearTimeout(_foldT);
    if (_held || e.buttons) return;
    clearTimeout(_openT);
    _openT = setTimeout(_unfold, OPEN_MS);
  });
  nav.addEventListener('pointerleave', () => {
    clearTimeout(_openT);
    _held = false;
    if (nav.classList.contains('is-open')) _foldT = setTimeout(foldNow, FOLD_MS);
  });
  // A press that opens something folds the menu; a page's link leaves the page anyway.
  nav.addEventListener('click', (e) => {
    const it = e.target.closest('.sn-item');
    if (it && !it.classList.contains('sn-fold')) foldNow();
  });
}
