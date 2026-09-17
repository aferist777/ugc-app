// ════════════════════════════════════════════════════════════════════════════
// ALERTS — what the Alerts button on every page asks (lib/alerts.js).
//
//   GET  /api/alerts            { counts: { running, unseen }, items }   newest first
//   GET  /api/alerts/:id        { item }                                 one generation, followed by
//                                                                        the page that started it
//   POST /api/alerts/seen       { ids? }   the list was opened: the green dot goes out
//   POST /api/alerts/notified   { ids }    their toast was shown - not again on another page
//   POST /api/alerts/clear                 the finished ones go; the running ones stay
//
// Reading never touches a provider. Asking kie.ai or Replicate "is it done yet" is the server
// runner's job (lib/gen-jobs.js): a status route that downloads as a side effect, polled from a
// list on every page, is how one video becomes five files.
// ════════════════════════════════════════════════════════════════════════════

const express = require('express');
const ALERTS = require('../lib/alerts');

const router = express.Router();

router.get('/alerts', (_req, res) => {
  try {
    const all = ALERTS.list();
    res.json({ success: true, counts: ALERTS.counts(all), items: all.map(ALERTS.view) });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.get('/alerts/:id', (req, res) => {
  try {
    const rec = ALERTS.get(req.params.id);
    if (!rec) return res.status(404).json({ success: false, error: 'no such alert' });
    res.json({ success: true, item: ALERTS.view(rec) });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/alerts/seen', (req, res) => {
  try {
    const ids = Array.isArray((req.body || {}).ids) ? req.body.ids : undefined;
    const n = ALERTS.markSeen(ids);
    res.json({ success: true, marked: n, counts: ALERTS.counts() });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/alerts/notified', (req, res) => {
  try {
    const ids = (req.body || {}).ids;
    if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ success: false, error: 'ids are required' });
    res.json({ success: true, marked: ALERTS.markNotified(ids) });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// Try again, with the same request - and it spends again, so the page asks before it calls this.
// The record keeps its row: the failed one turns back into a running one.
router.post('/alerts/:id/retry', async (req, res) => {
  try {
    const rec = await require('../lib/gen-jobs').retry(req.params.id);
    res.json({ success: true, item: ALERTS.view(rec) });
  } catch (e) {
    res.status(400).json({ success: false, error: e.message });
  }
});

router.post('/alerts/clear', (_req, res) => {
  try {
    const n = ALERTS.clearFinished();
    res.json({ success: true, removed: n, counts: ALERTS.counts() });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

module.exports = router;
