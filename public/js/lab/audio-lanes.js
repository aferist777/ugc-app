/* ═══════════════════════════════════════════════════════════════════════════
   THE AUDIO LAB - the timeline as Merge draws it (phase V34.D; the owner 2026-10-23: "имитируй страницу merge, только blur
   неиспользуемые элементы"). The open project's lanes (GET /api/audio/lanes - read only, nothing warmed or written) in
   Merge's own markup and styles (`.mv3b-*`, css/merge-v3.css): video lanes, the seam, audio lanes, subtitles at the
   floor. The video and subtitle lanes are asleep (blurred); the AUDIO lanes are awake - a track of Music, a sound of SFX
   or a result of "Made here" let go on one lies there from where it was let go, as wide as it is long; a press plays it,
   its ✕ takes it off. A SKETCH: nothing is saved in the project (Merge takes this over in V34.E).

     mount(host, { say })     show(key)     the drag data a tile carries: TILE_DRAG (js/lab/audio-tree.js)
   ═══════════════════════════════════════════════════════════════════════════ */

import { TILE_DRAG } from './audio-tree.js';
import { playToggle, playing, onChange, secs } from './audio-play.js';

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

// A blank project's lanes (lib/timeline-shape.js), for "no project".
const BLANK = [
  { id: 'v2', kind: 'video', name: 'video 2', main: false, clips: [] },
  { id: 'v1', kind: 'video', name: 'main video', main: true, clips: [] },
  { id: 'a1', kind: 'audio', name: 'main audio', main: true, clips: [] },
  { id: 'a2', kind: 'audio', name: 'audio 2', main: false, clips: [] },
  { id: 'subs', kind: 'subs', name: 'Subtitles', main: true, clips: [] },
];

let _host = null, _say = () => {};
let _tracks = BLANK;
let _key = '';
let _req = 0;
const _laid = new Map();            // project key -> { laneId: [{ id, start, dur, name, path }] } - this visit only

function _end() {
  let end = 0;
  for (const t of _tracks) for (const c of (t.clips || [])) end = Math.max(end, (+c.start || 0) + (+c.dur || 0));
  for (const list of Object.values(_laid.get(_key) || {})) for (const c of list) end = Math.max(end, c.start + c.dur);
  return Math.max(end, 20);
}
// Pixels per second: the whole project in view, as Merge's FIT.
function _zoom() {
  const w = Math.max(200, (_host ? _host.clientWidth : 800) - 104 - 20);
  return w / (_end() * 1.08);
}

function _row(t, awake) {
  const row = el('div', 'mv3b-row is-' + t.kind + (t.main ? ' is-main' : '') + (awake ? '' : ' la-off'));
  if (!awake) row.inert = true;
  row.appendChild(el('div', 'mv3b-box'));
  const lbl = el('div', 'mv3b-lbl');
  lbl.appendChild(el('span', null, t.name));
  row.appendChild(lbl);
  const lane = el('div', 'mv3b-lane');
  const z = _zoom();
  for (const c of (t.clips || [])) {
    const b = el('div', 'mv3b-clip is-' + (t.kind === 'audio' ? 'audio' : 'video'));
    b.style.left = (c.start * z) + 'px';
    b.style.width = Math.max(2, c.dur * z) + 'px';
    b.appendChild(el('span', 'mv3b-clip-t', c.name || ''));
    lane.appendChild(b);
  }
  if (awake) {
    for (const c of ((_laid.get(_key) || {})[t.id] || [])) lane.appendChild(_laidClip(t, c, z));
    _wire(lane, t);
  }
  row.appendChild(lane);
  return row;
}

function _laidClip(t, c, z) {
  const b = el('div', 'mv3b-clip is-audio la-clip' + (playing() === c.path ? ' is-playing' : ''));
  b.dataset.path = c.path;
  b.style.left = (c.start * z) + 'px';
  b.style.width = Math.max(14, c.dur * z) + 'px';
  b.title = c.name + ' · ' + secs(c.dur) + ' from ' + c.start.toFixed(1) + ' s - a press plays it';
  b.appendChild(el('span', 'mv3b-clip-t', c.name));
  const x = el('button', 'la-clip-x', '✕');
  x.type = 'button';
  x.title = 'Take it off the lane';
  x.addEventListener('click', (e) => {
    e.stopPropagation();
    const all = _laid.get(_key) || {};
    all[t.id] = (all[t.id] || []).filter(y => y.id !== c.id);
    paint();
  });
  b.appendChild(x);
  b.addEventListener('click', () => playToggle(c.path, b));
  return b;
}

