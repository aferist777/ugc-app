'use strict';

// ════════════════════════════════════════════════════════════════════════════
// SOURCES — bring a long video in, get its words out.
//
//   GET    /api/sources                  -> { sources: [summary + progress] }
//   GET    /api/sources/:id              -> { source, transcriptChars }
//   POST   /api/sources/upload           multipart file -> { jobId, source }
//   POST   /api/sources/link             { url } -> { jobId }   (any site yt-dlp reads, no login)
//   POST   /api/sources/:id/transcribe   -> { jobId } | { alertId } (its way in is retried - phase V28.1)
//   POST   /api/sources/:id/topics       -> { jobId } | { alertId }   409 with the running job while one runs
//   DELETE /api/sources/:id              -> { success, removed, draftsDetached }
//   GET    /api/sources/jobs/:jobId      -> { state, step, error, source }
//
// ADDING ONE (phase V28.1, lib/source-intake.js - the frame decides, the whole way in is an Alerts row):
//   POST   /api/sources/add/link         { url, mineWith } -> { read }
//   POST   /api/sources/add/file         { path, title, mineWith } -> { read }   (the app's window hands the path over)
//   GET    /api/sources/add              -> { asks: [read] }     the questions still waiting
//   GET    /api/sources/add/:id          -> { read }             reading | ask | source | uploads | audio | error | dropped
//   POST   /api/sources/add/:id/answer   { as: source | uploads | drop } -> { read }
//   POST   /api/sources/:id/stop         the cross on a source being added
//   POST   /api/sources/:id/to-uploads   a source with nothing to write from -> onto Uploads in Media
//
// WHAT RUNS IS SAID (phase E5): a source being read is 'stored' / 'downloading' / 'transcribing'
// in its record, and finding its topics is `job` on it - so a page opened later shows the wait
// instead of offering to pay again, and a second start is refused. A restart ends every job, so
// the records it left mid-way are marked 'interrupted' when the server starts, with the file kept
// for "transcribe again".
//
// Ingest is one job with three visible steps - stored, poster, transcript - because that is
// how it fails: the copy succeeds, the poster is cheap, and the transcription is the minutes-
// long part that can come back with nothing. Each step reports before it starts, so a stall
// says which one is stalling.
//
// The video is kept whole. The transcript is what everything downstream reads, but the file
// stays so frames and fragments can be cut from it later without fetching it again.
// ════════════════════════════════════════════════════════════════════════════

const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');

const store = require('../lib/sources-store');
const STT = require('../lib/stt-replicate');
const YTDLP = require('../lib/ytdlp');
const DRAFTS = require('../lib/script-drafts');
const INTAKE = require('../lib/source-intake');

const router = express.Router();

// Being read right now: states only a running job leaves behind (waiting and copying: a source being added).
const LIVE = new Set(['waiting', 'downloading', 'copying', 'stored', 'transcribing']);

// Topics being found, per source: id -> { kind: 'topics', jobId, startedAt }.
const _mining = new Map();
const _withJob = (rec) => (_mining.has(String(rec.id)) ? { ...rec, job: _mining.get(String(rec.id)) } : rec);

// When the server starts, no job is running - so a record still saying it is being read was cut
// off by the app closing. It says so, and keeps its file for "transcribe again".
//
// A failed source whose transcript still says 'running' (a link that failed while being read, from
// before its catch set the transcript too) is repaired here as well: the page would keep calling it
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
        error: 'interrupted - the app was closed while this was being ' + (s.state === 'downloading' ? 'downloaded' : 'read'),
        transcript: t.state === 'ready' ? t : { ...t, state: 'error' },
      });
    }
  } catch (e) { console.warn('[sources] could not mark the interrupted sources:', e.message); }
}
_markInterrupted();

const VIDEO_RE = /\.(mp4|mov|webm|mkv|m4v|avi|mp3|m4a|wav|aac|ogg)$/i;

// Straight into uploads/sources under the source's own id: the original name goes in the
// record, not on disk, so a file called "видео (1).mp4" cannot produce a path that some later
// tool mis-quotes. The extension is kept because ffmpeg reads the container by it.
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => { store.ensureDirs(); cb(null, store.SOURCES_DIR); },
    filename: (req, file, cb) => {
      const ext = (path.extname(file.originalname || '') || '.mp4').toLowerCase();
      req._srcId = req._srcId || store.newId();
      cb(null, req._srcId + ext);
    },
  }),
  limits: { fileSize: 8 * 1024 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!VIDEO_RE.test(file.originalname || '')) {
      return cb(new Error('Not a video or audio file: ' + (file.originalname || '')));
    }
    cb(null, true);
  },
});

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

