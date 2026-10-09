'use strict';

// ════════════════════════════════════════════════════════════════════════════
// REFERENCES, MADE TO A MODEL'S MEASURE (phase V2 pictures; V7 adds clips - docs/local-app/PLAN.md "V-H").
//
// Every model x aggregator record (lib/video-models.js) says what it takes: the formats, the megabytes, the
// shortest and the longest side, the shape. A picture of the Library rarely matches all of them - a WEBP from
// Images where Kling motion control takes only JPEG and PNG, a 4K sheet over a 10 MB cap, a phone photo with
// its rotation in EXIF - so it is fitted here, in memory, and handed to the host (lib/helpers.js
// uploadToPublicHost). The library file is never touched.
//
// What cannot be fitted without changing the picture's meaning - a shape outside the model's range - is
// refused in words before anything is paid; cropping somebody's character to make it fit would be worse.
// ════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const DEF = { formats: ['jpg', 'png', 'webp'], mb: 10, minPx: 300, maxPx: 4096, ratio: [0.4, 2.5] };
const EXT = { jpeg: 'jpg', jpg: 'jpg', png: 'png', webp: 'webp' };

/**
 * One picture for one model x aggregator record: { buf, ext, w, h } within its limits, or an Error in words.
 */
async function image(abs, pair) {
  const lim = Object.assign({}, DEF, (pair && pair.limits && pair.limits.image) || {});
  const label = (pair && pair.label) || 'this model';
  const meta = await sharp(fs.readFileSync(abs)).metadata();
  // The sides as a person sees them: EXIF orientations 5-8 swap them.
  let w = meta.width || 0, h = meta.height || 0;
  if ((meta.orientation || 1) >= 5) { const t = w; w = h; h = t; }
  if (!w || !h) throw new Error('the picture could not be read: ' + path.basename(abs));
  const r = w / h;
  if (r < lim.ratio[0] || r > lim.ratio[1]) {
    throw new Error('the picture is ' + w + 'x' + h + ' - ' + label + ' takes shapes between ' + _shape(lim.ratio[0]) + ' and ' + _shape(lim.ratio[1]));
  }
  let scale = 1;
  if (Math.max(w, h) > lim.maxPx) scale = lim.maxPx / Math.max(w, h);
  if (Math.min(w, h) * scale < lim.minPx) scale = lim.minPx / Math.min(w, h);
  const W = Math.round(w * scale), H = Math.round(h * scale);
  if (Math.max(W, H) > lim.maxPx) {
    throw new Error('the picture is ' + w + 'x' + h + ' - too narrow for ' + label + ' (each side ' + lim.minPx + '-' + lim.maxPx + ' px)');
  }

  const fmt = EXT[String(meta.format || '').toLowerCase()] || '';
  const raw = fs.statSync(abs).size;
  const fine = scale === 1 && lim.formats.includes(fmt) && raw <= lim.mb * 1024 * 1024 && (meta.orientation || 1) === 1;
  if (fine) return { buf: fs.readFileSync(abs), ext: fmt, w, h };

  // Re-encoded: PNG keeps a transparent cut-out where PNG is taken, anything else becomes a JPEG.
  const keepPng = fmt === 'png' && meta.hasAlpha && lim.formats.includes('png');
  for (const q of [92, 85, 75, 65, 55]) {
    let p = sharp(fs.readFileSync(abs)).rotate();
    if (scale !== 1) p = p.resize(W, H, { fit: 'fill' });
    const buf = keepPng ? await p.png({ compressionLevel: 9 }).toBuffer() : await p.jpeg({ quality: q, mozjpeg: true }).toBuffer();
    if (buf.length <= lim.mb * 1024 * 1024) return { buf, ext: keepPng ? 'png' : 'jpg', w: W, h: H };
    if (keepPng) break;
  }
  throw new Error('the picture stays over ' + lim.mb + ' MB for ' + label + ' however it is saved');
}

