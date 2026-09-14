/* ═══════════════════════════════════════════════════════════════════════════
   av-extract.js — pull the audio track out of a finished clip, padded to the
   clip's own length.

   Merge times a main-track clip by its AUDIO, not by the video:
     • a cell with no audioPath gets dur 0 and is dropped by buildModel's
       `s.dur > 0` filter — the fragment silently vanishes from the timeline;
     • a cell whose audio is SHORTER than its video plays truncated. The TTS take
       always is shorter: lipsync stretches the read to fit the motion.
   So the audio handed to Merge is extracted from the RENDERED clip and padded
   with silence to the video's own duration.

   The output name is derived from the input, so one clip always maps to one file:
   re-running is free, and two callers cannot produce two copies.
   ═══════════════════════════════════════════════════════════════════════════ */
const fs   = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const { ROOT_DIR: ROOT, PUBLIC_DIR } = require('./config');
let _ffmpeg = null;
try { _ffmpeg = require('ffmpeg-static'); } catch (e) { _ffmpeg = null; }

// '/uploads/clips/x.mp4' -> '<root>/uploads/clips/x.mp4', tolerating public/ assets.
function localFromUrl(u) {
  if (!u) return null;
  const rel = String(u).replace(/^\/+/, '');
  const a = path.join(ROOT, rel);
  if (fs.existsSync(a)) return a;
  const b = path.join(PUBLIC_DIR, rel);
  return fs.existsSync(b) ? b : a;
}

const _run = (args) => new Promise((resolve) => {
  let err = '';
  try {
    const p = spawn(_ffmpeg, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    if (p.stderr) p.stderr.on('data', d => { err += d; });
    p.on('error', e => resolve({ code: -1, err: err || e.message }));
    p.on('close', code => resolve({ code, err }));
  } catch (e) { resolve({ code: -1, err: e.message }); }
});

// Duration straight out of ffmpeg's own header dump — no ffprobe dependency.
async function mediaDur(file) {
  const { err } = await _run(['-hide_banner', '-i', file]);
  const m = String(err).match(/Duration:\s*(\d+):(\d+):(\d+\.?\d*)/);
  return m ? (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]) : 0;
}

// Deterministic, so a caller can ask "is it already there?" without running ffmpeg.
// Kept byte-identical to the naming routes/generate.js has been using, so files
// extracted by the old workflow are reused rather than made a second time.
function audioUrlFor(videoUrl) {
  const src = localFromUrl(videoUrl);
  if (!src) return null;
  return '/uploads/' + path.basename(src).replace(/\.[^.]+$/, '') + '_av.mp3';
}

// Returns { audio, dur, reused }. Throws with a reason a person can act on.
async function extractAudio(videoUrl) {
  if (!_ffmpeg) throw new Error('ffmpeg not available');
  const src = localFromUrl(videoUrl);
  if (!src || !fs.existsSync(src)) throw new Error('clip not on disk: ' + videoUrl);

  const outUrl  = audioUrlFor(videoUrl);
  const outDisk = path.join(ROOT, outUrl.replace(/^\/+/, ''));
  const dur = await mediaDur(src);
  if (fs.existsSync(outDisk) && fs.statSync(outDisk).size > 0) return { audio: outUrl, dur, reused: true };

  try { fs.mkdirSync(path.dirname(outDisk), { recursive: true }); } catch (e) {}
  const args = ['-y', '-i', src, '-vn'];
  // apad then -t: silence-pad the tail, then cut to the video's exact length.
  if (dur > 0) args.push('-af', 'apad', '-t', dur.toFixed(2));
  args.push('-acodec', 'libmp3lame', '-q:a', '4', outDisk);

  const { code, err } = await _run(args);
  if (code !== 0 || !fs.existsSync(outDisk)) {
    throw new Error('ffmpeg exit ' + code + ': ' + String(err).slice(-200));
  }
  return { audio: outUrl, dur, reused: false };
}

module.exports = { extractAudio, audioUrlFor, localFromUrl, mediaDur };
