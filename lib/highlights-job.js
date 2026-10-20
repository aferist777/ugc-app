'use strict';

// ════════════════════════════════════════════════════════════════════════════
// HIGHLIGHTS - a long video's way to its moments, all on the server (phase V33.1, the owner 2026-10-20; PLAN.md "Фаза V33").
//
// One press in the popup ("find moments") and ONE Alerts row, "Highlights · <title>" (kind and type 'highlights'), from the
// press to the end - the page only follows the record (lib/highlights-store.js) and the row:
//   download   a link - yt-dlp, the best there is, in the SAME queue as the sources' downloads (one at a time)
//   copy       a file - the window hands its path over, the server copies it
//              Either way the video becomes a SOURCE of the Library (Scenarios -> sources; the owner's (х1)): "with its words
//              but no scenarios" - no topics are looked for ((х1а): "Find topics" on the source, when wanted). It has no row of
//              its own: this row is its way in, and the Sources column follows it through this work (source-intake adopt).
//              A source already in the Library is taken as it is (the third way in), and so is a link that is one.
//   hear       every word with its time: Groq when there is a key, this computer when not ((х2); lib/captions-job.js
//              hearLong). The words are the SOURCE's (data/transcripts/<id>.json `words`): heard once, for every project made
//              from it after. A source that came in now gets its transcript from them - Replicate is not asked.
//   find       the agents' ladder reads the words in sentences and answers the moments ((х3); lib/highlights-agent.js) -
//              ASKED ONCE: `asked` is on the record and on the row before the call, a step that got no answer stops the
//              ladder, and the answer is kept whole before it is read.
// The fragments themselves - the pieces cut, a timeline each - are block 3's.
//
// STOPPED (the row's cross, the source's cross, the project deleted): a source this run brought in goes if its words are
// not in yet (as a source being added does); a source that was in the Library before stays whatever happens.
// THE APP CLOSED MIDWAY (the owner's (х18)): the row turns red with what it was doing, and "retry" goes on from that step -
// the download from its part (free: one press), the copy again, the hearing of what was not heard yet (Groq: what is left
// is paid; this computer: free), the agent asked again (paid: "spend again?") - unless its answer was already kept.
// ════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const HL = require('./highlights-store');
const store = require('./sources-store');
const INTAKE = require('./source-intake');
const YTDLP = require('./ytdlp');
const PROBE = require('./media-probe');
const VT = require('./video-thumb');
const ALERTS = require('./alerts');
const JOBS = require('./gen-jobs');
const AGENT = require('./highlights-agent');
const AGENTS = require('./agents');
const CAPJOB = require('./captions-job');
const GROQ = require('./groq-stt');
const { toDiskWithin } = require('./media');

const GROQ_PER_HOUR = 0.111;              // whisper-large-v3 on Groq, dollars an hour of sound (lib/groq-stt.js)
const AGENT_MS = 4 * 60 * 1000;           // an hour of words read by a flash model: well inside, a slow minute or two
const ROW_MS = 2000;

