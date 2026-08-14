/* ═══════════════════════════════════════════════════════════════════════════
   MERGE v3 — the preview compositor.

   One master clock drives a pool of <video> elements, one per clip, and every frame
   the active sources are drawn onto a canvas in the SAME z-order ffmpeg will use:

       Main (seg)  →  Halfer band  →  Birols / Hooks full-frame or PiP

   THE PREVIEW IS AN APPROXIMATION. It exists to answer "is this roughly the cut I
   want", not to be the render. Where it can only approximate, it says so here rather
   than pretending:

     • filters are CSS filter strings, not ffmpeg's. `sharpen` in particular is faked
       as a contrast bump - canvas has no cheap convolution;
     • REVERSED is not previewed at all. Browsers have no reliable backwards playback,
       so a reversed clip plays forward and the canvas says so on top of it;
     • transitions run over the clip's own 0.35s edges, which is how the old preview
       timed them.

   Ported from js/mergev2-compositor.js, whose numbers (0.15 zoom, 0.35s edges, 0.25
   punch, the filter strings) are kept EXACTLY so the two previews agree. Three things
   are better here: whip-pan actually pans, glitch actually splits channels, and the
   backing resolution is a choice rather than a constant.

   Audio follows the same cascade the inspector shows: clip ?? track ?? default, where
   the default is ON for Main (it carries the voice) and OFF for inserts.
   ═══════════════════════════════════════════════════════════════════════════ */

import * as Store from './store.js';
import { onSeek, setPlayhead, playheadAt, VISUAL_TRACKS, selectClip, selected, onSelect } from './timeline.js';
import * as Subs from './subtitles.js';

// Bottom layer first - the reverse of the track order in the timeline, which is where the
// layering is decided. Derived rather than restated so the frame always matches the rows.
const DRAW_ORDER = [...VISUAL_TRACKS].reverse();

// VOLUME IS THE ONLY AUDIO CONTROL, and 0 means silent. There used to be a separate
// on/off flag as well, defaulting to off for the overlay tracks - so dragging the volume
// slider on a birol changed a stored number while the element stayed muted, and nothing
// was heard. One control cannot disagree with itself.
//
// The default level when nothing has been set: Main carries the voice, everything laid
// over it starts silent and is raised deliberately.
const VOLUME_BY_DEFAULT = { seg: 1, biro: 0, hook: 0, halfer: 0, music: 0.5 };

// Which tracks can be placed and rotated by hand on the frame. A halfer is a band with
// its own geometry, and Main is the frame itself - neither is a free-floating insert.
const PLACEABLE = new Set(['biro', 'hook']);

const TD = 0.35;          // transition edge length, seconds
const DRIFT_TOL = 0.15;   // only hard-seek a video when it is off by more than this
// How early the next clip is loaded and seeked to its first frame. Long enough for a decode,
// short enough that a timeline of a hundred clips is not all in memory at once.
const PREROLL = 1.5;

const LS_Q = 'mv3_pv_quality';
// Named by width, which is how a vertical Reel is usually described. Height is derived
// so nothing here can drift from 9:16.
//
// These doubles as the PROXY size asked of the server, so the list has to stay a subset of
// PROXY_HEIGHTS in routes/ffmpeg.js. 540 used to be here and was not in that list: the
// server quietly served 480 instead, so the label promised a sharpness it never delivered.
// 1080 is the odd one out - it means "no proxy at all, play the original file".
const QUALITIES = [['360', '360'], ['480', '480'], ['720', '720'], ['1080', 'full']];
const FULL_Q = 1080;

let _canvas = null, _ctx = null;
// The handles live on their OWN canvas, laid over the frame and deliberately BIGGER than
// it. The frame canvas cannot show them once an overlay is dragged past an edge - anything
// drawn outside a canvas is clipped, by definition - and losing the grab points exactly
// when a clip is half off-frame is when you most need them.
//
// Margin as a fraction of frame width, on every side.
const OVER_M = 0.11;
let _over = null, _octx = null;
// The video-only buffer. See the note in _draw: the picture is composited here so a decode
// gap keeps the last good frame WITHOUT also freezing the captions drawn over it.
let _buf = null, _bctx = null;
let _pool = new Map();       // clip id -> <video>
let _music = new Map();      // clip id -> <audio>
let _playing = false;
let _clock = 0;
let _baseWall = 0, _baseClock = 0;
let _raf = null;
let _quality = 480;

const _dur = () => Store.duration();

// ── Resolution ──────────────────────────────────────────────────────────────
function _applyQuality() {
  if (!_canvas) return;
  _canvas.width = _quality;
  _canvas.height = Math.round(_quality * 16 / 9);
  if (!_buf) { _buf = document.createElement('canvas'); _bctx = _buf.getContext('2d'); }
  _buf.width = _canvas.width;
  _buf.height = _canvas.height;
  if (_over) {
    // Same scale as the frame, plus the margin on all four sides, so one pixel means the
    // same thing on both surfaces and the handles cannot drift from what they surround.
    _over.width = Math.round(_canvas.width * (1 + OVER_M * 2));
    _over.height = Math.round(_canvas.height + _canvas.width * OVER_M * 2);
  }
  _draw();
}

// Switching quality has to reload what is ALREADY pooled. Elements are cached by clip id
// and keep the src they were created with, so without this the new setting would only reach
// clips first seen after the switch - which reads as "the dropdown does nothing". Position
// and play state survive because seek() rebuilds from the same clock.
function _repointPool() {
  for (const el of _pool.values()) { try { el.pause(); el.removeAttribute('src'); el.load(); } catch (e) {} }
  _pool.clear();
  seek(_clock);
  _warmSoon();
}

