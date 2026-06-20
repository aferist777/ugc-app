'use strict';

const express = require('express');
const path    = require('path');
const fs      = require('fs');
const axios   = require('axios');
const router  = express.Router();

const { UPLOADS_DIR, CHARACTERS_DIR, KIE_BASE, CHAR_OPTIMIZE_MODEL } = require('../lib/config');
const { compileImagePrompt } = require('../lib/prompt-compiler');
const {
  kieHeaders, getImgVisionModel,
  callAI, callAIBase64, callAIVision, callAIVisionWithFallback,
  analyzeWithGemini, analyzeRealismMarkers, translateToEnglish, buildPrompt,
  uploadToPublicHost, downloadImage, compressBelow9MB, createThumbnail,
  createNanoBananaProTask, createQwen2Task, createGptImage2Task, createSeedream5LiteTask, createSeedream45Task, createZImageTurboTask, createFlux11UltraTask, createFlux2MaxTask, createFireredEditTask, resolveTask,
} = require('../lib/helpers');
const { getPrompt } = require('../lib/prompts');
const { addPendingTask, removePendingTask } = require('../lib/pending-tasks');

// ── Random face proxy ─────────────────────────────────────────────────────────
router.get('/random-face', async (_req, res) => {
  try {
    const response = await axios({
      method: 'GET',
      url: 'https://thispersondoesnotexist.com/',
      responseType: 'arraybuffer',
      timeout: 15000,
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    // Persist to /uploads/ so the TPDNE active image survives page reloads
    // (gated lookbook flow needs a stable path for the source face).
    const filename = `tpdne_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`;
    const absPath  = path.join(UPLOADS_DIR, filename);
    fs.writeFileSync(absPath, Buffer.from(response.data));
    createThumbnail(absPath, path.join(UPLOADS_DIR, 'thumbs', filename))
      .catch(e => console.warn('[random-face thumb]', e.message));
    res.json({ success: true, imagePath: `/uploads/${filename}` });
  } catch (err) {
    res.status(502).json({ success: false, error: err.message });
  }
});

// ── Refine: send image + instruction to GPT-5.2, extract generated image ─────
router.post('/character/refine-analyze', async (req, res) => {
  const { imagePath, userInstruction } = req.body;
  if (!imagePath || !userInstruction?.trim())
    return res.status(400).json({ success: false, error: 'imagePath and userInstruction are required' });
  try {
    const absPath = path.join(__dirname, '..', imagePath.replace(/^\//, ''));
    const imageBuffer = fs.readFileSync(absPath);
    const imageBase64 = imageBuffer.toString('base64');
    const imageMime = imagePath.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
    const imageDataUrl = `data:${imageMime};base64,${imageBase64}`;

    const messages = [
      {
        role: 'system',
        content: `You are an AI image editor. The user will provide a photo and a change request. Generate a new image that applies the requested change while faithfully preserving the character's identity, facial features, and visual style from the original photo. IMPORTANT: Do NOT change the pose, body position, or camera angle unless the user explicitly requests it.`,
      },
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: imageDataUrl } },
          { type: 'text', text: userInstruction.trim() },
        ],
      },
    ];

    const r = await axios.post(
      `${KIE_BASE}/gpt-5-2/v1/chat/completions`,
      { stream: false, messages },
      { headers: kieHeaders(), timeout: 90000 }
    );

    const content = (r.data?.choices?.[0]?.message?.content || '');
    console.log('[refine-analyze] GPT-5.2 response:', content.slice(0, 300));

    const match = content.match(/!\[[^\]]*\]\((https?:\/\/[^)]+)\)/);
    if (!match) throw new Error('GPT-5.2 did not return an image in the response');

    const remoteImageUrl = match[1];
    const filename = `generated_refine_${Date.now()}.jpg`;
    const destPath  = path.join(UPLOADS_DIR, filename);
    await downloadImage(remoteImageUrl, destPath);
    await compressBelow9MB(destPath);
    createThumbnail(destPath, path.join(UPLOADS_DIR, 'thumbs', filename))
      .catch(e => console.warn('[refine thumb]', e.message));

    console.log('[refine-analyze] saved:', filename);
    res.json({ success: true, imagePath: `/uploads/${filename}` });
  } catch (err) {
    console.error('[refine-analyze]', err.message);
    res.status(502).json({ success: false, error: err.message });
  }
});

