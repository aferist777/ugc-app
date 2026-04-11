'use strict';

const express = require('express');
const path    = require('path');
const fs      = require('fs');
const axios   = require('axios');
const router  = express.Router();

const { KIE_BASE, UPLOADS_DIR, CHARACTERS_DIR } = require('../lib/config');
const {
  kieHeaders, analyzeWithGemini, translateToEnglish, buildPrompt,
  uploadToPublicHost, downloadImage, compressBelow9MB, createThumbnail,
} = require('../lib/helpers');
const { getPrompt } = require('../lib/prompts');

// ── Random face proxy ─────────────────────────────────────────────────────────
router.get('/random-face', async (_req, res) => {
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

// ── Generate character ────────────────────────────────────────────────────────
router.post('/generate', async (req, res) => {
  const { age, gender, faceBase64, imagePath: localImagePath, extraInstruction, poseKey } = req.body;

  if (!age || !gender)
    return res.status(400).json({ success: false, error: 'Укажите возраст и пол' });
  if (!faceBase64 && !localImagePath)
    return res.status(400).json({ success: false, error: 'Загрузите изображение лица' });

  try {
    let imageBuffer, imageBase64ForGemini;

    if (faceBase64) {
      imageBuffer = Buffer.from(faceBase64, 'base64');
      imageBase64ForGemini = faceBase64;
    } else {
      const absPath = path.join(__dirname, '..', localImagePath.replace(/^\//, ''));
      imageBuffer = fs.readFileSync(absPath);
      imageBase64ForGemini = imageBuffer.toString('base64');
    }

    let skinTraits = [];
    let translatedInstruction = extraInstruction || '';

    if (extraInstruction) {
      translatedInstruction = await translateToEnglish(extraInstruction);
    } else {
      skinTraits = await analyzeWithGemini(imageBase64ForGemini);
    }

    const sceneTemplate = (poseKey && !extraInstruction) ? getPrompt(poseKey) : null;
    const prompt = buildPrompt(age, gender, skinTraits, translatedInstruction, sceneTemplate);
    const imageUrl = await uploadToPublicHost(imageBuffer);

    const payload = {
      model: 'qwen2/image-edit',
      input: {
        prompt,
        image_url: imageUrl,
        image_size: '9:16',
        output_format: 'jpeg',
      },
    };
    console.log('[generate] payload:', JSON.stringify(payload, null, 2));

    const taskRes = await axios.post(
      `${KIE_BASE}/api/v1/jobs/createTask`,
      payload,
      { headers: kieHeaders(), timeout: 30000 }
    );
    console.log('[generate] kie.ai response:', JSON.stringify(taskRes.data));

    const taskId = taskRes.data?.data?.taskId;
    if (!taskId) {
      console.error('[generate] no taskId. status:', taskRes.status, 'body:', JSON.stringify(taskRes.data));
      return res.status(502).json({ success: false, error: 'kie.ai не вернул taskId', detail: taskRes.data });
    }

    res.json({ success: true, taskId, skinTraits });
  } catch (err) {
    console.error('[generate]', err.response?.data || err.message);
    res.status(502).json({ success: false, error: err.response?.data?.msg || err.message });
  }
});

// ── Poll generation status ────────────────────────────────────────────────────
router.get('/status/:taskId', async (req, res) => {
  const { taskId } = req.params;
  try {
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
      if (!remoteUrl) return res.json({ success: true, state: 'failed', error: 'No result URL' });
      const filename = `generated_${taskId}_${Date.now()}.jpg`;
      const destPath = path.join(UPLOADS_DIR, filename);
      await downloadImage(remoteUrl, destPath);
      await compressBelow9MB(destPath);
      const thumbPath = path.join(UPLOADS_DIR, 'thumbs', filename);
      createThumbnail(destPath, thumbPath).catch(e => console.warn('[thumb]', e.message));
      return res.json({ success: true, state: 'success', imagePath: `/uploads/${filename}` });
    }
    if (state === 'failed')
      return res.json({ success: true, state: 'failed', error: data?.failMsg || 'Generation failed' });

    return res.json({ success: true, state: state || 'pending' });
  } catch (err) {
    console.error('[status]', err.response?.data || err.message);
    res.status(502).json({ success: false, error: err.message });
  }
});

// ── Save character (Gemini analyzes race/gender, renames, copies) ─────────────
router.post('/save-character', async (req, res) => {
  const { imagePath, characterName } = req.body;
  if (!imagePath) return res.status(400).json({ success: false, error: 'Нет пути к изображению' });

  const absPath = path.join(__dirname, '..', imagePath.replace(/^\//, ''));
  if (!fs.existsSync(absPath)) return res.status(400).json({ success: false, error: 'Файл не найден' });

  let race = 'other', gender = 'unknown';
  try {
    const imageBase64 = fs.readFileSync(absPath).toString('base64');
    const gemRes = await axios.post(
      `${KIE_BASE}/gemini/v1/models/gemini-3-flash-v1beta:generateContent`,
      {
        stream: false,
        contents: [{ role: 'user', parts: [
          { text: `Analyze this person's appearance. Return ONLY a raw JSON object, no markdown: {"race":"caucasian|black|asian|hispanic|middle_eastern|south_asian|other","gender":"male|female"}` },
          { inline_data: { mime_type: 'image/jpeg', data: imageBase64 } },
        ]}],
      },
      { headers: kieHeaders(), timeout: 30000 }
    );
    const text  = gemRes.data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const match = text.match(/\{[^}]+\}/);
    if (match) { const p = JSON.parse(match[0]); race = p.race || 'other'; gender = p.gender || 'unknown'; }
  } catch (e) { console.warn('[save-char] gemini failed:', e.message); }

  const suffix   = Array.from({ length: 10 }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)]).join('');
  const safeName = (characterName || 'character').replace(/\s+/g, '_').replace(/[^a-zA-Zа-яА-ЯёЁ0-9_]/g, '');
  const filename = `${safeName}_${race}_${gender}-${suffix}.jpg`;
  const destPath = path.join(CHARACTERS_DIR, filename);
  fs.copyFileSync(absPath, destPath);
  const thumbPath = path.join(CHARACTERS_DIR, 'thumbs', filename);
  createThumbnail(destPath, thumbPath).catch(e => console.warn('[thumb]', e.message));
  res.json({ success: true, filename, savedPath: `/characters/${filename}` });
});

module.exports = router;
