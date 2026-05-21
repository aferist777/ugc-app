/* ═══════════════════════════════════════════════════════════════════
   HOOKS SERVER SYNC — background mirror between localStorage and
   /api/hooks/state so the hooks_archive_v1 metadata survives cache
   wipes and can be moved between instances via Import/Export.

   The Hooks tab continues to read/write localStorage as before
   (scen-hooks.js) — this module just shuttles the snapshot between
   LS and the server. Same pattern as biroly-server-sync.js.
   ═══════════════════════════════════════════════════════════════════ */

(function () {
  const LS_KEY = 'hooks_archive_v1';
  const SYNC_INTERVAL_MS = 2000;

  function _readArray() {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]'); }
    catch { return []; }
  }
  function _writeArray(a) {
    localStorage.setItem(LS_KEY, JSON.stringify(a));
  }

  function _hash(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
    return h >>> 0;
  }
  function _snapHash() { return _hash(JSON.stringify(_readArray())); }

  let _lastSyncedHash = null;
  let _inFlight = false;

  async function _push(force = false) {
    if (_inFlight) return;
    const list = _readArray();
    const h    = _hash(JSON.stringify(list));
    if (!force && h === _lastSyncedHash) return;
    _inFlight = true;
    try {
      const r = await fetch('/api/hooks/state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ list }),
      });
      if (r.ok) _lastSyncedHash = h;
    } catch {} finally {
      _inFlight = false;
    }
  }

  async function _bootstrapFromServer() {
    // Force-pull sentinel set by data-io.js after a successful Import — when
    // fresh, server is authoritative regardless of LS state.
    const _imp = parseInt(localStorage.getItem('__just_imported_at') || '0', 10);
    const justImported = _imp && (Date.now() - _imp < 30_000);

    try {
      const r = await fetch('/api/hooks/state');
      const d = await r.json();
      if (!d.success) return;
      const serverList = Array.isArray(d.list) ? d.list : [];
      const lsList = _readArray();
      const hasServer = serverList.length > 0;
      const hasLs     = lsList.length > 0;

      if (justImported && hasServer) {
        _writeArray(serverList);
        _lastSyncedHash = _snapHash();
        // Do NOT clear the sentinel here — biroly-server-sync also reads it.
        // Both bootstraps run on the same page load; whichever runs second
        // would otherwise skip its force-pull and a sync race could reappear.
        // The sentinel naturally expires after 30s.
        console.log('[hooks-sync] post-import force-pull applied');
        return;
      }

      if (hasServer && !hasLs) {
        _writeArray(serverList);
        _lastSyncedHash = _snapHash();
        console.log('[hooks-sync] applied server state to empty LS');
        return;
      }

      if (hasLs && !hasServer) {
        // LS has data, server empty — push current LS up so the server snapshot
        // catches up immediately rather than waiting on the periodic tick.
        console.log('[hooks-sync] LS has data, server empty — forcing initial push');
        _push(true);
        return;
      }

      // Both have data (or both empty) — initialize hash from current LS so the
      // periodic loop only pushes when the user actually edits something.
      _lastSyncedHash = _snapHash();
    } catch (e) {
      console.warn('[hooks-sync] bootstrap failed:', e.message);
    }
  }

  window.hooksServerSyncFlush = () => _push(true);

  _bootstrapFromServer().then(() => {
    setInterval(_push, SYNC_INTERVAL_MS);
  });
})();
