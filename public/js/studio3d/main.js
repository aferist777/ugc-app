/* ════════════════════════════════════════════════════════════════════════════
   3D STUDIO — the page.

   It holds the open scene and is the only one that changes it: every change goes through `change(fn)`, which keeps
   the scene as it was for Ctrl+Z, redraws what the change touched and saves a moment later. The server keeps the
   scene (routes/studio3d.js); a page that leaves takes nothing with it.

   A save carries the rev the copy was made from. Another window (or the server's own change) saving meanwhile turns
   it down with the scene as it is now - and the page takes that copy, says so, and goes on from it.

   The scene open in this session is remembered in sessionStorage (like Merge's project: this session only); with
   none, the studio opens on the gallery.
   ════════════════════════════════════════════════════════════════════════════ */

import * as Layers from '../layers.js';
import { askName } from '../name-box.js';
import { createViewport } from './viewport.js';
import { PALETTE, CAMERA_COLORS } from './catalog.js';
import * as Left from './left.js';
import * as Right from './right.js';
import { openGallery, closeGallery } from './gallery.js';
import { initAdd } from './add.js';
import { evaluate, putKey, roundT, sameTurn, MAX_LENGTH } from './evaluate.js';
import * as Timeline from './timeline.js';

const SS_OPEN = 's3d_open_v1';
const SS_FRAG = 's3d_frag_v1:';         // + scene id: the fragment open in that scene, this session
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
  frag: '',                             // the open fragment's id
  t: 0,                                 // the playhead, seconds into it
  playing: false, raf: 0, loop: true, last: 0,
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
  if (!frag() && S.scene.fragments.length) S.frag = S.scene.fragments[0].id;
  const f = frag();
  if (f && S.t > f.length) S.t = f.length;
  vp.syncObjects(S.scene.objects);
  vp.syncCameras(S.scene.cameras);
  applyPose();
  S.sel = S.sel.filter(id => S.scene.objects.some(o => o.id === id) || S.scene.cameras.some(c => c.id === id));
  vp.select(S.sel);
  Left.paint();
  Right.paint();
  Timeline.paint();
}

// ── Fragments and the playhead ───────────────────────────────────────────
function frag() { return S.scene ? S.scene.fragments.find(x => x.id === S.frag) || null : null; }
function applyPose() { vp.setPose(frag() ? evaluate(S.scene, frag(), S.t) : null); }

function setTime(t) {
  const f = frag();
  S.t = roundT(Math.max(0, Math.min(f ? f.length : 0, Number(t) || 0)));
  applyPose();
  Timeline.paintTime();
  if (!S.playing) Left.paint();          // the numbers follow the playhead - not sixty times a second while it plays
}

// The pose of a thing at the playhead (the left column's numbers for what moves).
function poseOf(id) { const f = frag(); return f && f.tracks[id] ? evaluate(S.scene, f, S.t).get(id) : null; }

// A number typed for a thing that moves in this fragment: a key at the playhead, the rest of the vector as it is now.
function keyValue(id, ch, i, value) {
  const f = frag();
  const q = poseOf(id);
  if (!f || !q) return false;
  change(sc => {
    const tr = sc.fragments.find(x => x.id === f.id).tracks[id];
    const v = q[ch].slice();
    v[i] = value;
    tr[ch] = putKey(tr[ch], S.t, v);
  });
  return true;
}

function _tick(now) {
  if (!S.playing) return;
  const f = frag();
  if (!f) { pause(); return; }
  const dt = S.last ? Math.min(0.1, (now - S.last) / 1000) : 0;
  S.last = now;
  let t = S.t + dt;
  if (t >= f.length) { if (S.loop) t = 0; else { setTime(f.length); pause(); return; } }
  setTime(t);
  S.raf = requestAnimationFrame(_tick);
}
function play() {
  const f = frag();
  if (!f || S.playing) return;
  if (S.t >= f.length - 1e-3) S.t = 0;
  S.playing = true;
  S.last = 0;
  S.raf = requestAnimationFrame(_tick);
  Timeline.paintTime();
}
function pause() {
  S.playing = false;
  cancelAnimationFrame(S.raf);
  Timeline.paintTime();
}

