'use strict';

// ════════════════════════════════════════════════════════════════════════════
// NARRATORS — how a script is written, as opposed to the voice that reads it.
//
// A narrator is built from real writing by one author: the samples go to a model, which
// describes the voice behaviourally and picks out the author's words and phrases, and that
// drives the hook, script, cleaning and enrichment prompts. Nothing here generates anything; it
// stores the samples and what was read out of them.
//
// Three things are deliberate and easy to undo by accident:
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
// ONE NARRATOR, ONE VOICE (phase V38, the owner 2026-10-23: "нужен один нарратор у которого пополняется его фразы и
// словарь ... the voice должен обновляться если нужно, но только дополняться. если что то из нового чтения повторяется
// то не обновлять"). Until V38 a voice was read again and again and every reading kept, a script drawing one at random;
// now there is ONE voice, kept as LINES per field (`voice.<field>: [{ id, text, at, by }]`), and a reading of the samples
// not read yet only ADDS: a line the voice already has, word for word, is dropped. Every line can be corrected or
// deleted by hand (the owner's (д17)), so a mistake does not stay for ever. Beside it two SETS: `vocabulary` (the
// author's words - what he says instead of what, when, examples) and `phrases` (his signature lines and turns of
// phrase - which kind, where they go, when, examples). A reading PROPOSES new entries (`pending`, accepted or dropped
// by hand - a dropped one is remembered in `dismissed` and not proposed again) and adds new examples to the entries
// there are at once. Everything is in English (V29); the Russian original lies beside it (`source`), for the person only.
//
// OLDER RECORDS ARE FOLDED WHEN READ, never rewritten at start: a record with readings and no `voice` gets the newest
// reading as its voice, the lists of every reading merged without repeats (ids derived from the place, so the same
// line has the same id at every read), and its samples counted as read. The file holds the folded form from the
// first change of that narrator on; `readings` (the old ones) stay in it untouched, as history nobody reads.
// ════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');

const FILE = path.join(require('./config').DATA_DIR, 'narrators.json');
const { writeFileAtomic } = require('./atomic-write');

// Below this the analysis comes back generic and useless - it describes writing in general
// rather than this author. Measured in an earlier project, kept here.
const MIN_SAMPLE_WORDS = 500;

const NEUTRAL = { id: 'neutral', name: 'Neutral', builtin: true };

// The fields of a voice, in the order they are shown and told: the scalar ones were one sentence each before V38 and
// are lines now; the last two always were lists.
const VOICE_FIELDS = ['summary', 'sentences', 'rhythm', 'address', 'register', 'imagery',
  'humour', 'openings', 'endings', 'stance', 'signature_moves', 'never_does'];
const LIST_FIELDS = new Set(['signature_moves', 'never_does']);

// The two sets. `text` is the word or the phrase itself; the rest is what the writer is told about it.
const LISTS = ['vocabulary', 'phrases'];
const PHRASE_KINDS = ['signature', 'idiom'];
const PHRASE_PLACES = ['anywhere', 'opening', 'ending'];
// How many scripts back a signature phrase counts as "used lately" (the owner's (д7)).
const RECENT_SCRIPTS = 5;
const MAX_EXAMPLES = 20;

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

// The readings a record had before V38, oldest first. A record older still had only `profile` - that profile was one.
function oldReadings(rec) {
  if (!rec) return [];
  if (Array.isArray(rec.readings) && rec.readings.length) return rec.readings;
  if (rec.profile && rec.profile.summary) {
    return [{ id: 'rd_first', at: rec.updatedAt || rec.createdAt || null, model: '', profile: rec.profile }];
  }
  return [];
}

const _lines = (v) => (Array.isArray(v) ? v : (v == null || v === '' ? [] : [v]))
  .map(x => (typeof x === 'string' ? x : (x && x.text) || '')).map(t => String(t).trim()).filter(Boolean);

// The voice the old readings make: the newest one's fields, and every reading's lists merged without repeats (newest
// first). Without a paid call - nothing is read again.
function _fold(rec) {
  const reads = oldReadings(rec);
  if (!reads.length) return null;
  const newest = reads[reads.length - 1];
  const p = newest.profile || {};
  const voice = {};
  for (const f of VOICE_FIELDS) {
    const texts = [];
    const seen = new Set();
    const from = LIST_FIELDS.has(f) ? reads.slice().reverse() : [newest];
    for (const r of from) {
      for (const t of _lines((r.profile || {})[f])) {
        const k = keyOf(t);
        if (!k || seen.has(k)) continue;
        seen.add(k);
        texts.push(t);
      }
    }
    voice[f] = texts.map((text, i) => ({ id: `vf_${f}_${i}`, text, at: newest.at || null, by: 'reading' }));
  }
  if (!p.summary && !voice.summary.length) return null;
  return { voice, lastRead: { id: String(newest.id || 'rd_first'), at: newest.at || null, model: String(newest.model || ''), first: true } };
}

