'use strict';

const express = require('express');
const path    = require('path');
const fs      = require('fs');
const axios   = require('axios');
const multer  = require('multer');
const router  = express.Router();

const FormData = require('form-data');
const { KIE_BASE, UPLOADS_DIR, TEMP_DIR, ROOT_DIR, DATA_DIR } = require('../lib/config');
const { kieHeaders, uploadToPublicHost, callAI } = require('../lib/helpers');

// ── Groq API ──────────────────────────────────────────────────────────────────
const GROQ_API_BASE  = 'https://api.groq.com/openai/v1';
const SETTINGS_FILE  = path.join(DATA_DIR, 'settings.json');

function _getGroqApiKey() {
  try {
    const s = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    if (s.groqApiKey && s.groqApiKey.trim()) return s.groqApiKey.trim();
  } catch {}
  return process.env.GROQ_API_KEY || '';
}

// Send audio buffer directly to Groq Whisper; returns { words: [{word,start,end}], text, duration }
async function _groqStt(buf, filename, language) {
  const apiKey = _getGroqApiKey();
  if (!apiKey) throw new Error('Groq API ключ не настроен. Добавь GROQ_API_KEY в .env или в Настройки → CreationEngines.');

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

// POST /api/audio/upload-file  — multipart: file (audio binary), name? (string)
router.post('/audio/upload-file', _audioUpload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, error: 'Нет файла' });
  const origBase = path.basename(req.file.originalname, path.extname(req.file.originalname));
  const name     = ((req.body && req.body.name) || origBase || 'track').slice(0, 60);
  const webPath  = `/uploads/audio/${req.file.filename}`;
  res.json({ success: true, webPath, name, filename: req.file.filename });
});

