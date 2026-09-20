/* ═══════════════════════════════════════════════════════════════════════════
   MERGE v3 — the preview.

   The frame at the playhead, composited the way lib/mv3b-render.js renders it, and played.
   Lanes are made and destroyed by hand and their order is a property of the project; a halfer
   band is a switch on a clip, not a lane (see _drawBand).

   LAYER ORDER COMES FROM THE PROJECT. The video lanes are listed top layer first, so
   painting runs through them backwards - main video, then whatever sits above it, in
   the order the lanes are in. The renderer for these projects will read the same list
   the same way; that is the one thing the two must agree on, or the screen and the
   file will show different pictures.

   ═══════════════════════════════════════════════════════════════════════════ */

import * as Store from './store.js';
import * as Layers from '../layers.js';
import { fxAt, hasFx, zoomRect, paintTint, paintVignette, paintVeil, gapNote,
         softened } from './fx-b.js';
import { paintCaptions, subsTrack, regroup, autoWordsPerLine } from './subs-b.js';
import { wirePlace, unwirePlace, paintHandles, liveOf } from './place-b.js';
import { isStill } from './store.js';
import { setPlayhead, setSubsStyle } from './timeline-b.js';

const STAGE = 'mv3-stage';

let _on = false;
let _cv = null;          // our canvas, ours alone - the other preview owns its own
let _ctx = null;
let _at = 0;             // playhead, seconds
let _media = new Map();  // src -> HTMLVideoElement | HTMLImageElement, kept between draws
let _raf = 0;

// The frame, in backing pixels only - what the canvas composites into, never what gets
// exported. Which SHAPE is the project's own answer, not this module's: a blank project is
// assembled from scratch and may be meant for either.
// The label is the ratio and nothing else. It sits beside the quality picker, which says 360
// and 480; a word next to a number reads as a different kind of setting when it is the same
// kind. Anyone choosing a frame shape knows which way 9:16 points.
const FORMATS = {
  '9:16': { w: 540, h: 960, label: '9:16' },
  '16:9': { w: 960, h: 540, label: '16:9' },
};
const _fmt = () => {
  const tl = Store.timeline();
  const f = tl && tl.format;
  return FORMATS[f] ? f : '9:16';
};
let W = 540, H = 960;
// ROOM AROUND THE FRAME. The canvas is bigger than the video by a margin on every side, and
// the picture is drawn inset into it. An insert dragged half off the edge is then still
// visible - and so are its grips, which otherwise sit outside the canvas at exactly the moment
// they are being reached for.
//
// Everything below draws in FRAME coordinates: the margin is a translate, applied once at the
// top of the paint, so no drawing code has to know about it.
const PAD_FRAC = 0.08;
let PAD = 43, CW = 626, CH = 1046;

// The surround, and the veil that says it is not the film. Dark enough to read as outside,
// light enough that what hangs over the edge can still be seen.
const SURROUND = '#0b0c10';
const OUTSIDE = 'rgba(8,9,12,.55)';

// ── What is on screen at a moment ───────────────────────────────────────────
// Bottom layer first, which is the video lanes read backwards: the list is held top
// layer first, because that is how a timeline reads.
function _layers(tl) {
  if (!tl || !Array.isArray(tl.tracks)) return [];
  return tl.tracks.filter(t => t.kind === 'video').slice().reverse();
}

// Every clip of a lane under the playhead, in the lane's own order - which is the order the
// renderer overlays them in, so the later one is drawn over the earlier. Only one of them used to
// be drawn, and a picture laid over part of a clip on the same lane hid the rest of that clip on
// screen while the render showed both.
function _clipsAt(track, t) {
  const out = [];
  for (const c of (track.clips || [])) {
    const s = +c.start, e = s + (+c.dur);
    if (t >= s - 0.0001 && t < e) out.push(c);
  }
  return out;
}

export function duration() {
  const tl = Store.timeline();
  if (!tl || !Array.isArray(tl.tracks)) return 0;
  let end = 0;
  for (const tr of tl.tracks) {
    for (const c of (tr.clips || [])) end = Math.max(end, (+c.start) + (+c.dur));
  }
  return Math.round(end * 100) / 100;
}

// ── Media, held between draws ───────────────────────────────────────────────
// A <video> that is recreated per frame never gets far enough to decode anything, so the
// stage stays black and the editor looks broken. They are kept, and only dropped when the
// clip that wanted them is gone.
// FILM IS PLAYED THROUGH A PROXY, not from the original. A birol off the shelf can be 4K,
// and three of them layered is more pixels per frame than a browser will decode in real
// time - the picture stalls and the clock runs on without it, which reads as a broken
// preview rather than as a slow one.
//
// The proxy endpoint is shared with the other workflow deliberately. It is a transcoder,
// not editing logic: the same argument as the library, which is also shared. Nothing about
// how a blank project is composed passes through it.
//
// Stills are left alone. They decode once and a derivative would be a round trip for nothing.
const PROXY_H = [360, 480, 720];
function _quality() {
  const q = document.getElementById('mv3-pv-q');
  const v = q ? parseInt(q.value, 10) : NaN;
  return PROXY_H.includes(v) ? v : 480;
}

// A REVERSED CLIP IS HANDED A FILE THAT IS ALREADY REVERSED. Seeking backwards frame by
// frame is not playing - the decoder starts over on every seek, so a few frames come out and
// then it crawls - and no element can be told to run at a negative rate. The proxy has been
// able to reverse since it was written (rev=1 runs `reverse` and `areverse`, the same filters
// the render uses), so the preview simply plays the reversed file forwards.
const _revable = (src) => /\.(mp4|webm|mov|m4v)$/i.test(String(src || '').split('?')[0]);
const _rev = (c) => !!(c && c.reversed) && !isStill(c) && _revable(c.src);

function _srcFor(src, rev) {
  if (isStill({ src })) return src;
  // A screenshot is taken off the original file. Not a reversed one: no element plays a file
  // backwards, so that frame still comes off the reversed proxy, at its tallest.
  if (_shooting === 'orig' && !rev) return src;
  return '/api/ffmpeg/preview-proxy?src=' + encodeURIComponent(src) + '&h=' + (_shooting === 'orig' ? 720 : _quality())
       + (rev ? '&rev=1' : '');
}

// Keyed by reversal as well as quality: the same file forwards and backwards is two different
// downloads, and one element cannot hold both.
const _key = (src, rev) => src + '|' + (isStill({ src }) ? '' : (_shooting === 'orig' ? 'orig' : _quality()) + (rev ? '|rev' : ''));

