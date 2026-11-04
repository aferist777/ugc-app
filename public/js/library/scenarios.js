// LIBRARY — the scenarios shelf.
//
// The second shelf that is not pictures, and it draws rows for the same reason the voices shelf
// does: a scenario is a title, a few fields and a line count. A card here would be a grey tile
// with a name under it, which is a thumbnail that admits it has no thumbnail.
//
// ONE ROW IS ALWAYS SELECTED and the right column is about it (phase D5, the owner 2026-09-29) - the
// rule of the picture shelves: opening the shelf selects the first, a delete falls back to the
// first, a reload keeps the one that was selected. The column holds the whole scenario: its title with its line count
// and date, its fields three to a row, "Make video" and Delete, and its lines - (phase V38.6, the owner: "если сценарий
// уже сохранен, то давай отображать так же построчно как и при создании, только без полей для генерации") a card each,
// as the generator shows a script, the first the hook, edited in place. (V38.7) No "Where it came from" and no rewrite
// in the narrator's voice any more: the scenario is written.
//
// NOTHING TO SAVE BY HAND (phase V28.2, the owner 2026-10-12: "сохранение должно быть автоматическим после любых
// изменений в сценарии"): a field is saved the moment it is chosen, the lines a moment after the typing stops, when the
// textarea is left, and before anything paints the column again or leads away from it. Where "Save" was stands "Make
// video" ("чтобы после прочтения можно было сразу начать делать видео в merge"): the talking head made from the
// scenario, and Merge opened on it - what "use" does in Merge's picker.
//
// DRAFTS HEAD THE LIST (phase E4): a script the generator is still writing, one row each, saying how
// far it got. (V38.6) A draft is SELECTED like a scenario (`_sel` 'd:<id>'): the right side is then the generator's form
// on that draft, without the sources (the page moves it there - js/library/main.js _showDraftHere). The shelf opens on
// the first scenario; a draft chosen stays chosen while it is there.
//
// FILTERS AND FIELDS (phase F7, the owner 2026-09-30): over the list, above the drafts, a dropdown per
// field - type, role, gender, vertical, product, narrator (the voice of the WRITING) - with
// the values the scenarios really have and how many; the choice is remembered, drafts are not
// filtered. The same fields are dropdowns in the column, saved the moment one is chosen, each with
// "new…" for a value nobody has used yet.
//
// Lines are `{text}` records - the roles live on the scenario, not on its lines - so splitting the
// textarea on newlines maps onto the store exactly. A line that carries a newline of its own (the
// generator can write one) is shown on one textarea line, or a Save would quietly make it two.
//
// THE ARCHIVE (phase V60, the owner 2026-10-29, (пп6а)-(пп8а): "снизу списка будет типа под папка в которой будут
// архивированные сценарии. правый клик по сценарию открывает контекстное меню в котором кнопка archive"): at the bottom of
// the list a folded row "▸ Archive · N" - pressed, the archived scenarios open under it, paler, newest first; pressed
// again, they fold; remembered. None archived - no row. While any filter over the list is chosen the archive is not
// shown at all (the owner: "архивные записи не показываются при изменении фильтров"); the filters and their numbers
// count the live scenarios only. The right button on a scenario: "Archive"; on an archived one: "Restore" (drafts have
// no menu). An archived one selected: its lines on the right, edited and saved as any, with "Restore" where "Make video"
// stands - a video is not made from the archive. The archive is Merge's too: the same flag, the same edit (scen-api.js
// `archive`); going in keeps the scenario's date, coming back gives it a new one, so it heads the list.

import { askName } from '../name-box.js';
import * as Layers from '../layers.js';
import { talkingHead, archive as archiveScenario } from '../merge-v3/scen-api.js';
import { menuAt } from '../tile-select.js';
import { spokenSeconds } from './jobs.js';

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
  ].filter(Boolean).join(' · ');
}

// ── Filters (phase F7) ──────────────────────────────────────────────────────
const FIELDS = [
  { key: 'type', label: 'type' }, { key: 'role', label: 'role' }, { key: 'gender', label: 'gender' },
  { key: 'vertical', label: 'vertical' }, { key: 'product', label: 'product' },
  { key: 'narrator', label: 'narrator' },
];
const NONE = '__none__';
const LS_FILTERS = 'library_sc_filters_v1';
let _filters = (() => { try { return JSON.parse(localStorage.getItem(LS_FILTERS) || '{}') || {}; } catch (e) { return {}; } })();
const _saveFilters = () => { try { localStorage.setItem(LS_FILTERS, JSON.stringify(_filters)); } catch (e) { /* this view only */ } };
// The language filter went with the field (phase V29): a remembered one would leave "clear" over nothing.
if ('language' in _filters) { delete _filters.language; _saveFilters(); }
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
    const sel = _el('select', 'lib-sc-filter u-in is-s' + (_filters[f.key] ? ' is-on' : ''));
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
      if (sel.value) _filters[f.key] = sel.value; else delete _filters[f.key];
      _saveFilters();
      _keep = '';
      render(_items, _hooks);
    });
    row.appendChild(sel);
  }
  if (Object.keys(_filters).length) {
    const x = _el('button', 'lib-sc-filter-x u-btn is-s is-quiet', 'clear');
    x.type = 'button';
    x.title = 'Show every scenario again';
    x.addEventListener('click', () => {
      _filters = {};
      _saveFilters();
      _keep = '';
      render(_items, _hooks);
    });
    row.appendChild(x);
  }
  return row;
}

