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
import { initExportB, paintExportButton } from './export-b.js';
import { initQueue } from './queue.js';
import { initInspector } from './inspector.js';
import { initWorkshop, settled as wkSettled, isTalking, step as wkStep, setStep } from './workshop.js';
import { initProjects } from './projects.js';
import * as Store from './store.js';
import { initBar } from './bar.js';
import { initPicChat, openPictures } from './picchat.js';
import { initVidChat, openVideos } from './vidchat.js';
import { initAudChat, openAudio } from './audchat.js';
import { initFramesChat } from './fchat.js';
import { initViews } from './lib-views.js';
import { initScenarios } from './scen-pick.js';
import { initHighlights } from './highlights.js';
// (phase V62, block 2) A voiceover's B-roll piece, another item for it - a view of the Library panel.
import { initBroll } from './broll-view.js';
// (phase V62) A voiceover's tips, step by step, over the page.
import { initVoTips } from './vo-tips.js';
import { askModelOnce } from './model-ask.js';

initNav();
initLayout();
initViews();
initLibrary();
initPicChat();
initVidChat();
initAudChat();
initScenarios();
initHighlights();
initBroll();
initVoTips();
initFramesChat();
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
// (phase V30, block 1) The speech model for captions, offered once when the program first starts (js/merge-v3/model-ask.js) -
// a moment after the page, so a draft left by an app that closed without asking is asked about first.
setTimeout(() => { askModelOnce().catch(() => {}); }, 2500);

// ?open=pictures in the address, which is how the Alerts list takes somebody back to the chat a
// picture was asked for in (js/alerts-bell.js). Once, when the project it names has opened. In a
// talking head the Library comes with the timeline step, so that step is taken first.
async function _pictures() {
  await wkSettled();
  if (isTalking() && wkStep() !== 'timeline') setStep('timeline');
  return openPictures();
}
// ...and ?open=videos, the video chat's (phase V3), the same way.
async function _videos() {
  await wkSettled();
  if (isTalking() && wkStep() !== 'timeline') setStep('timeline');
  return openVideos();
}
// ...and ?open=audio, "generate audio"'s (phase V34.E).
async function _audio() {
  await wkSettled();
  if (isTalking() && wkStep() !== 'timeline') setStep('timeline');
  return openAudio();
}
const _OPENERS = { pictures: _pictures, videos: _videos, audio: _audio };
(() => {
  let want = '';
  try { want = new URLSearchParams(location.search).get('open') || ''; } catch (e) { return; }
  if (!_OPENERS[want]) return;
  let opened = false;
  Store.onChange(() => {
    if (opened || !Store.key()) return;
    opened = true;
    // Said once: the address forgets it, or a reload after going back to the shelf would return here.
    try {
      const u = new URL(location.href);
      u.searchParams.delete('open');
      history.replaceState({}, '', u);
    } catch (e) { /* a reload only opens it again */ }
    _OPENERS[want]().catch(e => console.warn('[merge-v3] ' + want + ':', e.message));
  });
})();

// (phase TG, block 5c; the owner's answer (ю)) ?highlights=<a link> - a long video of REFERENCES sent "to highlights": a new
// highlights project with its popup open and the link written in. Its tile STAYS (after block 8, the owner's (Y2)): the
// project downloads the video, and the server lets the tile go then - the downloaded video is in its place
// (lib/sources-store.js update). From the post viewer on this page itself, without a reload: window.__ugcHighlightsFrom.
// (`ref` of older addresses is not used any more.)
async function _highlightsFrom(url, _ref, sourceId) {
  const HL = await import('./highlights.js');
  await HL.createHighlights({ url, sourceId });
}
window.__ugcHighlightsFrom = (url, ref, sourceId) => { _highlightsFrom(url, ref, sourceId).catch(e => console.warn('[merge-v3] highlights:', e.message)); };
(() => {
  // (block 6) ?highlights=&source=<id> - a video of YOUTUBE (a source of the Library) chosen in the popup already.
  let url = '', ref = '', source = '';
  try { const q = new URLSearchParams(location.search); url = q.get('highlights') || ''; ref = q.get('ref') || ''; source = q.get('source') || ''; } catch (e) { return; }
  if (!url && !source) return;
  let done = false;
  Store.onChange(() => {
    if (done || !Store.key()) return;
    done = true;
    try {
      const u = new URL(location.href);
      u.searchParams.delete('highlights');
      u.searchParams.delete('ref');
      u.searchParams.delete('source');
      history.replaceState({}, '', u);
    } catch (e) { /* a reload would make another project */ }
    _highlightsFrom(url, ref, source).catch(e => console.warn('[merge-v3] highlights:', e.message));
  });
})();

