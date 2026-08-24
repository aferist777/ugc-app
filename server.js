'use strict';

require('dotenv').config();

process.on('unhandledRejection', (reason, promise) => {
  console.error('[CRASH] Unhandled Rejection:', reason?.stack || reason);
});
process.on('uncaughtException', (err) => {
  console.error('[CRASH] Uncaught Exception:', err.stack || err);
});

const express = require('express');
const path    = require('path');
const https   = require('https');
const axios   = require('axios');
const fs      = require('fs');

// Bypass corporate proxy SSL inspection
axios.defaults.httpsAgent = new https.Agent({ rejectUnauthorized: false });

const app  = express();
const PORT = process.env.PORT || 3000;

const {
  UPLOADS_DIR, LOOKBOOKS_DIR, CHARACTERS_DIR,
  ENVIRONMENTS_DIR, ARCHIVE_DIR, DETAILS_DIR, SCENES_DIR, TEMP_DIR, TEMP_PUBLIC_DIR, OBRAZY_DIR, REFS_DIR, FINALS_DIR, HOOKS_DIR,
  ARCHIVE_SUBDIRS,
} = require('./lib/config');
const { runMigrationIfNeeded } = require('./lib/obrazy-store');
const { generateMissingThumbs } = require('./lib/helpers');
const { resolveAll: recoverPendingTasks } = require('./lib/pending-tasks');

// ── Access gate ─────────────────────────────────────────────────────────────
// FIRST, before anything parses a body or serves a file: this app holds live API keys and
// spends real credits, so every route, static asset and /api endpoint sits behind a shared
// password. A successful /login sets a signed session cookie held per browser for SESSION_HOURS
// (default 6), after which the user is logged out and must sign in again. Unset APP_PASSWORD =
// gate off + a loud warning. See lib/access-gate.js and the redaction in routes/settings.js.
require('./lib/access-gate').install(app);

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(express.json({ limit: '50mb' }));
// The trace. install() puts one interceptor on the default axios instance - which every
// outgoing call in this app uses - and the middleware opens the context that interceptor
// checks. Both are no-ops until a request arrives carrying X-CV2-Run, which only the
// Character page sends, so nothing else in the app is recorded or slowed.
//
// AFTER express.json, because the inbound body is the root of each trace and it has to be
// parsed to be read; BEFORE the routes, or their calls would run outside the context.
const cv2trace = require('./lib/cv2-trace');
cv2trace.install();
app.use(cv2trace.middleware);
// Root → the Character page (each tab is its own URL; Phase 5c).
app.get('/', (_req, res) => res.redirect('/character'));
// App shell assets (HTML/JS/CSS in public/) must REVALIDATE every load so a deploy
// never serves a stale page-router/tabs script mixed with new HTML (which broke
// tab navigation after the per-tab split). 'no-cache' = use ETag/Last-Modified to
// revalidate: unchanged files return a cheap 304, changed files return fresh 200.
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    // midnight.css is render-blocking on every tab page and changes rarely; cache it
    // briefly (10 min) so tab-to-tab navigation skips the revalidation round-trip that
    // widened the dark-load window (the anti-FOUC gate already hides the legacy theme).
    if (filePath.endsWith('midnight.css')) res.setHeader('Cache-Control', 'public, max-age=600');
    else res.setHeader('Cache-Control', 'no-cache');
  },
}));
app.use('/uploads',      express.static(UPLOADS_DIR));
app.use('/lookbooks',    express.static(LOOKBOOKS_DIR));
app.use('/characters',   express.static(CHARACTERS_DIR));
app.use('/environments', express.static(ENVIRONMENTS_DIR));
app.use('/archive',      express.static(ARCHIVE_DIR));
app.use('/details',      express.static(DETAILS_DIR));
app.use('/scenes',       express.static(SCENES_DIR));
app.use('/temp_files',   express.static(TEMP_DIR));
app.use('/temp_public',  express.static(TEMP_PUBLIC_DIR));
app.use('/obrazy',       express.static(OBRAZY_DIR));
app.use('/refs',         express.static(REFS_DIR));
app.use('/finals',       express.static(FINALS_DIR));
app.use('/hooks',        express.static(HOOKS_DIR));
// /vsl stays gone (Ph15).

