/* ════════════════════════════════════════════════════════════════════════════
   3D STUDIO — the page (PLAN "3D Studio - план по этапам", 3D1).

   It holds the open scene and is the only one that changes it: every change goes through `change(fn)`, which keeps
   the scene as it was for Ctrl+Z, redraws what the change touched and saves a moment later. The server keeps the
   scene (routes/studio3d.js); a page that leaves takes nothing with it.

   A save carries the rev the copy was made from. Another window (or, from 3D5, the agent) saving meanwhile turns it
   down with the scene as it is now - and the page takes that copy, says so, and goes on from it.

   The scene open in this session is remembered in sessionStorage (like Merge's project, the owner: strictly this
   session); with none, the studio opens on the gallery.
   ════════════════════════════════════════════════════════════════════════════ */

import * as Layers from '../layers.js';
import { askName } from '../name-box.js';
import { createViewport } from './viewport.js';
import { PALETTE, CAMERA_COLORS } from './catalog.js';
import * as Left from './left.js';
import * as Right from './right.js';
import { openGallery, closeGallery } from './gallery.js';
import { initAdd } from './add.js';

const SS_OPEN = 's3d_open_v1';
const SAVE_AFTER = 600;                 // ms of quiet before a change is saved
const THUMB_EVERY = 15000;              // the gallery's picture is redrawn at most this often
const HISTORY = 100;

const $ = (id) => document.getElementById(id);
const clone = (v) => JSON.parse(JSON.stringify(v));

const S = {
  scene: null,                          // the open scene, as the page has it
  sel: [],                              // what is selected: object and camera ids
  past: [], future: [],                 // snapshots for Ctrl+Z / Ctrl+Y
  timer: 0, pending: false,             // a change waiting for its save
  saving: null, again: false,           // the save in the air, and whether another is owed after it
  thumbAt: 0,
};

let vp = null;

// ── Saying what happens ──────────────────────────────────────────────────
function status(text, bad) {
  const el = $('s3-status');
  el.textContent = text || '';
  el.classList.toggle('is-bad', !!bad);
}

// A word about what was just done - it stays until the next one, whatever the saving says.
function note(text, bad) {
  const el = $('s3-note');
  el.textContent = text || '';
  el.title = text || '';
  el.classList.toggle('is-bad', !!bad);
}

async function api(method, url, body) {
  const r = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  let j = null;
  try { j = await r.json(); } catch (e) { /* not JSON */ }
  return { status: r.status, ok: r.ok && j && j.success !== false, j: j || {} };
}

// ── The scene on screen ──────────────────────────────────────────────────
function paintAll() {
  if (!S.scene) return;
  $('s3-name').textContent = S.scene.name || 'Untitled';
  $('s3-empty').hidden = S.scene.objects.length > 0;
  vp.syncObjects(S.scene.objects);
  vp.syncCameras(S.scene.cameras);
  S.sel = S.sel.filter(id => S.scene.objects.some(o => o.id === id) || S.scene.cameras.some(c => c.id === id));
  vp.select(S.sel);
  Left.paint();
  Right.paint();
}

function _snapshot() { return clone({ objects: S.scene.objects, cameras: S.scene.cameras, camera: S.scene.camera }); }
function _restore(snap) { Object.assign(S.scene, clone(snap)); }

/** Change the scene: one step of Ctrl+Z. `fn(scene)` changes it in place and must not await. */
function change(fn) {
  if (!S.scene) return;
  const before = _snapshot();
  fn(S.scene);
  if (JSON.stringify(before) === JSON.stringify(_snapshot())) return;   // nothing changed: no step, no save
  S.past.push(before);
  if (S.past.length > HISTORY) S.past.shift();
  S.future = [];
  paintAll();
  saveSoon();
}

function undo() {
  if (!S.past.length) return;
  S.future.push(_snapshot());
  _restore(S.past.pop());
  paintAll();
  saveSoon();
}
function redo() {
  if (!S.future.length) return;
  S.past.push(_snapshot());
  _restore(S.future.pop());
  paintAll();
  saveSoon();
}

// ── Saving ───────────────────────────────────────────────────────────────
function saveSoon() {
  clearTimeout(S.timer);
  S.pending = true;
  status('…');
  S.timer = setTimeout(saveNow, SAVE_AFTER);
}

