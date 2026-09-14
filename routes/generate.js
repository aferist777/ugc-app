'use strict';

const express = require('express');
const path    = require('path');
const fs      = require('fs');
const axios   = require('axios');
const router  = express.Router();

const { UPLOADS_DIR, CHARACTERS_DIR, KIE_BASE, CHAR_OPTIMIZE_MODEL, ROOT_DIR, OBRAZY_DIR, MODELS_DIR } = require('../lib/config');
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
      const absPath = path.join(ROOT_DIR, localImagePath.replace(/^\//, ''));
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
  // A watched task has already been asked about, by the watcher, on its own schedule. Reading
  // its answer instead of making a second identical call halves the traffic for an open page
  // and - more to the point - means the page is no longer what drives the task to a result.
  // Unwatched tasks (every other page) fall straight through to the poll below.
  try {
    const seen = require('../lib/cv2-watch').peek(taskId);
    if (seen) return res.json({ success: true, ...seen });
  } catch (e) { /* fall through and poll */ }

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

// Pose Studio: text -> cheap object image -> TRELLIS image-to-3D -> GLB saved under
// models/ in the library (served at /models/), returned for loading into the 3D scene.
// Synchronous (cheap t2i ~10s + TRELLIS ~25s); the client shows a spinner.
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
    const dest = path.join(MODELS_DIR, name);
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


// ── Character creator: AI-optimize the JSON spec into an engine-ideal prompt ───
// Hermes 4 405B rewrites the structured spec into one vivid portrait prompt
// (clean realism, no device). The client caches the result by spec.
const _CHAR_OPTIMIZE_TPL =
  'You are a prompt engineer for a photorealistic PORTRAIT image model. Rewrite the character spec below into ONE vivid natural-language prompt (2-4 sentences) for a text-to-image diffusion model.\n' +
  'Describe the person head-and-shoulders, looking at the camera. Keep clean photoreal portrait realism: detailed skin texture with visible pores, soft studio lighting, sharp focus, high detail. Background: a plain neutral mid-grey studio backdrop contrasting with the subject.\n' +
  'Preserve every concrete detail from the spec (age, gender, ethnicity, skin, hair, eyes, face shape, brows, facial hair, marks, makeup, expression). Do NOT invent clothing, accessories, props, scene or any background beyond the studio backdrop. Never include a phone, camera, device, hands holding anything, text or watermark.\n' +
  'Output ONLY the final prompt text — no preamble, no quotes, no markdown, no labels.\n\n' +
  'CHARACTER SPEC (JSON):\n{SPEC}';

// ── POST /api/characters/pose-variations ──────────────────────────────────────
// Analyzes pose via Gemini, submits 4 nano-banana-2 variation tasks.
// Returns { taskIds: [...], poseDesc, labels }
router.post('/characters/pose-variations', async (req, res) => {
  const { imagePath, imageEngine, count } = req.body;
  const engine = (imageEngine === 'qwen2') ? 'qwen2' : (imageEngine === 'seedream') ? 'seedream' : (imageEngine === 'seedream4.5') ? 'seedream4.5' : (imageEngine === 'gptimage2') ? 'gptimage2' : 'nano-banana-2';
  const numVariations = Math.min(Math.max(parseInt(count) || 4, 1), 4);
  if (!imagePath) return res.status(400).json({ success: false, error: 'Нет imagePath' });

  const absPath = path.join(ROOT_DIR, imagePath.replace(/^\//, ''));
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
  const absPath = path.join(ROOT_DIR, imagePath.replace(/^\//, ''));
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

module.exports = router;
