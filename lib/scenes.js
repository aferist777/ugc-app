'use strict';

// ════════════════════════════════════════════════════════════════════════════
// THE SCENES OF A VIDEO. The viewer's "Scenes" (js/cut.js) lays a video's scenes edge to edge as
// fragments; this finds where its shots change.
//
// ffmpeg's scdet over the first video stream, scaled to 480 wide - the threshold the highlights faces read podcasts' camera
// switches by (lib/faces.js SCDET 10, checked by eye) - with no faces window: nothing but the times. What the times
// make into scenes is ONE rule for the page and the server, js/cuts/parts.js scenesOf (changes closer than 0.6 s are one, a
// scene is never shorter than 1 s).
//
// Long: an hour of H.264 1080p in ~2 minutes, VP9 ~4, AV1 ~8. So it is a job: one per file at a time,
// asked again for its progress (`status`), going on while the viewer is closed, cancelled by `cancel`; the answer kept in
// cache/scenes/ (what is made again when missing) by the file's path, size and time - a second look is at once. Nothing is
// paid: no row in Alerts.
//
//   status(abs)   { state: 'none' | 'working' | 'done' | 'failed', pct, changes, dur, error }
//   start(abs)    the job begun when there is neither an answer nor a job - then status(abs)
//   cancel(abs)   the job stopped (its half is not kept)
// ════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const { CACHE_DIR } = require('./config');
const { writeFileAtomic } = require('./atomic-write');

const VERSION = 1;
const THRESHOLD = 10;
const DIR = path.join(CACHE_DIR, 'scenes');
const _jobs = new Map();            // key -> { state, pct, proc, error, stopped }

const r3 = (x) => Math.round(x * 1000) / 1000;

function keyOf(abs) {
  let st = null;
  try { st = fs.statSync(abs); } catch (e) { return ''; }
  return crypto.createHash('sha1').update(path.resolve(abs).toLowerCase() + '|' + st.size + '|' + Math.floor(st.mtimeMs)).digest('hex').slice(0, 24);
}
const _file = (key) => path.join(DIR, key + '.json');

function _kept(key) {
  try {
    const rec = JSON.parse(fs.readFileSync(_file(key), 'utf8'));
    return rec && rec.v === VERSION && Array.isArray(rec.changes) ? rec : null;
  } catch (e) { return null; }
}

function status(abs) {
  const key = keyOf(abs);
  if (!key) return { state: 'failed', error: 'that video is not on disk' };
  const rec = _kept(key);
  if (rec) return { state: 'done', pct: 100, changes: rec.changes, dur: rec.dur };
  const job = _jobs.get(key);
  if (!job) return { state: 'none', pct: 0 };
  return { state: job.state, pct: Math.round(job.pct || 0), error: job.error || '' };
}

function start(abs) {
  const key = keyOf(abs);
  if (!key) return status(abs);
  if (_kept(key)) return status(abs);
  const was = _jobs.get(key);
  if (was && was.state === 'working') return status(abs);
  const job = { state: 'working', pct: 0, proc: null, error: '', stopped: false };
  _jobs.set(key, job);
  const args = ['-hide_banner', '-nostdin', '-loglevel', 'info', '-i', abs, '-map', '0:v:0', '-an', '-sn', '-dn',
    '-vf', `scale=480:-2,scdet=threshold=${THRESHOLD}`, '-f', 'null', '-'];
  let p;
  try { p = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true }); }
  catch (e) { job.state = 'failed'; job.error = e.message; return status(abs); }
  job.proc = p;
  const changes = [];
  let dur = 0, tail = '', last = '';
  p.stderr.on('data', (c) => {
    const s = tail + c.toString();
    const lines = s.split(/\r|\n/);
    tail = lines.pop();
    for (const l of lines) {
      if (l) last = l;
      if (!dur) {
        const d = /Duration:\s*(\d+):(\d+):(\d+\.?\d*)/.exec(l);
        if (d) dur = +d[1] * 3600 + +d[2] * 60 + parseFloat(d[3]);
      }
      const m = /lavfi\.scd\.time:\s*([\d.]+)/.exec(l);
      if (m) changes.push(r3(+m[1]));
      const t = /time=(\d+):(\d+):(\d+\.?\d*)/.exec(l);
      if (t && dur > 0) job.pct = Math.min(99, ((+t[1] * 3600 + +t[2] * 60 + parseFloat(t[3])) / dur) * 100);
    }
  });
  p.on('error', (e) => { job.state = 'failed'; job.error = e.message; job.proc = null; });
  p.on('close', (code) => {
    job.proc = null;
    if (job.stopped) { _jobs.delete(key); return; }
    if (code !== 0) { job.state = 'failed'; job.error = 'could not read the video: ' + String(last).slice(-160); return; }
    try {
      fs.mkdirSync(DIR, { recursive: true });
      writeFileAtomic(_file(key), JSON.stringify({ v: VERSION, dur: r3(dur), changes: [...new Set(changes)].sort((a, b) => a - b),
        at: new Date().toISOString() }));
      _jobs.delete(key);
    } catch (e) { job.state = 'failed'; job.error = e.message; }
  });
  return status(abs);
}

function cancel(abs) {
  const key = keyOf(abs);
  const job = key && _jobs.get(key);
  if (!job) return false;
  job.stopped = true;
  if (job.proc) { try { job.proc.kill(); } catch (e) { /* gone */ } }
  else _jobs.delete(key);
  return true;
}

module.exports = { status, start, cancel, keyOf };
