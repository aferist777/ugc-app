'use strict';

const fs       = require('fs');
const path     = require('path');
const axios    = require('axios');
const FormData = require('form-data');
const sharp    = require('sharp');

const {
  KIE_BASE, SKIN_PARAMS, NO_RETOUCH,
  UPLOADS_DIR, LOOKBOOKS_DIR, CHARACTERS_DIR, ENVIRONMENTS_DIR, SCENES_DIR, REFS_DIR,
} = require('./config');
const { getPrompt } = require('./prompts');

// ── Auth header ───────────────────────────────────────────────────────────────
function kieHeaders() {
  return {
    Authorization: `Bearer ${process.env.KIE_AI_API_KEY}`,
    'Content-Type': 'application/json',
  };
}

// ── Shared AI call: Gemini flash (base64 inline) → GPT-5.2 fallback ─────────
// Used for calls that send a base64 image in Gemini's native format.
// On Gemini failure/empty, falls back to GPT-5.2 via OpenAI-compatible image_url.
async function callAIBase64(prompt, imageBase64, mimeType = 'image/jpeg', opts = {}) {
  const { timeout = 30000, maxAttempts = 2 } = opts;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await axios.post(
        `${KIE_BASE}/gemini/v1/models/gemini-3-flash-v1beta:generateContent`,
        {
          stream: false,
          contents: [{ role: 'user', parts: [
            { text: prompt },
            { inline_data: { mime_type: mimeType, data: imageBase64 } },
          ]}],
        },
        { headers: kieHeaders(), timeout }
      );
      const text = (res.data?.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
      if (text) {
        if (attempt > 1) console.log(`[callAIBase64] Gemini ok on attempt ${attempt}`);
        return text;
      }
      console.warn(`[callAIBase64] Gemini empty, attempt ${attempt}/${maxAttempts}`);
    } catch (e) {
      console.warn(`[callAIBase64] Gemini error attempt ${attempt}/${maxAttempts}: ${e.message}`);
    }
  }

  // Fallback to GPT-5.2 using base64 data URL
  console.warn('[callAIBase64] Gemini exhausted, falling back to GPT-5.2…');
  try {
    const dataUrl = `data:${mimeType};base64,${imageBase64}`;
    const gptRes = await axios.post(
      `${KIE_BASE}/gpt-5-2/v1/chat/completions`,
      {
        messages: [{
          role: 'user',
          content: [
            { type: 'text',      text: prompt },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        }],
      },
      { headers: kieHeaders(), timeout }
    );
    const text = (gptRes.data?.choices?.[0]?.message?.content || '').trim();
    if (text) { console.log('[callAIBase64] GPT-5.2 fallback ok'); return text; }
  } catch (e) {
    console.error('[callAIBase64] GPT-5.2 error:', e.message);
  }

  throw new Error('Gemini и GPT-5.2 вернули пустой ответ');
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
async function analyzeRealismMarkers(imageBase64) {
  const prompt =
    `Look at this image and select ONLY the realism markers from the list below that genuinely fit this image's context.\n` +
    `Consider: is skin visible? what lighting type? indoor/outdoor? what clothing materials? is hair detailed? are hands visible?\n` +
    `DO NOT include markers that don't fit. Return ONLY a comma-separated list of selected markers, nothing else.\n\n` +
    `Available markers:\n` +
    `phone-camera realism, subtle sensor grain, slight edge softness,\n` +
    `unretouched, no smoothing, no beauty filters, no airbrushing,\n` +
    `indoor near window, natural contrast, accurate white balance, soft side lighting,\n` +
    `no symmetry correction, shallow depth of field, editorial realism,\n` +
    `visible pores, fine micro-texture, subtle under-eye texture,\n` +
    `organic acne marks (non-repeating), uneven pigmentation, subtle redness, visible fine lines, acne scars,\n` +
    `natural oil sheen only on high points, natural flyaways,\n` +
    `visible veins, hand anatomy, realistic proportions, clear fabric texture separation`;

  return await callAIBase64(prompt, imageBase64);
}

// ── Gemini: translate to English ──────────────────────────────────────────────
async function translateToEnglish(text) {
  return await callAI([{
    role: 'user',
    content: `Translate the following text to English. Return only the translated text, nothing else:\n\n${text}`,
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
  const realismClause = realismMarkers ? ` Photorealism: ${realismMarkers}.` : '';
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

// ── Upload image buffer to litterbox.catbox.moe ───────────────────────────────
async function uploadToPublicHost(imageBuffer) {
  const form = new FormData();
  form.append('reqtype', 'fileupload');
  form.append('time', '1h');
  form.append('fileToUpload', imageBuffer, { filename: 'face.jpg', contentType: 'image/jpeg' });
  const res = await axios.post(
    'https://litterbox.catbox.moe/resources/internals/api.php',
    form,
    { headers: form.getHeaders(), timeout: 30000 }
  );
  const url = res.data.trim();
  if (!url.startsWith('http')) throw new Error('Ошибка загрузки изображения: ' + url);
  return url;
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
async function callAI(messages, opts = {}) {
  const { timeout = 45000, maxAttempts = 3 } = opts;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await axios.post(
        `${KIE_BASE}/gemini-3.1-pro/v1/chat/completions`,
        { stream: false, messages },
        { headers: kieHeaders(), timeout }
      );
      const raw = (res.data?.choices?.[0]?.message?.content || '').trim();
      if (raw) {
        if (attempt > 1) console.log(`[callAI] Gemini ok on attempt ${attempt}`);
        return raw;
      }
      console.warn(`[callAI] Gemini empty response, attempt ${attempt}/${maxAttempts}`);
    } catch (e) {
      console.warn(`[callAI] Gemini error attempt ${attempt}/${maxAttempts}: ${e.message}`);
    }
  }

  // Fallback 1: GPT-5.2
  console.warn('[callAI] Gemini exhausted, falling back to GPT-5.2…');
  try {
    const gptRes = await axios.post(
      `${KIE_BASE}/gpt-5-2/v1/chat/completions`,
      { messages },
      { headers: kieHeaders(), timeout }
    );
    const raw = (gptRes.data?.choices?.[0]?.message?.content || '').trim();
    if (raw) { console.log('[callAI] GPT-5.2 fallback ok'); return raw; }
    console.warn('[callAI] GPT-5.2 returned empty');
  } catch (e) {
    console.error('[callAI] GPT-5.2 error:', e.message);
  }

  // Fallback 2: Gemini Flash (native generateContent format)
  console.warn('[callAI] GPT-5.2 failed, falling back to Gemini Flash…');
  try {
    // Convert OpenAI messages to Gemini native format (text-only)
    const geminiContents = messages
      .filter(m => m.role !== 'system')
      .map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: typeof m.content === 'string' ? m.content : (m.content?.[0]?.text || '') }],
      }));
    // Prepend system message as first user turn if present
    const sysMsg = messages.find(m => m.role === 'system');
    if (sysMsg) {
      geminiContents.unshift({ role: 'user', parts: [{ text: sysMsg.content }] });
    }
    const flashRes = await axios.post(
      `${KIE_BASE}/gemini/v1/models/gemini-3-flash-v1beta:generateContent`,
      { stream: false, contents: geminiContents },
      { headers: kieHeaders(), timeout }
    );
    const raw = (flashRes.data?.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
    if (raw) { console.log('[callAI] Gemini Flash fallback ok'); return raw; }
    console.warn('[callAI] Gemini Flash returned empty');
  } catch (e) {
    console.error('[callAI] Gemini Flash error:', e.message);
  }

  throw new Error('Gemini и GPT-5.2 вернули пустой ответ');
}

module.exports = {
  kieHeaders, analyzeWithGemini, analyzeRealismMarkers, translateToEnglish, buildPrompt, callAI, callAIBase64,
  uploadToPublicHost, downloadImage, compressBelow9MB,
  createNanoBananaTask, createNanoBananaProTask, createNanoBananaProTaskMulti, createQwen2Task,
  createSeedream5LiteTask, resolveTask,
  createNanoBananaProTextTask, createQwen2TextTask, createSeedream5LiteTextTask,
  createThumbnail, generateMissingThumbs,
};
