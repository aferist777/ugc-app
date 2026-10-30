/* ════════════════════════════════════════════════════════════════════════════
   MERGE — THE SCRIPT OF THE VOICEOVER DRAFT, chosen in its script column (phase V62, the owner after block 0, 2026-10-30:
   "шаг со списком сценариев удаляем из voiceover. список сценариев и кнопка own text в правом столбце, там где появятся строки
   сценария"; (во30) "можно отменить выбраный сценарий и вернуться к списку сценариев и добавить свой текст").

   The voiceover draft opens on its setup (js/merge-v3/scen-pick.js openVoiceover); while it has no lines, the column where its
   lines will stand (js/merge-v3/wk-fragments.js _list) is this: "+ your text" (js/merge-v3/vo-text.js - the whole text one line)
   and "+ scenario" (the scenario window, js/scen-window.js - its lines kept in the language they are typed in), a search and
   the category, and the scenarios - a row opens its text, "use" puts its lines into the draft (POST /scen3/projects/:id/script,
   a snapshot, never translated). With its lines in, the column is the script again, and "other script" over it takes them off
   - back to this list - for as long as it is the draft: its first read makes it a project, and its script stays its own.
   ════════════════════════════════════════════════════════════════════════════ */

import * as API from './scen-api.js';
import { openScenario } from '../scen-window.js';
import { openOwnText } from './vo-text.js';
import { el } from './wk-maker.js';
import { showError } from '../notice.js';

let _rows = null;             // the scenarios, read once per draft shown - null while not read
let _counts = null;
let _lib = '';                // the category: '' | 'library1' | 'src:<id>' | 'nosrc'
let _q = '';
let _state = '';              // '' | 'loading' | an error
let _busy = false;            // a script being put in

/**
 * The chooser, into `host` (the script column), for the draft `project`.
 * @param adopt(project) the draft as the server has it now - the column repaints with its lines
 */
export function paintChooser(host, project, adopt) {
  const root = el('div', 'mv3-vos');
  host.appendChild(root);
  root.appendChild(el('div', 'mv3-wk-fhint', 'The script of this voiceover: a scenario, or your own text.'));

  const top = el('div', 'mv3-vos-top');
  const own = el('button', 'mv3-sc-new', '+ your text');
  own.type = 'button';
  own.title = 'Your own text, pasted or typed in any language - the whole of it one line';
  own.disabled = _busy;
  own.addEventListener('click', () => openOwnText(project.id, adopt));
  const add = el('button', 'mv3-sc-new', '+ scenario');
  add.type = 'button';
  add.title = 'Write a new scenario - it is kept in the library, and "use" puts it here';
  add.disabled = _busy;
  add.addEventListener('click', () => _open(null, project, adopt));
  top.append(own, add);
  root.appendChild(top);

  const bar = el('div', 'mv3-vos-top');
  const cat = el('select', 'mv3-wk-vsel is-small mv3-vos-cat');
  cat.title = 'Which scenarios';
  for (const c of _choices()) {
    const o = el('option', '', c.label + ' · ' + c.n);
    o.value = c.id;
    if (c.id === _lib) o.selected = true;
    cat.appendChild(o);
  }
  cat.addEventListener('change', () => { _lib = cat.value; _rows = null; _load(adopt.repaint); });
  const search = el('input', 'mv3-sc-search');
  search.type = 'search';
  search.placeholder = 'search by title, product, role';
  search.value = _q;
  const list = el('div', 'mv3-sc-list mv3-vos-list');
  search.addEventListener('input', () => { _q = search.value; _paintRows(list, project, adopt); });
  bar.append(cat, search);
  root.appendChild(bar);
  root.appendChild(list);

  if (_rows === null && _state !== 'loading') _load(adopt.repaint);
  _paintRows(list, project, adopt);
}

/** "other script": the draft's lines taken off - back to the list. Only while it is the draft (the server says so too). */
export async function clearScript(project, adopt) {
  if (_busy) return;
  _busy = true;
  try { adopt(await API.voiceoverScript(project.id, { clear: true })); }
  catch (e) { showError('The script was not taken off: ' + e.message); }
  _busy = false;
}

async function _load(repaint) {
  _state = 'loading';
  try {
    const d = await API.list(_lib);
    _rows = d.rows.filter(s => !s.archived);
    _counts = d.counts || {};
    _state = '';
  } catch (e) {
    _rows = [];
    _state = 'Could not read the scenarios: ' + e.message;
  }
  if (repaint) repaint();
}

function _choices() {
  const c = _counts || {};
  const out = [{ id: '', label: 'all', n: c.all || 0 }, { id: 'library1', label: 'saved', n: c.library1 || 0 }];
  for (const s of (Array.isArray(c.sources) ? c.sources : [])) out.push({ id: 'src:' + s.id, label: String(s.title || 'untitled source'), n: s.n || 0 });
  if (c.noSource) out.push({ id: 'nosrc', label: 'no source', n: c.noSource });
  if (_lib && !out.some(x => x.id === _lib)) _lib = '';
  return out;
}

function _matches(s) {
  const q = _q.trim().toLowerCase();
  if (!q) return true;
  const role = ((s.roles || [])[0] || {}).name || '';
  return [s.title, s.vertical, s.product, role].join(' ').toLowerCase().includes(q);
}

function _paintRows(list, project, adopt) {
  list.textContent = '';
  const note = (t, bad) => list.appendChild(el('div', 'mv3-ins-note' + (bad ? ' is-err' : ''), t));
  if (_state === 'loading' || _rows === null) { note('reading the scenarios…'); return; }
  if (_state) { note(_state, true); return; }
  const rows = _rows.filter(_matches);
  if (!rows.length) { note(_rows.length ? 'Nothing matches that.' : 'No scenarios here. Write one with "+ scenario", or use your own text.'); return; }
  for (const s of rows) {
    const row = el('div', 'mv3-sc-row');
    row.title = 'Open the text';
    const acts = el('div', 'mv3-sc-acts');
    const go = el('button', 'mv3-sc-btn is-use', 'use');
    go.type = 'button';
    go.title = 'Put its lines into this voiceover';
    go.disabled = _busy;
    go.addEventListener('click', (e) => { e.stopPropagation(); _use(s.id, project, adopt, go); });
    acts.appendChild(go);
    row.appendChild(acts);
    const txt = el('div', 'mv3-sc-txt');
    txt.appendChild(el('b', null, s.title || 'untitled'));
    const n = +s.lineCount || 0;
    txt.appendChild(el('span', 'mv3-sc-meta', [n + (n === 1 ? ' line' : ' lines'), s.vertical, s.product,
      String(s.updatedAt || s.createdAt || '').slice(0, 10)].filter(Boolean).join(' · ')));
    row.appendChild(txt);
    row.addEventListener('click', () => _open(s, project, adopt));
    list.appendChild(row);
  }
}

async function _use(scenarioId, project, adopt, btn) {
  if (_busy) return;
  _busy = true;
  if (btn) btn.textContent = '…';
  try { adopt(await API.voiceoverScript(project.id, { scenarioId })); }
  catch (e) { showError('Could not use it: ' + e.message); if (btn) btn.textContent = 'use'; }
  _busy = false;
}

// The scenario window - a row's text, or a new one: kept in the language it is typed in (a voiceover is read in it); its `use`
// saves it and puts its lines into the draft.
function _open(summary, project, adopt) {
  openScenario(summary, {
    voiceover: true,
    saved: () => { _rows = null; _load(adopt.repaint); },
    use: async (rec) => { adopt(await API.voiceoverScript(project.id, { scenarioId: rec.id })); },
  });
}
