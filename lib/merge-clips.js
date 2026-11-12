'use strict';

// ════════════════════════════════════════════════════════════════════════════
// CLIPS IN A ROW MERGED INTO ONE FILE (phase V45, the owner 2026-10-24: "выделить несколько подряд идущих фрагментов и их
// объединить, типа зарендерить внутри проекта"; answers (ю1)-(ю4)).
//
// Merge picks clips that follow one another on one lane - with their sound halves on the lane linked to it - and asks here
// for ONE file of them: the picture as it is in the frame (the project's shape, the fit, the framing that follows a face,
// every effect - burnt in) and their sound (each clip's volume and fades - burnt in; not the lane's, the lane keeps it).
// Rendered with the export's own graph (lib/mv3b-job.js prepare, lib/mv3b-render.js), without captions - they stay on their
// lane -, encoded faster and finer than an export (phase V49.2, below: NVENC or x264 ultrafast, at the source's frame rate - it
// is rendered again in the film). The file goes into the PROJECT's folder,
// `projects/<folder>/merged/` (ю1): not a shelf of the Library, and gone with the project. A sound alone (a talking head's
// reads) is rendered over black all the same and laid as a sound. The page lays the file in place of the clips, one step
// to undo (ю2: the file stays). Nothing is paid: this computer's ffmpeg.
//
//   start({ key, format, video, audio }) -> job      video / audio - the clips as the page has them, in order
//   get(id) -> job;  cancel(id)
//   job: { id, key, state: running|done|failed|cancelled, pct, src, dur, error }
//
// (phase V54, block 2) ONE CLIP AS IT IS SEEN, for Video to Music (lib/audio-gens.js): the clip of a video lane and its sound
// half, by the same graph - its speed, crop, the frame that follows a face -, small and quick (it is watched by a model,
// not shown) into a file the caller names. Nothing is paid.
//   clipOf(key, clipId) -> { key, format, track, clip, sound } or { error, code }   read from the stored timeline
//   startClip({ key, clipId, out }) -> { job } or { error, code }                    `out` - the file to write (absolute)
// ════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const MSTORE = require('./merge-store');
const JOB = require('./mv3b-job');
const { probe } = require('./media-probe');
const { PROJECTS_DIR } = require('./config');
const { toUrl, toDiskExisting } = require('./media');

const SEAM = 0.011;                // two clips this close meet
const MAX_SECONDS = 30 * 60;       // a merge of half an hour at most
const MAX_CLIPS = 600;
const JOBS = new Map();
const r3 = (v) => Math.round(v * 1000) / 1000;

// ── How a merge is encoded (phase V49.2, the owner's (пр36) а, (пр37)) ──────
// Not as the export: a merged file is rendered again in the film, so it is encoded FAST and fine - the NVIDIA card's encoder
// (NVENC, CQ 17) when this computer has one that works, else x264 `ultrafast` at CRF 15. Both against V45's x264 veryfast
// CRF 16, measured on E01's fragment 2: SSIM 0.991 and 0.990, files 1.4x and 2.3x as big. The export keeps its own x264.
// Whether NVENC works is asked ONCE an app run, by encoding a moment of black of the film's size (no card, no driver, a
// driver too old - all say no). A merge NVENC fails all the same is made again at once with x264, and NVENC is not used
// again this run - a merge never fails over it.
const NV_CQ = 17;
const UF_CRF = 15;
// (phase V54) A clip for Video to Music is watched, not shown: coarser (CQ / CRF 30) - ten minutes of it stays far under
// ElevenLabs' 200 MB.
const V2M_Q = 30;
const videoArgs = (kind, small) => (kind === 'nvenc'
  ? ['-c:v', 'h264_nvenc', '-preset', 'p4', '-tune', 'hq', '-rc', 'vbr', '-cq', String(small ? V2M_Q : NV_CQ), '-b:v', '0']
  : ['-c:v', 'libx264', '-preset', 'ultrafast', '-crf', String(small ? V2M_Q : UF_CRF)]);
let _nvenc = null;                 // a Promise of true / false, asked once a run
function nvencWorks() {
  if (_nvenc) return _nvenc;
  _nvenc = new Promise((resolve) => {
    let proc = null, timer = null;
    const end = (ok) => { clearTimeout(timer); resolve(ok); };
    try {
      proc = spawn(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=1080x1920:r=30:d=0.5',
        ...videoArgs('nvenc'), '-pix_fmt', 'yuv420p', '-f', 'null', '-'], { stdio: 'ignore', windowsHide: true });
    } catch (e) { end(false); return; }
    timer = setTimeout(() => { try { proc.kill(); } catch (e) { /* gone */ } end(false); }, 20000);
    proc.on('error', () => end(false));
    proc.on('close', (code) => end(code === 0));
  }).then((ok) => { console.log('[merge] the NVIDIA encoder ' + (ok ? 'works - merges use it' : 'is not here - merges use x264 ultrafast')); return ok; });
  return _nvenc;
}

