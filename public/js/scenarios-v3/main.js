// Scenarios v3 — boot.
//
// Phase scope: the shell (four columns, library/workspace modes) plus the
// Scenario column as a scenario library. Casting / Montage / Fragments are
// stubs, and there is no script generation anywhere on this page.

import { initShell } from './shell.js';
import { initLibrary } from './library.js';
import { initProjects } from './projects.js';
import { initFragments } from './fragments.js';

async function boot() {
  initShell();
  // Fragments subscribes before any project can open, so the first open paints it.
  initFragments();
  // The bar loads next so the project dropdown is populated straight away; it
  // shows the last project but does not open it — the page starts in the library.
  try { await initProjects(); } catch (e) { console.error('[sv3] projects init failed', e); }
  try { await initLibrary(); } catch (e) { console.error('[sv3] library init failed', e); }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
