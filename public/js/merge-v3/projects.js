/* ═══════════════════════════════════════════════════════════════════════════
   MERGE v3 — the project bar.

   One timeline per project. A talking head's or a voiceover's key is `sv3_<project id>` - its
   lines are laid on its main lanes by the server (lib/frag-mirror.js); a project made here, the
   draft and a highlights project (its own timeline, and one per fragment) have keys of their own.

   The draft first, then the voiceover draft, then newest first. A project just made therefore
   lands near the top of the list, which is where you look for the thing you just made.

   The list is read again at every press on the picker rather than kept: a project can appear
   without this page doing anything - Home's quick start or the Library's "use" makes one - and
   a cached list would show yesterday's projects until a reload.
   ═══════════════════════════════════════════════════════════════════════════ */

import * as Store from './store.js';
import * as Layers from '../layers.js';
import { roomForWork } from './layout.js';
import { askName } from '../name-box.js';
import { askChoice } from '../ask.js';
import { openScenarios, openVoiceover } from './scen-pick.js';
import { createHighlights, homeOf } from './highlights.js';
// A talking head is told by its key, the workshop's one rule (sv3_<project>[_n]).
import { projectIdOf } from './workshop.js';
import { showError } from '../notice.js';
import { allow } from '../key-gate.js';
// A kind with no projects - the shared "nothing here", a row of the list.
import { emptyEl } from '../ui-state.js';
import { REALLY, MS } from '../really.js';
import { icon } from '../icons.js';
import * as T from '../i18n/t.js';

function _sel() { return document.getElementById('mv3-project'); }
// Said once after the picker is painted again (a delete that moved files), where "nothing open yet" would go.
let _after = '';
// The projects' names as the list last said them - a highlights project's, while one of its fragments is open.
const _titles = new Map();
// The project a press of "edit" or "delete" is about: the open timeline's own - or, for a fragment, its project's.
const _projKey = () => homeOf(Store.key()) || Store.key();
function _note(text) {
  const el = document.getElementById('mv3-project-note');
  if (el) el.textContent = text || '';
}
// An error is not said on this line - "opening…" and "cleared" are: it is a popup
// in the corner (js/notice.js), and the line's "…" goes.
function _fail(text) {
  _note('');
  showError(text);
}

const _fmtDate = (s) => {
  if (!s) return '';
  const d = new Date(s);
  return isNaN(d) ? '' : d.toLocaleDateString(T.lang() === 'ru' ? 'ru-RU' : 'en-GB', { day: '2-digit', month: 'short' });
};

async function _paint() {
  const sel = _sel();
  if (!sel) return;
  let d = null;
  try { d = await Store.listFull(); } catch (e) { _fail(e.message); return; }
  const { list } = d;
  _titles.clear();
  for (const p of list) _titles.set(p.key, p.title);
  // A fragment of a highlights project is not in the list: its project's line stands for it.
  const open = list.some(p => p.key === Store.key()) ? Store.key() : (homeOf(Store.key()) || Store.key());
  const openRec = open ? list.find(p => p.key === open) : null;

  sel.textContent = '';
  const shown = list;
  for (const p of shown) {
    const o = document.createElement('option');
    o.value = p.key;
    // Clip count in the label because two projects from the same day are otherwise told
    // apart only by their title, and imported titles all start with the date. The draft says what it is.
    // A talking head says so before its name, as highlights does - in the list and in the closed field.
    // The kind's words are the interface's, the title is the project's own and goes in as it is.
    o.textContent = p.draft ? T.t('draft · not saved') + (p.clips ? ' · ' + p.clips : '')
      : p.highlights ? T.t('highlights · {name}', { name: p.title }) + (p.createdAt ? ' · ' + _fmtDate(p.createdAt) : '')
      : p.vodraft ? T.t('draft · voiceover') + (p.clips ? ' · ' + p.clips : '')
      : projectIdOf(p.key) ? (p.voiceover ? T.t('voiceover · {name}', { name: p.title }) : T.t('talking head · {name}', { name: p.title }))
        + (p.clips ? ' · ' + p.clips : '') + (p.createdAt ? ' · ' + _fmtDate(p.createdAt) : '')
      : p.title + (p.clips ? ' · ' + p.clips : '') + (p.createdAt ? ' · ' + _fmtDate(p.createdAt) : '');
    // Its kind, for the list's filter (_openList).
    o.dataset.kind = p.draft ? 'draft' : p.highlights ? 'highlights' : p.vodraft ? 'voiceover'
      : projectIdOf(p.key) ? (p.voiceover ? 'voiceover' : 'talking') : 'blank';
    sel.appendChild(o);
  }
  // With nothing open the picker must SAY so. Left alone it would show the first project in
  // the list, which reads as "this one is open" when it is not.
  if (openRec) {
    sel.value = open;
    // A delete opens the draft - and says what became of what was there.
    _note(_after);
    _after = '';
  } else {
    const o = document.createElement('option');
    o.value = '';
    o.textContent = T.t('Choose a project');
    sel.insertBefore(o, sel.firstChild);
    sel.value = '';
    _note(_after || (shown.length ? T.t('nothing open yet') : T.t('no projects yet')));
    _after = '';
  }
}

