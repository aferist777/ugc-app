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
const SCENARIOS_DIR         = path.join(ROOT_DIR, 'scenarios');
const SCENARIOS_ARCHIVE_DIR = path.join(ROOT_DIR, 'scenarios', '_archive');
const DETAILS_DIR           = path.join(ROOT_DIR, 'details');
const LOGS_DIR         = path.join(ROOT_DIR, 'logs');
const LOG_FILE         = path.join(LOGS_DIR, 'generation_log.txt');

const TEMP_DIR         = path.join(ROOT_DIR, 'temp_files');
const REFS_DIR         = path.join(ROOT_DIR, 'refs');
const REFS_FILE        = path.join(DATA_DIR, 'refs.json');
const FINALS_DIR       = path.join(ROOT_DIR, 'finals');
const SHOTSTACK_KEY    = '6J2QO8Yg1MWOCy3XrRM0DYoxCHCzQ9psbdzSLla2';

const ARCHIVE_SUBDIRS = ['character', 'lookbook', 'environment'];

const GALLERY_MAP = {
  'characters':   { dir: CHARACTERS_DIR,   archiveSub: 'character' },
  'lookbooks':    { dir: LOOKBOOKS_DIR,    archiveSub: 'lookbook' },
  'environments': { dir: ENVIRONMENTS_DIR, archiveSub: 'environment' },
};

