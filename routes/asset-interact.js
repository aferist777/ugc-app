'use strict';

const express = require('express');
const path    = require('path');
const fs      = require('fs');
const axios   = require('axios');
const router  = express.Router();

const {
  UPLOADS_DIR, CHARACTERS_DIR, LOOKBOOKS_DIR, ENVIRONMENTS_DIR,
  DETAILS_DIR, SCENES_DIR, TEMP_DIR, OBRAZY_DIR,
} = require('../lib/config');
const { callAI, callAIVision, callAIVisionWithFallback, getImgVisionModel, parseLooseJson, uploadToPublicHost, createNanoBananaProTaskMulti, createQwen2Task, createGptImage2Task, createSeedream5LiteTask, createSeedream45Task, createMultiRefEditTask, resolveTask } = require('../lib/helpers');
const { compileImagePrompt } = require('../lib/prompt-compiler');
const { getPrompt } = require('../lib/prompts');
const { addPendingTask, removePendingTask } = require('../lib/pending-tasks');

const SETTINGS_FILE = path.join(__dirname, '..', 'data', 'settings.json');
function readNegativePrompt() {
  try {
    const raw = fs.readFileSync(SETTINGS_FILE, 'utf8');
    const data = JSON.parse(raw);
    const val = (data.editNegativePrompt || '').trim();
    console.log('[readNegativePrompt] path:', SETTINGS_FILE, '| value:', JSON.stringify(val));
    return val;
  } catch (e) {
    console.error('[readNegativePrompt] ERROR reading settings:', e.message, '| path:', SETTINGS_FILE);
    return '';
  }
}

// Resolve spintax {opt1|opt2|opt3} → random choice
function resolveSpintax(text) {
  return text.replace(/\{([^}]+)\}/g, (_, opts) => {
    const parts = opts.split('|');
    return parts[Math.floor(Math.random() * parts.length)].trim();
  });
}

// ── Resolve a public URL path (e.g. /characters/foo.jpg) to a filesystem path ─
// Must include /obrazy/ since character base images + their pose-variations
// now live in per-obraz folders (obrazy/<slug>_<idShort>/...). Missing this
// mapping was the cause of the "empty prompt" errors in mix generation —
// urlToFilePath returned null for /obrazy/... paths, so the pre-analyze
// endpoint bailed before producing combinedPrompt.
function urlToFilePath(urlPath) {
  if (!urlPath) return null;
  const stripped = urlPath.split('?')[0]; // remove ?t=...
  const { REFS_DIR } = require('../lib/config');
  const map = [
    ['/characters/',   CHARACTERS_DIR],
    ['/lookbooks/',    LOOKBOOKS_DIR],
    ['/environments/', ENVIRONMENTS_DIR],
    ['/details/',      DETAILS_DIR],
    ['/refs/',         REFS_DIR],
    ['/scenes/',       SCENES_DIR],
    ['/temp_files/',   TEMP_DIR],
    ['/uploads/',      UPLOADS_DIR],
    ['/obrazy/',       OBRAZY_DIR],
    ['/poses/',        path.join(__dirname, '..', 'public', 'poses')],
  ];
  for (const [prefix, dir] of map) {
    if (stripped.startsWith(prefix)) {
      return path.join(dir, stripped.slice(prefix.length));
    }
  }
  return null;
}

// ── POST /api/asset-interact/analyze ─────────────────────────────────────────
// Sends active image + asset image to Gemini 3.1 Pro with user context.
// Returns 5 interaction variants: [{label, prompt}]
router.post('/asset-interact/analyze', async (req, res) => {
  const { activePath, assetPath, nameVal, exhon, activnoe, assetSize } = req.body;

  if (!activePath || !assetPath) {
    return res.status(400).json({ success: false, error: 'Нет путей к изображениям' });
  }

  const activeFile = urlToFilePath(activePath);
  const assetFile  = urlToFilePath(assetPath);

  if (!activeFile || !fs.existsSync(activeFile)) {
    return res.status(400).json({ success: false, error: 'Активное изображение не найдено на диске' });
  }
  if (!assetFile || !fs.existsSync(assetFile)) {
    return res.status(400).json({ success: false, error: 'Изображение ассета не найдено на диске' });
  }

  try {
    // Upload both images to public host in parallel
    const [activeUrl, assetUrl] = await Promise.all([
      uploadToPublicHost(fs.readFileSync(activeFile)),
      uploadToPublicHost(fs.readFileSync(assetFile)),
    ]);

    // Build prompt from template, substitute user variables
    const sizeClause = (assetSize || '').trim() ? ` (real dimensions: ${assetSize.trim()})` : '';
    let systemPrompt = getPrompt('ASSET_INTERACT_ANALYZE_PROMPT');
    systemPrompt = systemPrompt
      .replace(/\{name\}/g,            nameVal  || '')
      .replace(/\{exhon\}/g,           exhon    || '')
      .replace(/\{activnoe\}/g,        activnoe || '')
      .replace(/\{assetSizeClause\}/g, sizeClause);

    const rawText = await callAIVisionWithFallback([{
      role: 'user',
      content: [
        { type: 'text',      text: systemPrompt },
        { type: 'image_url', image_url: { url: activeUrl } },
        { type: 'image_url', image_url: { url: assetUrl  } },
      ],
    }], { timeout: 45000, useOpenRouter: true, openRouterModel: getImgVisionModel() });
    console.log('[asset-interact/analyze] AI raw:', rawText.slice(0, 300));

    const _vp = parseLooseJson(rawText);
    let variants = Array.isArray(_vp) ? _vp : [];

    // Ensure at least minimal structure
    variants = variants.filter(v => v && v.label && v.prompt);
    if (!variants.length) throw new Error('Gemini не вернул варианты взаимодействия');

    res.json({ success: true, variants: variants.slice(0, 5) });
  } catch (err) {
    console.error('[asset-interact/analyze]', err.response?.data || err.message);
    res.status(502).json({ success: false, error: err.response?.data?.msg || err.message });
  }
});

