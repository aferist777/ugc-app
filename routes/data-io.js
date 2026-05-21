'use strict';

// Selective Import/Export. Replaces the all-or-nothing Brain → Backup flow.
// The user picks which categories to bundle, optionally includes biroly video
// files (organized by category folder inside the ZIP), and downloads a single
// archive. Import accepts the same ZIP and restores only what's inside it —
// categories absent from the bundle are left untouched on the target.

const express  = require('express');
const fs       = require('fs');
const path     = require('path');
const crypto   = require('crypto');
const archiver = require('archiver');
const unzipper = require('unzipper');
const multer   = require('multer');
const router   = express.Router();

const { ROOT_DIR, DATA_DIR, UPLOADS_DIR, TEMP_DIR } = require('../lib/config');

const EXPORT_VERSION = 2;

// Each category declares its filesystem footprint. `dirs` are subtrees of
// binary assets (images/videos); `files` are JSON registries with declared
// merge strategies. On import:
//   - Files inside `dirs` are MERGED into the target — existing files stay
//     untouched, missing files are copied in from the ZIP. No wipe.
//   - JSON registries are merged according to their `mergeMode`:
//       'union-by-id'   — arrays of {id,...} entries, dedupe on id (local wins)
//       'biroly'        — { cats: union-by-id, slots: keyed merge, archive: union-by-id }
//       'shallow-merge' — plain objects, local keys win (preserves fresh local data)
//       'replace'       — fall-through default (used by simple settings dumps)
const CATEGORIES = {
  characters:     { label: 'Characters',        dirs: ['characters'],   jsons: [] },
  lookbooks:      { label: 'Lookbooks',         dirs: ['lookbooks'],    jsons: [] },
  environments:   { label: 'Environments',      dirs: ['environments'], jsons: [] },
  // Looks ('Obrazы') bundles each saved obraz's dedicated folder (look-image
  // + pose variations) AND the obrazy.json registry. Self-contained: partner
  // can import Looks without also importing Characters and still see every
  // obraz with its variations.
  looks:          { label: 'Obrazы (looks)',    dirs: ['obrazy'],       jsons: [{ path: 'data/obrazy.json',       mergeMode: 'union-by-id' }] },
  scenes:         { label: 'Scenes',            dirs: ['scenes'],       jsons: [{ path: 'data/scenes.json',       mergeMode: 'union-by-id' }] },
  refs:           { label: 'Refs',              dirs: ['refs'],         jsons: [{ path: 'data/refs.json',         mergeMode: 'union-by-id' }] },
  props:          { label: 'Props (Detail)',    dirs: ['details'],      jsons: [{ path: 'data/details-meta.json', mergeMode: 'union-by-id' }] },
  hooks:          { label: 'Hooks',             dirs: ['hooks'],        jsons: [{ path: 'data/hooks-archive.json', mergeMode: 'union-by-id' }] },
  scenarios:      { label: 'Scenarios',         dirs: ['scenarios'],    jsons: [] },
  biroly:         { label: 'Birols (slots + categories)', dirs: [], jsons: [{ path: 'data/biroly.json',           mergeMode: 'biroly' }] },
  projects:       { label: 'Projects',          dirs: [],               jsons: [{ path: 'data/projects.json',     mergeMode: 'union-by-id' }] },
  settings:       { label: 'Settings + API keys (⚠ contains secrets)', dirs: [], jsons: [{ path: 'data/settings.json', mergeMode: 'shallow-merge' }] },
};

// ── JSON merge strategies — dedupe / additive semantics for import ───────────
// Goal: a re-import of a previous export must NEVER produce duplicates, and
// must never wipe entries the user added locally after the export was taken.
// "Local wins on conflict" is the consistent rule across all modes.
function _mergeJson(existing, incoming, mode) {
  if (mode === 'union-by-id') {
    const out = [];
    const seen = new Set();
    const _push = (item) => {
      if (!item || item.id == null) return;
      if (seen.has(item.id)) return;
      seen.add(item.id);
      out.push(item);
    };
    if (Array.isArray(existing)) existing.forEach(_push);
    if (Array.isArray(incoming)) incoming.forEach(_push);
    return out;
  }
  if (mode === 'biroly') {
    const e = existing && typeof existing === 'object' ? existing : {};
    const i = incoming && typeof incoming === 'object' ? incoming : {};
    return {
      cats:    _mergeJson(e.cats || [],    i.cats || [],    'union-by-id'),
      slots:   { ...(i.slots || {}), ...(e.slots || {}) }, // local slot wins on key conflict
      archive: _mergeJson(e.archive || [], i.archive || [], 'union-by-id'),
    };
  }
  if (mode === 'shallow-merge') {
    const e = existing && typeof existing === 'object' ? existing : {};
    const i = incoming && typeof incoming === 'object' ? incoming : {};
    return { ...i, ...e }; // local wins on key conflict
  }
  // default: replace
  return incoming;
}

