/* ═══════════════════════════════════════════════════════════════════════════
   MERGE v3 — the CAPTION STYLE of a highlights project, chosen in its popup (phase V33.1, the owner's (х16): "в попапе ...
   отдельное поле с фильтром субтитров и пользователь выбирает стиль и тогда только может отправить на создание хайлайтов").

   The captions view's own tiles (captions-view.js, phase K6 / V32), in a picker of their own: the categories over them -
   All, Mine, Viral, Pop… -, every preset of the app and every one of the person's, each showing its STILL and playing its
   loop only under the cursor (V32: the loop asked for at the first hover, from its start each time, its round finished
   when the cursor leaves). A press CHOOSES - nothing is applied to any lane here: the style goes to every fragment of
   the project (block 3). The tiles are the server's (lib/caption-tiles.js); one not made yet shows the preset's name in
   its own font and colour, and the set is asked to be made once.

   SEVERAL WITH SHIFT (phase V49, the owner's (пр25), (пр26)): Shift on a tile adds it to those chosen or takes it away - every
   fragment gets the same set, dealt page by page (public/js/captions/mix.js); several replace "by the video". The popup's second
   tab is the animations (animPicker): the In -> Out pairs of the captions view's "animation" tab (captions/page-fx.js PAIRS), its
   tiles the same server's, one or several with Shift.
   ═══════════════════════════════════════════════════════════════════════════ */

import { PRESETS, CATEGORIES } from '../captions/presets.js';
import { cssWeight } from '../captions/fonts.js';
import * as MyPresets from './my-presets.js';
import { PAIRS, animTileId } from '../captions/page-fx.js';

const MINE = 'mine';
const REC = 'rec';
const LS_CAT = 'mv3_hl_cat_v1';

// (phase V33.8, H2; the owner's (у7): "под подкасты - яркие, под документалку и факты - чуть сдержанней. типа рекомендованые, но
// оставить выбор и других групп субтитров") The caption groups recommended for a kind of video - first among the chips, marked
// "recommended", and open when the kind is chosen; every other group stays beside them.
export const RECOMMENDED = {
  podcast: { cats: ['viral', 'karaoke', 'pop'], said: 'bright, word by word - for a podcast' },
  documentary: { cats: ['classic', 'clean', 'cinema'], said: 'calm - for a documentary' },
  // (the owner's (в1)) auto: one tile, "by the video" - the agent's finding chooses between the style kept for podcast and the
  // one kept for documentary (lib/highlights-store.js styleOf).
  auto: { cats: [], byVideo: true, said: 'by the video - a talk gets your podcast style, a story told your documentary style' },
  // (phase V43) fragmentation - an episode or a show cut whole: people talking, as in a podcast.
  fragmentation: { cats: ['viral', 'karaoke', 'pop'], said: 'bright, word by word - for people talking' },
};

// "By the video" (V33.8, (в1)): not a preset but a choice between two - the last style chosen for each kind, remembered here.
export const BY_VIDEO = '@by-video';
const LS_KIND = 'mv3_hl_kind_style_v1';
const FIRST = { podcast: 'cp-podcast-viral', documentary: 'cl-white', fragmentation: 'cp-podcast-viral' };
const _known = (id) => !!(PRESETS.find((x) => x.id === id) || MyPresets.byId(id));
/** The style kept for a kind - the one last chosen while it was the kind, or the first answer (Podcast Viral, Classic White). */
export function styleFor(kind) {
  let m = {};
  try { m = JSON.parse(localStorage.getItem(LS_KIND) || '{}') || {}; } catch (e) { m = {}; }
  return _known(m[kind]) ? m[kind] : FIRST[kind];
}
/** A style chosen while the kind was podcast or documentary is kept for it. */
export function keepFor(kind, id) {
  if (!FIRST[kind] || !_known(id)) return;
  let m = {};
  try { m = JSON.parse(localStorage.getItem(LS_KIND) || '{}') || {}; } catch (e) { m = {}; }
  m[kind] = id;
  try { localStorage.setItem(LS_KIND, JSON.stringify(m)); } catch (e) { /* private */ }
}
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

