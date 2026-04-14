'use strict';

const express  = require('express');
const fs       = require('fs');
const path     = require('path');
const axios    = require('axios');
const FormData = require('form-data');
const router   = express.Router();

const { ROOT_DIR, UPLOADS_DIR, FINALS_DIR } = require('../lib/config');

const SHOTSTACK_KEY    = process.env.SHOTSTACK_API_KEY || '6J2QO8Yg1MWOCy3XrRM0DYoxCHCzQ9psbdzSLla2';
const SHOTSTACK_EDIT   = 'https://api.shotstack.io/edit/v1';
const SHOTSTACK_INGEST = 'https://api.shotstack.io/ingest/v1';
const KIE_UPLOAD_BASE  = 'https://kieai.redpandaai.co';
const KIE_API_KEY      = process.env.KIE_AI_API_KEY || '';

const ssHeaders = { 'x-api-key': SHOTSTACK_KEY, 'Content-Type': 'application/json' };

// ── Map a web path (/uploads/..., /finals/...) to absolute filesystem path ────
function webPathToFs(webPath) {
  if (webPath.startsWith('/uploads/'))  return path.join(UPLOADS_DIR, webPath.slice('/uploads/'.length));
  if (webPath.startsWith('/finals/'))   return path.join(FINALS_DIR,  webPath.slice('/finals/'.length));
  // Fallback: treat as relative to ROOT_DIR
  return path.join(ROOT_DIR, webPath.replace(/^\//, ''));
}

// ── Build Shotstack render body from prepared clips ───────────────────────────
function buildRenderBody(clips, segmentClips, opts = {}) {
  const {
    transIn = 'fade', transOut = 'fade',
    transInSlow = false, transOutSlow = false,
    music = 'Нет', sfx = 'Нет',
    musicOffset = 0, musicVolume = 0.5,
    sfxOffset = 0,   sfxVolume = 0.8,
    outputRes = 'hd',
  } = opts;

  const TRANS_POOL = ['fade','reveal','wipeLeft','wipeRight','slideLeft','slideRight',
    'slideUp','slideDown','carouselLeft','carouselRight','zoom'];
  function _randTrans() { return TRANS_POOL[Math.floor(Math.random() * TRANS_POOL.length)] + 'Fast'; }

  const transInFull  = transIn  === 'Рандом' ? _randTrans() : transIn  + (transInSlow  ? 'Slow' : 'Fast');
  const transOutFull = transOut === 'Рандом' ? _randTrans() : transOut + (transOutSlow ? 'Slow' : 'Fast');

  const tracks = [];

  // Track 0 (top): biroly clips — positioned at their custom timeline start/end
  if (clips && clips.length) {
    const birolyClips = clips.map(cl => {
      const trimStart = parseFloat(cl.crop) || 0;
      const clipLen   = parseFloat(cl.end) - parseFloat(cl.start);
      return {
        asset:  { type: 'video', src: cl.cdnUrl, trim: trimStart, volume: 1 },
        start:  parseFloat(cl.start),
        length: clipLen > 0 ? clipLen : 6,
      };
    });
    tracks.push({ clips: birolyClips });
  }

  // Track 1 (bottom): segment (avatar) videos — positioned at their audio start/end
  if (segmentClips && segmentClips.length) {
    const segVideoClips = segmentClips.map((cl, i) => {
      const clipLen   = parseFloat(cl.end) - parseFloat(cl.start);
      const trimStart = parseFloat(cl.crop) || 0;
      const transition = {};
      if (i > 0)                       transition.in  = transInFull;
      if (i < segmentClips.length - 1) transition.out = transOutFull;
      return {
        asset:  { type: 'video', src: cl.cdnUrl, trim: trimStart, volume: 1 },
        start:  parseFloat(cl.start),
        length: clipLen > 0 ? clipLen : 5,
        ...(Object.keys(transition).length ? { transition } : {}),
      };
    });
    tracks.push({ clips: segVideoClips });
  }

  if (!tracks.length) throw new Error('Нет клипов для рендера');

  // Compute total video duration for audio clip length
  const allC = [...(clips || []), ...(segmentClips || [])];
  const totalDur = allC.reduce((m, c) => Math.max(m, parseFloat(c.end) || 0), 30);

  // Music audio track (bottom-most track, separate from soundtrack so offset works)
  if (music && music !== 'Нет' && music !== 'Рандом') {
    const mOffset = parseFloat(musicOffset) || 0;
    tracks.push({ clips: [{
      asset:  { type: 'audio', src: music, trim: 0, volume: parseFloat(musicVolume) || 0.5 },
      start:  mOffset,
      length: Math.max(totalDur - mOffset, 1),
    }]});
  }

  // SFX audio track
  if (sfx && sfx !== 'Нет' && sfx !== 'Рандом') {
    const sOffset = parseFloat(sfxOffset) || 0;
    tracks.push({ clips: [{
      asset:  { type: 'audio', src: sfx, trim: 0, volume: parseFloat(sfxVolume) || 0.8 },
      start:  sOffset,
      length: Math.max(totalDur - sOffset, 1),
    }]});
  }

  return {
    timeline: { tracks },
    output: { format: 'mp4', resolution: outputRes, aspectRatio: '9:16' },
  };
}

// ── Upload local file to public host → return public URL ─────────────────────
async function uploadToPublicHost(localPath) {
  const filename = path.basename(localPath);

  // 1. Litterbox (catbox.moe temp) — up to 1GB, 72h retention, no auth
  try {
    const form = new FormData();
    form.append('reqtype',      'fileupload');
    form.append('time',         '72h');
    form.append('fileToUpload', fs.createReadStream(localPath), { filename });
    const res = await axios.post(
      'https://litterbox.catbox.moe/resources/internals/api.php',
      form,
      { headers: form.getHeaders(), maxBodyLength: Infinity, maxContentLength: Infinity, timeout: 120000 }
    );
    const url = (typeof res.data === 'string' ? res.data : '').trim();
    if (url.startsWith('http')) { console.log(`[shotstack] litterbox → ${url}`); return url; }
    console.warn('[shotstack] litterbox unexpected response:', res.data);
  } catch (e) { console.warn('[shotstack] litterbox failed:', e.message); }

  // 2. Pixeldrain — indefinite retention, no auth, PUT binary
  try {
    const fileBuffer = fs.readFileSync(localPath);
    const res = await axios.put(
      `https://pixeldrain.com/api/file/${encodeURIComponent(filename)}`,
      fileBuffer,
      {
        headers: { 'Content-Type': 'application/octet-stream' },
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
        timeout: 120000,
      }
    );
    const id = res.data?.id;
    if (id) {
      const url = `https://pixeldrain.com/api/file/${id}?download`;
      console.log(`[shotstack] pixeldrain → ${url}`);
      return url;
    }
    console.warn('[shotstack] pixeldrain unexpected response:', res.data);
  } catch (e) { console.warn('[shotstack] pixeldrain failed:', e.message); }

  // 3. 0x0.st — permanent hosting, no auth
  try {
    const form = new FormData();
    form.append('file', fs.createReadStream(localPath), { filename });
    const res = await axios.post(
      'https://0x0.st/',
      form,
      { headers: form.getHeaders(), maxBodyLength: Infinity, maxContentLength: Infinity, timeout: 120000 }
    );
    const url = (typeof res.data === 'string' ? res.data : '').trim();
    if (url.startsWith('http')) { console.log(`[shotstack] 0x0.st → ${url}`); return url; }
    console.warn('[shotstack] 0x0.st unexpected response:', res.data);
  } catch (e) { console.warn('[shotstack] 0x0.st failed:', e.message); }

  throw new Error(`Не удалось загрузить ${filename} ни на один хост (litterbox / pixeldrain / 0x0.st)`);
}

// ── Submit URL to Shotstack Ingest; poll until ready ─────────────────────────
async function ingestUrl(publicUrl, label) {
  let id;
  try {
    const res = await axios.post(
      `${SHOTSTACK_INGEST}/sources`,
      { url: publicUrl },
      { headers: ssHeaders, timeout: 30000 }
    );
    id = res.data?.data?.id;
  } catch (err) {
    const status = err.response?.status;
    const detail = JSON.stringify(err.response?.data || {});
    throw new Error(`Ingest submit failed (${status}): ${detail || err.message}`);
  }
  if (!id) throw new Error('Shotstack Ingest: no id returned');
  console.log(`[shotstack] ingest id=${id} for ${label || publicUrl}`);

  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 5000));
    const poll = await axios.get(
      `${SHOTSTACK_INGEST}/sources/${id}`,
      { headers: { 'x-api-key': SHOTSTACK_KEY }, timeout: 15000 }
    );
    const attrs = poll.data?.data?.attributes || {};
    const st    = attrs.status;
    console.log(`[shotstack] ${label || id} → ${st}`);
    if (st === 'ready') {
      // Log full attrs so we can see the real structure
      console.log(`[shotstack] ready attrs:`, JSON.stringify(attrs, null, 2));

      const cdnUrl =
        attrs.url                              ||
        attrs.outputs?.optimised?.[0]?.url     ||
        attrs.outputs?.optimised?.url          ||
        attrs.outputs?.mp4?.[0]?.url           ||
        attrs.outputs?.mp4?.url                ||
        attrs.outputs?.original?.[0]?.url      ||
        attrs.outputs?.original?.url           ||
        // Sometimes outputs is an array
        (Array.isArray(attrs.outputs) ? attrs.outputs[0]?.url : null) ||
        // Last resort: use the public URL we uploaded (Shotstack can fetch it directly)
        publicUrl;

      console.log(`[shotstack] CDN → ${cdnUrl}`);
      return cdnUrl;
    }
    if (st === 'failed') throw new Error(`Ingest failed for ${label}`);
  }
  throw new Error(`Ingest timeout for ${label}`);
}

