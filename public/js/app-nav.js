// The top nav strip, shared by the pages built new (Scenarios v3, Library).
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

function _lightCurrent(nav) {
  const here = location.pathname.replace(/\/+$/, '') || '/';
  let best = null, bestLen = -1;
  nav.querySelectorAll('a[href]').forEach(a => {
    a.classList.remove('cur');
    // `data-also` lets one entry own more than one address - a page reached through another one
    // lights that one's entry. Without it a page whose link is not in the nav lights nothing.
    for (const raw of [a.getAttribute('href') || ''].concat((a.getAttribute('data-also') || '').split(/\s+/))) {
      const p = raw.replace(/\/+$/, '');
      // longest matching prefix wins, so a longer address beats its own prefix
      if (p && (here === p || here.indexOf(p + '/') === 0) && p.length > bestLen) { best = a; bestLen = p.length; }
    }
  });
  if (best) best.classList.add('cur');
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
  if (nav.querySelector('a[href="/admin"]')) return;
  const a = document.createElement('a');
  a.href = '/admin'; a.textContent = 'Admin';
  nav.appendChild(a);
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
  paint(true);
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
  // What is being generated, on every page (js/alerts-bell.js): the work belongs to the server, so
  // the list is the same wherever you are standing.
  mountAlerts(nav);
  // (phase V23) A new version in the program folder: a chip left of the wait and Alerts, in the app window only.
  mountUpdate(nav);
  _windowButtons(nav);
  // (phase V49, the owner's (пр13)) The window's close asks nothing about the draft any more (the question of phase V20,
  // js/draft-ask.js, went): it stays as it is. The shell asks the page `window.__ugcDraftAsk`, which no page defines now -
  // the answer is 'none' at once (desktop/main.js draftAsked).
}
