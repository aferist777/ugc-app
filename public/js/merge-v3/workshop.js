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
import { lock, softLock, setOpenColumn, onColumnAsk, roomForWork, roomForTimeline } from './layout.js';
import { isRead, isLive } from './scen-api.js';
import { hint } from '../bubble.js';

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
/** (phase V62) Others that follow the setup's repaints - the crumb "b-roll /" (js/merge-v3/broll-view.js). */
const _also = [];
export function onRepaint(fn) { if (typeof fn === 'function') _also.push(fn); }

const _repaint = () => {
  if (_onChange) _onChange();
  for (const f of _also) { try { f(); } catch (e) { /* theirs */ } }
};
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
  return { read: lines.filter(isRead).length, clips: lines.filter(_hasClip).length, total: lines.length };
}
// A line with a clip of its own - Kling's takes or Seedance's (routes/scen3.js keeps both on the line).
function _hasClip(l) {
  const v = (l && l.video) || {};
  return ((v.plain || []).length + (v.tagged || []).length + (((l && l.sd) || {}).clips || []).length) > 0;
}
// IS THERE ANYTHING TO EDIT? The timeline opens as soon as the first CLIP has been laid on it (phase V61, the owner's
// (т1а): a read with no clip lies nowhere in a talking head - lib/frag-mirror.js): a cut of two fragments is a cut, and
// waiting for the last line before letting anybody look at it helps nobody. Anything on any lane counts - the mirror's
// cells and whatever the person put there themselves.
function _hasCut() {
  const tl = Store.timeline();
  return !!(tl && (tl.tracks || []).some(t => (t.clips || []).length));
}
// (phase V62, the owner's (во38)-(во40): "у talking head тоже. там будет появляться только когда все фрагменты имеют видео";
// "показывать крошки только они не нажимаемы. при наведении показывать, что нужно сделать чтобы они стали активны") THE WAY ON
// FROM SETUP is the crumbs in its head - "Library / captions" (V64: the chats are windows) - and they are
// pressed once the script is done: a voiceover's lines all read, a talking head's fragments all with their video. Until then
// they stand greyed, and the bubble over them says what is left. The Library's spine in setup went (css/merge-v3.css).
// (phase V62, the owner 2026-10-31: "давай таймлайн становится доступен, после того как фрагменты разложены на таймлайне";
// (во54) "а + 1") A VOICEOVER's way on opens with the first read laid on the timeline - anything on it - as its timeline under
// setup does (layout.js softLock).
function _ready() {
  if (!_project) return false;
  const n = _readCount();
  if (_isVo()) return _hasCut();
  return n.total > 0 && n.clips === n.total;
}
// (phase V62) Is a voiceover's B-roll on the timeline - its engine's pieces on main video (lib/broll.js: br_<line>_…)?
function _brollLaid() {
  const tl = Store.timeline();
  const v1 = ((tl && tl.tracks) || []).find(t => t.id === 'v1');
  return !!(v1 && (v1.clips || []).some(c => /^br_\d/.test(String(c.id || ''))));
}
function _mayEdit() {
  return _ready();
}
// (phase V62) Is the project open a voiceover - the script in a voice, no clips of its own?
const _isVo = () => !!(_project && _project.type === 'voiceover');

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

