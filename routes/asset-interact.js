'use strict';

const express = require('express');
const path    = require('path');
const fs      = require('fs');
const axios   = require('axios');
const router  = express.Router();

const {
  UPLOADS_DIR, CHARACTERS_DIR, LOOKBOOKS_DIR, ENVIRONMENTS_DIR,
  DETAILS_DIR, SCENES_DIR, TEMP_DIR, OBRAZY_DIR,
} = require('../lib/config');
const { callAI, callAIVision, callAIVisionWithFallback, uploadToPublicHost, createNanoBananaProTaskMulti, createQwen2Task, createGptImage2Task, createSeedream5LiteTask, resolveTask } = require('../lib/helpers');
const { getPrompt } = require('../lib/prompts');
const { addPendingTask, removePendingTask } = require('../lib/pending-tasks');

const SETTINGS_FILE = path.join(__dirname, '..', 'data', 'settings.json');
function readNegativePrompt() {
  try {
    const raw = fs.readFileSync(SETTINGS_FILE, 'utf8');
    const data = JSON.parse(raw);
    const val = (data.editNegativePrompt || '').trim();
    console.log('[readNegativePrompt] path:', SETTINGS_FILE, '| value:', JSON.stringify(val));
    return val;
  } catch (e) {
    console.error('[readNegativePrompt] ERROR reading settings:', e.message, '| path:', SETTINGS_FILE);
    return '';
  }
}

// Resolve spintax {opt1|opt2|opt3} → random choice
function resolveSpintax(text) {
  return text.replace(/\{([^}]+)\}/g, (_, opts) => {
    const parts = opts.split('|');
    return parts[Math.floor(Math.random() * parts.length)].trim();
  });
}

// ── Resolve a public URL path (e.g. /characters/foo.jpg) to a filesystem path ─
// Must include /obrazy/ since character base images + their pose-variations
// now live in per-obraz folders (obrazy/<slug>_<idShort>/...). Missing this
// mapping was the cause of the "empty prompt" errors in mix generation —
// urlToFilePath returned null for /obrazy/... paths, so the pre-analyze
// endpoint bailed before producing combinedPrompt.
function urlToFilePath(urlPath) {
  if (!urlPath) return null;
  const stripped = urlPath.split('?')[0]; // remove ?t=...
  const { REFS_DIR } = require('../lib/config');
  const map = [
    ['/characters/',   CHARACTERS_DIR],
    ['/lookbooks/',    LOOKBOOKS_DIR],
    ['/environments/', ENVIRONMENTS_DIR],
    ['/details/',      DETAILS_DIR],
    ['/refs/',         REFS_DIR],
    ['/scenes/',       SCENES_DIR],
    ['/temp_files/',   TEMP_DIR],
    ['/uploads/',      UPLOADS_DIR],
    ['/obrazy/',       OBRAZY_DIR],
  ];
  for (const [prefix, dir] of map) {
    if (stripped.startsWith(prefix)) {
      return path.join(dir, stripped.slice(prefix.length));
    }
  }
  return null;
}

// ── POST /api/asset-interact/analyze ─────────────────────────────────────────
// Sends active image + asset image to Gemini 3.1 Pro with user context.
// Returns 5 interaction variants: [{label, prompt}]
router.post('/asset-interact/analyze', async (req, res) => {
  const { activePath, assetPath, nameVal, exhon, activnoe, assetSize } = req.body;

  if (!activePath || !assetPath) {
    return res.status(400).json({ success: false, error: 'Нет путей к изображениям' });
  }

  const activeFile = urlToFilePath(activePath);
  const assetFile  = urlToFilePath(assetPath);

  if (!activeFile || !fs.existsSync(activeFile)) {
    return res.status(400).json({ success: false, error: 'Активное изображение не найдено на диске' });
  }
  if (!assetFile || !fs.existsSync(assetFile)) {
    return res.status(400).json({ success: false, error: 'Изображение ассета не найдено на диске' });
  }

  try {
    // Upload both images to public host in parallel
    const [activeUrl, assetUrl] = await Promise.all([
      uploadToPublicHost(fs.readFileSync(activeFile)),
      uploadToPublicHost(fs.readFileSync(assetFile)),
    ]);

    // Build prompt from template, substitute user variables
    const sizeClause = (assetSize || '').trim() ? ` (real dimensions: ${assetSize.trim()})` : '';
    let systemPrompt = getPrompt('ASSET_INTERACT_ANALYZE_PROMPT');
    systemPrompt = systemPrompt
      .replace(/\{name\}/g,            nameVal  || '')
      .replace(/\{exhon\}/g,           exhon    || '')
      .replace(/\{activnoe\}/g,        activnoe || '')
      .replace(/\{assetSizeClause\}/g, sizeClause);

    const rawText = await callAIVisionWithFallback([{
      role: 'user',
      content: [
        { type: 'text',      text: systemPrompt },
        { type: 'image_url', image_url: { url: activeUrl } },
        { type: 'image_url', image_url: { url: assetUrl  } },
      ],
    }], { timeout: 45000, useOpenRouter: true });
    console.log('[asset-interact/analyze] AI raw:', rawText.slice(0, 300));

    const match = rawText.match(/\[[\s\S]*\]/);
    let variants = [];
    if (match) {
      try { variants = JSON.parse(match[0]); } catch (e) { console.warn('[asset-interact] JSON parse failed:', e.message); }
    }

    // Ensure at least minimal structure
    variants = variants.filter(v => v && v.label && v.prompt);
    if (!variants.length) throw new Error('Gemini не вернул варианты взаимодействия');

    res.json({ success: true, variants: variants.slice(0, 5) });
  } catch (err) {
    console.error('[asset-interact/analyze]', err.response?.data || err.message);
    res.status(502).json({ success: false, error: err.response?.data?.msg || err.message });
  }
});

