/* ════════════════════════════════════════════════════════════════════════════
   3D STUDIO — the tracks of a fragment, at the bottom (PLAN "3D Studio", 3D2; the owner 2026-10-08/09).

   Its bar: the fragment (choose, "+ Fragment" from the shared arrangement or from the end of another, rename,
   delete, its length - at most 30 s), play / pause and the time, loop, the filter (all / cameras / moving), "Key",
   the zoom. Under it a row per thing that moves in the fragment - in its own colour, the colour of its blockout - and,
   opened, a row per channel: position, turn, size, visibility. A key is a diamond whose shape says how it eases to
   the next one: smooth ◆, linear ◇, abrupt (fast start) ▶, gentle (slow start) ◀, hold ■.

   What the hands do (borrowed from Theatre.js, Blender and TiXL - PLAN "Что взято из чужих проектов"):
     a press picks a key, Shift / Ctrl add or take one; a drag on empty lanes draws a box; a press on empty lane or on
     the ruler moves the playhead there;
     a drag moves the picked keys freely - with Shift they snap to frames and to the playhead (the owner: free by
     default, Shift to snap); a key dropped on a moment its channel has a key at already replaces it, never doubles;
     the object's own row moves all its keys at that moment;
     a right press on a key: how it eases, or delete it; Delete removes the picked keys, Ctrl+C / Ctrl+V copy them to
     the playhead; K keys what is selected where it stands now;
     Ctrl or Shift + wheel, and a pinch, zoom round the pointer; sideways two fingers move along time.
   Every drag and every command is one Ctrl+Z step (app.beginEdit / app.endEdit).
   ════════════════════════════════════════════════════════════════════════════ */

import * as Layers from '../layers.js';
import { askName } from '../name-box.js';
import { FPS, MAX_LENGTH, sameMoment, snapToFrame, roundT, EASES } from './evaluate.js';

const ROW = 22;                     // px a row
const PAD = 10;                     // px before 0 s, so a key at the very start is seen whole
const NAMES = 190;                  // px of the names' column
const CH_LABEL = { p: 'Position', r: 'Turn', s: 'Size', v: 'Visible' };
const EASE_LABEL = { smooth: 'Smooth', linear: 'Even', abrupt: 'Abrupt start', gentle: 'Gentle start', hold: 'Hold until next' };
const LS_FILTER = 's3d_tl_filter_v1';

let A = null, host = null;
let pps = 0;                        // pixels per second; 0 = fit the fragment into the width
let filter = 'all';
const open = new Set();             // object ids whose channels are shown
let picked = new Set();             // key objects picked
let clip = null;                    // copied keys: [{ oid, ch, dt, v, ease }]
let els = null;

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const fmt = (t) => { const m = Math.floor(t / 60), s = t - m * 60; return m + ':' + (s < 10 ? '0' : '') + s.toFixed(2); };
function _store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { /* a private window */ } return null; }

export function init(app, node) {
  A = app;
  host = node;
  filter = ['all', 'cameras', 'moving'].includes(_store(LS_FILTER)) ? _store(LS_FILTER) : 'all';
  host.addEventListener('contextmenu', (e) => e.preventDefault());
}

// ── What is shown ─────────────────────────────────────────────────────────
function _things() {
  const sc = A.scene, f = A.frag();
  if (!sc || !f) return [];
  const out = [];
  const cams = new Set(sc.cameras.map(c => c.id));
  for (const [id, tr] of Object.entries(f.tracks)) {
    const o = sc.objects.find(x => x.id === id) || sc.cameras.find(x => x.id === id);
    if (!o) continue;
    const isCam = cams.has(id);
    if (filter === 'cameras' && !isCam) continue;
    if (filter === 'moving' && isCam) continue;
    out.push({ id, o, tr, isCam });
  }
  return out;
}
const _channels = (th) => ['p', 'r', 's', 'v'].filter(ch => Array.isArray(th.tr[ch]) && th.tr[ch].length);

function _pps() {
  const f = A.frag();
  const w = Math.max(200, (els ? els.lanes.clientWidth : 600) - 24 - PAD);
  return pps || (f ? w / f.length : 100);
}

// ── Painting ──────────────────────────────────────────────────────────────
export function paint() {
  if (!host) return;
  if (!A.scene) { host.textContent = ''; els = null; return; }
  if (!els) _build();
  _bar();
  _rows();
  paintTime();
}

