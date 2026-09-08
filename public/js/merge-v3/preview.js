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
import { isStill } from './store.js';
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

// Which tracks can be placed and rotated by hand on the frame. Main is the frame itself and
// is never one of them.
//
// A halfer is a band by DEFAULT - full width, two fifths of the height, feathered along its
// inner edge - and that is still what it is until somebody drags it. Dragging gives it a
// tw and from that moment it is a free-floating insert like any other, because the band
// geometry and a placement cannot both be true of the same clip.
// A halfer is NOT here any more. It is a band across the frame with a position, a thickness
// and a slice - dragging it into a free-floating rectangle was a second, unrelated shape for
// the same clip, and every setting the band has had to be hidden while it wore the other one.
const PLACEABLE = new Set(['biro', 'hook']);

const TD = 0.35;          // transition edge length, seconds
const DRIFT_TOL = 0.15;   // only hard-seek a video when it is off by more than this
// How early the next clip is loaded and seeked to its first frame. Four seconds, up from
// one and a half: over a real connection the fetch of a proxy's first second plus its decode
// did not fit in the old window, and every cut began with the last frame of the clip before
// held on screen. The elements ahead are kept small by the priming cap below, not by this.
const PREROLL = 4;
// How many clips are made ready AHEAD when a project opens or the quality changes - the ones
// nearest the playhead first. The rest load PREROLL seconds before their turn, as before. A
// cap because every primed clip is a <video> holding a decoded frame, and a timeline of a
// hundred clips must not become a hundred decoders.
const PRIME_MAX = 24;

// Named by width, which is how a vertical Reel is usually described. Height is derived
// so nothing here can drift from 9:16.
//
// These doubles as the PROXY size asked of the server, so the list has to stay a subset of
// PROXY_HEIGHTS in routes/ffmpeg.js. 540 used to be here and was not in that list: the
// server quietly served 480 instead, so the label promised a sharpness it never delivered.
// 1080 is the odd one out - it means "no proxy at all, play the original file".
const QUALITIES = [['360', '360'], ['480', '480'], ['720', '720'], ['1080', 'full']];
const FULL_Q = 1080;
const DEFAULT_Q = 480;

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

// A Main clip imported before its lipsync exists is a READ plus the fragment's first frame:
// its source is an mp3 and its picture is a JPEG. So what gets drawn is sometimes an <img>,
// and an <img> measures itself with naturalWidth. Everything that scales, covers or places a
// source asks through these two rather than reading videoWidth and getting 0 for a picture
// that is perfectly well loaded.
const _w = (v) => (v && (v.videoWidth || v.naturalWidth)) || 0;
const _h = (v) => (v && (v.videoHeight || v.naturalHeight)) || 0;
// Poster images, one per clip that has one. Kept beside the pool rather than in it: the
// pool element is still needed for that clip - it is what plays the voice.
const _posters = new Map();
function _poster(c) {
  if (!c.poster) return null;
  let img = _posters.get(c.id);
  if (!img) { img = new Image(); img.src = c.poster; _posters.set(c.id, img); }
  return img;
}
// What to DRAW for a clip: its still if it has one, otherwise its own moving picture.
const _pic = (c) => (c.poster ? _poster(c) : _pool.get(c.id));

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
  _prepareSoon(true);
}

// PREPARING THE PREVIEW, and saying so on the stage until it is.
//
// Two things used to make the first play after opening a project stutter. The proxy
// endpoint transcodes on the first request and only answers when it is done, so a clip whose
// proxy was not cached froze the picture for the length of its transcode; and nothing was
// loaded at all until the playhead was a second and a half from a clip, so every cut began
// with a fetch and a decode.
//
// So a project is PREPARED before it plays, in two steps, with a box on the stage counting
// each in. First the proxies: the server is asked which of the project's films have one
// (/ffmpeg/proxy-status), and the ones that do not are asked for one at a time with a HEAD,
// which puts each at the front of the server's queue and answers when the file exists.
// Then the frames: each clip's element is created and seeked to its first frame - the Main
// lane first, because it is the one that must never run dry, then the rest nearest the
// playhead - six at a time, which is how many connections the browser gives one host; a
// stack of twenty-four downloads at once was starving the one the Main lane needed and its
// sound went with it. Play is disabled until both steps are done, with "play anyway" for
// whoever would rather not wait. A newer project or quality abandons the pass in progress.
//
// Edits do not gate: a clip dropped on a lane is prepared in the background the same way.
const PRIME_WINDOW = 6;
let _warmTok = 0, _warmT = null, _warmedKey = null;
let _ready = true, _override = false;

function _gate(show, frac, text) {
  const g = document.getElementById('mv3-pv-gate');
  if (g) {
    g.hidden = !show;
    if (show) {
      const bar = g.querySelector('s'); if (bar) bar.style.width = Math.round(Math.max(0, Math.min(1, frac || 0)) * 100) + '%';
      const t = g.querySelector('span'); if (t) t.textContent = text || '';
    }
  }
  const b = document.getElementById('mv3-pv-play');
  if (b) { b.disabled = show && !_override; b.title = b.disabled ? 'Preparing the preview…' : 'Play (Space)'; }
}
function _prepareSoon(gated) { clearTimeout(_warmT); _warmT = setTimeout(() => _prepare(gated), gated ? 100 : 1000); }

