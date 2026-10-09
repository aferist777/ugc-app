'use strict';

// ════════════════════════════════════════════════════════════════════════════
// A PICTURE BROUGHT IN, MADE SENDABLE (phase V24, the owner 2026-10-09: every picture brought in is
// to be turned into a format that works).
//
// The aggregators take three formats for a picture and no others - kie.ai's nano-banana-2 and its
// lite say so: image/jpeg, image/png, image/webp - and a file of any other kind fails AFTER the
// press, in words like "File type not supported" (a lookbook made from an AVIF did, 2026-10-09).
// So every door a picture comes in by passes it through here first:
//
//   JPEG, PNG, WebP   kept as they are - a PNG with its background erased keeps its transparency
//   anything else     sharp can read - AVIF (which sharp calls HEIF with AV1), GIF (its first
//                     frame), TIFF, SVG... - becomes a JPEG, turned the way its EXIF says
//   a phone's HEIC    HEIF with HEVC inside, which the shipped sharp cannot decode: said in words
//                     (phase V24.2b brings a decoder)
//
// What is answered is the bytes to send, their extension and type, and whether they were made anew.
// ════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const KEEP = { jpeg: 'jpg', png: 'png', webp: 'webp' };
const TYPE = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
const HEIC_WORDS = 'a HEIC photo from a phone cannot be read here yet - save it as JPEG first';

const _bad = (msg) => Object.assign(new Error(msg), { status: 400 });

/**
 * @param {Buffer} buf  a picture's bytes
 * @returns {Promise<{ buf: Buffer, ext: string, type: string, converted: boolean, from: string }>}
 * Throws in words (status 400) when the bytes are not a picture it can read.
 */
async function sendable(buf) {
  if (!buf || !buf.length) throw _bad('the picture is empty');
  let meta = null;
  try { meta = await sharp(buf).metadata(); } catch (e) { meta = null; }
  const fmt = (meta && meta.format) || '';
  if (!fmt) throw _bad('that file is not a picture');
  if (KEEP[fmt]) return { buf, ext: KEEP[fmt], type: TYPE[KEEP[fmt]], converted: false, from: fmt };
  const hevc = fmt === 'heif' && String(meta.compression || '').toLowerCase() === 'hevc';
  const from = hevc ? 'heic' : (fmt === 'heif' ? 'avif' : fmt);
  if (hevc) throw _bad(HEIC_WORDS);
  try {
    const out = await sharp(buf).rotate().jpeg({ quality: 92 }).toBuffer();
    return { buf: out, ext: 'jpg', type: TYPE.jpg, converted: true, from };
  } catch (e) {
    throw _bad('that picture could not be read (' + from + ')');
  }
}

/**
 * A picture already written to disk (an upload), made sendable IN ITS FOLDER: one in another format is
 * written beside it as a JPEG and the original removed; one whose extension lies about its bytes (a PNG
 * named .jpg) gets the right name. Answers the file's path from now on. Throws in words like sendable().
 * The bytes are read into memory first, so nothing holds the file open while it is replaced (sharp's
 * cache is off, server.js, and a decoded Buffer keeps no handle).
 */
async function sendableFile(abs) {
  const pic = await sendable(fs.readFileSync(abs));
  const cur = path.extname(abs);
  const ok = cur.toLowerCase() === '.' + pic.ext || (pic.ext === 'jpg' && cur.toLowerCase() === '.jpeg');
  if (!pic.converted && ok) return abs;
  const next = abs.slice(0, abs.length - cur.length) + '.' + pic.ext;
  fs.writeFileSync(next, pic.buf);
  if (next !== abs) fs.rmSync(abs, { force: true });
  return next;
}

// The extensions a picture may arrive under - what a file picker or a drop may hand over before its
// bytes have been read (a phone's HEIC often arrives with no type at all).
const IN_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.avif', '.heic', '.heif', '.gif', '.tif', '.tiff', '.svg'];

module.exports = { sendable, sendableFile, IN_EXTS, KEEP, HEIC_WORDS };
