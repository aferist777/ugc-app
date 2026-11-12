'use strict';

// The library folder is settled before anything else (lib/config.js), so a .env kept in it is
// read before any module looks at process.env.
require('dotenv').config({ path: require('path').join(require('./lib/config').ROOT_DIR, '.env') });

process.on('unhandledRejection', (reason) => {
  console.error('[CRASH] Unhandled Rejection:', reason?.stack || reason);
});
process.on('uncaughtException', (err) => {
  console.error('[CRASH] Uncaught Exception:', err.stack || err);
});

// No sharp (libvips) operation cache. On Windows a cached decode keeps its input file open, and an
// open file cannot be written: a thumbnail made again in place, a preview, a poster over an old
// one all fail with UNKNOWN until the cache happens to let go. Measured - and nothing here decodes
// the same file often enough for the cache to be worth that.
require('sharp').cache(false);

const express = require('express');
const path    = require('path');
const fs      = require('fs');

// Outgoing HTTPS checks certificates - Node's default, left alone on purpose. The server version
// switched the check off for every axios call (to get past a corporate proxy's SSL inspection),
// and every one of those calls carries an API key.

const app  = express();
const PORT = process.env.PORT || 3000;

const {
  ROOT_DIR, MEDIA_DIR, PROJECTS_DIR, MEDIA, CACHE_DIR,
  LOOKBOOKS_DIR, CHARACTERS_DIR, ENVIRONMENTS_DIR,
} = require('./lib/config');
// (phase V83, block B0) A library a NEWER program wrote is not opened - in words, before anything reads a store, with
// the exit code the desktop shell knows (lib/library-format.js). Then, the first time another program version opens
// it, its stores go into one zip in backups/ before the start steps below may rewrite them.
const LIB_FORMAT = require('./lib/library-format');
const PROGRAM = require('./lib/app-version').current();
{
  const refused = LIB_FORMAT.check(ROOT_DIR, PROGRAM);
  if (refused) {
    console.error('[format] ' + refused.message.replace(/\s*\n+\s*/g, ' '));
    process.exit(LIB_FORMAT.EXIT_REFUSED);
  }
  try {
    const s = LIB_FORMAT.snapshot(ROOT_DIR, PROGRAM);
    if (s) console.log(`[format] the stores as they were, before UGC Studio ${PROGRAM.version}: ${s.file} (${s.files} files, ${Math.round(s.bytes / 1024)} KB, ${s.ms} ms)`);
  } catch (e) {
    console.warn('[format] no snapshot of the stores: ' + e.message);
  }
}
// A library from before layout 6 is upgraded before anything reads a store (lib/library-upgrade.js):
// files move into project, shelf and category folders, and the stores follow. Stopped halfway,
// the next start carries on; a failure stops the start rather than open half a library.
try {
  require('./lib/library-upgrade').upgrade(ROOT_DIR, { log: (line) => console.log(line) });
} catch (e) {
  console.error('[upgrade] the library could not be upgraded:', e.stack || e.message);
  process.exit(1);
}
// The format this program writes and the program that opened the library last (lib/library-format.js).
try { LIB_FORMAT.stamp(ROOT_DIR, PROGRAM); } catch (e) { console.warn('[format] the library was not stamped: ' + e.message); }
const { generateMissingThumbs } = require('./lib/helpers');
// The project list and the folders in projects/ agree before anything reads either: a folder
// carried over from another library joins the list, a listed folder that is gone leaves it.
{
  const s = require('./lib/projects-store').sync();
  if (s.added || s.dropped) console.log(`[projects] ${s.added} folder(s) joined the list, ${s.dropped} missing left it`);
  // (phase V33.1) Before the Merge projects: a highlights project's folder holds timelines too.
  const h = require('./lib/highlights-store').sync();
  if (h.added) console.log(`[projects] ${h.added} highlights project folder(s) joined the list`);
  const m = require('./lib/merge-store').sync();
  if (m.added) console.log(`[projects] ${m.added} Merge project folder(s) joined the list`);
  const d = require('./lib/studio3d-store').sync();
  if (d.added) console.log(`[projects] ${d.added} 3D Studio scene folder(s) joined the list`);
}

