/* ═══════════════════════════════════════════════════════════════════════════
   MERGE v3 — the project bar.

   One timeline per project, and a project is a Scenarios project: its approved cut is
   what fills the Main track, so its key is `sv3_<scenariosProjectId>`. The timeline
   that existed before projects did is listed as `local` / "Untitled".

   Newest first. An import from Scenarios therefore lands at the top of the list, which
   is where you look for the thing you just sent.

   The list is re-read after a switch rather than kept in memory: a project can appear
   without this page doing anything - Scenarios writes it - and a cached list would show
   yesterday's projects until a reload.

   ONE PERSON. The desktop app has one, so every project is theirs (lib/ownership.js answers so) and
   the picker lists them all - the owner picker, "copy to my profile" and the read-only lock of the
   server version went in phase C.
   ═══════════════════════════════════════════════════════════════════════════ */

import * as Store from './store.js';
import * as Layers from '../layers.js';
import { roomForWork } from './layout.js';
import { askName } from '../name-box.js';
import { askChoice } from './ask.js';
import { draftNow, askDraft } from '../draft-ask.js';
import { openScenarios } from './scen-pick.js';
import { createHighlights, homeOf } from './highlights.js';

function _sel() { return document.getElementById('mv3-project'); }
// Said once after the picker is painted again (a delete that moved files), where "nothing open yet" would go.
let _after = '';
// (phase V33.1) The projects' names as the list last said them - a highlights project's, while one of its fragments is open.
const _titles = new Map();
// The project a press of "edit" or "delete" is about: the open timeline's own - or, for a fragment, its project's.
const _projKey = () => homeOf(Store.key()) || Store.key();
function _note(text) {
  const el = document.getElementById('mv3-project-note');
  if (el) el.textContent = text || '';
}

const _fmtDate = (s) => {
  if (!s) return '';
  const d = new Date(s);
  return isNaN(d) ? '' : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
};

async function _paint() {
  const sel = _sel();
  if (!sel) return;
  let d = null;
  try { d = await Store.listFull(); } catch (e) { _note(e.message); return; }
  const { list } = d;
  _titles.clear();
  for (const p of list) _titles.set(p.key, p.title);
  // (phase V33.1) A fragment of a highlights project is not in the list: its project's line stands for it.
  const open = list.some(p => p.key === Store.key()) ? Store.key() : (homeOf(Store.key()) || Store.key());
  const openRec = open ? list.find(p => p.key === open) : null;

  sel.textContent = '';
  const shown = list;
  for (const p of shown) {
    const o = document.createElement('option');
    o.value = p.key;
    // Clip count in the label because two projects from the same day are otherwise told
    // apart only by their title, and imported titles all start with the date. (phase V20) The draft says what it is.
    o.textContent = p.draft ? 'draft · not saved' + (p.clips ? ' · ' + p.clips : '')
      : p.highlights ? 'highlights · ' + p.title + (p.createdAt ? ' · ' + _fmtDate(p.createdAt) : '')
      : p.title + (p.clips ? ' · ' + p.clips : '') + (p.createdAt ? ' · ' + _fmtDate(p.createdAt) : '');
    sel.appendChild(o);
  }
  // With nothing open the picker must SAY so. Left alone it would show the first project in
  // the list, which reads as "this one is open" when it is not.
  if (openRec) {
    sel.value = open;
    // (phase V20) A delete or a draft let go of opens the draft - and says what became of what was there.
    _note(_after);
    _after = '';
  } else {
    const o = document.createElement('option');
    o.value = '';
    o.textContent = '— choose a project —';
    sel.insertBefore(o, sel.firstChild);
    sel.value = '';
    _note(_after || (shown.length ? 'nothing open yet' : 'no projects yet'));
    _after = '';
  }
}