// Pre-warm the proxies in the background. The endpoint transcodes on the first request and
// only answers when it is done, so without this the first play after a switch stalls once
// per clip. HEAD asks for the work without downloading the result. Sequential on purpose:
// one ffmpeg at a time, nearest the playhead first, and a newer switch abandons this pass.
let _warmTok = 0, _warmT = null, _warmedKey = null;
function _warmSoon() { clearTimeout(_warmT); _warmT = setTimeout(_warmProxies, 250); }
async function _warmProxies() {
  const tok = ++_warmTok;
  if (_quality >= FULL_Q) return;
  const tl = Store.timeline();
  if (!tl) return;
  const seen = new Set(), jobs = [];
  for (const scope of DRAW_ORDER) {
    if (scope === 'music') continue;
    const tr = tl.tracks[scope];
    if (!tr) continue;
    for (const c of (tr.clips || [])) {
      if (!c.src || seen.has(c.src)) continue;
      seen.add(c.src);
      jobs.push({ at: +c.start || 0, url: _srcFor(scope, c) });
    }
  }
  jobs.sort((a, b) => Math.abs(a.at - _clock) - Math.abs(b.at - _clock));
  for (const j of jobs) {
    if (tok !== _warmTok) return;
    try { await fetch(j.url, { method: 'HEAD' }); } catch (e) {}
  }
}
// Frame pixels -> overlay pixels.
const _mx = () => Math.round(_canvas.width * OVER_M);

// ── The clock ───────────────────────────────────────────────────────────────
function _now() { return performance.now() / 1000; }

export function seek(t) {
  _clock = Math.max(0, Math.min(_dur() || 0, t));
  _baseWall = _now(); _baseClock = _clock;
  _syncSources(true);
  _draw();
  _paintTime();
}

function _tick() {
  if (_playing) {
    _clock = _baseClock + (_now() - _baseWall);
    const end = _dur();
    if (end > 0 && _clock >= end) { _clock = end; pause(); }
    setPlayhead(_clock);          // visual only - it must not call back into here
  }
  _syncSources(false);
  _draw();
  _paintTime();
  _raf = requestAnimationFrame(_tick);
}

export function play() {
  if (_playing) return;
  if (_dur() <= 0) return;
  if (_clock >= _dur()) _clock = 0;
  _playing = true;
  _baseWall = _now(); _baseClock = _clock;
  _paintPlay();
}
export function pause() {
  _playing = false;
  for (const v of _pool.values()) { try { v.pause(); } catch (e) {} }
  for (const a of _music.values()) { try { a.pause(); } catch (e) {} }
  _paintPlay();
}
export function toggle() { _playing ? pause() : play(); }

// ── Which clips are live, and keeping their elements in step ────────────────
function _activeClips() {
  const tl = Store.timeline();
  const out = [];
  if (!tl) return out;
  for (const scope of DRAW_ORDER.concat(['music'])) {
    const tr = tl.tracks[scope];
    if (!tr) continue;
    for (const c of (tr.clips || [])) {
      if (_clock >= c.start && _clock < c.start + c.dur) out.push({ scope, c, track: tr });
    }
  }
  return out;
}

const _eff = (clipVal, trackVal, dflt) => (clipVal != null ? clipVal : (trackVal != null ? trackVal : dflt));

// What the preview actually LOADS, as opposed to how big it is drawn. The quality picker
// used to resize the canvas and nothing else, so every clip was still decoded at the source
// 1080x1920 and playback stuttered exactly as much at 360 as at full - decode is the
// expensive part, not rasterisation. The server already keeps a cached low-res transcode
// for this (routes/ffmpeg.js, /ffmpeg/preview-proxy), so that is where the picker bites.
// Music keeps the original: there is no picture to shrink. The endpoint falls back to the
// original by itself for /vsl/ sources (hour-long, transcoding them would stall) and on any
// transcode failure, so a proxy URL is never a dead end.
function _srcFor(scope, c) {
  if (!c.src || scope === 'music' || _quality >= FULL_Q) return c.src;
  return '/api/ffmpeg/preview-proxy?src=' + encodeURIComponent(c.src) + '&h=' + _quality;
}

function _element(scope, c) {
  const map = scope === 'music' ? _music : _pool;
  let el = map.get(c.id);
  if (!el) {
    el = scope === 'music' ? new Audio() : document.createElement('video');
    el.preload = 'auto';
    el.playsInline = true;
    el.src = _srcFor(scope, c);
    map.set(c.id, el);
  }
  return el;
}

function _syncSources(hard) {
  const tl = Store.timeline();
  const live = _activeClips();
  const liveIds = new Set(live.map(x => x.c.id));

  // Anything no longer under the playhead stops. Left loaded on purpose: seeking back
  // and forth over a cut is the common case, and re-fetching each time stutters.
  for (const [id, el] of _pool) if (!liveIds.has(id)) { try { el.pause(); } catch (e) {} }
  for (const [id, el] of _music) if (!liveIds.has(id)) { try { el.pause(); } catch (e) {} }

  // PRE-ROLL. The other half of the flicker fix: the clip that is about to start is created
  // and seeked to its first frame slightly BEFORE its turn, so by the time the playhead
  // reaches it there is a frame to draw. Without this every cut begins with a decode.
  if (_playing && tl) {
    for (const scope of DRAW_ORDER) {
      const tr = tl.tracks[scope];
      if (!tr) continue;
      for (const c of (tr.clips || [])) {
        const lead = c.start - _clock;
        if (lead > 0 && lead <= PREROLL && !_pool.has(c.id)) {
          const el = _element(scope, c);
          try { el.currentTime = Math.max(0, +c.trimIn || 0); } catch (e) {}
        }
      }
    }
  }

  for (const { scope, c, track } of live) {
    const el = _element(scope, c);
    const speed = +c.speed || 1;
    const want = (+c.trimIn || 0) + (_clock - c.start) * speed;

    try { el.playbackRate = Math.max(0.25, Math.min(4, speed)); } catch (e) {}
    // Silence is volume 0, nothing else. Still setting `muted` at zero because a video
    // element at volume 0 is not guaranteed to stop decoding audio, and muted is.
    const vol = _eff(c.volume, track.volume, VOLUME_BY_DEFAULT[scope]);
    el.muted = !(vol > 0);
    try { el.volume = Math.max(0, Math.min(1, vol)); } catch (e) {}

    if (hard || !isFinite(el.currentTime) || Math.abs(el.currentTime - want) > DRIFT_TOL) {
      try { el.currentTime = Math.max(0, want); } catch (e) {}
    }
    if (_playing) { if (el.paused) el.play().catch(() => {}); }
    else if (!el.paused) { try { el.pause(); } catch (e) {} }
  }
}

