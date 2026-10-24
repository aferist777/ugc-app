'use strict';

/* highlights-cut.js - a highlights fragment made (phase V33.1, block 3; the owner's (х4а), (х16), (х17)).

   A moment the agent found is 1 to 3 PIECES of the video. Each piece is cut into a file of its own, re-encoded so it
   starts and ends exactly where its sentences do, with THREE SECONDS MORE on either side ((х17) - not seen: the clip on
   the timeline is trimmed to the piece, and can be drawn out a little), into the project's clips/ folder. The fragment's
   first frame - the frame its first piece opens on, cut to 9:16 - is the tile's picture.

   Its TIMELINE (hl_<id>_<n>, in the project's folder) is a 9:16 project like any other: the pieces one after another on
   the main video lane - the picture filling the frame, its window following the faces (phase V33.2: `frame`, worked out
   by public/js/framing/path.js from what lib/faces.js counted; the middle when the faces could not be counted) - and their sound
   under them, joined by a plain cut; and a subtitle lane made of the words the video was heard as - no second hearing,
   nothing paid - each piece's words moved to where the piece lies, cut into pages by the captions' own rules, in the
   style chosen in the popup ((х16)); a page on a frame split into two bands for more than half its time in the middle (phase
   V40, public/js/captions/split.js). After that it is the person's: trimmed, captioned, given music, rendered. */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');

const MSTORE = require('./merge-store');
const SHAPE = require('./timeline-shape');
const CAP = require('./mv3b-subs');
const PROBE = require('./media-probe');
const PP = require('./preview-proxy');
const FRAMING = require('../public/js/framing/path.js');
const TITLE = require('../public/js/captions/title.js');
const SPLIT = require('../public/js/captions/split.js');

const MARGIN = 3;                  // seconds kept on either side of a piece, unseen
const THUMB_W = 360;
const r2 = (t) => Math.round((+t || 0) * 100) / 100;
const r3 = (t) => Math.round((+t || 0) * 1000) / 1000;

function _ffmpeg(args, { onTime, signal } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let err = '';
    let buf = '';
    const stop = () => { try { p.kill(); } catch (e) { /* gone */ } };
    if (signal) { if (signal.aborted) stop(); else signal.addEventListener('abort', stop, { once: true }); }
    p.stdout.on('data', (c) => {
      if (!onTime) return;
      buf += c;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        const m = /^out_time_(?:us|ms)=(\d+)/.exec(line);
        if (m) onTime(Number(m[1]) / 1e6);
      }
    });
    p.stderr.on('data', (c) => { err = (err + c).slice(-600); });
    p.on('error', (e) => reject(e));
    p.on('close', (code) => {
      if (signal) signal.removeEventListener('abort', stop);
      if (signal && signal.aborted) return reject(Object.assign(new Error('cancelled'), { cancelled: true }));
      if (code !== 0) return reject(new Error('ffmpeg could not cut it: ' + (err.trim().split('\n').pop() || 'code ' + code)));
      resolve();
    });
  });
}

/**
 * One piece of the video, with its margins, into `outAbs`. `from`/`to` in the video's seconds, `total` its length.
 * Resolves with { before, after, seconds } - the margins it got and the file's length.
 */
async function cutPiece(srcAbs, outAbs, from, to, total, { onFrac, signal } = {}) {
  const before = Math.min(MARGIN, Math.max(0, from));
  const after = Math.min(MARGIN, Math.max(0, (total > 0 ? total : to + MARGIN) - to));
  const start = from - before;
  const len = (to - from) + before + after;
  fs.mkdirSync(path.dirname(outAbs), { recursive: true });
  const rand = crypto.randomBytes(3).toString('hex');
  const tmp = outAbs + '.' + rand + '.part.mp4';
  // (phase V33.2 block 0) THE PREVIEW'S COPY IN THE SAME PASS - a second output of the one decode, written in scratch and
  // put where the preview looks for it once the piece has its name (the copy is keyed by the file's path and time). The
  // fragment is ready with it, so pressing its tile shows the picture at once.
  fs.mkdirSync(PP.CACHE_DIR, { recursive: true });
  const ptmp = path.join(PP.CACHE_DIR, path.basename(outAbs, '.mp4') + '.' + rand + '.part.mp4');
  try {
    await _ffmpeg(['-hide_banner', '-nostdin', '-v', 'error', '-progress', 'pipe:1', '-nostats',
      '-ss', start.toFixed(3), '-i', srcAbs,
      '-t', len.toFixed(3), '-map', '0:v:0', '-map', '0:a:0?', '-sn', '-dn',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-y', tmp,
      '-t', len.toFixed(3), '-map', '0:v:0', '-map', '0:a:0?', '-sn', '-dn', ...PP.encodeArgs(PP.DEFAULT_H, false), '-y', ptmp],
    { signal, onTime: (t) => { if (onFrac) onFrac(Math.min(1, t / Math.max(0.1, len))); } });
    fs.rmSync(outAbs, { force: true });
    fs.renameSync(tmp, outAbs);
    // A copy that cannot be put in place is only made again when the preview asks (routes/proxies.js).
    try { fs.renameSync(ptmp, PP.cachePath(outAbs, PP.DEFAULT_H, false)); } catch (e) { /* made on demand */ }
  } finally {
    try { fs.rmSync(tmp, { force: true }); } catch (e) { /* moved, or never made */ }
    try { fs.rmSync(ptmp, { force: true }); } catch (e) { /* moved, or never made */ }
  }
  const p = await PROBE.probe(outAbs).catch(() => ({}));
  return { before: r3(before), after: r3(after), seconds: r3(p.duration || len) };
}

