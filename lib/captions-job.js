'use strict';

// ════════════════════════════════════════════════════════════════════════════
// CAPTIONS FROM THE SOUND - the server listens to a project and lays the lines (phase K1, 2026-10-03).
//
// It used to be the page's job: the page sent the sound, polled an anonymous job and, when the words
// came back, put them into whatever project was open THEN - every subtitle lane is called `subs`, so a
// project switched to in the meantime got the other one's words - and a page left or reloaded lost the
// result it had paid for. Now the job belongs to the PROJECT (its timeline key), runs here whatever the
// page does, and lays the lines itself.
//
//   the sound     the timeline's own, as public/js/captions/heard.js soundPieces says: main audio first,
//                 the other lanes in its silences, no music beds, nothing reversed. Every piece decoded
//                 by ffmpeg to 16 kHz mono and put at its exact sample in one run of PCM
//   the asking    FLAC (lossless - the mp3 this replaced was 24 kbit/s and took the s and the sh away),
//                 one request up to ten minutes, longer ones cut at the quietest moment near each ten
//                 minutes (lib/groq-stt.js)
//   the keeping   every answer the moment it arrives, by the signature of its samples
//                 (lib/subs-store.js): the same sound is never paid for twice
//   the laying    ONE tick (MSTORE.update): the lines that were heard are replaced, the lines typed by
//                 hand stay exactly as they are, and the words under a typed line are left out
//
// A JOB IS IN MEMORY, one per project, and that is where "listening..." comes from: a page that comes
// back - left and returned, reloaded - asks for it by the project's key. A restart of the app forgets the
// job but not what was paid for; pressing again reuses it. Not an Alerts row: seconds, like a voice.
// ════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const MSTORE = require('./merge-store');
const SUBS = require('./subs-store');
const GROQ = require('./groq-stt');
const SHAPE = require('./timeline-shape');
const CAP = require('./mv3b-subs');
const { toDiskExisting } = require('./media');
const { TEMP_DIR } = require('./config');

const HEARD = CAP.HEARD;
const SR = 16000;                    // what Whisper hears at; Groq resamples to it anyway
const MAX_SECONDS = 3600;            // an hour of sound is 115 MB of samples in memory
const ONE_GO = 600;                  // seconds asked for in one request
const DECODE_AT_ONCE = 3;
const PIECE_MS = 120000;             // one piece's ffmpeg, before it is given up
const KEEP_MS = 15 * 60e3;           // a finished job is remembered this long
const LIMIT_MS = 15 * 60e3;          // a job still listening after this is dead
const PIPELINE_V = 1;                // bump when the way the sound is put together changes

const JOBS = new Map();              // timeline key -> job
// THE ANSWERS BEING ASKED FOR RIGHT NOW, by the signature of their sound (review K1). A job let go of -
// by the sweep, by a file that moved - leaves its request running: Groq is answering it and it is paid
// for. A new press for the same sound waits for that answer instead of buying the piece again.
const ASKING = new Map();
const GONE = 'The project was deleted while it was being listened to.';

class JobError extends Error { constructor(code, message) { super(message); this.code = code; } }

const _sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const _round = (v, n) => Math.round(v * Math.pow(10, n)) / Math.pow(10, n);

// ── The job as the page sees it ─────────────────────────────────────────────
function view(j) {
  if (!j) return null;
  return { id: j.id, state: j.state, step: j.step, part: j.part, startedAt: j.startedAt, endedAt: j.endedAt,
    error: j.error, code: j.code, result: j.result };
}

const _ours = (j) => JOBS.get(j.key) === j && j.state === 'listening';
// The timeline still there? Once it is deleted nothing more is bought for it - its answers would have
// nowhere to be kept (review K1).
function _here(j) { if (!MSTORE.locate(j.key)) throw new JobError('gone', GONE); }

function _kill(j) {
  for (const x of j.procs) { try { x.proc.kill(); } catch (e) { /* gone already */ } }
  j.procs.clear();
}