// ── Drawing ─────────────────────────────────────────────────────────────────
// Cover-scale a source into the frame, aligned, with an optional zoom. "Cover" because
// a Reel frame must be filled: letterboxing a 16:9 birol into 9:16 would show bars the
// export does not have.
function _cover(ctx, v, cw, ch, align, zoom) {
  const vw = v.videoWidth || 0, vh = v.videoHeight || 0;
  if (!vw || !vh) return;
  const z = zoom || 1;
  const scale = Math.max(cw / vw, ch / vh) * z;
  const dw = vw * scale, dh = vh * scale;
  let dx;
  if (align === 'left') dx = 0;
  else if (align === 'right') dx = cw - dw;
  else dx = (cw - dw) / 2;
  const dy = (ch - dh) / 2;
  try { ctx.drawImage(v, dx, dy, dw, dh); } catch (e) {}
}

// Same strings the old preview used, so the two agree. These APPROXIMATE ffmpeg.
function _cssFilter(name) {
  switch (name) {
    case 'bw':        return 'grayscale(1)';
    case 'sepia':     return 'sepia(0.85)';
    case 'warm':      return 'saturate(1.2) sepia(0.22)';
    case 'cool':      return 'saturate(1.15) hue-rotate(-12deg) brightness(1.02)';
    case 'cinematic': return 'contrast(1.1) saturate(1.18)';
    case 'vhs':       return 'saturate(1.3) contrast(1.08)';
    case 'sharpen':   return 'contrast(1.12)';   // canvas has no cheap convolution
    case 'glitch':    return 'saturate(1.4) contrast(1.1)';
    default:          return '';                  // none, and vignette (drawn as overlay)
  }
}

function _vignette(ctx, cw, ch) {
  const g = ctx.createRadialGradient(cw / 2, ch / 2, Math.min(cw, ch) * 0.35, cw / 2, ch / 2, Math.max(cw, ch) * 0.72);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.save(); ctx.fillStyle = g; ctx.fillRect(0, 0, cw, ch); ctx.restore();
}

// The state a transition is in at time t: how far through its in- and out-edges, plus
// the extra zoom, offset, blur and overlay it asks for.
function _fx(c) {
  const dur = +c.dur || 0;
  const localT = _clock - c.start;
  const prog = dur > 0 ? Math.max(0, Math.min(1, localT / dur)) : 0;
  const inP = dur > 0 ? Math.min(1, localT / TD) : 1;
  const outP = dur > 0 ? Math.min(1, (dur - localT) / TD) : 1;
  const edge = Math.max(0, Math.min(inP, outP));   // 1 in the middle, 0 at the very ends

  // Animation: the slow Ken Burns push over the whole clip.
  let zoom = 1;
  if (c.animation === 'zoom_in') zoom = 1 + 0.15 * prog;
  else if (c.animation === 'zoom_out') zoom = 1.15 - 0.15 * prog;

  let blur = 0, overlay = null, alpha = 1, dx = 0, dy = 0, glitch = 0;
  switch (c.transition) {
    case 'fade':        overlay = ['#000', 1 - edge]; break;
    case 'fadewhite':   overlay = ['#fff', 1 - edge]; break;
    // A flash is not a fade: it is bright and brief, so it uses only the first third of
    // the edge and comes back fast.
    case 'flash-white': overlay = ['#fff', Math.max(0, 1 - edge * 3)]; break;
    case 'blur':        blur = (1 - edge) * 12; break;
    case 'zoom-punch-in':  zoom *= 1 + (1 - inP) * 0.25; break;
    case 'zoom-punch-out': zoom *= 1 + (1 - outP) * 0.25; break;
    // These two ACTUALLY pan now. The old preview blurred instead, which showed that
    // something happened but not what: a whip pan enters from one side and leaves to the
    // other, and that is the thing you are checking when you pick it.
    case 'whip-pan-h': dx = (1 - inP) - (1 - outP); blur = (1 - edge) * 8; break;
    case 'whip-pan-v': dy = (1 - inP) - (1 - outP); blur = (1 - edge) * 8; break;
    case 'glitch':     glitch = 1 - edge; break;
    default: break;
  }
  return { zoom, blur, overlay, alpha, dx, dy, glitch, edge };
}

// An RGB split with a couple of torn slices - what "glitch" looks like, rather than the
// blur the old preview substituted.
function _drawGlitch(ctx, v, cw, ch, align, zoom, amount) {
  const off = Math.round(cw * 0.03 * amount);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.filter = 'url(#none)';         // reset any inherited filter
  ctx.filter = 'none';
  ctx.globalAlpha = 0.55;
  ctx.translate(-off, 0);
  ctx.filter = 'sepia(1) saturate(6) hue-rotate(-40deg)';   // reddish channel
  _cover(ctx, v, cw, ch, align, zoom);
  ctx.translate(off * 2, 0);
  ctx.filter = 'sepia(1) saturate(6) hue-rotate(140deg)';   // cyan-ish channel
  _cover(ctx, v, cw, ch, align, zoom);
  ctx.restore();

  // Two torn horizontal slices, shifted.
  const slices = 2;
  for (let i = 0; i < slices; i++) {
    const sh = Math.max(4, Math.round(ch * 0.06));
    const sy = Math.round(((i + 1) / (slices + 1)) * ch);
    const shift = Math.round(cw * 0.06 * amount * (i % 2 ? -1 : 1));
    try { ctx.drawImage(_canvas, 0, sy, cw, sh, shift, sy, cw, sh); } catch (e) {}
  }
}

