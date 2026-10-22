/* ═══════════════════════════════════════════════════════════════════════════
   THE AUDIO LAB - finding sounds online (phase V34.D; the owner 2026-10-22, (з1), (н9)-(н11): "пользователь может
   подключаться к библиотеке в попапе и добавлять себе в библиотеку другие звуки из наборов, так же поиском по
   библиотекам"; "только cc0 берем. обойдемся openverse"; "в попапе сможет перейти по ссылкам и скачать что нужно").

   One window: the search (Openverse - Freesound and Wikimedia Commons, CC0 only, no key; GET /api/audio/online), a result
   played by a press of ▶, "add" files it into the category chosen at the top - "Downloaded" by default, made when it is
   first used (POST /api/audio/online/add). Below: the galleries a person opens and downloads from by hand - the file is
   then dropped onto a category of the tree. And, as Openverse's terms ask, "made using Openverse".
   ═══════════════════════════════════════════════════════════════════════════ */

import * as Layers from '../layers.js';
import { waveEl, secs, stop as stopTiles } from './audio-play.js';

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
 * Open the window. opts: { cats: [{ id, label }], cat: the category to offer first ('' - Downloaded), added(item) }
 */
export function openOnline(opts) {
  const o = opts || {};
  stopTiles();
  const back = el('div', 'la-back');
  const win = el('div', 'la-win la-online');
  const head = el('div', 'la-win-head');
  head.appendChild(el('b', null, 'Find sounds online'));
  head.appendChild(el('span', 'la-muted', 'free to use in any video, sold or not (CC0) - Freesound and Wikimedia Commons'));
  const x = el('button', 'hp-x', '✕');
  x.type = 'button';
  head.appendChild(x);
  win.appendChild(head);

  const bar = el('form', 'la-on-bar');
  const q = el('input', 'la-search');
  q.type = 'search';
  q.placeholder = 'whoosh, camera shutter, crowd laugh, pop…';
  q.value = _last.q;
  const go = el('button', 'la-btn is-primary', 'search');
  go.type = 'submit';
  bar.append(q, go);
  bar.appendChild(el('span', 'sp'));
  bar.appendChild(el('span', 'la-muted', 'add into'));
  const into = el('select', 'la-sel');
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
  win.appendChild(bar);

  const list = el('div', 'la-on-list');
  win.appendChild(list);
  const pager = el('div', 'la-on-pager');
  win.appendChild(pager);

  const foot = el('div', 'la-on-foot');
  const g = el('div', 'la-on-gal');
  g.appendChild(el('span', 'la-muted', 'Or download by hand, then drop the file onto a category in the tree:'));
  for (const s of GALLERIES) {
    const a = el('a', 'la-on-link', s.name);
    a.href = s.url; a.target = '_blank'; a.rel = 'noopener';
    a.title = s.note;
    g.appendChild(a);
  }
  foot.appendChild(g);
  foot.appendChild(el('div', 'la-on-credit', 'Search made using Openverse (openverse.org) - not endorsed or certified by Openverse. Each sound keeps its author, licence and page.'));
  win.appendChild(foot);

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
    if (!d.results.length) { list.appendChild(el('div', 'la-empty', 'Nothing CC0 for "' + _last.q + '" - other words?')); return; }
    for (const r of d.results) {
      const row = el('div', 'la-on-row');
      const pb = el('button', 'la-play', '▶');
      pb.type = 'button';
      pb.title = 'Listen';
      pb.addEventListener('click', () => {
        if (playingBtn === pb) { stopPreview(); return; }
        stopPreview();
        audio.src = r.url;
        audio.play().then(() => { playingBtn = pb; pb.textContent = '■'; pb.classList.add('on'); }).catch(() => { pb.textContent = '!'; });
      });
      row.appendChild(pb);
      const tx = el('div', 'la-on-tx');
      tx.appendChild(el('b', null, r.title));
      const who = (r.source === 'freesound' ? 'Freesound' : r.source === 'wikimedia' ? 'Wikimedia Commons' : r.source)
        + (r.creator ? ' · ' + r.creator : '') + (r.dur ? ' · ' + secs(r.dur) : '') + (r.filetype ? ' · ' + r.filetype : '');
      tx.appendChild(el('span', 'la-muted', who));
      if (r.tags.length) tx.appendChild(el('span', 'la-on-tags', r.tags.slice(0, 8).join(', ')));
      row.appendChild(tx);
      row.appendChild(waveEl(r.wave, { cls: 'la-on-wave' }));
      const page = el('a', 'la-on-link', 'page');
      page.href = r.landing || r.url; page.target = '_blank'; page.rel = 'noopener';
      row.appendChild(page);
      const add = el('button', 'la-btn', 'add');
      add.type = 'button';
      add.addEventListener('click', async () => {
        add.disabled = true;
        add.textContent = 'adding…';
        try {
          const cat = into.value;
          const res = await fetch('/api/audio/online/add', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: r.id, cat, label: cat ? '' : 'Downloaded' }),
          });
          const j = await res.json();
          if (!j.success) throw new Error(j.error || 'not added');
          add.textContent = j.added ? 'added ✓' : 'already yours ✓';
          if (o.added) o.added(j.item);
        } catch (e) {
          add.disabled = false;
          add.textContent = 'add';
          add.title = e.message;
          row.appendChild(el('div', 'la-err', e.message));
        }
      });
      row.appendChild(add);
      list.appendChild(row);
    }
    if (d.pageCount > 1) {
      const prev = el('button', 'la-btn', '‹ back');
      const next = el('button', 'la-btn', 'more ›');
      prev.type = next.type = 'button';
      prev.disabled = d.page <= 1;
      next.disabled = d.page >= Math.min(12, d.pageCount);
      prev.addEventListener('click', () => run(d.page - 1));
      next.addEventListener('click', () => run(d.page + 1));
      pager.append(prev, el('span', 'la-muted', 'page ' + d.page + ' of ' + Math.min(12, d.pageCount) + ' · ' + d.count + ' found'), next);
    }
  };

  const run = async (page) => {
    const words = q.value.trim();
    if (!words) { q.focus(); return; }
    _last = { q: words, page };
    stopPreview();
    list.textContent = '';
    list.appendChild(el('div', 'la-empty', 'searching… (Openverse can take a while)'));
    go.disabled = true;
    try {
      const r = await fetch('/api/audio/online?q=' + encodeURIComponent(words) + '&page=' + page);
      const d = await r.json();
      if (!d.success) throw new Error(d.error || 'no answer');
      paint(d);
    } catch (e) {
      list.textContent = '';
      list.appendChild(el('div', 'la-err', e.message));
    } finally { go.disabled = false; }
  };
  bar.addEventListener('submit', (e) => { e.preventDefault(); run(1); });
  q.focus();
  if (_last.q) run(_last.page || 1);
}
