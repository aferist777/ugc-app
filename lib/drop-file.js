'use strict';

/* drop-file.js - a file let go on Merge's timeline from Explorer (phase V41, the owner's (о13) and (о13а), 2026-10-24: "файлы
   дублируются в библиотеку в корневые папки дерева"; "видео в VIDEO → Uploads без категории, картинка в корень IMAGES, звук в
   корень AUDIO → Music, повторно тот же файл не копируется").

   It arrives in media/work/ (POST /api/mv3/drop-file, routes/mergev3.js) and is filed the way the shelves bring a file in: a
   video onto Uploads with no category (routes/library.js fileRecord - its thumbnail, its preview proxy), a picture into IMAGES'
   root (lib/image-in.js first - a phone's HEIC becomes a JPEG - then lib/images-store.js add), a sound into Music's root
   (lib/music-store.js add). The page then lays it on the timeline as it lays a tile from the Library (timeline-b.js).

   NEVER COPIED TWICE: the file's PRINT - its size and a hash of its first and last megabyte - is kept with the record it
   became, in cache/dropped-files.json (a cache: lost, a file is at worst copied once more). Dropped again while that record is
   on its shelf and its file on the disk, the record is the answer and the new copy is deleted. Before sending a file the page
   asks by its name, size and time (`known`), so a big video dropped again is not even sent.
*/

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { CACHE_DIR, DATA_DIR } = require('./config');
const { toDiskExisting } = require('./media');
const { writeFileAtomic } = require('./atomic-write');

const FILE = path.join(CACHE_DIR, 'dropped-files.json');
const VIDEO_EXTS = ['.mp4', '.webm', '.mov', '.m4v', '.avi', '.mkv'];
const AUDIO_EXTS = ['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.oga', '.flac', '.opus'];
const EDGE = 1024 * 1024;      // bytes of each end the print reads
const MAX_SEEN = 2000;         // name|size|time entries kept

/** 'video' | 'image' | 'audio' | '' - by the file's extension first, its type when the extension says nothing. */
function kindOf(name, mime) {
  const ext = path.extname(String(name || '')).toLowerCase();
  if (VIDEO_EXTS.includes(ext)) return 'video';
  if (AUDIO_EXTS.includes(ext)) return 'audio';
  if (require('./image-in').IN_EXTS.includes(ext)) return 'image';
  const m = String(mime || '');
  if (/^video\//.test(m)) return 'video';
  if (/^audio\//.test(m)) return 'audio';
  if (/^image\//.test(m)) return 'image';
  return '';
}

function _read() {
  try {
    const c = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    if (c && c.v === 1 && c.files && c.seen) return c;
  } catch (e) { /* none yet, or broken: begun again */ }
  return { v: 1, files: {}, seen: {} };
}

function _write(c) {
  const keys = Object.keys(c.seen);
  if (keys.length > MAX_SEEN) for (const k of keys.slice(0, keys.length - MAX_SEEN)) delete c.seen[k];
  try { fs.mkdirSync(CACHE_DIR, { recursive: true }); writeFileAtomic(FILE, JSON.stringify(c)); }
  catch (e) { console.warn('[drop-file] the prints were not written:', e.message); }
}

const _seenKey = (o) => [String(o.name || '').toLowerCase(), +o.size || 0, +o.lastModified || 0].join('|');

// Its size and a hash of its two ends - enough to know a film again, in a moment whatever its size.
async function _print(abs) {
  const st = fs.statSync(abs);
  const h = crypto.createHash('sha1');
  const fd = await fs.promises.open(abs, 'r');
  try {
    const n = Math.min(EDGE, st.size);
    const a = Buffer.alloc(n);
    await fd.read(a, 0, n, 0);
    h.update(a);
    if (st.size > EDGE) {
      const m = Math.min(EDGE, st.size - EDGE);
      const b = Buffer.alloc(m);
      await fd.read(b, 0, m, st.size - m);
      h.update(b);
    }
  } finally { await fd.close(); }
  return h.digest('hex') + '-' + st.size;
}

const _onDisk = (url) => { const abs = url ? toDiskExisting(url) : null; return !!(abs && fs.existsSync(abs)); };

// What the timeline lays, from the record a file became - the same fields a tile of the Library carries (merge-v3/library.js).
function _item(kind, rec) {
  if (kind === 'video') {
    return { src: rec.videoPath, thumb: rec.thumbPath || null, name: rec.name || '', dur: +rec.duration || 0, libId: rec.id,
      media: 'video', group: 'uploads', bed: false };
  }
  if (kind === 'image') {
    return { src: rec.imagePath, thumb: '/api/thumb?src=' + encodeURIComponent(rec.imagePath) + '&v=card', name: rec.name || '',
      dur: 0, libId: rec.id, media: 'image', group: 'images', bed: false };
  }
  // A track of Music lies as one dragged from Music does: a bed under the voices (timeline-b.js _drop).
  return { src: rec.audioPath, thumb: null, name: rec.title || '', dur: +rec.duration || 0, libId: rec.id,
    media: 'audio', group: 'music', bed: true };
}

// The record a print was filed as - still on its shelf, its file still there - or null.
function _find(hit) {
  if (!hit || !hit.id) return null;
  let rec = null;
  try {
    if (hit.kind === 'video') {
      const s = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'biroly.json'), 'utf8'));
      rec = (Array.isArray(s && s.archive) ? s.archive : []).find(e => e && e.id === hit.id) || null;
      if (rec && !_onDisk(rec.videoPath)) rec = null;
    } else if (hit.kind === 'image') {
      rec = require('./images-store').read().find(e => e && e.id === hit.id) || null;
      if (rec && !_onDisk(rec.imagePath)) rec = null;
    } else if (hit.kind === 'audio') {
      rec = require('./music-store').read().find(e => e && e.id === hit.id) || null;
      if (rec && !_onDisk(rec.audioPath)) rec = null;
    }
  } catch (e) { rec = null; }
  return rec ? _item(hit.kind, rec) : null;
}

