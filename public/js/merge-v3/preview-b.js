/* ═══════════════════════════════════════════════════════════════════════════
   MERGE v3 — the preview of a BLANK project.

   The second of two, and separate on purpose. js/merge-v3/preview.js belongs to
   projects that arrive from Scenarios: six fixed lanes, a compositing order held in
   a constant, and rules keyed off lane NAMES - the halfer band, the read on Main.
   None of that is true here, where lanes are made and destroyed by hand and their
   order is a property of the project.

   Two workflows that must not disturb each other. Nothing in this file is imported
   by the talking-head preview and nothing here writes to it, so a scenario project
   keeps working by CONSTRUCTION rather than because the change was tested and seemed
   fine. That is worth some duplicated code: when the blank timeline has proved
   itself, the talking-head half goes away entirely, and these copies end rather than
   have to be reconciled.

   LAYER ORDER COMES FROM THE PROJECT. The video lanes are listed top layer first, so
   painting runs through them backwards - main video, then whatever sits above it, in
   the order the lanes are in. The renderer for these projects will read the same list
   the same way; that is the one thing the two must agree on, or the screen and the
   file will show different pictures.

   PHASE SCOPE. The frame at the playhead: layering, stills and film, letterboxed into
   a 9:16 stage. Playback and sound come next.
   ═══════════════════════════════════════════════════════════════════════════ */

import * as Store from './store.js';
import { fxAt, hasFx, zoomRect, paintTint, paintVignette, paintVeil, gapNote } from './fx-b.js';
import { isStill } from './store.js';
import { setPlayhead } from './timeline-b.js';

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

// ── What is on screen at a moment ───────────────────────────────────────────
// Bottom layer first, which is the video lanes read backwards: the list is held top
// layer first, because that is how a timeline reads.
function _layers(tl) {
  if (!tl || !Array.isArray(tl.tracks)) return [];
  return tl.tracks.filter(t => t.kind === 'video').slice().reverse();
}

// One clip per lane - the one under the playhead. A lane may hold clips that cover one
// another; the LAST one in the lane's own order wins, matching the order the renderer
// will chain its overlays in.
function _clipAt(track, t) {
  let hit = null;
  for (const c of (track.clips || [])) {
    const s = +c.start, e = s + (+c.dur);
    if (t >= s - 0.0001 && t < e) hit = c;
  }
  return hit;
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
  return '/api/ffmpeg/preview-proxy?src=' + encodeURIComponent(src) + '&h=' + _quality()
       + (rev ? '&rev=1' : '');
}

