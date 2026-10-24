'use strict';

// ════════════════════════════════════════════════════════════════════════════
// THE PAUSES IN A STRETCH OF A SOUND (phase V44, the owner 2026-10-24: a "cut silence" button on Merge's timeline - every
// pause longer than X shortened to X). The page asks for the pauses of main audio's clips inside the stretch it was given
// (public/js/merge-v3/tl-silence.js) and plans the cuts itself; this only says where the sound is silent.
//
//   pausesIn(abs, from, to) -> Promise<{ from, to, floor, thr, pauses: [[a, b], ...] }>   seconds of the FILE
//
// SILENT IS BELOW THE STRETCH'S OWN NOISE (the rule measured in phase V33.5 on the owner's sources, docs/local-app/
// PLAN-archive.md "V33.5"): the loudness of 32 ms windows every 10 ms; the threshold is the 10th percentile of that
// loudness + 6 dB, never above -36 dB - so under music, where the quietest tenth is the music itself, nothing is silent and
// nothing is cut (a cut in music is heard as a jump). The percentile is taken over the stretch widened to FLOOR_SPAN
// seconds at least, so a short stretch still knows its room's noise. A pause is a run of silent windows FROM MIN_PAUSE
// long (a stop inside a word - p, t, k - is quiet for less).
//
// READ ONCE: the loudness is kept in cache/pauses/ in pieces of BLOCK seconds of the file (by its path, size and time;
// a file changed in place is read again and its old pieces go), so a stretch asked again - or a neighbouring one - reads
// nothing; an hour-long film is read only where it is asked. One ffmpeg at a time.
// ════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { CACHE_DIR } = require('./config');

const SR = 16000;                 // decoded at - one channel
const HOP = 160;                  // 10 ms between windows
const WIN = 512;                  // 32 ms a window
const FPS = SR / HOP;             // windows a second
const BLOCK = 60;                 // seconds of the file a cached piece holds
const PER_BLOCK = BLOCK * FPS;
const QUIET_MAX = -36;            // dB: never louder than this is silence
const OVER_FLOOR = 6;             // dB over the stretch's 10th percentile
const MIN_PAUSE = 0.1;            // s
const FLOOR_SPAN = 20;            // s: the noise floor is measured over at least this much
const EDGE = 0.005;               // s: a run of windows is widened by this at each end (the V33.5 measurement's own)
const DIR = path.join(CACHE_DIR, 'pauses');

const r3 = (v) => Math.round(v * 1000) / 1000;
const _stem = (abs) => crypto.createHash('sha1').update(path.resolve(abs).toLowerCase()).digest('hex').slice(0, 20);
const _ver = (st) => st.size + '-' + Math.round(st.mtimeMs);
const _file = (abs, st, b) => path.join(DIR, _stem(abs) + '-' + _ver(st) + '-b' + b + '.f32');

// The loudness (dBFS) of every window of [from, from + len) of the file, read with ffmpeg as it streams: { db, ok }, fewer
// windows than asked when the file ends sooner; `ok` - ffmpeg finished well (only then is it kept).
function _read(abs, from, len) {
  return new Promise((resolve) => {
    const ffmpegPath = require('ffmpeg-static');
    const want = Math.ceil(len * FPS);
    const out = new Float32Array(want);
    let f = 0;
    let tail = new Int16Array(0);
    let odd = null;
    let proc;
    try {
      proc = spawn(ffmpegPath, ['-hide_banner', '-nostdin', '-v', 'error', '-ss', from.toFixed(3), '-t', (len + WIN / SR).toFixed(3),
        '-i', abs, '-vn', '-ac', '1', '-ar', String(SR), '-f', 's16le', '-'], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
    } catch (e) { return resolve({ db: out.subarray(0, 0), ok: false }); }
    const take = (s, final) => {
      let o = 0;
      while (f < want && (o + WIN <= s.length || (final && o + HOP <= s.length))) {
        const end = Math.min(s.length, o + WIN);
        let e = 0;
        for (let i = o; i < end; i++) e += s[i] * s[i];
        out[f++] = 10 * Math.log10(e / (end - o) / 1073741824 + 1e-12);
        o += HOP;
      }
      return o;
    };
    proc.stdout.on('data', (b) => {
      if (odd) { b = Buffer.concat([odd, b]); odd = null; }
      const whole = b.length - (b.length % 2);
      if (whole < b.length) odd = Buffer.from(b.subarray(whole));
      const n = whole / 2;
      const s = new Int16Array(tail.length + n);
      s.set(tail, 0);
      for (let i = 0; i < n; i++) s[tail.length + i] = b.readInt16LE(i * 2);
      const o = take(s, false);
      tail = s.slice(o);
    });
    proc.on('error', () => resolve({ db: out.subarray(0, f), ok: false }));
    proc.on('close', (code) => { take(tail, true); resolve({ db: out.subarray(0, f), ok: code === 0 }); });
  });
}

// One reading at a time; one reading per piece however many ask.
let _chain = Promise.resolve();
const _busy = new Map();          // first cache file of a run -> Promise

function _keep(file, arr) {
  try {
    fs.mkdirSync(DIR, { recursive: true });
    const tmp = file + '.' + process.pid + '.tmp';
    fs.writeFileSync(tmp, Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength));
    fs.renameSync(tmp, file);
  } catch (e) { console.warn('[track-pauses] not kept:', e.message); }
}

