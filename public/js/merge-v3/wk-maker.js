/* ════════════════════════════════════════════════════════════════════════════
   MERGE — what talking head's setup and its windows share: the owner's twenty characters and the
   keyboard-mess test (the generators' benches, js/gen-window.js, and the Library's makechat.js), the
   viewer for one picture, a tile's menu, the gentler wheel, the countdown of the script on the
   whole stage (holdProgress) and - since phase V58 - the countdowns of the casting on the stage's
   halves (holdHalf) and the list "who" and "where" choose from (paintChoose). The benches
   themselves moved into js/gen-window.js in phase V58, so they open anywhere.
   ════════════════════════════════════════════════════════════════════════════ */

import * as Layers from '../layers.js';
import { openViewer } from '../library/viewer.js';
import { startProgress } from '../progress.js';
import { delX } from '../del-x.js';
import { derived } from '../chars-store.js';

export const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

// ── The head of a shelf ─────────────────────────────────────────────────────
// Its tabs on the LEFT, the step's title on the right, and the cross that leaves the shelf at the
// far right, where it always was (phase V24, the owner 2026-10-09: "create look" and "create
// lookbook" first, the title after them). `head` is the step's header (js/merge-v3/wk-setup.js
// paint), which already holds the title; css/merge-v3.css `.is-tabs-left` lays the row out.
export function shelfHead(head, tabs, close) {
  const bar = el('div', 'mv3-wk-bar');
  for (const t of tabs) if (t) bar.appendChild(t);
  head.classList.add('is-tabs-left');
  head.prepend(bar);
  if (close) head.appendChild(close);
}

// ── A gentler wheel ─────────────────────────────────────────────────────────
// A touchpad in this window moves the workshop a long way for a short gesture: the panel is a tall
// column of small rows, and one flick jumps past the whole thing (the owner, 2026-09-22). So the
// boxes that scroll in `setup` take the wheel themselves and move by a fraction of what was asked.
//
// Only a wheel in PIXELS is touched (`deltaMode` 0 - a touchpad and every modern mouse), never a
// zoom gesture, and never a wheel at either end of the box: there the event is left alone, so the
// page behind can scroll instead of the gesture dying here. Trackpad inertia is traded for an even
// step - that is the point of it.
const WHEEL_EASE = 0.4;

export function softScroll(box, factor) {
  const k = factor || WHEEL_EASE;
  box.addEventListener('wheel', (e) => {
    if (e.deltaMode !== 0 || e.ctrlKey || !e.deltaY) return;
    const max = box.scrollHeight - box.clientHeight;
    if (max <= 0) return;
    const at = box.scrollTop;
    if ((e.deltaY < 0 && at <= 0) || (e.deltaY > 0 && at >= max - 0.5)) return;
    e.preventDefault();
    box.scrollTop = Math.max(0, Math.min(max, at + e.deltaY * k));
  }, { passive: false });
}

// ── Words that are words ────────────────────────────────────────────────────
// With a picture in the field the sentence is an edit - "red shoes" is a complete instruction -
// but with nothing else to go on, a handful of characters describes nothing, and twenty is the
// owner's number.
//
// The nonsense test is deliberately shallow and LOCAL: it catches a fist on the keyboard for
// free and instantly. Anything subtler - a real sentence about nothing, a shopping list, a
// question - is the agent's to refuse, and it does that before an image is paid for
// (routes/scen3.js, _readLookbookIdea / _readEnvironmentIdea).
export const MIN_WORDS_ALONE = 20;

export function nonsense(s) {
  const t = String(s || '').trim().toLowerCase();
  if (!t) return false;
  const letters = t.replace(/[^a-zа-яё]/gi, '');
  if (!letters) return true;                               // digits and punctuation only
  if (/^(.)\1+$/.test(letters)) return true;               // one character, held down
  const vowels = (letters.match(/[aeiouyаеёиоуыэюя]/gi) || []).length;
  if (vowels / letters.length < 0.15) return true;         // no vowels worth the name
  const words = t.split(/\s+/).filter(Boolean);
  // One long unbroken run of letters is a keyboard, not a sentence.
  if (words.length === 1 && letters.length >= 12) return true;
  return false;
}

/**
 * One picture in the Library's viewer, with what is known about it in the column beside it.
 *
 * @param src   the picture - a library path, or the data URL of one not saved yet
 * @param name  what to call it: a data URL has no file name to show
 * @param rows  [label, text] pairs, first in the column
 * @param from  the picture this one was made from, shown as a thumbnail
 */
export function showPicture({ src, name, rows, from }) {
  if (!src) return;
  // "kind" is claimed with nothing in it, which keeps the viewer's own kind row out, and "file"
  // is claimed with the name, so a data URL's tail never lands in the column as gibberish.
  const extra = (rows || []).filter(r => r && r[1]).concat([['kind', ''], ['file', name || '']]);
  openViewer(
    [{ id: src, name: name || '', kind: 'picture', media: src, meta: from ? { refImage: from } : {} }], 0,
    { extraRows: () => extra },
  );
}

