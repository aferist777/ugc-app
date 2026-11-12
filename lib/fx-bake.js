'use strict';

/* fx-bake.js - THE BAKE ENGINE (phase V84 block 3, the owner 2026-11-10, (б3-1)-(б3-10); docs/local-app/plan/ "Подфаза 3 — V84",
   "Блок 3").

   WHAT IT IS FOR. Some effects are drawn by the PAGE'S CODE only - what ffmpeg cannot do (the glitch's column jitter, Soft sway
   since block 4a - the owner's (б3-7); graphics, cards, screens, copies, per-pixel tearing and the person's mask):
   public/js/fx/effects.js marks them `engine: true`. The stretch of a clip where such an effect runs is BAKED: the app's HIDDEN BAKE
   WINDOW (desktop/faces.js createWorkerWindow, public/bake-worker.html -> js/bake-worker.js) is handed the clip's frames as it lies
   in the frame - the render's own graph for that clip alone, its effects, opacity and blend mode left out (lib/mv3b-job.js prepare
   `raw`), raw I420 read by ffmpeg's own matrix (BT.601, the TV range) -, draws EVERY effect of the clip on them with the preview's
   code (js/merge-v3/fx-draw.js applyFx over params.js paramsAt - one rule), turns the result back into YUV by ffmpeg's rule itself
   in a worker (js/bake-encoder.js: the encoder's own conversion left the copy a little flatter - the owner's app, 2026-11-11),
   encodes H.264 with WebCodecs and sends the pieces back; here they become an mp4 in cache/fx-bake/ - what is made again when missing - by a print of the file, how the clip
   lies in the frame, its lane, its effects, the frame's size and rate and the engine's version. The render lays that copy over the
   stretch in place of the clip (lib/mv3b-render.js `baked`); the preview draws the same code live (the owner's (б3-4)).
   EVERY VIDEO LANE (block 4a, the owner's (б4-1)): main video's copy is the whole frame; a clip of a lane above main is handed to
   the window on a TRANSPARENT frame and its copy keeps the alpha - H.264 has none, so that copy's frame is twice as tall, the colour
   above and the alpha below as grey (`alpha`); the render cuts it and joins the two again, then lays it at the clip's opacity and
   blend mode as it lays the clip.

   WHEN. In the background as soon as a timeline is saved with such an effect (want - the owner's (б3-2), nothing shown on the
   effect's row - the owner 2026-11-10: it only matters to Export), and Export / a merge waits for what is not baked yet (ready);
   with no bake window (the server run alone) nothing bakes and Export says so in words (б3-9). One window, one stretch at a time.
   At the start, copies no timeline needs any more go (sweep, б3-8).

     needsOf(timeline, { w, h, fps }) -> [{ key, abs, clipId, a, b, clip, mini, w, h, fps }]
                                               w x h - the timeline's FULL frame (lib/mv3b-render.js frame), never the file's
                                               size: the render's graph is built at the frame and scaled only at its end, so a
                                               copy of the file's size lay in its top left corner (the owner's (эф25)); one copy
                                               serves every size
     want(timeline, key)                       queue what it needs, a moment after its save (the frame, adv's rate)
     ready(needs, { onFrac, signal }) -> Promise<Map clipId -> [{ a, b, abs }]>
     next / frames / chunk / done / fail       the window's side (routes/fx-bake.js)
     state()                                   for a look: the window, the queue */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const { CACHE_DIR } = require('./config');
const MEDIA = require('./media');
const P = require('../public/js/fx/params.js');
const FX = require('../public/js/fx/effects.js');

const DIR = path.join(CACHE_DIR, 'fx-bake');
const SEEN_MS = 40000;                // a window that asked this recently is there
const POLL_MS = 25000;                // how long a window's ask for work is held open
const WAIT_WORKER_MS = 45000;         // a stretch waiting this long with no window ever seen is given up (no desktop shell)
const STALL_MS = 120000;              // a stretch handed out that moves no frame in this long is handed out again, once
const r6n = (x) => Math.round(x * 1e6) / 1e6;

