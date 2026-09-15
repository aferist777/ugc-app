// Import / Export — taking everything out of this library, and putting it into another.
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
// nothing - in cache/exports, since it is only ever a copy of what the library holds.
//
// STORED, NOT DEFLATED. Almost every byte here is already-compressed jpg, mp4 or mp3.
// Compressing them again buys a percent or two and turns a disk-speed copy into minutes of
// CPU. level 0 it is.
//
// VERSION 6 IS LAYOUT 6: the zip holds data/, projects/ and media/<kind>/ exactly as the library
// does. Older archives are still taken in: 5 (the desktop library before project folders) and the
// server version's (4 and before: uploads/, finals/, obrazy/ ..., placed by lib/layout.js).
//
// AN IMPORT IS STAGED, THEN MERGED. Each volume unpacks into a staging library of its own set,
// cache/import/<set>/lib - an older archive translated to layout 5 on the way. Once the volumes
// chosen are all up, POST /data/import/finish upgrades a staged library that is older than layout
// 6 (lib/library-upgrade.js) and merges it into this one (lib/library-merge.js): a project or a
// category this library already has takes the incoming files into its own folder, a new one gets
// a folder of its own name or "name (2)", and every path in the incoming stores follows. Staged,
// because both steps need the whole set: the stores that say where a file belongs can sit in
// another volume than the file.
const express  = require('express');
const fs       = require('fs');
const { writeFileAtomic } = require('../lib/atomic-write');
const path     = require('path');
const { pipeline } = require('stream/promises');
const crypto   = require('crypto');
const archiver = require('archiver');
const unzipper = require('unzipper');
const multer   = require('multer');

const router = express.Router();
const { ROOT_DIR, CACHE_DIR, TEMP_DIR } = require('../lib/config');
const { KINDS, KINDS_5, fromLegacy, rewriteLegacyValue, LEGACY_LEFT_OUT, STORES_LEFT_OUT } = require('../lib/layout');

const EXPORT_DIR = path.join(CACHE_DIR, 'exports');
const IMPORT_DIR = path.join(CACHE_DIR, 'import');
const KEEP_MS = 24 * 60 * 60 * 1000;
const VERSION = 6;

// How much goes in one volume. A gigabyte is small enough that a failed transfer costs a
// gigabyte and an unzipper reaches the central directory quickly, and large enough that a
// sixteen-gigabyte library is sixteen files rather than a hundred.
//
// A single file larger than this gets a volume of its own and overruns the cap: the alternative
// is splitting a file across archives, which is the one thing that would make a volume
// unopenable on its own.
const VOLUME_BYTES = 1024 * 1024 * 1024;

