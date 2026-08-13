'use strict';

// ════════════════════════════════════════════════════════════════════════════
// TRANSCRIPTION THROUGH OPENROUTER — one file in, cues with word timings out.
//
// Ported from an earlier project. Its reason for existing, in its own words: YouTube's automatic
// captions are not used at all, because on a fifty-minute video about David and Goliath they
// spelled "Голиаф" zero times and "Тель-Дан" zero times, which is exactly the material a
// script needs. The paid pass costs about eight cents an hour of audio and runs two hundred
// times faster than real time.
//
// NOT the same thing as routes/stt-timeline.js. That one serves Merge: it concatenates a
// timeline's fragment audio and word-times the result so the words land in final-timeline
// coordinates, through Groq. This one takes an arbitrary file - a narrator's sample video, a
// long source to mine for topics - and is asked for its speech. Same idea, different jobs,
// and folding them together would mean one caller's constants deciding the other's output.
//
// THE FILE IS NEVER SPLIT. The endpoint refuses uploads over 25 MB, and splitting would mean
// stitching two timelines back together; instead the bitrate is chosen so the whole thing
// fits. One file, one set of timings. Speech survives 16 kbps far better than timings survive
// being cut and re-joined.
// ════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const os = require('os');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');

const SETTINGS_FILE = path.join(__dirname, '..', 'data', 'settings.json');

const ENDPOINT = 'https://openrouter.ai/api/v1/audio/transcriptions';
const DEFAULT_MODEL = 'x-ai/grok-stt-1.0';
const TIMEOUT_MS = 1800000;              // half an hour: a long file is a long upload

const SIZE_LIMIT_MB = 25.0;              // what the endpoint refuses above
const SIZE_BUDGET_MB = 23.5;             // room for the container and multipart overhead
// mp3 only encodes a fixed ladder; asking for 13 kbps gets rounded UP to 16 and blows the
// budget, so the rung is chosen here rather than left to ffmpeg.
const MP3_BITRATES = [8, 16, 24, 32, 40, 48];

// A cue ends on punctuation, on a pause, or when it simply runs long. The opening minutes of
// a long file come back with no punctuation at all, so the time and gap rules are what
// actually carry the split there.
const MAX_CUE_SECONDS = 8.0;
const GAP_SECONDS = 0.9;

const DURATION_RE = /Duration:\s*(\d+):(\d\d):(\d\d(?:\.\d+)?)/;

function _key() {
  try {
    const s = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    return String(s.openRouterApiKey || '').trim();
  } catch (e) { return ''; }
}

function _run(args, timeout = 1800000) {
  return new Promise((resolve) => {
    let err = '';
    let done = false;
    const p = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    const timer = setTimeout(() => { if (!done) { try { p.kill('SIGKILL'); } catch (e) {} } }, timeout);
    if (p.stderr) p.stderr.on('data', d => { err = (err + d).slice(-4000); });
    p.on('error', e => { done = true; clearTimeout(timer); resolve({ code: -1, err: e.message }); });
    p.on('close', code => { done = true; clearTimeout(timer); resolve({ code, err }); });
  });
}

// The bundled ffmpeg-static ships no ffprobe, so the length comes off the `Duration:` line
// ffmpeg prints when handed an input and no output. It appears at once - the container is
// opened, not decoded - and ffmpeg exits non-zero on purpose in that mode, so the return
// code says nothing and only the text matters.
async function probeDuration(file) {
  if (!ffmpegPath) throw new Error('ffmpeg is not available.');
  const r = await _run(['-hide_banner', '-i', file], 300000);
  const m = DURATION_RE.exec(r.err || '');
  if (!m) throw new Error(`Could not read "${path.basename(file)}" — is it a video or audio file?`);
  return (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]);
}

// Highest rung that still fits the budget. Anything up to about an hour and a quarter keeps
// the full 48 kbps; longer files trade audio quality for staying in one piece.
function pickBitrate(seconds) {
  if (!(seconds > 0)) return MP3_BITRATES[MP3_BITRATES.length - 1];
  const budget = SIZE_BUDGET_MB * 8 * 1024 / seconds;
  const affordable = MP3_BITRATES.filter(r => r <= budget);
  return affordable.length ? affordable[affordable.length - 1] : MP3_BITRATES[0];
}

// At the bottom of the ladder 8 kHz sounds better than 16 — fewer bands to spend the same
// handful of bits on.
const pickSampleRate = (kbps) => (kbps <= 16 ? 8000 : 16000);

