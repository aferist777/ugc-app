/* ════════════════════════════════════════════════════════════════════════════
   3D STUDIO — the left column: what is in the scene, and the one selected.

   Top: every object and camera, a row each with its colour - a press selects it, Shift or Ctrl adds it to the
   selection. Below: the selected object's card - its name, the picture it stands for (its reference for Seedance),
   its colour, where it stands, how it is turned and how big it is, a room's size. Every field is one step of
   Ctrl+Z, written when it is left or Enter is pressed.

   The card is not rebuilt under the person's hands: while one of its fields is being typed in, a repaint only
   refreshes the numbers in the other fields.
   ════════════════════════════════════════════════════════════════════════════ */

import { pickReference } from './add.js';

let A = null;          // the page (main.js)
let host = null;
let _card = '';        // what the card was built for: '<id>|<kind>' - rebuilt when that changes

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const KIND = { character: 'character', prop: 'furniture', room: 'room' };
const thumb = (p) => '/api/thumb?src=' + encodeURIComponent(p) + '&v=strip';

export function init(app, node) {
  A = app;
  host = node;
}

export function paint() {
  if (!host) return;
  const sc = A.scene;
  if (!sc) { host.textContent = ''; _card = ''; return; }
  _list(sc);
  const one = A.sel.length === 1 ? (sc.objects.find(o => o.id === A.sel[0]) || null) : null;
  const fr = A.frag();
  const moves = one && fr ? (fr.tracks[one.id] ? 'm' : 's') + fr.id : '';
  const key = A.sel.length > 1 ? 'many|' + A.sel.length : one ? one.id + '|' + one.kind + '|' + (one.ref ? one.ref.path : '') + '|' + moves : A.sel.length ? 'cam' : '';
  if (key !== _card || !host.querySelector('.s3-card')) { _card = key; _build(sc, one); }
  else _refresh(one);
}

// ── The list ─────────────────────────────────────────────────────────────
function _list(sc) {
  let L = host.querySelector('.s3-list');
  if (!L) {
    host.textContent = '';
    host.appendChild(el('div', 's3-h', 'In the scene'));
    L = el('div', 's3-list');
    host.appendChild(L);
    host.appendChild(el('div', 's3-card'));
  }
  L.textContent = '';
  const rows = [...sc.objects.map(o => ({ id: o.id, name: o.name || KIND[o.kind], sub: KIND[o.kind], color: o.color })),
    ...sc.cameras.map(c => ({ id: c.id, name: c.name || 'Camera', sub: 'camera', color: c.color }))];
  if (!sc.objects.length) L.appendChild(el('div', 's3-none', 'Nothing yet - Add puts a character, a room or furniture here.'));
  for (const r of rows) {
    const b = el('button', 's3-row' + (A.sel.includes(r.id) ? ' on' : ''));
    b.type = 'button';
    const dot = el('span', 's3-dot');
    dot.style.background = r.color;
    b.append(dot, el('span', 's3-row-n', r.name), el('span', 's3-row-k', r.sub));
    b.addEventListener('click', (e) => {
      if (e.shiftKey || e.ctrlKey) A.select(A.sel.includes(r.id) ? A.sel.filter(x => x !== r.id) : [...A.sel, r.id]);
      else A.select([r.id]);
    });
    L.appendChild(b);
  }
}

