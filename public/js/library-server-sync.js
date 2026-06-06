/* ═══════════════════════════════════════════════════════════════════
   LIBRARY SERVER SYNC — universal server-as-truth mirror for the
   localStorage stores that weren't already covered by their own
   per-module sync. Currently handles:

     - all_geni_v1              ↔  /api/userdata/geni           (array)

   The existing per-module syncs cover the rest:
     - edit_frozen_sessions_v1  ↔  edit-sync.js / /api/edit-state  — the SINGLE
       source of truth for Edit/Merge projects (version-polled, re-renders in
       place, no reload). This module no longer mirrors it (was a racy duplicate).
     - biroly_* / hooks_*       ↔  biroly-server-sync.js / hooks-server-sync.js
     - obrazy / projects_v1     ↔  obrazy.js / projects.js bootstraps

   Server-as-truth semantics (identical to biroly-server-sync.js):
     1. On page load: GET the endpoint. If the server has any data,
        overwrite LS unconditionally + reload so the rest of the app
        re-bootstraps against the fresh data. If the server is empty
        and LS has data, push LS up once (initial recovery).
     2. Every 2s: hash the LS value, POST to server if it changed.

   Trade-off: edits on one device appear on another only after the
   second device reloads. Concurrent edits → last push wins (no merge).
   Acceptable for single-user multi-device workflow.
   ═══════════════════════════════════════════════════════════════════ */

(function () {
  const SYNC_INTERVAL_MS = 2000;

  // Each store: { lsKey, endpoint, type ('array'|'object'), label, normalize? }
  // Default values must match the type — '[]' for arrays, '{}' for objects —
  // so JSON.parse fallback round-trips cleanly through hash compare.
  // NOTE: edit_frozen_sessions_v1 is intentionally NOT mirrored here — Edit/Merge
  // projects are owned by edit-sync.js (/api/edit-state), the single source of
  // truth. Mirroring it here too caused two stores to race + reload-loop.
  const STORES = [
    { lsKey: 'all_geni_v1', endpoint: '/api/userdata/geni', type: 'array', label: 'geni' },
  ];

  function _hash(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
    return h >>> 0;
  }
  function _defaultFor(type) { return type === 'object' ? {} : []; }
  function _isPopulated(value, type) {
    if (type === 'object') return value && typeof value === 'object' && Object.keys(value).length > 0;
    return Array.isArray(value) && value.length > 0;
  }
  function _readLS(store) {
    try {
      const raw = localStorage.getItem(store.lsKey);
      if (raw == null) return _defaultFor(store.type);
      const parsed = JSON.parse(raw);
      if (store.type === 'object' && (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed))) return _defaultFor(store.type);
      if (store.type === 'array'  && !Array.isArray(parsed))                                                   return _defaultFor(store.type);
      return parsed;
    } catch { return _defaultFor(store.type); }
  }
  function _writeLS(store, value) {
    localStorage.setItem(store.lsKey, JSON.stringify(value));
  }
  function _normalize(store, value) {
    return store.normalize ? store.normalize(value) : value;
  }
  function _valueHash(store, value) {
    return _hash(JSON.stringify(_normalize(store, value)));
  }

  // Per-store sync state (last pushed hash + in-flight guard).
  const _state = new Map();
  for (const s of STORES) _state.set(s.lsKey, { lastHash: null, inFlight: false });

  async function _push(store, force = false) {
    const st = _state.get(store.lsKey);
    if (st.inFlight) return;
    const value = _normalize(store, _readLS(store));
    const h = _hash(JSON.stringify(value));
    if (!force && h === st.lastHash) return;
    st.inFlight = true;
    try {
      const r = await fetch(store.endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value }),
      });
      if (r.ok) st.lastHash = h;
    } catch {} finally {
      st.inFlight = false;
    }
  }

  async function _bootstrap(store) {
    try {
      const r = await fetch(store.endpoint);
      const d = await r.json();
      if (!d.success) return;
      const serverValue = (d.value == null) ? _defaultFor(store.type) : d.value;
      const lsValue     = _readLS(store);
      const hasServer   = _isPopulated(serverValue, store.type);
      const hasLs       = _isPopulated(lsValue,    store.type);

      // SERVER-AS-TRUTH: any server data wins. Hash-compare prevents reload
      // loops — on the second pass after reload, LS already matches server.
      if (hasServer) {
        const serverHash = _valueHash(store, serverValue);
        const currentHash = _valueHash(store, lsValue);
        if (serverHash === currentHash) {
          _state.get(store.lsKey).lastHash = currentHash;
          return false;   // no reload needed
        }
        _writeLS(store, _normalize(store, serverValue));
        _state.get(store.lsKey).lastHash = serverHash;
        console.log(`[lib-sync:${store.label}] server-as-truth — applied server value to LS`);
        return true;   // caller should reload
      }

      // Server empty + LS has data → push once so the next device gets it.
      if (hasLs) {
        console.log(`[lib-sync:${store.label}] server empty, LS has data — forcing initial push`);
        _push(store, true);
        return false;
      }

      // Both empty — prime the hash so periodic push only fires on real edits.
      _state.get(store.lsKey).lastHash = _valueHash(store, lsValue);
      return false;
    } catch (e) {
      console.warn(`[lib-sync:${store.label}] bootstrap failed:`, e.message);
      return false;
    }
  }

  // Public manual-flush hook (mirrors birolyServerSyncFlush / hooksServerSyncFlush).
  window.libraryServerSyncFlush = () => Promise.all(STORES.map(s => _push(s, true)));

  // Run all bootstraps in parallel. If ANY of them updated LS, we need ONE
  // reload to let the rest of the app re-init from the fresh data — but only
  // a single reload total (not one per store), otherwise we'd thrash.
  (async () => {
    const results = await Promise.all(STORES.map(_bootstrap));
    const needReload = results.some(Boolean);
    if (needReload) {
      console.log('[lib-sync] applied server state');
      // Reload to re-render — but bounded by the shared guard so we never loop.
      if (!window.__serverSyncReload || window.__serverSyncReload('lib')) return;
      // cap reached → fall through (server already applied to LS) and set up periodic push.
    }
    // Periodic push tick. Skip stores whose hash hasn't changed (cheap no-op).
    setInterval(() => { for (const s of STORES) _push(s); }, SYNC_INTERVAL_MS);
  })();
})();
