'use strict';

const express = require('express');
const path    = require('path');
const fs      = require('fs');
const axios   = require('axios');
const router  = express.Router();

const { UPLOADS_DIR, CHARACTERS_DIR, KIE_BASE, CHAR_OPTIMIZE_MODEL, ROOT_DIR } = require('../lib/config');
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
router.post('/dialogue/script', async (req, res) => {
  try {
    const SP = require('../lib/scenario-prompts');
    const { topic, product, includeProduct, hostRole, guestRole, lines, vertical, source, tone, taboo, theme } = req.body || {};
    const n = Math.min(Math.max(parseInt(lines, 10) || 6, 2), 14);
    const host = String(hostRole || 'Host').trim(), guest = String(guestRole || 'Guest').trim();
    const prod = String(product || '').trim();
    const useProduct = includeProduct !== false && !!prod;
    const toneLine = (tone && String(tone).trim()) ? `Tone/style: ${String(tone).trim()}. ` : '';
    const th = String(theme || 'marketing');
    const vid = String(vertical || '');
    const logs = [];

    const productLine = useProduct
      ? `PRODUCT to sell: "${prod}". Weave it in naturally as the solution; build desire and land a soft CTA toward it.`
      : `Do NOT mention any product or brand — pure value/story dialogue that builds curiosity.`;
    const sys1 =
      `You are a world-class direct-response copywriter. Write a natural ${n}-line two-person dialogue for a vertical short-form video, following the canon of high-converting sales dialogue: 0-3s HOOK, agitate the pain, a unique mechanism/insight, concrete proof, handle the top objection, future-pace the win, clear payoff/CTA.\n` +
      `HOST role: ${host}. GUEST role: ${guest}. Each speaker MUST talk, think and use vocabulary true to their role. ${toneLine}\n` +
      `Topic/offer: ${topic || prod || 'general'}.\n${productLine}\n` +
      `Alternate speakers (HOST opens). Each line = punchy spoken on-camera speech, ONE idea, 1-2 sentences. Keep this pass CLEAN and brand-safe.\n` +
      `VOICE TAGS (REQUIRED): write for ElevenLabs v3 TTS — embed audio tags inline in square brackets to direct emotional delivery and reactions. Put 1-3 tags on most lines, each immediately before the words it affects, e.g. "[excited] You have to see this... [whispers] it is basically free." The bracket tags stay literally inside the "text" field. Use ONLY these tags: ${DLG_TAGS_STR}.\n` +
      `Return ONLY raw JSON: {"cast":[{"role":"host","name":"${host}"},{"role":"guest","name":"${guest}"}],"lines":[{"speaker":"host","text":"[tag] ..."},{"speaker":"guest","text":"..."}]}. Exactly ${n} lines, HOST first. No markdown, no commentary.`;
    const raw1 = await callAI([{ role: 'user', content: sys1 }], { useOpenRouter: true, openRouterModel: 'google/gemini-3.5-flash', timeout: 45000 });
    const p1 = parseLooseJson(raw1) || {};
    const clean = Array.isArray(p1.lines) ? p1.lines.filter(l => l && l.text).map(l => ({ speaker: l.speaker === 'guest' ? 'guest' : 'host', text: String(l.text).trim() })) : [];
    if (!clean.length) throw new Error('Pass 1 (Gemini) did not return lines');
    const cast = p1.cast || [{ role: 'host', name: host }, { role: 'guest', name: guest }];
    logs.push(`Pass 1 (Gemini 3.5 Flash): clean script with inline voice tags — ${clean.length} lines.`);

    const lvl = ['none', 'mild', 'spicy', 'explicit'].includes(String(taboo)) ? String(taboo) : 'spicy';
    let colored = clean, p2used = false;
    if (lvl !== 'none') {
      const srcSel = String(source || 'all');
      let srcText = '';
      try { srcText = (srcSel && srcSel !== 'all') ? SP.readSourceText(th, vid, srcSel, { maxChars: 8000 }) : SP.readSourcesText(th, vid, { maxChars: 8000 }); } catch (e) {}
      const srcBlock = srcText ? `\nSOURCE VOICE to mirror (mine its tone, slang and angles; do NOT copy verbatim):\n"""\n${srcText}\n"""\n` : '';
      const sys2 =
        `You are a savage short-form copywriter doing an AGGRESSIVE recolor ("arbitrage"). Take the clean dialogue below and RECOLOR it to taboo level "${lvl}" for the "${vid || 'general'}" niche — ${DLG_TABOO[lvl]}\n` +
        `Keep the SAME line count (${clean.length}), the SAME speakers in the SAME order, and the SAME selling beats; keep each speaker true to their role (HOST: ${host}, GUEST: ${guest}). Make the hooks sharper and the voice match the source. Recolor ONLY wording/voice/energy — never change who says what or the order.\n` +
        `PRESERVE the inline ElevenLabs voice tags: keep the [bracket] audio tags in the lines (you may reposition them or swap for a better-fitting one, and add a tag where the new energy calls for it), but use ONLY tags from this set and keep at least one tag wherever the clean line had one: ${DLG_TAGS_STR}.${srcBlock}\n` +
        `Return ONLY raw JSON: {"lines":[{"speaker":"host","text":"[tag] ..."},...]} with exactly ${clean.length} lines in the same speaker order, voice tags intact. No markdown.\n\n` +
        `CLEAN DIALOGUE:\n${JSON.stringify({ lines: clean })}`;
      try {
        const raw2 = await callAI([{ role: 'user', content: sys2 }], { useOpenRouter: true, openRouterModel: CHAR_OPTIMIZE_MODEL, timeout: 45000 });
        const p2 = parseLooseJson(raw2) || {};
        const c2 = Array.isArray(p2.lines) ? p2.lines.filter(l => l && l.text).map((l, i) => ({ speaker: (l.speaker === 'guest' ? 'guest' : (l.speaker === 'host' ? 'host' : (clean[i] ? clean[i].speaker : 'host'))), text: String(l.text).trim() })) : [];
        if (c2.length) { colored = c2; p2used = true; logs.push(`Pass 2 (Hermes 4 405B): recolored at taboo="${lvl}"${srcText ? ' from source "' + srcSel + '"' : ' (no source text)'} — ${c2.length} lines.`); }
        else logs.push('Pass 2 (Hermes): no usable output — kept the clean script.');
      } catch (e) { logs.push('Pass 2 (Hermes) error: ' + e.message + ' — kept the clean script.'); }
    } else {
      logs.push('Pass 2 skipped (taboo=none).');
    }

    const finalLines = p2used ? colored : clean;
    const pairs = [];   // consecutive 1+2 pairs for the two-cards-per-row view
    for (let i = 0; i < finalLines.length; i += 2) pairs.push(finalLines.slice(i, i + 2));
    logs.push(`Paired ${finalLines.length} lines into ${pairs.length} card row(s).`);
    res.json({ success: true, cast, lines: finalLines, clean, colored: finalLines, pairs, taboo: lvl, logs });
  } catch (err) {
    console.error('[dialogue/script]', err.message);
    res.status(502).json({ success: false, error: err.message });
  }
});

// Voice-tag taxonomy for the dialogue editor (eleven_v3 audio tags), grouped by emotion.
router.get('/dialogue/voice-tags', (_req, res) => res.json({ groups: DLG_VOICE_TAGS }));

module.exports = router;
