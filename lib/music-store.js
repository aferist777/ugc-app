'use strict';

// ════════════════════════════════════════════════════════════════════════════
// THE MUSIC - data/suno-lib.json, files flat in media/audio/ (no categories: the owner, phase V28.4, 2026-10-12).
// Suno's two variants of a generation are two records (routes/music.js files them); since V28.4 a track can also be
// brought in from this computer (`source: 'upload'`). The Library's Media shelf shows them under Audio -> Music.
//
//   read() / write(list)             the store, newest first; written atomically
//   add(workPath, { name, source, original, wave })
//                                    a file that arrived in media/work/ -> media/audio/, measured, filed first; `source`
//                                    'upload' by default - 'cut' for a piece cut out of a track (lib/audio-cut.js, phase
//                                    V54), which keeps `original` - the track and the stretch it came from
//   fillLengths()                    the tracks filed before their length was kept are measured, in the background
//
// A record: { id, title, audioPath, style, createdAt, duration?, source?, gen?, variant?, favorite?, folder?, mood?, moodMade?,
//             wave?, original? }
//
// THE HIGHLIGHTS FOLDER (phase V34.F, the owner 2026-10-23, (ф3): "появляется одна папка highlights, а в ней 10 настроений.
// добавлять можно, но только в корневую highlights ... чтобы папки не загаживать"): Music -> highlights -> ten MOOD folders,
// one per highlights preset of V34.A (public/js/audio/almanac-data.js HIGHLIGHT_PRESETS). On the record:
//   folder: 'highlights'   it is in the highlights folder (no field - Music itself)
//   mood: <preset id>      in that mood's folder (no field - the highlights folder's own root)
//   moodMade: <preset id>  the preset it was MADE by (lib/audio-gens.js files it there) - never changes
// A mood folder is LOCKED: only a track made by its preset lies there. A person's own track goes into the root of
// highlights at most. Nothing moves on the disk - the fields are the place. Everything in highlights (its root and its moods)
// is what the highlights popup offers (V33.8, GET /api/audio/music/highlights).
//
//   moods() / isMood(id)             [{ id, label, about }] - the ten, in the presets' order
//   placeOf(rec)                     { folder, mood, moodMade }
//   place(id, { folder, mood })      the rule above; a refusal throws with `status` 409 (404 - no such track)
//   highlights()                     { moods: [{ id, label, about, tracks }], root: [tracks] } - the tracks whose file is there
// ════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const { writeFileAtomic } = require('./atomic-write');
const { DATA_DIR, ROOT_DIR, MEDIA } = require('./config');

const FILE = path.join(DATA_DIR, 'suno-lib.json');

function read() {
  try { const l = JSON.parse(fs.readFileSync(FILE, 'utf8')); return Array.isArray(l) ? l : []; }
  catch (e) { return []; }
}
function write(list) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  writeFileAtomic(FILE, JSON.stringify(list, null, 2));
}

const _key = (p) => String(p || '').split('?')[0];
const _abs = (u) => path.join(ROOT_DIR, _key(u).replace(/^\/+/, ''));
const _r2 = (v) => Math.round((+v || 0) * 100) / 100;

/** A track from this computer: measured where it arrived (media/work/), then moved into media/audio/ and filed. */
async function add(workPath, opts) {
  const o = opts || {};
  const from = _abs(workPath);
  const dim = await require('./media-probe').probe(from);
  if (!dim.audio) {
    try { fs.unlinkSync(from); } catch (e) { /* gone */ }
    throw new Error('it has no sound in it');
  }
  // ── From here to the write: one tick. ──
  fs.mkdirSync(MEDIA.audio, { recursive: true });
  let taken = [];
  try { taken = fs.readdirSync(MEDIA.audio); } catch (e) { /* empty */ }
  const name = require('./names').uniqueFile(path.basename(from), taken);
  const dest = path.join(MEDIA.audio, name);
  fs.renameSync(from, dest);
  const rec = {
    id: 'mus' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    title: String(o.name || '').trim().slice(0, 120) || name.replace(/\.[^.]+$/, ''),
    audioPath: '/media/audio/' + name,
    style: '',
    createdAt: new Date().toISOString(),
    duration: _r2(dim.duration),
    source: o.source === 'cut' ? 'cut' : 'upload',
  };
  if (o.original && o.original.path) rec.original = o.original;
  if (Array.isArray(o.wave) && o.wave.length) rec.wave = o.wave;
  const list = read();
  list.unshift(rec);
  write(list);
  return rec;
}

