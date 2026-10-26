/* ═══════════════════════════════════════════════════════════════════════════
   MERGE v3 — a clip's CROP, in its settings (phase V51, point 1, the owner 2026-10-26; answers (пр38)-(пр44)).

   "Crop" in the settings of a video or a picture of any video lane (inspector.js). Switched on, the field under it shows
   the clip's WHOLE file - the frame under the playhead, its first frame while the playhead is elsewhere ((пр38)) - with a
   frame over it: the corners and the sides size it, the middle moves it, what is cut away is dimmed. Free; Shift keeps
   its shape; the forms 9:16 / 1:1 / 16:9 / 4:5 put the largest frame of that form about the middle of the one there is,
   and keep it until Free is pressed ((пр39)).

   THE PIECE STAYS WHERE IT WAS ((пр40)): the crop is scissors over a still picture - the piece keeps its place and its scale
   on the screen, its edges follow the frame (framing/crop.js placeFor; what a clip shows and where is the preview's own
   answer, preview-b.js mapsOf). Switched on, a main clip becomes a PiP (`pip`), a clip of a lane above an insert of its piece
   (`tw` / `tx` / `ty`). Switched off, the frame is remembered (`off`) and the whole picture is back around the piece, the
   same pixels where they were ((пр43)). Several main clips picked are cut by ONE frame, the field showing the first ((пр44)).

   LIVE, ONE STEP: while the frame is dragged the preview draws what it holds (place-b.js setLive), and the release writes
   it - one undo step for one movement (timeline-b.js setClipsFields).
   ═══════════════════════════════════════════════════════════════════════════ */

import * as Store from './store.js';
import { isStill } from './store.js';
import * as C from './controls.js';
import { playhead, onPlayhead, setClipsFields } from './timeline-b.js';
import { mapsOf, shownElement, frameSrc, fileTimeAt, onPaint } from './preview-b.js';
import { setLive } from './place-b.js';
import { normalize, active, SHAPES, MIN, largest, pickMap, placeFor } from '../framing/crop.js';
import { showError } from '../notice.js';

const isMain = (track) => !!(track && track.kind === 'video' && track.main);
const _under = (c, t) => t >= +c.start - 1e-4 && t < +c.start + (+c.dur || 0);
// The moment the field and the scissors read a clip at: the playhead on it, else its first frame ((пр38)).
const _moment = (c) => { const t = playhead(); return _under(c, t) ? t : +c.start || 0; };
const _rect = (k) => ({ x: +k.x, y: +k.y, w: +k.w, h: +k.h });

// The clips as the store has them now - what was painted may be a step old by the time a press lands.
function _fresh(items) {
  const tl = Store.timeline() || {};
  const out = [];
  for (const it of items) {
    const t = (tl.tracks || []).find((x) => x.id === it.track.id);
    const c = t && (t.clips || []).find((x) => x.id === it.clip.id);
    if (c) out.push({ track: t, clip: c });
  }
  return out;
}

// ── The shape of a clip's file ───────────────────────────────────────────────
// Only its shape is used (the crop is in shares of it): the preview's element when it has one, else read once off the copy
// the preview plays.
const _dims = new Map();          // src -> { w, h } | Promise
function _dimsNow(c) {
  const el = shownElement(c);
  if (el) return el.tagName === 'VIDEO' ? { w: el.videoWidth, h: el.videoHeight } : { w: el.naturalWidth, h: el.naturalHeight };
  const d = _dims.get(c.src);
  return d && !d.then ? d : null;
}
function _dimsOf(c) {
  const now = _dimsNow(c);
  if (now) return Promise.resolve(now);
  const was = _dims.get(c.src);
  if (was && was.then) return was;
  const p = new Promise((res) => {
    let tm = 0;
    const done = (d) => {
      clearTimeout(tm);
      if (d && d.w > 0 && d.h > 0) _dims.set(c.src, d); else _dims.delete(c.src);
      res(d && d.w > 0 && d.h > 0 ? d : null);
    };
    tm = setTimeout(() => done(null), 15000);
    const src = frameSrc(c);
    if (isStill(c)) {
      const im = new Image();
      im.onload = () => done({ w: im.naturalWidth, h: im.naturalHeight });
      im.onerror = () => done(null);
      im.src = src;
    } else {
      const v = document.createElement('video');
      v.muted = true;
      v.preload = 'metadata';
      v.onloadedmetadata = () => { done({ w: v.videoWidth, h: v.videoHeight }); v.removeAttribute('src'); v.load(); };
      v.onerror = () => done(null);
      v.src = src;
    }
  });
  _dims.set(c.src, p);
  return p;
}

