'use strict';

const express = require('express');
const path    = require('path');
const fs      = require('fs');
const axios   = require('axios');
const multer  = require('multer');
const router  = express.Router();

const FormData = require('form-data');
const { execFile }  = require('child_process');
const ffmpegPath    = require('ffmpeg-static');
const { KIE_BASE, UPLOADS_DIR, TEMP_DIR, ROOT_DIR, DATA_DIR } = require('../lib/config');
const UPLOADS_THUMBS_DIR = path.join(UPLOADS_DIR, 'thumbs');
const {
  kieHeaders, uploadToPublicHost, callAI, callAIVisionWithFallback,
  createGptImage2Task, createGptImage2TextTask,
  createQwen2TextTask, createSeedream5LiteTextTask, createSeedream45TextTask, createNanoBananaProTextTask,
  createPVideoAvatarTask, createPVideoTask, createGrokImagineVideoTask,
  normalizeVideoForBrowser,
} = require('../lib/helpers');

// Shared: poll a Replicate video prediction (taskId = 'repl:<id>'); on success
// download the mp4 into uploads/<prefix>_<id>_<ts>.mp4, normalize, return videoPath.
// Used by the grok-imagine-video routes (and mirrors the p-video status handler).
async function _replicateVideoStatus(taskId, prefix, res) {
  if (!taskId || !taskId.startsWith('repl:')) {
    return res.status(400).json({ success: false, error: 'taskId must start with repl:' });
  }
  const predictionId = taskId.slice(5);
  let apiKey = '';
  try { apiKey = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'))?.replicateApiKey || ''; } catch {}
  if (!apiKey) return res.json({ success: true, state: 'failed', error: 'Replicate token not configured' });
  const pollRes = await axios.get(`https://api.replicate.com/v1/predictions/${predictionId}`, {
    headers: { Authorization: `Bearer ${apiKey}` }, timeout: 15000,
  });
  const pred = pollRes.data;
  const state = pred?.status;
  if (state === 'failed' || state === 'canceled') {
    return res.json({ success: true, state: 'failed', error: (pred?.error || state) });
  }
  if (state !== 'succeeded') return res.json({ success: true, state: 'pending' });
  const _extract = (out) => {
    if (!out) return null;
    if (typeof out === 'string') return out;
    if (Array.isArray(out)) { for (const it of out) { const u = _extract(it); if (u) return u; } return null; }
    if (typeof out === 'object') return out.url || out.video || out.video_url || null;
    return null;
  };
  const remoteUrl = _extract(pred.output);
  if (!remoteUrl) return res.json({ success: true, state: 'failed', error: 'Replicate: empty output' });
  const filename = `${prefix}_repl${predictionId.slice(-10)}_${Date.now()}.mp4`;
  const destPath = path.join(UPLOADS_DIR, filename);
  const videoRes = await axios({ url: remoteUrl, method: 'GET', responseType: 'arraybuffer', timeout: 120000 });
  fs.writeFileSync(destPath, Buffer.from(videoRes.data));
  try { await normalizeVideoForBrowser(destPath); } catch (e) { console.warn('[replicate-video/status] normalize failed:', e.message); }
  return res.json({ success: true, state: 'success', videoPath: `/uploads/${filename}` });
}

// Strip long silences from a TTS mp3 file in-place using FFmpeg.
// Silences longer than 0.6 s are replaced with 0.4 s pauses.
function stripSilence(filePath) {
  return new Promise((resolve) => {
    const tmp = filePath + '.tmp.mp3';
    const args = [
      '-y', '-i', filePath,
      '-af', 'silenceremove=stop_periods=-1:stop_duration=0.3:stop_threshold=-40dB:stop_silence=0.3',
      '-c:a', 'libmp3lame', '-q:a', '2',
      tmp,
    ];
    execFile(ffmpegPath, args, (err) => {
      if (err) {
        console.warn('[stripSilence] FFmpeg error, keeping original:', err.message);
        try { fs.unlinkSync(tmp); } catch {}
        return resolve(filePath);
      }
      try { fs.renameSync(tmp, filePath); } catch (e) {
        console.warn('[stripSilence] rename failed:', e.message);
      }
      resolve(filePath);
    });
  });
}

// Extract first frame at 0.5 s → save as JPEG thumbnail
function extractBirolyThumb(absVideoPath, absThumbPath) {
  return new Promise(resolve => {
    const args = ['-ss', '0.5', '-i', absVideoPath, '-frames:v', '1', '-q:v', '3', '-y', absThumbPath];
    execFile(ffmpegPath, args, { timeout: 15000 }, err => {
      resolve(!err && fs.existsSync(absThumbPath));
    });
  });
}

// ── API keys & settings ───────────────────────────────────────────────────────
const GROQ_API_BASE  = 'https://api.groq.com/openai/v1';
const EL_API_BASE    = 'https://api.elevenlabs.io/v1';
const SETTINGS_FILE  = path.join(DATA_DIR, 'settings.json');

function _loadSettings() {
  try { return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')); } catch { return {}; }
}
function _getGroqApiKey() {
  const s = _loadSettings();
  return (s.groqApiKey && s.groqApiKey.trim()) ? s.groqApiKey.trim() : '';
}
function _getElevenLabsApiKey() {
  const s = _loadSettings();
  return (s.elevenLabsApiKey && s.elevenLabsApiKey.trim()) ? s.elevenLabsApiKey.trim() : '';
}

// ── Custom voices catalog (server-side persistent storage) ───────────────────
// Previously: hardcoded EL_VOICE_IDS map of 28 base ElevenLabs voices.
// Now: voices live in data/custom-voices.json and are all user-generated via
// ElevenLabs Voice Design (text-to-voice/create-previews + create-voice-from-preview).
// Schema: [{ id, voiceId, name, gender, desc, createdAt, characterId }]
const CUSTOM_VOICES_FILE = path.join(DATA_DIR, 'custom-voices.json');
function _loadCustomVoices() {
  try { return JSON.parse(fs.readFileSync(CUSTOM_VOICES_FILE, 'utf8')); }
  catch { return []; }
}
function _saveCustomVoices(list) {
  fs.writeFileSync(CUSTOM_VOICES_FILE, JSON.stringify(list, null, 2), 'utf8');
}
// Look up an ElevenLabs voice_id by stored name OR by raw voiceId (catalog
// stores both, frontend may pass either as `voice` parameter). Returns the
// ElevenLabs id string or null if not found.
function _resolveVoiceId(voiceParam) {
  if (!voiceParam) return null;
  const v = String(voiceParam).trim();
  const list = _loadCustomVoices();
  const hit = list.find(x => x.name === v || x.voiceId === v || x.id === v);
  return hit ? hit.voiceId : null;
}

// Direct ElevenLabs TTS call — returns saved audioPath
async function _elevenLabsTts(text, voiceName, ttsParams) {
  const apiKey = _getElevenLabsApiKey();
  if (!apiKey) throw new Error('ElevenLabs API ключ не настроен. Добавь в Настройки → CreationEngines.');

  // Resolve name → voiceId from custom-voices.json catalog. If not found,
  // assume voiceName already IS a raw ElevenLabs voice_id (fallback path so
  // legacy callers that pass raw ids keep working).
  const voiceId = _resolveVoiceId(voiceName) || voiceName;
  const modelId = ttsParams.model_id || 'eleven_multilingual_v2';

  const audioRes = await axios.post(
    `${EL_API_BASE}/text-to-speech/${voiceId}`,
    {
      text,
      model_id: modelId,
      voice_settings: {
        stability:        ttsParams.stability        ?? 0.5,
        similarity_boost: ttsParams.similarity_boost ?? 0.75,
        style:            ttsParams.style            ?? 0,
        speed:            ttsParams.speed            ?? 1,
        use_speaker_boost: true,
      },
    },
    {
      headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
      responseType: 'arraybuffer',
      timeout: 60000,
    }
  );

  const filename = `tts_el_${Date.now()}.mp3`;
  const destPath = path.join(UPLOADS_DIR, filename);
  fs.writeFileSync(destPath, Buffer.from(audioRes.data));
  await stripSilence(destPath);
  console.log(`[elevenlabs/tts] voice=${voiceName} (${voiceId}) model=${modelId} → ${filename}`);
  return `/uploads/${filename}`;
}

// Send audio buffer directly to Groq Whisper; returns { words: [{word,start,end}], text, duration }
async function _groqStt(buf, filename, language) {
  const apiKey = _getGroqApiKey();
  if (!apiKey) throw new Error('Groq API ключ не настроен. Добавь в Настройки → CreationEngines → API Keys.');

  const ext  = (path.extname(filename) || '.mp3').toLowerCase();
  const mime = ext === '.wav' ? 'audio/wav' : ext === '.ogg' ? 'audio/ogg' : 'audio/mpeg';

  const form = new FormData();
  form.append('file', buf, { filename: filename || `audio${ext}`, contentType: mime });
  form.append('model', 'whisper-large-v3-turbo');
  form.append('response_format', 'verbose_json');
  form.append('timestamp_granularities[]', 'word');
  if (language) form.append('language', language);

  const res = await axios.post(`${GROQ_API_BASE}/audio/transcriptions`, form, {
    headers: { ...form.getHeaders(), Authorization: `Bearer ${apiKey}` },
    timeout: 120_000,
  });
  return res.data;
}

// ── Audio file upload (music / sfx from user's computer) ─────────────────────
const AUDIO_DIR = path.join(UPLOADS_DIR, 'audio');
if (!fs.existsSync(AUDIO_DIR)) fs.mkdirSync(AUDIO_DIR, { recursive: true });

const _audioStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, AUDIO_DIR),
  filename: (req, file, cb) => {
    const ext  = path.extname(file.originalname) || '.mp3';
    const base = path.basename(file.originalname, ext).replace(/[^a-z0-9_-]/gi, '_').slice(0, 40);
    cb(null, `audio_${Date.now()}_${base}${ext}`);
  },
});
const _audioUpload = multer({ storage: _audioStorage, limits: { fileSize: 100 * 1024 * 1024 } });

// ── GET /api/audio/voices — verify ElevenLabs voice IDs, cache previews locally ─
const VOICE_PREVIEWS_DIR = path.join(__dirname, '..', 'public', 'voice-previews');
if (!fs.existsSync(VOICE_PREVIEWS_DIR)) fs.mkdirSync(VOICE_PREVIEWS_DIR, { recursive: true });

router.get('/audio/voices', async (req, res) => {
  const apiKey = _getElevenLabsApiKey();
  if (!apiKey) return res.json({ success: false, error: 'API key not set', validIds: [], previews: {} });
  try {
    const r = await axios.get(`${EL_API_BASE}/voices`, {
      headers: { 'xi-api-key': apiKey },
      timeout: 15000,
    });
    const voices  = r.data.voices || [];
    const validIds = voices.map(v => v.voice_id);
    const previews = {};

    for (const v of voices) {
      const localPath = `/voice-previews/${v.voice_id}.mp3`;
      const destFile  = path.join(VOICE_PREVIEWS_DIR, `${v.voice_id}.mp3`);
      previews[v.voice_id] = localPath;
      if (!fs.existsSync(destFile) && v.preview_url) {
        // Download preview in background — don't block response
        axios.get(v.preview_url, { responseType: 'arraybuffer', timeout: 30000 })
          .then(pr => fs.writeFileSync(destFile, Buffer.from(pr.data)))
          .catch(() => {});
      }
    }
    res.json({ success: true, validIds, previews });
  } catch (err) {
    console.error('[audio/voices]', err.response?.status, err.message);
    res.status(502).json({ success: false, error: err.message, validIds: [], previews: {} });
  }
});

// ── GET /api/audio/custom-voices — list catalog (server-side, persistent) ────
// Returns the raw custom-voices.json list. Frontend (scen-state.js) calls this
// on boot to populate window.ELEVENLABS_VOICES — there's no longer any
// hardcoded base list, the catalog IS the truth.
router.get('/audio/custom-voices', (_req, res) => {
  try {
    const list = _loadCustomVoices();
    res.json({ success: true, voices: list });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message, voices: [] });
  }
});

