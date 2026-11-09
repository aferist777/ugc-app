'use strict';

/* updater.js - a friend's copy asks the owner's Worker for a new version and lays it down beside the running one
   (phase V83, block B5; the owner 2026-11-09: (о5) downloaded by itself, installed only by "restart" in the chip,
   (о6) nothing forced, (о11а) "у друга только рабочая версия" - the old one goes once the new one came up, desktop/home.js).

   Only in a copy the launcher started (UGC_HOME), with a token (updates\token, put there by the handoff) and with the
   public key and the Worker's address in the program (desktop/update-key.js) - otherwise it says why and asks nothing.
   A minute after the start, then every six hours, and on "Check now" (Admin -> This computer, through the server).

   A check: the channel's envelope (lib/update-manifest.js `open` - the program's key, a sound shape); a version with a
   sequence number above this one's, not `bad` (versions\current.json), not ready already:
     - room on the disk for what is new (+10 %), else said in words;
     - each content this version does not have is fetched ONCE into updates\blobs\<sha256>.gz (.part while it comes; a
       break leaves the finished ones - the next check goes on from there);
     - updates\staging\<version>\ is laid out: a file this version has (by its hash) as a HARD LINK to it - no second
       copy on the disk (a copy where a link cannot be made: exFAT, another drive) -, the rest unpacked from its blob
       and its sha256 checked;
     - its files.json written, the folder moved to versions\<version>, updates\ready.json { version, seq, notes,
       important } - the chip says "Update <version>" and the launcher switches at the next start.
   The running version is never touched. Its state is in updates\state.json for the server (lib/app-update.js) and
   each check tells the Worker what this copy has (POST /v1/seen, the owner (о3)). */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');
const UM = require('../lib/update-manifest');

const FIRST_MS = Number(process.env.UGC_UPDATE_FIRST_MS) || 60 * 1000;
const EVERY_MS = 6 * 60 * 60 * 1000;
const CHANNEL = 'stable';
const EXE = 'UGC Studio.exe';

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