function _shape(r) {
  // 0.4 -> 2:5, 2.5 -> 5:2, 0.5 -> 1:2
  for (let b = 1; b <= 10; b++) { const a = Math.round(r * b); if (Math.abs(a / b - r) < 0.01) return a + ':' + b; }
  return r.toFixed(2);
}

// ════════════════════════════════════════════════════════════════════════════
// CLIPS AND SOUNDS (phase V7, PLAN V-H): the part of a Library file the person chose - its start and end - made to
// the rung's measure: H.264 mp4 within the model's frame (Seedance: 409 600-927 408 pixels; Kling motion control:
// each side 341-3850, the long one at most 1920 here - its result is 720p or 1080p), 24-60 frames a second, under
// its megabytes; a sound as mp3. Always from a COPY in scratch (a project renamed meanwhile must not meet a file
// ffmpeg holds open - Windows refuses the rename), after any render encoding now has finished (lib/render-busy.js),
// below normal priority, and killed when `signal` aborts - the cross on its row. The library file is never touched.
// ════════════════════════════════════════════════════════════════════════════
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');

const VID = { mb: 50, area: null, minPx: 0, maxPx: 0, maxLong: 0, ratio: [0, 99], fps: [24, 60] };
const AUD = { mb: 15 };
const CRFS = [20, 24, 28, 32];
const SPAN_SLACK = 0.06;            // a part's end may sit this far past the file's measured end

const _abortErr = () => Object.assign(new Error('let go of'), { aborted: true });
const _sleep = (ms) => new Promise(r => setTimeout(r, ms));
const _tmp = (ext) => path.join(require('./config').TEMP_DIR, 'vprep_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex') + '.' + ext);
const _rm = (p) => { try { fs.unlinkSync(p); } catch (e) { /* gone */ } };
const _even = (n) => Math.max(2, Math.round(n / 2) * 2);
// (review V7) A part is cut this much short when that keeps it over the model's least: the encoders pad the end (an
// mp3 of a 15.000 s part reads 15.05 s, an mp4 15.02 s), and a part chosen at the model's most would go over it.
const PAD = 0.06;
const _cutOf = (dur, least) => (dur - PAD >= (+least || 0) + 0.001 ? dur - PAD : dur);
// (review V7) The file is looked up AFTER the wait for a render: a project renamed meanwhile has moved it. `abs` may be
// a path or a function that answers one.
const _where = (abs) => (typeof abs === 'function' ? abs() : abs);
// (phase V18.3) Read where the file is now - and once more if it moved while it was being read (ffmpeg takes half a
// second to open it here, and a project renamed meanwhile moves its clips): the reading at the old place found nothing.
async function _probeAt(abs) {
  const PROBE = require('./media-probe');
  const at = _where(abs);
  const probe = await PROBE.probe(at);
  if (probe.duration > 0 || _where(abs) === at) return probe;
  return PROBE.probe(_where(abs));
}
const _gone = (e) => (e && e.code === 'ENOENT' ? Object.assign(new Error('the file is not in the library any more'), { code: 'ENOENT' }) : e);

// (review V7) What a preparation killed with the app left in scratch (a quit kills the server outright, and `finally`
// never runs): swept the first time this module is needed - nothing of this process is being prepared yet.
(function _sweepScratch() {
  try {
    const dir = require('./config').TEMP_DIR;
    for (const f of fs.readdirSync(dir)) {
      if (!/^vprep_/.test(f)) continue;
      const p = path.join(dir, f);
      try { if (Date.now() - fs.statSync(p).mtimeMs > 120000) fs.unlinkSync(p); } catch (e) { /* in use, or gone */ }
    }
  } catch (e) { /* no scratch yet */ }
})();

// One ffmpeg run, killed when the signal aborts.
function _ffmpeg(args, signal) {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) return reject(_abortErr());
    let err = '';
    let p;
    try { p = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true }); }
    catch (e) { return reject(e); }
    try { os.setPriority(p.pid, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch (e) { /* not allowed: normal it is */ }
    const kill = () => { try { p.kill(); } catch (e) { /* gone */ } };
    if (signal) signal.addEventListener('abort', kill, { once: true });
    p.stderr.on('data', (c) => { err = (err + c).slice(-600); });
    p.on('error', (e) => { if (signal) signal.removeEventListener('abort', kill); reject(e); });
    p.on('close', (code) => {
      if (signal) signal.removeEventListener('abort', kill);
      if (signal && signal.aborted) return reject(_abortErr());
      resolve({ code, err });
    });
  });
}