export function initProjects() {
  const sel = _sel();
  if (!sel) return;
  sel.addEventListener('change', async () => {
    const want = sel.value;
    if (!want) return;              // the "choose a project" placeholder
    // (phase V20) Away from the draft with something in it: asked first, and Cancel stays.
    if (want !== Store.key() && !(await _leaveDraft())) { sel.value = Store.key() || ''; return; }
    _note('opening…');
    try {
      await Store.open(want);
      _note('');
    } catch (e) { _note(e.message); }
  });

  // Refreshed when the list is about to be READ, not on every store change: a clip drag
  // changes the store several times a second and none of those change which projects
  // exist. Opening the dropdown is also the moment a project imported from Scenarios has
  // to appear without reloading the page.
  sel.addEventListener('mousedown', () => { _paint(); });
  sel.addEventListener('focus', () => { _paint(); });

  _wireNew();
  _wireRename();
  _wireDelete();

  // And once when the store first knows which project is open. The sentinel is a Symbol, not
  // null: "no project open" IS null now, so a null seed made the first paint look like a
  // repeat and the picker was never filled at all.
  let last = Symbol('unpainted');
  Store.onChange(() => {
    const k = Store.key();
    _paintDraft();
    if (k === last) return;
    // The first project the session really opens - not the empty moment before the store has read one.
    if (k && !_startAsked) { _startAsked = true; _askAtStart(); }
    last = k;
    _paint();
    _disarm();          // a different project means the armed delete no longer applies
    _cancelRename();    // and that a half-typed name belongs to a project no longer open
  });
}

// (phase V20) Leaving the draft with something in it - another project opened, a new one made: saved, let go of, or
// stay. True when the way is open.
async function _leaveDraft() {
  if (!Store.isDraft()) return true;
  const dr = await draftNow();
  if (!dr || dr.key !== Store.key() || !dr.content || !dr.content.any) return true;
  const r = await askDraft(dr);
  if (r.result === 'saved') Store.markSaved(r.title);
  return r.result === 'saved' || r.result === 'discarded';
}

// (phase V20) AT THE START, a draft with something in it was left by an app that closed without asking - a crash, a
// power cut: asked once a session (the app's window is one session), with "Later".
const SS_ASKED = 'mv3_draft_asked';
let _startAsked = false;
async function _askAtStart() {
  try {
    if (sessionStorage.getItem(SS_ASKED)) return;
    sessionStorage.setItem(SS_ASKED, '1');
  } catch (e) { return; }
  if (!Store.isDraft()) return;
  const dr = await draftNow();
  if (!dr || dr.key !== Store.key() || !dr.content || !dr.content.any) return;
  const r = await askDraft(dr, { later: true });
  if (r.result === 'saved') Store.markSaved(r.title);
  else if (r.result === 'discarded') { _after = 'not saved - what it made is in the Library, in Uncategorized'; await Store.openBlank(); }
}

// (phase V20) The draft's two buttons: "save" names it, "don't save" lets it go - what it made goes to Uncategorized.
function _paintDraft() {
  const d = Store.isDraft();
  const e = document.getElementById('mv3-project-edit');
  const x = document.getElementById('mv3-project-del');
  if (e && !_editing) {
    e.textContent = d ? 'save' : 'edit';
    e.title = d ? 'Save this draft under a name - what it made goes into the name\'s category' : 'Rename this project';
  }
  if (x && !_armed) {
    x.textContent = d ? 'don\'t save' : 'delete';
    x.title = d ? 'Let this draft go - what it made stays in the Library, in Uncategorized' : 'Delete this project';
  }
}

