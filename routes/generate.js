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

// ── GET /api/random-face — a random face from thispersondoesnotexist.com ──────
// EPHEMERAL: returned as a data URL, never written to disk. The face only
// exists to seed the 4K reference sheet (Save character sends it as base64).
router.get('/random-face', async (_req, res) => {
  try {
    // The site now serves an HTML shell at "/" — the actual face lives at /random-person.jpeg.
    const response = await axios({ method: 'GET', url: 'https://thispersondoesnotexist.com/random-person.jpeg', responseType: 'arraybuffer', timeout: 15000, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36', 'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8' } });
    const ct = String(response.headers['content-type'] || '');
    const buf = Buffer.from(response.data);
    // TPDNE sometimes serves an HTML interstitial instead of the JPEG — reject it
    // so the client can simply re-click instead of showing a broken face.
    if (!ct.startsWith('image/') || buf.length < 10000) throw new Error('TPDNE returned non-image (' + (ct || 'unknown') + ') — try again');
    res.json({ success: true, dataUrl: 'data:' + ct + ';base64,' + buf.toString('base64') });
  } catch (err) {
    res.status(502).json({ success: false, error: err.message });
  }
});

// ── POST /api/character-creator/compose — dry-run prompt previews (no generation)
// kind:'create' (default) -> spec -> the exact portrait prompt string
// kind:'edit'             -> the refine/edit prompt skeleton (buildPrompt)
// kind:'save'             -> the 4K reference-sheet prompt (+ realism markers)
router.post('/character-creator/compose', (req, res) => {
  try {
    const kind = String((req.body && req.body.kind) || 'create');
    const markers = Array.isArray(req.body && req.body.realismMarkers) ? req.body.realismMarkers.map(s => String(s).trim()).filter(Boolean) : [];
    if (kind === 'save') {
      const { CHAR_SHEET_PROMPT } = require('../lib/config');
      const prompt = markers.length ? (CHAR_SHEET_PROMPT + ' Realism: ' + markers.join(', ') + '.') : CHAR_SHEET_PROMPT;
      return res.json({ success: true, prompt });
    }
    if (kind === 'edit') {
      const age = (req.body && req.body.age) || '25-34';
      const gender = (req.body && req.body.gender) || 'female';
      const instruction = (req.body && req.body.instruction) || '<your edit instruction>';
      const prompt = buildPrompt(age, gender, [], instruction, null, '', markers.join(', '));
      return res.json({ success: true, prompt });
    }
    let spec = req.body && req.body.spec;
    if (typeof spec === 'string') { try { spec = JSON.parse(spec); } catch { spec = null; } }
    res.json({ success: true, prompt: _specToPortraitPrompt(spec || {}) });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

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

// ── POST /api/characters/reference-sheet ──────────────────────────────────────
// Generate ONE 4K 16:9 "technical reference sheet" of the SAME person in three
// full-body angles (front / three-quarter / side) from the obraz photo. Used as a
// Seedance character APPEARANCE reference (not a frame). SSE: emits step/done/error;
// auto-retries up to 3 attempts (the image-fetch path is occasionally flaky). Saves
// into the obraz folder so it travels with the obraz.
const _REFSHEET_PROMPT =
  'Full-body technical character reference sheet of the SAME person from the reference image - three full-body views side by side in ONE single image: front view, three-quarter (45 degree) view, and side profile view. Each view shows the ENTIRE body head to feet, fully visible and well inside the frame, neutral relaxed standing pose, arms relaxed at the sides. Plain light-grey studio background, soft even lighting, identical identity - same face, hairstyle, body and outfit - across all three views, evenly spaced. Photorealistic, sharp, no text, no labels, no watermark.';
router.post('/characters/reference-sheet', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform'); res.setHeader('Connection', 'keep-alive'); res.setHeader('X-Accel-Buffering', 'no');
  if (res.flushHeaders) res.flushHeaders();
  let aborted = false; res.on('close', () => { if (!res.writableEnded) aborted = true; });
  const send = (o) => { try { res.write('data: ' + JSON.stringify(o) + '\n\n'); } catch (e) {} };
  try {
    const b = req.body || {};
    const imagePath = b.imagePath; const obrazId = b.obrazId || null;
    if (!imagePath) { send({ type: 'error', error: 'no imagePath' }); return res.end(); }
    const absPath = path.join(ROOT_DIR, String(imagePath).replace(/^\//, ''));
    if (!fs.existsSync(absPath)) { send({ type: 'error', error: 'image not found' }); return res.end(); }
    let destDir = CHARACTERS_DIR;
    if (obrazId) { const f = findObrazFolderById(obrazId); if (f) { try { fs.mkdirSync(f, { recursive: true }); } catch (e) {} destDir = f; } }
    let imageUrl; try { imageUrl = await uploadToPublicHost(fs.readFileSync(absPath)); } catch (e) { send({ type: 'error', error: 'upload failed: ' + e.message }); return res.end(); }
    let saved = null;
    for (let attempt = 1; attempt <= 3 && !saved && !aborted; attempt++) {
      send({ type: 'step', attempt, label: '3-angle 4K reference sheet' + (attempt > 1 ? ' (retry ' + (attempt - 1) + ')' : '') });
      let taskId = null;
      try { taskId = await createNanoBananaProTask(_REFSHEET_PROMPT, imageUrl, '16:9', { resolution: '4K' }); } catch (e) { continue; }
      let r = null; const t0 = Date.now();
      while (!aborted) { await new Promise(rs => setTimeout(rs, 3000)); try { r = await resolveTask(taskId, destDir, 'refsheet'); } catch (e) { r = { state: 'pending' }; } if (r.state === 'success' || r.state === 'failed') break; if (Date.now() - t0 > 300000) { r = { state: 'failed', error: 'timeout' }; break; } }
      if (r && r.state === 'success') saved = r.imagePath;
    }
    if (saved) send({ type: 'done', image: saved }); else send({ type: 'error', error: 'generation failed after 3 attempts' });
    res.end();
  } catch (e) { send({ type: 'error', error: e.message }); res.end(); }
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
// ElevenLabs v3 inline audio tags the dialogue is written with, grouped by emotion.
// Single source of truth: the Gemini/Hermes prompts AND the frontend tag-picker popup
// (GET /api/dialogue/voice-tags) both read this set.
// SSE stream. 6 LLM calls across 4 visible stages:
//   1) clean dialogue (Gemini, tone-neutral, no tags)
//   2) taboo recolor (Hermes) -> colored
//   3) emotion analysis for clean + colored IN PARALLEL (Gemini x2)
//   4) voice-tag placement for clean + colored IN PARALLEL (Gemini x2)
// Emits {type:'step',n,total,label} before each stage, {type:'done',...} at the end,
// {type:'error',...} on failure. Aborts at the next stage boundary if the client closes.

// ── UGC scenario stage config: editable stage prompts + per-stage model picks ──
router.get('/scenario/config', (_q, res) => {
  try { res.json({ success: true, ...require('../lib/scenario-stages').getConfig() }); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});
router.post('/scenario/config', (req, res) => {
  try { res.json({ success: true, ...require('../lib/scenario-stages').saveConfig(req.body || {}) }); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// Voice-tag taxonomy for the dialogue editor (eleven_v3 audio tags), grouped by emotion.

// ── Dialogue projects (Scenarios/dialogues): persistent list/get/save/delete ──


// ── Interview-pose anchors (Video setup) ─────────────────────────────────────
// A reusable library of two-figure interview anchors (host = solid BLUE / left,
// guest = solid RED / right) generated as plain matte mannequins. They are the
// composition base onto which each character's look is later applied. New, separate
// pipeline (does NOT reuse the Character-tab pose-generate). Stored under obrazy/dlg-poses.



// SSE: generate the interview-pose anchors for one format, then mirror + thumbnail each.

// ── ugc_ad SOLO pose anchors (single coloured mannequin) ─────────────────────
const UGCPOSES = require('../lib/ugc-poses');
const UGC_POSE_DIR = path.join(OBRAZY_DIR || path.join(ROOT_DIR, 'obrazy'), 'ugc-poses');

// Generic image upload (multipart field "image") -> /uploads/<file>. Used by the ugc
// Product slot and the custom-pose popup.
let _ugcImgUpload = null;
try {
  const _m = require('multer');
  _ugcImgUpload = _m({
    storage: _m.diskStorage({
      destination: (q, f, cb) => { try { fs.mkdirSync(UPLOADS_DIR, { recursive: true }); } catch (e) {} cb(null, UPLOADS_DIR); },
      filename: (q, f, cb) => cb(null, 'upl_' + Date.now() + '_' + Math.round(Math.random() * 1e6) + (path.extname(f.originalname || '') || '.jpg')),
    }),
    limits: { fileSize: 25 * 1024 * 1024 },
  });
} catch (e) {}
if (_ugcImgUpload) router.post('/upload', _ugcImgUpload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, error: 'no file' });
  res.json({ success: true, path: '/uploads/' + req.file.filename });
});
const UGC_SOLO_POSES = [
  { key: 'selfie_high',     label: 'Selfie, high angle',   desc: 'holding the phone up at a high selfie angle, looking up into the lens, head-and-shoulders, one hand visible holding the phone near the top of frame' },
  { key: 'front_talk',      label: 'Front, talking',       desc: 'standing front-on to the camera at eye level, talking with one hand gesturing near the chest, waist-up' },
  { key: 'three_quarter',   label: 'Three-quarter',        desc: 'standing at a three-quarter angle to the camera, relaxed, head turned to glance toward the lens' },
  { key: 'low_confident',   label: 'Low angle, confident', desc: 'shot from a slightly low angle looking up, confident stance, hands on the hips, full body' },
  { key: 'seated_desk',     label: 'Seated at a desk',     desc: 'seated at a desk facing the camera, leaning forward on the elbows, hands clasped together' },
  { key: 'walk_selfie',     label: 'Walking selfie',       desc: 'walking toward the camera holding the phone for a selfie video, mid-step, the free hand swinging' },
  { key: 'present_side',    label: 'Presenting to side',   desc: 'standing, one open hand presenting to the side as if showing a product, body angled, face to camera' },
  { key: 'close_handface',  label: 'Close-up, hand up',    desc: 'tight head-and-shoulders close-up, one hand raised near the face mid-gesture, looking into the lens' },
];
const UGC_POSE_STYLE =
  'ONE full-body human figure for a single-presenter, direct-to-camera UGC / vlog shot, framed for short-form vertical video. ' +
  'The figure is a smooth, featureless matte BLUE mannequin (solid blue, no face, no texture, no clothing detail) - a pure pose and composition anchor marking the presenter. ' +
  'Plain neutral light-grey studio background, soft even lighting, the full body fully visible and well inside the frame, no props. ';
// Custom pose: analyse the uploaded photo's technical parameters, then RECREATE it as a
// matte-blue mannequin (same style as the presets) posed exactly by the source outlines.
// The tech params bind to the pose and are appended to result generation so the character
// is rendered with the same framing/lighting.
const _UGC_POSE_TECH_PROMPT =
  'You are a cinematographer. Describe ONLY the photographic and technical parameters of this image in ONE tight line: shot size (close-up / waist-up / full-body), camera angle and height (eye-level / low / high / selfie), apparent lens and perspective, distance to subject, and the lighting setup and direction. Do NOT describe the person, identity, clothing or background content. Respond with ONLY the description, no preamble.';
// Body-position description: the exact POSE + composition (so the result locks angle/framing
// to the mannequin). Excludes identity/clothing/background. Stored as the pose's `desc`.
const _UGC_POSE_DESC_PROMPT =
  'Describe ONLY the body pose and composition of the figure in ONE tight line: overall body position (standing / seated / leaning / walking), the position of each arm and hand, head tilt and gaze direction, torso orientation to the camera, and how the figure is framed/cropped in the shot. Do NOT mention identity, face details, clothing, colours or background. Respond with ONLY the description, no preamble.';
const _UGC_POSE_SKETCH_PROMPT =
  'Take THIS photo and convert the person into a smooth, featureless matte BLUE mannequin (solid blue like a plain store dummy - no face, no hair, no clothing detail, no texture). ' +
  'This is an EDIT of the photo, NOT a reinterpretation: keep the body pose, every limb and hand position, the head tilt, the camera angle, the subject scale, the framing and the exact crop PIXEL-FOR-PIXEL identical to the photo. The blue figure must sit in the SAME silhouette and the SAME position in the frame as the person and be cut off at the SAME frame edges. Do NOT re-pose, re-angle, zoom, pan, straighten or recompose - only the surface changes to blue clay. ' +
  'Replace the background with a plain neutral light-grey studio backdrop and soft even lighting. Exactly ONE matte-blue mannequin figure, no person, no second figure, no text, no watermark.';

router.get('/ugc/poses', (req, res) => {
  try {
    const fmt = req.query.format ? String(req.query.format) : null;
    const scope = String(req.query.scope || 'active');
    let poses = UGCPOSES.list(scope === 'all' ? null : fmt);                                      // Library 'all' ignores format
    if (scope === 'active') poses = poses.filter(p => p.active !== false && !p.archived);         // dropdown
    else if (scope === 'popup') poses = poses.filter(p => !p.archived);                           // popup gallery (active + inactive)
    else if (scope === 'archived') poses = poses.filter(p => !!p.archived);                       // (legacy) archived only
    // scope === 'all' -> every record (active/inactive/archived), used by the Library manager
    res.json({ poses, presets: UGC_SOLO_POSES });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
router.post('/ugc/poses/update', (req, res) => {
  try { const b = req.body || {}; const rec = UGCPOSES.get(b.id); if (!rec) return res.status(404).json({ success: false, error: 'not found' });
    if ('active' in b) rec.active = !!b.active; if ('archived' in b) rec.archived = !!b.archived;
    if ('label' in b) rec.label = String(b.label || '').slice(0, 60);
    UGCPOSES.save(rec); res.json({ success: true, pose: rec });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});
router.post('/ugc/poses/delete', (req, res) => {
  try { const rec = UGCPOSES.get((req.body || {}).id); if (rec) [rec.file, rec.thumb].forEach(u => { try { if (u) fs.unlinkSync(path.join(ROOT_DIR, u.replace(/^\//, ''))); } catch (e) {} }); UGCPOSES.remove((req.body || {}).id); res.json({ success: true }); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});
router.post('/ugc/poses/generate', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform'); res.setHeader('Connection', 'keep-alive'); res.setHeader('X-Accel-Buffering', 'no');
  if (res.flushHeaders) res.flushHeaders();
  let aborted = false; res.on('close', () => { if (!res.writableEnded) aborted = true; });
  const send = (o) => { try { res.write('data: ' + JSON.stringify(o) + '\n\n'); } catch (e) {} };
  try {
    fs.mkdirSync(UGC_POSE_DIR, { recursive: true });
    const format = ((req.body || {}).format === '16:9') ? '16:9' : '9:16';
    const keys = Array.isArray((req.body || {}).keys) && (req.body || {}).keys.length ? (req.body || {}).keys : UGC_SOLO_POSES.map(p => p.key);
    const want = UGC_SOLO_POSES.filter(p => keys.includes(p.key));
    const TOTAL = want.length; send({ type: 'start', total: TOTAL, format });
    const subs = [];
    for (let i = 0; i < want.length && !aborted; i++) {
      const ps = want[i]; send({ type: 'step', n: i + 1, total: TOTAL, label: 'Submitting ' + ps.label });
      let taskId = null;
      try { taskId = await createNanoBananaProTask(UGC_POSE_STYLE + 'Pose: ' + ps.desc + '.', null, format, { resolution: '2K' }); }
      catch (e) { send({ type: 'poseerr', n: i + 1, key: ps.key, error: e.message }); }
      subs.push({ ps, taskId });
      if (i < want.length - 1) await new Promise(rs => setTimeout(rs, 700));
    }
    const made = [];
    await Promise.all(subs.map(async (s, idx) => {
      if (!s.taskId || aborted) return;
      let r = null; const t0 = Date.now();
      while (!aborted) {
        await new Promise(rs => setTimeout(rs, 2500 + idx * 150));
        try { r = await resolveTask(s.taskId, UGC_POSE_DIR, 'ugcpose'); } catch (e) { r = { state: 'pending' }; }
        if (r.state === 'success' || r.state === 'failed') break;
        if (Date.now() - t0 > 240000) { r = { state: 'failed', error: 'timeout' }; break; }
      }
      if (!r || r.state !== 'success') { send({ type: 'poseerr', key: s.ps.key, error: (r && r.error) || 'failed' }); return; }
      const fileUrl = r.imagePath; const base = path.basename(fileUrl);
      const thumbUrl = '/' + path.relative(ROOT_DIR, path.join(UGC_POSE_DIR, 'thumbs', base)).replace(/\\/g, '/');
      const rec = UGCPOSES.save({ format, key: s.ps.key, label: s.ps.label, desc: s.ps.desc, file: fileUrl, thumb: thumbUrl, active: true });
      made.push(rec); send({ type: 'pose', n: made.length, total: TOTAL, pose: rec });
    }));
    send({ type: 'done', poses: made, aborted }); res.end();
  } catch (e) { send({ type: 'error', error: e.message }); res.end(); }
});

// Custom pose: user uploads a photo -> (1) analyse its photographic parameters,
// (2) redraw it as a blue-mannequin pencil sketch. Saved as a pose with techParams.
router.post('/ugc/poses/custom', async (req, res) => {
  try {
    const b = req.body || {};
    const format = b.format === '16:9' ? '16:9' : '9:16';
    fs.mkdirSync(UGC_POSE_DIR, { recursive: true });
    const imagePath = b.imagePath;
    const location = b.location, placement = String(b.placement || '').trim();

    // ── Branch B: build the pose mannequin FROM a location image + a text placement ──
    // (no source photo) - stage a single blue mannequin INSIDE the picked location,
    // posed per the user's text, then analyse the RESULT for tech + body-pose params.
    if (!imagePath && location) {
      let locU; try { locU = await _dlgPub(location, { skipOwnHost: true }); } catch (e) { return res.status(400).json({ success: false, error: 'location not found' }); }
      const seed = Math.floor(Math.random() * 999999999) + 1;
      const locPrompt =
        'IMAGE 1 is a LOCATION / environment reference. Stage the scene INSIDE this location: reuse its surfaces, furniture, geometry, colours, lighting and atmosphere so the place reads as that exact location. ' +
        'Into that location place EXACTLY ONE smooth, featureless matte BLUE mannequin (solid blue like a plain store dummy - no face, no hair, no clothing detail, no texture) as a pure pose and composition anchor for a single-presenter, direct-to-camera UGC / vlog shot. ' +
        (placement ? ('Placement and pose of the mannequin relative to the location: ' + placement + '. ') : '') +
        'Frame it for short-form vertical video with the mannequin the clear subject and well inside the frame. Exactly ONE matte-blue mannequin, no real person, no second figure, no text, no watermark.';
      const taskId = await createMultiRefEditTask('nano-banana-2', locPrompt, [locU], format, seed, {});
      const r = await _dlgPollImage(taskId, UGC_POSE_DIR, 'ugcpose', () => false);
      if (!r || r.state !== 'success' || !r.imagePath) return res.status(502).json({ success: false, error: (r && r.error) || 'pose failed' });
      let tech = '', desc = '';
      try { const outU = await _dlgPub(r.imagePath, { skipOwnHost: true });
        [tech, desc] = await Promise.all([
          callAIVisionWithFallback([{ role: 'user', content: [{ type: 'text', text: _UGC_POSE_TECH_PROMPT }, { type: 'image_url', image_url: { url: outU } }] }], { timeout: 45000, useOpenRouter: true, openRouterModel: getImgVisionModel() }).then(t => String(t || '').trim()).catch(() => ''),
          callAIVisionWithFallback([{ role: 'user', content: [{ type: 'text', text: _UGC_POSE_DESC_PROMPT }, { type: 'image_url', image_url: { url: outU } }] }], { timeout: 45000, useOpenRouter: true, openRouterModel: getImgVisionModel() }).then(t => String(t || '').trim()).catch(() => ''),
        ]);
      } catch (e) {}
      const base = path.basename(r.imagePath);
      const thumbUrl = '/' + path.relative(ROOT_DIR, path.join(UGC_POSE_DIR, 'thumbs', base)).replace(/\\/g, '/');
      const rec = UGCPOSES.save({ format, key: 'custom', label: 'location pose', desc: desc || placement || 'location pose', custom: true, techParams: tech, location, placement, file: r.imagePath, thumb: thumbUrl, active: true });
      return res.json({ success: true, pose: rec });
    }

    // ── Branch A: recreate a blue mannequin FROM an uploaded photo (existing behaviour) ──
    if (!imagePath) return res.status(400).json({ success: false, error: 'no image' });
    let url; try { url = await _dlgPub(imagePath); } catch (e) { return res.status(400).json({ success: false, error: 'image not found' }); }
    let tech = '', desc = '';
    try { [tech, desc] = await Promise.all([
      callAIVisionWithFallback([{ role: 'user', content: [{ type: 'text', text: _UGC_POSE_TECH_PROMPT }, { type: 'image_url', image_url: { url } }] }], { timeout: 45000, useOpenRouter: true, openRouterModel: getImgVisionModel() }).then(t => String(t || '').trim()).catch(() => ''),
      callAIVisionWithFallback([{ role: 'user', content: [{ type: 'text', text: _UGC_POSE_DESC_PROMPT }, { type: 'image_url', image_url: { url } }] }], { timeout: 45000, useOpenRouter: true, openRouterModel: getImgVisionModel() }).then(t => String(t || '').trim()).catch(() => ''),
    ]); } catch (e) {}
    const seed = Math.floor(Math.random() * 999999999) + 1;
    const sketchPrompt = _UGC_POSE_SKETCH_PROMPT + (desc ? ' The exact body pose and composition to preserve: ' + desc + '.' : '');
    const taskId = await createMultiRefEditTask('nano-banana-2', sketchPrompt, [url], format, seed, {});
    const r = await _dlgPollImage(taskId, UGC_POSE_DIR, 'ugcpose', () => false);
    if (!r || r.state !== 'success' || !r.imagePath) return res.status(502).json({ success: false, error: (r && r.error) || 'sketch failed' });
    const base = path.basename(r.imagePath);
    const thumbUrl = '/' + path.relative(ROOT_DIR, path.join(UGC_POSE_DIR, 'thumbs', base)).replace(/\\/g, '/');
    const rec = UGCPOSES.save({ format, key: 'custom', label: 'custom', desc: desc || 'user pose', custom: true, techParams: tech, file: r.imagePath, thumb: thumbUrl, active: true });
    res.json({ success: true, pose: rec });
  } catch (e) { res.status(502).json({ success: false, error: e.message }); }
});

// ── ugc_ad Video-setup RESULT compose: base photoshoot (+ pose anchor + location) ──
// Replaces the BLUE pose mannequin with the presenter in the mannequin's pose/crop,
// applying the chosen location palette, camera lens and aspect. SSE -> done{image}.

// ── "Both" interview-mix composite (Phase 6) ─────────────────────────────────
// Paint the host + guest looks onto the colour-anchor pose (BLUE=host / RED=guest),
// in the chosen location's palette, on the chosen lens, via the selected i2i engine.
function _dlgLocalFromUrl(u) { if (!u) return null; const rel = String(u).replace(/^\/+/, ''); const a = path.join(ROOT_DIR, rel); if (fs.existsSync(a)) return a; const b = path.join(ROOT_DIR, 'public', rel); return fs.existsSync(b) ? b : a; }
async function _dlgPub(u, opts) { const p = _dlgLocalFromUrl(u); if (!p || !fs.existsSync(p)) throw new Error('missing reference: ' + u); return await uploadToPublicHost(fs.readFileSync(p), opts); }
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


// ── Episode video fragment (Phase 7): Gemini 3.5 -> Seedance 2.0 mini ────────
// Turns ONE voiced line into ONE dynamic interview fragment. The spoken text in the
// prompt is CLEAN (audiotags stripped) and emotions become directorial cues, so the
// model never voices the bracketed tags.
// Built-in template. [[...]] zones are auto-filled at generation time (the prompt editor shows
// them as locked chips). Users may edit the surrounding text / add rules, not the [[...]] tokens.

// Client -> server log bridge: the frontend brackets batch operations (Voice/Video/Motion all)
// so the per-request neural logs are grouped under a readable [batch] marker in the server log.
router.post('/log', (req, res) => { try { const m = String((req.body || {}).msg || '').slice(0, 300); if (m) console.log('[batch] ' + m); } catch (e) {} res.json({ ok: true }); });

// "Improve speech" OFF -> keep the ORIGINAL voice: Seedance still lip-syncs (generate_audio
// true), then we replace its audio track with the original recording via ffmpeg. Returns
// true if the mux succeeded (the video file is replaced in place).


// Tag handling depends on "Improve speech": OFF -> @Audio1 is a FIXED, pre-recorded
// track, so the video must ONLY lip-sync it and IGNORE every audiotag (no tag-driven
// laughing/crying that would front-run and desync the fixed voice); ON -> perform the
// tags as directorial cues in sync with the (re-voiced) audio.

// ── POST /ugc/motion-prompt ───────────────────────────────────────────────────
// Generate ONE plain-text Seedance motion/animation prompt for a single fragment,
// with the FULL scenario as context. Used by "Motion all" + the per-card motion popup.
// Stored per-fragment (animPrompt) and fed verbatim to the video route. If no montage
// direction is applied, returns the SIMPLEST talking-head shot (static camera). One route,
// both modes (mode: 'ugc' | 'dialogue').
// Read-only: the motion-prompt system template, for the Montage-settings gear preview.


// Extract the audio track from a generated video fragment -> mp3 (same length as the video).
// Used by the dialogues -> Merge handoff so the Merge clip runs the FULL video length (no
// audio-duration truncation, which is intentionally kept for ugc_ad) and subtitles are built
// from the real video audio. Idempotent.

module.exports = router;
