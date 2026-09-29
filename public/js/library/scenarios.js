// LIBRARY — the scenarios shelf.
//
// The second shelf that is not pictures, and it draws rows for the same reason the voices shelf
// does: a scenario is a title, a few fields and a line count. A card here would be a grey tile
// with a name under it, which is a thumbnail that admits it has no thumbnail.
//
// ONE ROW IS ALWAYS SELECTED and the right column is about it (phase D5, the owner 2026-09-29) - the
// rule of the picture shelves: opening the shelf selects the first, a delete falls back to the
// first, a reload keeps the one that was selected. The column holds the whole scenario: its title
// and fields, where it came from when the generator wrote it, its lines - editable in one textarea,
// one line per line, because editing a script is reading it top to bottom - and Delete.
//
// DRAFTS HEAD THE LIST (phase E4): a script the generator is still writing, one row each, saying how
// far it got. A draft is not selected - pressing it continues it in the generator (js/library/make.js).
//
// FILTERS AND FIELDS (phase F7, the owner 2026-09-30): over the list, above the drafts, a dropdown per
// field - type, role, gender, vertical, product, narrator (the voice of the WRITING), language - with
// the values the scenarios really have and how many; the choice is remembered, drafts are not
// filtered. The same fields are dropdowns in the column, saved the moment one is chosen, each with
// "new…" for a value nobody has used yet.
//
// Lines are `{text}` records - the roles live on the scenario, not on its lines - so splitting the
// textarea on newlines maps onto the store exactly. A line that carries a newline of its own (the
// generator can write one) is shown on one textarea line, or a Save would quietly make it two.

import { askName } from '../name-box.js';

const $ = (id) => document.getElementById(id);

function _el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

