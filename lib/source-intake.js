'use strict';

// ════════════════════════════════════════════════════════════════════════════
// ADDING A SOURCE - a link or a file in, its topics out, all on the server.
//
// THE FRAME DECIDES, not the size. A link is read first (lib/ytdlp.js info: seconds, nothing downloaded), a file's
// frame is read off the file as it is SEEN (lib/media-probe.js, a phone's rotation counted):
//   wider than tall             a SOURCE - its whole way in is one Alerts row
//   vertical or square          ASKED: onto Uploads in Media, or "it has topics" - then a source after all
//   a frame the site did not name   ASKED: a video (a source, or Uploads) or a sound
//   a sound alone               "in development" - not taken
// A question waits here, with what was read, for half an hour: the window closed and opened again shows it.
//
// A SOURCE'S WAY IN is one Alerts row (type and kind 'source') from the moment it is decided:
//   download   a link - ONE AT A TIME, in the order they were added
//   copy       a file - the server copies it from where it lies (the window hands over its path), no queue
//   process    the poster, the sound, the transcription (Replicate - paid)
//   topics     by the agents' ladder (lib/writing-topics.js), kept on the record (paid)
// Everything after the download runs side by side with the next download. The row says what is happening in the
// words yt-dlp and the transcription use, and when it is expected to end (`etaAt` - the bell's wait); the Sources
// column reads the same progress (progress()).
//
// STOPPED (the cross on the source's line, two presses): not downloaded yet, or downloaded without its words - the
// source goes whole, its file and the parts of one with it; its words in - it stays, and "Find topics" is the
// person's. The row says "stopped", without a toast and without a retry.
//
// NOTHING TO WRITE FROM - no speech heard, or no topics found: it is not kept as a source. It waits in the column
// as an offer (state 'nospeech' / 'notopics'): onto Uploads in Media (toUploads), or deleted.
//
// THE APP CLOSED MIDWAY: nothing goes on by itself ("retry" is the person's). At start every
// unfinished way in is marked interrupted, a part downloaded is kept, and the row turns red; "retry" in Alerts goes
// on from the step it was cut at - a download back in the queue, carrying on from its part (free: one press), the
// transcription or the topics asked again (paid: "spend again?"). The source's own "Transcribe again" and "Find
// topics" do the same retry of its row (routes/sources.js), so there is one piece of work, never two.
// ════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const store = require('./sources-store');
const STT = require('./stt-replicate');
const VT = require('./video-thumb');
const YTDLP = require('./ytdlp');
const TOPICS = require('./writing-topics');
const DRAFTS = require('./script-drafts');
const ALERTS = require('./alerts');
const JOBS = require('./gen-jobs');
const PROBE = require('./media-probe');
const { MEDIA } = require('./config');
const { toDiskWithin } = require('./media');
const I18N = require('./i18n');

// What a download may land as, and what a file handed over may be. A sound file is "in development".
const LANDED_RE = /\.(mp4|mov|webm|mkv|m4v|avi|mp3|m4a|wav|aac|ogg|opus)$/i;
const VIDEO_FILE_RE = /\.(mp4|mov|webm|mkv|m4v|avi)$/i;
const AUDIO_FILE_RE = /\.(mp3|m4a|wav|aac|ogg|opus|flac)$/i;
const AUDIO_WORDS = 'Audio only - in development. A sound without a picture cannot be added yet.';
// The same, in the interface's language - said when a read ends on a sound.
const _audioWords = () => I18N.t('Audio only - in development. A sound without a picture cannot be added yet.');

const ASK_MS = 30 * 60 * 1000;            // a question unanswered is let go of
const KEEP_MS = 60 * 60 * 1000;           // a finished read is answered for an hour
const ROW_MS = 2000;                      // the row's words and end are written at most this often

const _kick = () => 'k' + crypto.randomBytes(6).toString('hex');
const _cancelled = () => Object.assign(new Error('cancelled'), { cancelled: true });

// ── The window's reads ──────────────────────────────────────────────────────
// id -> { id, from: 'link'|'file', state: reading|ask|source|uploads|audio|error|dropped, step, error, title, ask,
//         sourceId, alertId, linkJobId, item, at, endAt, _read, _mine }
const _reads = new Map();

function _sweep() {
  const now = Date.now();
  for (const [id, j] of _reads) {
    if (j.state === 'ask' && now - j.askedAt > ASK_MS) { j.state = 'dropped'; j.endAt = now; j._read = null; }
    if (j.endAt && now - j.endAt > KEEP_MS) _reads.delete(id);
  }
}

function view(j) {
  if (!j) return null;
  const { _read, _mine, ...rest } = j;
  // A vertical link sent onto Uploads is followed in the clip queue (lib/link-queue.js): its job comes along.
  if (j.linkJobId) rest.link = require('./link-queue').get(j.linkJobId);
  return rest;
}

function read(id) { _sweep(); return view(_reads.get(String(id))); }

// The questions still waiting - the window shows them again after a reload.
function asks() { _sweep(); return [..._reads.values()].filter(j => j.state === 'ask').map(view); }

function _newRead(from, extra) {
  _sweep();
  const j = {
    id: 'si_' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex'),
    from, state: 'reading', step: from === 'link' ? I18N.t('reading the link') : I18N.t('reading the file'), error: '', title: '',
    ask: null, sourceId: '', alertId: '', linkJobId: '', item: null, at: Date.now(), endAt: 0, ...extra,
  };
  _reads.set(j.id, j);
  return j;
}

