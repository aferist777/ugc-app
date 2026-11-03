/* ═══════════════════════════════════════════════════════════════════════════
   MERGE v3 — captions picked and moved ON THE PREVIEW (phase V30, block 3, K7; the owner's (с8), (с31)-(с34)).

   A caption is placed by looking at it, like a picture (place-b.js): press its page and move it.

     press a page          its LANE is picked, and the move moves the whole lane (с32: until a single line is
                           picked, the lane is what moves)
     press it twice        its LINE is picked (с32, the owner at the start of the code: "двойным нажатием
                           выделяется фраза"), and a move moves that line
     press a picked line   it moves - with every caption picked beside it, all by the same amount
     Shift                 up and down only
     Alt                   no snapping

   A page whose own style says where it sits is not moved by its lane (с31) - so a press on it picks that line,
   or nothing under the pointer would move. WHERE IT GOES: a line's place is its own style (pos, tx, ty - the
   strip's Where and Nudge of "This line"), a lane's its style; no re-cut, a place does not change a line's width.
   It SNAPS (с33) to the frame's vertical middle and to the three anchors - near one, Where becomes it and the
   offset nothing - with a thin line saying to what. The page never leaves the frame (с34, captions/place.js).

   THE SAMPLE (phase V66, the owner's (хо7)): while a highlights project's common Subtitles settings are in the strip (hl-group.js), a
   page of «example» is drawn in place of the captions (setSample) - it alone is pressed, moved only up and down, and let go its place
   goes to the owner of the sample (written for all the ticked fragments); nothing on the timeline is picked or written here.

   NOTHING IS WRITTEN UNTIL THE MOUSE COMES UP: while it moves, the captions on screen are drawn with the place in
   hand (captions/layer.js setLive, or the painter), and the release writes it once - one Ctrl+Z. A press that
   does not move writes nothing.

   The picked captions' pages are outlined in yellow dashes, as a picked band is; with a platform's screen over
   the frame (platforms.js), what a page lies under is outlined in red, and the part of the page under it too
   (с36 - a mark, nothing refused).
   ═══════════════════════════════════════════════════════════════════════════ */

import * as Store from './store.js';
import * as CapLayer from '../captions/layer.js';
import * as Platforms from './platforms.js';
import { selectedIds, selectedTrack, selectedCaptions, selectClipById, selectTrackById, setSubsStyle, setCaptionStyle, keepPickOn }
  from './timeline-b.js';
import { pagesAt, inBox, ownPlace, dragPlace, anchorY } from '../captions/place.js';
import { renderFrame, resolveStyle, POSITIONS } from '../captions/style.js';

const MARK = '#ffd400';       // the picked outline - place-b.js's yellow
const RED = '#ff3b30';
const SLACK = 8;              // a press this close to a page (screen pixels) is on it
const NEAR = 9;               // snapping distance, screen pixels

let _api = null;              // { canvas, on(), at(), pad(), frame(), repaint() } - frame() is the canvas frame W x H
let _drag = null;
let _live = null;             // the timeline drawn while a move is in hand
let _raf = 0;
let _sample = null;           // (V66) { tl, onDrop(place) } - the «example» of several fragments' common place

const _fmt = () => { const tl = Store.timeline(); return (tl && tl.format) === '16:9' ? '16:9' : '9:16'; };
// Render-frame pixels per canvas-frame pixel, and per pixel of the page.
const _k = () => renderFrame(_fmt()).w / Math.max(1, _api.frame().w);
const _screen = () => { const b = _api.canvas.getBoundingClientRect(); return b.width ? _api.canvas.width / b.width : 1; };

/** The timeline a gesture is drawing - the preview's painter draws captions from it while it is not null. */
export const liveTimeline = () => _live;

// Every page on screen now, in render-frame pixels; the gesture's place when one is in hand.
function _pages() {
  const tl = _live || (_sample ? _sample.tl : Store.timeline());
  const F = renderFrame(_fmt());
  return pagesAt(tl, _api.at(), F.w, F.h);
}

