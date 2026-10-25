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
//
// A TALKING HEAD IS HEARD LINE BY LINE (phase V30, block 1, the owner 2026-10-15): its own timeline is the mirror of its
// script (lib/frag-mirror.js), and every line's sound is heard by itself, under its own signature - the lines a job has
// not heard before in ONE request, back to back - its words taken from the SCRIPT at the moments they were heard, its
// pages bound to the line (`voice`) so they go with it. A line that gets a new sound is heard BY ITSELF a moment later
// (lib/captions-auto.js, `auto`); the press hears every line and whatever else the person laid on the timeline.
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
const PROJECTS = require('./projects-store');
const LCUTS = require('./line-cuts');
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
    engine: j.engine, where: j.where, pct: j.pct, dl: j.dl, wait: j.wait, fell: j.fell, stored: !!j.stored, auto: !!j.auto };
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

// ONE PIECE OF SOUND, heard by whoever hears it now (phase K1b): Groq first - unless the lane chose this computer, or there
// is no Groq key (phase V30, the owner's (с22): the key decides) - and this computer for the rest of the run once Groq could
// not be asked. A piece heard in one place is never laid as heard in the other: each has its own signature.
// `st` - { lang, local, chosenLocal, mayDownload }, changed when the run falls over. { entry, used } or null when let go of.
async function _hearChunk(j, c, st) {
  let entry = null;
  let used = null;
  if (!st.local) {
    j.where = 'cloud';
    j.step = 'Groq is hearing it';
    try {
      entry = await _askGroq(j, c, st.lang);
      used = 'sig';
    } catch (e) {
      // Groq cannot be asked: this computer, for the rest of the run - the next pieces do not each wait
      // through four tries. Never when the project went or the job was let go of.
      if (!FELL[e.code] || !LOCAL.hasProgram()) throw e;
      j.fell = e.code;
      st.local = true;
      console.warn('[captions] ' + j.key + ': ' + FELL[e.code] + ' - on this computer from here');
    }
    if (!_ours(j)) return null;
  }
  if (!entry) {
    // The lane asked Groq and the run only fell here: a piece Groq has already answered is laid from that
    // answer - paid for, and the better ear - not heard again here (review K1b).
    const cloud = st.chosenLocal ? null : SUBS.find(j.key, c.sig);
    if (cloud) { j.counts.reused++; return { entry: cloud, used: 'sig' }; }
    j.step = 'on this computer';
    entry = await _hearHere(j, c, st.lang, st.mayDownload);
    used = 'sigL';
    if (!_ours(j)) return null;
  }
  return entry ? { entry, used } : null;
}

// ── The sound of a timeline, heard in pieces of up to ten minutes (phase K1) ─
// The whole of an ordinary timeline; of a talking head, what is NOT its lines - sound the person laid there themselves.
// @returns { words, segments, joins, gaps, spoken, missing, suspect, partial, chunks, audio, seconds, prior } in timeline
// seconds, or null when the job was let go of. `runAt` - the run's record, written before anything is asked.
async function _hearSound(j, pieces, st, runAt) {
  const again = st.again;
  // 1. The sound, sample-exact.
  j.step = 'collecting the sound';
  const total = Math.round(Math.max(...pieces.map((p) => p.end)) * SR);
  const pcm = Buffer.alloc(total * 2);
  const missing = [];
  await _decodeAll(j, pieces, pcm, missing);
  if (!_ours(j)) return null;
  _here(j);
  if (missing.length === pieces.length) throw new JobError('no-sound', 'None of the sound on the timeline could be found on disk.');

  // 2. The pieces it is heard in, and the run on record before anything is asked.
  const chunks = cut(pcm).map((c) => {
    const slice = pcm.subarray(c.from * 2, c.to * 2);
    return { ...c, slice, sig: _sig(slice, st.lang), sigL: _sigLocal(slice, st.lang), silent: _peak(slice) < 100 };
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
        got = pick(st.chosenLocal ? [['sigL', c.sigL], ['sig', c.sig]] : [['sig', c.sig], ['sigL', c.sigL]]);
        if (!got) throw new JobError('changed', CHANGED);
      }
      c.kept = got.e;
      c.used = got.from;
    });
  }
  const seconds = _round(total / SR, 2);
  // Laid again from a run, the record is that run's - its language and engines - so the store folds the
  // two into one instead of a free press pushing answers for other sounds out of the file (review K2).
  SUBS.putRun(j.key, { at: runAt, audio, seconds, model: prior ? prior.model : GROQ.MODEL, local: prior ? prior.local : LOCAL.MODEL_ID,
    language: prior ? prior.language : st.lang,
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
    } else {
      const got = await _hearChunk(j, c, st);
      if (!got) return null;
      entry = got.entry;
      c.used = got.used;
    }
    if (!entry) return null;
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
  return { words, segments, joins, gaps: HEARD.silencesOf(pieces), spoken, missing, suspect, partial, chunks, audio, seconds, prior };
}

// ── A TALKING HEAD, LINE BY LINE (phase V30, block 1) ─────────────────────────
// Its own timeline `sv3_<project id>` holds the mirror's cells (lib/frag-mirror.js), each with the `voice` of its line: the
// address of the sound it speaks. Each line is heard BY ITSELF, under the signature of its own sound - a line moved, or
// another line read, changes nothing about it, and a line heard once is never asked again. Its words are the SCRIPT's, at
// the moments they were heard; its pages carry its voice and go with it when the cut is laid again.
const LINE_LIKE = 0.9;   // heard this close to the script (the owner's (с20)): the script's words; less - as heard
const _mirrorCells = (t) => ((((t && t.tracks) || []).find((x) => x && x.id === 'a1') || {}).clips || [])
  .filter((c) => c && Number(c.frag) > 0);

