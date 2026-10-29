/* ═══════════════════════════════════════════════════════════════════════════
   THE "?" OF A PARAMETER (phase V60, the owner 2026-10-29: "добавь символы вопросиков справа от названий параметров при
   наведении на которые показываем всплывашки с инструкциями и описанием"; (пп10а), (пп11а)) - ONE rule for Merge's
   "/ generate audio" and the Library's music window, the form they share (js/sound/suno-form.js) and the almanac.

   A small "?" right of a parameter's name. The pointer resting on it opens a popup - what the parameter is and how to use
   it, where the grey notes under the rows and the ♪ block of the gold card used to be -, and the popup goes once the
   pointer has left both the "?" and the popup (it may be moved into it to read). One popup at a time; it is on the stack
   of layers (js/layers.js) - Escape closes it -, and a press anywhere or a scroll closes it too. A press on the "?" itself
   does nothing else: inside a button, a <summary> or a <label> it neither folds, unfolds nor ticks.

     qmark(text, o)        the "?" - `text` a string (paragraphs by "\n") or a function giving one when it opens;
                           o.title - the popup's gold heading
     withQ(node, text, o)  the "?" put at the end of `node` (a row's name); node returned
     closeQ()              the popup open, closed
   ═══════════════════════════════════════════════════════════════════════════ */

import * as Layers from '../layers.js';

const OPEN_MS = 90;          // the pointer resting this long on a "?" opens it - a sweep across the column opens nothing
const SHUT_MS = 160;         // ...and gone this long from the "?" and the popup closes it

let _open = null;            // { box, anchor, layer }
let _openT = 0;
let _shutT = 0;

const _el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

export function closeQ() {
  clearTimeout(_openT);
  clearTimeout(_shutT);
  if (!_open) return;
  const o = _open;
  _open = null;
  o.box.remove();
  if (o.anchor.isConnected) o.anchor.classList.remove('is-on');
  Layers.close(o.layer);
  document.removeEventListener('mousemove', _onMove, true);
  document.removeEventListener('mousedown', _onDown, true);
  window.removeEventListener('scroll', _onScroll, true);
  window.removeEventListener('blur', closeQ);
}

// While a popup is open the pointer is followed: over the "?" or the popup it stays, anywhere else it goes a moment later -
// also when the "?" was painted away under the pointer (no mouseleave comes from a node taken out of the page).
function _onMove(e) {
  if (!_open) return;
  const over = _open.box.contains(e.target) || (_open.anchor.isConnected && _open.anchor.contains(e.target));
  if (over) { clearTimeout(_shutT); _shutT = 0; return; }
  if (!_shutT) _shutT = setTimeout(closeQ, SHUT_MS);
}
function _onDown(e) { if (_open && !_open.box.contains(e.target)) closeQ(); }
function _onScroll(e) { if (_open && !_open.box.contains(e.target)) closeQ(); }

function _show(anchor, text, title) {
  if (_open && _open.anchor === anchor) return;
  closeQ();
  if (!anchor.isConnected) return;
  const t = String((typeof text === 'function' ? text() : text) || '').trim();
  if (!t) return;
  const box = _el('div', 'qm-pop');
  box.setAttribute('role', 'tooltip');
  if (title) box.appendChild(_el('b', null, title));
  for (const p of t.split('\n')) if (p.trim()) box.appendChild(_el('p', null, p.trim()));
  document.body.appendChild(box);
  // Under the "?", from its left edge - above it when there is no room below; never past the window's edges.
  const r = anchor.getBoundingClientRect();
  const bw = box.offsetWidth, bh = box.offsetHeight;
  box.style.left = Math.round(Math.max(6, Math.min(window.innerWidth - bw - 6, r.left - 10))) + 'px';
  box.style.top = Math.round(r.bottom + 6 + bh > window.innerHeight - 6 ? Math.max(6, r.top - bh - 6) : r.bottom + 6) + 'px';
  const layer = Layers.open(box, { modal: false, name: 'help', onEsc: closeQ });
  _open = { box, anchor, layer };
  anchor.classList.add('is-on');
  document.addEventListener('mousemove', _onMove, true);
  document.addEventListener('mousedown', _onDown, true);
  window.addEventListener('scroll', _onScroll, true);
  window.addEventListener('blur', closeQ);
}

/** The "?" - its popup opens on the pointer resting on it. */
export function qmark(text, o) {
  const opts = o || {};
  const q = _el('span', 'qm', '?');
  q.setAttribute('aria-label', typeof text === 'string' ? text : 'help');
  q.addEventListener('mouseenter', () => {
    clearTimeout(_openT);
    clearTimeout(_shutT);
    _shutT = 0;
    _openT = setTimeout(() => _show(q, text, opts.title), OPEN_MS);
  });
  q.addEventListener('mouseleave', () => { clearTimeout(_openT); });
  // A press on it is its own: nothing under it folds, unfolds, ticks or is chosen. Without a pointer that rests (a touch) it
  // opens the popup.
  q.addEventListener('mousedown', (e) => { e.stopPropagation(); });
  q.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); _show(q, text, opts.title); });
  return q;
}

/** The "?" at the end of `node`; `node` back. No text - no "?". */
export function withQ(node, text, o) {
  if (node && text) node.appendChild(qmark(text, o));
  return node;
}
