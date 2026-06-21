/* ═══════════════════════════════════════════════════════════════════════════
   pose-studio.js — standalone 3D "photo studio for blanks" (/studio).

   A grey procedural mannequin (capsules) you pose by clicking joints and
   rotating them (Toribash-style point posing, FK), frame with an orbit camera
   letterboxed to the generation aspect (9:16 by default), and render to a clean
   grey "blank" PNG that drops into the existing pose pipeline (pose-compose).

   v1: one mannequin, FK posing, presets, camera + scene controls, render+download.
   (Save-as-pose / Send-to-Character call a backend route — wired next.)
   ═══════════════════════════════════════════════════════════════════════════ */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const $ = (id) => document.getElementById(id);
const DEG = Math.PI / 180;
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

// ── Renderer / scene / cameras ───────────────────────────────────────────────
const canvas = $('ps-canvas');
const viewport = $('ps-viewport');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
let bgShade = 136;
scene.background = new THREE.Color(`rgb(${bgShade},${bgShade},${bgShade})`);

const camera = new THREE.PerspectiveCamera(40, 9 / 16, 0.05, 100);
camera.position.set(0, 1.0, 3.0);

const orbit = new OrbitControls(camera, renderer.domElement);
orbit.target.set(0, 0.95, 0);
orbit.enableDamping = true;
orbit.dampingFactor = 0.08;
orbit.update();

// ── Lights ───────────────────────────────────────────────────────────────────
const hemi = new THREE.HemisphereLight(0xffffff, 0x404048, 0.7);
scene.add(hemi);
const key = new THREE.DirectionalLight(0xffffff, 1.1);
key.position.set(2.5, 4, 3);
key.castShadow = true;
key.shadow.mapSize.set(1024, 1024);
key.shadow.camera.near = 0.5; key.shadow.camera.far = 20;
key.shadow.camera.left = -3; key.shadow.camera.right = 3;
key.shadow.camera.top = 3; key.shadow.camera.bottom = -3;
scene.add(key);
const fill = new THREE.DirectionalLight(0xffffff, 0.35);
fill.position.set(-3, 2, 1);
scene.add(fill);
let lightBase = { hemi: 0.7, key: 1.1, fill: 0.35 };

// ── Floor ────────────────────────────────────────────────────────────────────
const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(40, 40),
  new THREE.ShadowMaterial({ opacity: 0.28 })
);
floor.rotation.x = -Math.PI / 2;
floor.position.y = 0;
floor.receiveShadow = true;
scene.add(floor);

// ── Materials ────────────────────────────────────────────────────────────────
const bodyMat = new THREE.MeshStandardMaterial({ color: 0x9a9aa2, roughness: 0.85, metalness: 0.0 });
const propMat = new THREE.MeshStandardMaterial({ color: 0xb4b4ba, roughness: 0.9, metalness: 0.0 });   // props a touch lighter so they read as scenery
const handleMat = new THREE.MeshBasicMaterial({ color: 0x5b8cff });
const handleSelMat = new THREE.MeshBasicMaterial({ color: 0xffcc33 });

// Distinct flat colors for the layout map (each object/character a colour the
// generator can reference by name). Character defaults to grey (proven in the PoC).
const PALETTE = [
  { name: 'red', hex: 0xd83a3a }, { name: 'blue', hex: 0x2f6fe0 }, { name: 'green', hex: 0x2faf4f },
  { name: 'orange', hex: 0xe08a2f }, { name: 'purple', hex: 0x8a4fe0 }, { name: 'teal', hex: 0x2fb0b0 },
  { name: 'magenta', hex: 0xe02f9f }, { name: 'yellow', hex: 0xe0c52f }, { name: 'brown', hex: 0x9a6b3f },
  { name: 'cyan', hex: 0x35c7e0 },
];
let paletteIdx = 0;
function nextColor() { return PALETTE[paletteIdx++ % PALETTE.length]; }
function colorName(hex) { const f = PALETTE.find(p => p.hex === hex); return f ? f.name : 'grey'; }
function hexStr(hex) { return '#' + ('000000' + hex.toString(16)).slice(-6); }
const charColor = 0x8c8c92, charColorName = 'grey';
let charLabel = 'person';

