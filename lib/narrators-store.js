'use strict';

// ════════════════════════════════════════════════════════════════════════════
// NARRATORS — how a script is written, as opposed to the voice that reads it.
//
// A narrator is built from real writing by one author: the samples go to a model, which
// describes the voice behaviourally, and that description drives the hook, script and
// rewrite prompts. Nothing here generates anything; it stores the samples and the voice
// read out of them.
//
// Three things are deliberate and easy to undo by accident:
//
// The SAMPLE TEXT is kept, not just its file name. A narrator whose samples are gone can
// never be re-analysed, so the first changed prompt turns it into a dead end. The words are
// the part that matters.
//
// NEUTRAL IS NOT A RECORD. It is the absence of a profile, and it carries the anti-machine
// rules instead (see writing-prompts.NEUTRAL_BLOCK). Storing it as a row would invite
// someone to add samples to it, and then two rule sets would argue about precedence inside
// one prompt.
//
// ONE NARRATOR, ONE VOICE. The voice is kept as LINES per field
// (`voice.<field>: [{ id, text, at, by }]`), and a reading of the samples not read yet only ADDS: a line the voice already
// has, word for word, is dropped. Every line can be corrected or deleted by hand, so a mistake does
// not stay for ever. Only the voice is used to write a script.
// ════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');

const FILE = path.join(require('./config').DATA_DIR, 'narrators.json');
const { writeFileAtomic } = require('./atomic-write');

// Below this the analysis comes back generic and useless - it describes writing in general
// rather than this author. Measured, not guessed.
const MIN_SAMPLE_WORDS = 500;

const NEUTRAL = { id: 'neutral', name: 'Neutral', builtin: true };

// The fields of a voice, in the order they are shown and told - each kept as lines; the last two are told as lists, the
// rest as one paragraph (voiceProfile).
const VOICE_FIELDS = ['summary', 'sentences', 'rhythm', 'address', 'register', 'imagery',
  'humour', 'openings', 'endings', 'stance', 'signature_moves', 'never_does'];
const LIST_FIELDS = new Set(['signature_moves', 'never_does']);

const _now = () => new Date().toISOString();
const countWords = (text) => String(text || '').trim().split(/\s+/).filter(Boolean).length;
const _cut = (s, n) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n);
const _rid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// What a repeat is: the same words, whatever the case, the punctuation and the spaces.
const keyOf = (s) => String(s || '').toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

function newId() {
  return Math.random().toString(16).slice(2, 8) + Date.now().toString(16).slice(-6);
}

// ── the record's shape ──────────────────────────────────────────────────────

const _lines = (v) => (Array.isArray(v) ? v : (v == null || v === '' ? [] : [v]))
  .map(x => (typeof x === 'string' ? x : (x && x.text) || '')).map(t => String(t).trim()).filter(Boolean);

function _normLine(l, f, i) {
  if (typeof l === 'string') return l.trim() ? { id: `vl_${f}_${i}`, text: l.trim(), at: null, by: '' } : null;
  if (!l || !String(l.text || '').trim()) return null;
  return { id: String(l.id || `vl_${f}_${i}`), text: String(l.text).trim(), at: l.at || null, by: String(l.by || '') };
}

// Every record the way the rest of the app reads it. Unknown fields are kept, so nothing an older or a newer version
// wrote is lost on the next write.
function _norm(n) {
  if (!n || typeof n !== 'object') return n;
  const out = { ...n };
  if (!out.voice || typeof out.voice !== 'object') {
    out.voice = null;
    out.lastRead = out.lastRead || null;
  } else {
    const v = {};
    for (const f of VOICE_FIELDS) v[f] = (Array.isArray(out.voice[f]) ? out.voice[f] : []).map((l, i) => _normLine(l, f, i)).filter(Boolean);
    out.voice = v;
  }
  out.samples = Array.isArray(out.samples) ? out.samples : [];
  return out;
}

