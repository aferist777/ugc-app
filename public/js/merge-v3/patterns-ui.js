/* ═══════════════════════════════════════════════════════════════════════════
   MERGE v3 — THE PATTERNS OF MAIN VIDEO, PICKED BY TICKS.

   In the strip of the MAIN VIDEO lane (inspector.js _blankVideoTrack) - and in the common settings of a highlights project's
   ticked fragments, "Main video · for all N" (hl-group.js) - under the lane's own rows:
     the set     every pattern of the app (GET /api/patterns - vendor/patterns/, lib/patterns-builtin.js) as a tile WITH A TICK,
                 under the fold «Patterns · N ▸» (opened in the strip, kept as it was left); a tick lays the pattern
                 over the ones ticked already (70 %, no blend mode - look.js PATTERN_OPACITY), untick takes it off;
     the layers  the ticked ones, the top layer first: the tile, the name, ↑ ↓ for the order; a press on a row opens its own
                 settings - scale, color, angle, movement, speed, direction (overlay/pattern.js), opacity and blend mode
                 (overlay/look.js, the list js/merge-v3/blend-menu.js) -, one open at a time.
   Every change is ONE undo step (`io.write`, timeline-b.js setPatterns); a slider is shown on the preview while it moves
   (place-b.js setLive, by the layer's id - overlay/pattern.js layerId) and written on release. No limit of how many.

   renderPatterns(host, io) - io: { list() -> the list now, write(next), repaint(), empty (main video has nothing yet),
   note (a line over the fold) }.
   ═══════════════════════════════════════════════════════════════════════════ */

import * as C from './controls.js';
import * as PAT from '../overlay/pattern.js';
import { opacityOf, blendOf, PATTERN_OPACITY } from '../overlay/look.js';
import { setLive as setLivePlace } from './place-b.js';
import { blendButton } from './blend-menu.js';
// Being read, empty, could not be read - the shared parts (rows in the strip); the reason a popup.
import { emptyEl, loadingEl, failedEl } from '../ui-state.js';
import { showError } from '../notice.js';
// Lucide's icons for ▸ ▾ ✓ ↑ ↓ ↻ ↺ and the eight ways of a drift; the figures in mono
import { icon, iconEl } from '../icons.js';
import { setFigures } from '../num.js';
const DIR_ICON = { e: 'arrow-right', ne: 'arrow-up-right', n: 'arrow-up', nw: 'arrow-up-left', w: 'arrow-left', sw: 'arrow-down-left',
  s: 'arrow-down', se: 'arrow-down-right' };

const _el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

let _set = null;              // the app's patterns: [{ id, name, path, thumb, size }]
let _asking = null;
let _failedAt = 0;            // when the last read failed - asked again only a while later, never by its own repaint
const _waiting = new Set();   // repaints waiting for the set
let _open = '';               // the address of the layer whose settings are open

function _readSet(repaint) {
  if (repaint) _waiting.add(repaint);
  if (_asking || Date.now() - _failedAt < 5000) return;
  _asking = fetch('/api/patterns').then((r) => r.json()).then((d) => {
    if (!d || !d.success || !Array.isArray(d.patterns)) throw new Error('no set');
    _set = d.patterns;
  }).catch((e) => {
    _set = null;
    _failedAt = Date.now();
    showError('The patterns could not be read', { detail: (e && e.message) || '' });
  }).then(() => {
    _asking = null;
    const list = [..._waiting];
    _waiting.clear();
    for (const f of list) { try { f(); } catch (e) { /* the strip's own trouble */ } }
  });
}

const _of = (src) => (_set || []).find((p) => p.path === src) || null;
const _name = (src) => { const p = _of(src); return p ? p.name : String(src || '').split('/').pop().replace(/\.[a-z0-9]+$/i, ''); };
/** A pattern's name by its address - the set's, or its file's while the set is not read. */
export const nameOf = (src) => _name(src);

// The strip is painted anew on every change (inspector.js render): where it was scrolled is kept across the write.
function _keep(fn) {
  const sc = document.querySelector('#mv3-over .mv3-over-body');
  const top = sc ? sc.scrollTop : 0;
  fn();
  const now = document.querySelector('#mv3-over .mv3-over-body');
  if (now) now.scrollTop = top;
}

// THE TILES UNDER THE FOLD «Patterns · N ▸»: a press opens them in the strip itself,
// under it - the layers ticked move down -, another folds them; shut until opened, then kept as the person left it, across lanes,
// fragments and restarts (localStorage - this window's convenience; shut when it cannot be read).
const GRID_KEY = 'mv3_pat_grid_v1';
let _gridOpen = (() => { try { return localStorage.getItem(GRID_KEY) === '1'; } catch (e) { return false; } })();
function _setGrid(on) {
  _gridOpen = !!on;
  try { localStorage.setItem(GRID_KEY, _gridOpen ? '1' : '0'); } catch (e) { /* kept while the window is open */ }
}