function _fail(j, code, message) {
  if (j.state !== 'listening') return;
  j.state = 'failed';
  j.code = code || 'failed';
  j.error = String(message || 'It did not finish.').slice(0, 300);
  j.endedAt = Date.now();
  _kill(j);
  console.warn('[captions] ' + j.key + ': ' + j.error);
}

function _sweep() {
  const now = Date.now();
  for (const [key, j] of JOBS) {
    if (j.state === 'listening' && now - j.startedAt > LIMIT_MS) {
      _fail(j, 'timeout', 'It took too long - press again; what was already heard is kept and not paid for again.');
    } else if (j.state !== 'listening' && now - (j.endedAt || 0) > KEEP_MS) {
      JOBS.delete(key);
    }
  }
}

/** The job of a project, or null. */
function get(key) {
  _sweep();
  return view(JOBS.get(String(key)));
}

/** What was last laid on a project, from its file - when no job is in memory (after a restart). */
function last(key) {
  try { return SUBS.lastLaid(String(key)); } catch (e) { return null; }
}

// ── Before anything is spent ────────────────────────────────────────────────
const _subsLane = (t) => ((t && Array.isArray(t.tracks)) ? t.tracks : []).find((x) => x && x.kind === 'subs') || null;
const _soundKey = (pieces) => JSON.stringify(pieces.map((p) => [p.src, _round(p.at, 3), _round(p.end, 3), _round(p.crop, 3), p.speed]));

/** Can this timeline be listened to? { code, error } when not, otherwise { pieces, seconds }. */
function precheck(t) {
  const pieces = HEARD.soundPieces(t);
  if (!pieces.length) return { code: 'no-sound', error: 'There is no sound on the timeline to listen to.' };
  const seconds = Math.max(...pieces.map((p) => p.end));
  if (seconds > MAX_SECONDS) return { code: 'too-long', error: 'More than an hour of sound - too long to listen to in one go.' };
  return { pieces, seconds };
}

// ── The sound ───────────────────────────────────────────────────────────────
// ffmpeg's atempo takes 0.5..2 per stage; a chain covers the rest.
function _atempoChain(sp) {
  sp = Math.max(0.25, Math.min(4, +sp || 1));
  const parts = [];
  let r = sp;
  while (r > 2.0 + 1e-6) { parts.push('atempo=2.0'); r /= 2.0; }
  while (r < 0.5 - 1e-6) { parts.push('atempo=0.5'); r /= 0.5; }
  parts.push('atempo=' + r.toFixed(4));
  return parts.join(',');
}

function _ffmpeg(j, args, input, abs) {
  return new Promise((resolve) => {
    const proc = spawn(ffmpegPath, args, { stdio: [input ? 'pipe' : 'ignore', 'pipe', 'pipe'], windowsHide: true });
    const entry = { proc, abs: abs || null };
    j.procs.add(entry);
    const out = [];
    let err = '';
    const timer = setTimeout(() => { try { proc.kill(); } catch (e) { /* gone */ } }, PIECE_MS);
    proc.stdout.on('data', (c) => out.push(c));
    proc.stderr.on('data', (c) => { err = (err + c).slice(-400); });
    if (input) {
      proc.stdin.on('error', () => { /* it stopped reading: the exit code says why */ });
      proc.stdin.end(input);
    }
    const done = (code) => { clearTimeout(timer); j.procs.delete(entry); resolve({ code, buf: Buffer.concat(out), err }); };
    proc.on('close', done);
    proc.on('error', () => done(-1));
  });
}