router.get('/data/categories', (_req, res) => {
  // Frontend uses this to render the Export checkboxes — keeps the labels in one place.
  const list = Object.entries(CATEGORIES).map(([key, c]) => ({ key, label: c.label }));
  res.json({ success: true, categories: list, version: EXPORT_VERSION });
});

// ── POST /api/data/export ─────────────────────────────────────────────────────
// Body: { categories: string[], includeBirolyVideos?: boolean }
router.post('/data/export', express.json({ limit: '1mb' }), (req, res) => {
  const requested = Array.isArray(req.body?.categories) ? req.body.categories : [];
  const includeBirolyVideos = !!req.body?.includeBirolyVideos;
  const cats = requested.filter(c => CATEGORIES[c]);
  if (!cats.length) return res.status(400).json({ success: false, error: 'no valid categories selected' });

  const ts = new Date();
  const pad = n => String(n).padStart(2, '0');
  const stamp = `${ts.getFullYear()}${pad(ts.getMonth() + 1)}${pad(ts.getDate())}-${pad(ts.getHours())}${pad(ts.getMinutes())}`;
  const filename = `ugc-data-${stamp}.zip`;

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

  const archive = archiver('zip', { zlib: { level: 6 } });
  archive.on('warning', w => console.warn('[data-export] archiver warning:', w.message));
  archive.on('error',   e => { console.error('[data-export]', e); try { res.end(); } catch {} });
  archive.pipe(res);

  const manifest = {
    version: EXPORT_VERSION,
    exportedAt: ts.toISOString(),
    categories: cats,
    includeBirolyVideos,
  };
  archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });

  for (const key of cats) {
    const c = CATEGORIES[key];
    for (const d of c.dirs) {
      const abs = path.join(ROOT_DIR, d);
      if (fs.existsSync(abs)) archive.directory(abs, d);
    }
    for (const j of c.jsons) {
      const abs = path.join(ROOT_DIR, j.path);
      if (fs.existsSync(abs)) archive.file(abs, { name: j.path });
    }
  }

  // Optional: pack biroly video files referenced by archive entries, grouped
  // by category. The actual files still live flat in uploads/, but the ZIP
  // structure preserves their categorical grouping so the user can see what's
  // bundled, and the importer's biroly.json metadata reconnects them on the
  // other side.
  if (includeBirolyVideos && cats.includes('biroly')) {
    let state = null;
    try { state = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'biroly.json'), 'utf8')); } catch {}
    if (state && Array.isArray(state.archive)) {
      let packed = 0;
      for (const item of state.archive) {
        if (!item.videoPath) continue;
        const rel  = item.videoPath.replace(/^\//, '');
        const abs  = path.join(ROOT_DIR, rel);
        if (!fs.existsSync(abs)) continue;
        const catId   = item.categoryId || '_uncategorized';
        const baseName = path.basename(rel);
        archive.file(abs, { name: `uploads/biroly/${catId}/${baseName}` });
        // Also include the paired thumbnail/preview image if present
        if (item.imagePath) {
          const imgRel = item.imagePath.replace(/^\//, '');
          const imgAbs = path.join(ROOT_DIR, imgRel);
          if (fs.existsSync(imgAbs)) {
            archive.file(imgAbs, { name: `uploads/biroly/${catId}/${path.basename(imgRel)}` });
          }
        }
        packed++;
      }
      console.log(`[data-export] packed ${packed} biroly videos by category`);
    }
  }

  console.log(`[data-export] streaming ${filename} (cats=${cats.join(',')}, biroly_videos=${includeBirolyVideos})`);
  archive.finalize();
});

// ── Async import — same job-id polling pattern as the old backup route ───────
const _importJobs = {};
const _JOB_TTL_MS = 5 * 60 * 1000;

if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });
const upload = multer({
  dest: TEMP_DIR,
  limits: { fileSize: 20 * 1024 * 1024 * 1024 },
});