// ── What a switch writes ─────────────────────────────────────────────────────
// ON: the frame remembered, or what the clip shows now (nothing moves at the press) - cut where the piece is ((пр40)); a main
// clip becomes a PiP. `k` - the one frame for every clip picked ((пр44)).
function _onPatch(it, k, d) {
  const main = isMain(it.track);
  const m = mapsOf(it.clip, main, d.w, d.h, _moment(it.clip));
  const crop = { ..._rect(k) };
  if (k.shape) crop.shape = k.shape;
  return { crop, ...placeFor(pickMap(m.maps, k), k, m.W, m.H), ...(main ? { pip: true } : {}) };
}

// OFF: the frame remembered, and the clip's whole picture back around the piece - the same pixels where they were ((пр43)).
function _offPatch(it, d) {
  const k = active(it.clip);
  if (!k) return null;
  const main = isMain(it.track);
  const t = _moment(it.clip);
  const m = mapsOf(it.clip, main, d.w, d.h, t);
  const bare = mapsOf({ ...it.clip, crop: null }, main, d.w, d.h, t);
  return { crop: { ...k, off: true }, ...placeFor(m.maps[0], pickMap(bare.maps, k).view, m.W, m.H) };
}

/** The crop's patch when a main clip's PiP goes off: the frame remembered, not applied ((пр43)) - or nothing to add. */
export const pipOffCrop = (c) => (active(c) ? { crop: { ...active(c), off: true } } : {});

/** Crop on or off for every clip of `items` ([{ track, clip }]), one undo step. */
export async function setCrop(items, want) {
  const ds = await Promise.all(items.map((x) => _dimsOf(x.clip)));
  if (ds.some((d) => !d)) { showError('The picture of this clip has not loaded yet - try again in a moment.'); return; }
  const now = _fresh(items);
  if (!now.length) return;
  const dOf = (it) => ds[items.findIndex((x) => x.clip.id === it.clip.id)];
  setLive(null);
  let list;
  if (want) {
    const first = now[0];
    const kept = first.clip.crop ? normalize({ ...first.clip.crop, off: false }) : null;
    let k = kept;
    if (!k) {
      const d = dOf(first);
      const m = mapsOf(first.clip, isMain(first.track), d.w, d.h, _moment(first.clip));
      k = normalize(m.maps[0].view) || { x: 0, y: 0, w: 1, h: 1 };
    }
    list = now.map((it) => ({ trackId: it.track.id, clipId: it.clip.id, patch: _onPatch(it, k, dOf(it)) }));
  } else {
    list = now.map((it) => ({ trackId: it.track.id, clipId: it.clip.id, patch: _offPatch(it, dOf(it)) })).filter((x) => x.patch);
  }
  if (list.length) setClipsFields(list);
}

// ── The field ────────────────────────────────────────────────────────────────
const MAX_H = 260;                // css px the field may be tall
const GRIP = 9;                   // css px about a corner that takes it
const EDGE = 7;                   // css px about a side
const PAD = 7;                    // css px of room around the picture: a grip on the file's edge is whole, and taken whole
let _f = null;                    // the field on show: { cv, items, d, k }
let _g = null;                    // the frame being moved: { part, p0, k0, k, base, pointer }
const _pic = document.createElement('canvas');   // the last frame, kept between paints of the panel
let _picKey = '';
let _own = null;                  // { src, el, want } - an element of our own, for a frame the preview is not showing

function _wireOnce() {
  if (_wireOnce.done) return;
  _wireOnce.done = true;
  // The preview painted: the clip's frame under the playhead is on its element now.
  onPaint(() => { if (_alive() && _grab()) _draw(); });
  // The playhead moved off the clip: its first frame.
  onPlayhead(() => { if (_alive()) { _grab(); _draw(); } });
}
const _alive = () => !!(_f && _f.cv.isConnected && _f.d);