// ── What a timeline needs ──────────────────────────────────────────────────
// The clip's fields that make its picture - the print is made of them alone, an empty one and a default said one way (the page's
// clip and the stored one carry the same picture with other fields and nulls; a level changed bakes nothing again).
const PICTURE = ['src', 'trimIn', 'dur', 'speed', 'reversed', 'fit', 'cropAlign', 'crop', 'frame', 'pip', 'tx', 'ty', 'tw', 'angle', 'feather',
  'radius', 'outline', 'outlineColor', 'rotation', 'halfer', 'halferPos', 'halferThick', 'halferKeep', 'color', 'flip', 'fx'];
function _pic(c) {
  const o = {};
  for (const k of PICTURE) {
    let v = c[k];
    if (v == null || v === '' || v === false) continue;
    if (k === 'speed' && +v === 1) continue;
    if (k === 'fit' && v === 'fit') continue;
    if (k === 'src') v = String(v).split('?')[0];
    o[k] = v;
  }
  return o;
}
function _filePrint(src) {
  const abs = MEDIA.toDisk(String(src || '').split('?')[0]);
  let st = null;
  try { st = abs ? fs.statSync(abs) : null; } catch (e) { st = null; }
  return st ? [path.resolve(abs).toLowerCase(), st.size, Math.floor(st.mtimeMs)] : null;
}

/** The stretches of `tl` to bake for a W x H frame at `fps` - the video clips with an effect the page alone draws. */
function needsOf(tl, { w, h, fps }) {
  const out = [];
  // Main video is the bottom video lane - the last in the list (lib/mv3b-render.js videoLanes).
  const lanes = ((tl && tl.tracks) || []).filter((t) => t && t.kind === 'video');
  const mainLane = lanes[lanes.length - 1] || null;
  for (const t of lanes) {
    const onMain = t === mainLane;
    for (const c0 of (t.clips || [])) {
      const fx = P.normalizeFx(c0.fx);
      if (!fx) continue;
      const c = { ...c0, fx };
      const spans = P.engineSpans(c);
      if (!spans.length) continue;
      const fp = _filePrint(c.src);
      if (!fp) continue;
      const start = +c.start || 0;
      // The clip as the window gets it: from 0 on its own clock (its effects' times are the file's - start moves nothing).
      const clip = { ...c, start: 0 };
      const pic = _pic(clip);
      for (const [A0, B0] of spans) {
        // (block 4c) ON THE TIMELINE'S FRAMES: the stretch from the first frame of the render at or after its start to the first at
        // or after its end - so each frame the window draws is a frame the render shows, at the very moment the preview draws it
        // (an effect starting between two frames was drawn half a frame early: Chat's window, coming in in 0.1 s, showed it).
        const A = Math.ceil(A0 * fps - 1e-6) / fps, B = Math.ceil(B0 * fps - 1e-6) / fps;
        if (!(B > A)) continue;
        const a = r6n(A - start), b = r6n(B - start);
        const alpha = !onMain;
        // The clip's frames over the stretch as they lie in the frame: the WHOLE clip alone on its lane - main video, or a lane above
        // an empty main on a transparent frame -, with no effects, fully seen and blended with nothing, the render's own graph (lib/
        // mv3b-job.js prepare `raw`), the stretch's frames taken out of it by number (`from`, `frames`). Laid as far past a frame as
        // on the timeline (`off`), so the same frame of its file lies under the same frame of the render (block 4c: cut at the
        // stretch, the file's start was rounded to a hundredth and the picture could come a frame late).
        const base = Math.floor(start * fps + 1e-6) / fps;
        const off = r6n(start - base);
        const key = crypto.createHash('sha1').update(JSON.stringify({ v: FX.ENGINE_VERSION, fp, pic, a, b, w, h, fps, alpha, off })).digest('hex').slice(0, 24);
        const sp = +c.speed > 0 ? +c.speed : 1;
        const mini = { ...clip, id: 'bake', start: off, fx: null, opacity: null, blend: null };
        if (!(sp > 0)) continue;
        const mainOf = (clips) => ({ id: 'v1', kind: 'video', main: true, name: 'main video', clips });
        out.push({ key, abs: path.join(DIR, key + '.mp4'), clipId: String(c.id), a: A, b: B, clip, ca: a, cb: b, w, h, fps, alpha,
          from: r6n(A - base),
          mini: { kind: tl.kind, format: tl.format,
            tracks: alpha ? [{ id: 'v2', kind: 'video', name: 'video 2', clips: [mini] }, mainOf([])] : [mainOf([mini])] } });
      }
    }
  }
  return out;
}

