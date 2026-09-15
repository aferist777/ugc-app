'use strict';

/* mv3b-job.js - getting a blank-project render ready to run, and finishing one.

   Two places start a render: Export -> Render (routes/mv3b.js) and the render queue
   (routes/mv3q.js). They had two copies of this, and the copies drifted: the queue's never
   wrote the caption file, so every queued render came out without its subtitles while the same
   timeline rendered from Export had them. One copy now, used by both.

   prepare(timeline, id, adv) -> Promise of { args, dur, w, h, assPath, settings } or { error }
     the captions written, every sound asked whether it has one, the graph built, every input
     checked to be on the disk, the ffmpeg
     arguments up to (not including) the output path. `dispose()` the result when ffmpeg has
     exited - the caption file is read while it runs, so it cannot go any sooner.
   finish(outAbs, settings, report) -> the export settings that work on the finished file (the
     playback speed, the black tail - lib/render-finish.js), then the render's poster, beside it in
     thumbs/ (lib/video-thumb.js). report({ phase, at }) is told what it is doing. */

const fs = require('fs');
const path = require('path');
const { buildGraph, frame, audibleClips } = require('./mv3b-render');
const { probe } = require('./media-probe');
const FIN = require('./render-finish');
const { buildAss, captionLanes } = require('./mv3b-subs');
const { TEMP_PUBLIC_DIR } = require('./config');
const { toDisk, toUrl } = require('./media');

// Only where media legitimately lives: a src is a web path as the pages use it (lib/media.js).
function _resolve(rel) {
  const abs = toDisk(rel);
  return abs && fs.existsSync(abs) ? abs : null;
}

// The captions, written where ffmpeg can be pointed at them - a file because that is the only
// thing libass reads, and one per job so two renders cannot burn each other's words.
const ASS_DIR = path.join(TEMP_PUBLIC_DIR, 'mv3b_ass');

function _writeAss(timeline, id) {
  const lanes = captionLanes(timeline);
  if (!lanes.length) return null;
  const { w, h } = frame(timeline);
  const text = buildAss(lanes, w, h);
  if (!text) return null;
  fs.mkdirSync(ASS_DIR, { recursive: true });
  const p = path.join(ASS_DIR, 'ass_' + id + '.ass');
  fs.writeFileSync(p, text, 'utf8');
  return p;
}

function _dropAss(p) {
  try { if (p && fs.existsSync(p)) fs.unlinkSync(p); } catch (e) { /* a temp file */ }
}

// THE FILES WITH NO SOUND IN THEM. A film on a video lane lands with a sound twin whether or not
// it has any sound (a generated clip often has none), and a mix that names the audio of a file
// without one is refused outright by ffmpeg - the whole render fails over a silence. Asked of
// each file once, before the graph is written.
async function _silent(tl) {
  const out = new Set();
  const srcs = [...new Set(audibleClips(tl).map(x => x.clip.src).filter(Boolean))];
  await Promise.all(srcs.map(async (src) => {
    const abs = _resolve(src);
    if (abs && !(await probe(abs)).audio) out.add(src);
  }));
  return out;
}

async function prepare(timeline, id, adv) {
  const tl = timeline || {};
  const settings = FIN.settingsOf(adv, frame(tl));
  const silent = await _silent(tl);
  const assPath = _writeAss(tl, id);
  const g = buildGraph(tl, { assPath, silent, eq: settings.eq, noise: settings.noise, fps: settings.fps,
                            out: { w: settings.w, h: settings.h } });
  const dispose = () => _dropAss(assPath);
  if (!(g.dur > 0)) { dispose(); return { error: 'nothing on the timeline to render' }; }
  // Every input resolved before a single one is decoded. A graph half-built around a file that
  // turns out to be missing fails deep inside ffmpeg with a message about a stream index, which
  // is a long way from "that clip is gone".
  const args = ['-hide_banner', '-y'];
  const missing = [];
  for (const i of g.inputs) {
    if (i.lavfi) { args.push('-f', 'lavfi', '-t', String(i.t), '-i', i.lavfi); continue; }
    const abs = _resolve(i.file);
    if (!abs) { missing.push(i.file); continue; }
    if (i.loop) args.push('-loop', '1');
    if (i.ss) args.push('-ss', String(i.ss));
    args.push('-t', String(i.t), '-i', abs);
  }
  if (missing.length) { dispose(); return { error: 'these files are not on the disk: ' + missing.join(', ') }; }
  args.push('-filter_complex', g.filter, '-map', `[${g.map.v}]`, '-map', `[${g.map.a}]`);
  args.push(...FIN.encoderArgs(settings), '-t', String(g.dur), '-movflags', '+faststart');
  return { args, dur: g.dur, w: settings.w, h: settings.h, assPath, dispose, settings };
}

// A RENDER GETS ITS POSTER THE MOMENT IT EXISTS. The renders shelf is the renders folder, and a
// render without a poster there reads as a truncated file (routes/library.js). Waiting for the page
// to keep it left every queued render, and every result closed without saving, "unreadable".
// Failure is swallowed: a render that cannot be posterised is still a render.
async function finish(outAbs, settings, report) {
  const say = (phase, at) => { if (report) { try { report({ phase, at: at || 0 }); } catch (e) { /* a progress reader */ } } };
  const warnings = [];
  // The speed first: a black tail is minutes of black whatever speed the film runs at. A speed
  // that was asked for and not applied is a failed render, not a detail.
  if (settings && Math.abs(settings.speed - 1) > 0.001) {
    const tmp = outAbs.replace(/\.mp4$/i, '') + '.speed.mp4';
    say('speed', 0);
    try {
      await FIN.speed(outAbs, tmp, settings, (t) => say('speed', t));
      fs.rmSync(outAbs, { force: true });
      fs.renameSync(tmp, outAbs);
    } finally { fs.rmSync(tmp, { force: true }); }
  }
  // The tail is an extra, and a render without it is still the render: kept, and said.
  if (settings && settings.tailMinutes) {
    say('tail', 0);
    try { await FIN.blackTail(outAbs, settings, (t) => say('tail', t)); }
    catch (e) { warnings.push('the black tail could not be added (' + e.message + ')'); console.warn('[mv3b] black tail failed:', e.message); }
  }
  say('poster', 0);
  try {
    const VT = require('./video-thumb');
    const url = toUrl(outAbs);
    const thumb = path.join(path.dirname(outAbs), 'thumbs', path.basename(outAbs).replace(/\.[^.]+$/, '') + '_thumb.jpg');
    if (url && !fs.existsSync(thumb)) await VT.makeThumb(url);
  } catch (e) {
    console.warn('[mv3b] poster failed:', e.message);
  }
  return { warnings };
}

module.exports = { prepare, finish, ASS_DIR };
