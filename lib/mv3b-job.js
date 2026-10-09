'use strict';

/* mv3b-job.js - getting a blank-project render ready to run, and finishing one.

   Two places start a render: Export -> Render (routes/mv3b.js) and the render queue
   (routes/mv3q.js). They had two copies of this, and the copies drifted: the queue's never
   wrote the caption file, so every queued render came out without its subtitles while the same
   timeline rendered from Export had them. One copy now, used by both.

   prepare(timeline, id, adv) -> Promise of { args, dur, w, h, assPath, settings, warnings } or { error }
     the captions written, every sound asked whether it has one, the graph built, every input
     checked to be on the disk, the ffmpeg
     arguments up to (not including) the output path. `dispose()` the result when ffmpeg has
     exited - the caption file is read while it runs, so it cannot go any sooner.
   finish(outAbs, settings, report, finalAbs) -> the export settings that work on the finished file
     (the playback speed, the black tail - lib/render-finish.js), the draft given its own name
     (`finalAbs`), then the render's poster, beside it in thumbs/ (lib/video-thumb.js).
     report({ phase, at }) is told what it is doing.

   A RENDER IN THE WORKS HAS A DRAFT NAME (phase V23): `<name>.part.mp4`, and the speed and tail
   passes write `.speed.mp4` / `.tail.mp4` beside it. The renders shelf does not show them
   (`isDraft`), a failed render deletes its draft, and `sweepDrafts()` clears what an interrupted
   render left when the server starts - nothing renders then. */

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
  // A FILE THAT IS GONE is left out, not a reason to refuse the whole render - the talking-head
  // render skipped one too, and a project brought over from it can name clips the library no longer
  // has. What was left out is said, in `warnings`.
  const gone = new Set();
  for (const t of ((timeline && timeline.tracks) || [])) {
    for (const c of ((t && t.clips) || [])) if (c && c.src && !_resolve(c.src)) gone.add(String(c.src));
  }
  const tl = !gone.size ? (timeline || {}) : {
    ...timeline,
    tracks: timeline.tracks.map((t) => ({ ...t, clips: ((t && t.clips) || []).filter((c) => !(c && c.src && gone.has(String(c.src)))) })),
  };
  const warnings = gone.size
    ? ['left out ' + gone.size + (gone.size === 1 ? ' file that is' : ' files that are') + ' not on the disk: '
       + [...gone].slice(0, 5).map((s) => s.split('/').pop()).join(', ') + (gone.size > 5 ? '…' : '')]
    : [];
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
  return { args, dur: g.dur, w: settings.w, h: settings.h, assPath, dispose, settings, warnings };
}

// A RENDER GETS ITS POSTER THE MOMENT IT EXISTS. The renders shelf is the renders folder, and a
// render without a poster there reads as a truncated file (routes/library.js). Waiting for the page
// to keep it left every queued render, and every result closed without saving, "unreadable".
// Failure is swallowed: a render that cannot be posterised is still a render.
async function finish(outAbs, settings, report, finalAbs) {
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
  // The draft becomes the render: its own name, and the shelf shows it from here on.
  if (finalAbs && finalAbs !== outAbs) {
    await _renameRetrying(outAbs, finalAbs);
    outAbs = finalAbs;
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
  return { warnings, file: outAbs };
}

// ── Drafts ──────────────────────────────────────────────────────────────────
const DRAFT_RE = /\.(part|speed|tail)\.mp4$/i;
const isDraft = (name) => DRAFT_RE.test(String(name || ''));
const draftOf = (finalAbs) => String(finalAbs).replace(/\.mp4$/i, '') + '.part.mp4';

// On Windows a file just closed by ffmpeg can be held for a moment by an antivirus scan or the indexer.
async function _renameRetrying(from, to) {
  for (let attempt = 1; ; attempt++) {
    try { fs.renameSync(from, to); return; }
    catch (e) {
      if (attempt >= 6 || !['EPERM', 'EACCES', 'EBUSY'].includes(e.code)) throw e;
      await new Promise(r => setTimeout(r, 100 * attempt));
    }
  }
}

/** A failed render's draft, and whatever its passes left beside it. Never throws. */
function dropDraft(draftAbs) {
  const base = String(draftAbs || '').replace(/\.part\.mp4$/i, '');
  if (!base || base === String(draftAbs)) return;
  for (const p of [draftAbs, base + '.part.speed.mp4', base + '.part.tail.mp4']) {
    try { fs.rmSync(p, { force: true }); } catch (e) { /* held open: the next start clears it */ }
  }
}

/** What interrupted renders left in the renders folder - the top and each project's folder. At the server's start. */
function sweepDrafts() {
  const root = require('./config').MEDIA.renders;
  let n = 0;
  const sweep = (dir) => {
    let ents = [];
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const d of ents) {
      if (d.isFile() && isDraft(d.name)) {
        try { fs.rmSync(path.join(dir, d.name), { force: true }); n++; } catch (e) { /* held open */ }
      } else if (d.isDirectory() && dir === root && d.name !== 'thumbs') sweep(path.join(dir, d.name));
    }
  };
  sweep(root);
  if (n) console.log('[mv3b] cleared ' + n + ' unfinished render file(s)');
  return n;
}

module.exports = { prepare, finish, ASS_DIR, isDraft, draftOf, dropDraft, sweepDrafts };
