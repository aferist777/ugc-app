// Scenarios v3 — the scenario library that fills the Scenario column.
//
//   left  1/4  list of saved scenarios (newest edit first)
//   centre 1/2 the selected scenario, one editable row per line
//   right 1/4  metadata: line count, created, updated, type, vertical, product, roles
//
// There is no Save button: line and title edits autosave back into the scenario
// record (upsert). Generation lives nowhere on this page — scenarios come from
// the store.

import { listScenarios, getScenario, saveScenario, duplicateScenario, deleteScenario } from './api.js';
import { setMode } from './shell.js';
import { initCreate, isCreating, exitCreate, discardDraft } from './create.js';
import { createFromScenario } from './projects.js';

const SEL_KEY   = 'sv3_selected_v1';   // mirrored server-side by storage-sync.js
const SAVE_WAIT = 600;

const $ = id => document.getElementById(id);

let _items    = [];     // list summaries
let _current  = null;   // full record of the selected scenario
let _saveT    = null;
let _saving   = false;
let _reSave   = false;
let _dirty    = false;  // only a real edit may bump updatedAt and reorder the list

// ── small helpers ───────────────────────────────────────────────────────────
function _fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return String(iso);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function _status(el, text, kind) {
  const n = $(el);
  if (!n) return;
  n.textContent = text || '';
  n.className = 'sv3-status' + (kind ? ' ' + kind : '');
}
const _libStatus  = (t, k) => _status('sv3-lib-status', t, k);
const _saveStatus = (t, k) => _status('sv3-save-status', t, k);

// ── list pane ───────────────────────────────────────────────────────────────
function _renderList() {
  const box = $('sv3-list');
  const cnt = $('sv3-count');
  if (!box) return;
  if (cnt) cnt.textContent = _items.length ? String(_items.length) : '';
  box.textContent = '';

  if (!_items.length) {
    const e = document.createElement('div');
    e.className = 'sv3-empty';
    e.textContent = 'No scenarios in the library yet.';
    box.appendChild(e);
    return;
  }

  _items.forEach(it => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'sv3-item' + (_current && String(_current.id) === String(it.id) ? ' on' : '');
    row.dataset.id = it.id;

    const t = document.createElement('div');
    t.className = 'sv3-item-t';
    t.textContent = it.title || 'untitled';

    const m = document.createElement('div');
    m.className = 'sv3-item-m';
    const a = document.createElement('span');
    a.textContent = `${it.lineCount} ${it.lineCount === 1 ? 'line' : 'lines'}`;
    const b = document.createElement('span');
    b.textContent = _fmtDate(it.updatedAt);
    m.append(a, b);

    row.append(t, m);
    row.addEventListener('click', () => select(it.id));
    box.appendChild(row);
  });
}

// ── viewer pane ─────────────────────────────────────────────────────────────
// Called only on selection change — never from a save response, so the caret is
// never yanked out from under someone who is typing.
function _renderLines() {
  const box = $('sv3-lines');
  if (!box) return;
  box.textContent = '';

  if (!_current) {
    const e = document.createElement('div');
    e.className = 'sv3-empty';
    e.textContent = 'Pick a scenario on the left to view and edit it.';
    box.appendChild(e);
    return;
  }
  if (!_current.lines.length) {
    const e = document.createElement('div');
    e.className = 'sv3-empty';
    e.textContent = 'This scenario has no lines.';
    box.appendChild(e);
    return;
  }

  _current.lines.forEach((ln, i) => {
    const row = document.createElement('div');
    row.className = 'sv3-line';

    const n = document.createElement('div');
    n.className = 'sv3-line-n';
    n.textContent = String(i + 1);

    const t = document.createElement('div');
    t.className = 'sv3-line-t';
    t.contentEditable = 'true';
    t.spellcheck = false;
    t.dataset.idx = String(i);
    t.textContent = ln.text || '';
    t.addEventListener('input', _onLineEdit);

    row.append(n, t);
    box.appendChild(row);
  });
}

