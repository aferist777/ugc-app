/* ════════════════════════════════════════════════════════════════════════════
   MERGE — THE PICTURES' NUMBERS IN THE FRAMES CHAT'S WORDS.

   "image 1", "image/2", "Image 3" are yellow wherever the frames chat shows words - the ideas, your words over a card,
   "sent as", read more - and in its fields - the message box, the writer's prompt -, so it is seen which pictures an idea
   or a prompt takes. The words themselves, brighter than the gold of what is chosen (css/mv3-imagen.css `.imw`).

   markText(host, text)  - the text into `host`, the numbers as `span.imw` (text nodes only, never HTML)
   markField(ta)         - a textarea gets a layer over it (`.imw-wrap` > `.imw-over`) that draws the same text in the same
                           place, transparent but the numbers - over the field's own letters, so the caret, the selection
                           and the typing stay the field's. -> { refresh() } for a value set by script; typing, scrolling
                           and a size change follow by themselves.
   ════════════════════════════════════════════════════════════════════════════ */

const WORD = /\bimages?\s*[/#]?\s*\d+\b/gi;

/** Whether `text` names a picture by its number. */
export const hasImageWords = (text) => { WORD.lastIndex = 0; return WORD.test(String(text || '')); };

function _fill(host, text) {
  const s = String(text == null ? '' : text);
  WORD.lastIndex = 0;
  let at = 0;
  let m;
  while ((m = WORD.exec(s))) {
    if (m.index > at) host.appendChild(document.createTextNode(s.slice(at, m.index)));
    const w = document.createElement('span');
    w.className = 'imw';
    w.textContent = m[0];
    host.appendChild(w);
    at = m.index + m[0].length;
  }
  if (at < s.length) host.appendChild(document.createTextNode(s.slice(at)));
}

/** `host`'s text - the pictures' numbers yellow. */
export function markText(host, text) {
  if (!host) return host;
  host.textContent = '';
  _fill(host, text);
  return host;
}

// What of the field's look the layer must share for its letters to fall on the field's own.
const COPY = ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontStretch', 'fontVariant', 'fontKerning', 'lineHeight',
  'letterSpacing', 'wordSpacing', 'textTransform', 'textIndent', 'textAlign', 'tabSize', 'whiteSpace', 'overflowWrap', 'wordBreak',
  'paddingTop', 'paddingLeft', 'paddingBottom', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
  'borderRadius', 'boxSizing', 'direction'];

/** A layer over the textarea `ta` with its pictures' numbers yellow. `ta` must be in the page. */
export function markField(ta) {
  if (!ta || !ta.parentNode) return { refresh() {} };
  if (ta._imw) return ta._imw;
  const wrap = document.createElement('div');
  wrap.className = 'imw-wrap';
  ta.parentNode.insertBefore(wrap, ta);
  wrap.appendChild(ta);
  const over = document.createElement('div');
  over.className = 'imw-over';
  over.setAttribute('aria-hidden', 'true');
  wrap.appendChild(over);

  let had = '';
  const look = () => {
    const cs = getComputedStyle(ta);
    for (const k of COPY) over.style[k] = cs[k];
    over.style.borderStyle = 'solid';
    over.style.borderColor = 'transparent';
    // A scrollbar of the field takes width from its words: the layer's words keep the same width.
    const bar = Math.max(0, ta.offsetWidth - ta.clientWidth - (parseFloat(cs.borderLeftWidth) || 0) - (parseFloat(cs.borderRightWidth) || 0));
    over.style.paddingRight = ((parseFloat(cs.paddingRight) || 0) + bar) + 'px';
  };
  const place = () => { over.scrollTop = ta.scrollTop; over.scrollLeft = ta.scrollLeft; };
  const paint = () => {
    const v = ta.value;
    if (v === had && over.childNodes.length) { place(); return; }
    had = v;
    over.textContent = '';
    if (hasImageWords(v)) {
      _fill(over, v);
      // A last empty line counts for the height the field scrolls in.
      if (/\n$/.test(v)) over.appendChild(document.createTextNode('​'));
    }
    place();
  };
  const refresh = () => { look(); paint(); };

  ta.addEventListener('input', paint);
  ta.addEventListener('scroll', place);
  ta.addEventListener('focus', refresh);
  if (window.ResizeObserver) new ResizeObserver(() => refresh()).observe(ta);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(refresh).catch(() => {});
  refresh();
  ta._imw = { refresh, wrap };
  return ta._imw;
}