// ── Apply pose: vision analysis → ready prompt ───────────────────────────────
router.post('/character/apply-pose', async (req, res) => {
  const { imagePath, poseDescription } = req.body;
  if (!imagePath || !poseDescription?.trim())
    return res.status(400).json({ success: false, error: 'imagePath and poseDescription are required' });
  try {
    const absPath = path.join(__dirname, '..', imagePath.replace(/^\//, ''));
    const imageBuffer = fs.readFileSync(absPath);
    const imageUrl = await uploadToPublicHost(imageBuffer);

    // Editable in Brain → Character → "Image analysis & variations" group.
    // {POSE} placeholder is substituted at request time.
    const instruction = getPrompt('APPLY_POSE_ANALYZE_PROMPT')
      .replace('{POSE}', poseDescription.trim());

    const messages = [{
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: imageUrl } },
        { type: 'text', text: instruction },
      ],
    }];

    const prompt = await callAIVisionWithFallback(messages, { useOpenRouter: true, openRouterModel: getImgVisionModel() });
    console.log('[apply-pose] prompt:', prompt.slice(0, 120));
    res.json({ success: true, prompt });
  } catch (err) {
    console.error('[apply-pose]', err.message);
    res.status(502).json({ success: false, error: err.message });
  }
});

// ── Apply lookbook (mix): face + lookbook → ready generation prompt ──────────
// Vision-LLM gets BOTH images (active face + lookbook outfit) and writes a
// single waist-up portrait prompt that dresses the face in the outfit on a
// neutral contrasting background. Used by TPDNE/upload-gated flow.
router.post('/character/apply-lookbook-mix', async (req, res) => {
  const { imagePath, lookbookImagePath } = req.body;
  if (!imagePath || !lookbookImagePath?.trim())
    return res.status(400).json({ success: false, error: 'imagePath and lookbookImagePath are required' });
  try {
    const faceAbs = path.join(__dirname, '..', imagePath.replace(/^\//, ''));
    const lbAbs   = path.join(__dirname, '..', lookbookImagePath.replace(/^\//, ''));
    if (!fs.existsSync(faceAbs)) return res.status(400).json({ success: false, error: 'Active image not found on disk' });
    if (!fs.existsSync(lbAbs))   return res.status(400).json({ success: false, error: 'Lookbook image not found on disk' });

    const [faceUrl, lbUrl] = await Promise.all([
      uploadToPublicHost(fs.readFileSync(faceAbs)),
      uploadToPublicHost(fs.readFileSync(lbAbs)),
    ]);

    const instruction = getPrompt('APPLY_LOOKBOOK_MIX_PROMPT');

    const messages = [{
      role: 'user',
      content: [
        { type: 'text', text: instruction },
        { type: 'image_url', image_url: { url: faceUrl } },
        { type: 'image_url', image_url: { url: lbUrl } },
      ],
    }];

    const prompt = await callAIVisionWithFallback(messages, { timeout: 45000, useOpenRouter: true, openRouterModel: getImgVisionModel() });
    console.log('[apply-lookbook-mix] prompt:', prompt.slice(0, 160));
    res.json({ success: true, prompt });
  } catch (err) {
    console.error('[apply-lookbook-mix]', err.message);
    res.status(502).json({ success: false, error: err.message });
  }
});

// ── Apply emotion: vision analysis → ready prompt ─────────────────────────────
router.post('/character/apply-emotion', async (req, res) => {
  const { imagePath, emotionDescription } = req.body;
  if (!imagePath || !emotionDescription?.trim())
    return res.status(400).json({ success: false, error: 'imagePath and emotionDescription are required' });
  try {
    const absPath = path.join(__dirname, '..', imagePath.replace(/^\//, ''));
    const imageBuffer = fs.readFileSync(absPath);
    const imageUrl = await uploadToPublicHost(imageBuffer);

    // Editable in Brain → Character → "Image analysis & variations" group.
    // {EMOTION} placeholder is substituted at request time.
    const instruction = getPrompt('APPLY_EMOTION_ANALYZE_PROMPT')
      .replace('{EMOTION}', emotionDescription.trim());

    const messages = [{
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: imageUrl } },
        { type: 'text', text: instruction },
      ],
    }];

    const prompt = await callAIVisionWithFallback(messages, { useOpenRouter: true, openRouterModel: getImgVisionModel() });
    console.log('[apply-emotion] prompt:', prompt.slice(0, 120));
    res.json({ success: true, prompt });
  } catch (err) {
    console.error('[apply-emotion]', err.message);
    res.status(502).json({ success: false, error: err.message });
  }
});

// ── Generate character ────────────────────────────────────────────────────────
router.post('/generate', async (req, res) => {
  const {
    age, gender, faceBase64, imagePath: localImagePath, extraInstruction,
    poseKey, emotion, imageEngine, withRealism,
    customPosePrompt, customEmotionPrompt,
    readyPrompt, skipTranslate,
  } = req.body;
  const engine = (imageEngine === 'qwen2') ? 'qwen2' : (imageEngine === 'seedream') ? 'seedream' : (imageEngine === 'seedream4.5') ? 'seedream4.5' : (imageEngine === 'gptimage2') ? 'gptimage2' : (imageEngine === 'flux-2-max') ? 'flux-2-max' : (imageEngine === 'firered-edit') ? 'firered-edit' : 'nano-banana-2';
  // Generate a reproducible seed for this request
  const seed = Math.floor(Math.random() * 999_999_999) + 1;

  if (!readyPrompt && !extraInstruction) {
    if (!age || !gender)
      return res.status(400).json({ success: false, error: 'Укажите возраст и пол' });
  }
  if (!faceBase64 && !localImagePath)
    return res.status(400).json({ success: false, error: 'Загрузите изображение лица' });

  try {
    let imageBuffer, imageBase64ForGemini;

    if (faceBase64) {
      imageBuffer = Buffer.from(faceBase64, 'base64');
      imageBase64ForGemini = faceBase64;
    } else {
      const absPath = path.join(__dirname, '..', localImagePath.replace(/^\//, ''));
      imageBuffer = fs.readFileSync(absPath);
      imageBase64ForGemini = imageBuffer.toString('base64');
    }

    let prompt, skinTraits = [];

    if (readyPrompt) {
      // Pre-built prompt from refine-analyze — skip all analysis and parameter assembly
      prompt = readyPrompt;
      console.log('[generate] using readyPrompt, length:', prompt.length);
    } else {
      // Resolve emotion modifier: custom string → use directly; built-in key → look up
      let emotionModifier = '';
      if (customEmotionPrompt) {
        emotionModifier = customEmotionPrompt;
      } else if (emotion && emotion !== 'neutral') {
        emotionModifier = getPrompt(`emotion_${emotion}`);
      }

      const { enabledMarkers = [] } = req.body;

      let translatedInstruction = extraInstruction || '';
      if (extraInstruction) {
        if (!skipTranslate) {
          translatedInstruction = await translateToEnglish(extraInstruction);
        }
      } else {
        skinTraits = await analyzeWithGemini(imageBase64ForGemini);
      }

      // Always apply settings markers; if withRealism, AI picks the contextually relevant subset
      const cleanEnabled = enabledMarkers.map(s => s.trim()).filter(Boolean);
      let realismMarkers = '';
      if (withRealism && cleanEnabled.length) {
        try {
          realismMarkers = await analyzeRealismMarkers(imageBase64ForGemini, cleanEnabled);
          console.log('[generate] realism markers (AI-filtered):', realismMarkers);
        } catch (e) {
          console.warn('[generate] realism analysis failed:', e.message);
          realismMarkers = cleanEnabled.join(', ');
        }
      } else {
        realismMarkers = cleanEnabled.join(', ');
      }
      if (realismMarkers) console.log('[generate] realism markers (final):', realismMarkers);

      let sceneTemplate = null;
      if (!extraInstruction) {
        if (customPosePrompt) {
          sceneTemplate = customPosePrompt;
        } else if (poseKey) {
          sceneTemplate = getPrompt(poseKey);
        }
      }
      prompt = buildPrompt(age, gender, skinTraits, translatedInstruction, sceneTemplate, emotionModifier, realismMarkers);
    }

    const imageUrl = await uploadToPublicHost(imageBuffer);

    console.log('[generate] engine:', engine, '| seed:', seed);

    let taskId;
    if (engine === 'qwen2') {
      taskId = await createQwen2Task(prompt, imageUrl, '9:16', seed);
    } else if (engine === 'seedream') {
      taskId = await createSeedream5LiteTask(prompt, [imageUrl], '9:16', 'basic');
    } else if (engine === 'seedream4.5') {
      taskId = await createSeedream45Task(prompt, [imageUrl], '9:16', 'basic');
    } else if (engine === 'gptimage2') {
      taskId = await createGptImage2Task(prompt, [imageUrl], '9:16');
    } else if (engine === 'flux-2-max') {
      taskId = await createFlux2MaxTask(prompt, [imageUrl], '9:16');
    } else if (engine === 'firered-edit') {
      taskId = await createFireredEditTask(prompt, imageUrl);   // match_input_image keeps base framing
    } else {
      taskId = await createNanoBananaProTask(prompt, imageUrl, '9:16', { seed });
    }

    if (!taskId) {
      return res.status(502).json({ success: false, error: 'kie.ai не вернул taskId' });
    }

    addPendingTask(taskId, 'uploads', 'generated', 'generate');
    res.json({ success: true, taskId, skinTraits, seed });
  } catch (err) {
    console.error('[generate]', err.response?.data || err.message);
    res.status(502).json({ success: false, error: err.response?.data?.msg || err.message });
  }
});

// ── Poll generation status ────────────────────────────────────────────────────
// Universal poll endpoint. resolveTask dispatches by taskId prefix:
//   'repl:<id>' → Replicate polling
//   otherwise   → kie.ai recordInfo
// Same response shape from both providers.
router.get('/status/:taskId', async (req, res) => {
  const { taskId } = req.params;
  const provider = (typeof taskId === 'string' && taskId.startsWith('repl:')) ? 'Replicate' : 'kie.ai';
  console.log('[/api/status]', taskId.slice(0, 60), '→', provider);
  try {
    const result = await resolveTask(taskId, UPLOADS_DIR, 'generated');
    if (result.state === 'success' || result.state === 'failed') removePendingTask(taskId);
    console.log('[/api/status]', taskId.slice(0, 30), 'state:', result.state, result.imagePath || result.error || '');
    return res.json({ success: true, ...result });
  } catch (err) {
    console.error('[status]', err.response?.data || err.message);
    res.status(502).json({ success: false, error: err.message });
  }
});

// ── Character creator: TEXT-TO-IMAGE base generation (no source image) ────────
// Compiles the creator's JSON spec into one clean portrait prompt (deterministic
// template; the optional Hermes "AI-optimize" is a later step) and runs a t2i
// engine — default prunaai/z-image-turbo. Result lands in uploads/ and is polled
// via the shared GET /api/status (repl: tasks auto-route to Replicate).
function _specToPortraitPrompt(spec) {
  if (!spec || typeof spec !== 'object') return '';
  const bits = [];
  const subj = [spec.age, spec.ethnicity, spec.gender].filter(Boolean).join(' ');
  let lead = (spec.type || 'character portrait') + ' of a ' + (subj || 'person');
  if (spec.framing) lead += ', ' + spec.framing;
  bits.push(lead);
  if (spec.expression) bits.push(spec.expression + ' expression');
  if (spec.skin_tone) bits.push(spec.skin_tone + ' skin');
  if (spec.hair) { const h = [spec.hair.length, spec.hair.color, spec.hair.style].filter(Boolean).join(' '); if (h) bits.push(h + ' hair'); }
  if (spec.eyes) { const e = [spec.eyes.shape, spec.eyes.color].filter(Boolean).join(' '); if (e) bits.push(e + ' eyes'); }
  if (spec.face_shape) bits.push(spec.face_shape + ' face shape');
  if (spec.eyebrows) bits.push(spec.eyebrows + ' eyebrows');
  if (spec.facial_hair) bits.push(spec.facial_hair);
  if (Array.isArray(spec.marks) && spec.marks.length) bits.push(spec.marks.join(', '));
  if (spec.makeup) bits.push(spec.makeup + ' makeup');
  let p = bits.join(', ') + '.';
  if (spec.background) p += ' Background: ' + spec.background + '.';
  if (Array.isArray(spec.realism) && spec.realism.length) p += ' ' + spec.realism.join(', ') + '.';
  if (Array.isArray(spec.negative) && spec.negative.length) p += ' Avoid: ' + spec.negative.join(', ') + '.';
  return p.trim();
}
const _CC_T2I_ENGINES = { 'z-turbo': 1, 'flux-1.1-ultra': 1, 'flux-2-max': 1, 'nano-banana-2': 1, 'gptimage2': 1, 'seedream': 1, 'seedream4.5': 1 };

router.post('/character-creator/generate', async (req, res) => {
  try {
    const { spec, prompt, imageEngine, width, height } = req.body;
    let finalPrompt = (prompt && String(prompt).trim()) || '';
    if (!finalPrompt && spec != null) {
      if (typeof spec === 'object') {
        finalPrompt = _specToPortraitPrompt(spec);
      } else {
        const s = String(spec).trim();
        let obj = null; try { obj = JSON.parse(s); } catch (e) {}
        finalPrompt = (obj && typeof obj === 'object') ? _specToPortraitPrompt(obj) : s;
      }
    }
    if (!finalPrompt) return res.status(400).json({ success: false, error: 'Пустая спецификация персонажа' });

    const engine = (imageEngine && _CC_T2I_ENGINES[imageEngine]) ? imageEngine : 'z-turbo';
    const W = Math.max(64, Math.min(2048, parseInt(width, 10) || 768));
    const H = Math.max(64, Math.min(2048, parseInt(height, 10) || 1344));

    let taskId;
    if (engine === 'z-turbo') {
      taskId = await createZImageTurboTask(finalPrompt, { width: W, height: H });
    } else if (engine === 'flux-1.1-ultra') {
      taskId = await createFlux11UltraTask(finalPrompt, '9:16');
    } else if (engine === 'flux-2-max') {
      taskId = await createFlux2MaxTask(finalPrompt, null, '9:16');
    } else if (engine === 'gptimage2') {
      taskId = await createGptImage2Task(finalPrompt, null, '9:16');
    } else if (engine === 'seedream') {
      taskId = await createSeedream5LiteTask(finalPrompt, null, '9:16', 'basic');
    } else if (engine === 'seedream4.5') {
      taskId = await createSeedream45Task(finalPrompt, null, '9:16', 'basic');
    } else {
      taskId = await createNanoBananaProTask(finalPrompt, null, '9:16');
    }
    if (!taskId) return res.status(502).json({ success: false, error: 'Движок не вернул taskId' });

    addPendingTask(taskId, 'uploads', 'generated', 'character-base');
    console.log('[character-creator/generate] engine:', engine, '| prompt:', finalPrompt.slice(0, 140));
    res.json({ success: true, taskId, engine, prompt: finalPrompt });
  } catch (err) {
    console.error('[character-creator/generate]', err.response?.data || err.message);
    res.status(502).json({ success: false, error: err.response?.data?.msg || err.message });
  }
});

// ── Character creator: AI-optimize the JSON spec into an engine-ideal prompt ───
// Hermes 4 405B rewrites the structured spec into one vivid portrait prompt
// (clean realism, no device). The client caches the result by spec.
const _CHAR_OPTIMIZE_TPL =
  'You are a prompt engineer for a photorealistic PORTRAIT image model. Rewrite the character spec below into ONE vivid natural-language prompt (2-4 sentences) for a text-to-image diffusion model.\n' +
  'Describe the person head-and-shoulders, looking at the camera. Keep clean photoreal portrait realism: detailed skin texture with visible pores, soft studio lighting, sharp focus, high detail. Background: a plain neutral mid-grey studio backdrop contrasting with the subject.\n' +
  'Preserve every concrete detail from the spec (age, gender, ethnicity, skin, hair, eyes, face shape, brows, facial hair, marks, makeup, expression). Do NOT invent clothing, accessories, props, scene or any background beyond the studio backdrop. Never include a phone, camera, device, hands holding anything, text or watermark.\n' +
  'Output ONLY the final prompt text — no preamble, no quotes, no markdown, no labels.\n\n' +
  'CHARACTER SPEC (JSON):\n{SPEC}';

router.post('/character-creator/optimize', async (req, res) => {
  try {
    const { spec } = req.body;
    const specStr = (spec && typeof spec === 'object') ? JSON.stringify(spec, null, 2) : String(spec || '').trim();
    if (!specStr) return res.status(400).json({ success: false, error: 'Пустая спецификация персонажа' });
    const out = await callAI([{ role: 'user', content: _CHAR_OPTIMIZE_TPL.replace('{SPEC}', specStr) }], {
      useOpenRouter: true, openRouterModel: CHAR_OPTIMIZE_MODEL, timeout: 45000,
    });
    let prompt = String(out || '').trim().replace(/^```[a-z]*\s*/i, '').replace(/```$/, '').trim();
    if (prompt.length > 1 && /^["'“]/.test(prompt) && /["'”]$/.test(prompt)) prompt = prompt.slice(1, -1).trim();
    if (!prompt) throw new Error('Модель вернула пустой промпт');
    console.log('[character-creator/optimize]', CHAR_OPTIMIZE_MODEL, '->', prompt.slice(0, 120));
    res.json({ success: true, prompt, model: CHAR_OPTIMIZE_MODEL });
  } catch (err) {
    console.error('[character-creator/optimize]', err.response?.data || err.message);
    res.status(502).json({ success: false, error: err.response?.data?.msg || err.message });
  }
});

// ── Save character (Gemini analyzes race/gender, renames, copies) ─────────────
router.post('/save-character', async (req, res) => {
  const { imagePath, characterName } = req.body;
  if (!imagePath) return res.status(400).json({ success: false, error: 'Нет пути к изображению' });

  const absPath = path.join(__dirname, '..', imagePath.replace(/^\//, ''));
  if (!fs.existsSync(absPath)) return res.status(400).json({ success: false, error: 'Файл не найден' });

  let race = 'other', gender = 'unknown';
  try {
    const imageBase64 = fs.readFileSync(absPath).toString('base64');
    const text = await callAIBase64(
      `Analyze this person's appearance. Return ONLY a raw JSON object, no markdown: {"race":"caucasian|black|asian|hispanic|middle_eastern|south_asian|other","gender":"male|female"}`,
      imageBase64,
      'image/jpeg',
      { useOpenRouter: true, openRouterModel: getImgVisionModel() }
    );
    const match = text.match(/\{[^}]+\}/);
    if (match) { const p = JSON.parse(match[0]); race = p.race || 'other'; gender = p.gender || 'unknown'; }
  } catch (e) { console.warn('[save-char] AI failed:', e.message); }

  const suffix   = Array.from({ length: 10 }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)]).join('');
  const safeName = (characterName || 'character').replace(/\s+/g, '_').replace(/[^a-zA-Zа-яА-ЯёЁ0-9_]/g, '');
  const filename = `${safeName}_${race}_${gender}-${suffix}.jpg`;
  const destPath = path.join(CHARACTERS_DIR, filename);
  fs.copyFileSync(absPath, destPath);
  const thumbPath = path.join(CHARACTERS_DIR, 'thumbs', filename);
  createThumbnail(destPath, thumbPath).catch(e => console.warn('[thumb]', e.message));
  res.json({ success: true, filename, savedPath: `/characters/${filename}` });
});

// ── POST /api/characters/pose-variations ──────────────────────────────────────
// Analyzes pose via Gemini, submits 4 nano-banana-2 variation tasks.
// Returns { taskIds: [...], poseDesc, labels }
router.post('/characters/pose-variations', async (req, res) => {
  const { imagePath, imageEngine, count } = req.body;
  const engine = (imageEngine === 'qwen2') ? 'qwen2' : (imageEngine === 'seedream') ? 'seedream' : (imageEngine === 'seedream4.5') ? 'seedream4.5' : (imageEngine === 'gptimage2') ? 'gptimage2' : 'nano-banana-2';
  const numVariations = Math.min(Math.max(parseInt(count) || 4, 1), 4);
  if (!imagePath) return res.status(400).json({ success: false, error: 'Нет imagePath' });

  const absPath = path.join(__dirname, '..', imagePath.replace(/^\//, ''));
  if (!fs.existsSync(absPath))
    return res.status(400).json({ success: false, error: 'Файл не найден: ' + imagePath });

  try {
    const imageUrl    = await uploadToPublicHost(fs.readFileSync(absPath));
    const systemPrompt = getPrompt('POSE_VARIATION_PROMPT');

    const rawText = await callAIVisionWithFallback([{
      role: 'user',
      content: [
        { type: 'text',      text: systemPrompt },
        { type: 'image_url', image_url: { url: imageUrl } },
      ],
    }], { timeout: 45000, useOpenRouter: true, openRouterModel: getImgVisionModel() });
    const match   = rawText.match(/\{[\s\S]*\}/);
    let parsed    = { poseDesc: '', variations: [] };
    if (match) { try { parsed = JSON.parse(match[0]); } catch {} }

    const variations = (parsed.variations || []).filter(v => v?.prompt).slice(0, numVariations);
    if (!variations.length) throw new Error('Gemini не вернул вариации поз');

    console.log('[pose-variations] poseDesc:', parsed.poseDesc?.slice(0, 120));

    // Submit all 4 generation tasks in parallel using the selected engine
    const taskIds = await Promise.all(
      variations.map(v => {
        if (engine === 'qwen2')      return createQwen2Task(v.prompt, imageUrl, '9:16');
        if (engine === 'seedream')   return createSeedream5LiteTask(v.prompt, [imageUrl], '9:16', 'basic');
        if (engine === 'seedream4.5') return createSeedream45Task(v.prompt, [imageUrl], '9:16', 'basic');
        if (engine === 'gptimage2')  return createGptImage2Task(v.prompt, [imageUrl], '9:16');
        return createNanoBananaProTask(v.prompt, imageUrl, '9:16');
      })
    );

    console.log('[pose-variations] taskIds:', taskIds);
    taskIds.forEach(tid => addPendingTask(tid, 'characters', 'posevar', 'pose-variation'));
    res.json({ success: true, taskIds, poseDesc: parsed.poseDesc, labels: variations.map(v => v.label) });
  } catch (err) {
    console.error('[characters/pose-variations]', err.response?.data || err.message);
    res.status(502).json({ success: false, error: err.response?.data?.msg || err.message });
  }
});

// ── GET /api/characters/pose-status/:taskId?obrazId=… ────────────────────────
// Poll a pose variation task. If obrazId is provided, the resulting posevar is
// stored inside obrazy/<that obraz's folder>/ instead of the legacy
// CHARACTERS_DIR. Frontend always passes obrazId now; the fallback path stays
// for any in-flight legacy task still polling after the migration.
const { findObrazFolderById } = require('../lib/obrazy-store');
router.get('/characters/pose-status/:taskId', async (req, res) => {
  try {
    const obrazId = req.query.obrazId || null;
    let destDir = CHARACTERS_DIR;
    if (obrazId) {
      const folder = findObrazFolderById(obrazId);
      if (folder) {
        if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });
        destDir = folder;
      }
    }
    const result = await resolveTask(req.params.taskId, destDir, 'posevar');
    if (result.state === 'success' || result.state === 'failed') removePendingTask(req.params.taskId);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(502).json({ success: false, error: err.message });
  }
});

// ── POST /api/characters/pose-analyze ─────────────────────────────────────────
// Photoshoot popup: vision analysis of the obraz photo. Returns the LOCKED
// appearance + environment (must stay identical) and exactly 4 EDITABLE pose
// descriptions, each with short example tweaks (ai-insert placeholders).
// No image generation here — the popup shows the analysis, then calls
// /pose-generate per row / for all.
router.post('/characters/pose-analyze', async (req, res) => {
  const { imagePath } = req.body;
  if (!imagePath) return res.status(400).json({ success: false, error: 'Нет imagePath' });
  const absPath = path.join(__dirname, '..', imagePath.replace(/^\//, ''));
  if (!fs.existsSync(absPath)) return res.status(400).json({ success: false, error: 'Файл не найден: ' + imagePath });
  try {
    const imageUrl = await uploadToPublicHost(fs.readFileSync(absPath));
    const systemPrompt = getPrompt('PHOTOSHOOT_POSE_ANALYZE_PROMPT');
    const rawText = await callAIVisionWithFallback([{
      role: 'user',
      content: [
        { type: 'text',      text: systemPrompt },
        { type: 'image_url', image_url: { url: imageUrl } },
      ],
    }], { timeout: 45000, useOpenRouter: true, openRouterModel: getImgVisionModel() });
    const match = rawText.match(/\{[\s\S]*\}/);
    let parsed = {};
    if (match) { try { parsed = JSON.parse(match[0]); } catch {} }
    const appearance  = String(parsed.appearance  || '').trim();
    const environment = String(parsed.environment || '').trim();
    let poses = (Array.isArray(parsed.poses) ? parsed.poses : []).filter(p => p && p.pose).slice(0, 4)
      .map(p => ({
        label:    String(p.label || 'Поза').slice(0, 40),
        pose:     String(p.pose  || '').trim(),
        examples: (Array.isArray(p.examples) ? p.examples : []).map(e => String(e).trim()).filter(Boolean).slice(0, 3),
      }));
    if (!poses.length) throw new Error('LLM не вернул позы');
    while (poses.length < 4) poses.push({ ...poses[poses.length - 1] });   // pad to exactly 4
    res.json({ success: true, appearance, environment, poses });
  } catch (err) {
    console.error('[characters/pose-analyze]', err.response?.data || err.message);
    res.status(502).json({ success: false, error: err.response?.data?.msg || err.message });
  }
});

// ── POST /api/characters/pose-generate ────────────────────────────────────────
// Generate ONE photoshoot pose shot from the obraz photo using a (possibly
// user-edited) prompt. The environment / camera / clothing lock is enforced
// server-side via a fixed tail + match_input_image framing, regardless of edits.
// Returns { taskId } → poll via /api/characters/pose-status/:taskId?obrazId=…
const _PHOTOSHOOT_LOCK_TAIL =
  ' Keep the background, environment, setting, props, lighting, camera angle and framing, and the clothing EXACTLY identical to the reference image — do not change them at all. Change ONLY the body pose and gaze. Both hands fully visible, open, relaxed, not crossed, not holding anything. Photorealistic, identical framing to the reference image, no text, no watermarks.';
router.post('/characters/pose-generate', async (req, res) => {
  const { imagePath, prompt, imageEngine } = req.body;
  const engine = (imageEngine === 'qwen2') ? 'qwen2' : (imageEngine === 'seedream') ? 'seedream' : (imageEngine === 'seedream4.5') ? 'seedream4.5' : (imageEngine === 'gptimage2') ? 'gptimage2' : 'nano-banana-2';
  if (!imagePath) return res.status(400).json({ success: false, error: 'Нет imagePath' });
  if (!prompt || !String(prompt).trim()) return res.status(400).json({ success: false, error: 'Нет prompt' });
  const absPath = path.join(__dirname, '..', imagePath.replace(/^\//, ''));
  if (!fs.existsSync(absPath)) return res.status(400).json({ success: false, error: 'Файл не найден: ' + imagePath });
  try {
    const imageUrl    = await uploadToPublicHost(fs.readFileSync(absPath));
    // Compile the (possibly user-edited) prompt into a realism-enhanced prompt
    // (Hermes → strict JSON → serialized), locked to the reference, then append
    // the hard env/clothing/camera lock tail for belt-and-suspenders safety.
    const compiled    = await compileImagePrompt(String(prompt).trim(), { lockToReference: true });
    const finalPrompt = compiled.prompt + _PHOTOSHOOT_LOCK_TAIL;
    const ar = 'match_input_image';   // lock framing/aspect to the source so the camera never changes
    let taskId;
    if (engine === 'qwen2')          taskId = await createQwen2Task(finalPrompt, imageUrl, ar);
    else if (engine === 'seedream')  taskId = await createSeedream5LiteTask(finalPrompt, [imageUrl], ar, 'basic');
    else if (engine === 'seedream4.5') taskId = await createSeedream45Task(finalPrompt, [imageUrl], ar, 'basic');
    else if (engine === 'gptimage2') taskId = await createGptImage2Task(finalPrompt, [imageUrl], ar);
    else                             taskId = await createNanoBananaProTask(finalPrompt, imageUrl, ar);
    addPendingTask(taskId, 'characters', 'posevar', 'pose-variation');
    res.json({ success: true, taskId });
  } catch (err) {
    console.error('[characters/pose-generate]', err.response?.data || err.message);
    res.status(502).json({ success: false, error: err.response?.data?.msg || err.message });
  }
});

// ── POST /api/characters/pose-ai-insert ───────────────────────────────────────
// Merge a short user note into ONE pose description (body/hands/head/gaze only),
// without touching clothing / environment / camera. Returns { pose }.
router.post('/characters/pose-ai-insert', async (req, res) => {
  const { pose, note } = req.body;
  if (!pose || !String(pose).trim()) return res.status(400).json({ success: false, error: 'Нет pose' });
  if (!note || !String(note).trim()) return res.status(400).json({ success: false, error: 'Нет note' });
  try {
    const tpl = getPrompt('PHOTOSHOOT_POSE_AI_INSERT_PROMPT')
      .replace('{POSE}', String(pose).trim())
      .replace('{NOTE}', String(note).trim());
    const out = await callAI([{ role: 'user', content: tpl }], {
      useOpenRouter: true, openRouterModel: 'nousresearch/hermes-4-70b', timeout: 30000,
    });
    const merged = String(out || '').trim().replace(/^["']+|["']+$/g, '').trim();
    if (!merged) throw new Error('LLM не вернул результат');
    res.json({ success: true, pose: merged });
  } catch (err) {
    console.error('[characters/pose-ai-insert]', err.response?.data || err.message);
    res.status(502).json({ success: false, error: err.response?.data?.msg || err.message });
  }
});

// ── POST /api/edit-pose/generate ──────────────────────────────────────────────
// 1. Gemini analyzes character in the image → short description
// 2. Description injected into selected edit-pose prompt
// 3. Task submitted with the selected imageEngine
// Returns { taskId }
router.post('/edit-pose/generate', async (req, res) => {
  const { imagePath, poseKey, imageEngine } = req.body;
  if (!imagePath || !poseKey)
    return res.status(400).json({ success: false, error: 'Нет imagePath или poseKey' });

  const engine  = (imageEngine === 'qwen2') ? 'qwen2' : (imageEngine === 'seedream') ? 'seedream' : (imageEngine === 'seedream4.5') ? 'seedream4.5' : (imageEngine === 'gptimage2') ? 'gptimage2' : 'nano-banana-2';
  const absPath = path.join(__dirname, '..', imagePath.replace(/^\//, ''));
  if (!fs.existsSync(absPath))
    return res.status(400).json({ success: false, error: 'Файл не найден: ' + imagePath });

  try {
    const imageBuffer = fs.readFileSync(absPath);
    const imageUrl    = await uploadToPublicHost(imageBuffer);

    // Step 1: AI analyzes the character (Gemini → GPT-5.2 fallback)
    let charDesc;
    try {
      charDesc = await callAIVisionWithFallback([{
        role: 'user',
        content: [
          { type: 'text',      text: getPrompt('EDIT_POSE_ANALYZE_PROMPT') },
          { type: 'image_url', image_url: { url: imageUrl } },
        ],
      }], { timeout: 45000, useOpenRouter: true, openRouterModel: getImgVisionModel() });
    } catch { charDesc = ''; }
    charDesc = charDesc || 'a person in the reference image';
    console.log('[edit-pose] charDesc:', charDesc.slice(0, 120));

    // Step 2: Build final prompt
    const poseTemplate = getPrompt(poseKey);
    if (!poseTemplate) return res.status(400).json({ success: false, error: 'Неизвестный poseKey: ' + poseKey });
    const finalPrompt = poseTemplate.replace(/\{charDesc\}/g, charDesc);

    // Step 3: Submit generation task
    let taskId;
    if (engine === 'qwen2') {
      taskId = await createQwen2Task(finalPrompt, imageUrl, '9:16');
    } else if (engine === 'seedream') {
      taskId = await createSeedream5LiteTask(finalPrompt, [imageUrl], '9:16', 'basic');
    } else if (engine === 'seedream4.5') {
      taskId = await createSeedream45Task(finalPrompt, [imageUrl], '9:16', 'basic');
    } else if (engine === 'gptimage2') {
      taskId = await createGptImage2Task(finalPrompt, [imageUrl], '9:16');
    } else {
      taskId = await createNanoBananaProTask(finalPrompt, imageUrl, '9:16');
    }
    console.log('[edit-pose] engine:', engine, '| taskId:', taskId);
    addPendingTask(taskId, 'uploads', 'editpose', 'edit-pose');
    res.json({ success: true, taskId });
  } catch (err) {
    console.error('[edit-pose/generate]', err.response?.data || err.message);
    res.status(502).json({ success: false, error: err.response?.data?.msg || err.message });
  }
});

// ── GET /api/edit-pose/status/:taskId ─────────────────────────────────────────
router.get('/edit-pose/status/:taskId', async (req, res) => {
  try {
    const result = await resolveTask(req.params.taskId, UPLOADS_DIR, 'editpose');
    if (result.state === 'success' || result.state === 'failed') removePendingTask(req.params.taskId);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(502).json({ success: false, error: err.message });
  }
});

module.exports = router;