const _fmtDate = (s) => {
  if (!s) return '';
  const d = new Date(s);
  return isNaN(d) ? '' : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

// The tail under a title: what tells two scenarios for the same product apart, in the order you
// would say it. Empty fields are dropped rather than shown as blanks.
function _tail(m) {
  const n = m.lines || 0;
  return [
    n + (n === 1 ? ' line' : ' lines'),
    m.vertical,
    m.product,
    m.roles,
    m.narrator,
    m.language,
  ].filter(Boolean).join(' · ');
}

// ── Filters (phase F7) ──────────────────────────────────────────────────────
const FIELDS = [
  { key: 'type', label: 'type' }, { key: 'role', label: 'role' }, { key: 'gender', label: 'gender' },
  { key: 'vertical', label: 'vertical' }, { key: 'product', label: 'product' },
  { key: 'narrator', label: 'narrator' }, { key: 'language', label: 'language' },
];
const NONE = '__none__';
const LS_FILTERS = 'library_sc_filters_v1';
let _filters = (() => { try { return JSON.parse(localStorage.getItem(LS_FILTERS) || '{}') || {}; } catch (e) { return {}; } })();
const _saveFilters = () => { try { localStorage.setItem(LS_FILTERS, JSON.stringify(_filters)); } catch (e) { /* this view only */ } };
// A scenario opened ON PURPOSE - "open" after the generator saved it, or the one just edited - stays
// in the list even when the filters would hide it, marked as outside them. Choosing a filter or
// another row lets it go.
let _keep = '';
const _val = (it, key) => String(((it && it.meta) || {})[key] || '').trim();
const _passes = (it) => FIELDS.every(f => {
  const want = _filters[f.key];
  if (!want) return true;
  const v = _val(it, f.key);
  return want === NONE ? !v : v === want;
});

function _filterRow() {
  const row = _el('div', 'lib-sc-filters');
  for (const f of FIELDS) {
    const counts = new Map();
    let none = 0;
    for (const it of _items) { const v = _val(it, f.key); if (v) counts.set(v, (counts.get(v) || 0) + 1); else none++; }
    const sel = _el('select', 'lib-sc-filter' + (_filters[f.key] ? ' is-on' : ''));
    sel.title = 'Show only the scenarios with this ' + f.label;
    const add = (value, text) => { const o = _el('option', null, text); o.value = value; sel.appendChild(o); };
    add('', 'any ' + f.label);
    [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).forEach(([v, n]) => add(v, v + ' · ' + n));
    if (none && counts.size) add(NONE, 'no ' + f.label + ' · ' + none);
    // A remembered choice nothing has any more still shows, at 0: the list is never cut by
    // something invisible.
    const cur = _filters[f.key] || '';
    if (cur && ![...sel.options].some(o => o.value === cur)) add(cur, (cur === NONE ? 'no ' + f.label : cur) + ' · 0');
    sel.value = cur;
    sel.addEventListener('change', () => {
      if (_dirty() && !confirm('The lines of the open scenario have changes that are not saved. Leave them?')) { sel.value = cur; return; }
      if (sel.value) _filters[f.key] = sel.value; else delete _filters[f.key];
      _saveFilters();
      _keep = '';
      render(_items, _hooks);
    });
    row.appendChild(sel);
  }
  if (Object.keys(_filters).length) {
    const x = _el('button', 'lib-sc-filter-x', 'clear');
    x.type = 'button';
    x.title = 'Show every scenario again';
    x.addEventListener('click', () => {
      if (_dirty() && !confirm('The lines of the open scenario have changes that are not saved. Leave them?')) return;
      _filters = {};
      _saveFilters();
      _keep = '';
      render(_items, _hooks);
    });
    row.appendChild(x);
  }
  return row;
}

// Where a generated scenario came from, as the generator recorded it (routes/scriptgen.js, save).
// Not the hook: it is the first line of the script, which the lines below show anyway (phase F5).
const ORIGIN_ROWS = [
  ['sourceTitle', 'written from'], ['topicTitle', 'topic'], ['narratorName', 'narrator'],
  ['narratorReading', 'which reading'], ['language', 'language'], ['tone', 'tone'], ['provider', 'provider'], ['model', 'model'],
];
// "Where it came from" folds (phase F5): folded until opened, and remembered either way.
const LS_ORIGIN_OPEN = 'library_sc_origin_open_v1';

let _items = [];
let _sel = '';           // the selected scenario's id
let _seq = 0;            // an answer for a scenario no longer selected is dropped
let _hooks = {};
let _say = null;         // { id, text, kind } - said in the column once it is painted again

// ── The rows ────────────────────────────────────────────────────────────────
function _paintSel() {
  document.querySelectorAll('#lib-grid .lib-srow').forEach(r => r.classList.toggle('cur', r.dataset.id === _sel));
}

// The textarea holds work that is not saved yet: leaving the scenario asks first.
function _dirty() {
  const ta = document.querySelector('#lib-info-body .lib-sc-ta');
  return !!(ta && ta.dataset.was != null && ta.value !== ta.dataset.was);
}

// Pressing the selected row again reads it again too, so it asks as well.
function _pick(it) {
  if (_dirty() && !confirm('The lines of this scenario have changes that are not saved. Leave them?')) return;
  _sel = String(it.id);
  if (_keep && _keep !== _sel) _keep = '';
  _paintSel();
  _show(it);
}

// A draft's row: what it is about, how far it got, where it is written from.
function _draftRow(dr) {
  const row = _el('button', 'lib-srow is-draft');
  row.type = 'button';
  row.title = 'Continue this draft in the generator';
  const main = _el('div', 'lib-srow-main');
  main.appendChild(_el('div', 'lib-srow-t', dr.title || dr.topic || dr.topicTitle || 'untitled draft'));
  const tail = [dr.sourceTitle ? 'from ' + dr.sourceTitle : 'no source',
    dr.paragraphs ? dr.paragraphs + (dr.paragraphs === 1 ? ' paragraph' : ' paragraphs') : '',
    String(dr.narratorName || '').replace(/ — .*$/, '')].filter(Boolean).join(' · ');
  main.appendChild(_el('div', 'lib-srow-s', tail));
  row.appendChild(_el('span', 'lib-sc-tag' + (dr.running ? ' run' : ''),
    'draft · ' + (dr.running ? 'writing…' : (dr.stageLabel || dr.stage || ''))));
  row.appendChild(main);
  row.appendChild(_el('div', 'lib-srow-d', _fmtDate(dr.updatedAt)));
  row.addEventListener('click', () => { if (_hooks.openDraft) _hooks.openDraft(dr.id); });
  return row;
}

export function render(items, hooks = {}) {
  _hooks = hooks || {};
  _items = items || [];
  const grid = $('lib-grid');
  if (!grid) return;
  grid.textContent = '';
  grid.className = 'lib-rows is-scenarios';
  if (_items.length) grid.appendChild(_filterRow());
  for (const dr of (_hooks.drafts || [])) grid.appendChild(_draftRow(dr));

  if (!_items.length) {
    _sel = '';
    grid.appendChild(_el('div', 'lib-empty', 'No scenarios yet. “New scenario” above writes one.'));
    _empty();
    return;
  }
  const shown = _items.filter(it => _passes(it) || String(it.id) === _keep);
  if (!shown.length) {
    _sel = '';
    grid.appendChild(_el('div', 'lib-empty', 'Nothing under these filters.'));
    _empty('Nothing under these filters.');
    return;
  }
  // The selection survives a reload while that scenario is still shown; otherwise the first.
  if (!shown.some(i => String(i.id) === _sel)) _sel = String(shown[0].id);

  for (const it of shown) {
    const outside = !_passes(it);
    const row = _el('button', 'lib-srow' + (String(it.id) === _sel ? ' cur' : '') + (outside ? ' is-outside' : ''));
    row.type = 'button';
    row.dataset.id = String(it.id);
    if (outside) row.title = 'Outside the filters - shown because it was opened';
    const main = _el('div', 'lib-srow-main');
    main.appendChild(_el('div', 'lib-srow-t', it.name));
    main.appendChild(_el('div', 'lib-srow-s', _tail(it.meta || {})));
    row.appendChild(main);
    row.appendChild(_el('div', 'lib-srow-d', _fmtDate((it.meta || {}).date)));
    // Pressing the selected one again reads its column again, as on the picture shelves.
    row.addEventListener('click', () => _pick(it));
    grid.appendChild(row);
  }
  _show(_items.find(i => String(i.id) === _sel));
}

// ── The column ──────────────────────────────────────────────────────────────
function _pane() {
  const pane = $('lib-info'), head = $('lib-info-head'), body = $('lib-info-body');
  if (!pane || !body) return null;
  pane.hidden = false;
  body.className = 'lib-info-body is-scenarios';
  body.textContent = '';
  if (head) head.textContent = 'Scenario';
  return body;
}

function _empty(note) {
  _seq++;
  const body = _pane();
  if (body) body.appendChild(_el('div', 'lib-info-note', note || 'Nothing on this shelf yet.'));
}

// ── The fields, as dropdowns (phase F7) ─────────────────────────────────────
// The lists to choose from: the suggestion lists, the narrators, the generator's languages - read
// once, the narrators again when the narrators window changes them.
let _lists = null;
async function _readLists() {
  if (_lists) return _lists;
  const j = (u) => fetch(u).then(r => r.json()).catch(() => null);
  const [opt, nar, mod] = await Promise.all([j('/api/scen3/options'), j('/api/narrators'), j('/api/scriptgen/models')]);
  _lists = {
    verticals: (opt && opt.options && opt.options.verticals) || [],
    products: (opt && opt.options && opt.options.products) || [],
    roles: (opt && opt.options && opt.options.roles) || [],
    // Neutral is the generator's own voice - not a record in the store, sent beside the list.
    narrators: [...(nar && nar.neutral ? [{ id: String(nar.neutral.id), name: nar.neutral.name }] : []),
      ...((nar && nar.narrators) || []).map(n => ({ id: String(n.id), name: n.name }))],
    languages: (mod && mod.languages) || [],
  };
  return _lists;
}
document.addEventListener('lib:narrators', () => { _lists = null; });

// What the shelf has in use for a field, beside the suggestions: a value on some scenario is a value.
const _inUse = (key) => [...new Set(_items.map(it => _val(it, key)).filter(Boolean))];
const _uniq = (arr) => { const seen = new Set(); return arr.filter(v => { const k = String(v).toLowerCase(); if (!v || seen.has(k)) return false; seen.add(k); return true; }); };

// One field row: a label and a select. `values` are [{value, label}]; "none" and "new…" are added as
// asked. The pick is handed to `onPick`, which saves; a refused save puts the old value back.
function _fieldRow(box, label, current, values, onPick, o = {}) {
  const r = _el('div', 'lib-vi-row is-edit');
  r.appendChild(_el('span', 'lib-vi-l', label));
  const sel = _el('select', 'lib-sc-fsel');
  const add = (value, text) => { const op = _el('option', null, text); op.value = value; sel.appendChild(op); };
  if (o.none) add('', o.noneLabel || 'none');
  for (const v of values) add(v.value, v.label);
  if (current && !values.some(v => v.value === current)) add(current, o.missingLabel ? o.missingLabel(current) : current);
  if (o.newItem) add('__new__', 'new…');
  sel.value = current || '';
  let was = sel.value;
  sel.addEventListener('change', async () => {
    let v = sel.value;
    if (v === '__new__') {
      const name = await askName({ anchor: sel, title: 'New ' + label, okLabel: 'Set', maxLength: 60 });
      if (!name) { sel.value = was; return; }
      v = name.trim();
      if (![...sel.options].some(op => op.value === v)) {
        const op = _el('option', null, v); op.value = v;
        sel.insertBefore(op, sel.querySelector('option[value="__new__"]'));
      }
      sel.value = v;
    }
    sel.disabled = true;
    const ok = await onPick(v);
    sel.disabled = false;
    if (ok) was = sel.value; else sel.value = was;
  });
  r.appendChild(sel);
  box.appendChild(r);
  return sel;
}

// A field saved on its own - only that field, as an edit, so nothing else the column painted can be
// sent back over a newer copy, and the lines being typed stay where they are.
async function _patch(s, patch, what) {
  const st = document.querySelector('#lib-info-body .lib-sc-status');
  const say = (t, k) => { if (st) { st.textContent = t; st.className = 'lib-sc-status' + (k ? ' ' + k : ''); } };
  say('saving ' + what + '…');
  try {
    const r = await fetch('/api/scen3/scenarios', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: s.id, edit: true, ...patch }),
    });
    const d = await r.json().catch(() => null);
    if (r.status === 404) { say('this scenario was deleted elsewhere', 'err'); return false; }
    if (!d || !d.success) throw new Error((d && d.error) || 'refused');
    Object.assign(s, d.scenario);
    // The row and the filters read the shelf's items: this one is told what it is now.
    const it = _items.find(x => String(x.id) === String(s.id));
    if (it) {
      const role = (d.scenario.roles || [])[0] || {};
      it.meta = { ...(it.meta || {}), type: d.scenario.type || '', vertical: d.scenario.vertical || '', product: d.scenario.product || '',
        role: role.name || '', gender: role.gender || '',
        roles: role.name ? role.name + (role.gender ? ' (' + String(role.gender)[0] + ')' : '') : '',
        narrator: (d.scenario.narrator && d.scenario.narrator.name) || '', language: d.scenario.language || '' };
      const row = document.querySelector('#lib-grid .lib-srow[data-id="' + CSS.escape(String(s.id)) + '"] .lib-srow-s');
      if (row) row.textContent = _tail(it.meta);
      // The one just edited stays in sight even if it no longer matches, and the filters are counted
      // again - a value made with "new…" can be filtered by at once.
      _keep = String(s.id);
      const fr = document.querySelector('#lib-grid .lib-sc-filters');
      if (fr) fr.replaceWith(_filterRow());
    }
    say('saved · ' + what, 'ok');
    return true;
  } catch (e) { say('Not saved: ' + e.message, 'err'); return false; }
}