/** The lines of a talking head's timeline as they lie now, or null for any other timeline. */
async function _thOf(j) {
  const m = /^sv3_(.+)$/.exec(j.key);
  if (!m) return null;
  const proj = PROJECTS.get(m[1]);
  if (!proj || !Array.isArray(proj.lines) || !proj.lines.length) return null;
  const MIRROR = require('./frag-mirror');
  let t = MSTORE.one(j.key);
  if (!t) return null;
  // A cut laid before the lines' voices were written: laid again first - nothing in it changes but that. (A merged cell of
  // phase V45 has no voice of its own: its lines carry theirs, in `merge`.)
  if (_mirrorCells(t).some((c) => !c.voice && !c.merge)) {
    await MIRROR.rebuild(m[1], { noHearing: true });
    t = MSTORE.one(j.key) || t;
  }
  const now = MIRROR.cellsOf(PROJECTS.get(m[1]) || proj);
  const said = new Map(now.map((c) => [c.voice, c.said]));
  const full = new Map(now.map((c) => [c.voice, Math.round(MIRROR.lineDurOf(c) * 100) / 100]));
  const lane = (t.tracks || []).find((x) => x && x.id === 'a1') || {};
  const master = lane.volume == null ? 1 : +lane.volume;
  const raw = _mirrorCells(t);
  // (phase V45) A merged cell's lines spread out, each with its own voice and pieces (lib/line-cuts.js expand).
  const cells = LCUTS.expand(raw).filter((c) => c.voice);
  // (phase V44) A LINE CUT INTO PIECES is heard WHOLE - its own sound from 0 for its full length, the signature it had uncut, so
  // a cut never asks again - and its words are laid through its cuts (_lay). One line a voice, its first piece speaking for it.
  const first = new Map();
  for (const c of cells.slice().sort((a, b) => (+a.start || 0) - (+b.start || 0))) if (!first.has(String(c.voice))) first.set(String(c.voice), c);
  const lines = [...first.values()].filter((c) => master > 0 && (c.volume == null ? 1 : +c.volume) > 0 && !c.reversed)
    .map((c) => {
      const whole = full.get(c.voice);
      const cut = c.merged || cells.filter((x) => x.voice === c.voice).length > 1 || (+c.trimIn || 0) > 0;
      return { voice: String(c.voice), said: said.get(c.voice) || '', name: String(c.name || ('line ' + c.frag)), n: +c.frag,
        dur: cut && whole > 0 ? whole : Math.max(0, +c.dur || 0), crop: cut && whole > 0 ? 0 : Math.max(0, +c.trimIn || 0),
        speed: +c.speed > 0 ? +c.speed : 1 };
    });
  const bound = new Set(((_subsLane(t) || {}).clips || []).filter((c) => c && c.voice).map((c) => String(c.voice)));
  // `cells` as they lie - what of the sound is the lines' and what the person's (_restOf).
  return { id: m[1], t, cells: raw.filter((c) => c.voice || c.merge), lines, bound };
}

// The sound of a talking head that is not its lines: pieces lying on no mirror cell of their own file.
function _restOf(pieces, cells) {
  return pieces.filter((p) => !cells.some((c) => String(c.src) === p.src && p.at >= (+c.start || 0) - 0.02
    && p.end <= (+c.start || 0) + (+c.dur || 0) + 0.02));
}

// The lines' answers split out of one heard back-to-back run: each line's words and segments in its own seconds, kept under
// its own signature (lib/subs-store.js putLines) the moment the run's answer is in. Cut where the timeline is cut - after the
// trims, never before (the comparison (с22): raw, a line's first word sits in the pause before it).
function _splitLines(j, grp, got, slice) {
  const a = got.entry.answer || {};
  let at = 0;
  const spans = grp.map((L) => { const s = at; at += L.slice.length / 2 / SR; return [s, at]; });
  let words = (Array.isArray(a.words) ? a.words : []).map((w) => ({ text: w.word != null ? w.word : w.text, start: +w.start || 0, end: +w.end || 0 }))
    .sort((x, y) => x.start - y.start);
  if (grp.length > 1) words = _trimStarts(CAP.PAGES.fixJoins(_trimStarts(words, slice), spans.slice(1).map(([s]) => s)), slice);
  const now = new Date().toISOString();
  const put = [];
  grp.forEach((L, k) => {
    const [s, e] = spans[k];
    const len = e - s;
    const ws = words.filter((w) => { const mid = (w.start + w.end) / 2; return mid >= s && mid < e; })
      .map((w) => ({ word: w.text, start: _round(Math.max(0, w.start - s), 3), end: _round(Math.max(0, Math.min(len, w.end - s)), 3) }));
    const segs = (Array.isArray(a.segments) ? a.segments : []).filter((g) => +g.end > s && +g.start < e)
      .map((g) => ({ start: _round(Math.max(0, +g.start - s), 3), end: _round(Math.min(len, +g.end - s), 3), text: g.text,
        no_speech_prob: g.no_speech_prob, avg_logprob: g.avg_logprob, compression_ratio: g.compression_ratio }));
    const entry = grp.length === 1 ? got.entry : { at: now, engine: got.entry.engine || (got.used === 'sigL' ? 'local' : 'cloud'),
      model: got.entry.model, language: got.entry.language, seconds: _round(len, 2),
      // A run Groq may have answered only in part: the line it said nothing of, though it speaks, is asked again.
      suspect: !!got.entry.suspect && !ws.length && _voicedSeconds(L.slice, 0) > 1, asked: +got.entry.asked || 1,
      answer: { words: ws, segments: segs, language: a.language || null }, lines: grp.length };
    put.push([got.used === 'sigL' ? L.sigL : L.sig, entry]);
    L.entry = entry;
    L.used = got.used;
  });
  SUBS.putLines(j.key, put);
}

