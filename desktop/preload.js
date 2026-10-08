'use strict';

/* What the app's pages may ask of their window (phase V19, the owner 2026-10-08) - and nothing else: minimise it, take
   it out of full screen or back (what F11 does), close it - the same close as the window's own, so a running render is
   asked about first. The pages draw the buttons themselves (public/js/app-nav.js); in a browser there is no `ugcWindow`
   and no buttons. The main process answers only the app's own pages (desktop/main.js). */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ugcWindow', {
  minimize: () => ipcRenderer.send('ugc-window', 'minimize'),
  toggleFull: () => ipcRenderer.send('ugc-window', 'full'),
  close: () => ipcRenderer.send('ugc-window', 'close'),
  isFull: () => ipcRenderer.invoke('ugc-window-full'),
  onFull: (fn) => {
    if (typeof fn !== 'function') return;
    ipcRenderer.on('ugc-window-full', (_e, full) => { try { fn(!!full); } catch { /* the page's own */ } });
  },
});
