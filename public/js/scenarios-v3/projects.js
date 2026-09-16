// Scenarios v3 — the tab bar: scenario type + owner + project picker + delete / copy.
//
// The bar is always visible, even before any project exists. Creating a project
// from the library adds it here and opens it; choosing one from the dropdown
// opens it too. On a fresh page load the dropdown SHOWS the last project but
// deliberately does not open it — the page always starts in the library.
//
// ONE OWNER AT A TIME. Every project has an owner (or is shared - see lib/ownership.js), and
// the picker lists one owner's projects, chosen in the Owner dropdown to its left. Anyone's
// can be opened; only your own can be changed (the admin: all of them). The rest open
// read-only - the columns show them, their controls step back - and the way to work on one
// is "copy to my profile", which makes a copy under your name and opens it in place.

import { listProjectsFull, getProject, createProject, deleteProject, saveProject, copyProject } from './api.js';
import { setMode, onModeChange } from './shell.js';
import { makeArmable } from './arm.js';
import { flushFragments } from './fragments.js';
import { flushMontage } from './montage.js';

const LAST_KEY = 'sv3_last_project_v1';   // mirrored server-side by storage-sync.js

const $ = id => document.getElementById(id);

let _projects = [];
let _current  = null;   // the open project, or null while in the library

let _owners   = [];     // everyone with a project, the shared group, and you
let _me       = null;   // the signed-in person, as the server reports them
let _ownerSel = null;   // whose projects the picker lists; null until the first list lands
const OWNER_KEY = 'sv3_last_owner_v1';
const SHARED = 'shared';
const _ownerOf = (p) => (p && p.owner) || SHARED;

// Mirrors lib/ownership.js: the owner, or the admin; a shared project is the admin's alone.
// The server is the one that refuses; this decides what the page offers.
function _canEdit(p) {
  if (!p || !_me) return false;
  if (_me.role === 'admin') return true;
  return !!p.owner && String(p.owner) === String(_me.id);
}
export const canEditCurrent = () => _canEdit(_current);
const _subs   = [];     // notified with (project|null) whenever the open project changes

export const currentProject = () => _current;

// Columns that render project content subscribe here instead of being imported,
// which keeps this module free of dependencies on them.
export function onProjectChange(fn) { _subs.push(fn); }
function _emit() {
  _subs.forEach(fn => { try { fn(_current); } catch (e) { console.error('[sv3] project subscriber', e); } });
}

// Adopt a project the SERVER rewrote, and tell every column about it. Used after the
// tagging pass, which writes the lines itself: patching from the page instead would
// race the copy the Fragments column is holding.
export function adoptProject(project) {
  if (!project || !_current || String(project.id) !== String(_current.id)) return;
  _current = project;
  _emit();
}

// A save landed on the open project. This is NOT onProjectChange: that repaints every
// column, and the Fragments column autosaves on each keystroke, so a full repaint
// would yank the caret. Columns that only READ the project subscribe here instead.
const _saveSubs = [];
export function onProjectSaved(fn) { _saveSubs.push(fn); }

// Persist a partial change onto the open project (used by fragment text edits).
export async function patchProject(fields) {
  // A read-only project is never patched: the columns are blocked from editing it, and the
  // one autosave that could still fire - a stale timer - has nothing it may write.
  if (!_current || !_canEdit(_current)) return null;
  const saved = await saveProject({ id: _current.id, ...fields });
  // keep the in-memory copy in step without dropping fields the caller did not send
  Object.assign(_current, saved);
  _saveSubs.forEach(fn => { try { fn(_current); } catch (e) { console.error('[sv3] save subscriber', e); } });
  return saved;
}

function _status(text, kind) {
  const n = $('sv3-proj-status');
  if (!n) return;
  n.textContent = text || '';
  n.className = 'sv3-status' + (kind ? ' ' + kind : '');
}

