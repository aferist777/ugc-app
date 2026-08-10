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
const TEMP_PUBLIC_DIR  = path.join(ROOT_DIR, 'temp_public');
const OBRAZY_DIR       = path.join(ROOT_DIR, 'obrazy');
const OBRAZY_FILE      = path.join(ROOT_DIR, 'data', 'obrazy.json');
const CHARACTERS_DB_FILE = path.join(ROOT_DIR, 'data', 'characters.json');
const OBRAZY_MIGRATED_FLAG = path.join(ROOT_DIR, 'data', '.obrazy-migrated');
const REFS_DIR         = path.join(ROOT_DIR, 'refs');
const REFS_FILE        = path.join(DATA_DIR, 'refs.json');
const FINALS_DIR       = path.join(ROOT_DIR, 'finals');
const HOOKS_DIR        = path.join(ROOT_DIR, 'hooks');
const HOOKS_THUMB_DIR  = path.join(ROOT_DIR, 'hooks', 'thumbs');
// vsl/ stays gone (Ph15). hooks/ came back: the media was deleted, the feature was not.

const ARCHIVE_SUBDIRS = ['character', 'lookbook', 'environment'];

const GALLERY_MAP = {
  'characters':   { dir: CHARACTERS_DIR,   archiveSub: 'character' },
  'lookbooks':    { dir: LOOKBOOKS_DIR,    archiveSub: 'lookbook' },
  'environments': { dir: ENVIRONMENTS_DIR, archiveSub: 'environment' },
};