async function _paintFields(box, s) {
  const L = await _readLists();
  const opt = (arr) => arr.map(v => ({ value: v, label: v }));
  const role = (s.roles || [])[0] || { id: 'r0', name: '', gender: '' };
  const roleOf = (name, gender) => [{ id: role.id || 'r0', name, gender }];
  _fieldRow(box, 'type', s.type || 'talking_head', opt(_uniq(['talking_head', ..._inUse('type')])),
    v => _patch(s, { type: v || 'talking_head' }, 'type'), { newItem: true });
  const roleSel = _fieldRow(box, 'role', role.name, opt(_uniq([..._inUse('role'), ...L.roles])),
    v => _patch(s, { roles: roleOf(v, genderSel.value) }, 'role'), { none: true, newItem: true });
  const genderSel = _fieldRow(box, 'gender', role.gender, [{ value: 'female', label: 'female' }, { value: 'male', label: 'male' }],
    v => _patch(s, { roles: roleOf(roleSel.value, v) }, 'gender'), { none: true });
  _fieldRow(box, 'vertical', s.vertical, opt(_uniq([..._inUse('vertical'), ...L.verticals])),
    v => _patch(s, { vertical: v }, 'vertical'), { none: true, newItem: true });
  _fieldRow(box, 'product', s.product, opt(_uniq([..._inUse('product'), ...L.products])),
    v => _patch(s, { product: v }, 'product'), { none: true, newItem: true });
  // The narrator by id; one the list does not have any more is named, marked deleted.
  const nar = s.narrator || null;
  const narValues = L.narrators.map(n => ({ value: n.id, label: n.name }));
  const curNar = nar ? (nar.id || (L.narrators.find(n => n.name === nar.name) || {}).id || '__name__:' + nar.name) : '';
  _fieldRow(box, 'narrator', curNar, narValues, (v) => {
    if (!v) return _patch(s, { narrator: { id: '', name: '' } }, 'narrator');
    const n = L.narrators.find(x => x.id === v);
    if (n) return _patch(s, { narrator: { id: n.id, name: n.name } }, 'narrator');
    // The value it was painted with - a narrator since deleted - goes back as it was, by its name.
    return _patch(s, { narrator: { id: nar && nar.id && v === curNar ? nar.id : '', name: nar ? nar.name : '' } }, 'narrator');
  }, { none: true, missingLabel: () => (nar ? nar.name : '') + ' — deleted' });
  _fieldRow(box, 'language', s.language || '', opt(_uniq([...L.languages, ..._inUse('language')])),
    v => _patch(s, { language: v }, 'language'), { none: true });
}

