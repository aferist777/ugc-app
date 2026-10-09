/* ═══════════════════════════════════════════════════════════════════════════
   MERGE v3 — "are you sure?", anchored to the button that asked.

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
   ═══════════════════════════════════════════════════════════════════════════ */

import * as Layers from '../layers.js';

let _ask = null;

export function closeAsk() {
  if (!_ask) return;
  _ask.el.remove();
  document.removeEventListener('mousedown', _ask.away, true);
  Layers.close(_ask.layer);
  window.removeEventListener('scroll', closeAsk, true);
  _ask = null;
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
  el.className = 'mv3-ask' + (sub ? ' has-sub' : '');
  const t = document.createElement('span');
  t.className = 'mv3-ask-t';
  t.textContent = text;
  el.appendChild(t);
  if (sub) {
    const s = document.createElement('span');
    s.className = 'mv3-ask-s';
    // A list - one thing per line (phase V23: what `generate all` will do, stage by stage).
    if (Array.isArray(sub)) { s.classList.add('is-lines'); s.textContent = sub.join('\n'); }
    else s.textContent = sub;
    el.appendChild(s);
  }

  // With a consequence line the buttons need a row of their own; without one they sit in the
  // strip beside the question exactly as they do on the other timeline. `display:contents`
  // makes the wrapper vanish in that case, so there is one DOM shape and two layouts.
  const row = document.createElement('span');
  row.className = 'mv3-ask-r';
  const made = buttons.map(b => {
    const el2 = document.createElement('button');
    el2.type = 'button';
    el2.className = 'mv3-ask-b' + (b.kind === 'yes' ? ' is-yes' : '');
    el2.textContent = b.label;
    // On mousedown, and swallowed: a click here must not reach the lane underneath, where it
    // would start a drag or a selection band on the way to answering a question.
    el2.addEventListener('mousedown', (e) => {
      e.preventDefault(); e.stopPropagation();
      closeAsk();
      if (b.on) b.on();
    });
    row.appendChild(el2);
    return el2;
  });
  el.appendChild(row);

  document.body.appendChild(el);

  // Fixed to the viewport and parked on the body: inside a lane the timeline's own scrolling
  // would clip it, and a lane is 24px tall - there is no room to open into. Above the anchor
  // by preference, below it when the timeline is near the top of the screen.
  const r = anchor.getBoundingClientRect();
  const w = el.offsetWidth, h = el.offsetHeight;
  const left = Math.max(6, Math.min(window.innerWidth - w - 6, r.left + r.width / 2 - w / 2));
  const above = r.top - h - 6;
  el.style.left = Math.round(left) + 'px';
  el.style.top = Math.round(above >= 6 ? above : r.bottom + 6) + 'px';

  const away = (e) => { if (!el.contains(e.target)) closeAsk(); };
  // Modal, which is what keeps the timeline's own Delete from answering this question from
  // behind - the reason this used to swallow Delete itself (js/layers.js).
  const layer = Layers.open(el, { name: 'ask', onEsc: closeAsk });
  _ask = { el, away, layer };
  document.addEventListener('mousedown', away, true);
  // A note that says what was LOST stays until it is read (`stay`): the scrolling that follows a new pick - the
  // strip painted again, the timeline bringing the pick into view - closed it before anyone saw it.
  if (!(opts && opts.stay)) window.addEventListener('scroll', closeAsk, true);
  return made;
}

export function askDelete(anchor, text, sub, onYes) {
  _panel(anchor, text, sub, [
    { label: 'Yes', kind: 'yes', on: onYes },
    { label: 'No' },
  ]);
}

/**
 * A question with more than two answers (phase C3: delete the timeline only, or its files too). `choices`:
 * [{ label, kind: 'yes' (the destructive one, in red) | undefined, on }]; a choice without `on` only closes.
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
