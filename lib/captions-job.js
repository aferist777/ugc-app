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
//                 hand - and the heard lines a person corrected (K10) - stay exactly as they are, and the
//                 words under them are left out; "back to what was heard" replaces the corrected ones too
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
const LOCAL = require('./whisper-local');
const WW = require('./whisper-words');
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
const LIMIT_MS = 15 * 60e3;          // a job that has given no sign of life for this long is dead
const PIPELINE_V = 1;                // bump when the way the sound is put together changes

const JOBS = new Map();              // timeline key -> job
// THE ANSWERS BEING ASKED FOR RIGHT NOW, by the signature of their sound (review K1). A job let go of -
// by the sweep, by a file that moved - leaves its request running: Groq is answering it and it is paid
// for. A new press for the same sound waits for that answer instead of buying the piece again.
const ASKING = new Map();
const GONE = 'The project was deleted while it was being listened to.';
// Laying again what was heard (K2) finds a piece of sound nobody has heard yet: it stops before asking.
const CHANGED = 'The sound has changed since it was heard - Generate from the sound hears the new part.';
const LOST = 'What was heard for this sound is no longer kept - Generate from the sound hears it again.';
// WHEN GROQ CANNOT BE ASKED, this computer hears it (phase K1b) - and what the page says about why.
// stopped and gone are not here: a project deleted or a job let go of is never heard anywhere else.
const FELL = { 'no-key': 'No Groq key', network: 'Groq could not be reached', down: 'Groq is not answering',
  busy: 'Groq is busy', limit: "Groq's limit is used up", 'bad-key': 'Groq did not accept the key',
  refused: 'Groq refused this sound', 'too-large': 'Groq refused this sound' };

class JobError extends Error { constructor(code, message) { super(message); this.code = code; } }

const _sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const _round = (v, n) => Math.round(v * Math.pow(10, n)) / Math.pow(10, n);

// ── The job as the page sees it ─────────────────────────────────────────────
function view(j) {
  if (!j) return null;
  return { id: j.id, state: j.state, step: j.step, part: j.part, startedAt: j.startedAt, endedAt: j.endedAt,
    error: j.error, code: j.code, result: j.result,
    engine: j.engine, where: j.where, pct: j.pct, dl: j.dl, wait: j.wait, fell: j.fell, stored: !!j.stored };
}

