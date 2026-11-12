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
// The slow part first, where the clip arrived (media/work/): its poster beside it in thumbs/
// (lib/video-thumb.js), its length, frame size and sound measured (lib/media-probe.js) - the shelf reads
// `duration`, and until now only a trim wrote it. THEN, IN ONE TICK: the category asked for, the clip PLACED
// in media/<kind>/<category folder>/ (nocat for none) with its poster (lib/shelf-files.js placeNew - nothing
// points at it yet, so a plain move with its siblings), the list read again and the record written. So a
// category renamed or deleted while the poster was being made cannot leave the record on its old address
// (review V2r: placed first, the record was written with the address from before the move), and two clips
// landing together cannot each write the list they read before the other.
//
// `wanted()`, when given, is asked in that same tick: a clip let go of while its poster was made is removed,
// never filed.
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
 * opts: { kind, name, categoryId, categoryLabel, prompt, refImage, meta, thumbPath, wanted, link, linkKey }
 * (`categoryId` - a folder by its id, V57; else `categoryLabel` - one by its name, made when missing)
 * A clip already on a shelf is answered with its record (`added: false`), never filed twice. A clip no longer
 * `wanted()` is removed with its poster and answered `{ item: null, dropped: true }`.
 */
async function add(videoPath, opts) {
  const o = opts || {};
  const kind = o.kind === 'uploads' ? 'uploads' : 'birols';
  const was = findByPath(videoPath);
  if (was) return { item: was, added: false };
  const VTH = require('./video-thumb');
  const _abs = (u) => path.join(ROOT_DIR, _key(u).replace(/^\/+/, ''));

  // The poster beside the clip where it is now (thumbs/<stem>_thumb.jpg) - one handed in is kept only if it is
  // on disk - and the measuring. Seconds of ffmpeg, before anything is decided.
  let thumbPath = null;
  let made = false;
  if (o.thumbPath && fs.existsSync(_abs(o.thumbPath))) thumbPath = _key(o.thumbPath);
  else {
    try { thumbPath = (await VTH.makeThumb(videoPath)).thumb; made = true; }
    catch (e) { console.warn('[birols] no poster for', videoPath, '-', e.message); }
  }
  const dim = await require('./media-probe').probe(_abs(videoPath));

  // ── From here to the write: one tick. ──
  if (typeof o.wanted === 'function' && !o.wanted()) {
    for (const u of [videoPath, made ? thumbPath : '']) if (u) { try { fs.unlinkSync(_abs(u)); } catch (e) { /* gone */ } }
    return { item: null, added: false, dropped: true };
  }
  // FILED UNDER A NAME, not an id: the category is the project's title, and LC.add is idempotent by label
  // (case-insensitive) - asking for it every time is the same as asking whether it exists.
  let cat = { id: '', label: '' };
  // (phase V57) A folder asked for by its id - the one open in a chat's attachment window - when it is there.
  const byId = o.categoryId ? require('./library-cats').find(kind, String(o.categoryId)) : null;
  // (phase V60.2, the owner's (дг4а), (дг11а)) A B-roll lies in the folder of the model that made it (lib/model-folders.js):
  // the video chat's in its model's folder itself, a group asked for by name inside that folder, a folder of another
  // model's never - the clip goes into its own's then.
  const MF = kind === 'birols' ? require('./model-folders') : null;
  const model = MF ? MF.modelOf({ meta: o.meta, original: o.original }) : '';
  if (byId && (!MF || !MF.modelOfCat(null, byId.id) || MF.modelOfCat(null, byId.id) === model)) cat = byId;
  else if (o.categoryLabel) {
    try { cat = (MF ? MF.groupFor(model, String(o.categoryLabel)) : require('./library-cats').add(kind, String(o.categoryLabel)).cat) || cat; }
    catch (e) { console.warn('[birols] category', o.categoryLabel, 'failed:', e.message); }
  }
  if (MF && !cat.id) {
    try { cat = MF.folderFor(model); }
    catch (e) { console.warn('[birols] the folder of ' + model + ' failed:', e.message); }
  }
  try {
    videoPath = require('./shelf-files').placeNew(videoPath, kind, cat.id, cat.label);
  } catch (e) {
    console.warn('[birols] could not place ' + videoPath + ' in ' + (cat.label || 'nocat') + ':', e.message);
  }
  // The poster made beside it went with it (placeNew carries thumbs/<stem>_thumb.jpg); one left behind is none.
  if (made) {
    const moved = VTH.thumbUrlFor(videoPath);
    thumbPath = moved && fs.existsSync(_abs(moved)) ? moved : (fs.existsSync(_abs(thumbPath)) ? thumbPath : null);
  }

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
  // (phase V27) Brought in by a link: the link and what it is known by (lib/ytdlp.js info().key).
  if (o.link) rec.link = String(o.link).slice(0, 2000);
  if (o.linkKey) rec.linkKey = String(o.linkKey).slice(0, 200);

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
