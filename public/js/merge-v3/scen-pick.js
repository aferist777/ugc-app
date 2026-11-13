/* ════════════════════════════════════════════════════════════════════════════
   MERGE — starting a TALKING HEAD project: the "scenarios" view of the Library panel.

   A talking-head project starts from a SCENARIO - a title and the lines that will be spoken.
   The scenario library is a VIEW of the Library panel (phase V28.3, the owner 2026-10-12): the
   crumb "scenarios /" left of "Library", in the draft and in a blank project - never in a talking
   head, where "scenarios" would read as its own script. It is one of lib-views.js's bases: it
   takes the gallery's place with the media tree on its right, the corner of the sashes goes left and
   down, the view is remembered per project, and "Library" goes back to the shelf. "+ new project
   -> talking head" opens it in the project that is open (a talking head goes to the draft for it).
   It used to take the Setup panel over, the Library folded to its spine beside it; that went.

   READING AND USING ARE NOT THE SAME ACT.

     the row   opens the text. What you edit there is the LIBRARY scenario, the thing
               other projects will be made from later. It is not the project's copy of
               anything, because at this point there is no project.
     use       makes the project. The lines are copied into it (routes/scen3.js takes a
               snapshot), so editing the scenario afterwards never reaches it, and the
               same scenario can be used as many times as you like. The project open now
               is left as it is - the draft stays the draft, nothing asked (the owner).

   The rest is on the right-click menu, and the two that change the library are deliberately
   different weights: ARCHIVE puts a scenario out of the list and can be taken back, DELETE
   cannot, so it asks first - the same question the timeline asks before dropping a clip.

   Nothing here spends anything: a project is a folder and a copy of some text. The
   generating starts in the project's setup, which opens afterwards.
   ════════════════════════════════════════════════════════════════════════════ */

import * as API from './scen-api.js';
import * as Layers from '../layers.js';
import { askDelete } from '../ask.js';
import { setOpenColumn, roomForWork } from './layout.js';
import * as Store from './store.js';
import * as WK from './workshop.js';
import * as Views from './lib-views.js';
import { openScenario } from '../scen-window.js';
// (phase V49.1) A failure is a popup in the corner (js/notice.js), not the browser's alert().
import { showError } from '../notice.js';
// (phase V73 block 2, step 2b) The list being read, empty, or not read - the shared parts.
import { emptyEl, loadingEl, failedEl } from '../ui-state.js';
import { REALLY } from '../really.js';
import { menuIcons, iconEl } from '../icons.js';
import { figures } from '../num.js';
import { isHl } from '../highlights/keys.js';

const NAME = 'scenarios';
const $ = (id) => document.getElementById(id);

// THE CATEGORY (phase E7, the owner 2026-09-29; one dropdown since F8, 2026-09-30): all · saved -
// written by hand, no provenance - · each source the generator wrote from · no source - generated
// from a topic alone - · archive. The sources are grouped by id on the server and named by their
// CURRENT title, and the list is read again every time it opens: a source renamed in the Library
// is renamed here, even with the view already open.
let _shown = false;
let _rows = [];
let _counts = { all: 0, library1: 0, library2: 0, sources: [], noSource: 0 };
let _lib = '';                // '' | 'library1' | 'src:<id>' | 'nosrc' | 'archive'
let _q = '';
let _state = '';              // '', 'loading', or 'failed' - the list did not load (the reason was a popup)
let _ui = null;               // { root, filter, search, list } - built the first time the view shows

const _el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

// ── Where the view may be ───────────────────────────────────────────────────
// The draft and a blank project (the owner, V28.3 (a)): not a talking head, and not before the store
// has read what is open.
// (phase V33.1) Nor a highlights project: its crumbs are its own.
const _hl = isHl;
function _allowed() {
  return Store.isReady() && !WK.projectIdOf(Store.key() || '') && !_hl(Store.key());
}

