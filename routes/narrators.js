'use strict';

// ════════════════════════════════════════════════════════════════════════════
// NARRATORS — the store, the samples, and the analysis that turns them into a voice.
//
//   GET    /api/narrators                      -> { narrators: [summary], neutral }
//   GET    /api/narrators/:id                  -> { narrator }  (with sample texts)
//   POST   /api/narrators                      { name } -> { narrator }
//   PATCH  /api/narrators/:id                  { name } -> { narrator }
//   DELETE /api/narrators/:id                  -> { success }
//   POST   /api/narrators/:id/samples          { text, label } -> { narrator }
//   POST   /api/narrators/:id/samples/upload   multipart file -> { jobId }
//   DELETE /api/narrators/:id/samples/:index   -> { narrator }
//   DELETE /api/narrators/:id/readings/:rid    -> { narrator, readings }
//   POST   /api/narrators/:id/analyse          { provider, model, effort } -> { jobId }  appends
//   GET    /api/narrators/jobs/:jobId          -> { state, step, error, narrator }
//
// TWO CALLS RUN AS JOBS because both take longer than any sane request timeout: transcribing
// a sample video is minutes of upload, and the analysis reads five thousand words of prose
// with reasoning on. An in-memory map, polled - the pattern Merge's captions use too
// (lib/captions-job.js) - rather than a new mechanism.
// ════════════════════════════════════════════════════════════════════════════

const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const multer = require('multer');

const store = require('../lib/narrators-store');
const P = require('../lib/writing-prompts');
const { callJSON, runnable } = require('../lib/llm-json');
const STT = require('../lib/stt-replicate');
const WM = require('../lib/writing-models');

const router = express.Router();

// Samples land in the OS temp dir and are deleted after transcription: what is kept is the
// text, and holding a 300 MB video whose words we already have is paying rent on nothing.
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, os.tmpdir()),
    filename: (_req, file, cb) => cb(null, `ugc-nsample-${Date.now()}-${(file.originalname || 'sample').replace(/[^\w.\-]+/g, '_')}`),
  }),
  limits: { fileSize: 2 * 1024 * 1024 * 1024 },
});

const _jobs = {};                        // jobId -> { state, step, error, narrator }
const _newJobId = () => 'nj_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// Finished jobs are dropped after an hour. The page polls until it sees a terminal state, so
// anything older than that is a job whose page is long gone.
function _sweep() {
  const cutoff = Date.now() - 3600000;
  for (const [id, job] of Object.entries(_jobs)) {
    if (job.state !== 'running' && (job.at || 0) < cutoff) delete _jobs[id];
  }
}

// ── reading ─────────────────────────────────────────────────────────────────