const _ours = (j) => JOBS.get(j.key) === j && j.state === 'listening';
// A SIGN OF LIFE (phase K1b): a piece started, a percent heard here, a byte of the model, a wait for a
// render. A job is given up after LIMIT_MS without one - not after LIMIT_MS from its start, which an
// honest hour of sound on a processor would outlive.
const _beat = (j) => { j.alive = Date.now(); };
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
    if (j.state === 'listening' && now - (j.alive || j.startedAt) > LIMIT_MS) {
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
      _beat(j);
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

// SPEECH NOBODY HEARD: the most voiced seconds in one stretch of a piece that no word lies over (words
// in seconds of the piece, padded 0.3 s each side). Whisper large-v3-turbo can skip a whole window of
// speech and say nothing (#3729; the benchmark caught it on this laptop).
function _uncovered(words, slice) {
  const f = _frames(slice, 0, slice.length / 2);
  const covered = new Uint8Array(f.length);
  for (const w of (words || [])) {
    const a = Math.max(0, Math.floor(((+w.start || 0) - 0.3) * 50)), b = Math.min(f.length - 1, Math.ceil(((+w.end || 0) + 0.3) * 50));
    for (let i = a; i <= b; i++) covered[i] = 1;
  }
  let best = 0, run = 0;
  for (let i = 0; i < f.length; i++) {
    if (covered[i]) { run = 0; continue; }
    if (f[i] > VOICED) { run++; if (run > best) best = run; }
  }
  return best * FRAME / SR;
}

// Groq's large-v3 sometimes answers for only the first part of a long sound, or skips a stretch, and
// says nothing about it. Such an answer is marked: it is laid, said, and asked for once more on the next
// press rather than reused.
function _suspect(answer, slice) {
  const secs = slice.length / 2 / SR;
  const words = Array.isArray(answer && answer.words) ? answer.words : [];
  const lastEnd = words.reduce((m, w) => Math.max(m, +w.end || 0), 0);
  if (!words.length) return _voicedSeconds(slice, 0) > 5;
  if (lastEnd < 0.6 * secs && _voicedSeconds(slice, Math.round((lastEnd + 1) * SR)) > 3) return true;
  return _uncovered(words, slice) >= 6;
}

// WHERE A WORD STARTS (phase K1b). Both engines start a word after a pause where the word before it ended -
// it swallows the pause (Groq's first word of a read began up to 0.4 s early, whisper.cpp's DTW gives one
// point per token). The sound says where speech resumes: the first 20 ms frame above -40 dBFS inside the
// word moves its start there, when that is at least 0.1 s in. Words in timeline seconds, pcm the run.
function _trimStarts(words, pcm) {
  if (!words.length) return words;
  const f = _frames(pcm, 0, pcm.length / 2);
  return words.map((w) => {
    const f0 = Math.max(0, Math.floor(w.start * 50)), f1 = Math.min(f.length - 1, Math.floor((w.end - 0.04) * 50));
    let i = f0;
    while (i <= f1 && f[i] <= VOICED) i++;
    if (i > f1) return w;
    const t = i * FRAME / SR;
    return t - w.start >= 0.1 ? { ...w, start: Math.round(t * 100) / 100 } : w;
  });
}

const _sig = (slice, lang) => _sha(PIPELINE_V + '|' + GROQ.MODEL + '|' + (lang || 'auto') + '|word,segment|' + _sha(slice));
// Heard here: the same sound under another name - the model and its settings, never the program's version.
// The rules that turn its tokens into words (whisper-words NORM_V) are part of it: a piece heard under older
// rules is heard again rather than laid with them (review K1b).
const _sigLocal = (slice, lang) => _sha(PIPELINE_V + '|' + LOCAL.MODEL_ID + '/n' + WW.NORM_V + '|' + (lang || 'auto') + '|word,segment|' + _sha(slice));

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
// Groq first; this computer when the lane says so, or for the rest of a run once Groq could not be asked
// (phase K1b). A piece heard in one place is never laid as heard in the other: each has its own signature.
async function _askGroq(j, c, lang) {
  if (ASKING.has(c.sig)) {                            // an earlier job is still asking for this very sound
    try { await ASKING.get(c.sig); } catch (e) { /* it failed: asked again below */ }
    if (!_ours(j)) return null;
  }
  let entry = SUBS.find(j.key, c.sig);
  if (entry) { j.counts.reused++; return entry; }
  const flac = await _flac(j, c.slice);
  if (!_ours(j)) return null;
  _here(j);
  _beat(j);
  // Kept the moment it arrives, inside the request's own promise: paid for, it is kept even if this
  // job is let go of meanwhile - and whoever waits on it (ASKING) finds it.
  const asking = GROQ.transcribe(flac, { language: lang, stop: () => !_ours(j) || !MSTORE.locate(j.key) })
    .then((answer) => {
      const e = { at: new Date().toISOString(), engine: 'cloud', model: GROQ.MODEL, language: lang, seconds: _round((c.to - c.from) / SR, 2),
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
  j.counts.paid++;
  return entry;
}

// The model, before the first piece is heard here. Downloaded at once when the lane chose this computer
// or the person said yes to it; a run that only FELL here asks first (the owner, K1b answer 4).
async function _ensureModel(j, mayDownload) {
  if (LOCAL.hasModel()) return;
  const why = j.fell ? FELL[j.fell] + ' and the' : 'The';
  if (!mayDownload) {
    throw new JobError('need-model', why + ' speech model for this computer is not downloaded yet (' + Math.round(LOCAL.MODEL_BYTES / 1e6) + ' MB).');
  }
  j.step = 'downloading the speech model';
  j.where = 'local';
  try {
    await LOCAL.download('model', ({ got, total }) => { j.dl = { got, total }; _beat(j); });
  } catch (e) {
    throw new JobError('no-model', why + ' speech model for this computer could not be downloaded (' + e.message
      + ') - connect to the internet and press again.');
  } finally { j.dl = null; }
}

async function _hearHere(j, c, lang, mayDownload) {
  const entry = SUBS.find(j.key, c.sigL);
  if (entry) { j.counts.reusedLocal++; return entry; }
  await _ensureModel(j, mayDownload);
  if (!_ours(j)) return null;
  _here(j);
  j.step = 'on this computer';
  j.where = 'local';
  j.pct = 0;
  const run = (variant) => LOCAL.transcribe(c.slice, {
    language: lang, variant, stop: () => !_ours(j) || !MSTORE.locate(j.key),
    onProgress: (p) => { j.pct = p; j.wait = null; _beat(j); },
    onWait: (w) => { j.wait = w; _beat(j); },
  });
  let got;
  try {
    got = await run(null);
    // A stretch of speech with no word in it: turbo dropped a window (#3729, the benchmark caught it). Once
    // more, decoded another way, and the answer that covers the speech better stands.
    const missed = _uncovered(got.answer.words, c.slice);
    if (missed >= 4) {
      j.wait = null;
      j.pct = 0;
      const again = await run('retry');
      if (_uncovered(again.answer.words, c.slice) < missed) got = again;
    }
  } catch (e) {
    if (e.code === 'stopped' && !MSTORE.locate(j.key)) throw new JobError('gone', GONE);
    if (e.code === 'stopped') return null;
    throw e;
  }
  j.counts.local++;
  j.took += got.took;
  if (got.timing === 'approximate' && Array.isArray(got.answer.words) && got.answer.words.length) j.approx = true;
  const e = { at: new Date().toISOString(), engine: 'local', model: LOCAL.MODEL_ID, build: got.build, version: got.version,
    took: got.took, timing: got.timing, language: lang, seconds: _round((c.to - c.from) / SR, 2), suspect: false, asked: 1,
    answer: got.answer, raw: got.raw, norm: got.norm };
  SUBS.putAnswer(j.key, c.sigL, e);
  return e;
}

async function _run(j, t, pieces, opts) {
  const listen = HEARD.listenOf(_subsLane(t)) || {};
  const lang = listen.lang || null;
  const chosenLocal = listen.engine === 'local';
  const mayDownload = chosenLocal || !!(opts && opts.download);
  const soundKey = _soundKey(pieces);
  // LAYING AGAIN WHAT WAS HEARD (K2, "back to what was heard"): every piece from its stored answer, or the
  // job stops before anybody is asked - nothing is paid for by construction.
  const again = !!j.stored;
  let local = chosenLocal;
  if (!again && !local && !GROQ.keyOf()) { j.fell = 'no-key'; local = true; }   // the route let it through: this computer can hear
  j.engine = local ? 'local' : 'cloud';

  // 1. The sound, sample-exact.
  j.step = 'collecting the sound';
  const total = Math.round(Math.max(...pieces.map((p) => p.end)) * SR);
  const pcm = Buffer.alloc(total * 2);
  const missing = [];
  await _decodeAll(j, pieces, pcm, missing);
  if (!_ours(j)) return;
  _here(j);
  if (missing.length === pieces.length) throw new JobError('no-sound', 'None of the sound on the timeline could be found on disk.');

  // 2. The pieces it is heard in, and the run on record before anything is asked.
  const chunks = cut(pcm).map((c) => {
    const slice = pcm.subarray(c.from * 2, c.to * 2);
    return { ...c, slice, sig: _sig(slice, lang), sigL: _sigLocal(slice, lang), silent: _peak(slice) < 100 };
  });
  const audio = _sha(pcm);
  // AGAIN: what was laid for THIS sound, piece by piece - the answer each piece was laid from (`used`, review
  // K2), under the signatures it was heard under, whatever the lane's language or a newer model says now. A
  // usable answer before a suspect one; a sound never laid here is looked for under today's signatures
  // (a copy of the project finds its original's) and is "changed" when nothing has it.
  let prior = null;
  if (again) {
    prior = (SUBS.read(j.key).runs || []).find((r) => r && r.laid && r.audio === audio
      && Array.isArray(r.chunks) && r.chunks.length === chunks.length) || null;
    const pick = (order) => {
      for (const any of [false, true]) {
        for (const [from, sig] of order) {
          const e = sig ? SUBS.find(j.key, sig, any) : null;
          if (e) return { e, from };
        }
      }
      return null;
    };
    chunks.forEach((c, i) => {
      if (c.silent) return;
      let got;
      if (prior) {
        const rc = prior.chunks[i] || {};
        const used = prior.laid.used && prior.laid.used[i];
        const localFirst = used ? used === 'sigL' : prior.laid.engine === 'local';
        got = pick(localFirst ? [['sigL', rc.sigL], ['sig', rc.sig]] : [['sig', rc.sig], ['sigL', rc.sigL]]);
        if (!got) throw new JobError('lost', LOST);
        c.sig = rc.sig; c.sigL = rc.sigL;
      } else {
        got = pick(chosenLocal ? [['sigL', c.sigL], ['sig', c.sig]] : [['sig', c.sig], ['sigL', c.sigL]]);
        if (!got) throw new JobError('changed', CHANGED);
      }
      c.kept = got.e;
      c.used = got.from;
    });
  }
  const runAt = new Date().toISOString();
  const seconds = _round(total / SR, 2);
  // Laid again from a run, the record is that run's - its language and engines - so the store folds the
  // two into one instead of a free press pushing answers for other sounds out of the file (review K2).
  SUBS.putRun(j.key, { at: runAt, audio, seconds, model: prior ? prior.model : GROQ.MODEL, local: prior ? prior.local : LOCAL.MODEL_ID,
    language: prior ? prior.language : lang,
    chunks: chunks.map((c) => ({ sig: c.sig, sigL: c.sigL, from: _round(c.from / SR, 4), seconds: _round((c.to - c.from) / SR, 2) })),
    paid: 0, reused: 0, laid: null });

  // 3. Hearing - or not, for what was heard before.
  let suspect = false;
  let partial = false;
  const heard = [];
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    j.part = chunks.length > 1 ? { i: i + 1, n: chunks.length } : null;
    j.pct = null;
    j.wait = null;
    _beat(j);
    if (c.silent) continue;                           // nothing in it to hear, and a silent request is billed
    _here(j);
    let entry = null;
    if (again) {
      entry = c.kept;
      if (entry.engine === 'local') j.counts.reusedLocal++; else j.counts.reused++;
    } else if (!local) {
      j.where = 'cloud';
      j.step = 'Groq is hearing it';
      try {
        entry = await _askGroq(j, c, lang);
        c.used = 'sig';
      } catch (e) {
        // Groq cannot be asked: this computer, for the rest of the run - the next pieces do not each wait
        // through four tries. Never when the project went or the job was let go of.
        if (!FELL[e.code] || !LOCAL.hasProgram()) throw e;
        j.fell = e.code;
        local = true;
        console.warn('[captions] ' + j.key + ': ' + FELL[e.code] + ' - on this computer from here');
      }
      if (!_ours(j)) return;
    }
    if (local && !again) {
      // The lane asked Groq and the run only fell here: a piece Groq has already answered is laid from that
      // answer - paid for, and the better ear - not heard again here (review K1b).
      const cloud = chosenLocal ? null : SUBS.find(j.key, c.sig);
      if (cloud) { j.counts.reused++; entry = cloud; c.used = 'sig'; }
      else {
        j.step = 'on this computer';
        entry = await _hearHere(j, c, lang, mayDownload);
        c.used = 'sigL';
        if (!_ours(j)) return;
      }
    }
    if (!entry) return;
    // A suspect answer is asked for once more on the next press; asked twice and still short, it stands -
    // and pressing again would change nothing, so the page says so instead of inviting it.
    if (entry.suspect) { if ((+entry.asked || 1) < 2) suspect = true; else partial = true; }
    heard.push({ from: c.from / SR, answer: entry.answer || {} });
  }

  // 4. In timeline seconds. A word after a pause starts where the sound does (both engines start it early).
  let words = [];
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
  // Whisper stretches the last word of a read into the next one: put back on its own side of the seam (K2).
  // Trimmed first, so the NEXT read's first word, started early in this one's quiet tail, is already at its
  // sound past the seam and is not taken for the stretched one; trimmed again after, for the word the seam
  // moved (review K2).
  const joins = CAP.PAGES.joinsOf(pieces);
  words = _trimStarts(CAP.PAGES.fixJoins(_trimStarts(words.sort((a, b) => a.start - b.start), pcm), joins), pcm);
  const spoken = (heard.find((h) => h.answer.language) || { answer: {} }).answer.language || null;
  const gaps = HEARD.silencesOf(pieces);

  // 5. Laid in ONE tick, on the timeline as it is NOW.
  j.step = again ? 'laying again what was heard' : 'laying the lines';
  j.part = null;
  j.pct = null;
  let res = null;
  const stored = MSTORE.update(j.key, (tl) => {
    if (!_ours(j) || !Array.isArray(tl.tracks)) return false;
    let lane = _subsLane(tl);
    const span = (c) => [+c.start || 0, (+c.start || 0) + (+c.dur || 0)];
    const typed = lane ? (lane.clips || []).filter((c) => c && !HEARD.isHeard(c)) : [];
    // A HEARD LINE A PERSON CORRECTED (K10) stays as a typed one does - the very object, the words under it
    // left out - unless this is "back to what was heard", which takes the corrections back (the owner's
    // answer 1, 2026-10-03).
    const fixed = (lane && !again) ? (lane.clips || []).filter((c) => HEARD.isHeard(c) && CAP.WORDS.isCorrected(c)) : [];
    const clean = HEARD.cleanWords(words, segments, { gaps, typed: typed.map(span), fixed: fixed.map(span) });
    // ...and says when one no longer looks like what is heard under it now: the sound changed, or moved. Judged
    // by the words the person did NOT touch (review K10): a line rewritten on purpose - "99%" spelled out, a
    // translation - is far from what is heard by its letters on every press, though nothing changed; its
    // untouched words still are what is heard at their moments, unless the sound itself is another now. A line
    // with too little left untouched to judge by is not called stale.
    const stale = fixed.filter((c) => {
      const c0 = +c.start || 0;
      const mine = CAP.PAGES.timedWords(c).filter((w) => w && !w.h);
      const said = mine.map((w) => w.w).join(' ');
      if (CAP.WORDS.keyOf(said).length < 4) return false;
      const at = mine.map((w) => [c0 + (+w.s || 0) - 0.05, c0 + (+w.e || 0) + 0.05]);
      const under = words.filter((w) => { const m = (w.start + w.end) / 2; return at.some(([a, b]) => m >= a && m < b); })
        .map((w) => w.text).join(' ');
      return CAP.WORDS.likeness(said, under) < 0.5;
    }).length;
    res = { lines: 0, words: clean.words.length, dropped: clean.dropped, kept: fixed.length, stale,
      moved: _soundKey(HEARD.soundPieces(tl)) !== soundKey };
    // Heard nothing: the lane stays as it was (it used to be wiped).
    if (!clean.words.length) return false;
    if (!lane) {
      lane = { id: 'subs', kind: 'subs', name: 'Subtitles', linkId: null, main: true, volume: null, speed: null,
        style: CAP.normalizeStyle({}), listen: null, clips: [] };
      tl.tracks.push(lane);
    }
    // A heard line wearing a look of its own hands it to the pages cut from its words - by where each word
    // falls (the owner 2026-10-03: a fragment's own style survives a re-cut).
    const replaced = (lane.clips || []).filter((c) => HEARD.isHeard(c) && !fixed.includes(c));
    const looks = replaced.map((c) => [...span(c), CAP.PAGES.lookOf(c)]).filter((x) => x[2]);
    // A word made to stand out (`k`) is a look of the word: it goes to the new word at its moment (K10).
    const marked = [];
    for (const c of replaced) {
      for (const w of CAP.PAGES.timedWords(c)) if (w.k) marked.push([(+c.start || 0) + (+w.s || 0), (+c.start || 0) + (+w.e || 0)]);
    }
    const dressed = clean.words.map((w) => {
      const mid = (w.start + w.end) / 2;
      const o = looks.find(([a, b]) => mid >= a && mid < b);
      const k = marked.some(([a, b]) => (mid >= a && mid < b) || ((a + b) / 2 >= w.start && (a + b) / 2 < w.end));
      let x = o ? { ...w, look: o[2] } : w;
      if (k) x = { ...x, k: true };
      return x;
    });
    const pages = CAP.PAGES.paginate(dressed, { lane: lane.style, format: tl.format, joins,
      typed: typed.map(span).concat(fixed.map(span)) });
    const stamp = Date.now().toString(36);
    const made = pages.map((p, i) => {
      const c = {
        id: 'h' + stamp + i.toString(36) + Math.random().toString(36).slice(2, 5), src: null, thumb: null,
        name: p.name, start: p.start, dur: Math.max(0.1, p.dur), words: p.words,
        srcDur: 0, trimIn: 0, trimOut: 0, speed: 1, reversed: false,
        transition: null, animation: null, filter: null, volume: null, pairId: null,
      };
      if (p.style) c.style = p.style;
      if (p.tx != null) c.tx = p.tx;
      if (p.ty != null) c.ty = p.ty;
      return c;
    });
    // Stored in exactly the shape a page's save stores (lib/timeline-shape.js).
    const shaped = SHAPE.sanitizeBlank({ format: tl.format, tracks: [{ id: lane.id, kind: 'subs', clips: made }] }).tracks[0].clips;
    lane.clips = typed.concat(fixed, shaped).sort((a, b) => (+a.start || 0) - (+b.start || 0));
    res.lines = shaped.length;
    return true;
  });
  if (!_ours(j)) return;
  if (stored === null) throw new JobError('gone', GONE);

  const laid = res && res.lines > 0;
  const n = j.counts;
  const here = n.local + n.reusedLocal > 0, there = n.paid + n.reused > 0;
  const engine = here && there ? 'mixed' : (here ? 'local' : 'cloud');
  // `used`: which answer each piece was laid from - what "back to what was heard" lays again (review K2).
  SUBS.setLaid(j.key, runAt, laid ? { at: new Date().toISOString(), rev: stored.rev, lines: res.lines, words: res.words, engine,
    fell: j.fell || null, used: chunks.map((c) => c.used || null) } : null);
  j.result = { lines: laid ? res.lines : 0, words: res ? res.words : 0, rev: laid ? stored.rev : null,
    paid: n.paid, reused: n.reused, local: n.local, reusedLocal: n.reusedLocal, took: _round(j.took, 1), engine, fell: j.fell || null,
    timing: j.approx ? 'approximate' : 'dtw', seconds, language: spoken, asked: prior ? prior.language : lang,
    dropped: res ? res.dropped : { noise: 0, silence: 0, typed: 0, fixed: 0 }, kept: res ? res.kept : 0, stale: res ? res.stale : 0,
    missing, moved: !!(res && res.moved), suspect, partial, stored: again };
  j.state = 'done';
  j.endedAt = Date.now();
  console.log('[captions] ' + j.key + ': ' + (again ? 'laid again, ' : '') + j.result.lines + ' pages from ' + j.result.words + ' words, '
    + seconds + ' s of sound, ' + n.paid + ' asked, ' + n.reused + ' reused, ' + n.local + ' heard here (' + j.result.took + ' s)'
    + (j.fell ? ', fell: ' + j.fell : '') + (laid ? ', rev ' + stored.rev : ''));
}

/** Start listening to a project. The caller has checked everything (routes/mv3-captions.js). */
function start(key, t, pieces, opts) {
  _sweep();
  const j = { id: 'cap_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), key: String(key),
    stored: !!(opts && opts.stored),
    state: 'listening', step: 'starting', part: null, startedAt: Date.now(), alive: Date.now(), endedAt: null,
    error: null, code: null, result: null, procs: new Set(), engine: 'cloud', where: null, pct: null, dl: null, wait: null,
    fell: null, took: 0, approx: false, counts: { paid: 0, reused: 0, local: 0, reusedLocal: 0 } };
  JOBS.set(j.key, j);
  _run(j, t, pieces, opts || {}).catch((e) => _fail(j, e.code || 'failed', e.message));
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

module.exports = { get, last, start, busy, precheck, view, cut, MAX_SECONDS, SR, FELL, _jobs: JOBS, _uncovered, _trimStarts };
