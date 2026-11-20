'use strict';

// ════════════════════════════════════════════════════════════════════════════
// NARRATORS — the store, the samples, and the analysis that turns them into a voice.
//
//   GET    /api/narrators                      -> { narrators: [summary], neutral }
//   GET    /api/narrators/:id                  -> { narrator, block }  (the samples' first lines only)
//   POST   /api/narrators                      { name } -> { narrator }
//   DELETE /api/narrators/:id                  -> { success }
//   POST   /api/narrators/:id/samples          { text, label } -> { narrator }
//   POST   /api/narrators/:id/samples/upload   multipart file -> { jobId }
//   POST   /api/narrators/:id/samples/link     { url } -> { jobId }   (its sound only, no login)
//   POST   /api/narrators/:id/samples/source   { sourceId } -> { narrator }  a Library source's words, free
//   DELETE /api/narrators/:id/samples/:index   -> { narrator }
//   POST   /api/narrators/:id/read             {} -> { jobId }  the samples not read yet - adds to the voice (by
//                                                the agents' ladder, medium)
//   PATCH  /api/narrators/:id/voice/:lineId    { text } -> { narrator }   a line of the voice corrected by hand
//   DELETE /api/narrators/:id/voice/:lineId    -> { narrator }
//   GET    /api/narrators/jobs/:jobId          -> { state, step, error, narrator }
//
// TWO CALLS RUN AS JOBS because both take longer than any sane request timeout: transcribing
// a sample video is minutes of upload, and a reading reads five thousand words of prose
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
const { callLadder } = require('../lib/llm-json');
const STT = require('../lib/stt-replicate');
const SOURCES = require('../lib/sources-store');
const YTDLP = require('../lib/ytdlp');
const I18N = require('../lib/i18n');

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
  if (!job) return res.status(404).json({ success: false, error: I18N.t('no such job') });
  res.json({ success: true, ...job });
});

