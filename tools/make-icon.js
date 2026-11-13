'use strict';

/* make-icon.js - the app's icon, by hand: a simple sign, a gold "U" on the dark.

       node tools/make-icon.js            writes desktop/icon.png (256 px) and desktop/icon.ico (16-256 px)

   Drawn as a path, not a letter of a font: the same on every computer. The colours are the app's - the gold of
   public/css/app-shell.css (`--gold`, oklch(.78 .12 85)) on its graphite. The .ico holds PNG pictures (Windows Vista
   and later read them): the window's icon (desktop/main.js) and the launcher's (desktop/launcher). */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const OUT = path.join(__dirname, '..', 'desktop');
const SIZES = [16, 24, 32, 48, 64, 128, 256];

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
  <rect x="8" y="8" width="240" height="240" rx="52" fill="#151517"/>
  <rect x="8" y="8" width="240" height="240" rx="52" fill="none" stroke="#d3a95b" stroke-opacity=".35" stroke-width="6"/>
  <path d="M82 62 V140 A46 46 0 0 0 174 140 V62" fill="none" stroke="#d3a95b" stroke-width="36" stroke-linecap="round"/>
</svg>`;

async function main() {
  const pngs = [];
  for (const s of SIZES) pngs.push(await sharp(Buffer.from(SVG), { density: 72 * s / 256 * 4 }).resize(s, s).png().toBuffer());
  fs.writeFileSync(path.join(OUT, 'icon.png'), pngs[pngs.length - 1]);

  // ICONDIR, one ICONDIRENTRY per size, then the PNGs.
  const head = Buffer.alloc(6 + 16 * SIZES.length);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(SIZES.length, 4);
  let at = head.length;
  SIZES.forEach((s, i) => {
    const e = 6 + 16 * i;
    head.writeUInt8(s >= 256 ? 0 : s, e); head.writeUInt8(s >= 256 ? 0 : s, e + 1);
    head.writeUInt8(0, e + 2); head.writeUInt8(0, e + 3);
    head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6);
    head.writeUInt32LE(pngs[i].length, e + 8); head.writeUInt32LE(at, e + 12);
    at += pngs[i].length;
  });
  fs.writeFileSync(path.join(OUT, 'icon.ico'), Buffer.concat([head, ...pngs]));
  console.log(`[icon] desktop/icon.png and desktop/icon.ico (${SIZES.join(', ')} px)`);
}

main().catch((e) => { console.error('[icon] ' + e.message); process.exit(1); });