function _el(src, rev) {
  const key = _key(src, rev);
  if (_media.has(key)) return _media.get(key);
  let el;
  if (isStill({ src })) {
    el = new Image();
    el.decoding = 'async';
  } else {
    el = document.createElement('video');
    el.muted = true;            // sound is the audio lanes' business, not the picture's
    el.playsInline = true;
    el.preload = 'auto';
  }
  el.crossOrigin = 'anonymous';
  el.src = _srcFor(src, rev);
  _media.set(key, el);
  return el;
}

function _sweep(alive) {
  for (const [src, el] of _media) {
    if (alive.has(src)) continue;
    try { if (el.pause) el.pause(); el.src = ''; } catch (e) {}
    _media.delete(src);
  }
}

// ── Drawing ─────────────────────────────────────────────────────────────────
// HOW A CLIP MEETS A FRAME THAT IS NOT ITS SHAPE, and it must read here exactly as
// fitChain() reads it in lib/mv3b-render.js. Fit is the default and keeps the whole picture,
// padding what is left over; fill covers the frame and loses the edges, and which edge
// survives is the clip's own, because in a 16:9 shot forced into a 9:16 film the subject is
// rarely in the middle.
//
// Returned as a source rectangle AND a destination rectangle, which is what lets one
// drawImage do both: fit takes the whole source into a smaller box, fill takes a slice of
// the source into the whole frame.
// PLACED, and by its MIDDLE - the same anchor lib/mv3b-render.js overlays by, and for the
// same reason: a turned rectangle is bigger than the one it came from, and only its centre
// stays where it was put.
export const isPlaced = (c) => !!(c && c.tw != null && +c.tw > 0);

// WHERE EVERY CLIP WAS LAST DRAWN, kept for the gesture layer - placed or not, because a clip
// becomes an insert by being dragged and the drag has to start from where it already is. The
// height depends on the source's shape, which is known here and nowhere else: place-b.js would
// have to guess at it, and a grip that is not on the corner is a grip that misses.
//
// In lane order, bottom layer first - so the LAST one under the pointer is the one on top.
const _rects = new Map();

function _place(sw, sh, c) {
  // A gesture in progress holds its numbers rather than writing them: this is where they are
  // read back, so the picture follows the mouse without a store write per pixel.
  const live = liveOf(c.id);
  if (live) c = Object.assign({}, c, live);
  if (isPlaced(c)) {
    const dw = Math.max(2, (+c.tw) * W);
    const dh = Math.max(2, dw * (sh / sw));
    const cx = (c.tx == null ? 0.5 : +c.tx) * W;
    const cy = (c.ty == null ? 0.5 : +c.ty) * H;
    return { sx: 0, sy: 0, sw, sh, dx: cx - dw / 2, dy: cy - dh / 2, dw, dh,
             angle: +c.angle || 0, feather: Math.max(0, Math.min(0.45, +c.feather || 0)),
             cx, cy, placed: true };
  }
  if (String((c && c.fit) || 'fit') !== 'fill') {
    const s = Math.min(W / sw, H / sh);
    const dw = sw * s, dh = sh * s;
    const dx = (W - dw) / 2, dy = (H - dh) / 2;
    // `conv` is what this clip would become the moment somebody drags it: the box it is
    // already occupying, said in the numbers a placement is made of. Lifting a picture off the
    // frame should not move it, and without this it would jump on the first pixel of the drag.
    return { sx: 0, sy: 0, sw, sh, dx, dy, dw, dh, cx: dx + dw / 2, cy: dy + dh / 2, angle: 0,
             conv: { tw: dw / W, tx: 0.5, ty: 0.5 } };
  }
  const s = Math.max(W / sw, H / sh);
  const cw = Math.min(sw, W / s), ch = Math.min(sh, H / s);
  const a = String((c && c.cropAlign) || 'center');
  const sx = a === 'left' ? 0 : a === 'right' ? (sw - cw) : (sw - cw) / 2;
  const sy = a === 'top' ? 0 : a === 'bottom' ? (sh - ch) : (sh - ch) / 2;
  // A filled clip is cropped to the frame, and an insert cannot be cropped - so what is kept
  // on conversion is its HEIGHT, and the sides come back and hang over the edge, where the
  // margin now shows them.
  return { sx, sy, sw: cw, sh: ch, dx: 0, dy: 0, dw: W, dh: H,
           cx: W / 2, cy: H / 2, angle: 0,
           conv: { tw: (H * (sw / sh)) / W, tx: 0.5, ty: 0.5 } };
}

// ── A halfer band ───────────────────────────────────────────────────────────
// A strip across the whole frame, read exactly as bandGeom() and bandChain() read it in
// lib/mv3b-render.js: the source turned first (clockwise, 90 unless told otherwise), then scaled
// to cover the strip, then cut at the render's own offsets - down from the top at 0 and 180,
// across from the left at 90 and 270 - and the edges facing into the frame faded.
//
// COMPOSED ON A SCRATCH CANVAS FIRST, because a fade erases: erasing on the frame itself would
// cut a hole through the layers below instead of letting them show through.
//
// No placement, framing or effects - the render applies none to a band.
const _bpct = (v, dflt, lo = 0) => {
  const n = Number(v);
  return (v != null && Number.isFinite(n)) ? Math.max(lo, Math.min(100, n)) : dflt;
};

function _bandGeom(c) {
  let band = Math.round(H * _bpct(c.halferThick, 40, 5) / 100);
  if (band % 2) band++;
  band = Math.max(2, Math.min(H, band));
  const y = Math.round((H - band) * (1 - _bpct(c.halferPos, 100) / 100));
  const keep = _bpct(c.halferKeep, 100) / 100;
  const rot = [0, 90, 180, 270].includes(+c.rotation) && c.rotation != null ? +c.rotation : 90;
  const soft = (c.feather == null || !Number.isFinite(+c.feather)) ? 0.03 : Math.max(0, Math.min(0.4, +c.feather));
  const fade = soft > 0 ? Math.max(1, Math.round(band * soft)) : 0;
  return { band, y, keep, rot, fade, softTop: fade > 0 && y > 0, softBot: fade > 0 && y + band < H };
}

let _bandCv = null;