router.get('/narrators/:id', (req, res) => {
  try {
    const rec = store.get(req.params.id);
    if (!rec) return res.status(404).json({ success: false, error: I18N.t('no such narrator') });
    // The rendered block goes back too: it is what a model will actually be told, and being
    // able to read that is the difference between tuning a narrator and guessing at it. The samples go with
    // their first lines only - the column shows no more - and a reading that runs is said, for a page opened later.
    const run = _reading(rec.id) ? _readingNow.get(String(rec.id)) : '';
    res.json({ success: true, narrator: store.view(rec), block: P.narratorBlock(rec),
      words: store.totalWords(rec), minWords: store.MIN_SAMPLE_WORDS,
      reading: run ? { jobId: run, startedAt: _jobs[run].startedAt || null } : null });
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
  // Not while a reading runs: it marks the samples it read by their places when it lands.
  if (_reading(req.params.id)) return res.status(409).json({ success: false, error: I18N.t('The narrator is being read - remove the sample when it has landed.') });
  try {
    const rec = store.removeSample(req.params.id, req.params.index);
    res.json({ success: true, narrator: rec, words: store.totalWords(rec) });
  } catch (e) { res.status(400).json({ success: false, error: e.message }); }
});

// A SOURCE of the Library becomes a sample for nothing: its words were heard when it came in, so
// its transcript is the sample's text. Refused when this narrator has it already - by the source, by its link, or by
// its words: the same video transcribed into a sample before overlaps it almost word for word, another video by a
// tenth at most.
const _vocab = (t) => new Set(String(t || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(' ').slice(0, 300));
function _sameWords(a, b) {
  const A = _vocab(a);
  const B = _vocab(b);
  let both = 0;
  for (const w of A) if (B.has(w)) both++;
  return both / Math.max(1, A.size + B.size - both) >= 0.6;
}

router.post('/narrators/:id/samples/source', (req, res) => {
  const id = String(req.params.id);
  const rec = store.get(id);
  if (!rec) return res.status(404).json({ success: false, error: I18N.t('no such narrator') });
  const sourceId = String((req.body || {}).sourceId || '');
  const src = sourceId ? SOURCES.get(sourceId) : null;
  if (!src) return res.status(404).json({ success: false, error: I18N.t('no such source') });
  const t = SOURCES.readTranscript(sourceId);
  const text = t && Array.isArray(t.cues) ? t.cues.map(c => String(c.text || '').trim()).filter(Boolean).join(' ') : '';
  if (!text) return res.status(400).json({ success: false, error: I18N.t('This source has no words yet - it has not been heard.') });
  const title = src.title || src.originalName || I18N.t('a source');
  const had = (rec.samples || []).find(s => (s.sourceId && String(s.sourceId) === sourceId)
    || (src.url && s.url && s.url === src.url) || (src.linkKey && s.linkKey && s.linkKey === src.linkKey));
  if (had) return res.status(409).json({ success: false, error: I18N.t('"{title}" is a sample of this narrator already.', { title }) });
  const same = (rec.samples || []).find(s => _sameWords(s.text, text));
  if (same) {
    return res.status(409).json({ success: false,
      error: I18N.t('"{title}" is the same video as the sample "{sample}" - its words are there already.', { title, sample: same.label || I18N.t('a sample') }) });
  }
  try {
    const saved = store.addSample(id, { kind: 'source', label: title, text, sourceId, url: src.url || '', linkKey: src.linkKey || '' });
    res.json({ success: true, narrator: store.view(saved), words: store.countWords(text) });
  } catch (e) { res.status(400).json({ success: false, error: e.message }); }
});

// A video or audio file becomes a sample by being transcribed: the words are what the analysis reads.
router.post('/narrators/:id/samples/upload', upload.single('file'), (req, res) => {
  const id = String(req.params.id);
  const file = req.file;
  if (!file) return res.status(400).json({ success: false, error: I18N.t('no file') });
  if (!store.get(id)) {
    try { fs.unlinkSync(file.path); } catch (e) {}
    return res.status(404).json({ success: false, error: I18N.t('no such narrator') });
  }

  const jobId = _newJobId();
  const job = _jobs[jobId] = { state: 'running', step: I18N.t('reading the file'), at: Date.now(), error: null, narrator: null };
  res.json({ success: true, jobId });

  (async () => {
    try {
      const out = await STT.transcribeFile(file.path, { onProgress: (s) => { job.step = s; } });
      job.step = I18N.t('storing the sample');
      // The same latin-1 filename trap as in routes/sources.js: a Russian name arrives as
      // "ÐÐ°Ð»Ð¾Ð³" unless its bytes are read back as UTF-8.
      const raw = String(file.originalname || '');
      const back = raw ? Buffer.from(raw, 'latin1').toString('utf8') : '';
      const rec = store.addSample(id, {
        kind: 'file', label: (back && !back.includes('�') ? back : raw) || path.basename(file.path),
        text: out.text,
      });
      job.state = 'done';
      job.step = I18N.tn(store.countWords(out.text), '{n} words from {min} min', '{n} words from {min} min', { min: Math.round(out.sourceSeconds / 60) });
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

// A LINK becomes a sample the same way: only its sound is fetched (the
// best there is - the words are what is kept), into the same temp folder, transcribed and deleted. Any
// site yt-dlp reads, without a login; the same video twice in one narrator is refused.
router.post('/narrators/:id/samples/link', async (req, res) => {
  const id = String(req.params.id);
  const url = String((req.body || {}).url || '').trim();
  if (!url) return res.status(400).json({ success: false, error: I18N.t('a link is required') });
  if (!/^https?:\/\//i.test(url)) return res.status(400).json({ success: false, error: I18N.t('that is not a URL') });
  if (!store.get(id)) return res.status(404).json({ success: false, error: I18N.t('no such narrator') });
  if (!(await YTDLP.find())) return res.status(501).json({ success: false, error: YTDLP.MISSING });

  const jobId = _newJobId();
  const job = _jobs[jobId] = { state: 'running', step: I18N.t('reading the link'), at: Date.now(), error: null, narrator: null };
  res.json({ success: true, jobId });

  (async () => {
    const stem = `ugc-nsample-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    let file = '';
    try {
      const meta = await YTDLP.info(url, { onProgress: (s) => { job.step = s; } });
      const rec = store.get(id);
      if (!rec) throw new Error(I18N.t('The narrator went away.'));
      const had = (rec.samples || []).find(s => (meta.key && s.linkKey === meta.key) || (s.url && s.url === meta.url));
      if (had) throw new Error(I18N.t('This video is a sample of this narrator already: "{title}".', { title: had.label || meta.label }));

      job.step = I18N.t('fetching the sound');
      await YTDLP.download(url, path.join(os.tmpdir(), stem + '.%(ext)s'),
        { onProgress: (s) => { job.step = s; }, audioOnly: true, items: meta.count > 1 ? '1' : '' });
      // The extension is whatever the site's best sound came in, so the file is found, not assumed.
      const landed = fs.readdirSync(os.tmpdir()).filter(f => f.startsWith(stem + '.') && !/\.part$/.test(f))[0];
      if (!landed) throw new Error(I18N.t('The download finished but left no file behind.'));
      file = path.join(os.tmpdir(), landed);

      const out = await STT.transcribeFile(file, { onProgress: (s) => { job.step = s; } });
      job.step = I18N.t('storing the sample');
      const saved = store.addSample(id, { kind: 'link', label: meta.label, text: out.text, url: meta.url, linkKey: meta.key });
      job.state = 'done';
      job.step = I18N.tn(store.countWords(out.text), '{n} words from {min} min', '{n} words from {min} min', { min: Math.round(out.sourceSeconds / 60) });
      job.narrator = store.summary(saved);
      job.cost = out.cost;
      job.at = Date.now();
    } catch (e) {
      job.state = 'error';
      job.error = e.message;
      job.at = Date.now();
    } finally {
      // Whatever came down - the sound, or a part of it - goes: the words are the sample.
      try {
        for (const f of fs.readdirSync(os.tmpdir())) if (f.startsWith(stem + '.')) fs.rmSync(path.join(os.tmpdir(), f), { force: true });
      } catch (e) { /* a file still held stays in the temp folder */ }
    }
  })();
});

// ── reading the new samples ─────────────────────────────────────────────────
// ONE button, "Read new samples": the samples not read yet (all of them the first time), one call by the agents' ladder
// at effort medium. What comes back is ADDED to the voice (lib/narrators-store.js applyReading) - a line it has already is
// dropped. The samples read are marked, so a sample is never paid for twice.

const _readingNow = new Map();           // narratorId -> jobId, while a reading runs
const _reading = (id) => { const j = _readingNow.get(String(id)); return !!(j && _jobs[j] && _jobs[j].state === 'running'); };

router.post('/narrators/:id/read', (req, res) => {
  const id = String(req.params.id);
  const rec = store.get(id);
  if (!rec) return res.status(404).json({ success: false, error: I18N.t('no such narrator') });
  if (_reading(id)) return res.status(409).json({ success: false, error: I18N.t('This narrator is being read already.'), jobId: _readingNow.get(id) });
  const unread = store.unreadSamples(rec);
  if (!unread.length) {
    return res.status(400).json({ success: false, error: (rec.samples || []).length
      ? I18N.t('Every sample has been read - add a new one to read it.') : I18N.t('No samples to read - add one first.') });
  }
  // Refused rather than run: below the floor the model describes writing in general instead of this author, and a
  // generic voice is worse than none - it looks like one. Only the first time: a voice there is only grows.
  const words = unread.reduce((n, x) => n + (x.s.words || store.countWords(x.s.text)), 0);
  if (!store.hasVoice(rec) && words < store.MIN_SAMPLE_WORDS) {
    return res.status(400).json({ success: false,
      error: I18N.t('{n} words is not enough to read a voice from — at least {min} are needed.', { n: words, min: store.MIN_SAMPLE_WORDS }) });
  }

  const jobId = _newJobId();
  const n = unread.length;
  const job = _jobs[jobId] = { state: 'running', step: I18N.tn(n, 'reading {n} new sample', 'reading {n} new samples'), at: Date.now(), startedAt: Date.now(), error: null, narrator: null };
  _readingNow.set(id, jobId);
  res.json({ success: true, jobId });

  (async () => {
    try {
      const voice = {};
      for (const f of store.VOICE_FIELDS) voice[f] = ((rec.voice || {})[f] || []).map(l => l.text);
      const { data, by } = await callLadder({
        system: P.NARRATOR_READ_SYSTEM,
        user: P.narratorReadUserPrompt({ voice, samples: unread.map(x => x.s.text) }),
        schema: P.NARRATOR_READ_SCHEMA,
        name: 'reading',
        effort: 'medium',
      });
      if (!store.hasVoice(store.get(id) || rec) && !(data.summary || []).some(t => String(t).trim())) {
        throw new Error(I18N.t('That reading came back without a summary — nothing was stored; press again.'));
      }
      const readId = 'rd_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
      const { rec: saved, added } = store.applyReading(id, data, { readId, model: by.model, samples: unread.map(x => x.i) });
      job.state = 'done';
      job.step = added ? I18N.tn(added, '{n} new line in the voice', '{n} new lines in the voice') : I18N.t('nothing new in the voice');
      job.narrator = store.summary(saved);
      job.at = Date.now();
    } catch (e) {
      job.state = 'error';
      job.error = e.message;
      job.at = Date.now();
    } finally {
      if (_readingNow.get(id) === jobId) _readingNow.delete(id);
    }
  })();
});

// ── the voice by hand (the app only adds, so a line is corrected or deleted here) ──

router.patch('/narrators/:id/voice/:lineId', (req, res) => {
  try {
    res.json({ success: true, narrator: store.view(store.editVoiceLine(req.params.id, req.params.lineId, (req.body || {}).text)) });
  } catch (e) { res.status(400).json({ success: false, error: e.message }); }
});

router.delete('/narrators/:id/voice/:lineId', (req, res) => {
  try {
    res.json({ success: true, narrator: store.view(store.removeVoiceLine(req.params.id, req.params.lineId)) });
  } catch (e) { res.status(400).json({ success: false, error: e.message }); }
});

module.exports = router;