function _build() {
  host.textContent = '';
  const bar = el('div', 's3-tl-bar');
  const main = el('div', 's3-tl-main');
  const names = el('div', 's3-tl-names');
  const lanes = el('div', 's3-tl-lanes');
  const inner = el('div', 's3-tl-inner');
  const ruler = el('div', 's3-tl-ruler');
  const rows = el('div', 's3-tl-rows');
  const head = el('div', 's3-tl-head');
  const box = el('div', 's3-tl-box');
  box.hidden = true;
  inner.append(ruler, rows, head, box);
  lanes.appendChild(inner);
  main.append(names, lanes);
  const empty = el('div', 's3-tl-empty');
  host.append(bar, main, empty);
  els = { bar, main, names, lanes, inner, ruler, rows, head, box, empty };
  lanes.addEventListener('scroll', () => { names.scrollTop = lanes.scrollTop; });
  names.addEventListener('wheel', (e) => { lanes.scrollTop += e.deltaY; e.preventDefault(); }, { passive: false });
  lanes.addEventListener('wheel', _wheel, { passive: false });
  ruler.addEventListener('pointerdown', _scrub);
  rows.addEventListener('pointerdown', _lanePress);
  new ResizeObserver(() => { if (!pps) paint(); }).observe(lanes);
}

function _bar() {
  const B = els.bar;
  B.textContent = '';
  const sc = A.scene, f = A.frag();
  // The fragment
  const sel = el('select', 's3-tl-sel');
  sel.title = 'The fragment shown';
  if (!sc.fragments.length) sel.appendChild(el('option', '', 'No fragment yet'));
  for (const x of sc.fragments) { const o = el('option', '', x.name || 'Fragment'); o.value = x.id; o.selected = f && x.id === f.id; sel.appendChild(o); }
  sel.disabled = !sc.fragments.length;
  sel.addEventListener('change', () => A.openFragment(sel.value));
  B.appendChild(sel);
  const add = el('button', 'lib-btn', '+ Fragment');
  add.type = 'button';
  add.title = 'A new fragment - from the shared arrangement, or from where another one ends';
  add.addEventListener('click', () => _addMenu(add));
  B.appendChild(add);
  if (f) {
    const ren = el('button', 's3-tl-txt', 'rename');
    ren.type = 'button';
    ren.addEventListener('click', async () => {
      const name = await askName({ title: 'Fragment name', value: f.name, okLabel: 'Rename', anchor: ren });
      if (name) A.setFragment(f.id, { name });
    });
    const del = el('button', 's3-tl-txt is-del', 'delete');
    del.type = 'button';
    let armed = 0;
    del.addEventListener('click', () => {
      if (!armed) { del.textContent = 'really?'; armed = setTimeout(() => { armed = 0; del.textContent = 'delete'; }, 3000); return; }
      clearTimeout(armed);
      A.removeFragment(f.id);
    });
    B.append(ren, del);
    const len = el('label', 's3-tl-len');
    const li = el('input', 's3-in s3-num');
    li.type = 'number'; li.min = '0.5'; li.max = String(MAX_LENGTH); li.step = '0.5';
    li.value = String(f.length);
    li.title = 'The fragment\'s length, at most ' + MAX_LENGTH + ' s - what Seedance takes as a reference clip';
    li.addEventListener('change', () => A.setFragment(f.id, { length: li.value }));
    li.addEventListener('keydown', (e) => { if (e.key === 'Enter') li.blur(); });
    len.append(document.createTextNode('length '), li, document.createTextNode(' s'));
    B.appendChild(len);
    const pl = el('button', 's3-tl-play', '▶');
    pl.type = 'button';
    pl.dataset.play = '1';
    pl.title = 'Play / pause (Space)';
    pl.addEventListener('click', () => { if (A.playing) A.pause(); else A.play(); });
    B.appendChild(pl);
    B.appendChild(el('span', 's3-tl-time'));
    const lp = el('label', 's3-check');
    const lc = el('input');
    lc.type = 'checkbox';
    lc.checked = A.loop;
    lc.addEventListener('change', () => { A.loop = lc.checked; });
    lp.append(lc, document.createTextNode(' loop'));
    B.appendChild(lp);
  }
  B.appendChild(el('span', 'sp'));
  const seg = el('div', 's3-seg');
  for (const [k, lab] of [['all', 'All'], ['cameras', 'Cameras'], ['moving', 'Moving']]) {
    const b = el('button', 's3-seg-b' + (filter === k ? ' on' : ''), lab);
    b.type = 'button';
    b.addEventListener('click', () => { filter = k; _store(LS_FILTER, k); paint(); });
    seg.appendChild(b);
  }
  B.appendChild(seg);
  if (f) {
    const key = el('button', 'lib-btn', 'Key');
    key.type = 'button';
    key.title = 'K - a key of where the selected things stand now, at the playhead';
    key.addEventListener('click', () => A.keyNow());
    const zo = el('button', 's3-tl-txt', '−');
    zo.type = 'button';
    zo.title = 'Zoom out (or Ctrl / Shift + wheel, a pinch)';
    zo.addEventListener('click', () => _zoom(1 / 1.4));
    const zi = el('button', 's3-tl-txt', '+');
    zi.type = 'button';
    zi.title = 'Zoom in';
    zi.addEventListener('click', () => _zoom(1.4));
    const fit = el('button', 's3-tl-txt', 'fit');
    fit.type = 'button';
    fit.title = 'The whole fragment in the width';
    fit.addEventListener('click', () => { pps = 0; paint(); });
    B.append(key, zo, zi, fit);
  }
}