/** The list read again - a name the server gave (a talking head's character in its title, js/merge-v3/wk-setup.js). */
export function repaintPicker() { return _paint(); }

// A project opened that the picker already lists - picked from it, a highlights fragment under its project's line - is
// SHOWN there; the list is read again only for one it does not know (one just made, renamed by the server): reading it
// takes ~0.24 s, the server answering nothing else meanwhile. A press on the picker reads it again in any case
// (_openList), so nothing goes stale.
function _show(k) {
  const sel = _sel();
  if (!sel || !k) return false;
  const want = [...sel.options].some(o => o.value === k) ? k : homeOf(k);
  if (!want || ![...sel.options].some(o => o.value === want)) return false;
  const ph = [...sel.options].find(o => !o.value);
  if (ph) ph.remove();           // "Choose a project" goes once one is open
  sel.value = want;
  _note(_after);
  _after = '';
  return true;
}

// ── THE LIST, WITH ITS FILTER ───────────────────────────────────────────────
// A press on the picker opens THIS list instead of the select's own: the kinds in a row over the projects - "all" the first
// time, the one chosen remembered (a per-window convenience, localStorage) -, then the projects of that kind. Merge's draft
// heads every kind; the voiceover draft is a voiceover; a project of Merge's own is in "all" only; the open project, when it is
// not of the kind, stays at the top. The select stays what holds the choice - its options (painted by _paint, each with its
// `kind`), its value, its `change` -, so everything that reads the picker reads the select.
const KINDS = [['all', T.t('All')], ['talking', T.t('Talking head')], ['voiceover', T.t('Voiceover')], ['highlights', T.t('Highlights')]];
const FILTER_KEY = 'mv3_proj_filter_v1';
function _filter() {
  let v = 'all';
  try { v = localStorage.getItem(FILTER_KEY) || 'all'; } catch (e) { /* a private window */ }
  return KINDS.some(k => k[0] === v) ? v : 'all';
}
function _setFilter(v) { try { localStorage.setItem(FILTER_KEY, v); } catch (e) { /* kept for this paint only */ } }
let _plist = null;                         // { el, away, layer }
function _closeList() {
  if (!_plist) return;
  _plist.el.remove();
  document.removeEventListener('mousedown', _plist.away, true);
  window.removeEventListener('resize', _closeList);
  Layers.close(_plist.layer);
  _plist = null;
}
async function _openList() {
  const sel = _sel();
  if (!sel || sel.disabled) return;
  if (_plist) { _closeList(); return; }       // the same press closes it again
  await _paint();
  if (_plist) return;
  const el = document.createElement('div');
  el.className = 'mv3-plist u-menu is-float';
  const head = document.createElement('div');
  head.className = 'mv3-plist-kinds';
  const rows = document.createElement('div');
  rows.className = 'mv3-plist-rows';
  el.append(head, rows);
  const fill = () => {
    const f = _filter();
    head.textContent = '';
    for (const [k, label] of KINDS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'mv3-plist-kind u-chip' + (k === f ? ' is-on' : '');
      b.dataset.kind = k;
      b.textContent = label;
      b.addEventListener('click', (e) => { e.stopPropagation(); _setFilter(k); fill(); });
      head.appendChild(b);
    }
    rows.textContent = '';
    const opts = [...sel.options].filter(o => o.value);
    const open = opts.find(o => o.value === sel.value) || null;
    const drafts = opts.filter(o => o.dataset.kind === 'draft');
    let shown = [...drafts, ...opts.filter(o => o.dataset.kind !== 'draft' && (f === 'all' || o.dataset.kind === f))];
    if (open && !shown.includes(open)) shown = [open, ...shown];
    for (const o of shown) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'mv3-plist-row u-mi' + (o === open ? ' is-on' : '');
      b.appendChild(Object.assign(document.createElement('span'), { textContent: o.textContent }));
      b.title = o.textContent;
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        _closeList();
        if (sel.value === o.value) return;
        sel.value = o.value;
        sel.dispatchEvent(new Event('change'));
      });
      rows.appendChild(b);
    }
    if (shown.length === drafts.length) {
      const kind = KINDS.find(k => k[0] === f);
      rows.appendChild(emptyEl(kind ? T.t('No {kind} projects yet.', { kind: kind[1] }) : T.t('No such projects yet.'), { line: true, cls: 'mv3-plist-none' }));
    }
    const on = rows.querySelector('.is-on');
    if (on) on.scrollIntoView({ block: 'nearest' });
  };
  document.body.appendChild(el);
  const r = sel.getBoundingClientRect();
  el.style.left = Math.round(Math.max(6, Math.min(window.innerWidth - Math.max(r.width, 345) - 6, r.left))) + 'px';
  el.style.top = Math.round(r.bottom + 4) + 'px';
  el.style.width = Math.round(Math.max(r.width, 345)) + 'px';
  el.style.maxHeight = Math.round(Math.max(160, window.innerHeight - r.bottom - 16)) + 'px';
  fill();
  const away = (e) => { if (!el.contains(e.target) && e.target !== sel) _closeList(); };
  const layer = Layers.open(el, { modal: false, name: 'projects', onEsc: _closeList });
  _plist = { el, away, layer };
  document.addEventListener('mousedown', away, true);
  window.addEventListener('resize', _closeList);
}