const _kick = () => 'k' + crypto.randomBytes(6).toString('hex');
const _cancelled = () => Object.assign(new Error('cancelled'), { cancelled: true });
const _day = () => { const d = new Date(), two = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`; };
const _mb = (b) => (b >= 1e9 ? (b / 1e9).toFixed(1) + ' GB' : Math.round(b / 1e6) + ' MB');
const _min = (s) => Math.max(0, Math.round((+s || 0) / 60));

// projectId -> { kick, step: download|copy|hear|find, words, frac, eta, stepAt, startedAt, took, ac, stop, stopping,
//                sourceId, made (this run brought the source in), heard, saidWords, saidEta }
const _live = new Map();
const live = (id) => _live.has(String(id));

function _reserve(id, kick, plan) {
  _live.set(String(id), { kick, step: plan, words: '', frac: 0, eta: null, stepAt: Date.now(), startedAt: Date.now(), took: {},
    ac: new AbortController(), stop: null, stopping: false, sourceId: '', made: false, heard: null, saidWords: null, saidEta: 0 });
  _wakeRows();
}

function _step(id, step, words) {
  const L = _live.get(String(id));
  if (!L) return;
  if (L.step !== step) { L.took[L.step] = Date.now() - L.stepAt; L.stepAt = Date.now(); }
  L.step = step;
  L.words = words || '';
  L.frac = 0;
  L.eta = null;
  HL.apply(id, (r) => { if (r.work.step === step) return false; r.work.step = step; return true; });
}

const _guard = (L) => { if (!L || L.stopping) throw _cancelled(); };
const _rowOf = (id) => ((HL.get(id) || {}).work || {}).alertId || '';
const _srcFile = (src) => {
  const abs = src && src.videoPath ? toDiskWithin(src.videoPath, [store.SOURCES_DIR]) : null;
  return abs && fs.existsSync(abs) ? abs : null;
};
/** The words kept with a source, as [{ text, start, end }], or null. */
function wordsOf(sourceId) {
  const t = store.readTranscript(sourceId);
  if (!t || !Array.isArray(t.words) || !t.words.length) return null;
  return t.words.map((w) => ({ text: String(w.w || ''), start: +w.s || 0, end: +w.e || 0 })).filter((w) => w.text);
}

// ── The press ───────────────────────────────────────────────────────────────
/**
 * "find moments": the video, how long and how many, and the caption style. Everything is checked before the row is
 * written; the row is written before anything is asked of anybody. Resolves with { alertId }.
 * spec: { from: link|file|source, url, path, sourceId, length, count, style: { preset, name } }
 */
function start(id, spec) {
  id = String(id);
  const rec = HL.get(id);
  const no = (status, error, extra) => Object.assign(new Error(error), { status, ...(extra || {}) });
  if (!rec) throw no(404, 'no such highlights project');
  if (live(id)) throw no(409, 'This project is at work already - follow it in Alerts.');
  // One project - one video (the owner's (х21)).
  if (rec.video) throw no(409, 'This project has its video already - another video is a new highlights project.');
  const s = spec || {};
  const length = HL.LENGTHS[s.length] ? String(s.length) : '';
  const count = HL.COUNTS.includes(Number(s.count)) ? Number(s.count) : 0;
  if (!length) throw no(400, 'choose how long the fragments are');
  if (!count) throw no(400, 'choose how many fragments');
  // The caption style is a MUST (the owner's (х16)): "find moments" is refused without one.
  const style = s.style && typeof s.style === 'object' && String(s.style.preset || '').trim()
    ? { preset: String(s.style.preset).slice(0, 120), name: String(s.style.name || '').slice(0, 120) } : null;
  if (!style) throw no(400, 'choose a caption style');

  let video = null;
  let plan = '';
  let kept = false;
  const from = String(s.from || '');
  if (from === 'link') {
    const url = String(s.url || '').trim();
    if (!/^https?:\/\//i.test(url)) throw no(400, 'that is not a link');
    video = { from, url, path: '', sourceId: '', title: url.slice(0, 200), seconds: 0 };
    plan = 'download';
  } else if (from === 'file') {
    const abs = String(s.path || '');
    if (!abs || !path.isAbsolute(abs)) throw no(400, 'adding a file works in the app\'s own window - it hands the file over');
    let st = null;
    try { st = fs.statSync(abs); } catch (e) { st = null; }
    if (!st || !st.isFile()) throw no(400, 'That file is not there any more.');
    if (INTAKE.AUDIO_FILE_RE.test(abs)) throw no(400, 'A sound without a picture cannot be cut into shorts - choose a video.');
    if (!INTAKE.VIDEO_FILE_RE.test(abs)) throw no(400, 'Not a video file: ' + path.basename(abs));
    video = { from, url: '', path: abs, sourceId: '', title: path.basename(abs, path.extname(abs)).slice(0, 200), seconds: 0, bytes: st.size };
    plan = 'copy';
  } else if (from === 'source') {
    const src = store.get(s.sourceId);
    if (!src) throw no(404, 'no such source');
    if (INTAKE.live(src.id)) throw no(409, 'This source is being added - choose it when it is in.');
    if (!_srcFile(src)) throw no(409, 'This source has no video file.');
    video = { from, url: src.url || '', path: '', sourceId: String(src.id), title: String(src.title || src.id).slice(0, 200), seconds: +src.seconds || 0 };
    kept = !!wordsOf(src.id);
    plan = kept ? 'find' : 'hear';
  } else throw no(400, 'a link, a file, or a source of the Library');
  // Somebody must be able to hear it - unless its words are in already.
  if (!kept) {
    const cant = CAPJOB.cannotHear(null);
    if (cant) throw no(409, cant.error, { code: cant.code });
  }

  const kick = _kick();
  _reserve(id, kick, plan);
  const title = video.from === 'link' ? 'a link' : video.title;
  const row = JOBS.submitted({
    kind: 'highlights', what: 'highlights', title: 'Highlights · ' + title,
    where: { page: 'merge', href: '/merge?p=' + encodeURIComponent(HL.homeKey(id)), label: 'Merge · highlights',
      spot: { key: HL.homeKey(id), view: 'highlights' } },
    engine: plan === 'download' ? 'yt-dlp' : plan === 'copy' ? 'file' : plan === 'hear' ? 'hearing' : 'agent',
    stage: plan === 'download' ? 'reading the link' : plan === 'copy' ? 'reading the file' : plan === 'hear' ? 'hearing the words' : 'finding the moments',
    job: { type: 'highlights', params: { projectId: id, kick } },
  });
  HL.apply(id, (r) => {
    r.video = video;
    r.ask = { length, count, style };
    r.work = { state: 'running', step: plan, alertId: row.id, error: '', startedAt: new Date().toISOString(), endedAt: null, interrupted: '' };
    r.hearing = kept ? { kept: true, at: new Date().toISOString() } : null;
    r.agent = null;
    r.fragments = [];
  });
  if (from === 'source') _name(id, video.title);
  setImmediate(() => _go(id, plan));
  return { alertId: row.id };
}

// The project is named after its video once that is known - unless the person named it themselves.
function _name(id, title) {
  const rec = HL.get(id);
  if (!rec || !title) return;
  const auto = rec.autoName && rec.autoName === rec.name;          // a name this server gave it, for an earlier video
  if (!auto && !/^\d{4}-\d{2}-\d{2} - highlights( \(\d+\))?$/.test(String(rec.name || ''))) return;
  try {
    const got = HL.rename(id, _day() + ' - ' + String(title).replace(/\s+/g, ' ').trim().slice(0, 90));
    HL.apply(id, (r) => { r.autoName = got; });
  } catch (e) { console.warn('[highlights] the project was not renamed:', e.message); }
  const row = _rowOf(id);
  if (row) ALERTS.update(row, { title: 'Highlights · ' + String(title).slice(0, 180) });
}

// ── The work, from `plan` to the end ────────────────────────────────────────
async function _go(id, plan) {
  try {
    if (plan === 'download' || plan === 'copy') { await _fetch(id); plan = 'hear'; }
    if (plan === 'hear') { await _hear(id); plan = 'find'; }
    if (plan === 'find') await _find(id);
    _done(id);
  } catch (e) { _ended(id, e); }
}

// A source this run brings in is followed by the Sources column through this work.
function _adopt(id, sid, made) {
  const L = _live.get(id);
  if (!L) return;
  L.sourceId = String(sid);
  L.made = !!made;
  INTAKE.adopt(sid, {
    progress: () => {
      const p = progress(id);
      if (!p) return null;
      const step = p.step === 'download' && INTAKE.queuePlace(sid) ? 'wait' : (p.step === 'hear' || p.step === 'find' ? 'process' : p.step);
      return { step, words: p.words, pct: p.pct, leftMs: p.leftMs, place: INTAKE.queuePlace(sid) };
    },
    stop: () => stop(id),
    leftMs: () => { const p = progress(id); return p ? p.leftMs : 0; },
  });
}

async function _fetch(id) {
  const L = _live.get(id);
  _guard(L);
  let rec = HL.get(id);
  if (!rec) throw new Error('the project went away');
  const v = rec.video;
  let src = v.sourceId ? store.get(v.sourceId) : null;
  if (!src && v.from === 'link') {
    _step(id, 'download', 'reading the link');
    const meta = await YTDLP.info(v.url, { onProgress: (w) => { L.words = w; } });
    _guard(L);
    if (meta.video === false) throw Object.assign(new Error('This link has no picture - a sound alone cannot be cut into shorts.'), { refused: true });
    // The same video as a source already: taken as it is.
    const had = store.list().find((x) => (meta.key && x.linkKey === meta.key) || (x.url && x.url === meta.url));
    if (had && INTAKE.live(had.id)) throw new Error(`This video is being added as a source right now ("${had.title || had.id}") - choose it from the Library when it is in.`);
    if (had && _srcFile(had)) {
      HL.apply(id, (r) => { r.video.sourceId = String(had.id); r.video.title = String(had.title || meta.label); r.video.seconds = +had.seconds || meta.duration || 0; });
      _name(id, had.title || meta.label);
      return;
    }
    const sid = had ? String(had.id) : store.newId();
    store.ensureDirs();
    const intake = { by: 'highlights', project: id, from: 'link', fromPath: '', step: 'download', alertId: rec.work.alertId,
      items: meta.count > 1 ? '1' : '', startedAt: new Date().toISOString() };
    if (had) store.update(sid, { state: 'waiting', error: '', intake });
    else {
      store.create({ id: sid, kind: 'youtube', title: meta.label, url: meta.url, linkKey: meta.key, channel: meta.channel,
        seconds: meta.duration, bytes: meta.bytes, state: 'waiting', intake });
    }
    HL.apply(id, (r) => {
      r.video.sourceId = sid; r.video.title = String(meta.label || r.video.title); r.video.seconds = +meta.duration || 0;
      r.video.bytes = +meta.bytes || 0; r.video.made = true;
    });
    _name(id, meta.label);
    src = store.get(sid);
  } else if (!src && v.from === 'file') {
    _step(id, 'copy', 'reading the file');
    const p = await PROBE.probe(v.path);
    _guard(L);
    if (!p.w) throw Object.assign(new Error(p.audio ? 'This file has no picture - a sound alone cannot be cut into shorts.' : 'This file cannot be read - is it a video?'), { refused: !!p.audio });
    const sid = store.newId();
    store.ensureDirs();
    store.create({ id: sid, kind: 'file', title: v.title, originalName: path.basename(v.path), seconds: p.duration, bytes: v.bytes || 0, state: 'copying',
      intake: { by: 'highlights', project: id, from: 'file', fromPath: v.path, step: 'copy', alertId: rec.work.alertId, startedAt: new Date().toISOString() } });
    HL.apply(id, (r) => { r.video.sourceId = sid; r.video.seconds = +p.duration || 0; r.video.made = true; });
    _name(id, v.title);
    src = store.get(sid);
  }
  if (!src) throw new Error('the source went away');
  rec = HL.get(id);
  _adopt(id, src.id, !!(rec && rec.video && rec.video.made));
  if (!_srcFile(src)) {
    const sid = String(src.id);
    if (v.from === 'link' || src.url) {
      _step(id, 'download', 'waiting for its turn');
      store.update(sid, { state: 'waiting', error: '' });
      const got = await INTAKE.queueDownload(sid, async () => {
        _guard(L);
        _step(id, 'download', 'starting the download');
        store.update(sid, { state: 'downloading', error: '', intake: { ...(store.get(sid).intake || {}), step: 'download' } });
        return INTAKE.downloadInto(sid, src.url, {
          items: (src.intake && src.intake.items) || '',
          onProgress: (w, pr) => { L.words = w; if (pr) { L.frac = pr.pct; L.eta = pr.eta; } },
          kill: (s) => { L.stop = s; if (L.stopping) s(); },
          fallbackSeconds: src.seconds || 0,
        });
      });
      _guard(L);
      store.update(sid, { ...got, state: 'stored' });
      HL.apply(id, (r) => { r.video.seconds = got.seconds || r.video.seconds; });
    } else {
      _step(id, 'copy', 'copying');
      const from = (src.intake && src.intake.fromPath) || v.path;
      if (!from || !fs.existsSync(from)) throw new Error('The file is not where it was - add it again.');
      const name = sid + path.extname(from).toLowerCase();
      const to = path.join(store.SOURCES_DIR, name);
      await INTAKE.copyFile(from, to, { signal: L.ac.signal, onFrac: (f, done, total) => { L.frac = f; L.words = `Copying · ${Math.round(f * 100)}% of ${_mb(total)}`; } });
      _guard(L);
      store.update(sid, { videoPath: `${store.SOURCES_URL}/${name}`, bytes: fs.statSync(to).size, state: 'stored' });
    }
  }
  // Its poster, as any source has one.
  const now = store.get(src.id);
  if (now && !now.thumbPath) {
    try { const t = await VT.makeThumb(now.videoPath, { at: store.posterAt(now.seconds) }); store.update(src.id, { thumbPath: t.thumb }); }
    catch (e) { /* a grey card, not a lost source */ }
  }
}

// What the row and the tiles say while it is heard: "hearing 12 / 73 min", and where.
function _hearWords(p, total) {
  const where = p.where === 'local' ? ' · on this computer' + (p.pct != null ? ' ' + Math.round(p.pct) + '%' : '') : '';
  const wait = p.wait ? ' · ' + p.wait : '';
  return `hearing ${_min(p.heard)} / ${_min(total)} min${where}${wait}`;
}

async function _hear(id) {
  const L = _live.get(id);
  _guard(L);
  const rec = HL.get(id);
  if (!rec) throw new Error('the project went away');
  const src = store.get(rec.video.sourceId);
  if (!src) throw new Error('the source went away');
  if (!L.sourceId) _adopt(id, src.id, !!rec.video.made);
  const abs = _srcFile(src);
  if (!abs) throw new Error('the source has no video file');
  const kept = wordsOf(src.id);
  if (kept) {
    HL.apply(id, (r) => { r.hearing = { kept: true, words: kept.length, at: new Date().toISOString() }; });
    _sourceIn(L);
    return;
  }
  const seconds = +src.seconds > 0 ? +src.seconds : await PROBE.probe(abs).then((p) => p.duration || 0).catch(() => 0);
  _step(id, 'hear', `hearing 0 / ${_min(seconds)} min`);
  const made = !!rec.video.made;
  const before = store.readTranscript(src.id);
  if (made) store.update(src.id, { state: 'transcribing', error: '', seconds, transcript: { state: 'running' }, intake: { ...(src.intake || {}), step: 'process' } });
  L.heard = { heard: 0, total: seconds, where: GROQ.keyOf() ? 'cloud' : 'local' };
  let out;
  try {
    out = await CAPJOB.hearLong(HL.homeKey(id), abs, {
      seconds, signal: L.ac.signal,
      onProgress: (p) => { L.heard = p; L.words = _hearWords(p, seconds); },
    });
  } catch (e) {
    if (e.code === 'stopped' || L.stopping) throw _cancelled();
    throw e;
  }
  _guard(L);
  if (!out.words.length) throw Object.assign(new Error('No speech was heard in this video - there is nothing to cut it by.'), { noSpeech: true });
  // The source's words - and, for a source that came in now, its transcript, from them: Replicate is not asked.
  const sents = AGENT.sentences(out.words);
  const cost = Math.round((out.paidSeconds || 0) / 3600 * GROQ_PER_HOUR * 10000) / 10000;
  const by = out.engine === 'local' ? 'whisper.cpp (this computer)' : 'whisper-large-v3 (Groq)';
  const has = before && Array.isArray(before.cues) && before.cues.length;
  const cues = has ? before.cues : sents.map((x) => ({ start: x.start, end: x.end, text: x.text }));
  store.writeTranscript(src.id, {
    ...(before || {}), cues,
    model: has ? before.model : by, seconds: has ? before.seconds : out.seconds, cost: has ? before.cost : cost,
    at: has ? before.at : new Date().toISOString(),
    words: out.words.map((w) => ({ w: w.text, s: w.start, e: w.end })),
    segments: out.segments.map((g) => ({ start: g.start, end: g.end, no_speech_prob: g.no_speech_prob, avg_logprob: g.avg_logprob, compression_ratio: g.compression_ratio })),
    wordsBy: { engine: out.engine, model: out.model, language: out.language, at: new Date().toISOString(), cost },
  });
  const words = { n: out.words.length, engine: out.engine, at: new Date().toISOString() };
  if (!has) {
    const chars = cues.reduce((n, c) => n + c.text.length + 1, 0);
    store.update(src.id, { state: 'ready', error: '', seconds: out.seconds || seconds, words,
      transcript: { state: 'ready', cues: cues.length, chars, model: by, cost, seconds: out.seconds } });
  } else store.update(src.id, { words });
  HL.apply(id, (r) => {
    r.hearing = { kept: false, engine: out.engine, model: out.model, language: out.language, fell: out.fell, words: out.words.length,
      seconds: out.seconds, paid: out.paid, reused: out.reused, local: out.local, cost, at: new Date().toISOString() };
  });
  _sourceIn(L);
}

// Its words are in: the source is the Library's from here on - the Sources column stops following this work.
function _sourceIn(L) {
  if (!L || !L.sourceId) return;
  INTAKE.release(L.sourceId);
  if (!L.made) return;
  const s = store.get(L.sourceId);
  if (s && s.intake && s.intake.step !== 'done') store.update(L.sourceId, { intake: { ...s.intake, step: 'done', interrupted: '', error: '' } });
}

async function _find(id) {
  const L = _live.get(id);
  _guard(L);
  const rec = HL.get(id);
  if (!rec) throw new Error('the project went away');
  const words = wordsOf(rec.video.sourceId);
  if (!words) throw new Error('the words of the video are not there - retry hears them again');
  const sents = AGENT.sentences(words);
  if (sents.length < 3) throw Object.assign(new Error('Too little speech in this video to find moments in.'), { noSpeech: true });
  const len = HL.LENGTHS[rec.ask.length] || HL.LENGTHS['30-60'];
  const count = rec.ask.count || 5;
  const seconds = rec.video.seconds || words[words.length - 1].end;
  _step(id, 'find', 'finding the moments');
  // An answer already kept (asked before the app closed, or before a stop): read again, never paid for again.
  let raw = rec.agent && rec.agent.raw && !rec.agent.unreadable ? String(rec.agent.raw) : '';
  let parsed = null;
  if (raw) {
    try { parsed = AGENT.parse(raw, sents, len, count); }
    catch (e) { if (e.refused) throw e; raw = ''; }       // a kept answer of none is the answer; one that cannot be read is asked again
  }
  let by = rec.agent && rec.agent.by;
  if (!parsed) {
    // PAID ONCE: on the record and on the row before anybody is asked.
    const askedAt = new Date().toISOString();
    HL.apply(id, (r) => { r.agent = { askedAt, answeredAt: null, by: null, asked: count, raw: '' }; });
    if (rec.work.alertId) ALERTS.update(rec.work.alertId, { params: { asked: askedAt } });
    const msgs = AGENT.messages({ title: rec.video.title, seconds, sents, len, count });
    const ans = await AGENTS.ask(msgs, { once: true, timeout: AGENT_MS,
      onStep: (st) => { L.words = 'finding the moments · ' + st.model; } });
    // Kept whole the moment it arrives, before it is read - and even when the work was stopped meanwhile: it was paid for.
    if (ans.raw) HL.apply(id, (r) => { r.agent = { ...(r.agent || {}), answeredAt: new Date().toISOString(), by: ans.by, raw: ans.raw.slice(0, 400000), tried: ans.tried }; });
    _guard(L);
    if (!ans.raw) {
      if (ans.unsure) {
        throw new Error('The agent did not answer (' + ans.unsure.provider + ' / ' + ans.unsure.model + ') - it may have read the video and been paid; '
          + 'retry asks it again.');
      }
      throw new Error('No agent could read it: ' + (ans.tried || []).join(' | ').slice(0, 400));
    }
    by = ans.by;
    try { parsed = AGENT.parse(ans.raw, sents, len, count); }
    catch (e) {
      // An answer that cannot be read is no answer: a retry asks again - and says it costs.
      if (!e.refused) HL.apply(id, (r) => { r.agent = { ...(r.agent || {}), unreadable: e.message }; });
      throw e;
    }
  }
  if (!parsed.fragments.length) {
    throw Object.assign(new Error(`None of the ${parsed.asked} moments the agent found is ${len.min}-${len.max} s of whole sentences.`), { refused: true });
  }
  HL.apply(id, (r) => {
    r.agent = { ...(r.agent || {}), found: parsed.fragments.length, dropped: parsed.dropped, by };
    r.fragments = parsed.fragments.map((f) => ({ n: r.nextN++, ...f, state: 'found', key: '', thumb: '', error: '', deletedAt: null }));
  });
}

function _done(id) {
  const L = _live.get(id);
  if (L) L.took[L.step] = Date.now() - L.stepAt;
  _live.delete(id);
  if (L && L.sourceId) INTAKE.release(L.sourceId);
  const rec = HL.apply(id, (r) => { r.work = { ...r.work, state: 'done', step: 'done', error: '', interrupted: '', endedAt: new Date().toISOString(), took: L ? L.took : {} }; });
  _sourceIn(L);
  const n = rec ? (rec.fragments || []).length : 0;
  const want = rec && rec.ask ? rec.ask.count : 0;
  if (rec && rec.work.alertId) {
    ALERTS.finish(rec.work.alertId, { media: 'video', path: '', note: n >= want ? `${n} moments` : `found ${n} of ${want}` });
  }
}

// Every way the work ends but done: stopped, nothing to cut it by, or a failure.
function _ended(id, e) {
  const L = _live.get(id);
  if ((L && L.stopping) || (e && (e.cancelled || e.stopped))) { _stopped(id); return; }
  _live.delete(id);
  if (L && L.sourceId) INTAKE.release(L.sourceId);
  const why = String((e && e.message) || 'it failed');
  const refused = !!(e && (e.noSpeech || e.refused));
  const rec = HL.apply(id, (r) => { r.work = { ...r.work, state: 'failed', error: why, endedAt: new Date().toISOString() }; });
  // The source this run brought in says what became of its way in, as one being added does.
  if (L && L.sourceId && L.made) {
    const s = store.get(L.sourceId);
    if (s && s.state !== 'ready') {
      if (e && e.noSpeech) store.update(L.sourceId, { state: 'nospeech', error: 'No speech in it - not added to the sources. Its line in Sources offers to put it on Uploads.' });
      else {
        const t = s.transcript || null;
        store.update(L.sourceId, { state: 'error', error: why, transcript: t && t.state === 'ready' ? t : (t ? { ...t, state: 'error' } : null) });
      }
    }
  }
  console.warn('[highlights] ' + id + ': ' + why);
  if (rec && rec.work.alertId) ALERTS.fail(rec.work.alertId, why, { refused });
}

function _stopped(id) {
  const L = _live.get(id);
  _live.delete(id);
  if (L && L.sourceId) { INTAKE.release(L.sourceId); INTAKE.unqueue(L.sourceId); }
  let gone = false;
  if (L && L.sourceId && L.made && !wordsOf(L.sourceId)) {
    // Not in yet: it goes, its file and the parts of one with it (a process just killed may hold a file a moment longer).
    _removeSource(L.sourceId);
    gone = true;
  }
  const rec = HL.apply(id, (r) => {
    r.work = { ...r.work, state: 'failed', error: 'stopped', endedAt: new Date().toISOString() };
    if (gone) r.video = null;
  });
  const row = (rec && rec.work.alertId) || '';
  if (row) ALERTS.cancel(row, gone ? 'stopped - its video was let go of' : 'stopped');
}

function _removeSource(sid) {
  try { store.remove(sid); } catch (e) { /* gone already */ }
  let tries = 0;
  const again = () => {
    const left = fs.existsSync(store.SOURCES_DIR) ? fs.readdirSync(store.SOURCES_DIR).filter((f) => f.startsWith(sid + '.')) : [];
    for (const f of left) { try { fs.rmSync(path.join(store.SOURCES_DIR, f), { force: true }); } catch (e) { /* held */ } }
    if (left.length && ++tries < 5) setTimeout(again, 1500).unref();
  };
  setTimeout(again, 500).unref();
}

/** The cross: the row's, the source's line's, or the project being deleted. */
function stop(id) {
  const L = _live.get(String(id));
  if (!L) return false;
  L.stopping = true;
  if (L.sourceId && INTAKE.unqueue(L.sourceId)) return true;     // waiting in the queue: its promise says "cancelled"
  if (L.stop) { try { L.stop(); } catch (e) { /* gone */ } }
  try { L.ac.abort(); } catch (e) { /* aborted */ }
  return true;
}

// ── How far along ───────────────────────────────────────────────────────────
// Expected times: the download by its bytes (8 MB/s until yt-dlp says), the copy at 150 MB/s, the hearing by its length -
// Groq ~20 s a ten-minute piece, this computer ~0.7 of the length (the K1b measure) and then by what it has done - and the
// agent a minute and a half. Never past 95% of a step before it ends.
function _expect(rec, L) {
  const secs = +((rec && rec.video && rec.video.seconds) || 0);
  const bytes = +((rec && rec.video && rec.video.bytes) || 0);
  const local = L && L.heard ? L.heard.where === 'local' : !GROQ.keyOf();
  let hear = local ? secs * 700 : (Math.ceil(secs / 540) * 20000 + 5000);
  if (L && L.heard && L.heard.heard > 30 && L.step === 'hear') {
    const el = Date.now() - L.stepAt;
    hear = Math.max(el + 1000, el / Math.min(1, L.heard.heard / Math.max(1, secs)));
  }
  return { download: bytes ? Math.max(5000, bytes / 8000) : Math.max(20000, secs * 120), copy: Math.max(2000, bytes / 150000), hear, find: 90000 };
}

/** { step, words, pct (0..1), leftMs } of a project at work, or null. */
function progress(id) {
  const L = _live.get(String(id));
  if (!L) return null;
  const rec = HL.get(id);
  const from = rec && rec.video ? rec.video.from : 'link';
  const order = (from === 'link' ? ['download'] : from === 'file' ? ['copy'] : []).concat(['hear', 'find']);
  const E = _expect(rec, L);
  const cur = order.includes(L.step) ? L.step : order[0];
  const i = order.indexOf(cur);
  const before = order.slice(0, i).reduce((n, k) => n + (L.took[k] || E[k]), 0);
  const after = order.slice(i + 1).reduce((n, k) => n + E[k], 0);
  const el = Date.now() - L.stepAt;
  let frac = 0;
  let whole = E[cur];
  if ((cur === 'download' || cur === 'copy') && L.frac > 0) {
    frac = L.frac;
    whole = L.eta != null ? el + L.eta * 1000 : el / frac;
  } else if (cur === 'hear' && L.heard && L.heard.total > 0) {
    frac = Math.min(0.99, L.heard.heard / L.heard.total);
    whole = Math.max(E.hear, el + 1000);
  } else {
    whole = Math.max(E[cur], el / 0.95);
    frac = Math.min(0.95, el / whole);
  }
  const pct = Math.min(0.99, (before + frac * whole) / Math.max(1, before + whole + after));
  let words = L.words || cur;
  if (cur === 'download' && L.sourceId && INTAKE.queuePlace(L.sourceId) > 1) words = `waiting · ${INTAKE.queuePlace(L.sourceId) - 1} download(s) ahead`;
  return { step: cur, words, pct, leftMs: Math.round(whole * (1 - frac) + after) };
}

// The row says the same, at most every two seconds, and only when it changed.
let _rowsT = null;
function _wakeRows() {
  if (_rowsT) return;
  _rowsT = setInterval(() => {
    if (!_live.size) { clearInterval(_rowsT); _rowsT = null; return; }
    for (const [id, L] of _live) {
      const row = _rowOf(id);
      const p = progress(id);
      if (!row || !p) continue;
      const eta = Date.now() + p.leftMs;
      if (p.words === L.saidWords && Math.abs(eta - L.saidEta) < 5000) continue;
      L.saidWords = p.words;
      L.saidEta = eta;
      ALERTS.update(row, { stage: p.words, etaAt: new Date(eta).toISOString() });
    }
  }, ROW_MS);
  if (_rowsT.unref) _rowsT.unref();
}

// ── The row in Alerts ───────────────────────────────────────────────────────
// What "retry" goes on with: the step it was cut at, if what that step needs is still there.
function plan(rec) {
  if (!rec || !rec.video || !rec.ask) return '';
  const src = rec.video.sourceId ? store.get(rec.video.sourceId) : null;
  if (!_srcFile(src)) {
    if (rec.video.from === 'link' && rec.video.url) return 'download';
    if (rec.video.from === 'file') {
      const p = (src && src.intake && src.intake.fromPath) || rec.video.path;
      return p && fs.existsSync(p) ? 'copy' : '';
    }
    return '';
  }
  if (!wordsOf(src.id)) return 'hear';
  if (!(rec.fragments || []).length) return 'find';
  return '';
}
const _rowProject = (row) => String((((row || {}).job || {}).params || {}).projectId || '');
const _rowPlan = (row) => (row && !_live.has(_rowProject(row)) ? plan(HL.get(_rowProject(row))) : '');
const STAGE = { download: 'waiting', copy: 'copying', hear: 'hearing the words', find: 'finding the moments' };

JOBS.register('highlights', {
  // The work ends its own row; the runner only notices a row nobody is working on any more - the app was closed.
  timeoutMs: 7 * 24 * 3600 * 1000,
  poll: async (row) => {
    const p = (row.job || {}).params || {};
    const L = _live.get(String(p.projectId || ''));
    if (L && L.kick === p.kick) return { state: 'pending' };
    const rec = HL.get(p.projectId);
    const why = (rec && (rec.work.interrupted || rec.work.error)) || 'interrupted - the app was closed while this was being made';
    return { state: 'failed', error: why, refused: false };
  },
  file: async () => ({ path: '', media: 'video' }),
  canRetry: (row) => !!_rowPlan(row),
  // A download goes on from its part, a copy is a copy, this computer hears for nothing, and an answer kept is read again
  // without asking anybody: one press.
  free: (row) => {
    const pl = _rowPlan(row);
    const rec = pl === 'find' ? HL.get(_rowProject(row)) : null;
    return pl === 'download' || pl === 'copy' || (pl === 'hear' && !GROQ.keyOf()) || !!(rec && rec.agent && rec.agent.raw && !rec.agent.unreadable);
  },
  busy: (row) => _live.has(_rowProject(row)),
  cancel: (row) => { stop(_rowProject(row)); },
  submit: async (_request, row) => {
    const id = _rowProject(row);
    const pl = _rowPlan(row);
    if (!pl) throw new Error('there is nothing left to go on with');
    if (pl === 'hear') { const cant = CAPJOB.cannotHear(null); if (cant) throw new Error(cant.error); }
    const kick = _kick();
    _reserve(id, kick, pl);
    HL.apply(id, (r) => { r.work = { ...r.work, state: 'running', step: pl, error: '', interrupted: '', endedAt: null }; });
    return { params: { projectId: id, kick }, stage: STAGE[pl], later: () => { const L = _live.get(id); if (L && L.kick === kick) _go(id, pl); } };
  },
});

/** The field's own "retry" - the same as the row's. Resolves with the row's id. */
async function retry(id) {
  const rec = HL.get(id);
  const row = rec && rec.work.alertId ? ALERTS.get(rec.work.alertId) : null;
  if (!row) throw Object.assign(new Error('nothing to retry'), { status: 409 });
  if (row.state === 'running') throw Object.assign(new Error('it is still running'), { status: 409 });
  if (!ALERTS.view(row).retryable) throw Object.assign(new Error('there is nothing left to go on with'), { status: 409 });
  await JOBS.retry(row.id);
  return row.id;
}

// ── At start ────────────────────────────────────────────────────────────────
// Nothing is at work when the server starts, so a project left running was cut off by the app closing: it says so - on its
// record and, through the runner's first look at its row, in red in Alerts - and waits for "retry". A part downloaded stays
// for it; a copy cut off goes (the retry copies again).
function boot() {
  for (const rec of HL.list()) {
    if (!rec.work || rec.work.state !== 'running') continue;
    const step = rec.work.step;
    const words = 'interrupted - the app was closed while ' + ({ download: 'its video was being downloaded', copy: 'its video was being copied',
      hear: 'its words were being heard', find: 'its moments were being found' }[step] || 'it was being made');
    try {
      HL.apply(rec.id, (r) => { r.work = { ...r.work, state: 'failed', interrupted: words, error: words }; });
      const sid = rec.video && rec.video.sourceId;
      const s = sid ? store.get(sid) : null;
      if (s && rec.video.made && s.state !== 'ready') {
        if (s.state === 'copying') store.parts(sid);
        const t = s.transcript || null;
        store.update(sid, { state: 'error', error: words, transcript: t && t.state === 'ready' ? t : (t ? { ...t, state: 'error' } : null),
          intake: { ...(s.intake || {}), interrupted: words } });
      }
    } catch (e) { console.warn('[highlights] could not mark', rec.id, 'interrupted:', e.message); }
  }
}

// ── The price on the button (the owner's (х13)) ────────────────────────────
/** { hear: { by: groq|local|kept|none, why, cost, perHour }, agent: { cost }, total } - `seconds` 0 when not known yet. */
function price({ seconds = 0, sourceId = '' } = {}) {
  const secs = Math.max(0, +seconds || 0);
  let by = GROQ.keyOf() ? 'groq' : 'local';
  let why = '';
  if (sourceId && wordsOf(sourceId)) by = 'kept';
  else {
    const cant = CAPJOB.cannotHear(null);
    if (cant) { by = 'none'; why = cant.error; }
  }
  const hear = by === 'groq' ? (secs ? Math.round(secs / 3600 * GROQ_PER_HOUR * 10000) / 10000 : null) : 0;
  // An hour of speech is ~9 000 words, ~60 000 characters with their times.
  const agent = AGENT.priceOf(secs ? secs * 17 : 60000, 10);
  return { hear: { by, why, cost: hear, perHour: GROQ_PER_HOUR }, agent: { cost: agent },
    total: hear == null ? null : Math.round((hear + agent) * 10000) / 10000 };
}

module.exports = { start, stop, retry, progress, live, plan, boot, price, wordsOf };
