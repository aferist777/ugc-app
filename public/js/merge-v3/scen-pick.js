/* ════════════════════════════════════════════════════════════════════════════
   MERGE — starting a TALKING HEAD project.

   "+ new project" offers two kinds. A blank project is an empty timeline and starts
   at once. A talking-head project starts from a SCENARIO - a title and the lines that
   will be spoken - so this panel takes the inspector over and shows the scenario
   library: read one, use one, or write one.

   READING AND USING ARE NOT THE SAME ACT.

     the row   opens the text. What you edit there is the LIBRARY scenario, the thing
               other projects will be made from later. It is not the project's copy of
               anything, because at this point there is no project.
     use       makes the project. The lines are copied into it (routes/scen3.js takes a
               snapshot), so editing the scenario afterwards never reaches it, and the
               same scenario can be used as many times as you like.

   The rest is on the right-click menu, and the two that change the library are deliberately
   different weights: ARCHIVE puts a scenario out of the list and can be taken back, DELETE
   cannot, so it asks first - the same question the timeline asks before dropping a clip.

   Nothing here spends anything: a project is a folder and a copy of some text. The
   generating starts in the workshop that opens afterwards.

   PHASE SCOPE (docs/local-app/PLAN.md, phase B). The workshop is still the Scenarios
   page, opened on the new project by address. Phases C and D bring it in here as a
   window over Merge, and this panel stops being a doorway to another page.
   ════════════════════════════════════════════════════════════════════════════ */

import * as API from './scen-api.js';
import * as Layers from '../layers.js';
import { askDelete } from './ask.js';
import { setOpenColumn, roomForWork, onColumnOpen } from './layout.js';
import * as Store from './store.js';
import * as WK from './workshop.js';
import { openScenario } from '../scen-window.js';

// THE CATEGORY (phase E7, the owner 2026-09-29; one dropdown since F8, 2026-09-30): all · saved -
// written by hand, no provenance - · each source the generator wrote from · no source - generated
// from a topic alone - · archive. The sources are grouped by id on the server and named by their
// CURRENT title, and the list is read again every time it opens: a source renamed in the Library
// is renamed here, even with the picker already open.
let _active = false;
let _rows = [];
let _counts = { all: 0, library1: 0, library2: 0, sources: [], noSource: 0 };
let _lib = '';                // '' | 'library1' | 'src:<id>' | 'nosrc' | 'archive'
let _q = '';
let _state = '';              // '', 'loading', or an error to show in place of the list
let _onChange = null;

const _el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const _repaint = () => { if (_onChange) _onChange(); };

/** Is the inspector showing this instead of what is selected? */
export function active() { return _active; }

/** The inspector hands us its repaint. */
export function onChange(fn) { _onChange = fn; }

/** Leave the picker - the inspector goes back to showing the selection. */
export function stop() {
  if (!_active) return;
  _active = false;
  _closeCatMenu();
  _repaint();
}

// THE LIBRARY COMING FORWARD IS LEAVING THE PICKER (phase L): by its spine, by a pick on the
// timeline, by the timeline step - the person has gone elsewhere (js/merge-v3/layout.js).
onColumnOpen((which) => { if (which === 'library') stop(); });

/** Enter the picker: the inspector column comes forward and the list loads. */
export async function start() {
  _active = true;
  setOpenColumn('inspector');
  _repaint();
  await _load();
}

async function _load() {
  _state = 'loading';
  _repaint();
  try {
    const d = await API.list(_lib);
    // A source's chip - or "no source" - goes when its last scenario is archived or deleted, here or in
    // the Library. The filter goes with it, back to all, instead of lighting nothing over an empty list.
    const c = d.counts || {};
    const gone = (_lib.startsWith('src:') && !(c.sources || []).some(s => 'src:' + s.id === _lib))
      || (_lib === 'nosrc' && !c.noSource);
    if (gone) { _lib = ''; return _load(); }
    _rows = d.rows;
    _counts = d.counts;
    _state = '';
  } catch (e) {
    _rows = [];
    _state = 'Could not read the scenarios: ' + e.message;
  }
  _repaint();
}

function _filter(id) {
  if (_lib === id) return;
  _lib = id;
  _load();
}

// The choices, in order, each with its count. Sources by their full names; two that are called the
// same are numbered, the rest of what tells them apart is in the tooltip.
function _choices() {
  const c = _counts || {};
  const srcs = Array.isArray(c.sources) ? c.sources : [];
  const seen = new Map();
  const sources = srcs.map(s => {
    const name = String(s.title || 'untitled source').trim();
    const k = (seen.get(name) || 0) + 1;
    seen.set(name, k);
    return { id: 'src:' + s.id, label: k > 1 ? name + ' ' + k : name, n: s.n, src: true, gone: !!s.gone,
      title: (s.gone ? 'A source since deleted: ' : 'Written from ') + s.title };
  });
  const out = [
    { id: '', label: 'all', n: c.all || 0 },
    { id: 'library1', label: 'saved', n: c.library1 || 0, title: 'Written or pasted by hand' },
  ].concat(sources);
  if (c.noSource) out.push({ id: 'nosrc', label: 'no source', n: c.noSource, title: 'Generated from a topic alone' });
  out.push({ id: 'archive', label: 'archive', n: c.archive || 0 });
  return out;
}

