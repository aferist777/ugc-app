/* ═══════════════════════════════════════════════════════════════════════════
   MERGE v3 — page boot.

   The shell has two live parts: the top bar (which entry is lit, and the balance
   chip) and the geometry (the two sashes, and which of the left pair is open).
   Everything else on the page is an empty labelled region, so there is nothing
   else to wire yet.

   Deliberately NOT here, and worth saying so rather than discovering it later:
   no edit-sync, no timeline store, no editor state of any kind. The old Merge kept
   the whole editor model in one localStorage key that every session shared, which
   is what made edits undo each other. Whatever state this page grows, it gets a
   server owner from the start.
   ═══════════════════════════════════════════════════════════════════════════ */

import { initNav } from '../app-nav.js';
import { initLayout, setOpenColumn } from './layout.js';
import { initLibrary } from './library.js';
import { initTimeline, onSelect, selectTrack, mount as mountA, unmount as unmountA } from './timeline.js';
import { initSubsStale } from './subtitles.js';
import { initTimelineB, onSelChange as onSelB, mount as mountB, unmount as unmountB } from './timeline-b.js';
import { initPreviewB, mount as mountPvB, unmount as unmountPvB } from './preview-b.js';
import { initExportB } from './export-b.js';
import { initQueue } from './queue.js';
import { initInspector } from './inspector.js';
import { initPreview, mount as mountPvA, unmount as unmountPvA } from './preview.js';
import { initProjects } from './projects.js';
import { initOverlays } from './overlays.js';
import { initExport } from './export.js';
import * as Store from './store.js';

initNav();
initLayout();
initLibrary();
initTimeline();
initTimelineB();
initPreviewB();
initExportB();
initQueue();
initInspector();
initPreview();
initProjects();
initOverlays();
initExport();
// "The timeline changed - regenerate subtitles", in the top bar. Selecting the subtitle
// track is all it has to do: the rule below brings the Inspector out for any selection, so
// the Regenerate button is on screen in one click.
initSubsStale(() => selectTrack('subs'));

// Selecting anything brings the Inspector out - the left pair is a switch, so the
// Library folds to its spine by the same rule that already governs them.
//
// NOT the reverse. Deselecting does not bring the Library back, and that is deliberate:
// pressing bare lane deselects, and pressing bare lane is also how you seek. Flipping
// the panel on every scrub would be unusable. The Library's spine is one click away.
//
// A drop from the library does not select the new clip either - it would fold away the
// panel you are dragging out of, mid-way through placing several clips.
onSelect((sel) => { if (sel) setOpenColumn('inspector'); });
// The blank timeline keeps its own selection and has to say so itself - it does not go
// through onSelect, so without this line clicking a clip there filled a panel nobody could
// see. Same rule, same reason: picking something is how you say "I want to change this".
onSelB((n) => { if (n) setOpenColumn('inspector'); });

// WHICH EDITOR IS SHOWING. Merge holds two timelines that draw into the same panel: the one
// that came from Scenarios and the one for projects made here. They are separate modules on
// purpose - the talking-head path is debugged and shipping, and a shared file would make every
// change meant for blank projects a change to it.
//
// The swap happens here and nowhere else, so neither module has to know the other exists. It
// runs on the store's change because that is when the open project - and therefore its type -
// can have changed.
let _showing = null;
Store.onChange(() => {
  const want = Store.isBlank() ? 'blank' : 'talking';
  if (want === _showing) return;
  _showing = want;
  // Timeline AND preview together: the two halves of one workflow, swapped as a pair so a
  // blank project can never end up edited by one and drawn by the other.
  if (want === 'blank') { unmountA(); unmountPvA(); mountB(); mountPvB(); }
  else { unmountB(); unmountPvB(); mountA(); mountPvA(); }

  // Overlays copies a Birols/Hooks/Halfers arrangement between SCENARIO projects and hands it
  // back to the scenario. A blank project has none of those lanes and no scenario behind it,
  // so the button has nothing to act on - hidden rather than disabled, because a control that
  // can never apply here is not a control that is temporarily unavailable.
  const ov = document.getElementById('mv3-pull');
  if (ov) ov.hidden = (want === 'blank');
});

// NOTHING OPEN IS A REAL STATE. Entering Merge directly shows an empty timeline and waits for
// a project to be picked, so every control that would act on a project is disabled until there
// is one. The rule lives here, in one list, so a button added later cannot quietly opt out of
// it - and undo/redo are deliberately NOT in it, because history.js already enables them from
// the depth of its own stack, which is empty anyway.
const NEEDS_PROJECT = ['mv3-export', 'mv3-project-del', 'mv3-pull', 'mv3-split'];
Store.onChange(() => {
  const has = Store.hasProject();
  // Somebody else's project counts as none for these: rendering writes export settings,
  // pulling and splitting write the timeline, and all of it is refused. Copy it first.
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

// Last, and not awaited: the shell is usable before the timeline arrives, and the
// store notifies whoever subscribed when it does. A failure here leaves the page
// working with an empty ruler rather than a blank panel and no explanation.
Store.load().catch(e => console.warn('[merge-v3] timeline store:', e.message));

// Exposed for the browser console while the editor is being built - nothing on the
// page reads window.MV3. It is how a clip gets onto a lane before the drag-and-drop
// of the next phase exists.
window.MV3 = Store;
