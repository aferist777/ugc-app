'use strict';

/* mv3b-job.js - getting a blank-project render ready to run, and finishing one.

   Two places start a render: Export -> Render (routes/mv3b.js) and the render queue
   (routes/mv3q.js). They had two copies of this, and the copies drifted: the queue's never
   wrote the caption file, so every queued render came out without its subtitles while the same
   timeline rendered from Export had them. One copy now, used by both.

   prepare(timeline, id, adv, enc) -> Promise of { args, dur, w, h, assPath, settings, warnings } or { error }
     (`enc` - a merge's own encoder and frame rate, phase V49.2; none for an export)
     the captions written, every sound asked whether it has one, the graph built, every input
     checked to be on the disk, the ffmpeg
     arguments up to (not including) the output path. `dispose()` the result when ffmpeg has
     exited - the caption file is read while it runs, so it cannot go any sooner.
   finish(outAbs, settings, report, finalAbs, srt) -> the export settings that work on the finished file
     (the playback speed, the black tail - lib/render-finish.js), the draft given its own name
     (`finalAbs`), the subtitles beside it (`srt`, the text prepare built), then the render's poster,
     beside it in thumbs/ (lib/video-thumb.js). report({ phase, at }) is told what it is doing.

   THE SUBTITLES BESIDE A RENDER (phase V30, block 4; the owner's (с11), (с39)): with the export's box on (the
   default), `<name>.en_US.srt` - the subtitle lane as classic subtitles (public/js/captions/srt.js), timed for
   the finished file's speed - is written next to the video once it has its own name: a draft never has one, a
   failed render leaves none. It follows its video wherever the video goes (`srtOf`): renamed by Save, deleted by
   Cancel and by the shelf, moved with its project's folder.

   A RENDER IN THE WORKS HAS A DRAFT NAME (phase V23): `<name>.part.mp4`, and the speed and tail
   passes write `.speed.mp4` / `.tail.mp4` beside it. The renders shelf does not show them
   (`isDraft`), a failed render deletes its draft, and `sweepDrafts()` clears what an interrupted
   render left when the server starts - nothing renders then. */

const fs = require('fs');
const path = require('path');
const { buildGraph, frame, audibleClips } = require('./mv3b-render');
const { probe } = require('./media-probe');
const FIN = require('./render-finish');
const { buildAss, captionLanes, SRT } = require('./mv3b-subs');
const { TEMP_PUBLIC_DIR } = require('./config');
const { toDisk, toUrl } = require('./media');
const PITCH = require('./pitch-copy');
const { isPitched } = require('../public/js/sound/pitch.js');

// Only where media legitimately lives: a src is a web path as the pages use it (lib/media.js).
function _resolve(rel) {
  const abs = toDisk(rel);
  return abs && fs.existsSync(abs) ? abs : null;
}

// The captions, written where ffmpeg can be pointed at them - a file because that is the only
// thing libass reads, and one per job so two renders cannot burn each other's words.
const ASS_DIR = path.join(TEMP_PUBLIC_DIR, 'mv3b_ass');

const FILTER_INLINE = 20000;

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

// (phase V76) THE CLIPS AT ANOTHER PITCH - clip id -> its file's copy at that pitch (lib/pitch-copy.js), made one at a time when
// missing. A copy that cannot be made leaves its clip at its own pitch, and the render says so.
async function _pitched(tl, silent, warnings) {
  const out = new Map();
  for (const { clip } of audibleClips(tl)) {
    if (!isPitched(clip) || !clip.src || (silent && silent.has(clip.src))) continue;
    const abs = _resolve(clip.src);
    if (!abs) continue;
    try { out.set(String(clip.id), await PITCH.copyOf(abs, clip.pitch)); }
    catch (e) { warnings.push('"' + (clip.name || clip.src) + '" is heard at its own pitch - its copy could not be made (' + e.message + ')'); }
  }
  return out;
}

