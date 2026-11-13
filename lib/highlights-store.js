'use strict';

/* highlights-store.js - a highlights project (phase V33.1, the owner 2026-10-20; docs/local-app/PLAN.md "Фаза V33").

   A long video in, short vertical fragments out. A project of kind 'highlights' in data/project-list.json, its folder:
     projects/<name>/highlights.json        the record below
     projects/<name>/merge/<title>.json     its timelines: its OWN one, hl_<id> - what the project picker opens, empty -
                                            and one per fragment, hl_<id>_<n> (V33.1, block 3), never listed in the picker
     projects/<name>/subs/hl_<id>.json      every piece of the video's sound as it was heard (lib/subs-store.js): the app
                                            closed midway and started again pays only for what was not heard yet
     projects/<name>/clips/                 the fragments' pieces, cut out of the video (block 3)
   The VIDEO is not in the folder: it is a source of the Library (media/sources/, data/sources.json - the owner's (х1)),
   and the project names it. Deleting the project leaves the source.

   The record:
     { v, id, name, createdAt, updatedAt, rev,
       video:  null | { sourceId, from: link|file|source, title, seconds, url, path }   - one video a project (х21)
       ask:    null | { length: up30|30-60|60-90 (fragmentation: FRAG_LENGTHS), count: one of its kind's `counts`, title,
                        style: { preset, name } | { preset: '@by-video', name, byKind: { <kind>: { preset, name, mix, anims, fonts } } }
                               (V69 P12),
                        kind: a key of public/js/highlights/kinds.js KINDS (none - auto, kindOf),
                        music: [{ id, title, path, dur, mood }] (V33.8; V68 P3 - the tracks of the moods ticked),
                        moods: [{ id, label }] (V68 P3 - none in a project of before: its ticked tracks) }
       work:   { state: idle|running|done|failed, step: download|copy|hear|find|fragments|done, alertId, error, startedAt,
                 endedAt, interrupted }
       hearing: null | { engine, model, words, seconds, paid, reused, local, language, at }
       agent:  null | { askedAt, answeredAt, by, asked, found, unsure, tried, kind (V33.8: what auto found the video to be) }
       fragments: [{ n, rank, title, score, hook, why, text, pieces: [{ start, end }], seconds, state, key, thumb, error,
                     deletedAt, music: { id, title, path, mood } | null, musicNote (V33.8) }]
       nextN }

   ONE TICK. `apply(id, fn)` reads the record, hands it to `fn` and writes it, with no await between - the slow work (yt-dlp,
   the hearing, the agent) first, then the change (as lib/projects-store.js apply). */

const fs = require('fs');
const path = require('path');
const { PROJECTS_DIR } = require('./config');
const { writeFileAtomic } = require('./atomic-write');
const PROJECTS = require('./projects-store');

const FILE = 'highlights.json';
const KIND = 'highlights';

