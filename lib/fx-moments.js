'use strict';

/* fx-moments.js - OTHER MOMENTS OF A CLIP (phase V84 block 2, the owner 2026-11-11 "делаем остальные блоки одним походом").
   Some effects show frames of their clip's file from other moments than the one playing: Grid dive's wall of tiles (each another
   moment), PiP delay's window (the same film half a second late), Color swing's echo (a frame from a moment around). The page
   draws them - the preview live and the app's bake window for the render, by one code - from the SAME pictures made here: the
   file's frames over the asked stretches, 30 a second, `w` pixels wide, as JPEGs in cache/fx-moments/<print>/ (what is made again
   when missing), frame k of stretch i at its `from` + k / 30 s.

     make(src, ranges, w) -> Promise<{ key, url, ranges: [{ from, n }] }>
       src     the clip's file (a library address)
       ranges  [[from, to], ...] the file's seconds
       w       the width of a frame

   Only reads the file; nothing outside cache/ is written. */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const { CACHE_DIR } = require('./config');
const MEDIA = require('./media');

const DIR = path.join(CACHE_DIR, 'fx-moments');
const FPS = 30;
const MAX_FRAMES = 2400;           // 80 s of frames in one ask - more is not an effect's
const _busy = new Map();           // key -> Promise

function _print(abs) {
  try { const st = fs.statSync(abs); return [path.resolve(abs).toLowerCase(), st.size, Math.floor(st.mtimeMs)]; } catch (e) { return null; }
}

function _run(args) {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    let err = '';
    p.stderr.on('data', (d) => { err = (err + d.toString()).slice(-1500); });
    p.on('close', (code) => (code ? reject(new Error('ffmpeg: ' + err.slice(-300))) : resolve()));
    p.on('error', reject);
  });
}

async function make(src, ranges, w) {
  const abs = MEDIA.toDisk(String(src || '').split('?')[0]);
  const fp = abs && _print(abs);
  if (!fp) throw new Error('not a file of the library');
  const W = Math.max(32, Math.min(1080, Math.round(+w || 360) & ~1));
  const rs = (Array.isArray(ranges) ? ranges : []).map((r) => [Math.max(0, +r[0] || 0), Math.max(0, +r[1] || 0)])
    .filter((r) => r[1] > r[0]).map((r) => [Math.round(r[0] * 1000) / 1000, Math.round(r[1] * 1000) / 1000]);
  if (!rs.length) throw new Error('no stretch asked');
  if (rs.reduce((s, r) => s + (r[1] - r[0]) * FPS, 0) > MAX_FRAMES) throw new Error('too many frames asked');
  const key = crypto.createHash('sha1').update(JSON.stringify({ fp, rs, W })).digest('hex').slice(0, 24);
  const dir = path.join(DIR, key);
  const out = { key, url: '/cache/fx-moments/' + key + '/', ranges: [] };
  const doneMark = path.join(dir, 'done.json');
  if (fs.existsSync(doneMark)) {
    try { const kept = JSON.parse(fs.readFileSync(doneMark, 'utf8')); const now = new Date(); fs.utimesSync(doneMark, now, now); return kept; }
    catch (e) { /* made again */ }
  }
  if (_busy.has(key)) return _busy.get(key);
  const job = (async () => {
    fs.mkdirSync(dir, { recursive: true });
    for (let i = 0; i < rs.length; i++) {
      const [a, b] = rs[i];
      await _run(['-hide_banner', '-v', 'error', '-y', '-ss', a.toFixed(3), '-i', abs, '-t', (b - a + 0.05).toFixed(3),
        '-vf', `fps=${FPS},scale=${W}:-2:flags=bicubic`, '-an', '-q:v', '4', '-start_number', '0', path.join(dir, `${i}_%d.jpg`)]);
      let n = 0;
      while (fs.existsSync(path.join(dir, `${i}_${n}.jpg`))) n++;
      out.ranges.push({ from: a, n });
    }
    fs.writeFileSync(doneMark, JSON.stringify(out));
    return out;
  })();
  _busy.set(key, job);
  try { return await job; } finally { _busy.delete(key); }
}

/** At the start: the pictures nobody asked for in two weeks go (they are made again when asked). */
function sweep(days = 14) {
  let names = [];
  try { names = fs.readdirSync(DIR); } catch (e) { return 0; }
  const old = Date.now() - days * 86400000;
  let gone = 0;
  for (const n of names) {
    const d = path.join(DIR, n);
    try {
      const st = fs.statSync(path.join(d, 'done.json'));
      if (st.mtimeMs < old) { fs.rmSync(d, { recursive: true, force: true }); gone++; }
    } catch (e) { try { fs.rmSync(d, { recursive: true, force: true }); gone++; } catch (x) { /* in use */ } }
  }
  if (gone) console.log(`[fx-moments] ${gone} old sets of pictures went`);
  return gone;
}

module.exports = { make, sweep, DIR, FPS };
