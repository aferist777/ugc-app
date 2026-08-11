'use strict';

// CHARACTER v2 — generating from a reference.
//
// Two steps, deliberately two requests. The analyzer runs first and can REFUSE, and a refusal
// should cost nothing: no engine call, no image, no wait. It also lets the page say "Analyzing"
// and then "Generating" instead of one long silence.
//
//   POST /api/character-v2/analyze    reference + the user's text -> prompt material, or a refusal
//   POST /api/character-v2/generate   a ready prompt + the reference -> an i2i task
//   GET  /api/character-v2/engines    which engines and quality tiers exist, from one place
//
// The page assembles the final prompt between the two calls. That is on purpose: the house
// template (framing, backdrop, wardrobe, realism) already lives in the page's presets.js and is
// what Create sends, so building the reference prompt from the same module keeps one definition
// of the house look instead of a server-side copy that drifts.
//
// Every engine here is one that can do 3:2 AND take an input image, which is what the flow
// needs; z-image-turbo is absent for the second reason, not the first.

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

const { ROOT_DIR } = require('../lib/config');
const {
  uploadToPublicHost, callAIVisionWithFallback, getImgVisionModel, parseLooseJson,
  createNanoBananaProTask, createSeedream45Task, createSeedream5LiteTask,
  createGptImage2Task, createFlux2MaxTask,
} = require('../lib/helpers');
const { getPrompt } = require('../lib/prompts');
const { addPendingTask } = require('../lib/pending-tasks');

// Tiers are each model's OWN vocabulary, read from its Replicate schema rather than invented:
// nano-banana-2 speaks 1K/2K/4K, seedream-4.5 only 2K/4K, seedream-5-lite 2K/3K, gpt-image-2
// grades by effort, flux-2-max counts megapixels. Offering a tier a model does not have would
// be a 422 at submit time, so the page is given this list instead of a guess.
const ENGINES = {
  'nano-banana-2': {
    label: 'nano-banana-2', tiers: ['1K', '2K', '4K'], def: '2K',
    submit: (p, url, aspect, q) => createNanoBananaProTask(p, url, aspect, { resolution: q }),
  },
  'seedream4.5': {
    label: 'seedream-4.5', tiers: ['2K', '4K'], def: '2K',
    submit: (p, url, aspect, q) => createSeedream45Task(p, [url], aspect, null, { size: q }),
  },
  'seedream': {
    label: 'seedream-5-lite', tiers: ['2K', '3K'], def: '2K',
    submit: (p, url, aspect, q) => createSeedream5LiteTask(p, [url], aspect, null, { size: q }),
  },
  'gptimage2': {
    label: 'gpt-image-2', tiers: ['low', 'medium', 'high'], def: 'high',
    submit: (p, url, aspect, q) => createGptImage2Task(p, [url], aspect, { quality: q }),
  },
  'flux-2-max': {
    label: 'flux-2-max', tiers: ['0.5 MP', '1 MP', '2 MP', '4 MP'], def: '2 MP',
    submit: (p, url, aspect, q) => createFlux2MaxTask(p, [url], aspect, { resolution: q }),
  },
};
const DEFAULT_ENGINE = 'nano-banana-2';

// Only the two the flow has a meaning for: 3:2 converts a reference into the house format, and
// match_input_image edits a photo where it stands. Anything else would be a request the design
// cannot honour, so it is not accepted rather than quietly mapped.
const ASPECTS = ['3:2', 'match_input_image'];