function _drawBand(el, sw, sh, c) {
  const b = _bandGeom(c);
  if (!_bandCv) _bandCv = document.createElement('canvas');
  if (_bandCv.width !== W || _bandCv.height !== b.band) { _bandCv.width = W; _bandCv.height = b.band; }
  const g = _bandCv.getContext('2d');
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = 'source-over';
  g.clearRect(0, 0, W, b.band);

  // The turned source's size, the cover scale, and where the slice starts in it.
  const side = (b.rot === 90 || b.rot === 270);
  const rw = side ? sh : sw, rh = side ? sw : sh;
  const s = Math.max(W / rw, b.band / rh);
  const RW = rw * s, RH = rh * s;
  const ox = side ? Math.max(0, RW - W) * b.keep : 0;
  const oy = side ? 0 : Math.max(0, RH - b.band) * (1 - b.keep);
  g.translate(-ox, -oy);
  if (b.rot === 90) { g.translate(RW, 0); g.rotate(Math.PI / 2); }
  else if (b.rot === 270) { g.translate(0, RH); g.rotate(-Math.PI / 2); }
  else if (b.rot === 180) { g.translate(RW, RH); g.rotate(Math.PI); }
  try { g.drawImage(el, 0, 0, sw * s, sh * s); } catch (e) {}
  g.setTransform(1, 0, 0, 1, 0, 0);

  if (b.softTop || b.softBot) {
    g.globalCompositeOperation = 'destination-out';
    const ramp = (y0, y1) => {
      const grd = g.createLinearGradient(0, y0, 0, y1);
      grd.addColorStop(0, 'rgba(0,0,0,1)');
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      return grd;
    };
    if (b.softTop) { g.fillStyle = ramp(0, b.fade); g.fillRect(0, 0, W, b.fade); }
    if (b.softBot) { g.fillStyle = ramp(b.band, b.band - b.fade); g.fillRect(0, b.band - b.fade, W, b.fade); }
    g.globalCompositeOperation = 'source-over';
  }
  try { _ctx.drawImage(_bandCv, 0, b.y); } catch (e) {}
  // Recorded for picking, and marked: place-b.js selects a band by a click and gives it no grips.
  return { band: true, dx: 0, dy: b.y, dw: W, dh: b.band, cx: W / 2, cy: b.y + b.band / 2, angle: 0 };
}

// Where in the FILE a moment of the timeline is. Straightforward forwards; the other way
// round when the element is holding a pre-reversed proxy.
//
// The proxy is the WHOLE source reversed, so the window this clip uses - [trimIn, trimIn +
// dur*speed] - lands at the far end of it and plays forward from there. Which is also what
// the render does: it trims first and reverses the trimmed piece, so both start from the last
// frame of the window. srcDur is the anchor, and a clip dropped before its length was known
// carries 0 - the element's own duration answers once it has loaded, and until something does
// this stays forwards rather than seeking to a negative time.
function _srcTime(c, at, elDur) {
  const sp = +c.speed || 1;
  const into = (at - (+c.start)) * sp;
  const src = (+c.srcDur > 0) ? +c.srcDur : (isFinite(elDur) && elDur > 0 ? elDur : 0);
  if (_rev(c) && src > 0) {
    return Math.max(0, src - (+c.trimIn || 0) - (+c.dur || 0) * sp) + into;
  }
  return (+c.trimIn || 0) + into;
}

// One clip onto the canvas, with whatever the three effects ask for. A clip with none of
// them - which is most of them - takes the same single drawImage it always did: the whole
// block below is skipped rather than run with neutral values.
// The picture itself onto the canvas, turned and softened if it was placed that way. Kept
// apart from the effects around it so that the common case - a full-frame clip with nothing
// set - is still one drawImage and no state to save and restore.
function _draw(el, r) {
  if (!r.placed || (!r.angle && !r.feather)) {
    try { _ctx.drawImage(el, r.sx, r.sy, r.sw, r.sh, r.dx, r.dy, r.dw, r.dh); } catch (e) {}
    return;
  }
  const src = r.feather > 0.001 ? softened(el, r.sx, r.sy, r.sw, r.sh, r.dw, r.dh, r.feather) : null;
  _ctx.save();
  _ctx.translate(r.cx, r.cy);
  if (r.angle) _ctx.rotate(r.angle * Math.PI / 180);
  try {
    if (src) _ctx.drawImage(src, -r.dw / 2, -r.dh / 2, r.dw, r.dh);
    else _ctx.drawImage(el, r.sx, r.sy, r.sw, r.sh, -r.dw / 2, -r.dh / 2, r.dw, r.dh);
  } catch (e) {}
  _ctx.restore();
}

function _blit(el, r, c, gaps) {
  if (!hasFx(c)) { _draw(el, r); return; }
  const fx = fxAt(c, _at);
  if (fx.gap) gaps.push(fx.gap);
  const z = zoomRect(r, fx.zoom);
  _ctx.save();
  // A blur reaches past the edges of what it is drawn from, so the picture is clipped to its
  // own rectangle - otherwise a blurred insert would smear over the layer beneath it. Not on a
  // turned insert: the rectangle is no longer where the picture is, and clipping to it would
  // cut the corners off.
  if (fx.css) {
    if (!r.angle) {
      _ctx.beginPath();
      _ctx.rect(r.dx, r.dy, r.dw, r.dh);
      _ctx.clip();
    }
    _ctx.filter = fx.css;
  }
  _draw(el, z);
  _ctx.restore();
  // Turned with the picture, because they are ON the picture: a veil over the upright
  // rectangle of a tilted insert would be a rectangle in the wrong place.
  if (r.angle) { _ctx.save(); _ctx.translate(r.cx, r.cy); _ctx.rotate(r.angle * Math.PI / 180); }
  const box = r.angle ? { dx: -r.dw / 2, dy: -r.dh / 2, dw: r.dw, dh: r.dh } : r;
  paintTint(_ctx, fx, box);
  paintVignette(_ctx, fx, box);
  // Last, over everything else this clip has been given: a fade is the final word on a frame,
  // and a grade painted after it would lift the black back out again - which is the order the
  // render uses too.
  paintVeil(_ctx, fx, box);
  if (r.angle) _ctx.restore();
}

// What is chosen but cannot be drawn. Named on the canvas rather than left to be discovered
// in the export - the same thing the other preview does for a reverse it cannot show.
function _note(text) {
  if (!text) return;
  _ctx.save();
  _ctx.font = '600 11px Inter, system-ui, sans-serif';
  const w = _ctx.measureText(text).width;
  _ctx.fillStyle = 'rgba(0,0,0,.55)';
  _ctx.fillRect(8, H - 26, w + 16, 18);
  _ctx.fillStyle = 'rgba(255,255,255,.92)';
  _ctx.fillText(text, 16, H - 13);
  _ctx.restore();
}

// One clip onto the frame: a band, or a picture placed or fitted with its effects.
function _show(el, sw, sh, c, gaps) {
  if (c.halfer) { _rects.set(c.id, _drawBand(el, sw, sh, c)); return; }
  const r = _place(sw, sh, c);
  _rects.set(c.id, r);
  _blit(el, r, c, gaps);
}