// (phase V49.2) `enc` - a merge's own encoding (lib/merge-clips.js, render-finish.js encoderArgs): { video, rate }, the
// video encoder's arguments and the frame rate of the bed and the file. The export and the queue pass none.
async function prepare(timeline, id, adv, enc) {
  // A CLIP WHOSE FILE IS GONE STOPS THE RENDER (phase V28.4, the owner 2026-10-12): it is red on the timeline, to be
  // replaced or removed first - a film rendered with holes in it is not the film that was cut. It used to be left out
  // with a warning.
  const gone = missingCount(timeline);
  if (gone) return { error: gone + (gone === 1 ? ' clip has' : ' clips have') + ' no file - replace or remove ' + (gone === 1 ? 'it' : 'them') + ' (red on the timeline)' };
  const tl = timeline || {};
  const warnings = [];
  const settings = FIN.settingsOf(adv, frame(tl));
  const silent = await _silent(tl);
  // (phase V76) The clips at another pitch: their files' copies at it, made here when missing (lib/pitch-copy.js).
  const pitched = await _pitched(tl, silent, warnings);
  // (phase V65, block 5) The patterns' tiles laid out for this frame, once per look (lib/pattern-bake.js).
  const patterns = await require('./pattern-bake').bake(tl, frame(tl));
  // (phase V74) The patterns of main video (public/js/overlay/pattern.js layersOf).
  for (const c of require('../public/js/overlay/pattern.js').layersOf(tl)) {
    if (!patterns.has(c.id)) warnings.push('a pattern could not be laid out - it is laid as a picture (' + c.src + ')');
  }
  const assPath = _writeAss(tl, id);
  // (phase V84) The clips' effects: the pictures they lay over a clip (lib/fx-assets.js - made once, kept in cache/fx/) and the
  // folder their frame-by-frame commands are written to (buildGraph returns them in `files`).
  let fxAssets = {};
  try { fxAssets = await require('./fx-assets').prepare(tl, frame(tl)); }
  catch (e) { warnings.push('the effects’ vignette or lines could not be made - they are left out (' + e.message + ')'); }
  const g = buildGraph(tl, { assPath, silent, fps: (enc && enc.rate) || settings.fps,
                            out: { w: settings.w, h: settings.h }, patterns, pitched,
                            fxDir: ASS_DIR, fxTag: String(id).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 40), fxAssets });
  const fxFiles = (g.files || []).map((f) => f.path);
  if (fxFiles.length) {
    fs.mkdirSync(ASS_DIR, { recursive: true });
    for (const f of g.files) fs.writeFileSync(f.path, f.text, 'utf8');
  }
  // (phase V33.2) A LONG GRAPH GOES IN A FILE. Windows starts a program with at most 32767 characters, and a timeline of
  // clips that follow their faces carries an expression of time per clip: past FILTER_INLINE the graph is written beside
  // the .ass and handed over with -filter_complex_script.
  let scriptPath = null;
  if (g.filter.length > FILTER_INLINE) {
    fs.mkdirSync(ASS_DIR, { recursive: true });
    scriptPath = path.join(ASS_DIR, 'graph_' + id + '.txt');
    fs.writeFileSync(scriptPath, g.filter, 'utf8');
  }
  const dispose = () => { _dropAss(assPath); _dropAss(scriptPath); for (const f of fxFiles) _dropAss(f); };
  if (!(g.dur > 0)) { dispose(); return { error: 'nothing on the timeline to render' }; }
  // Every input resolved before a single one is decoded. A graph half-built around a file that
  // turns out to be missing fails deep inside ffmpeg with a message about a stream index, which
  // is a long way from "that clip is gone".
  const args = ['-hide_banner', '-y'];
  const missing = [];
  for (const i of g.inputs) {
    if (i.lavfi) { args.push('-f', 'lavfi', '-t', String(i.t), '-i', i.lavfi); continue; }
    const abs = (i.abs && fs.existsSync(i.abs)) ? i.abs : _resolve(i.file);
    if (!abs) { missing.push(i.file); continue; }
    if (i.loop) args.push('-loop', '1');
    if (i.ss) args.push('-ss', String(i.ss));
    args.push('-t', String(i.t), '-i', abs);
  }
  if (missing.length) { dispose(); return { error: 'these files are not on the disk: ' + missing.join(', ') }; }
  args.push(...(scriptPath ? ['-filter_complex_script', scriptPath] : ['-filter_complex', g.filter]), '-map', `[${g.map.v}]`, '-map', `[${g.map.a}]`);
  args.push(...FIN.encoderArgs(settings, enc), '-t', String(g.dur), '-movflags', '+faststart');
  // The subtitles file's text, from the same timeline - '' when the box is off or the lane says nothing.
  let srt = '';
  if (settings.srt) {
    try { srt = SRT.buildSrt(tl, { speed: settings.speed, end: g.dur }); }
    catch (e) { warnings.push('the subtitles file could not be made (' + e.message + ')'); }
  }
  return { args, dur: g.dur, w: settings.w, h: settings.h, assPath, dispose, settings, warnings, srt };
}