// The lengths the popup offers (the owner's (х4)) - the agent keeps a fragment inside the span, pieces and all.
const LENGTHS = {
  'up30': { label: 'Up to 30 s', min: 12, max: 30 },
  '30-60': { label: '30-60 s', min: 30, max: 60 },
  '60-90': { label: '60-90 s', min: 60, max: 90 },
};
// How many fragments: (х4), and 20 since the owner's word of 2026-10-21 (the agent answered 15 in 20-28 s). (phase V69 P12) Each kind
// its own buttons - public/js/highlights/kinds.js `counts` (30 for the talked-over kinds, 50 for stream); COUNTS is every one of them.
const TABLE = require('../public/js/highlights/kinds.js');
const COUNTS = [...new Set(Object.values(TABLE.KINDS).flatMap((k) => k.counts || []))].sort((a, b) => a - b);
// (phase V33.6, the owner's (х54)-(х57)) What kind of video it is - where the frame looks where there is no face, and what the
// agent is told to look for. auto: a whole person when there is one for most of the shot, else the whole frame; podcast: the
// whole frame (no people looked for - quicker).
// (phase V33.8, the owner 2026-10-23, (у6), (ф1), (ф2)) Three kinds: auto, podcast · interview, documentary - facts ·
// commentary went. A documentary's shot with no face shows a 3:2
// window from the middle over the blur (`wide`, public/js/framing/path.js), no people looked for: its text, charts and
// screens stay nearly whole.
// What the agent is told for each kind - its own rules - is lib/highlights-agent.js GUIDES.
// (phase V43, the owner 2026-10-24/25, (ё1)-(ё19)) fragmentation: not the best moments but the WHOLE video, start to end, in
// parts by meaning (`whole`) - its own lengths (FRAG_LENGTHS), no count, no score, the tiles in the video's order; the frame
// follows the most active in it (`active`: action, the speaker, the one who reacts - public/js/framing/path.js) with no blur.
// (phase V69 P12) The kinds are public/js/highlights/kinds.js's - one table for the server and the popup; here what the server frames
// each by (P12a; P12b - the frame by the kind: the speaker, the lecture's shots, the stream's bands). true crime, lecture and stream
// are new (P6, P8, P9); stream is in development ((хп86)) - not started. A shot with no face is the SQUARE from the middle over its
// blur (`wide` 1, (хп36)); documentary is that square on EVERY shot, its faces not counted (`square`, (хп70)); lecture (P12b) by its
// shots ((хп75), `byFace`).
// (phase V69 P12b, (хп63), (хп97), (хп98)) podcast and true crime follow THE SPEAKER: each piece counted with its mouths and lips
// (`active` - lib/faces.js), planned by public/js/framing/active.js with the speaker's rules (`speaker`: no action, the listener
// while a voice off the screen speaks, a shot with no face the square) and punching in x1.2 on the moments' key lines.
const SQUARE = 1;
const FRAMES = {
  auto: { people: true, wide: SQUARE },
  podcast: { people: false, wide: SQUARE, active: true, speaker: true, zoom: 1.2 },
  truecrime: { people: false, wide: SQUARE, active: true, speaker: true, zoom: 1.2 },
  documentary: { people: false, wide: SQUARE, square: true },
  // (phase V69 P12b, (хп75)) lecture BY ITS SHOTS: a face wider than `byFace` of the frame - the square; else the whole frame by its
  // full width over the blur (a slide, a webcam's small window) - each shot its own width (public/js/framing/path.js plan).
  lecture: { people: false, wide: SQUARE, byFace: 0.08 },
  // (phase V69 P12b, (хп82)) stream - P9's table, ready while the kind is in development ((хп86)): the speaker's frame and its
  // punch-ins, and the streamer's webcam over a game as two bands, camera on top, the game below (`cam`, public/js/framing/cam.js).
  stream: { people: false, wide: SQUARE, active: true, speaker: true, zoom: 1.2, cam: true },
  // (ё16) its punch-ins x1.2 - chosen by the owner from three strengths in block 0's clips.
  fragmentation: { people: true, wide: 0, whole: true, active: true, zoom: 1.2 },
  // (P11) what auto frames a video of none of the kinds by: the faces, else a whole person, else the square over its blur.
  other: { people: true, wide: SQUARE },
};
const KINDS = Object.fromEntries(TABLE.BUTTONS.map((k) => [k, { label: TABLE.KINDS[k].label, ...(FRAMES[k] || { people: true, wide: 0 }),
  ...(TABLE.KINDS[k].inDev ? { inDev: true } : {}) }]));
/** The count buttons of a kind - [] for fragmentation (as many parts as come out). */
const countsOf = (kind) => ((TABLE.kindOf(kindKey(kind)) || {}).counts || []).slice();
// (V43, (ё1)) A part's length - the agent keeps to it, 20 % either way for the sake of the meaning (lib/highlights-agent.js fragParse).
// (phase V69 P10, (хп87)) 2-4 min became 2-3 min - no part longer than 3:00 (lib/highlights-agent.js fragCeil); a record that asked
// for 2-4 min is read as it asked (OLD_FRAG_LENGTHS), the popup offers it no more.
const FRAG_LENGTHS = {
  'p30-60': { label: '30-60 s', min: 30, max: 60 },
  'p1-2': { label: '1-2 min', min: 60, max: 120 },
  'p2-3': { label: '2-3 min', min: 120, max: 180 },
};
const OLD_FRAG_LENGTHS = { 'p2-4': { label: '2-4 min', min: 120, max: 240 } };
/** Is this kind the whole video in parts (fragmentation) rather than the best moments. */
const isWhole = (kind) => !!(KINDS[kindKey(kind)] && KINDS[kindKey(kind)].whole);
/** The lengths a kind offers - fragmentation's own, the moments' for the rest. */
const lengthsOf = (kind) => (isWhole(kind) ? FRAG_LENGTHS : LENGTHS);
/** The length a record asked for, as { label, min, max }. */
const lengthOf = (rec) => {
  const L = lengthsOf(kindOf(rec));
  const k = rec && rec.ask ? rec.ask.length : '';
  return L[k] || (isWhole(kindOf(rec)) ? (OLD_FRAG_LENGTHS[k] || FRAG_LENGTHS['p1-2']) : LENGTHS['30-60']);
};
/** A kind as asked - one of KINDS, or auto. */
const kindKey = (k) => (KINDS[k] ? String(k) : 'auto');
const kindOf = (rec) => kindKey(rec && rec.ask ? rec.ask.kind : '');

