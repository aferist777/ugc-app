'use strict';

// ════════════════════════════════════════════════════════════════════════════
// MERGE - the video chat's catalog and the person's presets (phase V4, docs/local-app/PLAN.md "V-C", "V-D"). The
// popup is phase V5, `use` and the preset editing V6.
//
//   GET    /api/mv3/video/catalog                 what there is: templates, categories, tags, the 40 Grok examples,
//                                                 where the cases stand, credits - light, no network
//   GET    /api/mv3/video/catalog/cases           the grid's index of the cookbook's cases - empty and why when they
//                                                 are not fetched yet (never a 500, never a download)
//   POST   /api/mv3/video/catalog/fetch           fetch the cases at the pinned commit into the library's cache
//   GET    /api/mv3/video/catalog/case/:slug      one case: its prompt, author, links, retests
//   GET    /api/mv3/video/catalog/template/:id    one template: its master prompt (en, zh), what it needs, its cases
//   GET    /api/mv3/video/catalog/example/:id     one Grok example with its prompt
//   GET    /api/mv3/video/catalog/guide           the production guide, as text
//   GET    /api/mv3/video/catalog/poster/:slug    a case's poster, fetched once from goodcase into the cache
//   GET    /api/mv3/video/presets                 the person's presets (the ready samples seeded one by one)
//   GET    /api/mv3/video/presets/:id             one, with its versions
//   POST   /api/mv3/video/presets/:id             save - a new version
//   POST   /api/mv3/video/presets/:id/restore     {v} - that version made current, as a new version
//   POST   /api/mv3/video/presets/:id/original    a sample back to what it came with
//   POST   /api/mv3/video/presets/:id/duplicate   "<title> (copy)"
//   POST   /api/mv3/video/presets/:id/newer       a sample's newer version taken
//   POST   /api/mv3/video/presets/:id/back        a deleted sample brought back
//   DELETE /api/mv3/video/presets/:id             a sample leaves its mark, a copy goes
// ════════════════════════════════════════════════════════════════════════════

const express = require('express');
const router = express.Router();
const CAT = require('../lib/video-catalog');
const PRESETS = require('../lib/video-presets-store');

const _err = (res, e) => res.status((e && e.status) || 500).json({ success: false, error: (e && e.message) || String(e) });

router.get('/mv3/video/catalog', (_req, res) => {
  try { res.json(Object.assign({ success: true }, CAT.catalog())); } catch (e) { _err(res, e); }
});

router.get('/mv3/video/catalog/cases', (_req, res) => {
  try { const out = CAT.index(); res.json({ success: true, cases: out.cases, why: out.why, status: CAT.status() }); }
  catch (e) { _err(res, e); }
});

router.post('/mv3/video/catalog/fetch', async (_req, res) => {
  try { res.json({ success: true, status: await CAT.fetchCases() }); }
  catch (e) { res.status(502).json({ success: false, error: 'the cases could not be fetched: ' + ((e && e.message) || e), status: CAT.status() }); }
});

router.get('/mv3/video/catalog/case/:slug', (req, res) => {
  try {
    const c = CAT.caseOf(req.params.slug);
    if (!c) return res.status(404).json({ success: false, error: 'no such case' + (CAT.status().cases === 'ready' ? '' : ' - the cases are not fetched yet') });
    res.json({ success: true, case: c.entry, details: c.details, template: c.template, skill: c.skill, slots: c.slots });
  } catch (e) { _err(res, e); }
});

router.get('/mv3/video/catalog/template/:id', (req, res) => {
  try {
    const t = CAT.template(req.params.id);
    if (!t) return res.status(404).json({ success: false, error: 'no such template' });
    res.json({ success: true, template: t });
  } catch (e) { _err(res, e); }
});

router.get('/mv3/video/catalog/example/:id', (req, res) => {
  try {
    const x = CAT.example(req.params.id);
    if (!x) return res.status(404).json({ success: false, error: 'no such example' });
    res.json({ success: true, example: x });
  } catch (e) { _err(res, e); }
});

router.get('/mv3/video/catalog/guide', (_req, res) => {
  try { res.json({ success: true, text: CAT.guide() }); } catch (e) { _err(res, e); }
});

router.get('/mv3/video/catalog/poster/:slug', async (req, res) => {
  try {
    const abs = await CAT.poster(req.params.slug);
    res.set('Cache-Control', 'private, max-age=86400');
    res.sendFile(abs);
  } catch (e) { res.status((e && e.status) || 502).json({ success: false, error: (e && e.message) || String(e) }); }
});

// (phase V23) A case's clip: from the disk once it has been kept, from goodcase meanwhile (lib/video-catalog.js clipOf).
router.get('/mv3/video/catalog/media/:slug', (req, res) => {
  try {
    const c = CAT.clipOf(req.params.slug);
    if (c.abs) { res.set('Cache-Control', 'private, max-age=86400'); return res.sendFile(c.abs); }
    res.redirect(302, c.url);
  } catch (e) { res.status((e && e.status) || 502).json({ success: false, error: (e && e.message) || String(e) }); }
});

// ── The person's presets ────────────────────────────────────────────────────
router.get('/mv3/video/presets', (_req, res) => {
  try { res.json(Object.assign({ success: true }, PRESETS.list())); } catch (e) { _err(res, e); }
});

router.get('/mv3/video/presets/:id', (req, res) => {
  try {
    const p = PRESETS.get(req.params.id);
    if (!p) return res.status(404).json({ success: false, error: 'no such preset' });
    res.json({ success: true, preset: Object.assign({}, p, { versions: undefined }), versions: PRESETS.versions(p.id) });
  } catch (e) { _err(res, e); }
});

const _op = (fn) => (req, res) => {
  try { res.json({ success: true, preset: fn(req) }); } catch (e) { _err(res, e); }
};
router.post('/mv3/video/presets/:id', _op(req => PRESETS.save(req.params.id, (req.body || {}).fields || req.body || {})));
router.post('/mv3/video/presets/:id/restore', _op(req => PRESETS.restore(req.params.id, (req.body || {}).v)));
router.post('/mv3/video/presets/:id/original', _op(req => PRESETS.original(req.params.id)));
router.post('/mv3/video/presets/:id/duplicate', _op(req => PRESETS.duplicate(req.params.id)));
router.post('/mv3/video/presets/:id/newer', _op(req => PRESETS.takeNewer(req.params.id)));
router.post('/mv3/video/presets/:id/back', _op(req => PRESETS.bringBack(req.params.id)));
router.delete('/mv3/video/presets/:id', (req, res) => {
  try { res.json(Object.assign({ success: true }, PRESETS.remove(req.params.id))); } catch (e) { _err(res, e); }
});

module.exports = router;
