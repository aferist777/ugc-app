/* ═══════════════════════════════════════════════════════════════════════════
   A CLIP'S EFFECTS - WHERE THE PERSON PUTS THEM (phase V84, the owner 2026-11-09/10; docs/local-app/plan/, "Подфаза 3 — V84",
   (р8), (эф4)-(эф7)).

   - THE LIST (openList): the effects of public/js/fx/effects.js by their groups, each with its line - at the clip's right button
     ("Add effect…", timeline-b.js _clipMenu) and at the inspector's "+ Effect".
   - ADDED TO THE WHOLE CLIP ((эф4)): it starts with the clip (fx/params.js newEffect) - a moment of its own length lasts that
     length, one that goes on lasts to the clip's end -, written in one undo step, and the preview plays its stretch once ((эф7)).
   - THE INSPECTOR'S GROUP "Effects" (fxGroup, after Color): a row a effect - its name, where it runs, ✕; the row pressed opens its
     Start and End (seconds into the clip; fx/params.js placeEffect). The effect open is the one whose frame was pressed on the
     timeline (focus) - kept for the clip it belongs to.
   ═══════════════════════════════════════════════════════════════════════════ */

import * as Layers from '../layers.js';
import { EFFECTS, GROUPS, effectOf } from '../fx/effects.js';
import { normalizeFx, newEffect, placeEffect, spanOf, lengthRange } from '../fx/params.js';
import { setClipFields, selectClipById } from './timeline-b.js';
import * as C from './controls.js';

// ── Which effect is open ────────────────────────────────────────────────────
let _focus = null;              // { clipId, fxId }
const _onFocus = [];
/** Open effect `fxId` of clip `clipId` in the inspector (a frame pressed on the timeline, an effect just added). */
export function focus(clipId, fxId) {
  _focus = clipId && fxId ? { clipId: String(clipId), fxId: String(fxId) } : null;
  for (const cb of _onFocus) { try { cb(); } catch (e) { /* the listener's own trouble */ } }
}
export function onFocus(cb) { if (typeof cb === 'function') _onFocus.push(cb); }
const _isOpen = (clipId, fxId) => !!(_focus && _focus.clipId === String(clipId) && _focus.fxId === String(fxId));

// ── The list ────────────────────────────────────────────────────────────────
let _menu = null;
function _close() {
  if (!_menu) return;
  _menu.el.remove();
  document.removeEventListener('mousedown', _menu.away, true);
  window.removeEventListener('scroll', _menu.scroll, true);
  Layers.close(_menu.layer);
  _menu = null;
}

/** The list of effects at the pointer (`at` - { clientX, clientY }); `onPick(key)` when one is pressed. */
export function openList(at, onPick) {
  _close();
  const box = document.createElement('div');
  box.className = 'mv3-plus-menu u-menu is-float mv3-fx-menu';
  for (const [g, title] of GROUPS) {
    const h = document.createElement('div');
    h.className = 'mv3-fx-mh';
    h.textContent = title;
    box.appendChild(h);
    for (const [k, d] of Object.entries(EFFECTS)) {
      if (d.group !== g) continue;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'mv3-plus-item u-mi';
      b.title = d.about;
      const s = document.createElement('span');
      s.textContent = d.name;
      const m = document.createElement('small');
      m.textContent = d.about;
      b.append(s, m);
      b.addEventListener('click', (ev) => { ev.stopPropagation(); _close(); onPick(k); });
      box.appendChild(b);
    }
  }
  document.body.appendChild(box);
  const w = box.offsetWidth, h = box.offsetHeight;
  box.style.left = Math.round(Math.max(6, Math.min(window.innerWidth - w - 6, +at.clientX || 0))) + 'px';
  box.style.top = Math.round(Math.max(6, Math.min(window.innerHeight - h - 6, +at.clientY || 0))) + 'px';
  const away = (ev) => { if (!box.contains(ev.target)) _close(); };
  // The page scrolled under it closes it; the list scrolled in itself (it is taller than a small window) does not.
  const scroll = (ev) => { if (!(ev.target instanceof Node) || !box.contains(ev.target)) _close(); };
  const layer = Layers.open(box, { modal: false, name: 'effects', onEsc: _close });
  _menu = { el: box, away, scroll, layer };
  document.addEventListener('mousedown', away, true);
  window.addEventListener('scroll', scroll, true);
}

