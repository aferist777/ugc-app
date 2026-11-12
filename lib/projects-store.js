'use strict';

/* projects-store.js - the projects, one folder each (docs/local-app/PLAN.md, phase 2).

   projects/<folder>/project.json IS a Scenarios project - the record routes/scen3.js has always
   kept, whole - and the folder holds its working files (voice/, frames/, clips/) and its Merge
   timelines (merge/). data/project-list.json is only the list: id, name, folder, kind and dates,
   enough to draw a picker and find a folder. (Not data/projects.json: that name belongs to a
   removed server-era store, and the migration tool skips it.) A project made in Merge
   without Scenarios is a folder too, kind 'merge', holding just its timelines; a scene of the 3D Studio is
   kind '3d', its folder holding 3d/ (lib/studio3d-store.js).

   The folder is named after the project (lib/names.js) and unique among the folders there.
   Renaming a project renames its folder - and its renders' folder in media/renders/ - and rewrites
   every stored path under them (lib/relocate.js). Deleting one deletes its folder (its renders
   stay on the shelf), after moving what anything else still
   points at to media/work/. A folder in projects/ that the list does not know - carried over from
   another library - joins the list when the server starts (sync()).

   Reads are cheap and always fresh: each record is kept in memory with the modification time of
   its file and read again only when that changes. Callers get copies, so a record they change is
   written only when they save it. */

const fs = require('fs');
const path = require('path');
const { DATA_DIR, PROJECTS_DIR, MEDIA } = require('./config');
const { writeFileAtomic } = require('./atomic-write');
const { folderName, uniqueName, uniqueFile } = require('./names');
const { PROJECT_SUBS } = require('./layout');

const LIST_FILE = path.join(DATA_DIR, 'project-list.json');
const FILE = 'project.json';
// What a project is: a Scenarios project, a Merge project, a scene of the 3D Studio (lib/studio3d-store.js:
// its folder holds 3d/, PLAN "3D Studio"), or a highlights project (phase V33.1, lib/highlights-store.js: its folder holds
// highlights.json, its fragments' timelines and their clips).
const KINDS = ['scenarios', 'merge', '3d', 'highlights'];
const FALLBACK = { scenarios: 'project', merge: 'merge project', '3d': 'scene', highlights: 'highlights' };

let _list = null;                 // { mtimeMs, projects: [entry] }
const _recs = new Map();          // id -> { json, mtimeMs }

// ── The list ────────────────────────────────────────────────────────────────
function _readList() {
  let mtimeMs = 0;
  try { mtimeMs = fs.statSync(LIST_FILE).mtimeMs; } catch (e) { /* none yet */ }
  if (_list && _list.mtimeMs === mtimeMs) return _list;
  let projects = [];
  if (mtimeMs) {
    try {
      const raw = JSON.parse(fs.readFileSync(LIST_FILE, 'utf8'));
      projects = (Array.isArray(raw && raw.projects) ? raw.projects : [])
        .filter((e) => e && e.id != null && e.folder)
        .map((e) => ({ id: String(e.id), name: String(e.name || ''), folder: String(e.folder),
          kind: KINDS.includes(e.kind) ? e.kind : 'scenarios', createdAt: e.createdAt || null, updatedAt: e.updatedAt || null }));
    } catch (e) { projects = []; }
  }
  _list = { mtimeMs, projects };
  return _list;
}

function _writeList(projects) {
  writeFileAtomic(LIST_FILE, JSON.stringify({ projects }, null, 2));
  _list = null;
}

const _entries = () => _readList().projects.map((e) => ({ ...e }));
const _folderAbs = (entry) => path.join(PROJECTS_DIR, entry.folder);

function _takenFolders(exceptFolder) {
  let names = [];
  try { names = fs.readdirSync(PROJECTS_DIR); } catch (e) { /* none yet */ }
  const listed = _readList().projects.map((e) => e.folder);
  return new Set([...names, ...listed].filter((n) => !exceptFolder || n.toLowerCase() !== exceptFolder.toLowerCase()));
}

// ── One record ──────────────────────────────────────────────────────────────
function _recFile(entry) { return path.join(_folderAbs(entry), FILE); }

