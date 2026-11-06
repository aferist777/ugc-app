'use strict';

// ════════════════════════════════════════════════════════════════════════════
// VIDEO THUMBNAILS — one poster frame per clip.
//
// A card with no poster loads the VIDEO ITSELF with preload=metadata just to show one frame -
// megabytes per card - and a "thumbnail" that is really the full 720x1280 frame is nearly as
// bad. So a thumbnail here is one frame at 0.5s, resized to THUMB_W wide, JPEG.
//
// Used by the upload path (make one on the way in), by the sweep that fills in what the library
// is missing, and by lib/thumb-refresh.js, which remakes the ones cut at an earlier size.
// ════════════════════════════════════════════════════════════════════════════

const fs   = require('fs');
const path = require('path');
const { spawn } = require('child_process');

let _ffmpeg = null; try { _ffmpeg = require('ffmpeg-static'); } catch (e) { _ffmpeg = null; }
let _sharp  = null; try { _sharp  = require('sharp'); } catch (e) { _sharp = null; }

const ROOT_DIR = require('./config').ROOT_DIR;

// Twice what it was on the server - 160px (a 72px card at 2x, with headroom) at quality 72, cut
// for bytes that do not matter on a local disk - so a card stays sharp on a high-density screen and
// when it is drawn bigger. Height follows the source.
const THUMB_W = 320;
const THUMB_Q = 85;
// A poster wider than this is treated as "not a thumbnail" by the sweep, so the full frames
// (720 and 1080 wide) written by old code get replaced rather than kept.
const MAX_OK_W = 700;
// The poster Scenarios files beside a lipsync clip (routes/scen3.js), for its bigger card.
const CLIP_POSTER_W = 640;

const localFromUrl = (u) => (u ? path.join(ROOT_DIR, String(u).split('?')[0].replace(/^\/+/, '')) : null);
// /media/clips/x.mp4 -> /media/clips/thumbs/x_thumb.jpg — the naming the library already uses.
function thumbUrlFor(videoUrl) {
  if (!videoUrl) return null;
  const clean = String(videoUrl).split('?')[0];
  const dir = path.posix.dirname(clean);
  const base = path.posix.basename(clean).replace(/\.[^.]+$/, '');
  return path.posix.join(dir, 'thumbs', base + '_thumb.jpg');
}