const _end = (j, state, step) => { j.state = state; if (step) j.step = step; j.endAt = Date.now(); };
// `code` 'already' - the video is a source already (the page takes that source's tile then); '' otherwise.
const _fail = (j, e) => { j.error = (e && e.message) || String(e); j.code = e && e.already ? 'already' : ''; _end(j, 'error', I18N.t('failed')); };

// What the press sent for the topics: the generator's model choice, kept with the source.
function _mineWith(o) {
  const m = o && typeof o === 'object' ? o : {};
  return { provider: String(m.provider || ''), model: String(m.model || ''), effort: String(m.effort || '') };
}

/** A link: read, then a source, a question, or "in development". */
function addLink({ url, mineWith }) {
  const j = _newRead('link', { url: String(url || '').trim() });
  j._mine = _mineWith(mineWith);
  (async () => {
    try {
      const meta = await YTDLP.info(j.url, { onProgress: (s) => { j.step = s; } });
      j.title = meta.label;
      // The same video under another spelling of its address: one with its file, or one being added now, is not
      // added twice. One whose file never came is added again.
      const had = store.list().find(s => ((meta.key && s.linkKey === meta.key) || (s.url && s.url === meta.url))
        && (s.videoPath || live(s.id)));
      if (had) throw Object.assign(new Error(I18N.t('This video is a source already: "{title}".', { title: had.title || had.id })), { already: true });
      // One cut off on its way in waits for its retry, with the part it downloaded: not started a second time.
      const cut = store.list().find(s => ((meta.key && s.linkKey === meta.key) || (s.url && s.url === meta.url))
        && s.state === 'error' && s.intake && s.intake.alertId);
      if (cut) throw new Error(I18N.t('This video was being added and was cut off: "{title}" - press retry on its row in Alerts.', { title: cut.title || cut.id }));
      j._read = { meta };
      _decide(j, { video: meta.video, w: meta.width, h: meta.height, seconds: meta.duration, bytes: meta.bytes });
    } catch (e) { _fail(j, e); }
  })();
  return view(j);
}

/** A file on this computer, by its path (the app's window hands it over): read, then as a link. */
function addFile({ path: from, title, mineWith }) {
  const abs = String(from || '');
  const j = _newRead('file', { title: String(title || '').trim().slice(0, 200) || path.basename(abs, path.extname(abs)) });
  j._mine = _mineWith(mineWith);
  (async () => {
    try {
      if (!abs || !path.isAbsolute(abs)) throw new Error(I18N.t('No file was handed over.'));
      let st = null;
      try { st = fs.statSync(abs); } catch (e) { st = null; }
      if (!st || !st.isFile()) throw new Error(I18N.t('That file is not there any more.'));
      if (AUDIO_FILE_RE.test(abs)) { _end(j, 'audio', _audioWords()); return; }
      if (!VIDEO_FILE_RE.test(abs)) throw new Error(I18N.t('Not a video file: {name}', { name: path.basename(abs) }));
      const p = await PROBE.probe(abs);
      if (!p.duration && !p.w) throw new Error(I18N.t('This file cannot be read - is it a video?'));
      // As it is seen: a phone's portrait clip is often stored landscape with a rotation.
      const turned = Math.abs(Math.round(p.rotate || 0)) % 180 === 90;
      const w = turned ? p.h : p.w;
      const h = turned ? p.w : p.h;
      j._read = { path: abs, bytes: st.size, seconds: p.duration, name: path.basename(abs) };
      _decide(j, { video: p.w ? true : (p.audio ? false : null), w, h, seconds: p.duration, bytes: st.size });
    } catch (e) { _fail(j, e); }
  })();
  return view(j);
}

function _decide(j, m) {
  if (m.video === false) return _end(j, 'audio', _audioWords());
  if (!m.w || !m.h) return _ask(j, 'unknown', m);
  if (m.w > m.h) return _toSource(j);
  return _ask(j, m.w === m.h ? 'square' : 'vertical', m);
}

function _ask(j, kind, m) {
  j.ask = { kind, w: m.w || 0, h: m.h || 0, seconds: Math.round(m.seconds || 0), bytes: m.bytes || 0 };
  j.askedAt = Date.now();
  j.state = 'ask';
  j.step = kind === 'unknown' ? I18N.t('the site did not say what this is') : kind === 'square' ? I18N.t('a square video') : I18N.t('a vertical video');
}

/** The window's answer: 'source' (it has topics), 'uploads', or 'drop'. */
function answer(id, as) {
  _sweep();
  const j = _reads.get(String(id));
  if (!j) throw Object.assign(new Error(I18N.t('That question is gone - add the link again.')), { status: 404 });
  if (j.state !== 'ask') throw Object.assign(new Error(I18N.t('That is answered already.')), { status: 409 });
  if (as === 'source') _toSource(j);
  else if (as === 'uploads') _toUploads(j);
  else { j._read = null; _end(j, 'dropped', I18N.t('let go')); }
  return view(j);
}

