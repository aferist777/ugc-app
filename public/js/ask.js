/* ═══════════════════════════════════════════════════════════════════════════
   "ARE YOU SURE?", anchored to the button that asked - ONE module for every page (phase V73 block 2, step 2b: it was
   js/merge-v3/ask.js, which now only passes this on; its look is the shared part in css/app-shell.css, so the Library,
   Home and Admin, which never load merge-v3.css, ask the same way).

     askDelete(anchor, text, sub, onYes, yes)   Cancel · the verb in red
     askChoice(anchor, text, sub, choices, o)   several answers
     note(anchor, text, sub, o)                 something said, "Got it"
     ask(anchor, q, o) -> Promise<boolean>      a question that WAITS for its answer - the browser's confirm() of the
                                                pages before 2b; true on the verb, false on Cancel, Escape, a press away

   The chrome is the talking-head timeline's, down to the class names: a narrow strip that
   opens above the X, Yes coloured as the destructive answer and No plain. Two editors on one
   page asking the same question two different ways is the kind of difference that reads as
   two different programs.

   A popup rather than an armed second click. An armed button says nothing about what it is
   about to remove, and on lanes that look alike - four video tracks, four audio tracks
   mirrored - that is exactly the thing worth saying.

   The one addition is a SECOND LINE for a consequence. The other timeline never needs it:
   removing a clip there removes that clip. Here a picture takes its sound with it and a video
   track takes its audio track, and a person who finds that out afterwards has lost work they
   did not offer up.

   (phase V73 block 2) The look is the shared part `.u-ask.is-float` (css/app-shell.css): the question in <b>, what goes
   with it in <p>, the answers as the shared buttons - Cancel LEFT, the verb right (б2-4, б2-8); the red fill only on an
   answer that deletes or throws away (`kind: 'danger'`, б2-5) - `kind: 'yes'` is the answer meant, a plain button.
   ═══════════════════════════════════════════════════════════════════════════ */

import * as Layers from './layers.js';
import { hint } from './bubble.js';

let _ask = null;

export function closeAsk() {
  if (!_ask) return;
  const a = _ask;
  _ask = null;
  a.el.remove();
  document.removeEventListener('mousedown', a.away, true);
  Layers.close(a.layer);
  window.removeEventListener('scroll', closeAsk, true);
  // Closed without an answer (Escape, a press away, another question): a question that waits hears "no".
  if (!a.answered && typeof a.onClose === 'function') a.onClose();
}

/** A name, cut to something a one-line question can carry. */
export const short = (s, n = 20) => {
  const t = String(s || '').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
};

/**
 * Ask before removing something.
 * @param anchor  the element the question belongs to - it opens above it
 * @param text    the question, short enough for one line
 * @param sub     what else goes with it, or '' when nothing does
 * @param onYes   called only on Yes
 */
/**
 * The panel itself. Two things are asked with it - a question with an answer, and a note with
 * nothing to answer - and they differ only in the buttons, so they share everything else:
 * where it opens, what dismisses it, and which keys it swallows on the way past.
 */
function _panel(anchor, text, sub, buttons, opts) {
  closeAsk();

  const el = document.createElement('div');
  // (б2-7) a list - the projects a file is used in, the names to delete - makes the question wider, the list scrolling inside
  const wide = Array.isArray(sub) || String(sub || '').length > 160;
  el.className = 'mv3-ask u-ask is-float' + (sub ? ' has-sub' : '') + (wide ? ' is-wide' : '');
  const t = document.createElement('b');
  t.className = 'mv3-ask-t';
  t.textContent = text;
  el.appendChild(t);
  if (sub) {
    const s = document.createElement('p');
    s.className = 'mv3-ask-s';
    // A list - one thing per line (phase V23: what `generate all` will do, stage by stage).
    if (Array.isArray(sub)) { s.classList.add('is-lines'); s.textContent = sub.join('\n'); }
    else s.textContent = sub;
    el.appendChild(s);
  }

  // The answers in a row of their own under the question: Cancel first (worded so), the rest in
  // their order, the one meant and the one that deletes last. `made` keeps the order they were given in.
  const row = document.createElement('div');
  row.className = 'mv3-ask-r u-ask-r';
  const rank = (b) => (/^(cancel|no|not now)$/i.test(String(b.label).trim()) ? 0 : b.kind === 'danger' ? 3 : b.kind === 'yes' ? 2 : 1);
  const made = buttons.map(b => {
    const el2 = document.createElement('button');
    el2.type = 'button';
    el2.className = 'mv3-ask-b u-btn is-s' + (b.kind === 'danger' ? ' is-danger is-armed' : '');
    el2.dataset.rank = String(rank(b));
    el2.textContent = b.label;
    // (phase V67, second round (г)) What an answer does, in the app's bubble on hover - "new project" says what becomes of both.
    if (b.hint) hint(el2, b.hint, { side: 'below' });
    // On mousedown, and swallowed: a click here must not reach the lane underneath, where it
    // would start a drag or a selection band on the way to answering a question.
    el2.addEventListener('mousedown', (e) => {
      e.preventDefault(); e.stopPropagation();
      if (_ask) _ask.answered = true;
      closeAsk();
      if (b.on) b.on();
    });
    return el2;
  });
  [...made].sort((a, b) => +a.dataset.rank - +b.dataset.rank).forEach(b => row.appendChild(b));
  el.appendChild(row);

  document.body.appendChild(el);

  // Fixed to the viewport and parked on the body: inside a lane the timeline's own scrolling
  // would clip it, and a lane is 24px tall - there is no room to open into. Above the anchor
  // by preference, below it when the timeline is near the top of the screen.
  // No anchor on the page any more (a key pressed, a menu gone): in the middle, a third of the way down.
  const r = (anchor && anchor.isConnected) ? anchor.getBoundingClientRect()
    : { left: window.innerWidth / 2, width: 0, top: window.innerHeight * 0.3, bottom: window.innerHeight * 0.3 };
  const w = el.offsetWidth, h = el.offsetHeight;
  const left = Math.max(6, Math.min(window.innerWidth - w - 6, r.left + r.width / 2 - w / 2));
  const above = r.top - h - 6;
  el.style.left = Math.round(left) + 'px';
  el.style.top = Math.round(above >= 6 ? above : r.bottom + 6) + 'px';

  const away = (e) => { if (!el.contains(e.target)) closeAsk(); };
  // Modal, which is what keeps the timeline's own Delete from answering this question from
  // behind - the reason this used to swallow Delete itself (js/layers.js).
  const layer = Layers.open(el, { name: 'ask', onEsc: closeAsk });
  _ask = { el, away, layer, answered: false, onClose: opts && opts.onClose };
  document.addEventListener('mousedown', away, true);
  // A note that says what was LOST stays until it is read (`stay`): the scrolling that follows a new pick - the
  // strip painted again, the timeline bringing the pick into view - closed it before anyone saw it.
  if (!(opts && opts.stay)) window.addEventListener('scroll', closeAsk, true);
  return made;
}

