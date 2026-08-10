/* ═══════════════════════════════════════════════════════════════════
   HOOKS SERVER SYNC — SERVER-AS-TRUTH mirror between localStorage
   (hooks_archive_v1) and /api/hooks/state. The server's
   data/hooks.json is the single source of truth; any browser opening
   the URL pulls and renders the same data.

   The Hooks tab still reads/writes localStorage (scen-hooks.js) for
   fast UI access. On page load: if server has data, overwrite LS +
   reload. If server is empty + LS has data, push LS up (one-time
   recovery). Every 2s thereafter: hash LS, POST on change.

   Same pattern as biroly-server-sync.js. Single-user multi-device.
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
    try {
      const r = await fetch('/api/hooks/state');
      const d = await r.json();
      if (!d.success) return;
      const serverList = Array.isArray(d.list) ? d.list : [];
      const lsList = _readArray();
      const hasServer = serverList.length > 0;
      const hasLs     = lsList.length > 0;

      // ── SERVER-AS-TRUTH: server wins whenever it has data ────────────────
      // Page reload propagates server data into the live UI. Hash-compare
      // before reload prevents loops: after the rewrite-and-reload, current
      // hash matches server hash so the second pass exits silently.
      if (hasServer) {
        const serverHash = _hash(JSON.stringify(serverList));
        const currentHash = _hash(JSON.stringify(lsList));
        if (serverHash === currentHash) {
          _lastSyncedHash = currentHash;
          return;
        }
        _writeArray(serverList);
        _lastSyncedHash = serverHash;
        console.log('[hooks-sync] server-as-truth — applied server state to LS');
        if (window.__serverSyncReload) window.__serverSyncReload('hooks'); else location.reload();
        return;
      }

      // Server empty means empty. This used to push a browser's copy back up as a
      // one-time recovery, which turned "delete the library" into "delete it until the
      // next page load" — the hooks were wiped on the server (Ph16) and a stale tab
      // restored all 29 records. Server-as-truth now holds in both directions: an empty
      // server clears the local copy instead of being refilled from it.
      if (hasLs) {
        console.log('[hooks-sync] server empty — clearing the local copy');
        _writeArray([]);
        _lastSyncedHash = _snapHash();
        if (window.__serverSyncReload) window.__serverSyncReload('hooks'); else location.reload();
        return;
      }

      // Both empty — prime hash so periodic loop only pushes on real edits.
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