// ── What can be taken ───────────────────────────────────────────────────────
// Paths are relative to the library, so the same names address the zip and the disk on the way
// back in. A group is a thing a person would think of as one thing - not a directory and not a
// file, which is why some carry both and some carry several. `stores` are single files in data/:
// the JSON stores, and the one cookie file. `except` is a folder inside `dirs` that another group
// carries, so no file is counted twice. Stores of removed features are in no group
// (STORES_LEFT_OUT in lib/layout.js).
//
// `needs` is a dependency, not a hint: a project stores the PATH of its pictures, never the
// pictures. Take the projects without the media and the other machine gets timelines that
// point at nothing at all.
const GROUPS = [
  { id: 'media', label: 'Media library (pictures, b-roll, uploads, work files, voice, music, video sources)',
    dirs: ['media/images', 'media/birols', 'media/uploads', 'media/work', 'media/voice', 'media/audio', 'media/sources',
           'data/transcripts'],
    stores: ['data/sources.json', 'data/images.json', 'data/biroly.json', 'data/library-cats.json', 'data/suno-lib.json'], heavy: true },
  { id: 'renders', label: 'Finished renders',
    dirs: ['media/renders'], stores: [], heavy: true },
  // A project's folder holds its voice, frames, clips and timelines; the timelines point at the
  // shelves.
  { id: 'projects', label: 'Projects (Scenarios projects with their voice, frames and clips; Merge timelines, generation history)',
    dirs: ['projects'], stores: ['data/project-list.json', 'data/merge.json', 'data/mv3-gens.json', 'data/mv3-chat.json', 'data/mv3-settings.json'],
    needs: ['media', 'hooks'], heavy: true },
  { id: 'scenarios', label: 'Scenarios library (scenarios, poses, moods, options)',
    dirs: [], stores: ['data/scen3-scenarios.json', 'data/scen3-poses.json', 'data/scen3-moods.json',
                       'data/scen3-options.json', 'data/scen3-frame-options.json'] },
  { id: 'looks', label: 'Looks',
    dirs: ['media/looks'], stores: ['data/obrazy.json'] },
  { id: 'lookbooks', label: 'Lookbooks',
    dirs: ['media/lookbooks'], stores: ['data/scen3-lookbook-meta.json'] },
  { id: 'hooks', label: 'Hooks',
    dirs: ['media/hooks'], stores: ['data/hooks-archive.json', 'data/hook-ids.json'] },
  { id: 'characters', label: 'Characters (4K sheets, thumbnails)',
    dirs: ['media/characters'], stores: ['data/characters.json'] },
  { id: 'locations', label: 'Locations',
    dirs: ['media/locations'], stores: [] },
  { id: 'library2', label: 'Library 2 (narrators, script drafts)',
    dirs: [], stores: ['data/narrators.json', 'data/script-drafts.json'] },
  { id: 'voices', label: 'Voice shelf',
    dirs: [], stores: ['data/voice-shelf.json'], needs: ['media'] },
  { id: 'ui', label: 'Interface state',
    dirs: [], stores: ['data/ui-state.json'] },
  { id: 'prompts', label: 'Prompt edits',
    dirs: [], stores: ['data/prompts.json'] },
  // Off by default in the UI. Everything else here is work; this one is credentials.
  { id: 'settings', label: 'Settings, API keys and the YouTube sign-in', secret: true,
    dirs: [], stores: ['data/settings.json', 'data/yt-cookies.txt', 'data/yt-cookies.json'] },
];

// Deliberately absent: cache/ (thumbnails and previews make themselves again, and the export
// volumes live there - an export must never contain the last export), scratch (the system temp
// folder), logs, and everything in STORES_LEFT_OUT - the queues of unfinished work among them: on
// another machine those describe jobs that will never come back, or start a render nobody asked
// that machine for.

const _abs = (rel) => path.join(ROOT_DIR, rel);
const _exists = (rel) => { try { return fs.existsSync(_abs(rel)); } catch { return false; } };

// Every file under a folder, as {rel, abs, size}, leaving out the folders in `except`. The packer
// needs sizes up front, which is also why the archive is built from an explicit list rather than
// archive.directory().
function _listDir(rel, except, out) {
  const skip = new Set(except.map((e) => path.resolve(_abs(e))));
  const walk = (d) => {
    let entries = [];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const abs = path.join(d, e.name);
      if (e.isDirectory()) { if (!skip.has(path.resolve(abs))) walk(abs); continue; }
      let size = 0;
      try { size = fs.statSync(abs).size; } catch { continue; }
      out.push({ rel: path.relative(ROOT_DIR, abs).replace(/\\/g, '/'), abs, size });
    }
  };
  if (_exists(rel)) walk(_abs(rel));
  return out;
}