function _paint() {
  if (!_ctx) return 0;
  // Lent to the workshop: the stage shows what the step is doing, and at this point in a
  // talking-head project the timeline is usually empty anyway - a black frame is the honest
  // picture of it (docs/local-app/PLAN.md, "Мастерская talking head").
  if (_borrowed) {
    // No clip is drawn, so none is under the pointer: the gesture layer (js/merge-v3/place-b.js)
    // must not find the timeline's last rectangles under a press on the stage's halves.
    _rects.clear();
    _ctx.setTransform(1, 0, 0, 1, 0, 0);
    _ctx.fillStyle = '#000';
    _ctx.fillRect(0, 0, CW, CH);
    _ctx.save();
    _ctx.translate(_view.x, _view.y);
    _ctx.scale(_view.z, _view.z);
    _drawStill();
    _drawPair();
    _ctx.restore();
    return 0;
  }
  _rects.clear();
  // Layers under the playhead that had nothing decoded to draw yet - what a screenshot waits on.
  let missing = 0;
  _ctx.setTransform(1, 0, 0, 1, 0, 0);
  _ctx.fillStyle = SURROUND;
  _ctx.fillRect(0, 0, CW, CH);
  // From here on the origin is the FRAME's corner, and every number below is a frame number.
  _ctx.setTransform(1, 0, 0, 1, PAD, PAD);
  _ctx.fillStyle = '#000';
  _ctx.fillRect(0, 0, W, H);

  const tl = Store.timeline();
  const alive = new Set();
  const gaps = [];
  for (const c of _layers(tl).flatMap(track => _clipsAt(track, _at))) {
    if (!c.src) continue;
    const still = isStill({ src: c.src });
    alive.add(_key(c.src, _rev(c)));
    const el = _el(c.src, _rev(c));

    if (!still) {
      const want = _srcTime(c, _at, el.duration);

      // A SEEK IN FLIGHT IS NOT A DRIFT. While the element is still fetching or decoding its
      // time stands still, the drift test fails at once, and setting currentTime again
      // cancels the load and starts it over - every frame, so the clip never loads. The
      // first seek of a new element always lands; corrections wait until it is ready.
      if (el.__fresh === undefined) el.__fresh = true;
      const busy = !el.__fresh && (el.seeking || el.readyState < 2);
      if (_playing) {
        // LET IT PLAY. Setting currentTime every frame is scrubbing, not playing: the decoder
        // starts over on each seek and the picture crawls while the clock runs on - which is
        // exactly what a stuttering preview looks like. So the element runs on its own and is
        // only pulled back when it has genuinely drifted, which a seek every frame guarantees
        // it never gets the chance to do.
        el.playbackRate = Math.max(0.25, Math.min(4, +c.speed || 1));
        if (el.paused && !el.__playReq) el.__playReq = el.play().catch(() => {}).finally(() => { el.__playReq = null; });
        if (!busy && isFinite(want) && (el.__fresh || Math.abs((el.currentTime || 0) - want) > 0.35)) {
          try { el.currentTime = Math.max(0, want); } catch (e) {}
          el.__fresh = false;
        }
      } else {
        if (!el.paused) el.pause();
        if (!busy && isFinite(want) && (el.__fresh || Math.abs((el.currentTime || 0) - want) > 0.08)) {
          try { el.currentTime = Math.max(0, want); } catch (e) {}
          el.__fresh = false;
        }
      }
      if (!el.videoWidth || el.seeking || el.readyState < 2) missing++;
      if (!el.videoWidth) continue;               // nothing decoded yet
      _show(el, el.videoWidth, el.videoHeight, c, gaps);
    } else {
      if (!el.naturalWidth) { missing++; continue; }
      _show(el, el.naturalWidth, el.naturalHeight, c, gaps);
    }
  }
  // OVER EVERY LAYER, like the render burns them. Captions are not a layer of their own -
  // nothing is ever laid on top of the words - so they go on last, after the whole stack.
  try { paintCaptions(_ctx, tl, _at, W, H, (tl && tl.format) || '9:16'); } catch (e) {}

  // WHAT IS OUTSIDE THE FRAME, dimmed and edged. It is drawn rather than clipped away because
  // seeing where an insert has got to is the whole reason for the margin - but it must not read
  // as part of the film, and the line is where the film actually ends.
  // A screenshot is the film and nothing of the editor: no margin, no grips, no notes.
  if (_shooting) { _sweep(alive); return missing; }
  _ctx.setTransform(1, 0, 0, 1, 0, 0);
  _ctx.fillStyle = OUTSIDE;
  _ctx.fillRect(0, 0, CW, PAD);
  _ctx.fillRect(0, CH - PAD, CW, PAD);
  _ctx.fillRect(0, PAD, PAD, H);
  _ctx.fillRect(CW - PAD, PAD, PAD, H);
  _ctx.lineWidth = 1;
  _ctx.strokeStyle = 'rgba(255,255,255,.20)';
  _ctx.strokeRect(PAD + 0.5, PAD + 0.5, W - 1, H - 1);
  _ctx.setTransform(1, 0, 0, 1, PAD, PAD);

  // The grips last of all, over the veil and the captions - they are the editor's furniture
  // rather than part of the picture, and something you cannot see is something you cannot grab.
  try { paintHandles(_ctx); } catch (e) {}

  _note(gapNote(gaps));
  // Off screen means off. A video left running behind the playhead keeps decoding for nothing
  // and is somewhere else entirely by the time it is needed again.
  for (const [key, el] of _media) {
    if (el.pause && !el.paused && !alive.has(key)) { try { el.pause(); } catch (e) {} }
  }
  _sweep(alive);
  return missing;
}

// ── The screenshot ──────────────────────────────────────────────────────────
// The frame under the playhead at the film's own size (1080 wide for 9:16), drawn by the same
// code as the preview into a canvas of that size, off the ORIGINAL files - so what is saved is
// what is on screen, only sharp. The preview's own media and size are put back afterwards.
//
// COMPLETENESS BEATS RESOLUTION. A lane whose original has not loaded by the deadline would be
// missing from the picture, so then the frame is taken again off the proxies the preview already
// has, at preview size, and the result says so.
let _shooting = false;
const FULL = { '9:16': { w: 1080, h: 1920 }, '16:9': { w: 1920, h: 1080 } };

async function _settle(ms) {
  const until = performance.now() + ms;
  for (;;) {
    const missing = _paint();
    if (!missing) {
      // One more frame after the decoders say they are ready: the first paint after a seek can
      // still be the frame before it.
      await new Promise((r) => setTimeout(r, 120));
      if (!_paint()) return true;
    }
    if (performance.now() > until) return false;
    await new Promise((r) => setTimeout(r, 100));
  }
}

