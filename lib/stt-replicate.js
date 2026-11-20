'use strict';

// ════════════════════════════════════════════════════════════════════════════
// TRANSCRIPTION THROUGH REPLICATE — one file in, timed cues out.
//
// Whisper large-v3, "incredibly fast" (vaibhavs10/incredibly-fast-whisper): a two-and-a-half hour
// podcast in two minutes, in every language a source here is likely to be in, detected by itself.
//
// FOR SOURCES AND NARRATOR SAMPLES ONLY. Not lib/captions-job.js: that one serves Merge, word-
// times a timeline's own audio through Groq (lib/groq-stt.js), and its constants are not these.
//
// THE FILE GOES UP WHOLE. The audio is re-encoded small (mono, 16 kHz - what Whisper hears anyway),
// uploaded to Replicate's own file store, handed to the model by that address, and deleted again.
// Whisper cuts it into thirty-second windows itself and answers with each window's words and times,
// which become the cues - coarser than word timings, and exactly what topic mining reads (it groups
// cues into blocks of a quarter of a minute) and all a narrator sample needs (the words).
//
// It answers { cues, text, seconds, cost, model, sourceSeconds } - the shape its callers
// (lib/source-intake.js, routes/narrators.js) read.
// ════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const I18N = require('./i18n');

const SETTINGS_FILE = path.join(require('./config').DATA_DIR, 'settings.json');

const MODEL = 'vaibhavs10/incredibly-fast-whisper';
const API = 'https://api.replicate.com/v1';
// A community model: it is run by its VERSION, read once from the model and kept for the session.
let _version = '';

const FILE_LIMIT_MB = 95;                  // Replicate's file store takes up to 100 MB
const BITRATES = [32, 48, 64];             // kbps, mono 16 kHz
const DEADLINE_MS = 1800000;               // half an hour: a cold start plus a very long file
const POLL_MS = 3000;

const DURATION_RE = /Duration:\s*(\d+):(\d\d):(\d\d(?:\.\d+)?)/;

