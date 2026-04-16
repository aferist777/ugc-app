'use strict';

const express = require('express');
const path    = require('path');
const fs      = require('fs');
const router  = express.Router();

const { REFS_DIR, REFS_FILE } = require('../lib/config');
const {
  kieHeaders, uploadToPublicHost, createThumbnail, resolveTask,
  createNanoBananaProTextTask, createQwen2TextTask, createSeedream5LiteTextTask,
  callAI,
} = require('../lib/helpers');
const { getPrompt } = require('../lib/prompts');
const { addPendingTask, removePendingTask } = require('../lib/pending-tasks');

// ── JSON store helpers ────────────────────────────────────────────────────────
function loadRefs() {
  try { return JSON.parse(fs.readFileSync(REFS_FILE, 'utf8')); } catch { return []; }
}
function saveRefs(list) {
  fs.mkdirSync(path.dirname(REFS_FILE), { recursive: true });
  fs.writeFileSync(REFS_FILE, JSON.stringify(list, null, 2), 'utf8');
}

// ── POST /api/refs/save ───────────────────────────────────────────────────────
// Body: { imageBase64 }
// 1. Save original to refs/ dir
// 2. Upload to public host for Gemini
// 3. Gemini deep analysis → title, generationPrompt, colorProfile, subjects, technicalMarkers, descriptionRu
// 4. Store entry to refs.json; return entry + publicUrl for subsequent generation
router.post('/refs/save', async (req, res) => {
  const { imageBase64, withRealism } = req.body;
  if (!imageBase64) return res.status(400).json({ success: false, error: 'Нет imageBase64' });

  try {
    const buf = Buffer.from(imageBase64, 'base64');

    // Save original
    const filename   = `ref_${Date.now()}.jpg`;
    const origPath   = path.join(REFS_DIR, filename);
    const thumbsDir  = path.join(REFS_DIR, 'thumbs');
    fs.writeFileSync(origPath, buf);
    createThumbnail(origPath, path.join(thumbsDir, filename)).catch(() => {});

    // Upload to public host (Gemini requires public URL; reused for generation)
    const imageUrl = await uploadToPublicHost(buf);

    // AI deep analysis (Gemini → GPT-5.2 fallback)
    let analysisPrompt = getPrompt('REF_ANALYZE_PROMPT');
    if (withRealism) analysisPrompt += getPrompt('REALISM_TEMPO_PROMPT');
    const rawText = await callAI([{
      role: 'user',
      content: [
        { type: 'text',      text: analysisPrompt },
        { type: 'image_url', image_url: { url: imageUrl } },
      ],
    }], { timeout: 60000 });
    console.log('[refs/save] Gemini raw:', rawText.slice(0, 300));

    const match  = rawText.match(/\{[\s\S]*\}/);
    let analysis = { title: '', generationPrompt: '', colorProfile: '', subjects: '', technicalMarkers: '', descriptionRu: '', realismMarkers: '' };
    if (match) { try { analysis = { ...analysis, ...JSON.parse(match[0]) }; } catch {} }

    const { category = 'character' } = req.body;

    const entry = {
      id:               Date.now(),
      originalPath:     `/refs/${filename}`,
      category,
      title:            analysis.title            || filename,
      generationPrompt: analysis.generationPrompt || '',
      colorProfile:     analysis.colorProfile     || '',
      subjects:         analysis.subjects         || '',
      technicalMarkers: analysis.technicalMarkers || '',
      descriptionRu:    analysis.descriptionRu    || '',
      realismMarkers:   analysis.realismMarkers   || '',
      withRealism:      !!withRealism,
      generations:      [],
      date:             new Date().toISOString(),
    };

    const list = loadRefs();
    list.unshift(entry);
    saveRefs(list);

    // Return publicUrl so the frontend can use it immediately for generation
    res.json({ success: true, entry, imageUrl });
  } catch (err) {
    console.error('[refs/save]', err.response?.data || err.message);
    res.status(502).json({ success: false, error: err.response?.data?.msg || err.message });
  }
});