// One piece of the timeline, decoded and put at its exact sample. False when it could not be read.
async function _decodeOne(j, p, pcm) {
  const src = String(p.src || '').split('?')[0];
  const abs = /^https?:\/\//i.test(src) ? null : toDiskExisting(src);
  if (!abs || !fs.existsSync(abs)) return false;
  const s0 = Math.round(p.at * SR);
  const n = Math.round(p.end * SR) - s0;
  if (n <= 0) return true;
  const af = (Math.abs(p.speed - 1) > 1e-6 ? _atempoChain(p.speed) + ',' : '') + 'aresample=' + SR;
  const args = ['-hide_banner', '-nostdin', '-v', 'error',
    '-ss', Math.max(0, p.crop).toFixed(4), '-t', ((p.end - p.at) * p.speed + 0.05).toFixed(4), '-i', abs,
    '-vn', '-af', af, '-ac', '1', '-ar', String(SR), '-f', 's16le', 'pipe:1'];
  const r = await _ffmpeg(j, args, null, abs);
  if (r.code !== 0 || !r.buf.length) return false;
  const bytes = Math.min(r.buf.length - (r.buf.length % 2), n * 2);
  r.buf.copy(pcm, s0 * 2, 0, bytes);                 // shorter than its place: the rest stays silent
  return true;
}

async function _decodeAll(j, pieces, pcm, missing) {
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < pieces.length && _ours(j)) {
      const p = pieces[next++];
      if (!(await _decodeOne(j, p, pcm))) missing.push(p.name);
      done++;
      j.part = { i: done, n: pieces.length };
    }
  };
  await Promise.all(Array.from({ length: Math.min(DECODE_AT_ONCE, pieces.length) }, worker));
}

// ── Cutting a long sound ────────────────────────────────────────────────────
const FRAME = SR / 50;                                // 20 ms

// The mean energy of 20 ms frames, from sample `from` to `to`.
function _frames(pcm, from, to) {
  const out = [];
  for (let s = from; s + FRAME <= to; s += FRAME) {
    let e = 0;
    for (let k = 0; k < FRAME; k++) { const v = pcm.readInt16LE((s + k) * 2); e += v * v; }
    out.push(e / FRAME);
  }
  return out;
}

// The middle of the quietest 100 ms between two samples.
function _quietest(pcm, lo, hi) {
  lo = Math.floor(lo); hi = Math.floor(hi);
  const f = _frames(pcm, lo, hi);
  if (f.length < 5) return Math.round((lo + hi) / 2);
  let best = Infinity;
  let at = 0;
  let sum = f[0] + f[1] + f[2] + f[3] + f[4];
  for (let i = 0; i + 5 <= f.length; i++) {
    if (i > 0) sum += f[i + 4] - f[i - 1];
    if (sum < best) { best = sum; at = i; }
  }
  return lo + (at + 2) * FRAME + FRAME / 2;
}

function _cutInto(pcm, n) {
  const total = pcm.length / 2;
  const out = [];
  let prev = 0;
  for (let k = n; k > 1; k--) {
    const ideal = prev + (total - prev) / k;
    const lo = Math.max(prev + 30 * SR, ideal - 60 * SR);
    const hi = Math.min(prev + ONE_GO * SR, ideal + 30 * SR);
    const cut = hi > lo ? _quietest(pcm, lo, hi) : Math.round(ideal);
    out.push({ from: prev, to: cut });
    prev = cut;
  }
  out.push({ from: prev, to: total });
  return out;
}

/** The pieces the sound is asked in: one up to ten minutes, otherwise cut where it is quietest. */
function cut(pcm) {
  const total = pcm.length / 2;
  if (total <= ONE_GO * SR) return [{ from: 0, to: total }];
  for (let n = Math.ceil(total / (540 * SR)); n < 200; n++) {
    const out = _cutInto(pcm, n);
    if (out.every((c) => c.to - c.from <= ONE_GO * SR)) return out;
  }
  // Unreachable in practice: even cuts.
  const n = Math.ceil(total / (ONE_GO * SR));
  return Array.from({ length: n }, (_, i) => ({ from: Math.round(i * total / n), to: Math.round((i + 1) * total / n) }));
}

