// LIBRARY — the actions: rename, favourite, category, delete, upload.
//
// Every action is the server's: the endpoint writes the store and answers. (Until phase V23 this module also kept
// browser-owned copies of the archives in localStorage in step - the Birols page pushed them back every two seconds.
// That page and its sync are gone and nothing reads those keys (js/storage-sync.js blocks them), so the copies went.)

import { askName } from '../name-box.js';

const CHAR_KIND = 'characters';

async function _json(url, opts) {
  const r = await fetch(url, opts);
  const d = await r.json().catch(() => null);
  if (!d || !d.success) throw new Error((d && d.error) || ('HTTP ' + r.status));
  return d;
}

// ── Thumbnails ──────────────────────────────────────────────────────────────
// The grid draws 72px cards, but a clip can have no thumbnail at all (the card then loads
// the VIDEO to show one frame) or a "thumbnail" that is really the full 720x1280 frame.
// Both are the same symptom - a shelf that costs megabytes to look at - and the server
// already knows how to tell them apart and fix them, one clip at a time:
//   /api/media/thumbs/audit  which of these need work, by reading the image header
//   /api/media/thumb         make exactly one
// One at a time is the server's rule, not a limitation here: a sweep of the whole library
// must not saturate the box while a render is running.
// `thumb` is sent, not just the video: the card draws the RECORD's thumbnail, so that is
// what has to be judged. Asking only about the derived path called a blank card healthy.
export async function auditThumbs(items) {
  const payload = items
    // A sound has no picture to make a thumbnail of - a .webm one too (review V7).
    .filter(it => it && it.media && it.kind !== 'sounds' && /\.(mp4|webm|mov|mkv|m4v)(\?|$)/i.test(String(it.media)))
    .map(it => ({ id: it.id, video: it.media, thumb: it.thumb || '' }));
  if (!payload.length) return { need: [], link: [], ok: 0, missing: [], total: 0 };
  return _json('/api/media/thumbs/audit', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items: payload }),
  });
}

// Point a record at a thumbnail. The file alone changes nothing on the shelf - the media
// shelf reads `thumb` from the record.
async function saveThumbPath(it, thumbPath) {
  await _json(_itemUrl(it), {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ thumbPath }),
  });
  return thumbPath;
}

// The cheap half: the thumbnail is already on disk and only the record is behind. No
// transcode, so this is what runs by itself when the page opens.
export async function linkThumb(it, thumbPath) {
  return saveThumbPath(it, thumbPath);
}

// The expensive half: make the file, then remember it.
export async function fixThumb(it) {
  const d = await _json('/api/media/thumb', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ video: it.media }),
  });
  return saveThumbPath(it, d.thumbPath);
}

// ── Rename ──────────────────────────────────────────────────────────────────
// Only the shelves whose name is a LABEL and nothing else.
//   - lookbooks / environments: the name IS the filename, and look records point at
//     those filenames, so renaming the file would quietly break them.
//   - looks (obrazy): a look's folder on disk is slug(name)_shortId(id), so the name is
//     part of a path. The stored image URLs would still resolve, but anything that
//     re-derives the folder from the record would point at a folder that does not exist.
//     Renaming a look safely means moving the folder and rewriting every URL in the record;
//     that belongs with the storage rework (moves on rename), not here.
export const CAN_RENAME = new Set([CHAR_KIND, 'birols', 'uploads', 'hooks', 'sounds', 'music']);

