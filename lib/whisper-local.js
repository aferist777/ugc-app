'use strict';

// ════════════════════════════════════════════════════════════════════════════
// SPEECH RECOGNITION ON THIS COMPUTER - whisper.cpp large-v3-turbo.
//
// Captions are heard by Groq (lib/groq-stt.js). This is the other ear, for when Groq cannot be asked -
// no key, no network, it failed - or when the subtitle lane says "this computer". Every number below was
// settled by a benchmark.
//
//   the program   vendor/whisper/whisper-cli.exe, OpenBLAS, shipped with the app (tools/fetch-whisper.js) - the
//                 processor's build, the only one
//   the model     ggml-large-v3-turbo-q5_0.bin (574 MB), fetched at first use into <library>/cache/whisper/,
//                 checked by SHA-256
//   a run         one at a time in the whole app; waits while a render encodes; runs below normal priority;
//                 -nfa -dtw large.v3.turbo (word ends to 0.02 s of Groq's; DTW is silently OFF with flash
//                 attention), -mc 0 (turbo drops a whole window of speech without it), -p 1 (more
//                 processors put every later piece's times off), no VAD (it crashes DTW and shifts words)
//   paths         the program reads its arguments in the system code page: a Cyrillic path never reaches
//                 it, and a "—" in the model's path crashes it. So every run starts IN the model's folder
//                 and names its files there by short ASCII names - that works whatever the folders are called
//   success       exit code 0 AND a fresh -ojf file that parses (code 0 can hide a failure); a DTW crash
//                 (WHISPER_ASSERT on a very short window) is run again without DTW, marked approximate
// ════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const http = require('http');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
const { pipeline } = require('stream/promises');
const { APP_DIR, CACHE_DIR } = require('./config');
const RB = require('./render-busy');
const WW = require('./whisper-words');
const I18N = require('./i18n');

const RELEASE = 'b5130';
const VERSION = 'v1.9.4';
const DIR = path.join(CACHE_DIR, 'whisper');
const RUN = path.join(DIR, 'run');
const SHIPPED = path.join(APP_DIR, 'vendor', 'whisper', 'whisper-cli.exe');
const HF = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/';
const SOURCES = {
  model: { file: 'ggml-large-v3-turbo-q5_0.bin', size: 574041195,
    sha256: '394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2', url: HF + 'ggml-large-v3-turbo-q5_0.bin' },
};
// What an answer heard here is filed under (with the sound's own signature, lib/captions-job.js): another
// model or other settings are another answer, a newer program with the same settings is not.
const MODEL_ID = 'whisper.cpp/large-v3-turbo-q5_0/dtw-mc0';
const MODEL_LABEL = 'large-v3-turbo q5_0';
const QUIET_MS = 5 * 60e3;            // no progress line for this long: the program is stuck
let NO_BYTES_MS = 60e3;               // a download (or a server) silent for this long is dropped

class LocalError extends Error { constructor(code, message) { super(message); this.code = code; } }

let _wrap = null;                     // the test stand: run a fake program through node

const _modelFile = () => path.join(DIR, SOURCES.model.file);
const hasProgram = () => process.platform === 'win32' && fs.existsSync(SHIPPED);
const hasModel = () => fs.existsSync(_modelFile());
const threads = () => Math.max(1, Math.min(8, Math.floor(os.cpus().length / 2)));

// ── A program left running by a server that died ───────────────────────────
let _orphanChecked = false;
function _orphans() {
  if (_orphanChecked) return;
  _orphanChecked = true;
  const f = path.join(DIR, 'running.json');
  let pid = null;
  try { pid = +JSON.parse(fs.readFileSync(f, 'utf8')).pid; } catch (e) { return; }
  try {
    const r = spawnSync('tasklist', ['/FI', 'PID eq ' + pid, '/FO', 'CSV', '/NH'], { windowsHide: true, encoding: 'utf8', timeout: 5000 });
    if (/whisper-cli\.exe/i.test(String(r.stdout || ''))) {
      spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, timeout: 5000 });
      console.warn('[whisper] stopped a whisper-cli left running by an earlier start (pid ' + pid + ')');
    }
  } catch (e) { /* nothing to stop */ }
  try { fs.unlinkSync(f); } catch (e) { /* gone */ }
}

// ── What a quit or a crash left behind ──────────────────────────────────────
// Run files go in finally blocks - which a quit (taskkill) or a crash skips. This
// module is loaded when the server starts, before any run or download of this process.
function _sweepLeftovers() {
  try { fs.rmSync(RUN, { recursive: true, force: true }); } catch (e) { /* held: the next start */ }
  // The model's part STAYS: the next download goes on from it (`Range`).
}
_sweepLeftovers();

