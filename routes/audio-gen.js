'use strict';

// ════════════════════════════════════════════════════════════════════════════
// GENERATE AUDIO (phase V34.C, the owner 2026-10-22) - the server of the "generate audio" constructor: the lab page
// /lab/audio now (V34.D), Merge's third chat later (V34.E). The records and the journal are lib/audio-gens.js; the
// engines' field names lib/audio-engines.js.
//
//   GET    /api/audio/catalog         the engines, their modes, models, chips, prices; whether the keys, the almanac and
//                                     the writer's rules are there
//   GET    /api/audio/projects        the projects a mode's default follows (talking head -> simple; blank, highlights ->
//                                     custom) and how long each one's video is
//   POST   /api/audio/gen             { mode, ...the mode's fields, where, project? } -> { gen }   a press: the record and
//                                     its Alerts row NOW, the asking behind the answer
//   GET    /api/audio/gens?limit=     the history, newest first
//   GET    /api/audio/gens/:id        one record (the page follows a press with it)
//   DELETE /api/audio/gens/:id        off the history - never its files
//
// Stopping one is Alerts' own cross (POST /api/alerts/:id/cancel): one way to let go, whichever page asks.
// ════════════════════════════════════════════════════════════════════════════

const express = require('express');
const fs = require('fs');
const path = require('path');
const { PUBLIC_DIR } = require('../lib/config');
const ENG = require('../lib/audio-engines');
const AG = require('../lib/audio-gens');

const router = express.Router();

router.get('/audio/catalog', (_req, res) => {
  try {
    const c = ENG.catalog();
    // V34.A's files, read when they exist: the gold almanac button and the simple mode's writer.
    c.almanac = fs.existsSync(path.join(PUBLIC_DIR, 'js', 'audio', 'almanac-data.js'));
    c.writerRules = fs.existsSync(path.join(__dirname, '..', 'lib', 'audio-writer-rules.js'));
    c.fake = require('../lib/fake-agg').on();
    res.json({ success: true, ...c });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// The projects of Merge, each with its kind and its video's length - the lab's "for the project" list.
router.get('/audio/projects', (_req, res) => {
  try {
    const { timelines } = require('../lib/merge-store').read();
    const HLS = require('../lib/highlights-store');
    const PROJECTS = require('../lib/projects-store');
    const kindOfProject = new Map(PROJECTS.entries().map((e) => [String(e.id), e.kind]));
    const items = [];
    for (const [key, t] of Object.entries(timelines || {})) {
      if (!t) continue;
      const hl = HLS.ofKey(key);
      if (hl && hl.n > 0) continue;
      let kind = 'blank';
      if (t.draft) kind = 'draft';
      else if (hl) kind = 'highlights';
      else if (/^sv3_/.test(key) && kindOfProject.get(key.slice(4)) === 'scenarios') kind = 'talking head';
      let end = 0;
      for (const tr of (Array.isArray(t.tracks) ? t.tracks : [])) {
        if (!tr || tr.kind !== 'video') continue;
        for (const c of (tr.clips || [])) { const e = (+c.start || 0) + (+c.dur || 0); if (e > end) end = e; }
      }
      items.push({ key, title: t.title || 'Untitled', kind, seconds: Math.round(end * 10) / 10, updatedAt: t.updatedAt || t.createdAt || null });
    }
    items.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
    res.json({ success: true, items: items.slice(0, 60) });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// A project's lanes for the lab's sketch of Merge's timeline: each lane's kind and name, its clips' place, length and name.
// Read only - nothing is warmed or written (Merge's own GET /api/mv3/timeline starts the preview copies).
router.get('/audio/lanes', (req, res) => {
  try {
    const key = String(req.query.key || '');
    const { timelines } = require('../lib/merge-store').read();
    const t = timelines && timelines[key];
    if (!t) return res.status(404).json({ success: false, error: 'no such project' });
    const tracks = (Array.isArray(t.tracks) ? t.tracks : []).filter(tr => tr && tr.kind).map(tr => ({
      id: String(tr.id || ''), kind: String(tr.kind), name: String(tr.name || tr.kind), main: !!tr.main,
      clips: (Array.isArray(tr.clips) ? tr.clips : []).slice(0, 400).map(c => ({
        start: +c.start || 0, dur: +c.dur || 0, name: String(c.name || c.text || '').slice(0, 80),
      })),
    }));
    res.json({ success: true, key, title: t.title || 'Untitled', tracks });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/audio/gen', (req, res) => {
  const b = req.body || {};
  try {
    const g = AG.create(String(b.mode || ''), b, b.where || null, { project: String(b.project || '') });
    res.json({ success: true, gen: g, price: ENG.price(g.req) });
  } catch (e) {
    if (!e.status) console.warn('[audio/gen]', e.message);
    res.status(e.status || 500).json({ success: false, error: e.message });
  }
});

router.get('/audio/gens', (req, res) => {
  try { res.json({ success: true, items: AG.list(req.query.limit) }); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.get('/audio/gens/:id', (req, res) => {
  const g = AG.get(req.params.id);
  if (!g) return res.status(404).json({ success: false, error: 'not found' });
  res.json({ success: true, gen: g });
});

router.delete('/audio/gens/:id', (req, res) => {
  const r = AG.remove(req.params.id);
  if (r.code !== 200) return res.status(r.code).json({ success: false, error: r.error });
  res.json({ success: true });
});

module.exports = router;