// The owner dropdown, and which owner is chosen: the last choice, remembered per browser like
// the last project is; failing that, you. An owner that has gone from the list falls back too.
function _renderOwner() {
  if (_ownerSel == null) { try { _ownerSel = localStorage.getItem(OWNER_KEY); } catch (e) {} }
  if (!_owners.some(o => (o.id || SHARED) === _ownerSel)) _ownerSel = _me ? String(_me.id) : SHARED;
  try { localStorage.setItem(OWNER_KEY, _ownerSel); } catch (e) {}
  const own = $('sv3-owner');
  if (!own) return;
  // A list of one owner is not a choice - the desktop app has one person - so it is not shown.
  const fld = $('sv3-owner-fld');
  if (fld) fld.style.display = _owners.length > 1 ? '' : 'none';
  own.textContent = '';
  _owners.forEach(o => {
    const e = document.createElement('option');
    e.value = o.id || SHARED;
    e.textContent = o.nick + (o.me ? ' (me)' : '') + ' · ' + o.count;
    own.appendChild(e);
  });
  own.value = _ownerSel;
}

function _renderSelect(selectedId) {
  _renderOwner();
  const sel = $('sv3-project');
  if (!sel) return;
  sel.textContent = '';

  const shown = _projects.filter(p => _ownerOf(p) === _ownerSel);
  const none = document.createElement('option');
  none.value = '';
  none.textContent = shown.length ? '— pick a project —'
                   : (_projects.length ? '— no projects here yet —' : '— no projects yet —');
  sel.appendChild(none);

  shown.forEach(p => {
    const o = document.createElement('option');
    o.value = p.id;
    o.textContent = p.name;
    sel.appendChild(o);
  });

  const want = selectedId != null ? String(selectedId) : '';
  sel.value = shown.some(p => String(p.id) === want) ? want : '';
  _syncBar();
}

// del and copy act on whatever the dropdown shows, so they work without opening first: del
// on what is yours, copy on what is not. The lock is about the OPEN project - that is what
// the columns are showing - and with it the columns' controls step back (css: sv3-readonly).
function _syncBar() {
  const sel  = $('sv3-project');
  const del  = $('sv3-proj-del');
  const copy = $('sv3-proj-copy');
  const lock = $('sv3-proj-lock');
  const shown = (sel && sel.value) ? _projects.find(p => String(p.id) === sel.value) : null;
  const can = shown ? _canEdit(shown) : false;
  if (del)  { del.disabled = !shown || !can; del.hidden = !!shown && !can; }
  if (copy) copy.hidden = !shown || !_me || _ownerOf(shown) === String(_me.id);
  const ro = !!_current && !_canEdit(_current);
  if (lock) {
    lock.hidden = !ro;
    lock.textContent = ro
      ? '🔒 read only — ' + (_current.owner ? 'belongs to ' + (_current.ownerNick || 'another user') : 'shared')
      : '';
  }
  document.body.classList.toggle('sv3-readonly', ro);
}

export async function reloadProjects(selectedId) {
  try {
    const d = await listProjectsFull();
    _projects = d.projects;
    _owners = d.owners;
    _me = d.me;
    _status('');
  } catch (e) {
    _projects = [];
    _status('Could not load projects: ' + e.message, 'err');
  }
  let want = selectedId;
  // ?project=<id> wins over the remembered one: Merge sends a project here by address when
  // a talking-head project has just been made from a scenario (docs/local-app/PLAN.md,
  // phase B). Temporary - it goes when this page does.
  if (want == null) {
    try { want = new URLSearchParams(location.search).get('project') || null; } catch (e) {}
  }
  if (want == null) { try { want = localStorage.getItem(LAST_KEY); } catch (e) {} }
  _renderSelect(want);
}

// Load a project and switch to the workspace columns.
export async function openProject(id) {
  try {
    _current = await getProject(id);
    try { localStorage.setItem(LAST_KEY, String(id)); } catch (e) {}
    // The picker has to be showing the list this project is in.
    _ownerSel = _ownerOf(_current);
    _renderSelect(id);
    _emit();
    setMode('workspace');
    _status('');
  } catch (e) {
    _current = null;
    _emit();
    _syncBar();
    _status('Could not open the project: ' + e.message, 'err');
  }
}

// Called by the library's Create project button.
export async function createFromScenario(scenarioId) {
  const p = await createProject(scenarioId);
  await reloadProjects(p.id);
  await openProject(p.id);
  return p;
}

