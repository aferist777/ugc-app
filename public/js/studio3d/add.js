/* ════════════════════════════════════════════════════════════════════════════
   3D STUDIO — putting things in the scene (PLAN "3D Studio", 3D1).

   "Add ▾" offers three:
     Character…     the Library's characters and their looks, through the same picker the video chat uses
                    (merge-v3/chat-pick.js). The character becomes a mannequin of its gender, under its name; the
                    picture pressed - the character's sheet or one of its looks - is its reference for Seedance.
     Environment…   the Library's environments: the agent lays the room out from the picture (lib/studio3d-env.js,
                    3D9) - its size, windows and doors, its LARGE furniture, where the photo was taken from - and it
                    comes into the scene in one step: the room takes the picture as its reference and the scene as
                    its photo, an earlier environment's furniture goes, the first camera stands where the photo did.
     Furniture…     Kenney's kit, by group, a picture of each; a press puts one in and the window stays open.
   pickReference() changes the picture an object already in the scene stands for.
   ════════════════════════════════════════════════════════════════════════════ */

import * as Layers from '../layers.js';
import { openPick, closePick, pickSay } from '../merge-v3/chat-pick.js';
import * as THREE from 'three';
import { FURNITURE, ROOM_COLOR } from './catalog.js';

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const thumbOf = (p, v) => '/api/thumb?src=' + encodeURIComponent(p) + '&v=' + (v || 'strip');
const json = (u) => fetch(u).then(r => r.json()).catch(() => null);
const _gone = (d) => ({ items: [], cats: [], why: (d && d.error) || 'the shelf could not be read' });
const _pic = (path, name, sub, x) => Object.assign({ path, name: name || '', sub: sub || '', thumb: thumbOf(path, 'strip'), big: thumbOf(path, 'main') }, x || {});

// ── The Library's shelves ────────────────────────────────────────────────
// A character's sheet, then its looks - one character after another; each item knows whose it is and the gender.
async function _people() {
  const [c, l] = await Promise.all([json('/api/library/shelf/characters'), json('/api/library/shelf/looks')]);
  if (!c || !c.success) return _gone(c);
  const chars = c.items || [];
  const looks = (l && l.success) ? l.items || [] : [];
  const out = [];
  for (const ch of chars) {
    const who = { charId: ch.id, charName: ch.name, gender: (ch.meta || {}).gender || '' };
    out.push(_pic(ch.media, ch.name, 'character', Object.assign({ aspect: '16:9', refKind: 'character', refId: ch.id }, who)));
    for (const lk of looks.filter(x => (x.meta || {}).charId === ch.id)) {
      out.push(_pic(lk.media, lk.name, ch.name + ' · look', Object.assign({ refKind: 'look', refId: lk.id }, who)));
    }
  }
  return { items: out.filter(x => x.path) };
}
async function _environments() {
  const d = await json('/api/library/shelf/environments');
  if (!d || !d.success) return _gone(d);
  return { items: (d.items || []).filter(i => i && i.media).map(i => _pic(i.media, i.name, '', { aspect: '3:2', refKind: 'environment', refId: i.id })) };
}
async function _images() {
  const d = await json('/api/library/shelf/media?filter=images');
  if (!d || !d.success) return _gone(d);
  // The same shape as the video chat's Images (merge-v3/vidchat.js _media): categories chosen in the window.
  const cats = (d.cats || []).filter(c => c && c.id);
  const nameOf = new Map(cats.map(c => [c.id, c.name || '']));
  return { cats, items: (d.items || []).filter(i => i && i.media).map(i => {
    const m = i.meta || {};
    return _pic(i.media, i.name, nameOf.get(m.categoryId || '__uncat__') || '', { cat: m.categoryId || '', refKind: 'image', refId: i.id });
  }) };
}

const SOURCES = {
  people: { id: 'people', label: 'characters & looks', load: _people },
  environments: { id: 'environments', label: 'environments', load: _environments },
  images: { id: 'images', label: 'Images', load: _images },
};

// The picker, for one thing: closes on the press. `onPick(item)`.
function _pick(title, hint, sources, onPick, elsewhere) {
  let done = false;
  openPick({
    kind: 'image', title, hint, project: { key: '3d', title: '' }, sources, first: sources[0].id,
    left: () => (done ? 0 : 1), mark: () => '', room: () => '', why: () => '',
    press: (it) => { if (done) return; done = true; closePick(); onPick(it); },
    computer: {
      word: 'pictures', hint: '', accepts: () => false, drop: () => {},
      open: () => pickSay(elsewhere),
    },
    onClose: () => {},
  });
}

function _ref(it) { return { path: it.path, kind: it.refKind || 'image', id: String(it.refId || ''), name: it.name || '' }; }