export async function renameItem(it, anchor) {
  const next = await askName({ anchor, title: 'Rename', value: it.name || '', okLabel: 'Rename' });
  if (next == null) return null;
  const name = String(next).trim();
  if (!name || name === it.name) return null;
  if (it.kind === CHAR_KIND) {
    // characters.json has one writer and it also handles the character's voice.
    await _json('/api/char-store/' + encodeURIComponent(it.id), {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
  } else {
    await _json(_itemUrl(it), {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
  }
  return name;
}

// ── Favourite ───────────────────────────────────────────────────────────────
export async function toggleFavorite(it) {
  const favorite = !(it.meta && it.meta.favorite);
  await _json(_itemUrl(it), {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ favorite }),
  });
  return favorite;
}

// ── Category ────────────────────────────────────────────────────────────────
// Every list at once, keyed by kind. A card's dropdown must offer its OWN kind's list, and
// the All filter shows all three kinds in one grid, so one request beats one per card.
export async function loadCats() {
  try { return (await _json('/api/library/cats')).byKind || {}; } catch (e) { return {}; }
}

// ── Category vocabulary: create, rename, reorder, delete ─────────────────────
// (phase V54 block 6) A folder made where the person asked: in `parent` ('' - the kind itself). A name already there gives
// that one (created:false); a path too long is refused in words.
export async function addFolder(kind, label, parent) {
  return _json('/api/library/cats', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind, label, parent: String(parent || '') }),
  });
}

export async function addCat(kind, label) {
  const d = await _json('/api/library/cats', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind, label }),
  });
  return d;                            // { cat, created } — created:false means it existed
}

// Two outcomes, decided by the server: a Library category renames in place, while a
// Birols-tab category FORKS — a Library category takes the new name and the clips move into
// it, leaving the Birols tab's own category untouched.
export async function renameCat(kind, id, label) {
  const d = await _json('/api/library/cats/' + encodeURIComponent(id), {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind, label }),
  });
  return d;
}

// mode 'move' clears the category off its clips; mode 'delete' removes the clips and their
// files. The caller is responsible for having said which, in words, before getting here.
export async function deleteCat(kind, id, mode) {
  const d = await _json('/api/library/cats/' + encodeURIComponent(id)
    + '?kind=' + encodeURIComponent(kind) + '&media=' + (mode === 'delete' ? 'delete' : 'move'),
    { method: 'DELETE' });
  return d;
}

// Both fields go, not just the id: the label is a denormalised copy kept beside it on the record.
export async function setCategory(it, categoryId, categoryLabel) {
  await _json(_itemUrl(it), {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ categoryId, categoryLabel: categoryLabel || '' }),
  });
  return categoryId;
}

// A category that did not exist a moment ago, for one kind - (phase V54) a folder at the kind's top, or in `parent`. The
// server hands back the existing one when the name is already taken there, so asking twice is safe.
export async function createCategory(kind, label, parent) {
  const d = await _json('/api/library/cats', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind, label, parent: String(parent || '') }),
  });
  return { cat: d.cat, created: d.created !== false };
}

// ── Kind ────────────────────────────────────────────────────────────────────
// birols <-> uploads is one field in one store; anything involving hooks is a record
// moving between two files. The server does both so a move cannot land half-applied.
export const KINDS = [
  { id: 'birols',  label: 'Birol' },
  { id: 'uploads', label: 'Upload' },
  { id: 'hooks',   label: 'Hook' },
];

export async function setKind(it, kind) {
  if (kind === it.kind) return it.kind;
  await _json(_itemUrl(it) + '/kind', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind }),
  });
  return kind;
}