function _key() {
  try { return String(JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')).replicateApiKey || '').trim(); }
  catch (e) { return ''; }
}

// `signal`: a source being added can be stopped while its sound is re-encoded - ffmpeg is killed.
function _run(args, timeout = 1800000, signal = null) {
  return new Promise((resolve) => {
    let err = '';
    let done = false;
    const p = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    const kill = () => { if (!done) { try { p.kill('SIGKILL'); } catch (e) {} } };
    const timer = setTimeout(kill, timeout);
    if (signal) signal.addEventListener('abort', kill, { once: true });
    const end = () => { done = true; clearTimeout(timer); if (signal) signal.removeEventListener('abort', kill); };
    if (p.stderr) p.stderr.on('data', d => { err = (err + d).slice(-4000); });
    p.on('error', e => { end(); resolve({ code: -1, err: e.message }); });
    p.on('close', code => { end(); resolve({ code, err }); });
  });
}

// A STOP: the error says `cancelled`, so a caller tells it from a failure.
const _cancelled = () => Object.assign(new Error('cancelled'), { cancelled: true });
const _check = (signal) => { if (signal && signal.aborted) throw _cancelled(); };

// The bundled ffmpeg-static ships no ffprobe, so the length comes off the `Duration:` line ffmpeg
// prints when handed an input and no output (it exits non-zero on purpose in that mode).
async function probeDuration(file) {
  if (!ffmpegPath) throw new Error(I18N.t('ffmpeg is not available.'));
  const r = await _run(['-hide_banner', '-i', file], 300000);
  const m = DURATION_RE.exec(r.err || '');
  if (!m) throw new Error(I18N.t('Could not read "{name}" — is it a video or audio file?', { name: path.basename(file) }));
  return (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]);
}

// The best rate that still fits the file store: 64 kbps up to about three hours, less beyond.
function pickBitrate(seconds) {
  if (!(seconds > 0)) return BITRATES[BITRATES.length - 1];
  const fits = BITRATES.filter(k => (k * 1000 / 8) * seconds / 1e6 <= FILE_LIMIT_MB);
  return fits.length ? fits[fits.length - 1] : BITRATES[0];
}

async function _encode(input, out, seconds, onProgress, signal) {
  const kbps = pickBitrate(seconds);
  if (onProgress) onProgress(I18N.t('Re-encoding audio at {kbps} kbps', { kbps }));
  const r = await _run(['-y', '-hide_banner', '-loglevel', 'error', '-i', input, '-vn',
    '-ac', '1', '-ar', '16000', '-b:a', `${kbps}k`, out], 1800000, signal);
  _check(signal);
  if (r.code !== 0 || !fs.existsSync(out)) throw new Error(I18N.t('Could not re-encode the audio:\n{why}', { why: String(r.err).slice(-400) }));
  const mb = fs.statSync(out).size / 1e6;
  if (mb > 100) throw new Error(I18N.t('Even at {kbps} kbps this audio is {mb} MB - too long to transcribe in one piece.', { kbps, mb: Math.round(mb) }));
  return { kbps, mb };
}

async function _api(method, url, key, body, headers, signal) {
  const r = await fetch(url, { method, headers: { Authorization: 'Bearer ' + key, ...(headers || {}) }, body, signal: signal || undefined });
  let d = null;
  try { d = await r.json(); } catch (e) { /* a body that is not JSON is said below */ }
  if (!r.ok) {
    const why = (d && (d.detail || d.title || d.error)) || r.statusText;
    throw new Error(`Replicate ${r.status}: ${String(why).slice(0, 300)}`);
  }
  return d || {};
}

async function _versionOf(key) {
  if (_version) return _version;
  const d = await _api('GET', `${API}/models/${MODEL}`, key);
  _version = (d.latest_version && d.latest_version.id) || '';
  if (!_version) throw new Error(I18N.t('Replicate did not say which version of {model} to run.', { model: MODEL }));
  return _version;
}

async function _upload(file, key, signal) {
  const fd = new FormData();
  fd.append('content', new Blob([fs.readFileSync(file)], { type: 'audio/mpeg' }), path.basename(file));
  const d = await _api('POST', `${API}/files`, key, fd, null, signal);
  if (!d.id || !d.urls || !d.urls.get) throw new Error(I18N.t('Replicate did not keep the audio file.'));
  return d;
}

// Whisper's windows -> cues. The last window can come back without an end; the audio's own length
// closes it. Empty windows (music, silence) are dropped.
function cuesFromChunks(chunks, seconds) {
  return (Array.isArray(chunks) ? chunks : [])
    .map((c, i, all) => {
      const ts = Array.isArray(c.timestamp) ? c.timestamp : [];
      const start = +ts[0] || 0;
      let end = ts[1] != null ? +ts[1] : NaN;
      if (!Number.isFinite(end)) end = all[i + 1] && Array.isArray(all[i + 1].timestamp) ? +all[i + 1].timestamp[0] : +seconds || start;
      return { start: Math.round(start * 100) / 100, end: Math.round(end * 100) / 100, text: String(c.text || '').trim() };
    })
    .filter(c => c.text);
}

// `signal` (a source being added is stopped): the upload and the asking are dropped, and a prediction
// already running is cancelled by its id - what it ran until then is paid for. One stopped during the asking itself
// (up to a minute's wait) may run on at Replicate without anybody reading it.
async function transcribeAudio(audioPath, { seconds = 0, onProgress, signal = null } = {}) {
  const key = _key();
  if (!key) throw new Error(I18N.t('No Replicate API key - add it on Admin → API keys.'));
  _check(signal);
  const bytes = fs.statSync(audioPath).size;
  if (onProgress) {
    onProgress(bytes < 1e6 ? I18N.t('Uploading {n} KB of audio', { n: Math.round(bytes / 1e3) })
      : I18N.t('Uploading {n} MB of audio', { n: (bytes / 1e6).toFixed(1) }));
  }
  const version = await _versionOf(key);
  const file = await _upload(audioPath, key, signal).catch((e) => { _check(signal); throw e; });
  let p = null;
  const running = () => p && p.id && (p.status === 'starting' || p.status === 'processing');
  try {
    _check(signal);
    if (onProgress) onProgress(I18N.t('Transcribing (Whisper large-v3)'));
    p = await _api('POST', `${API}/predictions`, key,
      JSON.stringify({ version, input: { audio: file.urls.get, task: 'transcribe', language: 'None', timestamp: 'chunk', batch_size: 24 } }),
      { 'Content-Type': 'application/json', Prefer: 'wait=60' }, signal).catch((e) => { _check(signal); throw e; });
    const deadline = Date.now() + DEADLINE_MS;
    let lost = 0;
    while (running() && Date.now() < deadline) {
      _check(signal);
      if (onProgress) onProgress(p.status === 'starting' ? I18N.t('Waiting for Whisper to start') : I18N.t('Transcribing (Whisper large-v3)'));
      await new Promise(x => setTimeout(x, POLL_MS));
      _check(signal);
      // ONE LOST POLL IS NOT A FAILED TRANSCRIPTION (a 502, a 429, a dropped connection): the paid
      // run goes on, so the waiting does too - until several in a row say Replicate is not answering.
      try { p = await _api('GET', `${API}/predictions/${p.id}`, key); lost = 0; }
      catch (e) { if (++lost >= 10) throw new Error(I18N.t('Lost touch with Replicate while it transcribed: {why}', { why: e.message })); }
    }
    if (running()) throw new Error(I18N.t('Transcription took longer than half an hour and was cancelled.'));
    if (p.status !== 'succeeded') throw new Error(I18N.t('Transcription {status}: {why}', { status: p.status, why: String(p.error || '').slice(0, 300) }));
  } catch (e) {
    // Whatever we stop waiting for is cancelled - left running, it would go on being billed for an
    // answer nobody will read.
    if (running()) { try { await _api('POST', `${API}/predictions/${p.id}/cancel`, key); } catch (x) { /* it ends by itself */ } }
    throw e;
  } finally {
    // The upload is only a hand-over: gone once the model has read it (it would expire in a day).
    try { await _api('DELETE', `${API}/files/${file.id}`, key); } catch (e) { /* expires by itself */ }
  }

  const out = p.output || {};
  const flat = String(out.text || '').trim();
  let cues = cuesFromChunks(out.chunks, seconds);
  // NO SPEECH IS NOT A BROKEN RESPONSE: music or silence comes back empty, and is still billed.
  if (!cues.length && !flat) {
    throw Object.assign(new Error(I18N.t('No speech was recognised in this audio ({secs}s). Music, room noise or silence transcribe to nothing.', { secs: Math.round(seconds) })),
      { noSpeech: true });
  }
  // Text with no timings at all: usable as a narrator sample, useless for topic spans - one cue.
  if (!cues.length) cues = [{ start: 0, end: Math.round(seconds * 100) / 100, text: flat }];
  return {
    cues,
    granularity: 'chunk',
    text: cues.map(c => c.text).join(' '),
    seconds: +((p.metrics && p.metrics.predict_time) || 0),
    cost: 0,                               // Replicate bills GPU time; it is not in the answer
    model: MODEL,
  };
}

// The whole chain for a file on disk: its length, a small mp3 of its sound, the transcription. The
// temporary file goes even when the call throws.
async function transcribeFile(file, { onProgress, signal = null } = {}) {
  if (!fs.existsSync(file)) throw new Error(I18N.t('No such file: {file}', { file }));
  const seconds = await probeDuration(file);
  _check(signal);
  const tmp = path.join(os.tmpdir(), `ugc-stt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp3`);
  try {
    const enc = await _encode(file, tmp, seconds, onProgress, signal);
    const out = await transcribeAudio(tmp, { seconds, onProgress, signal });
    return { ...out, sourceSeconds: seconds, kbps: enc.kbps, uploadedMb: enc.mb };
  } finally {
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch (e) {}
  }
}

module.exports = { MODEL, probeDuration, pickBitrate, cuesFromChunks, transcribeAudio, transcribeFile };