function _onLineEdit(e) {
  if (!_current) return;
  const i = +e.target.dataset.idx;
  if (!Number.isInteger(i) || !_current.lines[i]) return;
  _current.lines[i].text = e.target.textContent || '';
  _queueSave();
}

// ── meta pane ───────────────────────────────────────────────────────────────
// What a scenario type is CALLED, as against what it is stored as. Since Ph13.5 the two
// agree (`talking_head`); the old `ugc_ad` id is kept here so a record written before the
// rename still reads as a name rather than as an id.
const TYPE_LABELS = { talking_head: 'talking head', ugc_ad: 'talking head' };
const _typeLabel = (t) => TYPE_LABELS[String(t || '')] || String(t || '');

function _metaRow(key, valueNode) {
  const row = document.createElement('div');
  row.className = 'sv3-meta-row';
  const k = document.createElement('div');
  k.className = 'sv3-meta-k';
  k.textContent = key;
  const v = document.createElement('div');
  v.className = 'sv3-meta-v';
  if (valueNode instanceof Node) v.appendChild(valueNode);
  else v.textContent = (valueNode === '' || valueNode == null) ? '—' : String(valueNode);
  row.append(k, v);
  return row;
}

function _renderMeta() {
  const box = $('sv3-meta');
  if (!box) return;
  box.textContent = '';

  if (!_current) {
    const e = document.createElement('div');
    e.className = 'sv3-empty';
    e.textContent = 'No scenario selected.';
    box.appendChild(e);
    return;
  }

  const roles = document.createElement('div');
  if (_current.roles && _current.roles.length) {
    _current.roles.forEach(r => {
      const s = document.createElement('span');
      s.className = 'sv3-role';
      s.textContent = [r.name, r.gender].filter(Boolean).join(' · ') || r.id || 'role';
      roles.appendChild(s);
    });
  } else {
    roles.textContent = '—';
  }

  box.append(
    _metaRow('lines',    _current.lines.length),
    _metaRow('created',  _fmtDate(_current.createdAt)),
    _metaRow('updated',  _fmtDate(_current.updatedAt)),
    _metaRow('type',     _typeLabel(_current.type)),
    _metaRow('vertical', _current.vertical),
    _metaRow('product',  _current.product),
    _metaRow('roles',    roles),
  );
}

// ── header controls reflect whether anything is selected ────────────────────
// A draft owns the title field and the footer buttons, so leave them alone.
function _syncControls() {
  if (isCreating()) return;
  const has  = !!_current;
  const ttl  = $('sv3-title');
  if (ttl) {
    ttl.disabled = !has;
    if (document.activeElement !== ttl) ttl.value = has ? (_current.title || '') : '';
  }
  ['sv3-dup', 'sv3-del', 'sv3-create-project'].forEach(id => {
    const b = $(id);
    if (b) b.disabled = !has;
  });
}

// ── autosave (single-flight, so a save mid-flight cannot interleave) ────────
function _queueSave() {
  clearTimeout(_saveT);
  _dirty = true;
  _saveStatus('editing…');
  _saveT = setTimeout(_flushSave, SAVE_WAIT);
}

async function _flushSave() {
  if (!_current || !_dirty) return;
  if (_saving) { _reSave = true; return; }
  _saving = true;
  _dirty  = false;
  const id = _current.id;
  try {
    const saved = await saveScenario({
      id,
      title: _current.title,
      lines: _current.lines.map(l => ({ text: l.text || '' })),
    });
    // Only refresh what has no caret in it: the record's stamps, the meta pane
    // and the list row. The editable lines are deliberately left alone.
    if (_current && String(_current.id) === String(id)) {
      _current.updatedAt = saved.updatedAt;
      _current.createdAt = saved.createdAt;
      _renderMeta();
    }
    const row = _items.find(x => String(x.id) === String(id));
    if (row) {
      row.title     = saved.title;
      row.lineCount = saved.lineCount;
      row.updatedAt = saved.updatedAt;
      _items.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
      _renderList();
    }
    _saveStatus('saved', 'ok');
  } catch (e) {
    _dirty = true;   // keep it pending so the next flush retries instead of dropping the edit
    _saveStatus('save failed: ' + e.message, 'err');
  } finally {
    _saving = false;
    if (_reSave) { _reSave = false; _flushSave(); }
  }
}