export function initProjects() {
  const sel = _sel();
  if (!sel) return;
  sel.addEventListener('change', async () => {
    const want = sel.value;
    if (!want) return;              // the "choose a project" placeholder
    // Away from the draft: nothing is asked - it stays as it is, first in this list.
    _note(T.t('opening…'));
    try {
      await Store.open(want);
      _note('');
    } catch (e) { _fail(e.message); }
  });

  // Refreshed when the list is about to be READ, not on every store change: a clip drag
  // changes the store several times a second and none of those change which projects
  // exist. Opening the dropdown is also the moment a project made elsewhere (Home, the Library)
  // has to appear without reloading the page.
  // The press opens the list with its filter (_openList), not the select's own - which is
  // read again there first.
  sel.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    _openList();
  });
  sel.addEventListener('keydown', (e) => {
    if (e.key === ' ' || e.key === 'Enter' || e.key === 'F4' || (e.altKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp'))) {
      e.preventDefault();
      _openList();
    }
  });
  sel.addEventListener('focus', () => { if (!_plist) _paint(); });

  _wireNew();
  _wireRename();
  _wireDelete();

  // And once when the store first knows which project is open. The sentinel is a Symbol, not
  // null: "no project open" IS null, so a null seed would make the first paint look like a
  // repeat and the picker would never be filled.
  let last = Symbol('unpainted');
  Store.onChange(() => {
    const k = Store.key();
    _paintDraft();
    if (k === last) return;
    last = k;
    if (!_show(k)) _paint();
    _disarm();          // a different project means the armed delete no longer applies
    _cancelRename();    // and that a half-typed name belongs to a project no longer open
  });
}

