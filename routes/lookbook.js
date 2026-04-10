'use strict';

const express = require('express');
const path    = require('path');
const fs      = require('fs');
const axios   = require('axios');
const router  = express.Router();

const { KIE_BASE, LOOKBOOKS_DIR, ENVIRONMENTS_DIR, CHARACTERS_DIR, UPLOADS_DIR,
        EXTRACT_CLOTHING_PROMPT, EXTRACT_BG_PROMPT, APPLY_LOOKBOOK_PROMPT, APPLY_ENV_PROMPT,
        TPOSE_PROMPT, EXTRACT_BG_PROMPT_SQ } = require('../lib/config');
const { kieHeaders, uploadToPublicHost, createNanoBananaTask, resolveTask } = require('../lib/helpers');

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
router.post('/lookbook/generate', async (req, res) => {
  const { imageBase64 } = req.body;
  if (!imageBase64) return res.status(400).json({ success: false, error: 'Загрузите изображение' });
  try {
    const imageUrl = await uploadToPublicHost(Buffer.from(imageBase64, 'base64'));
    const [clothingTaskId, bgTaskId] = await Promise.all([
      createNanoBananaTask(EXTRACT_CLOTHING_PROMPT, imageUrl, '1:1'),
      createNanoBananaTask(EXTRACT_BG_PROMPT,       imageUrl, '16:9'),
    ]);
    res.json({ success: true, clothingTaskId, bgTaskId });
  } catch (err) {
    console.error('[lookbook/generate]', err.response?.data || err.message);
    res.status(502).json({ success: false, error: err.response?.data?.msg || err.message });
  }
});

// ── Poll tasks ────────────────────────────────────────────────────────────────
router.get('/lookbook/status/:taskId', async (req, res) => {
  try {
    res.json({ success: true, ...(await resolveTask(req.params.taskId, LOOKBOOKS_DIR, 'lookbook')) });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

router.get('/environment/status/:taskId', async (req, res) => {
  try {
    res.json({ success: true, ...(await resolveTask(req.params.taskId, ENVIRONMENTS_DIR, 'env')) });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// ── Apply lookbook to character ───────────────────────────────────────────────
router.post('/apply-lookbook', async (req, res) => {
  const { characterBase64, lookbookPath } = req.body;
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
    const taskRes = await axios.post(
      `${KIE_BASE}/api/v1/jobs/createTask`,
      { model: 'nano-banana-2', input: { prompt: APPLY_LOOKBOOK_PROMPT, image_input: [charUrl, lbUrl], aspect_ratio: '9:16', resolution: '1K', output_format: 'jpg' } },
      { headers: kieHeaders(), timeout: 30000 }
    );
    const taskId = taskRes.data?.data?.taskId;
    if (!taskId) return res.status(502).json({ success: false, error: 'kie.ai не вернул taskId', detail: taskRes.data });
    res.json({ success: true, taskId });
  } catch (err) {
    console.error('[apply-lookbook]', err.response?.data || err.message);
    res.status(502).json({ success: false, error: err.response?.data?.msg || err.message });
  }
});

router.get('/apply-lookbook/status/:taskId', async (req, res) => {
  try {
    res.json({ success: true, ...(await resolveTask(req.params.taskId, UPLOADS_DIR, 'applied')) });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// ── Apply environment to character ────────────────────────────────────────────
router.post('/apply-environment', async (req, res) => {
  const { characterBase64, environmentPath } = req.body;
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
    const taskRes = await axios.post(
      `${KIE_BASE}/api/v1/jobs/createTask`,
      { model: 'nano-banana-2', input: { prompt: APPLY_ENV_PROMPT, image_input: [charUrl, envUrl], aspect_ratio: '9:16', resolution: '4K', output_format: 'jpg' } },
      { headers: kieHeaders(), timeout: 30000 }
    );
    const taskId = taskRes.data?.data?.taskId;
    if (!taskId) return res.status(502).json({ success: false, error: 'kie.ai не вернул taskId' });
    res.json({ success: true, taskId });
  } catch (err) {
    console.error('[apply-environment]', err.response?.data || err.message);
    res.status(502).json({ success: false, error: err.response?.data?.msg || err.message });
  }
});

router.get('/apply-environment/status/:taskId', async (req, res) => {
  try {
    res.json({ success: true, ...(await resolveTask(req.params.taskId, UPLOADS_DIR, 'env_applied')) });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

// ── Обринж: generate t-pose + clothing + environment in parallel ──────────────
router.post('/obrinj/generate', async (req, res) => {
  const { imageBase64 } = req.body;
  if (!imageBase64) return res.status(400).json({ success: false, error: 'Загрузите изображение' });
  try {
    const imageUrl = await uploadToPublicHost(Buffer.from(imageBase64, 'base64'));
    const [tposeTaskId, clothingTaskId, envTaskId] = await Promise.all([
      createNanoBananaTask(TPOSE_PROMPT,          imageUrl, '1:1'),
      createNanoBananaTask(EXTRACT_CLOTHING_PROMPT, imageUrl, '1:1'),
      createNanoBananaTask(EXTRACT_BG_PROMPT_SQ,  imageUrl, '1:1'),
    ]);
    res.json({ success: true, tposeTaskId, clothingTaskId, envTaskId });
  } catch (err) {
    console.error('[obrinj/generate]', err.response?.data || err.message);
    res.status(502).json({ success: false, error: err.response?.data?.msg || err.message });
  }
});

// T-pose result saves to CHARACTERS_DIR
router.get('/obrinj/tpose/status/:taskId', async (req, res) => {
  try {
    res.json({ success: true, ...(await resolveTask(req.params.taskId, CHARACTERS_DIR, 'tpose')) });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

module.exports = router;