function _listGroup(g) {
  const out = [];
  for (const d of g.dirs) _listDir(d, g.except || [], out);
  for (const s of g.stores) {
    if (!_exists(s)) continue;
    try { out.push({ rel: s, abs: _abs(s), size: fs.statSync(_abs(s)).size }); } catch {}
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
  const files = _listGroup(g);
  return { bytes: files.reduce((n, f) => n + f.size, 0), files: files.length };
}

// ── The catalogue, measured on demand ───────────────────────────────────────
router.get('/data/groups', (_req, res) => {
  try {
    const groups = GROUPS.map(g => ({
      id: g.id, label: g.label, secret: !!g.secret, heavy: !!g.heavy, needs: g.needs || [],
      dirs: g.dirs, stores: g.stores.filter(_exists),
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
// Also once at start: gigabytes of day-old volumes should not wait for the next export to go.
_sweepOld();

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

    // Everything that will go in, measured before anything is written - once each, since two
    // groups may name the same store.
    const byRel = new Map();
    for (const g of picked) for (const f of _listGroup(g)) if (!byRel.has(f.rel)) byRel.set(f.rel, f);
    const all = [...byRel.values()];
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
      id: g.id, label: g.label, dirs: g.dirs, stores: g.stores.filter(_exists),
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
// was made locally after the export was taken, so on every conflict the local copy wins
// (lib/library-merge.js). The consequence is worth saying plainly: this can add, it cannot
// update. `overwrite` is the way out when bringing a newer version across is the intention.

// Stores that belong to the library they are in: never taken from an archive.
const OWN_STORES = new Set(['moves.json', 'library.json']);

// Where an entry of an archive goes in its staging library - a path relative to it - or null when
// it has no place. Only the paths this app owns: an archive naming ../ or an unknown top directory
// is a mistake at best, so it is left out rather than trusted.
function _placeOf(rel, version) {
  const parts = rel.split('/');
  if (parts.some((s) => s === '' || s === '.' || s === '..')) return null;
  if (parts[0] === 'data') return STORES_LEFT_OUT[rel.slice(5)] || OWN_STORES.has(rel.slice(5)) ? null : rel;
  if (version >= 6) {
    if (parts[0] === 'projects' && parts.length >= 3) return rel;
    return parts[0] === 'media' && parts.length >= 3 && KINDS.includes(parts[1]) ? rel : null;
  }
  if (version === 5) return parts[0] === 'media' && parts.length >= 3 && KINDS_5.includes(parts[1]) ? rel : null;
  const url = '/' + rel;
  if (LEGACY_LEFT_OUT.some(([re]) => re.test(url))) return null;
  const now = fromLegacy(url);
  // A server folder with no place in the desktop library (vsl/, the text scenarios/) stays out.
  return now && now.startsWith('/media/') ? now.slice(1) : null;
}

const _readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };

// Staged sets nobody finished go after a day.
function _sweepStaged() {
  let sets = [];
  try { sets = fs.readdirSync(IMPORT_DIR); } catch { return; }
  for (const s of sets) {
    const dir = path.join(IMPORT_DIR, s);
    const state = _readJson(path.join(dir, 'import.json'), null);
    const at = state && state.touchedAt ? Date.parse(state.touchedAt) : 0;
    if (!at || Date.now() - at > KEEP_MS) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} }
  }
}
_sweepStaged();

const upload = multer({ dest: TEMP_DIR, limits: { fileSize: 32 * 1024 * 1024 * 1024 } });

// One volume: unpacked into the staging library of its set.
router.post('/data/import', upload.single('file'), async (req, res) => {
  const tmp = req.file && req.file.path;
  if (!tmp) return res.status(400).json({ success: false, error: 'no file' });
  // leftOut: has no place in a library.
  const report = { staged: true, files: 0, stores: 0, leftOut: 0, groups: [], part: 1, parts: 1, complete: false, fromServer: false, fromLayout5: false };
  try {
    const zip = await unzipper.Open.file(tmp);

    const mEntry = zip.files.find(f => f.path === 'manifest.json');
    if (!mEntry) throw new Error('not an export of this app: manifest.json is missing');
    const manifest = JSON.parse((await mEntry.buffer()).toString('utf8'));
    if (manifest.app !== 'ugc-app') throw new Error('this archive was not made by ugc-app');
    if (Number(manifest.version) > VERSION) throw new Error('this archive was made by a newer version of the app');
    const version = Number(manifest.version) || 4;
    report.groups = (manifest.groups || []).map(g => g.id);
    report.part = Number(manifest.part) || 1;
    report.parts = Number(manifest.parts) || 1;
    report.fromServer = version < 5;
    report.fromLayout5 = version === 5;

    // A set is the export it came from: the volumes of one export share their manifest's time.
    const key = crypto.createHash('sha1').update(`${manifest.takenAt || tmp}|${version}|${report.parts}`).digest('hex').slice(0, 12);
    const setDir = path.join(IMPORT_DIR, key);
    const lib = path.join(setDir, 'lib');
    const stateFile = path.join(setDir, 'import.json');
    const state = _readJson(stateFile, null) || { version, parts: report.parts, have: [], takenAt: manifest.takenAt || null, groups: [] };
    fs.mkdirSync(lib, { recursive: true });

    for (const entry of zip.files) {
      if (entry.type !== 'File' || entry.path === 'manifest.json') continue;
      const place = _placeOf(entry.path.replace(/\\/g, '/'), version);
      const dest = place && path.resolve(lib, place);
      if (!dest || !dest.startsWith(path.resolve(lib) + path.sep)) { report.leftOut++; continue; }
      fs.mkdirSync(path.dirname(dest), { recursive: true });

      if (place.startsWith('data/') && place.endsWith('.json')) {
        let value = JSON.parse((await entry.buffer()).toString('utf8'));
        if (report.fromServer) value = rewriteLegacyValue(value);
        writeFileAtomic(dest, JSON.stringify(value, null, 2));
        report.stores++;
        continue;
      }
      const part = dest + '.part';
      try {
        // pipeline, not pipe: a failure on either side closes both, and it settles once the
        // file's handle is shut - the time is set and the file renamed after that.
        await pipeline(entry.stream(), fs.createWriteStream(part));
        // The shelves sort by modified time, so a file keeps the one it had.
        const when = entry.lastModifiedDateTime;
        if (when instanceof Date && !isNaN(when)) { try { fs.utimesSync(part, when, when); } catch {} }
        fs.renameSync(part, dest);
      } catch (e) {
        try { fs.unlinkSync(part); } catch {}
        throw e;
      }
      report.files++;
    }

    if (!state.have.includes(report.part)) state.have.push(report.part);
    state.groups = [...new Set([...state.groups, ...report.groups])];
    state.touchedAt = new Date().toISOString();
    writeFileAtomic(stateFile, JSON.stringify(state, null, 2));
    report.complete = state.have.length >= state.parts;
    console.log(`[data-io] staged part ${report.part} of ${report.parts} (format ${version}): ${report.stores} stores, ${report.files} files, ${report.leftOut} left out`);
    res.json({ success: true, ...report });
  } catch (e) {
    console.error('[data-io] import failed:', e.message);
    res.status(500).json({ success: false, error: e.message, ...report });
  } finally {
    try { fs.unlinkSync(tmp); } catch {}
  }
});

// Every staged set, merged into the library - a set some of whose volumes never came is merged
// with what did come, and says so. The staging goes afterwards either way.
router.post('/data/import/finish', express.json({ limit: '1mb' }), (req, res) => {
  const overwrite = !!(req.body && req.body.overwrite);
  const sets = [];
  let keys = [];
  try { keys = fs.readdirSync(IMPORT_DIR); } catch {}
  for (const key of keys) {
    const setDir = path.join(IMPORT_DIR, key);
    const state = _readJson(path.join(setDir, 'import.json'), null);
    if (!state) { try { fs.rmSync(setDir, { recursive: true, force: true }); } catch {} continue; }
    const lib = path.join(setDir, 'lib');
    const r = { takenAt: state.takenAt, format: state.version, parts: state.parts, have: state.have.length, upgraded: false };
    try {
      if (state.version < 6) {
        const u = require('../lib/library-upgrade').upgrade(lib, { log: (line) => console.log(line.replace('[upgrade]', '[data-io] staged set:')) });
        r.upgraded = !!u.upgraded;
        r.setAside = u.upgraded ? u.report.unreferenced : 0;
      }
      Object.assign(r, require('../lib/library-merge').mergeLibrary(lib, ROOT_DIR, {
        overwrite, onNewFolder: (url) => require('../lib/moves').forget(url),
      }));
      console.log(`[data-io] merged a set of ${r.have}/${r.parts} volume(s), format ${r.format}: ${r.projects} projects `
        + `(${r.projectsHere} already here), ${r.timelines} timelines, ${r.categories} categories, ${r.files} files `
        + `(${r.skipped} already here), ${r.stores} stores`);
    } catch (e) {
      r.error = e.message;
      console.error('[data-io] merge failed:', e.stack || e.message);
    }
    try { fs.rmSync(setDir, { recursive: true, force: true }); } catch {}
    sets.push(r);
  }
  // Timelines and projects arrived behind the stores' backs.
  try { require('../lib/merge-store').invalidate(); } catch {}
  // Thumbnails in an archive may have been cut at an older, smaller size.
  if (sets.some((s) => s.files)) require('../lib/thumb-refresh').again();
  res.json({ success: !sets.some((s) => s.error), sets, error: (sets.find((s) => s.error) || {}).error });
});

module.exports = router;