// ── Mannequin rig (procedural capsules; joint.rotation == 0 is the T-pose) ────
// Each joint is a Group whose local frame is world-aligned at rest; the bone mesh
// is oriented inside it toward `dir`. Child joints attach at the bone tip. Posing
// rotates joint groups (FK).
const mannequin = new THREE.Group();
scene.add(mannequin);
const joints = {};          // name -> { joint, tip, handle, rest:Euler }
const handles = [];         // clickable spheres
const bodyMeshes = [];      // clickable capsules -> joint
const props = [];           // user-added cubes / walls (colored blocking boxes)
const models = [];          // TRELLIS-generated GLB object roots
const gltfLoader = new GLTFLoader();

function addHandle(joint, name, radius) {
  const h = new THREE.Mesh(new THREE.SphereGeometry(radius || 0.035, 12, 12), handleMat.clone());
  h.userData.jointName = name;
  h.renderOrder = 999;
  joint.add(h);
  handles.push(h);
  return h;
}

// makeBone: create a joint Group at `pos` (in parent-joint local space), with a
// capsule of `len` along `dir`. Returns { joint, tip } (tip = local attach point
// for children).
function makeBone(parentJoint, name, pos, dir, len, radius) {
  const joint = new THREE.Group();
  joint.name = name;
  joint.position.copy(pos);
  parentJoint.add(joint);
  const d = dir.clone().normalize();
  const seg = Math.max(0.01, len - 2 * radius);
  const cyl = new THREE.Mesh(new THREE.CapsuleGeometry(radius, seg, 6, 14), bodyMat);
  cyl.quaternion.copy(new THREE.Quaternion().setFromUnitVectors(V3(0, 1, 0), d));
  cyl.position.copy(d.clone().multiplyScalar(len / 2));
  cyl.castShadow = true;
  cyl.userData.jointName = name;
  joint.add(cyl);
  bodyMeshes.push(cyl);
  const handle = addHandle(joint, name);
  const rec = { joint, tip: d.clone().multiplyScalar(len), handle, rest: joint.rotation.clone() };
  joints[name] = rec;
  return rec;
}

function buildMannequin(p) {
  // p: proportion multipliers { h: height, b: build }
  const h = p.h, b = p.b;
  mannequin.clear();
  for (const k of Object.keys(joints)) delete joints[k];
  handles.length = 0; bodyMeshes.length = 0;

  const hipY = 0.92 * h;
  const pelvis = new THREE.Group();
  pelvis.name = 'root';
  pelvis.position.set(0, hipY, 0);
  mannequin.add(pelvis);
  // pelvis block
  const pelvisMesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.12 * b, 0.10, 6, 14), bodyMat);
  pelvisMesh.rotation.z = Math.PI / 2;
  pelvisMesh.castShadow = true;
  pelvisMesh.userData.jointName = 'root';
  pelvis.add(pelvisMesh);
  bodyMeshes.push(pelvisMesh);
  joints.root = { joint: pelvis, tip: V3(0, 0, 0), handle: addHandle(pelvis, 'root', 0.045), rest: pelvis.rotation.clone() };

  // spine -> chest -> neck -> head
  const spine = makeBone(pelvis, 'spine', V3(0, 0.08, 0), V3(0, 1, 0), 0.20 * h, 0.075 * b);
  const chest = makeBone(spine.joint, 'chest', spine.tip, V3(0, 1, 0), 0.20 * h, 0.085 * b);
  const neck = makeBone(chest.joint, 'neck', chest.tip, V3(0, 1, 0), 0.08 * h, 0.04 * b);
  // head as a sphere bone
  const head = makeBone(neck.joint, 'head', neck.tip, V3(0, 1, 0), 0.10 * h, 0.085 * b);

  // arms: attach near chest top, point outward (T-pose)
  const shTop = chest.tip.clone().add(V3(0, -0.02, 0));
  const armR = 0.05 * b, foreR = 0.045 * b;
  const shL = makeBone(chest.joint, 'shoulderL', shTop.clone().add(V3(0.17 * b, 0, 0)), V3(1, 0, 0), 0.27 * h, armR);
  const elL = makeBone(shL.joint, 'elbowL', shL.tip, V3(1, 0, 0), 0.25 * h, foreR);
  makeBone(elL.joint, 'wristL', elL.tip, V3(1, 0, 0), 0.10 * h, 0.04 * b);
  const shR = makeBone(chest.joint, 'shoulderR', shTop.clone().add(V3(-0.17 * b, 0, 0)), V3(-1, 0, 0), 0.27 * h, armR);
  const elR = makeBone(shR.joint, 'elbowR', shR.tip, V3(-1, 0, 0), 0.25 * h, foreR);
  makeBone(elR.joint, 'wristR', elR.tip, V3(-1, 0, 0), 0.10 * h, 0.04 * b);

  // legs: attach at pelvis bottom, point down
  const thR = 0.075 * b, shinR = 0.06 * b;
  const hipL = makeBone(pelvis, 'hipL', V3(0.10 * b, -0.06, 0), V3(0, -1, 0), 0.44 * h, thR);
  const knL = makeBone(hipL.joint, 'kneeL', hipL.tip, V3(0, -1, 0), 0.42 * h, shinR);
  makeBone(knL.joint, 'ankleL', knL.tip, V3(0, 0.15, 1), 0.20 * h, 0.05 * b);
  const hipR = makeBone(pelvis, 'hipR', V3(-0.10 * b, -0.06, 0), V3(0, -1, 0), 0.44 * h, thR);
  const knR = makeBone(hipR.joint, 'kneeR', hipR.tip, V3(0, -1, 0), 0.42 * h, shinR);
  makeBone(knR.joint, 'ankleR', knR.tip, V3(0, 0.15, 1), 0.20 * h, 0.05 * b);

  applyPose(POSES.relaxed);   // start in a natural stance, not stiff T
  selectJoint(null);
}

