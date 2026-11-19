/* ═══════════════════════════════════════════════════════════════════════════
   MERGE v3 — "LIBRARY / captions": the preset tiles.

   While captions are picked on the timeline - a subtitle or text lane, one caption, several - the
   Library panel shows the 131 preset styles on the left and the settings of what is picked in the strip
   on the right (inspector.js). A press on a tile applies the preset to what is picked, at once and as one
   step to undo; the tile of the preset it wears is lit, and says `edited` when it was changed since.
   The tiles are always there when the window has room for them; a window too narrow shows the strip alone.

   A tile is a 2.5 s loop made by the SERVER with the render's own builder and ffmpeg
   (lib/caption-tiles.js) - what it shows is what the render draws: a dark square with the words in its
   middle. Until it is made, the tile shows the preset's name in its own font and color. The
   tiles are built ONCE and live outside the strip, which is rebuilt on every change: 131 animations
   rebuilt per press would be the page's whole evening.

   A TILE SHOWS ITS STILL, AND PLAYS ONLY UNDER THE CURSOR (every loop loaded at once is slow). The view asks for the
   stills alone - the frame at 0.3 s, made beside each loop. The cursor on a tile asks for
   its loop (once; then kept) and plays it in the tile over the still, from its start every time; the cursor gone, the
   loop finishes its round and the still comes back - back while it finishes, it plays on. The view hidden, another
   category or tab: the still at once.

   TWO TABS over them: `presets` - the tiles - and `text` - the words of the
   subtitle and text lanes as one document, in the tiles' place (caption-doc.js); the strip on the right stays. The tab
   last chosen is remembered.

   TWO GALLERIES: what is picked says which - a text lane or text lines get the TEXT
   presets (presets-text.js: Headline, Hook, Label, Callout, Kinetic), everything else the caption presets. Each
   has its own categories and its own category remembered; the tiles of the other gallery are hidden, not rebuilt. A text tile loops for 3 s (lib/caption-tiles.js).

   THE ANIMATIONS: a tab `animation` between `presets` and `text` - tiles of ready In ->
   Out pairs (captions/page-fx.js PAIRS), drawn by the server like the presets' (lib/caption-tiles.js) and shown the same way:
   the still, the motion under the cursor. A press puts the pair on what is picked (the inspector says how: `onAnim`); the
   pair it wears is lit. With Shift a press picks several: the inspector deals them out, and every
   preset and pair the pick wears is lit.

   THE FONTS: a tab `fonts` between `animation` and `text`, on both kinds of lane - the
   fonts drawn as tiles (merge-v3/font-tiles.js, one module with the highlights popup). On a lane a press is its one font, Shift
   several dealt over its preset's (each page as wide as in the preset's font); on lines a press is their own font. The fonts
   the pick wears are lit (`fonts` of what show() is told).

   Which view shows, the header and the room are lib-views.js's; this only draws the tiles and the tabs.
   ═══════════════════════════════════════════════════════════════════════════ */

import { PRESETS, CATEGORIES } from '../captions/presets.js';
import { TEXT_PRESETS, TEXT_CATEGORIES } from '../captions/presets-text.js';
import { PAIRS, animTileId } from '../captions/page-fx.js';
import { cssWeight } from '../captions/fonts.js';
import * as Doc from './caption-doc.js';
import { fontPicker } from './font-tiles.js';
// The module's own variables are called `t` (tabs, tiles): the words come in as T.t.
import * as T from '../i18n/t.js';

const LS_CAT = 'mv3_cap_cat_v1';
const LS_CAT_TEXT = 'mv3_cap_cat_text_v1';
const LS_TAB = 'mv3_cap_tab_v1';
const TABS = [['presets', T.t('Presets'), T.t('The preset styles - a press applies one to what is picked')],
  ['anim', T.t('Animation'), T.t('How a page comes in and goes out - a press puts a pair on what is picked')],
  ['fonts', T.t('Fonts'), T.t('The letters - a press puts a font on what is picked; on a lane Shift picks several, each page one of them')],
  ['text', T.t('Text'), T.t('The words of the subtitle and text lanes as one document - edit, cut and join lines, find and replace')]];
const TAB_IDS = TABS.map((t) => t[0]);
// The animations' tiles: the pair's In -> Out on plain white letters; until the still is made, its name in these.
const ANIM_LOOK = { font: 'Montserrat Black', bold: true, primary: '#ffffff' };
const POLL_MS = 1500;

