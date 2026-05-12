/* scen-avatar-poller.js — global background poller for talking-head avatar tasks.

   Goal: surface kie.ai failures (and recover late successes) for every avatar
   fragment, even if the per-cell pollAvatar loop was lost (page reload, tab
   switch, transient network hiccup).

   Cadence: every 60 seconds, walk all editFrozenSessions, collect cells with
   { avatarTaskId set, videoPath empty }, and re-query
   /api/audio/avatar/status/<taskId> sequentially with a small inter-request
   pause so we don't flood kie.ai.

   On failure: create a pinned ❌ row at the top of #activity-log identifying
   the fragment ("Avatar fragment N · session NAME — <error>"). The pin stays
   until the user clicks ✕ or until a fresh task replaces the failing one.
   On success: persist videoPath, drop the in-flight markers, re-render Edit/
   Skleyka and remove any previously pinned error row for this taskId.

   Auto-start/stop: the interval runs only while at least one cell has a
   pending avatarTaskId. As soon as the queue drains, the interval is cleared.
*/
(function () {
  'use strict';

  const POLL_INTERVAL_MS    = 60_000;
  const REQ_GAP_MS          = 1500;
  const _pinnedRows         = new Map(); // taskId → actRow API
  const _notifiedErrorTasks = new Set(); // taskId where we already pinned an error
  let _ivId = null;
  let _running = false;

  // ── Collect every pending avatar task across all frozen sessions ───────────
  function _collectPending() {
    const sessions = (typeof editFrozenSessions !== 'undefined') ? editFrozenSessions : null;
    if (!sessions) return [];
    const out = [];
    Object.entries(sessions).forEach(([sessionKey, sess]) => {
      const cells = sess?.cells;
      if (!Array.isArray(cells)) return;
      cells.forEach((cell, idx) => {
        if (!cell) return;
        if (!cell.avatarTaskId) return;
        if (cell.videoPath) return; // already done — handled by per-cell loop
        out.push({
          taskId: String(cell.avatarTaskId),
          sessionKey,
          cellIdx: idx,
          cell,
          sessionLabel: sess.scenarioName || sess.label || sessionKey,
        });
      });
    });
    return out;
  }

  function _sessionLabelOf(sessionKey, sess) {
    if (!sess) return sessionKey;
    return sess.scenarioName || sess.scenLabel || sess.label || sessionKey.slice(0, 24);
  }

  // ── Pin an error row to the top of the activity log (sticky until ✕) ───────
  function _pinError(taskId, fragmentIdx, sessionLabel, errText) {
    if (_notifiedErrorTasks.has(taskId)) return; // don't duplicate
    _notifiedErrorTasks.add(taskId);
    const label = `Avatar fragment ${fragmentIdx + 1} · ${sessionLabel}`;
    const row = window.createActivityRow?.(label);
    if (!row) return;
    row.pinAsError?.(`❌ ${errText || 'kie.ai task failed'}`);
    _pinnedRows.set(taskId, row);
  }

  function _unpinAndRemove(taskId) {
    const row = _pinnedRows.get(taskId);
    if (row) {
      try { row.unpinError?.(); row.remove?.(); } catch {}
      _pinnedRows.delete(taskId);
    }
    _notifiedErrorTasks.delete(taskId);
  }

  // ── Talk to status endpoint; normalise the result shape ────────────────────
  async function _statusOnce(taskId) {
    try {
      const r = await fetch(`/api/audio/avatar/status/${encodeURIComponent(taskId)}`);
      const d = await r.json();
      if (!d || d.success === false) return { state: 'failed', error: d?.error || 'status check failed' };
      if (d.state === 'success') return { state: 'success', videoPath: d.videoPath };
      if (d.state === 'failed')  return { state: 'failed',  error: d.error || 'kie.ai reported failed' };
      return { state: d.state || 'pending' };
    } catch (e) {
      return { state: 'failed', error: e.message || 'network error' };
    }
  }

  // ── Main scan: poll every pending task sequentially with a gap ─────────────
  async function _scanAndPoll() {
    const pending = _collectPending();
    if (!pending.length) {
      // queue drained — stop the interval
      stopAvatarPoller();
      return;
    }
    console.log(`[avatar-poller] scanning ${pending.length} pending task(s)`);

    for (const item of pending) {
      const r = await _statusOnce(item.taskId);
      if (r.state === 'success' && r.videoPath) {
        // Success — write videoPath to the cell, clear in-flight markers
        try {
          item.cell.videoPath = r.videoPath;
          item.cell.videoError = null;
          delete item.cell.avatarTaskId;
          delete item.cell._videoPending;
          window.saveEditState?.();
          // If we previously pinned an error for this taskId (e.g. a transient
          // failure that later recovered), drop the pin.
          _unpinAndRemove(item.taskId);
          // Trigger UI refresh
          window.renderEditPanel?.();
          window.renderMontagePanel?.();
          window.renderAllTimelines?.();
        } catch (e) {
          console.warn('[avatar-poller] success apply failed:', e.message);
        }
      } else if (r.state === 'failed') {
        // Pin error row at the top of activity log (sticky)
        const sess = editFrozenSessions[item.sessionKey];
        const label = _sessionLabelOf(item.sessionKey, sess);
        _pinError(item.taskId, item.cellIdx, label, r.error);
        // Mirror error onto the cell so the Edit-panel UI shows it too
        try {
          item.cell.videoError = r.error || 'kie.ai failed';
          delete item.cell._videoPending;
          window.saveEditState?.();
          window.renderEditPanel?.();
        } catch {}
      }
      // else: pending → leave alone, will re-check next minute

      // Small gap between requests to avoid hammering kie.ai
      await new Promise(res => setTimeout(res, REQ_GAP_MS));
    }
  }

  function startAvatarPoller() {
    if (_ivId) return;
    _running = true;
    console.log('[avatar-poller] starting (every 60s)');
    _ivId = setInterval(() => {
      if (!_running) return;
      _scanAndPoll().catch(e => console.warn('[avatar-poller] scan error:', e.message));
    }, POLL_INTERVAL_MS);
    // Fire one scan immediately so the first poll doesn't wait the full 60s
    _scanAndPoll().catch(e => console.warn('[avatar-poller] first scan error:', e.message));
  }

  function stopAvatarPoller() {
    if (!_ivId) return;
    console.log('[avatar-poller] stopping (no pending tasks)');
    clearInterval(_ivId);
    _ivId = null;
    _running = false;
  }

  // Called whenever a new avatarTaskId is set (or on page load) — starts the
  // poller if there's anything to poll, otherwise stays idle.
  function maybeStartAvatarPoller() {
    if (_ivId) return; // already running
    const pending = _collectPending();
    if (pending.length) startAvatarPoller();
  }

  window.startAvatarPoller     = startAvatarPoller;
  window.stopAvatarPoller      = stopAvatarPoller;
  window.maybeStartAvatarPoller = maybeStartAvatarPoller;

  // Kick the initial check once the DOM is ready (handles F5 reload case where
  // editFrozenSessions was rehydrated from localStorage with in-flight tasks).
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(maybeStartAvatarPoller, 1500));
  } else {
    setTimeout(maybeStartAvatarPoller, 1500);
  }
})();
