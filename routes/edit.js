/* ═══════════════════════════════════════════════════════════════════════════
   routes/edit.js — Edit v2 maintenance endpoints.

   DELETE /api/edit/session-files  body: { paths: ["/uploads/…", "/finals/…"] }
   Deletes a project's generated files. ONLY /uploads/* and /finals/* are
   touched — library dirs (obrazy, details, characters, …) are never deleted,
   even if a stray path is passed. Includes a path-escape guard. Returns count.
   ═══════════════════════════════════════════════════════════════════════════ */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { UPLOADS_DIR, FINALS_DIR, DATA_DIR } = require('../lib/config');
const { createThumbnail } = require('../lib/helpers');

function _resolveSafe(url) {
  if (typeof url !== 'string') return null;
  let base, rest;
  if (url.startsWith('/uploads/'))      { base = UPLOADS_DIR; rest = url.slice('/uploads/'.length); }
  else if (url.startsWith('/finals/'))  { base = FINALS_DIR;  rest = url.slice('/finals/'.length); }
  else return null;
  const root = path.resolve(base);
  const abs  = path.resolve(root, rest);
  if (abs !== root && !abs.startsWith(root + path.sep)) return null; // escape guard
  return abs;
}

// ── Sanitizers for per-project folder layout (Phase B) ───────────────────────
function _safeKey(s)    { return String(s || '').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120); }
function _safeBucket(s) { return String(s || '').replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 32); }

// ═══════════════════════════════════════════════════════════════════════════
// SHARED EDIT/MERGE WORKSPACE STATE (multi-user) — data/edit-state.json
//
// Holds the Edit v2 + Merge workspace so several clients share one set of
// projects and material:
//   { version, updatedAt, sessions:{<key>:record}, workspace:{…}, settings:{…} }
//
// Concurrency model (single file, key-level merge):
//   - PUT merges incoming `sessions` BY KEY (incoming keys overwrite, keys the
//     server already has but the client didn't send are PRESERVED) → two users
//     creating different projects never clobber each other. Editing the SAME
//     project at once is last-write-wins.
//   - Deletions must go through DELETE /edit-state/session/:key (a union merge
//     can't express "removed").
//   - `version` bumps on every write so clients can cheaply poll for changes.
// ═══════════════════════════════════════════════════════════════════════════
const EDIT_STATE_FILE = path.join(DATA_DIR, 'edit-state.json');
let _stateCache = null;

function _loadState() {
  if (_stateCache) return _stateCache;
  try { _stateCache = JSON.parse(fs.readFileSync(EDIT_STATE_FILE, 'utf8')); }
  catch { _stateCache = { version: 0, updatedAt: null, sessions: {}, workspace: {}, settings: {} }; }
  _stateCache.sessions  = _stateCache.sessions  || {};
  _stateCache.workspace = _stateCache.workspace || {};
  _stateCache.settings  = _stateCache.settings  || {};
  return _stateCache;
}
function _saveState(st) {
  st.version   = (st.version || 0) + 1;
  st.updatedAt = new Date().toISOString();
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch {}
  // Atomic-ish write: tmp then rename, so a crash mid-write can't corrupt it.
  const tmp = EDIT_STATE_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(st));
  fs.renameSync(tmp, EDIT_STATE_FILE);
  _stateCache = st;
  return st.version;
}

// Full state (GET) — used on boot.
router.get('/edit-state', (_req, res) => {
  const st = _loadState();
  res.json({ success: true, version: st.version || 0, updatedAt: st.updatedAt || null,
    sessions: st.sessions, workspace: st.workspace, settings: st.settings });
});

// Just the version — cheap poll to detect other users' changes.
router.get('/edit-state/version', (_req, res) => {
  const st = _loadState();
  res.json({ success: true, version: st.version || 0 });
});

// Merge-write. Body: { sessions?, workspace?, settings? }.
// Stale-client protection (added with VSL slicing, whose fragment structure
// lives in the session):
//   - rev guard: a session carrying a numeric `rev` can only be overwritten by
//     a copy with rev >= the stored one. Clients bump rev on structural edits;
//     an idle tab flushing an old copy can no longer revert them. Sessions
//     without rev keep the old last-write-wins behavior.
//   - tombstones: deleted session keys are remembered, so a stale tab's flush
//     can't resurrect a project the user already deleted.
router.put('/edit-state', (req, res) => {
  const st = _loadState();
  const b = req.body || {};
  if (b.sessions && typeof b.sessions === 'object') {
    const tomb = st.deletedSessions || {};
    for (const [k, v] of Object.entries(b.sessions)) {
      if (tomb[k]) continue;                                  // deleted — don't resurrect
      const ex = st.sessions[k];
      if (ex && typeof ex.rev === 'number' &&
          !(v && typeof v.rev === 'number' && v.rev >= ex.rev)) continue;  // stale copy — keep ours
      st.sessions[k] = v;
    }
  }
  if (b.workspace && typeof b.workspace === 'object') st.workspace = { ...st.workspace, ...b.workspace };
  if (b.settings  && typeof b.settings  === 'object') st.settings  = { ...st.settings,  ...b.settings  };
  const version = _saveState(st);
  res.json({ success: true, version });
});

// Remove one project from the shared set. Always records a tombstone so a
// stale client's later merge-flush can't bring the session back (keys embed
// creation timestamps, so legitimate new projects never collide with one).
router.delete('/edit-state/session/:key', (req, res) => {
  const st = _loadState();
  const key = String(req.params.key || '');
  if (st.sessions && Object.prototype.hasOwnProperty.call(st.sessions, key)) delete st.sessions[key];
  st.deletedSessions = st.deletedSessions || {};
  st.deletedSessions[key] = Date.now();
  const tk = Object.keys(st.deletedSessions);
  if (tk.length > 300) {                                      // cap: drop the oldest tombstones
    tk.sort((a, b) => st.deletedSessions[a] - st.deletedSessions[b]);
    for (const k of tk.slice(0, tk.length - 300)) delete st.deletedSessions[k];
  }
  const version = _saveState(st);
  res.json({ success: true, version });
});

// Drop the in-memory cache so the next _loadState() re-reads edit-state.json from
// disk. Called by the import flow (routes/data-io.js) after it writes a merged file.
router.resetStateCache = () => { _stateCache = null; };

// ── Server-side hand-off: write ONE session ──────────────────────────────────
// For another route that builds a Merge project (Scenarios -> Merge). Same file,
// same guards as the PUT above, and it REPORTS the guard instead of lying: a
// tombstoned key silently doing nothing is precisely the bug worth surfacing.
// A stored numeric rev is carried forward +1 so Merge's own stale-copy check
// keeps working on the session we just replaced.
router.putSession = (key, session) => {
  const k = String(key || '').trim();
  if (!k) return { ok: false, reason: 'no key' };
  if (!session || typeof session !== 'object') return { ok: false, reason: 'no session' };
  const st = _loadState();
  if ((st.deletedSessions || {})[k]) return { ok: false, reason: 'deleted' };
  st.sessions = st.sessions || {};
  const ex = st.sessions[k];
  const rev = (ex && typeof ex.rev === 'number') ? ex.rev + 1 : null;
  st.sessions[k] = (rev === null) ? session : { ...session, rev };
  const version = _saveState(st);
  return { ok: true, version, rev, replaced: !!ex };
};

module.exports = router;
