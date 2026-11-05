/* ═══════════════════════════════════════════════════════════════════════════
   MERGE v3 — THE BLEND MODE'S LIST (phase V65, the owner's (пз7), (пз10); moved out of inspector.js in phase V74 so the
   patterns of main video - js/merge-v3/patterns-ui.js - take the same list as the clips of lanes above main).

   A list of its own, not a <select> (which never says which option the pointer is over): the pointer resting on a mode shows
   it on the preview at once (`live(id)` - the caller holds it with place-b.js setLive, nothing written), a press chooses it
   (`write(id)` - one undo step), Escape, a press away or the pointer leaving the list puts the preview back as it was
   (`live(null)`). The modes are overlay/look.js BLENDS.
   ═══════════════════════════════════════════════════════════════════════════ */

import * as Layers from '../layers.js';
import { BLENDS } from '../overlay/look.js';
import { iconEl } from '../icons.js';

const _el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

let _menu = null;     // { el, layer, away, live } while the list is open

/** The list taken away - the preview put back as it was. */
export function closeBlendMenu() {
  if (!_menu) return;
  const m = _menu;
  _menu = null;
  m.live(null);
  document.removeEventListener('mousedown', m.away, true);
  Layers.close(m.layer);
  m.el.remove();
}

function _open(anchor, current, live, write) {
  closeBlendMenu();
  const el = _el('div', 'mv3-blend-menu u-menu is-float');
  for (const m of BLENDS) {
    const it = _el('button', 'mv3-blend-item u-mi' + (m.id === current ? ' is-on' : ''), m.label);
    it.type = 'button';
    it.title = m.tip;
    it.addEventListener('mouseenter', () => live(m.id));
    it.addEventListener('click', (e) => {
      e.stopPropagation();
      closeBlendMenu();
      write(m.id);
    });
    el.appendChild(it);
  }
  el.addEventListener('mouseleave', () => live(null));
  document.body.appendChild(el);
  const r = anchor.getBoundingClientRect();
  el.style.minWidth = Math.round(r.width) + 'px';
  const h = el.offsetHeight;
  // Kept on the screen: in a narrow window the button may stand at its right edge.
  el.style.left = Math.round(Math.max(8, Math.min(r.left, window.innerWidth - el.offsetWidth - 8))) + 'px';
  el.style.top = Math.round(r.bottom + 2 + h > window.innerHeight - 8 ? Math.max(8, r.top - 2 - h) : r.bottom + 2) + 'px';
  const away = (e) => { if (!el.contains(e.target) && e.target !== anchor) closeBlendMenu(); };
  document.addEventListener('mousedown', away, true);
  _menu = { el, away, live, layer: Layers.open(el, { modal: false, name: 'blend', onEsc: closeBlendMenu }) };
}

/**
 * The button that opens the list. `current` - the mode's id, '' when the things it stands for differ ("mixed"); `title`;
 * `live(id | null)` - a mode shown on the preview, or the preview put back; `write(id)` - the mode chosen.
 */
export function blendButton({ current, title, live, write }) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'mv3-blend-btn u-btn is-s is-field';
  const now = BLENDS.find((m) => m.id === current);
  // (phase V73 block 5, 5b) the field's chevron, Lucide's - not "▾"
  b.appendChild(document.createTextNode(now ? now.label : 'mixed'));
  b.appendChild(iconEl('chevron-down', 14));
  if (title) b.title = title;
  b.addEventListener('click', (e) => { e.stopPropagation(); _open(b, current || '', live, write); });
  return b;
}