// A render encoding now has the cores: the preparation waits for it, and the cross still lets it go.
async function _afterRender(signal, onWait) {
  const BUSY = require('./render-busy');
  let said = false;
  while (BUSY.busy()) {
    if (signal && signal.aborted) throw _abortErr();
    if (!said && typeof onWait === 'function') { said = true; onWait('waiting for the render to finish'); }
    await _sleep(2000);
  }
}

// The part asked for, checked against the file itself: { from, dur } or an Error in words.
function _span(probe, o, what) {
  const from = Math.max(0, +(o && o.from) || 0);
  const to = +(o && o.to) || 0;
  if (!probe.duration) throw new Error('the ' + what + ' could not be read');
  const end = to > from ? to : probe.duration;
  if (end > probe.duration + SPAN_SLACK) {
    throw new Error('the ' + what + ' is ' + probe.duration.toFixed(1) + ' s - the part asked for ends at ' + end.toFixed(1) + ' s');
  }
  return { from, dur: Math.min(end, probe.duration) - from };
}

// The frame a rung takes, from the frame as it is SEEN (a phone's rotation applied): the same shape, scaled into the
// window. A shape outside the rung's range is refused in words - cropping somebody's clip would change it.
function fitFrame(w, h, lim) {
  const L = Object.assign({}, VID, lim || {});
  if (!w || !h) throw new Error('the clip has no picture that could be read');
  const r = w / h;
  if (r < L.ratio[0] || r > L.ratio[1]) {
    throw new Error('the clip is ' + w + 'x' + h + ' - this model takes shapes between ' + _shape(L.ratio[0]) + ' and ' + _shape(L.ratio[1]));
  }
  let s = 1;
  if (L.area) {
    if (w * h > L.area[1]) s = Math.sqrt(L.area[1] / (w * h));
    else if (w * h < L.area[0]) s = Math.sqrt(L.area[0] / (w * h));
  }
  if (L.maxLong && Math.max(w, h) * s > L.maxLong) s = L.maxLong / Math.max(w, h);
  if (L.maxPx && Math.max(w, h) * s > L.maxPx) s = L.maxPx / Math.max(w, h);
  if (L.minPx && Math.min(w, h) * s < L.minPx) s = L.minPx / Math.min(w, h);
  let W = _even(w * s);
  let H = _even(h * s);
  // Even sides can step out of the window by a few pixels: brought back in.
  for (let i = 0; L.area && W * H > L.area[1] && i < 200; i++) { W -= 2; H = _even(W / r); }
  for (let i = 0; L.area && W * H < L.area[0] && i < 200; i++) { W += 2; H = _even(W / r); }
  // (review V7) The short side scaled up to the least is rounded UP to an even number - 341/m*m can come out a hair
  // under 341 and round to 340 - and a shape at the very edge of the range is kept inside it after the rounding
  // (exactly 2:5 rounded to even sides read 0.3996).
  if (L.minPx && Math.min(W, H) < L.minPx && Math.min(w, h) * s >= L.minPx - 0.01) {
    const up = Math.ceil(L.minPx / 2) * 2;
    if (W <= H) { W = up; H = Math.max(H, _even(up / r)); } else { H = up; W = Math.max(W, _even(up * r)); }
  }
  // The SHORT side grows by two pixels where the window lets it, else the long one shrinks.
  for (let i = 0; i < 4 && W / H < L.ratio[0]; i++) {
    if ((!L.area || (W + 2) * H <= L.area[1]) && (!L.maxPx || W + 2 <= L.maxPx)) W += 2; else H -= 2;
  }
  for (let i = 0; i < 4 && W / H > L.ratio[1]; i++) {
    if ((!L.area || W * (H + 2) <= L.area[1]) && (!L.maxPx || H + 2 <= L.maxPx)) H += 2; else W -= 2;
  }
  if ((L.maxPx && Math.max(W, H) > L.maxPx) || (L.minPx && Math.min(W, H) < L.minPx)) {
    throw new Error('the clip is ' + w + 'x' + h + ' - too narrow for this model (each side ' + L.minPx + '-' + L.maxPx + ' px)');
  }
  return { W, H };
}

