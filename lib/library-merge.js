'use strict';

/* library-merge.js - one library's contents brought into another (docs/local-app/PLAN.md, phase 2).

   Import unpacks an archive into a staging library (cache/import/<set>/lib), upgrades it to
   layout 6 when it is older (lib/library-upgrade.js), and hands it here together with the library
   it goes into. Both are layout 6 by then.

   ADDITIVE, as Import always was: nothing already in the library is touched, and a record both
   have keeps the local version - unless `overwrite`, when the incoming one replaces it.

   WHERE THINGS GO.
   - A project (a folder in projects/) the library already has - the same id - IS that project: its
     incoming files join the local folder, whatever that folder is called here. A new project keeps
     its folder name, or takes "name (2)" when another project has it.
   - A timeline the library already has (the same key) stays as it is; a new one is written into
     the folder of its project.
   - A shelf category the library already has (the same id) is that category: its files join the
     local folder. A new one keeps its folder name, or takes "name (2)".
   - Renders filed under a project's folder follow the project. Everything else in media/ keeps its
     path.
   - A file already at its place is the same file - media names carry a timestamp or a hash - and
     stays.
   Paths inside the incoming stores and timelines are rewritten through the same mapping before the
   stores are merged, so an imported timeline points at the files imported with it.

   Files move out of the staging library (a rename - it sits inside the library, on its drive);
   the caller deletes what is left of it. No lib/config.js here: both libraries are passed in. */

const fs = require('fs');
const path = require('path');
const { writeFileAtomic } = require('./atomic-write');
const { folderName, uniqueName, uniqueFile } = require('./names');
const { NOCAT } = require('./layout');

const SHELF_KINDS = ['birols', 'uploads', 'hooks', 'images', 'sounds'];
// Stores that belong to the library they are in and are never brought across.
const OWN_STORES = new Set(['moves.json', 'library.json']);

const _json = (abs, d) => { try { return JSON.parse(fs.readFileSync(abs, 'utf8')); } catch (e) { return d; } };
const _names = (abs) => { try { return fs.readdirSync(abs); } catch (e) { return []; } };
const _isDir = (abs) => { try { return fs.statSync(abs).isDirectory(); } catch (e) { return false; } };
const _arr = (v) => (Array.isArray(v) ? v : []);
const _lower = (list) => new Set([...list].map((s) => String(s).toLowerCase()));

// The stores of the chats' generations (lib/mv3-gens.js, lib/mv3-video-gens.js) and what an incoming pending one
// becomes.
const GEN_STORES = new Set(['mv3-gens.json', 'mv3-video-gens.json']);
const IMPORTED_PENDING = 'it was still being made in the library it came from - it is not followed here';
function _settledGen(r) {
  if (!r || typeof r !== 'object' || r.state !== 'pending') return r;
  return Object.assign({}, r, { state: 'failed', stage: '', error: IMPORTED_PENDING, doneAt: r.doneAt || new Date().toISOString() });
}

// ── Merging two versions of a store ─────────────────────────────────────────
// Local wins on every conflict unless `overwrite`. Arrays are matched by id (key, path, file or
// name); items without any of those by their whole value, so a re-import never doubles them.
function mergeValue(local, incoming, overwrite) {
  const keyOf = (o) => (o && (o.id ?? o.key ?? o.path ?? o.file ?? o.name));
  if (Array.isArray(local) && Array.isArray(incoming)) {
    const out = local.slice();
    const seen = new Map();
    out.forEach((o, i) => { const k = keyOf(o); if (k != null) seen.set(String(k), i); });
    const byValue = new Set();
    for (const o of out) if (keyOf(o) == null) byValue.add(JSON.stringify(o));
    for (const o of incoming) {
      const k = keyOf(o);
      if (k == null) {
        const sig = JSON.stringify(o);
        if (!byValue.has(sig)) { byValue.add(sig); out.push(o); }
        continue;
      }
      const at = seen.get(String(k));
      if (at == null) { seen.set(String(k), out.length); out.push(o); }
      else if (overwrite) out[at] = o;
    }
    return out;
  }
  if (local && incoming && typeof local === 'object' && typeof incoming === 'object') {
    const out = { ...local };
    for (const [k, v] of Object.entries(incoming)) {
      if (!(k in out)) out[k] = v;
      else if (overwrite) out[k] = v;
      else if (Array.isArray(out[k]) && Array.isArray(v)) out[k] = mergeValue(out[k], v, false);
    }
    return out;
  }
  return overwrite ? incoming : (local === undefined ? incoming : local);
}

