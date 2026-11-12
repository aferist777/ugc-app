'use strict';

/* render-finish.js - what a project's export settings do to its render.

   The talking-head editor's Export had these, and the owner renders with them: the size and
   quality the film is encoded at and a playback speed for the whole film. Merge keeps one editor
   (docs/local-app/PLAN.md, phase 3), so they are the blank project's now. (phase V75, the owner's (кп5)-(кп7)) The colour
   correction is each clip's since (public/js/overlay/color.js), and the Extras - a noise under the sound, minutes of black
   after the end - are gone: a project's old values of them are not read.

   settingsOf(adv, frame) -> the settings a render uses, every value checked and defaulted:
     { w, h, fps, crf, preset, audioBitrate, speed, srt }
     srt    the subtitle lane written beside the video as <name>.en_US.srt (lib/mv3b-job.js; phase V30, block 4)
     w, h   the size the file is encoded at - the frame's own, or a smaller one of the same shape

   The size is part of the render's own graph (lib/mv3b-job.js). The speed works on the finished FILE, and is here:

     speed(inAbs, outAbs, s, onTime)    the whole film faster or slower. After the captions are burnt
                                        in, so the words keep pace with the mouth; the voice keeps its
                                        pitch (atempo).

   `s` is what settingsOf returned; onTime(seconds) is told how far ffmpeg has got. */

const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');

const ADV = {
  resolution: '',          // '' or the frame's own size; a smaller 'WxH' of the same shape
  fps: 30,
  crf: 20,
  preset: 'veryfast',
  audioBitrate: '192k',
  playbackSpeed: 1,
  srt: true,               // the subtitle lane as a .srt beside the video (phase V30, block 4, (с11)) - on unless turned off
};

const PRESETS = ['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium', 'slow'];
const RATE = 44100;        // every render's sound

const num = (v, lo, hi, dflt) => {
  const n = Number(v);
  return (v != null && v !== '' && Number.isFinite(n)) ? Math.max(lo, Math.min(hi, n)) : dflt;
};
const even = (n) => Math.max(2, Math.round(n / 2) * 2);

function settingsOf(adv, frame) {
  const a = Object.assign({}, ADV, (adv && typeof adv === 'object') ? adv : {});
  const fw = frame.w, fh = frame.h;
  // A smaller size of the SAME shape only. A project's frame is its own decision, and a size
  // written for the other orientation (an old setting, a changed format) is not a way to change it.
  let w = fw, h = fh;
  const m = /^(\d{2,5})x(\d{2,5})$/.exec(String(a.resolution || ''));
  if (m) {
    const rw = +m[1], rh = +m[2];
    if ((rw > rh) === (fw > fh) && rw <= fw && rh <= fh) { w = even(rw); h = even(rh); }
  }
  return {
    w, h,
    fps: [24, 25, 30, 50, 60].includes(+a.fps) ? +a.fps : 30,
    crf: Math.round(num(a.crf, 0, 51, 20)),
    preset: PRESETS.includes(String(a.preset)) ? String(a.preset) : 'veryfast',
    audioBitrate: /^\d{2,3}k$/.test(String(a.audioBitrate)) ? String(a.audioBitrate) : '192k',
    speed: num(a.playbackSpeed, 0.25, 4, 1),
    srt: a.srt !== false,
  };
}

// The encoder arguments every file here is written with, so a film and its speed pass agree.
// (phase V49.2) `enc` is a merge's own way (lib/merge-clips.js): { video, rate } - the video encoder's arguments (the NVIDIA
// card's NVENC, or x264 ultrafast) and the frame rate, in place of the export's x264 and fps. An export and its speed pass
// pass none and are written exactly as before.
function encoderArgs(s, enc) {
  const video = enc && Array.isArray(enc.video) ? enc.video : ['-c:v', 'libx264', '-preset', s.preset, '-crf', String(s.crf)];
  return [...video, '-pix_fmt', 'yuv420p', '-r', String((enc && enc.rate) || s.fps),
          '-c:a', 'aac', '-b:a', s.audioBitrate, '-ar', String(RATE), '-ac', '2'];
}

function run(args, onTime) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, ['-hide_banner', '-y', ...args], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    let log = '';
    proc.stderr.on('data', (d) => {
      const chunk = d.toString();
      log = (log + chunk).slice(-3000);
      const m = /time=(\d+):(\d\d):(\d\d(?:\.\d+)?)/.exec(chunk);
      if (m && onTime) { try { onTime((+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3])); } catch (e) { /* a progress reader */ } }
    });
    proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error('ffmpeg exited ' + code + ': ' + log.split('\n').filter(Boolean).slice(-2).join(' | ')))));
    proc.on('error', reject);
  });
}

function atempo(speed) {
  const out = [];
  let r = speed;
  while (r > 2.0001) { out.push('atempo=2'); r /= 2; }
  while (r < 0.4999) { out.push('atempo=0.5'); r *= 2; }
  out.push('atempo=' + r.toFixed(6));
  return out.join(',');
}

async function speed(inAbs, outAbs, s, onTime) {
  await run(['-i', inAbs, '-filter:v', `setpts=PTS/${s.speed}`, '-filter:a', atempo(s.speed),
             ...encoderArgs(s), '-movflags', '+faststart', outAbs], onTime);
}

module.exports = { ADV, settingsOf, encoderArgs, speed, RATE };