/**
 * Hear the lines: each one's sound decoded by itself, the kept answers taken, the rest asked in ONE run - back to back, as
 * on the timeline (the owner's (с19); the comparison (с22) found it as exact as a line alone and four to five times faster
 * on this computer), at most ten minutes a request. Changes `lines` (slice, sig, sigL, entry, used, missing, silent).
 * @returns the lines, or null when the job was let go of
 */
async function _hearLines(j, lines, st) {
  j.step = 'collecting the sound';
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < lines.length && _ours(j)) {
      const L = lines[next++];
      const n = Math.round(L.dur * SR);
      L.slice = Buffer.alloc(n * 2);
      if (!n || !(await _decodeOne(j, { src: L.voice, at: 0, end: L.dur, crop: L.crop, speed: L.speed }, L.slice))) L.missing = true;
      done++;
      _beat(j);
      j.part = { i: done, n: lines.length };
    }
  };
  await Promise.all(Array.from({ length: Math.min(DECODE_AT_ONCE, lines.length) }, worker));
  if (!_ours(j)) return null;
  _here(j);

  // What was heard before is never asked again - in either place: a line heard here is not bought from Groq.
  const still = [];
  for (const L of lines) {
    if (L.missing) continue;
    L.sig = _sig(L.slice, st.lang);
    L.sigL = _sigLocal(L.slice, st.lang);
    L.silent = _peak(L.slice) < 100;
    if (L.silent) continue;
    const order = st.local ? [['sigL', L.sigL], ['sig', L.sig]] : [['sig', L.sig], ['sigL', L.sigL]];
    for (const any of (st.again ? [false, true] : [false])) {
      for (const [used, sig] of order) {
        const e = SUBS.find(j.key, sig, any);
        if (e) { L.entry = e; L.used = used; break; }
      }
      if (L.entry) break;
    }
    if (L.entry) {
      if (L.entry.engine === 'local') j.counts.reusedLocal++; else j.counts.reused++;
      still.push([L.used === 'sigL' ? L.sigL : L.sig, null]);             // still a line's: kept
    }
  }
  if (still.length) SUBS.putLines(j.key, still);
  // "Back to what was heard" asks nobody: a line never heard is left for Generate.
  const need = st.again ? [] : lines.filter((L) => !L.entry && !L.missing && !L.silent);
  const groups = [];
  let g = [];
  let secs = 0;
  for (const L of need) {
    const s = L.slice.length / 2 / SR;
    if (g.length && secs + s > ONE_GO) { groups.push(g); g = []; secs = 0; }
    g.push(L);
    secs += s;
  }
  if (g.length) groups.push(g);
  for (let k = 0; k < groups.length; k++) {
    const grp = groups[k];
    j.part = groups.length > 1 ? { i: k + 1, n: groups.length } : null;
    j.pct = null;
    j.wait = null;
    _beat(j);
    _here(j);
    const slice = grp.length === 1 ? grp[0].slice : Buffer.concat(grp.map((L) => L.slice));
    const c = { slice, from: 0, to: slice.length / 2, sig: _sig(slice, st.lang), sigL: _sigLocal(slice, st.lang) };
    const got = await _hearChunk(j, c, st);
    if (!got) return null;
    _splitLines(j, grp, got, slice);
  }
  return lines;
}

// A line's words in its own seconds - the SCRIPT's words at the moments they were heard (the owner's (с1)): matched to the
// line's text without its [tags] by the same retext a hand's rewrite uses (K10), so a misheard word, a number or a name is
// written as the script writes it. Not a correction: no word is marked `h`. A line heard as notably other words (a clip that
// added its own) stays as heard. { words: [{ text, start, end }], segments, script }
function _lineWords(L) {
  const a = (L.entry && L.entry.answer) || {};
  let ws = (Array.isArray(a.words) ? a.words : []).map((w) => ({ text: String(w.word != null ? w.word : (w.text || '')).trim(), start: +w.start || 0, end: +w.end || 0 }))
    .filter((w) => w.text).sort((x, y) => x.start - y.start);
  ws = _trimStarts(ws, L.slice);
  const segments = (Array.isArray(a.segments) ? a.segments : []).map((s) => ({ start: +s.start || 0, end: +s.end || 0,
    no_speech_prob: s.no_speech_prob, avg_logprob: s.avg_logprob, compression_ratio: s.compression_ratio }));
  const len = L.slice.length / 2 / SR;
  if (L.said && ws.length && CAP.WORDS.likeness(L.said, ws.map((w) => w.text).join(' ')) >= LINE_LIKE) {
    const r = CAP.WORDS.retext(ws.map((w) => ({ w: w.text, s: w.start, e: w.end })), L.said, len);
    if (r.words) return { words: r.words.map((w) => ({ text: w.w, start: w.s, end: w.e })), segments, script: true };
  }
  return { words: ws, segments, script: false };
}