// ── POST /api/asset-interact/pre-analyze ─────────────────────────────────────
// Sends active + asset images to Gemini; returns ONE optimised generation prompt.
router.post('/asset-interact/pre-analyze', async (req, res) => {
  const { activePath, assetPath, presetPrompt, assetSize } = req.body;

  if (!activePath || !assetPath) {
    return res.status(400).json({ success: false, error: 'Нет путей к изображениям' });
  }

  const activeFile = urlToFilePath(activePath);
  const assetFile  = urlToFilePath(assetPath);

  if (!activeFile || !fs.existsSync(activeFile))
    return res.status(400).json({ success: false, error: 'Активное изображение не найдено на диске' });
  if (!assetFile || !fs.existsSync(assetFile))
    return res.status(400).json({ success: false, error: 'Изображение ассета не найдено на диске' });

  try {
    const [activeUrl, assetUrl] = await Promise.all([
      uploadToPublicHost(fs.readFileSync(activeFile)),
      uploadToPublicHost(fs.readFileSync(assetFile)),
    ]);

    const sizeClause2 = (assetSize || '').trim() ? ` — real dimensions: ${assetSize.trim()} (render at this exact scale; include dimensions in your output prompt as a size anchor)` : '';
    const systemPrompt = getPrompt('ASSET_PRE_GENERATE_PROMPT')
      .replace(/\{presetPrompt\}/g,    presetPrompt || '')
      .replace(/\{assetSizeClause\}/g, sizeClause2);

    const combinedPrompt = await callAIVisionWithFallback([{
      role: 'user',
      content: [
        { type: 'text',      text: systemPrompt },
        { type: 'image_url', image_url: { url: activeUrl } },
        { type: 'image_url', image_url: { url: assetUrl  } },
      ],
    }], { timeout: 45000, useOpenRouter: true, openRouterModel: getImgVisionModel() });
    console.log('[asset-interact/pre-analyze] combined prompt:', combinedPrompt.slice(0, 200));

    console.log('[asset-interact/pre-analyze] combined prompt:', combinedPrompt.slice(0, 200));
    res.json({ success: true, combinedPrompt });
  } catch (err) {
    console.error('[asset-interact/pre-analyze]', err.response?.data || err.message);
    res.status(502).json({ success: false, error: err.response?.data?.msg || err.message });
  }
});

// ── POST /api/asset-interact/apply-analyze ───────────────────────────────────
// Character-tab "Apply to image" slots. Same two-image vision analysis as
// pre-analyze, but the system prompt (agent role) is chosen by asset TYPE
// (lookbook|environment|prop) and whether the user typed extra notes — 6 prompts.
// IMAGE 1 = active character, IMAGE 2 = the chosen asset. Returns one generation
// prompt. (Kept separate from pre-analyze so the legacy asset flow is untouched.)
const _APPLY_TAIL = '\nPreserve the character\'s facial identity, age and skin exactly. Photorealistic, consistent lighting, no text or watermarks. Respond with ONLY the image-generation prompt — no preamble, no quotes, no explanation.';
// Appended for lookbook / prop applies so the engine does NOT invent a new scene:
// the background must come from IMAGE 1, only the outfit / product changes.
const _KEEP_BG =
  '\n\nMANDATORY — BACKGROUND LOCK: keep the ORIGINAL background, environment, scene, ' +
  'location, surroundings, lighting and camera framing of IMAGE 1 EXACTLY as they are. ' +
  'Do NOT change, replace, blur, crop or restyle the background in any way. IMAGE 2 is the ' +
  'source ONLY for the outfit/product — never take its background or setting. Your generated ' +
  'prompt MUST explicitly state that the background stays identical to the original image.';