export function addCharacter(A) {
  _pick('Add a character', 'A character, or one of its looks - the picture is its reference', [SOURCES.people], (it) => {
    A.addObject({
      kind: 'character', name: it.charName || it.name || 'Person', asset: 'person:' + (it.gender === 'female' ? 'female' : 'male'),
      ref: _ref(it), char: { id: String(it.charId || ''), name: it.charName || '', gender: it.gender || '' },
    });
  }, 'Characters are made on the Library\'s Characters shelf.');
}

// The furniture an environment brings: quiet tints, apart from the characters' strong ones - it stands still, and in
// the recording it is grey anyway (it has no reference of its own).
const ENV_COLORS = ['#c8b79e', '#a9b9c8', '#b6c7a6', '#c7a9b8', '#a8c6c1', '#c4bfa4', '#b3a9c9', '#c9b2a3'];

// The photo's shape, read off the picture itself: a landscape one is filmed in 16:9, an upright one in 9:16.
function _shapeOf(path) {
  return new Promise((res) => {
    const im = new Image();
    im.onload = () => res(im.naturalWidth >= im.naturalHeight ? '16:9' : '9:16');
    im.onerror = () => res('16:9');
    im.src = thumbOf(path, 'strip');
  });
}

/**
 * An environment's layout put into the scene, as ONE step of Ctrl+Z: the room takes its size and its windows and
 * doors, the furniture of the environment before it goes and this one's comes in, and the first camera stands
 * where the photo was taken from. Characters and what the person added stay.
 */
function applyLayout(A, it, L, format) {
  const path = it.path;
  const ids = [];
  A.change(s => {
    s.source = { path, from: 'library' };
    let room = s.objects.find(o => o.kind === 'room');
    if (!room) { room = { id: A.newId('o'), kind: 'room', asset: 'room', color: ROOM_COLOR, p: [0, 0, 0], r: [0, 0, 0], s: [1, 1, 1], char: null }; s.objects.unshift(room); }
    Object.assign(room, { name: it.name || room.name || 'Room', ref: _ref(it), env: path, p: [0, 0, 0], r: [0, 0, 0],
      room: { w: L.room.width, d: L.room.depth, h: L.room.height, door: false, window: false, openings: L.openings.map(o => Object.assign({}, o)) } });
    s.objects = s.objects.filter(o => o.kind === 'room' || o.kind === 'character' || !o.env);
    L.objects.forEach((o, i) => {
      const obj = { id: A.newId('o'), kind: 'prop', name: o.name, color: ENV_COLORS[i % ENV_COLORS.length], ref: null, char: null,
        p: [o.x, o.y || 0, o.z], r: [0, o.facing, 0], s: [1, 1, 1], env: path };
      if (o.model === 'block') Object.assign(obj, { asset: 'block', box: [o.size.width, o.size.height, o.size.depth] });
      else obj.asset = 'kenney:' + o.model;
      s.objects.push(obj);
      ids.push(obj.id);
    });
    const c = s.cameras.find(x => x.id === s.camera) || s.cameras[0];
    if (c) {
      // yaw to the right and pitch up, in the order a camera is turned (the scene keeps three.js XYZ degrees)
      const e = new THREE.Euler().setFromQuaternion(new THREE.Quaternion().setFromEuler(
        new THREE.Euler(THREE.MathUtils.degToRad(L.camera.pitch), THREE.MathUtils.degToRad(-L.camera.yaw), 0, 'YXZ')), 'XYZ');
      c.p = [L.camera.x, L.camera.height, L.camera.z];
      c.r = [e.x, e.y, e.z].map(v => Math.round(THREE.MathUtils.radToDeg(v) * 100) / 100);
      c.focal = L.camera.focal;
      c.format = format;
    }
  });
  return ids;
}

/**
 * Lay an environment of the Library into the open scene: ask the server for its layout (described and laid out by
 * the agents, or kept from before), then put it in. `it` is a picker item ({ path, name, refKind, refId }).
 */
export async function layEnvironment(A, it) {
  const sceneId = A.scene.id;
  const name = it.name || 'the environment';
  A.note('Laying out “' + name + '”: the agent is looking at the picture - about half a minute…');
  const [r, format] = await Promise.all([A.api('POST', '/api/3d/env', { path: it.path }).catch(() => ({ ok: false, j: { error: 'The server did not answer.' } })), _shapeOf(it.path)]);
  // Gone to another scene meanwhile: the layout is kept with the environment, the next time is free.
  if (!A.scene || A.scene.id !== sceneId) return;
  if (!r.ok) { A.note('“' + name + '” could not be laid out: ' + (r.j.error || 'no answer'), true); return; }
  const ids = applyLayout(A, it, r.j.layout, format);
  A.select([]);
  A.vp.frame([]);
  const n = r.j.layout.objects.length;
  const k = r.j.layout.openings.length;
  const said = [n + (n === 1 ? ' piece' : ' pieces') + ' of furniture, ' + k + (k === 1 ? ' window or door' : ' windows and doors')];
  if (r.j.described) said.push('its description written into the Library');
  said.push(r.j.cached ? 'laid out before - free' : '≈ $' + ((r.j.credits || 0) * 0.005).toFixed(3));
  A.note('“' + name + '”: ' + said.join(' · '));
  return ids;
}

