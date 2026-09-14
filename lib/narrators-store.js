'use strict';

// ════════════════════════════════════════════════════════════════════════════
// NARRATORS — how a script is written, as opposed to the voice that reads it.
//
// A narrator is built from real writing by one author: the samples go to a model, which
// describes the voice behaviourally, and that description drives the hook, script and
// cleaning prompts. Nothing here generates anything; it stores samples and the profile made
// from them.
//
// Two things are deliberate and easy to undo by accident:
//
// The SAMPLE TEXT is kept, not just its file name. A narrator whose samples are gone can
// never be re-analysed, so the first changed prompt turns it into a dead end. Azazin arrived
// from an earlier project with three .mp4 labels and 4929 words of transcript, and the words are
// the part that matters.
//
// NEUTRAL IS NOT A RECORD. It is the absence of a profile, and it carries the anti-machine
// rules instead (see writing-prompts.NEUTRAL_BLOCK). Storing it as a row would invite
// someone to add samples to it, and then two rule sets would argue about precedence inside
// one prompt.
//
// A VOICE CAN BE READ MORE THAN ONCE, and every reading is kept. Two readings of the same samples
// describe the same author differently - one leads on the sentence rhythm, another on the humour -
// and which description sits in the prompt decides which of the author's moves the model reaches
// for first. Generation picks a reading at random, so twenty scripts do not all open the same way.
// `profile` still points at the newest reading, because everything that only wants "the voice"
// (the rendered block, the ready flag) should not have to know about the history.
// ════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');

const FILE = path.join(require('./config').DATA_DIR, 'narrators.json');

// Below this the analysis comes back generic and useless - it describes writing in general
// rather than this author. Measured in an earlier project, kept here.
const MIN_SAMPLE_WORDS = 500;

const NEUTRAL = { id: 'neutral', name: 'Neutral', builtin: true };

const _now = () => new Date().toISOString();
const countWords = (text) => String(text || '').trim().split(/\s+/).filter(Boolean).length;

function _read() {
  try {
    const d = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return Array.isArray(d.narrators) ? d.narrators : [];
  } catch (e) { return []; }
}

// Written tmp + rename so a crash mid-write cannot truncate the file: it holds every sample
// text, which is the one thing here that cannot be regenerated.
function _write(list) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ narrators: list }, null, 2), 'utf8');
  fs.renameSync(tmp, FILE);
}

function newId() {
  return Math.random().toString(16).slice(2, 8) + Date.now().toString(16).slice(-6);
}

// ── reading ─────────────────────────────────────────────────────────────────

function list() { return _read(); }

function get(id) {
  if (!id || id === 'neutral') return null;      // neutral has no record - see the header
  return _read().find(n => String(n.id) === String(id)) || null;
}

// Every reading of this voice, oldest first. Records written before readings existed have one
// profile and no history - that profile IS a reading, and saying so here means nothing downstream
// has to carry a special case for it.
function readings(rec) {
  if (!rec) return [];
  if (Array.isArray(rec.readings) && rec.readings.length) return rec.readings;
  if (rec.profile && rec.profile.summary) {
    return [{ id: 'rd_first', at: rec.updatedAt || rec.createdAt || null, model: '', profile: rec.profile }];
  }
  return [];
}

// WHICH reading a script gets written with. Random unless one is asked for by id: the point of
// keeping several is that they are not interchangeable, and rotating them is the cheapest real
// variety available - the samples are the same, but what the prompt calls characteristic is not.
// `which` is one of three things, because two callers know different amounts: the dropdown knows
// only "the second one" (an index), a save that records what actually wrote the script knows the
// id, and anything else means random.
function pickReading(rec, which) {
  const list_ = readings(rec);
  if (!list_.length) return null;
  const wanted = String(which || '').trim();
  const random = !wanted || wanted === 'random';
  let i;
  if (random) i = Math.floor(Math.random() * list_.length);
  else if (/^\d+$/.test(wanted)) i = parseInt(wanted, 10) - 1;
  else i = list_.findIndex(r => String(r.id) === wanted);
  if (i >= list_.length) i = -1;
  // A reading that was deleted between choosing it and writing with it falls back to the newest
  // rather than failing the generation.
  if (i < 0) i = list_.length - 1;
  return { ...list_[i], index: i + 1, total: list_.length, random };
}