function _row(box, label, value) {
  if (!value) return;
  const r = _el('div', 'lib-vi-row');
  r.appendChild(_el('span', 'lib-vi-l', label));
  r.appendChild(_el('span', 'lib-vi-v', value));
  box.appendChild(r);
}

async function _show(it) {
  const my = ++_seq;
  const body = _pane();
  if (!body || !it) return;
  body.appendChild(_el('div', 'lib-sc-title', it.name));
  let s = null;
  try {
    const d = await fetch('/api/scen3/scenarios/' + encodeURIComponent(it.id)).then(r => r.json());
    if (!d || !d.success) throw new Error((d && d.error) || 'it could not be read');
    s = d.scenario;
  } catch (e) {
    if (my !== _seq) return;
    body.appendChild(_el('div', 'lib-info-note', e.message));
    return;
  }
  if (my !== _seq) return;
  body.textContent = '';
  body.appendChild(_el('div', 'lib-sc-title', s.title || 'untitled'));

  const lines = s.lines || [];
  const facts = _el('div', 'lib-vi');
  body.appendChild(facts);
  await _paintFields(facts, s);
  if (my !== _seq) return;
  _row(facts, 'lines', String(lines.length));
  _row(facts, 'edited', _fmtDate(s.updatedAt || s.createdAt));

  const fold = _el('details', 'lib-sc-origin');
  try { fold.open = localStorage.getItem(LS_ORIGIN_OPEN) === '1'; } catch (e) { /* folded */ }
  fold.appendChild(_el('summary', 'lib-info-sec', 'Where it came from'));
  fold.addEventListener('toggle', () => { try { localStorage.setItem(LS_ORIGIN_OPEN, fold.open ? '1' : '0'); } catch (e) { /* kept for this view */ } });
  const o = s.origin;
  if (!o) fold.appendChild(_el('div', 'lib-info-note', 'Written by hand.'));
  else {
    const from = _el('div', 'lib-vi');
    // The source by its current name (the server reads it live); one since deleted by the name it had.
    const gone = o.sourceId && o.sourceGone;
    for (const [key, label] of ORIGIN_ROWS) {
      if (key === 'sourceTitle' && gone) continue;
      _row(from, label, String(o[key] || '').trim());
    }
    if (gone) _row(from, 'written from', o.sourceTitle ? '“' + o.sourceTitle + '” - source deleted' : 'a source since deleted');
    else if (!o.sourceTitle) _row(from, 'written from', 'no source');
    if (o.humanized) _row(from, 'cleaning pass', 'applied');
    fold.appendChild(from);
  }
  body.appendChild(fold);

  body.appendChild(_el('div', 'lib-info-sec', 'Lines · ' + lines.length));
  const edit = _el('div', 'lib-sc-edit');
  const ta = _el('textarea', 'lib-sc-ta');
  ta.spellcheck = false;
  ta.placeholder = 'One line of the script per line.';
  ta.value = lines.map(l => String((l && l.text) || '').replace(/\s*\n\s*/g, ' ')).join('\n');
  ta.dataset.was = ta.value;
  edit.appendChild(ta);

  const foot = _el('div', 'lib-sc-foot');
  const save = _el('button', 'lib-btn', 'Save');
  save.type = 'button';
  save.title = 'Save the lines (Ctrl+Enter)';
  const st = _el('span', 'lib-sc-status');
  const del = _el('button', 'lib-btn danger', 'Delete');
  del.type = 'button';
  del.title = 'Delete this scenario';
  foot.append(save, st, _el('span', 'sp'), del);
  body.appendChild(edit);
  // The foot is the column's last child, stuck to its bottom edge (phase F6): Save and Delete are
  // in sight however long the lines are.
  body.appendChild(foot);

  save.addEventListener('click', () => _save(s, ta, save, st));
  ta.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); save.click(); }
  });
  del.addEventListener('click', () => _delete(s, del));

  // A script needs no inner scrolling when it fits; past that the textarea scrolls.
  requestAnimationFrame(() => { ta.style.height = Math.min(520, Math.max(140, ta.scrollHeight + 4)) + 'px'; });

  // What the last Save or refusal said, now that the column is painted again.
  if (_say && _say.id === String(s.id)) {
    st.textContent = _say.text;
    st.className = 'lib-sc-status' + (_say.kind ? ' ' + _say.kind : '');
  }
  _say = null;
}

