'use strict';

// ════════════════════════════════════════════════════════════════════════════
// A SOUND'S PEAKS ON THE TIMELINE - so the person can trim silence by hand. Every sound clip on Merge's lanes - a sound, a track of music, a
// film's own sound - draws its waveform from these, at whatever zoom.
//
//   peaksOf(abs) -> Promise<Buffer>   one byte a peak, RATE peaks a second of the file: the loudest sample of its 1/RATE s,
//                                     0..255 of the FILE's own loudest (a quiet recording is drawn as tall as a loud one;
//                                     what is silence beside its words stays flat). Empty for a file with no sound.
//
// Read once with the app's ffmpeg (one channel, 8 kHz - 40 samples a peak) and kept in cache/peaks/ - what is made again
// when missing - by the file's path, size and modification time; a file changed in place gets new peaks and its old ones
// go. One ffmpeg at a time, and two askers of one file share the reading. The shelf's 64-point tile wave is
// lib/audio-wave.js; this is the lane's.
// ════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { CACHE_DIR } = require('./config');
const I18N = require('./i18n');

const RATE = 200;                 // peaks a second of the file: at the timeline's widest zoom (240 px/s) a peak is 1.2 px
const SR = 8000;                  // decoded at - one channel
const PER = SR / RATE;            // samples a peak
const DIR = path.join(CACHE_DIR, 'peaks');

const _stem = (abs) => crypto.createHash('sha1').update(path.resolve(abs).toLowerCase()).digest('hex').slice(0, 20);
const _file = (abs, st) => path.join(DIR, _stem(abs) + '-' + st.size + '-' + Math.round(st.mtimeMs) + '.u8');

// Read the sound with ffmpeg, peak by peak as it streams (an hour of film is 58 MB of samples - never held whole).
function _read(abs) {
  return new Promise((resolve) => {
    const ffmpegPath = require('ffmpeg-static');
    const p = spawn(ffmpegPath, ['-hide_banner', '-nostdin', '-v', 'error', '-i', abs, '-vn', '-ac', '1', '-ar', String(SR),
      '-f', 's16le', '-'], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
    const out = [];
    let cur = 0, n = 0, carry = null;
    p.stdout.on('data', (b) => {
      if (carry) { b = Buffer.concat([carry, b]); carry = null; }
      const whole = b.length - (b.length % 2);
      if (whole < b.length) carry = b.subarray(whole);
      for (let i = 0; i < whole; i += 2) {
        let v = b.readInt16LE(i);
        if (v < 0) v = -v;
        if (v > cur) cur = v;
        if (++n === PER) { out.push(cur); cur = 0; n = 0; }
      }
    });
    p.on('error', () => resolve(Buffer.alloc(0)));
    p.on('close', () => {
      if (n > 0) out.push(cur);
      let top = 0;
      for (const v of out) if (v > top) top = v;
      const buf = Buffer.alloc(out.length);
      if (top > 0) for (let i = 0; i < out.length; i++) buf[i] = Math.round(out[i] * 255 / top);
      resolve(buf);
    });
  });
}

// One reading at a time; one reading per file however many ask.
let _chain = Promise.resolve();
const _busy = new Map();          // cache file -> Promise<Buffer>

function peaksOf(abs) {
  let st;
  try { st = fs.statSync(abs); } catch (e) { return Promise.reject(new Error(I18N.t('not on disk'))); }
  if (!st.isFile()) return Promise.reject(new Error(I18N.t('not a file')));
  const file = _file(abs, st);
  try { return Promise.resolve(fs.readFileSync(file)); } catch (e) { /* not read yet */ }
  if (_busy.has(file)) return _busy.get(file);
  const job = _chain.then(async () => {
    try { return fs.readFileSync(file); } catch (e) { /* still not read */ }
    const buf = await _read(abs);
    try {
      fs.mkdirSync(DIR, { recursive: true });
      const tmp = file + '.' + process.pid + '.tmp';
      fs.writeFileSync(tmp, buf);
      fs.renameSync(tmp, file);
      // The peaks of this file as it was before it changed are of no use to anybody.
      const stem = _stem(abs) + '-';
      for (const f of fs.readdirSync(DIR)) {
        if (f.startsWith(stem) && f.endsWith('.u8') && path.join(DIR, f) !== file) { try { fs.unlinkSync(path.join(DIR, f)); } catch (e) { /* in use */ } }
      }
    } catch (e) { console.warn('[track-peaks] not kept:', e.message); }
    return buf;
  });
  _chain = job.catch(() => {});
  _busy.set(file, job);
  job.finally(() => _busy.delete(file)).catch(() => {});
  return job;
}

module.exports = { RATE, peaksOf };