// ── The lay: ONE tick, on the timeline as it is NOW ──────────────────────────
// HEARD lines (`words`) are replaced - by itself (a talking head's new lines) only those of the lines laid now; TYPED ones and
// heard ones a person CORRECTED (K10) stay exactly, the words under them left out. A talking head's page carries its line's
// voice and never runs past its line's end. @returns the counts, with `laid` false when nothing was laid.
function _lay(j, tl, x) {
  let lane = _subsLane(tl);
  const span = (c) => [+c.start || 0, (+c.start || 0) + (+c.dur || 0)];
  const clips = lane ? (lane.clips || []) : [];
  const typed = clips.filter((c) => c && !HEARD.isHeard(c));
  // A HEARD LINE A PERSON CORRECTED (K10) stays as a typed one does - the very object, the words under it
  // left out - unless this is "back to what was heard", which takes the corrections back (the owner's
  // answer 1, 2026-10-03).
  const fixed = !x.again ? clips.filter((c) => HEARD.isHeard(c) && CAP.WORDS.isCorrected(c)) : [];
  // Where each line lies NOW: the mirror may have laid the cut again while it was being heard. (phase V44) A line in pieces is
  // placed through them (lib/line-cuts.js placer): a word wholly cut out is not laid, one a cut only reaches into is shortened
  // to what is played (the hearing stretches a word over the pause after it - cut silence takes that pause, not the word);
  // a line spans its first piece to its last.
  const byVoice = new Map();
  for (const c of LCUTS.expand(_mirrorCells(tl))) {                // (phase V45) a merged cell's lines, each its own
    if (!c.voice) continue;
    if (!byVoice.has(String(c.voice))) byVoice.set(String(c.voice), []);
    byVoice.get(String(c.voice)).push(c);
  }
  const cellAt = new Map([...byVoice].map(([v, ps]) => {
    const pl = LCUTS.placer(ps);
    return [v, { start: pl.start, dur: pl.end - pl.start, pl }];
  }));
  const words = x.R ? x.R.words.slice() : [];
  const segments = x.R ? x.R.segments.slice() : [];
  const laid = new Set();
  for (const L of x.lines) {
    const cell = cellAt.get(L.voice);
    if (!cell) continue;                               // the line went while it was being heard
    laid.add(L.voice);
    const { pl } = cell;
    const here = (f, side) => { const v = pl.at(f, side); return v == null ? pl.at(f, side === 'next' ? 'prev' : 'next') : v; };
    for (const w of L.words) {
      if (!pl.covers(w.start, w.end)) continue;
      const s = here(w.start, 'next'), e = here(w.end, 'prev');
      if (s == null || e == null) continue;
      words.push({ text: w.text, start: s, end: Math.max(s, e), voice: L.voice });
    }
    for (const g of L.segments) {
      const s = here(g.start, 'next'), e = here(g.end, 'prev');
      if (s == null || e == null || !(e > s)) continue;
      segments.push({ ...g, start: s, end: e });
    }
  }
  words.sort((a, b) => a.start - b.start);
  const now = x.th ? HEARD.soundPieces(tl) : null;
  const clean = HEARD.cleanWords(words, segments, { gaps: x.th ? HEARD.silencesOf(now) : x.R.gaps, typed: typed.map(span), fixed: fixed.map(span) });
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
  const res = { lines: 0, words: clean.words.length, dropped: clean.dropped, kept: fixed.length, stale, laid: false, voices: 0,
    moved: x.restKey != null && _soundKey(x.th ? _restOf(now, _mirrorCells(tl)) : HEARD.soundPieces(tl)) !== x.restKey };
  // Heard nothing: the lane stays as it was (it used to be wiped).
  if (!clean.words.length) return res;
  if (!lane) {
    lane = { id: 'subs', kind: 'subs', name: 'Subtitles', linkId: null, main: true, volume: null, speed: null,
      style: CAP.normalizeStyle({}), listen: null, clips: [] };
    tl.tracks.push(lane);
  }
  // What goes: every heard line nobody corrected - by itself, only those of the lines laid now (their own pages, or a page
  // of no line lying on one of them: what an earlier Generate laid there).
  const onLaid = (c) => {
    if (c.voice) return laid.has(String(c.voice));
    const m = (+c.start || 0) + (+c.dur || 0) / 2;
    for (const v of laid) { const cell = cellAt.get(v); if (m >= +cell.start && m < +cell.start + (+cell.dur || 0)) return true; }
    return false;
  };
  const replaced = (lane.clips || []).filter((c) => HEARD.isHeard(c) && !fixed.includes(c) && (!x.auto || onLaid(c)));
  const keep = (lane.clips || []).filter((c) => !replaced.includes(c));
  // A heard line wearing a look of its own hands it to the pages cut from its words - by where each word
  // falls (the owner 2026-10-03: a fragment's own style survives a re-cut).
  const looks = replaced.map((c) => [...span(c), CAP.PAGES.lookOf(c)]).filter((y) => y[2]);
  // A word made to stand out (`k`) is a look of the word: it goes to the new word at its moment (K10).
  const marked = [];
  for (const c of replaced) {
    for (const w of CAP.PAGES.timedWords(c)) if (w.k) marked.push([(+c.start || 0) + (+w.s || 0), (+c.start || 0) + (+w.e || 0)]);
  }
  const dressed = clean.words.map((w) => {
    const mid = (w.start + w.end) / 2;
    const o = looks.find(([a, b]) => mid >= a && mid < b);
    const k = marked.some(([a, b]) => (mid >= a && mid < b) || ((a + b) / 2 >= w.start && (a + b) / 2 < w.end));
    let y = o ? { ...w, look: o[2] } : w;
    if (k) y = { ...y, k: true };
    return y;
  });
  const pages = CAP.PAGES.paginate(dressed, { lane: lane.style, format: tl.format, joins: x.th ? CAP.PAGES.joinsOf(now) : x.R.joins,
    typed: typed.map(span).concat(fixed.map(span)),
    // By itself the other lines' pages stay: walls the new pages do not run into.
    walls: x.auto ? keep.filter((c) => HEARD.isHeard(c) && !fixed.includes(c)).map(span) : [] });
  const stamp = Date.now().toString(36);
  const made = pages.map((p, i) => {
    let dur = Math.max(0.1, p.dur);
    // A line's page ends with its line: the next line's pages begin there, and they move apart when the cut is laid again.
    const cell = p.voice ? cellAt.get(p.voice) : null;
    if (cell) { const end = (+cell.start || 0) + (+cell.dur || 0); if (p.start < end && p.start + dur > end) dur = Math.max(0.1, _round(end - p.start, 2)); }
    const c = {
      id: 'h' + stamp + i.toString(36) + Math.random().toString(36).slice(2, 5), src: null, thumb: null,
      name: p.name, start: p.start, dur, words: p.words,
      srcDur: 0, trimIn: 0, trimOut: 0, speed: 1, reversed: false,
      transition: null, animation: null, filter: null, volume: null, pairId: null,
    };
    if (p.style) c.style = p.style;
    if (p.tx != null) c.tx = p.tx;
    if (p.ty != null) c.ty = p.ty;
    if (p.voice) c.voice = p.voice;
    return c;
  });
  // Stored in exactly the shape a page's save stores (lib/timeline-shape.js).
  const shaped = SHAPE.sanitizeBlank({ format: tl.format, tracks: [{ id: lane.id, kind: 'subs', clips: made }] }).tracks[0].clips;
  lane.clips = keep.concat(shaped).sort((a, b) => (+a.start || 0) - (+b.start || 0));
  res.lines = shaped.length;
  res.voices = new Set(shaped.filter((c) => c.voice).map((c) => c.voice)).size;
  res.laid = true;
  return res;
}