// ── Delete ──────────────────────────────────────────────────────────────────
// What goes with the record differs per shelf, so the confirmation says it out loud.
// A character takes its ElevenLabs voice with it (unless another character shares it) —
// that is not recoverable, so it is spelled out rather than implied.
export function deleteWarning(it) {
  if (it.kind === CHAR_KIND) {
    const n = (it.meta && it.meta.looks) || 0;
    return 'Delete the character "' + (it.name || '') + '"?\n\n'
      + 'Its record goes, and its ElevenLabs voice too unless another character uses it.\n'
      + (n ? 'Its ' + n + ' look' + (n === 1 ? '' : 's') + ' stay on the Characters shelf until deleted separately.\n' : '')
      + '\nThe character sheet file stays on disk.';
  }
  if (it.kind === 'obrazy') {
    const v = (it.meta && it.meta.variations) || 0;
    return 'Delete the look "' + (it.name || '') + '"?\n\n'
      + 'Its folder goes with it' + (v ? ' — the look image and ' + v + ' pose variation' + (v === 1 ? '' : 's') : '') + '.';
  }
  if (it.kind === 'lookbooks' || it.kind === 'environments') {
    return 'Delete the file "' + (it.name || '') + '"?\n\nThe image and its thumbnail are removed from disk.';
  }
  // A render is a finished video and the only copy: there is no record it can be rebuilt from,
  // and re-rendering costs what it cost the first time. So this warning carries the weight -
  // the size, and the fact that nothing else holds it.
  if (it.kind === 'renders') {
    const mb = (it.meta && it.meta.sizeMb) || 0;
    return 'Delete the render "' + (it.name || '') + '"?\n\n'
      + 'The video' + (mb ? ' (' + mb + ' MB)' : '') + ' and its poster are removed from disk.\n'
      + 'This is the only copy - re-rendering is the only way back.';
  }
  // (phase V7) A sound has no picture: the file alone goes.
  if (it.kind === 'sounds') return 'Delete the sound "' + (it.name || '') + '"?\n\nThe sound file is removed from disk.';
  // (phase V28.4, the owner) A track goes with its file, as everything on Media.
  if (it.kind === 'music') return 'Delete the track "' + (it.name || '') + '"?\n\nThe music file is removed from disk.';
  // (phase V59.1) A saved text of Music -> Lyrics - no file goes with it.
  if (it.kind === 'lyrics') return 'Delete the lyrics "' + (it.name || '') + '"?\n\nThe text is removed from Music → Lyrics.';
  return 'Delete "' + (it.name || '') + '"?\n\nThe clip and its thumbnail are removed from disk.';
}

// (phase V28.4, the owner 2026-10-12: "при удалении файла обязательно уведомление, что файл используется в проектах и
// список проектов") The question, with the projects whose timelines hold the file (POST /api/library/usage) - there its
// clips turn red, to be replaced or removed. A read that fails asks the plain question.
export async function deleteQuestion(it) {
  const base = deleteWarning(it);
  if (!it || !it.media || it.kind === CHAR_KIND) return base;
  let projects = [];
  try {
    const d = await _json('/api/library/usage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ media: [it.media] }) });
    projects = d.projects || [];
  } catch (e) { projects = []; }
  if (!projects.length) return base;
  const lines = projects.slice(0, 10).map(p => '  «' + p.title + '» - ' + p.clips + (p.clips === 1 ? ' clip' : ' clips'));
  if (projects.length > 10) lines.push('  … and ' + (projects.length - 10) + ' more');
  return base + '\n\nIt is used in ' + projects.length + (projects.length === 1 ? ' project' : ' projects') + ':\n' + lines.join('\n')
    + '\n\nThere its clips turn red - to be replaced or removed.';
}

export async function deleteItem(it) {
  if (it.kind === CHAR_KIND) {
    await _json('/api/char-store/' + encodeURIComponent(it.id), { method: 'DELETE' });
    return true;
  }
  await _json(_itemUrl(it), { method: 'DELETE' });
  return true;
}

// ── Upload ──────────────────────────────────────────────────────────────────
// Two steps on purpose: /api/biroly/upload owns the file and its thumbnail, and it
// deliberately does not touch the archive; the record is filed after. onEach reports
// progress so a batch of big clips does not look like a hung page.
// `kind` decides which store the record goes into — the page passes whichever kind is
// open. The FILE always lands in uploads/ whatever the kind is: the record stores its
// url rather than deriving it, so the folder carries no meaning and one upload endpoint
// (with its one thumbnail step) serves all three.
export async function uploadVideos(files, kind, onEach) {
  let ok = 0;
  const list = Array.from(files || []);
  for (let i = 0; i < list.length; i++) {
    const f = list[i];
    if (onEach) onEach(i + 1, list.length, f.name);
    try {
      const fd = new FormData();
      fd.append('video', f);
      fd.append('name', f.name.replace(/\.[^.]+$/, ''));
      const up = await _json('/api/biroly/upload', { method: 'POST', body: fd });
      await _json('/api/library/media/record', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        // trimmable: a file brought in by hand may be trimmed once, in the viewer. Nothing
        // generated carries this - those are trimmed on the timeline without a new file.
        body: JSON.stringify({ videoPath: up.videoPath, thumbPath: up.thumbPath, name: up.name, kind, trimmable: true }),
      });
      ok++;
    } catch (e) { /* one bad file must not stop the batch */ }
  }
  return { ok, total: list.length };
}

