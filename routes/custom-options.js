'use strict';

const express = require('express');
const fs      = require('fs');
const path    = require('path');
const axios   = require('axios');
const router  = express.Router();

const { KIE_BASE } = require('../lib/config');
const { kieHeaders, uploadToPublicHost } = require('../lib/helpers');

const DATA_FILE = path.join(__dirname, '..', 'data', 'custom-options.json');
const ALLOWED   = ['pose', 'emotion', 'char-type', 'age', 'gender'];

// Gemini meta-prompts for image analysis per dropdown type
const ANALYZE_PROMPTS = {
  pose:
    `You are an AI image generation prompt engineer.\n` +
    `Analyze the POSE of the person in this image carefully.\n` +
    `Write a concise English generation prompt (~150-200 characters) that describes:\n` +
    `- Body position and angle relative to the camera\n` +
    `- Head direction and tilt\n` +
    `- Arm and hand placement\n` +
    `- Shot type (medium shot, close-up, etc.) and camera angle (eye level, slightly below, etc.)\n` +
    `- Lighting style and background mood (1 sentence)\n` +
    `The prompt must start with: "A realistic medium shot of a {gender} aged {age}"\n` +
    `Return ONLY the prompt text — no JSON, no labels, no preamble.`,

  emotion:
    `You are an AI image generation prompt engineer.\n` +
    `Analyze the FACIAL EXPRESSION and EMOTION of the person in this image.\n` +
    `Write a concise English expression modifier (~80-120 characters) describing:\n` +
    `- The exact emotional state\n` +
    `- Specific facial muscle details (eyes, mouth, brows)\n` +
    `- Overall impression/mood\n` +
    `Return ONLY the modifier text — no JSON, no labels, no preamble.`,

  'char-type':
    `You are an AI image generation prompt engineer.\n` +
    `Analyze the CHARACTER TYPE visible in this image (style, vibe, archetype).\n` +
    `Write a concise English generation prompt (~150 characters) for recreating this character type.\n` +
    `The prompt should start with: "A realistic photo of a {gender} aged {age}"\n` +
    `Include: visual style, aesthetic, clothing vibe, setting impression.\n` +
    `Return ONLY the prompt text — no JSON, no labels, no preamble.`,

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

    const gemRes = await axios.post(
      `${KIE_BASE}/gemini-3.1-pro/v1/chat/completions`,
      {
        stream: false,
        messages: [{
          role: 'user',
          content: [
            { type: 'text',      text: analyzePrompt },
            { type: 'image_url', image_url: { url: imageUrl } },
          ],
        }],
      },
      { headers: kieHeaders(), timeout: 45000 }
    );
    const result = (gemRes.data?.choices?.[0]?.message?.content || '').trim();
    if (!result) throw new Error('Gemini вернул пустой ответ');
    res.json({ success: true, result });
  } catch (err) {
    console.error('[custom-options/analyze-image]', err.response?.data || err.message);
    res.status(502).json({ success: false, error: err.response?.data?.msg || err.message });
  }
});

// GET /api/custom-options
router.get('/custom-options', (_req, res) => {
  res.json({ success: true, options: load() });
});

// POST /api/custom-options/:dropdown  { name, prompt }
router.post('/custom-options/:dropdown', (req, res) => {
  const { dropdown } = req.params;
  if (!ALLOWED.includes(dropdown))
    return res.status(400).json({ success: false, error: 'Unknown dropdown: ' + dropdown });
  const { name, prompt } = req.body;
  if (!name?.trim())
    return res.status(400).json({ success: false, error: 'Name is required' });

  const data = load();
  if (!data[dropdown]) data[dropdown] = [];
  const id   = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const item = { id, name: name.trim(), prompt: (prompt || '').trim(), createdAt: new Date().toISOString() };
  data[dropdown].push(item);
  save(data);
  res.json({ success: true, item });
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
