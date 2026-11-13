/* storage-sync.js — makes localStorage SERVER-BACKED so per-browser state
   (last open project, UI prefs, engine/voice defaults, drafts) survives a
   different browser/device or a cache clear.

   MUST be the FIRST <script> in <head> of every page that loads it (Home,
   Library, Merge): it hydrates localStorage from the server synchronously,
   before page code reads it.

   - Boot: sync GET /api/ui-state -> apply server values to LS; push local-only
     keys up once (migration; the current browser seeds the server on first run).
   - localStorage.setItem/removeItem are patched -> debounced POST of only the
     changed keys ({set,del} per-key merge; no whole-blob writes -> no clobber).
   - Flush on pagehide/hidden via sendBeacon so the last edit isn't lost.
   - The library's tidy (lib/library-tidy.js, V91 block 5) took the keys nothing reads out of
     ui-state.json and left its mark there: the first page after it lets go of every key the window
     holds that the library does not - or step 2 below would push them all back up.
     Server unreachable -> silently falls back to plain localStorage.
*/
(function () {
  var API = '/api/ui-state';
  // 4MB. It was 200000, meant to keep bloated cache blobs out of the mirror - but the check is
  // silent, so it did not keep data OUT so much as leave it BEHIND: the saved Merge projects
  // grew past 200KB and simply stopped being mirrored, and the server sat on an old copy while
  // the browser carried the real one. The server is the source of truth here, so a value being
  // large is not a reason to stop telling the server about it. express.json accepts 50MB.
  var MAX_VAL = 4000000;
  // lib/library-tidy.js TIDY_MARK: the tidy's number, written into ui-state.json when it ran.
  var TIDY = 'ugc_tidied_v1';

  var LS;
  try { LS = window.localStorage; if (!LS) return; } catch (e) { return; }
  var origSet = LS.setItem.bind(LS);
  var origRemove = LS.removeItem.bind(LS);

  var pending = { set: {}, del: [] };
  var flushT = null;
  function scheduleFlush() { if (!flushT) flushT = setTimeout(flush, 800); }
  function flush(sync) {
    if (flushT) { clearTimeout(flushT); flushT = null; }
    var body = pending; pending = { set: {}, del: [] };
    if (!Object.keys(body.set).length && !body.del.length) return;
    var payload = JSON.stringify(body);
    if (sync && navigator.sendBeacon) {
      try { navigator.sendBeacon(API, new Blob([payload], { type: 'application/json' })); return; } catch (e) {}
    }
    try { fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload, keepalive: !!sync }); } catch (e) {}
  }

  // ── Boot hydrate (synchronous: page code must see server values immediately) ──
  var server = null;
  try {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', API, false);   // sync — a tiny localhost blob
    xhr.send(null);
    if (xhr.status === 200) { var d = JSON.parse(xhr.responseText); server = (d && d.state) || {}; }
  } catch (e) { server = null; }

  if (server) {
    // 0) the first page after the library's tidy: what the window holds and the library does not goes
    if (server[TIDY] && LS.getItem(TIDY) !== server[TIDY]) {
      var gone = [];
      for (var g = 0; g < LS.length; g++) { var gk = LS.key(g); if (gk && !(gk in server)) gone.push(gk); }
      for (var h = 0; h < gone.length; h++) { try { origRemove(gone[h]); } catch (e) {} }
    }
    // 1) server -> LS (server wins for keys it has)
    for (var sk in server) {
      if (!server.hasOwnProperty(sk) || !sk) continue;
      try { origSet(sk, server[sk]); } catch (e) {}
    }
    // 2) local-only keys -> push up once (migration)
    var pushUp = {};
    for (var i = 0; i < LS.length; i++) {
      var lk = LS.key(i);
      if (!lk || (lk in server)) continue;
      var lv = LS.getItem(lk);
      if (lv != null && lv.length <= MAX_VAL) pushUp[lk] = lv;
    }
    if (Object.keys(pushUp).length) { pending.set = pushUp; scheduleFlush(); }
  }

  // ── Patch mutators -> mirror to server ──
  LS.setItem = function (k, v) {
    origSet(k, v);
    if (!k) return;
    v = String(v);
    // Still a ceiling, but never a silent one again: a key that stops syncing is a key whose
    // server copy is quietly rotting, and that is worth a line in the console.
    if (v.length > MAX_VAL) {
      try {
        console.warn('[storage-sync] NOT mirrored to the server - ' + k + ' is '
          + Math.round(v.length / 1024) + 'KB, over the ' + Math.round(MAX_VAL / 1024) + 'KB ceiling.'
          + ' Its server copy is now out of date.');
      } catch (e) {}
      return;
    }
    pending.set[k] = v;
    var di = pending.del.indexOf(k); if (di >= 0) pending.del.splice(di, 1);
    scheduleFlush();
  };
  LS.removeItem = function (k) {
    origRemove(k);
    if (!k) return;
    if (Object.prototype.hasOwnProperty.call(pending.set, k)) delete pending.set[k];
    if (pending.del.indexOf(k) < 0) pending.del.push(k);
    scheduleFlush();
  };

  window.addEventListener('pagehide', function () { flush(true); });
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') flush(true); });
})();