function _drawFull(ctx, v, cw, ch, c) {
  const f = _fx(c);
  const align = c.cropAlign || 'center';
  const css = _cssFilter(c.filter);
  const filterStr = ((css ? css + ' ' : '') + (f.blur > 0.25 ? 'blur(' + f.blur.toFixed(1) + 'px)' : '')).trim();

  ctx.save();
  if (filterStr) ctx.filter = filterStr;
  // A whip pan slides the whole frame; up to 35% of the axis, which reads as a whip
  // without ever showing the black behind it for long.
  if (f.dx || f.dy) ctx.translate(f.dx * cw * 0.35, f.dy * ch * 0.35);
  _cover(ctx, v, cw, ch, align, f.zoom);
  ctx.restore();

  if (f.glitch > 0.02) _drawGlitch(ctx, v, cw, ch, align, f.zoom, f.glitch);
  if (c.filter === 'vignette') _vignette(ctx, cw, ch);
  if (f.overlay && f.overlay[1] > 0.01) {
    ctx.save();
    ctx.globalAlpha = Math.min(1, f.overlay[1]);
    ctx.fillStyle = f.overlay[0];
    ctx.fillRect(0, 0, cw, ch);
    ctx.restore();
  }
}

// ── Where a placed clip sits on the frame ───────────────────────────────────
// tw == null is the DEFAULT and means "the whole frame". That is why the fields are null
// rather than 0/0/1: an untouched clip covers everything, and the first drag is what
// turns it into an inset.
function _rect(c, cw, ch, v) {
  if (c.tw == null) return { x: 0, y: 0, w: cw, h: ch, full: true };
  const w = (+c.tw) * cw;
  const vw = (v && v.videoWidth) || 9, vh = (v && v.videoHeight) || 16;
  return { x: (+c.tx || 0) * cw, y: (+c.ty || 0) * ch, w, h: w * (vh / vw), full: false };
}
const _angleOf = (c) => (+c.angle || 0) * Math.PI / 180;

// Picture-in-picture: the clip scaled into its rect and rotated about its centre. Fades
// apply as opacity, since an overlay would darken the frame behind it too.
function _drawPiP(ctx, v, cw, ch, c) {
  const f = _fx(c);
  const r = _rect(c, cw, ch, v);
  const fade = (c.transition === 'fade' || c.transition === 'fadewhite' || c.transition === 'flash-white');
  const css = _cssFilter(c.filter);
  const filterStr = ((css ? css + ' ' : '') + (f.blur > 0.25 ? 'blur(' + f.blur.toFixed(1) + 'px)' : '')).trim();
  ctx.save();
  if (fade) ctx.globalAlpha = Math.max(0, Math.min(1, f.edge));
  if (filterStr) ctx.filter = filterStr;
  const a = _angleOf(c);
  if (a) { ctx.translate(r.x + r.w / 2, r.y + r.h / 2); ctx.rotate(a); ctx.translate(-r.w / 2, -r.h / 2); }
  else ctx.translate(r.x, r.y);
  try { ctx.drawImage(v, 0, 0, r.w, r.h); } catch (e) {}
  ctx.restore();
}

// Halfer: the source rotated (0/90/180/270, 90 by default) and stretched across a band
// of 2/5 of the frame height, top or bottom.
function _drawHalfer(ctx, v, cw, ch, c) {
  const bandH = Math.round(ch * 0.4);
  const top = (c.halferAlign || 'top') === 'top' ? 0 : ch - bandH;
  const rot = c.rotation == null ? 90 : +c.rotation;
  const f = _fx(c);
  const css = _cssFilter(c.filter);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, top, cw, bandH);
  ctx.clip();
  if (css) ctx.filter = css;
  ctx.translate(cw / 2, top + bandH / 2);
  ctx.rotate(rot * Math.PI / 180);
  const swapped = (rot === 90 || rot === 270);
  const w = swapped ? bandH : cw, h = swapped ? cw : bandH;
  if (rot === 0 || rot === 180) {
    // Not stretched at 0/180: it covers the band keeping aspect, and `valign` picks
    // which part survives.
    const vw = v.videoWidth || 1, vh = v.videoHeight || 1;
    const s = Math.max(w / vw, h / vh);
    const dw = vw * s, dh = vh * s;
    const dy = (c.valign || 'top') === 'top' ? -h / 2 : h / 2 - dh;
    try { ctx.drawImage(v, -dw / 2, dy, dw, dh); } catch (e) {}
  } else {
    try { ctx.drawImage(v, -w / 2, -h / 2, w, h); } catch (e) {}
  }
  ctx.restore();
  if (f.overlay && f.overlay[1] > 0.01) {
    ctx.save();
    ctx.globalAlpha = Math.min(1, f.overlay[1]);
    ctx.fillStyle = f.overlay[0];
    ctx.fillRect(0, top, cw, bandH);
    ctx.restore();
  }
}

