/* biroly-bg-monitor.js — universal background watcher for in-flight birol
   VIDEO generations. Loaded on EVERY page.

   Why: birol generation is driven client-side by biroly.js, which only loads on
   /birols. If you start a generation and switch to another tab, the long video
   render keeps running server-side but nothing on the client notices it finish.
   This monitor closes that gap: on any page OTHER than /birols it polls the
   pending video-stage gens (localStorage 'biroly_pending_v1', stamped by
   biroly.js with vidStatusBase + currentTaskId) and, when the video is ready,
   saves it to the archive and rings a bottom-right toast + glass chime.

   Ownership / no races: on /birols the live biroly.js pipeline owns generation,
   so the monitor stays passive there. Applying a result is idempotent
   (updateBirolyEntry with the same videoPath is a no-op, the pending gen is
   removed, and a per-gen "notified" set prevents a duplicate toast), so the
   hand-off when navigating between tabs is safe. */
(function () {
  'use strict';

  var PENDING_KEY  = 'biroly_pending_v1';
  var NOTIFIED_KEY = 'biroly_bg_notified_v1';
  var POLL_MS      = 20000;  // scan cadence
  var GAP_MS       = 1200;   // gap between status requests in one scan
  var MAX_PENDING_POLLS = 30; // give up live-watching a task after ~10 min (biroly.js resume still recovers it)

  var _iv = null;
  var _busy = false;
  var _attempts = Object.create(null); // genId -> pending-poll count (in-memory, per page)

  function _onBirolsPage() {
    try { return Array.isArray(window.__PAGE_TABS) && window.__PAGE_TABS.indexOf('birols') !== -1; }
    catch (e) { return false; }
  }
  function _getPending()  { try { return JSON.parse(localStorage.getItem(PENDING_KEY) || '[]'); } catch (e) { return []; } }
  function _savePending(l){ try { localStorage.setItem(PENDING_KEY, JSON.stringify(l)); } catch (e) {} }
  function _removePending(genId) { _savePending(_getPending().filter(function (g) { return g.genId !== genId; })); }

  function _notifiedSet() { try { return new Set(JSON.parse(localStorage.getItem(NOTIFIED_KEY) || '[]')); } catch (e) { return new Set(); } }
  function _markNotified(genId) {
    var s = _notifiedSet(); s.add(genId);
    try { localStorage.setItem(NOTIFIED_KEY, JSON.stringify(Array.from(s).slice(-60))); } catch (e) {}
  }

  // Video-stage gens we can poll on our own (task id + which status endpoint).
  function _watchable() {
    var notified = _notifiedSet();
    return _getPending().filter(function (g) {
      return g && g.stage === 'video' && g.currentTaskId && g.vidStatusBase && !notified.has(g.genId);
    });
  }

  function _birolName(birolyId) {
    try {
      var a = (typeof getBirolyArchive === 'function') ? getBirolyArchive() : [];
      var e = a.find(function (x) { return x && x.id === birolyId; });
      return (e && e.name) || 'Birol';
    } catch (e) { return 'Birol'; }
  }

  async function _statusOnce(g) {
    try {
      var r = await fetch(g.vidStatusBase + encodeURIComponent(g.currentTaskId));
      var d = await r.json();
      if (d && d.state === 'success' && d.videoPath) return { state: 'success', videoPath: d.videoPath };
      if (d && d.state === 'failed')                  return { state: 'failed', error: d.error || 'video task failed' };
      return { state: 'pending' };
    } catch (e) {
      return { state: 'pending' }; // network blip — retry next scan
    }
  }

  function _toast(label, finalText, videoPath) {
    try {
      var row = window.createActivityRow && window.createActivityRow(label);
      if (row) {
        if (videoPath && row.setVideo) row.setVideo(videoPath);
        row.finalize(finalText); // success path inside finalize also rings AppChime()
      } else if (String(finalText).indexOf('❌') !== 0) {
        window.AppChime && window.AppChime(); // no activity-log host on this page — at least chime on success
      }
    } catch (e) {}
  }

  function _applySuccess(g, videoPath) {
    // Persist to the shared archive (localStorage; biroly-server-sync mirrors it).
    try {
      if (typeof updateBirolyEntry === 'function' && g.birolyId) {
        updateBirolyEntry(g.birolyId, { videoPath: videoPath, status: 'done', duration: g.duration || 6 });
      }
    } catch (e) {}
    _removePending(g.genId);
    _markNotified(g.genId);
    delete _attempts[g.genId];
    _toast('Birol · ' + _birolName(g.birolyId).slice(0, 36), '✅ Birol ready (background)', videoPath);
    try { window.refreshTimelineBirolys && window.refreshTimelineBirolys(); } catch (e) {}
  }

  function _applyFailed(g, err) {
    // Don't delete the pending gen: returning to /birols lets biroly.js retry/
    // resume it. Just surface the failure once.
    _markNotified(g.genId);
    delete _attempts[g.genId];
    _toast('Birol · ' + _birolName(g.birolyId).slice(0, 36), '❌ ' + (err || 'Birol generation failed'));
  }

  // ── Server-side generation jobs (the #2 worker) ────────────────────────────
  // Base (i2v / t2v) birols now generate on the server. This poller runs on
  // EVERY page (no /birols deferral -- the server owns the work, the client only
  // applies the result), writing the finished video to the archive entry +
  // toast/chime, then telling the server to forget the job.
  function _forgetJob(jobId) {
    try { fetch('/api/biroly/generate/' + encodeURIComponent(jobId), { method: 'DELETE' }); } catch (e) {}
  }
  async function _scanServerJobs() {
    var data;
    try { data = await fetch('/api/biroly/generate/active').then(function (r) { return r.json(); }); }
    catch (e) { return; }
    if (!data || !data.success || !Array.isArray(data.jobs) || !data.jobs.length) return;
    var notified = _notifiedSet();
    for (var i = 0; i < data.jobs.length; i++) {
      var j = data.jobs[i];
      if (!j || notified.has(j.jobId)) continue;
      if (j.status === 'done' && j.videoPath) {
        if (j.birolyId && typeof updateBirolyEntry === 'function') {
          try { updateBirolyEntry(j.birolyId, { videoPath: j.videoPath, thumbPath: j.thumbPath || null, status: 'done', duration: 6 }); } catch (e) {}
        }
        _markNotified(j.jobId);
        _toast('Birol · ' + String(j.name || (j.birolyId && _birolName(j.birolyId)) || 'Birol').slice(0, 36), '✅ Birol ready (background)', j.videoPath);
        try { window.refreshTimelineBirolys && window.refreshTimelineBirolys(); } catch (e) {}
        _forgetJob(j.jobId);
      } else if (j.status === 'error') {
        if (j.birolyId && typeof updateBirolyEntry === 'function') {
          try { updateBirolyEntry(j.birolyId, { status: 'error', errorMsg: j.error || 'generation failed' }); } catch (e) {}
        }
        _markNotified(j.jobId);
        _toast('Birol · ' + String(j.name || '').slice(0, 36), '❌ ' + String(j.error || 'generation failed').slice(0, 50));
        _forgetJob(j.jobId);
      }
      // status 'running' -> leave it; the archive card already shows 'generating'.
    }
  }

  async function _scan() {
    if (_busy) return;
    if (_onBirolsPage()) return; // live biroly.js pipeline owns generation here
    var items = _watchable();
    if (!items.length) return;
    _busy = true;
    try {
      for (var i = 0; i < items.length; i++) {
        var g = items[i];
        var r = await _statusOnce(g);
        if (r.state === 'success' && r.videoPath) {
          _applySuccess(g, r.videoPath);
        } else if (r.state === 'failed') {
          _applyFailed(g, r.error);
        } else {
          _attempts[g.genId] = (_attempts[g.genId] || 0) + 1;
          if (_attempts[g.genId] >= MAX_PENDING_POLLS) _markNotified(g.genId); // stop live-watching; /birols resume still recovers
        }
        await new Promise(function (res) { setTimeout(res, GAP_MS); });
      }
    } finally { _busy = false; }
  }

  function _tick() {
    _scan().catch(function () {});
    _scanServerJobs().catch(function () {});
  }
  function _start() {
    if (_iv) return;
    _iv = setInterval(_tick, POLL_MS);
    setTimeout(_tick, 3000); // first scan after the page settles
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _start);
  else _start();

  // Exposed for tests / manual kicks. kick() = poll server jobs now (after a
  // fresh Generate) so completion/errors surface promptly.
  window.BirolyBgMonitor = {
    scanNow: function () { return _scan(); },
    scanServerNow: function () { return _scanServerJobs(); },
    kick: function () { _scanServerJobs().catch(function () {}); },
    _watchable: _watchable,
  };
})();
