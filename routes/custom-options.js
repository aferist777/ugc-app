'use strict';

const express = require('express');
const fs      = require('fs');
const path    = require('path');
const router  = express.Router();

const { kieHeaders, uploadToPublicHost, callAI } = require('../lib/helpers');

const DATA_FILE  = path.join(__dirname, '..', 'data', 'custom-options.json');
const IMAGES_DIR = path.join(__dirname, '..', 'data', 'cop-images');
const ALLOWED    = ['pose', 'emotion', 'char-type', 'age', 'gender'];

if (!fs.existsSync(IMAGES_DIR)) fs.mkdirSync(IMAGES_DIR, { recursive: true });

// Dropdowns that support full JSON analysis (name + prompt)
const ANALYZE_JSON_DROPDOWNS = new Set(['pose', 'emotion', 'char-type']);

// Gemini meta-prompts — return JSON {name, prompt}. Dry, factual, no fluff.
const ANALYZE_PROMPTS = {
  pose:
    `Analyze the POSE of the person in this image.\n` +
    `Return ONLY valid JSON, no markdown fences, no preamble:\n` +
    `{"name":"[Russian pose label, max 4 words]","prompt":"[English generation prompt, 150-200 chars, must start with \\"A realistic medium shot of a {gender} aged {age}\\", then: exact body position, camera angle, arm placement, shot type, one-sentence lighting+background. Physical facts only — no emotional descriptors, no fluff.]"}\n`,

  emotion:
    `Analyze the FACIAL EXPRESSION of the person in this image.\n` +
    `Return ONLY valid JSON, no markdown fences, no preamble:\n` +
    `{"name":"[Russian emotion label, max 3 words]","prompt":"[English expression modifier, 80-110 chars: describe muscle states only — eye shape/openness, brow position, mouth shape/tension, cheek state. No subjective mood words. Physical descriptors only.]"}\n`,

  'char-type':
    `Analyze the CHARACTER TYPE / VISUAL ARCHETYPE visible in this image.\n` +
    `Return ONLY valid JSON, no markdown fences, no preamble:\n` +
    `{"name":"[Russian archetype label, max 4 words]","prompt":"[English prompt, 150 chars, must start with \\"A realistic photo of a {gender} aged {age}\\", then: clothing style keywords, aesthetic category, visual vibe. Factual style descriptors only — no personality or emotion words.]"}\n`,

  age:
    `Estimate the apparent age range of the person in this image.\n` +
    `Return ONLY a short age range string, e.g. "25-35" or "40-50" — nothing else.`,

  gender:
    `Identify the apparent gender of the person in this image.\n` +
    `Return ONLY one word: "male" or "female" — nothing else.`,
};

function load() {
  try {
    if (!fs.existsSync(DATA_FILE)) return {};
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch { return {}; }
}

function save(data) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// POST /api/custom-options/analyze-image  { imageBase64, dropdown }
router.post('/custom-options/analyze-image', async (req, res) => {
  const { imageBase64, dropdown } = req.body;
  if (!imageBase64) return res.status(400).json({ success: false, error: 'Нет изображения' });
  if (!ALLOWED.includes(dropdown)) return res.status(400).json({ success: false, error: 'Unknown dropdown' });

  const analyzePrompt = ANALYZE_PROMPTS[dropdown];
  try {
    const imageBuffer = Buffer.from(imageBase64, 'base64');
    const imageUrl    = await uploadToPublicHost(imageBuffer);

    const messages = [{
      role: 'user',
      content: [
        { type: 'text',      text: analyzePrompt },
        { type: 'image_url', image_url: { url: imageUrl } },
      ],
    }];
    const raw = await callAI(messages, { timeout: 45000 });

    if (ANALYZE_JSON_DROPDOWNS.has(dropdown)) {
      // Parse JSON response {name, prompt}
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('Gemini не вернул JSON: ' + raw.slice(0, 120));
      let parsed;
      try { parsed = JSON.parse(jsonMatch[0]); } catch { throw new Error('Ошибка парсинга JSON от Gemini'); }
      if (!parsed.name || !parsed.prompt) throw new Error('JSON неполный: ' + raw.slice(0, 120));
      res.json({ success: true, name: parsed.name.trim(), prompt: parsed.prompt.trim() });
    } else {
      // Legacy plain-text response (age, gender)
      res.json({ success: true, result: raw });
    }
  } catch (err) {
    console.error('[custom-options/analyze-image]', err.response?.data || err.message);
    res.status(502).json({ success: false, error: err.response?.data?.msg || err.message });
  }
});

// GET /api/custom-options
router.get('/custom-options', (_req, res) => {
  res.json({ success: true, options: load() });
});

// POST /api/custom-options/:dropdown  { name, prompt, imageRef? }
// imageRef = base64-encoded image (data URL or raw base64)
router.post('/custom-options/:dropdown', (req, res) => {
  const { dropdown } = req.params;
  if (!ALLOWED.includes(dropdown))
    return res.status(400).json({ success: false, error: 'Unknown dropdown: ' + dropdown });
  const { name, prompt, imageRef } = req.body;
  if (!name?.trim())
    return res.status(400).json({ success: false, error: 'Name is required' });

  const data = load();
  if (!data[dropdown]) data[dropdown] = [];
  const id   = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const item = { id, name: name.trim(), prompt: (prompt || '').trim(), createdAt: new Date().toISOString() };

  // Save image to file if provided
  if (imageRef) {
    try {
      const b64 = imageRef.includes(',') ? imageRef.split(',')[1] : imageRef;
      const imgPath = path.join(IMAGES_DIR, `${id}.jpg`);
      fs.writeFileSync(imgPath, Buffer.from(b64, 'base64'));
      item.imageId = id;
    } catch (e) { console.warn('[custom-options] image save failed:', e.message); }
  }

  data[dropdown].push(item);
  save(data);
  res.json({ success: true, item });
});

// GET /api/custom-options/image/:id — serve stored thumbnail
router.get('/custom-options/image/:id', (req, res) => {
  const imgPath = path.join(IMAGES_DIR, `${req.params.id}.jpg`);
  if (!fs.existsSync(imgPath)) return res.status(404).end();
  res.setHeader('Content-Type', 'image/jpeg');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.sendFile(imgPath);
});

// DELETE /api/custom-options/:dropdown/:id
router.delete('/custom-options/:dropdown/:id', (req, res) => {
  const { dropdown, id } = req.params;
  const data = load();
  if (data[dropdown]) data[dropdown] = data[dropdown].filter(o => o.id !== id);
  save(data);
  res.json({ success: true });
});

module.exports = router;