// ── New: an empty project, made here rather than sent from Scenarios ────────
// The name is ASKED FOR, with a prompt, because nothing in this app renames a project: a name
// skipped now is a project called Untitled for as long as it exists. The default offered is
// today's date, which is how imported projects are titled, so a hand-made one sorts and reads
// beside them instead of standing out.
//
// An empty project also means the Main track is empty, and the buttons that need a cut stay
// disabled until clips are dragged in - that is main.js's NEEDS_PROJECT doing its job, not a
// half-made project.
function _wireNew() {
  const b = document.getElementById('mv3-project-new');
  if (!b) return;
  // Two kinds of project, so the button asks which. A blank project is an empty timeline and
  // is made here; a talking head starts from a scenario: the Library's "scenarios" view opens in the
  // project that is open (phase V28.3, js/merge-v3/scen-pick.js) - the project itself is made when one
  // is used.
  b.addEventListener('click', () => _kindMenu(b));
  // (Home, the owner 2026-10-22) ?new=menu | blank | talking | highlights - Home's "+" buttons do what this menu's items do,
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
      else if (want === 'highlights') {
        (async () => {
          if (!(await _leaveDraft())) return;
          _note('creating…');
          try { await createHighlights(); _note(''); } catch (e) { _note(e.message); }
        })();
      } else _kindMenu(b);
    });
  }
  _newBlank = async () => {
    if (!(await _leaveDraft())) return;
    const today = new Date().toISOString().slice(0, 10);
    const title = await askName({ anchor: b, title: 'New project', value: today + ' - ', select: false, okLabel: 'Create' });
    if (title === null) return;                       // cancelled, not an empty name
    const clean = title.trim();
    if (!clean) { _note('a name is needed'); return; }

    b.disabled = true;
    _note('creating…');
    try {
      const d = await fetch('/api/mv3/timeline/new', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        // Said explicitly even though the server defaults to it: this button is the only
        // way a blank project comes into existence, and reading that off a default would
        // hide it.
        body: JSON.stringify({ title: clean, kind: Store.BLANK_KIND }),
      }).then(r => r.json());
      if (!d || !d.success) throw new Error((d && d.error) || 'refused');
      // Opening it is the point of having made it. The picker repaints off the store change.
      await Store.open(d.key);
      roomForWork();                                  // a new project is opened to be worked on
      _note('');
    } catch (e) {
      _note(e.message);
    } finally {
      b.disabled = false;
    }
  };
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
  el.className = 'mv3-plus-menu';
  const item = (label, sub, on) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'mv3-plus-item';
    const t = document.createElement('span');
    t.textContent = label;
    btn.appendChild(t);
    const s = document.createElement('small');
    s.textContent = sub;
    btn.appendChild(s);
    btn.addEventListener('click', (e) => { e.stopPropagation(); _closeKind(); on(); });
    el.appendChild(btn);
  };
  item('blank', 'an empty timeline to build on', () => { if (_newBlank) _newBlank(); });
  // Nothing asked about the draft (the owner, V28.3 (d)): the view opens in it, and a talking head made from it leaves
  // it a draft.
  item('talking head', 'from a scenario - pick or write one', () => { openScenarios(); });
  // (phase V33.1, the owner 2026-10-03/04: third) A long video in, vertical shorts out - a project of its own, and its popup.
  item('highlights', 'a long video → shorts', async () => {
    if (!(await _leaveDraft())) return;
    _note('creating…');
    try { await createHighlights(); _note(''); } catch (e) { _note(e.message); }
  });

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
// Projects could not be renamed, and the new-project prompt used to say so. They can now, and
// the reason is the library: a project's generations are filed under a category named after it,
// so a project stuck with a bad name is a shelf stuck with one too.
//
// IN PLACE OF THE PICKER rather than beside it. The name is already there; opening a dialog to
// change a string that is on screen is a trip to another room to move a chair.
let _editing = false;

function _cancelRename() {
  const sel = _sel();
  const box = document.getElementById('mv3-project-name');
  const b = document.getElementById('mv3-project-edit');
  _editing = false;
  if (box) { box.hidden = true; box.value = ''; }
  if (sel) sel.hidden = false;
  if (b) b.textContent = Store.isDraft() ? 'save' : 'edit';
  _note('');
}

async function _saveRename() {
  const box = document.getElementById('mv3-project-name');
  const key = _projKey();
  if (!box || !key) return _cancelRename();
  const title = box.value.trim();
  if (!title) { _note('a name is needed'); box.focus(); return; }
  const was = key === Store.key() ? Store.title() : (_titles.get(key) || '');
  if (title === was && !Store.isDraft()) return _cancelRename();
  const saving = Store.isDraft();

  _note(saving ? 'saving…' : 'renaming…');
  try {
    const r = await fetch('/api/mv3/timeline/' + encodeURIComponent(key) + '/title', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    });
    const d = await r.json();
    // A name already taken is not a failure to be swept away - the box stays open with what
    // was typed still in it, because the next thing to do is change one word of it.
    if (!d || !d.success) { _note(d && d.error ? d.error : 'refused'); box.focus(); box.select(); return; }
    // (phase V20) A draft named is a draft saved.
    if (saving) Store.markSaved(d.title); else if (key === Store.key()) Store.setTitle(d.title);
    _cancelRename();
    await _paint();
  } catch (e) {
    _note(e.message);
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
    if (!key) { _note('open a project first'); return; }
    if (!Store.canEdit()) { _note('this project cannot be changed here'); return; }
    _editing = true;
    // (phase V20) A draft is named the way a new project is: the day, then its name.
    const draft = Store.isDraft();
    box.value = draft ? new Date().toISOString().slice(0, 10) + ' - ' : (_projKey() === key ? (Store.title() || '') : (_titles.get(_projKey()) || ''));
    box.hidden = false;
    sel.hidden = true;
    b.textContent = 'save';
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
  if (b) { b.textContent = Store.isDraft() ? 'don\'t save' : 'delete'; b.classList.remove('is-armed'); }
}

