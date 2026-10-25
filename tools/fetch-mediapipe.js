'use strict';

/* fetch-mediapipe.js - puts MediaPipe's face detector into vendor/mediapipe/: the highlights shorts follow the face
   (phase V33.2; docs/local-app/PLAN.md "Фаза V33", the measurement of 2026-10-21) - and its person detector, for a shot
   with no face (phase V33.6).

   npm install runs it (postinstall, with --optional: no network is a warning, not a failed install).
   By hand, after moving a pin:
       node tools/fetch-mediapipe.js

   Two things, each pinned:
     - @mediapipe/tasks-vision from the npm registry, by version AND by its published SHA-512 (the `dist.integrity` of
       that version): the page module (vision_bundle.mjs) and ONE wasm with its loader - the SIMD build, which Electron's
       Chromium runs (the page names it outright instead of letting FilesetResolver test for SIMD and ask for the other);
     - the BlazeFace FULL RANGE model (float16, version 1) from Google's model bucket, by SHA-256. Full range, not short
       range: on the owner's sources it found a face in 76% of the frames against 57%, and in the podcasts' wide two-shots
       99-100% against 62% (short range does not see a small face); 5.8 ms a frame on the window's GPU;
     - (phase V33.6) the EfficientDet-Lite0 OBJECT detector (float16, version 1), by SHA-256 - whole PEOPLE, where a
       highlights short has no face to follow. float16, not int8: int8 on the window's GPU found NOTHING at all (measured
       2026-10-21); 28.5 ms a frame on the GPU;
     - (phase V43) the FACE LANDMARKER (float16, version 1), by SHA-256 - fragmentation's frame goes to who speaks (the lips
       moving while words sound) and who reacts (a face's look changing): on the owner's episode it read 68% of the faces of
       LEGO figures and every frame of a live face, 11 ms a face on a crop around it (PLAN.md V43, block 0, 2026-10-25).
   Licences: MediaPipe is Apache-2.0 (its package.json says so; the package carries no text - a note says which it is);
   the model's card gives Apache-2.0 too. */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const PIN = {
  version: '1.1.1',
  integrity: 'sha512-jwntgT5tzDrKOkqg6xNDNpRcTUnGvmylZE5DFnzPXossiWOIDdZX+C81LI75hlXhsG58YZW+lGzcmjH1qrQE/Q==',
  model: {
    url: 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_full_range/float16/1/blaze_face_full_range.tflite',
    sha256: '3698b18f063835bc609069ef052228fbe86d9c9a6dc8dcb7c7c2d69aed2b181b',
    file: 'blaze_face_full_range.tflite',
  },
  people: {
    url: 'https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite',
    sha256: '4b59100025bea1235a84c1038879a6cccc9f6c49f5e41144e91e74d99e780993',
    file: 'efficientdet_lite0.tflite',
  },
  landmarks: {
    url: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
    sha256: '64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff',
    file: 'face_landmarker.task',
  },
};
const DIR = path.join(__dirname, '..', 'vendor', 'mediapipe');
const MARK = path.join(DIR, 'PINNED.json');
const optional = process.argv.includes('--optional');

// A .tgz's files, by path inside the package ("package/..."). ustar: 512-byte headers, octal sizes.
function untar(buf) {
  const files = new Map();
  for (let off = 0; off + 512 <= buf.length;) {
    const head = buf.subarray(off, off + 512);
    if (head.every(b => b === 0)) break;
    const str = (a, b) => head.subarray(a, b).toString('utf8').replace(/\0.*$/s, '');
    const name = (str(345, 500) ? str(345, 500) + '/' : '') + str(0, 100);
    const size = parseInt(str(124, 136).trim() || '0', 8);
    const type = String.fromCharCode(head[156] || 48);
    off += 512;
    if (type === '0' || type === '\0') files.set(name, Buffer.from(buf.subarray(off, off + size)));
    off += Math.ceil(size / 512) * 512;
  }
  return files;
}

