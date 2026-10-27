'use strict';

/* preview-proxy.js - the Merge preview's small copy of a film: where it lives and how it is made.

   routes/proxies.js queues them, makes them and serves them. The address and the encoding are here, apart from the
   route, so that the highlights cut (lib/highlights-cut.js, phase V33.2 block 0 - the owner 2026-10-21: "сейчас можно
   смотреть без картинки только") can make a piece's copy in the SAME ffmpeg pass that cuts the piece: the fragment is
   ready with its copy, and the preview shows the picture the moment the tile is pressed instead of waiting in the
   one-at-a-time queue (3-58 s in the owner's log).

   A copy is keyed by the film's full path and modified time (a rename keeps the time - lib/library-upgrade.js repeats
   this formula to carry copies when files move). */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { TEMP_DIR } = require('./config');

const CACHE_DIR = path.join(TEMP_DIR, 'preview_proxies');
const HEIGHTS = [360, 480, 720];    // the preview's qualities, its shorter side
const DEFAULT_H = 480;              // the quality the preview opens on (public/js/merge-v3/preview-b.js)

function cachePath(absSrc, h, rev) {
  let mtime = 0;
  try { mtime = Math.floor(fs.statSync(absSrc).mtimeMs); } catch (e) { /* not there: a key nothing matches */ }
  return cachePathAt(absSrc, mtime, h, rev);
}

// The same for a film by its path and time - one that has just moved, whose old path is gone (lib/cache-carry.js).
function cachePathAt(absSrc, mtime, h, rev) {
  const key = crypto.createHash('md5').update(absSrc + '|' + Math.floor(mtime) + '|h' + h + (rev ? '|rev' : '')).digest('hex');
  return path.join(CACHE_DIR, key + '_' + h + (rev ? '_rev' : '') + '.mp4');
}

/**
 * What an ffmpeg output of a copy is, after its input and before its file: the SHORTER side scaled to h (portrait
 * 1080x1920 -> h wide, landscape -> h tall), low bitrate, faststart so it seeks while it streams. rev also turns
 * picture and sound backwards, so a reversed clip is a copy played forwards.
 */
function encodeArgs(h, rev) {
  const crf = h >= 720 ? '27' : '30';
  const ab = h >= 720 ? '96k' : '64k';
  const vf = (rev ? 'reverse,' : '') + "scale='if(gt(iw,ih),-2," + h + ")':'if(gt(iw,ih)," + h + ",-2)':flags=bilinear";
  return [
    '-vf', vf,
    ...(rev ? ['-af', 'areverse'] : []),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', crf, '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', ab, '-ar', '44100',
    '-movflags', '+faststart',
  ];
}

module.exports = { CACHE_DIR, HEIGHTS, DEFAULT_H, cachePath, cachePathAt, encodeArgs };