function _wire(lane, t) {
  lane.addEventListener('dragover', (e) => {
    if (!Array.from(e.dataTransfer.types || []).includes(TILE_DRAG)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    lane.classList.add('is-drop');
  });
  lane.addEventListener('dragleave', () => lane.classList.remove('is-drop'));
  lane.addEventListener('drop', (e) => {
    lane.classList.remove('is-drop');
    let it = null;
    try { it = JSON.parse(e.dataTransfer.getData(TILE_DRAG)); } catch (er) { return; }
    if (!it || !it.path) return;
    e.preventDefault();
    const r = lane.getBoundingClientRect();
    const start = Math.max(0, Math.round(((e.clientX - r.left) / _zoom()) * 10) / 10);
    const all = _laid.get(_key) || {};
    _laid.set(_key, all);
    (all[t.id] = all[t.id] || []).push({ id: Math.random().toString(36).slice(2), start, dur: +it.dur || 5, name: it.name || 'sound', path: it.path });
    paint();
    _say('"' + (it.name || 'sound') + '" is on ' + t.name + ' from ' + start.toFixed(1) + ' s - a sketch, the project is not changed.');
  });
}

function _ruler() {
  const row = el('div', 'mv3b-row is-ruler');
  row.appendChild(el('div', 'mv3b-box'));
  row.appendChild(el('div', 'mv3b-lbl'));
  const lane = el('div', 'mv3b-lane la-ruler');
  const z = _zoom(), end = _end();
  const step = end > 240 ? 30 : end > 90 ? 10 : 5;
  for (let s = 0; s <= end; s += step) {
    const m = el('span', 'la-tick', Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'));
    m.style.left = (s * z) + 'px';
    lane.appendChild(m);
  }
  row.appendChild(lane);
  return row;
}

export function paint() {
  if (!_host) return;
  _host.textContent = '';
  const inner = el('div', 'mv3b-inner');
  inner.appendChild(_ruler());
  const zone = (cls, of, awake) => {
    const rows = _tracks.filter(of);
    if (!rows.length) return null;
    const z = el('div', 'mv3b-zone ' + cls);
    for (const t of rows) z.appendChild(_row(t, awake));
    return z;
  };
  const video = zone('is-video', t => t.kind === 'video', false);
  const audio = zone('is-audio', t => t.kind === 'audio', true);
  const subs = zone('is-subs', t => t.kind === 'subs' || t.kind === 'text', false);
  if (video) inner.appendChild(video);
  if (video && audio) inner.appendChild(el('div', 'mv3b-seam'));
  if (audio) inner.appendChild(audio);
  if (subs) inner.appendChild(subs);
  _host.appendChild(inner);
}

/** The lanes of project `key` ('' - a blank project's). */
export async function show(key) {
  _key = String(key || '');
  const n = ++_req;
  if (!_key) { _tracks = BLANK; paint(); return; }
  try {
    const r = await fetch('/api/audio/lanes?key=' + encodeURIComponent(_key));
    const d = await r.json();
    if (n !== _req) return;
    _tracks = (d && d.success && Array.isArray(d.tracks) && d.tracks.length) ? d.tracks : BLANK;
  } catch (e) { if (n === _req) _tracks = BLANK; }
  paint();
}

export function mount(host, opts) {
  _host = host;
  _say = (opts && opts.say) || _say;
  onChange((p) => { for (const b of host.querySelectorAll('.la-clip')) b.classList.toggle('is-playing', !!p && b.dataset.path === p); });
  let t = 0;
  window.addEventListener('resize', () => { clearTimeout(t); t = setTimeout(paint, 120); });
  paint();
}
