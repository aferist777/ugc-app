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
 * The part [from, to] of a clip for one model x aggregator record: { buf, ext: 'mp4', w, h, secs } or an Error in
 * words. o: { from, to, signal, onWait }
 */
async function clip(abs, pair, o) {
  const opts = o || {};
  const lim = Object.assign({}, VID, (pair && pair.limits && pair.limits.video) || {});
  const PROBE = require('./media-probe');
  const probe = await PROBE.probe(abs);
  const { from, dur } = _span(probe, opts, 'clip');
  const { w, h } = seen(probe);
  const { W, H } = fitFrame(w, h, lim);
  const fps = +probe.fps || 0;
  const F = !fps ? 30 : fps < lim.fps[0] ? lim.fps[0] : fps > lim.fps[1] ? lim.fps[1] : 0;
  await _afterRender(opts.signal, opts.onWait);
  const copy = _tmp(path.extname(abs).slice(1) || 'mp4');
  const out = _tmp('mp4');
  try {
    await fs.promises.copyFile(abs, copy);
    if (opts.signal && opts.signal.aborted) throw _abortErr();
    const vf = 'scale=' + W + ':' + H + ':flags=lanczos' + (F ? ',fps=' + F : '') + ',format=yuv420p';
    for (const crf of CRFS) {
      const r = await _ffmpeg(['-hide_banner', '-nostdin', '-v', 'error', '-ss', from.toFixed(3), '-t', dur.toFixed(3), '-i', copy,
        '-map', '0:v:0', '-map', '0:a:0?', '-vf', vf, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(crf),
        '-c:a', 'aac', '-b:a', '128k', '-ac', '2', '-movflags', '+faststart', '-y', out], opts.signal);
      if (r.code !== 0 || !fs.existsSync(out)) throw new Error('the clip could not be prepared: ' + String(r.err || '').trim().split('\n').pop().slice(0, 200));
      if (fs.statSync(out).size <= lim.mb * 1024 * 1024) return { buf: fs.readFileSync(out), ext: 'mp4', w: W, h: H, secs: +dur.toFixed(3) };
    }
    throw new Error('the clip stays over ' + lim.mb + ' MB for ' + ((pair && pair.label) || 'this model') + ' however it is saved - choose a shorter part');
  } finally { _rm(copy); _rm(out); }
}

/**
 * The part [from, to] of a sound - or of a clip's sound - as mp3: { buf, ext: 'mp3', secs } or an Error in words.
 */
async function sound(abs, pair, o) {
  const opts = o || {};
  const lim = Object.assign({}, AUD, (pair && pair.limits && pair.limits.audio) || {});
  const PROBE = require('./media-probe');
  const probe = await PROBE.probe(abs);
  if (!probe.audio) throw new Error('it has no sound to take');
  const { from, dur } = _span(probe, opts, 'sound');
  await _afterRender(opts.signal, opts.onWait);
  const copy = _tmp(path.extname(abs).slice(1) || 'bin');
  const out = _tmp('mp3');
  try {
    await fs.promises.copyFile(abs, copy);
    if (opts.signal && opts.signal.aborted) throw _abortErr();
    const r = await _ffmpeg(['-hide_banner', '-nostdin', '-v', 'error', '-ss', from.toFixed(3), '-t', dur.toFixed(3), '-i', copy,
      '-map', '0:a:0', '-vn', '-c:a', 'libmp3lame', '-b:a', '192k', '-ar', '44100', '-ac', '2', '-y', out], opts.signal);
    if (r.code !== 0 || !fs.existsSync(out)) throw new Error('the sound could not be prepared: ' + String(r.err || '').trim().split('\n').pop().slice(0, 200));
    if (fs.statSync(out).size > lim.mb * 1024 * 1024) throw new Error('the sound stays over ' + lim.mb + ' MB - choose a shorter part');
    return { buf: fs.readFileSync(out), ext: 'mp3', secs: +dur.toFixed(3) };
  } finally { _rm(copy); _rm(out); }
}

/**
 * What the WRITER sees of a clip: its first, middle and last frames of the part, as JPEG buffers (720 px at most).
 * Read straight from the library file - three short reads.
 */
async function frames(abs, o) {
  const opts = o || {};
  const PROBE = require('./media-probe');
  const probe = await PROBE.probe(abs);
  const { from, dur } = _span(probe, opts, 'clip');
  const at = [from + Math.min(0.05, dur / 4), from + dur / 2, from + Math.max(0, dur - 0.1)];
  const bufs = [];
  for (const t of at) {
    const out = _tmp('jpg');
    try {
      const r = await _ffmpeg(['-hide_banner', '-nostdin', '-v', 'error', '-ss', t.toFixed(3), '-i', abs, '-frames:v', '1',
        '-vf', "scale='if(gt(iw,ih),min(720,iw),-2)':'if(gt(iw,ih),-2,min(720,ih))'", '-q:v', '4', '-y', out], opts.signal);
      if (r.code === 0 && fs.existsSync(out)) bufs.push(fs.readFileSync(out));
    } finally { _rm(out); }
  }
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
  const src = await PROBE.probe(sourceAbs);
  if (!src.audio) return { laid: false, why: 'the clip has no sound' };
  const { from, dur } = _span(src, opts, 'clip');
  const made = await PROBE.probe(videoAbs);
  const t = Math.max(0.1, Math.min(dur, made.duration || dur));
  await _afterRender(opts.signal, opts.onWait);
  const copy = _tmp(path.extname(sourceAbs).slice(1) || 'bin');
  const out = videoAbs.replace(/\.[^.\\/]+$/, '') + '.under.mp4';
  try {
    await fs.promises.copyFile(sourceAbs, copy);
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
 * (phase V7.6) ONE FRAME of a clip at `at` seconds, as it is seen (a phone's rotation applied), its long side at most
 * 2048 px - the frame-swap's room, which the picture model redraws with the person in the dancer's place. A JPEG buffer.
 */
async function still(abs, at, o) {
  const opts = o || {};
  const PROBE = require('./media-probe');
  const probe = await PROBE.probe(abs);
  if (!probe.duration) throw new Error('the clip could not be read');
  const t = Math.max(0, Math.min(+at || 0, Math.max(0, probe.duration - 0.05)));
  const out = _tmp('jpg');
  try {
    const r = await _ffmpeg(['-hide_banner', '-nostdin', '-v', 'error', '-ss', t.toFixed(3), '-i', abs, '-frames:v', '1',
      '-vf', "scale='if(gt(iw,ih),min(2048,iw),-2)':'if(gt(iw,ih),-2,min(2048,ih))'", '-q:v', '2', '-y', out], opts.signal);
    if (r.code !== 0 || !fs.existsSync(out) || !fs.statSync(out).size) {
      throw new Error('the frame could not be taken: ' + String(r.err || '').trim().split('\n').pop().slice(0, 160));
    }
    return fs.readFileSync(out);
  } finally { _rm(out); }
}

module.exports = { image, clip, sound, frames, fitFrame, seen, layUnder, still };