function _rows() {
  const f = A.frag();
  const N = els.names, R = els.rows, E = els.empty;
  N.textContent = '';
  R.textContent = '';
  els.main.hidden = !f;
  E.hidden = !!f && _things().length > 0;
  if (!f) {
    E.textContent = '';
    const b = el('button', 'lib-btn', '+ Fragment');
    b.type = 'button';
    b.addEventListener('click', () => A.addFragment());
    E.append(el('span', '', 'A fragment is up to ' + MAX_LENGTH + ' s of movement in this scene - Seedance\'s reference clip. '), b);
    return;
  }
  N.appendChild(el('div', 's3-tl-n is-spacer'));      // across from the ruler
  const things = _things();
  if (!things.length) {
    E.textContent = filter === 'cameras' ? 'No camera moves in this fragment yet.'
      : 'Nothing moves in this fragment yet: select something and tick “moves” in the left column.';
    els.main.hidden = false;
  }
  const P = _pps();
  const W = Math.max(els.lanes.clientWidth - 2, PAD + f.length * P + 24);
  els.inner.style.width = W + 'px';
  _ruler(f, P);
  for (const th of things) {
    const color = th.o.color || '#888';
    // the object's row: the summary of its keys
    const n = el('div', 's3-tl-n is-obj');
    n.style.setProperty('--c', color);
    const tw = el('button', 's3-tl-tw', open.has(th.id) ? '▾' : '▸');
    tw.type = 'button';
    tw.addEventListener('click', () => { if (open.has(th.id)) open.delete(th.id); else open.add(th.id); paint(); });
    const nm = el('span', 's3-tl-nm', th.o.name || (th.isCam ? 'Camera' : 'object'));
    nm.addEventListener('click', (e) => A.select(e.shiftKey || e.ctrlKey ? [...new Set([...A.sel, th.id])] : [th.id]));
    n.append(tw, nm);
    if (A.sel.includes(th.id)) n.classList.add('on');
    N.appendChild(n);
    const lane = el('div', 's3-tl-lane is-obj');
    lane.style.setProperty('--c', color);
    const times = [];
    for (const ch of _channels(th)) for (const k of th.tr[ch]) if (!times.some(t => sameMoment(t, k.t))) times.push(k.t);
    for (const t of times) {
      const group = _channels(th).flatMap(ch => th.tr[ch].filter(k => sameMoment(k.t, t)).map(k => ({ k, ch })));
      const d = el('div', 's3-k is-sum' + (group.every(g => picked.has(g.k)) ? ' on' : ''));
      d.style.left = (PAD + t * P) + 'px';
      d.title = fmt(t);
      d._keys = group;
      lane.appendChild(d);
    }
    R.appendChild(lane);
    if (!open.has(th.id)) continue;
    for (const ch of _channels(th)) {
      const cn = el('div', 's3-tl-n is-ch');
      cn.style.setProperty('--c', color);
      cn.textContent = CH_LABEL[ch];
      N.appendChild(cn);
      const cl = el('div', 's3-tl-lane is-ch');
      cl.style.setProperty('--c', color);
      for (const k of th.tr[ch]) {
        const d = el('div', 's3-k e-' + (Array.isArray(k.ease) ? 'custom' : k.ease) + (picked.has(k) ? ' on' : ''));
        d.style.left = (PAD + k.t * P) + 'px';
        d.title = CH_LABEL[ch] + ' at ' + fmt(k.t) + ' - ' + (EASE_LABEL[k.ease] || 'own curve') + ' to the next';
        d._keys = [{ k, ch }];
        cl.appendChild(d);
      }
      R.appendChild(cl);
    }
  }
}