// The view is remembered per project as the chats' are (lib-views.js), and the drafts share one mark, as their
// conversation does (chat-shell.js DRAFT_LK).
let _key = null;              // the project the view follows
let _draftHere = false;
const _lk = (k) => (k === _key && _draftHere ? 'draft' : (k || ''));

function _crumb() {
  const c = $('mv3-lib-scen');
  if (c) c.hidden = !_allowed();
}

/**
 * Every way in: the crumb, "+ new project -> talking head". A talking head is never where the view is - the draft is
 * opened for it first.
 */
export async function openScenarios() {
  if (Store.isReady() && (WK.projectIdOf(Store.key() || '') || _hl(Store.key()))) await Store.openBlank();
  if (!_allowed()) return;
  Views.toBase();
  setOpenColumn('library');
  _show(true);
}

/**
 * (phase V62, the owner after block 0: "давай voiceover открывать сразу на этапе, когда показаны поля для выбора голоса и крошки
 * видны. шаг со списком сценариев удаляем из voiceover") "+ new project -> voiceover" and Home's "+ voiceover": THE voiceover
 * draft, opened on its setup - its script column offers the scenarios and "+ your text" (js/merge-v3/vo-script.js).
 */
export async function openVoiceover() {
  return _open(await API.voiceoverDraft());
}

// `remember` is false when a chat took the base (onYield): that chat writes its own mark.
function _show(on, remember = true) {
  _shown = !!on;
  if (remember) Views.rememberView(_lk(_key), _shown ? NAME : null, NAME);
  if (!_shown) _closeCatMenu();
  Views.setBase(NAME, _shown);
  if (!_shown) return;
  _build();
  _paintFilter();
  _load();
}

function _onStore() {
  if (!Store.isReady()) return;
  _crumb();
  const k = Store.key() || '';
  // (phase V20) The draft saved under a name: its own from now on, and it stays on the view it was on.
  if (k === _key && _draftHere && !Store.isDraft()) {
    _draftHere = false;
    if (_shown) Views.rememberView(k, NAME);
    return;
  }
  if (k === _key) return;
  _key = k;
  _draftHere = !!Store.isDraft();
  const want = _allowed() && Views.viewOf(_lk(k)) === NAME;
  if (want !== _shown) _show(want, false);
  else if (!_shown) Views.sync();
}

export function initScenarios() {
  Views.registerChat(NAME, {
    root: 'mv3-sc', crumb: 'mv3-lib-scen',
    crumbTitle: 'The scenarios - "use" one to make a talking head',
    onBack: () => _show(false), onYield: () => _show(false, false), onCrumb: () => { openScenarios(); },
  });
  Store.onChange(_onStore);
  _onStore();
}

// ── The list ────────────────────────────────────────────────────────────────
async function _load() {
  _state = 'loading';
  _paintList();
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
    // (phase V73 block 2, (б2-18), (б2-19)) The reason a popup; the list says it did not load, with Try again.
    _state = 'failed';
    showError('Could not read the scenarios: ' + e.message);
  }
  _paintFilter();
  _paintList();
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
    { id: '', label: 'All', n: c.all || 0 },
    { id: 'library1', label: 'Saved', n: c.library1 || 0, title: 'Written or pasted by hand' },
  ].concat(sources);
  if (c.noSource) out.push({ id: 'nosrc', label: 'No source', n: c.noSource, title: 'Generated from a topic alone' });
  out.push({ id: 'archive', label: 'Archive', n: c.archive || 0 });
  return out;
}

