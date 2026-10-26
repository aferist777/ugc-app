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
import { paintCaptions } from './subs-b.js';
// The captions, drawn by libass itself over the frame (phase K4) - the painter above draws only while
// that is not up yet.
import * as CapLayer from '../captions/layer.js';
import { wirePlace, paintHandles, liveOf } from './place-b.js';
// Captions picked and moved on the preview, and the platforms' screens over the frame (phase V30, block 3).
import * as CapPlace from './cap-place.js';
import * as Platforms from './platforms.js';
import { isStill } from './store.js';
import { fadesOf } from '../sound/fades.js';
import { setPlayhead, setFormat } from './timeline-b.js';
// (phase V33.2) A filled clip's window over time - the one answer the render reads too.
import { isFramed, windowAt, windowW, zoomAt } from '../framing/path.js';
// (phase V51, point 1) A clip's crop - a piece of its file cut first; the render reads the same module.
import { active as cropActive, BLUR_FROM_PIECE } from '../framing/crop.js';

const STAGE = 'mv3-stage';

let _on = false;
let _cv = null;          // our canvas, ours alone - the other preview owns its own
let _ctx = null;
// The grips of a picked insert, on a canvas of their own ABOVE the captions' (phase K4 review): libass
// draws the captions on a canvas laid over this one, and the grips are the editor's furniture - over
// everything. Clicks still go to _cv underneath; this one lets them through.
let _hcv = null;
let _hctx = null;
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

// TWO ELEMENTS FOR A FILE CUT INTO PIECES (phase V44; measured in its block 0: one element per file followed a cut only once
// it had drifted past 0.25 s for the sound, 0.35 s for the picture - a pause cut out was heard and seen as if still there - and
// every correction while playing left the sound silent and the picture still for ~0.2 s). Pieces of one file laid end to end
// on a lane with a jump in the file between them (cut silence, a stretch cut by hand) take turns between two elements: while
// one plays its piece, the other waits paused on the first frame of the next (_cue), and at the seam the waiting one simply
// starts. A piece that plays on in its file from where the one before it ended (a split) keeps the same element. A piece
// after a very short one (a word between two pauses) would find the other element free only a moment before it starts -
// too late to be put in place (~0.2 s a seek, measured) - so a THIRD element takes it when that one has had longer to wait.
//
// CLIPS OF ONE FILE THAT OVERLAP get an element each too (phase V49, the owner's point 1: "помехи при проигрывании"; measured
// in its block 0 in the Electron window: one track laid twice, overlapping, shared ONE element - it was sought to one clip's
// moment and then to the other's on every frame, 991 seeks in 6 s, and what came out was a few scraps and silence). Pieces
// that run over the next one (0.05 s in an older cut) are such clips as well. So the elements are dealt out per FILE across
// every lane - the picture's elements and the sound's apart, as they are kept - by the moments they are busy: a clip takes
// an element nobody is playing at its start, one that has had READY to be put in place first if there is one (the lowest),
// else a new one while a run has fewer than SLOTS_RUN (two very short pieces in a row left none of three ready: the third
// short piece of the Kids fragment started 0.5 s late), else the one let go of longest ago; an element past that is added
// only while every one is busy at that moment (an overlap) - at most SLOTS_MAX of one file.
const SEAM = 0.011;               // two clips this close meet
const LOOK = 3;                   // s: the next piece is made ready this long before it starts
const READY = 0.6;                // s: how long an element should have to be put in place before its piece
const SOON = 1.5;                 // s: (V49) a piece starting this soon after Play is waited for by the hold
const SLOTS_RUN = 4;              // elements a run of pieces end to end takes turns between, at most
const SLOTS_MAX = 8;              // elements of one file at most, overlaps included
let _slotTl = null;
let _slotMap = new Map();         // clip id -> its element's number for its file (0 is the file's own key)
let _slotN = new Map();           // 'v|' / 'a|' + file key -> how many elements its clips use
const _group = (tr, c) => (tr.kind === 'video' ? 'v|' : 'a|') + c.src + (_rev(c) ? '|rev' : '');
function _slots(tl) {
  const out = new Map(), count = new Map();
  const groups = new Map();         // group -> [{ c, lane }]
  for (const tr of ((tl && tl.tracks) || [])) {
    if (!tr || (tr.kind !== 'video' && tr.kind !== 'audio')) continue;
    for (const c of (tr.clips || [])) {
      // A picture never seeks: one element serves every clip of it.
      if (!c || !c.src || isStill(c)) continue;
      const g = _group(tr, c);
      (groups.get(g) || groups.set(g, []).get(g)).push({ c, lane: tr.id });
    }
  }
  for (const [g, list] of groups) {
    list.sort((x, y) => (+x.c.start) - (+y.c.start));
    const free = [];                // when each element is let go of
    const last = [];                // the clip each element played last
    for (const { c, lane } of list) {
      const s = +c.start, e = s + (+c.dur || 0);
      let slot = -1;
      // A piece that plays on in its file from where the one before it on its lane ended (a split) keeps that element - it
      // need not seek at all. A split leaves the file's time running on to the hundredth; cut silence takes from 0.02 s out.
      for (let k = 0; k < free.length && slot < 0; k++) {
        const p = last[k];
        if (!p || p.lane !== lane || Math.abs(free[k] - s) >= SEAM) continue;
        const sp = +p.c.speed || 1;
        if (!c.reversed && !p.c.reversed && (+c.speed || 1) === sp
            && Math.abs((+p.c.trimIn || 0) + (+p.c.dur) * sp - (+c.trimIn || 0)) < 0.006) slot = k;
      }
      if (slot < 0) {
        const idle = [];             // free at this clip's start (a hair of rounding allowed)
        for (let k = 0; k < free.length; k++) if (free[k] <= s + 0.0005) idle.push(k);
        const ready = idle.filter((k) => free[k] <= s - READY);
        if (ready.length) slot = ready[0];
        else if ((!idle.length || free.length < SLOTS_RUN) && free.length < SLOTS_MAX) slot = free.length;
        else {
          const from = idle.length ? idle : free.map((_, k) => k);
          slot = from.reduce((a, k) => (free[k] < free[a] ? k : a), from[0]);
        }
      }
      free[slot] = Math.max(free[slot] == null ? -Infinity : free[slot], e);
      last[slot] = { c, lane };
      out.set(c.id, slot);
    }
    count.set(g, Math.max(1, free.length));
  }
  return { out, count };
}
function _slotsNow() {
  const tl = Store.timeline();
  if (tl !== _slotTl) { _slotTl = tl; const r = _slots(tl); _slotMap = r.out; _slotN = r.count; }
}
function _slotOf(c) {
  _slotsNow();
  return _slotMap.get(c.id) || 0;
}
// How many elements the clips of `c`'s file use on lanes of `kind` - kept alive together while the file is on screen.
function _slotCount(kind, c) {
  _slotsNow();
  return _slotN.get((kind === 'video' ? 'v|' : 'a|') + c.src + (_rev(c) ? '|rev' : '')) || 1;
}
const _slotKey = (slot) => (slot ? '#' + (slot + 1) : '');
const _keyOf = (c) => _key(c.src, _rev(c)) + _slotKey(_slotOf(c));

// The clips of a lane that start after `t` and within LOOK of it, the nearest first.
function _nextOn(track, t) {
  const out = [];
  for (const c of (track.clips || [])) {
    const s = +c.start;
    if (c.src && s > t + 0.0001 && s <= t + LOOK) out.push(c);
  }
  return out.sort((a, b) => (+a.start) - (+b.start));
}

// An element made ready for clip `c` before it starts: paused, on the clip's first moment.
function _cue(el, c) {
  if (el.seeking) return;
  if (!el.paused) { try { el.pause(); } catch (e) {} }
  const want = _srcTime(c, +c.start, el.duration);
  if (!isFinite(want)) return;
  if (el.__fresh !== false || Math.abs((el.currentTime || 0) - want) > 0.02) {
    try { el.currentTime = Math.max(0, want); } catch (e) {}
  }
  el.__fresh = false;
}

// The clip an element plays now is not the one it played a moment ago: it goes where it should AT ONCE (a jump of a tenth
// is a cut, not a drift), not when it has drifted past the tolerance. Not tighter than JUMP: an element that has just
// started runs ~0.05 s behind the clock (measured, V44 block 3) and a tighter rule would seek it for nothing.
const JUMP = 0.1;
function _jumpOf(el, c) {
  if (el.__live !== c.id) { el.__live = c.id; el.__jump = true; }
  return !!el.__jump;
}

// A PICTURE THAT HAS ARRIVED ASKS TO BE DRAWN (phase L7, the owner 2026-09-23). An element is made
// by the paint that first needs it - the playhead has just landed on its clip - and that paint, and
// the one a frame later, both find nothing decoded: the file is not even open yet. Nothing looked
// again when it was, so the stage stayed black until the next seek into the same clip, which then
// found the file open. Now the element says when it has something: its first data, the end of every
// seek, an image's load. Not while playing - the clock paints every frame anyway, and a repaint from
// here would cancel the tick that drives it (see _repaint).
function _ready() {
  if (_on && !_playing) _repaint();
}

// THE CLIP'S POSTER WHILE ITS FILE OPENS (phase V23, L7; the owner: "у всех на миг"). A clip carries its miniature
// (`thumb` - a Library drop, the mirror's clip); until the video has a frame decoded, that stands in its place and in
// its shape - better than black, if only for a moment. A frame from near the start of the source: a trimmed clip's is
// not the frame under the playhead, which is accepted. Only pictures - an /api/thumb address or an image file - and
// never in a screenshot, which waits for the real frame.
const _posters = new Map();      // thumb address -> Image
const POSTER_RE = /^\/api\/thumb\?|\.(jpe?g|png|webp)(\?|$)/i;
function _posterOf(c) {
  const u = String((c && c.thumb) || '');
  if (!u || !POSTER_RE.test(u)) return null;
  let im = _posters.get(u);
  if (!im) {
    if (_posters.size > 300) _posters.clear();
    im = new Image();
    im.decoding = 'async';
    im.addEventListener('load', _ready);
    im.src = u;
    _posters.set(u, im);
  }
  return im.naturalWidth ? im : null;
}

