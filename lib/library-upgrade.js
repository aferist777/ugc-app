'use strict';

/* library-upgrade.js - a library in layout 5 becomes layout 6 (docs/local-app/PLAN.md, phase 2).

   Layout 5 kept media by kind only - media/clips, media/images, media/voice - with Scenarios'
   voice, frames and clips, the Birols and Uploads shelves, Merge's pictures and the old editor's
   project folders all mixed in them, and every project and timeline in two big stores
   (scen3-projects.json, merge-v3.json). Layout 6 (lib/layout.js):
     projects/<name>/project.json, voice/, frames/, clips/, merge/<title>.json
     media/<shelf>/<category folder>/ (nocat for none), media/renders/<project>/, media/work/
   with data/project-list.json and data/merge.json beside the other stores.

   HOW. server.js calls upgrade() before anything reads a store.
     1. The stores are copied to backups/<date> layout 6/ - data/*.json except settings.json, which
        the upgrade never touches - and the plan is worked out: where every file goes, which folder
        every project, timeline and category gets. It is saved there as plan.json, and
        data/library.json says an upgrade is under way.
     2. Files move - a rename, on the same drive. One that cannot move (held open by another
        program) stays where it is, and so does every path to it. The preview proxies and
        thumbnails cached for the files that moved are renamed to match (_carryCaches).
     3. The stores are built again FROM THE COPY, with the paths of the files that did move
        replaced, and written; the two old stores go; data/library.json says layout 6.
   Every step can be run twice. The shell restarts a server that has not answered in 90 seconds;
   the next start finds the plan and carries on from wherever the last one stopped - a file
   already at its destination is skipped, and the stores are always built from the copy.

   WHERE A FILE GOES. The first claim wins, and a file takes what is derived from it along
   (thumbs/<name>.jpg, thumbs/<name>_thumb.jpg, preview/<name>.jpg, <name>_thumb.jpg, <file>.norm):
     1. Scenarios projects, oldest first: voice takes to voice/, frames and crops (with their
        previews) to frames/, lipsync clips and posters to clips/.
     2. Shelf records: Images (images.json), Birols and Uploads (biroly.json), Hooks
        (hooks-archive.json) to media/<shelf>/<category folder>/. The Birols generator's
        categories become Library categories. A clip with a hook number that something still
        uses but no record holds goes to media/hooks/nocat/.
     3. A look's pictures that live outside the look's folder, into it.
     4. Renders to media/renders/<folder of the timeline whose title the file name carries>/, or
        nocat.
     5. Whatever else a store uses - a Merge clip on no shelf, a reference picture - to media/work/.
   In place: the character and look folders the stores list, lookbooks and locations (those shelves
   are their folders), and the sources, music and voice samples a store uses.
   Set aside: every other file in media/ - nothing uses it - moves to
   backups/<date> layout 6/unreferenced/<its old path in media/>, for the owner to look through
   and delete.

   WHAT COUNTS AS A USE. A path in a store, except: hook-ids.json (a register that keeps numbers for
   files long gone), biroly.json's generator slots and categories (the Birols page is gone and its
   state goes with it), and localStorage keys of pages that are gone (DEAD_UI_KEYS).

   No lib/config.js here, on purpose: tools/upgrade-library.js plans against a library the app has
   not opened, and reading must not create the app's folders in it. */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { writeFileAtomic } = require('./atomic-write');
const { folderName, uniqueName } = require('./names');
const { LAYOUT, KINDS, NOCAT } = require('./layout');

const MARKER = 'data/library.json';
const VIDEO = /\.(mp4|webm|mov|m4v|mkv|avi)$/i;

// Stores the upgrade neither reads nor writes: the keys, the queue of unfinished generations, the
// running app's memory of moves, the marker itself.
const UNTOUCHED = new Set(['settings.json', 'pending-tasks.json', 'moves.json', 'library.json']);
// Stores whose paths are not uses of a file.
const NOT_USES = new Set([...UNTOUCHED, 'hook-ids.json']);
// Replaced by project folders and timeline files.
const OLD_STORES = ['scen3-projects.json', 'merge-v3.json'];

// localStorage keys (mirrored in data/ui-state.json) of pages that are gone. public/js/storage-sync.js
// blocks these, so no page reads or sends them again: they are dropped.
const BLOCKED_UI_KEYS = new Set([
  'edit_frozen_sessions_v1', 'timeline_data_v2', 'skleyka_saved_projects_v1', 'all_geni_v1',
  'biroly_cats', 'biroly_slots_v2', 'biroly_archive_v1', 'hooks_archive_v1', 'obrazy', 'projects_v1',
  'applog_v2', '__just_imported_at',
]);
// Not blocked, so a browser that still holds one would send it back: these stay, but a path in
// them keeps no file.
const DEAD_UI_KEYS = new Set([...BLOCKED_UI_KEYS, 'asset_variants_v1', 'genlog_history_v1', 'char_state_v1', 'cr_custom_poses_v1']);

const SHELF_KINDS = ['birols', 'uploads', 'hooks', 'images'];
const UPLOADS_CAT = '__uploads__';
const UNCAT = '__uncat__';

