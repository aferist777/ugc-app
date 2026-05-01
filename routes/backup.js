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

// Top-level dirs included in every bundle. Excluded by request:
//   archive/  — soft-deleted items
//   scenes/   — disabled Scene tab
//   finals/   — heavy rendered .mp4 outputs (re-render from saved Merge projects)
const BACKUP_DIRS = [
  'data',
  'uploads', 'characters', 'lookbooks', 'environments', 'details',
  'refs', 'scenarios', 'hooks',
];

const BACKUP_VERSION = 1;

if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

const upload = multer({
  dest: TEMP_DIR,
  limits: { fileSize: 20 * 1024 * 1024 * 1024 }, // 20 GB
});

// ── Job registry for async import progress ──────────────────────────────────
const _importJobs = {}; // jobId → { status, filesWritten, totalFiles, error, manifest, localStorage }
const _IMPORT_JOB_TTL_MS = 5 * 60 * 1000; // auto-clean after 5 min

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

  // Append data dirs from disk
  let included = 0;
  for (const dir of BACKUP_DIRS) {
    const abs = path.join(ROOT_DIR, dir);
    if (fs.existsSync(abs)) { archive.directory(abs, dir); included++; }
  }

  // Consistency: override LS-mirrored server JSONs (data/obrazy.json, data/projects.json)
  // with values straight from the LS dump. This guarantees the bundle is internally
  // consistent even if the source-machine debouncer hadn't flushed yet.
  try {
    const lsRaw = JSON.parse(fs.readFileSync(lsFile, 'utf8'));
    const _appendLsMirror = (lsKey, zipPath) => {
      const v = lsRaw[lsKey];
      if (typeof v !== 'string') return;
      try {
        const parsed = JSON.parse(v);
        if (Array.isArray(parsed)) {
          archive.append(JSON.stringify(parsed, null, 2), { name: zipPath });
        }
      } catch {}
    };
    _appendLsMirror('obrazy',      'data/obrazy.json');
    _appendLsMirror('projects_v1', 'data/projects.json');
  } catch (e) {
    console.warn('[backup] LS-mirror override failed:', e.message);
  }

  console.log(`[backup] streaming ${filename} (${included}/${BACKUP_DIRS.length} dirs)`);
  archive.finalize();

  // Clean up the LS dump after the response is fully sent (or fails)
  res.on('close', () => { try { fs.unlinkSync(lsFile); } catch {} });
});

// ── POST /api/backup/import — kick off async extraction, return jobId ────────
router.post('/backup/import', upload.single('file'), (req, res) => {
  if (!req.file) return res.json({ success: false, error: 'no file uploaded' });
  const zipPath = req.file.path;
  const jobId = crypto.randomBytes(8).toString('hex');

  _importJobs[jobId] = {
    status: 'running',
    filesWritten: 0,
    totalFiles: 0,
    error: null,
    manifest: null,
    localStorage: null,
    startedAt: Date.now(),
  };

  // Respond immediately so the frontend can begin polling
  res.json({ success: true, jobId });

  // Run extraction in the background
  (async () => {
    const job = _importJobs[jobId];
    try {
      const directory = await unzipper.Open.file(zipPath);

      // ── Pass 1: read manifest + localStorage to validate before destruction
      let manifest = null;
      let lsDump = null;
      for (const entry of directory.files) {
        if (entry.path === 'manifest.json') {
          manifest = JSON.parse((await entry.buffer()).toString('utf8'));
        } else if (entry.path === 'localStorage.json') {
          lsDump = JSON.parse((await entry.buffer()).toString('utf8'));
        }
      }
      if (!manifest) throw new Error('no manifest.json — file is not a valid backup bundle');
      if (manifest.version !== BACKUP_VERSION) {
        throw new Error(`unsupported backup version ${manifest.version} (expected ${BACKUP_VERSION})`);
      }

      // ── Count files for progress (only ones we'll actually extract) ────────
      const rootResolved = path.resolve(ROOT_DIR);
      const extractable = directory.files.filter(entry => {
        if (entry.type === 'Directory') return false;
        if (entry.path === 'manifest.json' || entry.path === 'localStorage.json') return false;
        const topDir = entry.path.split(/[\/\\]/, 1)[0];
        return BACKUP_DIRS.includes(topDir);
      });
      job.totalFiles = extractable.length;

      // ── Pass 2: wipe target dirs (full replace) ─────────────────────────────
      for (const dir of BACKUP_DIRS) {
        const abs = path.join(ROOT_DIR, dir);
        if (fs.existsSync(abs)) fs.rmSync(abs, { recursive: true, force: true });
        fs.mkdirSync(abs, { recursive: true });
      }

      // ── Pass 3: extract files with progress updates ────────────────────────
      for (const entry of extractable) {
        const out = path.join(ROOT_DIR, entry.path);
        // Defence against zip-slip
        if (!path.resolve(out).startsWith(rootResolved + path.sep) && path.resolve(out) !== rootResolved) {
          continue;
        }
        fs.mkdirSync(path.dirname(out), { recursive: true });
        await new Promise((resolve, reject) => {
          entry.stream()
            .pipe(fs.createWriteStream(out))
            .on('finish', resolve)
            .on('error',  reject);
        });
        job.filesWritten++;
      }

      // ── Consistency override: rewrite LS-mirrored server JSONs from LS dump
      // This guarantees that on reload, the IIFE in projects.js / obrazy.js
      // (which reads server JSON and overwrites LS) sees data matching the
      // restored localStorage — preventing the post-reload race that nuked
      // imports last time around.
      const _writeJsonFromLs = (lsKey, relPath) => {
        const raw = lsDump?.[lsKey];
        if (typeof raw !== 'string') return;
        try {
          const parsed = JSON.parse(raw);
          if (!Array.isArray(parsed)) return;
          const abs = path.join(ROOT_DIR, relPath);
          fs.mkdirSync(path.dirname(abs), { recursive: true });
          fs.writeFileSync(abs, JSON.stringify(parsed, null, 2), 'utf8');
          console.log(`[backup] override ${relPath} from LS.${lsKey} (${parsed.length} items)`);
        } catch {}
      };
      _writeJsonFromLs('obrazy',      'data/obrazy.json');
      _writeJsonFromLs('projects_v1', 'data/projects.json');

      try { fs.unlinkSync(zipPath); } catch {}

      job.status = 'done';
      job.manifest = manifest;
      job.localStorage = lsDump || {};
      console.log(`[backup] import done: ${job.filesWritten}/${job.totalFiles} files, manifest=${manifest.exportedAt}`);
    } catch (err) {
      try { fs.unlinkSync(zipPath); } catch {}
      job.status = 'failed';
      job.error = err.message;
      console.error('[backup] import failed:', err.message);
    } finally {
      // Auto-clean job state after TTL
      setTimeout(() => { delete _importJobs[jobId]; }, _IMPORT_JOB_TTL_MS);
    }
  })();
});

// ── GET /api/backup/import-progress?jobId=... — poll status during import ────
router.get('/backup/import-progress', (req, res) => {
  const jobId = String(req.query.jobId || '').replace(/[^a-f0-9]/gi, '');
  const job = _importJobs[jobId];
  if (!job) return res.json({ success: false, error: 'job not found or expired' });
  res.json({
    success: true,
    status: job.status,
    filesWritten: job.filesWritten,
    totalFiles: job.totalFiles,
    error: job.error,
    // Include manifest + LS dump only when done so frontend can finalize restore
    manifest:     job.status === 'done' ? job.manifest : null,
    localStorage: job.status === 'done' ? job.localStorage : null,
  });
});

module.exports = router;