/**
 * The frame at `at` seconds of a clip, cut to 9:16, as a JPEG `THUMB_W` wide: where its window is at that moment when it
 * follows its faces (`frame`, V33.2 - the whole frame over its blur on a shot with none), from its middle otherwise.
 */
async function thumb9x16(clipAbs, outAbs, at, frame) {
  fs.mkdirSync(path.dirname(outAbs), { recursive: true });
  let vf = 'crop=min(iw\\,ih*9/16):ih,scale=' + THUMB_W + ':-2';
  if (FRAMING.isFramed(frame) && frame.src && frame.src.w > 0) {
    const win = FRAMING.windowAt(frame, at, frame.src.w, frame.src.h, 9 / 16);
    const th = Math.round(THUMB_W * 16 / 9 / 2) * 2;
    if (win.kind === 'face') vf = `crop=w='trunc(ih*9/16/2)*2':h=ih:x='clip(${r3(win.x)}*iw-ow/2,0,iw-ow)':y=0,scale=${THUMB_W}:${th}`;
    else if (win.kind === 'whole') {
      // (phase V33.8) The middle `w` of the width - a documentary's 3:2 - as the preview and the render show it.
      const cut = win.w > 0 && win.w < 0.999 ? `crop=w='trunc(iw*${r3(win.w)}/2)*2':h=ih:x='(iw-ow)/2':y=0,` : '';
      vf = `split[a][b];[a]scale=${THUMB_W / 4}:${th / 4}:force_original_aspect_ratio=increase,crop=${THUMB_W / 4}:${th / 4},boxblur=10:2,` +
        `scale=${THUMB_W}:${th}[bg];[b]${cut}scale=${THUMB_W}:-2[fg];[bg][fg]overlay=0:(H-h)/2`;
    }
  }
  await _ffmpeg(['-hide_banner', '-nostdin', '-v', 'error', '-ss', Math.max(0, at).toFixed(3), '-i', clipAbs, '-frames:v', '1',
    '-vf', vf, '-q:v', '3', '-y', outAbs]);
}

// ── The caption style chosen in the popup ──────────────────────────────────
// The app's preset or the person's own (lib/caption-presets-store.js), worn as a base the way the captions view puts one on
// (public/js/captions/preset-use.js): its whole style, marked with its id. One not found - deleted since - is the plain style.
// A caption preset only: one of the person's saved from text (`kind: 'text'`, phase V42) is a title's look, not the subtitles'.
function _preset(presetId) {
  const id = String(presetId || '');
  if (!id) return null;
  const { PRESETS } = require('../public/js/captions/presets.js');
  let p = PRESETS.find((x) => x.id === id) || null;
  if (!p) { try { p = require('./caption-presets-store').get(id); } catch (e) { p = null; } }
  return p && p.kind !== 'text' ? p : null;
}
function styleOf(presetId) {
  const p = _preset(presetId);
  return CAP.normalizeStyle(p ? { ...p.style, preset: p.id } : {});
}

/**
 * (phase V33.3) The caption style a fragment wears, as its card says it: { preset, name, edited } - read from its timeline's
 * subtitle lane, the one place the style lives. `edited` when the lane was changed by hand since the preset was put on it
 * (public/js/captions/preset-use.js editedKeys, the same comparison).
 */