// ── The card ─────────────────────────────────────────────────────────────
function _build(sc, o) {
  const C = host.querySelector('.s3-card');
  C.textContent = '';
  if (A.sel.length > 1) {
    C.appendChild(el('div', 's3-h', A.sel.length + ' selected'));
    C.appendChild(el('div', 's3-hint', 'The handles move them together. Shift or Ctrl with a press adds or takes one off.'));
    C.appendChild(_del());
    return;
  }
  if (!o) {
    if (A.sel.length) C.appendChild(el('div', 's3-hint', 'The camera is set in the right column.'));
    return;
  }
  C.appendChild(el('div', 's3-h', KIND[o.kind]));
  // Moves in the open fragment: a track of its own on the timeline. Then the handles and the numbers below key
  // it at the playhead; without it, they move it in the shared arrangement - in every fragment.
  const fr = A.frag();
  if (fr && o.kind !== 'room') {
    const l = el('label', 's3-check s3-moves');
    const cb = el('input');
    cb.type = 'checkbox';
    cb.checked = !!fr.tracks[o.id];
    cb.addEventListener('change', () => A.setMoves(o.id, cb.checked));
    l.append(cb, document.createTextNode(' moves in “' + (fr.name || 'this fragment') + '”'));
    l.title = 'Ticked: a track of its own in this fragment, and moving it keys it at the playhead. Unticked: its track and keys go (Ctrl+Z brings them back), and moving it moves it in every fragment.';
    C.appendChild(l);
  }
  // Name
  const name = _field('Name', 'text', o.name, (v) => A.change(s => { _obj(s, o.id).name = String(v).slice(0, 80); }));
  name.dataset.k = 'name';
  C.appendChild(name.row);
  // Reference
  const ref = el('div', 's3-ref');
  const pic = el('button', 's3-ref-pic');
  pic.type = 'button';
  pic.title = 'The picture this object stands for - its reference for Seedance. Press to choose another.';
  if (o.ref && o.ref.path) { const im = el('img'); im.src = thumb(o.ref.path); im.alt = ''; pic.appendChild(im); }
  else pic.textContent = '+';
  pic.addEventListener('click', () => pickReference(A, o.id));
  const words = el('div', 's3-ref-w');
  words.appendChild(el('div', 's3-ref-t', o.ref ? (o.ref.name || 'picture') : 'no reference'));
  words.appendChild(el('div', 's3-ref-s', o.ref ? o.ref.kind : (o.kind === 'room' ? 'an environment from the Library' : o.kind === 'character' ? 'a character or a look' : 'a picture from Images')));
  if (o.ref) {
    const x = el('button', 's3-x', 'remove');
    x.type = 'button';
    x.addEventListener('click', () => A.change(s => { _obj(s, o.id).ref = null; }));
    words.appendChild(x);
  }
  ref.append(pic, words);
  C.appendChild(_labelled('Reference', ref));
  // Colour
  const col = el('input', 's3-color');
  col.type = 'color';
  col.value = o.color;
  col.dataset.k = 'color';
  col.addEventListener('change', () => A.change(s => { _obj(s, o.id).color = col.value; }));
  C.appendChild(_labelled('Colour', col, 'Its label colour - in the recording when it has a reference, and its track on the timeline.'));
  // Where it stands
  C.appendChild(_vec3('Position, m', 'p', o, 0.05));
  C.appendChild(_vec3('Turn, °', 'r', o, 5));
  if (o.asset === 'block') C.appendChild(_vec3('Size, m', 'box', o, 0.05, ['w', 'h', 'd']));
  else if (o.kind !== 'room') C.appendChild(_vec3('Scale', 's', o, 0.05));
  // A room's size
  if (o.kind === 'room') {
    const R = o.room || {};
    const g = el('div', 's3-vec');
    for (const [k, lab] of [['w', 'width'], ['d', 'depth'], ['h', 'height']]) {
      const f = _num(R[k], 0.1, (v) => A.change(s => { const r = _obj(s, o.id).room; r[k] = Math.max(k === 'h' ? 2 : 1, Math.min(k === 'h' ? 12 : 60, v)); }));
      f.dataset.k = 'room.' + k;
      f.title = lab;
      g.appendChild(_mini(k, f));
    }
    C.appendChild(_labelled('Room, m', g));
    if (Array.isArray(R.openings)) {
      const nw = R.openings.filter(x => x.kind === 'window').length, nd = R.openings.length - nw;
      C.appendChild(el('div', 's3-hint', 'Windows: ' + nw + ', doors and openings: ' + nd + ' - where the environment has them.'));
      C.appendChild(_del());
      return;
    }
    const opts = el('div', 's3-checks');
    for (const [k, lab] of [['door', 'door'], ['window', 'window']]) {
      const l = el('label', 's3-check');
      const cb = el('input');
      cb.type = 'checkbox';
      cb.checked = R[k] !== false;
      cb.addEventListener('change', () => A.change(s => { _obj(s, o.id).room[k] = cb.checked; }));
      l.append(cb, document.createTextNode(' ' + lab));
      opts.appendChild(l);
    }
    C.appendChild(opts);
  }
  C.appendChild(_del());
}

