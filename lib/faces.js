'use strict';

/* faces.js - where the faces are in a film, five times a second, and where its shots change (phase V33.2, the owner
   2026-10-20/21; the measurement and the answers (х7)-(х9) are docs/local-app/PLAN.md "Фаза V33", V33.2).

   WHO COUNTS. MediaPipe's face detector is made for a browser (WebAssembly and WebGL) and does not run in the server's
   Node, and a page of the app counts only while it is open. So the app keeps a HIDDEN WINDOW (desktop/faces.js, the page
   public/faces-worker.html) that asks this file for work over the loopback and answers with boxes: it counts whatever
   page the person is on, on the window's graphics card when it has one. Without the desktop shell (`npm run server`)
   nobody asks for work, and find() says so (`noWorker`) - the caller frames the clip without the faces.

   WHAT IT IS HANDED. The film's frames five a second, 480 wide, raw RGBA, straight out of ffmpeg into the response the
   window reads (GET /api/faces/frames/:id) - nothing is written to the disk on the way. The same ffmpeg runs scdet on
   every frame before the five are taken: the times the SHOT CHANGES (a podcast's camera switching), read off its log.

   WHAT IS KEPT. cache/faces/<key>.json - made again when missing, keyed by the file's path, size and time (a file changed
   or moved is counted again; it costs a second or two a minute of H.264):
     { v, w, h (the film's frame), fw, fh (the frames counted), fps, seconds, frames: [[[x, y, w, h, score], ...], ...]
       (each frame's boxes, fractions of the frame), cuts: [seconds], model, delegate, msPerFrame, at }

   One window, one film at a time (its graphics card): the rest wait in order. */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const { CACHE_DIR } = require('./config');
const { writeFileAtomic } = require('./atomic-write');
const PROBE = require('./media-probe');

const VERSION = 1;
const FPS = 5;
const FW = 480;                       // the frames' width - the detector scales to 192x192 by itself
const SCDET = 10;                     // scdet's threshold: the podcast's camera switches, checked by eye (PLAN, V33.2)
const DIR = path.join(CACHE_DIR, 'faces');
const WAIT_WORKER_MS = 45000;         // a window that never asks in this long is not there (no desktop shell)
const SEEN_MS = 40000;                // a window that asked this recently is there
const POLL_MS = 25000;                // how long a window's ask for work is held open
const STALL_MS = 90000;               // a film handed out that moves no frame in this long is handed out again, once

const r3 = (x) => Math.round(x * 1000) / 1000;

function keyOf(abs) {
  let st = null;
  try { st = fs.statSync(abs); } catch (e) { return ''; }
  return crypto.createHash('sha1').update(path.resolve(abs).toLowerCase() + '|' + st.size + '|' + Math.floor(st.mtimeMs)).digest('hex').slice(0, 24);
}
const _file = (key) => path.join(DIR, key + '.json');

/** The faces of a film counted before, or null. */
function cached(abs) {
  const key = keyOf(abs);
  if (!key) return null;
  try {
    const rec = JSON.parse(fs.readFileSync(_file(key), 'utf8'));
    return rec && rec.v === VERSION ? rec : null;
  } catch (e) { return null; }
}

// ── The work and the window ────────────────────────────────────────────────
const _jobs = new Map();              // id -> job
const _order = [];                    // ids waiting for the window
const _polls = [];                    // the window's asks held open: { res, timer }
let _seenAt = 0;                      // the window last asked
let _bootAt = Date.now();
let _n = 0;

const workerSeen = () => Date.now() - _seenAt < SEEN_MS;

function _frameH(w, h) { return Math.max(2, Math.round(FW * (h > 0 && w > 0 ? h / w : 9 / 16) / 2) * 2); }

/**
 * The faces of the film at `abs` - counted before, or counted now by the window. `onFrac(0..1)` follows it. Rejects with
 * `noWorker: true` when there is no window to count (no desktop shell), and with `cancelled` when `signal` aborts.
 */
