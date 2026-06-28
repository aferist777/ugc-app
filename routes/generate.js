'use strict';

const express = require('express');
const path    = require('path');
const fs      = require('fs');
const axios   = require('axios');
const router  = express.Router();

const { UPLOADS_DIR, CHARACTERS_DIR, KIE_BASE, CHAR_OPTIMIZE_MODEL, ROOT_DIR, OBRAZY_DIR } = require('../lib/config');
const { compileImagePrompt } = require('../lib/prompt-compiler');
const {
  kieHeaders, getImgVisionModel, parseLooseJson, createTrellisTask, getReplicateRawOutput,
  callAI, callAIBase64, callAIVision, callAIVisionWithFallback,
  analyzeWithGemini, analyzeRealismMarkers, translateToEnglish, buildPrompt,
  uploadToPublicHost, downloadImage, compressBelow9MB, createThumbnail,
  createNanoBananaProTask, createQwen2Task, createGptImage2Task, createSeedream5LiteTask, createSeedream45Task, createZImageTurboTask, createFlux11UltraTask, createFlux2MaxTask, createFireredEditTask, createPImageEditTask, createMultiRefEditTask, urlToFilePath, resolveTask,
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
  const engine = (imageEngine === 'qwen2') ? 'qwen2' : (imageEngine === 'seedream') ? 'seedream' : (imageEngine === 'seedream4.5') ? 'seedream4.5' : (imageEngine === 'gptimage2') ? 'gptimage2' : (imageEngine === 'flux-2-max') ? 'flux-2-max' : (imageEngine === 'firered-edit') ? 'firered-edit' : (imageEngine === 'p-image-edit') ? 'p-image-edit' : 'nano-banana-2';
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
    } else if (engine === 'p-image-edit') {
      taskId = await createPImageEditTask(prompt, [imageUrl]);  // images[] array
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
    const { spec, prompt, imageEngine, width, height, poseImagePath, poseDesc } = req.body;
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

    // Pose reference mode: a grey mannequin pose was selected. Switch from pure
    // text-to-image to image-conditioned generation (nano-banana-2 via Replicate)
    // so the new character is rendered in that pose. The mannequin is replaced by
    // the described person.
    if (poseImagePath) {
      const _pp = String(poseImagePath).split('?')[0];
      const poseFile = _pp.startsWith('/uploads/')
        ? path.join(UPLOADS_DIR, _pp.slice('/uploads/'.length))
        : path.join(ROOT_DIR, 'public', _pp.replace(/^\/+/, ''));
      if (poseFile && fs.existsSync(poseFile)) {
        const poseUrl = await uploadToPublicHost(fs.readFileSync(poseFile));
        const seed = Math.floor(Math.random() * 999_999_999) + 1;
        const _pd = (poseDesc && String(poseDesc).trim()) ? (' The target pose is: ' + String(poseDesc).trim() + '.') : '';
        // Prefer an LLM-composed prompt that blends the pose key points; fall back to literal.
        let posePrompt = await _composePosePrompt('base', poseDesc, finalPrompt);
        if (!posePrompt) {
          posePrompt = finalPrompt +
            ' Render this exact described person as ONE photorealistic human in the precise body pose, ' +
            'limb and hand positions, composition and camera framing shown in the reference image (a plain grey artist ' +
            'mannequin).' + _pd + ' Replace the mannequin ENTIRELY with the described person — do not show any mannequin, ' +
            'grey clay surface, or blank face. Render a coherent, plausible environment around the subject (no grey/blank ' +
            'background). Exactly one person, no extra people, no text, no watermark.';
        }
        const taskId = await createMultiRefEditTask('nano-banana-2', posePrompt, [poseUrl], '9:16', seed, {});
        if (!taskId) return res.status(502).json({ success: false, error: 'Движок не вернул taskId' });
        addPendingTask(taskId, 'uploads', 'generated', 'character-base');
        console.log('[character-creator/generate] POSE-ref via nano-banana-2 | prompt:', posePrompt.slice(0, 120));
        return res.json({ success: true, taskId, engine: 'nano-banana-2', prompt: posePrompt });
      }
      console.warn('[character-creator/generate] poseImagePath not found, falling back to t2i:', poseImagePath);
    }

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

// ── Custom pose "blank": turn an uploaded reference into a clean grey mannequin
// pose image (square) via the in-app nano-banana-2 (Replicate). Returns a taskId
// the client polls via /api/status; the result is a new custom pose thumbnail.
const _POSE_BLANK_PROMPT =
  'Convert the person in this image into a plain, featureless grey artist\'s mannequin ' +
  '(smooth matte light-grey clay, no face, no facial features, no hair, no clothing) holding the ' +
  'EXACT same body pose, limb and hand positions and camera framing as in the photo. Plain seamless ' +
  'light-grey studio background, soft even lighting, subtle floor shadow. Exactly ONE mannequin figure, ' +
  'centered. This is a clean POSE REFERENCE. No text, no words, no watermark, no logos. Square 1:1 framing.';

// Vision pass: capture the body-pose KEY POINTS as short text (mixed into the apply
// prompt + shown in the extractor). Pose only — no face/identity/clothing/background.
const _POSE_DESCRIBE_PROMPT =
  'Describe ONLY the body POSE and its key points in this photo: overall body orientation to the camera; ' +
  'what each arm and hand is doing and where (e.g. "right hand on the table, left hand near the face"); ' +
  'leg position or stance; head direction; sitting or standing; and the camera framing (head-and-shoulders, ' +
  'waist-up, or full-body). Be concise — one short sentence or a few comma-separated clauses. Do NOT mention ' +
  'the face details, identity, clothing, colours, or background. Respond with ONLY the description.';

router.post('/character-creator/pose-blank', async (req, res) => {
  const { imageBase64, imagePath } = req.body || {};
  try {
    let buf;
    if (imageBase64) {
      buf = Buffer.from(String(imageBase64).replace(/^data:[^;]+;base64,/, ''), 'base64');
    } else if (imagePath) {
      const f = String(imagePath).split('?')[0];
      const file = f.startsWith('/uploads/') ? path.join(UPLOADS_DIR, f.slice('/uploads/'.length)) : path.join(ROOT_DIR, 'public', f.replace(/^\/+/, ''));
      if (!fs.existsSync(file)) return res.status(400).json({ success: false, error: 'Референс не найден' });
      buf = fs.readFileSync(file);
    } else {
      return res.status(400).json({ success: false, error: 'Нет изображения-референса' });
    }
    const refUrl = await uploadToPublicHost(buf);
    // Pose key-points description (best-effort; the blank still generates if it fails).
    let description = '';
    try {
      const content = [{ type: 'text', text: _POSE_DESCRIBE_PROMPT }, { type: 'image_url', image_url: { url: refUrl } }];
      description = String(await callAIVisionWithFallback([{ role: 'user', content }], { timeout: 45000, useOpenRouter: true, openRouterModel: getImgVisionModel() }) || '').trim();
    } catch (e) { console.warn('[pose-blank] describe skipped:', e.message); }
    const seed = Math.floor(Math.random() * 999_999_999) + 1;
    const taskId = await createMultiRefEditTask('nano-banana-2', _POSE_BLANK_PROMPT, [refUrl], '1:1', seed, {});
    if (!taskId) return res.status(502).json({ success: false, error: 'Движок не вернул taskId' });
    addPendingTask(taskId, 'uploads', 'pose', 'pose-blank');
    console.log('[character-creator/pose-blank] taskId:', taskId, '| desc:', description.slice(0, 80));
    res.json({ success: true, taskId, description });
  } catch (err) {
    console.error('[character-creator/pose-blank]', err.response?.data || err.message);
    res.status(502).json({ success: false, error: err.response?.data?.msg || err.message });
  }
});

// Permanently delete a pose (built-in or custom): removes the image + its thumbnail
// from disk and, for built-in poses, the entry from poses.json. Irreversible.
router.post('/character-creator/pose-delete', (req, res) => {
  try {
    const { key, file, builtin } = req.body || {};
    const f = String(file || '').split('?')[0];
    const POSES_DIR = path.join(ROOT_DIR, 'public', 'poses');
    // Pick the allowed base dir from the URL prefix; basename strips any path traversal.
    let baseDir = null;
    if (f.startsWith('/poses/')) baseDir = POSES_DIR;
    else if (f.startsWith('/uploads/')) baseDir = UPLOADS_DIR;
    const unlinkSafe = (abs) => { try { if (abs && fs.existsSync(abs)) fs.unlinkSync(abs); } catch (e) {} };
    if (baseDir && f) {
      const name = path.basename(f);
      const abs = path.join(baseDir, name);
      if (path.resolve(abs).startsWith(path.resolve(baseDir))) {
        unlinkSafe(abs);
        unlinkSafe(path.join(baseDir, 'thumbs', name.replace(/\.[^.]+$/, '') + '.jpg'));
      }
    }
    if (builtin || f.startsWith('/poses/')) {
      const manifestPath = path.join(POSES_DIR, 'poses.json');
      if (fs.existsSync(manifestPath)) {
        try {
          let arr = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
          if (Array.isArray(arr)) {
            arr = arr.filter((p) => p && p.key !== key && p.file !== f);
            fs.writeFileSync(manifestPath, JSON.stringify(arr, null, 2));
          }
        } catch (e) { console.warn('[pose-delete] manifest update failed:', e.message); }
      }
    }
    res.json({ success: true });
  } catch (err) {
    console.error('[character-creator/pose-delete]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Pose Studio: text -> cheap object image -> TRELLIS image-to-3D -> GLB saved under
// public/models, returned for loading into the 3D scene. Synchronous (cheap t2i ~10s
// + TRELLIS ~25s); the client shows a spinner. GLBs are gitignored generated output.
router.post('/studio/gen-object', async (req, res) => {
  const { description } = req.body || {};
  try {
    if (!description || !String(description).trim()) return res.status(400).json({ success: false, error: 'Опишите предмет' });
    const imgPrompt = `a single ${String(description).trim()}, plain solid white background, centered, the whole object fully visible, studio product photo, soft even lighting, no other objects, no people`;
    const imgId = await createZImageTurboTask(imgPrompt);
    const imgOut = await getReplicateRawOutput(imgId, 120000);
    const imgUrl = Array.isArray(imgOut) ? imgOut[0] : (typeof imgOut === 'string' ? imgOut : (imgOut && (imgOut.image || imgOut.output)));
    if (!imgUrl) throw new Error('t2i не вернул изображение');
    const trId = await createTrellisTask([imgUrl], {});
    const trOut = await getReplicateRawOutput(trId, 300000);
    const glbUrl = trOut && (trOut.model_file || trOut.glb || trOut.mesh);
    if (!glbUrl) throw new Error('TRELLIS не вернул GLB');
    const name = 'obj_' + Date.now() + '.glb';
    const dest = path.join(ROOT_DIR, 'public', 'models', name);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const dl = await axios.get(glbUrl, { responseType: 'arraybuffer', timeout: 120000 });
    fs.writeFileSync(dest, Buffer.from(dl.data));
    console.log('[studio/gen-object]', description, '->', name, Math.round(dl.data.length / 1024) + 'KB');
    res.json({ success: true, glbPath: '/models/' + name, sourceImage: imgUrl });
  } catch (err) {
    console.error('[studio/gen-object]', err.response?.data || err.message);
    res.status(502).json({ success: false, error: err.response?.data?.msg || err.message });
  }
});

// Pose Studio: generate a photo from a colored LAYOUT MAP (cubes + figure) using the
// already-composed legend prompt. The studio renders a flat-colour control image; we
// upload it + run i2i. Client polls /api/status with the returned taskId.
router.post('/studio/generate-frame', async (req, res) => {
  const { imageBase64, prompt, aspect, imageEngine } = req.body || {};
  try {
    if (!imageBase64) return res.status(400).json({ success: false, error: 'Нет изображения схемы' });
    if (!prompt) return res.status(400).json({ success: false, error: 'Нет промпта' });
    const buf = Buffer.from(String(imageBase64).replace(/^data:[^;]+;base64,/, ''), 'base64');
    const url = await uploadToPublicHost(buf);
    const ar = aspect || '9:16';
    const eng = imageEngine || 'nano-banana-2';
    let taskId;
    if (eng === 'nano-banana-2') {
      taskId = await createNanoBananaProTask(prompt, url, ar, { output_format: 'jpg', resolution: '2K' });
    } else {
      taskId = await createMultiRefEditTask(eng, prompt, [url], ar, Math.floor(Math.random() * 999999999) + 1, {});
    }
    if (!taskId) return res.status(502).json({ success: false, error: 'Движок не вернул taskId' });
    addPendingTask(taskId, 'uploads', 'studioframe', 'studio');
    console.log('[studio/generate-frame] engine:', eng, '| taskId:', taskId);
    res.json({ success: true, taskId });
  } catch (err) {
    console.error('[studio/generate-frame]', err.response?.data || err.message);
    res.status(502).json({ success: false, error: err.response?.data?.msg || err.message });
  }
});

// Compose ONE coherent generation prompt that BLENDS the pose key-points into the
// identity/scene-preserving instruction via an LLM (instead of naive concatenation),
// so the engine receives a single high-quality prompt. Returns null on failure ->
// caller falls back to its literal prompt.
async function _composePosePrompt(kind, poseDesc, subjectPrompt, environment) {
  const pd = String(poseDesc || '').trim();
  if (!pd) return null;
  const env = String(environment || '').trim();
  const envLine = env ? ('Environment / setting — render the person in THIS exact environment, replacing any other background: ' + env + '\n') : '';
  let tpl;
  if (kind === 'base') {
    tpl = 'Compose ONE vivid, coherent English text-to-image prompt for generating a NEW character in a specific body pose. ' +
      'A plain grey artist mannequin reference DEFINES the target composition, camera angle and pose — keep them. The described person ' +
      'REPLACES the mannequin entirely (no grey clay, no blank face, no mannequin, no extra people, no text, no watermark), rendered as ' +
      'EXACTLY ONE photorealistic human in that pose. Render a coherent, plausible environment around the subject (do not leave a grey/blank background).\n\n' +
      'Character: ' + (String(subjectPrompt || '').trim() || 'a person') + '\n' +
      'Target pose (key points): ' + pd + '\n\nReturn ONLY the final prompt, no preamble, no quotes.';
  } else {
    // The MANNEQUIN is the composition base; the person is applied onto it. The
    // composer never SEES the images, so the prompt must be INSTRUCTIONAL — refer to
    // "the person from image 2", never invent appearance.
    tpl = 'Compose ONE coherent English image-generation prompt for an engine that receives TWO reference images. ' +
      'IMAGE 1 is a plain grey artist mannequin that acts as a COMPOSITION AND CROP MASK: its camera angle, framing, body pose, subject scale, placement in the frame AND its exact cropping must all be reproduced EXACTLY. ' +
      'IMAGE 2 is the real person whose identity must be used. Refer to the subject ONLY as "the person from image 2" and take their face, identity, hair, skin tone and clothing STRICTLY from image 2 — do NOT invent or state any specific facial features, hair colour, skin tone, age, body type or clothing. ' +
      'Instruct the engine to render the person from image 2 in the EXACT composition, camera angle and pose of the grey mannequin in image 1, FULLY replacing the grey mannequin (never keep its grey colour, smooth surface or blank face). ' +
      'CRITICAL — reproduce the mannequin framing and crop precisely: the SAME body parts must be inside the frame and the SAME parts must be cut off at the SAME frame edges as the mannequin (for example, if the mannequin is a tight shot with the head, an arm or a hand running out of frame, the person must be cropped identically). Keep the mannequin subject scale/zoom and placement; do NOT zoom out, pull back, or reframe to fit the whole body when the mannequin is cropped. ' +
      (env
        ? 'Render the full scene in the specified environment below (use it, do not keep the image-2 background if it differs); plausibly extend it to fill any areas the angle reveals, never leave a grey/blank background. '
        : 'Carry over the environment/style from image 2; if the mannequin angle reveals areas not visible in image 2, plausibly EXTEND and complete the environment to match (never leave a grey/blank background). ') +
      'Render EXACTLY ONE photorealistic person, no mannequin, no extra people, no text, no watermark.\n\n' +
      envLine +
      'Target pose / composition (key points): ' + pd + '\n\nReturn ONLY the final prompt, no preamble, no quotes.';
  }
  try {
    const out = await callAI([{ role: 'user', content: tpl }], { useOpenRouter: true, openRouterModel: CHAR_OPTIMIZE_MODEL, timeout: 30000 });
    let p = String(out || '').trim().replace(/^```[a-z]*\s*/i, '').replace(/```$/, '').trim();
    if (p.length > 1 && /^["'“]/.test(p) && /["'”]$/.test(p)) p = p.slice(1, -1).trim();
    return p || null;
  } catch (e) { console.warn('[pose-compose]', e.message); return null; }
}

router.post('/character-creator/pose-compose', async (req, res) => {
  try {
    const { poseDesc, kind, subjectPrompt, environment } = req.body || {};
    const prompt = await _composePosePrompt(kind === 'base' ? 'base' : 'apply', poseDesc, subjectPrompt, environment);
    res.json({ success: true, prompt: prompt || '' });
  } catch (err) {
    console.error('[character-creator/pose-compose]', err.response?.data || err.message);
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
    const p = parseLooseJson(text);
    if (p) { race = p.race || 'other'; gender = p.gender || 'unknown'; }
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
    const parsed  = parseLooseJson(rawText) || { poseDesc: '', variations: [] };

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
    const parsed = parseLooseJson(rawText) || {};
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

// ── Two-pass dialogue script generator (Scenarios -> dialogues mode) ──────────
// Pass 1 (Gemini 3.5 Flash): a CLEAN, brand-safe selling dialogue by the canon of
//   high-converting sales dialogue, role-aware, product optional (toggle).
// Pass 2 (Hermes 4 405B): aggressively RECOLORS the clean script to the chosen taboo
//   level, mirroring the selected source's voice. Auto-chained; returns clean + colored + logs.
const DLG_TABOO = {
  mild:     'light edge: casual slang, mild cheek, a wink. Stay advertiser-safe.',
  spicy:    'bold and provocative: punchy slang, dark humor, hooks pushed hard. No slurs or hate.',
  explicit: 'maximum edge allowed for this niche: raw, crude, taboo-leaning provocation. Still no illegal content, no slurs/hate, no minors.',
};
// ElevenLabs v3 inline audio tags the dialogue is written with, grouped by emotion.
// Single source of truth: the Gemini/Hermes prompts AND the frontend tag-picker popup
// (GET /api/dialogue/voice-tags) both read this set.
const DLG_VOICE_TAGS = {
  'Joy / energy':       ['happy', 'excited', 'cheerful', 'playfully', 'giggles', 'chuckles', 'laughs', 'warmly'],
  'Sad / tense':        ['sad', 'crying', 'sighs', 'angry', 'shouting', 'nervous', 'frustrated', 'disappointed'],
  'Tone / delivery':    ['sarcastic', 'mischievously', 'seriously', 'calmly', 'confident', 'hesitant', 'curious', 'flirtatious'],
  'Reactions / sounds': ['gasps', 'exhales', 'clears throat', 'whispers', 'snorts', 'pauses', 'groans', 'yawns'],
};
const DLG_TAG_LIST = Object.values(DLG_VOICE_TAGS).reduce((a, b) => a.concat(b), []);
const DLG_TAGS_STR = DLG_TAG_LIST.map(t => '[' + t + ']').join(' ');
// SSE stream. 6 LLM calls across 4 visible stages:
//   1) clean dialogue (Gemini, tone-neutral, no tags)
//   2) taboo recolor (Hermes) -> colored
//   3) emotion analysis for clean + colored IN PARALLEL (Gemini x2)
//   4) voice-tag placement for clean + colored IN PARALLEL (Gemini x2)
// Emits {type:'step',n,total,label} before each stage, {type:'done',...} at the end,
// {type:'error',...} on failure. Aborts at the next stage boundary if the client closes.
router.post('/dialogue/script', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (res.flushHeaders) res.flushHeaders();
  const TOTAL = 4;
  const logs = [];
  let aborted = false;
  // res 'close' fires on real client disconnect; guard with writableEnded so our own
  // res.end() does not look like an abort. (req 'close' fires right after the body is
  // read, which would falsely abort after stage 1.)
  res.on('close', () => { if (!res.writableEnded) aborted = true; });
  const send = (obj) => { try { res.write('data: ' + JSON.stringify(obj) + '\n\n'); } catch (e) {} };
  const fail = (msg) => { send({ type: 'error', error: msg, logs }); res.end(); };
  try {
    const SP = require('../lib/scenario-prompts');
    const { topic, product, includeProduct, hostRole, guestRole, hostGender, guestGender, lines, length, vertical, source, tone, taboo, theme, solo } = req.body || {};
    const isSolo = !!solo;   // single-presenter UGC monologue (one speaker, all lines = host)
    const lenLine = (length && String(length).trim()) ? ` Each spoken line should be ${String(length).trim()}.` : '';
    const n = Math.min(Math.max(parseInt(lines, 10) || 6, 2), 14);
    const host = String(hostRole || 'Host').trim(), guest = String(guestRole || 'Guest').trim();
    const hg = (hostGender && String(hostGender).trim()) ? ` (${String(hostGender).trim()})` : '';
    const gg = (guestGender && String(guestGender).trim()) ? ` (${String(guestGender).trim()})` : '';
    const prod = String(product || '').trim();
    const useProduct = includeProduct !== false && !!prod;
    const toneStr = String(tone || '').trim();
    const th = String(theme || 'marketing');
    const vid = String(vertical || '');
    const lvl = ['none', 'mild', 'spicy', 'explicit'].includes(String(taboo)) ? String(taboo) : 'spicy';

    const mkPairs = (arr) => { const p = []; for (let i = 0; i < arr.length; i += 2) p.push(arr.slice(i, i + 2)); return p; };
    const normLines = (raw, ref) => Array.isArray(raw) ? raw.filter(l => l && l.text).map((l, i) => ({ speaker: (l.speaker === 'guest' ? 'guest' : (l.speaker === 'host' ? 'host' : (ref && ref[i] ? ref[i].speaker : (i % 2 ? 'guest' : 'host')))), text: String(l.text).trim() })) : [];

    // ── Stage 1: clean dialogue (Gemini), tone-neutral, NO tags ──
    send({ type: 'step', n: 1, total: TOTAL, label: 'Writing the dialogue' });
    const productLine = useProduct
      ? `PRODUCT to sell: "${prod}". Weave it in naturally as the solution; build desire and land a soft CTA toward it.`
      : `Do NOT mention any product or brand — pure value/story dialogue that builds curiosity.`;
    const sys1 = isSolo
      ? `You are a world-class direct-response UGC copywriter. Write a natural ${n}-line SINGLE-PERSON spoken monologue for a vertical short-form UGC ad, delivered straight to camera by ONE presenter, following the canon of high-converting UGC: 0-3s HOOK, agitate the pain, a unique mechanism/insight, concrete proof, handle the top objection, future-pace the win, clear payoff/CTA.\n` +
        `PRESENTER role: ${host}${hg}. Speak true to this role AND gender (phrasing, references and perspective should fit the gender).\n` +
        `Topic/offer: ${topic || prod || 'general'}.\n${productLine}\n` +
        `Each line = one punchy spoken on-camera sentence, ONE idea, in delivery order.${lenLine} Keep this pass CLEAN and brand-safe. Plain spoken words only — do NOT add voice tags or stage directions.\n` +
        `Return ONLY raw JSON: {"cast":[{"role":"host","name":"${host}"}],"lines":[{"speaker":"host","text":"..."}]}. Exactly ${n} lines. No markdown, no commentary.`
      : `You are a world-class direct-response copywriter. Write a natural ${n}-line two-person dialogue for a vertical short-form video, following the canon of high-converting sales dialogue: 0-3s HOOK, agitate the pain, a unique mechanism/insight, concrete proof, handle the top objection, future-pace the win, clear payoff/CTA.\n` +
        `HOST role: ${host}${hg}. GUEST role: ${guest}${gg}. Each speaker MUST talk, think and use vocabulary true to their role AND gender (phrasing, references and perspective should fit the speaker's gender).\n` +
        `Topic/offer: ${topic || prod || 'general'}.\n${productLine}\n` +
        `Alternate speakers (HOST opens). Each line = punchy spoken on-camera speech, ONE idea.${lenLine} Keep this pass CLEAN and brand-safe. Plain spoken words only — do NOT add voice tags or stage directions.\n` +
        `Return ONLY raw JSON: {"cast":[{"role":"host","name":"${host}"},{"role":"guest","name":"${guest}"}],"lines":[{"speaker":"host","text":"..."},{"speaker":"guest","text":"..."}]}. Exactly ${n} lines, HOST first. No markdown, no commentary.`;
    const raw1 = await callAI([{ role: 'user', content: sys1 }], { useOpenRouter: true, openRouterModel: 'google/gemini-3.5-flash', timeout: 45000 });
    if (aborted) return res.end();
    const p1 = parseLooseJson(raw1) || {};
    let clean = normLines(p1.lines);
    if (isSolo) clean = clean.map(l => ({ speaker: 'host', text: l.text }));   // monologue: one speaker
    if (!clean.length) return fail('Stage 1 (Gemini) did not return lines');
    const cast = isSolo ? [{ role: 'host', name: host }] : (p1.cast || [{ role: 'host', name: host }, { role: 'guest', name: guest }]);
    logs.push(`1/4 clean dialogue (Gemini 3.5 Flash) - ${clean.length} lines.`);

    // ── Stage 2: taboo recolor (Hermes) ──
    send({ type: 'step', n: 2, total: TOTAL, label: 'Recoloring to taboo' });
    let colored = clean;
    if (lvl !== 'none') {
      const srcSel = String(source || 'all');
      let srcText = '';
      try { srcText = (srcSel && srcSel !== 'all') ? SP.readSourceText(th, vid, srcSel, { maxChars: 8000 }) : SP.readSourcesText(th, vid, { maxChars: 8000 }); } catch (e) {}
      const srcBlock = srcText ? `\nSOURCE VOICE to mirror (mine its tone, slang and angles; do NOT copy verbatim):\n"""\n${srcText}\n"""\n` : '';
      const sys2 = isSolo
        ? `You are a savage short-form UGC copywriter doing an AGGRESSIVE recolor ("arbitrage"). Take the clean monologue below and RECOLOR it to taboo level "${lvl}" for the "${vid || 'general'}" niche — ${DLG_TABOO[lvl]}\n` +
          `Keep the SAME line count (${clean.length}), the SAME order, and the SAME selling beats; one presenter (${host}). Recolor ONLY wording/voice/energy — never change the order. Plain spoken words only, NO voice tags.${srcBlock}\n` +
          `Return ONLY raw JSON: {"lines":[{"speaker":"host","text":"..."},...]} with exactly ${clean.length} lines in the same order. No markdown.\n\n` +
          `CLEAN MONOLOGUE:\n${JSON.stringify({ lines: clean })}`
        : `You are a savage short-form copywriter doing an AGGRESSIVE recolor ("arbitrage"). Take the clean dialogue below and RECOLOR it to taboo level "${lvl}" for the "${vid || 'general'}" niche — ${DLG_TABOO[lvl]}\n` +
          `Keep the SAME line count (${clean.length}), the SAME speakers in the SAME order, and the SAME selling beats; keep each speaker true to their role (HOST: ${host}, GUEST: ${guest}). Recolor ONLY wording/voice/energy — never change who says what or the order. Plain spoken words only, NO voice tags.${srcBlock}\n` +
          `Return ONLY raw JSON: {"lines":[{"speaker":"host","text":"..."},...]} with exactly ${clean.length} lines in the same speaker order. No markdown.\n\n` +
          `CLEAN DIALOGUE:\n${JSON.stringify({ lines: clean })}`;
      try {
        const raw2 = await callAI([{ role: 'user', content: sys2 }], { useOpenRouter: true, openRouterModel: CHAR_OPTIMIZE_MODEL, timeout: 45000 });
        const c2 = normLines((parseLooseJson(raw2) || {}).lines, clean);
        if (c2.length) { colored = c2; logs.push(`2/4 taboo recolor (Hermes 4 405B) at "${lvl}"${srcText ? ' from source "' + srcSel + '"' : ''} - ${c2.length} lines.`); }
        else logs.push('2/4 taboo recolor: no usable output - kept clean.');
      } catch (e) { logs.push('2/4 taboo recolor error: ' + e.message + ' - kept clean.'); }
    } else {
      logs.push('2/4 taboo recolor skipped (taboo=none).');
    }
    if (aborted) return res.end();
    const coloredIsClean = (lvl === 'none' || colored === clean);

    // ── tagging branch helpers (analyze -> place tags); TONE drives the tags ──
    const toneCtx = toneStr ? `the desired TONE is "${toneStr}"` : `infer the natural tone from the content`;
    const analyze = async (arr) => {
      const sys = `You are a voice-acting director. For the dialogue below, ${toneCtx}. For EACH line, in ONE short phrase, describe the emotional delivery + any reactions that fit (e.g. an excited open, a hesitant beat, a dry laugh, a whisper for the secret). Keep it consistent with the tone across the whole script.\n` +
        `Return ONLY raw JSON: {"analysis":[{"i":0,"notes":"..."}, ...]} with one entry per line, in order. No markdown.\n\nDIALOGUE:\n${JSON.stringify({ lines: arr })}`;
      const raw = await callAI([{ role: 'user', content: sys }], { useOpenRouter: true, openRouterModel: 'google/gemini-3.5-flash', timeout: 45000 });
      const a = (parseLooseJson(raw) || {}).analysis;
      return Array.isArray(a) ? a : [];
    };
    const placeTags = async (arr, analysis) => {
      const sys = `You are preparing dialogue for ElevenLabs v3 TTS. Insert inline audio tags in square brackets into each line to match its delivery notes and the overall tone (${toneCtx}). Put 1-3 tags on most lines, each immediately before the words it affects. Keep the spoken words EXACTLY the same — only ADD [tags]. Use ONLY these tags: ${DLG_TAGS_STR}.\n` +
        `Return ONLY raw JSON: {"lines":[{"speaker":"host","text":"[tag] ..."},...]} with exactly ${arr.length} lines in the same speaker order. No markdown.\n\n` +
        `DELIVERY NOTES (per line):\n${JSON.stringify({ analysis })}\n\nDIALOGUE:\n${JSON.stringify({ lines: arr })}`;
      const raw = await callAI([{ role: 'user', content: sys }], { useOpenRouter: true, openRouterModel: 'google/gemini-3.5-flash', timeout: 45000 });
      const t = normLines((parseLooseJson(raw) || {}).lines, arr);
      return t.length === arr.length ? t : arr;
    };

    // ── Stage 3: emotion analysis (clean + colored in PARALLEL) ──
    send({ type: 'step', n: 3, total: TOTAL, label: 'Reading emotions' });
    const [aClean, aColored] = await Promise.all([
      analyze(clean),
      coloredIsClean ? Promise.resolve(null) : analyze(colored),
    ]);
    if (aborted) return res.end();
    logs.push(`3/4 emotion analysis (parallel) - clean${coloredIsClean ? '' : ' + colored'}.`);

    // ── Stage 4: place voice tags (clean + colored in PARALLEL) ──
    send({ type: 'step', n: 4, total: TOTAL, label: 'Placing voice tags' });
    const [cleanTagged, coloredTaggedRaw] = await Promise.all([
      placeTags(clean, aClean),
      coloredIsClean ? Promise.resolve(null) : placeTags(colored, aColored),
    ]);
    if (aborted) return res.end();
    const coloredTagged = coloredIsClean ? cleanTagged : coloredTaggedRaw;
    logs.push(`4/4 voice tags placed (parallel) - clean${coloredIsClean ? ' (= colored)' : ' + colored'}.`);

    send({
      type: 'done', success: true, cast, taboo: lvl,
      clean: cleanTagged, colored: coloredTagged,
      cleanPairs: mkPairs(cleanTagged), coloredPairs: mkPairs(coloredTagged),
      logs,
    });
    res.end();
  } catch (err) {
    console.error('[dialogue/script]', err.message);
    fail(err.message);
  }
});

// Voice-tag taxonomy for the dialogue editor (eleven_v3 audio tags), grouped by emotion.
router.get('/dialogue/voice-tags', (_req, res) => res.json({ groups: DLG_VOICE_TAGS }));

// ── Dialogue projects (Scenarios/dialogues): persistent list/get/save/delete ──
const DLGP = require('../lib/dialogue-projects');
router.get('/dialogue/projects', (_req, res) => { try { res.json({ projects: DLGP.list() }); } catch (e) { res.status(500).json({ error: e.message }); } });
router.get('/dialogue/projects/get', (req, res) => { const p = DLGP.get(req.query.id); if (!p) return res.status(404).json({ error: 'not found' }); res.json({ project: p }); });
router.post('/dialogue/projects/save', (req, res) => { try { res.json({ success: true, project: DLGP.save(req.body || {}) }); } catch (e) { res.status(500).json({ success: false, error: e.message }); } });
router.post('/dialogue/projects/delete', (req, res) => { try { DLGP.remove((req.body || {}).id); res.json({ success: true }); } catch (e) { res.status(500).json({ success: false, error: e.message }); } });

const UGCP = require('../lib/ugc-projects');
router.get('/ugc/projects', (_req, res) => { try { res.json({ projects: UGCP.list() }); } catch (e) { res.status(500).json({ error: e.message }); } });
router.get('/ugc/projects/get', (req, res) => { const p = UGCP.get(req.query.id); if (!p) return res.status(404).json({ error: 'not found' }); res.json({ project: p }); });
router.post('/ugc/projects/save', (req, res) => { try { res.json({ success: true, project: UGCP.save(req.body || {}) }); } catch (e) { res.status(500).json({ success: false, error: e.message }); } });
router.post('/ugc/projects/delete', (req, res) => { try { UGCP.remove((req.body || {}).id); res.json({ success: true }); } catch (e) { res.status(500).json({ success: false, error: e.message }); } });

// ── Interview-pose anchors (Video setup) ─────────────────────────────────────
// A reusable library of two-figure interview anchors (host = solid BLUE / left,
// guest = solid RED / right) generated as plain matte mannequins. They are the
// composition base onto which each character's look is later applied. New, separate
// pipeline (does NOT reuse the Character-tab pose-generate). Stored under obrazy/dlg-poses.
const DLGPOSES = require('../lib/dialogue-poses');
const POSE_DIR = path.join(OBRAZY_DIR || path.join(ROOT_DIR, 'obrazy'), 'dlg-poses');
const DLG_INTERVIEW_POSES = [
  { key: 'stools_side',   label: 'Stools, side by side',  desc: 'both seated on bar stools, side by side, facing the camera, hands relaxed' },
  { key: 'lounge_angle',  label: 'Lounge chairs',         desc: 'seated in two lounge chairs angled slightly toward each other, casual conversation' },
  { key: 'table_lean',    label: 'Across a table',        desc: 'seated at a small table angled together, both leaning in, forearms on the table' },
  { key: 'stand_side',    label: 'Standing, side by side', desc: 'standing side by side, relaxed, arms at sides, facing the camera' },
  { key: 'couch_turn',    label: 'Couch, turned in',      desc: 'seated together on a couch, each turned a quarter toward the other, mid-gesture' },
  { key: 'recline',       label: 'Reclined chairs',       desc: 'both leaning back relaxed in chairs, one with an ankle resting over the knee' },
  { key: 'twoshot_lean',  label: 'Close two-shot',        desc: 'seated close in a tight two-shot, leaning toward each other mid-laugh' },
  { key: 'stand_gesture', label: 'Standing, gesturing',   desc: 'standing, one hand gesturing as if talking, the other relaxed, facing the camera' },
];
const DLG_POSE_STYLE =
  'Two full-body human figures arranged for a sit-down interview / podcast, framed for short-form video. ' +
  'The figure on the LEFT is a smooth, featureless matte BLUE mannequin (solid blue, no face, no texture, no clothing detail). ' +
  'The figure on the RIGHT is a smooth, featureless matte RED mannequin (solid red, no face, no texture, no clothing detail). ' +
  'These two coloured mannequins are pure composition anchors that mark the two interview seats. ' +
  'Plain neutral light-grey studio background, soft even lighting, both full bodies fully visible and well inside the frame with a clear gap between them, no props other than the implied seating. ';

router.get('/dialogue/poses', (req, res) => {
  try { res.json({ poses: DLGPOSES.list(req.query.format ? String(req.query.format) : null), presets: DLG_INTERVIEW_POSES }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/dialogue/poses/delete', (req, res) => {
  try {
    const rec = DLGPOSES.get((req.body || {}).id);
    if (rec) [rec.file, rec.thumb, rec.mirrorFile, rec.mirrorThumb].forEach(u => { try { if (u) fs.unlinkSync(path.join(ROOT_DIR, u.replace(/^\//, ''))); } catch (e) {} });
    DLGPOSES.remove((req.body || {}).id);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// SSE: generate the interview-pose anchors for one format, then mirror + thumbnail each.
router.post('/dialogue/poses/generate', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (res.flushHeaders) res.flushHeaders();
  let aborted = false;
  res.on('close', () => { if (!res.writableEnded) aborted = true; });
  const send = (o) => { try { res.write('data: ' + JSON.stringify(o) + '\n\n'); } catch (e) {} };
  try {
    const sharp = require('sharp');
    fs.mkdirSync(POSE_DIR, { recursive: true });
    const format = ((req.body || {}).format === '16:9') ? '16:9' : '9:16';
    const keys = Array.isArray((req.body || {}).keys) && (req.body || {}).keys.length ? (req.body || {}).keys : DLG_INTERVIEW_POSES.map(p => p.key);
    const want = DLG_INTERVIEW_POSES.filter(p => keys.includes(p.key));
    const TOTAL = want.length;
    send({ type: 'start', total: TOTAL, format });
    // Submit the whole batch first, with a small stagger between submits so we don't
    // hit kie.ai with 8 calls in the same millisecond, then poll all concurrently.
    const subs = [];
    for (let i = 0; i < want.length && !aborted; i++) {
      const ps = want[i];
      send({ type: 'step', n: i + 1, total: TOTAL, label: 'Submitting ' + ps.label });
      let taskId = null;
      try { taskId = await createNanoBananaProTask(DLG_POSE_STYLE + 'Arrangement: ' + ps.desc + '.', null, format, { resolution: '2K' }); }
      catch (e) { send({ type: 'poseerr', n: i + 1, key: ps.key, error: e.message }); }
      subs.push({ ps, taskId });
      if (i < want.length - 1) await new Promise(rs => setTimeout(rs, 700));   // pause between requests
    }
    const made = [];
    await Promise.all(subs.map(async (s, idx) => {
      if (!s.taskId || aborted) return;
      let r = null; const t0 = Date.now();
      while (!aborted) {
        await new Promise(rs => setTimeout(rs, 2500 + idx * 150));   // slight per-task poll stagger
        try { r = await resolveTask(s.taskId, POSE_DIR, 'dlgpose'); } catch (e) { r = { state: 'pending' }; }
        if (r.state === 'success' || r.state === 'failed') break;
        if (Date.now() - t0 > 240000) { r = { state: 'failed', error: 'timeout' }; break; }
      }
      if (!r || r.state !== 'success') { send({ type: 'poseerr', key: s.ps.key, error: (r && r.error) || 'failed' }); return; }
      const fileUrl = r.imagePath;                         // /obrazy/dlg-poses/dlgpose_xxx.jpg
      const base = path.basename(fileUrl);
      const thumbUrl = '/' + path.relative(ROOT_DIR, path.join(POSE_DIR, 'thumbs', base)).replace(/\\/g, '/');
      let mUrl = null, mThumb = null;                      // mirror: host/guest swap sides
      try {
        const mBase = base.replace(/\.jpg$/i, '') + '_m.jpg';
        const mDisk = path.join(POSE_DIR, mBase);
        await sharp(path.join(POSE_DIR, base)).flop().toFile(mDisk);
        await createThumbnail(mDisk, path.join(POSE_DIR, 'thumbs', mBase));
        mUrl = '/' + path.relative(ROOT_DIR, mDisk).replace(/\\/g, '/');
        mThumb = '/' + path.relative(ROOT_DIR, path.join(POSE_DIR, 'thumbs', mBase)).replace(/\\/g, '/');
      } catch (e) { console.warn('[dlgpose mirror]', e.message); }
      // DLGPOSES.save is fully synchronous (no await inside) so concurrent calls can't interleave.
      const rec = DLGPOSES.save({ format, key: s.ps.key, label: s.ps.label, desc: s.ps.desc, file: fileUrl, thumb: thumbUrl, mirrorFile: mUrl, mirrorThumb: mThumb });
      made.push(rec);
      send({ type: 'pose', n: made.length, total: TOTAL, pose: rec });
    }));
    send({ type: 'done', poses: made, aborted });
    res.end();
  } catch (e) { send({ type: 'error', error: e.message }); res.end(); }
});

// ── "Both" interview-mix composite (Phase 6) ─────────────────────────────────
// Paint the host + guest looks onto the colour-anchor pose (BLUE=host / RED=guest),
// in the chosen location's palette, on the chosen lens, via the selected i2i engine.
const BOTH_DIR = path.join(OBRAZY_DIR || path.join(ROOT_DIR, 'obrazy'), 'dlg-both');
const DLG_BOTH_REALISM = 'Photorealistic, true-to-life skin with visible pores and natural texture (never airbrushed or plastic), natural eyes with catchlights, individual hair strands, anatomically correct hands, real fabric with natural creases, natural lighting with slight digital noise; avoid CGI / 3D-render / cartoon look.';
function _dlgLocalFromUrl(u) { if (!u) return null; const rel = String(u).replace(/^\/+/, ''); const a = path.join(ROOT_DIR, rel); if (fs.existsSync(a)) return a; const b = path.join(ROOT_DIR, 'public', rel); return fs.existsSync(b) ? b : a; }
async function _dlgPub(u) { const p = _dlgLocalFromUrl(u); if (!p || !fs.existsSync(p)) throw new Error('missing reference: ' + u); return await uploadToPublicHost(fs.readFileSync(p)); }
function _dlgSeed() { return Math.floor(Math.random() * 999999999) + 1; }
async function _dlgPollImage(taskId, dir, prefix, isAborted) {
  let r = null; const t0 = Date.now();
  while (!isAborted()) {
    await new Promise(rs => setTimeout(rs, 2500));
    try { r = await resolveTask(taskId, dir, prefix); } catch (e) { r = { state: 'pending' }; }
    if (r.state === 'success' || r.state === 'failed') break;
    if (Date.now() - t0 > 240000) { r = { state: 'failed', error: 'timeout' }; break; }
  }
  return r;
}

router.post('/dialogue/both/generate', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (res.flushHeaders) res.flushHeaders();
  let aborted = false;
  res.on('close', () => { if (!res.writableEnded) aborted = true; });
  const isAborted = () => aborted;
  const send = (o) => { try { res.write('data: ' + JSON.stringify(o) + '\n\n'); } catch (e) {} };
  const fail = (m) => { send({ type: 'error', error: m }); res.end(); };
  try {
    fs.mkdirSync(BOTH_DIR, { recursive: true });
    const b = req.body || {};
    const format = (b.format === '16:9') ? '16:9' : '9:16';
    const cam = String(b.cameraSpec || 'shot on an iPhone main camera, 24mm-equivalent wide angle, f/1.8');
    const engine = String(b.engine || 'nano-banana-2');
    const params = b.engineParams || {};
    const twoStep = !!b.twoStep;
    if (!b.hostFrame || !b.guestFrame) return fail('host and guest are required');
    const pose = DLGPOSES.get(b.poseId);
    if (!pose) return fail('pose not found');
    const poseLocal = (b.mirror && pose.mirrorFile) ? pose.mirrorFile : pose.file;

    send({ type: 'start', twoStep });
    send({ type: 'step', label: 'Preparing references' });
    const [poseU, hostU, guestU] = await Promise.all([_dlgPub(poseLocal), _dlgPub(b.hostFrame), _dlgPub(b.guestFrame)]);
    let locU = null;
    if (b.location) { try { locU = await _dlgPub(b.location); } catch (e) { locU = null; } }
    if (aborted) return res.end();

    let finalPath = null;
    if (!twoStep) {
      const refs = [poseU]; let i = 1; const lines = [];
      lines.push(`IMAGE ${i++} is a two-figure POSE TEMPLATE (a BLUE mannequin and a RED mannequin). Keep its exact composition, body poses and camera framing.`);
      if (locU) { refs.push(locU); lines.push(`IMAGE ${i++} is a LOCATION reference: use ONLY its colours, lighting and atmosphere for the BACKGROUND and overall colour grade; do NOT copy its camera angle or layout.`); }
      refs.push(hostU); lines.push(`IMAGE ${i++} is PERSON A (the host).`);
      refs.push(guestU); lines.push(`IMAGE ${i++} is PERSON B (the guest).`);
      const prompt = `You are compositing ONE photorealistic interview frame.\n` + lines.join('\n') +
        `\nReplace the BLUE mannequin with PERSON A and the RED mannequin with PERSON B, preserving each person's exact face, hairstyle and outfit from their reference; keep their clothing colours unchanged. Add only subtle rim / ambient light on the people tinted to match the location.` +
        (locU ? '' : ' Use a clean, neutral interview studio background.') +
        `\n${cam}. ${DLG_BOTH_REALISM}\nTwo real people together for an interview, natural interaction. Aspect ratio ${format}.`;
      send({ type: 'step', label: 'Compositing both' });
      const t = await createMultiRefEditTask(engine, prompt, refs, format, _dlgSeed(), params);
      const r = await _dlgPollImage(t, BOTH_DIR, 'dlgboth', isAborted);
      if (!r || r.state !== 'success') return fail((r && r.error) || 'generation failed');
      finalPath = r.imagePath;
    } else {
      // Step 1: host onto the BLUE figure, leave RED as-is.
      const refs1 = [poseU]; let i = 1; const l1 = [];
      l1.push(`IMAGE ${i++} is a two-figure POSE TEMPLATE (a BLUE mannequin and a RED mannequin). Keep its exact composition and framing.`);
      if (locU) { refs1.push(locU); l1.push(`IMAGE ${i++} is a LOCATION reference: use only its colours / lighting / atmosphere for the background; do not copy its angle.`); }
      refs1.push(hostU); l1.push(`IMAGE ${i++} is PERSON A (the host).`);
      const p1 = `You are compositing a photorealistic interview frame, step 1 of 2.\n` + l1.join('\n') +
        `\nReplace ONLY the BLUE mannequin with PERSON A, preserving their face, hair and outfit. LEAVE THE RED MANNEQUIN EXACTLY AS IT IS (a plain solid red featureless mannequin).` +
        (locU ? '' : ' Neutral interview studio background.') + `\n${cam}. ${DLG_BOTH_REALISM}\nAspect ratio ${format}.`;
      send({ type: 'step', label: 'Step 1/2 - host' });
      const t1 = await createMultiRefEditTask(engine, p1, refs1, format, _dlgSeed(), params);
      const r1 = await _dlgPollImage(t1, BOTH_DIR, 'dlgboth1', isAborted);
      if (!r1 || r1.state !== 'success') return fail((r1 && r1.error) || 'step 1 failed');
      if (aborted) return res.end();
      // Step 2: guest onto the RED figure, using step-1 output as the base.
      const baseU = await _dlgPub(r1.imagePath);
      const p2 = `You are finishing a photorealistic interview frame, step 2 of 2.\nIMAGE 1 is an interview scene: one real person (the host) on one side and a solid RED MANNEQUIN on the other.\nIMAGE 2 is PERSON B (the guest).\nReplace the RED MANNEQUIN with PERSON B, preserving their face, hair and outfit; keep the host person, the background and the lighting unchanged. Add subtle rim light on the guest to match the scene.\n${cam}. ${DLG_BOTH_REALISM}\nAspect ratio ${format}.`;
      send({ type: 'step', label: 'Step 2/2 - guest' });
      const t2 = await createMultiRefEditTask(engine, p2, [baseU, guestU], format, _dlgSeed(), params);
      const r2 = await _dlgPollImage(t2, BOTH_DIR, 'dlgboth', isAborted);
      if (!r2 || r2.state !== 'success') return fail((r2 && r2.error) || 'step 2 failed');
      finalPath = r2.imagePath;
    }
    const base = path.basename(finalPath);
    const thumbUrl = '/' + path.relative(ROOT_DIR, path.join(BOTH_DIR, 'thumbs', base)).replace(/\\/g, '/');
    send({ type: 'done', image: { file: finalPath, thumb: thumbUrl } });
    res.end();
  } catch (e) { send({ type: 'error', error: e.message }); res.end(); }
});

// ── Episode video fragment (Phase 7): Gemini 3.5 -> Seedance 2.0 mini ────────
// Turns ONE voiced line into ONE dynamic interview fragment. The spoken text in the
// prompt is CLEAN (audiotags stripped) and emotions become directorial cues, so the
// model never voices the bracketed tags.
// Built-in template. [[...]] zones are auto-filled at generation time (the prompt editor shows
// them as locked chips). Users may edit the surrounding text / add rules, not the [[...]] tokens.
const DLG_EP_SYS =
`You are an interview-montage director. You write prompts for the Seedance 2.0 video model that turn ONE spoken line into ONE dynamic fragment of a longer documentary-style vertical interview. Output STRICT JSON ONLY: {"variantA_timed":"...","variantB_descriptive":"..."} - two complete Seedance prompts for the SAME fragment, nothing else.

CONTEXT (auto-filled from the project - keep these facts):
- Speaker: [[SPEAKER]]. Listener: [[LISTENER]].
- Seating: [[SIDES]]. CRITICAL: preserve the EXACT left/right placement of BOTH people from @Image1 in EVERY shot - whoever is on the left or right in @Image1 STAYS there; NEVER mirror, flip or swap sides. Do NOT assume a fixed side per role - identify the speaker by the face in @Image2 and the listener by @Image3, and keep each on their @Image1 side.
- Spoken line (with audiotags): [[LINE]]
- Word timestamps: [[WORD_TIMINGS]]
- References: [[REFS]]
- Location: [[LOCATION]]
- Camera: [[CAMERA]]. Aspect ratio: [[ASPECT]]. Target length: ~[[TARGET_SEC]]s.

Rules for BOTH variants:
- ONE fragment of a longer interview; ONE speaker only (the speaker above).
- Use @Audio1 as the dialogue track and LIP-SYNC the speaker to it. The speaker's VOICE MUST stay identical to @Audio1 (same voice, same words) - never change or re-cast it.
- The quoted spoken words MUST be the CLEAN line with every [bracketed tag] REMOVED. Convert each tag into a DIRECTORIAL emotion cue OUTSIDE the quotes (e.g. [laughs] -> "he laughs before speaking"). NEVER put bracketed tags inside the quoted dialogue - the model would read them aloud.
- Keep identities EXACT: the speaker's face as in @Image2, the listener's as in @Image3, composition/wardrobe from @Image1.
- Multi-shot montage alternating wide two-shot <-> speaker close-up <-> listener reaction close-up + at least one fast zoom/push-in. CUT on the punchy words; on those beats show the LISTENER's emotion in close-up. Refer to each person by identity (speaker / listener), keeping them on their exact @Image1 side; never invent or swap sides.
- Handheld documentary camera; apply the camera/lens spec; given aspect ratio; ~target seconds; cinematic but realistic; no on-screen text or captions. 3-5 shots.
- variantA_timed: EXPLICIT timecodes from the word timestamps (e.g. "1.8s, on 'HOURS' -> cut to listener CU"). variantB_descriptive: NO timecodes - cuts described relative to words.
Write rich, specific shot descriptions (expression, micro-gesture, camera move, trigger word, listener emotion).`;
function _dlgFillTemplate(tpl, vals) { return String(tpl || '').replace(/\[\[(\w+)\]\]/g, (m, k) => (vals[k] != null ? String(vals[k]) : m)); }
const DLGDEF = require('../lib/dialogue-defaults');
const DLGEPP = require('../lib/dialogue-ep-prompt');
const DLGEPT = require('../lib/dialogue-ep-timings');
router.get('/dialogue/ep-timings', (_q, res) => { try { res.json(DLGEPT.averages()); } catch (e) { res.status(500).json({ error: e.message }); } });
router.get('/dialogue/video-defaults', (_q, res) => { try { res.json({ defaults: DLGDEF.get() }); } catch (e) { res.status(500).json({ error: e.message }); } });
router.post('/dialogue/video-defaults', (req, res) => { try { res.json({ defaults: DLGDEF.save(req.body || {}) }); } catch (e) { res.status(500).json({ error: e.message }); } });
router.get('/dialogue/ep-prompt', (_q, res) => { try { const s = DLGEPP.state(DLG_EP_SYS); res.json({ activeId: s.activeId, active: s.active, original: s.original, versions: s.versions.map(v => ({ id: v.id, ts: v.ts, text: v.text })) }); } catch (e) { res.status(500).json({ error: e.message }); } });
router.post('/dialogue/ep-prompt/save', (req, res) => { try { res.json({ success: true, id: DLGEPP.save((req.body || {}).text || '') }); } catch (e) { res.status(500).json({ success: false, error: e.message }); } });
router.post('/dialogue/ep-prompt/activate', (req, res) => { try { DLGEPP.activate((req.body || {}).id); res.json({ success: true }); } catch (e) { res.status(500).json({ success: false, error: e.message }); } });
router.post('/dialogue/ep-prompt/reset', (_q, res) => { try { DLGEPP.reset(); res.json({ success: true }); } catch (e) { res.status(500).json({ success: false, error: e.message }); } });

let _FormData = null; try { _FormData = require('form-data'); } catch (e) {}
async function _dlgWordTimings(localPath) {
  try {
    if (!_FormData || !localPath || !fs.existsSync(localPath)) return [];
    const s = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'data', 'settings.json'), 'utf8'));
    const key = (s.groqApiKey || '').trim(); if (!key) return [];
    const form = new _FormData();
    form.append('file', fs.createReadStream(localPath));
    form.append('model', 'whisper-large-v3-turbo');
    form.append('response_format', 'verbose_json');
    form.append('timestamp_granularities[]', 'word');
    const res = await axios.post('https://api.groq.com/openai/v1/audio/transcriptions', form, { headers: { ...form.getHeaders(), Authorization: `Bearer ${key}` }, timeout: 60000, maxBodyLength: Infinity });
    return (res.data.words || []).filter(w => typeof w.start === 'number').map(w => ({ text: w.word || w.text || '', start: w.start, end: (w.end != null ? w.end : w.start + 0.3) }));
  } catch (e) { console.warn('[dlg word timings]', e.message); return []; }
}
async function _dlgPollVideo(taskId, isAborted) {
  const t0 = Date.now();
  while (!isAborted()) {
    await new Promise(rs => setTimeout(rs, 4000));
    let s; try { s = await axios.get(`${KIE_BASE}/api/v1/jobs/recordInfo`, { params: { taskId }, headers: kieHeaders(), timeout: 15000 }); } catch (e) { continue; }
    const data = (s.data && s.data.data) || {}; const state = String(data.state || data.status || '').toLowerCase();
    if (['pending', 'waiting', 'queued', 'processing', 'running', 'started', 'in_progress', 'active', ''].includes(state)) { if (Date.now() - t0 > 600000) return { state: 'failed', error: 'timeout' }; continue; }
    if (['success', 'completed', 'done', 'finished'].includes(state)) { let url = null; try { const r = JSON.parse(data.resultJson); url = (r.resultUrls && r.resultUrls[0]) || r.video_url || r.url; } catch (e) {} return { state: 'success', url }; }
    return { state: 'failed', error: data.failMsg || data.errorMessage || state };
  }
  return { state: 'aborted' };
}

router.post('/dialogue/episode/video', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (res.flushHeaders) res.flushHeaders();
  let aborted = false;
  res.on('close', () => { if (!res.writableEnded) aborted = true; });
  const send = (o) => { try { res.write('data: ' + JSON.stringify(o) + '\n\n'); } catch (e) {} };
  const fail = (m) => { send({ type: 'error', error: m }); res.end(); };
  try {
    const b = req.body || {};
    const speaker = b.speaker === 'guest' ? 'guest' : 'host';
    const listener = speaker === 'host' ? 'guest' : 'host';
    const text = String(b.text || '').trim(); if (!text) return fail('no line text');
    const both = b.both, audio = b.audio;
    if (!both) return fail('generate the Both image first');
    if (!audio) return fail('voice this line first');
    if (!b.speakerFrame || !b.listenerFrame) return fail('both characters required');
    const camSpec = String(b.cameraSpec || 'shot on an iPhone main camera, 24mm-equivalent wide angle, f/1.8');
    const format = b.format === '16:9' ? '16:9' : '9:16';
    const audioDur = (+b.audioDur) || 7;
    const target = Math.max(4, Math.min(15, Math.round(audioDur + 1)));
    const timing = b.seedTiming === 'timed' ? 'timed' : 'words';
    const improve = b.seedImprove !== false;   // default true
    const resolution = ['480p', '720p', '1080p'].includes(b.resolution) ? b.resolution : '480p';
    const nsfw = b.nsfw === true;              // default off -> nsfw_checker false (allow spicy)
    const location = b.location || null;        // optional environment palette reference

    const _epT0 = Date.now();
    send({ type: 'eta', seconds: DLGEPT.predict(target) });   // smart ETA from learned per-duration averages
    send({ type: 'step', label: 'Analyzing the line' });
    let words = [];
    if (timing === 'timed') { const ap = _dlgLocalFromUrl(audio); words = await _dlgWordTimings(ap); }
    const wordsStr = words.map(w => `${w.text}@${(+w.start).toFixed(2)}-${(+w.end).toFixed(2)}`).join('  ');

    send({ type: 'step', label: 'Writing the shot list' });
    // Side lock (option A): host always LEFT, guest always RIGHT, mirrored from @Image1.
    const refsStr = `@Image1 = wide two-shot of both; @Image2 = ${speaker} face; @Image3 = ${listener} face;` + (location ? ` @Image4 = location reference;` : '') + ` @Audio1 = the dialogue audio.`;
    const locStr = location ? `use @Image4's colours, lighting and atmosphere for the background (do not copy its camera angle); keep the setting consistent with @Image1.` : `neutral interview studio background, consistent with @Image1.`;
    const vals = {
      SPEAKER: `${speaker} (${b.speakerGender || 'person'})`,
      LISTENER: `${listener} (${b.listenerGender || 'person'})`,
      SIDES: 'use the exact left/right placement shown in @Image1 (the speaker is the face in @Image2, the listener in @Image3) - keep them on those sides',
      LINE: text,
      WORD_TIMINGS: wordsStr || '(none - approximate from the text)',
      REFS: refsStr,
      LOCATION: locStr,
      CAMERA: camSpec,
      ASPECT: format,
      TARGET_SEC: target,
    };
    const sys = _dlgFillTemplate(DLGEPP.state(DLG_EP_SYS).active, vals);
    let raw; try { raw = await callAI([{ role: 'system', content: sys }, { role: 'user', content: 'Produce the two Seedance prompts now as STRICT JSON: {"variantA_timed":"...","variantB_descriptive":"..."}.' }], { openRouterModel: 'google/gemini-3.5-flash', timeout: 90000 }); } catch (e) { return fail('prompt gen failed: ' + e.message); }
    let j; try { j = JSON.parse((raw || '').replace(/```json|```/g, '').trim()); } catch (e) { const m = (raw || '').match(/\{[\s\S]*\}/); j = m ? (() => { try { return JSON.parse(m[0]); } catch (_) { return null; } })() : null; }
    const prompt = j ? (timing === 'timed' ? (j.variantA_timed || j.variantB_descriptive) : (j.variantB_descriptive || j.variantA_timed)) : null;
    if (!prompt) return fail('prompt generation failed');
    if (aborted) return res.end();

    send({ type: 'step', label: 'Uploading references' });
    let bothU, spkU, lisU, audU, locU = null;
    try { [bothU, spkU, lisU, audU] = await Promise.all([_dlgPub(both), _dlgPub(b.speakerFrame), _dlgPub(b.listenerFrame), _dlgPub(audio)]); if (location) { try { locU = await _dlgPub(location); } catch (e) { locU = null; } } }
    catch (e) { return fail('upload failed: ' + e.message); }
    if (aborted) return res.end();

    send({ type: 'step', label: 'Rendering the fragment' });
    const SLUGS = ['bytedance/seedance-2-mini', 'bytedance/seedance-2-0-mini', 'bytedance/seedance-2'];
    let taskId = null;
    for (const slug of SLUGS) {
      try {
        const cr = await axios.post(`${KIE_BASE}/api/v1/jobs/createTask`,
          { model: slug, input: { prompt, reference_image_urls: locU ? [bothU, spkU, lisU, locU] : [bothU, spkU, lisU], reference_audio_urls: [audU], generate_audio: improve, resolution, aspect_ratio: format, duration: target, nsfw_checker: nsfw } },
          { headers: kieHeaders(), timeout: 30000 });
        taskId = cr.data && cr.data.data && cr.data.data.taskId; if (taskId) break;
      } catch (e) { /* try next slug */ }
    }
    if (!taskId) return fail('seedance createTask failed');
    const r = await _dlgPollVideo(taskId, () => aborted);
    if (!r || r.state !== 'success' || !r.url) return fail((r && r.error) || 'render failed');
    const fn = `dlgep_${Date.now()}.mp4`;
    const out = path.join(UPLOADS_DIR, fn);
    const vr = await axios({ url: r.url, method: 'GET', responseType: 'arraybuffer', timeout: 180000 });
    fs.writeFileSync(out, Buffer.from(vr.data));
    try { DLGEPT.record(target, (Date.now() - _epT0) / 1000); } catch (e) {}   // learn the render time for this duration
    send({ type: 'done', video: '/uploads/' + fn, prompt });
    res.end();
  } catch (e) { send({ type: 'error', error: e.message }); res.end(); }
});

// Extract the audio track from a generated video fragment -> mp3 (same length as the video).
// Used by the dialogues -> Merge handoff so the Merge clip runs the FULL video length (no
// audio-duration truncation, which is intentionally kept for ugc_ad) and subtitles are built
// from the real video audio. Idempotent.
const { spawn: _spawn } = require('child_process');
let _ffmpegPath = null; try { _ffmpegPath = require('ffmpeg-static'); } catch (e) {}
router.post('/dialogue/extract-audio', async (req, res) => {
  try {
    const v = (req.body || {}).video; if (!v) return res.status(400).json({ error: 'no video' });
    if (!_ffmpegPath) return res.status(500).json({ error: 'ffmpeg not available' });
    const src = _dlgLocalFromUrl(v); if (!src || !fs.existsSync(src)) return res.status(404).json({ error: 'video not found' });
    const base = path.basename(src).replace(/\.[^.]+$/, '') + '_av.mp3';
    const outDisk = path.join(UPLOADS_DIR, base), outUrl = '/uploads/' + base;
    if (fs.existsSync(outDisk)) return res.json({ audio: outUrl });   // idempotent
    // Probe the VIDEO duration, then pad/trim the extracted audio to EXACTLY that length so the
    // Merge clip (timed by this audio for creatives) runs the full video with no truncation.
    let dur = 0;
    try {
      const txt = await new Promise((rs) => { const p = _spawn(_ffmpegPath, ['-i', src], { stdio: ['ignore', 'ignore', 'pipe'] }); let e = ''; if (p.stderr) p.stderr.on('data', d => { e += d; }); p.on('close', () => rs(e)); p.on('error', () => rs('')); });
      const m = String(txt).match(/Duration:\s*(\d+):(\d+):(\d+\.\d+)/); if (m) dur = (+m[1] * 3600 + +m[2] * 60 + +m[3]);
    } catch (e) {}
    const args = ['-y', '-i', src, '-vn'];
    if (dur > 0) args.push('-af', 'apad', '-t', dur.toFixed(2));   // pad silence then cut to exact video length
    args.push('-acodec', 'libmp3lame', '-q:a', '4', outDisk);
    await new Promise((resolve, reject) => {
      const p = _spawn(_ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
      let err = ''; if (p.stderr) p.stderr.on('data', d => { err += d; });
      p.on('close', c => c === 0 ? resolve() : reject(new Error('ffmpeg exit ' + c + ': ' + err.slice(-200))));
      p.on('error', reject);
    });
    if (!fs.existsSync(outDisk)) return res.status(500).json({ error: 'extract failed' });
    res.json({ audio: outUrl });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