// THE SPINES WERE THE SWITCH (phase L). A press on the folded Library, in a talking head, is the way
// to the timeline - refused, and the spine says why, until there is something on it; a press on the
// folded Setup is the way back. A press that asks for the step already open is an ordinary "open
// this panel", and so is anything outside a talking head. (phase V62 hid the Library spine in setup, and
// phase V64 the Setup spine everywhere: the switch is the crumbs now - setup's way on (_paintOn) and the
// Library panel's "setup /". No spine of a project with setup is seen; this answer stays for a folded
// column pressed all the same.)
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
// Library spine is dead until the timeline has something on it - the first clip laid is enough (V61) -
// and says how far the script has got; a blank project has no Setup spine at all (the body class
// lets the stylesheet hide it). (phase V64) No project shows either spine any more - the body classes, the
// lock's softness and "setup /" are what is left of this paint that anybody sees.
function _paintSpines() {
  document.body.classList.toggle('mv3-talking', !!_pid);
  // (phase V62, fix (к)) A voiceover has no Setup spine: the crumb "setup /" in the Library panel's head is its way back -
  // (phase V64, the owner 2026-10-31: "у talking head убираем вертикальную кнопку setup - делаем крошкой") and a talking
  // head's: no project shows a spine any more (css/merge-v3.css).
  document.body.classList.toggle('mv3-vo', !!_pid && _isVo());
  const back = document.getElementById('mv3-lib-setup');
  if (back) back.hidden = !_pid;
  softLock(_isVo() && _hasCut());
  const lib = document.getElementById('mv3-library');
  if (!lib) return;
  const off = !!_pid && _step === 'setup' && !_mayEdit();
  lib.classList.toggle('is-off', off);
  const n = _readCount();
  lib.title = !_pid ? ''
    : off ? (!_project ? 'Reading the project…'
      : _isVo() ? 'Read the lines first - the reads lay themselves on the timeline · ' + n.read + '/' + n.total
        : 'Make a clip first - the clips lay themselves on the timeline · ' + n.clips + '/' + n.total)
      : _step === 'setup' ? 'The timeline and the Library · ' + (_isVo() ? n.read + '/' + n.total + ' read' : n.clips + '/' + n.total + ' with a clip') : '';
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
  // (phase V64, fix (ж)) SETUP is blue while it is where you are - not a place inside it, not the timeline step.
  const setupTitle = head.querySelector('.mv3-panel-title');
  if (setupTitle) setupTitle.classList.toggle('is-on', !!_pid && _step === 'setup' && !crumbs.some(c => c.here));
  // (phase V62) In setup the bar is always there: "setup", the route inside it, and the way on (_paintOn).
  if (!(_pid && _step === 'setup')) { if (bar) bar.remove(); return; }
  if (!bar) {
    bar = document.createElement('div');
    bar.className = 'mv3-wk-steps is-crumbs';
    // After the title, before the spacer that holds the right-hand side of the header.
    const sp = head.querySelector('.sp');
    head.insertBefore(bar, sp || null);
  }
  bar.textContent = '';
  // (phase V62, the owner 2026-10-31, items 8 and 14: "\u043d\u0443\u0436\u043d\u043e \u0441\u0434\u0435\u043b\u0430\u0442\u044c \u043a\u0440\u043e\u0448\u043a\u0438, \u043a\u0430\u043a \u0443 \u043f\u0440\u043e\u0435\u043a\u0442\u043e\u0432 \u0442\u0438\u043f\u0430 highlights") THE CRUMBS OF
  // HIGHLIGHTS' LOOK - the Library panel's own (`.mv3-lib-crumb`): words in capitals after a "/", no pill, no outline. The panel's
  // title, SETUP, is the first of them; a place inside setup follows it lit, then the way on (_paintOn).
  const wrap = document.createElement('div');
  wrap.className = 'mv3-wk-crumbs';
  for (const c of crumbs) {
    const sb = document.createElement('button');
    sb.type = 'button';
    sb.className = 'mv3-lib-crumb' + (c.here ? ' is-on is-here' : '');
    sb.textContent = '/ ' + c.label;
    sb.title = c.here ? 'Where you are' : 'Back to ' + c.label;
    if (!c.here) sb.addEventListener('click', (e) => { e.stopPropagation(); mod.goCrumb(c.id); });
    wrap.appendChild(sb);
  }
  _paintOn(wrap);
  bar.appendChild(wrap);
  // A route longer than the panel is wide scrolls sideways (css/merge-v3.css), and its END is
  // where you are - so that is the part kept in view. The start is a flick away; the current
  // place hidden past the edge would be the one word on the row that could not be read.
  bar.scrollLeft = 0;
  const here = bar.querySelector('.is-here');
  if (here) {
    const over = here.getBoundingClientRect().right - bar.getBoundingClientRect().right;
    if (over > 0) bar.scrollLeft = Math.ceil(over) + 2;
  }
}

