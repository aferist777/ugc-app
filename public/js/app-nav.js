// The app's menu, shared by every page: the SIDE MENU along the window's left edge (js/side-nav.js) on every page but
// the 3D Studio's, which keeps its top strip and its whole look (OLD_LOOK below).
//
// Plain links, so cross-page navigation needs no router: this page hosts one tab and
// every other entry is a different URL. Two things are done here rather than in the
// markup:
//
//   • which entry is lit is read from the ADDRESS, not hardcoded. The page answers on
//     the page's own address, whatever it is, and a hardcoded class would
//     light the wrong one the day that changes.
//   • the entries no page's markup carries - Home, the Assistant, the render queue, Alerts, the Guide, Donate, Admin.
//
// Its words are the app's language (js/i18n/t.js); the pages' own links are translated with their markup (lib/i18n-html.js,
// "Merge" under data-tc="nav" - the page, not the verb).

import { t, tc } from './i18n/t.js';
import { mountAlerts } from './alerts-bell.js';
import { mountUpdate } from './app-update.js';
import { NAV_ICONS } from './nav-icons.js';
import { dress, sideItem, sideGroup, foldButton, startSide } from './side-nav.js';
// Which places the keys there are open - read on every page from its first moment (js/key-gate.js).
import './key-gate.js';

// The 3D Studio's page keeps its whole look - its strip too: nothing below adds to it there.
const OLD_LOOK = () => !!document.querySelector('link[href="css/studio3d.css"]');

// "Merge" in a strip is the page, not the verb (tc 'nav'): set here as well, for a page whose markup is not translated
// with that context.
function _navWords(nav) {
  const a = nav.querySelector('a[href="/merge"]');
  if (a && a.textContent.trim() === 'Merge') a.textContent = tc('nav', 'Merge');
}

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

// The 3D Studio is being built: its entry is blurred and not pressed on every
// other page (css/app-nav.css .is-soon), with "In development" under the pointer. /3d itself opens by its address, and its
// own strip lights the entry.
function _soon3d(nav) {
  const a = nav.querySelector('a[href="/3d"]');
  if (!a || a.classList.contains('cur')) return;
  a.classList.add('is-soon');
  a.title = t('In development');
  a.setAttribute('aria-disabled', 'true');
  a.tabIndex = -1;
  a.addEventListener('click', (e) => e.preventDefault());
}

// THE 3D STUDIO'S TOP STRIP keeps the look it had: Home first, Admin last, Alerts and the update's chip left of Admin, and
// the window's buttons at the far right - in the app only, the shell gives its pages `ugcWindow` (desktop/preload.js);
// a browser has none and draws none. Full screen: minimise, into a window, quit - the quit goes the way of the window's own
// close, a running render asked about first. In a window Windows' own title bar has those three, and the strip keeps one:
// back to full screen.
function _homeLink(nav) {
  if (nav.querySelector('a[href="/home"]')) return;
  const a = document.createElement('a');
  a.href = '/home'; a.textContent = t('Home');
  nav.insertBefore(a, nav.firstChild);
}

function _adminLink(nav) {
  if (nav.querySelector('a[href="/admin"]')) return;
  const a = document.createElement('a');
  a.href = '/admin'; a.textContent = t('Admin');
  nav.appendChild(a);
}

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
  const min = button('min', t('Minimise'), () => W.minimize());
  const win = button('win', t('Into a window'), () => W.toggleFull());
  const close = button('close', t('Quit UGC Studio'), () => W.close());
  const full = button('full', t('Full screen'), () => W.toggleFull());
  const paint = (isFull) => { min.hidden = win.hidden = close.hidden = !isFull; full.hidden = !!isFull; };
  // The window opens maximised - drawn so until the shell answers.
  paint(false);
  Promise.resolve(W.isFull()).then(paint).catch(() => { /* as drawn */ });
  W.onFull(paint);
  nav.appendChild(box);
}

// DONATE: the author's DonationAlerts page, opened in the person's own browser (the window sends every outside link
// there - desktop/main.js).
const DONATE_URL = 'https://www.donationalerts.com/r/fellows';

