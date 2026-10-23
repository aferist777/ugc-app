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
//   POST   /api/narrators/:id/samples/link     { url } -> { jobId }   (its sound only, no login - phase V27)
//   POST   /api/narrators/:id/samples/source   { sourceId } -> { narrator }  a Library source's words, free (V38)
//   DELETE /api/narrators/:id/samples/:index   -> { narrator }
//   POST   /api/narrators/:id/read             {} -> { jobId }  the samples not read yet - adds to the voice, proposes
//                                                words and phrases (V38; by the agents' ladder, medium)
//   PATCH  /api/narrators/:id/voice/:lineId    { text } -> { narrator }   a line of the voice corrected by hand
//   DELETE /api/narrators/:id/voice/:lineId    -> { narrator }
//   POST   /api/narrators/:id/<list>           { text, meaning, when, example, kind, place } -> { narrator, entry }
//   PATCH  /api/narrators/:id/<list>/:eid      { field: value, on } -> { narrator }     <list> = vocabulary | phrases
//   DELETE /api/narrators/:id/<list>/:eid      -> { narrator }
//   POST   /api/narrators/:id/<list>/:eid/examples      { text } -> { narrator }
//   PATCH  /api/narrators/:id/<list>/:eid/examples/:i   { text } -> { narrator }
//   DELETE /api/narrators/:id/<list>/:eid/examples/:i   -> { narrator }
//   POST   /api/narrators/:id/pending/<list>/:pid/keep|drop  -> { narrator }   (:pid 'all' for every proposal)
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
const AGENT = require('../lib/mv3-agent');
const SOURCES = require('../lib/sources-store');
const YTDLP = require('../lib/ytdlp');

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
    // able to read that is the difference between tuning a narrator and guessing at it. (V38) The samples go with
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
  if (_reading(req.params.id)) return res.status(409).json({ success: false, error: 'The narrator is being read - remove the sample when it has landed.' });
  try {
    const rec = store.removeSample(req.params.id, req.params.index);
    res.json({ success: true, narrator: rec, words: store.totalWords(rec) });
  } catch (e) { res.status(400).json({ success: false, error: e.message }); }
});