// ── Poses (degrees per joint; missing joints -> 0) ───────────────────────────
const POSES = {
  tpose: {},
  relaxed: { shoulderL: [0, 0, -72], elbowL: [0, 0, -12], shoulderR: [0, 0, 72], elbowR: [0, 0, 12],
             hipL: [4, 0, 2], hipR: [4, 0, -2] },
  contrapposto: { shoulderL: [0, 0, -70], elbowL: [10, 0, -18], shoulderR: [0, 0, 78], elbowR: [6, 0, 22],
                  root: [0, 6, 0], hipR: [-6, 0, -3], kneeR: [10, 0, 0], hipL: [8, 0, 4], chest: [0, -6, 0] },
  hands_hips: { shoulderL: [0, -12, -58], elbowL: [0, -105, 0], shoulderR: [0, 12, 58], elbowR: [0, 105, 0] },
  arms_crossed: { shoulderL: [8, -28, -66], elbowL: [0, -128, 0], shoulderR: [8, 28, 66], elbowR: [0, 128, 0] },
  presenting: { shoulderL: [0, -22, -52], elbowL: [0, -82, 0], shoulderR: [0, 22, 52], elbowR: [0, 82, 0] },
  lean: { root: [-8, 0, 0], chest: [-6, 0, 0], shoulderL: [0, 0, -68], shoulderR: [0, 0, 68],
          hipL: [10, 0, 2], hipR: [10, 0, -2] },
  pointing_fwd: { shoulderR: [0, 90, 6], elbowR: [0, 6, 0], shoulderL: [0, 0, -72], elbowL: [0, 0, -10] },
  waving: { shoulderR: [0, 12, -132], elbowR: [0, 40, 0], shoulderL: [0, 0, -72], elbowL: [0, 0, -10] },
  selfie: { shoulderR: [0, 52, -66], elbowR: [0, 86, 0], shoulderL: [0, 0, -70], elbowL: [0, -10, 0] },
  thinking: { shoulderR: [0, 30, 30], elbowR: [0, 120, 0], shoulderL: [0, -10, -64], elbowL: [0, -40, 0], chest: [0, 8, 0] },
  walking: { hipL: [-26, 0, 2], kneeL: [12, 0, 0], hipR: [18, 0, -2], kneeR: [30, 0, 0],
             shoulderL: [0, 16, -70], elbowL: [0, -22, 0], shoulderR: [0, -16, 72], elbowR: [0, 26, 0], chest: [2, 4, 0] },
  sitting: { hipL: [-92, 0, 4], kneeL: [96, 0, 0], hipR: [-92, 0, -4], kneeR: [96, 0, 0],
             shoulderL: [0, 0, -60], elbowL: [-50, 0, -10], shoulderR: [0, 0, 60], elbowR: [-50, 0, 10] },
  crouch: { hipL: [-92, 0, 5], kneeL: [120, 0, 0], hipR: [-92, 0, -5], kneeR: [120, 0, 0], chest: [14, 0, 0],
            shoulderL: [0, -18, -58], elbowL: [0, -58, 0], shoulderR: [0, 18, 58], elbowR: [0, 58, 0] },
  kneel: { hipL: [-104, 0, 4], kneeL: [122, 0, 0], hipR: [-16, 0, -4], kneeR: [96, 0, 0],
           shoulderL: [0, 0, -66], shoulderR: [0, 0, 66] },
};

