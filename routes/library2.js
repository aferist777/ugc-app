'use strict';

// ════════════════════════════════════════════════════════════════════════════
// LIBRARY 2 — the page's own API: the shelf counts, and the drafts.
//
//   GET    /api/library2/counts                    -> { scenarios, narrators, sources, drafts }
//   GET    /api/library2/drafts                    -> { drafts: [summary] }
//   GET    /api/library2/drafts/for-topic?…        -> { draft | null }
//   GET    /api/library2/drafts/:id                -> { draft }
//   POST   /api/library2/drafts                    -> { draft }   create or update
//   DELETE /api/library2/drafts/:id                -> { success }
//
// THE COUNTS ARE ONE REQUEST because the badges must be right before anything is clicked. The
// page used to fill only the shelf it was reading, so the other two sat blank until you opened
// them - a count you have to click to see is not a count. Three list requests would also work
// and would pull three lists the page has no use for yet.
// ════════════════════════════════════════════════════════════════════════════

const express = require('express');

const drafts = require('../lib/script-drafts');
const narrators = require('../lib/narrators-store');
const sources = require('../lib/sources-store');
const scen3 = require('./scen3');

const router = express.Router();

router.get('/library2/counts', (_req, res) => {
  try {
    res.json({
      success: true,
      counts: {
        // Only the generated ones: this shelf does not show hand-written scenarios, so counting
        // them here would put a number on the badge that the shelf cannot account for.
        scenarios: scen3.countByLib('library2'),
        narrators: narrators.list().length,
        sources: sources.list().length,
        drafts: drafts.list().length,
      },
    });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── drafts ──────────────────────────────────────────────────────────────────

router.get('/library2/drafts', (_req, res) => {
  try { res.json({ success: true, drafts: drafts.summaries() }); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// BEFORE /drafts/:id, or the parameter swallows "for-topic" and answers "no such draft".
router.get('/library2/drafts/for-topic', (req, res) => {
  const q = req.query || {};
  res.json({ success: true, draft: drafts.forTopic(q.sourceId, q.topicId) });
});

router.get('/library2/drafts/:id', (req, res) => {
  const d = drafts.get(req.params.id);
  if (!d) return res.status(404).json({ success: false, error: 'no such draft' });
  res.json({ success: true, draft: d });
});

// Called at every stage of writing, so it has to be an upsert: a second row for work that
// already has one would show the same unfinished script twice.
router.post('/library2/drafts', (req, res) => {
  try { res.json({ success: true, draft: drafts.save(req.body || {}) }); }
  catch (e) { res.status(400).json({ success: false, error: e.message }); }
});

router.delete('/library2/drafts/:id', (req, res) => {
  const gone = drafts.remove(req.params.id);
  if (!gone) return res.status(404).json({ success: false, error: 'no such draft' });
  res.json({ success: true });
});

module.exports = router;
