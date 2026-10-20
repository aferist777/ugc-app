'use strict';

// ════════════════════════════════════════════════════════════════════════════
// HIGHLIGHTS - a long video into vertical shorts (phase V33.1; lib/highlights-store.js, lib/highlights-job.js).
//
//   GET    /api/highlights                  -> { projects: [view] }
//   POST   /api/highlights                  { name? } -> { project, key }       a new project and its own timeline
//   GET    /api/highlights/price            ?seconds=&source= -> { price }     what "find moments" is expected to cost
//   GET    /api/highlights/:id              -> { project, progress, retry }    what the field draws (polled while at work)
//   POST   /api/highlights/:id/start        { from, url | path | sourceId, length, count, style } -> { alertId }
//   POST   /api/highlights/:id/stop         the work let go of
//   POST   /api/highlights/:id/retry        the same as the row's retry in Alerts -> { alertId }
// ════════════════════════════════════════════════════════════════════════════

const express = require('express');
const HL = require('../lib/highlights-store');
const JOB = require('../lib/highlights-job');
const YTDLP = require('../lib/ytdlp');

const router = express.Router();

// When the server starts nothing is at work: a project left running was cut off by the app closing (lib/highlights-job.js).
JOB.boot();

// What the page is shown of a project: everything but the agent's whole answer, which is the server's business.
function view(rec) {
  if (!rec) return null;
  const { agent, ...rest } = rec;
  const a = agent ? { ...agent } : null;
  if (a) delete a.raw;
  return { ...rest, agent: a, key: HL.homeKey(rec.id), lengths: HL.LENGTHS, counts: HL.COUNTS };
}

router.get('/highlights', (_req, res) => {
  try { res.json({ success: true, projects: HL.list().map(view) }); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/highlights', (req, res) => {
  try {
    const rec = HL.create(String((req.body || {}).name || ''));
    res.json({ success: true, project: view(rec), key: HL.homeKey(rec.id) });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.get('/highlights/price', (req, res) => {
  try { res.json({ success: true, price: JOB.price({ seconds: +req.query.seconds || 0, sourceId: String(req.query.source || '') }) }); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.get('/highlights/:id', (req, res) => {
  const rec = HL.get(req.params.id);
  if (!rec) return res.status(404).json({ success: false, error: 'no such highlights project' });
  res.json({ success: true, project: view(rec), progress: JOB.progress(rec.id), live: JOB.live(rec.id),
    retry: !JOB.live(rec.id) && rec.work && rec.work.state === 'failed' ? JOB.plan(rec) : '' });
});

router.post('/highlights/:id/start', async (req, res) => {
  try {
    const b = req.body || {};
    if (b.from === 'link' && !(await YTDLP.find())) return res.status(501).json({ success: false, error: YTDLP.MISSING });
    res.json({ success: true, ...JOB.start(req.params.id, b) });
  } catch (e) { res.status(e.status || 500).json({ success: false, error: e.message, code: e.code || null }); }
});

router.post('/highlights/:id/stop', (req, res) => {
  if (!JOB.stop(req.params.id)) return res.status(409).json({ success: false, error: 'it is not at work' });
  res.json({ success: true });
});

router.post('/highlights/:id/retry', async (req, res) => {
  try { res.json({ success: true, alertId: await JOB.retry(req.params.id) }); }
  catch (e) { res.status(e.status || 500).json({ success: false, error: e.message }); }
});

module.exports = router;