// THE DRAFT is never asked about - not at the window's close, not at
// the start, not when another project is opened: it stays as it is, its lanes and its chats, first in the list. Its two
// buttons: "save" names it (a new empty draft takes its place, routes/mergev3.js), "clear" empties its lanes and keeps it.
function _paintDraft() {
  const d = Store.isDraft();
  const e = document.getElementById('mv3-project-edit');
  const x = document.getElementById('mv3-project-del');
  if (e && !_editing) {
    e.textContent = d ? T.t('Save') : T.t('Edit');
    e.title = d ? T.t('Save this draft under a name - what it made goes into the name\'s folder') : T.t('Rename this project');
  }
  if (x && !_armed) {
    x.textContent = d ? T.t('Clear') : T.t('Delete');
    x.title = d ? T.t('Empty the lanes of this draft - it stays the draft, with its chats; Ctrl+Z brings the clips back') : T.t('Delete this project');
  }
  _delLook(x, d);
}
// "clear" deletes nothing - Ctrl+Z brings the clips back: a quiet button, its
// "Really?" the light step (as a paid press); "delete" the part's quiet red, its "Really?" the red fill.
function _delLook(x, draft) {
  if (!x) return;
  x.classList.toggle('is-danger', !draft);
  x.classList.toggle('is-quiet', !!draft);
}

// ── New: an empty project, made here ────────────────────────────────────────
// The name is ASKED FOR, with a prompt: a name skipped now is a project called Untitled until
// someone renames it. The default offered is today's date, which is how a talking head's name
// begins, so a hand-made one sorts and reads beside them instead of standing out.
//
// An empty project also means the Main track is empty, and Split - it needs a clip under the
// playhead (js/merge-v3/bar.js) - stays disabled until clips are dragged in: not a half-made
// project.
function _wireNew() {
  const b = document.getElementById('mv3-project-new');
  if (!b) return;
  // the "+" is Lucide's plus
  b.innerHTML = icon('plus', 14) + '<span>' + T.t('New project') + '</span>';
  // Several kinds of project, so the button asks which (_kindMenu). A blank project is an empty
  // timeline and is made here; a talking head starts from a scenario: the Library's "scenarios" view
  // opens in the project that is open (js/merge-v3/scen-pick.js) - the project itself is
  // made when one is used; a voiceover opens its draft, highlights its popup.
  b.addEventListener('click', () => _kindMenu(b));
  // ?new=menu | blank | talking | highlights - Home's "+" buttons do what this menu's items do,
  // once the page has its project. Said once: the address forgets it.
  const want = (() => { try { return new URLSearchParams(location.search).get('new') || ''; } catch (e) { return ''; } })();
  if (want) {
    let done = false;
    Store.onChange(() => {
      if (done || !Store.key()) return;
      done = true;
      try { const u = new URL(location.href); u.searchParams.delete('new'); history.replaceState({}, '', u); } catch (e) { /* a reload asks again */ }
      if (want === 'blank') { if (_newBlank) _newBlank(); }
      else if (want === 'talking') openScenarios();
      else if (want === 'voiceover') _voiceover();
      else if (want === 'highlights') {
        (async () => {
          _note(T.t('creating…'));
          try { await createHighlights(); _note(''); } catch (e) { _fail(e.message); }
        })();
      } else _kindMenu(b);
    });
  }
  _newBlank = async () => {
    const today = new Date().toISOString().slice(0, 10);
    const title = await askName({ anchor: b, title: T.t('New project'), value: today + ' - ', select: false, okLabel: T.t('Create') });
    if (title === null) return;                       // cancelled, not an empty name
    const clean = title.trim();
    if (!clean) { _fail(T.t('a name is needed')); return; }

    b.disabled = true;
    _note(T.t('creating…'));
    try {
      const d = await fetch('/api/mv3/timeline/new', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        // Said explicitly even though the server defaults to it: this button is the only
        // way a blank project comes into existence, and reading that off a default would
        // hide it.
        body: JSON.stringify({ title: clean, kind: Store.BLANK_KIND }),
      }).then(r => r.json());
      if (!d || !d.success) throw new Error((d && d.error) || T.t('refused'));
      // Opening it is the point of having made it. The picker repaints off the store change.
      await Store.open(d.key);
      roomForWork();                                  // a new project is opened to be worked on
      _note('');
    } catch (e) {
      _fail(e.message);
    } finally {
      b.disabled = false;
    }
  };
}