function _readRec(entry) {
  const file = _recFile(entry);
  let mtimeMs = 0;
  try { mtimeMs = fs.statSync(file).mtimeMs; } catch (e) { return null; }
  const hit = _recs.get(entry.id);
  if (hit && hit.mtimeMs === mtimeMs) return hit.json;
  let json;
  try { json = JSON.stringify(JSON.parse(fs.readFileSync(file, 'utf8')), null, 2); } catch (e) { return null; }
  _recs.set(entry.id, { json, mtimeMs });
  return json;
}

function _writeRec(entry, json) {
  const file = _recFile(entry);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  writeFileAtomic(file, json);
  let mtimeMs = 0;
  try { mtimeMs = fs.statSync(file).mtimeMs; } catch (e) { /* written a moment ago */ }
  _recs.set(entry.id, { json, mtimeMs });
}

// ── Reading ─────────────────────────────────────────────────────────────────
// Every Scenarios project, in list order (the newest first, as they are added).
function list() {
  const out = [];
  for (const e of _readList().projects) {
    if (e.kind !== 'scenarios') continue;
    const json = _readRec(e);
    if (json) out.push(JSON.parse(json));
  }
  return out;
}

function get(id) {
  const e = _readList().projects.find((x) => x.id === String(id));
  if (!e) return null;
  const json = _readRec(e);
  return json ? JSON.parse(json) : null;
}

function entry(id) {
  const e = _readList().projects.find((x) => x.id === String(id));
  return e ? { ...e } : null;
}

