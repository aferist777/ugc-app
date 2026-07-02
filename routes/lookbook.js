'use strict';

const express = require('express');
const path    = require('path');
const fs      = require('fs');
const axios   = require('axios');
const router  = express.Router();

const { KIE_BASE, LOOKBOOKS_DIR, ENVIRONMENTS_DIR, CHARACTERS_DIR, UPLOADS_DIR } = require('../lib/config');
const { kieHeaders, uploadToPublicHost, createNanoBananaTask, createQwen2Task, createGptImage2Task, createSeedream5LiteTask, createSeedream45Task, createMultiRefEditTask, resolveTask, callAIVisionWithFallback } = require('../lib/helpers');
const { getPrompt } = require('../lib/prompts');
const { addPendingTask, removePendingTask } = require('../lib/pending-tasks');

function listWithThumbs(dir, urlPrefix) {
  return fs.readdirSync(dir)
    .filter(f => /\.(jpg|jpeg|png)$/i.test(f))
    .map(f => ({ file: f, mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)
    .map(({ file }) => {
      const thumbName = file.replace(/\.[^.]+$/, '') + '.jpg';
      const tp = path.join(dir, 'thumbs', thumbName);
      return {
        path:      `${urlPrefix}/${file}`,
        thumbPath: fs.existsSync(tp) ? `${urlPrefix}/thumbs/${thumbName}` : `${urlPrefix}/${file}`,
        name:      file.replace(/\.[^.]+$/, ''),
      };
    });
}

// ── List lookbooks ────────────────────────────────────────────────────────────
router.get('/lookbooks', (_req, res) => {
  res.json({ success: true, files: listWithThumbs(LOOKBOOKS_DIR, '/lookbooks') });
});

// ── List environments ─────────────────────────────────────────────────────────
router.get('/environments', (_req, res) => {
  res.json({ success: true, files: listWithThumbs(ENVIRONMENTS_DIR, '/environments') });
});

// ── Generate lookbook (clothing + bg in parallel) ─────────────────────────────
// Pick the task creator for the chosen image engine (extraction = text + 1 image).
function _extractTask(engine, prompt, imageUrl) {
  if (engine === 'qwen2')     return createQwen2Task(prompt, imageUrl, '9:16');
  if (engine === 'seedream')  return createSeedream5LiteTask(prompt, [imageUrl], '9:16', 'basic');
  if (engine === 'seedream4.5') return createSeedream45Task(prompt, [imageUrl], '9:16', 'basic');
  if (engine === 'gptimage2') return createGptImage2Task(prompt, [imageUrl], '9:16');
  return createNanoBananaTask(prompt, imageUrl, '9:16');   // nano-banana-2 / default
}

// mode: 'lookbook' | 'environment' | 'both' (default 'both'). Creates only the
// requested extraction task(s) with the chosen engine; returns only their ids.
router.post('/lookbook/generate', async (req, res) => {
  const { imageBase64, mode, imageEngine } = req.body;
  if (!imageBase64) return res.status(400).json({ success: false, error: 'Загрузите изображение' });
  const m = ['lookbook', 'environment', 'both'].includes(mode) ? mode : 'both';

  try {
    const imageUrl = await uploadToPublicHost(Buffer.from(imageBase64, 'base64'));
    const out = { success: true };
    if (m === 'lookbook' || m === 'both') {
      const clothingTaskId = await _extractTask(imageEngine, getPrompt('EXTRACT_CLOTHING_PROMPT'), imageUrl);
      addPendingTask(clothingTaskId, 'lookbooks', 'lookbook', 'lookbook');
      out.clothingTaskId = clothingTaskId;
    }
    if (m === 'environment' || m === 'both') {
      const bgTaskId = await _extractTask(imageEngine, getPrompt('EXTRACT_BG_PROMPT'), imageUrl);
      addPendingTask(bgTaskId, 'environments', 'env', 'environment');
      out.bgTaskId = bgTaskId;
    }
    res.json(out);
  } catch (err) {
    console.error('[lookbook/generate]', err.response?.data || err.message);
    res.status(502).json({ success: false, error: err.response?.data?.msg || err.message });
  }
});

// ── Mix 2+ lookbooks into one new lookbook ────────────────────────────────────
// 1) a vision agent studies the selected lookbook images and composes ONE cohesive
//    mixed-outfit description (which garment comes from which reference);
// 2) the selected images go to nano-banana-2 as references with that prompt →
//    a fresh square lookbook flat-lay, saved to the lookbook base.
function _mixLookbookPrompt(composed) {
  return 'Create a single clothing LOOKBOOK image: a neat flat-lay product arrangement of ONE combined outfit, '
    + 'with every garment and accessory laid out flat and clearly separated on a plain neutral light-grey studio background. '
    + 'No person, no mannequin, no body, no hanger, no text, no labels, no watermark. '
    + 'Faithfully reproduce each item\'s exact colour, material, print/pattern and details from the reference images - do NOT invent new clothing. '
    + 'Combine EXACTLY these pieces into the single outfit: ' + composed + ' '
    + 'Clean product photography, soft even lighting, sharp focus, high detail, 1:1 square format.';
}
router.post('/lookbook/mix', async (req, res) => {
  const { paths, imageEngine } = req.body;
  if (!Array.isArray(paths) || paths.length < 2)
    return res.status(400).json({ success: false, error: 'Select at least 2 lookbooks to mix' });

  const rels = paths.slice(0, 4).map(p => String(p).replace(/^\//, ''));
  const abs  = rels.map(r => path.join(__dirname, '..', r));
  for (const a of abs) if (!fs.existsSync(a)) return res.status(400).json({ success: false, error: 'Lookbook file not found: ' + a });

  try {
    const urls = await Promise.all(abs.map(a => uploadToPublicHost(fs.readFileSync(a))));

    // 1) Vision: compose a single mixed-outfit description from all selected lookbooks.
    const content = [{ type: 'text', text:
      `You are a fashion stylist. You are given ${urls.length} clothing lookbook images (image 1..${urls.length}), each showing an outfit or a set of clothing items. `
      + `Study every image, then design ONE new cohesive, stylish outfit that mixes the strongest pieces across them. Decide which garment or accessory to take from which image and make sure the final look is coherent (colours and styles work together). `
      + `Reply with ONE compact English paragraph (max ~80 words) describing the final combined outfit item by item - garment type, colour, material, print/pattern and notable details - written as an image-generation prompt. When useful, note the source like "the leather jacket from image 2". `
      + `Output ONLY that paragraph: no preamble, no headings, no bullet points.` }];
    urls.forEach(u => content.push({ type: 'image_url', image_url: { url: u } }));
    let composed = '';
    try { composed = String(await callAIVisionWithFallback([{ role: 'user', content }], { timeout: 60000 }) || '').trim(); }
    catch (e) { console.warn('[lookbook/mix] vision failed:', e.message); }
    if (!composed) composed = 'A balanced mix of the standout garments and accessories shown across the reference lookbooks, combined into one coherent, stylish outfit.';

    // 2) Generate the mixed lookbook (nano-banana-2 multi-ref, square) → lookbook base.
    const engine  = imageEngine || 'nano-banana-2';
    const taskId  = await createMultiRefEditTask(engine, _mixLookbookPrompt(composed), urls, '1:1', null, {});
    if (!taskId) return res.status(502).json({ success: false, error: 'kie.ai returned no taskId' });
    addPendingTask(taskId, 'lookbooks', 'lookbook', 'lookbook-mix');
    res.json({ success: true, taskId, composed });
  } catch (err) {
    console.error('[lookbook/mix]', err.response?.data || err.message);
    res.status(502).json({ success: false, error: err.response?.data?.msg || err.message });
  }
});

// ── Generate environment only (background extraction) ────────────────────────
router.post('/environment/generate', async (req, res) => {
  const { imageBase64 } = req.body;
  if (!imageBase64) return res.status(400).json({ success: false, error: 'Загрузите изображение' });
  try {
    const imageUrl = await uploadToPublicHost(Buffer.from(imageBase64, 'base64'));
    const taskId   = await createNanoBananaTask(getPrompt('EXTRACT_BG_PROMPT'), imageUrl, '9:16');
    addPendingTask(taskId, 'environments', 'env', 'environment');
    res.json({ success: true, taskId });
  } catch (err) {
    console.error('[environment/generate]', err.response?.data || err.message);
    res.status(502).json({ success: false, error: err.response?.data?.msg || err.message });
  }
});

// ── Poll tasks ────────────────────────────────────────────────────────────────
router.get('/lookbook/status/:taskId', async (req, res) => {
  try {
    const result = await resolveTask(req.params.taskId, LOOKBOOKS_DIR, 'lookbook');
    if (result.state === 'success' || result.state === 'failed') removePendingTask(req.params.taskId);
    res.json({ success: true, ...result });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

router.get('/environment/status/:taskId', async (req, res) => {
  try {
    const result = await resolveTask(req.params.taskId, ENVIRONMENTS_DIR, 'env');
    if (result.state === 'success' || result.state === 'failed') removePendingTask(req.params.taskId);
    res.json({ success: true, ...result });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// ── Apply lookbook to character ───────────────────────────────────────────────
router.post('/apply-lookbook', async (req, res) => {
  const { characterBase64, lookbookPath, imageEngine } = req.body;
  if (!characterBase64 || !lookbookPath)
    return res.status(400).json({ success: false, error: 'Нужны изображение персонажа и лукбук' });

  const lbAbs = path.join(__dirname, '..', lookbookPath.replace(/^\//, ''));
  if (!fs.existsSync(lbAbs))
    return res.status(400).json({ success: false, error: 'Файл лукбука не найден' });

  try {
    const [charUrl, lbUrl] = await Promise.all([
      uploadToPublicHost(Buffer.from(characterBase64, 'base64')),
      uploadToPublicHost(fs.readFileSync(lbAbs)),
    ]);
    const prompt = getPrompt('APPLY_LOOKBOOK_PROMPT');
    const taskId = await createMultiRefEditTask(imageEngine, prompt, [charUrl, lbUrl], '9:16', null, {});
    if (!taskId) return res.status(502).json({ success: false, error: 'kie.ai не вернул taskId' });
    addPendingTask(taskId, 'uploads', 'applied', 'apply-lookbook');
    res.json({ success: true, taskId });
  } catch (err) {
    console.error('[apply-lookbook]', err.response?.data || err.message);
    res.status(502).json({ success: false, error: err.response?.data?.msg || err.message });
  }
});

router.get('/apply-lookbook/status/:taskId', async (req, res) => {
  try {
    const result = await resolveTask(req.params.taskId, UPLOADS_DIR, 'applied');
    if (result.state === 'success' || result.state === 'failed') removePendingTask(req.params.taskId);
    res.json({ success: true, ...result });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// ── Apply environment to character ────────────────────────────────────────────
router.post('/apply-environment', async (req, res) => {
  const { characterBase64, environmentPath, imageEngine } = req.body;
  if (!characterBase64 || !environmentPath)
    return res.status(400).json({ success: false, error: 'Нужны изображение персонажа и окружение' });

  const envAbs = path.join(__dirname, '..', environmentPath.replace(/^\//, ''));
  if (!fs.existsSync(envAbs))
    return res.status(400).json({ success: false, error: 'Файл окружения не найден' });

  try {
    const [charUrl, envUrl] = await Promise.all([
      uploadToPublicHost(Buffer.from(characterBase64, 'base64')),
      uploadToPublicHost(fs.readFileSync(envAbs)),
    ]);
    const prompt = getPrompt('APPLY_ENV_PROMPT');
    const taskId = await createMultiRefEditTask(imageEngine, prompt, [charUrl, envUrl], '9:16', null, {});
    if (!taskId) return res.status(502).json({ success: false, error: 'kie.ai не вернул taskId' });
    addPendingTask(taskId, 'uploads', 'env_applied', 'apply-environment');
    res.json({ success: true, taskId });
  } catch (err) {
    console.error('[apply-environment]', err.response?.data || err.message);
    res.status(502).json({ success: false, error: err.response?.data?.msg || err.message });
  }
});

router.get('/apply-environment/status/:taskId', async (req, res) => {
  try {
    const result = await resolveTask(req.params.taskId, UPLOADS_DIR, 'env_applied');
    if (result.state === 'success' || result.state === 'failed') removePendingTask(req.params.taskId);
    res.json({ success: true, ...result });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// ── Обринж: generate t-pose + clothing + environment in parallel ──────────────
router.post('/obrinj/generate', async (req, res) => {
  const { imageBase64 } = req.body;
  if (!imageBase64) return res.status(400).json({ success: false, error: 'Загрузите изображение' });

  let imageUrl;
  try {
    imageUrl = await uploadToPublicHost(Buffer.from(imageBase64, 'base64'));
    const [tposeTaskId, clothingTaskId, envTaskId] = await Promise.all([
      createNanoBananaTask(getPrompt('TPOSE_PROMPT'),            imageUrl, '1:1'),
      createNanoBananaTask(getPrompt('EXTRACT_CLOTHING_PROMPT'), imageUrl, '9:16'),
      createNanoBananaTask(getPrompt('EXTRACT_BG_PROMPT_SQ'),    imageUrl, '9:16'),
    ]);
    addPendingTask(tposeTaskId,    'characters', 'tpose',   'tpose');
    addPendingTask(clothingTaskId, 'lookbooks',  'lookbook','lookbook');
    addPendingTask(envTaskId,      'environments','env',    'environment');
    res.json({ success: true, tposeTaskId, clothingTaskId, envTaskId });
  } catch (err) {
    console.error('[obrinj/generate]', err.response?.data || err.message);
    res.status(502).json({ success: false, error: err.response?.data?.msg || err.message });
  }
});

// T-pose result saves to CHARACTERS_DIR
router.get('/obrinj/tpose/status/:taskId', async (req, res) => {
  try {
    const result = await resolveTask(req.params.taskId, CHARACTERS_DIR, 'tpose');
    if (result.state === 'success' || result.state === 'failed') removePendingTask(req.params.taskId);
    res.json({ success: true, ...result });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

module.exports = router;