function _toPic(el, key) {
  const w = el.videoWidth || el.naturalWidth, h = el.videoHeight || el.naturalHeight;
  if (!w || !h) return false;
  const s = Math.min(1, 960 / Math.max(w, h));
  const pw = Math.max(1, Math.round(w * s)), ph = Math.max(1, Math.round(h * s));
  if (_pic.width !== pw || _pic.height !== ph) { _pic.width = pw; _pic.height = ph; }
  try { _pic.getContext('2d').drawImage(el, 0, 0, pw, ph); } catch (e) { return false; }
  _picKey = key;
  return true;
}

// The frame for the field: the preview's own element while the playhead is on the clip, else one of our own at its first
// frame. True when the picture changed.
function _grab() {
  const c = _f.clip;
  const t = playhead();
  if (_under(c, t)) {
    const el = shownElement(c);
    if (el) return _toPic(el, c.id + '|' + t.toFixed(2));
  }
  const at = _under(c, t) ? t : +c.start || 0;
  const key = c.id + '|' + at.toFixed(2);
  if (_picKey === key) return false;
  _ownFrame(c, at, key);
  return false;
}

function _ownFrame(c, at, key) {
  const src = frameSrc(c);
  if (!_own || _own.src !== src) {
    if (_own && _own.el.pause) { try { _own.el.removeAttribute('src'); _own.el.load(); } catch (e) { /* gone */ } }
    let el;
    if (isStill(c)) {
      el = new Image();
      el.onload = () => { if (_own && _own.el === el && _toPic(el, _own.key)) _draw(); };
    } else {
      el = document.createElement('video');
      el.muted = true;
      el.preload = 'auto';
      el.onloadeddata = () => _seekOwn();
      el.onseeked = () => { if (_own && _own.el === el && _toPic(el, _own.key)) _draw(); };
    }
    _own = { src, el, want: NaN, key };
    el.src = src;
  }
  _own.key = key;
  _own.want = isStill(c) ? 0 : fileTimeAt(c, at);
  if (isStill(c)) { if (_own.el.naturalWidth && _toPic(_own.el, key)) _draw(); return; }
  _seekOwn();
}
function _seekOwn() {
  const el = _own && _own.el;
  if (!el || el.readyState < 1 || !Number.isFinite(_own.want)) return;
  const t = Math.max(0, Math.min((el.duration || 1e9) - 0.04, _own.want + 0.001));
  if (Math.abs((el.currentTime || 0) - t) < 0.01 && el.readyState >= 2) { if (_toPic(el, _own.key)) _draw(); return; }
  try { el.currentTime = t; } catch (e) { /* not seekable yet */ }
}

function _size() {
  const f = _f;
  const ar = f.d.w / f.d.h;
  const avail = Math.max(120, (f.wrap.clientWidth || 330) - 2 * PAD);
  const cw = Math.round(Math.min(avail, MAX_H * ar)), ch = Math.round(cw / ar);
  f.cssW = cw; f.cssH = ch;
  const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
  f.cv.style.width = (cw + 2 * PAD) + 'px';
  f.cv.style.height = (ch + 2 * PAD) + 'px';
  f.cv.width = Math.round((cw + 2 * PAD) * dpr);
  f.cv.height = Math.round((ch + 2 * PAD) * dpr);
  f.dpr = dpr;
}

