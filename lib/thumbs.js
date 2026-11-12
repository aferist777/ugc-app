'use strict';

// Derivatives of images the pages actually display, at named sizes.
//
// One handler that makes them on demand and caches, rather than a hook in every path that writes
// an image. Two reasons. It cannot miss anything - a picture that reaches the screen has been
// asked for, so it gets made - which also means everything already in the stores is covered
// without a migration. And the sizes live in ONE table instead of at each call site.
//
// Sized for the screen, not for the wire. On the server each variant was a byte budget ("the
// frames gallery is 10 KB"), because every thumbnail crossed the internet. Here the file comes
// off the same disk, so a variant is twice the pixels its cell needs - sharp on a high-density
// screen - at quality 85, with no ceiling on the bytes.
//
// The cache is the library's cache/thumbs/ - derived files that regenerate on demand, so losing
// them costs one resize.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');

const { THUMBS_CACHE_DIR: CACHE } = require('./config');
const { toDiskExisting } = require('./media');

// px caps the long edge; q is the quality.
const VARIANTS = {
  // The 4K reference sheet as the view mode shows it - and the picture at the top of the Library's
  // right column, a third of a wide screen (js/library/info.js).
  sheet:  { px: 1920, q: 85 },
  // The looks strip and the frames gallery: small cells, many of them at once. The Library's tiles
  // of characters, looks, lookbooks and environments too (js/library/main.js, _tileSrc).
  strip:  { px: 440,  q: 85 },
  frame:  { px: 440,  q: 85 },
  // Preset examples in the create column.
  preset: { px: 1280, q: 85 },
  // The working portrait in New Character's window (js/library/chmake.js), and a still shown large
  // in a viewer (the chats', Merge's Library panel's).
  main:   { px: 2048, q: 85 },
  card:   { px: 640,  q: 85 },
  // The character rows in the dress popup. A SQUARE crop from the LEFT of a 16:9 sheet, so
  // only about a third of the width is ever seen - the long edge has to be generous relative
  // to the tile or the face lands soft.
  face:   { px: 960,  q: 85 },
};

// The bigger view of a still - the popups' centre image, the hover preview - written once beside
// its source, in a preview/ folder (routes/scen3.js says where). A source no bigger than this is
// its own preview.
const PREVIEW = { px: 2048, q: 85 };

// One cache folder per version of the table above. Change a size and the cache starts again in a
// new folder, and sweepOldSizes() clears the old ones, so a derivative of an earlier size is never
// served.
const GEN = crypto.createHash('sha1').update(JSON.stringify(VARIANTS)).digest('hex').slice(0, 8);
const DIR = path.join(CACHE, GEN);

// Only where images legitimately live: a src is a web path as the pages already use it, and
// lib/media.js is the same mapping the static mounts serve - not an invitation to name any file
// on the disk.
const IMG_RE = /\.(jpe?g|png|webp)$/i;

function resolveSrc(rel) {
  const clean = String(rel || '').split('?')[0];
  if (!IMG_RE.test(clean)) return null;
  // An address a page kept from before a file moved (another category, a renamed project) still finds
  // it: lib/moves.js knows where it went (review I4).
  const abs = toDiskExisting(clean.startsWith('/') ? clean : '/' + clean);
  if (abs && fs.existsSync(abs) && fs.statSync(abs).isFile()) return abs;
  return null;
}

function thumbPath(srcAbs, variant, ext) {
  // Keyed by the source path AND its mtime, so a regenerated image never serves its old
  // derivative and nothing has to be invalidated by hand. (lib/cache-carry.js renames these by
  // the same key, thumbPathAt, when lib/relocate.js moves their sources.)
  const st = fs.statSync(srcAbs);
  // The format is a property of the SOURCE (see _alpha), so it is not part of the key: one
  // source can only ever want one of the two, and the extension keeps them apart on disk.
  return thumbPathAt(srcAbs, st.mtimeMs, variant, ext);
}

// The same for a source by its path and time - one that has just moved, whose old path is gone (lib/cache-carry.js).
function thumbPathAt(srcAbs, mtimeMs, variant, ext) {
  const key = crypto.createHash('sha1')
    .update(srcAbs + '|' + mtimeMs + '|' + variant).digest('hex').slice(0, 20);
  return path.join(DIR, variant, key + (ext || '.jpg'));
}

// A cutout - a PNG with the background erased - is the one thing JPEG cannot carry. Written
// as a JPEG its transparency becomes solid black, which is exactly the picture you did NOT
// want, and it happens silently. So an image with an alpha channel gets WebP instead: it
// keeps the transparency at the same quality, and is smaller than JPEG anyway.
//
// hasAlpha and not stats().isOpaque: the first reads the header, the second decodes every
// pixel to find out whether the channel is actually used. A fully opaque PNG coming out as
// WebP costs nothing; decoding 4K on every thumbnail request would.
async function _alpha(srcAbs) {
  try { return !!(await sharp(srcAbs).metadata()).hasAlpha; }
  catch (e) { return false; }
}

async function ensureThumb(rel, variant) {
  const v = VARIANTS[variant];
  if (!v) throw new Error('unknown thumbnail variant: ' + variant);
  const srcAbs = resolveSrc(rel);
  if (!srcAbs) throw new Error('no such image: ' + rel);

  const alpha = await _alpha(srcAbs);
  const dest = thumbPath(srcAbs, variant, alpha ? '.webp' : '.jpg');
  if (fs.existsSync(dest)) return dest;
  fs.mkdirSync(path.dirname(dest), { recursive: true });

  const img = sharp(srcAbs).rotate().resize(v.px, v.px, { fit: 'inside', withoutEnlargement: true });
  const buf = await (alpha ? img.webp({ quality: v.q }) : img.jpeg({ quality: v.q })).toBuffer();
  fs.writeFileSync(dest, buf);
  return dest;
}

// Clears the cache folders of earlier size tables. In the background: a server-era cache can be
// thousands of files, and nothing waits for them to go.
function sweepOldSizes() {
  fs.readdir(CACHE, (err, names) => {
    if (err) return;
    for (const n of names) {
      if (n !== GEN) fs.rm(path.join(CACHE, n), { recursive: true, force: true }, () => {});
    }
  });
}

// Does this still need a preview, or is it small enough to be its own?
async function needsPreview(srcAbs) {
  const m = await sharp(srcAbs).metadata();
  return Math.max(m.width || 0, m.height || 0) > PREVIEW.px;
}

async function makePreview(srcAbs, outAbs) {
  fs.mkdirSync(path.dirname(outAbs), { recursive: true });
  const buf = await sharp(srcAbs)
    .resize(PREVIEW.px, PREVIEW.px, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: PREVIEW.q })
    .toBuffer();
  fs.writeFileSync(outAbs, buf);
}

module.exports = { VARIANTS, resolveSrc, thumbPath, thumbPathAt, ensureThumb, sweepOldSizes, needsPreview, makePreview };
