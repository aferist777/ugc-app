'use strict';

/* studio3d-store.js - the 3D Studio's scenes.

   A scene is a project of kind '3d' in data/project-list.json, and its folder holds 3d/:
     projects/<name>/3d/scene.json      the scene (lib/studio3d-scene.js)
     projects/<name>/3d/thumbs/scene.jpg   what the gallery shows when the scene has no photo of its own
   So a scene is renamed and deleted the way every project is (lib/projects-store.js, lib/relocate.js), and its
   addresses follow a file that moves.

   ONE TICK. A save reads the scene, checks its rev and writes it with no await in between; `apply` does the same
   for the server's own changes (the agent) - the slow work first, then the change. */

const fs = require('fs');
const path = require('path');
const { PROJECTS_DIR } = require('./config');
const { writeFileAtomic } = require('./atomic-write');
const PROJECTS = require('./projects-store');
const SCENE = require('./studio3d-scene');

const SUB = '3d';
const FILE = 'scene.json';
const THUMB = 'thumbs/scene.jpg';

const _dir = (e) => path.join(PROJECTS_DIR, e.folder, SUB);
const _file = (e) => path.join(_dir(e), FILE);
const _entry = (id) => PROJECTS.entries().find((e) => e.kind === '3d' && e.id === String(id)) || null;
const _url = (e, rel) => `/projects/${e.folder}/${SUB}/${rel}`;

function _read(e) {
  try { return JSON.parse(fs.readFileSync(_file(e), 'utf8')); } catch (err) { return null; }
}
function _write(e, scene) {
  fs.mkdirSync(_dir(e), { recursive: true });
  writeFileAtomic(_file(e), JSON.stringify(scene, null, 2));
}
function _touchList(e, patch) {
  PROJECTS._writeList(PROJECTS.entries().map((x) => (x.id === e.id ? { ...x, ...patch } : x)));
}
const _newId = () => 's3d_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// What the gallery shows of one scene.
function _card(e, scene) {
  let thumb = '';
  try { thumb = fs.statSync(path.join(_dir(e), THUMB)).isFile() ? _url(e, THUMB) : ''; } catch (err) { /* none yet */ }
  const frags = Array.isArray(scene.fragments) ? scene.fragments : [];
  return {
    id: e.id, name: scene.name || e.name, folder: e.folder, createdAt: scene.createdAt || e.createdAt, updatedAt: scene.updatedAt || e.updatedAt,
    thumb, source: (scene.source && scene.source.path) || '',
    objects: (scene.objects || []).length, fragments: frags.length,
    length: Math.round(frags.reduce((n, f) => n + (Number(f && f.length) || 0), 0) * 100) / 100,
  };
}

// Every scene, the newest change first.
function list() {
  const out = [];
  for (const e of PROJECTS.entries()) {
    if (e.kind !== '3d') continue;
    const scene = _read(e);
    if (scene) out.push(_card(e, scene));
  }
  return out.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
}

function get(id) {
  const e = _entry(id);
  return e ? _read(e) : null;
}

function create(name) {
  const now = new Date().toISOString();
  const d = new Date(), two = (n) => String(n).padStart(2, '0');
  const title = String(name || '').trim().slice(0, 120)
    || `Scene ${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`;   // this computer's time
  const folder = PROJECTS._newFolder(title, 'scene');
  const e = { id: _newId(), name: title, folder, kind: '3d', createdAt: now, updatedAt: now };
  const scene = SCENE.fresh({ id: e.id, name: title, createdAt: now, updatedAt: now, rev: 1, source: null });
  _write(e, scene);
  PROJECTS._writeList([e, ...PROJECTS.entries()]);
  return scene;
}

/**
 * Save what the page sent. `rev` is the rev the page's copy was made from: an older one means somebody else
 * (another window, the agent) saved meanwhile - nothing is written and the scene as it is now comes back.
 * Returns { scene } or { conflict: scene } or null for no such scene.
 */
function save(id, sent, rev) {
  const e = _entry(id);
  if (!e) return null;
  const cur = _read(e);
  if (!cur) return null;
  if (Number(rev) !== Number(cur.rev)) return { conflict: cur };
  const now = new Date().toISOString();
  const scene = SCENE.normalize(sent, { id: cur.id, name: cur.name, createdAt: cur.createdAt, updatedAt: now, rev: (Number(cur.rev) || 0) + 1, source: cur.source });
  _write(e, scene);
  _touchList(e, { updatedAt: now });
  return { scene };
}

