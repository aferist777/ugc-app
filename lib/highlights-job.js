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
const CUT = require('./highlights-cut');
const HLM = require('./highlights-music');
const FACES = require('./faces');
const FRAMING = require('../public/js/framing/path.js');
const TRACKS = require('./audio-tracks');
const AGENTS = require('./agents');
const CAPJOB = require('./captions-job');
const SUBS = require('./subs-store');
const GROQ = require('./groq-stt');
const { toDiskWithin } = require('./media');

const GROQ_PER_HOUR = 0.111;              // whisper-large-v3 on Groq, dollars an hour of sound (lib/groq-stt.js)
// (phase V69 P12, the owner's words of P8: "нужно давать время на размышления иначе будет отдаваться полная чушь") THE AGENT THINKS:
// effort high - at medium Sonnet 5.5 wrote a stand-in after 1 s (0 of 20 moments of lecture 20), at high 20 of 20 after 77 s, the
// gold podcast in 30 parts after 137 s ((хп79), (хп89)). Its thinking is part of its answer, so the answer may be long: 64 000
// tokens, streamed (only what is written is paid), and minutes to wait.
const AGENT_EFFORT = 'high';
const AGENT_TOKENS = 64000;
const AGENT_MS = 10 * 60 * 1000;          // the moments of a long video, thought over
const FRAG_AGENT_MS = 15 * 60 * 1000;     // (V43) fragmentation writes every part of the video - an answer several times as long
const ROW_MS = 2000;

