'use strict';

const express    = require('express');
const path       = require('path');
const fs         = require('fs');
const { spawn }  = require('child_process');
const crypto     = require('crypto');
const ffmpegPath = require('ffmpeg-static');
const router     = express.Router();

const { ROOT_DIR, UPLOADS_DIR, FINALS_DIR, TEMP_DIR, DATA_DIR } = require('../lib/config');
const { normalizeVideoForBrowser } = require('../lib/helpers');

// ── Pre-merge normalization helpers ──────────────────────────────────────────
// Force every input clip through normalizeVideoForBrowser before merge so the
// concat / filter pipeline can decode them uniformly. Cache via a sibling
// marker file `<path>.norm` so re-merges of the same project don't re-encode
// already-normalized clips. Idempotent and safe to delete (marker only).
function _normMarkerPath(absVideoPath) {
  return absVideoPath + '.norm';
}
async function _normalizeOnceWithCache(absVideoPath, jobId) {
  if (!absVideoPath || !fs.existsSync(absVideoPath)) return;
  const marker = _normMarkerPath(absVideoPath);
  if (fs.existsSync(marker)) return; // already normalized for this file
  // Register the normalize ffmpeg as the job's active process so Cancel can kill it.
  await normalizeVideoForBrowser(absVideoPath, (proc) => { if (jobId && _jobs[jobId]) _jobs[jobId].proc = proc; });
  if (jobId && _jobs[jobId]) _jobs[jobId].proc = null;
  try { fs.writeFileSync(marker, String(Date.now()), 'utf8'); } catch {}
}

// Walks any inputs the render job will touch, dedupes by path, and normalizes
// each one with progress reported into _jobs[jobId]. Skips files that already
// have a `.norm` marker. Errors per-clip are logged but do not abort the
// merge (so a single bad clip can't kill the project).
async function _normalizeAllInputs(jobId, clipsArrays) {
  const all = [];
  for (const arr of clipsArrays) {
    for (const c of (arr || [])) {
      const fp = _webToFs(c.videoPath);
      if (!fp) continue;
      if (!fs.existsSync(fp)) continue;
      all.push(fp);
    }
  }
  const unique = [...new Set(all)];
  if (!unique.length) return;
  if (_jobs[jobId]) {
    _jobs[jobId].status = 'normalizing';
    _jobs[jobId].normalizeTotal = unique.length;
    _jobs[jobId].normalizeCurrent = 0;
  }
  for (let i = 0; i < unique.length; i++) {
    // Bail out the moment Cancel was pressed so we don't keep re-encoding clips.
    if (_jobs[jobId] && _jobs[jobId].status === 'cancelled') throw new Error('cancelled');
    try { await _normalizeOnceWithCache(unique[i], jobId); }
    catch (e) {
      if (_jobs[jobId] && _jobs[jobId].status === 'cancelled') throw new Error('cancelled');
      console.warn('[ffmpeg/normalize]', path.basename(unique[i]), e.message);
    }
    if (_jobs[jobId]) _jobs[jobId].normalizeCurrent = i + 1;
  }
  if (_jobs[jobId]) {
    _jobs[jobId].status = 'running';
  }
}

// Directory for persisted pre-built .ass files
const ASS_DIR = path.join(DATA_DIR, 'ass_cache');
if (!fs.existsSync(ASS_DIR)) fs.mkdirSync(ASS_DIR, { recursive: true });

// Directory for cached "black tail" files (silent N-min black-screen segments
// appended to renders when advSettings.extra1 = 'black5|10|20|30'). Cache key
// includes resolution + fps so concat -c copy doesn't break on stream-mismatch.
const BLACK_TAIL_DIR = path.join(TEMP_DIR, 'black_tails');
if (!fs.existsSync(BLACK_TAIL_DIR)) fs.mkdirSync(BLACK_TAIL_DIR, { recursive: true });

// In-memory job registry (cleared on server restart)
const _jobs = {};

// Strict FIFO render queue: ONE ffmpeg render runs at a time so parallel
// exports can't starve the (shared-CPU) server. Jobs wait as 'queued'; the
// status endpoint reports queuePos so the client can show "N ahead".
const _renderQueue = [];     // [{ jobId, run }]
let _renderBusy = false;
function _queuePosOf(jobId) {
  const i = _renderQueue.findIndex(x => x.jobId === jobId);
  return i < 0 ? null : i + (_renderBusy ? 1 : 0);
}
function _enqueueRender(jobId, run) {
  _renderQueue.push({ jobId, run });
  _pumpRenderQueue();
}
function _pumpRenderQueue() {
  if (_renderBusy) return;
  const next = _renderQueue.shift();
  if (!next) return;
  const j = _jobs[next.jobId];
  if (j && j.status === 'cancelled') { setImmediate(_pumpRenderQueue); return; }   // cancelled while waiting
  _renderBusy = true;
  if (j) j.status = 'running';
  Promise.resolve()
    .then(next.run)
    .catch(() => {})                       // run() handles its own job state
    .finally(() => { _renderBusy = false; setImmediate(_pumpRenderQueue); });
}

