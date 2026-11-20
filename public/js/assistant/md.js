// ════════════════════════════════════════════════════════════════════════════
// THE ASSISTANT'S ANSWER AS A PAGE - a small reader of the Markdown models write, with no library: headings, lists,
// quotes, paragraphs, **bold**, *italic*, `code`, links, tables, fenced blocks. Every character of the text is escaped
// first; only the tags written here are made.
//
// A fence whose first word is `prompt` is A PROMPT FOR A GENERATOR - the rest of its first line names the generator and
// its mode ("Seedance 2.5 · video chat") - drawn as its own block with "copy"; any other fence is code with "copy". A
// fence not closed yet (an answer still being written) is drawn as far as it goes.
//
// THE GUIDE'S PAGES are drawn by it too (`page`): `#` to `####` as h1-h4, every `##` with the id the table of contents
// gives it (guide-toc.js), a line that is only a picture - ![what it shows](shots/x.webp) - a figure with its words under
// it, a link to another chapter or section - [text](05-talking-head.md#who-and-where), [text](#the-timeline) - a link
// the Guide window opens (`data-guide`).
//
//   render(text, { page, base }) -> a DocumentFragment       base - where a picture's address starts ('/guide/')
// ════════════════════════════════════════════════════════════════════════════

import { slug } from './guide-toc.js';
import * as T from '../i18n/t.js';

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);

const LINK_WEB = /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g;
const LINK_GUIDE = /\[([^\]\n]+)\]\(((?:\d\d-[a-z0-9-]+\.md)?(?:#[a-z0-9-]+)?)\)/g;
const PICTURE = /^\s*!\[([^\]]*)\]\(([a-z0-9/_.-]+\.(?:webp|png|jpe?g))\)\s*$/i;
const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_RULE = /^\s*\|?\s*:?-{2,}/;

// Inline: `code` first (nothing inside it is read), then links, bold, italic.
function inline(s, o) {
  const parts = String(s).split(/(`[^`\n]+`)/);
  return parts.map((p, i) => {
    if (i % 2) return '<code>' + esc(p.slice(1, -1)) + '</code>';
    let h = esc(p);
    h = h.replace(LINK_WEB, (m, t, u) => '<a href="' + u + '" target="_blank" rel="noopener noreferrer">' + t + '</a>');
    if (o && o.page) {
      h = h.replace(LINK_GUIDE, (m, t, u) => (u ? '<a href="#" class="as-glink" data-guide="' + u.replace('.md', '') + '">' + t + '</a>' : m));
    }
    h = h.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>').replace(/__([^_\n]+)__/g, '<strong>$1</strong>');
    h = h.replace(/(^|[^*\w])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>').replace(/(^|[^_\w])_([^_\n]+)_(?!\w)/g, '$1<em>$2</em>');
    return h;
  }).join('');
}

function _copyBtn(text, label) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'as-copy u-btn is-s is-quiet';
  b.textContent = label || T.t('copy');
  b.title = T.t('Copy it to the clipboard');
  b.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(text); b.textContent = T.t('copied'); }
    catch (e) { b.textContent = T.t('not copied'); }
    setTimeout(() => { b.textContent = label || T.t('copy'); }, 1400);
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
  name.textContent = isPrompt ? (info ? T.t('prompt · for {what}', { what: info }) : T.t('prompt')) : (lang || T.t('code'));
  head.appendChild(name);
  const text = body.replace(/\n+$/, '');
  if (!open && text) head.appendChild(_copyBtn(text));
  const pre = document.createElement('pre');
  pre.textContent = text;
  box.append(head, pre);
  return box;
}

// A row of a table: its cells, the pipes at the ends dropped.
const _cells = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());

/** The text as blocks. */
export function render(text, opts) {
  const o = opts || {};
  const inl = (x) => inline(x, o);
  const frag = document.createDocumentFragment();
  const ids = new Set();
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
  let i = 0;
  let para = [];
  let list = null;              // { el, ordered }
  const flushPara = () => {
    if (!para.length) return;
    const p = document.createElement('p');
    // A guide page's lines are wrapped by hand: one paragraph, read whole (bold may run over a line's end). An answer's
    // line breaks are the model's own.
    p.innerHTML = o.page ? inl(para.join(' ')) : para.map(inl).join('<br>');
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
      const n = h[1].length;
      const el = document.createElement(o.page ? 'h' + n : (n <= 2 ? 'h3' : 'h4'));
      el.innerHTML = inl(h[2]);
      if (o.page && n === 2) {
        let id = slug(h[2]);
        while (ids.has(id)) id += '-2';
        ids.add(id);
        el.id = 'g-' + id;
      }
      frag.appendChild(el);
      i++;
      continue;
    }
    // A picture alone on its line, in a guide page: a figure, its words under it.
    const pic = o.page ? PICTURE.exec(line) : null;
    if (pic) {
      flushPara(); flushList();
      const fig = document.createElement('figure');
      fig.className = 'as-fig';
      const img = document.createElement('img');
      img.alt = pic[1];
      img.decoding = 'async';
      // The pictures are taken at twice the screen's pixels (tools/guide-shots.js): shown at their own size, sharp.
      const src = (o.base || '') + pic[2].replace(/^\/+/, '');
      img.src = src;
      img.srcset = src + ' 2x';
      fig.appendChild(img);
      if (pic[1]) { const cap = document.createElement('figcaption'); cap.textContent = pic[1]; fig.appendChild(cap); }
      frag.appendChild(fig);
      i++;
      continue;
    }
    // A table: a row of cells, a row of dashes, the rest of its rows.
    if (TABLE_ROW.test(line) && i + 1 < lines.length && TABLE_RULE.test(lines[i + 1])) {
      flushPara(); flushList();
      const t = document.createElement('table');
      t.className = 'as-table';
      const row = (cells, tag) => {
        const r = document.createElement('tr');
        for (const c of cells) { const x = document.createElement(tag); x.innerHTML = inl(c); r.appendChild(x); }
        return r;
      };
      const head = document.createElement('thead');
      head.appendChild(row(_cells(line), 'th'));
      const body = document.createElement('tbody');
      i += 2;
      while (i < lines.length && TABLE_ROW.test(lines[i])) { body.appendChild(row(_cells(lines[i]), 'td')); i++; }
      t.append(head, body);
      frag.appendChild(t);
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
      item.innerHTML = inl(li[3]);
      list.raw = li[3];
      list.el.appendChild(item);
      i++;
      continue;
    }
    if (/^\s*>\s?/.test(line)) {
      flushPara(); flushList();
      const q = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) { q.push(lines[i].replace(/^\s*>\s?/, '')); i++; }
      const bq = document.createElement('blockquote');
      bq.innerHTML = o.page ? inl(q.join(' ')) : q.map(inl).join('<br>');
      frag.appendChild(bq);
      continue;
    }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) { flushPara(); flushList(); frag.appendChild(document.createElement('hr')); i++; continue; }
    if (!line.trim()) { flushPara(); flushList(); i++; continue; }
    // A line under a list item that is indented carries on that item.
    if (list && /^\s{2,}\S/.test(line) && list.el.lastElementChild) {
      // In a guide page the item is one sentence wrapped by hand - read whole again; in an answer, a new line.
      if (o.page) { list.raw += ' ' + line.trim(); list.el.lastElementChild.innerHTML = inl(list.raw); }
      else list.el.lastElementChild.innerHTML += '<br>' + inl(line.trim());
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
