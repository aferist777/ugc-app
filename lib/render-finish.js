'use strict';

/* render-finish.js - what a project's export settings do to its render.

   The talking-head editor's Export had these, and the owner renders with them: the size and
   quality the film is encoded at, a colour correction, a playback speed for the whole film, a quiet
   noise under the sound, and minutes of black after the end. Merge keeps one editor
   (docs/local-app/PLAN.md, phase 3), so they are the blank project's now.

   settingsOf(adv, frame) -> the settings a render uses, every value checked and defaulted:
     { w, h, fps, crf, preset, audioBitrate, eq, speed, tailMinutes, noise }
     w, h   the size the file is encoded at - the frame's own, or a smaller one of the same shape
     eq     null, or { brightness, contrast, saturation, gamma } when any of them is not neutral
     noise  null, or { color, volume }

   The colour, the noise and the size are part of the render's own graph (lib/mv3b-job.js). The
   other two work on the finished FILE, and are here:

     speed(inAbs, outAbs, s, onTime)    the whole film faster or slower. After the captions are burnt
                                        in, so the words keep pace with the mouth; the voice keeps its
                                        pitch (atempo).
     blackTail(fileAbs, s, onTime)      s.tailMinutes of silent black joined on by copying - the tail is
                                        encoded once per size and kept in scratch, with the render's
                                        own numbers, so the two streams can be joined without encoding
                                        the film again.

   `s` is what settingsOf returned; onTime(seconds) is told how far ffmpeg has got. */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const { TEMP_DIR } = require('./config');

const ADV = {
  resolution: '',          // '' or the frame's own size; a smaller 'WxH' of the same shape
  fps: 30,
  crf: 20,
  preset: 'veryfast',
  audioBitrate: '192k',
  eqBrightness: 0, eqContrast: 1, eqSaturation: 1, eqGamma: 1,
  playbackSpeed: 1,
  extra1: 'none',          // black5 | black10 | black20 | black30
  extra2: 'none',          // wn_<white|pink|brown>_<1..5>
};

const PRESETS = ['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium', 'slow'];
const RATE = 44100;        // every render's sound, so the black tail's silence matches it
const TAIL_DIR = path.join(TEMP_DIR, 'black_tails');

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
  const eq = {
    brightness: num(a.eqBrightness, -1, 1, 0),
    contrast: num(a.eqContrast, 0, 3, 1),
    saturation: num(a.eqSaturation, 0, 3, 1),
    gamma: num(a.eqGamma, 0.1, 10, 1),
  };
  const neutral = eq.brightness === 0 && eq.contrast === 1 && eq.saturation === 1 && eq.gamma === 1;
  const tail = /^black(\d+)$/.exec(String(a.extra1 || ''));
  const noise = /^wn_(white|pink|brown)_([1-5])$/.exec(String(a.extra2 || ''));
  return {
    w, h,
    fps: [24, 25, 30, 50, 60].includes(+a.fps) ? +a.fps : 30,
    crf: Math.round(num(a.crf, 0, 51, 20)),
    preset: PRESETS.includes(String(a.preset)) ? String(a.preset) : 'veryfast',
    audioBitrate: /^\d{2,3}k$/.test(String(a.audioBitrate)) ? String(a.audioBitrate) : '192k',
    eq: neutral ? null : eq,
    speed: num(a.playbackSpeed, 0.25, 4, 1),
    tailMinutes: tail && [5, 10, 20, 30].includes(+tail[1]) ? +tail[1] : 0,
    noise: noise ? { color: noise[1], volume: +noise[2] / 100 } : null,
  };
}

// The encoder arguments every file here is written with, so a tail and a film agree.
function encoderArgs(s) {
  return ['-c:v', 'libx264', '-preset', s.preset, '-crf', String(s.crf), '-pix_fmt', 'yuv420p', '-r', String(s.fps),
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

async function _tailFile(s) {
  fs.mkdirSync(TAIL_DIR, { recursive: true });
  const name = `black_${s.tailMinutes}m_${s.w}x${s.h}_${s.fps}_${s.preset}_${s.crf}_${s.audioBitrate}.mp4`;
  const abs = path.join(TAIL_DIR, name);
  if (fs.existsSync(abs)) return abs;
  const dur = s.tailMinutes * 60;
  const tmp = abs.replace(/\.mp4$/, '.part.mp4');
  await run(['-f', 'lavfi', '-i', `color=c=black:s=${s.w}x${s.h}:r=${s.fps}:d=${dur}`,
             '-f', 'lavfi', '-i', `anullsrc=channel_layout=stereo:sample_rate=${RATE}`,
             '-t', String(dur), ...encoderArgs(s), '-shortest', '-movflags', '+faststart', tmp]);
  fs.renameSync(tmp, abs);
  return abs;
}

async function blackTail(fileAbs, s, onTime) {
  const tail = await _tailFile(s);
  const list = path.join(TAIL_DIR, 'concat_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6) + '.txt');
  const line = (p) => `file '${p.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`;
  fs.writeFileSync(list, line(fileAbs) + '\n' + line(tail) + '\n', 'utf8');
  const joined = fileAbs.replace(/\.mp4$/i, '') + '.tail.mp4';
  try {
    await run(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', joined], onTime);
    fs.rmSync(fileAbs, { force: true });
    fs.renameSync(joined, fileAbs);
  } finally {
    fs.rmSync(list, { force: true });
    fs.rmSync(joined, { force: true });
  }
}

module.exports = { ADV, settingsOf, encoderArgs, speed, blackTail, RATE };
