'use strict';

/* render-files.js - a render's file NAMED and RENAMED.

   nameFor(title, when, taken) -> the file's stem for a new render: "<project title> <YYYY-MM-DD HH-MM>" - the title the
     timeline had at the press, the time of the press (local) -, made a file name by lib/names.js; at most 60 characters
     (names.js's limit): the TITLE is cut, at a word when one ends near the limit, and the time always kept whole; " (2)",
     " (3)"... after the time when the name is taken in its folder (`taken`: the stems there). Its subtitles file is
     "<name>.en_US.srt" (lib/mv3b-job.js srtOf).
   rename(abs, name) -> { abs, url }: the render takes `name` in its own folder THROUGH lib/relocate.js - its .srt beside it,
     its poster and every store that names them follow (the queue's entry, a highlights fragment's record of its render);
     " (2)" when the name is taken. The rule of the viewer's Rename (routes/library.js).
   No page-side naming: what a person types is made safe here. */

const fs = require('fs');
const path = require('path');
const { folderName } = require('./names');
const { toUrl } = require('./media');

const MAX = 60;
const pad = (n) => String(n).padStart(2, '0');
const stampOf = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + '-' + pad(d.getMinutes());

// A name's head cut to `room` characters, at a word when one ends near the limit, a separator left dangling dropped.
function _cut(s, room) {
  if (s.length <= room) return s;
  let cut = s.slice(0, Math.max(0, room));
  const space = cut.lastIndexOf(' ');
  if (space > room - 16) cut = cut.slice(0, space);
  return cut.replace(/[\s\-_,;—–.·]+$/, '');
}

function nameFor(title, when, taken) {
  const d = when instanceof Date ? when : new Date(when || Date.now());
  const time = stampOf(isNaN(d.getTime()) ? new Date() : d);
  const head = folderName(String(title || '').trim(), 'render');
  const have = new Set([...(taken || [])].map((t) => String(t).toLowerCase()));
  for (let n = 1; ; n++) {
    const suffix = n === 1 ? '' : ` (${n})`;
    const room = MAX - time.length - 1 - suffix.length;
    const h = _cut(head, room) || 'render';
    const cand = h + ' ' + time + suffix;
    if (!have.has(cand.toLowerCase())) return cand;
  }
}

// What a person types as a render's name, safe as a file name.
const safeName = (s) => String(s || '').replace(/[\\\/:*?"<>|]/g, '-').replace(/[#?&%]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 100);

function rename(abs, name) {
  const JOB = require('./mv3b-job');
  const want = safeName(name);
  if (!want || want + '.mp4' === path.basename(abs)) return { abs, url: toUrl(abs) };
  const dir = path.dirname(abs);
  let target = path.join(dir, want + '.mp4');
  for (let n = 2; fs.existsSync(target); n++) target = path.join(dir, `${want} (${n}).mp4`);
  const from = toUrl(abs);
  const nextUrl = toUrl(target);
  const files = [[from, nextUrl]];
  const s = JOB.srtOf(abs);
  if (fs.existsSync(s)) files.push([toUrl(s), toUrl(JOB.srtOf(target))]);
  require('./relocate').relocate({ files });
  return { abs: target, url: nextUrl };
}

module.exports = { nameFor, rename };
