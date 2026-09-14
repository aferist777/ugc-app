'use strict';

// ════════════════════════════════════════════════════════════════════════════
// MERGE — the read.
//
//   POST /api/mv3/voice/speak   { voiceId, lines:[…], stability?, speed? }
//                               -> { takes: [{path, dur, said}], failed: […] }
//
// ONE CALL, N LINES. The panel splits what was typed at the line breaks and lays the
// results one after another on the lane, so asking line by line would be N round trips to
// build one thing. A line that fails does NOT take the batch with it: it comes back in
// `failed` and the rest are still on the lane, because a read of eight lines where the
// fourth timed out is seven-eighths of the work already paid for.
//
// EVERYTHING ELSE THE PANEL NEEDS ALREADY EXISTS and is reused rather than copied:
//
//   GET  /api/library/shelf/voices   the voices we hold, with our own demos  (routes/library)
//   GET  /api/scen3/voices/filters   the search vocabularies                 (routes/scen3)
//   GET  /api/scen3/voices/library   the shared-library search proxy         (routes/scen3)
//   POST /api/scen3/voices/take      adding one to the account               (routes/scen3)
//
// Those four carry no page's semantics - they are an ElevenLabs proxy and a catalogue - so a
// Merge-owned copy of them would be a second thing to fix when ElevenLabs changes. What is
// here is only what nothing answers today: many lines at once, with their lengths measured.
// ════════════════════════════════════════════════════════════════════════════

const express = require('express');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { execFile, spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');

const { DATA_DIR } = require('../lib/config');

const router = express.Router();

const EL_TTS = 'https://api.elevenlabs.io/v1/text-to-speech';
const VOICE_DIR = path.join(require('../lib/config').UPLOADS_DIR, 'voice');

// ONE MODEL, ON PURPOSE. `eleven_v3` also exists and is what the Scenarios read uses, because
// it PERFORMS bracketed tags - [sighs], [whispering] - and v2 has no idea what they are and
// reads the brackets out loud as words. Nothing here writes tags, so v2 is the right one and
// the choice is not offered: a switch between two models where one of them would mispronounce
// the text is a switch with a wrong side.
const MODEL = 'eleven_multilingual_v2';

// Enough for a long script, low enough that a paste of a whole book is refused rather than
// silently charged for. ElevenLabs takes 5000 characters in one request; a LINE that long is
// not a line, so it is cut well under that.
const MAX_LINES = 40;
const MAX_CHARS = 2000;

const elKey = () => {
  try {
    const s = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'settings.json'), 'utf8'));
    return String(s.elevenLabsApiKey || process.env.ELEVENLABS_API_KEY || '').trim();
  } catch (e) { return String(process.env.ELEVENLABS_API_KEY || '').trim(); }
};

// Duration out of ffmpeg's own header dump - no ffprobe dependency, the same trick the
// Scenarios read uses. The clip's length on the lane is read off this, so a 0 here would put
// a zero-width clip on the timeline: the caller falls back rather than trusting it blindly.
function _dur(file) {
  return new Promise(resolve => {
    let out = '';
    try {
      const p = spawn(ffmpegPath, ['-hide_banner', '-i', file], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
      p.stderr.on('data', c => { out += c.toString(); });
      p.on('error', () => resolve(0));
      p.on('close', () => {
        const m = out.match(/Duration:\s*(\d+):(\d+):(\d+\.?\d*)/);
        resolve(m ? (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]) : 0);
      });
    } catch (e) { resolve(0); }
  });
}

// ElevenLabs pads a read with a little silence at both ends. Laid end to end that padding is
// the gap BETWEEN lines, so it stacks with the beat the panel already leaves - and worse, it
// puts the clip's left edge somewhere the sound does not start, which is exactly what makes a
// clip look out of sync with itself when it is dragged against a cut.
function _trim(file) {
  return new Promise(resolve => {
    const tmp = file + '.tmp.mp3';
    execFile(ffmpegPath, [
      '-y', '-i', file,
      '-af', 'silenceremove=stop_periods=-1:stop_duration=0.3:stop_threshold=-40dB:stop_silence=0.1',
      '-c:a', 'libmp3lame', '-q:a', '2', tmp,
    ], { windowsHide: true }, (err) => {
      // Keeping the untrimmed file beats losing the read: the padding is a blemish, a failed
      // rename is a line that has to be paid for twice.
      if (err) { try { fs.unlinkSync(tmp); } catch (e) {} return resolve(); }
      try { fs.renameSync(tmp, file); } catch (e) {}
      resolve();
    });
  });
}

