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
// Lines are `{text}` records - the roles live on the scenario, not on its lines - so splitting the
// textarea on newlines maps onto the store exactly. A line that carries a newline of its own (the
// generator can write one) is shown on one textarea line, or a Save would quietly make it two.

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
    m.type,
    m.vertical,
    m.product,
    m.roles,
  ].filter(Boolean).join(' · ');
}

// Where a generated scenario came from, as the generator recorded it (routes/scriptgen.js, save).
// Not the hook: it is the first line of the script, which the lines below show anyway (phase F5).
const ORIGIN_ROWS = [
  ['sourceTitle', 'written from'], ['topicTitle', 'topic'], ['narratorName', 'narrator'],
  ['narratorReading', 'which reading'], ['language', 'language'], ['tone', 'tone'], ['model', 'model'],
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
  for (const dr of (_hooks.drafts || [])) grid.appendChild(_draftRow(dr));

  if (!_items.length) {
    _sel = '';
    grid.appendChild(_el('div', 'lib-empty', 'No scenarios yet. “New scenario” above writes one.'));
    _empty();
    return;
  }
  // The selection survives a reload while that scenario is still here; otherwise the first.
  if (!_items.some(i => String(i.id) === _sel)) _sel = String(_items[0].id);

  for (const it of _items) {
    const row = _el('button', 'lib-srow' + (String(it.id) === _sel ? ' cur' : ''));
    row.type = 'button';
    row.dataset.id = String(it.id);
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

function _empty() {
  _seq++;
  const body = _pane();
  if (body) body.appendChild(_el('div', 'lib-info-note', 'Nothing on this shelf yet.'));
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
  const role = (s.roles || [])[0];
  _row(facts, 'type', s.type);
  _row(facts, 'vertical', s.vertical);
  _row(facts, 'product', s.product);
  _row(facts, 'role', role ? [role.name, role.gender].filter(Boolean).join(' · ') : '');
  _row(facts, 'lines', String(lines.length));
  _row(facts, 'edited', _fmtDate(s.updatedAt || s.createdAt));
  body.appendChild(facts);

  const fold = _el('details', 'lib-sc-origin');
  try { fold.open = localStorage.getItem(LS_ORIGIN_OPEN) === '1'; } catch (e) { /* folded */ }
  fold.appendChild(_el('summary', 'lib-info-sec', 'Where it came from'));
  fold.addEventListener('toggle', () => { try { localStorage.setItem(LS_ORIGIN_OPEN, fold.open ? '1' : '0'); } catch (e) { /* kept for this view */ } });
  const o = s.origin;
  if (!o) fold.appendChild(_el('div', 'lib-info-note', 'Written by hand.'));
  else {
    const from = _el('div', 'lib-vi');
    for (const [key, label] of ORIGIN_ROWS) _row(from, label, String(o[key] || '').trim());
    if (!o.sourceTitle) _row(from, 'written from', o.sourceId ? 'a source since deleted' : 'no source');
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
export function select(id) { _sel = String(id || ''); }

// Leaving the shelf: an answer on its way is dropped, and coming back opens on the first scenario.
export function leave() {
  _seq++;
  _sel = '';
  _say = null;
}