async function _run(j, t, pieces, opts) {
  const listen = HEARD.listenOf(_subsLane(t)) || {};
  const chosenLocal = listen.engine === 'local';
  // LAYING AGAIN WHAT WAS HEARD (K2, "back to what was heard"): every piece from its stored answer, or the
  // job stops before anybody is asked - nothing is paid for by construction.
  const again = !!j.stored;
  // The language is detected, never told (phase V29: the lane's menu went) - null, as every lane had it. By itself (phase V30)
  // the model is never downloaded: a run that needs it stops and says so.
  const st = { lang: null, chosenLocal, local: chosenLocal, again, mayDownload: !j.auto && (chosenLocal || !!(opts && opts.download)) };
  // No Groq key: this computer hears it (the route let it through; the owner's (с22) - the key decides).
  if (!again && !st.local && !GROQ.keyOf()) { j.fell = 'no-key'; st.local = true; }
  j.engine = st.local ? 'local' : 'cloud';

  // A TALKING HEAD (phase V30, block 1): its lines one by one; the rest of its sound - what the person laid there - the old way.
  const th = await _thOf(j);
  if (!_ours(j)) return;
  if (th) pieces = HEARD.soundPieces(th.t);
  // By itself, only the lines no page speaks for yet (the owner's (с21): a line whose pages all went is heard again).
  const lines = th ? (j.auto ? th.lines.filter((L) => !th.bound.has(L.voice)) : th.lines) : [];
  const rest = th ? (j.auto ? [] : _restOf(pieces, th.cells)) : pieces;
  const runAt = new Date().toISOString();

  let R = null;
  let restLost = null;
  if (rest.length) {
    try {
      R = await _hearSound(j, rest, st, runAt);
    } catch (e) {
      // A talking head's own sound that cannot be laid again (or found) does not stop its lines.
      if (!th || !['lost', 'changed', 'no-sound'].includes(e.code)) throw e;
      restLost = e.code;
    }
    if (!_ours(j)) return;
  }
  if (th && !R) {
    // The run's record - what was laid, and when - for a talking head heard by its lines alone.
    SUBS.putRun(j.key, { at: runAt, audio: 'lines', seconds: 0, model: GROQ.MODEL, local: LOCAL.MODEL_ID, language: st.lang,
      chunks: [], paid: 0, reused: 0, laid: null });
  }
  if (th) {
    if (lines.length && !(await _hearLines(j, lines, st))) return;
    if (!_ours(j)) return;
  }
  const heardLines = lines.filter((L) => L.entry).map((L) => ({ voice: L.voice, name: L.name, ...(_lineWords(L)) }));
  const missingLines = lines.filter((L) => L.missing).map((L) => L.name.slice(0, 60));

  // Laid in ONE tick, on the timeline as it is NOW.
  j.step = again ? 'laying again what was heard' : 'laying the lines';
  j.part = null;
  j.pct = null;
  let res = null;
  const stored = MSTORE.update(j.key, (tl) => {
    if (!_ours(j) || !Array.isArray(tl.tracks)) return false;
    if (j.auto && !_subsLane(tl)) return false;      // the lane was taken away meanwhile: nothing is laid by itself
    res = _lay(j, tl, { R, lines: heardLines, th: !!th, again, auto: !!j.auto,
      restKey: rest.length ? _soundKey(rest) : null });
    return res.laid;
  });
  if (!_ours(j)) return;
  if (stored === null) throw new JobError('gone', GONE);

  const laid = !!(res && res.laid);
  const n = j.counts;
  const here = n.local + n.reusedLocal > 0, there = n.paid + n.reused > 0;
  const engine = here && there ? 'mixed' : (here ? 'local' : 'cloud');
  // `used`: which answer each piece was laid from - what "back to what was heard" lays again (review K2).
  SUBS.setLaid(j.key, runAt, laid ? { at: new Date().toISOString(), rev: stored.rev, lines: res.lines, words: res.words, engine,
    fell: j.fell || null, used: R ? R.chunks.map((c) => c.used || null) : [] } : null);
  const quote = (s) => '"' + String(s).slice(0, 40) + (String(s).length > 40 ? '...' : '') + '"';
  j.result = { lines: laid ? res.lines : 0, words: res ? res.words : 0, rev: laid ? stored.rev : null,
    paid: n.paid, reused: n.reused, local: n.local, reusedLocal: n.reusedLocal, took: _round(j.took, 1), engine, fell: j.fell || null,
    timing: j.approx ? 'approximate' : 'dtw', seconds: R ? R.seconds : _round(lines.reduce((s, L) => s + L.dur, 0), 2),
    language: (R && R.spoken) || ((lines.find((L) => L.entry && L.entry.answer && L.entry.answer.language) || {}).entry || { answer: {} }).answer.language || null,
    asked: R && R.prior ? R.prior.language : st.lang,
    dropped: res ? res.dropped : { noise: 0, silence: 0, typed: 0, fixed: 0 }, kept: res ? res.kept : 0, stale: res ? res.stale : 0,
    missing: (R ? R.missing : []).concat(missingLines), moved: !!(res && res.moved),
    suspect: !!(R && R.suspect) || lines.some((L) => L.entry && L.entry.suspect && (+L.entry.asked || 1) < 2),
    partial: !!(R && R.partial), stored: again,
    // (phase V30, block 1) a talking head: how many of its lines were laid, which kept the words they were heard as, which
    // were never heard ("back to what was heard" asks nobody), and the person's own sound that could not be laid again.
    th: !!th, auto: !!j.auto, heardLines: laid ? res.voices : 0,
    offScript: heardLines.filter((L) => !L.script && L.words.length).map((L) => quote(L.name)),
    unheard: again ? lines.filter((L) => !L.entry && !L.missing && !L.silent).map((L) => quote(L.name)) : [],
    restLost };
  j.state = 'done';
  j.endedAt = Date.now();
  console.log('[captions] ' + j.key + ': ' + (j.auto ? 'by itself, ' : '') + (again ? 'laid again, ' : '') + j.result.lines + ' pages from '
    + j.result.words + ' words' + (th ? ' (' + j.result.heardLines + ' of ' + lines.length + ' lines)' : '') + ', '
    + j.result.seconds + ' s of sound, ' + n.paid + ' asked, ' + n.reused + ' reused, ' + n.local + ' heard here (' + j.result.took + ' s)'
    + (j.fell ? ', fell: ' + j.fell : '') + (laid ? ', rev ' + stored.rev : ''));
}

