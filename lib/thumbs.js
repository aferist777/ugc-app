'use strict';

// Derivatives of images the pages actually display, at named sizes.
//
// One handler that makes them on demand and caches, rather than a hook in every path that writes
// an image. Two reasons. It cannot miss anything - a picture that reaches the screen has been
// asked for, so it gets made - which also means everything already in the stores is covered
// without a migration. And the sizes live in ONE table instead of at each call site, so "the
// frames gallery is 10 KB" is a fact with a single home.
//
// The budget is in kilobytes, not pixels, because that is what the pages are paying for: a
// 4096-wide sheet drawn into a 200px cell costs 640 KB to say almost nothing. Each variant caps
// the long edge and then steps quality down until the bytes fit.
//
// Cache lives under uploads/, which is gitignored - these are derived files and regenerate on
// demand, so losing them costs one resize.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');

const ROOT = path.join(__dirname, '..');
const CACHE = path.join(ROOT, 'uploads', '_thumbs');

// px caps the long edge; kb is the byte budget (0 = no byte budget, quality fixed).
const VARIANTS = {
  // The 4K reference sheet as the view mode shows it. A little under 1K, which is all a column
  // that wide can resolve.
  sheet:  { px: 960,  kb: 0,   q: 82 },
  // The looks strip and the frames gallery: small cells, many of them at once.
  strip:  { px: 220,  kb: 10,  q: 72 },
  frame:  { px: 220,  kb: 10,  q: 72 },
  // Preset examples in the create column.
  preset: { px: 640,  kb: 30,  q: 78 },
  // The working portrait in the middle, and the same face in the model column beside it.
  main:   { px: 1024, kb: 100, q: 82 },
  card:   { px: 320,  kb: 20,  q: 76 },
};

// Only inside the project, and only where images legitimately live. A src is a web path as the
// pages already use it, so this is the same mapping express.static does - not an invitation to
// name any file on the disk.
const ROOTS = ['uploads', 'obrazy', 'characters', 'environments', 'lookbooks',
               'details', 'refs', 'archive', 'scenes', 'temp_public', 'public'];
const IMG_RE = /\.(jpe?g|png|webp)$/i;

function resolveSrc(rel) {
  const clean = String(rel || '').split('?')[0].replace(/^\/+/, '');
  if (!clean || !IMG_RE.test(clean)) return null;
  const first = clean.split('/')[0];
  // /presets/x.jpg is served out of public/, so it arrives without that prefix.
  const candidates = ROOTS.includes(first) ? [clean] : ['public/' + clean];
  for (const c of candidates) {
    const abs = path.resolve(ROOT, c);
    if (!abs.startsWith(ROOT + path.sep)) continue;     // no climbing out with ..
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return abs;
  }
  return null;
}

function thumbPath(srcAbs, variant) {
  // Keyed by the source path AND its mtime, so a regenerated image never serves its old
  // derivative and nothing has to be invalidated by hand.
  const st = fs.statSync(srcAbs);
  const key = crypto.createHash('sha1')
    .update(srcAbs + '|' + st.mtimeMs + '|' + variant).digest('hex').slice(0, 20);
  return path.join(CACHE, variant, key + '.jpg');
}

async function ensureThumb(rel, variant) {
  const v = VARIANTS[variant];
  if (!v) throw new Error('unknown thumbnail variant: ' + variant);
  const srcAbs = resolveSrc(rel);
  if (!srcAbs) throw new Error('no such image: ' + rel);

  const dest = thumbPath(srcAbs, variant);
  if (fs.existsSync(dest)) return dest;
  fs.mkdirSync(path.dirname(dest), { recursive: true });

  const base = sharp(srcAbs).rotate().resize(v.px, v.px, { fit: 'inside', withoutEnlargement: true });
  let q = v.q, buf = await base.clone().jpeg({ quality: q }).toBuffer();
  if (v.kb) {
    // Step down, then accept whatever the floor gives: a slightly heavy thumbnail beats no
    // thumbnail, and 30 is where the artefacts start to cost more than the bytes save.
    while (buf.length > v.kb * 1024 && q > 30) {
      q -= 8;
      buf = await base.clone().jpeg({ quality: q }).toBuffer();
    }
  }
  fs.writeFileSync(dest, buf);
  return dest;
}

module.exports = { VARIANTS, resolveSrc, thumbPath, ensureThumb, CACHE };