// ── Onto Uploads (a vertical video) ─────────────────────────────────────────
function _toUploads(j) {
  if (j.from === 'link') {
    // The clip queue of the Media shelf: its own queue, apart from the sources'.
    const lj = require('./link-queue').add({ url: j.url, kind: 'uploads', from: 'media', meta: j._read.meta });
    j.linkJobId = lj.id;
    j._read = null;
    _end(j, 'uploads', I18N.t('onto Uploads'));
    return;
  }
  const r = j._read;
  j._read = null;
  j.state = 'uploads';
  j.step = I18N.t('copying');
  (async () => {
    try {
      fs.mkdirSync(MEDIA.work, { recursive: true });
      const name = 'src_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex') + path.extname(r.path).toLowerCase();
      const to = path.join(MEDIA.work, name);
      await _copyFile(r.path, to, { onFrac: (f, done, total) => { j.step = I18N.t('Copying · {pct}% of {size}', { pct: Math.round(f * 100), size: _mb(total) }); } });
      const videoPath = '/media/work/' + name;
      let thumbPath = null;
      try { thumbPath = (await VT.makeThumb(videoPath)).thumb; } catch (e) { /* a grey tile, not a lost clip */ }
      j.step = I18N.t('putting it on the shelf');
      const { item } = require('../routes/library').fileRecord({
        videoPath, thumbPath, name: j.title, kind: 'uploads',
      });
      j.item = { id: item.id, name: item.name, videoPath: item.videoPath, thumbPath: item.thumbPath || null };
      _end(j, 'uploads', I18N.t('on Uploads'));
      j.landed = true;
    } catch (e) { _fail(j, e); }
  })();
}

// ── A source ────────────────────────────────────────────────────────────────
// sourceId -> { kick, step: wait|download|copy|process|topics, words, frac, eta (s|null), stepAt, startedAt, took,
//               ac (AbortController), stop (yt-dlp's), stopping, saidWords, saidEta }
const _live = new Map();
const _queue = [];                         // sourceIds waiting for the download, in the order added
let _downloading = '';

// A SOURCE ANOTHER PIECE OF WORK BRINGS IN - a highlights project's video (lib/highlights-job.js): its way in is
// that work's own Alerts row, not a row of its own. It stands in the same download queue (one at a time, in the order
// added), and the Sources column follows it through what the work says: id -> { progress() -> {step, words, pct, leftMs,
// place}, stop(), leftMs() }.
const _foreign = new Map();
const _runs = new Map();                   // sourceId -> { run, resolve, reject }: a foreign download waiting in the queue

const live = (id) => _live.has(String(id)) || _foreign.has(String(id));

function _toSource(j) {
  const r = j._read;
  j._read = null;
  const id = store.newId();
  store.ensureDirs();
  const kick = _kick();
  const link = j.from === 'link';
  const meta = link ? r.meta : null;
  const rec = store.create({
    id,
    // kind 'youtube' is any link - the name older records carry.
    kind: link ? 'youtube' : 'file',
    title: link ? meta.label : j.title,
    originalName: link ? '' : r.name,
    url: link ? meta.url : '',
    linkKey: link ? meta.key : '',
    channel: link ? meta.channel : '',
    seconds: link ? meta.duration : r.seconds,
    bytes: link ? meta.bytes : r.bytes,
    state: link ? 'waiting' : 'copying',
    intake: {
      from: j.from, fromPath: link ? '' : r.path, mineWith: j._mine || {},
      // A post of several videos (an Instagram carousel) gives its first.
      items: link && meta.count > 1 ? '1' : '',
      step: link ? 'download' : 'copy', alertId: '', startedAt: new Date().toISOString(),
    },
  });
  // Live BEFORE its row exists: writing the row wakes the runner, whose first look must find it looked after.
  _reserve(id, kick, link ? 'download' : 'copy');
  const row = JOBS.submitted({
    kind: 'source', what: 'source', title: I18N.t('Source · {title}', { title: rec.title }),
    where: {
      page: 'library', href: '/library?shelf=scenarios&make=1&src=' + encodeURIComponent(id),
      label: I18N.t('Library · Scenarios · sources'), spot: { key: id, view: 'sources' },
    },
    engine: link ? 'yt-dlp' : 'file',
    stage: link ? I18N.t('waiting') : I18N.t('copying'),
    job: { type: 'source', params: { sourceId: id, kick } },
  });
  _patchIntake(id, { alertId: row.id });
  j.sourceId = id;
  j.alertId = row.id;
  _end(j, 'source', I18N.t('in Alerts'));
  _go(id, link ? 'download' : 'copy');
}

function _patchIntake(id, patch) {
  const rec = store.get(id);
  if (!rec) return null;
  return store.update(id, { intake: { ...(rec.intake || {}), ...patch } });
}

// Live from this moment: the runner's next tick finds the row looked after.
function _reserve(id, kick, plan) {
  _live.set(String(id), {
    kick, step: plan === 'download' ? 'wait' : plan, words: '', frac: 0, eta: null,
    stepAt: Date.now(), startedAt: Date.now(), took: {}, ac: new AbortController(), stop: null, stopping: false,
    saidWords: null, saidEta: 0,
  });
  _wakeRows();
}

function _go(id, plan) {
  if (plan === 'download') { _queue.push(String(id)); _pump(); }
  else _run(String(id), plan);
}

function _step(id, step, words) {
  const L = _live.get(id);
  if (!L) return;
  if (L.step !== step && L.step !== 'wait') L.took[L.step] = Date.now() - L.stepAt;
  L.step = step;
  L.stepAt = Date.now();
  L.words = words || '';
  L.frac = 0;
  L.eta = null;
  _patchIntake(id, { step: step === 'wait' ? 'download' : step });
}

const _guard = (L) => { if (!L || L.stopping) throw _cancelled(); };

function _pump() {
  if (_downloading) return;
  while (_queue.length) {
    const id = _queue.shift();
    const foreign = _runs.get(id);
    if (foreign) {
      _runs.delete(id);
      _downloading = id;
      Promise.resolve().then(foreign.run).then(foreign.resolve, foreign.reject)
        .finally(() => { _downloading = ''; _pump(); });
      return;
    }
    const L = _live.get(id);
    if (!L || L.stopping) continue;
    _downloading = id;
    _download(id)
      .then((ok) => { if (ok) setImmediate(() => _run(id, 'process')); })
      .finally(() => { _downloading = ''; _pump(); });
    return;
  }
}