export function addEnvironment(A) {
  _pick('Environment of the scene', 'Its room and large furniture are laid out from the picture', [SOURCES.environments], (it) => layEnvironment(A, it),
    'Environments are made or brought in on the Library’s Environments shelf.');
}

/** Choose the picture an object stands for. */
export function pickReference(A, id) {
  const o = A.scene && A.scene.objects.find(x => x.id === id);
  if (!o) return;
  const src = o.kind === 'character' ? [SOURCES.people, SOURCES.images] : o.kind === 'room' ? [SOURCES.environments, SOURCES.images] : [SOURCES.images, SOURCES.environments];
  _pick('Reference of “' + (o.name || 'object') + '”', 'The picture Seedance will be told this object is', src, (it) => {
    A.change(s => {
      const t = s.objects.find(x => x.id === id);
      if (!t) return;
      t.ref = _ref(it);
      if (t.kind === 'character' && it.refKind && it.charId) t.char = { id: String(it.charId), name: it.charName || '', gender: it.gender || '' };
    });
  }, 'Pictures come from the Library - bring one in on its Images shelf first.');
}

// ── The furniture window ─────────────────────────────────────────────────
let _fw = null;
export function openFurniture(A) {
  if (_fw) return;
  const ov = el('div', 's3-fw-ov');
  const box = el('div', 's3-fw');
  const head = el('div', 's3-fw-head');
  head.appendChild(el('h3', '', 'Furniture'));
  head.appendChild(el('span', 's3-fw-hint', 'A press puts one in the scene; the window stays open.'));
  const sp = el('span', 'sp');
  const x = el('button', 'lib-btn', 'Done');
  x.type = 'button';
  head.append(sp, x);
  const body = el('div', 's3-fw-body');
  const tabs = el('div', 's3-fw-tabs');
  const grid = el('div', 's3-fw-grid');
  body.append(tabs, grid);
  box.append(head, body);
  ov.appendChild(box);
  document.body.appendChild(ov);
  const close = () => { if (!_fw) return; Layers.close(_fw.layer); ov.remove(); _fw = null; };
  _fw = { layer: Layers.open(ov, { onEsc: close, name: 'furniture' }) };
  x.addEventListener('click', close);
  ov.addEventListener('pointerdown', (e) => { if (e.target === ov) close(); });
  let cur = FURNITURE[0].group;
  const show = () => {
    tabs.textContent = '';
    for (const g of FURNITURE) {
      const b = el('button', 's3-fw-tab' + (g.group === cur ? ' on' : ''), g.group);
      b.type = 'button';
      b.addEventListener('click', () => { cur = g.group; show(); });
      tabs.appendChild(b);
    }
    grid.textContent = '';
    for (const it of FURNITURE.find(g => g.group === cur).items) {
      const t = el('button', 's3-fw-tile');
      t.type = 'button';
      const im = el('img');
      im.src = it.preview;
      im.alt = '';
      im.loading = 'lazy';
      t.append(im, el('span', '', it.name));
      t.addEventListener('click', () => {
        A.addObject({ kind: 'prop', name: it.name, asset: 'kenney:' + it.id });
        t.classList.remove('added');
        void t.offsetWidth;
        t.classList.add('added');
      });
      grid.appendChild(t);
    }
  };
  show();
}

// ── "Add ▾" ──────────────────────────────────────────────────────────────
export function initAdd(A, btn) {
  let menu = null;
  const shut = () => { if (!menu) return; Layers.close(menu.layer); menu.el.remove(); menu = null; };
  btn.addEventListener('click', () => {
    if (menu) { shut(); return; }
    if (!A.scene) { A.status('Open or make a scene first.', true); return; }
    const m = el('div', 's3-menu');
    for (const [label, sub, fn] of [
      ['Character…', 'a mannequin from the Library', () => addCharacter(A)],
      ['Environment…', 'the room, from the Library', () => addEnvironment(A)],
      ['Furniture…', 'sofas, tables, beds…', () => openFurniture(A)],
    ]) {
      const b = el('button', 's3-menu-i');
      b.type = 'button';
      b.append(el('span', '', label), el('small', '', sub));
      b.addEventListener('click', () => { shut(); fn(); });
      m.appendChild(b);
    }
    const r = btn.getBoundingClientRect();
    m.style.left = Math.round(r.left) + 'px';
    m.style.top = Math.round(r.bottom + 4) + 'px';
    document.body.appendChild(m);
    menu = { el: m, layer: Layers.open(m, { modal: false, onEsc: shut, name: 'add' }) };
    setTimeout(() => document.addEventListener('pointerdown', function off(e) {
      if (menu && !menu.el.contains(e.target) && e.target !== btn) shut();
      if (!menu) document.removeEventListener('pointerdown', off, true);
    }, true), 0);
  });
  // closePick is used by the page when a scene closes under an open picker
  return { closePick };
}
