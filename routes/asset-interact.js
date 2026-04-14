'use strict';

const express = require('express');
const path    = require('path');
const fs      = require('fs');
const axios   = require('axios');
const router  = express.Router();

const {
  KIE_BASE,
  UPLOADS_DIR, CHARACTERS_DIR, LOOKBOOKS_DIR, ENVIRONMENTS_DIR,
  DETAILS_DIR, SCENES_DIR, TEMP_DIR,
} = require('../lib/config');
const { kieHeaders, uploadToPublicHost, createNanoBananaProTaskMulti, createQwen2Task, createSeedream5LiteTask, resolveTask } = require('../lib/helpers');
const { getPrompt } = require('../lib/prompts');
const { addPendingTask, removePendingTask } = require('../lib/pending-tasks');

// Resolve spintax {opt1|opt2|opt3} → random choice
function resolveSpintax(text) {
  return text.replace(/\{([^}]+)\}/g, (_, opts) => {
    const parts = opts.split('|');
    return parts[Math.floor(Math.random() * parts.length)].trim();
  });
}

// ── Resolve a public URL path (e.g. /characters/foo.jpg) to a filesystem path ─
function urlToFilePath(urlPath) {
  if (!urlPath) return null;
  const stripped = urlPath.split('?')[0]; // remove ?t=...
  const map = [
    ['/characters/',   CHARACTERS_DIR],
    ['/lookbooks/',    LOOKBOOKS_DIR],
    ['/environments/', ENVIRONMENTS_DIR],
    ['/details/',      DETAILS_DIR],
    ['/scenes/',       SCENES_DIR],
    ['/temp_files/',   TEMP_DIR],
    ['/uploads/',      UPLOADS_DIR],
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
  const { activePath, assetPath, nameVal, exhon, activnoe } = req.body;

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
    let systemPrompt = getPrompt('ASSET_INTERACT_ANALYZE_PROMPT');
    systemPrompt = systemPrompt
      .replace(/\{name\}/g,     nameVal  || '')
      .replace(/\{exhon\}/g,    exhon    || '')
      .replace(/\{activnoe\}/g, activnoe || '');

    const gemRes = await axios.post(
      `${KIE_BASE}/gemini-3.1-pro/v1/chat/completions`,
      {
        stream: false,
        messages: [{
          role: 'user',
          content: [
            { type: 'text',      text: systemPrompt },
            { type: 'image_url', image_url: { url: activeUrl },
              // Provide description hint inside the text block instead — some providers ignore extra keys
            },
            { type: 'image_url', image_url: { url: assetUrl } },
          ],
        }],
      },
      { headers: kieHeaders(), timeout: 45000 }
    );

    const rawText = gemRes.data?.choices?.[0]?.message?.content || '[]';
    console.log('[asset-interact/analyze] Gemini raw:', rawText.slice(0, 300));

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
  const { activePath, assetPath, presetPrompt } = req.body;

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

    const systemPrompt = getPrompt('ASSET_PRE_GENERATE_PROMPT')
      .replace(/\{presetPrompt\}/g, presetPrompt || '');

    const gemRes = await axios.post(
      `${KIE_BASE}/gemini-3.1-pro/v1/chat/completions`,
      {
        stream: false,
        messages: [{
          role: 'user',
          content: [
            { type: 'text',      text: systemPrompt },
            { type: 'image_url', image_url: { url: activeUrl } },
            { type: 'image_url', image_url: { url: assetUrl  } },
          ],
        }],
      },
      { headers: kieHeaders(), timeout: 45000 }
    );

    const combinedPrompt = (gemRes.data?.choices?.[0]?.message?.content || '').trim();
    console.log('[asset-interact/pre-analyze] combined prompt:', combinedPrompt.slice(0, 200));

    if (!combinedPrompt) throw new Error('Gemini вернул пустой промпт');

    res.json({ success: true, combinedPrompt });
  } catch (err) {
    console.error('[asset-interact/pre-analyze]', err.response?.data || err.message);
    res.status(502).json({ success: false, error: err.response?.data?.msg || err.message });
  }
});

// ── POST /api/asset-interact/generate ────────────────────────────────────────
// Sends active image + asset image + selected prompt to nano-banana-pro (2 refs)
router.post('/asset-interact/generate', async (req, res) => {
  const { activePath, assetPath, prompt, assetType, imageEngine, engineParams = {} } = req.body;
  const engine = (imageEngine === 'qwen2') ? 'qwen2'
               : (imageEngine === 'seedream') ? 'seedream'
               : 'nano-banana-pro';
  const seed = Math.floor(Math.random() * 999_999_999) + 1;

  if (!activePath || !assetPath) {
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

    // Active image first, asset second (order matters for model context)
    let taskId;
    if (engine === 'qwen2') {
      // Qwen2 supports one reference image: use active image, asset context is in the prompt
      taskId = await createQwen2Task(resolvedPrompt, activeUrl, '9:16', seed, engineParams);
    } else if (engine === 'seedream') {
      // Seedream 5 Lite i2i: supports multiple image_urls (active + asset)
      taskId = await createSeedream5LiteTask(resolvedPrompt, [activeUrl, assetUrl], '9:16', 'basic', engineParams);
    } else {
      taskId = await createNanoBananaProTaskMulti(resolvedPrompt, [activeUrl, assetUrl], '9:16', seed, engineParams);
    }
    console.log('[asset-interact/generate] engine:', engine, '| taskId:', taskId, '| seed:', seed);
    addPendingTask(taskId, 'uploads', 'interact', 'asset-interact');

    res.json({ success: true, taskId, seed });
  } catch (err) {
    console.error('[asset-interact/generate]', err.response?.data || err.message);
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
