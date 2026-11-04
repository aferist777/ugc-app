/* ═══════════════════════════════════════════════════════════════════════════
   MERGE v3 — THE PATTERNS OF MAIN VIDEO, PICKED BY TICKS (phase V74, the owner 2026-11-03/04, (пт1)-(пт9): «выбранный паттерн
   и добавление паттерна будет в выдвижном поле справа при выборе дорожки main video», «отмечаем галочками в правом столбце»;
   docs/local-app/plan/, "Фаза V74").

   In the strip of the MAIN VIDEO lane (inspector.js _blankVideoTrack) - and in the common settings of a highlights project's
   ticked fragments, "pattern · for all N" (hl-group.js) - under the lane's own rows:
     the set     every pattern of the app (GET /api/patterns - vendor/patterns/, lib/patterns-builtin.js) as a tile WITH A TICK,
                 the grid always open; a tick lays the pattern over the ones ticked already (70 %, no blend mode - look.js
                 PATTERN_OPACITY), untick takes it off;
     the layers  the ticked ones, the top layer first: the tile, the name, ↑ ↓ for the order; a press on a row opens its own
                 settings - scale, colour, angle, movement, speed, direction (overlay/pattern.js), opacity and blend mode
                 (overlay/look.js, the list js/merge-v3/blend-menu.js) -, one open at a time.
   Every change is ONE undo step (`io.write`, timeline-b.js setPatterns); a slider is shown on the preview while it moves
   (place-b.js setLive, by the layer's id - overlay/pattern.js layerId) and written on release. No limit of how many.

   renderPatterns(host, io) - io: { list() -> the list now, write(next), repaint(), empty (main video has nothing yet),
   note (a line under the title) }.
   ═══════════════════════════════════════════════════════════════════════════ */

import * as C from './controls.js';
import * as PAT from '../overlay/pattern.js';
import { opacityOf, blendOf, PATTERN_OPACITY } from '../overlay/look.js';
import { setLive as setLivePlace } from './place-b.js';
import { blendButton } from './blend-menu.js';

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
  }).catch(() => { _set = null; _failedAt = Date.now(); }).then(() => {
    _asking = null;
    const list = [..._waiting];
    _waiting.clear();
    for (const f of list) { try { f(); } catch (e) { /* the strip's own trouble */ } }
  });
}

const _of = (src) => (_set || []).find((p) => p.path === src) || null;
const _name = (src) => { const p = _of(src); return p ? p.name : String(src || '').split('/').pop().replace(/\.[a-z0-9]+$/i, ''); };

// The strip is painted anew on every change (inspector.js render): where it was scrolled is kept across the write.
function _keep(fn) {
  const sc = document.querySelector('#mv3-over .mv3-over-body');
  const top = sc ? sc.scrollTop : 0;
  fn();
  const now = document.querySelector('#mv3-over .mv3-over-body');
  if (now) now.scrollTop = top;
}

/** The patterns' block: the set with ticks, then the layers ticked with their settings. */
export function renderPatterns(host, io) {
  const list = io.list();
  host.appendChild(_el('div', 'mv3-ins-sub', 'Patterns' + (list.length ? ' · ' + list.length : '')));
  if (io.note) host.appendChild(C.hint(io.note));
  if (!_set) {
    const failed = !_asking && Date.now() - _failedAt < 5000;
    host.appendChild(_el('p', 'mv3-ins-note', failed ? 'The patterns could not be read - pick the lane again in a moment.' : 'reading the patterns…'));
    if (!failed) _readSet(io.repaint);
    return;
  }
  if (!_set.length) { host.appendChild(C.hint('The app\'s patterns are not installed.')); return; }

  // The set: a tick lays one on top, untick takes it off.
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
    b.appendChild(_el('span', 'mv3-patg-tick', on ? '✓' : ''));
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
  if (io.empty) host.appendChild(C.hint('Nothing on main video yet - the patterns show over it once it has something.'));
  if (!list.length) {
    host.appendChild(C.hint('Tick a pattern: it lies over the whole of main video and every lane on it, under the words.'));
    return;
  }

  // The layers ticked, the top one first.
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
    head.appendChild(_el('span', 'mv3-patl-look', _lookOf(e)));
    const move = (d) => {
      const now = io.list();
      const k = now.findIndex((x) => x.src === e.src);
      const j = k + d;
      if (k < 0 || j < 0 || j >= now.length) return;
      const next = now.slice();
      [next[k], next[j]] = [next[j], next[k]];
      _keep(() => io.write(next));
    };
    for (const [d, label, title] of [[-1, '↑', 'One layer up'], [1, '↓', 'One layer down']]) {
      const a = _el('button', 'mv3-patl-arrow', label);
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

// ONE LAYER'S SETTINGS (phase V65's rows of a pattern clip, the owner's (пз8), (пз14)-(пз17)): Scale 25-400 %, Colour, Angle
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
  col.title = 'The colour its white becomes';
  host.appendChild(C.row('Colour', col));
  slider('Angle', 'angle', { min: 0, max: 359, step: 1 }, (v) => Math.round(v) + '°', (a) => a, (v) => v);
  host.appendChild(C.row('Movement', C.select(PAT.MOVES, f0.move, (m) => setPat({
    move: m, speed: m === 'drift' ? PAT.DRIFT.def : PAT.ROTATE.def, dir: m === 'drift' ? 'e' : 'cw',
  }))));
  if (f0.move === 'rotate') {
    slider('Speed', 'speed', PAT.ROTATE, (v) => (+v).toFixed(1) + '°/s', (s) => s, (v) => v);
    const way = _el('span', 'mv3-pat-dirs');
    for (const [d, label, title] of [['cw', '↻', 'Clockwise'], ['ccw', '↺', 'Counter-clockwise']]) {
      way.appendChild(C.toggleNamed(label, f0.dir === d, () => setPat({ dir: d }), title));
    }
    host.appendChild(C.row('Direction', way));
  } else if (f0.move === 'drift') {
    slider('Speed', 'speed', PAT.DRIFT, (v) => Math.round(v) + ' px/s', (s) => s, (v) => v);
    const way = _el('span', 'mv3-pat-dirs');
    for (const [d, label] of PAT.DIRS) way.appendChild(C.toggleNamed(label, f0.dir === d, () => setPat({ dir: d }), 'Drift ' + d));
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
