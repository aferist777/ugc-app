'use strict';

const express = require('express');
const path    = require('path');
const fs      = require('fs');
const https   = require('https');
const http    = require('http');
const router  = express.Router();

const { TEMP_DIR } = require('../lib/config');

// ── POST /api/temp/fetch-url ──────────────────────────────────────────────────
// Downloads an image from a URL, saves to temp_files/, returns { success, path }
router.post('/temp/fetch-url', async (req, res) => {
  const { url } = req.body;
  if (!url || !/^https?:\/\//i.test(url)) {
    return res.status(400).json({ success: false, error: 'Нет корректной ссылки' });
  }
  try {
    const buf = await downloadUrl(url);
    // Detect extension from URL or default to jpg
    const ext  = (url.match(/\.(jpe?g|png|webp|gif)(\?|$)/i)?.[1] || 'jpg').toLowerCase();
    const name = `temp_${Date.now()}.${ext}`;
    const dest = path.join(TEMP_DIR, name);
    fs.writeFileSync(dest, buf);
    res.json({ success: true, path: `/temp_files/${name}` });
  } catch (err) {
    console.error('[temp/fetch-url]', err.message);
    res.status(502).json({ success: false, error: err.message });
  }
});

function downloadUrl(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const agent = new https.Agent({ rejectUnauthorized: false });
    mod.get(url, { agent }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return downloadUrl(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end',  () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

module.exports = router;
