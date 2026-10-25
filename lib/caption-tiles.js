'use strict';

/* ═══════════════════════════════════════════════════════════════════════════
   CAPTION TILES - a 2.5 s loop of every caption preset, for the Library panel's "captions" view
   (phase K6a, 2026-10-03).

   A tile is a REAL caption lane: the preset's style (normalizeStyle, marked with its id), the words "This
   is how it looks" with made-up timings cut into pages by pages.js, the .ass built by ass.js and burnt by
   OUR ffmpeg with the shipped fonts - the same three steps a render takes, so what the gallery shows is
   what the render draws, by construction. Animated WebP: it plays in an <img> and costs nothing out of
   view, where 127 looping <video>s took 1.5 GB of GPU memory.

   A tile is a SQUARE of near-black with the words in its middle, whatever position the preset sets (phase
   S1, the owner 2026-10-05: the mannequin took room, and the presets differ by font and motion, not by
   where they sit). The .ass is laid out in a 720x720 frame and drawn into 192x192 - twice the 96px cell.
   At 720 the median preset's text is half the tile wide (at 1080 a third; at 640 a third of the presets
   break into two lines); the pages are still cut as for 9:16, as a real video's are, so the few that break
   into two lines in the square show honestly how they wrap. Near-black, not black: five presets draw a
   black box and two a navy one, which vanish on #000.

   The tiles live in <library>/cache/captions/<version>/<id>.webp (served under /cache): `version` is a
   hash of everything a tile is made of - the caption modules, the font files, this file's spec - so a
   change to any of them makes a new set and the old one is removed at the next make. A tile is written
   as <id>.tmp.webp and renamed, so a half-written one is never served.

   The queue: two ffmpeg at once (all 127 in ~15 s on the owner's laptop), each at a lower priority and
   each waiting while a render encodes (render-busy) - a render somebody is waiting for comes first. A
   font that is not drawn as asked is said in the log (font-check). Nothing here is paid for.

   THE PERSON'S OWN PRESETS (phase V30, block 5; lib/caption-presets-store.js) are tiles of the same set, `<id>.webp` in
   the same folder - their look never changes once saved (the owner's (с45)), so a tile is made once; renamed, it stays.
   A new one goes to the head of the queue (`mineChanged`), a deleted one's file goes with it, and a file of one that is
   no longer there is swept at the next make. They are not part of the version: the 131 are not made again for them.

   THE STILL (phase V32, the owner 2026-10-20: the gallery loaded every loop at once, and slowly): beside each loop the same
   ffmpeg writes ONE frame of it, <id>.first.webp - the frame at 0.3 s (the owner's (г1)): by then the first page has arrived
   whatever its entrance (the longest takes 0.18 s) and its first word is lit, where frame 0 is empty for a fade and lights no
   word. The gallery shows the stills and asks for a loop only under the cursor (captions-view.js). One run, two outputs: the
   still costs nothing (a tile ~100 ms either way). A tile is ready when BOTH files are there; one left alone by a make the
   app did not finish is made again.

   THE TEXT PRESETS (phase V42, captions/presets-text.js, and the person's own saved from text, `kind: 'text'`) are tiles of
   the same set: a TEXT lane holding one line - the preset's own words (`sample`) - from 0.12 s to 2.78 s of a 3 s loop, so
   the tile shows its entrance, the line standing and its exit (text-fx.js), exactly as the mockup the owner approved; the
   still is the frame at 1.45 s, when every entrance has arrived. Same frame (720), size and quality.

   THE ANIMATIONS (phase V49, point 8b; captions/page-fx.js PAIRS - the "animation" tab's In -> Out pairs, the owner's (пр19))
   are tiles of the same set too, `an-<in>--<out>`: a subtitle lane of three pages in plain white letters, the spoken word lit
   (so a tile shows the page moving while its words light as they do), each page coming in and going out within the 2.5 s; the
   still is the frame in the middle of the first page's In - each tile's still shows its own motion.
   ═══════════════════════════════════════════════════════════════════════════ */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const { CACHE_DIR, TEMP_DIR, PUBLIC_DIR, CAPTION_FONTS_DIR } = require('./config');
