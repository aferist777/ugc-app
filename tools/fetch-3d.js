'use strict';

/* fetch-3d.js - puts the 3D Studio's models into vendor/3d/ (docs/local-app/PLAN.md "3D Studio - план по этапам", 3D1).

   npm install runs it (postinstall, with --optional: no network is a warning, not a failed install).
   By hand, after moving a pin:
       node tools/fetch-3d.js

   What it lays out, every file pinned by its SHA-256, so a file changed after the fact is refused:
     people/     Mesh2Motion (github.com/Mesh2Motion/mesh2motion-app, at the commit below): the male and female
                 figures (by Quaternius) and two libraries of motions, all on ONE 66-bone skeleton - the motions
                 play on either figure. Its art is CC0, its code MIT; both licence files are kept beside them.
                 The figures are the studio's mannequins; their own colours are never shown (a blockout is flat).
     furniture/  Kenney's Furniture Kit 2.0 (kenney.nl, CC0): the 140 models of its "GLTF format" folder and its
                 License.txt. Kenney's sizes are its own (a doorway is ~1 unit); the studio scales each model to a
                 real height from its catalogue (public/js/studio3d/catalog.js).
   vendor/ is not in git and ships with the build, like jassub and whisper. */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const M2M = 'https://raw.githubusercontent.com/Mesh2Motion/mesh2motion-app/653a9698f5f315523072f1c3ff3496100401317b/';
const PEOPLE = [
  { from: 'static/models-variation/human/male.glb', to: 'male.glb', bytes: 534004, sha256: 'c7c445f4309d8883667ca9f85ef6ba226c71f492c827af115c46c52bc450a019' },
  { from: 'static/models-variation/human/female.glb', to: 'female.glb', bytes: 1358928, sha256: '2b1c47e5eeebffd5097eb8a52add4ba6556dab85e50fc1c5240d744099bebae1' },
  { from: 'static/animations/human-base-animations.glb', to: 'motions-base.glb', bytes: 5656648, sha256: '406eb0a8dc4ab366e623b79b6e3005a4951392e1bda78ae39c1099d31147733c' },
  { from: 'static/animations/human-addon-animations.glb', to: 'motions-addon.glb', bytes: 5292804, sha256: 'a0d64d555e0d492026b72d58bf8e16c5e86779295f9093e376dcc001915c2c95' },
  { from: 'LICENSE-CC0.MD', to: 'LICENSE-CC0.md', bytes: 294, sha256: '52fec1c484df708c16b4c27b2bf0d7f0d3994105c57adc4b9e6f95bcfd9de65f' },
  { from: 'LICENSE-MIT.MD', to: 'LICENSE-MIT.md', bytes: 1120, sha256: 'a40dbdb297466562778a58864f075415c1414778a19176bd85091d0434094b1d' },
];
const KENNEY = {
  url: 'https://kenney.nl/media/pages/assets/furniture-kit/440e0608a4-1677580847/kenney_furniture-kit.zip',
  bytes: 5130729, sha256: 'e67652d0932cee41683f74711c03d3e192a2af9979ef8e6b237711f5482d46b0', models: 140,
};
const DIR = path.join(__dirname, '..', 'vendor', '3d');
const MARK = path.join(DIR, 'PINNED.json');
const PIN = { people: PEOPLE.map(f => f.sha256), kenney: KENNEY.sha256 };
const optional = process.argv.includes('--optional');

async function download(url, bytes, sha256) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(res.status + ' ' + url);
  const buf = Buffer.from(await res.arrayBuffer());
  const got = crypto.createHash('sha256').update(buf).digest('hex');
  if (buf.length !== bytes || got !== sha256) throw new Error('not the pinned file: ' + url);
  return buf;
}

async function main() {
  try {
    if (JSON.stringify(JSON.parse(fs.readFileSync(MARK, 'utf8'))) === JSON.stringify(PIN)) { console.log('[3d] models already in place'); return; }
  } catch (e) { /* not there yet */ }

  const people = [];
  for (const f of PEOPLE) people.push([f.to, await download(M2M + f.from, f.bytes, f.sha256)]);
  const zip = await download(KENNEY.url, KENNEY.bytes, KENNEY.sha256);
  const archive = await require('unzipper').Open.buffer(zip);
  const furniture = [];
  for (const e of archive.files) {
    const m = /^Models\/GLTF format\/([A-Za-z0-9_]+\.glb)$/.exec(e.path);
    if (m) furniture.push([m[1], await e.buffer()]);
    else if (e.path === 'License.txt') furniture.push(['License.txt', await e.buffer()]);
  }
  if (furniture.length !== KENNEY.models + 1) throw new Error('the furniture kit holds ' + (furniture.length - 1) + ' models, not ' + KENNEY.models);

  // Laid out only once everything arrived whole: a broken download leaves the old copy as it was.
  fs.rmSync(DIR, { recursive: true, force: true });
  for (const [sub, files] of [['people', people], ['furniture', furniture]]) {
    fs.mkdirSync(path.join(DIR, sub), { recursive: true });
    for (const [name, buf] of files) fs.writeFileSync(path.join(DIR, sub, name), buf);
  }
  fs.writeFileSync(MARK, JSON.stringify(PIN));
  console.log('[3d] 2 mannequins, 2 motion libraries and ' + KENNEY.models + ' furniture models laid out in ' + DIR);
}

main().catch((e) => {
  console[optional ? 'warn' : 'error']('[3d] ' + e.message);
  if (!optional) process.exit(1);
});
