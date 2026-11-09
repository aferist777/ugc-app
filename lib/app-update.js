'use strict';

// ════════════════════════════════════════════════════════════════════════════
// "THE APP WAS UPDATED" (phase V23, the owner 2026-10-09: "только уведомлением и чипом в шапке слева от Alerts; при
// клике открывается попап для перезагрузки и обновления").
//
// The owner's launcher runs this checkout's code, and a new commit lands in the program folder while the app is open:
// what is running is still the code it started with. The server remembers the commit it started on (`.git` -> HEAD,
// a worktree's own HEAD and the shared refs) and answers whether the folder has moved on since - a COMMIT, not any
// changed file (the owner's answer 6): a half-made edit is not an update. Read at most every ten seconds; a folder
// that is not a git checkout (a built app) never says it was updated.
//
// The page (public/js/app-update.js) shows a chip and says so once (`announced`, kept in memory - a restart is the
// answer to it); the restart itself is the desktop shell's (desktop/main.js), so this only matters in the app window.
// ════════════════════════════════════════════════════════════════════════════

// The commit is read by lib/app-version.js (phase V83: the library is stamped with it too).
const { head } = require('./app-version');

const BOOT = head();
let _seen = { at: Date.now(), ...BOOT };
let _announced = false;

function state() {
  if (Date.now() - _seen.at > 10000) _seen = { at: Date.now(), ...head() };
  const changed = !!BOOT.id && !!_seen.id && _seen.id !== BOOT.id;
  let renderBusy = false;
  try { renderBusy = require('./render-busy').busy(); } catch (e) { renderBusy = false; }
  return {
    changed, was: BOOT.id.slice(0, 7), now: _seen.id.slice(0, 7), subject: changed ? _seen.subject : '',
    // The restart is the desktop shell's: in a browser there is nothing to restart from the page.
    app: !!process.versions.electron, announced: _announced, renderBusy,
  };
}

const announce = () => { _announced = true; };

module.exports = { state, announce, head };