// The tracks Suno made before their length was kept (V28.4) are measured once, one after another, and written in one
// tick at the end - a record deleted meanwhile is not brought back. Asked whenever the media shelf gives its music.
let _filling = false;
function fillLengths() {
  if (_filling) return;
  const want = read().filter(t => t && t.audioPath && !(+t.duration > 0) && fs.existsSync(_abs(t.audioPath)));
  if (!want.length) return;
  _filling = true;
  (async () => {
    const got = new Map();
    for (const t of want) {
      try { const d = (await require('./media-probe').probe(_abs(t.audioPath))).duration; if (d > 0) got.set(String(t.id), _r2(d)); }
      catch (e) { /* unread: asked again next time */ }
    }
    if (got.size) {
      const list = read();
      let n = 0;
      for (const t of list) if (t && got.has(String(t.id)) && !(+t.duration > 0)) { t.duration = got.get(String(t.id)); n++; }
      if (n) write(list);
    }
  })().catch(e => console.warn('[music] lengths were not measured:', e.message)).finally(() => { _filling = false; });
}

// ── The highlights folder and its moods (V34.F) ─────────────────────────────
const HIGHLIGHTS = 'highlights';
let _moods = null;
function moods() {
  if (_moods) return _moods;
  let A = null;
  try { A = require('../public/js/audio/almanac-data.js'); } catch (e) { A = null; }
  _moods = ((A && A.HIGHLIGHT_PRESETS) || []).map(p => ({ id: String(p.id), label: String(p.label || p.id), about: String(p.about || '') }));
  return _moods;
}
const isMood = (id) => moods().some(m => m.id === String(id || ''));

function placeOf(rec) {
  const r = rec || {};
  const folder = r.folder === HIGHLIGHTS ? HIGHLIGHTS : '';
  return { folder, mood: folder && isMood(r.mood) ? String(r.mood) : '', moodMade: isMood(r.moodMade) ? String(r.moodMade) : '' };
}

const _no = (msg, status) => Object.assign(new Error(msg), { status: status || 409 });

/** A track put into Music itself, the highlights folder, or - only the one its preset made it for - a mood folder. */
function place(id, to) {
  const t = to || {};
  const folder = String(t.folder || '');
  const mood = String(t.mood || '');
  if (folder && folder !== HIGHLIGHTS) throw _no('there is no folder "' + folder + '" in Music', 400);
  if (mood && !isMood(mood)) throw _no('there is no mood "' + mood + '"', 400);
  if (mood && !folder) throw _no('a mood folder is inside highlights', 400);
  // ── Read, change, write: one tick. ──
  const list = read();
  const rec = list.find(x => x && String(x.id) === String(id || ''));
  if (!rec) throw _no('no such track', 404);
  if (mood && placeOf(rec).moodMade !== mood) {
    const m = moods().find(x => x.id === mood);
    throw _no('"' + (m ? m.label : mood) + '" takes only the tracks made by its preset - yours go into highlights itself');
  }
  if (folder) rec.folder = HIGHLIGHTS; else delete rec.folder;
  if (mood) rec.mood = mood; else delete rec.mood;
  write(list);
  return placeOf(rec);
}

function highlights() {
  const tracks = read().filter(t => t && t.audioPath && placeOf(t).folder && fs.existsSync(_abs(t.audioPath)))
    .map(t => ({ id: String(t.id), title: String(t.title || 'track'), path: String(t.audioPath), dur: +t.duration || 0,
      wave: Array.isArray(t.wave) ? t.wave : [], mood: placeOf(t).mood, favorite: !!t.favorite, createdAt: t.createdAt || null }));
  return {
    moods: moods().map(m => Object.assign({}, m, { tracks: tracks.filter(x => x.mood === m.id) })),
    root: tracks.filter(x => !x.mood),
  };
}

module.exports = { FILE, read, write, add, fillLengths, HIGHLIGHTS, moods, isMood, placeOf, place, highlights };
