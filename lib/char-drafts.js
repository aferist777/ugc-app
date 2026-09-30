'use strict';

// NO DRAFT CHARACTERS (phase H8, the owner 2026-10-01: "не будем хранить черновики"). A draft - a take
// kept with the star on the Character page, which is gone - is not a character, and nothing shows or
// deletes one any more. So wherever one can be, it is SET ASIDE, not dropped: its record goes into
// <backups>/<date> character page/drafts.json (added to what is there) and its folder beside it, and
// characters.json keeps only real characters.
//
// Called on every start for the library itself (routes/char-store.js - one read of characters.json when
// there is nothing to do), and on a STAGED set before it is merged (Import, routes/data-io.js; the
// migration tool into a layout-6 library): an archive made before H8 can carry a draft, and with
// `overwrite` its record would even replace the finished character that has the same id.

const fs = require('fs');
const path = require('path');
const { writeFileAtomic } = require('./atomic-write');

const _day = () => new Date().toISOString().slice(0, 10);

/** The folder a library's set-aside things go into today. */
const backupDir = (backupsRoot) => path.join(backupsRoot, _day() + ' character page');

/**
 * @param libRoot      a library (or a staged set's lib/) - data/characters.json, media/characters/
 * @param backupsRoot  where backups/ is - always the REAL library's, a staged set is thrown away
 * @returns the drafts set aside: [{ id, name }]
 */
function setAside(libRoot, backupsRoot) {
  const file = path.join(libRoot, 'data', 'characters.json');
  if (!fs.existsSync(file)) return [];
  const list = JSON.parse(fs.readFileSync(file, 'utf8'));      // unreadable: throws, nothing is moved
  if (!Array.isArray(list)) return [];
  const drafts = list.filter(c => c && c.draft);
  if (!drafts.length) return [];
  const dir = backupDir(backupsRoot);
  fs.mkdirSync(dir, { recursive: true });
  const kept = path.join(dir, 'drafts.json');
  let before = [];
  try { before = JSON.parse(fs.readFileSync(kept, 'utf8')); } catch (e) { before = []; }
  writeFileAtomic(kept, JSON.stringify((Array.isArray(before) ? before : []).concat(drafts), null, 2));
  for (const d of drafts) {
    if (!d.folder || d.folder !== path.basename(String(d.folder))) continue;
    const src = path.join(libRoot, 'media', 'characters', d.folder);
    if (!fs.existsSync(src)) continue;
    let dst = path.join(dir, d.folder);
    for (let n = 2; fs.existsSync(dst); n++) dst = path.join(dir, d.folder + ' (' + n + ')');
    try { fs.renameSync(src, dst); }
    catch (e) {
      // Another drive (a staged set in the temp folder) or a locked file: copied, then removed.
      fs.cpSync(src, dst, { recursive: true });
      try { fs.rmSync(src, { recursive: true, force: true }); }
      catch (e2) { console.warn('[char-drafts] ' + d.folder + ' copied aside but not removed:', e2.message); }
    }
  }
  writeFileAtomic(file, JSON.stringify(list.filter(c => !(c && c.draft)), null, 2));
  return drafts.map(d => ({ id: d.id, name: d.name }));
}

module.exports = { setAside, backupDir };
