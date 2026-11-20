'use strict';

// ════════════════════════════════════════════════════════════════════════
// PERSISTENT CHARACTERS (ACTORS) — server-authoritative store.
//
// A "char" is a reusable actor identity: face + body + voice, kept long-term
// and re-dressed/re-staged across many obrazy (looks, outfits). Each char owns a
// folder under media/characters/<slug>_<shortId>/ holding:
//   - base_<time>.jpg  — the face the character was made from (`baseFace`, the sheet's source)
//   - sheet_<...>.jpg  — the reference sheet, the character's canonical picture
//   - preview/, thumbs/ — the derived sizes
// Records live in data/characters.json. Obrazy link back via obraz.charId.
// ════════════════════════════════════════════════════════════════════════

const fs   = require('fs');
const path = require('path');
const { writeFileAtomic } = require('./atomic-write');

const { CHARACTERS_DIR, CHARACTERS_DB_FILE } = require('./config');
const I18N = require('./i18n');

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
// A char's folder, from its record's `folder` - written when it is made, stable across name edits.
function charAbsFolderRec(c) {
  if (!c || !c.folder) throw new Error(I18N.t('the character has no folder'));
  return path.join(CHARACTERS_DIR, c.folder);
}

// ── JSON persistence ──────────────────────────────────────────────────────
function loadChars() {
  try { return JSON.parse(fs.readFileSync(CHARACTERS_DB_FILE, 'utf8')); }
  catch { return []; }
}
// Through writeFileAtomic like every store (temp file, fsync, rename, a retry while Windows holds
// the file).
function saveChars(list) {
  const dir = path.dirname(CHARACTERS_DB_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  writeFileAtomic(CHARACTERS_DB_FILE, JSON.stringify(list, null, 2));
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
  if (c && c.folder) {
    const folder = charAbsFolderRec(c);
    if (fs.existsSync(folder)) {
      try { fs.rmSync(folder, { recursive: true, force: true }); } catch {}
    }
  }
  return !!c;
}


module.exports = {
  charFolderName, charAbsFolderRec,
  loadChars, saveChars, findChar, upsertChar, patchChar, deleteChar,
};
