// Import / Export — taking everything out of this install, and putting it into another.
//
// There was a version of this before (kept at data/backups/2026-08-12-data-io.js.removed). It
// knew thirteen of the thirty-five stores this app now has, and none of the ones the current
// pages actually write: merge timelines, the v3 scenario library, the voice shelf. This is
// that idea rebuilt against what is here today.
//
// THE ARCHIVE IS BUILT TO A FILE, NOT STREAMED. A streamed zip cannot be resumed - every
// broken connection starts the whole thing again, and this bundle runs to gigabytes. Built to
// disk it is served like any other file, which means Range requests, which means a browser or
// `curl -C -` picks up at the byte it stopped on. The file is kept for a day so a retry costs
// nothing.
//
// STORED, NOT DEFLATED. Almost every byte here is already-compressed jpg, mp4 or mp3.
// Compressing them again buys a percent or two and turns a disk-speed copy into minutes of
// CPU. level 0 it is.
const express  = require('express');
const fs       = require('fs');
const path     = require('path');
const crypto   = require('crypto');
const archiver = require('archiver');
const unzipper = require('unzipper');
const multer   = require('multer');

const router = express.Router();
const { ROOT_DIR, DATA_DIR, TEMP_DIR } = require('../lib/config');

const EXPORT_DIR = path.join(DATA_DIR, 'exports');
const KEEP_MS = 24 * 60 * 60 * 1000;
const VERSION = 3;

// ── What can be taken ───────────────────────────────────────────────────────
// Directories are relative to the install root, so the same names address the zip and the
// disk on the way back in. A group is a thing a person would think of as one thing - not a
// directory and not a file, which is why some carry both and some carry several.
//
// `needs` is a dependency, not a hint: a project stores the PATH of its pictures, never the
// pictures. Take the projects without the media and the other machine gets timelines that
// point at nothing at all.
const GROUPS = [
  { id: 'media', label: 'Media library (generated pictures, voice mp3s, clips)',
    dirs: ['uploads'], jsons: [], heavy: true },
  { id: 'finals', label: 'Finished renders',
    dirs: ['finals'], jsons: [], heavy: true },
  { id: 'obrazy', label: 'Looks',
    dirs: ['obrazy'], jsons: ['data/obrazy.json'] },
  { id: 'lookbooks', label: 'Lookbooks',
    dirs: ['lookbooks'], jsons: ['data/scen3-lookbook-meta.json'] },
  { id: 'hooks', label: 'Hooks',
    dirs: ['hooks'], jsons: ['data/hooks-archive.json'] },
  { id: 'characters', label: 'Characters (4K sheets, thumbnails, voices)',
    dirs: ['characters'], jsons: ['data/characters.json', 'data/custom-voices.json', 'data/projects.json'] },
  { id: 'environments', label: 'Locations',
    dirs: ['environments'], jsons: [] },
  { id: 'refs', label: 'References and details',
    dirs: ['refs', 'details'], jsons: ['data/refs.json', 'data/details-meta.json', 'data/images.json', 'data/library-cats.json'] },

  { id: 'merge', label: 'Merge projects (timelines with every overlay)',
    dirs: [], jsons: ['data/merge-v3.json'], needs: ['media'] },
  { id: 'scen3', label: 'Scenarios v3 (library and projects)',
    dirs: [], jsons: ['data/scen3-scenarios.json', 'data/scen3-projects.json', 'data/scen3-poses.json',
                      'data/scen3-moods.json', 'data/scen3-options.json', 'data/scen3-frame-options.json'],
    needs: ['media'] },
  { id: 'voices', label: 'Voice shelf',
    dirs: [], jsons: ['data/voice-shelf.json'], needs: ['media'] },
  { id: 'biroly', label: 'Birols',
    dirs: [], jsons: ['data/biroly.json', 'data/biroly-vertical-config.json', 'data/biroly-idea-examples.json'] },
  { id: 'ui', label: 'Interface state',
    dirs: [], jsons: ['data/ui-state.json'] },
  { id: 'legacy', label: 'Legacy (old scenarios, edit sessions, geni, suno, ugc, vsl)',
    dirs: ['scenarios', 'scenes', 'archive', 'vsl'],
    jsons: ['data/scenarios-meta.json', 'data/scenarios-v2.json', 'data/edit-state.json',
            'data/edit-sessions.json', 'data/geni.json', 'data/suno-lib.json',
            'data/ugc-projects.json', 'data/ugc-ff-timings.json', 'data/gen-timings.json',
            'data/dialogue-ep-timings.json'] },
  // Off by default in the UI. Everything else here is work; this one is credentials.
  { id: 'settings', label: 'Settings and API keys', secret: true,
    dirs: [], jsons: ['data/settings.json'] },
];

// Deliberately absent: temp_files (half a gigabyte of scratch renders that rebuild
// themselves), logs, node_modules, and data/exports itself - an export must never contain
// the last export. pending-tasks.json and biroly-gen-jobs.json are a queue of unfinished
// work; on another machine they describe jobs that will never come back.