const CAP = require('./mv3b-subs');
const BUSY = require('./render-busy');
const FONTS = require('./font-check');
const { PRESETS } = require('../public/js/captions/presets.js');
const { TEXT_PRESETS } = require('../public/js/captions/presets-text.js');
const { PAIRS, animTileId } = require('../public/js/captions/page-fx.js');
const { autoSize } = require('../public/js/captions/style.js');
const MINE = require('./caption-presets-store');

// What a tile is - every number here is part of the version.
const TILE = {
  v: 3,
  // English, per the owner; stored in sentence case - the preset's casing is applied when drawn.
  // (phase V18.4, the owner 2026-10-08) The words fill the WHOLE loop, one after another with no pause, and the last
  // is spoken up to its very end: they used to end at 1.9 s of 2.5, and the tile stood still and unlit until the loop
  // began again - over a second for pop and bounce, whose last move was over at 1.4 s.
  words: [['This', 0.00, 0.50], ['is', 0.50, 0.90], ['how', 0.90, 1.42], ['it', 1.42, 1.86], ['looks', 1.86, 2.50]],
  loop: 2.5, fps: 30, frame: 720, side: 192, quality: 75,
  ground: '0x16181d',
  first: 0.3,                        // the still's moment, s (phase V32)
};
// A text preset's tile (phase V42): the line's moments in the loop, the still's moment, and what the person's own say.
const TEXT_TILE = { v: 1, loop: 3.0, start: 0.12, end: 2.78, first: 1.45, sample: 'Your title here' };
// An animation's tile (phase V49): its look, its two pages (words timed from each page's start) and the still's moment.
const ANIM_TILE = {
  v: 2, loop: 2.5, first: 0.2,
  style: { font: 'Montserrat Black', size: 116, bold: true, primary: '#ffffff', highlight: '#ffe14d', outline: 5, outlineColor: '#000000',
    shadow: 0, effect: 'color', pos: 'center', tx: 0, ty: 0, wordsPerLine: 3, lines: 1, sizeAuto: false },
  pages: [{ start: 0.08, dur: 0.76, words: [['This', 0, 0.36], ['is', 0.36, 0.66]] },
    { start: 0.9, dur: 0.76, words: [['how', 0, 0.36], ['it', 0.36, 0.66]] },
    { start: 1.72, dur: 0.74, words: [['looks', 0, 0.6]] }],
};
const ANIM_CAT = 'anim';
const FIRST = '.first.webp';         // the still's file: <id>.first.webp beside <id>.webp
const AT_ONCE = 2;
const TILE_MS = 30000;               // one tile's ffmpeg, before it is given up
const DIR = path.join(CACHE_DIR, 'captions');
const MODULES = ['presets.js', 'presets-classic.js', 'presets-text.js', 'style.js', 'ass.js', 'text-fx.js', 'page-fx.js', 'place.js', 'pages.js', 'words.js', 'measure.js', 'advances.js', 'fonts.js'];

let _ver = null;
function version() {
  if (_ver) return _ver;
  const h = crypto.createHash('sha256');
  for (const f of MODULES) h.update(f + '\0').update(fs.readFileSync(path.join(PUBLIC_DIR, 'js', 'captions', f)));
  let fonts = [];
  try { fonts = fs.readdirSync(CAPTION_FONTS_DIR).filter((f) => /\.ttf$/i.test(f)).sort(); } catch (e) { /* none */ }
  for (const f of fonts) h.update(f + ':' + fs.statSync(path.join(CAPTION_FONTS_DIR, f)).size + '\0');
  h.update(JSON.stringify(TILE)).update(JSON.stringify(TEXT_TILE)).update(JSON.stringify(ANIM_TILE)).update(JSON.stringify(PAIRS));
  _ver = h.digest('hex').slice(0, 12);
  return _ver;
}

const _dir = () => path.join(DIR, version());