/** Start listening to a project. The caller has checked everything (routes/mv3-captions.js). */
function start(key, t, pieces, opts) {
  _sweep();
  const j = { id: 'cap_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), key: String(key),
    stored: !!(opts && opts.stored), auto: !!(opts && opts.auto),
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

// ── BY ITSELF (phase V30, block 1; lib/captions-auto.js) ────────────────────
// Who would hear a run of this lane now - or why nobody can: { code, error } or null. The key decides (the owner's (с22)):
// Groq when there is one, this computer when not, or always this computer when the lane chose it. The model is never
// downloaded by itself (574 MB): it is offered when the program first starts, and the lane offers it.
function cannotHear(lane) {
  const MB = Math.round(LOCAL.MODEL_BYTES / 1e6) + ' MB';
  const here = (HEARD.listenOf(lane) || {}).engine === 'local';
  if (!here && GROQ.keyOf()) return null;
  const why = here ? 'This lane listens on this computer' : 'No Groq key';
  if (!LOCAL.hasProgram()) return { code: 'no-build', error: why + ', and recognition on this computer is not installed.' };
  if (!LOCAL.hasModel()) return { code: 'need-model', error: why + ', and the speech model for this computer is not downloaded yet (' + MB + ').' };
  return null;
}

// The sound cells of a talking head no page of the subtitle lane speaks for yet (bound by `voice`).
function _unheard(t) {
  const lane = _subsLane(t);
  const bound = new Set(((lane || {}).clips || []).filter((c) => c && c.voice).map((c) => String(c.voice)));
  const a1 = (((t && t.tracks) || []).find((x) => x && x.id === 'a1') || {});
  const master = a1.volume == null ? 1 : +a1.volume;
  // (phase V44) One a line: a line cut into pieces counts once; (phase V45) a merged cell's lines each count.
  const seen = new Set();
  return LCUTS.expand(_mirrorCells(t)).filter((c) => c.voice && !bound.has(String(c.voice)) && master > 0
    && (c.volume == null ? 1 : +c.volume) > 0 && !c.reversed && !seen.has(String(c.voice)) && seen.add(String(c.voice)));
}

/**
 * A talking head's lines have a new sound: hear the ones no page speaks for, now. Nothing without a subtitle lane, or with
 * nothing to hear; a run nobody can hear is recorded as failed, in words, for the lane to say (and to offer the model).
 * @returns 'started' | 'blocked' | 'busy' | 'nothing' | 'no-lane' | a precheck code
 */
function auto(key, t) {
  key = String(key);
  const lane = _subsLane(t);
  if (!lane) return 'no-lane';
  if (busy(key)) return 'busy';
  if (!_unheard(t).length) return 'nothing';
  const ok = precheck(t);
  if (ok.code) return ok.code;
  const no = cannotHear(lane);
  if (no) {
    const now = Date.now();
    JOBS.set(key, { id: 'cap_' + now.toString(36), key, stored: false, auto: true, state: 'failed', step: null, part: null,
      startedAt: now, alive: now, endedAt: now, error: no.error, code: no.code, result: null, procs: new Set(), engine: null,
      where: null, pct: null, dl: null, wait: null, fell: null, took: 0, approx: false, counts: { paid: 0, reused: 0, local: 0, reusedLocal: 0 } });
    console.log('[captions] ' + key + ': new lines not heard by themselves - ' + no.error);
    return 'blocked';
  }
  start(key, t, ok.pieces, { auto: true });
  return 'started';
}

/**
 * What the subtitle lane of a talking head says about its lines (GET /api/mv3/captions/state): how many sound cells no
 * caption lies over at all, and why nobody could hear them by itself. Null for any other timeline.
 */
function linesState(key, t) {
  if (!/^sv3_/.test(String(key)) || !t) return null;
  const cells = LCUTS.expand(_mirrorCells(t));
  if (!cells.length) return null;
  const lane = _subsLane(t);
  const pages = ((lane || {}).clips || []).filter((c) => c && c.name);
  // (phase V44) Counted by line: a line in pieces is one, and it is bare when no piece of it has a caption over it.
  const lines = new Map();
  for (const c of cells) { const k = String(c.voice || c.id); if (!lines.has(k)) lines.set(k, []); lines.get(k).push(c); }
  const over = (c) => pages.some((p) => (+p.start || 0) < (+c.start || 0) + (+c.dur || 0) && (+p.start || 0) + (+p.dur || 0) > (+c.start || 0));
  const bare = [...lines.values()].filter((ps) => !ps.some(over));
  const no = lane ? cannotHear(lane) : null;
  return { cells: lines.size, bare: bare.length, unheard: _unheard(t).length, lane: !!lane, missing: no ? no.code : null, why: no ? no.error : null };
}

// ── A LONG VIDEO, HEARD WHOLE (phase V33.1, highlights) ─────────────────────
// The words of a source an hour long, every one with its time: Groq when there is a key, this computer when not (the
// owner's (х2), the rule of the captions). Not the timeline's sound but the FILE's, read window by window - ten minutes of
// it decoded at a time, cut at the quietest moment of its last two minutes - so an hour and a half never sits in memory
// (115 MB an hour). Each piece is kept the moment it is heard, under the signature of its samples, in the subs file of
// `key` (the highlights project's own timeline, lib/subs-store.js): the app closed midway and pressed again pays only for
// what was not heard yet. It runs as a job of this module under `key` - one at a time, given up after LIMIT_MS without a
// sign of life, let go of by `o.signal`.
const LONG_TAIL = 120;               // the quietest moment is looked for in the last this many seconds of a window
const _sigLong = (slice) => _sig(slice, null);
const _sigLongLocal = (slice) => _sigLocal(slice, null);

// One window of the file, 16 kHz mono, as it is: `from` and `len` in seconds. (phase V43, (ё18)) `j.audio` - which of the file's
// sound tracks (0 the first); none said - ffmpeg's own pick, as before.
async function _decodeWindow(j, abs, from, len) {
  const track = Number.isInteger(j.audio) && j.audio >= 0 ? ['-map', '0:a:' + j.audio] : [];
  const args = ['-hide_banner', '-nostdin', '-v', 'error', '-ss', from.toFixed(3), '-t', len.toFixed(3), '-i', abs,
    ...track, '-vn', '-ac', '1', '-ar', String(SR), '-f', 's16le', 'pipe:1'];
  const r = await _ffmpeg(j, args, null, abs);
  if (r.code !== 0) throw new JobError('no-sound', 'The sound of the video could not be read: ' + (r.err.trim().split('\n').pop() || 'ffmpeg failed'));
  return r.buf.subarray(0, r.buf.length - (r.buf.length % 2));
}

/**
 * Hear a whole file.
 * @param key   the timeline whose subs file keeps the answers (it must exist: lib/subs-store.js finds its folder by it)
 * @param abs   the file on disk
 * @param o     { seconds, signal, onProgress({ heard, total, part, parts, where, pct, wait, step }), audio (phase V43: the sound
 *              track, 0 the first - each track's pieces are told apart by their own samples) }
 * @returns { words: [{ text, start, end }], segments, seconds, engine, model, language, fell, paid, reused, local, reusedLocal,
 *            paidSeconds, took }
 * Throws a JobError: 'busy' (heard already), 'no-build' / 'need-model' (nobody can hear it here), 'stopped', 'no-sound',
 * or Groq's own codes when this computer cannot take over.
 */
async function hearLong(key, abs, o) {
  o = o || {};
  _sweep();
  key = String(key);
  if (busy(key)) throw new JobError('busy', 'This video is being heard already.');
  const no = cannotHear(null);
  if (no) throw new JobError(no.code, no.error);
  const j = { id: 'cap_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), key, stored: false, auto: false,
    state: 'listening', step: 'starting', part: null, startedAt: Date.now(), alive: Date.now(), endedAt: null,
    error: null, code: null, result: null, procs: new Set(), engine: 'cloud', where: null, pct: null, dl: null, wait: null,
    fell: null, took: 0, approx: false, counts: { paid: 0, reused: 0, local: 0, reusedLocal: 0 }, long: true,
    audio: Number.isInteger(o.audio) && o.audio >= 0 ? o.audio : null };
  JOBS.set(key, j);
  const stopNow = () => _fail(j, 'stopped', 'Stopped.');
  if (o.signal) { if (o.signal.aborted) stopNow(); else o.signal.addEventListener('abort', stopNow, { once: true }); }
  const st = { lang: null, chosenLocal: false, local: !GROQ.keyOf(), again: false, mayDownload: false };
  if (st.local) j.fell = 'no-key';
  j.engine = st.local ? 'local' : 'cloud';
  const total = Math.max(0, +o.seconds || 0);
  if (!(total > 0)) {
    _fail(j, 'no-sound', 'The length of the video is not known.');
    throw new JobError('no-sound', 'The length of the video is not known.');
  }
  const parts = Math.max(1, Math.ceil(total / (ONE_GO - LONG_TAIL / 2)));
  let paidSeconds = 0;
  let at = 0;                          // seconds of the file heard so far
  const say = () => {
    if (!o.onProgress) return;
    try { o.onProgress({ heard: at, total, part: j.part ? j.part.i : 1, parts: j.part ? j.part.n : parts, where: j.where, pct: j.pct, wait: j.wait, step: j.step }); }
    catch (e) { /* a listener's own trouble */ }
  };
  const tick = setInterval(say, 1000);
  try {
    const words = [];
    const segments = [];
    let language = null;
    let n = 0;
    while (at < total - 0.05) {
      if (!_ours(j)) throw new JobError(j.code || 'stopped', j.error || 'Stopped.');
      _here(j);
      n++;
      j.part = { i: n, n: Math.max(n, parts) };
      j.pct = null;
      j.wait = null;
      j.step = 'reading the sound';
      _beat(j);
      const left = total - at;
      const len = left <= ONE_GO ? left + 1 : ONE_GO;
      const pcm = await _decodeWindow(j, abs, at, len);
      if (!_ours(j)) throw new JobError(j.code || 'stopped', j.error || 'Stopped.');
      const got = pcm.length / 2;
      if (!got) break;
      // Cut at the quietest moment of the window's tail - unless the rest of the file is in it.
      let to = got;
      if (left > ONE_GO) to = _quietest(pcm, Math.max(30 * SR, got - LONG_TAIL * SR), got - FRAME);
      const slice = pcm.subarray(0, to * 2);
      const secs = to / SR;
      if (_peak(slice) >= 100) {
        const c = { slice, from: 0, to, sig: _sigLong(slice), sigL: _sigLongLocal(slice) };
        let h = await _hearChunk(j, c, st);
        if (!h) throw new JobError(j.code || 'stopped', j.error || 'Stopped.');
        // Groq answered for only a part of it (_suspect): asked once more now - the second answer stands, as it does for the
        // captions' next press.
        if (h.used === 'sig' && h.entry.suspect && (+h.entry.asked || 1) < 2 && !st.local) {
          const again = await _hearChunk(j, c, st);
          if (!again) throw new JobError(j.code || 'stopped', j.error || 'Stopped.');
          h = again;
        }
        const a = h.entry.answer || {};
        if (!language && a.language) language = a.language;
        let ws = (Array.isArray(a.words) ? a.words : []).map((w) => ({ text: String(w.word != null ? w.word : (w.text || '')).trim(), start: +w.start || 0, end: +w.end || 0 }))
          .filter((w) => w.text).sort((x, y) => x.start - y.start);
        ws = _trimStarts(ws, slice);
        for (const w of ws) words.push({ text: w.text, start: _round(at + w.start, 3), end: _round(at + Math.min(secs, w.end), 3) });
        for (const g of (Array.isArray(a.segments) ? a.segments : [])) {
          segments.push({ start: _round(at + (+g.start || 0), 3), end: _round(at + (+g.end || 0), 3), text: g.text,
            no_speech_prob: g.no_speech_prob, avg_logprob: g.avg_logprob, compression_ratio: g.compression_ratio });
        }
        if (h.used === 'sig' && h.entry.engine !== 'local' && h.entry.at && Date.parse(h.entry.at) >= j.startedAt) paidSeconds += secs;
      }
      at += secs;
      say();
      if (got < len * SR - SR && left > ONE_GO) break;            // the file ended before it said it would
    }
    const c = j.counts;
    const here = c.local + c.reusedLocal > 0, there = c.paid + c.reused > 0;
    j.state = 'done';
    j.endedAt = Date.now();
    j.result = { words: words.length, seconds: _round(at, 2) };
    console.log('[captions] ' + key + ': a long video heard, ' + words.length + ' words in ' + _round(at, 1) + ' s - ' + c.paid + ' asked, '
      + c.reused + ' reused, ' + c.local + ' heard here' + (j.fell ? ', fell: ' + j.fell : ''));
    return { words: words.sort((x, y) => x.start - y.start), segments, seconds: _round(at, 2),
      engine: here && there ? 'mixed' : (here ? 'local' : 'cloud'), model: here && !there ? LOCAL.MODEL_ID : GROQ.MODEL, language,
      fell: j.fell || null, paid: c.paid, reused: c.reused, local: c.local, reusedLocal: c.reusedLocal,
      paidSeconds: _round(paidSeconds, 1), took: _round(j.took, 1) };
  } catch (e) {
    _fail(j, e.code || 'failed', e.message);
    if (e instanceof JobError) throw e;
    throw new JobError(e.code || 'failed', e.message);
  } finally {
    clearInterval(tick);
    if (o.signal) o.signal.removeEventListener('abort', stopNow);
  }
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

module.exports = { get, last, start, busy, precheck, view, cut, auto, linesState, cannotHear, hearLong, JobError, MAX_SECONDS, SR, FELL, LINE_LIKE,
  _jobs: JOBS, _uncovered, _trimStarts };
