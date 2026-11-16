// ════════════════════════════════════════════════════════════════════════════
// THE GUIDE - the app's book in a window, opened by "Guide" in the top strip (js/app-nav.js), by Home's Guide block and its
// first step (js/home/main.js), by "Guide" in the assistant's Help and by "Guide: <section>" under a Help answer. The book
// needs no key: nothing here asks for one. A generation's window (js/gen-window.js openFrame, 1280×800, moved and
// stretched, kept under `guide`) over the page.
//
//   left   the chapters in order (GET /api/assistant/guide - the server reads the book's table of contents by the rule
//          of guide-toc.js); the open chapter shows its sections, the one being read lit as the page scrolls
//   right  the chapter as a page (md.js `page`: its pictures, its sections with their ids), a section scrolled to the top;
//          a link to another chapter or section opens it here
//
// The place read last is kept in the browser (`gd_place_v1`), so "Guide" opens where you stopped; so are the chapters ever
// opened (`gd_read_v1`) - Home's first step "Read Getting started" is ticked by them. The window tells the page when it opens
// and closes: the window event `ugc:guide` { open }.
//   openGuide({ chapter, section })    chapter '04-merge', section 'the-timeline' ('' - its top); none - the place kept
//   contents()                         the table of contents - [{ id, file, title, sections }], read once
//   placeKept()                        { chapter, section } where the book was left ({} - never opened)
//   chaptersRead()                     the ids of the chapters ever opened
// ════════════════════════════════════════════════════════════════════════════

import { openFrame, GEN_SIZE } from '../gen-window.js';
import { render as md } from './md.js';
import { loadingEl, failedEl } from '../ui-state.js';

const GEOM = Object.freeze({ key: 'guide', resize: true, move: true, keepSize: true, keepPos: true });
const LS = 'gd_place_v1';
const READ = 'gd_read_v1';
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

let _css = null;
/** The assistant's sheet (the Guide's look is in it), put in once. */
export function ensureCss() {
  if (_css) return _css;
  if (document.querySelector('link[data-assistant]')) return (_css = Promise.resolve());
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = '/css/assistant.css';
  l.dataset.assistant = '1';
  _css = new Promise((res) => { l.onload = l.onerror = () => res(); });
  document.head.appendChild(l);
  return _css;
}

let W = null;               // { win, nav, page, doc }
let _toc = null;            // [{ id, file, title, sections }]
const _texts = new Map();   // chapter id -> its text
let _at = { chapter: '', section: '' };

const _kept = () => { try { return JSON.parse(localStorage.getItem(LS) || '{}') || {}; } catch (e) { return {}; } };
const _keep = () => { try { localStorage.setItem(LS, JSON.stringify(_at)); } catch (e) { /* a private window */ } };
const _tell = (open) => window.dispatchEvent(new CustomEvent('ugc:guide', { detail: { open } }));

/** Where the book was left - { chapter, section }; {} when it was never opened. */
export const placeKept = () => _kept();

/** The ids of the chapters ever opened. */
export function chaptersRead() {
  try { const a = JSON.parse(localStorage.getItem(READ) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; }
}
function _markRead(id) {
  const a = chaptersRead();
  if (a.includes(id)) return;
  a.push(id);
  try { localStorage.setItem(READ, JSON.stringify(a)); } catch (e) { /* a private window */ }
}

let _tocAsk = null;
/** The book's table of contents, read once; a read that failed is asked again the next time. */
export function contents() {
  if (_toc) return Promise.resolve(_toc);
  if (!_tocAsk) {
    _tocAsk = fetch('/api/assistant/guide').then(async (r) => {
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.success) throw new Error(j.error || 'HTTP ' + r.status);
      _toc = j.chapters || [];
      return _toc;
    }).finally(() => { _tocAsk = null; });
  }
  return _tocAsk;
}

/** Opens the book at a place (or, open already, goes there). */
export async function openGuide(where) {
  await ensureCss();
  const w = where && where.chapter ? where : _kept();
  if (!W || !W.win.alive()) _build();
  if (!_toc) await _loadToc();
  const first = _toc && _toc[0] ? _toc[0].id : '';
  await _go(w.chapter && _toc && _toc.some(c => c.id === w.chapter) ? w.chapter : first, w.section || '');
}

