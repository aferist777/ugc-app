'use strict';

// ════════════════════════════════════════════════════════════════════════════
// SOURCES — bring a long video in, get its words out.
//
//   GET    /api/sources                  -> { sources: [summary] }
//   GET    /api/sources/:id              -> { source, transcriptChars }
//   GET    /api/sources/:id/transcript   -> { cues, chars, model }
//   POST   /api/sources/upload           multipart file -> { jobId, source }
//   POST   /api/sources/:id/transcribe   -> { jobId }
//   POST   /api/sources/:id/topics       -> { jobId }   409 with the running job while one runs
//   DELETE /api/sources/:id              -> { success, removed, draftsDetached }
//   GET    /api/sources/jobs/:jobId      -> { state, step, error, source }
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
const os = require('os');
const path = require('path');
const multer = require('multer');

const store = require('../lib/sources-store');
const STT = require('../lib/stt-replicate');
const VT = require('../lib/video-thumb');
const YTDLP = require('../lib/ytdlp');
const COOKIES = require('../lib/yt-cookies');
const TOPICS = require('../lib/writing-topics');
const DRAFTS = require('../lib/script-drafts');

const router = express.Router();

// Being read right now: states only a running job leaves behind.
const LIVE = new Set(['stored', 'downloading', 'transcribing']);

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

// The cookie export is a small text file; it goes to temp, is read once and deleted. It never
// lands in uploads/ - that directory is served.
const cookieUpload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: COOKIES.MAX_BYTES },
});

const _jobs = {};
const _newJobId = () => 'sj_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

function _sweep() {
  const cutoff = Date.now() - 3600000;
  for (const [id, job] of Object.entries(_jobs)) {
    if (job.state !== 'running' && (job.at || 0) < cutoff) delete _jobs[id];
  }
}

