/* ════════════════════════════════════════════════════════════════════════════
   MERGE — A PIECE OF A VOICEOVER'S B-ROLL, ANOTHER ITEM FOR IT (phase V62, block 2; the owner 2026-10-30, (во18): "при клике на
   элемент видеодорожки показывает в library скачаные варианты, галочкой отмечены те, которые уже на таймлайне, при наведении
   показывать всплывашку с предпросмотром, кликом заменять на таймлайне. типа так меньше действий, чтобы не открывать попап";
   (во25) "всегда"; (во22) а - only what is laid is downloaded).

   A press on a piece of the B-roll on main video (a cell `br_…`, lib/broll.js) opens this view of the Library panel - from the
   shelf, a chat, the captions, whatever showed; its crumb "/ b-roll" is lit, and the panel's other crumbs lead back. It shows
   the piece's SENTENCE - its words, the agent's queries - and its BATCH: the videos, then the pictures, each a tile: ✓ when it
   is laid somewhere on the timeline, outlined when it is in this very piece; the pointer resting on one shows it larger - a video
   plays muted (the file once it is in the library, else the stock's own preview), a picture big. A press puts it into the
   piece, in its place and length (POST /api/broll/:id/swap) - downloaded first when it is not in the library - chosen BY HAND,
   so a mode changed in field 2 does not take it out; the one it replaces stays in the library.

   One of lib-views.js's bases, as the scenarios view is (js/merge-v3/scen-pick.js).
   ════════════════════════════════════════════════════════════════════════════ */

import * as Views from './lib-views.js';
import * as Store from './store.js';
import * as WK from './workshop.js';
import { onSelChange, selectedOne } from './timeline-b.js';
import { setOpenColumn } from './layout.js';
import { showError } from '../notice.js';

const NAME = 'broll';
const $ = (id) => document.getElementById(id);
const _el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const _pid = () => WK.projectIdOf(Store.key() || '');
const _site = (s) => (s === 'pixabay' ? 'Pixabay' : s === 'fake' ? 'fake stock' : String(s || ''));
const _isVo = () => { const p = WK.project(); return !!(p && p.type === 'voiceover'); };

let _shown = false;
let _cell = '';               // the piece shown: its cell id
let _data = null;             // GET /api/broll/:id/piece/:cell
let _busy = '';               // the item being put in
let _said = '';
let _pop = null;              // the preview under the pointer

function _crumb() {
  const c = $('mv3-lib-br');
  if (c) c.hidden = !(_isVo() && _cell);
}

/** A piece pressed on the timeline - or the crumb: its sentence's batch, in the Library panel. */
export async function openPiece(cell) {
  if (!cell) return;
  if (cell !== _cell) { _cell = cell; _data = null; _said = ''; }
  Views.toBase();
  setOpenColumn('library');
  _show(true);
  await _load();
}

function _show(on) {
  _shown = !!on;
  Views.setBase(NAME, _shown);
  if (!_shown) _closePop();
  _crumb();
  _paint();
}

async function _load() {
  const id = _pid();
  if (!id || !_cell) return;
  try {
    const r = await fetch('/api/broll/' + encodeURIComponent(id) + '/piece/' + encodeURIComponent(_cell)).then(x => x.json());
    if (!r || !r.success) throw new Error((r && r.error) || 'refused');
    _data = r.piece;
    _said = '';
  } catch (e) {
    _data = null;
    _said = e.message;
  }
  _paint();
}

function _paint() {
  const root = $('mv3-br');
  if (!root || !_shown) return;
  root.textContent = '';
  if (_said && !_data) { root.appendChild(_el('div', 'mv3-ins-note is-err', _said)); return; }
  if (!_data) { root.appendChild(_el('div', 'mv3-ins-note', 'reading the piece…')); return; }
  const d = _data;
  const head = _el('div', 'mv3-brv-head');
  head.appendChild(_el('div', 'mv3-brv-sent', '«' + d.text + '»'));
  const meta = _el('div', 'mv3-brv-meta', 'piece ' + (d.piece + 1) + ' of ' + d.pieces + ' · found by: ' + (d.queries || []).join(' · '));
  // (phase V62, block 3, (во45)) Pixabay's terms: where the results come from, linked.
  if (d.items.some(i => i.site === 'pixabay')) {
    meta.appendChild(document.createTextNode(' · '));
    const a = _el('a', 'mv3-brv-src', 'from Pixabay');
    a.href = 'https://pixabay.com/';
    a.target = '_blank';
    a.rel = 'noopener';
    meta.appendChild(a);
  }
  head.appendChild(meta);
  root.appendChild(head);
  if (_said) root.appendChild(_el('div', 'mv3-ins-note is-err', _said));
  const scroll = _el('div', 'mv3-brv-scroll');
  root.appendChild(scroll);
  for (const [kind, label] of [['video', 'videos'], ['image', 'pictures']]) {
    const items = d.items.filter(i => i.kind === kind);
    if (!items.length) continue;
    scroll.appendChild(_el('div', 'mv3-brv-hdr', label + ' · ' + items.length));
    const grid = _el('div', 'mv3-brv-grid');
    for (const it of items) grid.appendChild(_tile(it));
    scroll.appendChild(grid);
  }
}