// ── The waiting animation belongs to the PLACE ──────────────────────────────
// Not to the click that started it. The generation itself is the server's (docs/local-app/PLAN.md,
// "Alerts"): the overlay on the stage is only how a panel says that something of ITS OWN is
// running. So whichever place is painted attaches it - with the job's real elapsed time, so coming
// back mid-generation shows a countdown that is still telling the truth - and a place that is left
// takes its overlay with it, because a countdown lying on somebody else's stage is about nothing.
let _held = null;                            // { place, pr }
/** The place whose countdown is on the stage now ('' - none). */
export const heldPlace = () => (_held ? _held.place : '');

export function holdProgress(place, spec) {
  if (_held && _held.place === place) return _held.pr;
  onlyHere(null);
  const stage = document.getElementById('mv3-stage');
  if (!stage) return null;
  const s = spec || {};
  const pr = startProgress(stage, {
    label: s.label || 'Making it', total: 1,
    startedAt: s.startedAt || 0, estimateMs: s.estimateMs || 90000,
  });
  _held = { place, pr };
  return pr;
}

/** The place being painted says so; an overlay belonging to anywhere else goes quietly. */
export function onlyHere(place) {
  if (!_held || _held.place === place) return;
  try { _held.pr.detach(); } catch (e) { /* it was already gone */ }
  _held = null;
}

/** It came, or it did not. Without a message the countdown is banked as a real duration. */
export function endProgress(place, error) {
  if (!_held || _held.place !== place) return;
  const pr = _held.pr;
  _held = null;
  try {
    if (error) pr.fail(error);
    else { pr.step(); pr.finish(); }
  } catch (e) { /* the stage was rebuilt under it */ }
}

// ── THE HALVES OF THE STAGE WAIT APART (phase V58, the owner 2026-10-29: "когда пользователь работает с "кто" ...
// анимация процесса только на поле "кто" в превью ... чтобы пока генерируется поле "кто" пользователь мог работать с
// "где"") ─────────────────────────────────────────────────────────────────────
// Talking head's casting - a look dressed, a lookbook made (who, the upper half), an environment made (where, the lower)
// - is waited for on ITS half of the stage only: a box over that half (`.mv3-half-ov`, blurring what is under it) holds
// the countdown (js/progress.js), the other half stays itself. A frame or a clip of the script (the whole stage, above)
// takes the stage from them: the step drops the halves then and puts them back at their real age (wk-setup.js _syncHalves).
const _halves = { top: null, bottom: null };          // { place, pr, host }

/** The place waited for on a half ('' - none). */
export const halfPlace = (half) => (_halves[half] && _halves[half].host.isConnected ? _halves[half].place : '');

/** A countdown on one half - `spec` { label, estimateMs, startedAt }. The same place there already is kept. */
export function holdHalf(half, place, spec) {
  const h = _halves[half];
  if (h && h.place === place && h.host.isConnected) return h.pr;
  dropHalf(half);
  const stage = document.getElementById('mv3-stage');
  if (!stage) return null;
  const host = el('div', 'mv3-half-ov is-' + half);
  stage.appendChild(host);
  const s = spec || {};
  const pr = startProgress(host, { label: s.label || 'Making it', total: 1, startedAt: s.startedAt || 0, estimateMs: s.estimateMs || 90000 });
  _halves[half] = { place, pr, host };
  return pr;
}

/** A half let go of without an end - the stage is someone else's for a while; the work goes on. */
export function dropHalf(half) {
  const h = _halves[half];
  if (!h) return;
  _halves[half] = null;
  try { h.pr.detach(); } catch (e) { /* gone with the stage */ }
  h.host.remove();
}

export function dropHalves() { dropHalf('top'); dropHalf('bottom'); }

/** The work of `place` ended: its half says so (a failure in words) and goes. */
export function endHalf(place, error) {
  for (const half of ['top', 'bottom']) {
    const h = _halves[half];
    if (!h || h.place !== place) continue;
    _halves[half] = null;
    try {
      if (error) h.pr.fail(error);
      else { h.pr.step(); h.pr.finish(); }
    } catch (e) { /* the stage was rebuilt under it */ }
    setTimeout(() => h.host.remove(), error ? 4000 : 900);
  }
}

