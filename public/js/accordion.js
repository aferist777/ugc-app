// ACCORDION — one open column, the rest folded into clickable spines.
//
// The idiom the app is settling on: a job with steps becomes a row of columns, and the ones you
// are not in fold to a labelled spine on the left. Going back is clicking a spine; the work in
// the deeper columns is not thrown away by folding it, only hidden, so returning finds it as you
// left it.
//
// WHY THIS IS ITS OWN FILE. The Scenarios page grew its own version of this
// with a mode → open-columns map, which is right for a page that opens two columns at once. This
// is the simpler and more general shape - exactly one column open, levels in order - and it is
// written to be lifted into the next page rather than copied out of this one.
//
// It owns exactly two things: which level is open, and whether the whole thing is locked. What a
// column CONTAINS is the caller's business; this never touches it.

const LEVEL_ATTR = 'data-level';

/**
 * @param {object} o
 * @param {HTMLElement} o.root      the columns container
 * @param {string[]} o.levels       column element ids, shallow to deep
 * @param {function} [o.onOpen]     (levelIndex, id) after a level opens
 * @param {function} [o.canLeave]   (fromIndex, toIndex) -> true to allow; used to refuse a
 *                                  spine click while something is generating
 */
export function createAccordion({ root, levels, onOpen, canLeave }) {
  if (!root || !Array.isArray(levels) || !levels.length) {
    throw new Error('createAccordion needs a root and at least one level');
  }
  const els = levels.map(id => document.getElementById(id));
  els.forEach((el, i) => {
    if (!el) throw new Error(`accordion: no element #${levels[i]}`);
    el.setAttribute(LEVEL_ATTR, String(i));
  });

  let _open = 0;
  let _locked = false;
  // How deep the user has actually been. A spine for a level nobody has reached is a door to an
  // empty room, so unreached levels are hidden rather than folded.
  let _reached = 0;

  function paint() {
    els.forEach((el, i) => {
      el.classList.toggle('is-collapsed', i !== _open);
      el.hidden = i > _reached;
      el.classList.toggle('is-locked', _locked);
    });
    root.dataset.level = String(_open);
    root.classList.toggle('is-locked', _locked);
  }

  function open(level) {
    const i = typeof level === 'number' ? level : levels.indexOf(String(level));
    if (i < 0 || i >= els.length) return false;
    if (i === _open) return true;
    // A refusal has to be the caller's call: only it knows whether a generation is in flight.
    if (canLeave && !canLeave(_open, i)) return false;
    _open = i;
    if (i > _reached) _reached = i;
    paint();
    if (onOpen) onOpen(i, levels[i]);
    return true;
  }

  // Going back does NOT forget the deeper columns - their content stays in the DOM, which is the
  // whole point of folding instead of closing.
  function reset(level = 0) {
    _open = Math.max(0, Math.min(els.length - 1, level));
    _reached = _open;
    paint();
    if (onOpen) onOpen(_open, levels[_open]);
  }

  function lock(on) {
    _locked = !!on;
    paint();
  }

  // The spine is the only clickable part of a folded column: a click anywhere inside an open one
  // belongs to whatever is in it.
  els.forEach((el, i) => {
    el.addEventListener('click', (e) => {
      if (!el.classList.contains('is-collapsed')) return;
      if (_locked) { e.stopPropagation(); return; }
      e.stopPropagation();
      open(i);
    });
  });

  function setSpine(level, text) {
    const i = typeof level === 'number' ? level : levels.indexOf(String(level));
    const el = els[i];
    if (!el) return;
    const spine = el.querySelector('.l2-spine');
    if (spine) spine.textContent = text;
  }

  paint();
  return { open, reset, lock, setSpine, level: () => _open, locked: () => _locked };
}