/** The subtitles file of a render: `<its name>.en_US.srt` beside it. */
const srtOf = (videoAbs) => String(videoAbs).replace(/\.[^.\\/]+$/, '') + SRT.SRT_TAIL;

// A RENDER GETS ITS POSTER THE MOMENT IT EXISTS. The renders shelf is the renders folder, and a
// render without a poster there reads as a truncated file (routes/library.js). Waiting for the page
// to keep it left every queued render, and every result closed without saving, "unreadable".
// Failure is swallowed: a render that cannot be posterised is still a render.
async function finish(outAbs, settings, report, finalAbs, srt) {
  const say = (phase, at) => { if (report) { try { report({ phase, at: at || 0 }); } catch (e) { /* a progress reader */ } } };
  const warnings = [];
  // A speed that was asked for and not applied is a failed render, not a detail.
  if (settings && Math.abs(settings.speed - 1) > 0.001) {
    const tmp = outAbs.replace(/\.mp4$/i, '') + '.speed.mp4';
    say('speed', 0);
    try {
      await FIN.speed(outAbs, tmp, settings, (t) => say('speed', t));
      fs.rmSync(outAbs, { force: true });
      fs.renameSync(tmp, outAbs);
    } finally { fs.rmSync(tmp, { force: true }); }
  }
  // (phase V75, the owner's (кп7)) No black tail any more: the render window's Extras are gone.
  // The draft becomes the render: its own name, and the shelf shows it from here on.
  if (finalAbs && finalAbs !== outAbs) {
    // (phase V33.4) TAKING THE PLACE OF AN OLDER RENDER of the same name - a highlights fragment rendered again (the owner's
    // (х41); routes/mv3q.js names it so only for its own earlier render): the old film's poster, subtitles and the rest of
    // what was derived from it go first - they describe a film that is no longer there -, then the file itself is replaced.
    if (fs.existsSync(finalAbs)) _dropDerived(finalAbs);
    await _renameRetrying(outAbs, finalAbs);
    outAbs = finalAbs;
  }
  // The subtitles beside it - an extra like the tail: a render without them is still the render, and it is said.
  if (srt) {
    try { fs.writeFileSync(srtOf(outAbs), srt, 'utf8'); }
    catch (e) { warnings.push('the subtitles file could not be written (' + e.message + ')'); }
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

// What was derived from a render - its poster, its subtitles, its loudness mark - deleted; the render itself stays. Background
// work reading the file lets go first (lib/file-release.js). Never throws.
function _dropDerived(abs) {
  try { require('./file-release').release([abs]); } catch (e) { /* nobody listening */ }
  let sibs = [];
  try { sibs = require('./relocate').siblingsOf(abs, path.basename(abs)).map(([p]) => p); } catch (e) { /* none */ }
  for (const p of [...sibs, srtOf(abs)]) {
    try { fs.rmSync(p, { force: true }); } catch (e) { /* held open: made again when asked */ }
  }
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

// How many pieces of media on a timeline have no file - a clip and its sound below it are one (their pairId).
function missingCount(timeline) {
  const gone = require('./timeline-media').missingOf(timeline);
  if (!gone.length) return 0;
  const pairs = new Map();
  for (const t of ((timeline && timeline.tracks) || [])) for (const c of ((t && t.clips) || [])) if (c && c.id) pairs.set(String(c.id), c.pairId || c.id);
  return new Set(gone.map((g) => String(pairs.get(g.id) || g.id))).size;
}

module.exports = { prepare, finish, ASS_DIR, isDraft, draftOf, dropDraft, sweepDrafts, missingCount, srtOf, dropDerived: _dropDerived };