// ?reveal=<a file> in the address - how the Alerts row of a picture that has landed brings
// somebody to it (js/alerts-bell.js, phase L4): the Library open on the images shelf, the picture
// lit. In a talking head the Library comes with the timeline step, so that step is taken first,
// once the project has been read and its step decided. Said once: the address forgets it, or a
// reload after walking the shelf would jump back to the picture.
async function _reveal(path) {
  await wkSettled();
  // (phase V64) The chats and the generators are windows over the page: the file is shown in the Library panel behind them -
  // every window goes first (the sound window too, fix (д)).
  const { closeChatWindows } = await import('./chat-window.js');
  closeChatWindows();
  const GW = await import('../gen-window.js');
  for (const f of GW.frames()) f.close();
  if (isTalking() && wkStep() !== 'timeline') setStep('timeline');
  const L = await import('./library.js');
  return L.reveal(path);
}
(() => {
  let path = [];
  // (phase V64, fix (д)) Several (?reveal=a&reveal=b) - the two tracks of a press of Suno, all outlined.
  try { path = new URLSearchParams(location.search).getAll('reveal').filter(Boolean); } catch (e) { return; }
  if (!path.length) return;
  let done = false;
  Store.onChange(() => {
    if (done || !Store.key()) return;
    done = true;
    try {
      const u = new URL(location.href);
      u.searchParams.delete('reveal');
      history.replaceState({}, '', u);
    } catch (e) { /* a reload only shows it again */ }
    _reveal(path).catch(e => console.warn('[merge-v3] reveal:', e.message));
  });
})();
// ...and without a reload, when the row is pressed on this page with that project already open:
// the Alerts list asks the page first (js/alerts-bell.js, `ugc:goto`).
window.addEventListener('ugc:goto', (e) => {
  let u;
  try { u = new URL((e.detail && e.detail.href) || '', location.href); } catch (err) { return; }
  if (u.pathname !== location.pathname || u.searchParams.get('p') !== Store.key()) return;
  const path = u.searchParams.getAll('reveal').filter(Boolean);
  if (path.length) {
    e.preventDefault();
    _reveal(path).catch(err => console.warn('[merge-v3] reveal:', err.message));
    return;
  }
  // A picture still being made leads to its chat - on the spot, with this project open (phase J).
  const open = u.searchParams.get('open') || '';
  if (_OPENERS[open]) {
    e.preventDefault();
    _OPENERS[open]().catch(err => console.warn('[merge-v3] ' + open + ':', err.message));
  }
});

// PICKING SOMETHING SHOWS THE LIBRARY, and the settings of what was picked slide over it from
// the right (phase L5, the owner 2026-09-23; js/merge-v3/inspector.js paints the strip). It used
// to fold the Library away and bring the Inspector out - which is Setup now, and has nothing to
// say about a clip. Letting go of the pick takes the strip away, and the Library is still there.
onSelB((n) => { if (n) setOpenColumn('library'); });

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
// The render button is painted by its owner (js/merge-v3/export-b.js): the same rule, and in a highlights project its
// ticked fragments too (phase V33.4).
const NEEDS_PROJECT = ['mv3-project-del'];
Store.onChange(() => {
  const has = Store.hasProject();
  // Somebody else's project counts as none for these: rendering writes export settings, and
  // deleting is refused. Copy it first.
  const can = has && Store.canEdit();
  for (const id of NEEDS_PROJECT) {
    const el = document.getElementById(id);
    if (el) el.disabled = !can;
  }
  paintExportButton();
  document.body.classList.toggle('mv3-noproject', !has);
});

// Last, and not awaited: the shell is usable before the timeline arrives, and the store
// notifies whoever subscribed when it does. A failure here leaves the page working with an
// empty ruler rather than a blank panel and no explanation.
Store.load().catch(e => console.warn('[merge-v3] timeline store:', e.message));

// For the browser console - nothing on the page reads window.MV3.
window.MV3 = Store;
