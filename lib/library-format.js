'use strict';

// ════════════════════════════════════════════════════════════════════════════
// THE LIBRARY'S DATA FORMAT, AND A SNAPSHOT OF ITS STORES BEFORE A NEW PROGRAM (phase V83, block B0; the owner
// 2026-11-09: (о10) "да", (о13) "да").
//
// Friends get new versions through Cloudflare, and a version may change how the stores are written. An OLDER program
// must then not open the library: it would read what it does not understand and write it back wrong. So:
//   FORMAT       - the data format this program writes. A start step that rewrites stores in a way an older program
//                  would misread (lib/library-upgrade.js and the steps it calls) RAISES IT, in the same change.
//   check(root)  - data/library.json says `format` above ours, or a `layout` above lib/layout.js's: the library is
//                  refused - in words, before anything reads a store (server.js exits with EXIT_REFUSED, the desktop
//                  shell says so in a window and does not start the server).
//   snapshot()   - before the first start of another program version (or a higher format) every JSON of the library -
//                  data/ and projects/, not settings.json or telegram.json (keys stay out of copies) - goes into ONE zip,
//                  backups/<day> before <version>.zip, the last five kept. Written here, synchronously, before the start
//                  steps run: a start step that went wrong can be undone from it by hand.
//   stamp()      - after the start steps: `format` (only ever raised), `formatSince`, `program: { version, commit, at }`.
// A copy run from git keeps package.json's version from release to release, so the owner's library gets one snapshot
// per release, not one per commit.
//
// No lib/config.js here, on purpose (as lib/library-upgrade.js): the shell checks before the library is settled.
// ════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { writeFileAtomic } = require('./atomic-write');
const { LAYOUT } = require('./layout');

const FORMAT = 1;
const EXIT_REFUSED = 3;
const MARKER = path.join('data', 'library.json');
const KEEP = 5;
const SNAP = /^\d{4}-\d{2}-\d{2} before .+\.zip$/;
const SECRET = new Set(['settings.json', 'telegram.json']);

// A byte-order mark (Notepad, PowerShell's Set-Content) is not a broken file: read past it, or a library written by a
// newer program would read as one with no mark at all - and open.
const _json = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8').replace(/^﻿/, '')); } catch (e) { return null; } };
const _mark = (root) => _json(path.join(root, MARKER));

/** null when the library may be opened; else { why, message } - message in the person's words. */
function check(root, program = { version: '' }) {
  const mark = _mark(root);
  if (!mark) return null;
  const format = Number(mark.format) || 0;
  const layout = Number(mark.layout) || 0;
  const by = mark.program && mark.program.version ? `UGC Studio ${mark.program.version}` : 'a newer UGC Studio';
  const mine = program.version ? `UGC Studio ${program.version}` : 'This UGC Studio';
  const tail = `\n\nUpdate UGC Studio and open it again. Nothing in the library was changed.\n\nThe library: ${root}`;
  if (format > FORMAT) {
    return {
      why: 'format', format,
      message: `This library was last opened by ${by}, which keeps its data in format ${format}. `
        + `${mine} reads format ${FORMAT} at most, so it does not open the library: it could spoil what the newer one wrote.${tail}`,
    };
  }
  if (layout > LAYOUT) {
    return {
      why: 'layout', layout,
      message: `This library is laid out in folders the way ${by} does it (layout ${layout}). `
        + `${mine} knows layout ${LAYOUT} at most, so it does not open the library.${tail}`,
    };
  }
  return null;
}

function _jsonFiles(root, sub, out) {
  const base = path.join(root, sub);
  const walk = (dir, rel) => {
    let list;
    try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const d of list) {
      const r = rel ? `${rel}/${d.name}` : d.name;
      if (d.isDirectory()) { walk(path.join(dir, d.name), r); continue; }
      if (!d.isFile() || !d.name.toLowerCase().endsWith('.json')) continue;
      if (!rel && sub === 'data' && SECRET.has(d.name.toLowerCase())) continue;
      out.push({ name: `${sub}/${r}`, abs: path.join(dir, d.name) });
    }
  };
  walk(base, '');
  return out;
}

const _day = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * The stores as they are, into backups/<day> before <version>.zip - when the program differs from the one that
 * last opened the library, or its format is lower than ours. null when none was needed (or there is nothing to keep).
 */