function _read() {
  try {
    const d = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return Array.isArray(d.narrators) ? d.narrators.map(_norm) : [];
  } catch (e) { return []; }
}

// Written atomically so a crash mid-write cannot truncate the file: it holds every sample
// text, which is the one thing here that cannot be regenerated.
function _write(list) {
  writeFileAtomic(FILE, JSON.stringify({ narrators: list }, null, 2));
}

// One narrator read, changed by `fn` and written, in one tick - `fn` is synchronous and may throw. Answers the record.
function _apply(id, fn) {
  const list_ = _read();
  const i = list_.findIndex(n => String(n.id) === String(id));
  if (i < 0) throw new Error('No such narrator.');
  const rec = JSON.parse(JSON.stringify(list_[i]));
  fn(rec);
  rec.id = list_[i].id;
  rec.updatedAt = _now();
  list_[i] = _norm(rec);
  _write(list_);
  return list_[i];
}

// ── reading ─────────────────────────────────────────────────────────────────

function get(id) {
  if (!id || id === 'neutral') return null;      // neutral has no record - see the header
  return _read().find(n => String(n.id) === String(id)) || null;
}

const voiceLines = (rec) => VOICE_FIELDS.reduce((n, f) => n + ((rec && rec.voice && rec.voice[f]) || []).length, 0);
const hasVoice = (rec) => voiceLines(rec) > 0;
const unreadSamples = (rec) => ((rec && rec.samples) || []).map((s, i) => ({ s, i })).filter(x => x.s && !x.s.readAt);

