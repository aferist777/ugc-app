'use strict';

// Pre-make the derivatives for everything already in the stores, so the first person to open a
// page is not the one paying for the resizes.
//
//   node tools/warm-thumbs.js          make what is missing
//   node tools/warm-thumbs.js --dry    say what it would make
//
// It walks the stores rather than the disk: the point is the images the pages DISPLAY, at the
// sizes they display them. A file nobody shows does not need a thumbnail, and the endpoint would
// make one on demand anyway if that changed.

const fs = require('fs');
const path = require('path');
const { ensureThumb, resolveSrc, thumbPath, VARIANTS } = require('../lib/thumbs');

const ROOT = path.join(__dirname, '..');
const read = (f, d) => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8')); } catch (e) { return d; } };

// Which sizes each kind of image is actually shown at:
//   a character sheet     the big view (sheet) and the strip's first cell (strip)
//   a look                the strip, and the big view when it is picked
//   a scenario frame      the gallery cell, and the hover preview
//   a preset example      the create column
function targets() {
  const jobs = [];
  const add = (src, vs) => { if (src) for (const v of vs) jobs.push({ src, v }); };

  const chars = read('data/characters.json', []);
  (Array.isArray(chars) ? chars : []).forEach(c => add(c && c.sheet, ['sheet', 'strip']));

  const obrazy = read('data/obrazy.json', []);
  const looks = Array.isArray(obrazy) ? obrazy : (obrazy.obrazy || Object.values(obrazy || {}));
  looks.filter(Boolean).forEach(o => add(o.char, ['strip', 'sheet']));

  const projects = read('data/scen3-projects.json', []);
  (Array.isArray(projects) ? projects : []).forEach(p => {
    ((p.mix || {}).variants || []).forEach(v => {
      if (!v) return;
      add(v.preview || v.path, ['frame']);
      add(v.path, ['main']);
    });
  });

  try {
    fs.readdirSync(path.join(ROOT, 'public', 'presets'))
      .filter(f => /\.jpe?g$/i.test(f))
      .forEach(f => add('/presets/' + f, ['preset']));
  } catch (e) {}

  // The same image can be reached twice - a look that is also a project's casting, say.
  const seen = new Set(), out = [];
  for (const j of jobs) {
    const k = j.v + '|' + j.src;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(j);
  }
  return out;
}

async function main() {
  const dry = process.argv.includes('--dry');
  const jobs = targets();
  console.log(jobs.length + ' image/variant pairs the pages display'
    + (dry ? ' (dry run)' : '') + '\n');

  let made = 0, had = 0, missing = 0, failed = 0, bytes = 0;
  const byVariant = {};
  for (const j of jobs) {
    const abs = resolveSrc(j.src);
    if (!abs) { missing++; continue; }                 // a record whose file is gone
    const dest = thumbPath(abs, j.v);
    if (fs.existsSync(dest)) { had++; bytes += fs.statSync(dest).size; continue; }
    if (dry) { made++; continue; }
    try {
      const out = await ensureThumb(j.src, j.v);
      const sz = fs.statSync(out).size;
      made++; bytes += sz;
      const b = byVariant[j.v] || { n: 0, bytes: 0, src: 0 };
      b.n++; b.bytes += sz; b.src += fs.statSync(abs).size;
      byVariant[j.v] = b;
    } catch (e) {
      failed++;
      console.warn('  failed ' + j.v + ' ' + j.src + ': ' + e.message);
    }
  }

  console.log((dry ? 'would make ' : 'made ') + made + ', already cached ' + had
    + ', source missing ' + missing + (failed ? ', failed ' + failed : ''));
  if (!dry && made) {
    console.log('\nper variant, average size against the source it came from:');
    for (const [v, b] of Object.entries(byVariant)) {
      const kb = (n) => Math.round(n / b.n / 1024) + ' KB';
      console.log('  ' + v.padEnd(7) + b.n + ' made   ' + kb(b.bytes).padStart(7)
        + '  from ' + kb(b.src).padStart(8) + '   budget ' + (VARIANTS[v].kb ? VARIANTS[v].kb + ' KB' : VARIANTS[v].px + 'px'));
    }
    console.log('\ncache now holds ' + Math.round(bytes / 1024) + ' KB for these');
  }
  if (failed) process.exitCode = 1;
}

main().catch(e => { console.error(e); process.exit(1); });
