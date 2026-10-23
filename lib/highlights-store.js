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
       ask:    null | { length: up30|30-60|60-90, count: 3|5|10|15|20, title,
                        style: { preset, name } | { preset: '@by-video', name, byKind: { podcast, documentary } } (V33.8),
                        kind: auto|podcast|documentary (an old `facts` is read as documentary - kindOf),
                        music: [{ id, title, path, dur }] (V33.8) }
       work:   { state: idle|running|done|failed, step: download|copy|hear|find|fragments|done, alertId, error, startedAt,
                 endedAt, interrupted }
       hearing: null | { engine, model, words, seconds, paid, reused, local, language, at }
       agent:  null | { askedAt, answeredAt, by, asked, found, unsure, tried, kind (V33.8: what auto found the video to be) }
       fragments: [{ n, rank, title, score, hook, why, text, pieces: [{ start, end }], seconds, state, key, thumb, error,
                     deletedAt, music: { id, title, path } | null, musicNote (V33.8) }]
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
  'up30': { label: 'up to 30 s', min: 12, max: 30 },
  '30-60': { label: '30-60 s', min: 30, max: 60 },
  '60-90': { label: '60-90 s', min: 60, max: 90 },
};
// How many fragments: (х4), and 20 since the owner's word of 2026-10-21 (the agent answered 15 in 20-28 s).
const COUNTS = [3, 5, 10, 15, 20];
// (phase V33.6, the owner's (х54)-(х57)) What kind of video it is - where the frame looks where there is no face, and what the
// agent is told to look for. auto: a whole person when there is one for most of the shot, else the whole frame; podcast: the
// whole frame (no people looked for - quicker).
// (phase V33.8, the owner 2026-10-23, (у6), (ф1), (ф2)) Three kinds: auto, podcast · interview, documentary - facts ·
// commentary went, and a record that says `facts` is read as documentary. A documentary's shot with no face shows a 3:2
// window from the middle over the blur (`wide`, public/js/framing/path.js), no people looked for: its text, charts and
// screens stay nearly whole.
// What the agent is told for each kind - its own rules - is lib/highlights-agent.js GUIDES.
const KINDS = {
  auto: { label: 'auto', people: true, wide: 0 },
  podcast: { label: 'podcast · interview', people: false, wide: 0 },
  documentary: { label: 'documentary', people: false, wide: 3 / 2 },
};
const OLD_KINDS = { facts: 'documentary' };
/** A kind as asked - one of KINDS, an old one read as its new name, or auto. */
const kindKey = (k) => (KINDS[k] ? String(k) : (OLD_KINDS[k] || 'auto'));
const kindOf = (rec) => kindKey(rec && rec.ask ? rec.ask.kind : '');

// (phase V33.8, the owner's (в1)) The caption style "by the video": chosen in the popup for auto, decided by the kind the agent
// found - a talk (podcast, vlog, reaction, monologue, stream, other) wears the style kept for podcast, a story told (documentary,
// lecture, tutorial, sermon) the one kept for documentary. ask.style = { preset: BY_VIDEO, name, byKind: { podcast, documentary } }.
const BY_VIDEO = '@by-video';
const GROUP_OF = { documentary: 'documentary', lecture: 'documentary', tutorial: 'documentary', sermon: 'documentary' };
const groupOf = (found) => GROUP_OF[found] || 'podcast';
/** The kind the agent found (auto's answer), '' before it answered or for the other kinds. */
const foundOf = (rec) => String((rec && rec.agent && rec.agent.kind) || '');
/** The caption preset the fragments wear: the one chosen, or - "by the video" - the one for the kind the agent found. */
function styleOf(rec) {
  const s = (rec && rec.ask && rec.ask.style) || {};
  if (s.preset !== BY_VIDEO) return String(s.preset || '');
  const by = s.byKind || {};
  const g = kindOf(rec) === 'auto' ? groupOf(foundOf(rec)) : kindOf(rec);
  return String(((by[g] || by.podcast || by.documentary || {}).preset) || '');
}
/**
 * How a fragment's pieces are framed where there is no face: { people, wide } - the kind's own (V33.6, V33.8); and (the owner's
 * (в2)) auto that found a documentary keeps following people but shows the documentary's 3:2 window instead of the whole frame.
 */
function framingOf(rec) {
  const k = kindOf(rec);
  const K = KINDS[k];
  const wide = K.wide || (k === 'auto' && foundOf(rec) === 'documentary' ? KINDS.documentary.wide : 0);
  return { people: K.people, wide };
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
  return { title, createdAt: now, updatedAt: now, adv: null, owner: require('./ownership').uidOf(),
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

module.exports = { FILE, KIND, LENGTHS, COUNTS, KINDS, kindKey, kindOf, BY_VIDEO, groupOf, foundOf, styleOf, framingOf, get, entry, list, urlOf, dirOf, create, apply, rename, named, remove, sync,
  homeKey, fragKey, ofKey, uniqueTitle, isPiece };
