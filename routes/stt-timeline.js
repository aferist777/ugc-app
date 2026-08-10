'use strict';

// ════════════════════════════════════════════════════════════════════════════
// TIMELINE VOICE STT — word timings for the Merge spine.
//
// Concatenates each fragment's audio in timeline order (silence-padded to its exact
// duration) into one voice track, then word-level Whisper it, so the words come back
// already in FINAL-timeline coordinates. Merge keeps only the words over inline-upload
// spans; talking-head fragments keep their own per-fragment subtitles.
//
// This lived in routes/vsl.js and moved here unchanged when VSL was removed (Ph15): it
// is the one part of that file the creatives flow uses. Kept as its own module rather
// than folded into routes/audio.js so the port is a move, not a rewrite.
//
//   POST /api/stt/timeline      { segments: [{src, crop, speed, dur, voiceOnly}] } -> { jobId }
//   GET  /api/stt/timeline/:id  -> { state, progress, words }
// ════════════════════════════════════════════════════════════════════════════

const express  = require('express');
const fs       = require('fs');
const path     = require('path');
const axios    = require('axios');
const FormData = require('form-data');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');

const router = express.Router();

const ROOT_DIR      = path.join(__dirname, '..');
const UPLOADS_DIR   = path.join(ROOT_DIR, 'uploads');
const FINALS_DIR    = path.join(ROOT_DIR, 'finals');
const TEMP_DIR      = path.join(ROOT_DIR, 'temp_files');
const SETTINGS_FILE = path.join(ROOT_DIR, 'data', 'settings.json');
const GROQ_STT_URL  = 'https://api.groq.com/openai/v1/audio/transcriptions';

