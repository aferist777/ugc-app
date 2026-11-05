/* ═══════════════════════════════════════════════════════════════════════════
   FINDING SOUNDS ONLINE (phase V34.D-E; the owner 2026-10-22, (з1), (н9)-(н11): "пользователь может подключаться к
   библиотеке в попапе и добавлять себе в библиотеку другие звуки из наборов, так же поиском по библиотекам"; "только cc0
   берем. обойдемся openverse"; 2026-10-23, (р3): "когда пользователь что-то написал в поиск и не нашел в библиотеке, то
   подставлять написаное в поиск в попап поиска онлайн") - one window for Merge's Library panel, the Library's Media shelf
   and the lab.

   The search (CC0 only; GET /api/audio/online - since phase V54 Freesound directly with the owner's key, else Openverse,
   which searches Freesound and Wikimedia Commons with no key; the answer says which, `via`), a result played by
   a press of ▶, "add" files it into the category chosen at the top - "Downloaded" by default, made when it is first used
   (POST /api/audio/online/add). Below: the galleries a person opens and downloads from by hand - the file is then let go
   on a category of the tree. And, as their terms ask, "made using Openverse" or "the Freesound API" - whichever answered.

     openOnline({ cats: [{ id, label }], cat, q, stop(), added(item) })   `q` - words to search at once (the shelf's own
                                                                          search that found nothing)
   ═══════════════════════════════════════════════════════════════════════════ */

import * as Layers from '../layers.js';
import { waveEl, secs } from './wave.js';
import { showError } from '../notice.js';
import { emptyEl, loadingEl, failedEl } from '../ui-state.js';

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

const GALLERIES = [
  { name: 'Kenney', url: 'https://kenney.nl/assets/category:Audio', note: 'game and interface packs · CC0' },
  { name: 'BigSoundBank', url: 'https://bigsoundbank.com/', note: 'thousands of recordings · CC0' },
  { name: 'Freesound', url: 'https://freesound.org/search/?f=license:%22Creative+Commons+0%22', note: 'everything · pick CC0 (a free account to download)' },
  { name: 'Pixabay', url: 'https://pixabay.com/sound-effects/', note: 'fine in your own videos - not to be passed on' },
  { name: 'Mixkit', url: 'https://mixkit.co/free-sound-effects/', note: 'fine in your own videos - not to be passed on' },
];

let _last = { q: '', page: 1 };

/**
 * Open the window. opts: { cats: [{ id, label }], cat: the category to offer first ('' - Downloaded), q, stop(), added(item) }
 */
