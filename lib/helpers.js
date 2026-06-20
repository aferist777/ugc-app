'use strict';

const fs       = require('fs');
const path     = require('path');
const axios    = require('axios');
const FormData = require('form-data');
const sharp    = require('sharp');

const {
  KIE_BASE, SKIN_PARAMS, NO_RETOUCH,
  UPLOADS_DIR, LOOKBOOKS_DIR, CHARACTERS_DIR, ENVIRONMENTS_DIR, SCENES_DIR, REFS_DIR,
  DATA_DIR,
} = require('./config');
const { getPrompt } = require('./prompts');

// ── API keys: settings.json is the single source of truth at runtime ──────────
// At startup, env-only keys are migrated into settings.json so existing setups
// continue to work seamlessly. After migration env is no longer consulted.
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

function _loadSettings() {
  try { return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')); } catch { return {}; }
}
function _saveSettings(obj) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(obj, null, 2), 'utf8');
}

// One-time startup migration: any env key not yet in settings.json gets imported.
// Runs only at module load (server start). User edits via Brain UI from then on.
(function _migrateEnvKeysToSettings() {
  const s = _loadSettings();
  let changed = false;
  if (!s.kieApiKey && process.env.KIE_AI_API_KEY) {
    s.kieApiKey = process.env.KIE_AI_API_KEY;
    changed = true;
    console.log('[api-keys] migrated KIE_AI_API_KEY from env → settings.json');
  }
  if (!s.elevenLabsApiKey && process.env.ELEVENLABS_API_KEY) {
    s.elevenLabsApiKey = process.env.ELEVENLABS_API_KEY;
    changed = true;
    console.log('[api-keys] migrated ELEVENLABS_API_KEY from env → settings.json');
  }
  if (!s.groqApiKey && process.env.GROQ_API_KEY) {
    s.groqApiKey = process.env.GROQ_API_KEY;
    changed = true;
    console.log('[api-keys] migrated GROQ_API_KEY from env → settings.json');
  }
  if (!s.telegramBotToken && process.env.TELEGRAM_BOT_TOKEN) {
    s.telegramBotToken = process.env.TELEGRAM_BOT_TOKEN;
    changed = true;
    console.log('[api-keys] migrated TELEGRAM_BOT_TOKEN from env → settings.json');
  }
  if (!s.telegramChatId && process.env.TELEGRAM_CHAT_ID) {
    s.telegramChatId = process.env.TELEGRAM_CHAT_ID;
    changed = true;
    console.log('[api-keys] migrated TELEGRAM_CHAT_ID from env → settings.json');
  }
  if (!s.openRouterApiKey && process.env.OPENROUTER_API_KEY) {
    s.openRouterApiKey = process.env.OPENROUTER_API_KEY;
    changed = true;
    console.log('[api-keys] migrated OPENROUTER_API_KEY from env → settings.json');
  }
  if (!s.openRouterTextModel && process.env.OPENROUTER_TEXT_MODEL) {
    s.openRouterTextModel = process.env.OPENROUTER_TEXT_MODEL;
    changed = true;
    console.log('[api-keys] migrated OPENROUTER_TEXT_MODEL from env → settings.json');
  }
  if (!s.replicateApiKey && process.env.REPLICATE_API_TOKEN) {
    s.replicateApiKey = process.env.REPLICATE_API_TOKEN;
    changed = true;
    console.log('[api-keys] migrated REPLICATE_API_TOKEN from env → settings.json');
  }
  if (changed) _saveSettings(s);
})();

function _getReplicateApiKey() {
  const s = _loadSettings();
  return (s.replicateApiKey && s.replicateApiKey.trim()) ? s.replicateApiKey.trim() : '';
}

// Per-engine user-configured defaults. Stored in data/settings.json under
// `engineDefaults: { 'nano-banana-2': {...}, 'gptimage2': {...}, ... }`. UI
// engine name (the value used in <select id="char-image-engine">) is the key
// so the popup form can read/write without translating to Replicate paths.
// Hard-coded fallbacks live in the createX functions themselves.
function _getEngineDefaults(engineName) {
  const s = _loadSettings();
  return (s.engineDefaults && s.engineDefaults[engineName]) || {};
}

function _getKieApiKey() {
  const s = _loadSettings();
  return (s.kieApiKey && s.kieApiKey.trim()) ? s.kieApiKey.trim() : '';
}

// ── OpenRouter (default primary for text/vision analysis) ────────────────────
// All callAI* helpers prepend a single attempt to OpenRouter (Sonnet by default,
// configurable in Brain → API Keys) before falling through to the existing
// kie.ai Gemini cascade. Failure / empty response = transparent fallback.
// Callers can opt OUT for a specific call by passing { useOpenRouter: false } —
// useful for engine-specific paths that need Gemini directly.
function _getOpenRouterApiKey() {
  const s = _loadSettings();
  return (s.openRouterApiKey && s.openRouterApiKey.trim()) ? s.openRouterApiKey.trim() : '';
}
// Returns an array of models to try in order. Settings string can be either a
// single model id ("anthropic/claude-sonnet-4.5") or a comma-separated chain
// ("anthropic/claude-sonnet-4.5,openai/gpt-4o,google/gemini-2.5-pro").
// Default chain when nothing is configured.
function _getOpenRouterModelChain() {
  const s = _loadSettings();
  const raw = (s.openRouterTextModel && s.openRouterTextModel.trim())
    ? s.openRouterTextModel
    : 'anthropic/claude-sonnet-4.6,openai/gpt-5.5,google/gemini-3.1-pro-preview';
  return raw.split(',').map(x => x.trim()).filter(Boolean);
}

// Image-analysis (vision) model, user-configurable in API-keys settings.
// Default: qwen/qwen3.7-plus. The vision callers pass this as openRouterModel and
// fall back to the kie.ai cascade if it errors. Read live per request.
function getImgVisionModel() {
  try {
    const m = (_loadSettings().imgVisionModel || '').trim();
    return m || 'qwen/qwen3.7-plus';
  } catch { return 'qwen/qwen3.7-plus'; }
}

// Issue a single chat-completions call to OpenRouter against ONE model. Returns
// trimmed text string or '' on empty/error. Never throws — caller decides next step.
async function _callOpenRouterOne(messages, model, timeout, apiKey) {
  try {
    const res = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      { model, messages, stream: false },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://localhost:3000',
          'X-Title': 'UGC Character Generator',
        },
        timeout,
      }
    );
    const raw = (res.data?.choices?.[0]?.message?.content || '').trim();
    if (raw) { console.log(`[OpenRouter] ${model} ok (${raw.length} chars)`); return raw; }
    console.warn(`[OpenRouter] ${model} empty response`);
    return '';
  } catch (e) {
    const status = e.response?.status;
    const errMsg = e.response?.data?.error?.message || e.message;
    console.warn(`[OpenRouter] ${model} error${status ? ' ' + status : ''}: ${errMsg}`);
    return '';
  }
}

// Call OpenRouter, trying each model in the configured chain until one returns
// a non-empty response. Returns '' if every model fails — caller falls back to
// the kie.ai cascade.
async function _callOpenRouter(messages, opts = {}) {
  const apiKey = _getOpenRouterApiKey();
  if (!apiKey) return '';
  const chain = opts.openRouterModel
    ? [opts.openRouterModel]
    : _getOpenRouterModelChain();
  const timeout = opts.timeout || 45000;
  for (const model of chain) {
    const raw = await _callOpenRouterOne(messages, model, timeout, apiKey);
    if (raw) return raw;
  }
  console.warn(`[OpenRouter] all ${chain.length} models in chain failed/empty`);
  return '';
}

// ── Auth header ───────────────────────────────────────────────────────────────
function kieHeaders() {
  return {
    Authorization: `Bearer ${_getKieApiKey()}`,
    'Content-Type': 'application/json',
  };
}