let _items = [];
let _sel = '';           // the selected scenario's id
let _seq = 0;            // an answer for a scenario no longer selected is dropped
let _hooks = {};
let _say = null;         // { id, text, kind } - said in the column once it is painted again

// ── The archive (phase V60) ─────────────────────────────────────────────────
let _archived = [];      // the archived scenarios, newest first (the shelf's `archived`)
const LS_ARCH = 'library_sc_archive_open_v1';
let _archOpen = (() => { try { return localStorage.getItem(LS_ARCH) === '1'; } catch (e) { return false; } })();
// Shown only with no filter chosen, and only when there is something in it.
const _archShown = () => _archived.length > 0 && !Object.keys(_filters).length;
// A scenario of the shelf by id - live or archived.
const _any = (id) => _items.find(x => String(x.id) === String(id)) || _archived.find(x => String(x.id) === String(id)) || null;

// ── The rows ────────────────────────────────────────────────────────────────
function _paintSel() {
  document.querySelectorAll('#lib-grid .lib-srow').forEach(r => r.classList.toggle('cur', r.dataset.id === _sel));
}

// Pressing the selected row again reads it again too - after its lines are in the store (`_pane`).
function _pick(it) {
  _sel = String(it.id);
  if (_keep && _keep !== _sel) _keep = '';
  _paintSel();
  _show(it);
}

// A draft's row: what it is about, how far it got, where it is written from.
function _draftRow(dr) {
  const key = 'd:' + dr.id;
  const row = _el('button', 'lib-srow is-draft' + (_sel === key ? ' cur' : ''));
  row.type = 'button';
  row.dataset.id = key;
  row.title = 'This draft on the right - its fields and its script';
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
  row.addEventListener('click', () => _pickDraft(dr));
  return row;
}

// (V38.6) A draft chosen: the scenario on show lets go (its lines stored), and the page puts the draft's form on the
// right. Pressing the chosen draft again leaves its form as it is.
function _pickDraft(dr) {
  const key = 'd:' + dr.id;
  if (_sel === key) return;
  _sel = key;
  _keep = '';
  _paintSel();
  _showDraft(dr.id);
}
function _showDraft(id) {
  _seq++;
  _closeFieldMenu();
  if (_auto) { _flushing = _flushA(_auto); _auto = null; }
  const pane = $('lib-info');
  if (pane) pane.hidden = true;
  if (_hooks.showDraft) _hooks.showDraft(String(id));
}

export function render(items, hooks = {}) {
  _hooks = hooks || {};
  _items = items || [];
  _archived = Array.isArray(_hooks.archived) ? _hooks.archived : [];
  const grid = $('lib-grid');
  if (!grid) return;
  grid.textContent = '';
  grid.className = 'lib-rows is-scenarios';
  if (_items.length) grid.appendChild(_filterRow());
  const drafts = _hooks.drafts || [];
  // (V38.6) A draft chosen stays chosen while it is there - saved or discarded, the scenarios have the selection back.
  if (_sel.startsWith('d:') && !drafts.some(d => 'd:' + d.id === _sel)) _sel = '';
  const shown = _items.filter(it => _passes(it) || String(it.id) === _keep);
  // (phase V60) The archived ones in sight: the archive shown (no filter) and open.
  const arch = _archShown() && _archOpen ? _archived : [];
  // The selection survives a reload while that scenario is still shown; otherwise the first scenario - or, with none
  // to show, the first draft, then the first archived one in sight.
  if (!_sel.startsWith('d:') && !shown.concat(arch).some(i => String(i.id) === _sel)) {
    _sel = shown.length ? String(shown[0].id) : drafts.length ? 'd:' + drafts[0].id : arch.length ? String(arch[0].id) : '';
  }
  for (const dr of drafts) grid.appendChild(_draftRow(dr));

  if (!_items.length) grid.appendChild(_el('div', 'lib-empty', _archived.length ? 'Every scenario is in the archive.' : 'No scenarios yet. “New scenario” above writes one.'));
  else if (!shown.length) grid.appendChild(_el('div', 'lib-empty', 'Nothing under these filters.'));
  for (const it of shown) grid.appendChild(_row(it, false));
  if (_archShown()) {
    grid.appendChild(_archHead());
    for (const it of arch) grid.appendChild(_row(it, true));
  }
  if (_sel.startsWith('d:')) { _showDraft(_sel.slice(2)); return; }
  const cur = shown.concat(arch).find(i => String(i.id) === _sel);
  if (!cur) { _empty(_items.length ? 'Nothing under these filters.' : undefined); return; }
  _show(cur);
}

