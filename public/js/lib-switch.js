// THE GALLERY PICKER — which library you are in, above the shelves.
//
// There is more than one library and no way to get between them. /library2 links back to
// /library, but /library has never linked forward: from the Library page the writing
// workshop is unreachable except by typing the address. That was survivable while there
// were two; it stops being survivable the moment there is a third.
//
// So the list lives HERE, once, and both pages mount the same control. Adding a library is
// one line in LIBRARIES and nothing else - no markup to copy into a second page, and no
// chance of the two pages disagreeing about what exists.
//
// A <select> rather than a row of tabs: this is a jump to another page, not a filter over
// what is on this one. The shelves below are tabs and look like tabs; making the gallery
// picker look the same would say the two do the same kind of thing.

const LIBRARIES = [
  { path: '/library',  label: 'Library' },
  { path: '/library2', label: 'Library 2' },
];

// Trailing slashes are stripped because /library and /library/ are the same page and only
// one of them would ever match.
const _norm = (p) => String(p || '').replace(/\/+$/, '') || '/';

export function mountLibSwitch(host) {
  if (!host) return;
  const here = _norm(location.pathname);

  const wrap = document.createElement('div');
  wrap.className = 'lib-switch';

  const sel = document.createElement('select');
  sel.id = 'lib-switch';
  sel.title = 'Which library you are looking at';
  for (const l of LIBRARIES) {
    const o = document.createElement('option');
    o.value = l.path;
    o.textContent = l.label;
    if (_norm(l.path) === here) o.selected = true;
    sel.appendChild(o);
  }
  // Navigating away IS the action, so there is nothing to undo and nothing to confirm.
  // Reverting the select first matters anyway: come back with the browser's Back button
  // and a restored page would otherwise show the picker pointing at where you went.
  sel.addEventListener('change', () => {
    const to = sel.value;
    sel.value = LIBRARIES.find(l => _norm(l.path) === here) ? here : LIBRARIES[0].path;
    if (_norm(to) !== here) location.href = to;
  });

  wrap.appendChild(sel);
  host.prepend(wrap);
}
