'use strict';

const path = require('path');
const fs   = require('fs');

// ── Directories ──────────────────────────────────────────────────────────────
const ROOT_DIR         = path.join(__dirname, '..');
const UPLOADS_DIR      = path.join(ROOT_DIR, 'uploads');
const LOOKBOOKS_DIR    = path.join(ROOT_DIR, 'lookbooks');
const CHARACTERS_DIR   = path.join(ROOT_DIR, 'characters');
const ENVIRONMENTS_DIR = path.join(ROOT_DIR, 'environments');
const ARCHIVE_DIR      = path.join(ROOT_DIR, 'archive');
const SCENES_DIR       = path.join(ROOT_DIR, 'scenes');
const DATA_DIR         = path.join(ROOT_DIR, 'data');
const SCENES_FILE      = path.join(DATA_DIR, 'scenes.json');
const SCENARIOS_DIR    = path.join(ROOT_DIR, 'scenarios');
const DETAILS_DIR      = path.join(ROOT_DIR, 'details');
const LOGS_DIR         = path.join(ROOT_DIR, 'logs');
const LOG_FILE         = path.join(LOGS_DIR, 'generation_log.txt');

const TEMP_DIR         = path.join(ROOT_DIR, 'temp_files');

const ARCHIVE_SUBDIRS = ['character', 'lookbook', 'environment'];

const GALLERY_MAP = {
  'characters':   { dir: CHARACTERS_DIR,   archiveSub: 'character' },
  'lookbooks':    { dir: LOOKBOOKS_DIR,    archiveSub: 'lookbook' },
  'environments': { dir: ENVIRONMENTS_DIR, archiveSub: 'environment' },
};

// Ensure all dirs exist at startup
for (const d of [UPLOADS_DIR, LOOKBOOKS_DIR, CHARACTERS_DIR, ENVIRONMENTS_DIR,
                 ARCHIVE_DIR, SCENARIOS_DIR, DETAILS_DIR, LOGS_DIR, SCENES_DIR, DATA_DIR, TEMP_DIR]) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}
for (const sub of ARCHIVE_SUBDIRS) {
  const p = path.join(ARCHIVE_DIR, sub);
  if (!fs.existsSync(p)) fs.mkdirSync(p);
}

// ── API ───────────────────────────────────────────────────────────────────────
const KIE_BASE = 'https://api.kie.ai';

// ── Skin analysis params ──────────────────────────────────────────────────────
const SKIN_PARAMS = [
  'visible pores', 'fine micro-texture', 'organic acne marks', 'non-repeating marks',
  'uneven pigmentation', 'subtle redness', 'natural oil sheen', 'acne scars',
  'bare skin', 'fine lines', 'subtle under-eye texture', 'visible veins',
  'fine wrinkles', 'skin texture',
];
const NO_RETOUCH = [
  'unretouched', 'no smoothing', 'no airbrushing',
  'no beauty filters', 'no retouching', 'no plastic skin',
];

// ── Prompts ───────────────────────────────────────────────────────────────────
const EXTRACT_CLOTHING_PROMPT =
  `Flat lay product photograph of every clothing item and accessory worn by the person in the reference image. ` +
  `Show each garment and accessory as individual items laid flat: tops, bottoms, dresses, jackets, shoes, bags, hats, jewelry, belts, scarves — every visible piece. ` +
  `Pure white background. Absolutely no human body, no face, no skin, no mannequin, no model, no watermarks, no shadows. ` +
  `For each item add a clean annotation: a short straight thin black arrow pointing to it with a concise 2-word English label (e.g. "linen blazer", "silk scarf", "leather belt", "ankle boots"). ` +
  `Labels in clean black sans-serif text with white outline for contrast. Arrows are thin black lines with a small arrowhead. ` +
  `Clean product photography, sharp focus, high detail, 1:1 square format.`;

const EXTRACT_BG_PROMPT =
  `Extract and reconstruct only the background environment from this reference image. ` +
  `Remove all people, models, and human figures completely — leave zero trace of any person. ` +
  `Show only the setting: walls, floors, furniture, decor, scenery, sky, architecture. ` +
  `Seamlessly fill any areas where people were removed. ` +
  `Wide establishing shot, 16:9 landscape format, 4K ultra-high resolution, photorealistic.`;

const APPLY_LOOKBOOK_PROMPT =
  `Dress the person from the first reference image in the exact outfit shown in the second reference image. ` +
  `Preserve the person's face, skin tone, hair, and body proportions exactly as in the first image. ` +
  `Replace all clothing with every item from the second reference image. ` +
  `Maintain the same pose, background, and lighting from the first image. ` +
  `Photorealistic, high quality, 4k.`;

const APPLY_ENV_PROMPT =
  `Place the person from the first image into the environment shown in the second image. ` +
  `Keep the person's appearance, clothing, and pose identical. ` +
  `Blend the lighting and shadows naturally so the person looks like they belong in that environment. ` +
  `No other people, no text, no watermarks. Photorealistic, 9:16 portrait format.`;

const TPOSE_PROMPT =
  `Full-body T-pose of the person from the reference image, waist-up in a square 1:1 format. ` +
  `The person wears a minimal neutral flesh-toned seamless bodysuit — no patterns, logos, or visible seams. ` +
  `Arms extended horizontally in a classic T-pose. Clean white studio background, ` +
  `soft even studio lighting, straight-on front-facing camera angle. ` +
  `4K ultra-high resolution, photorealistic, sharp focus.`;

