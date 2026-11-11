/* ═══════════════════════════════════════════════════════════════════════════
   A CLIP'S EFFECTS - WHERE THE PERSON PUTS THEM (phase V84, the owner 2026-11-09/10; docs/local-app/plan/, "Подфаза 3 — V84",
   (р8), (эф4)-(эф7)).

   - THE PANEL (the owner 2026-11-10, (эф13)-(эф16); it was a list at the pointer until then): the full-width "+ Effect" under the
     group's rows opens it, it shuts only by that button - chips of the groups, the chosen group's tiles three a row (pictures and
     films made beforehand, public/fx-tiles/ by tools/fx-tiles.js, the film playing only under the pointer, the effect's line over
     its row). The clip's "Add effect…" (timeline-b.js _clipMenu) picks it and opens the group Effects with the panel (openPanel).
   - ADDED TO THE WHOLE CLIP ((эф4)): it starts with the clip (fx/params.js newEffect) - a moment of its own length lasts that
     length, one that goes on lasts to the clip's end -, written in one undo step, and the preview plays its stretch once ((эф7)).
   - (block 1c) BY THE FACE (Snap zoom, Face mosaic - effects.js `face`): added, the clip's film is counted for its faces first
     (lib/faces.js, the app's hidden window; "finding the face…" in the group meanwhile) and the face's place in the frame over the
     clip written with it (`path`, `pk`) - one write; none found, it works where a face usually is, and the group says why.
   - THE INSPECTOR'S GROUP "Effects" (fxGroup, after Color): a row a effect - its name, where it runs, ✕; the row pressed opens its
     Start and End (seconds into the clip; fx/params.js placeEffect). The effect open is the one whose row was pressed (its frame shows on the
     timeline, focus) - kept for the clip it belongs to. Start and End are ONE track with two thumbs (controls.js span; the owner
     2026-11-10: one row).
   - (the owner's (эф11), 2026-11-11) ON SEVERAL AT ONCE: several picked clips (fxManyRows) - a tile puts the effect on each as on it
     alone, ✕ on a kind takes it off all of them, one undo step; the ticked highlights fragments (hl-group.js, laneEffects) - each
     fragment's main video as one film: a moment at its start, one that goes on over the whole of it.
   ═══════════════════════════════════════════════════════════════════════════ */

import { EFFECTS, GROUPS, SETS, effectOf, colorsOf, optsOf, textsOf } from '../fx/effects.js';
import { normalizeFx, newEffect, placeEffect, spanOf, lengthRange, fileAt, PATH_MAX, TEXT_MAX, setPlacements } from '../fx/params.js';
import { loadFamily } from '../fx/kit.js';
import { FONTS as CAP_FONTS } from '../captions/fonts.js';
import { setClipFields, setClipsFields, selectClipById, fxLive } from './timeline-b.js';
import { setLive } from './place-b.js';
import * as C from './controls.js';

// (block 4b, the owner's (б4-12)) A graphic effect's colours as chosen last for it - a new one takes them (this computer only).
const COLORS_KEY = 'mv3_fx_colors_v1';
function _colorsMem() {
  try { const m = JSON.parse(localStorage.getItem(COLORS_KEY) || '{}'); return m && typeof m === 'object' ? m : {}; } catch (e) { return {}; }
}
function _rememberColors(k, col) {
  const m = _colorsMem();
  m[k] = col;
  try { localStorage.setItem(COLORS_KEY, JSON.stringify(m)); } catch (e) { /* a private window */ }
}

// ── Which effect is open ────────────────────────────────────────────────────
let _focus = null;              // { clipId, fxId }
const _onFocus = [];
/** Open effect `fxId` of clip `clipId` in the inspector (its row pressed, an effect just added) - its frame shows on the timeline. */
export function focus(clipId, fxId) {
  _focus = clipId && fxId ? { clipId: String(clipId), fxId: String(fxId) } : null;
  if (_focus) _openAsk = true;
  for (const cb of _onFocus) { try { cb(); } catch (e) { /* the listener's own trouble */ } }
}
export function onFocus(cb) { if (typeof cb === 'function') _onFocus.push(cb); }
/** The effect open in the inspector - { clipId, fxId } or null (timeline-b.js shows its frame). */
export function focusOf() { return _focus ? { ..._focus } : null; }
const _isOpen = (clipId, fxId) => !!(_focus && _focus.clipId === String(clipId) && _focus.fxId === String(fxId));

