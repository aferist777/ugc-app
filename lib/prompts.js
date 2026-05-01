'use strict';

const fs   = require('fs');
const path = require('path');

const {
  EXTRACT_CLOTHING_PROMPT, EXTRACT_BG_PROMPT, EXTRACT_BG_PROMPT_SQ,
  APPLY_LOOKBOOK_PROMPT, APPLY_ENV_PROMPT, TPOSE_PROMPT,
  POSE_KEYS, POSE_PROMPTS, SCENE_ANALYSIS_PROMPT, ASSET_INTERACT_ANALYZE_PROMPT,
  LOOKBOOK_DEFAULT_GENERATE_PROMPT, ENVIRONMENT_DEFAULT_GENERATE_PROMPT, DETAIL_DEFAULT_GENERATE_PROMPT,
  EMOTION_KEYS, EMOTION_PROMPTS, SCENARIO_ANALYZE_PROMPT, POSE_VARIATION_PROMPT,
  EDIT_POSE_KEYS, EDIT_POSE_PROMPTS, EDIT_POSE_ANALYZE_PROMPT, ASSET_PRE_GENERATE_PROMPT, SCENE_INTERACTION_PROMPT,
  REF_ANALYZE_PROMPT, REALISM_TEMPO_PROMPT, DETAIL_ANALYZE_PROMPT,
  APPLY_POSE_ANALYZE_PROMPT, APPLY_EMOTION_ANALYZE_PROMPT, APPLY_LOOKBOOK_MIX_PROMPT,
  AGE_KEYS, AGE_PROMPTS, GENDER_KEYS, GENDER_PROMPTS,
} = require('./config');

