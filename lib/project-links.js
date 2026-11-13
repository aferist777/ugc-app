'use strict';

// ════════════════════════════════════════════════════════════════════════════
// THIS PROJECT - a project's own folders of LINKS to the library's media (phase V78, part B, the owner 2026-11-07,
// docs/local-app/plan/ "Фаза V78", (лч10)-(лч17)).
//
// In Merge's media tree, above REFERENCES, THIS PROJECT holds folders the person makes for the open project, and in them
// LINKS: the file stays where it lies in REFERENCES / IMAGES / VIDEO / AUDIO - nothing is copied or moved; one thing may lie
// in several folders and in several projects. A project of every kind has its own; a highlights fragment's are its home's.
//
//   projects/<folder>/links.json  { folders: [{ id, name, parent }], links: [{ id, folder, kind, item, media, at }] }
//
// The file lives in the project's folder, so it goes with the project: a rename or a draft saved under a name moves the
// folder, a project deleted takes it away. lib/relocate.js rewrites its addresses when a file changes place, as every
// project file's. A link is found by its kind and record id, else by its file's address (a clip given another kind keeps
// its address); one found by neither - its file deleted from the library - is dropped when the folder is read ((лч14)).
// Every change is read, changed and written in one tick, atomically.
// ════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { PROJECTS_DIR } = require('./config');
const { writeFileAtomic } = require('./atomic-write');

const FILE = 'links.json';
const NAME_MAX = 60;
const PATH_MAX = 100;            // a folder's whole path in words, as the library's (lib/library-cats.js PATH_MAX)

/** A highlights fragment's timeline talks for its home (hl_<id>_<n> -> hl_<id>), as its chats do. */
const homeKey = require('../public/js/highlights/keys.js').homeOf;

// (phase V78, the owner 2026-11-07: "в draft проектах не отображать папку this project") A DRAFT has no THIS PROJECT - Merge's draft
// (its timeline's `draft`) and the voiceover draft (its scenarios project's `draft`): the tree is drawn without it and nothing is
// put into one. Saved under a name, the project has it.
function isDraft(key) {
  const k = homeKey(key);
  if (!k) return false;
  try { const t = require('./merge-store').one(k); if (t && t.draft) return true; } catch (e) { /* not read: not a draft */ }
  const m = /^sv3_(\d+)$/.exec(k);
  if (m) { try { const pr = require('./projects-store').get(m[1]); if (pr && pr.draft) return true; } catch (e) { /* none */ } }
  return false;
}

function fileOf(key) {
  const k = homeKey(key);
  if (!k) return null;
  const loc = require('./merge-store').locate(k);
  return loc && loc.folder ? path.join(PROJECTS_DIR, loc.folder, FILE) : null;
}

const _empty = () => ({ folders: [], links: [] });
function _norm(d) {
  const out = _empty();
  if (!d || typeof d !== 'object') return out;
  for (const f of Array.isArray(d.folders) ? d.folders : []) {
    if (!f || !f.id || !String(f.name || '').trim()) continue;
    out.folders.push({ id: String(f.id), name: String(f.name).trim().slice(0, NAME_MAX), parent: String(f.parent || '') });
  }
  const ids = new Set(out.folders.map(f => f.id));
  for (const f of out.folders) if (f.parent && !ids.has(f.parent)) f.parent = '';
  for (const l of Array.isArray(d.links) ? d.links : []) {
    if (!l || !l.id || !l.kind || !(l.item || l.media)) continue;
    out.links.push({ id: String(l.id), folder: ids.has(String(l.folder || '')) ? String(l.folder) : '', kind: String(l.kind),
      item: String(l.item || ''), media: String(l.media || ''), at: String(l.at || '') });
  }
  return out;
}

/** What the project holds - empty when it has none (or no folder). */
function read(key) {
  const f = fileOf(key);
  if (!f) return _empty();
  try { return _norm(JSON.parse(fs.readFileSync(f, 'utf8'))); } catch (e) { return _empty(); }
}