function _groqKey() {
  try { const s = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')); return String(s.groqApiKey || '').trim(); }
  catch { return ''; }
}

// A timeline clip's src is a web path; map it back to disk. Remote URLs cannot be read.
function _sttWebToFs(p) {
  if (!p) return null;
  const s = String(p).split('?')[0];
  if (/^https?:\/\//i.test(s)) return null;
  if (s.startsWith('/uploads/')) return path.join(UPLOADS_DIR, s.slice('/uploads/'.length));
  if (s.startsWith('/finals/'))  return path.join(FINALS_DIR,  s.slice('/finals/'.length));
  return path.join(ROOT_DIR, s.replace(/^\//, ''));
}

// ffmpeg atempo covers 0.5..2.0 per stage; chain for extremes (Merge stays in range).
function _atempoChain(sp) {
  sp = Math.max(0.25, Math.min(4, +sp || 1));
  const parts = []; let r = sp;
  while (r > 2.0 + 1e-6) { parts.push('atempo=2.0'); r /= 2.0; }
  while (r < 0.5 - 1e-6) { parts.push('atempo=0.5'); r /= 0.5; }
  parts.push('atempo=' + r.toFixed(4));
  return parts.join(',');
}

// Extract a small mono 16k mp3 (ideal for ASR, keeps the payload small).
function _extractAudioMp3(srcAbs, outAbs, ssSec, durSec) {
  return new Promise((resolve, reject) => {
    const args = ['-hide_banner'];
    if (ssSec != null) args.push('-ss', String(ssSec));
    args.push('-i', srcAbs);
    if (durSec != null) args.push('-t', String(durSec));
    args.push('-vn', '-ac', '1', '-ar', '16000', '-c:a', 'libmp3lame', '-b:a', '64k', '-y', outAbs);
    const proc = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = ''; proc.stderr.on('data', c => { err = (err + c.toString()).slice(-600); });
    proc.on('close', code => code === 0 ? resolve() : reject(new Error('audio extract failed (' + code + '): ' + err.slice(-160))));
    proc.on('error', reject);
  });
}

// One timeline segment -> EXACTLY seg.dur seconds of 16k mono audio (real audio retimed
// by speed from the source in-point, or silence when there is no audio), so the
// concatenation length matches the timeline and word timings line up.
function _extractSegWav(seg, outAbs) {
  return new Promise((resolve) => {
    const dur = Math.max(0.02, +seg.dur || 0);
    const silence = () => {
      const a = ['-hide_banner', '-f', 'lavfi', '-t', dur.toFixed(3), '-i', 'anullsrc=r=16000:cl=mono', '-ac', '1', '-ar', '16000', '-y', outAbs];
      const p = spawn(ffmpegPath, a, { stdio: ['ignore', 'ignore', 'ignore'] });
      p.on('close', () => resolve()); p.on('error', () => resolve());
    };
    const src = _sttWebToFs(seg.src);
    if (!src || !fs.existsSync(src)) return silence();
    const sp = (+seg.speed > 0 ? +seg.speed : 1);
    const crop = Math.max(0, +seg.crop || 0);
    const readSec = (dur * sp).toFixed(3);                       // source secs consumed
    const af = _atempoChain(sp) + ',aresample=16000,apad';       // retime + pad-to-length
    const a = ['-hide_banner', '-ss', String(crop), '-t', readSec, '-i', src, '-af', af, '-ac', '1', '-ar', '16000', '-t', dur.toFixed(3), '-y', outAbs];
    const p = spawn(ffmpegPath, a, { stdio: ['ignore', 'ignore', 'ignore'] });
    p.on('close', (code) => (code === 0 && fs.existsSync(outAbs)) ? resolve() : silence());   // no audio stream -> silence
    p.on('error', () => silence());
  });
}

async function _groqSttChunk(mp3Abs) {
  const key = _groqKey();
  if (!key) throw new Error('No Groq API key (set it in Brain)');
  const form = new FormData();
  form.append('file', fs.createReadStream(mp3Abs), { filename: path.basename(mp3Abs), contentType: 'audio/mpeg' });
  form.append('model', 'whisper-large-v3-turbo');
  form.append('response_format', 'verbose_json');
  form.append('timestamp_granularities[]', 'word');
  const r = await axios.post(GROQ_STT_URL, form, {
    headers: { ...form.getHeaders(), Authorization: 'Bearer ' + key },
    timeout: 180000, maxBodyLength: Infinity, maxContentLength: Infinity,
  });
  return ((r.data && r.data.words) || [])
    .filter(w => typeof w.start === 'number')
    .map(w => ({ text: w.word || w.text || '', start: w.start, end: (w.end != null ? w.end : w.start + 0.3) }));
}

const _tlJobs = {};   // jobId -> { state, progress, words, error }

function _startTimelineStt(segments, jobId) {
  const job = _tlJobs[jobId] = { state: 'running', progress: 0, words: null, error: null };
  const temps = [];
  (async () => {
    try {
      if (!_groqKey()) throw new Error('No Groq API key (set it in Brain)');
      try { fs.mkdirSync(TEMP_DIR, { recursive: true }); } catch (e) {}
      const segFiles = [];
      for (let i = 0; i < segments.length; i++) {
        const f = path.join(TEMP_DIR, `_tl_${jobId}_${i}.wav`); temps.push(f);
        await _extractSegWav(segments[i], f);
        segFiles.push(f);
        job.progress = Math.round((i + 1) / segments.length * 50);
      }
      const listFile = path.join(TEMP_DIR, `_tl_${jobId}.txt`); temps.push(listFile);
      fs.writeFileSync(listFile, segFiles.map(f => "file '" + f.replace(/\\/g, '/').replace(/'/g, "'\\''") + "'").join('\n'), 'utf8');
      const fullMp3 = path.join(TEMP_DIR, `_tl_${jobId}.mp3`); temps.push(fullMp3);
      await new Promise((res, rej) => {
        const p = spawn(ffmpegPath, ['-hide_banner', '-f', 'concat', '-safe', '0', '-i', listFile, '-c:a', 'libmp3lame', '-ar', '16000', '-ac', '1', '-y', fullMp3], { stdio: ['ignore', 'ignore', 'pipe'] });
        let e = ''; p.stderr.on('data', c => { e = (e + c).slice(-300); });
        p.on('close', c => c === 0 ? res() : rej(new Error('concat failed: ' + e.slice(-120)))); p.on('error', rej);
      });
      job.progress = 60;
      const totalDur = segments.reduce((s, x) => s + (+x.dur || 0), 0);
      const CHUNK = 480, n = Math.max(1, Math.ceil(totalDur / CHUNK)), all = [];
      if (n === 1) { all.push(...(await _groqSttChunk(fullMp3))); }
      else {
        for (let i = 0; i < n; i++) {
          const cf = path.join(TEMP_DIR, `_tlc_${jobId}_${i}.mp3`); temps.push(cf);
          await _extractAudioMp3(fullMp3, cf, i * CHUNK, CHUNK);
          const off = i * CHUNK;
          (await _groqSttChunk(cf)).forEach(x => all.push({ text: x.text, start: x.start + off, end: x.end + off }));
          job.progress = 60 + Math.round((i + 1) / n * 35);
        }
      }
      all.sort((a, b) => a.start - b.start);
      job.words = all; job.state = 'done'; job.progress = 100;
    } catch (e) {
      const msg = (e.response && e.response.data && (e.response.data.error && (e.response.data.error.message || e.response.data.error))) || e.message || 'error';
      job.state = 'error'; job.error = String(msg).slice(0, 300);
      console.warn('[stt/timeline]', jobId, 'FAILED:', String(msg).slice(0, 160));
    } finally {
      for (const f of temps) { try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch (e) {} }
    }
  })();
}

router.post('/stt/timeline', (req, res) => {
  const segments = (req.body && Array.isArray(req.body.segments)) ? req.body.segments : null;
  if (!segments || !segments.length) return res.status(400).json({ success: false, error: 'segments required' });
  if (!_groqKey()) return res.status(400).json({ success: false, error: 'No Groq API key (set it in Brain)' });
  const jobId = 'tl_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
  _startTimelineStt(segments, jobId);
  res.json({ success: true, jobId });
});

router.get('/stt/timeline/:id', (req, res) => {
  const j = _tlJobs[req.params.id];
  if (!j) return res.status(404).json({ success: false, error: 'job not found' });
  res.json({ success: true, state: j.state, progress: j.progress, error: j.error, words: j.state === 'done' ? (j.words || []) : null });
});

module.exports = router;