async function saveNow() {
  clearTimeout(S.timer);
  if (!S.scene) return;
  S.pending = false;
  if (S.saving) { S.again = true; return S.saving; }
  const id = S.scene.id;
  const sent = clone(S.scene);
  S.saving = (async () => {
    status('saving…');
    let r;
    try { r = await api('PUT', '/api/3d/scenes/' + encodeURIComponent(id), { scene: sent, rev: sent.rev }); }
    catch (e) { r = { status: 0, ok: false, j: { error: 'The server did not answer.' } }; }
    if (!S.scene || S.scene.id !== id) return;
    if (r.ok) {
      S.scene.rev = r.j.scene.rev;
      S.scene.updatedAt = r.j.scene.updatedAt;
      status('saved');
      if (Date.now() - S.thumbAt > THUMB_EVERY) thumbSoon();
    } else if (r.status === 409 && r.j.scene) {
      // Saved from somewhere else meanwhile: that copy wins, and the history no longer describes it.
      S.scene = r.j.scene;
      S.past = []; S.future = [];
      paintAll();
      status('changed in another window - took that copy', true);
    } else if (r.status === 404) {
      status('this scene is gone - it was deleted', true);
    } else {
      status('not saved: ' + (r.j.error || 'the server said ' + r.status), true);
    }
  })();
  try { await S.saving; } finally {
    S.saving = null;
    if (S.again) { S.again = false; saveNow(); }
  }
}

let _thumbT = 0;
function thumbSoon() {
  clearTimeout(_thumbT);
  _thumbT = setTimeout(async () => {
    if (!S.scene) return;
    const id = S.scene.id;
    const blob = await Right.snapshot();
    if (!blob || !S.scene || S.scene.id !== id) return;
    S.thumbAt = Date.now();
    fetch('/api/3d/scenes/' + encodeURIComponent(id) + '/thumb', { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: blob }).catch(() => {});
  }, 1200);
}

// ── Opening and leaving a scene ──────────────────────────────────────────
async function openScene(id) {
  if (S.scene) await saveNow();
  const r = await api('GET', '/api/3d/scenes/' + encodeURIComponent(id));
  if (!r.ok) { status(r.j.error || 'The scene could not be opened.', true); return false; }
  S.scene = r.j.scene;
  S.sel = []; S.past = []; S.future = [];
  try { sessionStorage.setItem(SS_OPEN, S.scene.id); } catch (e) { /* a private window */ }
  closeGallery();
  paintAll();
  vp.frame([]);
  status('');
  note('');
  return true;
}

async function newScene() {
  const r = await api('POST', '/api/3d/scenes', { name: '' });
  if (!r.ok) { status(r.j.error || 'A scene could not be made.', true); return; }
  await openScene(r.j.scene.id);
}

function forget(id) {
  if (S.scene && S.scene.id === id) {
    S.scene = null;
    try { sessionStorage.removeItem(SS_OPEN); } catch (e) { /* a private window */ }
    $('s3-name').textContent = '';
    vp.syncObjects([]);
    vp.syncCameras([]);
    Left.paint();
    Right.paint();
  }
}

async function rename() {
  if (!S.scene) return;
  const name = await askName({ title: 'Scene name', value: S.scene.name, okLabel: 'Rename', anchor: $('s3-name') });
  if (!name || !S.scene || name.trim() === S.scene.name) return;
  await saveNow();
  const r = await api('PATCH', '/api/3d/scenes/' + encodeURIComponent(S.scene.id), { name: name.trim() });
  if (!r.ok) { status(r.j.error || 'Not renamed.', true); return; }
  // Its folder moved with the name, and every address under it: the server's copy is the scene now.
  S.scene = r.j.scene;
  paintAll();
  status('renamed');
}

// ── Things in the scene ──────────────────────────────────────────────────
const newId = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);

function nextColor() {
  const used = new Set(S.scene.objects.map(o => o.color));
  return PALETTE.find(c => !used.has(c)) || PALETTE[S.scene.objects.length % PALETTE.length];
}

// A free spot on the floor near the middle: not on top of something already there.
function freeSpot() {
  const taken = S.scene.objects.filter(o => o.kind !== 'room').map(o => o.p);
  for (let ring = 0; ring < 12; ring++) {
    for (let k = 0; k < Math.max(1, ring * 6); k++) {
      const a = ring ? (k / (ring * 6)) * Math.PI * 2 : 0;
      const x = Math.round(Math.cos(a) * ring * 0.9 * 100) / 100, z = Math.round(Math.sin(a) * ring * 0.9 * 100) / 100;
      if (taken.every(p => Math.hypot(p[0] - x, p[2] - z) > 0.8)) return [x, 0, z];
    }
  }
  return [0, 0, 0];
}

function addObject(o) {
  const obj = Object.assign({ id: newId('o'), color: nextColor(), p: freeSpot(), r: [0, 0, 0], s: [1, 1, 1], ref: null, char: null }, o);
  change(sc => { sc.objects.push(obj); });
  select([obj.id]);
  return obj;
}

