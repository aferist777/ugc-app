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

// ── Tempo beautify pass ──────────────────────────────────────────────────────
// Polishes the raw generationPrompt produced by REF_ANALYZE_PROMPT before it is
// sent to the text-to-image engine. Throws on failure — caller should fail the
// whole TEMPO flow so the user can retry.
async function beautifyGenerationPrompt(rawPrompt) {
  if (!rawPrompt || !rawPrompt.trim()) throw new Error('beautify: empty rawPrompt');
  const tpl = getPrompt('REF_BEAUTIFY_PROMPT');
  const promptText = tpl.replace('{RAW_PROMPT}', rawPrompt);
  const out = await callAI(
    [{ role: 'user', content: promptText }],
    { timeout: 60000, useOpenRouter: true, openRouterModel: 'google/gemini-3.5-flash' }
  );
  const cleaned = (out || '').trim();
  if (!cleaned) throw new Error('beautify: empty AI response');
  return cleaned;
}

// ── Realism markers: build the block that gets substituted into REALISM_TEMPO_PROMPT ──
// Mirrors REALISM_MARKER_GROUPS from public/js/settings.js (kept in sync).
//   • Without "realism" checkbox  →  no_retouch + skin_texture only ("always-applied" set)
//   • With "realism" checkbox     →  all 5 groups
const REALISM_GROUP_LABELS = {
  no_retouch:   'No retouch',
  skin_texture: 'Skin texture',
  camera:       'Camera / Optics',
  lighting:     'Lighting',
  anatomy:      'Anatomy / Details',
};
const ALWAYS_GROUPS = ['no_retouch', 'skin_texture'];
const REALISM_GROUPS = ['camera', 'lighting', 'anatomy'];

// Build "Group: marker1, marker2" lines from per-group enabled markers.
// markerGroups: { groupId: [enabled markers] } sent by frontend.
function _buildMarkersBlock(markerGroups = {}, withRealism = false) {
  const allowed = withRealism ? [...ALWAYS_GROUPS, ...REALISM_GROUPS] : ALWAYS_GROUPS;
  const lines = allowed
    .map(gid => {
      const items = (markerGroups[gid] || []).filter(Boolean);
      if (!items.length) return null;
      return `${REALISM_GROUP_LABELS[gid] || gid}: ${items.join(', ')}`;
    })
    .filter(Boolean);
  return lines.length ? lines.join('\n') : '(no markers selected)';
}

// Substitute {MARKERS} placeholder in the realism prompt; if absent (custom-edited
// version without placeholder), append the markers block at the end.
function _injectMarkers(realismPrompt, markersBlock) {
  if (realismPrompt.includes('{MARKERS}')) {
    return realismPrompt.replace('{MARKERS}', markersBlock);
  }
  return realismPrompt + '\n\nUser-selected realism markers:\n' + markersBlock;
}

// ── POST /api/refs/save ───────────────────────────────────────────────────────
// Body: { imageBase64 }
// 1. Save original to refs/ dir
// 2. Upload to public host for Gemini
// 3. Gemini deep analysis → title, generationPrompt, colorProfile, subjects, technicalMarkers, descriptionRu
// 4. Store entry to refs.json; return entry + publicUrl for subsequent generation
router.post('/refs/save', async (req, res) => {
  const { imageBase64, withRealism, markerGroups } = req.body;
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
    // Realism prompt is ALWAYS appended now — the marker SET differs by checkbox:
    //   • without realism: only "always-applied" groups (no_retouch + skin_texture)
    //   • with realism:    all 5 groups
    let analysisPrompt = getPrompt('REF_ANALYZE_PROMPT');
    const markersBlock = _buildMarkersBlock(markerGroups || {}, !!withRealism);
    analysisPrompt += _injectMarkers(getPrompt('REALISM_TEMPO_PROMPT'), markersBlock);
    const rawText = await callAI([{
      role: 'user',
      content: [
        { type: 'text',      text: analysisPrompt },
        { type: 'image_url', image_url: { url: imageUrl } },
      ],
    }], { timeout: 60000, useOpenRouter: true, openRouterModel: 'google/gemini-3.5-flash' });
    console.log('[refs/save] Gemini raw:', rawText.slice(0, 300));

    const match  = rawText.match(/\{[\s\S]*\}/);
    let analysis = { title: '', generationPrompt: '', colorProfile: '', subjects: '', technicalMarkers: '', descriptionRu: '', realismMarkers: '' };
    if (match) { try { analysis = { ...analysis, ...JSON.parse(match[0]) }; } catch {} }

    if (!analysis.generationPrompt) throw new Error('Vision-анализ не вернул generationPrompt');

    // ── Beautify pass (text-to-text, no image) ────────────────────────────────
    // Failure here fails the whole TEMPO so the user can retry.
    console.log('[refs/save] beautify: starting…');
    const beautified = await beautifyGenerationPrompt(analysis.generationPrompt);
    console.log('[refs/save] beautify done:', beautified.slice(0, 200));
    analysis.generationPrompt = beautified;

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
  const { imageBase64, withRealism, markerGroups } = req.body;
  if (!imageBase64) return res.status(400).json({ success: false, error: 'Нет imageBase64' });
  try {
    const buf      = Buffer.from(imageBase64, 'base64');
    const imageUrl = await uploadToPublicHost(buf);

    let analysisPrompt = getPrompt('REF_ANALYZE_PROMPT');
    const markersBlock = _buildMarkersBlock(markerGroups || {}, !!withRealism);
    analysisPrompt += _injectMarkers(getPrompt('REALISM_TEMPO_PROMPT'), markersBlock);

    const rawText = await callAI([{
      role: 'user',
      content: [
        { type: 'text',      text: analysisPrompt },
        { type: 'image_url', image_url: { url: imageUrl } },
      ],
    }], { timeout: 60000, useOpenRouter: true, openRouterModel: 'google/gemini-3.5-flash' });
    const match   = rawText.match(/\{[\s\S]*\}/);
    let analysis  = { generationPrompt: '' };
    if (match) { try { analysis = { ...analysis, ...JSON.parse(match[0]) }; } catch {} }

    if (!analysis.generationPrompt) throw new Error('Gemini не вернул generationPrompt');

    // Beautify pass (text-to-text, no image). Throws on failure → caller retries.
    const beautified = await beautifyGenerationPrompt(analysis.generationPrompt);

    res.json({ success: true, generationPrompt: beautified });
  } catch (err) {
    console.error('[refs/analyze-only]', err.response?.data || err.message);
    res.status(502).json({ success: false, error: err.response?.data?.msg || err.message });
  }
});

