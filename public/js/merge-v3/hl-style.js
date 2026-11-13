/* ═══════════════════════════════════════════════════════════════════════════
   MERGE v3 — the CAPTION STYLE of a highlights project, chosen in its popup - a field of its own; the highlights are sent
   off only once a style is chosen.

   The captions view's own tiles (captions-view.js), in a picker of their own: the categories over them -
   All, Viral, Pop… -, every preset of the app, each showing its STILL and playing its
   loop only under the cursor (the loop asked for at the first hover, from its start each time, its round finished
   when the cursor leaves). A press CHOOSES - nothing is applied to any lane here: the style goes to every fragment of
   the project. The tiles are the server's (lib/caption-tiles.js); one not made yet shows the preset's name in
   its own font and colour, and the set is asked to be made once.

   SEVERAL WITH SHIFT: Shift on a tile adds it to those chosen or takes it away - every
   fragment gets the same set, dealt page by page (public/js/captions/mix.js); several replace "by the video". The popup's second
   tab is the animations (animPicker): the In -> Out pairs of the captions view's "animation" tab (captions/page-fx.js PAIRS), its
   tiles the same server's, one or several with Shift.

   WHAT IS CHOSEN, SHOWN: the popup writes the chosen ones in rows under its tabs; a press on one calls `reveal` -
   its group opens, the tile is scrolled to and outlined in gold. A picker opens on the group of the first one chosen (`openFirst`)
   - not on "recommended", which would hide the chosen ones of other groups. What a kind remembers is merge-v3/hl-kinds.js.
   ═══════════════════════════════════════════════════════════════════════════ */

import { PRESETS, CATEGORIES } from '../captions/presets.js';
import { cssWeight } from '../captions/fonts.js';
import { PAIRS, animTileId } from '../captions/page-fx.js';
import { BY_VIDEO, styleFor as _styleFor, settingsOf, standardOf, BY_VIDEO_KINDS } from './hl-kinds.js';
import { KINDS as TABLE } from '../highlights/kinds.js';

const REC = 'rec';

// The caption groups recommended for a kind of video - first among the chips, marked
// "recommended", and open when the kind is chosen; every other group stays beside them.
// The table's - public/js/highlights/kinds.js `presets.rec` and `said` (documentary has no classic: it cuts by
// sentences, and highlights cut by pages). auto: one tile, "by the video" - the kind it finds gives its own set.
export const RECOMMENDED = Object.fromEntries(Object.entries(TABLE).filter(([, v]) => v.button !== false)
  .map(([k, v]) => [k, { cats: v.presets.rec.slice(), said: v.presets.said, ...(k === 'auto' ? { byVideo: true } : {}) }]));

// "By the video": not a preset - the kind auto finds gives its own captions (hl-kinds.js byVideoSets); `styleFor` is a
// kind's first style (hl-kinds.js styleFor).
export { BY_VIDEO };
const _known = (id) => PRESETS.some((x) => x.id === id);
/** The style a kind gives "by the video" - the first it remembers, or the app's first answer (Podcast Viral, Classic White). */
export const styleFor = (kind) => _styleFor(kind, _known);
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

/** A preset's name ('' for none); "by the video" for that choice. */
export function presetName(id) {
  if (id === BY_VIDEO) return 'by the video';
  const p = PRESETS.find((x) => x.id === id);
  return p ? p.name : '';
}

// ── The stills, and the loop under the cursor - a picker's tiles, for the presets and the animations alike ──
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

// A press, with Shift or not: Shift adds the tile to those chosen, or - chosen already - takes it away; without Shift, it alone.
function _press(chosen, id, shift) {
  if (!shift) return [id];
  return chosen.includes(id) ? chosen.filter((x) => x !== id) : chosen.concat([id]);
}

// A tile shown on request: scrolled to inside its grid and outlined in gold until another press.
function _spot(grid, btn) {
  for (const b of grid.querySelectorAll('.is-spot')) b.classList.remove('is-spot');
  if (!btn || btn.hidden) return;
  btn.classList.add('is-spot');
  const g = grid.getBoundingClientRect(), r = btn.getBoundingClientRect();
  if (r.top < g.top || r.bottom > g.bottom) grid.scrollTop += r.top - g.top - (g.height - r.height) / 2;
}

/**
 * A picker in `host`. `onPick(ids)` on a press - the styles chosen, one or (Shift) several; `kind` - the video's kind,
 * whose recommended groups come first. Returns { set(ids), get() - the first, getAll(), recommend(kind), openFirst(), reveal(id),
 * stop() } - stop() puts every loop back to its still (the popup closed).
 */
