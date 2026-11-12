// The top nav strip, shared by every page of the app.
//
// Plain links, so cross-page navigation needs no router: this page hosts one tab and
// every other entry is a different URL. Two things are done here rather than in the
// markup:
//
//   • which entry is lit is read from the ADDRESS, not hardcoded. The page answers on
//     the page's own address, whatever it is, and a hardcoded class would
//     light the wrong one the day that changes.
//   • the Admin entry, on a page whose strip leaves it out.

import { mountAlerts } from './alerts-bell.js';
import { mountUpdate } from './app-update.js';
import { iconEl } from './icons.js';

// (phase V73, (б1-13а)) The 3D Studio's page keeps its whole look - its strip too: nothing below adds to it there.
const OLD_LOOK = () => !!document.querySelector('link[href="css/studio3d.css"]');

function _lightCurrent(nav) {
  const here = location.pathname.replace(/\/+$/, '') || '/';
  let best = null, bestLen = -1;
  nav.querySelectorAll('a[href]').forEach(a => {
    a.classList.remove('cur');
    const p = (a.getAttribute('href') || '').replace(/\/+$/, '');
    // longest matching prefix wins, so a longer address beats its own prefix
    if (p && (here === p || here.indexOf(p + '/') === 0) && p.length > bestLen) { best = a; bestLen = p.length; }
  });
  if (best) best.classList.add('cur');
}

// (phase V73 block 1, the owner 2026-11-03, (к13)) The 3D Studio is being built: its entry is blurred and not pressed on every
// other page (css/app-nav.css .is-soon), with "In development" under the pointer. /3d itself still opens by its address - the
// 3D Studio's session checks its page there - and its own strip lights the entry as before.
function _soon3d(nav) {
  const a = nav.querySelector('a[href="/3d"]');
  if (!a || a.classList.contains('cur')) return;
  a.classList.add('is-soon');
  a.title = 'In development';
  a.setAttribute('aria-disabled', 'true');
  a.tabIndex = -1;
  a.addEventListener('click', (e) => e.preventDefault());
}

// The Admin entry - API keys, AI settings - on a page whose strip does not carry one already.
// There is one person and no sign-in, so there is nobody to hide it from.
// (the owner 2026-10-22) HOME first in every strip, left of Merge - put in here, so no page's markup has to carry it.
function _homeLink(nav) {
  if (nav.querySelector('a[href="/home"]')) return;
  const a = document.createElement('a');
  a.href = '/home'; a.textContent = 'Home';
  nav.insertBefore(a, nav.firstChild);
}

function _adminLink(nav) {
  let a = nav.querySelector('a[href="/admin"]');
  if (!a) {
    a = document.createElement('a');
    a.href = '/admin'; a.textContent = 'Admin';
    nav.appendChild(a);
  }
  // (phase V73 block 6) Alerts and Admin - the two at the right end that are not places of work - are an icon and a word.
  if (!OLD_LOOK() && !a.querySelector('.u-ico')) { a.classList.add('has-ico'); a.insertBefore(iconEl('settings', 14), a.firstChild); }
}

// (phase V73 block 6, the owner's (б6-1) б: "на всех страницах") THE RENDER QUEUE on every page, right of the spacer and left
// of the wait - Merge's markup carries its own button and Merge starts it (js/merge-v3/main.js); on every other page it is put
// in here and the same module (js/merge-v3/queue.js - the server's /api/mv3q list, open / Continue / Stop / Clear) is brought
// in for it. Not on the 3D Studio's page (OLD_LOOK).
function _queueButton(nav) {
  if (OLD_LOOK() || document.getElementById('mv3-queue')) return;
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'sv3-navbtn';
  b.id = 'mv3-queue';
  b.title = 'Render queue - projects waiting to be rendered';
  b.textContent = 'Queue';
  nav.insertBefore(b, nav.querySelector('a[href="/admin"]'));
  import('./merge-v3/queue.js').then((m) => m.initQueue()).catch(() => { b.hidden = true; });
}

// (phase V19, the owner 2026-10-08) THE WINDOW'S BUTTONS at the far right, in the app only - the shell gives its pages
// `ugcWindow` (desktop/preload.js); a browser has none and draws none. Full screen: minimise, into a window, quit - the
// quit goes the way of the window's own close, a running render asked about first. In a window Windows' own title bar
// has those three, and the strip keeps one: back to full screen.
const ICONS = {
  min: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 6.5h8"/></svg>',
  win: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 4.5h5v5h-5z M4.5 4.5v-2h5v5h-2"/></svg>',
  close: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 2.5l7 7 M9.5 2.5l-7 7"/></svg>',
  full: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 4.5v-2.5h2.5 M7.5 2h2.5v2.5 M10 7.5v2.5h-2.5 M4.5 10h-2.5v-2.5"/></svg>',
};
function _windowButtons(nav) {
  const W = window.ugcWindow;
  if (!W || nav.querySelector('.sv3-win')) return;
  const box = document.createElement('span');
  box.className = 'sv3-win';
  const button = (kind, title, fn) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'sv3-win-b is-' + kind;
    b.title = title;
    b.setAttribute('aria-label', title);
    b.innerHTML = ICONS[kind];
    b.addEventListener('click', fn);
    box.appendChild(b);
    return b;
  };
  const min = button('min', 'Minimise', () => W.minimize());
  const win = button('win', 'Into a window', () => W.toggleFull());
  const close = button('close', 'Quit UGC Studio', () => W.close());
  const full = button('full', 'Full screen', () => W.toggleFull());
  const paint = (isFull) => { min.hidden = win.hidden = close.hidden = !isFull; full.hidden = !!isFull; };
  // (phase V60, (пп3а)) The window opens maximised - drawn so until the shell answers.
  paint(false);
  Promise.resolve(W.isFull()).then(paint).catch(() => { /* as drawn */ });
  W.onFull(paint);
  nav.appendChild(box);
}

export function initNav() {
  const nav = document.querySelector('.sv3-nav');
  if (!nav) return;
  _homeLink(nav);
  _adminLink(nav);
  _lightCurrent(nav);
  _soon3d(nav);
  _queueButton(nav);
  // What is being generated, on every page (js/alerts-bell.js): the work belongs to the server, so
  // the list is the same wherever you are standing.
  mountAlerts(nav);
  // (phase V23) A new version in the program folder: a chip left of the wait and Alerts, in the app window only.
  mountUpdate(nav);
  _windowButtons(nav);
}
