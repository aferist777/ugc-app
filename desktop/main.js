'use strict';

/* UGC Studio's desktop shell - the Electron main process.

   It settles the library, runs the server (desktop/supervisor.js) and shows the app in a window
   of its own, maximised (full screen is F11 or the strip's button, never at the start).
   The pages do everything through the server over loopback, as in a browser tab. The shell
   supplies what a tab gets from the browser: the window, downloads, links that leave the app,
   a context menu, the usual keys.

   THE LIBRARY is where everything the app writes goes (lib/config.js). Run from source it is
   local-data/ in the checkout. Built, the exe sits in a VERSION folder that an update
   replaces - <root>\versions\<version>\ - so the library is never the exe's folder: the launcher
   names it in UGC_DATA_DIR (which overrides everything, from source too), and an exe started
   straight from its version folder takes <root>\library; anywhere else it does not start.

   THE PROFILE - Chromium's own storage: localStorage, zoom, permissions - is in the library too,
   one per operating system, so the pages' state stays with the library, not with the machine.
   Chromium's HTTP cache is switched off: every page and file comes from the server on this
   machine, so a cache would only make the library bigger. (Electron has no switch to move it -
   Chrome's --disk-cache-dir is ignored.)

   ONE COPY PER LIBRARY. The lock is taken on the profile: starting the app again focuses the
   window that is already open. A copy on another library takes another lock and runs beside it,
   on a port of its own. */