// A scenario's row - live, or (phase V60) archived: paler, and its menu says "Restore".
function _row(it, archived) {
  const outside = !archived && !_passes(it);
  const row = _el('button', 'lib-srow' + (String(it.id) === _sel ? ' cur' : '') + (outside ? ' is-outside' : '') + (archived ? ' is-archived' : ''));
  row.type = 'button';
  row.dataset.id = String(it.id);
  if (outside) row.title = 'Outside the filters - shown because it was opened';
  else if (archived) row.title = 'Archived - the right button puts it back';
  const main = _el('div', 'lib-srow-main');
  main.appendChild(_el('div', 'lib-srow-t', it.name));
  main.appendChild(_el('div', 'lib-srow-s', _tail(it.meta || {})));
  row.appendChild(main);
  row.appendChild(_el('div', 'lib-srow-d', _fmtDate((it.meta || {}).date)));
  // Pressing the selected one again reads its column again, as on the picture shelves.
  row.addEventListener('click', () => _pick(it));
  // (phase V60, the owner's (пп7а)) The right button: "Archive", or on an archived one "Restore".
  row.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    menuAt(e.clientX, e.clientY, [archived
      ? ['Restore', 'back into the list of scenarios', () => _setArchived(it, false)]
      : ['Archive', 'out of the list - into Archive at the bottom', () => _setArchived(it, true)]]);
  });
  return row;
}

// "▸ Archive · N" - pressed, the archived ones open under it; pressed again, they fold. Remembered.
function _archHead() {
  const b = _el('button', 'lib-sc-arch u-btn is-quiet' + (_archOpen ? ' is-open' : ''));
  b.type = 'button';
  b.setAttribute('aria-expanded', _archOpen ? 'true' : 'false');
  b.title = _archOpen ? 'Fold the archive' : 'The archived scenarios';
  b.appendChild(_el('span', 'lib-sc-arch-c', '▸'));
  b.appendChild(_el('span', 'lib-sc-arch-t', 'Archive'));
  b.appendChild(_el('span', 'lib-sc-arch-n', '· ' + _archived.length));
  b.addEventListener('click', () => {
    _archOpen = !_archOpen;
    try { localStorage.setItem(LS_ARCH, _archOpen ? '1' : '0'); } catch (e) { /* this view only */ }
    const grid = $('lib-grid');
    const top = grid ? grid.scrollTop : 0;
    render(_items, _hooks);
    if (grid) grid.scrollTop = top;
  });
  return b;
}

// Into the archive or back - the edit Merge sends (scen-api.js `archive`). What is typed into it is stored first. Going in,
// it stays selected while the archive is open; coming back, it heads the list and stays selected.
async function _setArchived(it, yes) {
  const id = String(it.id);
  if (_auto && String(_auto.s.id) === id) await _flushA(_auto);
  try {
    await archiveScenario(id, yes);
  } catch (e) {
    if (_hooks.status) _hooks.status((yes ? 'Not archived: ' : 'Not restored: ') + e.message, 'err');
    return;
  }
  if (!yes || _sel === id) _sel = id;
  if (!yes) _keep = id;
  if (_hooks.reload) await _hooks.reload();
  if (_hooks.counts) _hooks.counts();
  if (_hooks.status) _hooks.status(yes ? 'Archived “' + (it.name || 'untitled') + '” - Archive, at the bottom of the list' : 'Restored “' + (it.name || 'untitled') + '”');
}