// ── Full pipeline: local file → public host → Shotstack Ingest → CDN URL ─────
async function ingestLocalFile(webPath) {
  const localPath = webPathToFs(webPath);
  if (!fs.existsSync(localPath)) throw new Error(`Файл не найден: ${webPath}`);
  const filename  = path.basename(localPath);
  console.log(`[shotstack] uploading ${filename}…`);
  const publicUrl = await uploadToPublicHost(localPath);
  return await ingestUrl(publicUrl, filename);
}

// ── POST /api/shotstack/ingest-one ───────────────────────────────────────────
// Upload & ingest a single file; returns { cdnUrl }
router.post('/shotstack/ingest-one', async (req, res) => {
  try {
    const { videoPath } = req.body;
    if (!videoPath) return res.status(400).json({ success: false, error: 'Нет videoPath' });
    const cdnUrl = await ingestLocalFile(videoPath);
    res.json({ success: true, cdnUrl });
  } catch (err) {
    console.error('[shotstack/ingest-one]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /api/shotstack/build-render ─────────────────────────────────────────
// Build render body from clips that already have cdnUrl attached
router.post('/shotstack/build-render', async (req, res) => {
  try {
    const {
      clips = [], segmentClips = [],
      transIn, transOut, transInSlow, transOutSlow,
      music, sfx, outputRes,
      musicOffset, musicVolume,
      sfxOffset, sfxVolume,
    } = req.body;
    if (!clips.length && !segmentClips.length) return res.status(400).json({ success: false, error: 'Нет клипов' });
    const renderBody = buildRenderBody(clips, segmentClips, {
      transIn, transOut, transInSlow, transOutSlow,
      music, sfx, outputRes,
      musicOffset, musicVolume,
      sfxOffset, sfxVolume,
    });
    res.json({ success: true, renderBody });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /api/shotstack/prepare ───────────────────────────────────────────────
// Legacy single-request prepare (kept for backwards compatibility)
router.post('/shotstack/prepare', async (req, res) => {
  try {
    const { sessionKey, sessionLabel,
            clips = [], segmentClips = [],
            transIn, transOut, transInSlow, transOutSlow, music, sfx } = req.body;
    if (!clips.length && !segmentClips.length) return res.status(400).json({ success: false, error: 'Нет видео для сборки' });

    // Ingest each unique local file (dedup by webPath)
    const allSources = [...clips, ...segmentClips];
    const pathToCdn  = {};
    for (const cl of allSources) {
      if (!cl.videoPath || pathToCdn[cl.videoPath]) continue;
      pathToCdn[cl.videoPath] = await ingestLocalFile(cl.videoPath);
    }

    // Attach CDN URLs
    const preparedClips        = clips.map(cl => ({ ...cl, cdnUrl: pathToCdn[cl.videoPath] || '' }));
    const preparedSegmentClips = segmentClips.map(cl => ({ ...cl, cdnUrl: pathToCdn[cl.videoPath] || '' }));

    const renderBody = buildRenderBody(preparedClips, preparedSegmentClips, { transIn, transOut, transInSlow, transOutSlow, music, sfx });

    res.json({ success: true, renderBody, preparedClips, preparedSegmentClips, sessionKey, sessionLabel });
  } catch (err) {
    console.error('[shotstack/prepare]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /api/shotstack/render ────────────────────────────────────────────────
router.post('/shotstack/render', async (req, res) => {
  try {
    const { renderBody } = req.body;
    if (!renderBody) return res.status(400).json({ success: false, error: 'Нет renderBody' });
    const r = await axios.post(`${SHOTSTACK_EDIT}/render`, renderBody, { headers: ssHeaders });
    const renderId = r.data?.data?.id || r.data?.response?.id;
    if (!renderId) throw new Error('Shotstack не вернул render id');
    res.json({ success: true, renderId });
  } catch (err) {
    console.error('[shotstack/render]', err.message);
    const detail = err.response?.data ? JSON.stringify(err.response.data) : '';
    res.status(500).json({ success: false, error: err.message + (detail ? ` — ${detail}` : '') });
  }
});

// ── GET /api/shotstack/poll/:renderId ─────────────────────────────────────────
router.get('/shotstack/poll/:renderId', async (req, res) => {
  try {
    const { renderId } = req.params;
    const r = await axios.get(`${SHOTSTACK_EDIT}/render/${renderId}`, { headers: ssHeaders });
    const resp   = r.data?.data || r.data?.response || {};
    const status = resp.status || resp.attributes?.status || 'unknown';
    const url    = resp.url    || resp.attributes?.url    || null;
    res.json({ success: true, status, url });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /api/finals/save ─────────────────────────────────────────────────────
// Downloads rendered video, saves project JSON to finals/
router.post('/finals/save', async (req, res) => {
  try {
    const { renderUrl, projectData, sessionLabel = 'final' } = req.body;
    if (!renderUrl) return res.status(400).json({ success: false, error: 'Нет renderUrl' });

    const ts       = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const safeName = sessionLabel.replace(/[^а-яёa-z0-9_\- ]/gi, '').trim().replace(/\s+/g, '_').slice(0, 40) || 'final';
    const baseName = `${safeName}_${ts}`;
    const videoFile   = path.join(FINALS_DIR, `${baseName}.mp4`);
    const projectFile = path.join(FINALS_DIR, `${baseName}.json`);

    // Download video
    await new Promise((resolve, reject) => {
      const proto = renderUrl.startsWith('https') ? require('https') : require('http');
      const file = fs.createWriteStream(videoFile);
      proto.get(renderUrl, resp => {
        resp.pipe(file);
        file.on('finish', () => { file.close(); resolve(); });
      }).on('error', err => { fs.unlink(videoFile, () => {}); reject(err); });
    });

    // Save project JSON
    const project = {
      ...(projectData || {}),
      sessionLabel,
      renderUrl,
      videoFile: `/finals/${baseName}.mp4`,
      savedAt: new Date().toISOString(),
    };
    fs.writeFileSync(projectFile, JSON.stringify(project, null, 2), 'utf8');

    res.json({ success: true, videoPath: `/finals/${baseName}.mp4`, projectPath: `/finals/${baseName}.json`, baseName });
  } catch (err) {
    console.error('[finals/save]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /api/finals/list ──────────────────────────────────────────────────────
router.get('/finals/list', (req, res) => {
  try {
    const files = fs.readdirSync(FINALS_DIR)
      .filter(f => f.endsWith('.json'))
      .map(f => {
        try {
          const data = JSON.parse(fs.readFileSync(path.join(FINALS_DIR, f), 'utf8'));
          return { ...data, jsonFile: `/finals/${f}` };
        } catch { return null; }
      })
      .filter(Boolean)
      .sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt));
    res.json({ success: true, finals: files });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
