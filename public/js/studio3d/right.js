/* ════════════════════════════════════════════════════════════════════════════
   3D STUDIO — the right column: the shot camera (PLAN "3D Studio", 3D1).

   Its focal length (18-85 mm, read against 36 mm on the frame's long side), the frame's shape, and below them
   what the camera sees - drawn by a renderer of its own from the scene's layer 0 only, on the clay background the
   recording will have, with the thirds over it. It is drawn whenever the field is.
   (3D4 adds more cameras, their aim on a point of an object and where it stands in the frame, and following.)
   ════════════════════════════════════════════════════════════════════════════ */

import * as THREE from 'three';
import { ASPECT } from './viewport.js';

let A = null;
let host = null;
let pv = null;            // { renderer, canvas, frame, photo }
let overlay = false;      // the scene's photo over the preview, to see whether the blockout sits where the photo is
const CLAY_BG = 0xc4c4c4;
const FOCALS = [18, 24, 35, 50, 85];

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

export function init(app, node) {
  A = app;
  host = node;
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setClearColor(CLAY_BG, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  pv = { renderer, canvas: renderer.domElement, frame: null };
  A.vp.onDraw(draw);
  new ResizeObserver(() => { _size(); draw(); }).observe(host);
}

const _cam = () => (A.scene ? A.scene.cameras.find(c => c.id === A.scene.camera) || A.scene.cameras[0] : null);

export function paint() {
  if (!host) return;
  const c = _cam();
  if (!c) { host.textContent = ''; return; }
  if (!host.querySelector('.s3-cam') || host.dataset.cam !== c.id) _build(c);
  else _values(c);
  _size();
  draw();
}

function _build(c) {
  host.textContent = '';
  host.dataset.cam = c.id;
  const box = el('div', 's3-cam');
  const head = el('div', 's3-h');
  const dot = el('span', 's3-dot');
  dot.style.background = c.color;
  head.append(dot, document.createTextNode(' ' + (c.name || 'Camera')));
  box.appendChild(head);

  const fr = el('div', 's3-f');
  fr.appendChild(el('div', 's3-f-l', 'Focal length'));
  const focals = el('div', 's3-seg');
  for (const f of FOCALS) {
    const b = el('button', 's3-seg-b', f + '');
    b.type = 'button';
    b.dataset.focal = f;
    b.title = f + ' mm (full-frame)';
    b.addEventListener('click', () => _set(cfg => { cfg.focal = f; }));
    focals.appendChild(b);
  }
  fr.appendChild(focals);
  box.appendChild(fr);

  const fm = el('div', 's3-f');
  fm.appendChild(el('div', 's3-f-l', 'Frame'));
  const forms = el('div', 's3-seg');
  for (const f of Object.keys(ASPECT)) {
    const b = el('button', 's3-seg-b', f);
    b.type = 'button';
    b.dataset.format = f;
    b.addEventListener('click', () => _set(cfg => { cfg.format = f; }));
    forms.appendChild(b);
  }
  fm.appendChild(forms);
  box.appendChild(fm);

  const wrap = el('div', 's3-pv');
  const frame = el('div', 's3-pv-frame');
  frame.appendChild(pv.canvas);
  const photo = el('img', 's3-pv-photo');
  photo.alt = '';
  frame.appendChild(photo);
  const thirds = el('div', 's3-pv-thirds');
  frame.appendChild(thirds);
  pv.photo = photo;
  wrap.appendChild(frame);
  box.appendChild(wrap);
  pv.frame = frame;
  const ph = el('label', 's3-check s3-pv-ph');
  const cb = el('input');
  cb.type = 'checkbox';
  cb.checked = overlay;
  cb.addEventListener('change', () => { overlay = cb.checked; _values(_cam()); });
  ph.append(cb, document.createTextNode(' the photo over it'));
  ph.title = 'The picture the scene was laid out from, half-transparent over what the camera sees';
  box.appendChild(ph);
  box.appendChild(el('div', 's3-hint', 'What this camera sees. Select it in the scene (its gold body) to move or turn it with the handles.'));
  host.appendChild(box);
  _values(c);
}

function _values(c) {
  const src = A.scene && A.scene.source && A.scene.source.path;
  const ph = host.querySelector('.s3-pv-ph');
  if (ph) ph.hidden = !src;
  if (pv.photo) {
    const want = src && overlay ? '/api/thumb?src=' + encodeURIComponent(src) + '&v=main' : '';
    if (pv.photo.dataset.src !== want) { pv.photo.dataset.src = want; if (want) pv.photo.src = want; else pv.photo.removeAttribute('src'); }
    pv.photo.hidden = !want;
  }
  if (!c) return;
  host.querySelectorAll('[data-focal]').forEach(b => b.classList.toggle('on', Number(b.dataset.focal) === Number(c.focal)));
  host.querySelectorAll('[data-format]').forEach(b => b.classList.toggle('on', b.dataset.format === c.format));
}

function _set(fn) {
  const id = (_cam() || {}).id;
  if (!id) return;
  A.change(s => { const cfg = s.cameras.find(x => x.id === id); if (cfg) fn(cfg); });
}

// The preview as big as the column allows, in the frame's shape, never taller than half the window.
function _size() {
  const c = _cam();
  if (!c || !pv.frame) return;
  const a = ASPECT[c.format] || 9 / 16;
  const W = Math.max(60, host.clientWidth - 24);
  const maxH = Math.max(120, window.innerHeight * 0.55);
  let w = W, h = W / a;
  if (h > maxH) { h = maxH; w = h * a; }
  w = Math.round(w); h = Math.round(h);
  pv.frame.style.width = w + 'px';
  pv.frame.style.height = h + 'px';
  pv.renderer.setSize(w, h, false);
  pv.canvas.style.width = w + 'px';
  pv.canvas.style.height = h + 'px';
}

export function draw() {
  const c = _cam();
  if (!c || !pv || !pv.frame) return;
  const cam = A.vp.shotCamera(c.id);
  if (!cam) return;
  cam.updateMatrixWorld(true);
  pv.renderer.render(A.vp.scene, cam);
}

/** The gallery's picture of the scene: the active camera at 360 px wide (or tall), as a JPEG. */
export function snapshot() {
  const c = _cam();
  if (!c) return Promise.resolve(null);
  const cam = A.vp.shotCamera(c.id);
  if (!cam) return Promise.resolve(null);
  const a = ASPECT[c.format] || 9 / 16;
  const w = a <= 1 ? 360 : Math.round(360 * a), h = a <= 1 ? Math.round(360 / a) : 360;
  return new Promise((res) => grab(cam, w, h).toBlob(res, 'image/jpeg', 0.85));
}

/**
 * What `cam` sees at exactly w x h pixels, drawn off screen by the preview's renderer, on a 2D canvas.
 * (The recording, 3D6, draws its frames the same way.)
 */
export function grab(cam, w, h) {
  const r = pv.renderer;
  const rt = new THREE.WebGLRenderTarget(w, h, { samples: 4 });
  rt.texture.colorSpace = THREE.SRGBColorSpace;
  const aspect = cam.aspect;
  cam.aspect = w / h;
  cam.updateProjectionMatrix();
  r.setRenderTarget(rt);
  r.render(A.vp.scene, cam);
  const px = new Uint8Array(w * h * 4);
  r.readRenderTargetPixels(rt, 0, 0, w, h, px);
  r.setRenderTarget(null);
  rt.dispose();
  cam.aspect = aspect;
  cam.updateProjectionMatrix();
  // The rows come bottom first.
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(w, h);
  const row = w * 4;
  for (let y = 0; y < h; y++) img.data.set(px.subarray((h - 1 - y) * row, (h - y) * row), y * row);
  ctx.putImageData(img, 0, 0);
  return cv;
}