function applyPose(pose) {
  for (const name of Object.keys(joints)) {
    if (name === 'root' && !(pose && pose.root)) continue;
    const r = (pose && pose[name]) || [0, 0, 0];
    joints[name].joint.rotation.set(r[0] * DEG, r[1] * DEG, r[2] * DEG);
  }
  syncJointFields();
}

// ── Selection + FK gizmo ─────────────────────────────────────────────────────
const transform = new TransformControls(camera, renderer.domElement);
transform.setMode('rotate');
transform.setSize(0.7);
transform.addEventListener('dragging-changed', (e) => { orbit.enabled = !e.value; });
transform.addEventListener('objectChange', syncJointFields);
scene.add(transform);

let selected = null;        // selected joint name (when kind==='joint')
let selectedProp = null;    // selected cube/wall mesh (when kind==='prop')
let selectedModel = null;   // selected TRELLIS object root (when kind==='model')
let selectedKind = null;    // 'joint' | 'prop' | 'model' | null
let propMode = 'translate'; // remembered gizmo mode for props/models

function selectJoint(name) {
  for (const h of handles) h.material = handleMat;
  selectedProp = null; selectedModel = null;
  var cs = $('ps-cube-sect'); if (cs) cs.style.display = 'none';
  if (!name || !joints[name]) {
    selected = null; selectedKind = null; transform.detach(); $('ps-joint-name').textContent = 'none';
    return;
  }
  selected = name; selectedKind = 'joint';
  const rec = joints[name];
  if (rec.handle) rec.handle.material = handleSelMat;
  transform.setMode('rotate');
  transform.attach(rec.joint);
  $('ps-joint-name').textContent = name;
  syncJointFields();
}

function selectProp(mesh) {
  for (const h of handles) h.material = handleMat;
  selected = null; selectedModel = null; selectedProp = mesh; selectedKind = 'prop';
  transform.setMode(propMode);
  transform.attach(mesh);
  $('ps-joint-name').textContent = 'cube';
  $('ps-cube-sect').style.display = '';
  $('ps-cube-label').value = mesh.userData.label || '';
  $('ps-cube-colorname').textContent = colorName(mesh.userData.layoutColor);
  $('ps-cube-swatch').style.background = hexStr(mesh.userData.layoutColor);
}

function syncJointFields() {
  if (!selected || !joints[selected]) return;
  const r = joints[selected].joint.rotation;
  $('ps-rotx').value = Math.round(r.x / DEG);
  $('ps-roty').value = Math.round(r.y / DEG);
  $('ps-rotz').value = Math.round(r.z / DEG);
}
function applyJointFields() {
  if (!selected || !joints[selected]) return;
  joints[selected].joint.rotation.set(
    (parseFloat($('ps-rotx').value) || 0) * DEG,
    (parseFloat($('ps-roty').value) || 0) * DEG,
    (parseFloat($('ps-rotz').value) || 0) * DEG
  );
}

// click-to-select (only in pose mode, only on a click that isn't an orbit drag)
let mode = 'pose';
const ray = new THREE.Raycaster();
let downXY = null;
renderer.domElement.addEventListener('pointerdown', (e) => { downXY = [e.clientX, e.clientY]; });
renderer.domElement.addEventListener('pointerup', (e) => {
  if (mode !== 'pose' || !downXY) return;
  const moved = Math.hypot(e.clientX - downXY[0], e.clientY - downXY[1]);
  downXY = null;
  if (moved > 5) return;                 // it was an orbit drag, not a pick
  if (transform.dragging) return;
  const rect = renderer.domElement.getBoundingClientRect();
  const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  const ny = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  ray.setFromCamera(new THREE.Vector2(nx, ny), camera);
  const handleHit = ray.intersectObjects(handles, false)[0];   // joint handles take priority (small, precise)
  if (handleHit && handleHit.object.userData.jointName) { selectJoint(handleHit.object.userData.jointName); return; }
  const modelMeshes = [];
  models.forEach(r => r.traverse(o => { if (o.isMesh) modelMeshes.push(o); }));
  const hit = ray.intersectObjects(props.concat(modelMeshes, bodyMeshes), true)[0];   // nearest cube/wall / 3D object / body part
  if (!hit) return;
  const o = hit.object;
  if (o.userData.isProp) selectProp(o);
  else if (o.userData.modelRoot) selectModel(o.userData.modelRoot);
  else if (o.userData.jointName) selectJoint(o.userData.jointName);
});