// The page under a point of the canvas frame - the top one (text lanes are drawn over the subtitles).
function _hit(p) {
  if (!_api || !_api.on()) return null;
  const k = _k();
  const q = { x: p.x * k, y: p.y * k };
  const pages = _pages();
  const pad = SLACK * _screen() * k;
  for (let i = pages.length - 1; i >= 0; i--) {
    const pg = pages[i];
    if (pg.box.lines.some((l) => inBox(q, l, pad)) || inBox(q, pg.box, 0)) return pg;
  }
  return null;
}

// The place a gesture starts from: the style that places the grabbed page, read as it is drawn.
const _placeOf = (st) => ({ pos: POSITIONS.includes(st.pos) ? st.pos : 'bottom', tx: +st.tx || 0, ty: +st.ty || 0 });

/**
 * A press on the canvas (place-b.js asks after the picked picture's grips, before the pictures). @returns true when
 * it was on a page of captions.
 */
export function down(e, p) {
  const hit = _hit(p);
  if (!hit) return false;
  e.preventDefault();
  // (V66) The sample: moved up and down, nothing picked.
  if (_sample) {
    if (!Store.canEdit()) return true;
    _drag = { what: { kind: 'sample' }, hit, from: _placeOf(resolveStyle(hit.track.style)), p0: p, pg0: { x: e.clientX, y: e.clientY }, moved: false, r: null };
    return true;
  }
  const id = hit.clip.id;
  const picked = new Set(selectedIds());
  let what;
  if (e.detail >= 2 || ownPlace(hit.clip)) {
    // Twice - or a line with its own place, which its lane does not move: that line.
    if (!(picked.size === 1 && picked.has(id))) selectClipById(id);
    what = { kind: 'lines', ids: [id] };
  } else if (picked.has(id)) {
    // A picked line: it moves, with the captions picked beside it.
    const caps = selectedCaptions();
    what = { kind: 'lines', ids: caps ? caps.map((x) => x.clip.id) : [id] };
  } else {
    selectTrackById(hit.track.id);
    what = { kind: 'lane', track: hit.track.id };
  }
  if (_api.repaint) _api.repaint();
  if (!Store.canEdit()) return true;
  const st = what.kind === 'lane' ? resolveStyle(hit.track.style) : resolveStyle(hit.track.style, hit.clip.style);
  _drag = { what, hit, from: _placeOf(st), p0: p, pg0: { x: e.clientX, y: e.clientY }, moved: false, r: null };
  return true;
}

/** The pointer over the canvas with nothing in hand: what a press there would take. */
export function hover(p) {
  if (_drag) return 'move';
  const hit = _hit(p);
  if (!hit) return '';
  if (_sample) return 'move';
  const picked = new Set(selectedIds());
  const lane = selectedTrack();
  return picked.has(hit.clip.id) || (lane && lane.id === hit.track.id && !ownPlace(hit.clip)) ? 'move' : 'pointer';
}

// The places in hand, for every caption the gesture moves: { trackId: patch } for a lane, { clipId: patch } for lines.
function _patches(r) {
  const tl = Store.timeline();
  const d = _drag;
  if (d.what.kind === 'lane') return { lane: { pos: r.pos, tx: r.tx, ty: r.ty } };
  const F = renderFrame(_fmt());
  const ids = new Set(d.what.ids);
  const out = new Map();
  for (const t of ((tl && tl.tracks) || [])) {
    if (t.kind !== 'subs' && t.kind !== 'text') continue;
    for (const c of (t.clips || [])) {
      if (!ids.has(c.id)) continue;
      if (c.id === d.hit.clip.id) { out.set(c.id, { pos: r.pos, tx: r.tx, ty: r.ty }); continue; }
      const own = _placeOf(resolveStyle(t.style, c.style));
      // Where the grabbed one stood, it lands where the grabbed one lands; elsewhere it moves by as much.
      if (own.pos === d.from.pos && own.tx === d.from.tx && own.ty === d.from.ty) out.set(c.id, { pos: r.pos, tx: r.tx, ty: r.ty });
      else out.set(c.id, { pos: own.pos, tx: _off(own.tx + r.mx / F.w), ty: _off(own.ty + r.my / F.h) });
    }
  }
  return { lines: out };
}
const _off = (v) => Math.max(-1, Math.min(1, Math.round(v * 10000) / 10000));