// ── Reading what came back ──────────────────────────────────────────────────
const VOICED = Math.pow(0.01 * 32768, 2);             // -40 dBFS, as mean square

function _voicedSeconds(slice, fromSample) {
  const f = _frames(slice, Math.max(0, fromSample), slice.length / 2);
  return f.filter((e) => e > VOICED).length * FRAME / SR;
}
const _peak = (slice) => {
  let p = 0;
  for (let i = 0; i + 1 < slice.length; i += 2) { const v = Math.abs(slice.readInt16LE(i)); if (v > p) p = v; }
  return p;
};

// Groq's large-v3 sometimes answers for only the first part of a long sound, and says nothing about
// it. An answer that stops early while the sound plainly goes on is marked: it is laid, said, and
// asked for once more on the next press rather than reused.
function _suspect(answer, slice) {
  const secs = slice.length / 2 / SR;
  const words = Array.isArray(answer && answer.words) ? answer.words : [];
  const lastEnd = words.reduce((m, w) => Math.max(m, +w.end || 0), 0);
  if (!words.length) return _voicedSeconds(slice, 0) > 5;
  return lastEnd < 0.6 * secs && _voicedSeconds(slice, Math.round((lastEnd + 1) * SR)) > 3;
}

const _sig = (slice, lang) => _sha(PIPELINE_V + '|' + GROQ.MODEL + '|' + (lang || 'auto') + '|word,segment|' + _sha(slice));

// Into a FILE, not a pipe: only when it can seek back does ffmpeg write the length and the checksum
// into the FLAC header - a piped FLAC says "length unknown", which a strict reader may refuse.
async function _flac(j, slice) {
  const dir = path.join(TEMP_DIR, 'captions');
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, j.id + '-' + crypto.randomBytes(3).toString('hex') + '.flac');
  try {
    const r = await _ffmpeg(j, ['-hide_banner', '-nostdin', '-v', 'error', '-f', 's16le', '-ar', String(SR), '-ac', '1', '-i', 'pipe:0',
      '-c:a', 'flac', '-fflags', '+bitexact', '-flags:a', '+bitexact', '-y', out], slice);
    let buf = null;
    try { buf = fs.readFileSync(out); } catch (e) { buf = null; }
    if (r.code !== 0 || !buf || !buf.length) throw new JobError('encode', 'The sound could not be prepared for Groq: ' + (r.err.trim().split('\n').pop() || 'ffmpeg failed'));
    if (buf.length > 24 * 1024 * 1024) throw new JobError('too-large', 'This piece of sound is too large for Groq.');
    return buf;
  } finally {
    try { fs.unlinkSync(out); } catch (e) { /* never made */ }
  }
}

