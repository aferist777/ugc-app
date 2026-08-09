// Scenarios v3 — column shell: which of the four columns are open, and how the
// page moves between "library" and "workspace".
//
//   library   — Scenario full width (the 3-pane library); the other three are
//               collapsed AND gated: they need a project before they mean
//               anything, so Create project is the only way in.
//   workspace — Scenario collapsed to its spine; Casting + Fragments open;
//               Montage stays collapsed until the user clicks it.
//
// Clicking the collapsed Scenario spine goes back to library mode without
// losing the open project.

const OPEN_BY_MODE = {
  library:   ['scenario'],
  workspace: ['casting', 'fragments'],
};

const ALL = ['scenario', 'casting', 'montage', 'fragments'];

const col = (name) => document.getElementById(`sv3-${name}`);

let _mode = 'library';
const _listeners = [];

export const getMode = () => _mode;
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

// Casting and Montage are two halves of the same job and are never wanted at once:
// one is where the frames are built, the other is what happens to them afterwards.
// Opening either folds the other, so the width always goes to the one in use.
const PAIRED = { casting: 'montage', montage: 'casting' };

// Open one of the workspace columns, folding whatever it displaces.
export function openColumn(name) {
  const el = col(name);
  if (!el) return;
  el.classList.remove('is-collapsed');
  const other = PAIRED[name] && col(PAIRED[name]);
  if (other) other.classList.add('is-collapsed');
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
