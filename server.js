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
  ENVIRONMENTS_DIR, ARCHIVE_DIR, DETAILS_DIR,
  ARCHIVE_SUBDIRS,
} = require('./lib/config');
const { generateMissingThumbs } = require('./lib/helpers');

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(express.json({ limit: '15mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads',      express.static(UPLOADS_DIR));
app.use('/lookbooks',    express.static(LOOKBOOKS_DIR));
app.use('/characters',   express.static(CHARACTERS_DIR));
app.use('/environments', express.static(ENVIRONMENTS_DIR));
app.use('/archive',      express.static(ARCHIVE_DIR));
app.use('/details',      express.static(DETAILS_DIR));

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api', require('./routes/generate'));
app.use('/api', require('./routes/lookbook'));
app.use('/api', require('./routes/gallery'));
app.use('/api', require('./routes/scenarios'));
app.use('/api', require('./routes/misc'));
app.use('/api', require('./routes/prompts'));

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
});
