'use strict';

// ════════════════════════════════════════════════════════════════════════════
// MERGE — asking for a picture, and reading the strip of what was asked for.
//
// Merge's own routes against Merge's own table. Nothing here reaches into the Character page's
// matrix or its ladders, and nothing there has to change for a model to be added to this list.
//
//   GET    /api/mv3/img/matrix              what can be asked for: engines, aggregators, shapes
//   GET    /api/mv3/img/rules               how to ask: one prompting rule set per model
//   GET    /api/mv3/img/settings            the analyst's chain and the defaults
//   PUT    /api/mv3/img/settings            a shallow patch of any of them
//   POST   /api/mv3/img/think                { engine, text, refs, thread } -> { prompt } or
//                                            { ask } - the rewrite, or a question instead of
//                                            one. `refs` are library paths: they are hosted and
//                                            the analyst is given the pictures, not a count
//   GET    /api/mv3/img/feed?project=…      that project's generations, newest first
//   POST   /api/mv3/img/gen                 { project, engine, provider, prompt, aspect, quality,
//                                             refs? } - refs are library paths; with any of them
//                                             the engine's EDIT model is used instead
//   DELETE /api/mv3/img/item/:id            off the strip; the library keeps the picture
//
//   GET    /api/mv3/chat?project=…&kind=…   that thread, oldest first. One per KIND: a project
//                                            has a conversation about pictures and another
//                                            about clips, and they are not the same one.
//   POST   /api/mv3/chat                    { project, kind, role, text, refs?, genId?, sent? }
//   DELETE /api/mv3/chat/:id                one turn - and the picture it carries
//   DELETE /api/mv3/chat?project=…          the whole thread; the pictures stay
//
//   POST   /api/mv3/img/upload               multipart `image` + `project` - a reference from
//                                            the person's own disk, filed on the images shelf
//                                            under the project's category
//
// ONE PICTURE PER CALL. A panel that wants four asks four times, and gets four independent
// walk down the fallback for it - one submit that dies takes one picture with it rather than
// the batch.
//
// The reply to a submit is the RECORD, not the picture: the picture is minutes away and the
// strip has something to draw in the meantime. The panel then polls the feed, which is also
// what a second tab reads, and what the page finds waiting after a reload.
// ════════════════════════════════════════════════════════════════════════════

const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const router = express.Router();

const MV = require('../lib/mv3-img');
const GENS = require('../lib/mv3-gens');
const CHAT = require('../lib/mv3-chat');
const AGENT = require('../lib/mv3-agent');
const SET = require('../lib/mv3-settings');
const IMG = require('../lib/images-store');
const LC = require('../lib/library-cats');
const { UPLOADS_DIR } = require('../lib/config');