function _load(file) {
  try {
    const b = fs.readFileSync(file);
    return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength - (b.byteLength % 4)));
  } catch (e) { return null; }
}

// The pieces b0..b1 of the file, read where they are not kept yet. A piece shorter than BLOCK is where the file ends.
async function _blocks(abs, st, b0, b1) {
  const have = [];
  const missing = [];
  for (let b = b0; b <= b1; b++) {
    const a = _load(_file(abs, st, b));
    have[b - b0] = a;
    if (!a) missing.push(b);
  }
  // Runs of consecutive missing pieces, each read by one ffmpeg.
  const runs = [];
  for (const b of missing) {
    const last = runs[runs.length - 1];
    if (last && last[1] === b - 1) last[1] = b; else runs.push([b, b]);
  }
  for (const [r0, r1] of runs) {
    const key = _file(abs, st, r0) + '..' + r1;
    let job = _busy.get(key);
    if (!job) {
      job = _chain.then(async () => {
        const { db: got, ok } = await _read(abs, r0 * BLOCK, (r1 - r0 + 1) * BLOCK);
        // Kept only when ffmpeg read it well - a piece past the file's end is kept empty: that is what is there.
        if (ok) for (let b = r0; b <= r1; b++) _keep(_file(abs, st, b), got.subarray(Math.min(got.length, (b - r0) * PER_BLOCK), Math.min(got.length, (b - r0 + 1) * PER_BLOCK)));
        // This file's pieces from before it changed are of no use to anybody.
        try {
          const stem = _stem(abs) + '-', ver = stem + _ver(st) + '-';
          for (const f of fs.readdirSync(DIR)) {
            if (f.startsWith(stem) && !f.startsWith(ver) && f.endsWith('.f32')) { try { fs.unlinkSync(path.join(DIR, f)); } catch (e) { /* in use */ } }
          }
        } catch (e) { /* no folder */ }
        return got;
      });
      _chain = job.catch(() => {});
      _busy.set(key, job);
      job.finally(() => _busy.delete(key)).catch(() => {});
    }
    const got = await job;
    for (let b = r0; b <= r1; b++) have[b - b0] = got.subarray(Math.min(got.length, (b - r0) * PER_BLOCK), Math.min(got.length, (b - r0 + 1) * PER_BLOCK));
  }
  return have;
}

/**
 * The pauses of the file's sound inside [from, to) (seconds of the file), by the rule above.
 * @returns {Promise<{from:number,to:number,floor:number,thr:number,pauses:number[][]}>} `to` cut to the file's end; `floor`
 *   the 10th percentile and `thr` the threshold, dB; each pause [a, b] in seconds of the file, inside [from, to]
 */
async function pausesIn(abs, from, to) {
  const st = fs.statSync(abs);
  if (!st.isFile()) throw new Error('not a file');
  from = Math.max(0, +from || 0);
  to = Math.max(from, +to || 0);
  // The noise floor's stretch: [from, to] widened to FLOOR_SPAN, as evenly as the file's start allows.
  const pad = Math.max(0, (FLOOR_SPAN - (to - from)) / 2);
  const f0 = Math.max(0, from - pad), f1 = to + pad + Math.max(0, pad - from);
  const b0 = Math.floor(f0 / BLOCK), b1 = Math.floor(f1 / BLOCK);
  const parts = await _blocks(abs, st, b0, b1);
  // The windows b0..b1 as one run, until the first piece that is short (the file's end).
  let n = 0;
  for (const p of parts) { n += p.length; if (p.length < PER_BLOCK) break; }
  const db = new Float32Array(n);
  let o = 0;
  for (const p of parts) { db.set(p, o); o += p.length; if (p.length < PER_BLOCK) break; }
  const base = b0 * BLOCK;                                   // the file's second of window 0
  const at = (i) => base + (i * HOP + WIN / 2) / SR;         // the middle of window i
  const ix = (t) => Math.max(0, Math.min(n, Math.round((t - base - WIN / 2 / SR) * FPS)));
  const end = n ? at(n - 1) + HOP / SR : from;
  to = Math.min(to, end);
  if (!(to > from) || !n) return { from: r3(from), to: r3(Math.max(from, to)), floor: null, thr: null, pauses: [] };
  // The floor over [f0, f1] cut to the file.
  const s0 = ix(f0), s1 = Math.max(s0 + 1, ix(Math.min(f1, end)));
  const sorted = db.slice(s0, s1).sort();
  const floor = sorted[Math.floor(0.1 * (sorted.length - 1))];
  const thr = Math.min(QUIET_MAX, floor + OVER_FLOOR);
  const pauses = [];
  const i0 = ix(from), i1 = Math.min(n - 1, ix(to));
  for (let i = i0; i <= i1;) {
    if (!(db[i] < thr)) { i++; continue; }
    let j = i;
    while (j + 1 <= i1 && db[j + 1] < thr) j++;
    const a = Math.max(from, at(i) - EDGE), b = Math.min(to, at(j) + EDGE);
    if (b - a >= MIN_PAUSE - 1e-9) pauses.push([r3(a), r3(b)]);
    i = j + 1;
  }
  return { from: r3(from), to: r3(to), floor: Math.round(floor * 10) / 10, thr: Math.round(thr * 10) / 10, pauses };
}

module.exports = { pausesIn, QUIET_MAX, OVER_FLOOR, MIN_PAUSE, BLOCK };
