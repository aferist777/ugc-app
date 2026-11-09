'use strict';

// ════════════════════════════════════════════════════════════════════════════
// THE SOUNDS SHELF (phase V7, the owner 2026-10-07: "categories of sounds - sfx will come too") - data/sounds.json,
// files in media/sounds/<category folder>/ (nocat for none). A fifth kind of the Library's Media shelf beside B-roll,
// Uploads, Hooks and Images, with categories like theirs (lib/library-cats.js kind 'sounds'), placed and moved by
// the same code (lib/shelf-files.js, lib/relocate.js). The video chat attaches a sound from here as a reference; a
// sound brought in from this computer through the chat lands in the project's category. The music - Suno's tracks and
// the ones brought in - is Media -> Audio -> Music (lib/music-store.js): offered as sounds too.
//
// THE ROOT OF AUDIO (2026-11-09, the owner's (в19)-(в21): "должно ложится в корень audio. там пользователь уже распределит по
// своим папкам"): a sound with `inAudio: true` lies in AUDIO itself, not in My sounds - what "Save audio" takes out of a video.
// It has no category (its file in media/sounds/nocat/, as My sounds' own root); filed into My sounds or a folder of it, it
// leaves AUDIO (routes/library.js _patchOne). A sound and a track move between SFX, Music and AUDIO's root by lib/audio-kind.js.
//
//   add(audioPath, opts) -> { item, added }
//
// birols-store.js's shape: the slow part first, where the file arrived (media/work/) - its length measured; THEN, IN
// ONE TICK: `wanted()` asked, the category asked for (by its label - LC.add is idempotent), the file placed, the list
// read again and the record written. A sound already on the shelf is answered with its record, never filed twice.
// ════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const { writeFileAtomic } = require('./atomic-write');
const { DATA_DIR, ROOT_DIR } = require('./config');

const FILE = path.join(DATA_DIR, 'sounds.json');
const KIND = 'sounds';

/** Every sound, newest first. */
function read() {
  try { const l = JSON.parse(fs.readFileSync(FILE, 'utf8')); return Array.isArray(l) ? l : []; }
  catch (e) { return []; }
}
function write(list) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  writeFileAtomic(FILE, JSON.stringify(list, null, 2));
}

const _newId = () => 'snd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const _key = (p) => String(p || '').split('?')[0];
const _abs = (u) => path.join(ROOT_DIR, _key(u).replace(/^\/+/, ''));

const get = (id) => read().find(e => e && e.id === String(id || '')) || null;
const findByPath = (p) => read().find(e => e && _key(e.audioPath) === _key(p)) || null;

/**
 * File a sound. opts: { name, categoryLabel, categoryId, source ('upload' | ...), meta, wanted, inAudio - into AUDIO's root }
 */
async function add(audioPath, opts) {
  const o = opts || {};
  const was = findByPath(audioPath);
  if (was) return { item: was, added: false };
  const dim = await require('./media-probe').probe(_abs(audioPath));
  if (!dim.audio) {
    try { fs.unlinkSync(_abs(audioPath)); } catch (e) { /* gone */ }
    throw new Error('it has no sound in it');
  }

  // ── From here to the write: one tick. ──
  if (typeof o.wanted === 'function' && !o.wanted()) {
    try { fs.unlinkSync(_abs(audioPath)); } catch (e) { /* gone */ }
    return { item: null, added: false, dropped: true };
  }
  const LC = require('./library-cats');
  let cat = { id: '', label: '' };
  if (o.categoryId && LC.find && LC.find(KIND, String(o.categoryId))) cat = LC.find(KIND, String(o.categoryId));
  else if (o.categoryLabel) {
    try { cat = LC.add(KIND, String(o.categoryLabel)).cat || cat; }
    catch (e) { console.warn('[sounds] category', o.categoryLabel, 'failed:', e.message); }
  }
  try {
    audioPath = require('./shelf-files').placeNew(audioPath, KIND, cat.id, cat.label);
  } catch (e) {
    console.warn('[sounds] could not place ' + audioPath + ' in ' + (cat.label || 'nocat') + ':', e.message);
  }
  const rec = {
    id: _newId(),
    name: String(o.name || '').trim().slice(0, 120) || String(audioPath).split('/').pop(),
    audioPath,
    duration: dim.duration ? Math.round(dim.duration * 100) / 100 : 0,
    categoryId: String(cat.id || ''),
    categoryLabel: String(cat.label || ''),
    favorite: false,
    date: new Date().toISOString(),
    source: String(o.source || 'upload').slice(0, 20),
  };
  if (o.meta && typeof o.meta === 'object') rec.meta = o.meta;
  if (o.inAudio && !rec.categoryId) rec.inAudio = true;
  const now = read();
  const dup = now.find(e => e && _key(e.audioPath) === _key(audioPath));
  if (dup) return { item: dup, added: false };
  now.unshift(rec);
  write(now);
  return { item: rec, added: true };
}

module.exports = { FILE, KIND, read, write, get, findByPath, add };