export function initProjects() {
  const sel = $('sv3-project');
  if (sel) {
    sel.addEventListener('change', () => {
      _syncBar();
      if (sel.value) openProject(sel.value);
    });
  }

  // Choosing an owner is leaving the project: the columns would otherwise keep showing one
  // person's work while the bar names another. Back to the library, picker cleared.
  const own = $('sv3-owner');
  if (own) own.addEventListener('change', () => {
    _ownerSel = own.value;
    try { localStorage.setItem(OWNER_KEY, _ownerSel); } catch (e) {}
    if (_current) { _current = null; _emit(); setMode('library'); }
    _renderSelect('');
  });

  // The way into a project that is not yours. The copy is yours, so the picker moves to
  // your list with it selected, and it opens in place of the original.
  const cp = $('sv3-proj-copy');
  if (cp) cp.addEventListener('click', async () => {
    const s = $('sv3-project');
    const id = (s && s.value) || (_current && _current.id);
    if (!id) return;
    cp.disabled = true;
    _status('copying…');
    try {
      const p = await copyProject(id);
      await reloadProjects(p.id);
      await openProject(p.id);
      _status(`"${p.name}" is yours now`, 'ok');
    } catch (e) {
      _status('Copy failed: ' + e.message, 'err');
    } finally {
      cp.disabled = false;
    }
  });

  // Going back to the Scenario column clears the picker. In the library the dropdown was still
  // naming the project you had just left, which reads as "this one is open" while the page is
  // plainly showing the library - and the only way back in is to pick a project, which a
  // dropdown already showing that project cannot offer (`change` never fires).
  //
  // The project itself stays open in memory, so nothing about a running render is disturbed.
  // What it does cost: `del` acts on whatever the dropdown shows, so it is inert in the library
  // until something is picked - and picking is now what opens a project.
  onModeChange((mode) => { if (mode === 'library') _renderSelect(''); });

  makeArmable($('sv3-proj-del'), {
    idleLabel: 'del',
    armedLabel: 'press again',
    onConfirm: async () => {
      const s = $('sv3-project');
      const id = s && s.value;
      if (!id) return;
      try {
        await deleteProject(id);
        // deleting the OPEN project drops back to the library; the source
        // scenario is untouched either way
        const wasOpen = _current && String(_current.id) === String(id);
        if (wasOpen) { _current = null; _emit(); setMode('library'); }
        try { if (localStorage.getItem(LAST_KEY) === String(id)) localStorage.removeItem(LAST_KEY); } catch (e) {}
        await reloadProjects(wasOpen ? '' : undefined);
        _status('Project deleted.', 'ok');
      } catch (e) {
        _status('Delete failed: ' + e.message, 'err');
      }
    },
  });

  // Back to the library to start another project. Everything autosaves, but both columns
  // hold their last change on a short timer, so those are sent before the page moves —
  // leaving is exactly the moment "it will save in a moment" is not good enough.
  //
  // The open project is NOT closed: coming back through the Scenario spine finds it where
  // it was, and the dropdown still shows it.
  const nu = $('sv3-proj-new');
  if (nu) nu.addEventListener('click', async () => {
    nu.disabled = true;
    try {
      if (_current) {
        await Promise.all([flushFragments(), flushMontage()]);
        _status(`"${_current.name}" saved`, 'ok');
      }
      setMode('library');
    } catch (e) {
      _status('Could not save before leaving: ' + e.message, 'err');
    } finally {
      nu.disabled = false;
    }
  });

  // Only talking head is selectable; the other entries are disabled placeholders, so
  // a stray change just snaps back.
  const type = $('sv3-type');
  if (type) type.addEventListener('change', () => { type.value = 'talking_head'; });

  // Land straight in the newest project when one exists — however empty it is —
  // so reloading the page after a change does not mean making a project again.
  // With no projects at all the page stays in the library.
  return reloadProjects().then(() => {
    const shown = _projects.filter(p => _ownerOf(p) === _ownerSel);
    if (shown.length) return openProject(shown[0].id);
  });
}
