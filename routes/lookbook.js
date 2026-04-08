'use strict';

const express = require('express');
const path    = require('path');
const fs      = require('fs');
const axios   = require('axios');
const router  = express.Router();

const { KIE_BASE, LOOKBOOKS_DIR, ENVIRONMENTS_DIR, UPLOADS_DIR,
        EXTRACT_CLOTHING_PROMPT, EXTRACT_BG_PROMPT, APPLY_LOOKBOOK_PROMPT, APPLY_ENV_PROMPT } = require('../lib/config');
const { kieHeaders, uploadToPublicHost, createNanoBananaTask, resolveTask } = require('../lib/helpers');

// ── List lookbooks ────────────────────────────────────────────────────────────
router.get('/lookbooks', (_req, res) => {
  const files = fs.readdirSync(LOOKBOOKS_DIR)
    .filter(f => /\.(jpg|jpeg|png)$/i.test(f))
    .map(f => ({ name: f, mtime: fs.statSync(path.join(LOOKBOOKS_DIR, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)
    .map(f => `/lookbooks/${f.name}`);
  res.json({ success: true, files });
});

// ── List environments ─────────────────────────────────────────────────────────
router.get('/environments', (_req, res) => {
  const files = fs.readdirSync(ENVIRONMENTS_DIR)
    .filter(f => /\.(jpg|jpeg|png)$/i.test(f))
    .map(f => ({ file: f, mtime: fs.statSync(path.join(ENVIRONMENTS_DIR, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)
    .map(({ file }) => `/environments/${file}`);
  res.json({ success: true, files });
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

module.exports = router;