const DATA_DIR   = path.join(__dirname, '..', 'data');
const STORE_FILE = path.join(DATA_DIR, 'prompts.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ── Defaults (immutable originals) ───────────────────────────────────────────
const DEFAULTS = {
  EXTRACT_CLOTHING_PROMPT,
  EXTRACT_BG_PROMPT,
  EXTRACT_BG_PROMPT_SQ,
  APPLY_LOOKBOOK_PROMPT,
  APPLY_ENV_PROMPT,
  TPOSE_PROMPT,
};
// Add pose prompts to defaults
POSE_KEYS.forEach(k => { DEFAULTS[k] = POSE_PROMPTS[k]; });
DEFAULTS['SCENE_ANALYSIS_PROMPT'] = SCENE_ANALYSIS_PROMPT;
DEFAULTS['ASSET_INTERACT_ANALYZE_PROMPT'] = ASSET_INTERACT_ANALYZE_PROMPT;
DEFAULTS['SCENARIO_ANALYZE_PROMPT']       = SCENARIO_ANALYZE_PROMPT;
DEFAULTS['POSE_VARIATION_PROMPT']         = POSE_VARIATION_PROMPT;
EDIT_POSE_KEYS.forEach(k => { DEFAULTS[k] = EDIT_POSE_PROMPTS[k]; });
DEFAULTS['LOOKBOOK_DEFAULT_GENERATE_PROMPT']     = LOOKBOOK_DEFAULT_GENERATE_PROMPT;
DEFAULTS['ENVIRONMENT_DEFAULT_GENERATE_PROMPT']  = ENVIRONMENT_DEFAULT_GENERATE_PROMPT;
DEFAULTS['DETAIL_DEFAULT_GENERATE_PROMPT']       = DETAIL_DEFAULT_GENERATE_PROMPT;
DEFAULTS['ASSET_PRE_GENERATE_PROMPT']            = ASSET_PRE_GENERATE_PROMPT;
DEFAULTS['SCENE_INTERACTION_PROMPT']             = SCENE_INTERACTION_PROMPT;
DEFAULTS['EDIT_POSE_ANALYZE_PROMPT']             = EDIT_POSE_ANALYZE_PROMPT;
DEFAULTS['REF_ANALYZE_PROMPT']                   = REF_ANALYZE_PROMPT;
DEFAULTS['REALISM_TEMPO_PROMPT']                 = REALISM_TEMPO_PROMPT;
DEFAULTS['DETAIL_ANALYZE_PROMPT']                = DETAIL_ANALYZE_PROMPT;
DEFAULTS['APPLY_POSE_ANALYZE_PROMPT']            = APPLY_POSE_ANALYZE_PROMPT;
DEFAULTS['APPLY_EMOTION_ANALYZE_PROMPT']         = APPLY_EMOTION_ANALYZE_PROMPT;
DEFAULTS['APPLY_LOOKBOOK_MIX_PROMPT']            = APPLY_LOOKBOOK_MIX_PROMPT;
EMOTION_KEYS.forEach(k => { DEFAULTS[`emotion_${k}`] = EMOTION_PROMPTS[k]; });
AGE_KEYS.forEach(k    => { DEFAULTS[`age_${k}`]     = AGE_PROMPTS[k];     });
GENDER_KEYS.forEach(k => { DEFAULTS[`gender_${k}`]  = GENDER_PROMPTS[k];  });
DEFAULTS['param_age_instruction']         = 'Change the apparent age of the person to {age} years old. Keep everything else identical.';
DEFAULTS['param_gender_instruction']      = 'Transform the person into a {gender}. Keep the same pose, outfit, background, and expression exactly.';
DEFAULTS['param_pose_instruction']        = '{poseScene} Keep the person\'s facial features and identity identical.';
DEFAULTS['param_emotion_instruction']     = 'Change the person\'s facial expression to the following: {emotion}. Keep pose, outfit, and background exactly the same.';
DEFAULTS['param_pose_scene_desk']         = 'Place this person sitting at a desk in a home office with a bookshelf and plant in the background. Professional soft studio lighting.';
DEFAULTS['param_pose_scene_sofa']         = 'Place this person sitting comfortably on a sofa in a cozy living room with cushions and soft furnishings. Warm ambient lighting.';
DEFAULTS['param_pose_scene_window']       = 'Place this person standing near a large window with natural soft daylight from the side. Blurred interior background with curtains.';
DEFAULTS['param_pose_scene_kitchen']      = 'Place this person leaning casually against a kitchen counter. Warm kitchen lighting, modern kitchen background.';
DEFAULTS['param_pose_scene_standing']     = 'Show this person standing upright facing the camera with a clean neutral background. Soft diffused studio lighting.';

// ── Human-readable labels ─────────────────────────────────────────────────────
const LABELS = {
  EXTRACT_CLOTHING_PROMPT: 'Lookbook — outfit extraction (flat lay)',
  EXTRACT_BG_PROMPT:       'Background 16:9 — environment extraction',
  EXTRACT_BG_PROMPT_SQ:    'Background 1:1 — environment extraction',
  APPLY_LOOKBOOK_PROMPT:   'Apply lookbook to character',
  APPLY_ENV_PROMPT:        'Apply environment to character',
  TPOSE_PROMPT:            'T-pose',
  pose_desk:               'Pose 1 — At desk',
  pose_sofa:               'Pose 2 — On sofa',
  pose_window:             'Pose 3 — By window',
  pose_kitchen:            'Pose 4 — In kitchen',
  pose_standing:           'Pose 5 — Standing',
  SCENE_ANALYSIS_PROMPT:                 'Scene analysis',
  ASSET_INTERACT_ANALYZE_PROMPT:         'Asset interaction — variant analysis',
  SCENARIO_ANALYZE_PROMPT:               'Scenario — character + item interaction analysis',
  POSE_VARIATION_PROMPT:                 'Image — pose analysis + 4 variations',
  edit_pose_look_left:  'Edit pose 1 — Look left',
  edit_pose_look_right: 'Edit pose 2 — Look right',
  edit_pose_3quarter:   'Edit pose 3 — Three quarters',
  edit_pose_head_tilt:  'Edit pose 4 — Head tilt',
  edit_pose_chin_up:    'Edit pose 5 — Chin up',
  LOOKBOOK_DEFAULT_GENERATE_PROMPT:      'Asset: default lookbook prompt (dress character)',
  ENVIRONMENT_DEFAULT_GENERATE_PROMPT:   'Asset: default environment prompt (place character)',
  DETAIL_DEFAULT_GENERATE_PROMPT:        'Asset: default item prompt (held in hands, spintax)',
  ASSET_PRE_GENERATE_PROMPT:             'Asset: pre-generation — analysis & prompt assembly',
  SCENE_INTERACTION_PROMPT:             'Edit / Scenarios: character + item interaction analysis → detailed prompt',
  EDIT_POSE_ANALYZE_PROMPT:              'Edit pose: character analysis',
  REF_ANALYZE_PROMPT:                    'Tempo: deep image analysis — prompt + color filters',
  REALISM_TEMPO_PROMPT:                  'Tempo: realism addendum — contextual marker selection (adds to analysis)',
  DETAIL_ANALYZE_PROMPT:                 'Items: AI item analysis — description, interactions, prompt',
  APPLY_POSE_ANALYZE_PROMPT:             'Apply pose ▶: image analysis → generation prompt',
  APPLY_EMOTION_ANALYZE_PROMPT:          'Apply emotion ▶: image analysis → generation prompt',
  APPLY_LOOKBOOK_MIX_PROMPT:             'Apply lookbook (TPDNE/upload mix): face + outfit → dressed waist-up portrait prompt',
  age_18_22: 'Age: 18–22',
  age_23_27: 'Age: 23–27',
  age_28_32: 'Age: 28–32',
  age_33_37: 'Age: 33–37',
  age_38_42: 'Age: 38–42',
  age_43_47: 'Age: 43–47',
  age_48_52: 'Age: 48–52',
  age_53_57: 'Age: 53–57',
  age_58_62: 'Age: 58–62',
  age_63_67: 'Age: 63–67',
  age_68_72: 'Age: 68–72',
  gender_female: 'Gender: Female',
  gender_male:   'Gender: Male',
  emotion_neutral:    'Emotion: Neutral',
  emotion_smile:      'Emotion: Smile',
  emotion_joy:        'Emotion: Joy',
  emotion_laugh:      'Emotion: Laugh',
  emotion_surprise:   'Emotion: Surprise',
  emotion_sadness:    'Emotion: Sadness',
  emotion_serious:    'Emotion: Serious',
  emotion_thoughtful: 'Emotion: Thoughtful',
  emotion_confident:  'Emotion: Confident',
  emotion_excitement: 'Emotion: Excitement',
  emotion_anger:      'Emotion: Anger',
  emotion_shy:        'Emotion: Shy',
  param_age_instruction:         'Parameter: age application (Age ▶)',
  param_gender_instruction:      'Parameter: gender application (Gender ▶)',
  param_pose_instruction:        'Parameter: pose instruction template (Pose ▶)',
  param_emotion_instruction:     'Parameter: emotion instruction template (Emotion ▶)',
  param_pose_scene_desk:         'Pose (▶): scene — At desk',
  param_pose_scene_sofa:         'Pose (▶): scene — On sofa',
  param_pose_scene_window:       'Pose (▶): scene — By window',
  param_pose_scene_kitchen:      'Pose (▶): scene — In kitchen',
  param_pose_scene_standing:     'Pose (▶): scene — Standing',
};

// ── Fixed phrases per prompt (bold = do not change) ───────────────────────────
const FIXED_PHRASES = {
  EXTRACT_CLOTHING_PROMPT: [
    'worn by the person in the reference image',
    'Clean product photography, sharp focus, high detail, 1:1 square format.',
  ],
  EXTRACT_BG_PROMPT: [
    'Remove the person from this photo using inpainting. Fill the area where the person stood with the surrounding background — match the existing textures, colors, lighting, and patterns exactly.',
    'Do NOT change anything else: keep the exact same camera angle, perspective, focal length, depth of field, lighting conditions, color grading, and overall composition.',
    'Do NOT enhance quality, do NOT change style, do NOT add or remove any objects other than the person.',
    'The output must look like the original photo taken without a person in it — same grain, same sharpness, same atmosphere.',
  ],
  EXTRACT_BG_PROMPT_SQ: [
    'Remove the person from this photo using inpainting. Fill the area where the person stood with the surrounding background — match the existing textures, colors, lighting, and patterns exactly.',
    'Do NOT change anything else: keep the exact same camera angle, perspective, focal length, depth of field, lighting conditions, color grading, and overall composition.',
    'Do NOT enhance quality, do NOT change style, do NOT add or remove any objects other than the person.',
    'The output must look like the original photo taken without a person in it — same grain, same sharpness, same atmosphere.',
  ],
  APPLY_LOOKBOOK_PROMPT: [
    'Dress the person from Image 1 in the outfit shown in Image 2.',
    'PANTS / TROUSERS / SKIRTS / SHORTS RULE: If the person\'s lower body is NOT visible in Image 1, skip all bottom garments and apply only the visible items.',
  ],
  APPLY_ENV_PROMPT: [
    'Place the person from Image 1 into the environment shown in Image 2.',
    'CRITICAL: Preserve the person\'s exact pose, body position, and camera angle from Image 1 — do not alter stance or shooting angle.',
  ],
  TPOSE_PROMPT: [
    'Full-body T-pose of the person from the reference image, waist-up in a square 1:1 format.',
    'Arms extended horizontally in a classic T-pose.',
    '4K ultra-high resolution, photorealistic, sharp focus.',
  ],
  // Pose prompts: {gender} and {age} must stay for substitution to work
  pose_desk:     ['{gender}', '{age}'],
  pose_sofa:     ['{gender}', '{age}'],
  pose_window:   ['{gender}', '{age}'],
  pose_kitchen:  ['{gender}', '{age}'],
  pose_standing: ['{gender}', '{age}'],
  SCENE_ANALYSIS_PROMPT: [],
  SCENARIO_ANALYZE_PROMPT:               ['{assetSizeClause}'],
  ASSET_INTERACT_ANALYZE_PROMPT: ['{name}', '{exhon}', '{activnoe}', '{assetSizeClause}'],
  POSE_VARIATION_PROMPT: [],
  ...Object.fromEntries(EDIT_POSE_KEYS.map(k => [k, ['{charDesc}']])),
  LOOKBOOK_DEFAULT_GENERATE_PROMPT:    [],
  ENVIRONMENT_DEFAULT_GENERATE_PROMPT: [],
  DETAIL_DEFAULT_GENERATE_PROMPT:      [],
  ASSET_PRE_GENERATE_PROMPT:           ['{presetPrompt}', '{assetSizeClause}'],
  SCENE_INTERACTION_PROMPT:            ['{interactionLabel}'],
  EDIT_POSE_ANALYZE_PROMPT:            [],
  REF_ANALYZE_PROMPT:                  [],
  REALISM_TEMPO_PROMPT:                [],
  // {POSE} / {EMOTION} are placeholders substituted at request time.
  APPLY_POSE_ANALYZE_PROMPT:           ['{POSE}'],
  APPLY_EMOTION_ANALYZE_PROMPT:        ['{EMOTION}'],
  APPLY_LOOKBOOK_MIX_PROMPT:           [],
  DETAIL_ANALYZE_PROMPT:               ['{userNotes}'],
  ...Object.fromEntries(EMOTION_KEYS.map(k => [`emotion_${k}`, []])),
  ...Object.fromEntries(AGE_KEYS.map(k    => [`age_${k}`,     []])),
  ...Object.fromEntries(GENDER_KEYS.map(k => [`gender_${k}`,  []])),
  param_age_instruction:     ['{age}'],
  param_gender_instruction:  ['{gender}'],
  param_pose_instruction:    ['{poseScene}'],
  param_emotion_instruction: ['{emotion}'],
  param_pose_scene_desk:     [],
  param_pose_scene_sofa:     [],
  param_pose_scene_window:   [],
  param_pose_scene_kitchen:  [],
  param_pose_scene_standing: [],
};

// ── Store helpers ─────────────────────────────────────────────────────────────
function loadStore() {
  try {
    if (fs.existsSync(STORE_FILE))
      return JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
  } catch {}
  return {};
}

function saveStore(store) {
  fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2), 'utf8');
}

