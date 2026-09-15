'use strict';

// Helpers for the folder-per-look layout of media/looks/ (the obrazy). Each saved obraz lives in
// its own subfolder, named "<slug>_<shortId>" — slug derived from
// the user-facing name (Cyrillic preserved, only filesystem-hostile chars
// stripped), shortId = last 6 chars of the timestamp id. Name collisions are
// avoided by the always-appended shortId, so two obrazes can safely share a
// display name. The folder contains:
//   - the "look image" the user was viewing when they pressed Save obraz
//   - posevar_*.jpg pose variations of that look (in selections[])
//   - the look image's thumbnail under thumbs/
// editResults[] archives have been retired — no archived generations are persisted.

const fs   = require('fs');
const path = require('path');

const { OBRAZY_DIR, OBRAZY_FILE } = require('./config');

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

function _loadObrazy() {
  try { return JSON.parse(fs.readFileSync(OBRAZY_FILE, 'utf8')); }
  catch { return []; }
}

module.exports = {
  obrazFolderName, obrazAbsFolder, 
};
