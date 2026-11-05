/* ═══════════════════════════════════════════════════════════════════════════
   THE PAGES' FIGURES (phase V73 block 5; the owner's (к21а), (б1-15), (б5-21) а): every time, length, price and count is
   drawn in mono, like a timecode, and a thousand reads "1,563". One place for both:

   - `int(n)`          a whole number with the thousands marked: 4500 -> "4,500";
   - `figures(text)`   a line of words with its figures in mono - a fragment of text nodes and `.u-mono` spans
                       (css/app-shell.css), to be put into a button, a label or a status line;
   - `setFigures(el, text)` the same, in place of what `el` held.

   Only the digits change their face: the words around them stay in the interface's font.
   ═══════════════════════════════════════════════════════════════════════════ */

/** A whole number, thousands marked as "1,563". */
export function int(n) {
  const v = Math.round(Number(n) || 0);
  return v.toLocaleString('en-US');
}

// A run of figures: digits with the separators that belong between them ("1,563", "0:12.3", "2/5", "12.34").
const RUN = /(\d+(?:[.,:/]\d+)*)/;

/** `text` as a fragment: its runs of figures in `.u-mono` spans, the rest as text. */
export function figures(text) {
  const frag = document.createDocumentFragment();
  for (const part of String(text == null ? '' : text).split(RUN)) {
    if (!part) continue;
    if (/^\d/.test(part)) {
      const s = document.createElement('span');
      s.className = 'u-mono';
      s.textContent = part;
      frag.appendChild(s);
    } else frag.appendChild(document.createTextNode(part));
  }
  return frag;
}

/** Put `text` into `el` with its figures in mono, in place of what it held. */
export function setFigures(el, text) {
  if (!el) return el;
  el.textContent = '';
  el.appendChild(figures(text));
  return el;
}
