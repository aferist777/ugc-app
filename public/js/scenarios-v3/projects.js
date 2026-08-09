// Scenarios v3 — the tab bar: scenario type + project picker + delete.
//
// The bar is always visible, even before any project exists. Creating a project
// from the library adds it here and opens it; choosing one from the dropdown
// opens it too. On a fresh page load the dropdown SHOWS the last project but
// deliberately does not open it — the page always starts in the library.

import { listProjects, getProject, createProject, deleteProject, saveProject } from './api.js';
import { setMode } from './shell.js';
import { makeArmable } from './arm.js';
import { thumbImg } from './chars.js';
import { openDressPopup } from './dress-popup.js';
import { openEnvPopup, openEnvFly, closeEnvFly, flySoonClose } from './env-popup.js';
import { openMixPopup } from './mix-popup.js';
import { openMontageForVoice } from './montage.js';

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
  _paintCasting();
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
    _paintCasting();
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

// The character slot shows the chosen look as a THUMBNAIL, or a placeholder plus
// the gender lock the popup honours.
function _paintCasting() {
  const slot = $('sv3-slot-character');
  const note = $('sv3-slot-character-note');
  if (!slot || !note) return;

  const cast = (_current && _current.casting) || {};
  const img  = cast.obrazImage || '';

  slot.querySelectorAll('img, .sv3-slot-ph').forEach(n => n.remove());
  if (img) {
    // noFit: this card crops to the portrait on the left instead of letterboxing
    slot.insertBefore(thumbImg(img, null, { noFit: true }), note);   // thumbnail only
    note.textContent = cast.characterName || '';
  } else {
    const ph = document.createElement('div');
    ph.className = 'sv3-slot-ph';
    ph.textContent = '+';
    slot.insertBefore(ph, note);
    note.textContent = _current && _current.gender ? `${_current.gender} only` : 'pick a character';
  }

  // Location card: the image fills it, no caption.
  const lslot = $('sv3-slot-location');
  if (lslot) {
    const limg = cast.locationImage || '';
    lslot.querySelectorAll('img, .sv3-slot-ph').forEach(n => n.remove());
    if (limg) {
      lslot.appendChild(thumbImg(limg, null, { noFit: true }));
    } else {
      const ph = document.createElement('div');
      ph.className = 'sv3-slot-ph';
      ph.textContent = '+';
      lslot.appendChild(ph);
    }
  }
}

export function initProjects() {
  const sel = $('sv3-project');
  if (sel) {
    sel.addEventListener('change', () => {
      _syncDel();
      if (sel.value) openProject(sel.value);
    });
  }

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

  // Clicking the character card opens the dress popup. It commits only when a
  // look is clicked in its gallery, and hands the casting back here.
  const charSlot = $('sv3-slot-character');
  if (charSlot) {
    charSlot.addEventListener('click', () => {
      if (!_current) return;
      openDressPopup({
        project: _current,
        onCommit: async (casting) => {
          try {
            await patchProject({ casting: { ...(_current.casting || {}), ...casting } });
            _paintCasting();
            _status('Casting updated.', 'ok');
          } catch (e) { _status('Could not save the casting: ' + e.message, 'err'); }
        },
      });
    });
  }

  // Location: hovering offers the saved environments for a one-click pick; the
  // flyout's "+" opens the full popup, where Save is what commits.
  const locSlot = $('sv3-slot-location');
  if (locSlot) {
    const commit = async (casting, msg) => {
      try {
        await patchProject({ casting: { ...(_current.casting || {}), ...casting } });
        _paintCasting();
        _status(msg, 'ok');
      } catch (e) { _status('Could not save the location: ' + e.message, 'err'); }
    };
    const openPopup = () => openEnvPopup({
      project: _current,
      onCommit: (casting) => commit(casting, 'Location updated.'),
    });

    locSlot.addEventListener('mouseenter', () => {
      if (!_current) return;
      openEnvFly(locSlot, {
        current: (_current.casting || {}).locationImage || '',
        onPick: (path) => commit({ locationId: '', locationImage: path }, 'Location updated.'),
        onPlus: openPopup,
      });
    });
    locSlot.addEventListener('mouseleave', flySoonClose);
    // clicking the card itself goes straight to the popup
    locSlot.addEventListener('click', () => { if (!_current) return; closeEnvFly(); openPopup(); });
  }

  // Build mix — the first-frame workspace. Its whole state lives on the project,
  // so this just hands the current one over.
  const mixBtn = $('sv3-mix');
  if (mixBtn) {
    mixBtn.addEventListener('click', () => {
      if (!_current) return;
      openMixPopup({
        project: _current,
        // Save rewrote the fragments' frame assignments, so tell the columns that
        // render project content to repaint. patchProject deliberately does NOT
        // emit on its own — the Fragments column autosaves on every keystroke and
        // a re-render there would yank the caret.
        //
        // Save is also the moment the casting work is finished, so the page moves on:
        // that column folds away and Montage takes over with the voice read.
        onSaved: () => { _paintCasting(); _emit(); openMontageForVoice(); },
      });
    });
  }

  // Only ugc_ad is selectable; the other entries are disabled placeholders, so
  // a stray change just snaps back.
  const type = $('sv3-type');
  if (type) type.addEventListener('change', () => { type.value = 'ugc_ad'; });

  // Land straight in the newest project when one exists — however empty it is —
  // so reloading the page after a change does not mean making a project again.
  // With no projects at all the page stays in the library.
  return reloadProjects().then(() => {
    if (_projects.length) return openProject(_projects[0].id);
  });
}