function _tile(it) {
  const t = _el('button', 'mv3-brv-tile' + (it.here ? ' is-here' : '') + (it.on ? ' is-on' : '') + (_busy === it.id ? ' is-busy' : ''));
  t.type = 'button';
  const img = _el('img');
  img.loading = 'lazy';
  img.alt = '';
  img.src = it.thumb;
  t.appendChild(img);
  if (it.kind === 'video') t.appendChild(_el('span', 'mv3-brv-dur', '▶ ' + (it.dur ? Math.round(it.dur) + ' s' : '')));
  if (it.on) t.appendChild(_el('span', 'mv3-brv-on', '✓'));
  // (phase V62, block 3, (во45)) Where it is from, and whose - Pixabay's terms: its results say so.
  t.appendChild(_el('span', 'mv3-brv-by', [_site(it.site), it.author].filter(Boolean).join(' · ')));
  if (_busy === it.id) t.appendChild(_el('span', 'mv3-brv-wait', 'putting it in…'));
  t.title = (it.here ? 'In this piece now' : 'Put it into this piece') + (it.filed ? '' : ' - downloaded when chosen')
    + '\n' + [_site(it.site), it.author].filter(Boolean).join(' · ') + (it.page ? '\n' + it.page : '');
  t.disabled = !!_busy;
  t.addEventListener('mouseenter', () => _openPop(t, it));
  t.addEventListener('mouseleave', _closePop);
  t.addEventListener('click', () => { if (!it.here) _swap(it); });
  return t;
}

// ── The preview under the pointer (the owner: "при наведении показывать всплывашку с предпросмотром") ──
function _openPop(anchor, it) {
  _closePop();
  const box = _el('div', 'mv3-brv-pop');
  const wide = (it.w || 9) >= (it.h || 16);
  box.classList.toggle('is-wide', wide);
  if (it.kind === 'video' && it.preview) {
    const v = document.createElement('video');
    v.src = it.preview;
    v.muted = true;
    v.autoplay = true;
    v.loop = true;
    v.playsInline = true;
    box.appendChild(v);
  } else {
    const img = _el('img');
    img.src = it.thumb;
    img.alt = '';
    box.appendChild(img);
  }
  box.appendChild(_el('div', 'mv3-brv-popcap', [it.kind === 'video' ? 'video' : 'picture', it.w && it.h ? it.w + '×' + it.h : '',
    it.author, it.site].filter(Boolean).join(' · ')));
  document.body.appendChild(box);
  const r = anchor.getBoundingClientRect();
  const bw = box.offsetWidth, bh = box.offsetHeight;
  const left = r.right + 8 + bw < window.innerWidth ? r.right + 8 : Math.max(6, r.left - 8 - bw);
  box.style.left = Math.round(left) + 'px';
  box.style.top = Math.round(Math.max(6, Math.min(window.innerHeight - bh - 6, r.top + r.height / 2 - bh / 2))) + 'px';
  _pop = box;
}
function _closePop() {
  if (!_pop) return;
  const v = _pop.querySelector('video');
  if (v) { try { v.pause(); } catch (e) { /* gone */ } }
  _pop.remove();
  _pop = null;
}

// ── The press: this item into the piece ──
async function _swap(it) {
  const id = _pid();
  if (!id || _busy) return;
  _busy = it.id;
  _closePop();
  _paint();
  try {
    const r = await fetch('/api/broll/' + encodeURIComponent(id) + '/swap', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cell: _cell, item: it.id }),
    }).then(x => x.json());
    if (!r || !r.success) throw new Error((r && r.error) || 'refused');
    // The server downloads it if needed and lays the piece again: wait for that, then the timeline and this view.
    for (let i = 0; i < 120; i++) {
      const s = await fetch('/api/broll/' + encodeURIComponent(id) + '/state').then(x => x.json());
      if (!s || !s.state || !s.state.running) { if (s && s.state && s.state.error) throw new Error(s.state.error); break; }
      await new Promise(res => setTimeout(res, 700));
    }
    await Store.refresh();
  } catch (e) {
    showError('Could not put it in: ' + e.message);
  }
  _busy = '';
  await _load();
}

export function initBroll() {
  Views.registerChat(NAME, {
    root: 'mv3-br', crumb: 'mv3-lib-br',
    crumbTitle: 'The B-roll of the piece last pressed on main video',
    onBack: () => _show(false), onYield: () => _show(false), onCrumb: () => { if (_cell) openPiece(_cell); },
  });
  // A piece of the B-roll pressed on main video, in a voiceover: its batch, here.
  onSelChange(() => {
    const one = selectedOne();
    if (!one || !one.track || one.track.id !== 'v1' || !_isVo()) return;
    const id = String((one.clip && one.clip.id) || '');
    if (/^br_\d+_\d+_\d+/.test(id)) openPiece(id);
  });
  // Another project: nothing of this one's pieces stays.
  let key = null;
  Store.onChange(() => {
    const k = Store.key() || '';
    if (k === key) return;
    key = k;
    _cell = '';
    _data = null;
    if (_shown) _show(false); else _crumb();
  });
}