// ── Shared AI call: Gemini flash (base64 inline) → GPT-5.2 fallback ─────────
// Used for calls that send a base64 image in Gemini's native format.
// On Gemini failure/empty, falls back to GPT-5.2 via OpenAI-compatible image_url.
async function callAIBase64(prompt, imageBase64, mimeType = 'image/jpeg', opts = {}) {
  const { timeout = 30000 } = opts;
  const dataUrl = `data:${mimeType};base64,${imageBase64}`;
  const gptMessages = [{ role: 'user', content: [
    { type: 'text',      text: prompt },
    { type: 'image_url', image_url: { url: dataUrl } },
  ]}];

  // 0. OpenRouter (default primary, opt-out via useOpenRouter:false) — same OpenAI-compatible message shape works
  if (opts.useOpenRouter !== false) {
    console.log('[callAIBase64] trying OpenRouter…');
    const orText = await _callOpenRouter(gptMessages, opts);
    if (orText) return orText;
    console.warn('[callAIBase64] OpenRouter empty/error → kie.ai cascade');
  }

  // 1. GPT-5.4
  console.log('[callAIBase64] trying GPT-5.4…');
  try {
    const res = await axios.post(
      `${KIE_BASE}/gpt-5-4/v1/chat/completions`,
      { messages: gptMessages },
      { headers: kieHeaders(), timeout }
    );
    const text = (res.data?.choices?.[0]?.message?.content || '').trim();
    if (text) { console.log('[callAIBase64] GPT-5.4 ok'); return text; }
    console.warn('[callAIBase64] GPT-5.4 empty');
  } catch (e) {
    console.warn('[callAIBase64] GPT-5.4 error:', e.message);
  }

  // 2. GPT-5.2
  console.warn('[callAIBase64] falling back to GPT-5.2…');
  try {
    const res = await axios.post(
      `${KIE_BASE}/gpt-5-2/v1/chat/completions`,
      { messages: gptMessages },
      { headers: kieHeaders(), timeout }
    );
    const text = (res.data?.choices?.[0]?.message?.content || '').trim();
    if (text) { console.log('[callAIBase64] GPT-5.2 ok'); return text; }
    console.warn('[callAIBase64] GPT-5.2 empty');
  } catch (e) {
    console.warn('[callAIBase64] GPT-5.2 error:', e.message);
  }

  // 3. Gemini Flash (native inline_data)
  console.warn('[callAIBase64] falling back to Gemini Flash…');
  try {
    const res = await axios.post(
      `${KIE_BASE}/gemini/v1/models/gemini-3-flash-v1beta:generateContent`,
      { stream: false, contents: [{ role: 'user', parts: [
        { text: prompt },
        { inline_data: { mime_type: mimeType, data: imageBase64 } },
      ]}]},
      { headers: kieHeaders(), timeout }
    );
    const text = (res.data?.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
    if (text) { console.log('[callAIBase64] Gemini Flash ok'); return text; }
    console.warn('[callAIBase64] Gemini Flash empty');
  } catch (e) {
    console.error('[callAIBase64] Gemini Flash error:', e.message);
  }

  throw new Error('GPT-5.4, GPT-5.2 и Gemini Flash вернули пустой ответ');
}

// ── Gemini: skin analysis ─────────────────────────────────────────────────────
async function analyzeWithGemini(faceBase64) {
  const prompt =
    `You are a skin analysis assistant. Look at this face photo carefully. ` +
    `From the list below, identify which skin characteristics are visible or likely present on this person. ` +
    `Return ONLY a comma-separated list of applicable terms from the list, nothing else. ` +
    `List: ${SKIN_PARAMS.join(', ')}.`;

  const text = await callAIBase64(prompt, faceBase64, 'image/jpeg', { openRouterModel: 'google/gemini-3.5-flash' });
  return text.split(',').map(s => s.trim().toLowerCase()).filter(s => SKIN_PARAMS.includes(s));
}

// ── Gemini: select contextual realism markers for an image ───────────────────
async function analyzeRealismMarkers(imageBase64, availableMarkers = []) {
  const markerList = availableMarkers.length
    ? availableMarkers.join(', ')
    : [
        'phone-camera realism', 'subtle sensor grain', 'slight edge softness',
        'unretouched', 'no smoothing', 'no beauty filters', 'no airbrushing',
        'indoor near window', 'natural contrast', 'accurate white balance', 'soft side lighting',
        'no symmetry correction', 'shallow depth of field', 'editorial realism',
        'visible pores', 'fine micro-texture', 'subtle under-eye texture',
        'organic acne marks (non-repeating)', 'uneven pigmentation', 'subtle redness', 'visible fine lines', 'acne scars',
        'natural oil sheen only on high points', 'natural flyaways',
        'visible veins', 'hand anatomy', 'realistic proportions', 'clear fabric texture separation',
      ].join(', ');

  const prompt =
    `Look at this image and select ONLY the realism markers from the list below that genuinely fit this image's context.\n` +
    `Consider: is skin visible? what lighting type? indoor/outdoor? what clothing materials? is hair detailed? are hands visible?\n` +
    `DO NOT include markers that don't fit. Return ONLY a comma-separated list of selected markers, nothing else.\n\n` +
    `Available markers:\n${markerList}`;

  return await callAIBase64(prompt, imageBase64, 'image/jpeg', { openRouterModel: 'google/gemini-3.5-flash' });
}

// ── Gemini: translate to English ──────────────────────────────────────────────
async function translateToEnglish(text) {
  return await callAIVisionWithFallback([{
    role: 'user',
    content: [{ type: 'text', text: `Translate the following text to English. Return only the translated text, nothing else:\n\n${text}` }],
  }], { timeout: 15000 });
}

// ── Build Qwen2 prompt ────────────────────────────────────────────────────────
// sceneTemplate: optional pose prompt string with {gender} and {age} placeholders.
// emotionModifier: optional English facial expression description to append.
// If omitted, falls back to the default desk scene.
function buildPrompt(age, gender, skinTraits, extraInstruction, sceneTemplate, emotionModifier, realismMarkers = '') {
  // Resolve gender and age via editable system prompts (falls back to hardcoded defaults)
  const genderWord = getPrompt(`gender_${gender}`) || (gender === 'male' ? 'man' : 'woman');
  const ageDesc    = getPrompt(`age_${String(age).replace(/-/g, '_')}`) || age;
  const skinDetails = skinTraits.length > 0 ? `Skin realism: ${skinTraits.join(', ')}. ` : '';
  // Deduplicate realismMarkers: drop any token already present in NO_RETOUCH or skinTraits
  const alreadyIncluded = new Set([
    ...NO_RETOUCH.map(s => s.toLowerCase().trim()),
    ...skinTraits.map(s => s.toLowerCase().trim()),
  ]);
  const dedupedMarkers = realismMarkers
    ? realismMarkers.split(',').map(s => s.trim()).filter(s => s && !alreadyIncluded.has(s.toLowerCase())).join(', ')
    : '';
  const realismClause = dedupedMarkers ? ` Photorealism: ${dedupedMarkers}.` : '';
  const suffix = skinDetails + `${NO_RETOUCH.join(', ')}. High quality, 4k resolution, cinematic look, natural realistic photo finish.` + realismClause;
  const emotionClause = emotionModifier ? ` Expression: ${emotionModifier}` : '';

  let sceneBase;
  if (sceneTemplate) {
    sceneBase = sceneTemplate
      .replace(/\{gender\}/g, genderWord)
      .replace(/\{age\}/g, ageDesc)
      + emotionClause + ' ' + suffix;
  } else {
    sceneBase =
      `A realistic medium shot of a ${genderWord} aged ${ageDesc} sitting at a desk, ` +
      `looking directly into the camera lens with a natural friendly expression. ` +
      `Professional soft studio lighting, blurred home office background with a bookshelf and a plant. ` +
      emotionClause + ' ' + suffix;
  }

  if (extraInstruction) {
    return (
      `Apply the following changes to this image: ${extraInstruction}. ` +
      `Keep the same person, face, and background environment exactly as they are — do not change the background. ` +
      `Only modify what is explicitly requested.` +
      (realismMarkers ? ` Preserve photorealism: ${realismMarkers}.` : '')
    );
  }
  return `Use the face and identity from this reference image. Place this person in the following scene: ` + sceneBase;
}

// ── Upload cache: buffer hash → { url, ts } — avoids re-uploading the same file ─
const _uploadCache = new Map();
const _UPLOAD_CACHE_TTL = 10 * 60 * 1000; // 10 minutes
function _bufHash(buf) {
  let h = 0;
  const step = Math.max(1, Math.floor(buf.length / 512));
  for (let i = 0; i < buf.length; i += step) h = (Math.imul(31, h) + buf[i]) | 0;
  return `${buf.length}_${h >>> 0}`;
}

// ── Upload hosts: tried in order, first success wins ─────────────────────────
// Own-server host (uses the DO server's /api/public-host endpoint) goes first
// when PUBLIC_HOST_URL is set. This decouples kie.ai's image-fetch from the
// flaky free hosts. Falls back to the four external hosts on failure.
const _UPLOAD_HOST_NAMES = ['own-server', 'imgbb', 'catbox.moe', 'tmpfiles.org', 'uguu.se', 'litterbox.catbox.moe', 'imgcdn.dev', '0x0.st'];
const _UPLOAD_HOSTS = [
  // 0. Own server (PUBLIC_HOST_URL env var must be reachable from kie.ai).
  // Locally without that env var, this host writes to disk but returns a
  // localhost URL kie.ai cannot reach — _UPLOAD_HOSTS continues to next host
  // when the upload attempt below resolves but the URL won't actually work
  // for kie.ai. So we skip this host entirely when PUBLIC_HOST_URL is unset.
  async (buf, fileName) => {
    const base = (process.env.PUBLIC_HOST_URL || '').trim();
    if (!base) throw new Error('own-server: PUBLIC_HOST_URL not configured — skipping');
    const fs   = require('fs');
    const path = require('path');
    const { TEMP_PUBLIC_DIR } = require('./config');
    if (!fs.existsSync(TEMP_PUBLIC_DIR)) fs.mkdirSync(TEMP_PUBLIC_DIR, { recursive: true });
    const abs = path.join(TEMP_PUBLIC_DIR, fileName);
    fs.writeFileSync(abs, buf);
    return `${base.replace(/\/$/, '')}/temp_public/${fileName}`;
  },
  // 1. imgbb — free API key (IMGBB_API_KEY in .env), base64 POST → direct
  // i.ibb.co CDN link. expiration=3600 auto-deletes after 1h (no cleanup, no
  // bloat). Big CDN that passes restrictive networks where small hosts 000.
  async (buf) => {
    const key = (process.env.IMGBB_API_KEY || '').trim();
    if (!key) throw new Error('imgbb: IMGBB_API_KEY not set — skipping');
    const params = new URLSearchParams();
    params.append('image', buf.toString('base64'));
    const res = await axios.post(
      `https://api.imgbb.com/1/upload?key=${key}&expiration=3600`,
      params,
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 25000 }
    );
    const url = res.data?.data?.url;
    if (!url) throw new Error('imgbb: no url — ' + JSON.stringify(res.data).slice(0, 100));
    return url;
  },
  // 2. catbox.moe — permanent, most reliable free host (form POST → plain URL)
  async (buf, fileName) => {
    const form = new FormData();
    form.append('reqtype', 'fileupload');
    form.append('fileToUpload', buf, { filename: fileName, contentType: 'image/jpeg' });
    const res = await axios.post('https://catbox.moe/user/api.php', form, { headers: form.getHeaders(), timeout: 25000 });
    const url = (typeof res.data === 'string' ? res.data : '').trim();
    if (!url.startsWith('http')) throw new Error('catbox: bad response — ' + String(res.data).slice(0, 80));
    return url;
  },
  // 2. tmpfiles.org — JSON API, 24h
  async (buf, fileName) => {
    const form = new FormData();
    form.append('file', buf, { filename: fileName, contentType: 'image/jpeg' });
    const res = await axios.post('https://tmpfiles.org/api/v1/upload', form, { headers: form.getHeaders(), timeout: 25000 });
    const rawUrl = res.data?.data?.url;
    if (!rawUrl) throw new Error('tmpfiles: no url');
    return rawUrl.replace('https://tmpfiles.org/', 'https://tmpfiles.org/dl/')
                 .replace('http://tmpfiles.org/',  'https://tmpfiles.org/dl/');
  },
  // 2. uguu.se — JSON API, 24h
  async (buf, fileName) => {
    const form = new FormData();
    form.append('files[]', buf, { filename: fileName, contentType: 'image/jpeg' });
    const res = await axios.post('https://uguu.se/upload', form, { headers: form.getHeaders(), timeout: 25000 });
    const url = res.data?.files?.[0]?.url;
    if (!url) throw new Error('uguu.se: no url');
    return url;
  },
  // 3. litterbox.catbox.moe — form POST, 1h
  async (buf, fileName) => {
    const form = new FormData();
    form.append('reqtype', 'fileupload');
    form.append('time', '1h');
    form.append('fileToUpload', buf, { filename: fileName, contentType: 'image/jpeg' });
    const res = await axios.post('https://litterbox.catbox.moe/resources/internals/api.php', form, { headers: form.getHeaders(), timeout: 25000 });
    const url = (typeof res.data === 'string' ? res.data : '').trim();
    if (!url.startsWith('http')) throw new Error('litterbox: bad response');
    return url;
  },
  // 4. imgcdn.dev — Chevereto API v1, permanent storage
  async (buf, fileName) => {
    const form = new FormData();
    form.append('source', buf, { filename: fileName, contentType: 'image/jpeg' });
    form.append('format', 'json');
    const res = await axios.post('https://imgcdn.dev/api/1/upload/?key=<imgcdn-key>', form, { headers: form.getHeaders(), timeout: 25000 });
    const url = res.data?.image?.url;
    if (!url) throw new Error('imgcdn.dev: no url — ' + JSON.stringify(res.data).slice(0, 100));
    return url;
  },
  // 6. 0x0.st — plain URL, requires a custom User-Agent (default UA is blocked)
  async (buf, fileName) => {
    const form = new FormData();
    form.append('file', buf, { filename: fileName, contentType: 'image/jpeg' });
    const res = await axios.post('https://0x0.st', form, { headers: { ...form.getHeaders(), 'User-Agent': 'ugc-app/1.0 (+https://github.com)' }, timeout: 25000 });
    const url = (typeof res.data === 'string' ? res.data : '').trim();
    if (!url.startsWith('http')) throw new Error('0x0.st: bad response — ' + String(res.data).slice(0, 80));
    return url;
  },
];