function find(abs, { onFrac, signal } = {}) {
  const have = cached(abs);
  if (have) return Promise.resolve(have);
  const key = keyOf(abs);
  if (!key) return Promise.reject(new Error('the film is not on the disk'));
  // Long past the start and no window ever asked: there is none (no desktop shell) - said at once, not after a wait each.
  if (!workerSeen() && Date.now() - _bootAt > WAIT_WORKER_MS) {
    const why = 'the faces are counted in the app window - not running here';
    _failed.set(key, { error: why, noWorker: true, at: Date.now() });
    return Promise.reject(Object.assign(new Error(why), { noWorker: true }));
  }
  let job = [..._jobs.values()].find((j) => j.key === key && !j.over);
  if (!job) {
    job = { id: 'f' + (++_n).toString(36) + Date.now().toString(36), key, abs, state: 'waiting', at: Date.now(), sent: 0, bytes: 0,
      cuts: [], ffmpegDone: null, handedAt: 0, handed: 0, over: false, listeners: new Set(), waiters: [] };
    job.promise = new Promise((resolve, reject) => { job.resolve = resolve; job.reject = reject; });
    job.promise.catch(() => { /* every caller has its own handler */ });
    _failed.delete(key);
    _jobs.set(job.id, job);
    _order.push(job.id);
    _pump();
    _watch();
  }
  if (onFrac) job.listeners.add(onFrac);
  const mine = new Promise((resolve, reject) => {
    const off = () => { if (onFrac) job.listeners.delete(onFrac); };
    job.promise.then((r) => { off(); resolve(r); }, (e) => { off(); reject(e); });
    if (signal) {
      const stop = () => {
        off();
        reject(Object.assign(new Error('cancelled'), { cancelled: true }));
        // Nobody else waiting for this film: it is not counted.
        if (!job.listeners.size && job.waiters.length <= 1) _end(job, Object.assign(new Error('cancelled'), { cancelled: true }));
      };
      if (signal.aborted) stop(); else signal.addEventListener('abort', stop, { once: true });
    }
  });
  job.waiters.push(mine);
  return mine;
}

// The last film that could not be counted, by key - what a clip's switch says instead of waiting (block 5).
const _failed = new Map();

function _end(job, err, rec) {
  if (job.over) return;
  job.over = true;
  if (err && !err.cancelled) {
    _failed.set(job.key, { error: String(err.message || err).slice(0, 200), noWorker: !!err.noWorker, at: Date.now() });
    if (_failed.size > 200) _failed.delete(_failed.keys().next().value);
  }
  _jobs.delete(job.id);
  const i = _order.indexOf(job.id);
  if (i >= 0) _order.splice(i, 1);
  if (job.proc) { try { job.proc.kill(); } catch (e) { /* gone */ } }
  if (err) job.reject(err); else job.resolve(rec);
  _pump();
}

function _tell(job) {
  const frac = job.bytes > 0 ? Math.min(0.99, job.sent / job.bytes) : 0;
  for (const f of job.listeners) { try { f(frac); } catch (e) { /* a listener's own trouble */ } }
}

// The window's ask held open is answered with the next film, or with nothing after POLL_MS.
function _pump() {
  while (_polls.length && _order.length) {
    const job = _jobs.get(_order.shift());
    if (!job || job.over) continue;
    const poll = _polls.shift();
    clearTimeout(poll.timer);
    _hand(job, poll.res).catch((e) => _end(job, e));
  }
}