// ── The panel of tiles (the owner 2026-11-10, (эф13)-(эф16)) ───────────────
// Under the group's rows, the full-width "+ Effect" opens and shuts the PANEL - it never shuts by itself: the chips of the groups
// on top (Zoom & motion · Color & light · Face · Sets), the chosen one's TILES under them, three a row. A tile is a picture made
// beforehand (public/fx-tiles/<key>.webp - tools/fx-tiles.js, the app's own render on the owner's example clip) and a short film
// (<key>.webm) played only while the pointer is on it; over it, the width of the strip, its line. A press puts the effect on the
// whole clip at once, opens its row and outlines its tile. Open / shut and the chip are the viewer's convenience (localStorage).
const PANEL_KEY = 'mv3_fx_panel_v1';
const CHIPS = [...GROUPS, ['sets', 'Sets']];
let _panel = null;
function _panelNow() {
  if (!_panel) {
    try { _panel = JSON.parse(localStorage.getItem(PANEL_KEY) || 'null'); } catch (e) { _panel = null; }
    if (!_panel || typeof _panel !== 'object') _panel = {};
    if (!CHIPS.some(([g]) => g === _panel.chip)) _panel.chip = CHIPS[0][0];
    _panel.open = !!_panel.open;
  }
  return _panel;
}
function _panelSave() { try { localStorage.setItem(PANEL_KEY, JSON.stringify(_panelNow())); } catch (e) { /* a private window */ } }

// The inspector opens its group Effects once when asked (an effect opened, an effect added, the clip's
// "Add effect…") - the owner's (эф19); inspector.js takes the ask when it paints.
let _openAsk = false;
/** Whether the group Effects is to be opened by this paint (asked once). */
export function takeOpenAsk() { const v = _openAsk; _openAsk = false; return v; }