// ── Camera framing (viewport letterboxed to aspect) ──────────────────────────
let aspect = [9, 16];
function layoutViewport() {
  const pane = viewport.parentElement;
  const availW = pane.clientWidth - 24, availH = pane.clientHeight - 24;
  const [aw, ah] = aspect;
  let w = availW, h = w * ah / aw;
  if (h > availH) { h = availH; w = h * aw / ah; }
  viewport.style.width = Math.round(w) + 'px';
  viewport.style.height = Math.round(h) + 'px';
  renderer.setSize(Math.round(w), Math.round(h), false);
  camera.aspect = aw / ah;
  camera.updateProjectionMatrix();
}

function setAspect(str) {
  const m = String(str).split(':').map(Number);
  if (m.length === 2 && m[0] && m[1]) { aspect = m; $('ps-frame-label').textContent = str; layoutViewport(); }
}

function quickAngle(which) {
  const t = orbit.target.clone();
  const d = 3.0;
  if (which === 'front') camera.position.set(t.x, t.y + 0.05, t.z + d);
  else if (which === 'threeq') camera.position.set(t.x + d * 0.7, t.y + 0.1, t.z + d * 0.7);
  else if (which === 'side') camera.position.set(t.x + d, t.y + 0.05, t.z);
  else if (which === 'reset') { orbit.target.set(0, 0.95, 0); camera.position.set(0, 1.0, 3.0); }
  orbit.update();
}

// ── Render the blank to a PNG ────────────────────────────────────────────────
function renderBlank() {
  const short = parseInt($('ps-res').value, 10) || 1024;
  const [aw, ah] = aspect;
  let w, h;
  if (aw <= ah) { w = short; h = Math.round(short * ah / aw); }
  else { h = short; w = Math.round(short * aw / ah); }
  // hide editor-only objects
  const handlesVisible = handles.map(o => o.visible);
  handles.forEach(o => (o.visible = false));
  const gizmoVisible = transform.visible; transform.visible = false; transform.enabled = false;
  const dpr = renderer.getPixelRatio();
  renderer.setPixelRatio(1);
  renderer.setSize(w, h, false);
  camera.aspect = aw / ah; camera.updateProjectionMatrix();
  renderer.render(scene, camera);
  const url = renderer.domElement.toDataURL('image/png');
  // restore
  renderer.setPixelRatio(dpr);
  handles.forEach((o, i) => (o.visible = handlesVisible[i]));
  transform.visible = gizmoVisible; transform.enabled = true;
  layoutViewport();
  return url;
}

let lastBlank = null;
function doRender() {
  lastBlank = renderBlank();
  const out = $('ps-out'); out.src = lastBlank; out.style.display = 'block';
  status('Rendered. Download, or Save as pose (next).');
}

function status(m) { $('ps-status').textContent = m || ''; }

// ── Colored layout map + scene generation ────────────────────────────────────
// Renders a FLAT (unlit) colour map: each cube in its layout colour, the figure in
// the character colour, on a neutral background — the control image for generation.
function renderLayoutDataURL() {
  const short = parseInt($('ps-res').value, 10) || 1024;
  const [aw, ah] = aspect;
  let w, h; if (aw <= ah) { w = short; h = Math.round(short * ah / aw); } else { h = short; w = Math.round(short * aw / ah); }
  const saved = [];
  const flat = (mesh, hex) => { saved.push([mesh, mesh.material]); mesh.material = new THREE.MeshBasicMaterial({ color: hex }); };
  props.forEach(p => flat(p, p.userData.layoutColor));
  bodyMeshes.forEach(b => flat(b, charColor));
  const prevBg = scene.background; scene.background = new THREE.Color(0xcfcfd4);
  const floorVis = floor.visible; floor.visible = false;
  const handlesVis = handles.map(o => o.visible); handles.forEach(o => (o.visible = false));
  const giz = transform.visible; transform.visible = false; transform.enabled = false;
  const dpr = renderer.getPixelRatio(); renderer.setPixelRatio(1);
  renderer.setSize(w, h, false); camera.aspect = aw / ah; camera.updateProjectionMatrix();
  renderer.render(scene, camera);
  const url = renderer.domElement.toDataURL('image/jpeg', 0.92);
  saved.forEach(([m, mat]) => { try { m.material.dispose(); } catch (e) {} m.material = mat; });
  scene.background = prevBg; floor.visible = floorVis;
  handles.forEach((o, i) => (o.visible = handlesVis[i])); transform.visible = giz; transform.enabled = true;
  renderer.setPixelRatio(dpr); layoutViewport();
  return url;
}

