/* scen-init.js — Boot sequence: called after ALL other scen-*.js files are loaded.
   loadEditState() is here (not in scen-state.js) because it calls getCompletedSessions()
   and getSkleykaClosed() which are defined in later files. */

// Must be first — restores editFrozenSessions, activeObrazIds, editCardCache
loadEditState();

// ── Init ──────────────────────────────────────────────────────────────────────
loadScenarios();
loadDetails();
loadScenarioObrazы();
// Resume any in-flight Edit panel generations that survived a restart
resumeEditPendingCells();
// Resume any in-flight avatar video tasks that survived a tab switch or reload
resumeAvatarPendingCells();

