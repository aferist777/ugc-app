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

// The two libraries are one store read two ways: a scenario written here has no
// provenance, one written in Library 2 records what it was written from.
const TABS = [
  { id: '', label: 'all' },
  { id: 'library1', label: 'written here' },
  { id: 'library2', label: 'from Library 2' },
  // Last, and apart from the other three: it is not a narrower view of the library, it is
  // the pile the library is not showing.
  { id: 'archive', label: 'archive' },
];
const MIN_LINES = 3;          // routes/scen3.js refuses a NEW scenario below this

let _active = false;
let _rows = [];
let _counts = { all: 0, library1: 0, library2: 0 };
let _lib = '';
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
    _rows = d.rows;
    _counts = d.counts;
    _state = '';
  } catch (e) {
    _rows = [];
    _state = 'Could not read the scenarios: ' + e.message;
  }
  _repaint();
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

  for (const tab of TABS) {
    const b = _el('button', 'mv3-sc-tab' + (tab.id === _lib ? ' is-on' : ''));
    b.type = 'button';
    const n = tab.id ? (_counts[tab.id] || 0) : (_counts.all || 0);
    b.textContent = tab.label + ' · ' + n;
    b.addEventListener('click', () => { if (_lib !== tab.id) { _lib = tab.id; _load(); } });
    head.appendChild(b);
  }

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
      _rows.length ? 'Nothing matches that.' : 'No scenarios yet. Write one with "+ scenario".'));
    return;
  }
  for (const s of rows) {
    const row = _el('div', 'mv3-sc-row' + (s.archived ? ' is-archived' : ''));
    row.title = 'Open the text. Right-click for the rest.';
    const txt = _el('div', 'mv3-sc-txt');
    txt.appendChild(_el('b', null, s.title || 'untitled'));
    txt.appendChild(_el('span', 'mv3-sc-meta', _meta(s)));
    row.appendChild(txt);

    // One button, and which one depends on where the scenario is: an archived one is not
    // offered as something to build with until it is back in the library.
    const acts = _el('div', 'mv3-sc-acts');
    const go = _el('button', 'mv3-sc-btn is-use', s.archived ? 'restore' : 'use');
    go.type = 'button';
    go.title = s.archived
      ? 'Put it back in the library'
      : 'Make a project from this scenario and open it';
    go.addEventListener('click', async (e) => {
      e.stopPropagation();                       // the row opens the text; this does not
      if (s.archived) return _archive(s, false);
      go.disabled = true;
      go.textContent = '…';
      try {
        await _use(s.id);
      } catch (err) {
        go.disabled = false;
        go.textContent = 'use';
        alert('Could not make the project: ' + err.message);
      }
    });
    acts.appendChild(go);
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

// ── Making the project ──────────────────────────────────────────────────────
// Two things are made, and the second is why a talking-head project is in Merge's picker from
// the start: the project itself (its own copy of the lines), and the EMPTY timeline it will be
// assembled into, keyed to it. Without that second one, a project made today would be invisible
// here until its first assembly, and tomorrow there would be no way back into it.
// It THROWS when it cannot (phase Y1). It used to swallow its own failure into an `alert`, which
// meant the window that called it could not tell success from failure either: the button stayed
// down and the window stayed open with nothing said in it. Who called this is who knows where to
// put the news - a button in the list, a line in the form.
async function _use(scenarioId) {
  const p = await API.project(scenarioId);
  const d = await fetch('/api/mv3/timeline/new', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId: p.id }),
  }).then(r => r.json());
  if (!d || !d.success) throw new Error((d && d.error) || 'the timeline was refused');
  await Store.open(d.key);
  // The picker has done its job - left only now that the project is open: left before, the panel
  // would belong for a moment to whatever was open before it, and a blank project has no Setup
  // (phase L), so the Library would flash up in its place.
  stop();
  roomForWork();                        // a new talking head is opened to be built
  WK.setStep('setup');
  return d.key;
}