function _draw() {
  const f = _f;
  if (!f || !f.d || !f.cssW) return;
  const g = f.cv.getContext('2d');
  const s = f.dpr, W = f.cssW * s, H = f.cssH * s;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, f.cv.width, f.cv.height);
  g.setTransform(1, 0, 0, 1, PAD * s, PAD * s);
  g.fillStyle = '#000';
  g.fillRect(0, 0, W, H);
  if (_picKey && _picKey.startsWith(f.clip.id + '|')) { try { g.drawImage(_pic, 0, 0, W, H); } catch (e) { /* none yet */ } }
  const k = (_g && _g.k) || f.k;
  const x = k.x * W, y = k.y * H, w = k.w * W, h = k.h * H;
  // What is cut away, dimmed; the frame and its thirds; the grips.
  g.fillStyle = 'rgba(0,0,0,.62)';
  g.beginPath();
  g.rect(0, 0, W, H);
  g.rect(x, y, w, h);
  g.fill('evenodd');
  g.strokeStyle = 'rgba(255,255,255,.28)';
  g.lineWidth = 1 * s;
  g.beginPath();
  for (const q of [1 / 3, 2 / 3]) { g.moveTo(x + w * q, y); g.lineTo(x + w * q, y + h); g.moveTo(x, y + h * q); g.lineTo(x + w, y + h * q); }
  g.stroke();
  g.lineWidth = 3 * s; g.strokeStyle = 'rgba(0,0,0,.55)';
  g.strokeRect(x, y, w, h);
  g.lineWidth = 1.5 * s; g.strokeStyle = '#ffd400';
  g.strokeRect(x, y, w, h);
  g.fillStyle = '#ffd400';
  const sq = 7 * s, bar = 14 * s, th = 4 * s;
  for (const [gx, gy] of [[x, y], [x + w, y], [x, y + h], [x + w, y + h]]) g.fillRect(gx - sq / 2, gy - sq / 2, sq, sq);
  if (w > bar * 2.2) { g.fillRect(x + w / 2 - bar / 2, y - th / 2, bar, th); g.fillRect(x + w / 2 - bar / 2, y + h - th / 2, bar, th); }
  if (h > bar * 2.2) { g.fillRect(x - th / 2, y + h / 2 - bar / 2, th, bar); g.fillRect(x + w - th / 2, y + h / 2 - bar / 2, th, bar); }
}

// The pointer in shares of the file (the picture sits PAD inside the field's edges).
function _pt(e) {
  const b = _f.cv.getBoundingClientRect();
  return { x: (e.clientX - b.left - PAD) / Math.max(1, _f.cssW), y: (e.clientY - b.top - PAD) / Math.max(1, _f.cssH) };
}

// What a press at p takes: a corner ('nw' ...), a side ('n' ...), the middle ('move') or nothing.
function _partAt(p) {
  const k = _f.k, W = _f.cssW, H = _f.cssH;
  const px = p.x * W, py = p.y * H;
  const L = k.x * W, R = (k.x + k.w) * W, T = k.y * H, B = (k.y + k.h) * H;
  const nearX = (v) => Math.abs(px - v), nearY = (v) => Math.abs(py - v);
  const ew = nearX(L) <= GRIP ? 'w' : nearX(R) <= GRIP ? 'e' : '';
  const ns = nearY(T) <= GRIP ? 'n' : nearY(B) <= GRIP ? 's' : '';
  if (ew && ns) return ns + ew;
  const inY = py >= T - EDGE && py <= B + EDGE, inX = px >= L - EDGE && px <= R + EDGE;
  if (inY && nearX(L) <= EDGE) return 'w';
  if (inY && nearX(R) <= EDGE) return 'e';
  if (inX && nearY(T) <= EDGE) return 'n';
  if (inX && nearY(B) <= EDGE) return 's';
  if (px > L && px < R && py > T && py < B) return 'move';
  return '';
}
const CURSOR = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize',
  e: 'ew-resize', w: 'ew-resize', move: 'move' };