const _store = (k, fb) => { try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v == null ? fb : v; } catch (e) { return fb; } };
const _keep = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* a private window */ } };
const _el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

let _ui = null;
const _tiles = new Map();          // preset id -> { btn, box, ed, nm, ph, img, over, loop, starting, end }
const _anims = new Map();          // an animation's pair 'in|out' -> its tile, the same shape
const _loops = new Map();          // a loop's address -> Promise<Blob>: asked at its first hover, then kept
let _target = null;                // what show() was last told: the preset the pick wears
let _state = null;
let _timer = 0;
let _shown = false;
let _asked = false;
// The gallery shown - 'subs' or 'text' - and each one's category: '' (All) or one of its own (a category it no longer has
// is All).
let _kind = 'subs';
const _catOk = (cats, id) => (cats.some((c) => c.id === id) ? id : '');
const _cats = { subs: _catOk(CATEGORIES, _store(LS_CAT, '')), text: _catOk(TEXT_CATEGORIES, _store(LS_CAT_TEXT, '')) };
const _kindOf = (p) => (p && p.kind === 'text' ? 'text' : 'subs');
let _tab = TAB_IDS.includes(_store(LS_TAB, 'presets')) ? _store(LS_TAB, 'presets') : 'presets';
let _apply = null;
let _applyAnim = null;
let _applyFonts = null;
let _fonts = null;                 // the fonts tab's picker
let _retries = 0;           // makes asked again for a set left incomplete (a restart, a make that could not start)
let _reading = false;

/** What a press on a tile does - the inspector knows what is picked. */
export function onApply(fn) { _apply = typeof fn === 'function' ? fn : null; }
/** What a press on an animation's tile does: fn(pair 'in|out'). */
export function onAnim(fn) { _applyAnim = typeof fn === 'function' ? fn : null; }
/** What a press on a font's tile does: fn(families chosen, { shift, family }). */
export function onFonts(fn) { _applyFonts = typeof fn === 'function' ? fn : null; }

// Every tile of both kinds, and one by the id its files are named by.
const _allTiles = () => [..._tiles.values(), ..._anims.values()];
const _byId = (id) => _tiles.get(id) || [..._anims.values()].find((t) => t.btn.dataset.id === id) || null;
// The tab a tile is shown in.
const _tabOf = (t) => (t.kind === 'anim' ? 'anim' : 'presets');

function _build() {
  const host = document.getElementById('mv3-cap');
  if (!host || _ui) return;
  host.textContent = '';
  const top = _el('div', 'mv3-cap-top');
  const chips = _el('div', 'mv3-cap-cats');
  // A row of chips per gallery, the other's hidden.
  for (const [kind, cats, list] of [['subs', CATEGORIES, PRESETS], ['text', TEXT_CATEGORIES, TEXT_PRESETS]]) {
    // The categories' names are the tables' English, shown in the app's language (captions/presets.js, presets-text.js).
    const all = [['', T.t('All'), list.length]].concat(cats.map((c) => [c.id, T.t(c.label), list.filter((p) => p.category === c.id).length]));
    for (const [id, label, n] of all) {
      // the shared chip, its count in mono
      const b = _el('button', 'mv3-cap-cat u-chip', label);
      b.type = 'button';
      b.dataset.cat = id;
      b.dataset.kind = kind;
      b.appendChild(_el('span', 'mv3-cap-n u-mono', String(n)));
      b.addEventListener('click', () => _setCat(id));
      chips.appendChild(b);
    }
  }
  const status = _el('div', 'mv3-cap-status');
  top.appendChild(chips);
  top.appendChild(status);
  const tabs = _el('div', 'mv3-cap-tabs u-tabs');
  tabs.setAttribute('role', 'tablist');
  for (const [id, label, title] of TABS) {
    const b = _el('button', 'mv3-cap-tab u-tab', label);
    b.type = 'button';
    b.dataset.tab = id;
    b.title = title;
    b.setAttribute('role', 'tab');
    b.addEventListener('click', () => _setTab(id));
    tabs.appendChild(b);
  }
  const grid = _el('div', 'mv3-cap-grid');
  for (const p of PRESETS.concat(TEXT_PRESETS)) {
    const t = _tile(p);
    grid.appendChild(t.btn);
    _tiles.set(p.id, t);
  }
  const presets = _el('div', 'mv3-cap-pane');
  presets.append(top, grid);
  // The animations: a line on what a press does, and the pairs' tiles.
  const anim = _el('div', 'mv3-cap-pane');
  const atop = _el('div', 'mv3-cap-top');
  atop.appendChild(_el('div', 'mv3-cap-note', T.t('How a page comes in and goes out. A press puts the pair on what is picked; In and Out on the right change each side by itself.')));
  const agrid = _el('div', 'mv3-cap-grid');
  for (const p of PAIRS) {
    const t = _tile({ id: animTileId(p.id), name: p.name, pair: p.id, kind: 'anim', style: ANIM_LOOK });
    agrid.appendChild(t.btn);
    _anims.set(p.id, t);
  }
  anim.append(atop, agrid);
  // The fonts: what a press does is the inspector's.
  const fonts = _el('div', 'mv3-cap-pane mv3-cap-fonts');
  const ftop = _el('div', 'mv3-cap-top');
  fonts.appendChild(ftop);
  _fonts = fontPicker(fonts, { onPick: (list, o) => { if (_applyFonts) _applyFonts(list, o); } });
  ftop.appendChild(_el('div', 'mv3-cap-note', T.t('The letters over the preset\'s own: on a lane one font for every page, or several with Shift - each page one of them, as wide as in the preset\'s font; colors, outline and motion stay the preset\'s.')));
  const text = _el('div', 'mv3-cap-pane');
  host.append(tabs, presets, anim, fonts, text);
  Doc.mount(text);
  _ui = { host, tabs, presets, anim, agrid, fonts, text, top, chips, status, grid };
  _paintCat();
  _paintTab();
}

