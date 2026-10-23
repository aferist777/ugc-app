/* ═══════════════════════════════════════════════════════════════════════════
   MERGE v3 — the CAPTION STYLE of a highlights project, chosen in its popup (phase V33.1, the owner's (х16): "в попапе ...
   отдельное поле с фильтром субтитров и пользователь выбирает стиль и тогда только может отправить на создание хайлайтов").

   The captions view's own tiles (captions-view.js, phase K6 / V32), in a picker of their own: the categories over them -
   All, Mine, Viral, Pop… -, every preset of the app and every one of the person's, each showing its STILL and playing its
   loop only under the cursor (V32: the loop asked for at the first hover, from its start each time, its round finished
   when the cursor leaves). A press CHOOSES - nothing is applied to any lane here: the style goes to every fragment of
   the project (block 3). The tiles are the server's (lib/caption-tiles.js); one not made yet shows the preset's name in
   its own font and colour, and the set is asked to be made once.
   ═══════════════════════════════════════════════════════════════════════════ */

import { PRESETS, CATEGORIES } from '../captions/presets.js';
import { cssWeight } from '../captions/fonts.js';
import * as MyPresets from './my-presets.js';

const MINE = 'mine';
const REC = 'rec';
const LS_CAT = 'mv3_hl_cat_v1';

// (phase V33.8, H2; the owner's (у7): "под подкасты - яркие, под документалку и факты - чуть сдержанней. типа рекомендованые, но
// оставить выбор и других групп субтитров") The caption groups recommended for a kind of video - first among the chips, marked
// "recommended", and open when the kind is chosen; every other group stays beside them.
export const RECOMMENDED = {
  podcast: { cats: ['viral', 'karaoke', 'pop'], said: 'bright, word by word - for a podcast' },
  documentary: { cats: ['classic', 'clean', 'cinema'], said: 'calm - for a documentary' },
};
const _el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const _loops = new Map();          // a loop's address -> Promise<Blob>, kept for the page's life

function _loopOf(url) {
  let p = _loops.get(url);
  if (!p) {
    p = fetch(url).then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.blob(); });
    p.catch(() => _loops.delete(url));
    _loops.set(url, p);
  }
  return p;
}

/** A preset's name, the app's or the person's ('' for none). */
export function presetName(id) {
  const p = PRESETS.find((x) => x.id === id) || MyPresets.byId(id);
  return p ? p.name : '';
}

/**
 * A picker in `host`. `onPick(id, name)` on a press; `kind` (V33.8) - the video's kind, whose recommended groups come first.
 * Returns { set(id), get(), recommend(kind), stop() } - stop() puts every loop back to its still (the popup closed).
 */