// THE SIDE MENU, in its groups, top to bottom: full screen (in the app only) and the app's sign - "Collapse" while it
// is unfolded; the pages - Home, Merge, 3D Studio, Library and the Assistant; the work in flight - the render queue and
// Alerts, the wait in Alerts' word; an empty stretch; "Update …" when a new version is ready; at the foot the Guide,
// Donate and Admin. The pages' markup gives Merge, 3D Studio, Library (Admin's page Admin, Merge's the queue's button):
// they are dressed here as tiles, keeping what the page tied to them.
function _sideFull(group) {
  const W = window.ugcWindow;
  if (!W || typeof W.toggleFull !== 'function') return;
  const b = sideItem('full', t('Full screen'));
  b.classList.add('sn-full');
  const ico = b.querySelector('.sn-ico');
  ico.insertAdjacentHTML('beforeend', NAV_ICONS.window);
  const word = b.querySelector('.sn-t');
  const paint = (isFull) => {
    b.classList.toggle('is-full', !!isFull);
    word.textContent = isFull ? t('Into a window') : t('Full screen');
    b.setAttribute('aria-label', word.textContent);
  };
  // The window opens maximised - drawn so until the shell answers.
  paint(false);
  Promise.resolve(W.isFull()).then(paint).catch(() => { /* as drawn */ });
  W.onFull(paint);
  b.addEventListener('click', () => W.toggleFull());
  group.appendChild(b);
}

function _sideNav(nav) {
  const top = sideGroup('sn-top');
  const pages = sideGroup('sn-pages');
  const work = sideGroup('sn-work');
  const upd = sideGroup('sn-upd');
  const foot = sideGroup('sn-foot');
  const stretch = document.createElement('div');
  stretch.className = 'sn-sp';

  const link = (href) => nav.querySelector('a[href="' + href + '"]');

  _sideFull(top);
  top.appendChild(foldButton(t('Collapse')));

  const page = (href, kind, label) => {
    const a = link(href) || document.createElement('a');
    a.href = href;
    pages.appendChild(dress(a, kind, label));
  };
  page('/home', 'home', t('Home'));
  page('/merge', 'merge', tc('nav', 'Merge'));
  page('/3d', 'studio3d', t('3D Studio'));
  page('/library', 'library', t('Library'));

  const asst = sideItem('assistant', t('Assistant'));
  asst.classList.add('sv3-asst');
  asst.title = t('Assistant - brainstorm ideas and prompts, or ask how to do something in the app');
  asst.addEventListener('click', () => {
    import('./assistant/assistant.js').then((m) => {
      m.onOpenChange((open) => asst.classList.toggle('is-on', !!open));
      return m.openAssistant();
    }).catch((e) => { console.warn('[assistant]', e); });
  });
  pages.appendChild(asst);

  // The render queue: Merge's markup has its button and Merge starts it; elsewhere it is made here.
  let queue = document.getElementById('mv3-queue');
  const fresh = !queue;
  if (fresh) { queue = document.createElement('button'); queue.type = 'button'; queue.id = 'mv3-queue'; }
  queue.title = t('Render queue - projects waiting to be rendered');
  work.appendChild(dress(queue, 'queue', t('Queue')));

  const guide = sideItem('guide', t('Guide'));
  guide.classList.add('sv3-gd');
  guide.title = t('Guide - the app\'s book: how every part of UGC Studio works');
  window.addEventListener('ugc:guide', (e) => guide.classList.toggle('is-on', !!(e.detail && e.detail.open)));
  guide.addEventListener('click', () => {
    import('./assistant/guide.js').then((m) => m.openGuide()).catch((e) => { console.warn('[guide]', e); });
  });
  foot.appendChild(guide);

  const donate = sideItem('donate', t('Donate'), 'a');
  donate.classList.add('sv3-donate');
  donate.href = DONATE_URL;
  donate.target = '_blank';
  donate.rel = 'noopener noreferrer';
  donate.title = t('Thank you for using UGC Studio! If it helps you, you can support it on DonationAlerts - and write there what you would like to see in the next updates.');
  foot.appendChild(donate);

  const admin = link('/admin') || document.createElement('a');
  admin.href = '/admin';
  foot.appendChild(dress(admin, 'settings', t('Admin')));

  nav.replaceChildren(top, pages, work, stretch, upd, foot);
  _lightCurrent(nav);
  _soon3d(nav);
  if (fresh) import('./merge-v3/queue.js').then((m) => m.initQueue()).catch(() => { queue.hidden = true; });
  // What is being generated, on every page (js/alerts-bell.js): the work belongs to the server, so
  // the list is the same wherever you are standing.
  mountAlerts(nav, work);
  // A new version in the program folder: its tile over the foot, in the app window only.
  mountUpdate(nav, upd);
  startSide(nav);
}

export function initNav() {
  const nav = document.querySelector('.sv3-nav');
  if (!nav) return;
  if (!OLD_LOOK()) { _sideNav(nav); return; }
  // the 3D Studio's own strip
  _homeLink(nav);
  _navWords(nav);
  _adminLink(nav);
  _lightCurrent(nav);
  mountAlerts(nav);
  mountUpdate(nav);
  _windowButtons(nav);
}
