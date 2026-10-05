'use strict';

// ════════════════════════════════════════════════════════════════════════════
// THE B-ROLL AND UPLOADS SHELVES, written by the server (phase V2, docs/local-app/PLAN.md "V-A").
//
// data/biroly.json ({ archive: [...] }) holds both shelves - an upload is a record with source 'upload' -
// and until V2 only the Library's routes wrote it (routes/library.js POST /library/media/record and the
// mutations), each in one request. The video chat files what it makes from the server, behind a page that
// may be gone, so the filing lives here:
//
//   add(videoPath, opts) -> { item, added }
//
// It is PLACED first, the way lib/images-store.js add() does it: a clip arrives in media/work/ and moves to
// media/<kind>/<category folder>/ (nocat for none) before its record is written, so the record never points
// anywhere else (lib/shelf-files.js placeNew - nothing points at it yet, so a plain move with its siblings).
// Its poster is made beside it in thumbs/ (lib/video-thumb.js), so a later rename of the category carries
// it; its length, frame size and sound are measured (lib/media-probe.js) - the shelf reads `duration`, and
// until now only a trim wrote it.
//
// READ AGAIN, AND WRITE IN THE SAME TICK: the placing, the poster and the probe take seconds, and two clips
// landing together would otherwise each write the list they read before the other - one record lost, its
// file left on the shelf with nothing pointing at it.
// ════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const { writeFileAtomic } = require('./atomic-write');
const { DATA_DIR, ROOT_DIR } = require('./config');

const FILE = path.join(DATA_DIR, 'biroly.json');

function _readStore() {
  try {
    const s = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return (s && typeof s === 'object' && !Array.isArray(s)) ? s : {};
  } catch (e) { return {}; }
}

/** Every record of both shelves, newest first. */
function read() {
  const s = _readStore();
  return Array.isArray(s.archive) ? s.archive : [];
}

// The other top-level keys of the file stay as they are.
function write(list) {
  const s = _readStore();
  s.archive = list;
  writeFileAtomic(FILE, JSON.stringify(s, null, 2));
}

const _newId = () => 'lib' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const _key = (p) => String(p || '').split('?')[0];

/** One record by id or by its clip's address. */
const get = (id) => read().find(e => e && e.id === String(id || '')) || null;
const findByPath = (p) => read().find(e => e && _key(e.videoPath) === _key(p)) || null;

/**
 * File a clip on the B-roll shelf (`kind: 'birols'`, the default) or Uploads (`kind: 'uploads'`).
 * opts: { kind, name, categoryLabel, prompt, refImage, meta, thumbPath }
 * A clip already on a shelf is answered with its record (`added: false`), never filed twice.
 */
async function add(videoPath, opts) {
  const o = opts || {};
  const kind = o.kind === 'uploads' ? 'uploads' : 'birols';
  const was = findByPath(videoPath);
  if (was) return { item: was, added: false };

  // FILED UNDER A NAME, not an id: the category is the project's title, and LC.add is idempotent by label
  // (case-insensitive) - asking for it every time is the same as asking whether it exists.
  let cat = { id: '', label: '' };
  if (o.categoryLabel) {
    try { cat = require('./library-cats').add(kind, String(o.categoryLabel)).cat || cat; }
    catch (e) { console.warn('[birols] category', o.categoryLabel, 'failed:', e.message); }
  }
  try {
    videoPath = require('./shelf-files').placeNew(videoPath, kind, cat.id, cat.label);
  } catch (e) {
    console.warn('[birols] could not place ' + videoPath + ' in ' + (cat.label || 'nocat') + ':', e.message);
  }

  // The poster beside the clip (thumbs/<stem>_thumb.jpg) - one handed in is kept only if it is on disk.
  let thumbPath = null;
  const given = o.thumbPath ? path.join(ROOT_DIR, _key(o.thumbPath).replace(/^\/+/, '')) : '';
  if (given && fs.existsSync(given)) thumbPath = _key(o.thumbPath);
  else {
    try { thumbPath = (await require('./video-thumb').makeThumb(videoPath)).thumb; }
    catch (e) { console.warn('[birols] no poster for', videoPath, '-', e.message); }
  }
  const abs = path.join(ROOT_DIR, _key(videoPath).replace(/^\/+/, ''));
  const dim = await require('./media-probe').probe(abs);

  const rec = {
    id: _newId(),
    name: String(o.name || '').trim().slice(0, 120) || String(videoPath).split('/').pop(),
    prompt: String(o.prompt || '').slice(0, 2000),
    videoPath,
    thumbPath,
    imagePath: thumbPath,
    date: new Date().toISOString(),
    categoryId: String(cat.id || ''),
    categoryLabel: String(cat.label || ''),
    status: 'done',
    duration: dim.duration ? Math.round(dim.duration * 100) / 100 : 0,
    w: dim.w || 0, h: dim.h || 0, audio: !!dim.audio,
  };
  if (kind === 'uploads') rec.source = 'upload';
  if (o.refImage) {
    const r = path.join(ROOT_DIR, _key(o.refImage).replace(/^\/+/, ''));
    if (fs.existsSync(r)) rec.refImage = _key(o.refImage);
  }
  if (o.meta && typeof o.meta === 'object') rec.meta = o.meta;

  const now = read();
  const dup = now.find(e => e && _key(e.videoPath) === _key(videoPath));
  if (dup) return { item: dup, added: false };
  now.unshift(rec);
  write(now);
  // On the shelf means it can land on a lane: its preview proxy is queued now.
  try { require('../routes/proxies').warmProxies([videoPath], 480); } catch (e) { /* warmed on first sight */ }
  return { item: rec, added: true };
}

module.exports = { FILE, read, write, get, findByPath, add };
