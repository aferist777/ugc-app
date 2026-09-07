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
   ═══════════════════════════════════════════════════════════════════════════ */

import * as Store from './store.js';

function _sel() { return document.getElementById('mv3-project'); }
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
  let list = [];
  try { list = await Store.list(); } catch (e) { _note(e.message); return; }
  sel.textContent = '';
  for (const p of list) {
    const o = document.createElement('option');
    o.value = p.key;
    // Clip count in the label because two projects from the same day are otherwise told
    // apart only by their title, and imported titles all start with the date.
    o.textContent = p.title + (p.clips ? ' · ' + p.clips : '') + (p.createdAt ? ' · ' + _fmtDate(p.createdAt) : '');
    sel.appendChild(o);
  }
  // With nothing open the picker must SAY so. Left alone it would show the first project in
  // the list, which reads as "this one is open" when it is not.
  const open = Store.key();
  if (open) {
    sel.value = open;
    _note('');
  } else {
    const o = document.createElement('option');
    o.value = '';
    o.textContent = '— choose a project —';
    sel.insertBefore(o, sel.firstChild);
    sel.value = '';
    _note(list.length ? 'nothing open yet' : 'no projects yet');
  }
}

export function initProjects() {
  const sel = _sel();
  if (!sel) return;
  sel.addEventListener('change', async () => {
    const want = sel.value;
    if (!want) return;              // the "choose a project" placeholder
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
    if (k === last) return;
    last = k;
    _paint();
    _disarm();          // a different project means the armed delete no longer applies
    _cancelRename();    // and that a half-typed name belongs to a project no longer open
  });
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
  b.addEventListener('click', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const title = prompt('Name for the new project:', today + ' - ');
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
      _note('');
    } catch (e) {
      _note(e.message);
    } finally {
      b.disabled = false;
    }
  });
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
  if (b) b.textContent = 'edit';
  _note('');
}

async function _saveRename() {
  const box = document.getElementById('mv3-project-name');
  const key = Store.key();
  if (!box || !key) return _cancelRename();
  const title = box.value.trim();
  if (!title) { _note('a name is needed'); box.focus(); return; }
  if (title === Store.title()) return _cancelRename();

  _note('renaming…');
  try {
    const r = await fetch('/api/mv3/timeline/' + encodeURIComponent(key) + '/title', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    });
    const d = await r.json();
    // A name already taken is not a failure to be swept away - the box stays open with what
    // was typed still in it, because the next thing to do is change one word of it.
    if (!d || !d.success) { _note(d && d.error ? d.error : 'refused'); box.focus(); box.select(); return; }
    Store.setTitle(d.title);
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
    _editing = true;
    box.value = Store.title() || '';
    box.hidden = false;
    sel.hidden = true;
    b.textContent = 'save';
    box.focus();
    box.select();
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
  if (b) { b.textContent = 'delete'; b.classList.remove('is-armed'); }
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
    const key = Store.key();
    if (!key) return;
    _note('deleting…');
    try {
      const d = await fetch('/api/mv3/timeline/' + encodeURIComponent(key), { method: 'DELETE' }).then(r => r.json());
      if (!d || !d.success) throw new Error((d && d.error) || 'refused');
      _note('');
      // Back to nothing open rather than to whatever is left. Deleting a project and finding
      // yourself editing a different one is how the wrong video gets edited.
      await Store.openBlank();
    } catch (e) { _note(e.message); }
  });
}