/** The clip's "Add effect…" (timeline-b.js _clipMenu): the clip picked, its group Effects open with the panel. */
export function openPanel(track, clip) {
  _panelNow().open = true;
  _panelSave();
  _openAsk = true;
  selectClipById(clip.id);
  _say();
  setTimeout(() => {
    const el = document.querySelector('.mv3-fx-panel');
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, 60);
}

const _tileKey = (k) => (String(k).startsWith('set:') ? 'set-' + String(k).slice(4) : k);
/** One tile: its picture, its film while the pointer is on it, its name under it. */
function _tile(key, name, about, on, onPress, tip) {
  const t = document.createElement('button');
  t.type = 'button';
  t.className = 'mv3-fx-tile' + (on ? ' is-on' : '');
  t.setAttribute('aria-label', name);
  const pic = document.createElement('span');
  pic.className = 'mv3-fx-tile-pic';
  const img = document.createElement('img');
  img.alt = '';
  img.loading = 'lazy';
  img.src = '/fx-tiles/' + _tileKey(key) + '.webp';
  img.addEventListener('error', () => { img.remove(); });
  pic.appendChild(img);
  const nm = document.createElement('span');
  nm.className = 'mv3-fx-tile-name';
  nm.textContent = name;
  t.append(pic, nm);
  let vid = null;
  t.addEventListener('mouseenter', () => {
    tip(t, name, about);
    vid = document.createElement('video');
    vid.muted = true;
    vid.loop = true;
    vid.playsInline = true;
    vid.src = '/fx-tiles/' + _tileKey(key) + '.webm';
    vid.addEventListener('playing', () => { if (vid) vid.classList.add('is-on'); });
    vid.addEventListener('error', () => { if (vid) { vid.remove(); vid = null; } });
    pic.appendChild(vid);
    vid.play().catch(() => { /* not ready - the picture stays */ });
  });
  t.addEventListener('mouseleave', () => {
    tip(null);
    if (vid) { vid.pause(); vid.removeAttribute('src'); vid.remove(); vid = null; }
  });
  t.addEventListener('click', onPress);
  return t;
}

/** The panel into `g`: the chips and the chosen group's tiles; `press(key)` - what a tile does (`key` an effect or 'set:<id>'). */
function _panelEl(g, onKey, press) {
  const st = _panelNow();
  const box = document.createElement('div');
  box.className = 'mv3-fx-panel';
  const chips = document.createElement('div');
  chips.className = 'u-chips mv3-fx-chips';
  for (const [id, title] of CHIPS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'u-chip' + (st.chip === id ? ' is-on' : '');
    b.textContent = title;
    b.addEventListener('click', () => { st.chip = id; _panelSave(); _say(); });
    chips.appendChild(b);
  }
  box.appendChild(chips);
  // The line of the tile under the pointer, over its row, the width of the strip.
  const tipEl = document.createElement('div');
  tipEl.className = 'mv3-fx-tip';
  tipEl.hidden = true;
  const tip = (tile, name, about) => {
    if (!tile) { tipEl.hidden = true; return; }
    tipEl.textContent = '';
    const b = document.createElement('b');
    b.textContent = name;
    tipEl.append(b, document.createTextNode(' — ' + about));
    tipEl.hidden = false;
    tipEl.style.top = Math.max(0, tile.offsetTop - tipEl.offsetHeight - 6) + 'px';
  };
  const grid = document.createElement('div');
  grid.className = 'mv3-fx-tiles';
  if (st.chip === 'sets') {
    for (const [id, set] of Object.entries(SETS)) {
      grid.appendChild(_tile('set:' + id, set.name, set.about, onKey === 'set:' + id, () => press('set:' + id), tip));
    }
  } else {
    for (const [k, d] of Object.entries(EFFECTS)) {
      if (d.group !== st.chip) continue;
      const lim = d.kind !== 'intro' ? '' : d.hold != null ? ' It stands for as long as you set it.'
        : ' Its length goes from ' + lengthRange(k).map((v) => v.toFixed(2)).join(' to ') + ' s.';
      grid.appendChild(_tile(k, d.name, d.about + lim, onKey === k, () => press(k), tip));
    }
  }
  box.append(grid, tipEl);
  g.appendChild(box);
}
let _picked = null;            // { clipId, key } - the tile pressed last (a set's tile stays outlined while its first effect is open)

// ── Where the face is (block 1c, the owner's (эф12)) ────────────────────────
// The clip's film counted by the app's hidden faces window (lib/faces.js - once a file, kept in cache/faces/; only in the app's
// window) and its face carried to where the clip shows it in the frame, by the preview's own rule (preview-b.js mapsOf: fill, the
// frame following the faces, a PiP, a crop, an insert), five a second over the whole clip - `path` of effects.js faceAt. One face
// is followed: the largest at first, then the nearest to the last. The clip laid otherwise later (`pk` no longer its own), the
// inspector says so and finds it again on a press.
const FILM_RE = /\.(mp4|mov|webm|m4v)$/i;
const isMain = (track) => !!(track && track.kind === 'video' && track.main);
const _pending = new Map();      // clipId -> { k, frac } - a face being found for an effect about to be added (or found again)
const _why = new Map();          // effect id -> why it has no face, said under it until the page is reloaded
const WHY = {
  picture: 'A picture: it works where a face usually is in a vertical frame.',
  noWorker: 'Faces are found in the app\'s own window - not here. It works where a face usually is.',
  noFace: 'No face in this clip - it works where a face usually is.',
  error: 'The faces could not be found - it works where a face usually is.',
};
const _say = () => { for (const cb of _onFocus) { try { cb(); } catch (e) { /* the listener's own trouble */ } } };

/** How clip `c` lies in the frame - what decides where its face shows (a short print, `pk`). */
function _placeKey(c, main) {
  // Defaults said one way (a clip's 'fit' is kept as nothing once saved).
  const num = (v) => (v == null || v === '' || !Number.isFinite(+v) ? null : +v);
  const s = JSON.stringify([!!main, String(c.fit || 'fit') === 'fill' ? 'fill' : 'fit', c.cropAlign || 'center',
    c.crop && !c.crop.off ? c.crop : null, !!c.pip, num(c.tx), num(c.ty), num(c.tw), num(c.angle) || 0, c.frame || null]);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

async function _json(url, init) {
  try { const r = await fetch(url, init); return await r.json(); } catch (e) { return null; }
}

/** The face's path over clip `c` of lane `track` - { path } or { why }. `onFrac(0..1)` while the film is counted. */
async function _findPath(track, c, onFrac) {
  if (!FILM_RE.test(String(c.src || '').split('?')[0])) return { why: 'picture' };
  const start = await _json('/api/faces/find', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ src: c.src }) });
  if (!start || !start.success) return { why: 'error' };
  let rec = null;
  for (let i = 0; i < 1800 && !rec; i++) {
    const st = await _json('/api/faces/of?full=1&src=' + encodeURIComponent(c.src));
    if (st && st.state === 'ready' && st.faces) { rec = st.faces; break; }
    if (!st || st.state === 'failed' || st.state === 'none') return { why: st && st.noWorker ? 'noWorker' : 'error' };
    if (onFrac) onFrac(+st.frac || 0);
    await new Promise((r) => setTimeout(r, 700));
  }
  if (!rec || !Array.isArray(rec.frames) || !(rec.w > 0 && rec.h > 0)) return { why: 'error' };
  const PV = await import('./preview-b.js');
  const main = isMain(track);
  const fps = +rec.fps || 5;
  const a = +c.start || 0, dur = +c.dur || 0;
  const n = Math.min(PATH_MAX, Math.max(2, Math.ceil(dur * 5) + 1));
  const out = [];
  let prev = null;
  for (let i = 0; i < n; i++) {
    const t = Math.min(a + dur - 1e-3, a + (dur * i) / (n - 1));
    const tf = fileAt(c, t);
    const boxes = (rec.frames[Math.max(0, Math.min(rec.frames.length - 1, Math.round(tf * fps)))] || []).filter((b) => b && b[2] > 0 && b[3] > 0);
    if (!boxes.length) continue;
    const mid = (b) => [b[0] + b[2] / 2, b[1] + b[3] / 2];
    let box = null;
    if (prev) {
      const p = mid(prev);
      let best = Infinity;
      for (const b of boxes) { const m = mid(b); const d = Math.hypot(m[0] - p[0], m[1] - p[1]); if (d < best) { best = d; box = b; } }
      if (best > 0.25) box = null;
    }
    if (!box) box = boxes.reduce((x, y) => (y[2] * y[3] > x[2] * x[3] ? y : x));
    prev = box;
    // Where the clip shows that point of its film at this moment (the map whose rectangle of the file holds it).
    let m = null;
    try { m = PV.mapsOf(c, main, rec.w, rec.h, t); } catch (e) { m = null; }
    if (!m || !m.W) continue;
    const [fx, fy] = mid(box);
    const map = (m.maps || []).find((q) => fx >= q.view.x && fx <= q.view.x + q.view.w && fy >= q.view.y && fy <= q.view.y + q.view.h);
    if (!map) continue;
    const { view, box: bx } = map;
    const lx = ((fx - view.x) / view.w - 0.5) * bx.dw, ly = ((fy - view.y) / view.h - 0.5) * bx.dh;
    const an = (+bx.angle || 0) * Math.PI / 180;
    const X = bx.cx + lx * Math.cos(an) - ly * Math.sin(an), Y = bx.cy + lx * Math.sin(an) + ly * Math.cos(an);
    out.push([tf, X / m.W, Y / m.H, (box[2] / view.w) * bx.dw / m.W, (box[3] / view.h) * bx.dh / m.H]);
  }
  out.sort((x, y) => x[0] - y[0]);
  return out.length ? { path: out, pk: _placeKey(c, main) } : { why: 'noFace' };
}

