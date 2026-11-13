'use strict';

/* highlights-cut.js - a highlights fragment made.

   A moment the agent found is 1 to 3 PIECES of the video. Each piece is cut into a file of its own, re-encoded so it
   starts and ends exactly where its sentences do, with THREE SECONDS MORE on either side (not seen: the clip on
   the timeline is trimmed to the piece, and can be drawn out a little), into the project's clips/ folder. The fragment's
   first frame - the frame its first piece opens on, cut to 9:16 - is the tile's picture.

   Its TIMELINE (hl_<id>_<n>, in the project's folder) is a 9:16 project like any other: the pieces one after another on
   the main video lane - the picture filling the frame, its window following the faces (`frame`, worked out
   by public/js/framing/path.js from what lib/faces.js counted; the middle when the faces could not be counted) - and their sound
   under them, joined by a plain cut; and a subtitle lane made of the words the video was heard as - no second hearing,
   nothing paid - each piece's words moved to where the piece lies, cut into pages by the captions' own rules, in the
   style chosen in the popup; a page on a frame split into two bands for more than half its time in the middle
   (public/js/captions/split.js). After that it is the person's: trimmed, captioned, given music, rendered. */

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
// The patterns of main video (public/js/overlay/pattern.js).
const PAT = require('../public/js/overlay/pattern.js');
// Main video's colour and frame, main audio's pitch - for several fragments at once.
const COLOR = require('../public/js/overlay/color.js');
// The clip effects' own normalising - one rule for the page and here.
const FXP = require('../public/js/fx/params.js');
const PITCH = require('../public/js/sound/pitch.js');

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
async function cutPiece(srcAbs, outAbs, from, to, total, { onFrac, signal, audio = null } = {}) {
  // The sound track chosen in the popup - its place among the file's audio streams; none: the first.
  const aMap = '0:a:' + (Number.isInteger(audio) && audio >= 0 ? audio : 0) + '?';
  const before = Math.min(MARGIN, Math.max(0, from));
  const after = Math.min(MARGIN, Math.max(0, (total > 0 ? total : to + MARGIN) - to));
  const start = from - before;
  const len = (to - from) + before + after;
  fs.mkdirSync(path.dirname(outAbs), { recursive: true });
  const rand = crypto.randomBytes(3).toString('hex');
  const tmp = outAbs + '.' + rand + '.part.mp4';
  // THE PREVIEW'S COPY IN THE SAME PASS - a second output of the one decode, written in scratch and
  // put where the preview looks for it once the piece has its name (the copy is keyed by the file's path and time). The
  // fragment is ready with it, so pressing its tile shows the picture at once.
  fs.mkdirSync(PP.CACHE_DIR, { recursive: true });
  const ptmp = path.join(PP.CACHE_DIR, path.basename(outAbs, '.mp4') + '.' + rand + '.part.mp4');
  try {
    await _ffmpeg(['-hide_banner', '-nostdin', '-v', 'error', '-progress', 'pipe:1', '-nostats',
      '-ss', start.toFixed(3), '-i', srcAbs,
      '-t', len.toFixed(3), '-map', '0:v:0', '-map', aMap, '-sn', '-dn',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-y', tmp,
      '-t', len.toFixed(3), '-map', '0:v:0', '-map', aMap, '-sn', '-dn', ...PP.encodeArgs(PP.DEFAULT_H, false), '-y', ptmp],
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
 * follows its faces (`frame` - the whole frame over its blur on a shot with none), from its middle otherwise.
 */
async function thumb9x16(clipAbs, outAbs, at, frame) {
  fs.mkdirSync(path.dirname(outAbs), { recursive: true });
  let vf = 'crop=min(iw\\,ih*9/16):ih,scale=' + THUMB_W + ':-2';
  if (FRAMING.isFramed(frame) && frame.src && frame.src.w > 0) {
    const win = FRAMING.windowAt(frame, at, frame.src.w, frame.src.h, 9 / 16);
    const th = Math.round(THUMB_W * 16 / 9 / 2) * 2;
    if (win.kind === 'face') vf = `crop=w='trunc(ih*9/16/2)*2':h=ih:x='clip(${r3(win.x)}*iw-ow/2,0,iw-ow)':y=0,scale=${THUMB_W}:${th}`;
    else if (win.kind === 'whole') {
      // The middle `w` of the width - a documentary's 3:2 - as the preview and the render show it.
      const cut = win.w > 0 && win.w < 0.999 ? `crop=w='trunc(iw*${r3(win.w)}/2)*2':h=ih:x='(iw-ow)/2':y=0,` : '';
      vf = `split[a][b];[a]scale=${THUMB_W / 4}:${th / 4}:force_original_aspect_ratio=increase,crop=${THUMB_W / 4}:${th / 4},boxblur=10:2,` +
        `scale=${THUMB_W}:${th}[bg];[b]${cut}scale=${THUMB_W}:-2[fg];[bg][fg]overlay=0:(H-h)/2`;
    } else if (win.kind === 'cam') {
      // camera + game: the camera's window on top, a third, the game's below - as the preview and the render cut them.
      const top = Math.round(th / 3 / 2) * 2;
      vf = `split[a][b];[a]crop=w='trunc(iw*${r3(win.cw)}/2)*2':h='trunc(ih*${r3(win.ch)}/2)*2':x='clip(${r3(win.cx)}*iw-ow/2,0,iw-ow)':y='clip(${r3(win.cy)}*ih-oh/2,0,ih-oh)',` +
        `scale=${THUMB_W}:${top}[t];[b]crop=w='trunc(iw*${r3(win.gw)}/2)*2':h=ih:x='(iw-ow)/2':y=0,scale=${THUMB_W}:${th - top}[d];[t][d]vstack=2`;
    }
  }
  await _ffmpeg(['-hide_banner', '-nostdin', '-v', 'error', '-ss', Math.max(0, at).toFixed(3), '-i', clipAbs, '-frames:v', '1',
    '-vf', vf, '-q:v', '3', '-y', outAbs]);
}

// ── The caption style chosen in the popup ──────────────────────────────────
// The app's caption preset, worn as a base the way the captions view puts one on (public/js/captions/preset-use.js): its
// whole style, marked with its id. An id that is no preset of the app's is the plain style.
function _preset(presetId) {
  const id = String(presetId || '');
  if (!id) return null;
  const { PRESETS } = require('../public/js/captions/presets.js');
  return PRESETS.find((x) => x.id === id) || null;
}
// What of a subtitle style is its In and Out, not its look (public/js/captions/preset-use.js MOTION_KEYS).
const MOTION = ['enter', 'enterDur', 'leave', 'leaveDur'];
function styleOf(presetId) {
  const p = _preset(presetId);
  return CAP.normalizeStyle(p ? { ...p.style, preset: p.id } : {});
}

/**
 * A subtitle lane's style from what the popup or the captions of several chose: `spec` - a
 * preset's id, or { preset, mix: [ids], anims: ['in|out'] }. Several presets: the first's style with every one's look as the lane's
 * mix; one animation: every page's In and Out; several: dealt. A mix or animations dealt get a seed of their own - each fragment
 * its own deal of the same set (public/js/captions/mix.js). `fonts` - the families of the fonts tab: one, every page's;
 * several, dealt; each page keeps the width it has in the preset's font (public/js/captions/place.js).
 */
function laneStyleOf(spec) {
  const s = spec && typeof spec === 'object' ? spec : { preset: spec };
  const ids = (Array.isArray(s.mix) ? s.mix : []).map(String).filter((id) => _preset(id));
  const st = styleOf(ids[0] || s.preset);
  const { LOOK_KEYS, pairOf } = require('../public/js/captions/style.js');
  if (ids.length >= 2) {
    st.mix = ids.map((id) => {
      const one = styleOf(id);
      const o = { preset: one.preset };
      for (const k of LOOK_KEYS) o[k] = one[k];
      return o;
    });
  }
  const anims = (CAP.normalizeStyle({ anims: Array.isArray(s.anims) ? s.anims : [] }).anims || []);
  if (anims.length >= 2) st.anims = anims;
  else if (anims.length === 1) Object.assign(st, pairOf(anims[0]));
  const fonts = CAP.normalizeStyle({ fonts: Array.isArray(s.fonts) ? s.fonts : [] }).fonts || [];
  if (fonts.length) st.fonts = fonts;
  if (st.mix || st.anims || fonts.length >= 2) st.mixSeed = CAP.MIX.newSeed();
  // A highlights fragment's subtitles are cut in PAGES whatever the preset says (Classic's own cut is
  // by sentences): a short is read page by page.
  st.cut = 'pages';
  // A NEW fragment's subtitles are in two rows (public/js/captions/place.js rowsPlan). restyle
  // takes it away again: a lane keeps its own.
  st.rows = 2;
  return CAP.normalizeStyle(st);
}

/**
 * The caption style a fragment wears, as its card says it: { preset, name, edited } - read from its timeline's
 * subtitle lane, the one place the style lives. `edited` when the lane was changed by hand since the preset was put on it
 * (public/js/captions/preset-use.js editedKeys, the same comparison).
 */
function capOf(tl) {
  const lane = ((tl && tl.tracks) || []).find((t) => t && t.kind === 'subs');
  const st = CAP.normalizeStyle((lane && lane.style) || {});
  const p = st.preset ? _preset(st.preset) : null;
  const titled = !!TITLE.titleLaneOf(tl);
  // Several presets on the lane: their names.
  const mixed = Array.isArray(st.mix) && st.mix.length >= 2 ? st.mix.map((e) => (_preset(e.preset) || {}).name).filter(Boolean) : null;
  if (mixed) return { preset: st.preset || '', name: 'mix: ' + mixed.join(', '), edited: false, titled, mix: st.mix.map((e) => e.preset) };
  if (!p) return { preset: '', name: '', edited: false, titled };
  const base = CAP.normalizeStyle({ ...p.style, preset: p.id });
  const { DEF, PLACE_KEYS } = require('../public/js/captions/style.js');
  // An In or an Out chosen is not an edit of the preset (preset-use.js editedKeys) - nor a place held.
  const keep = MOTION.concat(st.hold ? PLACE_KEYS : []);
  const edited = Object.keys(DEF).some((k) => k !== 'preset' && !keep.includes(k) && JSON.stringify(st[k]) !== JSON.stringify(base[k]));
  return { preset: p.id, name: p.name, edited, titled };
}

/**
 * What the common settings of several fragments show of each: its subtitle lane's place, size and page shape, how many
 * of its pages stand in a place of their own (dragged by hand, the split frame's middle, the camera's seam), and its
 * lanes of sound - the speech's ("main audio") and the music's (the lane the app laid its bed on, else "audio 2"): their volumes.
 */
function lanesOf(tl) {
  const tracks = (tl && tl.tracks) || [];
  const lane = tracks.find((t) => t && t.kind === 'subs');
  const st = CAP.normalizeStyle((lane && lane.style) || {});
  const own = ((lane && lane.clips) || []).filter((c) => c && c.style && ['pos', 'tx', 'ty'].some((k) => c.style[k] != null)).length;
  const a1 = tracks.find((t) => t && t.id === 'a1');
  const ml = musicLaneOf(tl);
  return {
    subs: { pos: st.pos, ty: st.ty, size: st.size, sizeAuto: st.sizeAuto !== false, wordsPerLine: st.wordsPerLine, lines: st.lines,
      hold: !!st.hold, own, pages: ((lane && lane.clips) || []).length, rows: +st.rows === 2 ? 2 : 1 },
    // Its pitch - each one met on its clips once.
    speech: { volume: a1 && a1.volume != null ? +a1.volume : 1, pitches: _uniq(((a1 && a1.clips) || []).filter((c) => c && c.src).map((c) => PITCH.pitchOf(c))) },
    music: ml ? { lane: ml.id, volume: ml.volume != null ? +ml.volume : 1, beds: (ml.clips || []).filter(_isBed).length } : null,
    // Main video's patterns, top layer first.
    patterns: PAT.normalizeLayers((PAT.mainLane(tl) || {}).patterns),
    // Main video: the frames its clips follow, whether one was changed for several (`was` - it can go back to the
    // kind's), their colours each met once, how many punch in and how many of those have it switched off.
    video: videoOf(tl),
  };
}
const _uniq = (list) => { const seen = new Set(), out = []; for (const v of list) { const k = JSON.stringify(v); if (!seen.has(k)) { seen.add(k); out.push(v); } } return out; };
const _mainClips = (tl) => ((PAT.mainLane(tl) || {}).clips || []).filter((c) => c && c.src);
/** The way a clip is framed: 'active' (the kind's speaker / most active), its record's mode, or 'fixed'. */
const frameMode = (c) => (c && c.frame ? (c.frame.active ? 'active' : c.frame.mode || 'fixed') : 'fixed');
function videoOf(tl) {
  const cs = _mainClips(tl);
  const z = cs.filter((c) => c.frame && Array.isArray(c.frame.zooms) && c.frame.zooms.length);
  return { modes: _uniq(cs.map(frameMode)), was: cs.some((c) => c.frameWas), colors: _uniq(cs.map((c) => COLOR.colorOf(c))),
    zooms: z.length, zoomOff: z.filter((c) => c.frame.noZoom).length,
    // the kinds of clip effects on it, each once
    fx: _uniq(cs.flatMap((c) => (Array.isArray(c.fx) ? c.fx : []).map((e) => e && e.k).filter(Boolean))) };
}

/**
 * Clip effects put on several fragments' main video: `byKey` { <timeline key>: { <clip id>: [effects] } }
 * - made by the page (js/merge-v3/fx-ui.js laneEffects, the faces found there) and added to those clips, kept in the effects' own
 * rule (fx/params.js normalizeFx); or every effect of kind `remove` taken off the main video of `keys`. One pass of the store.
 */
function fxAdd(byKey) {
  const keys = Object.keys(byKey || {});
  const done = MSTORE.updateMany(keys, (tl, key) => {
    const lane = PAT.mainLane(tl);
    const want = byKey[key] || {};
    let any = false;
    for (const c of ((lane && lane.clips) || [])) {
      const add = c && Array.isArray(want[c.id]) ? want[c.id] : null;
      if (!add || !add.length) continue;
      const next = FXP.normalizeFx([...(Array.isArray(c.fx) ? c.fx : []), ...add]);
      if (next && next.length) { c.fx = next; any = true; }
    }
    return any;
  });
  return { keys: done };
}
function fxRemove(keys, k) {
  const done = MSTORE.updateMany(keys, (tl) => {
    const lane = PAT.mainLane(tl);
    let any = false;
    for (const c of ((lane && lane.clips) || [])) {
      if (!c || !Array.isArray(c.fx) || !c.fx.some((e) => e && e.k === k)) continue;
      const left = c.fx.filter((e) => e && e.k !== k);
      if (left.length) c.fx = left; else delete c.fx;
      any = true;
    }
    return any;
  });
  return { keys: done };
}

// The clips of music the app laid (layOut, setMusic): their ids - `hm…`. Whatever the person put on that lane is theirs.
const _isBed = (c) => !!(c && /^hm/.test(String(c.id || '')));
/** The lane a fragment's music lies on: the one holding the app's bed, else its "audio 2"; null for none. */
function musicLaneOf(tl) {
  const auds = ((tl && tl.tracks) || []).filter((t) => t && t.kind === 'audio' && t.id !== 'a1');
  return auds.find((t) => (t.clips || []).some(_isBed)) || auds.find((t) => t.id === 'a2') || null;
}

/**
 * The place, the size and the page shape put on several fragments' subtitles
 * at once - their lanes as they are, their looks kept: `patch` { place: { pos, ty } | null, size: n | 'auto', wordsPerLine: 0-12,
 * lines: 1-3, rows: 1 | 2 }. A place given is HELD over presets (style.js `hold`); a size, words or lines cut the heard pages again (pages.js
 * recutClips - the typed and corrected lines stay); pages with a place of their own are not moved; the split frame's rule looks
 * at the pages as they are now. Each timeline in one tick. Returns the keys changed.
 */
function relayout(keys, patch) {
  const p = patch || {};
  const set = {};
  if (p.place && typeof p.place === 'object') {
    Object.assign(set, CAP.normalizeStyle({ pos: p.place.pos, ty: p.place.ty }));
    for (const k of Object.keys(set)) if (k !== 'pos' && k !== 'ty') delete set[k];
    set.hold = true;
  }
  if (p.size === 'auto') set.sizeAuto = true;
  else if (p.size != null && Number.isFinite(+p.size)) { set.size = CAP.normalizeStyle({ size: +p.size }).size; set.sizeAuto = false; }
  if (p.wordsPerLine != null && Number.isFinite(+p.wordsPerLine)) set.wordsPerLine = CAP.normalizeStyle({ wordsPerLine: +p.wordsPerLine }).wordsPerLine;
  if (p.lines != null && Number.isFinite(+p.lines)) set.lines = CAP.normalizeStyle({ lines: +p.lines }).lines;
  // Two rows on, or one - no field at all.
  let oneRow = false;
  if (p.rows != null) { if (+p.rows === 2) set.rows = 2; else oneRow = true; }
  if (!Object.keys(set).length && !oneRow) throw Object.assign(new Error('nothing to change'), { status: 400 });
  const cut = ['size', 'sizeAuto', 'wordsPerLine', 'lines'].some((k) => k in set);
  const makeId = () => 'h' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const done = [];
  // All of them in one pass of the store (lib/merge-store.js updateMany), not one pass each.
  done.push(...MSTORE.updateMany(keys, (tl) => {
    const lane = (tl.tracks || []).find((x) => x && x.kind === 'subs');
    if (!lane) return false;
    lane.style = CAP.normalizeStyle(Object.assign({}, lane.style || {}, set));
    if (oneRow) delete lane.style.rows;
    if (cut) { const clips = CAP.PAGES.recutClips(lane, tl, makeId); if (clips) lane.clips = clips; }
    SPLIT.placeBySplit(tl);
    return true;
  }));
  return { keys: done };
}

/** A lane's volume on several fragments: `which` 'speech' (main audio) or 'music'. Returns the keys changed. */
function laneVolume(keys, which, volume) {
  const v = Math.max(0, Math.min(SHAPE.VOL_MAX, +volume));
  if (!Number.isFinite(v)) throw Object.assign(new Error('no volume'), { status: 400 });
  const done = [];
  // All of them in one pass of the store (lib/merge-store.js updateMany), not one pass each.
  done.push(...MSTORE.updateMany(keys, (tl) => {
    const lane = which === 'music' ? musicLaneOf(tl) : (tl.tracks || []).find((x) => x && x.id === 'a1');
    if (!lane) return false;
    lane.volume = Math.round(v * 10000) / 10000;
    return true;
  }));
  return { keys: done };
}

/**
 * Main video's patterns put on several fragments at once - the whole list, top layer first
 * (public/js/overlay/pattern.js normalizeLayers; [] - none). Each timeline in one tick. Returns the keys changed.
 */
function setPatterns(keys, list) {
  const next = PAT.normalizeLayers(list);
  const done = [];
  // All of them in one pass of the store (lib/merge-store.js updateMany), not one pass each.
  done.push(...MSTORE.updateMany(keys, (tl) => {
    const lane = PAT.mainLane(tl);
    if (!lane) return false;
    if (next.length) lane.patterns = next; else delete lane.patterns;
    return true;
  }));
  return { keys: done };
}

/**
 * Main video's look put on several fragments, into every clip of it: `color` { key, value } - one of
 * the correction's values (public/js/overlay/color.js), the others each clip's own; `zoom` true / false - the punch-ins on or off
 * where a clip has them. Each timeline in one tick. Returns the keys changed.
 */
function videoLook(keys, { color, zoom } = {}) {
  const ck = color && COLOR.COLOR_KEYS.includes(color.key) && Number.isFinite(+color.value) ? color : null;
  if (!ck && typeof zoom !== 'boolean') throw Object.assign(new Error('nothing to change'), { status: 400 });
  const done = [];
  // All of them in one pass of the store (lib/merge-store.js updateMany), not one pass each.
  done.push(...MSTORE.updateMany(keys, (tl) => {
    const cs = _mainClips(tl);
    if (!cs.length) return false;
    for (const c of cs) {
      if (ck) { const v = COLOR.normalizeColor({ ...COLOR.colorOf(c), [ck.key]: +ck.value }); if (v) c.color = v; else delete c.color; }
      if (typeof zoom === 'boolean' && c.frame && Array.isArray(c.frame.zooms) && c.frame.zooms.length) {
        if (zoom) delete c.frame.noZoom; else c.frame.noZoom = true;
      }
    }
    return true;
  }));
  return { keys: done };
}

// THE FRAME OF SEVERAL: every clip of main video framed one way - the choices of the inspector's Framing row
// (js/merge-v3/framing-ui.js, the same arithmetic: public/js/framing/path.js plan over the faces counted, lib/faces.js, kept since
// the cut) - or 'kind', the frame the app gave it by its kind (the speaker, the most active, a lecture's shots). The app's frame
// is kept on the clip the first time it is changed this way (`frameWas`) and put back by 'kind'.
const REFRAMES = ['kind', 'fixed', 'face', 'center', 'whole', 'bands', 'cam'];
const _aspect = (tl) => { const f = String((tl && tl.format) || '9:16').split(':'); return (+f[0] > 0 && +f[1] > 0) ? (+f[0] / +f[1]) : 9 / 16; };
async function _frameFor(c, mode, aspect) {
  if (mode === 'kind') return c.frameWas ? { frame: FRAMING.normalize(c.frameWas.frame) || null, frameWas: null } : null;
  const was = c.frameWas || { frame: c.frame || null };
  const shift = c.frame ? (+c.frame.shift || 0) : 0;
  if (mode === 'fixed') return { frame: null, frameWas: was };
  const abs = require('./media').toDiskExisting(c.src);
  if (!abs) throw new Error('its file is not there');
  if (mode === 'center' || mode === 'whole') {
    const p = await PROBE.probe(abs);
    if (!(p.w > 0)) throw new Error('the film could not be read');
    const side = p.rotate === 90 || p.rotate === 270;
    return { frame: FRAMING.normalize({ v: 1, mode, shift, src: { w: side ? p.h : p.w, h: side ? p.w : p.h }, shots: [], ...(mode === 'whole' ? { wide: FRAMING.SQUARE } : {}) }), frameWas: was };
  }
  const faces = await require('./faces').find(abs);
  return { frame: FRAMING.normalize(FRAMING.plan(faces, { aspect, mode, shift, wide: FRAMING.SQUARE })), frameWas: was };
}
/** A clip's frame and its kept frame as `ch` says - null takes the field off. */
function applyFrame(c, ch) {
  if (ch.frame) c.frame = ch.frame; else delete c.frame;
  if (ch.frameWas) c.frameWas = { frame: FRAMING.normalize(ch.frameWas.frame) || null }; else delete c.frameWas;
}
/**
 * Every fragment's main video framed `mode`: the frames planned first (sizes, faces - the slow part), then each timeline written in
 * one tick, its subtitles placed for the split frame. The OPEN one (`openKey`) is not written - its changes come back for the
 * page to lay (one undo step). -> { keys, open: { clipId: { frame, frameWas } }, missed, why }
 */
async function reframe(keys, mode, { openKey } = {}) {
  if (!REFRAMES.includes(mode)) throw Object.assign(new Error('no such framing'), { status: 400 });
  let open = null, missed = 0, why = '';
  // Read at once, planned one by one (the slow part, awaited), then written in one pass of the store.
  const tls = MSTORE.many(keys);
  const planned = new Map();
  for (const key of keys) {
    const tl = tls.get(String(key));
    if (!tl) continue;
    const changes = {};
    try {
      for (const c of _mainClips(tl)) { const ch = await _frameFor(c, mode, _aspect(tl)); if (ch) changes[c.id] = ch; }
    } catch (e) {
      missed++;
      if (!why) why = e.noWorker ? 'faces are found in the app window' : String(e.message || e).slice(0, 160);
      continue;
    }
    if (key === openKey) { open = changes; continue; }
    planned.set(String(key), changes);
  }
  const done = planned.size ? MSTORE.updateMany([...planned.keys()], (x, key) => {
    const changes = planned.get(key);
    for (const c of _mainClips(x)) if (changes[c.id]) applyFrame(c, changes[c.id]);
    SPLIT.placeBySplit(x);
    return true;
  }) : [];
  return { keys: done, open, missed, why };
}

/**
 * Main audio's pitch on several fragments, into every clip of it: `patch` { st?, shift? } - what
 * is given replaces that part of each clip's pitch (public/js/sound/pitch.js), the rest stays each clip's. Returns the keys changed.
 */
function lanePitch(keys, patch) {
  const p = patch || {};
  const st = p.st != null && Number.isFinite(+p.st) ? Math.round(+p.st) : null;
  const shift = typeof p.shift === 'boolean' ? p.shift : null;
  if (st == null && shift == null) throw Object.assign(new Error('nothing to change'), { status: 400 });
  const done = [];
  // All of them in one pass of the store (lib/merge-store.js updateMany), not one pass each.
  done.push(...MSTORE.updateMany(keys, (tl) => {
    const lane = (tl.tracks || []).find((x) => x && x.id === 'a1');
    if (!lane) return false;
    for (const c of (lane.clips || [])) {
      if (!c || !c.src) continue;
      const was = PITCH.pitchOf(c);
      const v = PITCH.normalizePitch({ st: st == null ? was.st : st, shift: shift == null ? was.shift : shift });
      if (v) c.pitch = v; else delete c.pitch;
    }
    return true;
  }));
  return { keys: done };
}

/**
 * The title on top put on (`texts` Map key -> its text) or taken off (`texts` null) several fragments in one pass
 * of the store - as addTitle / dropTitle do one. Returns the keys changed.
 */
function titles(keys, texts) {
  const makeId = () => 'ht' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  return MSTORE.updateMany(keys, (tl, key) => {
    if (!texts) return TITLE.dropTitle(tl) ? true : false;
    const text = texts.get(key);
    if (!text) return false;
    return TITLE.putTitle(tl, text, _filmEnd(tl), makeId) ? true : false;
  });
}

/** The length of a fragment's film - where its main video ends. */
const _filmEnd = (tl) => ((tl.tracks || []).find((t) => t && t.id === 'v1') || { clips: [] }).clips.reduce((m, c) => Math.max(m, (+c.start || 0) + (+c.dur || 0)), 0);

/**
 * The music of a made fragment replaced: the clips of the app's bed (`hm…`) taken off whatever
 * lane holds them, and `clips` (lib/highlights-music.js clipsFor; [] - no music) laid on that lane - else on its "audio 2", made when
 * it has none (timeline-shape.js musicLane). What the person put there by hand stays. One tick. Returns whether it was written.
 */
function setMusic(key, clips) {
  return setMusics(new Map([[String(key), clips]])).length > 0;
}
/** The same for several fragments in one pass of the store - `byKey` Map key -> clips. Returns the keys changed. */
function setMusics(byKey) {
  const stamp = Date.now().toString(36);
  return MSTORE.updateMany([...byKey.keys()], (tl, key) => {
    const clips = byKey.get(key);
    const held = musicLaneOf(tl);
    const had = held && (held.clips || []).some(_isBed);
    for (const t of (tl.tracks || [])) if (t && t.kind === 'audio') t.clips = (t.clips || []).filter((c) => !_isBed(c));
    if (!clips || !clips.length) return !!had;
    const end = _filmEnd(tl);
    const lane = held || SHAPE.musicLane(tl.tracks);
    if (!lane) return !!had;
    clips.forEach((c, k) => {
      if (!c || !(c.start < end - 0.05)) return;
      lane.clips.push({ ...c, id: 'hm' + stamp + '_' + k, dur: r2(Math.min(c.dur, end - c.start)) });
    });
    return true;
  });
}

/** The music clips cut to a timeline's film, laid as the page lays them on the open fragment - ids made the same way. */
function bedClips(clips, end) {
  const stamp = Date.now().toString(36);
  return (clips || []).filter((c) => c && c.start < end - 0.05).map((c, k) => ({ ...c, id: 'hm' + stamp + '_' + k, dur: r2(Math.min(c.dur, end - c.start)) }));
}

/** The title put on a made fragment's timeline (its card's "add title") - false when there is no room for it. */
function addTitle(key, text) {
  let ok = false;
  MSTORE.update(key, (tl) => {
    const secs = ((tl.tracks || []).find((t) => t && t.id === 'v1') || { clips: [] }).clips.reduce((m, c) => Math.max(m, (+c.start || 0) + (+c.dur || 0)), 0);
    ok = TITLE.putTitle(tl, text, secs, () => 'ht' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7));
    return ok;
  });
  return ok;
}

/** The title on top taken off a made fragment's timeline (its card's ✕) - false when it has none. */
function dropTitle(key) {
  let ok = false;
  MSTORE.update(key, (tl) => { ok = TITLE.dropTitle(tl); return ok; });
  return ok;
}

/**
 * The fragment's timeline record: `pieces` - [{ src, thumb, name, start, end (video seconds), before, seconds (file), frame }],
 * `words`/`segments` the video's as heard (video seconds), `presetId` the style (or { preset, mix, anims } - laneStyleOf),
 * `o.title` the title on top ('' for none),
 * `o.music` the background music's clips for "audio 2" (lib/highlights-music.js clipsFor), [] for none.
 * Returns { tracks, seconds }.
 */
function layOut(pieces, words, segments, presetId, o) {
  const tracks = SHAPE.emptyBlank().tracks;
  const v1 = tracks.find((t) => t.id === 'v1');
  const a1 = tracks.find((t) => t.id === 'a1');
  const subs = tracks.find((t) => t.kind === 'subs');
  const stamp = Date.now().toString(36);
  let at = 0;
  const tlWords = [];
  const tlSegs = [];
  const joins = [];
  pieces.forEach((p, k) => {
    // A lecture's piece with its pauses shortened (`cuts`, { a, b } in the video's seconds - lib/highlights-pauses.js
    // cutsIn): laid as the stretches between them, one after another - pieces of one file, as Merge's button S leaves them (the render
    // reads them as one input - lib/mv3b-render.js pieceRun), their sound faded 15 ms at each seam; its words moved with them.
    const cuts = Array.isArray(p.cuts) ? p.cuts.filter((c) => c && c.a > p.start && c.b < p.end && c.b > c.a) : [];
    const PC = cuts.length ? require('../public/js/sound/pause-cuts.js') : null;
    const M = (t) => (PC ? PC.mapThrough(cuts, t) - PC.mapThrough(cuts, p.start) : t - p.start);
    const parts = [];
    let from = p.start;
    for (const c of cuts) { parts.push([from, c.a]); from = c.b; }
    parts.push([from, p.end]);
    const at0 = at;
    parts.forEach(([a, b], j) => {
      const d = r2(b - a);
      const tag = k + (parts.length > 1 ? '_' + j : '');
      const trimIn = r2(p.before + (a - p.start));
      const half = {
        name: p.name, libId: null, start: r2(at), dur: d, srcDur: r2(p.seconds), trimIn,
        trimOut: r2(Math.max(0, p.seconds - trimIn - d)), speed: 1, reversed: false,
        pairId: 'ph' + stamp + '_' + tag, fit: 'fill', cropAlign: 'center',
      };
      v1.clips.push({ ...half, id: 'hv' + stamp + '_' + tag, src: p.src, thumb: p.thumb || null, volume: 0,
        ...(FRAMING.isFramed(p.frame) ? { frame: p.frame } : {}) });
      a1.clips.push({ ...half, id: 'ha' + stamp + '_' + tag, src: p.src, thumb: null, volume: 1, fit: null, cropAlign: null,
        ...(j > 0 ? { fadeIn: PC.SEAM_FADE } : {}), ...(j < parts.length - 1 ? { fadeOut: PC.SEAM_FADE } : {}) });
      at = r2(at + d);
    });
    const dur = r2(at - at0);
    if (k > 0) joins.push(r2(at0));
    // The piece's words, where the piece now lies.
    for (const w of words) {
      const mid = (w.start + w.end) / 2;
      if (mid < p.start || mid >= p.end) continue;
      tlWords.push({ text: w.text, start: at0 + Math.max(0, M(w.start)), end: at0 + Math.min(dur, M(w.end)) });
    }
    for (const g of (segments || [])) {
      if (g.end <= p.start || g.start >= p.end) continue;
      tlSegs.push({ ...g, start: at0 + Math.max(0, M(g.start)), end: at0 + Math.min(dur, M(g.end)) });
    }
  });
  subs.style = laneStyleOf(presetId);
  // Whisper's own doubts (noise, a loop of a phrase) are left out, as when a lane is heard (public/js/captions/heard.js).
  const clean = CAP.HEARD.cleanWords(tlWords.sort((x, y) => x.start - y.start), tlSegs, { gaps: [], typed: [], fixed: [] });
  const pages = CAP.PAGES.paginate(clean.words, { lane: subs.style, format: '9:16', joins });
  subs.clips = pages.map((p, i) => ({
    id: 'h' + stamp + i.toString(36) + Math.random().toString(36).slice(2, 5), src: null, thumb: null,
    name: p.name, start: p.start, dur: Math.max(0.1, p.dur), words: p.words,
    srcDur: 0, trimIn: 0, trimOut: 0, speed: 1, reversed: false, volume: null, pairId: null,
    ...(p.style ? { style: p.style } : {}), ...(p.tx != null ? { tx: p.tx } : {}), ...(p.ty != null ? { ty: p.ty } : {}),
  }));
  // Several presets or animations: dealt page by page.
  if (CAP.MIX.needsDeal(subs)) CAP.MIX.deal(subs.clips, subs.style);
  // A page on a frame split into two bands for more than half its time goes to the middle -
  // on the seam, not over the lower face (public/js/captions/split.js).
  SPLIT.placeBySplit({ format: '9:16', tracks });
  // The title on top for its first three seconds (public/js/captions/title.js).
  if (o && o.title) TITLE.putTitle({ tracks }, o.title, at, () => 'ht' + stamp + Math.random().toString(36).slice(2, 7));
  // The background music on "audio 2" - a bed under the voice (lib/highlights-music.js clipsFor), cut to
  // the fragment's own length.
  // A new timeline has no "audio 2": it is made here, and only when there is music to lay.
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
 * A preset put on the captions of several fragments at once - what a press on a tile does
 * to one lane on the page (timeline-b.js setSubsStyle, public/js/captions/preset-use.js presetStyle): the subtitle lane's
 * whole style replaced by the preset's, marked with its id, and its HEARD lines cut again by the captions' own rule
 * (pages.js recutClips) - the typed and corrected ones stay the very same lines, as does a line's own look. Each timeline in
 * one tick. Returns the keys changed; a preset that is no caption preset of the app's is refused.
 */
function restyle(keys, presetId, more) {
  const p = _preset(presetId);
  if (!p) throw Object.assign(new Error('no such caption style - it may have been deleted'), { status: 400 });
  // Several presets (`more.mix`, ids) - every fragment the same set, dealt; animations (`more.anims`) - one, or dealt.
  const m = more || {};
  const mix = (Array.isArray(m.mix) ? m.mix : []).map(String).filter((id) => _preset(id));
  const withAnims = Array.isArray(m.anims);
  // The lane's In and Out stay as they are: a preset is a look - unless animations are given.
  const style = mix.length >= 2 || withAnims ? laneStyleOf({ preset: p.id, mix, anims: m.anims }) : styleOf(p.id);
  delete style.hold;
  // Two rows are the lane's: a preset leaves them as they are.
  delete style.rows;
  // Highlights' subtitles are cut in pages, whatever the preset's own cut (laneStyleOf does the same).
  style.cut = 'pages';
  if (!withAnims) { for (const k of MOTION) delete style[k]; delete style.anims; }
  // One preset again, or the mix asked: the lane's old mix goes.
  if (mix.length < 2) style.mix = [];
  if (!withAnims && mix.length >= 2) style.mixSeed = CAP.MIX.newSeed();
  // Animations given as none: the lane's dealt ones go too.
  if (withAnims && !style.anims) style.anims = [];
  const makeId = () => 'h' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const done = [];
  // All of them in one pass of the store (lib/merge-store.js updateMany), not one pass each.
  done.push(...MSTORE.updateMany(keys, (tl) => {
    const lane = (tl.tracks || []).find((x) => x && x.kind === 'subs');
    if (!lane) return false;
    // A place set for several at once stays over the preset; the size, words and lines are the preset's.
    const held = lane.style && lane.style.hold ? { pos: lane.style.pos, tx: lane.style.tx, ty: lane.style.ty, hold: true } : null;
    lane.style = Object.assign({}, lane.style || {}, style, held || {});
    // A fresh deal for each fragment: its own seed.
    if (style.mixSeed) lane.style.mixSeed = CAP.MIX.newSeed();
    const clips = CAP.PAGES.recutClips(lane, tl, makeId);
    if (clips) lane.clips = clips;
    // The pages cut again carry their words' places: the split frame's rule looks at them as they are now.
    SPLIT.placeBySplit(tl);
    return true;
  }));
  return { keys: done, name: mix.length >= 2 ? mix.length + ' presets' : p.name, preset: p.id };
}

/**
 * The animations put on several fragments at once, their looks left as they are: one pair - every
 * page's In and Out; several - dealt, each fragment its own deal (public/js/captions/mix.js); the lanes are NOT cut again. Each
 * timeline in one tick. Returns the keys changed.
 */
function reanimate(keys, anims) {
  const { pairOf } = require('../public/js/captions/style.js');
  const list = CAP.normalizeStyle({ anims: Array.isArray(anims) ? anims : [] }).anims || [];
  const done = [];
  // All of them in one pass of the store (lib/merge-store.js updateMany), not one pass each.
  done.push(...MSTORE.updateMany(keys, (tl) => {
    const lane = (tl.tracks || []).find((x) => x && x.kind === 'subs');
    if (!lane) return false;
    const st = Object.assign({}, lane.style || {});
    if (list.length >= 2) { st.anims = list; st.mixSeed = CAP.MIX.newSeed(); } else Object.assign(st, pairOf(list[0] || 'at-once|none'), { anims: [] });
    lane.style = st;
    CAP.MIX.deal(lane.clips || [], lane.style);
    return true;
  }));
  return { keys: done, name: list.length > 1 ? list.length + ' animations' : (list[0] || 'none') };
}

/** The timeline written (made, or replaced when it is there): the record's fields as POST /mv3/timeline/new makes them. */
function writeTimeline(key, title, tracks) {
  const s = MSTORE.read();
  const now = new Date().toISOString();
  const prev = s.timelines[key];
  s.timelines[key] = {
    title, createdAt: prev ? prev.createdAt : now, updatedAt: now, adv: prev ? prev.adv || null : null,
    rev: (prev ? (Number(prev.rev) || 0) : 0) + 1, kind: SHAPE.BLANK_KIND, format: '9:16', tracks,
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

/**
 * The fonts put on several fragments at once, their looks left as they are: one family - every
 * page's; several - dealt anew (their presets and animations as dealt); none - the presets' own fonts again. The lanes are NOT
 * cut again (a page keeps its preset's width, public/js/captions/place.js). Each timeline in one tick. Returns the keys changed.
 */
function refont(keys, fonts) {
  const list = CAP.normalizeStyle({ fonts: Array.isArray(fonts) ? fonts : [] }).fonts || [];
  const done = [];
  // All of them in one pass of the store (lib/merge-store.js updateMany), not one pass each.
  done.push(...MSTORE.updateMany(keys, (tl) => {
    const lane = (tl.tracks || []).find((x) => x && x.kind === 'subs');
    if (!lane) return false;
    const st = Object.assign({}, lane.style || {});
    if (list.length) st.fonts = list; else delete st.fonts;
    if (list.length >= 2 && !Number.isInteger(st.mixSeed)) st.mixSeed = CAP.MIX.newSeed();
    lane.style = st;
    CAP.MIX.redealFonts(lane.clips || [], lane.style);
    return true;
  }));
  return { keys: done };
}

module.exports = { MARGIN, cutPiece, thumb9x16, styleOf, laneStyleOf, capOf, lanesOf, musicLaneOf, restyle, relayout, reanimate, refont,
  laneVolume, setPatterns, titles, setMusics, videoLook, fxAdd, fxRemove, reframe, applyFrame, frameMode, videoOf, lanePitch, setMusic, bedClips, filmEnd: _filmEnd, addTitle, dropTitle, layOut, writeTimeline, dropTimeline };