// ── The column ──────────────────────────────────────────────────────────────
function _pane() {
  const pane = $('lib-info'), head = $('lib-info-head'), body = $('lib-info-body');
  if (!pane || !body) return null;
  // (V38.6) A draft's form on the right gives way to the scenario.
  if (_hooks.hideDraft) _hooks.hideDraft();
  _closeFieldMenu();   // its field is about to be painted again
  // What was typed into the scenario on show goes to the store before the column is painted again - and before it is
  // read again, which waits for it (_show).
  if (_auto) { _flushing = _flushA(_auto); _auto = null; }
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
// The lists to choose from: the suggestion lists and the narrators - read once, the narrators again
// when the narrators window changes them.
let _lists = null;
async function _readLists() {
  if (_lists) return _lists;
  const j = (u) => fetch(u).then(r => r.json()).catch(() => null);
  const [opt, nar] = await Promise.all([j('/api/scen3/options'), j('/api/narrators')]);
  _lists = {
    verticals: (opt && opt.options && opt.options.verticals) || [],
    products: (opt && opt.options && opt.options.products) || [],
    roles: (opt && opt.options && opt.options.roles) || [],
    // Neutral is the generator's own voice - not a record in the store, sent beside the list.
    narrators: [...(nar && nar.neutral ? [{ id: String(nar.neutral.id), name: nar.neutral.name }] : []),
      ...((nar && nar.narrators) || []).map(n => ({ id: String(n.id), name: n.name, ready: !!n.ready }))],
  };
  return _lists;
}
document.addEventListener('lib:narrators', () => { _lists = null; });

// What the shelf has in use for a field, beside the suggestions: a value on some scenario is a value.
const _inUse = (key) => [...new Set(_items.map(it => _val(it, key)).filter(Boolean))];
const _uniq = (arr) => { const seen = new Set(); return arr.filter(v => { const k = String(v).toLowerCase(); if (!v || seen.has(k)) return false; seen.add(k); return true; }); };

// ONE FIELD (phase G4, the owner 2026-09-30; V38.7: "в три столбца и название дропдауна слева от дропдауна"): its name
// on the left of a button that shows the value - the names of one width, so the buttons stand in line - three to a row. Pressing it opens the list as a layer - a list of our own, because a row of a native <select>
// cannot carry the ✕ that removes a wrong value. `values` are [{value, label}]; "none" and "new…" are
// added as asked. The pick is handed to `onPick`, which saves; a refused save puts the old value back.
// Returns { value } - the role and the gender read each other's current value when they save.
function _fieldRow(box, label, current, values, onPick, o = {}) {
  const cell = _el('div', 'lib-sc-cell');
  cell.appendChild(_el('span', 'lib-sc-cl', label));
  const btn = _el('button', 'lib-sc-fbtn u-btn is-s is-field');
  btn.type = 'button';
  const f = { value: current || '' };
  const labelOf = (v) => {
    if (!v) return o.noneLabel || 'none';
    const hit = values.find(x => x.value === v);
    return hit ? hit.label : (o.missingLabel ? o.missingLabel(v) : v);
  };
  const paint = () => {
    btn.textContent = '';
    btn.appendChild(_el('span', 'lib-sc-fbtn-t', labelOf(f.value)));
    btn.appendChild(_el('span', 'lib-sc-fbtn-c', '▾'));
    btn.title = labelOf(f.value);
    btn.classList.toggle('is-none', !f.value);
  };
  paint();
  const choose = async (v) => {
    if (v === '__new__') {
      const name = await askName({ anchor: btn, title: 'New ' + label, okLabel: 'Set', maxLength: 60 });
      v = String(name || '').trim();
      if (!v) return;
      if (!values.some(x => x.value === v)) values.push({ value: v, label: v });
    }
    if (v === f.value) return;
    const was = f.value;
    f.value = v;
    paint();
    btn.disabled = true;
    const ok = await onPick(v);
    btn.disabled = false;
    if (!ok) { f.value = was; paint(); }
  };
  btn.addEventListener('click', () => {
    if (_fmenu && _fmenu.anchor === btn) { _closeFieldMenu(); return; }
    const rows = [];
    if (o.none) rows.push({ value: '', label: o.noneLabel || 'none' });
    rows.push(...values);
    // The value it holds, when the list no longer has it (a narrator since deleted), is still shown.
    if (f.value && !values.some(x => x.value === f.value)) rows.push({ value: f.value, label: labelOf(f.value) });
    _fieldMenu(btn, {
      label, rows, current: f.value, newItem: !!o.newItem, onChoose: choose,
      removable: o.remove ? (v) => !!v && o.remove.can(v) : null,
      field: o.remove ? o.remove.field : '',
      onRemoved: (v) => {
        const i = values.findIndex(x => x.value === v);
        if (i >= 0) values.splice(i, 1);
        if (f.value === v) { f.value = o.remove.fallback || ''; paint(); }
      },
    });
  });
  cell.appendChild(btn);
  box.appendChild(cell);
  return f;
}

// The open list of a field: one at a time, on the Layers stack (Escape closes it), closed by a press
// anywhere outside it and whenever the column is painted again.
let _fmenu = null;
function _closeFieldMenu() {
  if (!_fmenu) return;
  const m = _fmenu;
  _fmenu = null;
  document.removeEventListener('mousedown', m.away, true);
  window.removeEventListener('scroll', m.onScroll, true);
  window.removeEventListener('resize', _closeFieldMenu);
  m.el.remove();
  Layers.close(m.layer);
}

// REMOVING A VALUE: the ✕ at the right of a row, shown on hover. The first press only asks - the row
// turns red and says how many scenarios carry it (archived ones too; the server counts) - the second
// removes it, and moving off the row takes the question back.
function _fieldMenu(anchor, m) {
  _closeFieldMenu();
  const menu = _el('div', 'mv3-plus-menu lib-sc-menu u-menu is-float');
  menu.setAttribute('role', 'listbox');
  menu.setAttribute('aria-label', m.label);
  const pick = (v) => { _closeFieldMenu(); m.onChoose(v); };
  for (const r of m.rows) {
    const row = _el('div', 'lib-sc-mrow');
    const it = _el('button', 'mv3-plus-item u-mi' + (r.value === m.current ? ' is-cur' : ''));
    it.type = 'button';
    it.setAttribute('role', 'option');
    it.setAttribute('aria-selected', r.value === m.current ? 'true' : 'false');
    const txt = _el('span', null, r.label);
    it.appendChild(txt);
    it.addEventListener('click', (e) => { e.stopPropagation(); if (row.classList.contains('is-asking')) return; pick(r.value); });
    row.appendChild(it);
    if (m.removable && m.removable(r.value)) {
      const x = _el('button', 'lib-sc-mx u-btn is-s is-icon is-quiet is-del u-x', '');
      x.type = 'button';
      x.title = 'Remove "' + r.label + '" - from the list and from every scenario that has it';
      x.setAttribute('aria-label', 'Remove ' + r.label);
      let ask = 0;   // which question is standing: the answer to an older one is dropped
      const back = () => { ask++; row.classList.remove('is-asking'); delete row.dataset.count; txt.textContent = r.label; it.disabled = false; };
      row.addEventListener('mouseleave', () => { if (row.classList.contains('is-asking')) back(); });
      x.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!row.classList.contains('is-asking')) {
          const my = ++ask;
          row.classList.add('is-asking');
          it.disabled = true;
          txt.textContent = 'counting…';
          const n = await _valueCount(m.field, r.value);
          if (my !== ask) return;
          if (n.error) { txt.textContent = 'cannot say - ' + n.error; return; }
          row.dataset.count = String(n.count);
          txt.textContent = n.count
            ? 'remove from ' + n.count + (n.count === 1 ? ' scenario' : ' scenarios') + (n.archived ? ' (' + n.archived + ' archived)' : '') + '?'
            : 'remove?';
          return;
        }
        // The second press - only once the count has come back.
        if (row.dataset.count == null) return;
        const count = Number(row.dataset.count || 0);
        // The list may be drawn again (scenarios carried it, or a filter stood on it): the column's lines are
        // saved before it is painted again (`_pane`).
        _closeFieldMenu();
        await _removeValue(m.field, r.value, count, () => m.onRemoved(r.value));
      });
      row.appendChild(x);
    }
    menu.appendChild(row);
  }
  if (m.newItem) {
    const row = _el('div', 'lib-sc-mrow');
    const it = _el('button', 'mv3-plus-item u-mi is-new');
    it.type = 'button';
    it.appendChild(_el('span', null, 'new…'));
    it.addEventListener('click', (e) => { e.stopPropagation(); pick('__new__'); });
    row.appendChild(it);
    menu.appendChild(row);
  }
  document.body.appendChild(menu);
  const r = anchor.getBoundingClientRect();
  menu.style.minWidth = Math.max(190, Math.round(r.width)) + 'px';
  const below = window.innerHeight - r.bottom - 8, above = r.top - 8;
  const up = below < Math.min(menu.offsetHeight, 240) && above > below;
  menu.style.maxHeight = Math.max(120, Math.round(up ? above : below)) + 'px';
  menu.style.left = Math.round(Math.max(6, Math.min(window.innerWidth - menu.offsetWidth - 6, r.left))) + 'px';
  menu.style.top = Math.round(up ? Math.max(6, r.top - 2 - menu.offsetHeight) : r.bottom + 2) + 'px';
  const cur = menu.querySelector('.is-cur');
  if (cur) cur.scrollIntoView({ block: 'nearest' });
  const away = (e) => { if (!menu.contains(e.target) && !anchor.contains(e.target)) _closeFieldMenu(); };
  // Placed once, so it closes when what it hangs from moves: the column scrolling under it, the window
  // changing size. A scroll INSIDE the list (a long one, or the current value brought into view) is its own.
  const onScroll = (e) => { if (!menu.contains(e.target)) _closeFieldMenu(); };
  _fmenu = { el: menu, anchor, away, onScroll, layer: Layers.open(menu, { modal: false, name: m.label + ' list', onEsc: _closeFieldMenu }) };
  window.addEventListener('scroll', onScroll, true);
  window.addEventListener('resize', _closeFieldMenu);
  setTimeout(() => { if (_fmenu && _fmenu.el === menu) document.addEventListener('mousedown', away, true); }, 0);
}

