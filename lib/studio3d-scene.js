'use strict';

/* studio3d-scene.js - the shape of a 3D Studio scene (docs/local-app/PLAN.md "3D Studio - план по этапам").

   The page sends the whole scene on every save; what is stored is only what this file knows, every number
   bounded and every string cut, so a broken page cannot write a broken scene - or a huge one.

   A scene (v 1, stage 3D1):
     id, name, createdAt, updatedAt, rev     rev grows by one with every save; a save made from an older rev is refused
     source    null | { path, from }          the photo the scene was built from ('upload' | 'library'), its reference
     objects   [{ id, kind, name, color, asset, ref, char, p, r, s, room }]
               kind   'character' | 'prop' | 'room'
               asset  'person:male' | 'person:female' | 'kenney:<model>' | 'room'
               ref    null | { path, kind, id, name } - the picture it stands for (a look, a character, an environment,
                      an Images picture): its reference for Seedance
               char   null | { id, name, gender } - the Library character a mannequin is
               p r s  position (m), rotation (degrees, three.js XYZ order), scale - the scene's ONE arrangement
               room   { w, d, h, door, window } for a room
     cameras   [{ id, name, color, focal, format, p, r }]
     camera    the id of the active one
     fragments [] and cut [] - stages 3D2 and 3D7 */

const KINDS = ['character', 'prop', 'room'];
const REF_KINDS = ['look', 'character', 'environment', 'image', 'upload'];
const FORMATS = ['9:16', '16:9', '1:1'];
const MAX_OBJECTS = 400;
const MAX_CAMERAS = 16;

const str = (v, n) => String(v == null ? '' : v).slice(0, n);
const num = (v, lo, hi, d) => {
  const x = Number(v);
  if (!isFinite(x)) return d;
  return Math.round(Math.min(hi, Math.max(lo, x)) * 10000) / 10000;
};
const vec = (v, lo, hi, d) => [0, 1, 2].map(i => num(Array.isArray(v) ? v[i] : undefined, lo, hi, d[i]));
const colour = (v, d) => (/^#[0-9a-f]{6}$/i.test(String(v || '')) ? String(v).toLowerCase() : d);
const id = (v) => str(v, 40).replace(/[^A-Za-z0-9_-]/g, '');

function _ref(r) {
  if (!r || typeof r !== 'object' || !r.path) return null;
  return { path: str(r.path, 500), kind: REF_KINDS.includes(r.kind) ? r.kind : 'image', id: str(r.id, 80), name: str(r.name, 120) };
}

function _object(o) {
  if (!o || typeof o !== 'object' || !id(o.id)) return null;
  const kind = KINDS.includes(o.kind) ? o.kind : 'prop';
  const out = {
    id: id(o.id), kind, name: str(o.name, 80), color: colour(o.color, '#9a9a9a'), asset: str(o.asset, 80),
    ref: _ref(o.ref), char: null,
    p: vec(o.p, -1000, 1000, [0, 0, 0]), r: vec(o.r, -3600, 3600, [0, 0, 0]), s: vec(o.s, 0.01, 100, [1, 1, 1]),
  };
  if (kind === 'character' && o.char && typeof o.char === 'object') {
    out.char = { id: str(o.char.id, 80), name: str(o.char.name, 120), gender: ['male', 'female'].includes(o.char.gender) ? o.char.gender : '' };
  }
  if (kind === 'room') {
    const r = o.room || {};
    out.room = { w: num(r.w, 1, 60, 5), d: num(r.d, 1, 60, 4), h: num(r.h, 2, 12, 2.7), door: r.door !== false, window: r.window !== false };
  }
  return out;
}

function _camera(c) {
  if (!c || typeof c !== 'object' || !id(c.id)) return null;
  return {
    id: id(c.id), name: str(c.name, 40), color: colour(c.color, '#e8c35a'),
    focal: num(c.focal, 10, 300, 35), format: FORMATS.includes(c.format) ? c.format : '9:16',
    p: vec(c.p, -1000, 1000, [0, 1.6, 4]), r: vec(c.r, -3600, 3600, [0, 0, 0]),
  };
}

// What is stored of what the page sent; `keep` carries what only the server writes (id, dates, rev, source).
function normalize(scene, keep) {
  const s = scene && typeof scene === 'object' ? scene : {};
  const seen = new Set();
  const uniq = (x) => (x && !seen.has(x.id) ? (seen.add(x.id), x) : null);
  const objects = (Array.isArray(s.objects) ? s.objects : []).map(_object).map(uniq).filter(Boolean).slice(0, MAX_OBJECTS);
  const cameras = (Array.isArray(s.cameras) ? s.cameras : []).map(_camera).map(uniq).filter(Boolean).slice(0, MAX_CAMERAS);
  const camera = cameras.some(c => c.id === s.camera) ? s.camera : (cameras[0] ? cameras[0].id : '');
  return {
    v: 1, id: keep.id, name: str(keep.name, 120), createdAt: keep.createdAt, updatedAt: keep.updatedAt, rev: keep.rev,
    source: keep.source || null,
    objects, cameras, camera,
    fragments: [], cut: [],
  };
}

// A new scene: an empty floor and one camera at eye height, a few metres back, looking at the middle.
function fresh(keep) {
  return normalize({ cameras: [{ id: 'cam1', name: 'Camera 1', color: '#e8c35a', focal: 35, format: '9:16', p: [0, 1.6, 4.5], r: [-6, 0, 0] }] }, keep);
}

module.exports = { normalize, fresh, FORMATS, MAX_OBJECTS, MAX_CAMERAS };