// The timeline with the place in hand, holding only what is on screen (the layer builds it on every move).
function _liveOf(pt) {
  const tl = Store.timeline();
  const at = _api.at();
  const d = _drag;
  const on = (c) => c && at >= (+c.start || 0) && at < (+c.start || 0) + Math.max(0.05, +c.dur || 0);
  return {
    format: tl.format,
    tracks: (tl.tracks || []).filter((t) => t.kind === 'subs' || t.kind === 'text').map((t) => {
      const clips = (t.clips || []).filter(on).map((c) => (pt.lines && pt.lines.has(c.id)
        ? { ...c, style: { ...(c.style || {}), ...pt.lines.get(c.id) } } : c));
      const style = pt.lane && t.id === d.what.track ? { ...(t.style || {}), ...pt.lane } : t.style;
      return { ...t, style, clips };
    }),
  };
}

function _move(e) {
  if (!_drag || !_api) return;
  if (!_drag.moved && Math.hypot(e.clientX - _drag.pg0.x, e.clientY - _drag.pg0.y) < 3) return;
  _drag.moved = true;
  const b = _api.canvas.getBoundingClientRect();
  const sc = b.width ? _api.canvas.width / b.width : 1;
  const k = _k();
  const F = renderFrame(_fmt());
  // Page pixels -> canvas pixels -> render-frame pixels.
  const dx = (e.clientX - _drag.pg0.x) * sc * k, dy = (e.clientY - _drag.pg0.y) * sc * k;
  const sample = _drag.what.kind === 'sample';
  _drag.r = dragPlace(_drag.from, _drag.hit.box, dx, dy, F.w, F.h, { vertical: sample || e.shiftKey, free: e.altKey, near: NEAR * sc * k });
  if (sample) {
    const s = _sample.tl;
    _live = { ...s, tracks: s.tracks.map((x) => ({ ...x, style: { ...(x.style || {}), pos: _drag.r.pos, ty: _drag.r.ty } })) };
  } else {
    _drag.pt = _patches(_drag.r);
    _live = _liveOf(_drag.pt);
  }
  // At most once a frame: the layer builds an .ass and libass lays it out.
  if (_raf) return;
  _raf = requestAnimationFrame(() => {
    _raf = 0;
    if (!_live) return;
    CapLayer.setLive(_live);
    if (_api.repaint) _api.repaint();
  });
}

function _up() {
  if (!_drag) return;
  const d = _drag;
  _drag = null;
  if (_raf) { cancelAnimationFrame(_raf); _raf = 0; }
  // (V66) The sample let go: its place to its owner, the sample drawn where it was let go until the owner draws it again.
  if (d.what.kind === 'sample') {
    if (d.moved && d.r && _sample) {
      if (_live) _sample.tl = _live;
      if (_sample.onDrop) _sample.onDrop({ pos: d.r.pos, ty: d.r.ty });
    }
    _live = null;
    CapLayer.setLive(_sample ? _sample.tl : null);
    if (_api && _api.repaint) _api.repaint();
    return;
  }
  const pt = d.moved ? d.pt : null;
  _live = null;
  if (pt && pt.lane) setSubsStyle(d.what.track, pt.lane, false);
  else if (pt && pt.lines && pt.lines.size) setCaptionStyle([...pt.lines.keys()], (c) => pt.lines.get(c.id) || {});
  // After the write: the store's change has handed the layer the new place already.
  CapLayer.setLive(null);
  if (_api && _api.repaint) _api.repaint();
}

// ── What is drawn over the frame ────────────────────────────────────────────
function _dash(ctx, x, y, w, h) {
  ctx.lineWidth = 3.5; ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.setLineDash([]);
  ctx.strokeRect(x, y, w, h);
  ctx.lineWidth = 1.75; ctx.strokeStyle = MARK; ctx.setLineDash([7, 5]);
  ctx.strokeRect(x, y, w, h);
  ctx.setLineDash([]);
}