// ── Direct manipulation on the frame ────────────────────────────────────────
// Click an overlay to select it, then drag it, drag a corner to resize, or drag the
// handle above it to rotate. This replaces the numeric X/Y/W rows the inspector used to
// carry: placing a picture-in-picture by typing percentages is guessing, and the frame is
// right there.
//
// Everything is in CANVAS pixels, not screen pixels, so the same gesture lands in the
// same place whatever preview resolution is chosen.
// Screen -> FRAME pixels. Measured against the frame canvas even though the pointer is
// over the overlay, so a gesture that strays past the edge keeps producing sensible
// (negative, or over-width) frame coordinates rather than being clamped by the surface
// it happens to be on.
function _toCanvas(e) {
  const b = _canvas.getBoundingClientRect();
  return {
    x: (e.clientX - b.left) * (_canvas.width / Math.max(1, b.width)),
    y: (e.clientY - b.top) * (_canvas.height / Math.max(1, b.height)),
  };
}
// Handle size scaled with the backing resolution, so it stays the same size on screen.
const _hs = () => Math.max(8, Math.round(_canvas.width * 0.028));

// A point in the rect's own space: undo the rotation about the centre, then compare.
function _local(pt, r, ang) {
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
  const dx = pt.x - cx, dy = pt.y - cy;
  const cos = Math.cos(-ang), sin = Math.sin(-ang);
  return { x: dx * cos - dy * sin, y: dx * sin + dy * cos, cx, cy };
}
const _inside = (p, r) => Math.abs(p.x) <= r.w / 2 && Math.abs(p.y) <= r.h / 2;

// Which corner, if any. Returned as signs so the resize maths does not care which one.
function _corner(p, r, hs) {
  const near = (a, b) => Math.abs(a - b) <= hs;
  const sx = near(p.x, -r.w / 2) ? -1 : near(p.x, r.w / 2) ? 1 : 0;
  const sy = near(p.y, -r.h / 2) ? -1 : near(p.y, r.h / 2) ? 1 : 0;
  return (sx && sy) ? { sx, sy } : null;
}
const ROT_OFF = 2.2;   // how far above the top edge the rotate handle sits, in handle-widths

function _selectedLive() {
  const sel = selected();
  if (!sel || sel.kind !== 'clip' || !PLACEABLE.has(sel.scope)) return null;
  const tl = Store.timeline();
  const tr = tl && tl.tracks[sel.scope];
  const c = tr && tr.clips.find(x => x.id === sel.id);
  if (!c) return null;
  if (_clock < c.start || _clock >= c.start + c.dur) return null;   // not on screen now
  return { scope: sel.scope, c };
}

// Drawn on the overlay, in frame coordinates shifted by the margin - so a rect hanging off
// the left edge still gets its corner squares, out in the surround.
function _drawHandles(ctx, r, ang) {
  const hs = _hs();
  const m = _mx();
  ctx.save();
  ctx.translate(m, m);
  ctx.translate(r.x + r.w / 2, r.y + r.h / 2);
  ctx.rotate(ang);
  ctx.strokeStyle = '#ffd000';
  ctx.lineWidth = Math.max(2, Math.round(_canvas.width * 0.005));
  ctx.setLineDash([hs * 0.7, hs * 0.5]);
  ctx.strokeRect(-r.w / 2, -r.h / 2, r.w, r.h);
  ctx.setLineDash([]);
  ctx.fillStyle = '#ffd000';
  for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    ctx.fillRect(sx * r.w / 2 - hs / 2, sy * r.h / 2 - hs / 2, hs, hs);
  }
  // The rotate handle: a stalk above the top edge with a round head.
  ctx.beginPath();
  ctx.moveTo(0, -r.h / 2);
  ctx.lineTo(0, -r.h / 2 - hs * ROT_OFF);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, -r.h / 2 - hs * ROT_OFF, hs * 0.62, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function _hitTest(pt) {
  const tl = Store.timeline();
  if (!tl) return null;
  // Top layer first, so clicking overlapping overlays picks the one you can see. That means
  // backwards through the tracks AND backwards through each track's clips: clips on an
  // overlay lane may cover one another, and the last one is the one drawn on top.
  for (const scope of [...DRAW_ORDER].reverse()) {
    if (!PLACEABLE.has(scope)) continue;
    const tr = tl.tracks[scope];
    if (!tr) continue;
    for (const c of (tr.clips || []).slice().reverse()) {
      if (_clock < c.start || _clock >= c.start + c.dur) continue;
      const r = _rect(c, _canvas.width, _canvas.height, _pool.get(c.id));
      if (_inside(_local(pt, r, _angleOf(c)), r)) return { scope, c };
    }
  }
  return null;
}

