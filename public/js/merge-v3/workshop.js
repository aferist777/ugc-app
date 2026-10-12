/* ════════════════════════════════════════════════════════════════════════════
   MERGE — the workshop of a TALKING HEAD project.

   A talking head is not assembled by hand: it is BUILT - who says it, where, in what
   voice, and the frame and the clip of every fragment - and only then is there a
   timeline to edit. That building used to be a page of its own, then three steps of
   this panel; it is ONE step now, `setup`, with `timeline` beside it (decided with the
   owner 2026-09-21, docs/local-app/PLAN.md "Сцена, setup и таймлайн-зеркало", phase M).

   WHICH PROJECTS. Only those with a scenario behind them, and the key says so: a cut
   sent from Scenarios, and now a project made from a scenario here, is keyed
   sv3_<project id> (lib/merge-store.js puts its file in that project's folder). A
   blank project has no scenario, no fragments and nothing to step through, so it
   never sees any of this.

   THE BUILD STEP IS LOADED WHEN IT IS OPENED, a module of its own. It is the biggest thing
   on this page - characters, looks, environments, frames - and most visits to Merge never
   open it. `timeline` is not a module: in that step the Setup panel is folded, the Library
   is open and the settings of whatever is picked slide over it (js/merge-v3/inspector.js).

   WHILE SETUP IS OPEN THE TIMELINE IS LOCKED AND THE LIBRARY FOLDED (js/merge-v3/layout.js):
   the cut is laid from the fragments, so until there is one there is nothing to edit. The
   folded Library is the way to the timeline, and it waits for the first read laid (phase L,
   the owner 2026-09-23; decided with the owner 2026-09-21, docs/local-app/PLAN.md "Сцена,
   setup и таймлайн-зеркало").

   WHAT IS STORED WHERE. What has been CHOSEN - the character, the look, the place,
   the frames - is the scenario project and lives on the server, where it always has.
   Which step is open is not work: it is remembered per project in this browser, so
   coming back lands where you left without a write to the project for every click.
   ════════════════════════════════════════════════════════════════════════════ */

import * as Store from './store.js';
import * as PV from './preview-b.js';
import { lock, setOpenColumn, onColumnAsk, roomForWork, roomForTimeline } from './layout.js';
import { isRead, isLive } from './scen-api.js';

// TWO STEPS (decided with the owner 2026-09-21): `setup` builds the project, `timeline` edits the
// result. There are NO CHIPS for them any more (phase L, the owner 2026-09-23): the pair of panels
// is the switch. The Setup panel open is the setup step; the Library spine pressed is the timeline
// step - the timeline unlocked, the Library open, the settings of a clip sliding over it - and the
// Setup spine pressed is setup again (_ask below).
const STEPS = ['setup', 'timeline'];
// What a step used to be called, so an address in an old journal row and a step remembered in this
// browser still land somewhere (lib/alerts.js, and `mv3_step_v1` below).
const WAS = { setting: 'setup', fragments: 'setup', frames: 'setup', voice: 'setup', video: 'setup' };
const _stepId = (id) => { const s = WAS[String(id || '')] || String(id || ''); return STEPS.includes(s) ? s : ''; };
const KEY = 'mv3_step_v1';               // { <timeline key>: <step id> }

let _key = '';                           // the open timeline's key
let _pid = '';                           // the scenario project behind it, when there is one
let _project = null;                     // its record, fetched once per project
let _step = 'timeline';
let _onChange = null;

/** The scenario project id a talking-head timeline carries, or '' for a blank one. */
export function projectIdOf(key) {
  const m = /^sv3_([^_]+)(?:_\d+)?$/.exec(String(key || ''));
  return m ? m[1] : '';
}

/** Is a talking-head project open? */
export function isTalking() { return !!_pid; }

/** The step showing now. 'timeline' means the cut is being edited: the Library open, Setup folded. */
export function step() { return _step; }

/** Is the BUILD step open - the case where this panel owns the Setup panel? */
export function active() { return !!_pid && _step !== 'timeline'; }

/** The scenario project record, or null while it is still being read. */
export function project() { return _project; }

/** The inspector hands us its repaint. */
export function onChange(fn) { _onChange = fn; }

