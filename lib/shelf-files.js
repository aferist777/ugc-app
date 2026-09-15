'use strict';

/* shelf-files.js - where a shelf item's files live, and moving them when that changes
   (docs/local-app/PLAN.md, phase 2).

   Birols, Uploads, Hooks and Images keep one folder per category: media/<kind>/<category folder>/,
   and media/<kind>/nocat/ for an item with none (lib/library-cats.js names the folders). Renders
   keep one folder per project: media/renders/<project folder>/, nocat when the render belongs to
   no project the store knows.

   A file arrives in media/work/ (an upload, a generation) and is PLACED when it is filed on a
   shelf. After that it moves only when what it belongs to changes: its category renamed (the
   folder moves), deleted (its files go to nocat), or the item given another category or kind. A
   move carries the file's siblings (thumbs/, preview/, _thumb.jpg, .norm) and rewrites every store
   that points at it (lib/relocate.js). */

const fs = require('fs');
const path = require('path');
const { MEDIA, PROJECTS_DIR } = require('./config');
const { toDisk } = require('./media');
const { uniqueFile, uniqueName, folderName } = require('./names');
const { NOCAT } = require('./layout');
const LC = require('./library-cats');
const R = require('./relocate');

const SHELF_KINDS = ['birols', 'uploads', 'hooks', 'images'];

// ── Where ───────────────────────────────────────────────────────────────────
// The folder of a category of `kind` ({ dir, folder, url }), made if missing.
function categoryDir(kind, categoryId, label) {
  if (!SHELF_KINDS.includes(kind)) throw new Error(`not a shelf with categories: ${kind}`);
  const folder = LC.folderOf(kind, categoryId, label);
  const dir = path.join(MEDIA[kind], folder);
  const url = `/media/${kind}/${folder}/`;
  if (!fs.existsSync(dir)) {
    // A new folder under a name that once moved away: nothing under it redirects any more.
    require('./moves').forget(url);
    fs.mkdirSync(dir, { recursive: true });
  }
  return { dir, folder, url };
}

// The folder a render of the timeline `key` goes to: its project's name, nocat for none.
function rendersDir(key) {
  let folder = NOCAT;
  try {
    const at = key ? require('./merge-store').locate(key) : null;
    if (at && fs.existsSync(path.join(PROJECTS_DIR, at.folder))) folder = at.folder;
  } catch (e) { /* no store: nocat */ }
  const dir = path.join(MEDIA.renders, folder);
  fs.mkdirSync(dir, { recursive: true });
  return { dir, folder, url: `/media/renders/${folder}/` };
}

