/* ═══════════════════════════════════════════════════════════════════════════
   edit-sync.js — shared Edit/Merge workspace state across clients (window.EditSync).

   The whole workspace already lives in a known set of localStorage keys. Instead
   of rewriting every consumer, this module MIRRORS those keys to the server
   (data/edit-state.json via routes/edit.js) so several browsers share one set of
   projects + material:

     • Projects (editFrozenSessions, key `edit_frozen_sessions_v1`) are sent as a
       parsed OBJECT and merged BY PROJECT KEY on the server — two users creating
       different projects never clobber each other.
     • Everything else (visibility, assignments, timeline_data_v2, per-project &
       global settings) is mirrored as an `ls` snapshot (last-write-wins per key).

   Mechanics:
     • A localStorage.setItem/removeItem interceptor schedules a debounced PUT
       whenever a shared key changes — so existing save paths need no edits.
     • hydrate() pulls the server state into localStorage BEFORE boot (scen-init).
     • startPolling() watches the server `version`; on change it pulls and
       re-renders the project cards (skips while a workspace popup is open).
     • Project deletion goes through deleteSession() (a key-merge can't express
       "removed"), wired from removeEditProject.

   Load this EARLY (before scen-state.js) so the interceptor is in place.
   ═══════════════════════════════════════════════════════════════════════════ */

(function () {
  const EditSync = {};

  const SESSIONS_KEY = 'edit_frozen_sessions_v1';
  // Exact shared keys + dynamic-suffix prefixes that make up the workspace.
  const EXACT = [
    'edit_active_obrazy_v1', 'edit_card_cache_v1', 'edit_last_visible_v1',
    'skleyka_last_shown_v1', 'skleyka_closed_v1', 'scenario_assignments_v1',
    'timeline_data_v2', 'edit_avatar_model_global', 'edit_avatar_params_global',
    'image_engine_v1', 'audio_engine_v1', 'edit_negative_prompt_v1',
  ];
  const PREFIXES = ['edit_voice__', 'edit_tts_params__', 'edit_avatar_seed__', 'scen_lines_v1__', 'engine_params__v1__'];
  function _isShared(key) { return key === SESSIONS_KEY || EXACT.indexOf(key) >= 0 || PREFIXES.some(p => key.indexOf(p) === 0); }

  let _lastVersion = -1;
  let _applying = false;     // true while we write server data back into localStorage
  let _timer = null;
  let _polling = null;

  // Keep original (unpatched) accessors so applying server data never re-triggers sync.
  const _set = localStorage.setItem.bind(localStorage);
  const _get = localStorage.getItem.bind(localStorage);

  function _collectLs() {
    const ls = {};
    for (const k of EXACT) { const v = _get(k); if (v != null) ls[k] = v; }
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && PREFIXES.some(p => k.indexOf(p) === 0)) ls[k] = _get(k);
    }
    return ls;
  }
  function _sessionsObj() { try { return JSON.parse(_get(SESSIONS_KEY) || '{}'); } catch { return {}; } }

  // ── Outbound: debounced PUT ────────────────────────────────────────────────
  EditSync.scheduleSync = function () {
    if (_applying) return;
    if (_timer) clearTimeout(_timer);
    _timer = setTimeout(EditSync.flush, 800);
  };
  EditSync.flush = async function () {
    if (_timer) { clearTimeout(_timer); _timer = null; }
    const body = { sessions: _sessionsObj(), workspace: { ls: _collectLs() } };
    try {
      const r = await fetch('/api/edit-state', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const d = await r.json();
      if (d && d.version != null) _lastVersion = d.version;
    } catch {}
  };
  EditSync.deleteSession = async function (key) {
    try {
      const r = await fetch('/api/edit-state/session/' + encodeURIComponent(key), { method: 'DELETE' });
      const d = await r.json();
      if (d && d.version != null) _lastVersion = d.version;
    } catch {}
  };

  // ── Inbound: apply server blob into localStorage ───────────────────────────
  function _applyBlob(sessions, ls, version) {
    _applying = true;
    try {
      _set(SESSIONS_KEY, JSON.stringify(sessions || {}));   // replace → deletions propagate
      const map = ls || {};
      for (const k in map) { if (map[k] != null) _set(k, map[k]); }
      if (version != null) _lastVersion = version;
    } finally { _applying = false; }
  }

  EditSync.hydrate = async function () {
    try {
      const r = await fetch('/api/edit-state');
      const d = await r.json();
      if (d && d.success) _applyBlob(d.sessions, (d.workspace && d.workspace.ls) || {}, d.version);
    } catch {}
  };

  // ── Polling: detect other users' changes ───────────────────────────────────
  function _popupOpen() { return !!document.getElementById('edit2-modal'); }
  function _rerender() {
    try { if (!_popupOpen() && window.EDIT2Tab && EDIT2Tab.render) EDIT2Tab.render(); } catch {}
  }
  EditSync.startPolling = function (intervalMs) {
    if (_polling) return;
    const ms = intervalMs || 8000;
    _polling = setInterval(async () => {
      if (_popupOpen()) return;                         // don't disturb active editing
      try {
        const r = await fetch('/api/edit-state/version');
        const d = await r.json();
        if (d && d.success && d.version > _lastVersion) {
          const sr = await fetch('/api/edit-state');
          const sd = await sr.json();
          if (sd && sd.success) {
            // Re-populate in-memory globals so the UI reflects the pulled state.
            _applyBlob(sd.sessions, (sd.workspace && sd.workspace.ls) || {}, sd.version);
            if (typeof loadEditState === 'function') {
              try { for (const k in editFrozenSessions) delete editFrozenSessions[k]; } catch {}
              try { loadEditState(); } catch {}
            }
            _rerender();
          }
        }
      } catch {}
    }, ms);
  };

  // ── Install the localStorage interceptor (catches every shared write) ──────
  try {
    const proto = window.Storage && window.Storage.prototype;
    if (proto && !proto.__ugcSyncPatched) {
      const origSet = proto.setItem, origRemove = proto.removeItem;
      proto.setItem = function (k, v) {
        const r = origSet.apply(this, arguments);
        try { if (this === window.localStorage && _isShared(k)) EditSync.scheduleSync(); } catch {}
        return r;
      };
      proto.removeItem = function (k) {
        const r = origRemove.apply(this, arguments);
        try { if (this === window.localStorage && _isShared(k)) EditSync.scheduleSync(); } catch {}
        return r;
      };
      proto.__ugcSyncPatched = true;
    }
  } catch {}

  window.EditSync = EditSync;
})();