/** A preset's name, the app's or the person's ('' for none); "by the video" for that choice. */
export function presetName(id) {
  if (id === BY_VIDEO) return 'by the video';
  const p = PRESETS.find((x) => x.id === id) || MyPresets.byId(id);
  return p ? p.name : '';
}

// ── The stills, and the loop under the cursor - a picker's tiles (V32), for the presets and the animations alike ──
// `tiles` - id -> { btn, box, img, over, loop, starting, end }; `ctx` - { state, alive } as the picker has them now.
function _player(tiles, ctx) {
  function paintStills() {
    const state = ctx.state;
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
    if (t.loop || t.starting || !t.img || !ctx.state) return;
    t.starting = true;
    let url = null;
    try {
      url = URL.createObjectURL(await _loopOf(ctx.state.base + encodeURIComponent(t.btn.dataset.id) + '.webp'));
      const img = new Image();
      img.className = 'mv3-cap-img';
      img.alt = '';
      img.draggable = false;
      img.src = url;
      await img.decode();
      if (!t.over || !ctx.alive || !t.btn.isConnected || t.btn.hidden) return;
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
  function stopLoop(t) {
    if (t.end) { clearTimeout(t.end); t.end = 0; }
    if (!t.loop) return;
    t.loop.img.remove();
    URL.revokeObjectURL(t.loop.url);
    t.loop = null;
  }
  function leave(t, loop) {
    t.over = false;
    if (!t.loop || t.end) return;
    const round = (loop || 2.5) * 1000;
    const left = round - ((performance.now() - t.loop.since) % round);
    t.end = setTimeout(() => { t.end = 0; stopLoop(t); }, Math.max(0, left - 40));
  }
  const stopNow = (t) => { t.over = false; stopLoop(t); };
  return { paintStills, enter, leave, stopNow };
}

// The tiles' state, asked once and followed while the set is being made (`first` - a category made first).
async function _follow(ctx, first, paint) {
  let d = null;
  try { d = await fetch('/api/mv3/captions/tiles').then((r) => r.json()); } catch (e) { d = null; }
  // A set not made yet (a library that never showed the captions view): made now, the category looked at first.
  if (d && d.success && !d.making && ((d.ready || []).length + (d.failed || []).length) < d.total) {
    try { d = await fetch('/api/mv3/captions/tiles/make', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ first: first || null }) }).then((r) => r.json()); }
    catch (e) { /* the names stand in */ }
  }
  for (let k = 0; ctx.alive && d && d.success; k++) {
    ctx.state = d;
    paint();
    if (!d.making || k > 60) break;
    await new Promise((r) => setTimeout(r, 1500));
    try { d = await fetch('/api/mv3/captions/tiles').then((r) => r.json()); } catch (e) { break; }
  }
}

// A press, with Shift or not (V49): Shift adds the tile to those chosen, or - chosen already - takes it away; without Shift, it alone.
function _press(chosen, id, shift) {
  if (!shift) return [id];
  return chosen.includes(id) ? chosen.filter((x) => x !== id) : chosen.concat([id]);
}

/**
 * A picker in `host`. `onPick(ids)` on a press - the styles chosen, one or (V49, Shift) several; `kind` (V33.8) - the video's kind,
 * whose recommended groups come first. Returns { set(ids), get() - the first, getAll(), recommend(kind), stop() } - stop() puts every
 * loop back to its still (the popup closed).
 */
