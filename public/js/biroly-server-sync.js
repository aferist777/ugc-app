/* ═══════════════════════════════════════════════════════════════════
   BIROLY SERVER SYNC — SERVER-AS-TRUTH mirror between localStorage
   and /api/biroly/state. The server's data/biroly.json is the single
   source of truth — any browser / device / fresh tab opens the URL
   and sees identical data.

   The Biroly tab still reads/writes localStorage as before (biroly_cats,
   biroly_slots_v2, biroly_archive_v1) for fast UI access. This module:
   1. On page load: GET /api/biroly/state. If server has ANY data,
      overwrite LS unconditionally + reload page so the UI re-renders
      from the freshly-pulled state. If server is empty AND LS has data,
      push LS up (one-time bootstrap recovery, e.g. after a server wipe).
   2. Every 2s thereafter: hash LS, POST to server only on change.

   Trade-offs of server-as-truth: edits on one device take effect on
   another only after the second device reloads. Concurrent edits on
   multiple devices: last push wins (no merge). Acceptable for a
   single-user multi-device workflow; real-time sync would need SSE.
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

      // ── SERVER-AS-TRUTH: server wins whenever it has data ────────────────
      // No more "LS wins if both have data" — that caused stale local copies
      // on one device to overwrite the server and break cross-device sync.
      // Hash-compare prevents reload loops: after the reload-and-rewrite,
      // currentHash matches serverHash so the second pass exits silently.
      if (hasServerData) {
        const serverSnap = { cats: s.cats || [], slots: s.slots || {}, archive: s.archive || [] };
        const serverHash = _snapshotHash(serverSnap);
        const currentHash = _snapshotHash(_snapshot());
        if (serverHash === currentHash) {
          _lastSyncedHash = currentHash;
          return;
        }
        _write(LS_CATS,    s.cats || []);
        _write(LS_SLOTS,   s.slots || {});
        _write(LS_ARCHIVE, s.archive || []);
        _lastSyncedHash = serverHash;
        console.log('[biroly-sync] server-as-truth — applied server state to LS');
        if (window.__serverSyncReload) window.__serverSyncReload('biroly'); else location.reload();
        return;
      }

      // Server is empty. If LS has data this is a one-time bootstrap recovery
      // (e.g. server file was wiped/corrupted) — push LS up so the next device
      // to open the app gets it. Without this, fresh devices would see nothing.
      if (hasLsData) {
        console.log('[biroly-sync] server empty, LS has data — forcing initial push');
        _push(true);
        return;
      }

      // Both empty — prime the hash so periodic pushes only fire on real edits.
      _lastSyncedHash = _snapshotHash(_snapshot());
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