// ── POST /api/asset-interact/pre-analyze ─────────────────────────────────────
// Sends active + asset images to Gemini; returns ONE optimised generation prompt.
router.post('/asset-interact/pre-analyze', async (req, res) => {
  const { activePath, assetPath, presetPrompt, assetSize } = req.body;

  if (!activePath || !assetPath) {
    return res.status(400).json({ success: false, error: 'Нет путей к изображениям' });
  }

  const activeFile = urlToFilePath(activePath);
  const assetFile  = urlToFilePath(assetPath);

  if (!activeFile || !fs.existsSync(activeFile))
    return res.status(400).json({ success: false, error: 'Активное изображение не найдено на диске' });
  if (!assetFile || !fs.existsSync(assetFile))
    return res.status(400).json({ success: false, error: 'Изображение ассета не найдено на диске' });

  try {
    const [activeUrl, assetUrl] = await Promise.all([
      uploadToPublicHost(fs.readFileSync(activeFile)),
      uploadToPublicHost(fs.readFileSync(assetFile)),
    ]);

    const sizeClause2 = (assetSize || '').trim() ? ` — real dimensions: ${assetSize.trim()} (render at this exact scale; include dimensions in your output prompt as a size anchor)` : '';
    const systemPrompt = getPrompt('ASSET_PRE_GENERATE_PROMPT')
      .replace(/\{presetPrompt\}/g,    presetPrompt || '')
      .replace(/\{assetSizeClause\}/g, sizeClause2);

    const combinedPrompt = await callAIVisionWithFallback([{
      role: 'user',
      content: [
        { type: 'text',      text: systemPrompt },
        { type: 'image_url', image_url: { url: activeUrl } },
        { type: 'image_url', image_url: { url: assetUrl  } },
      ],
    }], { timeout: 45000, useOpenRouter: true });
    console.log('[asset-interact/pre-analyze] combined prompt:', combinedPrompt.slice(0, 200));

    console.log('[asset-interact/pre-analyze] combined prompt:', combinedPrompt.slice(0, 200));
    res.json({ success: true, combinedPrompt });
  } catch (err) {
    console.error('[asset-interact/pre-analyze]', err.response?.data || err.message);
    res.status(502).json({ success: false, error: err.response?.data?.msg || err.message });
  }
});