// ── The queue ──────────────────────────────────────────────────────────────
const _jobs = new Map();              // id -> job
const _byKey = new Map();             // key -> job not over
const _order = [];                    // ids waiting for the window
const _polls = [];                    // the window's asks held open
let _seenAt = 0;
const _bootAt = Date.now();
let _n = 0;
const workerSeen = () => Date.now() - _seenAt < SEEN_MS;

function _end(job, err) {
  if (job.over) return;
  job.over = true;
  _byKey.delete(job.key);
  if (job.proc) { try { job.proc.kill(); } catch (e) { /* gone */ } }
  if (job.tmp) fs.rmSync(job.tmp, { force: true });
  setTimeout(() => _jobs.delete(job.id), 60000);
  if (err) { job.error = err.message; job.reject(err); } else job.resolve(job.need.abs);
}

function _queue(need) {
  if (fs.existsSync(need.abs)) return Promise.resolve(need.abs);
  let job = _byKey.get(need.key);
  if (!job) {
    job = { id: 'b' + (++_n).toString(36) + Date.now().toString(36), key: need.key, need, state: 'waiting', at: Date.now(),
      frames: Math.max(1, Math.round((need.cb - need.ca) * need.fps)), sent: 0, handed: 0, over: false, listeners: new Set() };
    job.promise = new Promise((resolve, reject) => { job.resolve = resolve; job.reject = reject; });
    job.promise.catch(() => { /* every caller has its own handler */ });
    _jobs.set(job.id, job);
    _byKey.set(job.key, job);
    _order.push(job.id);
    _pump();
    _watch();
  }
  return job.promise;
}

function _pump() {
  while (_polls.length && _order.length) {
    const job = _jobs.get(_order.shift());
    if (!job || job.over) continue;
    const poll = _polls.shift();
    clearTimeout(poll.timer);
    job.state = 'baking';
    job.handed++;
    job.lastAt = Date.now();
    job.lastHanded = job.lastAt;
    job.sent = 0;
    job.tmp = path.join(DIR, job.key + '.' + job.id + '.h264');
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(job.tmp, Buffer.alloc(0));
    const n = job.need;
    poll.res.json({ job: { id: job.id, w: n.w, h: n.h, fps: n.fps, n: job.frames, a: n.ca, clip: n.clip, alpha: !!n.alpha,
      frames: '/api/fx-bake/frames/' + job.id } });
  }
}

let _watching = null;
function _watch() {
  if (_watching) return;
  _watching = setInterval(() => {
    const now = Date.now();
    let left = 0;
    for (const job of _jobs.values()) {
      if (job.over) continue;
      left++;
      if (job.state === 'waiting' && !workerSeen() && now - _bootAt > WAIT_WORKER_MS && now - job.at > 5000) {
        _end(job, Object.assign(new Error('the effects are drawn in the app window - it is not running here'), { noWorker: true }));
      } else if (job.state === 'baking' && now - job.lastAt > STALL_MS) {
        if (job.handed < 2) { job.state = 'waiting'; _order.unshift(job.id); _pump(); }
        else _end(job, new Error('the app window stopped drawing the effect'));
      }
    }
    if (!left) { clearInterval(_watching); _watching = null; }
  }, 5000);
}

/** GET /api/fx-bake/next?wait=1 - the window asks for work; held open until there is some. */
function next(req, res) {
  if (String(req.query.wait || '') !== '1') return res.json({ job: null });
  _seenAt = Date.now();
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
  _pump();
}

