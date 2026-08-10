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
  // Characters bundle the image dir + the actor records AND the ElevenLabs voice
  // catalog they reference, so an imported character keeps its portraits + voice.
  characters:     { label: 'Characters (+ voices)', dirs: ['characters'], jsons: [
                      { path: 'data/characters.json',    mergeMode: 'union-by-id' },
                      { path: 'data/custom-voices.json', mergeMode: 'union-by-id' },
                    ] },
  lookbooks:      { label: 'Lookbooks',         dirs: ['lookbooks'],    jsons: [] },
  environments:   { label: 'Environments',      dirs: ['environments'], jsons: [] },
  // Looks ('Obrazы') bundles each saved obraz's dedicated folder (look-image
  // + pose variations) AND the obrazy.json registry. Self-contained: partner
  // can import Looks without also importing Characters and still see every
  // obraz with its variations.
  looks:          { label: 'Obrazы (looks)',    dirs: ['obrazy'],       jsons: [{ path: 'data/obrazy.json',       mergeMode: 'union-by-id' }] },
  // Scene DATA now lives in refs.json (category:'scene'); only legacy scene
  // images remain in the scenes/ dir (data/scenes.json was never written).
  scenes:         { label: 'Scenes (legacy images)', dirs: ['scenes'],  jsons: [] },
  refs:           { label: 'Refs',              dirs: ['refs'],         jsons: [{ path: 'data/refs.json',         mergeMode: 'union-by-id' }] },
  // details-meta.json is an OBJECT keyed by filename (no per-entry id) → shallow-merge,
  // NOT union-by-id (which would wipe it to []).
  props:          { label: 'Props (Detail)',    dirs: ['details'],      jsons: [{ path: 'data/details-meta.json', mergeMode: 'shallow-merge' }] },
  // Scenarios: legacy .txt dir + the per-file meta (object keyed by filename →
  // shallow-merge). The v2 scenario store is gone (Ph13.5); the v3 library is
  // data/scen3-scenarios.json and is not part of this bundle yet.
  scenarios:      { label: 'Scenarios',         dirs: ['scenarios'],    jsons: [
                      { path: 'data/scenarios-meta.json', mergeMode: 'shallow-merge' },
                    ] },
  biroly:         { label: 'Birols (archive + categories + config)', dirs: [], jsons: [
                      { path: 'data/biroly.json',                 mergeMode: 'biroly' },
                      { path: 'data/biroly-vertical-config.json', mergeMode: 'shallow-merge' },  // object keyed by vertical id
                      { path: 'data/biroly-idea-examples.json',   mergeMode: 'union-by-id' },
                    ] },
  // Suno music library (array of {id}) + the referenced mp3s (packed below).
  music:          { label: 'Music library (Suno)', dirs: [], jsons: [{ path: 'data/suno-lib.json', mergeMode: 'union-by-id' }] },
  // Geni gallery (generation history). Entries have NO id — dedupe by `path`.
  geni:           { label: 'Geni gallery (generation history)', dirs: [], jsons: [{ path: 'data/geni.json', mergeMode: 'union-by-path' }] },
  // Edit/Merge workspace: project sessions + the merge timeline (segmentTrim,
  // speeds, inserts, music clips, excluded segments). Metadata only — the
  // per-session rendered mixes under uploads/edit are large (often GBs) and
  // re-renderable, so they are NOT bundled by default (keeps the ZIP sane); the
  // timeline's suno mp3s travel when the Music category is also selected. Uses a
  // dedicated keyed merge (see _mergeJson 'edit-state').
  edit:           { label: 'Edit/Merge projects (sessions + timeline)', dirs: [], jsons: [{ path: 'data/edit-state.json', mergeMode: 'edit-state' }] },
  projects:       { label: 'Projects (Character tab)', dirs: [], jsons: [{ path: 'data/projects.json', mergeMode: 'union-by-id' }] },
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
  if (mode === 'union-by-path') {
    // Like union-by-id but keyed on `path` (geni gallery entries have no id).
    const out = [];
    const seen = new Set();
    const _push = (item) => {
      if (!item || item.path == null) return;
      if (seen.has(item.path)) return;
      seen.add(item.path);
      out.push(item);
    };
    if (Array.isArray(existing)) existing.forEach(_push);
    if (Array.isArray(incoming)) incoming.forEach(_push);
    return out;
  }
  if (mode === 'edit-state') {
    // edit-state.json = { version, updatedAt, sessions:{key:rec}, workspace:{ls:{}}, settings:{} }.
    // sessions + ls keys: local wins, incoming adds missing. timeline_data_v2 is a single
    // JSON string of { sessionKey: edits } — deep-merge per session key (local wins).
    const e = (existing && typeof existing === 'object') ? existing : {};
    const i = (incoming && typeof incoming === 'object') ? incoming : {};
    const eLs = (e.workspace && e.workspace.ls) || {};
    const iLs = (i.workspace && i.workspace.ls) || {};
    const ls = { ...iLs, ...eLs };
    try {
      const eTl = eLs.timeline_data_v2 ? JSON.parse(eLs.timeline_data_v2) : null;
      const iTl = iLs.timeline_data_v2 ? JSON.parse(iLs.timeline_data_v2) : null;
      if (eTl || iTl) ls.timeline_data_v2 = JSON.stringify({ ...(iTl || {}), ...(eTl || {}) });
    } catch {}
    return {
      version:   Math.max(Number(e.version) || 0, Number(i.version) || 0) + 1,
      updatedAt: e.updatedAt || i.updatedAt || null,
      sessions:  { ...(i.sessions || {}), ...(e.sessions || {}) },
      workspace: { ...(i.workspace || {}), ...(e.workspace || {}), ls },
      settings:  { ...(i.settings || {}), ...(e.settings || {}) },
    };
  }
  // default: replace
  return incoming;
}

