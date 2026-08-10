// LIBRARY — the actions: rename, favourite, category, delete, upload.
//
// Every action is server-first: the endpoint writes the data file, and only then does
// this module patch the matching localStorage key.
//
// That second write is not belt-and-braces, it is the whole trick. biroly.json,
// hooks-archive.json and obrazy.json are owned by the BROWSER — biroly-server-sync.js
// and friends push a whole-localStorage snapshot every 2s from whatever page is open.
// Those loops hash localStorage each tick and push only when it changed, so:
//   - patch localStorage too, and an open Birols tab agrees and stays quiet;
//   - skip it, and the next edit in that tab pushes a snapshot built on the stale copy,
//     silently resurrecting whatever was deleted here.
// If the key is absent (this browser has never opened Birols) there is nothing to
// clobber and nothing to patch.

const CHAR_KIND = 'characters';

function _lsRead(key) {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return undefined;              // absent: no local copy to keep in step
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : undefined;
  } catch (e) { return undefined; }
}
function _lsPatch(key, id, patch) {
  if (!key) return;
  const list = _lsRead(key);
  if (!list) return;
  const it = list.find(x => x && String(x.id) === String(id));
  if (!it) return;
  Object.assign(it, patch);
  try { localStorage.setItem(key, JSON.stringify(list)); } catch (e) {}
}
function _lsDrop(key, id) {
  if (!key) return;
  const list = _lsRead(key);
  if (!list) return;
  const next = list.filter(x => !(x && String(x.id) === String(id)));
  if (next.length === list.length) return;
  try { localStorage.setItem(key, JSON.stringify(next)); } catch (e) {}
}
function _lsUnshift(key, rec) {
  if (!key || !rec) return;
  const list = _lsRead(key);
  if (!list) return;
  if (list.some(x => x && x.videoPath === rec.videoPath)) return;
  list.unshift(rec);
  try { localStorage.setItem(key, JSON.stringify(list)); } catch (e) {}
}

async function _json(url, opts) {
  const r = await fetch(url, opts);
  const d = await r.json().catch(() => null);
  if (!d || !d.success) throw new Error((d && d.error) || ('HTTP ' + r.status));
  return d;
}

// ── Rename ──────────────────────────────────────────────────────────────────
// Only the shelves whose name is a LABEL and nothing else.
//   - lookbooks / environments: the name IS the filename, and look records point at
//     those filenames, so renaming the file would quietly break them.
//   - looks (obrazy): a look's folder on disk is slug(name)_shortId(id), so the name is
//     part of a path. The stored image URLs would still resolve, but anything that
//     re-derives the folder from the record — lib/obrazy-store.js findObrazFolderById,
//     which the pose-variations endpoint uses to decide where to write — would point at
//     a folder that does not exist. Renaming a look safely means moving the folder and
//     rewriting every URL in the record; that belongs with the looks rework, not here.
export const CAN_RENAME = new Set([CHAR_KIND, 'birols', 'uploads', 'hooks']);

export async function renameItem(it) {
  const next = prompt('Rename', it.name || '');
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
    const d = await _json(_itemUrl(it), {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    _lsPatch(d.lsKey, it.id, { name });
  }
  return name;
}

// ── Favourite ───────────────────────────────────────────────────────────────
export async function toggleFavorite(it) {
  const favorite = !(it.meta && it.meta.favorite);
  const d = await _json(_itemUrl(it), {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ favorite }),
  });
  _lsPatch(d.lsKey, it.id, { favorite });
  return favorite;
}

// ── Category ────────────────────────────────────────────────────────────────
export async function loadCats() {
  try { return (await _json('/api/library/cats')).cats || []; } catch (e) { return []; }
}
export async function setCategory(it, categoryId, categoryLabel) {
  const d = await _json(_itemUrl(it), {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ categoryId }),
  });
  // categoryLabel is carried alongside categoryId everywhere else in the archive;
  // keep the local copy consistent with it rather than half-updated.
  _lsPatch(d.lsKey, it.id, { categoryId, categoryLabel: categoryLabel || '' });
  return categoryId;
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
  return 'Delete "' + (it.name || '') + '"?\n\nThe clip and its thumbnail are removed from disk.';
}

export async function deleteItem(it) {
  if (it.kind === CHAR_KIND) {
    await _json('/api/char-store/' + encodeURIComponent(it.id), { method: 'DELETE' });
    return true;
  }
  const d = await _json(_itemUrl(it), { method: 'DELETE' });
  _lsDrop(d.lsKey, it.id);
  return true;
}

// ── Upload ──────────────────────────────────────────────────────────────────
// Two steps on purpose: /api/biroly/upload owns the file and its thumbnail, and it
// deliberately does not touch the archive; the record is filed after. onEach reports
// progress so a batch of big clips does not look like a hung page.
export async function uploadVideos(files, onEach) {
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
      const rec = await _json('/api/library/media/record', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoPath: up.videoPath, thumbPath: up.thumbPath, name: up.name }),
      });
      _lsUnshift(rec.lsKey, rec.item);
      ok++;
    } catch (e) { /* one bad file must not stop the batch */ }
  }
  return { ok, total: list.length };
}

// Media records live under their kind (birols / uploads / hooks); the file shelves are
// addressed by filename, which is their id.
function _itemUrl(it) {
  return '/api/library/item/' + encodeURIComponent(it.kind) + '/' + encodeURIComponent(it.id);
}