// ── One person ──────────────────────────────────────────────────────────────
// The desktop app has no sign-in: whoever opens the window is its user. Routes still read
// req.user - a queue entry names who queued it, a trim who made it - so every request carries
// the one local user. lib/ownership.js says why every project answers to them.
const { LOCAL_USER } = require('./lib/ownership');
app.use((req, _res, next) => { req.user = LOCAL_USER; next(); });

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(express.json({ limit: '50mb' }));
// A save from a page opened before a file moved still carries the old address: rewritten here,
// before any route reads the body (lib/moves.js).
app.use('/api', require('./lib/moves').rewriteBodies);
// (the owner 2026-10-22) The app opens on Home. The Character page is gone - making a character is
// the Library's Characters shelf now - and its old address lands there.
app.get('/', (_req, res) => res.redirect('/home'));
app.get('/character', (_req, res) => res.redirect('/library?shelf=characters'));
// The program's own files (public/) REVALIDATE on every load, so an updated page never runs a
// stale script: 'no-cache' uses ETag/Last-Modified - an unchanged file is a cheap 304.
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache'),
}));
// The library: a mount each for projects, media and cache - an address mirrors its folder
// (lib/layout.js). A file asked for where it no longer is gets sent where it went (lib/moves.js).
app.use('/projects',     express.static(PROJECTS_DIR));
app.use('/media',        express.static(MEDIA_DIR));
app.use('/cache',        express.static(CACHE_DIR));
app.use(['/projects', '/media'], require('./lib/moves').redirectMissing);
// JASSUB, libass in the page for the captions' preview (phase K4): laid out by tools/fetch-jassub.js,
// part of the program, not of the library.
app.use('/vendor/jassub', express.static(path.join(__dirname, 'vendor', 'jassub'), {
  setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache'),
}));
// MediaPipe's face detector for the highlights shorts' frame (phase V33.2): laid out by tools/fetch-mediapipe.js.
app.use('/vendor/mediapipe', express.static(path.join(__dirname, 'vendor', 'mediapipe'), {
  setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache'),
}));
// The 3D Studio (PLAN "3D Studio"): three.js from its npm package - the build and the addons (controls, loaders) -
// and the mannequins, motions and furniture laid out by tools/fetch-3d.js.
app.use('/vendor/three/build', express.static(path.join(__dirname, 'node_modules', 'three', 'build'), {
  setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache'),
}));
app.use('/vendor/three/addons', express.static(path.join(__dirname, 'node_modules', 'three', 'examples', 'jsm'), {
  setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache'),
}));
app.use('/vendor/3d', express.static(path.join(__dirname, 'vendor', '3d'), {
  setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache'),
}));
// (phase V34.C) The built-in sound set - SFX -> Built-in: laid out by tools/fetch-sfx.js (V34.B), part of the program.
// Its address is a file's address everywhere (lib/media.js toDisk): a clip on a lane, the render, the missing check.
app.use('/sfx', express.static(require('./lib/media').SFX_DIR, {
  setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache'),
}));
// (phase V65) The built-in patterns, picked in Merge's strip of the main video lane: laid out by tools/fetch-patterns.js,
// part of the program, read only, addressed the same way (lib/media.js toDisk).
app.use('/patterns', express.static(require('./lib/media').PATTERNS_DIR, {
  setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache'),
}));

