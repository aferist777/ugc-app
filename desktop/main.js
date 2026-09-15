'use strict';

/* UGC Studio's desktop shell - the Electron main process.

   It settles the library, runs the server (desktop/supervisor.js) and shows the app in a window
   of its own, full screen. The pages still do everything through the server over loopback, as
   they did in a browser tab. The shell supplies what the tab used to get from the browser: the
   window, downloads, links that leave the app, a context menu, the usual keys.

   THE LIBRARY is where everything the app writes goes (lib/config.js). Run from source it is
   local-data/ in the checkout; built, it is the folder the exe sits in. UGC_DATA_DIR overrides
   both, which is how a launcher that updates the program will name it.

   THE PROFILE - Chromium's own storage: localStorage, zoom, permissions - is in the library too,
   one per operating system, so the pages' state stays with the library, not with the machine.
   Chromium's HTTP cache is switched off: every page and file comes from the server on this
   machine, so a cache would only make the library bigger. (Electron has no switch to move it -
   Chrome's --disk-cache-dir is ignored.)

   ONE COPY PER LIBRARY. The lock is taken on the profile: starting the app again focuses the
   window that is already open. A copy on another library takes another lock and runs beside it,
   on a port of its own. */

const { app, BrowserWindow, Menu, clipboard, dialog, session, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const { createSupervisor } = require('./supervisor');
const { openLog } = require('./log');

const APP_DIR = path.join(__dirname, '..');
const DEV = !app.isPackaged;
// Development only: `npm start -- --windowed` opens an ordinary window and leaves the focus alone.
const WINDOWED = DEV && process.argv.includes('--windowed');
// The pages' dark background, so no window flashes white before its page paints.
const BG = '#0c0f16';

const LIBRARY = path.resolve(process.env.UGC_DATA_DIR
  || (app.isPackaged ? path.dirname(process.execPath) : path.join(APP_DIR, 'local-data')));

function canWrite(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, `.write-test-${process.pid}`);
    fs.writeFileSync(probe, '');
    fs.unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}

if (canWrite(LIBRARY)) {
  run();
} else {
  dialog.showErrorBox('UGC Studio cannot start',
    `UGC Studio keeps everything it makes in this folder:\n\n${LIBRARY}\n\n` +
    'It cannot write there. Move the UGC Studio folder somewhere you can write - Documents, ' +
    'the Desktop, another drive - and open it again.');
  app.exit(1);
}