// ── A LIST TO CHOOSE FROM (phase V58; talking head's "who" and "where" - wk-setup.js, wk-env.js) ──────────────────
// Painted into a window's body (js/gen-window.js openFrame), in the attachment window's tiles (css/mv3-imagen.css .pk-*):
// on the left the GROUPS - a filter's two tabs over them ("female · 12", "all · 27") -, the pointer resting on one shows
// its things and the last one stays; no groups, no left side (the environments, wide tiles). On the right a search over
// what is shown (every group the filter passes, while words are typed) and the tiles: a press IS the choice (`press`), a
// mark says what is chosen now, a ✕ pressed twice deletes (`del`), a thing with `say` is there to be seen and says why.
//   o: { groups?: [{ key, label, n, sub, items }], items?, filter?: { label, test(g) }, state: { group, filterOn, q },
//        onGroup(g), mark(it) -> words, press(it, tile), del(it) -> null | { title, ask?, run, done }, empty, why }
//   An item: { path, name, sub, thumb, aspect, say? }.
export function paintChoose(host, o) {
  const st = o.state || (o.state = {});
  const groups = Array.isArray(o.groups) ? o.groups : null;
  const f = o.filter || null;
  if (st.filterOn == null) st.filterOn = !!(f && f.on);
  const shown = () => (groups || []).filter(g => !(f && st.filterOn) || f.test(g));
  host.textContent = '';
  const box = el('div', 'wkc' + (groups ? '' : ' is-flat'));
  const side = el('div', 'pk-side is-people');
  const people = el('div', 'pk-people');
  side.appendChild(people);
  const main = el('div', 'pk-main');
  const bar = el('div', 'pk-bar');
  const q = el('input', 'pk-q u-in is-s');
  q.type = 'search';
  q.placeholder = 'search by name';
  q.spellcheck = false;
  q.value = st.q || '';
  const count = el('span', 'pk-count', '');
  bar.append(q, count);
  const grid = el('div', 'pk-grid');
  grid.addEventListener('contextmenu', (e) => { if (e.target.closest && e.target.closest('.pk-tile')) e.preventDefault(); });
  const said = el('div', 'wkc-said', '');
  main.append(bar, grid, said);
  box.append(side, main);
  host.appendChild(box);

  const group = () => (groups ? shown().find(g => g.key === st.group) || null : null);
  if (groups && !group()) st.group = (shown()[0] || {}).key || '';

  const paintSide = () => {
    people.textContent = '';
    if (!groups) return;
    if (f) {
      const tabs = el('div', 'pk-ftabs u-tabs');
      const tab = (label, on, set) => {
        const b = el('button', 'mv3-sc-tab u-tab' + (on ? ' is-on' : ''), label);
        b.type = 'button';
        b.addEventListener('click', () => {
          if (st.filterOn === set) return;
          st.filterOn = set;
          if (typeof f.onChange === 'function') f.onChange(set);
          if (!group()) st.group = (shown()[0] || {}).key || '';
          paintSide();
          paintGrid();
        });
        return b;
      };
      tabs.append(tab(f.label + ' · ' + groups.filter(f.test).length, st.filterOn, true), tab('all · ' + groups.length, !st.filterOn, false));
      people.appendChild(tabs);
    }
    const vis = shown();
    if (!vis.length) people.appendChild(el('div', 'pk-none is-side', groups.length ? 'Nobody of that kind - show all.' : ''));
    for (const g of vis) {
      const b = el('button', 'pk-person' + (g.key === st.group ? ' on' : ''));
      b.type = 'button';
      b.title = g.label + (g.sub ? ' · ' + g.sub : '');
      b.append(el('span', 'pk-person-t', g.label), el('span', 'pk-person-n', String(g.n)));
      const pick = () => {
        if (st.group === g.key) return;
        st.group = g.key;
        for (const x of people.querySelectorAll('.pk-person')) x.classList.toggle('on', x === b);
        paintGrid();
        if (typeof o.onGroup === 'function') o.onGroup(g);
      };
      b.addEventListener('pointerenter', pick);
      b.addEventListener('click', pick);
      people.appendChild(b);
    }
  };

  const ar = (a) => { const p = String(a || '').split(':'); const v = (+p[0] || 0) / (+p[1] || 0); return v > 0 && isFinite(v) ? v : 0; };
  const tile = (it) => {
    const t = el('div', 'pk-tile');
    t.dataset.path = it.path;
    const hit = el('button', 'pk-hit');
    hit.type = 'button';
    hit.title = it.name + (it.sub ? ' · ' + it.sub : '');
    const bx = el('span', 'pk-box');
    const known = ar(it.aspect);
    t.style.setProperty('--ar', String(known || 0.75));
    if (it.thumb) {
      const img = document.createElement('img');
      img.alt = '';
      img.loading = 'lazy';
      img.decoding = 'async';
      if (!known) img.addEventListener('load', () => { if (img.naturalWidth && img.naturalHeight) t.style.setProperty('--ar', String(img.naturalWidth / img.naturalHeight)); }, { once: true });
      img.addEventListener('error', () => { img.remove(); bx.classList.add('is-blank'); }, { once: true });
      img.src = it.thumb;
      bx.appendChild(img);
    } else bx.classList.add('is-blank');
    hit.appendChild(bx);
    t.appendChild(hit);
    t.appendChild(el('span', 'pk-cap', it.name || ''));
    if (it.sub) t.appendChild(el('span', 'pk-sub', it.sub));
    const m = typeof o.mark === 'function' ? o.mark(it) : '';
    if (m) { t.classList.add('is-on'); bx.appendChild(el('span', 'pk-mark', m)); }
    hit.addEventListener('click', () => {
      if (it.say) { said.textContent = it.say; return; }
      said.textContent = '';
      o.press(it, t);
    });
    const d = typeof o.del === 'function' ? o.del(it) : null;
    if (d) t.appendChild(delX(Object.assign({ host: t }, d)));
    return t;
  };

  const paintGrid = () => {
    grid.textContent = '';
    said.textContent = '';
    const look = String(st.q || '').trim().toLowerCase();
    const g = group();
    const pool = groups ? (look ? shown().flatMap(x => x.items || []) : (g ? g.items : [])) : (o.items || []);
    const list = look ? pool.filter(it => String(it.name || '').toLowerCase().includes(look) || String(it.sub || '').toLowerCase().includes(look)) : pool;
    count.textContent = look ? list.length + ' of ' + pool.length : String(pool.length);
    if (!list.length) {
      grid.appendChild(el('div', 'pk-none', o.why || (look ? 'Nothing here is called “' + look + '”.' : (o.empty || 'Nothing here yet.'))));
      return;
    }
    for (const it of list) grid.appendChild(tile(it));
  };

  q.addEventListener('input', () => { st.q = q.value; paintGrid(); });
  paintSide();
  paintGrid();
  setTimeout(() => { if (q.isConnected && !q.value) q.focus(); }, 0);
  return { group };
}

