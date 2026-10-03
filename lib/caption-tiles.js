'use strict';

/* ═══════════════════════════════════════════════════════════════════════════
   CAPTION TILES - a 2.5 s loop of every caption preset, for the Library panel's "captions" view
   (phase K6a, 2026-10-03).

   A tile is a REAL caption lane: the preset's style (normalizeStyle, marked with its id), the words "This
   is how it looks" with made-up timings cut into pages by pages.js, the .ass built by ass.js and burnt by
   OUR ffmpeg with the shipped fonts - the same three steps a render takes, so what the gallery shows is
   what the render draws, by construction. 432x768 (twice the widest cell), animated WebP: it plays in an
   <img> and costs nothing out of view, where 127 looping <video>s took 1.5 GB of GPU memory.

   The tiles live in <library>/cache/captions/<version>/<id>.webp (served under /cache): `version` is a
   hash of everything a tile is made of - the caption modules, the font files, this file's spec - so a
   change to any of them makes a new set and the old one is removed at the next make. A tile is written
   as <id>.tmp.webp and renamed, so a half-written one is never served.

   The queue: two ffmpeg at once (all 127 in ~15 s on the owner's laptop), each at a lower priority and
   each waiting while a render encodes (render-busy) - a render somebody is waiting for comes first. A
   font that is not drawn as asked is said in the log (font-check). Nothing here is paid for.
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

// What a tile is - every number here is part of the version.
const TILE = {
  v: 1,
  // English, per the owner; stored in sentence case - the preset's casing is applied when drawn.
  words: [['This', 0.12, 0.40], ['is', 0.42, 0.60], ['how', 0.66, 0.98], ['it', 1.00, 1.16], ['looks', 1.22, 1.90]],
  loop: 2.5, fps: 30, w: 432, h: 768, quality: 75,
  // A dark grey mannequin behind the words: a box in black at 0.85 still shows on it.
  bg: 'poses/scen3/half-standing_cf11f848c251cdaefc266711321645e1_1786265530392.jpg',
  bgFilter: 'hue=s=0,eq=brightness=-0.18:contrast=0.55:gamma=0.9,gblur=sigma=1.5,vignette=PI/4',
  flat: '0x16181d',
};
const AT_ONCE = 2;
const TILE_MS = 30000;               // one tile's ffmpeg, before it is given up
const DIR = path.join(CACHE_DIR, 'captions');
const MODULES = ['presets.js', 'style.js', 'ass.js', 'pages.js', 'words.js', 'measure.js', 'advances.js', 'fonts.js'];

let _ver = null;
function version() {
  if (_ver) return _ver;
  const h = crypto.createHash('sha256');
  for (const f of MODULES) h.update(f + '\0').update(fs.readFileSync(path.join(PUBLIC_DIR, 'js', 'captions', f)));
  let fonts = [];
  try { fonts = fs.readdirSync(CAPTION_FONTS_DIR).filter((f) => /\.ttf$/i.test(f)).sort(); } catch (e) { /* none */ }
  for (const f of fonts) h.update(f + ':' + fs.statSync(path.join(CAPTION_FONTS_DIR, f)).size + '\0');
  let bgSize = 0;
  try { bgSize = fs.statSync(path.join(PUBLIC_DIR, TILE.bg)).size; } catch (e) { /* the flat colour then */ }
  h.update(JSON.stringify(TILE) + '\0' + bgSize);
  _ver = h.digest('hex').slice(0, 12);
  return _ver;
}

const _dir = () => path.join(DIR, version());

// The tile's lane: a preset as a project would wear it, and the words cut the way its lane would be.
function laneOf(p) {
  const style = CAP.normalizeStyle(Object.assign({}, p.style, { preset: p.id }));
  const words = TILE.words.map(([text, start, end]) => ({ text, start, end }));
  const pages = CAP.PAGES.paginate(words, { lane: style, format: '9:16' });
  if (pages.length) {                                   // the last page stays up to the loop's end
    const last = pages[pages.length - 1];
    last.dur = Math.max(last.dur, Math.round((TILE.loop - last.start) * 100) / 100);
  }
  return { kind: 'subs', style, clips: pages };
}

// ── The state ───────────────────────────────────────────────────────────────
const S = { ver: null, ready: new Set(), failed: new Map(), queue: [], making: false, running: 0, started: 0, took: null, error: null };

function _scan() {
  const v = version();
  if (S.ver === v) return;
  S.ver = v;
  S.ready = new Set();
  S.failed = new Map();
  let have = [];
  try { have = fs.readdirSync(_dir()); } catch (e) { /* not made yet */ }
  const ids = new Set(PRESETS.map((p) => p.id));
  for (const f of have) {
    const m = /^(.+)\.webp$/.exec(f);
    if (!m || /\.tmp$/.test(m[1]) || !ids.has(m[1])) continue;
    // An empty file is a tile that was never written out: made again.
    try { if (fs.statSync(path.join(_dir(), f)).size > 0) S.ready.add(m[1]); } catch (e) { /* gone meanwhile */ }
  }
}