function _ruler(f, P) {
  const R = els.ruler;
  R.textContent = '';
  // a tick every second, or every half / fifth when zoomed in, every 5 s when zoomed out
  const step = P > 400 ? 0.2 : P > 160 ? 0.5 : P > 40 ? 1 : 5;
  for (let t = 0; t <= f.length + 1e-6; t += step) {
    const x = Math.round(PAD + t * P);
    const tk = el('div', 's3-tl-tick' + (Math.abs(t - Math.round(t)) < 1e-6 ? ' is-s' : ''));
    tk.style.left = x + 'px';
    if (Math.abs(t - Math.round(t)) < 1e-6) tk.textContent = Math.round(t) + 's';
    R.appendChild(tk);
  }
  const end = el('div', 's3-tl-end');
  end.style.left = Math.round(PAD + f.length * P) + 'px';
  R.appendChild(end);
  els.rows.style.setProperty('--end', Math.round(PAD + f.length * P) + 'px');
}

/** The playhead and the time, without rebuilding anything - called on every frame of playback. */
export function paintTime() {
  if (!els) return;
  const f = A.frag();
  const x = f ? PAD + A.t * _pps() : 0;
  els.head.style.transform = 'translateX(' + x + 'px)';
  els.head.hidden = !f;
  const tm = els.bar.querySelector('.s3-tl-time');
  if (tm && f) tm.textContent = fmt(A.t) + ' / ' + fmt(f.length);
  const pl = els.bar.querySelector('[data-play]');
  if (pl) pl.textContent = A.playing ? '❚❚' : '▶';
  // keep the playhead in sight while it plays
  if (A.playing && f) {
    const L = els.lanes;
    if (x < L.scrollLeft || x > L.scrollLeft + L.clientWidth - 30) L.scrollLeft = Math.max(0, x - 40);
  }
}

// ── The hands ─────────────────────────────────────────────────────────────
const _timeAt = (clientX) => {
  const r = els.inner.getBoundingClientRect();
  return (clientX - r.left - PAD) / _pps();
};

function _scrub(e) {
  if (!A.frag() || e.button !== 0) return;
  A.pause();
  A.setTime(_timeAt(e.clientX));
  const mv = (ev) => A.setTime(_timeAt(ev.clientX));
  const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); };
  window.addEventListener('pointermove', mv);
  window.addEventListener('pointerup', up);
}

function _lanePress(e) {
  const f = A.frag();
  if (!f) return;
  const d = e.target.closest('.s3-k');
  if (e.button === 2) { if (d) _easeMenu(e, d); return; }
  if (e.button !== 0) return;
  if (d) { _dragKeys(e, d); return; }
  // empty lane: a press moves the playhead and lets the keys go; a drag draws a box
  const x0 = e.clientX, y0 = e.clientY;
  const r0 = els.inner.getBoundingClientRect();
  let boxing = false;
  const mv = (ev) => {
    if (!boxing && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 4) return;
    boxing = true;
    const B = els.box;
    const r = els.inner.getBoundingClientRect();
    const l = Math.min(x0, ev.clientX) - r.left, t = Math.min(y0, ev.clientY) - r.top;
    B.hidden = false;
    Object.assign(B.style, { left: l + 'px', top: t + 'px', width: Math.abs(ev.clientX - x0) + 'px', height: Math.abs(ev.clientY - y0) + 'px' });
  };
  const up = (ev) => {
    window.removeEventListener('pointermove', mv);
    window.removeEventListener('pointerup', up);
    if (!boxing) {
      if (!e.shiftKey && !e.ctrlKey) picked = new Set();
      A.pause();
      A.setTime((x0 - r0.left - PAD) / _pps());
      paint();
      return;
    }
    const br = els.box.getBoundingClientRect();
    els.box.hidden = true;
    if (!e.shiftKey && !e.ctrlKey) picked = new Set();
    for (const k of els.rows.querySelectorAll('.s3-k')) {
      const kr = k.getBoundingClientRect();
      if (kr.right >= br.left && kr.left <= br.right && kr.bottom >= br.top && kr.top <= br.bottom) for (const g of k._keys) picked.add(g.k);
    }
    paint();
  };
  window.addEventListener('pointermove', mv);
  window.addEventListener('pointerup', up);
}

