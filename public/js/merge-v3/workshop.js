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

   THE STEPS ARE LOADED WHEN THEY ARE OPENED, one module each. Together they are the
   biggest thing on this page - characters, looks, environments, frames - and most
   visits to Merge open none of them. `timeline` is not a module: it IS the inspector
   as it has always been, which is why it is the step an old project opens on.

   WHILE A BUILD STEP IS OPEN THE TIMELINE AND THE LIBRARY ARE LOCKED (js/merge-v3/layout.js):
   the cut is laid from the fragments later, so until then both are blurred and inert. The
   `timeline` chip itself waits for the reads - every line spoken, or a cut already there
   (decided with the owner 2026-09-21, docs/local-app/PLAN.md "Сцена, setup и таймлайн-зеркало").

   WHAT IS STORED WHERE. What has been CHOSEN - the character, the look, the place,
   the frames - is the scenario project and lives on the server, where it always has.
   Which step is open is not work: it is remembered per project in this browser, so
   coming back lands where you left without a write to the project for every click.
   ════════════════════════════════════════════════════════════════════════════ */

import * as Store from './store.js';
import * as PV from './preview-b.js';
import { lock } from './layout.js';
import { isRead } from './scen-api.js';

// `timeline` last and apart: `setup` builds the project, it edits the result.
//
// TWO STEPS (decided with the owner 2026-09-21). The casting, the voice and the fragments were
// three steps once, then two; but the character and the place are chosen on the stage now, and
// what is left of "setting" is the voice - one row over the script, which is what the fragments
// are. So the whole build is one step, and the chip's short name carries the long one as its tip.
const STEPS = [
  { id: 'setup', label: 'setup', title: 'talking head setup - who says it, where, in what voice; the frame and the clip of each fragment' },
  { id: 'timeline', label: 'timeline', title: 'timeline edit - the cut, and whatever is selected on it' },
];
// What a step used to be called, so an address in an old journal row and a step remembered in this
// browser still land somewhere (lib/alerts.js, and `mv3_step_v1` below).
const WAS = { setting: 'setup', fragments: 'setup', frames: 'setup', voice: 'setup', video: 'setup' };
const _stepId = (id) => { const s = WAS[String(id || '')] || String(id || ''); return STEPS.some(x => x.id === s) ? s : ''; };
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

/** The step showing now. 'timeline' means the inspector behaves as it always has. */
export function step() { return _step; }

/** Is a BUILD step open - the case where this panel owns the inspector? */
export function active() { return !!_pid && _step !== 'timeline'; }

/** The scenario project record, or null while it is still being read. */
export function project() { return _project; }

/** The inspector hands us its repaint. */
export function onChange(fn) { _onChange = fn; }

const _repaint = () => { if (_onChange) _onChange(); };
// The stage belongs to a build step while one is open, and to the timeline otherwise - and the
// timeline and the Library the other way round: locked while a step is open (js/merge-v3/layout.js).
const _lend = () => { PV.borrow(active()); lock(active()); };

// THE TIMELINE STEP WAITS FOR THE READS (decided with the owner 2026-09-21): the cut is laid from
// the fragments, and it is laid once every line is read - so the chip is dead until then, with the
// count on it. A project that already has a cut of its own on the timeline - sent from Scenarios
// before any of this - keeps its chip: there is something there to edit. The cells the fragments
// will lay themselves (`frag`, docs/local-app/PLAN.md, phase T') are not such a cut.
function _readCount() {
  const lines = (_project && Array.isArray(_project.lines)) ? _project.lines : [];
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
  // one read means the mirror has something to lay, and the chip should not be dead.
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
  if (!STEPS.some(s => s.id === id)) return;
  if (_step === id) return;
  if (id === 'timeline' && !_mayEdit()) return;
  _leave();
  _step = id;
  _remember(id);
  _paintChips();
  _lend();
  _repaint();
}

// ?step= in the address, which is how the Alerts list takes somebody back to the place a
// generation was started from (js/alerts-bell.js). It is read once, when the project is adopted,
// and it beats what was remembered - it is the more recent instruction of the two.
function _urlStep() {
  try {
    return _stepId(new URLSearchParams(location.search).get('step') || '');
  } catch (e) { return ''; }
}

