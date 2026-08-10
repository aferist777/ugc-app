'use strict';

// ════════════════════════════════════════════════════════════════════════════
// VIDEO THUMBNAILS — one small poster frame per clip.
//
// The media shelf draws cards 72px wide. What it had instead were full frames
// (720x1280, 70-210KB each, 14MB across the library) and, for clips with no
// poster at all, the VIDEO ITSELF loaded with preload=metadata just to show one
// frame — megabytes per card. So a thumbnail here means a genuinely small file:
// one frame at 0.5s, resized to THUMB_W wide, JPEG.
//
// Used by the upload path (make one on the way in) and by the sweep that fills
// in what the library is missing.
// ════════════════════════════════════════════════════════════════════════════

const fs   = require('fs');
const path = require('path');
const { spawn } = require('child_process');

let _ffmpeg = null; try { _ffmpeg = require('ffmpeg-static'); } catch (e) { _ffmpeg = null; }
let _sharp  = null; try { _sharp  = require('sharp'); } catch (e) { _sharp = null; }

const ROOT_DIR = path.join(__dirname, '..');

// 72px card at 2x for retina, with a little headroom. Height follows the source.
const THUMB_W = 160;
const THUMB_Q = 72;
// A poster wider than this is treated as "not a thumbnail" by the sweep, so the
// full frames written by the old code get replaced rather than kept.
const MAX_OK_W = 260;

const localFromUrl = (u) => (u ? path.join(ROOT_DIR, String(u).split('?')[0].replace(/^\/+/, '')) : null);
// /uploads/x.mp4 -> /uploads/thumbs/x_thumb.jpg — the naming the library already uses.
function thumbUrlFor(videoUrl) {
  if (!videoUrl) return null;
  const clean = String(videoUrl).split('?')[0];
  const dir = path.posix.dirname(clean);
  const base = path.posix.basename(clean).replace(/\.[^.]+$/, '');
  return path.posix.join(dir, 'thumbs', base + '_thumb.jpg');
}

const _run = (args) => new Promise((resolve) => {
  try {
    const p = spawn(_ffmpeg, args, { stdio: ['ignore', 'ignore', 'pipe'] });
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

// Make (or replace) the thumbnail for one video. Returns { thumb, w, bytes } or
// throws with a reason. `videoUrl` is a web path; the thumb lands next to it.
async function makeThumb(videoUrl, { width = THUMB_W } = {}) {
  if (!_ffmpeg) throw new Error('ffmpeg not available');
  const src = localFromUrl(videoUrl);
  if (!src || !fs.existsSync(src)) throw new Error('video not on disk: ' + videoUrl);

  const outUrl  = thumbUrlFor(videoUrl);
  const outDisk = localFromUrl(outUrl);
  try { fs.mkdirSync(path.dirname(outDisk), { recursive: true }); } catch (e) {}

  // One frame at 0.5s. -ss before -i seeks by keyframe: fast, and exact enough
  // for a poster. Very short clips fall back to the first frame.
  const tmp = outDisk + '.tmp.jpg';
  let r = await _run(['-hide_banner', '-ss', '0.5', '-i', src, '-frames:v', '1', '-q:v', '3', '-y', tmp]);
  if (r.code !== 0 || !fs.existsSync(tmp)) {
    r = await _run(['-hide_banner', '-i', src, '-frames:v', '1', '-q:v', '3', '-y', tmp]);
  }
  if (r.code !== 0 || !fs.existsSync(tmp)) throw new Error('frame grab failed: ' + String(r.err).slice(-120));

  try {
    if (_sharp) {
      await _sharp(tmp).resize({ width, withoutEnlargement: true }).jpeg({ quality: THUMB_Q }).toFile(outDisk);
      try { fs.unlinkSync(tmp); } catch (e) {}
    } else {
      fs.renameSync(tmp, outDisk);            // no sharp: keep the frame rather than nothing
    }
  } catch (e) {
    try { if (fs.existsSync(tmp)) fs.renameSync(tmp, outDisk); } catch (e2) {}
    if (!fs.existsSync(outDisk)) throw e;
  }

  const bytes = fs.existsSync(outDisk) ? fs.statSync(outDisk).size : 0;
  return { thumb: outUrl, w: await imageWidth(outDisk), bytes };
}

module.exports = { makeThumb, thumbUrlFor, imageWidth, localFromUrl, THUMB_W, MAX_OK_W };
