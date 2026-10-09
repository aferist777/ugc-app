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

const fs = require('fs');
const path = require('path');
const { APP_DIR } = require('./config');

function _gitDir() {
  const dot = path.join(APP_DIR, '.git');
  let st;
  try { st = fs.statSync(dot); } catch (e) { return null; }
  if (st.isDirectory()) return dot;
  const m = /^gitdir:\s*(.+)$/m.exec(fs.readFileSync(dot, 'utf8'));
  return m ? path.resolve(APP_DIR, m[1].trim()) : null;
}

/** The commit the program folder is on now, and its subject when the log says it - '' when it cannot be read. */
function head() {
  try {
    const g = _gitDir();
    if (!g) return { id: '', subject: '' };
    const h = fs.readFileSync(path.join(g, 'HEAD'), 'utf8').trim();
    const ref = /^ref:\s*(.+)$/.exec(h);
    let id = ref ? '' : h;
    if (ref) {
      let common = g;
      try { common = path.resolve(g, fs.readFileSync(path.join(g, 'commondir'), 'utf8').trim()); } catch (e) { /* not a worktree */ }
      for (const base of [g, common]) {
        if (id) break;
        try { id = fs.readFileSync(path.join(base, ref[1]), 'utf8').trim(); } catch (e) { /* packed, perhaps */ }
      }
      if (!id) {
        try {
          const line = fs.readFileSync(path.join(common, 'packed-refs'), 'utf8').split(/\r?\n/).find(l => l.endsWith(' ' + ref[1]));
          if (line) id = line.split(' ')[0];
        } catch (e) { /* no packed refs */ }
      }
    }
    // What the commit says about itself, from the worktree's own log of HEAD: "<old> <new> <who> <when>\tcommit: <subject>".
    let subject = '';
    try {
      const last = fs.readFileSync(path.join(g, 'logs', 'HEAD'), 'utf8').trim().split(/\r?\n/).pop() || '';
      const [meta, said] = last.split('\t');
      if (id && String(meta || '').split(' ')[1] === id) subject = String(said || '').replace(/^[a-z ()-]+:\s*/i, '').slice(0, 160);
    } catch (e) { /* no log */ }
    return { id, subject };
  } catch (e) {
    return { id: '', subject: '' };
  }
}

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