// The whole table, shaped for the panel. Built from the same rows that submit, so the panel
// cannot offer a pairing that fails at submit time.
router.get('/mv3/img/matrix', (_req, res) => {
  try {
    res.json({ success: true, ...MV.matrix() });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// The almanac whole: one prompting rule set per model, and the instruction each one hands a
// rewriting agent. Read-only for now; the gear will edit it.
router.get('/mv3/img/rules', (_req, res) => {
  try {
    const R = require('../lib/mv3-prompt-rules');
    res.json({ success: true, common: R.COMMON, rules: R.listRules() });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── Reading what was said ───────────────────────────────────────────────────
// Its own call rather than a step inside the generation, because it can answer with a QUESTION -
// and a question is a turn in the thread, not a picture that failed. The panel decides what to
// do with either.
// ── What the gear edits ─────────────────────────────────────────────────────
// The order aggregators are tried in, per engine; which model does the rewriting; and whether a
// chain may step over an aggregator whose key is known to be down.
router.get('/mv3/img/settings', (_req, res) => {
  try {
    res.json({
      success: true, settings: SET.read(),
      // Who can do the reading, and what each answers to - the same list the chain is built
      // from, so the panel cannot offer a pairing the walk would not understand.
      writers: SET.WRITER_PROVIDERS, maxWriterSteps: SET.MAX_WRITER_STEPS,
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.put('/mv3/img/settings', (req, res) => {
  try {
    res.json({ success: true, settings: SET.patch(req.body || {}) });
  } catch (e) {
    res.status(400).json({ success: false, error: e.message });
  }
});

router.post('/mv3/img/think', async (req, res) => {
  const b = req.body || {};
  try {
    const e = MV.ENGINES[String(b.engine || '')];
    // THE ANALYST LOOKS AT THE REFERENCES. `refs` is the list of library paths attached above
    // the input, and they are hosted here exactly as they are for a generation - the same
    // helper, the same cache, so attaching a picture and then generating from it is one upload
    // rather than two. A number alone was what it used to get, and a number cannot be looked at.
    //
    // Hosting is not allowed to cost the rewrite: if it fails the count still goes through, and
    // the analyst writes from the words as it always did.
    let refUrls = [];
    const refs = Array.isArray(b.refs) ? b.refs.filter(Boolean) : [];
    if (refs.length) {
      try { refUrls = await GENS.hostRefs(refs); }
      catch (err) { console.warn('[mv3-img] think: could not host references -', err.message); }
    }
    const out = await AGENT.think({
      engine: b.engine, text: b.text, thread: b.thread,
      refs: refs.length || (+b.refs || 0), refUrls,
      aspects: MV.ASPECTS, tiers: e ? e.tiers : [],
    });
    res.json(Object.assign({ success: true }, out));
  } catch (e) {
    // Never fatal: the caller falls back to the words as typed.
    res.status(400).json({ success: false, error: String(e.message || e).slice(0, 300) });
  }
});

router.get('/mv3/img/feed', (req, res) => {
  try {
    res.json({ success: true, items: GENS.list(String(req.query.project || '')) });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.post('/mv3/img/gen', async (req, res) => {
  const b = req.body || {};
  try {
    const rec = await GENS.start({
      project: b.project, engine: b.engine, provider: b.provider,
      prompt: b.prompt, said: b.said, aspect: b.aspect, quality: b.quality,
      // Local library paths. Made reachable from the outside on the way through - see _hostRefs.
      refs: b.refs,
    });
    res.json({ success: true, item: rec });
  } catch (e) {
    // The record survives a failed submit - it is what tells the strip WHY nothing came back.
    // So the error is reported and the feed still has something to show.
    res.status(400).json({ success: false, error: String(MV.reasonOf(e)).slice(0, 400) });
  }
});

router.delete('/mv3/img/item/:id', (req, res) => {
  try {
    const ok = GENS.remove(String(req.params.id || ''));
    if (!ok) return res.status(404).json({ success: false, error: 'no such generation' });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── The thread ──────────────────────────────────────────────────────────────
// Read whole rather than paged. A project's conversation is bounded by what one person typed
// into it, and the pictures inside it are thumbnails on demand - so the whole of it costs less
// than the paging would.
router.get('/mv3/chat', (req, res) => {
  try {
    res.json({ success: true, items: CHAT.read(String(req.query.project || ''), req.query.kind) });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.post('/mv3/chat', (req, res) => {
  const b = req.body || {};
  try {
    res.json({ success: true, item: CHAT.add(b) });
  } catch (e) {
    res.status(400).json({ success: false, error: e.message });
  }
});

router.delete('/mv3/chat/:id', (req, res) => {
  try {
    const ok = CHAT.remove(String(req.params.id || ''));
    if (!ok) return res.status(404).json({ success: false, error: 'no such message' });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// The conversation, not the work. Pictures made in it stay in the library and on the strip -
// clearing what was said is not a reason to throw away what was paid for.
router.delete('/mv3/chat', (req, res) => {
  try {
    res.json({ success: true, removed: CHAT.clear(String(req.query.project || ''), req.query.kind) });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── A reference from the disk ───────────────────────────────────────────────
// Its own door rather than /api/images/upload, and the difference is where it lands: this one
// files the picture under the PROJECT's category - the same shelf that project's generations go
// to - so a reference brought in by hand is findable tomorrow beside the pictures made from it.
//
// The extension is KEPT rather than normalised: a PNG with the background erased is one of the
// things people attach, and rewriting it to .jpg would flatten the transparency onto black.
const EXTS = ['.jpg', '.jpeg', '.png', '.webp'];
const _upload = multer({
  storage: multer.diskStorage({
    destination: (_q, _f, cb) => { try { fs.mkdirSync(UPLOADS_DIR, { recursive: true }); } catch (e) {} cb(null, UPLOADS_DIR); },
    filename: (_q, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, 'mref_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6)
        + (EXTS.includes(ext) ? ext : '.png'));
    },
  }),
  limits: { fileSize: 64 * 1024 * 1024 },
  fileFilter: (_q, file, cb) => cb(null, /^image\//.test(file.mimetype) || EXTS.includes(path.extname(file.originalname).toLowerCase())),
});

router.post('/mv3/img/upload', _upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, error: 'no file' });
  const imagePath = '/uploads/' + req.file.filename;
  const b = req.body || {};
  try {
    // The same category the project's generations use, by the same rule - see catLabelFor.
    let cat = { id: '', label: '' };
    try { cat = LC.add('images', GENS.catLabelFor(_titleOf(String(b.project || '')))).cat || cat; } catch (e) {}
    const { item } = await IMG.add(imagePath, {
      name: String(b.name || '').trim().slice(0, 120) || path.basename(req.file.originalname),
      source: 'upload',
      categoryId: cat.id,
      categoryLabel: cat.label,
      meta: { project: String(b.project || '') || null, attached: true },
    });
    res.json({ success: true, item });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.use('/mv3/img/upload', (err, _req, res, _next) => {
  res.status(400).json({ success: false, error: (err && err.message) || 'upload failed' });
});

// The project's own name, read from the timeline store. Same read mv3-gens does, and for the
// same reason: the title can change between the upload and anything else that looks at it.
function _titleOf(key) {
  if (!key) return '';
  try {
    const { DATA_DIR } = require('../lib/config');
    const f = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'merge-v3.json'), 'utf8'));
    const rec = (f.timelines || {})[key];
    return (rec && rec.title) || '';
  } catch (e) { return ''; }
}

module.exports = router;
