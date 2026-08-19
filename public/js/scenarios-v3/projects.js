// Scenarios v3 — the tab bar: scenario type + project picker + delete.
//
// The bar is always visible, even before any project exists. Creating a project
// from the library adds it here and opens it; choosing one from the dropdown
// opens it too. On a fresh page load the dropdown SHOWS the last project but
// deliberately does not open it — the page always starts in the library.

import { listProjects, getProject, createProject, deleteProject, saveProject } from './api.js';
import { setMode, onModeChange } from './shell.js';
import { makeArmable } from './arm.js';
import { flushFragments } from './fragments.js';
import { flushMontage } from './montage.js';

const LAST_KEY = 'sv3_last_project_v1';   // mirrored server-side by storage-sync.js

const $ = id => document.getElementById(id);

let _projects = [];
let _current  = null;   // the open project, or null while in the library
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
  if (!_current) return null;
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

function _renderSelect(selectedId) {
  const sel = $('sv3-project');
  if (!sel) return;
  sel.textContent = '';

  const none = document.createElement('option');
  none.value = '';
  none.textContent = _projects.length ? '— pick a project —' : '— no projects yet —';
  sel.appendChild(none);

  _projects.forEach(p => {
    const o = document.createElement('option');
    o.value = p.id;
    o.textContent = p.name;
    sel.appendChild(o);
  });

  const want = selectedId != null ? String(selectedId) : '';
  sel.value = _projects.some(p => String(p.id) === want) ? want : '';
  _syncDel();
}

// del acts on whatever the dropdown shows, so it works without opening first.
function _syncDel() {
  const sel = $('sv3-project');
  const del = $('sv3-proj-del');
  if (del) del.disabled = !(sel && sel.value);
}

export async function reloadProjects(selectedId) {
  try {
    _projects = await listProjects();
    _status('');
  } catch (e) {
    _projects = [];
    _status('Could not load projects: ' + e.message, 'err');
  }
  let want = selectedId;
  if (want == null) { try { want = localStorage.getItem(LAST_KEY); } catch (e) {} }
  _renderSelect(want);
}

// Load a project and switch to the workspace columns.
export async function openProject(id) {
  try {
    _current = await getProject(id);
    try { localStorage.setItem(LAST_KEY, String(id)); } catch (e) {}
    _renderSelect(id);
    _emit();
    setMode('workspace');
    _status('');
  } catch (e) {
    _current = null;
    _emit();
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
      _syncDel();
      if (sel.value) openProject(sel.value);
    });
  }

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
    if (_projects.length) return openProject(_projects[0].id);
  });
}
