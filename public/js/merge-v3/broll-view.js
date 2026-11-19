/* ════════════════════════════════════════════════════════════════════════════
   MERGE — A PIECE OF A VOICEOVER'S B-ROLL, ANOTHER ITEM FOR IT.

   A press on a piece of the B-roll on main video (a cell `br_…`, lib/broll.js) opens this view of the Library panel - from the
   shelf, the scenarios, the captions, whatever showed; its crumb "b-roll /" is lit, and the panel's other crumbs lead back. It shows
   the piece's SENTENCE - its words, the agent's queries - and its BATCH: the videos, then the pictures, each a tile: ✓ when it
   is laid somewhere on the timeline, outlined when it is in this very piece. A press puts it into the
   piece, in its place and length (POST /api/broll/:id/swap) - downloaded first when it is not in the library - chosen BY HAND,
   so a mode changed in field 2 does not take it out; the one it replaces stays in the library.

   One of lib-views.js's bases, as the scenarios view is (js/merge-v3/scen-pick.js).
   ════════════════════════════════════════════════════════════════════════════ */

import * as Views from './lib-views.js';
import * as Store from './store.js';
import * as WK from './workshop.js';
import { onSelChange, selectedOne, selectClipById, playhead } from './timeline-b.js';
import { hint } from '../bubble.js';
import { setOpenColumn } from './layout.js';
import { showError } from '../notice.js';
// Being read, could not be read - the shared parts.
import { loadingEl, failedEl, emptyEl } from '../ui-state.js';
// Lucide's ▶ and ✓, the figures in mono.
import { icon } from '../icons.js';
import { figures } from '../num.js';
import * as T from '../i18n/t.js';

const NAME = 'broll';
const $ = (id) => document.getElementById(id);
const _el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const _pid = () => WK.projectIdOf(Store.key() || '');
const _site = (s) => (s === 'pixabay' ? 'Pixabay' : s === 'fake' ? T.t('fake stock') : String(s || ''));
const _isVo = () => { const p = WK.project(); return !!(p && p.type === 'voiceover'); };

let _shown = false;
let _cell = '';               // the piece shown: its cell id
let _data = null;             // GET /api/broll/:id/piece/:cell
let _busy = '';               // the item being put in
let _failed = false;          // the piece could not be read and nothing of it is shown - the reason was a popup

// The B-roll's pieces on main video, in their order on the timeline.
const _pieces = () => {
  const tl = Store.timeline();
  const v1 = ((tl && tl.tracks) || []).find(t => t.id === 'v1');
  return ((v1 && v1.clips) || []).filter(c => /^br_\d+_\d+_\d+/.test(String(c.id || ''))).sort((a, b) => (+a.start || 0) - (+b.start || 0));
};
export const laid = () => _pieces().length > 0;

// The crumb "b-roll /" stands in every voiceover, first in the panel's head: pale until the B-roll is laid.
function _crumb() {
  const c = $('mv3-lib-br');
  if (!c) return;
  c.hidden = !_isVo();
  c.classList.toggle('is-off', !laid());
}

/** The crumb pressed: the piece chosen last - none, the piece under the playhead (none there - the first one) - picked and
 *  opened. Nothing while there is no B-roll on the timeline. */
export function openCurrent() {
  const all = _pieces();
  if (!all.length) return;
  if (_cell && all.some(c => c.id === _cell)) { openPiece(_cell); return; }
  const t = playhead();
  const at = all.find(c => t >= (+c.start || 0) && t < (+c.start || 0) + (+c.dur || 0)) || all[0];
  selectClipById(at.id);                   // onSelChange opens it (below)
  if (_cell !== at.id) openPiece(at.id);
}

/** A piece pressed on the timeline - or the crumb: its sentence's batch, in the Library panel. */
export async function openPiece(cell) {
  if (!cell) return;
  if (cell !== _cell) { _cell = cell; _data = null; _failed = false; }
  Views.toBase();
  setOpenColumn('library');
  _show(true);
  await _load();
}

function _show(on) {
  _shown = !!on;
  Views.setBase(NAME, _shown);
  _crumb();
  _paint();
}

async function _load() {
  const id = _pid();
  if (!id || !_cell) return;
  try {
    const r = await fetch('/api/broll/' + encodeURIComponent(id) + '/piece/' + encodeURIComponent(_cell)).then(x => x.json());
    if (!r || !r.success) throw new Error((r && r.error) || T.t('refused'));
    _data = r.piece;
    _failed = false;
  } catch (e) {
    // The reason a popup; what is shown of the piece stays - with nothing shown, "did not load".
    showError(T.t('The piece did not load: {why}', { why: e.message }));
    if (!_data) _failed = true;
  }
  _paint();
}