/**
 * The chats' thread file (data/mv3-chat.json): the incoming one merged into this one BY ID, whatever "overwrite" says (review
 * V6 - overwrite used to take the incoming file whole, and every local message it did not have went). With overwrite
 * the incoming copy of a message wins - except that a card made here never goes back to not made (a second press would
 * pay again). A card that was being written in the library it came from is failed in words: its writer is not here.
 * The cleared marks of both are kept, the later of two.
 */
function _mergeChat(local, incoming, overwrite) {
  const shape = (raw) => (Array.isArray(raw) ? { messages: raw, cleared: {} }
    : { messages: Array.isArray(raw && raw.messages) ? raw.messages : [], cleared: (raw && raw.cleared && typeof raw.cleared === 'object') ? raw.cleared : {} });
  const L = shape(local);
  const I = shape(incoming);
  const settled = (m) => (m && m.card && m.card.type === 'prompt' && m.card.state === 'writing'
    ? Object.assign({}, m, { card: Object.assign({}, m.card, { state: 'failed', kick: '', error: 'it was being written in the library it came from - write it again' }) })
    : m);
  const out = L.messages.filter(m => m && m.id).slice();
  const at = new Map(out.map((m, i) => [m.id, i]));
  for (const raw of I.messages) {
    if (!raw || !raw.id) continue;
    const m = settled(raw);
    const i = at.get(m.id);
    if (i == null) { at.set(m.id, out.length); out.push(m); continue; }
    if (!overwrite) continue;
    const mine = out[i];
    const made = mine && mine.card && mine.card.state === 'sent';
    if (made && !(m.card && m.card.state === 'sent')) continue;
    out[i] = m;
  }
  const cleared = Object.assign({}, I.cleared);
  for (const [k, v] of Object.entries(L.cleared)) if (!cleared[k] || String(v) > String(cleared[k])) cleared[k] = v;
  return { messages: out, cleared };
}

// ── Addresses ───────────────────────────────────────────────────────────────
const _isLib = (s) => typeof s === 'string' && (s.startsWith('/media/') || s.startsWith('/projects/'));