function openFragment(id) {
  if (!S.scene || !S.scene.fragments.some(x => x.id === id)) return;
  pause();
  S.frag = id;
  S.t = 0;
  try { sessionStorage.setItem(SS_FRAG + S.scene.id, id); } catch (e) { /* a private window */ }
  paintAll();
}

/**
 * A new fragment: from the shared arrangement, or from the end of another one - then everything that moves there
 * starts where it stood at that fragment's last moment (a copy, not a link).
 */
function addFragment(fromId) {
  if (!S.scene) return;
  const id = newId('f');
  change(sc => {
    const f = { id, name: 'Fragment ' + (sc.fragments.length + 1), length: 5, tracks: {} };
    const from = fromId && sc.fragments.find(x => x.id === fromId);
    if (from) {
      f.length = from.length;
      const end = evaluate(sc, from, from.length);
      for (const oid of Object.keys(from.tracks)) {
        const q = end.get(oid);
        if (!q) continue;
        f.tracks[oid] = { p: [{ t: 0, v: q.p, ease: 'smooth' }], r: [{ t: 0, v: q.r, ease: 'smooth' }], s: [{ t: 0, v: q.s, ease: 'smooth' }] };
      }
    }
    sc.fragments.push(f);
  });
  openFragment(id);
}
function removeFragment(id) {
  change(sc => { sc.fragments = sc.fragments.filter(x => x.id !== id); });
  if (S.frag === id) { S.frag = ''; S.t = 0; paintAll(); }
}
function setFragment(id, patch) {
  change(sc => {
    const f = sc.fragments.find(x => x.id === id);
    if (!f) return;
    if (patch.name != null) f.name = String(patch.name).slice(0, 60);
    if (patch.length != null) f.length = Math.max(0.5, Math.min(MAX_LENGTH, Math.round(Number(patch.length) * 100) / 100 || 5));
  });
}

// The "moves" box (left column): a track appears with a key at 0 where the thing stands in the arrangement, or goes
// with all its keys (Ctrl+Z brings it back).
function setMoves(id, on) {
  const f = frag();
  if (!f) return;
  change(sc => {
    const fr = sc.fragments.find(x => x.id === f.id);
    const o = sc.objects.find(x => x.id === id) || sc.cameras.find(x => x.id === id);
    if (!fr || !o) return;
    if (!on) { delete fr.tracks[id]; return; }
    if (fr.tracks[id]) return;
    fr.tracks[id] = { p: [{ t: 0, v: o.p.slice(), ease: 'smooth' }], r: [{ t: 0, v: o.r.slice(), ease: 'smooth' }] };
    if (o.s) fr.tracks[id].s = [{ t: 0, v: o.s.slice(), ease: 'smooth' }];
  });
}

// "Key" (K): what is selected and moves gets a key of where it stands now, on every channel, at the playhead.
function keyNow(ids) {
  const f = frag();
  if (!f) return;
  const pose = evaluate(S.scene, f, S.t);
  change(sc => {
    const fr = sc.fragments.find(x => x.id === f.id);
    for (const id of ids || S.sel) {
      const tr = fr && fr.tracks[id];
      const q = pose.get(id);
      if (!tr || !q) continue;
      tr.p = putKey(tr.p, S.t, q.p.slice());
      tr.r = putKey(tr.r, S.t, q.r.slice());
      if (sc.objects.some(o => o.id === id)) tr.s = putKey(tr.s, S.t, q.s.slice());
    }
  });
}

// An edit made of many small moves (a drag on the timeline) is ONE step: begin, change live, end.
function beginEdit() { return S.scene ? _snapshot() : null; }
function live() { applyPose(); Timeline.paint(); Left.paint(); }
function endEdit(before) {
  if (!S.scene || !before) return;
  if (JSON.stringify(before) === JSON.stringify(_snapshot())) { live(); return; }
  S.past.push(before);
  if (S.past.length > HISTORY) S.past.shift();
  S.future = [];
  paintAll();
  saveSoon();
}

