'use strict';

/* home.js - the app's side of the launcher (desktop/launcher/Launcher.cs).

   Only when the launcher started this copy: it names the UGC Studio folder in UGC_HOME and itself in UGC_LAUNCHER.
   This version's name is its folder's - versions\<name>\UGC Studio.exe -, as the launcher knows it.
     cameUp()   once, when the server first answers: updates\started.json { version } - the launcher stops counting
                tries and keeps this version -, updates\running.json { pid, version } - pressed again while open, the
                launcher only brings this window up -; then every OTHER version folder is deleted, in the background
                (an installed copy keeps only the working one), except one the updater has made ready; and the
                launcher in the folder is replaced by this version's own copy when they differ (a new launcher arrives
                with an update - it is not running by now).
     closing()  running.json taken away, if it is still ours.
     restart()  "Restart and update": the launcher, told to wait until this app is gone - it switches versions, not
                Electron's relaunch, which would start this same version again. */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const EXE = 'UGC Studio.exe';

function createHome({ home, launcher, appDir, log }) {
  if (!home) return null;
  const updates = path.join(home, 'updates');
  const versions = path.join(home, 'versions');
  const version = path.basename(path.dirname(process.execPath));
  let came = false;

  const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8').replace(/^﻿/, '')); } catch { return null; } };
  function writeJson(f, o) {
    try {
      fs.mkdirSync(updates, { recursive: true });
      const tmp = `${f}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(o, null, 2));
      fs.renameSync(tmp, f);
    } catch (e) { log.line(`${path.basename(f)} was not written: ${e.message}`); }
  }
  const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

  async function tidy() {
    const keep = new Set([version.toLowerCase()]);
    const ready = readJson(path.join(updates, 'ready.json'));
    if (ready && ready.version) keep.add(String(ready.version).toLowerCase());
    let names = [];
    try { names = fs.readdirSync(versions, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch { return; }
    for (const n of names) {
      if (keep.has(n.toLowerCase())) continue;
      try {
        await fs.promises.rm(path.join(versions, n), { recursive: true, force: true, maxRetries: 3 });
        log.line(`version ${n} deleted - ${version} came up`);
      } catch (e) { log.line(`version ${n} was not deleted: ${e.message}`); }
    }
  }

  function refreshLauncher() {
    const shipped = path.join(appDir, 'launcher', EXE);
    if (!launcher || !fs.existsSync(shipped) || !fs.existsSync(launcher)) return;
    try {
      if (sha(shipped) === sha(launcher)) return;
      const tmp = `${launcher}.new`;
      fs.copyFileSync(shipped, tmp);
      fs.renameSync(tmp, launcher);
      log.line('the launcher was replaced by this version\'s');
    } catch (e) { log.line(`the launcher was not replaced: ${e.message}`); }
  }

  function cameUp() {
    if (came) return;
    came = true;
    const at = new Date().toISOString();
    writeJson(path.join(updates, 'started.json'), { version, at });
    writeJson(path.join(updates, 'running.json'), { pid: process.pid, version, at });
    log.line(`started by the launcher: version ${version}`);
    refreshLauncher();
    tidy().catch((e) => log.line('tidying the versions failed: ' + e.message));
  }

  function closing() {
    const f = path.join(updates, 'running.json');
    const r = readJson(f);
    if (r && r.pid === process.pid) { try { fs.rmSync(f, { force: true }); } catch { /* the launcher checks the pid anyway */ } }
  }

  // True when the launcher was started; the caller quits.
  function restart() {
    if (!launcher || !fs.existsSync(launcher)) return false;
    try {
      // windowsHide: false - the launcher is a window program with no console, and the window it may show (a version
      // that did not start, gone back) must be seen.
      const child = spawn(launcher, ['--after', String(process.pid)], { detached: true, stdio: 'ignore', windowsHide: false });
      child.unref();
      log.line('restarting through the launcher');
      return true;
    } catch (e) {
      log.line(`the launcher could not be started: ${e.message}`);
      return false;
    }
  }

  return { version, cameUp, closing, restart };
}

module.exports = { createHome };