async function _valueCount(field, value) {
  try {
    const r = await fetch('/api/scen3/values/remove', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ field, value, dry: true }),
    });
    const d = await r.json().catch(() => null);
    if (!d || !d.success) return { count: 0, error: (d && d.error) || 'refused' };
    return { count: d.count || 0, archived: d.archived || 0 };
  } catch (e) { return { count: 0, error: e.message }; }
}

// The removal itself. The suggestion lists are read again at the next paint; when scenarios carried the
// value the shelf is read again too - their rows, the filters and this column all say what they are now.
// A filter set to the removed value is let go, or it would hide everything behind a value nobody has.
async function _removeValue(field, value, count, onDone) {
  const st = document.querySelector('#lib-info-body .lib-sc-status');
  const say = (t, k) => { if (st) { st.textContent = t; st.className = 'lib-sc-status' + (k ? ' ' + k : ''); } };
  say('removing ' + field + ' “' + value + '”…');
  try {
    const r = await fetch('/api/scen3/values/remove', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ field, value }),
    });
    const d = await r.json().catch(() => null);
    if (!d || !d.success) throw new Error((d && d.error) || 'refused');
    _lists = null;
    if (onDone) onDone();
    // The generator's form may hold it too (js/library/make.js clears it there).
    document.dispatchEvent(new CustomEvent('lib:values-removed', { detail: { field, value } }));
    const dropped = !!(_filters[field] && _filters[field].toLowerCase() === value.toLowerCase());
    if (dropped) { delete _filters[field]; _saveFilters(); }
    const n = d.count || 0;
    const note = 'removed ' + field + ' “' + value + '”' + (n ? ' from ' + n + (n === 1 ? ' scenario' : ' scenarios') : '');
    if (n || count) {
      _say = { id: _sel, text: note, kind: 'ok' };
      if (_hooks.reload) await _hooks.reload();
    } else if (dropped) {
      // Nothing carried it, but the list was filtered by it: drawn again without that filter.
      _say = { id: _sel, text: note, kind: 'ok' };
      render(_items, _hooks);
    } else say(note, 'ok');
  } catch (e) { say('Not removed: ' + e.message, 'err'); }
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
    const it = _any(s.id);
    if (it) {
      const role = (d.scenario.roles || [])[0] || {};
      it.meta = { ...(it.meta || {}), type: d.scenario.type || '', vertical: d.scenario.vertical || '', product: d.scenario.product || '',
        role: role.name || '', gender: role.gender || '',
        roles: role.name ? role.name + (role.gender ? ' (' + String(role.gender)[0] + ')' : '') : '',
        narrator: (d.scenario.narrator && d.scenario.narrator.name) || '' };
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
  // What a ✕ may take away (phase G4): the four vocabularies a person types into. talking_head is the
  // type everything falls back to; gender is two words, narrators go in their own window.
  const rm = (field, fallback) => ({ field, fallback, can: (v) => !(field === 'type' && v === 'talking_head') });
  _fieldRow(box, 'type', s.type || 'talking_head', opt(_uniq(['talking_head', ..._inUse('type')])),
    v => _patch(s, { type: v || 'talking_head' }, 'type'), { newItem: true, remove: rm('type', 'talking_head') });
  const roleF = _fieldRow(box, 'role', role.name, opt(_uniq([..._inUse('role'), ...L.roles])),
    v => _patch(s, { roles: roleOf(v, genderF.value) }, 'role'), { none: true, newItem: true, remove: rm('role', '') });
  const genderF = _fieldRow(box, 'gender', role.gender, [{ value: 'female', label: 'female' }, { value: 'male', label: 'male' }],
    v => _patch(s, { roles: roleOf(roleF.value, v) }, 'gender'), { none: true });
  _fieldRow(box, 'vertical', s.vertical, opt(_uniq([..._inUse('vertical'), ...L.verticals])),
    v => _patch(s, { vertical: v }, 'vertical'), { none: true, newItem: true, remove: rm('vertical', '') });
  _fieldRow(box, 'product', s.product, opt(_uniq([..._inUse('product'), ...L.products])),
    v => _patch(s, { product: v }, 'product'), { none: true, newItem: true, remove: rm('product', '') });
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
}