// THE WAY ON (phase V62): after "setup", the Library panel's own crumbs - each one the timeline step with that view of the panel
// (the panel's crumb pressed for it, js/merge-v3/lib-views.js). Greyed until _ready(); the bubble says what is left. (phase V64
// block 3) No "generate image / video / audio" - the chats are windows, opened by "generate" in the Library's tree.
const ON = [
  ['Library', 'mv3-lib-title', 'The timeline and the Library'],
  ['captions', 'mv3-lib-cap', 'The captions of the timeline - their look and presets'],
];
function _paintOn(wrap) {
  // (phase V62, (во53)) A voiceover's "b-roll" first, right of SETUP: the B-roll's pieces, from the timeline step's Library panel
  // (js/merge-v3/broll-view.js openCurrent) - pale until the B-roll is laid.
  if (_isVo()) {
    const on = _brollLaid();
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'mv3-lib-crumb mv3-wk-on' + (on ? '' : ' is-off');
    b.textContent = '/ b-roll';
    b.addEventListener('click', (e) => { e.stopPropagation(); if (on) _goOn('mv3-lib-br'); });
    if (on) b.title = 'The B-roll of a piece - what else was found for its sentence';
    else { b.setAttribute('aria-disabled', 'true'); hint(b, 'Find the B-roll first - field 2, B-roll.'); }
    wrap.appendChild(b);
  }
  const ok = _ready();
  const n = _readCount();
  const left = !_project ? 'Reading the project…'
    : !n.total ? (_isVo() ? 'Choose the script first - a scenario or your own text, on the right.' : 'This project has no lines.')
      : _isVo() ? 'Read the lines first - field 1, mood & voice: each read lies on the timeline at once. Then the timeline, the Library and the chats open.'
        : 'Make the video of every fragment first - field 3, video: ' + n.clips + ' of ' + n.total + ' with a video. Then the timeline, the Library and the chats open.';
  for (const [label, id, what] of ON) {
    const c = document.createElement('button');
    c.type = 'button';
    c.className = 'mv3-lib-crumb mv3-wk-on' + (ok ? '' : ' is-off');
    c.textContent = '/ ' + label;
    // Never reaching the panel's head: a press there is the column's (it would ask for the setup step back).
    c.addEventListener('click', (e) => { e.stopPropagation(); if (ok) _goOn(id); });
    if (ok) c.title = what;
    else {
      c.setAttribute('aria-disabled', 'true');
      hint(c, left);
    }
    wrap.appendChild(c);
  }
}
function _goOn(id) {
  if (!_ready()) return;
  setStep('timeline');
  // The panel is open a moment later; its own crumb then opens the view, as a press on it would.
  requestAnimationFrame(() => { const el = document.getElementById(id); if (el) el.click(); });
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
  // (phase V62) A voiceover's timeline gaining its first cell or its B-roll changes the way on: the crumbs, the soft lock.
  let was = '';
  Store.onChange(() => {
    if (!_isVo()) { was = ''; return; }
    const now = (_hasCut() ? 'c' : '') + (_brollLaid() ? 'b' : '');
    if (now === was) return;
    was = now;
    _paintRoute();
  });
  // (phase V62, fix (к); V64 a talking head's too) "setup /", first in the Library panel's head: back to setup, as the spine was.
  const back = document.getElementById('mv3-lib-setup');
  if (back) {
    back.title = 'Back to setup - the script and its fields';
    back.addEventListener('click', (e) => { e.stopPropagation(); if (_pid) setStep('setup'); });
  }
  // (во54) A press on a voiceover's timeline under setup - seen, not blurred, once something lies on it: the timeline step.
  const tl = document.getElementById('mv3-timeline');
  if (tl) {
    tl.addEventListener('click', (e) => {
      if (!document.body.classList.contains('mv3-lock-soft') || _step === 'timeline') return;
      e.preventDefault();
      e.stopPropagation();
      setStep('timeline');
    }, true);
  }
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