// Appended when a persistent actor's canonical portrait is supplied as a 3rd
// image. It is the source of truth for the FACE; IMAGE 1 only carries the
// current pose/body/outfit context.
const _FACE_REF_CLAUSE =
  '\n\nADDITIONAL FACE REFERENCE: a third image of this exact character is attached LAST. ' +
  'It is the CANONICAL identity. Describe the face — face shape, features, eyes, nose, lips, ' +
  'skin tone, hair colour and style — strictly from THIS reference, and state explicitly in your ' +
  'prompt that the character\'s face must match this reference exactly. If IMAGE 1 shows a slightly ' +
  'different face, ignore those differences — IMAGE 1 only provides the current pose, body and outfit context. ' +
  'NOTE: this reference may be a MULTI-ANGLE sheet showing the SAME single person from several views — ' +
  'use it ONLY to capture the facial identity. Your prompt MUST describe exactly ONE person in ONE single ' +
  'view and MUST explicitly forbid any multi-view, three-angle, turnaround, contact-sheet or side-by-side layout.';
const _APPLY_PROMPTS = {
  lookbook_empty:
    'You are a fashion stylist directing a photoreal image edit. IMAGE 1 is the character; IMAGE 2 is an outfit / lookbook. Write ONE detailed English image-generation prompt that dresses the character from IMAGE 1 in the exact outfit from IMAGE 2 — same garments, colours, fabrics, fit and styling — while keeping the character\'s face, body, hair and pose unchanged. Natural drape and fit.' + _APPLY_TAIL,
  lookbook_text:
    'You are a fashion stylist directing a photoreal image edit. IMAGE 1 is the character; IMAGE 2 is an outfit / lookbook. Dress the character from IMAGE 1 in the outfit from IMAGE 2, keeping their face, body, hair and pose unchanged. The user\'s styling notes (HIGHEST PRIORITY): "{userText}" — apply these (how it is worn, fit, accessories) on top of the IMAGE 2 outfit. Write ONE detailed English image-generation prompt.' + _APPLY_TAIL,
  environment_empty:
    'You are a scene compositor. IMAGE 1 is the character; IMAGE 2 is an environment / background. Write ONE detailed English image-generation prompt that places the character from IMAGE 1 naturally into the environment of IMAGE 2 — matching perspective, scale, lighting direction, colour temperature and shadows so the character truly belongs in that scene. Keep the character\'s face, outfit and pose.' + _APPLY_TAIL,
  environment_text:
    'You are a scene compositor. IMAGE 1 is the character; IMAGE 2 is an environment / background. Place the character from IMAGE 1 into the scene of IMAGE 2, matching perspective, scale and lighting. The user\'s scene notes (HIGHEST PRIORITY): "{userText}" — honour these (placement, time of day, framing, mood). Keep the character\'s face, outfit and pose. Write ONE detailed English image-generation prompt.' + _APPLY_TAIL,
  prop_empty:
    'You are a product-placement director. IMAGE 1 is the character; IMAGE 2 is a product / prop. Write ONE detailed English image-generation prompt where the character from IMAGE 1 naturally holds, uses or presents the product from IMAGE 2 — anatomically correct grip, correct scale and perspective, product fully visible and undistorted. Keep the character\'s face and overall look.' + _APPLY_TAIL,
  prop_text:
    'You are a product-placement director. IMAGE 1 is the character; IMAGE 2 is a product / prop. The character should interact with the product naturally. The user\'s interaction notes (HIGHEST PRIORITY): "{userText}" — build the pose/interaction around these. Keep correct grip, scale and full product visibility, and the character\'s face and look. Write ONE detailed English image-generation prompt.' + _APPLY_TAIL,
};

// Clause injected into apply-analyze when the caller supplies a pre-computed
// SUBJECT description (appearance + pose, no clothing) of the person in IMAGE 1.
// Used for images WITHOUT a saved character reference (uploads, TPDNE, free
// generations) so the swap locks identity/pose and fully replaces clothing.
const _SUBJECT_CLAUSE = (type, desc) => {
  const base = `\n\nSUBJECT (the person in IMAGE 1 — appearance & pose, clothing intentionally omitted): "${desc}". Keep this person's appearance and pose EXACTLY as described.`;
  if (type === 'lookbook')
    return base + ' Their current clothing is irrelevant — REPLACE it ENTIRELY with the outfit from IMAGE 2, leaving no trace of the original garments.';
  return base;
};