export async function grabFrame(ms = 12000) {
  if (!_on || !_ctx || _shooting) return { ok: false };
  if (_playing) pause();
  const keep = { W, H, PAD, CW, CH, ctx: _ctx, media: _media };
  const f = FULL[_fmt()] || FULL['9:16'];
  const cv = document.createElement('canvas');
  cv.width = f.w; cv.height = f.h;
  let full = false, shotMedia = null;
  try {
    W = f.w; H = f.h; PAD = 0; CW = f.w; CH = f.h;
    _ctx = cv.getContext('2d');
    _shooting = 'orig';
    _media = shotMedia = new Map();
    full = await _settle(ms);
    if (!full) {
      _shooting = 'proxy';
      _media = keep.media;
      await _settle(4000);
    }
    const blob = await new Promise((res) => { try { cv.toBlob(res, 'image/png'); } catch (e) { res(null); } });
    return { ok: !!blob, blob, full, w: f.w, h: f.h, at: _at };
  } finally {
    if (shotMedia) for (const [, el] of shotMedia) { try { if (el.pause) el.pause(); el.src = ''; } catch (e) {} }
    _shooting = false;
    W = keep.W; H = keep.H; PAD = keep.PAD; CW = keep.CW; CH = keep.CH;
    _ctx = keep.ctx; _media = keep.media;
    _repaint();
  }
}

// A seek is answered as soon as the element has anything, and again a moment later when the
// decoder has caught up: a single paint after setting currentTime draws the OLD frame,
// which reads as a preview that ignores the playhead.
function _repaint() {
  if (!_on) return;
  _paint();
  // NOT while playing. This cancels the frame it is about to replace, and during playback the
  // frame it would cancel is the tick that drives the clock - so any store change while
  // playing killed playback outright. A debounced save landing half a second after a clip is
  // dropped is exactly such a change, which made it look as though play did nothing at all.
  if (_playing) return;
  cancelAnimationFrame(_raf);
  _raf = requestAnimationFrame(() => { if (_on && !_playing) _paint(); });
}

export function seek(t) {
  _at = Math.max(0, Math.round((+t || 0) * 100) / 100);
  _at0 = _at; _t0 = performance.now();
  _repaint();
  _clock();
  setPlayhead(_at);
  _syncAudio();
}

export const playheadAt = () => _at;

function _clock() {
  const el = document.getElementById('mv3-pv-time');
  if (!el) return;
  const f = (v) => {
    const m = Math.floor(v / 60), s = (v - m * 60);
    return m + ':' + (s < 10 ? '0' : '') + s.toFixed(1);
  };
  el.textContent = f(_at) + ' / ' + f(duration());
}

// ── Playing ─────────────────────────────────────────────────────────────────
// The clock is ours and runs on wall time; the media follows it rather than the other way
// round. Letting a <video> element's own currentTime drive the timeline works until two of
// them are on screen at once, and then the picture and the sound belong to whichever
// happened to be decoding faster.
let _playing = false;
let _t0 = 0, _at0 = 0;
let _audio = new Map();      // src -> HTMLAudioElement, one per source

// Every audible sound at this moment. A clip at volume 0 is SKIPPED - that is what a muted
// birol is, and what the subtitle pass will read to decide what to transcribe. Track volume
// multiplies, so a lane can be quietened without touching the clips on it.
function _sounds(tl, t) {
  const out = [];
  if (!tl || !Array.isArray(tl.tracks)) return out;
  for (const tr of tl.tracks) {
    if (tr.kind !== 'audio') continue;
    const master = (tr.volume == null) ? 1 : +tr.volume;
    if (!(master > 0)) continue;
    for (const c of (tr.clips || [])) {
      const v = ((c.volume == null) ? 1 : +c.volume) * master;
      if (!(v > 0)) continue;
      const s = +c.start, e = s + (+c.dur);
      if (t < s - 0.0001 || t >= e) continue;
      out.push({ c, gain: Math.min(1, v) });
    }
  }
  return out;
}

// Sound is taken from the same place the picture is. For a reversed clip that means the
// reversed proxy, whose audio ffmpeg has already run through `areverse` - which is the only
// way to hear one, since no element plays a file backwards.
function _aud(c) {
  const rev = _rev(c);
  const key = _key(c.src, rev);
  if (_audio.has(key)) return _audio.get(key);
  const el = new Audio();
  el.preload = 'auto';
  el.src = rev ? _srcFor(c.src, true) : c.src;
  _audio.set(key, el);
  return el;
}

function _syncAudio() {
  const tl = Store.timeline();
  const live = _sounds(tl, _at);
  const alive = new Set(live.map(x => _key(x.c.src, _rev(x.c))));
  for (const [key, el] of _audio) {
    if (alive.has(key)) continue;
    try { el.pause(); } catch (e) {}
  }
  for (const { c, gain } of live) {
    // A reversed clip whose source is not a film - a bare mp3 on an audio lane - has nothing
    // to play: the proxy cannot reverse what it cannot transcode. Silent rather than
    // forwards, because forwards would be the wrong words in the right place.
    if (c.reversed && !_rev(c)) continue;
    const el = _aud(c);
    el.volume = gain;
    el.playbackRate = Math.max(0.25, Math.min(4, +c.speed || 1));
    const want = _srcTime(c, _at, el.duration);
    // The same busy rule as the picture: no correction while a load is in progress.
    if (el.__fresh === undefined) el.__fresh = true;
    const busy = !el.__fresh && (el.seeking || el.readyState < 2);
    if (!busy && isFinite(want) && (el.__fresh || Math.abs((el.currentTime || 0) - want) > 0.25)) {
      try { el.currentTime = Math.max(0, want); } catch (e) {}
      el.__fresh = false;
    }
    if (_playing && el.paused && !el.__playReq) el.__playReq = el.play().catch(() => {}).finally(() => { el.__playReq = null; });
    if (!_playing && !el.paused) el.pause();
  }
}

function _tick() {
  if (!_playing) return;
  const now = performance.now();
  _at = Math.max(0, _at0 + (now - _t0) / 1000);
  const end = duration();
  if (_at >= end) { _at = end; pause(); _paint(); _clock(); setPlayhead(_at); return; }
  _paint();
  _clock();
  // The line on the timeline is the same moment as the picture. It followed a click on the
  // ruler and nothing else, so during playback it sat still while the video moved - two
  // readings of one thing, disagreeing.
  setPlayhead(_at);
  _syncAudio();
  _raf = requestAnimationFrame(_tick);
}

// ── Lending the stage ───────────────────────────────────────────────────────
// A build step of the workshop shows its own thing there - a character, a generation, a
// result - so the transport stands down rather than playing a timeline nobody is looking at.
// The class is what dims and disables the transport; the guards below are what make it true
// even for a key press.
let _borrowed = false;