// The poster and the transcript, in that order, with the record updated after each. Shared by
// ingest and by an explicit re-transcribe.
async function _process(id, job, { poster = true } = {}) {
  const rec = store.get(id);
  if (!rec) throw new Error('the source went away');

  if (poster && rec.videoPath) {
    job.step = 'making the poster';
    try {
      const at = store.posterAt(rec.seconds);
      const t = await VT.makeThumb(rec.videoPath, { at });
      store.update(id, { thumbPath: t.thumb });
      job.posterAt = Math.round(at);
    } catch (e) {
      // A missing poster is a grey card, not a broken source. The words are the point.
      job.posterError = e.message;
    }
  }

  job.step = 'extracting audio';
  store.update(id, { state: 'transcribing', transcript: { state: 'running' } });
  const abs = path.join(require('../lib/config').ROOT_DIR, String(rec.videoPath).replace(/^\/+/, ''));
  const out = await STT.transcribeFile(abs, { onProgress: (s) => { job.step = s; } });

  job.step = 'storing the transcript';
  const chars = out.cues.reduce((n, c) => n + c.text.length + 1, 0);
  store.writeTranscript(id, {
    cues: out.cues, model: out.model, seconds: out.seconds, cost: out.cost, at: new Date().toISOString(),
  });
  const saved = store.update(id, {
    state: 'ready',
    seconds: rec.seconds || out.sourceSeconds || 0,
    transcript: {
      state: 'ready', cues: out.cues.length, chars,
      model: out.model, cost: out.cost, seconds: out.seconds,
    },
  });
  // Said plainly rather than discovered later by the topics call, which would fail with a
  // token error instead of a sentence.
  if (chars > store.MAX_TRANSCRIPT_CHARS) {
    job.warning = `This transcript is ${Math.round(chars / 1000)}k characters — too long for one `
      + 'topics pass. Mining will refuse it; a shorter source works.';
  }
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
    res.json({ success: true, sources: store.summaries().map(_withJob), maxChars: store.MAX_TRANSCRIPT_CHARS });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.get('/sources/jobs/:jobId', (req, res) => {
  _sweep();
  const job = _jobs[String(req.params.jobId)];
  if (!job) return res.status(404).json({ success: false, error: 'no such job' });
  res.json({ success: true, ...job });
});

// BEFORE /sources/:id, or the parameter swallows it and answers "no such source" — Express
// matches in the order routes are declared, and "ytdlp" is a perfectly good id as far as the
// pattern is concerned.
//
// What the add-a-source dialog needs to know before it draws itself: is yt-dlp here, is there a
// working cookie jar, and therefore is the link field usable at all. Asked up front rather than
// discovered by a failed ingest - a text box that always answers "YouTube asked for a login" is
// a text box that should have been disabled.
router.get('/sources/ytdlp', async (_req, res) => {
  const found = await YTDLP.find();
  const ck = COOKIES.status();
  res.json({
    success: true,
    available: !!found, version: found ? found.version : '', path: found ? found.path : '',
    cookies: ck,
    // The file route never needs any of this. Links need all of it.
    linksEnabled: !!found && !!ck.present && !!ck.verified,
    why: !found ? 'yt-dlp is missing from this copy of the app'
      : !ck.present ? 'no cookie file yet — YouTube asks a program for a login'
        : !ck.verified ? 'the cookie file has not been checked against YouTube yet' : '',
  });
});

// ── the cookie jar ──────────────────────────────────────────────────────────
// Never returns the contents, only whether there is one and whether it worked.

router.get('/sources/cookies', (_req, res) => {
  res.json({ success: true, cookies: COOKIES.status() });
});

// Accepts either a pasted body or an uploaded file - the export is a text file, and people
// arrive with it both ways.
router.post('/sources/cookies', cookieUpload.single('file'), (req, res) => {
  try {
    let text = '';
    if (req.file) {
      text = fs.readFileSync(req.file.path, 'utf8');
      try { fs.unlinkSync(req.file.path); } catch (e) {}
    } else {
      text = String((req.body && req.body.text) || '');
    }
    if (!text.trim()) return res.status(400).json({ success: false, error: 'no cookie file' });
    const saved = COOKIES.save(text);
    // Stored but not yet trusted: verification is a separate, deliberate step.
    res.json({ success: true, cookies: COOKIES.status(), entries: saved.entries,
      youtubeEntries: saved.youtubeEntries, expiresSoon: saved.expiresSoon,
      soonestExpiry: saved.soonestExpiry });
  } catch (e) {
    if (req.file) { try { fs.unlinkSync(req.file.path); } catch (e2) {} }
    res.status(400).json({ success: false, error: e.message });
  }
});

// Confirmation, and it is a real request rather than a format check: the jar either gets a
// video's metadata out of YouTube or it does not. Anything else would unlock the link field for
// a file that fails on first use.
//
// The probe target is the first video ever uploaded to YouTube - nineteen seconds, public, and
// certain to exist for as long as the site does. Metadata only; nothing is downloaded.
const VERIFY_URL = 'https://www.youtube.com/watch?v=jNQXAC9IVRw';

// TWO SUCCESSES, NOT ONE, and this was measured rather than assumed. The refusal is
// probabilistic: from this machine an anonymous metadata call was refused three times out of
// three, a jar of made-up cookies three out of three - and one earlier attempt through the app
// went through. One lucky call would otherwise unlock the link field permanently, which is a
// worse lie than the field staying locked.
//
// yt-dlp WRITES BACK to the jar it is given, so the second attempt also proves the file survived
// being used, which is the state every later ingest will find it in.
const VERIFY_ATTEMPTS = 2;

router.post('/sources/cookies/verify', async (_req, res) => {
  if (!COOKIES.exists()) return res.status(400).json({ success: false, error: 'no cookie file to check' });
  if (!(await YTDLP.find())) return res.status(501).json({ success: false, error: YTDLP.MISSING });

  const jar = COOKIES.filePath();
  const seen = [];
  for (let i = 1; i <= VERIFY_ATTEMPTS; i++) {
    try {
      const meta = await YTDLP.info(VERIFY_URL, { cookies: jar });
      seen.push(meta.title || '(no title)');
    } catch (e) {
      COOKIES.setVerified(false, e.message);
      return res.status(400).json({
        success: false, attempt: i, of: VERIFY_ATTEMPTS,
        error: i === 1 ? e.message
          : `The first check passed and the second was refused — YouTube's refusal comes and goes, `
            + `so links would fail unpredictably. ${e.message}`,
        botCheck: !!e.botCheck, cookies: COOKIES.status(),
      });
    }
  }
  COOKIES.setVerified(true);
  res.json({ success: true, cookies: COOKIES.status(), attempts: VERIFY_ATTEMPTS, sawTitle: seen[0] });
});

router.delete('/sources/cookies', (_req, res) => {
  const gone = COOKIES.remove();
  res.json({ success: true, removed: gone, cookies: COOKIES.status() });
});

router.get('/sources/:id', (req, res) => {
  const rec = store.get(req.params.id);
  if (!rec) return res.status(404).json({ success: false, error: 'no such source' });
  res.json({ success: true, source: _withJob(rec) });
});

router.get('/sources/:id/transcript', (req, res) => {
  const rec = store.get(req.params.id);
  if (!rec) return res.status(404).json({ success: false, error: 'no such source' });
  const t = store.readTranscript(req.params.id);
  if (!t) return res.status(404).json({ success: false, error: 'no transcript yet' });
  res.json({ success: true, ...t, chars: (rec.transcript && rec.transcript.chars) || 0 });
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
  // GATED ON A WORKING COOKIE JAR, and the gate is here rather than only in the interface: a
  // link without a session gets the login demand after the metadata call, which reads as the
  // app being broken. Measured on this machine - even the first video ever uploaded to YouTube
  // is refused to an anonymous program.
  const ck = COOKIES.status();
  if (!ck.present) {
    return res.status(400).json({ success: false, needsCookies: true,
      error: 'YouTube will not serve videos to a program without a session. Add a cookies.txt '
        + 'export first, or add this video as a file.' });
  }
  if (!ck.verified) {
    return res.status(400).json({ success: false, needsCookies: true,
      error: 'The cookie file has not been checked yet. Press Check, or add this video as a file.' });
  }

  const jobId = _newJobId();
  const job = _jobs[jobId] = { state: 'running', step: 'reading the link', at: Date.now(), error: null, source: null };
  res.json({ success: true, jobId });

  (async () => {
    let id = null;
    try {
      const jar = COOKIES.filePath();
      const meta = await YTDLP.info(url, { onProgress: (s) => { job.step = s; }, cookies: jar });
      id = store.newId();
      store.ensureDirs();
      const rec = store.create({
        id, kind: 'youtube', title: meta.title, url: meta.url, channel: meta.channel,
        seconds: meta.duration, state: 'downloading',
      });
      job.source = store.summary(rec);
      job.sourceId = id;

      job.step = 'starting the download';
      await YTDLP.download(url, path.join(store.SOURCES_DIR, id + '.%(ext)s'),
        { onProgress: (s) => { job.step = s; }, cookies: jar });

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

router.post('/sources/:id/transcribe', (req, res) => {
  const id = String(req.params.id);
  const rec = store.get(id);
  if (!rec) return res.status(404).json({ success: false, error: 'no such source' });
  if (!rec.videoPath) return res.status(400).json({ success: false, error: 'this source has no file' });
  if (LIVE.has(rec.state)) return res.status(409).json({ success: false, error: 'this source is being read already' });

  const jobId = _newJobId();
  const job = _jobs[jobId] = { state: 'running', step: 'starting', at: Date.now(), error: null, source: null, sourceId: id };
  // Marked at once, not when _process gets to it: a second press in between would start a second read.
  store.update(id, { state: 'transcribing', error: '' });
  res.json({ success: true, jobId });

  (async () => {
    try {
      const saved = await _process(id, job, { poster: !rec.thumbPath });
      job.state = 'done';
      job.step = `${saved.transcript.cues} cues, ${Math.round(saved.transcript.chars / 1000)}k chars`;
      job.source = store.summary(saved);
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
router.post('/sources/:id/topics', (req, res) => {
  const id = String(req.params.id);
  const rec = store.get(id);
  if (!rec) return res.status(404).json({ success: false, error: 'no such source' });
  const t = store.readTranscript(id);
  if (!t || !Array.isArray(t.cues) || !t.cues.length) {
    return res.status(400).json({ success: false, error: 'this source has no transcript yet' });
  }
  const busy = _mining.get(id);
  if (busy && _jobs[busy.jobId] && _jobs[busy.jobId].state === 'running') {
    return res.status(409).json({ success: false, error: 'the topics of this source are being found already', ...busy });
  }

  const jobId = _newJobId();
  const job = _jobs[jobId] = { state: 'running', step: 'reading the transcript', at: Date.now(), error: null, sourceId: id };
  _mining.set(id, { kind: 'topics', jobId, startedAt: job.at });
  res.json({ success: true, jobId });

  (async () => {
    try {
      const found = await TOPICS.extract(
        { title: rec.title, channel: rec.channel, seconds: rec.seconds, description: '' },
        t.cues,
        // The generator's model, or - when that choice has no key - one that can run.
        { ...require('../lib/llm-json').runnable(req.body || {}), onProgress: (s) => { job.step = s; } },
      );
      // A topic is known by its span (`t<first block>_<last block>`), so one that comes back the
      // same keeps its "written" marks; a draft on a topic that does not come back carries on without
      // a source rather than pointing at nothing.
      const before = new Map(((store.get(id) || {}).topics || []).map(x => [String(x.id), x]));
      const topics = found.topics.map(x => {
        const was = before.get(String(x.id));
        return was && Array.isArray(was.usedBy) && was.usedBy.length ? { ...x, usedBy: was.usedBy } : x;
      });
      const saved = store.update(id, { topics, videoSummary: found.videoSummary });
      try { DRAFTS.detachSource(id, topics.map(x => x.id)); } catch (e) { /* the topics stand */ }
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
});

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
    if (LIVE.has(rec.state) || _mining.has(id)) {
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
