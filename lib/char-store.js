'use strict';

// ════════════════════════════════════════════════════════════════════════
// PERSISTENT CHARACTERS (ACTORS) — server-authoritative store.
//
// A "char" is a reusable actor identity: face + body + voice, kept long-term
// and re-dressed/re-staged across many obrazы (outfits). Each char owns a
// folder under characters/<slug>_<shortId>/ holding:
//   - base.jpg     — snapshot of the active image at Save-char time (face source)
//   - portrait.jpg — 3-angle head reference sheet (neutral bodysuit, 16:9)
//   - tpose.jpg    — full-body T-pose turnaround sheet (neutral bodysuit, 16:9)
//   - thumbs/      — thumbnails
// Records live in data/characters.json. Obrazы link back via obraz.charId.
// ════════════════════════════════════════════════════════════════════════

const fs   = require('fs');
const path = require('path');

const { CHARACTERS_DIR, CHARACTERS_DB_FILE } = require('./config');

// ── Folder-name helper (mirrors obrazy-store: keep Cyrillic, append shortId) ──
function _slug(name) {
  return String(name || 'char')
    .replace(/[\\\/:*?"<>|\x00-\x1f]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60) || 'char';
}
function _shortId(id) {
  return String(id || Date.now()).slice(-6);
}
function charFolderName(name, id) {
  return `${_slug(name)}_${_shortId(id)}`;
}
function charAbsFolder(name, id) {
  return path.join(CHARACTERS_DIR, charFolderName(name, id));
}
// Resolve a char's folder from its record. Prefers the stored `folder` field
// (stable across name edits); falls back to recomputing from name+id for
// legacy records created before `folder` was persisted.
function charAbsFolderRec(c) {
  if (c && c.folder) return path.join(CHARACTERS_DIR, c.folder);
  return charAbsFolder(c && c.name, c && c.id);
}

// ── JSON persistence ──────────────────────────────────────────────────────
function loadChars() {
  try { return JSON.parse(fs.readFileSync(CHARACTERS_DB_FILE, 'utf8')); }
  catch { return []; }
}
function saveChars(list) {
  const dir = path.dirname(CHARACTERS_DB_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  // Atomic write: tmp → rename, so a crash mid-write can't corrupt the file.
  const tmp = CHARACTERS_DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(list, null, 2), 'utf8');
  fs.renameSync(tmp, CHARACTERS_DB_FILE);
}
function findChar(id) {
  return loadChars().find(c => String(c.id) === String(id)) || null;
}
function upsertChar(rec) {
  const list = loadChars();
  const idx  = list.findIndex(c => String(c.id) === String(rec.id));
  if (idx === -1) list.unshift(rec);
  else            list[idx] = { ...list[idx], ...rec };
  saveChars(list);
  return rec;
}
function patchChar(id, patch) {
  const list = loadChars();
  const c = list.find(x => String(x.id) === String(id));
  if (!c) return null;
  Object.assign(c, patch);
  saveChars(list);
  return c;
}
function deleteChar(id) {
  const list = loadChars();
  const c = list.find(x => String(x.id) === String(id));
  const next = list.filter(x => String(x.id) !== String(id));
  saveChars(next);
  if (c) {
    const folder = charAbsFolderRec(c);
    // Only nuke the folder when it actually lives under characters/ as a
    // dedicated subfolder — never for legacy records that point at a flat
    // /characters/<file>.jpg (folder would resolve to the gallery root).
    if (c.folder && fs.existsSync(folder)) {
      try { fs.rmSync(folder, { recursive: true, force: true }); } catch {}
    }
  }
  return !!c;
}

// ── Draft characters ─────────────────────────────────────────────────────
// A draft (`draft:true`) is a provisional actor created when the user designs
// a voice in the Save-obraz popup. It is keyed to its source obraz via
// `sourceObrazId`, is hidden from the dropdown, and is either PROMOTED to a
// real character (Save char) or garbage-collected when its source obraz is
// deleted. Drafts have no folder/sheets — those are produced on promotion.
function findDraftByObraz(obrazId) {
  return loadChars().find(c => c.draft && String(c.sourceObrazId) === String(obrazId)) || null;
}
function deleteDraftByObraz(obrazId) {
  const list = loadChars();
  const next = list.filter(c => !(c.draft && String(c.sourceObrazId) === String(obrazId)));
  if (next.length === list.length) return false;
  saveChars(next);
  return true;
}

module.exports = {
  charFolderName, charAbsFolder, charAbsFolderRec,
  loadChars, saveChars, findChar, upsertChar, patchChar, deleteChar,
  findDraftByObraz, deleteDraftByObraz,
};
