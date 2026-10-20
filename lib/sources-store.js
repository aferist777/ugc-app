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
// The video itself is kept whole (uploads/sources/), which was a deliberate choice: it costs
// disk - reckon a gigabyte for fifty minutes - and buys the ability to cut frames and
// fragments out of it later without fetching anything again.
// ════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');

const { DATA_DIR, MEDIA } = require('./config');
const { toDiskWithin } = require('./media');
const { writeFileAtomic } = require('./atomic-write');
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
    media: s.videoPath || null,
    thumb: s.thumbPath || null,
    state: s.state || 'new',
    error: s.error || '',
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
    // (phase V28.1) Its way in, when it came through lib/source-intake.js: from a link or a file, the step it is at or
    // was cut at, its Alerts row, and - when the app closed midway - the words for that.
    intake: s.intake ? {
      from: s.intake.from || '', step: s.intake.step || '', alertId: s.intake.alertId || '',
      interrupted: s.intake.interrupted || '', error: s.intake.error || '',
    } : null,
    // (phase V33.1) Its words, each with its time, are kept in its transcript file - heard for a highlights project, and
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
    title: rec.title || rec.originalName || 'Untitled',
    originalName: rec.originalName || '',
    url: rec.url || '',
    // (phase V27) What a link is known by under every spelling of its address - the site and the
    // video's id (lib/ytdlp.js info().key) - so the same video is not fetched twice.
    linkKey: rec.linkKey || '',
    channel: rec.channel || '',
    videoPath: rec.videoPath || null,
    thumbPath: rec.thumbPath || null,
    seconds: rec.seconds || 0,
    bytes: rec.bytes || 0,
    state: rec.state || 'new',
    error: '',
    transcript: null,
    topics: null,
    // (phase V28.1) Its way in - lib/source-intake.js; null for a source added before it.
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
  if (i < 0) throw new Error('No such source.');
  list_[i] = { ...list_[i], ...patch, id: list_[i].id, updatedAt: _now() };
  _write(list_);
  return list_[i];
}

// Everything the source owns goes: the record, the video, its poster, and the transcript file.
// A record deleted without its gigabyte is how a disk fills up invisibly - and so does a download cut off midway
// (phase V28.1): its parts (<id>.f399.mp4.part) are its own too. A file another program still holds stays.
function remove(id) {
  const rec = get(id);
  if (!rec) throw new Error('No such source.');
  const removed = parts(id);
  for (const rel of [rec.videoPath, rec.thumbPath]) {
    if (!rel) continue;
    // Never step outside the sources folder, whatever the record says.
    const abs = toDiskWithin(rel, [SOURCES_DIR]);
    if (!abs) continue;
    try { if (fs.existsSync(abs) && fs.statSync(abs).isFile()) { fs.unlinkSync(abs); removed.push(path.basename(abs)); } } catch (e) {}
  }
  try {
    const tp = transcriptPath(id);
    if (fs.existsSync(tp)) { fs.unlinkSync(tp); removed.push(path.basename(tp)); }
  } catch (e) {}
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
    try { fs.rmSync(path.join(SOURCES_DIR, n), { force: true }); out.push(n); } catch (e) { /* held - the next remove tries again */ }
  }
  return out;
}

// The record and its transcript, NOT its files (phase V28.1): a source with nothing to write from whose video went
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
  create, update, remove, parts, forget,
};
