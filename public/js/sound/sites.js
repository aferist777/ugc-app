/* ═══════════════════════════════════════════════════════════════════════════
   WHERE ELSE TO FIND SOUNDS - the "?" right of the SFX search, a popup of links to the five sites below,
   on Merge's Library panel and the Library's Media shelf alike (js/sound/shelf.js searchHead).

   Sites whose sounds go into a video with no credit owed. Where a site can search by a word, its link carries the words
   typed in the search (Freesound, Pixabay and Mixkit's "discover" take any word; Kenney and Sonniss
   have only their pages). A link opens in the computer's own browser - the window sends every outside address there
   (desktop/main.js). A downloaded file is let go on My sounds in the tree.

     openSites(anchor, words)   the popup under the "?" - on the Layers stack: Escape or a press away closes it
   ═══════════════════════════════════════════════════════════════════════════ */

import * as Layers from '../layers.js';

const q = (w) => encodeURIComponent(String(w || '').trim());
const slug = (w) => String(w || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

export const SITES = [
  { name: 'Freesound', note: 'CC0 only - the filter is already on; a free account to download',
    url: (w) => 'https://freesound.org/search/?' + (w ? 'q=' + q(w) + '&' : '') + 'f=license%3A%22Creative+Commons+0%22' },
  { name: 'Pixabay Sound Effects', note: 'free in your videos, no credit',
    url: (w) => (w ? 'https://pixabay.com/sound-effects/search/' + q(w) + '/' : 'https://pixabay.com/sound-effects/') },
  { name: 'Mixkit', note: 'free in your videos, no credit',
    url: (w) => (slug(w) ? 'https://mixkit.co/free-sound-effects/discover/' + slug(w) + '/' : 'https://mixkit.co/free-sound-effects/') },
  { name: 'Kenney', note: 'game and interface packs · CC0',
    url: () => 'https://kenney.nl/assets/category:Audio' },
  { name: 'Sonniss GDC', note: 'big free bundles a year · no credit',
    url: () => 'https://sonniss.com/gameaudiogdc/' },
];

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

let _open = null;
function _close() {
  if (!_open) return;
  _open.box.remove();
  document.removeEventListener('mousedown', _open.away, true);
  window.removeEventListener('scroll', _close, true);
  Layers.close(_open.layer);
  _open = null;
}

export function openSites(anchor, words) {
  const was = _open && _open.anchor === anchor;
  _close();
  if (was) return;                       // the "?" pressed again folds it
  const w = String(words || '').trim();
  const box = el('div', 'mt-pop snd-sites u-ask is-float');
  box.appendChild(el('b', 'mt-pop-head', 'Free sounds on other sites'));
  box.appendChild(el('div', 'snd-sites-sub', (w ? 'They open searching for «' + w + '». ' : '')
    + 'Download a sound there, then drop the file onto My sounds in the tree.'));
  for (const s of SITES) {
    const a = el('a', 'snd-sites-row');
    a.href = s.url(w);
    a.target = '_blank';
    a.rel = 'noopener';
    a.appendChild(el('b', null, s.name + ' ↗'));
    a.appendChild(el('span', 'snd-muted', s.note));
    a.addEventListener('click', () => setTimeout(_close, 0));
    box.appendChild(a);
  }
  document.body.appendChild(box);
  const r = anchor.getBoundingClientRect();
  const bw = box.offsetWidth, bh = box.offsetHeight;
  box.style.left = Math.round(Math.max(6, Math.min(window.innerWidth - bw - 6, r.right - bw))) + 'px';
  box.style.top = Math.round(r.bottom + 4 + bh > window.innerHeight - 6 ? Math.max(6, r.top - bh - 4) : r.bottom + 4) + 'px';
  const away = (e) => { if (!box.contains(e.target) && e.target !== anchor) _close(); };
  const layer = Layers.open(box, { modal: false, name: 'sound sites', onEsc: _close });
  _open = { box, away, layer, anchor };
  document.addEventListener('mousedown', away, true);
  window.addEventListener('scroll', _close, true);
}