export function openOnline(opts) {
  const o = opts || {};
  if (typeof o.stop === 'function') o.stop();
  const back = el('div', 'snd-back');
  // (phase V73 block 4, rule 5) The one frame: a head band of 40 px - the name, the source as its quiet note, the ✕ of 28 px;
  // what was the window's padding is its body's.
  const win = el('div', 'snd-win snd-online u-win is-float');
  const head = el('div', 'snd-win-head u-win-head');
  head.appendChild(el('span', 'u-win-title', 'Find sounds online'));
  const sub = el('span', 'u-win-sub', 'free to use in any video, sold or not (CC0)');
  head.append(sub, el('span', 'sp'));
  const x = el('button', 'u-btn is-icon is-quiet u-x', '');
  x.type = 'button';
  x.title = 'Close (Esc)';
  head.appendChild(x);
  win.appendChild(head);
  const body = el('div', 'snd-win-body');
  win.appendChild(body);

  const bar = el('form', 'snd-on-bar');
  const q = el('input', 'snd-search u-in');
  q.type = 'search';
  q.placeholder = 'whoosh, camera shutter, crowd laugh, pop…';
  q.value = o.q ? String(o.q) : _last.q;
  const go = el('button', 'snd-btn is-primary u-btn is-main', 'Search');
  go.type = 'submit';
  bar.append(q, go);
  bar.appendChild(el('span', 'sp'));
  bar.appendChild(el('span', 'snd-muted', 'Add into'));
  const into = el('select', 'snd-sel u-in');
  const dl = el('option', null, 'Downloaded');
  dl.value = '';
  into.appendChild(dl);
  for (const c of (o.cats || [])) {
    if (c.label.toLowerCase() === 'downloaded') { dl.value = c.id; continue; }
    const op = el('option', null, c.label);
    op.value = c.id;
    into.appendChild(op);
  }
  if (o.cat && (o.cats || []).some(c => c.id === o.cat)) into.value = o.cat;
  bar.appendChild(into);
  body.appendChild(bar);

  const list = el('div', 'snd-on-list');
  body.appendChild(list);
  const pager = el('div', 'snd-on-pager');
  body.appendChild(pager);

  const foot = el('div', 'snd-on-foot');
  const g = el('div', 'snd-on-gal');
  g.appendChild(el('span', 'snd-muted', 'Or download by hand, then drop the file onto a folder in the tree:'));
  for (const s of GALLERIES) {
    const a = el('a', 'snd-on-link', s.name);
    a.href = s.url; a.target = '_blank'; a.rel = 'noopener';
    a.title = s.note;
    g.appendChild(a);
  }
  foot.appendChild(g);
  const credit = el('div', 'snd-on-credit', '');
  foot.appendChild(credit);
  // Whoever answered is credited, as its terms ask (phase V54: Freesound first, Openverse the second way).
  const credited = (via, note) => {
    credit.textContent = (via === 'freesound'
      ? 'Search made using the Freesound API (freesound.org).'
      : 'Search made using Openverse (openverse.org) - not endorsed or certified by Openverse.')
      + ' Each sound keeps its author, license and page.';
    sub.textContent = 'free to use in any video, sold or not (CC0) - ' + (via === 'freesound' ? 'Freesound' : 'Freesound and Wikimedia Commons through Openverse')
      + (note ? ' · ' + note : '');
    sub.title = sub.textContent;
  };
  credited('', '');
  body.appendChild(foot);

  document.body.append(back, win);
  const layer = Layers.open(win, { modal: true, onEsc: () => close() });
  const audio = new Audio();
  let playingBtn = null;
  const stopPreview = () => {
    try { audio.pause(); } catch (e) { /* gone */ }
    if (playingBtn) { playingBtn.textContent = '▶'; playingBtn.classList.remove('on'); }
    playingBtn = null;
  };
  audio.addEventListener('ended', stopPreview);
  const close = () => { stopPreview(); back.remove(); win.remove(); Layers.close(layer); };
  x.addEventListener('click', close);
  back.addEventListener('click', close);

  const paint = (d) => {
    list.textContent = '';
    pager.textContent = '';
    // (phase V73 block 2) empty, searching and did not load are the shared parts (js/ui-state.js)
    if (!d.results.length) { list.appendChild(emptyEl('Nothing CC0 for "' + _last.q + '" - other words?', { icon: 'music' })); return; }
    for (const r of d.results) {
      const row = el('div', 'snd-on-row');
      const pb = el('button', 'snd-play u-btn is-s is-icon', '▶');
      pb.type = 'button';
      pb.title = 'Listen';
      pb.addEventListener('click', () => {
        if (playingBtn === pb) { stopPreview(); return; }
        stopPreview();
        audio.src = r.url;
        audio.play().then(() => { playingBtn = pb; pb.textContent = '■'; pb.classList.add('on'); }).catch(() => { pb.textContent = '!'; });
      });
      row.appendChild(pb);
      const tx = el('div', 'snd-on-tx');
      tx.appendChild(el('b', null, r.title));
      const who = (r.source === 'freesound' ? 'Freesound' : /^wikimedia/.test(r.source) ? 'Wikimedia Commons' : r.source)
        + (r.creator ? ' · ' + r.creator : '') + (r.dur ? ' · ' + secs(r.dur) : '') + (r.filetype ? ' · ' + r.filetype : '');
      tx.appendChild(el('span', 'snd-muted', who));
      if (r.tags.length) tx.appendChild(el('span', 'snd-on-tags', r.tags.slice(0, 8).join(', ')));
      row.appendChild(tx);
      row.appendChild(waveEl(r.wave, 'snd-on-wave'));
      const page = el('a', 'snd-on-link', 'Page');
      page.href = r.landing || r.url; page.target = '_blank'; page.rel = 'noopener';
      row.appendChild(page);
      const add = el('button', 'snd-btn u-btn is-s', 'Add');
      add.type = 'button';
      add.addEventListener('click', async () => {
        add.disabled = true;
        add.textContent = 'Adding…';
        try {
          const cat = into.value;
          const res = await fetch('/api/audio/online/add', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: r.id, cat, label: cat ? '' : 'Downloaded' }),
          });
          const j = await res.json();
          if (!j.success) throw new Error(j.error || 'not added');
          add.textContent = j.added ? 'Added ✓' : 'Already yours ✓';
          if (o.added) o.added(j.item);
        } catch (e) {
          add.disabled = false;
          add.textContent = 'Add';
          add.title = e.message;
          showError(e.message);                 // (phase V73 block 2) in the corner (js/notice.js), not under the row
        }
      });
      row.appendChild(add);
      list.appendChild(row);
    }
    if (d.pageCount > 1) {
      const prev = el('button', 'snd-btn u-btn is-s', '‹ Back');
      const next = el('button', 'snd-btn u-btn is-s', 'More ›');
      prev.type = next.type = 'button';
      prev.disabled = d.page <= 1;
      next.disabled = d.page >= Math.min(12, d.pageCount);
      prev.addEventListener('click', () => run(d.page - 1));
      next.addEventListener('click', () => run(d.page + 1));
      pager.append(prev, el('span', 'snd-muted', 'page ' + d.page + ' of ' + Math.min(12, d.pageCount) + ' · ' + d.count + ' found'), next);
    }
  };

  const run = async (page) => {
    const words = q.value.trim();
    if (!words) { q.focus(); return; }
    _last = { q: words, page };
    stopPreview();
    list.textContent = '';
    list.appendChild(loadingEl('searching…'));
    go.disabled = true;
    try {
      const r = await fetch('/api/audio/online?q=' + encodeURIComponent(words) + '&page=' + page);
      const d = await r.json();
      if (!d.success) throw new Error(d.error || 'no answer');
      credited(d.via, d.note ? d.note + ' - searched Openverse' : '');
      paint(d);
    } catch (e) {
      // (phase V73 block 2, (б2-19)) the search not answered: "did not load" and Try again in the list, the reason in the corner
      list.textContent = '';
      list.appendChild(failedEl('the results', () => run(page)));
      showError(e.message);
    } finally { go.disabled = false; }
  };
  bar.addEventListener('submit', (e) => { e.preventDefault(); run(1); });
  q.focus();
  if (o.q) run(1);
  else if (_last.q) run(_last.page || 1);
}
