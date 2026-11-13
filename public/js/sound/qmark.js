/* ═══════════════════════════════════════════════════════════════════════════
   THE "?" OF A PARAMETER - ONE rule for the sound
   window of both pages (js/sound/sound-window.js), the form in it (js/sound/suno-form.js) and the almanac.

   A small "?" right of a parameter's name. The pointer resting on it opens a popup - what the parameter is and how to use
   it. The popup is THE APP'S BUBBLE (js/bubble.js): over the "?", its tail pointing at it - how it opens and goes is said there. A press
   on the "?" itself does nothing else: inside a button, a <summary> or a <label> it neither folds, unfolds nor ticks.

     qmark(text, o)        the "?" - `text` a string (paragraphs by "\n") or a function giving one when it opens;
                           o.title - the popup's gold heading
     withQ(node, text, o)  the "?" put at the end of `node` (a row's name); node returned
     closeQ()              the popup open, closed
   ═══════════════════════════════════════════════════════════════════════════ */

import { hint, showBubble, closeBubble } from '../bubble.js';

export const closeQ = closeBubble;

/** The "?" - its popup opens on the pointer resting on it. */
export function qmark(text, o) {
  const opts = o || {};
  const q = document.createElement('span');
  q.className = 'qm';
  q.textContent = '?';
  q.setAttribute('aria-label', typeof text === 'string' ? text : 'help');
  hint(q, text, { title: opts.title, on: 'is-on' });
  // A press on it is its own: nothing under it folds, unfolds, ticks or is chosen. Without a pointer that rests (a touch) it
  // opens the popup.
  q.addEventListener('mousedown', (e) => { e.stopPropagation(); });
  q.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); showBubble(q, text, { title: opts.title, on: 'is-on' }); });
  return q;
}

/** The "?" at the end of `node`; `node` back. No text - no "?". */
export function withQ(node, text, o) {
  if (node && text) node.appendChild(qmark(text, o));
  return node;
}