// ── WHAT A PROJECT ACTS AS (phase V69 P12, P11 - (хп91)-(хп93)) ─────────────
// auto's first call names the kind of the video (lib/highlights-job.js, `agent.kind`); from then on the project ACTS as that kind -
// its rules, its frame, its key lines, its captions, music and title "by the video" - one function says which: actingKind. A kind in
// development (stream) acts as other while it is so (public/js/highlights/kinds.js acting); before the first answer - other. Any
// other kind acts as itself.
const BY_VIDEO = TABLE.BY_VIDEO;
/** The kind auto found the video to be ('' before it answered, or for the other kinds) - an old finding (vlog, sermon...) as other. */
const foundOf = (rec) => {
  const f = String((rec && rec.agent && rec.agent.kind) || '').trim().toLowerCase();
  return TABLE.FOUND.includes(f) ? f : (f ? 'other' : '');
};
/** The kind a project acts as: its own, or - auto - the one it found (other before it answered; a kind in development - other). */
function actingKind(rec) {
  const k = kindOf(rec);
  if (k !== 'auto') return k;
  return TABLE.acting(foundOf(rec) || 'other');
}
const isAuto = (rec) => kindOf(rec) === 'auto';

/**
 * (phase V49, the owner's (пр25), (пр26); V68 P4; V69 P12) What the fragments' captions are laid with: { preset, mix, anims, fonts } -
 * the preset; with several picked in the popup, all of them (`mix`, ids - every fragment the same set, dealt page by page); the
 * animations picked (`anims`, 'in|out' pairs); the fonts picked (`fonts`, families). lib/highlights-cut.js layOut lays it.
 * "BY THE VIDEO" (auto's, (хп93)): the set the popup sent for the kind the project acts as (`style.byKind[kind]` - { preset, mix,
 * anims, fonts } as that kind remembers them), else that kind's standard (public/js/highlights/kinds.js).
 */
function captionsOf(rec) {
  const s = (rec && rec.ask && rec.ask.style) || {};
  const ids = (xs) => (Array.isArray(xs) ? xs.map((x) => String((x && x.preset) || x || '')).filter(Boolean) : []);
  const strs = (xs) => (Array.isArray(xs) ? xs.map(String).filter(Boolean) : []);
  const pack = (set) => {
    const mix = ids(set.mix);
    return { preset: String(set.preset || mix[0] || ''), mix: mix.length >= 2 ? mix : [], anims: strs(set.anims), fonts: strs(set.fonts) };
  };
  if (s.preset !== BY_VIDEO) return pack(s);
  const k = actingKind(rec);
  const by = s.byKind || {};
  let set = by[k];
  if (!set) {
    const T = TABLE.kindOf(k) || TABLE.KINDS.other;
    const std = T.presets.std.filter((x) => x !== BY_VIDEO);
    set = { preset: std[0] || '', mix: std, anims: T.anims.std, fonts: T.fonts.std };
  }
  return pack(set);
}
/**
 * (phase V69 P12, (хп90), (хп93)) Whether the fragments get the title on top: the popup's switch (`ask.title`), and "by the video"
 * (auto's) - the switch the kind it acts as was sent with (`ask.titleByKind`), else that kind's standard.
 */
function titleOf(rec) {
  const a = (rec && rec.ask) || {};
  if (a.title === true || a.title === false) return a.title;
  if (a.title !== BY_VIDEO) return false;
  const k = actingKind(rec);
  const by = a.titleByKind || {};
  if (by[k] === true || by[k] === false) return by[k];
  return (TABLE.kindOf(k) || TABLE.KINDS.other).title === true;
}
/**
 * How a fragment's pieces are framed where there is no face: { people, wide, active, zoom, square } - the kind the project acts as (V33.6,
 * V33.8; V69 P12: auto takes the frame of the kind it found - P11; other: the faces, else a whole person, else the whole frame).
 */
