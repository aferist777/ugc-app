'use strict';

// ════════════════════════════════════════════════════════════════════════════
// SOURCES — long videos brought into the app, and what was found inside them.
//
// Global, not per project: one long video is expected to spawn several scripts, and you
// should be able to come back months later and mine the topics you skipped the first time.
//
// THE CUES LIVE IN THEIR OWN FILE. A two-hour transcript is ~100 KB of JSON, and the index is
// read on every shelf paint; keeping them together would make listing the shelf the most
// expensive request on the page. So data/sources.json holds counts and state, and
// data/transcripts/<id>.json holds the words.
//
// The video itself is kept whole (media/sources/), which was a deliberate choice: it costs
// disk - reckon a gigabyte for fifty minutes - and buys the ability to cut frames and
// fragments out of it later without fetching anything again.
//
// A VIDEO THAT STAYS ON THE DISK: one a highlights project took from a file of
// this computer is NOT copied in - the record remembers where it lies, `diskPath` (an absolute path, NEVER an address: no
// field of an address holds it, so lib/media.js, relocate, moves and the upgrade leave it alone) and its print,
// `diskPrint` (size + a hash of its first and last megabyte). The app only READS that file: it is played by the source's id
// (GET /api/sources/:id/video), heard, cut, counted - its poster and everything made of it lie in the library. Moved or
// deleted, the source says so and asks for it again (the print says it is the same video), or is deleted with or without
// its transcripts - kept, they wait in data/transcripts/_kept.json for the same file to be added again: never heard twice.
// WORDS BY SOUND TRACK: the transcript's words are those of one track of the file (`wordsBy.track`, 0 - the first -
// when it says none); another track's words lie beside it, data/transcripts/<id>.a<k>.json.
// ════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { DATA_DIR, MEDIA, ROOT_DIR } = require('./config');
const { toDiskWithin } = require('./media');
const { writeFileAtomic } = require('./atomic-write');
const I18N = require('./i18n');
const INDEX_FILE = path.join(DATA_DIR, 'sources.json');
const TRANSCRIPT_DIR = path.join(DATA_DIR, 'transcripts');
const SOURCES_DIR = MEDIA.sources;
const SOURCES_URL = '/media/sources';

// Above this the topics call overflows its answer rather than returning fewer topics, so it is
// refused with a number instead. ~2.5 hours of speech.
const MAX_TRANSCRIPT_CHARS = 120000;

const _now = () => new Date().toISOString();

function _read() {
  try {
    const d = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'));
    return Array.isArray(d.sources) ? d.sources : [];
  } catch (e) { return []; }
}

function _write(list) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  writeFileAtomic(INDEX_FILE, JSON.stringify({ sources: list }, null, 2));
}

function newId() {
  return 'src_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function ensureDirs() {
  fs.mkdirSync(SOURCES_DIR, { recursive: true });
  fs.mkdirSync(TRANSCRIPT_DIR, { recursive: true });
}

// ── where a frame worth showing lives ───────────────────────────────────────
// Eight per cent in. A long video opens on black, a logo or a title card, so half a second in
// - which is right for a rendered short - gives a shelf of black squares. Never earlier than
// half a second, and never later than two minutes: at three hours, eight per cent is a
// quarter of an hour and seeking that far to decorate a card is not worth the wait.
function posterAt(seconds) {
  const s = Number(seconds) || 0;
  if (s <= 4) return 0.5;
  return Math.min(120, Math.max(0.5, s * 0.08));
}

// ── reading ─────────────────────────────────────────────────────────────────

function list() { return _read(); }

function get(id) {
  return _read().find(s => String(s.id) === String(id)) || null;
}

function transcriptPath(id) {
  return path.join(TRANSCRIPT_DIR, `${id}.json`);
}