// Its frame as seen: a rotation of 90 or 270 degrees swaps the sides.
function seen(probe) {
  const rot = Math.abs(Math.round(+probe.rotate || 0)) % 180;
  return rot === 90 ? { w: probe.h, h: probe.w } : { w: probe.w, h: probe.h };
}

/**
 * The part [from, to] of a clip for one model x aggregator record: { file, drop, ext: 'mp4', w, h, secs } or an Error in
 * words. o: { from, to, signal, onWait }
 */
async function clip(abs, pair, o) {
  const opts = o || {};
  const lim = Object.assign({}, VID, (pair && pair.limits && pair.limits.video) || {});
  const probe = await _probeAt(abs);
  const { from, dur } = _span(probe, opts, 'clip');
  const { w, h } = seen(probe);
  const { W, H } = fitFrame(w, h, lim);
  // (review V7) The rate is ALWAYS set: a variable-rate clip whose average is inside the range (a 120 Hz phone's
  // screen recording, 33 fps on average) came out at its stream's 120 fps without it.
  const fps = +probe.fps || 0;
  const F = !fps ? 30 : Math.max(lim.fps[0], Math.min(lim.fps[1], Math.round(fps * 1000) / 1000));
  const least = pair && pair.duration && pair.duration.fromClip ? pair.duration.min : ((pair && pair.limits && pair.limits.clipSecs) || [0])[0];
  const T = _cutOf(dur, least);
  await _afterRender(opts.signal, opts.onWait);
  const src = _where(abs);
  const copy = _tmp(path.extname(src).slice(1) || 'mp4');
  const out = _tmp('mp4');
  let kept = false;
  try {
    try { await fs.promises.copyFile(src, copy); } catch (e) { throw _gone(e); }
    if (opts.signal && opts.signal.aborted) throw _abortErr();
    const vf = 'scale=' + W + ':' + H + ':flags=lanczos,fps=' + F + ',format=yuv420p';
    for (const crf of CRFS) {
      const r = await _ffmpeg(['-hide_banner', '-nostdin', '-v', 'error', '-ss', from.toFixed(3), '-t', T.toFixed(3), '-i', copy,
        '-map', '0:v:0', '-map', '0:a:0?', '-vf', vf, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(crf),
        '-c:a', 'aac', '-b:a', '128k', '-ac', '2', '-movflags', '+faststart', '-y', out], opts.signal);
      if (r.code !== 0 || !fs.existsSync(out)) throw new Error('the clip could not be prepared: ' + String(r.err || '').trim().split('\n').pop().slice(0, 200));
      // (phase V23) The FILE, not its bytes in memory: it goes up as a stream, and the caller drops it once sent.
      const size = fs.statSync(out).size;
      if (size <= lim.mb * 1024 * 1024) { kept = true; return _prepared(out, size, { ext: 'mp4', w: W, h: H, secs: +T.toFixed(3) }); }
    }
    throw new Error('the clip stays over ' + lim.mb + ' MB for ' + ((pair && pair.label) || 'this model') + ' however it is saved - choose a shorter part');
  } finally { _rm(copy); if (!kept) _rm(out); }
}

// A prepared file in scratch: { file: { path, size }, drop() } and what it is. `_sweepScratch` clears one left by a crash.
function _prepared(p, size, info) {
  return Object.assign({ file: { path: p, size }, drop: () => _rm(p) }, info);
}

/**
 * The part [from, to] of a sound - or of a clip's sound - as mp3: { file, drop, ext: 'mp3', secs } or an Error in words.
 */