// ── Adding one ──────────────────────────────────────────────────────────────
const _r3 = (v) => Math.round(v * 1000) / 1000;
let _idn = 0;
const _newId = () => 'fx' + Date.now().toString(36) + (_idn++).toString(36) + Math.floor(Math.random() * 1296).toString(36);
/**
 * ONE new effect `k` on clip `clip`, `from` seconds into it (0 - its start): its length `len` when given (a set's), else its own,
 * cut to what is left of the clip from there; a cover's date the month it is made in; a graphic's colours as chosen last for it.
 */
function _one(clip, k, from = 0, len = 0) {
  const e = newEffect(clip, k, _newId());
  if (!e) return null;
  if (from > 0) e.t0 = _r3(fileAt(clip, (+clip.start || 0) + from));
  if (len > 0) e.len = len;
  else if (from > 0 && e.len > 0) {
    const [lo, hi] = lengthRange(k);
    e.len = _r3(Math.max(lo, Math.min(hi, e.len, (+clip.dur || 0) - from)));
  }
  if (k === 'magazine') {
    const now = new Date();
    e.txt = { date: now.toLocaleString('en-US', { month: 'long' }).toUpperCase() + ' ' + now.getFullYear() };
  }
  const mem = effectOf(k).colors ? _colorsMem()[k] : null;
  if (mem && typeof mem === 'object') e.col = { ...mem };
  return e;
}
/** What `k` (an effect, or 'set:<id>' - each its own afterwards) puts on the whole of clip `clip`: the new effects. */
function _effectsFor(clip, k) {
  const set = String(k).startsWith('set:') ? SETS[String(k).slice(4)] : null;
  // (block 4d, the owner's (б4-9)) A set's effects each at its own moment, moved earlier on a clip too short to end with it.
  return (set ? setPlacements(set, +clip.dur || 0) : [{ k, at: 0, len: 0 }]).map((it) => _one(clip, it.k, it.at, it.len)).filter(Boolean);
}
/**
 * (the owner's (эф11), 2026-11-11) What `k` puts on a LANE of clips taken as one film - a highlights fragment's main video: from the
 * lane's first moment, a set's effects at their own moments; a moment of its own length (or a set's with a length) on the clip
 * under its moment, from there; one that goes on - on that clip from there and on every clip after it. -> [{ clip, made }]
 */
export function laneEffects(clips, k) {
  const cs = (clips || []).filter((c) => c && c.src && !c.halfer).sort((a, b) => (+a.start || 0) - (+b.start || 0));
  if (!cs.length) return [];
  const s0 = +cs[0].start || 0;
  const end = Math.max(...cs.map((c) => (+c.start || 0) + (+c.dur || 0)));
  const set = String(k).startsWith('set:') ? SETS[String(k).slice(4)] : null;
  const by = new Map();
  const put = (clip, e) => { if (!e) return; const w = by.get(clip.id) || { clip, made: [] }; w.made.push(e); by.set(clip.id, w); };
  for (const it of (set ? setPlacements(set, end - s0) : [{ k, at: 0, len: 0 }])) {
    const d = effectOf(it.k);
    if (!d) continue;
    const m = s0 + it.at;
    const i0 = cs.findIndex((c) => m < (+c.start || 0) + (+c.dur || 0) - 1e-3);
    if (i0 < 0) continue;
    const c0 = cs[i0];
    put(c0, _one(c0, it.k, Math.max(0, m - (+c0.start || 0)), it.len));
    if (!(it.len > 0) && d.kind !== 'intro') for (const c of cs.slice(i0 + 1)) put(c, _one(c, it.k));
  }
  return [...by.values()];
}
/**
 * (эф11) The faces of the clips in `work` ([{ track, clip, made }]) whose new effects go by the face, found one clip after another
 * (`onStep(i, n, frac)`) and written into those effects (`path`, `pk`) - none found, the reason kept for the inspector.
 */