// ── The model's download - one at a time, shared by whoever waits ──
const DL = { model: null };   // { got, total, promise, listeners }
const _err = { model: null };

// `from`: the bytes already in `dest` from a download that broke - asked for the rest (`Range`). A server
// that answers the rest (206 from exactly there) is appended to, and what is already there is hashed first; one that
// answers the whole file (200) is written from the start. A file that does not match is `corrupt`: its part goes.
function _fetch(url, dest, want, onBytes, hops, from) {
  const at = +from || 0;
  return new Promise((resolve, reject) => {
    if ((hops || 0) > 8) { reject(new Error(I18N.t('too many redirects'))); return; }
    const headers = { 'User-Agent': 'UGC-Studio' };
    if (at > 0) headers.Range = 'bytes=' + at + '-';
    const req = (String(url).startsWith('http:') ? http : https).get(url, { headers }, async (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        resolve(_fetch(new URL(res.headers.location, url).toString(), dest, want, onBytes, (hops || 0) + 1, at));
        return;
      }
      const m = /^bytes\s+(\d+)-/i.exec(String(res.headers['content-range'] || ''));
      const resumed = at > 0 && res.statusCode === 206 && !!m && +m[1] === at;
      if (res.statusCode !== 200 && !resumed) { res.resume(); reject(new Error(I18N.t('the server answered {code}', { code: res.statusCode }))); return; }
      const hash = crypto.createHash('sha256');
      let got = 0;
      if (resumed) {
        try {
          await new Promise((ok, bad) => fs.createReadStream(dest).on('data', (d) => { hash.update(d); got += d.length; }).on('end', ok).on('error', bad));
        } catch (e) { res.destroy(); reject(e); return; }
        onBytes(got);
      }
      const out = fs.createWriteStream(dest, { flags: resumed ? 'a' : 'w' });
      let last = Date.now();
      const watch = setInterval(() => { if (Date.now() - last > NO_BYTES_MS) res.destroy(new Error(I18N.t('the download stopped - no data for a minute'))); }, 5000);
      res.on('data', (c) => { hash.update(c); got += c.length; last = Date.now(); onBytes(got); });
      pipeline(res, out).then(() => {
        clearInterval(watch);
        const sha = hash.digest('hex');
        if (got !== want.size || sha !== want.sha256) reject(Object.assign(new Error(I18N.t('the file that arrived is not the one expected (checksum)')), { corrupt: true }));
        else resolve();
      }, (e) => { clearInterval(watch); reject(e); });
    });
    // A server that takes the connection and never answers - a stalled handshake, a proxy, a CDN hop -
    // gives no response for the body watchdog to watch. The socket's own idle limit covers it.
    req.setTimeout(NO_BYTES_MS, () => req.destroy(new Error(I18N.t('the server did not answer for a minute'))));
    req.on('error', reject);
  });
}

function _freeBytes(dir) {
  try { const s = fs.statfsSync(dir); return s.bavail * s.bsize; } catch (e) { return Infinity; }
}

async function _downloadModel(onBytes) {
  const want = SOURCES.model;
  fs.mkdirSync(DIR, { recursive: true });
  // A download that broke goes on from where it stopped: its part is kept, and only the rest is asked for.
  const part = _modelFile() + '.part';
  let have = 0;
  try { have = fs.statSync(part).size; } catch (e) { have = 0; }
  if (have >= want.size) { fs.rmSync(part, { force: true }); have = 0; }
  if (_freeBytes(DIR) < (want.size - have) * 1.05) throw new LocalError('disk', I18N.t('Not enough free space for the speech model ({mb}).', { mb: _mb(want.size - have) }));
  if (have) console.log('[whisper] the model goes on from ' + _mb(have));
  try {
    await _fetch(want.url, part, want, onBytes, 0, have);
    fs.renameSync(part, _modelFile());
  } catch (e) {
    // What arrived is not the model: nothing of it is worth going on from.
    if (e && e.corrupt) fs.rmSync(part, { force: true });
    throw e;
  }
}

/**
 * Fetch the model. Whoever asks while it is coming waits for the same download.
 * @param onProgress ({ got, total }) - called as bytes arrive
 */
