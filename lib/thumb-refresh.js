'use strict';

// ════════════════════════════════════════════════════════════════════════════
// OLD THUMBNAILS MADE AGAIN AT TODAY'S SIZE - in the background, one at a time.
//
// The thumbnails a library already holds were cut on the server, for bytes: 300px images under
// 35 KB, 160px posters, previews of 1024px under 220 KB. The stores point at those files by
// name, so a new size in code only reaches the ones made from then on. This pass makes the small
// ones again from their sources, in place:
//   <folder>/thumbs/<name>.jpg         beside an image   lib/helpers.js createThumbnail
//   <folder>/thumbs/<name>_thumb.jpg   beside a video    lib/video-thumb.js makeThumb's poster
//   <folder>/thumbs/<name>.jpg         beside a clip     the Scenarios clip poster
//   <folder>/preview/<name>.jpg        beside an image   lib/thumbs.js makePreview
// "Small" is read off the file: a thumbnail under today's size whose source could give more. One
// whose source is gone, or is no bigger than the thumbnail, is left as it is.
//
// cache/thumbs-refresh.json says the library has been through it, so a start after that costs
// nothing. An Import clears it (again()), since an archive can bring small ones back; a pass cut
// short by a quit simply runs again - what it already made is no longer small.
// ════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const { MEDIA_DIR, MEDIA, CACHE_DIR } = require('./config');
const { writeFileAtomic } = require('./atomic-write');
const { createThumbnail, THUMB_PX } = require('./helpers');
const { makePreview, PREVIEW } = require('./thumbs');
const VT = require('./video-thumb');

const GEN = 2;
const MARK = path.join(CACHE_DIR, 'thumbs-refresh.json');
const IMG = ['.jpg', '.jpeg', '.png', '.webp'];
const VID = ['.mp4', '.mov', '.webm', '.m4v', '.mkv'];

let _running = false;
let _dirty = false;       // an Import landed while a pass was running: go round again

const _longEdge = async (abs) => {
  try { const m = await sharp(abs).metadata(); return Math.max(m.width || 0, m.height || 0); }
  catch (e) { return 0; }
};

// Every thumbs/ and preview/ folder under media/.
function _folders(dir, depth, out) {
  let ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return out; }
  for (const e of ents) {
    if (!e.isDirectory()) continue;
    const p = path.join(dir, e.name);
    if (e.name === 'thumbs' || e.name === 'preview') out.push(p);
    else if (depth < 6) _folders(p, depth + 1, out);
  }
  return out;
}

// Where a long source video's poster frame is taken - the moment routes/sources.js picked.
function _sourceAt(videoAbs) {
  if (path.dirname(videoAbs) !== path.resolve(MEDIA.sources)) return 0.5;
  try {
    const S = require('./sources-store');
    const name = path.basename(videoAbs);
    const rec = S.list().find(r => r && r.videoPath && path.posix.basename(String(r.videoPath)) === name);
    return rec ? S.posterAt(rec.seconds) : 0.5;
  } catch (e) { return 0.5; }
}

// What to do for one file, or null when it is fine as it is.
async function _job(file, folderKind, siblings, parent) {
  const ext = path.extname(file).toLowerCase();
  if (!IMG.includes(ext) || /\.tmp\.jpg$/i.test(file)) return null;
  const base = file.slice(0, file.length - ext.length);
  const abs = path.join(parent, folderKind, file);
  const find = (b, exts) => {
    for (const x of exts) { const n = siblings.get((b + x).toLowerCase()); if (n) return path.join(parent, n); }
    return null;
  };

  if (folderKind === 'preview') {
    const src = find(base, IMG);
    if (!src) return null;
    const have = await _longEdge(abs);
    if (have >= PREVIEW.px || (await _longEdge(src)) <= have) return null;
    return () => makePreview(src, abs);
  }

  let src;
  if (/_thumb$/i.test(base) && (src = find(base.slice(0, -6), VID))) {
    const img = await VT.imageWidth(abs);
    if (img >= VT.THUMB_W) return null;
    return () => VT.posterFrame(src, abs, { at: _sourceAt(src) });
  }
  if ((src = find(base, IMG))) {
    const have = await _longEdge(abs);
    if (have >= THUMB_PX || (await _longEdge(src)) <= have) return null;
    return () => createThumbnail(src, abs);
  }
  if ((src = find(base, VID))) {
    const img = await VT.imageWidth(abs);
    if (img >= VT.CLIP_POSTER_W) return null;
    return () => VT.posterFrame(src, abs, { width: VT.CLIP_POSTER_W });
  }
  return null;
}

async function run() {
  if (_running) return;
  try { if (JSON.parse(fs.readFileSync(MARK, 'utf8')).gen >= GEN) return; } catch (e) { /* not yet */ }
  _running = true;
  _dirty = false;
  try {
    let made = 0, failed = 0, checked = 0;
    for (const folder of _folders(MEDIA_DIR, 0, [])) {
      const parent = path.dirname(folder);
      const kind = path.basename(folder);
      let files, names;
      try { files = fs.readdirSync(folder); names = fs.readdirSync(parent); } catch (e) { continue; }
      const siblings = new Map(names.map(n => [n.toLowerCase(), n]));
      for (const f of files) {
        checked++;
        let job = null;
        try { job = await _job(f, kind, siblings, parent); } catch (e) { job = null; }
        if (!job) continue;
        try {
          await job();
          if (++made % 250 === 0) console.log(`[thumbs] made again at today's size: ${made} so far`);
        } catch (e) { failed++; }
      }
    }
    if (!_dirty) writeFileAtomic(MARK, JSON.stringify({ gen: GEN, at: new Date().toISOString(), checked, made, failed }, null, 2));
    if (made || failed) console.log(`[thumbs] ${made} old thumbnails made again at today's size`
      + (failed ? `, ${failed} could not be` : '') + ` (${checked} checked)`);
  } finally {
    _running = false;
    if (_dirty) setImmediate(() => run().catch(e => console.warn('[thumbs] refresh failed:', e.message)));
  }
}

// After an Import: the archive may have brought small ones back.
function again() {
  try { fs.unlinkSync(MARK); } catch (e) { /* there was none */ }
  if (_running) { _dirty = true; return; }
  run().catch(e => console.warn('[thumbs] refresh failed:', e.message));
}

module.exports = { run, again };
