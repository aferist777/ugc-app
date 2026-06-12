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
  ENVIRONMENTS_DIR, ARCHIVE_DIR, DETAILS_DIR, SCENES_DIR, TEMP_DIR, TEMP_PUBLIC_DIR, OBRAZY_DIR, REFS_DIR, FINALS_DIR, HOOKS_DIR, VSL_DIR,
  ARCHIVE_SUBDIRS,
} = require('./lib/config');
const { runMigrationIfNeeded } = require('./lib/obrazy-store');
const { generateMissingThumbs } = require('./lib/helpers');
const { resolveAll: recoverPendingTasks } = require('./lib/pending-tasks');

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(express.json({ limit: '50mb' }));
// Root → the Character page (each tab is its own URL; Phase 5c). Must precede
// express.static so it isn't pre-empted by the default index.html.
app.get('/', (_req, res) => res.redirect('/character'));
// App shell assets (HTML/JS/CSS in public/) must REVALIDATE every load so a deploy
// never serves a stale page-router/tabs script mixed with new HTML (which broke
// tab navigation after the per-tab split). 'no-cache' = use ETag/Last-Modified to
// revalidate: unchanged files return a cheap 304, changed files return fresh 200.
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res) => { res.setHeader('Cache-Control', 'no-cache'); },
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
app.use('/vsl',          express.static(VSL_DIR));

// ── Tab pages (shared shell, Phase 5c) ──────────────────────────────────────
// Each tab has its own URL. All serve the single public/index.html; the client
// (public/js/page-router.js) then deep-links to the matching tab. Relative asset
// URLs stay correct because index.html declares <base href="/">.
// Each tab is its own standalone page (trimmed scripts). index.html remains as the
// legacy shell/reference but is no longer routed.
const PAGE_FILES = { '/character': 'character.html', '/scenarios': 'scenarios.html', '/edit': 'edit.html', '/merge': 'merge.html', '/birols': 'birols.html', '/facebook': 'facebook.html' };
Object.entries(PAGE_FILES).forEach(([route, file]) =>
  app.get(route, (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache');   // always revalidate the tab HTML
    res.sendFile(path.join(__dirname, 'public', file));
  })
);

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
app.use('/api', require('./routes/scenarios'));
app.use('/api', require('./routes/misc'));
app.use('/api', require('./routes/prompts'));
app.use('/api', require('./routes/temp'));
app.use('/api', require('./routes/asset-interact'));
app.use('/api', require('./routes/settings'));
app.use('/api', require('./routes/custom-options'));
app.use('/api', require('./routes/refs'));
app.use('/api', require('./routes/audio'));
app.use('/api', require('./routes/ffmpeg'));
app.use('/api', require('./routes/finals'));
app.use('/api', require('./routes/hooks'));
app.use('/api', require('./routes/userdata'));
app.use('/api', require('./routes/biroly'));
app.use('/api', require('./routes/hooks-state'));
app.use('/api', require('./routes/obrazy'));
app.use('/api', require('./routes/char-store'));
app.use('/api', require('./routes/scenarios-v2'));
app.use('/api', require('./routes/data-io'));
app.use('/api', require('./routes/gen-timings'));
app.use('/api', require('./routes/edit'));
app.use('/api', require('./routes/facebook'));
app.use('/api', require('./routes/vsl'));

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

    // Recover any unfinished generation tasks from previous session
    recoverPendingTasks()
      .then(recovered => {
        if (recovered.length)
          console.log(`[pending-tasks] recovered ${recovered.length} task(s) on startup`);
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