// THE voiceover draft opened (js/merge-v3/scen-pick.js openVoiceover); a refusal is a popup.
async function _voiceover() {
  _note(T.t('opening…'));
  try { await openVoiceover(); _note(''); } catch (e) { _fail(e.message); }
}

// The menu itself: a layer like the library's "+" (js/layers.js), so Escape closes it and the
// page keeps its shortcuts.
let _newBlank = null;
let _kindPop = null;

function _closeKind() {
  if (!_kindPop) return;
  _kindPop.el.remove();
  document.removeEventListener('mousedown', _kindPop.away, true);
  Layers.close(_kindPop.layer);
  _kindPop = null;
}

function _kindMenu(anchor) {
  if (_kindPop) { _closeKind(); return; }             // the same press closes it again
  const el = document.createElement('div');
  el.className = 'mv3-plus-menu u-menu is-float';
  const item = (label, sub, on) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'mv3-plus-item u-mi';
    // A kind that is coming: there, greyed, and nothing happens on a press (css/app-shell.css [disabled]).
    if (!on) btn.disabled = true;
    const t = document.createElement('span');
    t.textContent = label;
    btn.appendChild(t);
    const s = document.createElement('small');
    s.textContent = sub;
    btn.appendChild(s);
    if (on) btn.addEventListener('click', (e) => { e.stopPropagation(); _closeKind(); on(); });
    el.appendChild(btn);
  };
  item(T.t('blank'), T.t('an empty timeline to build on'), () => { if (_newBlank) _newBlank(); });
  // Nothing asked about the draft: the view opens in it, and a talking head made from it leaves
  // it a draft.
  // A kind whose keys are not all there is not started: the popup says which (js/key-gate.js).
  item(T.t('talking head'), T.t('from a scenario - pick or write one'), () => { if (allow('talking', anchor)) openScenarios(); });
  // A long video in, vertical shorts out - a project of its own, and its popup.
  item(T.t('highlights'), T.t('a long video → shorts'), async () => {
    if (!allow('highlights', anchor)) return;
    _note(T.t('creating…'));
    try { await createHighlights(); _note(''); } catch (e) { _fail(e.message); }
  });
  // A voiceover: the script's text read in a voice - THE voiceover draft, on its setup.
  item(T.t('voiceover'), T.t('a scenario or your own text, read in a voice'), () => { _voiceover(); });

  document.body.appendChild(el);
  const r = anchor.getBoundingClientRect();
  el.style.left = Math.round(Math.max(6, Math.min(window.innerWidth - el.offsetWidth - 6, r.left))) + 'px';
  el.style.top = Math.round(r.bottom + 4) + 'px';
  const away = (e) => { if (!el.contains(e.target) && e.target !== anchor) _closeKind(); };
  const layer = Layers.open(el, { modal: false, name: 'new project', onEsc: _closeKind });
  _kindPop = { el, away, layer };
  document.addEventListener('mousedown', away, true);
}

// ── Rename ──────────────────────────────────────────────────────────────────
// A project renamed IN PLACE OF THE PICKER rather than beside it. The name is already there; opening a dialog to
// change a string that is on screen is a trip to another room to move a chair.
let _editing = false;

