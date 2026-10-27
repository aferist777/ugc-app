/* ═══════════════════════════════════════════════════════════════════════════
   PICKING SEVERAL TILES (phase V54 block 5, the owner 2026-10-27: "нужно еще добавить выделение зажатым кликом. типа
   выделение нескольких файлов, так же с зажатым shift (выделение "от" и "до") и с зажатым ctrl (точечное выделение
   нескольких)"; (зв17): every tile of media - video, pictures, sound, a post of REFERENCES - in the Library's Media and in
   Merge's Library panel; (зв18): several tiles onto a lane - not yet). ONE module for both galleries.

     Ctrl + a press      adds the tile or takes it off                    (the tile does nothing else)
     Shift + a press     from the last one pressed to this one, in the gallery's order (with Ctrl: added to what is picked)
     a press             as it always was (plays, opens) - and picks that one alone
     a press on empty space and a drag - a band: what it touches is picked; with Shift it adds
     a press on empty space, or Escape - nothing picked
     Delete              the page's question for all of them (`onDelete`) - not in a field, not under a window

   What is done with them is the page's: let go on a node of the tree or a folder tile (js/media-tree.js takes `many` -
   POST /api/library/batch/move), the right button ("Move to…", ★, "Delete N" - menuAt below), Delete.

     createSelection({ host, tile, active(), onChange(keys), onDelete(keys) })
       host      the element the gallery is drawn in (it stays; its tiles are drawn again)
       tile      the selector of a pickable tile - it carries `data-key` ("<kind>:<id>")
       -> { has(key), keys(), size(), clear(), refresh(), only(key) }
     menuAt(x, y, rows)   a small menu under the right button: rows [label, sub, fn, danger] - on the Layers stack

   What both pages do with several (routes/library.js POST /api/library/batch/move | favorite | delete):
     canGo(kind, to)            whether one tile of `kind` goes to a place - js/media-tree.js _dropAction's rule
     batch(op, items, extra)    the request; skipped items come back with why
     saidOf(answer, verb)       "4 items moved · 2 stayed: a picture never becomes a clip"
     deleteQuestion(items)      the ONE question - their names and the projects that use their files
     moveMany(x, y, items, { done, status })   "Move to…": the place picker (js/place-tree.js) with AUDIO too
   ═══════════════════════════════════════════════════════════════════════════ */

import * as Layers from './layers.js';
import { openPlaces } from './place-tree.js';

const BAND_FROM = 5;          // px a press moves before it is a band
// The most a batch takes at once - routes/library.js BATCH_MAX says the same; more is refused in words before anything.
export const BATCH_MAX = 2000;

const _inField = (t) => !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
const _hit = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