// Appended to the FINAL generation prompt (after the realism compiler) whenever
// character identity reference sheets are sent. Those sheets are 3-angle portraits;
// this guards against the engine reproducing that multi-view layout in the output.
const _SINGLE_SUBJECT_TAIL =
  ' Render EXACTLY ONE single person in ONE single view. The attached character reference ' +
  'sheet(s) show the same person from multiple angles and are for FACE and BODY IDENTITY ONLY — ' +
  'do NOT reproduce a multi-view, three-angle, turnaround, contact-sheet or side-by-side layout, ' +
  'and never output more than one copy of the person.';

router.post('/asset-interact/apply-analyze', async (req, res) => {
  const { activePath, assetPath, assetType, userText, charRefPaths, subjectDesc } = req.body || {};
  if (!activePath || !assetPath) return res.status(400).json({ success: false, error: 'Нет путей к изображениям' });
  const type = ['lookbook', 'environment', 'prop'].includes(assetType) ? assetType : 'prop';
  const activeFile = urlToFilePath(activePath);
  const assetFile  = urlToFilePath(assetPath);
  if (!activeFile || !fs.existsSync(activeFile)) return res.status(400).json({ success: false, error: 'Активное изображение не найдено' });
  if (!assetFile  || !fs.existsSync(assetFile))  return res.status(400).json({ success: false, error: 'Изображение ассета не найдено' });

  // Optional canonical face reference (the actor's portrait sheet). Only the
  // first ref is used — head-and-shoulders, so it doesn't trip nudity moderation.
  const faceRefPath = Array.isArray(charRefPaths) && charRefPaths.length ? charRefPaths[0] : null;
  const faceFile    = faceRefPath ? urlToFilePath(faceRefPath) : null;
  const hasFace     = !!(faceFile && fs.existsSync(faceFile));

  try {
    const uploads = [
      uploadToPublicHost(fs.readFileSync(activeFile)),
      uploadToPublicHost(fs.readFileSync(assetFile)),
    ];
    if (hasFace) uploads.push(uploadToPublicHost(fs.readFileSync(faceFile)));
    const [activeUrl, assetUrl, faceUrl] = await Promise.all(uploads);

    const txt = (userText || '').trim();
    let sys = _APPLY_PROMPTS[type + (txt ? '_text' : '_empty')];
    if (txt) sys = sys.replace(/\{userText\}/g, txt);
    if (type === 'lookbook' || type === 'prop') sys += _KEEP_BG;   // outfit/product swap must keep the original scene
    if (hasFace) sys += _FACE_REF_CLAUSE;
    const _subj = (subjectDesc || '').trim();
    if (_subj && !hasFace) sys += _SUBJECT_CLAUSE(type, _subj);   // no actor ref -> use the subject description

    const content = [
      { type: 'text',      text: sys },
      { type: 'image_url', image_url: { url: activeUrl } },
      { type: 'image_url', image_url: { url: assetUrl  } },
    ];
    if (hasFace) content.push({ type: 'image_url', image_url: { url: faceUrl } });

    const combinedPrompt = await callAIVisionWithFallback([{ role: 'user', content }],
      { timeout: 45000, useOpenRouter: true, openRouterModel: getImgVisionModel() });
    console.log(`[asset-interact/apply-analyze] type=${type} text=${txt ? 'yes' : 'no'} face=${hasFace ? 'yes' : 'no'} subj=${_subj ? 'yes' : 'no'} →`, String(combinedPrompt).slice(0, 160));
    res.json({ success: true, combinedPrompt });
  } catch (err) {
    console.error('[asset-interact/apply-analyze]', err.response?.data || err.message);
    res.status(502).json({ success: false, error: err.response?.data?.msg || err.message });
  }
});

// ── POST /api/asset-interact/analyze-subject ─────────────────────────────────
// Single-image vision pass: describe the PERSON (appearance + pose) but NOT their
// clothing. Used before a lookbook/environment swap on an image that has no saved
// character reference, so the swap can lock identity/pose and fully replace the
// original outfit.
const _SUBJECT_SYS =
  'You are a vision analyst. Describe ONLY the PERSON in this single image: face shape and features, eyes, ' +
  'eyebrows, nose, lips, skin tone, hair colour and style, apparent age, gender, build/body type, and their ' +
  'POSE and framing (head-and-shoulders / waist-up / full-body, facing direction, head tilt, arm and hand ' +
  'position, sitting/standing). Be specific but concise (2-4 sentences). ' +
  'Do NOT describe or mention clothing, outfit, garments, fabric, colours of clothes, accessories, jewellery, ' +
  'hats, glasses or shoes — omit anything worn entirely. Respond with ONLY the description, no preamble.';