// A reference has to become a URL: the vision model and the image engines both fetch one. A
// TPDNE face and an upload arrive as base64 and exist on no disk, so they go to imgbb - host 2
// in the rotation and the first real one once own-server is skipped, which it must be: our
// :3000 is unreachable to Replicate's fetchers.
async function _refUrl(body) {
  if (body.imageUrl && /^https?:\/\//i.test(String(body.imageUrl))) return String(body.imageUrl);
  let buf = null;
  if (body.imageBase64) {
    buf = Buffer.from(String(body.imageBase64).replace(/^data:image\/[\w+.-]+;base64,/, ''), 'base64');
    if (!buf.length) throw new Error('imageBase64 is empty');
  } else if (body.imagePath) {
    const abs = path.join(ROOT_DIR, String(body.imagePath).replace(/^\/+/, ''));
    if (!fs.existsSync(abs)) throw new Error('reference image not found: ' + body.imagePath);
    buf = fs.readFileSync(abs);
  } else {
    throw new Error('no reference image was sent');
  }
  return await uploadToPublicHost(buf, { skipOwnHost: true });
}

// ── GET /api/character-v2/engines ────────────────────────────────────────────
router.get('/character-v2/engines', (_req, res) => {
  res.json({
    success: true,
    default: DEFAULT_ENGINE,
    engines: Object.entries(ENGINES).map(([id, e]) => ({ id, label: e.label, tiers: e.tiers, def: e.def })),
  });
});

// ── POST /api/character-v2/analyze ───────────────────────────────────────────
// Body: { imageUrl | imageBase64 | imagePath, text }
// -> { ok: true,  who, change, imageUrl }   prompt material, the change folded into `who`
// -> { ok: false, reason, imageUrl }        the request was outside what this step may do
//
// imageUrl comes back either way so the generate call reuses the upload instead of paying for
// it twice. The user's text never reaches the generator: only what the analyzer made of it.
router.post('/character-v2/analyze', async (req, res) => {
  try {
    const b = req.body || {};
    const text = String(b.text || '').trim();
    const imageUrl = await _refUrl(b);

    const prompt = String(getPrompt('CV2_APPEARANCE_PROMPT') || '').replace(/\{USER_TEXT\}/g, text);
    const raw = await callAIVisionWithFallback([{
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: imageUrl } },
      ],
    }], { timeout: 45000, useOpenRouter: true, openRouterModel: getImgVisionModel() });

    const j = parseLooseJson(raw);
    if (!j || typeof j !== 'object') {
      console.warn('[cv2/analyze] unparsable answer:', String(raw || '').slice(0, 200));
      throw new Error('the analyzer did not answer with JSON');
    }
    if (j.ok === false) {
      const reason = String(j.reason || '').trim() || 'That change cannot be applied to this image.';
      console.log('[cv2/analyze] refused:', reason);
      return res.json({ success: true, ok: false, reason, imageUrl });
    }
    const who = String(j.who || '').trim();
    if (!who) throw new Error('the analyzer returned no description');
    const change = String(j.change || '').trim();
    console.log('[cv2/analyze] who:', who.slice(0, 120), change ? ('| change: ' + change) : '| no change asked');
    res.json({ success: true, ok: true, who, change, imageUrl });
  } catch (err) {
    console.error('[cv2/analyze]', err.response?.data || err.message);
    res.status(502).json({ success: false, error: err.response?.data?.msg || err.message });
  }
});

// ── POST /api/character-v2/generate ──────────────────────────────────────────
// Body: { prompt, imageUrl | imageBase64 | imagePath, engine?, quality?, aspect? }
// -> { taskId }, which the page polls through the shared GET /api/status/:taskId
router.post('/character-v2/generate', async (req, res) => {
  try {
    const b = req.body || {};
    const prompt = String(b.prompt || '').trim();
    if (!prompt) return res.status(400).json({ success: false, error: 'prompt is required' });

    const engineKey = ENGINES[b.engine] ? b.engine : DEFAULT_ENGINE;
    const eng = ENGINES[engineKey];
    const quality = eng.tiers.includes(b.quality) ? b.quality : eng.def;
    const aspect = ASPECTS.includes(b.aspect) ? b.aspect : '3:2';

    const imageUrl = await _refUrl(b);
    const taskId = await eng.submit(prompt, imageUrl, aspect, quality);
    if (!taskId) return res.status(502).json({ success: false, error: 'the engine returned no taskId' });

    // Same bucket as the text-to-image path, so the page's existing polling resolves it.
    addPendingTask(taskId, 'uploads', 'generated', 'cv2-reference');
    console.log('[cv2/generate]', engineKey, quality, aspect, '| prompt:', prompt.slice(0, 120));
    res.json({ success: true, taskId, engine: engineKey, quality, aspect });
  } catch (err) {
    console.error('[cv2/generate]', err.response?.data || err.message);
    res.status(502).json({ success: false, error: err.response?.data?.msg || err.message });
  }
});

module.exports = router;