const _linesSay = (n) => n + (n === 1 ? ' line' : ' lines');

async function _show(it) {
  const my = ++_seq;
  const body = _pane();
  if (!body || !it) return;
  body.appendChild(_el('div', 'lib-sc-title', it.name));
  let s = null;
  await _flushing;
  if (my !== _seq) return;
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
  // (V38.7, the owner: "строки с названием lines и edited помещаем справа от названия сценария") The title, and beside it
  // how many lines and when it was last edited.
  const lines = s.lines || [];
  const top = _el('div', 'lib-sc-top');
  top.appendChild(_el('div', 'lib-sc-title', s.title || 'untitled'));
  const count = _el('span', 'lib-sc-meta', _linesSay(lines.length));
  top.append(count, _el('span', 'lib-sc-meta', 'edited ' + _fmtDate(s.updatedAt || s.createdAt)));
  body.appendChild(top);
  const facts = _el('div', 'lib-sc-grid lib-sc-fields');
  body.appendChild(facts);
  await _paintFields(facts, s);
  if (my !== _seq) return;

  // (V38.6, the owner's (щ2)) The buttons over the lines, under the fields; the lines under them, a card each.
  // (phase V60, the owner's (пп8а)) An archived one: "Restore" where "Make video" stands - no video from the archive.
  const foot = _el('div', 'lib-sc-bar');
  const archived = !!s.archived;
  const make = _el('button', 'u-btn is-main', archived ? 'Restore' : 'Make video');
  make.type = 'button';
  make.title = archived ? 'Archived - put it back into the list of scenarios (a video is made from the list)'
    : 'Make a talking-head project from this scenario and open it in Merge';
  const st = _el('span', 'lib-sc-status');
  const del = _el('button', 'u-btn is-danger', 'Delete');
  del.type = 'button';
  del.title = 'Delete this scenario';
  foot.append(make, st, _el('span', 'sp'), del);
  body.appendChild(foot);
  const box = _el('div', 'lib-sc-cards');
  body.appendChild(box);

  // The lines save themselves (phase V28.2): a moment after the typing stops, and when the lines are left.
  const a = { s, box, cards: [], was: '', st, count, timer: null, busy: null, empty: false };
  _paintCards(a, lines.map(l => String((l && l.text) || '').replace(/\s*\n\s*/g, ' ')));
  a.was = _valueOf(a);
  _auto = a;
  // Leaving the lines - for anything but another of them - is the save that makes them English (phase V29), never the
  // pause in the typing.
  box.addEventListener('focusout', (e) => { if (!box.contains(e.relatedTarget)) _flushA(a, true); });
  make.addEventListener('click', () => {
    if (!archived) { _makeVideo(a, make); return; }
    make.disabled = true;
    _setArchived(_any(s.id) || { id: s.id, name: s.title }, false).finally(() => { make.disabled = false; });
  });
  del.addEventListener('click', () => _delete(s, del));

  // What the last Save or refusal said, now that the column is painted again.
  if (_say && _say.id === String(s.id)) {
    st.textContent = _say.text;
    st.className = 'lib-sc-status' + (_say.kind ? ' ' + _say.kind : '');
  }
  _say = null;
}