// One of the project's working folders, or the folder itself (made if missing). null for no project.
function dirOf(id, sub) {
  const e = entry(id);
  if (!e) return null;
  const dir = sub ? path.join(_folderAbs(e), PROJECT_SUBS[sub] || sub) : _folderAbs(e);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// ── Writing ─────────────────────────────────────────────────────────────────
// A new folder for a project called `name`. Any memory of a moved folder under that name is
// dropped, or the new folder's files would be redirected away (lib/moves.js).
function _newFolder(name, fallback) {
  const folder = uniqueName(folderName(name, fallback), _takenFolders());
  fs.mkdirSync(path.join(PROJECTS_DIR, folder), { recursive: true });
  require('./moves').forget(`/projects/${folder}/`);
  require('./moves').forget(`/media/renders/${folder}/`);
  return folder;
}

// A project's renders are in media/renders/<its folder>/ (lib/shelf-files.js) and are renamed with
// it. Returns the pairs that moved.
function _renameRenders(from, to) {
  if (from === to) return [];
  const fromAbs = path.join(MEDIA.renders, from);
  if (!fs.existsSync(fromAbs)) return [];
  const R = require('./relocate');
  const url = (f) => `/media/renders/${f}/`;
  if (from.toLowerCase() === to.toLowerCase()) {
    // Only the case changed: Windows sees one name, so through a temporary one.
    const tmp = uniqueName(`${to} ~`, fs.readdirSync(MEDIA.renders));
    return [...R.relocate({ folders: [[url(from), url(tmp)]] }).pairs, ...R.relocate({ folders: [[url(tmp), url(to)]] }).pairs];
  }
  const toAbs = path.join(MEDIA.renders, to);
  if (!fs.existsSync(toAbs)) return R.relocate({ folders: [[url(from), url(to)]] }).pairs;
  // A folder of that name is there already - renders of an earlier project called so: file by file.
  const taken = fs.readdirSync(toAbs);
  const pairs = [];
  // A render's subtitles file (`<name>.en_US.srt`, phase V30, block 4) takes the name its video gets, after it.
  const SRT_TAIL = require('../public/js/captions/srt.js').SRT_TAIL;
  const files = fs.readdirSync(fromAbs).filter((f) => fs.statSync(path.join(fromAbs, f)).isFile());
  const isSrt = (f) => f.toLowerCase().endsWith(SRT_TAIL.toLowerCase());
  const renamed = new Map();          // a video's name without its extension -> its new one
  for (const f of files.filter((x) => !isSrt(x)).concat(files.filter(isSrt))) {
    let name;
    const base = isSrt(f) ? f.slice(0, -SRT_TAIL.length) : null;
    if (base != null && renamed.has(base) && !taken.includes(renamed.get(base) + SRT_TAIL)) name = renamed.get(base) + SRT_TAIL;
    else name = uniqueFile(f, taken);
    taken.push(name);
    if (base == null) renamed.set(f.replace(/\.[^.]+$/, ''), name.replace(/\.[^.]+$/, ''));
    pairs.push([`${url(from)}${f}`, `${url(to)}${name}`]);
  }
  const moved = R.relocate({ files: pairs }).pairs;
  for (const dir of [path.join(fromAbs, 'thumbs'), fromAbs]) {
    try { if (!fs.readdirSync(dir).length) fs.rmdirSync(dir); } catch (e) { /* not empty, or gone */ }
  }
  return moved;
}

// Rename the folder of `e` for the name `name`: the folder moves and every stored path under it is
// rewritten. Returns the pairs that moved, so a record still in memory can be rewritten too.
function _renameFolder(e, name) {
  const want = uniqueName(folderName(name, FALLBACK[e.kind] || 'project'), _takenFolders(e.folder));
  if (want === e.folder) return [];
  if (want.toLowerCase() === e.folder.toLowerCase()) {
    // Only the case changed: Windows sees one name, so go through a temporary one.
    const tmp = uniqueName(want + ' ~', _takenFolders());
    const R = require('./relocate');
    const a = R.relocate({ folders: [[`/projects/${e.folder}/`, `/projects/${tmp}/`]] }).pairs;
    const b = R.relocate({ folders: [[`/projects/${tmp}/`, `/projects/${want}/`]] }).pairs;
    const c = _renameRenders(e.folder, want);
    e.folder = want;
    require('./merge-store').invalidate();
    return [...a, ...b, ...c];
  }
  const { pairs } = require('./relocate').relocate({ folders: [[`/projects/${e.folder}/`, `/projects/${want}/`]] });
  const renders = _renameRenders(e.folder, want);
  e.folder = want;
  require('./merge-store').invalidate();       // its timelines moved with the folder
  return [...pairs, ...renders];
}

// Save several: only the records that changed are written. Records not in `recs` are left alone -
// deleting is remove(), never a side effect of a shorter list.
function saveAll(recs) {
  const now = new Date().toISOString();
  const projects = _entries();
  let listChanged = false;
  const out = [];
  const fresh = [];
  for (const r0 of recs || []) {
    if (!r0 || r0.id == null) continue;
    let rec = r0;
    const id = String(rec.id);
    let e = projects.find((x) => x.id === id);
    if (!e) {
      e = { id, name: String(rec.name || ''), folder: _newFolder(rec.name, 'project'), kind: 'scenarios',
        createdAt: rec.createdAt || now, updatedAt: rec.updatedAt || now };
      fresh.push(e);
      listChanged = true;
    } else if (String(rec.name || '') !== e.name) {
      const pairs = _renameFolder(e, rec.name);
      if (pairs.length) rec = require('./relocate').rewriteValue(rec, require('./relocate').mapper(pairs));
      e.name = String(rec.name || '');
      listChanged = true;
    }
    const json = JSON.stringify(rec, null, 2);
    if (_readRec(e) !== json) _writeRec(e, json);
    if ((rec.updatedAt || null) !== e.updatedAt) { e.updatedAt = rec.updatedAt || now; listChanged = true; }
    out.push(rec);
  }
  if (listChanged) _writeList([...fresh.reverse(), ...projects]);
  return out;
}

// Delete a project: its folder goes, after whatever something else still points at has moved to
// media/work/. Returns { moved } - how many files were kept that way.
function remove(id) {
  const e = entry(id);
  if (!e) return { moved: 0 };
  const R = require('./relocate');
  const base = `/projects/${e.folder}/`;
  const folderAbs = _folderAbs(e);
  // Every file in the folder, as an address.
  const files = [];
  (function walk(dir, rel) {
    let ents = [];
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (err) { return; }
    for (const d of ents) {
      const r = rel ? `${rel}/${d.name}` : d.name;
      if (d.isDirectory()) walk(path.join(dir, d.name), r);
      else files.push(base + r);
    }
  })(folderAbs, '');
  // The stores outside this folder that name any of them.
  const outside = R.storeFiles().filter((f) => !path.resolve(f).startsWith(path.resolve(folderAbs) + path.sep));
  const texts = outside.map((f) => { try { return fs.readFileSync(f, 'utf8'); } catch (err) { return ''; } });
  const wanted = files.filter((u) => !/\.json$/i.test(u) && !/\/(thumbs|preview)\//.test(u) && !/\.norm$/i.test(u)
    && texts.some((t) => t.includes(JSON.stringify(u).slice(1, -1))));
  if (wanted.length) {
    let taken = [];
    try { taken = fs.readdirSync(MEDIA.work); } catch (err) { /* empty */ }
    const pairs = [];
    for (const u of wanted) {
      const name = uniqueFile(path.posix.basename(u), taken);
      taken.push(name);
      pairs.push([u, `/media/work/${name}`]);
    }
    R.relocate({ files: pairs });
  }
  const moved = wanted.length;
  fs.rmSync(folderAbs, { recursive: true, force: true });
  _recs.delete(e.id);
  _writeList(_entries().filter((x) => x.id !== e.id));
  require('./merge-store').invalidate();       // its timelines went with the folder
  return { moved };
}

// Make sure the list and the folders agree, at start: a listed project whose folder is gone
// leaves the list; a folder with a project.json the list does not know joins it (a fresh id if
// its own is taken). Returns { added, dropped }.
function sync() {
  const projects = _entries();
  let dirs = [];
  try { dirs = fs.readdirSync(PROJECTS_DIR, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch (e) { /* none */ }
  const have = new Set(dirs.map((d) => d.toLowerCase()));
  const kept = projects.filter((e) => have.has(e.folder.toLowerCase()));
  const dropped = projects.length - kept.length;
  const known = new Set(kept.map((e) => e.folder.toLowerCase()));
  const ids = new Set(kept.map((e) => e.id));
  let added = 0;
  for (const d of dirs) {
    if (known.has(d.toLowerCase())) continue;
    const file = path.join(PROJECTS_DIR, d, FILE);
    if (!fs.existsSync(file)) continue;          // a Merge project's folder: lib/merge-store.js lists those
    let rec;
    try { rec = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { continue; }
    let id = String(rec.id != null ? rec.id : '');
    if (!id || ids.has(id)) {
      id = String(Date.now() + added);
      rec.id = id;
      writeFileAtomic(file, JSON.stringify(rec, null, 2));
    }
    ids.add(id);
    kept.unshift({ id, name: String(rec.name || d), folder: d, kind: 'scenarios', createdAt: rec.createdAt || null, updatedAt: rec.updatedAt || null });
    added++;
  }
  if (added || dropped) _writeList(kept);
  return { added, dropped };
}

// ── ONE TICK, OR IT IS LOST (phase X0) ─────────────────────────────────
// A project record is read whole, changed and written back whole. Node runs one tick at a time, so
// a handler that does all three with NO await in between cannot be interrupted, and most of them
// are like that: they are safe for free.
//
// A handler that AWAITS between the read and the write is another matter - an agent answering,
// ElevenLabs speaking a line, sharp cutting a picture. It hands control back, and anything that
// writes the same record in that gap is overwritten when the handler finally saves the copy it read
// before. That is how a take, a prompt or a frame quietly disappears; phase X, which sends ten
// reads and ten clips at once instead of five at a time, would have made it the normal case.
//
// So: do the slow work FIRST, then call `apply` - it reads the record as it is NOW, hands it to
// `fn` to change, and saves, all in one tick. `fn` must be synchronous, and the guard below says so
// out loud rather than letting a returned promise quietly reintroduce the gap.
function apply(id, fn) {
  const all = list();
  const rec = all.find((r) => String(r.id) === String(id));
  if (!rec) return null;
  const out = fn(rec);
  if (out && typeof out.then === 'function') {
    throw new Error('projects.apply(fn) must not await - do the slow work before the call');
  }
  saveAll(all);
  return rec;
}

module.exports = { LIST_FILE, list, get, entry, dirOf, saveAll, remove, sync, entries: _entries,
  apply,
  _newFolder, _renameFolder, _writeList };