// ── Public API ────────────────────────────────────────────────────────────────
function getPrompt(key) {
  const store = loadStore();
  return store[key]?.current ?? DEFAULTS[key] ?? '';
}

function saveVersion(key, text) {
  const store = loadStore();
  if (!(key in DEFAULTS) && !store[key]?.isDynamic) throw new Error('Unknown prompt key: ' + key);
  if (!store[key]) store[key] = { current: DEFAULTS[key], versions: [] };
  // Save previous current as a historical version
  store[key].versions = store[key].versions || [];
  store[key].versions.unshift({ text: store[key].current, ts: new Date().toISOString() });
  store[key].versions = store[key].versions.slice(0, 10);
  store[key].current = text;
  saveStore(store);
}

function resetPrompt(key) {
  if (!(key in DEFAULTS)) throw new Error('Unknown prompt key (static only): ' + key);
  const store = loadStore();
  if (!store[key]) store[key] = { versions: [] };
  // Archive current before reset
  if (store[key].current && store[key].current !== DEFAULTS[key]) {
    store[key].versions = store[key].versions || [];
    store[key].versions.unshift({ text: store[key].current, ts: new Date().toISOString() });
    store[key].versions = store[key].versions.slice(0, 10);
  }
  store[key].current = DEFAULTS[key];
  saveStore(store);
}