export function stylePicker(host, { onPick, kind } = {}) {
  let cat = '';
  let chosen = [];
  const ctx = { state: null, alive: true };
  let rec = null;                  // RECOMMENDED[kind], or null
  const tiles = new Map();         // id -> { btn, box, ph, img, over, loop, starting, end }
  const P = _player(tiles, ctx);
  // A tile pressed: "by the video" is one choice by itself, and several styles replace it.
  const pick = (id, shift) => {
    _spot(grid, null);
    chosen = id === BY_VIDEO ? [BY_VIDEO] : _press(chosen.filter((x) => x !== BY_VIDEO), id, shift);
    paintChosen();
    if (onPick) onPick(chosen.slice());
  };

  const top = _el('div', 'mv3-cap-cats mv3-hls-cats');
  const grid = _el('div', 'mv3-cap-grid mv3-hls-grid');
  host.append(top, grid);

  const countOf = (id) => PRESETS.filter((p) => p.category === id).length;
  // The chips: the kind's recommended groups first - one chip "recommended" for all of them -, then All and
  // the groups, the recommended ones first, each marked.
  function paintChips() {
    top.textContent = '';
    const recCats = rec ? rec.cats.filter((c) => CATEGORIES.some((x) => x.id === c)) : [];
    const cats = recCats.map((id) => CATEGORIES.find((x) => x.id === id)).concat(CATEGORIES.filter((c) => !recCats.includes(c.id)));
    const chips = (recCats.length || (rec && rec.byVideo) ? [[REC, 'recommended', recCats.reduce((n, c) => n + countOf(c), rec.byVideo ? 1 : 0)]] : [])
      .concat([['', 'All', PRESETS.length]])
      .concat(cats.map((c) => [c.id, c.label, countOf(c.id)]));
    for (const [id, label, n] of chips) {
      const b = _el('button', 'mv3-cap-cat' + (id === REC ? ' is-rec' : '') + (recCats.includes(id) ? ' is-rec-cat' : ''), label);
      b.type = 'button';
      b.dataset.cat = id;
      b.appendChild(_el('span', 'mv3-cap-n', ' ' + n));
      if (id === REC) b.title = 'Recommended for this kind of video: ' + rec.said + (recCats.length ? ' - ' + recCats.map((c) => CATEGORIES.find((x) => x.id === c).label).join(', ') : '');
      else if (recCats.includes(id)) b.title = 'Recommended for this kind of video';
      b.addEventListener('click', () => { cat = id; _spot(grid, null); paintCat(); });
      top.appendChild(b);
    }
    // The tiles in the same order: the recommended groups', the rest.
    const order = [...grid.children].sort((a, b) => _rank(a) - _rank(b));
    for (const el of order) grid.appendChild(el);
  }
  const _rank = (btn) => {
    const c = btn.dataset.cat;
    if (c === BY_VIDEO) return -20000;
    const i = rec ? rec.cats.indexOf(c) : -1;
    return (i >= 0 ? i : 100) * 10000 + (+btn.dataset.i || 0);
  };

  // The "by the video" tile: shown under "recommended" while the kind is auto; it says the sets it chooses from.
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
  // Each kind auto may find, with the set it would wear - as that kind remembers its captions here.
  function paintBy() {
    byBox.textContent = '';
    byBox.classList.add('is-kinds');
    const said = [];
    for (const k of BY_VIDEO_KINDS) {
      const ids = (k === 'other' ? standardOf('other') : settingsOf(k, null, [])).styles.filter((id) => id !== BY_VIDEO && _known(id));
      const l = _el('span', 'mv3-hls-by-l');
      const label = (TABLE[k] && TABLE[k].label) || k;
      l.appendChild(_el('small', null, label.split(' · ')[0]));
      const nm = ids.length ? (presetName(ids[0]) || ids[0]) + (ids.length > 1 ? ' +' + (ids.length - 1) : '') : 'its standard';
      l.appendChild(_el('b', null, nm));
      byBox.appendChild(l);
      said.push(label + ' → ' + nm);
    }
    byBtn.title = 'The agent finds out what the video is, and the fragments get that kind\'s captions as you last chose them for it: ' + said.join('; ');
  }

  for (const p of PRESETS) {
    const btn = _el('button', 'mv3-cap-tile');
    btn.type = 'button';
    btn.dataset.id = p.id;
    btn.dataset.cat = p.category;
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

  /** The video's kind changed: its recommended groups first among the chips - the style chosen stays chosen. */
  function recommend(k) {
    rec = RECOMMENDED[k] || null;
    if (rec && rec.byVideo) paintBy();
    paintChips();
    paintCat();
  }
  // The group a chosen tile is in: "by the video" under "recommended"; else its category.
  const groupOf = (id) => (id === BY_VIDEO ? REC : (tiles.get(id) ? tiles.get(id).btn.dataset.cat : ''));
  /** Open on the group of the first one chosen - none chosen: "recommended" when the kind has it, else All. */
  function openFirst() {
    const g = chosen.length ? groupOf(chosen[0]) : (rec ? REC : '');
    cat = g === REC && !rec ? '' : g;
    _spot(grid, null);
    paintCat();
    grid.scrollTop = 0;
    if (chosen.length) _spot(grid, chosen[0] === BY_VIDEO ? byBtn : tiles.get(chosen[0]).btn);
  }
  /** Show tile `id`: its group open, the tile scrolled to and outlined in gold. */
  function reveal(id) {
    const g = groupOf(id);
    cat = g === REC && !rec ? '' : g;
    paintCat();
    _spot(grid, id === BY_VIDEO ? byBtn : (tiles.get(id) && tiles.get(id).btn));
  }

  function paintChosen() {
    for (const [k, t] of tiles) t.btn.classList.toggle('is-on', chosen.includes(k));
    byBtn.classList.toggle('is-on', chosen.includes(BY_VIDEO));
  }
  /** The styles chosen, one or several - those not found are left out. */
  function set(ids) {
    const list = (Array.isArray(ids) ? ids : [ids]).filter((id) => id && (tiles.has(id) || id === BY_VIDEO));
    chosen = list.includes(BY_VIDEO) ? [BY_VIDEO] : [...new Set(list)];
    paintChosen();
  }

  _follow(ctx, cat, P.paintStills);
  recommend(kind);
  return {
    set, get: () => chosen[0] || '', getAll: () => chosen.slice(), recommend, openFirst, reveal,
    stop: () => { ctx.alive = false; for (const t of tiles.values()) P.stopNow(t); },
  };
}

/** A pair's name: "from the top → down"; '' for none. */
export const pairName = (pair) => { const p = PAIRS.find((x) => x.id === pair); return p ? p.name : ''; };

/**
 * THE ANIMATIONS: the In -> Out pairs' tiles in `host`, one chosen - or several with Shift, dealt page by
 * page. `onPick(pairs)` on a press. Returns { set(pairs), getAll(), reveal(pair), stop() }.
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
    btn.addEventListener('click', (e) => { _spot(grid, null); chosen = _press(chosen, p.id, !!(e && e.shiftKey)); paint(); if (onPick) onPick(chosen.slice()); });
    btn.addEventListener('pointerenter', () => P.enter(t));
    btn.addEventListener('pointerleave', () => P.leave(t, ctx.state && ctx.state.animLoop));
    tiles.set(id, t);
    grid.appendChild(btn);
  }
  function paint() { for (const t of tiles.values()) t.btn.classList.toggle('is-on', chosen.includes(t.btn.dataset.pair)); }
  _follow(ctx, 'anim', P.paintStills);
  // The kind's recommended pairs: marked and first.
  let rec = [];
  function recommend(pairs) {
    rec = Array.isArray(pairs) ? pairs.slice() : [];
    const rank = (btn) => { const i = rec.indexOf(btn.dataset.pair); return i >= 0 ? i : 100 + PAIRS.findIndex((x) => x.id === btn.dataset.pair); };
    for (const t of tiles.values()) {
      const on = rec.includes(t.btn.dataset.pair);
      t.btn.classList.toggle('is-rec', on);
      t.btn.title = (PAIRS.find((x) => x.id === t.btn.dataset.pair) || {}).name + (on ? ' - recommended for this kind of video' : '') + ' - every fragment\'s pages; Shift adds it to those chosen';
    }
    for (const el of [...grid.children].sort((a, b) => rank(a) - rank(b))) grid.appendChild(el);
  }
  return {
    recommend,
    set: (pairs) => { chosen = [...new Set((Array.isArray(pairs) ? pairs : []).filter((x) => PAIRS.some((p) => p.id === x)))]; paint(); },
    getAll: () => chosen.slice(),
    // Show pair `pair`'s tile: scrolled to and outlined in gold.
    reveal: (pair) => { const t = tiles.get(animTileId(pair)); _spot(grid, t && t.btn); },
    stop: () => { ctx.alive = false; for (const t of tiles.values()) P.stopNow(t); },
  };
}