// A multipart filename arrives as raw bytes, and busboy hands them over decoded as latin-1. A
// Russian name therefore lands as "ÐÐ°Ð»Ð¾Ð³_Ð½Ð°_Ð¶Ð¸Ð·Ð½Ñ" and follows the source onto its card,
// its spine and every scenario written from it. Re-reading those bytes as UTF-8 gets the name
// back; when they are not UTF-8 the round trip produces replacement characters, and then the
// original string was right to begin with.
function _utf8Name(name) {
  const s = String(name || '');
  if (!s) return '';
  const back = Buffer.from(s, 'latin1').toString('utf8');
  return back.includes('�') ? s : back;
}

router.get('/sources', (_req, res) => {
  try {
    // A source being added carries how far along it is (phase V28.1) - the Sources column draws its bar from it.
    const sources = store.summaries().map(_withJob).map(x => (INTAKE.live(x.id) ? { ...x, progress: INTAKE.progress(x.id) } : x));
    res.json({ success: true, sources, maxChars: store.MAX_TRANSCRIPT_CHARS });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.get('/sources/jobs/:jobId', (req, res) => {
  _sweep();
  const job = _jobs[String(req.params.jobId)];
  if (!job) return res.status(404).json({ success: false, error: 'no such job' });
  res.json({ success: true, ...job });
});

// ── adding one (phase V28.1) ───────────────────────────────────────────────
const _mineOf = (b) => (b && typeof b.mineWith === 'object' ? b.mineWith : {});

router.post('/sources/add/link', async (req, res) => {
  const url = String((req.body || {}).url || '').trim();
  if (!url) return res.status(400).json({ success: false, error: 'a link is required' });
  if (!/^https?:\/\//i.test(url)) return res.status(400).json({ success: false, error: 'that is not a URL' });
  if (!(await YTDLP.find())) return res.status(501).json({ success: false, error: YTDLP.MISSING });
  res.json({ success: true, read: INTAKE.addLink({ url, mineWith: _mineOf(req.body) }) });
});

router.post('/sources/add/file', (req, res) => {
  const b = req.body || {};
  if (!b.path) return res.status(400).json({ success: false, error: 'adding a file works in the app\'s own window - it hands the file over' });
  res.json({ success: true, read: INTAKE.addFile({ path: String(b.path), title: b.title, mineWith: _mineOf(b) }) });
});

router.get('/sources/add', (_req, res) => res.json({ success: true, asks: INTAKE.asks() }));

router.get('/sources/add/:readId', (req, res) => {
  const r = INTAKE.read(req.params.readId);
  if (!r) return res.status(404).json({ success: false, error: 'no such read - add it again' });
  res.json({ success: true, read: r });
});

router.post('/sources/add/:readId/answer', (req, res) => {
  try { res.json({ success: true, read: INTAKE.answer(req.params.readId, String((req.body || {}).as || '')) }); }
  catch (e) { res.status(e.status || 500).json({ success: false, error: e.message }); }
});

router.post('/sources/:id/stop', (req, res) => {
  if (!INTAKE.stop(req.params.id)) return res.status(409).json({ success: false, error: 'it is not being added' });
  res.json({ success: true });
});

router.post('/sources/:id/to-uploads', async (req, res) => {
  try { res.json({ success: true, ...(await INTAKE.toUploads(req.params.id)) }); }
  catch (e) { res.status(e.status || 500).json({ success: false, error: e.message }); }
});

router.get('/sources/:id', (req, res) => {
  const rec = store.get(req.params.id);
  if (!rec) return res.status(404).json({ success: false, error: 'no such source' });
  res.json({ success: true, source: _withJob(rec) });
});

// ── ingest ──────────────────────────────────────────────────────────────────

router.post('/sources/upload', (req, res) => {
  upload.single('file')(req, res, async (err) => {
    if (err) return res.status(400).json({ success: false, error: err.message });
    if (!req.file) return res.status(400).json({ success: false, error: 'no file' });

    const id = req._srcId;
    const videoPath = `${store.SOURCES_URL}/${path.basename(req.file.path)}`;
    let seconds = 0;
    try { seconds = await STT.probeDuration(req.file.path); }
    catch (e) {
      // Unreadable now means unreadable later: refused here, with the file removed, rather
      // than kept as a row that can never be transcribed.
      try { fs.unlinkSync(req.file.path); } catch (e2) {}
      return res.status(400).json({ success: false, error: e.message });
    }

    const name = _utf8Name(req.file.originalname) || id;
    const rec = store.create({
      id, kind: 'file', title: req.body && req.body.title ? String(req.body.title).slice(0, 200) : name,
      originalName: name, videoPath, seconds,
      bytes: req.file.size || 0, state: 'stored',
    });

    const jobId = _newJobId();
    const job = _jobs[jobId] = { state: 'running', step: 'stored', at: Date.now(), error: null, source: null, sourceId: id };
    res.json({ success: true, jobId, source: store.summary(rec) });

    (async () => {
      try {
        const saved = await _process(id, job);
        job.state = 'done';
        job.step = `${saved.transcript.cues} cues, ${Math.round(saved.transcript.chars / 1000)}k chars`;
        job.source = store.summary(saved);
        job.at = Date.now();
      } catch (e) {
        store.update(id, { state: 'error', error: e.message, transcript: { state: 'error' } });
        job.state = 'error';
        job.error = e.message;
        job.source = store.summary(store.get(id) || {});
        job.at = Date.now();
      }
    })();
  });
});

// A link becomes a source the same way a file does, with two steps in front: read the metadata,
// then fetch the video. The metadata comes first on purpose - it is seconds, it catches a
// playlist, a private video and the bot check, and none of those should leave a half-made
// record behind.
router.post('/sources/link', async (req, res) => {
  const url = String((req.body || {}).url || '').trim();
  if (!url) return res.status(400).json({ success: false, error: 'a link is required' });
  if (!/^https?:\/\//i.test(url)) return res.status(400).json({ success: false, error: 'that is not a URL' });
  if (!(await YTDLP.find())) return res.status(501).json({ success: false, error: YTDLP.MISSING });
  // (phase V27) NO LOGIN: the cookie jar and the lock it was behind are gone (the owner 2026-10-12).
  // A video the site keeps for signed-in people is refused in words by lib/ytdlp.js.

  const jobId = _newJobId();
  const job = _jobs[jobId] = { state: 'running', step: 'reading the link', at: Date.now(), error: null, source: null };
  res.json({ success: true, jobId });

  (async () => {
    let id = null;
    try {
      const meta = await YTDLP.info(url, { onProgress: (s) => { job.step = s; } });
      // The same video under another spelling of its address is not fetched twice - one whose file
      // came in is read again with "transcribe again"; one that failed before its file did is fetched.
      const had = store.list().find(s => s.videoPath
        && ((meta.key && s.linkKey === meta.key) || (s.url && s.url === meta.url)));
      if (had) throw new Error(`This video is a source already: "${had.title || had.id}".`);
      id = store.newId();
      store.ensureDirs();
      // kind 'youtube' is any link: the records made before other sites were let in say so.
      const rec = store.create({
        id, kind: 'youtube', title: meta.label, url: meta.url, linkKey: meta.key, channel: meta.channel,
        seconds: meta.duration, state: 'downloading',
      });
      job.source = store.summary(rec);
      job.sourceId = id;

      job.step = 'starting the download';
      // The best there is (the owner's answer (g)); a post of several videos gives its first.
      await YTDLP.download(url, path.join(store.SOURCES_DIR, id + '.%(ext)s'),
        { onProgress: (s) => { job.step = s; }, items: meta.count > 1 ? '1' : '' });

      // yt-dlp names the file by the template, but the extension depends on what it merged, so
      // the file is found rather than assumed.
      const landed = fs.readdirSync(store.SOURCES_DIR)
        .filter(f => f.startsWith(id + '.') && VIDEO_RE.test(f))
        .sort((a, b) => fs.statSync(path.join(store.SOURCES_DIR, b)).size - fs.statSync(path.join(store.SOURCES_DIR, a)).size)[0];
      if (!landed) throw new Error('The download finished but left no file behind.');

      const abs = path.join(store.SOURCES_DIR, landed);
      const seconds = await STT.probeDuration(abs).catch(() => rec.seconds || 0);
      store.update(id, {
        videoPath: `${store.SOURCES_URL}/${landed}`,
        bytes: fs.statSync(abs).size,
        seconds,
        state: 'stored',
      });

      const saved = await _process(id, job);
      job.state = 'done';
      job.step = `${saved.transcript.cues} cues, ${Math.round(saved.transcript.chars / 1000)}k chars`;
      job.source = store.summary(saved);
      job.at = Date.now();
    } catch (e) {
      if (id) {
        // The transcript too, as the upload and transcribe catches do: left 'running', the source
        // would read as still being read, with no way to read it again.
        const cur = store.get(id) || {};
        const t = cur.transcript || null;
        store.update(id, { state: 'error', error: e.message,
          transcript: t && t.state === 'ready' ? t : { ...(t || {}), state: 'error' } });
      }
      job.state = 'error';
      job.error = e.message;
      job.botCheck = !!e.botCheck;
      job.source = id ? store.summary(store.get(id) || {}) : null;
      job.at = Date.now();
    }
  })();
});

router.post('/sources/:id/transcribe', async (req, res) => {
  const id = String(req.params.id);
  const rec = store.get(id);
  if (!rec) return res.status(404).json({ success: false, error: 'no such source' });
  if (!rec.videoPath) return res.status(400).json({ success: false, error: 'this source has no file' });
  if (LIVE.has(rec.state) || INTAKE.live(id)) return res.status(409).json({ success: false, error: 'this source is being read already' });
  // Its way in was cut off or failed (phase V28.1): the same retry as its row in Alerts - one piece of work, not two.
  try {
    const alertId = await INTAKE.retryOf(id);
    if (alertId) return res.json({ success: true, alertId });
  } catch (e) { return res.status(409).json({ success: false, error: e.message }); }

  const jobId = _newJobId();
  const job = _jobs[jobId] = { state: 'running', step: 'starting', at: Date.now(), error: null, source: null, sourceId: id };
  // Marked at once, not when _process gets to it: a second press in between would start a second read.
  store.update(id, { state: 'transcribing', error: '' });
  res.json({ success: true, jobId });

  (async () => {
    try {
      const saved = await _process(id, job);
      // Read again and no topics yet: they are found now, on the generator's model the press sent (phase V28.1).
      if (!(saved.topics || []).length) _startMining(id, req.body || {});
      job.state = 'done';
      job.step = `${saved.transcript.cues} cues, ${Math.round(saved.transcript.chars / 1000)}k chars`;
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
  if (!rec) return res.status(404).json({ success: false, error: 'no such source' });
  const t = store.readTranscript(id);
  if (!t || !Array.isArray(t.cues) || !t.cues.length) {
    return res.status(400).json({ success: false, error: 'this source has no transcript yet' });
  }
  if (INTAKE.live(id)) return res.status(409).json({ success: false, error: 'this source is being added - its topics come with it' });
  const busy = _mining.get(id);
  if (busy && _jobs[busy.jobId] && _jobs[busy.jobId].state === 'running') {
    return res.status(409).json({ success: false, error: 'the topics of this source are being found already', ...busy });
  }
  // Its way in was cut off while the topics were found (phase V28.1): the row's retry.
  try {
    const alertId = await INTAKE.retryOf(id);
    if (alertId) return res.json({ success: true, alertId });
  } catch (e) { return res.status(409).json({ success: false, error: e.message }); }
  res.json({ success: true, jobId: _startMining(id, req.body || {}) });
});

// A job finding the topics, on the generator's model (`body`: provider, model, effort) - the button's, or after a
// transcription read again. Answers its id.
function _startMining(id, body) {
  const jobId = _newJobId();
  const job = _jobs[jobId] = { state: 'running', step: 'reading the transcript', at: Date.now(), error: null, sourceId: id };
  _mining.set(id, { kind: 'topics', jobId, startedAt: job.at });
  (async () => {
    try {
      const { found, topics, saved } = await INTAKE.mineSource(id, { mineWith: body, onStep: (st) => { job.step = st; } });
      job.state = 'done';
      job.step = `${found.topics.length} topics from ${found.blocks} blocks`;
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
    if (!title) return res.status(400).json({ success: false, error: 'a name is required' });
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
    if (!rec) return res.status(404).json({ success: false, error: 'no such source' });
    if (LIVE.has(rec.state) || _mining.has(id) || INTAKE.live(id)) {
      return res.status(409).json({ success: false, error: 'this source is being read - delete it when that has finished' });
    }
    // The scenarios written from it keep the name it has now, not the one it had when they were saved.
    try { require('./scen3').keepSourceTitle(id, rec.title || rec.originalName || ''); } catch (e) { /* a name, not the delete */ }
    const removed = store.remove(id);
    let draftsDetached = 0;
    try { draftsDetached = DRAFTS.detachSource(id); } catch (e) { /* the source is gone either way */ }
    res.json({ success: true, removed, draftsDetached });
  } catch (e) { res.status(404).json({ success: false, error: e.message }); }
});

module.exports = router;