const _abs = (rel) => path.join(ROOT_DIR, rel);
const _exists = (rel) => { try { return fs.existsSync(_abs(rel)); } catch { return false; } };

function _dirSize(rel) {
  const root = _abs(rel);
  let bytes = 0, files = 0;
  const walk = (d) => {
    let entries = [];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else { try { bytes += fs.statSync(p).size; files++; } catch {} }
    }
  };
  if (fs.existsSync(root)) walk(root);
  return { bytes, files };
}

function _measure(g) {
  let bytes = 0, files = 0;
  for (const d of g.dirs) { const s = _dirSize(d); bytes += s.bytes; files += s.files; }
  for (const j of g.jsons) {
    if (!_exists(j)) continue;
    try { bytes += fs.statSync(_abs(j)).size; files++; } catch {}
  }
  return { bytes, files };
}

// ── The catalogue, measured on demand ───────────────────────────────────────
router.get('/data/groups', (_req, res) => {
  try {
    const groups = GROUPS.map(g => ({
      id: g.id, label: g.label, secret: !!g.secret, heavy: !!g.heavy, needs: g.needs || [],
      dirs: g.dirs, jsons: g.jsons.filter(_exists),
      ..._measure(g),
    }));
    res.json({ success: true, version: VERSION, groups });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── Building ────────────────────────────────────────────────────────────────
const _jobs = new Map();

function _sweepOld() {
  try {
    if (!fs.existsSync(EXPORT_DIR)) return;
    for (const f of fs.readdirSync(EXPORT_DIR)) {
      const p = path.join(EXPORT_DIR, f);
      try { if (Date.now() - fs.statSync(p).mtimeMs > KEEP_MS) fs.unlinkSync(p); } catch {}
    }
  } catch {}
}

router.post('/data/export', express.json({ limit: '1mb' }), (req, res) => {
  try {
    const asked = Array.isArray((req.body || {}).groups) ? req.body.groups.map(String) : [];
    let picked = GROUPS.filter(g => asked.includes(g.id));
    if (!picked.length) return res.status(400).json({ success: false, error: 'nothing selected' });

    // A dependency is pulled in rather than refused: the alternative is an export that looks
    // complete and restores to empty timelines on the other machine.
    const ids = new Set(picked.map(g => g.id));
    const added = [];
    for (const g of picked) for (const n of (g.needs || [])) {
      if (!ids.has(n)) { ids.add(n); added.push(n); }
    }
    picked = GROUPS.filter(g => ids.has(g.id));

    fs.mkdirSync(EXPORT_DIR, { recursive: true });
    _sweepOld();

    const id = crypto.randomBytes(8).toString('hex');
    const stamp = new Date().toISOString().slice(0, 10);
    const name = `ugc-app-export-${stamp}-${id.slice(0, 6)}.zip`;
    const out = path.join(EXPORT_DIR, id + '.zip');

    const total = picked.reduce((n, g) => n + _measure(g).files, 0);
    const job = { id, name, out, state: 'building', files: 0, total, bytes: 0, error: null, added };
    _jobs.set(id, job);

    const sink = fs.createWriteStream(out);
    const archive = archiver('zip', { zlib: { level: 0 } });   // store, not deflate
    archive.on('entry', () => { job.files++; });
    archive.on('warning', (e) => console.warn('[data-io] warning:', e.message));
    archive.on('error', (e) => { job.state = 'failed'; job.error = e.message; });
    sink.on('close', () => {
      if (job.state === 'failed') return;
      job.bytes = archive.pointer();
      job.state = 'ready';
      console.log(`[data-io] built ${name} — ${(job.bytes / 1e9).toFixed(2)} GB, ${job.files} files`);
    });
    archive.pipe(sink);

    const manifest = {
      version: VERSION,
      app: 'ugc-app',
      takenAt: new Date().toISOString(),
      groups: picked.map(g => ({ id: g.id, label: g.label, dirs: g.dirs, jsons: g.jsons.filter(_exists) })),
    };
    archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });

    for (const g of picked) {
      for (const d of g.dirs) if (_exists(d)) archive.directory(_abs(d), d);
      for (const j of g.jsons) if (_exists(j)) archive.file(_abs(j), { name: j });
    }
    archive.finalize();

    res.json({ success: true, jobId: id, name, pulledIn: added, groups: picked.map(g => g.id) });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.get('/data/export/:id/status', (req, res) => {
  const job = _jobs.get(String(req.params.id));
  if (!job) return res.status(404).json({ success: false, error: 'no such export' });
  let onDisk = 0;
  try { onDisk = fs.statSync(job.out).size; } catch {}
  res.json({
    success: true, state: job.state, name: job.name, error: job.error,
    files: job.files, total: job.total, bytes: job.bytes || onDisk,
  });
});

// The resumable half. sendFile sets Accept-Ranges and answers 206 to a Range request, so a
// download that dies at four gigabytes carries on from four gigabytes.
router.get('/data/export/:id/download', (req, res) => {
  const job = _jobs.get(String(req.params.id));
  if (!job) return res.status(404).send('no such export');
  if (job.state !== 'ready') return res.status(409).send('not finished building');
  res.setHeader('Content-Disposition', `attachment; filename="${job.name}"`);
  res.sendFile(job.out, (err) => {
    // An aborted download is the normal case this whole design exists for, not an error.
    if (err && err.code !== 'ECONNABORTED' && !res.headersSent) res.status(500).end();
  });
});

// ── Coming back in ──────────────────────────────────────────────────────────
// ADDITIVE. A re-import must never produce a duplicate and must never remove something that
// was made locally after the export was taken, so on every conflict the local copy wins. The
// consequence is worth saying plainly: this can add, it cannot update. `overwrite` is the way
// out when bringing a newer version across is the actual intention.
function _merge(local, incoming, overwrite) {
  const keyOf = (o) => (o && (o.id ?? o.key ?? o.path ?? o.file ?? o.name));

  if (Array.isArray(local) && Array.isArray(incoming)) {
    const out = local.slice();
    const seen = new Map();
    out.forEach((o, i) => { const k = keyOf(o); if (k != null) seen.set(String(k), i); });
    // Not everything in this app has an id. scen3-options.json is three lists of plain
    // strings; gen-timings.json is samples with nothing to name them by. Those are matched
    // on their own value instead, because the alternative is that every re-import doubles
    // them - which is precisely the duplication this whole rule exists to prevent.
    const byValue = new Set();
    for (const o of out) if (keyOf(o) == null) byValue.add(JSON.stringify(o));
    for (const o of incoming) {
      const k = keyOf(o);
      if (k == null) {
        const sig = JSON.stringify(o);
        if (!byValue.has(sig)) { byValue.add(sig); out.push(o); }
        continue;
      }
      const at = seen.get(String(k));
      if (at == null) { seen.set(String(k), out.length); out.push(o); }
      else if (overwrite) out[at] = o;
    }
    return out;
  }
  if (local && incoming && typeof local === 'object' && typeof incoming === 'object') {
    const out = { ...local };
    for (const [k, v] of Object.entries(incoming)) {
      if (!(k in out)) out[k] = v;
      else if (overwrite) out[k] = v;
      else if (Array.isArray(out[k]) && Array.isArray(v)) out[k] = _merge(out[k], v, false);
    }
    return out;
  }
  return overwrite ? incoming : (local === undefined ? incoming : local);
}

const upload = multer({ dest: TEMP_DIR, limits: { fileSize: 32 * 1024 * 1024 * 1024 } });

router.post('/data/import', upload.single('file'), async (req, res) => {
  const tmp = req.file && req.file.path;
  if (!tmp) return res.status(400).json({ success: false, error: 'no file' });
  const overwrite = String((req.body || {}).overwrite || '') === 'true';
  const report = { jsons: 0, files: 0, skipped: 0, groups: [], overwrite };
  try {
    const zip = await unzipper.Open.file(tmp);

    const mEntry = zip.files.find(f => f.path === 'manifest.json');
    if (!mEntry) throw new Error('not an export of this app: manifest.json is missing');
    const manifest = JSON.parse((await mEntry.buffer()).toString('utf8'));
    if (manifest.app !== 'ugc-app') throw new Error('this archive was not made by ugc-app');
    report.groups = (manifest.groups || []).map(g => g.id);

    // Only the paths this app owns. An archive naming ../ or an unknown top directory is a
    // mistake at best, so it is refused rather than trusted.
    const allowed = new Set();
    for (const g of GROUPS) { for (const d of g.dirs) allowed.add(d); allowed.add('data'); }

    for (const entry of zip.files) {
      if (entry.type !== 'File' || entry.path === 'manifest.json') continue;
      const rel = entry.path.replace(/\\/g, '/');
      const top = rel.split('/')[0];
      if (!allowed.has(top)) { report.skipped++; continue; }
      const dest = path.resolve(ROOT_DIR, rel);
      if (!dest.startsWith(path.resolve(ROOT_DIR) + path.sep)) { report.skipped++; continue; }

      if (rel.startsWith('data/') && rel.endsWith('.json')) {
        const incoming = JSON.parse((await entry.buffer()).toString('utf8'));
        let local = null;
        try { local = JSON.parse(fs.readFileSync(dest, 'utf8')); } catch {}
        const merged = local == null ? incoming : _merge(local, incoming, overwrite);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, JSON.stringify(merged, null, 2));
        report.jsons++;
        continue;
      }

      // A media file's name carries a timestamp or a hash, so one that is already here IS the
      // same picture. Copying over it would only risk replacing something good with something
      // half-written.
      if (fs.existsSync(dest) && !overwrite) { report.skipped++; continue; }
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      await new Promise((ok, bad) => {
        entry.stream().pipe(fs.createWriteStream(dest)).on('finish', ok).on('error', bad);
      });
      report.files++;
    }

    console.log(`[data-io] imported ${report.jsons} stores, ${report.files} files, ${report.skipped} skipped`);
    res.json({ success: true, ...report });
  } catch (e) {
    console.error('[data-io] import failed:', e.message);
    res.status(500).json({ success: false, error: e.message, ...report });
  } finally {
    try { fs.unlinkSync(tmp); } catch {}
  }
});

module.exports = router;
