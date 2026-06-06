/* scen-init.js — Boot sequence: called after ALL other scen-*.js files are loaded.
   loadEditState() is here (not in scen-state.js) because it calls getCompletedSessions()
   and getSkleykaClosed() which are defined in later files. */

// Shared workspace: pull server state into localStorage BEFORE loadEditState so
// both users boot from the same projects. Falls back to whatever's local if the
// server is unreachable. (No-op key for the rest of the boot is below.)
// NB: the rest of init runs inside the async IIFE at the bottom of this file.

// ── Migrate / sync starred status for sessions ───────────────────────────────
// Rules:
//   • Session complete (≥1 videoPath, no cells in-flight) + NOT in closedSet → starred=true
//   • Session complete + in closedSet → starred=false
//   • Session incomplete → leave untouched (starred stays undefined / whatever it was)
// This covers:
//   – Old sessions (starred=undefined) that were in Склейка before this feature
//   – Sessions that got starred=false from old code but are still complete + not closed
// Idempotent: safe to call multiple times.
function _migrateStarredSessions() {
  const closedSet = getSkleykaClosed();
  let changed = false;
  for (const [key, sess] of Object.entries(editFrozenSessions)) {
    if (!Array.isArray(sess.cells)) continue;
    const audioCells = sess.cells.filter(c => c.audioPath);
    // "complete" = at least one video done, no cells still in-flight
    const complete = audioCells.length > 0 &&
      audioCells.every(c => !c._videoPending && !c.avatarTaskId) &&
      audioCells.some(c => c.videoPath);
    if (!complete) continue;

    const shouldBeStarred = !closedSet.has(key);
    // Update only if the value differs — but NEVER override a user's explicit un-star
    // (user un-star is tracked by closedSet membership, so this is safe)
    if (sess.starred !== shouldBeStarred) {
      sess.starred = shouldBeStarred;
      changed = true;
    }
  }
  if (changed) saveEditState();
}
// ── Init (async: hydrate shared state first, then the usual boot) ───────────────
(async function () {
  if (window.EditSync && EditSync.hydrate) { try { await EditSync.hydrate(); } catch {} }

  // Must be first — restores editFrozenSessions, activeObrazIds, editCardCache
  loadEditState();
  _migrateStarredSessions();

  loadScenarios();
  loadDetails();
  loadScenarioObrazы();
  // Resume any in-flight Edit panel generations that survived a restart
  resumeEditPendingCells();
  // Resume any in-flight avatar video tasks that survived a tab switch or reload
  resumeAvatarPendingCells();

  // Re-render whatever tab is showing now that real data is loaded. On the split
  // pages the router may have activated the tab BEFORE this async hydrate finished,
  // so refresh the Edit grid / Merge picker against the freshly-hydrated sessions.
  try { if (window.EDIT2Tab && EDIT2Tab.render) EDIT2Tab.render(); } catch {}
  try {
    const mv = document.getElementById('combo-sub-mergev2');
    if (window.MV2Tab && MV2Tab.activate && mv && getComputedStyle(mv).display !== 'none') MV2Tab.activate();
  } catch {}

  // Watch for other users' changes.
  if (window.EditSync && EditSync.startPolling) EditSync.startPolling();
})();