export function stylePicker(host, { onPick, kind } = {}) {
  let cat = '';
  try { cat = JSON.parse(localStorage.getItem(LS_CAT) || '""') || ''; } catch (e) { cat = ''; }
  let chosen = '';
  let state = null;
  let alive = true;
  let rec = null;                  // (V33.8) RECOMMENDED[kind], or null
  const tiles = new Map();         // id -> { btn, box, ph, img, over, loop, starting, end }

  const top = _el('div', 'mv3-cap-cats mv3-hls-cats');
  const grid = _el('div', 'mv3-cap-grid mv3-hls-grid');
  host.append(top, grid);

  const mine = MyPresets.list();
  const countOf = (id) => PRESETS.filter((p) => p.category === id).length;
  // The chips: (V33.8) the kind's recommended groups first - one chip "recommended" for all of them -, then All, Mine and
  // the groups, the recommended ones first, each marked.
  function paintChips() {
    top.textContent = '';
    const recCats = rec ? rec.cats.filter((c) => CATEGORIES.some((x) => x.id === c)) : [];
    const cats = recCats.map((id) => CATEGORIES.find((x) => x.id === id)).concat(CATEGORIES.filter((c) => !recCats.includes(c.id)));
    const chips = (recCats.length ? [[REC, 'recommended', recCats.reduce((n, c) => n + countOf(c), 0)]] : [])
      .concat([['', 'All', PRESETS.length + mine.length], [MINE, 'Mine', mine.length]])
      .concat(cats.map((c) => [c.id, c.label, countOf(c.id)]));
    for (const [id, label, n] of chips) {
      const b = _el('button', 'mv3-cap-cat' + (id === REC ? ' is-rec' : '') + (recCats.includes(id) ? ' is-rec-cat' : ''), label);
      b.type = 'button';
      b.dataset.cat = id;
      b.appendChild(_el('span', 'mv3-cap-n', ' ' + n));
      if (id === REC) b.title = 'Recommended for this kind of video: ' + rec.said + ' - ' + recCats.map((c) => CATEGORIES.find((x) => x.id === c).label).join(', ');
      else if (recCats.includes(id)) b.title = 'Recommended for this kind of video';
      b.addEventListener('click', () => { cat = id; try { localStorage.setItem(LS_CAT, JSON.stringify(cat)); } catch (e) { /* private */ } paintCat(); });
      top.appendChild(b);
    }
    // The tiles in the same order: the person's, the recommended groups', the rest.
    const order = [...grid.children].sort((a, b) => _rank(a) - _rank(b));
    for (const el of order) grid.appendChild(el);
  }
  const _rank = (btn) => {
    const c = btn.dataset.cat;
    const i = c === MINE ? -1 : (rec ? rec.cats.indexOf(c) : -1);
    return (c === MINE ? -1 : i >= 0 ? i : 100) * 10000 + (+btn.dataset.i || 0);
  };

  // The person's first, newest first (as in the captions view), then the app's.
  for (const p of mine.concat(PRESETS)) {
    const isMine = !!MyPresets.byId(p.id);
    const btn = _el('button', 'mv3-cap-tile');
    btn.type = 'button';
    btn.dataset.id = p.id;
    btn.dataset.cat = isMine ? MINE : p.category;
    btn.dataset.i = String(tiles.size);
    btn.title = p.name + ' - the captions of every fragment';
    const box = _el('div', 'mv3-cap-box');
    const ph = _el('span', 'mv3-cap-ph', p.name);
    const s = p.style || {};
    ph.style.fontFamily = '"' + s.font + '", "Liberation Sans", sans-serif';
    ph.style.fontWeight = String(cssWeight(s.font, s.bold));
    ph.style.color = s.primary || '#ffffff';
    if (s.casing === 'upper') ph.style.textTransform = 'uppercase';
    box.appendChild(ph);
    const name = _el('div', 'mv3-cap-name');
    name.appendChild(_el('span', 'mv3-cap-nm', p.name));
    btn.append(box, name);
    const t = { btn, box, ph, img: null, over: false, loop: null, starting: false, end: 0 };
    btn.addEventListener('click', () => { set(p.id); if (onPick) onPick(p.id, p.name); });
    btn.addEventListener('pointerenter', () => enter(t));
    btn.addEventListener('pointerleave', () => leave(t));
    tiles.set(p.id, t);
    grid.appendChild(btn);
  }

  function paintCat() {
    if (cat === REC && !rec) cat = '';
    for (const b of top.children) b.classList.toggle('is-on', (b.dataset.cat || '') === cat);
    for (const t of tiles.values()) {
      t.btn.hidden = cat === REC ? !rec.cats.includes(t.btn.dataset.cat) : (!!cat && t.btn.dataset.cat !== cat);
      if (t.btn.hidden) stopNow(t);
    }
  }

  /** (V33.8) The video's kind changed: its recommended groups first, and open - the style chosen stays chosen. */
  function recommend(k) {
    rec = RECOMMENDED[k] || null;
    paintChips();
    if (rec) cat = REC;
    paintCat();
  }

  function set(id) {
    chosen = id && tiles.has(id) ? id : '';
    for (const [k, t] of tiles) t.btn.classList.toggle('is-on', k === chosen);
  }

  // ── The stills, and the loop under the cursor ──
  function paintStills() {
    if (!state) return;
    for (const id of (state.ready || [])) {
      const t = tiles.get(id);
      if (!t || t.img) continue;
      const img = new Image();
      img.className = 'mv3-cap-img';
      img.alt = '';
      img.loading = 'lazy';
      img.decoding = 'async';
      img.draggable = false;
      img.addEventListener('load', () => t.box.classList.add('is-ready'));
      img.src = state.base + encodeURIComponent(id) + (state.still || '.first.webp');
      t.box.appendChild(img);
      t.img = img;
    }
  }
  async function enter(t) {
    t.over = true;
    if (t.end) { clearTimeout(t.end); t.end = 0; }
    if (t.loop || t.starting || !t.img || !state) return;
    t.starting = true;
    let url = null;
    try {
      url = URL.createObjectURL(await _loopOf(state.base + encodeURIComponent(t.btn.dataset.id) + '.webp'));
      const img = new Image();
      img.className = 'mv3-cap-img';
      img.alt = '';
      img.draggable = false;
      img.src = url;
      await img.decode();
      if (!t.over || !alive || !t.btn.isConnected || t.btn.hidden) return;
      t.box.appendChild(img);
      t.loop = { img, url, since: performance.now() };
      url = null;
      requestAnimationFrame(() => { if (t.loop && t.loop.img === img) t.loop.since = performance.now(); });
    } catch (e) {
      /* the still stays */
    } finally {
      t.starting = false;
      if (url) URL.revokeObjectURL(url);
    }
  }
  function leave(t) {
    t.over = false;
    if (!t.loop || t.end) return;
    const round = ((state && state.loop) || 2.5) * 1000;
    const left = round - ((performance.now() - t.loop.since) % round);
    t.end = setTimeout(() => { t.end = 0; stopLoop(t); }, Math.max(0, left - 40));
  }
  function stopLoop(t) {
    if (t.end) { clearTimeout(t.end); t.end = 0; }
    if (!t.loop) return;
    t.loop.img.remove();
    URL.revokeObjectURL(t.loop.url);
    t.loop = null;
  }
  function stopNow(t) { t.over = false; stopLoop(t); }

  (async () => {
    let d = null;
    try { d = await fetch('/api/mv3/captions/tiles').then((r) => r.json()); } catch (e) { d = null; }
    // A set not made yet (a library that never showed the captions view): made now, the category looked at first.
    if (d && d.success && !d.making && ((d.ready || []).length + (d.failed || []).length) < d.total) {
      try { d = await fetch('/api/mv3/captions/tiles/make', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ first: cat || null }) }).then((r) => r.json()); }
      catch (e) { /* the names stand in */ }
    }
    for (let k = 0; alive && d && d.success; k++) {
      state = d;
      paintStills();
      if (!d.making || k > 60) break;
      await new Promise((r) => setTimeout(r, 1500));
      try { d = await fetch('/api/mv3/captions/tiles').then((r) => r.json()); } catch (e) { break; }
    }
  })();

  recommend(kind);
  return {
    set, get: () => chosen, recommend,
    stop: () => { alive = false; for (const t of tiles.values()) stopNow(t); },
  };
}