router.post('/data/import', upload.single('file'), (req, res) => {
  if (!req.file) return res.json({ success: false, error: 'no file uploaded' });
  const zipPath = req.file.path;
  const jobId = crypto.randomBytes(8).toString('hex');

  _importJobs[jobId] = {
    status: 'running', filesWritten: 0, totalFiles: 0,
    error: null, manifest: null, startedAt: Date.now(),
  };
  res.json({ success: true, jobId });

  (async () => {
    const job = _importJobs[jobId];
    try {
      const directory = await unzipper.Open.file(zipPath);

      // Read manifest
      let manifest = null;
      for (const entry of directory.files) {
        if (entry.path === 'manifest.json') {
          manifest = JSON.parse((await entry.buffer()).toString('utf8'));
          break;
        }
      }
      if (!manifest) throw new Error('manifest.json missing — not a valid export bundle');
      const exportedCats = Array.isArray(manifest.categories) ? manifest.categories : [];

      // Build the set of (directory prefix) and (exact JSON path → mergeMode)
      // entries that belong to the categories declared in the manifest. Anything
      // else in the ZIP is ignored — protects against accidental cross-category clobber.
      const dirPrefixes  = new Set();
      const jsonByPath   = new Map(); // path → mergeMode
      for (const cat of exportedCats) {
        const c = CATEGORIES[cat];
        if (!c) continue;
        c.dirs.forEach(d => dirPrefixes.add(d.endsWith('/') ? d : d + '/'));
        c.jsons.forEach(j => jsonByPath.set(j.path, j.mergeMode));
      }
      const allowBirolyVideos = exportedCats.includes('biroly') && manifest.includeBirolyVideos;
      if (allowBirolyVideos) dirPrefixes.add('uploads/biroly/');

      const rootResolved = path.resolve(ROOT_DIR);
      const extractable = directory.files.filter(entry => {
        if (entry.type === 'Directory') return false;
        if (entry.path === 'manifest.json') return false;
        const normalized = entry.path.replace(/\\/g, '/');
        if (jsonByPath.has(normalized)) return true;
        for (const prefix of dirPrefixes) {
          if (normalized.startsWith(prefix)) return true;
        }
        return false;
      });
      job.totalFiles = extractable.length;

      // ── Process each ZIP entry ─────────────────────────────────────────────
      // Behaviour: ADDITIVE, never destructive.
      //   - Binary files inside dirs: skip if a file with the same path already
      //     exists locally (preserves any local-only additions, never overwrites).
      //   - JSON registries: apply the category's mergeMode to dedupe by id /
      //     keep local entries on conflict.
      //   - Biroly videos: ZIP groups them by category (uploads/biroly/<cat>/),
      //     but extract back to flat uploads/<filename> so the videoPath stored
      //     in biroly.json archive entries still resolves correctly.

      for (const entry of extractable) {
        let outRel = entry.path.replace(/\\/g, '/');
        if (allowBirolyVideos && outRel.startsWith('uploads/biroly/')) {
          const filename = outRel.split('/').pop();
          outRel = 'uploads/' + filename;
        }
        const out = path.join(ROOT_DIR, outRel);
        if (!path.resolve(out).startsWith(rootResolved + path.sep) && path.resolve(out) !== rootResolved) {
          continue; // zip-slip defence
        }

        // JSON registry → merge with existing
        if (jsonByPath.has(outRel)) {
          const mergeMode = jsonByPath.get(outRel);
          const incomingBuf = await entry.buffer();
          let incoming = null;
          try { incoming = JSON.parse(incomingBuf.toString('utf8')); }
          catch (e) { console.warn(`[data-import] skip ${outRel}: invalid JSON`); job.filesWritten++; continue; }
          let existing = null;
          if (fs.existsSync(out)) {
            try { existing = JSON.parse(fs.readFileSync(out, 'utf8')); } catch {}
          }
          const merged = _mergeJson(existing, incoming, mergeMode);
          fs.mkdirSync(path.dirname(out), { recursive: true });
          fs.writeFileSync(out, JSON.stringify(merged, null, 2), 'utf8');
          job.filesWritten++;
          continue;
        }

        // Binary file → skip if already exists, else copy
        if (fs.existsSync(out)) { job.filesWritten++; continue; }
        fs.mkdirSync(path.dirname(out), { recursive: true });
        await new Promise((resolve, reject) => {
          entry.stream()
            .pipe(fs.createWriteStream(out))
            .on('finish', resolve)
            .on('error',  reject);
        });
        job.filesWritten++;
      }

      try { fs.unlinkSync(zipPath); } catch {}
      job.status = 'done';
      job.manifest = manifest;
      console.log(`[data-import] ${job.filesWritten}/${job.totalFiles} files, cats=${exportedCats.join(',')}`);
    } catch (err) {
      try { fs.unlinkSync(zipPath); } catch {}
      job.status = 'failed';
      job.error = err.message;
      console.error('[data-import]', err.message);
    } finally {
      setTimeout(() => { delete _importJobs[jobId]; }, _JOB_TTL_MS);
    }
  })();
});

router.get('/data/import-progress/:jobId', (req, res) => {
  const jobId = String(req.params.jobId || '').replace(/[^a-f0-9]/gi, '');
  const job = _importJobs[jobId];
  if (!job) return res.json({ success: false, error: 'job not found or expired' });
  res.json({
    success: true,
    status: job.status,
    filesWritten: job.filesWritten,
    totalFiles: job.totalFiles,
    error: job.error,
    manifest: job.status === 'done' ? job.manifest : null,
  });
});

module.exports = router;
