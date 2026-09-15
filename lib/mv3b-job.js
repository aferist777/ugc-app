'use strict';

/* mv3b-job.js - getting a blank-project render ready to run, and finishing one.

   Two places start a render: Export -> Render (routes/mv3b.js) and the render queue
   (routes/mv3q.js). They had two copies of this, and the copies drifted: the queue's never
   wrote the caption file, so every queued render came out without its subtitles while the same
   timeline rendered from Export had them. One copy now, used by both.

   prepare(timeline, id) -> Promise of { args, dur, w, h, assPath } or { error }
     the captions written, every sound asked whether it has one, the graph built, every input
     checked to be on the disk, the ffmpeg
     arguments up to (not including) the output path. `dispose()` the result when ffmpeg has
     exited - the caption file is read while it runs, so it cannot go any sooner.
   finish(outAbs) -> the render's poster, beside it in thumbs/ (lib/video-thumb.js). */

const fs = require('fs');
const path = require('path');
const { buildGraph, frame, audibleClips } = require('./mv3b-render');
const { probe } = require('./media-probe');
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

async function prepare(timeline, id) {
  const tl = timeline || {};
  const silent = await _silent(tl);
  const assPath = _writeAss(tl, id);
  const g = buildGraph(tl, { assPath, silent });
  const dispose = () => _dropAss(assPath);
  if (!(g.dur > 0)) { dispose(); return { error: 'nothing on the timeline to render' }; }
  // Every input resolved before a single one is decoded. A graph half-built around a file that
  // turns out to be missing fails deep inside ffmpeg with a message about a stream index, which
  // is a long way from "that clip is gone".
  const args = ['-hide_banner', '-y'];
  const missing = [];
  for (const i of g.inputs) {
    const abs = _resolve(i.file);
    if (!abs) { missing.push(i.file); continue; }
    if (i.loop) args.push('-loop', '1');
    if (i.ss) args.push('-ss', String(i.ss));
    args.push('-t', String(i.t), '-i', abs);
  }
  if (missing.length) { dispose(); return { error: 'these files are not on the disk: ' + missing.join(', ') }; }
  args.push('-filter_complex', g.filter, '-map', `[${g.map.v}]`);
  if (g.map.a) args.push('-map', `[${g.map.a}]`); else args.push('-an');
  args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
            '-r', '30', '-t', String(g.dur));
  if (g.map.a) args.push('-c:a', 'aac', '-b:a', '192k');
  return { args, dur: g.dur, w: g.w, h: g.h, assPath, dispose };
}

// A RENDER GETS ITS POSTER THE MOMENT IT EXISTS. The renders shelf is the renders folder, and a
// render without a poster there reads as a truncated file (routes/library.js). Waiting for the page
// to keep it left every queued render, and every result closed without saving, "unreadable".
// Failure is swallowed: a render that cannot be posterised is still a render.
async function finish(outAbs) {
  try {
    const VT = require('./video-thumb');
    const url = toUrl(outAbs);
    if (!url) return;
    const thumb = path.join(path.dirname(outAbs), 'thumbs', path.basename(outAbs).replace(/\.[^.]+$/, '') + '_thumb.jpg');
    if (fs.existsSync(thumb)) return;
    await VT.makeThumb(url);
  } catch (e) {
    console.warn('[mv3b] poster failed:', e.message);
  }
}

module.exports = { prepare, finish, ASS_DIR };