/** Read, changed by `fn` (synchronous; it may throw an Error with `status`), written - one tick. -> fn's answer. */
function apply(key, fn) {
  if (isDraft(key)) { const e = new Error('A draft has no THIS PROJECT - save it under a name first.'); e.status = 409; throw e; }
  const f = fileOf(key);
  if (!f) { const e = new Error('This project is not saved yet - its folders come with it.'); e.status = 409; throw e; }
  let d = _empty();
  try { d = _norm(JSON.parse(fs.readFileSync(f, 'utf8'))); } catch (e) { /* none yet */ }
  const out = fn(d);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  writeFileAtomic(f, JSON.stringify(d, null, 2));
  return out;
}

const _id = (p) => p + crypto.randomBytes(5).toString('hex');
const _bad = (msg, status) => { const e = new Error(msg); e.status = status || 400; return e; };
const _under = (d, id, anc) => { for (let k = id; k; k = (d.folders.find(f => f.id === k) || {}).parent) if (k === anc) return true; return false; };
function _pathOf(d, id) {
  const names = [];
  for (let k = id; k; k = (d.folders.find(f => f.id === k) || {}).parent) names.unshift((d.folders.find(f => f.id === k) || {}).name || '');
  return names.join(' / ');
}
function _checkName(d, name, parent, except) {
  const n = String(name || '').trim().slice(0, NAME_MAX);
  if (!n) throw _bad('A folder needs a name.');
  const taken = d.folders.find(f => f.parent === parent && f.id !== except && f.name.toLowerCase() === n.toLowerCase());
  if (taken) throw _bad('There is already a folder called ' + taken.name + ' here.', 409);
  return n;
}

function addFolder(key, name, parent) {
  return apply(key, (d) => {
    const p = String(parent || '');
    if (p && !d.folders.some(f => f.id === p)) throw _bad('That folder is not there any more.', 404);
    const n = _checkName(d, name, p, '');
    const f = { id: _id('pf'), name: n, parent: p };
    if ((_pathOf(d, p) + ' / ' + n).length > PATH_MAX) throw _bad('The folder\'s path would be longer than ' + PATH_MAX + ' characters.');
    d.folders.push(f);
    return f;
  });
}

/** Renamed (`name`) and/or moved into another folder (`parent`: '' - THIS PROJECT itself). */
function changeFolder(key, id, o) {
  return apply(key, (d) => {
    const f = d.folders.find(x => x.id === String(id));
    if (!f) throw _bad('That folder is not there any more.', 404);
    const parent = o && o.parent != null ? String(o.parent) : f.parent;
    if (parent && !d.folders.some(x => x.id === parent)) throw _bad('That folder is not there any more.', 404);
    if (parent && _under(d, parent, f.id)) throw _bad('A folder does not go into itself.');
    const name = o && o.name != null ? _checkName(d, o.name, parent, f.id) : _checkName(d, f.name, parent, f.id);
    f.name = name;
    f.parent = parent;
    return f;
  });
}

/** The folder, its folders and every link in them - the files stay where they are. -> { folders, links } removed. */
function deleteFolder(key, id) {
  return apply(key, (d) => {
    const gone = new Set(d.folders.filter(f => _under(d, f.id, String(id))).map(f => f.id));
    if (!gone.size) throw _bad('That folder is not there any more.', 404);
    const before = d.links.length;
    d.folders = d.folders.filter(f => !gone.has(f.id));
    d.links = d.links.filter(l => !gone.has(l.folder));
    return { folders: gone.size, links: before - d.links.length };
  });
}

/**
 * Things into a folder (`folder`: '' - THIS PROJECT itself): `items` [{ kind, id, media, link? }] - one with `link` (a link of
 * this project dragged from another of its folders) is MOVED there; any other becomes a link, once per folder.
 * -> { added, moved, had }
 */