function _normLine(l, f, i) {
  if (typeof l === 'string') return l.trim() ? { id: `vl_${f}_${i}`, text: l.trim(), at: null, by: '' } : null;
  if (!l || !String(l.text || '').trim()) return null;
  return { id: String(l.id || `vl_${f}_${i}`), text: String(l.text).trim(), at: l.at || null, by: String(l.by || '') };
}

function _normExample(x) {
  if (typeof x === 'string') return x.trim() ? { text: x.trim(), source: '', at: null, by: '' } : null;
  if (!x || !String(x.text || '').trim()) return null;
  return { text: String(x.text).trim(), source: String(x.source || ''), at: x.at || null, by: String(x.by || '') };
}

function _normEntry(e, list, i) {
  if (!e || !String(e.text || '').trim()) return null;
  const out = {
    id: String(e.id || `${list === 'phrases' ? 'p' : 'w'}x_${i}`),
    text: String(e.text).trim(),
    meaning: String(e.meaning || ''),
    when: String(e.when || ''),
    examples: (Array.isArray(e.examples) ? e.examples : []).map(_normExample).filter(Boolean),
    source: String(e.source || ''),
    on: e.on !== false,
    by: String(e.by || ''),
    at: e.at || null,
    uses: Math.max(0, parseInt(e.uses, 10) || 0),
    lastUsedAt: e.lastUsedAt || null,
  };
  if (list === 'phrases') {
    out.kind = PHRASE_KINDS.includes(e.kind) ? e.kind : 'idiom';
    out.place = PHRASE_PLACES.includes(e.place) ? e.place : 'anywhere';
  }
  return out;
}

// Every record the way the rest of the app reads it. Unknown fields are kept, so nothing an older or a newer version
// wrote is lost on the next write.
function _norm(n) {
  if (!n || typeof n !== 'object') return n;
  const out = { ...n };
  let folded = null;
  if (!out.voice || typeof out.voice !== 'object') {
    folded = _fold(n);
    out.voice = folded ? folded.voice : null;
    out.lastRead = folded ? folded.lastRead : (out.lastRead || null);
  } else {
    const v = {};
    for (const f of VOICE_FIELDS) v[f] = (Array.isArray(out.voice[f]) ? out.voice[f] : []).map((l, i) => _normLine(l, f, i)).filter(Boolean);
    out.voice = v;
  }
  // The newest old reading - still in `readings`. A record older still, with a profile and no readings, keeps it.
  if (Array.isArray(out.readings) && out.readings.length) delete out.profile;
  // A sample from before V38 carries no date. Read if the voice was folded from a reading: the readings were made from
  // the samples there were, and nothing says which came later - the owner's two narrators were read last.
  out.samples = (Array.isArray(out.samples) ? out.samples : []).map(s => {
    if (!s || typeof s !== 'object') return s;
    if (s.readAt || s.addedAt || !folded) return s;
    return { ...s, readAt: folded.lastRead.at || 'before' };
  });
  for (const l of LISTS) out[l] = (Array.isArray(out[l]) ? out[l] : []).map((e, i) => _normEntry(e, l, i)).filter(Boolean);
  const pend = out.pending && typeof out.pending === 'object' ? out.pending : {};
  const dis = out.dismissed && typeof out.dismissed === 'object' ? out.dismissed : {};
  out.pending = {};
  out.dismissed = {};
  for (const l of LISTS) {
    out.pending[l] = (Array.isArray(pend[l]) ? pend[l] : []).map((e, i) => _normEntry(e, l, 'p' + i)).filter(Boolean);
    out.dismissed[l] = (Array.isArray(dis[l]) ? dis[l] : []).map(String).filter(Boolean);
  }
  out.recent = (Array.isArray(out.recent) ? out.recent : []).filter(r => r && typeof r === 'object').slice(-RECENT_SCRIPTS);
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

function list() { return _read(); }

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
  const on = (l) => (n[l] || []).filter(e => e.on).length;
  return {
    id: n.id,
    name: n.name || 'Untitled',
    origin: n.origin || '',
    samples: samples.length,
    words,
    unread: unread.length,
    unreadWords: unread.reduce((sum, x) => sum + (x.s.words || countWords(x.s.text)), 0),
    ready: hasVoice(n),
    vocabulary: on('vocabulary'),
    phrases: on('phrases'),
    pending: LISTS.reduce((sum, l) => sum + ((n.pending || {})[l] || []).length, 0),
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
  delete out.readings;
  delete out.profile;
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
    samples: [], voice: null, vocabulary: [], phrases: [], createdAt: _now(), updatedAt: _now(),
  });
  list_.unshift(rec);
  _write(list_);
  return rec;
}

