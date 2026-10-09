'use strict';

/* proxies.js - small copies of the films the Merge preview plays.

     GET /api/ffmpeg/preview-proxy?src=<address>&h=360|480|720[&rev=1]
       a low-bitrate copy scaled to h on its shorter side (reversed with rev=1), made once and
       kept in scratch by path, modification time and size; streamed with ranges so it seeks

   A browser cannot decode three layered 4K birols in real time; a proxy it can. The render never
   reads them - it takes the original files (lib/mv3b-job.js). What a page is about to ask for is made
   ahead: warmProxies() when a project opens or a file is filed, and a sweep over every known film at
   boot and every ten minutes after.

   The file this came out of also held the talking-head editor's render, which went with that editor
   (docs/local-app/PLAN.md, phase 3); the address keeps its /ffmpeg/ prefix so nothing that asks for a
   proxy has to change. */

const express    = require('express');
const path       = require('path');
const fs         = require('fs');
const { spawn }  = require('child_process');
const crypto     = require('crypto');
const ffmpegPath = require('ffmpeg-static');
const router     = express.Router();

const { MEDIA_DIR, PROJECTS_DIR, TEMP_DIR, DATA_DIR } = require('../lib/config');
const { toDisk, toDiskWithin } = require('../lib/media');
const BUSY = require('../lib/render-busy');
const _hearing = () => { try { return require('../lib/whisper-local').hearing(); } catch (e) { return false; } };

// ── GET /api/ffmpeg/preview-proxy?src=<webPath> ───────────────────────────────
// Lightweight ~480p transcode of a clip for the BROWSER PREVIEW only (the final
// render still reads the full-res files server-side). Cached on disk keyed by
// path+mtime; supports HTTP Range (sendFile) so the preview can seek. On a slow
// connection this lets the preview stream a small file instead of the full
// 1080x1920 source. Concurrent requests for the same proxy share one transcode.
const PREVIEW_CACHE_DIR = path.join(TEMP_DIR, 'preview_proxies');
try { if (!fs.existsSync(PREVIEW_CACHE_DIR)) fs.mkdirSync(PREVIEW_CACHE_DIR, { recursive: true }); } catch {}
const _proxyInflight = new Map();

const PROXY_HEIGHTS = [360, 480, 720];   // selectable preview qualities (shorter side)
// lib/library-upgrade.js renames proxies by this same key when the upgrade moves their films.
function _proxyCachePath(absSrc, h, rev) {
  let mtime = 0; try { mtime = Math.floor(fs.statSync(absSrc).mtimeMs); } catch {}
  const key = crypto.createHash('md5').update(absSrc + '|' + mtime + '|h' + h + (rev ? '|rev' : '')).digest('hex');
  return path.join(PREVIEW_CACHE_DIR, key + '_' + h + (rev ? '_rev' : '') + '.mp4');
}
function _makePreviewProxy(absSrc, outPath, h, rev, low, entry) {
  // Scale the SHORTER side to <h> (portrait 1080x1920 -> hx.., landscape -> ..xh),
  // low bitrate, faststart for progressive seeking. Higher h = sharper + heavier.
  // rev=true also time-reverses video+audio so the preview can play a reversed
  // insert by simply playing this pre-reversed proxy forward.
  // low=true runs the process below normal priority: a proxy made ahead of time must not
  // take the cores from an export or from a proxy somebody is waiting for right now.
  const crf = h >= 720 ? '27' : '30';
  const ab  = h >= 720 ? '96k' : '64k';
  const vf  = (rev ? 'reverse,' : '') + "scale='if(gt(iw,ih),-2," + h + ")':'if(gt(iw,ih)," + h + ",-2)':flags=bilinear";
  const args = [
    '-y', ...(low ? ['-threads', '2'] : []), '-i', absSrc,
    '-vf', vf,
    ...(rev ? ['-af', 'areverse'] : []),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', crf, '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', ab, '-ar', '44100',
    '-movflags', '+faststart',
    ...(low ? ['-threads', '2'] : []),
    outPath,
  ];
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    if (entry) entry.proc = proc;
    if (low) { try { require('os').setPriority(proc.pid, 10); } catch (e) {} }
    let err = '';
    proc.stderr.on('data', c => { err += c.toString(); });
    proc.on('close', code => code === 0 ? resolve() : reject(new Error('proxy transcode failed (' + code + '): ' + err.slice(-300))));
    proc.on('error', reject);
  });
}
// ONE QUEUE FOR EVERY PROXY, one ffmpeg at a time. A proxy transcode takes about three
// cores for a second or two; started as they were asked for - one per request, in parallel -
// four people opening four projects were forty ffmpegs at once, and on four cores that is
// everybody's preview stalling together. Two priorities: LIVE is a proxy a player is waiting
// for right now (the /preview-proxy request) and goes to the front; WARM is one made ahead
// (open, import, the sweep) and goes to the back - and waits altogether while an export
// holds the cores, since the export is the one thing here that takes minutes.
//
// Concurrent callers for the same proxy share one entry; asking live for one that is queued
// warm moves it to the front. Resolves to the cache path, rejects if ffmpeg could not.
const _pq = [];                     // the entries waiting, live ones first
let _pqBusy = false, _pqTimer = null;
let _pqNow = null;                  // the entry being made right now