function removeSelected() {
  if (!S.sel.length) return;
  const ids = new Set(S.sel);
  const camsLeft = S.scene.cameras.filter(c => !ids.has(c.id));
  if (!camsLeft.length) ids.forEach(id => { if (S.scene.cameras.some(c => c.id === id)) ids.delete(id); });   // the last camera stays
  change(sc => {
    sc.objects = sc.objects.filter(o => !ids.has(o.id));
    sc.cameras = sc.cameras.filter(c => !ids.has(c.id));
  });
  select([]);
}

function select(ids) {
  S.sel = ids.slice();
  vp.select(S.sel);
  Left.paint();
  Right.paint();
}

// ── The keyboard ─────────────────────────────────────────────────────────
const _typing = (t) => t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
document.addEventListener('keydown', (e) => {
  if (Layers.blocked() || _typing(e.target) || !S.scene) return;
  const ctrl = e.ctrlKey || e.metaKey;
  if (ctrl && (e.code === 'KeyZ' || e.key === 'z' || e.key === 'Z')) { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
  if (ctrl && (e.code === 'KeyY' || e.key === 'y' || e.key === 'Y')) { e.preventDefault(); redo(); return; }
  if (ctrl) return;
  if (e.code === 'Delete' || e.code === 'Backspace') { e.preventDefault(); removeSelected(); return; }
  if (e.code === 'KeyW') { setMode('translate'); return; }
  if (e.code === 'KeyE') { setMode('rotate'); return; }
  if (e.code === 'KeyR') { setMode('scale'); return; }
  if (e.code === 'KeyF') { vp.frame(S.sel); return; }
  if (e.code === 'Escape' && S.sel.length) { select([]); }
});

// ── The field's own buttons ──────────────────────────────────────────────
function setMode(m) {
  vp.setMode(m);
  document.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('on', b.dataset.mode === m));
}
function wireTools() {
  document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => vp.setView(b.dataset.view)));
  document.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));
  const snap = $('s3-snap');
  snap.addEventListener('click', () => { vp.setSnap(!vp.snap()); snap.classList.toggle('on', vp.snap()); });
  const inp = $('s3-input');
  inp.addEventListener('click', () => vp.setInput(vp.input() === 'mouse' ? 'touchpad' : 'mouse'));
  $('s3-frame').addEventListener('click', () => vp.frame(S.sel));
  $('s3-scenes').addEventListener('click', () => openGallery(app));
  $('s3-name').addEventListener('click', rename);
}

// ── What the other parts of the page are given ───────────────────────────
const app = {
  get scene() { return S.scene; },
  get sel() { return S.sel; },
  get vp() { return vp; },
  change, select, addObject, removeSelected, openScene, newScene, forget, status, note, api, saveNow, nextColor,
  newId, cameraColor: () => CAMERA_COLORS[(S.scene ? S.scene.cameras.length : 0) % CAMERA_COLORS.length],
};

// The page's handle, for the console and for tests that drive it.
window.__s3d = app;

function boot() {
  vp = createViewport($('s3-view'), {
    onPick: (id, add) => {
      if (!id) { if (!add) select([]); return; }
      if (add) select(S.sel.includes(id) ? S.sel.filter(x => x !== id) : [...S.sel, id]);
      else select([id]);
    },
    onMoved: (ids) => change(sc => {
      for (const id of ids) {
        const t = vp.transformOf(id);
        if (!t) continue;
        const o = sc.objects.find(x => x.id === id) || sc.cameras.find(x => x.id === id);
        if (!o) continue;
        o.p = t.p; o.r = t.r;
        if (o.s) o.s = t.s;
      }
    }),
    onError: (o, err) => status('“' + (o.name || o.asset) + '” could not be drawn: ' + err.message, true),
    onView: (v) => document.querySelectorAll('[data-view]').forEach(b => b.classList.toggle('on', b.dataset.view === v)),
    onInput: (m) => { $('s3-input').textContent = m === 'touchpad' ? 'Touchpad' : 'Mouse'; },
  });
  $('s3-input').textContent = vp.input() === 'touchpad' ? 'Touchpad' : 'Mouse';
  Left.init(app, $('s3-left'));
  Right.init(app, $('s3-right'));
  initAdd(app, $('s3-add'));
  wireTools();
  setMode('translate');
  let open = '';
  try { open = sessionStorage.getItem(SS_OPEN) || ''; } catch (e) { /* a private window */ }
  if (open) openScene(open).then(ok => { if (!ok) openGallery(app); });
  else openGallery(app);
  // Leaving with a change not saved yet: it goes now.
  window.addEventListener('pagehide', () => {
    if (!S.scene || !S.pending) return;
    try {
      fetch('/api/3d/scenes/' + encodeURIComponent(S.scene.id), {
        method: 'PUT', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scene: S.scene, rev: S.scene.rev }),
      });
    } catch (e) { /* the page is going */ }
  });
}

boot();
