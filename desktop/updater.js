'use strict';

/* updater.js - an installed copy asks the program's GitHub Releases for a new version and lays it down beside the
   running one: downloaded by itself, installed only by "restart" in the chip, nothing forced; the old version goes once
   the new one came up (desktop/home.js). The library (library\ beside versions\) is never touched.

   Only in a copy the launcher started (UGC_HOME) and with the public key and the releases' address in the program
   (desktop/update-key.js) - otherwise it says why and asks nothing. A minute after the start, then every six hours, and
   on "Check now" (Admin -> This computer, through the server).

   A release on GitHub carries two files (tools/release.js): the zip a person unpacks, and the signed manifest of what is
   in it (lib/update-manifest.js). A check reads <releases>/latest/download/<manifest> - a plain download, no API and
   none of its limits -, opens it with the program's key, and takes a version with a sequence number above this one's,
   not `bad` (versions\current.json), not ready already:
     - room on the disk for what is new (+10 %), else said in words;
     - what this version does not have (by sha256) is read out of the release's zip BY BYTE RANGES - the manifest says
       where each file lies in it - into updates\parts\, a few at once; a server that answers a range with the whole
       file, or a release whose new files are most of the zip, is downloaded whole into updates\parts\ instead;
     - updates\staging\<version>\ is laid out: a file this version has as a HARD LINK to it - no second copy on the
       disk (a copy where a link cannot be made: exFAT, another drive) -, the rest unpacked from the zip's bytes and
       its sha256 checked; a break leaves what is unpacked - the next check goes on from there;
     - its files.json written, the folder moved to versions\<version>, updates\ready.json { version, seq, notes,
       important } - the chip says "Update <version>" and the launcher switches at the next start.
   The running version is never touched. Its state is in updates\state.json for the server (lib/app-update.js). */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');
const UM = require('../lib/update-manifest');

const FIRST_MS = Number(process.env.UGC_UPDATE_FIRST_MS) || 60 * 1000;
const EVERY_MS = 6 * 60 * 60 * 1000;
const EXE = 'UGC Studio.exe';
// Ranges closer than this are asked as one; one range is at most RANGE_MAX (a single larger file is its own).
const GAP = 1 << 20;
const RANGE_MAX = 64 << 20;
// New files above this share of the zip: the zip is taken whole.
const WHOLE_SHARE = 0.6;

