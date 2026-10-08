/* ════════════════════════════════════════════════════════════════════════════
   3D STUDIO — the field the scene is built in (PLAN "3D Studio", 3D1).

   One three.js scene, two kinds of eyes:
     the EDITOR's eye   orbits, pans and zooms - free (perspective), or straight from the top, the front or the side
                        (orthographic, where things can be lined up exactly). It sees layer 0 (the scene) and layer 1
                        (the grid, the selection boxes, the shot cameras' bodies and pyramids, the handles).
     the SHOT cameras   the scene's own cameras - what is recorded. They see layer 0 only, so nothing of the editor
                        ever lands in a preview or a recording.

   The scene is drawn when something changed (`invalidate`), not sixty times a second for nothing.

   Mouse or touchpad (PLAN "Ввод"): the wheel of a mouse and two fingers on a touchpad reach the page as the same
   event, so the person says which it is - or the first gesture guesses. Mouse: the left button turns the view, the
   right one moves it, the wheel zooms. Touchpad (as Blender): two fingers turn it, Shift + two fingers move it, a
   pinch zooms (Chromium hands a pinch over as a wheel with Ctrl).
   ════════════════════════════════════════════════════════════════════════════ */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { build, recolor } from './assets.js';

const EDITOR = 1;                       // the layer only the editor's eye sees
const LS_INPUT = 's3d_input_v1';        // 'mouse' | 'touchpad' - remembered on this computer
const FRAME_LONG_MM = 36;               // a focal length is read against 36 mm on the frame's LONG side (full-frame)

const rad = THREE.MathUtils.degToRad;
const deg = THREE.MathUtils.radToDeg;
const r4 = (v) => Math.round(v * 10000) / 10000;

export const ASPECT = { '9:16': 9 / 16, '16:9': 16 / 9, '1:1': 1 };

/** The vertical field of view of a shot camera of `focal` mm on a frame of `format`. */
export function fovOf(focal, format) {
  const a = ASPECT[format] || 9 / 16;
  const half = FRAME_LONG_MM / 2 / Math.max(1, focal);
  // portrait: the long side is the height; landscape: the width, and the height follows from the aspect
  const tanV = a <= 1 ? half : half / a;
  return deg(2 * Math.atan(tanV));
}

function _store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { /* a private window */ } return null; }

