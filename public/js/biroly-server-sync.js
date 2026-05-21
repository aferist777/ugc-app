/* ═══════════════════════════════════════════════════════════════════
   BIROLY SERVER SYNC — background mirror between localStorage and
   /api/biroly/state so cats/slots/archive survive cache wipes and can
   be moved between instances via the Import/Export popup.

   The Biroly tab itself still reads/writes localStorage as before
   (biroly_cats, biroly_slots_v2, biroly_archive_v1). This module just
   shuttles state between LS and the server — zero changes to biroly.js.

   Flow:
   1. On page load: GET /api/biroly/state. If server has data and LS is
      empty (or older), overwrite LS, fire `biroly:server-sync-applied`
      so biroly.js re-renders from fresh LS.
   2. Every 2s thereafter: read the three LS keys, compute a cheap hash,
      and POST to server only if the hash changed. Drops noisy writes.
   ═══════════════════════════════════════════════════════════════════ */

(function () {
  const LS_CATS    = 'biroly_cats';
  const LS_SLOTS   = 'biroly_slots_v2';
  const LS_ARCHIVE = 'biroly_archive_v1';
  const SYNC_INTERVAL_MS = 2000;

  function _read(key, def) {
    try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(def)); }
    catch { return def; }
  }
  function _write(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  // Cheap deterministic hash — enough to detect "did anything change"
  function _hash(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
    return h >>> 0;
  }

  function _snapshot() {
    const cats    = _read(LS_CATS, []);
    const slots   = _read(LS_SLOTS, {});
    const archive = _read(LS_ARCHIVE, []);
    return { cats, slots, archive };
  }
  function _snapshotHash(snap) {
    return _hash(JSON.stringify(snap));
  }

  let _lastSyncedHash = null;
  let _inFlight = false;

  // `force=true` bypasses the hash early-return — used by the manual flush
  // before Export so the bundle always contains the very latest LS state, and
  // by the bootstrap so the first sync after page-load actually happens even
  // if the server's hash already matches.
  async function _push(force = false) {
    if (_inFlight) return;
    const snap = _snapshot();
    const h    = _snapshotHash(snap);
    if (!force && h === _lastSyncedHash) return;
    _inFlight = true;
    try {
      const r = await fetch('/api/biroly/state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(snap),
      });
      if (r.ok) _lastSyncedHash = h;
    } catch {} finally {
      _inFlight = false;
    }
  }

  async function _bootstrapFromServer() {
    // Force-pull sentinel — set by data-io.js right after a successful Import.
    // While it's fresh, the server is authoritative: overwrite LS regardless
    // of what's there, then reload. Clears the sentinel afterwards so the
    // next bootstrap falls back to normal merge logic.
    const _imp = parseInt(localStorage.getItem('__just_imported_at') || '0', 10);
    const justImported = _imp && (Date.now() - _imp < 30_000);

    try {
      const r = await fetch('/api/biroly/state');
      const d = await r.json();
      if (!d.success || !d.state) return;
      const s = d.state;
      const hasServerData =
        (Array.isArray(s.cats)    && s.cats.length    > 0) ||
        (s.slots && Object.keys(s.slots).length > 0) ||
        (Array.isArray(s.archive) && s.archive.length > 0);
      const hasLsData =
        (_read(LS_CATS, []).length > 0) ||
        Object.keys(_read(LS_SLOTS, {})).length > 0 ||
        (_read(LS_ARCHIVE, []).length > 0);

      if (justImported && hasServerData) {
        // Force overwrite — even if LS has data (likely just defaults written
        // by biroly.js init), the server is the source of truth right after Import.
        // Hash-compare guard prevents an infinite reload loop: after we apply
        // server state and reload, this branch fires again on the new page
        // load; LS will already match server then, so we skip the reload.
        const serverSnap = { cats: s.cats || [], slots: s.slots || {}, archive: s.archive || [] };
        const serverHash = _snapshotHash(serverSnap);
        const currentHash = _snapshotHash(_snapshot());
        if (serverHash === currentHash) {
          _lastSyncedHash = currentHash;
          console.log('[biroly-sync] post-import: LS already matches server, no reload needed');
          // Do NOT clear __just_imported_at — sibling bootstraps (hooks-server-sync)
          // also key off it. The sentinel naturally expires after 30s.
          return;
        }
        _write(LS_CATS,    s.cats || []);
        _write(LS_SLOTS,   s.slots || {});
        _write(LS_ARCHIVE, s.archive || []);
        _lastSyncedHash = serverHash;
        console.log('[biroly-sync] post-import force-pull — reloading to re-render');
        location.reload();
        return;
      }

      // Server wins only if LS is empty AND server has something. Otherwise
      // current session's LS is kept — first sync push will overwrite server.
      if (hasServerData && !hasLsData) {
        _write(LS_CATS,    s.cats || []);
        _write(LS_SLOTS,   s.slots || {});
        _write(LS_ARCHIVE, s.archive || []);
        _lastSyncedHash = _snapshotHash(_snapshot());
        // biroly.js / biroly-archive.js already finished their synchronous
        // init reading the empty LS. A reload is the most robust way to make
        // them re-bootstrap with the freshly-restored data. Guarded by the
        // override condition above, so we never reload more than once per
        // session: after the reload, LS has data → no override → no reload.
        console.log('[biroly-sync] applied server state to LS — reloading to re-render');
        location.reload();
        return;
      } else if (hasLsData && !hasServerData) {
        // LS already has data and server is empty — force a one-shot push to
        // upload the existing state immediately. Without this, the periodic
        // hash-equality check below would suppress any push until the user
        // actually edits a slot.
        console.log('[biroly-sync] LS has data, server empty — forcing initial push');
        _push(true);
      } else {
        // Both empty (or both have matching data) — initialize the hash so
        // the first push only happens when the user actually edits something.
        _lastSyncedHash = _snapshotHash(_snapshot());
      }
    } catch (e) {
      console.warn('[biroly-sync] bootstrap failed:', e.message);
    }
  }

  // Public hook so other code (e.g. Import/Export popup) can force an immediate push.
  // Always forces (bypasses hash equality) — the caller wants the server to be current.
  window.birolyServerSyncFlush = () => _push(true);

  _bootstrapFromServer().then(() => {
    setInterval(_push, SYNC_INTERVAL_MS);
  });
})();