// The server's own change, in one tick: `fn(scene)` must not await.
function apply(id, fn) {
  const e = _entry(id);
  if (!e) return null;
  const cur = _read(e);
  if (!cur) return null;
  const out = fn(cur);
  if (out && typeof out.then === 'function') throw new Error('studio3d.apply(fn) must not await - do the slow work before the call');
  const now = new Date().toISOString();
  const scene = SCENE.normalize(cur, { id: cur.id, name: cur.name, createdAt: cur.createdAt, updatedAt: now, rev: (Number(cur.rev) || 0) + 1, source: cur.source });
  _write(e, scene);
  _touchList(e, { updatedAt: now });
  return scene;
}

// A new name: the folder follows it and every stored path under it is rewritten (lib/relocate.js reads 3d/*.json).
function rename(id, name) {
  const e = _entry(id);
  if (!e) return null;
  const title = String(name || '').trim().slice(0, 120);
  if (!title) return _read(e);
  PROJECTS._renameFolder(e, title);
  const scene = _read(e);
  if (!scene) return null;
  const now = new Date().toISOString();
  scene.name = title;
  scene.updatedAt = now;
  scene.rev = (Number(scene.rev) || 0) + 1;
  _write(e, scene);
  _touchList(e, { name: title, folder: e.folder, updatedAt: now });
  return scene;
}

// A copy under a new name: its own folder, its own id, the files copied and their addresses pointed at the copy.
function copy(id, name) {
  const e = _entry(id);
  if (!e) return null;
  const src = _read(e);
  if (!src) return null;
  const now = new Date().toISOString();
  const title = String(name || '').trim().slice(0, 120) || (src.name || e.name) + ' copy';
  const folder = PROJECTS._newFolder(title, 'scene');
  const c = { id: _newId(), name: title, folder, kind: '3d', createdAt: now, updatedAt: now };
  fs.cpSync(_dir(e), _dir(c), { recursive: true });
  const R = require('./relocate');
  const scene = R.rewriteValue(src, R.mapper([{ from: `/projects/${e.folder}/`, to: `/projects/${folder}/` }]));
  Object.assign(scene, { id: c.id, name: title, createdAt: now, updatedAt: now, rev: 1 });
  _write(c, scene);
  PROJECTS._writeList([c, ...PROJECTS.entries()]);
  return scene;
}

// Deleting is deleting the project: what something else still points at moves to media/work first.
function remove(id) {
  const e = _entry(id);
  if (!e) return null;
  return PROJECTS.remove(e.id);
}

// The picture the gallery shows: a JPEG the page drew from the active camera.
function thumb(id, buf) {
  const e = _entry(id);
  if (!e) return null;
  const abs = path.join(_dir(e), THUMB);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, buf);
  return _url(e, THUMB) + '?v=' + Date.now();
}

// At start: a folder holding 3d/scene.json that the project list does not know - a scene carried over from
// another library - joins the list.
function sync() {
  const entries = PROJECTS.entries();
  const known = new Set(entries.map((e) => e.folder.toLowerCase()));
  const ids = new Set(entries.map((e) => e.id));
  let dirs = [];
  try { dirs = fs.readdirSync(PROJECTS_DIR, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch (err) { /* none */ }
  const add = [];
  for (const d of dirs) {
    if (known.has(d.toLowerCase())) continue;
    let scene;
    try { scene = JSON.parse(fs.readFileSync(path.join(PROJECTS_DIR, d, SUB, FILE), 'utf8')); } catch (err) { continue; }
    let sid = String((scene && scene.id) || '');
    if (!sid || ids.has(sid)) {
      sid = _newId();
      scene.id = sid;
      writeFileAtomic(path.join(PROJECTS_DIR, d, SUB, FILE), JSON.stringify(scene, null, 2));
    }
    ids.add(sid);
    add.push({ id: sid, name: String(scene.name || d), folder: d, kind: '3d', createdAt: scene.createdAt || null, updatedAt: scene.updatedAt || null });
  }
  if (add.length) PROJECTS._writeList([...add, ...entries]);
  return { added: add.length };
}

module.exports = { list, get, create, save, apply, rename, copy, remove, thumb, sync, SUB };
