'use strict';

/* studio3d-env.js - a scene from an environment of the Library (docs/local-app/PLAN.md "3D Studio", 3D9 - brought
   forward by the owner 2026-10-09: "при загрузке окружений из library сразу создавалась сцена с мебелью").

   Two agents, both Claude Opus 5.5 on kie (lib/kie-claude.js), both LOOKING at the picture:
     describe   only when the environment has no description yet: it writes one in the house style - the kind of
                place, its depth, where the windows and doors are, the large furniture and where each stands, the
                light, where a person can stand, the camera height - and it is KEPT in the Library, in the
                environment's entry of data/scen3-env-meta.json (lib/shelf-meta.js), where the Library shows it.
     layout     the room as a floor plan in metres: its size, its windows and doors, the LARGE furniture only (what a
                person stands beside, sits on or walks round - the small things, pictures, lamps and rugs Seedance
                draws by itself, the owner) as models of the studio's catalogue or plain blocks, and where the photo
                was taken from. It calls one tool, build_scene, whose input is checked and bounded here.
   The layout is kept beside the description (`layout3d`): the same environment never pays twice, an export carries
   it with the environment's group, a moved picture takes it along (relocate rewrites the store's keys), and a
   picture deleted off its shelf takes it with it. A layout is asked once at a time per environment - a second
   press waits for the first. */

const SHELF_META = require('./shelf-meta');
const { toDiskWithin } = require('./media');
const { MEDIA } = require('./config');
const CLAUDE = require('./kie-claude');
const { FURNITURE } = require('../public/js/studio3d/catalog.js');

const LAYOUT_V = 1;
const MAX_OBJECTS = 18;
const MAX_OPENINGS = 12;

// The owner's own example of a description (the palace living room of the Library, 2026-10-09) - the style asked for.
const EXAMPLE = 'This is the opulent, empty living room of a historic European royal palace, offering a grand backdrop for filming. '
  + 'The room is spacious, with significant depth from front to back. The floor is covered in intricate marquetry of dark '
  + 'polished walnut and lighter maple, largely overlaid by a vast, faded crimson and gold Persian rug in the central area. '
  + 'The walls feature dark oak wainscoting below a rich damask wallpaper in muted gold and cream. Tall, arched windows on '
  + 'the right, draped in creased cream silk, are the primary light source. On the far left, an antique dark wood console '
  + 'table is positioned under a large gilded mirror, with a sapphire blue velvet armchair nearby. The background is '
  + 'dominated by a carved white marble fireplace with an oil portrait above it. A low cherrywood coffee table sits '
  + 'centrally on the rug. The lighting is soft and warm, characteristic of late afternoon. A person can stand in several '
  + 'areas: in the central foreground with the coffee table and Persian rug behind them; to the left, backed by the blue '
  + 'armchair and console table; or to the right, in front of the window drapes. The camera height is set at eye-level for '
  + 'a standing adult, capturing the room\'s full grandeur.';

const DESCRIBE_SYSTEM = 'You describe empty locations for a video production team who will stage people in them. '
  + 'Write ONE paragraph in English, at most 1300 characters, in the style of the example: what kind of place it is and '
  + 'how deep it is; the floor and the walls; where the windows and doors are (left, right, far wall, behind the camera); '
  + 'every large piece of furniture and WHERE it stands (left, right, background, centre, foreground); the light; where a '
  + 'person can stand or sit; the camera height. Only what is visible - invent nothing. No list, no heading.\n\nThe example:\n'
  + EXAMPLE;

const _catalogLines = () => FURNITURE.map(g => g.group + ': ' + g.items.map(it => `${it.id} (${it.name}, ${it.h ? 'height ' + it.h : 'length ' + it.l} m)`).join('; ')).join('\n');
const _ids = new Set(FURNITURE.flatMap(g => g.items.map(it => it.id)));