// Every preset a tile is made for: the app's caption presets, its text presets (V42), the animations (V49), then the person's
// own (category 'mine', a text one with the words every such tile says).
const MINE_CAT = 'mine';
const ANIMS = PAIRS.map((p) => ({ id: animTileId(p.id), name: p.name, category: ANIM_CAT, kind: 'anim', pair: p.id }));
function _all() {
  let mine = [];
  try { mine = MINE.list(); } catch (e) { /* an unreadable store: the app's alone */ }
  return PRESETS.concat(TEXT_PRESETS, ANIMS, mine.map((p) => (p.kind === 'text'
    ? { id: p.id, name: p.name, category: MINE_CAT, kind: 'text', sample: TEXT_TILE.sample, style: p.style }
    : { id: p.id, name: p.name, category: MINE_CAT, style: p.style })));
}
const _isMine = (id) => /^my-/.test(String(id));
// A file of the version's folder: whose tile it is, and whether it is a half-written one (<id>[.first].tmp.webp).
const _fileOf = (f) => { const m = /^(.+?)(\.first)?(\.tmp)?\.webp$/.exec(f); return m ? { id: m[1], tmp: !!m[3] } : null; };

// The tile's lane: a preset as a project would wear it, in the middle of the frame, and the words cut the
// way its lane would be.
function laneOf(p) {
  // An animation (V49): its two pages in the tile's own look, wearing the pair.
  if (p.kind === 'anim') {
    const [enter, leave] = String(p.pair).split('|');
    const style = CAP.normalizeStyle(Object.assign({}, ANIM_TILE.style, { enter, leave }));
    const clips = ANIM_TILE.pages.map((pg, i) => ({ id: 'a' + i, start: pg.start, dur: pg.dur, name: pg.words.map((w) => w[0]).join(' '),
      words: pg.words.map(([w, s, e]) => ({ w, s, e })) }));
    return { kind: 'subs', style, clips };
  }
  const style = CAP.normalizeStyle(Object.assign({}, p.style, { preset: p.id, pos: 'center', tx: 0, ty: 0 }));
  // A text preset: its own words on a text lane, in from the loop's start and out before its end (V42).
  if (p.kind === 'text') {
    if (style.sizeAuto !== false) { style.size = autoSize('9:16'); style.sizeAuto = false; }
    const name = String(p.sample || TEXT_TILE.sample);
    return { kind: 'text', style, clips: [{ name, start: TEXT_TILE.start, dur: Math.round((TEXT_TILE.end - TEXT_TILE.start) * 100) / 100 }] };
  }
  // A size still the format's (a preset of the person's saved from such a lane) is drawn as a 9:16 frame's, the
  // frame every preset's size is written for.
  if (style.sizeAuto !== false) { style.size = autoSize('9:16'); style.sizeAuto = false; }
  const words = TILE.words.map(([text, start, end]) => ({ text, start, end }));
  const pages = CAP.PAGES.paginate(words, { lane: style, format: '9:16' });
  if (pages.length) {                                   // the last page stays up to the loop's end
    const last = pages[pages.length - 1];
    last.dur = Math.max(last.dur, Math.round((TILE.loop - last.start) * 100) / 100);
  }
  return { kind: 'subs', style, clips: pages };
}

// ── The state ───────────────────────────────────────────────────────────────
const S = { ver: null, ready: new Set(), failed: new Map(), queue: [], doing: new Set(), making: false, running: 0, started: 0, took: null, error: null };

function _scan() {
  const v = version();
  if (S.ver === v) return;
  S.ver = v;
  S.ready = new Set();
  S.failed = new Map();
  let have = [];
  try { have = fs.readdirSync(_dir()); } catch (e) { /* not made yet */ }
  // A tile is its loop AND its still (phase V32); an empty file is one that was never written out - made again. A preset of
  // the person's deleted meanwhile is not among them, and its files are swept at the next make.
  const files = new Set(have);
  const full = (f) => { try { return files.has(f) && fs.statSync(path.join(_dir(), f)).size > 0; } catch (e) { return false; } };
  for (const p of _all()) if (full(p.id + '.webp') && full(p.id + FIRST)) S.ready.add(p.id);
}