const EXTRACT_BG_PROMPT_SQ =
  `Extract and reconstruct only the background environment from this reference image. ` +
  `Remove all people, models, and human figures completely — leave zero trace of any person. ` +
  `Show only the setting: walls, floors, furniture, decor, scenery, sky, architecture. ` +
  `Seamlessly fill any areas where people were removed. ` +
  `Square 1:1 format, 4K ultra-high resolution, photorealistic.`;

// ── Scene analysis prompt (Gemini 3.1 Pro) ────────────────────────────────────
const SCENE_ANALYSIS_PROMPT =
  `You are a professional scene analyst for UGC video production. ` +
  `Analyze the provided scene image and return ONLY a raw JSON object with no markdown code blocks or extra text:\n` +
  `{"title":"Короткое название сцены на русском (3-5 слов)",` +
  `"generationPrompt":"A detailed English prompt (150-250 words) to recreate this exact scene with AI image generation. ` +
  `Include: setting, lighting colors, mood, camera angle (eye level or slightly below), shot type, all visible objects and furniture, ` +
  `cinematic quality descriptors. Photorealistic, high detail.",` +
  `"actors":"Describe all people visible: appearance, clothing, body position, facial expression. If no people: No people present.",` +
  `"description":"2-4 предложения на русском языке: что происходит в сцене, где, какое настроение."}`;

// ── Asset interaction analysis prompt (Gemini 3.1 Pro, multimodal) ───────────
const ASSET_INTERACT_ANALYZE_PROMPT =
  `You are a creative director specializing in AI image generation and compositing.\n` +
  `You receive two images:\n` +
  `1. ACTIVE IMAGE — the main photo (character/person/scene) to be modified.\n` +
  `2. ASSET IMAGE — an item (product, clothing, prop, element) to be integrated.\n\n` +
  `User context (may be empty):\n` +
  `- Item name: "{name}"\n` +
  `- User interaction idea: "{exhon}"\n` +
  `- Focus area in active image: "{activnoe}"\n\n` +
  `Task: Generate exactly 5 interaction variants showing how the ASSET IMAGE can be naturally integrated into the ACTIVE IMAGE at the focus area.\n\n` +
  `Rules:\n` +
  `- If "{exhon}" is NOT empty: refine and beautify the user's idea as the FIRST variant; make 4 more related but distinctly different variations.\n` +
  `- If "{exhon}" is empty: freely create 5 diverse creative interactions.\n` +
  `- Each "label": exactly 2-3 English words in action+noun style (e.g. "Holds Gently", "Wears On Shoulder").\n` +
  `- Each "prompt": 40-80 words of precise English generation instructions: how to place/integrate the asset into the active image at the focus area, natural lighting, seamless blending, photorealistic quality.\n\n` +
  `Return ONLY a raw JSON array, no markdown, no extra text:\n` +
  `[{"label":"Short Label","prompt":"Detailed EN generation prompt..."},...]`;

// ── Pose prompts (UGC video poses) ────────────────────────────────────────────
// Placeholders {gender} and {age} are replaced at generation time.
// Skin realism, no-retouch flags, and quality suffix are appended automatically.
const POSE_KEYS = ['pose_desk', 'pose_sofa', 'pose_window', 'pose_kitchen', 'pose_standing'];

const POSE_PROMPTS = {
  pose_desk:
    `A realistic medium shot of a {gender} aged {age} sitting at a desk, ` +
    `looking directly into the camera lens with a relaxed confident expression. ` +
    `Camera at eye level. Professional soft studio lighting, blurred home office background with a bookshelf and a plant.`,

  pose_sofa:
    `A realistic medium shot of a {gender} aged {age} sitting comfortably on a sofa, ` +
    `leaning slightly forward toward the camera with a friendly natural expression. ` +
    `Camera slightly below eye level. Warm ambient lighting, blurred cozy living room background with cushions and soft furnishings.`,

  pose_window:
    `A realistic medium shot of a {gender} aged {age} standing near a large window, ` +
    `turning slightly toward the camera with a relaxed natural expression. ` +
    `Camera at eye level. Natural soft daylight from the side, blurred interior background with curtains and indoor plants.`,

  pose_kitchen:
    `A realistic medium shot of a {gender} aged {age} leaning casually against a kitchen counter, ` +
    `looking directly into the camera with a natural smile. ` +
    `Camera slightly below eye level. Warm kitchen lighting, blurred modern kitchen background with cabinets and countertops.`,

  pose_standing:
    `A realistic medium shot of a {gender} aged {age} standing upright facing the camera, ` +
    `arms relaxed at sides, natural calm expression. ` +
    `Camera at eye level. Soft diffused studio lighting, clean light neutral background.`,
};

module.exports = {
  ROOT_DIR, UPLOADS_DIR, LOOKBOOKS_DIR, CHARACTERS_DIR, ENVIRONMENTS_DIR,
  ARCHIVE_DIR, SCENARIOS_DIR, DETAILS_DIR, LOGS_DIR, LOG_FILE, SCENES_DIR, SCENES_FILE, TEMP_DIR,
  SCENE_ANALYSIS_PROMPT, ASSET_INTERACT_ANALYZE_PROMPT,
  ARCHIVE_SUBDIRS, GALLERY_MAP, KIE_BASE,
  SKIN_PARAMS, NO_RETOUCH,
  EXTRACT_CLOTHING_PROMPT, EXTRACT_BG_PROMPT, APPLY_LOOKBOOK_PROMPT, APPLY_ENV_PROMPT,
  TPOSE_PROMPT, EXTRACT_BG_PROMPT_SQ,
  POSE_KEYS, POSE_PROMPTS,
};
