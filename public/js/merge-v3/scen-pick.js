/* ════════════════════════════════════════════════════════════════════════════
   MERGE — starting a TALKING HEAD project.

   "+ new project" offers two kinds. A blank project is an empty timeline and starts
   at once. A talking-head project starts from a SCENARIO - a title and the lines that
   will be spoken - so this panel takes the inspector over and shows the scenario
   library: read one, use one, or write one.

   THE TWO BUTTONS ON A ROW ARE NOT THE SAME BUTTON.

     read   opens the text. What you edit here is the LIBRARY scenario, the thing
            other projects will be made from later. It is not the project's copy of
            anything, because at this point there is no project.
     use    makes the project. The lines are copied into it (routes/scen3.js takes a
            snapshot), so editing the scenario afterwards never reaches it, and the
            same scenario can be used as many times as you like.

   Nothing here spends anything: a project is a folder and a copy of some text. The
   generating starts in the workshop that opens afterwards.

   PHASE SCOPE (docs/local-app/PLAN.md, phase B). The workshop is still the Scenarios
   page, opened on the new project by address. Phases C and D bring it in here as a
   window over Merge, and this panel stops being a doorway to another page.
   ════════════════════════════════════════════════════════════════════════════ */

import * as API from './scen-api.js';
import * as Layers from '../layers.js';
import { setOpenColumn } from './layout.js';

// The two libraries are one store read two ways: a scenario written here has no
// provenance, one written in Library 2 records what it was written from.
const TABS = [
  { id: '', label: 'all' },
  { id: 'library1', label: 'written here' },
  { id: 'library2', label: 'from Library 2' },
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
  const head = _el('div', 'mv3-ins-head');
  const txt = _el('div', 'mv3-ins-head-txt');
  txt.appendChild(_el('div', 'mv3-ins-title', 'New talking head'));
  txt.appendChild(_el('div', 'mv3-ins-sub', 'Pick the script it says'));
  head.appendChild(txt);
  const act = _el('div', 'mv3-ins-head-act');
  const x = _el('button', 'mv3-iconbtn', '✕');
  x.type = 'button';
  x.title = 'Leave this and go back to the timeline';
  x.addEventListener('click', () => stop());
  act.appendChild(x);
  head.appendChild(act);
  host.appendChild(head);

  // Tabs with their counts, and the one button that makes something new.
  const tabs = _el('div', 'mv3-sc-tabs');
  for (const t of TABS) {
    const b = _el('button', 'mv3-sc-tab' + (t.id === _lib ? ' is-on' : ''));
    b.type = 'button';
    const n = t.id ? (_counts[t.id] || 0) : (_counts.all || 0);
    b.textContent = t.label + ' · ' + n;
    b.addEventListener('click', () => { if (_lib !== t.id) { _lib = t.id; _load(); } });
    tabs.appendChild(b);
  }
  const add = _el('button', 'mv3-sc-new', '+ scenario');
  add.type = 'button';
  add.title = 'Write a new scenario';
  add.addEventListener('click', () => openForm(null));
  tabs.appendChild(add);
  host.appendChild(tabs);

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
    const row = _el('div', 'mv3-sc-row');
    const txt = _el('div', 'mv3-sc-txt');
    txt.appendChild(_el('b', null, s.title || 'untitled'));
    txt.appendChild(_el('span', 'mv3-sc-meta', _meta(s)));
    row.appendChild(txt);

    const acts = _el('div', 'mv3-sc-acts');
    const read = _el('button', 'mv3-sc-btn', 'read');
    read.type = 'button';
    read.title = 'Read and edit the text of this scenario';
    read.addEventListener('click', () => openForm(s));
    const use = _el('button', 'mv3-sc-btn is-use', 'use');
    use.type = 'button';
    use.title = 'Make a project from this scenario and open it';
    use.addEventListener('click', () => _use(s.id, use));
    acts.append(read, use);
    row.appendChild(acts);
    list.appendChild(row);
  }
}

// ── Making the project ──────────────────────────────────────────────────────
// The project takes its own copy of the lines. Opening it is the point of making it, so
// this goes straight there - in this phase, to the workshop that still lives on its own
// page (docs/local-app/PLAN.md, phase B).
async function _use(scenarioId, btn) {
  if (btn) { btn.disabled = true; btn.textContent = '…'; }
  try {
    const p = await API.project(scenarioId);
    location.href = '/scenarios?project=' + encodeURIComponent(p.id);
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = 'use'; }
    alert('Could not make the project: ' + e.message);
  }
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
      await _use(saved.id, null);
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