// The voice in the shape the prompts render (writing-prompts.renderProfile): a field's lines as one paragraph, the two
// lists as lists.
function voiceProfile(rec) {
  if (!hasVoice(rec)) return null;
  const p = {};
  for (const f of VOICE_FIELDS) {
    const texts = (rec.voice[f] || []).map(l => l.text);
    p[f] = LIST_FIELDS.has(f) ? texts : texts.map(t => (/[.!?…:;)"'»]$/.test(t) ? t : t + '.')).join(' ');
  }
  return p;
}

// What a shelf row needs: never the sample texts, which are tens of KB each and would make
// listing the shelf the most expensive request on the page.
function summary(n) {
  const samples = n.samples || [];
  const words = samples.reduce((sum, s) => sum + (s.words || countWords(s.text)), 0);
  const unread = unreadSamples(n);
  return {
    id: n.id,
    name: n.name || 'Untitled',
    origin: n.origin || '',
    samples: samples.length,
    words,
    unread: unread.length,
    unreadWords: unread.reduce((sum, x) => sum + (x.s.words || countWords(x.s.text)), 0),
    ready: hasVoice(n),
    enough: words >= MIN_SAMPLE_WORDS,
    createdAt: n.createdAt || null,
    updatedAt: n.updatedAt || null,
  };
}

function summaries() {
  return _read()
    .map(summary)
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
}

// The record as the page sees it: the samples without their whole text (the column shows the first lines).
function view(rec) {
  if (!rec) return null;
  const out = { ...rec };
  out.samples = (rec.samples || []).map(s => {
    const text = String(s.text || '');
    const o = { ...s, text: text.slice(0, 400) };
    o.chars = text.length;
    return o;
  });
  return out;
}

// ── writing ─────────────────────────────────────────────────────────────────

function create(name) {
  const clean = String(name || '').trim();
  if (!clean) throw new Error('A narrator needs a name.');
  const list_ = _read();
  const rec = _norm({
    id: newId(), name: clean, builtin: false, origin: '',
    samples: [], voice: null, createdAt: _now(), updatedAt: _now(),
  });
  list_.unshift(rec);
  _write(list_);
  return rec;
}

function remove(id) {
  const list_ = _read();
  const next = list_.filter(n => String(n.id) !== String(id));
  if (next.length === list_.length) throw new Error('No such narrator.');
  _write(next);
  return true;
}

// `kind` is where the text came from - typed, a file that was transcribed, a link, a source of the Library - and
// is kept for the row's sake only. What the reading reads is `text`, whatever the origin. A new sample is not read yet.
function addSample(id, { kind = 'text', label = '', text = '', url = '', linkKey = '', sourceId = '' }) {
  const body = String(text || '').trim();
  if (!body) throw new Error('The sample is empty.');
  return _apply(id, (rec) => {
    const sample = { kind, label: String(label || '').slice(0, 200), words: countWords(body), text: body, addedAt: _now() };
    // A link's address, and what it is known by under every spelling of it (lib/ytdlp.js
    // info().key) - so the same video is not transcribed into the same narrator twice.
    if (url) sample.url = String(url).slice(0, 2000);
    if (linkKey) sample.linkKey = String(linkKey).slice(0, 200);
    if (sourceId) sample.sourceId = String(sourceId);
    rec.samples = [...(rec.samples || []), sample];
  });
}

function removeSample(id, index) {
  return _apply(id, (rec) => {
    const samples = (rec.samples || []).slice();
    const i = parseInt(index, 10);
    if (!Number.isInteger(i) || i < 0 || i >= samples.length) throw new Error('No such sample.');
    samples.splice(i, 1);
    rec.samples = samples;
  });
}

// ── the voice, by hand ───────────────────────────────────────────────────────

function _findLine(rec, lineId) {
  for (const f of VOICE_FIELDS) {
    const i = ((rec.voice || {})[f] || []).findIndex(l => String(l.id) === String(lineId));
    if (i >= 0) return { f, i };
  }
  throw new Error('No such line of the voice.');
}

function editVoiceLine(id, lineId, text) {
  const t = _cut(text, 1200);
  if (!t) throw new Error('An empty line is deleted, not saved - press ✕.');
  return _apply(id, (rec) => {
    const { f, i } = _findLine(rec, lineId);
    rec.voice[f][i] = { ...rec.voice[f][i], text: t, by: 'hand', at: _now() };
  });
}

function removeVoiceLine(id, lineId) {
  return _apply(id, (rec) => {
    const { f, i } = _findLine(rec, lineId);
    rec.voice[f].splice(i, 1);
  });
}

// ── a reading of the new samples ────────────────────────────────────────────

/**
 * What one reading brought, put into the narrator in one write: the voice's NEW lines appended (a line it has already,
 * word for word, dropped), and the samples read marked.
 * @param {object} got  { <field>: [text] } - the voice fields, new lines only
 * @param {object} o    { readId, model, samples: [index] }
 * @returns {{ rec, added: number }}
 */
function applyReading(id, got, o) {
  let added = 0;
  const at = _now();
  const by = String(o.readId || '');
  const rec = _apply(id, (r) => {
    const first = !hasVoice(r);
    if (!r.voice) r.voice = {};
    for (const f of VOICE_FIELDS) {
      const have = (r.voice[f] = r.voice[f] || []);
      const seen = new Set(have.map(l => keyOf(l.text)));
      for (const t of _lines((got || {})[f])) {
        const k = keyOf(t);
        if (!k || seen.has(k)) continue;
        seen.add(k);
        have.push({ id: _rid('vl_'), text: _cut(t, 1200), at, by });
        added++;
      }
    }
    const read = new Set((o.samples || []).map(Number));
    r.samples = (r.samples || []).map((s, i) => (read.has(i) ? { ...s, readAt: at } : s));
    r.lastRead = { id: by, at, model: String(o.model || ''), first };
  });
  return { rec, added };
}

function totalWords(rec) {
  return (rec.samples || []).reduce((sum, s) => sum + (s.words || countWords(s.text)), 0);
}

module.exports = {
  FILE, MIN_SAMPLE_WORDS, NEUTRAL, VOICE_FIELDS,
  countWords, newId, keyOf,
  get, summary, summaries, view,
  create, remove,
  addSample, removeSample, unreadSamples,
  hasVoice, voiceProfile, editVoiceLine, removeVoiceLine, applyReading,
  totalWords,
};
