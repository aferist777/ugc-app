// Scenarios v3 — boot.
//
// There is no script generation anywhere on this page: the Scenario column is a
// library, and everything downstream works from a project made out of one.

import { initShell } from './shell.js';
import { initLibrary } from './library.js';
import { initProjects, onProjectChange } from './projects.js';
import { initFragments } from './fragments.js';
import { initMontage } from './montage.js';

async function boot() {
  initShell();
  // Both columns subscribe before any project can open, so the first open paints them.
  initFragments();
  initMontage(onProjectChange);
  // The bar loads next so the project dropdown is populated straight away; it
  // shows the last project but does not open it — the page starts in the library.
  try { await initProjects(); } catch (e) { console.error('[sv3] projects init failed', e); }
  try { await initLibrary(); } catch (e) { console.error('[sv3] library init failed', e); }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