/** Another piece of work's download, in the sources' queue: `run` is called when its turn comes; resolves
 *  with what it resolves with. Taken out of the queue before its turn by `unqueue(id)` (it then rejects as stopped). */
function queueDownload(id, run) {
  const key = String(id);
  return new Promise((resolve, reject) => {
    _runs.set(key, { run, resolve, reject });
    _queue.push(key);
    _pump();
  });
}
function unqueue(id) {
  const key = String(id);
  const r = _runs.get(key);
  if (!r) return false;
  _runs.delete(key);
  const qi = _queue.indexOf(key);
  if (qi >= 0) _queue.splice(qi, 1);
  r.reject(_cancelled());
  return true;
}
/** Where a download waits: 1 = next, 0 = not waiting. */
function queuePlace(id) {
  const qi = _queue.indexOf(String(id));
  return qi < 0 ? 0 : qi + (_downloading ? 2 : 1);
}
/** A source another piece of work brings in: followed by the column through `worker`, let go of by `release`. */
function adopt(id, worker) { _foreign.set(String(id), worker || {}); }
function release(id) { _foreign.delete(String(id)); }

/**
 * A link's video into the sources folder, under the source's id - shared by a source's own download and a highlights
 * project's. Resolves with what landed: { videoPath, bytes, seconds }.
 */
async function downloadInto(id, url, { items = '', onProgress = () => {}, kill, fallbackSeconds = 0 } = {}) {
  await YTDLP.download(url, path.join(store.SOURCES_DIR, id + '.%(ext)s'), { onProgress, items, kill });
  // yt-dlp names the file by the template, but the extension depends on what it merged, so the file is found
  // rather than assumed: the largest of what landed under this id that is not a part.
  const landed = fs.readdirSync(store.SOURCES_DIR)
    .filter(f => f.startsWith(id + '.') && LANDED_RE.test(f) && !/\.f\d+\./.test(f))
    .sort((a, b) => fs.statSync(path.join(store.SOURCES_DIR, b)).size - fs.statSync(path.join(store.SOURCES_DIR, a)).size)[0];
  if (!landed) throw new Error(I18N.t('The download finished but left no file behind.'));
  const abs = path.join(store.SOURCES_DIR, landed);
  const seconds = await STT.probeDuration(abs).catch(() => fallbackSeconds || 0);
  return { videoPath: `${store.SOURCES_URL}/${landed}`, bytes: fs.statSync(abs).size, seconds };
}

// The download alone - the queue moves on when it ends, whatever comes after it.
async function _download(id) {
  const L = _live.get(id);
  try {
    _guard(L);
    const rec = store.get(id);
    if (!rec || !rec.url) throw new Error(I18N.t('the source went away'));
    _step(id, 'download', I18N.t('starting the download'));
    store.update(id, { state: 'downloading', error: '' });
    const got = await downloadInto(id, rec.url, {
      onProgress: (words, p) => { L.words = words; if (p) { L.frac = p.pct; L.eta = p.eta; } },
      items: (rec.intake && rec.intake.items) || '',
      // Stopped while yt-dlp was still being started: stopped the moment it is.
      kill: (stop) => { L.stop = stop; if (L.stopping) stop(); },
      fallbackSeconds: rec.seconds || 0,
    });
    _guard(L);
    store.update(id, { ...got, state: 'stored' });
    return true;
  } catch (e) {
    _ended(id, e);
    return false;
  }
}

// From `from` to the end: copy (a file), process, topics.
async function _run(id, from) {
  const L = _live.get(id);
  try {
    if (from === 'copy') {
      _guard(L);
      _step(id, 'copy', I18N.t('copying'));
      const rec = store.get(id);
      const src = rec && rec.intake && rec.intake.fromPath;
      if (!src || !fs.existsSync(src)) throw new Error(I18N.t('The file is not where it was - add it again.'));
      const name = id + path.extname(src).toLowerCase();
      const to = path.join(store.SOURCES_DIR, name);
      await _copyFile(src, to, {
        signal: L.ac.signal,
        onFrac: (f, done, total) => { L.frac = f; L.words = I18N.t('Copying · {pct}% of {size}', { pct: Math.round(f * 100), size: _mb(total) }); },
      });
      store.update(id, { videoPath: `${store.SOURCES_URL}/${name}`, bytes: fs.statSync(to).size, state: 'stored' });
    }
    if (from === 'copy' || from === 'process') {
      _guard(L);
      _step(id, 'process', I18N.t('making the poster'));
      await processSource(id, { onStep: (s) => { L.words = s; }, signal: L.ac.signal });
    }
    _guard(L);
    _step(id, 'topics', I18N.t('reading the transcript'));
    const { topics } = await mineSource(id, { onStep: (s) => { L.words = s; }, signal: L.ac.signal });
    _done(id, topics.length);
  } catch (e) { _ended(id, e); }
}

function _done(id, n) {
  const L = _live.get(id);
  if (L) L.took[L.step] = Date.now() - L.stepAt;
  const rec = _patchIntake(id, { step: 'done', interrupted: '', error: '', took: L ? L.took : {} });
  _live.delete(id);
  const alertId = rec && rec.intake && rec.intake.alertId;
  if (alertId) ALERTS.finish(alertId, { media: 'video', path: '', note: I18N.tn(n, '1 topic', '{n} topics') });
}

