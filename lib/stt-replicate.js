'use strict';

// ════════════════════════════════════════════════════════════════════════════
// TRANSCRIPTION THROUGH REPLICATE — one file in, timed cues out (phase F3b, the owner 2026-09-30).
//
// Whisper large-v3, "incredibly fast" (vaibhavs10/incredibly-fast-whisper): a two-and-a-half hour
// podcast in two minutes, in every language a source here is likely to be in, detected by itself.
// It replaced OpenRouter's grok-stt, whose key the owner's library no longer has working.
//
// FOR SOURCES AND NARRATOR SAMPLES ONLY. Not routes/stt-timeline.js: that one serves Merge, word-
// times a timeline's own audio through Groq, and its constants are not these.
//
// THE FILE GOES UP WHOLE. The audio is re-encoded small (mono, 16 kHz - what Whisper hears anyway),
// uploaded to Replicate's own file store, handed to the model by that address, and deleted again.
// Whisper cuts it into thirty-second windows itself and answers with each window's words and times,
// which become the cues - coarser than word timings, and exactly what topic mining reads (it groups
// cues into blocks of a quarter of a minute) and all a narrator sample needs (the words).
//
// The same shape comes back as from the module this replaced - { cues, text, seconds, cost, model,
// sourceSeconds } - so routes/sources.js and routes/narrators.js did not change.
// ════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');

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

function _run(args, timeout = 1800000) {
  return new Promise((resolve) => {
    let err = '';
    let done = false;
    const p = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    const timer = setTimeout(() => { if (!done) { try { p.kill('SIGKILL'); } catch (e) {} } }, timeout);
    if (p.stderr) p.stderr.on('data', d => { err = (err + d).slice(-4000); });
    p.on('error', e => { done = true; clearTimeout(timer); resolve({ code: -1, err: e.message }); });
    p.on('close', code => { done = true; clearTimeout(timer); resolve({ code, err }); });
  });
}

// The bundled ffmpeg-static ships no ffprobe, so the length comes off the `Duration:` line ffmpeg
// prints when handed an input and no output (it exits non-zero on purpose in that mode).
async function probeDuration(file) {
  if (!ffmpegPath) throw new Error('ffmpeg is not available.');
  const r = await _run(['-hide_banner', '-i', file], 300000);
  const m = DURATION_RE.exec(r.err || '');
  if (!m) throw new Error(`Could not read "${path.basename(file)}" — is it a video or audio file?`);
  return (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]);
}

// The best rate that still fits the file store: 64 kbps up to about three hours, less beyond.
function pickBitrate(seconds) {
  if (!(seconds > 0)) return BITRATES[BITRATES.length - 1];
  const fits = BITRATES.filter(k => (k * 1000 / 8) * seconds / 1e6 <= FILE_LIMIT_MB);
  return fits.length ? fits[fits.length - 1] : BITRATES[0];
}

async function _encode(input, out, seconds, onProgress) {
  const kbps = pickBitrate(seconds);
  if (onProgress) onProgress(`Re-encoding audio at ${kbps} kbps`);
  const r = await _run(['-y', '-hide_banner', '-loglevel', 'error', '-i', input, '-vn',
    '-ac', '1', '-ar', '16000', '-b:a', `${kbps}k`, out]);
  if (r.code !== 0 || !fs.existsSync(out)) throw new Error('Could not re-encode the audio:\n' + String(r.err).slice(-400));
  const mb = fs.statSync(out).size / 1e6;
  if (mb > 100) throw new Error(`Even at ${kbps} kbps this audio is ${Math.round(mb)} MB - too long to transcribe in one piece.`);
  return { kbps, mb };
}

async function _api(method, url, key, body, headers) {
  const r = await fetch(url, { method, headers: { Authorization: 'Bearer ' + key, ...(headers || {}) }, body });
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
  if (!_version) throw new Error(`Replicate did not say which version of ${MODEL} to run.`);
  return _version;
}

async function _upload(file, key) {
  const fd = new FormData();
  fd.append('content', new Blob([fs.readFileSync(file)], { type: 'audio/mpeg' }), path.basename(file));
  const d = await _api('POST', `${API}/files`, key, fd);
  if (!d.id || !d.urls || !d.urls.get) throw new Error('Replicate did not keep the audio file.');
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

async function transcribeAudio(audioPath, { seconds = 0, onProgress } = {}) {
  const key = _key();
  if (!key) throw new Error('No Replicate API key - add it on Admin → API keys.');
  const bytes = fs.statSync(audioPath).size;
  if (onProgress) onProgress(bytes < 1e6 ? `Uploading ${Math.round(bytes / 1e3)} KB of audio` : `Uploading ${(bytes / 1e6).toFixed(1)} MB of audio`);
  const version = await _versionOf(key);
  const file = await _upload(audioPath, key);
  let p = null;
  try {
    if (onProgress) onProgress('Transcribing (Whisper large-v3)');
    p = await _api('POST', `${API}/predictions`, key,
      JSON.stringify({ version, input: { audio: file.urls.get, task: 'transcribe', language: 'None', timestamp: 'chunk', batch_size: 24 } }),
      { 'Content-Type': 'application/json', Prefer: 'wait=60' });
    const deadline = Date.now() + DEADLINE_MS;
    while ((p.status === 'starting' || p.status === 'processing') && Date.now() < deadline) {
      if (onProgress) onProgress(p.status === 'starting' ? 'Waiting for Whisper to start' : 'Transcribing (Whisper large-v3)');
      await new Promise(x => setTimeout(x, POLL_MS));
      p = await _api('GET', `${API}/predictions/${p.id}`, key);
    }
    if (p.status === 'starting' || p.status === 'processing') {
      // Not left running (and billing) after we have given up on it.
      try { await _api('POST', `${API}/predictions/${p.id}/cancel`, key); } catch (e) { /* it ends by itself */ }
      throw new Error('Transcription took longer than half an hour and was cancelled.');
    }
    if (p.status !== 'succeeded') throw new Error(`Transcription ${p.status}: ${String(p.error || '').slice(0, 300)}`);
  } finally {
    // The upload is only a hand-over: gone once the model has read it (it would expire in a day).
    try { await _api('DELETE', `${API}/files/${file.id}`, key); } catch (e) { /* expires by itself */ }
  }

  const out = p.output || {};
  const flat = String(out.text || '').trim();
  let cues = cuesFromChunks(out.chunks, seconds);
  // NO SPEECH IS NOT A BROKEN RESPONSE: music or silence comes back empty, and is still billed.
  if (!cues.length && !flat) {
    throw new Error(`No speech was recognised in this audio (${Math.round(seconds)}s). Music, room noise or silence transcribe to nothing.`);
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
async function transcribeFile(file, { onProgress } = {}) {
  if (!fs.existsSync(file)) throw new Error(`No such file: ${file}`);
  const seconds = await probeDuration(file);
  const tmp = path.join(os.tmpdir(), `ugc-stt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp3`);
  try {
    const enc = await _encode(file, tmp, seconds, onProgress);
    const out = await transcribeAudio(tmp, { seconds, onProgress });
    return { ...out, sourceSeconds: seconds, kbps: enc.kbps, uploadedMb: enc.mb };
  } finally {
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch (e) {}
  }
}

module.exports = { MODEL, probeDuration, pickBitrate, cuesFromChunks, transcribeAudio, transcribeFile };