// ── The run ─────────────────────────────────────────────────────────────────
async function _run(j, t, pieces) {
  const lang = (HEARD.listenOf(_subsLane(t)) || {}).lang || null;
  const soundKey = _soundKey(pieces);

  // 1. The sound, sample-exact.
  j.step = 'collecting the sound';
  const total = Math.round(Math.max(...pieces.map((p) => p.end)) * SR);
  const pcm = Buffer.alloc(total * 2);
  const missing = [];
  await _decodeAll(j, pieces, pcm, missing);
  if (!_ours(j)) return;
  _here(j);
  if (missing.length === pieces.length) throw new JobError('no-sound', 'None of the sound on the timeline could be found on disk.');

  // 2. The pieces it is asked in, and the run on record before anything is asked.
  const chunks = cut(pcm).map((c) => {
    const slice = pcm.subarray(c.from * 2, c.to * 2);
    return { ...c, slice, sig: _sig(slice, lang), silent: _peak(slice) < 100 };
  });
  const runAt = new Date().toISOString();
  const seconds = _round(total / SR, 2);
  SUBS.putRun(j.key, { at: runAt, audio: _sha(pcm), seconds, model: GROQ.MODEL, language: lang,
    chunks: chunks.map((c) => ({ sig: c.sig, from: _round(c.from / SR, 4), seconds: _round((c.to - c.from) / SR, 2) })),
    paid: 0, reused: 0, laid: null });

  // 3. Asking - or not, for what was heard before.
  let paid = 0;
  let reused = 0;
  let suspect = false;
  let partial = false;
  const heard = [];
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    j.step = chunks.length > 1 ? 'part ' + (i + 1) + ' of ' + chunks.length : 'Groq is hearing it';
    j.part = chunks.length > 1 ? { i: i + 1, n: chunks.length } : null;
    if (c.silent) continue;                           // nothing in it to hear, and a silent request is billed
    _here(j);
    if (ASKING.has(c.sig)) {                          // an earlier job is still asking for this very sound
      try { await ASKING.get(c.sig); } catch (e) { /* it failed: asked again below */ }
      if (!_ours(j)) return;
    }
    let entry = SUBS.find(j.key, c.sig);
    if (entry) reused++;
    else {
      const flac = await _flac(j, c.slice);
      if (!_ours(j)) return;
      _here(j);
      // Kept the moment it arrives, inside the request's own promise: paid for, it is kept even if this
      // job is let go of meanwhile - and whoever waits on it (ASKING) finds it.
      const asking = GROQ.transcribe(flac, { language: lang, stop: () => !_ours(j) || !MSTORE.locate(j.key) })
        .then((answer) => {
          const e = { at: new Date().toISOString(), model: GROQ.MODEL, language: lang, seconds: _round((c.to - c.from) / SR, 2),
            suspect: _suspect(answer, c.slice), asked: SUBS.asked(j.key, c.sig) + 1, answer };
          SUBS.putAnswer(j.key, c.sig, e);
          return e;
        });
      ASKING.set(c.sig, asking);
      try {
        entry = await asking;
      } catch (e) {
        if (e.code === 'stopped' && !MSTORE.locate(j.key)) throw new JobError('gone', GONE);
        throw e;
      } finally {
        if (ASKING.get(c.sig) === asking) ASKING.delete(c.sig);
      }
      paid++;
      if (!_ours(j)) return;
    }
    // A suspect answer is asked for once more on the next press; asked twice and still short, it stands -
    // and pressing again would change nothing, so the page says so instead of inviting it.
    if (entry.suspect) { if ((+entry.asked || 1) < 2) suspect = true; else partial = true; }
    heard.push({ from: c.from / SR, answer: entry.answer || {} });
  }

  // 4. In timeline seconds.
  const words = [];
  const segments = [];
  for (const h of heard) {
    for (const w of (Array.isArray(h.answer.words) ? h.answer.words : [])) {
      words.push({ text: w.word != null ? w.word : w.text, start: h.from + (+w.start || 0), end: h.from + (+w.end || 0) });
    }
    for (const g of (Array.isArray(h.answer.segments) ? h.answer.segments : [])) {
      segments.push({ start: h.from + (+g.start || 0), end: h.from + (+g.end || 0), no_speech_prob: g.no_speech_prob,
        avg_logprob: g.avg_logprob, compression_ratio: g.compression_ratio });
    }
  }
  const spoken = (heard.find((h) => h.answer.language) || { answer: {} }).answer.language || null;
  const gaps = HEARD.silencesOf(pieces);

  // 5. Laid in ONE tick, on the timeline as it is NOW.
  j.step = 'laying the lines';
  j.part = null;
  let res = null;
  const stored = MSTORE.update(j.key, (tl) => {
    if (!_ours(j) || !Array.isArray(tl.tracks)) return false;
    let lane = _subsLane(tl);
    const typed = lane ? (lane.clips || []).filter((c) => c && !HEARD.isHeard(c)) : [];
    const clean = HEARD.cleanWords(words, segments, {
      gaps, typed: typed.map((c) => [+c.start || 0, (+c.start || 0) + (+c.dur || 0)]) });
    res = { lines: 0, words: clean.words.length, dropped: clean.dropped,
      moved: _soundKey(HEARD.soundPieces(tl)) !== soundKey };
    // Heard nothing: the lane stays as it was (it used to be wiped).
    if (!clean.words.length) return false;
    if (!lane) {
      lane = { id: 'subs', kind: 'subs', name: 'Subtitles', linkId: null, main: true, volume: null, speed: null,
        style: CAP.normalizeStyle({}), listen: null, clips: [] };
      tl.tracks.push(lane);
    }
    const phrases = HEARD.groupWords(clean.words, HEARD.perLineOf(lane, tl.format));
    const stamp = Date.now().toString(36);
    const made = phrases.map((p, i) => ({
      id: 'h' + stamp + i.toString(36) + Math.random().toString(36).slice(2, 5), src: null, thumb: null,
      name: p.name, start: p.start, dur: Math.max(0.1, p.dur), words: p.words,
      srcDur: 0, trimIn: 0, trimOut: 0, speed: 1, reversed: false,
      transition: null, animation: null, filter: null, volume: null, pairId: null,
    }));
    // Stored in exactly the shape a page's save stores (lib/timeline-shape.js).
    const shaped = SHAPE.sanitizeBlank({ format: tl.format, tracks: [{ id: lane.id, kind: 'subs', clips: made }] }).tracks[0].clips;
    lane.clips = typed.concat(shaped).sort((a, b) => (+a.start || 0) - (+b.start || 0));
    res.lines = shaped.length;
    return true;
  });
  if (!_ours(j)) return;
  if (stored === null) throw new JobError('gone', GONE);

  const laid = res && res.lines > 0;
  SUBS.setLaid(j.key, runAt, laid ? { rev: stored.rev, lines: res.lines, words: res.words } : null);
  j.result = { lines: laid ? res.lines : 0, words: res ? res.words : 0, rev: laid ? stored.rev : null,
    paid, reused, seconds, language: spoken, asked: lang,
    dropped: res ? res.dropped : { noise: 0, silence: 0, typed: 0 }, missing, moved: !!(res && res.moved), suspect, partial };
  j.state = 'done';
  j.endedAt = Date.now();
  console.log('[captions] ' + j.key + ': ' + j.result.lines + ' lines from ' + j.result.words + ' words, '
    + seconds + ' s of sound, ' + paid + ' asked, ' + reused + ' reused' + (laid ? ', rev ' + stored.rev : ''));
}

