'use strict';

/* faces.js - the app's HIDDEN faces window (phase V33.2; docs/local-app/PLAN.md "Фаза V33", V33.2).

   MediaPipe's face detector needs a browser, and the server (Node, in a utility process) is not one; a page of the app
   counts only while it is open. So the shell keeps one window that is never shown - public/faces-worker.html - which asks
   the server for films to count and answers with their faces (lib/faces.js). It has the window's graphics card and goes
   on whatever page the person is on. Opened once the server answers; it follows the server to a new port like every
   other window (main.js); a page that dies is opened again; the app's quit closes it. */

const { BrowserWindow } = require('electron');

function createFacesWindow({ log }) {
  let win = null;
  let origin = null;
  let closing = false;

  function open(url) {
    origin = url;
    if (closing) return;
    if (win && !win.isDestroyed()) return;
    win = new BrowserWindow({
      show: false,
      skipTaskbar: true,
      width: 320,
      height: 200,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        // Counting must not slow down because the window is never seen.
        backgroundThrottling: false,
      },
    });
    win.on('closed', () => { win = null; });
    win.webContents.on('render-process-gone', (_e, d) => {
      log.line(`the faces window's page went (${d.reason}) - opening it again`);
      try { if (win && !win.isDestroyed()) win.destroy(); } catch { /* gone */ }
      win = null;
      setTimeout(() => { if (!closing && origin) open(origin); }, 5000);
    });
    win.loadURL(url + '/faces-worker.html').catch((e) => log.line(`the faces window could not open: ${e.message}`));
  }

  function close() {
    closing = true;
    try { if (win && !win.isDestroyed()) win.destroy(); } catch { /* gone */ }
    win = null;
  }

  return { open, close, get window() { return win; } };
}

module.exports = { createFacesWindow };
