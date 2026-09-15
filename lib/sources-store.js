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
  const tmp = INDEX_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ sources: list }, null, 2), 'utf8');
  fs.renameSync(tmp, INDEX_FILE);
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
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(payload), 'utf8');
  fs.renameSync(tmp, p);
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
    channel: rec.channel || '',
    videoPath: rec.videoPath || null,
    thumbPath: rec.thumbPath || null,
    seconds: rec.seconds || 0,
    bytes: rec.bytes || 0,
    state: rec.state || 'new',
    error: '',
    transcript: null,
    topics: null,
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
// A record deleted without its gigabyte is how a disk fills up invisibly.
function remove(id) {
  const rec = get(id);
  if (!rec) throw new Error('No such source.');
  const removed = [];
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

module.exports = {
  INDEX_FILE, TRANSCRIPT_DIR, SOURCES_DIR, SOURCES_URL, MAX_TRANSCRIPT_CHARS,
  newId, ensureDirs, posterAt,
  list, get, summary, summaries,
  transcriptPath, readTranscript, writeTranscript,
  create, update, remove,
};