// ── POST /api/audio/tts ───────────────────────────────────────────────────────
// Body: { text, voice }
// Submits an ElevenLabs TTS task and returns { taskId }
router.post('/audio/tts', async (req, res) => {
  const { text, voice, ttsParams = {} } = req.body;
  if (!text) return res.status(400).json({ success: false, error: 'Нет текста' });

  try {
    const taskRes = await axios.post(
      `${KIE_BASE}/api/v1/jobs/createTask`,
      {
        model: 'elevenlabs/text-to-speech-turbo-2-5',
        input: {
          text,
          voice:            voice || 'Rachel',
          stability:        ttsParams.stability        ?? 0.5,
          similarity_boost: ttsParams.similarity_boost ?? 0.75,
          style:            ttsParams.style            ?? 0,
          speed:            ttsParams.speed            ?? 1,
        },
      },
      { headers: kieHeaders(), timeout: 30000 }
    );
    const taskId = taskRes.data?.data?.taskId;
    if (!taskId) return res.status(502).json({ success: false, error: 'kie.ai не вернул taskId', detail: taskRes.data });
    res.json({ success: true, taskId });
  } catch (err) {
    console.error('[audio/tts]', err.response?.data || err.message);
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

// ── POST /api/audio/avatar ────────────────────────────────────────────────────
// Body: { imagePath, audioPath, prompt }
// Uploads both files to public host then submits a Kling AI Avatar Pro task
router.post('/audio/avatar', async (req, res) => {
  const { imagePath, audioPath, prompt, videoParams = {} } = req.body;
  if (!imagePath || !audioPath) return res.status(400).json({ success: false, error: 'Нет imagePath или audioPath' });
  try {
    const imgBuf   = fs.readFileSync(path.join(__dirname, '..', imagePath.replace(/^\//, '')));
    const audioBuf = fs.readFileSync(path.join(__dirname, '..', audioPath.replace(/^\//, '')));
    const [imageUrl, audioUrl] = await Promise.all([
      uploadToPublicHost(imgBuf),
      uploadToPublicHost(audioBuf),
    ]);
    const taskRes = await axios.post(
      `${KIE_BASE}/api/v1/jobs/createTask`,
      {
        model: 'kling/ai-avatar-pro',
        input: {
          image_url: imageUrl,
          audio_url: audioUrl,
          prompt: videoParams.prompt || prompt || 'Natural speaking motion with subtle head movement',
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
// Body: { imagePath, text }
// Uses Gemini to generate a concise animation prompt for Kling AI Avatar Pro
// based on the character image and the script line being spoken.
router.post('/audio/avatar-prompt', async (req, res) => {
  const { imagePath, text, interactionText, motionHint } = req.body;
  if (!imagePath || !text) return res.status(400).json({ success: false, error: 'Нет imagePath или text' });

  const filePath = path.join(__dirname, '..', imagePath.replace(/^\//, ''));
  if (!fs.existsSync(filePath)) return res.status(400).json({ success: false, error: 'Изображение не найдено' });

  try {
    const imgBuf   = fs.readFileSync(filePath);
    const imageUrl = await uploadToPublicHost(imgBuf);

    const interactionSection = interactionText
      ? `\n\n━━ USER-SPECIFIED INTERACTION STYLE (HIGHEST PRIORITY) ━━\nThe user has explicitly described how the character should interact with the item: "${interactionText}".\nThis overrides the default phrase-by-phrase suggestions below. Build the entire motion sequence around this interaction — every gesture, hand movement, and item handling must reflect this description. Translate it faithfully into physical animation actions.`
      : '';
    const motionSection = motionHint
      ? `\n\n━━ USER-SPECIFIED MOVEMENT STYLE ━━\n"${motionHint}"\nUse this as the dominant movement character throughout.`
      : '';

    const systemPrompt =
`You are a motion director writing an animation prompt for Kling AI Avatar Pro.
Study the character image carefully: note their appearance, energy, and — CRITICALLY — what product/item they are holding or have nearby.
The character is speaking this script line in a commercial UGC video: "${text}"${interactionSection}${motionSection}

OUTPUT: Write ONE English animation prompt, max 160 words. Respond with ONLY the prompt text — no explanations, no quotes, no labels.

━━ MANDATORY RULES ━━

1. CAMERA EYE CONTACT (70 % rule)
   The character MUST look directly into the camera for at least 70 % of the video duration. This is a commercial — they are speaking TO the viewer. Even if in the source photo they look sideways, in the animation they primarily face and address the camera. Describe this explicitly: "maintains direct eye contact with camera", "speaks directly to viewer", "looks straight into lens".

2. PHRASE-BY-PHRASE ACTIONS
   Break the script line into 2-3 natural phrase segments. For each segment assign one fitting physical action.${interactionText ? ' IMPORTANT: actions must be grounded in the user-specified interaction style above — use the default suggestions only as a fallback.' : ' Choose actions that match BOTH the phrase meaning AND what the item actually is (infer from the image):'}
   • Product reveal / feature phrase → hold item up toward camera, tilt to show label/contents, tap the package with a finger
   • Opening / ingredient phrase → mime unscrewing a cap, peeling a lid, squeezing a tube, pouring
   • Emotional claim / exclamation → slight lean forward, expressive hand gesture toward viewer
   • Thinking / rhetorical pause → brief glance slightly away for half a second, subtle head tilt, then back to camera
   • Closing / call-to-action → direct eye contact, confident small nod, item held naturally at chest height

3. UGC STYLE — keep all movements calm, natural, authentic. No exaggerated expressions. Smooth transitions between eye contact and item interactions.

Structure: start facing camera → mid-phrase item interaction → return to direct eye contact at end.`;


    const prompt = await callAI([{ role: 'user', content: [
      { type: 'text',      text: systemPrompt },
      { type: 'image_url', image_url: { url: imageUrl } },
    ]}], { timeout: 30000 });

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
    }], { timeout: 15000 });
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
      { timeout: 30000 }
    );
    res.json({ success: true, prompt: enhanced });
  } catch (err) {
    console.error('[biroly/enhance-realism]', err.response?.data || err.message);
    res.status(502).json({ success: false, error: err.response?.data?.msg || err.message });
  }
});

// ── POST /api/biroly/gen-image ────────────────────────────────────────────────
// Body: { prompt, aspectRatio? }
// Submits a seedream text-to-image task; poll result via GET /api/status/:taskId
router.post('/biroly/gen-image', async (req, res) => {
  const { prompt, aspectRatio = '9:16' } = req.body;
  if (!prompt) return res.status(400).json({ success: false, error: 'Нет промпта' });
  try {
    const taskRes = await axios.post(
      `${KIE_BASE}/api/v1/jobs/createTask`,
      { model: 'seedream/5-lite-text-to-image', input: { prompt, aspect_ratio: aspectRatio, quality: 'basic' } },
      { headers: kieHeaders(), timeout: 30000 }
    );
    const taskId = taskRes.data?.data?.taskId;
    if (!taskId) return res.status(502).json({ success: false, error: 'kie.ai не вернул taskId', detail: taskRes.data });
    res.json({ success: true, taskId });
  } catch (err) {
    console.error('[biroly/gen-image]', err.response?.data || err.message);
    res.status(502).json({ success: false, error: err.response?.data?.msg || err.message });
  }
});

// ── POST /api/biroly/analyze-for-video ───────────────────────────────────────
// Body: { imagePath }
// Uses Gemini to analyze the generated image and produce a quality Grok video prompt
router.post('/biroly/analyze-for-video', async (req, res) => {
  const { imagePath } = req.body;
  if (!imagePath) return res.status(400).json({ success: false, error: 'Нет imagePath' });
  const filePath = path.join(__dirname, '..', imagePath.replace(/^\//, ''));
  if (!fs.existsSync(filePath)) return res.status(400).json({ success: false, error: 'Изображение не найдено' });
  try {
    const imgBuf   = fs.readFileSync(filePath);
    const imageUrl = await uploadToPublicHost(imgBuf);

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
    ]}], { timeout: 30000 });

    res.json({ success: true, prompt: videoPrompt });
  } catch (err) {
    console.error('[biroly/analyze-for-video]', err.response?.data || err.message);
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
    ], { timeout: 20000, maxAttempts: 2 });

    res.json({ success: true, text: text.replace(/^["']|["']$/g, '').trim() });
  } catch (err) {
    console.error('[biroly/gen-variant]', err.message);
    res.status(502).json({ success: false, error: err.message });
  }
});

// ── POST /api/video/grok ──────────────────────────────────────────────────────
// Body: { imagePath?, imageUrls?, prompt?, duration?, resolution?, aspectRatio?, mode? }
// Uploads local file (if imagePath given) then submits a Grok image-to-video task.
// Returns { taskId }
router.post('/video/grok', async (req, res) => {
  const {
    imagePath,
    imageUrls,
    prompt       = '',
    duration     = '6',
    resolution   = '480p',
    aspectRatio  = '16:9',
    mode         = 'normal',
  } = req.body;

  try {
    let finalUrls = [];

    if (imageUrls && Array.isArray(imageUrls) && imageUrls.length) {
      finalUrls = imageUrls;
    } else if (imagePath) {
      const buf = fs.readFileSync(path.join(__dirname, '..', imagePath.replace(/^\//, '')));
      finalUrls = [await uploadToPublicHost(buf)];
    } else {
      return res.status(400).json({ success: false, error: 'Нужен imagePath или imageUrls' });
    }

    const taskRes = await axios.post(
      `${KIE_BASE}/api/v1/jobs/createTask`,
      {
        model: 'grok-imagine/image-to-video',
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

module.exports = router;