// The frame after a drag, every side inside the file. `q` - the shape to keep, width over height in shares, or 0 for free.
function _dragged(part, k0, p0, p, q) {
  const cl = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  if (part === 'move') {
    return { x: cl(k0.x + p.x - p0.x, 0, 1 - k0.w), y: cl(k0.y + p.y - p0.y, 0, 1 - k0.h), w: k0.w, h: k0.h };
  }
  const minW = q ? Math.max(MIN, MIN * q) : MIN, minH = q ? minW / q : MIN;
  if (part.length === 2) {
    // A corner: the opposite one stays.
    const east = part[1] === 'e', south = part[0] === 's';
    const ax = east ? k0.x : k0.x + k0.w, ay = south ? k0.y : k0.y + k0.h;
    const maxW = east ? 1 - ax : ax, maxH = south ? 1 - ay : ay;
    let w = cl(Math.abs(cl(p.x, 0, 1) - ax), minW, maxW), h = cl(Math.abs(cl(p.y, 0, 1) - ay), minH, maxH);
    if ((east ? p.x < ax : p.x > ax)) w = minW;
    if ((south ? p.y < ay : p.y > ay)) h = minH;
    if (q) {
      w = Math.max(w, h * q);
      w = Math.min(w, maxW, maxH * q);
      w = Math.max(w, minW);
      h = w / q;
    }
    return { x: east ? ax : ax - w, y: south ? ay : ay - h, w, h };
  }
  // A side: the opposite side stays; a kept shape grows the other way about its middle.
  if (part === 'e' || part === 'w') {
    const east = part === 'e';
    const ax = east ? k0.x : k0.x + k0.w;
    const maxW0 = east ? 1 - ax : ax;
    let w = cl(east ? p.x - ax : ax - p.x, minW, maxW0);
    let y = k0.y, h = k0.h;
    if (q) {
      const my = k0.y + k0.h / 2;
      w = Math.min(w, 2 * Math.min(my, 1 - my) * q);
      w = Math.max(w, minW);
      h = w / q; y = my - h / 2;
    }
    return { x: east ? ax : ax - w, y, w, h };
  }
  const south = part === 's';
  const ay = south ? k0.y : k0.y + k0.h;
  const maxH0 = south ? 1 - ay : ay;
  let h = cl(south ? p.y - ay : ay - p.y, minH, maxH0);
  let x = k0.x, w = k0.w;
  if (q) {
    const mx = k0.x + k0.w / 2;
    h = Math.min(h, 2 * Math.min(mx, 1 - mx) / q);
    h = Math.max(h, minH);
    w = h * q; x = mx - w / 2;
  }
  return { x, y: south ? ay : ay - h, w, h };
}

// Where each clip picked starts from: what it shows now and where (the scissors' still picture).
function _bases() {
  const now = _fresh(_f.items);
  const out = [];
  for (const it of now) {
    const d = _dimsNow(it.clip);
    if (!d) return null;
    out.push({ it, m: mapsOf(it.clip, isMain(it.track), d.w, d.h, _moment(it.clip)) });
  }
  return out.length ? out : null;
}

// The patches a frame makes, one per clip.
function _patches(base, k, shape) {
  const crop = { ..._rect(k) };
  if (shape) crop.shape = shape;
  return base.map((b) => ({ trackId: b.it.track.id, clipId: b.it.clip.id,
    patch: { crop, ...placeFor(pickMap(b.m.maps, k), k, b.m.W, b.m.H) } }));
}

function _down(e) {
  if (e.button !== 0 || !_alive() || _g) return;
  const p = _pt(e);
  const part = _partAt(p);
  if (!part) return;
  setLive(null);
  const base = _bases();
  if (!base) return;
  e.preventDefault();
  try { _f.cv.setPointerCapture(e.pointerId); } catch (err) { /* released */ }
  _g = { part, p0: p, k0: _rect(_f.k), k: _rect(_f.k), base, moved: false, pg0: { x: e.clientX, y: e.clientY } };
}

function _move(e) {
  if (!_alive()) return;
  if (!_g) { _f.cv.style.cursor = CURSOR[_partAt(_pt(e))] || ''; return; }
  if (!_g.moved && Math.hypot(e.clientX - _g.pg0.x, e.clientY - _g.pg0.y) < 2) return;
  _g.moved = true;
  const shape = _f.k.shape;
  const fileAr = _f.d.w / _f.d.h;
  // A form pressed keeps its shape; Shift keeps the one the frame had at the press.
  const q = shape && SHAPES[shape] ? SHAPES[shape] / fileAr : (e.shiftKey ? _g.k0.w / _g.k0.h : 0);
  _g.k = normalize(_dragged(_g.part, _g.k0, _g.p0, _pt(e), q)) || _g.k0;
  const live = new Map();
  for (const x of _patches(_g.base, _g.k, shape)) live.set(x.clipId, x.patch);
  setLive(live);
  _draw();
}