// A file about to move (lib/relocate.js): what is queued for it is dropped, and a transcode reading
// it is stopped - on Windows it would hold the file, and the folder it is in, against the rename.
// The proxy is made again from the new address when a player next asks for it.
require('../lib/file-release').onRelease((absPaths) => {
  const roots = absPaths.map(a => path.resolve(a).toLowerCase());
  const hit = (e) => { const p = path.resolve(e.abs).toLowerCase(); return roots.some(r => p === r || p.startsWith(r + path.sep)); };
  for (let i = _pq.length - 1; i >= 0; i--) {
    if (!hit(_pq[i])) continue;
    const e = _pq.splice(i, 1)[0];
    _proxyInflight.delete(e.cachePath);
    e.reject(new Error('the file moved'));
  }
  if (_pqNow && hit(_pqNow) && _pqNow.proc) { try { _pqNow.proc.kill(); } catch (e) { /* gone already */ } }
});

function _pqPromote(entry) {
  const i = _pq.indexOf(entry);
  if (i < 0) return;
  _pq.splice(i, 1);
  const firstWarm = _pq.findIndex(e => !e.live);
  _pq.splice(firstWarm < 0 ? _pq.length : firstWarm, 0, entry);
}

function _ensureProxy(abs, h, rev, live) {
  const cachePath = _proxyCachePath(abs, h, rev);
  if (fs.existsSync(cachePath)) return Promise.resolve(cachePath);
  let entry = _proxyInflight.get(cachePath);
  if (entry) {
    if (live && !entry.live) { entry.live = true; _pqPromote(entry); }
    return entry.promise;
  }
  entry = { cachePath, abs, h, rev: !!rev, live: !!live, at: Date.now() };
  entry.promise = new Promise((resolve, reject) => { entry.resolve = resolve; entry.reject = reject; });
  _proxyInflight.set(cachePath, entry);
  _pq.push(entry);
  if (live) _pqPromote(entry);
  _pumpProxies();
  return entry.promise;
}

function _pumpProxies() {
  if (_pqBusy) return;
  const next = _pq[0];
  if (!next) return;
  // A warm-up waits for the export to finish - and (phase V23) for recognition on this computer, which wants the same
  // processor; a live request does not - a person is watching.
  if (!next.live && (BUSY.busy() || _hearing())) {
    if (!_pqTimer) _pqTimer = setTimeout(() => { _pqTimer = null; _pumpProxies(); }, 2000);
    return;
  }
  _pq.shift();
  _pqBusy = true;
  _pqNow = next;
  const tmp = next.cachePath + '.tmp.mp4';
  const t0 = Date.now();
  _makePreviewProxy(next.abs, tmp, next.h, next.rev, !next.live, next)
    .then(() => { fs.renameSync(tmp, next.cachePath); next.resolve(next.cachePath); })
    .catch(e => { try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch {} next.reject(e); })
    .finally(() => {
      _proxyInflight.delete(next.cachePath);
      _pqBusy = false;
      _pqNow = null;
      console.log(`[proxy] ${next.live ? 'live' : 'warm'} ${path.basename(next.abs)} @${next.h}${next.rev ? ' rev' : ''} in ${((Date.now() - t0) / 1000).toFixed(1)}s` + (_pq.length ? ` · ${_pq.length} waiting` : ''));
      setImmediate(_pumpProxies);
    });
}

// A web path the proxy may transcode: under one of the served roots, and a film. Returns the
// absolute path, or null.
function _proxyAbs(src) {
  const s = String(src || '');
  if (!s) return null;
  if (!/\.(mp4|mov|webm|m4v)$/i.test(s.split('?')[0])) return null;
  const abs = toDiskWithin(s, [MEDIA_DIR, PROJECTS_DIR]);
  return abs && fs.existsSync(abs) ? abs : null;
}