async function _hand(job, res) {
  const p = await PROBE.probe(job.abs).catch(() => ({}));
  if (!(p.duration > 0) || !(p.w > 0)) {
    res.json({ job: null });
    return _end(job, new Error('the film could not be read'));
  }
  const side = p.rotate === 90 || p.rotate === 270;
  const w = side ? p.h : p.w, h = side ? p.w : p.h;
  job.w = w; job.h = h; job.seconds = p.duration;
  job.fw = FW; job.fh = _frameH(w, h);
  job.n = Math.max(1, Math.ceil(p.duration * FPS));
  job.bytes = job.n * job.fw * job.fh * 4;
  job.state = 'counting';
  job.handedAt = Date.now();
  job.lastAt = Date.now();
  job.handed++;
  job.sent = 0;
  res.json({ job: { id: job.id, frames: '/api/faces/frames/' + job.id, fw: job.fw, fh: job.fh, n: job.n, fps: FPS } });
}

/**
 * GET /api/faces/next?wait=1 - the window asks for work; held open until there is some. Without `wait` (anything else that
 * reads the address - the smoke check) it answers at once with nothing and the window is not taken to be there.
 */
function next(req, res) {
  if (String(req.query.wait || '') !== '1') return res.json({ job: null });
  _seenAt = Date.now();
  if (_order.length) {
    _polls.push({ res, timer: null });
    return _pump();
  }
  const poll = { res, timer: null };
  poll.timer = setTimeout(() => {
    const i = _polls.indexOf(poll);
    if (i >= 0) _polls.splice(i, 1);
    _seenAt = Date.now();
    try { res.json({ job: null }); } catch (e) { /* gone */ }
  }, POLL_MS);
  _polls.push(poll);
  req.on('close', () => {
    const i = _polls.indexOf(poll);
    if (i >= 0) { _polls.splice(i, 1); clearTimeout(poll.timer); }
  });
}