// ── POST /api/asset-interact/apply-analyze ───────────────────────────────────
// Character-tab "Apply to image" slots. Same two-image vision analysis as
// pre-analyze, but the system prompt (agent role) is chosen by asset TYPE
// (lookbook|environment|prop) and whether the user typed extra notes — 6 prompts.
// IMAGE 1 = active character, IMAGE 2 = the chosen asset. Returns one generation
// prompt. (Kept separate from pre-analyze so the legacy asset flow is untouched.)
const _APPLY_TAIL = '\nPreserve the character\'s facial identity, age and skin exactly. Photorealistic, consistent lighting, no text or watermarks. Respond with ONLY the image-generation prompt — no preamble, no quotes, no explanation.';
const _APPLY_PROMPTS = {
  lookbook_empty:
    'You are a fashion stylist directing a photoreal image edit. IMAGE 1 is the character; IMAGE 2 is an outfit / lookbook. Write ONE detailed English image-generation prompt that dresses the character from IMAGE 1 in the exact outfit from IMAGE 2 — same garments, colours, fabrics, fit and styling — while keeping the character\'s face, body, hair and pose unchanged. Natural drape and fit.' + _APPLY_TAIL,
  lookbook_text:
    'You are a fashion stylist directing a photoreal image edit. IMAGE 1 is the character; IMAGE 2 is an outfit / lookbook. Dress the character from IMAGE 1 in the outfit from IMAGE 2, keeping their face, body, hair and pose unchanged. The user\'s styling notes (HIGHEST PRIORITY): "{userText}" — apply these (how it is worn, fit, accessories) on top of the IMAGE 2 outfit. Write ONE detailed English image-generation prompt.' + _APPLY_TAIL,
  environment_empty:
    'You are a scene compositor. IMAGE 1 is the character; IMAGE 2 is an environment / background. Write ONE detailed English image-generation prompt that places the character from IMAGE 1 naturally into the environment of IMAGE 2 — matching perspective, scale, lighting direction, colour temperature and shadows so the character truly belongs in that scene. Keep the character\'s face, outfit and pose.' + _APPLY_TAIL,
  environment_text:
    'You are a scene compositor. IMAGE 1 is the character; IMAGE 2 is an environment / background. Place the character from IMAGE 1 into the scene of IMAGE 2, matching perspective, scale and lighting. The user\'s scene notes (HIGHEST PRIORITY): "{userText}" — honour these (placement, time of day, framing, mood). Keep the character\'s face, outfit and pose. Write ONE detailed English image-generation prompt.' + _APPLY_TAIL,
  prop_empty:
    'You are a product-placement director. IMAGE 1 is the character; IMAGE 2 is a product / prop. Write ONE detailed English image-generation prompt where the character from IMAGE 1 naturally holds, uses or presents the product from IMAGE 2 — anatomically correct grip, correct scale and perspective, product fully visible and undistorted. Keep the character\'s face and overall look.' + _APPLY_TAIL,
  prop_text:
    'You are a product-placement director. IMAGE 1 is the character; IMAGE 2 is a product / prop. The character should interact with the product naturally. The user\'s interaction notes (HIGHEST PRIORITY): "{userText}" — build the pose/interaction around these. Keep correct grip, scale and full product visibility, and the character\'s face and look. Write ONE detailed English image-generation prompt.' + _APPLY_TAIL,
};

router.post('/asset-interact/apply-analyze', async (req, res) => {
  const { activePath, assetPath, assetType, userText } = req.body || {};
  if (!activePath || !assetPath) return res.status(400).json({ success: false, error: 'Нет путей к изображениям' });
  const type = ['lookbook', 'environment', 'prop'].includes(assetType) ? assetType : 'prop';
  const activeFile = urlToFilePath(activePath);
  const assetFile  = urlToFilePath(assetPath);
  if (!activeFile || !fs.existsSync(activeFile)) return res.status(400).json({ success: false, error: 'Активное изображение не найдено' });
  if (!assetFile  || !fs.existsSync(assetFile))  return res.status(400).json({ success: false, error: 'Изображение ассета не найдено' });
  try {
    const [activeUrl, assetUrl] = await Promise.all([
      uploadToPublicHost(fs.readFileSync(activeFile)),
      uploadToPublicHost(fs.readFileSync(assetFile)),
    ]);
    const txt = (userText || '').trim();
    let sys = _APPLY_PROMPTS[type + (txt ? '_text' : '_empty')];
    if (txt) sys = sys.replace(/\{userText\}/g, txt);
    const combinedPrompt = await callAIVisionWithFallback([{
      role: 'user',
      content: [
        { type: 'text',      text: sys },
        { type: 'image_url', image_url: { url: activeUrl } },
        { type: 'image_url', image_url: { url: assetUrl  } },
      ],
    }], { timeout: 45000, useOpenRouter: true });
    console.log(`[asset-interact/apply-analyze] type=${type} text=${txt ? 'yes' : 'no'} →`, String(combinedPrompt).slice(0, 160));
    res.json({ success: true, combinedPrompt });
  } catch (err) {
    console.error('[asset-interact/apply-analyze]', err.response?.data || err.message);
    res.status(502).json({ success: false, error: err.response?.data?.msg || err.message });
  }
});