function _paint() {
  const root = $('mv3-br');
  if (!root || !_shown) return;
  root.textContent = '';
  if (_failed && !_data) { root.appendChild(failedEl(T.t('The piece'), () => { _failed = false; _paint(); _load(); })); return; }
  if (!_data) { root.appendChild(loadingEl(T.t('reading the piece…'))); return; }
  const d = _data;
  const head = _el('div', 'mv3-brv-head');
  // The sentence, the keywords it was searched by under it: the sentence in plain text with a thin gold line at its left
  // - "your sentence" -, the keywords in the second colour.
  head.appendChild(_el('div', 'mv3-brv-sent', '«' + d.text + '»'));
  const meta = _el('div', 'mv3-brv-meta');
  meta.appendChild(figures(T.t('Piece {k} of {n} · found by:', { k: d.piece + 1, n: d.pieces }) + ' '));
  (d.queries || []).forEach((q, i) => {
    if (i) meta.appendChild(document.createTextNode(' · '));
    meta.appendChild(_el('span', 'mv3-brv-q', q));
  });
  // Pixabay's terms: where the results come from, linked.
  if (d.items.some(i => i.site === 'pixabay')) {
    meta.appendChild(document.createTextNode(' · '));
    const a = _el('a', 'mv3-brv-src', T.t('From Pixabay'));
    a.href = 'https://pixabay.com/';
    a.target = '_blank';
    a.rel = 'noopener';
    meta.appendChild(a);
  }
  head.appendChild(meta);
  root.appendChild(head);
  const scroll = _el('div', 'mv3-brv-scroll');
  root.appendChild(scroll);
  // a piece with nothing found says so - the shared "empty"
  if (!d.items.length) scroll.appendChild(emptyEl(T.t('Nothing was found for this piece.'), { icon: 'search' }));
  for (const [kind, label] of [['video', T.t('Videos')], ['image', T.t('Pictures')]]) {
    const items = d.items.filter(i => i.kind === kind);
    if (!items.length) continue;
    scroll.appendChild(_el('div', 'mv3-brv-hdr')).appendChild(figures(label + ' · ' + items.length));
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
  if (it.kind === 'video') {
    const dur = t.appendChild(_el('span', 'mv3-brv-dur'));
    dur.innerHTML = icon('play', 10);
    if (it.dur) dur.appendChild(figures(T.t('{s} s', { s: Math.round(it.dur) })));
  }
  if (it.on) t.appendChild(_el('span', 'mv3-brv-on')).innerHTML = icon('check', 12);
  // Where it is from, and whose - Pixabay's terms: its results say so.
  t.appendChild(_el('span', 'mv3-brv-by', [_site(it.site), it.author].filter(Boolean).join(' · ')));
  if (_busy === it.id) t.appendChild(_el('span', 'mv3-brv-wait', T.t('putting it in…')));
  // No browser tooltip: the tile says it all.
  t.setAttribute('aria-label', it.here ? T.t('In this piece now') : T.t('Put it into this piece'));
  t.disabled = !!_busy;
  t.addEventListener('click', () => { if (!it.here) _swap(it); });
  return t;
}

// No preview under the pointer - a tile is seen as it is, and a press puts it in.

// ── The press: this item into the piece ──
async function _swap(it) {
  const id = _pid();
  if (!id || _busy) return;
  _busy = it.id;
  _paint();
  Store.hush(120000);
  try {
    const r = await fetch('/api/broll/' + encodeURIComponent(id) + '/swap', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cell: _cell, item: it.id }),
    }).then(x => x.json());
    if (!r || !r.success) throw new Error((r && r.error) || T.t('refused'));
    // The server downloads it if needed and lays the piece again: wait for that, then the timeline and this view.
    for (let i = 0; i < 120; i++) {
      const s = await fetch('/api/broll/' + encodeURIComponent(id) + '/state').then(x => x.json());
      if (!s || !s.state || !s.state.running) { if (s && s.state && s.state.error) throw new Error(s.state.error); break; }
      await new Promise(res => setTimeout(res, 700));
    }
    // The swap is the person's own act: the timeline takes it without a word by the transport.
    await Store.refresh();
  } catch (e) {
    showError(T.t('Could not put it in: {why}', { why: e.message }));
  }
  Store.hush(2000);
  _busy = '';
  await _load();
}

export function initBroll() {
  Views.registerChat(NAME, {
    root: 'mv3-br', crumb: 'mv3-lib-br',
    onBack: () => _show(false), onYield: () => _show(false), onCrumb: openCurrent,
  });
  // Pale, it says why (the bubble - never the browser's tooltip).
  const crumb = $('mv3-lib-br');
  if (crumb) hint(crumb, () => (crumb.classList.contains('is-off') ? T.t('Find the B-roll first - field 2 of setup, B-roll.') : ''));
  WK.onRepaint(_crumb);
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
    if (k === key) { _crumb(); return; }
    key = k;
    _cell = '';
    _data = null;
    if (_shown) _show(false); else _crumb();
  });
}