export async function facesFor(work, onStep) {
  const faced = work.filter((w) => w.made.some((e) => effectOf(e.k).face));
  for (let i = 0; i < faced.length; i++) {
    if (onStep) onStep(i, faced.length, 0);
    const r = await _findPath(faced[i].track, faced[i].clip, (f) => { if (onStep) onStep(i, faced.length, f); });
    for (const e of faced[i].made) {
      if (!effectOf(e.k).face) continue;
      if (r.path) { e.path = r.path; e.pk = r.pk; } else _why.set(e.id, r.why);
    }
  }
  return faced.length;
}

/**
 * Effect `k` on the whole of clip `clip` of lane `track` - or a set's effects, `k` 'set:<id>' (each its own afterwards): written
 * (one undo step), the first opened, played once on the preview. An effect by the face waits for its face first (block 1c) - one
 * write still.
 */
export async function addTo(track, clip, k) {
  const made = _effectsFor(clip, k);
  if (!made.length) return;
  if (made.some((e) => effectOf(e.k).face)) {
    if (_pending.has(clip.id)) return;
    const mine = { k: made[0].k, frac: 0 };
    _pending.set(clip.id, mine);
    _say();
    const r = await _findPath(track, clip, (f) => { mine.frac = f; _say(); });
    _pending.delete(clip.id);
    // The clip as it is now (it may have been trimmed or deleted meanwhile).
    const { timeline } = await import('./store.js');
    const tl = timeline();
    const lane = tl && (tl.tracks || []).find((x) => x.id === track.id);
    const now = lane && (lane.clips || []).find((x) => x.id === clip.id);
    if (!now) { _say(); return; }
    for (const e of made) {
      if (!effectOf(e.k).face) continue;
      if (r.path) { e.path = r.path; e.pk = r.pk; } else _why.set(e.id, r.why);
    }
    clip = now;
    track = lane;
  }
  const list = normalizeFx([...(clip.fx || []), ...made]) || [];
  const first = list.find((x) => x.id === made[0].id) || list[list.length - 1];
  setClipFields(track.id, clip.id, { fx: list });
  selectClipById(clip.id);
  if (first) focus(clip.id, first.id);
  const spans = made.map((e) => spanOf({ ...clip, fx: list }, list.find((x) => x.id === e.id) || e));
  const a = Math.min(...spans.map((x) => x.a)), b = Math.max(...spans.map((x) => x.b));
  import('./preview-b.js').then((P) => { if (P.playStretch) P.playStretch(Math.max(+clip.start || 0, a - 0.3), b + 0.3, a); })
    .catch(() => { /* no preview to play it on */ });
}

