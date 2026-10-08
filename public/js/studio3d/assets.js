/* ════════════════════════════════════════════════════════════════════════════
   3D STUDIO — turning a scene's object into something three.js can draw (PLAN "3D Studio", 3D1).

   build(obj) answers a Group holding the object's figure, scaled and seated so that its own (0,0,0) is the middle
   of its footprint on the floor; the scene's position, rotation and scale are put on that Group by the viewport.
   Everything is CLAY: one flat colour per object - the colour that is its label in the recording and its track on
   the timeline - whatever colours the model came with.
   ════════════════════════════════════════════════════════════════════════════ */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { PEOPLE, MOTIONS, REST_MOTION, furnitureItem } from './catalog.js';

const _loader = new GLTFLoader();
const _files = new Map();          // url -> Promise<gltf>
const _load = (url) => {
  if (!_files.has(url)) _files.set(url, _loader.loadAsync(url).catch((e) => { _files.delete(url); throw e; }));
  return _files.get(url);
};

// Every motion, by name, from both libraries - one skeleton, so any of them plays on either figure.
let _motions = null;
export function motions() {
  if (!_motions) {
    _motions = Promise.all(MOTIONS.map(_load)).then((all) => {
      const m = new Map();
      for (const g of all) for (const c of g.animations) if (!m.has(c.name)) m.set(c.name, c);
      return m;
    }).catch((e) => { _motions = null; throw e; });
  }
  return _motions;
}

export function clay(color) {
  return new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: 0.88, metalness: 0 });
}

function _paint(root, color) {
  const mat = clay(color);
  root.traverse((n) => {
    if (n.isMesh) {
      n.material = mat;
      n.castShadow = false;
      n.receiveShadow = false;
    }
  });
  return mat;
}

// Seat a model: its footprint centred on (0,0,0), its lowest point on the floor, scaled uniformly so that
// `measure` - height h, or the longest side on the floor l - comes out as asked.
function _fit(inner, measure) {
  const wrap = new THREE.Group();
  wrap.add(inner);
  wrap.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(inner, true);
  const size = box.getSize(new THREE.Vector3());
  const k = measure.h ? measure.h / Math.max(size.y, 1e-6) : measure.l ? measure.l / Math.max(size.x, size.z, 1e-6) : 1;
  inner.scale.multiplyScalar(k);
  const c = box.getCenter(new THREE.Vector3());
  inner.position.set(-c.x * k, -box.min.y * k, -c.z * k);
  return wrap;
}

async function _person(gender, color) {
  const spec = PEOPLE[gender] || PEOPLE.male;
  const [g, clips] = await Promise.all([_load(spec.file), motions().catch(() => new Map())]);
  const model = SkeletonUtils.clone(g.scene);
  _paint(model, color);
  // It stands as a person does, not in the T of its bind pose: the first moment of the rest motion.
  const mixer = new THREE.AnimationMixer(model);
  const rest = clips.get(REST_MOTION);
  if (rest) {
    mixer.clipAction(rest).play();
    mixer.setTime(0);
  }
  const wrap = _fit(model, { h: spec.h });
  wrap.userData.mixer = mixer;
  return wrap;
}

async function _furniture(id, color) {
  const it = furnitureItem(id);
  if (!it) throw new Error('No such piece of furniture: ' + id);
  const g = await _load(it.file);
  const model = g.scene.clone(true);
  _paint(model, color);
  return _fit(model, it.h ? { h: it.h } : { l: it.l });
}

// A wall: a rectangle w x h with rectangular holes, its face towards local +Z.
function _wall(w, h, holes, mat) {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0); s.lineTo(w / 2, 0); s.lineTo(w / 2, h); s.lineTo(-w / 2, h); s.lineTo(-w / 2, 0);
  for (const o of holes) {
    const p = new THREE.Path();
    p.moveTo(o.x - o.w / 2, o.y); p.lineTo(o.x - o.w / 2, o.y + o.h); p.lineTo(o.x + o.w / 2, o.y + o.h); p.lineTo(o.x + o.w / 2, o.y); p.lineTo(o.x - o.w / 2, o.y);
    s.holes.push(p);
  }
  return new THREE.Mesh(new THREE.ShapeGeometry(s), mat);
}

/**
 * A room: a floor and four walls that face INWARD and are drawn from their inside only - from outside, the walls
 * nearest the eye vanish and the room stays open to look into, from inside it is closed. A window in the back
 * wall, a door in the right one. No ceiling (3D1).
 */
export function room(spec, color) {
  const { w, d, h } = spec;
  const g = new THREE.Group();
  const mat = clay(color);
  const floorMat = clay(new THREE.Color(color).multiplyScalar(0.82));
  floorMat.userData.shade = 0.82;           // the floor a little darker than the walls, so the corner reads
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, d), floorMat);
  floor.rotation.x = -Math.PI / 2;
  g.add(floor);
  const win = spec.window ? [{ x: 0, y: Math.min(0.9, h * 0.33), w: Math.min(1.6, w * 0.45), h: Math.min(1.3, h * 0.45) }] : [];
  const door = spec.door ? [{ x: Math.min(d / 2 - 0.7, d * 0.25), y: 0, w: 0.9, h: Math.min(2.05, h - 0.2) }] : [];
  const back = _wall(w, h, win, mat);
  back.position.set(0, 0, -d / 2);
  const front = _wall(w, h, [], mat);
  front.position.set(0, 0, d / 2);
  front.rotation.y = Math.PI;
  const left = _wall(d, h, [], mat);
  left.position.set(-w / 2, 0, 0);
  left.rotation.y = Math.PI / 2;
  const right = _wall(d, h, door, mat);
  right.position.set(w / 2, 0, 0);
  right.rotation.y = -Math.PI / 2;
  g.add(back, front, left, right);
  return g;
}

/** The figure of one scene object (a Group with the object's colour), or throws in words. */
export async function build(obj) {
  if (obj.kind === 'room') return room(obj.room || { w: 5, d: 4, h: 2.7, door: true, window: true }, obj.color);
  const a = String(obj.asset || '');
  if (a.startsWith('person:')) return _person(a.slice(7), obj.color);
  if (a.startsWith('kenney:')) return _furniture(a.slice(7), obj.color);
  throw new Error('Unknown model: ' + a);
}

/** Recolour a built figure in place. */
export function recolor(figure, color) {
  figure.traverse((n) => {
    if (n.isMesh && n.material && n.material.color) n.material.color.set(color).multiplyScalar(n.material.userData.shade || 1);
  });
}