// ── Adding one ──────────────────────────────────────────────────────────────
/** Effect `k` on the whole of clip `clip` of lane `track`: written (one undo step), opened, played once on the preview. */
export function addTo(track, clip, k) {
  const e = newEffect(clip, k);
  if (!e) return;
  const list = normalizeFx([...(clip.fx || []), e]) || [];
  const kept = list.find((x) => x.k === e.k && Math.abs(x.t0 - e.t0) < 1e-3 && x.id === e.id) || list[list.length - 1];
  setClipFields(track.id, clip.id, { fx: list });
  selectClipById(clip.id);
  if (kept) focus(clip.id, kept.id);
  const sp = spanOf({ ...clip, fx: list }, kept || e);
  import('./preview-b.js').then((P) => { if (P.playStretch) P.playStretch(Math.max(+clip.start || 0, sp.a - 0.3), sp.b + 0.3, sp.a); })
    .catch(() => { /* no preview to play it on */ });
}

// ── The inspector's group ───────────────────────────────────────────────────
const _sec = (v) => (Math.round(v * 100) / 100).toFixed(2) + ' s';

/** The group "Effects" of one clip into `g` (a group of the inspector, js/merge-v3/inspector.js). */
export function fxRows(g, track, c) {
  const list = Array.isArray(c.fx) ? c.fx : [];
  const dur = +c.dur || 0;
  const start = +c.start || 0;
  const write = (next) => setClipFields(track.id, c.id, { fx: next.length ? next : null });
  if (!list.length) g.appendChild(C.hint('No effects. Added, one covers the whole clip - its start and end move here.'));
  for (const e of list) {
    const d = effectOf(e.k);
    if (!d) continue;
    const sp = spanOf(c, e);
    const a = sp.a - start, b = sp.b - start;
    const outside = !(sp.b > sp.a + 1e-3);
    const open = _isOpen(c.id, e.id) && !outside;
    const row = document.createElement('div');
    row.className = 'mv3-fx-row' + (open ? ' is-open' : '') + (outside ? ' is-out' : '');
    const name = document.createElement('button');
    name.type = 'button';
    name.className = 'mv3-fx-name';
    name.title = d.about + (outside ? ' - it lies outside the clip now (trimmed away).' : '');
    const nm = document.createElement('span');
    nm.textContent = d.name;
    const when = document.createElement('small');
    when.textContent = outside ? 'outside the clip' : (_sec(a) + ' – ' + (sp.whole ? 'end' : _sec(b)));
    name.append(nm, when);
    name.addEventListener('click', () => { if (!outside) focus(c.id, open ? null : e.id); });
    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'mv3-fx-x u-btn is-s is-icon is-quiet u-x';
    x.title = 'Take this effect off the clip (Ctrl+Z puts it back)';
    x.setAttribute('aria-label', 'Remove the effect');
    x.addEventListener('click', () => write(list.filter((y) => y.id !== e.id)));
    row.append(name, x);
    g.appendChild(row);
    if (!open) continue;
    // Start and End, seconds into the clip. An 'intro' keeps its length's range (0.8-2 of its own); one that goes on reaches the end.
    const [lo, hi] = lengthRange(e.k);
    const len = b - a;
    const moveTo = (na, nb) => write(list.map((y) => (y.id === e.id ? placeEffect(c, e, na, nb) : y)));
    g.appendChild(C.row('Start', C.slider({
      min: 0, max: Math.max(0.05, dur - 0.05), step: 0.05, value: Math.max(0, a), fmt: _sec,
      onChange: (v) => moveTo(v, v + len),
    })));
    const endMin = Math.min(dur, a + (d.kind === 'intro' ? lo : 0.3));
    const endMax = Math.min(dur, a + (d.kind === 'intro' ? hi : dur));
    g.appendChild(C.row('End', C.slider({
      min: endMin, max: Math.max(endMin + 0.05, endMax), step: 0.05, value: Math.min(endMax, Math.max(endMin, b)),
      fmt: (v) => (d.kind !== 'intro' && v >= dur - 0.01 ? 'end of clip' : _sec(v)),
      onChange: (v) => moveTo(a, v),
    })));
    g.appendChild(C.hint(d.about + (d.kind === 'intro' ? ' Its length goes from ' + lo.toFixed(2) + ' to ' + hi.toFixed(2) + ' s.' : '')));
  }
  const add = C.button('+ Effect', (ev) => openList(ev, (k) => addTo(track, c, k)),
    { title: 'Add an effect to the whole clip - its start and end move here, Ctrl+Z takes it off' });
  g.appendChild(C.row('', add));
}