/** The patterns' block: the fold with the set's tiles under it, then the layers ticked with their settings. */
export function renderPatterns(host, io) {
  const list = io.list();
  if (io.note) host.appendChild(C.hint(io.note));
  const fold = _el('button', 'mv3-patf' + (_gridOpen ? ' is-open' : ''));
  fold.type = 'button';
  fold.title = _gridOpen ? 'Fold the patterns' : 'The app\'s patterns - tick one to lay it over main video';
  // the strip's one fold form: a chevron, then the title
  fold.appendChild(iconEl(_gridOpen ? 'chevron-down' : 'chevron-right', 14));
  fold.appendChild(setFigures(_el('span', 'mv3-patf-name'), 'Patterns' + (list.length ? ' · ' + list.length : '')));
  fold.addEventListener('click', () => { _setGrid(!_gridOpen); _keep(() => io.repaint()); });
  host.appendChild(fold);
  if (!_set) {
    // Read whether open or not: the layers' rows take their names and tiles from the set.
    const failed = !_asking && Date.now() - _failedAt < 5000;
    // Not read: "did not load" with Try again; the reason was the popup (_readSet).
    if (_gridOpen) {
      host.appendChild(failed ? failedEl('The patterns', () => { _failedAt = 0; _readSet(io.repaint); _keep(() => io.repaint()); }, { line: true })
        : loadingEl('reading the patterns…', { line: true }));
    }
    if (!failed) _readSet(io.repaint);
  } else if (!_set.length) {
    if (_gridOpen) host.appendChild(C.hint('The app\'s patterns are not installed.'));
  } else if (_gridOpen) _grid(host, io, list);
  if (io.empty) host.appendChild(emptyEl('Nothing on main video yet - the patterns show over it once it has something.', { line: true }));
  if (!list.length) {
    host.appendChild(C.hint((_gridOpen ? 'Tick a pattern' : 'Open «Patterns» and tick one')
      + ': it lies over the whole of main video and every lane on it, under the words.'));
    return;
  }
  _layers(host, io, list);
}

// The set: a tick lays one on top, untick takes it off.
function _grid(host, io, list) {
  const grid = _el('div', 'mv3-patg');
  for (const p of _set) {
    const on = list.some((x) => x.src === p.path);
    const b = _el('button', 'mv3-patg-tile' + (on ? ' is-on' : ''));
    b.type = 'button';
    b.title = p.name + (on ? ' - untick to take it off main video' : ' - tick to lay it over main video');
    const img = document.createElement('img');
    img.src = p.thumb || p.path;
    img.alt = p.name;
    img.loading = 'lazy';
    b.appendChild(img);
    const tick = _el('span', 'mv3-patg-tick');
    if (on) tick.innerHTML = icon('check', 12);
    b.appendChild(tick);
    b.addEventListener('click', () => _keep(() => {
      const now = io.list();
      if (now.some((x) => x.src === p.path)) {
        if (_open === p.path) _open = '';
        io.write(now.filter((x) => x.src !== p.path));
      } else {
        _open = p.path;
        io.write([{ src: p.path, opacity: PATTERN_OPACITY }].concat(now));
      }
    }));
    grid.appendChild(b);
  }
  host.appendChild(grid);
}

// The layers ticked, the top one first.
function _layers(host, io, list) {
  const box = _el('div', 'mv3-patl');
  list.forEach((e, i) => {
    const open = _open === e.src;
    const row = _el('div', 'mv3-patl-row' + (open ? ' is-open' : ''));
    const head = _el('div', 'mv3-patl-head');
    head.title = open ? 'Fold its settings' : 'Its settings';
    const img = document.createElement('img');
    const p = _of(e.src);
    img.src = (p && p.thumb) || e.src;
    img.alt = '';
    head.appendChild(img);
    head.appendChild(_el('span', 'mv3-patl-name', _name(e.src)));
    head.appendChild(setFigures(_el('span', 'mv3-patl-look'), _lookOf(e)));
    const move = (d) => {
      const now = io.list();
      const k = now.findIndex((x) => x.src === e.src);
      const j = k + d;
      if (k < 0 || j < 0 || j >= now.length) return;
      const next = now.slice();
      [next[k], next[j]] = [next[j], next[k]];
      _keep(() => io.write(next));
    };
    for (const [d, ico, title] of [[-1, 'arrow-up', 'One layer up'], [1, 'arrow-down', 'One layer down']]) {
      const a = _el('button', 'mv3-patl-arrow u-btn is-s is-icon');
      a.innerHTML = icon(ico, 14);
      a.type = 'button';
      a.title = title;
      a.disabled = d < 0 ? i === 0 : i === list.length - 1;
      a.addEventListener('click', (ev) => { ev.stopPropagation(); move(d); });
      head.appendChild(a);
    }
    head.addEventListener('click', () => { _open = open ? '' : e.src; _keep(() => io.repaint()); });
    row.appendChild(head);
    if (open) {
      const body = _el('div', 'mv3-patl-body');
      _rows(body, e, io);
      row.appendChild(body);
    }
    box.appendChild(row);
  });
  host.appendChild(box);
}