// One tile: the still when it is made (the loop under the cursor), until then the name in the preset's own font and color.
// The name is the table's English (it is also what a preset is stored and sent as), shown in the app's language.
function _tile(p) {
  const btn = _el('button', 'mv3-cap-tile');
  const anim = p.kind === 'anim';
  const shown = T.t(p.name);
  btn.type = 'button';
  btn.dataset.id = p.id;
  btn.dataset.cat = anim ? 'anim' : p.category;
  btn.dataset.kind = anim ? 'anim' : _kindOf(p);
  btn.title = anim ? T.t('{name} - put it on what is picked', { name: shown }) : T.t('{name} - apply to what is picked', { name: shown });
  const box = _el('div', 'mv3-cap-box');
  const ph = _el('span', 'mv3-cap-ph', shown);
  const s = p.style || {};
  ph.style.fontFamily = '"' + s.font + '", "Liberation Sans", sans-serif';
  ph.style.fontWeight = String(cssWeight(s.font, s.bold));
  ph.style.color = s.primary || '#ffffff';
  if (s.casing === 'upper') ph.style.textTransform = 'uppercase';
  box.appendChild(ph);
  const name = _el('div', 'mv3-cap-name');
  const nm = _el('span', 'mv3-cap-nm', shown);
  name.appendChild(nm);
  const ed = _el('span', 'mv3-cap-ed', T.t('Edited'));
  ed.hidden = true;
  name.appendChild(ed);
  btn.appendChild(box);
  btn.appendChild(name);
  const t = { btn, box, ed, nm, ph, kind: anim ? 'anim' : _kindOf(p) };
  // Shift picks several: what is picked deals them out - the inspector says how.
  btn.addEventListener('click', (e) => {
    const o = { shift: !!(e && e.shiftKey) };
    if (anim) { if (_applyAnim) _applyAnim(p.pair, o); } else if (_apply) _apply(p.id, o);
  });
  btn.addEventListener('pointerenter', () => _enter(t));
  btn.addEventListener('pointerleave', () => _leave(t));
  return t;
}

// ── The loop under the cursor ──────────────────────────────────────────────
// Played from a fresh blob address each time: the same address would go on from the frame it was left at.
function _loopOf(url) {
  let p = _loops.get(url);
  if (!p) {
    p = fetch(url).then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.blob(); });
    p.catch(() => _loops.delete(url));                // not got: the next hover asks again
    _loops.set(url, p);
  }
  return p;
}

