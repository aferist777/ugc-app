'use strict';

// ════════════════════════════════════════════════════════════════════════════
// A SOUND'S FILE AT ANOTHER PITCH (phase V76, the owner 2026-11-06; docs/local-app/plan/, "Фаза V76"). A clip with `pitch`
// (public/js/sound/pitch.js) is heard from a copy of its file with the pitch moved - the preview plays it (GET /api/pitch-copy,
// routes/track-peaks.js), the render takes it as the clip's input (lib/mv3b-job.js) - so what is heard while cutting is what
// the film says.
//
//   copyOf(abs, pitch, { rev }) -> Promise<abs of the copy>   made once, kept; `rev` - from the sound played backwards (the
//                                                             preview's reversed clip; the render reverses in its graph)
//   sweep(timelines)                                          at the start: the copies no clip names go (V91 block 5)
//
// The copy is the file's first sound track, stereo, rubberband in the app's ffmpeg, padded or cut to the file's length to the
// sample (rubberband leaves it ~20 ms short), as 16-bit WAV at 48 kHz - exact to seek in the preview, lossless for the render.
// Kept in cache/pitch/ - what is made again when missing - by the file's path, size and time, the semitones and the timbre; a
// file changed in place gets new copies and its old ones go. One ffmpeg at a time; two askers of one copy share the making.
// Measured 2026-11-06: three minutes of stereo in 11-15 s, a line of ten seconds in under one.
// ════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const { CACHE_DIR } = require('./config');
const PROBE = require('./media-probe');
const P = require('../public/js/sound/pitch.js');

const DIR = path.join(CACHE_DIR, 'pitch');

const _stem = (abs) => crypto.createHash('sha1').update(path.resolve(abs).toLowerCase()).digest('hex').slice(0, 20);
function _file(abs, st, p, rev) {
  return path.join(DIR, _stem(abs) + '-' + st.size + '-' + Math.round(st.mtimeMs) + '-' + P.tagOf(p) + (rev ? 'r' : '') + '.wav');
}
function _stat(abs) {
  try { const st = fs.statSync(abs); return st.isFile() ? st : null; } catch (e) { return null; }
}

function _run(args) {
  return new Promise((resolve, reject) => {
    let err = '';
    const proc = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    proc.stderr.on('data', (c) => { err = (err + c.toString()).slice(-2000); });
    proc.on('error', reject);
    proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error('ffmpeg: ' + (err.trim().split('\n').pop() || 'exit ' + code)))));
  });
}

let _chain = Promise.resolve();
const _busy = new Map();          // copy file -> Promise<abs>

function copyOf(abs, pitch, { rev } = {}) {
  const p = P.normalizePitch(pitch);
  if (!p) return Promise.resolve(abs);
  const st = _stat(abs);
  if (!st) return Promise.reject(new Error('not on disk'));
  const file = _file(abs, st, p, rev);
  if (fs.existsSync(file)) return Promise.resolve(file);
  if (_busy.has(file)) return _busy.get(file);
  const job = _chain.then(async () => {
    if (fs.existsSync(file)) return file;
    const pr = await PROBE.probe(abs);
    if (!pr.audio) throw new Error('no sound in it');
    if (!(pr.duration > 0)) throw new Error('its length could not be read');
    fs.mkdirSync(DIR, { recursive: true });
    const tmp = file + '.' + process.pid + '.part.wav';
    const graph = '[0:a]aformat=channel_layouts=stereo,' + (rev ? 'areverse,' : '') + P.filterOf(p)
      + ',apad,atrim=0:' + pr.duration.toFixed(6) + '[o]';
    try {
      await _run(['-hide_banner', '-nostdin', '-v', 'error', '-y', '-i', abs, '-filter_complex', graph, '-map', '[o]',
        '-ar', '48000', '-c:a', 'pcm_s16le', '-f', 'wav', tmp]);
      fs.renameSync(tmp, file);
    } finally { fs.rmSync(tmp, { force: true }); }
    // The copies of this file as it was before it changed are of no use to anybody.
    const stem = _stem(abs) + '-', now = stem + st.size + '-' + Math.round(st.mtimeMs) + '-';
    for (const f of fs.readdirSync(DIR)) {
      if (f.startsWith(stem) && !f.startsWith(now) && f.endsWith('.wav')) { try { fs.unlinkSync(path.join(DIR, f)); } catch (e) { /* in use */ } }
    }
    return file;
  });
  _chain = job.catch(() => {});
  _busy.set(file, job);
  job.finally(() => _busy.delete(file)).catch(() => {});
  return job;
}

/**
 * (V91 block 5, the owner's (чк15)) At the start: the copies no clip of any timeline names go - a pitch moved back to 0,
 * a clip deleted, a file changed. A copy younger than ten minutes stays (made for a pitch not saved yet). How many went.
 */
function sweep(timelines) {
  let names = [];
  try { names = fs.readdirSync(DIR); } catch (e) { return 0; }
  if (!names.length) return 0;
  const { toDisk } = require('./media');
  const keep = new Set();
  for (const tl of timelines || []) {
    for (const tr of (tl && tl.tracks) || []) {
      for (const c of (tr && tr.clips) || []) {
        const p = c && c.src ? P.normalizePitch(c.pitch) : null;
        if (!p) continue;
        const abs = toDisk(c.src);
        const st = abs && _stat(abs);
        if (!st) continue;
        const base = path.basename(_file(abs, st, p, false), '.wav');
        keep.add(base + '.wav');
        keep.add(base + 'r.wav');
      }
    }
  }
  const young = Date.now() - 10 * 60 * 1000;
  let gone = 0;
  for (const f of names) {
    if (keep.has(f) || !f.endsWith('.wav') || f.includes('.part.')) continue;
    const abs = path.join(DIR, f);
    const st = _stat(abs);
    if (!st || st.mtimeMs > young || _busy.has(abs)) continue;
    try { fs.unlinkSync(abs); gone++; } catch (e) { /* in use: the next start */ }
  }
  return gone;
}

module.exports = { DIR, copyOf, sweep };

