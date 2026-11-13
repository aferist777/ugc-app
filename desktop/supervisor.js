'use strict';

/* The server, as the desktop shell runs it.

   server.js runs in an Electron utility process: Node from the same executable, tied to the
   shell. If the shell dies the server goes with it, instead of an orphan holding the port and the
   library. The library and the port reach it as UGC_DATA_DIR and PORT.

   THE PORT is fixed, 38417, because the pages keep their state in localStorage and localStorage
   belongs to one origin. If something else holds it, the next free one of twenty is taken. The
   pages still find their state on another port: it is mirrored into the library
   (public/js/storage-sync.js).

   IF IT DIES after coming up, it is started again - on the same port when that is still free. A
   request in flight fails; the pages carry on. The shell gives up, and says so, after three
   deaths inside two minutes or three starts in a row that never answer: a fourth try will not fix
   a server that keeps falling over.

   STOPPING takes its children with it. On Windows a process tree does not end with its root, and
   an ffmpeg left behind would go on encoding after the window is gone. It is asynchronous, and the
   shell waits for it before it quits: done synchronously, with an encode running, the wait for
   taskkill's exit would never return and the app would hang on the way out. */

const { utilityProcess } = require('electron');
const { execFile, spawn } = require('child_process');
const { EventEmitter } = require('events');
const net = require('net');
const path = require('path');

const FIRST_PORT = 38417;
const PORTS = 20;
const READY_WAIT_MS = 90 * 1000;
const START_TRIES = 3;
const DEATHS = 3;
const DEATH_WINDOW_MS = 2 * 60 * 1000;
const { EXIT_REFUSED } = require('../lib/library-format');

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

function portIsFree(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', () => resolve(false));
    probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true)));
  });
}

async function freePort(preferred) {
  const order = new Set([preferred, ...Array.from({ length: PORTS }, (_, i) => FIRST_PORT + i)]);
  for (const port of order) if (port && await portIsFree(port)) return port;
  return 0;
}

// Up means the routes answer, not just that the port is open. /api/ui-state is what every page
// asks for first.
async function answers(port) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/ui-state`, { signal: AbortSignal.timeout(2000) });
    await r.arrayBuffer();
    return r.ok;
  } catch {
    return false;
  }
}

// Resolves when the process and everything under it are gone, or after a few seconds regardless.
function killTree(pid) {
  const done = new Promise((resolve) => {
    if (process.platform === 'win32') {
      const tk = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
      tk.once('exit', resolve);
      tk.once('error', resolve);
      return;
    }
    execFile('ps', ['-A', '-o', 'pid=,ppid='], { windowsHide: true }, (_err, table) => {
      const kids = new Map();
      for (const row of String(table || '').trim().split('\n')) {
        const [p, parent] = row.trim().split(/\s+/).map(Number);
        if (!kids.has(parent)) kids.set(parent, []);
        kids.get(parent).push(p);
      }
      const tree = [];
      const walk = (p) => { for (const k of kids.get(p) || []) walk(k); tree.push(p); };
      walk(pid);
      for (const p of tree) { try { process.kill(p, 'SIGKILL'); } catch { /* already gone */ } }
      resolve();
    });
  });
  return Promise.race([done, pause(3000)]);
}

// Emits 'ready' (url) each time the server comes up - the url changes only if the port had to -
// and 'failed' (reason) once, when it gives up.
function createSupervisor({ appDir, libraryDir, log }) {
  const events = new EventEmitter();
  let child = null;
  let port = 0;
  let stopping = false;
  let failedStarts = 0;
  const deaths = [];

  async function start() {
    port = await freePort(port);
    if (stopping) return;
    if (!port) {
      events.emit('failed', `No free port between ${FIRST_PORT} and ${FIRST_PORT + PORTS - 1}.`);
      return;
    }

    log.line(`starting the server on port ${port}`);
    const me = utilityProcess.fork(path.join(appDir, 'server.js'), [], {
      cwd: appDir,
      stdio: 'pipe',
      serviceName: 'UGC Studio server',
      env: { ...process.env, UGC_DATA_DIR: libraryDir, PORT: String(port) },
    });
    child = me;
    // What the server asks of the shell (routes/app-update.js: "check for updates now").
    me.on('message', (m) => events.emit('message', m));
    me.stdout.on('data', log.write);
    // A library a newer program wrote: the server says why on stderr and exits with
    // EXIT_REFUSED - no second try will open it, so the shell gives up at once, in those words.
    let refusal = '';
    me.stderr.on('data', (chunk) => {
      log.write(chunk);
      const m = /\[format\] (.+)/.exec(String(chunk));
      if (m) refusal = m[1].trim();
    });

    let up = false;
    let gone = false;
    let exitCode = null;
    me.once('exit', (code) => {
      gone = true;
      exitCode = code;
      if (child === me) child = null;
      if (stopping) return;
      log.line(`the server exited with code ${code}`);
      if (up) died();
    });

    const until = Date.now() + READY_WAIT_MS;
    while (!gone && !stopping && Date.now() < until) {
      if (await answers(port)) { up = true; break; }
      await pause(250);
    }
    if (stopping) return;

    if (!up && gone && exitCode === EXIT_REFUSED) {
      events.emit('failed', refusal || 'This library was written by a newer UGC Studio.');
      return;
    }
    if (!up) {
      if (!gone) {
        log.line(`no answer on port ${port} after ${READY_WAIT_MS / 1000}s`);
        if (me.pid) killTree(me.pid);
        else me.kill();
      }
      if (++failedStarts >= START_TRIES) {
        events.emit('failed', gone ? 'The server stopped while it was starting.' : 'The server did not answer.');
        return;
      }
      port = 0;   // the port may have been the trouble: look again from the first one
      start();
      return;
    }

    failedStarts = 0;
    events.emit('ready', `http://127.0.0.1:${port}`);
  }

  function died() {
    const now = Date.now();
    deaths.push(now);
    while (now - deaths[0] > DEATH_WINDOW_MS) deaths.shift();
    if (deaths.length >= DEATHS) {
      events.emit('failed', `The server stopped ${deaths.length} times in two minutes.`);
      return;
    }
    setTimeout(start, 1000);
  }

  // A promise: the shell quits once it settles.
  function stop() {
    stopping = true;
    const me = child;
    child = null;
    if (!me) return Promise.resolve();
    if (me.pid) return killTree(me.pid);
    me.kill();
    return Promise.resolve();
  }

  return { on: events.on.bind(events), start, stop };
}

module.exports = { createSupervisor };
