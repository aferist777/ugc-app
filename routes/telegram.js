const express  = require('express');
const router   = express.Router();
const path     = require('path');
const fs       = require('fs');
const FormData = require('form-data');
const axios    = require('axios');
const { UPLOADS_DIR, FINALS_DIR } = require('../lib/config');

const TG_TOKEN = '<telegram-bot-token>';
const TG_CHAT  = '@your_channel';

function urlToFilePath(url) {
  if (!url) return null;
  if (url.startsWith('/uploads/')) return path.join(UPLOADS_DIR, url.slice(9));
  if (url.startsWith('/finals/'))  return path.join(FINALS_DIR,  url.slice(8));
  return null;
}

router.post('/telegram/send-video', async (req, res) => {
  const { videoUrl, caption } = req.body || {};
  if (!videoUrl) return res.json({ success: false, error: 'videoUrl required' });

  const filePath = urlToFilePath(videoUrl);
  if (!filePath || !fs.existsSync(filePath)) {
    return res.json({ success: false, error: 'File not found: ' + filePath });
  }

  try {
    const form = new FormData();
    form.append('chat_id', TG_CHAT);
    form.append('video', fs.createReadStream(filePath));
    if (caption) form.append('caption', String(caption).slice(0, 1024));

    const r = await axios.post(
      `https://api.telegram.org/bot${TG_TOKEN}/sendVideo`,
      form,
      { headers: form.getHeaders(), timeout: 180000, maxContentLength: Infinity, maxBodyLength: Infinity }
    );

    if (r.data.ok) return res.json({ success: true });
    return res.json({ success: false, error: r.data.description });
  } catch (e) {
    const msg = e.response?.data?.description || e.message;
    return res.json({ success: false, error: msg });
  }
});

module.exports = router;