function _dragKeys(e, d) {
  const f = A.frag();
  const mine = d._keys.map(g => g.k);
  const isOn = mine.every(k => picked.has(k));
  if (e.ctrlKey) { for (const k of mine) { if (isOn) picked.delete(k); else picked.add(k); } paint(); return; }
  if (e.shiftKey) { for (const k of mine) picked.add(k); }
  else if (!isOn) picked = new Set(mine);
  paint();
  const moving = [...picked];
  const start = moving.map(k => k.t);
  const x0 = e.clientX;
  let before = null;
  const P = _pps();
  const mv = (ev) => {
    if (!before) {
      if (Math.abs(ev.clientX - x0) < 3) return;
      before = A.beginEdit();
      A.pause();
    }
    let dt = (ev.clientX - x0) / P;
    if (ev.shiftKey) {
      // to frames - and to the playhead when one of the keys comes within a few pixels of it
      const lead = start[moving.indexOf(mine[0])] + dt;
      const toHead = Math.abs(lead - A.t) * P < 7 ? A.t - lead : null;
      dt = toHead != null ? dt + toHead : snapToFrame(lead) - start[moving.indexOf(mine[0])];
    }
    const lo = -Math.min(...start), hi = f.length - Math.max(...start);
    dt = Math.max(lo, Math.min(hi, dt));
    moving.forEach((k, i) => { k.t = roundT(start[i] + dt); });
    A.live();
  };
  const up = () => {
    window.removeEventListener('pointermove', mv);
    window.removeEventListener('pointerup', up);
    if (!before) return;
    _settle(moving);
    A.endEdit(before);
  };
  window.addEventListener('pointermove', mv);
  window.addEventListener('pointerup', up);
}

// After keys moved: every channel in time order, and a key that landed on a moment its channel had a key at
// replaces that one (the owner: several presses with the playhead in place must not stack keys in one spot).
function _settle(moved) {
  const f = A.frag();
  const mset = new Set(moved);
  for (const tr of Object.values(f.tracks)) {
    for (const ch of ['p', 'r', 's', 'v']) {
      const list = tr[ch];
      if (!Array.isArray(list)) continue;
      const out = [];
      for (const k of list.slice().sort((a, b) => a.t - b.t)) {
        const j = out.findIndex(x => sameMoment(x.t, k.t));
        if (j < 0) out.push(k);
        else if (mset.has(k) || !mset.has(out[j])) out[j] = k;
      }
      tr[ch] = out;
    }
  }
}

function _easeMenu(e, d) {
  const mine = d._keys.map(g => g.k);
  if (!mine.every(k => picked.has(k))) { picked = new Set(mine); paint(); }
  const m = el('div', 's3-menu');
  for (const ez of EASES) {
    const b = el('button', 's3-menu-i');
    b.type = 'button';
    b.append(el('span', '', EASE_LABEL[ez]));
    b.addEventListener('click', () => {
      close();
      const before = A.beginEdit();
      for (const k of picked) k.ease = ez;
      A.endEdit(before);
    });
    m.appendChild(b);
  }
  const del = el('button', 's3-menu-i');
  del.type = 'button';
  del.append(el('span', '', 'Delete'));
  del.addEventListener('click', () => { close(); deleteKeys(); });
  m.appendChild(del);
  m.style.left = Math.min(e.clientX, window.innerWidth - 200) + 'px';
  m.style.top = Math.max(8, e.clientY - 210) + 'px';
  document.body.appendChild(m);
  const layer = Layers.open(m, { modal: false, onEsc: () => close(), name: 'ease' });
  const off = (ev) => { if (!m.contains(ev.target)) close(); };
  function close() { Layers.close(layer); m.remove(); document.removeEventListener('pointerdown', off, true); }
  setTimeout(() => document.addEventListener('pointerdown', off, true), 0);
}