// ── POST /api/refs/analyze-only ──────────────────────────────────────────────
// Body: { imageBase64, withRealism }
// Runs Gemini analysis without saving a new ref entry.
// Returns { success, generationPrompt } only.
router.post('/refs/analyze-only', async (req, res) => {
  const { imageBase64, withRealism } = req.body;
  if (!imageBase64) return res.status(400).json({ success: false, error: 'Нет imageBase64' });
  try {
    const buf      = Buffer.from(imageBase64, 'base64');
    const imageUrl = await uploadToPublicHost(buf);

    let analysisPrompt = getPrompt('REF_ANALYZE_PROMPT');
    if (withRealism) analysisPrompt += getPrompt('REALISM_TEMPO_PROMPT');

    const rawText = await callAI([{
      role: 'user',
      content: [
        { type: 'text',      text: analysisPrompt },
        { type: 'image_url', image_url: { url: imageUrl } },
      ],
    }], { timeout: 60000 });
    const match   = rawText.match(/\{[\s\S]*\}/);
    let analysis  = { generationPrompt: '' };
    if (match) { try { analysis = { ...analysis, ...JSON.parse(match[0]) }; } catch {} }

    if (!analysis.generationPrompt) throw new Error('Gemini не вернул generationPrompt');
    res.json({ success: true, generationPrompt: analysis.generationPrompt });
  } catch (err) {
    console.error('[refs/analyze-only]', err.response?.data || err.message);
    res.status(502).json({ success: false, error: err.response?.data?.msg || err.message });
  }
});

// ── POST /api/refs/tempo-generate ─────────────────────────────────────────────
// Body: { refId, generationPrompt, forceEngine? }
// Picks a random text-to-image engine; sends ONLY the prompt — no reference image.
// Returns { taskId, engine, seed }
router.post('/refs/tempo-generate', async (req, res) => {
  const { generationPrompt, forceEngine, engineParams = {} } = req.body;
  if (!generationPrompt)
    return res.status(400).json({ success: false, error: 'Нет generationPrompt' });

  const engines = ['nano-banana-pro', 'qwen2', 'seedream'];
  const engine  = (forceEngine && engines.includes(forceEngine))
    ? forceEngine
    : engines[Math.floor(Math.random() * engines.length)];
  const seed    = Math.floor(Math.random() * 9_000_000) + 1_000_000;

  console.log('[refs/tempo-generate] text-to-image | engine:', engine, '| seed:', seed);

  try {
    let taskId;
    if (engine === 'qwen2') {
      taskId = await createQwen2TextTask(generationPrompt, '9:16', seed, engineParams);
    } else if (engine === 'seedream') {
      taskId = await createSeedream5LiteTextTask(generationPrompt, '9:16', engineParams);
    } else {
      taskId = await createNanoBananaProTextTask(generationPrompt, '9:16', engineParams);
    }
    addPendingTask(taskId, 'refs', 'ref_gen', 'ref-gen', { refId: req.body.refId || null, seed });
    res.json({ success: true, taskId, engine, seed });
  } catch (err) {
    console.error('[refs/tempo-generate]', err.response?.data || err.message);
    res.status(502).json({ success: false, error: err.response?.data?.msg || err.message });
  }
});

// ── GET /api/refs/gen-status/:taskId ─────────────────────────────────────────
// Polls task and downloads result to REFS_DIR on success
router.get('/refs/gen-status/:taskId', async (req, res) => {
  try {
    const result = await resolveTask(req.params.taskId, REFS_DIR, 'ref_gen');
    if (result.state === 'success' || result.state === 'failed') removePendingTask(req.params.taskId);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(502).json({ success: false, error: err.message });
  }
});

// ── PATCH /api/refs/:id/add-generation ───────────────────────────────────────
// Body: { imagePath, seed }
// Appends a generated image to ref.generations[]
router.patch('/refs/:id/add-generation', (req, res) => {
  const id        = parseInt(req.params.id, 10);
  const { imagePath, seed } = req.body;
  if (!imagePath) return res.status(400).json({ success: false, error: 'Нет imagePath' });

  const list  = loadRefs();
  const entry = list.find(r => r.id === id);
  if (!entry) return res.status(404).json({ success: false, error: 'Реф не найден' });

  if (!Array.isArray(entry.generations)) entry.generations = [];
  if (!entry.generations.some(g => g.path === imagePath)) {
    entry.generations.push({ path: imagePath, seed: seed || null, date: new Date().toISOString() });
  }
  // Also persist the seed on the entry if not set yet
  if (seed && !entry.seed) entry.seed = seed;

  saveRefs(list);
  res.json({ success: true, entry });
});