router.post('/asset-interact/analyze-subject', async (req, res) => {
  const { imagePath } = req.body || {};
  if (!imagePath) return res.status(400).json({ success: false, error: 'Нет пути к изображению' });
  const file = urlToFilePath(imagePath);
  if (!file || !fs.existsSync(file)) return res.status(400).json({ success: false, error: 'Изображение не найдено' });
  try {
    const url = await uploadToPublicHost(fs.readFileSync(file));
    const content = [
      { type: 'text', text: _SUBJECT_SYS },
      { type: 'image_url', image_url: { url } },
    ];
    const description = await callAIVisionWithFallback([{ role: 'user', content }],
      { timeout: 45000, useOpenRouter: true, openRouterModel: getImgVisionModel() });
    console.log('[asset-interact/analyze-subject] →', String(description).slice(0, 160));
    res.json({ success: true, description: String(description || '').trim() });
  } catch (err) {
    console.error('[asset-interact/analyze-subject]', err.response?.data || err.message);
    res.status(502).json({ success: false, error: err.response?.data?.msg || err.message });
  }
});

// ── POST /api/asset-interact/ugc-frame-prompt ────────────────────────────────
// ugc_ad fragment frame: vision analysis of the character BASE (IMAGE 1, a
// photoshoot variation in a scene) + 1-3 PRODUCT items (IMAGE 2..N). ALWAYS runs:
// with no user text it picks the most contextually relevant role PER item from the
// concrete IMAGE 1 details; with text, the notes are highest priority. Returns ONE
// composition prompt. Kept separate from apply-analyze (which is single-asset and
// hard-codes IMAGE 2 = asset). No face ref -> base carries identity, IMAGE order
// stays base=1, items=2..N.
const _UGC_FRAME_PROMPTS = {
  empty: `You are a product-placement director for a photoreal multi-reference image edit on a short-form UGC ad fragment. IMAGE 1 is the BASE: a photoshoot variation of the presenter character in a real scene. IMAGE 2..N are 1-3 separate PRODUCT items from a product library — each a distinct reference. Write ONE detailed English image-generation prompt that composes EVERY item from IMAGE 2..N INTO the IMAGE 1 scene as a single, natural, in-camera moment. FIRST, read IMAGE 1 closely as the staging brief: the character's pose and orientation, which hands and arms are free vs occupied, gaze direction and where attention falls, what they are already doing, the setting and existing props, the surfaces within reach (table, counter, desk, lap, shelf, floor), the framing (close-up / waist-up / full-body) and the mood. THEN, for EACH item in order, CHOOSE the SINGLE most contextually relevant and physically plausible role for THAT item in THIS exact scene — held in a free hand with an anatomically correct grip, worn or applied on the body, actively used, presented toward camera, or set on a real in-scene surface near the character — never a generic "holds the product". DIVERSIFY roles across the items so they are not all handled the same way (e.g. one held/used, one worn or in-use on the body, one resting on a surface within reach), and if a hand is occupied or a surface is present, route the item to the most natural option instead of forcing it into the hand. Respect real-world relationships between related items (e.g. bottle and cap, phone and case, cup and saucer) and stage them as a believable cluster. Render every product at correct real-world scale and perspective for its position in the frame, fully visible, unobstructed and undistorted, with its true shape, colours, materials and any labels/text intact and legible — sourced ONLY from each item's own reference, never its background, surface or surrounding props. Keep the character's facial identity, age, skin, body and hair EXACTLY as in IMAGE 1; adjust only a hand or arm as the chosen interactions require, never the face or body type. BACKGROUND / SCENE LOCK: the generated prompt MUST explicitly state that IMAGE 1's background, environment, location, lighting and camera framing stay identical and that the ONLY additions are the product items. Render EXACTLY ONE single person in ONE single view — no multi-angle, three-angle, turnaround, contact-sheet, split-screen or side-by-side layout, and never more than one copy of the person. Respond with ONLY the image-generation prompt — no preamble, no quotes, no explanation.`,
  text: `You are a product-placement director for a photoreal multi-reference image edit on a short-form UGC ad fragment. IMAGE 1 is the BASE: a photoshoot variation of the presenter character in a real scene. IMAGE 2..N are 1-3 separate PRODUCT items from a product library — each a distinct reference. Write ONE detailed English image-generation prompt that composes EVERY item from IMAGE 2..N INTO the IMAGE 1 scene as a single, natural, in-camera moment. The user's placement notes (HIGHEST PRIORITY): "{userText}" — these dictate how the items are used, staged and positioned and override the default role choice; build the composition around them, but still GROUND every detail in IMAGE 1. FIRST, read IMAGE 1 closely as the staging brief: the character's pose and orientation, which hands and arms are free vs occupied, gaze direction and where attention falls, what they are already doing, the setting and existing props, the surfaces within reach (table, counter, desk, lap, shelf, floor), the framing (close-up / waist-up / full-body) and the mood — use these concrete details to realise the user's notes on camera. THEN apply the notes to the items; for any item the notes do NOT explicitly place, CHOOSE the SINGLE most contextually relevant and physically plausible role for THAT item in THIS exact scene — held in a free hand with an anatomically correct grip, worn or applied on the body, actively used, presented toward camera, or set on a real in-scene surface near the character — never a generic "holds the product", and DIVERSIFY roles across the unspecified items so they are not all handled the same way. If a hand is occupied or a surface is present, route the item to the most natural option instead of forcing it into the hand, and reconcile silently with anatomy and framing — if a requested placement is impossible with the visible hands or crop, choose the closest natural alternative without comment. Respect real-world relationships between related items (e.g. bottle and cap, phone and case, cup and saucer) and stage them as a believable cluster. Render every product at correct real-world scale and perspective for its position in the frame, fully visible, unobstructed and undistorted, with its true shape, colours, materials and any labels/text intact and legible — sourced ONLY from each item's own reference, never its background, surface or surrounding props. Keep the character's facial identity, age, skin, body and hair EXACTLY as in IMAGE 1; adjust only a hand or arm as the chosen interactions require, never the face or body type. BACKGROUND / SCENE LOCK: the generated prompt MUST explicitly state that IMAGE 1's background, environment, location, lighting and camera framing stay identical and that the ONLY additions are the product items. Render EXACTLY ONE single person in ONE single view — no multi-angle, three-angle, turnaround, contact-sheet, split-screen or side-by-side layout, and never more than one copy of the person. Respond with ONLY the image-generation prompt — no preamble, no quotes, no explanation.`,
  edit: `You are directing a photoreal single-image edit of a UGC ad frame. IMAGE 1 is the BASE: the presenter character in a scene, no product items. The user's change request may be in ANY language (e.g. Russian or English): "{userText}". Write ONE detailed English image-generation prompt that applies EXACTLY this change to IMAGE 1. Translate and interpret the request faithfully. Keep the character's facial identity, age, skin, body and hair EXACTLY as in IMAGE 1, and keep everything the request does NOT mention unchanged (background, outfit, pose, lighting, camera framing). Render EXACTLY ONE single person in ONE single view — no multi-angle, turnaround, contact-sheet, split-screen or side-by-side layout, never more than one copy of the person. Respond with ONLY the image-generation prompt — no preamble, no quotes, no explanation.`,
};

