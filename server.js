'use strict';

require('dotenv').config();

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
  ENVIRONMENTS_DIR, ARCHIVE_DIR, DETAILS_DIR, SCENES_DIR, TEMP_DIR, REFS_DIR, FINALS_DIR,
  ARCHIVE_SUBDIRS,
} = require('./lib/config');
const { generateMissingThumbs } = require('./lib/helpers');
const { resolveAll: recoverPendingTasks } = require('./lib/pending-tasks');

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(express.json({ limit: '15mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads',      express.static(UPLOADS_DIR));
app.use('/lookbooks',    express.static(LOOKBOOKS_DIR));
app.use('/characters',   express.static(CHARACTERS_DIR));
app.use('/environments', express.static(ENVIRONMENTS_DIR));
app.use('/archive',      express.static(ARCHIVE_DIR));
app.use('/details',      express.static(DETAILS_DIR));
app.use('/scenes',       express.static(SCENES_DIR));
app.use('/temp_files',   express.static(TEMP_DIR));
app.use('/refs',         express.static(REFS_DIR));
app.use('/finals',       express.static(FINALS_DIR));

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

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`╔════════════════════════════════════════╗`);
  console.log(`║  UGC Character Generator               ║`);
  console.log(`║  http://localhost:${PORT}                 ║`);
  console.log(`╚════════════════════════════════════════╝`);

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
});