// ── GET /api/refs/list ────────────────────────────────────────────────────────
// Optional ?category=character|scene|detail  to filter by category
router.get('/refs/list', (req, res) => {
  let refs = loadRefs();
  const { category } = req.query;
  if (category) refs = refs.filter(r => (r.category || 'character') === category);
  res.json({ success: true, refs });
});

// ── POST /api/refs/save-detail ────────────────────────────────────────────────
// Analyze a предмет (asset) image, store in refs with category='detail'
// Body: { imageBase64, name? }
const DETAIL_ANALYZE_PROMPT =
  `You are a product/asset image analyst for video content production.\n` +
  `Analyze this product/asset image and return ONLY valid JSON (no markdown, no preamble):\n` +
  `{\n` +
  `  "title": "[short product name in Russian, max 5 words]",\n` +
  `  "descriptionRu": "[3-4 sentence description in Russian: what it is, colour, material, shape, distinctive features]",\n` +
  `  "subjects": "[English: object name, category, key visual attributes — comma-separated]",\n` +
  `  "colorProfile": "[English: dominant colours, finish (matte/glossy/metallic), texture]",\n` +
  `  "technicalMarkers": "[English: approximate size category, packaging or product, any visible branding/logos (describe don't copy)]",\n` +
  `  "generationPrompt": "[English prompt, 150-200 chars: starts with 'A product photo of', then: exact item, colour, material, surface it rests on, background, lighting. Factual only.]"\n` +
  `}`;

// Body: { imageBase64, name?, analyze? }
// analyze=true → run Gemini analysis; analyze=false → save image only (no AI)
router.post('/refs/save-detail', async (req, res) => {
  const { imageBase64, name, analyze = true } = req.body;
  if (!imageBase64) return res.status(400).json({ success: false, error: 'Нет imageBase64' });

  try {
    const buf       = Buffer.from(imageBase64, 'base64');
    const filename  = `ref_detail_${Date.now()}.jpg`;
    const origPath  = path.join(REFS_DIR, filename);
    const thumbsDir = path.join(REFS_DIR, 'thumbs');
    fs.writeFileSync(origPath, buf);
    createThumbnail(origPath, path.join(thumbsDir, filename)).catch(() => {});

    let analysis = { title: '', generationPrompt: '', colorProfile: '', subjects: '', technicalMarkers: '', descriptionRu: '' };

    if (analyze) {
      const imageUrl = await uploadToPublicHost(buf);
      const rawText  = await callAI([{
        role: 'user',
        content: [
          { type: 'text',      text: DETAIL_ANALYZE_PROMPT },
          { type: 'image_url', image_url: { url: imageUrl } },
        ],
      }], { timeout: 60000 });

      const match = rawText.match(/\{[\s\S]*\}/);
      if (match) { try { analysis = { ...analysis, ...JSON.parse(match[0]) }; } catch {} }
    }

    const entry = {
      id:               Date.now(),
      originalPath:     `/refs/${filename}`,
      category:         'detail',
      title:            name || analysis.title || filename,
      generationPrompt: analysis.generationPrompt || '',
      colorProfile:     analysis.colorProfile     || '',
      subjects:         analysis.subjects         || '',
      technicalMarkers: analysis.technicalMarkers || '',
      descriptionRu:    analysis.descriptionRu    || '',
      realismMarkers:   '',
      withRealism:      false,
      analyzed:         !!analyze,
      generations:      [],
      date:             new Date().toISOString(),
    };

    const list = loadRefs();
    list.unshift(entry);
    saveRefs(list);

    res.json({ success: true, entry });
  } catch (err) {
    console.error('[refs/save-detail]', err.response?.data || err.message);
    res.status(502).json({ success: false, error: err.response?.data?.msg || err.message });
  }
});

// ── DELETE /api/refs/:id ──────────────────────────────────────────────────────
router.delete('/refs/:id', (req, res) => {
  const id   = parseInt(req.params.id, 10);
  const list = loadRefs().filter(r => r.id !== id);
  saveRefs(list);
  res.json({ success: true });
});

module.exports = router;