// Settles when the element has a frame to draw, or has refused, or has taken too long -
// each of which is the end of waiting for it.
function _whenReady(el, ms) {
  return new Promise(resolve => {
    if (el.readyState >= 2) return resolve(true);
    let t = null;
    const done = (ok) => { clearTimeout(t); el.removeEventListener('loadeddata', onOk); el.removeEventListener('error', onErr); resolve(ok); };
    const onOk = () => done(true), onErr = () => done(false);
    t = setTimeout(() => done(false), ms);
    el.addEventListener('loadeddata', onOk);
    el.addEventListener('error', onErr);
  });
}

async function _prepare(gated) {
  const tok = ++_warmTok;
  const tl = Store.timeline();
  if (!tl) { _ready = true; _gate(false); return; }
  const jobs = [];
  for (const scope of DRAW_ORDER) {
    if (scope === 'music') continue;
    const tr = tl.tracks[scope];
    if (!tr) continue;
    for (const c of (tr.clips || [])) {
      // A still has no proxy - _srcFor hands back the original - and its <img> is fetched
      // the moment it is drawn; nothing to warm and nothing to prime. A VSL source is
      // hour-long and served as the original: a HEAD is harmless, an element with preload
      // on would pull the whole hour, so it is warmed and not primed.
      if (!c.src || isStill(c)) continue;
      jobs.push({ at: +c.start || 0, scope, c, url: _srcFor(scope, c), vsl: String(c.src).indexOf('/vsl/') === 0 });
    }
  }
  // Main first, then the rest; within each, nearest the playhead first.
  jobs.sort((a, b) => {
    const am = a.scope === 'seg', bm = b.scope === 'seg';
    if (am !== bm) return am ? -1 : 1;
    return Math.abs(a.at - _clock) - Math.abs(b.at - _clock);
  });
  const toPrime = jobs.filter(j => !j.vsl && !_pool.has(j.c.id)).slice(0, PRIME_MAX);
  const srcs = [...new Set(jobs.map(j => j.c.src))];
  const st = { proxies: 0, proxiesTotal: 0, frames: 0, framesTotal: toPrime.length };
  if (gated) { _ready = false; _override = false; }
  const paint = () => {
    if (tok !== _warmTok || !gated) return;
    const total = st.proxiesTotal + st.framesTotal, done = st.proxies + st.frames;
    _gate(true, total ? done / total : 1, 'proxies ' + st.proxies + '/' + st.proxiesTotal + ' · frames ' + st.frames + '/' + st.framesTotal);
  };
  paint();

  // 1. The proxies, on the server. At full quality there are none to make.
  if (_quality < FULL_Q && srcs.length) {
    let status = {};
    try {
      const d = await fetch('/api/ffmpeg/proxy-status?h=' + _quality + '&srcs=' + encodeURIComponent(JSON.stringify(srcs))).then(r => r.json());
      status = (d && d.status) || {};
    } catch (e) { status = {}; }
    if (tok !== _warmTok) return;
    const need = srcs.filter(x => status[x] !== 'skip');
    st.proxiesTotal = need.length;
    st.proxies = need.filter(x => status[x] === 'ready').length;
    paint();
    for (const x of need) {
      if (status[x] === 'ready') continue;
      const j = jobs.find(y => y.c.src === x);
      try { await fetch(j.url, { method: 'HEAD' }); } catch (e) {}
      if (tok !== _warmTok) return;
      st.proxies++;
      paint();
    }
  }

  // 2. The frames: the elements, PRIME_WINDOW at a time, in the order above.
  let i = 0;
  const worker = async () => {
    while (i < toPrime.length) {
      const j = toPrime[i++];
      if (tok !== _warmTok) return;
      const el = _element(j.scope, j.c);
      try { el.currentTime = Math.max(0, +j.c.trimIn || 0); el.__fresh = false; } catch (e) {}
      await _whenReady(el, 20000);
      if (tok !== _warmTok) return;
      st.frames++;
      paint();
    }
  };
  await Promise.all(Array.from({ length: Math.min(PRIME_WINDOW, toPrime.length) }, worker));
  if (tok !== _warmTok) return;
  _ready = true;
  _gate(false);
}
// Frame pixels -> overlay pixels.
const _mx = () => Math.round(_canvas.width * OVER_M);

// ── The clock ───────────────────────────────────────────────────────────────
function _now() { return performance.now() / 1000; }

export function seek(t) {
  // Not ours while the other preview holds the stage: the transport buttons are shared
  // hardware, and both previews listening to them would drive two clocks at once.
  if (!_mounted) return;
  _clock = Math.max(0, Math.min(_dur() || 0, t));
  _baseWall = _now(); _baseClock = _clock;
  // THE MARKER MOVES TOO. Until now it only followed during playback - _tick set it and
  // nothing else did - so every transport button changed the picture and the time readout
  // while the playhead stayed where it was. It showed up worst on "back to the start",
  // where the jump is biggest, but all of them did it.
  //
  // setPlayhead and not the timeline's own seek(): that one notifies its subscribers, and
  // this module is one of them, so it would come straight back here in a loop. This is the
  // paint-only half, which is exactly what is wanted.
  setPlayhead(_clock);
  _syncSources(true);
  _draw();
  _paintTime();
}