/** Where the tiles are, and how far the making is. Reads the disk once per version; no side effects. */
function state() {
  _scan();
  return {
    ver: S.ver, base: '/cache/captions/' + S.ver + '/', total: PRESETS.length,
    ready: [...S.ready], failed: [...S.failed.keys()],
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

// Every old version, and the leftovers of a make the app did not finish.
function _sweep() {
  let dirs = [];
  try { dirs = fs.readdirSync(DIR); } catch (e) { return; }
  for (const d of dirs) {
    const abs = path.join(DIR, d);
    if (d !== S.ver) { try { fs.rmSync(abs, { recursive: true, force: true }); } catch (e) { /* in use: next time */ } continue; }
    let files = [];
    try { files = fs.readdirSync(abs); } catch (e) { continue; }
    for (const f of files) if (/\.tmp\.webp$/.test(f)) { try { fs.unlinkSync(path.join(abs, f)); } catch (e) { /* next time */ } }
  }
}

// The background, made once per version from the shipped mannequin. Read through Node and written to
// scratch first: in a built app the picture is inside the asar archive, which ffmpeg cannot open.
async function _background() {
  const out = path.join(_dir(), 'bg.jpg');
  if (fs.existsSync(out)) return out;
  const src = path.join(PUBLIC_DIR, TILE.bg);
  if (!fs.existsSync(src)) return null;
  fs.mkdirSync(TEMP_DIR, { recursive: true });
  const tmpIn = path.join(TEMP_DIR, 'tile-bg-src' + path.extname(src));
  const tmpOut = path.join(_dir(), 'bg.tmp.jpg');
  try {
    fs.writeFileSync(tmpIn, fs.readFileSync(src));
    const r = await _run(['-i', tmpIn, '-vf', 'scale=' + TILE.w + ':' + TILE.h + ':force_original_aspect_ratio=increase,crop='
      + TILE.w + ':' + TILE.h + ',' + TILE.bgFilter, '-frames:v', '1', '-q:v', '3', tmpOut]);
    if (r.code !== 0 || !fs.existsSync(tmpOut)) return null;
    fs.renameSync(tmpOut, out);
    return out;
  } finally {
    try { fs.unlinkSync(tmpIn); } catch (e) { /* gone */ }
  }
}

async function _one(id, bg) {
  const p = PRESETS.find((x) => x.id === id);
  if (!p) return;
  const dir = _dir();
  const stamp = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const assFile = path.join(TEMP_DIR, 'tile_' + stamp + '.ass');
  const tmp = path.join(dir, id + '.tmp.webp');
  try {
    fs.writeFileSync(assFile, CAP.buildAss([laneOf(p)], 1080, 1920));
    const input = bg ? ['-loop', '1', '-framerate', String(TILE.fps), '-t', String(TILE.loop), '-i', bg]
      : ['-f', 'lavfi', '-i', 'color=c=' + TILE.flat + ':s=' + TILE.w + 'x' + TILE.h + ':r=' + TILE.fps + ':d=' + TILE.loop];
    const vf = 'ass=filename=' + CAP.escapeFilterPath(assFile) + ':fontsdir=' + CAP.escapeFilterPath(CAPTION_FONTS_DIR);
    const r = await _run(input.concat(['-vf', vf, '-an', '-c:v', 'libwebp_anim', '-lossless', '0', '-quality', String(TILE.quality),
      '-loop', '0', tmp]));
    if (r.warnings.length) console.warn('[tiles] ' + id + ': ' + r.warnings.join('; '));
    if (r.code !== 0 || !fs.existsSync(tmp)) throw new Error(r.err.trim().split('\n').pop() || 'ffmpeg failed');
    fs.renameSync(tmp, path.join(dir, id + '.webp'));
    S.ready.add(id);
    S.failed.delete(id);
  } catch (e) {
    S.failed.set(id, e.message);
    console.warn('[tiles] ' + id + ' failed: ' + e.message);
    try { fs.unlinkSync(tmp); } catch (e2) { /* never written */ }
  } finally {
    try { fs.unlinkSync(assFile); } catch (e) { /* gone */ }
  }
}

async function _worker(bg) {
  S.running++;
  try {
    for (;;) {
      // A render somebody is waiting for comes first.
      while (BUSY.busy()) await new Promise((r) => setTimeout(r, 2000));
      const id = S.queue.shift();
      if (!id) return;
      if (S.ready.has(id)) continue;
      await _one(id, bg);
    }
  } finally {
    S.running--;
    if (!S.running) {
      S.making = false;
      S.took = Math.round((Date.now() - S.started) / 100) / 10;
      console.log('[tiles] ' + S.ready.size + '/' + PRESETS.length + ' ready (' + S.took + ' s'
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
  const order = (ids) => (first ? ids.filter((id) => (PRESETS.find((p) => p.id === id) || {}).category === first)
    .concat(ids.filter((id) => (PRESETS.find((p) => p.id === id) || {}).category !== first)) : ids);
  if (S.making) { S.queue = order(S.queue); return state(); }
  const missing = PRESETS.map((p) => p.id).filter((id) => !S.ready.has(id));
  if (!missing.length) return state();
  S.making = true;
  S.error = null;
  S.started = Date.now();
  S.queue = order(missing);
  (async () => {
    try {
      fs.mkdirSync(_dir(), { recursive: true });
      _sweep();
      const bg = await _background();
      for (let i = 0; i < AT_ONCE; i++) _worker(bg);
    } catch (e) {
      S.making = false;
      S.error = e.message;           // said on the page; the next make tries again
      console.warn('[tiles] could not start: ' + e.message);
    }
  })();
  return state();
}

module.exports = { state, make, version, laneOf, TILE, _state: S };