// ── Pages ───────────────────────────────────────────────────────────────────
// Each tab is its own standalone HTML page at its own URL. Relative asset URLs stay correct via
// <base href="/"> in each page. merge-v3.html keeps the name of the rebuild that replaced the older
// page: renaming it would churn every import path under public/js/ for no gain.
// (The audio lab /lab/audio of V34.D went in V34.F: its chat is the sound window now, its tree the media tree's.)
// (The interface showcase /lab/ui of phase V73 went in V91.)
const PAGE_FILES = { '/home': 'home.html', '/merge': 'merge-v3.html', '/library': 'library.html', '/admin': 'admin.html', '/3d': 'studio3d.html' };
Object.entries(PAGE_FILES).forEach(([route, file]) =>
  app.get(route, (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache');   // always revalidate the tab HTML
    res.sendFile(path.join(__dirname, 'public', file));
  })
);

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api', require('./routes/alerts'));   // the journal of generations behind the Alerts button
app.use('/api', require('./routes/app-update'));   // a new commit in the program folder (phase V23)
app.use('/api', require('./routes/generate'));
app.use('/api', require('./routes/gallery'));
app.use('/api', require('./routes/settings'));
app.use('/api', require('./routes/cloudflare'));   // the one Cloudflare key: R2 and the Telegram receiver (phase TG)
app.use('/api', require('./routes/telegram'));     // the owner's bot: links and media into REFERENCES (phase TG)
app.use('/api', require('./routes/home'));   // what the Home page's blocks read (2026-10-22)
app.use('/api', require('./routes/references'));   // REFERENCES: the posts the bot brought in (phase TG)
app.use('/api', require('./routes/ai-settings'));   // Admin -> AI settings: the agents' ladder (phase V25)
// Narrators — the writing voices behind script generation. Not the TTS voices: a narrator is
// how a script is written, routes/scen3.js owns who reads it aloud.
app.use('/api', require('./routes/narrators'));
// Sources — long videos brought in whole, transcribed, and later mined for topics.
app.use('/api', require('./routes/sources'));
app.use('/api', require('./routes/highlights'));   // a long video into vertical shorts (phase V33.1)
app.use('/api', require('./routes/faces'));   // the faces of a film, counted by the app's hidden window (phase V33.2)
app.use('/api', require('./routes/fx-bake'));   // the effects the page alone draws, baked by the app's hidden window (phase V84)
// The yt-dlp links are read with: its version and its checks for a newer one (phase V27).
app.use('/api', require('./routes/links'));
// Script generation - hooks, script, and saving into the scenarios store.
app.use('/api', require('./routes/scriptgen'));
app.use('/api', require('./routes/music'));   // AUDIO -> Music: a track brought in, Music -> highlights, where a track lies
app.use('/api', require('./routes/audio-gen'));   // generate audio: music and sounds by Suno and ElevenLabs (phase V34.C)
app.use('/api', require('./routes/audio-lib'));   // a piece of a sound, and the online CC0 search (Freesound, else Openverse)
app.use('/api', require('./routes/lyrics'));   // saved lyrics - AUDIO -> Music -> Lyrics (phase V59.1)
app.use('/api', require('./routes/proxies'));
app.use('/api', require('./routes/track-peaks'));   // a sound's peaks for its waveform on Merge's lanes (phase V36)
app.use('/api', require('./routes/userdata'));
app.use('/api', require('./routes/clips'));   // clip upload and poster frames for the Library
app.use('/api', require('./routes/obrazy'));
app.use('/api', require('./routes/char-store'));
// Captions from the sound: the server listens to a project and lays the lines (phase K1).
app.use('/api', require('./routes/mv3-captions'));
app.use('/api', require('./routes/library'));   // the Library: its shelves, the media tree, moving and deleting
app.use('/api', require('./routes/scen3'));   // the scenarios store, and the talking head and voiceover projects
app.use('/api', require('./routes/broll'));   // (phase V62) a voiceover's B-roll engine
app.use('/api', require('./routes/scen3-fchat'));   // a talking head's frames chat (phase V26.5)
app.use('/api', require('./routes/character-v2'));   // making a character: the portrait, read and drawn (Library, New Character)
app.use('/api', require('./routes/keys-health'));   // is each API key alive — asked directly, cached 30 min
app.use('/api', require('./routes/thumbs'));   // one door to a resized image, cached by src+mtime
app.use('/api', require('./routes/images'));   // still pictures: upload, and the record that files one
// Merge - the timeline store. Version-checked: a write quoting a stale version is refused.
app.use('/api', require('./routes/mergev3'));
// A timeline rendered directly, outside the queue - what tools/fx-tiles.js --via asks for.
app.use('/api', require('./routes/mv3b'));
app.use('/api', require('./routes/mv3q'));   // the render queue - Export's Render and Add to queue
// Pictures made INSIDE Merge - its own table of engines, its own strip per project. Separate
// from the character ladders' matrix (lib/img-providers.js) on purpose: the two are free to grow apart.
app.use('/api', require('./routes/mv3-img'));
app.use('/api', require('./routes/mv3-video'));   // the video chat's server (phase V2)
app.use('/api', require('./routes/mv3-catalog'));   // its catalog (cookbook, examples) and the person's presets (phase V4)
app.use('/api', require('./routes/studio3d'));   // the 3D Studio's scenes (PLAN "3D Studio")

