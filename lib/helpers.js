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

// ── Auth header ───────────────────────────────────────────────────────────────
function kieHeaders() {
  return {
    Authorization: `Bearer ${process.env.KIE_AI_API_KEY}`,
    'Content-Type': 'application/json',
  };
}

// ── Gemini: skin analysis ─────────────────────────────────────────────────────
async function analyzeWithGemini(faceBase64) {
  const prompt =
    `You are a skin analysis assistant. Look at this face photo carefully. ` +
    `From the list below, identify which skin characteristics are visible or likely present on this person. ` +
    `Return ONLY a comma-separated list of applicable terms from the list, nothing else. ` +
    `List: ${SKIN_PARAMS.join(', ')}.`;

  const res = await axios.post(
    `${KIE_BASE}/gemini/v1/models/gemini-3-flash-v1beta:generateContent`,
    {
      stream: false,
      contents: [{ role: 'user', parts: [
        { text: prompt },
        { inline_data: { mime_type: 'image/jpeg', data: faceBase64 } },
      ]}],
    },
    { headers: kieHeaders(), timeout: 30000 }
  );

  const text = res.data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  return text.split(',').map(s => s.trim().toLowerCase()).filter(s => SKIN_PARAMS.includes(s));
}

// ── Gemini: translate to English ──────────────────────────────────────────────
async function translateToEnglish(text) {
  const res = await axios.post(
    `${KIE_BASE}/gemini/v1/models/gemini-3-flash-v1beta:generateContent`,
    {
      stream: false,
      contents: [{ role: 'user', parts: [
        { text: `Translate the following text to English. Return only the translated text, nothing else:\n\n${text}` },
      ]}],
    },
    { headers: kieHeaders(), timeout: 15000 }
  );
  return res.data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || text;
}

// ── Build Qwen2 prompt ────────────────────────────────────────────────────────
// sceneTemplate: optional pose prompt string with {gender} and {age} placeholders.
// emotionModifier: optional English facial expression description to append.
// If omitted, falls back to the default desk scene.
function buildPrompt(age, gender, skinTraits, extraInstruction, sceneTemplate, emotionModifier) {
  const genderWord = gender === 'male' ? 'man' : 'woman';
  const skinDetails = skinTraits.length > 0 ? `Skin realism: ${skinTraits.join(', ')}. ` : '';
  const suffix = skinDetails + `${NO_RETOUCH.join(', ')}. High quality, 4k resolution, cinematic look, shot on iPhone 15 Pro.`;
  const emotionClause = emotionModifier ? ` Expression: ${emotionModifier}` : '';

  let sceneBase;
  if (sceneTemplate) {
    sceneBase = sceneTemplate
      .replace(/\{gender\}/g, genderWord)
      .replace(/\{age\}/g, age)
      + emotionClause + ' ' + suffix;
  } else {
    sceneBase =
      `A realistic medium shot of a ${genderWord} aged ${age} sitting at a desk, ` +
      `looking directly into the camera lens with a natural friendly expression. ` +
      `Professional soft studio lighting, blurred home office background with a bookshelf and a plant. ` +
      emotionClause + ' ' + suffix;
  }

  if (extraInstruction) {
    return (
      `Apply the following changes to this image: ${extraInstruction}. ` +
      `Keep the same person, face, and background environment exactly as they are — do not change the background. ` +
      `Only modify what is explicitly requested.`
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

// ── Create nano-banana-pro task (2K, scene generation) ───────────────────────
async function createNanoBananaProTask(prompt, imageUrl, aspectRatio, params = {}) {
  const input = {
    prompt, image_input: [imageUrl], aspect_ratio: aspectRatio,
    resolution:    params.resolution    || '2K',
    output_format: params.output_format || 'jpg',
  };
  const res = await axios.post(
    `${KIE_BASE}/api/v1/jobs/createTask`,
    { model: 'nano-banana-pro', input },
    { headers: kieHeaders(), timeout: 30000 }
  );
  const taskId = res.data?.data?.taskId;
  if (!taskId) throw new Error('kie.ai не вернул taskId: ' + JSON.stringify(res.data));
  return taskId;
}

// ── Create nano-banana-pro task with multiple reference images ────────────────
async function createNanoBananaProTaskMulti(prompt, imageUrls, aspectRatio, seed, params = {}) {
  const input = {
    prompt, image_input: imageUrls, aspect_ratio: aspectRatio,
    resolution:    params.resolution    || '2K',
    output_format: params.output_format || 'jpg',
  };
  if (seed) input.seed = seed;
  const res = await axios.post(
    `${KIE_BASE}/api/v1/jobs/createTask`,
    { model: 'nano-banana-pro', input },
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

// ── Text-to-image: nano-banana-pro (no reference image) ──────────────────────
async function createNanoBananaProTextTask(prompt, aspectRatio, params = {}) {
  const input = {
    prompt, aspect_ratio: aspectRatio || '9:16',
    resolution:    params.resolution    || '2K',
    output_format: params.output_format || 'jpg',
  };
  const res = await axios.post(
    `${KIE_BASE}/api/v1/jobs/createTask`,
    { model: 'nano-banana-pro', input },
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
    let resultUrls = [];
    try { resultUrls = JSON.parse(data.resultJson).resultUrls || []; } catch {}
    const remoteUrl = resultUrls[0];
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

module.exports = {
  kieHeaders, analyzeWithGemini, translateToEnglish, buildPrompt,
  uploadToPublicHost, downloadImage, compressBelow9MB,
  createNanoBananaTask, createNanoBananaProTask, createNanoBananaProTaskMulti, createQwen2Task,
  createSeedream5LiteTask, resolveTask,
  createNanoBananaProTextTask, createQwen2TextTask, createSeedream5LiteTextTask,
  createThumbnail, generateMissingThumbs,
};