// ── Upload image buffer to public host (rotates through 5 hosts, cached) ─────
// Second arg can be either a string (legacy: file extension, e.g. 'jpg') or an
// options object: { ext?: string, forceFresh?: boolean }. forceFresh=true skips
// the cache lookup so kie.ai always gets a freshly-issued URL (used by the
// talking-head video generation route where stale tmpfiles.org links cause
// "Image fetch failed" errors).
async function uploadToPublicHost(imageBuffer, extOrOpts) {
  const opts = (typeof extOrOpts === 'string')
    ? { ext: extOrOpts }
    : (extOrOpts || {});
  const { ext, forceFresh = false } = opts;

  const key = _bufHash(imageBuffer);
  if (!forceFresh) {
    const cached = _uploadCache.get(key);
    if (cached && Date.now() - cached.ts < _UPLOAD_CACHE_TTL) {
      console.log('[uploadToPublicHost] cache hit');
      return cached.url;
    }
  } else {
    console.log('[uploadToPublicHost] forceFresh — bypass cache');
  }

  const fileExt  = ext || 'jpg';
  const fileName = `upload_${Date.now()}.${fileExt}`;

  for (let i = 0; i < _UPLOAD_HOSTS.length; i++) {
    try {
      const url = await _UPLOAD_HOSTS[i](imageBuffer, fileName);
      _uploadCache.set(key, { url, ts: Date.now() });
      console.log(`[uploadToPublicHost] host${i + 1} (${_UPLOAD_HOST_NAMES[i]}) ok:`, url.slice(0, 80));
      return url;
    } catch (e) {
      console.warn(`[uploadToPublicHost] host${i + 1} (${_UPLOAD_HOST_NAMES[i]}) failed:`, e.message);
    }
  }
  throw new Error('[uploadToPublicHost] all ' + _UPLOAD_HOSTS.length + ' hosts failed');
}

// ── Download image from URL to local path ─────────────────────────────────────
async function downloadImage(url, destPath) {
  const response = await axios({ method: 'GET', url, responseType: 'stream', timeout: 60000 });
  return new Promise((resolve, reject) => {
    const writer = fs.createWriteStream(destPath);
    response.data.pipe(writer);
    writer.on('finish', resolve);
    writer.on('error', reject);
  });
}

// ── Compress JPEG in-place until < 9 MB ──────────────────────────────────────
async function compressBelow9MB(filePath) {
  const MAX = 9 * 1024 * 1024;
  if (fs.statSync(filePath).size <= MAX) return;
  let quality = 85;
  while (quality >= 40) {
    const tmp = filePath + '.tmp';
    await sharp(filePath).jpeg({ quality }).toFile(tmp);
    fs.renameSync(tmp, filePath);
    if (fs.statSync(filePath).size <= MAX) break;
    quality -= 10;
  }
}

// ── Create thumbnail (max 300px, max 35 KB) ───────────────────────────────────
async function createThumbnail(srcPath, thumbPath) {
  const thumbDir = path.dirname(thumbPath);
  if (!fs.existsSync(thumbDir)) fs.mkdirSync(thumbDir, { recursive: true });
  let quality = 75;
  while (quality >= 20) {
    const buf = await sharp(srcPath)
      .resize(300, 300, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality })
      .toBuffer();
    if (buf.length <= 35 * 1024 || quality <= 20) {
      fs.writeFileSync(thumbPath, buf);
      return;
    }
    quality -= 10;
  }
}

// ── Generate missing thumbnails for a list of image directories ───────────────
async function generateMissingThumbs(dirs) {
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    const thumbsDir = path.join(dir, 'thumbs');
    let images;
    try { images = fs.readdirSync(dir).filter(f => /\.(jpg|jpeg|png)$/i.test(f)); }
    catch { continue; }
    for (const img of images) {
      const thumbName = img.replace(/\.[^.]+$/, '') + '.jpg';
      const thumbPath = path.join(thumbsDir, thumbName);
      if (!fs.existsSync(thumbPath)) {
        try { await createThumbnail(path.join(dir, img), thumbPath); }
        catch (e) { console.warn('[thumb] failed for', img, ':', e.message); }
      }
    }
  }
}