function _snapshot() { return clone({ objects: S.scene.objects, cameras: S.scene.cameras, camera: S.scene.camera, fragments: S.scene.fragments }); }
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
  pause();
  S.scene = r.j.scene;
  S.sel = []; S.past = []; S.future = [];
  S.t = 0;
  S.frag = '';
  try { sessionStorage.setItem(SS_OPEN, S.scene.id); S.frag = sessionStorage.getItem(SS_FRAG + S.scene.id) || ''; } catch (e) { /* a private window */ }
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
  if (ctrl && e.code === 'KeyC' && Timeline.copy()) { e.preventDefault(); return; }
  if (ctrl && e.code === 'KeyV' && Timeline.paste()) { e.preventDefault(); return; }
  if (ctrl) return;
  if (e.code === 'Space') { e.preventDefault(); if (S.playing) pause(); else play(); return; }
  if (e.code === 'KeyK') { keyNow(); return; }
  if (e.code === 'Delete' || e.code === 'Backspace') { e.preventDefault(); if (!Timeline.deleteKeys()) removeSelected(); return; }
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
  const ghost = $('s3-ghost');
  ghost.addEventListener('click', () => { vp.setGhost(!vp.ghost()); ghost.classList.toggle('on', vp.ghost()); });
  $('s3-scenes').addEventListener('click', () => openGallery(app));
  $('s3-name').addEventListener('click', rename);
}

// ── What the other parts of the page are given ───────────────────────────
const app = {
  get scene() { return S.scene; },
  get sel() { return S.sel; },
  get vp() { return vp; },
  change, select, addObject, removeSelected, openScene, newScene, forget, status, note, api, saveNow, nextColor,
  frag, get t() { return S.t; }, get playing() { return S.playing; }, get loop() { return S.loop; }, set loop(v) { S.loop = !!v; },
  setTime, play, pause, openFragment, addFragment, removeFragment, setFragment, setMoves, keyNow, beginEdit, live, endEdit,
  poseOf, keyValue,
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
    onMoved: (ids) => {
      const f = frag();
      const pose = f ? evaluate(S.scene, f, S.t) : null;
      let shared = 0;
      change(sc => {
        const fr = f && sc.fragments.find(x => x.id === f.id);
        for (const id of ids) {
          const t = vp.transformOf(id);
          if (!t) continue;
          const o = sc.objects.find(x => x.id === id) || sc.cameras.find(x => x.id === id);
          if (!o) continue;
          const tr = fr && fr.tracks[id];
          if (tr) {
            // It moves in this fragment: a key under the playhead - the one there replaced, never doubled.
            const q = pose.get(id);
            const near = (a, b) => a && b && a.every((v, i) => Math.abs(v - b[i]) < 1e-4);
            if (!near(t.p, q.p)) tr.p = putKey(tr.p, S.t, t.p);
            if (!sameTurn(t.r, q.r)) tr.r = putKey(tr.r, S.t, t.r);   // -180 and 180 are one turn
            if (o.s && !near(t.s, q.s)) tr.s = putKey(tr.s, S.t, t.s);
          } else {
            o.p = t.p; o.r = t.r;
            if (o.s) o.s = t.s;
            shared++;
          }
        }
      });
      if (f && shared) note('Moved in the shared arrangement - it moves in every fragment. Tick "moves" to key it in this one.');
    },
    onError: (o, err) => status('“' + (o.name || o.asset) + '” could not be drawn: ' + err.message, true),
    onView: (v) => document.querySelectorAll('[data-view]').forEach(b => b.classList.toggle('on', b.dataset.view === v)),
    onInput: (m) => { $('s3-input').textContent = m === 'touchpad' ? 'Touchpad' : 'Mouse'; },
  });
  $('s3-input').textContent = vp.input() === 'touchpad' ? 'Touchpad' : 'Mouse';
  Left.init(app, $('s3-left'));
  Right.init(app, $('s3-right'));
  Timeline.init(app, $('s3-tl'));
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