/** Where the tiles are, and how far the making is. Reads the disk once per version; no side effects. */
function state() {
  _scan();
  const ids = new Set(_all().map((p) => p.id));
  return {
    ver: S.ver, base: '/cache/captions/' + S.ver + '/', still: FIRST, loop: TILE.loop, textLoop: TEXT_TILE.loop, animLoop: ANIM_TILE.loop, total: ids.size,
    ready: [...S.ready].filter((id) => ids.has(id)), failed: [...S.failed.keys()].filter((id) => ids.has(id)),
    making: S.making, waiting: S.making && BUSY.busy(), took: S.took, error: S.error,
  };
}

// ── Making them ─────────────────────────────────────────────────────────────
function _run(args, ms) {
  return new Promise((resolve) => {
    let err = '';
    const fc = FONTS.watcher();
    const p = spawn(ffmpegPath, ['-hide_banner', '-nostdin', '-y'].concat(args), { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    try { os.setPriority(p.pid, 10); } catch (e) { /* not allowed: as it is */ }
    const t = setTimeout(() => { try { p.kill(); } catch (e) { /* gone */ } }, ms || TILE_MS);
    p.stderr.on('data', (d) => { err = (err + d).slice(-4000); fc.feed(d); });
    p.on('close', (code) => { clearTimeout(t); resolve({ code, err, warnings: fc.warnings() }); });
    p.on('error', (e) => { clearTimeout(t); resolve({ code: -1, err: e.message, warnings: [] }); });
  });
}

// Every old version, the leftovers of a make the app did not finish, and the tiles of the person's presets that are gone.
function _sweep() {
  const live = new Set(_all().map((p) => p.id));
  let dirs = [];
  try { dirs = fs.readdirSync(DIR); } catch (e) { return; }
  for (const d of dirs) {
    const abs = path.join(DIR, d);
    if (d !== S.ver) { try { fs.rmSync(abs, { recursive: true, force: true }); } catch (e) { /* in use: next time */ } continue; }
    let files = [];
    try { files = fs.readdirSync(abs); } catch (e) { continue; }
    for (const f of files) {
      const m = _fileOf(f);
      const gone = m && _isMine(m.id) && !live.has(m.id);
      if ((m && m.tmp) || gone) { try { fs.unlinkSync(path.join(abs, f)); } catch (e) { /* next time */ } }
      if (gone) S.ready.delete(m.id);
    }
  }
}

async function _one(id) {
  const p = _all().find((x) => x.id === id);
  if (!p) return;
  const dir = _dir();
  const stamp = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const assFile = path.join(TEMP_DIR, 'tile_' + stamp + '.ass');
  const tmp = path.join(dir, id + '.tmp.webp');
  const tmpFirst = path.join(dir, id + '.first.tmp.webp');
  try {
    fs.writeFileSync(assFile, CAP.buildAss([laneOf(p)], TILE.frame, TILE.frame));
    const text = p.kind === 'text', anim = p.kind === 'anim';
    const loop = text ? TEXT_TILE.loop : anim ? ANIM_TILE.loop : TILE.loop, first = text ? TEXT_TILE.first : anim ? ANIM_TILE.first : TILE.first;
    const input = ['-f', 'lavfi', '-i', 'color=c=' + TILE.ground + ':s=' + TILE.side + 'x' + TILE.side + ':r=' + TILE.fps + ':d=' + loop];
    const vf = 'ass=filename=' + CAP.escapeFilterPath(assFile) + ':fontsdir=' + CAP.escapeFilterPath(CAPTION_FONTS_DIR);
    // The loop and its still from one drawing (phase V32), by the same encoder at the same quality: the loop that starts
    // under the cursor does not jump.
    const q = String(TILE.quality);
    const graph = '[0:v]' + vf + ",split[a][b];[b]select='eq(n," + Math.round(first * TILE.fps) + ")'[f]";
    const r = await _run(input.concat(['-filter_complex', graph,
      '-map', '[a]', '-an', '-c:v', 'libwebp_anim', '-lossless', '0', '-quality', q, '-loop', '0', tmp,
      '-map', '[f]', '-frames:v', '1', '-an', '-c:v', 'libwebp', '-lossless', '0', '-quality', q, tmpFirst]));
    if (r.warnings.length) console.warn('[tiles] ' + id + ': ' + r.warnings.join('; '));
    if (r.code !== 0 || !fs.existsSync(tmp) || !fs.existsSync(tmpFirst)) throw new Error(r.err.trim().split('\n').pop() || 'ffmpeg failed');
    // The still first: a tile is ready with both, and one cut between the two renames is made again (_scan).
    fs.renameSync(tmpFirst, path.join(dir, id + FIRST));
    fs.renameSync(tmp, path.join(dir, id + '.webp'));
    S.ready.add(id);
    S.failed.delete(id);
  } catch (e) {
    S.failed.set(id, e.message);
    console.warn('[tiles] ' + id + ' failed: ' + e.message);
    for (const f of [tmp, tmpFirst]) { try { fs.unlinkSync(f); } catch (e2) { /* never written */ } }
  } finally {
    try { fs.unlinkSync(assFile); } catch (e) { /* gone */ }
  }
}

async function _worker() {
  S.running++;
  try {
    for (;;) {
      // A render somebody is waiting for comes first.
      while (BUSY.busy()) await new Promise((r) => setTimeout(r, 2000));
      const id = S.queue.shift();
      if (!id) return;
      if (S.ready.has(id)) continue;
      S.doing.add(id);
      try { await _one(id); } finally { S.doing.delete(id); }
    }
  } finally {
    S.running--;
    if (!S.running) {
      S.making = false;
      S.took = Math.round((Date.now() - S.started) / 100) / 10;
      console.log('[tiles] ' + S.ready.size + '/' + _all().length + ' ready (' + S.took + ' s'
        + (S.failed.size ? ', ' + S.failed.size + ' failed' : '') + ')');
    }
  }
}

/**
 * Make what is missing. `first` - a category whose tiles go to the head of the queue (the one the
 * person is looking at). Pressed again while making, it only reorders. Answers the state.
 */
function make(first) {
  // The disk is the truth, read again at every make while nothing is being made: cache/ is what is made
  // again when missing, and a folder cleared while the app runs left the tiles 404 until a restart (review K6).
  if (!S.making) S.ver = null;
  _scan();
  const all = _all();
  const cat = new Map(all.map((p) => [p.id, p.category]));
  const order = (ids) => (first ? ids.filter((id) => cat.get(id) === first).concat(ids.filter((id) => cat.get(id) !== first)) : ids);
  const missing = all.map((p) => p.id).filter((id) => !S.ready.has(id));
  // While making, the queue is what is missing, not being made now and not failed in this make - a preset of the person's
  // saved meanwhile joins it.
  if (S.making) { S.queue = order(missing.filter((id) => !S.doing.has(id) && !S.failed.has(id))); return state(); }
  if (!missing.length) return state();
  S.making = true;
  S.error = null;
  S.started = Date.now();
  S.queue = order(missing);
  (async () => {
    try {
      fs.mkdirSync(TEMP_DIR, { recursive: true });
      fs.mkdirSync(_dir(), { recursive: true });
      _sweep();
      for (let i = 0; i < AT_ONCE; i++) _worker();
    } catch (e) {
      S.making = false;
      S.error = e.message;           // said on the page; the next make tries again
      console.warn('[tiles] could not start: ' + e.message);
    }
  })();
  return state();
}

/**
 * The person's presets changed (lib/caption-presets-store.js): the tile of one deleted goes now, a new one is made first.
 * Answers the state.
 */
function mineChanged() {
  const live = new Set(_all().map((p) => p.id));
  for (const id of [...S.ready, ...S.failed.keys()]) {
    if (!_isMine(id) || live.has(id)) continue;
    S.ready.delete(id);
    S.failed.delete(id);
    for (const f of [id + '.webp', id + FIRST]) { try { fs.unlinkSync(path.join(_dir(), f)); } catch (e) { /* never made, or swept already */ } }
  }
  S.queue = S.queue.filter((id) => live.has(id));
  return make(MINE_CAT);
}

module.exports = { state, make, mineChanged, version, laneOf, TILE, TEXT_TILE, ANIM_TILE, MINE_CAT, ANIM_CAT, _state: S };
