'use strict';

/* What the app's pages may ask of their window (phase V19, the owner 2026-10-08) - and nothing else: minimise it, take
   (phase V23) restart the app for a new version, or
   it out of full screen or back (what F11 does), close it - the same close as the window's own, so a running render is
   asked about first. The pages draw the buttons themselves (public/js/app-nav.js); in a browser there is no `ugcWindow`
   and no buttons. The main process answers only the app's own pages (desktop/main.js).
   (phase V28.1) And where a file the person picked lies on this computer: a source added from a file is copied by
   the server from there (lib/source-intake.js), so leaving the page cuts nothing off. A browser has no such thing. */

const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('ugcWindow', {
  minimize: () => ipcRenderer.send('ugc-window', 'minimize'),
  toggleFull: () => ipcRenderer.send('ugc-window', 'full'),
  close: () => ipcRenderer.send('ugc-window', 'close'),
  // (phase V23) A new version is in the program folder: the whole app starts again, a running render asked about first.
  restart: () => ipcRenderer.send('ugc-window', 'restart'),
  isFull: () => ipcRenderer.invoke('ugc-window-full'),
  // A File from an <input type=file> -> its path on disk, '' for one that is not a file on disk.
  pathOf: (file) => { try { return webUtils.getPathForFile(file) || ''; } catch { return ''; } },
  onFull: (fn) => {
    if (typeof fn !== 'function') return;
    ipcRenderer.on('ugc-window-full', (_e, full) => { try { fn(!!full); } catch { /* the page's own */ } });
  },
});
