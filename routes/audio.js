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
  createQwen2TextTask, createSeedream5LiteTextTask, createNanoBananaProTextTask,
} = require('../lib/helpers');

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

// Name → ElevenLabs voice ID map (matches ELEVENLABS_VOICES in scen-state.js)
const EL_VOICE_IDS = {
  Rachel: '21m00Tcm4TlvDq8ikWAM', Charlotte: 'XB0fDUnXU5powFXDhCwa',
  Aria:   '9BWtsMINqrJLrRacOk9x', Sarah:     'EXAVITQu4vr4xnSDxMaL',
  Jessica:'cgSgspJ2msm6clMCkdW9', Laura:     'FGY2WhTYpPnrIDTdsKH5',
  Alice:  'Xb7hH8MSUJpSbSDYk0k2', Matilda:   'XrExE9yKIg1WjnnlVkGX',
  Hope:   'tnSpp4vdxKPjI9w0GnoV', Olivia:    '1hlpeD1ydbI2ow0Tt3EW',
  Emily:  '1cxc5c3E9K6F1wlqOJGV', Bella:     'hpp4J3VqNfWAUOO0d1Us',
  Ellen:  'BIvP0GN1cAtSRTxNHnWS', Lily:      'pFZP5JQG7iQjIQuC4Bku',
  Roger:  'CwhRNLy9XUrX3LVYE8qH', Brian:     'nPczCjzI2devNBz1zQrb',
  George: 'JBFqnCBsd6RMkjVDRZzb', Adam:      'pNInz6obpgDQGcFmaJgB',
  Charlie:'IKne3meq5aSn9XLyUdCD', Eric:      'cjVigY5qzO86Huf0OWal',
  Chris:  'iP95p4xoKVk53GoZ742B', Liam:      'TX3LPaxmHKxFdv7VOQHJ',
  Will:   'bIHbv24MWmeRgasZH58o', James:     'EkK5I93UQWFDigLMpZcX',
  Daniel: 'onwK4e9ZLuTAKqWW03F9', Callum:    'N2lVS1w4EtoT3dr4eOWO',
  Matthew:'IjnA9kwZJHJ20Fp7Vmy6', Bill:      'pqHfZKP75CvOlQylNhV4',
  Mark:   '1SM7GgM6IMuvQlz2BwM3', River:     'SAz9YHcvj6GT2YYXdXww',
};

