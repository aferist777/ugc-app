/* ═══════════════════════════════════════════════════════════════════════════
   MERGE v3 — page boot.

   The bar (project picker, queue, Export), the geometry (the two sashes, and which of the left
   pair is open), and the editor: the library, the inspector, the timeline and the preview of a
   project - one kind of project, an ordered list of lanes (docs/local-app/PLAN.md, phase 3).

   No editor state lives in the browser. The timeline has a server owner (js/merge-v3/store.js);
   the old Merge kept the whole editor model in one localStorage key every session shared, which
   is what made edits undo each other.
   ═══════════════════════════════════════════════════════════════════════════ */

import { initNav } from '../app-nav.js';
import { initLayout, setOpenColumn } from './layout.js';
import { initLibrary } from './library.js';
import { initTimelineB, onSelChange as onSelB, mount as mountB } from './timeline-b.js';
import { initPreviewB, mount as mountPvB } from './preview-b.js';
import { initExportB } from './export-b.js';
import { initQueue } from './queue.js';
import { initInspector } from './inspector.js';
import { initWorkshop } from './workshop.js';
import { initProjects } from './projects.js';
import * as Store from './store.js';
import { initBar } from './bar.js';

initNav();
initLayout();
initLibrary();
initTimelineB();
initPreviewB();
initExportB();
initQueue();
initInspector();
// Small and always needed - it is what decides whether there are steps at all. The steps
// themselves are loaded when they are opened.
initWorkshop();
initProjects();
initBar();

// ?open=pictures in the address, which is how the Alerts list takes somebody back to the window a
// picture was asked for in (js/alerts-bell.js). Once, when the project it names has opened.
(() => {
  let want = '';
  try { want = new URLSearchParams(location.search).get('open') || ''; } catch (e) { return; }
  if (want !== 'pictures') return;
  let opened = false;
  Store.onChange(() => {
    if (opened || !Store.key()) return;
    opened = true;
    import('./imagen.js').then(m => m.openImagen()).catch(() => { /* no picture model configured */ });
  });
})();

// Selecting anything brings the Inspector out - the left pair is a switch, so the Library folds
// to its spine by the same rule that already governs them.
//
// NOT the reverse. Deselecting does not bring the Library back, and that is deliberate: pressing
// bare lane deselects, and pressing bare lane is also how you seek. Flipping the panel on every
// scrub would be unusable. The Library's spine is one click away.
onSelB((n) => { if (n) setOpenColumn('inspector'); });

// The timeline and the preview take the panels they draw into as soon as the store has
// something to show - the empty timeline of "nothing open" included.
let _mounted = false;
Store.onChange(() => {
  if (_mounted) return;
  _mounted = true;
  mountB();
  mountPvB();
});

// NOTHING OPEN IS A REAL STATE. Entering Merge directly shows an empty timeline and waits for
// a project to be picked, so every control that would act on a project is disabled until there
// is one. The rule lives here, in one list, so a button added later cannot quietly opt out of
// it - and undo/redo are deliberately NOT in it, because history.js already enables them from
// the depth of its own stack, which is empty anyway.
// Split paints itself (js/merge-v3/bar.js): it needs a project AND a clip under the playhead.
const NEEDS_PROJECT = ['mv3-export', 'mv3-project-del'];
Store.onChange(() => {
  const has = Store.hasProject();
  // Somebody else's project counts as none for these: rendering writes export settings, and
  // deleting is refused. Copy it first.
  const can = has && Store.canEdit();
  for (const id of NEEDS_PROJECT) {
    const el = document.getElementById(id);
    if (el) el.disabled = !can;
  }
  document.body.classList.toggle('mv3-noproject', !has);
  // Open to look at. The store refuses the edits themselves (mutate); this is what says
  // why before anybody tries.
  document.body.classList.toggle('mv3-readonly', has && !can);
});

// Last, and not awaited: the shell is usable before the timeline arrives, and the store
// notifies whoever subscribed when it does. A failure here leaves the page working with an
// empty ruler rather than a blank panel and no explanation.
Store.load().catch(e => console.warn('[merge-v3] timeline store:', e.message));

// For the browser console - nothing on the page reads window.MV3.
window.MV3 = Store;
