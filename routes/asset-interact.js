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
const { kieHeaders, uploadToPublicHost, createNanoBananaProTaskMulti, resolveTask } = require('../lib/helpers');
const { getPrompt } = require('../lib/prompts');

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

// ── POST /api/asset-interact/generate ────────────────────────────────────────
// Sends active image + asset image + selected prompt to nano-banana-pro (2 refs)
router.post('/asset-interact/generate', async (req, res) => {
  const { activePath, assetPath, prompt } = req.body;

  if (!activePath || !assetPath || !prompt) {
    return res.status(400).json({ success: false, error: 'Нет изображений или промпта' });
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
    const taskId = await createNanoBananaProTaskMulti(prompt, [activeUrl, assetUrl], '9:16');
    console.log('[asset-interact/generate] taskId:', taskId);

    res.json({ success: true, taskId });
  } catch (err) {
    console.error('[asset-interact/generate]', err.response?.data || err.message);
    res.status(502).json({ success: false, error: err.response?.data?.msg || err.message });
  }
});

// ── GET /api/asset-interact/status/:taskId ────────────────────────────────────
router.get('/asset-interact/status/:taskId', async (req, res) => {
  try {
    res.json({ success: true, ...(await resolveTask(req.params.taskId, UPLOADS_DIR, 'interact')) });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

module.exports = router;