// The dropdown: a menu layer under its button (Escape and a press outside close it). A menu rather
// than a <select>: the panel repaints whenever the project changes, and an open <select> would be
// closed under the hand. It reads the list again before it opens, so names and counts are now.
let _catMenu = null;
function _closeCatMenu() {
  if (!_catMenu) return;
  _catMenu.el.remove();
  document.removeEventListener('mousedown', _catMenu.away, true);
  Layers.close(_catMenu.layer);
  _catMenu = null;
}
let _catOpening = false;
async function _filterMenu() {
  // A second press while the list is still being read is the same press: one menu, never two (the
  // second would be orphaned on screen, its layer swallowing every Escape after it).
  if (_catMenu || _catOpening) { _closeCatMenu(); _catOpening = false; return; }
  _catOpening = true;
  try {
    const d = await API.list(_lib);
    _counts = d.counts || _counts;
    _rows = d.rows || _rows;
    _state = '';
  } catch (e) { /* the counts it has will do */ }
  if (!_catOpening) return;                      // pressed again meanwhile: closed
  _catOpening = false;
  _repaint();                                    // the button's own count, now
  const anchor = document.querySelector('.mv3-sc-filter');
  if (!_active || !anchor) return;
  const el = _el('div', 'mv3-plus-menu mv3-sc-menu');
  let srcHead = false;
  for (const t of _choices()) {
    if (t.src && !srcHead) { el.appendChild(_el('div', 'mv3-sc-menu-sep', 'written from')); srcHead = true; }
    if (!t.src && srcHead && (t.id === 'nosrc' || t.id === 'archive') && !el.querySelector('.mv3-sc-menu-sep.is-end')) {
      el.appendChild(_el('div', 'mv3-sc-menu-sep is-end'));
    }
    const b = _el('button', 'mv3-plus-item' + (t.id === _lib ? ' is-on' : ''));
    b.type = 'button';
    b.appendChild(_el('span', null, t.label));
    b.appendChild(_el('small', null, t.n + (t.n === 1 ? ' scenario' : ' scenarios') + (t.gone ? ' · source deleted' : '')));
    if (t.title) b.title = t.title;
    b.addEventListener('click', (e) => { e.stopPropagation(); _closeCatMenu(); _filter(t.id); });
    el.appendChild(b);
  }
  document.body.appendChild(el);
  const r = anchor.getBoundingClientRect();
  el.style.left = Math.round(Math.max(8, Math.min(window.innerWidth - el.offsetWidth - 8, r.left))) + 'px';
  el.style.top = Math.round(Math.min(window.innerHeight - el.offsetHeight - 8, r.bottom + 4)) + 'px';
  const away = (e) => { if (!el.contains(e.target) && !(e.target.closest && e.target.closest('.mv3-sc-filter'))) _closeCatMenu(); };
  document.addEventListener('mousedown', away, true);
  _catMenu = { el, away, layer: Layers.open(el, { name: 'scenario category', modal: false, onEsc: _closeCatMenu }) };
}

// What a row says about itself, beyond its title: the three labels the casting reads, and
// how many lines there are - which is how many fragments the project will have.
function _meta(s) {
  const bits = [];
  const n = +s.lineCount || 0;
  bits.push(n + (n === 1 ? ' line' : ' lines'));
  if (s.vertical) bits.push(s.vertical);
  if (s.product) bits.push(s.product);
  const role = ((s.roles || [])[0] || {});
  if (role.name) bits.push(role.name);
  if (s.gender) bits.push(s.gender);
  const day = String(s.updatedAt || s.createdAt || '').slice(0, 10);
  if (day) bits.push(day);
  return bits.join(' · ');
}

function _matches(s) {
  const q = _q.trim().toLowerCase();
  if (!q) return true;
  const role = ((s.roles || [])[0] || {}).name || '';
  return [s.title, s.vertical, s.product, role].join(' ').toLowerCase().includes(q);
}

