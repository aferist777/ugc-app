'use strict';

const express      = require('express');
const path         = require('path');
const fs           = require('fs');
const { execFile } = require('child_process');
const ffmpegPath   = require('ffmpeg-static');
const router       = express.Router();

// Extract first frame of a video file → save as .jpg, return relative web path
function extractThumb(absVideoPath, baseName) {
  return new Promise(resolve => {
    const thumbName = baseName + '_thumb.jpg';
    const absThumb  = path.join(path.dirname(absVideoPath), thumbName);
    const args = [
      '-ss', '0',
      '-i', absVideoPath,
      '-frames:v', '1',
      '-q:v', '3',
      '-y', absThumb,
    ];
    execFile(ffmpegPath, args, { timeout: 15000 }, err => {
      if (err || !fs.existsSync(absThumb)) { resolve(null); return; }
      resolve('/finals/' + thumbName);
    });
  });
}

const { ROOT_DIR, FINALS_DIR } = require('../lib/config');

const META_FILE = path.join(FINALS_DIR, '_meta.json');

function readMeta() {
  try { return JSON.parse(fs.readFileSync(META_FILE, 'utf8')); } catch { return []; }
}
function writeMeta(list) {
  fs.writeFileSync(META_FILE, JSON.stringify(list, null, 2));
}

// ── GET /api/finals/list ──────────────────────────────────────────────────────
router.get('/finals/list', (req, res) => {
  try {
    const list = readMeta();
    // Filter out entries whose video no longer exists
    const alive = list.filter(item => {
      if (!item.videoFile) return false;
      const absPath = path.join(ROOT_DIR, item.videoFile.replace(/^\//, ''));
      return fs.existsSync(absPath);
    });
    if (alive.length !== list.length) writeMeta(alive);
    res.json({ success: true, finals: alive });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

// ── POST /api/finals/save ─────────────────────────────────────────────────────
// Body: { renderUrl, sessionLabel, projectData }
router.post('/finals/save', async (req, res) => {
  try {
    const { renderUrl, sessionLabel = 'Финал', projectData } = req.body || {};
    if (!renderUrl) return res.json({ success: false, error: 'renderUrl is required' });

    // renderUrl is like /finals/local_123_label.mp4 — file already exists on disk
    const absVideo = path.join(ROOT_DIR, renderUrl.replace(/^\//, ''));
    if (!fs.existsSync(absVideo)) {
      return res.json({ success: false, error: `Файл не найден: ${renderUrl}` });
    }

    const baseName = path.basename(absVideo, '.mp4');

    // Save project JSON alongside the video
    const jsonName = baseName + '.json';
    const absJson  = path.join(FINALS_DIR, jsonName);
    if (projectData) {
      fs.writeFileSync(absJson, JSON.stringify(projectData, null, 2));
    }

    // Extract first frame as thumbnail
    const thumbFile = await extractThumb(absVideo, baseName);

    const entry = {
      id:           Date.now(),
      sessionKey:   projectData?.sessionKey || null,
      videoFile:    renderUrl,
      jsonFile:     projectData ? `/finals/${jsonName}` : null,
      thumbFile:    thumbFile || null,
      sessionLabel: sessionLabel || 'Финал',
      savedAt:      new Date().toISOString(),
    };

    const list = readMeta();
    list.unshift(entry); // newest first
    writeMeta(list);

    res.json({ success: true, entry });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

// ── DELETE /api/finals/delete ─────────────────────────────────────────────────
// Body: { id }
router.delete('/finals/delete', (req, res) => {
  try {
    const { id } = req.body || {};
    let list = readMeta();
    const item = list.find(i => i.id === id);
    if (item) {
      // Remove files
      if (item.videoFile) {
        const absV = path.join(ROOT_DIR, item.videoFile.replace(/^\//, ''));
        if (fs.existsSync(absV)) fs.unlinkSync(absV);
      }
      if (item.jsonFile) {
        const absJ = path.join(ROOT_DIR, item.jsonFile.replace(/^\//, ''));
        if (fs.existsSync(absJ)) fs.unlinkSync(absJ);
      }
      if (item.thumbFile) {
        const absT = path.join(ROOT_DIR, item.thumbFile.replace(/^\//, ''));
        if (fs.existsSync(absT)) fs.unlinkSync(absT);
      }
    }
    list = list.filter(i => i.id !== id);
    writeMeta(list);
    res.json({ success: true });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

// ── POST /api/finals/send-telegram ───────────────────────────────────────────
// Body: { videoFile, caption? }
// Sends the video file to the configured Telegram chat via Bot API.
router.post('/finals/send-telegram', async (req, res) => {
  const { videoFile, caption = '' } = req.body || {};
  if (!videoFile) return res.json({ success: false, error: 'videoFile is required' });

  const token  = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return res.json({ success: false, error: 'Telegram не настроен (нет токена или chat_id)' });

  const absPath = path.join(ROOT_DIR, videoFile.replace(/^\//, ''));
  if (!fs.existsSync(absPath)) return res.json({ success: false, error: 'Файл не найден: ' + videoFile });

  const axios    = require('axios');
  const FormData = require('form-data');

  const fileSizeMb = fs.statSync(absPath).size / 1024 / 1024;
  const method     = fileSizeMb > 50 ? 'sendDocument' : 'sendVideo';
  const fieldName  = fileSizeMb > 50 ? 'document'     : 'video';

  console.log(`[telegram] sending ${path.basename(absPath)} (${fileSizeMb.toFixed(1)} MB) via ${method}`);

  try {
    const form = new FormData();
    form.append('chat_id', chatId);
    form.append(fieldName, fs.createReadStream(absPath), { filename: path.basename(absPath) });
    if (caption) form.append('caption', caption);

    const tgRes = await axios.post(
      `https://api.telegram.org/bot${token}/${method}`,
      form,
      { headers: form.getHeaders(), timeout: 180_000, maxBodyLength: Infinity, maxContentLength: Infinity }
    );

    if (!tgRes.data?.ok) throw new Error(tgRes.data?.description || 'Telegram API error');
    console.log(`[telegram] sent ok, message_id=${tgRes.data.result?.message_id}`);
    res.json({ success: true, messageId: tgRes.data.result?.message_id });
  } catch (err) {
    const msg = err.response?.data?.description || err.message;
    console.error('[telegram]', msg);
    res.json({ success: false, error: msg });
  }
});

module.exports = router;
