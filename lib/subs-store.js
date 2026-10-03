'use strict';

// ════════════════════════════════════════════════════════════════════════════
// WHAT WAS HEARD, kept beside the project (phase K1, docs/local-app/PLAN.md decision 6).
//
//   projects/<folder>/subs/<timeline key>.json
//     { v: 1,
//       answers: { <sig>: { at, model, language, seconds, suspect, asked, answer } },
//       runs:    [ { at, audio, seconds, model, local, language, chunks: [{ sig, sigL, from, seconds }],
//                    paid, reused, laid: { rev, lines, words, engine, fell } | null } ]   newest first, at most 5 }
//
// An answer heard on this computer (phase K1b, lib/whisper-local.js) sits beside Groq's under its own
// signature (sigL), with engine: 'local', the build, the timing and the raw tokens it was made from.
//
// `answer` is Groq's own answer, whole. A piece of sound is known by its signature - the hash of its
// samples, the model and the language asked for - never by a path: the file holds no address at all,
// so a project renamed, moved or imported carries it as it is (lib/relocate.js moves the folder, and
// rewrites nothing in it). The same sound is never paid for twice; a copy of a project, which lives
// in the same folder, finds the answers of its original here too.
//
// NOT in merge/: every .json there is read as a timeline (lib/merge-store.js).
// ════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const { PROJECTS_DIR } = require('./config');
const { writeFileAtomic } = require('./atomic-write');
const MSTORE = require('./merge-store');

const SUB = 'subs';
const RUNS = 5;
const KEY_RE = /^[A-Za-z0-9_-]{1,80}$/;

const _empty = () => ({ v: 1, answers: {}, runs: [] });

function _dir(key) {
  const at = MSTORE.locate(key);
  return at ? path.join(PROJECTS_DIR, at.folder, SUB) : null;
}
/** The file of a timeline, wherever its project folder is now; null for a key that has no timeline. */
function fileOf(key) {
  if (!KEY_RE.test(String(key || ''))) return null;
  const dir = _dir(key);
  return dir ? path.join(dir, key + '.json') : null;
}

function _readAbs(abs) {
  try {
    const d = JSON.parse(fs.readFileSync(abs, 'utf8'));
    if (!d || typeof d !== 'object') return _empty();
    return { v: 1, answers: (d.answers && typeof d.answers === 'object') ? d.answers : {},
      runs: Array.isArray(d.runs) ? d.runs : [] };
  } catch (e) { return _empty(); }
}

function read(key) {
  const abs = fileOf(key);
  return abs ? _readAbs(abs) : _empty();
}

function _write(key, doc) {
  const abs = fileOf(key);
  if (!abs) return false;
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  writeFileAtomic(abs, JSON.stringify(doc, null, 2));
  return true;
}

// Re-read, change, write - in one tick, so two steps of one job cannot write each other's copy.
function _apply(key, fn) {
  const doc = read(key);
  fn(doc);
  return _write(key, doc);
}

/** May an answer be used again? A suspect one is asked for once more; the second answer stands. */
const _usable = (e) => !!e && !!e.answer && (!e.suspect || (+e.asked || 1) >= 2);

/**
 * An answer for this sound: this timeline's own file first, then every other file in the same
 * folder (a copy of the project). One found elsewhere is copied in, so it outlives the other file.
 * `any`: a suspect answer too - laying again what was heard (K2) asks nobody, so it takes what there is.
 */
function find(key, sig, any) {
  const ok = (e) => _usable(e) || (!!any && !!e && !!e.answer);
  const own = read(key).answers[sig];
  if (ok(own)) return own;
  const dir = _dir(key);
  if (!dir) return null;
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.json') && f !== key + '.json'); } catch (e) { return null; }
  for (const f of files) {
    const e = _readAbs(path.join(dir, f)).answers[sig];
    if (ok(e)) {
      _apply(key, (doc) => { doc.answers[sig] = e; });
      return e;
    }
  }
  return null;
}

/**
 * How many times this sound was asked for already, for the count of asks a suspect answer gets - in any
 * file of the folder (review K1): a copy re-asking its original's suspect answer is the SECOND ask, and
 * that answer stands; counted from its own file alone it was the first, and was paid for a third time.
 */
function asked(key, sig) {
  const count = (e) => (e ? (+e.asked || 1) : 0);
  let n = count(read(key).answers[sig]);
  const dir = _dir(key);
  if (!dir) return n;
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.json') && f !== key + '.json'); } catch (e) { return n; }
  for (const f of files) n = Math.max(n, count(_readAbs(path.join(dir, f)).answers[sig]));
  return n;
}

/** An answer, the moment it arrives: paid work survives whatever happens next. */
function putAnswer(key, sig, entry) {
  return _apply(key, (doc) => { doc.answers[sig] = entry; });
}

// Answers no kept run refers to are dropped whenever a run is written.
function _prune(doc) {
  doc.runs = doc.runs.slice(0, RUNS);
  const used = new Set();
  // A piece has two names (phase K1b): heard by Groq (sig) and heard on this computer (sigL). Both are
  // kept - a run that fell over to this computer must not prune the answers the next one finds.
  for (const r of doc.runs) for (const c of (r.chunks || [])) { used.add(c.sig); if (c.sigL) used.add(c.sigL); }
  for (const sig of Object.keys(doc.answers)) if (!used.has(sig)) delete doc.answers[sig];
}

/**
 * A run, before anything is asked: its record is there even if the app dies halfway. An older run of the
 * SAME sound heard the same way (same samples, language, models) is folded into it - its lay carried over
 * until this one lays - so pressing again, or "back to what was heard", never pushes out of the file the
 * answers kept for another version of the sound (review K2: five presses did).
 */
function putRun(key, run) {
  return _apply(key, (doc) => {
    const same = (r) => r && r.at !== run.at && r.audio === run.audio && (r.language || null) === (run.language || null)
      && r.model === run.model && r.local === run.local;
    const older = doc.runs.find(same);
    if (older && !run.laid && older.laid) run.laid = older.laid;
    doc.runs = [run].concat(doc.runs.filter((r) => r.at !== run.at && !same(r)));
    _prune(doc);
  });
}

/** The run, once it has been laid. A run that laid nothing keeps the lay it carried over (putRun). */
function setLaid(key, runAt, laid) {
  return _apply(key, (doc) => {
    const r = doc.runs.find((x) => x.at === runAt);
    if (r && laid) r.laid = laid;
  });
}

/** The last run that was laid, for "last listened ..." when no job is in memory. */
function lastLaid(key) {
  const r = read(key).runs.find((x) => x && x.laid);
  return r ? { at: r.laid.at || r.at, lines: r.laid.lines, words: r.laid.words, seconds: r.seconds,
    language: r.language || null, heard: r.heard || null, engine: r.laid.engine || 'cloud', fell: r.laid.fell || null } : null;
}

module.exports = { fileOf, read, find, asked, putAnswer, putRun, setLaid, lastLaid, SUB, KEY_RE };