// ── Tab pages (shared shell, Phase 5c) ──────────────────────────────────────
// Each tab has its own URL and is its own standalone HTML page (trimmed scripts);
// the client (public/js/page-router.js) deep-links to the matching tab on load.
// Relative asset URLs stay correct via <base href="/"> in each page.
// /character is the v2 page now. The old one is deleted, not parked: it was 3092 lines of HTML
// plus five scripts nobody else loaded, and keeping a second Character around is how two of
// them drift apart.
// The Merge rebuild is now the only Merge, so it answers at /merge - the plain name, since
// there is nothing left to distinguish it from. The two pages before it, merge.html and
// merge-v2.html, are deleted along with the twenty-one scripts nobody else loaded, for the same
// reason the old Character page was: keeping a second editor around is how two of them drift
// apart. The file is still merge-v3.html; renaming it would churn every import path in
// public/js/merge-v3/ for no gain. /merge-v3, /merge-v2 and /edit redirect here.
const PAGE_FILES = { '/character': 'character-v2.html', '/merge': 'merge-v3.html', '/scenarios': 'scenarios-v3.html', '/library': 'library.html', '/library2': 'library2.html', '/birols': 'birols.html', '/facebook': 'facebook.html', '/studio': 'pose-studio.html' };
Object.entries(PAGE_FILES).forEach(([route, file]) =>
  app.get(route, (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache');   // always revalidate the tab HTML
    res.sendFile(path.join(__dirname, 'public', file));
  })
);
// The Edit tab was removed (Scenarios feeds the Merge timeline now), the two old Merge pages are
// deleted, and /merge-v3 was the rebuild's development address. All three land on /merge, query
// string intact - that is how Scenarios' ?p=<key> handover survives someone using an old URL.
const _q = (req) => (req.originalUrl.includes('?') ? '?' + req.originalUrl.split('?')[1] : '');
app.get('/edit',     (req, res) => res.redirect('/merge' + _q(req)));
app.get('/merge-v3', (req, res) => res.redirect('/merge' + _q(req)));
app.get('/merge-v2', (req, res) => res.redirect('/merge' + _q(req)));
// /scenarios now serves the v3 page (Ph13.4). The old page's sub-modes
// (/scenarios/ugc_ad, /scenarios/dialogues) are gone with it: v3 is one format, chosen
// by the Type field. The v3 development URL redirects so old bookmarks still land.
app.get('/scenarios-v3', (_req, res) => res.redirect('/scenarios'));
// The development URL of the Character rebuild, kept as a redirect for the same reason: it is
// the address every note, bookmark and link from its build still uses.
app.get('/character-v2', (_req, res) => res.redirect('/character'));