// The numbers follow the handles: every field but the one being typed in.
function _refresh(o) {
  if (!o) return;
  const C = host.querySelector('.s3-card');
  for (const f of C.querySelectorAll('[data-k]')) {
    if (f === document.activeElement) continue;
    const k = f.dataset.k;
    let v;
    if (k === 'name') v = o.name;
    else if (k === 'color') v = o.color;
    else if (k.startsWith('room.')) v = (o.room || {})[k.slice(5)];
    else {
      const [a, i] = k.split('.');
      const q = (a === 'p' || a === 'r' || a === 's') && A.poseOf(o.id);
      v = q ? q[a][+i] : o[a] ? o[a][+i] : '';
    }
    f.value = typeof v === 'number' ? String(Math.round(v * 1000) / 1000) : (v == null ? '' : v);
  }
}

const _obj = (s, id) => s.objects.find(x => x.id === id);

function _del() {
  const b = el('button', 'lib-btn danger s3-del', A.sel.length > 1 ? 'Delete them' : 'Delete');
  b.type = 'button';
  b.title = 'Delete (the Delete key does the same; Ctrl+Z brings it back)';
  b.addEventListener('click', () => A.removeSelected());
  return b;
}

function _labelled(label, node, title) {
  const r = el('div', 's3-f');
  const l = el('div', 's3-f-l', label);
  if (title) l.title = title;
  r.append(l, node);
  return r;
}
function _mini(label, node) {
  const w = el('label', 's3-mini');
  w.append(el('span', '', label), node);
  return w;
}

function _commitOn(input, fn) {
  const go = () => fn(input.value);
  input.addEventListener('change', go);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); input.blur(); } if (e.key === 'Escape') { input.blur(); } });
}

function _field(label, type, value, fn) {
  const i = el('input', 's3-in');
  i.type = type;
  i.value = value == null ? '' : value;
  i.spellcheck = false;
  _commitOn(i, fn);
  return { row: _labelled(label, i), set dataset(v) { Object.assign(i.dataset, v); }, get dataset() { return i.dataset; } };
}

function _num(value, step, fn) {
  const i = el('input', 's3-in s3-num');
  i.type = 'number';
  i.step = String(step);
  i.value = String(Math.round((Number(value) || 0) * 1000) / 1000);
  _commitOn(i, (v) => { const n = Number(v); if (isFinite(n)) fn(n); });
  return i;
}

function _vec3(label, key, o, step, axes) {
  const g = el('div', 's3-vec');
  (axes || ['x', 'y', 'z']).forEach((ax, i) => {
    const q = (key === 'p' || key === 'r' || key === 's') && A.poseOf(o.id);
    const f = _num(q ? q[key][i] : o[key] ? o[key][i] : 0, step, (v) => {
      const val = key === 's' || key === 'box' ? Math.max(0.05, v) : v;
      // Something that moves here: a key at the playhead; anything else: the shared arrangement.
      if ((key === 'p' || key === 'r' || key === 's') && A.keyValue(o.id, key, i, val)) return;
      A.change(s => {
        const t = _obj(s, o.id);
        if (!t[key]) t[key] = [0, 0, 0];
        t[key][i] = val;
      });
    });
    f.dataset.k = key + '.' + i;
    g.appendChild(_mini(ax, f));
  });
  return _labelled(label, g);
}