// The dropdown: a menu layer under its button (Escape and a press outside close it). A menu rather
// than a <select>: an open <select> would be closed under the hand by the list read again. It reads the
// list again before it opens, so names and counts are now.
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
  _paintFilter();                                // the button's own count, now
  _paintList();
  const anchor = _ui && _ui.filter;
  if (!_shown || !anchor) return;
  const el = _el('div', 'mv3-plus-menu mv3-sc-menu u-menu is-float');
  let srcHead = false;
  for (const t of _choices()) {
    if (t.src && !srcHead) { el.appendChild(_el('div', 'mv3-sc-menu-sep', 'Written from')); srcHead = true; }
    if (!t.src && srcHead && (t.id === 'nosrc' || t.id === 'archive') && !el.querySelector('.mv3-sc-menu-sep.is-end')) {
      el.appendChild(_el('div', 'mv3-sc-menu-sep is-end'));
    }
    const b = _el('button', 'mv3-plus-item u-mi' + (t.id === _lib ? ' is-on' : ''));
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

// ── The view ────────────────────────────────────────────────────────────────
// Built once, in its own box of the panel (#mv3-sc): one row - the button that writes a new scenario, the
// category and the search, all three about which scenarios are on screen - and the list under it. Where you
// are is the crumb's to say, and "Library" is the way out.
function _build() {
  if (_ui) return;
  const root = $('mv3-sc');
  if (!root) return;
  const top = _el('div', 'mv3-scv-top');
  const add = _el('button', 'mv3-sc-new u-btn is-s');
  add.append(iconEl('plus', 14), document.createTextNode('scenario'));   // (phase V73 block 5, 5d) Lucide's plus
  add.type = 'button';
  add.title = 'Write a new scenario';
  add.addEventListener('click', () => openForm(null));
  top.appendChild(add);

  // The category: one button showing the choice and its count; pressing it opens the list.
  // (phase V73 block 5, 5d) the shared list button (`is-field`), its chevron Lucide's, its count in mono
  const filter = _el('button', 'mv3-sc-filter u-btn is-s is-field');
  filter.type = 'button';
  filter.addEventListener('click', (e) => { e.stopPropagation(); _filterMenu(); });
  top.appendChild(filter);

  const search = _el('input', 'mv3-sc-search u-in is-s');
  search.type = 'search';
  search.placeholder = 'search by title, product, role';
  search.addEventListener('input', () => { _q = search.value; _paintList(); });
  top.appendChild(search);
  root.appendChild(top);

  const list = _el('div', 'mv3-sc-list');
  root.appendChild(list);
  _ui = { root, filter, search, list };
}

function _paintFilter() {
  if (!_ui) return;
  const cur = _choices().find(t => t.id === _lib) || { label: 'All', n: _counts.all || 0 };
  const b = _ui.filter;
  b.classList.toggle('is-on', !!_lib);
  b.title = (cur.title ? cur.title + '\n' : '') + 'Which scenarios - press to choose';
  b.textContent = '';
  b.appendChild(_el('span', 'mv3-sc-filter-t', cur.label));
  b.appendChild(_el('span', 'mv3-sc-filter-n')).appendChild(figures('· ' + cur.n));
  b.appendChild(iconEl('chevron-down', 14));
}

function _paintList() {
  if (!_ui) return;
  const list = _ui.list;
  list.textContent = '';
  if (_state === 'loading') { list.appendChild(loadingEl('reading the scenarios…')); return; }
  if (_state) { list.appendChild(failedEl('The scenarios', () => _load())); return; }

  const rows = _rows.filter(_matches);
  if (!rows.length) {
    list.appendChild(emptyEl(_rows.length ? 'Nothing matches that.'
      : _lib ? 'Nothing under this filter.' : 'No scenarios yet. Write one with "+ scenario".', { icon: _rows.length ? 'search' : 'list' }));
    return;
  }
  for (const s of rows) {
    const row = _el('div', 'mv3-sc-row' + (s.archived ? ' is-archived' : ''));
    row.title = 'Open the text. Right-click for the rest.';
    // THE BUTTONS RIGHT OF THE TITLE (phase V73 block 5, 5d; plan 3.5 - left of it, the cross first, since V28.3): the title -
    // use - ✕. The button depends on where the scenario is: an archived one is not offered as something to build with until it
    // is back in the library.
    const acts = _el('div', 'mv3-sc-acts');
    // OUT OF THE LIST from the row itself (phase I1, the owner 2026-10-01), in two presses: the
    // first turns the cross into "really?" for three seconds, the second archives. One press would
    // make a row vanish under a stray click; the archive filter's `restore` brings it back.
    if (!s.archived) {
      const armed = !!_armed && _armed.id === s.id;
      const x = _el('button', 'mv3-sc-btn is-x u-btn is-s' + (armed ? ' is-danger is-armed' : ' is-icon is-quiet is-del u-x'), armed ? REALLY : '');
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
    const go = _el('button', 'mv3-sc-btn is-use u-btn is-s', s.archived ? 'restore' : 'use');
    go.type = 'button';
    go.title = s.archived
      ? 'Put it back in the library'
      : 'Make a talking head from this scenario and open it';
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
        go.textContent = 'Use';
        showError('Could not make the project: ' + err.message);
      }
    });
    acts.insertBefore(go, acts.firstChild);

    const txt = _el('div', 'mv3-sc-txt');
    txt.appendChild(_el('b', null, s.title || 'untitled'));
    txt.appendChild(_el('span', 'mv3-sc-meta')).appendChild(figures(_meta(s)));   // its count and date in mono
    row.appendChild(txt);
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
  const el = _el('div', 'mv3-plus-menu u-menu is-float');
  const item = (label, sub, on, danger) => {
    const b = _el('button', 'mv3-plus-item u-mi' + (danger ? ' is-danger' : ''));
    b.type = 'button';
    b.appendChild(_el('span', null, label));
    if (sub) b.appendChild(_el('small', null, sub));
    b.addEventListener('click', (e) => { e.stopPropagation(); _closeMenu(); on(); });
    el.appendChild(b);
  };

  item('open', 'read and edit the text', () => openForm(s));
  // (phase V62) Both kinds from the same scenario, whichever way the view was opened.
  if (!s.archived) item('talking head', 'make a talking head from it', () => _use(s.id).catch(e => showError('Could not make the project: ' + e.message)));
  // (phase V62, (во32) а) Into THE voiceover draft, which opens.
  if (!s.archived) item('voiceover', 'read it in a voice - B-roll over it', () => _toVoiceover(s.id).catch(e => showError('Could not put it into the voiceover: ' + e.message)));
  if (s.archived) item('restore', 'put it back in the library', () => _archive(s, false));
  else item('archive', 'out of the list, kept', () => _archive(s, true));
  // Anchored on the ROW, not on the menu item that opened it: the menu is gone by the time
  // this runs, and a question hanging off a removed element opens in the corner of the screen.
  item('delete', 'for good', () => {
    askDelete(row, 'Delete "' + (s.title || 'untitled') + '"?',
      'The scenario goes for good. Projects already made from it keep their own copy of the text.',
      async () => {
        try { await API.remove(s.id); } catch (e) { showError('Could not delete it: ' + e.message); }
        _load();
      });
  }, true);

  menuIcons(el);
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
  try { await API.archive(s.id, yes); } catch (e) { showError('Could not change it: ' + e.message); }
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
// Library's scenario window since phase V28.2), and opened here on its setup step. The project left keeps
// this view as its own: back in the draft, the scenarios are where they were.
// It THROWS when it cannot (phase Y1): who called this is who knows where to put the news - a button in
// the list, a line in the form.
async function _use(scenarioId) {
  return _open(await API.talkingHead(scenarioId));
}
// (phase V62) A scenario into THE voiceover draft - its lines in their own language, never translated - and the draft opened.
async function _toVoiceover(scenarioId) {
  const key = await API.voiceoverDraft();
  await API.voiceoverScript(WK.projectIdOf(key), { scenarioId });
  return _open(key);
}
async function _open(key) {
  await Store.open(key);
  roomForWork();                        // a new project is opened to be built
  WK.setStep('setup');
  return key;
}

// ── The scenario itself, read or written ────────────────────────────────────
// The window is shared with the Library (js/scen-window.js, phase V28.2): here a save reads the list
// behind it again, and `use` makes the project and opens it.
export function openForm(summary) {
  return openScenario(summary, { saved: () => _load(), use: (rec) => _use(rec.id) });
}
