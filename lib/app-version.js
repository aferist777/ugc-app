'use strict';

// ════════════════════════════════════════════════════════════════════════════
// WHICH PROGRAM THIS IS.
//
// A built copy - an installed one, updated through the program's releases - carries `version.json` beside its code
// (tools/build-app.js): { version, seq, commit, date, format, channel }. A copy run from git (a launcher
// script, `npm start`, `npm run server`) has none: its version is package.json's, its commit the folder's HEAD
// (a worktree's own HEAD and the shared refs).
//
// No lib/config.js here: the desktop shell asks before the library is settled (lib/library-format.js `check`), and
// config refuses to load under Electron without it. The program folder is only READ - nothing is written into it.
// ════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');

const APP_DIR = path.join(__dirname, '..');

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

const _readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return null; } };

let _current = null;

/** { version, commit, built } - read once: what started is what runs, whatever lands in the folder later. */
function current() {
  if (_current) return _current;
  const v = _readJson(path.join(APP_DIR, 'version.json'));
  if (v && v.version) {
    _current = { version: String(v.version), commit: String(v.commit || ''), built: true };
  } else {
    const pkg = _readJson(path.join(APP_DIR, 'package.json')) || {};
    _current = { version: String(pkg.version || '0.0.0'), commit: head().id.slice(0, 12), built: false };
  }
  return _current;
}

module.exports = { APP_DIR, head, current };