const LAYOUT_SYSTEM = () => 'You turn a photograph of a room into a simple 3D blockout: a floor plan in metres that a '
  + 'video model will later dress from the photo itself. Look at the photo and the description, then call the tool '
  + 'build_scene ONCE.\n\n'
  + 'COORDINATES. The origin is the middle of the floor. +x is to the RIGHT as the photo is looked at, +z comes TOWARDS '
  + 'the camera. The back wall (the one the photo looks at) is at z = -depth/2, the front wall (behind the camera) at '
  + 'z = +depth/2, the left wall at x = -width/2, the right wall at x = +width/2. Heights are y, the floor is 0.\n'
  + 'ROOM. Estimate width, depth and height from things of known size: a door is 2.0-2.1 m high, a seat 0.45 m, a table '
  + '0.75 m, a person 1.7 m. When a side of the room is not visible, give it a plausible size.\n'
  + 'OPENINGS. Every window and door in the four walls: its wall, its centre measured along that wall (x for the back and '
  + 'front walls, z for the left and right walls), its width, its height and its sill (0 for a door).\n'
  + 'OBJECTS. ONLY the large, massive things that shape the space - what a person stands beside, sits on or walks round: '
  + 'sofas, armchairs, chairs, tables, desks, beds, cabinets, wardrobes, shelves, counters, kitchen units, fireplaces, '
  + 'bathtubs, big plants, columns, partitions, stairs. NEVER pictures, mirrors, chandeliers, lamps standing on furniture, '
  + 'rugs, curtains, books, vases or other small things - the video model draws those itself. At most ' + MAX_OBJECTS + '.\n'
  + 'For each: `model` is the id of the catalogue model that fits best, or "block" when none does (a fireplace, a wardrobe, '
  + 'a kitchen island, a column, a built-in) - a block needs its `size` in metres, a catalogue model has size null. `x` and '
  + '`z` are the middle of its footprint; `facing` is the direction its front faces in degrees: 0 = towards the camera (+z), '
  + '90 = to the right (+x), -90 = to the left, 180 = towards the back wall. A thing standing against a wall faces away '
  + 'from that wall; keep everything inside the walls and off the others.\n'
  + 'CAMERA. Where the photo was taken from: x, z, its height above the floor, its yaw in degrees (0 = looking straight at '
  + 'the back wall, positive = turned to the right), its pitch (0 = level, positive = looking up) and its focal length in '
  + 'mm as on a full-frame camera, 36 mm along the photo\'s long side (an interior photo is usually 16-28 mm).\n'
  + 'NOTES: one short sentence on what was hard to tell.\n\n'
  + 'THE CATALOGUE (id (name, its real height or length)):\n' + _catalogLines();

const TOOL = {
  name: 'build_scene',
  description: 'Lay out the room seen in the photo: its size, its windows and doors, its large furniture, and where the photo was taken from.',
  input_schema: {
    type: 'object', additionalProperties: false, required: ['room', 'openings', 'objects', 'camera', 'notes'],
    properties: {
      room: { type: 'object', additionalProperties: false, required: ['width', 'depth', 'height'],
        properties: { width: { type: 'number' }, depth: { type: 'number' }, height: { type: 'number' } } },
      openings: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['wall', 'kind', 'center', 'width', 'height', 'sill'],
        properties: { wall: { type: 'string', enum: ['back', 'left', 'right', 'front'] }, kind: { type: 'string', enum: ['window', 'door', 'opening'] },
          center: { type: 'number' }, width: { type: 'number' }, height: { type: 'number' }, sill: { type: 'number' } } } },
      objects: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['name', 'model', 'size', 'x', 'z', 'facing'],
        properties: { name: { type: 'string' }, model: { type: 'string' },
          size: { type: ['object', 'null'], additionalProperties: false, required: ['width', 'depth', 'height'],
            properties: { width: { type: 'number' }, depth: { type: 'number' }, height: { type: 'number' } } },
          x: { type: 'number' }, z: { type: 'number' }, facing: { type: 'number' } } } },
      camera: { type: 'object', additionalProperties: false, required: ['x', 'z', 'height', 'yaw', 'pitch', 'focal_mm'],
        properties: { x: { type: 'number' }, z: { type: 'number' }, height: { type: 'number' }, yaw: { type: 'number' }, pitch: { type: 'number' }, focal_mm: { type: 'number' } } },
      notes: { type: 'string' },
    },
  },
};

const num = (v, lo, hi, d) => { const x = Number(v); return isFinite(x) ? Math.round(Math.min(hi, Math.max(lo, x)) * 1000) / 1000 : d; };
const deg = (v) => { let a = Number(v) || 0; a = ((a + 180) % 360 + 360) % 360 - 180; return Math.round(a * 10) / 10; };