const _inside = (url, dirUrl) => String(url || '').split(/[?#]/)[0].startsWith(dirUrl);
const _libFile = (url) => {
  const u = String(url || '').split(/[?#]/)[0];
  if (!u.startsWith('/media/') && !u.startsWith('/projects/')) return null;
  const abs = toDisk(u);
  return abs && fs.existsSync(abs) ? u : null;
};

// A free address for `name` in the folder `dirUrl` (the file names already there, plus `taken`).
function _freeIn(dirUrl, name, taken) {
  let have = [];
  try { have = fs.readdirSync(toDisk(dirUrl + '.')); } catch (e) { /* new folder */ }
  const file = uniqueFile(name, have.concat(taken || []));
  if (taken) taken.push(file);
  return dirUrl + file;
}

// ── Placing ─────────────────────────────────────────────────────────────────
// The file moves a record of `kind` needs to sit where its category says: [fromUrl, toUrl] pairs,
// its media first, then a thumbnail or reference picture that is not a sibling of it. `taken`
// collects the names already handed out in each folder during one batch.
function _pairsFor(kind, rec, dirUrl, taken) {
  const pairs = [];
  const main = kind === 'images' ? rec.imagePath : rec.videoPath;
  const mainUrl = _libFile(main);
  if (mainUrl && !_inside(mainUrl, dirUrl)) {
    pairs.push([mainUrl, _freeIn(dirUrl, path.posix.basename(mainUrl), taken[dirUrl] = taken[dirUrl] || [])]);
  }
  // What relocate carries along by itself: the siblings of the main file.
  const sibs = new Set();
  if (mainUrl) {
    const dir = path.posix.dirname(mainUrl);
    const stem = path.posix.basename(mainUrl).replace(/\.[^.]+$/, '');
    for (const s of [`${dir}/thumbs/${stem}.jpg`, `${dir}/thumbs/${stem}_thumb.jpg`, `${dir}/preview/${stem}.jpg`]) sibs.add(s);
  }
  const extras = kind === 'images' ? [] : [rec.thumbPath, rec.imagePath];
  for (const x of extras) {
    const u = _libFile(x);
    if (!u || u === mainUrl || sibs.has(u) || _inside(u, dirUrl)) continue;
    if (pairs.some(([from]) => from === u)) continue;
    // A thumbnail goes to the folder's thumbs/, anything else beside the media.
    const into = /\/thumbs\//.test(u) ? `${dirUrl}thumbs/` : dirUrl;
    pairs.push([u, _freeIn(into, path.posix.basename(u), taken[into] = taken[into] || [])]);
  }
  return pairs;
}

// Move the files of shelf records to their category folders, in one relocation: one pass over
// the stores however many records. `items` is [{ kind, rec }]. Returns the address pairs moved.
function placeRecords(items) {
  const taken = {};
  const files = [];
  for (const { kind, rec } of items || []) {
    if (!rec) continue;
    const folderKind = kind === 'uploads' ? 'uploads' : kind;
    const { url } = categoryDir(folderKind, rec.categoryId, rec.categoryLabel);
    for (const p of _pairsFor(folderKind, rec, url, taken)) {
      if (!files.some(([from]) => from === p[0])) files.push(p);
    }
  }
  if (!files.length) return [];
  return R.relocate({ files }).pairs;
}

// A file nothing points at yet - just uploaded or generated into media/work/ - moved into the
// folder of `kind` and category, with its siblings, without touching any store. Returns its new
// address.
function placeNew(url, kind, categoryId, label) {
  const from = _libFile(url);
  if (!from) return url;
  const { url: dirUrl } = categoryDir(kind, categoryId, label);
  if (_inside(from, dirUrl)) return from;
  const to = _freeIn(dirUrl, path.posix.basename(from));
  R.moveFile(from, to);
  return to;
}

// ── Categories ──────────────────────────────────────────────────────────────
// Rename a category: the label changes and its folder moves with every path under it.
function renameCategory(kind, id, label) {
  const before = LC.find(kind, id);
  const { cat, from } = LC.rename(kind, id, label);
  const base = `/media/${kind}/`;
  try {
    _moveCategoryFolder(kind, base, from, cat);
  } catch (e) {
    // The folder did not move, so neither does the name: the list goes back to what it was.
    if (before) {
      const state = LC.read();
      const entry = state[kind].own.find(c => c.id === before.id);
      if (entry) { entry.label = before.label; entry.folder = before.folder; LC.write(state); }
    }
    throw e;
  }
  return cat;
}

function _moveCategoryFolder(kind, base, from, cat) {
  if (from && from !== cat.folder && fs.existsSync(path.join(MEDIA[kind], from))) {
    if (from.toLowerCase() === cat.folder.toLowerCase()) {
      // Only the case changed: Windows sees one name, so go through a temporary one.
      const tmp = uniqueName(folderName(cat.folder + ' ~'), fs.readdirSync(MEDIA[kind]));
      R.relocate({ folders: [[`${base}${from}/`, `${base}${tmp}/`]] });
      R.relocate({ folders: [[`${base}${tmp}/`, `${base}${cat.folder}/`]] });
    } else if (fs.existsSync(path.join(MEDIA[kind], cat.folder))) {
      // The new name's folder already holds files (it was nocat-named, say): move file by file.
      const fromAbs = path.join(MEDIA[kind], from);
      const files = fs.readdirSync(fromAbs).filter(f => fs.statSync(path.join(fromAbs, f)).isFile() && !/\.norm$/i.test(f));
      const taken = [];
      R.relocate({ files: files.map(f => [`${base}${from}/${f}`, _freeIn(`${base}${cat.folder}/`, f, taken)]) });
      dropEmptyFolder(kind, from);
    } else {
      R.relocate({ folders: [[`${base}${from}/`, `${base}${cat.folder}/`]] });
    }
  }
}

// Remove an empty category folder (after its files went elsewhere).
function dropEmptyFolder(kind, folder) {
  if (!folder || folder === NOCAT) return;
  const dir = path.join(MEDIA[kind], folder);
  try {
    const left = fs.readdirSync(dir).filter(f => {
      const p = path.join(dir, f);
      return !(fs.statSync(p).isDirectory() && fs.readdirSync(p).length === 0);
    });
    if (!left.length) fs.rmSync(dir, { recursive: true, force: true });
  } catch (e) { /* not there */ }
}

module.exports = { SHELF_KINDS, categoryDir, rendersDir, placeRecords, placeNew, renameCategory, dropEmptyFolder };