// ── POST /api/audio/voice-design/analyze-character ───────────────────────────
// Step 1 of the popup voice flow.
// Body: { imagePath, userText, llmModel? }
// Sends the character's main image + free-form user hint to a vision LLM. The
// LLM returns a CHARACTER description (physical look, perceived age, profession,
// manner of speaking) — NOT a voice description. The character description is
// then fed into /derive-voice (or the user can edit it first) to produce the
// final ElevenLabs Voice Design prompt.
// Gender is NEVER side-channelled here — the LLM reads it from the photo and
// MUST emit it as the literal first word of the description so /derive-voice
// can later read it unambiguously without any extra hints.
// Response: { success, characterDescription }
router.post('/audio/voice-design/analyze-character', async (req, res) => {
  const { imagePath, userText = '', llmModel } = req.body || {};
  if (!imagePath) return res.status(400).json({ success: false, error: 'imagePath required' });

  let imageBase64 = null;
  let mimeType = 'image/jpeg';
  try {
    const fsPath = imagePath.startsWith('/')
      ? path.join(ROOT_DIR, imagePath.replace(/^\//, ''))
      : imagePath;
    const buf = fs.readFileSync(fsPath);
    imageBase64 = buf.toString('base64');
    const ext = path.extname(fsPath).toLowerCase();
    mimeType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
  } catch (e) {
    return res.status(400).json({ success: false, error: `Cannot read image: ${e.message}` });
  }

  const sys = `You analyse the PERSON in a photo and write a character description for a UGC ad casting brief.

Rules:
- The VERY FIRST WORD of the description MUST be "Male" or "Female" (with a capital letter, followed by a comma). Determine this strictly from the photo — do not hedge ("Likely…", "Probably…"). Pick one.
- 30-80 words total, single paragraph, no line breaks.
- After the gender word, cover: perceived age range, ethnicity/look, profession or social role you'd guess, personality vibe, posture/energy, how you'd expect them to talk (manner, pace, attitude — as a personality trait, NOT yet a voice spec).
- Use the user's free-form notes as additional context — if they wrote something in Russian or another language, translate the meaning and incorporate it. The notes never override what the photo shows for gender.
- English only. Plain text, no markdown.

OUTPUT FORMAT (strict JSON, no markdown, no prose):
{"characterDescription":"Male, mid-forties, …"}  ← shape of the value, NOT the literal text`;

  const userMsg = `User notes (may be empty or in any language): ${userText || '(none provided)'}\n\nLook at the image and write the character description. Remember: the very first word must be "Male" or "Female".`;

  const messages = [
    { role: 'system', content: sys },
    { role: 'user',   content: [
      { type: 'text',      text: userMsg },
      { type: 'image_url', image_url: { url: `data:${mimeType};base64,${imageBase64}` } },
    ]},
  ];

  try {
    const raw = await callAIVisionWithFallback(messages, {
      openRouterModel: llmModel || 'google/gemini-3.5-flash',
      timeout: 60000,
    });
    let parsed = null;
    const jsonMatch = raw.match(/\{[\s\S]*?"characterDescription"[\s\S]*?\}/);
    if (jsonMatch) { try { parsed = JSON.parse(jsonMatch[0]); } catch {} }
    if (!parsed || !parsed.characterDescription) {
      // Tolerant fallback: take the whole raw text trimmed if it looks like
      // a single paragraph and the model just ignored the JSON wrapper.
      const stripped = String(raw || '').replace(/```[\s\S]*?```/g, '').trim();
      if (stripped && stripped.length >= 30 && stripped.length <= 1500 && !stripped.includes('\n\n')) {
        return res.json({ success: true, characterDescription: stripped });
      }
      return res.status(502).json({ success: false, error: 'LLM did not return parseable JSON', raw: raw.slice(0, 500) });
    }
    res.json({ success: true, characterDescription: String(parsed.characterDescription).trim() });
  } catch (e) {
    console.error('[voice-design/analyze-character]', e.message);
    res.status(502).json({ success: false, error: e.message });
  }
});

// ── POST /api/audio/voice-design/derive-voice ────────────────────────────────
// Step 2 of the popup voice flow.
// Body: { characterDescription, llmModel? }
// Takes a character description (text only, no image) and writes an ElevenLabs
// Voice Design prompt + a 4-word voice summary. Called by Gen voice when the
// user hasn't manually filled the voice description field, OR by an explicit
// "convert to voice" action.
// Gender is NEVER side-channelled — it MUST already be encoded as the literal
// first word ("Male, …" or "Female, …") of the character description by
// /analyze-character. Voice gender derives strictly from that first word.
// Response: { success, voiceDescription, fourWordSummary }
router.post('/audio/voice-design/derive-voice', async (req, res) => {
  const { characterDescription = '', llmModel } = req.body || {};
  const charDesc = String(characterDescription).trim();
  if (charDesc.length < 20) {
    return res.status(400).json({ success: false, error: 'characterDescription too short (min 20 chars)' });
  }

  const sys = `You convert a character description into an ElevenLabs Voice Design prompt.

GENDER RULE (NON-NEGOTIABLE):
The character description starts with "Male, …" or "Female, …". The voice MUST match that gender exactly. Do not invent a different gender, do not soften, do not gender-swap. If the first word is "Male" the voice is unambiguously male; if "Female" the voice is unambiguously female.

Rules for the voice description:
- 20-100 words, single paragraph, no line breaks.
- Describe how the person SOUNDS, not how they look. Cover: age range, gender (from the first word — see above), accent/nationality, tone (warm/cold/gravelly/clear/breathy etc.), pitch (low/mid/high), speaking pace, energy level, recommended use case (UGC ad, narration, etc.).
- English only.

Also produce a 4-word summary capturing the most distinctive voice traits (e.g. "warm low gravelly mature", "bright young confident female"). Lowercase, no punctuation. The summary must also be gender-consistent with the description.

OUTPUT FORMAT (strict JSON, no markdown, no prose):
{"voiceDescription":"...","fourWordSummary":"..."}`;

  const userMsg = `CHARACTER DESCRIPTION:\n${charDesc}\n\nWrite the JSON now. Remember: the voice gender MUST match the first word of the description above.`;

  try {
    const raw = await callAI(
      [
        { role: 'system', content: sys },
        { role: 'user',   content: userMsg },
      ],
      {
        useOpenRouter:   true,
        openRouterModel: llmModel || 'google/gemini-3.5-flash',
        timeout:         45000,
      }
    );
    let parsed = null;
    const jsonMatch = raw.match(/\{[\s\S]*?"voiceDescription"[\s\S]*?\}/);
    if (jsonMatch) { try { parsed = JSON.parse(jsonMatch[0]); } catch {} }
    if (!parsed || !parsed.voiceDescription) {
      return res.status(502).json({ success: false, error: 'LLM did not return parseable JSON', raw: raw.slice(0, 500) });
    }
    res.json({
      success: true,
      voiceDescription: String(parsed.voiceDescription).trim(),
      fourWordSummary:  String(parsed.fourWordSummary || '').trim().toLowerCase().slice(0, 80),
    });
  } catch (e) {
    console.error('[voice-design/derive-voice]', e.message);
    res.status(502).json({ success: false, error: e.message });
  }
});

// ── POST /api/audio/voice-design/previews ────────────────────────────────────
// Body: { voiceDescription, sampleText? }
// Calls ElevenLabs /v1/text-to-voice/create-previews → returns 3 previews.
// Each preview is saved locally under public/voice-previews/preview_<previewId>.mp3
// so the frontend can play it without re-fetching base64 over the wire.
// Response: { success, previews: [{ previewId, audioPath, generatedVoiceId, mediaType }] }
const _voiceDesignSampleText =
  "Hey there. I'm here to talk through this in my own voice — natural, easy, and just the way I'd say it in a real moment. " +
  "Listen for the tone, the pace, the colour. Does it feel right? That's what we're checking.";

router.post('/audio/voice-design/previews', async (req, res) => {
  const { voiceDescription, sampleText } = req.body || {};
  if (!voiceDescription || voiceDescription.length < 20) {
    return res.status(400).json({ success: false, error: 'voiceDescription must be at least 20 chars' });
  }
  const apiKey = _getElevenLabsApiKey();
  if (!apiKey) return res.status(400).json({ success: false, error: 'ElevenLabs API key not set' });

  const text = (sampleText && String(sampleText).length >= 100)
    ? String(sampleText).slice(0, 1000)
    : _voiceDesignSampleText;

  try {
    const r = await axios.post(
      `${EL_API_BASE}/text-to-voice/create-previews`,
      { voice_description: voiceDescription, text },
      { headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' }, timeout: 90000 }
    );
    const previews = (r.data?.previews || []).map((p, i) => {
      const previewId   = p.generated_voice_id || `pv_${Date.now()}_${i}`;
      const filename    = `preview_${previewId}.mp3`;
      const destFile    = path.join(VOICE_PREVIEWS_DIR, filename);
      try {
        const audioBuf = Buffer.from(p.audio_base_64 || p.audio_base64 || '', 'base64');
        if (audioBuf.length) fs.writeFileSync(destFile, audioBuf);
      } catch (e) {
        console.warn('[voice-design/previews] write failed:', e.message);
      }
      return {
        previewId,
        generatedVoiceId: p.generated_voice_id,
        audioPath: `/voice-previews/${filename}`,
        mediaType: p.media_type || 'audio/mpeg',
      };
    });
    res.json({ success: true, previews });
  } catch (e) {
    const msg = e.response?.data?.detail?.message || e.response?.data?.detail || e.message;
    console.error('[voice-design/previews]', msg);
    res.status(502).json({ success: false, error: typeof msg === 'string' ? msg : JSON.stringify(msg).slice(0, 300) });
  }
});

// ── POST /api/audio/voice-design/save ────────────────────────────────────────
// Body: { selections: [{ generatedVoiceId, name, gender, desc, characterId? }], voiceDescription }
// For each selection: calls ElevenLabs /v1/text-to-voice/create-voice-from-preview
// to convert the temporary preview into a permanent voice, then appends to
// data/custom-voices.json. Returns the updated catalog.
router.post('/audio/voice-design/save', async (req, res) => {
  const { selections = [], voiceDescription = '' } = req.body || {};
  if (!Array.isArray(selections) || !selections.length) {
    return res.status(400).json({ success: false, error: 'selections array required' });
  }
  const apiKey = _getElevenLabsApiKey();
  if (!apiKey) return res.status(400).json({ success: false, error: 'ElevenLabs API key not set' });

  const list = _loadCustomVoices();
  const added = [];
  const errors = [];
  for (const sel of selections) {
    const { generatedVoiceId, name, gender = '', desc = '', characterId = null } = sel || {};
    if (!generatedVoiceId || !name) continue;
    try {
      const r = await axios.post(
        `${EL_API_BASE}/text-to-voice/create-voice-from-preview`,
        {
          voice_name:        String(name).slice(0, 100),
          voice_description: voiceDescription.slice(0, 1000) || String(name).slice(0, 100),
          generated_voice_id: generatedVoiceId,
        },
        { headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' }, timeout: 60000 }
      );
      const voiceId = r.data?.voice_id;
      if (!voiceId) continue;
      const entry = {
        id:          `vd_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        voiceId,
        name:        String(name).slice(0, 100),
        gender:      gender === 'm' ? 'm' : 'f',
        desc:        String(desc).slice(0, 200),
        createdAt:   new Date().toISOString(),
        characterId: characterId != null ? characterId : null,
      };
      list.push(entry);
      added.push(entry);
    } catch (e) {
      const msg = e.response?.data?.detail?.message || e.response?.data?.detail || e.message;
      const m = typeof msg === 'string' ? msg : JSON.stringify(msg).slice(0, 300);
      errors.push(m);
      console.warn('[voice-design/save] one preview failed:', m);
    }
  }
  if (added.length) _saveCustomVoices(list);
  // Surface the real ElevenLabs error when NOTHING was saved (e.g. "voice_limit_reached:
  // You have reached your maximum amount of custom voices (30/30)") instead of letting the
  // client show an opaque "Save failed".
  if (!added.length) {
    return res.status(502).json({ success: false, error: errors[0] || 'Voice save failed', errors });
  }
  res.json({ success: true, added, voices: list, errors });
});

// ── POST /api/audio/custom-voices/prune ──────────────────────────────────────
// Scans data/obrazy.json (the source of truth for character→voice bindings,
// written by routes/userdata.js POST /userdata/obrazy from the frontend),
// collects every referenced voice name, and removes orphan entries from
// custom-voices.json. Returns { removed, kept }.
router.post('/audio/custom-voices/prune', (_req, res) => {
  try {
    const obrazyFile = path.join(DATA_DIR, 'obrazy.json');
    let obrazyList = [];
    try { obrazyList = JSON.parse(fs.readFileSync(obrazyFile, 'utf8')); } catch {}
    const used = new Set();
    for (const o of obrazyList) {
      if (o && o.voice) used.add(String(o.voice));
    }
    const before = _loadCustomVoices();
    const kept   = before.filter(v => used.has(v.name) || used.has(v.voiceId) || used.has(v.id));
    const removed = before.length - kept.length;
    if (removed > 0) _saveCustomVoices(kept);
    res.json({ success: true, removed, kept: kept.length, voices: kept });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// POST /api/audio/upload-file  — multipart: file (audio binary), name? (string)
router.post('/audio/upload-file', _audioUpload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, error: 'Нет файла' });
  const origBase = path.basename(req.file.originalname, path.extname(req.file.originalname));
  const name     = ((req.body && req.body.name) || origBase || 'track').slice(0, 60);
  const webPath  = `/uploads/audio/${req.file.filename}`;
  res.json({ success: true, webPath, name, filename: req.file.filename });
});

// ── POST /api/audio/tts ───────────────────────────────────────────────────────
// Body: { text, voice, ttsParams?, model? }
// model='elevenlabs' → direct ElevenLabs API (synchronous, returns audioPath)
// model='elevenlabs/text-to-speech-turbo-2-5' → kie.ai (returns taskId for polling)
router.post('/audio/tts', async (req, res) => {
  const { text, voice, ttsParams = {}, model: reqModel } = req.body;
  const ttsModel = reqModel || 'elevenlabs';
  if (!text) return res.status(400).json({ success: false, error: 'Нет текста' });

  try {
    const requestedVoice = (voice || 'Rachel').trim();

    // ── Direct ElevenLabs API ─────────────────────────────────────────────────
    if (ttsModel === 'elevenlabs') {
      const audioPath = await _elevenLabsTts(text, requestedVoice, ttsParams);
      return res.json({ success: true, audioPath });
    }

    // ── kie.ai path (turbo-2-5 / dialogue-v3) ────────────────────────────────
    const isDialogueV3 = ttsModel === 'elevenlabs/text-to-dialogue-v3';

    async function _createTtsTask(voiceName) {
      const input = isDialogueV3
        ? { text, voice: voiceName }
        : {
            text,
            voice:            voiceName,
            stability:        ttsParams.stability        ?? 0.5,
            similarity_boost: ttsParams.similarity_boost ?? 0.75,
            style:            ttsParams.style            ?? 0,
            speed:            ttsParams.speed            ?? 1,
          };
      const taskRes = await axios.post(
        `${KIE_BASE}/api/v1/jobs/createTask`,
        { model: ttsModel, input },
        { headers: kieHeaders(), timeout: 30000 }
      );
      const code = taskRes.data?.code;
      const msg  = taskRes.data?.msg || '';
      console.log(`[audio/tts] model=${ttsModel} voice=${voiceName} → code=${code} msg="${msg}"`);
      if (msg.toLowerCase().includes('not within the range') || code === 500) return null;
      return taskRes.data?.data?.taskId || null;
    }

    let taskId = await _createTtsTask(requestedVoice);
    let usedVoice = requestedVoice;
    if (!taskId && requestedVoice !== 'Rachel') {
      console.warn(`[audio/tts] voice "${requestedVoice}" rejected, falling back to Rachel`);
      usedVoice = 'Rachel';
      taskId = await _createTtsTask('Rachel');
    }
    if (!taskId) return res.status(502).json({ success: false, error: `Голос "${requestedVoice}" не поддерживается kie.ai` });
    res.json({ success: true, taskId, usedVoice });
  } catch (err) {
    console.error('[audio/tts]', err.response?.data || err.message);
    res.status(502).json({ success: false, error: err.response?.data?.msg || err.message });
  }
});

// ── POST /api/audio/tts-preview ──────────────────────────────────────────────
// Body: { voice, ttsParams?, model? }
// For model='elevenlabs': calls ElevenLabs API directly (sync).
// For kie.ai models: submits task, polls until done.
// Returns { success, audioPath }.
router.post('/audio/tts-preview', async (req, res) => {
  const { voice, ttsParams = {}, model: reqModel, text } = req.body;
  const ttsModel    = reqModel || 'elevenlabs';
  // Accept a custom preview text (gen-settings popup passes the first sentence
  // of the active scenario so the user hears real script content). Fall back
  // to the legacy generic phrase when not provided.
  const previewText = (typeof text === 'string' && text.trim()) ? text.trim().slice(0, 240) : 'Hello! This is a voice preview.';

  try {
    const requestedVoice = (voice || 'Rachel').trim();

    // ── Direct ElevenLabs ─────────────────────────────────────────────────────
    if (ttsModel === 'elevenlabs') {
      const audioPath = await _elevenLabsTts(previewText, requestedVoice, ttsParams);
      return res.json({ success: true, audioPath });
    }

    // ── kie.ai path ───────────────────────────────────────────────────────────
    const isDialogueV3 = ttsModel === 'elevenlabs/text-to-dialogue-v3';

    async function _createPreviewTask(voiceName) {
      const input = isDialogueV3
        ? { text: previewText, voice: voiceName }
        : {
            text: previewText,
            voice:            voiceName,
            stability:        ttsParams.stability        ?? 0.5,
            similarity_boost: ttsParams.similarity_boost ?? 0.75,
            style:            ttsParams.style            ?? 0,
            speed:            ttsParams.speed            ?? 1,
          };
      const taskRes = await axios.post(
        `${KIE_BASE}/api/v1/jobs/createTask`,
        { model: ttsModel, input },
        { headers: kieHeaders(), timeout: 30000 }
      );
      const code = taskRes.data?.code;
      const msg  = taskRes.data?.msg || '';
      if (msg.toLowerCase().includes('not within the range') || code === 500) return null;
      return taskRes.data?.data?.taskId || null;
    }

    let usedVoice = requestedVoice;
    let taskId = await _createPreviewTask(requestedVoice);
    if (!taskId && requestedVoice !== 'Rachel') {
      console.warn(`[audio/tts-preview] voice "${requestedVoice}" rejected, falling back to Rachel`);
      usedVoice = 'Rachel';
      taskId = await _createPreviewTask('Rachel');
    }
    if (!taskId) {
      return res.status(502).json({ success: false, error: `Голос "${requestedVoice}" не поддерживается kie.ai` });
    }

    // Poll until done (max 90 s)
    const deadline = Date.now() + 90_000;
    let audioUrl = null;
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 2500));
      const statusRes = await axios.get(
        `${KIE_BASE}/api/v1/jobs/recordInfo`,
        { params: { taskId }, headers: kieHeaders(), timeout: 15000 }
      );
      const data = statusRes.data?.data;
      if (data?.state === 'success') {
        try {
          const result = JSON.parse(data.resultJson);
          audioUrl = result.resultUrls?.[0] || result.audio_url || result.url || null;
        } catch {}
        break;
      }
      if (data?.state === 'failed') {
        return res.status(502).json({ success: false, error: data.failMsg || 'TTS preview failed' });
      }
    }
    if (!audioUrl) return res.status(502).json({ success: false, error: 'Таймаут генерации предпросмотра' });

    const filename  = `tts_preview_${Date.now()}.mp3`;
    const destPath  = path.join(UPLOADS_DIR, filename);
    const audioRes  = await axios({ url: audioUrl, method: 'GET', responseType: 'arraybuffer', timeout: 30000 });
    fs.writeFileSync(destPath, Buffer.from(audioRes.data));
    await stripSilence(destPath);
    res.json({ success: true, audioPath: `/uploads/${filename}` });
  } catch (err) {
    console.error('[audio/tts-preview]', err.response?.data || err.message);
    res.status(502).json({ success: false, error: err.response?.data?.msg || err.message });
  }
});

// ── GET /api/audio/tts/status/:taskId ────────────────────────────────────────
// Polls the TTS task; on success downloads the mp3 to uploads/ and returns { audioPath }
router.get('/audio/tts/status/:taskId', async (req, res) => {
  const { taskId } = req.params;
  try {
    const statusRes = await axios.get(
      `${KIE_BASE}/api/v1/jobs/recordInfo`,
      { params: { taskId }, headers: kieHeaders(), timeout: 15000 }
    );
    const data  = statusRes.data?.data;
    const state = data?.state;

    if (state === 'success') {
      let audioUrl = null;
      try {
        const result = JSON.parse(data.resultJson);
        audioUrl = result.resultUrls?.[0] || result.audio_url || result.url || null;
      } catch {}
      if (!audioUrl) return res.json({ success: true, state: 'failed', error: 'No audio URL in result' });

      // Download mp3 to uploads/
      const filename = `tts_${taskId}_${Date.now()}.mp3`;
      const destPath = path.join(UPLOADS_DIR, filename);
      const audioRes = await axios({ url: audioUrl, method: 'GET', responseType: 'arraybuffer', timeout: 30000 });
      fs.writeFileSync(destPath, Buffer.from(audioRes.data));
      await stripSilence(destPath);
      return res.json({ success: true, state: 'success', audioPath: `/uploads/${filename}` });
    }

    if (state === 'failed') {
      return res.json({ success: true, state: 'failed', error: data?.failMsg || 'TTS failed' });
    }

    return res.json({ success: true, state: state || 'pending' });
  } catch (err) {
    console.error('[audio/tts/status]', err.response?.data || err.message);
    res.status(502).json({ success: false, error: err.message });
  }
});

// ── POST /api/upload-public ───────────────────────────────────────────────────
// Body: { imagePath }  →  Returns { url } — uploads local file to public host
router.post('/upload-public', async (req, res) => {
  const { imagePath } = req.body;
  if (!imagePath) return res.status(400).json({ success: false, error: 'Нет imagePath' });
  const absPath = path.join(__dirname, '..', imagePath.replace(/^\//, ''));
  if (!fs.existsSync(absPath)) return res.status(400).json({ success: false, error: 'Файл не найден: ' + imagePath });
  try {
    const url = await uploadToPublicHost(fs.readFileSync(absPath));
    res.json({ success: true, url });
  } catch (err) {
    console.error('[upload-public]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /api/audio/avatar ────────────────────────────────────────────────────
// Body: { imageUrl | imagePath, audioPath, prompt }
// Accepts pre-uploaded imageUrl (skips upload) or imagePath (uploads internally)
router.post('/audio/avatar', async (req, res) => {
  const { imagePath, imageUrl: directImageUrl, audioPath, prompt, videoParams = {}, model: modelRaw } = req.body;
  if ((!imagePath && !directImageUrl) || !audioPath) return res.status(400).json({ success: false, error: 'Нет imageUrl/imagePath или audioPath' });
  // Accept 'kling/ai-avatar-standard' (default) or 'kling/ai-avatar-pro'.
  const model = (modelRaw === 'kling/ai-avatar-pro') ? 'kling/ai-avatar-pro' : 'kling/ai-avatar-standard';
  try {
    const audioBuf = fs.readFileSync(path.join(__dirname, '..', audioPath.replace(/^\//, '')));
    // Talking-head avatar: always re-upload so kie.ai never gets a stale
    // tmpfiles.org URL ("Image fetch failed" / "Audio fetch failed" errors).
    // Explicit ext per buffer type — without it the upload helper defaults to
    // 'jpg' for everything and kie.ai's audio decoder rejects an mp3 served
    // with .jpg extension / image content-type.
    let imageUrl;
    if (directImageUrl) {
      imageUrl = directImageUrl;
    } else {
      imageUrl = await uploadToPublicHost(
        fs.readFileSync(path.join(__dirname, '..', imagePath.replace(/^\//, ''))),
        { forceFresh: true, ext: 'jpg' }
      );
    }
    const audioUrl = await uploadToPublicHost(audioBuf, { forceFresh: true, ext: 'mp3' });
    const taskRes = await axios.post(
      `${KIE_BASE}/api/v1/jobs/createTask`,
      {
        model,
        input: {
          image_url: imageUrl,
          audio_url: audioUrl,
          prompt: prompt || videoParams.prompt || 'Natural speaking motion with subtle head movement',
        },
      },
      { headers: kieHeaders(), timeout: 30000 }
    );
    const taskId = taskRes.data?.data?.taskId;
    if (!taskId) return res.status(502).json({ success: false, error: 'kie.ai не вернул taskId', detail: taskRes.data });
    res.json({ success: true, taskId, model });
  } catch (err) {
    console.error('[audio/avatar]', err.response?.data || err.message);
    res.status(502).json({ success: false, error: err.response?.data?.msg || err.message });
  }
});

// ── POST /api/audio/avatar-replicate ─────────────────────────────────────────
// Body: { imagePath, audioPath, prompt, params? }
// Submits a prunaai/p-video-avatar prediction. Always uploads image+audio
// fresh so a stale tmpfiles URL doesn't break the run. Returns { taskId } in
// the standard `repl:<id>` form — poll via GET /api/audio/avatar/status/...
// which now dispatches by prefix.
router.post('/audio/avatar-replicate', async (req, res) => {
  const { imagePath, imageUrl: directImageUrl, audioPath, prompt, params = {} } = req.body;
  if ((!imagePath && !directImageUrl) || !audioPath) {
    return res.status(400).json({ success: false, error: 'Нет imagePath или audioPath' });
  }
  try {
    let imageUrl;
    if (directImageUrl) {
      imageUrl = directImageUrl;
    } else {
      imageUrl = await uploadToPublicHost(
        fs.readFileSync(path.join(__dirname, '..', imagePath.replace(/^\//, ''))),
        { forceFresh: true, ext: 'jpg' }
      );
    }
    const audioBuf = fs.readFileSync(path.join(__dirname, '..', audioPath.replace(/^\//, '')));
    const audioUrl = await uploadToPublicHost(audioBuf, { forceFresh: true, ext: 'mp3' });

    // The motion prompt becomes p-video-avatar's video_prompt. If empty —
    // model has its own default ("The person is talking.").
    const callParams = { ...params };
    if (prompt && prompt.trim()) callParams.video_prompt = prompt.trim();

    const taskId = await createPVideoAvatarTask(imageUrl, audioUrl, callParams);
    res.json({ success: true, taskId, model: 'prunaai/p-video-avatar' });
  } catch (err) {
    console.error('[audio/avatar-replicate]', err.response?.data || err.message);
    res.status(502).json({ success: false, error: err.response?.data?.msg || err.message });
  }
});

// ── GET /api/audio/avatar/status/:taskId ──────────────────────────────────────
// Dispatches by taskId prefix:
//   repl:<id> → Replicate (p-video-avatar). Output is the mp4 URL in `output`.
//   anything else → kie.ai recordInfo (Kling).
// Same response shape from both providers: { state, videoPath?, error? }.
router.get('/audio/avatar/status/:taskId', async (req, res) => {
  const { taskId } = req.params;

  // ── Replicate path ──────────────────────────────────────────────────────────
  if (typeof taskId === 'string' && taskId.startsWith('repl:')) {
    const predictionId = taskId.slice(5);
    const apiKey = (function () {
      try { return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'))?.replicateApiKey || ''; } catch { return ''; }
    })();
    if (!apiKey) return res.json({ success: true, state: 'failed', error: 'Replicate token not configured' });
    try {
      const pollRes = await axios.get(`https://api.replicate.com/v1/predictions/${predictionId}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        timeout: 15000,
      });
      const pred  = pollRes.data;
      const state = pred?.status;
      if (state === 'failed' || state === 'canceled') {
        return res.json({ success: true, state: 'failed', error: pred?.error || state });
      }
      if (state !== 'succeeded') {
        return res.json({ success: true, state: 'pending' });
      }
      // Extract mp4 URL from output (string or array or file-object).
      const _extract = (out) => {
        if (!out) return null;
        if (typeof out === 'string') return out;
        if (Array.isArray(out)) { for (const it of out) { const u = _extract(it); if (u) return u; } return null; }
        if (typeof out === 'object') return out.url || out.video || out.video_url || null;
        return null;
      };
      const remoteUrl = _extract(pred.output);
      if (!remoteUrl) return res.json({ success: true, state: 'failed', error: 'Replicate: empty output' });
      const filename = `avatar_repl${predictionId.slice(-10)}_${Date.now()}.mp4`;
      const destPath = path.join(UPLOADS_DIR, filename);
      const videoRes = await axios({ url: remoteUrl, method: 'GET', responseType: 'arraybuffer', timeout: 120000 });
      fs.writeFileSync(destPath, Buffer.from(videoRes.data));
      // Normalize to H.264 main + yuv420p + AAC + faststart so the browser
      // <video> tag plays it and the ffmpeg concat demuxer can merge it
      // with kie.ai-sourced clips without re-encode mismatches.
      try { await normalizeVideoForBrowser(destPath); }
      catch (e) { console.warn('[audio/avatar/status replicate] normalize failed:', e.message); }
      return res.json({ success: true, state: 'success', videoPath: `/uploads/${filename}` });
    } catch (err) {
      console.error('[audio/avatar/status replicate]', err.response?.data || err.message);
      return res.status(502).json({ success: false, error: err.message });
    }
  }

  // ── kie.ai path (existing behaviour) ────────────────────────────────────────
  try {
    const statusRes = await axios.get(
      `${KIE_BASE}/api/v1/jobs/recordInfo`,
      { params: { taskId }, headers: kieHeaders(), timeout: 15000 }
    );
    const data  = statusRes.data?.data;
    const state = data?.state;

    if (state === 'success') {
      let videoUrl = null;
      try {
        const result = JSON.parse(data.resultJson);
        videoUrl = result.resultUrls?.[0] || result.video_url || result.url || null;
      } catch {}
      if (!videoUrl) return res.json({ success: true, state: 'failed', error: 'No video URL in result' });

      const filename = `avatar_${taskId}_${Date.now()}.mp4`;
      const destPath = path.join(UPLOADS_DIR, filename);
      const videoRes = await axios({ url: videoUrl, method: 'GET', responseType: 'arraybuffer', timeout: 60000 });
      fs.writeFileSync(destPath, Buffer.from(videoRes.data));
      return res.json({ success: true, state: 'success', videoPath: `/uploads/${filename}` });
    }

    if (state === 'failed') {
      return res.json({ success: true, state: 'failed', error: data?.failMsg || 'Avatar generation failed' });
    }

    return res.json({ success: true, state: state || 'pending' });
  } catch (err) {
    console.error('[audio/avatar/status]', err.response?.data || err.message);
    res.status(502).json({ success: false, error: err.message });
  }
});

// ── POST /api/audio/avatar-prompt ─────────────────────────────────────────────
// Body: { imageUrl | imagePath, text, detailImageUrl? | detailImagePath?,
//         interactionText?, motionHint?, targetModel? }
// targetModel switches the system prompt:
//   - 'prunaai/p-video-avatar' → minimalist motion prompt (low-motion model).
//   - anything else (kling/* etc) → rich motion prompt (current behaviour).
router.post('/audio/avatar-prompt', async (req, res) => {
  const { imagePath, imageUrl: directImageUrl, text, detailImagePath, detailImageUrl: directDetailUrl, interactionText, motionHint, targetModel } = req.body;
  if ((!imagePath && !directImageUrl) || !text) return res.status(400).json({ success: false, error: 'Нет imageUrl/imagePath или text' });

  try {
    // Talking-head motion-prompt: always re-upload so OpenRouter / kie.ai
    // never receive a stale (already-expired) tmpfiles.org / uguu.se URL,
    // which manifests as "Received 404 status code when fetching image" and
    // forces the slow OpenRouter → kie.ai cascade fallback to kick in.
    let imageUrl;
    if (directImageUrl) {
      imageUrl = directImageUrl;
    } else {
      const filePath = path.join(__dirname, '..', imagePath.replace(/^\//, ''));
      if (!fs.existsSync(filePath)) return res.status(400).json({ success: false, error: 'Изображение не найдено' });
      imageUrl = await uploadToPublicHost(fs.readFileSync(filePath), { forceFresh: true });
    }

    let detailImageUrl = directDetailUrl || null;
    if (!detailImageUrl && detailImagePath) {
      const detailFilePath = path.join(__dirname, '..', detailImagePath.replace(/^\//, ''));
      if (fs.existsSync(detailFilePath)) {
        detailImageUrl = await uploadToPublicHost(fs.readFileSync(detailFilePath), { forceFresh: true });
      }
    }
    const hasDetail = !!detailImageUrl;
    const isMinimalist = (targetModel === 'prunaai/p-video-avatar');

    const interactionSection = interactionText
      ? `\n\n━━ USER-SPECIFIED INTERACTION STYLE (HIGHEST PRIORITY) ━━\nThe user has explicitly described how the character should interact with the item: "${interactionText}".\nThis overrides the default phrase-by-phrase suggestions below. Build the entire motion sequence around this interaction.`
      : '';
    const motionSection = motionHint
      ? `\n\n━━ USER-SPECIFIED MOVEMENT STYLE ━━\n"${motionHint}"\nUse this as the dominant movement character throughout.`
      : '';

    const systemPrompt = isMinimalist
      ? // ── MINIMALIST prompt for prunaai/p-video-avatar ────────────────────
`You are a motion director writing a RESTRAINED animation prompt for prunaai/p-video-avatar, a low-motion talking-head model.
You are given: (1) CHARACTER IMAGE — study their appearance, posture, and background. ${hasDetail ? '(2) PRODUCT IMAGE — context only; the character does NOT interact with the product in this minimalist version.' : ''}

The character will lip-sync to an audio file (provided separately). The audio drives the speech — you describe ONLY restrained physical motion. The script line is: """${text}""" — DO NOT quote it; reference only abstract tone (e.g. "calm tone", "thoughtful delivery").${interactionSection}${motionSection}

OUTPUT: Write ONE English animation prompt, MAX 80 words. Respond with ONLY the prompt text — no explanations, no labels, no quotes.

━━ ABSOLUTE MINIMALIST RULES (keep all motion low) ━━
- Steady eye contact with the camera 90%+ of the clip. No looking away.
- Only natural micro head sway during speech — NO nods, NO tilts, NO turns, NO head shakes.
- Hands stay out of frame. NO hand gestures, NO pointing, NO product handling.
- Calm relaxed shoulders, NO body shifts, NO leaning, NO walking, NO turning.
- Subtle facial micro-expressions that sync gently with speech — NO wide smiles, NO raised brows, NO exaggerated reactions.
- Background static. NO camera movement (no pan/tilt/zoom/dolly).
- Photo-realistic, naturalistic, restrained. The viewer should feel calm, not energised.`
      : // ── MODERATE prompt for kie.ai Kling (locked camera, restrained
        //    expression, contained gestures — but still allowing product
        //    interaction when a detail image is present) ─────────────────────
`You are a motion director writing an animation prompt for Kling AI Avatar.
You are given: (1) CHARACTER IMAGE — study their appearance, posture, and background environment. ${hasDetail ? '(2) PRODUCT IMAGE — the item the character holds/interacts with during the video.' : ''}

The character will lip-sync to an audio file (provided separately). The audio drives the speech automatically — you describe ONLY motion, gestures, and camera work.

━━ ABSOLUTE RULE: NEVER QUOTE THE SCRIPT ━━
The script line is: """${text}"""
DO NOT include quoted words from this script in your output. DO NOT transcribe phrases. DO NOT write specific spoken text in quotation marks. Reference the script only via abstract tone descriptions like "contemplative tone", "calm delivery", "thoughtful pause" — NEVER the exact words. The audio file conveys the speech via lip-sync; your prompt must describe only physical motion.${interactionSection}${motionSection}

OUTPUT: Write ONE English animation prompt, max 120 words. Describe the character's physical motion, hand gestures, eye contact, head movements, posture, and background. Respond with ONLY the prompt text — no explanations, no labels, no quotation marks.

━━ MOTION RULES (MODERATE EXPRESSION — never theatrical, never overacted) ━━

1. CAMERA LOCKED — tripod-mounted static shot. ABSOLUTELY NO pan, NO tilt, NO zoom, NO dolly, NO push-in/pull-out, NO handheld motion, NO rack focus. The frame stays fixed for the entire clip.

2. CAMERA EYE CONTACT (75% rule) — character looks directly into the camera for 75%+ of the video. ${hasDetail
  ? 'A brief glance down at the product (and back) counts as the allowed look-away time.'
  : 'A brief sideways glance during a thoughtful pause counts as the allowed look-away time.'}

3. ${hasDetail
  ? `SECONDARY HAND — LIGHT PRODUCT INTERACTION (the dominant hand holds the container/item):
   ━ CRITICAL: the item itself must stay visually stable throughout — NO rotating, NO spinning,
     NO flipping, NO passing between hands. Any movement of the item must be minimal and slow.
     This prevents rendering artifacts (logo distortion, package morphing, texture tears).
   Allowed actions (pick 1–2 only):
   • Points to the item with one finger
   • Gently taps the packaging
   • Slightly lifts the item toward the camera, then settles it back to a steady position
   • Brief glance down at the item, then returns eye contact
   Refer to the item generically ("the container", "the product", "the item") — DO NOT name the brand or describe any visible markings on the packaging.`
  : `HANDS — NO PRODUCT
   No item in hands. MODERATE hand gestures only — 1-2 small, contained gestures total. Gestures stay WITHIN shoulder width and near the chest (open-palm, light shrug, hand near collarbone, brief index-finger point). NO wide arm swings, NO over-the-shoulder reaches, NO high-energy pointing, NO sweeping gestures. Do NOT mention any product, prop, or object.`}

4. HEAD MOVEMENT — small natural head sway in sync with speech rhythm. NO rapid nodding, NO head shaking, NO full turns. Slight occasional micro-tilts only (one or two across the whole clip).

5. BACKGROUND — the ENVIRONMENT may have subtle motion (leaf sway, soft light shift, distant passing car). The CAMERA still does NOT move. Plain studio → omit background motion entirely.

6. ABSTRACT MOTION SEGMENTS (2–3 segments, NO QUOTED WORDS):
   ${hasDetail ? '• Segment 1: opening tone (e.g. contemplative), small reveal of the item' : '• Segment 1: opening tone (e.g. relaxed confident), face camera'}
   • Segment 2: middle tone (e.g. measured), ONE moderate gesture within shoulder width
   • Segment 3: closing tone (e.g. settled), small natural head settle, return to steady eye contact

7. STYLE — moderate, natural, restrained. No exaggerated facial expressions, no theatrical smiles, no raised brows, no dramatic reactions, no acting. Photo-realistic cinematic look with the energy of a real person speaking on camera, not a performer.`;

    const contentParts = [
      { type: 'text',      text: systemPrompt },
      { type: 'image_url', image_url: { url: imageUrl } },
    ];
    if (hasDetail) {
      contentParts.push({ type: 'image_url', image_url: { url: detailImageUrl } });
    }

    const prompt = await callAIVisionWithFallback([{ role: 'user', content: contentParts }], { timeout: 40000, useOpenRouter: true });

    // AI/LLM may return an error string as the body (e.g. "Error in message stream"
    // from SSE failures) without throwing. Detect and surface as failure so the
    // frontend retry path triggers instead of caching a broken prompt.
    const _t = (prompt || '').trim();
    const _looksLikeError =
      _t.length < 30 ||
      /^error\b/i.test(_t) ||
      /error in message stream/i.test(_t) ||
      /^\{.*"error".*\}$/.test(_t);
    if (_looksLikeError) {
      console.warn('[audio/avatar-prompt] AI returned error-like body, returning failure for client retry:', _t.slice(0, 80));
      return res.status(502).json({ success: false, error: 'AI returned invalid prompt: ' + _t.slice(0, 80) });
    }

    res.json({ success: true, prompt });
  } catch (err) {
    console.error('[audio/avatar-prompt]', err.response?.data || err.message);
    res.status(502).json({ success: false, error: err.response?.data?.msg || err.message });
  }
});

// ── POST /api/audio/translate-pose ───────────────────────────────────────────
// Body: { text } — arbitrary text (Russian or mixed)
// Returns { success, result } — English Kling AI motion prompt, beautified
router.post('/audio/translate-pose', async (req, res) => {
  const { text } = req.body;
  if (!text || !text.trim()) return res.status(400).json({ success: false, error: 'Нет текста' });
  try {
    const result = await callAI([{
      role: 'user',
      content: `Translate and enhance the following avatar motion description into a professional English animation prompt for Kling AI Avatar Pro (max 80 words, natural UGC style, no bullet points, single paragraph).
Input: "${text.trim()}"
Output ONLY the final English prompt text — no labels, no quotes, no explanation.`,
    }], { timeout: 15000, useOpenRouter: true });
    res.json({ success: true, result: result.trim() });
  } catch (err) {
    console.error('[audio/translate-pose]', err.message);
    res.status(502).json({ success: false, error: err.message });
  }
});

// ── POST /api/video/grok-text ─────────────────────────────────────────────────
// Body: { prompt, duration?, resolution?, aspectRatio?, mode?, birolMode? }
// Submits a Grok text-to-video task and returns { taskId }.
// When birolMode=true, a short visual-punch clause is appended so the clip
// reads as a scroll-stopping b-roll (bright, contrasty, vivid, sharp).
// Default behaviour (birolMode=false) is unchanged so other callers
// (talking-head, refs/tempo, etc.) get the raw user prompt untouched.
const BIROLL_VISUAL_BOOST =
  ' Bright punchy contrast, vivid saturated colours, sharp eye-catching composition, scroll-stopping energy, dynamic vibrant lighting.';
router.post('/video/grok-text', async (req, res) => {
  const { prompt, duration = '6', resolution = '480p', aspectRatio = '16:9', mode = 'normal', birolMode = false } = req.body;
  if (!prompt) return res.status(400).json({ success: false, error: 'Нет промпта' });
  const finalPrompt = birolMode
    ? (String(prompt).trim().replace(/\s+$/, '').replace(/[.;,]+$/, '') + '.' + BIROLL_VISUAL_BOOST)
    : prompt;
  try {
    // Replicate xai/grok-imagine-video, text-to-video (no image). Returns repl:<id>.
    const taskId = await createGrokImagineVideoTask(finalPrompt, null, {
      duration, aspect_ratio: aspectRatio, resolution, mode,
    });
    res.json({ success: true, taskId });
  } catch (err) {
    const detail = err.response?.data?.detail || err.response?.data?.title || err.response?.data?.msg || err.message;
    console.error('[video/grok-text] ERROR:', JSON.stringify(err.response?.data || err.message));
    res.status(502).json({ success: false, error: detail });
  }
});

// ── GET /api/video/grok-text/status/:taskId ───────────────────────────────────
// Defensive: kie.ai returns failures under several different field names and
// state strings depending on the upstream model. We check `state` AND `status`,
// match common failure synonyms (failed/error/canceled/rejected/timeout etc.)
// AND any presence of failMsg/errorMessage. Anything we can't classify is logged
// once with the full payload so we can extend the matcher next time.
router.get('/video/grok-text/status/:taskId', async (req, res) => {
  const { taskId } = req.params;
  // New grok runs go through Replicate (repl:<id>); poll there.
  if (taskId && taskId.startsWith('repl:')) {
    try { return await _replicateVideoStatus(taskId, 'grok_txt', res); }
    catch (err) { console.error('[video/grok-text/status repl]', err.response?.data || err.message); return res.status(502).json({ success: false, error: err.message }); }
  }
  // Legacy kie.ai polling (kept for any in-flight pre-migration tasks).
  try {
    const statusRes = await axios.get(
      `${KIE_BASE}/api/v1/jobs/recordInfo`,
      { params: { taskId }, headers: kieHeaders(), timeout: 15000 }
    );
    const data     = statusRes.data?.data || {};
    const stateRaw = (data.state ?? data.status ?? '').toString();
    const state    = stateRaw.toLowerCase();

    // 1. Explicit in-progress states FIRST — kie.ai sometimes carries a
    //    non-empty errorMessage/failMsg placeholder while the task is still
    //    running, which would false-trigger the failure check below. So we
    //    short-circuit on a known in-progress state regardless of those.
    if (state === 'pending' || state === 'waiting' || state === 'queued'
     || state === 'processing' || state === 'running' || state === 'started'
     || state === 'in_progress' || state === 'active' || state === '') {
      return res.json({ success: true, state: state || 'pending' });
    }

    // 2. Success synonyms
    if (state === 'success' || state === 'completed' || state === 'done' || state === 'finished') {
      let videoUrl = null;
      try {
        const result = JSON.parse(data.resultJson);
        videoUrl = result.resultUrls?.[0] || result.video_url || result.url || null;
      } catch {}
      if (!videoUrl) {
        console.warn(`[video/grok-text/status ${taskId}] state=${stateRaw} but no videoUrl, data:`, JSON.stringify(data).slice(0, 400));
        return res.json({ success: true, state: 'failed', error: 'No video URL in result' });
      }
      const filename = `grok_txt_${taskId}_${Date.now()}.mp4`;
      const destPath = path.join(UPLOADS_DIR, filename);
      const videoRes = await axios({ url: videoUrl, method: 'GET', responseType: 'arraybuffer', timeout: 60000 });
      fs.writeFileSync(destPath, Buffer.from(videoRes.data));
      return res.json({ success: true, state: 'success', videoPath: `/uploads/${filename}` });
    }

    // 3. Failure detection — broad match. Only reached when the state is NOT
    //    an explicit in-progress / success value.
    //   • state strings: failed, fail, error, canceled, cancelled, rejected, killed, timeout, expired, aborted
    //   • suffix _FAILED (e.g. CREATE_TASK_FAILED, GENERATE_VIDEO_FAILED, SENSITIVE_WORD_ERROR)
    //   • presence of failMsg / errorMessage / errMsg fields
    //   • errorCode/failCode != 0
    const failStateRe = /^(failed|fail|error|canceled|cancelled|rejected|killed|timeout|expired|aborted)$/;
    const failSuffix  = /_failed$|_error$/;
    const hasFailFields = !!(data.failMsg || data.errorMessage || data.errMsg || data.error);
    const hasFailCode   = (typeof data.errorCode !== 'undefined' && data.errorCode !== 0 && data.errorCode !== '0')
                       || (typeof data.failCode !== 'undefined' && data.failCode !== 0 && data.failCode !== '0');
    if (failStateRe.test(state) || failSuffix.test(state) || hasFailFields || hasFailCode) {
      const errMsg = data.failMsg || data.errorMessage || data.errMsg || data.error
                  || `Grok t2v failed (state=${stateRaw || 'unknown'}${hasFailCode ? ', code=' + (data.errorCode ?? data.failCode) : ''})`;
      console.warn(`[video/grok-text/status ${taskId}] failure detected: ${errMsg}`);
      return res.json({ success: true, state: 'failed', error: errMsg });
    }

    // 4. Unknown state — log full payload for future matcher extension, but
    //    report it as failure so the frontend stops polling forever.
    console.warn(`[video/grok-text/status ${taskId}] UNRECOGNISED state="${stateRaw}" payload:`,
      JSON.stringify(data).slice(0, 600));
    return res.json({ success: true, state: 'failed', error: `Unrecognised state from kie.ai: "${stateRaw}"` });
  } catch (err) {
    console.error('[video/grok-text/status]', err.response?.data || err.message);
    res.status(502).json({ success: false, error: err.message });
  }
});

// ── POST /api/video/p-video ──────────────────────────────────────────────────
// Replicate prunaai/p-video model. Supports t2v (no image) and i2v (with
// image_url OR imagePath). Body:
//   { prompt, imageUrl? | imagePath?, audioUrl? | audioPath?, params? }
// Returns { taskId: 'repl:<id>' }. Poll via /api/video/p-video/status/:taskId.
router.post('/video/p-video', async (req, res) => {
  const { prompt, imageUrl: directImageUrl, imagePath, audioUrl: directAudioUrl, audioPath, params = {} } = req.body;
  if (!prompt) return res.status(400).json({ success: false, error: 'Нет prompt' });
  try {
    let imageUrl = directImageUrl || null;
    if (!imageUrl && imagePath) {
      const abs = path.join(__dirname, '..', imagePath.replace(/^\//, ''));
      if (fs.existsSync(abs)) {
        imageUrl = await uploadToPublicHost(fs.readFileSync(abs), { forceFresh: true, ext: 'jpg' });
      }
    }
    let audioUrl = directAudioUrl || null;
    if (!audioUrl && audioPath) {
      const abs = path.join(__dirname, '..', audioPath.replace(/^\//, ''));
      if (fs.existsSync(abs)) {
        audioUrl = await uploadToPublicHost(fs.readFileSync(abs), { forceFresh: true, ext: 'mp3' });
      }
    }
    console.log('[p-video] inbound params:', JSON.stringify(params));
    console.log('[p-video] imageUrl:', imageUrl, '| audioUrl:', audioUrl);
    const taskId = await createPVideoTask(prompt, imageUrl, audioUrl, params);
    res.json({ success: true, taskId });
  } catch (err) {
    // Surface Replicate's detail field — that's where the "422 - <field> is invalid" message lives.
    const detail = err.response?.data?.detail || err.response?.data?.title || err.response?.data?.msg || err.message;
    console.error('[video/p-video] ERROR:', JSON.stringify(err.response?.data || err.message));
    res.status(502).json({ success: false, error: detail });
  }
});

// ── GET /api/video/p-video/status/:taskId ────────────────────────────────────
// Polls Replicate prediction; on success downloads the mp4 to uploads/.
// taskId is `repl:<predictionId>` — we strip the prefix and hit Replicate.
router.get('/video/p-video/status/:taskId', async (req, res) => {
  const { taskId } = req.params;
  if (!taskId || !taskId.startsWith('repl:')) {
    return res.status(400).json({ success: false, error: 'p-video taskId must start with repl:' });
  }
  const predictionId = taskId.slice(5);
  const apiKey = (function () {
    try { return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'))?.replicateApiKey || ''; } catch { return ''; }
  })();
  if (!apiKey) return res.json({ success: true, state: 'failed', error: 'Replicate token not configured' });
  try {
    const pollRes = await axios.get(`https://api.replicate.com/v1/predictions/${predictionId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      timeout: 15000,
    });
    const pred  = pollRes.data;
    const state = pred?.status;
    if (state === 'failed' || state === 'canceled') {
      return res.json({ success: true, state: 'failed', error: pred?.error || state });
    }
    if (state !== 'succeeded') {
      return res.json({ success: true, state: 'pending' });
    }
    const _extract = (out) => {
      if (!out) return null;
      if (typeof out === 'string') return out;
      if (Array.isArray(out)) { for (const it of out) { const u = _extract(it); if (u) return u; } return null; }
      if (typeof out === 'object') return out.url || out.video || out.video_url || null;
      return null;
    };
    const remoteUrl = _extract(pred.output);
    if (!remoteUrl) return res.json({ success: true, state: 'failed', error: 'p-video: empty output' });
    const filename = `pvid_repl${predictionId.slice(-10)}_${Date.now()}.mp4`;
    const destPath = path.join(UPLOADS_DIR, filename);
    const videoRes = await axios({ url: remoteUrl, method: 'GET', responseType: 'arraybuffer', timeout: 120000 });
    fs.writeFileSync(destPath, Buffer.from(videoRes.data));
    // Normalize for browser playback + merge compatibility (see helper docs).
    try { await normalizeVideoForBrowser(destPath); }
    catch (e) { console.warn('[video/p-video/status] normalize failed:', e.message); }
    return res.json({ success: true, state: 'success', videoPath: `/uploads/${filename}` });
  } catch (err) {
    console.error('[video/p-video/status]', err.response?.data || err.message);
    res.status(502).json({ success: false, error: err.message });
  }
});

// ── POST /api/biroly/hands-generate ──────────────────────────────────────────
// Body: { prompt, engine: 'grok'|'veo3'|'sora', duration?, aspectRatio? }
// Submits a text-to-video task to the chosen engine and returns { taskId }.
function _handsBuildKieRequest(engine, prompt, duration, aspectRatio) {
  const dur = String(duration);
  if (engine === 'grok') {
    return {
      model: 'grok-imagine/text-to-video',
      input: {
        prompt,
        duration: dur,
        resolution: '480p',
        aspect_ratio: aspectRatio,
        mode: 'normal',
      },
    };
  }
  if (engine === 'veo3') {
    return {
      model: 'veo3-fast/text-to-video',
      input: { prompt, ratio: aspectRatio, resolution: '720p' },
    };
  }
  if (engine === 'sora') {
    return {
      model: 'sora-2/text-to-video',
      input: { prompt, aspect_ratio: aspectRatio },
    };
  }
  return null;
}

router.post('/biroly/hands-generate', async (req, res) => {
  const { prompt, engine = 'grok', duration = 5, aspectRatio = '9:16' } = req.body || {};
  if (!prompt) return res.status(400).json({ success: false, error: 'Нет промпта' });
  // grok now runs on Replicate (xai/grok-imagine-video); veo3/sora stay on kie.ai.
  if (engine === 'grok') {
    try {
      const taskId = await createGrokImagineVideoTask(prompt, null, { duration, aspect_ratio: aspectRatio, resolution: '480p', mode: 'normal' });
      return res.json({ success: true, taskId, engine });
    } catch (err) {
      const detail = err.response?.data?.detail || err.response?.data?.title || err.response?.data?.msg || err.message;
      console.error('[biroly/hands-generate grok] ERROR:', JSON.stringify(err.response?.data || err.message));
      return res.status(502).json({ success: false, error: detail });
    }
  }
  const payload = _handsBuildKieRequest(engine, prompt, duration, aspectRatio);
  if (!payload) return res.status(400).json({ success: false, error: 'Unknown engine: ' + engine });

  try {
    const taskRes = await axios.post(
      `${KIE_BASE}/api/v1/jobs/createTask`,
      payload,
      { headers: kieHeaders(), timeout: 30000 }
    );
    const taskId = taskRes.data?.data?.taskId;
    if (!taskId) {
      const detail = taskRes.data;
      console.error('[biroly/hands-generate] no taskId. engine=' + engine + ' model=' + payload.model + ' kieResp=' + JSON.stringify(detail));
      const kieMsg = detail?.msg || detail?.message || detail?.data?.msg || JSON.stringify(detail);
      return res.status(502).json({ success: false, error: 'kie.ai (' + engine + '): ' + kieMsg, detail });
    }
    res.json({ success: true, taskId, engine });
  } catch (err) {
    const data = err.response?.data;
    console.error('[biroly/hands-generate] error. engine=' + engine + ' status=' + err.response?.status + ' data=' + JSON.stringify(data) + ' msg=' + err.message);
    const apiMsg = data?.msg || data?.message || err.message;
    res.status(502).json({ success: false, error: 'kie.ai (' + engine + '): ' + apiMsg, detail: data });
  }
});

// ── GET /api/biroly/hands-status ─────────────────────────────────────────────
// Query: ?engine=grok|veo3|sora&taskId=xxx
// Polls kie.ai recordInfo and, on success, downloads the resulting mp4 to /uploads/.
router.get('/biroly/hands-status', async (req, res) => {
  const { engine = 'grok', taskId } = req.query;
  if (!taskId) return res.status(400).json({ success: false, error: 'taskId required' });
  // grok runs on Replicate now (repl:<id>); veo3/sora still poll kie.ai.
  if (String(taskId).startsWith('repl:')) {
    try { return await _replicateVideoStatus(taskId, 'hands_grok', res); }
    catch (err) { console.error('[biroly/hands-status repl]', err.response?.data || err.message); return res.status(502).json({ success: false, error: err.message }); }
  }
  try {
    const statusRes = await axios.get(
      `${KIE_BASE}/api/v1/jobs/recordInfo`,
      { params: { taskId }, headers: kieHeaders(), timeout: 15000 }
    );
    const data  = statusRes.data?.data;
    const state = data?.state;

    if (state === 'success') {
      let videoUrl = null;
      try {
        const result = JSON.parse(data.resultJson);
        videoUrl = result.resultUrls?.[0] || result.video_url || result.url || null;
      } catch {}
      if (!videoUrl) return res.json({ success: true, state: 'failed', error: 'No video URL in result' });

      const filename = `hands_${engine}_${taskId}_${Date.now()}.mp4`;
      const destPath = path.join(UPLOADS_DIR, filename);
      const videoRes = await axios({ url: videoUrl, method: 'GET', responseType: 'arraybuffer', timeout: 120000 });
      fs.writeFileSync(destPath, Buffer.from(videoRes.data));
      return res.json({ success: true, state: 'success', videoPath: `/uploads/${filename}` });
    }

    if (state === 'failed') {
      return res.json({ success: true, state: 'failed', error: data?.failMsg || 'Generation failed' });
    }

    return res.json({ success: true, state: state || 'pending' });
  } catch (err) {
    console.error('[biroly/hands-status]', err.response?.data || err.message);
    res.status(502).json({ success: false, error: err.message });
  }
});

// ── POST /api/biroly/enhance-realism ─────────────────────────────────────────
// Body: { prompt }
// Uses Gemini to integrate contextually appropriate realism markers into the prompt.
// Returns { prompt: enhancedPrompt }
router.post('/biroly/enhance-realism', async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ success: false, error: 'Нет промпта' });

  const systemPrompt =
    `You are an image generation prompt engineer specializing in photorealism.\n\n` +
    `Below is an image generation prompt. Analyze what is described (subject, skin visibility, ` +
    `lighting conditions, indoor/outdoor, clothing materials, hair, hands, etc.) and integrate ` +
    `ONLY the realism markers from the list that genuinely fit this specific context.\n` +
    `DO NOT add markers that don't match the described scene. ` +
    `Return ONLY the enhanced prompt text — no explanations, no JSON, no extra text.\n\n` +
    `Available realism markers:\n` +
    `Camera/lens: phone-camera realism, subtle sensor grain, slight edge softness\n` +
    `No retouching: unretouched, no smoothing, no beauty filters, no airbrushing\n` +
    `Lighting: indoor near window, natural contrast, accurate white balance, soft side lighting\n` +
    `Face anatomy: no symmetry correction\n` +
    `Style: shallow depth of field, editorial realism\n` +
    `Skin texture: visible pores, fine micro-texture, subtle under-eye texture\n` +
    `Skin imperfections: organic acne marks (non-repeating), uneven pigmentation, subtle redness, visible fine lines\n` +
    `Skin sheen: natural oil sheen only on high points\n` +
    `Hair: natural flyaways\n` +
    `Hands/body: visible veins, hand anatomy, realistic proportions\n` +
    `Fabric: clear fabric texture separation\n\n` +
    `PROMPT TO ENHANCE:\n"${prompt}"`;

  try {
    const enhanced = await callAI(
      [{ role: 'user', content: systemPrompt }],
      { timeout: 30000, useOpenRouter: true }
    );
    res.json({ success: true, prompt: enhanced });
  } catch (err) {
    console.error('[biroly/enhance-realism]', err.response?.data || err.message);
    res.status(502).json({ success: false, error: err.response?.data?.msg || err.message });
  }
});

// ── POST /api/biroly/gen-image ────────────────────────────────────────────────
// Body: { prompt, aspectRatio?, imageEngine? }
// imageEngine: 'seedream'(default) | 'seedream4.5' | 'gptimage2' | 'qwen2' | 'nano-banana-2'
router.post('/biroly/gen-image', async (req, res) => {
  const { prompt, aspectRatio = '9:16', imageEngine = 'seedream', engineParams = {} } = req.body;
  if (!prompt) return res.status(400).json({ success: false, error: 'Нет промпта' });
  try {
    let taskId;
    if (imageEngine === 'gptimage2') {
      taskId = await createGptImage2TextTask(prompt, aspectRatio, engineParams);
    } else if (imageEngine === 'qwen2') {
      taskId = await createQwen2TextTask(prompt, aspectRatio, undefined, engineParams);
    } else if (imageEngine === 'nano-banana-2') {
      taskId = await createNanoBananaProTextTask(prompt, aspectRatio, engineParams);
    } else if (imageEngine === 'seedream4.5') {
      taskId = await createSeedream45TextTask(prompt, aspectRatio, engineParams);
    } else {
      taskId = await createSeedream5LiteTextTask(prompt, aspectRatio, engineParams);
    }
    if (!taskId) return res.status(502).json({ success: false, error: 'kie.ai не вернул taskId' });
    res.json({ success: true, taskId });
  } catch (err) {
    console.error('[biroly/gen-image]', err.response?.data || err.message);
    res.status(502).json({ success: false, error: err.response?.data?.msg || err.message });
  }
});

// ── POST /api/biroly/analyze-for-video ───────────────────────────────────────
// Body: { imageUrl | imagePath }
// Uses Gemini to analyze the generated image and produce a quality Grok video prompt
router.post('/biroly/analyze-for-video', async (req, res) => {
  const { imagePath, imageUrl: directImageUrl } = req.body;
  if (!imagePath && !directImageUrl) return res.status(400).json({ success: false, error: 'Нет imageUrl или imagePath' });
  try {
    let imageUrl;
    if (directImageUrl) {
      imageUrl = directImageUrl;
    } else {
      const filePath = path.join(__dirname, '..', imagePath.replace(/^\//, ''));
      if (!fs.existsSync(filePath)) return res.status(400).json({ success: false, error: 'Изображение не найдено' });
      imageUrl = await uploadToPublicHost(fs.readFileSync(filePath));
    }

    const systemPrompt = `You are generating a high-quality motion prompt for Grok AI image-to-video generation.

Analyze this image carefully and write a detailed, technical English video prompt (max 400 characters) that includes:
- Main subject and their visual characteristics
- Environment and setting details
- Natural motion, camera movement, and animation
- Lighting and color mood
- Style (cinematic, UGC, product demo, etc.)

The prompt must be optimized for Grok image-to-video. Respond with ONLY the prompt text, no explanations.`;

    const videoPrompt = await callAI([{ role: 'user', content: [
      { type: 'text',      text: systemPrompt },
      { type: 'image_url', image_url: { url: imageUrl } },
    ]}], { timeout: 30000, useOpenRouter: true });

    res.json({ success: true, prompt: videoPrompt });
  } catch (err) {
    console.error('[biroly/analyze-for-video]', err.response?.data || err.message);
    res.status(502).json({ success: false, error: err.response?.data?.msg || err.message });
  }
});

// ── POST /api/biroly/analyze-for-first-frame ─────────────────────────────────
// Body: { animationPrompt }
// Returns { framePrompt } — image generation prompt for the first frame
router.post('/biroly/analyze-for-first-frame', async (req, res) => {
  const { animationPrompt } = req.body;
  if (!animationPrompt) return res.status(400).json({ success: false, error: 'Нет animationPrompt' });

  const systemPrompt =
    `You are a professional image generation prompt engineer for AI video.\n\n` +
    `Given an animation/video prompt, write a concise English image generation prompt (2–3 sentences) ` +
    `describing the FIRST FRAME — the starting visual state before any action begins.\n` +
    `The image must be photorealistic, cinematic, and compelling as a standalone photo.\n\n` +
    `Animation prompt: "${animationPrompt}"\n\n` +
    `Return ONLY the image prompt — no explanations, no JSON, no labels.`;

  try {
    const framePrompt = await callAI([{ role: 'user', content: systemPrompt }], { timeout: 30000, useOpenRouter: true });
    res.json({ success: true, framePrompt });
  } catch (err) {
    console.error('[biroly/analyze-for-first-frame]', err.message);
    res.status(502).json({ success: false, error: err.message });
  }
});

// ── POST /api/biroly/gen-gpt2-text ────────────────────────────────────────────
// Body: { prompt, aspectRatio? }
// Submits GPT Image 2 text-to-image task; poll via GET /api/status/:taskId
router.post('/biroly/gen-gpt2-text', async (req, res) => {
  const { prompt, aspectRatio = '9:16' } = req.body;
  if (!prompt) return res.status(400).json({ success: false, error: 'Нет промпта' });
  try {
    const taskId = await createGptImage2TextTask(prompt, aspectRatio);
    res.json({ success: true, taskId });
  } catch (err) {
    console.error('[biroly/gen-gpt2-text]', err.response?.data || err.message);
    res.status(502).json({ success: false, error: err.response?.data?.msg || err.message });
  }
});

// ── POST /api/biroly/gen-gpt2-i2i ────────────────────────────────────────────
// Body: { prompt, refImagePath, aspectRatio? }
// Submits GPT Image 2 image-to-image task using refImage as reference
router.post('/biroly/gen-gpt2-i2i', async (req, res) => {
  const { prompt, refImagePath, aspectRatio = '9:16' } = req.body;
  if (!prompt || !refImagePath)
    return res.status(400).json({ success: false, error: 'Нет промпта или refImagePath' });

  const filePath = path.join(__dirname, '..', refImagePath.replace(/^\//, ''));
  if (!fs.existsSync(filePath))
    return res.status(400).json({ success: false, error: 'Файл референса не найден' });

  try {
    const imageUrl = await uploadToPublicHost(fs.readFileSync(filePath));
    const taskId   = await createGptImage2Task(prompt, [imageUrl], aspectRatio);
    res.json({ success: true, taskId });
  } catch (err) {
    console.error('[biroly/gen-gpt2-i2i]', err.response?.data || err.message);
    res.status(502).json({ success: false, error: err.response?.data?.msg || err.message });
  }
});

// ── POST /api/biroly/gen-variant ─────────────────────────────────────────────
// Body: { variant?, existingVariants?, mode? }
// mode: 'new' (no text → generate fresh based on existing format)
//       'friend' (has text → rewrite different angle, English)
//       'expand' (has text → beautify/expand, keep context, English)
// Returns { success, text }
router.post('/biroly/gen-variant', async (req, res) => {
  const { variant, existingVariants = [], otherVariants = [], mode = 'friend' } = req.body;
  const hasText = variant?.trim();
  // Support both field names for backwards compat
  const allExisting = (existingVariants.length ? existingVariants : otherVariants).filter(Boolean);
  const existingList = allExisting.map(v => `- ${v}`).join('\n');

  let systemMsg, userMsg;

  if (!hasText || mode === 'new') {
    // No user text → generate completely new variant in same format as existing ones
    systemMsg = 'You are a creative copywriter. Return ONLY the new variant text — no quotes, no labels, no explanations.';
    userMsg = `Existing variants in this spintax group:\n${existingList || '(none yet)'}\n\nGenerate ONE new variant that fits the same topic, format, and word count as the existing ones. It must be completely different from all existing variants. Output in English.`;
  } else if (mode === 'expand') {
    // Has text → beautify and expand, keep same meaning
    systemMsg = 'You are a creative copywriter. Return ONLY the improved text — no quotes, no labels, no explanations.';
    userMsg = `Beautify and expand this prompt fragment into polished English:\n"${hasText}"\n\nRules: keep the same meaning and context, add vivid descriptive details, do not change the core idea. Output in English only.`;
  } else {
    // Has text + 'friend' → rewrite as a different angle, same format
    systemMsg = 'You are a creative copywriter. Return ONLY the rewritten text — no quotes, no labels, no explanations.';
    userMsg = `Rewrite this prompt fragment from a completely different angle:\n"${hasText}"\n\nExisting variants to avoid repeating:\n${existingList || '(none)'}\n\nKeep the same word count and grammatical structure. Completely different idea/perspective. Output in English only.`;
  }

  try {
    const text = await callAI([
      { role: 'system', content: systemMsg },
      { role: 'user',   content: userMsg },
    ], { timeout: 20000, maxAttempts: 2, useOpenRouter: true });

    res.json({ success: true, text: text.replace(/^["']|["']$/g, '').trim() });
  } catch (err) {
    console.error('[biroly/gen-variant]', err.message);
    res.status(502).json({ success: false, error: err.message });
  }
});

// ── POST /api/video/grok ──────────────────────────────────────────────────────
// Body: { imageUrl? | imagePath? | imageUrls?, prompt?, duration?, resolution?, aspectRatio?, mode? }
// imageUrl (string) — pre-uploaded public URL, used directly (no upload)
// imagePath (string) — local path, uploaded internally
// imageUrls (array)  — multiple pre-uploaded URLs, used directly
router.post('/video/grok', async (req, res) => {
  const {
    imagePath,
    imageUrl: directImageUrl,
    imageUrls,
    prompt       = '',
    duration     = '6',
    resolution   = '720p',
    aspectRatio  = '9:16',
    mode         = 'normal',
    videoEngine,
  } = req.body;

  const videoModel = videoEngine || 'grok-imagine/image-to-video';

  try {
    let finalUrls = [];

    if (imageUrls && Array.isArray(imageUrls) && imageUrls.length) {
      finalUrls = imageUrls;
    } else if (directImageUrl) {
      finalUrls = [directImageUrl];
    } else if (imagePath) {
      const buf = fs.readFileSync(path.join(__dirname, '..', imagePath.replace(/^\//, '')));
      finalUrls = [await uploadToPublicHost(buf)];
    } else {
      return res.status(400).json({ success: false, error: 'Нужен imageUrl, imagePath или imageUrls' });
    }

    // Replicate xai/grok-imagine-video, image-to-video (single image). Returns repl:<id>.
    const motionPrompt = (prompt && prompt.trim()) || 'Bring this image to life with subtle, natural motion.';
    const taskId = await createGrokImagineVideoTask(motionPrompt, finalUrls[0], {
      duration, aspect_ratio: aspectRatio, resolution, mode,
    });
    res.json({ success: true, taskId });
  } catch (err) {
    const detail = err.response?.data?.detail || err.response?.data?.title || err.response?.data?.msg || err.message;
    console.error('[video/grok] ERROR:', JSON.stringify(err.response?.data || err.message));
    res.status(502).json({ success: false, error: detail });
  }
});

// ── GET /api/video/grok/status/:taskId ────────────────────────────────────────
// Polls the Grok task; on success downloads the mp4 to uploads/ and returns { videoPath }
router.get('/video/grok/status/:taskId', async (req, res) => {
  const { taskId } = req.params;
  // New grok runs go through Replicate (repl:<id>); poll there.
  if (taskId && taskId.startsWith('repl:')) {
    try { return await _replicateVideoStatus(taskId, 'grok', res); }
    catch (err) { console.error('[video/grok/status repl]', err.response?.data || err.message); return res.status(502).json({ success: false, error: err.message }); }
  }
  // Legacy kie.ai polling (kept for any in-flight pre-migration tasks).
  try {
    const statusRes = await axios.get(
      `${KIE_BASE}/api/v1/jobs/recordInfo`,
      { params: { taskId }, headers: kieHeaders(), timeout: 15000 }
    );
    const data  = statusRes.data?.data;
    const state = data?.state;

    if (state === 'success') {
      let videoUrl = null;
      try {
        const result = JSON.parse(data.resultJson);
        videoUrl = result.resultUrls?.[0] || result.video_url || result.url || null;
      } catch {}
      if (!videoUrl) return res.json({ success: true, state: 'failed', error: 'No video URL in result' });

      const filename = `grok_${taskId}_${Date.now()}.mp4`;
      const destPath = path.join(UPLOADS_DIR, filename);
      const videoRes = await axios({ url: videoUrl, method: 'GET', responseType: 'arraybuffer', timeout: 60000 });
      fs.writeFileSync(destPath, Buffer.from(videoRes.data));
      return res.json({ success: true, state: 'success', videoPath: `/uploads/${filename}` });
    }

    if (state === 'failed') {
      return res.json({ success: true, state: 'failed', error: data?.failMsg || 'Grok video generation failed' });
    }

    return res.json({ success: true, state: state || 'pending' });
  } catch (err) {
    console.error('[video/grok/status]', err.response?.data || err.message);
    res.status(502).json({ success: false, error: err.message });
  }
});

// ── GET /api/biroly/scan-uploads ─────────────────────────────────────────────
// Returns grok_*.mp4 videos paired with nearest generated_*.jpg image (by mtime).
// Pairs where the image was created within 30 min before the video are linked.
router.get('/biroly/scan-uploads', (req, res) => {
  try {
    const allFiles = fs.readdirSync(UPLOADS_DIR);

    // Orphan recovery only needs the videos + their mtimes. We intentionally do NOT
    // pair them with generated_* images: that time-window heuristic guessed wrong
    // (a video could inherit another birol's source image as its thumbnail). The
    // real thumbnail is always derived from the video itself via refresh-thumbs.
    const files = allFiles
      .filter(f => f.startsWith('grok_') && f.endsWith('.mp4'))
      .map(f => {
        const st = fs.statSync(path.join(UPLOADS_DIR, f));
        return { file: f, videoPath: `/uploads/${f}`, mtime: st.mtimeMs, imagePath: null, thumbPath: null };
      })
      .sort((a, b) => b.mtime - a.mtime);

    res.json({ success: true, files });
  } catch (err) {
    console.error('[biroly/scan-uploads]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── DELETE /api/biroly/delete-files ───────────────────────────────────────────
// Permanently removes a birol's files from UPLOADS_DIR.
// Body: { imagePath, thumbPath, videoPath } — all optional, must start with /uploads/
router.post('/biroly/delete-files', (req, res) => {
  const { imagePath, thumbPath, videoPath } = req.body || {};
  const toDelete = [imagePath, thumbPath, videoPath].filter(Boolean);
  const deleted = [];
  for (const p of toDelete) {
    if (!p.startsWith('/uploads/') || p.includes('..')) continue;
    const abs = path.join(UPLOADS_DIR, p.replace(/^\/uploads\//, ''));
    try { if (fs.existsSync(abs)) { fs.unlinkSync(abs); deleted.push(p); } }
    catch (e) { console.warn('[biroly/delete-files]', p, e.message); }
  }
  res.json({ success: true, deleted });
});

// ── POST /api/biroly/sync ─────────────────────────────────────────────────────
// Client sends its localStorage list; server returns which IDs to remove
// (their files are gone from disk) and which orphan files to add.
// Body: { items: [{ id, imagePath, videoPath }] }
router.post('/biroly/sync', (req, res) => {
  try {
    const items = req.body?.items || [];
    const toRemove = [];
    for (const item of items) {
      if (item.status === 'generating') continue; // never auto-remove in-progress
      const hasVideo = item.videoPath && item.videoPath.startsWith('/uploads/')
        && fs.existsSync(path.join(UPLOADS_DIR, item.videoPath.replace(/^\/uploads\//, '')));
      const hasImage = item.imagePath && item.imagePath.startsWith('/uploads/')
        && fs.existsSync(path.join(UPLOADS_DIR, item.imagePath.replace(/^\/uploads\//, '')));
      // Remove only if BOTH video and image are gone (or never existed)
      const videoExpected = !!item.videoPath;
      const imageExpected = !!item.imagePath;
      if ((videoExpected && !hasVideo) && (!imageExpected || !hasImage)) {
        toRemove.push(item.id);
      }
    }

    // Also scan for orphan videos not in the client list
    const knownVideos = new Set(items.map(i => i.videoPath).filter(Boolean));
    const allFiles    = fs.readdirSync(UPLOADS_DIR);
    const orphans     = allFiles
      .filter(f => f.startsWith('grok_') && f.endsWith('.mp4'))
      .map(f => `/uploads/${f}`)
      .filter(vp => !knownVideos.has(vp));

    res.json({ success: true, toRemove, orphans });
  } catch (err) {
    console.error('[biroly/sync]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /api/biroly/refresh-thumbs ──────────────────────────────────────────
// Takes [{id, videoPath}], generates missing thumbnails, returns [{id, thumbPath}].
router.post('/biroly/refresh-thumbs', async (req, res) => {
  const items = req.body?.items || [];
  if (!fs.existsSync(UPLOADS_THUMBS_DIR)) fs.mkdirSync(UPLOADS_THUMBS_DIR, { recursive: true });
  const results = [];
  for (const { id, videoPath } of items) {
    if (!videoPath?.startsWith('/uploads/')) continue;
    const absVideo = path.join(UPLOADS_DIR, videoPath.replace(/^\/uploads\//, ''));
    if (!fs.existsSync(absVideo)) continue;
    const baseName      = path.basename(videoPath, path.extname(videoPath));
    const thumbFilename = baseName + '_thumb.jpg';
    const absThumb      = path.join(UPLOADS_THUMBS_DIR, thumbFilename);
    const thumbPath     = `/uploads/thumbs/${thumbFilename}`;
    if (!fs.existsSync(absThumb)) {
      const ok = await extractBirolyThumb(absVideo, absThumb);
      if (!ok) continue;
    }
    results.push({ id, thumbPath });
  }
  res.json({ success: true, results });
});

// ── POST /api/biroly/check-item ───────────────────────────────────────────────
// Re-checks file existence for one item; extracts thumb if video found.
router.post('/biroly/check-item', async (req, res) => {
  const { videoPath, imagePath } = req.body || {};
  const hasVideo = !!(videoPath?.startsWith('/uploads/') &&
    fs.existsSync(path.join(UPLOADS_DIR, videoPath.replace(/^\/uploads\//, ''))));
  const hasImage = !!(imagePath?.startsWith('/uploads/') &&
    fs.existsSync(path.join(UPLOADS_DIR, imagePath.replace(/^\/uploads\//, ''))));
  let thumbPath = null;
  if (hasVideo) {
    if (!fs.existsSync(UPLOADS_THUMBS_DIR)) fs.mkdirSync(UPLOADS_THUMBS_DIR, { recursive: true });
    const absVideo      = path.join(UPLOADS_DIR, videoPath.replace(/^\/uploads\//, ''));
    const baseName      = path.basename(videoPath, path.extname(videoPath));
    const thumbFilename = baseName + '_thumb.jpg';
    const absThumb      = path.join(UPLOADS_THUMBS_DIR, thumbFilename);
    thumbPath           = `/uploads/thumbs/${thumbFilename}`;
    if (!fs.existsSync(absThumb)) {
      const ok = await extractBirolyThumb(absVideo, absThumb);
      if (!ok) thumbPath = null;
    }
  }
  res.json({ success: true, hasVideo, hasImage, thumbPath });
});

// ── POST /api/biroly/refresh-all-thumbs ──────────────────────────────────────
// One-shot: scan all grok_*.mp4 in UPLOADS_DIR, extract missing thumbnails.
router.post('/biroly/refresh-all-thumbs', async (req, res) => {
  if (!fs.existsSync(UPLOADS_THUMBS_DIR)) fs.mkdirSync(UPLOADS_THUMBS_DIR, { recursive: true });
  const allFiles = fs.readdirSync(UPLOADS_DIR);
  const videos   = allFiles.filter(f => f.startsWith('grok_') && f.endsWith('.mp4'));
  let generated  = 0;
  for (const vf of videos) {
    const absVideo      = path.join(UPLOADS_DIR, vf);
    const baseName      = path.basename(vf, '.mp4');
    const thumbFilename = baseName + '_thumb.jpg';
    const absThumb      = path.join(UPLOADS_THUMBS_DIR, thumbFilename);
    if (fs.existsSync(absThumb)) continue;
    const ok = await extractBirolyThumb(absVideo, absThumb);
    if (ok) generated++;
  }
  res.json({ success: true, generated, total: videos.length });
});

// ── Speech-to-Text (ElevenLabs via kie.ai) ────────────────────────────────────
// In-memory job registry
const _sttJobs = {};

// Upload an audio file buffer to catbox.moe for temporary hosting
async function _uploadAudioBuf(buf, filename) {
  const form = new FormData();
  const ext  = path.extname(filename).toLowerCase() || '.mp3';
  const mime = ext === '.wav' ? 'audio/wav' : ext === '.ogg' ? 'audio/ogg' : 'audio/mpeg';
  form.append('reqtype', 'fileupload');
  form.append('time',    '1h');
  form.append('fileToUpload', buf, { filename: filename || `audio${ext}`, contentType: mime });
  const res = await axios.post(
    'https://litterbox.catbox.moe/resources/internals/api.php',
    form,
    { headers: form.getHeaders(), timeout: 60000 }
  );
  const url = res.data.trim();
  if (!url.startsWith('http')) throw new Error('Ошибка загрузки аудио: ' + url);
  return url;
}

// Poll a kie.ai task until success/failure, max 120 s
async function _pollKieTask(taskId) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 3500));
    const res  = await axios.get(`${KIE_BASE}/api/v1/jobs/recordInfo`,
      { params: { taskId }, headers: kieHeaders(), timeout: 15000 });
    const data = res.data?.data;
    if (data?.state === 'success') return JSON.parse(data.resultJson);
    if (data?.state === 'failed')  throw new Error(data.failMsg || 'STT task failed');
  }
  throw new Error('STT timeout — kie.ai не ответил за 2 минуты');
}

// Convert an array of word objects (with offsets applied) to SRT text
function _fmtSrtTime(s) {
  const h  = Math.floor(s / 3600);
  const m  = Math.floor((s % 3600) / 60);
  const sc = Math.floor(s % 60);
  const ms = Math.round((s % 1) * 1000);
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(sc).padStart(2,'0')},${String(ms).padStart(3,'0')}`;
}

function _wordsToSrt(words) {
  const MAX_WORDS = 7;
  const MAX_DUR   = 4.0;
  const GAP_BREAK = 1.0;
  const subs = [];
  let cur = [], curStart = null, prevEnd = null;

  for (const w of words) {
    const gap = prevEnd !== null ? w.start - prevEnd : 0;
    if (cur.length && (cur.length >= MAX_WORDS || (w.end - curStart) > MAX_DUR || gap > GAP_BREAK)) {
      subs.push({ start: curStart, end: prevEnd, text: cur.join(' ') });
      cur = []; curStart = null;
    }
    if (curStart === null) curStart = w.start;
    cur.push(w.text);
    prevEnd = w.end;
  }
  if (cur.length) subs.push({ start: curStart, end: prevEnd, text: cur.join(' ') });

  return subs.map((s, i) =>
    `${i + 1}\n${_fmtSrtTime(s.start)} --> ${_fmtSrtTime(s.end)}\n${s.text}`
  ).join('\n\n');
}

// POST /api/audio/stt
// Body: { segments: [{ audioPath, timeOffset }], languageCode? }
// Uses Groq Whisper if GROQ_API_KEY is set, falls back to kie.ai ElevenLabs
router.post('/audio/stt', (req, res) => {
  const { segments = [], languageCode = '' } = req.body;
  if (!segments.length) return res.status(400).json({ success: false, error: 'Нет сегментов' });

  const useGroq = !!_getGroqApiKey();
  const jobId = `stt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  _sttJobs[jobId] = { state: 'running', progress: '', provider: useGroq ? 'groq' : 'kie', srtPath: null, srtContent: null, words: null, error: null };
  res.json({ success: true, jobId, provider: useGroq ? 'groq' : 'kie' });

  // Background processing
  (async () => {
    const allWords = [];
    const segWords = []; // raw, per-segment, un-offset word timings (for client-side recompute on speed/trim change)

    for (let i = 0; i < segments.length; i++) {
      const { audioPath, timeOffset = 0 } = segments[i];
      _sttJobs[jobId].progress = `${i + 1}/${segments.length}`;

      // Resolve file path
      let fp = audioPath;
      if (fp.startsWith('/uploads/')) fp = path.join(UPLOADS_DIR, fp.slice('/uploads/'.length));
      else if (fp.startsWith('/'))    fp = path.join(ROOT_DIR, fp.replace(/^\//, ''));
      if (!fs.existsSync(fp)) { console.warn('[stt] file not found:', fp); continue; }

      const buf = fs.readFileSync(fp);

      if (useGroq) {
        // ── Groq Whisper (synchronous, no upload needed) ──────────────────
        const result = await _groqStt(buf, path.basename(fp), languageCode || undefined);
        const rawWords = (result.words || [])
          .filter(w => typeof w.start === 'number')
          .map(w => ({ text: w.word || w.text || '', start: w.start, end: (w.end ?? w.start + 0.3) }));
        console.log(`[stt/groq] segment ${i + 1}: ${rawWords.length} words, duration ${(result.duration || 0).toFixed(1)}s`);
        segWords.push({ index: i, words: rawWords });
        allWords.push(...rawWords.map(w => ({ text: w.text, start: w.start + timeOffset, end: w.end + timeOffset })));

      } else {
        // ── kie.ai ElevenLabs STT (fallback) ──────────────────────────────
        const audioUrl = await _uploadAudioBuf(buf, path.basename(fp));
        const taskRes  = await axios.post(
          `${KIE_BASE}/api/v1/jobs/createTask`,
          { model: 'elevenlabs/speech-to-text', input: { audio_url: audioUrl, ...(languageCode ? { language_code: languageCode } : {}) } },
          { headers: kieHeaders(), timeout: 30000 }
        );
        const taskId = taskRes.data?.data?.taskId;
        if (!taskId) throw new Error('kie.ai не вернул taskId для сегмента ' + (i + 1));
        const result = await _pollKieTask(taskId);
        const rawWords = (result.words || [])
          .filter(w => w.type === 'word' && typeof w.start === 'number')
          .map(w => ({ text: w.text, start: w.start, end: (w.end || w.start + 0.3) }));
        segWords.push({ index: i, words: rawWords });
        allWords.push(...rawWords.map(w => ({ text: w.text, start: w.start + timeOffset, end: w.end + timeOffset })));
      }
    }

    if (!allWords.length) throw new Error('Не удалось получить слова из аудио');

    // Generate SRT
    const srtContent = _wordsToSrt(allWords);
    const srtName    = `subs_${jobId}.srt`;
    const srtPath    = path.join(TEMP_DIR, srtName);
    fs.writeFileSync(srtPath, srtContent, 'utf8');

    _sttJobs[jobId] = { state: 'done', progress: '', srtPath: `/temp_files/${srtName}`, srtContent, words: allWords, segWords, error: null };
  })().catch(e => {
    console.error('[stt]', e.message);
    _sttJobs[jobId] = { state: 'failed', progress: '', srtPath: null, srtContent: null, words: null, error: e.message };
  });
});

// GET /api/audio/stt/status/:jobId
router.get('/audio/stt/status/:jobId', (req, res) => {
  const j = _sttJobs[req.params.jobId];
  if (!j) return res.json({ success: false, error: 'job not found' });
  res.json({ success: true, ...j });
});

// ── Suno music library ────────────────────────────────────────────────────────
const SUNO_LIB_FILE = path.join(DATA_DIR, 'suno-lib.json');
function _loadSunoLib() {
  try { return JSON.parse(fs.readFileSync(SUNO_LIB_FILE, 'utf8')); } catch { return []; }
}
function _saveSunoLib(list) {
  try { fs.writeFileSync(SUNO_LIB_FILE, JSON.stringify(list, null, 2), 'utf8'); } catch {}
}

// POST /api/audio/suno/generate
// Body: { style, title, negativeTags, styleWeight, weirdnessConstraint, model, targetDuration }
// targetDuration (sec) is informational — Suno V4/V5 in customMode always generates two
// ~1:30-2:30 variants per request, which the status endpoint concatenates (crossfade) into a
// single 3-5 min track. We log the target to help debugging; downstream concat doesn't gate on it.
router.post('/audio/suno/generate', async (req, res) => {
  const { style, title, negativeTags, styleWeight, weirdnessConstraint, model = 'V4_5PLUS', targetDuration } = req.body;
  if (!style) return res.status(400).json({ success: false, error: 'Нет style' });
  const BG_SUFFIX = ', background music for UGC short video, non-intrusive, subtle energy, no lyrics';
  const fullStyle = (style + BG_SUFFIX).slice(0, 1000);
  if (targetDuration) console.log(`[audio/suno/generate] target ${targetDuration}s — will concat both Suno variants for ~3-5 min coverage`);
  try {
    const taskRes = await axios.post(
      `${KIE_BASE}/api/v1/generate`,
      {
        prompt: '',
        customMode: true,
        instrumental: true,
        model,
        style: fullStyle,
        title: (title || 'UGC Background').slice(0, 80),
        negativeTags: negativeTags || 'vocals, lyrics, metal, aggressive, heavy, noise',
        styleWeight:         styleWeight         ?? 0.7,
        weirdnessConstraint: weirdnessConstraint ?? 0.3,
        callBackUrl: 'https://example.com/callback',
      },
      { headers: kieHeaders(), timeout: 30000 }
    );
    const taskId = taskRes.data?.data?.taskId || taskRes.data?.taskId;
    if (!taskId) return res.status(502).json({ success: false, error: 'kie.ai не вернул taskId', detail: taskRes.data });
    res.json({ success: true, taskId });
  } catch (err) {
    console.error('[audio/suno/generate]', err.response?.data || err.message);
    res.status(502).json({ success: false, error: err.response?.data?.msg || err.message });
  }
});

// Helper: FFmpeg-concatenate two MP3 URLs into a single file with crossfade.
// Suno returns 2 ~1:30-2:30 variants per request (sunoData[0] and sunoData[1]) — we
// download both, then chain them via acrossfade=d=1 for a ~3-5 minute background
// track. The crossfade hides the timbre shift between the two variants.
async function _concatSunoVariants(urlA, urlB, taskId) {
  const tmpA = path.join(UPLOADS_DIR, `suno_tmp_${taskId}_a.mp3`);
  const tmpB = path.join(UPLOADS_DIR, `suno_tmp_${taskId}_b.mp3`);
  const outName = `suno_${taskId}_${Date.now()}.mp3`;
  const outPath = path.join(UPLOADS_DIR, outName);

  const [resA, resB] = await Promise.all([
    axios({ url: urlA, method: 'GET', responseType: 'arraybuffer', timeout: 90000 }),
    axios({ url: urlB, method: 'GET', responseType: 'arraybuffer', timeout: 90000 }),
  ]);
  fs.writeFileSync(tmpA, Buffer.from(resA.data));
  fs.writeFileSync(tmpB, Buffer.from(resB.data));

  await new Promise((resolve, reject) => {
    const { spawn } = require('child_process');
    const args = [
      '-y',
      '-i', tmpA,
      '-i', tmpB,
      '-filter_complex', '[0:a][1:a]acrossfade=d=1:c1=tri:c2=tri[a]',
      '-map', '[a]',
      '-c:a', 'libmp3lame',
      '-b:a', '192k',
      outPath,
    ];
    const proc = spawn('ffmpeg', args);
    let stderr = '';
    proc.stderr.on('data', c => { stderr += c.toString(); });
    proc.on('error', reject);
    proc.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg concat failed (${code}): ${stderr.slice(-300)}`));
    });
  });

  // Clean up temp files (don't await — fire-and-forget)
  fs.unlink(tmpA, () => {});
  fs.unlink(tmpB, () => {});
  return outName;
}

// GET /api/audio/suno/status/:taskId
router.get('/audio/suno/status/:taskId', async (req, res) => {
  const { taskId } = req.params;
  try {
    const statusRes = await axios.get(
      `${KIE_BASE}/api/v1/generate/record-info`,
      { params: { taskId }, headers: kieHeaders(), timeout: 15000 }
    );
    const data   = statusRes.data?.data;
    const status = data?.status;  // PENDING | TEXT_SUCCESS | FIRST_SUCCESS | SUCCESS | *_FAILED
    const FAILED = ['CREATE_TASK_FAILED', 'GENERATE_AUDIO_FAILED', 'SENSITIVE_WORD_ERROR', 'CALLBACK_EXCEPTION'];

    // Only treat as success once BOTH variants are ready (Suno fills sunoData[0]
    // at FIRST_SUCCESS then sunoData[1] later at SUCCESS). If we concat too early
    // we'd only get one ~2 min track. So gate on SUCCESS specifically.
    if (status === 'SUCCESS') {
      const urlA = data?.response?.sunoData?.[0]?.audioUrl;
      const urlB = data?.response?.sunoData?.[1]?.audioUrl;
      if (!urlA) return res.json({ success: true, state: 'pending' });
      // If only one variant came back (rare), save it alone — better than failing.
      if (!urlB) {
        const filename = `suno_${taskId}_${Date.now()}.mp3`;
        const destPath = path.join(UPLOADS_DIR, filename);
        const r = await axios({ url: urlA, method: 'GET', responseType: 'arraybuffer', timeout: 90000 });
        fs.writeFileSync(destPath, Buffer.from(r.data));
        return res.json({ success: true, state: 'success', audioPath: `/uploads/${filename}`, concatenated: false });
      }
      // Both variants present — concat via crossfade into one 3-5 min track.
      try {
        const outName = await _concatSunoVariants(urlA, urlB, taskId);
        return res.json({ success: true, state: 'success', audioPath: `/uploads/${outName}`, concatenated: true });
      } catch (e) {
        console.error('[audio/suno/status] concat failed, falling back to single track:', e.message);
        const filename = `suno_${taskId}_${Date.now()}.mp3`;
        const destPath = path.join(UPLOADS_DIR, filename);
        const r = await axios({ url: urlA, method: 'GET', responseType: 'arraybuffer', timeout: 90000 });
        fs.writeFileSync(destPath, Buffer.from(r.data));
        return res.json({ success: true, state: 'success', audioPath: `/uploads/${filename}`, concatenated: false });
      }
    }
    if (FAILED.includes(status)) return res.json({ success: true, state: 'failed', error: data?.errorMessage || status });
    // FIRST_SUCCESS = first variant ready, second still cooking — keep polling
    return res.json({ success: true, state: 'pending', stage: status });
  } catch (err) {
    console.error('[audio/suno/status]', err.response?.data || err.message);
    res.status(502).json({ success: false, error: err.message });
  }
});

// GET /api/audio/suno/library
router.get('/audio/suno/library', (_req, res) => res.json({ success: true, list: _loadSunoLib() }));

// POST /api/audio/suno/library — save a generated track
router.post('/audio/suno/library', (req, res) => {
  const { id, title, audioPath, style } = req.body;
  if (!id || !audioPath) return res.status(400).json({ success: false, error: 'id and audioPath required' });
  const lib = _loadSunoLib();
  lib.unshift({ id, title: title || 'Untitled', audioPath, style: style || '', createdAt: new Date().toISOString() });
  _saveSunoLib(lib);
  res.json({ success: true });
});

// DELETE /api/audio/suno/library/:id
router.delete('/audio/suno/library/:id', (req, res) => {
  _saveSunoLib(_loadSunoLib().filter(t => t.id !== req.params.id));
  res.json({ success: true });
});

// ── POST /api/audio/sfx/generate ─────────────────────────────────────────────
// Body: { text, duration_seconds?, prompt_influence?, loop? }
// Calls ElevenLabs Sound Generation API; saves mp3 to uploads/audio/
router.post('/audio/sfx/generate', async (req, res) => {
  const { text, duration_seconds, prompt_influence, loop } = req.body;
  if (!text || !text.trim()) return res.status(400).json({ success: false, error: 'Нет описания звука' });

  const apiKey = _getElevenLabsApiKey();
  if (!apiKey) return res.status(400).json({ success: false, error: 'ElevenLabs API ключ не настроен. Добавь в Настройки.' });

  const payload = { text: text.trim() };
  if (duration_seconds && duration_seconds > 0) payload.duration_seconds = Math.min(22, parseFloat(duration_seconds));
  if (prompt_influence != null) payload.prompt_influence = Math.max(0, Math.min(1, parseFloat(prompt_influence)));
  if (loop === true) payload.loop = true;

  try {
    const r = await axios.post(
      `${EL_API_BASE}/sound-generation`,
      payload,
      {
        headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
        responseType: 'arraybuffer',
        timeout: 60000,
      }
    );
    const filename = `sfx_el_${Date.now()}.mp3`;
    const destPath = path.join(AUDIO_DIR, filename);
    fs.writeFileSync(destPath, Buffer.from(r.data));
    const name = text.trim().slice(0, 40);
    console.log(`[audio/sfx/generate] "${text.slice(0, 30)}" → ${filename}`);
    res.json({ success: true, webPath: `/uploads/audio/${filename}`, name });
  } catch (err) {
    const status = err.response?.status;
    const msg = status === 422 ? 'Invalid request (422): check text length/content' : (err.response?.data ? Buffer.from(err.response.data).toString('utf8').slice(0, 200) : err.message);
    console.error('[audio/sfx/generate]', status, err.message);
    res.status(502).json({ success: false, error: msg });
  }
});

module.exports = router;
