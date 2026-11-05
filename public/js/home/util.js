/* ════════════════════════════════════════════════════════════════════════════
   HOME'S SMALL TOOLS (phase V70, P13 - moved out of main.js when the blocks became several modules): an element, a JSON
   read, the browser's memory, "when" in words, and a block's FRAME - the gold frame with its head (its name, what it says
   about itself, a link at the right) and a body the block paints.
   ════════════════════════════════════════════════════════════════════════════ */

import { icon } from '../icons.js';

export const $ = (s, r) => (r || document).querySelector(s);
export const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
export const api = async (url) => {
  const r = await fetch(url);
  const d = await r.json().catch(() => null);
  if (!d || d.success === false) throw new Error((d && d.error) || 'no answer');
  return d;
};
export const ls = (k, fb) => { try { const v = localStorage.getItem(k); return v == null ? fb : JSON.parse(v); } catch (e) { return fb; } };
export const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* a private window */ } };

export const when = (iso) => {
  const t = Date.parse(iso);
  if (!t) return '';
  const d = new Date(t), now = new Date();
  const hm = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86400000);
  if (diff === 0) return 'today, ' + hm;
  if (diff === 1) return 'yesterday, ' + hm;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + ', ' + hm;
};

/** A block's frame: { st, head, what, right, body } - `body` is laid out by the frame itself (display: contents). */
export function frame(id, name) {
  const st = el('section', 'hm-st');
  st.dataset.block = id;
  const head = el('div', 'hm-head');
  // (phase V73 block 6) the handle is the interface's grip icon, "Drag" under the pointer; the name in sentence case
  const grip = el('span', 'hm-grip');
  grip.innerHTML = icon('grip-vertical', 14);
  grip.title = 'Drag';
  head.appendChild(grip);
  head.appendChild(el('span', 'hm-name', name));
  const what = el('span', 'hm-what');
  head.appendChild(what);
  head.appendChild(el('span', 'sp'));
  const right = el('span', 'hm-right');
  head.appendChild(right);
  const body = el('div', 'hm-bodyx');
  body.style.display = 'contents';
  st.append(head, body);
  return { st, head, what, right, body };
}

/**
 * A row of TILES (phase V70): a filled gold icon and its word under it, each a link - a plain press runs `run` when it is
 * given (a window over Home), a press with a modifier follows the link as any link.
 *   tiles([{ icon, label, href, title, run }]) -> the row
 * (phase V73 block 0) As many places a row as it has tiles (css/home.css --hm-cols): Generate's three fill their row.
 */
export function tiles(list) {
  const row = el('div', 'hm-tiles');
  row.style.setProperty('--hm-cols', String(Math.max(1, list.length)));
  for (const t of list) {
    const a = el('a', 'hm-tile');
    a.href = t.href;
    if (t.title) a.title = t.title;
    const ico = el('span', 'hm-tile-ico');
    ico.innerHTML = t.icon || '';
    a.append(ico, el('span', 'hm-tile-t', t.label));
    if (t.run) {
      a.addEventListener('click', (e) => {
        if (e.button !== 0 || e.ctrlKey || e.shiftKey || e.metaKey || e.altKey) return;
        e.preventDefault();
        t.run(e);
      });
    }
    row.appendChild(a);
  }
  return row;
}
