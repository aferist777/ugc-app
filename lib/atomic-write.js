'use strict';

/* atomic-write.js - replacing a file so that it is always either the old version or the new one.

   writeFileSync truncates the file first and fills it second. Stop the process between the two -
   a crash, a closed lid, power, a removable drive pulled out - and the store is empty or half
   written, which every reader then takes to mean "nothing there". Written to a temporary file
   beside it and renamed over it, the store is one whole version or the other: the rename changes
   a single directory entry.

   fsync before the rename, or the rename can reach the disk before the bytes it points at.

   On Windows a rename onto a file another process has open for a moment - an antivirus scan, the
   search indexer, a sync client - fails with EPERM, EACCES or EBUSY. That is retried a few times,
   briefly, and reported after that. */

const fs = require('fs');
const path = require('path');

const RETRY = new Set(['EPERM', 'EACCES', 'EBUSY']);
const _pause = new Int32Array(new SharedArrayBuffer(4));
const sleepSync = (ms) => { Atomics.wait(_pause, 0, 0, ms); };

let _seq = 0;

/** Replaces `file` with `data` (a string, written as UTF-8, or a Buffer). Synchronous. */
function writeFileAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8');
  const tmp = `${file}.${process.pid}.${++_seq}.tmp`;
  const fd = fs.openSync(tmp, 'w');
  try {
    for (let off = 0; off < buf.length;) off += fs.writeSync(fd, buf, off, buf.length - off);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  for (let attempt = 1; ; attempt++) {
    try {
      fs.renameSync(tmp, file);
      return;
    } catch (e) {
      if (attempt >= 5 || !RETRY.has(e.code)) {
        try { fs.unlinkSync(tmp); } catch (_) { /* the error below is the one worth reporting */ }
        throw e;
      }
      sleepSync(20 * attempt);
    }
  }
}

module.exports = { writeFileAtomic };