async function _save(s, ta, btn, st) {
  // Blank lines are separators people leave while editing, not lines of script: they are dropped
  // rather than saved as empty ones, which also stops a stray trailing newline adding a line.
  const lines = ta.value.split('\n').map(t => t.trim()).filter(Boolean).map(text => ({ text }));
  if (!lines.length) { st.textContent = 'Nothing to save - every line is empty.'; st.className = 'lib-sc-status err'; return; }
  btn.disabled = true;
  st.textContent = 'saving…';
  st.className = 'lib-sc-status';
  try {
    // Only what the column edits: the title it painted may have been renamed since, in Merge. And an
    // EDIT, so a scenario deleted meanwhile is not made again from these lines alone.
    const r = await fetch('/api/scen3/scenarios', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: s.id, lines, edit: true }),
    });
    const d = await r.json().catch(() => null);
    if (r.status === 404) {
      ta.dataset.was = ta.value;                // nothing left to save it into - leaving is not a loss
      if (_hooks.status) _hooks.status('"' + (s.title || 'untitled') + '" was deleted elsewhere', 'err');
      _sel = '';
      if (_hooks.reload) await _hooks.reload();
      if (_hooks.counts) _hooks.counts();
      return;
    }
    if (!d || !d.success) throw new Error((d && d.error) || 'refused');
    ta.dataset.was = ta.value;
    _keep = String(s.id);
    // Said after the reload repaints the column (the row's line count comes from the store).
    _say = { id: String(s.id), text: 'Saved · ' + lines.length + (lines.length === 1 ? ' line' : ' lines'), kind: 'ok' };
    if (_hooks.reload) await _hooks.reload();
  } catch (e) {
    st.textContent = 'Not saved: ' + e.message;
    st.className = 'lib-sc-status err';
    btn.disabled = false;
  }
}