function run() {
  const profile = path.join(LIBRARY, 'cache', 'profile', process.platform);
  // The lock file goes in here, and it cannot be made in a folder that does not exist yet - the
  // lock would just fail, and a failed lock reads the same as another copy holding it.
  fs.mkdirSync(profile, { recursive: true });
  app.setPath('userData', profile);
  app.setPath('sessionData', profile);
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }

  process.env.UGC_DATA_DIR = LIBRARY;
  const { LOGS_DIR } = require('../lib/config');   // creates the library's folders
  app.commandLine.appendSwitch('disable-http-cache');

  const log = openLog(LOGS_DIR, { echo: DEV });
  log.line(`library: ${LIBRARY}`);
  const server = createSupervisor({ appDir: APP_DIR, libraryDir: LIBRARY, log });

  let origin = null;         // http://127.0.0.1:<port>, once the server answers
  let mainWindow = null;
  let closeConfirmed = false;
  let asking = false;        // the question about a running render is on screen
  let serverStopped = false;

  const internal = (url) => {
    try { return !!origin && new URL(url).origin === origin; } catch { return false; }
  };
  // Only web and mail addresses leave the app - never file:, never a scheme a page made up.
  const outside = (url) => { if (/^(https?|mailto):/i.test(url)) shell.openExternal(url); };

  server.on('ready', (url) => {
    const was = origin;
    origin = url;
    log.line(`the server is up at ${url}`);
    if (!was) {
      if (mainWindow) mainWindow.loadURL(url + '/');
      return;
    }
    if (url === was) return;
    // The port moved on a restart: every page still on the old one follows it.
    for (const w of BrowserWindow.getAllWindows()) {
      try {
        const at = new URL(w.webContents.getURL());
        if (at.origin === was) w.loadURL(url + at.pathname + at.search + at.hash);
      } catch { /* a window with no page */ }
    }
  });

  server.on('failed', async (why) => {
    log.line(`giving up: ${why}`);
    // The messages, not the stack frames under them.
    const tail = log.tail(40).filter((l) => !/^\s+at |^Node\.js v/.test(l)).slice(-10)
      .map((l) => (l.length > 160 ? l.slice(0, 157) + '...' : l)).join('\n');
    const opts = {
      type: 'error', title: 'UGC Studio', noLink: true,
      message: origin ? 'UGC Studio stopped working' : 'UGC Studio could not start',
      detail: `${why}\n\nThe end of the log (${log.file}):\n\n${tail}`,
      buttons: ['Show the log', 'Quit'], defaultId: 1, cancelId: 1,
    };
    const parent = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
    const { response } = await (parent ? dialog.showMessageBox(parent, opts) : dialog.showMessageBox(opts));
    if (response === 0) shell.showItemInFolder(log.file);
    closeConfirmed = true;
    app.quit();
  });

  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
  app.on('web-contents-created', (_e, contents) => wire(contents));
  // The mouse's back and forward buttons.
  app.on('browser-window-created', (_e, win) => win.on('app-command', (_ev, cmd) => {
    const history = win.webContents.navigationHistory;
    if (cmd === 'browser-backward' && history.canGoBack()) history.goBack();
    if (cmd === 'browser-forward' && history.canGoForward()) history.goForward();
  }));
  app.on('window-all-closed', () => app.quit());
  // Quitting waits for the server and whatever it started to be gone (desktop/supervisor.js).
  app.on('will-quit', (e) => {
    if (serverStopped) return;
    e.preventDefault();
    log.line('quitting');
    server.stop().then(() => {
      serverStopped = true;
      // On a later tick: a stop with nothing to stop settles while Electron is still inside the
      // quit this event just cancelled, and a quit asked for in there is ignored.
      setImmediate(() => app.quit());
    });
  });
  process.on('SIGINT', () => app.quit());

  app.whenReady().then(() => {
    // No menu bar. On a Mac the Edit menu is what makes copy and paste work, so it stays there.
    Menu.setApplicationMenu(process.platform === 'darwin'
      ? Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }])
      : null);
    guardSession();
    mainWindow = openMainWindow();
    server.start();
  });

  function openMainWindow() {
    const win = new BrowserWindow({
      title: 'UGC Studio',
      width: 1440,
      height: 900,
      fullscreen: !WINDOWED,
      show: false,
      backgroundColor: BG,
      autoHideMenuBar: true,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        // Pages poll their generations; a minimised window keeps polling, as an app should.
        backgroundThrottling: false,
      },
    });
    win.once('ready-to-show', () => (WINDOWED ? win.showInactive() : win.show()));
    win.on('close', (e) => confirmClose(e, win));
    win.on('closed', () => {
      mainWindow = null;
      app.quit();
    });
    win.loadFile(path.join(__dirname, 'starting.html'));
    return win;
  }

  // Closing the window stops the server, and a render with it - which closing a browser tab never
  // did. So a render still running is asked about first. Asked once: another close while the
  // question is open is ignored, or its answer could overrule the one being given.
  async function confirmClose(e, win) {
    if (closeConfirmed || !origin) return;
    e.preventDefault();
    if (asking) return;
    asking = true;
    try {
      if (await renderRunning()) {
        const { response } = await dialog.showMessageBox(win, {
          type: 'warning', title: 'UGC Studio', noLink: true,
          message: 'A render is still running',
          detail: 'Quitting stops it. It goes back to the Merge queue and starts over with Render all.',
          buttons: ['Quit', 'Keep working'], defaultId: 1, cancelId: 1,
        });
        if (response !== 0) return;
      }
      closeConfirmed = true;
    } finally {
      asking = false;
    }
    if (!win.isDestroyed()) win.close();
  }

  async function renderRunning() {
    try {
      const r = await fetch(origin + '/api/mv3q', { signal: AbortSignal.timeout(1500) });
      return !!(await r.json()).running;
    } catch {
      return false;
    }
  }

  function wire(contents) {
    if (contents.getType() !== 'window') return;   // DevTools look after themselves

    contents.setWindowOpenHandler(({ url }) => {
      if (internal(url)) return { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true, backgroundColor: BG } };
      outside(url);
      return { action: 'deny' };
    });
    // A link with no target, or a file dropped outside a drop zone, would take the page away.
    contents.on('will-navigate', (e, url) => {
      if (internal(url)) return;
      e.preventDefault();
      outside(url);
    });
    contents.on('before-input-event', (e, input) => {
      if (input.type === 'keyDown' && shortcut(contents, input)) e.preventDefault();
    });
    contents.on('context-menu', (_e, params) => contextMenu(contents, params));

    let reloadedAt = 0;
    contents.on('render-process-gone', (_e, { reason }) => {
      log.line(`a page's process ended (${reason}): ${contents.getURL()}`);
      // Reloaded once; a page that dies again straight away is left for the person to see.
      if (reason === 'clean-exit' || Date.now() - reloadedAt < 10000) return;
      reloadedAt = Date.now();
      contents.reload();
    });
  }

  // The keys a browser handled for its tab. Matched by key position, not character, so they work
  // in any keyboard layout.
  function shortcut(contents, input) {
    const win = BrowserWindow.fromWebContents(contents);
    const mod = process.platform === 'darwin' ? input.meta : input.control;
    const code = input.code;
    const history = contents.navigationHistory;
    if (code === 'F11' && win) {
      const full = !win.isFullScreen();
      if (!full) win.once('leave-full-screen', () => win.maximize());
      win.setFullScreen(full);
    } else if (code === 'F5' || (mod && code === 'KeyR')) {
      if (input.shift || (mod && code === 'F5')) contents.reloadIgnoringCache();
      else contents.reload();
    } else if (DEV && (code === 'F12' || (mod && input.shift && code === 'KeyI'))) {
      contents.toggleDevTools();
    } else if (mod && (code === 'Equal' || code === 'NumpadAdd')) {
      contents.setZoomLevel(Math.min(contents.getZoomLevel() + 0.5, 5));
    } else if (mod && (code === 'Minus' || code === 'NumpadSubtract')) {
      contents.setZoomLevel(Math.max(contents.getZoomLevel() - 0.5, -5));
    } else if (mod && (code === 'Digit0' || code === 'Numpad0')) {
      contents.setZoomLevel(0);
    } else if (input.alt && code === 'ArrowLeft' && history.canGoBack()) {
      history.goBack();
    } else if (input.alt && code === 'ArrowRight' && history.canGoForward()) {
      history.goForward();
    } else {
      return false;
    }
    return true;
  }

  // Chromium brings no context menu of its own. This one has what a right click is for here: copy
  // and paste, a picture or a clip saved out, a link copied. A page with its own menu (the
  // Library's cards) cancels the event, and this one does not open.
  function contextMenu(contents, p) {
    const groups = [];
    if (p.misspelledWord) {
      groups.push(p.dictionarySuggestions.length
        ? p.dictionarySuggestions.slice(0, 5).map((s) => ({ label: s, click: () => contents.replaceMisspelling(s) }))
        : [{ label: 'No suggestions', enabled: false }]);
    }
    if (/^(https?|mailto):/i.test(p.linkURL)) {
      groups.push([
        ...(internal(p.linkURL) ? [] : [{ label: 'Open link in browser', click: () => outside(p.linkURL) }]),
        { label: 'Copy link address', click: () => clipboard.writeText(p.linkURL) },
      ]);
    }
    if (p.mediaType === 'image' && p.srcURL) {
      groups.push([
        { label: 'Copy image', click: () => contents.copyImageAt(p.x, p.y) },
        { label: 'Save image as...', click: () => contents.downloadURL(p.srcURL) },
      ]);
    } else if ((p.mediaType === 'video' || p.mediaType === 'audio') && /^https?:/.test(p.srcURL)) {
      groups.push([{ label: `Save ${p.mediaType} as...`, click: () => contents.downloadURL(p.srcURL) }]);
    }
    if (p.isEditable) {
      groups.push([
        { role: 'cut', enabled: p.editFlags.canCut },
        { role: 'copy', enabled: p.editFlags.canCopy },
        { role: 'paste', enabled: p.editFlags.canPaste },
        { role: 'selectAll' },
      ]);
    } else if (p.selectionText.trim()) {
      groups.push([{ role: 'copy' }]);
    }
    if (DEV) groups.push([{ label: 'Inspect', click: () => contents.inspectElement(p.x, p.y) }]);
    if (!groups.length) return;
    const items = groups.flatMap((g, i) => (i ? [{ type: 'separator' }, ...g] : g));
    Menu.buildFromTemplate(items).popup({ window: BrowserWindow.fromWebContents(contents) });
  }

  function guardSession() {
    const s = session.defaultSession;
    // The app's own pages get what they ask for - the clipboard, full screen. Nothing else is ever
    // loaded in these windows, and if something were, it would get nothing.
    s.setPermissionRequestHandler((wc, _permission, done, details) => done(internal(details.requestingUrl || wc.getURL())));
    s.setPermissionCheckHandler((_wc, _permission, requestingOrigin) => internal(requestingOrigin));

    // Every download asks where to save it. A browser showed progress in its download bar; here it
    // is the taskbar button.
    s.on('will-download', (_e, item, contents) => {
      const win = contents ? BrowserWindow.fromWebContents(contents) : null;
      item.setSaveDialogOptions({ defaultPath: path.join(app.getPath('downloads'), item.getFilename()) });
      item.on('updated', () => {
        const total = item.getTotalBytes();
        if (win && !win.isDestroyed() && total > 0) win.setProgressBar(item.getReceivedBytes() / total);
      });
      item.once('done', (_d, state) => {
        if (win && !win.isDestroyed()) win.setProgressBar(-1);
        if (state !== 'interrupted') return;
        const opts = { type: 'error', title: 'UGC Studio', message: 'The download stopped',
                       detail: `${item.getFilename()} was not saved in full.` };
        if (win && !win.isDestroyed()) dialog.showMessageBox(win, opts);
        else dialog.showMessageBox(opts);
      });
    });
  }
}
