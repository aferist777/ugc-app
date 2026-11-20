'use strict';

// ════════════════════════════════════════════════════════════════════════════
// SOURCES — bring a long video in, get its words out.
//
//   GET    /api/sources                  -> { sources: [summary + progress] }
//   GET    /api/sources/:id              -> { source }
//   POST   /api/sources/:id/transcribe   -> { jobId } | { alertId } (its way in is retried)
//   POST   /api/sources/:id/topics       -> { jobId } | { alertId }   409 with the running job while one runs
//   DELETE /api/sources/:id              -> { success, removed, draftsDetached }   ?keepWords=1: its transcripts stay
//   GET    /api/sources/:id/video        the video of a source that stays on the disk - by its id, never a path
//   POST   /api/sources/:id/relink       { path } the same video pointed at again where it lies now
//   GET    /api/sources/jobs/:jobId      -> { state, step, error, source }
//
// ADDING ONE (lib/source-intake.js - the frame decides, the whole way in is an Alerts row):
//   POST   /api/sources/add/link         { url } -> { read }    (a `mineWith` in the body is not read)
//   POST   /api/sources/add/file         { path, title } -> { read }   (the app's window hands the path over)
//   GET    /api/sources/add              -> { asks: [read] }     the questions still waiting
//   GET    /api/sources/add/:id          -> { read }             reading | ask | source | uploads | audio | error | dropped
//   POST   /api/sources/add/:id/answer   { as: source | uploads | drop } -> { read }
//   POST   /api/sources/:id/stop         the cross on a source being added
//   POST   /api/sources/:id/to-uploads   a source with nothing to write from -> onto Uploads in Media
//
// WHAT RUNS IS SAID: a source being read is 'stored' / 'downloading' / 'transcribing'
// in its record, and finding its topics is `job` on it - so a page opened later shows the wait
// instead of offering to pay again, and a second start is refused. A restart ends every job, so
// the records it left mid-way are marked 'interrupted' when the server starts, with the file kept
// for "transcribe again".
//
// Reading a source - on its way in (lib/source-intake.js) or "transcribe again" here - is three visible steps -
// stored, poster, transcript - because that is
// how it fails: the copy succeeds, the poster is cheap, and the transcription is the minutes-
// long part that can come back with nothing. Each step reports before it starts, so a stall
// says which one is stalling.
//
// The video is kept whole. The transcript is what everything downstream reads, but the file
// stays so frames and fragments can be cut from it later without fetching it again.
// ════════════════════════════════════════════════════════════════════════════

const express = require('express');
const path = require('path');
const fs = require('fs');

const store = require('../lib/sources-store');
const YTDLP = require('../lib/ytdlp');
const DRAFTS = require('../lib/script-drafts');
const INTAKE = require('../lib/source-intake');
const I18N = require('../lib/i18n');

const router = express.Router();

// Being read right now: states only a running job leaves behind (waiting and copying: a source being added).
const LIVE = new Set(['waiting', 'downloading', 'copying', 'stored', 'transcribing']);

// Topics being found, per source: id -> { kind: 'topics', jobId, startedAt }.
const _mining = new Map();
const _withJob = (rec) => (_mining.has(String(rec.id)) ? { ...rec, job: _mining.get(String(rec.id)) } : rec);

// When the server starts, no job is running - so a record still saying it is being read was cut
// off by the app closing. It says so, and keeps its file for "transcribe again".
//
// A failed source whose transcript still says 'running' (left so by an older program) is repaired
// here as well: the page would keep calling it
// "being read" and never offer to read it again.
function _markInterrupted() {
  // A source cut off on its way in says so first, in its own words, and waits for its retry (lib/source-intake.js).
  INTAKE.boot();
  try {
    for (const s of store.list()) {
      const t = s.transcript || {};
      if (s.state === 'error' && t.state === 'running') { store.update(s.id, { transcript: { ...t, state: 'error' } }); continue; }
      if (!LIVE.has(s.state)) continue;
      store.update(s.id, {
        state: 'error',
        error: s.state === 'downloading' ? I18N.t('interrupted - the app was closed while this was being downloaded')
          : I18N.t('interrupted - the app was closed while this was being read'),
        errorCode: 'interrupted',
        transcript: t.state === 'ready' ? t : { ...t, state: 'error' },
      });
    }
  } catch (e) { console.warn('[sources] could not mark the interrupted sources:', e.message); }
}
_markInterrupted();

