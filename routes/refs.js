'use strict';

const express = require('express');
const path    = require('path');
const fs      = require('fs');
const router  = express.Router();

const { REFS_DIR, REFS_FILE, DETAILS_DIR } = require('../lib/config');
const {
  kieHeaders, uploadToPublicHost, createThumbnail, resolveTask,
  createNanoBananaProTextTask, createQwen2TextTask, createGptImage2TextTask, createSeedream5LiteTextTask,
  callAI, callAIVision,
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

  const engines = ['nano-banana-2', 'qwen2', 'seedream', 'gptimage2'];
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
    } else if (engine === 'gptimage2') {
      taskId = await createGptImage2TextTask(generationPrompt, '9:16', engineParams);
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
  // Drop entries whose original file no longer exists on disk
  refs = refs.filter(r => {
    if (!r.originalPath) return false;
    const absPath = path.join(__dirname, '..', r.originalPath.replace(/^\//, ''));
    return fs.existsSync(absPath);
  });
  res.json({ success: true, refs });
});

// Body: { imageBase64, name?, userNotes?, analyze? }
router.post('/refs/save-detail', async (req, res) => {
  const { imageBase64, name, userNotes = '', analyze = true } = req.body;
  if (!imageBase64) return res.status(400).json({ success: false, error: 'Нет imageBase64' });

  try {
    const buf       = Buffer.from(imageBase64, 'base64');
    const filename  = `ref_detail_${Date.now()}.jpg`;
    const origPath  = path.join(REFS_DIR, filename);
    const thumbsDir = path.join(REFS_DIR, 'thumbs');
    fs.writeFileSync(origPath, buf);
    createThumbnail(origPath, path.join(thumbsDir, filename)).catch(() => {});

    let analysis = {
      title: '', description: '', interactions: [], technicalDetails: '',
      generationPrompt: '', colorProfile: '', subjects: '',
    };

    if (analyze) {
      const imageUrl = await uploadToPublicHost(buf);
      const prompt   = getPrompt('DETAIL_ANALYZE_PROMPT').replace(/\{userNotes\}/g, userNotes || '');
      const rawText  = await callAIVision([{
        role: 'user',
        content: [
          { type: 'text',      text: prompt },
          { type: 'image_url', image_url: { url: imageUrl } },
        ],
      }], { timeout: 60000 });
      console.log('[refs/save-detail] AI raw:', rawText.slice(0, 300));
      const match = rawText.match(/\{[\s\S]*\}/);
      if (match) { try { analysis = { ...analysis, ...JSON.parse(match[0]) }; } catch (e) { console.warn('[refs/save-detail] JSON parse:', e.message); } }
    }

    const entry = {
      id:               Date.now(),
      originalPath:     `/refs/${filename}`,
      category:         'detail',
      title:            name || analysis.title || filename,
      description:      analysis.description      || '',
      interactions:     Array.isArray(analysis.interactions) ? analysis.interactions : [],
      technicalDetails: analysis.technicalDetails || '',
      generationPrompt: analysis.generationPrompt || '',
      colorProfile:     analysis.colorProfile     || '',
      subjects:         analysis.subjects         || '',
      userNotes:        userNotes                 || '',
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

// ── POST /api/refs/analyze-from-detail ───────────────────────────────────────
// Body: { filename, name?, userNotes? }
// Reads the already-saved detail file from DETAILS_DIR, runs AI analysis, saves ref entry.
// Responds immediately (202) and does the work asynchronously.
router.post('/refs/analyze-from-detail', (req, res) => {
  const { filename, name, userNotes = '' } = req.body;
  if (!filename) return res.status(400).json({ success: false, error: 'Нет filename' });

  const srcPath = path.join(DETAILS_DIR, filename);
  if (!fs.existsSync(srcPath)) return res.status(404).json({ success: false, error: 'Файл не найден' });

  res.json({ success: true, message: 'Анализ запущен' });

  setImmediate(async () => {
    try {
      const buf = fs.readFileSync(srcPath);
      const refFilename = `ref_detail_${Date.now()}.jpg`;
      const origPath    = path.join(REFS_DIR, refFilename);
      const thumbsDir   = path.join(REFS_DIR, 'thumbs');
      fs.writeFileSync(origPath, buf);
      createThumbnail(origPath, path.join(thumbsDir, refFilename)).catch(() => {});

      const imageUrl = await uploadToPublicHost(buf);
      const prompt   = getPrompt('DETAIL_ANALYZE_PROMPT').replace(/\{userNotes\}/g, userNotes || '');
      const rawText  = await callAIVision([{
        role: 'user',
        content: [
          { type: 'text',      text: prompt },
          { type: 'image_url', image_url: { url: imageUrl } },
        ],
      }], { timeout: 60000 });
      console.log('[refs/analyze-from-detail] AI raw:', rawText.slice(0, 300));

      let analysis = { title: '', description: '', interactions: [], technicalDetails: '', generationPrompt: '', colorProfile: '', subjects: '' };
      const match = rawText.match(/\{[\s\S]*\}/);
      if (match) { try { analysis = { ...analysis, ...JSON.parse(match[0]) }; } catch (e) { console.warn('[refs/analyze-from-detail] JSON parse:', e.message); } }

      const entry = {
        id:               Date.now(),
        originalPath:     `/refs/${refFilename}`,
        category:         'detail',
        detailFile:       filename,
        title:            name || analysis.title || filename,
        description:      analysis.description      || '',
        interactions:     Array.isArray(analysis.interactions) ? analysis.interactions : [],
        technicalDetails: analysis.technicalDetails || '',
        generationPrompt: analysis.generationPrompt || '',
        colorProfile:     analysis.colorProfile     || '',
        subjects:         analysis.subjects         || '',
        userNotes:        userNotes                 || '',
        analyzed:         true,
        generations:      [],
        date:             new Date().toISOString(),
      };
      const list = loadRefs();
      list.unshift(entry);
      saveRefs(list);
      console.log('[refs/analyze-from-detail] saved:', entry.title);
    } catch (err) {
      console.error('[refs/analyze-from-detail]', err.message);
    }
  });
});

// ── PATCH /api/refs/:id/set-title ────────────────────────────────────────────
router.patch('/refs/:id/set-title', (req, res) => {
  const id   = parseInt(req.params.id, 10);
  const { title } = req.body;
  const list = loadRefs();
  const entry = list.find(r => r.id === id);
  if (!entry) return res.status(404).json({ success: false, error: 'Не найден' });
  if (title !== undefined) entry.title = title;
  saveRefs(list);
  res.json({ success: true });
});

// ── DELETE /api/refs/:id ──────────────────────────────────────────────────────
router.delete('/refs/:id', (req, res) => {
  const id   = parseInt(req.params.id, 10);
  const all  = loadRefs();
  const entry = all.find(r => r.id === id);
  saveRefs(all.filter(r => r.id !== id));

  // Cascade: if this is a detail ref with a linked detailFile, delete from details/ too
  if (entry?.category === 'detail' && entry.detailFile) {
    try {
      const filePath = path.join(DETAILS_DIR, entry.detailFile);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      const thumbName = entry.detailFile.replace(/\.[^.]+$/, '') + '.jpg';
      const thumbPath = path.join(DETAILS_DIR, 'thumbs', thumbName);
      if (fs.existsSync(thumbPath)) fs.unlinkSync(thumbPath);
      // Remove from details-meta.json
      const DATA_DIR = path.join(__dirname, '..', 'data');
      const metaFile = path.join(DATA_DIR, 'details-meta.json');
      if (fs.existsSync(metaFile)) {
        try {
          const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
          delete meta[entry.detailFile];
          fs.writeFileSync(metaFile, JSON.stringify(meta, null, 2), 'utf8');
        } catch {}
      }
    } catch (e) { console.warn('[refs/delete cascade]', e.message); }
  }

  res.json({ success: true, detailFile: entry?.detailFile || null });
});

module.exports = router;
