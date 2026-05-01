'use strict';

const express  = require('express');
const fs       = require('fs');
const path     = require('path');
const crypto   = require('crypto');
const archiver = require('archiver');
const unzipper = require('unzipper');
const multer   = require('multer');
const router   = express.Router();

const { ROOT_DIR, TEMP_DIR } = require('../lib/config');

const BACKUP_DIRS = [
  'data',
  'uploads', 'characters', 'lookbooks', 'environments', 'details',
  'refs', 'scenes', 'scenarios',
  'finals', 'hooks', 'archive',
];

const BACKUP_VERSION = 1;

if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

const upload = multer({
  dest: TEMP_DIR,
  limits: { fileSize: 20 * 1024 * 1024 * 1024 }, // 20 GB
});

// ── POST /api/backup/prepare — stash localStorage dump, return a token ───────
router.post('/backup/prepare', express.json({ limit: '50mb' }), (req, res) => {
  const ls = req.body?.localStorage || {};
  const token = crypto.randomBytes(8).toString('hex');
  const file = path.join(TEMP_DIR, `_backup_ls_${token}.json`);
  fs.writeFileSync(file, JSON.stringify(ls, null, 2), 'utf8');
  res.json({ success: true, token });
});

// ── GET /api/backup/download?token=... — stream the ZIP download ─────────────
router.get('/backup/download', (req, res) => {
  const token = String(req.query.token || '').replace(/[^a-f0-9]/gi, '');
  if (!token) return res.status(400).end('token required');
  const lsFile = path.join(TEMP_DIR, `_backup_ls_${token}.json`);
  if (!fs.existsSync(lsFile)) return res.status(404).end('expired token');

  const ts = new Date();
  const pad = n => String(n).padStart(2, '0');
  const stamp = `${ts.getFullYear()}${pad(ts.getMonth() + 1)}${pad(ts.getDate())}-${pad(ts.getHours())}${pad(ts.getMinutes())}`;
  const filename = `ugc-backup-${stamp}.zip`;

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

  const archive = archiver('zip', { zlib: { level: 6 } });
  archive.on('warning', w => console.warn('[backup] archiver warning:', w.message));
  archive.on('error',   e => { console.error('[backup] archiver error:', e); try { res.end(); } catch {} });
  archive.pipe(res);

  const manifest = {
    version: BACKUP_VERSION,
    exportedAt: ts.toISOString(),
    dataDirs: BACKUP_DIRS,
  };
  archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });
  archive.file(lsFile, { name: 'localStorage.json' });

  let included = 0;
  for (const dir of BACKUP_DIRS) {
    const abs = path.join(ROOT_DIR, dir);
    if (fs.existsSync(abs)) { archive.directory(abs, dir); included++; }
  }
  console.log(`[backup] streaming ${filename} (${included}/${BACKUP_DIRS.length} dirs)`);

  archive.finalize();

  // Clean up the LS dump after the response is fully sent (or fails)
  res.on('close', () => { try { fs.unlinkSync(lsFile); } catch {} });
});

// ── POST /api/backup/import — replace local data with the uploaded bundle ────
router.post('/backup/import', upload.single('file'), async (req, res) => {
  if (!req.file) return res.json({ success: false, error: 'no file uploaded' });
  const zipPath = req.file.path;

  try {
    const directory = await unzipper.Open.file(zipPath);

    // ── Pass 1: read manifest + localStorage to validate before destruction ─
    let manifest = null;
    let localStorageDump = null;
    for (const entry of directory.files) {
      if (entry.path === 'manifest.json') {
        const buf = await entry.buffer();
        manifest = JSON.parse(buf.toString('utf8'));
      } else if (entry.path === 'localStorage.json') {
        const buf = await entry.buffer();
        localStorageDump = JSON.parse(buf.toString('utf8'));
      }
    }
    if (!manifest)                  throw new Error('no manifest.json — file is not a valid backup bundle');
    if (manifest.version !== BACKUP_VERSION) throw new Error(`unsupported backup version ${manifest.version} (expected ${BACKUP_VERSION})`);

    // ── Pass 2: wipe target dirs (full replace) ──────────────────────────────
    for (const dir of BACKUP_DIRS) {
      const abs = path.join(ROOT_DIR, dir);
      if (fs.existsSync(abs)) fs.rmSync(abs, { recursive: true, force: true });
      fs.mkdirSync(abs, { recursive: true });
    }

    // ── Pass 3: extract everything else ──────────────────────────────────────
    const rootResolved = path.resolve(ROOT_DIR);
    let filesWritten = 0;
    for (const entry of directory.files) {
      if (entry.type === 'Directory') continue;
      if (entry.path === 'manifest.json' || entry.path === 'localStorage.json') continue;

      // Only allow entries that live inside one of the backup dirs
      const topDir = entry.path.split(/[\/\\]/, 1)[0];
      if (!BACKUP_DIRS.includes(topDir)) continue;

      const out = path.join(ROOT_DIR, entry.path);
      // Defence against zip-slip
      if (!path.resolve(out).startsWith(rootResolved + path.sep) && path.resolve(out) !== rootResolved) continue;

      fs.mkdirSync(path.dirname(out), { recursive: true });
      await new Promise((resolve, reject) => {
        entry.stream()
          .pipe(fs.createWriteStream(out))
          .on('finish', resolve)
          .on('error',  reject);
      });
      filesWritten++;
    }

    try { fs.unlinkSync(zipPath); } catch {}
    console.log(`[backup] import done: ${filesWritten} files restored, manifest=${manifest.exportedAt}`);

    res.json({
      success: true,
      manifest,
      localStorage: localStorageDump || {},
      filesWritten,
    });
  } catch (err) {
    try { fs.unlinkSync(zipPath); } catch {}
    console.error('[backup] import failed:', err.message);
    res.json({ success: false, error: err.message });
  }
});

module.exports = router;