// ── A frame, saved ──────────────────────────────────────────────────────────
// The canvas composites at the PREVIEW resolution, which is 360, 480 or 720 - so a shot
// taken as-is would be a picture of the proxy rather than of the cut. Full quality is
// switched on for the length of the capture and put back afterwards: a second or two of
// waiting for the originals to decode, in exchange for a 1080-wide frame.
//
// The switch does not touch the remembered setting. It is a moment, not a preference.
let _shooting = false;

// Is every source under the playhead ready to be drawn? Same test the frame loop uses, but
// asking for ALL of them rather than any: a shot with one lane still decoding is a shot with
// a hole in it.
function _allDrawn() {
  const live = _activeClips().filter(x => x.scope !== 'music');
  if (!live.length) return true;
  return live.every(x => {
    const v = _pic(x.c);
    return v && _w(v) && (x.c.poster || isStill(x.c) || v.readyState >= 2);
  });
}

function _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ONE sync, then wait. Re-syncing on every poll set currentTime on elements that were
// still loading, and a fresh seek restarts the one in progress - so a big source could be
// kept from ever becoming ready by the very loop waiting for it.
async function _awaitFrame(ms) {
  _syncSources(true);
  const until = _now() + ms / 1000;
  while (!_allDrawn() && _now() < until) await _sleep(120);
  return _allDrawn();
}

// Returns { ok, blob, full, w, h } - `full` says whether the frame came off the originals
// or off the proxies.
//
// COMPLETENESS BEATS RESOLUTION. _draw rebuilds its buffer as soon as ANY layer is ready and
// skips the rest, which is right for playback - a decode gap should not blank the frame -
// and wrong for a still capture: it saves a picture with a lane missing. So if the originals
// have not all arrived by the deadline, this goes back to the preview quality, where the
// proxies are already loaded, and takes a complete frame there instead of a broken 1080 one.
export async function grabFrame(ms = 12000) {
  const wasQ = _quality, wasPlaying = _playing;
  if (wasPlaying) pause();
  let full = false;
  try {
    if (wasQ < FULL_Q) {
      _quality = FULL_Q;
      _applyQuality();
      _repointPool();          // elements keep the src they were made with - see its note
      full = await _awaitFrame(ms);
      if (!full) {
        _quality = wasQ;
        _applyQuality();
        _repointPool();
        await _awaitFrame(6000);
      }
    } else {
      full = await _awaitFrame(3000);
    }
    _shooting = true;
    _draw();
    const blob = await new Promise(res => { try { _canvas.toBlob(res, 'image/png'); } catch (e) { res(null); } });
    return { ok: !!blob, blob, full, w: _canvas.width, h: _canvas.height };
  } finally {
    _shooting = false;
    if (_quality !== wasQ) { _quality = wasQ; _applyQuality(); _repointPool(); }
    _draw();
  }
}

// The button: capture, file it, and show where it went. Locked while it runs - the capture
// switches the whole preview to full quality, so a second press mid-flight would fight the
// first over what the resolution should be put back to.
async function _shoot() {
  const btn = document.getElementById('mv3-pv-shot');
  if (!btn || btn.disabled) return;
  const was = btn.textContent;
  btn.disabled = true;
  btn.textContent = '…';
  try {
    const r = await grabFrame();
    if (!r.ok) throw new Error('the frame could not be read');
    const fd = new FormData();
    fd.append('image', r.blob, 'shot.png');
    const proj = document.getElementById('mv3-project');
    const title = (proj && proj.selectedOptions[0] && proj.selectedOptions[0].textContent) || '';
    fd.append('name', (title.split('·')[0].trim() || 'shot') + ' ' + _fmt(_clock));
    fd.append('project', title);
    fd.append('at', String(_clock));
    const d = await fetch('/api/images/shot', { method: 'POST', body: fd }).then(x => x.json());
    if (!d || !d.success) throw new Error((d && d.error) || 'the server would not take it');
    btn.textContent = '✓';
    // Show where it landed rather than saying it: the panel opens on the group and the
    // category the server filed it under, with the new shot first because that shelf sorts
    // newest first.
    try { const L = await import('./library.js'); await L.showGroup('images', 'Screenshots'); } catch (e) {}
    if (!r.full) {
      // Honest about the fallback: every lane is in the picture, but it came off the
      // proxies, so it is preview-sized rather than 1080.
      btn.title = 'Saved at preview size (' + r.w + '×' + r.h + ') - the full-size sources did not load in time';
    }
  } catch (e) {
    btn.textContent = '✕';
    btn.title = 'Could not save the frame: ' + e.message;
  } finally {
    setTimeout(() => {
      btn.textContent = was;
      btn.title = 'Save this frame to the library (Images / Screenshots)';
      btn.disabled = false;
    }, 1400);
  }
}

// ── Fragment to fragment ────────────────────────────────────────────────────
// The steps are MAIN's clips and nothing else. Main is the cut - the fragments are the
// thing you are moving between - and reading the selected lane instead would make one
// button mean different distances depending on what happened to be selected.
//
// Going back lands on the start of the clip you are inside, which is what "previous" means
// with a playhead in the middle of something; press it again and you reach the one before.
const _EDGE = 0.02;   // a playhead sitting exactly on a boundary must still be able to leave it

function _mainStarts() {
  const tl = Store.timeline();
  const clips = (tl && tl.tracks.seg.clips) || [];
  return clips.map(c => +c.start || 0).sort((a, b) => a - b);
}