// ── The lines, saved by themselves (phase V28.2) ─────────────────────────────
const AUTOSAVE_MS = 800;
let _auto = null;                    // the column on show: { s, box, cards, was, st, count, timer, busy, empty }
let _flushing = Promise.resolve();   // the save of a column painted over, which a new reading waits for

// ── The lines as cards (phase V38.6) ───────────────────────────────────────
// As the generator shows a script (its .mk-scene cards): the number, the first one "hook", the words, how long they
// take said. Edited as one text: Enter splits a line in two at the cursor (a paste of several lines makes as many
// cards), Backspace at a line's start joins it to the one above, Delete at its end joins the one below to it, the arrows
// at an edge go on to the next line.
const _valueOf = (a) => a.cards.map(c => c.ta.value.replace(/\s*\n\s*/g, ' ')).join('\n');

function _card(a, text) {
  const row = _el('div', 'mk-scene lib-sc-line');
  const n = _el('div', 'mk-scene-n');
  const ta = _el('textarea', 'mk-scene-t lib-sc-lt u-area is-dark');
  ta.rows = 1;
  ta.spellcheck = false;
  ta.value = text;
  const acts = _el('div', 'mk-scene-a');
  const secs = _el('div', 'mk-scene-secs');
  acts.appendChild(secs);
  row.append(n, ta, acts);
  const c = { row, n, ta, secs };
  ta.addEventListener('input', () => _cardInput(a, c));
  ta.addEventListener('keydown', (e) => _cardKey(a, c, e));
  return c;
}

function _paintCards(a, texts) {
  a.box.textContent = '';
  a.cards = (texts.length ? texts : ['']).map(t => _card(a, t));
  for (const c of a.cards) a.box.appendChild(c.row);
  _number(a);
}

function _number(a) {
  a.cards.forEach((c, i) => {
    c.row.classList.toggle('hook', i === 0);
    c.n.classList.toggle('is-hook', i === 0);
    c.n.textContent = i === 0 ? 'hook' : String(i + 1);
    c.secs.textContent = spokenSeconds(c.ta.value) + 's';
  });
}

const _queueSave = (a) => { clearTimeout(a.timer); a.timer = setTimeout(() => _flushA(a), AUTOSAVE_MS); };
const _caret = (ta, at) => { ta.focus(); ta.setSelectionRange(at, at); };

function _cardInput(a, c) {
  const v = c.ta.value;
  if (v.includes('\n')) {
    // A line break typed or pasted: the line splits there, the cursor stays where it was in the words.
    const before = v.slice(0, c.ta.selectionStart);
    const k = before.split('\n').length - 1;
    const off = before.length - (before.lastIndexOf('\n') + 1);
    const parts = v.split('\n');
    c.ta.value = parts[0];
    const more = parts.slice(1).map(t => _card(a, t));
    const i = a.cards.indexOf(c);
    a.cards.splice(i + 1, 0, ...more);
    let after = c.row;
    for (const m of more) { after.after(m.row); after = m.row; }
    _number(a);
    _caret([c, ...more][k].ta, off);
  } else c.secs.textContent = spokenSeconds(v) + 's';
  _queueSave(a);
}

function _cardKey(a, c, e) {
  const ta = c.ta;
  const i = a.cards.indexOf(c);
  const atStart = ta.selectionStart === 0 && ta.selectionEnd === 0;
  const atEnd = ta.selectionStart === ta.value.length && ta.selectionEnd === ta.value.length;
  const join = (top, low) => {
    const at = top.ta.value.length;
    const glue = top.ta.value && low.ta.value && !/\s$/.test(top.ta.value) && !/^\s/.test(low.ta.value) ? ' ' : '';
    top.ta.value = top.ta.value + glue + low.ta.value;
    low.row.remove();
    a.cards.splice(a.cards.indexOf(low), 1);
    _number(a);
    _caret(top.ta, at);
    _queueSave(a);
  };
  if (e.key === 'Backspace' && atStart && i > 0) { e.preventDefault(); join(a.cards[i - 1], c); }
  else if (e.key === 'Delete' && atEnd && i < a.cards.length - 1) { e.preventDefault(); join(c, a.cards[i + 1]); }
  else if (e.key === 'ArrowUp' && atStart && i > 0) { e.preventDefault(); const p = a.cards[i - 1].ta; _caret(p, p.value.length); }
  else if (e.key === 'ArrowDown' && atEnd && i < a.cards.length - 1) { e.preventDefault(); _caret(a.cards[i + 1].ta, 0); }
}

// The lines as a script: an empty card is a line being written, not a line of script - it is dropped rather than saved
// empty.
const _linesOf = (a) => a.cards.map(c => c.ta.value.replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean).map(text => ({ text }));

// (phase V29, the owner 2026-10-14: "набранное переводится") A letter of another script than Latin - the server's
// own test (lib/mv3-agent.js `english`). Lines with one are made English by the server when they are left.
const _foreign = (s) => /(?!\p{Script=Latin})\p{L}/u.test(String(s || ''));

// What is typed and not stored yet, stored now - one save at a time, each after the one before it. Resolves to
// false when the lines could not be kept (empty, refused, the scenario gone). `english`: the lines left or about to be
// made a video of - saved in English, even when the pause in the typing has stored them as typed already.
function _flushA(a, english) {
  if (!a) return Promise.resolve(true);
  clearTimeout(a.timer);
  a.timer = null;
  a.busy = (a.busy || Promise.resolve(true)).then(() => _save(a, false, english));
  return a.busy;
}