/** The picked captions outlined, the snapping line, and what a platform's screen covers in red - in canvas-frame pixels. */
export function paint(ctx) {
  if (!_api || !_api.on()) return;
  const lane = selectedTrack();
  const picked = new Set(selectedIds());
  const zones = Platforms.current();
  const wordsLane = lane && (lane.kind === 'subs' || lane.kind === 'text');
  if (!wordsLane && !picked.size && !zones && !_drag && !_sample) return;
  const pages = _pages();
  if (!pages.length && !_drag) return;
  const s = 1 / _k();
  const F = renderFrame(_fmt());
  ctx.save();
  // Red first, under the outline: the element a page lies under, and the part of the page under it.
  if (zones) {
    const seen = new Set();
    for (const pg of pages) {
      for (const c of Platforms.crossed(pg.box.lines, F.w, F.h)) {
        const kx = F.w / 1080 * s, ky = F.h / 1920 * s;
        ctx.fillStyle = 'rgba(255,59,48,.38)';
        ctx.fillRect(c.hit[0] * kx, c.hit[1] * ky, (c.hit[2] - c.hit[0]) * kx, (c.hit[3] - c.hit[1]) * ky);
        const key = c.r.join(',');
        if (seen.has(key)) continue;
        seen.add(key);
        ctx.lineWidth = 2; ctx.strokeStyle = RED;
        ctx.strokeRect(c.r[0] * kx, c.r[1] * ky, (c.r[2] - c.r[0]) * kx, (c.r[3] - c.r[1]) * ky);
      }
    }
  }
  for (const pg of pages) {
    const on = !!_sample || (lane && lane.id === pg.track.id) || picked.has(pg.clip.id);
    if (!on) continue;
    const b = pg.box;
    _dash(ctx, b.x * s, b.y * s, b.w * s, b.h * s);
  }
  // What it snapped to.
  const r = _drag && _drag.moved ? _drag.r : null;
  if (r && (r.snapX || r.snapY)) {
    ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(255,212,0,.85)'; ctx.setLineDash([4, 4]);
    ctx.beginPath();
    if (r.snapX) { ctx.moveTo(F.w / 2 * s, 0); ctx.lineTo(F.w / 2 * s, F.h * s); }
    if (r.snapY) { const y = anchorY(r.snapY, F.h) * s; ctx.moveTo(0, y); ctx.lineTo(F.w * s, y); }
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.restore();
}

/**
 * (phase V66) The «example» of several highlights fragments' common place: `o` { tl - the timeline drawn in place of the captions,
 * onDrop(place { pos, ty }) } - or null, the captions back. While it is set, only it is pressed and moved.
 */
export function setSample(o) {
  const was = !!_sample;
  _sample = o && o.tl ? { tl: o.tl, onDrop: o.onDrop || null } : null;
  if (_drag && _drag.what.kind === 'sample' && !_sample) { _drag = null; _live = null; }
  if (!_sample && !was) return;
  // A sample's own gesture in hand keeps drawing itself.
  if (!(_drag && _drag.what.kind === 'sample')) CapLayer.setLive(_sample ? _sample.tl : null);
  if (_api && _api.repaint) _api.repaint();
}

/**
 * @param api { canvas, on(), at(), pad(), frame(), repaint() } - the preview's canvas and what only it knows: whether
 *   it shows the timeline (not lent to the workshop), the time on screen and the frame's size in canvas pixels.
 */
let _wired = false;
export function wireCapPlace(api) {
  _api = api;
  // Mounted again (a new canvas): the listeners are the module's and stay.
  if (_wired) return;
  _wired = true;
  document.addEventListener('mousemove', _move);
  document.addEventListener('mouseup', _up);
  // A press on a page of the picked lane keeps the lane picked (timeline-b.js lets go of a lane at a press anywhere
  // else) - or the strip would slide away and back under the press that moves it.
  keepPickOn((e) => {
    if (!_api || e.target !== _api.canvas) return false;
    const b = _api.canvas.getBoundingClientRect();
    const p = { x: (e.clientX - b.left) * (_api.canvas.width / b.width) - _api.pad(),
                y: (e.clientY - b.top) * (_api.canvas.height / b.height) - _api.pad() };
    return !!_hit(p);
  });
  // The screen of a platform switched on or off: its red marks come or go.
  Platforms.onChange(() => { if (_api.repaint) _api.repaint(); });
}