function composeLegendPrompt() {
  const seen = new Set(); const objs = [];
  props.forEach(p => { const c = p.userData.layoutColor; if (seen.has(c)) return; seen.add(c); objs.push(`${colorName(c)} = ${(p.userData.label || 'object').trim()}`); });
  const legend = objs.concat([`${charColorName} figure = ${(charLabel || 'a person').trim()}, in the shown pose, looking at the camera`]);
  return 'Photorealistic vertical photo. The input is a COLORED LAYOUT MAP that defines placement, scale and perspective only — replace each colored region with the described subject in the SAME position and size, then render a single cohesive photorealistic scene. Legend: ' + legend.join('; ') +
    '. Keep the layout positions, scale and camera perspective. Natural cohesive lighting and shadows, realistic materials. Render exactly the subjects listed; do NOT show any colored blocks, outlines, labels, grids or text.';
}

function pollStatus(taskId) {
  return new Promise((resolve, reject) => {
    let n = 0;
    const iv = setInterval(async () => {
      if (++n > 60) { clearInterval(iv); return reject(new Error('timeout')); }
      try {
        const d = await (await fetch('/api/status/' + encodeURIComponent(taskId))).json();
        if (d.imagePath && d.state === 'success') { clearInterval(iv); resolve(d.imagePath); }
        else if (d.state === 'failed') { clearInterval(iv); reject(new Error(d.error || 'failed')); }
      } catch (e) { /* keep polling */ }
    }, 3500);
  });
}

async function generateFrame() {
  const url = renderLayoutDataURL();
  const prompt = composeLegendPrompt();
  const engine = $('ps-frame-engine').value;
  $('ps-genframe').disabled = true;
  status('Generating frame from the scene…');
  try {
    const r = await (await fetch('/api/studio/generate-frame', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageBase64: url, prompt, aspect: aspect.join(':'), imageEngine: engine }),
    })).json();
    if (!r.success || !r.taskId) throw new Error(r.error || 'no taskId');
    const imagePath = await pollStatus(r.taskId);
    const out = $('ps-out'); out.src = imagePath + '?t=' + Date.now(); out.style.display = 'block';
    lastBlank = imagePath;
    status('Frame generated.');
  } catch (e) { status('Generation failed: ' + (e.message || e)); }
  finally { $('ps-genframe').disabled = false; }
}

// ── Wire UI ──────────────────────────────────────────────────────────────────
function wire() {
  $('ps-mode-pose').addEventListener('click', () => setMode('pose'));
  $('ps-mode-orbit').addEventListener('click', () => setMode('orbit'));

  ['ps-rotx', 'ps-roty', 'ps-rotz'].forEach(id => $(id).addEventListener('input', applyJointFields));
  $('ps-joint-reset').addEventListener('click', () => { if (selected) { joints[selected].joint.rotation.set(0, 0, 0); syncJointFields(); } });
  $('ps-pose-reset').addEventListener('click', () => applyPose(POSES.tpose));
  $('ps-pose-mirror').addEventListener('click', mirrorPose);

  $('ps-apply-preset').addEventListener('click', () => applyPose(POSES[$('ps-preset').value] || {}));

  $('ps-add-cube').addEventListener('click', addCube);
  $('ps-add-wall').addEventListener('click', addWall);
  $('ps-add-corner').addEventListener('click', addCorner);
  $('ps-dup-cube').addEventListener('click', duplicateProp);
  $('ps-del-cube').addEventListener('click', deleteProp);
  $('ps-gen-obj').addEventListener('click', generateObject);
  $('ps-gizmo-move').addEventListener('click', () => setGizmoMode('translate'));
  $('ps-gizmo-rotate').addEventListener('click', () => setGizmoMode('rotate'));
  $('ps-gizmo-scale').addEventListener('click', () => setGizmoMode('scale'));

  $('ps-cube-label').addEventListener('input', () => { if (selectedKind === 'prop' && selectedProp) selectedProp.userData.label = $('ps-cube-label').value; });
  $('ps-char-label').addEventListener('input', () => { charLabel = $('ps-char-label').value; });
  $('ps-genframe').addEventListener('click', generateFrame);

  $('ps-aspect').addEventListener('change', (e) => setAspect(e.target.value));
  $('ps-fov').addEventListener('input', (e) => { camera.fov = parseFloat(e.target.value); camera.updateProjectionMatrix(); });
  document.querySelectorAll('[data-angle]').forEach(b => b.addEventListener('click', () => quickAngle(b.dataset.angle)));

  $('ps-bg').addEventListener('input', (e) => { bgShade = parseInt(e.target.value, 10); scene.background = new THREE.Color(`rgb(${bgShade},${bgShade},${bgShade})`); });
  $('ps-light').addEventListener('input', (e) => { const k = parseFloat(e.target.value); hemi.intensity = lightBase.hemi * k; key.intensity = lightBase.key * k; fill.intensity = lightBase.fill * k; });
  $('ps-toggle-floor').addEventListener('click', (e) => { floor.visible = !floor.visible; e.target.classList.toggle('on', floor.visible); });
  $('ps-toggle-shadow').addEventListener('click', (e) => { key.castShadow = !key.castShadow; e.target.classList.toggle('on', key.castShadow); });

  $('ps-prop-height').addEventListener('change', rebuild);
  $('ps-prop-build').addEventListener('change', rebuild);

  $('ps-render').addEventListener('click', doRender);
  $('ps-download').addEventListener('click', () => {
    if (!lastBlank) doRender();
    const a = document.createElement('a'); a.href = lastBlank; a.download = 'pose-blank.png'; a.click();
  });
  $('ps-save-pose').addEventListener('click', () => { if (!lastBlank) doRender(); status('Save-as-pose backend is wired next — for now use Download PNG.'); });
  $('ps-send').addEventListener('click', () => status('Send-to-Character is wired next — for now use Download PNG.'));
  $('ps-add-char').addEventListener('click', () => status('Multiple mannequins land in phase 2.'));
  $('ps-help').addEventListener('click', () => status('Pose mode: click a body part, drag the ring to rotate that joint. Orbit mode: drag to rotate the camera. Frame with Aspect/FOV/angles, then Render blank.'));
}