// One call per picture, not the two a video takes. data/images.json is server-owned, so
// /api/images/upload receives the file, makes the thumbnails and files the record in the same
// request.
export async function uploadImages(files, onEach) {
  let ok = 0;
  const list = Array.from(files || []);
  for (let i = 0; i < list.length; i++) {
    const f = list[i];
    if (onEach) onEach(i + 1, list.length, f.name);
    try {
      const fd = new FormData();
      fd.append('image', f);
      fd.append('name', f.name.replace(/\.[^.]+$/, ''));
      await _json('/api/images/upload', { method: 'POST', body: fd });
      ok++;
    } catch (e) { /* one bad file must not stop the batch */ }
  }
  return { ok, total: list.length };
}

// (phase V7) Sounds onto the Sounds shelf, into the category open there - one call each, like the pictures.
export async function uploadSounds(files, onEach, categoryId) {
  let ok = 0;
  const list = Array.from(files || []);
  for (let i = 0; i < list.length; i++) {
    const f = list[i];
    if (onEach) onEach(i + 1, list.length, f.name);
    try {
      const fd = new FormData();
      fd.append('sound', f);
      fd.append('name', f.name.replace(/\.[^.]+$/, ''));
      if (categoryId) fd.append('categoryId', categoryId);
      await _json('/api/sounds/upload', { method: 'POST', body: fd });
      ok++;
    } catch (e) { /* one bad file must not stop the batch */ }
  }
  return { ok, total: list.length };
}

// (phase V28.4) Music from this computer into Media -> Audio -> Music (routes/music.js; no categories) - one call each.
// (phase V54) `categoryId` - an own folder of Music to put them in ('' - Music itself).
export async function uploadMusic(files, onEach, categoryId) {
  let ok = 0;
  const list = Array.from(files || []);
  for (let i = 0; i < list.length; i++) {
    const f = list[i];
    if (onEach) onEach(i + 1, list.length, f.name);
    try {
      const fd = new FormData();
      fd.append('music', f);
      fd.append('name', f.name.replace(/\.[^.]+$/, ''));
      if (categoryId) fd.append('cat', String(categoryId));
      await _json('/api/audio/music/upload', { method: 'POST', body: fd });
      ok++;
    } catch (e) { /* one bad file must not stop the batch */ }
  }
  return { ok, total: list.length };
}

// ── Broken records ──────────────────────────────────────────────────────────
// Records whose file is not there. Every shelf hides them (each checks the file exists), so
// they are invisible but still counted - the "128 total, 127 shown" gap.
//
// Cleaning is two calls on purpose. Media records are this module's own store, but looks are
// already handled by POST /api/obrazy/prune-missing, which drops looks with no surviving image
// AND sweeps geni.json alongside; reusing it beats writing that logic twice.
export async function findBroken() {
  return _json('/api/library/broken');
}

export async function cleanBroken() {
  const out = { media: 0, looks: 0, geni: 0 };

  const d = await _json('/api/library/broken/clean', { method: 'POST' });
  out.media = d.count || 0;

  try {
    const p = await _json('/api/obrazy/prune-missing', { method: 'POST' });
    out.looks = (p.removedObrazy || []).length;
    out.geni = p.removedGeniCount || 0;
  } catch (e) { out.looksError = e.message; }

  return out;
}

// ── Duplicates ──────────────────────────────────────────────────────────────
// Records pointing at the same file, not clips that look alike — so there is nothing to
// compare visually. Reporting is free; cleaning drops the redundant records and never touches
// a file, because the copy that stays needs the same video and the same thumbnail.
export async function findDupes() {
  return _json('/api/library/dupes');
}

export async function cleanDupes() {
  return _json('/api/library/dupes/clean', { method: 'POST' });
}

// Media records live under their kind (birols / uploads / hooks); the file shelves are
// addressed by filename, which is their id.
function _itemUrl(it) {
  return '/api/library/item/' + encodeURIComponent(it.kind) + '/' + encodeURIComponent(it.id);
}
