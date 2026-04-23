'use strict';

const express = require('express');
const path    = require('path');
const fs      = require('fs');
const axios   = require('axios');
const router  = express.Router();

const { UPLOADS_DIR, CHARACTERS_DIR, KIE_BASE } = require('../lib/config');
const {
  kieHeaders,
  callAI, callAIBase64,
  analyzeWithGemini, analyzeRealismMarkers, translateToEnglish, buildPrompt,
  uploadToPublicHost, downloadImage, compressBelow9MB, createThumbnail,
  createNanoBananaProTask, createQwen2Task, createGptImage2Task, createSeedream5LiteTask, resolveTask,
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
    res.set('Content-Type', response.headers['content-type'] || 'image/jpeg');
    res.set('Cache-Control', 'no-store');
    res.send(response.data);
  } catch (err) {
    res.status(502).json({ success: false, error: err.message });
  }
});

// ── Generate character ────────────────────────────────────────────────────────
router.post('/generate', async (req, res) => {
  const {
    age, gender, faceBase64, imagePath: localImagePath, extraInstruction,
    poseKey, emotion, imageEngine, withRealism,
    customPosePrompt, customEmotionPrompt,
  } = req.body;
  const engine = (imageEngine === 'qwen2') ? 'qwen2' : (imageEngine === 'seedream') ? 'seedream' : (imageEngine === 'gptimage2') ? 'gptimage2' : 'nano-banana-2';
  // Generate a reproducible seed for this request
  const seed = Math.floor(Math.random() * 999_999_999) + 1;

  if (!age || !gender)
    return res.status(400).json({ success: false, error: 'Укажите возраст и пол' });
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

    // Resolve emotion modifier: custom string → use directly; built-in key → look up
    let emotionModifier = '';
    if (customEmotionPrompt) {
      emotionModifier = customEmotionPrompt;
    } else if (emotion && emotion !== 'neutral') {
      emotionModifier = getPrompt(`emotion_${emotion}`);
    }

    const { enabledMarkers = [] } = req.body;

    let skinTraits = [];
    let translatedInstruction = extraInstruction || '';

    if (extraInstruction) {
      translatedInstruction = await translateToEnglish(extraInstruction);
    } else {
      skinTraits = await analyzeWithGemini(imageBase64ForGemini);
    }

    // Always apply settings markers; if withRealism, AI picks the contextually relevant subset
    const cleanEnabled = enabledMarkers.map(s => s.trim()).filter(Boolean);
    let realismMarkers = '';
    if (withRealism && cleanEnabled.length) {
      // AI selects only contextually fitting markers from the enabled pool
      try {
        realismMarkers = await analyzeRealismMarkers(imageBase64ForGemini, cleanEnabled);
        console.log('[generate] realism markers (AI-filtered):', realismMarkers);
      } catch (e) {
        console.warn('[generate] realism analysis failed:', e.message);
        realismMarkers = cleanEnabled.join(', ');
      }
    } else {
      // No AI — use all enabled markers as-is
      realismMarkers = cleanEnabled.join(', ');
    }
    if (realismMarkers) console.log('[generate] realism markers (final):', realismMarkers);

    // Resolve scene template: custom pose prompt → use directly; built-in key → look up
    let sceneTemplate = null;
    if (!extraInstruction) {
      if (customPosePrompt) {
        sceneTemplate = customPosePrompt;
      } else if (poseKey) {
        sceneTemplate = getPrompt(poseKey);
      }
    }
    const prompt = buildPrompt(age, gender, skinTraits, translatedInstruction, sceneTemplate, emotionModifier, realismMarkers);
    const imageUrl = await uploadToPublicHost(imageBuffer);

    console.log('[generate] engine:', engine, '| seed:', seed);

    let taskId;
    if (engine === 'qwen2') {
      taskId = await createQwen2Task(prompt, imageUrl, '9:16', seed);
    } else if (engine === 'seedream') {
      taskId = await createSeedream5LiteTask(prompt, [imageUrl], '9:16', 'basic');
    } else if (engine === 'gptimage2') {
      taskId = await createGptImage2Task(prompt, [imageUrl], '9:16');
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
router.get('/status/:taskId', async (req, res) => {
  const { taskId } = req.params;
  try {
    const statusRes = await axios.get(
      `${KIE_BASE}/api/v1/jobs/recordInfo`,
      { params: { taskId }, headers: kieHeaders(), timeout: 15000 }
    );
    const data  = statusRes.data?.data;
    const state = data?.state;

    if (state === 'success') {
      let remoteUrl = null;
      try {
        const parsed = JSON.parse(data.resultJson);
        console.log('[status] resultJson for', taskId, ':', JSON.stringify(parsed).slice(0, 300));
        // Try various field names used by different kie.ai models
        remoteUrl = parsed.resultUrls?.[0]
          || parsed.images?.[0]
          || parsed.image_url
          || parsed.url
          || parsed.output?.[0]
          || parsed.output
          || null;
        // If it's still an array, unwrap
        if (Array.isArray(remoteUrl)) remoteUrl = remoteUrl[0];
      } catch (e) {
        console.warn('[status] resultJson parse error:', e.message, '| raw:', data.resultJson);
      }
      if (!remoteUrl) return res.json({ success: true, state: 'failed', error: 'No result URL in: ' + data.resultJson });
      const filename = `generated_${taskId}_${Date.now()}.jpg`;
      const destPath = path.join(UPLOADS_DIR, filename);
      await downloadImage(remoteUrl, destPath);
      await compressBelow9MB(destPath);
      const thumbPath = path.join(UPLOADS_DIR, 'thumbs', filename);
      createThumbnail(destPath, thumbPath).catch(e => console.warn('[thumb]', e.message));
      removePendingTask(taskId);
      return res.json({ success: true, state: 'success', imagePath: `/uploads/${filename}`, thumbPath: `/uploads/thumbs/${filename}` });
    }
    if (state === 'failed') {
      removePendingTask(taskId);
      return res.json({ success: true, state: 'failed', error: data?.failMsg || 'Generation failed' });
    }

    return res.json({ success: true, state: state || 'pending' });
  } catch (err) {
    console.error('[status]', err.response?.data || err.message);
    res.status(502).json({ success: false, error: err.message });
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
      imageBase64
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
  const engine = (imageEngine === 'qwen2') ? 'qwen2' : (imageEngine === 'seedream') ? 'seedream' : (imageEngine === 'gptimage2') ? 'gptimage2' : 'nano-banana-2';
  const numVariations = Math.min(Math.max(parseInt(count) || 4, 1), 4);
  if (!imagePath) return res.status(400).json({ success: false, error: 'Нет imagePath' });

  const absPath = path.join(__dirname, '..', imagePath.replace(/^\//, ''));
  if (!fs.existsSync(absPath))
    return res.status(400).json({ success: false, error: 'Файл не найден: ' + imagePath });

  try {
    const imageUrl    = await uploadToPublicHost(fs.readFileSync(absPath));
    const systemPrompt = getPrompt('POSE_VARIATION_PROMPT');

    const rawText = await callAI([{
      role: 'user',
      content: [
        { type: 'text',      text: systemPrompt },
        { type: 'image_url', image_url: { url: imageUrl } },
      ],
    }], { timeout: 45000 });
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

// ── GET /api/characters/pose-status/:taskId ───────────────────────────────────
// Poll a pose variation task; saves result to CHARACTERS_DIR.
router.get('/characters/pose-status/:taskId', async (req, res) => {
  try {
    const result = await resolveTask(req.params.taskId, CHARACTERS_DIR, 'posevar');
    if (result.state === 'success' || result.state === 'failed') removePendingTask(req.params.taskId);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(502).json({ success: false, error: err.message });
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

  const engine  = (imageEngine === 'qwen2') ? 'qwen2' : (imageEngine === 'seedream') ? 'seedream' : (imageEngine === 'gptimage2') ? 'gptimage2' : 'nano-banana-2';
  const absPath = path.join(__dirname, '..', imagePath.replace(/^\//, ''));
  if (!fs.existsSync(absPath))
    return res.status(400).json({ success: false, error: 'Файл не найден: ' + imagePath });

  try {
    const imageBuffer = fs.readFileSync(absPath);
    const imageUrl    = await uploadToPublicHost(imageBuffer);

    // Step 1: AI analyzes the character (Gemini → GPT-5.2 fallback)
    let charDesc;
    try {
      charDesc = await callAI([{
        role: 'user',
        content: [
          { type: 'text',      text: getPrompt('EDIT_POSE_ANALYZE_PROMPT') },
          { type: 'image_url', image_url: { url: imageUrl } },
        ],
      }], { timeout: 45000 });
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