export function borrow(on) {
  const want = !!on;
  if (_borrowed === want) return;
  _borrowed = want;
  if (!_borrowed) { _still = null; _pair = null; }
  if (_borrowed) pause();
  document.body.classList.toggle('mv3-workshop', _borrowed);
  _view = { z: 1, x: 0, y: 0 };
  if (_still) _still.box = null;
  if (_pair) _pair.boxes = null;
  // The stage stops being a 9:16 window and becomes the whole panel: nothing here is a frame
  // of the film, and a reference being judged should use the room there is.
  CW = 0; CH = 0;
  _fit();
  if (_on) _paint();
}

// ── Moving around a reference ───────────────────────────────────────────────
// A touchpad pinch arrives as a wheel event with ctrlKey set, and two fingers arrive as a
// wheel with deltas - so one listener covers both, and the mouse gets the same gestures with
// Ctrl held. Double-click puts it back. The numbers live here and are thrown away the moment
// the stage goes back to the timeline: this is a way of looking, not a setting.
let _view = { z: 1, x: 0, y: 0 };
let _ro = null;
const ZOOM_MIN = 0.2, ZOOM_MAX = 8;

function _wireZoom(cv) {
  cv.addEventListener('wheel', (e) => {
    if (!_borrowed) return;
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      // Around the pointer, so the thing being looked at stays under it.
      const r = cv.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width * CW;
      const py = (e.clientY - r.top) / r.height * CH;
      const next = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, _view.z * Math.exp(-e.deltaY / 240)));
      const k = next / _view.z;
      _view.x = px - (px - _view.x) * k;
      _view.y = py - (py - _view.y) * k;
      _view.z = next;
    } else {
      _view.x -= e.deltaX;
      _view.y -= e.deltaY;
    }
    _paint();
  }, { passive: false });
  cv.addEventListener('dblclick', () => { if (_borrowed) _centre(); });
  // A half of the pair is a DOOR (showPair's onPick). The click is taken to the surface - back
  // through the shift and the zoom - and the half is read off where it lands there, so a reference
  // pushed up close opens what is under the pointer and not what is under the panel's middle.
  const pick = (e) => {
    if (!_borrowed || !_pair || !_pair.onPick) return;
    e.preventDefault();
    const r = cv.getBoundingClientRect();
    const py = (e.clientY - r.top) / r.height * CH;
    const sy = (py - _view.y) / _view.z;
    _pair.onPick(sy < PAD + H / 2 ? 'top' : 'bottom', e);
  };
  cv.addEventListener('click', pick);
  cv.addEventListener('contextmenu', pick);
}

// The canvas takes the panel's own size while the workshop holds it, in real pixels, so a
// picture enlarged four times is still sharp.
//
// DRAGGING THE SASH MUST NOT RESIZE THE PICTURE. The surface is what got wider; the reference
// on it is the same reference, and re-fitting it to every intermediate width makes it breathe
// in and out under the hand. So the canvas is re-made at the new size and the view is shifted
// by half the difference - the picture keeps its pixels and stays where it was, relative to
// the middle. What it is NOT is stretched: the canvas always carries exactly as many pixels as
// the box it is shown in, which is the only way a canvas avoids being squashed by CSS.
function _fit() {
  const stage = document.getElementById(STAGE);
  if (!_cv || !stage) return;
  const r = stage.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(1, Math.round(r.width * dpr));
  const h = Math.max(1, Math.round(r.height * dpr));
  if (w === CW && h === CH && _cv.width === w) return;
  if (CW && CH && (_still || _pair)) {
    _view.x += (w - CW) / 2;
    _view.y += (h - CH) / 2;
  }
  CW = w;
  CH = h;
  _cv.width = CW;
  _cv.height = CH;
  PAD = 0;
  W = CW;
  H = CH;
}

// Where a picture sits on the surface, decided ONCE - when it arrives, and again when it is
// asked to be centred. Everything after that is the view moving over it, so nothing about the
// panel's size can change the picture's own size.
function _layout(img) {
  if (!img || !img.naturalWidth) return null;
  const s = Math.min(CW / img.naturalWidth, CH / img.naturalHeight);
  const w = Math.round(img.naturalWidth * s);
  const h = Math.round(img.naturalHeight * s);
  return { w, h, x: Math.round((CW - w) / 2), y: Math.round((CH - h) / 2) };
}

// Put it back in the middle at its natural fit - the one gesture that undoes any amount of
// pushing and pinching.
function _centre() {
  _view = { z: 1, x: 0, y: 0 };
  if (_still && _still.img) _still.box = _layout(_still.img);
  if (_pair) _pair.boxes = null;
  if (_on) _paint();
}

export const isBorrowed = () => _borrowed;

/**
 * Show one picture on the borrowed stage - who was cast, the look being tried, the frame
 * just made. Letterboxed inside the frame, not cropped: this is a reference being looked
 * at, and cutting a face in half to fill a 9:16 hole would defeat the point of showing it.
 *
 * @param src      the picture, or '' to go back to black
 * @param caption  a line under it, for saying WHICH of two similar pictures this is
 */
export function showStill(src, caption) {
  // The same picture again is not a new one - a panel repaints after every save. It keeps
  // where it was pushed and how far it was pinched, and it is not loaded a second time.
  if (src && _still && _still.src === src && _still.img) {
    _still.caption = String(caption || '');
    if (_on) _paint();
    return;
  }
  // A NEW picture arrives fitted and in the middle. The view is how the last one was being
  // looked at - after a sash drag it holds the shift that kept THAT one centred - and applied
  // to this one it would only push it off to the side.
  _view = { z: 1, x: 0, y: 0 };
  _pair = null;
  if (!src) { _still = null; if (_on) _paint(); return; }
  const img = new Image();
  img.decoding = 'async';
  img.onload = () => { if (_still && _still.src === src) { _still.img = img; _still.box = null; if (_on) _paint(); } };
  // A picture that will not load leaves the caption: the choice was still made, and a
  // black rectangle with no word on it looks like a failure of the choice rather than
  // of one file.
  img.onerror = () => { if (_still && _still.src === src) { _still.img = null; if (_on) _paint(); } };
  _still = { src, caption: String(caption || ''), img: null };
  img.src = src;
  if (_on) _paint();
}

let _still = null;
let _pair = null;

// One half of the pair, as showPair takes it: a bare address (the fragments step, whose pair has
// no words and no doors), or the whole description of what the half shows and says.
function _halfSpec(x) {
  if (x && typeof x === 'object') {
    return { src: String(x.src || ''), caption: String(x.caption || ''), empty: String(x.empty || '') };
  }
  return { src: String(x || ''), caption: '', empty: '' };
}