router.post('/asset-interact/ugc-frame-prompt', async (req, res) => {
  const { basePath, assetPaths, userText } = req.body || {};
  const items = (Array.isArray(assetPaths) ? assetPaths : []).filter(Boolean);
  const txt = (userText || '').trim();
  if (!basePath || (!items.length && !txt)) return res.status(400).json({ success: false, error: 'Нужно базовое изображение и предмет или текст правки' });
  const baseFile = urlToFilePath(basePath);
  if (!baseFile || !fs.existsSync(baseFile)) return res.status(400).json({ success: false, error: 'Базовое изображение не найдено' });
  const itemFiles = items.map(urlToFilePath);
  for (const f of itemFiles) if (!f || !fs.existsSync(f)) return res.status(400).json({ success: false, error: 'Изображение предмета не найдено' });
  try {
    const [baseUrl, ...itemUrls] = await Promise.all([
      uploadToPublicHost(fs.readFileSync(baseFile)),
      ...itemFiles.map(f => uploadToPublicHost(fs.readFileSync(f))),
    ]);
    // items -> compose; no items + text -> single-image edit (RU/EN note -> EN edit prompt).
    const sys = items.length ? (txt ? _UGC_FRAME_PROMPTS.text.replace(/\{userText\}/g, txt) : _UGC_FRAME_PROMPTS.empty)
                             : _UGC_FRAME_PROMPTS.edit.replace(/\{userText\}/g, txt);
    const content = [{ type: 'text', text: sys }, { type: 'image_url', image_url: { url: baseUrl } }, ...itemUrls.filter(Boolean).map(u => ({ type: 'image_url', image_url: { url: u } }))];
    const combinedPrompt = await callAIVisionWithFallback([{ role: 'user', content }], { timeout: 45000, useOpenRouter: true, openRouterModel: getImgVisionModel() });
    console.log(`[asset-interact/ugc-frame-prompt] items=${items.length} text=${txt ? 'yes' : 'no'} →`, String(combinedPrompt).slice(0, 160));
    res.json({ success: true, combinedPrompt: String(combinedPrompt || '').trim() });
  } catch (err) {
    console.error('[asset-interact/ugc-frame-prompt]', err.response?.data || err.message);
    res.status(502).json({ success: false, error: err.response?.data?.msg || err.message });
  }
});