// Ensure all dirs exist at startup
for (const d of [UPLOADS_DIR, LOOKBOOKS_DIR, CHARACTERS_DIR, ENVIRONMENTS_DIR,
                 ARCHIVE_DIR, SCENARIOS_DIR, SCENARIOS_ARCHIVE_DIR, DETAILS_DIR, LOGS_DIR, SCENES_DIR, DATA_DIR, TEMP_DIR, TEMP_PUBLIC_DIR, OBRAZY_DIR, REFS_DIR, FINALS_DIR, HOOKS_DIR, HOOKS_THUMB_DIR]) {
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
  `Flat lay product photography. ` +
  `Faithfully reproduce every clothing item and accessory worn by the person in the reference photo — ` +
  `exact same colors, patterns, prints, fabrics, cuts, and designs as seen in the image. ` +
  `Lay each piece flat on a pure white background: tops, bottoms, dresses, jackets, footwear, bags, hats, belts, jewelry — every visible item, nothing invented. ` +
  `No human figures, no body parts, no mannequin, no shadows, no watermarks, no text, no annotations, no arrows. ` +
  `Photorealistic product shot, sharp focus, high detail, 1:1 square format.`;

const EXTRACT_BG_PROMPT =
  `Extract and faithfully reconstruct the background environment from the reference image — ` +
  `same location, same interior or exterior, same colors, same lighting, same furniture, same decor, same architecture, same atmosphere. ` +
  `Remove all people and human figures completely — seamlessly fill any gaps where people were. ` +
  `Show only the setting exactly as seen in the reference: walls, floors, objects, scenery, sky. ` +
  `1:1 square format, 4K ultra-high resolution, photorealistic.`;

// Environment extraction that PRESERVES the source photo's exact camera angle and
// colour processing (used by the Scenarios environment popup's "extract from photo").
const EXTRACT_ENV_PROMPT =
  `Recreate the background environment of the reference image as an empty scene. ` +
  `KEEP the exact camera angle, perspective, framing, height and lens/focal length of the reference — do not re-frame, re-angle, zoom or re-center the scene. ` +
  `KEEP the exact colour grading, white balance, tone, contrast, saturation and overall colour processing of the reference — the look and mood must match the original photo precisely. ` +
  `Same location, same lighting direction and intensity, same furniture, decor, architecture, textures and atmosphere. ` +
  `Remove every person and human figure completely — seamlessly fill any area they occupied so nothing of them remains. ` +
  `Show only the setting: walls, floors, objects, scenery, sky. No people, no text, no watermarks. ` +
  `1:1 SQUARE format (centered, leaving room to later crop to 9:16 or 16:9), 4K ultra-high resolution, photorealistic.`;

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
  `Extract and faithfully reconstruct the background environment from the reference image — ` +
  `same location, same interior or exterior, same colors, same lighting, same furniture, same decor, same architecture, same atmosphere. ` +
  `Remove all people and human figures completely — seamlessly fill any gaps where people were. ` +
  `Show only the setting exactly as seen in the reference: walls, floors, objects, scenery, sky. ` +
  `Square 1:1 format, 4K ultra-high resolution, photorealistic.`;

// ── Persistent character (actor) reference sheet ─────────────────────────────
// ONE combined 4K sheet generated automatically on "Save char" (nano-banana-2).
// The active image is used ONLY as an identity reference — its clothing, pose,
// background and props are discarded and replaced with a neutral flesh-toned
// bodysuit on white, so the sheet is a clean reusable "blank" of the actor.
// Layout: large portrait close-up + full-body turnaround on a single wide sheet.
// Consumed as the appearance reference for photoshoot/pose generation in
// Scenarios (identity + physique in one image).
const CHAR_SHEET_PROMPT =
  `Single combined character reference sheet of the SAME person from the reference image, ` +
  `everything on ONE wide sheet over a pure white seamless background, arranged side by side: ` +
  `on the LEFT a LARGE head-and-shoulders portrait close-up (front view, calm neutral expression, mouth closed) ` +
  `with clearly readable facial details — face shape, eyes, nose, lips, skin texture, hairline; ` +
  `on the RIGHT the SAME person standing full-body from three angles in a row — front view, side profile view and back view — ` +
  `standing naturally upright with arms relaxed at the sides, feet together, whole body visible head to toe ` +
  `so the height, build and body proportions are clearly readable. ` +
  `Ignore and discard the clothing, background, pose and props from the reference — instead the person wears a plain ` +
  `flesh-toned skin-tight seamless full-body bodysuit with no patterns, logos or visible seams (neutral wardrobe). ` +
  `Remove any hat, cap, hood, headscarf, helmet or other headwear — the head must be completely bare with the natural hair fully visible. ` +
  `Faithfully preserve the exact face shape, facial features, skin tone, hair color, hairstyle, body proportions and height from the reference. ` +
  `Every figure on the sheet MUST be the same single person. ` +
  `Soft even studio lighting, no cast shadows on the background. ` +
  `Wide 16:9 format, photorealistic, sharp focus, high detail, no text, no labels, no arrows, no watermarks.`;

// ── Asset interaction analysis prompt (Gemini 3.1 Pro, multimodal) ───────────
const ASSET_INTERACT_ANALYZE_PROMPT =
  `You are a creative director specializing in AI image generation and UGC content compositing.\n` +
  `You receive two images:\n` +
  `1. ACTIVE IMAGE — a photo of the main CHARACTER (person). They are the protagonist of every scene you generate.\n` +
  `2. ASSET IMAGE — the item named "{name}" that the character will interact with.\n\n` +
  `User context (may be empty):\n` +
  `- Asset name: "{name}"{assetSizeClause}\n` +
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
  `- Each scenario must be physically realistic given the asset type{assetSizeClause}\n` +
  `- If real dimensions are given, reflect them in every prompt: a small item (≤8 cm) fits in one hand; a medium item (8–25 cm) may use one or two hands; a large item (>25 cm) requires two hands or a supported carry. Include the dimension figure in the prompt text (e.g. "the 12×8×4 cm item").\n` +
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
  `Carefully analyze this character image: their exact appearance (face, skin tone, hair, clothing, background environment, lighting).\n\n` +
  `Generate 4 variation prompts for this SPECIFIC character in this SPECIFIC environment.\n\n` +
  `Return ONLY a raw JSON object (no markdown, no extra text):\n` +
  `{"poseDesc":"Current pose: body angle, head tilt, gaze, arm/hand position, shot type, background summary",` +
  `"variations":[` +
  `{"label":"2-4 слова на русском","prompt":"detailed EN generation prompt"},` +
  `{"label":"...","prompt":"..."},` +
  `{"label":"...","prompt":"..."},` +
  `{"label":"...","prompt":"..."}` +
  `]}\n\n` +
  `ABSOLUTE RULES — violating any of these makes the variation unusable:\n` +
  `1. HANDS VISIBLE & OPEN: Both hands must be fully visible in a natural, relaxed open position. No fists, no props, no pockets. Hands can rest at sides, lightly touch chest, or be in a casual gesture — but always clearly visible with all fingers visible.\n` +
  `2. ARMS NOT CROSSED: Arms must NEVER be folded or crossed over the chest. This is a hard rule — no exceptions.\n` +
  `3. NO OBJECT INTERACTION: The character does NOT hold, touch, grip, or interact with any object, product, or prop. Empty hands only.\n` +
  `4. CAMERA EYE CONTACT: Character MUST look directly into the camera — eyes straight into the lens for 100% of the frame. Include explicitly: "direct eye contact with camera, eyes looking straight into the lens".\n` +
  `5. IDENTITY PRESERVED: Same person — exact face, skin tone, hair color, hairstyle, clothing, background, and lighting as in the reference image.\n\n` +
  `Pose variation scope (stay within these limits):\n` +
  `- Body rotation: 10-25° left or right from camera axis\n` +
  `- Head rotation: 5-15° tilt or turn, always ending with direct eye contact\n` +
  `- Shoulder/chest angle: slight 3/4 turn at most\n` +
  `- All 4 variations must be distinctly different from each other and from the original\n\n` +
  `Each prompt MUST:\n` +
  `- Start with: "Same person from reference image, identical face and clothing."\n` +
  `- Describe the specific pose for THIS character in THIS background/environment (reference the actual background details you see)\n` +
  `- Include: "both hands visible, open relaxed position, arms not crossed, not holding anything"\n` +
  `- Include: "direct eye contact with camera, eyes looking straight into the lens"\n` +
  `- End with: "Keep face, hair, skin tone, and clothing identical to reference. Photorealistic, 9:16 portrait, 4K, no text, no watermarks."`;

// ── Photoshoot pose analysis (Character ▶ Save obraz popup) ───────────────────
// Vision → LOCKED appearance + environment (must stay identical) + exactly 4
// editable pose descriptions (+ short example tweaks for the ai-insert field).
// The environment / camera / clothing must NEVER change — only the pose.
const PHOTOSHOOT_POSE_ANALYZE_PROMPT =
  `You are a photo art director planning a 4-shot photoshoot of ONE person, varying ONLY their pose.\n\n` +
  `Look carefully at the supplied photo, describe exactly what you see, then plan 4 pose variations.\n\n` +
  `Return ONLY a raw JSON object (no markdown, no commentary):\n` +
  `{` +
  `"appearance":"<the person's identity AND exact clothing: face, skin tone, hair color/style, and every garment with its colours/materials, exactly as seen>",` +
  `"environment":"<the exact background, setting, props, lighting, time of day, and camera framing/angle/shot type, exactly as seen>",` +
  `"poses":[` +
  `{"label":"2-4 слова на русском","pose":"<ONE English sentence describing ONLY the body pose: position of arms/hands and head tilt/turn, plus gaze>","examples":["<short pose tweak, 2-4 words RU>","<another>","<another>"]},` +
  `{"label":"...","pose":"...","examples":["...","...","..."]},` +
  `{"label":"...","pose":"...","examples":["...","...","..."]},` +
  `{"label":"...","pose":"...","examples":["...","...","..."]}` +
  `]}\n\n` +
  `HARD RULES:\n` +
  `1. "appearance" and "environment" are LOCKED — they describe what MUST stay IDENTICAL in every shot. Never invent or change clothing, background, setting, props, lighting, camera angle, or framing.\n` +
  `2. Each "pose" changes ONLY the body: a slight, natural repositioning of the arms/hands and a slight head tilt or turn. Keep movements subtle, photoreal and flattering.\n` +
  `3. HANDS: both hands fully visible, open and relaxed, never crossed, never in pockets, never holding or touching any object.\n` +
  `4. GAZE — split the 4 poses 50/50: poses 1 and 2 look DIRECTLY into the camera (eye contact); poses 3 and 4 look slightly off to the side, away from the lens. State the gaze explicitly in each "pose".\n` +
  `5. All 4 poses must be clearly different from each other.\n` +
  `6. "pose" must describe ONLY the pose/gaze — it must NOT mention clothing, background, environment, lighting, or camera (those live in the locked fields).\n` +
  `7. "examples" = 2-3 very short alternative pose tweaks the user could ask for (e.g. "приподнять подбородок", "рука на бедре", "плечи чуть левее") — Russian, 2-4 words each.`;

// ── Photoshoot ai-insert: merge a user note into ONE pose description ──────────
// {POSE} and {NOTE} are substituted at request time. Body/hands/head/gaze only.
const PHOTOSHOOT_POSE_AI_INSERT_PROMPT =
  `You refine ONE pose description for a photoshoot shot.\n` +
  `CURRENT POSE: {POSE}\n` +
  `USER REQUEST: {NOTE}\n\n` +
  `Rewrite the pose as ONE concise English sentence that naturally incorporates the user's request. ` +
  `Describe ONLY the body pose: arms/hands, head tilt/turn, and gaze. ` +
  `Keep both hands visible, open, relaxed, not crossed, not holding anything. ` +
  `Do NOT mention or change clothing, background, environment, lighting, or camera. ` +
  `Return ONLY the rewritten pose sentence — no labels, no quotes, no commentary.`;

// ── Realism marker library (casual home-video look, NOT hyperrealism) ─────────
// Injected into the prompt compiler so every "character in a scene" generation
// mimics ordinary tripod home footage. NOTE: never name a phone / brand in the
// prompt — the model renders the device in-frame; describe only the optics.
const REALISM_SPEC =
  `CAMERA: shot at a 24mm-equivalent wide angle, f/1.8, on a tripod at eye level, casual home-video framing, natural HDR look, crisp but natural everyday-photo sharpness.\n` +
  `SKIN: real skin with visible pores, natural peach fuzz / vellus hair, subtle imperfections and faint freckles, a light natural sheen on the T-zone — never airbrushed, smooth, waxy or plastic.\n` +
  `EYES & HAIR: glossy, slightly wet eyes with a sharp catchlight and visible iris detail, separated natural eyelashes; individual hair strands with a few flyaways, visible roots / scalp at the part.\n` +
  `HANDS: anatomically correct hands, skin folds over the knuckles, faint veins on the back of the hand, natural fingernails with visible lunula and cuticle texture.\n` +
  `CLOTHING: visible fabric weave and stitching, natural creases and folds from gravity, slight real-world wear (stray threads, tiny pills, lint on dark fabric).\n` +
  `LIGHTING: match the scene — indoors: soft window light plus mixed indoor lighting; outdoors: natural daylight with Smart HDR and an occasional subtle lens flare; keep slight digital noise in the shadows.\n` +
  `COLOR: natural, true-to-life colour, no heavy grade — the look of an ordinary good phone photo.\n` +
  `AVOID: smooth / airbrushed / poreless skin, plastic or waxy look, CGI, 3D render, hyperrealistic, oil painting, illustration, anime, cartoon, over-saturation, beauty-filter, bad anatomy, deformed or extra fingers, malformed hands, any phone / camera / device visible in frame, hands holding a phone, selfie stick.`;

// ── Prompt compiler (Hermes → strict JSON image spec) ─────────────────────────
// {RAW} = the scene/intent prompt; {REALISM} = REALISM_SPEC; {LOCK} = optional
// hard-lock clause. Output is parsed + serialized into one rich prompt string.
const IMAGE_PROMPT_COMPILE_PROMPT =
  `You are a prompt engineer for a photorealistic image model. Turn the SCENE below into a strict JSON image-generation spec that looks like an ordinary photo of a real person filming themselves at home or outdoors — NOT a glossy studio shot or a hyperreal render.\n\n` +
  `SCENE (preserve every concrete detail — subject identity, exact clothing, environment, framing and pose; do NOT add, drop, or change clothing / background / camera):\n{RAW}\n\n` +
  `REALISM GUIDE (apply these markers; adapt LIGHTING to the scene's environment):\n{REALISM}\n\n{LOCK}` +
  `Return ONLY a raw JSON object (no markdown, no commentary):\n` +
  `{` +
  `"scene":"<one vivid paragraph: the subject, their exact clothing, the environment, and the pose/gaze — faithfully from SCENE>",` +
  `"camera":"<the casual wide-angle camera / lens / tripod framing line — never name a phone or brand>",` +
  `"lighting":"<lighting that fits THIS scene's environment>",` +
  `"texture":"<skin + eyes + hair + hands + clothing realism markers>",` +
  `"color":"<natural colour / grade line>",` +
  `"negative":"<comma-separated things to avoid>"` +
  `}`;

// Models for the prompt-compiler / image analysis (OpenRouter slugs).
const IMG_VISION_MODEL  = 'qwen/qwen3.7-plus';        // image analysis (vision); falls back to kie cascade
const IMG_COMPILE_MODEL = 'nousresearch/hermes-4-70b'; // strict-JSON structuring (text)
const CHAR_OPTIMIZE_MODEL = 'nousresearch/hermes-4-405b'; // character-creator "AI-optimize" portrait prompt (text)

// ── Apply pose: vision analysis → ready generation prompt (Character ▶ Pose) ─
// {POSE} placeholder is substituted at request time with the user-selected pose
// (either a built-in `param_pose_scene_*` template or custom prompt).
const APPLY_POSE_ANALYZE_PROMPT =
  `You will be given a photo of a person and a new pose to apply to them. Write a photorealistic image generation prompt that places the SAME person in the new pose.\n\n` +
  `Hard rules:\n` +
  `- Describe ONLY the person's identity: face shape, eyes, nose, lips, skin tone, hair color and style, and the clothing they are wearing. Take these details from the source image.\n` +
  `- Do NOT mention or describe the person's current pose, current body position, current location, current furniture, current background, current props, or current camera angle. Treat all of those as already discarded — only the person's identity is preserved.\n` +
  `- Place this person fully in the following new scene and pose, which completely replaces the original setting:\n` +
  `{POSE}\n` +
  `- Add lighting and composition that fit ONLY the new scene above.\n\n` +
  `Return only the final generation prompt as one coherent English paragraph. No labels, no preamble, no markdown.`;

// ── Apply emotion: vision analysis → ready generation prompt (Character ▶ Emotion) ─
// {EMOTION} placeholder is substituted at request time with the user-selected emotion
// (either a built-in `emotion_*` template or custom prompt).
const APPLY_EMOTION_ANALYZE_PROMPT =
  `You will be given a photo of a person and a new facial expression to apply to them. Write a photorealistic image generation prompt that shows the SAME person with the new expression.\n\n` +
  `Hard rules:\n` +
  `- Describe ONLY the person's identity: face shape, eyes, nose, lips, skin tone, hair color and style, and the clothing they are wearing. Take these details from the source image.\n` +
  `- Apply the following new facial expression as the single dominant change, fully replacing whatever expression is currently visible:\n` +
  `{EMOTION}\n` +
  `- Do NOT describe, name, or hint at any previous facial expression. The new expression is the only one that exists in the output.\n` +
  `- Preserve body pose, camera angle, background, and lighting from the source image — mention them briefly so they stay consistent, but do not redescribe them in detail.\n\n` +
  `Return only the final generation prompt as one coherent English paragraph. No labels, no preamble, no markdown.`;

// ── Apply lookbook (mix): TPDNE/upload face + lookbook → ready generation prompt ─
// Two images go in: image 1 is the active character face (TPDNE / upload),
// image 2 is the lookbook outfit. Vision-LLM must return ONE generation prompt
// that dresses the same person in the lookbook clothing — waist-up, neutral
// contrasting background.
const APPLY_LOOKBOOK_MIX_PROMPT =
  `You will be given TWO images:\n` +
  `- Image 1: a photo of a person (their face is the identity to preserve).\n` +
  `- Image 2: a photo of an outfit / clothing (the lookbook to dress them in).\n\n` +
  `Write a single photorealistic image generation prompt that depicts the SAME person from image 1 wearing the outfit shown in image 2.\n\n` +
  `Hard rules:\n` +
  `- Describe ONLY the person's identity from image 1: face shape, eyes, nose, lips, skin tone, hair color and style.\n` +
  `- Describe the outfit from image 2 in detail: garment types, fabrics, colors, silhouette, fit, any visible accessories.\n` +
  `- Do NOT describe or echo any clothing, pose, body position, location, furniture, background, props, or camera angle from image 1. Image 1 contributes only the face/identity.\n` +
  `- The shot must be a waist-up portrait (the outfit upper half is fully visible).\n` +
  `- Place the person on a plain, neutral background whose color clearly contrasts with the dominant colors of the outfit so the clothing stands out — pick the contrast yourself based on the outfit colors.\n` +
  `- The person stands in a relaxed neutral pose, looking toward the camera, calm neutral expression, soft even studio lighting.\n` +
  `- No text, no watermarks, no other people.\n\n` +
  `Return only the final generation prompt as one coherent English paragraph. No labels, no preamble, no markdown.`;

// ── Realism markers addendum for TEMPO analysis ─────────────────────────────
// The {MARKERS} placeholder is substituted at request time by routes/refs.js
// with the user's selected markers from Brain → Realism markers (settings.js).
// Two sets:
//   • Without "realism" checkbox  →  only "always-applied" groups (no_retouch + skin_texture)
//   • With "realism" checkbox     →  all groups (no_retouch + skin_texture + camera + lighting + anatomy)
const REALISM_TEMPO_PROMPT =
  `\n\nADDITIONAL REALISM INSTRUCTION:\n` +
  `Analyze this specific image and select ONLY the realism markers from the list below that genuinely fit this image's context ` +
  `(consider: is skin visible? what lighting type? indoor/outdoor? what clothing materials? is hair detailed? are hands visible?).\n` +
  `DO NOT paste the full list — choose only what contextually matches this image.\n` +
  `Integrate the selected markers naturally into the "generationPrompt" field.\n` +
  `Also add a "realismMarkers" key to the JSON output with the selected markers as a comma-separated English string.\n\n` +
  `Available realism markers (selected by user in Brain):\n{MARKERS}`;

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

// ── Tempo: beautify pass for the generationPrompt produced by REF_ANALYZE ───
// Runs as a second AI call (text-only, no image) right after vision analysis
// to clean up the raw prompt before it goes into the text-to-image engine.
const REF_BEAUTIFY_PROMPT =
  `You are an elite AI image generation prompt engineer. You will receive a raw English image prompt produced ` +
  `by a vision model. Your job is to polish it for direct use with a text-to-image model.\n\n` +
  `RULES:\n` +
  `1. Preserve every factual detail — subject, pose, clothing, lighting, color grading, background, technical markers. ` +
  `Do NOT drop or invent content; only restructure and clean.\n` +
  `2. Remove duplicates, tautologies, and any meta-leaks (e.g. "[quality tags]", placeholder brackets, instructions to the AI).\n` +
  `3. Reorganize into this exact order: Subject → Pose → Composition → Lighting → Color grade → Background → Technical/quality.\n` +
  `4. Tighten the wording to ~250-350 words total (down from 300-500).\n` +
  `5. English only. Plain text, single paragraph or short paragraphs. No markdown, no JSON, no labels, no preamble.\n` +
  `6. End with exactly: "Photorealistic, 9:16 portrait, 4K, no text, no watermarks."\n` +
  `7. The Subject section MUST explicitly state that the person is looking directly into the camera lens, ` +
  `with strong direct eye contact and gaze aimed straight at the lens. If the input does not say this, add it.\n\n` +
  `Output ONLY the cleaned prompt — nothing else.\n\n` +
  `RAW PROMPT TO BEAUTIFY:\n{RAW_PROMPT}`;

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
  `    - PROP / DETAIL: character holds the item in their hand(s); natural grip, render at correct real-world scale relative to human hand size{assetSizeClause}; if dimensions are given, include them as a scale anchor in your output (e.g. "the approx. 12×8 cm item")\n` +
  `(c) If the user instruction is NOT empty, treat it as the primary direction and refine it using what you observe in both images\n` +
  `(d) End with: "Photorealistic, 9:16 portrait, 4K, no text, no watermarks."\n\n` +
  `Return ONLY the prompt text — no JSON, no labels, no explanations, no preamble.`;

// ── Scene interaction analysis prompt (GPT-4o vision → Claude → Gemini) ──────
const SCENE_INTERACTION_PROMPT =
  `You are an AI image generation prompt engineer specializing in photorealistic character compositing.\n\n` +
  `You receive TWO images:\n` +
  `1. CHARACTER IMAGE (filename: {activeFileName}) — the person (specific pose, visible hands/arms, clothing, expression, background)\n` +
  `2. PRODUCT IMAGE (filename: {assetFileName}) — the item the character will interact with{assetSizeClause}\n\n` +
  `Requested interaction type: "{interactionLabel}"\n\n` +
  `TASK:\n` +
  `1. Analyze the CHARACTER IMAGE: which hands and arms are clearly visible and unobstructed; body pose and orientation; clothing style and colors.\n` +
  `2. Analyze the PRODUCT IMAGE: what it is, its shape. Use the provided real dimensions if available for accurate scale.\n` +
  `3. Validate the requested interaction against what is physically visible in the character image and silently correct if needed:\n` +
  `   - Requested "both hands" but only one hand is visible → use the one visible hand\n` +
  `   - Requested "right hand" but only left hand is visible → switch to left hand\n` +
  `   - Any other anatomically impossible placement → choose the most natural alternative\n` +
  `   - Apply corrections without explanation\n` +
  `4. Write a detailed English image generation prompt that MUST:\n` +
  `   - Start with: "The person from Image 1" to anchor the character reference\n` +
  `   - Reference "the item from Image 2" explicitly when describing the product\n` +
  `   - Describe exactly how the character interacts with the product (precise hand placement, grip style, product orientation and scale); if real dimensions are provided, include them as a scale anchor in your output prompt (e.g. "holds the approx. 12×8×4 cm item") so the image generator renders it at correct real-world proportions\n` +
  `   - Preserve the character's full appearance: clothing, hair, skin tone, lighting, and overall style from Image 1\n` +
  `   - NOT change or describe the background or environment — it remains exactly as-is\n` +
  `   - End with: "Photorealistic, 9:16 portrait, 4K resolution, no text, no watermarks."\n\n` +
  `IMPORTANT: Output ONLY the final English prompt — no explanations, no labels, no JSON, no preamble. Maximum 300 words.\n` +
  `{negativePrompt}`;

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
  `Remove the person from Image 1. ` +
  `Keep the background, scene, environment, lighting, camera angle, depth of field, and color grading exactly as they appear in Image 1. ` +
  `Naturally inpaint the area where the person stood using the surrounding background — no person, no mannequin, no silhouette, no shadow of a removed figure. ` +
  `Preserve the original perspective, atmosphere, and all environmental elements. ` +
  `Photorealistic result, 1:1 square format, 4K resolution.`;

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

// ── Age descriptors — substituted into {age} in pose prompts ──────────────────
const AGE_KEYS = ['18_22','23_27','28_32','33_37','38_42','43_47','48_52','53_57','58_62','63_67','68_72'];
const AGE_PROMPTS = {
  '18_22': '18-22 years old',
  '23_27': '23-27 years old',
  '28_32': '28-32 years old',
  '33_37': '33-37 years old',
  '38_42': '38-42 years old',
  '43_47': '43-47 years old',
  '48_52': '48-52 years old',
  '53_57': '53-57 years old',
  '58_62': '58-62 years old',
  '63_67': '63-67 years old',
  '68_72': '68-72 years old',
};

// ── Detail (предмет) AI analysis prompt ──────────────────────────────────────
const DETAIL_ANALYZE_PROMPT =
  `You are an expert product analyst for UGC video content production.\n` +
  `User notes about this product: "{userNotes}" (may be empty — use visual analysis and your product knowledge)\n\n` +
  `Carefully analyze this product image. Identify the product using visual cues, packaging, logos, shape, and your comprehensive product knowledge database.\n\n` +
  `Return ONLY valid JSON (no markdown, no preamble, no trailing commas):\n` +
  `{\n` +
  `  "title": "Название в 3 слова на русском (точное, конкретное, например: Крем для рук)",\n` +
  `  "description": "Подробное описание на русском, 250-300 слов: что это за продукт, бренд если виден, состав или материал, назначение, целевая аудитория, особенности дизайна, цвет, форма, фактура, отличительные черты",\n` +
  `  "interactions": [\n` +
  `    {"label": "Держит в правой руке", "prompt": "Character holds the item in their right hand at a natural angle, item clearly visible, comfortable grip"},\n` +
  `    {"label": "Держит в левой руке", "prompt": "Character holds the item in their left hand, arm naturally relaxed, item clearly visible"},\n` +
  `    {"label": "Держит двумя руками", "prompt": "Character holds the item in both hands centered in front of their body at natural chest height"},\n` +
  `    {"label": "Использует по назначению", "prompt": "Interaction specific to this product type — describe how a person naturally uses THIS specific product"},\n` +
  `    {"label": "Демонстрирует к камере", "prompt": "Character holds the item facing the camera, arm extended slightly, showing the product's front face clearly"}\n` +
  `  ],\n` +
  `  "size": "PRIMARY — always provide all 3 physical dimensions: height×width×depth (or thickness) in cm or mm, e.g. '12×8×4 cm' or '20cm×15cm×6cm'. For cylindrical items use diameter×height, e.g. '7cm dia × 18cm'. SECONDARY — add volume or weight only if relevant: e.g. '250 ml', '200 g'. If 3D size is impossible to estimate visually, explain why briefly. Never use 2D only without attempting the third dimension.",\n` +
  `  "technicalDetails": "Материал: []; Размер: [approximate dimensions]; Вес: [approximate]; Упаковка: []; Особые характеристики: []",\n` +
  `  "subjects": "English: exact product name, category, brand if visible, key visual attributes",\n` +
  `  "colorProfile": "English: dominant colours, finish (matte/glossy/metallic), texture, packaging style",\n` +
  `  "generationPrompt": "English, max 180 chars: starts with A product photo of [exact item], [colour], [material], placed on [surface], [background], [lighting]."\n` +
  `}\n\n` +
  `For interaction[3] (use by purpose): write a prompt specific to THIS product type. For example: a cream → applying to skin; a phone → looking at screen; a bottle → pouring; a book → reading. Be creative and accurate.`;

// ── Gender descriptors — substituted into {gender} in pose prompts ────────────
const GENDER_KEYS = ['female', 'male'];
const GENDER_PROMPTS = {
  female: 'woman',
  male:   'man',
};

module.exports = {
  ROOT_DIR, DATA_DIR, UPLOADS_DIR, LOOKBOOKS_DIR, CHARACTERS_DIR, ENVIRONMENTS_DIR,
  ARCHIVE_DIR, SCENARIOS_DIR, SCENARIOS_ARCHIVE_DIR, DETAILS_DIR, LOGS_DIR, LOG_FILE, SCENES_DIR, SCENES_FILE, TEMP_DIR, TEMP_PUBLIC_DIR, OBRAZY_DIR, OBRAZY_FILE, OBRAZY_MIGRATED_FLAG,
  REFS_DIR, REFS_FILE, FINALS_DIR, HOOKS_DIR, HOOKS_THUMB_DIR,  ASSET_INTERACT_ANALYZE_PROMPT, ASSET_PRE_GENERATE_PROMPT, SCENE_INTERACTION_PROMPT, SCENARIO_ANALYZE_PROMPT,
  REF_ANALYZE_PROMPT, REALISM_TEMPO_PROMPT, REF_BEAUTIFY_PROMPT,
  POSE_VARIATION_PROMPT,
  PHOTOSHOOT_POSE_ANALYZE_PROMPT, PHOTOSHOOT_POSE_AI_INSERT_PROMPT,
  REALISM_SPEC, IMAGE_PROMPT_COMPILE_PROMPT, IMG_VISION_MODEL, IMG_COMPILE_MODEL, CHAR_OPTIMIZE_MODEL,
  APPLY_POSE_ANALYZE_PROMPT, APPLY_EMOTION_ANALYZE_PROMPT, APPLY_LOOKBOOK_MIX_PROMPT,
  EDIT_POSE_KEYS, EDIT_POSE_PROMPTS, EDIT_POSE_ANALYZE_PROMPT,
  LOOKBOOK_DEFAULT_GENERATE_PROMPT, ENVIRONMENT_DEFAULT_GENERATE_PROMPT, DETAIL_DEFAULT_GENERATE_PROMPT,
  ARCHIVE_SUBDIRS, GALLERY_MAP, KIE_BASE,
  SKIN_PARAMS, NO_RETOUCH,
  EXTRACT_CLOTHING_PROMPT, EXTRACT_BG_PROMPT, EXTRACT_ENV_PROMPT, APPLY_LOOKBOOK_PROMPT, APPLY_ENV_PROMPT,
  TPOSE_PROMPT, EXTRACT_BG_PROMPT_SQ,
  CHAR_SHEET_PROMPT,
  CHARACTERS_DB_FILE,
  POSE_KEYS, POSE_PROMPTS,
  EMOTION_KEYS, EMOTION_PROMPTS,
  AGE_KEYS, AGE_PROMPTS,
  GENDER_KEYS, GENDER_PROMPTS,
  DETAIL_ANALYZE_PROMPT,
};