// Ensure all dirs exist at startup
for (const d of [UPLOADS_DIR, LOOKBOOKS_DIR, CHARACTERS_DIR, ENVIRONMENTS_DIR,
                 ARCHIVE_DIR, SCENARIOS_DIR, SCENARIOS_ARCHIVE_DIR, DETAILS_DIR, LOGS_DIR, SCENES_DIR, DATA_DIR, TEMP_DIR, REFS_DIR, FINALS_DIR]) {
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
  `Dress the person from Image 1 in the outfit shown in Image 2. ` +
  `CRITICAL: Do NOT change the person's pose — preserve their exact body position and angle from Image 1. ` +
  `Apply every clothing item from Image 2 that fits the current visible pose. ` +
  `PANTS / TROUSERS / SKIRTS / SHORTS RULE: If the person's lower body is NOT visible in Image 1, skip all bottom garments and apply only the visible items. ` +
  `Preserve the person's face, skin tone, hair, body proportions, and facial expression exactly as in Image 1. ` +
  `Keep the same background and lighting from Image 1. ` +
  `No text overlays, no labels, no watermarks. Photorealistic, seamless compositing, 9:16 portrait format, 4K.`;

const APPLY_ENV_PROMPT =
  `Place the person from Image 1 into the environment shown in Image 2. ` +
  `CRITICAL: Preserve the person's exact pose, body position, and camera angle from Image 1 — do not alter stance or shooting angle. ` +
  `Keep the person's appearance, clothing, hairstyle, and expression completely identical to Image 1. ` +
  `Blend the person naturally: match ambient lighting direction, color temperature, and cast realistic shadows. ` +
  `Preserve the atmosphere and mood of the environment from Image 2. ` +
  `No other people, no text, no watermarks. Photorealistic compositing, 9:16 portrait format, 4K.`;

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
  `You are a creative director specializing in AI image generation and UGC content compositing.\n` +
  `You receive two images:\n` +
  `1. ACTIVE IMAGE — a photo of the main CHARACTER (person). They are the protagonist of every scene you generate.\n` +
  `2. ASSET IMAGE — the item named "{name}" that the character will interact with.\n\n` +
  `User context (may be empty):\n` +
  `- Asset name: "{name}"\n` +
  `- Action (what the character does with the asset): "{exhon}"\n` +
  `- Focus detail (area of the image to emphasize): "{activnoe}"\n\n` +
  `Core principle:\n` +
  `The CHARACTER from Image 1 is the sole protagonist — everything happens for and around them.\n` +
  `The ASSET is what the character actively uses or wears or interacts with.\n` +
  `"{exhon}" describes the character's exact action with the asset "{name}".\n` +
  `"{activnoe}" is the specific detail or area that should be in sharp focus.\n` +
  `Example: name="honey", exhon="pouring honey on a car wheel close-up", activnoe="iron rim of the wheel" → ` +
  `the character is POURING the honey (asset) ONTO the iron rim of the car wheel (focus), close-up shot.\n\n` +
  `Asset type rules (infer type from Image 2 if not clear):\n` +
  `- CLOTHING / LOOKBOOK: The outfit is dressed onto the character. Preserve their exact pose. If legs are not visible, do not add pants.\n` +
  `- PROP / DETAIL: The item ends up in the character's hands by default. Follow "{exhon}" and "{activnoe}" precisely.\n` +
  `- ENVIRONMENT: The character is placed into the environment keeping their pose and camera angle. Character presence and comfort in the space is primary.\n\n` +
  `Task: Generate exactly 5 interaction variants.\n\n` +
  `Rules:\n` +
  `- VARIANT 1: If "{exhon}" is NOT empty — refine the user's exact action idea into a precise, cinematic generation prompt. Do not invent a different action.\n` +
  `- VARIANTS 2-5: Generate 4 distinctly different creative interactions — vary shot composition, hand placement, emotional register, or usage scenario.\n` +
  `- Each "label": 2-4 English words (e.g. "Pours On Wheel", "Holds Left Hand", "Wears On Shoulder").\n` +
  `- Each "prompt": ~500 characters of precise English generation instructions. Must include: (1) character's exact action with the asset at the stated focus detail, (2) body posture and limb/hand position, (3) lighting and shadow matching, (4) seamless photorealistic compositing, 9:16 portrait, no text no watermarks.\n\n` +
  `Return ONLY a raw JSON array, no markdown, no extra text:\n` +
  `[{"label":"Action Label","prompt":"~500 char EN prompt..."},...]`;

// ── Scenario card interaction analysis prompt (Gemini → 3 variants per asset) ─
const SCENARIO_ANALYZE_PROMPT =
  `You are an AI image generation prompt engineer specializing in UGC product placement.\n\n` +
  `You receive two images:\n` +
  `1. CHARACTER IMAGE — a photo of the main character (person)\n` +
  `2. ASSET/PROP IMAGE — a product, item, or clothing\n\n` +
  `TASK: Generate exactly 3 creative, DISTINCT interaction scenarios showing how the character physically interacts with the asset.\n` +
  `Focus on variety: different hand positions, poses, or natural usage contexts.\n\n` +
  `Rules:\n` +
  `- Each scenario must be physically realistic given the asset type\n` +
  `- Vary between: left hand / right hand / both hands / overhead / other natural usage\n` +
  `- Label: 2-4 words in Russian (e.g. "В левой руке", "Над головой", "Держит двумя руками")\n` +
  `- Prompt: ~200 chars of precise English generation instructions describing exact hand placement, arm position, how item is held or used, natural grip, item visibility. End with "Photorealistic, 9:16 portrait, 4K, no text."\n\n` +
  `Return ONLY a raw JSON array, no markdown, no extra text:\n` +
  `[{"label":"Русское название","prompt":"English generation instructions..."},...]`;

// ── Edit-pose prompts (applied to existing generated image, 5 camera/body variations) ──
// Placeholder {charDesc} is replaced at runtime with Gemini's character description.
const EDIT_POSE_KEYS = [
  'edit_pose_look_left',
  'edit_pose_look_right',
  'edit_pose_3quarter',
  'edit_pose_head_tilt',
  'edit_pose_chin_up',
];

const EDIT_POSE_PROMPTS = {
  edit_pose_look_left:
    `Same person as in the reference: {charDesc}. ` +
    `Body rotated slightly left (~15°), torso turned left, head turned back toward the camera with direct eye contact. ` +
    `Relaxed natural expression. Preserve exact face, hair color, skin tone, and outfit. ` +
    `Match original lighting direction and background mood. ` +
    `Photorealistic, 9:16 portrait, 4K, no text, no watermarks.`,

  edit_pose_look_right:
    `Same person as in the reference: {charDesc}. ` +
    `Body rotated slightly right (~15°), torso turned right, head turned back toward the camera with direct eye contact. ` +
    `Relaxed natural expression. Preserve exact face, hair color, skin tone, and outfit. ` +
    `Match original lighting direction and background mood. ` +
    `Photorealistic, 9:16 portrait, 4K, no text, no watermarks.`,

  edit_pose_3quarter:
    `Same person as in the reference: {charDesc}. ` +
    `Three-quarter pose: body at ~45° to the camera, shoulders angled away, face turned directly into the lens with confident eye contact. ` +
    `Preserve exact face, hair color, skin tone, and outfit. ` +
    `Match original lighting direction and background mood. ` +
    `Photorealistic, 9:16 portrait, 4K, no text, no watermarks.`,

  edit_pose_head_tilt:
    `Same person as in the reference: {charDesc}. ` +
    `Body facing straight forward, natural head tilt to the right (~10°), soft direct gaze into the camera, relaxed friendly expression. ` +
    `Preserve exact face, hair color, skin tone, and outfit. ` +
    `Match original lighting direction and background mood. ` +
    `Photorealistic, 9:16 portrait, 4K, no text, no watermarks.`,

  edit_pose_chin_up:
    `Same person as in the reference: {charDesc}. ` +
    `Chin slightly raised, confident upward gaze directly into the camera, body relaxed and upright, poised expression. ` +
    `Preserve exact face, hair color, skin tone, and outfit. ` +
    `Match original lighting direction and background mood. ` +
    `Photorealistic, 9:16 portrait, 4K, no text, no watermarks.`,
};

// ── Edit-pose Gemini character analysis prompt ────────────────────────────────
const EDIT_POSE_ANALYZE_PROMPT =
  `Analyze the person in this image and return ONLY a concise single-sentence English description (~60 words) covering: ` +
  `gender, approximate age, hair color and style, facial features, skin tone, clothing (colors, garment types), ` +
  `and current body/camera angle. ` +
  `Return ONLY the description text — no JSON, no labels, no preamble.`;

// ── Pose variation analysis prompt (Gemini → 4 slight pose variation prompts) ──
const POSE_VARIATION_PROMPT =
  `You are an AI image generation expert specializing in subtle pose variation for UGC content.\n\n` +
  `Analyze the person's pose in this image carefully.\n\n` +
  `Return ONLY a raw JSON object (no markdown, no extra text):\n` +
  `{"poseDesc":"Concise current pose: body angle, head tilt, gaze direction, arm/hand position, shot type",` +
  `"variations":[` +
  `{"label":"2-4 слова на русском","prompt":"~300 char EN generation prompt"},` +
  `{"label":"...","prompt":"..."},` +
  `{"label":"...","prompt":"..."},` +
  `{"label":"...","prompt":"..."}` +
  `]}\n\n` +
  `Variation rules:\n` +
  `- Preserve the person's EXACT face, skin tone, hair color, hairstyle, and clothing\n` +
  `- Change ONLY small pose elements: head rotation (5-20°), body turn (10-25°), gaze direction\n` +
  `- Maintain consistent lighting mood and background style from the reference\n` +
  `- All 4 variations must be distinctly different from each other and from the original\n` +
  `- Each prompt MUST start with: "Same person from reference image."\n` +
  `- Each prompt MUST end with: "Keep face, hair, skin tone, and clothing identical to reference. Photorealistic, 9:16 portrait, 4K, no text, no watermarks."`;

// ── Realism markers addendum for TEMPO analysis (appended when checkbox is on) ─
const REALISM_TEMPO_PROMPT =
  `\n\nADDITIONAL REALISM INSTRUCTION:\n` +
  `Analyze this specific image and select ONLY the realism markers from the list below that genuinely fit this image's context ` +
  `(consider: is skin visible? what lighting type? indoor/outdoor? what clothing materials? is hair detailed? are hands visible?).\n` +
  `DO NOT paste the full list — choose only what contextually matches this image.\n` +
  `Integrate the selected markers naturally into the "generationPrompt" field.\n` +
  `Also add a "realismMarkers" key to the JSON output with the selected markers as a comma-separated English string.\n\n` +
  `Available realism markers:\n` +
  `Camera/lens: phone-camera realism, subtle sensor grain, slight edge softness\n` +
  `No retouching: unretouched, no smoothing, no beauty filters, no airbrushing\n` +
  `Lighting: indoor near window, natural contrast, accurate white balance, soft side lighting\n` +
  `Face anatomy: no symmetry correction\n` +
  `Style: shallow depth of field, editorial realism\n` +
  `Skin texture: visible pores, fine micro-texture, subtle under-eye texture\n` +
  `Skin imperfections: organic acne marks (non-repeating), uneven pigmentation, subtle redness, visible fine lines, acne scars\n` +
  `Skin sheen: natural oil sheen only on high points\n` +
  `Hair: natural flyaways\n` +
  `Hands/body: visible veins, hand anatomy, realistic proportions\n` +
  `Fabric: clear fabric texture separation`;

// ── Ref / uploaded image deep analysis prompt (Gemini 3.1 Pro) ───────────────
const REF_ANALYZE_PROMPT =
  `You are a professional AI image generation prompt engineer and colorist.\n` +
  `Analyze this image in exhaustive technical detail and return ONLY a raw JSON object (no markdown, no code blocks):\n` +
  `{\n` +
  `  "title": "Short descriptive title in Russian (3-6 words)",\n` +
  `  "generationPrompt": "A hyper-detailed English generation prompt (300-500 words) to EXACTLY reproduce this image. ` +
  `Include: (1) Subject — who/what is in frame, exact pose, expression, clothing colors & textures, accessories, skin tone, hair; ` +
  `(2) Composition — shot type (close-up/medium/full), camera angle, depth of field, focal point, framing; ` +
  `(3) Lighting — direction (front/side/back/rim), quality (hard/soft/diffused), color temperature (warm/cool/neutral), ` +
  `catchlights, shadow density and direction; ` +
  `(4) Color grading & filters — overall palette, dominant hues, saturation level, contrast, ` +
  `shadows color cast (e.g. teal, blue, green), highlights color cast (e.g. orange, yellow, pink), ` +
  `midtone shifts, film emulation style if visible (e.g. Kodak Portra 400, Fuji Velvia, matte blacks, faded film look, ` +
  `orange-teal grade, moody desaturated, warm split-tone, cool blue tint, vintage faded wash); ` +
  `(5) Background — setting type, colors, bokeh quality, environmental details; ` +
  `(6) Technical quality markers — grain/noise level, sharpness, lens characteristics (wide/telephoto), ` +
  `any post-processing artifacts. End with: Photorealistic, [quality tags].",\n` +
  `  "colorProfile": "Concise English description of color grading: dominant tones, filter style, ` +
  `color cast in shadows/mids/highlights, saturation level (vivid/muted/desaturated), contrast (high/low/medium), ` +
  `film emulation or style name if recognizable.",\n` +
  `  "subjects": "Describe all visible people and objects: appearance, clothing, action, position in frame.",\n` +
  `  "technicalMarkers": "List specific detected visual effects: bokeh depth, grain level, lens flare, vignette, ` +
  `chromatic aberration, motion blur, HDR tone mapping, beauty retouching level, skin softening, etc.",\n` +
  `  "descriptionRu": "2-3 предложения на русском: что изображено, настроение, контекст."\n` +
  `}`;

// ── Asset pre-generation analysis prompt (Gemini → single combined prompt) ────
const ASSET_PRE_GENERATE_PROMPT =
  `You are an AI image generation prompt engineer specializing in photorealistic character compositing.\n\n` +
  `You see TWO images:\n` +
  `1. ACTIVE IMAGE — the character's current photo (specific pose, clothing, facial expression, background)\n` +
  `2. ASSET IMAGE — the item/clothing/environment to apply to or around the character\n\n` +
  `Additional instruction from user: "{presetPrompt}" (may be empty)\n\n` +
  `TASK: Write exactly ONE image generation prompt in English (~400 characters) that:\n` +
  `(a) Preserves the character's exact pose, body position, facial expression, and non-asset clothing from Image 1\n` +
  `(b) Correctly integrates the asset from Image 2 according to its inferred type:\n` +
  `    - CLOTHING: dress the character in the outfit; keep exact pose; skip bottom garments if legs are not visible in Image 1\n` +
  `    - ENVIRONMENT: place the character into the scene from Image 2; keep identical pose and camera angle from Image 1\n` +
  `    - PROP / DETAIL: character holds the item in their hand(s); natural grip, correct proportional scale\n` +
  `(c) If the user instruction is NOT empty, treat it as the primary direction and refine it using what you observe in both images\n` +
  `(d) End with: "Photorealistic, 9:16 portrait, 4K, no text, no watermarks."\n\n` +
  `Return ONLY the prompt text — no JSON, no labels, no explanations, no preamble.`;

// ── Asset generate default prompts (used when user leaves fields empty) ───────
const LOOKBOOK_DEFAULT_GENERATE_PROMPT =
  `Dress the person from Image 1 in the outfit shown in Image 2. ` +
  `CRITICAL: Do NOT change the person's pose in any way — preserve their exact body position, angle, and stance from Image 1. ` +
  `Apply every visible clothing item from Image 2 that can physically fit the current pose: tops, jackets, outerwear, footwear, and accessories. ` +
  `PANTS / TROUSERS / SKIRTS / SHORTS RULE: If the person's lower body (legs, waist, hips) is NOT visible in Image 1, do NOT add any bottom garments — skip them and apply all other items. ` +
  `Preserve the person's face, skin tone, hair color, body proportions, and facial expression exactly as in Image 1. ` +
  `Keep the same background and lighting from Image 1. ` +
  `The outfit must match colors, patterns, and textures shown in Image 2 precisely. ` +
  `No text overlays, no clothing labels, no watermarks. ` +
  `Photorealistic, natural lighting, seamless compositing, 9:16 portrait format, 4K resolution.`;

const ENVIRONMENT_DEFAULT_GENERATE_PROMPT =
  `Place the person from Image 1 into the environment shown in Image 2. ` +
  `CRITICAL: Preserve the person's exact pose, body position, and camera angle from Image 1 — do not alter their stance, limb positions, or the shooting angle. ` +
  `Keep the person's appearance, clothing, hairstyle, and facial expression completely identical to Image 1. ` +
  `Blend the person naturally into the scene: match ambient lighting direction, color temperature, and cast realistic shadows so they look genuinely present in that specific location. ` +
  `Preserve the atmosphere, mood, and color palette of the environment from Image 2. ` +
  `Do not add any other people. No text, no watermarks, no artificial elements. ` +
  `Photorealistic compositing, 9:16 portrait format, 4K resolution.`;

const DETAIL_DEFAULT_GENERATE_PROMPT =
  `The person from Image 1 {holds the item from Image 2 in their left hand, arm naturally relaxed, item clearly visible|` +
  `holds the item from Image 2 in their right hand raised slightly toward camera at a comfortable angle|` +
  `holds the item from Image 2 in both hands centered in front of their body at natural chest height}. ` +
  `Items are primarily hand-held props — the item ends up in the character's hands by default unless context clearly suggests otherwise (e.g. a hat → worn on the head, a necklace → worn around the neck). ` +
  `Preserve the person's face, skin tone, clothing, pose, and overall appearance exactly as in Image 1. ` +
  `The item must look realistic — match natural grip, correct finger placement, and proper proportional scale. ` +
  `Keep the original background and lighting. No text, no watermarks. ` +
  `Photorealistic, 9:16 portrait format, 4K resolution.`;

// ── Emotion prompts (facial expression modifiers) ────────────────────────────
const EMOTION_KEYS = [
  'neutral', 'smile', 'joy', 'laugh', 'surprise',
  'sadness', 'serious', 'thoughtful', 'confident', 'excitement', 'anger', 'shy',
];

const EMOTION_PROMPTS = {
  neutral:    'Neutral relaxed facial expression, natural composed face, no strong emotion, subtle calm look.',
  smile:      'Warm natural smile, corners of mouth gently raised, soft friendly eyes, pleasant approachable expression.',
  joy:        'Genuine joyful expression, radiant happiness, bright wide eyes full of delight, visible pure joy.',
  laugh:      'Natural open laugh, mouth open with genuine amusement, eyes crinkled, face animated and lively.',
  surprise:   'Surprised expression, wide open eyes, slightly raised eyebrows, open mouth, genuine astonishment.',
  sadness:    'Sad melancholy expression, slightly downturned mouth, soft distant eyes, quiet subtle vulnerability.',
  serious:    'Serious composed expression, firm closed mouth, steady direct confident gaze, professional focused look.',
  thoughtful: 'Pensive thoughtful expression, slight head tilt, contemplative inward gaze, calm focused inner thought.',
  confident:  'Confident self-assured expression, subtle knowing smile, strong direct eye contact, composed powerful presence.',
  excitement: 'Excited energetic expression, wide bright sparkling eyes, big open enthusiastic smile, vibrant energy.',
  anger:      'Frustrated tense expression, furrowed brows, tight lips pressed together, intense controlled gaze.',
  shy:        'Shy bashful expression, soft slightly downcast eyes, subtle embarrassed smile, gentle quiet vulnerability.',
};

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
  ROOT_DIR, DATA_DIR, UPLOADS_DIR, LOOKBOOKS_DIR, CHARACTERS_DIR, ENVIRONMENTS_DIR,
  ARCHIVE_DIR, SCENARIOS_DIR, SCENARIOS_ARCHIVE_DIR, DETAILS_DIR, LOGS_DIR, LOG_FILE, SCENES_DIR, SCENES_FILE, TEMP_DIR,
  REFS_DIR, REFS_FILE, FINALS_DIR, SHOTSTACK_KEY,
  SCENE_ANALYSIS_PROMPT, ASSET_INTERACT_ANALYZE_PROMPT, ASSET_PRE_GENERATE_PROMPT, SCENARIO_ANALYZE_PROMPT,
  REF_ANALYZE_PROMPT, REALISM_TEMPO_PROMPT,
  POSE_VARIATION_PROMPT,
  EDIT_POSE_KEYS, EDIT_POSE_PROMPTS, EDIT_POSE_ANALYZE_PROMPT,
  LOOKBOOK_DEFAULT_GENERATE_PROMPT, ENVIRONMENT_DEFAULT_GENERATE_PROMPT, DETAIL_DEFAULT_GENERATE_PROMPT,
  ARCHIVE_SUBDIRS, GALLERY_MAP, KIE_BASE,
  SKIN_PARAMS, NO_RETOUCH,
  EXTRACT_CLOTHING_PROMPT, EXTRACT_BG_PROMPT, APPLY_LOOKBOOK_PROMPT, APPLY_ENV_PROMPT,
  TPOSE_PROMPT, EXTRACT_BG_PROMPT_SQ,
  POSE_KEYS, POSE_PROMPTS,
  EMOTION_KEYS, EMOTION_PROMPTS,
};