// ── The panel ───────────────────────────────────────────────────────────────
export function paint(host) {
  // One row: what this panel is, the button that writes a new one, and the filters. They
  // belong together - all three are about which scenarios are on screen - and the inspector
  // is narrow enough that a second row of chips would push the list off the bottom.
  const head = _el('div', 'mv3-ins-head is-scen');
  const txt = _el('div', 'mv3-ins-head-txt');
  txt.appendChild(_el('div', 'mv3-ins-title', 'New talking head'));
  txt.appendChild(_el('div', 'mv3-ins-sub', 'Pick the script it says'));
  head.appendChild(txt);

  const add = _el('button', 'mv3-sc-new', '+ scenario');
  add.type = 'button';
  add.title = 'Write a new scenario';
  add.addEventListener('click', () => openForm(null));
  head.appendChild(add);

  // The category: one button showing the choice and its count; pressing it opens the list.
  const cur = _choices().find(t => t.id === _lib) || { label: 'all', n: _counts.all || 0 };
  const pick = _el('button', 'mv3-sc-filter' + (_lib ? ' is-on' : ''));
  pick.type = 'button';
  pick.title = (cur.title ? cur.title + '\n' : '') + 'Which scenarios - press to choose';
  pick.appendChild(_el('span', 'mv3-sc-filter-t', cur.label));
  pick.appendChild(_el('span', 'mv3-sc-filter-n', '· ' + cur.n + ' ▾'));
  pick.addEventListener('click', (e) => { e.stopPropagation(); _filterMenu(); });
  head.appendChild(pick);

  const act = _el('div', 'mv3-ins-head-act');
  const x = _el('button', 'mv3-iconbtn', '✕');
  x.type = 'button';
  x.title = 'Leave this and go back to the timeline';
  x.addEventListener('click', () => stop());
  act.appendChild(x);
  head.appendChild(act);
  host.appendChild(head);

  const search = _el('input', 'mv3-sc-search');
  search.type = 'search';
  search.placeholder = 'search by title, product, role';
  search.value = _q;
  search.addEventListener('input', () => { _q = search.value; _paintList(list); });
  host.appendChild(search);

  const list = _el('div', 'mv3-sc-list');
  host.appendChild(list);
  _paintList(list);
}

function _paintList(list) {
  list.textContent = '';
  if (_state === 'loading') { list.appendChild(_el('div', 'mv3-ins-note', 'reading the scenarios…')); return; }
  if (_state) { list.appendChild(_el('div', 'mv3-ins-note is-err', _state)); return; }

  const rows = _rows.filter(_matches);
  if (!rows.length) {
    list.appendChild(_el('div', 'mv3-ins-note',
      _rows.length ? 'Nothing matches that.'
        : _lib ? 'Nothing under this filter.' : 'No scenarios yet. Write one with "+ scenario".'));
    return;
  }
  for (const s of rows) {
    const row = _el('div', 'mv3-sc-row' + (s.archived ? ' is-archived' : ''));
    row.title = 'Open the text. Right-click for the rest.';
    const txt = _el('div', 'mv3-sc-txt');
    txt.appendChild(_el('b', null, s.title || 'untitled'));
    txt.appendChild(_el('span', 'mv3-sc-meta', _meta(s)));
    row.appendChild(txt);

    // The button depends on where the scenario is: an archived one is not offered as something
    // to build with until it is back in the library.
    const acts = _el('div', 'mv3-sc-acts');
    const go = _el('button', 'mv3-sc-btn is-use', s.archived ? 'restore' : 'use');
    go.type = 'button';
    go.title = s.archived
      ? 'Put it back in the library'
      : 'Make a project from this scenario and open it';
    go.addEventListener('click', async (e) => {
      e.stopPropagation();                       // the row opens the text; this does not
      if (s.archived) return _archive(s, false);
      _disarm();
      for (const b of acts.children) b.disabled = true;     // the cross waits for the project too
      go.textContent = '…';
      try {
        await _use(s.id);
      } catch (err) {
        for (const b of acts.children) b.disabled = false;
        go.textContent = 'use';
        alert('Could not make the project: ' + err.message);
      }
    });
    acts.appendChild(go);
    // OUT OF THE LIST from the row itself (phase I1, the owner 2026-10-01), in two presses: the
    // first turns the cross into "really?" for three seconds, the second archives. One press would
    // make a row vanish under a stray click; the archive filter's `restore` brings it back.
    if (!s.archived) {
      const armed = !!_armed && _armed.id === s.id;
      const x = _el('button', 'mv3-sc-btn is-x' + (armed ? ' is-armed' : ''), armed ? 'really?' : '✕');
      x.type = 'button';
      x.title = 'Move to the archive - press twice';
      if (armed) _armed.x = x;                   // a repaint inside the three seconds keeps it armed
      x.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!_armed || _armed.id !== s.id) { _arm(s.id, x); return; }
        _disarm();
        for (const b of acts.children) b.disabled = true;
        _archive(s, true);
      });
      acts.appendChild(x);
    }
    row.appendChild(acts);

    row.addEventListener('click', () => openForm(s));
    row.addEventListener('contextmenu', (e) => { e.preventDefault(); _rowMenu(e, s, row); });
    list.appendChild(row);
  }
}

