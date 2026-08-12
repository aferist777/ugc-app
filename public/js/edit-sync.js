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
       re-renders the project cards. It SKIPS the pull whenever this tab has changes
       not yet pushed, and before the first successful hydrate - pulling in either
       case is how local edits used to disappear.
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
    // The saved Merge projects. They belong here for the same reason timeline_data_v2 does -
    // this is where the browser-authored Merge state gets a server that hydrates it back on
    // load. Until now they rode only storage-sync's generic ui-state blob, which drops any
    // single value over 200KB WITHOUT SAYING SO: at 260KB they had silently stopped syncing
    // and the server was holding a 149KB copy from whenever they crossed the line.
    //
    // Cost, stated plainly: flush() sends the whole snapshot, so an autosave now carries
    // ~530KB instead of ~270KB. Debounced 800ms, and one user - but if it ever drags, the
    // answer is a per-key PUT, not dropping the key.
    'skleyka_saved_projects_v1',
  ];
  const PREFIXES = ['edit_voice__', 'edit_tts_params__', 'edit_avatar_seed__', 'scen_lines_v1__', 'engine_params__v1__'];
  function _isShared(key) { return key === SESSIONS_KEY || EXACT.indexOf(key) >= 0 || PREFIXES.some(p => key.indexOf(p) === 0); }

  let _lastVersion = -1;
  let _applying = false;     // true while we write server data back into localStorage
  let _timer = null;
  let _polling = null;
  // Local changes exist that the server has not been told about yet. Set the moment a shared
  // key is written, cleared only when a PUT has actually landed.
  //
  // This is what stops the poll below from undoing your work. timeline_data_v2 is ONE key
  // holding every session's layout, and a pull replaces the whole thing - so a poll landing
  // in the 800ms debounce after a trim used to write the server's older copy straight over it.
  // mergev2-adapter works around that by flushing immediately, but only for add/remove/move;
  // slider edits like a trim had nothing.
  let _dirty = false;
  // Whether the server's state was ever successfully read. Until it has been, a pull is not a
  // "newer version" - it is a guess, and applying it over a tab that has been worked in is how
  // a blip at boot wipes the timeline.
  let _hydrated = false;

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
    _dirty = true;
    if (_timer) clearTimeout(_timer);
    _timer = setTimeout(EditSync.flush, 800);
  };
  EditSync.flush = async function () {
    if (_timer) { clearTimeout(_timer); _timer = null; }
    const body = { sessions: _sessionsObj(), workspace: { ls: _collectLs() } };
    try {
      const r = await fetch('/api/edit-state', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const d = await r.json();
      if (d && d.version != null) { _lastVersion = d.version; _dirty = false; }
    } catch {}   // still dirty: the next poll will try again rather than pull over it
  };
  EditSync.isDirty = () => _dirty;
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
      if (d && d.success) { _applyBlob(d.sessions, (d.workspace && d.workspace.ls) || {}, d.version); _hydrated = true; }
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

      // NEVER pull over unsaved local work. This is the fix for edits undoing themselves:
      // a birol placed a moment ago, a trim just dragged, sometimes a whole timeline - all of
      // it lived in localStorage for up to 800ms before the PUT, and a poll landing in that
      // window wrote the server's older copy over it. timeline_data_v2 is a single key holding
      // every session, so one such pull reverts everything at once.
      //
      // Push instead of pulling, and let the next tick decide with fresh information.
      if (_dirty) { try { await EditSync.flush(); } catch (e) {} return; }

      // And do not pull at all until the server's state has actually been read once. Before
      // that _lastVersion is -1, so ANY version looks newer - a failed hydrate at boot would
      // otherwise be followed eight seconds later by the server overwriting a tab that has
      // been worked in ever since.
      if (!_hydrated) { try { await EditSync.hydrate(); } catch (e) {} return; }

      try {
        const r = await fetch('/api/edit-state/version');
        const d = await r.json();
        if (d && d.success && d.version > _lastVersion) {
          const sr = await fetch('/api/edit-state');
          const sd = await sr.json();
          if (sd && sd.success) {
            // Re-populate in-memory globals so the UI reflects the pulled state.
            console.log('[edit-sync] pulled v' + sd.version + ' from the server (local had none pending)');
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
  //
  // TWO patches, because one was not enough and the gap cost real work.
  //
  // storage-sync.js runs first (it must: it hydrates before any page code reads) and it
  // replaces localStorage.setItem with an OWN property on the instance, capturing the pristine
  // prototype method to call through to. Patching only the prototype here therefore put this
  // interceptor in its shadow: `localStorage.setItem(...)` reached storage-sync's override,
  // which called the method it had captured BEFORE this patch existed. Measured: after writing
  // timeline_data_v2 the dirty flag stayed false.
  //
  // The consequence was not cosmetic. Merge edits never scheduled a PUT at all - only the
  // explicit flushes mergev2-adapter makes for add/remove/move, and pagehide. A trim scheduled
  // nothing, so the poll eight seconds later pulled the server's copy, which had never heard of
  // it, straight over the top. That is the work that kept undoing itself.
  //
  // So: wrap the INSTANCE as it is now (composing with storage-sync's override, whatever it is)
  // and keep the prototype patch for pages that load this without storage-sync.
  try {
    const LS = window.localStorage;
    if (LS && !LS.__ugcEditSyncPatched) {
      const curSet = LS.setItem.bind(LS);
      const curRemove = LS.removeItem.bind(LS);
      LS.setItem = function (k, v) {
        const r = curSet(k, v);
        try { if (_isShared(k)) EditSync.scheduleSync(); } catch (e) {}
        return r;
      };
      LS.removeItem = function (k) {
        const r = curRemove(k);
        try { if (_isShared(k)) EditSync.scheduleSync(); } catch (e) {}
        return r;
      };
      LS.__ugcEditSyncPatched = true;
    }
  } catch (e) {}

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

  // Flush any pending debounced change before the tab is hidden / unloaded, so a
  // quick reload right after an action (e.g. ★ send-to-Merge) can't lose it.
  try {
    const _flushNow = () => { try { EditSync.flush(); } catch {} };
    window.addEventListener('pagehide', _flushNow);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') _flushNow(); });
  } catch {}

  window.EditSync = EditSync;
})();