async function _save(a, keepalive, english) {
  const value = _valueOf(a);
  const say = (t, k) => { a.st.textContent = t; a.st.className = 'lib-sc-status' + (k ? ' ' + k : ''); };
  const toEnglish = !!english && !keepalive && _foreign(value);
  // Typed back to what is stored: nothing to save, and "every line is empty" is not true any more.
  if (value === a.was && !toEnglish) { if (a.empty) { a.empty = false; say(''); } return true; }
  const lines = _linesOf(a);
  a.empty = !lines.length;
  if (a.empty) { say('Every line is empty - not saved; the scenario keeps the lines it had.', 'err'); return false; }
  if (!keepalive) say(toEnglish ? 'translating into English…' : 'saving…');
  try {
    // Only what the column edits: the title it painted may have been renamed since, in Merge. And an
    // EDIT, so a scenario deleted meanwhile is not made again from these lines alone.
    const r = await fetch('/api/scen3/scenarios', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive: !!keepalive,
      body: JSON.stringify({ id: a.s.id, lines, edit: true, ...(toEnglish ? { english: true } : {}) }),
    });
    if (keepalive) return true;
    const d = await r.json().catch(() => null);
    if (r.status === 404) {
      a.was = value;                            // nothing left to save it into
      if (_hooks.status) _hooks.status('"' + (a.s.title || 'untitled') + '" was deleted elsewhere', 'err');
      _sel = '';
      if (_hooks.reload) await _hooks.reload();
      if (_hooks.counts) _hooks.counts();
      return false;
    }
    if (!d || !d.success) throw new Error((d && d.error) || 'refused');
    a.was = value;
    // Made English: the cards show what is stored - unless they were typed into while the translation came.
    if (toEnglish && d.scenario && Array.isArray(d.scenario.lines)) {
      const now = d.scenario.lines.map(l => String((l && l.text) || '').replace(/\s*\n\s*/g, ' '));
      if (_valueOf(a) === value) { _paintCards(a, now); a.was = _valueOf(a); }
    }
    // The row, the head of the lines and their count say what is stored now - in place: painting the column
    // again would take the cards from under the typing.
    const n = lines.length;
    const it = _any(a.s.id);
    if (it) {
      it.meta = { ...(it.meta || {}), lines: n };
      const row = document.querySelector('#lib-grid .lib-srow[data-id="' + CSS.escape(String(a.s.id)) + '"] .lib-srow-s');
      if (row) row.textContent = _tail(it.meta);
    }
    if (a.count) a.count.textContent = _linesSay(n);
    say((toEnglish ? 'saved in English · ' : 'saved · ') + n + (n === 1 ? ' line' : ' lines'), 'ok');
    return true;
  } catch (e) {
    say('Not saved: ' + e.message, 'err');
    return false;
  }
}

// Closing the window is leaving the lines: a save still waiting out its pause goes now.
window.addEventListener('pagehide', () => {
  if (_auto && _valueOf(_auto) !== _auto.was && _linesOf(_auto).length) _save(_auto, true);
});

// MAKE VIDEO: the lines stored first - a project is made from what is STORED - then the talking head (its own
// copy of the lines and its empty timeline), and Merge opened on its setup.
async function _makeVideo(a, btn) {
  const say = (t, k) => { a.st.textContent = t; a.st.className = 'lib-sc-status' + (k ? ' ' + k : ''); };
  if (!_linesOf(a).length) { say('Every line is empty - nothing to make a video of.', 'err'); return; }
  btn.disabled = true;
  if (!(await _flushA(a, true))) { btn.disabled = false; return; }
  say('making the project…');
  try {
    const key = await talkingHead(a.s.id);
    location.href = '/merge?p=' + encodeURIComponent(key) + '&step=setup';
  } catch (e) {
    say('Not made: ' + e.message, 'err');
    btn.disabled = false;
  }
}

async function _delete(s, btn) {
  if (!confirm('Delete "' + (s.title || 'untitled') + '"?\n\nThe scenario goes for good. Projects already made from it keep their own copy of the text.')) return;
  // Its lines are not saved on the way out: it is going.
  if (_auto && String(_auto.s.id) === String(s.id)) { clearTimeout(_auto.timer); _auto.was = _valueOf(_auto); }
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

/** The lines typed into the scenario on show, stored now - the page is about to put something in its place. */
export function flush() { return _flushA(_auto); }

/** The scenario to select at the next render - one the generator has just saved; (V38.6) 'd:<id>' a draft. */
export function select(id) { _sel = String(id || ''); _keep = _sel.startsWith('d:') ? '' : _sel; }

// Leaving the shelf: the lines typed are stored, an answer on its way is dropped, and coming back opens on
// the first scenario.
export function leave() {
  if (_auto) { _flushing = _flushA(_auto); _auto = null; }
  if (_hooks.hideDraft) _hooks.hideDraft();       // (V38.6) a draft's form: what is typed is saved
  _seq++;
  _sel = '';
  _say = null;
  _closeFieldMenu();
}
