'use strict';

/* shelf-files.js - where a shelf item's files live, and moving them when that changes.

   Birols, Uploads, Hooks, Images, My sounds, REFERENCES' own and Music keep one folder per category:
   media/<kind>/<category path>/ - folders in folders, "Products/Shoes/Summer" -, and media/<kind>/nocat/
   for an item with none (Music: media/audio/ itself; lib/library-cats.js names the folders and keeps their paths).
   Renders keep one folder per project: media/renders/<project folder>/, nocat when the render belongs to no project
   the store knows.

   A file arrives in media/work/ (an upload, a generation) and is PLACED when it is filed on a
   shelf. After that it moves only when what it belongs to changes: its category renamed or moved (the
   folder moves - lib/folders.js), deleted (its files go up a level), or the item given another category or kind. A
   move carries the file's siblings (thumbs/, preview/, _thumb.jpg, .norm) and rewrites every store
   that points at it (lib/relocate.js). */

const fs = require('fs');
const path = require('path');
const { MEDIA, PROJECTS_DIR } = require('./config');
const { toDisk } = require('./media');
const { uniqueFile } = require('./names');
const { NOCAT } = require('./layout');
const LC = require('./library-cats');
const R = require('./relocate');

const SHELF_KINDS = ['birols', 'uploads', 'hooks', 'images', 'sounds', 'references', 'music'];

// ── Where ───────────────────────────────────────────────────────────────────
// The folder of a category of `kind` ({ dir, folder, url }), made if missing - nested ones too. Music's with none is
// media/audio/ itself.
function categoryDir(kind, categoryId, label) {
  if (!SHELF_KINDS.includes(kind)) throw new Error(`not a shelf with categories: ${kind}`);
  const folder = LC.folderOf(kind, categoryId, label);
  const dir = path.join(LC.kindDir(kind), ...folder.split('/').filter(Boolean));
  const url = LC.kindUrl(kind) + (folder ? folder + '/' : '');
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

// DIRECTLY in that folder - or, for a thumbnail or a preview, in its thumbs/ or preview/. Not anywhere under it: with
// folders in folders a file of a folder's sub-folder is under it too, and must still move up when it goes there.
const _inside = (url, dirUrl) => {
  const at = path.posix.dirname(String(url || '').split(/[?#]/)[0]) + '/';
  return at === dirUrl || at === dirUrl + 'thumbs/' || at === dirUrl + 'preview/';
};
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
  const main = kind === 'images' ? rec.imagePath : (kind === 'sounds' || kind === 'music') ? rec.audioPath : rec.videoPath;
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
  const extras = (kind === 'images' || kind === 'sounds' || kind === 'music') ? [] : [rec.thumbPath, rec.imagePath];
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
// Renaming, moving and deleting one - its folder on the disk with everything under it - is lib/folders.js.

// Remove an empty category folder (after its files went elsewhere) - a nested one by its path. A folder holding only
// empty folders (thumbs/, preview/) is empty.
function dropEmptyFolder(kind, folder) {
  if (!folder || folder === NOCAT) return;
  const dir = path.join(LC.kindDir(kind), ...String(folder).split('/').filter(Boolean));
  if (path.resolve(dir) === path.resolve(LC.kindDir(kind))) return;
  try {
    const left = fs.readdirSync(dir).filter(f => {
      const p = path.join(dir, f);
      return !(fs.statSync(p).isDirectory() && fs.readdirSync(p).length === 0);
    });
    if (!left.length) fs.rmSync(dir, { recursive: true, force: true });
  } catch (e) { /* not there */ }
}

module.exports = { SHELF_KINDS, categoryDir, rendersDir, placeRecords, placeNew, dropEmptyFolder };