// ── Start ─────────────────────────────────────────────────────────────────────
// Loopback only. There is no sign-in any more, so an app listening on every interface would hand
// its API keys and the whole library to anyone on the same network. The window, and the server's
// calls to itself, all use 127.0.0.1.
const server = app.listen(PORT, '127.0.0.1', () => {
  console.log(`[boot] library: ${ROOT_DIR}`);
  { const fake = require('./lib/fake-agg').bootLine(); if (fake) console.log(fake); }
  console.log(`╔════════════════════════════════════════╗`);
  console.log(`║  UGC Studio                            ║`);
  console.log(`║  http://localhost:${PORT}                 ║`);
  console.log(`╚════════════════════════════════════════╝`);

  // Defer heavy startup tasks so server is responsive immediately
  setTimeout(() => {
    // Generate missing thumbnails for all image directories in the background: the asset shelves,
    // every image category folder (media/images/<category>/) and every project's frames/.
    const subdirs = (dir, sub) => {
      try {
        return fs.readdirSync(dir, { withFileTypes: true })
          .filter(d => d.isDirectory() && d.name !== 'thumbs' && d.name !== 'preview')
          .map(d => path.join(dir, d.name, sub || ''))
          .filter(d => { try { return fs.statSync(d).isDirectory(); } catch { return false; } });
      } catch { return []; }
    };
    // Each shelf's archive/ sits inside it (media/<kind>/archive).
    const archiveDirs = [CHARACTERS_DIR, LOOKBOOKS_DIR, ENVIRONMENTS_DIR].map(d => path.join(d, 'archive'));
    // Then the thumbnails still at the server's smaller sizes are made again (once per library),
    // and /api/thumb's cache of an earlier size table is cleared.
    generateMissingThumbs([
      CHARACTERS_DIR, LOOKBOOKS_DIR, ENVIRONMENTS_DIR,
      ...subdirs(MEDIA.images),
      ...subdirs(PROJECTS_DIR, 'frames'),
      ...archiveDirs,
    ]).catch(e => console.warn('[thumbs] startup generation failed:', e.message))
      .then(() => require('./lib/thumb-refresh').run())
      .catch(e => console.warn('[thumbs] refresh failed:', e.message));
    require('./lib/thumbs').sweepOldSizes();

    // (phase V84 block 3, (б3-8)) The baked effects no timeline needs any more go.
    try { require('./lib/fx-bake').sweep(Object.values((require('./lib/merge-store').read() || {}).timelines || {})); }
    catch (e) { console.warn('[fx-bake] sweep failed:', e.message); }
    try { require('./lib/fx-moments').sweep(); } catch (e) { console.warn('[fx-moments] sweep failed:', e.message); }

    // A picture Merge asked for is watched by the server, not by the page - so a watcher is a
    // live loop and cannot survive a restart, while the record of what was asked for is on disk
    // and does. This hands the records their loops back.
    try { require('./lib/mv3-gens').resume(); }
    catch (e) { console.warn('[mv3-gens] could not resume:', e.message); }
    // And the video chat's (phase V2): a clip still being made is followed again, one never asked for fails in words.
    try { require('./lib/mv3-video-gens').resume(); }
    catch (e) { console.warn('[mv3-video] could not resume:', e.message); }
    // (phase V34.C) Suno's lyrics have no Alerts row: the ones still coming are followed again here.
    try { require('./lib/audio-gens').resume(); }
    catch (e) { console.warn('[audio-gens] could not resume:', e.message); }

    // The same for everything in the Alerts journal: a generation the app was closed in the middle
    // of is picked up here, filed when it lands, and the list says so (lib/gen-jobs.js). After the
    // routes have been mounted, so every kind of job is known by now.
    try { require('./lib/gen-jobs').resume(); }
    catch (e) { console.warn('[gen-jobs] could not resume:', e.message); }

    // (phase V23) The old recovery of unfinished tasks is gone: the Alerts rows above see every portrait and sheet
    // through, into the character's folder. Its store is left over in older libraries, and nothing reads it.
    try { require('fs').rmSync(require('path').join(require('./lib/config').DATA_DIR, 'pending-tasks.json'), { force: true }); }
    catch (e) { /* held open: it stays, unread */ }

    // (phase V27) yt-dlp on the nightly channel, kept current: a check now and once a day (lib/ytdlp.js).
    try { require('./lib/ytdlp').startChecks(); }
    catch (e) { console.warn('[yt-dlp] could not start its checks:', e.message); }
    // (phase TG) the owner's Telegram bot: its receiver's folder taken, or Telegram asked, while the app is open.
    try { require('./lib/telegram').start(); }
    catch (e) { console.warn('[telegram] could not start:', e.message); }
    // ...and what it was sent, worked through into REFERENCES (blocks 3-4): what the app closed in the middle of, again.
    try { require('./lib/references-intake').start(); }
    catch (e) { console.warn('[references] could not start:', e.message); }
    // And no login: the YouTube cookie jar is gone (the owner, 2026-10-12). One left in an older library is a live
    // session nothing reads any more - it goes.
    for (const f of ['yt-cookies.txt', 'yt-cookies.json']) {
      try { require('fs').rmSync(require('path').join(require('./lib/config').DATA_DIR, f), { force: true }); }
      catch (e) { /* held open: it stays, unread */ }
    }
  }, 15000); // start 15s after server is ready — keeps server responsive on page load
});

// A port that cannot be had ends the process. Left to the crash handler at the top, the error is
// logged and the process stays up serving nothing - and the desktop shell, which tries another
// port when a start fails, would wait on it instead.
server.on('error', (e) => {
  if (server.listening) { console.error('[server] error:', e.code || e.message); return; }
  console.error(`[boot] cannot listen on 127.0.0.1:${PORT}: ${e.code || e.message}`);
  process.exit(1);
});

// Allow long-running uploads (a large file brought into the library). Node 18+ defaults of
// requestTimeout=300s (5 min) and headersTimeout=60s abort a multi-GB upload
// half-way through. 0 = no timeout.
server.requestTimeout = 0;
server.headersTimeout = 0;
server.keepAliveTimeout = 120_000;
// Multer's busboy parser sets its own read timeout via Node's socket default,
// which inherits from server.timeout — keep it generous too.
server.timeout = 0;