function framingOf(rec) {
  const K = FRAMES[actingKind(rec)] || FRAMES.other;
  // (V43) fragmentation: the frame follows the most active in it, never the whole frame over a blur.
  // (V69 P12b) `speaker` - each piece counted by itself and planned by the speaker's rules (podcast, true crime).
  return { people: !!K.people, wide: K.wide || 0, active: !!K.active, zoom: K.zoom || 0, square: !!K.square, speaker: !!K.speaker, byFace: +K.byFace || 0, cam: !!K.cam };
}

// The project's id - letters and digits only: its timelines' keys are hl_<id> and hl_<id>_<n>.
const _newId = () => 'h' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const homeKey = (id) => 'hl_' + id;
const fragKey = (id, n) => 'hl_' + id + '_' + n;
const KEY_RE = /^hl_([a-z0-9]+)(?:_(\d+))?$/;
/** { id, n } of a highlights timeline's key (n 0 for the project's own), or null. */
function ofKey(key) {
  const m = KEY_RE.exec(String(key || ''));
  return m ? { id: m[1], n: m[2] ? Number(m[2]) : 0 } : null;
}

const _entry = (id) => PROJECTS.entries().find((e) => e.kind === KIND && e.id === String(id)) || null;
const _file = (e) => path.join(PROJECTS_DIR, e.folder, FILE);

function _read(e) {
  try { return JSON.parse(fs.readFileSync(_file(e), 'utf8')); } catch (err) { return null; }
}
function _write(e, rec) {
  fs.mkdirSync(path.dirname(_file(e)), { recursive: true });
  writeFileAtomic(_file(e), JSON.stringify(rec, null, 2));
}
function _touchList(e, patch) {
  PROJECTS._writeList(PROJECTS.entries().map((x) => (x.id === e.id ? { ...x, ...patch } : x)));
}

function _fresh(id, name, now) {
  return {
    v: 1, id, name, createdAt: now, updatedAt: now, rev: 1,
    video: null, ask: null,
    work: { state: 'idle', step: '', alertId: '', error: '', startedAt: null, endedAt: null, interrupted: '' },
    hearing: null, agent: null, fragments: [], nextN: 1,
  };
}

// ── Reading ─────────────────────────────────────────────────────────────────
function get(id) {
  const e = _entry(id);
  return e ? _read(e) : null;
}
function entry(id) { const e = _entry(id); return e ? { ...e } : null; }
function list() {
  const out = [];
  for (const e of PROJECTS.entries()) {
    if (e.kind !== KIND) continue;
    const r = _read(e);
    if (r) out.push(r);
  }
  return out;
}
/** The folder's address, for the files the project keeps (/projects/<folder>/). */
function urlOf(id) { const e = _entry(id); return e ? `/projects/${e.folder}/` : ''; }
function dirOf(id, sub) { return PROJECTS.dirOf(id, sub); }

// ── Titles: every timeline's is the name of a project in the picker, and no two may be one (routes/mergev3.js) ──
function uniqueTitle(want, exceptKey) {
  const MSTORE = require('./merge-store');
  const all = MSTORE.read().timelines;
  const taken = new Set(Object.keys(all).filter((k) => k !== exceptKey).map((k) => String((all[k] || {}).title || '').trim().toLowerCase()));
  const base = String(want || '').trim().slice(0, 110) || 'highlights';
  let t = base;
  for (let n = 2; taken.has(t.toLowerCase()); n++) t = base + ' (' + n + ')';
  return t;
}

// An empty timeline record, the way POST /mv3/timeline/new makes one.
function _timeline(title, now) {
  const SHAPE = require('./timeline-shape');
  return { title, createdAt: now, updatedAt: now, adv: null,
    rev: 1, kind: SHAPE.BLANK_KIND, format: '9:16', tracks: SHAPE.emptyBlank().tracks };
}