/** GET /api/faces/frames/:id - the film's frames, raw RGBA, five a second; the shots' changes read off scdet's log. */
function frames(req, res) {
  const job = _jobs.get(String(req.params.id || ''));
  if (!job || job.over || job.state !== 'counting') return res.status(404).end();
  _seenAt = Date.now();
  const args = ['-hide_banner', '-nostdin', '-loglevel', 'info', '-i', job.abs, '-map', '0:v:0', '-an', '-sn', '-dn',
    '-vf', `scale=${job.fw}:${job.fh},scdet=threshold=${SCDET},fps=${FPS}`, '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1'];
  const p = spawn(ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  job.proc = p;
  job.cuts = [];
  let tail = '';
  p.stderr.on('data', (c) => {
    const s = tail + c.toString();
    const lines = s.split(/\r?\n/);
    tail = lines.pop();
    for (const l of lines) {
      const m = /lavfi\.scd\.time: ([\d.]+)/.exec(l);
      if (m) job.cuts.push(r3(+m[1]));
    }
  });
  job.ffmpegDone = new Promise((resolve) => p.on('close', (code) => { job.proc = null; resolve(code); }));
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Cache-Control', 'no-store');
  p.stdout.on('data', (c) => { job.sent += c.length; job.lastAt = Date.now(); _tell(job); });
  p.stdout.pipe(res);
  p.on('error', () => { try { res.end(); } catch (e) { /* gone */ } });
  req.on('close', () => { if (job.proc) { try { job.proc.kill(); } catch (e) { /* gone */ } } });
}

/** POST /api/faces/:id/done - the window's answer: every frame's boxes. */
async function done(req, res) {
  const job = _jobs.get(String(req.params.id || ''));
  if (!job || job.over) return res.status(404).json({ success: false });
  _seenAt = Date.now();
  const b = req.body || {};
  const got = Array.isArray(b.frames) ? b.frames : [];
  if (job.ffmpegDone) await job.ffmpegDone;
  const box = (x) => (Array.isArray(x) && x.length >= 4 ? x.slice(0, 5).map((v) => r3(+v || 0)) : null);
  const rec = {
    v: VERSION, w: job.w, h: job.h, fw: job.fw, fh: job.fh, fps: FPS, seconds: r3(job.seconds),
    frames: got.map((f) => (Array.isArray(f) ? f.map(box).filter(Boolean) : [])),
    cuts: [...new Set(job.cuts)].sort((x, y) => x - y),
    model: String(b.model || '').slice(0, 60), delegate: String(b.delegate || '').slice(0, 10),
    msPerFrame: Math.round((+b.msPerFrame || 0) * 10) / 10, at: new Date().toISOString(),
  };
  try {
    fs.mkdirSync(DIR, { recursive: true });
    writeFileAtomic(_file(job.key), JSON.stringify(rec));
  } catch (e) { console.warn('[faces] could not keep the faces of', path.basename(job.abs), '-', e.message); }
  const found = rec.frames.filter((f) => f.length).length;
  console.log(`[faces] ${path.basename(job.abs)}: ${rec.frames.length} frames, a face in ${found}, ${rec.cuts.length} cuts, ` +
    `${rec.msPerFrame} ms a frame (${rec.delegate})`);
  res.json({ success: true });
  _end(job, null, rec);
}

/** POST /api/faces/:id/fail - the window could not count it (the model would not load, the frames broke off). */
function fail(req, res) {
  const job = _jobs.get(String(req.params.id || ''));
  if (job && !job.over) {
    _seenAt = Date.now();
    const why = String((req.body || {}).error || 'the faces window could not count it').slice(0, 300);
    console.warn('[faces]', path.basename(job.abs) + ':', why);
    _end(job, new Error(why));
  }
  res.json({ success: true });
}

// A film waiting with no window to hand it to - none ever asked, or none asked for a while - is given up (`noWorker`); a
// film handed out that stopped moving (the window's page died) goes back to the front of the line once.
let _watching = null;
function _watch() {
  if (_watching) return;
  _watching = setInterval(() => {
    const now = Date.now();
    for (const job of [..._jobs.values()]) {
      if (job.over) continue;
      if (job.state === 'waiting' && !workerSeen() && now - Math.max(job.at, _bootAt) > WAIT_WORKER_MS) {
        _end(job, Object.assign(new Error('the faces are counted in the app window - not running here'), { noWorker: true }));
      } else if (job.state === 'counting' && now - (job.lastAt || job.handedAt) > STALL_MS) {
        if (job.handed >= 2) { _end(job, new Error('the faces window did not answer')); continue; }
        if (job.proc) { try { job.proc.kill(); } catch (e) { /* gone */ } }
        job.state = 'waiting';
        _order.unshift(job.id);
        _pump();
      }
    }
    if (!_jobs.size) { clearInterval(_watching); _watching = null; }
  }, 2000);
  _watching.unref();
}

/**
 * Where a film stands: 'ready' (counted - with its record when `full`), 'counting' with how far, 'waiting', 'failed'
 * (with why, and `noWorker` when there is no window to count), or 'none'.
 */
function status(abs, full) {
  const have = cached(abs);
  if (have) return { state: 'ready', frac: 1, ...(full ? { faces: have } : {}) };
  const key = keyOf(abs);
  const job = key ? [..._jobs.values()].find((j) => j.key === key && !j.over) : null;
  if (!job) {
    const f = key && _failed.get(key);
    return f ? { state: 'failed', frac: 0, error: f.error, noWorker: f.noWorker } : { state: 'none', frac: 0 };
  }
  return { state: job.state, frac: job.bytes ? r3(Math.min(0.99, job.sent / job.bytes)) : 0 };
}

/** GET /api/faces/state - is the window there, what is it doing. */
function state() {
  return { worker: workerSeen(), seenAgoMs: _seenAt ? Date.now() - _seenAt : null, waiting: _order.length,
    counting: [..._jobs.values()].filter((j) => j.state === 'counting').map((j) => ({ file: path.basename(j.abs), frac: j.bytes ? r3(j.sent / j.bytes) : 0 })) };
}

module.exports = { VERSION, FPS, cached, find, status, keyOf, next, frames, done, fail, state, workerSeen, _resetBoot: () => { _bootAt = Date.now(); } };
