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
const { writeFileAtomic } = require('../lib/atomic-write');
const path     = require('path');
const crypto   = require('crypto');
const archiver = require('archiver');
const unzipper = require('unzipper');
const multer   = require('multer');

const router = express.Router();
const { ROOT_DIR, DATA_DIR, TEMP_DIR } = require('../lib/config');

const EXPORT_DIR = path.join(DATA_DIR, 'exports');
const KEEP_MS = 24 * 60 * 60 * 1000;
const VERSION = 4;

// How much goes in one volume. A gigabyte is small enough that a failed transfer costs a
// gigabyte and an unzipper reaches the central directory quickly, and large enough that a
// sixteen-gigabyte library is sixteen files rather than a hundred.
//
// A single file larger than this gets a volume of its own and overruns the cap: the alternative
// is splitting a file across archives, which is the one thing that would make a volume
// unopenable on its own.
const VOLUME_BYTES = 1024 * 1024 * 1024;

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

// Deliberately absent: scratch (it lives in the system temp folder, not the library, and
// rebuilds itself), logs, node_modules, and data/exports itself - an export must never contain
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

// Every file a group holds, as {rel, abs, size}. The packer needs sizes up front, which is
// also why the archive is built from an explicit list rather than archive.directory().
function _listDir(rel, out) {
  const root = _abs(rel);
  const walk = (d) => {
    let entries = [];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const abs = path.join(d, e.name);
      if (e.isDirectory()) { walk(abs); continue; }
      let size = 0;
      try { size = fs.statSync(abs).size; } catch { continue; }
      out.push({ rel: path.relative(ROOT_DIR, abs).replace(/\\/g, '/'), abs, size });
    }
  };
  if (fs.existsSync(root)) walk(root);
  return out;
}

function _listGroup(g) {
  const out = [];
  for (const d of g.dirs) if (_exists(d)) _listDir(d, out);
  for (const j of g.jsons) {
    if (!_exists(j)) continue;
    try { out.push({ rel: j, abs: _abs(j), size: fs.statSync(_abs(j)).size }); } catch {}
  }
  return out;
}

