'use strict';

const express = require('express');
const path    = require('path');
const fs      = require('fs');
const axios   = require('axios');
const router  = express.Router();

const { KIE_BASE, SCENES_DIR, SCENES_FILE } = require('../lib/config');
const {
  kieHeaders, uploadToPublicHost, createNanoBananaProTask, createQwen2Task, createSeedream5LiteTask,
  resolveTask, createThumbnail,
} = require('../lib/helpers');
const { getPrompt } = require('../lib/prompts');
const { addPendingTask, removePendingTask } = require('../lib/pending-tasks');

// ── Scenes JSON store ─────────────────────────────────────────────────────────
function loadScenes() {
  try { return JSON.parse(fs.readFileSync(SCENES_FILE, 'utf8')); } catch { return []; }
}
function saveScenes(list) {
  const dir = path.dirname(SCENES_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(SCENES_FILE, JSON.stringify(list, null, 2), 'utf8');
}

// ── POST /api/scene/analyze ───────────────────────────────────────────────────
// 1. Save original image to disk + upload to public host
// 2. Call Gemini 3.1 Pro (OpenAI-compatible): title, prompt, actors, description
// 3. Launch nano-banana-pro 2K generation task
router.post('/scene/analyze', async (req, res) => {
  const { imageBase64, imageEngine } = req.body;
  const engine = (imageEngine === 'qwen2') ? 'qwen2' : (imageEngine === 'seedream') ? 'seedream' : 'nano-banana-pro';
  if (!imageBase64) return res.status(400).json({ success: false, error: 'Нет imageBase64' });
  try {
    // Save original
    const origFilename = `scene_orig_${Date.now()}.jpg`;
    const origPath     = path.join(SCENES_DIR, origFilename);
    fs.writeFileSync(origPath, Buffer.from(imageBase64, 'base64'));
    createThumbnail(origPath, path.join(SCENES_DIR, 'thumbs', origFilename)).catch(() => {});

    // Upload to public host (needed for Gemini 3.1 Pro image_url format)
    const imageUrl = await uploadToPublicHost(Buffer.from(imageBase64, 'base64'));

    // Gemini 3.1 Pro analysis (OpenAI-compatible endpoint)
    const analysisPrompt = getPrompt('SCENE_ANALYSIS_PROMPT');
    const gemRes = await axios.post(
      `${KIE_BASE}/gemini-3.1-pro/v1/chat/completions`,
      {
        stream: false,
        messages: [{
          role: 'user',
          content: [
            { type: 'text',      text: analysisPrompt },
            { type: 'image_url', image_url: { url: imageUrl } },
          ],
        }],
      },
      { headers: kieHeaders(), timeout: 45000 }
    );

    const rawText = gemRes.data?.choices?.[0]?.message?.content || '{}';
    console.log('[scene/analyze] Gemini raw:', rawText.slice(0, 200));
    const match   = rawText.match(/\{[\s\S]*\}/);
    let analysis  = { title: '', generationPrompt: '', actors: '', description: '' };
    if (match) { try { analysis = { ...analysis, ...JSON.parse(match[0]) }; } catch {} }
    if (!analysis.generationPrompt) throw new Error('Gemini не вернул промпт сцены');

    // Launch 2K generation with the selected engine
    let taskId;
    if (engine === 'qwen2') {
      taskId = await createQwen2Task(analysis.generationPrompt, imageUrl, '16:9');
    } else if (engine === 'seedream') {
      taskId = await createSeedream5LiteTask(analysis.generationPrompt, [imageUrl], '16:9', 'basic');
    } else {
      taskId = await createNanoBananaProTask(analysis.generationPrompt, imageUrl, '16:9');
    }
    console.log('[scene/analyze] taskId:', taskId, '| title:', analysis.title);
    addPendingTask(taskId, 'scenes', 'scene', 'scene', {
      title:            analysis.title            || '',
      originalPath:     `/scenes/${origFilename}`,
      generationPrompt: analysis.generationPrompt || '',
      actors:           analysis.actors           || '',
      description:      analysis.description      || '',
    });

    res.json({
      success:          true,
      taskId,
      originalPath:     `/scenes/${origFilename}`,
      title:            analysis.title            || '',
      generationPrompt: analysis.generationPrompt || '',
      actors:           analysis.actors           || '',
      description:      analysis.description      || '',
    });
  } catch (err) {
    console.error('[scene/analyze]', err.response?.data || err.message);
    res.status(502).json({ success: false, error: err.response?.data?.msg || err.message });
  }
});

// ── GET /api/scene/status/:taskId ─────────────────────────────────────────────
router.get('/scene/status/:taskId', async (req, res) => {
  try {
    const result = await resolveTask(req.params.taskId, SCENES_DIR, 'scene');
    if (result.state === 'success' || result.state === 'failed') removePendingTask(req.params.taskId);
    res.json({ success: true, ...result });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// ── POST /api/scene/save ──────────────────────────────────────────────────────
router.post('/scene/save', (req, res) => {
  const { originalPath, generatedPath, generationPrompt, actors, description, title } = req.body;
  if (!originalPath || !generatedPath)
    return res.status(400).json({ success: false, error: 'Нет путей к изображениям' });
  const list  = loadScenes();
  const entry = {
    id:               Date.now(),
    title:            title            || '',
    originalPath,
    generatedPath,
    generationPrompt: generationPrompt || '',
    actors:           actors           || '',
    description:      description      || '',
    date:             new Date().toISOString(),
  };
  list.unshift(entry);
  saveScenes(list);
  res.json({ success: true, entry });
});

// ── GET /api/scene/list ───────────────────────────────────────────────────────
router.get('/scene/list', (_req, res) => {
  res.json({ success: true, scenes: loadScenes() });
});

// ── DELETE /api/scene/:id ─────────────────────────────────────────────────────
router.delete('/scene/:id', (req, res) => {
  const id   = parseInt(req.params.id, 10);
  const list = loadScenes().filter(s => s.id !== id);
  saveScenes(list);
  res.json({ success: true });
});

module.exports = router;