function _cancelRename() {
  const sel = _sel();
  const box = document.getElementById('mv3-project-name');
  const b = document.getElementById('mv3-project-edit');
  _editing = false;
  if (box) { box.hidden = true; box.value = ''; }
  if (sel) sel.hidden = false;
  if (b) b.textContent = Store.isDraft() ? T.t('Save') : T.t('Edit');
  _note('');
}

async function _saveRename() {
  const box = document.getElementById('mv3-project-name');
  const key = _projKey();
  if (!box || !key) return _cancelRename();
  const title = box.value.trim();
  if (!title) { _fail(T.t('a name is needed')); box.focus(); return; }
  const was = key === Store.key() ? Store.title() : (_titles.get(key) || '');
  if (title === was && !Store.isDraft()) return _cancelRename();
  const saving = Store.isDraft();

  _note(saving ? T.t('saving…') : T.t('renaming…'));
  try {
    const r = await fetch('/api/mv3/timeline/' + encodeURIComponent(key) + '/title', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    });
    const d = await r.json();
    // A name already taken is not a failure to be swept away - the box stays open with what
    // was typed still in it, because the next thing to do is change one word of it.
    if (!d || !d.success) { _fail(d && d.error ? d.error : T.t('refused')); box.focus(); box.select(); return; }
    // A draft named is a draft saved.
    if (saving) Store.markSaved(d.title); else if (key === Store.key()) Store.setTitle(d.title);
    _cancelRename();
    await _paint();
  } catch (e) {
    _fail(e.message);
    box.focus();
  }
}

function _wireRename() {
  const b = document.getElementById('mv3-project-edit');
  const box = document.getElementById('mv3-project-name');
  const sel = _sel();
  if (!b || !box || !sel) return;

  b.addEventListener('click', () => {
    if (_editing) { _saveRename(); return; }
    const key = Store.key();
    if (!key) { _fail(T.t('open a project first')); return; }
    _editing = true;
    // A draft is named the way a new project is: the day, then its name.
    const draft = Store.isDraft();
    box.value = draft ? new Date().toISOString().slice(0, 10) + ' - ' : (_projKey() === key ? (Store.title() || '') : (_titles.get(_projKey()) || ''));
    box.hidden = false;
    sel.hidden = true;
    b.textContent = T.t('Save');
    box.focus();
    if (draft) box.setSelectionRange(box.value.length, box.value.length); else box.select();
  });

  box.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); _saveRename(); }
    // Escape puts it back exactly as it was. So does clicking away - see below.
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); _cancelRename(); }
  });

  // A click outside CANCELS rather than saves. Between the two, cancelling is the one that
  // cannot surprise: a name changed by walking away is a name nobody chose to change.
  document.addEventListener('mousedown', (e) => {
    if (!_editing) return;
    if (e.target === box || e.target === b) return;
    // Nor the corner of popups: closing "that name is taken" keeps what was typed.
    if (e.target && e.target.closest && e.target.closest('.sv3-toasts')) return;
    _cancelRename();
  }, true);
}

// ── Delete, armed by the first click ────────────────────────────────────────
let _armed = false;
let _armTimer = null;

function _disarm() {
  const b = document.getElementById('mv3-project-del');
  _armed = false;
  if (_armTimer) { clearTimeout(_armTimer); _armTimer = null; }
  if (b) { b.textContent = Store.isDraft() ? T.t('Clear') : T.t('Delete'); b.classList.remove('is-armed'); _delLook(b, Store.isDraft()); }
}

