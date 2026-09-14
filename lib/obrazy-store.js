'use strict';

// Helpers for the new obrazy/ folder-per-look layout. Each saved obraz lives in
// its own subfolder under obrazy/, named "<slug>_<shortId>" — slug derived from
// the user-facing name (Cyrillic preserved, only filesystem-hostile chars
// stripped), shortId = last 6 chars of the timestamp id. Name collisions are
// avoided by the always-appended shortId, so two obrazes can safely share a
// display name. The folder contains:
//   - the "look image" the user was viewing when they pressed Save obraz
//   - posevar_*.jpg pose variations of that look (in selections[])
//   - the look image's thumbnail under thumbs/
// editResults[] archives have been retired — no archived generations are
// persisted any more, neither during migration nor going forward.

const fs   = require('fs');
const { writeFileAtomic } = require('./atomic-write');
const path = require('path');

const { OBRAZY_DIR, OBRAZY_FILE, OBRAZY_MIGRATED_FLAG, CHARACTERS_DIR, ROOT_DIR } = require('./config');

// Web-style path prefixes that historically housed obraz files. Migration
// sweeps each of them; "characters" is left mostly intact (only posevars and
// referenced char files are moved out) — see orphan sweep below.
const MIGRATABLE_PREFIXES = ['/characters/', '/uploads/', '/refs/'];

