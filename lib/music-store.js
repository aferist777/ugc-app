'use strict';

// ════════════════════════════════════════════════════════════════════════════
// THE MUSIC - data/suno-lib.json, files flat in media/audio/ (no categories: the owner, phase V28.4, 2026-10-12).
// Suno's two variants of a generation are two records (routes/music.js files them); since V28.4 a track can also be
// brought in from this computer (`source: 'upload'`). The Library's Media shelf shows them under Audio -> Music.
//
//   read() / write(list)             the store, newest first; written atomically
//   add(workPath, { name })          a file that arrived in media/work/ -> media/audio/, measured, filed first
//   fillLengths()                    the tracks filed before their length was kept are measured, in the background
//
// A record: { id, title, audioPath, style, createdAt, duration?, source?, gen?, variant?, favorite? }
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
    source: 'upload',
  };
  const list = read();
  list.unshift(rec);
  write(list);
  return rec;
}

// The tracks Suno made before their length was kept (V28.4) are measured once, one after another, and written in one
// tick at the end - a record deleted meanwhile is not brought back. Asked by whoever builds the music shelf.
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

module.exports = { FILE, read, write, add, fillLengths };