// ── Replicate image generation (replaces kie.ai for all 4 image engines) ─────
// Image gen now uses Replicate's predictions API. kie.ai stays in play for
// video/avatar/chat. Each Replicate prediction's id is prefixed with 'repl:'
// so resolveTask can detect it and route polling to Replicate instead of kie.
// Model paths (latest version auto-selected by Replicate):
//   nano-banana-2          → google/nano-banana-2
//   qwen-image-edit-plus   → qwen/qwen-image-edit-plus      (image-to-image only)
//   gpt-image-2            → openai/gpt-image-2
//   seedream-5-lite        → bytedance/seedream-5-lite
const _replVersionCache = {};
// Resolve (and cache) a model's latest version id — used for the versioned
// predictions endpoint fallback below.
async function _resolveReplicateVersion(modelPath, apiKey) {
  if (_replVersionCache[modelPath]) return _replVersionCache[modelPath];
  const r = await axios.get(`https://api.replicate.com/v1/models/${modelPath}`, {
    headers: { Authorization: `Bearer ${apiKey}` }, timeout: 15000,
  });
  const v = r.data?.latest_version?.id;
  if (!v) throw new Error('Replicate: no latest_version for ' + modelPath);
  _replVersionCache[modelPath] = v;
  return v;
}

async function _createReplicatePrediction(modelPath, input) {
  const apiKey = _getReplicateApiKey();
  if (!apiKey) throw new Error('Replicate API token не настроен — задайте его в Brain → API Keys');
  const headers = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
  console.log('[replicate] POST', modelPath, '| input:', JSON.stringify(input));
  let id;
  try {
    // Official models (google/*, bytedance/*, black-forest-labs/*, openai/*) expose
    // the model-level predictions endpoint (auto-uses the latest version).
    const res = await axios.post(`https://api.replicate.com/v1/models/${modelPath}/predictions`, { input }, { headers, timeout: 30000 });
    id = res.data?.id;
  } catch (e) {
    // Community models (e.g. prunaai/*) 404 on the model-level endpoint — fall back
    // to the versioned endpoint with the latest version id.
    if (e.response?.status === 404) {
      const version = await _resolveReplicateVersion(modelPath, apiKey);
      const res2 = await axios.post('https://api.replicate.com/v1/predictions', { version, input }, { headers, timeout: 30000 });
      id = res2.data?.id;
    } else {
      throw e;
    }
  }
  if (!id) throw new Error('Replicate не вернул prediction id');
  // Tag with 'repl:' so resolveTask routes polling to Replicate.
  return `repl:${id}`;
}

// ── Create nano-banana-2 task ─────────────────────────────────────────────────
async function createNanoBananaTask(prompt, imageUrl, aspectRatio) {
  return await createNanoBananaProTask(prompt, imageUrl, aspectRatio);
}

// ── Create nano-banana-2 task (image-to-image, scene generation) ─────────────
// Settings precedence: explicit param > user defaults > hard-coded fallback.
async function createNanoBananaProTask(prompt, imageUrl, aspectRatio, params = {}) {
  const d = _getEngineDefaults('nano-banana-2');
  const input = {
    prompt,
    aspect_ratio: aspectRatio || d.aspect_ratio || (imageUrl ? 'match_input_image' : '9:16'),
    output_format: params.output_format || 'jpg',
    resolution: params.resolution || d.resolution || '2K',
    image_search: params.image_search ?? d.image_search ?? false,
    google_search: params.google_search ?? d.google_search ?? false,
  };
  if (imageUrl) input.image_input = [imageUrl];
  return await _createReplicatePrediction('google/nano-banana-2', input);
}

// ── Create nano-banana-2 task with multiple reference images ──────────────────
async function createNanoBananaProTaskMulti(prompt, imageUrls, aspectRatio, _seed, params = {}) {
  const urls = Array.isArray(imageUrls) ? imageUrls : (imageUrls ? [imageUrls] : []);
  const d = _getEngineDefaults('nano-banana-2');
  const input = {
    prompt,
    aspect_ratio: aspectRatio || d.aspect_ratio || (urls.length ? 'match_input_image' : '9:16'),
    output_format: params.output_format || 'jpg',
    resolution: params.resolution || d.resolution || '2K',
    image_search: params.image_search ?? d.image_search ?? false,
    google_search: params.google_search ?? d.google_search ?? false,
  };
  if (urls.length) input.image_input = urls;
  return await _createReplicatePrediction('google/nano-banana-2', input);
}

// ── Create qwen/qwen-image-edit-plus task (image input REQUIRED) ─────────────
async function createQwen2Task(prompt, imageUrl, aspectRatio, seed, params = {}) {
  const urls = Array.isArray(imageUrl) ? imageUrl : (imageUrl ? [imageUrl] : []);
  if (!urls.length) throw new Error('qwen-image-edit-plus требует хотя бы одно изображение');
  const d = _getEngineDefaults('qwen2');
  const input = {
    prompt,
    image: urls,
    aspect_ratio: aspectRatio || d.aspect_ratio || 'match_input_image',
    output_format: 'jpg',
    output_quality: params.output_quality ?? d.output_quality ?? 95,
    go_fast: params.go_fast ?? d.go_fast ?? true,
    disable_safety_checker: params.disable_safety_checker ?? d.disable_safety_checker ?? false,
  };
  if (seed) input.seed = seed;
  return await _createReplicatePrediction('qwen/qwen-image-edit-plus', input);
}

// ── Create openai/gpt-image-2 task ────────────────────────────────────────────
// Note: gpt-image-2's output_format enum is {"png", "jpeg", "webp"} — uses
// 'jpeg' (not 'jpg'). Default is webp; we override to jpeg for consistency
// with the rest of the pipeline that expects .jpg files on disk.
// OpenAI's gpt-image-2 only natively supports {1:1, 2:3, 3:2, auto}. Replicate
// 422-rejects anything else. Map common vertical/horizontal ratios to the
// closest supported value before submitting.
function _normalizeGptImage2AspectRatio(ar) {
  const map = {
    '9:16': '2:3',
    '4:5':  '2:3',
    '3:4':  '2:3',
    '2:3':  '2:3',
    '16:9': '3:2',
    '5:4':  '3:2',
    '4:3':  '3:2',
    '3:2':  '3:2',
    '1:1':  '1:1',
    '21:9': '3:2',
    'auto': 'auto',
    'match_input_image': 'auto',
  };
  return map[ar] || '2:3';
}

async function createGptImage2Task(prompt, imageUrls, aspectRatio, params = {}) {
  const urls = Array.isArray(imageUrls) ? imageUrls : (imageUrls ? [imageUrls] : []);
  const d = _getEngineDefaults('gptimage2');
  const rawAr = aspectRatio || d.aspect_ratio || '9:16';
  const normalizedAr = _normalizeGptImage2AspectRatio(rawAr);
  if (normalizedAr !== rawAr) {
    console.log('[gpt-image-2] aspect_ratio', rawAr, '→', normalizedAr, '(model-supported)');
  }
  const input = {
    prompt,
    aspect_ratio: normalizedAr,
    output_format: 'jpeg',
    quality: params.quality || d.quality || 'auto',
    background: params.background || d.background || 'auto',
    moderation: params.moderation || d.moderation || 'auto',
  };
  // Omit input_images entirely for text-to-image — Replicate's gpt-image-2
  // rejects an empty array on the t2i path.
  if (urls.length) input.input_images = urls;
  return await _createReplicatePrediction('openai/gpt-image-2', input);
}

// ── Create bytedance/seedream-5-lite task ────────────────────────────────────
// Supports up to 14 reference images. `quality`: 'basic' → 2K, 'high' → 3K.
// output_format enum is {"png", "jpeg"} — note 'jpeg' not 'jpg'.
async function createSeedream5LiteTask(prompt, imageUrls, aspectRatio, quality, params = {}) {
  const urls = Array.isArray(imageUrls) ? imageUrls : (imageUrls ? [imageUrls] : []);
  const d = _getEngineDefaults('seedream');
  // size resolution — caller's `quality` arg uses 'basic'|'high', user defaults
  // store '2K'|'3K' directly. Normalize: explicit > defaults > '2K'.
  const explicitSize = (params.size) || (quality === 'high' ? '3K' : quality === 'basic' ? '2K' : null);
  const input = {
    prompt,
    aspect_ratio: aspectRatio || d.aspect_ratio || (urls.length ? 'match_input_image' : '9:16'),
    size: explicitSize || d.size || '2K',
    output_format: 'jpeg',
    max_images: params.max_images ?? d.max_images ?? 1,
    sequential_image_generation: params.sequential_image_generation || d.sequential_image_generation || 'disabled',
  };
  if (urls.length) input.image_input = urls;
  return await _createReplicatePrediction('bytedance/seedream-5-lite', input);
}