async function _enter(t) {
  t.over = true;
  if (t.end) { clearTimeout(t.end); t.end = 0; }      // back while it finishes its round: it plays on
  if (t.loop || t.starting || !t.img || !_state || _tab !== _tabOf(t)) return;
  t.starting = true;
  let url = null;
  try {
    url = URL.createObjectURL(await _loopOf(_state.base + encodeURIComponent(t.btn.dataset.id) + '.webp'));
    const img = new Image();
    img.className = 'mv3-cap-img';
    img.alt = '';
    img.draggable = false;
    img.src = url;
    await img.decode();
    // Left before it could start - the cursor, the view, the tile: nothing is shown, the still stays.
    if (!t.over || !_shown || !t.btn.isConnected || t.btn.hidden) return;
    t.box.appendChild(img);
    t.loop = { img, url, since: performance.now() };
    url = null;
    // Its round is counted from the frame it is first painted in.
    requestAnimationFrame(() => { if (t.loop && t.loop.img === img) t.loop.since = performance.now(); });
  } catch (e) {
    /* the loop could not be had: the still stays */
  } finally {
    t.starting = false;
    if (url) URL.revokeObjectURL(url);
  }
}

// The cursor gone: the loop plays to the end of its round, then the still - a little early rather than late, where the
// next round's first frame would flash (empty, for a fade).
function _leave(t) {
  t.over = false;
  if (!t.loop || t.end) return;
  const round = ((_state && (t.kind === 'text' ? _state.textLoop : t.kind === 'anim' ? _state.animLoop : _state.loop)) || 2.5) * 1000;
  const left = round - ((performance.now() - t.loop.since) % round);
  t.end = setTimeout(() => { t.end = 0; _stop(t); }, Math.max(0, left - 40));
}

function _stop(t) {
  if (t.end) { clearTimeout(t.end); t.end = 0; }
  if (!t.loop) return;
  t.loop.img.remove();
  URL.revokeObjectURL(t.loop.url);
  t.loop = null;
}

// The still at once, without finishing the round: the view hidden, another tab, a tile hidden or gone.
function _stopNow(t) {
  t.over = false;
  _stop(t);
}

// The tile of the preset the pick wears is lit, and says `edited` when it was changed since; so is the pair of its In and Out
// (`anims`). A lane wearing several (`presets`) has them all lit, each `edited` that was (`editedIds`).
function _light() {
  const t = _target || {};
  const lit = new Set(Array.isArray(t.presets) ? t.presets : (t.preset ? [t.preset] : []));
  const ed = new Set(Array.isArray(t.editedIds) ? t.editedIds : (t.edited && t.preset ? [t.preset] : []));
  for (const [id, x] of _tiles) {
    const on = lit.has(id);
    x.btn.classList.toggle('is-on', on);
    x.ed.hidden = !(on && ed.has(id));
  }
  const pairs = new Set(t.anims || []);
  for (const [pair, x] of _anims) x.btn.classList.toggle('is-on', pairs.has(pair));
  if (_fonts) _fonts.set(t.fonts || []);
}

function _setTab(id) {
  _tab = TAB_IDS.includes(id) ? id : 'presets';
  _keep(LS_TAB, _tab);
  _paintTab();
  Doc.setShown(_shown && _tab === 'text');
  for (const t of _allTiles()) if (_tabOf(t) !== _tab) _stopNow(t);
  if (_tab !== 'text') revealLit();
  // The animations looked at are made first.
  if (_tab === 'anim' && _state && _state.making) _read(true);
}

function _paintTab() {
  if (!_ui) return;
  for (const b of _ui.tabs.children) {
    const on = b.dataset.tab === _tab;
    b.classList.toggle('is-on', on);
    b.setAttribute('aria-selected', on ? 'true' : 'false');
  }
  _ui.presets.hidden = _tab !== 'presets';
  _ui.anim.hidden = _tab !== 'anim';
  _ui.fonts.hidden = _tab !== 'fonts';
  _ui.text.hidden = _tab !== 'text';
  if (_fonts) _fonts.shown(_shown && _tab === 'fonts');
}

function _setCat(id) {
  _cats[_kind] = id || '';
  _keep(_kind === 'text' ? LS_CAT_TEXT : LS_CAT, _cats[_kind]);
  _paintCat();
  // The category looked at is made first.
  if (_state && _state.making && _cats[_kind]) _read(true);
}

// The gallery's chips and tiles shown, the other's hidden, and within it the category.
function _paintCat() {
  if (!_ui) return;
  const cat = _cats[_kind];
  for (const b of _ui.chips.children) {
    b.hidden = b.dataset.kind !== _kind;
    b.classList.toggle('is-on', !b.hidden && (b.dataset.cat || '') === cat);
  }
  for (const t of _tiles.values()) {
    t.btn.hidden = t.kind !== _kind || (!!cat && t.btn.dataset.cat !== cat);
    if (t.btn.hidden) _stopNow(t);
  }
}