// What a layer's settings say in a few words, on its folded row.
function _lookOf(e) {
  const f = PAT.of(e);
  const bits = [Math.round(opacityOf(e) * 100) + '%'];
  const b = blendOf(e);
  if (b.id !== 'none') bits.push(b.label);
  if (f.move !== 'none') bits.push(f.move);
  return bits.join(' · ');
}

// ONE LAYER'S SETTINGS: Scale 25-400 %, Color, Angle
// 0-359°, Movement - still, rotate (0.5-20°/s, ↻ or ↺), drift (5-200 px/s, eight arrows) -, Opacity, Blend.
function _rows(host, e, io) {
  const id = PAT.layerId(e.src);
  const f0 = PAT.of(e);
  const change = (fn) => _keep(() => io.write(io.list().map((x) => (x.src === e.src ? fn(x) : x))));
  const setPat = (patch) => change((x) => ({ ...x, pattern: Object.assign(PAT.of(x), patch) }));
  const live = (patch) => setLivePlace(patch ? new Map([[id, patch]]) : null);
  const slider = (label, key, lim, fmt, toV, fromV) => host.appendChild(C.row(label, C.slider({
    min: lim.min, max: lim.max, step: lim.step, value: toV(f0[key]), fmt,
    onInput: (v) => live({ pattern: Object.assign(PAT.of(e), { [key]: fromV(v) }) }),
    onChange: (v) => { live(null); setPat({ [key]: fromV(v) }); },
  })));
  const pct = (v) => Math.round(v) + '%';
  slider('Scale', 'scale', { min: PAT.SCALE.min * 100, max: PAT.SCALE.max * 100, step: PAT.SCALE.step * 100 }, pct,
    (s) => Math.round(s * 100), (v) => v / 100);
  const col = C.color(f0.color, (v) => setPat({ color: v }));
  col.title = 'The color its white becomes';
  host.appendChild(C.row('Color', col));
  slider('Angle', 'angle', { min: 0, max: 359, step: 1 }, (v) => Math.round(v) + '°', (a) => a, (v) => v);
  host.appendChild(C.row('Movement', C.select(PAT.MOVES, f0.move, (m) => setPat({
    move: m, speed: m === 'drift' ? PAT.DRIFT.def : PAT.ROTATE.def, dir: m === 'drift' ? 'e' : 'cw',
  }))));
  if (f0.move === 'rotate') {
    slider('Speed', 'speed', PAT.ROTATE, (v) => (+v).toFixed(1) + '°/s', (s) => s, (v) => v);
    const way = _el('span', 'mv3-pat-dirs');
    for (const [d, label, title, ico] of [['cw', '↻', 'Clockwise', 'rotate-cw'], ['ccw', '↺', 'Counter-clockwise', 'rotate-ccw']]) {
      way.appendChild(C.toggleNamed(label, f0.dir === d, () => setPat({ dir: d }), title, ico));
    }
    host.appendChild(C.row('Direction', way));
  } else if (f0.move === 'drift') {
    slider('Speed', 'speed', PAT.DRIFT, (v) => Math.round(v) + ' px/s', (s) => s, (v) => v);
    const way = _el('span', 'mv3-pat-dirs');
    for (const [d, label] of PAT.DIRS) way.appendChild(C.toggleNamed(label, f0.dir === d, () => setPat({ dir: d }), 'Drift ' + d, DIR_ICON[d]));
    host.appendChild(C.row('Direction', way));
  }
  const op = C.slider({
    min: 0, max: 100, step: 1, value: Math.round(opacityOf(e) * 100), fmt: pct,
    onInput: (v) => live({ opacity: v / 100 }),
    onChange: (v) => { live(null); change((x) => ({ ...x, opacity: v / 100 })); },
  });
  op.title = 'How much of the pattern is seen - 100% all of it';
  host.appendChild(C.row('Opacity', op));
  host.appendChild(C.row('Blend', blendButton({
    current: blendOf(e).id,
    title: 'How the pattern mixes with the video under it - rest the pointer on a mode to see it',
    live: (m) => live(m ? { blend: m } : null),
    write: (m) => change((x) => ({ ...x, blend: m })),
  })));
}