// Every way a step ends but done: stopped, nothing to write from, or a failure.
function _ended(id, e) {
  const L = _live.get(id);
  const step = L ? L.step : '';
  const rec = store.get(id);
  const alertId = rec && rec.intake && rec.intake.alertId;
  if ((L && L.stopping) || (e && (e.cancelled || e.stopped))) { _stopped(id, step); return; }
  _live.delete(id);
  if (!rec) return;
  if (e && (e.noSpeech || e.noTopics)) {
    // Nothing to write from: not kept as a source - an offer in the column, its file kept until it is decided.
    const words = e.noSpeech
      ? I18N.t('No speech in it - not added to the sources. Its line in Sources offers to put it on Uploads.')
      : I18N.t('No topics in it - not added to the sources. Its line in Sources offers to put it on Uploads.');
    store.update(id, { state: e.noSpeech ? 'nospeech' : 'notopics', error: words });
    _patchIntake(id, { step: 'none' });
    if (alertId) ALERTS.fail(alertId, words, { refused: true });
    return;
  }
  const why = (e && e.message) || I18N.t('it failed');
  if (step === 'topics') {
    // Its words are in: it is a source, without topics yet.
    _patchIntake(id, { error: why });
  } else {
    const t = rec.transcript || null;
    store.update(id, { state: 'error', error: why, transcript: t && t.state === 'ready' ? t : (t ? { ...t, state: 'error' } : null) });
  }
  if (alertId) ALERTS.fail(alertId, why, { refused: false });
}

function _stopped(id, step) {
  _live.delete(id);
  const qi = _queue.indexOf(id);
  if (qi >= 0) _queue.splice(qi, 1);
  const rec = store.get(id);
  if (!rec) return;
  const alertId = rec.intake && rec.intake.alertId;
  if (step === 'topics') {
    _patchIntake(id, { step: 'stopped' });
    if (alertId) ALERTS.cancel(alertId, I18N.t('stopped - its words are in; "Find topics" finds the topics'));
    return;
  }
  if (alertId) ALERTS.cancel(alertId, I18N.t('stopped - the source was removed'));
  _removeSoon(id);
}

// A process just killed may hold its file a moment longer on Windows: the record goes now, what is left of its
// files is tried again a few times.
function _removeSoon(id) {
  try { store.remove(id); } catch (e) { /* gone already */ }
  let tries = 0;
  const again = () => {
    const left = fs.existsSync(store.SOURCES_DIR)
      ? fs.readdirSync(store.SOURCES_DIR).filter(f => f.startsWith(id + '.')) : [];
    for (const f of left) { try { fs.rmSync(path.join(store.SOURCES_DIR, f), { force: true }); } catch (e) { /* held */ } }
    if (left.length && ++tries < 5) setTimeout(again, 1500).unref();
  };
  setTimeout(again, 500).unref();
}

/** The cross on the source's line. */
function stop(id) {
  const key = String(id);
  // A source another piece of work brings in: stopping it stops that work.
  const F = _foreign.get(key);
  if (F) { try { if (F.stop) F.stop(); } catch (e) { /* its own trouble */ } return true; }
  const L = _live.get(key);
  if (!L) return false;
  L.stopping = true;
  if (L.step === 'wait') { _stopped(key, 'wait'); return true; }
  if (L.stop) { try { L.stop(); } catch (e) { /* gone */ } }
  try { L.ac.abort(); } catch (e) { /* aborted */ }
  return true;
}

// ── The work itself, shared with the source's own buttons (routes/sources.js) ─
/** The poster, the sound, the transcription. Resolves with the record; `warning` when the words are too many. */
async function processSource(id, { onStep = () => {}, signal = null } = {}) {
  const rec = store.get(id);
  if (!rec) throw new Error(I18N.t('the source went away'));
  // Its file in the library, or where it stays on the disk (a highlights source from a file - never copied in).
  const abs = store.fileOf(rec);
  if (!abs) throw new Error(rec.diskPath ? I18N.t('The video is not where it was: {path}', { path: rec.diskPath }) : I18N.t('this source has no file'));
  if (!rec.thumbPath) {
    onStep(I18N.t('making the poster'));
    try {
      if (rec.diskPath) {
        // Never beside the person's file: in the library's sources folder.
        const name = String(id) + '_thumb.jpg';
        await VT.posterFrame(abs, path.join(store.SOURCES_DIR, 'thumbs', name), { at: store.posterAt(rec.seconds) });
        store.update(id, { thumbPath: store.SOURCES_URL + '/thumbs/' + name });
      } else {
        const t = await VT.makeThumb(rec.videoPath, { at: store.posterAt(rec.seconds) });
        store.update(id, { thumbPath: t.thumb });
      }
    } catch (e) { /* a missing poster is a grey card, not a broken source - the words are the point */ }
  }
  if (signal && signal.aborted) throw _cancelled();
  onStep(I18N.t('extracting audio'));
  store.update(id, { state: 'transcribing', error: '', transcript: { state: 'running' } });
  const out = await STT.transcribeFile(abs, { onProgress: onStep, signal });
  onStep(I18N.t('storing the transcript'));
  const chars = out.cues.reduce((n, c) => n + c.text.length + 1, 0);
  store.writeTranscript(id, { cues: out.cues, model: out.model, seconds: out.seconds, cost: out.cost, at: new Date().toISOString() });
  const saved = store.update(id, {
    state: 'ready',
    // a transcript written anew has no word timings: a highlights project hears it again
    words: null,
    seconds: rec.seconds || out.sourceSeconds || 0,
    transcript: { state: 'ready', cues: out.cues.length, chars, model: out.model, cost: out.cost, seconds: out.seconds },
  });
  // Said plainly rather than discovered later by the topics call, which would fail with a token error.
  const warning = chars > store.MAX_TRANSCRIPT_CHARS
    ? I18N.t('This transcript is {n}k characters — too long for one topics pass. Mining will refuse it; a shorter source works.', { n: Math.round(chars / 1000) })
    : '';
  return { saved, warning };
}