function _paintState() {
  if (!_ui || !_state) return;
  for (const id of (_state.ready || [])) {
    const t = _byId(id);
    if (!t || t.img) continue;
    const img = new Image();
    img.className = 'mv3-cap-img';
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.draggable = false;
    img.addEventListener('load', () => t.box.classList.add('is-ready'));
    // The still; the loop is asked for under the cursor (_enter).
    img.src = _state.base + encodeURIComponent(id) + (_state.still || '.first.webp');
    t.box.appendChild(img);
    t.img = img;
  }
  const n = (_state.ready || []).length;
  const total = _state.total;
  _ui.status.textContent = _state.making ? (_state.waiting ? T.t('making the previews {n}/{total} - waiting for the render', { n, total })
      : T.t('making the previews {n}/{total}', { n, total }))
    : _state.error ? T.t('the previews could not be made ({error}) - the styles still apply', { error: _state.error })
    : (_state.failed || []).length ? T.tn(_state.failed.length, '{n} preview could not be made - the styles still apply',
      '{n} previews could not be made - the styles still apply')
    : _incomplete(_state) ? T.t('previews {n}/{total}', { n, total }) : '';
  _ui.status.hidden = !_ui.status.textContent;
}

// A set the server is not making and has not finished: a make lost to a restart, or one that could not start.
const _incomplete = (s) => !!s && !s.making && ((s.ready || []).length + (s.failed || []).length) < s.total;

async function _read(make) {
  if (_timer) { clearTimeout(_timer); _timer = 0; }
  // One read at a time: a repaint during a read would start a second chain of reads.
  if (_reading) return;
  _reading = true;
  let d = null;
  try {
    d = make
      ? await fetch('/api/mv3/captions/tiles/make', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ first: _tab === 'anim' ? 'anim' : (_cats[_kind] || null) }) }).then((r) => r.json())
      : await fetch('/api/mv3/captions/tiles').then((r) => r.json());
  } catch (e) { d = null; }
  _reading = false;
  if (d && d.success) { _state = d; _paintState(); }
  if (!d && make) _asked = false;                     // the make never reached the server: the next show asks again
  if (d && (d.making || !_incomplete(d))) _retries = 0;
  // Asked again, a few times and further apart, when the set is incomplete and nothing is making it (after a server
  // restart the rest of the tiles would otherwise stay names).
  if (_shown && d && d.success && _incomplete(d) && _retries < 3) {
    _retries++;
    _timer = setTimeout(() => { _timer = 0; if (_shown) _read(true); }, 2000 * Math.pow(2, _retries));
  } else if (_shown && (!d || d.making)) _timer = setTimeout(() => { _timer = 0; if (_shown) _read(false); }, POLL_MS);
}

/**
 * The view is up for what is picked: `preset` - the id it wears ('' for none), `edited` - changed since; `kind` - 'text' for a text
 * lane or text lines (their own gallery), else the caption presets'. Cheap and safe to call on every repaint.
 */
export function show(target) {
  _build();
  if (!_ui) return;
  _shown = true;
  const t = target || {};
  _target = t;
  const kind = t.kind === 'text' ? 'text' : 'subs';
  if (kind !== _kind) { _kind = kind; _paintCat(); }
  _light();
  _ui.host.classList.toggle('is-ro', !!t.readOnly);
  Doc.setShown(_tab === 'text');
  if (_fonts) _fonts.shown(_tab === 'fonts');
  if (!_asked) { _asked = true; _read(true); }
  else if (_state && (_state.making || _incomplete(_state)) && !_timer && !_reading) _read(!_state.making);
}

export function hide() {
  _shown = false;
  if (_fonts) _fonts.shown(false);
  for (const t of _allTiles()) _stopNow(t);
  Doc.setShown(false);
  if (_timer) { clearTimeout(_timer); _timer = 0; }
}

/** The lit tile brought into view - when the view comes up on a pick that wears a preset (or, on the animations, a pair). */
export function revealLit() {
  if (!_ui || _tab === 'text') return;
  const lit = (_tab === 'anim' ? _ui.agrid : _ui.grid).querySelector('.mv3-cap-tile.is-on:not([hidden])');
  if (lit && lit.scrollIntoView) lit.scrollIntoView({ block: 'nearest' });
}