function _el(src, rev, slot) {
  const key = _key(src, rev) + _slotKey(slot);
  if (_media.has(key)) return _media.get(key);
  let el;
  if (isStill({ src })) {
    el = new Image();
    el.decoding = 'async';
    el.addEventListener('load', _ready);
  } else {
    el = document.createElement('video');
    el.muted = true;            // sound is the audio lanes' business, not the picture's
    el.playsInline = true;
    el.preload = 'auto';
    el.addEventListener('loadeddata', _ready);
    el.addEventListener('seeked', _ready);
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

function _place(sw, sh, c, tFile, raw) {
  // A gesture in progress holds its numbers rather than writing them: this is where they are
  // read back, so the picture follows the mouse without a store write per pixel. (V49) Not for the frame a PiP shows
  // (`raw`): the gesture moves the PiP, not what is inside it.
  const live = raw ? null : liveOf(c.id);
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
  // (phase V33.2) A clip that FOLLOWS its faces: where its window is at this second of its file (public/js/framing/path.js,
  // the render's own answer - lib/mv3b-render.js framedChain).
  if (isFramed(c.frame) && windowW(sw, sh, W / H) < 0.999 && Number.isFinite(tFile)) {
    const win = windowAt(c.frame, tFile, sw, sh, W / H);
    const conv = { tw: (H * (sw / sh)) / W, tx: 0.5, ty: 0.5 };
    const base = { dx: 0, dy: 0, dw: W, dh: H, cx: W / 2, cy: H / 2, angle: 0, conv };
    if (win.kind === 'whole') {
      // The whole frame by its width over a blurred copy of itself, covering ((х7) Б) - drawn as the render draws it.
      // (phase V33.8, (ф1)) A documentary's shows the middle `w` of the width (3:2 of a 16:9 film), the full height - the
      // render's crop by framing/path.js wholeW (lib/mv3b-render.js framedChain); 1 - the whole frame, as before.
      const s2 = Math.max(W / sw, H / sh);
      const bw = W / s2, bh = H / s2;
      const fw = sw * Math.max(0.05, Math.min(1, +win.w || 1));
      const fh = W * (sh / fw);
      return { ...base, sx: 0, sy: 0, sw, sh, parts: [
        { sx: (sw - bw) / 2, sy: (sh - bh) / 2, sw: bw, sh: bh, dx: 0, dy: 0, dw: W, dh: H, blur: Math.max(4, Math.round(W * 0.03)) },
        { sx: (sw - fw) / 2, sy: 0, sw: fw, sh, dx: 0, dy: (H - fh) / 2, dw: W, dh: fh },
      ] };
    }
    if (win.kind === 'bands') {
      const half = Math.round(H / 2);
      const bw = win.bw * sw, bh = win.bh * sh;
      const at = (x, y) => ({ sx: Math.max(0, Math.min(sw - bw, x * sw - bw / 2)), sy: Math.max(0, Math.min(sh - bh, y * sh - bh / 2)), sw: bw, sh: bh });
      return { ...base, sx: 0, sy: 0, sw, sh, parts: [
        { ...at(win.x1, win.y1), dx: 0, dy: 0, dw: W, dh: half },
        { ...at(win.x2, win.y2), dx: 0, dy: half, dw: W, dh: H - half },
      ] };
    }
    const fw = sh * (W / H);
    const sx = Math.max(0, Math.min(sw - fw, win.x * sw - fw / 2));
    // (phase V43) fragmentation's punch-in: the window scaled by z about its point (ax, ay) - framing/path.js zoomAt, the
    // render's exprZoom (lib/mv3b-render.js framedChain) - a smaller rectangle of the film drawn over the whole frame.
    const zm = zoomAt(c.frame, tFile);
    if (zm.z > 1.0005) {
      return { ...base, sx: sx + fw * zm.ax * (1 - 1 / zm.z), sy: sh * zm.ay * (1 - 1 / zm.z), sw: fw / zm.z, sh: sh / zm.z };
    }
    return { ...base, sx, sy: 0, sw: fw, sh };
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

// ── A main clip as a picture in the picture (phase V49, point 3) ─────────────
// The owner, 2026-10-25: "то что в превью уже порезалось я хочу зафиксировать это (например галочкой в инспекторе) и менять
// просто размер этого видео в превью чтобы по бокам появились размытые края". A clip of the MAIN lane with `pip` on is drawn as
// the picture the frame shows of it - a filled clip's frame (its crop with its Keep side, or its window following the faces,
// which keeps moving and punching in inside the PiP, (пр10)), a fitted clip's whole picture - in a box of that shape, by
// default where and as big as it already is (nothing jumps), else at `tx`/`ty` (its middle) and `tw` (its width) like an
// insert; turned by `angle`, its edges softened by `feather`, its corners rounded by `radius`, outlined by `outline` in
// `outlineColor` ((пр11)) - over the same clip blurred across the whole frame. lib/mv3b-render.js draws it by the same rule:
// the frame's picture -> the box -> corners, outline and soft edge -> the turn -> over the blurred copy.
const PIP_OUTLINE = '#ffffff';
const _pipNum = (v, lo, hi) => { const n = +v; return Number.isFinite(n) && n > 0 ? Math.max(lo, Math.min(hi, n)) : 0; };

// (phase V51, point 1) A CROPPED clip is a PiP of its piece: the box takes the piece's shape, its natural size is the piece
// fitted to the frame, and what is drawn into it is that rectangle of the file (`src`) - no Fit / Fill, no framing. A cropped
// clip off main's PiP (a lane above) is drawn by the same rule with no blur behind it (_show).
function _pipRect(sw, sh, c, tFile) {
  const live = liveOf(c.id);
  const k = live ? Object.assign({}, c, live) : c;
  const K = cropActive(k);
  const fill = !K && String(k.fit || 'fit') === 'fill';
  const pw = K ? K.w * sw : sw, ph = K ? K.h * sh : sh;
  const ar = fill ? W / H : pw / ph;
  // Its own size when nobody has sized it: the whole frame for a filled clip, the fitted picture for a fitted one.
  const nat = fill ? W : Math.min(W, H * ar);
  const placed = isPlaced(k);
  const dw = Math.max(2, placed ? +k.tw * W : nat), dh = dw / ar;
  const cx = (placed && k.tx != null ? +k.tx : 0.5) * W, cy = (placed && k.ty != null ? +k.ty : 0.5) * H;
  return {
    pip: true, placed: true, fill, dx: cx - dw / 2, dy: cy - dh / 2, dw, dh, cx, cy, angle: +k.angle || 0,
    // What a filled clip's frame shows - drawn into the box (parts of a framed clip, or one rectangle of the file).
    inner: fill ? _place(sw, sh, Object.assign({}, c, { tw: null, tx: null, ty: null, angle: null }), tFile, true) : null,
    crop: K, src: K ? { sx: K.x * sw, sy: K.y * sh, sw: pw, sh: ph } : null,
    feather: _pipNum(k.feather, 0, 0.45), radius: _pipNum(k.radius, 0, 0.5), outline: _pipNum(k.outline, 0, 0.05),
    outlineColor: /^#[0-9a-f]{6}$/i.test(String(k.outlineColor || '')) ? k.outlineColor : PIP_OUTLINE,
    conv: { tw: dw / W, tx: cx / W, ty: cy / H },
  };
}

// Its edges, kept between frames - they change only when its size or look does: the alpha of every pixel (the soft edge and
// the rounded corners, from the distance to the nearest edge - round at a corner) and the outline over it.
let _maskKey = '', _maskCv = null, _ringCv = null;
function _pipMasks(cw, ch, fr, rr, tpx, col) {
  const key = [cw, ch, fr, rr, tpx.toFixed(2), col].join('|');
  if (key === _maskKey) return { mask: _maskCv, ring: _ringCv };
  _maskKey = key;
  const S = Math.min(cw, ch), F = Math.max(1, fr * S), R = Math.min(0.5, rr) * S;
  const mk = () => { const cv = document.createElement('canvas'); cv.width = cw; cv.height = ch; return cv; };
  _maskCv = mk();
  _ringCv = tpx > 0 ? mk() : null;
  const m = _maskCv.getContext('2d').createImageData(cw, ch);
  const g = _ringCv ? _ringCv.getContext('2d').createImageData(cw, ch) : null;
  const cr = parseInt(col.slice(1, 3), 16), cg = parseInt(col.slice(3, 5), 16), cb = parseInt(col.slice(5, 7), 16);
  for (let y = 0; y < ch; y++) {
    const Y = y + 0.5;
    const dy = Math.max(0, R - Y, Y - (ch - R));
    for (let x = 0; x < cw; x++) {
      const X = x + 0.5;
      const dx = Math.max(0, R - X, X - (cw - R));
      const e = (dx > 0 && dy > 0) ? R - Math.hypot(dx, dy) : Math.min(X, cw - X, Y, ch - Y);
      const a = Math.max(0, Math.min(1, e / F));
      const i = (y * cw + x) * 4;
      m.data[i + 3] = Math.round(a * 255);
      if (g) {
        const on = Math.max(0, Math.min(1, tpx - e + 0.5));
        g.data[i] = cr; g.data[i + 1] = cg; g.data[i + 2] = cb; g.data[i + 3] = Math.round(a * on * 255);
      }
    }
  }
  _maskCv.getContext('2d').putImageData(m, 0, 0);
  if (g) _ringCv.getContext('2d').putImageData(g, 0, 0);
  return { mask: _maskCv, ring: _ringCv };
}

let _pipCv = null;
// `bg` - the blur behind it: a PiP of main has it, a cropped clip of a lane above has none ((пр42)).
function _drawPip(el, r, sw, sh, bg = true) {
  // Behind it the same clip, covering the frame and blurred - as framing's "whole" draws its background (the render's
  // boxblur at a quarter of the size, lib/mv3b-render.js).
  // Drawn a blur's width past the frame and cut at its edge: a canvas blur pulls the transparency outside in, and the edges
  // of the frame came out darker than the render's.
  // (phase V51, (пр41)) A cropped one's blur is of the whole frame, or of the piece (framing/crop.js BLUR_FROM_PIECE).
  if (bg) {
    const f = BLUR_FROM_PIECE && r.src ? r.src : { sx: 0, sy: 0, sw, sh };
    const s2 = Math.max(W / f.sw, H / f.sh);
    const bw = W / s2, bh = H / s2;
    const b = Math.max(4, Math.round(W * 0.03));
    _ctx.save();
    _ctx.beginPath();
    _ctx.rect(0, 0, W, H);
    _ctx.clip();
    _ctx.filter = `blur(${b}px)`;
    try { _ctx.drawImage(el, f.sx + (f.sw - bw) / 2, f.sy + (f.sh - bh) / 2, bw, bh, -2 * b, -2 * b, W + 4 * b, H + 4 * b); } catch (e) { /* not decoded yet */ }
    _ctx.restore();
  }
  // The box, in frame pixels - no bigger than a canvas should be (a PiP may be made larger than the film).
  const cw = Math.max(1, Math.min(2160, Math.round(r.dw))), ch = Math.max(1, Math.min(3840, Math.round(r.dh)));
  if (!_pipCv) _pipCv = document.createElement('canvas');
  if (_pipCv.width !== cw || _pipCv.height !== ch) { _pipCv.width = cw; _pipCv.height = ch; }
  const g = _pipCv.getContext('2d');
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = 'source-over';
  g.filter = 'none';
  g.clearRect(0, 0, cw, ch);
  try {
    if (r.fill && r.inner) {
      const k = cw / W;
      const ps = r.inner.parts || [{ sx: r.inner.sx, sy: r.inner.sy, sw: r.inner.sw, sh: r.inner.sh, dx: 0, dy: 0, dw: W, dh: H }];
      for (const p of ps) {
        g.filter = p.blur ? `blur(${Math.max(1, p.blur * k).toFixed(1)}px)` : 'none';
        g.drawImage(el, p.sx, p.sy, p.sw, p.sh, p.dx * k, p.dy * k, p.dw * k, p.dh * k);
      }
      g.filter = 'none';
    } else if (r.src) {
      g.drawImage(el, r.src.sx, r.src.sy, r.src.sw, r.src.sh, 0, 0, cw, ch);
    } else {
      g.drawImage(el, 0, 0, sw, sh, 0, 0, cw, ch);
    }
  } catch (e) { /* not decoded yet */ }
  // Corners, soft edge, outline: the outline's thickness is a share of the FRAME's width, in the box's pixels.
  const tpx = r.outline * W * (cw / r.dw);
  if (r.feather > 0.001 || r.radius > 0.001 || tpx > 0.05) {
    const { mask, ring } = _pipMasks(cw, ch, r.feather, r.radius, tpx, r.outlineColor);
    g.globalCompositeOperation = 'destination-in';
    g.drawImage(mask, 0, 0);
    g.globalCompositeOperation = 'source-over';
    if (ring) g.drawImage(ring, 0, 0);
  }
  _ctx.save();
  _ctx.translate(r.cx, r.cy);
  if (r.angle) _ctx.rotate(r.angle * Math.PI / 180);
  _ctx.drawImage(_pipCv, -r.dw / 2, -r.dh / 2, r.dw, r.dh);
  _ctx.restore();
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
  // (phase V33.2) A framed clip drawn in more than one piece: the whole frame over its blur, two bands.
  if (r.parts) {
    for (const p of r.parts) {
      if (p.blur) {
        _ctx.save();
        const f = _ctx.filter;
        _ctx.filter = (f && f !== 'none' ? f + ' ' : '') + `blur(${p.blur}px)`;
        try { _ctx.drawImage(el, p.sx, p.sy, p.sw, p.sh, p.dx, p.dy, p.dw, p.dh); } catch (e) {}
        _ctx.restore();
      } else {
        try { _ctx.drawImage(el, p.sx, p.sy, p.sw, p.sh, p.dx, p.dy, p.dw, p.dh); } catch (e) {}
      }
    }
    return;
  }
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
// (phase V33.2) The second of the FILE on the screen: the element's own time when it is playing a frame (what is drawn,
// not where the clock wants it), the clock's otherwise (a poster); a reversed clip's copy runs the file backwards.
function _fileTime(el, c) {
  const vid = !!(el && el.tagName === 'VIDEO');
  let t = vid && el.videoWidth ? (+el.currentTime || 0) : _srcTime(c, _at, vid ? el.duration : NaN);
  if (_rev(c)) {
    const src = (+c.srcDur > 0) ? +c.srcDur : (vid && isFinite(el.duration) ? el.duration : 0);
    if (src > 0) t = src - t;
  }
  return t;
}

function _show(el, sw, sh, c, gaps, main) {
  if (c.halfer) { _rects.set(c.id, _drawBand(el, sw, sh, c)); return; }
  const tFile = isFramed(c.frame) ? _fileTime(el, c) : NaN;
  // (phase V49, point 3) A main clip with PiP on: the picture the frame shows, in its own box.
  // (phase V51) What a crop gesture holds counts here too (crop-box.js puts it in place-b.js's live patches).
  const lv = liveOf(c.id);
  const lc = lv ? Object.assign({}, c, lv) : c;
  if (main && lc.pip) {
    const r = _pipRect(sw, sh, c, tFile);
    _rects.set(c.id, r);
    _drawPip(el, r, sw, sh);
    return;
  }
  // (phase V51, point 1, (пр42)) A CROPPED clip anywhere else: its piece in its box over the lanes under it - the PiP's own
  // rule (corners, outline, soft edge, the turn), with no blur behind it.
  if (cropActive(lc)) {
    const r = _pipRect(sw, sh, c, tFile);
    r.pip = false;
    _rects.set(c.id, r);
    _drawPip(el, r, sw, sh, false);
    return;
  }
  const r = _place(sw, sh, c, tFile);
  // (phase V49) A main clip is moved and sized only as a PiP (its switch in the inspector): picked, it has no grips.
  if (main && !isPlaced(c)) r.nogrip = true;
  _rects.set(c.id, r);
  _blit(el, r, c, gaps);
}

// ── What a clip shows of its file, for the crop (phase V51, point 1) ────────
// The crop's scissors (framing/crop.js placeFor) need to know which rectangle of the FILE a clip draws (`view`, shares of the
// file) into which box of the frame (`box`, frame pixels, turned by `angle`) - read off the very rectangle the preview draws
// by (_place, _pipRect). Most clips draw one; a framed clip's whole frame over its blur or two bands draw two.
function _mapsOf(r, sw, sh) {
  const box = (cx, cy, dw, dh, angle) => ({ cx, cy, dw, dh, angle: +angle || 0 });
  const viewOf = (p) => ({ x: p.sx / sw, y: p.sy / sh, w: p.sw / sw, h: p.sh / sh });
  if (r.crop) return [{ view: { x: r.crop.x, y: r.crop.y, w: r.crop.w, h: r.crop.h }, box: box(r.cx, r.cy, r.dw, r.dh, r.angle) }];
  if (r.pip && r.fill && r.inner) {
    // A filled PiP: its frame (W x H) drawn into the box - each part of it scaled and turned with the box.
    const k = r.dw / W, a = (+r.angle || 0) * Math.PI / 180;
    const ps = r.inner.parts || [{ sx: r.inner.sx, sy: r.inner.sy, sw: r.inner.sw, sh: r.inner.sh, dx: 0, dy: 0, dw: W, dh: H }];
    return ps.filter((p) => !p.blur).map((p) => {
      const lx = (p.dx + p.dw / 2 - W / 2) * k, ly = (p.dy + p.dh / 2 - H / 2) * k;
      return { view: viewOf(p), box: box(r.cx + lx * Math.cos(a) - ly * Math.sin(a), r.cy + lx * Math.sin(a) + ly * Math.cos(a), p.dw * k, p.dh * k, r.angle) };
    });
  }
  if (r.pip) return [{ view: { x: 0, y: 0, w: 1, h: 1 }, box: box(r.cx, r.cy, r.dw, r.dh, r.angle) }];
  if (r.parts) return r.parts.filter((p) => !p.blur).map((p) => ({ view: viewOf(p), box: box(p.dx + p.dw / 2, p.dy + p.dh / 2, p.dw, p.dh, 0) }));
  return [{ view: viewOf(r), box: box(r.cx, r.cy, r.dw, r.dh, r.angle) }];
}

/** The FILE's second a clip shows at the timeline's moment `t` (forwards, or backwards for a reversed clip). */
export function fileTimeAt(c, t) {
  const sp = +c.speed || 1;
  const into = Math.max(0, Math.min(+c.dur || 0, (+t) - (+c.start || 0))) * sp;
  return c.reversed && !isStill(c) ? (+c.trimIn || 0) + (+c.dur || 0) * sp - into : (+c.trimIn || 0) + into;
}

/**
 * (phase V51) What clip `c` shows of its file at the timeline's moment `t` and where, by the preview's own rules: { W, H, maps }
 * (framing/crop.js pickMap / placeFor). `main` - it is on main video (a PiP there). `sw`, `sh` - its file's size or shape.
 * Read with no gesture held (a live patch would be read into it).
 */
export function mapsOf(c, main, sw, sh, t) {
  const tFile = isFramed(c.frame) ? fileTimeAt(c, t) : NaN;
  let r;
  if ((main && c.pip) || cropActive(c)) r = _pipRect(sw, sh, c, tFile);
  else r = _place(sw, sh, c, tFile, true);
  return { W, H, maps: _mapsOf(r, sw, sh) };
}

/** (phase V51) The preview's own element for a clip on screen, decoded - what the crop's field shows while the playhead is on it. */
export function shownElement(c) {
  const el = c && c.src ? _media.get(_keyOf(c)) : null;
  if (!el) return null;
  return (el.tagName === 'VIDEO' ? (el.videoWidth && el.readyState >= 2 && !el.seeking) : el.naturalWidth) ? el : null;
}

/** (phase V51) The address a clip's picture is played from - its preview copy (forwards), or the picture itself. */
export const frameSrc = (c) => _srcFor(c.src, false);

// (phase V51) Told after each paint: the crop's field follows the frame under the playhead.
const _paintSubs = [];
export function onPaint(cb) { if (typeof cb === 'function') _paintSubs.push(cb); }

function _paint() {
  const n = _paintFrame();
  if (!_shooting && !_borrowed) for (const cb of _paintSubs) { try { cb(); } catch (e) { /* a listener's own trouble */ } }
  return n;
}

function _paintFrame() {
  if (!_ctx) return 0;
  // Lent to the workshop: the stage shows what the step is doing, and at this point in a
  // talking-head project the timeline is usually empty anyway - a black frame is the honest
  // picture of it (docs/local-app/PLAN.md, "Мастерская talking head").
  if (_borrowed) {
    // No clip is drawn, so none is under the pointer: the gesture layer (js/merge-v3/place-b.js)
    // must not find the timeline's last rectangles under a press on the stage's halves.
    _rects.clear();
    if (_hctx) { _hctx.setTransform(1, 0, 0, 1, 0, 0); _hctx.clearRect(0, 0, _hcv.width, _hcv.height); }
    _ctx.setTransform(1, 0, 0, 1, 0, 0);
    _ctx.fillStyle = '#000';
    _ctx.fillRect(0, 0, CW, CH);
    _ctx.save();
    _ctx.translate(_view.x, _view.y);
    _ctx.scale(_view.z, _view.z);
    _drawStill();
    _drawPair();
    _drawFilm();
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
  const alive = new Set();        // the elements kept (the rest are let go of)
  const shown = new Set();        // (phase V44) the elements on screen this frame
  const gaps = [];
  _liveVideo = [];
  // (phase V49) The bottom layer is main video - a clip of it may be a PiP (_show).
  const lanes = _layers(tl);
  const mainId = lanes.length ? lanes[0].id : null;
  for (const { c, main } of lanes.flatMap(track => _clipsAt(track, _at).map(c => ({ c, main: track.id === mainId })))) {
    if (!c.src) continue;
    const still = isStill({ src: c.src });
    alive.add(_keyOf(c));
    shown.add(_keyOf(c));
    // (phase V44) Its twins too, while the file is on screen: a piece longer than LOOK would otherwise let them go, and the
    // next piece would open the file again from nothing. (V49) As many as its clips use.
    for (let k = 0, n = _slotCount('video', c); k < n; k++) alive.add(_key(c.src, _rev(c)) + _slotKey(k));
    const el = _el(c.src, _rev(c), _slotOf(c));

    if (!still) {
      const want = _srcTime(c, _at, el.duration);

      // A SEEK IN FLIGHT IS NOT A DRIFT. While the element is still fetching or decoding its
      // time stands still, the drift test fails at once, and setting currentTime again
      // cancels the load and starts it over - every frame, so the clip never loads. The
      // first seek of a new element always lands; corrections wait until it is ready.
      if (el.__fresh === undefined) el.__fresh = true;
      const busy = !el.__fresh && (el.seeking || el.readyState < 2);
      _liveVideo.push(el);
      // (phase V33.4) Held at the start of playing: placed exactly and kept still, as when paused (play(), below).
      if (_playing && !_holding) {
        // LET IT PLAY. Setting currentTime every frame is scrubbing, not playing: the decoder
        // starts over on each seek and the picture crawls while the clock runs on - which is
        // exactly what a stuttering preview looks like. So the element runs on its own and is
        // only pulled back when it has genuinely drifted, which a seek every frame guarantees
        // it never gets the chance to do.
        el.playbackRate = Math.max(0.25, Math.min(4, +c.speed || 1));
        if (el.paused && !el.__playReq) el.__playReq = el.play().catch(() => {}).finally(() => { el.__playReq = null; });
        // (phase V44) A new piece for this element: put right at once (_jumpOf); after that, only a real drift.
        const jump = _jumpOf(el, c);
        if (!busy && isFinite(want) && (el.__fresh || Math.abs((el.currentTime || 0) - want) > (jump ? JUMP : 0.35))) {
          try { el.currentTime = Math.max(0, want); } catch (e) {}
          el.__fresh = false;
          el.__jump = false;
        } else if (!busy) el.__jump = false;
      } else {
        el.__live = c.id;
        if (!el.paused) el.pause();
        if (!busy && isFinite(want) && (el.__fresh || Math.abs((el.currentTime || 0) - want) > 0.08)) {
          try { el.currentTime = Math.max(0, want); } catch (e) {}
          el.__fresh = false;
        }
      }
      if (!el.videoWidth || el.seeking || el.readyState < 2) missing++;
      if (!el.videoWidth) {                       // nothing decoded yet: its poster, while it opens (V23)
        const pic = _shooting ? null : _posterOf(c);
        if (pic) _show(pic, pic.naturalWidth, pic.naturalHeight, c, gaps, main);
        continue;
      }
      _show(el, el.videoWidth, el.videoHeight, c, gaps, main);
    } else {
      if (!el.naturalWidth) { missing++; continue; }
      _show(el, el.naturalWidth, el.naturalHeight, c, gaps, main);
    }
  }
  // (phase V44) The next pieces of every lane made ready while this one plays - each one's element waits on its first
  // frame, the nearest piece first; an element on screen, or waiting for a nearer piece, is left alone.
  // (phase V49) From the moment Play is pressed, held or not: a piece starting within SOON of the playhead is waited for
  // by the hold like the clips under it (_soonVideo) - pressed 0.16 s before a run of short pieces, their elements began
  // to seek only once the clock ran, and a cold file's seek (0.5-1 s, measured: 0.95 s for the Kids fragment's 68 MB film)
  // left them silent and sought again.
  _soonVideo = [];
  if (_playing && !_shooting) {
    const claimed = new Set(shown);
    for (const track of _layers(tl)) {
      for (const nx of _nextOn(track, _at)) {
        if (isStill({ src: nx.src })) continue;
        const key = _keyOf(nx);
        if (claimed.has(key)) continue;
        claimed.add(key);
        alive.add(key);
        const el = _el(nx.src, _rev(nx), _slotOf(nx));
        _cue(el, nx);
        if (_holding && +nx.start - _at <= SOON) _soonVideo.push(el);
      }
    }
  }
  // OVER EVERY LAYER, like the render burns them. Drawn by libass on its own canvas over the frame
  // (captions/layer.js, K4); the painter is the stand-in while that is not up. A screenshot is saved
  // without them and the server burns them in with the render's own libass (lib/caption-shot.js).
  // A caption being moved is drawn where the pointer has it (cap-place.js) - the layer is handed it there.
  if (_shooting) { /* burnt in by the server */ }
  else if (CapLayer.ready()) CapLayer.render(_at);
  else { try { paintCaptions(_ctx, CapPlace.liveTimeline() || tl, _at, W, H, (tl && tl.format) || '9:16'); } catch (e) {} }

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
  if (_hctx) {
    _hctx.setTransform(1, 0, 0, 1, 0, 0);
    _hctx.clearRect(0, 0, CW, CH);
    _hctx.setTransform(1, 0, 0, 1, PAD, PAD);
    try { paintHandles(_hctx); } catch (e) {}
    try { CapPlace.paint(_hctx); } catch (e) {}
  } else {
    try { paintHandles(_ctx); } catch (e) {}
    try { CapPlace.paint(_ctx); } catch (e) {}
  }

  _note(gapNote(gaps));
  // Off screen means off. A video left running behind the playhead keeps decoding for nothing
  // and is somewhere else entirely by the time it is needed again.
  for (const [key, el] of _media) {
    if (el.pause && !el.paused && !shown.has(key)) { try { el.pause(); } catch (e) {} }
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
    // Edits made while the frame was being taken did not reach the captions' layer (the store's
    // listener stands down during a shot).
    CapLayer.setTimeline(Store.timeline());
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

/**
 * Put the preview at `t`. `opts.exact` (K10b, a word picked in the caption's words): the sound and the
 * picture land exactly there - the ordinary tolerance (a quarter second for the sound) is wider than a word,
 * so a word picked after its neighbour played from the neighbour. Every element seeks once, as a new one does.
 */
export function seek(t, opts) {
  _at = Math.max(0, Math.round((+t || 0) * 100) / 100);
  _at0 = _at; _t0 = performance.now();
  if (opts && opts.exact) {
    for (const el of _audio.values()) el.__fresh = true;
    for (const el of _media.values()) if (el && el.tagName === 'VIDEO') el.__fresh = true;
  }
  _repaint();
  _clock();
  setPlayhead(_at);
  _syncAudio();
}

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
// THE CLOCK WAITS FOR THE SOUND AT THE START (phase V33.4, the owner 2026-10-21: "первые секунд пять идут без звука, но
// картинка есть"). Pressed Play, the films and sounds under the playhead are first put in place and HELD still; the clock
// starts when every one of them can play from there (or after HOLD_MS, whatever is ready). Starting at once left a big file
// (a 4K piece) behind the clock by the time it could play; each correction landed behind again and the sound stayed silent.
let _holding = false;
let _holdT = 0;
const HOLD_MS = 3000;
let _liveVideo = [];         // the films the last paint put under the playhead
let _liveAudio = [];         // the sounds the last sync put under it
let _soonVideo = [];         // (V49) held at Play: the films of pieces starting within SOON, being put in place
let _soonAudio = [];         // ...and the sounds

// Every audible sound at this moment. A clip at volume 0 is SKIPPED - that is what a muted
// birol is, and what the subtitle pass will read to decide what to transcribe. Track volume
// multiplies, so a lane can be quietened without touching the clips on it.
function _sounds(tl, t) {
  const out = [];
  if (!tl || !Array.isArray(tl.tracks)) return out;
  // The render's rule (js/sound/fades.js): own fades, and two tracks of music crossing where they overlap.
  const fades = fadesOf(tl);
  for (const tr of tl.tracks) {
    if (tr.kind !== 'audio') continue;
    const master = (tr.volume == null) ? 1 : +tr.volume;
    if (!(master > 0)) continue;
    for (const c of (tr.clips || [])) {
      const v = ((c.volume == null) ? 1 : +c.volume) * master;
      if (!(v > 0)) continue;
      const s = +c.start, e = s + (+c.dur);
      if (t < s - 0.0001 || t >= e) continue;
      // Its fades, as the render's afade draws them.
      const fd = fades.get(String(c.id)) || { in: 0, out: 0 };
      const fi = fd.in, fo = fd.out;
      let f = 1;
      if (fi > 0) f = Math.min(f, Math.max(0, (t - s) / fi));
      if (fo > 0) f = Math.min(f, Math.max(0, (e - t) / fo));
      out.push({ c, gain: Math.min(1, v * f) });
    }
  }
  return out;
}

// ── A SOUND THAT DOES NOT SEEK EXACTLY IS PLAYED FROM ITS DECODED SAMPLES (phase V49) ──────────
// Measured in the Electron window (V49 block 0): an mp3 of variable bitrate - every Suno track - lands after a seek up to 0.9 s
// away from where the element's currentTime says it is (seeks to 6 / 30 / 70 / 120 s of the two variants of one generation:
// +0.39 +0.89 -0.07 +0.42 and +0.53 +0.51 -0.83 -0.32 s; Chromium seeks it by the file's rough table of contents and does not
// know it missed). The render's ffmpeg lands exactly (0.000 s at the same moments). So a track started anywhere but its own
// start played somewhere else than the film will, two tracks laid in step sounded apart by up to 0.76 s - "помехи" over an
// overlap - and a track cut into pieces jumped at every seam. Such a file is decoded once here into a WAV in memory (sample
// for sample the file, at 48 kHz) and the element plays that; a WAV seeks to the sample. Until it is ready the element plays
// the file itself; it changes over the next time it is still (paused, waiting for its piece, held at Play - the hold waits
// for it, _pcmWaits). A file longer than PCM_MAX_S, or one that cannot be decoded, stays as it is.
const PCM_RE = /\.(mp3|aac)(\?|#|$)/i;
const PCM_MAX_S = 20 * 60;          // ~11.5 MB of memory a minute
const PCM_KEEP = 8;                 // decoded files kept; the oldest not playing goes first
const _pcm = new Map();             // src -> { url, done, failed }
let _pcmCtx = null;

function _wavOf(buf) {
  const ch = Math.min(2, buf.numberOfChannels), n = buf.length, rate = buf.sampleRate;
  const ab = new ArrayBuffer(44 + n * ch * 2);
  const dv = new DataView(ab);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); dv.setUint32(4, 36 + n * ch * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, ch, true); dv.setUint32(24, rate, true);
  dv.setUint32(28, rate * ch * 2, true); dv.setUint16(32, ch * 2, true); dv.setUint16(34, 16, true);
  str(36, 'data'); dv.setUint32(40, n * ch * 2, true);
  const pcm = new Int16Array(ab, 44, n * ch);
  for (let c = 0; c < ch; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0, o = c; i < n; i++, o += ch) { const v = d[i]; pcm[o] = v >= 1 ? 32767 : v <= -1 ? -32768 : (v * 32767) | 0; }
  }
  return new Blob([ab], { type: 'audio/wav' });
}

function _pcmOf(src) {
  if (!PCM_RE.test(String(src || ''))) return null;
  let p = _pcm.get(src);
  if (p) { _pcm.delete(src); _pcm.set(src, p); return p; }      // the most recently wanted last
  p = { url: null, done: false, failed: false };
  _pcm.set(src, p);
  (async () => {
    try {
      const r = await fetch(src);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const data = await r.arrayBuffer();
      if (!_pcmCtx) _pcmCtx = new OfflineAudioContext(2, 1, 48000);
      const buf = await _pcmCtx.decodeAudioData(data);
      if (!(buf.duration > 0) || buf.duration > PCM_MAX_S) throw new Error('not kept');
      p.url = URL.createObjectURL(_wavOf(buf));
    } catch { p.failed = true; }
    p.done = true;
    _pcmTrim();
    // Held at Play, the clock is waiting for it; still, it changes over at the next sync.
    if (_on && !_playing) _syncAudio();
  })();
  return p;
}

// Not more than PCM_KEEP decoded files: the oldest one no element is playing from is let go of.
function _pcmTrim() {
  if (_pcm.size <= PCM_KEEP) return;
  const used = new Set([..._audio.values()].map(el => el.src));
  for (const [src, p] of _pcm) {
    if (_pcm.size <= PCM_KEEP) break;
    if (!p.done || (p.url && used.has(p.url))) continue;
    if (p.url) URL.revokeObjectURL(p.url);
    _pcm.delete(src);
  }
}

// The element plays the decoded copy once there is one and it is still - never under a sound that is playing.
function _pcmSwap(el) {
  const p = el.__orig ? _pcm.get(el.__orig) : null;
  if (!p || !p.url || el.src === p.url || !el.paused) return;
  el.src = p.url;
  el.__fresh = true;              // put in place again, exactly, as a new element is
  el.__seekAt = 0;
  el.__cost = 0;
}
// Held at Play, the clock waits for a sound whose decoded copy is still being made (at most HOLD_MS, as for the rest; a
// Suno track of two and a half minutes takes ~0.3 s). Playing on, a track is decoded when its clip is LOOK away.
const _pcmWaits = (el) => { const p = el.__orig ? _pcm.get(el.__orig) : null; return !!(p && !p.done); };

// Sound is taken from the same place the picture is. For a reversed clip that means the
// reversed proxy, whose audio ffmpeg has already run through `areverse` - which is the only
// way to hear one, since no element plays a file backwards.
function _aud(c) {
  const rev = _rev(c);
  const key = _keyOf(c);
  if (_audio.has(key)) { const was = _audio.get(key); _pcmSwap(was); return was; }
  const el = new Audio();
  el.preload = 'auto';
  // (V49) The decoded copy when the file does not seek exactly (above), once it is made.
  const pc = rev ? null : _pcmOf(c.src);
  el.__orig = rev ? '' : c.src;
  el.src = rev ? _srcFor(c.src, true) : (pc && pc.url ? pc.url : c.src);
  // HOW LONG THIS FILE TAKES TO PLAY AGAIN after a seek made while playing (phase V33.4, the owner 2026-10-21: "первые
  // секунд пять идут без звука, но картинка есть"): from the seek to sound, a half-and-half running average. A big file
  // read cold (a 4K piece of a highlights fragment, 17 Mbit/s) took 0.4-0.6 s a seek - more than the drift allowed - so the
  // sound landed behind the clock, sought again, and again, and stayed silent for seconds. _syncAudio aims that far ahead.
  const landed = () => {
    if (!el.__seekAt || el.paused) return;
    const took = (performance.now() - el.__seekAt) / 1000;
    el.__seekAt = 0;
    if (took > 0 && took < 5) el.__cost = el.__cost ? el.__cost * 0.5 + took * 0.5 : took;
  };
  el.addEventListener('playing', landed);
  el.addEventListener('seeked', () => { if (el.readyState >= 3) landed(); });
  _audio.set(key, el);
  return el;
}

function _syncAudio() {
  const tl = Store.timeline();
  const live = _sounds(tl, _at);
  const alive = new Set(live.map(x => _keyOf(x.c)));
  for (const [key, el] of _audio) {
    if (alive.has(key)) continue;
    try { el.pause(); } catch (e) {}
  }
  // Sounding: playing and not held at the start (phase V33.4). Held, a sound is put in place exactly and kept still.
  const run = _playing && !_holding;
  _liveAudio = [];
  for (const { c, gain } of live) {
    // A reversed clip whose source is not a film - a bare mp3 on an audio lane - has nothing
    // to play: the proxy cannot reverse what it cannot transcode. Silent rather than
    // forwards, because forwards would be the wrong words in the right place.
    if (c.reversed && !_rev(c)) continue;
    const el = _aud(c);
    _liveAudio.push(el);
    el.volume = gain;
    el.playbackRate = Math.max(0.25, Math.min(4, +c.speed || 1));
    const want = _srcTime(c, _at, el.duration);
    // The same busy rule as the picture: no correction while a load is in progress.
    if (el.__fresh === undefined) el.__fresh = true;
    const busy = !el.__fresh && (el.seeking || el.readyState < 2);
    // (phase V44) A new piece for this element is put right at once, as the picture's is (_jumpOf).
    const jump = run && _jumpOf(el, c);
    if (!run) el.__live = c.id;
    if (!busy && isFinite(want) && (el.__fresh || Math.abs((el.currentTime || 0) - want) > (_holding ? 0.08 : jump ? JUMP : 0.25))) {
      // While sounding, a correction is aimed where the clock will be when the file plays again - its own measured seek
      // time (above), at most 2 s - not where the clock is now, or a slow file lands behind every time (phase V33.4).
      const lead = (run && !el.__fresh) ? Math.min(2, el.__cost || 0) * el.playbackRate : 0;
      try { el.currentTime = Math.max(0, want + lead); } catch (e) {}
      if (run) el.__seekAt = performance.now();
      el.__fresh = false;
      el.__jump = false;
    } else if (!busy) el.__jump = false;
    if (run && el.paused && !el.__playReq) el.__playReq = el.play().catch(() => {}).finally(() => { el.__playReq = null; });
    if (!run && !el.paused) el.pause();
  }
  // (phase V44) The next pieces of every lane made ready while this one sounds: each one's element waits paused on its
  // first moment, the nearest first; one sounding, or waiting for a nearer piece, is left alone. (V49) Held at Play too,
  // and a piece starting within SOON is waited for (_soonAudio, as the picture's).
  _soonAudio = [];
  if (_playing) {
    const claimed = new Set(alive);
    for (const tr of ((tl && tl.tracks) || [])) {
      if (!tr || tr.kind !== 'audio' || (tr.volume != null && !(+tr.volume > 0))) continue;
      for (const nx of _nextOn(tr, _at)) {
        if ((nx.volume != null && !(+nx.volume > 0)) || (nx.reversed && !_rev(nx))) continue;
        const key = _keyOf(nx);
        if (claimed.has(key)) continue;
        claimed.add(key);
        const el = _aud(nx);
        _cue(el, nx);
        if (_holding && +nx.start - _at <= SOON) _soonAudio.push(el);
      }
    }
  }
}

// Every film and sound under the playhead can play from where it stands: the clock may start (play(), _tick).
// One that cannot load at all (its file gone - red on the timeline) is not waited for.
const _canRun = (el, rs) => !!el.error || el.networkState === 3 || (!el.seeking && el.readyState >= rs);
// (V49) A piece about to start is ready once it waits on its first moment: sought there and not seeking. A sound whose
// decoded copy is being made is waited for too (_pcmWaits).
const _readyToRun = () => _liveAudio.every((el) => _canRun(el, 3) && !_pcmWaits(el)) && _liveVideo.every((el) => _canRun(el, 2))
  && _soonAudio.every((el) => _canRun(el, 2) && !_pcmWaits(el)) && _soonVideo.every((el) => _canRun(el, 2));

function _tick() {
  if (!_playing) return;
  const now = performance.now();
  // (phase V33.4) Held at the start: the clock stands where Play was pressed while the films and sounds are put in place;
  // it starts the moment they can all play - or after HOLD_MS with what is ready.
  if (_holding) {
    _t0 = now; _at0 = _at;
    _paint();
    _syncAudio();
    if (_readyToRun() || now - _holdT >= HOLD_MS) {
      _holding = false;
      _t0 = performance.now(); _at0 = _at;
      _paint();
      _syncAudio();
    }
    _raf = requestAnimationFrame(_tick);
    return;
  }
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
  if (!_borrowed) {
    _still = null; _pair = null; _crop = null; _filmStop(); _firstStep(false);
    // The buttons the borrower laid over the stage go with the loan (phase V24: a talking head's
    // crosses stayed over the next project's empty preview).
    const stage = document.getElementById(STAGE);
    if (stage) stage.querySelectorAll('.mv3-stage-ctl').forEach(x => x.remove());
  }
  if (_borrowed) pause();
  // The stage lent to the workshop shows no captions (the painter drew none there either), nor a platform's screen.
  CapLayer.show(!_borrowed);
  Platforms.show(!_borrowed);
  document.body.classList.toggle('mv3-workshop', _borrowed);
  _view = { z: 1, x: 0, y: 0 };
  if (_still) _still.box = null;
  if (_pair) _pair.boxes = null;
  if (_film) _film.box = null;
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
    // A film on the stage is played and paused by pressing it (X4).
    if (_borrowed && _film && e.type === 'click') { filmPlay(); return; }
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
  // A PICTURE keeps where it was pushed: the view moves with half the change, so what was in
  // the middle stays in the middle. THE PAIR does not - its two halves are measured against the
  // surface, while the dashed frames and the words are drawn from the surface as it is NOW, so a
  // view left over from the old size slid them off the stage as the sash moved (the owner,
  // 2026-09-22). It re-centres instead: nothing about a pair is worth keeping across a resize.
  if (CW && CH && _pair) { _view = { z: 1, x: 0, y: 0 }; _pair.boxes = null; }
  else if (CW && CH && _still) {
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
  if (_film) _film.box = null;
  if (_on) _paint();
}

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
  if (src && _still && _still.src === src && _still.img && !_film) {
    _still.caption = String(caption || '');
    if (_on) _paint();
    return;
  }
  // A NEW picture arrives fitted and in the middle. The view is how the last one was being
  // looked at - after a sash drag it holds the shift that kept THAT one centred - and applied
  // to this one it would only push it off to the side.
  _view = { z: 1, x: 0, y: 0 };
  _pair = null;
  _crop = null;                             // another picture is not the one being cropped (V9)
  _filmStop();                              // ...and a picture is not a film (X4)
  _firstStep(false);                        // ...nor the step that comes before both (P2)
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

// ── A CLIP PLAYING ON THE STAGE (phase X4) ──────────────────────────────────
// The third thing the borrowed stage can show, beside one picture and a pair of them: a film, with
// its own sound. The fragment's clip used to open in a window over everything (the owner,
// 2026-09-22: "clicking the clip should play it in the preview"), which meant leaving the panel to
// watch four seconds of video.
//
// It is NOT the timeline's transport - that belongs to the film being cut, and it stays down while
// the workshop holds the stage. This is one video element, drawn on the canvas frame by frame,
// which a click starts and stops. Sound is on: a talking head with the sound off is half of it.
let _film = null;                           // { src, el, caption, playing }
let _filmRaf = 0;

function _filmStop() {
  if (!_film) return;
  try { _film.el.pause(); _film.el.src = ''; _film.el.remove(); } catch (e) { /* it is going anyway */ }
  if (_filmRaf) { cancelAnimationFrame(_filmRaf); _filmRaf = 0; }
  _film = null;
}

// While it plays, the canvas is redrawn every frame; while it is paused, the last frame stands.
function _filmTick() {
  _filmRaf = 0;
  if (!_film || !_film.playing || !_borrowed) return;
  _paint();
  _filmRaf = requestAnimationFrame(_filmTick);
}

/**
 * Put a film on the borrowed stage. It does NOT start (phase Y2, the owner 2026-09-22): opening a
 * fragment should show its clip, not play it at you. The first frame stands with a triangle on it,
 * and `filmPlay` - a press on the thumbnail, or on the stage itself - is what starts it.
 *
 * A PICTURE STANDS IN UNTIL THE VIDEO OPENS (Z5, the owner 2026-09-22): a video element has
 * nothing to draw until it has decoded a frame, and on a real clip that is long enough for the
 * stage to look empty - which is exactly what "the preview does not show the clip" was. The
 * poster, or the frame the fragment opens on, is drawn in its place and goes the moment the film
 * itself has something.
 *
 * @param src      the clip, or '' to take it off
 * @param caption  a line under it, as a still has
 * @param poster   a picture to stand in while it opens
 */
export function showFilm(src, caption, poster) {
  if (!src) return _filmStop();
  if (_film && _film.src === src) {
    _film.caption = String(caption || '');
    _filmPoster(poster);
    if (_on) _paint();
    return;
  }
  _filmStop();
  _firstStep(false);
  _still = null;
  _pair = null;
  _crop = null;
  _view = { z: 1, x: 0, y: 0 };
  const el = document.createElement('video');
  el.playsInline = true;
  el.preload = 'auto';
  el.crossOrigin = 'anonymous';
  // IN the page, though nothing sees it: what is on screen is the canvas this is drawn onto. A
  // media element left detached is decoded at the browser's discretion, and a picture that stops
  // advancing when the window is busy is not a preview.
  el.style.cssText = 'position:absolute;width:1px;height:1px;left:0;bottom:0;opacity:0;pointer-events:none';
  const stage = document.getElementById(STAGE);
  if (stage) stage.appendChild(el);
  el.src = src;
  _film = { src, el, caption: String(caption || ''), playing: false, box: null, pic: null, picSrc: '' };
  _filmPoster(poster);
  // It starts by itself: pressing the clip IS the ask to see it. A browser that refuses to play
  // with sound before it has been clicked leaves the first frame up, and the next click plays it.
  el.addEventListener('loadeddata', () => {
    if (!_film || _film.el !== el) return;
    _film.box = null;                       // the film may not be the poster's shape
    if (_on) _paint();
  });
  el.addEventListener('ended', () => { if (_film && _film.el === el) { _film.playing = false; _paint(); } });
  el.addEventListener('error', () => { if (_film && _film.el === el) { _film.playing = false; _paint(); } });
  if (_on) _paint();
}

// The stand-in picture, loaded once per film. It is dropped as soon as the video can be drawn,
// so a clip never shows its poster over itself.
function _filmPoster(src) {
  const want = String(src || '');
  if (!_film || _film.picSrc === want) return;
  _film.picSrc = want;
  _film.pic = null;
  if (!want) return;
  const img = new Image();
  img.onload = () => { if (_film && _film.picSrc === want) { _film.pic = img; _film.box = null; if (_on) _paint(); } };
  img.onerror = () => { if (_film && _film.picSrc === want) _film.pic = null; };
  img.src = want;
}

/** Play or pause the film on the stage. Without an argument, the other one. */
export function filmPlay(want) {
  if (!_film) return;
  const play = want === undefined ? !_film.playing : !!want;
  if (play) {
    const p = _film.el.play();
    if (p && p.catch) p.catch(() => { if (_film) { _film.playing = false; _paint(); } });
    _film.playing = true;
    if (!_filmRaf) _filmRaf = requestAnimationFrame(_filmTick);
  } else {
    try { _film.el.pause(); } catch (e) { /* nothing to pause */ }
    _film.playing = false;
  }
  if (_on) _paint();
}

// Letterboxed like a still, measured once, with the one control it has drawn on it: a triangle
// while it is stopped, nothing while it plays.
function _drawFilm() {
  if (!_film) return;
  // The film when it has a frame to give; the stand-in picture until then (Z5).
  const v = _film.el;
  const from = v.videoWidth ? v : (_film.pic && _film.pic.naturalWidth ? _film.pic : null);
  if (from) {
    const fw = from.videoWidth || from.naturalWidth;
    const fh = from.videoHeight || from.naturalHeight;
    if (!_film.box || _film.box.of !== (from === v ? 'film' : 'pic')) {
      const s = Math.min(CW / fw, CH / fh);
      const w = Math.round(fw * s), h = Math.round(fh * s);
      _film.box = { w, h, x: Math.round((CW - w) / 2), y: Math.round((CH - h) / 2), of: from === v ? 'film' : 'pic' };
    }
    const b = _film.box;
    try { _ctx.drawImage(from, b.x, b.y, b.w, b.h); } catch (e) { /* a frame not decoded yet */ }
    if (!_film.playing) {
      const r = Math.round(Math.min(b.w, b.h) * 0.11);
      _ctx.save();
      _ctx.globalAlpha = 0.82;
      _ctx.fillStyle = 'rgba(0,0,0,.45)';
      _ctx.beginPath();
      _ctx.arc(b.x + b.w / 2, b.y + b.h / 2, r, 0, Math.PI * 2);
      _ctx.fill();
      _ctx.fillStyle = '#fff';
      _ctx.beginPath();
      _ctx.moveTo(b.x + b.w / 2 - r * 0.3, b.y + b.h / 2 - r * 0.45);
      _ctx.lineTo(b.x + b.w / 2 + r * 0.5, b.y + b.h / 2);
      _ctx.lineTo(b.x + b.w / 2 - r * 0.3, b.y + b.h / 2 + r * 0.45);
      _ctx.closePath();
      _ctx.fill();
      _ctx.restore();
    }
  }
  if (_film.caption) _caption(_film.caption, PAD + H, H);
}

// ── Cropping the picture on the stage (phase V9) ────────────────────────────
// A first frame is what a clip is MADE of, so reframing it - closer in, off to one side - is a
// thing that belongs on the stage where the frame is being looked at (the owner, 2026-09-22). The
// selection is kept in FRACTIONS of the picture, never in pixels of the canvas: the stage is
// zoomed and pushed about, and a rectangle in screen numbers would slide off the thing it is about.
// It is also locked to one ASPECT - the project's format - because a frame of another shape reaches
// the renderer with bars down its sides.
//
// The panel owns the buttons (js/merge-v3/wk-fragments.js); this file owns the rectangle, the
// gestures and the drawing, and hands the rectangle over when asked.
let _crop = null;                           // { aspect, rect: {x,y,w,h} } - fractions of the picture
const CROP_MIN = 1 / 3;                     // the server's own floor, so the hand cannot ask for less
const HANDLE = 9;                           // the corner grips, in screen pixels

// THE SHAPE, IN FRACTIONS. A locked aspect is about PIXELS, and the rectangle is kept as fractions
// of the picture, so the two are tied by one number: with the picture iw x ih and the wanted shape
// A = width/height, a selection of fraction width w has fraction height w * k, where k = iw/(A*ih).
// For a 9:16 picture cropped to 9:16 that k is 1 and the selection is square in fraction space -
// which is exactly right, and the reason the number is written down rather than guessed at.
function _cropK(aspect) {
  const img = (_still && _still.img) || {};
  const iw = img.naturalWidth || 0, ih = img.naturalHeight || 0;
  if (!aspect || !iw || !ih) return 0;
  return iw / (aspect * ih);
}

// The largest rectangle of that shape the picture holds, centred - what a crop opens on. The whole
// picture, when the shapes agree.
function _cropFull(aspect) {
  const k = _cropK(aspect);
  if (!k) return { x: 0, y: 0, w: 1, h: 1 };
  const w = Math.min(1, 1 / k), h = w * k;
  return { x: (1 - w) / 2, y: (1 - h) / 2, w, h };
}

// A size the hand asked for, made legal: of the locked shape, inside the picture, and at least a
// third of each side - the server's own floor, below which there are no pixels left to animate.
function _cropSize(wWant, hWant, aspect) {
  const k = _cropK(aspect);
  if (!k) {
    return { w: Math.max(CROP_MIN, Math.min(1, wWant)), h: Math.max(CROP_MIN, Math.min(1, hWant)) };
  }
  const wMax = Math.min(1, 1 / k);
  const wMin = Math.min(wMax, Math.max(CROP_MIN, CROP_MIN / k));
  const w = Math.max(wMin, Math.min(wMax, wWant));
  return { w, h: w * k };
}

// A rectangle grown from a corner that must not move: the one opposite the grip being dragged, or
// the point a new selection was started at.
function _cropFrom(fixX, fixY, east, south, wWant, hWant, aspect) {
  const { w, h } = _cropSize(wWant, hWant, aspect);
  const x = east ? fixX : fixX - w;
  const y = south ? fixY : fixY - h;
  return {
    w, h,
    x: Math.max(0, Math.min(x, 1 - w)),
    y: Math.max(0, Math.min(y, 1 - h)),
  };
}

/** Begin - or keep - a selection over the still on the stage. `aspect` is width/height, 0 for free. */
export function cropOn(aspect) {
  const a = Number(aspect) || 0;
  if (_crop && _crop.aspect === a) return;
  _crop = { aspect: a, rect: _cropFull(a) };
  if (_on) _paint();
}

/** Put the selection away. */
export function cropOff() {
  if (!_crop) return;
  _crop = null;
  if (_on) _paint();
}

/** The selection as fractions of the picture, for the server to cut by, or null. */
export const cropRect = () => (_crop ? { ...(_crop.rect) } : null);

// A press, a drag and a release on the stage while a selection is up. A corner grip resizes from
// the opposite corner; inside moves the whole rectangle; anywhere else starts a new one from that
// point. The aspect holds through all three.
let _cropDrag = null;

const _clamp01 = (v) => Math.max(0, Math.min(1, v));

// Canvas point -> the surface the picture lies on, back through the shift and the zoom.
function _cropSurface(cv, e) {
  const r = cv.getBoundingClientRect();
  return {
    x: ((e.clientX - r.left) / r.width * CW - _view.x) / _view.z,
    y: ((e.clientY - r.top) / r.height * CH - _view.y) / _view.z,
  };
}

// ...and on to a fraction of the picture. The picture's box on the surface is what showStill
// measured; with no box there is nothing to crop.
function _cropFrac(cv, e) {
  const box = _still && _still.box;
  if (!box || !box.w || !box.h) return null;
  const s = _cropSurface(cv, e);
  return { x: (s.x - box.x) / box.w, y: (s.y - box.y) / box.h };
}

function _cropGrip(rect, f, tol) {
  const corners = [['nw', rect.x, rect.y], ['ne', rect.x + rect.w, rect.y],
    ['sw', rect.x, rect.y + rect.h], ['se', rect.x + rect.w, rect.y + rect.h]];
  for (const [id, cx, cy] of corners) {
    if (Math.abs(f.x - cx) <= tol.x && Math.abs(f.y - cy) <= tol.y) return id;
  }
  return '';
}

function _wireCrop(cv) {
  cv.addEventListener('pointerdown', (e) => {
    if (!_borrowed || !_crop || e.button !== 0) return;
    const f = _cropFrac(cv, e);
    if (!f) return;
    e.preventDefault();
    e.stopPropagation();
    const box = _still.box;
    const tol = { x: (HANDLE * 1.6) / (box.w * _view.z), y: (HANDLE * 1.6) / (box.h * _view.z) };
    const r = _crop.rect;
    const grip = _cropGrip(r, f, tol);
    // A selection that fills the picture has nowhere to move to, and it is what a crop opens on -
    // so a drag inside THAT one draws a new selection instead of shoving at a wall.
    const canMove = r.w < 0.999 || r.h < 0.999;
    const inside = f.x > r.x && f.x < r.x + r.w && f.y > r.y && f.y < r.y + r.h;
    if (grip) _cropDrag = { how: 'grip', grip, from: f, rect: { ...r } };
    else if (inside && canMove) _cropDrag = { how: 'move', from: f, rect: { ...r } };
    else _cropDrag = { how: 'new', from: f, rect: { ...r } };
    try { cv.setPointerCapture(e.pointerId); } catch (err) { /* older engines */ }
  });
  cv.addEventListener('pointermove', (e) => {
    if (!_cropDrag || !_crop) return;
    const f = _cropFrac(cv, e);
    if (!f) return;
    e.preventDefault();
    const a = _crop.aspect;
    const d = _cropDrag;
    if (d.how === 'move') {
      const w = d.rect.w, h = d.rect.h;
      _crop.rect = {
        x: Math.max(0, Math.min(d.rect.x + (f.x - d.from.x), 1 - w)),
        y: Math.max(0, Math.min(d.rect.y + (f.y - d.from.y), 1 - h)), w, h,
      };
    } else if (d.how === 'grip') {
      // The corner OPPOSITE the grip is the one that stays.
      const east = d.grip === 'ne' || d.grip === 'se';
      const south = d.grip === 'se' || d.grip === 'sw';
      const fixX = east ? d.rect.x : d.rect.x + d.rect.w;
      const fixY = south ? d.rect.y : d.rect.y + d.rect.h;
      _crop.rect = _cropFrom(fixX, fixY, east, south,
        Math.abs(_clamp01(f.x) - fixX), Math.abs(_clamp01(f.y) - fixY), a);
    } else {
      // A new selection grows from where the press landed.
      _crop.rect = _cropFrom(d.from.x, d.from.y, _clamp01(f.x) >= d.from.x, _clamp01(f.y) >= d.from.y,
        Math.abs(_clamp01(f.x) - d.from.x), Math.abs(_clamp01(f.y) - d.from.y), a);
    }
    _paint();
  });
  const done = (e) => {
    if (!_cropDrag) return;
    _cropDrag = null;
    try { cv.releasePointerCapture(e.pointerId); } catch (err) { /* older engines */ }
  };
  cv.addEventListener('pointerup', done);
  cv.addEventListener('pointercancel', done);
}

// The selection over the picture: everything outside it dimmed, a white frame, four corner grips,
// and the size it will come out at. Drawn in SURFACE numbers, inside the same transform the
// picture is drawn in, so it stays glued to the picture through any zoom; the frame and the grips
// are divided by the zoom, so they are the same thickness on screen at any magnification.
function _drawCrop() {
  if (!_crop || !_still || !_still.box) return;
  const b = _still.box, r = _crop.rect;
  const x = b.x + r.x * b.w, y = b.y + r.y * b.h, w = r.w * b.w, h = r.h * b.h;
  _ctx.save();
  _ctx.fillStyle = 'rgba(0,0,0,.55)';
  _ctx.fillRect(b.x, b.y, b.w, y - b.y);
  _ctx.fillRect(b.x, y + h, b.w, b.y + b.h - (y + h));
  _ctx.fillRect(b.x, y, x - b.x, h);
  _ctx.fillRect(x + w, y, b.x + b.w - (x + w), h);
  const line = 1.5 / _view.z;
  _ctx.strokeStyle = '#fff';
  _ctx.lineWidth = line;
  _ctx.strokeRect(x, y, w, h);
  // The thirds, faint: the one guide that helps a person place a face in a frame.
  _ctx.strokeStyle = 'rgba(255,255,255,.28)';
  _ctx.lineWidth = line * 0.7;
  _ctx.beginPath();
  for (let k = 1; k < 3; k++) {
    _ctx.moveTo(x + (w * k) / 3, y); _ctx.lineTo(x + (w * k) / 3, y + h);
    _ctx.moveTo(x, y + (h * k) / 3); _ctx.lineTo(x + w, y + (h * k) / 3);
  }
  _ctx.stroke();
  const g = HANDLE / _view.z;
  _ctx.fillStyle = '#fff';
  for (const [cx, cy] of [[x, y], [x + w, y], [x, y + h], [x + w, y + h]]) {
    _ctx.fillRect(cx - g / 2, cy - g / 2, g, g);
  }
  const img = _still.img;
  if (img && img.naturalWidth) {
    const size = Math.round(r.w * img.naturalWidth) + ' x ' + Math.round(r.h * img.naturalHeight);
    const fs = Math.max(10, Math.round(11 / _view.z));
    _ctx.font = '600 ' + fs + 'px Inter, Segoe UI, system-ui, sans-serif';
    _ctx.fillStyle = 'rgba(0,0,0,.6)';
    const tw = _ctx.measureText(size).width;
    _ctx.fillRect(x + w / 2 - tw / 2 - 6 / _view.z, y + h - fs * 2, tw + 12 / _view.z, fs * 1.6);
    _ctx.fillStyle = '#fff';
    _ctx.textAlign = 'center';
    _ctx.fillText(size, x + w / 2, y + h - fs * 0.85);
    _ctx.textAlign = 'left';
  }
  _ctx.restore();
}

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
 * top, the outfit below, and the button that joins them sits between (js/merge-v3/wk-setup.js).
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
  _crop = null;
  _filmStop();
  _firstStep(true);
  const a = _halfSpec(top), b = _halfSpec(bottom);
  const want = a.src + '|' + b.src;
  if (_pair && _pair.key === want && !_film) {
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

// ── The stage as the FIRST STEP (P2, the owner 2026-09-22) ──────────────────
// The casting - who and where - is where a talking head begins, and the stage says so: a gold
// frame five pixels thick with the words sewn into its top line. It belongs to the PAIR and to
// nothing else; a frame or a clip on the stage is work being judged, not a step to take. The
// label is an element rather than something drawn on the canvas, because it sits ON the border,
// which the canvas is inside.
const STEP_WORDS = 'First Step';
function _firstStep(on) {
  const stage = document.getElementById(STAGE);
  if (!stage) return;
  stage.classList.toggle('is-first', !!on);
  const had = stage.querySelector('.mv3-stage-step');
  if (!on) { if (had) had.remove(); return; }
  if (had) return;
  const tag = document.createElement('div');
  tag.className = 'mv3-stage-step';
  tag.textContent = STEP_WORDS;
  stage.appendChild(tag);
}

// The gold of the theme, asked for once: the dashed halves and their words are painted on the
// canvas, and a second spelling of the same colour is a colour that will one day be two.
let _gold = '';
function _goldNow() {
  if (!_gold) {
    try { _gold = getComputedStyle(document.documentElement).getPropertyValue('--gold').trim(); } catch (e) { _gold = ''; }
    if (!_gold) _gold = '#d8b45a';
  }
  return _gold;
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
    // Gold, like the frame around the stage and the fields across from it: this half is a thing
    // to fill in, and the first one (P2).
    const inset = Math.round(Math.min(W, hh) * 0.06);
    _ctx.save();
    _ctx.setLineDash([8, 7]);
    _ctx.lineWidth = 2;
    _ctx.strokeStyle = _goldNow();
    _ctx.strokeRect(PAD + inset, top + inset, W - 2 * inset, hh - 2 * inset);
    _ctx.restore();
    _ctx.font = '600 ' + Math.round(Math.min(W, H) * 0.045) + 'px Inter, Segoe UI, system-ui, sans-serif';
    _ctx.textAlign = 'center';
    _ctx.textBaseline = 'middle';
    _ctx.fillStyle = _goldNow();
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
  _drawCrop();
}

export function play() {
  if (_borrowed) return;
  if (!_on || _playing) return;
  if (_at >= duration()) _at = 0;
  _playing = true;
  // Held until what is under the playhead can play (phase V33.4, _tick).
  _holding = true;
  _holdT = performance.now();
  _t0 = performance.now();
  _at0 = _at;
  _syncAudio();
  _syncPlayBtn();
  _raf = requestAnimationFrame(_tick);
}

export function pause() {
  if (!_on || !_playing) return;
  _playing = false;
  _holding = false;
  cancelAnimationFrame(_raf);
  for (const [, el] of _audio) { try { el.pause(); } catch (e) {} }
  for (const [, el] of _media) { try { if (el.pause) el.pause(); } catch (e) {} }
  _syncPlayBtn();
}

export function toggle() { if (_borrowed) return; _playing ? pause() : play(); }
/** Playing now - the timeline holds it still while its playhead is dragged (phase V41). */
export const isPlaying = () => _playing;

function _syncPlayBtn() {
  const b = document.getElementById('mv3-pv-play');
  if (b) { b.innerHTML = _playing ? '&#10074;&#10074;' : '&#9654;'; b.title = _playing ? 'Pause (Space)' : 'Play (Space)'; }
}

// ── Mounting ────────────────────────────────────────────────────────────────
// The format picker, between the clock and the quality, built once when the preview is mounted.
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
    // The heard captions are cut again for the new frame in the same step (K2): another width, another
    // automatic size and words per page - eight words across a column is a paragraph in a shoe box.
    setFormat(next);
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
  if (_hcv) { _hcv.width = CW; _hcv.height = CH; }
  // The stage is shaped by a stylesheet rule per format; with a margin the shape is no longer
  // either of them, so it is stated here - inline, which is what lets one number decide it.
  const stage = document.getElementById(STAGE);
  if (stage) {
    stage.style.aspectRatio = CW + ' / ' + CH;
    // The same shape as a number, for the rule that fits the stage into its field whole (merge-v3.css): a field
    // narrower than the shape used to keep the stage's full height and squeeze the picture sideways.
    stage.style.setProperty('--mv3-ar', String(CW / CH));
  }
  // The captions' canvas covers the frame exactly - the margin is the editor's, not the film's. So does a platform's screen.
  CapLayer.place(PAD / CW, PAD / CH, W / CW, H / CH);
  Platforms.place(PAD / CW, PAD / CH, W / CW, H / CH);
  Platforms.setFormat(_fmt());
  // The stage is shaped by CSS, so the shape has to reach CSS - on the body, where every rule
  // that depends on it can read it.
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
  // libass over the frame; once it can draw, the frame is painted again so the captions are its.
  CapLayer.attach(stage, () => { CapLayer.setTimeline(Store.timeline()); _repaint(); });
  _hcv = document.createElement('canvas');
  _hcv.className = 'mv3-pv-canvas mv3-pv-grips';
  Object.assign(_hcv.style, { position: 'absolute', left: '0', top: '0', pointerEvents: 'none' });
  stage.appendChild(_hcv);
  _hctx = _hcv.getContext('2d');
  // A platform's screen over the captions and under the grips; its marks in the header.
  Platforms.attach(stage, _hcv);
  Platforms.mountButtons();
  _resize();
  // The gesture layer is handed what only this module knows: where each insert was actually
  // drawn, and how to make it draw again mid-drag.
  _wireZoom(_cv);
  _wireCrop(_cv);
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
    caption: (e, p) => CapPlace.down(e, p),
    capHover: (p) => CapPlace.hover(p),
  });
  CapPlace.wireCapPlace({
    canvas: _cv,
    on: () => _on && !_borrowed && !_shooting,
    at: () => _at,
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
// when this module is not showing. Its four buttons are in the TIMELINE's header, right of split (phase V36, T3) - found
// by their ids, wherever they are.
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
    // Typing - a field, or an editable place (the video chat's recipe request, phase V6: its spaces were swallowed
    // and the preview played).
    if (/^(INPUT|TEXTAREA|SELECT)$/.test((e.target.tagName || '')) || e.target.isContentEditable) return;
    e.preventDefault();
    toggle();
  });
}

export const isMounted = () => _on;

// ANOTHER TIMELINE OPENED STARTS STILL, AT ITS START (phase V36, T1; the owner 2026-10-23: "при проигрывании одного хайлайта
// я переключаюсь на другой и плейхед без остановки продолжает двигаться"): a project, a highlights fragment, the draft -
// whichever one the store now holds, playing stops and the playhead goes to 0; nothing plays until Play is pressed.
let _shownKey;
function _toStart() {
  pause();
  if (_on) { seek(0); return; }
  _at = 0; _at0 = 0;
  setPlayhead(0);
}

export function initPreviewB() {
  // Not while a screenshot is being drawn: that has the frame's size and its own canvas in hand.
  Store.onChange(() => {
    const k = Store.key();
    if (k !== _shownKey) { _shownKey = k; _toStart(); }
    if (!_on || _shooting) return;
    // The captions' .ass follows every edit - built by the same builder the render uses.
    CapLayer.setTimeline(Store.timeline());
    _resize(); _repaint(); _clock();
  });
  // A dragged sash changes the surface the workshop is drawing on, and nothing else would
  // notice: the timeline's own frame is a fixed size, this one is the panel.
  window.addEventListener('resize', () => { if (_on && _borrowed) { _resize(); _paint(); } });
  const q = document.getElementById('mv3-pv-q');
  // A new quality means new files. The old ones are dropped rather than left in the map,
  // where they would be held open for a resolution nothing is going to ask for again.
  if (q) q.addEventListener('change', () => { if (_on) { _sweep(new Set()); _repaint(); } });
}