// ── Text-to-image variants — pass null/empty image arrays to the same model
//    (nano-banana-2 / gpt-image-2 / seedream support text-to-image natively).
//    qwen-image-edit-plus does NOT support pure text-to-image, so we fall
//    back to seedream when the qwen text-to-image entry point is hit.
async function createNanoBananaProTextTask(prompt, aspectRatio, params = {}) {
  return await createNanoBananaProTask(prompt, null, aspectRatio, params);
}

async function createQwen2TextTask(prompt, aspectRatio, seed, params = {}) {
  console.warn('[qwen-edit-plus] нет режима text-to-image — переключаюсь на seedream');
  return await createSeedream5LiteTextTask(prompt, aspectRatio, params);
}

async function createGptImage2TextTask(prompt, aspectRatio, params = {}) {
  return await createGptImage2Task(prompt, null, aspectRatio, params);
}

async function createSeedream5LiteTextTask(prompt, aspectRatio, params = {}) {
  return await createSeedream5LiteTask(prompt, null, aspectRatio, undefined, params);
}

// ── Create bytedance/seedream-4.5 task ───────────────────────────────────────
// Faster than 5-lite. Same seedream input shape, but the size enum is 1K/2K/4K
// (no output_format field). Supports text-to-image and image editing (image_input).
async function createSeedream45Task(prompt, imageUrls, aspectRatio, quality, params = {}) {
  const urls = Array.isArray(imageUrls) ? imageUrls : (imageUrls ? [imageUrls] : []);
  const d = _getEngineDefaults('seedream4.5');
  // seedream-4.5 size enum is "2K" | "4K" | "custom" (NOT 1K/3K). Map quality
  // onto valid values: basic -> 2K (fast), high -> 4K.
  const explicitSize = (params.size) || (quality === 'high' ? '4K' : quality === 'basic' ? '2K' : null);
  const input = {
    prompt,
    aspect_ratio: aspectRatio || d.aspect_ratio || (urls.length ? 'match_input_image' : '9:16'),
    size: explicitSize || d.size || '2K',
    max_images: params.max_images ?? d.max_images ?? 1,
    sequential_image_generation: params.sequential_image_generation || d.sequential_image_generation || 'disabled',
  };
  if (urls.length) input.image_input = urls;
  return await _createReplicatePrediction('bytedance/seedream-4.5', input);
}
async function createSeedream45TextTask(prompt, aspectRatio, params = {}) {
  return await createSeedream45Task(prompt, null, aspectRatio, undefined, params);
}

// ── Create prunaai/z-image-turbo task (TEXT-TO-IMAGE, fast distilled 6B) ──────
// Pure t2i — NO image input. Size is in PIXELS (width/height, 64-2048), not an
// aspect enum. Turbo model: guidance_scale must stay 0, ~8 inference steps.
// Used by the Character Creator's "Generate base".
async function createZImageTurboTask(prompt, params = {}) {
  const d = _getEngineDefaults('z-turbo');
  const clamp = (n, def) => { n = parseInt(n, 10); return Number.isFinite(n) ? Math.max(64, Math.min(2048, n)) : def; };
  const input = {
    prompt,
    width:  clamp(params.width  != null ? params.width  : d.width,  768),
    height: clamp(params.height != null ? params.height : d.height, 1344),
    num_inference_steps: params.num_inference_steps != null ? params.num_inference_steps : (d.num_inference_steps != null ? d.num_inference_steps : 8),
    guidance_scale: params.guidance_scale != null ? params.guidance_scale : (d.guidance_scale != null ? d.guidance_scale : 0),
    go_fast: params.go_fast != null ? params.go_fast : (d.go_fast != null ? d.go_fast : true),
    output_format: params.output_format || d.output_format || 'jpg',
    output_quality: params.output_quality != null ? params.output_quality : (d.output_quality != null ? d.output_quality : 90),
  };
  if (params.seed) input.seed = params.seed;
  return await _createReplicatePrediction('prunaai/z-image-turbo', input);
}

// ── Create black-forest-labs/flux-1.1-pro-ultra task (TEXT-TO-IMAGE) ──────────
// High-quality t2i. `image_prompt` is a weak Redux-style remix reference, NOT
// real editing, so we treat this engine as t2i-only. safety_tolerance 1-6.
async function createFlux11UltraTask(prompt, aspectRatio, params = {}) {
  const d = _getEngineDefaults('flux-1.1-ultra');
  const input = {
    prompt,
    aspect_ratio: aspectRatio || d.aspect_ratio || '9:16',
    output_format: params.output_format || d.output_format || 'jpg',
    safety_tolerance: params.safety_tolerance != null ? params.safety_tolerance : (d.safety_tolerance != null ? d.safety_tolerance : 6),
    raw: params.raw != null ? params.raw : (d.raw != null ? d.raw : false),
  };
  if (params.seed) input.seed = params.seed;
  if (params.image_prompt) {
    input.image_prompt = params.image_prompt;
    if (input.safety_tolerance > 2) input.safety_tolerance = 2;   // capped when image_prompt is set
    if (params.image_prompt_strength != null) input.image_prompt_strength = params.image_prompt_strength;
  }
  return await _createReplicatePrediction('black-forest-labs/flux-1.1-pro-ultra', input);
}

// ── Create black-forest-labs/flux-2-max task (TEXT-TO-IMAGE + IMAGE EDIT) ─────
// Pass imageUrls for editing (input_images); omit for pure t2i. safety_tolerance
// 1-5; size via aspect_ratio (+ optional resolution "0.5 MP".."4 MP").
async function createFlux2MaxTask(prompt, imageUrls, aspectRatio, params = {}) {
  const urls = Array.isArray(imageUrls) ? imageUrls : (imageUrls ? [imageUrls] : []);
  const d = _getEngineDefaults('flux-2-max');
  const input = {
    prompt,
    aspect_ratio: aspectRatio || d.aspect_ratio || (urls.length ? 'match_input_image' : '9:16'),
    output_format: params.output_format || d.output_format || 'jpg',
    output_quality: params.output_quality != null ? params.output_quality : (d.output_quality != null ? d.output_quality : 90),
    safety_tolerance: params.safety_tolerance != null ? params.safety_tolerance : (d.safety_tolerance != null ? d.safety_tolerance : 5),
  };
  if (params.resolution || d.resolution) input.resolution = params.resolution || d.resolution;
  if (params.seed) input.seed = params.seed;
  if (urls.length) input.input_images = urls;
  return await _createReplicatePrediction('black-forest-labs/flux-2-max', input);
}

// ── Create prunaai/firered-image-edit task (IMAGE EDIT, i2i; single image) ────
// Default engine for the character creator's per-parameter edits. Requires an
// input image; aspect_ratio "match_input_image" keeps the base framing.
async function createFireredEditTask(prompt, imageUrl, aspectRatio, params = {}) {
  const urls = Array.isArray(imageUrl) ? imageUrl.filter(Boolean) : (imageUrl ? [imageUrl] : []);
  if (!urls.length) throw new Error('firered-image-edit requires an input image');
  const d = _getEngineDefaults('firered-edit');
  const input = {
    prompt,
    image: urls,
    aspect_ratio: aspectRatio || d.aspect_ratio || 'match_input_image',
    output_format: params.output_format || d.output_format || 'jpg',
    output_quality: params.output_quality != null ? params.output_quality : (d.output_quality != null ? d.output_quality : 95),
    true_cfg_scale: params.true_cfg_scale != null ? params.true_cfg_scale : (d.true_cfg_scale != null ? d.true_cfg_scale : 4),
    num_inference_steps: params.num_inference_steps != null ? params.num_inference_steps : (d.num_inference_steps != null ? d.num_inference_steps : 40),
    go_fast: params.go_fast != null ? params.go_fast : (d.go_fast != null ? d.go_fast : true),
  };
  if (params.seed) input.seed = params.seed;
  return await _createReplicatePrediction('prunaai/firered-image-edit', input);
}

// ── Create prunaai/p-image-edit task (IMAGE EDIT, i2i; `images` array) ────────
// Multi-mode editor (replicate_weights presets: relight, multiple_angles,
// to_anime, upscale, ...). NOTE the input field is `images` (array), not `image`.
async function createPImageEditTask(prompt, imageUrls, aspectRatio, params = {}) {
  const urls = Array.isArray(imageUrls) ? imageUrls.filter(Boolean) : (imageUrls ? [imageUrls] : []);
  if (!urls.length) throw new Error('p-image-edit requires an input image');
  const d = _getEngineDefaults('p-image-edit');
  const input = {
    prompt,
    images: urls,
    aspect_ratio: aspectRatio || d.aspect_ratio || 'match_input_image',
    turbo: params.turbo != null ? params.turbo : (d.turbo != null ? d.turbo : true),
    replicate_weights: params.replicate_weights || d.replicate_weights || 'default',
    disable_safety_checker: params.disable_safety_checker != null ? params.disable_safety_checker : (d.disable_safety_checker != null ? d.disable_safety_checker : false),
  };
  if (params.seed) input.seed = params.seed;
  return await _createReplicatePrediction('prunaai/p-image-edit', input);
}

