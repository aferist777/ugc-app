'use strict';

const express = require('express');
const path    = require('path');
const fs      = require('fs');
const axios   = require('axios');
const router  = express.Router();

const { KIE_BASE, LOOKBOOKS_DIR, ENVIRONMENTS_DIR, CHARACTERS_DIR, UPLOADS_DIR } = require('../lib/config');
const { kieHeaders, uploadToPublicHost, createNanoBananaTask, createQwen2Task, createGptImage2Task, createSeedream5LiteTask, createSeedream45Task, createMultiRefEditTask, resolveTask, callAIVisionWithFallback,
  createNanoBananaProTextTask, createQwen2TextTask, createGptImage2TextTask, createSeedream5LiteTextTask, createSeedream45TextTask, callAI, parseLooseJson } = require('../lib/helpers');
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
  const { paths, imageEngine, refine } = req.body;
  if (!Array.isArray(paths) || paths.length < 2)
    return res.status(400).json({ success: false, error: 'Select at least 2 lookbooks to mix' });

  // Cap at 5 references sent to the generator (engine input limit); the images
  // stay in the user's SELECTION ORDER so "image 1/2/3" in the refine text lines up.
  const rels = paths.slice(0, 5).map(p => String(p).replace(/^\//, ''));
  const abs  = rels.map(r => path.join(__dirname, '..', r));
  for (const a of abs) if (!fs.existsSync(a)) return res.status(400).json({ success: false, error: 'Lookbook file not found: ' + a });

  try {
    const urls = await Promise.all(abs.map(a => uploadToPublicHost(fs.readFileSync(a))));
    const refineTxt = String(refine || '').trim();

    // 1) Vision: compose a single mixed-outfit description from all selected lookbooks,
    //    honoring the user's per-image instructions when a refine text is provided.
    const content = [{ type: 'text', text:
      `You are a fashion stylist. You are given ${urls.length} clothing lookbook images in the user's chosen order (image 1 = first picked, image ${urls.length} = last). Each shows an outfit or a set of clothing items. `
      + (refineTxt
          ? `The user wants this specific blend (they may reference the images by order, e.g. "the jacket from the first, the trousers from the second"): "${refineTxt.slice(0, 500)}". Follow these instructions as closely as possible, pulling the named pieces from the correct images; fill any gaps with coherent choices. `
          : `Study every image, then design ONE new cohesive, stylish outfit that mixes the strongest pieces across them, making sure colours and styles work together. `)
      + `Reply with ONE compact English paragraph (max ~90 words) describing the final combined outfit item by item - garment type, colour, material, print/pattern and notable details - written as an image-generation prompt. When useful, note the source like "the leather jacket from image 2". `
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

// ── Text -> lookbook candidates (Phase B) ─────────────────────────────────────
// Generate N square lookbook flat-lays from a text prompt. count>1 -> beautify +
// multiply the prompt into N distinct variants first. Candidates land in uploads/
// (NOT the base) and are promoted to the base only via /lookbook/promote (Save).
const _LOOKBOOK_STYLE_TAIL =
  ' Present it as a clean flat-lay clothing LOOKBOOK: all garments and accessories laid out flat and clearly separated on a plain neutral light-grey studio background. '
  + 'No person, no mannequin, no body, no hanger, no text, no labels, no watermark. Clean product photography, soft even lighting, sharp focus, high detail, 1:1 square format.';
function _textTask(engine, prompt) {
  if (engine === 'qwen2')       return createQwen2TextTask(prompt, '1:1');
  if (engine === 'seedream')    return createSeedream5LiteTextTask(prompt, '1:1');
  if (engine === 'seedream4.5') return createSeedream45TextTask(prompt, '1:1');
  if (engine === 'gptimage2')   return createGptImage2TextTask(prompt, '1:1');
  return createNanoBananaProTextTask(prompt, '1:1');   // nano-banana-pro (text) / default
}
async function _multiplyPrompts(userPrompt, count) {
  if (count <= 1) return [userPrompt];
  const ask = `You are a fashion prompt writer. The user described an outfit/lookbook to generate: "${userPrompt}". `
    + `Produce ${count} DISTINCT vivid image-generation prompts, each describing ONE complete cohesive outfit that fits the user's idea but varies the pieces, colours and styling so the ${count} options feel clearly different. `
    + `Reply as strict JSON only: {"prompts":[${Array.from({length:count},()=>'"..."').join(',')}]} with exactly ${count} strings, each <= 60 words, no numbering.`;
  try {
    const raw = await callAI([{ role: 'user', content: ask }], { timeout: 45000 });
    const j = parseLooseJson(raw);
    if (j && Array.isArray(j.prompts) && j.prompts.length) return j.prompts.slice(0, count).map(String);
  } catch (e) { console.warn('[lookbook/compose] multiply failed:', e.message); }
  return Array.from({ length: count }, () => userPrompt);   // fallback: same prompt (engine seed varies output)
}
router.post('/lookbook/compose', async (req, res) => {
  const { prompt, count, imageEngine } = req.body || {};
  const p = String(prompt || '').trim();
  if (!p) return res.status(400).json({ success: false, error: 'Describe an outfit to generate' });
  const n = Math.max(1, Math.min(5, parseInt(count, 10) || 1));
  try {
    const prompts = await _multiplyPrompts(p, n);
    const taskIds = [];
    for (const pr of prompts) {
      const tid = await _textTask(imageEngine, String(pr) + _LOOKBOOK_STYLE_TAIL);
      if (tid) { addPendingTask(tid, 'uploads', 'lbcand', 'lookbook-candidate'); taskIds.push(tid); }
    }
    if (!taskIds.length) return res.status(502).json({ success: false, error: 'engine returned no taskId' });
    res.json({ success: true, taskIds, prompts });
  } catch (err) {
    console.error('[lookbook/compose]', err.response?.data || err.message);
    res.status(502).json({ success: false, error: err.response?.data?.msg || err.message });
  }
});

// Extract a lookbook FROM a photo as a candidate (uploads/, not the base). An
// optional prompt folds clothing-only user steering into the extraction.
router.post('/lookbook/extract-candidate', async (req, res) => {
  const { imageBase64, prompt, imageEngine } = req.body || {};
  if (!imageBase64) return res.status(400).json({ success: false, error: 'Upload a photo' });
  try {
    const imageUrl = await uploadToPublicHost(Buffer.from(imageBase64, 'base64'));
    let exPrompt = getPrompt('EXTRACT_CLOTHING_PROMPT');
    const userTxt = String(prompt || '').trim();
    if (userTxt) exPrompt = exPrompt + ' Also apply these clothing-only adjustments to the extracted outfit: ' + userTxt + '.';
    const taskId = await _extractTask(imageEngine, exPrompt, imageUrl);
    if (!taskId) return res.status(502).json({ success: false, error: 'engine returned no taskId' });
    addPendingTask(taskId, 'uploads', 'lbcand', 'lookbook-candidate');
    res.json({ success: true, taskId });
  } catch (err) {
    console.error('[lookbook/extract-candidate]', err.response?.data || err.message);
    res.status(502).json({ success: false, error: err.response?.data?.msg || err.message });
  }
});

// Poll a lookbook candidate (saved into uploads/).
router.get('/lookbook/candidate/status/:taskId', async (req, res) => {
  try {
    const result = await resolveTask(req.params.taskId, UPLOADS_DIR, 'lbcand');
    if (result.state === 'success' || result.state === 'failed') removePendingTask(req.params.taskId);
    res.json({ success: true, ...result });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// Promote a candidate (uploads/) into the lookbook base (Save lookbook).
router.post('/lookbook/promote', (req, res) => {
  const rel = String((req.body && req.body.path) || '').replace(/^\//, '').split('?')[0];
  if (!rel || !/^uploads\//.test(rel)) return res.status(400).json({ success: false, error: 'invalid candidate path' });
  const srcAbs = path.join(__dirname, '..', rel);
  if (!fs.existsSync(srcAbs)) return res.status(404).json({ success: false, error: 'candidate file missing' });
  try {
    const filename = path.basename(srcAbs);
    if (!fs.existsSync(LOOKBOOKS_DIR)) fs.mkdirSync(LOOKBOOKS_DIR, { recursive: true });
    fs.copyFileSync(srcAbs, path.join(LOOKBOOKS_DIR, filename));
    const baseNoExt = filename.replace(/\.[^.]+$/, '');
    const thumbSrc  = path.join(path.dirname(srcAbs), 'thumbs', baseNoExt + '.jpg');
    if (fs.existsSync(thumbSrc)) {
      try { const td = path.join(LOOKBOOKS_DIR, 'thumbs'); if (!fs.existsSync(td)) fs.mkdirSync(td, { recursive: true }); fs.copyFileSync(thumbSrc, path.join(td, baseNoExt + '.jpg')); } catch {}
    }
    res.json({ success: true, path: '/lookbooks/' + filename });
  } catch (err) {
    console.error('[lookbook/promote]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Generate environment from a photo (extract the setting) ──────────────────
// Uses EXTRACT_ENV_PROMPT, which keeps the source photo's camera angle + colour
// grading. Lands directly in the environments pool (auto-save).
router.post('/environment/generate', async (req, res) => {
  const { imageBase64 } = req.body;
  if (!imageBase64) return res.status(400).json({ success: false, error: 'Загрузите изображение' });
  try {
    const imageUrl = await uploadToPublicHost(Buffer.from(imageBase64, 'base64'));
    const taskId   = await createNanoBananaTask(getPrompt('EXTRACT_ENV_PROMPT'), imageUrl, '9:16');
    addPendingTask(taskId, 'environments', 'env', 'environment');
    res.json({ success: true, taskId });
  } catch (err) {
    console.error('[environment/generate]', err.response?.data || err.message);
    res.status(502).json({ success: false, error: err.response?.data?.msg || err.message });
  }
});

// ── Text -> environment (generate a location from a description) ──────────────
// Lands directly in the environments pool (auto-save, no separate promote). 9:16.
const _ENV_STYLE_TAIL =
  ' Render it as an EMPTY location background: a photorealistic real-world environment / scene with NO people, no characters, no text, no watermark. '
  + 'Natural coherent lighting and depth; leave clear foreground space where a person could later stand. 9:16 VERTICAL full-frame composition (fill the entire tall frame edge-to-edge, no borders, no letterboxing), high detail, sharp focus.';
function _envTextTask(engine, prompt) {
  if (engine === 'qwen2')       return createQwen2TextTask(prompt, '9:16');
  if (engine === 'seedream')    return createSeedream5LiteTextTask(prompt, '9:16');
  if (engine === 'seedream4.5') return createSeedream45TextTask(prompt, '9:16');
  if (engine === 'gptimage2')   return createGptImage2TextTask(prompt, '9:16');
  return createNanoBananaProTextTask(prompt, '9:16');   // nano-banana-pro (text) / default
}
router.post('/environment/compose', async (req, res) => {
  const { prompt, imageEngine } = req.body || {};
  const p = String(prompt || '').trim();
  if (!p) return res.status(400).json({ success: false, error: 'Describe an environment to generate' });
  try {
    const taskId = await _envTextTask(imageEngine, p + _ENV_STYLE_TAIL);
    if (!taskId) return res.status(502).json({ success: false, error: 'engine returned no taskId' });
    addPendingTask(taskId, 'environments', 'env', 'environment');
    res.json({ success: true, taskId });
  } catch (err) {
    console.error('[environment/compose]', err.response?.data || err.message);
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