// ── A video that stays on the disk ─────────────────────────────────────────
const EDGE = 1024 * 1024;
const KEPT_FILE = path.join(TRANSCRIPT_DIR, '_kept.json');
/** Is this path inside the library - the only place the app ever writes or deletes. */
function inLibrary(abs) {
  if (!abs) return false;
  const root = path.resolve(ROOT_DIR).toLowerCase(), p = path.resolve(String(abs)).toLowerCase();
  return p === root || p.startsWith(root + path.sep);
}
/** A file's print - its size and a hash of its first and last megabyte: the same video wherever it is moved. '' when unreadable. */
function printOf(abs) {
  let fd = null;
  try {
    const st = fs.statSync(abs);
    if (!st.isFile()) return '';
    fd = fs.openSync(abs, 'r');
    const h = crypto.createHash('sha1');
    const a = Buffer.alloc(Math.min(EDGE, st.size));
    fs.readSync(fd, a, 0, a.length, 0);
    h.update(a);
    if (st.size > EDGE) {
      const b = Buffer.alloc(Math.min(EDGE, st.size - EDGE));
      fs.readSync(fd, b, 0, b.length, st.size - b.length);
      h.update(b);
    }
    return st.size + ':' + h.digest('hex').slice(0, 24);
  } catch (e) { return ''; }
  finally { if (fd != null) { try { fs.closeSync(fd); } catch (e) { /* closed */ } } }
}
/** The video file of a source on this computer - in the library, or where the person keeps it - or null when it is not there. */
function fileOf(rec) {
  if (!rec) return null;
  if (rec.diskPath) return fs.existsSync(rec.diskPath) ? rec.diskPath : null;
  const abs = rec.videoPath ? toDiskWithin(rec.videoPath, [SOURCES_DIR]) : null;
  return abs && fs.existsSync(abs) ? abs : null;
}
/** The source whose video stays on the disk at this path, or with this print - the same file added again. */
function findOnDisk(abs, print) {
  const want = abs ? path.resolve(String(abs)).toLowerCase() : '';
  return _read().find((x) => x.diskPath && ((want && path.resolve(x.diskPath).toLowerCase() === want) || (print && x.diskPrint === print))) || null;
}
// Transcripts kept when their source was deleted, by the print of its file.
function _kept() { try { const j = JSON.parse(fs.readFileSync(KEPT_FILE, 'utf8')); return Array.isArray(j) ? j : []; } catch (e) { return []; } }
function _writeKept(list) { ensureDirs(); writeFileAtomic(KEPT_FILE, JSON.stringify(list, null, 1)); }
/** The id whose transcripts were kept for a file of this print, taken off the list (the new source takes that id), or ''. */
function takeKept(print) {
  if (!print) return '';
  const list = _kept();
  const k = list.find((x) => x.print === print);
  if (!k) return '';
  _writeKept(list.filter((x) => x !== k));
  return fs.existsSync(transcriptPath(k.id)) ? String(k.id) : '';
}
// ── Words by sound track ───────────────────────────────────────────────────
const trackPath = (id, k) => path.join(TRANSCRIPT_DIR, `${id}.a${k}.json`);
/** The track the main transcript's words were heard from (0 when it says none). */
function mainTrack(id) { const t = readTranscript(id); return t && t.wordsBy && Number.isFinite(+t.wordsBy.track) ? +t.wordsBy.track : 0; }
/** The transcript holding track `k`'s words ({ words: [{ w, s, e }], segments, wordsBy }), or null: the main one when they are that track's. */
function wordsOfTrack(id, k) {
  const tk = Number.isFinite(+k) && +k >= 0 ? +k : 0;
  const t = readTranscript(id);
  if (t && Array.isArray(t.words) && t.words.length && mainTrack(id) === tk) return t;
  if (tk === mainTrack(id) && t && Array.isArray(t.words) && t.words.length) return t;
  try { const a = JSON.parse(fs.readFileSync(trackPath(id, tk), 'utf8')); return a && Array.isArray(a.words) && a.words.length ? a : null; } catch (e) { return null; }
}
/** Another track's words, beside the main transcript. */
function writeTrackWords(id, k, payload) { ensureDirs(); writeFileAtomic(trackPath(id, k), JSON.stringify(payload)); }

function readTranscript(id) {
  try { return JSON.parse(fs.readFileSync(transcriptPath(id), 'utf8')); }
  catch (e) { return null; }
}

function writeTranscript(id, payload) {
  ensureDirs();
  const p = transcriptPath(id);
  writeFileAtomic(p, JSON.stringify(payload));
  return p;
}

