// ════════════════════════════════════════════════════════════════════════════
// THE ASSISTANT'S ANSWER AS A PAGE - a small reader of the Markdown models write, with no library: headings, lists,
// quotes, paragraphs, **bold**, *italic*, `code`, links, fenced blocks. Every character of the text is escaped first;
// only the tags written here are made.
//
// A fence whose first word is `prompt` is A PROMPT FOR A GENERATOR - the rest of its first line names the generator and
// its mode ("Seedance 2.5 · video chat") - drawn as its own block with "copy"; any other fence is code with "copy". A
// fence not closed yet (an answer still being written) is drawn as far as it goes.
//
//   render(text) -> a DocumentFragment
// ════════════════════════════════════════════════════════════════════════════

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);

// Inline: `code` first (nothing inside it is read), then links, bold, italic.
function inline(s) {
  const parts = String(s).split(/(`[^`\n]+`)/);
  return parts.map((p, i) => {
    if (i % 2) return '<code>' + esc(p.slice(1, -1)) + '</code>';
    let h = esc(p);
    h = h.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, (m, t, u) => '<a href="' + u + '" target="_blank" rel="noopener noreferrer">' + t + '</a>');
    h = h.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>').replace(/__([^_\n]+)__/g, '<strong>$1</strong>');
    h = h.replace(/(^|[^*\w])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>').replace(/(^|[^_\w])_([^_\n]+)_(?!\w)/g, '$1<em>$2</em>');
    return h;
  }).join('');
}

function _copyBtn(text, label) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'as-copy u-btn is-s is-quiet';
  b.textContent = label || 'copy';
  b.title = 'Copy it to the clipboard';
  b.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(text); b.textContent = 'copied'; }
    catch (e) { b.textContent = 'not copied'; }
    setTimeout(() => { b.textContent = label || 'copy'; }, 1400);
  });
  return b;
}

/** A copy button for any text - the answer's own, at its foot. */
export const copyButton = _copyBtn;

function _fence(lang, info, body, open) {
  const isPrompt = lang === 'prompt';
  const box = document.createElement('div');
  box.className = isPrompt ? 'as-prompt' : 'as-code';
  const head = document.createElement('div');
  head.className = 'as-fhead';
  const name = document.createElement('span');
  name.className = 'as-fname';
  name.textContent = isPrompt ? (info ? 'prompt · for ' + info : 'prompt') : (lang || 'code');
  head.appendChild(name);
  const text = body.replace(/\n+$/, '');
  if (!open && text) head.appendChild(_copyBtn(text));
  const pre = document.createElement('pre');
  pre.textContent = text;
  box.append(head, pre);
  return box;
}

/** The text as blocks. */
export function render(text) {
  const frag = document.createDocumentFragment();
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
  let i = 0;
  let para = [];
  let list = null;              // { el, ordered }
  const flushPara = () => {
    if (!para.length) return;
    const p = document.createElement('p');
    p.innerHTML = para.map(inline).join('<br>');
    frag.appendChild(p);
    para = [];
  };
  const flushList = () => { list = null; };
  while (i < lines.length) {
    const line = lines[i];
    const fence = /^\s*```\s*([\w-]*)\s*(.*)$/.exec(line);
    if (fence) {
      flushPara(); flushList();
      const body = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) { body.push(lines[i]); i++; }
      const open = i >= lines.length;
      frag.appendChild(_fence(fence[1].toLowerCase(), fence[2].trim(), body.join('\n'), open));
      i++;
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      flushPara(); flushList();
      const el = document.createElement(h[1].length <= 2 ? 'h3' : 'h4');
      el.innerHTML = inline(h[2]);
      frag.appendChild(el);
      i++;
      continue;
    }
    const li = /^\s*(?:([-*•])|(\d+)[.)])\s+(.*)$/.exec(line);
    if (li) {
      flushPara();
      const ordered = !li[1];
      if (!list || list.ordered !== ordered) {
        list = { el: document.createElement(ordered ? 'ol' : 'ul'), ordered };
        if (ordered && +li[2] > 1) list.el.start = +li[2];
        frag.appendChild(list.el);
      }
      const item = document.createElement('li');
      item.innerHTML = inline(li[3]);
      list.el.appendChild(item);
      i++;
      continue;
    }
    if (/^\s*>\s?/.test(line)) {
      flushPara(); flushList();
      const q = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) { q.push(lines[i].replace(/^\s*>\s?/, '')); i++; }
      const bq = document.createElement('blockquote');
      bq.innerHTML = q.map(inline).join('<br>');
      frag.appendChild(bq);
      continue;
    }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) { flushPara(); flushList(); frag.appendChild(document.createElement('hr')); i++; continue; }
    if (!line.trim()) { flushPara(); flushList(); i++; continue; }
    // A line under a list item that is indented carries on that item.
    if (list && /^\s{2,}\S/.test(line) && list.el.lastElementChild) {
      list.el.lastElementChild.innerHTML += '<br>' + inline(line.trim());
      i++;
      continue;
    }
    flushList();
    para.push(line);
    i++;
  }
  flushPara();
  return frag;
}