// ── Folder name helper ──────────────────────────────────────────────────────
// Strips characters that break Windows/Unix filesystems but keeps Cyrillic and
// human-readable punctuation. Always appends a 6-char id tail so collisions
// across two obrazes with the same name are impossible.
function _slug(name) {
  return String(name || 'obraz')
    .replace(/[\\\/:*?"<>|\x00-\x1f]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60) || 'obraz';
}
function _shortId(id) {
  return String(id || Date.now()).slice(-6);
}
function obrazFolderName(name, id) {
  return `${_slug(name)}_${_shortId(id)}`;
}
function obrazAbsFolder(name, id) {
  return path.join(OBRAZY_DIR, obrazFolderName(name, id));
}

// Resolve folder for an existing obraz given only its id — used by the
// pose-variations endpoint which gets obrazId from the request and needs
// to know where to write. Reads obrazy.json so we don't reinvent the slug.
function findObrazFolderById(id) {
  const list = _loadObrazy();
  const o = list.find(x => String(x.id) === String(id));
  if (!o) return null;
  return obrazAbsFolder(o.name, o.id);
}

function _loadObrazy() {
  try { return JSON.parse(fs.readFileSync(OBRAZY_FILE, 'utf8')); }
  catch { return []; }
}
function _saveObrazy(list) {
  if (!fs.existsSync(path.dirname(OBRAZY_FILE))) fs.mkdirSync(path.dirname(OBRAZY_FILE), { recursive: true });
  writeFileAtomic(OBRAZY_FILE, JSON.stringify(list, null, 2));
}

// ── One-shot migration ──────────────────────────────────────────────────────
// Runs at server startup. Idempotent via a flag file in data/. Walks the saved
// obrazes, builds per-obraz folders, moves the look-image and all variations
// from characters/ into them, scrubs editResults and orphan posevars, and
// rewrites paths in obrazy.json.
function runMigrationIfNeeded() {
  if (fs.existsSync(OBRAZY_MIGRATED_FLAG)) return;

  const list = _loadObrazy();
  if (!list.length) {
    // Nothing to migrate, but still drop the flag so we don't reparse on every boot.
    fs.writeFileSync(OBRAZY_MIGRATED_FLAG, new Date().toISOString());
    return;
  }

  console.log(`[obrazy-migrate] starting — ${list.length} obraz(ы) to process`);

  let movedFiles = 0;
  let editsDeleted = 0;

  for (const o of list) {
    if (!o.id) continue;
    const folder = obrazAbsFolder(o.name, o.id);
    if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });
    const folderRel = `/obrazy/${path.basename(folder)}`;

    // ── Helper: move a single file (any of MIGRATABLE_PREFIXES) into the obraz folder ──
    function _moveOne(webPath) {
      if (typeof webPath !== 'string') return webPath;
      const prefix = MIGRATABLE_PREFIXES.find(p => webPath.startsWith(p));
      if (!prefix) return webPath;
      const rel      = webPath.replace(/^\//, '');                          // characters/foo.jpg
      const filename = path.basename(rel);
      const srcAbs   = path.join(ROOT_DIR, rel);
      const destAbs  = path.join(folder, filename);
      if (fs.existsSync(srcAbs) && srcAbs !== destAbs) {
        try { fs.renameSync(srcAbs, destAbs); movedFiles++; }
        catch { try { fs.copyFileSync(srcAbs, destAbs); fs.unlinkSync(srcAbs); movedFiles++; } catch {} }
        // Move thumb if present (siblings/thumbs/<basename>.jpg)
        const baseNoExt = filename.replace(/\.[^.]+$/, '');
        const thumbSrc  = path.join(path.dirname(srcAbs), 'thumbs', baseNoExt + '.jpg');
        const thumbDest = path.join(folder, 'thumbs',                baseNoExt + '.jpg');
        if (fs.existsSync(thumbSrc)) {
          try {
            if (!fs.existsSync(path.dirname(thumbDest))) fs.mkdirSync(path.dirname(thumbDest), { recursive: true });
            fs.renameSync(thumbSrc, thumbDest);
          } catch {}
        }
        return `${folderRel}/${filename}`;
      }
      if (fs.existsSync(destAbs)) return `${folderRel}/${filename}`;
      // Source already missing AND target empty — file may have been moved into a
      // sibling obraz folder by an earlier iteration (two obrazes shared one file).
      // Look across obrazy/*/ for a copy and pull it into the current folder.
      try {
        for (const sibling of fs.readdirSync(OBRAZY_DIR)) {
          const candidate = path.join(OBRAZY_DIR, sibling, filename);
          if (!fs.existsSync(candidate)) continue;
          try { fs.copyFileSync(candidate, destAbs); movedFiles++; }
          catch { return webPath; }
          const baseNoExt = filename.replace(/\.[^.]+$/, '');
          const thumbCand = path.join(OBRAZY_DIR, sibling, 'thumbs', baseNoExt + '.jpg');
          const thumbDest = path.join(folder, 'thumbs', baseNoExt + '.jpg');
          if (fs.existsSync(thumbCand) && !fs.existsSync(thumbDest)) {
            try {
              if (!fs.existsSync(path.dirname(thumbDest))) fs.mkdirSync(path.dirname(thumbDest), { recursive: true });
              fs.copyFileSync(thumbCand, thumbDest);
            } catch {}
          }
          return `${folderRel}/${filename}`;
        }
      } catch {}
      return webPath;
    }

    if (o.char) o.char = _moveOne(o.char);
    if (Array.isArray(o.variations)) o.variations = o.variations.map(_moveOne);

    // ── Wipe archived editResults ─────────────────────────────────────────
    if (Array.isArray(o.editResults)) {
      for (const item of o.editResults) {
        const p = (typeof item === 'string') ? item : item?.path;
        if (typeof p !== 'string') continue;
        if (!MIGRATABLE_PREFIXES.some(pref => p.startsWith(pref))) continue;
        const abs = path.join(ROOT_DIR, p.replace(/^\//, ''));
        if (fs.existsSync(abs)) { try { fs.unlinkSync(abs); editsDeleted++; } catch {} }
        const baseNoExt = path.basename(abs).replace(/\.[^.]+$/, '');
        const thumbAbs  = path.join(path.dirname(abs), 'thumbs', baseNoExt + '.jpg');
        if (fs.existsSync(thumbAbs)) { try { fs.unlinkSync(thumbAbs); } catch {} }
      }
      o.editResults = []; // clear field for good measure
    }
  }

  _saveObrazy(list);
  console.log(`[obrazy-migrate] moved ${movedFiles} files, removed ${editsDeleted} editResults files`);

  // ── Sweep orphan posevars from characters/ ────────────────────────────────
  // Anything still in characters/ that's posevar_* AND not referenced by any
  // obraz is an orphan (parent obraz was likely deleted earlier).
  const stillReferenced = new Set();
  for (const o of list) {
    if (Array.isArray(o.variations)) {
      o.variations.forEach(v => { if (typeof v === 'string') stillReferenced.add(path.basename(v)); });
    }
    if (typeof o.char === 'string') stillReferenced.add(path.basename(o.char));
  }
  let orphans = 0;
  try {
    for (const f of fs.readdirSync(CHARACTERS_DIR)) {
      if (!f.startsWith('posevar_')) continue;
      if (stillReferenced.has(f)) continue;
      const abs = path.join(CHARACTERS_DIR, f);
      try { fs.unlinkSync(abs); orphans++; } catch {}
      const thumbAbs = path.join(CHARACTERS_DIR, 'thumbs', f.replace(/\.[^.]+$/, '') + '.jpg');
      if (fs.existsSync(thumbAbs)) { try { fs.unlinkSync(thumbAbs); } catch {} }
    }
  } catch {}
  console.log(`[obrazy-migrate] swept ${orphans} orphan posevars from characters/`);

  fs.writeFileSync(OBRAZY_MIGRATED_FLAG, new Date().toISOString());
}

module.exports = {
  obrazFolderName, obrazAbsFolder, findObrazFolderById,
  runMigrationIfNeeded,
};