// ── AUDIT HARNESS (temporary, diagnostic) ──────────────────────────────────────
// Logs every /api/* request (method, path, body summary, status, duration) and
// receives client-side interaction events from public/js/audit.js, appending
// both to logs/audit.jsonl for terminal inspection during the cleanup walkthrough.
// Remove this whole block + routes/audit.js shim + public/js/audit.js when done.
(() => {
  const LOG_DIR  = path.join(__dirname, 'logs');
  const LOG_FILE = path.join(LOG_DIR, 'audit.jsonl');
  try { fs.mkdirSync(LOG_DIR, { recursive: true }); } catch {}
  const append = (obj) => {
    try { fs.appendFile(LOG_FILE, JSON.stringify(obj) + '\n', () => {}); } catch {}
  };

  // Compact summary of a request body — never log full payloads (images etc.).
  const summarizeBody = (body) => {
    if (body == null || typeof body !== 'object') return undefined;
    const out = {};
    for (const k of Object.keys(body).slice(0, 30)) {
      const v = body[k];
      if (v == null) out[k] = null;
      else if (typeof v === 'string') out[k] = `str(${v.length})`;
      else if (Array.isArray(v)) out[k] = `arr(${v.length})`;
      else if (typeof v === 'object') out[k] = 'obj';
      else out[k] = v; // number / boolean
    }
    return out;
  };

  // Client-side events sink (sendBeacon → JSON { events: [...] }).
  app.post('/api/_devlog', (req, res) => {
    const events = (req.body && Array.isArray(req.body.events)) ? req.body.events : [];
    for (const e of events) append({ src: 'client', ...e, recvTs: Date.now() });
    res.json({ ok: true, n: events.length });
  });

  // Server-side request logger for /api/* (skips the sink itself).
  app.use('/api', (req, res, next) => {
    if (req.path === '/_devlog') return next();
    const t0 = Date.now();
    const bodyKeys = summarizeBody(req.body);
    res.on('finish', () => append({
      src: 'server', kind: 'req', method: req.method, path: req.path,
      status: res.statusCode, ms: Date.now() - t0, body: bodyKeys, ts: t0,
    }));
    next();
  });
})();

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api', require('./routes/generate'));
app.use('/api', require('./routes/lookbook'));
app.use('/api', require('./routes/gallery'));
// routes/scenarios.js — the OLD scenarios backend, unmounted. Its 14 endpoints under
// /api/scenarios* had exactly one caller left, scen-state.js, which is deleted; the v3 page
// keeps its own store. The file stays on disk because it is the only code that still knows the
// layout of the old scenario files and archive under data/ - remount the line to reach them.
// app.use('/api', require('./routes/scenarios'));
app.use('/api', require('./routes/misc'));
app.use('/api', require('./routes/prompts'));
app.use('/api', require('./routes/asset-interact'));
app.use('/api', require('./routes/settings'));
// Narrators — the writing voices behind script generation. Not the TTS voices: a narrator is
// how a script is written, routes/audio.js owns who reads it aloud.
app.use('/api', require('./routes/narrators'));
// Sources — long videos brought in whole, transcribed, and later mined for topics.
app.use('/api', require('./routes/sources'));
// Script generation - hooks, script, the cleaning pass, and saving into the scenarios store.
app.use('/api', require('./routes/scriptgen'));
// Library 2's own API: the shelf counts, and the drafts of scripts still being written.
app.use('/api', require('./routes/library2'));
app.use('/api', require('./routes/custom-options'));
app.use('/api', require('./routes/audio'));
app.use('/api', require('./routes/ffmpeg'));
app.use('/api', require('./routes/finals'));
app.use('/api', require('./routes/hooks'));   // hook upload/delete + the Birols backend
app.use('/api', require('./routes/userdata'));
app.use('/api', require('./routes/biroly'));
app.use('/api', require('./routes/hooks-state'));
app.use('/api', require('./routes/obrazy'));
app.use('/api', require('./routes/char-store'));
// Import / Export. The feature came back, rebuilt: the version this note used to describe
// knew thirteen of the stores this app now has and none of the ones the current pages
// write. The old server half is still in data/backups/ for reference. This one builds the
// archive to a file rather than streaming it, so a broken download resumes instead of
// starting again - the bundle runs to gigabytes.
app.use('/api', require('./routes/data-io'));
app.use('/api', require('./routes/gen-timings'));
app.use('/api', require('./routes/edit'));
app.use('/api', require('./routes/facebook'));
// Timeline word-timing STT — the one piece of the retired VSL backend the creatives
// flow uses (inline-upload subtitles); moved out of routes/vsl.js when VSL went (Ph15).
app.use('/api', require('./routes/stt-timeline'));
app.use('/api', require('./routes/library'));   // Library page — read-only shelves
app.use('/api', require('./routes/scen3'));   // Scenarios v3 — standalone scenario library store
app.use('/api', require('./routes/character-v2'));   // Character v2 — generating from a reference
app.use('/api', require('./routes/keys-health'));   // is each API key alive — asked directly, cached 30 min
app.use('/api', require('./routes/thumbs'));   // one door to a resized image, cached by src+mtime
app.use('/api', require('./routes/images'));   // still pictures: upload, and the record that files one
app.use('/api', require('./routes/video-engines'));   // one door to every i2v engine, whichever aggregator
// Merge v3 - the timeline store. Version-checked: a write quoting a stale version is
// refused, which is the thing timeline_data_v2 could not do.
app.use('/api', require('./routes/mergev3'));
// The blank-project render. Its own file for the same reason it has its own timeline and
// its own preview: nothing it does can reach the scenario renderer.
app.use('/api', require('./routes/mv3b'));
app.use('/api', require('./routes/mv3q'));   // the render queue, shared by both workflows
// Pictures made INSIDE Merge - its own table of engines, its own strip per project. Separate
// from the Character page's matrix on purpose: the two lists are free to grow apart.
app.use('/api', require('./routes/mv3-img'));