// Which step an opened project lands on. A project with a cut on its timeline is one
// being edited, so it opens on the timeline; an empty one has nothing to edit yet and
// opens where the work starts. A remembered choice beats both - unless it is the timeline
// and the timeline is not open to this project yet (its chip says why).
function _firstStep() {
  const want = _urlStep() || _remembered() || (_hasCut() ? 'timeline' : 'setup');
  return want === 'timeline' && !_mayEdit() ? 'setup' : want;
}

// ── The chips, in the panel's own header ────────────────────────────────────
// Beside the title rather than under it: the header is one line on every panel of this
// page, and a second line here would cost the list below it the same height on a column
// that is already narrow.
function _head() { return document.querySelector('#mv3-inspector .mv3-panel-head'); }

function _paintChips() {
  const head = _head();
  if (!head) return;
  let bar = head.querySelector('.mv3-wk-steps');
  if (!_pid) { if (bar) bar.remove(); return; }
  if (!bar) {
    bar = document.createElement('div');
    bar.className = 'mv3-wk-steps';
    // After the title, before the spacer that holds the right-hand side of the header.
    const sp = head.querySelector('.sp');
    head.insertBefore(bar, sp || null);
  }
  bar.textContent = '';
  for (const s of STEPS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'mv3-wk-step' + (s.id === _step ? ' is-on' : '');
    b.textContent = s.label;
    b.title = s.title;
    if (s.id === 'timeline' && !_mayEdit()) {
      // Dead until there is something on the timeline - the first read is enough - and it says
      // how far the script has got.
      const n = _readCount();
      b.disabled = true;
      b.title = _project ? 'Read a fragment first - the reads lay themselves on the timeline · ' + n.read + '/' + n.total
        : 'Reading the project…';
    } else if (s.id === 'timeline' && _project) {
      const n = _readCount();
      b.title = s.title + ' · ' + n.read + '/' + n.total + ' read';
    }
    // Pressing the open step's own chip goes back to the top of it.
    b.addEventListener('click', () => {
      if (s.id === _step && _loaded[_step] && typeof _loaded[_step].goCrumb === 'function') _loaded[_step].goCrumb('hub');
      else setStep(s.id);
    });
    // The open step may have places INSIDE it. They follow its chip in the same row as a ROUTE -
    // step, arrow, place, arrow, place - so what led to what reads left to right, and the
    // header stays one line however deep the route goes.
    const crumbs = (s.id === _step && _loaded[_step] && typeof _loaded[_step].crumbs === 'function')
      ? (_loaded[_step].crumbs() || []) : [];
    if (!crumbs.length) { bar.appendChild(b); continue; }
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
      if (!c.here) sb.addEventListener('click', () => { _loaded[_step].goCrumb(c.id); });
      wrap.appendChild(sb);
    }
    bar.appendChild(wrap);
  }
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
  _key = key;
  _pid = projectIdOf(key);
  _project = null;
  // Where a talking head lands is decided once its record is here (below): whether the timeline
  // may open depends on its reads. Until then the panel says it is reading the project.
  _step = _pid ? 'setup' : 'timeline';
  _paintChips();
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
      if (first !== _step) { _leave(); _step = first; _paintChips(); _lend(); }
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

export function initWorkshop() {
  Store.onChange(_adopt);
  _adopt();
}

// ── The panel ───────────────────────────────────────────────────────────────
// The build step is its own module and arrives when it is first opened - it is the biggest thing
// on this page. `timeline` has none: it IS the inspector as it has always been, and the inspector
// never asks this panel to paint it (js/merge-v3/inspector.js, WK.active()).
const MODULES = {
  setup: () => import('./wk-setup.js'),
};
const _loaded = {};

export function paint(host) {
  // The chips carry the step's own crumbs, and those change as the step changes what it shows.
  _paintChips();
  const spec = STEPS.find(s => s.id === _step);
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
    return _paintChips();
  }
  host.appendChild(_note('opening ' + spec.label + '…'));
  load().then((m) => { _loaded[_step] = m; _repaint(); })
    .catch((e) => { host.textContent = ''; host.appendChild(_note('Could not open this step: ' + e.message, true)); });
}

function _note(text, bad) {
  const d = document.createElement('div');
  d.className = 'mv3-ins-note' + (bad ? ' is-err' : '');
  d.textContent = text;
  return d;
}