async function compress(input, out, seconds, onProgress) {
  const kbps = pickBitrate(seconds);
  const rate = pickSampleRate(kbps);
  if (onProgress) onProgress(`Re-encoding audio at ${kbps} kbps`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const r = await _run(['-y', '-hide_banner', '-loglevel', 'error', '-i', input,
    '-ac', '1', '-ar', String(rate), '-b:a', `${kbps}k`, out]);
  if (r.code !== 0 || !fs.existsSync(out)) {
    throw new Error('Could not re-encode the audio:\n' + String(r.err).slice(-400));
  }
  const mb = fs.statSync(out).size / 1e6;
  if (mb > SIZE_LIMIT_MB) {
    throw new Error(`Even at ${kbps} kbps this audio is ${Math.round(mb)} MB, over the `
      + `${SIZE_LIMIT_MB} MB upload limit. The file is too long to transcribe in one piece.`);
  }
  return { path: out, kbps, mb };
}

// Word timings -> cues, split on sentence ends, pauses, and length.
function cuesFromWords(words) {
  const cues = [];
  let cur = null;
  for (const w of words || []) {
    const text = String(w.word || '').trim();
    if (!text) continue;
    const start = +w.start || 0;
    const end = +w.end || 0;
    if (!cur) { cur = { start, end, parts: [text] }; continue; }
    const tooLong = end - cur.start > MAX_CUE_SECONDS;
    const paused = start - cur.end > GAP_SECONDS;
    if (tooLong || paused) { cues.push(cur); cur = { start, end, parts: [text] }; continue; }
    cur.parts.push(text);
    cur.end = end;
    if (/[.!?]$/.test(text)) { cues.push(cur); cur = null; }
  }
  if (cur) cues.push(cur);
  return cues.map(c => ({
    start: Math.round(c.start * 100) / 100,
    end: Math.round(c.end * 100) / 100,
    text: c.parts.join(' '),
  }));
}

async function transcribeAudio(audioPath, { model = DEFAULT_MODEL, onProgress } = {}) {
  const key = _key();
  if (!key) throw new Error('No OpenRouter API key. Add one in Brains (the key popup on Library).');

  const bytes = fs.statSync(audioPath).size;
  // Shown in KB below a megabyte: "Transcribing 0 MB" reads like a bug in the step before it.
  if (onProgress) {
    onProgress(bytes < 1e6 ? `Transcribing ${Math.round(bytes / 1e3)} KB`
      : `Transcribing ${(bytes / 1e6).toFixed(1)} MB`);
  }

  const form = new FormData();
  form.append('file', fs.createReadStream(audioPath), {
    filename: path.basename(audioPath), contentType: 'audio/mpeg',
  });
  form.append('model', model);
  form.append('response_format', 'verbose_json');
  form.append('timestamp_granularities[]', 'word');

  let res;
  try {
    res = await axios.post(ENDPOINT, form, {
      headers: { ...form.getHeaders(), Authorization: `Bearer ${key}` },
      timeout: TIMEOUT_MS, maxBodyLength: Infinity, maxContentLength: Infinity,
    });
  } catch (e) {
    const body = e.response && e.response.data;
    const detail = body ? String(typeof body === 'string' ? body : JSON.stringify(body)).slice(0, 300) : e.message;
    throw new Error(`Transcription failed${e.response ? ' (' + e.response.status + ')' : ''}: ${detail}`);
  }

  const body = res.data || {};
  const usage = body.usage || {};
  const words = body.words || [];
  const segments = body.segments || [];
  const flat = String(body.text || '').trim();

  // NO SPEECH IS NOT A BROKEN RESPONSE, and the two used to share one message. A file of music
  // or room noise comes back 200 with text:"" and a single empty segment spanning the whole
  // duration - and it is still billed. Saying "no word timings" about that sends you looking at
  // the request when the answer is the file.
  if (!words.length && !flat && !segments.some(s => String(s.text || '').trim())) {
    throw new Error(`No speech was recognised in this audio (${Math.round(+(usage.seconds || body.duration || 0))}s). `
      + 'Music, room noise or silence transcribe to nothing.');
  }

  // Word timings when the model gives them, segment timings when it does not. Segments are
  // coarser - roughly a sentence each - and that is enough for everything downstream: topic
  // mining groups cues into fifteen-second blocks and a narrator sample only needs the words.
  // Without this fallback, any model that does not do word granularity is simply unusable.
  let cues;
  let granularity;
  if (words.length) {
    cues = cuesFromWords(words);
    granularity = 'word';
  } else if (segments.length) {
    cues = segments
      .map(s => ({
        start: Math.round((+s.start || 0) * 100) / 100,
        end: Math.round((+s.end || 0) * 100) / 100,
        text: String(s.text || '').trim(),
      }))
      .filter(c => c.text);
    granularity = 'segment';
  } else {
    // Text with no timings at all: usable as a narrator sample, useless for topic spans, so it
    // comes back as one cue covering everything rather than pretending to be timed.
    cues = [{ start: 0, end: +(body.duration || 0), text: flat }];
    granularity = 'none';
  }

  return {
    cues,
    granularity,
    text: cues.map(c => c.text).join(' '),
    seconds: +(usage.seconds || body.duration || 0),
    cost: +(usage.cost || 0),
    model,
  };
}

// The whole chain for a file on disk: length, a temporary mp3 that fits, transcription. The
// temporary file is removed even when the call throws - a failed transcription of a long
// video otherwise leaves 23 MB behind every time it is retried.
async function transcribeFile(file, { model = DEFAULT_MODEL, onProgress } = {}) {
  if (!fs.existsSync(file)) throw new Error(`No such file: ${file}`);
  const seconds = await probeDuration(file);
  const tmp = path.join(os.tmpdir(), `ugc-stt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp3`);
  try {
    const enc = await compress(file, tmp, seconds, onProgress);
    const out = await transcribeAudio(tmp, { model, onProgress });
    return { ...out, sourceSeconds: seconds, kbps: enc.kbps, uploadedMb: enc.mb };
  } finally {
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch (e) {}
  }
}

module.exports = {
  ENDPOINT, DEFAULT_MODEL, SIZE_LIMIT_MB, MP3_BITRATES, MAX_CUE_SECONDS, GAP_SECONDS,
  probeDuration, pickBitrate, pickSampleRate, compress, cuesFromWords,
  transcribeAudio, transcribeFile,
};