export function createViewport(host, hooks) {
  const H = hooks || {};
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: false });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setClearColor(0x1b1d24, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  host.appendChild(renderer.domElement);
  const dom = renderer.domElement;
  dom.tabIndex = 0;

  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8a8a, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.4);
  sun.position.set(3, 8, 5);
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0xffffff, 0.45);
  fill.position.set(-5, 4, -3);
  scene.add(fill);

  const grid = new THREE.GridHelper(40, 40, 0x4a4f60, 0x2c303b);
  grid.layers.set(EDITOR);
  scene.add(grid);

  // ── The editor's eyes ────────────────────────────────────────────────────
  const persp = new THREE.PerspectiveCamera(45, 1, 0.05, 500);
  persp.position.set(6, 5, 8);
  const ortho = new THREE.OrthographicCamera(-5, 5, 5, -5, -200, 200);
  for (const c of [persp, ortho]) { c.layers.enable(0); c.layers.enable(EDITOR); }
  let eye = persp;
  let view = 'free';
  const orbit = new OrbitControls(persp, dom);
  orbit.target.set(0, 0.8, 0);
  orbit.enableDamping = false;
  orbit.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
  orbit.update();
  let frozen = null;                    // the free view as it was, to come back to from top/front/side

  // ── The handles ──────────────────────────────────────────────────────────
  const gizmo = new TransformControls(eye, dom);
  gizmo.setSize(0.9);
  const gizmoHelper = gizmo.getHelper();
  gizmoHelper.traverse((n) => n.layers.set(EDITOR));
  // The handles live on the editor's layer, so the ray that finds them under the pointer must look there too
  // (by default a ray sees layer 0 only, and the handles could not be grabbed).
  gizmo.getRaycaster().layers.enableAll();
  scene.add(gizmoHelper);
  let snapping = false;

  // ── What is in the scene ─────────────────────────────────────────────────
  const objs = new Map();               // id -> { root, figure, obj, box }
  const cams = new Map();               // id -> { root, cam, helper, body, cfg }
  let selected = [];                    // ids, objects and cameras alike
  let dirty = true;
  const invalidate = () => { dirty = true; };

  orbit.addEventListener('change', invalidate);
  gizmo.addEventListener('change', invalidate);

  // ── Size ─────────────────────────────────────────────────────────────────
  function resize() {
    const w = Math.max(1, host.clientWidth), h = Math.max(1, host.clientHeight);
    renderer.setSize(w, h, false);
    dom.style.width = w + 'px';
    dom.style.height = h + 'px';
    persp.aspect = w / h;
    persp.updateProjectionMatrix();
    _orthoFrame();
    invalidate();
  }
  let orthoSize = 6;                    // half the height the orthographic view shows, in metres
  function _orthoFrame() {
    const w = Math.max(1, host.clientWidth), h = Math.max(1, host.clientHeight);
    const a = w / h;
    ortho.left = -orthoSize * a; ortho.right = orthoSize * a; ortho.top = orthoSize; ortho.bottom = -orthoSize;
    ortho.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(host);

  // ── Views ────────────────────────────────────────────────────────────────
  function setView(v) {
    if (v === view) return;
    if (view === 'free') frozen = { p: persp.position.clone(), t: orbit.target.clone() };
    view = v;
    const t = orbit.target.clone();
    if (v === 'free') {
      eye = persp;
      orbit.object = persp;
      orbit.enableRotate = true;
      if (frozen) { persp.position.copy(frozen.p); orbit.target.copy(frozen.t); }
    } else {
      eye = ortho;
      orbit.object = ortho;
      orbit.enableRotate = false;
      const dist = 50;
      const at = new THREE.Vector3(t.x, v === 'top' ? 0 : t.y, t.z);
      orbit.target.copy(at);
      ortho.up.set(0, v === 'top' ? 0 : 1, v === 'top' ? -1 : 0);
      if (v === 'top') ortho.position.set(at.x, dist, at.z);
      else if (v === 'front') ortho.position.set(at.x, at.y, at.z + dist);
      else ortho.position.set(at.x + dist, at.y, at.z);
      ortho.zoom = 1;
      _orthoFrame();
    }
    gizmo.camera = eye;
    orbit.update();
    invalidate();
    if (H.onView) H.onView(v);
  }

  // ── Mouse or touchpad ────────────────────────────────────────────────────
  // '' until the person says, or the first gesture tells - the mouse's way meanwhile.
  const stored = _store(LS_INPUT);
  let input = stored === 'touchpad' || stored === 'mouse' ? stored : '';
  function setInput(m) {
    input = m === 'touchpad' ? 'touchpad' : 'mouse';
    _store(LS_INPUT, input);
    orbit.enableZoom = input === 'mouse';
    if (H.onInput) H.onInput(input);
  }
  orbit.enableZoom = input !== 'touchpad';
  // A touchpad's wheel comes in small, uneven steps and sideways too; a mouse wheel in whole notches, up and down only.
  const _looksTouchpad = (e) => e.deltaMode === 0 && (e.deltaX !== 0 || Math.abs(e.deltaY) < 40 || !Number.isInteger(e.deltaY));

  function _turn(dx, dy) {
    const off = eye.position.clone().sub(orbit.target);
    const sph = new THREE.Spherical().setFromVector3(off);
    sph.theta -= dx;
    sph.phi = THREE.MathUtils.clamp(sph.phi - dy, 0.05, Math.PI - 0.05);
    off.setFromSpherical(sph);
    eye.position.copy(orbit.target).add(off);
    eye.lookAt(orbit.target);
  }
  function _pan(dx, dy) {
    const h = host.clientHeight || 1;
    const per = eye.isOrthographicCamera ? (ortho.top - ortho.bottom) / ortho.zoom / h
      : 2 * eye.position.distanceTo(orbit.target) * Math.tan(rad(persp.fov / 2)) / h;
    const right = new THREE.Vector3().setFromMatrixColumn(eye.matrix, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(eye.matrix, 1);
    const move = right.multiplyScalar(-dx * per).add(up.multiplyScalar(dy * per));
    eye.position.add(move);
    orbit.target.add(move);
  }
  function _zoom(f) {   // a pinch
    if (eye.isOrthographicCamera) { ortho.zoom = THREE.MathUtils.clamp(ortho.zoom * f, 0.05, 40); ortho.updateProjectionMatrix(); return; }
    const off = eye.position.clone().sub(orbit.target);
    const len = THREE.MathUtils.clamp(off.length() / f, 0.2, 200);
    eye.position.copy(orbit.target).add(off.setLength(len));
  }
  // Heard BEFORE OrbitControls (capture): with a touchpad its own wheel-zoom never sees the event.
  dom.addEventListener('wheel', (e) => {
    if (!input) setInput(_looksTouchpad(e) ? 'touchpad' : 'mouse');
    if (input === 'mouse') return;                          // OrbitControls zooms, in every view
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.ctrlKey) _zoom(Math.exp(-e.deltaY * 0.01));
    else if (e.shiftKey || eye.isOrthographicCamera) _pan(e.deltaX || (e.shiftKey ? e.deltaY : 0), e.shiftKey ? 0 : e.deltaY);
    else _turn(e.deltaX * 0.004, e.deltaY * 0.004);
    orbit.update();
    invalidate();
  }, { passive: false, capture: true });

  // ── Selecting ────────────────────────────────────────────────────────────
  const ray = new THREE.Raycaster();
  ray.layers.enableAll();
  let downAt = null;
  dom.addEventListener('pointerdown', (e) => { downAt = { x: e.clientX, y: e.clientY, b: e.button }; dom.focus({ preventScroll: true }); });
  dom.addEventListener('pointerup', (e) => {
    const d = downAt;
    downAt = null;
    if (!d || d.b !== 0 || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4 || gizmo.dragging || gizmo.axis) return;
    const r = dom.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), eye);
    const targets = [];
    for (const o of objs.values()) targets.push(o.root);
    for (const c of cams.values()) targets.push(c.body);
    const hits = ray.intersectObjects(targets, true);
    let id = null;
    for (const h of hits) {
      let n = h.object;
      while (n && !n.userData.pick) n = n.parent;
      if (!n) continue;
      // From outside a room, its far walls are what the ray meets first: a room is picked only where nothing else is.
      if (n.userData.room && hits.some(x => { let m = x.object; while (m && !m.userData.pick) m = m.parent; return m && !m.userData.room; })) continue;
      id = n.userData.pick;
      break;
    }
    if (H.onPick) H.onPick(id, e.shiftKey || e.ctrlKey);
  });

  // ── Moving what is selected ──────────────────────────────────────────────
  // One thing: the handles hold it. Several: they hold a pivot in the middle, and each moves by what the pivot did.
  const pivot = new THREE.Object3D();
  scene.add(pivot);
  let held = null;                      // { roots, start: [Matrix4], pivot0: Matrix4 }
  function _attach() {
    gizmo.detach();
    const roots = selected.map(_rootOf).filter(Boolean);
    if (!roots.length) { invalidate(); return; }
    if (roots.length === 1) { gizmo.attach(roots[0]); invalidate(); return; }
    const c = new THREE.Vector3();
    for (const r of roots) c.add(r.position);
    pivot.position.copy(c.multiplyScalar(1 / roots.length));
    pivot.rotation.set(0, 0, 0);
    pivot.scale.set(1, 1, 1);
    pivot.updateMatrixWorld(true);
    gizmo.attach(pivot);
    invalidate();
  }
  gizmo.addEventListener('dragging-changed', (e) => {
    orbit.enabled = !e.value;
    if (e.value) {
      const roots = selected.map(_rootOf).filter(Boolean);
      held = { roots, start: roots.map(r => r.matrix.clone()), pivot0: pivot.matrix.clone() };
    } else if (held) {
      const ids = selected.slice();
      held = null;
      if (H.onMoved) H.onMoved(ids);
    }
  });
  gizmo.addEventListener('objectChange', () => {
    if (!held || gizmo.object !== pivot) return;
    pivot.updateMatrix();
    const delta = pivot.matrix.clone().multiply(held.pivot0.clone().invert());
    held.roots.forEach((r, i) => {
      const m = delta.clone().multiply(held.start[i]);
      m.decompose(r.position, r.quaternion, r.scale);
    });
  });
  function setMode(m) { gizmo.setMode(m); invalidate(); }
  function setSnap(on) {
    snapping = !!on;
    gizmo.setTranslationSnap(snapping ? 0.1 : null);
    gizmo.setRotationSnap(snapping ? rad(15) : null);
    gizmo.setScaleSnap(snapping ? 0.1 : null);
  }

  // ── Objects ──────────────────────────────────────────────────────────────
  const _rootOf = (id) => (objs.get(id) || {}).root || (cams.get(id) || {}).root || null;
  function _place(root, o) {
    root.position.set(o.p[0], o.p[1], o.p[2]);
    root.rotation.set(rad(o.r[0]), rad(o.r[1]), rad(o.r[2]));
    root.scale.set(o.s ? o.s[0] : 1, o.s ? o.s[1] : 1, o.s ? o.s[2] : 1);
  }
  // Keeps the drawn scene equal to the scene's objects: new ones built, gone ones removed, changed ones redone.
  async function syncObjects(list) {
    const want = new Map(list.map(o => [o.id, o]));
    for (const [id, o] of objs) {
      if (!want.has(id)) { scene.remove(o.root); objs.delete(id); if (o.box) scene.remove(o.box); }
    }
    const jobs = [];
    for (const o of list) {
      const have = objs.get(o.id);
      const shape = o.kind === 'room' ? JSON.stringify(o.room) : o.asset;
      if (have && have.shape === shape) {
        if (have.obj.color !== o.color) recolor(have.figure, o.color);
        have.obj = o;
        _place(have.root, o);
        continue;
      }
      const root = have ? have.root : new THREE.Group();
      root.userData.pick = o.id;
      root.userData.room = o.kind === 'room';
      if (!have) { scene.add(root); objs.set(o.id, { root, figure: null, obj: o, shape: '', box: null }); }
      const rec = objs.get(o.id);
      rec.obj = o;
      rec.shape = shape;
      _place(root, o);
      jobs.push(build(o).then((fig) => {
        const cur = objs.get(o.id);
        if (!cur || cur.shape !== shape) return;          // changed again, or removed, while it loaded
        if (cur.figure) root.remove(cur.figure);
        cur.figure = fig;
        root.add(fig);
        invalidate();
        if (H.onBuilt) H.onBuilt(o.id);
      }).catch((err) => { if (H.onError) H.onError(o, err); }));
    }
    _boxes();
    invalidate();
    await Promise.all(jobs);
    _boxes();
  }

  // ── Shot cameras ─────────────────────────────────────────────────────────
  function _camBody(color) {
    const g = new THREE.Group();
    const m = new THREE.MeshBasicMaterial({ color });
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.12, 0.2), m);
    box.position.z = 0.1;
    const lens = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.12, 12), m);
    lens.rotation.x = -Math.PI / 2;               // its point forward, down the camera's -Z
    lens.position.z = -0.04;
    g.add(box, lens);
    g.traverse(n => n.layers.set(EDITOR));
    return g;
  }
  function syncCameras(list) {
    const want = new Set(list.map(c => c.id));
    for (const [id, c] of cams) if (!want.has(id)) { scene.remove(c.root); c.helper.dispose(); scene.remove(c.helper); cams.delete(id); }
    for (const cfg of list) {
      let c = cams.get(cfg.id);
      if (!c || c.cfg.color !== cfg.color) {
        if (c) { scene.remove(c.root); scene.remove(c.helper); c.helper.dispose(); }
        const root = new THREE.Group();
        root.userData.pick = cfg.id;
        const cam = new THREE.PerspectiveCamera(50, 9 / 16, 0.05, 200);
        cam.layers.set(0);
        const guide = new THREE.PerspectiveCamera(50, 9 / 16, 0.05, 1.6);   // the pyramid drawn, a short one
        const body = _camBody(cfg.color);
        body.userData.pick = cfg.id;
        root.add(cam, guide, body);
        const helper = new THREE.CameraHelper(guide);
        const col = new THREE.Color(cfg.color);
        helper.setColors(col, col, col, col, col);
        helper.layers.set(EDITOR);
        scene.add(root, helper);
        c = { root, cam, guide, helper, body, cfg };
        cams.set(cfg.id, c);
      }
      c.cfg = cfg;
      _place(c.root, { p: cfg.p, r: cfg.r });
      const aspect = ASPECT[cfg.format] || 9 / 16;
      for (const k of [c.cam, c.guide]) { k.fov = fovOf(cfg.focal, cfg.format); k.aspect = aspect; k.updateProjectionMatrix(); }
      c.root.updateMatrixWorld(true);
      c.helper.update();
    }
    _boxes();
    invalidate();
  }
  const shotCamera = (id) => (cams.get(id) || {}).cam || null;

  // ── Selection ────────────────────────────────────────────────────────────
  function _boxes() {
    for (const o of objs.values()) {
      const on = selected.includes(o.obj.id);
      if (on && !o.box) {
        o.box = new THREE.BoxHelper(o.root, new THREE.Color(o.obj.color).lerp(new THREE.Color(0xffffff), 0.35));
        o.box.layers.set(EDITOR);
        scene.add(o.box);
      } else if (!on && o.box) { scene.remove(o.box); o.box.geometry.dispose(); o.box = null; }
      if (o.box) o.box.update();
    }
  }
  function select(ids) {
    selected = (ids || []).filter(id => objs.has(id) || cams.has(id));
    _attach();
    _boxes();
  }

  // ── Looking at something ─────────────────────────────────────────────────
  function frame(ids) {
    const box = new THREE.Box3();
    for (const id of (ids && ids.length ? ids : [...objs.keys()])) { const r = _rootOf(id); if (r) box.expandByObject(r); }
    if (box.isEmpty()) return;
    const c = box.getCenter(new THREE.Vector3());
    const size = Math.max(1, box.getSize(new THREE.Vector3()).length());
    const dir = eye.position.clone().sub(orbit.target).normalize();
    orbit.target.copy(c);
    if (eye.isOrthographicCamera) { ortho.zoom = THREE.MathUtils.clamp((orthoSize * 2) / size, 0.05, 40); ortho.updateProjectionMatrix(); eye.position.copy(c).add(dir.multiplyScalar(50)); }
    else eye.position.copy(c).add(dir.multiplyScalar(size * 1.3));
    orbit.update();
    invalidate();
  }

  // ── Drawing ──────────────────────────────────────────────────────────────
  const tickers = new Set();            // other canvases that draw this scene (the camera preview) - told on every change
  function loop() {
    requestAnimationFrame(loop);
    if (!dirty) return;
    dirty = false;
    for (const o of objs.values()) if (o.box) o.box.update();
    for (const c of cams.values()) { c.root.updateMatrixWorld(true); c.helper.update(); }
    renderer.render(scene, eye);
    for (const f of tickers) f();
  }
  resize();
  requestAnimationFrame(loop);

  return {
    scene, renderer, invalidate, resize,
    syncObjects, syncCameras, shotCamera, select, frame,
    setView, view: () => view,
    setInput, input: () => input || 'mouse',
    setMode, mode: () => gizmo.mode, setSnap, snap: () => snapping,
    onDraw: (f) => tickers.add(f),
    // What the handles did to an object or a camera, read back in the scene's own terms.
    transformOf(id) {
      const root = _rootOf(id);
      if (!root) return null;
      const e = new THREE.Euler().setFromQuaternion(root.quaternion, 'XYZ');
      return { p: root.position.toArray().map(r4), r: [deg(e.x), deg(e.y), deg(e.z)].map(r4), s: root.scale.toArray().map(r4) };
    },
    dragging: () => gizmo.dragging,
    // Where a point of the scene is on the page, in client pixels (for marks drawn over the field, and for tests).
    toScreen(p) {
      const v = new THREE.Vector3(p[0], p[1], p[2]).project(eye);
      const r = dom.getBoundingClientRect();
      return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height };
    },
    dom,
  };
}