// Sequential bin packing: fill a volume until the next file would take it past the cap, then
// start another. Order is preserved so a volume holds files that belong together, which makes a
// partial restore coherent rather than scattered.
function _packVolumes(files, cap) {
  const vols = [];
  let cur = [], curBytes = 0;
  for (const f of files) {
    if (cur.length && curBytes + f.size > cap) { vols.push(cur); cur = []; curBytes = 0; }
    cur.push(f);
    curBytes += f.size;
  }
  if (cur.length) vols.push(cur);
  return vols.length ? vols : [[]];
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
    const short = id.slice(0, 6);
    const takenAt = new Date().toISOString();

    // Everything that will go in, measured before anything is written.
    const all = [];
    for (const g of picked) all.push(..._listGroup(g));
    const volumes = _packVolumes(all, VOLUME_BYTES);
    const pad = (n) => String(n).padStart(2, '0');

    const job = {
      id, state: 'building', error: null, added, takenAt,
      startedAt: Date.now(), finishedAt: null,
      total: all.length,
      totalBytes: all.reduce((n, f) => n + f.size, 0),
      files: 0,
      parts: volumes.map((v, i) => ({
        index: i + 1,
        name: `ugc-app-export-${stamp}-${short}-part${pad(i + 1)}of${pad(volumes.length)}.zip`,
        out: path.join(EXPORT_DIR, `${id}-${pad(i + 1)}.zip`),
        state: 'queued', files: 0, total: v.length,
        plannedBytes: v.reduce((n, f) => n + f.size, 0), bytes: 0,
      })),
    };
    _jobs.set(id, job);

    const groupsInManifest = picked.map(g => ({
      id: g.id, label: g.label, dirs: g.dirs, jsons: g.jsons.filter(_exists),
    }));

    // One volume at a time. Running them together would have several archivers competing for
    // the same disk to produce files that are read back one at a time anyway.
    const buildVolume = (i) => {
      if (i >= volumes.length) {
        job.state = 'ready';
        job.finishedAt = Date.now();
        const gb = (job.parts.reduce((n, p) => n + p.bytes, 0) / 1e9).toFixed(2);
        console.log(`[data-io] built ${volumes.length} volume(s) — ${gb} GB, ${job.files} files`);
        return;
      }
      const part = job.parts[i];
      part.state = 'building';

      const sink = fs.createWriteStream(part.out);
      const archive = archiver('zip', { zlib: { level: 0 } });   // store, not deflate
      archive.on('entry', () => { part.files++; job.files++; });
      archive.on('warning', (e) => console.warn('[data-io] warning:', e.message));
      archive.on('error', (e) => {
        job.state = 'failed'; part.state = 'failed'; job.error = e.message;
        job.finishedAt = Date.now();
      });
      sink.on('close', () => {
        if (job.state === 'failed') return;
        part.bytes = archive.pointer();
        part.state = 'ready';
        buildVolume(i + 1);
      });
      archive.pipe(sink);

      // Each volume says which one it is and what the whole set was, so the import can report
      // "part 3 of 7" and a person can see at a glance whether any are missing.
      archive.append(JSON.stringify({
        version: VERSION, app: 'ugc-app', takenAt,
        part: i + 1, parts: volumes.length,
        groups: groupsInManifest,
      }, null, 2), { name: 'manifest.json' });

      for (const f of volumes[i]) archive.file(f.abs, { name: f.rel });
      archive.finalize();
    };
    buildVolume(0);

    res.json({
      success: true, jobId: id, pulledIn: added, groups: picked.map(g => g.id),
      parts: job.parts.map(p => ({ index: p.index, name: p.name, plannedBytes: p.plannedBytes, total: p.total })),
    });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.get('/data/export/:id/status', (req, res) => {
  const job = _jobs.get(String(req.params.id));
  if (!job) return res.status(404).json({ success: false, error: 'no such export' });
  const parts = job.parts.map(p => {
    let onDisk = 0;
    try { onDisk = fs.statSync(p.out).size; } catch {}
    return {
      index: p.index, name: p.name, state: p.state,
      files: p.files, total: p.total,
      bytes: p.bytes || onDisk, plannedBytes: p.plannedBytes,
    };
  });
  const bytes = parts.reduce((n, p) => n + p.bytes, 0);
  const elapsedMs = (job.finishedAt || Date.now()) - job.startedAt;

  // Time left is estimated from BYTES, not from the file count: a thousand thumbnails and a
  // thousand mp4s are the same number and nowhere near the same wait. Withheld until enough has
  // been written to mean anything - an estimate from the first half-second is a guess dressed up
  // as a number.
  let etaMs = null;
  if (job.state === 'building' && bytes > 8 * 1024 * 1024 && elapsedMs > 2000) {
    const rate = bytes / elapsedMs;                       // bytes per ms
    if (rate > 0) etaMs = Math.max(0, Math.round((job.totalBytes - bytes) / rate));
  }

  res.json({
    success: true, state: job.state, error: job.error,
    files: job.files, total: job.total, totalBytes: job.totalBytes,
    bytes, elapsedMs, etaMs,
    parts,
  });
});

// The resumable half. sendFile sets Accept-Ranges and answers 206 to a Range request, so a
// download that dies at four gigabytes carries on from four gigabytes.
router.get('/data/export/:id/part/:n/download', (req, res) => {
  const job = _jobs.get(String(req.params.id));
  if (!job) return res.status(404).send('no such export');
  const part = job.parts.find(p => p.index === Number(req.params.n));
  if (!part) return res.status(404).send('no such volume');
  if (part.state !== 'ready') return res.status(409).send('that volume is not finished building');
  res.setHeader('Content-Disposition', `attachment; filename="${part.name}"`);
  res.sendFile(part.out, (err) => {
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
    // Carried straight back so the popup can say "part 3 of 7" against the row, which is how a
    // person notices that volume 5 never went in. Absent on an archive from before volumes.
    if (manifest.part) { report.part = manifest.part; report.parts = manifest.parts; }

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
        writeFileAtomic(dest, JSON.stringify(merged, null, 2));
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