/** Its topics, by the agents' ladder. REPLACES what was found before: topics
 *  are a reading of the transcript, and two readings merged would overlap. A topic that comes back the same keeps
 *  its "written" marks; a draft on one that does not carries on without a source. */
async function mineSource(id, { onStep = () => {}, signal = null } = {}) {
  const rec = store.get(id);
  if (!rec) throw new Error(I18N.t('the source went away'));
  const t = store.readTranscript(id);
  if (!t || !Array.isArray(t.cues) || !t.cues.length) throw new Error(I18N.t('this source has no transcript yet'));
  const found = await TOPICS.extract(
    { title: rec.title, channel: rec.channel, seconds: rec.seconds, description: '' },
    t.cues,
    { onProgress: onStep, signal },
  );
  const before = new Map(((store.get(id) || {}).topics || []).map(x => [String(x.id), x]));
  const topics = found.topics.map(x => {
    const was = before.get(String(x.id));
    return was && Array.isArray(was.usedBy) && was.usedBy.length ? { ...x, usedBy: was.usedBy } : x;
  });
  const saved = store.update(id, { topics, videoSummary: found.videoSummary, ...(found.by ? { topicsBy: found.by } : {}) });
  try { DRAFTS.detachSource(id, topics.map(x => x.id)); } catch (e) { /* the topics stand */ }
  return { saved, found, topics };
}

// ── Onto Uploads, from the offer of a source with nothing to write from ─────
async function toUploads(id) {
  const rec = store.get(id);
  if (!rec) throw Object.assign(new Error(I18N.t('no such source')), { status: 404 });
  if (rec.state !== 'nospeech' && rec.state !== 'notopics') throw Object.assign(new Error(I18N.t('this one is a source - it stays')), { status: 409 });
  // A video that stays on the disk is COPIED onto Uploads - the person's file is never moved.
  let videoPath = rec.videoPath;
  if (rec.diskPath) {
    if (!fs.existsSync(rec.diskPath)) throw Object.assign(new Error(I18N.t('The video is not where it was: {path}', { path: rec.diskPath })), { status: 409, missing: true });
    const { MEDIA } = require('./config');
    const name = 'upl_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6) + path.extname(rec.diskPath).toLowerCase();
    fs.mkdirSync(MEDIA.work, { recursive: true });
    await _copyFile(rec.diskPath, path.join(MEDIA.work, name), {});
    videoPath = '/media/work/' + name;
  } else if (!rec.videoPath || !toDiskWithin(rec.videoPath, [store.SOURCES_DIR])) throw Object.assign(new Error(I18N.t('its file is gone')), { status: 409 });
  let thumbPath = rec.diskPath ? null : (rec.thumbPath || null);
  if (!thumbPath) { try { thumbPath = (await VT.makeThumb(videoPath)).thumb; } catch (e) { thumbPath = null; } }
  // Filed means placed: the file and its poster move to Uploads' folder, and the stores follow (lib/relocate.js).
  const { item, kind } = require('../routes/library').fileRecord({
    videoPath, thumbPath, name: rec.title, kind: 'uploads',
    link: rec.url || '', linkKey: rec.linkKey || '',
  });
  // Its own poster in the sources folder goes with the source (the copy on Uploads has its own).
  if (rec.diskPath && rec.thumbPath) { try { const a = toDiskWithin(rec.thumbPath, [store.SOURCES_DIR]); if (a && store.inLibrary(a)) fs.rmSync(a, { force: true }); } catch (e) { /* a poster */ } }
  store.forget(id);
  return { item, kind };
}