async function _speak(key, voiceId, text, stability, speed) {
  const r = await axios.post(
    EL_TTS + '/' + encodeURIComponent(voiceId),
    {
      text,
      model_id: MODEL,
      voice_settings: { stability, similarity_boost: 0.75, speed, use_speaker_boost: true },
    },
    { headers: { 'xi-api-key': key, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
      responseType: 'arraybuffer', timeout: 120000 },
  );
  return Buffer.from(r.data);
}

// An ElevenLabs refusal arrives as a BUFFER, because the request asked for audio back. Read
// as-is it prints as a row of bytes, which is how "this voice is not in the account" ends up
// on screen as an unreadable blob.
function _why(e) {
  let d = e.response && e.response.data;
  try { if (d && (Buffer.isBuffer(d) || d instanceof Uint8Array)) d = JSON.parse(Buffer.from(d).toString('utf8')); }
  catch (x) { d = null; }
  const det = d && d.detail;
  const msg = (det && (det.message || det.code)) || (d && d.message) || e.message;
  return String(msg).slice(0, 220);
}

router.post('/mv3/voice/speak', async (req, res) => {
  try {
    const b = req.body || {};
    const key = elKey();
    if (!key) return res.status(400).json({ success: false, error: 'no ElevenLabs key in settings' });

    const voiceId = String(b.voiceId || '').trim();
    if (!voiceId) return res.status(400).json({ success: false, error: 'pick a voice first' });

    const lines = (Array.isArray(b.lines) ? b.lines : [])
      .map(s => String(s == null ? '' : s).trim())
      .filter(Boolean)
      .slice(0, MAX_LINES)
      .map(s => s.slice(0, MAX_CHARS));
    if (!lines.length) return res.status(400).json({ success: false, error: 'nothing to read' });

    const stability = Math.max(0, Math.min(1, b.stability == null ? 0.5 : +b.stability));
    const speed = Math.max(0.7, Math.min(1.2, b.speed == null ? 1 : +b.speed));

    fs.mkdirSync(VOICE_DIR, { recursive: true });
    const stamp = Date.now();
    const takes = [];
    const failed = [];

    // IN ORDER AND ONE AT A TIME. Concurrency would be faster and it would also hand the
    // account several simultaneous requests for the same voice, which is where 429s live -
    // and the lines have to be laid in order anyway, so nothing is gained downstream.
    for (let i = 0; i < lines.length; i++) {
      const said = lines[i];
      try {
        const buf = await _speak(key, voiceId, said, stability, speed);
        const name = 'mv3v_' + stamp + '_' + (i + 1) + '.mp3';
        const abs = path.join(VOICE_DIR, name);
        fs.writeFileSync(abs, buf);
        await _trim(abs);
        const d = await _dur(abs);
        takes.push({ path: '/uploads/voice/' + name, dur: Math.round(d * 100) / 100, said });
      } catch (e) {
        const why = _why(e);
        console.warn('[mv3/voice] line ' + (i + 1) + ' failed:', why);
        failed.push({ line: i + 1, said, error: why });
      }
    }

    console.log('[mv3/voice/speak] ' + voiceId + ' ' + MODEL
      + ' spoken=' + takes.length + ' failed=' + failed.length);
    // A batch where EVERY line failed is a failure, not a result with an empty list: the panel
    // should wear the reason rather than report that nothing was asked for.
    if (!takes.length) {
      return res.status(502).json({ success: false,
        error: (failed[0] && failed[0].error) || 'nothing was read', failed });
    }
    res.json({ success: true, model: MODEL, takes, failed });
  } catch (e) {
    console.error('[mv3/voice/speak]', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;