// ── POST /api/asset-interact/generate ────────────────────────────────────────
// Sends active image + asset image + selected prompt to nano-banana-2 (2 refs)
router.post('/asset-interact/generate', async (req, res) => {
  const { activePath, assetPath, prompt, assetType, imageEngine, engineParams = {}, charRefPaths } = req.body;
  const engine = (imageEngine === 'qwen2') ? 'qwen2'
               : (imageEngine === 'seedream') ? 'seedream'
               : (imageEngine === 'gptimage2') ? 'gptimage2'
               : 'nano-banana-2';
  const seed = Math.floor(Math.random() * 999_999_999) + 1;

  if (!activePath) {
    return res.status(400).json({ success: false, error: 'Нет изображений' });
  }

  // Resolve prompt: use provided value or fall back to default for asset type
  let resolvedPrompt = (prompt || '').trim();
  if (!resolvedPrompt) {
    if (assetType === 'lookbook') {
      resolvedPrompt = resolveSpintax(getPrompt('LOOKBOOK_DEFAULT_GENERATE_PROMPT'));
    } else if (assetType === 'environment') {
      resolvedPrompt = resolveSpintax(getPrompt('ENVIRONMENT_DEFAULT_GENERATE_PROMPT'));
    } else if (assetType === 'detail') {
      resolvedPrompt = resolveSpintax(getPrompt('DETAIL_DEFAULT_GENERATE_PROMPT'));
    } else {
      return res.status(400).json({ success: false, error: 'Выберите вариант в столбце ПРЕСЕТ или укажите тип ассета.' });
    }
  } else {
    resolvedPrompt = resolveSpintax(resolvedPrompt);
  }

  const activeFile = urlToFilePath(activePath);
  const assetFile  = assetPath ? urlToFilePath(assetPath) : null;

  if (!activeFile || !fs.existsSync(activeFile))
    return res.status(400).json({ success: false, error: 'Активное изображение не найдено' });
  if (assetPath && (!assetFile || !fs.existsSync(assetFile)))
    return res.status(400).json({ success: false, error: 'Изображение ассета не найдено' });

  // Persistent-character reference sheets (portrait + T-pose). When a saved
  // actor is selected, lookbook / environment generation sends these neutral
  // sheets as extra IDENTITY anchors alongside the active image so the face &
  // body stay locked to the canonical character.
  const refFiles = Array.isArray(charRefPaths)
    ? charRefPaths.map(urlToFilePath).filter(f => f && fs.existsSync(f))
    : [];

  try {
    const [activeUrl, assetUrl, ...refUrls] = await Promise.all([
      uploadToPublicHost(fs.readFileSync(activeFile)),
      assetFile ? uploadToPublicHost(fs.readFileSync(assetFile)) : Promise.resolve(null),
      ...refFiles.map(f => uploadToPublicHost(fs.readFileSync(f))),
    ]);
    // Order: active (current look) → identity refs → asset (last).
    const imageUrls = [activeUrl, ...refUrls.filter(Boolean), ...(assetUrl ? [assetUrl] : [])];

    const aspectRatio = '9:16';
    let taskId;
    if (engine === 'qwen2') {
      // qwen2 takes a single ref → keep the active image only.
      taskId = await createQwen2Task(resolvedPrompt, activeUrl, aspectRatio, seed, engineParams);
    } else if (engine === 'seedream') {
      taskId = await createSeedream5LiteTask(resolvedPrompt, imageUrls, aspectRatio, 'basic', engineParams);
    } else if (engine === 'gptimage2') {
      taskId = await createGptImage2Task(resolvedPrompt, imageUrls, aspectRatio, engineParams);
    } else {
      taskId = await createNanoBananaProTaskMulti(resolvedPrompt, imageUrls, aspectRatio, seed, engineParams);
    }
    console.log('[asset-interact/generate] engine:', engine, '| taskId:', taskId, '| seed:', seed);
    addPendingTask(taskId, 'uploads', 'interact', 'asset-interact');

    res.json({ success: true, taskId, seed });
  } catch (err) {
    console.error('[asset-interact/generate]', err.response?.data || err.message);
    res.status(502).json({ success: false, error: err.response?.data?.msg || err.message });
  }
});