// ── WHO TO CHOOSE FROM (phase V63: one list for the setup's "who" window - wk-setup.js - and Home's talking head quick start -
// js/home/start.js) ──
// A group a character - the most looks first is the caller's order (chars-store.js byLooks) -: its 4K sheet (or portrait) to be
// seen only, with `say` (a person is cast in a look, never bare), then its looks. `o.say(c)` - what the sheet says when pressed.
export function lookGroups(chars, o = {}) {
  const nLooks = (n) => (n === 1 ? '1 look' : n ? n + ' looks' : 'no looks yet');
  return (chars || []).map((c) => {
    const sheet = c.sheet || c.face || '';
    const items = [];
    if (sheet) {
      items.push({ path: sheet, name: c.name, sub: c.sheet ? '4K sheet' : 'portrait', aspect: c.sheet ? '16:9' : '',
        thumb: derived(sheet, 'card'), char: c,
        say: typeof o.say === 'function' ? o.say(c) : c.name + ' is cast in a look - press one of the looks.' });
    }
    for (const lk of c.obrazy) {
      items.push({ path: lk.image, name: lk.name || 'look', sub: 'look', thumb: derived(lk.image, 'card'), char: c, look: lk });
    }
    return { key: c.id, label: c.name, n: c.obrazy.length, sub: nLooks(c.obrazy.length), items, char: c };
  });
}

// ── The menu on a tile ──────────────────────────────────────────────────────
// Not modal (js/layers.js): it takes Escape and leaves the page's shortcuts alone. One at a time -
// opening another closes this one.
let _menu = null;

export function closeMenu() {
  if (!_menu) return;
  _menu.el.remove();
  document.removeEventListener('mousedown', _menu.away, true);
  Layers.close(_menu.layer);
  _menu = null;
}

/** @param items [{ label, sub, on, danger }] */
export function tileMenu(ev, items, name) {
  closeMenu();
  const box = el('div', 'mv3-plus-menu');
  for (const it of items) {
    const b = el('button', 'mv3-plus-item' + (it.danger ? ' is-danger' : ''));
    b.type = 'button';
    b.appendChild(el('span', null, it.label));
    if (it.sub) b.appendChild(el('small', null, it.sub));
    b.addEventListener('click', (e) => { e.stopPropagation(); closeMenu(); it.on(); });
    box.appendChild(b);
  }
  document.body.appendChild(box);
  const w = box.offsetWidth, h = box.offsetHeight;
  box.style.left = Math.round(Math.max(6, Math.min(window.innerWidth - w - 6, ev.clientX))) + 'px';
  box.style.top = Math.round(Math.max(6, Math.min(window.innerHeight - h - 6, ev.clientY))) + 'px';
  const away = (e) => { if (!box.contains(e.target)) closeMenu(); };
  const layer = Layers.open(box, { modal: false, name: name || 'tile menu', onEsc: closeMenu });
  _menu = { el: box, away, layer };
  setTimeout(() => document.addEventListener('mousedown', away, true), 0);
}