function setMode(m) {
  mode = m;
  $('ps-mode-pose').classList.toggle('on', m === 'pose');
  $('ps-mode-orbit').classList.toggle('on', m === 'orbit');
  transform.visible = (m === 'pose' && (!!selected || !!selectedProp || !!selectedModel));
  transform.enabled = (m === 'pose');
  handles.forEach(h => (h.visible = m === 'pose'));
}

function rebuild() {
  buildMannequin({ h: parseFloat($('ps-prop-height').value) || 1, b: parseFloat($('ps-prop-build').value) || 1 });
}

const MIRROR = { shoulderL: 'shoulderR', elbowL: 'elbowR', wristL: 'wristR', hipL: 'hipR', kneeL: 'kneeR', ankleL: 'ankleR' };
function mirrorPose() {
  // copy left -> right with X kept, Y/Z negated (rough mirror across the sagittal plane)
  for (const [l, r] of Object.entries(MIRROR)) {
    if (!joints[l] || !joints[r]) continue;
    const e = joints[l].joint.rotation;
    joints[r].joint.rotation.set(e.x, -e.y, -e.z);
  }
  syncJointFields();
}

// ── Props (grey cubes — build sofas/shelves for the blank) ───────────────────
let cubeN = 0;
function makeProp(geo, pos, label) {
  const col = nextColor();
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: col.hex, roughness: 0.9 }));
  m.castShadow = true; m.receiveShadow = true; m.position.copy(pos);
  m.userData.isProp = true; m.userData.layoutColor = col.hex; m.userData.label = label;
  m.name = 'prop' + (++cubeN);
  scene.add(m); props.push(m);
  return m;
}
function addCube() {
  const m = makeProp(new THREE.BoxGeometry(0.5, 0.5, 0.5), V3(0.7, 0.25, 0), 'object ' + cubeN);
  if (mode !== 'pose') setMode('pose');
  selectProp(m);
  status('Cube added — name it + Move/Rotate/Scale. Duplicate to extend the same object.');
}
function addWall() {
  const m = makeProp(new THREE.BoxGeometry(4, 2.6, 0.12), V3(0, 1.3, -1.3), 'back wall');
  if (mode !== 'pose') setMode('pose');
  selectProp(m);
  status('Wall added (back wall). Name it (brick / plaster / window wall) and position it.');
}
function addCorner() {
  makeProp(new THREE.BoxGeometry(4, 2.6, 0.12), V3(0, 1.3, -1.3), 'back wall');
  const side = makeProp(new THREE.BoxGeometry(0.12, 2.6, 3.4), V3(-2, 1.3, 0.4), 'side wall');
  if (mode !== 'pose') setMode('pose');
  selectProp(side);
  status('Corner added (2 walls). Name each wall and adjust.');
}
function duplicateProp() {
  if (selectedKind === 'model' && selectedModel) { const c = selectedModel.clone(); c.position.x += 0.4; scene.add(c); models.push(c); selectModel(c); return; }
  if (selectedKind !== 'prop' || !selectedProp) { status('Select a cube/wall first.'); return; }
  const c = selectedProp.clone();   // clone keeps the same colour + label (same object)
  c.position.x += 0.35; c.position.z += 0.2;
  c.name = 'prop' + (++cubeN);
  scene.add(c); props.push(c); selectProp(c);
}
function deleteProp() {
  if (selectedKind === 'model' && selectedModel) {
    transform.detach(); scene.remove(selectedModel);
    const j = models.indexOf(selectedModel); if (j >= 0) models.splice(j, 1);
    selectedModel = null; selectedKind = null; $('ps-joint-name').textContent = 'none'; return;
  }
  if (selectedKind !== 'prop' || !selectedProp) { status('Select a cube/wall first.'); return; }
  transform.detach();
  scene.remove(selectedProp);
  const i = props.indexOf(selectedProp); if (i >= 0) props.splice(i, 1);
  selectedProp = null; selectedKind = null; $('ps-joint-name').textContent = 'none';
  $('ps-cube-sect').style.display = 'none';
}
function setGizmoMode(m) {
  propMode = m;
  if (selectedKind === 'prop' || selectedKind === 'model') transform.setMode(m);
  $('ps-gizmo-move').classList.toggle('on', m === 'translate');
  $('ps-gizmo-rotate').classList.toggle('on', m === 'rotate');
  $('ps-gizmo-scale').classList.toggle('on', m === 'scale');
}

