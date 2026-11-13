'use strict';

// ════════════════════════════════════════════════════════════════════════════
// "THE APP WAS UPDATED".
//
// A copy run from a git checkout runs that checkout's code, and a new commit lands in the program folder while the app is open:
// what is running is still the code it started with. The server remembers the commit it started on (`.git` -> HEAD,
// a worktree's own HEAD and the shared refs) and answers whether the folder has moved on since - a COMMIT, not any
// changed file: a half-made edit is not an update. Read at most every ten seconds; a folder
// that is not a git checkout (a built app) never says it was updated.
//
// The page (public/js/app-update.js) shows a chip and says so once (`announced`, kept in memory - a restart is the
// answer to it); the restart itself is the desktop shell's (desktop/main.js), so this only matters in the app window.
// ════════════════════════════════════════════════════════════════════════════

// The commit is read by lib/app-version.js (the library is stamped with it too).
const fs = require('fs');
const path = require('path');
const { head, current } = require('./app-version');

// An installed copy has no .git: there the news is the updater's (desktop/updater.js) -
// <UGC_HOME>\updates\ready.json, a new version laid down and waiting for a restart - and its progress, state.json.
const HOME = process.env.UGC_HOME || '';
const _json = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8').replace(/^﻿/, '')); } catch (e) { return null; } };
function _release() {
  if (!HOME) return null;
  const r = _json(path.join(HOME, 'updates', 'ready.json'));
  if (!r || !r.version || String(r.version) === current().version) return null;
  return { version: String(r.version), notes: String(r.notes || ''), important: !!r.important };
}
const _updater = () => (HOME ? (_json(path.join(HOME, 'updates', 'state.json')) || { phase: 'idle' }) : null);

const BOOT = head();
let _seen = { at: Date.now(), ...BOOT };
let _announced = false;

function state() {
  if (Date.now() - _seen.at > 10000) _seen = { at: Date.now(), ...head() };
  const release = _release();
  const changed = !!release || (!!BOOT.id && !!_seen.id && _seen.id !== BOOT.id);
  let renderBusy = false;
  try { renderBusy = require('./render-busy').busy(); } catch (e) { renderBusy = false; }
  const prog = current();
  return {
    changed, was: BOOT.id.slice(0, 7), now: _seen.id.slice(0, 7), subject: changed && !release ? _seen.subject : '',
    // The restart is the desktop shell's: in a browser there is nothing to restart from the page.
    app: !!process.versions.electron, announced: _announced, renderBusy,
    release, program: { version: prog.version, built: prog.built }, updater: _updater(),
  };
}

const announce = () => { _announced = true; };

module.exports = { state, announce, head };