export function stylePicker(host, { onPick, kind } = {}) {
  let cat = '';
  try { cat = JSON.parse(localStorage.getItem(LS_CAT) || '""') || ''; } catch (e) { cat = ''; }
  let chosen = [];
  const ctx = { state: null, alive: true };
  let rec = null;                  // (V33.8) RECOMMENDED[kind], or null
  const tiles = new Map();         // id -> { btn, box, ph, img, over, loop, starting, end }
  const P = _player(tiles, ctx);
  // A tile pressed: "by the video" is one choice by itself, and several styles replace it (пр25).
  const pick = (id, shift) => {
    chosen = id === BY_VIDEO ? [BY_VIDEO] : _press(chosen.filter((x) => x !== BY_VIDEO), id, shift);
    paintChosen();
    if (onPick) onPick(chosen.slice());
  };

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
    const chips = (recCats.length || (rec && rec.byVideo) ? [[REC, 'recommended', recCats.reduce((n, c) => n + countOf(c), rec.byVideo ? 1 : 0)]] : [])
      .concat([['', 'All', PRESETS.length + mine.length], [MINE, 'Mine', mine.length]])
      .concat(cats.map((c) => [c.id, c.label, countOf(c.id)]));
    for (const [id, label, n] of chips) {
      const b = _el('button', 'mv3-cap-cat' + (id === REC ? ' is-rec' : '') + (recCats.includes(id) ? ' is-rec-cat' : ''), label);
      b.type = 'button';
      b.dataset.cat = id;
      b.appendChild(_el('span', 'mv3-cap-n', ' ' + n));
      if (id === REC) b.title = 'Recommended for this kind of video: ' + rec.said + (recCats.length ? ' - ' + recCats.map((c) => CATEGORIES.find((x) => x.id === c).label).join(', ') : '');
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
    if (c === BY_VIDEO) return -20000;
    const i = c === MINE ? -1 : (rec ? rec.cats.indexOf(c) : -1);
    return (c === MINE ? -1 : i >= 0 ? i : 100) * 10000 + (+btn.dataset.i || 0);
  };

  // (V33.8, (в1)) The "by the video" tile: shown under "recommended" while the kind is auto; it says the two styles it chooses from.
  const byBtn = _el('button', 'mv3-cap-tile mv3-hls-by');
  byBtn.type = 'button';
  byBtn.dataset.id = BY_VIDEO;
  byBtn.dataset.cat = BY_VIDEO;
  byBtn.dataset.i = '-1';
  const byBox = _el('div', 'mv3-cap-box mv3-hls-by-box');
  const byName = _el('div', 'mv3-cap-name');
  byName.appendChild(_el('span', 'mv3-cap-nm', 'by the video'));
  byBtn.append(byBox, byName);
  byBtn.addEventListener('click', () => pick(BY_VIDEO, false));
  function paintBy() {
    byBox.textContent = '';
    const line = (what, kind) => {
      const l = _el('span', 'mv3-hls-by-l');
      l.appendChild(_el('small', null, what));
      l.appendChild(_el('b', null, presetName(styleFor(kind)) || styleFor(kind)));
      return l;
    };
    byBox.append(line('a talk →', 'podcast'), line('a story told →', 'documentary'));
    byBtn.title = 'The agent decides what the video is: a talk (podcast, vlog, reaction, monologue, stream) gets «' + presetName(styleFor('podcast'))
      + '», a story told (documentary, lecture, tutorial, sermon) gets «' + presetName(styleFor('documentary'))
      + '» - the styles you last chose for podcast and for documentary';
  }

  // The person's first, newest first (as in the captions view), then the app's.
  for (const p of mine.concat(PRESETS)) {
    const isMine = !!MyPresets.byId(p.id);
    const btn = _el('button', 'mv3-cap-tile');
    btn.type = 'button';
    btn.dataset.id = p.id;
    btn.dataset.cat = isMine ? MINE : p.category;
    btn.dataset.i = String(tiles.size);
    btn.title = p.name + ' - the captions of every fragment; Shift adds it to those chosen - each page one of them';
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
    btn.addEventListener('click', (e) => pick(p.id, !!(e && e.shiftKey)));
    btn.addEventListener('pointerenter', () => P.enter(t));
    btn.addEventListener('pointerleave', () => P.leave(t, ctx.state && ctx.state.loop));
    tiles.set(p.id, t);
    grid.appendChild(btn);
  }
  grid.insertBefore(byBtn, grid.firstChild);
  byBtn.hidden = true;

  function paintCat() {
    if (cat === REC && !rec) cat = '';
    for (const b of top.children) b.classList.toggle('is-on', (b.dataset.cat || '') === cat);
    for (const t of tiles.values()) {
      t.btn.hidden = cat === REC ? !rec.cats.includes(t.btn.dataset.cat) : (!!cat && t.btn.dataset.cat !== cat);
      if (t.btn.hidden) P.stopNow(t);
    }
    byBtn.hidden = !(cat === REC && rec && rec.byVideo);
  }

  /** (V33.8) The video's kind changed: its recommended groups first, and open - the style chosen stays chosen. */
  function recommend(k) {
    rec = RECOMMENDED[k] || null;
    if (rec && rec.byVideo) paintBy();
    paintChips();
    if (rec) cat = REC;
    paintCat();
  }

  function paintChosen() {
    for (const [k, t] of tiles) t.btn.classList.toggle('is-on', chosen.includes(k));
    byBtn.classList.toggle('is-on', chosen.includes(BY_VIDEO));
  }
  /** The styles chosen, one or several (V49) - those no longer there are left out. */
  function set(ids) {
    const list = (Array.isArray(ids) ? ids : [ids]).filter((id) => id && (tiles.has(id) || id === BY_VIDEO));
    chosen = list.includes(BY_VIDEO) ? [BY_VIDEO] : [...new Set(list)];
    paintChosen();
  }

  _follow(ctx, cat, P.paintStills);
  recommend(kind);
  return {
    set, get: () => chosen[0] || '', getAll: () => chosen.slice(), recommend,
    stop: () => { ctx.alive = false; for (const t of tiles.values()) P.stopNow(t); },
  };
}

