/* ════════════════════════════════════════════════════════════════════════════
   MERGE — the workshop of a TALKING HEAD project.

   A talking head is not assembled by hand: it is built in a fixed order - who says
   it and where, then the first frame of each fragment, then the read, then the
   clips - and only then is there a timeline to edit. That order used to be a page of
   its own; it is this panel now (docs/local-app/PLAN.md, "Мастерская talking head").

   WHICH PROJECTS. Only those with a scenario behind them, and the key says so: a cut
   sent from Scenarios, and now a project made from a scenario here, is keyed
   sv3_<project id> (lib/merge-store.js puts its file in that project's folder). A
   blank project has no scenario, no fragments and nothing to step through, so it
   never sees any of this.

   THE STEPS ARE LOADED WHEN THEY ARE OPENED, one module each. Together they are the
   biggest thing on this page - characters, looks, environments, frames - and most
   visits to Merge open none of them. `timeline` is not a module: it IS the inspector
   as it has always been, which is why it is the step an old project opens on.

   WHAT IS STORED WHERE. What has been CHOSEN - the character, the look, the place,
   the frames - is the scenario project and lives on the server, where it always has.
   Which step is open is not work: it is remembered per project in this browser, so
   coming back lands where you left without a write to the project for every click.
   ════════════════════════════════════════════════════════════════════════════ */

import * as Store from './store.js';
import * as PV from './preview-b.js';

// `timeline` last and apart: the other two build the project, it edits the result.
//
// THREE STEPS, NOT FOUR (decided with the owner 2026-09-18, docs/local-app/PLAN.md "Setting &
// voice"). The read used to be a step of its own and the clips another, but a clip is made FROM a
// frame and a read of one line and lasts exactly as long as that read - so the voice belongs with
// the character and the place that are chosen for it, and the frame belongs with the clip it opens.
const STEPS = [
  { id: 'setting', label: 'setting & voice', title: 'Who says it, where, and how it is read' },
  { id: 'fragments', label: 'fragments', title: 'The opening frame and the clip of each fragment' },
  { id: 'timeline', label: 'timeline', title: 'The timeline itself, and whatever is selected on it' },
];
// What a step used to be called, so an address in an old journal row and a step remembered in this
// browser still land somewhere (lib/alerts.js, and `mv3_step_v1` below).
const WAS = { frames: 'setting', voice: 'setting', video: 'fragments' };
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
// The stage belongs to a build step while one is open, and to the timeline otherwise.
const _lend = () => PV.borrow(active());

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
// opens where the work starts. A remembered choice beats both.
function _firstStep() {
  const asked = _urlStep();
  if (asked) return asked;
  const seen = _remembered();
  if (seen) return seen;
  const tl = Store.timeline();
  const has = !!(tl && (tl.tracks || []).some(t => (t.clips || []).length));
  return has ? 'timeline' : 'setting';
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
  _step = _pid ? _firstStep() : 'timeline';
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
// Each step is its own module and arrives when it is first opened. Until a step has
// one, this is what it shows: what the step will be, and the way to do that work in
// the place where it still lives (docs/local-app/PLAN.md, phases C2-C6). The bridge
// goes step by step as each is built, and the page it points at goes in phase G.
const MODULES = {
  setting: () => import('./wk-setting.js'),
  // fragments: () => import('./wk-fragments.js'),    ← F
};
const _loaded = {};

export function paint(host) {
  // The chips carry the step's own crumbs, and those change as the step changes what it shows.
  _paintChips();
  const spec = STEPS.find(s => s.id === _step);
  const load = MODULES[_step];

  if (load) {
    const mod = _loaded[_step];
    // `key` is the open timeline, which is how a generation started here says where it came from
    // (lib/alerts.js); `reloadProject` is for the things the SERVER writes into the project while
    // a step is open - a finished look goes straight into the casting (lib/gen-jobs.js), and the
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
    return;
  }

  const head = document.createElement('div');
  head.className = 'mv3-ins-head';
  const txt = document.createElement('div');
  txt.className = 'mv3-ins-head-txt';
  const t = document.createElement('div');
  t.className = 'mv3-ins-title';
  t.textContent = spec.label;
  const sub = document.createElement('div');
  sub.className = 'mv3-ins-sub';
  sub.textContent = spec.title;
  txt.append(t, sub);
  head.appendChild(txt);
  host.appendChild(head);

  host.appendChild(_note(_project
    ? 'This step is being built here. Until it is, the work happens in the old workshop.'
    : 'Reading the project…'));

  if (_project) {
    const go = document.createElement('button');
    go.type = 'button';
    go.className = 'mv3-c-btn';
    go.textContent = 'open the old workshop';
    go.title = 'The Scenarios page, on this project';
    go.addEventListener('click', () => { location.href = '/scenarios?project=' + encodeURIComponent(_pid); });
    const row = document.createElement('div');
    row.className = 'mv3-ins-row';
    row.appendChild(go);
    host.appendChild(row);
  }
}

function _note(text, bad) {
  const d = document.createElement('div');
  d.className = 'mv3-ins-note' + (bad ? ' is-err' : '');
  d.textContent = text;
  return d;
}