// Folder pairs (addresses ending in '/') -> a function from an address to its address here.
function _mapper(pairs) {
  const list = pairs.filter((p) => p.from !== p.to).sort((a, b) => b.from.length - a.from.length);
  return (s) => {
    if (!list.length || !_isLib(s)) return s;
    for (const p of list) if (s.startsWith(p.from)) return p.to + s.slice(p.from.length);
    return s;
  };
}
function _rewrite(v, m) {
  if (typeof v === 'string') return m(v);
  if (Array.isArray(v)) return v.map((x) => _rewrite(x, m));
  if (v && typeof v === 'object') { const o = {}; for (const [k, x] of Object.entries(v)) o[m(k)] = _rewrite(x, m); return o; }
  return v;
}
// ui-state.json mirrors localStorage: its values are strings, many of them JSON.
function _rewriteUi(state, m) {
  const out = {};
  for (const [k, v] of Object.entries(state || {})) {
    if (typeof v !== 'string' || !/\/(media|projects)\//.test(v)) { out[k] = v; continue; }
    let parsed;
    try { parsed = JSON.parse(v); } catch (e) { parsed = undefined; }
    out[k] = parsed && typeof parsed === 'object' ? JSON.stringify(_rewrite(parsed, m)) : m(v);
  }
  return out;
}

// ── Moving files ────────────────────────────────────────────────────────────
function _place(fromAbs, toAbs, overwrite) {
  if (fs.existsSync(toAbs) && !overwrite) return false;
  fs.mkdirSync(path.dirname(toAbs), { recursive: true });
  try {
    fs.renameSync(fromAbs, toAbs);
  } catch (e) {
    if (e.code !== 'EXDEV' && !(overwrite && fs.existsSync(toAbs))) throw e;
    fs.copyFileSync(fromAbs, toAbs);
    try { fs.unlinkSync(fromAbs); } catch (err) { /* the staging library goes anyway */ }
  }
  return true;
}

function _walk(root, rel, visit) {
  (function walk(dirAbs, url) {
    let ents = [];
    try { ents = fs.readdirSync(dirAbs, { withFileTypes: true }); } catch (e) { return; }
    for (const d of ents) {
      if (d.isDirectory()) walk(path.join(dirAbs, d.name), `${url}${d.name}/`);
      else if (d.isFile()) visit(`${url}${d.name}`, path.join(dirAbs, d.name));
    }
  })(path.join(root, rel), `/${rel}/`);
}

// ── The merge ───────────────────────────────────────────────────────────────
// src and dst are library folders. onNewFolder(address) is called for each folder the merge makes
// under a name the library did not have - the running app forgets any old move of that name
// (lib/moves.js). Returns what happened.
function mergeLibrary(src, dst, { overwrite = false, onNewFolder = () => {} } = {}) {
  const report = { projects: 0, projectsHere: 0, timelines: 0, timelinesHere: 0, categories: 0, files: 0, skipped: 0, stores: 0 };
  const writeJson = (abs, v) => { fs.mkdirSync(path.dirname(abs), { recursive: true }); writeFileAtomic(abs, JSON.stringify(v, null, 2)); };

  // ── Projects ──
  const listOf = (root) => _arr((_json(path.join(root, 'data', 'project-list.json'), {}) || {}).projects).filter((e) => e && e.id != null && e.folder);
  const dstList = listOf(dst);
  const srcList = listOf(src);
  const dstFolders = _lower([..._names(path.join(dst, 'projects')), ...dstList.map((e) => e.folder)]);
  const projectMap = new Map();      // source folder -> folder here
  const fresh = [];                   // list entries of projects new here
  const kindOf = (e) => (e && (e.kind === 'merge' || e.kind === '3d') ? e.kind : 'scenarios');
  for (const folder of _names(path.join(src, 'projects'))) {
    const abs = path.join(src, 'projects', folder);
    if (!_isDir(abs)) continue;
    let e = srcList.find((x) => x.folder === folder) || null;
    if (!e) {
      // A folder the list did not know (projects-store.js and merge-store.js adopt those at start).
      const rec = _json(path.join(abs, 'project.json'), null);
      if (rec && rec.id != null) e = { id: String(rec.id), name: String(rec.name || folder), kind: 'scenarios', createdAt: rec.createdAt || null, updatedAt: rec.updatedAt || null };
      else {
        const first = _names(path.join(abs, 'merge')).map((f) => _json(path.join(abs, 'merge', f), null)).find((d) => d && d.key);
        if (first) e = { id: String(first.key), name: String(first.title || folder), kind: 'merge', createdAt: first.createdAt || null, updatedAt: first.updatedAt || null };
        else {
          // A scene of the 3D Studio (lib/studio3d-store.js).
          const scene = _json(path.join(abs, '3d', 'scene.json'), null);
          if (scene && scene.id) e = { id: String(scene.id), name: String(scene.name || folder), kind: '3d', createdAt: scene.createdAt || null, updatedAt: scene.updatedAt || null };
        }
      }
    }
    const here = e && dstList.find((x) => String(x.id) === String(e.id) && kindOf(x) === kindOf(e));
    if (here) { projectMap.set(folder, here.folder); report.projectsHere++; continue; }
    const name = uniqueName(folderName(folder, 'project'), dstFolders);
    dstFolders.add(name.toLowerCase());
    projectMap.set(folder, name);
    if (e) fresh.push({ id: String(e.id), name: String(e.name || ''), folder: name, kind: kindOf(e), createdAt: e.createdAt || null, updatedAt: e.updatedAt || null });
  }

  // ── Shelf categories ──
  const catsOf = (root) => {
    const raw = _json(path.join(root, 'data', 'library-cats.json'), {}) || {};
    const out = {};
    for (const k of SHELF_KINDS) {
      const s = raw[k] || {};
      out[k] = {
        own: _arr(s.own).filter((c) => c && c.id).map((c) => ({ id: String(c.id), label: String(c.label || c.id), folder: String(c.folder || '') })),
        order: _arr(s.order).map(String), hidden: _arr(s.hidden).map(String),
      };
    }
    return out;
  };
  const dstCats = catsOf(dst);
  const srcCats = catsOf(src);
  const catsBefore = JSON.stringify(dstCats);
  const catMap = {};
  for (const k of SHELF_KINDS) {
    catMap[k] = new Map([[NOCAT, NOCAT]]);
    const taken = _lower([NOCAT, ...dstCats[k].own.map((c) => c.folder), ..._names(path.join(dst, 'media', k))]);
    for (const c of srcCats[k].own) {
      const from = c.folder || folderName(c.label, 'category');
      const here = dstCats[k].own.find((x) => x.id === c.id);
      if (here) {
        if (!here.folder) { here.folder = uniqueName(folderName(here.label, 'category'), taken); taken.add(here.folder.toLowerCase()); }
        catMap[k].set(from, here.folder);
        continue;
      }
      const folder = uniqueName(from, taken);
      taken.add(folder.toLowerCase());
      dstCats[k].own.push({ id: c.id, label: c.label, folder });
      if (!dstCats[k].order.includes(c.id)) dstCats[k].order.push(c.id);
      if (srcCats[k].hidden.includes(c.id) && !dstCats[k].hidden.includes(c.id)) dstCats[k].hidden.push(c.id);
      catMap[k].set(from, folder);
      report.categories++;
    }
  }

  // ── The mapping, as folder pairs ──
  const pairs = [];
  for (const [a, b] of projectMap) {
    pairs.push({ from: `/projects/${a}/`, to: `/projects/${b}/` }, { from: `/media/renders/${a}/`, to: `/media/renders/${b}/` });
  }
  for (const k of SHELF_KINDS) for (const [a, b] of catMap[k]) pairs.push({ from: `/media/${k}/${a}/`, to: `/media/${k}/${b}/` });
  const map = _mapper(pairs);
  const existedBefore = (url) => _isDir(path.join(dst, ...url.split('/').filter(Boolean)));
  const newFolders = new Set();
  for (const p of pairs) if (!existedBefore(p.to)) newFolders.add(p.to);

  // ── Files ──
  const isDoc = (url) => /^\/projects\/[^/]+\/project\.json$/i.test(url) || /^\/projects\/[^/]+\/merge\/[^/]+\.json$/i.test(url)
    || /^\/projects\/[^/]+\/3d\/scene\.json$/i.test(url);
  for (const top of ['media', 'projects']) {
    _walk(src, top, (url, abs) => {
      if (isDoc(url)) return;
      const to = map(url);
      if (_place(abs, path.join(dst, ...to.split('/').filter(Boolean)), overwrite)) report.files++; else report.skipped++;
    });
  }

  // ── Project records and timelines ──
  for (const [folder, here] of projectMap) {
    const rec = _json(path.join(src, 'projects', folder, 'project.json'), null);
    if (rec) {
      const target = path.join(dst, 'projects', here, 'project.json');
      if (!fs.existsSync(target) || overwrite) writeJson(target, _rewrite(rec, map));
    }
    // A 3D Studio scene: its addresses follow the folders, like a project record's.
    const scene = _json(path.join(src, 'projects', folder, '3d', 'scene.json'), null);
    if (scene) {
      const target = path.join(dst, 'projects', here, '3d', 'scene.json');
      if (!fs.existsSync(target) || overwrite) writeJson(target, _rewrite(scene, map));
    }
  }
  const dstKeys = new Map();          // timeline key -> its file here
  for (const d of _names(path.join(dst, 'projects'))) {
    for (const f of _names(path.join(dst, 'projects', d, 'merge'))) {
      const doc = _json(path.join(dst, 'projects', d, 'merge', f), null);
      if (doc && doc.key) dstKeys.set(String(doc.key), path.join(dst, 'projects', d, 'merge', f));
    }
  }
  let timelinesChanged = false;
  for (const [folder, here] of projectMap) {
    const dir = path.join(src, 'projects', folder, 'merge');
    for (const f of _names(dir)) {
      if (!f.toLowerCase().endsWith('.json')) continue;
      const doc = _json(path.join(dir, f), null);
      if (!doc || !doc.key) continue;
      const key = String(doc.key);
      // (phase V20) The library has ONE draft - its own: an incoming one is an ordinary project under its draft name.
      if (doc.draft) delete doc.draft;
      if (dstKeys.has(key)) {
        report.timelinesHere++;
        if (overwrite) { writeJson(dstKeys.get(key), _rewrite(doc, map)); timelinesChanged = true; }
        continue;
      }
      const outDir = path.join(dst, 'projects', here, 'merge');
      const file = uniqueFile(f, _names(outDir));
      writeJson(path.join(outDir, file), _rewrite(doc, map));
      dstKeys.set(key, path.join(outDir, file));
      report.timelines++;
      timelinesChanged = true;
    }
  }

  // ── Stores ──
  const special = new Set(['project-list.json', 'merge.json', 'library-cats.json']);
  _walk(src, 'data', (url, abs) => {
    const rel = url.slice('/data/'.length);
    if (!rel.includes('/') && (OWN_STORES.has(rel) || special.has(rel))) return;
    const target = path.join(dst, 'data', ...rel.split('/'));
    if (!rel.toLowerCase().endsWith('.json')) {
      if (_place(abs, target, overwrite)) report.files++; else report.skipped++;
      return;
    }
    const incomingRaw = _json(abs, undefined);
    if (incomingRaw === undefined) return;
    let incoming = rel === 'ui-state.json' ? _rewriteUi(incomingRaw, map) : _rewrite(incomingRaw, map);
    const local = _json(target, undefined);
    // THE CHATS' GENERATIONS (review V2r): one still being made in the library it came from is not followed here -
    // with this library's keys, its watcher would fetch another library's task, or pay to rescue it - and a record
    // of a generation this library already has is this library's own, whatever `overwrite` says.
    const gens = GEN_STORES.has(rel);
    if (gens && Array.isArray(incoming)) incoming = incoming.map(_settledGen);
    // The video presets (phase V4): one id, the newer `updated` wins and the versions of both are kept. The caption presets
    // (phase V30, block 5): one id once, the newer; one deleted here stays deleted; a name taken here becomes "Name (2)" - even
    // into a library with none yet (the archive's own list is cleaned the same way).
    // The chats' threads (review V6): merged by message even with overwrite - taking the incoming file whole lost every
    // local message it did not have, and a card made here could come back not made.
    const merged = rel === 'caption-presets.json' ? require('./caption-presets-store').mergeLists(local, incoming)
      : local === undefined ? (rel === 'mv3-chat.json' ? _mergeChat([], incoming, false) : incoming)
      : rel === 'video-presets.json' ? require('./video-presets-store').mergeLists(local, incoming)
      : rel === 'mv3-chat.json' ? _mergeChat(local, incoming, overwrite)
      : mergeValue(local, incoming, gens ? false : overwrite);
    if (local === undefined || JSON.stringify(merged) !== JSON.stringify(local)) { writeJson(target, merged); report.stores++; }
  });

  // The projects list: every new project that has something here now.
  const added = fresh.filter((e) => _isDir(path.join(dst, 'projects', e.folder)));
  report.projects = added.length;
  if (added.length) writeJson(path.join(dst, 'data', 'project-list.json'), { projects: [...added, ...dstList] });
  if (JSON.stringify(dstCats) !== catsBefore) writeJson(path.join(dst, 'data', 'library-cats.json'), dstCats);
  if (timelinesChanged) {
    // A new version, so a Merge page open on the old one reloads rather than saves over it.
    const here = _json(path.join(dst, 'data', 'merge.json'), {}) || {};
    const there = _json(path.join(src, 'data', 'merge.json'), {}) || {};
    writeJson(path.join(dst, 'data', 'merge.json'), {
      version: Math.max(Number(here.version) || 0, Number(there.version) || 0) + 1, updatedAt: new Date().toISOString(),
    });
  }
  for (const url of newFolders) if (existedBefore(url)) onNewFolder(url);
  return report;
}

module.exports = { mergeLibrary, mergeValue,
                   // for the stands: the threads' merge
                   _mergeChat };