async function _delete(s, btn) {
  if (!confirm('Delete "' + (s.title || 'untitled') + '"?\n\nThe scenario goes for good. Projects already made from it keep their own copy of the text.')) return;
  btn.disabled = true;
  try {
    const d = await fetch('/api/scen3/scenarios/' + encodeURIComponent(s.id), { method: 'DELETE' }).then(r => r.json());
    if (!d || !d.success) throw new Error((d && d.error) || 'refused');
    _sel = '';                                  // the first one is selected after the reload
    if (_hooks.reload) await _hooks.reload();
    if (_hooks.counts) _hooks.counts();
    if (_hooks.status) _hooks.status('Deleted "' + (s.title || 'untitled') + '"');
  } catch (e) {
    btn.disabled = false;
    if (_hooks.status) _hooks.status('Not deleted: ' + e.message, 'err');
  }
}

/** Lines typed and not saved - the page asks before the shelf is left. */
export function unsaved() { return _dirty(); }

/** Lines typed and not saved, dropped: the person agreed to leave them (the generator opened over
 *  them), and must not be asked again about lines no longer on screen. */
export function drop() {
  const ta = document.querySelector('#lib-info-body .lib-sc-ta');
  if (ta && ta.dataset.was != null) ta.value = ta.dataset.was;
}

/** The scenario to select at the next render - one the generator has just saved. */
export function select(id) { _sel = String(id || ''); _keep = _sel; }

// Leaving the shelf: an answer on its way is dropped, and coming back opens on the first scenario.
export function leave() {
  _seq++;
  _sel = '';
  _say = null;
}
