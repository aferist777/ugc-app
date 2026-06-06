/* ═══════════════════════════════════════════════════════════════════════════
   server-sync-guard.js — breaks the "server-as-truth" reload loop.

   The three server-sync modules (biroly-server-sync, hooks-server-sync,
   library-server-sync) each call location.reload() when the server copy of
   their store differs from localStorage, relying on hash-idempotency to stop
   after one pass. In practice the eager default-writers (biroly.js / geni.js /
   hooks.js write defaults to LS on init) race the async server pull, so the
   stores never converge in a single load and the page reload-storms.

   This guard caps the total number of sync-triggered reloads per load-chain
   (tracked in sessionStorage, which survives reloads). Once the cap is hit the
   modules apply the server value to LS WITHOUT reloading, so the page settles.
   The counter is cleared a few seconds after the page goes quiet, so a genuine
   later cross-device change can still trigger a (bounded) reload.

   Loaded BEFORE the three sync modules.
   ═══════════════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';
  const KEY = '__server_sync_reloads';
  const CAP = 3;   // one reload per synced store is enough to settle; more = a loop, so stop.

  function _count() { try { return parseInt(sessionStorage.getItem(KEY) || '0', 10) || 0; } catch { return 0; } }

  // Request a sync-triggered reload. Returns true if it reloaded (caller should
  // stop), false if the cap was reached (caller applies server→LS without reload).
  window.__serverSyncReload = function (label) {
    const c = _count();
    if (c >= CAP) {
      try { console.warn('[sync-guard] reload cap reached — applying ' + (label || 'store') + ' server state without reload (loop avoided)'); } catch {}
      return false;
    }
    try { sessionStorage.setItem(KEY, String(c + 1)); } catch {}
    location.reload();
    return true;
  };

  // Once the page has been stable (no further reload) for a moment, clear the
  // counter so future genuine changes get a fresh (bounded) reload budget.
  try {
    window.addEventListener('load', function () {
      setTimeout(function () { try { sessionStorage.removeItem(KEY); } catch {} }, 5000);
    });
  } catch {}
})();