// ── The scenario itself, read or written ────────────────────────────────────
// One form for both: reading an existing scenario and writing a new one differ by what is
// in the fields, not by what the fields are. `save` keeps it in the library; `use` makes a
// project from it - saving first, because a project is made from what is STORED.
export async function openForm(summary) {
  const isNew = !summary;
  let rec = { id: null, title: '', lines: [], vertical: '', product: '', roles: [] };
  const ov = _el('div', 'mv3-x-ov');
  const box = _el('div', 'mv3-x is-scen');
  ov.appendChild(box);

  const head = _el('div', 'mv3-x-head');
  const h3 = document.createElement('h3');
  h3.textContent = isNew ? 'New scenario' : 'Scenario';
  head.appendChild(h3);
  const close = _el('button', 'mv3-x-close', '✕');
  close.type = 'button';
  head.appendChild(close);
  box.appendChild(head);

  const body = _el('div', 'mv3-x-body');
  box.appendChild(body);

  const field = (label, node) => {
    const row = _el('div', 'mv3-x-row');
    const l = document.createElement('label');
    l.textContent = label;
    row.append(l, node);
    body.appendChild(row);
    return node;
  };
  const input = (placeholder, listId) => {
    const i = _el('input', 'mv3-sc-inp');
    i.type = 'text';
    if (placeholder) i.placeholder = placeholder;
    if (listId) i.setAttribute('list', listId);
    return i;
  };

  const title = field('Title', input('what this ad is called'));
  const vertical = field('Vertical', input('optional', 'mv3-sc-verticals'));
  const product = field('Product', input('optional', 'mv3-sc-products'));
  const role = field('Role', input('optional', 'mv3-sc-roles'));
  const gender = field('Narrator', (() => {
    const s = document.createElement('select');
    for (const [v, t] of [['', 'any - every character is offered'], ['female', 'female'], ['male', 'male']]) {
      const o = document.createElement('option');
      o.value = v; o.textContent = t;
      s.appendChild(o);
    }
    return s;
  })());
  // The suggestions are values used before, collected from saved scenarios - a hint, never
  // a list of allowed answers, which is why these are datalists and not selects.
  for (const id of ['mv3-sc-verticals', 'mv3-sc-products', 'mv3-sc-roles']) {
    if (!document.getElementById(id)) {
      const dl = document.createElement('datalist');
      dl.id = id;
      document.body.appendChild(dl);
    }
  }

  body.appendChild(_el('div', 'mv3-x-hdr', 'The lines'));
  const lines = _el('textarea', 'mv3-sc-lines');
  lines.spellcheck = false;
  lines.placeholder = 'One line per row. Each line becomes one fragment: it is spoken in one take and animated as one clip.';
  body.appendChild(lines);
  const count = _el('p', 'mv3-x-note');
  body.appendChild(count);
  body.appendChild(_el('p', 'mv3-x-note',
    'This is the scenario in the library. A project made from it keeps its own copy of the text, '
    + 'so editing here never changes a project that already exists.'));

  const foot = _el('div', 'mv3-x-foot');
  const note = _el('span', 'mv3-x-note');
  const save = _el('button', 'mv3-c-btn', 'save');
  save.type = 'button';
  save.title = 'Keep it in the library';
  const use = _el('button', 'mv3-x-go', 'use');
  use.type = 'button';
  use.title = 'Save it and make a project from it';
  foot.append(note, save, use);
  box.appendChild(foot);

  const linesOf = () => lines.value.split('\n').map(s => s.trim()).filter(Boolean);
  const gate = () => {
    const n = linesOf().length;
    const why = !title.value.trim() ? 'A title is needed.'
      : n < MIN_LINES ? `At least ${MIN_LINES} lines are needed - there ${n === 1 ? 'is' : 'are'} ${n}.`
        : '';
    count.textContent = why || `${n} lines - ${n} fragments.`;
    // An EDIT is never refused by the server, only a new scenario is: a half-typed title
    // must not be able to fail a save of something that already exists.
    save.disabled = !!why && isNew;
    use.disabled = !!why;
    return why;
  };
  title.addEventListener('input', gate);
  lines.addEventListener('input', gate);

  const layer = Layers.open(ov, { name: 'scenario', onEsc: () => _closeForm(ov, layer) });
  close.addEventListener('click', () => _closeForm(ov, layer));
  ov.addEventListener('mousedown', (e) => { if (e.target === ov) _closeForm(ov, layer); });
  document.body.appendChild(ov);

  // The suggestions and, for an existing scenario, its text: both are a request away, and
  // the window is already on screen while they arrive.
  API.options().then((o) => {
    const fill = (id, values) => {
      const dl = document.getElementById(id);
      if (!dl) return;
      dl.textContent = '';
      for (const v of (values || [])) {
        const opt = document.createElement('option');
        opt.value = v;
        dl.appendChild(opt);
      }
    };
    fill('mv3-sc-verticals', o.verticals);
    fill('mv3-sc-products', o.products);
    fill('mv3-sc-roles', o.roles);
  }).catch(() => { /* suggestions are a convenience */ });

  if (!isNew) {
    note.textContent = 'reading…';
    try {
      rec = await API.get(summary.id);
      title.value = rec.title || '';
      vertical.value = rec.vertical || '';
      product.value = rec.product || '';
      const r0 = (rec.roles || [])[0] || {};
      role.value = r0.name || '';
      gender.value = ['male', 'female'].includes(String(r0.gender || '')) ? r0.gender : '';
      lines.value = (rec.lines || []).map(l => l.text || '').join('\n');
      note.textContent = '';
    } catch (e) {
      note.textContent = 'Could not read it: ' + e.message;
    }
  }
  gate();
  title.focus();

  const collect = () => ({
    id: rec.id || undefined,
    title: title.value.trim(),
    type: 'talking_head',
    vertical: vertical.value.trim(),
    product: product.value.trim(),
    // One role, the narrator: the store keeps a list, and nothing offers a second one.
    roles: (role.value.trim() || gender.value) ? [{ id: 'r0', name: role.value.trim(), gender: gender.value }] : [],
    lines: linesOf().map(text => ({ text })),
  });

  const store = async () => {
    note.textContent = 'saving…';
    const saved = await API.save(collect());
    rec = saved;
    note.textContent = 'saved';
    _load();                       // the list behind the window shows the new title
    return saved;
  };

  save.addEventListener('click', async () => {
    save.disabled = true;
    try { await store(); } catch (e) { note.textContent = e.message; }
    save.disabled = false;
  });
  use.addEventListener('click', async () => {
    if (gate()) return;
    use.disabled = true;
    try {
      const saved = await store();
      await _use(saved.id);
      // THE WINDOW GOES (phase Y1, the owner 2026-09-22). `_use` leaves the picker and opens the
      // project on its step, and this modal used to stay on top of it - with the page's shortcuts
      // switched off underneath, because a modal layer holds them.
      _closeForm(ov, layer);
    } catch (e) {
      note.textContent = e.message;
      use.disabled = false;
    }
  });
}

function _closeForm(ov, layer) {
  Layers.close(layer);
  try { ov.remove(); } catch (e) { /* already gone */ }
}
