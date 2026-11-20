'use strict';

// ════════════════════════════════════════════════════════════════════════════
// LINKS — the yt-dlp the app reads links with.
//
//   GET  /api/ytdlp          -> { available, version, copy, channel, checking, checkedAt, why, result, from, to, error }
//   POST /api/ytdlp/check    -> the same, after a check for a newer nightly build
//
// Admin -> This computer shows it (public/js/admin-local.js): which yt-dlp, whose copy (the app's,
// or the one kept current in the library's cache/yt-dlp/), and what the last check found. The
// checks themselves run on their own (lib/ytdlp.js startChecks); the button is for "just in case".
//
// AND THE CLIPS THAT COME IN BY A LINK (lib/link-queue.js) - the Media shelf, Merge's Library panel, the video chat:
//
//   POST /api/links             { urls: [..] | url, kind, project, from } -> { jobs }   one job per link, queued
//   GET  /api/links?ids=a,b     -> { jobs }   (every job of the last hour without ids)
//   POST /api/links/:id/stop    -> { job }
// ════════════════════════════════════════════════════════════════════════════

const express = require('express');
const YTDLP = require('../lib/ytdlp');
const LINKS = require('../lib/link-queue');
const I18N = require('../lib/i18n');

// One press of "add" is a handful of links, not a list to crawl.
const MAX_LINKS = 20;

const router = express.Router();

// The first probe of a run starts a whole Python, over a second and up to thirty on a cold disk:
// the page is answered in time with what is known, and asks again.
const PROBE_WAIT_MS = 8000;

router.get('/ytdlp', async (_req, res) => {
  try {
    const late = new Promise(r => setTimeout(() => r(null), PROBE_WAIT_MS));
    const s = await Promise.race([YTDLP.status(), late]);
    res.json(s ? { success: true, ...s } : { success: true, probing: true, channel: YTDLP.CHANNEL });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/ytdlp/check', async (_req, res) => {
  try { res.json({ success: true, ...(await YTDLP.checkNow()) }); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/links', async (req, res) => {
  const b = req.body || {};
  const raw = Array.isArray(b.urls) ? b.urls : [b.url];
  const urls = [...new Set(raw.map(u => String(u || '').trim()).filter(Boolean))];
  if (!urls.length) return res.status(400).json({ success: false, error: I18N.t('a link is required') });
  if (urls.length > MAX_LINKS) return res.status(400).json({ success: false, error: I18N.tn(MAX_LINKS, 'at most {n} link at once', 'at most {n} links at once') });
  const bad = urls.find(u => !/^https?:\/\/\S+$/i.test(u));
  if (bad) return res.status(400).json({ success: false, error: I18N.t('that is not a link: {link}', { link: bad.slice(0, 80) }) });
  if (b.kind != null && !LINKS.KINDS.includes(String(b.kind)) && b.from !== 'chat') {
    return res.status(400).json({ success: false, error: I18N.t('a clip goes to B-rolls, Uploads or Hooks') });
  }
  if (!(await YTDLP.find())) return res.status(501).json({ success: false, error: YTDLP.MISSING });
  const jobs = urls.map(url => LINKS.add({ url, kind: String(b.kind || ''), project: b.project, from: b.from }));
  res.json({ success: true, jobs });
});

router.get('/links', (req, res) => {
  const ids = String(req.query.ids || '').split(',').map(s => s.trim()).filter(Boolean);
  res.json({ success: true, jobs: LINKS.list(ids) });
});

router.post('/links/:id/stop', (req, res) => {
  const job = LINKS.stop(req.params.id);
  if (!job) return res.status(404).json({ success: false, error: I18N.t('no such link') });
  res.json({ success: true, job });
});

module.exports = router;