// Keyed by reversal as well as quality: the same file forwards and backwards is two different
// downloads, and one element cannot hold both.
const _key = (src, rev) => src + '|' + (isStill({ src }) ? '' : _quality() + (rev ? '|rev' : ''));

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
function _place(sw, sh, c) {
  if (String((c && c.fit) || 'fit') !== 'fill') {
    const s = Math.min(W / sw, H / sh);
    const dw = sw * s, dh = sh * s;
    return { sx: 0, sy: 0, sw, sh, dx: (W - dw) / 2, dy: (H - dh) / 2, dw, dh };
  }
  const s = Math.max(W / sw, H / sh);
  const cw = Math.min(sw, W / s), ch = Math.min(sh, H / s);
  const a = String((c && c.cropAlign) || 'center');
  const sx = a === 'left' ? 0 : a === 'right' ? (sw - cw) : (sw - cw) / 2;
  return { sx, sy: (sh - ch) / 2, sw: cw, sh: ch, dx: 0, dy: 0, dw: W, dh: H };
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
function _blit(el, r, c, gaps) {
  if (!hasFx(c)) {
    try { _ctx.drawImage(el, r.sx, r.sy, r.sw, r.sh, r.dx, r.dy, r.dw, r.dh); } catch (e) {}
    return;
  }
  const fx = fxAt(c, _at);
  if (fx.gap) gaps.push(fx.gap);
  const z = zoomRect(r, fx.zoom);
  _ctx.save();
  // A blur reaches past the edges of what it is drawn from, so the picture is clipped to its
  // own rectangle - otherwise a blurred insert would smear over the layer beneath it.
  if (fx.css) {
    _ctx.beginPath();
    _ctx.rect(r.dx, r.dy, r.dw, r.dh);
    _ctx.clip();
    _ctx.filter = fx.css;
  }
  try { _ctx.drawImage(el, z.sx, z.sy, z.sw, z.sh, z.dx, z.dy, z.dw, z.dh); } catch (e) {}
  _ctx.restore();
  paintTint(_ctx, fx, r);
  paintVignette(_ctx, fx, r);
  // Last, over everything else this clip has been given: a fade is the final word on a frame,
  // and a grade painted after it would lift the black back out again - which is the order the
  // render uses too.
  paintVeil(_ctx, fx, r);
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

function _paint() {
  if (!_ctx) return;
  _ctx.fillStyle = '#000';
  _ctx.fillRect(0, 0, W, H);

  const tl = Store.timeline();
  const alive = new Set();
  const gaps = [];
  for (const track of _layers(tl)) {
    const c = _clipAt(track, _at);
    if (!c || !c.src) continue;
    const still = isStill({ src: c.src });
    alive.add(_key(c.src, _rev(c)));
    const el = _el(c.src, _rev(c));

    if (!still) {
      const want = _srcTime(c, _at, el.duration);

      if (_playing) {
        // LET IT PLAY. Setting currentTime every frame is scrubbing, not playing: the decoder
        // starts over on each seek and the picture crawls while the clock runs on - which is
        // exactly what a stuttering preview looks like. So the element runs on its own and is
        // only pulled back when it has genuinely drifted, which a seek every frame guarantees
        // it never gets the chance to do.
        el.playbackRate = Math.max(0.25, Math.min(4, +c.speed || 1));
        if (el.paused) el.play().catch(() => {});
        if (isFinite(want) && Math.abs((el.currentTime || 0) - want) > 0.35) {
          try { el.currentTime = Math.max(0, want); } catch (e) {}
        }
      } else {
        if (!el.paused) el.pause();
        if (isFinite(want) && Math.abs((el.currentTime || 0) - want) > 0.08) {
          try { el.currentTime = Math.max(0, want); } catch (e) {}
        }
      }
      if (!el.videoWidth) continue;               // nothing decoded yet
      _blit(el, _place(el.videoWidth, el.videoHeight, c), c, gaps);
    } else {
      if (!el.naturalWidth) continue;
      _blit(el, _place(el.naturalWidth, el.naturalHeight, c), c, gaps);
    }
  }
  _note(gapNote(gaps));
  // Off screen means off. A video left running behind the playhead keeps decoding for nothing
  // and is somewhere else entirely by the time it is needed again.
  for (const [key, el] of _media) {
    if (el.pause && !el.paused && !alive.has(key)) { try { el.pause(); } catch (e) {} }
  }
  _sweep(alive);
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
    if (isFinite(want) && Math.abs((el.currentTime || 0) - want) > 0.25) {
      try { el.currentTime = Math.max(0, want); } catch (e) {}
    }
    if (_playing && el.paused) el.play().catch(() => {});
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

export function play() {
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

export function toggle() { _playing ? pause() : play(); }

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
    Store.mutate(tl => { tl.format = FORMATS[sel.value] ? sel.value : '9:16'; });
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
  const f = FORMATS[_fmt()];
  W = f.w; H = f.h;
  if (_cv) { _cv.width = W; _cv.height = H; }
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
  const sel = document.getElementById('mv3-pvb-fmt');
  if (sel) sel.remove();
  document.body.classList.remove('mv3-fmt-169');
  _cv = null; _ctx = null;
}

export const isMounted = () => _on;

export function initPreviewB() {
  Store.onChange(() => { if (_on) { _resize(); _repaint(); _clock(); } });
  const q = document.getElementById('mv3-pv-q');
  // A new quality means new files. The old ones are dropped rather than left in the map,
  // where they would be held open for a resolution nothing is going to ask for again.
  if (q) q.addEventListener('change', () => { if (_on) { _sweep(new Set()); _repaint(); } });
}