// ── Unified image-EDIT dispatch by engine id (multi-reference) ────────────────
// Centralizes the engine ternary so every apply/edit path honours the SELECTED
// engine (incl. firered-edit / p-image-edit / flux-2-max), defaulting to
// nano-banana-2. Pass all reference images (active + lookbook/env/etc.) in urls.
async function createMultiRefEditTask(engine, prompt, imageUrls, aspectRatio, seed, params) {
  params = params || {};
  const ar = aspectRatio || '9:16';
  const urls = Array.isArray(imageUrls) ? imageUrls.filter(Boolean) : (imageUrls ? [imageUrls] : []);
  switch (engine) {
    case 'qwen2':        return createQwen2Task(prompt, urls[0], ar, seed, params);   // single ref only
    case 'seedream':     return createSeedream5LiteTask(prompt, urls, ar, 'basic', params);
    case 'seedream4.5':  return createSeedream45Task(prompt, urls, ar, 'basic', params);
    case 'gptimage2':    return createGptImage2Task(prompt, urls, ar, params);
    case 'flux-2-max':   return createFlux2MaxTask(prompt, urls, ar, params);
    case 'firered-edit': return createFireredEditTask(prompt, urls, ar, params);
    case 'p-image-edit': return createPImageEditTask(prompt, urls, ar, params);
    default:             return createNanoBananaProTaskMulti(prompt, urls, ar, seed, params);
  }
}

// ── Create prunaai/p-video task (text/image → video, no lipsync) ─────────────
// Different from p-video-avatar: p-video is a general t2v / i2v / a2v model
// used by the biroly tab. Supports both flows in one endpoint — `image`
// makes it i2v, no image makes it t2v.
// Schema (verified via Replicate model API):
//   prompt (str, required)
//   image (URI, optional)  → i2v
//   last_frame_image (URI, optional)
//   audio (URI, optional)  → a2v
//   duration (int 1-20, default 5; ignored if audio provided)
//   aspect_ratio (enum 16:9 / 9:16 / 4:3 / 3:4 / 3:2 / 2:3 / 1:1, default 16:9;
//                ignored if image provided — i2v keeps the image's AR)
//   resolution (enum 720p / 1080p, default 720p)
//   fps (enum 24 / 48, default 24)
//   draft (bool, default false) — 4× faster + cheaper preview
//   prompt_upsampling (bool, default true)
//   save_audio (bool, default true)
//   disable_safety_filter (bool, default true)
//   seed (int, optional)
async function createPVideoTask(prompt, imageUrl, audioUrl, params = {}) {
  if (!prompt) throw new Error('createPVideoTask: prompt is required');
  const d = _getEngineDefaults('prunaai/p-video');
  const input = { prompt };
  if (imageUrl) input.image = imageUrl;
  if (audioUrl) input.audio = audioUrl;
  if (params.last_frame_image) input.last_frame_image = params.last_frame_image;
  // duration is ignored by the model when audio is provided — but we still
  // forward it so user-config stays consistent for non-audio runs.
  input.duration              = Number(params.duration  ?? d.duration  ?? 5);
  input.aspect_ratio          = params.aspect_ratio     ?? d.aspect_ratio     ?? '16:9';
  input.resolution            = params.resolution       ?? d.resolution       ?? '720p';
  input.fps                   = Number(params.fps       ?? d.fps              ?? 24);
  input.draft                 = !!(params.draft               ?? d.draft               ?? false);
  input.prompt_upsampling     = (params.prompt_upsampling     ?? d.prompt_upsampling     ?? true);
  input.save_audio            = (params.save_audio            ?? d.save_audio            ?? true);
  input.disable_safety_filter = (params.disable_safety_filter ?? d.disable_safety_filter ?? true);
  if (params.seed != null && params.seed !== '' && Number(params.seed) > 0) {
    input.seed = Number(params.seed);
  }
  console.log('[p-video] final input to Replicate:', JSON.stringify(input));
  return await _createReplicatePrediction('prunaai/p-video', input);
}

// ── Create xai/grok-imagine-video task (text/image → video) ──────────────────
// One Replicate model handles both flows: no image = t2v, image = i2v.
// Documented inputs: prompt (str, required), image (URI, optional → i2v),
//   duration (int 1-15), aspect_ratio (16:9/9:16/1:1/4:3/3:4/3:2/2:3),
//   resolution (480p/720p), mode (normal/fun/...). Output: an mp4 URL.
// Returns a `repl:<id>` task id (poll via the Replicate predictions API).
async function createGrokImagineVideoTask(prompt, imageUrl, params = {}) {
  if (!prompt) throw new Error('createGrokImagineVideoTask: prompt is required');
  const input = { prompt };
  if (imageUrl) input.image = imageUrl;
  input.duration     = Number(params.duration ?? 6);
  input.aspect_ratio = params.aspect_ratio ?? '9:16';
  input.resolution   = params.resolution   ?? '480p';
  if (params.mode) input.mode = String(params.mode);
  console.log('[grok-imagine-video] final input to Replicate:', JSON.stringify(input));
  return await _createReplicatePrediction('xai/grok-imagine-video', input);
}

// ── Create prunaai/p-video-avatar task (talking-head: image + audio → video) ─
// Replicate schema (verified via the model's openapi_schema endpoint):
//   image (URI, required), audio (URI, optional — drives speech if provided),
//   resolution (enum: 720p | 1080p, default 720p),
//   video_prompt (string, default "The person is talking."),
//   disable_safety_filter (bool, default true), disable_prompt_upsampling
//   (bool, default false), seed (integer, optional).
// We intentionally OMIT voice / voice_script / voice_prompt / voice_language /
// no_op fields — we always pass real audio, no TTS-from-text needed.
async function createPVideoAvatarTask(imageUrl, audioUrl, params = {}) {
  if (!imageUrl) throw new Error('createPVideoAvatarTask: image is required');
  const d = _getEngineDefaults('prunaai/p-video-avatar');
  const input = {
    image: imageUrl,
    resolution: params.resolution || d.resolution || '720p',
    video_prompt: params.video_prompt || d.video_prompt || 'The person is talking.',
    disable_safety_filter: params.disable_safety_filter ?? d.disable_safety_filter ?? true,
    disable_prompt_upsampling: params.disable_prompt_upsampling ?? d.disable_prompt_upsampling ?? false,
  };
  if (audioUrl) input.audio = audioUrl;
  if (params.seed != null && params.seed !== '') input.seed = Number(params.seed);
  return await _createReplicatePrediction('prunaai/p-video-avatar', input);
}

// ── Create google/imagen-4-ultra task (text-to-image, no input image) ────────
// Replicate schema: prompt (str, required), aspect_ratio (enum), output_format
// (jpg/png), safety_filter_level (block_low_and_above | block_medium_and_above
// | block_only_high). Used for the "generate prop on white background" flow.
async function createImagen4UltraTask(prompt, aspectRatio, params = {}) {
  const d = _getEngineDefaults('imagen-4-ultra');
  const input = {
    prompt,
    aspect_ratio: aspectRatio || d.aspect_ratio || '1:1',
    output_format: params.output_format || d.output_format || 'jpg',
    safety_filter_level: params.safety_filter_level || d.safety_filter_level || 'block_only_high',
  };
  return await _createReplicatePrediction('google/imagen-4-ultra', input);
}

