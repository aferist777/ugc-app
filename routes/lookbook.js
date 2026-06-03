'use strict';

const express = require('express');
const path    = require('path');
const fs      = require('fs');
const axios   = require('axios');
const router  = express.Router();

const { KIE_BASE, LOOKBOOKS_DIR, ENVIRONMENTS_DIR, CHARACTERS_DIR, UPLOADS_DIR } = require('../lib/config');
const { kieHeaders, uploadToPublicHost, createNanoBananaTask, createQwen2Task, createGptImage2Task, createSeedream5LiteTask, resolveTask } = require('../lib/helpers');
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
    let taskId;
    if (imageEngine === 'qwen2') {
      taskId = await createQwen2Task(prompt, charUrl, '9:16');
    } else if (imageEngine === 'seedream') {
      taskId = await createSeedream5LiteTask(prompt, [charUrl, lbUrl], '9:16', 'basic');
    } else if (imageEngine === 'gptimage2') {
      taskId = await createGptImage2Task(prompt, [charUrl, lbUrl], '9:16');
    } else {
      const taskRes = await axios.post(
        `${KIE_BASE}/api/v1/jobs/createTask`,
        { model: 'nano-banana-2', input: { prompt, image_input: [charUrl, lbUrl], aspect_ratio: '9:16', resolution: '1K', output_format: 'jpg' } },
        { headers: kieHeaders(), timeout: 30000 }
      );
      taskId = taskRes.data?.data?.taskId;
    }
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
    let taskId;
    if (imageEngine === 'qwen2') {
      taskId = await createQwen2Task(prompt, charUrl, '9:16');
    } else if (imageEngine === 'seedream') {
      taskId = await createSeedream5LiteTask(prompt, [charUrl, envUrl], '9:16', 'basic');
    } else if (imageEngine === 'gptimage2') {
      taskId = await createGptImage2Task(prompt, [charUrl, envUrl], '9:16');
    } else {
      const taskRes = await axios.post(
        `${KIE_BASE}/api/v1/jobs/createTask`,
        { model: 'nano-banana-2', input: { prompt, image_input: [charUrl, envUrl], aspect_ratio: '9:16', resolution: '4K', output_format: 'jpg' } },
        { headers: kieHeaders(), timeout: 30000 }
      );
      taskId = taskRes.data?.data?.taskId;
    }
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