// What a shelf row needs: never the sample texts, which are tens of KB each and would make
// listing the shelf the most expensive request on the page.
function summary(n) {
  const samples = n.samples || [];
  const words = samples.reduce((sum, s) => sum + (s.words || countWords(s.text)), 0);
  const reads = readings(n);
  return {
    id: n.id,
    name: n.name || 'Untitled',
    origin: n.origin || '',
    samples: samples.length,
    words,
    readings: reads.length,
    ready: reads.length > 0,
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

// ── writing ─────────────────────────────────────────────────────────────────

function create(name) {
  const clean = String(name || '').trim();
  if (!clean) throw new Error('A narrator needs a name.');
  const list_ = _read();
  const rec = {
    id: newId(), name: clean, builtin: false, origin: '',
    samples: [], profile: null, createdAt: _now(), updatedAt: _now(),
  };
  list_.unshift(rec);
  _write(list_);
  return rec;
}

function update(id, patch) {
  const list_ = _read();
  const i = list_.findIndex(n => String(n.id) === String(id));
  if (i < 0) throw new Error('No such narrator.');
  list_[i] = { ...list_[i], ...patch, id: list_[i].id, updatedAt: _now() };
  _write(list_);
  return list_[i];
}

function remove(id) {
  const list_ = _read();
  const next = list_.filter(n => String(n.id) !== String(id));
  if (next.length === list_.length) throw new Error('No such narrator.');
  _write(next);
  return true;
}

// `kind` is where the text came from - typed, a file that was transcribed, a link - and is
// kept for the row's sake only. What the analysis reads is `text`, whatever the origin.
function addSample(id, { kind = 'text', label = '', text = '' }) {
  const body = String(text || '').trim();
  if (!body) throw new Error('The sample is empty.');
  const rec = get(id);
  if (!rec) throw new Error('No such narrator.');
  const sample = { kind, label: String(label || '').slice(0, 200), words: countWords(body), text: body };
  return update(id, { samples: [...(rec.samples || []), sample] });
}

function removeSample(id, index) {
  const rec = get(id);
  if (!rec) throw new Error('No such narrator.');
  const samples = (rec.samples || []).slice();
  const i = parseInt(index, 10);
  if (!Number.isInteger(i) || i < 0 || i >= samples.length) throw new Error('No such sample.');
  samples.splice(i, 1);
  return update(id, { samples });
}

// A new reading is ADDED, not merged into the old one. A merged profile would be two readings
// arguing inside one prompt, which is exactly what having several separately is for.
function addReading(id, { profile, model = '' }) {
  if (!profile || !profile.summary) throw new Error('That analysis has no summary — refusing to store it.');
  const rec = get(id);
  if (!rec) throw new Error('No such narrator.');
  const list_ = readings(rec).slice();
  list_.push({
    id: 'rd_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
    at: _now(), model: String(model || ''), profile,
  });
  return update(id, { readings: list_, profile });
}

function removeReading(id, readingId) {
  const rec = get(id);
  if (!rec) throw new Error('No such narrator.');
  const before = readings(rec);
  const list_ = before.filter(r => String(r.id) !== String(readingId));
  if (list_.length === before.length) throw new Error('No such reading.');
  // `profile` follows the newest survivor, and becomes null when the last one goes - which is what
  // "not read yet" means everywhere else.
  return update(id, { readings: list_, profile: list_.length ? list_[list_.length - 1].profile : null });
}

function totalWords(rec) {
  return (rec.samples || []).reduce((sum, s) => sum + (s.words || countWords(s.text)), 0);
}

function sampleTexts(rec) {
  return (rec.samples || []).map(s => s.text).filter(Boolean);
}

// Each reading sees the samples in a different order. Two readings of the same words in the same
// order differ only by sampling noise; changing what the model meets first changes what it treats
// as characteristic - so the readings differ by evidence, not just by luck.
function shuffledSampleTexts(rec) {
  const texts = sampleTexts(rec);
  for (let i = texts.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [texts[i], texts[j]] = [texts[j], texts[i]];
  }
  return texts;
}

module.exports = {
  FILE, MIN_SAMPLE_WORDS, NEUTRAL,
  countWords, newId,
  list, get, summary, summaries,
  create, update, remove,
  addSample, removeSample,
  readings, pickReading, addReading, removeReading,
  totalWords, sampleTexts, shuffledSampleTexts,
};