function download(what, onProgress) {
  if (what !== 'model') return Promise.reject(new LocalError('bad', I18N.t('Nothing to download by that name.')));
  const total = SOURCES[what].size;
  let d = DL[what];
  if (!d) {
    d = DL[what] = { got: 0, total, listeners: new Set() };
    _err[what] = null;
    const tick = (got) => { d.got = got; for (const fn of d.listeners) { try { fn({ got, total }); } catch (e) { /* a listener's trouble */ } } };
    d.promise = _downloadModel(tick)
      .then(() => { console.log('[whisper] ' + what + ' downloaded'); },
        (e) => { _err[what] = e.message; console.warn('[whisper] ' + what + ' download failed: ' + e.message); throw (e instanceof LocalError ? e : new LocalError('download', e.message)); })
      .finally(() => { DL[what] = null; });
  }
  if (onProgress) d.listeners.add(onProgress);
  return d.promise.finally(() => { if (onProgress) d.listeners.delete(onProgress); });
}

function remove(what) {
  if (DL[what]) throw new LocalError('busy', I18N.t('It is being downloaded right now.'));
  if (_inside > 0) throw new LocalError('busy', I18N.t('It is in use right now - try again when the captions are done.'));
  if (what === 'model') fs.rmSync(_modelFile(), { force: true });
  else throw new LocalError('bad', I18N.t('Nothing to remove by that name.'));
}

const _mb = (b) => I18N.t('{n} MB', { n: Math.round(b / 1e6) });

/** Everything Admin and the subtitle lane show about this computer's ear. Starts nothing. */
function state() {
  const dl = (w) => (DL[w] ? { got: DL[w].got, total: DL[w].total } : null);
  return {
    platform: process.platform === 'win32',
    program: { present: fs.existsSync(SHIPPED), version: VERSION, release: RELEASE },
    model: { present: hasModel(), name: MODEL_LABEL, bytes: SOURCES.model.size, downloading: dl('model'), error: _err.model,
      // A download that broke, kept to go on from.
      partial: (() => { try { return DL.model ? 0 : fs.statSync(_modelFile() + '.part').size; } catch (e) { return 0; } })() },
    busy: _inside > 0,
  };
}

// ── The gate: one run in the whole app ──────────────────────────────────────
let _inside = 0;
const _queue = [];
// A queued run says so every two seconds - a sign of life, or the job sweep would take a honest wait for a
// dead job - and leaves the queue without ever starting when it is let go of.
function _enter(o) {
  if (_inside < 1) { _inside++; return Promise.resolve(); }
  return new Promise((resolve, reject) => {
    const say = () => { if (o.onWait) o.onWait(I18N.t('waiting for another project')); };
    const turn = () => { clearInterval(t); resolve(); };          // called by _leave: the gate is ours
    const t = setInterval(() => {
      if (o.stop && o.stop()) {
        const i = _queue.indexOf(turn);
        if (i >= 0) _queue.splice(i, 1);
        clearInterval(t);
        reject(new LocalError('stopped', I18N.t('Stopped.')));
      } else say();
    }, 2000);
    say();
    _queue.push(turn);
  });
}
function _leave() { const next = _queue.shift(); if (next) next(); else _inside--; }