// Bound to the OVERLAY, which sits on top and extends past the frame: a handle out in the
// margin has to be clickable, and a click on the frame canvas would never reach it.
function _wireCanvas() {
  _over.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const pt = _toCanvas(e);

    // A CAPTION first, because captions are drawn over everything and grabbing what you can
    // see is the only rule that never surprises. Which value the drag writes depends on what
    // is selected: the whole track moves every caption, one caption moves itself.
    const capBox = Subs.boxAt(_ctx, _canvas.width, _canvas.height, _clock);
    if (capBox) {
      const pad = Math.round(_canvas.width * 0.012);
      const inCap = pt.x >= capBox.x - pad && pt.x <= capBox.x + capBox.w + pad
                 && pt.y >= capBox.y - pad && pt.y <= capBox.y + capBox.h + pad;
      if (inCap) { _beginCaptionDrag(e, pt, capBox.clip); return; }
    }

    const live = _selectedLive();

    // A handle of the already-selected clip wins over anything underneath it.
    let mode = null, target = live;
    if (live) {
      const r = _rect(live.c, _canvas.width, _canvas.height, _pool.get(live.c.id));
      const ang = _angleOf(live.c);
      const p = _local(pt, r, ang);
      const hs = _hs();
      const rotHead = { x: 0, y: -r.h / 2 - hs * ROT_OFF };
      if (Math.hypot(p.x - rotHead.x, p.y - rotHead.y) <= hs) mode = 'rotate';
      else { const c4 = _corner(p, r, hs); if (c4) { mode = 'resize'; target.corner = c4; } }
    }
    if (!mode) {
      const hit = _hitTest(pt);
      if (!hit) { selectClip(null, null); _draw(); return; }
      if (!live || hit.c.id !== live.c.id) { selectClip(hit.scope, hit.c.id); target = { scope: hit.scope, c: hit.c }; }
      mode = 'move';
    }

    const cw = _canvas.width, ch = _canvas.height;
    const v = _pool.get(target.c.id);
    const start = _rect(target.c, cw, ch, v);
    const startAng = _angleOf(target.c);
    const cx0 = start.x + start.w / 2, cy0 = start.y + start.h / 2;
    // A clip that has never been placed becomes placed the moment it is touched, keeping
    // the frame it already filled - so nothing jumps under the pointer.
    const aspect = start.h / Math.max(1, start.w);
    let next = { tx: start.x / cw, ty: start.y / ch, tw: start.w / cw, angle: +target.c.angle || 0 };

    // A click that selects must not also place. Without this, pressing a full-frame clip
    // just to select it wrote tx/ty/tw and turned it into an inset that happened to be
    // exactly the frame - the geometry changed while nothing moved.
    let changed = false;
    const move = (ev) => {
      changed = true;
      const p = _toCanvas(ev);
      if (mode === 'move') {
        next.tx = (p.x - (pt.x - start.x)) / cw;
        next.ty = (p.y - (pt.y - start.y)) / ch;
      } else if (mode === 'rotate') {
        const ang = Math.atan2(p.y - cy0, p.x - cx0) + Math.PI / 2;   // handle points up
        // Snap near the quarter turns: getting exactly 0 or 90 by hand is otherwise luck.
        let deg = ang * 180 / Math.PI;
        while (deg > 180) deg -= 360;
        while (deg < -180) deg += 360;
        for (const s of [-180, -90, 0, 90, 180]) if (Math.abs(deg - s) < 5) deg = s;
        next.angle = Math.round(deg);
      } else {
        // Resize from a corner, keeping aspect: the width follows the dragged corner's
        // distance from the OPPOSITE one, measured in the rect's own rotated space.
        const l = _local(p, start, startAng);
        const w = Math.max(cw * 0.04, Math.abs(l.x - target.corner.sx * -start.w / 2) );
        next.tw = Math.min(1.5, w / cw);
        // Keep the anchor corner still.
        const nw = next.tw * cw, nh = nw * aspect;
        next.tx = (target.corner.sx < 0 ? (start.x + start.w - nw) : start.x) / cw;
        next.ty = (target.corner.sy < 0 ? (start.y + start.h - nh) : start.y) / ch;
      }
      // Clamped loosely: a little off-frame is a legitimate composition, all the way off
      // is a clip you can no longer find.
      next.tx = Math.max(-0.9, Math.min(0.98, next.tx));
      next.ty = Math.max(-0.9, Math.min(0.98, next.ty));
      _live = { id: target.c.id, ...next };
      _draw();
    };
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      document.body.classList.remove('mv3-pv-drag');
      _live = null;
      if (!changed) { _draw(); return; }        // a plain click: select, place nothing
      const r4 = (n) => Math.round(n * 10000) / 10000;
      Store.mutate(tl => {
        const tr = tl.tracks[target.scope];
        const c = tr && tr.clips.find(x => x.id === target.c.id);
        if (!c) return;
        c.tx = r4(next.tx); c.ty = r4(next.ty); c.tw = r4(next.tw);
        c.angle = next.angle ? Math.round(next.angle) : null;
      });
    };
    document.body.classList.add('mv3-pv-drag');
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  });
}

// Dragging a caption. The store is written ONCE on release, like every other gesture here,
// so the whole move is one undo step - and undoing a track-wide move puts every caption back
// together rather than one at a time.
let _liveSub = null;

function _beginCaptionDrag(e, pt, clip) {
  const sel = selected();
  const whole = !!(sel && sel.kind === 'track' && sel.scope === 'subs');
  // Pressing a caption with something else selected selects that caption - the same way
  // pressing an overlay selects it.
  if (!whole && !(sel && sel.kind === 'clip' && sel.id === clip.id)) selectClip('subs', clip.id);

  const cw = _canvas.width, ch = _canvas.height;
  document.body.classList.add('mv3-pv-drag');
  _liveSub = { dx: 0, dy: 0 };
  const move = (ev) => {
    const p = _toCanvas(ev);
    _liveSub = { dx: p.x - pt.x, dy: p.y - pt.y };
    _draw();
  };
  const up = () => {
    document.removeEventListener('mousemove', move);
    document.removeEventListener('mouseup', up);
    document.body.classList.remove('mv3-pv-drag');
    const d = _liveSub || { dx: 0, dy: 0 };
    _liveSub = null;
    if (Math.abs(d.dx) < 1 && Math.abs(d.dy) < 1) { _draw(); return; }   // a click, not a move
    const dtx = d.dx / cw, dty = d.dy / ch;
    if (whole) Subs.nudgeAll(dtx, dty);
    else Subs.nudgeClip(clip.id, dtx, dty);
  };
  document.addEventListener('mousemove', move);
  document.addEventListener('mouseup', up);
}

// The in-flight values of a drag. Held here rather than written to the store on every
// mousemove, for the same two reasons the timeline drag does it: one undo step per
// gesture, and no repaint pulling the element out from under the pointer.
let _live = null;
function _withLive(c) {
  if (!_live || _live.id !== c.id) return c;
  return { ...c, tx: _live.tx, ty: _live.ty, tw: _live.tw, angle: _live.angle };
}