/**
 * Two pictures on the stage, one above the other - what is being combined, before it is.
 * The dressing asks exactly this question: this person, wearing that; so the person is on
 * top, the outfit below, and the button that joins them sits between (js/merge-v3/wk-setting.js).
 * The setting step shows its casting the same way - who on top, where below - and there each
 * half is also a DOOR: what an empty half says, and what a press on it opens, come with it.
 *
 * @param top     the upper half: an address, '' for an empty half, or { src, caption, empty } -
 *                the caption under the picture, and what the half says while it has none
 * @param bottom  the lower half, the same way
 * @param onPick  (half, event) for a click or a context menu on a half - 'top' | 'bottom' - or
 *                nothing, for a pair that is only looked at
 */
export function showPair(top, bottom, onPick) {
  _still = null;
  const a = _halfSpec(top), b = _halfSpec(bottom);
  const want = a.src + '|' + b.src;
  if (_pair && _pair.key === want) {
    // The same pictures again - a panel repaints after every save. The words on them and the
    // doors may have changed; the pictures keep where they were pushed and pinched.
    _pair.spec = [a, b];
    _pair.onPick = onPick || null;
    if (_on) _paint();
    return;
  }
  // A new pair starts fitted and centred, for the reason a new still does (showStill).
  _view = { z: 1, x: 0, y: 0 };
  _pair = { key: want, top: null, bottom: null, spec: [a, b], onPick: onPick || null };
  const load = (src, slot) => {
    if (!src) return;
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => { if (_pair && _pair.key === want) { _pair[slot] = img; _pair.boxes = null; if (_on) _paint(); } };
    img.onerror = () => { /* the other half still says what this is about */ };
    img.src = src;
  };
  load(a.src, 'top');
  load(b.src, 'bottom');
  if (_on) _paint();
}

// Each picture inside its own half, whole - the point is to SEE both, and cropping either
// to fill a half would hide the thing being judged.
function _drawPair() {
  if (!_pair) return;
  if (!_pair.boxes) {
    // Both halves measured once, against the surface as it was then.
    _pair.boxes = [[_pair.top, PAD, H / 2], [_pair.bottom, PAD + H / 2, H / 2]].map(([img, top, hh]) => {
      if (!img || !img.naturalWidth) return null;
      const s = Math.min(W / img.naturalWidth, (hh - 8) / img.naturalHeight);
      const w = Math.round(img.naturalWidth * s), h = Math.round(img.naturalHeight * s);
      return { img, x: Math.round(PAD + (W - w) / 2), y: Math.round(top + (hh - h) / 2), w, h };
    });
  }
  for (const b of _pair.boxes) if (b) _ctx.drawImage(b.img, b.x, b.y, b.w, b.h);
  // What each half SAYS: a caption under its picture, or - with no picture - what the half is
  // waiting for, inside a dashed frame that reads as a field to be filled.
  const spec = _pair.spec || [];
  [[PAD, H / 2], [PAD + H / 2, H / 2]].forEach(([top, hh], i) => {
    const s = spec[i];
    if (!s) return;
    if (s.src) { if (s.caption) _caption(s.caption, top + hh, hh); return; }
    if (!s.empty) return;
    const inset = Math.round(Math.min(W, hh) * 0.06);
    _ctx.save();
    _ctx.setLineDash([8, 7]);
    _ctx.lineWidth = 2;
    _ctx.strokeStyle = 'rgba(255,255,255,.28)';
    _ctx.strokeRect(PAD + inset, top + inset, W - 2 * inset, hh - 2 * inset);
    _ctx.restore();
    _ctx.font = '600 ' + Math.round(Math.min(W, H) * 0.045) + 'px Inter, Segoe UI, system-ui, sans-serif';
    _ctx.textAlign = 'center';
    _ctx.textBaseline = 'middle';
    _ctx.fillStyle = 'rgba(255,255,255,.5)';
    _ctx.fillText(s.empty, PAD + W / 2, top + hh / 2);
    _ctx.textBaseline = 'alphabetic';
    _ctx.textAlign = 'left';
  });
}

// A line of words in a dark pill, low in the band it belongs to: a still's caption at the foot of
// the frame, a half's under its picture. Sized by the frame, so the two read alike.
function _caption(cap, bottom, hh) {
  const size = Math.round(Math.min(H * 0.022, hh * 0.05));
  _ctx.font = '600 ' + size + 'px Inter, Segoe UI, system-ui, sans-serif';
  _ctx.textAlign = 'center';
  _ctx.fillStyle = 'rgba(0,0,0,.55)';
  const y = bottom - Math.round(size * 2);
  const tw = _ctx.measureText(cap).width;
  _ctx.fillRect(PAD + W / 2 - tw / 2 - 10, y - Math.round(size * 1.3), tw + 20, Math.round(size * 1.8));
  _ctx.fillStyle = '#fff';
  _ctx.fillText(cap, PAD + W / 2, y);
  _ctx.textAlign = 'left';
}

function _drawStill() {
  if (!_still) return;
  const cap = _still.caption;
  const img = _still.img;
  if (img && img.naturalWidth) {
    // Fitted once, when it arrived. From then on it is a thing lying on the surface, and the
    // surface is what the sash resizes.
    if (!_still.box) _still.box = _layout(img);
    const b = _still.box;
    if (_borrowed) _ctx.drawImage(img, b.x, b.y, b.w, b.h);
    else {
      const s = Math.min(W / img.naturalWidth, H / img.naturalHeight);
      const w = Math.round(img.naturalWidth * s), h = Math.round(img.naturalHeight * s);
      _ctx.drawImage(img, Math.round(PAD + (W - w) / 2), Math.round(PAD + (H - h) / 2), w, h);
    }
  }
  if (cap) _caption(cap, PAD + H, H);
}

export function play() {
  if (_borrowed) return;
  if (!_on || _playing) return;
  if (_at >= duration()) _at = 0;
  _playing = true;
  _t0 = performance.now();
  _at0 = _at;
  _syncAudio();
  _syncPlayBtn();
  _raf = requestAnimationFrame(_tick);
}

export function pause() {
  if (!_on || !_playing) return;
  _playing = false;
  cancelAnimationFrame(_raf);
  for (const [, el] of _audio) { try { el.pause(); } catch (e) {} }
  for (const [, el] of _media) { try { if (el.pause) el.pause(); } catch (e) {} }
  _syncPlayBtn();
}

export function toggle() { if (_borrowed) return; _playing ? pause() : play(); }

function _syncPlayBtn() {
  const b = document.getElementById('mv3-pv-play');
  if (b) { b.innerHTML = _playing ? '&#10074;&#10074;' : '&#9654;'; b.title = _playing ? 'Pause (Space)' : 'Play (Space)'; }
}