const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8').replace(/^﻿/, '')); } catch { return null; } };
function writeJson(f, o) {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const tmp = `${f}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(o, null, 2));
  fs.renameSync(tmp, f);
}
const now = () => new Date().toISOString();
const mb = (b) => Math.round(b / 1048576);

function sha256File(f) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(f).on('data', (c) => h.update(c)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
  });
}

/** The ranges to ask for: the files sorted by where they lie, neighbours merged. `end` is exclusive. */
function rangesOf(files) {
  const sorted = [...files].sort((a, b) => a.o - b.o);
  const out = [];
  for (const f of sorted) {
    const last = out[out.length - 1];
    const end = f.o + f.z;
    if (last && f.o - last.end <= GAP && end - last.start <= RANGE_MAX) {
      last.end = Math.max(last.end, end);
      last.files.push(f);
    } else {
      out.push({ start: f.o, end, files: [f] });
    }
  }
  return out;
}

function createUpdater({ home, appDir, log, key }) {
  if (!home) return null;
  const updates = path.join(home, 'updates');
  const versions = path.join(home, 'versions');
  const mine = path.dirname(process.execPath);
  const myVersion = path.basename(mine);
  const info = readJson(path.join(appDir, 'version.json')) || {};
  const mySeq = Number(info.seq) || 0;
  let base = ((readJson(path.join(updates, 'url.json')) || {}).url) || key.RELEASES || '';
  let busy = false;
  let timer = null;
  let lastSave = 0;
  const state = { phase: 'idle', version: myVersion, seq: mySeq, checkedAt: '', error: '', target: '', done: 0, total: 0 };

  function save(patch, force = true) {
    Object.assign(state, patch);
    if (!force && Date.now() - lastSave < 500) return;
    lastSave = Date.now();
    try { writeJson(path.join(updates, 'state.json'), state); } catch (e) { log.line('the update state was not written: ' + e.message); }
  }
  const get = (url, opts = {}) => fetch(url, {
    headers: opts.headers || {},
    redirect: 'follow',
    signal: AbortSignal.timeout(opts.long ? 30 * 60 * 1000 : 30 * 1000),
  });
  const releases = () => base.replace(/\/+$/, '');

  // One file out of the zip's bytes: `file` holds the zip from its byte `from` on.
  async function unpack(file, from, f, target) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const tmp = `${target}.tmp`;
    const src = fs.createReadStream(file, { start: f.o - from, end: f.o - from + f.z - 1 });
    if (f.m === 8) await pipeline(src, zlib.createInflateRaw(), fs.createWriteStream(tmp));
    else await pipeline(src, fs.createWriteStream(tmp));
    if (await sha256File(tmp) !== f.h) { fs.rmSync(tmp, { force: true }); throw new Error(`a file of the update did not match its checksum: ${f.p}`); }
    fs.rmSync(target, { force: true });
    fs.renameSync(tmp, target);
  }

  // The body of an answer into a file, counted as it comes.
  async function saveBody(r, file, count) {
    const body = Readable.fromWeb(r.body);
    body.on('data', (c) => count(c.length));
    await pipeline(body, fs.createWriteStream(file));
    return fs.statSync(file).size;
  }

  async function download(m) {
    const stage = path.join(updates, 'staging', m.version);
    const parts = path.join(updates, 'parts');
    const zipUrl = `${releases()}/download/${encodeURIComponent(m.tag)}/${encodeURIComponent(m.zip.name)}`;
    const into = (f) => path.join(stage, ...f.p.split('/'));

    // What this version has, by content; what is unpacked already, from an earlier try that broke off.
    const have = new Map();
    const own = readJson(path.join(appDir, 'files.json'));
    for (const f of (own && own.files) || []) if (!have.has(f.h)) have.set(f.h, path.join(mine, ...f.p.split('/')));
    const staged = async (f) => {
      try { return fs.statSync(into(f)).size === f.s && await sha256File(into(f)) === f.h; } catch { return false; }
    };
    const need = [];
    const firstOf = new Map();
    let newBytes = 0;
    for (const f of m.files) {
      if (have.has(f.h)) continue;
      newBytes += f.s;
      if (firstOf.has(f.h)) continue;
      firstOf.set(f.h, f);
      if (!(await staged(f))) need.push(f);
    }
    let fetchBytes = need.reduce((s, f) => s + f.z, 0);
    const whole = need.length > 0 && fetchBytes > m.zip.size * WHOLE_SHARE;
    if (whole) fetchBytes = m.zip.size;

    const room = Math.round((fetchBytes + newBytes) * 1.1) + 64 * 1048576;
    try {
      const st = fs.statfsSync(home);
      const free = st.bavail * st.bsize;
      if (free < room) throw new Error(`Not enough space on the disk for UGC Studio ${m.version}: ${mb(room)} MB needed, ${mb(free)} MB free.`);
    } catch (e) { if (/Not enough space/.test(e.message)) throw e; }

    log.line(`update ${m.version}: ${need.length} files to fetch (${mb(fetchBytes)} MB${whole ? ', the whole zip' : ''}), the rest from this version or fetched before`);
    save({ phase: 'downloading', target: m.version, done: 0, total: fetchBytes, error: '' });
    let done = 0;
    const count = (n) => { done += n; save({ done }, false); };
    fs.rmSync(parts, { recursive: true, force: true });
    fs.mkdirSync(parts, { recursive: true });

    // The zip whole: one download, then every new file read out of it.
    async function takeWhole() {
      const zip = path.join(parts, 'release.zip');
      done = 0;
      const r = await get(zipUrl, { long: true });
      if (!r.ok || !r.body) throw new Error(`the update server answered ${r.status} for the release's zip`);
      const size = await saveBody(r, zip, count);
      if (size !== m.zip.size) throw new Error(`the release's zip came short (${size} of ${m.zip.size} bytes)`);
      for (const f of need) await unpack(zip, 0, f, into(f));
    }

    if (whole) await takeWhole();
    else if (need.length) {
      const list = rangesOf(need);
      let refused = false;
      let next = 0;
      await Promise.all(Array.from({ length: Math.min(3, list.length) }, async () => {
        while (!refused && next < list.length) {
          const k = next++;
          const rg = list[k];
          const r = await get(zipUrl, { long: true, headers: { range: `bytes=${rg.start}-${rg.end - 1}` } });
          if (r.status === 200) { refused = true; try { await r.body?.cancel(); } catch { /* gone */ } return; }
          if (r.status !== 206 || !r.body) throw new Error(`the update server answered ${r.status} for a part of the release`);
          const file = path.join(parts, `${k}.part`);
          const size = await saveBody(r, file, count);
          if (size !== rg.end - rg.start) throw new Error(`a part of the release came short (${size} of ${rg.end - rg.start} bytes)`);
          for (const f of rg.files) await unpack(file, rg.start, f, into(f));
          fs.rmSync(file, { force: true });
        }
      }));
      if (refused) {
        log.line(`update ${m.version}: the server gave no ranges - the whole zip`);
        save({ total: m.zip.size });
        await takeWhole();
      }
    }
    save({ phase: 'installing', done: state.total });

    // The folder, beside the running one.
    let linked = 0, copied = 0;
    for (const f of m.files) {
      if (firstOf.get(f.h) === f) continue;                       // unpacked above
      const target = into(f);
      const src = have.get(f.h) || into(firstOf.get(f.h));
      fs.mkdirSync(path.dirname(target), { recursive: true });
      try { if (fs.statSync(target).size === f.s) continue; } catch { /* not there yet */ }
      try { fs.rmSync(target, { force: true }); fs.linkSync(src, target); linked++; continue; } catch { /* below */ }
      fs.copyFileSync(src, target);
      copied++;
    }
    writeJson(path.join(stage, 'resources', 'app', 'files.json'), { version: m.version, seq: m.seq, commit: m.commit, files: m.files.map((f) => ({ p: f.p, h: f.h, s: f.s })) });
    if (!fs.existsSync(path.join(stage, EXE))) throw new Error(`${m.version} has no ${EXE}`);

    const dest = path.join(versions, m.version);
    if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true, maxRetries: 3 });
    fs.renameSync(stage, dest);
    writeJson(path.join(updates, 'ready.json'), { version: m.version, seq: m.seq, notes: m.notes || '', important: !!m.important, at: now() });
    try { fs.rmSync(parts, { recursive: true, force: true }); fs.rmSync(path.join(updates, 'staging'), { recursive: true, force: true }); } catch { /* next time */ }
    log.line(`update ${m.version} is ready: ${need.length} files fetched, ${linked} linked, ${copied} copied`);
    save({ phase: 'ready', target: m.version, checkedAt: now() });
  }

  async function check(why = 'timer') {
    if (busy) return state;
    busy = true;
    try {
      if (!key.PUBLIC_KEY || !base) { save({ phase: 'off', error: 'Updates are not set up in this copy.' }); return state; }
      save({ phase: 'checking', error: '' });
      const r = await get(`${releases()}/latest/download/${UM.MANIFEST}`);
      if (r.status === 404) { save({ phase: 'current', checkedAt: now() }); return state; }
      if (!r.ok) throw new Error(`the update server answered ${r.status}`);
      const m = UM.open(Buffer.from(await r.arrayBuffer()), key.PUBLIC_KEY);
      if (m.moveTo && m.moveTo !== base) { base = m.moveTo; writeJson(path.join(updates, 'url.json'), { url: base, at: now() }); log.line('updates moved to ' + base); }
      const bad = ((readJson(path.join(versions, 'current.json')) || {}).bad) || [];
      const ready = readJson(path.join(updates, 'ready.json'));
      if (m.seq <= mySeq || m.version === myVersion || bad.includes(m.version)) {
        save({ phase: 'current', target: '', checkedAt: now() });
        return state;
      }
      if (ready && Number(ready.seq) >= m.seq && fs.existsSync(path.join(versions, String(ready.version), EXE))) {
        save({ phase: 'ready', target: ready.version, checkedAt: now() });
        return state;
      }
      log.line(`update: ${m.version} (seq ${m.seq}) is out - this is ${myVersion} (seq ${mySeq}); asked by ${why}`);
      await download(m);
    } catch (e) {
      const quiet = /fetch failed|terminated|aborted|timeout|socket|ENOTFOUND|ECONN/i.test(e.message);
      save({ phase: 'error', error: quiet ? 'No connection to the update server.' : e.message, checkedAt: now() });
      log.line('update check failed: ' + e.message);
    } finally {
      busy = false;
    }
    return state;
  }

  function start() {
    save({ phase: state.phase });
    timer = setTimeout(function tick() { check('timer'); timer = setTimeout(tick, EVERY_MS); }, FIRST_MS);
  }
  function stop() { if (timer) clearTimeout(timer); timer = null; }

  return { start, stop, check, state: () => ({ ...state }) };
}

module.exports = { createUpdater, rangesOf };