function _badge(ctx, cw, ch, text) {
  ctx.save();
  const fs = Math.max(11, Math.round(cw * 0.032));
  ctx.font = '600 ' + fs + 'px Inter, system-ui, sans-serif';
  const w = ctx.measureText(text).width + fs;
  ctx.fillStyle = 'rgba(0,0,0,.6)';
  ctx.fillRect(cw / 2 - w / 2, ch - fs * 3, w, fs * 1.8);
  ctx.fillStyle = '#ffd000';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillText(text, cw / 2, ch - fs * 3 + fs * 0.9);
  ctx.restore();
}

function _draw() {
  if (!_ctx || !_canvas) return;
  const cw = _canvas.width, ch = _canvas.height;

  const live = _activeClips();

  // TWO SURFACES, and the reason is a bug this had before the split. The video layers go
  // into a buffer; the canvas gets that buffer plus everything drawn over it.
  //
  // THE BLACK FLICKER AT A CUT was never a gap on the timeline: at a boundary the outgoing
  // clip's element is finished and the incoming one has been told to seek but has not
  // decoded a frame yet, so clearing to black and drawing nothing produced the blink. The
  // first fix was to return early and keep whatever was on the canvas - which also skipped
  // the SUBTITLES, so a caption over a still-decoding fragment simply vanished. Measured:
  // 0% of the frame drawn while the caption was active and its layout correct.
  //
  // Buffering the video separately fixes both: the buffer keeps the last good picture
  // through a decode gap, and the captions are composited fresh every frame on top of it
  // rather than accumulating outlines on a frame that was never cleared.
  const drawable = live.filter(x => x.scope !== 'music')
    .some(x => { const v = _pool.get(x.c.id); return v && v.videoWidth && v.readyState >= 2; });

  let reversed = 0;
  if (drawable || !live.length) {
    _bctx.clearRect(0, 0, cw, ch);
    _bctx.fillStyle = '#000';
    _bctx.fillRect(0, 0, cw, ch);
    for (const scope of DRAW_ORDER) {
      for (const item of live.filter(x => x.scope === scope)) {
        const c = _withLive(item.c);
        const v = _pool.get(c.id);
        if (!v || !v.videoWidth) continue;
        if (c.reversed) reversed++;
        if (scope === 'halfer') _drawHalfer(_bctx, v, cw, ch, c);
        // Untouched clips cover the whole frame and are cover-scaled. The moment one is
        // placed or rotated it becomes a rectangle on the frame instead.
        else if (c.tw != null || c.angle) _drawPiP(_bctx, v, cw, ch, c);
        else _drawFull(_bctx, v, cw, ch, c);
      }
    }
  }

  _ctx.clearRect(0, 0, cw, ch);
  _ctx.fillStyle = '#000';
  _ctx.fillRect(0, 0, cw, ch);
  try { _ctx.drawImage(_buf, 0, 0); } catch (e) {}

  // Subtitles go over the picture and under the selection furniture. Drawn from the same
  // store the export reads, so what you position here is what gets burned.
  _ctx.save();
  if (_liveSub) _ctx.translate(_liveSub.dx, _liveSub.dy);
  const sub = Subs.draw(_ctx, cw, ch, _clock);
  _ctx.restore();

  // Said on the frame rather than left as a silent difference from the export.
  if (reversed) _badge(_ctx, cw, ch, '⟲ reverse is not previewed');

  // The selection frame goes on the overlay, which is wider than the frame - that is the
  // only way its handles survive being dragged past an edge.
  if (_octx && _over) {
    _octx.clearRect(0, 0, _over.width, _over.height);
    const sel = _selectedLive();
    if (sel) {
      const c = _withLive(sel.c);
      _drawHandles(_octx, _rect(c, cw, ch, _pool.get(c.id)), _angleOf(c));
    }
    // A caption is framed but has no corner handles: it is moved, never resized - its size
    // is the style's font size, which belongs to the whole track.
    const s = selected();
    const subsSel = s && ((s.kind === 'track' && s.scope === 'subs') || (s.kind === 'clip' && s.scope === 'subs'));
    if (subsSel && sub) {
      const b = sub.box;
      const pad = Math.round(cw * 0.012);
      _drawCaptionFrame(_octx, b.x - pad + (_liveSub ? _liveSub.dx : 0),
                        b.y - pad + (_liveSub ? _liveSub.dy : 0),
                        b.w + pad * 2, b.h + pad * 2, s.kind === 'track');
    }
  }
}

// Yellow, like the overlay frame, so "selected" looks the same whatever is selected. The
// dashes are wider when the whole TRACK is selected: dragging then moves every caption, and
// that is worth a visible difference before the drag rather than after it.
function _drawCaptionFrame(ctx, x, y, w, h, whole) {
  const m = _mx();
  ctx.save();
  ctx.translate(m, m);
  ctx.strokeStyle = '#ffd000';
  ctx.lineWidth = Math.max(2, Math.round(_canvas.width * 0.005));
  ctx.setLineDash(whole ? [_hs() * 1.4, _hs() * 0.8] : [_hs() * 0.7, _hs() * 0.5]);
  ctx.strokeRect(x, y, Math.max(4, w), Math.max(4, h));
  ctx.restore();
}

// ── The control bar ─────────────────────────────────────────────────────────
const _fmt = (t) => {
  const s = Math.max(0, t), m = Math.floor(s / 60), r = s - m * 60;
  return m + ':' + (r < 10 ? '0' : '') + r.toFixed(1);
};
function _paintTime() {
  const el = document.getElementById('mv3-pv-time');
  if (el) el.textContent = _fmt(_clock) + ' / ' + _fmt(_dur());
}
function _paintPlay() {
  const b = document.getElementById('mv3-pv-play');
  if (b) { b.textContent = _playing ? '❚❚' : '▶'; b.title = _playing ? 'Pause (Space)' : 'Play (Space)'; }
}