// ── Writing ─────────────────────────────────────────────────────────────────
/** A new project with its own (empty) timeline - what the picker opens. Returns the record. */
function create(name) {
  const now = new Date().toISOString();
  const d = new Date(), two = (n) => String(n).padStart(2, '0');
  const day = `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;   // this computer's day
  const id = _newId();
  const title = uniqueTitle(String(name || '').trim() || (day + ' - highlights'));
  const folder = PROJECTS._newFolder(title, 'highlights');
  const e = { id, name: title, folder, kind: KIND, createdAt: now, updatedAt: now };
  _write(e, _fresh(id, title, now));
  PROJECTS._writeList([e, ...PROJECTS.entries()]);
  // Its own timeline, in its folder (lib/merge-store.js _placeFor finds the folder by the key).
  const MSTORE = require('./merge-store');
  const s = MSTORE.read();
  s.timelines[homeKey(id)] = _timeline(title, now);
  MSTORE.write({ ...s, version: (Number(s.version) || 0) + 1, updatedAt: now });
  return get(id);
}

/** The server's own change, in one tick: `fn(rec)` must not await. Returns the record as stored, or null. */
function apply(id, fn) {
  const e = _entry(id);
  if (!e) return null;
  const rec = _read(e);
  if (!rec) return null;
  const out = fn(rec);
  if (out && typeof out.then === 'function') throw new Error('highlights.apply(fn) must not await - do the slow work before the call');
  if (out === false) return rec;
  const now = new Date().toISOString();
  rec.updatedAt = now;
  rec.rev = (Number(rec.rev) || 0) + 1;
  _write(e, rec);
  _touchList(e, { updatedAt: now });
  return rec;
}

/**
 * A new name for the project: its own timeline is renamed, and the folder and the record follow (lib/merge-store.js
 * _followTitle, which a rename from the picker goes through as well). Returns the name it got.
 */
function rename(id, name) {
  const e = _entry(id);
  if (!e) return null;
  const want = String(name || '').trim().slice(0, 110);
  if (!want) return e.name;
  const MSTORE = require('./merge-store');
  const key = homeKey(id);
  const title = uniqueTitle(want, key);
  MSTORE.update(key, (t) => { if (t.title === title) return false; t.title = title; return true; });
  return title;
}

/** Said by lib/merge-store.js when the project's own timeline was renamed and the folder followed. */
function named(id, title) {
  const e = _entry(id);
  if (!e) return;
  const rec = _read(e);
  if (!rec || rec.name === title) return;
  rec.name = String(title || '');
  rec.updatedAt = new Date().toISOString();
  _write(e, rec);
}

/** The project and its folder - its timelines and clips with it; the source stays (lib/projects-store.js remove). */
function remove(id) {
  const e = _entry(id);
  if (!e) return null;
  const out = PROJECTS.remove(e.id);
  require('./merge-store').invalidate();
  return out;
}

// At start: a folder holding highlights.json that the project list does not know - a project carried over from another
// library - joins the list. Before lib/merge-store.js sync, which would take a folder of timelines for a Merge project.
function sync() {
  const entries = PROJECTS.entries();
  const known = new Set(entries.map((e) => e.folder.toLowerCase()));
  const ids = new Set(entries.map((e) => e.id));
  let dirs = [];
  try { dirs = fs.readdirSync(PROJECTS_DIR, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch (err) { /* none */ }
  const add = [];
  for (const d of dirs) {
    if (known.has(d.toLowerCase())) continue;
    let rec;
    try { rec = JSON.parse(fs.readFileSync(path.join(PROJECTS_DIR, d, FILE), 'utf8')); } catch (err) { continue; }
    const id = String((rec && rec.id) || '');
    // Its timelines carry its id in their keys: a project whose id is taken is not adopted under another.
    if (!/^[a-z0-9]+$/.test(id) || ids.has(id)) continue;
    ids.add(id);
    add.push({ id, name: String(rec.name || d), folder: d, kind: KIND, createdAt: rec.createdAt || null, updatedAt: rec.updatedAt || null });
  }
  if (add.length) PROJECTS._writeList([...add, ...entries]);
  return { added: add.length };
}

// (phase V33.2 block 0) A fragment's PIECE on the disk - projects/<a highlights project's folder>/clips/hl<n>_<k>.mp4. The
// preview plays such a file itself while its small copy is not made yet (routes/proxies.js): it is H.264 the size of the
// video, one layer, which a browser plays as it is.
const PIECE_RE = /^hl\d+_\d+\.mp4$/i;
function isPiece(abs) {
  const rel = path.relative(PROJECTS_DIR, path.resolve(String(abs || '')));
  const parts = rel.split(path.sep);
  if (parts.length !== 3 || parts[1] !== 'clips' || !PIECE_RE.test(parts[2]) || rel.startsWith('..')) return false;
  const folder = parts[0].toLowerCase();
  return PROJECTS.entries().some((e) => e.kind === KIND && String(e.folder).toLowerCase() === folder);
}

module.exports = { FILE, KIND, LENGTHS, COUNTS, KINDS, FRAG_LENGTHS, countsOf, isWhole, lengthsOf, lengthOf, kindKey, kindOf, BY_VIDEO, foundOf, actingKind, isAuto, captionsOf, titleOf, framingOf, get, entry, list, urlOf, dirOf, create, apply, rename, named, remove, sync,
  homeKey, fragKey, ofKey, uniqueTitle, isPiece };