function getAllPrompts() {
  const store = loadStore();
  const staticItems = Object.keys(DEFAULTS).map(key => ({
    key,
    label:        store[key]?.customLabel ?? LABELS[key] ?? key,
    defaultLabel: LABELS[key] ?? key,
    customLabel:  store[key]?.customLabel ?? null,
    fixedPhrases: FIXED_PHRASES[key] || [],
    current:      store[key]?.current ?? DEFAULTS[key],
    default:      DEFAULTS[key],
    versions:     store[key]?.versions ?? [],
    isDynamic:    false,
    isHidden:     store[key]?.isHidden ?? false,
  }));
  const dynamicItems = Object.entries(store)
    .filter(([, v]) => v.isDynamic && v.current)
    .map(([key, v]) => ({
      key,
      label:        v.customLabel ?? v.dynamicLabel ?? key,
      defaultLabel: v.dynamicLabel ?? key,
      customLabel:  v.customLabel ?? null,
      fixedPhrases: v.dynamicFixedPhrases || [],
      current:      v.current,
      default:      v.current, // dynamic prompts have no factory default
      versions:     v.versions ?? [],
      isDynamic:    true,
    }));
  return [...staticItems, ...dynamicItems];
}

function renamePrompt(key, customLabel) {
  const store = loadStore();
  if (!(key in DEFAULTS) && !store[key]?.isDynamic) throw new Error('Unknown prompt key: ' + key);
  if (!store[key]) store[key] = {};
  if (customLabel) {
    store[key].customLabel = customLabel;
  } else {
    delete store[key].customLabel;
  }
  saveStore(store);
}