/** GET /api/fx-bake/frames/:id - the stretch's frames as the clip lies in the frame, raw I420 (I420 + alpha above main), the render's own graph. */
async function frames(req, res) {
  const job = _jobs.get(String(req.params.id || ''));
  if (!job || job.over || job.state !== 'baking') return res.status(404).end();
  _seenAt = Date.now();
  const n = job.need;
  const JOB = require('./mv3b-job');
  const p = await JOB.prepare(n.mini, 'bake_' + job.id, { resolution: n.w + 'x' + n.h, fps: n.fps }, { raw: true, rate: n.fps, clear: !!n.alpha, from: n.from, frames: job.frames });
  if (p.error) { res.status(500).end(); _end(job, new Error(p.error)); return; }
  const proc = spawn(ffmpegPath, [...p.args, 'pipe:1'], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  job.proc = proc;
  let err = '';
  proc.stderr.on('data', (c) => { err = (err + c.toString()).slice(-2000); });
  proc.on('close', (code) => { job.proc = null; p.dispose(); if (code && !job.over && job.sent === 0) console.warn('[fx-bake] frames:', err.slice(-400)); });
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Cache-Control', 'no-store');
  proc.stdout.on('data', () => { job.lastAt = Date.now(); _seenAt = job.lastAt; });
  proc.stdout.pipe(res);
  proc.on('error', () => { try { res.end(); } catch (e) { /* gone */ } });
  req.on('close', () => { if (job.proc) { try { job.proc.kill(); } catch (e) { /* gone */ } } });
}

/** POST /api/fx-bake/:id/chunk?n=<frames done> - a piece of the H.264 stream (Annex B), raw bytes. */
function chunk(req, res) {
  const job = _jobs.get(String(req.params.id || ''));
  if (!job || job.over || job.state !== 'baking' || !job.tmp) return res.status(404).json({ success: false });
  _seenAt = Date.now();
  job.lastAt = _seenAt;
  const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  try { fs.appendFileSync(job.tmp, buf); } catch (e) { _end(job, e); return res.status(500).json({ success: false }); }
  job.sent = Math.max(job.sent, Math.min(job.frames, +req.query.n || 0));
  const frac = Math.min(0.99, job.sent / job.frames);
  for (const f of job.listeners) { try { f(frac); } catch (e) { /* a listener's own trouble */ } }
  res.json({ success: true });
}

/** POST /api/fx-bake/:id/done { frames, msPerFrame, codec } - the stream is whole: made an mp4 at the frame rate. */
async function done(req, res) {
  const job = _jobs.get(String(req.params.id || ''));
  if (!job || job.over) return res.status(404).json({ success: false });
  _seenAt = Date.now();
  const b = req.body || {};
  const n = job.need;
  const tmpMp4 = n.abs + '.' + job.id + '.tmp.mp4';
  const code = await new Promise((resolve) => {
    const p = spawn(ffmpegPath, ['-hide_banner', '-v', 'error', '-y', '-r', String(n.fps), '-f', 'h264', '-i', job.tmp,
      '-c', 'copy', '-movflags', '+faststart', tmpMp4], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    let e = '';
    p.stderr.on('data', (c) => { e += c.toString(); });
    p.on('close', (c) => { if (c) console.warn('[fx-bake] mux:', e.slice(-400)); resolve(c); });
    p.on('error', () => resolve(1));
  });
  if (code || !fs.existsSync(tmpMp4)) {
    fs.rmSync(tmpMp4, { force: true });
    res.json({ success: false });
    return _end(job, new Error('the drawn effect could not be put together'));
  }
  try { fs.renameSync(tmpMp4, n.abs); } catch (e) { fs.rmSync(tmpMp4, { force: true }); if (!fs.existsSync(n.abs)) { res.json({ success: false }); return _end(job, e); } }
  console.log(`[fx-bake] ${job.frames} frames of ${n.w}x${n.h}${n.alpha ? ' with alpha' : ''} in ${((Date.now() - job.lastHanded) / 1000 || 0).toFixed(1)} s, ` +
    `${Math.round((+b.msPerFrame || 0) * 10) / 10} ms a frame, drawing ${Math.round((+b.drawMs || 0) * 10) / 10}, converting ${Math.round((+b.convMs || 0) * 10) / 10} (${String(b.codec || '').slice(0, 40)})`);
  res.json({ success: true });
  _end(job, null);
}

/** POST /api/fx-bake/:id/fail { error } - the window could not draw it. */
function fail(req, res) {
  const job = _jobs.get(String(req.params.id || ''));
  if (job && !job.over) {
    _seenAt = Date.now();
    const why = String((req.body || {}).error || 'the app window could not draw the effect').slice(0, 300);
    console.warn('[fx-bake]', why);
    _end(job, new Error(why));
  }
  res.json({ success: true });
}

// ── Asked for ──────────────────────────────────────────────────────────────
/** Every stretch of `needs` baked - Map clipId -> [{ a, b, abs, alpha }] (timeline seconds). Rejects in words when one cannot be. */
async function ready(needs, { onFrac, signal } = {}) {
  const map = new Map();
  if (!needs.length) return map;
  const total = needs.reduce((s, x) => s + Math.max(1, (x.cb - x.ca)), 0);
  const fr = new Map();
  const say = () => { if (onFrac) { let s = 0; for (const x of needs) s += (fr.get(x.key) || 0) * Math.max(1, (x.cb - x.ca)); onFrac(Math.min(0.99, s / total)); } };
  await Promise.all(needs.map(async (x) => {
    if (fs.existsSync(x.abs)) { fr.set(x.key, 1); return; }
    const p = _queue(x);
    const job = _byKey.get(x.key);
    const f = (v) => { fr.set(x.key, v); say(); };
    if (job) job.listeners.add(f);
    try {
      await (signal ? Promise.race([p, new Promise((_, rej) => signal.addEventListener('abort', () => rej(Object.assign(new Error('cancelled'), { cancelled: true })), { once: true }))]) : p);
    } finally { if (job) job.listeners.delete(f); }
    fr.set(x.key, 1);
    say();
  }));
  for (const x of needs) {
    if (!map.has(x.clipId)) map.set(x.clipId, []);
    map.get(x.clipId).push({ a: x.a, b: x.b, abs: x.abs, alpha: !!x.alpha });
  }
  return map;
}

// A timeline just saved: what it needs, queued a moment later (an edit is often followed by another).
const _wantTimers = new Map();
function want(tl, key) {
  if (!tl || !key) return;
  clearTimeout(_wantTimers.get(key));
  _wantTimers.set(key, setTimeout(() => {
    _wantTimers.delete(key);
    try {
      const { frame } = require('./mv3b-render');
      const FIN = require('./render-finish');
      const st = FIN.settingsOf(tl.adv, frame(tl));
      const fr = frame(tl);
      for (const x of needsOf(tl, { w: fr.w, h: fr.h, fps: st.fps })) _queue(x).catch(() => { /* Export says it */ });
    } catch (e) { console.warn('[fx-bake] want:', e.message); }
  }, 1500));
}

/** (б3-8) At the start: the copies no timeline needs any more go. */
function sweep(timelines) {
  let names = [];
  try { names = fs.readdirSync(DIR); } catch (e) { return 0; }
  const keep = new Set();
  try {
    const { frame } = require('./mv3b-render');
    const FIN = require('./render-finish');
    for (const tl of timelines) {
      const st = FIN.settingsOf(tl && tl.adv, frame(tl || {}));
      const fr = frame(tl || {});
      for (const x of needsOf(tl, { w: fr.w, h: fr.h, fps: st.fps })) keep.add(x.key + '.mp4');
    }
  } catch (e) { console.warn('[fx-bake] sweep:', e.message); return 0; }
  let gone = 0;
  for (const f of names) {
    if (keep.has(f)) continue;
    try { fs.rmSync(path.join(DIR, f), { force: true }); gone++; } catch (e) { /* in use - next start */ }
  }
  if (gone) console.log(`[fx-bake] ${gone} copies no timeline needs went`);
  return gone;
}

function state() {
  return { worker: workerSeen(), seenAgoMs: _seenAt ? Date.now() - _seenAt : null, waiting: _order.length,
    jobs: [..._jobs.values()].filter((j) => !j.over).map((j) => ({ id: j.id, state: j.state, frames: j.frames, sent: j.sent })) };
}

module.exports = { needsOf, ready, want, sweep, next, frames, chunk, done, fail, state, workerSeen, DIR };