/** A file the page is about to send ({ name, size, lastModified }), already in the library: its item, or null. */
function known(o) {
  const c = _read();
  const print = c.seen[_seenKey(o || {})];
  return print ? _find(c.files[print]) : null;
}

const _clean = (name) => String(name || '').replace(/\.[^.]+$/, '').replace(/[^\wа-яА-ЯёЁ\- .()]/g, '').trim().slice(0, 120);

/**
 * The file that arrived in media/work/ (`workAbs`), filed into the library - or, when the same file is there already, that
 * one, and the new copy deleted. `o`: { name (as it was on the computer), size, lastModified, mime }.
 * @returns { item, copied } - `item` what a lane lays (_item). Throws with `status`.
 */
async function take(workAbs, o) {
  const opts = o || {};
  const kind = kindOf(opts.name, opts.mime);
  const drop = () => { try { fs.unlinkSync(workAbs); } catch (e) { /* gone or moved */ } };
  if (!kind) { drop(); const e = new Error('not a video, a picture or a sound'); e.status = 415; throw e; }
  const print = await _print(workAbs);
  const was = _find(_read().files[print]);
  if (was) {
    drop();
    const c = _read();
    c.seen[_seenKey(opts)] = print;
    _write(c);
    return { item: was, copied: false };
  }
  const workUrl = '/media/work/' + path.basename(workAbs);
  const name = _clean(opts.name) || path.basename(workAbs).replace(/\.[^.]+$/, '');
  let rec;
  if (kind === 'video') {
    let dim = {};
    try { dim = await require('./media-probe').probe(workAbs); } catch (e) { dim = {}; }
    let thumbPath = null;
    try { thumbPath = (await require('./video-thumb').makeThumb(workUrl)).thumb; }
    catch (e) { console.warn('[drop-file] the thumbnail was not made:', e.message); }
    rec = require('../routes/library').fileRecord({
      videoPath: workUrl, thumbPath, name, kind: 'uploads', trimmable: true,
      duration: +dim.duration || 0, w: +dim.w || 0, h: +dim.h || 0,
    }).item;
  } else if (kind === 'image') {
    let abs = workAbs;
    try { abs = await require('./image-in').sendableFile(workAbs); }
    catch (e) { drop(); e.status = e.status || 415; throw e; }
    const r = await require('./images-store').add('/media/work/' + path.basename(abs), { name, source: 'upload' });
    rec = r.item;
  } else {
    try { rec = await require('./music-store').add(workUrl, { name }); }
    catch (e) { drop(); e.status = 415; throw e; }
  }
  if (!rec) { const e = new Error('the file was not filed'); e.status = 500; throw e; }
  const c = _read();
  c.files[print] = { kind, id: rec.id };
  c.seen[_seenKey(opts)] = print;
  _write(c);
  return { item: _item(kind, rec), copied: true };
}

module.exports = { FILE, kindOf, known, take };