/** Start listening to a project. The caller has checked everything (routes/mv3-captions.js). */
function start(key, t, pieces) {
  _sweep();
  const j = { id: 'cap_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), key: String(key),
    state: 'listening', step: 'starting', part: null, startedAt: Date.now(), endedAt: null,
    error: null, code: null, result: null, procs: new Set() };
  JOBS.set(j.key, j);
  _run(j, t, pieces).catch((e) => _fail(j, e.code || 'failed', e.message));
  return view(j);
}

function busy(key) {
  _sweep();
  const j = JOBS.get(String(key));
  return !!j && j.state === 'listening';
}

// A file about to move (lib/relocate.js) cannot be held open by our ffmpeg - Windows refuses the
// rename. The job lets go and says so; what was already heard is kept.
require('./file-release').onRelease((absPaths) => {
  const roots = absPaths.map((a) => path.resolve(a).toLowerCase());
  const hit = (abs) => { const p = path.resolve(abs).toLowerCase(); return roots.some((r) => p === r || p.startsWith(r + path.sep)); };
  for (const j of JOBS.values()) {
    if (j.state !== 'listening') continue;
    if ([...j.procs].some((x) => x.abs && hit(x.abs))) {
      _fail(j, 'moved', 'A file moved while it was being listened to - press again (what was already heard is kept).');
    }
  }
});

module.exports = { get, last, start, busy, precheck, view, cut, MAX_SECONDS, SR, _jobs: JOBS };