// What a shelf row needs. Never the cues, and never the topic bodies - a row shows how many
// there are, and opening the source is what fetches them.
function summary(s) {
  const t = s.transcript || {};
  return {
    id: s.id,
    kind: s.kind,
    title: s.title || s.originalName || s.id,
    url: s.url || '',
    channel: s.channel || '',
    seconds: s.seconds || 0,
    bytes: s.bytes || 0,
    // A video that stays on the disk is played by the source's id; `disk` says where it lies and whether it is there.
    media: s.diskPath ? (fs.existsSync(s.diskPath) ? `/api/sources/${encodeURIComponent(s.id)}/video` : null) : (s.videoPath || null),
    disk: s.diskPath ? { path: s.diskPath, missing: !fs.existsSync(s.diskPath) } : null,
    thumb: s.thumbPath || null,
    state: s.state || 'new',
    error: s.error || '',
    // What the error is, for the page to tell without reading its words: 'interrupted' - the app was closed midway.
    errorCode: s.errorCode || '',
    transcript: {
      state: t.state || 'none',
      cues: t.cues || 0,
      chars: t.chars || 0,
      model: t.model || '',
      cost: t.cost || 0,
    },
    topics: Array.isArray(s.topics) ? s.topics.length : 0,
    // TOPICS WRITTEN FROM, not scenarios written. One topic can yield several - usedBy is a list
    // - and counting scenarios would let the card read "15 of 13", which is nonsense on its face.
    // How many came out of one topic belongs on that topic's row, where there is room to say it.
    topicsUsed: Array.isArray(s.topics)
      ? s.topics.filter(t => Array.isArray(t.usedBy) && t.usedBy.length).length : 0,
    addedAt: s.addedAt || null,
    updatedAt: s.updatedAt || null,
    // Its way in, when it came through lib/source-intake.js: from a link or a file, the step it is at or
    // was cut at, its Alerts row, and - when the app closed midway - the words for that.
    intake: s.intake ? {
      from: s.intake.from || '', step: s.intake.step || '', alertId: s.intake.alertId || '',
      interrupted: s.intake.interrupted || '', error: s.intake.error || '',
    } : null,
    // Its words, each with its time, are kept in its transcript file - heard for a highlights project, and
    // never heard again for the next one: { n, engine, at }, or null.
    words: s.words && s.words.n ? { n: +s.words.n || 0, engine: String(s.words.engine || ''), at: s.words.at || null } : null,
  };
}

function summaries() {
  return _read()
    .map(summary)
    .sort((a, b) => String(b.addedAt || '').localeCompare(String(a.addedAt || '')));
}

// ── writing ─────────────────────────────────────────────────────────────────

function create(rec) {
  const list_ = _read();
  const full = {
    id: rec.id || newId(),
    kind: rec.kind || 'file',
    title: rec.title || rec.originalName || I18N.t('Untitled'),
    originalName: rec.originalName || '',
    url: rec.url || '',
    // What a link is known by under every spelling of its address - the site and the
    // video's id (lib/ytdlp.js info().key) - so the same video is not fetched twice.
    linkKey: rec.linkKey || '',
    channel: rec.channel || '',
    videoPath: rec.videoPath || null,
    thumbPath: rec.thumbPath || null,
    // A video that stays on the disk: where it lies, and its print.
    ...(rec.diskPath ? { diskPath: String(rec.diskPath), diskPrint: String(rec.diskPrint || '') } : {}),
    seconds: rec.seconds || 0,
    bytes: rec.bytes || 0,
    state: rec.state || 'new',
    error: '',
    transcript: null,
    topics: null,
    // Its way in - lib/source-intake.js; null for a source without one.
    intake: rec.intake && typeof rec.intake === 'object' ? rec.intake : null,
    addedAt: _now(),
    updatedAt: _now(),
  };
  list_.unshift(full);
  _write(list_);
  return full;
}

function update(id, patch) {
  const list_ = _read();
  const i = list_.findIndex(s => String(s.id) === String(id));
  if (i < 0) throw new Error(I18N.t('No such source.'));
  list_[i] = { ...list_[i], ...patch, id: list_[i].id, updatedAt: _now() };
  // An error's code goes with its words: new words without a code of their own clear the old one.
  if (patch && 'error' in patch && !('errorCode' in patch)) delete list_[i].errorCode;
  _write(list_);
  // A video of REFERENCES -> YouTube ->
  // Videos that was not downloaded becomes this source once its file is in: that tile goes, this one is in its place.
  if (patch && patch.videoPath && list_[i].linkKey) {
    try { require('./references-store').dropRemote(list_[i].linkKey); } catch (e) { /* a tile left, not a source lost */ }
  }
  return list_[i];
}