const _repaint = () => { if (_onChange) _onChange(); };
// The stage belongs to a build step while one is open, and to the timeline otherwise - and the
// timeline and the Library the other way round: locked while a step is open (js/merge-v3/layout.js).
// And in a talking head the open PANEL is the step (phase L): Setup for setup, the Library for
// the timeline. A blank project has no Setup and leaves the pair alone.
const _lend = () => {
  PV.borrow(active());
  lock(active());
  if (_pid) setOpenColumn(active() ? 'inspector' : 'library');
};

// How far the script has got - what the Library spine says while it waits (below, _paintSpines).
function _readCount() {
  // The lines that are IN the video: one taken off is not waited for (phase Z, scen-api.js).
  const lines = ((_project && Array.isArray(_project.lines)) ? _project.lines : []).filter(isLive);
  return { read: lines.filter(isRead).length, total: lines.length };
}
// IS THERE ANYTHING TO EDIT? The timeline opens as soon as the first read has been laid on it
// (the owner, 2026-09-22): a cut of two fragments is a cut, and waiting for the last line before
// letting anybody look at it helps nobody. Anything on any lane counts - the mirror's cells
// (lib/frag-mirror.js) and whatever the person put there themselves.
function _hasCut() {
  const tl = Store.timeline();
  return !!(tl && (tl.tracks || []).some(t => (t.clips || []).length));
}
function _mayEdit() {
  if (_hasCut()) return true;
  // Before the page has the timeline in hand, the project's own reads answer the same question:
  // one read means the mirror has something to lay, and the Library spine should not be dead.
  return !!(_project && _readCount().read > 0);
}

// The step being left lets go of what it was doing on its own - a read still playing.
function _leave() {
  const was = _loaded[_step];
  if (was && typeof was.leave === 'function') { try { was.leave(); } catch (e) { /* it is going anyway */ } }
}