router.get('/ffmpeg/preview-proxy', async (req, res) => {
  try {
    const src = String(req.query.src || '');
    if (!toDisk(src)) return res.status(404).end();
    const abs = toDiskWithin(src, [MEDIA_DIR, PROJECTS_DIR]);
    if (!abs) return res.status(403).end();
    if (!fs.existsSync(abs)) return res.status(404).end();

    const reqH = parseInt(req.query.h, 10);
    const h = PROXY_HEIGHTS.includes(reqH) ? reqH : 480;
    const rev = /^(1|true)$/i.test(String(req.query.rev || ''));
    let cachePath;
    try { cachePath = await _ensureProxy(abs, h, rev, true); }
    catch (e) { console.warn('[ffmpeg/preview-proxy]', e.message); return res.redirect(302, src); }  // fall back to original
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.sendFile(cachePath);
  } catch (e) {
    return res.status(500).end();
  }
});

// ── Proxies made AHEAD of the preview ────────────────────────────────────────
// Opening a project and importing one both know every clip the preview is about to ask
// for, so the transcodes are queued then - at the back of the one queue, behind anything a
// player is waiting for - instead of on the first play, where each missing proxy was a
// freeze for the length of its transcode. Fire and forget: nothing waits on this, and a
// failure here only means the preview's own request makes the proxy later, as it always
// did. What is cached already costs a stat. Returns how many were actually queued.
function warmProxies(srcs, h) {
  const hh = PROXY_HEIGHTS.includes(+h) ? +h : 480;
  let queued = 0;
  for (const src of (srcs || [])) {
    const abs = _proxyAbs(src);
    if (!abs) continue;
    const cachePath = _proxyCachePath(abs, hh, false);
    if (fs.existsSync(cachePath) || _proxyInflight.has(cachePath)) continue;
    queued++;
    _ensureProxy(abs, hh, false, false).catch(e => { console.warn('[ffmpeg/warm]', path.basename(abs), e.message); });
  }
  return queued;
}
router.warmProxies = warmProxies;

// ── THE SWEEP: every film the previews might play, made ahead ──────────────────
// The birols and hooks libraries, every Merge timeline, every take a Scenarios line has:
// anything without a proxy at the default quality is queued warm. Once at boot (a little
// after, so the start is quiet) and every ten minutes after that, so a clip added some other
// way has its proxy before anyone drops it on a lane - the pages that make files also ask
// directly (routes/clips.js, routes/scen3.js, routes/library.js), the sweep is the net under them. Nothing is remade: a cached proxy is
// one stat, and the queue itself refuses duplicates.
const SWEEP_H = 480;
const SWEEP_EVERY_MS = 10 * 60 * 1000;
function _readJson(name, dflt) {
  try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, name), 'utf8')); } catch { return dflt; }
}
function _librarySources() {
  const out = new Set();
  for (const e of (_readJson('biroly.json', {}).archive || [])) if (e && e.videoPath && e.status !== 'failed') out.add(String(e.videoPath));
  const hooks = _readJson('hooks-archive.json', []);
  for (const e of (Array.isArray(hooks) ? hooks : [])) if (e && e.videoPath) out.add(String(e.videoPath));
  const tl = require('../lib/merge-store').read().timelines;
  for (const t of Object.values(tl)) {
    const tracks = (t && t.tracks) || {};
    for (const lane of (Array.isArray(tracks) ? tracks : Object.values(tracks))) for (const c of ((lane && lane.clips) || [])) if (c && c.src) out.add(String(c.src));
  }
  for (const p of require('../lib/projects-store').list()) {
    for (const l of ((p && p.lines) || [])) {
      const v = (l && l.video) || {};
      for (const arr of Object.values(v)) for (const take of (Array.isArray(arr) ? arr : [])) if (take && take.path) out.add(String(take.path));
    }
  }
  return [...out];
}
function sweepProxies(reason) {
  try {
    const srcs = _librarySources();
    const queued = warmProxies(srcs, SWEEP_H);
    console.log(`[proxy] sweep (${reason}): ${srcs.length} films known, ${queued} queued` + (_pq.length ? `, ${_pq.length} waiting` : ''));
  } catch (e) { console.warn('[proxy] sweep failed:', e.message); }
}
router.sweepProxies = sweepProxies;
setTimeout(() => sweepProxies('boot'), 20000).unref();
setInterval(() => sweepProxies('timer'), SWEEP_EVERY_MS).unref();

module.exports = router;