export function createSelection(o) {
  const opt = Object.assign({ active: () => true, onChange: () => {}, onDelete: () => {} }, o || {});
  const host = opt.host;
  let picked = new Set();
  let anchor = '';
  let pressedHere = false;    // the last press was in this gallery - its Delete and Escape are this gallery's

  const tiles = () => Array.from(host.querySelectorAll(opt.tile)).filter(t => t.dataset.key);
  const tileOf = (el) => {
    const t = el && el.closest ? el.closest(opt.tile) : null;
    return t && host.contains(t) && t.dataset.key ? t : null;
  };

  // Whether the gallery is on screen: Merge's panel shows a chat or the captions in its place, the Library another shelf.
  const shown = () => host.getClientRects().length > 0 && opt.active();

  // The chip that says how many are picked - over the gallery's top left corner.
  const chip = document.createElement('div');
  chip.className = 'ts-chip';
  chip.hidden = true;
  const chipText = document.createElement('span');
  const chipX = document.createElement('button');
  chipX.type = 'button';
  chipX.textContent = '✕';
  chipX.title = 'Pick nothing (Escape)';
  chipX.addEventListener('click', (e) => { e.stopPropagation(); clear(); });
  chip.append(chipText, chipX);
  document.body.appendChild(chip);
  function _chip() {
    const n = picked.size;
    chip.hidden = n < 2 || !shown();
    if (chip.hidden) return;
    chipText.textContent = n + ' picked · drag them onto the tree · the right button · Delete';
    const r = host.getBoundingClientRect();
    chip.style.top = Math.round(Math.max(4, r.top + 4)) + 'px';
    chip.style.left = Math.round(r.left + 6) + 'px';
    chip.style.maxWidth = Math.round(Math.max(120, r.width - 12)) + 'px';
  }

  function _paint() {
    for (const t of tiles()) t.classList.toggle('is-picked', picked.has(t.dataset.key));
    _chip();
  }
  function _set(keys, quiet) {
    picked = new Set(keys);
    _paint();
    if (!quiet) opt.onChange([...picked]);
  }
  function clear() {
    anchor = '';
    if (!picked.size) return;
    _set([]);
  }

  // ── Presses on tiles: the capture phase, before a tile's own click ──
  host.addEventListener('click', (e) => {
    if (!opt.active() || e.button !== 0) return;
    const t = tileOf(e.target);
    if (!t) return;
    // A control on the tile (the star, the cross, a menu) is its own.
    const ctl = e.target.closest('button, select, input, a, label');
    if (ctl && t.contains(ctl)) return;
    const key = t.dataset.key;
    if (e.shiftKey) {
      e.preventDefault(); e.stopPropagation();
      const list = tiles().map(x => x.dataset.key);
      const a = list.indexOf(anchor), b = list.indexOf(key);
      const span = a < 0 ? [key] : list.slice(Math.min(a, b), Math.max(a, b) + 1);
      _set(e.ctrlKey || e.metaKey ? [...picked, ...span] : span);
      if (a < 0) anchor = key;
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault(); e.stopPropagation();
      const next = new Set(picked);
      if (next.has(key)) next.delete(key); else next.add(key);
      anchor = key;
      _set([...next]);
      return;
    }
    anchor = key;
    _set([key]);
  }, true);

  // ── A band from empty space ──
  let band = null;            // { x, y, el, base, moved }
  host.addEventListener('pointerdown', (e) => {
    pressedHere = true;
    if (!opt.active() || e.button !== 0) return;
    if (tileOf(e.target)) return;
    // Empty space only: not a folder tile, a word of the path, the search, a button.
    if (e.target.closest('button, input, select, textarea, a, .mt-ftile, .mt-crumbs, .snd-shelf-head, [draggable="true"]')) return;
    // No preventDefault here: it would take the mousedown away from every "press away" of the page (Merge's picked clips,
    // the menus, the fields). Text is kept from being selected under the band by `selectstart` below.
    band = { x: e.clientX, y: e.clientY, el: null, base: e.shiftKey ? [...picked] : [], moved: false, id: e.pointerId };
  });
  document.addEventListener('selectstart', (e) => { if (band) e.preventDefault(); });
  const move = (e) => {
    if (!band) return;
    if (!band.moved && Math.hypot(e.clientX - band.x, e.clientY - band.y) < BAND_FROM) return;
    if (!band.el) {
      band.el = document.createElement('div');
      band.el.className = 'ts-band';
      document.body.appendChild(band.el);
    }
    band.moved = true;
    const r = { left: Math.min(band.x, e.clientX), top: Math.min(band.y, e.clientY),
      right: Math.max(band.x, e.clientX), bottom: Math.max(band.y, e.clientY) };
    Object.assign(band.el.style, { left: r.left + 'px', top: r.top + 'px', width: (r.right - r.left) + 'px', height: (r.bottom - r.top) + 'px' });
    const hits = tiles().filter(t => _hit(r, t.getBoundingClientRect())).map(t => t.dataset.key);
    picked = new Set([...band.base, ...hits]);
    _paint();
    // The gallery scrolls under the band near its edges.
    const sc = _scroller(host);
    if (sc) {
      const hr = sc.getBoundingClientRect();
      if (e.clientY > hr.bottom - 24) sc.scrollTop += 14;
      else if (e.clientY < hr.top + 24) sc.scrollTop -= 14;
    }
  };
  const up = () => {
    if (!band) return;
    const b = band;
    band = null;
    if (b.el) b.el.remove();
    if (b.moved) opt.onChange([...picked]);
    else if (!b.base.length) clear();       // a press on empty space: nothing picked
  };
  document.addEventListener('pointermove', move);
  document.addEventListener('pointerup', up);
  document.addEventListener('pointercancel', up);
  // A press anywhere else: the keys are not this gallery's any more.
  document.addEventListener('pointerdown', (e) => { if (!host.contains(e.target) && !chip.contains(e.target)) pressedHere = false; }, true);

  // ── Keys ──
  // In the capture phase, before the page's own: Delete after a press in this gallery is the gallery's ALONE - it is
  // taken (preventDefault), and Merge's timeline lets a taken key be (timeline-b.js `defaultPrevented`). After a press
  // anywhere else this gallery does not answer Delete.
  document.addEventListener('keydown', (e) => {
    if (!picked.size || !shown() || _inField(e.target)) return;
    if (e.target && e.target.closest && e.target.closest('[data-own-keys]')) return;
    if (e.key === 'Escape') {
      if (Layers.top()) return;               // a window on top takes Escape (js/layers.js)
      clear();
      return;
    }
    if (e.key === 'Delete' && pressedHere && !Layers.blocked() && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      opt.onDelete([...picked]);
    }
  }, true);
  window.addEventListener('resize', _chip);
  // The gallery put away (another view of Merge's panel, another shelf, a making area): what was picked is let go, and
  // the chip with it. Shown again or resized: the chip where the gallery is.
  if (typeof ResizeObserver === 'function') {
    new ResizeObserver(() => { if (!shown()) clear(); _chip(); }).observe(host);
  }

  return {
    has: (key) => picked.has(String(key)),
    keys: () => [...picked],
    size: () => picked.size,
    clear,
    /** The gallery drawn again: the picked that are still there stay picked. */
    refresh() {
      const here = new Set(tiles().map(t => t.dataset.key));
      const keep = [...picked].filter(k => here.has(k));
      if (keep.length !== picked.size) _set(keep); else _paint();
    },
    /** One tile alone (a press that opened something elsewhere). */
    only(key) { anchor = String(key); _set([String(key)]); },
  };
}