function createUpdater({ home, appDir, log, key }) {
  if (!home) return null;
  const updates = path.join(home, 'updates');
  const versions = path.join(home, 'versions');
  const mine = path.dirname(process.execPath);
  const myVersion = path.basename(mine);
  const info = readJson(path.join(appDir, 'version.json')) || {};
  const mySeq = Number(info.seq) || 0;
  let url = ((readJson(path.join(updates, 'url.json')) || {}).url) || key.WORKER_URL || '';
  let busy = false;
  let timer = null;
  let lastSave = 0;
  const state = { phase: 'idle', version: myVersion, seq: mySeq, channel: CHANNEL, checkedAt: '', error: '', target: '', done: 0, total: 0 };

  function save(patch, force = true) {
    Object.assign(state, patch);
    if (!force && Date.now() - lastSave < 500) return;
    lastSave = Date.now();
    try { writeJson(path.join(updates, 'state.json'), state); } catch (e) { log.line('the update state was not written: ' + e.message); }
  }
  const token = () => { try { return fs.readFileSync(path.join(updates, 'token'), 'utf8').trim(); } catch { return ''; } };
  const call = (p, opts = {}) => fetch(url.replace(/\/+$/, '') + p, {
    ...opts,
    headers: { authorization: 'Bearer ' + token(), ...(opts.headers || {}) },
    signal: AbortSignal.timeout(opts.long ? 30 * 60 * 1000 : 30 * 1000),
  });
  const seen = (what) => call('/v1/seen', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ version: myVersion, seq: mySeq, platform: UM.PLATFORM, state: what }),
  }).catch(() => { /* said next time */ });

  async function fetchBlob(f, dir) {
    const done = path.join(dir, `${f.h}.gz`);
    try { if (fs.statSync(done).size === f.z) return done; } catch { /* not yet */ }
    const part = `${done}.part`;
    for (let attempt = 1; ; attempt++) {
      try {
        const r = await call(`/v1/blob/${f.h}`, { long: true });
        if (!r.ok || !r.body) throw new Error(`the update server answered ${r.status} for a file`);
        await pipeline(Readable.fromWeb(r.body), fs.createWriteStream(part));
        const size = fs.statSync(part).size;
        if (size !== f.z) throw new Error(`a file came short (${size} of ${f.z} bytes)`);
        fs.renameSync(part, done);
        return done;
      } catch (e) {
        try { fs.rmSync(part, { force: true }); } catch { /* next time */ }
        if (attempt >= 2) throw e;
      }
    }
  }

  async function download(m) {
    const stage = path.join(updates, 'staging', m.version);
    const blobs = path.join(updates, 'blobs');
    fs.mkdirSync(blobs, { recursive: true });

    // What this version has, by content.
    const have = new Map();
    const own = readJson(path.join(appDir, 'files.json'));
    for (const f of (own && own.files) || []) if (!have.has(f.h)) have.set(f.h, path.join(mine, ...f.p.split('/')));

    const fetchList = [];
    const seenH = new Set();
    let blobBytes = 0, newBytes = 0;
    for (const f of m.files) {
      if (have.has(f.h)) continue;
      newBytes += f.s;
      if (seenH.has(f.h)) continue;
      seenH.add(f.h);
      fetchList.push(f);
      blobBytes += f.z;
    }
    const need = Math.round((blobBytes + newBytes) * 1.1) + 64 * 1048576;
    try {
      const st = fs.statfsSync(home);
      const free = st.bavail * st.bsize;
      if (free < need) throw new Error(`Not enough space on the disk for UGC Studio ${m.version}: ${mb(need)} MB needed, ${mb(free)} MB free.`);
    } catch (e) { if (/Not enough space/.test(e.message)) throw e; }

    log.line(`update ${m.version}: ${fetchList.length} files to fetch (${mb(blobBytes)} MB), ${m.files.length - fetchList.length} from this version`);
    save({ phase: 'downloading', target: m.version, done: 0, total: blobBytes, error: '' });
    seen('downloading');
    let done = 0;
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(3, fetchList.length) }, async () => {
      while (next < fetchList.length) {
        const f = fetchList[next++];
        await fetchBlob(f, blobs);
        done += f.z;
        save({ done }, false);
      }
    }));
    save({ phase: 'installing', done: blobBytes });

    // The folder, beside the running one.
    let linked = 0, copied = 0, unpacked = 0;
    for (const f of m.files) {
      const target = path.join(stage, ...f.p.split('/'));
      fs.mkdirSync(path.dirname(target), { recursive: true });
      try { if (fs.statSync(target).size === f.s) continue; } catch { /* not there yet */ }
      const src = have.get(f.h);
      if (src) {
        try { fs.rmSync(target, { force: true }); fs.linkSync(src, target); linked++; continue; } catch { /* below */ }
        fs.copyFileSync(src, target);
        copied++;
        continue;
      }
      const tmp = `${target}.tmp`;
      await pipeline(fs.createReadStream(path.join(blobs, `${f.h}.gz`)), zlib.createGunzip(), fs.createWriteStream(tmp));
      if (await sha256File(tmp) !== f.h) { fs.rmSync(tmp, { force: true }); throw new Error(`a file of ${m.version} did not match its checksum: ${f.p}`); }
      fs.renameSync(tmp, target);
      unpacked++;
    }
    writeJson(path.join(stage, 'resources', 'app', 'files.json'), { version: m.version, seq: m.seq, commit: m.commit, files: m.files.map((f) => ({ p: f.p, h: f.h, s: f.s })) });
    if (!fs.existsSync(path.join(stage, EXE))) throw new Error(`${m.version} has no ${EXE}`);

    const dest = path.join(versions, m.version);
    if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true, maxRetries: 3 });
    fs.renameSync(stage, dest);
    writeJson(path.join(updates, 'ready.json'), { version: m.version, seq: m.seq, notes: m.notes || '', important: !!m.important, at: now() });
    try { fs.rmSync(blobs, { recursive: true, force: true }); fs.rmSync(path.join(updates, 'staging'), { recursive: true, force: true }); } catch { /* next time */ }
    log.line(`update ${m.version} is ready: ${linked} files linked, ${copied} copied, ${unpacked} new`);
    save({ phase: 'ready', target: m.version, checkedAt: now() });
    seen('ready');
  }

  async function check(why = 'timer') {
    if (busy) return state;
    busy = true;
    try {
      if (!key.PUBLIC_KEY || !url) { save({ phase: 'off', error: 'Updates are not set up in this copy.' }); return state; }
      if (!token()) { save({ phase: 'off', error: 'This copy has no token for updates.' }); return state; }
      save({ phase: 'checking', error: '' });
      const r = await call(`/v1/channel/${CHANNEL}/${UM.PLATFORM}`);
      if (r.status === 403) { save({ phase: 'error', error: 'This copy has no access to updates.', checkedAt: now() }); return state; }
      if (r.status === 404) { save({ phase: 'current', checkedAt: now() }); return state; }
      if (!r.ok) throw new Error(`the update server answered ${r.status}`);
      const m = UM.open(Buffer.from(await r.arrayBuffer()), key.PUBLIC_KEY);
      if (m.moveTo && m.moveTo !== url) { url = m.moveTo; writeJson(path.join(updates, 'url.json'), { url, at: now() }); log.line('updates moved to ' + url); }
      const bad = ((readJson(path.join(versions, 'current.json')) || {}).bad) || [];
      const ready = readJson(path.join(updates, 'ready.json'));
      if (m.seq <= mySeq || m.version === myVersion || bad.includes(m.version)) {
        save({ phase: 'current', target: '', checkedAt: now() });
        seen('current');
        return state;
      }
      if (ready && Number(ready.seq) >= m.seq && fs.existsSync(path.join(versions, String(ready.version), EXE))) {
        save({ phase: 'ready', target: ready.version, checkedAt: now() });
        return state;
      }
      log.line(`update: ${m.version} (seq ${m.seq}) is out - this is ${myVersion} (seq ${mySeq}); asked by ${why}`);
      await download(m);
    } catch (e) {
      const quiet = /fetch failed|aborted|timeout|ENOTFOUND|ECONN/i.test(e.message);
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

module.exports = { createUpdater };