const _kick = () => 'k' + crypto.randomBytes(6).toString('hex');
const _cancelled = () => Object.assign(new Error('cancelled'), { cancelled: true });
const _day = () => { const d = new Date(), two = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`; };
const _mb = (b) => (b >= 1e9 ? (b / 1e9).toFixed(1) + ' GB' : Math.round(b / 1e6) + ' MB');
const _min = (s) => Math.max(0, Math.round((+s || 0) / 60));
const r2 = (t) => Math.round((+t || 0) * 100) / 100;

// projectId -> { kick, step: download|copy|hear|find, words, frac, eta, stepAt, startedAt, took, ac, stop, stopping,
//                sourceId, made (this run brought the source in), heard, saidWords, saidEta }
const _live = new Map();
const live = (id) => _live.has(String(id));

// `took` (phase V40): what the steps done before took, kept from an earlier run - a retry's panel says it, and its "left" counts it.
function _reserve(id, kick, plan, took) {
  _live.set(String(id), { kick, step: plan, words: '', frac: 0, eta: null, stepAt: Date.now(), startedAt: Date.now(), took: { ...(took || {}) },
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
// (phase V43, (ё17)) A source's video in the library, or where the person keeps it on the disk - never copied in.
const _srcFile = (src) => store.fileOf(src);
// (phase V43, (ё18)) The sound track the project hears and cuts - its place among the file's audio streams - or null: the
// file's own pick, as before.
const _track = (rec) => (rec && rec.video && rec.video.audio && Number.isInteger(rec.video.audio.k) && rec.video.audio.k >= 0 ? rec.video.audio.k : null);
// The transcript that holds the words a project reads: the track's own (V43), or the main one.
const _transcriptOf = (sourceId, track) => (track == null ? store.readTranscript(sourceId) : store.wordsOfTrack(sourceId, track));
/** The words kept with a source - of sound track `track` when one is chosen (V43) - as [{ text, start, end }], or null. */
function wordsOf(sourceId, track = null) {
  const t = _transcriptOf(sourceId, track);
  if (!t || !Array.isArray(t.words) || !t.words.length) return null;
  return t.words.map((w) => ({ text: String(w.w || ''), start: +w.s || 0, end: +w.e || 0 })).filter((w) => w.text);
}

/**
 * (phase V69 P12) What the agent reads - and what an answer kept on the record is read again by: { words, sents } of the project's
 * video by sentence rule `rule` (lib/highlights-agent.js SENT_RULES). Rule 2 (since P12, (хп85)): the words cleaned first as the
 * captions clean them (public/js/captions/heard.js cleanWords - Whisper's inventions in silence and its loops left out), then cut
 * at 15 s; rule 1 (before): the words as heard, cut at 30 s - its numbers are the ones an answer of then speaks of. null - no words.
 */
function agentText(rec, rule) {
  const track = _track(rec);
  const words = wordsOf(rec.video.sourceId, track);
  if (!words) return null;
  let ws = words;
  if (rule >= 2) {
    const t = _transcriptOf(rec.video.sourceId, track) || {};
    ws = require('./mv3b-subs').HEARD.cleanWords(words, Array.isArray(t.segments) ? t.segments : [], { gaps: [], typed: [], fixed: [] }).words;
  }
  return { words: ws, sents: AGENT.sentences(ws, rule) };
}

/**
 * (phase V69 P12, P11's finding) The language the video is spoken in: the one MOST of its words were heard in - window by window, as
 * every highlights project of the same video kept them (lib/subs-store.js) -, else what its transcript says (until P12 the first
 * window's: lecture 22's opening music made it "English"). '' when nobody said.
 */
function languageOf(rec) {
  const sid = rec && rec.video ? rec.video.sourceId : '';
  if (!sid) return '';
  const track = _track(rec);
  const norm = (s) => { const L = String(s || '').trim(); return L ? L[0].toUpperCase() + L.slice(1).toLowerCase() : ''; };
  const tally = {};
  for (const r of HL.list()) {
    if (!r.video || r.video.sourceId !== sid || _track(r) !== track) continue;
    let doc = null;
    try { doc = SUBS.read(HL.homeKey(r.id)); } catch (e) { doc = null; }
    for (const a of Object.values((doc && doc.answers) || {})) {
      const ans = (a && a.answer) || {};
      const L = norm(ans.language || a.language);
      const n = Array.isArray(ans.words) ? ans.words.length : 0;
      if (L && n) tally[L] = (tally[L] || 0) + n;
    }
  }
  const best = Object.entries(tally).sort((x, y) => y[1] - x[1])[0];
  if (best) return best[0];
  const t = _transcriptOf(sid, track) || {};
  return norm((t.wordsBy && t.wordsBy.language) || (rec.hearing && rec.hearing.language));
}

// ── The press ───────────────────────────────────────────────────────────────
/**
 * "find moments": the video, how long and how many, and the caption style. Everything is checked before the row is
 * written; the row is written before anything is asked of anybody. Resolves with { alertId }.
 * spec: { from: link|file|source, url, path, sourceId, length, count, style: { preset, name }, title: true to lay a title on top
 *         (V40: none by default),
 *         kind: auto|podcast|documentary|fragmentation,
 *         moods: [mood ids of Music -> highlights, 'yours' for its root] (V68 P3 - the tracks of those moods; none, no music) }
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
  // (phase V33.6) The kind of video - auto unless one of the others is asked (V33.8: an old `facts` is documentary).
  const kind = HL.kindKey(s.kind);
  // (phase V43, (ё1), (ё8)) fragmentation: the whole video in parts of its own lengths - no count, as many as come out.
  const whole = HL.isWhole(kind);
  const length = HL.lengthsOf(kind)[s.length] ? String(s.length) : '';
  const count = whole ? 0 : (HL.COUNTS.includes(Number(s.count)) ? Number(s.count) : 0);
  if (!length) throw no(400, whole ? 'choose how long the parts are' : 'choose how long the fragments are');
  if (!count && !whole) throw no(400, 'choose how many fragments');
  // The caption style is a MUST (the owner's (х16)): "find moments" is refused without one.
  const one = (x) => (x && typeof x === 'object' && String(x.preset || '').trim()
    ? { preset: String(x.preset).slice(0, 120), name: String(x.name || '').slice(0, 120) } : null);
  let style = one(s.style);
  if (!style) throw no(400, 'choose a caption style');
  // (phase V33.8, the owner's (в1)) "By the video": the style for a talk and the one for a story told, the agent's finding
  // choosing between them; with a kind chosen in the popup it is that kind's own at once.
  if (style.preset === HL.BY_VIDEO) {
    const by = { podcast: one(s.style.byKind && s.style.byKind.podcast), documentary: one(s.style.byKind && s.style.byKind.documentary) };
    if (!by.podcast || !by.documentary || by.podcast.preset === HL.BY_VIDEO || by.documentary.preset === HL.BY_VIDEO) {
      throw no(400, 'choose a caption style');
    }
    style = kind === 'auto' ? { preset: HL.BY_VIDEO, name: style.name || 'by the video', byKind: by } : (by[kind] || by.podcast);
  }
  // (phase V49, the owner's (пр25)) Several styles picked with Shift: every fragment the same set, dealt page by page - they replace
  // "by the video". And (пр26) the animations picked: one is every page's In and Out, several are dealt.
  const mix = (Array.isArray(s.style.mix) ? s.style.mix : []).map(one).filter((x) => x && x.preset !== HL.BY_VIDEO).slice(0, 40);
  if (mix.length >= 2) style = { preset: mix[0].preset, name: mix[0].name, mix };
  const { normalizeStyle } = require('./mv3b-subs');
  const anims = (normalizeStyle({ anims: Array.isArray(s.style.anims) ? s.style.anims : [] }).anims || []).slice(0, 40);
  if (anims.length) style = { ...style, anims };
  // (phase V68 P4, the owner's (хп8), (хп10)) The fonts picked in the fonts tab - shipped families only; none, the presets' own.
  const fonts = (normalizeStyle({ fonts: Array.isArray(s.style.fonts) ? s.style.fonts : [] }).fonts || []).slice(0, 40);
  if (fonts.length) style = { ...style, fonts };
  // (phase V33.8, H3; V68 P3, (хп20), (хп39)) The background music: the MOODS ticked in the popup, as the tracks in them now -
  // each fragment one of them (`deal`); none ticked, none laid.
  const { moods, tracks: music } = HLM.ofMoods(s.moods);

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
    if (!_srcFile(src)) throw no(409, src.diskPath ? 'Its video is not where it was: ' + src.diskPath : 'This source has no video file.');
    video = { from, url: src.url || '', path: '', sourceId: String(src.id), title: String(src.title || src.id).slice(0, 200), seconds: +src.seconds || 0 };
    kept = !!wordsOf(src.id, Number.isInteger(+s.audio) && +s.audio >= 0 && s.audio !== '' && s.audio != null ? +s.audio : null);
    plan = kept ? 'find' : 'hear';
  } else throw no(400, 'a link, a file, or a source of the Library');
  // (phase V43, (ё18)) The sound track chosen in the popup (a file with more than one): heard and cut, the words of it kept.
  if (s.audio != null && s.audio !== '' && Number.isInteger(+s.audio) && +s.audio >= 0) {
    video.audio = { k: +s.audio, label: String(s.audioLabel || '').slice(0, 80) };
  }
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
    // (phase V40, the owner's (о4): "по умолчанию его нет") NO title on top unless asked for (`title: true`) - the popup has no
    // box for it any more; the card's "add title" puts the agent's headline on one. A record of before keeps what it asked.
    r.ask = { length, count, style, title: s.title === true, kind, music, moods };
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
    if (plan === 'find') { await _find(id); plan = 'fragments'; }
    if (plan === 'fragments') await _fragments(id);
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
    // (phase V43, the owner's (ё17), (ё17а)) The file is NOT copied into the library: the source remembers where it lies (its
    // `diskPath`, never an address) and its print. The same file added again - here, or moved, by its print - is its source as
    // it is, words and all; a file whose source was deleted with its transcripts kept gets them back (lib/sources-store.js).
    _step(id, 'copy', 'reading the file');
    const p = await PROBE.probe(v.path);
    _guard(L);
    if (!p.w) throw Object.assign(new Error(p.audio ? 'This file has no picture - a sound alone cannot be cut into shorts.' : 'This file cannot be read - is it a video?'), { refused: !!p.audio });
    const print = store.printOf(v.path);
    const had = store.findOnDisk(v.path, print);
    if (had && INTAKE.live(had.id)) throw new Error(`This video is being added as a source right now ("${had.title || had.id}") - choose it from the Library when it is in.`);
    let sid;
    if (had) {
      sid = String(had.id);
      if (had.diskPath !== v.path || !had.diskPrint) store.update(sid, { diskPath: v.path, diskPrint: print || had.diskPrint || '' });
      HL.apply(id, (r) => { r.video.sourceId = sid; r.video.seconds = +had.seconds || +p.duration || 0; });
      _name(id, had.title || v.title);
    } else {
      const keptId = store.takeKept(print);
      sid = keptId || store.newId();
      store.ensureDirs();
      store.create({ id: sid, kind: 'file', title: v.title, originalName: path.basename(v.path), seconds: p.duration, bytes: v.bytes || 0,
        state: keptId ? 'ready' : 'stored', diskPath: v.path, diskPrint: print,
        intake: { by: 'highlights', project: id, from: 'file', fromPath: v.path, step: 'copy', alertId: rec.work.alertId, startedAt: new Date().toISOString() } });
      HL.apply(id, (r) => { r.video.sourceId = sid; r.video.seconds = +p.duration || 0; r.video.made = !keptId; });
      _name(id, v.title);
    }
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
    } else if (src.diskPath) {
      // (V43) A video that stays on the disk and is not there any more: pointed at again from its source (the Library's
      // sources) or the field's "point at the file", or deleted there.
      throw Object.assign(new Error('The video is not where it was: ' + src.diskPath + ' - point at it again, or delete its source.'), { missing: true });
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
    try {
      if (now.diskPath) {
        // (V43) Never beside the person's file: in the library's sources folder.
        const name = String(now.id) + '_thumb.jpg';
        await VT.posterFrame(now.diskPath, path.join(store.SOURCES_DIR, 'thumbs', name), { at: store.posterAt(now.seconds) });
        store.update(src.id, { thumbPath: store.SOURCES_URL + '/thumbs/' + name });
      } else {
        const t = await VT.makeThumb(now.videoPath, { at: store.posterAt(now.seconds) });
        store.update(src.id, { thumbPath: t.thumb });
      }
    } catch (e) { /* a grey card, not a lost source */ }
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
  if (!abs) throw new Error(src.diskPath ? 'The video is not where it was: ' + src.diskPath : 'the source has no video file');
  // (V43, (ё19)) fragmentation: the hidden window counts the whole source while it is heard and split.
  if (HL.isWhole(HL.kindOf(rec))) _sourceFaces(id, L, abs);
  // (V43, (ё18)) The chosen sound track - one the file has.
  const track = _track(rec);
  if (track != null) {
    const tracks = await TRACKS.tracksOf(abs);
    if (track >= tracks.length) throw new Error('The video has no sound track ' + (track + 1) + ' - it has ' + tracks.length + '.');
  }
  const kept = wordsOf(src.id, track);
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
      seconds, signal: L.ac.signal, ...(track != null ? { audio: track } : {}),
      onProgress: (p) => { L.heard = p; L.words = _hearWords(p, seconds); },
    });
  } catch (e) {
    if (e.code === 'stopped' || L.stopping) throw _cancelled();
    throw e;
  }
  _guard(L);
  if (!out.words.length) throw Object.assign(new Error('No speech was heard in this video - there is nothing to cut it by.'), { noSpeech: true });
  // The source's words - and, for a source that came in now, its transcript, from them: Replicate is not asked.
  // The transcript's cues as they always were (sentence rule 1) - what the agent reads is agentText's.
  const sents = AGENT.sentences(out.words, 1);
  const cost = Math.round((out.paidSeconds || 0) / 3600 * GROQ_PER_HOUR * 10000) / 10000;
  const by = out.engine === 'local' ? 'whisper.cpp (this computer)' : 'whisper-large-v3 (Groq)';
  const has = before && Array.isArray(before.cues) && before.cues.length;
  const cues = has ? before.cues : sents.map((x) => ({ start: x.start, end: x.end, text: x.text }));
  // (V43, (ё18)) Another track than the transcript's own: its words beside it, the transcript untouched.
  const theirs = before && Array.isArray(before.words) && before.words.length && track != null && store.mainTrack(src.id) !== track;
  if (theirs) {
    store.writeTrackWords(src.id, track, {
      words: out.words.map((w) => ({ w: w.text, s: w.start, e: w.end })),
      segments: out.segments.map((g) => ({ start: g.start, end: g.end, no_speech_prob: g.no_speech_prob, avg_logprob: g.avg_logprob, compression_ratio: g.compression_ratio })),
      wordsBy: { engine: out.engine, model: out.model, language: out.language, at: new Date().toISOString(), cost: Math.round((out.paidSeconds || 0) / 3600 * GROQ_PER_HOUR * 10000) / 10000, track },
    });
    HL.apply(id, (r) => {
      r.hearing = { kept: false, engine: out.engine, model: out.model, language: out.language, fell: out.fell, words: out.words.length,
        seconds: out.seconds, paid: out.paid, reused: out.reused, local: out.local, track, at: new Date().toISOString() };
    });
    _sourceIn(L);
    return;
  }
  store.writeTranscript(src.id, {
    ...(before || {}), cues,
    model: has ? before.model : by, seconds: has ? before.seconds : out.seconds, cost: has ? before.cost : cost,
    at: has ? before.at : new Date().toISOString(),
    words: out.words.map((w) => ({ w: w.text, s: w.start, e: w.end })),
    segments: out.segments.map((g) => ({ start: g.start, end: g.end, no_speech_prob: g.no_speech_prob, avg_logprob: g.avg_logprob, compression_ratio: g.compression_ratio })),
    wordsBy: { engine: out.engine, model: out.model, language: out.language, at: new Date().toISOString(), cost, ...(track != null ? { track } : {}) },
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
  const now = agentText(rec, AGENT.SENT_RULE);
  if (!now) throw new Error('the words of the video are not there - retry hears them again');
  if (now.sents.length < 3) throw Object.assign(new Error('Too little speech in this video to find moments in.'), { noSpeech: true });
  // (phase V43) fragmentation: the whole video in parts - its own rules and answer (lib/highlights-agent.js fragParse).
  const whole = HL.isWhole(HL.kindOf(rec));
  // (V43, (ё19)) Its words were in already (a source of the Library): the counting begins here, beside the agent.
  if (whole) { const a = _srcFile(store.get(rec.video.sourceId)); if (a) _sourceFaces(id, L, a); }
  const len = HL.lengthOf(rec);
  const count = rec.ask.count || 5;
  const seconds = rec.video.seconds || now.words[now.words.length - 1].end;
  const read = (raw, T) => (whole ? AGENT.fragParse(raw, T.sents, len, seconds, T.words) : AGENT.parse(raw, T.sents, len, count));
  _step(id, 'find', whole ? 'splitting the video into parts' : 'finding the moments');
  // An answer already kept (asked before the app closed, or before a stop - or one that could not be read before, (хп78)): read
  // again by the sentence rule it was asked under, never paid for again.
  let parsed = null;
  if (rec.agent && rec.agent.raw) {
    try { parsed = _readKept(rec); }
    catch (e) { if (e.refused) throw e; parsed = null; }  // a kept answer of none is the answer; one that cannot be read is asked again
    if (parsed && rec.agent.unreadable) HL.apply(id, (r) => { if (r.agent) delete r.agent.unreadable; });
  }
  let by = rec.agent && rec.agent.by;
  if (!parsed) {
    // (V69 P12) The language the video is spoken in, for the headline.
    const language = languageOf(rec);
    // PAID ONCE: on the record and on the row before anybody is asked - with the sentence rule its numbers will speak of.
    const askedAt = new Date().toISOString();
    HL.apply(id, (r) => { r.agent = { askedAt, answeredAt: null, by: null, asked: count, raw: '', rule: AGENT.SENT_RULE, language }; });
    if (rec.work.alertId) ALERTS.update(rec.work.alertId, { params: { asked: askedAt } });
    // (phase V33.8) The kind's own rules go with the shared ones, in the same call.
    // (phase V43) fragmentation: its own rules.
    const msgs = whole ? AGENT.fragMessages({ title: rec.video.title, seconds, sents: now.sents, len, language })
      : AGENT.messages({ title: rec.video.title, seconds, sents: now.sents, len, count, kind: HL.kindOf(rec), language });
    // (phase V69 P12) At effort high, with room to think - the chats' writers stay at low.
    const ans = await AGENTS.ask(msgs, { once: true, timeout: whole ? FRAG_AGENT_MS : AGENT_MS, effort: AGENT_EFFORT, maxTokens: AGENT_TOKENS,
      onStep: (st) => { L.words = (whole ? 'splitting the video into parts · ' : 'finding the moments · ') + st.model; } });
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
    try { parsed = read(ans.raw, now); }
    catch (e) {
      // An answer that cannot be read is no answer: a retry asks again - and says it costs.
      if (!e.refused) HL.apply(id, (r) => { r.agent = { ...(r.agent || {}), unreadable: e.message }; });
      throw e;
    }
  }
  if (!parsed.fragments.length) {
    throw Object.assign(new Error(`None of the ${parsed.asked} moments the agent found is ${len.min}-${len.max} s of whole sentences.`), { refused: true });
  }
  // (phase V33.8, H3; V68 P3) Each fragment its own track of the moods ticked, none twice while there are enough.
  const dealt = HLM.deal((rec.ask && rec.ask.music) || [], parsed.fragments.length);
  HL.apply(id, (r) => {
    // (V33.8) What auto found the video to be: it chooses the captions "by the video" and the frame where there is no face.
    r.agent = { ...(r.agent || {}), found: parsed.fragments.length, dropped: parsed.dropped, by, kind: HL.kindOf(r) === 'auto' ? parsed.kind : '',
      // (V43) fragmentation: what was cut out (the intro, an ad, the outro, a recap) and what the server mended in the answer.
      ...(whole ? { skipped: parsed.skipped, mended: parsed.mended } : {}) };
    r.fragments = parsed.fragments.map((f, k) => ({ n: r.nextN++, ...f, state: 'found', key: '', thumb: '', error: '', deletedAt: null,
      music: dealt[k] || null }));
  });
}

/**
 * (phase V69 P12, (хп78)) The answer kept on a record, read by the sentence rule it was asked under (`agent.rule`; none - rule 1,
 * before P12) - as its moments or parts. Throws as the reading does ({ refused } for an answer of none).
 */
function _readKept(rec) {
  const a = rec.agent;
  const rule = +a.rule || 1;
  const T = agentText(rec, rule);
  if (!T || !T.sents.length) throw new Error('the words of the video are not there');
  const whole = HL.isWhole(HL.kindOf(rec));
  const len = HL.lengthOf(rec);
  const seconds = rec.video.seconds || T.words[T.words.length - 1].end;
  return whole ? AGENT.fragParse(String(a.raw), T.sents, len, seconds, T.words) : AGENT.parse(String(a.raw), T.sents, len, rec.ask.count || 5);
}
// Does a record's kept answer read now - "retry" then goes on without paying. Asked by Alerts at every look: kept per answer.
const _readsMemo = new Map();
function _keptReads(rec) {
  const a = rec && rec.agent;
  if (!a || !a.raw || !rec.video || !rec.ask) return false;
  const key = rec.id + '|' + (a.answeredAt || '') + '|' + String(a.raw).length + '|' + (+a.rule || 1);
  if (_readsMemo.has(key)) return _readsMemo.get(key);
  let ok;
  try { ok = !!_readKept(rec); } catch (e) { ok = !!e.refused; }
  if (_readsMemo.size > 200) _readsMemo.clear();
  _readsMemo.set(key, ok);
  return ok;
}

// ── The fragments (block 3) ────────────────────────────────────────────────
// Each moment by itself, TWO AT A TIME (the plan's step 9): its pieces cut, its first frame, its timeline - and its tile
// shows its own way along from the moment it starts. One that fails says why on its tile and stops nothing; "retry" (free)
// cuts again what is not made. One deleted before its turn is not cut.
const AT_ONCE = 2;
// A fragment's own way along: its pieces cut, then their faces found (phase V33.2).
const CUT_SHARE = 0.75;
const _frag = (r, n) => (r.fragments || []).find((f) => f.n === n) || null;

async function _fragments(id) {
  const L = _live.get(id);
  _guard(L);
  const rec = HL.get(id);
  if (!rec) throw new Error('the project went away');
  const src = store.get(rec.video.sourceId);
  const abs = _srcFile(src);
  if (!abs) throw new Error(src && src.diskPath ? 'The video is not where it was: ' + src.diskPath + ' - point at it again' : 'the source has no video file - it was deleted from the Library');
  const t = _transcriptOf(src.id, _track(rec)) || {};
  const words = wordsOf(src.id, _track(rec)) || [];
  const segments = Array.isArray(t.segments) ? t.segments : [];
  const todo = (rec.fragments || []).filter((f) => !f.deletedAt && f.state !== 'ready').map((f) => f.n);
  _step(id, 'fragments', 'cutting the fragments');
  L.frags = new Map(todo.map((n) => [n, { pct: 0, words: 'waiting' }]));
  L.fragsAll = todo.length;
  // (V33.8) The style "by the video" is the one for the kind the agent found.
  // (V49) The captions: the preset - or several, and the animations (HL.captionsOf).
  const ctx = { abs, words, segments, total: +src.seconds || +rec.video.seconds || 0, preset: HL.captionsOf(rec), title: rec.ask.title === true, audio: _track(rec) };
  let next = 0;
  const worker = async () => {
    while (next < todo.length) {
      _guard(L);
      const n = todo[next++];
      try { await _cutOne(id, n, ctx, L); }
      catch (e) {
        if (e.cancelled || L.stopping) throw _cancelled();
        HL.apply(id, (r) => { const f = _frag(r, n); if (f) { f.state = 'failed'; f.error = String(e.message || e).slice(0, 300); } });
        console.warn('[highlights] ' + id + ' fragment ' + n + ': ' + e.message);
      } finally { L.frags.delete(n); L.fragsDone = (L.fragsDone || 0) + 1; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(AT_ONCE, todo.length) }, worker));
  _guard(L);
}

// (phase V43, (ё19)) fragmentation's source counted ONCE by the hidden window - faces, people and the most active - begun as
// soon as the video is in (the hearing and the agent go on meanwhile), awaited by the parts. One promise a run; a failure is
// each part's to say (framed from the middle).
function _sourceFaces(id, L, abs) {
  if (!L.sourceFaces) {
    L.facesFrac = 0;
    L.facesFrom = null;
    // `facesFrom` - the first moment it moved: the count's own pace says how long the rest takes (progress).
    const onFrac = (x) => { if (!L.facesFrom && x > 0) L.facesFrom = { at: Date.now(), x }; L.facesFrac = x; };
    L.sourceFaces = FACES.find(abs, { signal: L.ac.signal, people: true, active: true, onFrac })
      .then((r) => { L.facesFrac = 1; return r; }, (e) => { L.facesFrac = 1; throw e; });
    L.sourceFaces.catch((e) => { console.warn('[highlights] ' + id + ': the source not counted - ' + (e && e.message || e)); });
  }
  return L.sourceFaces;
}

async function _cutOne(id, n, ctx, L) {
  let rec = HL.get(id);
  const f = rec && _frag(rec, n);
  if (!f || f.deletedAt) return;
  HL.apply(id, (r) => { const x = _frag(r, n); if (x) { x.state = 'cutting'; x.error = ''; } });
  const dir = HL.dirOf(id, 'clips');
  const base = HL.urlOf(id) + 'clips/';
  const whole = f.pieces.reduce((s, p) => s + (p.end - p.start), 0) || 1;
  let done = 0;
  const pieces = [];
  for (let k = 0; k < f.pieces.length; k++) {
    _guard(L);
    const p = f.pieces[k];
    const name = `hl${n}_${k + 1}.mp4`;
    const out = path.join(dir, name);
    L.frags.set(n, { pct: CUT_SHARE * done / whole, words: f.pieces.length > 1 ? `cutting piece ${k + 1} of ${f.pieces.length}` : 'cutting' });
    const got = await CUT.cutPiece(ctx.abs, out, p.start, p.end, ctx.total, {
      signal: L.ac.signal, audio: ctx.audio,
      onFrac: (x) => { const s = L.frags.get(n); if (s) s.pct = CUT_SHARE * (done + x * (p.end - p.start)) / whole; },
    });
    done += p.end - p.start;
    pieces.push({ src: base + name, abs: out, name: f.title + (f.pieces.length > 1 ? ' · ' + (k + 1) : ''), start: p.start, end: p.end,
      before: got.before, seconds: got.seconds });
  }
  _guard(L);
  // (phase V33.2) THE FACE: each piece's faces counted by the app's hidden window (lib/faces.js) and the window's path worked
  // out from them (public/js/framing/path.js). Not counted - no desktop shell, the window could not - the piece is framed from
  // its middle, as before, and the fragment is made all the same: it says why on its card.
  let faceNote = '';
  for (let k = 0; k < pieces.length; k++) {
    _guard(L);
    const p = pieces[k];
    L.frags.set(n, { pct: CUT_SHARE + (1 - CUT_SHARE - 0.02) * (k / pieces.length), words: pieces.length > 1 ? `finding the face · ${k + 1} of ${pieces.length}` : 'finding the face' });
    try {
      // (phase V33.6) Whole people too where there is no face - for the kind that looks for them (auto). (V33.8) A
      // documentary's shot with no face: a 3:2 window from the middle over the blur, not the whole frame ((ф1)) - and auto's
      // when the agent found a documentary ((в2)).
      const { people, wide, active, zoom } = HL.framingOf(HL.get(id));
      if (active) {
        // (phase V43, (ё19)) fragmentation: the SOURCE counted once, with the most active - this piece reads its own stretch
        // of it (the piece's file starts `before` ahead of the part). The window goes to the action, the one who reacts, the
        // one who speaks - by the words heard and the part's key moments, in the piece's own seconds - and punches in.
        L.frags.set(n, { pct: CUT_SHARE, words: 'following the most active' + (L.facesFrac > 0 && L.facesFrac < 1 ? ' · counting ' + Math.round(L.facesFrac * 100) + '%' : '') });
        const whole = await _sourceFaces(id, L, ctx.abs);
        const off = p.start - p.before;
        const faces = FACES.slice(whole, off, p.seconds);
        const speech = ctx.words.filter((w) => w.end > off && w.start < off + p.seconds).map((w) => [r2(w.start - off), r2(w.end - off)]);
        const keys = (f.keys || []).filter((x) => x.start >= p.start && x.start < p.end).map((x) => ({ t0: r2(x.start - off), t1: r2(x.end - off) }));
        p.frame = FRAMING.plan(faces, { aspect: 9 / 16, active: { speech, keys, zoom } });
        continue;
      }
      const faces = await FACES.find(p.abs, { signal: L.ac.signal, people,
        onFrac: (x) => { const s = L.frags.get(n); if (s) s.pct = CUT_SHARE + (1 - CUT_SHARE - 0.02) * ((k + x) / pieces.length); } });
      p.frame = FRAMING.plan(faces, { aspect: 9 / 16, mode: 'face', people, wide: wide || 0 });
    } catch (e) {
      if (e.cancelled || L.stopping) throw _cancelled();
      faceNote = e.noWorker ? 'framed from the middle: faces are found in the app window' : 'framed from the middle: ' + String(e.message || e).slice(0, 160);
      console.warn('[highlights] ' + id + ' fragment ' + n + ' piece ' + (k + 1) + ': no faces - ' + (e.message || e));
    }
  }
  _guard(L);
  L.frags.set(n, { pct: 0.99, words: 'laying the timeline' });
  const thumbName = `thumbs/hl${n}.jpg`;
  try { await CUT.thumb9x16(pieces[0].abs, path.join(dir, thumbName), pieces[0].before + 0.05, pieces[0].frame); } catch (e) { /* the poster stands in */ }
  // (phase V33.8, H3) Its music, from the track's active part; a track gone from Music since - made without it, and said.
  let music = [];
  let musicNote = '';
  if (f.music) {
    const len = pieces.reduce((s, p) => s + (p.end - p.start), 0);
    try { music = await HLM.clipsFor(f.music, len); } catch (e) { music = []; }
    if (!music.length) musicNote = 'its music is not in Music any more - made without it';
  }
  _guard(L);
  const lay = CUT.layOut(pieces, ctx.words, ctx.segments, ctx.preset, { title: ctx.title ? (f.headline || f.title) : '', music });
  // ONE TICK: the record as it is now - renamed meanwhile, deleted meanwhile - and its timeline with it.
  rec = HL.get(id);
  const now = rec && _frag(rec, n);
  if (!now) return;
  const key = HL.fragKey(id, n);
  CUT.writeTimeline(key, HL.uniqueTitle(now.title, key), lay.tracks);
  const thumb = fs.existsSync(path.join(dir, thumbName)) ? base + thumbName : '';
  HL.apply(id, (r) => {
    const x = _frag(r, n);
    if (!x) return false;
    Object.assign(x, { state: 'ready', error: '', key, thumb, files: pieces.map((p) => p.src), length: lay.seconds, faceNote, musicNote });
    return true;
  });
}

// Every moment found is made, or said why not.
const _fragsLeft = (rec) => ((rec && rec.fragments) || []).filter((f) => !f.deletedAt && f.state !== 'ready');

function _done(id) {
  const L = _live.get(id);
  if (L) L.took[L.step] = Date.now() - L.stepAt;
  _live.delete(id);
  if (L && L.sourceId) INTAKE.release(L.sourceId);
  const rec = HL.apply(id, (r) => { r.work = { ...r.work, state: 'done', step: 'done', error: '', interrupted: '', endedAt: new Date().toISOString(), took: L ? L.took : {} }; });
  _sourceIn(L);
  const all = rec ? (rec.fragments || []).filter((f) => !f.deletedAt) : [];
  const n = all.length;
  const want = rec && rec.ask ? rec.ask.count : 0;
  const left = _fragsLeft(rec);
  if (rec && rec.work.alertId) {
    // A fragment that could not be cut turns the row red - "retry" cuts again what is not made, for nothing.
    if (left.length) {
      const why = left.map((f) => f.error).filter(Boolean)[0] || 'it could not be cut';
      HL.apply(id, (r) => { r.work = { ...r.work, state: 'failed', error: `${left.length} of ${n} fragments not made: ${why}` }; });
      ALERTS.fail(rec.work.alertId, `${left.length} of ${n} fragments not made: ${why}`);
      return;
    }
    // (V43) fragmentation asked for no count: as many parts as the video came to.
    ALERTS.finish(rec.work.alertId, { media: 'video', path: '', note: (!want ? `${n} parts` : n >= want ? `${n} shorts` : `found ${n} of ${want}`) });
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
  const rec = HL.apply(id, (r) => {
    // (phase V40) What the steps done took stays with it: the panel says it, and a retry goes on counting from it.
    r.work = { ...r.work, state: 'failed', error: why, endedAt: new Date().toISOString(), ...(L ? { took: L.took } : {}) };
    for (const f of (r.fragments || [])) if (f.state === 'cutting') f.state = 'found';
  });
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
  if (L && L.sourceId && L.made && !wordsOf(L.sourceId, _track(HL.get(id)))) {
    // Not in yet: it goes, its file and the parts of one with it (a process just killed may hold a file a moment longer).
    _removeSource(L.sourceId);
    gone = true;
  }
  const rec = HL.apply(id, (r) => {
    r.work = { ...r.work, state: 'failed', error: 'stopped', endedAt: new Date().toISOString(), ...(L ? { took: L.took } : {}) };
    for (const f of (r.fragments || [])) if (f.state === 'cutting') f.state = 'found';
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
// The steps of a project's way, in order: the video in (downloaded or copied - none for a source of the Library), heard,
// its moments found, its fragments cut.
function _order(rec) {
  const from = rec && rec.video ? rec.video.from : 'link';
  return (from === 'link' ? ['download'] : from === 'file' ? ['copy'] : []).concat(['hear', 'find', 'fragments']);
}

// What the steps before `plan` took on an earlier run of the record - a retry goes on from there.
function _tookBefore(rec, plan) {
  const took = (rec && rec.work && rec.work.took) || {};
  const order = _order(rec);
  const out = {};
  for (const k of order.slice(0, Math.max(0, order.indexOf(plan)))) if (+took[k] > 0) out[k] = +took[k];
  return out;
}

// (phase V40, the owner's plan for V40 item 3) The agent's time, from what it took on this library's earlier projects: the
// median of their milliseconds a second of video, times this video's length - between 10 s and the agent's own limit; 90 s
// while no project has said. Read again at most once a minute.
let _findMemo = { at: 0, rates: [], took: [] };
function _findMs(secs) {
  if (Date.now() - _findMemo.at > 60000) {
    const rates = [];
    const took = [];
    for (const r of HL.list()) {
      const t = +(((r && r.work && r.work.took) || {}).find) || 0;
      const s = +((r && r.video && r.video.seconds) || 0);
      if (t > 0) took.push(t);
      if (t > 0 && s > 0) rates.push(t / s);
    }
    _findMemo = { at: Date.now(), rates: rates.sort((a, b) => a - b), took: took.sort((a, b) => a - b) };
  }
  const mid = (xs) => xs[Math.floor(xs.length / 2)];
  const { rates, took } = _findMemo;
  if (secs > 0 && rates.length) return Math.max(10000, Math.min(AGENT_MS, mid(rates) * secs));
  return took.length ? Math.max(10000, Math.min(AGENT_MS, mid(took))) : 90000;
}

// Expected times: the download by its bytes (8 MB/s until yt-dlp says), the copy at 150 MB/s, the hearing by its length -
// Groq ~20 s a ten-minute piece, this computer ~0.7 of the length (the K1b measure) and then by what it has done - and the
// agent by what it took on the earlier projects (V40; 90 s before any). Never past 95% of a step before it ends.
// (V43) What is left of the source's count by the hidden window: by its own pace once it moved, else ~19 s a minute of video
// (measured on the owner's 73-minute podcast, 10 frames a second with the mouths).
const COUNT_MS_PER_S = 320;
function _countLeftMs(rec, L) {
  const x = L.facesFrac || 0;
  const from = L.facesFrom;
  if (from && x - from.x > 0.02) return (Date.now() - from.at) / (x - from.x) * (1 - x);
  return (1 - x) * (+((rec && rec.video && rec.video.seconds) || 0)) * COUNT_MS_PER_S;
}

function _expect(rec, L) {
  const secs = +((rec && rec.video && rec.video.seconds) || 0);
  const bytes = +((rec && rec.video && rec.video.bytes) || 0);
  const local = L && L.heard ? L.heard.where === 'local' : !GROQ.keyOf();
  let hear = local ? secs * 700 : (Math.ceil(secs / 540) * 20000 + 5000);
  if (L && L.heard && L.heard.heard > 30 && L.step === 'hear') {
    const el = Date.now() - L.stepAt;
    hear = Math.max(el + 1000, el / Math.min(1, L.heard.heard / Math.max(1, secs)));
  }
  // A fragment: its pieces re-encoded (~0.3 s a second of it on this kind of computer), two at a time.
  const cut = ((rec && rec.fragments) || []).filter((x) => !x.deletedAt && x.state !== 'ready')
    .reduce((n, x) => n + 4000 + (+x.seconds || 45) * 300, 0) / AT_ONCE;
  return { download: bytes ? Math.max(5000, bytes / 8000) : Math.max(20000, secs * 120), copy: Math.max(2000, bytes / 150000), hear,
    // (V43) fragmentation cuts the whole video: ~10.5 s a minute of it, two parts at a time (measured on the owner's episode).
    find: _findMs(secs), fragments: Math.max(5000, cut || (HL.isWhole(HL.kindOf(rec)) ? secs * 175 : (rec && rec.ask ? rec.ask.count : 5) * 17500)) };
}

/**
 * (phase V40, the owner's (о5)) THE STEPS of a project's way, as the field's preparation panel says them - one row each:
 * [{ key: download|copy|hear|find|fragments, state: done|now|next|failed, took (ms, a step done), bytes (the video's, its way in),
 *    had (a link already in the Library: nothing downloaded), seconds, kept (its words were in already), engine (local|groq),
 *    count (the fragments asked) }]. `L` - the work going on, or none: then the record says where it stopped.
 */
function stagesOf(rec, L) {
  if (!rec) return [];
  const order = _order(rec);
  const w = rec.work || {};
  const took = (L ? L.took : w.took) || {};
  let i = -1;
  if (L) i = Math.max(0, order.indexOf(L.step));
  else if (w.state === 'done') i = order.length;
  else if (order.includes(w.step)) i = order.indexOf(w.step);
  const v = rec.video || {};
  const src = v.sourceId ? store.get(v.sourceId) : null;
  const h = rec.hearing || null;
  return order.map((key, k) => {
    const state = k < i ? 'done' : k > i ? 'next' : (!L && w.state === 'failed' ? 'failed' : 'now');
    const s = { key, state, took: +took[key] > 0 ? Math.round(+took[key]) : null };
    if (key === 'download' || key === 'copy') {
      s.bytes = +((src && src.bytes) || v.bytes || 0);
      s.had = key === 'download' && state === 'done' && !v.made;
    }
    if (key === 'hear') {
      s.seconds = +(v.seconds || (src && src.seconds) || 0);
      s.kept = !!(h && h.kept);
      s.engine = h && h.engine ? (h.engine === 'local' ? 'local' : 'groq') : (L && L.heard ? (L.heard.where === 'local' ? 'local' : 'groq') : '');
    }
    if (key === 'fragments') s.count = rec.ask ? +rec.ask.count || 0 : 0;
    return s;
  });
}

/**
 * { step, words, pct (0..1), leftMs, elapsedMs, stages, load } of a project at work, or null. `load` (phase V33.4, the owner
 * 2026-10-21): while the video is coming in - the download or the copy - its own way along, { frac (0..1, null before the
 * first number), leftMs }. (phase V40) `stages` - stagesOf; `elapsedMs` - since this run started: the panel's "0:48 · ~3:10 left".
 */
function progress(id) {
  const L = _live.get(String(id));
  if (!L) return null;
  const rec = HL.get(id);
  const order = _order(rec);
  const E = _expect(rec, L);
  const cur = order.includes(L.step) ? L.step : order[0];
  const i = order.indexOf(cur);
  // The steps behind: what they took - nothing for one this run did not need (its words were in: no hearing), not its expected time.
  const before = order.slice(0, i).reduce((n, k) => n + (L.took[k] || 0), 0);
  const after = order.slice(i + 1).reduce((n, k) => n + E[k], 0);
  const el = Date.now() - L.stepAt;
  let frac = 0;
  let whole = E[cur];
  if ((cur === 'download' || cur === 'copy') && L.frac > 0) {
    frac = L.frac;
    whole = L.eta != null ? el + L.eta * 1000 : el / frac;
  } else if (cur === 'fragments' && L.fragsAll && L.sourceFaces && L.facesFrac < 1) {
    // (V43) fragmentation's parts wait for the source's count - most of this step: what is left of it, then the cutting.
    whole = el + _countLeftMs(rec, L) + E.fragments;
    frac = Math.min(0.99, el / whole);
  } else if (cur === 'fragments' && L.fragsAll) {
    frac = Math.min(0.99, ((L.fragsDone || 0) + [...L.frags.values()].reduce((n, x) => n + (x.pct || 0), 0)) / L.fragsAll);
    whole = Math.max(E.fragments, el + 1000);
  } else if (cur === 'hear' && L.heard && L.heard.total > 0) {
    frac = Math.min(0.99, L.heard.heard / L.heard.total);
    whole = Math.max(E.hear, el + 1000);
  } else {
    whole = Math.max(E[cur], el / 0.95);
    frac = Math.min(0.95, el / whole);
  }
  const pct = Math.min(0.99, (before + frac * whole) / Math.max(1, before + whole + after));
  let words = L.words || cur;
  if (cur === 'fragments' && L.fragsAll) words = `cutting · ${L.fragsDone || 0} of ${L.fragsAll} made`;
  if (cur === 'fragments' && L.fragsAll && L.sourceFaces && L.facesFrac < 1) {
    words = `following the most active · the video counted ${Math.round((L.facesFrac || 0) * 100)}% · then ${L.fragsAll} parts`;
  }
  if (cur === 'download' && L.sourceId && INTAKE.queuePlace(L.sourceId) > 1) words = `waiting · ${INTAKE.queuePlace(L.sourceId) - 1} download(s) ahead`;
  // Each fragment being made: its own way along, for its tile.
  const fragments = {};
  if (L.frags) for (const [n, x] of L.frags) fragments[n] = { pct: x.pct || 0, words: x.words || '' };
  const load = (cur === 'download' || cur === 'copy')
    ? { frac: L.frac > 0 ? Math.min(1, L.frac) : null, leftMs: L.frac > 0 ? Math.round(whole * (1 - frac)) : null } : null;
  return { step: cur, words, pct, leftMs: Math.round(whole * (1 - frac) + after), elapsedMs: Date.now() - L.startedAt,
    stages: stagesOf(rec, L), fragments, load };
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
    // (V43) A video that stays on the disk is never copied: gone from its place, there is nothing to go on with.
    if (src && src.diskPath) return '';
    if (rec.video.from === 'file') {
      const p = (src && src.intake && src.intake.fromPath) || rec.video.path;
      return p && fs.existsSync(p) ? 'copy' : '';
    }
    return '';
  }
  if (!wordsOf(src.id, _track(rec))) return 'hear';
  if (!(rec.fragments || []).length) return 'find';
  if (_fragsLeft(rec).length) return 'fragments';
  return '';
}
const _rowProject = (row) => String((((row || {}).job || {}).params || {}).projectId || '');
const _rowPlan = (row) => (row && !_live.has(_rowProject(row)) ? plan(HL.get(_rowProject(row))) : '');
const STAGE = { download: 'waiting', copy: 'copying', hear: 'hearing the words', find: 'finding the moments', fragments: 'cutting the fragments' };

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
  // without asking anybody: one press. (V69 P12, (хп78)) Also one that could not be read before and reads now (lectures 20, 22).
  free: (row) => {
    const pl = _rowPlan(row);
    const rec = pl === 'find' ? HL.get(_rowProject(row)) : null;
    return pl === 'download' || pl === 'copy' || pl === 'fragments' || (pl === 'hear' && !GROQ.keyOf()) || _keptReads(rec);
  },
  busy: (row) => _live.has(_rowProject(row)),
  cancel: (row) => { stop(_rowProject(row)); },
  submit: async (_request, row) => {
    const id = _rowProject(row);
    const pl = _rowPlan(row);
    if (!pl) throw new Error('there is nothing left to go on with');
    if (pl === 'hear') { const cant = CAPJOB.cannotHear(null); if (cant) throw new Error(cant.error); }
    const kick = _kick();
    _reserve(id, kick, pl, _tookBefore(HL.get(id), pl));
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
  // The preview's copy of a piece, made in the same pass (phase V33.2 block 0), cut off with it: scratch, but it goes too.
  try {
    const pdir = require('./preview-proxy').CACHE_DIR;
    for (const f of (fs.existsSync(pdir) ? fs.readdirSync(pdir) : [])) {
      if (/^hl\d+_\d+\.[0-9a-f]{6}\.part\.mp4$/i.test(f)) { try { fs.rmSync(path.join(pdir, f), { force: true }); } catch (err) { /* held */ } }
    }
  } catch (err) { /* nothing to sweep */ }
  for (const rec of HL.list()) {
    // A piece being cut when the app closed - ffmpeg killed, or left to finish into its temporary name: never one of the
    // project's files, it goes (lib/highlights-cut.js writes `<name>.<rand>.part.mp4`, then renames it).
    try {
      const e = HL.entry(rec.id);
      const dir = e ? path.join(require('./config').PROJECTS_DIR, e.folder, 'clips') : '';
      for (const f of (dir && fs.existsSync(dir) ? fs.readdirSync(dir) : [])) {
        if (/\.part\.mp4$/i.test(f)) { try { fs.rmSync(path.join(dir, f), { force: true }); } catch (err) { /* held */ } }
      }
    } catch (err) { /* nothing to sweep */ }
    // Fragments deleted and not brought back before the app closed go for good now (the owner's (х19а)): their timelines,
    // their pieces and their pictures.
    if ((rec.fragments || []).some((f) => f.deletedAt)) {
      try { purge(rec.id); } catch (e) { console.warn('[highlights] could not let go of the deleted fragments of', rec.id, '-', e.message); }
    }
    if (!rec.work || rec.work.state !== 'running') continue;
    const step = rec.work.step;
    // Cutting costs nothing: it goes on by itself (the owner's (х18)) - its row stays running, on a new kick.
    if (step === 'fragments' && rec.work.alertId) {
      const kick = _kick();
      _reserve(rec.id, kick, 'fragments', _tookBefore(rec, 'fragments'));
      HL.apply(rec.id, (r) => { for (const f of (r.fragments || [])) if (f.state === 'cutting') f.state = 'found'; });
      ALERTS.update(rec.work.alertId, { params: { kick } });
      setImmediate(() => _go(rec.id, 'fragments'));
      console.log('[highlights] ' + rec.id + ': cutting its fragments again - the app was closed while they were being cut');
      continue;
    }
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

// ── A fragment deleted, brought back, renamed (the owner's (х19), (х19а), (х20)) ──
// Deleted, it is HIDDEN: its tile goes, its timeline and pieces stay until the app is started again - Ctrl+Z in the field
// brings the deleted back one by one, the last first. At the next start they go for good (boot -> purge).
function _fragOf(id, n) {
  const rec = HL.get(id);
  const f = rec && _frag(rec, Number(n));
  if (!f) throw Object.assign(new Error('no such fragment'), { status: 404 });
  return { rec, f };
}

function deleteFragment(id, n) {
  _fragOf(id, n);
  const at = new Date().toISOString();
  HL.apply(id, (r) => { const f = _frag(r, Number(n)); if (f) f.deletedAt = at; });
  return { deletedAt: at };
}

/** The last one deleted (or `n`) back. Resolves with its n, or 0 when none is deleted. */
function restoreFragment(id, n) {
  const rec = HL.get(id);
  if (!rec) throw Object.assign(new Error('no such highlights project'), { status: 404 });
  const gone = (rec.fragments || []).filter((f) => f.deletedAt).sort((a, b) => String(b.deletedAt).localeCompare(String(a.deletedAt)));
  const f = n ? gone.find((x) => x.n === Number(n)) : gone[0];
  if (!f) return 0;
  HL.apply(id, (r) => { const x = _frag(r, f.n); if (x) x.deletedAt = null; });
  return f.n;
}

/** A new name: the card's and its timeline's - the name of the render file after it (V33.4). */
function renameFragment(id, n, title) {
  const clean = String(title || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  if (!clean) throw Object.assign(new Error('a name is needed'), { status: 400 });
  const { f } = _fragOf(id, n);
  let timeline = '';
  let revs = null;
  if (f.key) {
    timeline = HL.uniqueTitle(clean, f.key);
    const MS = require('./merge-store');
    const before = Number((MS.one(f.key) || {}).rev) || 0;
    const t = MS.update(f.key, (x) => { if (x.title === timeline) return false; x.title = timeline; return true; });
    revs = { before, after: Number((t || {}).rev) || 0 };
  }
  HL.apply(id, (r) => {
    const x = _frag(r, Number(n));
    if (!x) return;
    x.title = clean;
    // (phase V33.4) A new name changes nothing in the picture: a render that was up to date stays so (not "changed since").
    if (x.render && revs && Number(x.render.rev) === revs.before) x.render.rev = revs.after;
  });
  // (phase V33.4, the owner's (х41)) Its render's file follows the name - its subtitles with it.
  let render = null;
  try { render = require('./highlights-render').renamed(id, n); }
  catch (e) { console.warn('[highlights] a render kept its old name:', e.message); }
  return { title: clean, timeline, render };
}

/** The deleted fragments of a project gone for good: their timelines, their pieces and pictures, their records. */
function purge(id) {
  const rec = HL.get(id);
  if (!rec) return 0;
  const gone = (rec.fragments || []).filter((f) => f.deletedAt);
  if (!gone.length) return 0;
  const dir = HL.dirOf(id);
  for (const f of gone) {
    if (f.key) { try { CUT.dropTimeline(f.key); } catch (e) { /* its file stays */ } }
    for (const u of [...(f.files || []), f.thumb].filter(Boolean)) {
      const abs = toDiskWithin(u, [dir]);
      if (abs) { try { fs.rmSync(abs, { force: true }); } catch (e) { /* held: it stays */ } }
    }
  }
  const ns = new Set(gone.map((f) => f.n));
  HL.apply(id, (r) => { r.fragments = (r.fragments || []).filter((f) => !ns.has(f.n)); });
  console.log('[highlights] ' + id + ': ' + gone.length + ' deleted fragment(s) let go of for good');
  return gone.length;
}

// ── The price on the button (the owner's (х13)) ────────────────────────────
/** { hear: { by: groq|local|kept|none, why, cost, perHour }, agent: { cost }, total } - `seconds` 0 when not known yet. */
function price({ seconds = 0, sourceId = '', kind = '', length = '', audio = null, count = 0 } = {}) {
  const secs = Math.max(0, +seconds || 0);
  let by = GROQ.keyOf() ? 'groq' : 'local';
  let why = '';
  if (sourceId && wordsOf(sourceId, Number.isInteger(audio) && audio >= 0 ? audio : null)) by = 'kept';
  else {
    const cant = CAPJOB.cannotHear(null);
    if (cant) { by = 'none'; why = cant.error; }
  }
  const hear = by === 'groq' ? (secs ? Math.round(secs / 3600 * GROQ_PER_HOUR * 10000) / 10000 : null) : 0;
  // An hour of speech is ~9 000 words, ~60 000 characters with their times.
  // (V43) fragmentation writes every part of the video - its answer is as long as the video is (an hour if not known yet).
  // (V69 P12) At the price of the ladder's first step, thinking at effort high.
  const model = (AGENTS.ladder()[0] || {}).model || '';
  const agent = HL.isWhole(kind)
    ? AGENT.fragPrice(secs ? secs * 17 : 60000, secs || 3600, HL.lengthsOf(kind)[length] || HL.FRAG_LENGTHS['p1-2'], model)
    : AGENT.priceOf(secs ? secs * 17 : 60000, Number(count) > 0 ? Number(count) : 20, model);
  return { hear: { by, why, cost: hear, perHour: GROQ_PER_HOUR }, agent: { cost: agent },
    total: hear == null ? null : Math.round((hear + agent) * 10000) / 10000 };
}

module.exports = { start, stop, retry, progress, stagesOf, live, plan, boot, price, wordsOf, agentText, languageOf, deleteFragment, restoreFragment, renameFragment, purge };
