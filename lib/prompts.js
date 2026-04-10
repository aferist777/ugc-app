'use strict';

const fs   = require('fs');
const path = require('path');

const {
  EXTRACT_CLOTHING_PROMPT, EXTRACT_BG_PROMPT, EXTRACT_BG_PROMPT_SQ,
  APPLY_LOOKBOOK_PROMPT, APPLY_ENV_PROMPT, TPOSE_PROMPT,
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

// ── Human-readable labels ─────────────────────────────────────────────────────
const LABELS = {
  EXTRACT_CLOTHING_PROMPT: 'Лукбук — извлечение одежды (flat lay)',
  EXTRACT_BG_PROMPT:       'Фон 16:9 — извлечение окружения',
  EXTRACT_BG_PROMPT_SQ:    'Фон 1:1 — извлечение окружения (Обринж)',
  APPLY_LOOKBOOK_PROMPT:   'Применить лукбук к персонажу',
  APPLY_ENV_PROMPT:        'Применить окружение к персонажу',
  TPOSE_PROMPT:            'T-pose (Обринж)',
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
    'Dress the person from the first reference image in the exact outfit shown in the second reference image.',
    "Preserve the person's face, skin tone, hair, and body proportions exactly as in the first image.",
    'Replace all clothing with every item from the second reference image.',
  ],
  APPLY_ENV_PROMPT: [
    'Place the person from the first image into the environment shown in the second image.',
    "Keep the person's appearance, clothing, and pose identical.",
    '9:16 portrait format.',
  ],
  TPOSE_PROMPT: [
    'Full-body T-pose of the person from the reference image, waist-up in a square 1:1 format.',
    'Arms extended horizontally in a classic T-pose.',
    '4K ultra-high resolution, photorealistic, sharp focus.',
  ],
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
  if (!(key in DEFAULTS)) throw new Error('Unknown prompt key: ' + key);
  const store = loadStore();
  if (!store[key]) store[key] = { current: DEFAULTS[key], versions: [] };
  // Save previous current as a historical version
  store[key].versions = store[key].versions || [];
  store[key].versions.unshift({ text: store[key].current, ts: new Date().toISOString() });
  store[key].versions = store[key].versions.slice(0, 10);
  store[key].current = text;
  saveStore(store);
}

function resetPrompt(key) {
  if (!(key in DEFAULTS)) throw new Error('Unknown prompt key: ' + key);
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
  return Object.keys(DEFAULTS).map(key => ({
    key,
    label:        LABELS[key] || key,
    fixedPhrases: FIXED_PHRASES[key] || [],
    current:      store[key]?.current ?? DEFAULTS[key],
    default:      DEFAULTS[key],
    versions:     store[key]?.versions ?? [],
  }));
}

module.exports = { getPrompt, saveVersion, resetPrompt, getAllPrompts, DEFAULTS, LABELS };
