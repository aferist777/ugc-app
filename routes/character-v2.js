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
  createGptImage2Task, createFlux2MaxTask, createZImageTurboTask,
} = require('../lib/helpers');
const { getPrompt } = require('../lib/prompts');
const { addPendingTask } = require('../lib/pending-tasks');

// Every engine here can do 3:2 - checked against each model's Replicate schema, not assumed -
// because the whole page is built on that one ratio. Tiers are each model's OWN vocabulary from
// the same schemas: nano-banana-2 speaks 1K/2K/4K, seedream-4.5 only 2K/4K, seedream-5-lite
// 2K/3K, gpt-image-2 grades by effort, flux-2-max counts megapixels. Offering a tier a model
// does not have would be a 422 at submit time, so the page is handed this list instead of a
// guess, and it is the only place the list exists.
//
// z-image-turbo has no named tiers at all: it takes a width and a height, capped at 2048, so its
// tiers are spelled out as exact 3:2 pixel sizes. It also has no image input, hence t2i only -
// which is why the reference path cannot use it however fast it is.
const ENGINES = {
  'z-turbo': {
    label: 'z-image-turbo', tiers: ['1K', '2K'], def: '1K', t2i: true, i2i: false,
    // Asked as exact 3:2. 1152x768 comes back exactly that; the 2K request does NOT - the model
    // snaps to its own resolution grid and returns 2048x1360 (1.5059) whatever it is handed,
    // verified by asking for 2046x1364 and 2016x1344 and getting the same answer twice. A 0.4%
    // deviation is invisible, and cropping every generation to fix it would buy nothing, so the
    // request states the intent and the model has the last word. 4K is out: the cap is 2048.
    wh: { '1K': [1152, 768], '2K': [2016, 1344] },
    text: (p, _aspect, q, e) => createZImageTurboTask(p, { width: e.wh[q][0], height: e.wh[q][1] }),
  },
  'nano-banana-2': {
    label: 'nano-banana-2', tiers: ['1K', '2K', '4K'], def: '2K', t2i: true, i2i: true,
    edit: (p, url, aspect, q) => createNanoBananaProTask(p, url, aspect, { resolution: q }),
    text: (p, aspect, q) => createNanoBananaProTask(p, null, aspect, { resolution: q }),
  },
  'seedream4.5': {
    label: 'seedream-4.5', tiers: ['2K', '4K'], def: '2K', t2i: true, i2i: true,
    edit: (p, url, aspect, q) => createSeedream45Task(p, [url], aspect, null, { size: q }),
    text: (p, aspect, q) => createSeedream45Task(p, null, aspect, undefined, { size: q }),
  },
  'seedream': {
    label: 'seedream-5-lite', tiers: ['2K', '3K'], def: '2K', t2i: true, i2i: true,
    edit: (p, url, aspect, q) => createSeedream5LiteTask(p, [url], aspect, null, { size: q }),
    text: (p, aspect, q) => createSeedream5LiteTask(p, null, aspect, undefined, { size: q }),
  },
  'gptimage2': {
    label: 'gpt-image-2', tiers: ['low', 'medium', 'high'], def: 'high', t2i: true, i2i: true,
    edit: (p, url, aspect, q) => createGptImage2Task(p, [url], aspect, { quality: q }),
    text: (p, aspect, q) => createGptImage2Task(p, null, aspect, { quality: q }),
  },
  'flux-2-max': {
    label: 'flux-2-max', tiers: ['0.5 MP', '1 MP', '2 MP', '4 MP'], def: '2 MP', t2i: true, i2i: true,
    edit: (p, url, aspect, q) => createFlux2MaxTask(p, [url], aspect, { resolution: q }),
    text: (p, aspect, q) => createFlux2MaxTask(p, null, aspect, { resolution: q }),
  },
};
const DEFAULT_T2I = 'z-turbo';          // fast and cheap, and Create runs often
const DEFAULT_I2I = 'nano-banana-2';    // 3:2, real 1K/2K/4K tiers, already the house edit engine

// Only the two the flow has a meaning for: 3:2 builds the house format, and match_input_image
// edits a photo where it stands. Anything else would be a request the design cannot honour, so
// it is refused rather than quietly mapped.
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
// What the gear offers, from the one place that knows. Split by what each engine can actually
// do, so a select cannot present an engine that will fail the moment it is used.
router.get('/character-v2/engines', (_req, res) => {
  const shape = ([id, e]) => ({ id, label: e.label, tiers: e.tiers, def: e.def });
  const all = Object.entries(ENGINES);
  res.json({
    success: true,
    t2i: { default: DEFAULT_T2I, engines: all.filter(([, e]) => e.t2i).map(shape) },
    i2i: { default: DEFAULT_I2I, engines: all.filter(([, e]) => e.i2i).map(shape) },
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
// Body: { prompt, engine?, quality?, aspect?, and optionally imageUrl | imageBase64 | imagePath }
// -> { taskId }, which the page polls through the shared GET /api/status/:taskId
//
// One route for both directions of the page: a reference makes it an edit, no reference makes it
// a text-to-image. Both live here rather than in the older character-creator route because that
// one hands every engine a fixed 9:16 - correct for the page it was written for, and the exact
// opposite of what this one needs.
router.post('/character-v2/generate', async (req, res) => {
  try {
    const b = req.body || {};
    const prompt = String(b.prompt || '').trim();
    if (!prompt) return res.status(400).json({ success: false, error: 'prompt is required' });

    const hasRef = !!(b.imageUrl || b.imageBase64 || b.imagePath);
    const want = String(b.engine || '');
    const usable = (id) => ENGINES[id] && (hasRef ? ENGINES[id].i2i : ENGINES[id].t2i);
    // A safety net, not a normal path: the gear is built from GET /engines, so it cannot offer an
    // engine that fails here. A stale remembered value could, and stranding the page on it would
    // be worse than substituting and saying so.
    const engineKey = usable(want) ? want : (hasRef ? DEFAULT_I2I : DEFAULT_T2I);
    if (want && engineKey !== want) {
      console.warn('[cv2/generate]', want, 'cannot do', hasRef ? 'image-to-image' : 'text-to-image', '- using', engineKey);
    }
    const eng = ENGINES[engineKey];
    const quality = eng.tiers.includes(b.quality) ? b.quality : eng.def;
    // With no reference there is nothing to match, so the only aspect that means anything is the
    // house 3:2.
    const aspect = (hasRef && ASPECTS.includes(b.aspect)) ? b.aspect : '3:2';

    let taskId;
    if (hasRef) {
      taskId = await eng.edit(prompt, await _refUrl(b), aspect, quality, eng);
    } else {
      taskId = await eng.text(prompt, aspect, quality, eng);
    }
    if (!taskId) return res.status(502).json({ success: false, error: 'the engine returned no taskId' });

    // Same bucket either way, so the page's one polling path resolves both.
    addPendingTask(taskId, 'uploads', 'generated', hasRef ? 'cv2-reference' : 'cv2-create');
    console.log('[cv2/generate]', hasRef ? 'i2i' : 't2i', engineKey, quality, aspect, '| prompt:', prompt.slice(0, 120));
    res.json({
      success: true, taskId, engine: engineKey, quality, aspect,
      substituted: (want && engineKey !== want) ? want : undefined,
    });
  } catch (err) {
    console.error('[cv2/generate]', err.response?.data || err.message);
    res.status(502).json({ success: false, error: err.response?.data?.msg || err.message });
  }
});

module.exports = router;