function _webToFs(p) {
  if (!p) return null;
  if (p.startsWith('/uploads/')) return path.join(UPLOADS_DIR, p.slice('/uploads/'.length));
  if (p.startsWith('/finals/'))  return path.join(FINALS_DIR,  p.slice('/finals/'.length));
  return path.join(ROOT_DIR, p.replace(/^\//, ''));
}

// ── POST /api/ffmpeg/render ───────────────────────────────────────────────────
// Body: { segmentClips, clips, musicClips:[{url,start,end,speed,volume}], sfx,
//         sfxOffset, sfxVolume, transIn, transOut, outputLabel }
// segmentClips: [{ videoPath, start, end, crop }]  — avatar segments (sequential)
// clips:        [{ videoPath, start, end, crop }]  — biroly overlays (timed)
router.post('/ffmpeg/render', (req, res) => {
  const {
    segmentClips   = [],
    clips          = [],
    halferClips    = [],
    musicClips     = [],
    segVolume            = 1.0,
    segTransition        = 'fade',
    segTransitionParams  = {},
    segAnimation         = 'none',
    segAnimParams        = {},
    segFilter            = 'none',
    segFilterParams      = {},
    segSfx               = 'Нет',
    segSfxVolume         = 0.8,
    biroTransition       = 'fade',
    biroTransitionParams = {},
    biroAnimation        = 'none',
    biroAnimParams       = {},
    biroFilter           = 'none',
    biroFilterParams     = {},
    biroSfx              = 'Нет',
    biroSfxVolume        = 0.8,
    outputLabel          = '',
    advSettings          = {},
    subtitles            = [],
    srtSubtitles         = [],
    srtWords             = [],
    assSettings          = {},
    prebuiltAssPath      = null,
    smartCopy            = false,   // EXPERIMENTAL VSL stream-copy fast path (off by default)
  } = req.body;

  const jobId = `ff_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  console.log(`[ffmpeg/render] segs=${segmentClips.length} clips=${clips.length} halfers=${halferClips.length}`);
  const bodySnapshot = { segmentClips, clips, halferClips, musicClips,
                         segVolume,
                         segTransition, segTransitionParams,
                         segAnimation,  segAnimParams,
                         segFilter,     segFilterParams,
                         segSfx, segSfxVolume,
                         biroTransition, biroTransitionParams,
                         biroAnimation,  biroAnimParams,
                         biroFilter,     biroFilterParams,
                         biroSfx, biroSfxVolume,
                         outputLabel, advSettings, subtitles, srtSubtitles, srtWords, assSettings,
                         prebuiltAssPath, smartCopy };
  _jobs[jobId] = { status: 'queued', progressSecs: 0, url: null, error: null, body: bodySnapshot };
  res.json({ success: true, jobId });

  _enqueueRender(jobId, () =>
    // Smart-copy first (VSL, inserts-only edits); null → full pipeline.
    _smartRenderIfEligible({ ...bodySnapshot, jobId })
      .then(url => url || _buildAndRun({ ...bodySnapshot, jobId }))
      .then(url => { _jobs[jobId] = { ..._jobs[jobId], status: 'done', progressSecs: 0, url, error: null }; })
      .catch(e  => {
        // A cancel surfaces here as a rejection too — keep it labelled 'cancelled'
        // (not 'failed') so the UI doesn't report a phantom render error.
        const cancelled = (_jobs[jobId] && _jobs[jobId].status === 'cancelled') || /cancel/i.test(e && e.message || '');
        _jobs[jobId] = { ..._jobs[jobId], status: cancelled ? 'cancelled' : 'failed', progressSecs: 0, url: null, error: cancelled ? null : e.message };
      }));
});

// ── GET /api/ffmpeg/status/:jobId ─────────────────────────────────────────────
router.get('/ffmpeg/status/:jobId', (req, res) => {
  const j = _jobs[req.params.jobId];
  if (!j) return res.json({ success: false, error: 'job not found' });
  const { proc: _, body: __, ...safe } = j;   // don't send proc handle / heavy body over the wire
  const queuePos = j.status === 'queued' ? _queuePosOf(req.params.jobId) : null;
  res.json({ success: true, ...safe, queuePos });
});

// ── DELETE /api/ffmpeg/cancel/:jobId ─────────────────────────────────────────
router.delete('/ffmpeg/cancel/:jobId', (req, res) => {
  const j = _jobs[req.params.jobId];
  if (!j) return res.json({ success: false, error: 'job not found' });
  // Mark cancelled FIRST so the normalize loop / step chain bails between steps
  // (and so the queue pump skips it if it never started).
  j.status = 'cancelled';
  const qi = _renderQueue.findIndex(x => x.jobId === req.params.jobId);
  if (qi >= 0) _renderQueue.splice(qi, 1);
  if (j.proc) {
    const p = j.proc;
    try { p.kill('SIGTERM'); } catch {}
    // Force-kill if ffmpeg ignores SIGTERM, so the process actually leaves the system.
    setTimeout(() => { try { p.kill('SIGKILL'); } catch {} }, 2000);
    j.proc = null;
  }
  res.json({ success: true });
});

// ── GET /api/ffmpeg/body/:jobId — return stored request body ──────────────────
router.get('/ffmpeg/body/:jobId', (req, res) => {
  const j = _jobs[req.params.jobId];
  if (!j) return res.json({ success: false, error: 'job not found' });
  res.json({ success: true, body: j.body || {} });
});

// ── PUT /api/ffmpeg/body/:jobId — update stored request body ──────────────────
router.put('/ffmpeg/body/:jobId', (req, res) => {
  const j = _jobs[req.params.jobId];
  if (!j) return res.json({ success: false, error: 'job not found' });
  j.body = req.body;
  res.json({ success: true });
});

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
function _proxyCachePath(absSrc, h, rev) {
  let mtime = 0; try { mtime = Math.floor(fs.statSync(absSrc).mtimeMs); } catch {}
  const key = crypto.createHash('md5').update(absSrc + '|' + mtime + '|h' + h + (rev ? '|rev' : '')).digest('hex');
  return path.join(PREVIEW_CACHE_DIR, key + '_' + h + (rev ? '_rev' : '') + '.mp4');
}
function _makePreviewProxy(absSrc, outPath, h, rev) {
  // Scale the SHORTER side to <h> (portrait 1080x1920 -> hx.., landscape -> ..xh),
  // low bitrate, faststart for progressive seeking. Higher h = sharper + heavier.
  // rev=true also time-reverses video+audio so the preview can play a reversed
  // insert by simply playing this pre-reversed proxy forward.
  const crf = h >= 720 ? '27' : '30';
  const ab  = h >= 720 ? '96k' : '64k';
  const vf  = (rev ? 'reverse,' : '') + "scale='if(gt(iw,ih),-2," + h + ")':'if(gt(iw,ih)," + h + ",-2)':flags=bilinear";
  const args = [
    '-y', '-i', absSrc,
    '-vf', vf,
    ...(rev ? ['-af', 'areverse'] : []),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', crf, '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', ab, '-ar', '44100',
    '-movflags', '+faststart',
    outPath,
  ];
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    proc.stderr.on('data', c => { err += c.toString(); });
    proc.on('close', code => code === 0 ? resolve() : reject(new Error('proxy transcode failed (' + code + '): ' + err.slice(-300))));
    proc.on('error', reject);
  });
}
router.get('/ffmpeg/preview-proxy', async (req, res) => {
  try {
    const src = String(req.query.src || '');
    // VSL sources are hour-long: transcoding the whole file before responding
    // would stall the preview for many minutes — always serve the original.
    if (src.indexOf('/vsl/') === 0) return res.redirect(302, src);
    const abs = _webToFs(src);
    if (!abs || !fs.existsSync(abs)) return res.status(404).end();
    const absR = path.resolve(abs);
    const roots = [UPLOADS_DIR, FINALS_DIR, ROOT_DIR].map(r => path.resolve(r));
    if (!roots.some(r => absR === r || absR.startsWith(r + path.sep))) return res.status(403).end();

    const reqH = parseInt(req.query.h, 10);
    const h = PROXY_HEIGHTS.includes(reqH) ? reqH : 480;
    const rev = /^(1|true)$/i.test(String(req.query.rev || ''));
    const cachePath = _proxyCachePath(abs, h, rev);
    if (!fs.existsSync(cachePath)) {
      if (!_proxyInflight.has(cachePath)) {
        const tmp = cachePath + '.tmp.mp4';
        _proxyInflight.set(cachePath, _makePreviewProxy(abs, tmp, h, rev)
          .then(() => { fs.renameSync(tmp, cachePath); })
          .catch(e => { try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch {} throw e; })
          .finally(() => { _proxyInflight.delete(cachePath); }));
      }
      try { await _proxyInflight.get(cachePath); }
      catch (e) { console.warn('[ffmpeg/preview-proxy]', e.message); return res.redirect(302, src); }  // fall back to original
    }
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.sendFile(cachePath);
  } catch (e) {
    return res.status(500).end();
  }
});

// ── Animation filter (zoom only, motion-based) ──────────────────────────────
// Returns FFmpeg filter chain (no leading comma) or null. Caller chains it.
//   anim:   'zoom_in' | 'zoom_out'
//   params: { maxZoom: 1.05–1.50, easing: linear|ease-in|ease-out|ease-in-out, focal: tl|tc|tr|ml|mc|mr|bl|bc|br }
function _animFilter(anim, dur, W, H, params = {}) {
  if (anim !== 'zoom_in' && anim !== 'zoom_out') return null;
  const frames  = Math.max(1, Math.ceil(dur * 30));
  const maxZoom = parseFloat(params.maxZoom) || 1.15;
  const easing  = params.easing || 'linear';
  const focal   = params.focal  || 'mc';
  const POST    = ',format=yuv420p,setsar=1';

  // Progress expression P (0 → 1). Commas inside expressions need \\ escaping
  // because zoompan z=' ' is delimited by ':' but parsed by FFmpeg's expr engine
  // which is itself comma-aware via filter args. Escape to be safe.
  const PROG = {
    'linear':      `(on/${frames})`,
    'ease-in':     `(pow(on/${frames}\\,2))`,
    'ease-out':    `(1-pow(1-on/${frames}\\,2))`,
    'ease-in-out': `(0.5-0.5*cos(PI*on/${frames}))`,
  };
  const P = PROG[easing] || PROG.linear;

  // Zoom expression: zoom_in goes 1→max, zoom_out goes max→1
  const zExpr = anim === 'zoom_in'
    ? `1+(${maxZoom.toFixed(4)}-1)*${P}`
    : `${maxZoom.toFixed(4)}-(${maxZoom.toFixed(4)}-1)*${P}`;

  // Focal point → crop offset (in zoompan space, iw/ih are input dims)
  const FMAP = {
    tl: { x: '0',                  y: '0' },
    tc: { x: '(iw-iw/zoom)/2',     y: '0' },
    tr: { x: 'iw-iw/zoom',         y: '0' },
    ml: { x: '0',                  y: '(ih-ih/zoom)/2' },
    mc: { x: '(iw-iw/zoom)/2',     y: '(ih-ih/zoom)/2' },
    mr: { x: 'iw-iw/zoom',         y: '(ih-ih/zoom)/2' },
    bl: { x: '0',                  y: 'ih-ih/zoom' },
    bc: { x: '(iw-iw/zoom)/2',     y: 'ih-ih/zoom' },
    br: { x: 'iw-iw/zoom',         y: 'ih-ih/zoom' },
  };
  const f = FMAP[focal] || FMAP.mc;
  // Render zoompan at 2× resolution then scale down to halve sub-pixel jitter
  // (the cause of "shake" during zoom). Costs ~30% extra time on zoom step.
  return `zoompan=z='${zExpr}':x='${f.x}':y='${f.y}':d=1:s=${2*W}x${2*H}:fps=30,scale=${W}:${H}:flags=lanczos${POST}`;
}

// ── Filter (color / texture effects, no motion) ─────────────────────────────
// Returns filter chain (no leading comma) or null.
//   filt:   'vignette' | 'sharpen' | 'warm' | 'cool'
function _filterFilter(filt, params = {}) {
  const POST = ',format=yuv420p,setsar=1';
  switch (filt) {
    case 'vignette': {
      const strength = parseFloat(params.strength) || 0.78;
      const shape    = parseFloat(params.shape)    || 1.0;
      return `vignette=angle=${strength.toFixed(3)}:aspect=${shape.toFixed(3)}${POST}`;
    }
    case 'sharpen': {
      const amount = parseFloat(params.amount) || 1.0;
      let   size   = parseInt(params.size, 10) || 5;
      // unsharp requires odd kernel size 3..23
      if (size % 2 === 0) size += 1;
      size = Math.max(3, Math.min(23, size));
      const chroma = !!params.chroma;
      const chromaPart = chroma
        ? `:chroma_msize_x=${size}:chroma_msize_y=${size}:chroma_amount=${amount.toFixed(2)}`
        : '';
      return `unsharp=luma_msize_x=${size}:luma_msize_y=${size}:luma_amount=${amount.toFixed(2)}${chromaPart}${POST}`;
    }
    case 'warm': {
      const i = parseFloat(params.intensity) || 0.15;
      // gamma_r < 1 → boost red; gamma_b > 1 → reduce blue
      return `eq=gamma_r=${(1.0 - i).toFixed(3)}:gamma_b=${(1.0 + i).toFixed(3)}${POST}`;
    }
    case 'cool': {
      const i = parseFloat(params.intensity) || 0.15;
      // gamma_r > 1 → reduce red; gamma_b < 1 → boost blue
      return `eq=gamma_r=${(1.0 + i).toFixed(3)}:gamma_b=${(1.0 - i).toFixed(3)}${POST}`;
    }
    case 'glitch': {
      const intensity  = parseFloat(params.intensity) || 0.4;
      const glitchType = params.glitchType || 'continuous';
      const noiseLvl   = Math.round(10 + intensity * 50);   // 15..60
      const shift      = Math.max(1, Math.round(intensity * 8));  // 1..8 px
      let enableExpr = '';
      if (glitchType === 'bursts') {
        const rate    = parseFloat(params.burstRate) || 0.8;
        const period  = (1 / Math.max(0.1, rate)).toFixed(3);
        const burst   = '0.08';   // 80ms flash
        // Fires for `burst` seconds every `period` seconds
        enableExpr = `:enable='lt(mod(t\\,${period})\\,${burst})'`;
      }
      // rgbashift works in RGB (no green YUV-edge artifacts like chromashift)
      // edge=smear replicates edge pixels instead of filling with default
      return `noise=alls=${noiseLvl}:allf=t+u${enableExpr},rgbashift=rh=${shift}:bh=${-shift}:edge=smear${enableExpr}${POST}`;
    }
    case 'bw': {
      const strength = parseFloat(params.strength); // 0..1; default below
      const s        = isNaN(strength) ? 1.0 : Math.max(0, Math.min(1, strength));
      const contrast = parseFloat(params.contrast) || 1.0;
      // hue saturation: 0 = full grayscale, 1 = full color
      // For strength → saturation: s=1 → sat=0; s=0 → sat=1
      return `hue=s=${(1 - s).toFixed(3)},eq=contrast=${contrast.toFixed(3)}${POST}`;
    }
    case 'vhs': {
      const i = parseFloat(params.intensity) || 0.5;
      // Combine: subtle noise + rgbashift + slight desaturation + warm-ish gamma
      const noiseLvl = Math.round(i * 18);             // 0..18
      const shift    = Math.max(1, Math.round(i * 4)); // 1..4
      const sat      = (1.0 - i * 0.25).toFixed(3);    // 0.75..1.0
      const gammaR   = (1.0 + i * 0.10).toFixed(3);    // slight warm
      // rgbashift in RGB space + edge=smear → no green YUV artifacts on edges
      return `noise=alls=${noiseLvl}:allf=t+u,rgbashift=rh=${shift}:bh=${-shift}:edge=smear,eq=saturation=${sat}:gamma_r=${gammaR}${POST}`;
    }
    case 'cinematic': {
      const s = parseFloat(params.strength) || 0.5;
      // Teal-orange grade via colorbalance:
      //   shadows → blue/teal (rs<0, bs>0)
      //   highlights → orange (rh>0, bh<0)
      const shift = (s * 0.30).toFixed(3);
      return `colorbalance=rs=-${shift}:bs=${shift}:rh=${shift}:bh=-${shift}${POST}`;
    }
    case 'sepia': {
      const s  = parseFloat(params.strength); // 0..1
      const k  = isNaN(s) ? 1.0 : Math.max(0, Math.min(1, s));
      // Blend identity matrix with full-sepia matrix by k
      // identity: rr=1 rg=0 rb=0 / gr=0 gg=1 gb=0 / br=0 bg=0 bb=1
      // sepia:    rr=.393 rg=.769 rb=.189 / gr=.349 gg=.686 gb=.168 / br=.272 bg=.534 bb=.131
      const rr = (1   - 0.607 * k).toFixed(4);
      const rg = (0.769 * k).toFixed(4);
      const rb = (0.189 * k).toFixed(4);
      const gr = (0.349 * k).toFixed(4);
      const gg = (1   - 0.314 * k).toFixed(4);
      const gb = (0.168 * k).toFixed(4);
      const br = (0.272 * k).toFixed(4);
      const bg = (0.534 * k).toFixed(4);
      const bb = (1   - 0.869 * k).toFixed(4);
      return `colorchannelmixer=${rr}:${rg}:${rb}:0:${gr}:${gg}:${gb}:0:${br}:${bg}:${bb}:0${POST}`;
    }
    default:
      return null;
  }
}

// ── Convert #rrggbb + alpha to ASS colour (&HAABBGGRR) ───────────────────────
function _hexToAss(hex, alphaInt = 0) {
  const h = (hex || '#000000').replace('#', '').padEnd(6, '0');
  const r = h.slice(0, 2).toUpperCase();
  const g = h.slice(2, 4).toUpperCase();
  const b = h.slice(4, 6).toUpperCase();
  const a = Math.min(255, Math.max(0, Math.round(alphaInt))).toString(16).padStart(2, '0').toUpperCase();
  return `&H${a}${b}${g}${r}`;
}

// ── Format seconds as ASS timestamp H:MM:SS.cs ───────────────────────────────
function _fmtAssTime(secs) {
  const s  = Math.max(0, secs);
  const h  = Math.floor(s / 3600);
  const m  = Math.floor((s % 3600) / 60);
  const sc = Math.floor(s % 60);
  const cs = Math.round((s - Math.floor(s)) * 100);
  return `${h}:${String(m).padStart(2,'0')}:${String(sc).padStart(2,'0')}.${String(cs).padStart(2,'0')}`;
}

// ── Position alignment map ────────────────────────────────────────────────────
// 15-key (3×5) → ASS \an value + row type (for \pos override where needed)
const _POS_MAP = {
  tl:{an:7,row:'top'},    tc:{an:8,row:'top'},    tr:{an:9,row:'top'},
  ul:{an:7,row:'upper'},  uc:{an:8,row:'upper'},  ur:{an:9,row:'upper'},
  ml:{an:4,row:'middle'}, mc:{an:5,row:'middle'}, mr:{an:6,row:'middle'},
  ll:{an:1,row:'lower'},  lc:{an:2,row:'lower'},  lr:{an:3,row:'lower'},
  bl:{an:1,row:'bottom'}, bc:{an:2,row:'bottom'}, br:{an:3,row:'bottom'},
};

// ── Group raw word array into subtitle lines ──────────────────────────────────
function _groupWords(words, wordsPerLine) {
  if (!words || !words.length) return [];
  const n = (wordsPerLine > 0) ? wordsPerLine : words.length;
  const subs = [];
  for (let i = 0; i < words.length; i += n) {
    const chunk = words.slice(i, i + n);
    const text  = chunk.map(w => w.text).join(' ');
    const start = chunk[0].start;
    const end   = chunk[chunk.length - 1].end;
    if (text && end > start) subs.push({ text, start, end, words: chunk });
  }
  return subs;
}

// Neutralize ASS-special characters in subtitle TEXT so arbitrary spoken text
// renders literally: libass reads { } as override blocks and \ as a tag prefix.
// Commas / apostrophes / colons need no escaping in the Dialogue Text field.
function _assEscapeText(s) {
  return String(s == null ? '' : s).replace(/\\/g, '/').replace(/[{}]/g, '');
}

// ── Build .ass subtitle file content ─────────────────────────────────────────
function _buildAssContent(subtitlesIn, assSettings, W, H, srtWords) {
  const {
    fontName        = 'Arial',
    fontSize        = 60,
    bold            = false,
    italic          = false,
    primaryColor    = '#ffffff',
    secondaryColor  = '#ff0000',
    outlineColor    = '#000000',
    shadowColor     = '#000000',
    backColor       = '#000000',
    backAlpha       = 128,
    borderStyle     = 1,
    outline         = 2.5,
    shadow          = 1,
    blur            = 0,
    posAlign        = 'bc',
    posY: posYPct   = null,
    rotationPreset  = 'none',
    animPreset      = 'none',
    appearPreset    = 'fade_std',
    karaokeStyle    = 'none',
    wrapStyle       = 0,
    wordsPerLine    = 7,
  } = assSettings;

  // Re-group if we have raw words
  const subtitles = (srtWords && srtWords.length && wordsPerLine > 0)
    ? _groupWords(srtWords, wordsPerLine)
    : subtitlesIn;

  const primaryAss   = _hexToAss(primaryColor, 0);
  const secondaryAss = _hexToAss(secondaryColor, 0);
  const outlineAss   = _hexToAss(outlineColor, 0);
  const shadowAss    = _hexToAss(shadowColor, 0);
  const backAss      = _hexToAss(backColor, backAlpha);
  const boldInt      = bold   ? -1 : 0;
  const italicInt    = italic ? -1 : 0;

  // Resolve position
  const pos        = _POS_MAP[posAlign] || _POS_MAP['bc'];
  let   anValue    = pos.an;
  const marginV    = 60;
  const marginL    = 20;
  const marginR    = 20;

  // Compute \pos for upper/lower rows (top/middle/bottom use standard ASS alignments)
  const colKey = posAlign ? posAlign.slice(1) : 'c';
  const cx = colKey === 'l' ? Math.round(W * 0.12) : colKey === 'r' ? Math.round(W * 0.88) : Math.round(W / 2);
  let needPos = false, posY = 0;
  const posYNum = (posYPct != null && posYPct !== '') ? Number(posYPct) : null;
  if (posYNum != null && !isNaN(posYNum)) {
    // Explicit drag-set vertical: posY% = block CENTER. Anchor to the middle row
    // (\an 4/5/6 keeps the horizontal column) and \pos at the requested height.
    needPos = true;
    posY = Math.round(H * (Math.max(0, Math.min(100, posYNum)) / 100));
    anValue = colKey === 'l' ? 4 : colKey === 'r' ? 6 : 5;
  } else {
    if (pos.row === 'upper') { needPos = true; posY = Math.round(H * 0.25); }
    if (pos.row === 'lower') { needPos = true; posY = Math.round(H * 0.72); }
    // middle row → ASS \an 4/5/6 (native center row, no \pos needed)
  }

  const lines = [
    '[Script Info]',
    'ScriptType: v4.00+',
    'Collisions: Normal',
    `PlayResX: ${W}`,
    `PlayResY: ${H}`,
    `WrapStyle: ${wrapStyle}`,
    'Timer: 100.0000',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Default,${fontName},${fontSize},${primaryAss},${secondaryAss},${outlineAss},${backAss},${boldInt},${italicInt},0,0,100,100,0,0,${borderStyle},${parseFloat(outline).toFixed(1)},${parseFloat(shadow).toFixed(1)},${anValue},${marginL},${marginR},${marginV},1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];

  for (const sub of subtitles) {
    if (!sub.text || sub.end <= sub.start) continue;
    const t0  = _fmtAssTime(sub.start);
    const t1  = _fmtAssTime(sub.end);
    const dur = sub.end - sub.start;   // seconds

    let ov = '';

    // ── Position override for upper/lower rows ──────────────────────────────
    if (needPos) ov += `\\an${anValue}\\pos(${cx},${posY})`;

    // ── 3D Rotation preset ──────────────────────────────────────────────────
    if (rotationPreset === 'tilt_left')   ov += '\\frz8';
    else if (rotationPreset === 'tilt_right')  ov += '\\frz-8';
    else if (rotationPreset === 'tilt_strong') ov += '\\frz20';
    else if (rotationPreset === 'perspective') ov += '\\fry25\\frx5';
    else if (rotationPreset === 'flip3d')      ov += '\\frx180';

    // ── Blur ────────────────────────────────────────────────────────────────
    if (blur > 0) ov += `\\blur${parseFloat(blur).toFixed(1)}`;

    // ── Appearance preset (\fad / \move / \fscx) ───────────────────────────
    if (appearPreset === 'fade_std') {
      ov += '\\fad(200,150)';
    } else if (appearPreset === 'fade_soft') {
      ov += '\\fad(400,300)';
    } else if (appearPreset === 'pop_in') {
      ov += `\\fscx0\\fscy0\\t(0,150,\\fscx100\\fscy100)\\fad(0,150)`;
    } else if (appearPreset === 'slide_up') {
      const cy1 = needPos ? posY      : Math.round(H - marginV);
      const cy0 = cy1 + 80;
      ov += `\\an${anValue}\\move(${cx},${cy0},${cx},${cy1},0,250)\\fad(150,150)`;
    }

    // ── Animation preset via \t() ───────────────────────────────────────────
    if (animPreset === 'pulse') {
      ov += '\\t(0,400,\\fscx110\\fscy110)\\t(400,800,\\fscx100\\fscy100)';
    } else if (animPreset === 'grow_in') {
      ov += '\\fscx70\\fscy70\\t(0,300,\\fscx100\\fscy100)';
    } else if (animPreset === 'glow') {
      ov += `\\t(0,500,\\blur8)\\t(500,1000,\\blur${parseFloat(blur).toFixed(1) || '0'})`;
    } else if (animPreset === 'color_shift') {
      const sec2  = _hexToAss('#ffff00', 0);
      ov += `\\t(0,500,1c${sec2})\\t(500,1000,1c${primaryAss})`;
    } else if (animPreset === 'fade_combo') {
      ov += '\\alpha&HFF&\\t(0,250,\\alpha&H00&\\fscx100\\fscy100)\\fscx80\\fscy80';
    } else if (animPreset === 'wobble') {
      ov += '\\t(0,100,\\frz5)\\t(100,200,\\frz-5)\\t(200,300,\\frz3)\\t(300,400,\\frz0)';
    } else if (animPreset === 'outline_flash') {
      const flashOut = _hexToAss('#ffffff', 0);
      ov += `\\t(0,100,3c${flashOut})\\t(100,250,3c${outlineAss})`;
    } else if (animPreset === 'slow_zoom') {
      const ms = Math.round(dur * 1000);
      ov += `\\fscx95\\fscy95\\t(0,${ms},\\fscx105\\fscy105)`;
    }

    // ── Karaoke style (word-level timing) ───────────────────────────────────
    const words    = sub.words || [];
    const useKarao = karaokeStyle !== 'none' && words.length > 0;

    let text;
    if (useKarao) {
      const kTag = karaokeStyle === 'kf' ? 'kf' : karaokeStyle === 'ko' ? 'ko' : 'k';
      text = words.map(w => {
        const cs = Math.round((w.end - w.start) * 100);
        return `{\\${kTag}${cs}}${_assEscapeText(w.text)}`;
      }).join(' ');
    } else {
      text = _assEscapeText(sub.text).replace(/\n/g, '\\N');
    }

    const tagBlock = ov ? `{${ov}}` : '';
    lines.push(`Dialogue: 0,${t0},${t1},Default,,0,0,0,,${tagBlock}${text}`);
  }

  return lines.join('\n');
}

// ── Escape a filesystem path for FFmpeg filter_complex value ─────────────────
function _escapeFilterPath(p) {
  // Replace backslashes with forward slashes, then escape colons
  return p.replace(/\\/g, '/').replace(/:/g, '\\:');
}

// ── Escape text for FFmpeg drawtext (inside single-quoted value) ──────────────
function _escapeDrawtext(s) {
  return (s || '')
    .replace(/\\/g,  '\\\\')  // backslash → \\
    .replace(/'/g,   "\\'")   // single quote → \'
    .replace(/\n/g,  ' ')     // newline → space
    .replace(/\r/g,  '')
    .slice(0, 300);
}

// ── Convert #rrggbb to FFmpeg 0xRRGGBB ────────────────────────────────────────
function _hexToFfColor(hex) {
  return '0x' + (hex || '#ffffff').replace('#', '');
}

// ── Core render ───────────────────────────────────────────────────────────────
async function _buildAndRun({ segmentClips, clips, halferClips = [],
                               musicClips = [],
                               segVolume,
                               segTransition, segTransitionParams = {},
                               segAnimation,  segAnimParams = {},
                               segFilter = 'none', segFilterParams = {},
                               segSfx, segSfxVolume,
                               biroTransition, biroTransitionParams = {},
                               biroAnimation,  biroAnimParams = {},
                               biroFilter = 'none', biroFilterParams = {},
                               biroSfx, biroSfxVolume,
                               outputLabel, advSettings = {}, subtitles = [],
                               srtSubtitles = [], srtWords = [], assSettings = {},
                               prebuiltAssPath = null, jobId, outPathOverride = null }) {
  const {
    resolution   = '1080x1920',
    fps          = 30,
    crf          = 23,
    preset       = 'fast',
    audioBitrate = '192k',
    eqBrightness = 0,
    eqContrast   = 1,
    eqSaturation = 1,
    eqGamma      = 1,
    subsEnabled  = false,
    subsFontSize = 48,
    subsPosition = 'bottom',
    subsColor    = '#ffffff',
    subsStyle    = 'outline',
    extra1       = 'none',
    extra2       = 'none',
  } = advSettings;

  const [W, H] = resolution.split('x').map(Number).map(n => (n > 0 ? n : 1080));
  const FPS = parseFloat(fps) || 30;                                  // float: smart-copy pieces match the source rate (e.g. 29.97)
  const AR  = parseInt(advSettings.audioRate) || 44100;               // smart-copy pieces match the source sample rate

  // ── Pre-merge normalization ───────────────────────────────────────────────
  // Force every input clip through normalizeVideoForBrowser before the merge
  // pipeline picks them up. Without this, Replicate-produced mp4s with exotic
  // codec profiles can't be decoded by ffmpeg-static, and the entire render
  // silently fails. Cached via `<path>.norm` marker file so re-merges of the
  // same project skip already-normalized clips. VSL sources are exempt: they
  // are hour-long files (normalizing one is a full second transcode) and must
  // stay byte-identical for smart-copy renders.
  const _segsToNormalize = segmentClips.filter(c => !String(c.videoPath || '').startsWith('/vsl/'));
  await _normalizeAllInputs(jobId, [_segsToNormalize, clips, halferClips]);

  const args = [];
  let inputIdx = 0;
  const segs    = [];   // { idx, dur }
  const biros   = [];   // { idx, start, end, dur }
  const halfers = [];   // { idx, start, end, dur, halferAlign, ... }

  // ── Segment clip inputs ───────────────────────────────────────────────────
  for (const sc of segmentClips) {
    const dur  = parseFloat(sc.end) - parseFloat(sc.start);   // timeline dur (already audioDur/speed)
    if (dur <= 0) continue;
    const trim  = parseFloat(sc.crop) || 0;
    const speed = parseFloat(sc.speed) || 1;
    // Talking-head speed: read (dur*speed) sec of source, then setpts/atempo retime to `dur`.
    const sourceDur = dur * (speed > 0 ? speed : 1);

    if (sc.voiceOnly || !sc.videoPath) {
      // Voice-only fragment (audio, no video): synth a black video + the voice audio.
      // Two inputs → vidx (black) + aidx (voice) tracked separately.
      const afp = _webToFs(sc.audioPath);
      if (!afp || !fs.existsSync(afp)) continue;   // no audio either → nothing to render
      args.push('-f', 'lavfi', '-t', String(sourceDur.toFixed(6)), '-i', `color=c=black:s=${W}x${H}:r=${FPS}`);
      const vidx = inputIdx++;
      args.push('-ss', String(trim), '-t', String(sourceDur.toFixed(6)), '-i', afp);   // trim = in-point (start trim)
      const aidx = inputIdx++;
      segs.push({ vidx, aidx, dur, speed, reversed: false, voiceOnly: true,
        transition: sc.transition, transitionParams: sc.transitionParams,
        animation: sc.animation, animParams: sc.animParams,
        filter: sc.filter, filterParams: sc.filterParams });
      continue;
    }

    const fp = _webToFs(sc.videoPath);
    if (!fp) throw new Error(`Неверный путь: ${sc.videoPath}`);
    if (!fs.existsSync(fp)) throw new Error(`Файл не найден: ${sc.videoPath}`);
    args.push('-ss', String(trim), '-t', String(sourceDur.toFixed(6)), '-i', fp);
    const idx = inputIdx++;
    segs.push({ vidx: idx, aidx: idx, dur, speed, reversed: !!sc.reversed,
      transition: sc.transition, transitionParams: sc.transitionParams,
      animation: sc.animation, animParams: sc.animParams,
      filter: sc.filter, filterParams: sc.filterParams });
  }

  if (segs.length === 0) throw new Error('Нет сегментов видео для рендера');

  // ── Biroly overlay inputs ─────────────────────────────────────────────────
  // -an: discard audio — many biro files have no audio; avoids [idx:a] stream errors
  for (const bc of clips) {
    const fp = _webToFs(bc.videoPath);
    if (!fp || !fs.existsSync(fp)) continue;
    const timelineDur = parseFloat(bc.end) - parseFloat(bc.start);
    if (timelineDur <= 0) continue;
    const trim  = parseFloat(bc.trimIn) || 0;   // source in-point (start trim) — applied as -ss
    const speed = parseFloat(bc.speed) || 1;
    const start = parseFloat(bc.start);
    // Read (timelineDur * speed) seconds from source so setpts can compress/expand it to timelineDur.
    // -stream_loop -1 loops the file if it's shorter than sourceDur (e.g. a 2s clip filling 6s).
    const sourceDur = timelineDur * speed;
    // Keep this insert's audio only when toggled AND the source actually has audio.
    const wantAudio = !!bc.audio && await _hasAudioStream(fp);
    args.push('-stream_loop', '-1', ...(wantAudio ? [] : ['-an']), '-ss', String(trim), '-t', String(sourceDur.toFixed(6)), '-i', fp);
    biros.push({ idx: inputIdx++, start, end: parseFloat(bc.end), dur: timelineDur, speed, audio: wantAudio, volume: (bc.volume != null) ? bc.volume : 1, cropAlign: bc.cropAlign || 'center', reversed: !!bc.reversed,
      tx: bc.tx, ty: bc.ty, tw: bc.tw,   // optional picture-in-picture transform
      transition: bc.transition, transitionParams: bc.transitionParams,
      animation: bc.animation, animParams: bc.animParams,
      filter: bc.filter, filterParams: bc.filterParams });
  }

  // ── Halfer overlay inputs (2/5-height bands placed top or bottom) ─────────
  for (const hc of halferClips) {
    const fp = _webToFs(hc.videoPath);
    if (!fp || !fs.existsSync(fp)) continue;
    const timelineDur = parseFloat(hc.end) - parseFloat(hc.start);
    if (timelineDur <= 0) continue;
    const trim  = parseFloat(hc.trimIn) || 0;   // source in-point (start trim) — applied as -ss
    const speed = parseFloat(hc.speed) || 1;
    const start = parseFloat(hc.start);
    const sourceDur = timelineDur * speed;
    const wantAudio = !!hc.audio && await _hasAudioStream(fp);
    args.push('-stream_loop', '-1', ...(wantAudio ? [] : ['-an']), '-ss', String(trim), '-t', String(sourceDur.toFixed(6)), '-i', fp);
    halfers.push({
      idx: inputIdx++, start, end: parseFloat(hc.end), dur: timelineDur, speed, audio: wantAudio, volume: (hc.volume != null) ? hc.volume : 1,
      cropAlign:   hc.cropAlign   || 'center',
      halferAlign: hc.halferAlign || 'top',
      rotation:    (hc.rotation != null) ? (((parseInt(hc.rotation, 10) || 0) % 360 + 360) % 360) : 90,
      valign:      hc.valign || 'top',
      reversed:    !!hc.reversed,
    });
  }

  // ── Audio inputs ──────────────────────────────────────────────────────────
  let segSfxIdx = -1, biroSfxIdx = -1;
  const _validA = s => s && s !== 'Нет' && s !== 'Рандом';
  // Music clips (multi-instance): one input each; remember its assigned input index.
  const _musicInputs = [];
  for (const mc of (musicClips || [])) {
    if (!mc || !_validA(mc.url)) continue;
    const isLocal = mc.url.startsWith('/');
    const fp  = isLocal ? _webToFs(mc.url) : null;
    const src = fp || mc.url;
    if (!isLocal || (fp && fs.existsSync(fp))) { args.push('-i', src); _musicInputs.push({ idx: inputIdx++, mc }); }
  }
  if (_validA(segSfx)) {
    const fp = _webToFs(segSfx);
    if (fp && fs.existsSync(fp)) { args.push('-i', fp); segSfxIdx = inputIdx++; }
  }
  if (_validA(biroSfx)) {
    const fp = _webToFs(biroSfx);
    if (fp && fs.existsSync(fp)) { args.push('-i', fp); biroSfxIdx = inputIdx++; }
  }

  // ── filter_complex ────────────────────────────────────────────────────────
  const F = [];
  const FD = 0.35; // fade duration per clip (seconds)

  // Build N=5 stacked filters that approximate a smooth ramp (in + out).
  //   D:        transition duration (sec)   •   st: out-segment start time
  //   maxValue: filter intensity at the boundary (drops to maxValue/N at the inner step)
  //   makeFilter(value, t0, t1) returns a single filter string starting with ','.
  function _stackedRamp(D, st, maxValue, makeFilter) {
    const N = 5;
    const stepDur = D / N;
    let out = '';
    // In ramp: at boundary fully strong, fades inward
    for (let i = 0; i < N; i++) {
      const v  = maxValue * (1 - i / N);
      const t0 = (i * stepDur).toFixed(3);
      const t1 = ((i + 1) * stepDur).toFixed(3);
      out += makeFilter(v, t0, t1);
    }
    // Out ramp: mirrored — gradually intensifies toward end of clip
    for (let i = 0; i < N; i++) {
      const v  = maxValue * ((i + 1) / N);
      const t0 = (st + i * stepDur).toFixed(3);
      const t1 = (st + (i + 1) * stepDur).toFixed(3);
      out += makeFilter(v, t0, t1);
    }
    return out;
  }

  // Build paired-transition filter string for a clip of given duration.
  //   trans:  one of TRANS_OPTS values  •  dur: clip duration in seconds
  //   params: { duration?, intensity?, direction?, zoomFactor?, easing? }
  // Returns string with leading comma (or '' for none).
  function _pairedTrans(trans, dur, params = {}) {
    if (!trans || trans === 'none') return '';
    const D  = parseFloat(params.duration) || FD;
    const d  = Math.min(D, dur / 3).toFixed(3);
    const st = Math.max(0, dur - parseFloat(d)).toFixed(3);

    switch (trans) {
      case 'fade':
      case 'fadewhite':
      case 'fadegrays': {
        const color = trans === 'fadewhite' ? ':color=white'
                    : trans === 'fadegrays' ? ':color=gray'  : '';
        return `,fade=in:st=0:d=${d}${color},fade=out:st=${st}:d=${d}${color}`;
      }
      case 'blur': {
        const sigmaMax = parseFloat(params.intensity) || 20;
        return _stackedRamp(parseFloat(d), parseFloat(st), sigmaMax,
          (v, t0, t1) => `,gblur=sigma=${v.toFixed(2)}:enable='between(t\\,${t0}\\,${t1})'`);
      }
      case 'flash-white': {
        // Bright white flash at edges (fade through white)
        return `,fade=in:st=0:d=${d}:color=white,fade=out:st=${st}:d=${d}:color=white`;
      }
      case 'whip-pan-h': {
        // Asymmetric horizontal motion blur — stacked 5 steps for smooth ramp
        return _stackedRamp(parseFloat(d), parseFloat(st), 30,
          (v, t0, t1) => `,gblur=sigma=${v.toFixed(2)}:sigmaV=5:enable='between(t\\,${t0}\\,${t1})'`);
      }
      case 'whip-pan-v': {
        // Vertical motion blur — stacked 5 steps
        return _stackedRamp(parseFloat(d), parseFloat(st), 30,
          (v, t0, t1) => `,gblur=sigma=5:sigmaV=${v.toFixed(2)}:enable='between(t\\,${t0}\\,${t1})'`);
      }
      case 'zoom-punch-in':
      case 'zoom-punch-out': {
        // zoompan supports `on` (output frame counter) but NOT `t` in z expr.
        // Convert seconds → frames at 30fps.
        const zf       = parseFloat(params.zoomFactor) || 1.2;
        const dFrames  = Math.max(1, Math.round(parseFloat(d) * FPS));
        const stFrames = Math.max(0, Math.round(parseFloat(st) * FPS));
        const zfStr    = zf.toFixed(3);
        let zExpr;
        if (trans === 'zoom-punch-in') {
          // At on<dFrames: zoom from zf → 1; rest: 1
          zExpr = `if(lt(on\\,${dFrames})\\,${zfStr}-(${zfStr}-1)*on/${dFrames}\\,1)`;
        } else {
          // At on>stFrames: zoom from 1 → zf; rest: 1
          zExpr = `if(gt(on\\,${stFrames})\\,1+(${zfStr}-1)*(on-${stFrames})/${dFrames}\\,1)`;
        }
        // 2× resolution + lanczos downscale → eliminates sub-pixel shake
        return `,zoompan=z='${zExpr}':x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2':d=1:s=${2*W}x${2*H}:fps=${FPS},scale=${W}:${H}:flags=lanczos,format=yuv420p,setsar=1`;
      }
      case 'glitch': {
        const intensity = parseFloat(params.intensity) || 0.6;
        // noise=alls 0..100 — map intensity 0.3..1.0 → ~26..50
        const lvlMax = Math.round(20 + intensity * 30);
        return _stackedRamp(parseFloat(d), parseFloat(st), lvlMax,
          (v, t0, t1) => `,noise=alls=${Math.round(v)}:allf=t+u:enable='between(t\\,${t0}\\,${t1})'`);
      }
      default:
        return '';
    }
  }

  // Scale + animate + filter + paired-transition each segment, 30fps
  for (const s of segs) {
    // Per-clip effect override falls back to the track-level seg* value.
    const animF    = _animFilter(s.animation != null ? s.animation : segAnimation, s.dur, W, H, s.animParams != null ? s.animParams : segAnimParams);
    const filterF  = _filterFilter(s.filter != null ? s.filter : segFilter, s.filterParams != null ? s.filterParams : segFilterParams);
    const transF   = _pairedTrans(s.transition != null ? s.transition : segTransition, s.dur, s.transitionParams != null ? s.transitionParams : segTransitionParams);
    const revPrefix = s.reversed ? 'reverse,' : '';
    const spdFactor = (1 / (s.speed || 1)).toFixed(8);   // talking-head speed: shrink/stretch video PTS
    F.push(
      `[${s.vidx}:v]${revPrefix}setpts=${spdFactor}*(PTS-STARTPTS),format=yuv420p,setsar=1,` +
      `scale=${W}:${H}:force_original_aspect_ratio=decrease:force_divisible_by=2,` +
      `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=${FPS}` +
      (animF   ? `,${animF}`   : '') +
      (filterF ? `,${filterF}` : '') +
      transF + `[sv${s.vidx}]`
    );
  }

  // ── Build main video stream (simple concat, paired fades handle transitions) ─
  let mainV;
  if (segs.length === 1) {
    mainV = `sv${segs[0].vidx}`;
  } else {
    F.push(segs.map(s => `[sv${s.vidx}]`).join('') + `concat=n=${segs.length}:v=1:a=0[mainV]`);
    mainV = 'mainV';
  }

  // ── Biroly overlays (full-screen, paired transitions) ────────────────────
  let curV = mainV;
  for (const b of biros) {
    // Per-clip effect override falls back to the track-level biro* value.
    const animF   = _animFilter(b.animation != null ? b.animation : biroAnimation, b.dur, W, H, b.animParams != null ? b.animParams : biroAnimParams);
    const filterF = _filterFilter(b.filter != null ? b.filter : biroFilter, b.filterParams != null ? b.filterParams : biroFilterParams);
    const transF  = _pairedTrans(b.transition != null ? b.transition : biroTransition, b.dur, b.transitionParams != null ? b.transitionParams : biroTransitionParams);
    // setpts=(1/speed)*(PTS-STARTPTS): reset to t=0 AND apply playback speed.
    //   speed>1 → (1/speed)<1 → PTS shrink → faster; speed<1 → slower.
    // Source input was trimmed to (timelineDur*speed) so this always fills timelineDur exactly.
    // reverse filter (when enabled) reverses the trimmed segment before speed/crop are applied.
    const spdFactor  = (1 / (b.speed || 1)).toFixed(8);
    const spdFilter  = `setpts=${spdFactor}*(PTS-STARTPTS)`;
    const revPrefix  = b.reversed ? 'reverse,' : '';
    // Picture-in-picture: when a transform is set, scale the insert to tw*W
    // keeping its native aspect and overlay at (tx*W, ty*H); otherwise it fills
    // the frame (scale-to-cover + crop) and overlays at 0,0 as before.
    const pip = (b.tw != null && +b.tw > 0 && +b.tw < 0.999);
    let geom, ovX = '0', ovY = '0';
    if (pip) {
      const pw = Math.max(2, Math.round(W * Math.max(0.02, Math.min(1, +b.tw))) / 2) * 2;  // even width
      geom = `scale=${pw}:-2:force_divisible_by=2,setsar=1,fps=${FPS}`;
      ovX = String(Math.round(W * Math.max(0, Math.min(1, +b.tx || 0))));
      ovY = String(Math.round(H * Math.max(0, Math.min(1, +b.ty || 0))));
    } else {
      geom = `scale=${W}:${H}:force_original_aspect_ratio=increase:force_divisible_by=2,` +
        `crop=${W}:${H}:${b.cropAlign === 'left' ? '0' : b.cropAlign === 'right' ? 'iw-ow' : '(iw-ow)/2'}:0,setsar=1,fps=${FPS}`;
    }
    F.push(
      `[${b.idx}:v]${revPrefix}${spdFilter},format=yuv420p,setsar=1,` +
      geom +
      (animF && !pip ? `,${animF}` : '') +   // zoompan rebakes to WxH — skip for PiP
      (filterF ? `,${filterF}` : '') +
      transF +
      `,setpts=PTS+${b.start.toFixed(6)}/TB` +
      `[bv${b.idx}]`
    );
    const tag = `ov${b.idx}`;
    F.push(`[${curV}][bv${b.idx}]overlay=${ovX}:${ovY}:eof_action=pass:repeatlast=0[${tag}]`);
    curV = tag;
  }

  // ── Halfer overlays (2/5-height band, top or bottom, 20px feather) ────────
  // Each halfer is scaled to cover full output width × 2H/5, then a soft alpha
  // gradient (geq) creates a 20-pixel feather on the inner edge: bottom edge
  // for top-halfers, top edge for bottom-halfers. The clip is offset along the
  // timeline via setpts and overlaid at y=0 (top) or y=H-2H/5 (bottom).
  // Halfer audio is muted at the input stage (-an).
  if (halfers.length) console.log(`[ffmpeg] halfers: ${halfers.length} overlay(s)`);
  // 2/5 of output height, rounded to even (yuv420 / overlay friendliness).
  let HALF_H = Math.round(H * 2 / 5);
  if (HALF_H % 2) HALF_H++;
  if (HALF_H < 2) HALF_H = 2;
  const FEATHER = 20;
  for (const h of halfers) {
    const spdFactor  = (1 / (h.speed || 1)).toFixed(8);
    const spdFilter  = `setpts=${spdFactor}*(PTS-STARTPTS)`;
    const revPrefix  = h.reversed ? 'reverse,' : '';
    // Band content rotation (default 90 CW = legacy). transpose=1 (90 CW),
    // transpose=2 (270 CW / 90 CCW), two transposes for 180.
    const rotH = (h.rotation != null) ? (((parseInt(h.rotation, 10) || 0) % 360 + 360) % 360) : 90;
    const rotF = rotH === 90 ? 'transpose=1,' : rotH === 270 ? 'transpose=2,' : rotH === 180 ? 'transpose=2,transpose=2,' : '';
    // 90/270 stretch to fill the band (legacy). 0/180 COVER (keep aspect, crop the
    // overflow vertically per valign) so the content isn't distorted.
    const scaleF = (rotH === 0 || rotH === 180)
      ? `scale=${W}:${HALF_H}:force_original_aspect_ratio=increase,crop=${W}:${HALF_H}:0:${h.valign === 'bottom' ? `ih-${HALF_H}` : '0'},`
      : `scale=${W}:${HALF_H},`;
    // Vertical placement on the main video output.
    const posY = h.halferAlign === 'bottom' ? `${H - HALF_H}` : '0';
    // Feather: top-halfers feather along bottom edge (Y near HALF_H-1),
    // bottom-halfers feather along top edge (Y near 0).
    const alphaExpr = h.halferAlign === 'bottom'
      ? `min(255,255*Y/${FEATHER})`
      : `min(255,255*(${HALF_H - 1}-Y)/${FEATHER})`;

    // Halfer is rotated 90° clockwise (so a portrait source becomes landscape)
    // then stretched to fit W × HALF_H exactly. The user picked horizontal-video
    // halfers; aspect ratio of the source is intentionally not preserved.
    // cropAlign is unused after the stretch but kept on the data for future use.
    F.push(
      `[${h.idx}:v]${revPrefix}${spdFilter},format=rgba,setsar=1,` +
      rotF + scaleF +
      `setsar=1,fps=${FPS},format=rgba,` +
      `geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='${alphaExpr}',` +
      `setpts=PTS+${h.start.toFixed(6)}/TB[hv${h.idx}]`
    );
    const tag = `ovh${h.idx}`;
    F.push(`[${curV}][hv${h.idx}]overlay=0:${posY}:eof_action=pass:repeatlast=0:format=auto[${tag}]`);
    curV = tag;
  }

  // Force the final video stream back to yuv420p so the H.264 encoder produces
  // a stream Windows Media Player / Films & TV can decode (otherwise rgba/yuva
  // leaks through and WMP throws 0x80004005).
  if (halfers.length) {
    F.push(`[${curV}]format=yuv420p[mainYUV]`);
    curV = 'mainYUV';
  }

  let finalV = curV;

  // ── Build audio stream ────────────────────────────────────────────────────
  const aMix = [];

  // Normalise each audio stream first (reset PTS + apply volume + format)
  const _sv = parseFloat(segVolume) || 1.0;
  for (const s of segs) {
    const revAPrefix = s.reversed ? 'areverse,' : '';
    // Match the video speed: atempo retimes audio to the same `dur` (clamped to ffmpeg's 0.5–2.0 range).
    const sp = Math.min(2, Math.max(0.5, s.speed || 1));
    const atempoF = (Math.abs(sp - 1) > 1e-6) ? `atempo=${sp.toFixed(6)},` : '';
    F.push(
      `[${s.aidx}:a]${revAPrefix}asetpts=PTS-STARTPTS,${atempoF}volume=${_sv},` +
      `aformat=sample_fmts=fltp:sample_rates=${AR}:channel_layouts=stereo[sa${s.vidx}]`
    );
  }

  if (segs.length === 1) {
    F.push(`[sa${segs[0].vidx}]anull[segA]`);
  } else {
    F.push(segs.map(s => `[sa${s.vidx}]`).join('') + `concat=n=${segs.length}:v=0:a=1[segA]`);
  }
  aMix.push('[segA]');

  // ── Insert (birol/hook/halfer) audio — only clips with the audio flag (+ a real
  //    audio stream). Retimed to playback speed, trimmed to dur, delayed to start. ──
  const _addInsertAudio = (arr) => {
    for (const c of arr) {
      if (!c.audio) continue;
      const sp = Math.min(2, Math.max(0.5, c.speed || 1));
      const atempoF = (Math.abs(sp - 1) > 1e-6) ? `atempo=${sp.toFixed(6)},` : '';
      const ms = Math.max(0, Math.round((c.start || 0) * 1000));
      F.push(
        `[${c.idx}:a]asetpts=PTS-STARTPTS,${atempoF}atrim=0:${c.dur.toFixed(6)},asetpts=PTS-STARTPTS,` +
        `adelay=${ms}|${ms},volume=${(c.volume != null ? c.volume : 1)},` +
        `aformat=sample_fmts=fltp:sample_rates=${AR}:channel_layouts=stereo[ia${c.idx}]`
      );
      aMix.push(`[ia${c.idx}]`);
    }
  };
  _addInsertAudio(biros);
  _addInsertAudio(halfers);

  _musicInputs.forEach(({ idx, mc }, i) => {
    const dur = Math.max(0.05, (+mc.end || 0) - (+mc.start || 0));        // on-timeline length
    const sp  = (mc.speed && mc.speed > 0) ? Math.min(2, Math.max(0.5, +mc.speed)) : 1;
    const ms  = Math.max(0, Math.round((+mc.start || 0) * 1000));
    const atempoF = (Math.abs(sp - 1) > 1e-6) ? `atempo=${sp.toFixed(6)},` : '';
    const vol = (mc.volume != null ? +mc.volume : 0.5);
    F.push(
      `[${idx}:a]asetpts=PTS-STARTPTS,${atempoF}atrim=0:${dur.toFixed(6)},asetpts=PTS-STARTPTS,` +
      `adelay=${ms}|${ms},volume=${vol},` +
      `aformat=sample_fmts=fltp:sample_rates=${AR}:channel_layouts=stereo[ma${i}]`
    );
    aMix.push(`[ma${i}]`);
  });

  // ── Segment SFX: placed at each junction between speaking-head segments ──────
  if (segSfxIdx >= 0) {
    const segPoints = [];
    let outputCursor = segs[0].dur;
    for (let i = 1; i < segs.length; i++) {
      segPoints.push(outputCursor);
      outputCursor += segs[i].dur;
    }
    const segSfxDur = await _getFileDuration(_webToFs(segSfx));
    await _placeSfx(F, aMix, segSfxIdx, segSfxDur, segSfxVolume, segPoints, 'ssfx');
  }

  // ── Biro SFX: placed at each biroly start and end ─────────────────────────
  if (biroSfxIdx >= 0) {
    const biroPoints = [];
    for (const b of biros) {
      if (b.start > 0) biroPoints.push(b.start);
      biroPoints.push(b.end);
    }
    const biroSfxDur = await _getFileDuration(_webToFs(biroSfx));
    await _placeSfx(F, aMix, biroSfxIdx, biroSfxDur, biroSfxVolume, biroPoints, 'bsfx');
  }

  let finalA;
  if (aMix.length === 1) {
    // aresample=async=1 compensates for any audio/video PTS drift caused by encoder delay or float rounding
    F.push(`${aMix[0]}aresample=async=1[finalA]`);
    finalA = 'finalA';
  } else {
    // normalize=0: don't divide by input count — each stream's volume= controls its level
    F.push(`${aMix.join('')}amix=inputs=${aMix.length}:duration=first:dropout_transition=0:normalize=0,aresample=async=1[finalA]`);
    finalA = 'finalA';
  }

  // ── Color correction (eq filter) — only when non-default ────────────────────
  const useEq = eqBrightness !== 0 || eqContrast !== 1 || eqSaturation !== 1 || eqGamma !== 1;
  if (useEq) {
    const b = parseFloat(eqBrightness).toFixed(3);
    const c = parseFloat(eqContrast).toFixed(3);
    const s = parseFloat(eqSaturation).toFixed(3);
    const g = parseFloat(eqGamma).toFixed(3);
    F.push(`[${finalV}]eq=brightness=${b}:contrast=${c}:saturation=${s}:gamma=${g}[finalV_eq]`);
    finalV = 'finalV_eq';
  }

  // ── SRT subtitles via libass (from STT generation) ───────────────────────
  let assFilePath = null;
  let assFileTemp = false;   // true = we created it and should delete after render

  if (prebuiltAssPath && fs.existsSync(prebuiltAssPath)) {
    // Use the pre-built .ass file created when user clicked "Применить"
    assFilePath  = prebuiltAssPath;
    assFileTemp  = false;
    console.log(`[ass] using pre-built: ${path.basename(prebuiltAssPath)}`);
  } else {
    // Build on-the-fly (fallback: user never opened the modal or no pre-built)
    const activeSrtSubs = Array.isArray(srtSubtitles)
      ? srtSubtitles.filter(s => s.text && s.end > s.start)
      : [];
    const hasSrtContent = activeSrtSubs.length > 0 || (Array.isArray(srtWords) && srtWords.length > 0);
    if (hasSrtContent) {
      const assContent = _buildAssContent(activeSrtSubs, assSettings, W, H, srtWords);
      assFilePath  = path.join(TEMP_DIR, `ass_${jobId}.ass`);
      assFileTemp  = true;
      fs.writeFileSync(assFilePath, assContent, 'utf8');
    }
  }

  if (assFilePath) {
    const escapedPath = _escapeFilterPath(assFilePath);
    F.push(`[${finalV}]ass=filename='${escapedPath}'[finalV_ass]`);
    finalV = 'finalV_ass';
  }

  // ── Scenario-line subtitles (drawtext, chained) ───────────────────────────
  const activeSubs = (subsEnabled && Array.isArray(subtitles) && subtitles.length)
    ? subtitles.filter(s => s.text && s.end > s.start)
    : [];

  if (activeSubs.length) {
    const fontColor = _hexToFfColor(subsColor);
    const yExpr     = subsPosition === 'top'    ? '60'
                    : subsPosition === 'center'  ? '(h-text_h)/2'
                    : 'h-text_h-90';   // bottom

    // Determine font file (Windows first, then Linux fallback)
    const winFont   = 'C:/Windows/Fonts/arial.ttf';
    const linFont   = '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf';
    const fontArg   = fs.existsSync(winFont.replace(/\//g, '\\')) ? `fontfile='${winFont}':` :
                      fs.existsSync(linFont)                        ? `fontfile='${linFont}':` : '';

    const boxArgs  = subsStyle === 'box'
      ? ':box=1:boxcolor=black@0.5:boxborderw=12'
      : '';
    const lineArgs = subsStyle === 'outline' ? `:borderw=3:bordercolor=black@0.85`
                   : subsStyle === 'shadow'  ? `:shadowx=2:shadowy=2:shadowcolor=black@0.8`
                   : '';

    const dtChain = activeSubs.map(sub => {
      const txt = _escapeDrawtext(sub.text);
      const t0  = sub.start.toFixed(3);
      const t1  = sub.end.toFixed(3);
      return `drawtext=${fontArg}text='${txt}':fontsize=${subsFontSize}:fontcolor=${fontColor}` +
             `:x=(w-text_w)/2:y=${yExpr}${boxArgs}${lineArgs}` +
             `:enable='between(t,${t0},${t1})'`;
    }).join(',');

    F.push(`[${finalV}]${dtChain}[finalV_sub]`);
    finalV = 'finalV_sub';
  }

  // ── Assemble output args ──────────────────────────────────────────────────
  // Sanitize for filesystem AND URL-safe: strip Windows-unsafe chars + URL-reserved
  // (# ? & %) that would break <video src=...> path parsing. Keep Cyrillic/em-dashes
  // so the filename mirrors the project title (date — time — scenario — model).
  const safeLabel = String(outputLabel || '')
    .replace(/[\\\/:*?"<>|]/g, '-')   // Windows-unsafe → hyphen (turns 21:38 into 21-38)
    .replace(/[#?&%]/g, '-')          // URL-reserved → hyphen (# breaks <video src>!)
    .replace(/\s+/g, ' ')             // collapse whitespace
    .trim()
    .slice(0, 100) || 'render';
  const outName   = `local_${Date.now()}_${safeLabel}.mp4`;
  const outPath   = outPathOverride || path.join(FINALS_DIR, outName);

  // Hard-cap output to total segment duration so music/sfx never extends the render
  const totalDuration = segs.reduce((acc, s) => acc + s.dur, 0);

  // ── Optional noise overlay (advSettings.extra2 = 'wn_<color>_<percent>') ───
  // White / pink / brown noise mixed into the final audio at 1–5% volume.
  // Generated on-the-fly via lavfi anoisesrc — no caching, near-zero CPU cost.
  // Bounded to total project duration; black-tail (extra1) is concatenated
  // afterwards with -c copy and stays silent.
  const _noiseMatch = /^wn_(white|pink|brown)_([1-5])$/.exec(String(extra2 || ''));
  if (_noiseMatch) {
    const [, color, percentStr] = _noiseMatch;
    const volume = parseInt(percentStr, 10) / 100; // 0.01–0.05
    args.push('-f', 'lavfi', '-t', totalDuration.toFixed(3),
              '-i', `anoisesrc=c=${color}:r=44100:a=1`);
    const noiseIdx = inputIdx++;
    F.push(
      `[${noiseIdx}:a]volume=${volume.toFixed(2)},aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo[noise_an]`
    );
    F.push(
      `[${finalA}][noise_an]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[finalA_noised]`
    );
    finalA = 'finalA_noised';
    console.log(`[ffmpeg] mixing ${color} noise at ${percentStr}% over main audio`);
  }

  args.push('-filter_complex', F.join(';'));
  args.push('-map', `[${finalV}]`);
  args.push('-map', `[${finalA}]`);
  args.push('-t', totalDuration.toFixed(3));
  args.push('-c:v', 'libx264', '-preset', String(preset), '-crf', String(parseInt(crf) || 23));
  args.push('-profile:v', 'main', '-level', '4.0');   // match normalizeVideoForBrowser → concat-copy compatible
  args.push('-c:a', 'aac', '-b:a', String(audioBitrate) || '192k');
  args.push('-movflags', '+faststart');
  args.push('-y', outPath);

  await _execFfmpeg(args, jobId);
  if (assFilePath && assFileTemp) { try { fs.unlinkSync(assFilePath); } catch {} }

  // Piece render (smart-copy): plain file out, no black-tail, caller owns the path.
  if (outPathOverride) return outPathOverride;

  // Optional black-tail extension (advSettings.extra1 = 'black5|10|20|30')
  // Generates (or reuses cached) silent N-min black-screen mp4 with matching
  // resolution/fps/codec, then concat-demuxer copies it onto the main render.
  const _blackMatch = /^black(\d+)$/.exec(String(extra1 || ''));
  if (_blackMatch) {
    const minutes = parseInt(_blackMatch[1], 10);
    if ([5, 10, 20, 30].includes(minutes)) {
      try {
        const tailPath = await _ensureBlackTail(minutes, W, H, FPS, audioBitrate, preset, parseInt(crf) || 23, jobId);
        const tmpOut   = path.join(FINALS_DIR, `tmp_concat_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.mp4`);
        await _appendBlackTail(outPath, tailPath, tmpOut, jobId);
        try { fs.unlinkSync(outPath); } catch {}
        fs.renameSync(tmpOut, outPath);
        console.log(`[ffmpeg] black-tail ${minutes}min appended → ${outName}`);
      } catch (e) {
        // Non-fatal: keep the main render; user gets the result without tail
        console.warn(`[ffmpeg] black-tail append failed (${e.message}) — keeping main render`);
      }
    }
  }

  return `/finals/${outName}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// SMART-COPY RENDER (VSL): stream-copy the untouched spans of the source file
// and re-encode only insert windows + the partial GOPs at copy boundaries.
// Eligibility (the agreed rule: "only inserts → fast, global edits → full"):
// one /vsl/ source, all main fragments speed=1 / no effects / not reversed,
// no music / SFX / subtitles / EQ / noise, output resolution = source size.
// Pieces are remuxed to MPEG-TS (Annex B carries SPS/PPS in-band, so chunks
// from different encoders concatenate safely), then concat -c copy → mp4.
// ═══════════════════════════════════════════════════════════════════════════
const SMART_MIN_COPY = 2.0;   // s — don't bother stream-copying spans shorter than this
const _smartProbeCache = new Map();   // absPath|mtime → probe

// One fast pass: -discard nokey drops non-key packets at the demuxer, so
// showinfo prints a line per KEYFRAME; the stderr header gives fps/size/audio.
function _probeSmartSource(abs) {
  let mtime = 0; try { mtime = Math.floor(fs.statSync(abs).mtimeMs); } catch {}
  const key = abs + '|' + mtime;
  if (_smartProbeCache.has(key)) return Promise.resolve(_smartProbeCache.get(key));
  return new Promise(resolve => {
    const proc = spawn(ffmpegPath, ['-hide_banner', '-discard', 'nokey', '-i', abs, '-vf', 'showinfo', '-an', '-f', 'null', '-'],
      { stdio: ['ignore', 'ignore', 'pipe'] });
    // The input header (Duration / Video / Audio lines) all arrive before the
    // first showinfo line; retain just the leading chunk for it and parse the
    // header ONCE at close (parsing it incrementally raced with the showinfo
    // flood and could miss the audio line). Keyframe pts_time lines are parsed
    // streaming since there can be thousands.
    let header = '';
    const out = { kfs: [], fps: 0, width: 0, height: 0, audioRate: 0, audioChannels: 0, duration: 0 };
    proc.stderr.on('data', c => {
      const s = c.toString();
      if (header.length < 8000) header += s;
      let m;
      const re = /pts_time:([\d.]+)/g;
      while ((m = re.exec(s)) !== null) { const t = parseFloat(m[1]); if (isFinite(t)) out.kfs.push(t); }
    });
    proc.on('close', () => {
      const vm = header.match(/Video:.*?(\d{2,5})x(\d{2,5}).*?([\d.]+)\s*fps/s);
      if (vm) { out.width = +vm[1]; out.height = +vm[2]; out.fps = parseFloat(vm[3]); }
      const am = header.match(/Audio:.*?(\d{4,6}) Hz,\s*(stereo|mono|[\d.]+ channels)/);
      if (am) { out.audioRate = +am[1]; out.audioChannels = am[2] === 'stereo' ? 2 : (am[2] === 'mono' ? 1 : parseFloat(am[2]) || 0); }
      const dm = header.match(/Duration:\s*(\d+):(\d+):(\d+\.?\d*)/);
      if (dm) out.duration = (+dm[1]) * 3600 + (+dm[2]) * 60 + (+dm[3]);
      out.kfs.sort((a, b) => a - b);
      _smartProbeCache.set(key, out);
      resolve(out);
    });
    proc.on('error', () => resolve(out));
  });
}

const _isNoneFx = v => v == null || v === 'none' || v === '';
function _smartEligible(body) {
  const segs = body.segmentClips || [];
  if (!segs.length) return null;
  const src = segs[0].videoPath;
  if (!String(src || '').startsWith('/vsl/')) return null;
  for (const s of segs) {
    if (s.videoPath !== src || s.voiceOnly) return null;
    if (Math.abs((parseFloat(s.speed) || 1) - 1) > 1e-3) return null;
    if (s.reversed) return null;
    if (!_isNoneFx(s.transition) || !_isNoneFx(s.animation) || !_isNoneFx(s.filter)) return null;
  }
  // NOTE: segTransition (default 'fade') is intentionally NOT a disqualifier:
  // the VSL preview shows hard cuts between fragments (the compositor doesn't
  // crossfade main segments), so smart-copy's hard cuts MATCH the preview, and
  // a between-segments fade can't survive a stream-copy anyway. segAnimation /
  // segFilter DO apply to every main segment, so a non-default one → full render.
  if (!_isNoneFx(body.segAnimation) || !_isNoneFx(body.segFilter)) return null;
  if ((body.musicClips || []).length) return null;
  if (body.segSfx && body.segSfx !== 'Нет') return null;
  if (body.biroSfx && body.biroSfx !== 'Нет') return null;
  if (Math.abs((parseFloat(body.segVolume) || 1) - 1) > 1e-3) return null;
  const adv = body.advSettings || {};
  if ((parseFloat(adv.eqBrightness) || 0) !== 0) return null;
  if (adv.eqContrast   != null && Math.abs(parseFloat(adv.eqContrast)   - 1) > 1e-6) return null;
  if (adv.eqSaturation != null && Math.abs(parseFloat(adv.eqSaturation) - 1) > 1e-6) return null;
  if (adv.eqGamma      != null && Math.abs(parseFloat(adv.eqGamma)      - 1) > 1e-6) return null;
  if (!_isNoneFx(adv.extra1) || !_isNoneFx(adv.extra2)) return null;
  if ((body.srtSubtitles || []).length || (body.srtWords || []).length) return null;
  if (adv.subsEnabled && (body.subtitles || []).length) return null;
  if (body.prebuiltAssPath) return null;
  return src;
}

// Interval helpers (output-timeline seconds)
function _subtractWindows(intervals, windows) {
  let cur = intervals;
  for (const w of windows) {
    const next = [];
    for (const iv of cur) {
      if (w.end <= iv.a || w.start >= iv.b) { next.push(iv); continue; }
      if (w.start > iv.a) next.push({ a: iv.a, b: w.start, srcA: iv.srcA });
      if (w.end < iv.b)   next.push({ a: w.end, b: iv.b,  srcA: iv.srcA + (w.end - iv.a) });
    }
    cur = next;
  }
  return cur.filter(iv => iv.b - iv.a > 0.01);
}

// Build the ordered piece plan: copy pieces (src-window, keyframe-aligned) and
// encode pieces (output-window) covering [0, totalDur) exactly.
function _buildSmartPlan(body, probe) {
  const segs = (body.segmentClips || []).slice().sort((x, y) => x.start - y.start);
  const totalDur = segs.reduce((acc, s) => acc + (parseFloat(s.end) - parseFloat(s.start)), 0);

  // Verbatim runs: each segment maps output [start,end) → source [crop, crop+dur).
  // Merge runs that are contiguous in BOTH output and source (un-touched cuts).
  let runs = [];
  for (const s of segs) {
    const a = parseFloat(s.start), b = parseFloat(s.end), crop = parseFloat(s.crop) || 0;
    if (b - a <= 0) continue;
    const last = runs[runs.length - 1];
    if (last && Math.abs(last.b - a) < 0.002 && Math.abs((last.srcA + (last.b - last.a)) - crop) < 0.002) last.b = b;
    else runs.push({ a, b, srcA: crop });
  }

  // Subtract insert windows (birols/hooks/halfers replace the frame there).
  const windows = [].concat(body.clips || [], body.halferClips || [])
    .map(c => ({ start: Math.max(0, parseFloat(c.start) || 0), end: Math.min(totalDur, parseFloat(c.end) || 0) }))
    .filter(w => w.end - w.start > 0.005)
    .sort((x, y) => x.start - y.start);
  runs = _subtractWindows(runs, windows);

  // Keyframe-snap each verbatim run → copy pieces in source time.
  const kfs = probe.kfs;
  const copies = [];
  for (const r of runs) {
    const srcA = r.srcA, srcB = r.srcA + (r.b - r.a);
    let lo = kfs.findIndex(k => k >= srcA - 1e-3);
    if (lo < 0) continue;
    let hi = kfs.length - 1;
    while (hi >= 0 && kfs[hi] > srcB + 1e-3) hi--;
    if (hi < 0 || lo > hi) continue;
    const cs = Math.max(kfs[lo], srcA), ce = Math.min(kfs[hi], srcB);
    if (ce - cs < SMART_MIN_COPY) continue;
    copies.push({ outA: r.a + (cs - srcA), outB: r.a + (ce - srcA), srcA: cs, srcB: ce });
  }
  copies.sort((x, y) => x.outA - y.outA);

  // Everything between copy pieces is an encode piece.
  const pieces = [];
  let cursor = 0;
  for (const c of copies) {
    if (c.outA - cursor > 0.01) pieces.push({ type: 'encode', outA: cursor, outB: c.outA });
    pieces.push({ type: 'copy', ...c });
    cursor = c.outB;
  }
  if (totalDur - cursor > 0.01) pieces.push({ type: 'encode', outA: cursor, outB: totalDur });

  const copyDur = copies.reduce((acc, c) => acc + (c.outB - c.outA), 0);
  return { pieces, totalDur, copyDur };
}

// Window the body to output span [A,B) — mirrors the client range trimmer,
// including the source in-point advance for clips the cut slices into.
function _windowBodyForPiece(body, A, B, probe) {
  const trim = (c, inKey) => {
    const cs = Math.max(parseFloat(c.start), A);
    const ce = Math.min(parseFloat(c.end), B);
    if (cs >= ce) return null;
    const out = { ...c, start: cs - A, end: ce - A };
    const cut = cs - parseFloat(c.start);
    if (cut > 1e-3) {
      const sp = (parseFloat(c.speed) > 0 ? parseFloat(c.speed) : 1);
      out[inKey] = (parseFloat(c[inKey]) || 0) + cut * sp;
    }
    return out;
  };
  return {
    ...body,
    segmentClips: (body.segmentClips || []).map(c => trim(c, 'crop')).filter(Boolean),
    clips:        (body.clips        || []).map(c => trim(c, 'trimIn')).filter(Boolean),
    halferClips:  (body.halferClips  || []).map(c => trim(c, 'trimIn')).filter(Boolean),
    musicClips:   [],
    subtitles: [], srtSubtitles: [], srtWords: [], prebuiltAssPath: null,
    advSettings: { ...(body.advSettings || {}), fps: probe.fps || 30, audioRate: probe.audioRate || 44100, extra1: 'none', extra2: 'none' },
  };
}

function _execFfmpegStep(args, jobId) { return _execFfmpeg(args, jobId); }

// Try the smart path; returns the finals URL or null when not eligible / not
// worth it. Throws on cancel. Any other internal failure → null (caller falls
// back to the full render).
// Smart-copy is auto-enabled when the source has DENSE keyframes (an optimized
// VSL — see routes/vsl.js ingest, ~1s GOP): then copy boundaries land within a
// second of any cut and per-piece drift stays negligible. Sparse-GOP sources
// fall through to the full render. Median keyframe gap must be <= this.
const SMART_MAX_GOP = 2.0;   // seconds
function _medianKfGap(kfs) {
  if (!kfs || kfs.length < 3) return Infinity;
  const gaps = [];
  for (let i = 1; i < kfs.length; i++) gaps.push(kfs[i] - kfs[i - 1]);
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)];
}

async function _smartRenderIfEligible(body) {
  const jobId = body.jobId;
  const forced = body.smartCopy === true || process.env.ENABLE_SMART_COPY === '1';   // testing override
  const srcWeb = _smartEligible(body);
  if (!srcWeb) return null;
  const abs = _webToFs(srcWeb);
  if (!abs || !fs.existsSync(abs)) return null;
  try {
    const probe = await _probeSmartSource(abs);
    if (!probe.kfs.length || !(probe.fps > 0)) { console.log('[smart] probe failed — full render'); return null; }
    if (probe.audioChannels !== 2 || !(probe.audioRate > 0)) { console.log('[smart] source audio not stereo — full render'); return null; }
    const gap = _medianKfGap(probe.kfs);
    if (!forced && gap > SMART_MAX_GOP) { console.log(`[smart] sparse keyframes (median gap ${gap.toFixed(1)}s > ${SMART_MAX_GOP}s) — not optimized, full render`); return null; }
    const adv = body.advSettings || {};
    const [W, H] = String(adv.resolution || '').split('x').map(Number);
    if (W !== probe.width || H !== probe.height) { console.log(`[smart] resolution ${W}x${H} != source ${probe.width}x${probe.height} — full render`); return null; }

    const plan = _buildSmartPlan(body, probe);
    if (!plan.pieces.length || plan.copyDur < SMART_MIN_COPY || plan.copyDur / plan.totalDur < 0.15) {
      console.log(`[smart] copy share too small (${plan.copyDur.toFixed(1)}s of ${plan.totalDur.toFixed(1)}s) — full render`);
      return null;
    }
    console.log(`[smart] plan: ${plan.pieces.length} pieces, copy ${plan.copyDur.toFixed(1)}s / ${plan.totalDur.toFixed(1)}s (${Math.round(plan.copyDur / plan.totalDur * 100)}%)`);

    const tmpBase = path.join(TEMP_DIR, `smart_${jobId}`);
    const tsFiles = [];
    let doneSecs = 0;
    const _checkCancel = () => { if (_jobs[jobId] && _jobs[jobId].status === 'cancelled') throw new Error('cancelled'); };

    try {
      for (let i = 0; i < plan.pieces.length; i++) {
        _checkCancel();
        const p = plan.pieces[i];
        const ts = `${tmpBase}_p${i}.ts`;
        if (_jobs[jobId]) _jobs[jobId]._progressBase = doneSecs;
        if (p.type === 'copy') {
          // Extract [srcA, srcB] without re-encoding, straight into MPEG-TS.
          // -ss + -to BEFORE -i are both in the source timeline (LosslessCut
          // method): since srcA/srcB are exact keyframe times, whole GOPs are
          // copied and the output duration equals srcB-srcA with no overshoot.
          await _execFfmpegStep([
            '-ss', p.srcA.toFixed(3), '-to', p.srcB.toFixed(3), '-i', abs,
            '-map', '0:v:0', '-map', '0:a:0',
            '-c', 'copy', '-avoid_negative_ts', 'make_zero',
            '-bsf:v', 'h264_mp4toannexb', '-f', 'mpegts', '-y', ts,
          ], jobId);
        } else {
          // Re-encode through the normal pipeline (windowed payload), then remux to TS.
          const mp4 = `${tmpBase}_p${i}.mp4`;
          const sub = _windowBodyForPiece(body, p.outA, p.outB, probe);
          await _buildAndRun({ ...sub, jobId, outPathOverride: mp4 });
          _checkCancel();
          if (_jobs[jobId]) _jobs[jobId]._progressBase = doneSecs + (p.outB - p.outA);
          await _execFfmpegStep(['-i', mp4, '-c', 'copy', '-bsf:v', 'h264_mp4toannexb', '-f', 'mpegts', '-y', ts], jobId);
          try { fs.unlinkSync(mp4); } catch {}
        }
        tsFiles.push(ts);
        doneSecs += (p.outB - p.outA);
        if (_jobs[jobId]) { _jobs[jobId]._progressBase = doneSecs; _jobs[jobId].progressSecs = doneSecs; }
      }

      _checkCancel();
      // Concat all TS pieces → final mp4 (copy; Annex B carries codec config in-band).
      const safeLabel = String(body.outputLabel || '').replace(/[\\\/:*?"<>|]/g, '-').replace(/[#?&%]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 100) || 'render';
      const outName = `local_${Date.now()}_${safeLabel}.mp4`;
      const outPath = path.join(FINALS_DIR, outName);
      const listPath = `${tmpBase}_list.txt`;
      fs.writeFileSync(listPath, tsFiles.map(f => `file '${f.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n') + '\n', 'utf8');
      if (_jobs[jobId]) _jobs[jobId]._progressBase = 0;
      await _execFfmpegStep([
        '-f', 'concat', '-safe', '0', '-i', listPath,
        '-c', 'copy', '-bsf:a', 'aac_adtstoasc',
        '-t', plan.totalDur.toFixed(3),   // cap exactly: copy pieces can over-run a keyframe by a few frames
        '-movflags', '+faststart', '-y', outPath,
      ], jobId);
      try { fs.unlinkSync(listPath); } catch {}
      console.log(`[smart] done → ${outName}`);
      return `/finals/${outName}`;
    } finally {
      for (const f of tsFiles) { try { fs.unlinkSync(f); } catch {} }
      if (_jobs[jobId]) _jobs[jobId]._progressBase = 0;
    }
  } catch (e) {
    if (/cancel/i.test(e && e.message || '') || (_jobs[jobId] && _jobs[jobId].status === 'cancelled')) throw e;
    console.warn(`[smart] failed (${e.message}) — falling back to full render`);
    return null;
  }
}

// ── Place SFX copies centred on each point ────────────────────────────────────
// prefix: unique tag prefix to avoid filter name collisions ('ssfx' or 'bsfx')
async function _placeSfx(F, aMix, inputIdx, sfxDur, volume, points, prefix) {
  if (!points.length) return;
  const N = points.length;
  if (N === 1) {
    const ms = Math.round(Math.max(0, points[0] - sfxDur / 2) * 1000);
    F.push(`[${inputIdx}:a]adelay=${ms}|${ms},volume=${volume},aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo[${prefix}0]`);
    aMix.push(`[${prefix}0]`);
  } else {
    F.push(`[${inputIdx}:a]asplit=${N}${points.map((_, i) => `[${prefix}s${i}]`).join('')}`);
    points.forEach((pt, i) => {
      const ms = Math.round(Math.max(0, pt - sfxDur / 2) * 1000);
      F.push(`[${prefix}s${i}]adelay=${ms}|${ms},volume=${volume},aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo[${prefix}${i}]`);
      aMix.push(`[${prefix}${i}]`);
    });
  }
}

// ── Black-tail cache + concat helpers ────────────────────────────────────────
// _ensureBlackTail: returns absolute path to a cached N-min silent black-screen
// MP4 matching the given resolution/fps/codec. First call generates and caches;
// subsequent calls reuse the file. Codec params match the main render so concat
// demuxer with -c copy works cleanly.
async function _ensureBlackTail(minutes, W, H, fps, audioBitrate, preset, crf, jobId) {
  const fname = `black_tail_${minutes}_${W}x${H}_${fps}.mp4`;
  const fpath = path.join(BLACK_TAIL_DIR, fname);
  if (fs.existsSync(fpath)) {
    console.log(`[ffmpeg] black-tail cache hit: ${fname}`);
    return fpath;
  }
  console.log(`[ffmpeg] generating black-tail ${minutes}min ${W}x${H}@${fps}fps → ${fname}`);
  const dur = minutes * 60;
  const args = [
    '-f', 'lavfi', '-i', `color=c=black:s=${W}x${H}:r=${fps}:d=${dur}`,
    '-f', 'lavfi', '-i', `anullsrc=channel_layout=stereo:sample_rate=44100`,
    '-t',          String(dur),
    '-c:v',        'libx264',
    '-preset',     String(preset || 'fast'),
    '-crf',        String(parseInt(crf) || 23),
    '-pix_fmt',    'yuv420p',
    '-c:a',        'aac',
    '-b:a',        String(audioBitrate || '192k'),
    '-shortest',
    '-movflags',   '+faststart',
    '-y',          fpath,
  ];
  await _execFfmpeg(args, jobId);
  return fpath;
}

// _appendBlackTail: concatenate `mainPath` + `tailPath` into `finalPath` using
// the concat demuxer with -c copy (no re-encode; only works if streams match).
async function _appendBlackTail(mainPath, tailPath, finalPath, jobId) {
  const listPath = path.join(TEMP_DIR, `concat_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.txt`);
  // ffmpeg concat list: forward slashes + escape single quotes
  const escape = p => `file '${p.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`;
  fs.writeFileSync(listPath, `${escape(mainPath)}\n${escape(tailPath)}\n`, 'utf8');
  try {
    const args = [
      '-f',     'concat',
      '-safe',  '0',
      '-i',     listPath,
      '-c',     'copy',
      '-movflags', '+faststart',
      '-y',     finalPath,
    ];
    await _execFfmpeg(args, jobId);
  } finally {
    try { fs.unlinkSync(listPath); } catch {}
  }
}

// ── Probe file duration via FFmpeg stderr ─────────────────────────────────────
function _getFileDuration(fp) {
  return new Promise(resolve => {
    const proc = spawn(ffmpegPath, ['-i', fp], { stdio: ['ignore', 'ignore', 'pipe'] });
    let s = '';
    proc.stderr.on('data', c => { s += c.toString(); });
    proc.on('close', () => {
      const m = s.match(/Duration:\s*(\d+):(\d+):(\d+\.?\d*)/);
      resolve(m ? parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseFloat(m[3]) : 0);
    });
    proc.on('error', () => resolve(0));
  });
}

// ── Probe whether a file has at least one audio stream (from ffmpeg stderr) ───
function _hasAudioStream(fp) {
  return new Promise(resolve => {
    const proc = spawn(ffmpegPath, ['-i', fp], { stdio: ['ignore', 'ignore', 'pipe'] });
    let s = '';
    proc.stderr.on('data', c => { s += c.toString(); });
    proc.on('close', () => resolve(/Stream #\d+:\d+.*:\s*Audio:/.test(s)));
    proc.on('error', () => resolve(false));
  });
}

// ── Spawn FFmpeg and track progress ──────────────────────────────────────────
function _execFfmpeg(args, jobId) {
  return new Promise((resolve, reject) => {
    console.log(`[ffmpeg] start job=${jobId}`);
    const proc = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    if (_jobs[jobId]) _jobs[jobId].proc = proc;
    let stderr = '';

    proc.stderr.on('data', chunk => {
      const s = chunk.toString();
      stderr += s;
      // Parse "time=HH:MM:SS.xx" for progress
      const m = s.match(/time=(\d+):(\d+):(\d+\.\d+)/);
      if (m && _jobs[jobId]) {
        // _progressBase: multi-step renders (smart-copy pieces) accumulate the
        // completed steps there so the client sees monotonic overall progress.
        _jobs[jobId].progressSecs = (_jobs[jobId]._progressBase || 0) +
          parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseFloat(m[3]);
      }
    });

    proc.on('close', code => {
      if (_jobs[jobId]) _jobs[jobId].proc = null;
      if (_jobs[jobId]?.status === 'cancelled') {
        reject(new Error('cancelled'));
      } else if (code === 0) {
        console.log(`[ffmpeg] done job=${jobId}`);
        resolve();
      } else {
        reject(new Error(`FFmpeg ошибка (код ${code}): ${stderr.slice(-600)}`));
      }
    });

    proc.on('error', err => reject(err));
  });
}

// ── POST /api/ffmpeg/build-ass ────────────────────────────────────────────────
// Pre-builds a .ass subtitle file and stores it so the next render uses it.
// Body: { srtSubtitles, srtWords, assSettings, resolution, sessionKey }
router.post('/ffmpeg/build-ass', (req, res) => {
  const {
    srtSubtitles = [],
    srtWords     = [],
    assSettings  = {},
    resolution   = '1080x1920',
    sessionKey   = 'default',
  } = req.body;

  const [W, H] = resolution.split('x').map(Number).map(n => (n > 0 ? n : 1080));
  const activeSubs = Array.isArray(srtSubtitles)
    ? srtSubtitles.filter(s => s.text && s.end > s.start)
    : [];
  const hasContent = activeSubs.length > 0 || (Array.isArray(srtWords) && srtWords.length > 0);

  if (!hasContent) {
    return res.json({ success: false, error: 'Нет данных субтитров для сборки' });
  }

  try {
    const assContent = _buildAssContent(activeSubs, assSettings, W, H, srtWords);
    // sanitise sessionKey for use as filename
    const safeName   = sessionKey.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
    const fname      = `ass_${safeName}.ass`;
    const fpath      = path.join(ASS_DIR, fname);
    fs.writeFileSync(fpath, assContent, 'utf8');
    console.log(`[ass] built ${fname} (${assContent.length} bytes)`);
    res.json({ success: true, assFilePath: fpath });
  } catch (e) {
    console.error('[ass] build error:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;