function _wireDelete() {
  const b = document.getElementById('mv3-project-del');
  if (!b) return;
  b.addEventListener('click', async () => {
    if (!_armed) {
      _armed = true;
      b.textContent = REALLY;
      b.classList.add('is-armed');
      // Disarms itself. An armed delete left sitting there is a trap for the next click
      // that happens to land on it. (One "Really?", 3 s - js/really.js.)
      _armTimer = setTimeout(_disarm, MS);
      return;
    }
    _disarm();
    const key = _projKey();
    if (!key) return;
    // The draft is not deleted - its lanes are emptied, and it stays.
    if (Store.isDraft()) { _clear(); return; }
    // A TALKING HEAD'S FILES: the last timeline of its project holds the reads,
    // frames and clips in the project's folder, and deleting it asks whether they go too. The pictures and videos
    // on the Library's shelves are not in that folder and stay.
    let rec = null;
    try { rec = (await Store.list()).find(p => p.key === key) || null; } catch (e) { rec = null; }
    if (rec && rec.ownFiles) {
      askChoice(b, T.t('Delete «{name}»?', { name: Store.title() || T.t('this project') }),
        T.t('Its reads, frames and clips are in the project folder. Its chats go with the timeline; the pictures and videos on the Library shelves stay either way, at the top of their kind.'), [
          { label: T.t('Timeline only'), on: () => _delete(key, false) },
          { label: T.t('And its files'), kind: 'danger', on: () => _askHeads(b, key) },
          { label: T.t('Cancel') },
        ], { stay: true });   // the bar does not scroll; a project still opening scrolls the page under it
      return;
    }
    _delete(key, false);
  });
}

// "clear": the draft's lanes emptied to a new timeline's, one step to undo (store.js
// clearDraft); its name, folder and chats stay, and so does what it made - on the shelves.
async function _clear() {
  _note(T.t('clearing…'));
  try {
    const r = await Store.clearDraft();
    _note(r === 'empty' ? T.t('the draft is empty already') : T.t('cleared - Ctrl+Z brings the clips back'));
  } catch (e) { _fail(e.message); }
}

// A project
// deleted with its files and talking heads made in it: keep them in the Library (Generated · Talking heads · <the
// project>, deleted there one by one) or let them go with the project.
async function _askHeads(anchor, key) {
  const m = /^sv3_(\d+)/.exec(String(key || ''));
  let n = 0;
  if (m) {
    try {
      const d = await fetch('/api/library/shelf/media?filter=heads&cat=' + encodeURIComponent(m[1])).then(r => r.json());
      n = ((d && d.items) || []).length;
    } catch (e) { n = 0; }
  }
  if (!n) { _delete(key, true); return; }
  askChoice(anchor, T.tn(n, 'Its {n} talking head?', 'Its {n} talking heads?'),
    T.t('Every take made in this project. Kept, they stay in the Library - Generated · Talking heads · «{name}» - until you delete them there; a timeline of another project that uses one keeps it.',
      { name: Store.title() || T.t('this project') }), [
      { label: T.t('Keep in the Library'), kind: 'yes', on: () => _delete(key, true, 'keep') },
      { label: T.t('Delete them too'), kind: 'danger', on: () => _delete(key, true, 'delete') },
      { label: T.t('Cancel') },
    ], { stay: true });
}

async function _delete(key, files, heads) {
  _note(T.t('deleting…'));
  // An edit still waiting goes up first: a save after the delete would be refused (the project is gone).
  try { await Store.flush(); } catch (e) { /* refused or offline - the delete goes on */ }
  try {
    const q = files ? '?files=1' + (heads ? '&heads=' + heads : '') : '';
    const d = await fetch('/api/mv3/timeline/' + encodeURIComponent(key) + q, { method: 'DELETE' }).then(r => r.json());
    if (!d || !d.success) throw new Error((d && d.error) || T.t('refused'));
    // Back to nothing open rather than to whatever is left. Deleting a project and finding
    // yourself editing a different one is how the wrong video gets edited.
    const kept = d.files && d.files.kept;
    // Not `heads`: that name is the parameter ('keep' | 'delete') the address above reads, and a const of the
    // same name in this block would make that read throw before the request ("Cannot access 'heads' before initialization").
    const keptHeads = d.files && d.files.heads;
    _after = [kept ? T.tn(kept, '{n} file still used elsewhere moved to media/work', '{n} files still used elsewhere moved to media/work') : '',
      keptHeads ? T.tn(keptHeads, '{n} talking head kept in the Library', '{n} talking heads kept in the Library') : ''].filter(Boolean).join(' · ');
    await Store.openBlank();
  } catch (e) { _fail(e.message); }
}