function _end() {
  const tl = Store.timeline();
  const clips = (tl && tl.tracks.seg.clips) || [];
  return clips.reduce((m, c) => Math.max(m, (+c.start || 0) + (+c.dur || 0)), 0);
}

export function stepFragment(dir) {
  // Not ours while the other preview holds the stage: the transport buttons are shared
  // hardware, and both previews listening to them would drive two clocks at once.
  if (!_mounted) return;
  const starts = _mainStarts();
  if (dir > 0) {
    const next = starts.find(s => s > _clock + _EDGE);
    // Past the last fragment there is still somewhere meaningful to be: the end of the cut.
    seek(next != null ? next : (_end() || _clock));
    return;
  }
  const prev = [...starts].reverse().find(s => s < _clock - _EDGE);
  seek(prev != null ? prev : 0);
}

// The ruler (or a lane) is being held - a scrub in progress. The timeline marks the body
// for the length of the press, and while it lasts the clock stands still and the media
// waits: the picture follows the mouse, the sound does not run ahead of it, and on release
// playback resumes from the last moment the mouse pointed at.
const _held = () => document.body.classList.contains('mv3-scrubbing');

function _tick() {
  if (_playing) {
    if (_held()) { _baseWall = _now(); _baseClock = _clock; }
    else {
      _clock = _baseClock + (_now() - _baseWall);
      const end = _dur();
      if (end > 0 && _clock >= end) { _clock = end; pause(); }
      setPlayhead(_clock);          // visual only - it must not call back into here
    }
  }
  _syncSources(false);
  _draw();
  _paintTime();
  _raf = requestAnimationFrame(_tick);
}