// ── How far along, and how long is left ─────────────────────────────────────
// The download's share is yt-dlp's own; the transcription and the topics have none, so they are counted by the time
// they are expected to take: a part that does not depend on the length (a model starting, a call going out) and a part
// per second of video, learned from the sources before it on this computer (the middle of the last six), or a guess
// before there are any - and never past 95% before they end. Learned per second alone, a 19-second clip whose
// transcription is mostly Whisper starting would make an hour-long one look like hours.
const BASE_MS = { process: 30000, topics: 20000 };
const _median = (l) => { const s = l.slice().sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
let _ratesAt = 0;
let _rates = null;
function _past() {
  if (_rates && Date.now() - _ratesAt < 60000) return _rates;
  const per = { download: [], process: [], topics: [] };
  for (const s of store.list()) {
    const took = (s.intake && s.intake.took) || null;
    if (!took) continue;
    // A speed only from a download big enough to have one: a small clip's time is yt-dlp starting up.
    if (took.download > 0 && s.bytes > 20e6 && per.download.length < 6) per.download.push(s.bytes / took.download);
    if (took.process > 0 && s.seconds > 0 && per.process.length < 6) per.process.push(Math.max(0, took.process - BASE_MS.process) / s.seconds);
    if (took.topics > 0 && s.seconds > 0 && per.topics.length < 6) per.topics.push(Math.max(0, took.topics - BASE_MS.topics) / s.seconds);
  }
  _rates = {
    speed: per.download.length ? _median(per.download) : 8e6 / 1000,     // bytes per ms - 8 MB/s
    process: per.process.length ? _median(per.process) : null,
    topics: per.topics.length ? _median(per.topics) : null,
  };
  _ratesAt = Date.now();
  return _rates;
}

function _expect(rec) {
  const r = _past();
  const secs = +rec.seconds || 0;
  const bytes = +rec.bytes || 0;
  return {
    download: bytes ? Math.max(5000, bytes / r.speed) : 60000,
    copy: Math.max(2000, bytes / 150000),                                 // 150 MB/s on the same computer
    process: BASE_MS.process + secs * (r.process != null ? r.process : 30),
    topics: BASE_MS.topics + secs * (r.topics != null ? r.topics : 20),
  };
}

function _leftOfDownload(id) {
  const F = _foreign.get(id);
  if (F) { try { return Math.max(0, +(F.leftMs && F.leftMs()) || 0); } catch (e) { return 0; } }
  const L = _live.get(id);
  const rec = store.get(id);
  if (!L || !rec) return 0;
  const E = _expect(rec);
  if (L.step === 'wait') return E.download;
  if (L.eta != null) return L.eta * 1000;
  return Math.max(0, E.download * (1 - (L.frac || 0)));
}

// "2nd" - in Russian "2-й", as the Sources column says it (public/js/library/make.js).
const _ordinal = (n) => (I18N.lang() === 'ru' ? n + '-й'
  : n + (n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'));

/** { step, words, pct (0..1), leftMs, place (in the download queue, 1 = next) } for a source being added, or null.
 *  A step already done counts what it took; the one running counts what it is now expected to take in all - for a
 *  download or a copy, its time so far plus what yt-dlp says is left - so the share corrects itself as it goes. */
function progress(id) {
  const key = String(id);
  const F = _foreign.get(key);
  if (F) { try { return F.progress ? F.progress() : null; } catch (e) { return null; } }
  const L = _live.get(key);
  if (!L) return null;
  const rec = store.get(key) || {};
  const E = _expect(rec);
  const first = (rec.intake && rec.intake.from) === 'file' ? 'copy' : 'download';
  const order = [first, 'process', 'topics'];
  const cur = L.step === 'wait' ? first : L.step;
  const i = Math.max(0, order.indexOf(cur));
  const before = order.slice(0, i).reduce((n, k) => n + (L.took[k] || E[k]), 0);
  const after = order.slice(i + 1).reduce((n, k) => n + E[k], 0);
  const el = Date.now() - L.stepAt;
  let frac = 0;
  let whole = E[cur];                      // the running step, all of it
  let place = 0;
  let waitMs = 0;
  if (L.step === 'wait') {
    // Behind the download running now and those ahead of it in the queue.
    const ahead = _queue.slice(0, Math.max(0, _queue.indexOf(key)));
    place = ahead.length + (_downloading ? 2 : 1);
    waitMs = (_downloading ? _leftOfDownload(_downloading) : 0) + ahead.reduce((n, a) => n + _leftOfDownload(a), 0);
  } else if ((cur === 'download' || cur === 'copy') && L.frac > 0) {
    frac = L.frac;
    whole = L.eta != null ? el + L.eta * 1000 : el / frac;
  } else {
    whole = Math.max(E[cur], el / 0.95);
    frac = Math.min(0.95, el / whole);
  }
  const pct = Math.min(0.99, (before + frac * whole) / (before + whole + after));
  const words = L.step === 'wait' ? I18N.t('waiting · {nth} in the queue', { nth: _ordinal(place) }) : (L.words || cur);
  return { step: L.step, words, pct, leftMs: Math.round(waitMs + whole * (1 - frac) + after), place };
}

// The rows say the same, at most every two seconds, and only when it changed: words, or an end moved by 5 s.
let _rowsT = null;
function _wakeRows() {
  if (_rowsT) return;
  _rowsT = setInterval(() => {
    if (!_live.size) { clearInterval(_rowsT); _rowsT = null; return; }
    for (const [id, L] of _live) {
      const rec = store.get(id);
      const alertId = rec && rec.intake && rec.intake.alertId;
      const p = progress(id);
      if (!alertId || !p) continue;
      const eta = Date.now() + p.leftMs;
      if (p.words === L.saidWords && Math.abs(eta - L.saidEta) < 5000) continue;
      L.saidWords = p.words;
      L.saidEta = eta;
      ALERTS.update(alertId, { stage: p.words, etaAt: new Date(eta).toISOString() });
    }
  }, ROW_MS);
  if (_rowsT.unref) _rowsT.unref();
}

// ── The row in Alerts ───────────────────────────────────────────────────────
// What "retry" would go on with: the step it was cut at, if what that step needs is still there.
function _plan(rec) {
  if (!rec || !rec.intake) return '';
  if (rec.state === 'nospeech' || rec.state === 'notopics') return '';
  if (rec.state === 'ready') return (rec.topics || []).length ? '' : 'topics';
  // Its file in the library or on the disk; a video that stays on the disk is never copied - gone, nothing to go on with.
  if (store.fileOf(rec)) return 'process';
  if (rec.diskPath) return '';
  if (rec.intake.from === 'link' && rec.url) return 'download';
  if (rec.intake.from === 'file' && rec.intake.fromPath && fs.existsSync(rec.intake.fromPath)) return 'copy';
  return '';
}
const _rowSource = (row) => String((((row || {}).job || {}).params || {}).sourceId || '');
const _rowPlan = (row) => (row && !row.cancelled && !_live.has(_rowSource(row)) ? _plan(store.get(_rowSource(row))) : '');

JOBS.register('source', {
  // The work ends its own row; the runner only notices a row nobody is working on any more - the app was closed.
  timeoutMs: 7 * 24 * 3600 * 1000,
  poll: async (row) => {
    const p = (row.job || {}).params || {};
    const L = _live.get(String(p.sourceId || ''));
    if (L && L.kick === p.kick) return { state: 'pending' };
    const rec = store.get(p.sourceId);
    const why = (rec && rec.intake && rec.intake.interrupted) || (rec && rec.error)
      || I18N.t('interrupted - the app was closed while this source was being added');
    return { state: 'failed', error: why, refused: false };
  },
  file: async () => ({ path: '', media: 'video' }),
  canRetry: (row) => !!_rowPlan(row),
  free: (row) => ['download', 'copy'].includes(_rowPlan(row)),
  busy: (row) => _live.has(_rowSource(row)),
  cancel: (row) => { stop(_rowSource(row)); },
  submit: async (_request, row) => {
    const id = _rowSource(row);
    const plan = _rowPlan(row);
    if (!plan) throw new Error(I18N.t('there is nothing left to go on with'));
    const kick = _kick();
    // Back to the start of that step, said on the record at once - the column shows it before the work begins.
    if (plan === 'download') store.update(id, { state: 'waiting', error: '' });
    else if (plan === 'copy') store.update(id, { state: 'copying', error: '' });
    else if (plan === 'process') store.update(id, { state: 'stored', error: '' });
    _patchIntake(id, { interrupted: '', error: '' });
    _reserve(id, kick, plan);
    return {
      params: { sourceId: id, kick },
      stage: plan === 'download' ? I18N.t('waiting') : plan === 'copy' ? I18N.t('copying') : plan === 'process' ? I18N.t('transcribing') : I18N.t('finding topics'),
      later: () => {
        const L = _live.get(id);
        if (!L || L.kick !== kick) return;
        _go(id, plan);
      },
    };
  },
});

/** The source's own "Transcribe again" / "Find topics", when its way in failed: the same retry as the row's. Resolves
 *  with the row's id, or '' when there is no such row to go on with (the button then does its own work). */
async function retryOf(id) {
  const rec = store.get(id);
  const alertId = rec && rec.intake && rec.intake.alertId;
  const row = alertId ? ALERTS.get(alertId) : null;
  if (!row || row.state !== 'failed' || !ALERTS.view(row).retryable) return '';
  await JOBS.retry(row.id);
  return row.id;
}

// ── At start ────────────────────────────────────────────────────────────────
// Nothing is being added when the server starts, so a way in left unfinished was cut off by the app closing. It says
// so - on the record and, through the runner's first look at its row, in red in Alerts - and waits for "retry". A part
// downloaded stays for it; a copy cut off goes (the retry copies again).
function boot() {
  for (const s of store.list()) {
    const it = s.intake;
    if (!it || ['done', 'stopped', 'none'].includes(it.step)) continue;
    // A highlights project's video: its own work says what became of it (lib/highlights-job.js boot).
    if (it.by === 'highlights') continue;
    try {
      let words = '';
      if (s.state === 'waiting') words = I18N.t('interrupted - the app was closed before it was downloaded');
      else if (s.state === 'downloading') words = I18N.t('interrupted - the app was closed while it was being downloaded');
      else if (s.state === 'copying') {
        words = I18N.t('interrupted - the app was closed while it was being copied');
        store.parts(s.id);
      } else if (s.state === 'stored' || s.state === 'transcribing') words = I18N.t('interrupted - the app was closed while it was being transcribed');
      else if (s.state === 'ready' && it.step === 'topics' && !(s.topics || []).length) words = I18N.t('interrupted - the app was closed while its topics were being found');
      if (!words) continue;
      if (s.state !== 'ready') {
        const t = s.transcript || null;
        store.update(s.id, { state: 'error', error: words, errorCode: 'interrupted', transcript: t && t.state === 'ready' ? t : (t ? { ...t, state: 'error' } : null) });
      }
      _patchIntake(s.id, { interrupted: words });
    } catch (e) { console.warn('[sources] could not mark', s.id, 'interrupted:', e.message); }
  }
}

// ── Small things ────────────────────────────────────────────────────────────
const _mb = (b) => (b >= 1e9 ? I18N.t('{n} GB', { n: (b / 1e9).toFixed(1) }) : I18N.t('{n} MB', { n: Math.round(b / 1e6) }));

// A copy with its share done and a stop. A copy stopped or failed leaves nothing behind.
function _copyFile(from, to, { signal = null, onFrac = () => {} } = {}) {
  return new Promise((resolve, reject) => {
    const total = fs.statSync(from).size;
    let done = 0;
    let over = false;
    const rs = fs.createReadStream(from);
    const ws = fs.createWriteStream(to);
    const fail = (e) => {
      if (over) return;
      over = true;
      if (signal) signal.removeEventListener('abort', onAbort);
      rs.destroy();
      ws.destroy();
      const rm = () => fs.rm(to, { force: true }, () => reject(e));
      if (ws.closed) rm(); else ws.once('close', rm);
    };
    const onAbort = () => fail(_cancelled());
    if (signal) {
      if (signal.aborted) { onAbort(); return; }
      signal.addEventListener('abort', onAbort, { once: true });
    }
    rs.on('data', (c) => { done += c.length; onFrac(total ? done / total : 0, done, total); });
    rs.on('error', fail);
    ws.on('error', fail);
    ws.on('finish', () => {
      if (over) return;
      over = true;
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve(total);
    });
    rs.pipe(ws);
  });
}

module.exports = {
  addLink, addFile, answer, read, asks, stop, live, progress, toUploads, retryOf, boot,
  processSource, mineSource, AUDIO_WORDS,
  // for a highlights project's video
  queueDownload, unqueue, queuePlace, adopt, release, downloadInto, VIDEO_FILE_RE, AUDIO_FILE_RE,
};