// ── Poll task and download result ─────────────────────────────────────────────
// Dispatches by taskId prefix: 'repl:<id>' → Replicate polling, otherwise the
// legacy kie.ai recordInfo endpoint. Same response shape on both paths so
// callers don't need to know which provider produced the task.
async function _resolveReplicateTask(predictionId, destDir, prefix) {
  const apiKey = _getReplicateApiKey();
  if (!apiKey) return { state: 'failed', error: 'Replicate API token not configured' };
  let pred;
  try {
    const res = await axios.get(`https://api.replicate.com/v1/predictions/${predictionId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      timeout: 15000,
    });
    pred = res.data;
  } catch (err) {
    console.error('[replicate-poll] axios error:', err.message, '| predId:', predictionId);
    return { state: 'failed', error: 'Replicate poll error: ' + err.message };
  }
  const status = pred?.status;
  console.log('[replicate-poll]', predictionId, '→ status:', status);
  if (status === 'failed' || status === 'canceled') {
    console.warn('[replicate-poll]', predictionId, 'failed:', pred?.error);
    return { state: 'failed', error: pred?.error || status };
  }
  if (status !== 'succeeded') {
    return { state: 'pending' };
  }
  // Output shape varies per model:
  //   string URL                (nano-banana-2 single)
  //   ["url1", "url2", …]       (gpt-image-2, seedream, qwen array of URLs)
  //   [{url:"…"}, …]            (some models — file objects)
  //   {url:"…"} | {image:"…"}   (some models)
  const _extractUrl = (out) => {
    if (!out) return null;
    if (typeof out === 'string') return out;
    if (Array.isArray(out)) {
      for (const item of out) {
        const u = _extractUrl(item);
        if (u) return u;
      }
      return null;
    }
    if (typeof out === 'object') {
      return out.url || out.image || out.image_url || out.imageUrl || null;
    }
    return null;
  };
  const remoteUrl = _extractUrl(pred.output);
  if (!remoteUrl) {
    console.warn('[replicate-poll] succeeded but no URL parsed. raw output:', JSON.stringify(pred.output).slice(0, 400));
    return { state: 'failed', error: 'Replicate: empty output (raw: ' + JSON.stringify(pred.output).slice(0, 200) + ')' };
  }
  console.log('[replicate-poll]', predictionId, 'succeeded →', remoteUrl.slice(0, 80));

  const { ROOT_DIR: _ROOT_DIR } = require('./config');
  let urlPrefix = path.relative(_ROOT_DIR, destDir).replace(/\\/g, '/');
  if (!urlPrefix || urlPrefix.startsWith('..')) urlPrefix = 'uploads';

  // Idempotent — reuse if we've already downloaded for this prediction.
  const tag = predictionId.slice(-10);
  const existing = fs.readdirSync(destDir).find(f => f.includes(tag));
  if (existing) return { state: 'success', imagePath: `/${urlPrefix}/${existing}` };

  const filename = `${prefix}_repl${tag}_${Date.now()}.jpg`;
  const destFilePath = path.join(destDir, filename);
  await downloadImage(remoteUrl, destFilePath);
  await compressBelow9MB(destFilePath);
  const thumbPath = path.join(destDir, 'thumbs', filename);
  try { await createThumbnail(destFilePath, thumbPath); } catch (e) { console.warn('[thumb]', e.message); }
  return { state: 'success', imagePath: `/${urlPrefix}/${filename}` };
}

async function resolveTask(taskId, destDir, prefix) {
  // Replicate predictions are tagged with 'repl:' on creation.
  if (typeof taskId === 'string' && taskId.startsWith('repl:')) {
    return await _resolveReplicateTask(taskId.slice(5), destDir, prefix);
  }
  const statusRes = await axios.get(
    `${KIE_BASE}/api/v1/jobs/recordInfo`,
    { params: { taskId }, headers: kieHeaders(), timeout: 15000 }
  );
  const data  = statusRes.data?.data;
  const state = data?.state;

  if (state === 'success') {
    let remoteUrl = null;
    try {
      const parsed = JSON.parse(data.resultJson);
      console.log('[resolveTask] resultJson for', taskId, ':', JSON.stringify(parsed).slice(0, 300));
      remoteUrl = parsed.resultUrls?.[0]
        || parsed.images?.[0]
        || parsed.image_url
        || parsed.url
        || parsed.data?.[0]?.url
        || parsed.result?.url
        || (Array.isArray(parsed.output) ? parsed.output[0] : null)
        || (typeof parsed.output === 'string' ? parsed.output : null)
        || null;
    } catch {}
    if (!remoteUrl) return { state: 'failed', error: 'No result URL' };

    // Build the URL prefix dynamically from destDir's location under ROOT_DIR
    // so callers can pass any subtree (e.g. obrazy/<some-folder>/) and get the
    // matching public URL. Falls back to 'uploads' if destDir isn't under root.
    const { ROOT_DIR: _ROOT_DIR } = require('./config');
    let urlPrefix = path.relative(_ROOT_DIR, destDir).replace(/\\/g, '/');
    if (!urlPrefix || urlPrefix.startsWith('..')) urlPrefix = 'uploads';

    // Idempotent: reuse if already downloaded
    const existing = fs.readdirSync(destDir).find(f => f.includes(taskId));
    if (existing) return { state: 'success', imagePath: `/${urlPrefix}/${existing}` };

    const filename = `${prefix}_${taskId}_${Date.now()}.jpg`;
    const destFilePath = path.join(destDir, filename);
    await downloadImage(remoteUrl, destFilePath);
    await compressBelow9MB(destFilePath);
    const thumbPath = path.join(destDir, 'thumbs', filename);
    try { await createThumbnail(destFilePath, thumbPath); } catch (e) { console.warn('[thumb]', e.message); }
    return { state: 'success', imagePath: `/${urlPrefix}/${filename}` };
  }

  if (state === 'failed') return { state: 'failed', error: data?.failMsg || 'failed' };
  return { state: state || 'pending' };
}

// ── Shared AI call: Gemini 3.1 Pro with retry → GPT-5.2 fallback ─────────────
// messages: OpenAI-format messages array (supports image_url for vision calls)
// opts: { timeout?, maxAttempts? }
// Returns trimmed text string; throws if all attempts return empty/error.
// Strip inline image markdown ![alt](url) — some models inject image generation into text responses
function _stripImages(text) {
  return text.replace(/!\[[^\]]*\]\([^)]+\)/g, '').trim();
}

async function callAI(messages, opts = {}) {
  const { timeout = 45000 } = opts;

  // 0. OpenRouter (default primary, opt-out via useOpenRouter:false) — same OpenAI-compatible messages format
  if (opts.useOpenRouter !== false) {
    console.log('[callAI] trying OpenRouter…');
    const orText = await _callOpenRouter(messages, opts);
    if (orText) return _stripImages(orText);
    console.warn('[callAI] OpenRouter empty/error → kie.ai cascade');
  }

  // 1. GPT-5.4
  console.log('[callAI] trying GPT-5.4…');
  try {
    const res = await axios.post(
      `${KIE_BASE}/gpt-5-4/v1/chat/completions`,
      { stream: false, messages },
      { headers: kieHeaders(), timeout }
    );
    const raw = _stripImages((res.data?.choices?.[0]?.message?.content || '').trim());
    if (raw) { console.log('[callAI] GPT-5.4 ok'); return raw; }
    console.warn('[callAI] GPT-5.4 empty');
  } catch (e) {
    console.warn('[callAI] GPT-5.4 error:', e.message);
  }

  // 2. GPT-5.2
  console.warn('[callAI] falling back to GPT-5.2…');
  try {
    const res = await axios.post(
      `${KIE_BASE}/gpt-5-2/v1/chat/completions`,
      { stream: false, messages },
      { headers: kieHeaders(), timeout }
    );
    const raw = _stripImages((res.data?.choices?.[0]?.message?.content || '').trim());
    if (raw) { console.log('[callAI] GPT-5.2 ok'); return raw; }
    console.warn('[callAI] GPT-5.2 empty');
  } catch (e) {
    console.warn('[callAI] GPT-5.2 error:', e.message);
  }

  // 3. Gemini 3.1 Pro
  console.warn('[callAI] falling back to Gemini 3.1 Pro…');
  try {
    const res = await axios.post(
      `${KIE_BASE}/gemini-3.1-pro/v1/chat/completions`,
      { stream: false, messages },
      { headers: kieHeaders(), timeout }
    );
    const raw = _stripImages((res.data?.choices?.[0]?.message?.content || '').trim());
    if (raw) { console.log('[callAI] Gemini 3.1 Pro ok'); return raw; }
    console.warn('[callAI] Gemini 3.1 Pro empty');
  } catch (e) {
    console.warn('[callAI] Gemini 3.1 Pro error:', e.message);
  }

  // 4. Gemini Flash (native generateContent format)
  console.warn('[callAI] falling back to Gemini Flash…');
  try {
    const geminiContents = messages
      .filter(m => m.role !== 'system')
      .map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: typeof m.content === 'string' ? m.content : (m.content?.[0]?.text || '') }],
      }));
    const sysMsg = messages.find(m => m.role === 'system');
    if (sysMsg) geminiContents.unshift({ role: 'user', parts: [{ text: sysMsg.content }] });
    const flashRes = await axios.post(
      `${KIE_BASE}/gemini/v1/models/gemini-3-flash-v1beta:generateContent`,
      { stream: false, contents: geminiContents },
      { headers: kieHeaders(), timeout }
    );
    const raw = _stripImages((flashRes.data?.candidates?.[0]?.content?.parts?.[0]?.text || '').trim());
    if (raw) { console.log('[callAI] Gemini Flash ok'); return raw; }
    console.warn('[callAI] Gemini Flash empty');
  } catch (e) {
    console.error('[callAI] Gemini Flash error:', e.message);
  }

  throw new Error('GPT-5.4, GPT-5.2, Gemini 3.1 Pro и Gemini Flash вернули пустой ответ');
}

// ── Vision AI call: Gemini 3.1 Pro (kie.ai routes all vision through Gemini) ──
// messages: OpenAI-format messages array (supports image_url for vision calls)

// content can be a plain string OR an array of content-parts [{type:'text',text:'...'}]
function _extractText(raw) {
  if (typeof raw === 'string') return raw.trim();
  if (Array.isArray(raw)) return raw.filter(p => p?.type === 'text').map(p => p.text || '').join('').trim();
  return '';
}

async function callAIVision(messages, opts = {}) {
  const { timeout = 90000, maxAttempts = 3 } = opts;

  // 0. OpenRouter (default primary, opt-out via useOpenRouter:false) — same OpenAI-compatible vision messages
  if (opts.useOpenRouter !== false) {
    console.log('[callAIVision] trying OpenRouter…');
    const orText = await _callOpenRouter(messages, opts);
    if (orText) return orText;
    console.warn('[callAIVision] OpenRouter empty/error → kie.ai Gemini cascade');
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await axios.post(
        `${KIE_BASE}/gemini-3.1-pro/v1/chat/completions`,
        { stream: false, messages },
        { headers: kieHeaders(), timeout }
      );
      const raw  = res.data?.choices?.[0]?.message?.content;
      const text = _extractText(raw);
      if (text) {
        console.log(`[callAIVision] Gemini ok (attempt ${attempt})`);
        return text;
      }
      console.warn(`[callAIVision] Gemini empty attempt ${attempt} — full response:`, JSON.stringify(res.data).slice(0, 500));
    } catch (e) {
      console.warn(`[callAIVision] Gemini error attempt ${attempt}:`, e.response?.data || e.message);
    }
    if (attempt < maxAttempts) await new Promise(r => setTimeout(r, 2000));
  }

  throw new Error('Gemini 3.1 Pro не вернул ответ после 3 попыток');
}

// ── Vision AI call with fallback chain: GPT-5.2 → Gemini 3.1 Pro → Gemini Flash ─
// messages: OpenAI-format messages array with image_url content parts
// Each provider gets exactly 1 attempt; on failure/empty moves to next.
async function callAIVisionWithFallback(messages, opts = {}) {
  const { timeout = 90000 } = opts;

  // 0. OpenRouter (default primary, opt-out via useOpenRouter:false) — same OpenAI-compatible vision messages
  if (opts.useOpenRouter !== false) {
    console.log('[callAIVisionFallback] trying OpenRouter…');
    const orText = await _callOpenRouter(messages, opts);
    if (orText) return orText;
    console.warn('[callAIVisionFallback] OpenRouter empty/error → kie.ai cascade');
  }

  // 1. GPT-5.4
  console.log('[callAIVisionFallback] trying GPT-5.4…');
  try {
    const res = await axios.post(
      `${KIE_BASE}/gpt-5-4/v1/chat/completions`,
      { stream: false, messages },
      { headers: kieHeaders(), timeout }
    );
    const text = _extractText(res.data?.choices?.[0]?.message?.content);
    if (text) { console.log('[callAIVisionFallback] GPT-5.4 ok'); return text; }
    console.warn('[callAIVisionFallback] GPT-5.4 empty');
  } catch (e) {
    console.warn('[callAIVisionFallback] GPT-5.4 error:', e.message);
  }

  // 2. GPT-5.2
  console.warn('[callAIVisionFallback] falling back to GPT-5.2…');
  try {
    const res = await axios.post(
      `${KIE_BASE}/gpt-5-2/v1/chat/completions`,
      { stream: false, messages },
      { headers: kieHeaders(), timeout }
    );
    const text = _extractText(res.data?.choices?.[0]?.message?.content);
    if (text) { console.log('[callAIVisionFallback] GPT-5.2 ok'); return text; }
    console.warn('[callAIVisionFallback] GPT-5.2 empty');
  } catch (e) {
    console.warn('[callAIVisionFallback] GPT-5.2 error:', e.message);
  }

  // 3. Gemini 3.1 Pro (OpenAI-compat vision)
  console.warn('[callAIVisionFallback] falling back to Gemini 3.1 Pro…');
  try {
    const res = await axios.post(
      `${KIE_BASE}/gemini-3.1-pro/v1/chat/completions`,
      { stream: false, messages },
      { headers: kieHeaders(), timeout }
    );
    const text = _extractText(res.data?.choices?.[0]?.message?.content);
    if (text) { console.log('[callAIVisionFallback] Gemini 3.1 Pro ok'); return text; }
    console.warn('[callAIVisionFallback] Gemini 3.1 Pro empty');
  } catch (e) {
    console.warn('[callAIVisionFallback] Gemini 3.1 Pro error:', e.message);
  }

  // 3. Gemini Flash (native format — download image, pass as base64 inline_data)
  console.warn('[callAIVisionFallback] falling back to Gemini Flash…');
  try {
    const imageUrls = [];
    let textContent = '';
    for (const msg of messages) {
      const parts = Array.isArray(msg.content) ? msg.content : [];
      for (const part of parts) {
        if (part.type === 'image_url' && part.image_url?.url) imageUrls.push(part.image_url.url);
        if (part.type === 'text') textContent = part.text || '';
      }
    }
    let geminiParts;
    if (imageUrls.length) {
      const imgBuffers = await Promise.all(
        imageUrls.map(url => axios.get(url, { responseType: 'arraybuffer', timeout: 30000 }))
      );
      const inlineParts = imgBuffers.map(r => ({
        inline_data: {
          mime_type: (r.headers['content-type'] || 'image/jpeg').split(';')[0].trim(),
          data: Buffer.from(r.data).toString('base64'),
        },
      }));
      geminiParts = [{ text: textContent }, ...inlineParts];
    } else {
      geminiParts = [{ text: textContent }];
    }
    const flashRes = await axios.post(
      `${KIE_BASE}/gemini/v1/models/gemini-3-flash-v1beta:generateContent`,
      { stream: false, contents: [{ role: 'user', parts: geminiParts }] },
      { headers: kieHeaders(), timeout }
    );
    const text = (flashRes.data?.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
    if (text) { console.log('[callAIVisionFallback] Gemini Flash ok'); return text; }
    console.warn('[callAIVisionFallback] Gemini Flash empty');
  } catch (e) {
    console.error('[callAIVisionFallback] Gemini Flash error:', e.message);
  }

  throw new Error('Все анализаторы вернули пустой ответ (GPT-5.4 → GPT-5.2 → Gemini 3.1 Pro → Gemini Flash)');
}

// ── Normalize a video to a browser/concat-safe format ───────────────────────
// Replicate-produced mp4s often use codec profiles or pixel formats that the
// browser's <video> tag can't decode (yuv422p, yuv420p10le, H.265) and that
// ffmpeg concat demuxer can't merge with other clips. This helper re-encodes
// any input to H.264 main + yuv420p + AAC 44.1kHz + faststart, in place,
// guaranteeing the file plays everywhere (Safari/iOS included) and merges
// cleanly with kie.ai-sourced clips.
//
// Strategy: ffmpeg → temp file, rename over the original. The caller passes
// an absolute path; we don't change the filename or extension. CPU cost is
// ~real-time-ish for 720p clips (1-3 sec per 5-sec video) — negligible vs
// the 30-60 sec the model itself took.
// onProc(child): optional hook so the caller can register the spawned ffmpeg and
// kill it (used by the render job's Cancel — normalization is otherwise a long,
// untracked re-encode that would keep running after Cancel).
async function normalizeVideoForBrowser(absPath, onProc) {
  const { execFile }   = require('child_process');
  const ffmpegPath     = require('ffmpeg-static');
  if (!absPath || !fs.existsSync(absPath)) return;
  const tmpPath = absPath + '.norm.mp4';
  await new Promise((resolve, reject) => {
    const child = execFile(ffmpegPath, [
      '-y',
      '-i', absPath,
      '-c:v', 'libx264', '-profile:v', 'main', '-level', '4.0',
      '-pix_fmt', 'yuv420p', '-crf', '19', '-preset', 'veryfast',
      '-c:a', 'aac', '-b:a', '128k', '-ar', '44100',
      '-movflags', '+faststart',
      tmpPath,
    ], { timeout: 180000 }, (err) => {
      if (err) { try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch {} return reject(err); }
      resolve();
    });
    if (typeof onProc === 'function') { try { onProc(child); } catch {} }
  });
  fs.renameSync(tmpPath, absPath);
}

module.exports = {
  kieHeaders, analyzeWithGemini, analyzeRealismMarkers, translateToEnglish, buildPrompt, callAI, callAIBase64, callAIVision, callAIVisionWithFallback,
  getImgVisionModel,
  uploadToPublicHost, downloadImage, compressBelow9MB,
  createNanoBananaTask, createNanoBananaProTask, createNanoBananaProTaskMulti, createQwen2Task,
  createGptImage2Task, createSeedream5LiteTask, createSeedream45Task, createZImageTurboTask, createFlux11UltraTask, createFlux2MaxTask, createFireredEditTask, createPImageEditTask, createMultiRefEditTask, resolveTask,
  createNanoBananaProTextTask, createQwen2TextTask, createGptImage2TextTask, createSeedream5LiteTextTask, createSeedream45TextTask,
  createImagen4UltraTask,
  createPVideoAvatarTask,
  createPVideoTask,
  createGrokImagineVideoTask,
  createThumbnail, generateMissingThumbs,
  normalizeVideoForBrowser,
};