function snapshot(root, program, { now = new Date(), keep = KEEP } = {}) {
  const mark = _mark(root);
  const was = mark && mark.program ? String(mark.program.version || '') : '';
  if (mark && was === String(program.version) && (Number(mark.format) || 0) >= FORMAT) return null;
  const files = _jsonFiles(root, 'projects', _jsonFiles(root, 'data', []));
  if (!files.length) return null;
  const t0 = Date.now();
  const dir = path.join(root, 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const ver = String(program.version || 'unknown').replace(/[^\w.+-]+/g, '_');
  let name = `${_day(now)} before ${ver}.zip`;
  for (let i = 2; fs.existsSync(path.join(dir, name)); i++) name = `${_day(now)} before ${ver} (${i}).zip`;
  const bytes = zipSync(path.join(dir, name), files);
  _prune(dir, keep);
  return { file: `backups/${name}`, files: files.length, bytes, ms: Date.now() - t0 };
}

// The last `keep` snapshots stay, by when they were written; other zips in backups/ are not ours and stay too.
function _prune(dir, keep) {
  let snaps = [];
  try { snaps = fs.readdirSync(dir).filter((n) => SNAP.test(n)); } catch (e) { return; }
  const when = (n) => { try { return fs.statSync(path.join(dir, n)).mtimeMs; } catch (e) { return 0; } };
  snaps.sort((a, b) => when(b) - when(a) || b.localeCompare(a));
  for (const n of snaps.slice(keep)) { try { fs.rmSync(path.join(dir, n), { force: true }); } catch (e) { /* held open: next time */ } }
}

/** After the start steps: the format (only ever raised) and the program that opened the library last. */
function stamp(root, program, { now = new Date() } = {}) {
  const abs = path.join(root, MARKER);
  const mark = _json(abs) || { layout: LAYOUT, since: now.toISOString() };
  const had = Number(mark.format) || 0;
  const next = {
    ...mark,
    format: Math.max(had, FORMAT),
    program: { version: String(program.version || ''), commit: String(program.commit || ''), at: now.toISOString() },
  };
  if (had < FORMAT || !mark.formatSince) next.formatSince = now.toISOString();
  writeFileAtomic(abs, JSON.stringify(next, null, 2));
  return next;
}

// ── A zip, written synchronously (the stores are read before anything else at start; no stream, no dependency) ──
// Deflate, names in UTF-8 (projects carry Russian names). At most 65 535 files and 4 GB - a library's JSON is
// tens of megabytes; past that it refuses rather than write a zip nothing opens.
const _crcTable = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
  return t;
})();
function _crc32(buf) {
  if (typeof zlib.crc32 === 'function') return zlib.crc32(buf) >>> 0;
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = _crcTable[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function _dos(d) {
  const y = Math.max(1980, d.getFullYear());
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((y - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

/** files: [{ name, abs }] -> a zip at `out` (written beside it first, then put in place). Answers its size. */
function zipSync(out, files) {
  if (files.length > 0xFFFF) throw new Error(`too many files for a snapshot (${files.length})`);
  const tmp = `${out}.${process.pid}.tmp`;
  const fd = fs.openSync(tmp, 'w');
  const central = [];
  let offset = 0;
  const put = (buf) => { for (let o = 0; o < buf.length;) o += fs.writeSync(fd, buf, o, buf.length - o); offset += buf.length; };
  try {
    for (const f of files) {
      const data = fs.readFileSync(f.abs);
      let mtime = new Date();
      try { mtime = fs.statSync(f.abs).mtime; } catch (e) { /* now */ }
      const crc = _crc32(data);
      const packed = zlib.deflateRawSync(data, { level: 6 });
      const store = packed.length >= data.length;
      const body = store ? data : packed;
      const name = Buffer.from(f.name, 'utf8');
      const { time, date } = _dos(mtime);
      if (offset + 30 + name.length + body.length > 0xFFFFFFFF) throw new Error('the stores are too large for a snapshot');
      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6);
      local.writeUInt16LE(store ? 0 : 8, 8); local.writeUInt16LE(time, 10); local.writeUInt16LE(date, 12);
      local.writeUInt32LE(crc, 14); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(data.length, 22);
      local.writeUInt16LE(name.length, 26); local.writeUInt16LE(0, 28);
      const at = offset;
      put(local); put(name); put(body);
      const c = Buffer.alloc(46);
      c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8);
      c.writeUInt16LE(store ? 0 : 8, 10); c.writeUInt16LE(time, 12); c.writeUInt16LE(date, 14);
      c.writeUInt32LE(crc, 16); c.writeUInt32LE(body.length, 20); c.writeUInt32LE(data.length, 24);
      c.writeUInt16LE(name.length, 28); c.writeUInt16LE(0, 30); c.writeUInt16LE(0, 32); c.writeUInt16LE(0, 34);
      c.writeUInt16LE(0, 36); c.writeUInt32LE(0, 38); c.writeUInt32LE(at, 42);
      central.push(c, name);
    }
    const cdAt = offset;
    for (const b of central) put(b);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(0, 4); end.writeUInt16LE(0, 6);
    end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
    end.writeUInt32LE(offset - cdAt, 12); end.writeUInt32LE(cdAt, 16); end.writeUInt16LE(0, 20);
    put(end);
    fs.fsyncSync(fd);
  } catch (e) {
    fs.closeSync(fd);
    try { fs.rmSync(tmp, { force: true }); } catch (e2) { /* left for the next start */ }
    throw e;
  }
  fs.closeSync(fd);
  fs.renameSync(tmp, out);
  return offset;
}

module.exports = { FORMAT, EXIT_REFUSED, KEEP, check, snapshot, stamp, zipSync };