// The read, on Merge's own audio lanes. Only the many-lines-at-once call lives here; the
// voice catalogue and the library search are the ones every other page already uses.
app.use('/api', require('./routes/mv3-voice'));

// Clips made inside Merge. The matrix stays where it was - /api/video/engines - because this
// submits against that same table.
app.use('/api', require('./routes/mv3-vid'));

// ── Start ─────────────────────────────────────────────────────────────────────
// Run the one-shot obrazy migration BEFORE we start serving. Idempotent: a
// .obrazy-migrated flag file is dropped on first successful pass so subsequent
// boots are no-ops. Skipping startup until this finishes guarantees that the
// frontend's first /api/userdata/obrazy hit returns the migrated paths.
try { runMigrationIfNeeded(); }
catch (e) { console.error('[obrazy-migrate] error:', e.stack || e.message); }

const server = app.listen(PORT, () => {
  console.log(`╔════════════════════════════════════════╗`);
  console.log(`║  UGC Character Generator               ║`);
  console.log(`║  http://localhost:${PORT}                 ║`);
  console.log(`║  build: replicate-aware /api/status    ║`);
  console.log(`╚════════════════════════════════════════╝`);
  console.log(`[boot] ${new Date().toISOString()} | /api/status dispatches by repl: prefix → Replicate, else → kie.ai`);

  // Defer heavy startup tasks so server is responsive immediately
  setTimeout(() => {
    // Generate missing thumbnails for all image directories in the background
    const archiveDirs = ARCHIVE_SUBDIRS.map(s => path.join(ARCHIVE_DIR, s));
    // Per-project Edit mix folders (uploads/edit/<key>/mixes) hold composited
    // product images shown as thumbnails in the Edit popup — backfill their thumbs.
    let editMixDirs = [];
    try {
      const editRoot = path.join(UPLOADS_DIR, 'edit');
      if (fs.existsSync(editRoot)) {
        editMixDirs = fs.readdirSync(editRoot)
          .map(k => path.join(editRoot, k, 'mixes'))
          .filter(d => { try { return fs.statSync(d).isDirectory(); } catch { return false; } });
      }
    } catch {}
    generateMissingThumbs([
      CHARACTERS_DIR, LOOKBOOKS_DIR, ENVIRONMENTS_DIR,
      UPLOADS_DIR, DETAILS_DIR,
      ...archiveDirs,
      ...editMixDirs,
    ]).catch(e => console.warn('[thumbs] startup generation failed:', e.message));

    // A picture Merge asked for is watched by the server, not by the page - so a watcher is a
    // live loop and cannot survive a restart, while the record of what was asked for is on disk
    // and does. This hands the records their loops back.
    try { require('./lib/mv3-gens').resume(); }
    catch (e) { console.warn('[mv3-gens] could not resume:', e.message); }
    try { require('./lib/mv3-vgens').resume(); }
    catch (e) { console.warn('[mv3-vgens] could not resume:', e.message); }

    // Recover any unfinished generation tasks from previous session
    recoverPendingTasks()
      .then(recovered => {
        if (recovered.length)
          console.log(`[pending-tasks] recovered ${recovered.length} task(s) on startup`);
        // Filed for the Character page as well, or a generation rescued here would be a file
        // on disk that no screen ever mentions - which is the whole failure this net exists
        // to prevent. Character's own recovery call catches the rest; this catches the case
        // where the server restarted before anyone reopened the page.
        try {
          const added = require('./lib/cv2-recovered').note(recovered, new Date().toISOString());
          if (added.length) console.log(`[cv2-recovered] ${added.length} waiting for the Character page`);
        } catch (e) { console.warn('[cv2-recovered] could not file:', e.message); }
      })
      .catch(e => console.warn('[pending-tasks] startup recovery failed:', e.message));
  }, 15000); // start 15s after server is ready — keeps server responsive on page load
});

// Allow long-running uploads (large ZIP imports). Node 18+ defaults of
// requestTimeout=300s (5 min) and headersTimeout=60s abort multi-GB uploads
// over slow upstream links half-way through. 0 = no timeout.
server.requestTimeout = 0;
server.headersTimeout = 0;
server.keepAliveTimeout = 120_000;
// Multer's busboy parser sets its own read timeout via Node's socket default,
// which inherits from server.timeout — keep it generous too.
server.timeout = 0;