function _scroller(el) {
  for (let e = el; e && e !== document.body; e = e.parentElement) {
    const s = getComputedStyle(e);
    if (/(auto|scroll)/.test(s.overflowY) && e.scrollHeight > e.clientHeight) return e;
  }
  return null;
}

// ── The menu for several ──
let _m = null;
function _closeMenu() {
  if (!_m) return;
  _m.el.remove();
  document.removeEventListener('mousedown', _m.away, true);
  window.removeEventListener('scroll', _closeMenu, true);
  Layers.close(_m.layer);
  _m = null;
}

export function menuAt(x, y, rows) {
  _closeMenu();
  const m = document.createElement('div');
  m.className = 'mv3-plus-menu ts-menu';
  for (const [label, sub, fn, danger] of rows) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'mv3-plus-item' + (danger ? ' is-danger' : '');
    const t = document.createElement('span');
    t.textContent = label;
    b.appendChild(t);
    if (sub) { const s = document.createElement('small'); s.textContent = sub; b.appendChild(s); }
    if (fn) b.addEventListener('click', (e) => { e.stopPropagation(); _closeMenu(); fn(b); });
    else b.disabled = true;
    m.appendChild(b);
  }
  document.body.appendChild(m);
  const w = m.offsetWidth, h = m.offsetHeight;
  m.style.left = Math.round(Math.max(6, Math.min(window.innerWidth - w - 6, x))) + 'px';
  m.style.top = Math.round(Math.max(6, Math.min(window.innerHeight - h - 6, y))) + 'px';
  const away = (e) => { if (!m.contains(e.target)) _closeMenu(); };
  const layer = Layers.open(m, { modal: false, name: 'tiles menu', onEsc: _closeMenu });
  _m = { el: m, away, layer };
  setTimeout(() => document.addEventListener('mousedown', away, true), 0);
  window.addEventListener('scroll', _closeMenu, true);
}

// ═══════════════════════════════════════════════════════════════════════════
// What both pages do with several (routes/library.js POST /api/library/batch/*).
// ═══════════════════════════════════════════════════════════════════════════


const VIDEO = new Set(['birols', 'uploads', 'hooks']);
const _plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');

/** Whether a tile of `kind` can go to the place `to` - one tile let go on a node, as js/media-tree.js _dropAction. */
export function canGo(kind, to) {
  if (!to || kind === 'sfx' || kind === 'heads' || kind === 'youtube') return false;
  if (kind === 'music' || to.kind === 'music') return kind === to.kind;
  if (kind === 'references' || to.kind === 'references') return kind === to.kind;
  if (kind === to.kind) return true;
  return VIDEO.has(kind) && VIDEO.has(to.kind);
}

