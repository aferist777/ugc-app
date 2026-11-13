'use strict';

// IMAGES — the still pictures the library holds, and the store behind them.
//
// SERVER-OWNED, like every store of the app: everything that makes one - an upload, a
// screenshot of the preview, a generation - goes through the server, so the file on disk is
// the only copy.
//
// The record deliberately mirrors a media record field for field (id, name, thumbPath,
// categoryId, categoryLabel, favorite, date) so the shelf, the star, the category dropdown and
// the delete path all work on it unchanged. Only the media field differs: imagePath, because
// it is a picture.

const fs = require('fs');
const { writeFileAtomic } = require('./atomic-write');
const path = require('path');
const sharp = require('sharp');

const { DATA_DIR, ROOT_DIR } = require('./config');
const { ensureThumb } = require('./thumbs');
const { NOCAT } = require('./layout');

const FILE = path.join(DATA_DIR, 'images.json');

// What the shelf and the timeline paint in bulk. Warmed on the way in rather than left to the
// first viewer: an original can be a 4K screenshot or a generated sheet, and the first paint of
// a shelf full of them would otherwise be a row of stalls.
//
// `main` is not here on purpose - it is opened one picture at a time, so on demand is right.
const WARM = ['card', 'strip'];

function read() {
  try { const l = JSON.parse(fs.readFileSync(FILE, 'utf8')); return Array.isArray(l) ? l : []; }
  catch (e) { return []; }
}

function write(list) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  writeFileAtomic(FILE, JSON.stringify(list, null, 2));
}

const newId = () => 'img' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// Size, and whether the picture is a cutout. isOpaque and not metadata().hasAlpha: this runs
// ONCE per image rather than on every thumbnail request, so it can afford to look at the
// pixels, and the answer is worth having exactly - a PNG saved with an unused alpha channel is
// not a cutout, and treating it as one would put it on the frame as a floating layer when it
// is really a full background.
async function probe(abs) {
  const out = { w: 0, h: 0, alpha: false };
  try {
    const md = await sharp(abs).metadata();
    // As it is SEEN: a phone photo's pixels are often stored on their side with a tag saying which
    // way is up, and the thumbnails turn it - so the shape a tile is given turns too.
    const turned = (md.orientation || 1) >= 5;
    out.w = (turned ? md.height : md.width) || 0;
    out.h = (turned ? md.width : md.height) || 0;
    if (md.hasAlpha) {
      try { out.alpha = !(await sharp(abs).stats()).isOpaque; } catch (e) { out.alpha = true; }
    }
  } catch (e) {}
  return out;
}

// Put a picture that is already on disk onto the shelf.
//
// It is PLACED first: a picture arrives in media/work/ (an upload, a screenshot, a generation) and
// moves to media/images/<category folder>/ - nocat for none - before its record is written, so the
// record never points anywhere else (lib/shelf-files.js). Nothing points at the new file yet, so
// that is a plain move.
//
// The thumbnails are made HERE, on every path in - upload, screenshot, generation - so no
// caller has to remember to. A failure to make one is not a failure to file the record: the
// picture is on disk and /api/thumb will make it on first sight anyway.
async function add(imagePath, opts) {
  const o = opts || {};
  const list = read();
  if (list.some(e => e && e.imagePath === imagePath)) {
    return { item: list.find(e => e.imagePath === imagePath), added: false };
  }
  try {
    imagePath = require('./shelf-files').placeNew(imagePath, 'images', String(o.categoryId || ''), String(o.categoryLabel || ''));
  } catch (e) {
    console.warn('[images] could not place ' + imagePath + ' in ' + (o.categoryLabel || NOCAT) + ':', e.message);
  }

  const abs = path.join(ROOT_DIR, String(imagePath).replace(/^\/+/, ''));
  const dim = await probe(abs);

  const rec = {
    id: newId(),
    name: String(o.name || '').trim().slice(0, 120) || String(imagePath).split('/').pop(),
    imagePath,
    thumbPath: null,          // the shelf points at /api/thumb; kept for the media record shape
    w: dim.w, h: dim.h,
    // Read when the picture is laid on a frame: a cutout defaults to a floating layer over the frame, a solid picture
    // fills it. Storing the answer means the inspector does not have to re-measure.
    alpha: dim.alpha,
    categoryId: String(o.categoryId || ''),
    categoryLabel: String(o.categoryLabel || ''),
    favorite: false,
    date: new Date().toISOString(),
    source: String(o.source || 'upload'),      // upload | screenshot | gen
    meta: o.meta || null,                      // what made it - a prompt, a project, a clip
  };

  for (const v of WARM) {
    try { await ensureThumb(imagePath, v); }
    catch (e) { console.warn('[images] thumb ' + v + ' failed for ' + imagePath + ':', e.message); }
  }

  // READ AGAIN, AND WRITE IN THE SAME TICK: the probe and the thumbnails above take seconds,
  // and two pictures arriving together - two photos dropped into a chat, a photo and a Merge picture
  // landing - would each write the list it had read before them, so one record would be lost and its
  // file left on the shelf with nothing pointing at it.
  const now = read();
  const was = now.find(e => e && e.imagePath === imagePath);
  if (was) return { item: was, added: false };
  // Let go of while it was being filed (`wanted` - a generation's cross pressed during the seconds above):
  // nothing is written, and the file it brought goes with its copy in thumbs/.
  if (typeof o.wanted === 'function' && !o.wanted()) {
    for (const p of [abs, path.join(path.dirname(abs), 'thumbs', path.basename(abs))]) {
      try { fs.unlinkSync(p); } catch (e) { /* not there */ }
    }
    return { item: null, added: false, unwanted: true };
  }
  now.unshift(rec);
  write(now);
  return { item: rec, added: true };
}

module.exports = { FILE, WARM, read, write, add, probe, newId };
