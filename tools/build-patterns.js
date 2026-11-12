'use strict';

/* build-patterns.js - builds the app's built-in pattern set (phase V65; docs/local-app/plan/,
   "Фаза V65"), from tools/patterns-list.json and the folder of finished files the owner chose: one folder laid out as
   vendor/patterns/ is, and ONE archive of it - the archive tools/fetch-patterns.js installs. Run by hand when the set
   changes; npm install never runs it:
       node tools/build-patterns.js --from "<folder with the list's `from` files>"
           -> <temp>/ugc-patterns-build/out/ and <temp>/ugc-patterns-build/ugc-patterns-<version>.zip
   Then the archive is copied to tools/patterns/ (kept in git, as the sound set's is) and its name, size, SHA-256 and
   number of patterns go into fetch-patterns.js's PIN.

   THE FILES: each a SEAMLESS tile, white on transparent (a texture's brightness became its opacity), 2160 x 2160 - noise
   and film grain 1080 x 1080 (the owner 2026-10-31). Made in the V65 sub-session and approved by the owner in the folder
   "Паттерны — просмотр" (2026-10-31): Hero Patterns (CC BY 4.0, Steve Schoger) and CC0 files of Wikimedia Commons,
   Flickr and ambientCG, three drawn for the app; the list says where each came from and what was done to it. Not used:
   Pixabay (its licence forbids handing its files on as they are).

   WHAT IS ADDED HERE: thumbs/<id>.webp - the middle 840 px of the file at half size (420 px, quality 85, transparency
   kept): a whole 2160 px tile shrunk to a gallery cell is a grey blur; this is about what a phone shows.

   IDS NEVER CHANGE: a project points at /patterns/<id>.png. A new version of the set only ADDS entries. */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const sharp = require('sharp');
sharp.cache(false);

const LIST_FILE = path.join(__dirname, 'patterns-list.json');
const arg = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};
const BASE = path.join(os.tmpdir(), 'ugc-patterns-build');
const OUT = path.resolve(arg('--out', path.join(BASE, 'out')));
const FROM = arg('--from', '');
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const THUMB = { crop: 840, px: 420, q: 85 };
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

// The list, checked: every id well formed and once, every source known, every entry with its author and licence.
function readList() {
  const list = JSON.parse(fs.readFileSync(LIST_FILE, 'utf8'));
  const seen = new Set();
  for (const p of list.patterns) {
    const where = 'patterns-list.json, ' + p.id;
    if (!ID.test(p.id) || seen.has(p.id)) throw new Error(where + ': an id must be unique, lower case, words joined by -');
    seen.add(p.id);
    if (!p.name || !p.from) throw new Error(where + ': a name and the file it comes from');
    if (p.source ? !list.sources[p.source] : !(p.author && p.license && p.page)) throw new Error(where + ': a source, or its author, licence and page');
  }
  return list;
}

// One entry as the app reads it: where it came from in full.
function entry(list, p, file, size) {
  const s = p.source ? list.sources[p.source] : null;
  return {
    id: p.id, name: p.name, file, thumb: 'thumbs/' + p.id + '.webp', size,
    author: s ? s.author : p.author,
    license: s ? s.license : p.license,
    licenseUrl: s ? s.licenseUrl : (p.licenseUrl || ''),
    source: s ? s.title : p.via,
    url: s ? s.page : p.page,
    original: p.original || '',
    changed: p.changed || '',
  };
}

function credits(list, made) {
  const lines = [
    `UGC Studio - the built-in pattern set, version ${list.version} (${made.length} patterns)`,
    '',
    'Seamless tiles, white on transparent, laid over video in the app. Each one\'s source, author and licence are in',
    'patterns.json. What was done to each: its `changed`.',
    '',
  ];
  const hero = made.filter(m => m.source === 'Hero Patterns');
  if (hero.length) {
    lines.push('Hero Patterns by Steve Schoger - https://heropatterns.com/ - licensed CC BY 4.0',
      '(https://creativecommons.org/licenses/by/4.0/). Changed: coloured white and laid as larger tiles.');
    for (const m of hero) lines.push(`  ${m.name} - from "${m.original}"`);
    lines.push('');
  }
  const cc0 = made.filter(m => /^CC0/.test(m.license));
  if (cc0.length) {
    lines.push('CC0 1.0 (https://creativecommons.org/publicdomain/zero/1.0/) - no credit required, credited with thanks:');
    for (const m of cc0) lines.push(`  ${m.name} - "${m.original}" by ${m.author}, ${m.source} - ${m.url}`);
    lines.push('');
  }
  const own = made.filter(m => m.source === 'UGC Studio');
  if (own.length) lines.push('Drawn for UGC Studio: ' + own.map(m => m.name).join(', ') + '.');
  return lines.join('\n') + '\n';
}

async function zip(dir, names, file, date) {
  const archiver = require('archiver');
  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(file);
    const a = archiver('zip', { store: true });
    out.on('close', resolve);
    a.on('error', reject);
    a.pipe(out);
    // Buffers in a fixed order, not a.file(): the same set makes the same zip (see build-sfx.js).
    for (const name of names) a.append(fs.readFileSync(path.join(dir, name)), { name, date });
    a.finalize();
  });
}

async function main() {
  if (!FROM) throw new Error('--from <folder> - the folder with the finished files the list names');
  const list = readList();
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(path.join(OUT, 'thumbs'), { recursive: true });
  const made = [];
  for (const p of list.patterns) {
    const src = path.join(FROM, p.from);
    const buf = fs.readFileSync(src);
    const m = await sharp(buf).metadata();
    if (m.format !== 'png' || m.width !== m.height || !m.hasAlpha || ![1080, 2160].includes(m.width)) {
      throw new Error(p.from + ': a square PNG of 1080 or 2160 px with transparency');
    }
    const file = p.id + '.png';
    fs.writeFileSync(path.join(OUT, file), buf);
    const c = Math.min(THUMB.crop, m.width), at = (m.width - c) >> 1;
    await sharp(buf).extract({ left: at, top: at, width: c, height: c }).resize(THUMB.px, THUMB.px)
      .webp({ quality: THUMB.q, alphaQuality: 100 }).toFile(path.join(OUT, 'thumbs', p.id + '.webp'));
    made.push(entry(list, p, file, m.width));
  }
  fs.writeFileSync(path.join(OUT, 'LICENSE.txt'), credits(list, made));
  const json = { format: 1, version: list.version, built: list.built, patterns: made };
  fs.writeFileSync(path.join(OUT, 'patterns.json'), JSON.stringify(json, null, 1));
  const names = ['patterns.json', 'LICENSE.txt', ...made.map(m => m.file).sort(), ...made.map(m => m.thumb).sort()];
  const archive = path.join(path.dirname(OUT), `ugc-patterns-${list.version}.zip`);
  await zip(OUT, names, archive, new Date(list.built + 'T00:00:00Z'));
  const out = fs.readFileSync(archive);
  console.log(`[patterns] ${made.length} patterns in ${OUT}`);
  console.log(`[patterns] ${archive}\n  bytes: ${out.length} (${(out.length / 1048576).toFixed(1)} MB)\n  sha256: ${sha256(out)}`);
}

main().catch((e) => {
  console.error('[patterns] ' + e.message);
  process.exit(1);
});