// THE FRAME RATE: the source's when every moving piece has the same one - no frame made up or dropped, and fewer to make (a
// 24 fps film at 30 is a quarter more frames) -, else the export's. Read off what ffmpeg prints ("23.98 fps"), and only the
// usual rates are trusted - a phone's variable rate prints an average that is none of them.
// (V50 speed, (сп3)) A NUMBER, the fraction worked out here: the effects count frames by it (lib/fx-render.js fxChain, lib/fx-bake.js
// needsOf) and a text '30000/1001' made them NaN - a merge at 29.97 lost its clips' effects. ffmpeg reads 29.97002997002997 back as
// 30000/1001 exactly.
const RATES = [[23.976, 24000 / 1001], [24, 24], [25, 25], [29.97, 30000 / 1001], [30, 30],
  [47.952, 48000 / 1001], [48, 48], [50, 50], [59.94, 60000 / 1001], [60, 60]];
const rateOf = (fps) => { const r = RATES.find(([v]) => Math.abs((+fps || 0) - v) < 0.01); return r ? r[1] : null; };
const isStill = (src) => /\.(jpe?g|png|webp|avif|bmp)$/i.test(String(src || '').split('?')[0]);
async function sourceRate(clips) {
  const files = [...new Set(clips.filter((c) => !isStill(c.src)).map((c) => toDiskExisting(String(c.src))).filter(Boolean))];
  if (!files.length) return null;
  const rates = await Promise.all(files.map(async (f) => rateOf((await probe(f)).fps)));
  return rates.every((r) => r && r === rates[0]) ? rates[0] : null;
}

function view(j) {
  return j ? { id: j.id, key: j.key, state: j.state, pct: j.pct, src: j.src || null, dur: j.dur || null, error: j.error || null } : null;
}

// One after another, each starting where the one before it ends. Why not, in words - or ''.
function _rowRefused(clips, what) {
  for (let i = 1; i < clips.length; i++) {
    const p = clips[i - 1], c = clips[i];
    if (Math.abs((+p.start || 0) + (+p.dur || 0) - (+c.start || 0)) > SEAM) return 'the ' + what + ' do not follow one another';
  }
  return '';
}

/**
 * Start merging. `video` - the picture's clips (one lane) or []; `audio` - their sound halves, or a sound lane's clips. At
 * least two clips, every file in the library, end to end, the picture and the sound over the same stretch.
 * @returns { job } or { error, code }
 */
function start(b) {
  const key = String((b && b.key) || '');
  const t = MSTORE.read().timelines[key];
  if (!t) return { code: 404, error: 'No project "' + key + '".' };
  const at = MSTORE.locate(key);
  if (!at || !at.folder) return { code: 409, error: 'This project has no folder to keep the merged file in - save it first.' };
  const order = (cs) => (Array.isArray(cs) ? cs : []).filter((c) => c && c.src).slice().sort((x, y) => (+x.start || 0) - (+y.start || 0));
  const video = order(b.video), audio = order(b.audio);
  const main = video.length ? video : audio;
  if (main.length < 2) return { code: 400, error: 'Pick two clips or more that follow one another.' };
  if (video.length + audio.length > MAX_CLIPS) return { code: 400, error: 'Too many clips to merge at once.' };
  const why = _rowRefused(video, 'pictures') || _rowRefused(audio, 'sounds');
  if (why) return { code: 400, error: 'Not merged: ' + why + '.' };
  const s0 = +main[0].start || 0;
  const s1 = (+main[main.length - 1].start || 0) + (+main[main.length - 1].dur || 0);
  if (video.length && audio.length) {
    const a0 = +audio[0].start || 0, a1 = (+audio[audio.length - 1].start || 0) + (+audio[audio.length - 1].dur || 0);
    if (Math.abs(a0 - s0) > SEAM || Math.abs(a1 - s1) > SEAM) return { code: 400, error: 'Not merged: the pictures and their sound are not over the same stretch.' };
  }
  if (!(s1 - s0 > 0) || s1 - s0 > MAX_SECONDS) return { code: 400, error: 'Not merged: a merge is at most half an hour.' };
  for (const c of video.concat(audio)) {
    const abs = toDiskExisting(String(c.src));
    if (!abs || !fs.existsSync(abs)) return { code: 400, error: 'Not merged: a file is missing - ' + c.src };
  }
  for (const [, j] of JOBS) if (j.key === key && j.state === 'running') return { code: 409, error: 'A merge of this project is already being made.' };

  // The clips moved to start at 0, on lanes of their own: what the merged file is.
  const shift = (c) => ({ ...c, start: r3((+c.start || 0) - s0) });
  const sub = { kind: 'blank', format: (b && b.format) || t.format || '9:16', tracks: [
    { id: 'v1', kind: 'video', name: 'main video', linkId: 'a1', main: true, volume: null, speed: null, clips: video.map(shift) },
    { id: 'a1', kind: 'audio', name: 'main audio', linkId: 'v1', main: true, volume: null, speed: null, clips: audio.map(shift) },
  ] };
  const id = 'mg_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const j = { id, key, state: 'running', pct: 0, src: null, dur: r3(s1 - s0), error: null, proc: null, startedAt: Date.now() };
  JOBS.set(id, j);
  _run(j, sub, at.folder, t.adv).catch((e) => { if (j.state === 'running') { j.state = 'failed'; j.error = e.message; } });
  _sweep();
  return { job: view(j) };
}

