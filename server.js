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

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));
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

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api', require('./routes/generate'));
app.use('/api', require('./routes/lookbook'));
app.use('/api', require('./routes/gallery'));
app.use('/api', require('./routes/scenarios'));
app.use('/api', require('./routes/misc'));
app.use('/api', require('./routes/prompts'));
app.use('/api', require('./routes/scene'));
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
app.use('/api', require('./routes/data-io'));

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
  console.log(`╚════════════════════════════════════════╝`);

  // Defer heavy startup tasks so server is responsive immediately
  setTimeout(() => {
    // Generate missing thumbnails for all image directories in the background
    const archiveDirs = ARCHIVE_SUBDIRS.map(s => path.join(ARCHIVE_DIR, s));
    generateMissingThumbs([
      CHARACTERS_DIR, LOOKBOOKS_DIR, ENVIRONMENTS_DIR,
      UPLOADS_DIR, DETAILS_DIR,
      ...archiveDirs,
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