// ── Enlarged preview ────────────────────────────────────────────────────────
// The SAME stage is moved into an overlay and moved back on close. Not a second canvas:
// a copy would need its own clock, its own video pool and its own everything, and the two
// would drift the first time one of them stuttered. One compositor, shown bigger.
let _bigWrap = null;
let _stageHome = null;

function _closeBig() {
  if (!_bigWrap) return;
  const stage = document.getElementById('mv3-stage');
  if (stage && _stageHome) _stageHome.appendChild(stage);
  _bigWrap.remove();
  _bigWrap = null;
  document.removeEventListener('keydown', _bigKey);
  _draw();
}
function _bigKey(e) { if (e.key === 'Escape') { e.preventDefault(); _closeBig(); } }

function _openBig() {
  if (_bigWrap) return _closeBig();
  const stage = document.getElementById('mv3-stage');
  if (!stage) return;
  _stageHome = stage.parentElement;
  const ov = document.createElement('div');
  ov.className = 'mv3-big';
  const box = document.createElement('div');
  box.className = 'mv3-big-box';
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'mv3-big-x';
  close.textContent = '✕';
  close.title = 'Close (Esc)';
  close.addEventListener('click', _closeBig);
  ov.appendChild(box);
  ov.appendChild(close);
  ov.addEventListener('mousedown', (e) => { if (e.target === ov) _closeBig(); });
  document.body.appendChild(ov);
  box.appendChild(stage);
  _bigWrap = ov;
  document.addEventListener('keydown', _bigKey);
  _draw();
}

export function initPreview() {
  const stage = document.getElementById('mv3-stage');
  if (!stage) return;
  stage.textContent = '';
  _canvas = document.createElement('canvas');
  _canvas.id = 'mv3-canvas';
  stage.appendChild(_canvas);
  _ctx = _canvas.getContext('2d');

  // The handle layer, inset NEGATIVELY so it hangs over every edge of the frame. The
  // preview body leaves room for it (see css/merge-v3.css).
  // Its geometry is in css/merge-v3.css - #mv3-overlay's four offsets are OVER_M
  // expressed against the stage, and the comment there shows the arithmetic. The two have
  // to agree or the handles would not sit on what they surround.
  _over = document.createElement('canvas');
  _over.id = 'mv3-overlay';
  stage.appendChild(_over);
  _octx = _over.getContext('2d');

  let saved = null;
  try { saved = parseInt(localStorage.getItem(LS_Q) || '', 10); } catch (e) {}
  _quality = QUALITIES.some(([v]) => +v === saved) ? saved : 480;
  const q = document.getElementById('mv3-pv-q');
  if (q) {
    for (const [v, label] of QUALITIES) {
      const o = document.createElement('option');
      o.value = v; o.textContent = label;
      q.appendChild(o);
    }
    q.value = String(_quality);
    q.addEventListener('change', () => {
      _quality = parseInt(q.value, 10) || 480;
      try { localStorage.setItem(LS_Q, String(_quality)); } catch (e) {}
      _applyQuality();
      _repointPool();
    });
  }
  _applyQuality();
  _wireCanvas();
  // Selecting a clip on the TIMELINE must show its frame on the preview too, and vice
  // versa - it is one selection, seen from two places.
  onSelect(() => _draw());

  const on = (id, fn) => { const b = document.getElementById(id); if (b) b.addEventListener('click', fn); };
  on('mv3-pv-big', _openBig);
  on('mv3-pv-start', () => seek(0));
  on('mv3-pv-back', () => seek(_clock - 1));
  on('mv3-pv-play', toggle);
  on('mv3-pv-fwd', () => seek(_clock + 1));

  // Scrubbing the timeline moves the preview; the preview moves the playhead while it
  // plays. One clock, two views of it - the ruler and the canvas can never disagree.
  onSeek((t) => { if (!_playing) seek(t); });
  _clock = playheadAt();

  // Leaving the tab stops playback. requestAnimationFrame does not fire in a hidden tab,
  // so _tick stops while `_baseWall` keeps its old value - come back a minute later and
  // the clock would leap a minute forward, past everything you were watching. Pausing is
  // both the honest behaviour and what the browser does to the media anyway.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && _playing) pause();
  });

  // Space plays, unless you are typing.
  document.addEventListener('keydown', (e) => {
    if (e.code !== 'Space') return;
    const t = e.target;
    if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
    e.preventDefault();
    toggle();
  });

  // A clip removed while it is on screen must not keep its element around.
  Store.onChange(() => {
    const tl = Store.timeline();
    const alive = new Set();
    if (tl) for (const k of Object.keys(tl.tracks)) for (const c of tl.tracks[k].clips) alive.add(c.id);
    for (const [id, el] of _pool) if (!alive.has(id)) { try { el.pause(); el.removeAttribute('src'); el.load(); } catch (e) {} _pool.delete(id); }
    for (const [id, el] of _music) if (!alive.has(id)) { try { el.pause(); el.removeAttribute('src'); el.load(); } catch (e) {} _music.delete(id); }
    if (_clock > _dur()) seek(_dur());
    _paintTime();
    // Pre-warm when the PROJECT changes, not on every edit. This fires on each mutate -
    // every drop, delete, drag and trim - and warming from here meant a sweep of HEAD
    // requests restarted on all of them, each one able to start a transcode on a clip whose
    // proxy is not cached yet. One opened project needs one sweep.
    const k = Store.key();
    if (k && k !== _warmedKey) { _warmedKey = k; _warmSoon(); }
  });

  _paintPlay();
  _paintTime();
  _raf = requestAnimationFrame(_tick);
}