// ── (эф11) Several picked clips at once ────────────────────────────────────
let _many = null;               // { k, i, n, frac } - the faces being found for an effect going on several clips
/** Effect `k` (or a set) on EACH of the picked clips `items` ([{ track, clip }]) - as on each one alone; one write, one undo step. */
export async function addToMany(items, k) {
  if (_many) return;
  const work = items.map(({ track, clip }) => ({ track, clip, made: _effectsFor(clip, k) })).filter((w) => w.made.length);
  if (!work.length) return;
  if (work.some((w) => w.made.some((e) => effectOf(e.k).face))) {
    _many = { k: work[0].made[0].k, i: 0, n: 0, frac: 0 };
    _say();
    await facesFor(work, (i, n, frac) => { _many = { ..._many, i, n, frac }; _say(); });
    _many = null;
  }
  // The clips as they are now (trimmed or deleted meanwhile).
  const { timeline } = await import('./store.js');
  const tl = timeline() || {};
  const out = [];
  for (const w of work) {
    const lane = (tl.tracks || []).find((x) => x.id === w.track.id);
    const now = lane && (lane.clips || []).find((x) => x.id === w.clip.id);
    if (now) out.push({ trackId: lane.id, clipId: now.id, patch: { fx: normalizeFx([...(now.fx || []), ...w.made]) || [] } });
  }
  if (out.length) setClipsFields(out);
  _say();
}
/** Every effect of kind `k` taken off the picked clips `items` - one undo step. */
function _removeFromMany(items, k) {
  const out = items.filter(({ clip }) => (clip.fx || []).some((e) => e.k === k)).map(({ track, clip }) => {
    const left = (clip.fx || []).filter((e) => e.k !== k);
    return { trackId: track.id, clipId: clip.id, patch: { fx: left.length ? left : null } };
  });
  if (out.length) setClipsFields(out);
}
/** A row of the effects some of several have: its name, on how many, and ✕ - `off()` takes it off all of them. */
function _kindRow(g, k, said, off) {
  const d = effectOf(k);
  const row = document.createElement('div');
  row.className = 'mv3-fx-row';
  const name = document.createElement('span');
  name.className = 'mv3-fx-name';
  name.title = d.about;
  const nm = document.createElement('span');
  nm.textContent = d.name;
  const when = document.createElement('small');
  when.textContent = said;
  name.append(nm, when);
  row.appendChild(name);
  if (off) {
    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'mv3-fx-x u-btn is-s is-icon is-quiet u-x';
    x.title = 'Take ' + d.name + ' off all of them';
    x.setAttribute('aria-label', 'Remove the effect from all of them');
    x.addEventListener('click', off);
    row.appendChild(x);
  }
  g.appendChild(row);
}
/** The row of an effect waiting for faces: its name and "finding the faces… i of n". */
function _waitRow(g, w) {
  const d = effectOf(w.k);
  const row = document.createElement('div');
  row.className = 'mv3-fx-row is-wait';
  const name = document.createElement('span');
  name.className = 'mv3-fx-name';
  const nm = document.createElement('span');
  nm.textContent = d ? d.name : 'Effect';
  const when = document.createElement('small');
  when.textContent = 'finding the faces… ' + (w.n ? (w.i + 1) + ' of ' + w.n : '') + (w.frac > 0 ? ' · ' + Math.round(w.frac * 100) + ' %' : '');
  name.append(nm, when);
  row.appendChild(name);
  g.appendChild(row);
}
/** The full-width "+ Effect" and, open, the panel - a tile's press handed to `press(k)`. */
function _toggleAndPanel(g, press, title) {
  const st = _panelNow();
  const tog = C.button('+ Effect', () => { st.open = !st.open; _panelSave(); _say(); }, { title: st.open ? 'Hide the effects' : title });
  tog.classList.add('mv3-fx-add');
  if (st.open) tog.classList.add('is-on');
  tog.setAttribute('aria-expanded', st.open ? 'true' : 'false');
  g.appendChild(tog);
  if (st.open) _panelEl(g, null, press);
}
/**
 * (эф11) The group "Effects" of SEVERAL picked clips into `g` (inspector.js): the effects they have, each with how many of them and ✕
 * (off all of them, one undo step); the panel - a tile puts the effect on each of them, as on each one alone. Settings stay each clip's.
 */
export function fxManyRows(g, items) {
  const n = items.length;
  const kinds = new Map();
  for (const { clip } of items) {
    for (const e of (clip.fx || [])) { if (effectOf(e.k)) { if (!kinds.has(e.k)) kinds.set(e.k, new Set()); kinds.get(e.k).add(clip.id); } }
  }
  if (!kinds.size && !_many) g.appendChild(C.hint('None of the ' + n + ' clips has an effect.'));
  for (const [k, ids] of kinds) _kindRow(g, k, ids.size === n ? 'on all ' + n : 'on ' + ids.size + ' of ' + n, () => _removeFromMany(items, k));
  if (_many) _waitRow(g, _many);
  g.appendChild(C.hint('A tile puts the effect on each of the ' + n + ' clips, as on each one alone - a moment from its start, one that goes on to '
    + 'its end; Ctrl+Z takes it off all of them. Its settings are each clip’s own: pick one clip to change them.'));
  _toggleAndPanel(g, (k) => addToMany(items, k), 'Show the effects - a press on one puts it on each of the ' + n + ' clips');
}
/**
 * (эф11) The same for a group that is not this page's lanes - the ticked fragments of highlights (hl-group.js): the effects they have
 * (`kinds` [[k, how many]] of `n`, `off(k)`), the wait (`wait` { k, i, n, frac }), the toggle and the tiles - a press to `press(k)`.
 */
export function fxGroupRows(g, { n, kinds, off, wait, press, note }) {
  for (const [k, m] of kinds || []) if (effectOf(k)) _kindRow(g, k, m === n ? 'on all ' + n : 'on ' + m + ' of ' + n, off ? () => off(k) : null);
  if (wait) _waitRow(g, wait);
  if (note) g.appendChild(C.hint(note));
  _toggleAndPanel(g, press, 'Show the effects - a press on one puts it on each of the ' + n + ' fragments');
}

// ── The inspector's group ───────────────────────────────────────────────────
const _num = (v) => (Math.round(v * 100) / 100).toFixed(2);
const _sec = (v) => _num(v) + ' s';