router.get('/data/categories', (_req, res) => {
  // Frontend uses this to render the Export checkboxes — keeps the labels in one place.
  const list = Object.entries(CATEGORIES).map(([key, c]) => ({ key, label: c.label }));
  res.json({ success: true, categories: list, version: EXPORT_VERSION });
});

// ── GET /api/data/stats — per-category item counts + byte sizes ───────────────
// Lets the Export popup show "N items · X MB" per category and a live total.
// baseBytes = what always ships when the category is selected (jsons + dirs, and
// for music the referenced mp3s). mediaBytes = extra files only packed on opt-in
// (biroly: the archive's video/image/thumb files behind the includeBirolyVideos box).
function _safeStat(abs) { try { return fs.statSync(abs); } catch { return null; } }
function _readJsonSafe(abs) { try { return JSON.parse(fs.readFileSync(abs, 'utf8')); } catch { return null; } }
function _dirStats(abs) {
  let bytes = 0, files = 0;
  const walk = (p) => {
    let st; try { st = fs.statSync(p); } catch { return; }
    if (st.isFile()) { bytes += st.size; files++; return; }
    if (!st.isDirectory()) return;
    let names = []; try { names = fs.readdirSync(p); } catch { return; }
    for (const n of names) walk(path.join(p, n));
  };
  walk(abs);
  return { bytes, files };
}

router.get('/data/stats', (_req, res) => {
  const out = [];
  for (const [key, c] of Object.entries(CATEGORIES)) {
    let items = 0, baseBytes = 0, mediaBytes = 0, countedFromJson = false;

    for (const j of c.jsons) {
      const abs = path.join(ROOT_DIR, j.path);
      const st = _safeStat(abs); if (st) baseBytes += st.size;
      const data = _readJsonSafe(abs);
      if (Array.isArray(data)) { items += data.length; countedFromJson = true; }
      else if (data && typeof data === 'object') {
        if (key === 'biroly' && Array.isArray(data.archive)) { items += data.archive.length; countedFromJson = true; }
        else if (key === 'edit' && data.sessions) { items += Object.keys(data.sessions).length; countedFromJson = true; }
        else { items += Object.keys(data).length; countedFromJson = true; }
      }
    }
    for (const d of c.dirs) {
      const ds = _dirStats(path.join(ROOT_DIR, d));
      baseBytes += ds.bytes;
      if (!countedFromJson) items += ds.files;
    }
    // Music mp3s ship with the category → count as base.
    if (key === 'music') {
      const lib = _readJsonSafe(path.join(DATA_DIR, 'suno-lib.json'));
      if (Array.isArray(lib)) for (const t of lib) {
        if (!t.audioPath) continue;
        const st = _safeStat(path.join(ROOT_DIR, t.audioPath.replace(/^\//, ''))); if (st) baseBytes += st.size;
      }
    }
    // Biroly archive media is opt-in (includeBirolyVideos) → mediaBytes.
    if (key === 'biroly') {
      const b = _readJsonSafe(path.join(DATA_DIR, 'biroly.json'));
      if (b && Array.isArray(b.archive)) for (const it of b.archive) {
        for (const p of [it.videoPath, it.imagePath, it.thumbPath]) {
          if (!p) continue;
          const st = _safeStat(path.join(ROOT_DIR, p.replace(/^\//, ''))); if (st) mediaBytes += st.size;
        }
      }
    }
    out.push({ key, label: c.label, items, baseBytes, mediaBytes });
  }
  res.json({ success: true, categories: out });
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
        // Also include the paired preview image + thumbnail if present.
        for (const p of [item.imagePath, item.thumbPath]) {
          if (!p) continue;
          const pRel = p.replace(/^\//, '');
          const pAbs = path.join(ROOT_DIR, pRel);
          if (fs.existsSync(pAbs)) {
            archive.file(pAbs, { name: `uploads/biroly/${catId}/${path.basename(pRel)}` });
          }
        }
        packed++;
      }
      console.log(`[data-export] packed ${packed} biroly videos by category`);
    }
  }

  // Music library: pack the referenced mp3s so the imported library is playable.
  // Grouped under uploads/suno-lib/; the importer flattens them back to uploads/.
  if (cats.includes('music')) {
    let lib = null;
    try { lib = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'suno-lib.json'), 'utf8')); } catch {}
    if (Array.isArray(lib)) {
      let packed = 0;
      for (const t of lib) {
        if (!t.audioPath) continue;
        const rel = t.audioPath.replace(/^\//, '');
        const abs = path.join(ROOT_DIR, rel);
        if (!fs.existsSync(abs)) continue;
        archive.file(abs, { name: `uploads/suno-lib/${path.basename(rel)}` });
        packed++;
      }
      console.log(`[data-export] packed ${packed} suno music tracks`);
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
      const allowMusic = exportedCats.includes('music');
      if (allowMusic) dirPrefixes.add('uploads/suno-lib/');   // mp3s; flattened back to uploads/ below

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
          outRel = 'uploads/' + outRel.split('/').pop();    // flatten biroly assets back to uploads/
        } else if (allowMusic && outRel.startsWith('uploads/suno-lib/')) {
          outRel = 'uploads/' + outRel.split('/').pop();    // flatten suno mp3s back to uploads/
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

      // If the Edit/Merge workspace was imported, drop the in-memory edit-state
      // cache so the next GET /api/edit-state serves the merged file (the client
      // reloads after import and re-hydrates from it).
      if (exportedCats.includes('edit')) {
        try { require('./edit').resetStateCache?.(); } catch (e) { console.warn('[data-import] edit cache reset failed:', e.message); }
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
