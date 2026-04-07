require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');

const app = express();
const PORT = process.env.PORT || 3000;

const UPLOADS_DIR      = path.join(__dirname, 'uploads');
const LOOKBOOKS_DIR    = path.join(__dirname, 'lookbooks');
const CHARACTERS_DIR   = path.join(__dirname, 'characters');
const ENVIRONMENTS_DIR = path.join(__dirname, 'environments');
const ARCHIVE_DIR      = path.join(__dirname, 'archive');
const SCENARIOS_DIR    = path.join(__dirname, 'scenarios');
const DETAILS_DIR      = path.join(__dirname, 'details');
const ARCHIVE_SUBDIRS  = ['character', 'lookbook', 'environment'];

for (const d of [UPLOADS_DIR, LOOKBOOKS_DIR, CHARACTERS_DIR, ENVIRONMENTS_DIR, ARCHIVE_DIR, SCENARIOS_DIR, DETAILS_DIR]) {
  if (!fs.existsSync(d)) fs.mkdirSync(d);
}
for (const sub of ARCHIVE_SUBDIRS) {
  const p = path.join(ARCHIVE_DIR, sub);
  if (!fs.existsSync(p)) fs.mkdirSync(p);
}

// ─── Middleware ────────────────────────────────────────────────────────────────
app.use(express.json({ limit: '15mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads',      express.static(UPLOADS_DIR));
app.use('/lookbooks',    express.static(LOOKBOOKS_DIR));
app.use('/characters',   express.static(CHARACTERS_DIR));
app.use('/environments', express.static(ENVIRONMENTS_DIR));
app.use('/archive',      express.static(ARCHIVE_DIR));
app.use('/details',      express.static(DETAILS_DIR));

// ─── Constants ────────────────────────────────────────────────────────────────
const KIE_BASE = 'https://api.kie.ai';

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

// ─── Helpers ──────────────────────────────────────────────────────────────────
function kieHeaders() {
  return {
    Authorization: `Bearer ${process.env.KIE_AI_API_KEY}`,
    'Content-Type': 'application/json',
  };
}

// Step 1: ask Gemini to analyze the face and pick applicable skin traits
async function analyzeWithGemini(faceBase64) {
  const prompt =
    `You are a skin analysis assistant. Look at this face photo carefully. ` +
    `From the list below, identify which skin characteristics are visible or likely present on this person. ` +
    `Return ONLY a comma-separated list of applicable terms from the list, nothing else. ` +
    `List: ${SKIN_PARAMS.join(', ')}.`;

  const body = {
    stream: false,
    contents: [
      {
        role: 'user',
        parts: [
          { text: prompt },
          { inline_data: { mime_type: 'image/jpeg', data: faceBase64 } },
        ],
      },
    ],
  };

  const res = await axios.post(
    `${KIE_BASE}/gemini/v1/models/gemini-3-flash-v1beta:generateContent`,
    body,
    { headers: kieHeaders(), timeout: 30000 }
  );

  const text = res.data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  console.log('[gemini] skin analysis:', text);

  // Filter to only known params so we don't inject garbage
  const found = text
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(s => SKIN_PARAMS.includes(s));

  return found;
}

async function translateToEnglish(text) {
  const body = {
    stream: false,
    contents: [
      {
        role: 'user',
        parts: [
          { text: `Translate the following text to English. Return only the translated text, nothing else:\n\n${text}` },
        ],
      },
    ],
  };
  const res = await axios.post(
    `${KIE_BASE}/gemini/v1/models/gemini-3-flash-v1beta:generateContent`,
    body,
    { headers: kieHeaders(), timeout: 15000 }
  );
  return res.data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || text;
}

// Step 2: build the Qwen2 prompt
function buildPrompt(age, gender, skinTraits, extraInstruction) {
  const genderWord = gender === 'male' ? 'man' : 'woman';

  const skinDetails = skinTraits.length > 0
    ? `Skin realism: ${skinTraits.join(', ')}. `
    : '';

  const sceneBase =
    `A realistic medium shot of a ${genderWord} aged ${age} sitting at a desk, ` +
    `looking directly into the camera lens with a natural friendly expression. ` +
    `Professional soft studio lighting, blurred home office background with a bookshelf and a plant. ` +
    skinDetails +
    `${NO_RETOUCH.join(', ')}. ` +
    `High quality, 4k resolution, cinematic look, shot on iPhone 15 Pro.`;

  if (extraInstruction) {
    return (
      `Apply the following changes to this image: ${extraInstruction}. ` +
      `Keep the same person, face, and background environment exactly as they are — do not change the background. ` +
      `Only modify what is explicitly requested.`
    );
  }

  return `Use the face and identity from this reference image. Place this person in the following scene: ` + sceneBase;
}

// Upload image buffer to litterbox.catbox.moe — returns a public URL valid for 1h
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

async function downloadImage(url, destPath) {
  const response = await axios({ method: 'GET', url, responseType: 'stream', timeout: 60000 });
  return new Promise((resolve, reject) => {
    const writer = fs.createWriteStream(destPath);
    response.data.pipe(writer);
    writer.on('finish', resolve);
    writer.on('error', reject);
  });
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// Proxy: random face from thispersondoesnotexist.com
app.get('/api/random-face', async (_req, res) => {
  try {
    const response = await axios({
      method: 'GET',
      url: 'https://thispersondoesnotexist.com/',
      responseType: 'arraybuffer',
      timeout: 15000,
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    res.set('Content-Type', response.headers['content-type'] || 'image/jpeg');
    res.set('Cache-Control', 'no-store');
    res.send(response.data);
  } catch (err) {
    res.status(502).json({ success: false, error: err.message });
  }
});

// Generate character
// Body: { age, gender, faceBase64 }  — new generation
//       { age, gender, imagePath, extraInstruction } — refine existing
app.post('/api/generate', async (req, res) => {
  const { age, gender, faceBase64, imagePath: localImagePath, extraInstruction } = req.body;

  if (!age || !gender) {
    return res.status(400).json({ success: false, error: 'Укажите возраст и пол' });
  }
  if (!faceBase64 && !localImagePath) {
    return res.status(400).json({ success: false, error: 'Загрузите изображение лица' });
  }

  try {
    let imageBuffer;
    let skinTraits = [];

    if (localImagePath) {
      // Refine mode: read saved image from disk, skip Gemini
      const absPath = path.join(__dirname, localImagePath.replace(/^\//, ''));
      imageBuffer = fs.readFileSync(absPath);
      console.log('[generate] refine mode, image:', absPath);
    } else {
      // New generation: analyze skin with Gemini first
      console.log('[generate] step 1: gemini skin analysis');
      try {
        skinTraits = await analyzeWithGemini(faceBase64);
      } catch (e) {
        console.warn('[generate] gemini failed, continuing:', e.message);
      }
      imageBuffer = Buffer.from(faceBase64, 'base64');
    }

    // Translate extraInstruction to English if provided
    let instruction = extraInstruction;
    if (instruction) {
      try { instruction = await translateToEnglish(instruction); }
      catch (e) { console.warn('[translate] failed, using original:', e.message); }
      console.log('[generate] translated instruction:', instruction);
    }

    // Build prompt
    const prompt = buildPrompt(age, gender, skinTraits, instruction);
    console.log('[generate] prompt:', prompt);

    // Upload image to public host
    console.log('[generate] uploading image to public host');
    const imageUrl = await uploadToPublicHost(imageBuffer);
    console.log('[generate] image URL:', imageUrl);

    // 4. Submit Qwen2 task
    console.log('[generate] step 3: submitting qwen2 task');
    const taskRes = await axios.post(
      `${KIE_BASE}/api/v1/jobs/createTask`,
      {
        model: 'qwen2/image-edit',
        input: {
          prompt,
          image_url: imageUrl,
          image_size: '9:16',
          output_format: 'jpeg',
        },
      },
      { headers: kieHeaders(), timeout: 30000 }
    );

    const taskId = taskRes.data?.data?.taskId;
    if (!taskId) {
      console.error('[generate] no taskId in response:', taskRes.data);
      return res.status(502).json({ success: false, error: 'kie.ai не вернул taskId', detail: taskRes.data });
    }

    console.log('[generate] taskId:', taskId);
    res.json({ success: true, taskId, skinTraits });

  } catch (err) {
    console.error('[generate] error:', err.response?.data || err.message);
    res.status(502).json({
      success: false,
      error: err.response?.data?.msg || err.message,
    });
  }
});

// Poll task status
app.get('/api/status/:taskId', async (req, res) => {
  const { taskId } = req.params;
  try {
    const statusRes = await axios.get(
      `${KIE_BASE}/api/v1/jobs/recordInfo`,
      { params: { taskId }, headers: kieHeaders(), timeout: 15000 }
    );

    const data = statusRes.data?.data;
    const state = data?.state;

    if (state === 'success') {
      let resultUrls = [];
      try { resultUrls = JSON.parse(data.resultJson).resultUrls || []; } catch { }

      const remoteUrl = resultUrls[0];
      if (!remoteUrl) return res.json({ success: true, state: 'failed', error: 'No result URL' });

      const filename = `generated_${taskId}_${Date.now()}.jpg`;
      const destPath = path.join(UPLOADS_DIR, filename);
      await downloadImage(remoteUrl, destPath);

      return res.json({ success: true, state: 'success', imagePath: `/uploads/${filename}` });
    }

    if (state === 'failed') {
      return res.json({ success: true, state: 'failed', error: data?.failMsg || 'Generation failed' });
    }

    return res.json({ success: true, state: state || 'pending' });

  } catch (err) {
    console.error('[status] error:', err.response?.data || err.message);
    res.status(502).json({ success: false, error: err.message });
  }
});

// ─── Lookbook routes ──────────────────────────────────────────────────────────

// Helper: poll task and save result to destDir — returns imagePath
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
    }[destDir] || 'uploads';
    // Idempotent: reuse existing file for this taskId if already downloaded
    const existing = fs.readdirSync(destDir).find(f => f.includes(taskId));
    if (existing) return { state: 'success', imagePath: `/${dirName}/${existing}` };
    const filename = `${prefix}_${taskId}_${Date.now()}.jpg`;
    await downloadImage(remoteUrl, path.join(destDir, filename));
    return { state: 'success', imagePath: `/${dirName}/${filename}` };
  }
  if (state === 'failed') return { state: 'failed', error: data?.failMsg || 'failed' };
  return { state: state || 'pending' };
}

// List all lookbook files (newest first)
app.get('/api/lookbooks', (_req, res) => {
  const files = fs.readdirSync(LOOKBOOKS_DIR)
    .filter(f => /\.(jpg|jpeg|png)$/i.test(f))
    .map(f => ({ name: f, mtime: fs.statSync(path.join(LOOKBOOKS_DIR, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)
    .map(f => `/lookbooks/${f.name}`);
  res.json({ success: true, files });
});

// Обринж prompts
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

async function createNanoBananaTask(prompt, imageUrl, aspectRatio) {
  const res = await axios.post(
    `${KIE_BASE}/api/v1/jobs/createTask`,
    {
      model: 'nano-banana-2',
      input: {
        prompt,
        image_input: [imageUrl],
        aspect_ratio: aspectRatio,
        resolution: '4K',
        output_format: 'jpg',
      },
    },
    { headers: kieHeaders(), timeout: 30000 }
  );
  const taskId = res.data?.data?.taskId;
  if (!taskId) throw new Error('kie.ai не вернул taskId: ' + JSON.stringify(res.data));
  return taskId;
}

// Обринж — parallel: clothing extraction (1:1, 4K) + background extraction (16:9, 4K)
app.post('/api/lookbook/generate', async (req, res) => {
  const { imageBase64 } = req.body;
  if (!imageBase64) return res.status(400).json({ success: false, error: 'Загрузите изображение' });

  try {
    const imageUrl = await uploadToPublicHost(Buffer.from(imageBase64, 'base64'));
    console.log('[obrinj] image uploaded:', imageUrl);

    // Run both tasks in parallel
    const [clothingTaskId, bgTaskId] = await Promise.all([
      createNanoBananaTask(EXTRACT_CLOTHING_PROMPT, imageUrl, '1:1'),
      createNanoBananaTask(EXTRACT_BG_PROMPT,       imageUrl, '16:9'),
    ]);

    console.log('[obrinj] clothing:', clothingTaskId, '| bg:', bgTaskId);
    res.json({ success: true, clothingTaskId, bgTaskId });
  } catch (err) {
    console.error('[obrinj] error:', err.response?.data || err.message);
    res.status(502).json({ success: false, error: err.response?.data?.msg || err.message });
  }
});

// Poll clothing task → saves to lookbooks/
app.get('/api/lookbook/status/:taskId', async (req, res) => {
  try {
    const result = await resolveTask(req.params.taskId, LOOKBOOKS_DIR, 'lookbook');
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(502).json({ success: false, error: err.message });
  }
});

// Poll background task → saves to environments/
app.get('/api/environment/status/:taskId', async (req, res) => {
  try {
    const result = await resolveTask(req.params.taskId, ENVIRONMENTS_DIR, 'env');
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(502).json({ success: false, error: err.message });
  }
});

// List environments for thumbs
app.get('/api/environments', (_req, res) => {
  const files = fs.readdirSync(ENVIRONMENTS_DIR)
    .filter(f => /\.(jpg|jpeg|png)$/i.test(f))
    .map(f => ({ file: f, mtime: fs.statSync(path.join(ENVIRONMENTS_DIR, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)
    .map(({ file }) => `/environments/${file}`);
  res.json({ success: true, files });
});

// Apply lookbook outfit to character — Body: { characterBase64, lookbookPath }
const APPLY_LOOKBOOK_PROMPT =
  `Dress the person from the first reference image in the exact outfit shown in the second reference image. ` +
  `Preserve the person's face, skin tone, hair, and body proportions exactly as in the first image. ` +
  `Replace all clothing with every item from the second reference image. ` +
  `Maintain the same pose, background, and lighting from the first image. ` +
  `Photorealistic, high quality, 4k.`;

app.post('/api/apply-lookbook', async (req, res) => {
  const { characterBase64, lookbookPath } = req.body;
  if (!characterBase64 || !lookbookPath) {
    return res.status(400).json({ success: false, error: 'Нужны изображение персонажа и лукбук' });
  }

  const lbAbs = path.join(__dirname, lookbookPath.replace(/^\//, ''));
  if (!fs.existsSync(lbAbs)) {
    return res.status(400).json({ success: false, error: 'Файл лукбука не найден' });
  }

  try {
    const [charUrl, lbUrl] = await Promise.all([
      uploadToPublicHost(Buffer.from(characterBase64, 'base64')),
      uploadToPublicHost(fs.readFileSync(lbAbs)),
    ]);
    console.log('[apply-lb] char:', charUrl, '| lb:', lbUrl);

    const taskRes = await axios.post(
      `${KIE_BASE}/api/v1/jobs/createTask`,
      {
        model: 'nano-banana-2',
        input: {
          prompt: APPLY_LOOKBOOK_PROMPT,
          image_input: [charUrl, lbUrl],
          aspect_ratio: '9:16',
          resolution: '1K',
          output_format: 'jpg',
        },
      },
      { headers: kieHeaders(), timeout: 30000 }
    );

    const taskId = taskRes.data?.data?.taskId;
    if (!taskId) {
      console.error('[apply-lb] no taskId:', taskRes.data);
      return res.status(502).json({ success: false, error: 'kie.ai не вернул taskId', detail: taskRes.data });
    }
    console.log('[apply-lb] taskId:', taskId);
    res.json({ success: true, taskId });
  } catch (err) {
    console.error('[apply-lb] error:', err.response?.data || err.message);
    res.status(502).json({ success: false, error: err.response?.data?.msg || err.message });
  }
});

// Apply environment to character via nano-banana-2
app.post('/api/apply-environment', async (req, res) => {
  const { characterBase64, environmentPath } = req.body;
  if (!characterBase64 || !environmentPath)
    return res.status(400).json({ success: false, error: 'Нужны изображение персонажа и окружение' });

  const envAbs = path.join(__dirname, environmentPath.replace(/^\//, ''));
  if (!fs.existsSync(envAbs))
    return res.status(400).json({ success: false, error: 'Файл окружения не найден' });

  try {
    const [charUrl, envUrl] = await Promise.all([
      uploadToPublicHost(Buffer.from(characterBase64, 'base64')),
      uploadToPublicHost(fs.readFileSync(envAbs)),
    ]);

    const taskRes = await axios.post(
      `${KIE_BASE}/api/v1/jobs/createTask`,
      {
        model: 'nano-banana-2',
        input: {
          prompt:
            `Place the person from the first image into the environment shown in the second image. ` +
            `Keep the person's appearance, clothing, and pose identical. ` +
            `Blend the lighting and shadows naturally so the person looks like they belong in that environment. ` +
            `No other people, no text, no watermarks. Photorealistic, 9:16 portrait format.`,
          image_input: [charUrl, envUrl],
          aspect_ratio: '9:16',
          resolution: '4K',
          output_format: 'jpg',
        },
      },
      { headers: kieHeaders(), timeout: 30000 }
    );

    const taskId = taskRes.data?.data?.taskId;
    if (!taskId) return res.status(502).json({ success: false, error: 'kie.ai не вернул taskId' });
    res.json({ success: true, taskId });
  } catch (err) {
    res.status(502).json({ success: false, error: err.response?.data?.msg || err.message });
  }
});

app.get('/api/apply-environment/status/:taskId', async (req, res) => {
  try {
    const result = await resolveTask(req.params.taskId, UPLOADS_DIR, 'env_applied');
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(502).json({ success: false, error: err.message });
  }
});

// Poll apply-lookbook status — saves result to uploads/
app.get('/api/apply-lookbook/status/:taskId', async (req, res) => {
  try {
    const result = await resolveTask(req.params.taskId, UPLOADS_DIR, 'applied');
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('[apply-lb status] error:', err.response?.data || err.message);
    res.status(502).json({ success: false, error: err.message });
  }
});

// ─── Characters gallery & save ────────────────────────────────────────────────

// List characters (newest first)
app.get('/api/gallery/characters', (_req, res) => {
  const files = fs.readdirSync(CHARACTERS_DIR)
    .filter(f => /\.(jpg|jpeg|png)$/i.test(f))
    .map(f => ({ file: f, mtime: fs.statSync(path.join(CHARACTERS_DIR, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)
    .map(({ file }) => ({ path: `/characters/${file}`, name: file.replace(/\.[^.]+$/, '') }));
  res.json({ success: true, files });
});

// List lookbooks for gallery
app.get('/api/gallery/lookbooks', (_req, res) => {
  const files = fs.readdirSync(LOOKBOOKS_DIR)
    .filter(f => /\.(jpg|jpeg|png)$/i.test(f))
    .map(f => ({ file: f, mtime: fs.statSync(path.join(LOOKBOOKS_DIR, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)
    .map(({ file }) => ({ path: `/lookbooks/${file}`, name: file.replace(/\.[^.]+$/, '') }));
  res.json({ success: true, files });
});

app.get('/api/gallery/environments', (_req, res) => {
  const files = fs.readdirSync(ENVIRONMENTS_DIR)
    .filter(f => /\.(jpg|jpeg|png)$/i.test(f))
    .map(f => ({ file: f, mtime: fs.statSync(path.join(ENVIRONMENTS_DIR, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)
    .map(({ file }) => ({ path: `/environments/${file}`, name: file.replace(/\.[^.]+$/, '') }));
  res.json({ success: true, files });
});

// List archive files by subfolder
app.get('/api/archive/:subfolder', (req, res) => {
  const { subfolder } = req.params;
  if (!ARCHIVE_SUBDIRS.includes(subfolder)) {
    return res.status(400).json({ success: false, error: 'Unknown subfolder' });
  }
  const dir   = path.join(ARCHIVE_DIR, subfolder);
  const files = fs.readdirSync(dir)
    .filter(f => /\.(jpg|jpeg|png)$/i.test(f))
    .map(f => ({ file: f, mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)
    .map(({ file }) => ({ path: `/archive/${subfolder}/${file}`, name: file.replace(/\.[^.]+$/, '') }));
  res.json({ success: true, files });
});

// Save character — analyzes race/gender with Gemini, renames, copies to characters/
app.post('/api/save-character', async (req, res) => {
  const { imagePath, characterName } = req.body;
  if (!imagePath) return res.status(400).json({ success: false, error: 'Нет пути к изображению' });

  const absPath = path.join(__dirname, imagePath.replace(/^\//, ''));
  if (!fs.existsSync(absPath)) return res.status(400).json({ success: false, error: 'Файл не найден' });

  let race = 'other', gender = 'unknown';
  try {
    const imageBase64 = fs.readFileSync(absPath).toString('base64');
    const prompt =
      `Analyze this person's appearance. Return ONLY a raw JSON object, no markdown, no explanation: ` +
      `{"race":"caucasian|black|asian|hispanic|middle_eastern|south_asian|other","gender":"male|female"}`;

    const gemRes = await axios.post(
      `${KIE_BASE}/gemini/v1/models/gemini-3-flash-v1beta:generateContent`,
      {
        stream: false,
        contents: [{
          role: 'user',
          parts: [
            { text: prompt },
            { inline_data: { mime_type: 'image/jpeg', data: imageBase64 } },
          ],
        }],
      },
      { headers: kieHeaders(), timeout: 30000 }
    );

    const text  = gemRes.data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const match = text.match(/\{[^}]+\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      race   = parsed.race   || 'other';
      gender = parsed.gender || 'unknown';
    }
    console.log('[save-char] gemini →', race, gender);
  } catch (e) {
    console.warn('[save-char] gemini failed:', e.message);
  }

  // Random 10-char suffix (a-z + 0-9)
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const suffix   = Array.from({ length: 10 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');

  const safeName = (characterName || 'character').replace(/\s+/g, '_').replace(/[^a-zA-Zа-яА-ЯёЁ0-9_]/g, '');
  const filename = `${safeName}_${race}_${gender}-${suffix}.jpg`;
  const destPath = path.join(CHARACTERS_DIR, filename);

  fs.copyFileSync(absPath, destPath);
  console.log('[save-char] saved:', filename);

  res.json({ success: true, filename, savedPath: `/characters/${filename}` });
});

// ─── Details ─────────────────────────────────────────────────────────────────

app.post('/api/details/upload', (req, res) => {
  const { imageBase64, name } = req.body;
  if (!imageBase64) return res.status(400).json({ success: false, error: 'Нет данных' });
  const buf = Buffer.from(imageBase64, 'base64');
  const safeName = (name || '').trim().replace(/[^a-zA-Zа-яА-ЯёЁ0-9_\- ]/g, '').trim();
  const finalName = safeName || `detail_${Date.now()}`;
  const filename = `${finalName}.jpg`;
  fs.writeFileSync(path.join(DETAILS_DIR, filename), buf);
  res.json({ success: true, filename, name: finalName });
});

app.get('/api/details', (_req, res) => {
  const files = fs.readdirSync(DETAILS_DIR)
    .filter(f => /\.(jpg|jpeg|png)$/i.test(f))
    .map(f => ({ file: f, name: f.replace(/\.[^.]+$/, ''), path: `/details/${f}`, mtime: fs.statSync(path.join(DETAILS_DIR, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  res.json({ success: true, files });
});

// ─── Gallery archive / restore ───────────────────────────────────────────────

const GALLERY_MAP = {
  'characters':   { dir: CHARACTERS_DIR,   archiveSub: 'character' },
  'lookbooks':    { dir: LOOKBOOKS_DIR,    archiveSub: 'lookbook' },
  'environments': { dir: ENVIRONMENTS_DIR, archiveSub: 'environment' },
};

app.post('/api/gallery/archive', (req, res) => {
  const { filePath } = req.body; // e.g. /characters/foo.jpg
  if (!filePath) return res.status(400).json({ success: false, error: 'Нет пути' });
  const parts = filePath.replace(/^\//, '').split('/');
  const folder = parts[0], filename = parts[1];
  const map = GALLERY_MAP[folder];
  if (!map || !filename) return res.status(400).json({ success: false, error: 'Неверный путь' });
  const src  = path.join(map.dir, filename);
  const dest = path.join(ARCHIVE_DIR, map.archiveSub, filename);
  if (!fs.existsSync(src)) return res.status(404).json({ success: false, error: 'Файл не найден' });
  fs.renameSync(src, dest);
  res.json({ success: true });
});

app.delete('/api/archive/delete', (req, res) => {
  const { filePath } = req.body;
  if (!filePath) return res.status(400).json({ success: false, error: 'Нет пути' });
  const parts = filePath.replace(/^\//, '').split('/');
  if (parts[0] !== 'archive' || parts.length !== 3)
    return res.status(400).json({ success: false, error: 'Неверный путь' });
  const absPath = path.join(ARCHIVE_DIR, parts[1], parts[2]);
  if (!fs.existsSync(absPath)) return res.status(404).json({ success: false, error: 'Файл не найден' });
  fs.unlinkSync(absPath);
  res.json({ success: true });
});

app.post('/api/gallery/restore', (req, res) => {
  const { filePath } = req.body; // e.g. /archive/character/foo.jpg
  if (!filePath) return res.status(400).json({ success: false, error: 'Нет пути' });
  const parts = filePath.replace(/^\//, '').split('/');
  // parts: ['archive', 'character', 'foo.jpg']
  const sub = parts[1], filename = parts[2];
  const entry = Object.values(GALLERY_MAP).find(v => v.archiveSub === sub);
  if (!entry || !filename) return res.status(400).json({ success: false, error: 'Неверный путь' });
  const src  = path.join(ARCHIVE_DIR, sub, filename);
  const dest = path.join(entry.dir, filename);
  if (!fs.existsSync(src)) return res.status(404).json({ success: false, error: 'Файл не найден' });
  fs.renameSync(src, dest);
  res.json({ success: true });
});

// ─── Scenarios ───────────────────────────────────────────────────────────────

// Upload scenario .txt
app.post('/api/scenarios/upload', (req, res) => {
  const { textBase64, name } = req.body;
  if (!textBase64) return res.status(400).json({ success: false, error: 'Нет данных' });

  const text = Buffer.from(textBase64, 'base64').toString('utf8');
  const safeName = (name || '').trim().replace(/[^a-zA-Zа-яА-ЯёЁ0-9_\- ]/g, '').trim();
  const finalName = safeName || `Сценарий_${Date.now()}`;
  const filename = `${finalName}.txt`;
  const dest = path.join(SCENARIOS_DIR, filename);
  fs.writeFileSync(dest, text, 'utf8');
  res.json({ success: true, filename, name: finalName });
});

app.delete('/api/scenarios/delete', (req, res) => {
  const { filename } = req.body;
  if (!filename) return res.status(400).json({ success: false, error: 'Нет имени файла' });
  const safe = path.basename(filename);
  if (!safe.endsWith('.txt')) return res.status(400).json({ success: false, error: 'Неверный файл' });
  const fp = path.join(SCENARIOS_DIR, safe);
  if (!fs.existsSync(fp)) return res.status(404).json({ success: false, error: 'Не найден' });
  fs.unlinkSync(fp);
  res.json({ success: true });
});

// ─── Scenario-detail assignments (must be before /:filename) ─────────────────

const SCENARIO_DETAILS_FILE = path.join(SCENARIOS_DIR, '_assignments.json');

function loadAssignments() {
  if (!fs.existsSync(SCENARIO_DETAILS_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(SCENARIO_DETAILS_FILE, 'utf8')); } catch { return {}; }
}

app.get('/api/scenarios/assignments', (_req, res) => {
  res.json({ success: true, assignments: loadAssignments() });
});

app.post('/api/scenarios/assignments', (req, res) => {
  const { assignments } = req.body;
  if (!assignments || typeof assignments !== 'object')
    return res.status(400).json({ success: false, error: 'Неверные данные' });
  fs.writeFileSync(SCENARIO_DETAILS_FILE, JSON.stringify(assignments, null, 2), 'utf8');
  res.json({ success: true });
});

// List scenarios
app.get('/api/scenarios', (_req, res) => {
  const files = fs.readdirSync(SCENARIOS_DIR)
    .filter(f => f.endsWith('.txt') && f !== '_assignments.json')
    .map(f => ({
      file: f,
      name: f.replace(/\.txt$/, ''),
      mtime: fs.statSync(path.join(SCENARIOS_DIR, f)).mtimeMs,
    }))
    .sort((a, b) => b.mtime - a.mtime);
  res.json({ success: true, files });
});

// Get scenario content
app.get('/api/scenarios/:filename', (req, res) => {
  const filename = path.basename(req.params.filename);
  if (!filename.endsWith('.txt')) return res.status(400).json({ success: false, error: 'Неверный файл' });
  const fp = path.join(SCENARIOS_DIR, filename);
  if (!fs.existsSync(fp)) return res.status(404).json({ success: false, error: 'Не найден' });
  const lines = fs.readFileSync(fp, 'utf8').split('\n').filter(l => l.trim());
  res.json({ success: true, lines });
});

// ─── Balance ─────────────────────────────────────────────────────────────────

app.get('/api/balance', async (_req, res) => {
  try {
    const r = await axios.get(`${KIE_BASE}/api/v1/chat/credit`, {
      headers: kieHeaders(), timeout: 10000,
    });
    const credits = r.data?.data ?? 0;
    const dollars = Math.round((credits / 8) * 0.04 * 100) / 100;
    res.json({ success: true, credits, dollars });
  } catch (err) {
    res.status(502).json({ success: false, error: err.message });
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`╔════════════════════════════════════════╗`);
  console.log(`║  UGC Character Generator               ║`);
  console.log(`║  http://localhost:${PORT}                 ║`);
  console.log(`╚════════════════════════════════════════╝`);
});
