'use strict';

// ════════════════════════════════════════════════════════════════════════════
// CLIPS IN A ROW MERGED INTO ONE FILE (phase V45, the owner 2026-10-24: "выделить несколько подряд идущих фрагментов и их
// объединить, типа зарендерить внутри проекта"; answers (ю1)-(ю4)).
//
// Merge picks clips that follow one another on one lane - with their sound halves on the lane linked to it - and asks here
// for ONE file of them: the picture as it is in the frame (the project's shape, the fit, the framing that follows a face,
// every effect - burnt in) and their sound (each clip's volume and fades - burnt in; not the lane's, the lane keeps it).
// Rendered with the export's own graph (lib/mv3b-job.js prepare, lib/mv3b-render.js), without captions - they stay on their
// lane -, finer than an export (CRF 16: it is rendered again in the film). The file goes into the PROJECT's folder,
// `projects/<folder>/merged/` (ю1): not a shelf of the Library, and gone with the project. A sound alone (a talking head's
// reads) is rendered over black all the same and laid as a sound. The page lays the file in place of the clips, one step
// to undo (ю2: the file stays). Nothing is paid: this computer's ffmpeg.
//
//   start({ key, format, video, audio }) -> job      video / audio - the clips as the page has them, in order
//   get(id) -> job;  cancel(id)
//   job: { id, key, state: running|done|failed|cancelled, pct, src, dur, error }
// ════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const MSTORE = require('./merge-store');
const JOB = require('./mv3b-job');
const { PROJECTS_DIR } = require('./config');
const { toUrl, toDiskExisting } = require('./media');

const SEAM = 0.011;                // two clips this close meet
const MAX_SECONDS = 30 * 60;       // a merge of half an hour at most
const MAX_CLIPS = 600;
const JOBS = new Map();
const r3 = (v) => Math.round(v * 1000) / 1000;

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

async function _run(j, sub, folder, adv) {
  // The export's settings, finer: it is rendered again in the film. Its frame rate, its size; no tail, no speed, no noise.
  const fps = [24, 25, 30, 50, 60].includes(+(adv && adv.fps)) ? +adv.fps : 30;
  const p = await JOB.prepare(sub, j.id, { crf: 16, preset: 'veryfast', fps, srt: false });
  if (p.error) throw new Error(p.error);
  const dir = path.join(PROJECTS_DIR, folder, 'merged');
  fs.mkdirSync(dir, { recursive: true });
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const base = 'merged_' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
  let name = base + '.mp4';
  for (let n = 2; fs.existsSync(path.join(dir, name)); n++) name = base + '_' + n + '.mp4';
  const out = path.join(dir, name);
  const part = out + '.part.mp4';
  try {
    await new Promise((resolve, reject) => {
      const proc = spawn(ffmpegPath, [...p.args, '-progress', 'pipe:1', '-nostats', part], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
      j.proc = proc;
      let log = '';
      proc.stderr.on('data', (x) => { log = (log + x).slice(-2000); });
      proc.stdout.on('data', (x) => {
        const m = /out_time_ms=(\d+)/g;
        let k, last = null;
        while ((k = m.exec(String(x)))) last = +k[1];
        if (last != null && p.dur > 0) j.pct = Math.max(0, Math.min(99, Math.round(last / 1e6 / p.dur * 100)));
      });
      proc.on('error', reject);
      proc.on('close', (code) => {
        j.proc = null;
        if (j.state === 'cancelled') return reject(Object.assign(new Error('cancelled'), { cancelled: true }));
        if (code !== 0) return reject(new Error('ffmpeg could not merge them: ' + (log.trim().split('\n').pop() || 'code ' + code)));
        resolve();
      });
    });
    fs.renameSync(part, out);
    j.src = toUrl(out);
    j.pct = 100;
    j.state = 'done';
    console.log('[merge] ' + j.key + ': ' + sub.tracks[0].clips.length + ' + ' + sub.tracks[1].clips.length + ' clips -> ' + name + ' (' + j.dur + ' s, '
      + ((Date.now() - j.startedAt) / 1000).toFixed(1) + ' s)');
  } catch (e) {
    if (j.state === 'running') { j.state = 'failed'; j.error = e.message; }
  } finally {
    try { fs.rmSync(part, { force: true }); } catch (e) { /* held for a moment */ }
    if (p.dispose) p.dispose();
  }
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

module.exports = { start, get, cancel };