function put(key, folder, items) {
  return apply(key, (d) => {
    const to = String(folder || '');
    if (to && !d.folders.some(f => f.id === to)) throw _bad('That folder is not there any more.', 404);
    let added = 0, moved = 0, had = 0;
    for (const it of Array.isArray(items) ? items.slice(0, 500) : []) {
      if (!it) continue;
      if (it.link) {
        const l = d.links.find(x => x.id === String(it.link));
        if (l && l.folder !== to) {
          const dup = d.links.find(x => x !== l && x.folder === to && x.kind === l.kind && (x.item === l.item || (l.media && x.media === l.media)));
          if (dup) d.links = d.links.filter(x => x !== l); else l.folder = to;
          moved++;
        }
        continue;
      }
      const kind = String(it.kind || ''), item = String(it.id || ''), media = String(it.media || '').split(/[?#]/)[0];
      if (!kind || !(item || media)) continue;
      if (d.links.some(x => x.folder === to && x.kind === kind && ((item && x.item === item) || (media && x.media === media)))) { had++; continue; }
      d.links.push({ id: _id('pl'), folder: to, kind, item, media, at: new Date().toISOString() });
      added++;
    }
    return { added, moved, had };
  });
}

function unlink(key, ids) {
  const want = new Set((Array.isArray(ids) ? ids : [ids]).map(String));
  return apply(key, (d) => {
    const before = d.links.length;
    d.links = d.links.filter(l => !want.has(l.id));
    return { removed: before - d.links.length };
  });
}

/**
 * The library's items for the links of a project: `byKey` - Map 'kind:id' -> item, `byMedia` - Map address -> item (the
 * shelf's own items, routes/library.js). Links found by neither are dropped from the store (their file left the library).
 * -> [{ link, item }] in the order they were put.
 */
function resolve(key, byKey, byMedia) {
  const d = read(key);
  const out = [];
  const lost = [];
  for (const l of d.links) {
    const it = (l.item && byKey.get(l.kind + ':' + l.item)) || (l.media && byMedia.get(l.media)) || null;
    if (it) out.push({ link: l, item: it }); else lost.push(l.id);
  }
  if (lost.length) { try { unlink(key, lost); } catch (e) { /* read again next time */ } }
  return { folders: d.folders, found: out };
}

/** (лч14) The projects whose THIS PROJECT holds any of these files: [{ key, title, links }]. */
function usage(addresses) {
  const want = new Set((addresses || []).map(a => String(a || '').split(/[?#]/)[0]).filter(Boolean));
  if (!want.size) return [];
  const out = [];
  let dirs = [];
  try { dirs = fs.readdirSync(PROJECTS_DIR, { withFileTypes: true }).filter(x => x.isDirectory()).map(x => x.name); } catch (e) { return out; }
  const MSTORE = require('./merge-store');
  let titles = null;
  for (const dir of dirs) {
    let d = null;
    try { d = _norm(JSON.parse(fs.readFileSync(path.join(PROJECTS_DIR, dir, FILE), 'utf8'))); } catch (e) { continue; }
    const n = d.links.filter(l => want.has(l.media)).length;
    if (!n) continue;
    if (!titles) {
      titles = new Map();
      try {
        const tls = MSTORE.read().timelines || {};
        const locs = MSTORE.locateMany(Object.keys(tls));
        for (const [k, loc] of locs) {
          // A highlights project is named by its home, not by a fragment.
          if (loc && (!titles.has(loc.folder) || homeKey(k) === k)) titles.set(loc.folder, { key: k, title: String((tls[k] && tls[k].title) || 'Untitled') });
        }
      } catch (e) { /* named by its folder */ }
    }
    const t = titles.get(dir) || { key: '', title: dir };
    out.push({ key: t.key, title: t.title, links: n });
  }
  return out;
}

module.exports = { FILE, homeKey, isDraft, fileOf, read, addFolder, changeFolder, deleteFolder, put, unlink, resolve, usage };