// ── POST /api/asset-interact/generate ────────────────────────────────────────
// Sends active image + asset image(s) + selected prompt to nano-banana-2.
router.post('/asset-interact/generate', async (req, res) => {
  const { activePath, assetPath, assetPaths, prompt, assetType, imageEngine, engineParams = {}, charRefPaths } = req.body;
  const engine = imageEngine || 'nano-banana-2';   // dispatch handled by createMultiRefEditTask (all engines)
  const seed = Math.floor(Math.random() * 999_999_999) + 1;

  if (!activePath) {
    return res.status(400).json({ success: false, error: 'Нет изображений' });
  }

  // Resolve prompt: use provided value or fall back to default for asset type
  let resolvedPrompt = (prompt || '').trim();
  if (!resolvedPrompt) {
    if (assetType === 'lookbook') {
      resolvedPrompt = resolveSpintax(getPrompt('LOOKBOOK_DEFAULT_GENERATE_PROMPT'));
    } else if (assetType === 'environment') {
      resolvedPrompt = resolveSpintax(getPrompt('ENVIRONMENT_DEFAULT_GENERATE_PROMPT'));
    } else if (assetType === 'detail') {
      resolvedPrompt = resolveSpintax(getPrompt('DETAIL_DEFAULT_GENERATE_PROMPT'));
    } else {
      return res.status(400).json({ success: false, error: 'Выберите вариант в столбце ПРЕСЕТ или укажите тип ассета.' });
    }
  } else {
    resolvedPrompt = resolveSpintax(resolvedPrompt);
  }

  // Realism compiler (always on): structure the apply prompt into the strict
  // JSON spec and weave in the iPhone-14 home-video realism markers. Not locked
  // to the reference — apply intentionally changes the clothing / environment.
  // SKIPPED for pose transfer: the explicit "keep everything, change only the
  // body pose" instruction must reach the engine intact.
  if (assetType !== 'pose') {
    try {
      const _c = await compileImagePrompt(resolvedPrompt, { lockToReference: false });
      if (_c && _c.prompt) resolvedPrompt = _c.prompt;
    } catch (e) { console.warn('[asset-interact/generate] compile skipped:', e.message); }
  }

  const activeFile = urlToFilePath(activePath);
  // Accept a single assetPath (legacy) OR an assetPaths[] array (ugc multi-item frame).
  const assetList = (Array.isArray(assetPaths) && assetPaths.length) ? assetPaths.filter(Boolean) : (assetPath ? [assetPath] : []);
  const assetFiles = assetList.map(urlToFilePath);

  if (!activeFile || !fs.existsSync(activeFile))
    return res.status(400).json({ success: false, error: 'Активное изображение не найдено' });
  for (const f of assetFiles)
    if (!f || !fs.existsSync(f)) return res.status(400).json({ success: false, error: 'Изображение ассета не найдено' });

  // Persistent-character reference sheets (portrait + T-pose). When a saved
  // actor is selected, lookbook / environment generation sends these neutral
  // sheets as extra IDENTITY anchors alongside the active image so the face &
  // body stay locked to the canonical character.
  const refFiles = Array.isArray(charRefPaths)
    ? charRefPaths.map(urlToFilePath).filter(f => f && fs.existsSync(f))
    : [];
  // Identity refs are 3-angle portrait sheets -> guard the post-compile prompt so the
  // engine renders a single person, not a triple-portrait turnaround.
  if (refFiles.length) resolvedPrompt += _SINGLE_SUBJECT_TAIL;

  try {
    // Order: active (IMAGE 1, anchors identity+background) -> identity refs -> asset(s).
    const [activeUrl, ...restUrls] = await Promise.all([
      uploadToPublicHost(fs.readFileSync(activeFile)),
      ...refFiles.map(f => uploadToPublicHost(fs.readFileSync(f))),
      ...assetFiles.map(f => uploadToPublicHost(fs.readFileSync(f))),
    ]);
    const refUrls   = restUrls.slice(0, refFiles.length).filter(Boolean);
    const assetUrls = restUrls.slice(refFiles.length).filter(Boolean);
    const imageUrls = [activeUrl, ...refUrls, ...assetUrls];

    const aspectRatio = '9:16';
    const taskId = await createMultiRefEditTask(engine, resolvedPrompt, imageUrls, aspectRatio, seed, engineParams);
    console.log('[asset-interact/generate] engine:', engine, '| taskId:', taskId, '| seed:', seed);
    addPendingTask(taskId, 'uploads', 'interact', 'asset-interact');

    res.json({ success: true, taskId, seed });
  } catch (err) {
    console.error('[asset-interact/generate]', err.response?.data || err.message);
    res.status(502).json({ success: false, error: err.response?.data?.msg || err.message });
  }
});