// ── Mounting ────────────────────────────────────────────────────────────────
// The format picker, between the clock and the quality. Built here and removed on unmount,
// because it belongs to this workflow: a scenario project's frame comes from the scenario and
// is not a choice to offer beside it.
function _wireFormat() {
  const bar = document.querySelector('.mv3-pv-bar');
  const q = document.getElementById('mv3-pv-q');
  if (!bar || document.getElementById('mv3-pvb-fmt')) return;
  const sel = document.createElement('select');
  sel.id = 'mv3-pvb-fmt';
  // Styled by id to match the quality picker beside it - mv3-pv-q is the label that WRAPS
  // that select, not the select itself, so borrowing the class styled nothing.
  sel.className = '';
  sel.title = 'The shape of the finished video';
  for (const [k, v] of Object.entries(FORMATS)) {
    const o = document.createElement('option');
    o.value = k; o.textContent = v.label;
    sel.appendChild(o);
  }
  sel.value = _fmt();
  sel.addEventListener('change', () => {
    const next = FORMATS[sel.value] ? sel.value : '9:16';
    Store.mutate(tl => { tl.format = next; });
    // A line length left on `auto` follows the frame, and following it means the lines that
    // are already down get re-cut - eight words across a column is the paragraph-in-a-shoe-box
    // this rule exists to prevent, and it would arrive silently on the format change.
    const tl = Store.timeline();
    const tr = subsTrack(tl);
    if (tr && !(+((tr.style || {}).wordsPerLine) > 0)) {
      const list = regroup(tr, autoWordsPerLine(next));
      if (list) setSubsStyle(tr.id, {}, list);
    }
    _resize();
    _repaint();
  });
  // Straight after the clock, which puts it before the quality picker - asking for a
  // relationship to one neighbour rather than to the bar, so it cannot quietly fall to the
  // end when a sibling is not where it was assumed to be.
  const time = document.getElementById('mv3-pv-time');
  if (time) time.after(sel);
  else if (q) q.before(sel);
  else bar.appendChild(sel);
}

function _resize() {
  if (_borrowed) return _fit();
  const f = FORMATS[_fmt()];
  W = f.w; H = f.h;
  PAD = Math.round(Math.min(W, H) * PAD_FRAC);
  CW = W + PAD * 2; CH = H + PAD * 2;
  if (_cv) { _cv.width = CW; _cv.height = CH; }
  // The stage is shaped by a stylesheet rule per format; with a margin the shape is no longer
  // either of them, so it is stated here - inline, which is what lets one number decide it.
  const stage = document.getElementById(STAGE);
  if (stage) stage.style.aspectRatio = CW + ' / ' + CH;
  // The stage is shaped by CSS, so the shape has to reach CSS. On the body because the stage
  // itself belongs to whichever preview is mounted.
  document.body.classList.toggle('mv3-fmt-169', _fmt() === '16:9');
  const sel = document.getElementById('mv3-pvb-fmt');
  if (sel && sel.value !== _fmt()) sel.value = _fmt();
}

export function mount() {
  _on = true;
  const stage = document.getElementById(STAGE);
  if (!stage) return;
  stage.textContent = '';
  _cv = document.createElement('canvas');
  _cv.className = 'mv3-pv-canvas';
  stage.appendChild(_cv);
  _ctx = _cv.getContext('2d');
  _resize();
  // The gesture layer is handed what only this module knows: where each insert was actually
  // drawn, and how to make it draw again mid-drag.
  _wireZoom(_cv);
  // The sash changes the panel without touching the window, so the only way to hear about it
  // is to watch the stage itself. Without this the canvas keeps its old pixel count in a box
  // of a new shape, and the browser squashes what is on it.
  if (window.ResizeObserver && !_ro) {
    _ro = new ResizeObserver(() => { if (_on && _borrowed) { _fit(); _paint(); } });
    const stage = document.getElementById(STAGE);
    if (stage) _ro.observe(stage);
  }
  wirePlace(_cv, {
    rectOf: (id) => _rects.get(id),
    rects: () => _rects,
    pad: () => PAD,
    frame: () => ({ w: W, h: H }),
    repaint: () => { if (_on) _paint(); },
  });
  _wireFormat();
  _wireTransport();
  _repaint();
  _clock();
  _syncPlayBtn();
}

// The transport is shared hardware. The other preview stands down while this one holds the
// stage (see its _mounted guard), so these listeners are added once and simply do nothing
// when this module is not showing.
let _wired = false;
function _wireTransport() {
  if (_wired) return;
  _wired = true;
  const on = (id, fn) => { const b = document.getElementById(id); if (b) b.addEventListener('click', () => { if (_on) fn(); }); };
  on('mv3-pv-play', toggle);
  on('mv3-pv-start', () => { pause(); seek(0); });
  on('mv3-pv-back', () => seek(Math.max(0, _at - 5)));
  on('mv3-pv-fwd', () => seek(Math.min(duration(), _at + 5)));
  document.addEventListener('keydown', (e) => {
    if (!_on) return;
    // A window on top owns the keyboard (js/layers.js): with a dialog open, Space is a
    // space in whatever field is focused, not play.
    if (Layers.blocked()) return;
    if (e.code !== 'Space') return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test((e.target.tagName || ''))) return;
    e.preventDefault();
    toggle();
  });
}

export function unmount() {
  // Nothing to give back if it was never taken. Without this guard the dispatcher's first
  // swap at boot - which unmounts this one before mounting the other - emptied the stage and
  // took the talking-head canvas with it, before a blank project had ever been opened.
  if (!_on) return;
  _on = false;
  pause();
  cancelAnimationFrame(_raf);
  for (const [, el] of _audio) { try { el.pause(); el.src = ''; } catch (e) {} }
  _audio.clear();
  _sweep(new Set());
  const stage = document.getElementById(STAGE);
  if (stage) stage.textContent = '';
  unwirePlace();
  _rects.clear();
  const st0 = document.getElementById(STAGE);
  if (st0) st0.style.aspectRatio = '';
  const sel = document.getElementById('mv3-pvb-fmt');
  if (sel) sel.remove();
  document.body.classList.remove('mv3-fmt-169');
  _cv = null; _ctx = null;
}

export const isMounted = () => _on;

export function initPreviewB() {
  // Not while a screenshot is being drawn: that has the frame's size and its own canvas in hand.
  Store.onChange(() => { if (_on && !_shooting) { _resize(); _repaint(); _clock(); } });
  // A dragged sash changes the surface the workshop is drawing on, and nothing else would
  // notice: the timeline's own frame is a fixed size, this one is the panel.
  window.addEventListener('resize', () => { if (_on && _borrowed) { _resize(); _paint(); } });
  const q = document.getElementById('mv3-pv-q');
  // A new quality means new files. The old ones are dropped rather than left in the map,
  // where they would be held open for a resolution nothing is going to ask for again.
  if (q) q.addEventListener('change', () => { if (_on) { _sweep(new Set()); _repaint(); } });
}
