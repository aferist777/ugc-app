/* engine-registry.js — the engine plumbing other pages read, and nothing else.
   Split out of settings.js, which had grown into two unrelated files: this half, and the Brain
   UI (now public/js/admin-keys.js, on /admin). Everything here has a caller outside:

     getImageEngine()          obrazy.js — the engine a look and its variations are generated on
     getEngineParams(engine)   biroly.js, engine-settings.js — the stored body params for a model

   ENGINE_PARAMS_SPECS stays because getEngineParams() answers from it when a model has no saved
   params. The Brain page no longer edits these: b-roll params are edited in Birols' own engine
   popup, which mirrors them into the same engine_params__v1__<id> keys - so there is no writer
   here, only readers. */

const IMAGE_ENGINE_KEY = 'image_engine_v1';

// Written by nothing any more - the Brain dropdown that used to set it is gone, and the
// Character page has its own per-direction engine registry (GET /api/character-v2/engines).
// Kept as a read: whatever is stored still decides, and 'nano-banana-2' is the fallback.
function getImageEngine() {
  return localStorage.getItem(IMAGE_ENGINE_KEY) || 'nano-banana-2';
}

// ── Engine parameter specs ────────────────────────────────────────────────────
// Defines editable JSON body parameters per engine with labels and descriptions.
const ENGINE_PARAMS_SPECS = {
  'nano-banana-2': [
    {
      key: 'resolution', type: 'select', options: ['2K', '4K'], default: '2K',
      label: 'Resolution',
      desc: 'Output image resolution. 4K — higher detail but slower.',
    },
    {
      key: 'output_format', type: 'select', options: ['jpg', 'png'], default: 'jpg',
      label: 'File format',
      desc: 'Output image format. PNG is lossless, JPG is more compact.',
    },
  ],
  'qwen2': [
    {
      key: 'output_format', type: 'select', options: ['jpeg', 'png'], default: 'jpeg',
      label: 'File format',
      desc: 'Output image format.',
    },
    {
      key: 'num_inference_steps', type: 'number', min: 1, max: 80, step: 1, default: 30,
      label: 'Diffusion steps',
      desc: 'Number of generation steps (text-to-image). More = higher quality and slower.',
    },
    {
      key: 'guidance_scale', type: 'number', min: 1, max: 20, step: 0.1, default: 2.5,
      label: 'CFG Scale',
      desc: 'Prompt adherence (text-to-image). Higher = closer to prompt, lower = more creative.',
    },
  ],
  'seedream': [
    {
      key: 'quality', type: 'select', options: ['basic', 'high'], default: 'basic',
      label: 'Quality',
      desc: 'basic = 2K (fast), high = 4K (slower, higher detail).',
    },
  ],
  'seedream4.5': [
    {
      key: 'quality', type: 'select', options: ['basic', 'high'], default: 'basic',
      label: 'Quality',
      desc: 'basic = 2K (fast), high = 4K (slower, higher detail).',
    },
  ],
  'gptimage2': [
    {
      key: 'quality', type: 'select', options: ['auto', 'high', 'medium', 'low'], default: 'auto',
      label: 'Quality',
      desc: 'auto — balanced speed and detail. high — maximum quality, slower.',
    },
  ],
  'elevenlabs': [
    {
      key: 'model_id', type: 'select',
      options: ['eleven_multilingual_v2', 'eleven_turbo_v2_5', 'eleven_flash_v2_5'],
      default: 'eleven_multilingual_v2',
      label: 'Model',
      desc: 'multilingual_v2 — best quality, multilingual support. turbo_v2_5 — faster. flash_v2_5 — fastest.',
    },
    {
      key: 'stability', type: 'range', min: 0, max: 1, step: 0.05, default: 0.85,
      label: 'Stability',
      desc: 'Voice delivery consistency. Low = more expressive and emotional, high = more monotone.',
    },
    {
      key: 'similarity_boost', type: 'range', min: 0, max: 1, step: 0.05, default: 0.75,
      label: 'Voice similarity',
      desc: 'Closeness to the original voice model. High = closer to voice, low = more varied.',
    },
    {
      key: 'style', type: 'range', min: 0, max: 1, step: 0.05, default: 0,
      label: 'Style/Emotions',
      desc: 'Amplifies individual voice traits. 0 = neutral, higher = more characteristic.',
    },
    {
      key: 'speed', type: 'range', min: 0.7, max: 1.5, step: 0.05, default: 1.15,
      label: 'Speech rate',
      desc: 'Speaking pace. 1.0 = normal, 0.7 = slow, 1.5 = fast.',
    },
  ],
  // kling/ai-avatar-standard params used to live here as a single `prompt`
  // textarea. Removed: the per-scene LLM analyzer ([routes/audio.js] avatar-
  // prompt endpoint) now builds the final motion prompt itself, optionally
  // seeded by the scenario's motionPrompt (stored in scenarios-meta.json).
  'kling/ai-avatar-standard': [],
  'kling/ai-avatar-pro':      [],
  'grok-imagine/image-to-video': [
    {
      key: 'duration', type: 'number', min: 6, max: 30, step: 1, default: 6,
      label: 'Duration (sec)',
      desc: 'Video length from 6 to 30 seconds.',
    },
    {
      key: 'resolution', type: 'select', options: ['480p', '720p'], default: '480p',
      label: 'Resolution',
      desc: '480p — faster, 720p — higher quality.',
    },
    {
      key: 'aspect_ratio', type: 'select', options: ['9:16', '16:9', '1:1', '2:3', '3:2'], default: '9:16',
      label: 'Aspect ratio',
      desc: '9:16 for vertical UGC videos, 16:9 for horizontal.',
    },
    {
      key: 'mode', type: 'select', options: ['normal', 'fun', 'spicy'], default: 'normal',
      label: 'Mode',
      desc: 'normal — standard, fun — dynamic, spicy — internal images only.',
    },
  ],
  'grok-imagine/text-to-video': [
    {
      key: 'duration', type: 'number', min: 6, max: 30, step: 1, default: 6,
      label: 'Duration (sec)',
      desc: 'Video length from 6 to 30 seconds.',
    },
    {
      key: 'resolution', type: 'select', options: ['480p', '720p'], default: '480p',
      label: 'Resolution',
      desc: '480p — faster, 720p — higher quality.',
    },
    {
      key: 'aspect_ratio', type: 'select', options: ['9:16', '16:9', '1:1', '2:3', '3:2'], default: '9:16',
      label: 'Aspect ratio',
      desc: '9:16 for vertical UGC videos, 16:9 for horizontal.',
    },
    {
      key: 'mode', type: 'select', options: ['normal', 'fun'], default: 'normal',
      label: 'Mode',
      desc: 'normal — standard, fun — dynamic.',
    },
  ],
};

const ENGINE_PARAMS_KEY_PREFIX = 'engine_params__v1__';

function getEngineParams(engineKey) {
  try {
    const stored = localStorage.getItem(ENGINE_PARAMS_KEY_PREFIX + engineKey);
    if (stored) return JSON.parse(stored);
  } catch {}
  // Return defaults
  const specs = ENGINE_PARAMS_SPECS[engineKey] || [];
  return Object.fromEntries(specs.map(s => [s.key, s.default]));
}

