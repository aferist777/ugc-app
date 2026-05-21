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
  if (changed) _saveSettings(s);
})();

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

// ── Gemini: video analysis via multiple frames (image endpoint, proven to work) ─
// frameBase64Array: string[] — JPEG frames as base64, extracted from the video
async function callAIVideo(prompt, frameBase64Array, opts = {}) {
  const { timeout = 90000, maxAttempts = 2 } = opts;
  const frames = Array.isArray(frameBase64Array) ? frameBase64Array : [frameBase64Array];
  const parts = [
    { text: prompt },
    ...frames.map(f => ({ inline_data: { mime_type: 'image/jpeg', data: f } })),
  ];

  // 0. OpenRouter (default primary, opt-out via useOpenRouter:false) — multi-image vision via OpenAI-compatible image_url[]
  if (opts.useOpenRouter !== false) {
    console.log(`[callAIVideo] trying OpenRouter with ${frames.length} frames…`);
    const orMessages = [{ role: 'user', content: [
      { type: 'text', text: prompt },
      ...frames.map(f => ({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${f}` } })),
    ]}];
    const orText = await _callOpenRouter(orMessages, opts);
    if (orText) return orText;
    console.warn('[callAIVideo] OpenRouter empty/error → kie.ai Gemini cascade');
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await axios.post(
        `${KIE_BASE}/gemini/v1/models/gemini-3-flash-v1beta:generateContent`,
        { stream: false, contents: [{ role: 'user', parts }] },
        { headers: kieHeaders(), timeout }
      );
      const text = (res.data?.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
      if (text) return text;
      console.warn(`[callAIVideo] Gemini empty, attempt ${attempt}/${maxAttempts}`, JSON.stringify(res.data).slice(0, 200));
    } catch (e) {
      console.warn(`[callAIVideo] attempt ${attempt}/${maxAttempts}: ${e.message}`);
      if (attempt === maxAttempts) throw e;
    }
  }
  throw new Error('Gemini вернул пустой ответ для видео');
}

// ── Gemini: skin analysis ─────────────────────────────────────────────────────
async function analyzeWithGemini(faceBase64) {
  const prompt =
    `You are a skin analysis assistant. Look at this face photo carefully. ` +
    `From the list below, identify which skin characteristics are visible or likely present on this person. ` +
    `Return ONLY a comma-separated list of applicable terms from the list, nothing else. ` +
    `List: ${SKIN_PARAMS.join(', ')}.`;

  const text = await callAIBase64(prompt, faceBase64);
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

  return await callAIBase64(prompt, imageBase64);
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
  const suffix = skinDetails + `${NO_RETOUCH.join(', ')}. High quality, 4k resolution, cinematic look, shot on iPhone 15 Pro.` + realismClause;
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
const _UPLOAD_HOST_NAMES = ['tmpfiles.org', 'uguu.se', 'litterbox.catbox.moe', 'imgcdn.dev'];
const _UPLOAD_HOSTS = [
  // 1. tmpfiles.org — JSON API, 24h
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
  throw new Error('[uploadToPublicHost] all 4 hosts failed');
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

// ── Create nano-banana-2 task ─────────────────────────────────────────────────
async function createNanoBananaTask(prompt, imageUrl, aspectRatio) {
  const res = await axios.post(
    `${KIE_BASE}/api/v1/jobs/createTask`,
    { model: 'nano-banana-2', input: { prompt, image_input: [imageUrl], aspect_ratio: aspectRatio, resolution: '4K', output_format: 'jpg' } },
    { headers: kieHeaders(), timeout: 30000 }
  );
  const taskId = res.data?.data?.taskId;
  if (!taskId) throw new Error('kie.ai не вернул taskId: ' + JSON.stringify(res.data));
  return taskId;
}

// ── Create nano-banana-2 task (image-to-image, scene generation) ─────────────
async function createNanoBananaProTask(prompt, imageUrl, aspectRatio, params = {}) {
  const input = {
    prompt, image_input: [imageUrl], aspect_ratio: aspectRatio,
    resolution:    params.resolution    || '2K',
    output_format: params.output_format || 'jpg',
  };
  const res = await axios.post(
    `${KIE_BASE}/api/v1/jobs/createTask`,
    { model: 'nano-banana-2', input },
    { headers: kieHeaders(), timeout: 30000 }
  );
  const taskId = res.data?.data?.taskId;
  if (!taskId) throw new Error('kie.ai не вернул taskId: ' + JSON.stringify(res.data));
  return taskId;
}

// ── Create nano-banana-2 task with multiple reference images ──────────────────
async function createNanoBananaProTaskMulti(prompt, imageUrls, aspectRatio, seed, params = {}) {
  const input = {
    prompt, image_input: imageUrls, aspect_ratio: aspectRatio,
    resolution:    params.resolution    || '2K',
    output_format: params.output_format || 'jpg',
  };
  const res = await axios.post(
    `${KIE_BASE}/api/v1/jobs/createTask`,
    { model: 'nano-banana-2', input },
    { headers: kieHeaders(), timeout: 30000 }
  );
  const taskId = res.data?.data?.taskId;
  if (!taskId) throw new Error('kie.ai не вернул taskId: ' + JSON.stringify(res.data));
  return taskId;
}

// ── Create qwen2/image-edit task (single reference image) ────────────────────
async function createQwen2Task(prompt, imageUrl, aspectRatio, seed, params = {}) {
  const input = {
    prompt, image_url: imageUrl, image_size: aspectRatio || '9:16',
    output_format: params.output_format || 'jpeg',
  };
  if (seed) input.seed = seed;
  const res = await axios.post(
    `${KIE_BASE}/api/v1/jobs/createTask`,
    { model: 'qwen2/image-edit', input },
    { headers: kieHeaders(), timeout: 30000 }
  );
  const taskId = res.data?.data?.taskId;
  if (!taskId) throw new Error('kie.ai не вернул taskId: ' + JSON.stringify(res.data));
  return taskId;
}

// ── Create gpt/image-2-image-to-image task ────────────────────────────────────
// quality: 'auto' | 'high' | 'medium' | 'low'
const GPT_IMAGE_2_SIZE_MAP = {
  '1:1': '1024x1024', '9:16': '1024x1536', '16:9': '1536x1024',
  '3:4': '1024x1365', '4:3': '1365x1024',
};
async function createGptImage2Task(prompt, imageUrls, aspectRatio, params = {}) {
  const urls = Array.isArray(imageUrls) ? imageUrls : [imageUrls];
  const res = await axios.post(
    `${KIE_BASE}/api/v1/jobs/createTask`,
    { model: 'gpt-image-2-image-to-image', input: { prompt, input_urls: urls, aspect_ratio: aspectRatio || '9:16', nsfw_checker: false } },
    { headers: kieHeaders(), timeout: 30000 }
  );
  const taskId = res.data?.data?.taskId;
  if (!taskId) throw new Error('kie.ai не вернул taskId: ' + JSON.stringify(res.data));
  return taskId;
}

// ── Create seedream/5-lite-image-to-image task ────────────────────────────────
// Supports up to 14 reference images; quality: 'basic' (2K) | 'high' (4K)
async function createSeedream5LiteTask(prompt, imageUrls, aspectRatio, quality, params = {}) {
  const res = await axios.post(
    `${KIE_BASE}/api/v1/jobs/createTask`,
    {
      model: 'seedream/5-lite-image-to-image',
      input: {
        prompt,
        image_urls:   Array.isArray(imageUrls) ? imageUrls : [imageUrls],
        aspect_ratio: aspectRatio || '9:16',
        quality:      params.quality || quality || 'basic',
      },
    },
    { headers: kieHeaders(), timeout: 30000 }
  );
  const taskId = res.data?.data?.taskId;
  if (!taskId) throw new Error('kie.ai не вернул taskId: ' + JSON.stringify(res.data));
  return taskId;
}

// ── Text-to-image: nano-banana-2 (no reference image) ────────────────────────
async function createNanoBananaProTextTask(prompt, aspectRatio, params = {}) {
  const input = {
    prompt, aspect_ratio: aspectRatio || '9:16',
    resolution:    params.resolution    || '2K',
    output_format: params.output_format || 'jpg',
  };
  const res = await axios.post(
    `${KIE_BASE}/api/v1/jobs/createTask`,
    { model: 'nano-banana-2', input },
    { headers: kieHeaders(), timeout: 30000 }
  );
  const taskId = res.data?.data?.taskId;
  if (!taskId) throw new Error('kie.ai не вернул taskId: ' + JSON.stringify(res.data));
  return taskId;
}

// ── Text-to-image: qwen/text-to-image (no reference image) ───────────────────
// image_size uses named presets, not ratio strings
const QWEN_ASPECT_MAP = {
  '1:1':  'square_hd',
  '4:3':  'landscape_4_3',
  '3:4':  'portrait_4_3',
  '16:9': 'landscape_16_9',
  '9:16': 'portrait_16_9',
};
async function createQwen2TextTask(prompt, aspectRatio, seed, params = {}) {
  const image_size = QWEN_ASPECT_MAP[aspectRatio] || 'portrait_16_9';
  const input = {
    prompt, image_size,
    output_format:        params.output_format        || 'jpeg',
    num_inference_steps:  params.num_inference_steps  ?? 30,
    guidance_scale:       params.guidance_scale        ?? 2.5,
  };
  if (seed) input.seed = seed;
  const res = await axios.post(
    `${KIE_BASE}/api/v1/jobs/createTask`,
    { model: 'qwen/text-to-image', input },
    { headers: kieHeaders(), timeout: 30000 }
  );
  const taskId = res.data?.data?.taskId;
  if (!taskId) throw new Error('kie.ai не вернул taskId: ' + JSON.stringify(res.data));
  return taskId;
}

// ── Text-to-image: gpt/image-2-text-to-image (no reference image) ─────────────
async function createGptImage2TextTask(prompt, aspectRatio, params = {}) {
  const res = await axios.post(
    `${KIE_BASE}/api/v1/jobs/createTask`,
    { model: 'gpt-image-2-text-to-image', input: { prompt, aspect_ratio: aspectRatio || '9:16', output_format: 'jpg', nsfw_checker: false } },
    { headers: kieHeaders(), timeout: 30000 }
  );
  const taskId = res.data?.data?.taskId;
  if (!taskId) throw new Error('kie.ai не вернул taskId: ' + JSON.stringify(res.data));
  return taskId;
}

// ── Text-to-image: seedream/5-lite-text-to-image (no reference image) ─────────
// seed not supported by this model
async function createSeedream5LiteTextTask(prompt, aspectRatio, params = {}) {
  const res = await axios.post(
    `${KIE_BASE}/api/v1/jobs/createTask`,
    { model: 'seedream/5-lite-text-to-image', input: { prompt, aspect_ratio: aspectRatio || '9:16', quality: params.quality || 'basic' } },
    { headers: kieHeaders(), timeout: 30000 }
  );
  const taskId = res.data?.data?.taskId;
  if (!taskId) throw new Error('kie.ai не вернул taskId: ' + JSON.stringify(res.data));
  return taskId;
}

// ── Poll task and download result ─────────────────────────────────────────────
async function resolveTask(taskId, destDir, prefix) {
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

    const dirName = {
      [LOOKBOOKS_DIR]:    'lookbooks',
      [ENVIRONMENTS_DIR]: 'environments',
      [CHARACTERS_DIR]:   'characters',
      [SCENES_DIR]:       'scenes',
      [REFS_DIR]:         'refs',
    }[destDir] || 'uploads';

    // Idempotent: reuse if already downloaded
    const existing = fs.readdirSync(destDir).find(f => f.includes(taskId));
    if (existing) return { state: 'success', imagePath: `/${dirName}/${existing}` };

    const filename = `${prefix}_${taskId}_${Date.now()}.jpg`;
    const destFilePath = path.join(destDir, filename);
    await downloadImage(remoteUrl, destFilePath);
    await compressBelow9MB(destFilePath);
    const thumbPath = path.join(destDir, 'thumbs', filename);
    try { await createThumbnail(destFilePath, thumbPath); } catch (e) { console.warn('[thumb]', e.message); }
    return { state: 'success', imagePath: `/${dirName}/${filename}` };
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

module.exports = {
  kieHeaders, analyzeWithGemini, analyzeRealismMarkers, translateToEnglish, buildPrompt, callAI, callAIBase64, callAIVision, callAIVisionWithFallback, callAIVideo,
  uploadToPublicHost, downloadImage, compressBelow9MB,
  createNanoBananaTask, createNanoBananaProTask, createNanoBananaProTaskMulti, createQwen2Task,
  createGptImage2Task, createSeedream5LiteTask, resolveTask,
  createNanoBananaProTextTask, createQwen2TextTask, createGptImage2TextTask, createSeedream5LiteTextTask,
  createThumbnail, generateMissingThumbs,
};