// ── selection ───────────────────────────────────────────────────────────────
export async function select(id) {
  // Opening a saved scenario abandons an unsaved draft — ask before doing it.
  if (isCreating()) {
    if (!confirm('Discard the scenario you are adding?')) return;
    discardDraft();
    exitCreate();
  }
  clearTimeout(_saveT);
  if (_current) await _flushSave().catch(() => {});   // don't lose pending edits when switching
  try {
    _current = await getScenario(id);
    try { localStorage.setItem(SEL_KEY, String(id)); } catch (e) {}
    _saveStatus('');
  } catch (e) {
    _current = null;
    _libStatus('Could not open scenario: ' + e.message, 'err');
  }
  _renderList(); _renderLines(); _renderMeta(); _syncControls();
}

// ── load / reload the list ──────────────────────────────────────────────────
export async function reload(keepId) {
  try {
    _items = await listScenarios();
    _libStatus('');
  } catch (e) {
    _items = [];
    _libStatus('Could not load the library: ' + e.message, 'err');
  }
  _renderList();

  let want = keepId != null ? String(keepId) : null;
  if (!want) { try { want = localStorage.getItem(SEL_KEY); } catch (e) {} }
  const exists = want && _items.some(x => String(x.id) === String(want));
  if (exists) await select(want);
  else { _current = null; _renderLines(); _renderMeta(); _syncControls(); }
}

// ── wiring ──────────────────────────────────────────────────────────────────
export function initLibrary() {
  const ttl = $('sv3-title');
  if (ttl) {
    ttl.addEventListener('input', () => {
      if (isCreating()) return;   // while drafting the field belongs to create.js
      if (!_current) return;
      _current.title = ttl.value;
      _queueSave();
    });
  }

  const dup = $('sv3-dup');
  if (dup) {
    dup.addEventListener('click', async () => {
      if (!_current) return;
      dup.disabled = true;
      try {
        clearTimeout(_saveT); await _flushSave();
        const copy = await duplicateScenario(_current.id);
        await reload(copy.id);
        _libStatus('Duplicated.', 'ok');
      } catch (e) { _libStatus('Duplicate failed: ' + e.message, 'err'); }
      finally { _syncControls(); }
    });
  }

  // Deletes exactly the selected scenario, and asks first.
  const del = $('sv3-del');
  if (del) {
    del.addEventListener('click', async () => {
      if (!_current) return;
      const name = _current.title || 'untitled';
      if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
      del.disabled = true;
      clearTimeout(_saveT);
      try {
        await deleteScenario(_current.id);
        try { localStorage.removeItem(SEL_KEY); } catch (e) {}
        _current = null;
        await reload();
        _libStatus('Deleted.', 'ok');
      } catch (e) { _libStatus('Delete failed: ' + e.message, 'err'); }
      finally { _syncControls(); }
    });
  }

  // Create project — snapshots the selected scenario into a new project, which
  // lands in the tab-bar dropdown and opens the workspace columns.
  const cp = $('sv3-create-project');
  if (cp) {
    cp.addEventListener('click', async () => {
      if (!_current) return;
      cp.disabled = true;
      clearTimeout(_saveT); await _flushSave();
      try {
        await createFromScenario(_current.id);   // Fragments renders from the opened project
        _libStatus('');
      } catch (e) {
        // the usual cause is a scenario with no narrator gender
        _libStatus('Could not create the project: ' + e.message, 'err');
        setMode('library');
      } finally { _syncControls(); }
    });
  }

  document.body.dataset.view = 'view';

  // Fill the list first, then hand over to the create flow: if it finds a draft
  // left from a previous visit it re-enters create mode on top of the list.
  return reload().then(() => {
    initCreate({
      // a brand-new scenario lands at the top of the list and opens
      onSaved: (id) => reload(id),
      // Cancel / discard returns to whatever was selected before
      onExit:  ()  => { _renderList(); _renderLines(); _renderMeta(); _syncControls(); },
    });
  });
}