function _remember(id) {
  try {
    const all = JSON.parse(localStorage.getItem(KEY) || '{}');
    all[_key] = id;
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch (e) { /* a private window, or storage that is full */ }
}

function _remembered() {
  try { return _stepId((JSON.parse(localStorage.getItem(KEY) || '{}') || {})[_key] || ''); } catch (e) { return ''; }
}

export function setStep(id) {
  if (!STEPS.includes(id)) return;
  if (_step === id) return;
  if (id === 'timeline' && !_mayEdit()) return;
  _leave();
  _step = id;
  _remember(id);
  _stepToUrl(id);
  _paintRoute();
  _lend();
  _repaint();
  // THE PAGE IS LAID OUT FOR THE STEP (phase L1, the owner 2026-09-23): the timeline as tall as its
  // lanes, the preview a little wider - or, back in setup, the most room there is for the work. On
  // the switch only: opening a page keeps the arrangement that was saved. After the paint, because
  // the lanes have to be drawn, and unlocked, before they can be measured.
  requestAnimationFrame(() => { if (id === 'timeline') roomForTimeline(); else roomForWork(); });
}

// THE SPINES ARE THE SWITCH (phase L). A press on the folded Library, in a talking head, is the way
// to the timeline - refused, and the spine says why, until there is something on it; a press on the
// folded Setup is the way back. A press that asks for the step already open is an ordinary "open
// this panel", and so is anything outside a talking head.
onColumnAsk((col) => {
  if (!_pid) return false;
  const want = col === 'library' ? 'timeline' : col === 'inspector' ? 'setup' : '';
  if (!want || want === _step) return false;
  if (want === 'timeline' && !_mayEdit()) return true;
  setStep(want);
  return true;
});

// ?step= in the address, which is how the Alerts list takes somebody back to the place a
// generation was started from (js/alerts-bell.js). It is read once, when the project is adopted,
// and it beats what was remembered - it is the more recent instruction of the two.
function _urlStep() {
  try {
    return _stepId(new URLSearchParams(location.search).get('step') || '');
  } catch (e) { return ''; }
}
// ...so a step switched after such an address rewrites it, or a reload would put you back on the
// step the link pointed at rather than the one you are on.
function _stepToUrl(id) {
  try {
    const u = new URL(location.href);
    if (!u.searchParams.has('step') || u.searchParams.get('step') === id) return;
    u.searchParams.set('step', id);
    history.replaceState({}, '', u);
  } catch (e) { /* an address that cannot be rewritten only means a reload lands on the old step */ }
}

// Which step an opened project lands on. A project with a cut on its timeline is one
// being edited, so it opens on the timeline; an empty one has nothing to edit yet and
// opens where the work starts. A remembered choice beats both - unless it is the timeline
// and the timeline is not open to this project yet (the Library spine says why).
function _firstStep() {
  const want = _urlStep() || _remembered() || (_hasCut() ? 'timeline' : 'setup');
  return want === 'timeline' && !_mayEdit() ? 'setup' : want;
}

// ── The spines ──────────────────────────────────────────────────────────────
// What the two folded panels say, which in a talking head is what the steps say (phase L). The
// Library spine is dead until the timeline has something on it - the first read laid is enough -
// and says how far the script has got; a blank project has no Setup spine at all (the body class
// lets the stylesheet hide it).
function _paintSpines() {
  document.body.classList.toggle('mv3-talking', !!_pid);
  const lib = document.getElementById('mv3-library');
  if (!lib) return;
  const off = !!_pid && _step === 'setup' && !_mayEdit();
  lib.classList.toggle('is-off', off);
  const n = _readCount();
  lib.title = !_pid ? ''
    : off ? (_project ? 'Read a fragment first - the reads lay themselves on the timeline · ' + n.read + '/' + n.total : 'Reading the project…')
      : _step === 'setup' ? 'The timeline and the Library · ' + n.read + '/' + n.total + ' read' : '';
  const ins = document.getElementById('mv3-inspector');
  if (ins) ins.title = _pid && _step === 'timeline' ? 'Back to setup - the script and the four fields' : '';
}

// ── The route, in the panel's own header ────────────────────────────────────
// Beside the title rather than under it: the header is one line on every panel of this
// page, and a second line here would cost the list below it the same height on a column
// that is already narrow.
function _head() { return document.querySelector('#mv3-inspector .mv3-panel-head'); }

function _paintRoute() {
  _paintSpines();
  const head = _head();
  if (!head) return;
  let bar = head.querySelector('.mv3-wk-steps');
  // THE ROUTE INSIDE SETUP, and only that (phase L): no step chips, the spines switch the steps.
  // At the hub there is no route - the panel's own title says where you are - and on a shelf it
  // reads "setup → looks → …", its first word being the way back to the hub.
  const mod = _loaded.setup;
  const crumbs = (_pid && _step === 'setup' && mod && typeof mod.crumbs === 'function') ? (mod.crumbs() || []) : [];
  if (!crumbs.length) { if (bar) bar.remove(); return; }
  if (!bar) {
    bar = document.createElement('div');
    bar.className = 'mv3-wk-steps';
    // After the title, before the spacer that holds the right-hand side of the header.
    const sp = head.querySelector('.sp');
    head.insertBefore(bar, sp || null);
  }
  bar.textContent = '';
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'mv3-wk-step is-on';
  b.textContent = 'setup';
  b.title = 'Back to the script and the four fields';
  b.addEventListener('click', () => mod.goCrumb('hub'));
  const wrap = document.createElement('div');
  wrap.className = 'mv3-wk-stepwrap';
  wrap.appendChild(b);
  for (const c of crumbs) {
    const arrow = document.createElement('span');
    arrow.className = 'mv3-wk-arrow';
    arrow.textContent = '\u2192';
    wrap.appendChild(arrow);
    const sb = document.createElement('button');
    sb.type = 'button';
    // Passed through: dashed. Where you are: lit, nothing more (css/merge-v3.css).
    sb.className = 'mv3-wk-sub' + (c.here ? ' is-here' : ' is-trail');
    sb.textContent = c.label;
    sb.title = c.here ? 'Where you are' : 'Back to ' + c.label;
    if (!c.here) sb.addEventListener('click', () => { mod.goCrumb(c.id); });
    wrap.appendChild(sb);
  }
  bar.appendChild(wrap);
  // A route longer than the panel is wide scrolls sideways (css/merge-v3.css), and its END is
  // where you are - so that is the part kept in view. The start is a flick away; the current
  // place hidden past the edge would be the one word on the row that could not be read.
  bar.scrollLeft = 0;
  const here = bar.querySelector('.mv3-wk-sub.is-here');
  if (here) {
    const over = here.getBoundingClientRect().right - bar.getBoundingClientRect().right;
    if (over > 0) bar.scrollLeft = Math.ceil(over) + 2;
  }
}

// ── Following the open project ──────────────────────────────────────────────
async function _adopt() {
  const key = Store.key() || '';
  if (key === _key) return;
  // The project being left lets go of what its step was doing - a read playing, a trial, the
  // buttons it laid over the stage (phase V24) - before the next one is set up.
  _leave();
  _key = key;
  _pid = projectIdOf(key);
  _project = null;
  // Where a talking head lands is decided once its record is here (below): whether the timeline
  // may open depends on its reads. Until then the panel says it is reading the project.
  _step = _pid ? 'setup' : 'timeline';
  _paintRoute();
  _lend();
  _repaint();
  if (!_pid) return;
  try {
    const d = await fetch('/api/scen3/projects/' + encodeURIComponent(_pid)).then(r => r.json());
    // Still the same project? Opening two in quick succession must not paint the first
    // one's record into the second one's panel.
    if (d && d.success && _pid === projectIdOf(Store.key() || '')) {
      _project = d.project;
      const first = _firstStep();
      if (first !== _step) { _leave(); _step = first; _paintRoute(); _lend(); }
      // WHATEVER STEP IT LANDED ON IS THE ONE IT IS STANDING ON (phase R): remembered here and not
      // only when a spine is pressed, so a walk to another page and back comes home to the same
      // place. Without it a project opened by its address came back on whichever step the rule
      // picks for a project with a cut - the timeline - however long you had been in setup.
      _remember(_step);
      _repaint();
    }
  } catch (e) {
    // A talking-head timeline whose project is gone still edits fine; only the steps
    // have nothing to show, and they say so.
    console.warn('[workshop] could not read the project:', e.message);
  }
}

/** Read the project again - it may have been written to by something other than this panel. */
async function _reload() {
  if (!_pid) return null;
  try {
    const d = await fetch('/api/scen3/projects/' + encodeURIComponent(_pid)).then(r => r.json());
    if (d && d.success && _pid === projectIdOf(Store.key() || '')) {
      _project = d.project;
      _repaint();
      return _project;
    }
  } catch (e) {
    console.warn('[workshop] could not read the project again:', e.message);
  }
  return null;
}

// WHEN THE STEP IS DECIDED: a talking head reads its project before it knows where it lands, and a
// caller that needs the Library - which comes with the timeline step - waits for that (the ?reveal=
// of an Alerts row, js/merge-v3/main.js). Replaced only when the project changes: a second notice
// about the same one must not swap a read still in flight for a promise that is already kept.
let _settled = Promise.resolve();
export const settled = () => _settled;
function _follow() {
  if ((Store.key() || '') === _key) return;
  _settled = _adopt();
}

export function initWorkshop() {
  Store.onChange(_follow);
  _follow();
}

// ── The panel ───────────────────────────────────────────────────────────────
// The build step is its own module and arrives when it is first opened - it is the biggest thing
// on this page. `timeline` has none: in that step the inspector paints what is picked into the
// strip over the Library and never asks this panel for anything (js/merge-v3/inspector.js,
// WK.active()).
const MODULES = {
  setup: () => import('./wk-setup.js'),
};
const _loaded = {};

export function paint(host) {
  // The route inside the step changes as the step changes what it shows.
  _paintRoute();
  const load = MODULES[_step];
  if (!load) return;
  const mod = _loaded[_step];
  // `key` is the open timeline, which is how a generation started here says where it came from
  // (lib/alerts.js); `reloadProject` is for the things the SERVER writes into the project while
  // the step is open - a finished look goes straight into the casting (lib/gen-jobs.js), and the
  // panel has to read it back rather than trust the copy it was painted from.
  if (mod) {
    mod.paint(host, { project: _project, repaint: _repaint, key: _key, reloadProject: _reload });
    // Again, because the step may have changed where it is WHILE painting - an address asking for
    // a level it cannot open (a lookbook with nobody cast) lands on the one it can, and the route
    // in the header has to say the place that is actually on screen.
    return _paintRoute();
  }
  host.appendChild(_note('opening ' + _step + '…'));
  load().then((m) => { _loaded[_step] = m; _repaint(); })
    .catch((e) => { host.textContent = ''; host.appendChild(_note('Could not open this step: ' + e.message, true)); });
}

function _note(text, bad) {
  const d = document.createElement('div');
  d.className = 'mv3-ins-note' + (bad ? ' is-err' : '');
  d.textContent = text;
  return d;
}
