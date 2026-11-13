/* ═══════════════════════════════════════════════════════════════════════════
   THE BUBBLE - a hint as a speech bubble, as in a comic, one look for the setup of a talking head AND every "?" of the
   app. ONE module: js/merge-v3/wk-fragments.js and wk-voice.js hang their
   explanations on what they are about, js/sound/qmark.js shows a "?"'s popup through it.

   A speech bubble OVER the thing it is about, its tail pointing down at it - under it, tail up, when there is no room above;
   never past the window's edges. The pointer resting on the thing opens it, and it goes once the pointer has left both the
   thing and the bubble (it may be moved into the bubble to read). One at a time; it is on the stack of layers
   (js/layers.js) - Escape closes it -, and a press anywhere else, a scroll or the window losing focus closes it too.

     hint(node, text, o)        the pointer resting on `node` opens its bubble; `text` a string (paragraphs by "\n") or a
                                function giving one when it opens (nothing - no bubble). o.title - a gold heading;
                                o.on - a class put on `node` while its bubble is open; o.side 'below' - under it when
                                there is room. `node` returned.
     showBubble(anchor, text, o)  opened now, over `anchor`
     closeBubble()              the bubble open, closed
     tipBox(o) / placeBubble(box, anchor, side)
                                a STEP'S TIP: the same bubble over the page with a red ✕ in its corner and the tick "don't
                                show again" at its foot - o.title, o.text, o.onClose(), o.onNever(on); placed by its owner
                                (js/merge-v3/vo-tips.js) over its thing ('above') or under it ('below'). Not on the stack of
                                layers: it takes no key.
   ═══════════════════════════════════════════════════════════════════════════ */

import * as Layers from './layers.js';

const OPEN_MS = 90;          // the pointer resting this long opens it - a sweep across a column opens nothing
const SHUT_MS = 160;         // ...and gone this long from the thing and the bubble closes it
const GAP = 10;              // between the thing and the bubble: the tail's room

let _open = null;            // { box, anchor, layer, on }
let _openT = 0;
let _shutT = 0;

const _el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

export function closeBubble() {
  clearTimeout(_openT);
  clearTimeout(_shutT);
  _shutT = 0;
  if (!_open) return;
  const o = _open;
  _open = null;
  o.box.remove();
  if (o.on && o.anchor.isConnected) o.anchor.classList.remove(o.on);
  Layers.close(o.layer);
  document.removeEventListener('mousemove', _onMove, true);
  document.removeEventListener('mousedown', _onDown, true);
  window.removeEventListener('scroll', _onScroll, true);
  window.removeEventListener('blur', closeBubble);
}

// While a bubble is open the pointer is followed: over the thing or the bubble it stays, anywhere else it goes a moment
// later - also when the thing was painted away under the pointer (no mouseleave comes from a node taken out of the page).
function _onMove(e) {
  if (!_open) return;
  const over = _open.box.contains(e.target) || (_open.anchor.isConnected && _open.anchor.contains(e.target));
  if (over) { clearTimeout(_shutT); _shutT = 0; return; }
  if (!_shutT) _shutT = setTimeout(closeBubble, SHUT_MS);
}
function _onDown(e) { if (_open && !_open.box.contains(e.target)) closeBubble(); }
function _onScroll(e) { if (_open && !_open.box.contains(e.target)) closeBubble(); }

export function showBubble(anchor, text, o) {
  const opts = o || {};
  if (_open && _open.anchor === anchor) return;
  closeBubble();
  if (!anchor || !anchor.isConnected) return;
  const t = String((typeof text === 'function' ? text() : text) || '').trim();
  if (!t) return;
  const box = _el('div', 'bub');
  box.setAttribute('role', 'tooltip');
  if (opts.title) box.appendChild(_el('b', null, opts.title));
  for (const p of t.split('\n')) if (p.trim()) box.appendChild(_el('p', null, p.trim()));
  document.body.appendChild(box);
  // `side: 'below'` - under the thing when there is room (a question's answer: its words stay readable above).
  placeBubble(box, anchor, opts.side);
  const layer = Layers.open(box, { modal: false, name: 'help', onEsc: closeBubble });
  _open = { box, anchor, layer, on: opts.on || '' };
  if (opts.on) anchor.classList.add(opts.on);
  document.addEventListener('mousemove', _onMove, true);
  document.addEventListener('mousedown', _onDown, true);
  window.addEventListener('scroll', _onScroll, true);
  window.addEventListener('blur', closeBubble);
}

/**
 * Where a bubble stands: over the thing, centred on it, its tail pointing at the thing's middle (kept off the rounded corners)
 * - or under it, tail up, for side 'below' and when there is no room above; never past the window's edges.
 */
export function placeBubble(box, anchor, side) {
  const r = anchor.getBoundingClientRect();
  const W = window.innerWidth, H = window.innerHeight;
  const bw = box.offsetWidth, bh = box.offsetHeight;
  const cx = r.left + r.width / 2;
  const left = Math.round(Math.max(6, Math.min(W - bw - 6, cx - bw / 2)));
  const below = side === 'below' ? (r.bottom + GAP + bh <= H - 6 || r.top - GAP - bh < 6)
    : (r.top - GAP - bh < 6 && r.bottom + GAP + bh <= H - 6);
  const top = below ? Math.min(H - bh - 6, r.bottom + GAP) : Math.max(6, r.top - GAP - bh);
  box.style.left = left + 'px';
  box.style.top = Math.round(top) + 'px';
  box.style.setProperty('--tail-x', Math.round(Math.max(16, Math.min(bw - 16, cx - left))) + 'px');
  box.classList.toggle('is-below', below);
}

/** A step's tip (css/app-shell.css .bub.is-tip): the bubble with a red ✕ and "don't show again". Built, not placed or shown. */
export function tipBox(o) {
  const opts = o || {};
  const box = _el('div', 'bub is-tip');
  box.setAttribute('role', 'note');
  const x = _el('button', 'bub-x', '✕');
  x.type = 'button';
  x.setAttribute('aria-label', 'Close');
  x.addEventListener('click', () => { if (opts.onClose) opts.onClose(); });
  box.appendChild(x);
  if (opts.title) box.appendChild(_el('b', null, opts.title));
  for (const p of String(opts.text || '').split('\n')) if (p.trim()) box.appendChild(_el('p', null, p.trim()));
  const never = _el('label', 'bub-never');
  const tick = document.createElement('input');
  tick.type = 'checkbox'; tick.classList.add('u-check');
  tick.checked = !!opts.never;
  tick.addEventListener('change', () => { if (opts.onNever) opts.onNever(tick.checked); });
  never.append(tick, document.createTextNode(' don\'t show again'));
  box.appendChild(never);
  return box;
}

/** The pointer resting on `node` opens its bubble. No text - nothing hung on it. */
export function hint(node, text, o) {
  if (!node || !text) return node;
  node.addEventListener('mouseenter', () => {
    clearTimeout(_openT);
    clearTimeout(_shutT);
    _shutT = 0;
    _openT = setTimeout(() => showBubble(node, text, o), OPEN_MS);
  });
  node.addEventListener('mouseleave', () => { clearTimeout(_openT); });
  return node;
}