function capOf(tl) {
  const lane = ((tl && tl.tracks) || []).find((t) => t && t.kind === 'subs');
  const st = CAP.normalizeStyle((lane && lane.style) || {});
  const p = st.preset ? _preset(st.preset) : null;
  const titled = !!TITLE.titleLaneOf(tl);
  if (!p) return { preset: '', name: '', edited: false, titled };
  const base = CAP.normalizeStyle({ ...p.style, preset: p.id });
  const { DEF } = require('../public/js/captions/style.js');
  const edited = Object.keys(DEF).some((k) => k !== 'preset' && JSON.stringify(st[k]) !== JSON.stringify(base[k]));
  return { preset: p.id, name: p.name, edited, titled };
}

/** (phase V33.3) The title put on a made fragment's timeline (its card's "add title") - false when there is no room for it. */
function addTitle(key, text) {
  let ok = false;
  MSTORE.update(key, (tl) => {
    const secs = ((tl.tracks || []).find((t) => t && t.id === 'v1') || { clips: [] }).clips.reduce((m, c) => Math.max(m, (+c.start || 0) + (+c.dur || 0)), 0);
    ok = TITLE.putTitle(tl, text, secs, () => 'ht' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7));
    return ok;
  });
  return ok;
}

/**
 * The fragment's timeline record: `pieces` - [{ src, thumb, name, start, end (video seconds), before, seconds (file), frame }],
 * `words`/`segments` the video's as heard (video seconds), `presetId` the style, `o.title` the title on top ('' for none),
 * `o.music` (V33.8) the background music's clips for "audio 2" (lib/highlights-music.js clipsFor), [] for none.
 * Returns { tracks, seconds }.
 */
function layOut(pieces, words, segments, presetId, o) {
  const tracks = SHAPE.emptyBlank().tracks;
  const v1 = tracks.find((t) => t.id === 'v1');
  const a1 = tracks.find((t) => t.id === 'a1');
  const subs = tracks.find((t) => t.kind === 'subs');
  const fx = { transition: null, animation: null, filter: null };
  const stamp = Date.now().toString(36);
  let at = 0;
  const tlWords = [];
  const tlSegs = [];
  const joins = [];
  pieces.forEach((p, k) => {
    const dur = r2(p.end - p.start);
    const half = {
      name: p.name, libId: null, start: r2(at), dur, srcDur: r2(p.seconds), trimIn: r2(p.before),
      trimOut: r2(Math.max(0, p.seconds - p.before - dur)), speed: 1, reversed: false, ...fx,
      pairId: 'ph' + stamp + '_' + k, fit: 'fill', cropAlign: 'center',
    };
    v1.clips.push({ ...half, id: 'hv' + stamp + '_' + k, src: p.src, thumb: p.thumb || null, poster: null, volume: 0,
      ...(FRAMING.isFramed(p.frame) ? { frame: p.frame } : {}) });
    a1.clips.push({ ...half, id: 'ha' + stamp + '_' + k, src: p.src, thumb: null, poster: null, volume: 1, fit: null, cropAlign: null });
    if (k > 0) joins.push(r2(at));
    // The piece's words, where the piece now lies.
    for (const w of words) {
      const mid = (w.start + w.end) / 2;
      if (mid < p.start || mid >= p.end) continue;
      tlWords.push({ text: w.text, start: at + Math.max(0, w.start - p.start), end: at + Math.min(dur, w.end - p.start) });
    }
    for (const g of (segments || [])) {
      if (g.end <= p.start || g.start >= p.end) continue;
      tlSegs.push({ ...g, start: at + Math.max(0, g.start - p.start), end: at + Math.min(dur, g.end - p.start) });
    }
    at += dur;
  });
  subs.style = styleOf(presetId);
  // Whisper's own doubts (noise, a loop of a phrase) are left out, as when a lane is heard (public/js/captions/heard.js).
  const clean = CAP.HEARD.cleanWords(tlWords.sort((x, y) => x.start - y.start), tlSegs, { gaps: [], typed: [], fixed: [] });
  const pages = CAP.PAGES.paginate(clean.words, { lane: subs.style, format: '9:16', joins });
  subs.clips = pages.map((p, i) => ({
    id: 'h' + stamp + i.toString(36) + Math.random().toString(36).slice(2, 5), src: null, thumb: null,
    name: p.name, start: p.start, dur: Math.max(0.1, p.dur), words: p.words,
    srcDur: 0, trimIn: 0, trimOut: 0, speed: 1, reversed: false, ...fx, volume: null, pairId: null,
    ...(p.style ? { style: p.style } : {}), ...(p.tx != null ? { tx: p.tx } : {}), ...(p.ty != null ? { ty: p.ty } : {}),
  }));
  // (phase V40, the owner's (о6а), (о7)) A page on a frame split into two bands for more than half its time goes to the middle -
  // on the seam, not over the lower face (public/js/captions/split.js).
  SPLIT.placeBySplit({ format: '9:16', tracks });
  // (phase V33.3) The title on top for its first three seconds (public/js/captions/title.js; the owner's (х35)).
  if (o && o.title) TITLE.putTitle({ tracks }, o.title, at, () => 'ht' + stamp + Math.random().toString(36).slice(2, 7));
  // (phase V33.8, H3) The background music on "audio 2" - a bed under the voice (lib/highlights-music.js clipsFor), cut to
  // the fragment's own length.
  // (phase V41, (о11)) A new timeline has no "audio 2": it is made here, and only when there is music to lay.
  const a2 = o && Array.isArray(o.music) && o.music.some((c) => c && c.start < at - 0.05) ? SHAPE.musicLane(tracks) : null;
  if (a2 && o && Array.isArray(o.music)) {
    o.music.forEach((c, k) => {
      if (!c || !(c.start < at - 0.05)) return;
      a2.clips.push({ ...c, id: 'hm' + stamp + '_' + k, dur: r2(Math.min(c.dur, at - c.start)) });
    });
  }
  // Stored in exactly the shape a page's save stores.
  const shaped = SHAPE.sanitizeBlank({ format: '9:16', tracks });
  return { tracks: shaped.tracks, seconds: r2(at) };
}