// (phase V38, block D5) A SOURCE of the Library becomes a sample for nothing: its words were heard when it came in, so
// its transcript is the sample's text. Refused when this narrator has it already - by the source, by its link, or by
// its words: the same video transcribed into a sample before (the owner's "black story" is the source "История по
// черному - рабство древнего рима") overlaps it almost word for word, another video by a tenth at most.
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
  if (!rec) return res.status(404).json({ success: false, error: 'no such narrator' });
  const sourceId = String((req.body || {}).sourceId || '');
  const src = sourceId ? SOURCES.get(sourceId) : null;
  if (!src) return res.status(404).json({ success: false, error: 'no such source' });
  const t = SOURCES.readTranscript(sourceId);
  const text = t && Array.isArray(t.cues) ? t.cues.map(c => String(c.text || '').trim()).filter(Boolean).join(' ') : '';
  if (!text) return res.status(400).json({ success: false, error: 'This source has no words yet - it has not been heard.' });
  const title = src.title || src.originalName || 'a source';
  const had = (rec.samples || []).find(s => (s.sourceId && String(s.sourceId) === sourceId)
    || (src.url && s.url && s.url === src.url) || (src.linkKey && s.linkKey && s.linkKey === src.linkKey));
  if (had) return res.status(409).json({ success: false, error: `"${title}" is a sample of this narrator already.` });
  const same = (rec.samples || []).find(s => _sameWords(s.text, text));
  if (same) return res.status(409).json({ success: false, error: `"${title}" is the same video as the sample "${same.label || 'a sample'}" - its words are there already.` });
  try {
    const saved = store.addSample(id, { kind: 'source', label: title, text, sourceId, url: src.url || '', linkKey: src.linkKey || '' });
    res.json({ success: true, narrator: store.view(saved), words: store.countWords(text) });
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

// (phase V27, the owner 2026-10-12) A LINK becomes a sample the same way: only its sound is fetched (the
// best there is - the words are what is kept), into the same temp folder, transcribed and deleted. Any
// site yt-dlp reads, without a login; the same video twice in one narrator is refused.
router.post('/narrators/:id/samples/link', async (req, res) => {
  const id = String(req.params.id);
  const url = String((req.body || {}).url || '').trim();
  if (!url) return res.status(400).json({ success: false, error: 'a link is required' });
  if (!/^https?:\/\//i.test(url)) return res.status(400).json({ success: false, error: 'that is not a URL' });
  if (!store.get(id)) return res.status(404).json({ success: false, error: 'no such narrator' });
  if (!(await YTDLP.find())) return res.status(501).json({ success: false, error: YTDLP.MISSING });

  const jobId = _newJobId();
  const job = _jobs[jobId] = { state: 'running', step: 'reading the link', at: Date.now(), error: null, narrator: null };
  res.json({ success: true, jobId });

  (async () => {
    const stem = `ugc-nsample-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    let file = '';
    try {
      const meta = await YTDLP.info(url, { onProgress: (s) => { job.step = s; } });
      const rec = store.get(id);
      if (!rec) throw new Error('The narrator went away.');
      const had = (rec.samples || []).find(s => (meta.key && s.linkKey === meta.key) || (s.url && s.url === meta.url));
      if (had) throw new Error(`This video is a sample of this narrator already: "${had.label || meta.label}".`);

      job.step = 'fetching the sound';
      await YTDLP.download(url, path.join(os.tmpdir(), stem + '.%(ext)s'),
        { onProgress: (s) => { job.step = s; }, audioOnly: true, items: meta.count > 1 ? '1' : '' });
      // The extension is whatever the site's best sound came in, so the file is found, not assumed.
      const landed = fs.readdirSync(os.tmpdir()).filter(f => f.startsWith(stem + '.') && !/\.part$/.test(f))[0];
      if (!landed) throw new Error('The download finished but left no file behind.');
      file = path.join(os.tmpdir(), landed);

      const out = await STT.transcribeFile(file, { onProgress: (s) => { job.step = s; } });
      job.step = 'storing the sample';
      const saved = store.addSample(id, { kind: 'link', label: meta.label, text: out.text, url: meta.url, linkKey: meta.key });
      job.state = 'done';
      job.step = `${store.countWords(out.text)} words from ${Math.round(out.sourceSeconds / 60)} min`;
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

// ── reading the new samples (phase V38) ─────────────────────────────────────
// ONE button, "Read new samples": the samples not read yet (all of them the first time), one call by the agents' ladder
// at effort medium. What comes back is ADDED (lib/narrators-store.js applyReading): new lines of the voice at once, a
// line it has already dropped; new words and phrases as proposals with a tick; new examples of the entries there are at
// once. The samples read are marked, so a sample is never paid for twice.

const _readingNow = new Map();           // narratorId -> jobId, while a reading runs
const _reading = (id) => { const j = _readingNow.get(String(id)); return !!(j && _jobs[j] && _jobs[j].state === 'running'); };

// What the model is told is known already. References name the entries for the examples it may add to them; proposals
// waiting for a tick are known too, so they are not proposed twice.
function _known(rec) {
  const refs = {};
  const out = { voice: {}, vocabulary: [], phrases: [], dismissed: [] };
  for (const f of store.VOICE_FIELDS) out.voice[f] = ((rec.voice || {})[f] || []).map(l => l.text);
  for (const list of store.LISTS) {
    const letter = list === 'phrases' ? 'p' : 'w';
    let n = 0;
    const add = (e, pending) => {
      const ref = letter + (++n);
      refs[ref] = { list, id: e.id, pending };
      out[list].push({ ref, text: e.text, meaning: e.meaning, kind: e.kind || '' });
    };
    for (const e of rec[list] || []) add(e, false);
    for (const e of (rec.pending || {})[list] || []) add(e, true);
    out.dismissed.push(...((rec.dismissed || {})[list] || []));
  }
  return { known: out, refs };
}

router.post('/narrators/:id/read', (req, res) => {
  const id = String(req.params.id);
  const rec = store.get(id);
  if (!rec) return res.status(404).json({ success: false, error: 'no such narrator' });
  if (_reading(id)) return res.status(409).json({ success: false, error: 'This narrator is being read already.', jobId: _readingNow.get(id) });
  const unread = store.unreadSamples(rec);
  if (!unread.length) {
    return res.status(400).json({ success: false, error: (rec.samples || []).length
      ? 'Every sample has been read - add a new one to read it.' : 'No samples to read - add one first.' });
  }
  // Refused rather than run: below the floor the model describes writing in general instead of this author, and a
  // generic voice is worse than none - it looks like one. Only the first time: a voice there is only grows.
  const words = unread.reduce((n, x) => n + (x.s.words || store.countWords(x.s.text)), 0);
  if (!store.hasVoice(rec) && words < store.MIN_SAMPLE_WORDS) {
    return res.status(400).json({ success: false,
      error: `${words} words is not enough to read a voice from — at least ${store.MIN_SAMPLE_WORDS} are needed.` });
  }

  const jobId = _newJobId();
  const n = unread.length;
  const job = _jobs[jobId] = { state: 'running', step: `reading ${n} new ${n === 1 ? 'sample' : 'samples'}`, at: Date.now(), startedAt: Date.now(), error: null, narrator: null };
  _readingNow.set(id, jobId);
  res.json({ success: true, jobId });

  (async () => {
    try {
      const { known, refs } = _known(rec);
      const { data, by } = await callLadder({
        system: P.NARRATOR_READ_SYSTEM,
        user: P.narratorReadUserPrompt({ known, samples: unread.map(x => x.s.text) }),
        schema: P.NARRATOR_READ_SCHEMA,
        name: 'reading',
        effort: 'medium',
      });
      if (!store.hasVoice(store.get(id) || rec) && !((data.voice || {}).summary || []).some(t => String(t).trim())) {
        throw new Error('That reading came back without a summary — nothing was stored; press again.');
      }
      const readId = 'rd_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
      const { rec: saved, added } = store.applyReading(id, data, { readId, model: by.model, samples: unread.map(x => x.i), refs });
      const said = [
        added.voice ? `${added.voice} new ${added.voice === 1 ? 'line' : 'lines'} in the voice` : 'nothing new in the voice',
        added.vocabulary ? `${added.vocabulary} ${added.vocabulary === 1 ? 'word' : 'words'} proposed` : '',
        added.phrases ? `${added.phrases} ${added.phrases === 1 ? 'phrase' : 'phrases'} proposed` : '',
        added.examples ? `${added.examples} new ${added.examples === 1 ? 'example' : 'examples'}` : '',
      ].filter(Boolean);
      job.state = 'done';
      job.step = said.join(' · ');
      job.added = added;
      job.model = by.model;
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

// ── the voice by hand (the owner's (д17): the app only adds, so a line is corrected or deleted here) ──

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

// ── the two sets: vocabulary and phrases ─────────────────────────────────────
// Rows typed by hand, cells corrected in place, examples added, an entry switched off (kept, not told to the writer)
// or deleted; proposals kept or dropped. EVERYTHING IS ENGLISH (the owner's (д4)): what is typed in another language
// is given its English equivalent by the agents' ladder (medium, cents) before it is stored, the original kept beside it.

const LIST_RE = ':list(vocabulary|phrases)';

// The fields of a typed entry, in English: as they are when they are, by one call when they are not.
async function _english(rec, list, fields) {
  const f = {
    text: String(fields.text || '').trim(), meaning: String(fields.meaning || '').trim(),
    when: String(fields.when || '').trim(), example: String(fields.example || '').trim(),
  };
  const foreign = Object.values(f).some(v => v && !AGENT.english(v));
  if (!foreign) return { ...fields, ...f, translated: false };
  const summary = ((rec.voice || {}).summary || []).map(l => l.text).join(' ');
  const { data } = await callLadder({
    system: P.ENTRY_ENGLISH_SYSTEM,
    user: P.entryEnglishUserPrompt({ list, entry: f, summary }),
    schema: P.ENTRY_ENGLISH_SCHEMA, name: 'entry', effort: 'medium',
  });
  const out = { ...fields };
  for (const k of ['text', 'meaning', 'when', 'example']) out[k] = f[k] ? String(data[k] || '').trim() || f[k] : '';
  // The original of the word itself, when it was typed in another language - and the example's, beside the example.
  if (f.text && !AGENT.english(f.text)) out.source = String(data.source || '').trim() || f.text;
  if (f.example && !AGENT.english(f.example)) out.exampleSource = f.example;
  for (const k of ['text', 'meaning', 'when', 'example']) {
    if (out[k] && !AGENT.english(out[k])) throw new Error('The agent did not give it in English - type it in English, or press again.');
  }
  return { ...out, translated: true };
}

const _entryOf = (rec, list, eid) => ((rec && rec[list]) || []).find(x => String(x.id) === String(eid)) || null;

router.post(`/narrators/:id/${LIST_RE}`, async (req, res) => {
  const { id, list } = req.params;
  const rec = store.get(id);
  if (!rec) return res.status(404).json({ success: false, error: 'no such narrator' });
  const b = req.body || {};
  if (!String(b.text || '').trim()) return res.status(400).json({ success: false, error: list === 'phrases' ? 'Type the phrase first.' : 'Type the word first.' });
  let fields;
  try { fields = await _english(rec, list, b); }
  catch (e) { return res.status(502).json({ success: false, error: e.message }); }
  try {
    const { rec: saved, entry } = store.addEntry(id, list, fields);
    res.json({ success: true, narrator: store.view(saved), entry, translated: fields.translated });
  } catch (e) { res.status(400).json({ success: false, error: e.message }); }
});

router.patch(`/narrators/:id/${LIST_RE}/:eid`, async (req, res) => {
  const { id, list, eid } = req.params;
  const rec = store.get(id);
  if (!rec) return res.status(404).json({ success: false, error: 'no such narrator' });
  const b = { ...(req.body || {}) };
  // A cell typed in another language is put into English too - the word's original kept when it is the word.
  const foreign = ['text', 'meaning', 'when'].filter(k => typeof b[k] === 'string' && b[k].trim() && !AGENT.english(b[k]));
  if (foreign.length) {
    const e = _entryOf(rec, list, eid) || {};
    try {
      const en = await _english(rec, list, { text: b.text != null ? b.text : e.text, meaning: b.meaning || '', when: b.when || '' });
      for (const k of foreign) b[k] = en[k];
      if (foreign.includes('text') && en.source) b.source = en.source;
    } catch (x) { return res.status(502).json({ success: false, error: x.message }); }
  }
  try { res.json({ success: true, narrator: store.view(store.editEntry(id, list, eid, b)) }); }
  catch (e) { res.status(400).json({ success: false, error: e.message }); }
});

router.delete(`/narrators/:id/${LIST_RE}/:eid`, (req, res) => {
  const { id, list, eid } = req.params;
  try { res.json({ success: true, narrator: store.view(store.removeEntry(id, list, eid)) }); }
  catch (e) { res.status(400).json({ success: false, error: e.message }); }
});

// An example, typed - in English, or put into it with its original kept beside it.
async function _example(rec, list, eid, text) {
  const t = String(text || '').trim();
  if (!t || AGENT.english(t)) return { text: t, source: undefined };
  const e = _entryOf(rec, list, eid) || {};
  const en = await _english(rec, list, { text: e.text || '', example: t });
  return { text: en.example, source: t };
}

router.post(`/narrators/:id/${LIST_RE}/:eid/examples`, async (req, res) => {
  const { id, list, eid } = req.params;
  const rec = store.get(id);
  if (!rec) return res.status(404).json({ success: false, error: 'no such narrator' });
  let ex;
  try { ex = await _example(rec, list, eid, (req.body || {}).text); }
  catch (e) { return res.status(502).json({ success: false, error: e.message }); }
  try { res.json({ success: true, narrator: store.view(store.addExample(id, list, eid, { text: ex.text, source: ex.source || '' })) }); }
  catch (e) { res.status(400).json({ success: false, error: e.message }); }
});

router.patch(`/narrators/:id/${LIST_RE}/:eid/examples/:i`, async (req, res) => {
  const { id, list, eid, i } = req.params;
  const rec = store.get(id);
  if (!rec) return res.status(404).json({ success: false, error: 'no such narrator' });
  let ex;
  try { ex = await _example(rec, list, eid, (req.body || {}).text); }
  catch (e) { return res.status(502).json({ success: false, error: e.message }); }
  try { res.json({ success: true, narrator: store.view(store.editExample(id, list, eid, i, ex)) }); }
  catch (e) { res.status(400).json({ success: false, error: e.message }); }
});

router.delete(`/narrators/:id/${LIST_RE}/:eid/examples/:i`, (req, res) => {
  const { id, list, eid, i } = req.params;
  try { res.json({ success: true, narrator: store.view(store.removeExample(id, list, eid, i)) }); }
  catch (e) { res.status(400).json({ success: false, error: e.message }); }
});

// A proposal kept or dropped; `pid` 'all' does it to every proposal of that list ("keep all").
router.post(`/narrators/:id/pending/${LIST_RE}/:pid/:act(keep|drop)`, (req, res) => {
  const { id, list, pid, act } = req.params;
  try {
    const saved = act === 'keep' ? store.keepPending(id, list, pid) : store.dropPending(id, list, pid);
    res.json({ success: true, narrator: store.view(saved) });
  } catch (e) { res.status(400).json({ success: false, error: e.message }); }
});

module.exports = router;