const _sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function _wav(pcm) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(16000, 24);
  h.writeUInt32LE(32000, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

// One run of the program. Resolves { code, err, why } - why: 'stopped' | 'quiet' | null.
function _run(exe, args, o) {
  return new Promise((resolve) => {
    const cmd = _wrap ? _wrap[0] : exe;
    const argv = _wrap ? [_wrap[1], exe].concat(args) : args;
    const p = spawn(cmd, argv, { cwd: DIR, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    try { os.setPriority(p.pid, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch (e) { /* not allowed: normal it is */ }
    try { fs.writeFileSync(path.join(DIR, 'running.json'), JSON.stringify({ pid: p.pid })); } catch (e) { /* only for a crashed server */ }
    let err = '';
    let last = Date.now();
    let why = null;
    p.stderr.on('data', (c) => {
      const s = String(c);
      err = (err + s).slice(-20000);
      for (const m of s.matchAll(/progress =\s*(\d+)%/g)) { last = Date.now(); if (o.onProgress) o.onProgress(+m[1]); }
    });
    const watch = setInterval(() => {
      if (o.stop && o.stop()) why = 'stopped';
      else if (Date.now() - last > QUIET_MS) why = 'quiet';
      if (why) { try { p.kill(); } catch (e) { /* gone */ } }
    }, 500);
    const done = (code) => {
      clearInterval(watch);
      try { fs.unlinkSync(path.join(DIR, 'running.json')); } catch (e) { /* gone */ }
      resolve({ code, err, why });
    };
    p.on('close', done);
    p.on('error', (e) => { err += '\n' + e.message; done(-1); });
  });
}

/**
 * Hear one piece of sound here.
 * @param pcm   16 kHz mono s16le (lib/captions-job.js builds it)
 * @param o     { stop() -> true to give up, onProgress(pct), onWait(words), variant: 'retry' }
 * @returns     { answer (Groq's shape), raw, norm, timing: 'dtw'|'approximate', build: 'cpu', version, took, model }
 */
async function transcribe(pcm, o) {
  o = o || {};
  if (!hasProgram()) throw new LocalError('no-build', I18N.t('Speech recognition on this computer is not installed (npm install puts it in vendor/whisper).'));
  if (!hasModel()) throw new LocalError('no-model', I18N.t('The speech model for this computer is not downloaded yet ({mb}).', { mb: _mb(SOURCES.model.size) }));
  _orphans();
  await _enter(o);
  const id = 'r' + Date.now().toString(36) + crypto.randomBytes(2).toString('hex');
  const files = [path.join(RUN, id + '.wav'), path.join(RUN, id + '.json')];
  try {
    if (o.stop && o.stop()) throw new LocalError('stopped', I18N.t('Stopped.'));
    while (RB.busy()) {
      if (o.stop && o.stop()) throw new LocalError('stopped', I18N.t('Stopped.'));
      if (o.onWait) o.onWait(I18N.t('waiting for the render to finish'));
      await _sleep(2000);
    }
    fs.mkdirSync(RUN, { recursive: true });
    fs.writeFileSync(files[0], _wav(pcm));
    const base = ['-m', SOURCES.model.file, '-f', 'run/' + id + '.wav', '-of', 'run/' + id, '-ojf', '-l', 'auto', '-t', String(threads()), '-p', '1', '-pp'];
    const decode = o.variant === 'retry' ? ['-bs', '1'] : ['-mc', '0'];
    const dtw = ['-nfa', '-dtw', 'large.v3.turbo'];
    const t0 = Date.now();
    const attempt = async (withDtw) => {
      try { fs.rmSync(files[1], { force: true }); } catch (e) { /* a unique name: nothing stale can be there */ }
      const r = await _run(SHIPPED, base.concat(decode, withDtw ? dtw : []), o);
      if (r.why === 'stopped') throw new LocalError('stopped', I18N.t('Stopped.'));
      if (r.why === 'quiet') throw new LocalError('stuck', I18N.t('The recognition on this computer stopped answering - press again.'));
      let doc = null;
      const wrote = r.code === 0 && fs.existsSync(files[1]);
      if (wrote) { try { doc = WW.readOjf(files[1]); } catch (e) { doc = null; } }
      return { ...r, wrote, doc: doc && Array.isArray(doc.transcription) ? doc : null };
    };
    let r = await attempt(true);
    let timing = 'dtw';
    if (!r.doc && /WHISPER_ASSERT/.test(r.err)) {
      // DTW on a window of under 160 ms crashes v1.9.4 (whisper.cpp:9076): once more without it.
      timing = 'approximate';
      r = await attempt(false);
    }
    if (!r.doc) {
      const said = r.err.trim().split('\n').filter((l) => l.trim() && !/progress =/.test(l)).slice(-1)[0];
      throw new LocalError('failed', I18N.t('The recognition on this computer failed ({code}): {why}', { code: r.code, why: (said || I18N.t('no answer was written')).slice(0, 200) }));
    }
    const seconds = pcm.length / 2 / 16000;
    const out = WW.answerOf(r.doc, seconds);
    return { ...out, timing: timing === 'approximate' ? 'approximate' : out.timing, build: 'cpu', version: VERSION, model: MODEL_ID,
      took: Math.round((Date.now() - t0) / 100) / 10 };
  } finally {
    // Best effort: a scanner or a sync client holding a run file a moment too long must cost neither the
    // answer just heard nor the gate - the next start sweeps what is left.
    for (const f of files) { try { fs.rmSync(f, { force: true }); } catch (e) { /* left in cache/whisper/run */ } }
    _leave();
  }
}

// For the test stand only.
function _setTest(o) {
  if (o.wrap !== undefined) _wrap = o.wrap;
  if (o.noBytesMs !== undefined) NO_BYTES_MS = o.noBytesMs;
  if (o.sources) for (const k of Object.keys(o.sources)) Object.assign(SOURCES[k], o.sources[k]);
}

// Something is being heard now - a preview's warm-up waits for it, as it does for a render (routes/proxies.js).
const hearing = () => _inside > 0;

module.exports = { transcribe, download, remove, state, hearing, hasProgram, hasModel, LocalError, MODEL_ID,
  // for the stands: the download itself
  _fetch,
  MODEL_BYTES: SOURCES.model.size, _setTest, _sweepLeftovers, DIR };