// A source that came from YouTube - REFERENCES -> YouTube -> Videos shows it (routes/library.js),
// and the windows of highlights and of the scenarios' "Add a source" offer it (GET /api/references/youtube).
function fromYouTube(s) {
  return !!s && (/^youtube:/i.test(String(s.linkKey || ''))
    || /^https?:\/\/((www|m)\.)?(youtube\.com|youtu\.be)\//i.test(String(s.url || '')));
}

// Everything the source owns goes: the record, the video, its poster, and the transcript file.
// A record deleted without its gigabyte is how a disk fills up invisibly - and so does a download cut off midway:
// its parts (<id>.f399.mp4.part) are its own too. A file another program still holds stays.
// A video that stays on the disk is NEVER touched - only what the library holds goes. `keepWords` (the "delete the
// transcripts" box not ticked): its transcripts stay, listed by the file's print, for the same file added again.
function remove(id, { keepWords = false } = {}) {
  const rec = get(id);
  if (!rec) throw new Error(I18N.t('No such source.'));
  const removed = parts(id);
  // A video some piece was cut from stays while the piece is there - its "original" (lib/cuts.js).
  const held = require('./cuts').originalsInUse();
  for (const rel of [rec.videoPath, rec.thumbPath]) {
    if (!rel) continue;
    if (held.has(String(rel).split('?')[0])) continue;
    // Never step outside the sources folder, whatever the record says.
    const abs = toDiskWithin(rel, [SOURCES_DIR]);
    if (!abs || !inLibrary(abs)) continue;
    try { if (fs.existsSync(abs) && fs.statSync(abs).isFile()) { fs.unlinkSync(abs); removed.push(path.basename(abs)); } } catch (e) {}
  }
  if (keepWords && rec.diskPrint && fs.existsSync(transcriptPath(id))) {
    _writeKept([..._kept().filter((x) => x.print !== rec.diskPrint), { print: rec.diskPrint, id: String(id), title: rec.title || '', at: _now() }]);
  } else {
    // The transcript and every other track's words.
    let names = [];
    try { names = fs.readdirSync(TRANSCRIPT_DIR); } catch (e) { names = []; }
    for (const n of names) {
      if (n !== `${id}.json` && !(n.startsWith(`${id}.a`) && n.endsWith('.json'))) continue;
      try { fs.unlinkSync(path.join(TRANSCRIPT_DIR, n)); removed.push(n); } catch (e) {}
    }
  }
  _write(_read().filter(s => String(s.id) !== String(id)));
  return removed;
}

// What a download left in the sources folder under this id that is not the source's file: parts, streams before
// their join. Removed; the names of those removed are returned.
function parts(id) {
  const rec = get(id);
  const keep = new Set([rec && rec.videoPath, rec && rec.thumbPath].filter(Boolean).map(p => path.posix.basename(String(p))));
  const out = [];
  let names = [];
  try { names = fs.readdirSync(SOURCES_DIR); } catch (e) { return out; }
  for (const n of names) {
    if (!n.startsWith(String(id) + '.') || keep.has(n)) continue;
    if (!inLibrary(path.join(SOURCES_DIR, n))) continue;
    try { fs.rmSync(path.join(SOURCES_DIR, n), { force: true }); out.push(n); } catch (e) { /* held - the next remove tries again */ }
  }
  return out;
}

// The record and its transcript, NOT its files: a source with nothing to write from whose video went
// onto Uploads in Media - the file has moved there already (routes/library.js fileRecord).
function forget(id) {
  try { const tp = transcriptPath(id); if (fs.existsSync(tp)) fs.unlinkSync(tp); } catch (e) {}
  _write(_read().filter(s => String(s.id) !== String(id)));
}

module.exports = {
  INDEX_FILE, TRANSCRIPT_DIR, SOURCES_DIR, SOURCES_URL, MAX_TRANSCRIPT_CHARS,
  newId, ensureDirs, posterAt,
  list, get, summary, summaries,
  transcriptPath, readTranscript, writeTranscript,
  create, update, remove, parts, forget, fromYouTube,
  // a video that stays on the disk; words by sound track
  inLibrary, printOf, fileOf, findOnDisk, takeKept, KEPT_FILE, mainTrack, wordsOfTrack, writeTrackWords, trackPath,
};