/** The group "Effects" of one clip into `g` (a group of the inspector, js/merge-v3/inspector.js). */
export function fxRows(g, track, c) {
  const list = Array.isArray(c.fx) ? c.fx : [];
  const dur = +c.dur || 0;
  const start = +c.start || 0;
  const write = (next) => setClipFields(track.id, c.id, { fx: next.length ? next : null });
  if (!list.length && !_pending.has(c.id)) g.appendChild(C.hint('No effects. Added, one covers the whole clip - its start and end move here.'));
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
    // Start and End, seconds into the clip, on ONE track (the owner 2026-11-10: one row, not two). An 'intro' keeps its length's
    // range (0.8-2 of its own): the start moved keeps the end until the length leaves it, then the end follows; one that goes on
    // reaches the clip's end.
    const [lo, hi] = lengthRange(e.k);
    const intro = d.kind === 'intro';
    const minLen = intro ? lo : 0.3;
    const maxLen = intro ? hi : dur;
    const STEP = 0.05;
    const fit = (na, nb, which) => {
      let s = Math.max(0, Math.min(Math.max(0, dur - STEP), na));
      let t = Math.min(dur, nb);
      if (which === 'a') {
        if (t - s < minLen) t = s + minLen;
        if (t - s > maxLen) t = s + maxLen;
      } else {
        t = Math.max(s + minLen, Math.min(s + maxLen, t));
      }
      t = Math.min(dur, t);
      if (t >= dur - STEP) t = dur;
      return [s, t];
    };
    const moveTo = (na, nb) => write(list.map((y) => (y.id === e.id ? placeEffect(c, e, na, nb) : y)));
    // (the owner 2026-11-10) Its name over it, the strip's whole width, the clip's own length under it; the timeline's frame follows
    // the thumbs while they are held.
    g.appendChild(C.span({
      label: 'Start – End', ends: ['0', _sec(dur)],
      min: 0, max: Math.max(STEP, dur), step: STEP, a: Math.max(0, a), b: Math.min(dur, Math.max(a, b)),
      fit,
      fmt: (s, t) => _num(s) + '–' + (!intro && t >= dur - 0.01 ? 'end' : _num(t) + ' s'),
      onInput: (s, t) => fxLive(c.id, e.id, s, t),
      onChange: moveTo,
    }));
    g.appendChild(C.hint(d.about + (d.kind !== 'intro' ? ''
      : d.hold != null ? ' Set it longer than ' + d.dur.toFixed(2) + ' s and the card stands - up to the clip\'s end; shorter - from ' + lo.toFixed(2) + ' s.'
        : ' Its length goes from ' + lo.toFixed(2) + ' to ' + hi.toFixed(2) + ' s.')));
    // (block 4b, the owner's (б4-12), (б4-13)) Its colours and its settings: a change is one undo step; a slider held shows on the
    // preview at once (place-b.js setLive - the clip drawn with the effect as it would be), written on release.
    const withIt = (next) => list.map((y) => (y.id === e.id ? next : y));
    const put = (next) => write(normalizeFx(withIt(next)) || []);
    const live = (next) => setLive(new Map([[c.id, { fx: normalizeFx(withIt(next)) }]]));
    // (block 4c, the owner's (б4-2), (б4-13) а) A card's words, a field a line - the preview follows the typing, a field left (or
    // Enter) writes it, one undo step; and its font, one of the captions' (Inter by default).
    if (d.texts && d.texts.length) {
      const now = textsOf(e);
      for (const [key, label] of d.texts) {
        const inp = document.createElement('input');
        inp.type = 'text';
        inp.className = 'u-in is-s mv3-fx-text';
        inp.maxLength = TEXT_MAX;
        inp.value = now[key];
        inp.placeholder = 'nothing';
        const withTxt = () => ({ ...e, txt: { ...(e.txt || {}), [key]: inp.value } });
        inp.addEventListener('input', () => live(withTxt()));
        inp.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); inp.blur(); } });
        inp.addEventListener('change', () => { setLive(null); put(withTxt()); });
        inp.addEventListener('blur', () => setLive(null));
        g.appendChild(C.row(label, inp));
      }
      const sel = C.select([['', 'Inter (as made)'], ...CAP_FONTS.map((f) => [f.family, f.label])], e.font || '', async (v) => {
        if (v) await loadFamily(v);
        put(v ? { ...e, font: v } : (({ font, ...rest }) => rest)(e));
      });
      sel.classList.add('mv3-fx-font');
      g.appendChild(C.row('Font', sel));
    }
    if (d.colors && d.colors.length) {
      const now = colorsOf(e);
      const wrap = document.createElement('span');
      wrap.className = 'mv3-fx-colors';
      for (const [key, label] of d.colors) {
        const sw = C.color(now[key], (v) => {
          const next = { ...e, col: { ...(e.col || {}), [key]: v } };
          _rememberColors(e.k, colorsOf(next));
          put(next);
        });
        sw.title = label;
        sw.setAttribute('aria-label', label);
        wrap.appendChild(sw);
      }
      g.appendChild(C.row(d.colors.length > 1 ? 'Colors' : d.colors[0][1], wrap));
    }
    if (d.opts && d.opts.length) {
      const now = optsOf(e);
      for (const [key, label, olo, ohi, step, , kind] of d.opts) {
        const fmt = (v) => (kind === 'n' ? String(Math.round(v))
          : kind === 'pct' ? Math.round(v * 100) + ' %'
            : kind === 's' ? (+v).toFixed(2) + ' s'
            : kind === 'pos' ? (Math.abs(v) < 0.005 ? 'as made' : (v < 0 ? 'up ' : 'down ') + Math.round(Math.abs(v) * 100) + ' %')
              : (+v).toFixed(2) + '×');
        const withOpt = (v) => ({ ...e, opt: { ...(e.opt || {}), [key]: v } });
        // (block 4d) A switch for a setting that is on or off (the cover's barcode).
        if (kind === 'bool') { g.appendChild(C.row(label, C.toggle(now[key] >= 0.5, (on) => put(withOpt(on ? 1 : 0))))); continue; }
        g.appendChild(C.row(label, C.slider({ min: olo, max: ohi, step, value: now[key], fmt,
          onInput: (v) => live(withOpt(v)),
          onChange: (v) => { setLive(null); put(withOpt(v)); } })));
      }
    }
    // (block 1c) Where its face is - and found again on a press (one undo step).
    if (d.face) {
      const main = isMain(track);
      const moved = !!(e.path && e.pk && e.pk !== _placeKey(c, main));
      const say = e.path ? (moved ? 'The clip lies in the frame otherwise now - find its face again.' : 'It follows the face found in the clip.')
        : (WHY[_why.get(e.id)] || 'No face found - it works where a face usually is.');
      g.appendChild(C.hint(say));
      if (!_pending.has(c.id)) {
        g.appendChild(C.row('', C.button('Find the face again', async () => {
          const mine = { k: e.k, frac: 0 };
          _pending.set(c.id, mine);
          _say();
          const r = await _findPath(track, c, (f) => { mine.frac = f; _say(); });
          _pending.delete(c.id);
          const { timeline } = await import('./store.js');
          const lane = (timeline().tracks || []).find((x) => x.id === track.id);
          const now = lane && (lane.clips || []).find((x) => x.id === c.id);
          const cur = now && (now.fx || []).find((y) => y.id === e.id);
          if (!cur) { _say(); return; }
          const next = { ...cur };
          delete next.path; delete next.pk;
          if (r.path) { next.path = r.path; next.pk = r.pk; _why.delete(e.id); } else _why.set(e.id, r.why);
          setClipFields(lane.id, now.id, { fx: now.fx.map((y) => (y.id === e.id ? next : y)) });
          _say();
        }, { title: 'Count the faces of this clip\'s film again and put the effect on the face where the clip shows it now' })));
      }
    }
  }
  // (block 1c) An effect by the face waiting for its face.
  const wait = _pending.get(c.id);
  if (wait) {
    const d = effectOf(wait.k);
    const row = document.createElement('div');
    row.className = 'mv3-fx-row is-wait';
    const name = document.createElement('span');
    name.className = 'mv3-fx-name';
    const nm = document.createElement('span');
    nm.textContent = d ? d.name : 'Effect';
    const when = document.createElement('small');
    when.textContent = 'finding the face…' + (wait.frac > 0 ? ' ' + Math.round(wait.frac * 100) + ' %' : '');
    name.append(nm, when);
    row.appendChild(name);
    g.appendChild(row);
  }
  // The full-width "+ Effect" opens and shuts the panel of tiles; the panel stays until it is pressed again.
  const st = _panelNow();
  const tog = C.button('+ Effect', () => { st.open = !st.open; _panelSave(); _say(); },
    { title: st.open ? 'Hide the effects' : 'Show the effects - a press on one puts it on the whole clip, Ctrl+Z takes it off' });
  tog.classList.add('mv3-fx-add');
  if (st.open) tog.classList.add('is-on');
  tog.setAttribute('aria-expanded', st.open ? 'true' : 'false');
  g.appendChild(tog);
  if (st.open) {
    const open = list.find((e) => _isOpen(c.id, e.id));
    let onKey = open ? open.k : null;
    if (_picked && _picked.clipId === String(c.id) && String(_picked.key).startsWith('set:')) {
      const set = SETS[String(_picked.key).slice(4)];
      if (set && open && set.items[0].k === open.k) onKey = _picked.key;
    }
    _panelEl(g, onKey, (k) => { _picked = { clipId: c.id, key: k }; addTo(track, c, k); });
  }
}
/** (эф11) Told when something of the effects' group changed (the faces found for several) - hl-group.js paints again. */
export const onChange = onFocus;