/** Delete the picked keys. True when there were some (then Delete is the timeline's, not the scene's). */
export function deleteKeys() {
  const f = A.frag && A.frag();
  if (!f || !picked.size) return false;
  const before = A.beginEdit();
  for (const tr of Object.values(f.tracks)) {
    for (const ch of ['p', 'r', 's', 'v']) if (Array.isArray(tr[ch])) { tr[ch] = tr[ch].filter(k => !picked.has(k)); if (!tr[ch].length) delete tr[ch]; }
  }
  picked = new Set();
  A.endEdit(before);
  return true;
}

/** Ctrl+C: the picked keys, their moments counted from the earliest. */
export function copy() {
  const f = A.frag && A.frag();
  if (!f || !picked.size) return false;
  const items = [];
  for (const [oid, tr] of Object.entries(f.tracks)) {
    for (const ch of ['p', 'r', 's', 'v']) for (const k of tr[ch] || []) if (picked.has(k)) items.push({ oid, ch, t: k.t, v: JSON.parse(JSON.stringify(k.v)), ease: k.ease });
  }
  const t0 = Math.min(...items.map(x => x.t));
  clip = items.map(x => ({ oid: x.oid, ch: x.ch, dt: x.t - t0, v: x.v, ease: x.ease }));
  A.note(items.length + (items.length === 1 ? ' key' : ' keys') + ' copied - Ctrl+V puts them at the playhead');
  return true;
}

/** Ctrl+V: the copied keys at the playhead, on the same things and channels (that still move here). */
export function paste() {
  const f = A.frag && A.frag();
  if (!f || !clip || !clip.length) return false;
  const before = A.beginEdit();
  const fresh = new Set();
  for (const c of clip) {
    const tr = f.tracks[c.oid];
    if (!tr) continue;
    const t = roundT(Math.min(f.length, A.t + c.dt));
    const k = { t, v: JSON.parse(JSON.stringify(c.v)), ease: c.ease };
    tr[c.ch] = (tr[c.ch] || []).filter(x => !sameMoment(x.t, t)).concat([k]).sort((a, b) => a.t - b.t);
    fresh.add(k);
  }
  picked = fresh;
  A.endEdit(before);
  return true;
}

function _zoom(k, atClientX) {
  const L = els.lanes;
  const P = _pps();
  const anchor = atClientX != null ? atClientX - L.getBoundingClientRect().left : L.clientWidth / 2;
  const tAt = (L.scrollLeft + anchor - PAD) / P;
  pps = Math.max(8, Math.min(2000, P * k));
  paint();
  L.scrollLeft = Math.max(0, PAD + tAt * pps - anchor);
}

// Ctrl / Shift + wheel and a pinch (Chromium hands it over with Ctrl) zoom round the pointer - mouse and touchpad
// alike (the owner); sideways the lanes scroll along time, up and down through the rows.
function _wheel(e) {
  if (e.ctrlKey || e.shiftKey) {
    e.preventDefault();
    const d = e.deltaY || e.deltaX;
    _zoom(Math.max(0.85, Math.min(1.18, Math.exp(-d * 0.004))), e.clientX);
  }
}

function _addMenu(anchor) {
  const sc = A.scene;
  const m = el('div', 's3-menu');
  const item = (label, sub, fn) => {
    const b = el('button', 's3-menu-i');
    b.type = 'button';
    b.append(el('span', '', label), el('small', '', sub));
    b.addEventListener('click', () => { close(); fn(); });
    m.appendChild(b);
  };
  item('From the arrangement', 'everything where it stands in the scene', () => A.addFragment());
  for (const f of sc.fragments) item('From the end of “' + (f.name || 'Fragment') + '”', 'what moves there starts where it ended', () => A.addFragment(f.id));
  const r = anchor.getBoundingClientRect();
  m.style.left = Math.round(r.left) + 'px';
  m.style.top = Math.round(Math.max(8, r.top - 8 - Math.min(320, 46 * (sc.fragments.length + 1)))) + 'px';
  document.body.appendChild(m);
  const layer = Layers.open(m, { modal: false, onEsc: () => close(), name: 'fragment' });
  const off = (ev) => { if (!m.contains(ev.target) && ev.target !== anchor) close(); };
  function close() { Layers.close(layer); m.remove(); document.removeEventListener('pointerdown', off, true); }
  setTimeout(() => document.addEventListener('pointerdown', off, true), 0);
}

export const FRAME = 1 / FPS;