export function play() {
  // Not ours while the other preview holds the stage: the transport buttons are shared
  // hardware, and both previews listening to them would drive two clocks at once.
  if (!_mounted) return;
  if (_playing) return;
  if (_dur() <= 0) return;
  // Not before the project is prepared - the box on the stage says how far along that is -
  // unless "play anyway" was pressed.
  if (!_ready && !_override) return;
  // A context created before any gesture starts suspended, and everything routed through it
  // would be silent. Resumed here because pressing play IS the gesture.
  if (_actx && _actx.state === 'suspended') { try { _actx.resume(); } catch (e) {} }
  if (_clock >= _dur()) _clock = 0;
  _playing = true;
  _baseWall = _now(); _baseClock = _clock;
  _paintPlay();
}
export function pause() {
  // Not ours while the other preview holds the stage: the transport buttons are shared
  // hardware, and both previews listening to them would drive two clocks at once.
  if (!_mounted) return;
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


// What the preview actually LOADS, as opposed to how big it is drawn. The quality picker
// used to resize the canvas and nothing else, so every clip was still decoded at the source
// 1080x1920 and playback stuttered exactly as much at 360 as at full - decode is the
// expensive part, not rasterisation. The server already keeps a cached low-res transcode
// for this (routes/ffmpeg.js, /ffmpeg/preview-proxy), so that is where the picker bites.
// Music keeps the original: there is no picture to shrink. The endpoint falls back to the
// original by itself for /vsl/ sources (hour-long, transcoding them would stall) and on any
// transcode failure, so a proxy URL is never a dead end.
function _srcFor(scope, c) {
  // A clip with a poster has an mp3 for a source. There is no picture in it to shrink, and
  // asking the proxy to transcode one would be a minute of ffmpeg for nothing. A still is
  // the same case for the same reason - the proxy transcodes video, and would be handed a
  // PNG it cannot read.
  //
  // A REVERSED clip is the exception to the full-quality bypass. Browsers cannot play
  // backwards - negative playbackRate is in the spec and implemented nowhere - so the only
  // way to show one is to be handed a file that is already reversed. The proxy has been able
  // to do that since it was written (rev=1 runs `reverse` and `areverse`, the same filters
  // the render uses) and nothing ever asked. Asking now, even at full quality, because a
  // slightly softer picture is a far smaller lie than a clip running the wrong way.
  const rev = !!c.reversed && !c.poster && !isStill(c) && scope !== 'music';
  if (!c.src || scope === 'music' || c.poster || isStill(c) || (_quality >= FULL_Q && !rev)) return c.src;
  const h = _quality >= FULL_Q ? 720 : _quality;
  return '/api/ffmpeg/preview-proxy?src=' + encodeURIComponent(c.src) + '&h=' + h + (rev ? '&rev=1' : '');
}

// Is this element actually holding a reversed proxy? Read off the src it was given rather
// than tracked separately, so the two cannot disagree.
const _isRevSrc = (el) => !!(el && el.src && el.src.indexOf('rev=1') >= 0);

// ── Gain, because a media element cannot be turned up ───────────────────────
// HTMLMediaElement.volume is defined over 0..1. Anything above 1 is clamped, so the panel
// could ask for +12 dB and the preview would play it at exactly the same level as 0 dB -
// the control appeared dead while doing precisely what it was told.
//
// ffmpeg has no such ceiling, so the render was already louder than the preview whenever a
// clip was pushed past unity. Routing each element through a GainNode removes the ceiling
// and makes the two agree.
//
// One source node per element, forever: createMediaElementSource can only be called once for
// a given element, and calling it twice throws. The pool reuses elements across clips, so
// the node is remembered against the element rather than the clip.
let _actx = null;
const _gains = new WeakMap();

function _gainFor(el) {
  if (_gains.has(el)) return _gains.get(el);
  let g = null;
  try {
    if (!_actx) _actx = new (window.AudioContext || window.webkitAudioContext)();
    const src = _actx.createMediaElementSource(el);
    g = _actx.createGain();
    src.connect(g).connect(_actx.destination);
  } catch (e) {
    // No Web Audio, or an element that cannot be routed. Remembered as null so this is not
    // retried on every frame - and the caller falls back to the clamped element volume,
    // which is the old behaviour rather than silence.
    g = null;
  }
  _gains.set(el, g);
  return g;
}

function _element(scope, c) {
  const map = scope === 'music' ? _music : _pool;
  let el = map.get(c.id);
  // An element already in the pool keeps whatever src it was made with, and ticking
  // `reversed` changes which file it should be holding. _repointPool exists for the same
  // reason on a quality switch, but it drops every element to fix one - here the mismatch is
  // per clip, so only the clip that changed is re-pointed.
  if (el && !isStill(c) && scope !== 'music') {
    const want = _srcFor(scope, c);
    if (el.__src !== want) {
      el.__src = want;
      try { el.pause(); el.src = want; el.load(); } catch (e) {}
    }
  }
  if (!el) {
    // A still is an <img>. Handed to a <video> it fires an error and draws nothing, which
    // is what a picture on a lane used to do. It goes in the same pool because _pic() reads
    // from there, and _w/_h already ask naturalWidth before videoWidth.
    if (isStill(c)) { el = new Image(); el.src = c.src; map.set(c.id, el); return el; }
    el = scope === 'music' ? new Audio() : document.createElement('video');
    el.preload = 'auto';
    el.playsInline = true;
    el.src = _srcFor(scope, c);
    el.__src = el.getAttribute('src');
    // Never seeked yet. The first seek must land whatever state the element is in - see
    // the busy rule in _syncSources - and this is how the sync knows it is the first.
    el.__fresh = true;
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

  // Playing, and not held on the ruler: what the media should be doing right now.
  const run = _playing && !_held();

  // PRE-ROLL. The other half of the flicker fix: the clip that is about to start is created
  // and seeked to its first frame slightly BEFORE its turn, so by the time the playhead
  // reaches it there is a frame to draw. Without this every cut begins with a decode.
  if (run && tl) {
    for (const scope of DRAW_ORDER) {
      const tr = tl.tracks[scope];
      if (!tr) continue;
      for (const c of (tr.clips || [])) {
        const lead = c.start - _clock;
        if (lead > 0 && lead <= PREROLL && !_pool.has(c.id)) {
          const el = _element(scope, c);
          // Creating it IS the pre-roll for a still - the fetch and decode are the whole cost,
          // and there is no frame to seek to.
          if (!isStill(c)) { try { el.currentTime = Math.max(0, +c.trimIn || 0); el.__fresh = false; } catch (e) {} }
        }
      }
    }
  }

  for (const { scope, c, track } of live) {
    const el = _element(scope, c);
    // Nothing below applies to a picture: it has no clock to keep in step, no rate, and no
    // sound. Left to run, el.play() is not even a function on an Image and the whole sync
    // pass would throw on the first still under the playhead.
    if (isStill(c)) continue;
    const speed = +c.speed || 1;
    // Where in the FILE the playhead is. Straightforward forwards; the other way round when
    // the element is holding a pre-reversed proxy.
    //
    // The proxy is the whole source reversed, so the window this clip uses - [trimIn,
    // trimIn + dur*speed] of the source - lands at the far end of it, and plays FORWARD from
    // there. Which is also what the render does: it trims first and reverses the trimmed
    // piece, so both start from the last frame of the window.
    //
    // srcDur is the anchor and a clip dropped before its length was known can carry 0. The
    // element's own duration answers once it has loaded; until something does, this stays
    // forward rather than seeking to a negative time.
    const revPlay = !!c.reversed && !isStill(c);
    const srcDur = (+c.srcDur > 0) ? +c.srcDur : (isFinite(el.duration) ? el.duration : 0);
    const want = (revPlay && srcDur > 0)
      ? Math.max(0, srcDur - (+c.trimIn || 0) - (+c.dur || 0) * speed) + (_clock - c.start) * speed
      : (+c.trimIn || 0) + (_clock - c.start) * speed;

    try { el.playbackRate = Math.max(0.25, Math.min(4, speed)); } catch (e) {}
    // Silence is volume 0, nothing else. Still setting `muted` at zero because a video
    // element at volume 0 is not guaranteed to stop decoding audio, and muted is.
    // times the import's levelling, so the editor does not lie about its own audio: what
    // this plays is what the render writes.
    // clip x track, the same product the export builds, times the import's levelling.
    const vol = ((c.volume != null) ? +c.volume : VOLUME_BY_DEFAULT[scope])
      * ((track && track.volume != null) ? +track.volume : 1)
      * Math.pow(10, (+c.gainDb || 0) / 20);
    el.muted = !(vol > 0);
    const gain = _gainFor(el);
    if (gain) {
      // The element stays at unity and the gain node carries the level, so anything above
      // 0 dB is actually heard instead of being clamped away.
      try { el.volume = 1; } catch (e) {}
      gain.gain.value = Math.max(0, vol);
    } else {
      try { el.volume = Math.max(0, Math.min(1, vol)); } catch (e) {}
    }

    // A SEEK IN FLIGHT IS NOT A DRIFT. While an element is still fetching or decoding, its
    // time stands still and the clock runs on, so the two drift apart within a few frames -
    // and setting currentTime again cancels the load it was doing and starts it over. Sixty
    // times a second, that kept a loading clip from ever loading: the freeze at a cold cut,
    // and the stutter after opening a project. So a drift correction waits for the element
    // to be ready and not mid-seek. A hard seek (the person moved the playhead) and the very
    // first seek of a new element always land - those are not corrections.
    const busy = !hard && !el.__fresh && (el.seeking || el.readyState < 2);
    if (!busy && (hard || el.__fresh || !isFinite(el.currentTime) || Math.abs(el.currentTime - want) > DRIFT_TOL)) {
      try { el.currentTime = Math.max(0, want); } catch (e) {}
      el.__fresh = false;
    }
    // play() once per pause, not once per frame: `paused` stays true for as long as the
    // element is loading, and a fresh play() every frame is a fresh promise every frame.
    if (run) { if (el.paused && !el.__playReq) el.__playReq = el.play().catch(() => {}).finally(() => { el.__playReq = null; }); }
    else if (!el.paused) { try { el.pause(); } catch (e) {} }
  }
}

// ── Drawing ─────────────────────────────────────────────────────────────────
// Cover-scale a source into the frame, aligned, with an optional zoom. "Cover" because
// a Reel frame must be filled: letterboxing a 16:9 birol into 9:16 would show bars the
// export does not have.
function _cover(ctx, v, cw, ch, align, zoom) {
  const vw = _w(v), vh = _h(v);
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
  const vw = _w(v) || 9, vh = _h(v) || 16;
  return { x: (+c.tx || 0) * cw, y: (+c.ty || 0) * ch, w, h: w * (vh / vw), full: false };
}
const _angleOf = (c) => (+c.angle || 0) * Math.PI / 180;

// Soft edges, drawn the way a canvas can do it: the insert goes onto a scratch surface of
// its own, then four gradients are erased inward from the sides with destination-out. Done
// on the main canvas the same gradients would eat the frame underneath as well.
//
// The scratch canvas is kept and resized rather than made per frame - one allocation per
// resize instead of thirty a second.
let _fbuf = null, _fctx = null;

function _featherInto(v, w, h, fr) {
  if (!_fbuf) { _fbuf = document.createElement('canvas'); _fctx = _fbuf.getContext('2d'); }
  const W = Math.max(1, Math.round(w)), H = Math.max(1, Math.round(h));
  if (_fbuf.width !== W || _fbuf.height !== H) { _fbuf.width = W; _fbuf.height = H; }
  _fctx.clearRect(0, 0, W, H);
  try { _fctx.drawImage(v, 0, 0, W, H); } catch (e) { return null; }
  // A fraction of the SHORTER side, the same rule the render uses, so the two agree about
  // what a given number means.
  const d = Math.max(1, Math.round(fr * Math.min(W, H)));
  _fctx.save();
  _fctx.globalCompositeOperation = 'destination-out';
  const ramp = (x0, y0, x1, y1) => {
    const g = _fctx.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, 'rgba(0,0,0,1)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    return g;
  };
  _fctx.fillStyle = ramp(0, 0, d, 0);         _fctx.fillRect(0, 0, d, H);
  _fctx.fillStyle = ramp(W, 0, W - d, 0);     _fctx.fillRect(W - d, 0, d, H);
  _fctx.fillStyle = ramp(0, 0, 0, d);         _fctx.fillRect(0, 0, W, d);
  _fctx.fillStyle = ramp(0, H, 0, H - d);     _fctx.fillRect(0, H - d, W, d);
  _fctx.restore();
  return _fbuf;
}

// Picture-in-picture: the clip scaled into its rect and rotated about its centre. Fades
// apply as opacity, since an overlay would darken the frame behind it too.
function _drawPiP(ctx, v, cw, ch, c) {
  const f = _fx(c);
  const r = _rect(c, cw, ch, v);
  const fade = (c.transition === 'fade' || c.transition === 'fadewhite' || c.transition === 'flash-white');
  const css = _cssFilter(c.filter);
  const filterStr = ((css ? css + ' ' : '') + (f.blur > 0.25 ? 'blur(' + f.blur.toFixed(1) + 'px)' : '')).trim();
  const fr = Math.max(0, Math.min(0.45, +c.feather || 0));
  const src = fr > 0.001 ? _featherInto(v, r.w, r.h, fr) : null;
  ctx.save();
  if (fade) ctx.globalAlpha = Math.max(0, Math.min(1, f.edge));
  if (filterStr) ctx.filter = filterStr;
  const a = _angleOf(c);
  if (a) { ctx.translate(r.x + r.w / 2, r.y + r.h / 2); ctx.rotate(a); ctx.translate(-r.w / 2, -r.h / 2); }
  else ctx.translate(r.x, r.y);
  try { ctx.drawImage(src || v, 0, 0, r.w, r.h); } catch (e) {}
  ctx.restore();
}

// Halfer: the source rotated (0/90/180/270, 90 by default) and stretched across a band
// of 2/5 of the frame height, top or bottom.
// Percentages, read with the old top/bottom words as their defaults so a project written
// before this draws exactly as it did.
function _hpct(v, dflt) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : dflt;
}

// A scratch canvas the band is assembled in, kept between frames so a redraw is not an
// allocation. Sized to the band, so it is small.
let _bandCv = null;
function _bandBuf(w, h) {
  if (!_bandCv) _bandCv = document.createElement('canvas');
  if (_bandCv.width !== w || _bandCv.height !== h) { _bandCv.width = w; _bandCv.height = h; }
  else _bandCv.getContext('2d').clearRect(0, 0, w, h);
  return _bandCv;
}

function _drawHalfer(ctx, v, cw, ch, c) {
  const bandH = Math.max(2, Math.round(ch * _hpct(c.halferThick, 40) / 100));
  // 100 against the top edge, 0 against the bottom - the same arithmetic the renderer does.
  const pos = _hpct(c.halferPos, c.halferAlign === 'bottom' ? 0 : 100) / 100;
  const top = Math.round((ch - bandH) * (1 - pos));
  const rot = c.rotation == null ? 90 : +c.rotation;
  const f = _fx(c);
  const css = _cssFilter(c.filter);

  // THE BAND IS ASSEMBLED OFF TO ONE SIDE FIRST, and this is why: fading an edge means
  // erasing part of what was drawn, and erasing straight onto the frame would cut a hole
  // through the film underneath instead of letting it show through. The preview never drew
  // the feather at all before, so a soft edge was a thing you could only see after a render.
  const soft = c.feather == null ? 0.03 : Math.max(0, Math.min(0.4, +c.feather || 0));
  const fade = Math.round(bandH * soft);
  // Only the edges facing INTO the frame: one when the band is parked against an edge, both
  // while it floats. Same rule as the renderer's.
  const softTop = fade > 0 && top > 0;
  const softBot = fade > 0 && top + bandH < ch;

  const buf = _bandBuf(cw, bandH);
  const g = buf.getContext('2d');
  g.save();
  if (css) g.filter = css;
  g.translate(cw / 2, bandH / 2);
  g.rotate(rot * Math.PI / 180);
  const swapped = (rot === 90 || rot === 270);
  const w = swapped ? bandH : cw, h = swapped ? cw : bandH;
  // COVER at every angle, as the renderer does. The crop always runs along the y axis of THIS
  // rotated space - at 0/180 that is the screen's vertical, and at 90/270 the box is turned
  // with the content, so the same axis is the screen's horizontal.
  const vw = _w(v) || 1, vh = _h(v) || 1;
  const sc = Math.max(w / vw, h / vh);
  const dw = vw * sc, dh = vh * sc;
  const keep = _hpct(c.halferKeep, c.valign === 'bottom' ? 0 : 100) / 100;
  // Which end of the overflow the slice is measured from. 0/180 count down from the top; 90
  // turns the screen's left-to-right the other way round, 270 does not.
  const t = (rot === 0 || rot === 180) ? 1 - keep : (rot === 90 ? 1 - keep : keep);
  const dy = -h / 2 - Math.max(0, dh - h) * t;
  try { g.drawImage(v, -w / 2, dy, dw, dh); } catch (e) {}
  g.restore();

  if (f.overlay && f.overlay[1] > 0.01) {
    g.save();
    g.globalAlpha = Math.min(1, f.overlay[1]);
    g.fillStyle = f.overlay[0];
    g.fillRect(0, 0, cw, bandH);
    g.restore();
  }

  if (softTop || softBot) {
    g.save();
    g.globalCompositeOperation = 'destination-out';
    const ramp = (y0, y1) => {
      const grd = g.createLinearGradient(0, y0, 0, y1);
      grd.addColorStop(0, 'rgba(0,0,0,1)');
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      return grd;
    };
    if (softTop) { g.fillStyle = ramp(0, fade); g.fillRect(0, 0, cw, fade); }
    if (softBot) { g.fillStyle = ramp(bandH, bandH - fade); g.fillRect(0, bandH - fade, cw, fade); }
    g.restore();
  }

  ctx.drawImage(buf, 0, top);
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
  return { scope: sel.scope, c, track: tr };
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
// The clip as it should be DRAWN: the live drag geometry if it is the one being dragged,
// and its effects resolved against the track.
//
// The fallback matters because the renderer has it and this did not. Choosing an effect on
// a track name stamps it onto every clip there (see _stamp in inspector.js), so the two
// agreed for everything already on the lane - but a clip dropped AFTERWARDS arrives with
// nothing set, and then the export applied the track's value while the preview showed a
// clip with no effect at all. Same rule in both places now: the clip's own value, or the
// track's, or none.
function _withLive(c, track) {
  const fx = {
    transition: c.transition != null ? c.transition : ((track && track.transition) || 'none'),
    animation:  c.animation  != null ? c.animation  : ((track && track.animation)  || 'none'),
    filter:     c.filter     != null ? c.filter     : ((track && track.filter)     || 'none'),
  };
  if (!_live || _live.id !== c.id) return { ...c, ...fx };
  return { ...c, ...fx, tx: _live.tx, ty: _live.ty, tw: _live.tw, angle: _live.angle };
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

// Two previews draw into one stage, and exactly one of them may hold it at a time. The
// dispatcher in main.js decides which; neither module guesses, and neither knows the other
// exists beyond these three lines. A blank project is drawn by preview-b.js.
let _mounted = true;
// Rebuilds its canvases if the other preview took the stage while this one was away.
// BOTH of them. Putting only the frame back left the handle layer detached for the rest of
// the session, and with it every selection frame: an overlay could be clicked on the
// timeline and nothing appeared on the picture to grab. It cost nothing to lose and
// everything to notice, because the frame canvas keeps drawing perfectly well without it.
export function mount() {
  _mounted = true;
  const stage = document.getElementById('mv3-stage');
  if (stage && _canvas && !stage.contains(_canvas)) {
    stage.textContent = '';
    stage.appendChild(_canvas);
    // Order matters: the handles are laid OVER the frame, and the stage stacks by document
    // order. Re-sized too, because the other preview may have left the stage a different
    // shape and the overlay's geometry is derived from the frame's.
    if (_over) { stage.appendChild(_over); _applyQuality(); }
  }
  _draw();
}
export function unmount() { _mounted = false; _gate(false); }

function _draw() {
  if (!_mounted) return;
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
  // A still counts as drawable the moment it has decoded: it has no readyState to wait on,
  // and without it a timeline of stills never cleared the buffer and drew nothing at all.
  const drawable = live.filter(x => x.scope !== 'music')
    .some(x => { const v = _pic(x.c); return v && _w(v) && (x.c.poster || isStill(x.c) || v.readyState >= 2); });

  let reversed = 0;
  if (drawable || !live.length) {
    _bctx.clearRect(0, 0, cw, ch);
    _bctx.fillStyle = '#000';
    _bctx.fillRect(0, 0, cw, ch);
    for (const scope of DRAW_ORDER) {
      for (const item of live.filter(x => x.scope === scope)) {
        const c = _withLive(item.c, item.track);
        const v = _pic(c);
        if (!v || !_w(v)) continue;
        // Counted only while the pre-reversed proxy is not what is on screen yet: the first
        // moment a clip is ticked reversed, the transcode has not happened and the element is
        // still holding the forward file. Saying so then is the honest thing; saying it once
        // the proxy has arrived would be the panel calling itself a liar for no reason.
        if (c.reversed && !_isRevSrc(v)) reversed++;
        // A halfer is a band until it has been placed. Once it has a tw it is a rectangle
        // on the frame, and the band's feather and full width would both be lies.
        if (scope === 'halfer' && c.tw == null) _drawHalfer(_bctx, v, cw, ch, c);
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

  // Said on the frame rather than left as a silent difference from the export. Not while a
  // screenshot is being taken: it is a note to the person watching, not part of the picture,
  // and a saved frame with it burnt in is a saved frame nobody wants.
  if (reversed && !_shooting) _badge(_ctx, cw, ch, '⟲ reverse is not previewed');

  // The selection frame goes on the overlay, which is wider than the frame - that is the
  // only way its handles survive being dragged past an edge.
  if (_octx && _over) {
    _octx.clearRect(0, 0, _over.width, _over.height);
    const sel = _selectedLive();
    if (sel) {
      const c = _withLive(sel.c, sel.track);
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
  // The clock and the play button are shared with the other preview, so this must not write
  // to them while that one holds the stage: it would post its own playhead - still at zero -
  // over the one the person is actually watching.
  if (!_mounted) return;
  const el = document.getElementById('mv3-pv-time');
  if (el) el.textContent = _fmt(_clock) + ' / ' + _fmt(_dur());
}
function _paintPlay() {
  if (!_mounted) return;
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

  // 480 for every project that opens - not remembered. The picker is for looking closer
  // at one cut, and a 720 left on from yesterday makes the next project open slow for no
  // reason anybody can see.
  _quality = DEFAULT_Q;
  const q = document.getElementById('mv3-pv-q');
  if (q) {
    for (const [v, label] of QUALITIES) {
      const o = document.createElement('option');
      o.value = v; o.textContent = label;
      q.appendChild(o);
    }
    q.value = String(_quality);
    q.addEventListener('change', () => {
      _quality = parseInt(q.value, 10) || DEFAULT_Q;
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
  on('mv3-pv-gate-go', () => { _override = true; _gate(false); });
  on('mv3-pv-shot', _shoot);
  on('mv3-pv-start', () => seek(0));
  on('mv3-pv-back', () => stepFragment(-1));
  on('mv3-pv-play', toggle);
  on('mv3-pv-fwd', () => stepFragment(1));

  // Scrubbing the timeline moves the preview; the preview moves the playhead while it
  // plays. One clock, two views of it - the ruler and the canvas can never disagree.
  //
  // WHILE PLAYING TOO. A seek used to be ignored during playback, so the only way to jump
  // was to stop first. Now it lands: the clock restarts from the new moment and playback
  // carries on from there. While the ruler is HELD the clock stands still (see _held), so a
  // drag scrubs the picture and playback resumes from wherever the mouse let go.
  onSeek((t) => seek(t));
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
    if (k && k !== _warmedKey) {
      _warmedKey = k;
      // Every project opens at the default, whatever the last one was looked at in.
      if (_quality !== DEFAULT_Q) {
        _quality = DEFAULT_Q;
        const q = document.getElementById('mv3-pv-q');
        if (q) q.value = String(DEFAULT_Q);
        _applyQuality();
      }
      _prepareSoon(true);        // a project opened: gated, so Play waits for it
    } else if (k) {
      _prepareSoon(false);       // an edit: whatever is new is prepared in the background
    } else {
      _ready = true; _gate(false);
    }
  });

  _paintPlay();
  _paintTime();
  _raf = requestAnimationFrame(_tick);
}