// ── One clip, as it is seen (phase V54, block 2: Video to Music from a clip's right button) ──────────────────────────────
// The clip of a VIDEO lane - a film, not a picture - in the stored timeline, with the sound half of its pair (on the lane
// linked to its own, or any sound lane). `{ error, code }` in words otherwise.
function clipOf(key, clipId) {
  const k = String(key || '');
  if (/^hl_[a-z0-9]+$/.test(k)) return { code: 409, error: 'Open a fragment first.' };
  const t = MSTORE.read().timelines[k];
  if (!t || !Array.isArray(t.tracks)) return { code: 404, error: 'That project is not there any more.' };
  let track = null, clip = null;
  for (const tr of t.tracks) {
    const c = (tr.clips || []).find((x) => x && x.id === String(clipId || ''));
    if (c) { track = tr; clip = c; break; }
  }
  if (!clip) return { code: 404, error: 'That clip is not on the timeline any more.' };
  if (track.kind !== 'video' || isStill(clip.src)) return { code: 400, error: 'Video to Music takes a clip of a video lane - not a picture or a sound.' };
  const abs = clip.src ? toDiskExisting(String(clip.src)) : '';
  if (!abs || !fs.existsSync(abs)) return { code: 400, error: 'The file of that clip was deleted from the library.' };
  let sound = null;
  if (clip.pairId) {
    const lanes = t.tracks.filter((x) => x.kind === 'audio');
    const own = lanes.find((x) => x.id === track.linkId);
    for (const tr of (own ? [own] : []).concat(lanes.filter((x) => x !== own))) {
      const s = (tr.clips || []).find((x) => x && x.pairId === clip.pairId);
      if (s) { sound = s; break; }
    }
  }
  return { key: k, format: t.format || '9:16', adv: t.adv, track, clip, sound };
}

/** One clip and its sound into `out` - the export's graph, small. { job } or { error, code }. */
function startClip(b) {
  const c = clipOf(b && b.key, b && b.clipId);
  if (c.error) return c;
  const out = String((b && b.out) || '');
  if (!out || !path.isAbsolute(out)) return { code: 400, error: 'where the clip goes is needed' };
  const s0 = +c.clip.start || 0;
  const shift = (x) => ({ ...x, start: r3((+x.start || 0) - s0) });
  // On main video, as a merge lays it: placed or cropped, it is drawn so over black - what the clip shows.
  const sub = { kind: 'blank', format: c.format, tracks: [
    { id: 'v1', kind: 'video', name: 'main video', linkId: 'a1', main: true, volume: null, speed: null, clips: [shift(c.clip)] },
    { id: 'a1', kind: 'audio', name: 'main audio', linkId: 'v1', main: true, volume: null, speed: null, clips: c.sound ? [shift(c.sound)] : [] },
  ] };
  const id = 'v2m_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const j = { id, key: c.key, state: 'running', pct: 0, src: null, dur: r3(+c.clip.dur || 0), error: null, proc: null, startedAt: Date.now() };
  JOBS.set(id, j);
  _run(j, sub, '', c.adv, { out, small: true }).catch((e) => { if (j.state === 'running') { j.state = 'failed'; j.error = e.message; } });
  _sweep();
  return { job: view(j) };
}

