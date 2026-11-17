'use strict';

/* studio3d-scene.js - the shape of a 3D Studio scene.

   The page sends the whole scene on every save; what is stored is only what this file knows, every number
   bounded and every string cut, so a broken page cannot write a broken scene - or a huge one.

   A scene (v 1):
     id, name, createdAt, updatedAt, rev     rev grows by one with every save; a save made from an older rev is refused
     source    null | { path, from }          the photo the scene was built from ('upload' | 'library'), its reference
     objects   [{ id, kind, name, color, asset, ref, char, p, r, s, room }]
               kind   'character' | 'prop' | 'room'
               asset  'person:male' | 'person:female' | 'kenney:<model>' | 'block' | 'room'
               box    [w, h, d] - a block's size in metres (a fireplace, a wardrobe: what the catalogue has not)
               env    the environment (its address) the object was laid out from - a new environment replaces them
               ref    null | { path, kind, id, name } - the picture it stands for (a look, a character, an environment,
                      an Images picture): its reference for Seedance
               char   null | { id, name, gender } - the Library character a mannequin is
               p r s  position (m), rotation (degrees, three.js XYZ order), scale - the scene's ONE arrangement
               room   { w, d, h, door, window, openings } for a room - openings [{ wall, kind, center, width, height,
                      sill }] (walls back/left/right/front, centre along the wall) replace the one door and one window
     cameras   [{ id, name, color, focal, format, p, r }]
     camera    the id of the active one
     fragments [{ id, name, length, tracks }] - their keys read by public/js/studio3d/evaluate.js
     cut []    not used yet - always stored empty */

const KINDS = ['character', 'prop', 'room'];
const WALLS = ['back', 'left', 'right', 'front'];
const OPENINGS = ['window', 'door', 'opening'];
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

// The photo a scene was built from: a picture of the library (an environment's; nothing uploads a photo of its own yet).
function _source(v) {
  if (!v || typeof v !== 'object' || !/^\/(media|projects)\//.test(String(v.path || ''))) return null;
  return { path: str(v.path, 500), from: ['library', 'upload'].includes(v.from) ? v.from : 'library' };
}

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
  if (o.asset === 'block') out.box = vec(o.box, 0.05, 20, [0.8, 1, 0.6]);
  if (o.env) out.env = str(o.env, 500);
  if (kind === 'character' && o.char && typeof o.char === 'object') {
    out.char = { id: str(o.char.id, 80), name: str(o.char.name, 120), gender: ['male', 'female'].includes(o.char.gender) ? o.char.gender : '' };
  }
  if (kind === 'room') {
    const r = o.room || {};
    out.room = { w: num(r.w, 1, 60, 5), d: num(r.d, 1, 60, 4), h: num(r.h, 2, 12, 2.7), door: r.door !== false, window: r.window !== false };
    if (Array.isArray(r.openings)) {
      out.room.openings = r.openings.slice(0, 16).filter(x => x && typeof x === 'object').map(x => ({
        wall: WALLS.includes(x.wall) ? x.wall : 'back', kind: OPENINGS.includes(x.kind) ? x.kind : 'window',
        center: num(x.center, -30, 30, 0), width: num(x.width, 0.2, 60, 1), height: num(x.height, 0.2, 12, 1.4), sill: num(x.sill, 0, 12, 0),
      }));
    }
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

// ── Fragments ───────────────────────────────────────────────────────────────
// A fragment: { id, name, length (s, at most 30), tracks: { <object or camera id>: { p, r, s, v } } }, each channel a
// list of keys { t, v, ease } sorted by time (public/js/studio3d/evaluate.js reads them). A track of something no
// longer in the scene goes with it.
const MAX_FRAGMENTS = 50;
const MAX_KEYS = 1000;            // per channel
const EASES = ['linear', 'smooth', 'abrupt', 'gentle', 'hold'];
const CH = { p: [-1000, 1000], r: [-36000, 36000], s: [0.01, 100] };

function _ease(e) {
  if (EASES.includes(e)) return e;
  if (Array.isArray(e) && e.length === 4) return e.map(n => num(n, -2, 3, 0));
  return 'smooth';
}
function _keys(list, ch, length) {
  if (!Array.isArray(list)) return null;
  const out = [];
  for (const k of list.slice(0, MAX_KEYS)) {
    if (!k || typeof k !== 'object') continue;
    const t = num(k.t, 0, length, 0);
    const v = ch === 'v' ? (k.v ? 1 : 0) : vec(k.v, CH[ch][0], CH[ch][1], ch === 's' ? [1, 1, 1] : [0, 0, 0]);
    out.push({ t, v, ease: _ease(k.ease) });
  }
  out.sort((a, b) => a.t - b.t);
  return out.length ? out : null;
}
function _fragments(list, ids) {
  const seen = new Set();
  const out = [];
  for (const f of (Array.isArray(list) ? list : []).slice(0, MAX_FRAGMENTS)) {
    if (!f || typeof f !== 'object' || !id(f.id) || seen.has(id(f.id))) continue;
    seen.add(id(f.id));
    const length = num(f.length, 0.5, 30, 5);
    const tracks = {};
    for (const [oid, tr] of Object.entries(f.tracks && typeof f.tracks === 'object' ? f.tracks : {})) {
      if (!ids.has(oid) || !tr || typeof tr !== 'object') continue;
      const t = {};
      for (const ch of ['p', 'r', 's', 'v']) { const k = _keys(tr[ch], ch, length); if (k) t[ch] = k; }
      tracks[oid] = t;                        // an empty track still says "it moves here"
    }
    out.push({ id: id(f.id), name: str(f.name, 60), length, tracks });
  }
  return out;
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
    source: _source(s.source) || keep.source || null,
    objects, cameras, camera,
    fragments: _fragments(s.fragments, new Set([...objects, ...cameras].map(x => x.id))), cut: [],
  };
}

// A new scene: an empty floor and one camera at eye height, a few metres back, looking at the middle.
function fresh(keep) {
  return normalize({ cameras: [{ id: 'cam1', name: 'Camera 1', color: '#e8c35a', focal: 35, format: '9:16', p: [0, 1.6, 4.5], r: [-6, 0, 0] }] }, keep);
}

module.exports = { normalize, fresh, FORMATS, MAX_OBJECTS, MAX_CAMERAS };