async function get(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(res.status + ' ' + url);
  return Buffer.from(await res.arrayBuffer());
}

const noMap = (s) => s.replace(/\n\/\/# sourceMappingURL=.*$/m, '');

async function main() {
  try {
    const have = JSON.parse(fs.readFileSync(MARK, 'utf8'));
    if (JSON.stringify(have) === JSON.stringify(PIN)) { console.log('[mediapipe] ' + PIN.version + ' already in place'); return; }
  } catch (e) { /* not there yet */ }

  const tgz = await get('https://registry.npmjs.org/@mediapipe/tasks-vision/-/tasks-vision-' + PIN.version + '.tgz');
  if ('sha512-' + crypto.createHash('sha512').update(tgz).digest('base64') !== PIN.integrity) {
    throw new Error('@mediapipe/tasks-vision@' + PIN.version + ': the tarball is not the pinned one');
  }
  const pk = untar(zlib.gunzipSync(tgz));
  const model = await get(PIN.model.url);
  if (crypto.createHash('sha256').update(model).digest('hex') !== PIN.model.sha256) throw new Error(PIN.model.file + ': not the pinned model');
  const people = await get(PIN.people.url);
  if (crypto.createHash('sha256').update(people).digest('hex') !== PIN.people.sha256) throw new Error(PIN.people.file + ': not the pinned model');
  const marks = await get(PIN.landmarks.url);
  if (crypto.createHash('sha256').update(marks).digest('hex') !== PIN.landmarks.sha256) throw new Error(PIN.landmarks.file + ': not the pinned model');

  fs.rmSync(DIR, { recursive: true, force: true });
  const put = (rel, data) => {
    const f = path.join(DIR, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, data);
  };
  const take = (p) => {
    const b = pk.get('package/' + p);
    if (!b) throw new Error('@mediapipe/tasks-vision: ' + p + ' is not in the package');
    return b;
  };
  put('vision_bundle.mjs', noMap(take('vision_bundle.mjs').toString('utf8')));
  put('wasm/vision_wasm_internal.js', noMap(take('wasm/vision_wasm_internal.js').toString('utf8')));
  put('wasm/vision_wasm_internal.wasm', take('wasm/vision_wasm_internal.wasm'));
  put(PIN.model.file, model);
  put(PIN.people.file, people);
  put(PIN.landmarks.file, marks);
  let declared = 'Apache-2.0';
  try { declared = JSON.parse(take('package.json').toString('utf8')).license || declared; } catch (e) { /* as said above */ }
  put('LICENSES.txt', '@mediapipe/tasks-vision ' + PIN.version + ': ' + declared + ', as its package.json declares; the package carries no licence text.\n'
    + 'https://github.com/google-ai-edge/mediapipe - https://www.apache.org/licenses/LICENSE-2.0\n'
    + PIN.model.file + ' (BlazeFace full range, float16, version 1): Apache-2.0, per its model card.\n'
    + 'https://ai.google.dev/edge/mediapipe/solutions/vision/face_detector\n'
    + PIN.people.file + ' (EfficientDet-Lite0, float16, version 1): Apache-2.0, per its model card.\n'
    + 'https://ai.google.dev/edge/mediapipe/solutions/vision/object_detector\n'
    + PIN.landmarks.file + ' (Face Landmarker, float16, version 1): Apache-2.0, per its model card.\n'
    + 'https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker\n');
  fs.writeFileSync(MARK, JSON.stringify(PIN, null, 2));
  console.log('[mediapipe] ' + PIN.version + ', ' + PIN.model.file + ', ' + PIN.people.file + ' and ' + PIN.landmarks.file + ' laid out in vendor/mediapipe/');
}

main().catch((e) => {
  console[optional ? 'warn' : 'error']('[mediapipe] ' + (optional ? 'skipped - ' : '') + e.message
    + (optional ? ' (faces are not followed until `node tools/fetch-mediapipe.js` runs)' : ''));
  if (!optional) process.exit(1);
});