// `o.out` - the file to write (a clip for Video to Music), else a new name in the project's `merged/`; `o.small` - coarser.
async function _run(j, sub, folder, adv, o) {
  const opt = o || {};
  // The export's size, finer and faster (above): no tail, no speed, no noise. The frame rate the source's, or the export's.
  const fps = [24, 25, 30, 50, 60].includes(+(adv && adv.fps)) ? +adv.fps : 30;
  const [src, nv] = await Promise.all([sourceRate(sub.tracks[0].clips), nvencWorks()]);
  const rate = src || fps;
  let kind = nv ? 'nvenc' : 'x264';
  let out, name;
  if (opt.out) {
    out = opt.out;
    name = path.basename(out);
    fs.mkdirSync(path.dirname(out), { recursive: true });
  } else {
    const dir = path.join(PROJECTS_DIR, folder, 'merged');
    fs.mkdirSync(dir, { recursive: true });
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const base = 'merged_' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
    name = base + '.mp4';
    for (let n = 2; fs.existsSync(path.join(dir, name)); n++) name = base + '_' + n + '.mp4';
    out = path.join(dir, name);
  }
  const part = out + '.part.mp4';
  try {
    for (;;) {
      if (j.state !== 'running') throw Object.assign(new Error('cancelled'), { cancelled: true });
      const p = await JOB.prepare(sub, j.id, { fps, srt: false }, { video: videoArgs(kind, opt.small), rate });
      if (p.error) throw new Error(p.error);
      try {
        await _ffmpeg(j, [...p.args, '-progress', 'pipe:1', '-nostats', part], p.dur);
        break;
      } catch (e) {
        // NVENC failed a merge it said it could do (the card busy, a session limit): x264 makes it again, and NVENC rests this run.
        if (kind !== 'nvenc' || e.cancelled || j.state !== 'running') throw e;
        console.warn('[merge] the NVIDIA encoder failed (' + e.message + ') - made again with x264');
        _nvenc = Promise.resolve(false);
        kind = 'x264';
        j.pct = 0;
      } finally {
        if (p.dispose) p.dispose();
      }
    }
    fs.renameSync(part, out);
    j.src = toUrl(out);
    j.pct = 100;
    j.state = 'done';
    console.log('[merge] ' + j.key + ': ' + sub.tracks[0].clips.length + ' + ' + sub.tracks[1].clips.length + ' clips -> ' + name + ' (' + j.dur + ' s, '
      + ((Date.now() - j.startedAt) / 1000).toFixed(1) + ' s, ' + (kind === 'nvenc' ? 'NVENC' : 'x264 ultrafast') + ', ' + +rate.toFixed(3) + ' fps)');
  } catch (e) {
    if (j.state === 'running') { j.state = 'failed'; j.error = e.message; }
  } finally {
    try { fs.rmSync(part, { force: true }); } catch (e) { /* held for a moment */ }
  }
}

// One ffmpeg run of a merge, its progress into the job.
function _ffmpeg(j, args, dur) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    j.proc = proc;
    let log = '';
    proc.stderr.on('data', (x) => { log = (log + x).slice(-2000); });
    proc.stdout.on('data', (x) => {
      const m = /out_time_ms=(\d+)/g;
      let k, last = null;
      while ((k = m.exec(String(x)))) last = +k[1];
      if (last != null && dur > 0) j.pct = Math.max(0, Math.min(99, Math.round(last / 1e6 / dur * 100)));
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      j.proc = null;
      if (j.state === 'cancelled') return reject(Object.assign(new Error('cancelled'), { cancelled: true }));
      if (code !== 0) return reject(new Error('ffmpeg could not merge them: ' + (log.trim().split('\n').pop() || 'code ' + code)));
      resolve();
    });
  });
}

function get(id) { return view(JOBS.get(String(id))); }

function cancel(id) {
  const j = JOBS.get(String(id));
  if (!j || j.state !== 'running') return view(j);
  j.state = 'cancelled';
  try { if (j.proc) j.proc.kill(); } catch (e) { /* gone already */ }
  return view(j);
}

// Finished jobs are forgotten after an hour.
function _sweep() {
  const now = Date.now();
  for (const [id, j] of JOBS) if (j.state !== 'running' && now - j.startedAt > 3600 * 1000) JOBS.delete(id);
}

module.exports = { start, get, cancel, clipOf, startClip };