function update(id, patch) {
  return _apply(id, (rec) => { Object.assign(rec, patch || {}); });
}

function remove(id) {
  const list_ = _read();
  const next = list_.filter(n => String(n.id) !== String(id));
  if (next.length === list_.length) throw new Error('No such narrator.');
  _write(next);
  return true;
}

// `kind` is where the text came from - typed, a file that was transcribed, a link, a source of the Library (V38) - and
// is kept for the row's sake only. What the reading reads is `text`, whatever the origin. A new sample is not read yet.
function addSample(id, { kind = 'text', label = '', text = '', url = '', linkKey = '', sourceId = '' }) {
  const body = String(text || '').trim();
  if (!body) throw new Error('The sample is empty.');
  return _apply(id, (rec) => {
    const sample = { kind, label: String(label || '').slice(0, 200), words: countWords(body), text: body, addedAt: _now() };
    // (phase V27) A link's address, and what it is known by under every spelling of it (lib/ytdlp.js
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

// ── the voice, by hand (the owner's (д17)) ───────────────────────────────────

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
 * word for word, dropped), new words and phrases proposed (one already in the set, proposed or dropped once is not
 * proposed again), new examples added to the entries named, and the samples read marked.
 * @param {object} got  { voice: { field: [text] }, vocabulary: [entry], phrases: [entry], examples: [{ ref, text, source }] }
 * @param {object} o    { readId, model, samples: [index], refs: { ref -> { list, id, pending } } }
 * @returns {{ rec, added: { voice, vocabulary, phrases, examples } }}
 */
function applyReading(id, got, o) {
  const added = { voice: 0, vocabulary: 0, phrases: 0, examples: 0 };
  const at = _now();
  const by = String(o.readId || '');
  const rec = _apply(id, (r) => {
    const first = !hasVoice(r);
    if (!r.voice) r.voice = {};
    for (const f of VOICE_FIELDS) {
      const have = (r.voice[f] = r.voice[f] || []);
      const seen = new Set(have.map(l => keyOf(l.text)));
      for (const t of _lines((got.voice || {})[f])) {
        const k = keyOf(t);
        if (!k || seen.has(k)) continue;
        seen.add(k);
        have.push({ id: _rid('vl_'), text: _cut(t, 1200), at, by });
        added.voice++;
      }
    }
    for (const l of LISTS) {
      const taken = new Set([...(r[l] || []), ...(r.pending[l] || [])].map(e => keyOf(e.text)).concat(r.dismissed[l] || []));
      for (const e of (got[l] || [])) {
        const n = _entryIn(l, e, { by: 'samples', at });
        if (!n) continue;
        const k = keyOf(n.text);
        if (!k || taken.has(k)) continue;
        taken.add(k);
        r.pending[l].push({ ...n, id: _rid(l === 'phrases' ? 'pp_' : 'pw_') });
        added[l]++;
      }
    }
    for (const x of (got.examples || [])) {
      const where = (o.refs || {})[String(x.ref || '').trim().replace(/^\[|\]$/g, '').toLowerCase()];
      if (!where) continue;
      // A reference may name a proposal still waiting: its example goes with it.
      const pool = where.pending ? r.pending[where.list] : r[where.list];
      const e = (pool || []).find(y => String(y.id) === String(where.id));
      if (e && _addExample(e, { text: x.text, source: x.source, by: 'samples', at })) added.examples++;
    }
    const read = new Set((o.samples || []).map(Number));
    r.samples = (r.samples || []).map((s, i) => (read.has(i) ? { ...s, readAt: at } : s));
    r.lastRead = { id: by, at, model: String(o.model || ''), first };
  });
  return { rec, added };
}

// ── the two sets ────────────────────────────────────────────────────────────

const _list = (l) => { if (!LISTS.includes(l)) throw new Error('No such list.'); return l; };

// An entry as typed or proposed, its fields cut to size; null when it has no text.
function _entryIn(list, e, extra) {
  const text = _cut(e && (e.text || e.word || e.phrase), 200);
  if (!text) return null;
  const out = {
    text, meaning: _cut(e.meaning, 400), when: _cut(e.when, 600), source: _cut(e.source, 300),
    examples: [], on: true, uses: 0, lastUsedAt: null, ...(extra || {}),
  };
  const ex = _cut(e.example, 600);
  if (ex) out.examples.push({ text: ex, source: _cut(e.exampleSource, 600), at: out.at || _now(), by: out.by || '' });
  if (list === 'phrases') {
    out.kind = PHRASE_KINDS.includes(e.kind) ? e.kind : 'idiom';
    out.place = PHRASE_PLACES.includes(e.place) ? e.place : 'anywhere';
  }
  return out;
}

// False when the entry has that example already (word for word) or is full.
function _addExample(e, { text, source = '', by = '', at }) {
  const t = _cut(text, 600);
  if (!t) return false;
  const k = keyOf(t);
  if ((e.examples || []).some(x => keyOf(x.text) === k)) return false;
  if ((e.examples || []).length >= MAX_EXAMPLES) return false;
  e.examples = [...(e.examples || []), { text: t, source: _cut(source, 600), at: at || _now(), by }];
  return true;
}

function _entry(rec, list, entryId) {
  const e = (rec[list] || []).find(x => String(x.id) === String(entryId));
  if (!e) throw new Error('No such entry.');
  return e;
}

// A row typed by hand. One the list has already (the same words) is refused - a second row would only split its
// examples and its count.
function addEntry(id, list, fields) {
  _list(list);
  const n = _entryIn(list, fields, { by: 'hand', at: _now() });
  if (!n) throw new Error(list === 'phrases' ? 'Type the phrase first.' : 'Type the word first.');
  let made = null;
  const rec = _apply(id, (r) => {
    const k = keyOf(n.text);
    if ((r[list] || []).some(e => keyOf(e.text) === k)) throw new Error(`"${n.text}" is in the list already.`);
    // Typed by hand is a decision: a proposal of the same words goes, and a dropped one is not dropped any more.
    r.pending[list] = (r.pending[list] || []).filter(e => keyOf(e.text) !== k);
    r.dismissed[list] = (r.dismissed[list] || []).filter(x => x !== k);
    made = { ...n, id: _rid(list === 'phrases' ? 'p_' : 'w_') };
    r[list] = [...(r[list] || []), made];
  });
  return { rec, entry: made };
}

const EDITABLE = { vocabulary: ['text', 'meaning', 'when', 'source', 'on'], phrases: ['text', 'meaning', 'when', 'source', 'on', 'kind', 'place'] };
function editEntry(id, list, entryId, patch) {
  _list(list);
  return _apply(id, (r) => {
    const e = _entry(r, list, entryId);
    for (const [k, v] of Object.entries(patch || {})) {
      if (!EDITABLE[list].includes(k)) continue;
      if (k === 'on') { e.on = !!v; continue; }
      if (k === 'kind') { if (PHRASE_KINDS.includes(v)) e.kind = v; continue; }
      if (k === 'place') { if (PHRASE_PLACES.includes(v)) e.place = v; continue; }
      if (k === 'text') {
        const t = _cut(v, 200);
        if (!t) throw new Error('An entry with no words is deleted, not saved - press ✕.');
        const key = keyOf(t);
        if ((r[list] || []).some(x => x !== e && keyOf(x.text) === key)) throw new Error(`"${t}" is in the list already.`);
        e.text = t;
        continue;
      }
      e[k] = _cut(v, k === 'when' ? 600 : k === 'source' ? 300 : 400);
    }
  });
}

function removeEntry(id, list, entryId) {
  _list(list);
  return _apply(id, (r) => {
    const e = _entry(r, list, entryId);
    r[list] = r[list].filter(x => x !== e);
  });
}

function addExample(id, list, entryId, { text, source }) {
  _list(list);
  if (!_cut(text, 600)) throw new Error('Type the example first.');
  return _apply(id, (r) => {
    const e = _entry(r, list, entryId);
    if (!_addExample(e, { text, source, by: 'hand' })) {
      throw new Error((e.examples || []).length >= MAX_EXAMPLES ? `An entry keeps ${MAX_EXAMPLES} examples at most.` : 'That example is there already.');
    }
  });
}

function editExample(id, list, entryId, index, { text, source }) {
  _list(list);
  const t = _cut(text, 600);
  if (!t) throw new Error('An empty example is deleted, not saved - press ✕.');
  return _apply(id, (r) => {
    const e = _entry(r, list, entryId);
    const i = parseInt(index, 10);
    if (!e.examples[i]) throw new Error('No such example.');
    e.examples[i] = { ...e.examples[i], text: t, ...(source != null ? { source: _cut(source, 600) } : {}), by: 'hand' };
  });
}

function removeExample(id, list, entryId, index) {
  _list(list);
  return _apply(id, (r) => {
    const e = _entry(r, list, entryId);
    const i = parseInt(index, 10);
    if (!e.examples[i]) throw new Error('No such example.');
    e.examples.splice(i, 1);
  });
}

// A proposal kept (`pid` 'all' keeps every one of that list) - it joins the list as it is; one whose words the list
// has meanwhile gives its examples to that entry instead.
function keepPending(id, list, pid) {
  _list(list);
  return _apply(id, (r) => {
    const all = String(pid) === 'all';
    const take = (r.pending[list] || []).filter(e => all || String(e.id) === String(pid));
    if (!take.length) throw new Error('No such proposal.');
    for (const p of take) {
      const k = keyOf(p.text);
      const had = (r[list] || []).find(e => keyOf(e.text) === k);
      if (had) { for (const x of p.examples || []) _addExample(had, x); continue; }
      r[list] = [...(r[list] || []), { ...p, id: _rid(list === 'phrases' ? 'p_' : 'w_') }];
    }
    const gone = new Set(take.map(e => e.id));
    r.pending[list] = r.pending[list].filter(e => !gone.has(e.id));
  });
}

// A proposal dropped: remembered by its words, so the next reading does not propose it again (the owner's (д3)).
function dropPending(id, list, pid) {
  _list(list);
  return _apply(id, (r) => {
    const all = String(pid) === 'all';
    const take = (r.pending[list] || []).filter(e => all || String(e.id) === String(pid));
    if (!take.length) throw new Error('No such proposal.');
    const keys = new Set(r.dismissed[list] || []);
    for (const p of take) keys.add(keyOf(p.text));
    r.dismissed[list] = [...keys];
    const gone = new Set(take.map(e => e.id));
    r.pending[list] = r.pending[list].filter(e => !gone.has(e.id));
  });
}

// ── what went into a saved script (the owner's (д7)) ───────────────────────────

/**
 * A script saved with entries of the set in it: each one's count goes up, and the script joins the narrator's last
 * RECENT_SCRIPTS - what a signature phrase is checked against before it is offered again.
 * @param {Array<{ list, id }>} used
 */
function noteUses(id, { scenarioId = '', used = [] }) {
  if (!used.length) return get(id);
  const at = _now();
  return _apply(id, (r) => {
    const ids = { vocabulary: [], phrases: [] };
    for (const u of used) {
      if (!LISTS.includes(u.list)) continue;
      const e = (r[u.list] || []).find(x => String(x.id) === String(u.id));
      if (!e || ids[u.list].includes(e.id)) continue;
      e.uses = (e.uses || 0) + 1;
      e.lastUsedAt = at;
      ids[u.list].push(e.id);
    }
    r.recent = [...(r.recent || []), { scenarioId: String(scenarioId), at, ...ids }].slice(-RECENT_SCRIPTS);
  });
}

// The phrases that went into one of the last scripts - "only if nothing else fits".
function recentPhraseIds(rec) {
  return new Set(((rec && rec.recent) || []).flatMap(r => r.phrases || []).map(String));
}

function totalWords(rec) {
  return (rec.samples || []).reduce((sum, s) => sum + (s.words || countWords(s.text)), 0);
}

module.exports = {
  FILE, MIN_SAMPLE_WORDS, NEUTRAL, VOICE_FIELDS, LIST_FIELDS, LISTS, PHRASE_KINDS, PHRASE_PLACES, RECENT_SCRIPTS,
  countWords, newId, keyOf,
  list, get, summary, summaries, view,
  create, update, remove,
  addSample, removeSample, unreadSamples,
  hasVoice, voiceProfile, oldReadings, editVoiceLine, removeVoiceLine, applyReading,
  addEntry, editEntry, removeEntry, addExample, editExample, removeExample, keepPending, dropPending,
  noteUses, recentPhraseIds,
  totalWords,
};