// ── Dynamic prompts (e.g. biroly category prompts) ────────────────────────────
function saveDynamicPrompt(key, text, label, fixedPhrases) {
  const store = loadStore();
  if (!store[key]) store[key] = { versions: [] };
  if (store[key].current) {
    store[key].versions = store[key].versions || [];
    store[key].versions.unshift({ text: store[key].current, ts: new Date().toISOString() });
    store[key].versions = store[key].versions.slice(0, 10);
  }
  store[key].current = text;
  if (label     !== undefined) store[key].dynamicLabel       = label;
  if (fixedPhrases !== undefined) store[key].dynamicFixedPhrases = fixedPhrases;
  store[key].isDynamic = true;
  saveStore(store);
}

function deleteDynamicPrompt(key) {
  const store = loadStore();
  if (!store[key]?.isDynamic) return false;
  delete store[key];
  saveStore(store);
  return true;
}

function hidePrompt(key) {
  const store = loadStore();
  if (!(key in DEFAULTS) && !store[key]?.isDynamic) throw new Error('Unknown prompt key: ' + key);
  if (!store[key]) store[key] = {};
  store[key].isHidden = true;
  saveStore(store);
  return true;
}

module.exports = { getPrompt, saveVersion, resetPrompt, getAllPrompts, renamePrompt, saveDynamicPrompt, deleteDynamicPrompt, hidePrompt, DEFAULTS, LABELS };
