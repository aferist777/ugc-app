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
    if (!clean) { _note('a name is needed - projects cannot be renamed later'); return; }

    b.disabled = true;
    _note('creating…');
    try {
      const d = await fetch('/api/mv3/timeline/new', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: clean }),
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