// ── POST /api/asset-interact/generate-with-analysis ──────────────────────────
// Step 1: GPT-4o (→ Claude → Gemini) analyzes both images + interaction label → writes detailed English prompt
// Step 2: Submits generation with that prompt + both images using the selected engine
router.post('/asset-interact/generate-with-analysis', async (req, res) => {
  const { activePath, assetPath, interactionLabel, assetSize, imageEngine, engineParams = {} } = req.body;
  const negativePrompt = readNegativePrompt();
  const engine = (imageEngine === 'qwen2') ? 'qwen2'
               : (imageEngine === 'seedream') ? 'seedream'
               : (imageEngine === 'gptimage2') ? 'gptimage2'
               : 'nano-banana-2';
  const seed = Math.floor(Math.random() * 999_999_999) + 1;

  if (!activePath || !assetPath)
    return res.status(400).json({ success: false, error: 'Нет изображений' });

  const activeFile = urlToFilePath(activePath);
  const assetFile  = urlToFilePath(assetPath);

  if (!activeFile || !fs.existsSync(activeFile))
    return res.status(400).json({ success: false, error: 'Активное изображение не найдено' });
  if (!assetFile || !fs.existsSync(assetFile))
    return res.status(400).json({ success: false, error: 'Изображение ассета не найдено' });

  try {
    const [activeUrl, assetUrl] = await Promise.all([
      uploadToPublicHost(fs.readFileSync(activeFile)),
      uploadToPublicHost(fs.readFileSync(assetFile)),
    ]);

    // Step 1: AI analysis → detailed generation prompt
    const sizeClause  = (assetSize || '').trim() ? ` — real dimensions: ${assetSize.trim()} (render at this exact scale; include dimensions in your output prompt as a size anchor)` : '';
    const negPlaceholder = negativePrompt
      ? `\n\nNEGATIVE PROMPT (these must NOT appear in the output image): ${negativePrompt}`
      : '';
    const analysisText = getPrompt('SCENE_INTERACTION_PROMPT')
      .replace(/\{interactionLabel\}/g, interactionLabel || 'holds the item naturally')
      .replace(/\{activeFileName\}/g,   path.basename(activeFile))
      .replace(/\{assetFileName\}/g,    path.basename(assetFile))
      .replace(/\{assetSizeClause\}/g,  sizeClause)
      .replace(/\{negativePrompt\}/g,   negPlaceholder);

    console.log('[generate-with-analysis] negativePrompt:', JSON.stringify(negativePrompt));
    console.log('[generate-with-analysis] analysisText (last 200):', analysisText.slice(-200));

    let generationPrompt;
    try {
      generationPrompt = await callAIVisionWithFallback([{
        role: 'user',
        content: [
          { type: 'text',      text: analysisText },
          { type: 'image_url', image_url: { url: activeUrl } },
          { type: 'image_url', image_url: { url: assetUrl  } },
        ],
      }], { timeout: 45000, useOpenRouter: true });
      // Always append negative prompt at the end of generation prompt
      if (negativePrompt) generationPrompt += `\n\nnegative_prompt: ${negativePrompt}`;
      console.log('[generate-with-analysis] generationPrompt (last 200):', generationPrompt.slice(-200));
    } catch (aiErr) {
      console.warn('[generate-with-analysis] AI analysis failed, using default:', aiErr.message);
      generationPrompt = resolveSpintax(getPrompt('DETAIL_DEFAULT_GENERATE_PROMPT'));
      if (negativePrompt) generationPrompt += `\n\nnegative_prompt: ${negativePrompt}`;
    }

    // Step 2: Submit generation task (qwen2 doesn't support multiple images → fall back to nano-banana)
    console.log('[generate-with-analysis] engine:', engine, '| engineParams:', JSON.stringify(engineParams));
    let taskId;
    if (engine === 'seedream') {
      taskId = await createSeedream5LiteTask(generationPrompt, [activeUrl, assetUrl], '9:16', 'basic', engineParams);
    } else if (engine === 'gptimage2') {
      taskId = await createGptImage2Task(generationPrompt, [activeUrl, assetUrl], '9:16', engineParams);
    } else {
      // qwen2 doesn't support multiple ref images → use nano-banana with default params (not qwen2 engineParams)
      const nbParams = (engine === 'qwen2') ? {} : engineParams;
      taskId = await createNanoBananaProTaskMulti(generationPrompt, [activeUrl, assetUrl], '9:16', seed, nbParams);
    }
    console.log('[generate-with-analysis] engine:', engine, '| taskId:', taskId);
    addPendingTask(taskId, 'uploads', 'interact', 'asset-interact');
    res.json({ success: true, taskId, seed });
  } catch (err) {
    console.error('[asset-interact/generate-with-analysis]', err.response?.data || err.message);
    res.status(502).json({ success: false, error: err.response?.data?.msg || err.message });
  }
});

// ── GET /api/asset-interact/status/:taskId ────────────────────────────────────
router.get('/asset-interact/status/:taskId', async (req, res) => {
  try {
    const result = await resolveTask(req.params.taskId, UPLOADS_DIR, 'interact');
    if (result.state === 'success' || result.state === 'failed') removePendingTask(req.params.taskId);
    res.json({ success: true, ...result });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

module.exports = router;