// Direct ElevenLabs TTS call — returns saved audioPath
async function _elevenLabsTts(text, voiceName, ttsParams) {
  const apiKey = _getElevenLabsApiKey();
  if (!apiKey) throw new Error('ElevenLabs API ключ не настроен. Добавь в Настройки → CreationEngines.');

  // Known names → map to ID; custom voices send their ID directly as voiceName
  const voiceId = EL_VOICE_IDS[voiceName] || voiceName;
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
  const { voice, ttsParams = {}, model: reqModel } = req.body;
  const ttsModel    = reqModel || 'elevenlabs';
  const previewText = 'Hello! This is a voice preview.';

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
  const { imagePath, imageUrl: directImageUrl, audioPath, prompt, videoParams = {} } = req.body;
  if ((!imagePath && !directImageUrl) || !audioPath) return res.status(400).json({ success: false, error: 'Нет imageUrl/imagePath или audioPath' });
  try {
    const audioBuf = fs.readFileSync(path.join(__dirname, '..', audioPath.replace(/^\//, '')));
    let imageUrl;
    if (directImageUrl) {
      imageUrl = directImageUrl;
    } else {
      imageUrl = await uploadToPublicHost(fs.readFileSync(path.join(__dirname, '..', imagePath.replace(/^\//, ''))));
    }
    const audioUrl = await uploadToPublicHost(audioBuf);
    const taskRes = await axios.post(
      `${KIE_BASE}/api/v1/jobs/createTask`,
      {
        model: 'kling/ai-avatar-pro',
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
    res.json({ success: true, taskId });
  } catch (err) {
    console.error('[audio/avatar]', err.response?.data || err.message);
    res.status(502).json({ success: false, error: err.response?.data?.msg || err.message });
  }
});

// ── GET /api/audio/avatar/status/:taskId ──────────────────────────────────────
// Polls the Kling task; on success downloads the mp4 to uploads/ and returns { videoPath }
router.get('/audio/avatar/status/:taskId', async (req, res) => {
  const { taskId } = req.params;
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
// Body: { imageUrl | imagePath, text, detailImageUrl? | detailImagePath?, interactionText?, motionHint? }
// Accepts pre-uploaded URLs (skips upload) or local paths (uploads internally)
router.post('/audio/avatar-prompt', async (req, res) => {
  const { imagePath, imageUrl: directImageUrl, text, detailImagePath, detailImageUrl: directDetailUrl, interactionText, motionHint } = req.body;
  if ((!imagePath && !directImageUrl) || !text) return res.status(400).json({ success: false, error: 'Нет imageUrl/imagePath или text' });

  try {
    let imageUrl;
    if (directImageUrl) {
      imageUrl = directImageUrl;
    } else {
      const filePath = path.join(__dirname, '..', imagePath.replace(/^\//, ''));
      if (!fs.existsSync(filePath)) return res.status(400).json({ success: false, error: 'Изображение не найдено' });
      imageUrl = await uploadToPublicHost(fs.readFileSync(filePath));
    }

    let detailImageUrl = directDetailUrl || null;
    if (!detailImageUrl && detailImagePath) {
      const detailFilePath = path.join(__dirname, '..', detailImagePath.replace(/^\//, ''));
      if (fs.existsSync(detailFilePath)) {
        detailImageUrl = await uploadToPublicHost(fs.readFileSync(detailFilePath));
      }
    }
    const hasDetail = !!detailImageUrl;

    const interactionSection = interactionText
      ? `\n\n━━ USER-SPECIFIED INTERACTION STYLE (HIGHEST PRIORITY) ━━\nThe user has explicitly described how the character should interact with the item: "${interactionText}".\nThis overrides the default phrase-by-phrase suggestions below. Build the entire motion sequence around this interaction.`
      : '';
    const motionSection = motionHint
      ? `\n\n━━ USER-SPECIFIED MOVEMENT STYLE ━━\n"${motionHint}"\nUse this as the dominant movement character throughout.`
      : '';

    const systemPrompt =
`You are a motion director writing an animation prompt for Kling AI Avatar Pro.
You are given: (1) CHARACTER IMAGE — study their appearance, energy, posture, and background environment. ${hasDetail ? '(2) PRODUCT IMAGE — the item the character holds/interacts with during the video.' : ''}

The character will lip-sync to an audio file (provided separately). The audio drives the speech automatically — you describe ONLY motion, gestures, and camera work.

━━ ABSOLUTE RULE: NEVER QUOTE THE SCRIPT ━━
The script line is: """${text}"""
DO NOT include quoted words from this script in your output. DO NOT transcribe phrases. DO NOT write specific spoken text in quotation marks. Reference the script only via abstract tone descriptions like "contemplative tone", "energetic delivery", "thoughtful pause" — NEVER the exact words. The audio file conveys the speech via lip-sync; your prompt must describe only physical motion.${interactionSection}${motionSection}

OUTPUT: Write ONE English animation prompt, max 120 words. Describe the character's physical motion, hand gestures, eye contact, head movements, posture, and background. Respond with ONLY the prompt text — no explanations, no labels, no quotation marks.

━━ MOTION RULES ━━

1. CAMERA EYE CONTACT (70% rule) — character looks directly into camera for 70%+ of the video.

2. ${hasDetail
  ? `SECONDARY HAND — LIGHT PRODUCT INTERACTION (the dominant hand holds the container/item):
   • Points to the item with one finger
   • Lightly rotates or spins the item
   • Passes it between hands
   • Gently taps the packaging
   Pick 1–2 actions. Refer to the item generically ("the container", "the product", "the item") — DO NOT name the brand or describe any visible markings on the packaging.`
  : `HANDS — NO PRODUCT
   No item in hands. Natural gestures only (open-palm, gentle shrug, hand near chin, etc.). Do NOT mention any product, prop, or object.`}

3. BACKGROUND — subtle environmental motion (one short phrase): leaf sway, soft light shift, distant passing car. Plain studio → omit.

4. ABSTRACT MOTION SEGMENTS (2–3 segments, NO QUOTED WORDS):
   ${hasDetail ? '• Segment 1: opening tone (e.g. contemplative), reveal item gesture' : '• Segment 1: opening tone (e.g. relaxed confident), face camera'}
   • Segment 2: middle tone (e.g. emphatic), one expressive gesture
   • Segment 3: closing tone (e.g. confident), small nod, return eye contact

5. STYLE — calm, natural, smooth transitions. No exaggerated expressions. Photo-realistic cinematic look.`;

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
// Body: { prompt, duration?, resolution?, aspectRatio?, mode? }
// Submits a Grok text-to-video task and returns { taskId }
router.post('/video/grok-text', async (req, res) => {
  const { prompt, duration = '6', resolution = '480p', aspectRatio = '16:9', mode = 'normal' } = req.body;
  if (!prompt) return res.status(400).json({ success: false, error: 'Нет промпта' });
  try {
    const taskRes = await axios.post(
      `${KIE_BASE}/api/v1/jobs/createTask`,
      {
        model: 'grok-imagine/text-to-video',
        input: { prompt, duration: String(duration), resolution, aspect_ratio: aspectRatio, mode },
      },
      { headers: kieHeaders(), timeout: 30000 }
    );
    const taskId = taskRes.data?.data?.taskId;
    if (!taskId) return res.status(502).json({ success: false, error: 'kie.ai не вернул taskId', detail: taskRes.data });
    res.json({ success: true, taskId });
  } catch (err) {
    console.error('[video/grok-text]', err.response?.data || err.message);
    res.status(502).json({ success: false, error: err.response?.data?.msg || err.message });
  }
});

// ── GET /api/video/grok-text/status/:taskId ───────────────────────────────────
router.get('/video/grok-text/status/:taskId', async (req, res) => {
  const { taskId } = req.params;
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

      const filename = `grok_txt_${taskId}_${Date.now()}.mp4`;
      const destPath = path.join(UPLOADS_DIR, filename);
      const videoRes = await axios({ url: videoUrl, method: 'GET', responseType: 'arraybuffer', timeout: 60000 });
      fs.writeFileSync(destPath, Buffer.from(videoRes.data));
      return res.json({ success: true, state: 'success', videoPath: `/uploads/${filename}` });
    }

    if (state === 'failed') {
      return res.json({ success: true, state: 'failed', error: data?.failMsg || 'Grok text-to-video failed' });
    }

    return res.json({ success: true, state: state || 'pending' });
  } catch (err) {
    console.error('[video/grok-text/status]', err.response?.data || err.message);
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
// imageEngine: 'seedream'(default) | 'gptimage2' | 'qwen2' | 'nano-banana-2'
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

// ── POST /api/biroly/analyze-for-last-frame ──────────────────────────────────
// Body: { animationPrompt, frame1Path }
// Returns { framePrompt } — image generation prompt for the last frame
router.post('/biroly/analyze-for-last-frame', async (req, res) => {
  const { animationPrompt, frame1Path } = req.body;
  if (!animationPrompt || !frame1Path)
    return res.status(400).json({ success: false, error: 'Нет animationPrompt или frame1Path' });

  const filePath = path.join(__dirname, '..', frame1Path.replace(/^\//, ''));
  if (!fs.existsSync(filePath))
    return res.status(400).json({ success: false, error: 'Файл первого кадра не найден' });

  try {
    const imageUrl = await uploadToPublicHost(fs.readFileSync(filePath));

    const systemPrompt =
      `You are a professional image generation prompt engineer for AI video.\n\n` +
      `You see the FIRST FRAME of a short video clip.\n` +
      `Animation prompt (what happens during the clip): "${animationPrompt}"\n\n` +
      `Write a concise English image generation prompt (2–3 sentences) for the LAST FRAME — the final visual state after the animation ends.\n` +
      `Rules:\n` +
      `- The last frame must clearly differ from the first (different pose, action, position, or expression)\n` +
      `- Show the natural conclusion of the animation\n` +
      `- Keep the same subject, environment, and visual style as the first frame\n` +
      `- Photorealistic and cinematic\n\n` +
      `Return ONLY the image prompt — no explanations, no JSON, no labels.`;

    const framePrompt = await callAI([{ role: 'user', content: [
      { type: 'text',      text: systemPrompt },
      { type: 'image_url', image_url: { url: imageUrl } },
    ]}], { timeout: 30000, useOpenRouter: true });

    res.json({ success: true, framePrompt });
  } catch (err) {
    console.error('[biroly/analyze-for-last-frame]', err.message);
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

// ── POST /api/video/veo31 ─────────────────────────────────────────────────────
// Body: { frame1Path, frame2Path, prompt?, ratio?, resolution?, model? }
// Submits Veo 3.1 image-to-video (first + last frame) task
router.post('/video/veo31', async (req, res) => {
  const {
    frame1Path, frame2Path,
    prompt     = '',
    ratio      = '9:16',
    resolution = '780p',
    model      = 'veo-3.1-lite',
  } = req.body;

  if (!frame1Path || !frame2Path)
    return res.status(400).json({ success: false, error: 'Нужен frame1Path и frame2Path' });

  const f1Abs = path.join(__dirname, '..', frame1Path.replace(/^\//, ''));
  const f2Abs = path.join(__dirname, '..', frame2Path.replace(/^\//, ''));
  if (!fs.existsSync(f1Abs)) return res.status(400).json({ success: false, error: 'frame1 не найден' });
  if (!fs.existsSync(f2Abs)) return res.status(400).json({ success: false, error: 'frame2 не найден' });

  try {
    const [url1, url2] = await Promise.all([
      uploadToPublicHost(fs.readFileSync(f1Abs)),
      uploadToPublicHost(fs.readFileSync(f2Abs)),
    ]);

    const taskRes = await axios.post(
      `${KIE_BASE}/api/v1/jobs/createTask`,
      {
        model,
        input: {
          image_url:     url1,
          end_image_url: url2,
          prompt:        prompt || undefined,
          ratio,
          resolution,
        },
      },
      { headers: kieHeaders(), timeout: 30000 }
    );

    const taskId = taskRes.data?.data?.taskId;
    if (!taskId) return res.status(502).json({ success: false, error: 'kie.ai не вернул taskId', detail: taskRes.data });
    res.json({ success: true, taskId });
  } catch (err) {
    console.error('[video/veo31]', err.response?.data || err.message);
    res.status(502).json({ success: false, error: err.response?.data?.msg || err.message });
  }
});

// ── GET /api/video/veo31/status/:taskId ───────────────────────────────────────
router.get('/video/veo31/status/:taskId', async (req, res) => {
  const { taskId } = req.params;
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

      const filename = `veo31_${taskId}_${Date.now()}.mp4`;
      const destPath = path.join(UPLOADS_DIR, filename);
      const videoRes = await axios({ url: videoUrl, method: 'GET', responseType: 'arraybuffer', timeout: 120000 });
      fs.writeFileSync(destPath, Buffer.from(videoRes.data));
      return res.json({ success: true, state: 'success', videoPath: `/uploads/${filename}` });
    }

    if (state === 'failed')
      return res.json({ success: true, state: 'failed', error: data?.failMsg || 'Veo 3.1 generation failed' });

    return res.json({ success: true, state: state || 'pending' });
  } catch (err) {
    console.error('[video/veo31/status]', err.response?.data || err.message);
    res.status(502).json({ success: false, error: err.message });
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

    const taskRes = await axios.post(
      `${KIE_BASE}/api/v1/jobs/createTask`,
      {
        model: videoModel,
        input: {
          image_urls:   finalUrls,
          prompt:       prompt || undefined,
          duration:     String(duration),
          resolution,
          aspect_ratio: aspectRatio,
          mode,
        },
      },
      { headers: kieHeaders(), timeout: 30000 }
    );

    const taskId = taskRes.data?.data?.taskId;
    if (!taskId) return res.status(502).json({ success: false, error: 'kie.ai не вернул taskId', detail: taskRes.data });
    res.json({ success: true, taskId });
  } catch (err) {
    console.error('[video/grok]', err.response?.data || err.message);
    res.status(502).json({ success: false, error: err.response?.data?.msg || err.message });
  }
});

// ── GET /api/video/grok/status/:taskId ────────────────────────────────────────
// Polls the Grok task; on success downloads the mp4 to uploads/ and returns { videoPath }
router.get('/video/grok/status/:taskId', async (req, res) => {
  const { taskId } = req.params;
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
    const thumbsDir = path.join(UPLOADS_DIR, 'thumbs');
    const hasThumbsDir = fs.existsSync(thumbsDir);

    // Collect generated images with timestamps
    const images = allFiles
      .filter(f => f.startsWith('generated_') && f.endsWith('.jpg'))
      .map(f => {
        const st = fs.statSync(path.join(UPLOADS_DIR, f));
        const thumbExists = hasThumbsDir && fs.existsSync(path.join(thumbsDir, f));
        return { file: f, imagePath: `/uploads/${f}`, thumbPath: thumbExists ? `/uploads/thumbs/${f}` : `/uploads/${f}`, mtime: st.mtimeMs };
      });

    // Collect grok videos and pair with nearest preceding image
    const MATCH_WINDOW_MS = 30 * 60 * 1000; // 30 minutes
    const usedImages = new Set();

    const files = allFiles
      .filter(f => f.startsWith('grok_') && f.endsWith('.mp4'))
      .map(f => {
        const st = fs.statSync(path.join(UPLOADS_DIR, f));
        return { file: f, videoPath: `/uploads/${f}`, mtime: st.mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime)
      .map(v => {
        // Find closest image created before this video (within window), not yet used
        const candidates = images
          .filter(img => !usedImages.has(img.file) && img.mtime <= v.mtime && (v.mtime - img.mtime) <= MATCH_WINDOW_MS)
          .sort((a, b) => b.mtime - a.mtime);
        const best = candidates[0] || null;
        if (best) usedImages.add(best.file);
        return {
          videoPath: v.videoPath,
          mtime: v.mtime,
          imagePath: best ? best.imagePath : null,
          thumbPath: best ? best.thumbPath : null,
        };
      });

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
        const words  = (result.words || [])
          .filter(w => typeof w.start === 'number')
          .map(w => ({ text: w.word || w.text || '', start: w.start + timeOffset, end: (w.end ?? w.start + 0.3) + timeOffset }));
        console.log(`[stt/groq] segment ${i + 1}: ${words.length} words, duration ${(result.duration || 0).toFixed(1)}s`);
        allWords.push(...words);

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
        const words  = (result.words || [])
          .filter(w => w.type === 'word' && typeof w.start === 'number')
          .map(w => ({ text: w.text, start: w.start + timeOffset, end: (w.end || w.start + 0.3) + timeOffset }));
        allWords.push(...words);
      }
    }

    if (!allWords.length) throw new Error('Не удалось получить слова из аудио');

    // Generate SRT
    const srtContent = _wordsToSrt(allWords);
    const srtName    = `subs_${jobId}.srt`;
    const srtPath    = path.join(TEMP_DIR, srtName);
    fs.writeFileSync(srtPath, srtContent, 'utf8');

    _sttJobs[jobId] = { state: 'done', progress: '', srtPath: `/temp_files/${srtName}`, srtContent, words: allWords, error: null };
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
router.post('/audio/suno/generate', async (req, res) => {
  const { style, title, negativeTags, styleWeight, weirdnessConstraint, model = 'V4_5PLUS' } = req.body;
  if (!style) return res.status(400).json({ success: false, error: 'Нет style' });
  const BG_SUFFIX = ', background music for UGC short video, non-intrusive, subtle energy, no lyrics';
  const fullStyle = (style + BG_SUFFIX).slice(0, 1000);
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
    if (status === 'FIRST_SUCCESS' || status === 'SUCCESS') {
      const audioUrl = data?.response?.sunoData?.[0]?.audioUrl;
      if (!audioUrl) return res.json({ success: true, state: 'pending' });
      const filename = `suno_${taskId}_${Date.now()}.mp3`;
      const destPath = path.join(UPLOADS_DIR, filename);
      const audioRes = await axios({ url: audioUrl, method: 'GET', responseType: 'arraybuffer', timeout: 60000 });
      fs.writeFileSync(destPath, Buffer.from(audioRes.data));
      return res.json({ success: true, state: 'success', audioPath: `/uploads/${filename}` });
    }
    if (FAILED.includes(status)) return res.json({ success: true, state: 'failed', error: data?.errorMessage || status });
    return res.json({ success: true, state: 'pending' });
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