// What the tool said, made safe to build: every number bounded, every model known, everything inside the walls.
function _clean(inp) {
  const r = inp && inp.room || {};
  const room = { width: num(r.width, 1.5, 40, 5), depth: num(r.depth, 1.5, 40, 4), height: num(r.height, 2, 10, 2.8) };
  const hw = room.width / 2, hd = room.depth / 2;
  const openings = (Array.isArray(inp && inp.openings) ? inp.openings : []).slice(0, MAX_OPENINGS).map(o => {
    const wall = ['back', 'left', 'right', 'front'].includes(o && o.wall) ? o.wall : 'back';
    const along = wall === 'back' || wall === 'front' ? hw : hd;
    const kind = ['window', 'door', 'opening'].includes(o.kind) ? o.kind : 'window';
    const w = num(o.width, 0.3, along * 2 - 0.1, 1);
    const h = num(o.height, 0.3, room.height - 0.05, kind === 'window' ? 1.4 : 2.05);
    return { wall, kind, center: num(o.center, -along + w / 2, along - w / 2, 0), width: w, height: h,
      sill: kind === 'window' ? num(o.sill, 0, room.height - h, 0.9) : 0 };
  });
  const objects = (Array.isArray(inp && inp.objects) ? inp.objects : []).slice(0, MAX_OBJECTS).map(o => {
    const block = !_ids.has(String(o && o.model || ''));
    const s = (o && o.size) || {};
    return {
      name: String(o && o.name || (block ? 'block' : o.model)).slice(0, 60), model: block ? 'block' : String(o.model),
      size: block ? { width: num(s.width, 0.1, 12, 0.8), depth: num(s.depth, 0.1, 12, 0.6), height: num(s.height, 0.1, 6, 1) } : null,
      x: num(o.x, -hw + 0.1, hw - 0.1, 0), z: num(o.z, -hd + 0.1, hd - 0.1, 0), facing: deg(o.facing),
    };
  });
  const c = inp && inp.camera || {};
  const camera = { x: num(c.x, -hw, hw, 0), z: num(c.z, -hd, hd + 3, hd - 0.3), height: num(c.height, 0.2, room.height, 1.6),
    yaw: deg(c.yaw), pitch: num(c.pitch, -60, 60, 0), focal: num(c.focal_mm, 10, 85, 24) };
  return { room, openings, objects, camera, notes: String(inp && inp.notes || '').slice(0, 300) };
}

function _entry(url) { return SHELF_META.read('environments')[url] || {}; }
function _keep(url, patch) {
  const meta = SHELF_META.read('environments');
  meta[url] = Object.assign({}, meta[url] || {}, patch);
  SHELF_META.write('environments', meta);
  return meta[url];
}

function _picture(url) {
  const abs = toDiskWithin(url, [MEDIA.locations]);
  if (!abs) throw Object.assign(new Error('That is not a picture on the Environments shelf.'), { status: 400 });
  return abs;
}

/** The environment's description: the one the Library has, or one the agent writes and the Library keeps. */
async function describe(url, signal) {
  const have = String(_entry(url).description || '').trim();
  if (have) return { description: have, credits: 0, now: false };
  const img = await CLAUDE.imageBlock(_picture(url));
  const r = await CLAUDE.ask({ label: 'env describe', system: DESCRIBE_SYSTEM, maxTokens: 16000, signal,
    messages: [{ role: 'user', content: [img, { type: 'text', text: 'Describe this location.' }] }] });
  if (r.stop_reason === 'max_tokens') throw new Error('The description was cut off - try again.');
  const text = CLAUDE.textOf(r).replace(/\s+/g, ' ').trim().slice(0, 1600);
  if (text.length < 80) throw new Error('The agent did not describe this place.');
  // Written into the Library NOW, whatever happens to the layout after it.
  _keep(url, { description: text, descriptionFrom: 'studio3d', descriptionAt: new Date().toISOString() });
  return { description: text, credits: r.credits || 0, now: true };
}

const _running = new Map();       // url -> Promise: one asking at a time per environment

/**
 * The environment as a blockout: { layout, description, cached, described, credits }.
 * Kept in the environment's entry; `force` asks again.
 */
function layout(url, opts) {
  const key = String(url || '');
  const o = opts || {};
  if (!o.force) {
    const kept = _entry(key).layout3d;
    if (kept && kept.v === LAYOUT_V) return Promise.resolve({ layout: kept, description: String(_entry(key).description || ''), cached: true, described: false, credits: 0 });
  }
  if (_running.has(key)) return _running.get(key);
  const job = (async () => {
    _picture(key);
    const d = await describe(key);
    const img = await CLAUDE.imageBlock(_picture(key));
    const r = await CLAUDE.ask({ label: 'env layout', system: LAYOUT_SYSTEM(), tools: [TOOL], maxTokens: 64000,
      messages: [{ role: 'user', content: [img, { type: 'text', text: 'The description of this place:\n' + d.description + '\n\nCall build_scene.' }] }] });
    if (r.stop_reason === 'max_tokens') throw new Error('The agent\'s answer was cut off - try again.');
    const call = CLAUDE.toolOf(r, 'build_scene');
    if (!call || !call.input) throw new Error('The agent did not lay the room out' + (CLAUDE.textOf(r) ? ': ' + CLAUDE.textOf(r).slice(0, 160) : '.'));
    const lay = Object.assign({ v: LAYOUT_V, at: new Date().toISOString(), by: CLAUDE.MODEL }, _clean(call.input));
    _keep(key, { layout3d: lay });
    console.log(`[3d env] ${key.split('/').pop()}: room ${lay.room.width}x${lay.room.depth}x${lay.room.height}, ${lay.objects.length} objects, ${lay.openings.length} openings`);
    return { layout: lay, description: d.description, cached: false, described: d.now, credits: (d.credits || 0) + (r.credits || 0) };
  })();
  _running.set(key, job);
  job.then(() => _running.delete(key), () => _running.delete(key));
  return job;
}

module.exports = { layout, describe, LAYOUT_V, _clean };