const { app, BrowserWindow, Menu, clipboard, dialog, ipcMain, session, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const { createSupervisor } = require('./supervisor');
const { openLog } = require('./log');
const { createFacesWindow, createBakeWindow } = require('./faces');
const { createHome } = require('./home');
const { createUpdater } = require('./updater');

const APP_DIR = path.join(__dirname, '..');
const DEV = !app.isPackaged;
// Development only: `npm start -- --windowed` opens an ordinary window and leaves the focus alone.
const WINDOWED = DEV && process.argv.includes('--windowed');
// The pages' dark background, so no window flashes white before its page paints.
const BG = '#0c0f16';

// '' - a built exe that is not in a versions folder: there is no library to take.
function libraryDir() {
  if (process.env.UGC_DATA_DIR) return path.resolve(process.env.UGC_DATA_DIR);
  if (!app.isPackaged) return path.join(APP_DIR, 'local-data');
  const version = path.dirname(process.execPath);
  if (path.basename(path.dirname(version)).toLowerCase() !== 'versions') return '';
  return path.join(path.dirname(path.dirname(version)), 'library');
}
const LIBRARY = libraryDir();
// Started by the launcher: the taskbar's pin and its jump list start the LAUNCHER, never this
// version's exe - an update deletes the folder it is in.
const LAUNCHER = process.env.UGC_LAUNCHER || '';
const APP_ID = 'UGCStudio.App';
const ICON = path.join(__dirname, process.platform === 'win32' ? 'icon.ico' : 'icon.png');

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

// A library a newer program wrote is not opened: said here, before the server is started.
const LIB_FORMAT = require('../lib/library-format');
const writable = !!LIBRARY && canWrite(LIBRARY);
const refused = writable ? LIB_FORMAT.check(LIBRARY, require('../lib/app-version').current()) : null;

if (!LIBRARY) {
  dialog.showErrorBox('UGC Studio cannot start',
    `This program is a version of UGC Studio:\n\n${path.dirname(process.execPath)}\n\n` +
    'It is started by "UGC Studio.exe" in the UGC Studio folder - the one beside "versions" and "library". ' +
    'Open that one.');
  app.exit(1);
} else if (refused) {
  dialog.showErrorBox('UGC Studio cannot open this library', refused.message);
  app.exit(LIB_FORMAT.EXIT_REFUSED);
} else if (writable) {
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
  // One taskbar identity for every version the launcher starts.
  if (LAUNCHER && process.platform === 'win32') app.setAppUserModelId(APP_ID);
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
  // The hidden window that counts the faces of the highlights shorts (desktop/faces.js).
  const faces = createFacesWindow({ log });
  // ...and the one that draws the effects the page alone draws, for the render (lib/fx-bake.js).
  const bake = createBakeWindow({ log });
  // Started by the launcher: the marks it reads, the old versions tidied, its restart (desktop/home.js).
  const home = createHome({ home: process.env.UGC_HOME, launcher: LAUNCHER, appDir: APP_DIR, log });
  // ...and the updater: a new version laid down beside this one (desktop/updater.js).
  const updater = home ? createUpdater({ home: process.env.UGC_HOME, appDir: APP_DIR, log, key: require('./update-key') }) : null;

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

  // Full screen and back - F11, and the strip's own button. Out of full screen the window is maximised,
  // with Windows' own title bar - the way it always opens; nothing is remembered.
  function toggleFull(win) {
    const full = !win.isFullScreen();
    if (!full) win.once('leave-full-screen', () => win.maximize());
    win.setFullScreen(full);
  }
  // The window's buttons the pages draw at the right of their strip (desktop/preload.js):
  // minimise, full screen and back, quit - answered for the app's own pages only.
  const own = (e) => internal(e && e.senderFrame ? e.senderFrame.url : '');
  ipcMain.on('ugc-window', (e, what) => {
    if (!own(e)) return;
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win || win.isDestroyed()) return;
    if (what === 'minimize') win.minimize();
    else if (what === 'full') toggleFull(win);
    else if (what === 'close') win.close();
    else if (what === 'restart') restartApp(win);
  });
  ipcMain.handle('ugc-window-full', (e) => {
    const win = own(e) ? BrowserWindow.fromWebContents(e.sender) : null;
    return !!(win && !win.isDestroyed() && win.isFullScreen());
  });
  // "show in folder": a file of the library shown in Explorer (selected in its folder), or a
  // folder of it opened - a highlights project's renders. Only an ADDRESS of the library's own (/media/..., /projects/...) is
  // taken, resolved inside the library and nowhere else: a page never names a path on the disk. Answers whether it was shown.
  ipcMain.handle('ugc-reveal', (e, url) => {
    if (!own(e)) return false;
    let clean = '';
    try { clean = decodeURIComponent(String(url || '').split(/[?#]/)[0]); } catch { return false; }
    if (!/^\/(media|projects)\//.test(clean)) return false;
    const parts = clean.split('/').filter(Boolean);
    if (parts.some((p) => p === '..' || p === '.')) return false;
    const abs = path.join(LIBRARY, ...parts);
    const rel = path.relative(LIBRARY, abs);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel) || !fs.existsSync(abs)) return false;
    if (fs.statSync(abs).isDirectory()) shell.openPath(abs);
    else shell.showItemInFolder(abs);
    return true;
  });

  server.on('ready', (url) => {
    const was = origin;
    origin = url;
    log.line(`the server is up at ${url}`);
    if (home) home.cameUp();
    if (updater && !was) updater.start();
    if (!was) {
      if (mainWindow) mainWindow.loadURL(url + '/');
      faces.open(url);
      bake.open(url);
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
    faces.open(url);   // the faces window is among them; this is where it opens again if its page goes
    bake.open(url);
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
  app.on('quit', () => { if (updater) updater.stop(); if (home) home.closing(); });
  // Admin -> This computer's "Check now", through the server (routes/app-update.js).
  server.on('message', (m) => { if (m && m.type === 'update-check' && updater) updater.check('asked'); });
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
      // The size it takes when it is restored from maximised by hand.
      width: 1440,
      height: 900,
      show: false,
      backgroundColor: BG,
      autoHideMenuBar: true,
      // The app's sign, not Electron's (tools/make-icon.js).
      icon: ICON,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        // What the pages may ask of their window - its buttons, a restart, a picked file's path,
        // "show in folder" - nothing else.
        preload: path.join(__dirname, 'preload.js'),
        // Pages poll their generations; a minimised window keeps polling, as an app should.
        backgroundThrottling: false,
      },
    });
    // A pin of this window starts the launcher - with its icon, under the app's name.
    if (LAUNCHER && process.platform === 'win32') {
      try {
        win.setAppDetails({ appId: APP_ID, appIconPath: LAUNCHER, appIconIndex: 0, relaunchCommand: `"${LAUNCHER}"`, relaunchDisplayName: 'UGC Studio' });
      } catch (e) { log.line('the taskbar details were not set: ' + e.message); }
    }
    // MAXIMISED at every start - Windows' title bar and the taskbar stay; full screen is the person's (F11, the strip's
    // button), and the next start is maximised again. `--windowed` (checks) is an ordinary window that takes no focus.
    win.once('ready-to-show', () => {
      if (WINDOWED) { win.showInactive(); return; }
      win.maximize();
      win.show();
    });
    // The strip's buttons follow full screen, however it was left or taken (F11, the button, Windows).
    for (const ev of ['enter-full-screen', 'leave-full-screen']) {
      win.on(ev, () => { if (!win.isDestroyed()) win.webContents.send('ugc-window-full', ev === 'enter-full-screen'); });
    }
    win.on('close', (e) => confirmClose(e, win));
    win.on('closed', () => {
      mainWindow = null;
      faces.close();
      bake.close();
      app.quit();
    });
    win.loadFile(path.join(__dirname, 'starting.html'));
    return win;
  }

  // Closing the window stops the server, and a render with it. So a render still running is
  // asked about first. Asked once: another close while the
  // question is open is ignored, or its answer could overrule the one being given.
  async function confirmClose(e, win) {
    if (closeConfirmed || !origin) return;
    e.preventDefault();
    if (asking) return;
    asking = true;
    try {
      if (!(await askRender(win, 'Quit'))) return;
      closeConfirmed = true;
    } finally {
      asking = false;
    }
    if (!win.isDestroyed()) win.close();
  }

  // A render still running, asked about before the app stops - the close, and the restart for a new version. `verb` is
  // the button: 'Quit' or 'Restart'. True when the person says go on.
  async function askRender(win, verb) {
    if (!(await renderRunning())) return true;
    const { response } = await dialog.showMessageBox(win, {
      type: 'warning', title: 'UGC Studio', noLink: true,
      message: 'A render is still running',
      detail: (verb === 'Restart' ? 'Restarting' : 'Quitting') + ' stops it. It goes back to the Merge queue and starts over with Render all.',
      buttons: [verb, 'Keep working'], defaultId: 1, cancelId: 1,
    });
    return response === 0;
  }

  // A new version is in the program folder: the whole app (not the server alone) starts again on it. A running render
  // is asked about first; the draft is not - it is on the disk, and the new run
  // opens it as it was. will-quit stops the server and its ffmpeg as on any quit.
  async function restartApp(win) {
    if (asking || closeConfirmed) return;
    asking = true;
    let go = false;
    try { go = await askRender(win, 'Restart'); } finally { asking = false; }
    if (!go) return;
    log.line('restarting for a new version');
    closeConfirmed = true;
    // Started by the launcher, the launcher starts it again - and switches to a new version on the way.
    if (home && home.restart()) { app.quit(); return; }
    app.relaunch();
    app.quit();
  }

  async function renderRunning() {
    try {
      const r = await fetch(origin + '/api/mv3q', { signal: AbortSignal.timeout(1500) });
      // The queue's own, or any render - Export -> Render runs outside the queue (`busy`, lib/render-busy.js).
      const d = await r.json();
      return !!(d.running || d.busy);
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
      toggleFull(win);
    } else if (code === 'F5' || (mod && code === 'KeyR')) {
      if (input.shift || (mod && code === 'F5')) contents.reloadIgnoringCache();
      else contents.reload();
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
  // Library's cards) cancels the event, and this one does not open. There is no Inspect and no F12:
  // the window has no developer tools at all - a check of the window reaches
  // its pages through --remote-debugging-port.
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

    // Every download asks where to save it. Its progress is shown on the taskbar button.
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
