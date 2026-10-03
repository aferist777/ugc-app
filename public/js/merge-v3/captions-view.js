/* ═══════════════════════════════════════════════════════════════════════════
   MERGE v3 — "LIBRARY / captions": the preset tiles (phase K6c, 2026-10-03).

   While captions are picked on the timeline - a subtitle or text lane, one caption, several - and the
   tiles are open, the Library panel shows the 127 preset styles on the left and the settings of what is
   picked in the strip on the right (inspector.js). A press on a tile applies the preset to what is
   picked, at once and as one step to undo; the tile of the preset it wears is lit, and says `edited`
   when it was changed since. `presets` at the foot of the settings folds the tiles away (remembered);
   folded, the strip sits over the shelf or the chat as it always did.

   A tile is a 2.5 s loop made by the SERVER with the render's own builder and ffmpeg
   (lib/caption-tiles.js) - what it shows is what the render draws. Until it is made, the tile shows the
   preset's name in its own font and colour. The tiles are built ONCE and live outside the strip, which
   is rebuilt on every change: 127 animations rebuilt per press would be the page's whole evening.

   Which view shows, the header and the room are lib-views.js's; this only draws the tiles.
   ═══════════════════════════════════════════════════════════════════════════ */

import { PRESETS, CATEGORIES } from '../captions/presets.js';
import { cssWeight } from '../captions/fonts.js';

const LS_CAT = 'mv3_cap_cat_v1';
const LS_OPEN = 'mv3_cap_tiles_v1';
const POLL_MS = 1500;

const _store = (k, fb) => { try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v == null ? fb : v; } catch (e) { return fb; } };
const _keep = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* a private window */ } };
const _el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

let _ui = null;
const _tiles = new Map();          // preset id -> { btn, box, ed }
let _state = null;
let _timer = 0;
let _shown = false;
let _asked = false;
let _cat = _store(LS_CAT, '');
let _apply = null;
let _retries = 0;           // makes asked again for a set left incomplete (a restart, a make that could not start)
let _reading = false;

/** Are the tiles open (the captions view), or folded (the strip alone, as before K6)? */
export const tilesOpen = () => _store(LS_OPEN, true) !== false;
export function setTilesOpen(on) { _keep(LS_OPEN, !!on); }

/** What a press on a tile does - the inspector knows what is picked. */
export function onApply(fn) { _apply = typeof fn === 'function' ? fn : null; }

function _build() {
  const host = document.getElementById('mv3-cap');
  if (!host || _ui) return;
  host.textContent = '';
  const top = _el('div', 'mv3-cap-top');
  const chips = _el('div', 'mv3-cap-cats');
  const all = [['', 'All', PRESETS.length]].concat(CATEGORIES.map((c) => [c.id, c.label, PRESETS.filter((p) => p.category === c.id).length]));
  for (const [id, label, n] of all) {
    const b = _el('button', 'mv3-cap-cat', label);
    b.type = 'button';
    b.dataset.cat = id;
    b.appendChild(_el('span', 'mv3-cap-n', ' ' + n));
    b.addEventListener('click', () => _setCat(id));
    chips.appendChild(b);
  }
  const status = _el('div', 'mv3-cap-status');
  top.appendChild(chips);
  top.appendChild(status);
  const grid = _el('div', 'mv3-cap-grid');
  for (const p of PRESETS) {
    const btn = _el('button', 'mv3-cap-tile');
    btn.type = 'button';
    btn.dataset.id = p.id;
    btn.dataset.cat = p.category;
    btn.title = p.name + ' - apply to what is picked';
    const box = _el('div', 'mv3-cap-box');
    // Until the loop is made: the name, in the preset's own font and colour.
    const ph = _el('span', 'mv3-cap-ph', p.name);
    const s = p.style || {};
    ph.style.fontFamily = '"' + s.font + '", "Liberation Sans", sans-serif';
    ph.style.fontWeight = String(cssWeight(s.font, s.bold));
    ph.style.color = s.primary || '#ffffff';
    if (s.casing === 'upper') ph.style.textTransform = 'uppercase';
    box.appendChild(ph);
    const name = _el('div', 'mv3-cap-name');
    name.appendChild(_el('span', 'mv3-cap-nm', p.name));
    const ed = _el('span', 'mv3-cap-ed', 'edited');
    ed.hidden = true;
    name.appendChild(ed);
    btn.appendChild(box);
    btn.appendChild(name);
    btn.addEventListener('click', () => { if (_apply) _apply(p.id); });
    grid.appendChild(btn);
    _tiles.set(p.id, { btn, box, ed });
  }
  host.appendChild(top);
  host.appendChild(grid);
  _ui = { host, top, chips, status, grid };
  _paintCat();
}

