/* ════════════════════════════════════════════════════════════════════════════
   WHICH WINDOW THE KEYBOARD BELONGS TO.

   A page is one document, and every window on it - the render dialog, the picture
   window, a question, a menu - is a div over the rest of it. The keyboard does not
   know that. Space plays the preview because the preview asked the DOCUMENT for
   Space, and it keeps doing that with a dialog open on top, which is how pressing
   Space to type a space in a field starts playback underneath.

   So the page keeps a STACK of what is open, and there is one rule:

       the keyboard belongs to the topmost layer.

   Two kinds of layer, because they want different things:

     modal (default)  a window. While one is open the page's own shortcuts - Space,
                      Delete, Ctrl+Z - do nothing at all. Typing is untouched: this
                      never swallows ordinary keys, it only stops the shortcuts.
     menu             a dropdown or a popover, and the enlarged preview: Escape
                      closes it first, but the page keeps its shortcuts, because
                      Space over an enlarged preview means play, not nothing.

   Escape is handled here rather than by each window, and only the top one hears it -
   the reason the enlarged preview and the picture window used to fight over whose
   Escape it was. A window that refuses to close (a render in flight) still consumes
   it: what is on top decides, including deciding to do nothing.

   Everything else a window wants from the keyboard stays its own - it asks topIs()
   so a window underneath another one stops answering.
   ════════════════════════════════════════════════════════════════════════════ */

const _stack = [];
let _wired = false;

function _onKey(e) {
  if (!_stack.length) return;
  if (e.key !== 'Escape') return;
  const top = _stack[_stack.length - 1];
  e.preventDefault();
  // Immediate: nothing below this listener sees the key, including the page's own
  // Escape - the one that clears the timeline selection.
  e.stopImmediatePropagation();
  if (top.onEsc) { try { top.onEsc(); } catch (err) { console.warn('[layers] onEsc:', err); } }
}

function _wire() {
  if (_wired) return;
  // Captured, so this runs before anything the page or a window bound on the way down.
  document.addEventListener('keydown', _onKey, true);
  _wired = true;
}

/**
 * Put a layer on the stack.
 *
 * @param el       the layer's element - kept for debugging and for `top()`, not required
 * @param opts     { modal = true, onEsc, name }
 * @returns        the handle to hand back to close()
 */
export function open(el, opts) {
  const o = opts || {};
  _wire();
  const layer = {
    el: el || null,
    modal: o.modal !== false,
    onEsc: typeof o.onEsc === 'function' ? o.onEsc : null,
    name: String(o.name || ''),
  };
  _stack.push(layer);
  return layer;
}

/**
 * Take a layer off. By IDENTITY, not "remove the last one": a window can be closed
 * by a click outside it while another is open above, and popping the top there would
 * close the wrong thing.
 */
export function close(handle) {
  const i = _stack.indexOf(handle);
  if (i >= 0) _stack.splice(i, 1);
}

/** Is a modal window open? The one question the page's own shortcuts ask. */
export function blocked() {
  return _stack.some((l) => l.modal);
}

/** Is this layer the top one? What a window asks before acting on a key of its own. */
export function topIs(handle) {
  return _stack.length > 0 && _stack[_stack.length - 1] === handle;
}

/** The topmost layer, or null. */
export function top() {
  return _stack.length ? _stack[_stack.length - 1] : null;
}

