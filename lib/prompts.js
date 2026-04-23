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
EMOTION_KEYS.forEach(k => { DEFAULTS[`emotion_${k}`] = EMOTION_PROMPTS[k]; });
AGE_KEYS.forEach(k    => { DEFAULTS[`age_${k}`]     = AGE_PROMPTS[k];     });
GENDER_KEYS.forEach(k => { DEFAULTS[`gender_${k}`]  = GENDER_PROMPTS[k];  });

// ── Human-readable labels ─────────────────────────────────────────────────────
const LABELS = {
  EXTRACT_CLOTHING_PROMPT: 'Лукбук — извлечение одежды (flat lay)',
  EXTRACT_BG_PROMPT:       'Фон 16:9 — извлечение окружения',
  EXTRACT_BG_PROMPT_SQ:    'Фон 1:1 — извлечение окружения (Обринж)',
  APPLY_LOOKBOOK_PROMPT:   'Применить лукбук к персонажу',
  APPLY_ENV_PROMPT:        'Применить окружение к персонажу',
  TPOSE_PROMPT:            'T-pose (Обринж)',
  pose_desk:               'Поза 1 — За столом',
  pose_sofa:               'Поза 2 — На диване',
  pose_window:             'Поза 3 — У окна',
  pose_kitchen:            'Поза 4 — На кухне',
  pose_standing:           'Поза 5 — Стоя',
  SCENE_ANALYSIS_PROMPT:                 'Анализ сцены (Gemini 3.1 Pro)',
  ASSET_INTERACT_ANALYZE_PROMPT:         'Взаимодействие ассетов — анализ вариантов (Gemini 3.1 Pro)',
  SCENARIO_ANALYZE_PROMPT:               'Сценарий — анализ взаимодействий образ+предмет (Gemini 3.1 Pro)',
  POSE_VARIATION_PROMPT:                 'Образ — анализ позы + генерация 4 вариаций (Gemini 3.1 Pro)',
  edit_pose_look_left:  'Эдит-поза 1 — Поворот влево',
  edit_pose_look_right: 'Эдит-поза 2 — Поворот вправо',
  edit_pose_3quarter:   'Эдит-поза 3 — Три четверти',
  edit_pose_head_tilt:  'Эдит-поза 4 — Наклон головы',
  edit_pose_chin_up:    'Эдит-поза 5 — Подбородок вверх',
  LOOKBOOK_DEFAULT_GENERATE_PROMPT:      'Ассет: дефолтный промпт для лукбука (одеть персонажа)',
  ENVIRONMENT_DEFAULT_GENERATE_PROMPT:   'Ассет: дефолтный промпт для окружения (поместить персонажа)',
  DETAIL_DEFAULT_GENERATE_PROMPT:        'Ассет: дефолтный промпт для предмета (держит в руках, спинтакс)',
  ASSET_PRE_GENERATE_PROMPT:             'Ассет: пре-генерация — анализ и компоновка промпта (Gemini 3.1 Pro)',
  SCENE_INTERACTION_PROMPT:             'Эдит/Сценарии: анализ взаимодействия образ+предмет → детальный промпт (GPT-4o)',
  EDIT_POSE_ANALYZE_PROMPT:              'Эдит-поза: анализ персонажа (Gemini 3.1 Pro)',
  REF_ANALYZE_PROMPT:                    'Темпо: глубокий анализ изображения — промпт + цветофильтры (Gemini 3.1 Pro)',
  REALISM_TEMPO_PROMPT:                  'Темпо: аддендум реализма — выбор контекстуальных маркеров (добавляется к анализу)',
  DETAIL_ANALYZE_PROMPT:                 'Предметы: ИИ-анализ предмета — описание, взаимодействия, промпт (GPT-4o)',
  age_18_22: 'Возраст: 18–22 лет',
  age_23_27: 'Возраст: 23–27 лет',
  age_28_32: 'Возраст: 28–32 лет',
  age_33_37: 'Возраст: 33–37 лет',
  age_38_42: 'Возраст: 38–42 лет',
  age_43_47: 'Возраст: 43–47 лет',
  age_48_52: 'Возраст: 48–52 лет',
  age_53_57: 'Возраст: 53–57 лет',
  age_58_62: 'Возраст: 58–62 лет',
  age_63_67: 'Возраст: 63–67 лет',
  age_68_72: 'Возраст: 68–72 лет',
  gender_female: 'Пол: Женский',
  gender_male:   'Пол: Мужской',
  emotion_neutral:    'Эмоция: Нейтральная',
  emotion_smile:      'Эмоция: Улыбка',
  emotion_joy:        'Эмоция: Радость',
  emotion_laugh:      'Эмоция: Смех',
  emotion_surprise:   'Эмоция: Удивление',
  emotion_sadness:    'Эмоция: Грусть',
  emotion_serious:    'Эмоция: Серьёзность',
  emotion_thoughtful: 'Эмоция: Задумчивость',
  emotion_confident:  'Эмоция: Уверенность',
  emotion_excitement: 'Эмоция: Восторг',
  emotion_anger:      'Эмоция: Злость',
  emotion_shy:        'Эмоция: Стеснение',
};

// ── Fixed phrases per prompt (bold = do not change) ───────────────────────────
const FIXED_PHRASES = {
  EXTRACT_CLOTHING_PROMPT: [
    'worn by the person in the reference image',
    'Clean product photography, sharp focus, high detail, 1:1 square format.',
  ],
  EXTRACT_BG_PROMPT: [
    'Extract and reconstruct only the background environment from this reference image.',
    'Remove all people, models, and human figures completely — leave zero trace of any person.',
    '16:9 landscape format, 4K ultra-high resolution, photorealistic.',
  ],
  EXTRACT_BG_PROMPT_SQ: [
    'Extract and reconstruct only the background environment from this reference image.',
    'Remove all people, models, and human figures completely — leave zero trace of any person.',
    'Square 1:1 format, 4K ultra-high resolution, photorealistic.',
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
  ASSET_INTERACT_ANALYZE_PROMPT: ['{name}', '{exhon}', '{activnoe}'],
  POSE_VARIATION_PROMPT: [],
  ...Object.fromEntries(EDIT_POSE_KEYS.map(k => [k, ['{charDesc}']])),
  LOOKBOOK_DEFAULT_GENERATE_PROMPT:    [],
  ENVIRONMENT_DEFAULT_GENERATE_PROMPT: [],
  DETAIL_DEFAULT_GENERATE_PROMPT:      [],
  ASSET_PRE_GENERATE_PROMPT:           ['{presetPrompt}'],
  SCENE_INTERACTION_PROMPT:            ['{interactionLabel}'],
  EDIT_POSE_ANALYZE_PROMPT:            [],
  REF_ANALYZE_PROMPT:                  [],
  REALISM_TEMPO_PROMPT:                [],
  DETAIL_ANALYZE_PROMPT:               ['{userNotes}'],
  ...Object.fromEntries(EMOTION_KEYS.map(k => [`emotion_${k}`, []])),
  ...Object.fromEntries(AGE_KEYS.map(k    => [`age_${k}`,     []])),
  ...Object.fromEntries(GENDER_KEYS.map(k => [`gender_${k}`,  []])),
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

module.exports = { getPrompt, saveVersion, resetPrompt, getAllPrompts, renamePrompt, saveDynamicPrompt, deleteDynamicPrompt, DEFAULTS, LABELS };