router.get('/narrators', (_req, res) => {
  try {
    res.json({ success: true, narrators: store.summaries(), neutral: store.NEUTRAL,
      minWords: store.MIN_SAMPLE_WORDS });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.get('/narrators/jobs/:jobId', (req, res) => {
  _sweep();
  const job = _jobs[String(req.params.jobId)];
  if (!job) return res.status(404).json({ success: false, error: 'no such job' });
  res.json({ success: true, ...job });
});

router.get('/narrators/:id', (req, res) => {
  try {
    const rec = store.get(req.params.id);
    if (!rec) return res.status(404).json({ success: false, error: 'no such narrator' });
    // The rendered block goes back too: it is what a model will actually be told, and being
    // able to read that is the difference between tuning a narrator and guessing at it. So do all
    // the readings - the editor pages through them, and a profile is small next to a sample.
    res.json({ success: true, narrator: rec, block: P.narratorBlock(rec),
      readings: store.readings(rec),
      words: store.totalWords(rec), minWords: store.MIN_SAMPLE_WORDS });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── the record ──────────────────────────────────────────────────────────────

router.post('/narrators', (req, res) => {
  try {
    res.json({ success: true, narrator: store.create((req.body || {}).name) });
  } catch (e) { res.status(400).json({ success: false, error: e.message }); }
});

router.delete('/narrators/:id', (req, res) => {
  try {
    store.remove(req.params.id);
    res.json({ success: true });
  } catch (e) { res.status(404).json({ success: false, error: e.message }); }
});

// ── samples ─────────────────────────────────────────────────────────────────

router.post('/narrators/:id/samples', (req, res) => {
  try {
    const b = req.body || {};
    const rec = store.addSample(req.params.id, {
      kind: 'text', label: b.label || 'pasted text', text: b.text,
    });
    res.json({ success: true, narrator: rec, words: store.totalWords(rec) });
  } catch (e) { res.status(400).json({ success: false, error: e.message }); }
});

router.delete('/narrators/:id/samples/:index', (req, res) => {
  try {
    const rec = store.removeSample(req.params.id, req.params.index);
    res.json({ success: true, narrator: rec, words: store.totalWords(rec) });
  } catch (e) { res.status(400).json({ success: false, error: e.message }); }
});

// One reading of the voice, dropped. Kept separate from deleting the narrator: a reading that came
// back thin is worth throwing away on its own, and the samples it was made from stay.
router.delete('/narrators/:id/readings/:rid', (req, res) => {
  try {
    const rec = store.removeReading(req.params.id, req.params.rid);
    res.json({ success: true, narrator: rec, readings: store.readings(rec) });
  } catch (e) { res.status(400).json({ success: false, error: e.message }); }
});

// A video or audio file becomes a sample by being transcribed. This is how Azazin was built:
// his three samples are his own videos, and the words are what the analysis reads.
router.post('/narrators/:id/samples/upload', upload.single('file'), (req, res) => {
  const id = String(req.params.id);
  const file = req.file;
  if (!file) return res.status(400).json({ success: false, error: 'no file' });
  if (!store.get(id)) {
    try { fs.unlinkSync(file.path); } catch (e) {}
    return res.status(404).json({ success: false, error: 'no such narrator' });
  }

  const jobId = _newJobId();
  const job = _jobs[jobId] = { state: 'running', step: 'reading the file', at: Date.now(), error: null, narrator: null };
  res.json({ success: true, jobId });

  (async () => {
    try {
      const out = await STT.transcribeFile(file.path, { onProgress: (s) => { job.step = s; } });
      job.step = 'storing the sample';
      // The same latin-1 filename trap as in routes/sources.js: a Russian name arrives as
      // "ÐÐ°Ð»Ð¾Ð³" unless its bytes are read back as UTF-8.
      const raw = String(file.originalname || '');
      const back = raw ? Buffer.from(raw, 'latin1').toString('utf8') : '';
      const rec = store.addSample(id, {
        kind: 'file', label: (back && !back.includes('�') ? back : raw) || path.basename(file.path),
        text: out.text,
      });
      job.state = 'done';
      job.step = `${store.countWords(out.text)} words from ${Math.round(out.sourceSeconds / 60)} min`;
      job.narrator = store.summary(rec);
      job.cost = out.cost;
      job.at = Date.now();
    } catch (e) {
      job.state = 'error';
      job.error = e.message;
      job.at = Date.now();
    } finally {
      try { if (fs.existsSync(file.path)) fs.unlinkSync(file.path); } catch (e) {}
    }
  })();
});

// ── the analysis ────────────────────────────────────────────────────────────

router.post('/narrators/:id/analyse', (req, res) => {
  const id = String(req.params.id);
  const rec = store.get(id);
  if (!rec) return res.status(404).json({ success: false, error: 'no such narrator' });

  // Shuffled, and with sampling left on (temperature 1): this call is meant to be run more than
  // once, and two readings that come back word-for-word identical would make the history pointless.
  const samples = store.shuffledSampleTexts(rec);
  if (!samples.length) return res.status(400).json({ success: false, error: 'no samples to read' });
  const words = store.totalWords(rec);
  // Refused rather than run: below the floor the model describes writing in general instead
  // of this author, and a generic profile is worse than none - it looks like a voice.
  if (words < store.MIN_SAMPLE_WORDS) {
    return res.status(400).json({ success: false,
      error: `${words} words is not enough to read a voice from — at least ${store.MIN_SAMPLE_WORDS} are needed.` });
  }

  const opts = WM.normalise(runnable(req.body || {}));
  const jobId = _newJobId();
  const job = _jobs[jobId] = { state: 'running', step: `reading ${samples.length} samples`, at: Date.now(), error: null, narrator: null };
  res.json({ success: true, jobId });

  (async () => {
    try {
      const profile = await callJSON({
        system: P.NARRATOR_ANALYSIS_SYSTEM,
        user: P.narratorAnalysisUserPrompt(samples),
        schema: P.NARRATOR_SCHEMA,
        name: 'narrator',
        provider: opts.provider, model: opts.model, effort: opts.effort,
        temperature: 1,
      });
      const saved = store.addReading(id, { profile, model: opts.model });
      const n = store.readings(saved).length;
      job.state = 'done';
      job.step = n === 1 ? 'the voice is read' : `reading ${n} of ${n} stored`;
      job.narrator = store.summary(saved);
      job.block = P.narratorBlock(saved);
      job.at = Date.now();
    } catch (e) {
      job.state = 'error';
      job.error = e.message;
      job.at = Date.now();
    }
  })();
});

module.exports = router;