// ── POST /api/refs/beautify ──────────────────────────────────────────────────
// Body: { prompt }
// Runs the same text-only beautify pass as /api/refs/save uses internally.
// Used by Tempo on repeat clicks: it skips the vision analyze stage but still
// re-polishes the cached prompt before generation.
router.post('/refs/beautify', async (req, res) => {
  const { prompt } = req.body || {};
  if (!prompt) return res.status(400).json({ success: false, error: 'Нет prompt' });
  try {
    const out = await beautifyGenerationPrompt(prompt);
    res.json({ success: true, prompt: out });
  } catch (err) {
    console.error('[refs/beautify]', err.message);
    res.status(502).json({ success: false, error: err.message });
  }
});

// Tempo-specific suffix that guarantees the generation prompt always tells the
// image model to keep the subject's gaze locked on the camera lens. This is a
// hard append on top of whatever the beautify pass produced.
const TEMPO_CAMERA_LENS_CLAUSE =
  ' The subject is looking directly into the camera lens, with strong direct eye contact and gaze aimed straight at the lens.';

function _appendCameraLens(prompt) {
  if (!prompt) return prompt;
  // Avoid double-appends if the rule is already present.
  if (/looking\s+directly\s+into\s+the\s+camera\s+lens/i.test(prompt)) return prompt;
  return prompt.trim().replace(/\s+$/, '') + TEMPO_CAMERA_LENS_CLAUSE;
}

// ── POST /api/refs/tempo-generate ─────────────────────────────────────────────
// Body: { refId, generationPrompt, forceEngine? }
// Tempo flow: this endpoint always renders via GPT Image 2, regardless of the
// engine selected in the Character tab UI — Tempo is supposed to use that one
// engine specifically. The engine selectors in the UI keep their value
// untouched. The `forceEngine` field on the request is ignored for Tempo.
// Returns { taskId, engine, seed }
router.post('/refs/tempo-generate', async (req, res) => {
  const { generationPrompt, engineParams = {} } = req.body;
  if (!generationPrompt)
    return res.status(400).json({ success: false, error: 'Нет generationPrompt' });

  // Tempo always runs through GPT Image 2 + adds the camera-lens clause.
  const engine = 'gptimage2';
  const finalPrompt = _appendCameraLens(generationPrompt);
  const seed   = Math.floor(Math.random() * 9_000_000) + 1_000_000;

  console.log('[refs/tempo-generate] text-to-image | engine:', engine, '| seed:', seed);

  try {
    let taskId;
    if (engine === 'qwen2') {
      taskId = await createQwen2TextTask(finalPrompt, '9:16', seed, engineParams);
    } else if (engine === 'seedream') {
      taskId = await createSeedream5LiteTextTask(finalPrompt, '9:16', engineParams);
    } else if (engine === 'gptimage2') {
      taskId = await createGptImage2TextTask(finalPrompt, '9:16', engineParams);
    } else {
      taskId = await createNanoBananaProTextTask(finalPrompt, '9:16', engineParams);
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

// Body: { imageBase64, name?, userNotes?, analyze?, detailFile? }
router.post('/refs/save-detail', async (req, res) => {
  const { imageBase64, name, userNotes = '', analyze = true, detailFile = '' } = req.body;
  if (!imageBase64) return res.status(400).json({ success: false, error: 'Нет imageBase64' });

  try {
    const buf       = Buffer.from(imageBase64, 'base64');
    const filename  = `ref_detail_${Date.now()}.jpg`;
    const origPath  = path.join(REFS_DIR, filename);
    const thumbsDir = path.join(REFS_DIR, 'thumbs');
    fs.writeFileSync(origPath, buf);
    createThumbnail(origPath, path.join(thumbsDir, filename)).catch(() => {});

    let analysis = {
      title: '', description: '', size: '', interactions: [], technicalDetails: '',
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
      }], { timeout: 60000, useOpenRouter: true, openRouterModel: 'google/gemini-3.5-flash' });
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
      size:             analysis.size             || '',
      interactions:     Array.isArray(analysis.interactions) ? analysis.interactions : [],
      technicalDetails: analysis.technicalDetails || '',
      generationPrompt: analysis.generationPrompt || '',
      colorProfile:     analysis.colorProfile     || '',
      subjects:         analysis.subjects         || '',
      userNotes:        userNotes                 || '',
      analyzed:         !!analyze,
      generations:      [],
      date:             new Date().toISOString(),
      detailFile:       detailFile || '',
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
      }], { timeout: 60000, useOpenRouter: true, openRouterModel: 'google/gemini-3.5-flash' });
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