// The answer says the question's verb (б2-4): "Delete X?" - Delete, "Remove X?" - Remove, "Take X out…?" - Take out,
// "Replace…?" - Replace; `yes` names it where the question starts otherwise.
const VERBS = { delete: 'Delete', remove: 'Remove', take: 'Take out', replace: 'Replace', clear: 'Clear', discard: 'Discard' };

export function askDelete(anchor, text, sub, onYes, yes) {
  const first = (/^\s*([A-Za-z]+)/.exec(String(text || '')) || [])[1] || '';
  _panel(anchor, text, sub, [
    { label: 'Cancel' },
    { label: yes || VERBS[first.toLowerCase()] || 'Delete', kind: 'danger', on: onYes },
  ]);
}

/**
 * A question with more than two answers (phase C3: delete the timeline only, or its files too). `choices`:
 * [{ label, kind: 'danger' (deletes - in red) | 'yes' (the one meant) | undefined, on, hint? }]; a choice without `on` only
 * closes - "Cancel" goes left; `hint` -
 * words in a bubble over it on hover (phase V67).
 * `opts.stay` - not closed by scrolling (an anchor that does not scroll: the project bar). `sub` may be a list of lines.
 */
export function askChoice(anchor, text, sub, choices, opts) {
  _panel(anchor, text, sub, choices || [], opts);
}

/**
 * Something to say rather than something to ask. One button, and it only closes.
 *
 * Its own function rather than askDelete with an empty handler: a Yes/No offers a choice, and
 * offering a choice where there is none is how a button ends up meaning nothing.
 */
export function note(anchor, text, sub, opts) {
  _panel(anchor, text, sub, [{ label: 'Got it' }], opts);
}

/**
 * A question that WAITS for its answer (phase V73 block 2, step 2b) - in place of the browser's confirm(): resolves true on
 * the verb, false on Cancel, Escape, a press away or another question opened over it.
 *   q   the question; a text of several lines (\n) is its first line as the question and the rest under it - a long list
 *       (the projects a file is used in, the names to delete) scrolls inside a wider question (б2-7)
 *   o   { yes: the verb (б2-4; by default the question's own first word - "Delete 3 items?" -> "Delete 3"),
 *         danger: it deletes or throws away - the red fill (б2-5; a paid answer is a plain button),
 *         lines: what goes with it (in place of the text's own), stay: not closed by scrolling }
 * The anchor is the button pressed - or the tile a menu was about, or the last one picked (б2-6).
 */
export function ask(anchor, q, o) {
  const opt = o || {};
  let title = String(q || '').trim();
  let lines = opt.lines;
  if (lines == null && title.includes('\n')) {
    const parts = title.split('\n');
    title = parts.shift().trim();
    while (parts.length && !parts[0].trim()) parts.shift();
    while (parts.length && !parts[parts.length - 1].trim()) parts.pop();
    lines = parts;
  }
  const m = /^\s*([A-Za-z]+)(\s+\d+)?/.exec(title) || [];
  const verb = opt.yes || ((VERBS[String(m[1] || '').toLowerCase()] || 'OK') + (m[2] && VERBS[String(m[1] || '').toLowerCase()] ? m[2] : ''));
  return new Promise((resolve) => {
    let done = false;
    const fin = (v) => { if (!done) { done = true; resolve(v); } };
    _panel(anchor, title, lines && lines.length ? lines : '', [
      { label: 'Cancel', on: () => fin(false) },
      { label: verb, kind: opt.danger ? 'danger' : 'yes', on: () => fin(true) },
    ], { stay: opt.stay, onClose: () => fin(false) });
  });
}