/**
 * (phase V33.3) A preset put on the captions of several fragments at once (the owner's (х33)) - what a press on a tile does
 * to one lane on the page (timeline-b.js setSubsStyle, public/js/captions/preset-use.js presetStyle): the subtitle lane's
 * whole style replaced by the preset's, marked with its id, and its HEARD lines cut again by the captions' own rule
 * (pages.js recutClips) - the typed and corrected ones stay the very same lines, as does a line's own look. Each timeline in
 * one tick. Returns the keys changed; a preset that is neither the app's nor the person's is refused.
 */
function restyle(keys, presetId) {
  const p = _preset(presetId);
  if (!p) throw Object.assign(new Error('no such caption style - it may have been deleted'), { status: 400 });
  const style = styleOf(p.id);
  const makeId = () => 'h' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const done = [];
  for (const key of keys) {
    const t = MSTORE.update(key, (tl) => {
      const lane = (tl.tracks || []).find((x) => x && x.kind === 'subs');
      if (!lane) return false;
      lane.style = Object.assign({}, lane.style || {}, style);
      const clips = CAP.PAGES.recutClips(lane, tl, makeId);
      if (clips) lane.clips = clips;
      // (phase V40) The pages cut again carry their words' places: the split frame's rule looks at them as they are now.
      SPLIT.placeBySplit(tl);
      return true;
    });
    if (t) done.push(key);
  }
  return { keys: done, name: p.name, preset: p.id };
}

/** The timeline written (made, or replaced when it is there): the record's fields as POST /mv3/timeline/new makes them. */
function writeTimeline(key, title, tracks) {
  const s = MSTORE.read();
  const now = new Date().toISOString();
  const prev = s.timelines[key];
  s.timelines[key] = {
    title, createdAt: prev ? prev.createdAt : now, updatedAt: now, adv: prev ? prev.adv || null : null,
    owner: require('./ownership').uidOf(), rev: (prev ? (Number(prev.rev) || 0) : 0) + 1, kind: SHAPE.BLANK_KIND, format: '9:16', tracks,
  };
  MSTORE.write({ ...s, version: (Number(s.version) || 0) + 1, updatedAt: now });
}

/** The timeline taken away (a fragment deleted for good) - its file and what was heard in it with it (lib/merge-store.js). */
function dropTimeline(key) {
  const s = MSTORE.read();
  if (!s.timelines[key]) return false;
  delete s.timelines[key];
  MSTORE.write({ ...s, version: (Number(s.version) || 0) + 1, updatedAt: new Date().toISOString() });
  return true;
}

module.exports = { MARGIN, cutPiece, thumb9x16, styleOf, capOf, restyle, addTitle, layOut, writeTimeline, dropTimeline };
