'use strict';

/* fx-tiles.js - the effects panel's tiles (phase V84, the owner 2026-11-10, (эф13)-(эф15); docs/local-app/plan/ "Подфаза 3 — V84",
   "Правка 2"): for every effect of public/js/fx/effects.js and every set, a short WebM (VP9, square, no sound) that plays while the
   pointer is on its tile and a WebP of its peak, into public/fx-tiles/<key>.webm|.webp (a set's key 'set-<id>'), with index.json
   saying what they were made from.

   A tile is what Export gives: the app's own render (lib/mv3b-job.js prepare, lib/fx-render.js) on the owner's example clip - a
   clip of the project named in tools/fx-tiles.json (its face path found once by the app's faces window, written there) - the
   9:16 frame cut to a square on the face's height. A moment of its own length plays from a short lead to a short tail; one that
   goes on plays `loop` seconds.

   Run it by hand when an effect is added or changed - the example clip is read, never written:
       node tools/fx-tiles.js --src "<library>/projects/<project>/<clip>"     makes every tile
       node tools/fx-tiles.js --check                                         says whether every effect and set has its tile, made
                                                                              by the effects as they are now */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'public', 'fx-tiles');
const CFG = JSON.parse(fs.readFileSync(path.join(__dirname, 'fx-tiles.json'), 'utf8'));

// What the tiles are made by: the effects' rule and the render's chain - a change to any of them is a tile to make again.
const RULE = ['public/js/fx/effects.js', 'public/js/fx/params.js', 'public/js/fx/tables.js', 'lib/fx-render.js', 'lib/fx-assets.js'];
function rulePrint() {
  const h = crypto.createHash('sha1');
  for (const f of RULE) h.update(fs.readFileSync(path.join(ROOT, f)));
  h.update(JSON.stringify(CFG));
  return h.digest('hex').slice(0, 16);
}

async function main() {
  const FX = await import('../public/js/fx/effects.js');
  const keys = [...Object.keys(FX.EFFECTS), ...Object.keys(FX.SETS).map((id) => 'set-' + id)];
  if (process.argv.includes('--check')) {
    let idx = null;
    try { idx = JSON.parse(fs.readFileSync(path.join(OUT, 'index.json'), 'utf8')); } catch (e) { idx = null; }
    const missing = keys.filter((k) => !fs.existsSync(path.join(OUT, k + '.webm')) || !fs.existsSync(path.join(OUT, k + '.webp')));
    const stale = !idx || idx.print !== rulePrint();
    console.log(missing.length ? 'missing: ' + missing.join(', ') : 'every effect and set has its tile');
    console.log(stale ? 'made by other effects than these - make them again' : 'made by the effects as they are now');
    process.exit(missing.length || stale ? 1 : 0);
  }
  const at = process.argv.indexOf('--src');
  const src = at > 0 ? process.argv[at + 1] : '';
  if (!src || !fs.existsSync(src)) { console.error('--src <the example clip> is needed (tools/fx-tiles.json says which)'); process.exit(2); }

  // A library of its own in the temp folder: the clip copied in, the render's scratch there. Set before the app's modules load.
  const lib = fs.mkdtempSync(path.join(os.tmpdir(), 'ugc-fx-tiles-'));
  process.env.UGC_DATA_DIR = lib;
  fs.mkdirSync(path.join(lib, 'media', 'work'), { recursive: true });
  fs.copyFileSync(src, path.join(lib, 'media', 'work', 'example.mp4'));
  const FFMPEG = require('ffmpeg-static');
  const JOB = require('../lib/mv3b-job');
  const P = await import('../public/js/fx/params.js');
  const run = (args) => {
    const r = spawnSync(FFMPEG, ['-hide_banner', '-v', 'error', '-y', ...args], { windowsHide: true, encoding: 'utf8', maxBuffer: 1 << 26 });
    if (r.status) throw new Error((r.stderr || '').slice(-1500));
  };
  const probe = spawnSync(FFMPEG, ['-hide_banner', '-i', src], { windowsHide: true, encoding: 'utf8' }).stderr || '';
  const m = /Duration: (\d+):(\d+):([\d.]+)/.exec(probe);
  const srcDur = m ? (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) : 3;
  fs.mkdirSync(OUT, { recursive: true });

  const made = {};
  try {
    for (const key of keys) {
      const set = key.startsWith('set-') ? FX.SETS[key.slice(4)] : null;
      const items = set ? set.items : [{ k: key }];
      const intro = items.some((it) => FX.EFFECTS[it.k].kind === 'intro');
      const longest = Math.max(...items.map((it) => (FX.EFFECTS[it.k].kind === 'intro' ? FX.EFFECTS[it.k].dur : 0)));
      const lead = intro ? CFG.lead : 0;
      const dur = Math.min(srcDur - 0.05, intro ? lead + longest + CFG.tail : CFG.loop);
      const clip = { id: 'c', src: '/media/work/example.mp4', name: key, start: 0, dur, trimIn: 0, fit: 'fill' };
      clip.fx = P.normalizeFx(items.map((it, i) => ({
        id: 'e' + i, k: it.k, t0: lead, ...(it.len > 0 ? { len: it.len } : {}), ...(FX.EFFECTS[it.k].face ? { path: CFG.face } : {}),
      })));
      const tl = { format: '9:16', tracks: [{ id: 'v1', kind: 'video', main: true, name: 'main video', clips: [clip] }] };
      const p = await JOB.prepare(tl, 'tile_' + key, {}, null);
      if (p.error) throw new Error(key + ': ' + p.error);
      const full = path.join(lib, key + '.mp4');
      try {
        const r = spawnSync(FFMPEG, [...p.args, full], { windowsHide: true, encoding: 'utf8', maxBuffer: 1 << 26 });
        if (r.status) throw new Error(key + ': ' + (r.stderr || '').slice(-1500));
      } finally { p.dispose(); }
      // The square: the frame's width, on the face's height.
      const W = 1080, H = 1920;
      const y = Math.round(Math.max(0, Math.min(H - W, CFG.cropY * H - W / 2)));
      const sq = `crop=${W}:${W}:0:${y},scale=${CFG.px}:${CFG.px}:flags=lanczos`;
      run(['-i', full, '-vf', `${sq},fps=${CFG.fps}`, '-an', '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '40', '-row-mt', '1',
        '-deadline', 'good', '-cpu-used', '2', '-pix_fmt', 'yuv420p', path.join(OUT, key + '.webm')]);
      const peak = lead + (+CFG.peaks[key] || 0);
      run(['-ss', peak.toFixed(3), '-i', full, '-vf', sq, '-frames:v', '1', '-c:v', 'libwebp', '-quality', '82', path.join(OUT, key + '.webp')]);
      const kb = (f) => Math.round(fs.statSync(path.join(OUT, key + f)).size / 1024);
      made[key] = { seconds: +dur.toFixed(2), peak: +peak.toFixed(2) };
      console.log(key.padEnd(14), dur.toFixed(2) + ' s', kb('.webm') + ' KB', kb('.webp') + ' KB');
    }
  } finally {
    fs.rmSync(lib, { recursive: true, force: true });
    // The render's scratch for that library (lib/config.js SCRATCH_DIR) goes with it.
    try { const { TEMP_DIR } = require('../lib/config'); if (TEMP_DIR) fs.rmSync(path.dirname(TEMP_DIR), { recursive: true, force: true }); } catch (e) { /* not made */ }
  }
  fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify({ print: rulePrint(), source: CFG.source, px: CFG.px, tiles: made }, null, 2) + '\n');
  console.log('tiles:', Object.keys(made).length, '->', path.relative(ROOT, OUT));
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