const _run = (args) => new Promise((resolve) => {
  try {
    const p = spawn(_ffmpeg, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    let err = '';
    if (p.stderr) p.stderr.on('data', d => { err = (err + d).slice(-400); });
    p.on('error', e => resolve({ code: -1, err: e.message }));
    p.on('close', code => resolve({ code, err }));
  } catch (e) { resolve({ code: -1, err: e.message }); }
});

// Width of an existing image, or 0 if it cannot be read. Lets the caller tell a
// real thumbnail from a full frame that was named like one.
async function imageWidth(absPath) {
  if (!_sharp || !absPath || !fs.existsSync(absPath)) return 0;
  try { const m = await _sharp(absPath).metadata(); return m.width || 0; } catch (e) { return 0; }
}

// One frame of a video file, `width` wide, written to outAbs. Throws with a reason.
//
// `at` is where to grab the frame, in seconds. The default suits what this was written for -
// a rendered short, which has its picture from the first frame. A long source video is a
// different animal: half a second in it is usually still black or showing a channel logo, so
// callers ingesting those pass a moment well inside the content and get a card you can
// recognise instead of a black square.
async function posterFrame(srcAbs, outAbs, { width = THUMB_W, at = 0.5 } = {}) {
  if (!_ffmpeg) throw new Error('ffmpeg not available');
  if (!srcAbs || !fs.existsSync(srcAbs)) throw new Error('video not on disk: ' + srcAbs);
  try { fs.mkdirSync(path.dirname(outAbs), { recursive: true }); } catch (e) {}

  // One frame. -ss before -i seeks by keyframe: fast, and exact enough for a poster. A clip
  // shorter than the seek falls through to the retry below, which takes the first frame.
  const tmp = outAbs + '.tmp.jpg';
  const seek = Math.max(0, Number(at) || 0);
  let r = await _run(['-hide_banner', '-ss', String(seek), '-i', srcAbs, '-frames:v', '1', '-q:v', '2', '-y', tmp]);
  if (r.code !== 0 || !fs.existsSync(tmp)) {
    r = await _run(['-hide_banner', '-i', srcAbs, '-frames:v', '1', '-q:v', '2', '-y', tmp]);
  }
  if (r.code !== 0 || !fs.existsSync(tmp)) throw new Error('frame grab failed: ' + String(r.err).slice(-120));

  try {
    if (_sharp) {
      await _sharp(tmp).resize({ width, withoutEnlargement: true }).jpeg({ quality: THUMB_Q }).toFile(outAbs);
      try { fs.unlinkSync(tmp); } catch (e) {}
    } else {
      fs.renameSync(tmp, outAbs);             // no sharp: keep the frame rather than nothing
    }
  } catch (e) {
    try { if (fs.existsSync(tmp)) fs.renameSync(tmp, outAbs); } catch (e2) {}
    if (!fs.existsSync(outAbs)) throw e;
  }
  return fs.existsSync(outAbs) ? fs.statSync(outAbs).size : 0;
}

// (phase V77, the owner's (тч4)) THE FRAME OF A FILE at `at` seconds OF THE FILE, at its own size - a picture to take into a
// chat, not a poster: -ss before -i is exact when the frame is decoded (ffmpeg decodes from the keyframe before it and drops
// the rest). A moment at or past the end - the last frame of a clip the timeline plays to its end - has no frame there, so it
// steps back a frame or so, then takes the file's last frame (-sseof). JPEG at ffmpeg's best. Throws with a reason.
async function frameAt(srcAbs, outAbs, at) {
  if (!_ffmpeg) throw new Error('ffmpeg not available');
  if (!srcAbs || !fs.existsSync(srcAbs)) throw new Error('video not on disk');
  try { fs.mkdirSync(path.dirname(outAbs), { recursive: true }); } catch (e) {}
  const t = Math.max(0, Number(at) || 0);
  const tries = [t, t - 0.04, t - 0.12, t - 0.3].filter((v, i) => i === 0 || v > 0)
    .map(v => ['-hide_banner', '-nostdin', '-v', 'error', '-ss', v.toFixed(3), '-i', srcAbs, '-frames:v', '1', '-q:v', '2', '-y', outAbs]);
  tries.push(['-hide_banner', '-nostdin', '-v', 'error', '-sseof', '-0.5', '-i', srcAbs, '-update', '1', '-q:v', '2', '-y', outAbs]);
  let r = null;
  for (const args of tries) {
    try { fs.rmSync(outAbs, { force: true }); } catch (e) {}
    r = await _run(args);
    if (r.code === 0 && fs.existsSync(outAbs) && fs.statSync(outAbs).size > 0) return outAbs;
  }
  throw new Error('the frame could not be read: ' + String((r && r.err) || '').slice(-120));
}

// Make (or replace) the thumbnail for one video. Returns { thumb, w, bytes } or
// throws with a reason. `videoUrl` is a web path; the thumb lands next to it.
async function makeThumb(videoUrl, opts = {}) {
  const src = localFromUrl(videoUrl);
  if (!src || !fs.existsSync(src)) throw new Error('video not on disk: ' + videoUrl);
  const outUrl  = thumbUrlFor(videoUrl);
  const outDisk = localFromUrl(outUrl);
  const bytes = await posterFrame(src, outDisk, opts);
  return { thumb: outUrl, w: await imageWidth(outDisk), bytes };
}

module.exports = { makeThumb, posterFrame, frameAt, thumbUrlFor, imageWidth, localFromUrl, THUMB_W, MAX_OK_W, CLIP_POSTER_W };