async function sound(abs, pair, o) {
  const opts = o || {};
  const lim = Object.assign({}, AUD, (pair && pair.limits && pair.limits.audio) || {});
  const probe = await _probeAt(abs);
  if (!probe.audio) throw new Error('it has no sound to take');
  const { from, dur } = _span(probe, opts, 'sound');
  const T = _cutOf(dur, 0.5);
  await _afterRender(opts.signal, opts.onWait);
  const src = _where(abs);
  const copy = _tmp(path.extname(src).slice(1) || 'bin');
  const out = _tmp('mp3');
  let kept = false;
  try {
    try { await fs.promises.copyFile(src, copy); } catch (e) { throw _gone(e); }
    if (opts.signal && opts.signal.aborted) throw _abortErr();
    const r = await _ffmpeg(['-hide_banner', '-nostdin', '-v', 'error', '-ss', from.toFixed(3), '-t', T.toFixed(3), '-i', copy,
      '-map', '0:a:0', '-vn', '-c:a', 'libmp3lame', '-b:a', '192k', '-ar', '44100', '-ac', '2', '-y', out], opts.signal);
    if (r.code !== 0 || !fs.existsSync(out)) throw new Error('the sound could not be prepared: ' + String(r.err || '').trim().split('\n').pop().slice(0, 200));
    const size = fs.statSync(out).size;
    if (size > lim.mb * 1024 * 1024) throw new Error('the sound stays over ' + lim.mb + ' MB - choose a shorter part');
    kept = true;
    return _prepared(out, size, { ext: 'mp3', secs: +T.toFixed(3) });
  } finally { _rm(copy); if (!kept) _rm(out); }
}

/**
 * What the WRITER sees of a clip: its first, middle and last frames of the part, as JPEG buffers (720 px at most).
 * Read straight from the library file - three short reads.
 */
// One frame at `t` - or, where the picture ends before the sound (a clip whose sound runs on), the nearest earlier one
// that is there: tried again half a second and a second earlier, then at `from`. A JPEG buffer, or null.
async function _grab(abs, t, from, vf, q, signal) {
  for (const at of [t, t - 0.5, t - 1, from]) {
    if (at < from - 0.001 && at !== from) continue;
    const out = _tmp('jpg');
    try {
      const r = await _ffmpeg(['-hide_banner', '-nostdin', '-v', 'error', '-ss', Math.max(0, at).toFixed(3), '-i', abs, '-frames:v', '1',
        '-vf', vf, '-q:v', String(q), '-y', out], signal);
      if (r.code === 0 && fs.existsSync(out) && fs.statSync(out).size) return fs.readFileSync(out);
    } finally { _rm(out); }
  }
  return null;
}

async function frames(abs, o) {
  const opts = o || {};
  const PROBE = require('./media-probe');
  const probe = await PROBE.probe(abs);
  const { from, dur } = _span(probe, opts, 'clip');
  const at = [from + Math.min(0.05, dur / 4), from + dur / 2, from + Math.max(0, dur - 0.1)];
  const vf = "scale='if(gt(iw,ih),min(720,iw),-2)':'if(gt(iw,ih),-2,min(720,ih))'";
  const bufs = [];
  for (const t of at) {
    const b = await _grab(abs, t, from, vf, 4, opts.signal);
    if (b) bufs.push(b);
  }
  // (review V7) Exactly THREE or none: the writer is told it sees three frames of each clip, in order - one short
  // and the next clip's frames would be read as this one's end.
  if (!bufs.length) return [];
  while (bufs.length < 3) bufs.push(bufs[bufs.length - 1]);
  return bufs;
}

/**
 * (phase V7.4) THE CLIP'S SOUND UNDER A MADE VIDEO - where the model did not keep it itself (Kling on kie, Seedance
 * asked for the clip's sound): the part `from`-`to` of `sourceAbs` becomes the video's sound, cut to the video's length,
 * the picture copied as it is. The source is read from a COPY in scratch; the new file is written beside the video and
 * put in its place. Answers { laid: true, secs } or { laid: false, why } - a clip with no sound is no failure of the
 * video, which then stays as it came.
 */