function _up() {
  if (!_g) return;
  const g = _g;
  _g = null;
  if (g.moved && _f) {
    const shape = _f.k.shape;
    _f.k = { ...g.k, shape };
    setClipsFields(_patches(g.base, g.k, shape));
  }
  setLive(null);
  if (_alive()) _draw();
}

// A form pressed: the largest frame of it about the middle of the one there is, kept until Free ((пр39)). Free: the frame as
// it is, its shape no longer kept. One step.
function _shape(name) {
  if (!_alive() || _g) return;
  const k = _f.k;
  if (!name) {
    if (!k.shape) return;
    setClipsFields(_fresh(_f.items).map((it) => ({ trackId: it.track.id, clipId: it.clip.id,
      patch: { crop: { ..._rect(active(it.clip) || k) } } })));
    return;
  }
  setLive(null);
  const base = _bases();
  if (!base) return;
  const fileAr = _f.d.w / _f.d.h;
  const nk = normalize(largest(SHAPES[name], fileAr, k.x + k.w / 2, k.y + k.h / 2));
  if (nk) setClipsFields(_patches(base, nk, name));
}

/**
 * The Crop switch and, while it is on, its field - for `items` ([{ track, clip }], the first one's frame shown). Returns
 * whether the crop is on (the inspector hides what does not act on a cropped clip).
 */
export function cropRows(host, items) {
  const clips = items.map((x) => x.clip);
  const on = clips.every((c) => !!active(c));
  const many = items.length > 1;
  const head = C.row('Crop', C.toggle(on, (v) => { setCrop(items, v); }));
  head.title = on ? 'Cut a piece out of the picture - switch off for the whole picture again (the frame is remembered).'
    : 'Cut a piece out of ' + (many ? 'these clips' : 'this clip') + ' - it stays where it is on the frame'
      + (items.some((x) => isMain(x.track)) ? ' and becomes a picture in the picture' : '');
  host.appendChild(head);
  if (!on) {
    if (clips.some((c) => active(c))) host.appendChild(C.hint('Some of the picked clips are cropped - switching on crops all of them by one frame.'));
    return false;
  }
  _wireOnce();
  const first = items[0].clip;
  const wrap = document.createElement('div');
  wrap.className = 'mv3-crop';
  const cv = document.createElement('canvas');
  cv.className = 'mv3-crop-cv';
  wrap.appendChild(cv);
  host.appendChild(wrap);
  const k = active(first);
  _f = { cv, wrap, items, clip: first, k: { ..._rect(k), shape: k.shape || '' }, d: _dimsNow(first) };
  cv.addEventListener('pointerdown', _down);
  cv.addEventListener('pointermove', _move);
  cv.addEventListener('pointerup', _up);
  cv.addEventListener('pointercancel', _up);
  cv.addEventListener('lostpointercapture', _up);

  const shapes = document.createElement('div');
  shapes.className = 'mv3-crop-shapes';
  for (const [name, label] of [['', 'Free'], ...Object.keys(SHAPES).map((s) => [s, s])]) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'mv3-crop-shape' + ((k.shape || '') === name ? ' is-on' : '');
    b.textContent = label;
    b.title = name ? 'The largest ' + name + ' frame about the middle of this one - kept ' + name + ' until Free'
      : 'Any shape - Shift while dragging a corner keeps the one it has';
    b.addEventListener('click', () => _shape(name));
    shapes.appendChild(b);
  }
  host.appendChild(shapes);
  host.appendChild(C.hint('Drag a corner or a side to cut, the middle to move the frame' + (k.shape ? '.' : '; Shift keeps its shape.')
    + (many ? ' One frame for all ' + items.length + ' picked clips - the field shows the first.' : ''), true));

  // Every clip's shape ready before the first press; the field drawn once the first one's is known.
  const f = _f;
  for (const it of items) _dimsOf(it.clip);
  const show = (d) => {
    if (_f !== f || !d) return;
    f.d = d;
    _size();
    _grab();
    _draw();
  };
  if (f.d) requestAnimationFrame(() => show(f.d));
  else _dimsOf(first).then(show);
  return true;
}