// ── TRELLIS 3D objects ───────────────────────────────────────────────────────
function selectModel(root) {
  for (const h of handles) h.material = handleMat;
  selected = null; selectedProp = null; selectedModel = root; selectedKind = 'model';
  var cs = $('ps-cube-sect'); if (cs) cs.style.display = 'none';
  transform.setMode(propMode); transform.attach(root);
  $('ps-joint-name').textContent = '3D object';
}
function normalizeModel(root) {
  let box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const maxd = Math.max(size.x, size.y, size.z) || 1;
  root.scale.setScalar(0.9 / maxd);
  box = new THREE.Box3().setFromObject(root);
  const c = box.getCenter(new THREE.Vector3());
  root.position.x += (0.7 - c.x);
  root.position.z += (0 - c.z);
  root.position.y += (0 - box.min.y);   // sit on the floor
}
function loadGlb(url) {
  return new Promise((resolve, reject) => {
    gltfLoader.load(url, (gltf) => {
      const root = gltf.scene;
      root.userData.isModel = true;
      root.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.userData.modelRoot = root; } });
      normalizeModel(root);
      scene.add(root); models.push(root);
      if (mode !== 'pose') setMode('pose');
      selectModel(root);
      resolve(root);
    }, undefined, reject);
  });
}
async function generateObject() {
  const desc = $('ps-obj-desc').value.trim();
  if (!desc) { $('ps-obj-status').textContent = 'Describe the object first.'; return; }
  $('ps-gen-obj').disabled = true;
  $('ps-obj-status').textContent = 'Generating image → 3D… (~40s)';
  try {
    const r = await (await fetch('/api/studio/gen-object', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ description: desc }) })).json();
    if (!r.success || !r.glbPath) throw new Error(r.error || 'failed');
    await loadGlb(r.glbPath);
    $('ps-obj-status').textContent = 'Added: ' + desc + '. Move / Rotate / Scale it.';
  } catch (e) { $('ps-obj-status').textContent = 'Failed: ' + (e.message || e); }
  finally { $('ps-gen-obj').disabled = false; }
}

// ── Loop ─────────────────────────────────────────────────────────────────────
function tick() {
  orbit.update();
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}

window.addEventListener('resize', layoutViewport);
buildMannequin({ h: 1, b: 1 });
wire();
$('ps-char-colorname').textContent = charColorName;
$('ps-char-swatch').style.background = hexStr(charColor);
charLabel = $('ps-char-label').value || 'person';
setAspect('9:16');
layoutViewport();
tick();
status('Ready. Click a body part to pose it, or add cubes for objects.');