function _wireDelete() {
  const b = document.getElementById('mv3-project-del');
  if (!b) return;
  b.addEventListener('click', async () => {
    if (!_armed) {
      _armed = true;
      b.textContent = 'really?';
      b.classList.add('is-armed');
      // Disarms itself. An armed delete left sitting there is a trap for the next click
      // that happens to land on it.
      _armTimer = setTimeout(_disarm, 4000);
      return;
    }
    _disarm();
    const key = _projKey();
    if (!key) return;
    // (phase V20) The draft is not deleted - it is let go of: what it made stays, in Uncategorized.
    if (Store.isDraft()) { _discard(key); return; }
    // A TALKING HEAD'S FILES (phase C3, the owner 2026-10-05): the last timeline of its project holds the reads,
    // frames and clips in the project's folder, and deleting it asks whether they go too. The pictures and videos
    // on the Library's shelves are not in that folder and stay.
    let rec = null;
    try { rec = (await Store.list()).find(p => p.key === key) || null; } catch (e) { rec = null; }
    if (rec && rec.ownFiles) {
      askChoice(b, 'Delete «' + (Store.title() || 'this project') + '»?',
        'Its reads, frames and clips are in the project folder. Its chats go with the timeline; the pictures and videos on the Library shelves stay either way, in Uncategorized.', [
          { label: 'Timeline only', on: () => _delete(key, false) },
          { label: 'And its files', kind: 'yes', on: () => _askHeads(b, key) },
          { label: 'Cancel' },
        ], { stay: true });   // the bar does not scroll; a project still opening scrolls the page under it
      return;
    }
    _delete(key, false);
  });
}

// (phase V20) A draft not saved: its timeline and chats go, what it made stays in the Library, Uncategorized - and a
// new draft takes its place.
async function _discard(key) {
  _note('letting it go…');
  try {
    const d = await fetch('/api/mv3/timeline/' + encodeURIComponent(key) + '/discard', { method: 'POST' }).then(r => r.json());
    if (!d || !d.success) throw new Error((d && d.error) || 'refused');
    _after = 'not saved - what it made is in the Library, in Uncategorized';
    await Store.openBlank();
  } catch (e) { _note(e.message); }
}

// (phase V28.4, second round, the owner: "при удалении проекта спрашивать про удаление исходников с головами") A project
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
  askChoice(anchor, 'Its ' + n + (n === 1 ? ' talking head' : ' talking heads') + '?',
    'Every take made in this project. Kept, they stay in the Library - Generated · Talking heads · «' + (Store.title() || 'this project')
      + '» - until you delete them there; a timeline of another project that uses one keeps it.', [
      { label: 'Keep in the Library', kind: 'yes', on: () => _delete(key, true, 'keep') },
      { label: 'Delete them too', on: () => _delete(key, true, 'delete') },
      { label: 'Cancel' },
    ], { stay: true });
}

async function _delete(key, files, heads) {
  _note('deleting…');
  try {
    const q = files ? '?files=1' + (heads ? '&heads=' + heads : '') : '';
    const d = await fetch('/api/mv3/timeline/' + encodeURIComponent(key) + q, { method: 'DELETE' }).then(r => r.json());
    if (!d || !d.success) throw new Error((d && d.error) || 'refused');
    // Back to nothing open rather than to whatever is left. Deleting a project and finding
    // yourself editing a different one is how the wrong video gets edited.
    const kept = d.files && d.files.kept;
    // (phase V28.4) What it filed under its name on the shelves is in Uncategorized now.
    const loose = Object.values(d.released || {}).includes('released');
    const heads = d.files && d.files.heads;
    _after = [kept ? kept + (kept === 1 ? ' file' : ' files') + ' still used elsewhere moved to media/work' : '',
      loose ? 'what it filed is in the Library, in Uncategorized' : '',
      heads ? heads + (heads === 1 ? ' talking head' : ' talking heads') + ' kept in the Library' : ''].filter(Boolean).join(' · ');
    await Store.openBlank();
  } catch (e) { _note(e.message); }
}