const _jobs = {};
const _newJobId = () => 'sj_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

function _sweep() {
  const cutoff = Date.now() - 3600000;
  for (const [id, job] of Object.entries(_jobs)) {
    if (job.state !== 'running' && (job.at || 0) < cutoff) delete _jobs[id];
  }
}

// The poster and the transcript, in that order, with the record updated after each - shared with a source being
// added (lib/source-intake.js processSource). The job says each step before it starts.
async function _process(id, job) {
  const { saved, warning } = await INTAKE.processSource(id, { onStep: (st) => { job.step = st; } });
  if (warning) job.warning = warning;
  return saved;
}

// ── reading ─────────────────────────────────────────────────────────────────

router.get('/sources', (_req, res) => {
  try {
    // A source being added carries how far along it is - the Sources column draws its bar from it.
    const sources = store.summaries().map(_withJob).map(x => (INTAKE.live(x.id) ? { ...x, progress: INTAKE.progress(x.id) } : x));
    res.json({ success: true, sources, maxChars: store.MAX_TRANSCRIPT_CHARS });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.get('/sources/jobs/:jobId', (req, res) => {
  _sweep();
  const job = _jobs[String(req.params.jobId)];
  if (!job) return res.status(404).json({ success: false, error: I18N.t('no such job') });
  res.json({ success: true, ...job });
});

// ── adding one ──────────────────────────────────────────────────────────────
const _mineOf = (b) => (b && typeof b.mineWith === 'object' ? b.mineWith : {});

router.post('/sources/add/link', async (req, res) => {
  const url = String((req.body || {}).url || '').trim();
  if (!url) return res.status(400).json({ success: false, error: I18N.t('a link is required') });
  if (!/^https?:\/\//i.test(url)) return res.status(400).json({ success: false, error: I18N.t('that is not a URL') });
  if (!(await YTDLP.find())) return res.status(501).json({ success: false, error: YTDLP.MISSING });
  res.json({ success: true, read: INTAKE.addLink({ url, mineWith: _mineOf(req.body) }) });
});

router.post('/sources/add/file', (req, res) => {
  const b = req.body || {};
  if (!b.path) return res.status(400).json({ success: false, error: I18N.t('adding a file works in the app\'s own window - it hands the file over') });
  res.json({ success: true, read: INTAKE.addFile({ path: String(b.path), title: b.title, mineWith: _mineOf(b) }) });
});

router.get('/sources/add', (_req, res) => res.json({ success: true, asks: INTAKE.asks() }));

router.get('/sources/add/:readId', (req, res) => {
  const r = INTAKE.read(req.params.readId);
  if (!r) return res.status(404).json({ success: false, error: I18N.t('no such read - add it again') });
  res.json({ success: true, read: r });
});

router.post('/sources/add/:readId/answer', (req, res) => {
  try { res.json({ success: true, read: INTAKE.answer(req.params.readId, String((req.body || {}).as || '')) }); }
  catch (e) { res.status(e.status || 500).json({ success: false, error: e.message }); }
});

router.post('/sources/:id/stop', (req, res) => {
  if (!INTAKE.stop(req.params.id)) return res.status(409).json({ success: false, error: I18N.t('it is not being added') });
  res.json({ success: true });
});

router.post('/sources/:id/to-uploads', async (req, res) => {
  try { res.json({ success: true, ...(await INTAKE.toUploads(req.params.id)) }); }
  catch (e) { res.status(e.status || 500).json({ success: false, error: e.message }); }
});

router.get('/sources/:id', (req, res) => {
  const rec = store.get(req.params.id);
  if (!rec) return res.status(404).json({ success: false, error: I18N.t('no such source') });
  res.json({ success: true, source: _withJob(rec) });
});

// ── reading again ───────────────────────────────────────────────────────────
// A source comes in through POST /sources/add/* (lib/source-intake.js).

// ── A video that stays on the disk ──────────────────────────────────────────
// Played by the source's id: the path is the record's, never the request's (the app only reads that file).
router.get('/sources/:id/video', (req, res) => {
  const rec = store.get(req.params.id);
  if (!rec || !rec.diskPath) return res.status(404).end();
  if (!fs.existsSync(rec.diskPath)) return res.status(410).json({ success: false, error: I18N.t('The video is not where it was: {path}', { path: rec.diskPath }), missing: true });
  res.sendFile(path.resolve(rec.diskPath), { acceptRanges: true, dotfiles: 'allow' });
});
// The same video pointed at again where it lies now: its print must be the source's (the same file, moved or renamed) -
// its words are its own then, and nothing is heard again.
router.post('/sources/:id/relink', (req, res) => {
  try {
    const rec = store.get(req.params.id);
    if (!rec || !rec.diskPath) return res.status(404).json({ success: false, error: I18N.t('no such source on the disk') });
    const abs = String((req.body || {}).path || '');
    if (!abs || !path.isAbsolute(abs)) return res.status(400).json({ success: false, error: I18N.t('pointing at a file works in the app\'s own window - it hands the file over') });
    let st = null;
    try { st = fs.statSync(abs); } catch (e) { st = null; }
    if (!st || !st.isFile()) return res.status(400).json({ success: false, error: I18N.t('That file is not there.') });
    const print = store.printOf(abs);
    if (rec.diskPrint && print !== rec.diskPrint) {
      return res.status(409).json({ success: false, error: I18N.t('This is not the same video - its size or its content differ. Point at the very file, moved or renamed.') });
    }
    const other = store.findOnDisk(abs, '');
    if (other && String(other.id) !== String(rec.id)) return res.status(409).json({ success: false, error: I18N.t('That file is the video of another source ("{title}").', { title: other.title || other.id }) });
    const saved = store.update(rec.id, { diskPath: abs, diskPrint: print || rec.diskPrint || '' });
    res.json({ success: true, source: store.summary(saved) });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/sources/:id/transcribe', async (req, res) => {
  const id = String(req.params.id);
  const rec = store.get(id);
  if (!rec) return res.status(404).json({ success: false, error: I18N.t('no such source') });
  // Its file, in the library or where it stays on the disk.
  if (!store.fileOf(rec)) return res.status(400).json({ success: false, error: rec.diskPath ? I18N.t('The video is not where it was: {path}', { path: rec.diskPath }) : I18N.t('this source has no file') });
  if (LIVE.has(rec.state) || INTAKE.live(id)) return res.status(409).json({ success: false, error: I18N.t('this source is being read already') });
  // Its way in was cut off or failed: the same retry as its row in Alerts - one piece of work, not two.
  try {
    const alertId = await INTAKE.retryOf(id);
    if (alertId) return res.json({ success: true, alertId });
  } catch (e) { return res.status(409).json({ success: false, error: e.message }); }

  const jobId = _newJobId();
  const job = _jobs[jobId] = { state: 'running', step: I18N.t('starting'), at: Date.now(), error: null, source: null, sourceId: id };
  // Marked at once, not when _process gets to it: a second press in between would start a second read.
  store.update(id, { state: 'transcribing', error: '' });
  res.json({ success: true, jobId });

  (async () => {
    try {
      const saved = await _process(id, job);
      // Read again and no topics yet: they are found now, by the agents' ladder.
      if (!(saved.topics || []).length) _startMining(id);
      job.state = 'done';
      job.step = I18N.t('{cues} cues, {chars}k chars', { cues: saved.transcript.cues, chars: Math.round(saved.transcript.chars / 1000) });
      job.source = store.summary(store.get(id) || saved);
      job.at = Date.now();
    } catch (e) {
      store.update(id, { state: 'error', error: e.message, transcript: { state: 'error' } });
      job.state = 'error';
      job.error = e.message;
      job.at = Date.now();
    }
  })();
});

// ── topics ──────────────────────────────────────────────────────────────────
// Mining REPLACES whatever was found before. Topics are a reading of the transcript, not user
// data, and merging two readings would leave overlapping spans - which is the one thing the
// prompt is told never to produce.
router.post('/sources/:id/topics', async (req, res) => {
  const id = String(req.params.id);
  const rec = store.get(id);
  if (!rec) return res.status(404).json({ success: false, error: I18N.t('no such source') });
  const t = store.readTranscript(id);
  if (!t || !Array.isArray(t.cues) || !t.cues.length) {
    return res.status(400).json({ success: false, error: I18N.t('this source has no transcript yet') });
  }
  if (INTAKE.live(id)) return res.status(409).json({ success: false, error: I18N.t('this source is being added - its topics come with it') });
  const busy = _mining.get(id);
  if (busy && _jobs[busy.jobId] && _jobs[busy.jobId].state === 'running') {
    return res.status(409).json({ success: false, error: I18N.t('the topics of this source are being found already'), ...busy });
  }
  // Its way in was cut off while the topics were found: the row's retry.
  try {
    const alertId = await INTAKE.retryOf(id);
    if (alertId) return res.json({ success: true, alertId });
  } catch (e) { return res.status(409).json({ success: false, error: e.message }); }
  res.json({ success: true, jobId: _startMining(id) });
});

// A job finding the topics, by the agents' ladder - the button's, or after a transcription read again.
// Answers its id.
function _startMining(id) {
  const jobId = _newJobId();
  const job = _jobs[jobId] = { state: 'running', step: I18N.t('reading the transcript'), at: Date.now(), error: null, sourceId: id };
  _mining.set(id, { kind: 'topics', jobId, startedAt: job.at });
  (async () => {
    try {
      const { found, topics, saved } = await INTAKE.mineSource(id, { onStep: (st) => { job.step = st; } });
      job.state = 'done';
      job.step = I18N.t('{n} topics from {blocks} blocks', { n: found.topics.length, blocks: found.blocks });
      job.topics = topics.map(x => ({ id: x.id, title: x.title, start: x.start, end: x.end }));
      job.videoSummary = found.videoSummary;
      job.source = store.summary(saved);
      job.at = Date.now();
    } catch (e) {
      job.state = 'error';
      job.error = e.message;
      job.at = Date.now();
    } finally {
      if (_mining.get(id) && _mining.get(id).jobId === jobId) _mining.delete(id);
    }
  })();
  return jobId;
}

// A source's name is the one thing about it worth editing by hand. An uploaded file arrives
// called VYezBnDFAmU7VBRQr7BO+fo7Uw1E7MHA.mp4, and that string then follows it onto the card, the
// spine and every scenario written from it.
router.patch('/sources/:id', (req, res) => {
  try {
    const title = String((req.body || {}).title || '').trim();
    if (!title) return res.status(400).json({ success: false, error: I18N.t('a name is required') });
    const rec = store.update(req.params.id, { title: title.slice(0, 200) });
    res.json({ success: true, source: store.summary(rec) });
  } catch (e) { res.status(404).json({ success: false, error: e.message }); }
});

// Not while it is being read: the file is open (Windows will not delete it) and the job would write
// into a record that is gone. Its drafts are kept, without a source.
router.delete('/sources/:id', (req, res) => {
  try {
    const id = String(req.params.id);
    const rec = store.get(id);
    if (!rec) return res.status(404).json({ success: false, error: I18N.t('no such source') });
    if (LIVE.has(rec.state) || _mining.has(id) || INTAKE.live(id)) {
      return res.status(409).json({ success: false, error: I18N.t('this source is being read - delete it when that has finished') });
    }
    // The scenarios written from it keep the name it has now, not the one it had when they were saved.
    try { require('./scen3').keepSourceTitle(id, rec.title || rec.originalName || ''); } catch (e) { /* a name, not the delete */ }
    // A source whose video stays on the disk: its file is never touched; `keepWords` keeps its transcripts
    // for the same file added again.
    const removed = store.remove(id, { keepWords: String(req.query.keepWords || '') === '1' });
    let draftsDetached = 0;
    try { draftsDetached = DRAFTS.detachSource(id); } catch (e) { /* the source is gone either way */ }
    res.json({ success: true, removed, draftsDetached });
  } catch (e) { res.status(404).json({ success: false, error: e.message }); }
});

module.exports = router;