function _build() {
  const win = openFrame({ name: 'guide', size: GEN_SIZE, geom: GEOM, cls: 'is-guide', onClose: () => { W = null; _tell(false); } });
  win.body.classList.add('gd-body');
  const nav = el('nav', 'gd-nav');
  const page = el('div', 'gd-page');
  const doc = el('article', 'gd-doc');
  page.appendChild(doc);
  win.body.append(nav, page);
  page.addEventListener('scroll', _onScroll, { passive: true });
  // A link to a chapter or a section of the book opens it here.
  doc.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('a[data-guide]');
    if (!a) return;
    e.preventDefault();
    const [chapter, section] = String(a.dataset.guide).split('#');
    _go(chapter || _at.chapter, section || '');
  });
  W = { win, nav, page, doc };
  win.setCrumbs([{ label: 'guide' }]);
  _tell(true);
}

async function _loadToc() {
  try { await contents(); }
  catch (e) {
    _toc = null;
    if (W) { W.doc.textContent = ''; W.doc.appendChild(failedEl('The guide', () => openGuide(_at))); }
  }
}

async function _text(ch) {
  if (_texts.has(ch.id)) return _texts.get(ch.id);
  const r = await fetch('/guide/' + encodeURIComponent(ch.file));
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const t = await r.text();
  _texts.set(ch.id, t);
  return t;
}

async function _go(chapter, section) {
  if (!W || !_toc) return;
  const ch = _toc.find(c => c.id === chapter);
  if (!ch) return;
  const same = _at.chapter === chapter && W.doc.dataset.ch === chapter;
  _at = { chapter, section: section || '' };
  _keep();
  _markRead(chapter);
  W.win.setCrumbs([{ label: 'guide', on: () => _go(_toc[0].id, '') }, { label: ch.title }]);
  _paintNav();
  if (!same) {
    W.doc.textContent = '';
    W.doc.appendChild(loadingEl('reading the chapter'));
    let text;
    try { text = await _text(ch); }
    catch (e) { W.doc.textContent = ''; W.doc.appendChild(failedEl('The chapter', () => _go(chapter, section))); return; }
    if (!W || _at.chapter !== chapter) return;
    W.doc.textContent = '';
    W.doc.dataset.ch = chapter;
    W.doc.appendChild(md(text, { page: true, base: '/guide/' }));
  }
  const target = section ? W.doc.querySelector('#g-' + CSS.escape(section)) : null;
  W.page.scrollTop = target ? Math.max(0, target.offsetTop - 12) : 0;
}

function _paintNav() {
  const N = W.nav;
  N.textContent = '';
  _toc.forEach((c, i) => {
    const on = c.id === _at.chapter;
    const b = el('button', 'gd-ch' + (on ? ' is-cur' : ''));
    b.type = 'button';
    const num = /^(\d\d)-/.exec(c.id);
    b.append(el('span', 'gd-num', num ? String(+num[1]) : '·'), el('span', 'gd-cht', c.title));
    b.addEventListener('click', () => _go(c.id, ''));
    N.appendChild(b);
    if (!on) return;
    const list = el('div', 'gd-secs');
    for (const s of c.sections) {
      const sb = el('button', 'gd-sec' + (s.id === _at.section ? ' is-cur' : ''), s.title);
      sb.type = 'button';
      sb.dataset.sec = s.id;
      sb.addEventListener('click', () => _go(c.id, s.id));
      list.appendChild(sb);
    }
    N.appendChild(list);
    if (i < _toc.length - 1) N.appendChild(el('div', 'gd-gap'));
  });
}

// The section being read is lit as the page scrolls: the last heading above the page's upper third.
let _raf = 0;
function _onScroll() {
  if (_raf) return;
  _raf = requestAnimationFrame(() => {
    _raf = 0;
    if (!W) return;
    const line = W.page.scrollTop + W.page.clientHeight / 3;
    let cur = '';
    for (const h of W.doc.querySelectorAll('h2[id^="g-"]')) { if (h.offsetTop <= line) cur = h.id.slice(2); else break; }
    if (cur === _at.section) return;
    _at.section = cur;
    _keep();
    for (const b of W.nav.querySelectorAll('.gd-sec')) b.classList.toggle('is-cur', b.dataset.sec === cur);
  });
}
