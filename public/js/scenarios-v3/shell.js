// Scenarios v3 — column shell: which of the three columns are open, and how the
// page moves between "library" and "workspace".
//
//   library   — Scenario full width (the 3-pane library); the other two are
//               collapsed AND gated: they need a project before they mean
//               anything, so Create project is the only way in.
//   workspace — Scenario collapsed to its spine; Montage + Fragments open.
//
// There used to be a fourth, Casting, holding the two cards that say who and where.
// It was a waiting room: a step that showed nothing and had to be left before the
// work began. Its two frames now sit at the top of Montage, above the voice list they
// were always feeding.
//
// Clicking the collapsed Scenario spine goes back to library mode without
// losing the open project.

const OPEN_BY_MODE = {
  library:   ['scenario'],
  workspace: ['montage', 'fragments'],
};

const ALL = ['scenario', 'montage', 'fragments'];

const col = (name) => document.getElementById(`sv3-${name}`);

let _mode = 'library';
const _listeners = [];

export const onModeChange = (fn) => { _listeners.push(fn); };

export function setMode(mode) {
  _mode = OPEN_BY_MODE[mode] ? mode : 'library';
  const open = OPEN_BY_MODE[_mode];
  ALL.forEach(name => {
    const el = col(name);
    if (el) el.classList.toggle('is-collapsed', !open.includes(name));
  });
  document.body.dataset.mode = _mode;
  _listeners.forEach(fn => { try { fn(_mode); } catch (e) { console.error('[sv3] mode listener', e); } });
}

// Open one of the workspace columns. Nothing has to fold to make room any more: with
// Casting gone there is no second column competing for the same width.
export function openColumn(name) {
  const el = col(name);
  if (el) el.classList.remove('is-collapsed');
}

// A collapsed spine opens its column. Scenario is special: it returns the page
// to library mode rather than sitting open next to the workspace columns.
export function initShell() {
  ALL.forEach(name => {
    const el = col(name);
    if (!el) return;
    el.addEventListener('click', (e) => {
      if (!el.classList.contains('is-collapsed')) return;      // only the spine is clickable
      if (_mode === 'library' && name !== 'scenario') return;  // gated until a project exists
      e.stopPropagation();
      if (name === 'scenario') setMode('library');
      else openColumn(name);
    });
  });
  setMode('library');
}