// ── Reading ─────────────────────────────────────────────────────────────────
const _isLib = (s) => typeof s === 'string' && (s.startsWith('/media/') || s.startsWith('/projects/'));
const _clean = (s) => String(s).split(/[?#]/)[0];
const _abs = (root, url) => path.join(root, _clean(url).replace(/^\/+/, ''));
const _json = (abs, d) => { try { return JSON.parse(fs.readFileSync(abs, 'utf8')); } catch (e) { return d; } };
const _names = (abs) => { try { return fs.readdirSync(abs); } catch (e) { return []; } };
const _isFile = (abs) => { try { return fs.statSync(abs).isFile(); } catch (e) { return false; } };
const _isDir = (abs) => { try { return fs.statSync(abs).isDirectory(); } catch (e) { return false; } };
const _stem = (n) => n.replace(/\.[^.]+$/, '');
const _arr = (v) => (Array.isArray(v) ? v : []);

// Every file under a folder of the library, as addresses.
function _walk(root, rel) {
  const out = [];
  (function walk(dirAbs, url) {
    let ents = [];
    try { ents = fs.readdirSync(dirAbs, { withFileTypes: true }); } catch (e) { return; }
    for (const d of ents) {
      if (d.isDirectory()) walk(path.join(dirAbs, d.name), `${url}${d.name}/`);
      else if (d.isFile()) out.push(`${url}${d.name}`);
    }
  })(path.join(root, rel), `/${rel}/`);
  return out;
}

function _hasFile(dirAbs) {
  let ents = [];
  try { ents = fs.readdirSync(dirAbs, { withFileTypes: true }); } catch (e) { return false; }
  return ents.some((d) => d.isFile() || (d.isDirectory() && _hasFile(path.join(dirAbs, d.name))));
}

// The stores under `base` - a library, or the copy of its stores: data/*.json by name, and the
// layout 6 files in projects/ by their path there.
function _readStores(base) {
  const data = {};
  for (const f of _names(path.join(base, 'data'))) {
    if (!f.endsWith('.json') || UNTOUCHED.has(f)) continue;
    const v = _json(path.join(base, 'data', f), undefined);
    if (v !== undefined) data[f] = v;
  }
  const docs = {};
  for (const d of _names(path.join(base, 'projects'))) {
    const rec = path.join(base, 'projects', d, 'project.json');
    if (_isFile(rec)) { const v = _json(rec, undefined); if (v !== undefined) docs[`projects/${d}/project.json`] = v; }
    for (const f of _names(path.join(base, 'projects', d, 'merge'))) {
      if (!f.toLowerCase().endsWith('.json')) continue;
      const v = _json(path.join(base, 'projects', d, 'merge', f), undefined);
      if (v !== undefined) docs[`projects/${d}/merge/${f}`] = v;
    }
  }
  return { data, docs };
}

// Every library address in a value - strings and object keys. `into` is a Set.
function _paths(v, into) {
  if (typeof v === 'string') { if (_isLib(v)) into.add(_clean(v)); return into; }
  if (Array.isArray(v)) { for (const x of v) _paths(x, into); return into; }
  if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { if (_isLib(k)) into.add(_clean(k)); _paths(x, into); }
  return into;
}

// The addresses a store USES (WHAT COUNTS AS A USE, above).
function _uses(name, v, into) {
  if (NOT_USES.has(name) || v == null) return into;
  if (name === 'biroly.json') return _paths(v.archive, into);
  if (name === 'ui-state.json') {
    for (const [k, x] of Object.entries(v)) {
      if (DEAD_UI_KEYS.has(k) || typeof x !== 'string' || !/\/(media|projects)\//.test(x)) continue;
      let parsed;
      try { parsed = JSON.parse(x); } catch (e) { parsed = x; }
      _paths(parsed, into);
    }
    return into;
  }
  return _paths(v, into);
}

function _usesAll({ data, docs }) {
  const used = new Set();
  for (const [f, v] of Object.entries(data)) _uses(f, v, used);
  for (const v of Object.values(docs)) _paths(v, used);
  return used;
}

// Which layout a library is in: 6, 5, or 0 for an empty one.
function layoutOf(root) {
  const mark = _json(path.join(root, MARKER), null);
  if (mark && mark.upgrading) return 5;
  if (mark && Number(mark.layout) >= LAYOUT) return LAYOUT;
  const data = _names(path.join(root, 'data'));
  const old = OLD_STORES.some((f) => data.includes(f));
  // Made by layout 6 before there was a mark.
  if (!old && (data.includes('project-list.json') || data.includes('merge.json'))) return LAYOUT;
  if (old || data.some((f) => f.endsWith('.json') && !UNTOUCHED.has(f))) return 5;
  return _hasFile(path.join(root, 'media')) ? 5 : 0;
}

// ── The plan ────────────────────────────────────────────────────────────────
// Reads only. `backup` is the library-relative folder for the copy and for what is set aside.
function plan(root, { backup }) {
  const stores = _readStores(root);
  const { data, docs } = stores;
  const exists = (url) => _isFile(_abs(root, url));
  const report = { projects: 0, timelines: 0, mergeProjects: 0, newCategories: 0, place: {}, inPlace: 0, kept: 0,
    unreferenced: 0, unreferencedBytes: 0, unreferencedBy: {} };
  const used = _usesAll(stores);

  // Names handed out, per destination folder, seeded from the disk for a folder that exists. A
  // stem is kept unique as well: x.mp4 and x.jpg in one folder would share thumbs/x.jpg.
  const slots = new Map();
  const slot = (dir) => {
    let s = slots.get(dir);
    if (!s) {
      s = { names: new Set(), stems: new Set() };
      for (const n of _names(_abs(root, dir))) { s.names.add(n.toLowerCase()); s.stems.add(_stem(n).toLowerCase()); }
      slots.set(dir, s);
    }
    return s;
  };
  const take = (dir, n) => { const s = slot(dir); s.names.add(n.toLowerCase()); s.stems.add(_stem(n).toLowerCase()); };
  const freeName = (dir, file) => {
    const s = slot(dir);
    const ok = (n) => !s.names.has(n.toLowerCase()) && !s.stems.has(_stem(n).toLowerCase());
    if (ok(file)) return file;
    const stem = _stem(file);
    const ext = file.slice(stem.length);
    for (let i = 2; ; i++) if (ok(`${stem}_${i}${ext}`)) return `${stem}_${i}${ext}`;
  };

  // What lives beside a file and belongs to it: [its address, its name beside the file's new name].
  // A poster some old renders kept loose beside them goes into thumbs/, where lib/video-thumb.js
  // looks - the renders shelf calls a render without one there unreadable.
  const siblings = (src, name) => {
    const dir = path.posix.dirname(src);
    const stem = _stem(path.posix.basename(src));
    const to = _stem(name);
    return [
      [`${dir}/thumbs/${stem}.jpg`, `thumbs/${to}.jpg`],
      [`${dir}/thumbs/${stem}_thumb.jpg`, `thumbs/${to}_thumb.jpg`],
      [`${dir}/preview/${stem}.jpg`, `preview/${to}.jpg`],
      [`${dir}/${stem}_thumb.jpg`, `thumbs/${to}_thumb.jpg`],
      [`${src}.norm`, `${name}.norm`],
    ];
  };

  const assign = new Map();          // address -> its address after the upgrade
  function claim(url, destDir, bucket) {
    if (!_isLib(url)) return null;
    const src = _clean(url);
    if (assign.has(src)) return assign.get(src);
    if (src.startsWith('/projects/') || !exists(src)) return null;
    const home = `${path.posix.dirname(src)}/` === destDir;
    const name = home ? path.posix.basename(src) : freeName(destDir, path.posix.basename(src));
    take(destDir, name);
    assign.set(src, destDir + name);
    if (home) report.inPlace++; else report.place[bucket] = (report.place[bucket] || 0) + 1;
    for (const [s, rel] of siblings(src, name)) {
      if (assign.has(s) || !exists(s)) continue;
      const d = destDir + rel;
      const sub = `${path.posix.dirname(d)}/`;
      const base = path.posix.basename(d);
      // One of that name is there already: this one stays behind, and is made again when needed.
      if (d !== s && slot(sub).names.has(base.toLowerCase())) continue;
      take(sub, base);
      assign.set(s, d);
    }
    return destDir + name;
  }

  // Project folders: unique among each other and whatever projects/ holds already.
  const folders = new Set(_names(path.join(root, 'projects')).map((n) => n.toLowerCase()));
  const newFolder = (name, fallback) => {
    const f = uniqueName(folderName(name, fallback), folders);
    folders.add(f.toLowerCase());
    return f;
  };

  // ── 1. Scenarios projects, oldest first ──
  const projects = _arr(data['scen3-projects.json']);
  const planProjects = [];            // [index in the old store, id, folder]
  const folderOfProject = new Map();
  const ids = new Set(Object.entries(docs).filter(([rel, v]) => rel.endsWith('/project.json') && v && v.id != null).map(([, v]) => String(v.id)));
  const byAge = projects.map((p, i) => ({ p, i })).filter((x) => x.p && typeof x.p === 'object')
    .sort((a, b) => String(a.p.createdAt || '').localeCompare(String(b.p.createdAt || '')) || a.i - b.i);
  let fresh = Date.now();
  for (const { p, i } of byAge) {
    let id = p.id != null ? String(p.id) : '';
    if (!id || ids.has(id)) id = String(fresh++);          // a second record with the same id gets its own
    ids.add(id);
    const folder = newFolder(p.name, 'project');
    if (p.id != null && !folderOfProject.has(String(p.id))) folderOfProject.set(String(p.id), folder);
    planProjects.push([i, id, folder]);
    const base = `/projects/${folder}/`;
    for (const l of _arr(p.lines)) {
      if (!l) continue;
      for (const v of ['plain', 'tagged']) {
        const a = l.audio && l.audio[v];
        if (a && a.path) claim(a.path, `${base}voice/`, 'project voice');
        for (const t of _arr(l.video && l.video[v])) {
          if (!t) continue;
          if (t.path) claim(t.path, `${base}clips/`, 'project clips');
          if (t.thumb) claim(t.thumb, `${base}clips/thumbs/`, 'project clips');
          if (t.fromAudio) claim(t.fromAudio, `${base}voice/`, 'project voice');
        }
      }
      if (l.render && l.render.fromAudio) claim(l.render.fromAudio, `${base}voice/`, 'project voice');
    }
    for (const v of _arr(p.mix && p.mix.variants)) {
      if (!v) continue;
      if (v.path) claim(v.path, `${base}frames/`, 'project frames');
      if (v.preview) claim(v.preview, `${base}frames/preview/`, 'project frames');
    }
    for (const c of _arr(p.reel && p.reel.clips)) if (c && c.path) claim(c.path, `${base}clips/`, 'project clips');
  }
  report.projects = planProjects.length;

  // ── Timelines: sent from Scenarios, in that project's folder; a copy, beside what it was copied
  //    from; made in Merge, in a Merge project folder of its own (lib/merge-store.js) ──
  const merge = data['merge-v3.json'] || {};
  const timelines = merge.timelines && typeof merge.timelines === 'object' ? merge.timelines : {};
  const haveKeys = new Set(Object.entries(docs).filter(([rel, v]) => rel.includes('/merge/') && v && v.key).map(([, v]) => String(v.key)));
  const tlKeys = Object.keys(timelines).filter((k) => timelines[k] && typeof timelines[k] === 'object' && !haveKeys.has(k))
    .sort((a, b) => String(timelines[a].createdAt || '').localeCompare(String(timelines[b].createdAt || '')));
  const tlSet = new Set(tlKeys);
  const tlFolder = new Map();
  const mergeProjects = [];
  const placing = new Set();
  const placeTimeline = (key) => {
    if (tlFolder.has(key)) return tlFolder.get(key);
    const t = timelines[key];
    let folder = null;
    const m = /^sv3_([^_]+)(?:_\d+)?$/.exec(key);
    if (m) folder = folderOfProject.get(m[1]) || null;
    if (!folder && t.from && tlSet.has(String(t.from)) && !placing.has(key)) {
      placing.add(key);
      folder = placeTimeline(String(t.from));
      placing.delete(key);
    }
    if (!folder) {
      folder = newFolder(t.title || 'Untitled', 'merge project');
      mergeProjects.push({ id: key, name: String(t.title || ''), folder, kind: 'merge', createdAt: t.createdAt || null, updatedAt: t.updatedAt || null });
    }
    tlFolder.set(key, folder);
    return folder;
  };
  const planTimelines = [];           // [key, folder, file]
  for (const key of tlKeys) {
    const folder = placeTimeline(key);
    const s = slot(`/projects/${folder}/merge/`);
    const base = folderName(timelines[key].title, 'timeline');
    let file = `${base}.json`;
    for (let i = 2; s.names.has(file.toLowerCase()); i++) file = `${base}_${i}.json`;
    s.names.add(file.toLowerCase());
    planTimelines.push([key, folder, file]);
  }
  report.timelines = planTimelines.length;
  report.mergeProjects = mergeProjects.length;

  // ── 2. Shelves ──
  const oldCats = data['library-cats.json'] || {};
  const cats = {};
  for (const k of SHELF_KINDS) cats[k] = { own: [], order: _arr((oldCats[k] || {}).order).map(String), hidden: _arr((oldCats[k] || {}).hidden).map(String) };
  const addCat = (kind, id, label, folder, isNew) => {
    const list = cats[kind].own;
    const have = list.find((c) => c.id === String(id));
    if (have) return have;
    const name = String(label || '').trim().slice(0, 60) || String(id);
    const taken = list.map((c) => c.folder).concat([NOCAT]);
    const f = folder && !taken.some((t) => t.toLowerCase() === String(folder).toLowerCase())
      ? String(folder) : uniqueName(folderName(name, 'category'), taken);
    const cat = { id: String(id), label: name, folder: f };
    list.push(cat);
    if (isNew) report.newCategories++;
    return cat;
  };
  for (const k of SHELF_KINDS) for (const c of _arr((oldCats[k] || {}).own)) if (c && c.id) addCat(k, c.id, c.label, c.folder, false);
  const bir = data['biroly.json'] || {};
  const genCats = new Map(_arr(bir.cats).filter((c) => c && c.id != null).map((c) => [String(c.id), c]));
  // The generator's categories showed on the Library's Birols shelf unless hidden there.
  for (const [id, c] of genCats) if (!cats.birols.hidden.includes(id)) addCat('birols', id, c.label || c.name || id, null, true);
  const catDir = (kind, rec) => {
    const id = String((rec && rec.categoryId) || '');
    if (!id || id === UNCAT || id === UPLOADS_CAT) return `/media/${kind}/${NOCAT}/`;
    let cat = cats[kind].own.find((c) => c.id === id);
    if (!cat) {
      const g = kind === 'birols' ? genCats.get(id) : null;
      cat = addCat(kind, id, (g && (g.label || g.name)) || (rec && rec.categoryLabel) || id, null, true);
    }
    return `/media/${kind}/${cat.folder}/`;
  };
  // Pictures first: a still both on the Images shelf and the source of a clip belongs to Images.
  for (const e of _arr(data['images.json'])) if (e && e.imagePath) claim(e.imagePath, catDir('images', e), 'images');
  const isUpload = (e) => !!(e && (e.source === 'upload' || e.categoryId === UPLOADS_CAT));
  for (const e of _arr(bir.archive)) {
    if (!e || typeof e !== 'object') continue;
    const kind = isUpload(e) ? 'uploads' : 'birols';
    const dir = catDir(kind, e);
    if (e.videoPath) claim(e.videoPath, dir, kind);
    if (e.thumbPath) claim(e.thumbPath, `${dir}thumbs/`, kind);
    if (e.imagePath) claim(e.imagePath, /\/thumbs\//.test(e.imagePath) ? `${dir}thumbs/` : dir, kind);
  }
  for (const e of _arr(data['hooks-archive.json'])) {
    if (!e || typeof e !== 'object') continue;
    const dir = catDir('hooks', e);
    if (e.videoPath) claim(e.videoPath, dir, 'hooks');
    if (e.thumbPath) claim(e.thumbPath, `${dir}thumbs/`, 'hooks');
  }
  for (const k of Object.keys((data['hook-ids.json'] || {}).byPath || {})) {
    if (used.has(_clean(k))) claim(k, `/media/hooks/${NOCAT}/`, 'hooks');
  }
  for (const k of SHELF_KINDS) {
    const own = new Set(cats[k].own.map((c) => c.id));
    const order = cats[k].order.filter((id, i, a) => own.has(id) && a.indexOf(id) === i);
    for (const c of cats[k].own) if (!order.includes(c.id)) order.push(c.id);
    cats[k].order = order;
  }

  // ── 3. Looks keep their pictures in their folders ──
  const lookFolders = new Set();
  for (const o of _arr(data['obrazy.json'])) {
    const m = o && /^\/media\/looks\/([^/]+)\//.exec(String(o.char || ''));
    if (!m) continue;
    lookFolders.add(m[1].toLowerCase());
    const dir = `/media/looks/${m[1]}/`;
    for (const u of [..._arr(o.variations), ..._arr(o.pool).map((x) => x && x.file)]) {
      if (_isLib(u) && !_clean(u).startsWith(dir)) claim(u, dir, 'looks');
    }
  }

  // ── 4. Renders, by the title in the file name ──
  // routes/ffmpeg.js named one local_<ms>_<the title made safe, cut at 100>.mp4. A timeline's title
  // is the day it was sent plus its project's name, so a render is matched to a timeline's title,
  // or to a project's name with or without a date in front - and only when exactly one folder
  // answers. Two projects of one name leave their renders in nocat.
  const oldLabel = (t) => String(t || '').replace(/[\\/:*?"<>|]/g, '-').replace(/[#?&%]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 100);
  const norm = (s) => String(s || '').toLowerCase().replace(/[—–]/g, '-').replace(/\s+/g, ' ').trim()
    .replace(/^mig - /, '').replace(/ \(\d+\)$/, '');
  const undated = (s) => s.replace(/^\d{4}-\d{2}-\d{2} - /, '');
  const answers = new Map();          // normalized title -> Set of folders
  const answer = (text, folder) => {
    for (const k of new Set([norm(oldLabel(text)), undated(norm(oldLabel(text)))])) {
      if (!k) continue;
      if (!answers.has(k)) answers.set(k, new Set());
      answers.get(k).add(folder);
    }
  };
  for (const [key, folder] of tlFolder) answer(timelines[key].title, folder);
  for (const [i, , folder] of planProjects) answer(projects[i].name, folder);
  const onlyOne = (set) => (set && set.size === 1 ? [...set][0] : null);
  for (const f of _names(path.join(root, 'media', 'renders'))) {
    if (!VIDEO.test(f) || !_isFile(path.join(root, 'media', 'renders', f))) continue;
    const m = /^local_\d+_(.+)\.[^.]+$/.exec(f);
    const raw = m ? m[1] : _stem(f);
    const label = norm(raw);
    let folder = null;
    for (const k of [label, undated(label)]) {
      if (folder || k.length < 8) continue;
      const exact = answers.get(k);
      if (exact) { folder = onlyOne(exact); continue; }
      // Cut at 100 characters: the start of a longer title.
      if (raw.length >= 100) {
        const hits = new Set();
        for (const [t, fo] of answers) if (t.startsWith(k)) for (const x of fo) hits.add(x);
        folder = onlyOne(hits);
      }
    }
    claim(`/media/renders/${f}`, `/media/renders/${folder || NOCAT}/`, 'renders');
  }

  // ── 5. What stays, and what else is used ──
  const charFolders = new Set(_arr(data['characters.json']).map((c) => c && c.folder).filter(Boolean).map((f) => String(f).toLowerCase()));
  const stays = (url) => {
    let m = /^\/media\/characters\/([^/]+)\/./.exec(url);
    if (m && charFolders.has(m[1].toLowerCase())) return true;
    m = /^\/media\/looks\/([^/]+)\/./.exec(url);
    if (m && lookFolders.has(m[1].toLowerCase())) return true;
    // Shelves read straight from their folders: lookbooks, locations, and renders already filed in
    // a project's folder.
    return /^\/media\/(lookbooks|locations)\//.test(url) || /^\/media\/renders\/(?!thumbs\/)[^/]+\/./.test(url);
  };
  const IN_PLACE = /^\/media\/(sources|audio|voice\/demos|characters|looks)\//;
  for (const u of used) {
    if (assign.has(u) || !u.startsWith('/media/') || stays(u) || IN_PLACE.test(u) || !exists(u)) continue;
    claim(u, '/media/work/', 'work');
  }

  // ── Everything else in media/ ──
  const kept = new Set();
  for (const u of used) {
    if (assign.has(u) || !(stays(u) || IN_PLACE.test(u))) continue;
    kept.add(u.toLowerCase());
    for (const [s] of siblings(u, path.posix.basename(u))) kept.add(s.toLowerCase());
  }
  // Where a file set aside goes: its old path without media/, every folder name cut to 60
  // characters. The old editor's project folders ran past a hundred, and under backups/ their
  // files would lie deeper than the 260 characters Explorer can still delete.
  const asideDirs = new Map();       // old folder (lowercase) -> its folder in unreferenced/
  const asideTaken = new Map();      // folder in unreferenced/ (lowercase) -> names used in it
  const asidePath = (url) => {
    const parts = url.split('/').slice(2);
    const file = parts.pop();
    let dir = '';
    let orig = '';
    for (const seg of parts) {
      orig += `/${seg.toLowerCase()}`;
      let short = asideDirs.get(orig);
      if (short === undefined) {
        let name = seg.length > 60 ? seg.slice(0, 60).replace(/[\s._-]+$/, '') : seg;
        const taken = asideTaken.get(dir.toLowerCase()) || new Set();
        asideTaken.set(dir.toLowerCase(), taken);
        for (let i = 2; taken.has(name.toLowerCase()); i++) name = `${seg.slice(0, 55).replace(/[\s._-]+$/, '')} (${i})`;
        taken.add(name.toLowerCase());
        short = `${dir}/${name}`;
        asideDirs.set(orig, short);
      }
      dir = short;
    }
    return `/${backup}/unreferenced${dir}/${file}`;
  };
  const assigned = new Set([...assign.keys()].map((s) => s.toLowerCase()));
  const unreferenced = [];
  for (const url of _walk(root, 'media')) {
    const low = url.toLowerCase();
    if (assigned.has(low)) continue;
    if (stays(url) || kept.has(low)) { report.kept++; continue; }
    unreferenced.push([url, asidePath(url)]);
    report.unreferenced++;
    let size = 0;
    try { size = fs.statSync(_abs(root, url)).size; } catch (e) { /* gone */ }
    report.unreferencedBytes += size;
    // Grouped for the report by kind, and by the derived folders inside one.
    const parts = url.split('/');
    const top = parts.length > 4 && /^(thumbs|preview|demos|faces|scenes|options|details|archive)$/.test(parts[3]) ? `${parts[2]}/${parts[3]}` : `${parts[2]}/`;
    const b = report.unreferencedBy[top] || (report.unreferencedBy[top] = { files: 0, bytes: 0 });
    b.files++;
    b.bytes += size;
  }

  const moves = [...assign].filter(([s, d]) => s !== d);
  return { layout: LAYOUT, backup, moves, unreferenced, projects: planProjects, timelines: planTimelines, mergeProjects, cats, report };
}

// ── The stores after the upgrade ────────────────────────────────────────────
function _mapper(map) {
  return (s) => {
    if (!_isLib(s)) return s;
    const cut = s.search(/[?#]/);
    const clean = cut >= 0 ? s.slice(0, cut) : s;
    const hit = map.get(clean);
    return hit ? hit + (cut >= 0 ? s.slice(cut) : '') : s;
  };
}
function _rewrite(v, m) {
  if (typeof v === 'string') return m(v);
  if (Array.isArray(v)) return v.map((x) => _rewrite(x, m));
  if (v && typeof v === 'object') { const o = {}; for (const [k, x] of Object.entries(v)) o[m(k)] = _rewrite(x, m); return o; }
  return v;
}

// From `stores` - the copy taken before anything moved - and `map`, address -> address for the
// files now at their new place: { writes: { library path: value }, deletes: [library path] }.
function buildStores(stores, p, map) {
  const m = _mapper(map);
  const rw = (v) => _rewrite(v, m);
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const { data, docs } = stores;
  const writes = {};

  for (const [f, v] of Object.entries(data)) {
    if (v == null || OLD_STORES.includes(f) || f === 'project-list.json' || f === 'merge.json') continue;
    let next;
    if (f === 'ui-state.json') {
      next = {};
      for (const [k, x] of Object.entries(v)) {
        if (BLOCKED_UI_KEYS.has(k)) continue;
        if (typeof x !== 'string' || !/\/(media|projects)\//.test(x)) { next[k] = x; continue; }
        let parsed;
        try { parsed = JSON.parse(x); } catch (e) { parsed = undefined; }
        if (parsed && typeof parsed === 'object') {
          const y = rw(parsed);
          next[k] = same(y, parsed) ? x : JSON.stringify(y);
        } else {
          next[k] = m(x);
        }
      }
    } else if (f === 'biroly.json' && v && typeof v === 'object' && !Array.isArray(v)) {
      // The Birols page's generator state - its slots and categories - goes with the page.
      const rest = { ...v };
      delete rest.cats;
      delete rest.slots;
      next = rw(rest);
    } else if (f === 'library-cats.json') {
      next = p.cats;
    } else {
      next = rw(v);
    }
    if (!same(next, v)) writes[`data/${f}`] = next;
  }
  if (!data['library-cats.json'] && SHELF_KINDS.some((k) => p.cats[k].own.length)) writes['data/library-cats.json'] = p.cats;
  for (const [rel, v] of Object.entries(docs)) {
    const next = rw(v);
    if (!same(next, v)) writes[rel] = next;
  }

  const old = _arr(data['scen3-projects.json']);
  const entries = [];
  for (const [i, id, folder] of p.projects) {
    if (!old[i] || typeof old[i] !== 'object') continue;
    const rec = rw(old[i]);
    if (String(rec.id) !== id) rec.id = id;
    writes[`projects/${folder}/project.json`] = rec;
    entries.push({ i, e: { id, name: String(rec.name || ''), folder, kind: 'scenarios', createdAt: rec.createdAt || null, updatedAt: rec.updatedAt || null } });
  }
  entries.sort((a, b) => a.i - b.i);             // the old store's order is the order the page shows

  const merge = data['merge-v3.json'] || {};
  const hidden = new Set(_arr(merge.hidden).map(String));
  for (const [key, folder, file] of p.timelines) {
    const t = (merge.timelines || {})[key];
    if (!t || typeof t !== 'object') continue;
    const doc = { key, ...rw(t) };
    const snap = (merge.snapshots || {})[key];
    if (snap) doc.snapshot = rw(snap);
    if ((merge.volRule || {})[key] != null) doc.volRule = merge.volRule[key];
    if (hidden.has(key)) doc.hidden = true;
    writes[`projects/${folder}/merge/${file}`] = doc;
  }

  const listed = data['project-list.json'] && Array.isArray(data['project-list.json'].projects) ? data['project-list.json'].projects : [];
  const newIds = new Set([...entries.map((x) => x.e.id), ...p.mergeProjects.map((x) => String(x.id))]);
  writes['data/project-list.json'] = { projects: [...entries.map((x) => x.e), ...p.mergeProjects, ...listed.filter((e) => e && !newIds.has(String(e.id)))] };
  const state = data['merge.json'] || {};
  writes['data/merge.json'] = {
    version: Math.max(Number(merge.version) || 0, Number(state.version) || 0),
    updatedAt: merge.updatedAt || state.updatedAt || null,
  };
  const deletes = OLD_STORES.filter((f) => f in data).map((f) => `data/${f}`);
  return { writes, deletes };
}

// ── Carrying it out ─────────────────────────────────────────────────────────
const _pause = new Int32Array(new SharedArrayBuffer(4));
const _sleep = (ms) => { Atomics.wait(_pause, 0, 0, ms); };
const BUSY = new Set(['EPERM', 'EACCES', 'EBUSY']);

function _moveFile(root, fromUrl, toUrl) {
  const from = _abs(root, fromUrl);
  const to = _abs(root, toUrl);
  const hasFrom = fs.existsSync(from);
  const hasTo = fs.existsSync(to);
  if (!hasFrom) return { state: hasTo ? 'already' : 'missing' };
  if (hasTo) return { state: 'clash' };
  for (let attempt = 1; ; attempt++) {
    try {
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.renameSync(from, to);
      return { state: 'moved' };
    } catch (e) {
      if (e.code === 'EXDEV') {
        fs.copyFileSync(from, to);
        fs.unlinkSync(from);
        return { state: 'moved' };
      }
      if (BUSY.has(e.code) && attempt < 5) { _sleep(100 * attempt); continue; }
      return { state: 'failed', error: `${e.code || 'error'}: ${e.message}` };
    }
  }
}

// Empty folders under media/ go, except each kind's own: lib/config.js makes those at start and
// writers count on them.
function _dropEmptyDirs(root) {
  const keep = new Set([path.join(root, 'media'), ...KINDS.map((k) => path.join(root, 'media', k))].map((d) => path.resolve(d).toLowerCase()));
  (function sweep(dirAbs) {
    let ents = [];
    try { ents = fs.readdirSync(dirAbs, { withFileTypes: true }); } catch (e) { return; }
    for (const d of ents) if (d.isDirectory()) sweep(path.join(dirAbs, d.name));
    if (keep.has(path.resolve(dirAbs).toLowerCase())) return;
    try { if (fs.readdirSync(dirAbs).length === 0) fs.rmdirSync(dirAbs); } catch (e) { /* in use */ }
  })(path.join(root, 'media'));
}

// Two caches are keyed by a file's full path and modified time: the Merge preview's proxies
// (routes/ffmpeg.js, _proxyCachePath, in the scratch folder) and /api/thumb's sizes (lib/thumbs.js,
// thumbPath, in cache/thumbs/). Moved files would have both made again - a thousand clips
// transcoded in the background, every card resized when first seen - so the entries are renamed
// to the keys the new paths give. The formulas are repeated here; should one change there, its
// cache is simply made again. `done` maps addresses of files now at their new place.
function _carryCaches(root, done) {
  const hash = (algo, s) => crypto.createHash(algo).update(s).digest('hex');
  const films = [];
  const stills = [];
  for (const [from, to] of done) {
    const a = _abs(root, from);
    const b = _abs(root, to);
    let st;
    try { st = fs.statSync(b); } catch (e) { continue; }      // a rename keeps the time
    if (/\.(mp4|mov|webm|m4v)$/i.test(b)) films.push([a, b, Math.floor(st.mtimeMs)]);
    else if (/\.(jpe?g|png|webp)$/i.test(b)) stills.push([a, b, st.mtimeMs]);
  }
  const moved = { proxies: 0, thumbs: 0 };
  const rename = (dir, names, from, to, kind) => {
    if (!names.has(from) || names.has(to)) return;
    try {
      fs.renameSync(path.join(dir, from), path.join(dir, to));
      names.delete(from);
      names.add(to);
      moved[kind]++;
    } catch (e) { /* made again when it is next needed */ }
  };

  const scratch = path.join(os.tmpdir(), `ugc-studio-${hash('sha1', path.resolve(root).toLowerCase()).slice(0, 10)}`);
  const pdir = path.join(scratch, 'temp_files', 'preview_proxies');
  const proxies = new Set(_names(pdir));
  if (proxies.size) {
    for (const [a, b, mtime] of films) {
      for (const h of [360, 480, 720]) {
        for (const rev of [false, true]) {
          const tail = `_${h}${rev ? '_rev' : ''}.mp4`;
          const key = (abs) => hash('md5', `${abs}|${mtime}|h${h}${rev ? '|rev' : ''}`) + tail;
          rename(pdir, proxies, key(a), key(b), 'proxies');
        }
      }
    }
  }

  const tdir = path.join(root, 'cache', 'thumbs');
  for (const gen of _names(tdir)) {
    for (const variant of _names(path.join(tdir, gen))) {
      const vdir = path.join(tdir, gen, variant);
      const names = _isDir(vdir) ? new Set(_names(vdir)) : new Set();
      if (!names.size) continue;
      for (const [a, b, mtimeMs] of stills) {
        const key = (abs) => hash('sha1', `${abs}|${mtimeMs}|${variant}`).slice(0, 20);
        for (const ext of ['.jpg', '.webp']) rename(vdir, names, key(a) + ext, key(b) + ext, 'thumbs');
      }
    }
  }
  return moved;
}

function apply(root, p, log = () => {}) {
  const t0 = Date.now();
  const counts = { moved: 0, already: 0, missing: 0, clash: 0, failed: 0 };
  const failures = [];
  const done = new Map();
  const all = [...p.moves.map(([f, t]) => [f, t, true]), ...p.unreferenced.map(([f, t]) => [f, t, false])];
  let n = 0;
  for (const [from, to, isUsed] of all) {
    const r = _moveFile(root, from, to);
    counts[r.state]++;
    if (r.state === 'moved' || r.state === 'already') {
      if (isUsed) done.set(from, to);
    } else if (r.state === 'failed' || r.state === 'clash') {
      failures.push({ from, to, why: r.error || 'the destination is taken' });
    }
    if (++n % 2500 === 0) log(`[upgrade] ${n} of ${all.length} files`);
  }
  let carried = { proxies: 0, thumbs: 0 };
  try { carried = _carryCaches(root, done); } catch (e) { log(`[upgrade] caches not carried over (${e.message}) - they are made again`); }
  const { writes, deletes } = buildStores(_readStores(path.join(root, p.backup)), p, done);
  for (const [rel, v] of Object.entries(writes)) writeFileAtomic(path.join(root, rel), JSON.stringify(v, null, 2));
  for (const rel of deletes) { try { fs.unlinkSync(path.join(root, rel)); } catch (e) { /* gone already */ } }
  _dropEmptyDirs(root);
  log(`[upgrade] ${counts.moved} files moved, ${counts.already} already in place, ${failures.length} could not move, `
    + `${counts.missing} gone before they could; ${Object.keys(writes).length} stores written; `
    + `${carried.proxies} preview proxies and ${carried.thumbs} thumbnails kept - ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  return { counts, failures };
}

// The addresses a library's stores use that name no file.
function missingPaths(root) {
  return [..._usesAll(_readStores(root))].filter((u) => !_isFile(_abs(root, u)));
}

function _copyStores(root, backupAbs) {
  fs.mkdirSync(path.join(backupAbs, 'data'), { recursive: true });
  for (const f of _names(path.join(root, 'data'))) {
    if (f.endsWith('.json') && !UNTOUCHED.has(f)) fs.copyFileSync(path.join(root, 'data', f), path.join(backupAbs, 'data', f));
  }
  for (const d of _names(path.join(root, 'projects'))) {
    const src = path.join(root, 'projects', d);
    if (!_isDir(src)) continue;
    const rels = ['project.json', ..._names(path.join(src, 'merge')).filter((f) => f.toLowerCase().endsWith('.json')).map((f) => path.join('merge', f))];
    for (const rel of rels) {
      if (!_isFile(path.join(src, rel))) continue;
      fs.mkdirSync(path.dirname(path.join(backupAbs, 'projects', d, rel)), { recursive: true });
      fs.copyFileSync(path.join(src, rel), path.join(backupAbs, 'projects', d, rel));
    }
  }
}

const README = `This folder was made when the library was upgraded to layout 6.

data/          the stores as they were before the upgrade
unreferenced/  files nothing in the library used, under their old paths in media/ (long folder
               names shortened). Look through them, and delete this folder once nothing in it
               is wanted.
plan.json      where every file went

Эта папка появилась при переводе библиотеки на раскладку 6.

data/          базы в том виде, в каком они были до перевода
unreferenced/  файлы, на которые ничего в библиотеке не ссылалось, по прежним путям в media/
               (длинные имена папок укорочены). Просмотрите их и удалите папку, когда ничего
               из неё не нужно.
plan.json      куда переехал каждый файл
`;

// The whole upgrade, as the server runs it at start. Returns what happened.
function upgrade(root, { log = () => {} } = {}) {
  const markerAbs = path.join(root, MARKER);
  const layout = layoutOf(root);
  if (layout === LAYOUT) {
    if (!_json(markerAbs, null)) writeFileAtomic(markerAbs, JSON.stringify({ layout: LAYOUT, since: new Date().toISOString() }, null, 2));
    return { layout, upgraded: false };
  }
  if (layout === 0) {
    writeFileAtomic(markerAbs, JSON.stringify({ layout: LAYOUT, since: new Date().toISOString() }, null, 2));
    return { layout: LAYOUT, upgraded: false, fresh: true };
  }

  const mark = _json(markerAbs, {}) || {};
  let p = mark.upgrading ? _json(path.join(root, mark.upgrading, 'plan.json'), null) : null;
  if (p) {
    log(`[upgrade] carrying on with the layout 6 upgrade planned in ${p.backup}`);
  } else {
    const now = new Date();
    const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    let backup = `backups/${day} layout 6`;
    for (let i = 2; fs.existsSync(path.join(root, backup)); i++) backup = `backups/${day} layout 6 (${i})`;
    const backupAbs = path.join(root, backup);
    log(`[upgrade] the library is in layout 5: upgrading it to layout 6, the stores as they are go to ${backup}`);
    _copyStores(root, backupAbs);
    fs.writeFileSync(path.join(backupAbs, 'README.txt'), README);
    const t0 = Date.now();
    p = plan(root, { backup });
    p.missingBefore = missingPaths(root);
    writeFileAtomic(path.join(backupAbs, 'plan.json'), JSON.stringify(p));
    writeFileAtomic(markerAbs, JSON.stringify({ layout: 5, upgrading: backup }, null, 2));
    const r = p.report;
    log(`[upgrade] planned in ${((Date.now() - t0) / 1000).toFixed(1)}s: ${r.projects} projects, ${r.timelines} timelines `
      + `(${r.mergeProjects} in Merge projects of their own); ${p.moves.length} files to move, `
      + `${r.unreferenced} nothing uses (${Math.round(r.unreferencedBytes / 1048576)} MB) to set aside`);
  }

  const { counts, failures } = apply(root, p, log);
  const before = new Set(p.missingBefore || []);
  const newlyMissing = missingPaths(root).filter((u) => !before.has(u));
  for (const f of failures.slice(0, 10)) log(`[upgrade] left in place: ${f.from} (${f.why})`);
  if (newlyMissing.length) log(`[upgrade] WARNING: ${newlyMissing.length} stored path(s) name no file after the upgrade, e.g. ${newlyMissing.slice(0, 5).join(', ')}`);
  writeFileAtomic(markerAbs, JSON.stringify({
    layout: LAYOUT, upgradedAt: new Date().toISOString(), backup: p.backup,
    moved: counts.moved + counts.already, setAside: p.unreferenced.length, leftInPlace: failures.length, newlyMissing: newlyMissing.length,
  }, null, 2));
  log(`[upgrade] done: layout 6. The old stores and the files nothing used are in ${p.backup}`);
  return { layout: LAYOUT, upgraded: true, backup: p.backup, counts, failures, newlyMissing, report: p.report };
}

module.exports = { MARKER, layoutOf, plan, buildStores, apply, missingPaths, upgrade, readStores: _readStores, DEAD_UI_KEYS, BLOCKED_UI_KEYS };