// ── POST /api/asset-interact/generate-with-analysis ──────────────────────────
// Step 1: GPT-4o (→ Claude → Gemini) analyzes both images + interaction label → writes detailed English prompt
// Step 2: Submits generation with that prompt + both images using the selected engine
router.post('/asset-interact/generate-with-analysis', async (req, res) => {
  const { activePath, assetPath, interactionLabel, assetSize, imageEngine, engineParams = {} } = req.body;
  const negativePrompt = readNegativePrompt();
  const engine = imageEngine || 'nano-banana-2';   // dispatch handled by createMultiRefEditTask (all engines)
  const seed = Math.floor(Math.random() * 999_999_999) + 1;

  if (!activePath || !assetPath)
    return res.status(400).json({ success: false, error: 'Нет изображений' });

  const activeFile = urlToFilePath(activePath);
  const assetFile  = urlToFilePath(assetPath);

  if (!activeFile || !fs.existsSync(activeFile))
    return res.status(400).json({ success: false, error: 'Активное изображение не найдено' });
  if (!assetFile || !fs.existsSync(assetFile))
    return res.status(400).json({ success: false, error: 'Изображение ассета не найдено' });

  try {
    const [activeUrl, assetUrl] = await Promise.all([
      uploadToPublicHost(fs.readFileSync(activeFile)),
      uploadToPublicHost(fs.readFileSync(assetFile)),
    ]);

    // Step 1: AI analysis → detailed generation prompt
    const sizeClause  = (assetSize || '').trim() ? ` — real dimensions: ${assetSize.trim()} (render at this exact scale; include dimensions in your output prompt as a size anchor)` : '';
    const negPlaceholder = negativePrompt
      ? `\n\nNEGATIVE PROMPT (these must NOT appear in the output image): ${negativePrompt}`
      : '';
    const analysisText = getPrompt('SCENE_INTERACTION_PROMPT')
      .replace(/\{interactionLabel\}/g, interactionLabel || 'holds the item naturally')
      .replace(/\{activeFileName\}/g,   path.basename(activeFile))
      .replace(/\{assetFileName\}/g,    path.basename(assetFile))
      .replace(/\{assetSizeClause\}/g,  sizeClause)
      .replace(/\{negativePrompt\}/g,   negPlaceholder);

    console.log('[generate-with-analysis] negativePrompt:', JSON.stringify(negativePrompt));
    console.log('[generate-with-analysis] analysisText (last 200):', analysisText.slice(-200));

    let generationPrompt;
    try {
      generationPrompt = await callAIVisionWithFallback([{
        role: 'user',
        content: [
          { type: 'text',      text: analysisText },
          { type: 'image_url', image_url: { url: activeUrl } },
          { type: 'image_url', image_url: { url: assetUrl  } },
        ],
      }], { timeout: 45000, useOpenRouter: true, openRouterModel: getImgVisionModel() });
      // Always append negative prompt at the end of generation prompt
      if (negativePrompt) generationPrompt += `\n\nnegative_prompt: ${negativePrompt}`;
      console.log('[generate-with-analysis] generationPrompt (last 200):', generationPrompt.slice(-200));
    } catch (aiErr) {
      console.warn('[generate-with-analysis] AI analysis failed, using default:', aiErr.message);
      generationPrompt = resolveSpintax(getPrompt('DETAIL_DEFAULT_GENERATE_PROMPT'));
      if (negativePrompt) generationPrompt += `\n\nnegative_prompt: ${negativePrompt}`;
    }

    // Step 2: Submit generation task (qwen2 doesn't support multiple images → fall back to nano-banana)
    console.log('[generate-with-analysis] engine:', engine, '| engineParams:', JSON.stringify(engineParams));
    const taskId = await createMultiRefEditTask(engine, generationPrompt, [activeUrl, assetUrl], '9:16', seed, engineParams);
    console.log('[generate-with-analysis] engine:', engine, '| taskId:', taskId);
    addPendingTask(taskId, 'uploads', 'interact', 'asset-interact');
    res.json({ success: true, taskId, seed });
  } catch (err) {
    console.error('[asset-interact/generate-with-analysis]', err.response?.data || err.message);
    res.status(502).json({ success: false, error: err.response?.data?.msg || err.message });
  }
});

// ── GET /api/asset-interact/status/:taskId ────────────────────────────────────
router.get('/asset-interact/status/:taskId', async (req, res) => {
  try {
    const result = await resolveTask(req.params.taskId, UPLOADS_DIR, 'interact');
    if (result.state === 'success' || result.state === 'failed') removePendingTask(req.params.taskId);
    res.json({ success: true, ...result });
  } catch (err) { res.status(502).json({ success: false, error: err.message }); }
});

module.exports = router;
