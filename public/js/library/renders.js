/* ═══════════════════════════════════════════════════════════════════════════
   LIBRARY — the Renders shelf, BY PROJECT (phase V23, the owner 2026-10-09).

   "одной строкой название проекта с данными о создании; при клике выдвигается поле с миниатюрами рендеров проекта,
   повторный клик закрывает; каждая строка — дропдаун"; "можно открыть несколько строк сразу".

   One row per project: its title, how many renders, the date of the latest. A press opens a strip of that project's
   renders under it - the shelf's own cards (poster, the cross, "unreadable"), with the length and the date under each -
   and a second press closes it; any number open at once, remembered between visits (this computer's browser storage, a
   convenience). Rows by their newest render, newest first; renders of no project - `nocat`, loose at the top - in a
   row "No project" at the bottom. A project deleted since keeps its folder's name (the owner's answer 8). The viewer
   pages inside the project (answer 7).

   The server says which folder and project each render is in, and its length (routes/library.js, lib/render-posters.js).
   ═══════════════════════════════════════════════════════════════════════════ */

// (phase V73 block 2, step 2b) "no renders yet" as the shared part (css/app-shell.css .u-empty)
import { emptyEl } from '../ui-state.js';
import { icon } from '../icons.js';

const LS_OPEN = 'lib-renders-open';
const NONE = '~none';

function _el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function _loadOpen() {
  try { return new Set(JSON.parse(localStorage.getItem(LS_OPEN) || '[]')); } catch (e) { return new Set(); }
}
function _saveOpen(set) {
  try { localStorage.setItem(LS_OPEN, JSON.stringify([...set].slice(-200))); } catch (e) { /* only a convenience */ }
}

const _pad = (n) => String(n).padStart(2, '0');
function _when(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return d.getFullYear() + '-' + _pad(d.getMonth() + 1) + '-' + _pad(d.getDate()) + ' ' + _pad(d.getHours()) + ':' + _pad(d.getMinutes());
}
const _mmss = (s) => {
  if (!(s > 0)) return '';
  const m = Math.floor(s / 60);
  return m + ':' + _pad(Math.round(s - m * 60));
};

/** The shelf as rows. `hooks`: { card(it, extra) - the shelf's card, open(it, list) - the viewer, on `list` }. */
export function render(items, hooks) {
  const grid = document.getElementById('lib-grid');
  if (!grid) return;
  const h = hooks || {};
  grid.className = 'lib-rows is-renders';
  grid.textContent = '';
  if (!items.length) {
    grid.appendChild(emptyEl('No renders yet. Render a project in Merge.', { cls: 'lib-empty' }));
    return;
  }

  // Grouped in the order the items come - newest first - so the groups are in the order of their newest render.
  const groups = new Map();
  for (const it of items) {
    const m = it.meta || {};
    const key = m.folder ? 'f:' + String(m.folder).toLowerCase() : NONE;
    if (!groups.has(key)) groups.set(key, { key, title: m.folder ? (m.project || m.folder) : 'No project', items: [] });
    groups.get(key).items.push(it);
  }
  const rows = [...groups.values()].sort((a, b) => (a.key === NONE) - (b.key === NONE));
  const open = _loadOpen();

  for (const g of rows) {
    const wrap = _el('div', 'lib-rgroup' + (open.has(g.key) ? ' is-open' : ''));
    const head = _el('button', 'lib-srow lib-rhead');
    head.type = 'button';
    head.appendChild(_el('span', 'lib-rcaret')).innerHTML = icon('chevron-right', 14);   // (phase V73 block 6, (к18))
    const main = _el('div', 'lib-srow-main');
    main.appendChild(_el('div', 'lib-srow-t', g.title));
    const n = g.items.length;
    const making = g.items.filter(it => it.meta && it.meta.posterPending).length;
    main.appendChild(_el('div', 'lib-srow-s', n + (n === 1 ? ' render' : ' renders') + (making ? ' · posters being made: ' + making : '')));
    head.appendChild(main);
    head.appendChild(_el('span', 'lib-srow-d', _when((g.items[0].meta || {}).date)));
    head.title = open.has(g.key) ? 'Close' : 'Show the renders of this project';
    wrap.appendChild(head);

    const strip = _el('div', 'lib-rstrip');
    const fill = () => {
      strip.textContent = '';
      for (const it of g.items) {
        const m = it.meta || {};
        const sub = _el('div', 'lib-sub lib-rsub');
        const len = _mmss(m.dur);
        if (len) sub.appendChild(_el('span', 'lib-rlen', len));
        // Short under a narrow card: the month and day and the time - the year is the row's.
        sub.appendChild(_el('span', '', _when(m.date).slice(5)));
        if (m.posterPending) sub.appendChild(_el('span', 'lib-sub-run', '· poster…'));
        const card = h.card ? h.card(it, sub) : _el('div', 'lib-card', it.name);
        if (m.unreadable && m.why) card.title = it.name + '\n' + m.why;
        card.addEventListener('click', () => { if (h.open) h.open(it, g.items); });
        strip.appendChild(card);
      }
    };
    if (open.has(g.key)) fill();
    wrap.appendChild(strip);

    head.addEventListener('click', () => {
      const now = !wrap.classList.contains('is-open');
      wrap.classList.toggle('is-open', now);
      head.title = now ? 'Close' : 'Show the renders of this project';
      const set = _loadOpen();
      if (now) { set.add(g.key); if (!strip.childNodes.length) fill(); } else set.delete(g.key);
      _saveOpen(set);
    });
    grid.appendChild(wrap);
  }
}
