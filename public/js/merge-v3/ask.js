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

let _ask = null;

export function closeAsk() {
  if (!_ask) return;
  _ask.el.remove();
  document.removeEventListener('mousedown', _ask.away, true);
  document.removeEventListener('keydown', _ask.key, true);
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
export function askDelete(anchor, text, sub, onYes) {
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
    s.textContent = sub;
    el.appendChild(s);
  }

  const yes = document.createElement('button');
  yes.type = 'button'; yes.className = 'mv3-ask-b is-yes'; yes.textContent = 'Yes';
  const no = document.createElement('button');
  no.type = 'button'; no.className = 'mv3-ask-b'; no.textContent = 'No';
  // With a consequence line the buttons need a row of their own; without one they sit in the
  // strip beside the question exactly as they do on the other timeline. `display:contents`
  // makes the wrapper vanish in that case, so there is one DOM shape and two layouts.
  const row = document.createElement('span');
  row.className = 'mv3-ask-r';
  row.append(yes, no);
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
  const key = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeAsk(); }
    // Delete and Backspace are wired to the timeline's own delete. With the question open they
    // would answer it from behind, which is the one thing this is here to stop.
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); e.stopPropagation(); }
  };
  _ask = { el, away, key };
  document.addEventListener('mousedown', away, true);
  document.addEventListener('keydown', key, true);
  window.addEventListener('scroll', closeAsk, true);

  // On mousedown, and swallowed: a click here must not reach the lane underneath, where it
  // would start a drag or a selection band on the way to answering a question.
  yes.addEventListener('mousedown', (e) => {
    e.preventDefault(); e.stopPropagation();
    closeAsk();
    onYes();
  });
  no.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); closeAsk(); });
}