async function layUnder(videoAbs, sourceAbs, o) {
  const opts = o || {};
  const PROBE = require('./media-probe');
  const srcAbs = _where(sourceAbs);
  const src = await PROBE.probe(srcAbs);
  if (!src.audio) return { laid: false, why: 'the clip has no sound' };
  const { from, dur } = _span(src, opts, 'clip');
  const made = await PROBE.probe(videoAbs);
  const t = Math.max(0.1, Math.min(dur, made.duration || dur));
  // (review V7) No wait for a render: the picture is copied as it is and only the sound encoded - seconds, below
  // normal priority - and a finished, paid clip must not sit unfiled behind a render queue. The cross (`signal`) stops it.
  const copy = _tmp(path.extname(srcAbs).slice(1) || 'bin');
  const out = videoAbs.replace(/\.[^.\\/]+$/, '') + '.under.mp4';
  try {
    try { await fs.promises.copyFile(srcAbs, copy); } catch (e) { throw _gone(e); }
    if (opts.signal && opts.signal.aborted) throw _abortErr();
    const r = await _ffmpeg(['-hide_banner', '-nostdin', '-v', 'error', '-i', videoAbs, '-ss', from.toFixed(3), '-t', t.toFixed(3), '-i', copy,
      '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2',
      '-movflags', '+faststart', '-y', out], opts.signal);
    if (r.code !== 0 || !fs.existsSync(out) || !fs.statSync(out).size) {
      return { laid: false, why: 'ffmpeg could not lay it: ' + String(r.err || '').trim().split('\n').pop().slice(0, 160) };
    }
    // In the video's place - a scanner holding either file a moment is waited out.
    for (let i = 0; ; i++) {
      try { fs.renameSync(out, videoAbs); break; } catch (e) {
        if (i >= 9 || !['EPERM', 'EACCES', 'EBUSY'].includes(e.code)) throw e;
        await _sleep(200 * (i + 1));
      }
    }
    return { laid: true, secs: +t.toFixed(2) };
  } finally { _rm(copy); _rm(out); }
}

/**
 * (phases V7.6, V17) ONE FRAME of a clip at `at` seconds, as it is seen (a phone's rotation applied), its long side at
 * most 2048 px - the still Kling's first frame is drawn from, the person's character in its pose. A JPEG buffer.
 */
async function still(abs, at, o) {
  const opts = o || {};
  const PROBE = require('./media-probe');
  const probe = await PROBE.probe(abs);
  if (!probe.duration) throw new Error('the clip could not be read');
  const t = Math.max(0, Math.min(+at || 0, Math.max(0, probe.duration - 0.05)));
  // Where the picture ends before the sound, the nearest earlier frame that is there (review V7).
  const b = await _grab(abs, t, Math.max(0, t - 1), "scale='if(gt(iw,ih),min(2048,iw),-2)':'if(gt(iw,ih),-2,min(2048,ih))'", 2, opts.signal);
  if (!b) throw new Error('the clip has no picture at ' + t.toFixed(1) + ' s - pick another moment');
  return b;
}

/**
 * (review V7) What preparing a clip or a sound for this rung would refuse, asked BEFORE anything is paid - a card's
 * writer, a storyboard or a first frame is not bought for a video that can never be made: the part against the
 * file, the clip's shape in the rung's window, a sound with no sound in it. '' when it would go, else why, in words.
 */
async function dryCheck(abs, pair, m) {
  const what = m && m.kind === 'audio' ? 'sound' : 'clip';
  let probe;
  try { probe = await require('./media-probe').probe(abs); } catch (e) { return 'the ' + what + ' could not be read'; }
  try {
    if (what === 'sound' && !probe.audio) return 'it has no sound to take';
    _span(probe, { from: m.in, to: m.out }, what);
    if (what === 'clip') {
      const { w, h } = seen(probe);
      fitFrame(w, h, Object.assign({}, VID, (pair && pair.limits && pair.limits.video) || {}));
    }
    return '';
  } catch (e) { return e.message; }
}

module.exports = { image, clip, sound, frames, fitFrame, seen, layUnder, still, dryCheck };
