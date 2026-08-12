'use strict';

const express = require('express');
const path    = require('path');
const fs      = require('fs');
const router  = express.Router();

const { LOOKBOOKS_DIR, ENVIRONMENTS_DIR } = require('../lib/config');
const { uploadToPublicHost, createNanoBananaTask, createQwen2Task, createGptImage2Task,
  createSeedream5LiteTask, createSeedream45Task, resolveTask } = require('../lib/helpers');
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
    const imageUrl = await uploadToPublicHost(Buffer.from(imageBase64, 'base64'), { skipOwnHost: true });
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


// Everything between the generator and these polls has gone: the lookbook mixer, the
// text-to-candidate flow, promote, environment generate/compose, apply-lookbook,
// apply-environment and the whole obrinj t-pose path. Ten endpoints, all of them reached
// only from the old Character page, which is deleted. Checked against every surviving
// script: the only mentions left were rows in the log-panel label table.

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

module.exports = router;
