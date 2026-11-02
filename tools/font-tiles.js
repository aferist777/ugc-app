'use strict';

/* font-tiles.js - draws the fonts tab's tile pictures (phase V68 P4, the owner's check 2026-11-02: the tab drawn in the live fonts
   loaded all 33 MB of them and stuttered when scrolled) into public/fonts/captions/tiles/ - one WebP per family of
   public/js/captions/fonts.js, and tiles/index.json saying what each was drawn from.

   Run it by hand when a caption font is added, removed or replaced (after tools/build-fonts.py and tools/caption-advances.js):
       node tools/font-tiles.js            draws every tile
       node tools/font-tiles.js --check    says whether every family has its tile, drawn from the font files as they are now

   A tile is what the render draws: the app's own ffmpeg and libass with the caption fonts' folder (fontsdir), 192 px square (the
   cell is 88-96 px - twice its pixels), on the tile's dark ground: "Captions" in the font and "Субтитры" under it in the font a
   Russian line is drawn in (fonts.js drawnFamily - the twin where it has no Cyrillic), white with a black outline, each word as
   wide as the square allows (measure.js - the letters' own advances) and no taller than its share; lossless WebP. */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const FONTS_DIR = path.join(ROOT, 'public', 'fonts', 'captions');
const OUT = path.join(FONTS_DIR, 'tiles');
const FFMPEG = require('ffmpeg-static');
const SUBS = require('../lib/mv3b-subs.js');

// What a tile is - every number here is part of what index.json records.
const TILE = { px: 192, bg: '16181d', words: [
  { text: 'Captions', y: 78, width: 0.86, ink: 58 },
  { text: 'Субтитры', y: 136, width: 0.78, ink: 36 },
], outline: 3, version: 1 };

const sha = (b) => crypto.createHash('sha1').update(b).digest('hex');
const assTime = (s) => '0:' + String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0') + '.00';

async function main() {
  const F = await import('../public/js/captions/fonts.js');
  const M = await import('../public/js/captions/measure.js');
  const B = String.fromCharCode(92);
  const fileOf = (family) => path.join(FONTS_DIR, Object.values(F.fontOf(family).files).slice(-1)[0]);
  const settings = JSON.stringify(TILE);
  // Each family: the fonts its two words are drawn in, and what its tile is made of.
  const list = F.FONTS.map((f) => {
    const fams = TILE.words.map((w) => F.drawnFamily(f.family, w.text));
    const made = sha(settings + '|' + fams.map((x) => x + ':' + sha(fs.readFileSync(fileOf(x)))).join('|'));
    return { family: f.family, file: F.tileName(f.family), fams, made };
  });

  if (process.argv.includes('--check')) {
    let idx = {};
    try { idx = JSON.parse(fs.readFileSync(path.join(OUT, 'index.json'), 'utf8')); } catch (e) { idx = {}; }
    const bad = list.filter((t) => !(idx.tiles && idx.tiles[t.family] && idx.tiles[t.family].made === t.made && fs.existsSync(path.join(OUT, t.file))));
    if (!bad.length) { console.log('tiles/ holds the ' + list.length + ' tiles, drawn from the fonts as they are.'); return; }
    console.error(bad.length + ' tiles missing or drawn from other files (' + bad.slice(0, 5).map((t) => t.family).join(', ') + ') - run node tools/font-tiles.js');
    process.exitCode = 1;
    return;
  }

  // One .ass, one second a family: its two words, each at the size that fills its width (or its height share).
  const styles = [], events = [];
  list.forEach((t, i) => {
    TILE.words.forEach((w, k) => {
      const fam = t.fams[k];
      const face = F.assFace(fam, true);
      const base = { font: fam, size: 100, bold: true, outline: TILE.outline, scaleX: 100, spacing: 0, casing: 'none' };
      const wide = M.meter(base).text(w.text) - 2 * TILE.outline;
      const ink = F.fontOf(fam).ink || [0, 0];
      const tall = 100 * Math.max(0.2, 1 - ink[0] - ink[1]);
      const size = Math.max(8, Math.min(100 * (TILE.px * w.width) / wide, 100 * w.ink / tall));
      // \an5 centres the line; the letters sit where the font's ink is - moved so their middle is at `y`.
      const y = w.y + size * (ink[1] - ink[0]) / 2;
      const name = 'T' + i + 'w' + k;
      styles.push('Style: ' + name + ',' + face.family + ',' + size.toFixed(2) + ',&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,'
        + face.bold + ',0,0,0,100,100,0,0,1,' + TILE.outline + ',0,5,0,0,0,1');
      events.push('Dialogue: 0,' + assTime(i) + ',' + assTime(i + 1) + ',' + name + ',,0,0,0,,{' + B + 'pos(' + (TILE.px / 2) + ',' + y.toFixed(1) + ')}' + w.text);
    });
  });
  const ass = '[Script Info]\nScriptType: v4.00+\nPlayResX: ' + TILE.px + '\nPlayResY: ' + TILE.px + '\nScaledBorderAndShadow: yes\nWrapStyle: 2\n\n'
    + '[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, '
    + 'StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n'
    + styles.join('\n') + '\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n' + events.join('\n') + '\n';
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'ugc-font-tiles-'));
  const assFile = path.join(tmp, 'tiles.ass');
  fs.writeFileSync(assFile, ass);
  const vf = 'ass=filename=' + SUBS.escapeFilterPath(assFile) + ':fontsdir=' + SUBS.escapeFilterPath(FONTS_DIR);
  const r = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=0x' + TILE.bg + ':s=' + TILE.px + 'x' + TILE.px + ':r=1',
    '-t', String(list.length), '-vf', vf, '-c:v', 'libwebp', '-lossless', '1', '-compression_level', '6', '-pix_fmt', 'bgra',
    '-f', 'image2', '-start_number', '0', path.join(tmp, 't%03d.webp')], { windowsHide: true, encoding: 'utf8' });
  if (r.status !== 0) throw new Error('ffmpeg: ' + (r.stderr || r.error || r.status));
  fs.mkdirSync(OUT, { recursive: true });
  const keep = new Set(list.map((t) => t.file).concat(['index.json']));
  for (const f of fs.readdirSync(OUT)) if (!keep.has(f)) fs.unlinkSync(path.join(OUT, f));
  let bytes = 0;
  const tiles = {};
  list.forEach((t, i) => {
    const from = path.join(tmp, 't' + String(i).padStart(3, '0') + '.webp');
    fs.copyFileSync(from, path.join(OUT, t.file));
    bytes += fs.statSync(from).size;
    tiles[t.family] = { file: t.file, made: t.made };
  });
  fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify({ tile: TILE, tiles }, null, 1) + '\n');
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('Wrote ' + list.length + ' tiles into ' + path.relative(ROOT, OUT) + ', ' + Math.round(bytes / 1024) + ' KB.');
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
