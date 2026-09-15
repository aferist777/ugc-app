'use strict';

// Two small routes the generating pages share.
//
//   GET /api/status/:taskId   where a generation stands - Replicate or kie.ai, told apart by the id
//   GET /api/random-face      a random face to seed a character with, never written to disk
//
// Everything else this file held - the first Character page's generation, pose variations, the
// reference sheet, edit-pose, the log bridge and Pose Studio - went with the pages that used it.

const express = require('express');
const axios   = require('axios');
const router  = express.Router();

const { MEDIA } = require('../lib/config');
const { resolveTask } = require('../lib/helpers');
const { removePendingTask } = require('../lib/pending-tasks');

// ── Poll generation status ────────────────────────────────────────────────────
// Universal poll endpoint. resolveTask dispatches by taskId prefix:
//   'repl:<id>' → Replicate polling
//   otherwise   → kie.ai recordInfo
// Same response shape from both providers.
router.get('/status/:taskId', async (req, res) => {
  const { taskId } = req.params;
  // A watched task has already been asked about, by the watcher, on its own schedule. Reading
  // its answer instead of making a second identical call halves the traffic for an open page
  // and - more to the point - means the page is no longer what drives the task to a result.
  // Unwatched tasks (every other page) fall straight through to the poll below.
  try {
    const seen = require('../lib/cv2-watch').peek(taskId);
    if (seen) return res.json({ success: true, ...seen });
  } catch (e) { /* fall through and poll */ }

  const provider = (typeof taskId === 'string' && taskId.startsWith('repl:')) ? 'Replicate' : 'kie.ai';
  console.log('[/api/status]', taskId.slice(0, 60), '→', provider);
  try {
    const result = await resolveTask(taskId, MEDIA.images, 'generated');
    if (result.state === 'success' || result.state === 'failed') removePendingTask(taskId);
    console.log('[/api/status]', taskId.slice(0, 30), 'state:', result.state, result.imagePath || result.error || '');
    return res.json({ success: true, ...result });
  } catch (err) {
    console.error('[status]', err.response?.data || err.message);
    res.status(502).json({ success: false, error: err.message });
  }
});

// ── GET /api/random-face — a random face from thispersondoesnotexist.com ──────
// EPHEMERAL: returned as a data URL, never written to disk. The face only
// exists to seed the 4K reference sheet (Save character sends it as base64).
router.get('/random-face', async (_req, res) => {
  try {
    // The site now serves an HTML shell at "/" — the actual face lives at /random-person.jpeg.
    const response = await axios({ method: 'GET', url: 'https://thispersondoesnotexist.com/random-person.jpeg', responseType: 'arraybuffer', timeout: 15000, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36', 'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8' } });
    const ct = String(response.headers['content-type'] || '');
    const buf = Buffer.from(response.data);
    // TPDNE sometimes serves an HTML interstitial instead of the JPEG — reject it
    // so the client can simply re-click instead of showing a broken face.
    if (!ct.startsWith('image/') || buf.length < 10000) throw new Error('TPDNE returned non-image (' + (ct || 'unknown') + ') — try again');
    res.json({ success: true, dataUrl: 'data:' + ct + ';base64,' + buf.toString('base64') });
  } catch (err) {
    res.status(502).json({ success: false, error: err.message });
  }
});

module.exports = router;