// ── The right-click menu ────────────────────────────────────────────────────
// A menu layer (js/layers.js): Escape closes it and the page keeps its shortcuts. Archived
// rows get a different set - nothing is built from a scenario that is out of the library.
let _menu = null;

function _closeMenu() {
  if (!_menu) return;
  _menu.el.remove();
  document.removeEventListener('mousedown', _menu.away, true);
  Layers.close(_menu.layer);
  _menu = null;
}

function _rowMenu(ev, s, row) {
  _closeMenu();
  const el = _el('div', 'mv3-plus-menu');
  const item = (label, sub, on, danger) => {
    const b = _el('button', 'mv3-plus-item' + (danger ? ' is-danger' : ''));
    b.type = 'button';
    b.appendChild(_el('span', null, label));
    if (sub) b.appendChild(_el('small', null, sub));
    b.addEventListener('click', (e) => { e.stopPropagation(); _closeMenu(); on(); });
    el.appendChild(b);
  };

  item('open', 'read and edit the text', () => openForm(s));
  if (!s.archived) item('use', 'make a project from it', () => _use(s.id).catch(e => alert('Could not make the project: ' + e.message)));
  if (s.archived) item('restore', 'put it back in the library', () => _archive(s, false));
  else item('archive', 'out of the list, kept', () => _archive(s, true));
  // Anchored on the ROW, not on the menu item that opened it: the menu is gone by the time
  // this runs, and a question hanging off a removed element opens in the corner of the screen.
  item('delete', 'for good', () => {
    askDelete(row, 'Delete "' + (s.title || 'untitled') + '"?',
      'The scenario goes for good. Projects already made from it keep their own copy of the text.',
      async () => {
        try { await API.remove(s.id); } catch (e) { alert('Could not delete it: ' + e.message); }
        _load();
      });
  }, true);

  document.body.appendChild(el);
  const w = el.offsetWidth, h = el.offsetHeight;
  el.style.left = Math.round(Math.max(6, Math.min(window.innerWidth - w - 6, ev.clientX))) + 'px';
  el.style.top = Math.round(Math.max(6, Math.min(window.innerHeight - h - 6, ev.clientY))) + 'px';
  const away = (e) => { if (!el.contains(e.target)) _closeMenu(); };
  const layer = Layers.open(el, { modal: false, name: 'scenario menu', onEsc: _closeMenu });
  _menu = { el, away, layer };
  // On the next tick: this very right-click is still travelling, and it would close the menu
  // it just opened.
  setTimeout(() => document.addEventListener('mousedown', away, true), 0);
}

// Out of the library or back into it. Same call either way - the server merges the flag into
// the stored record - and the list is read again so the counts move with it.
async function _archive(s, yes) {
  try { await API.archive(s.id, yes); } catch (e) { alert('Could not change it: ' + e.message); }
  _load();
}

// The row's cross, armed: { id, x, timer }. One at a time - arming another row disarms this one -
// and it disarms itself after three seconds, because an armed cross left there is a trap for the
// next click that happens to land on it.
let _armed = null;

function _arm(id, x) {
  _disarm();
  _armed = { id, x, timer: setTimeout(_disarm, 3000) };
  x.textContent = 'really?';
  x.classList.add('is-armed');
}

function _disarm() {
  if (!_armed) return;
  const { x, timer } = _armed;
  _armed = null;
  clearTimeout(timer);
  if (x && x.isConnected) {
    x.textContent = '✕';
    x.classList.remove('is-armed');
  }
}

// ── Making the project ──────────────────────────────────────────────────────
// The project and its empty timeline are made by `talkingHead` (js/merge-v3/scen-api.js, shared with the
// Library's scenario window since phase V28.2), and opened here on its setup step.
// It THROWS when it cannot (phase Y1). It used to swallow its own failure into an `alert`, which
// meant the window that called it could not tell success from failure either: the button stayed
// down and the window stayed open with nothing said in it. Who called this is who knows where to
// put the news - a button in the list, a line in the form.
async function _use(scenarioId) {
  const key = await API.talkingHead(scenarioId);
  await Store.open(key);
  // The picker has done its job - left only now that the project is open: left before, the panel
  // would belong for a moment to whatever was open before it, and a blank project has no Setup
  // (phase L), so the Library would flash up in its place.
  stop();
  roomForWork();                        // a new talking head is opened to be built
  WK.setStep('setup');
  return key;
}

// ── The scenario itself, read or written ────────────────────────────────────
// The window is shared with the Library (js/scen-window.js, phase V28.2): here a save reads the list
// behind it again, and `use` makes the project and opens it.
export function openForm(summary) {
  return openScenario(summary, { saved: () => _load(), use: (rec) => _use(rec.id) });
}