function _setCat(id) {
  _cat = id || '';
  _keep(LS_CAT, _cat);
  _paintCat();
  // The category looked at is made first.
  if (_state && _state.making && _cat) _read(true);
}

function _paintCat() {
  if (!_ui) return;
  for (const b of _ui.chips.children) b.classList.toggle('is-on', (b.dataset.cat || '') === _cat);
  for (const { btn } of _tiles.values()) btn.hidden = !!_cat && btn.dataset.cat !== _cat;
}

function _paintState() {
  if (!_ui || !_state) return;
  for (const id of (_state.ready || [])) {
    const t = _tiles.get(id);
    if (!t || t.img) continue;
    const img = new Image();
    img.className = 'mv3-cap-img';
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.draggable = false;
    img.addEventListener('load', () => t.box.classList.add('is-ready'));
    img.src = _state.base + encodeURIComponent(id) + '.webp';
    t.box.appendChild(img);
    t.img = img;
  }
  const n = (_state.ready || []).length;
  _ui.status.textContent = _state.making ? 'making the previews ' + n + '/' + _state.total + (_state.waiting ? ' - waiting for the render' : '')
    : _state.error ? 'the previews could not be made (' + _state.error + ') - the styles still apply'
    : (_state.failed || []).length ? (_state.failed.length + ' previews could not be made - the styles still apply')
    : _incomplete(_state) ? 'previews ' + n + '/' + _state.total : '';
  _ui.status.hidden = !_ui.status.textContent;
}

// A set the server is not making and has not finished: a make lost to a restart, or one that could not start.
const _incomplete = (s) => !!s && !s.making && ((s.ready || []).length + (s.failed || []).length) < s.total;

async function _read(make) {
  if (_timer) { clearTimeout(_timer); _timer = 0; }
  // One read at a time: a repaint during a read used to start a second chain of reads (review K6).
  if (_reading) return;
  _reading = true;
  let d = null;
  try {
    d = make
      ? await fetch('/api/mv3/captions/tiles/make', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ first: _cat || null }) }).then((r) => r.json())
      : await fetch('/api/mv3/captions/tiles').then((r) => r.json());
  } catch (e) { d = null; }
  _reading = false;
  if (d && d.success) { _state = d; _paintState(); }
  if (!d && make) _asked = false;                     // the make never reached the server: the next show asks again
  if (d && (d.making || !_incomplete(d))) _retries = 0;
  // Asked again, a few times and further apart, when the set is incomplete and nothing is making it (review K6:
  // after a server restart the page stopped asking, and the rest of the tiles stayed names).
  if (_shown && d && d.success && _incomplete(d) && _retries < 3) {
    _retries++;
    _timer = setTimeout(() => { _timer = 0; if (_shown) _read(true); }, 2000 * Math.pow(2, _retries));
  } else if (_shown && (!d || d.making)) _timer = setTimeout(() => { _timer = 0; if (_shown) _read(false); }, POLL_MS);
}

/**
 * The view is up for what is picked: `preset` - the id it wears ('' for none), `edited` - changed since.
 * Cheap and safe to call on every repaint.
 */
export function show(target) {
  _build();
  if (!_ui) return;
  _shown = true;
  const t = target || {};
  for (const [id, x] of _tiles) {
    const on = !!t.preset && id === t.preset;
    x.btn.classList.toggle('is-on', on);
    x.ed.hidden = !(on && t.edited);
  }
  _ui.host.classList.toggle('is-ro', !!t.readOnly);
  if (!_asked) { _asked = true; _read(true); }
  else if (_state && (_state.making || _incomplete(_state)) && !_timer && !_reading) _read(!_state.making);
}

export function hide() {
  _shown = false;
  if (_timer) { clearTimeout(_timer); _timer = 0; }
}

/** The lit tile brought into view - when the view comes up on a pick that wears a preset. */
export function revealLit() {
  if (!_ui) return;
  const lit = _ui.grid.querySelector('.mv3-cap-tile.is-on:not([hidden])');
  if (lit && lit.scrollIntoView) lit.scrollIntoView({ block: 'nearest' });
}