/** POST /api/library/batch/<op> for the items; the answer, or it throws in words. */
export async function batch(op, items, extra) {
  if (items.length > BATCH_MAX) throw new Error('At most ' + BATCH_MAX + ' at once - ' + items.length + ' are picked.');
  const r = await fetch('/api/library/batch/' + op, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(Object.assign({ items: items.map(x => ({ kind: x.kind, id: String(x.id) })) }, extra || {})),
  });
  const d = await r.json().catch(() => null);
  if (!d || !d.success) throw new Error((d && d.error) || ('status ' + r.status));
  return d;
}

/** "4 moved · 2 stayed: a picture never becomes a clip" - what an answer of batch() says. */
export function saidOf(d, verb) {
  const sk = (d && d.skipped) || [];
  const whys = [...new Set(sk.map(x => x.why))].slice(0, 3).join('; ');
  return (d.done ? _plural(d.done, 'item') + ' ' + verb : 'Nothing ' + verb) + (sk.length ? ' · ' + sk.length + ' stayed: ' + whys : '');
}

/** The ONE question before several are deleted - their names, and the projects whose timelines hold their files. */
export async function deleteQuestion(items) {
  const n = items.length;
  const names = items.slice(0, 8).map(i => '  ' + (i.name || i.id));
  if (n > 8) names.push('  … and ' + (n - 8) + ' more');
  let text = 'Delete ' + _plural(n, 'item') + '?\n\n' + names.join('\n') + '\n\nTheir files are removed from disk.';
  if (items.some(i => i.kind === 'sfx')) text += '\nBuilt-in sounds are the app\'s - they stay.';
  const media = [];
  for (const i of items) {
    if (i.media) media.push(String(i.media));
    for (const f of ((i.meta && i.meta.items) || [])) if (f && f.path) media.push(String(f.path));
  }
  let projects = [];
  try {
    const d = await fetch('/api/library/usage', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ media }) }).then(r => r.json());
    projects = (d && d.projects) || [];
  } catch (e) { projects = []; }
  if (projects.length) {
    const lines = projects.slice(0, 10).map(p => '  «' + p.title + '» - ' + _plural(p.clips, 'clip'));
    if (projects.length > 10) lines.push('  … and ' + (projects.length - 10) + ' more');
    text += '\n\nUsed in ' + _plural(projects.length, 'project') + ':\n' + lines.join('\n') + '\n\nThere their clips turn red - to be replaced or removed.';
  }
  return text;
}

// The place picker opens by a point (the menu that asked is gone by then): a small fixed mark stands in for an anchor.
let _mark = null;
function _anchorAt(x, y) {
  if (!_mark) { _mark = document.createElement('div'); _mark.className = 'ts-anchor'; document.body.appendChild(_mark); }
  Object.assign(_mark.style, { left: Math.round(x) + 'px', top: Math.round(y) + 'px' });
  return _mark;
}

/** "Move to…" for several: the place picker over the media tree (AUDIO too); a place none of them can go to is grey. */
export async function moveMany(x, y, items, o) {
  const opt = o || {};
  let tree = [];
  try { tree = ((await fetch('/api/library/tree').then(r => r.json())) || {}).nodes || []; } catch (e) { tree = []; }
  const kinds = [...new Set(items.map(i => i.kind))];
  openPlaces(_anchorAt(x, y), {
    title: 'Move ' + _plural(items.length, 'item') + ' to', tree, name: 'move several',
    places: { audio: true, newCats: kinds.filter(k => ['birols', 'uploads', 'hooks', 'images', 'sounds', 'references', 'music'].includes(k)) },
    why: (to) => (kinds.some(k => canGo(k, to)) ? '' : 'none of them goes there'),
    onPick: async (to) => {
      try {
        const d = await batch('move', items, { to: { kind: to.kind, cat: to.cat || '', label: to.label || '', folder: to.folder || '', mood: to.mood || '' } });
        await (opt.done ? opt.done(d) : null);
        if (opt.status) opt.status(saidOf(d, 'moved to ' + (to.text || to.label || to.kind)), !d.done && (d.skipped || []).length > 0);
      } catch (e) { if (opt.status) opt.status('Could not move them: ' + e.message, true); }
    },
  });
}