/** A pair's name (V49): "from the top → down"; '' for none. */
export const pairName = (pair) => { const p = PAIRS.find((x) => x.id === pair); return p ? p.name : ''; };

/**
 * THE ANIMATIONS (V49, the owner's (пр26)): the In -> Out pairs' tiles in `host`, one chosen - or several with Shift, dealt page by
 * page. `onPick(pairs)` on a press. Returns { set(pairs), getAll(), stop() }.
 */
export function animPicker(host, { onPick } = {}) {
  let chosen = [];
  const ctx = { state: null, alive: true };
  const tiles = new Map();         // tile id -> { btn, box, img, … }
  const P = _player(tiles, ctx);
  host.appendChild(_el('div', 'mv3-cap-note', 'How a page comes in and goes out - one for every page, or several with Shift: each page one of them.'));
  const grid = _el('div', 'mv3-cap-grid mv3-hls-grid');
  host.appendChild(grid);
  for (const p of PAIRS) {
    const id = animTileId(p.id);
    const btn = _el('button', 'mv3-cap-tile');
    btn.type = 'button';
    btn.dataset.id = id;
    btn.dataset.pair = p.id;
    btn.title = p.name + ' - every fragment\'s pages; Shift adds it to those chosen';
    const box = _el('div', 'mv3-cap-box');
    const ph = _el('span', 'mv3-cap-ph', p.name);
    ph.style.fontFamily = '"Montserrat Black", "Liberation Sans", sans-serif';
    ph.style.color = '#ffffff';
    box.appendChild(ph);
    const name = _el('div', 'mv3-cap-name');
    name.appendChild(_el('span', 'mv3-cap-nm', p.name));
    btn.append(box, name);
    const t = { btn, box, ph, img: null, over: false, loop: null, starting: false, end: 0 };
    btn.addEventListener('click', (e) => { chosen = _press(chosen, p.id, !!(e && e.shiftKey)); paint(); if (onPick) onPick(chosen.slice()); });
    btn.addEventListener('pointerenter', () => P.enter(t));
    btn.addEventListener('pointerleave', () => P.leave(t, ctx.state && ctx.state.animLoop));
    tiles.set(id, t);
    grid.appendChild(btn);
  }
  function paint() { for (const t of tiles.values()) t.btn.classList.toggle('is-on', chosen.includes(t.btn.dataset.pair)); }
  _follow(ctx, 'anim', P.paintStills);
  return {
    set: (pairs) => { chosen = [...new Set((Array.isArray(pairs) ? pairs : []).filter((x) => PAIRS.some((p) => p.id === x)))]; paint(); },
    getAll: () => chosen.slice(),
    stop: () => { ctx.alive = false; for (const t of tiles.values()) P.stopNow(t); },
  };
}
