'use strict';

/* fetch-whisper.js - puts the whisper.cpp the app ships with into vendor/whisper/ (phase K1b).

   Captions are heard by Groq first; when Groq cannot be asked (no key, no network, it failed) or the
   subtitle lane says "this computer", lib/whisper-local.js runs this program on the sound instead.

   npm install runs it (postinstall, with --optional: no network is a warning, not a failed install).
   By hand, after moving the pin:
       node tools/fetch-whisper.js

   ONE BUILD, Windows x64 with OpenBLAS (the benchmark in docs/local-app/PLAN.md: 15% faster on the
   processor than the plain build, the same words), pinned by the release AND by SHA-256 - the release
   publishes no checksum file, so the hash is the one GitHub shows for the asset, checked here, and an
   asset swapped after the fact is refused. Only what whisper-cli needs is unpacked: the program, its
   DLLs, the processor variants ggml picks from at run time, and OpenBLAS. The build for NVIDIA cards is
   NOT shipped: it is 674 MB and is fetched by a button on Admin into the library's cache.

   To move the pin: RELEASE, VERSION and the asset's SHA-256 and size below - and the same release in
   lib/whisper-local.js, whose NVIDIA build must match this one. */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');

const RELEASE = 'b5130';            // the nightly tag of whisper.cpp v1.9.4 (commit 927cfce)
const VERSION = 'v1.9.4';
const ASSET = { file: 'whisper-blas-bin-x64.zip', size: 21360234,
  sha256: '55c06d09e8b9b6cfb2b0b47ddedc71803054f0e48be1f41848b3141c06c703a9' };
// What is kept from the zip's Release/ folder.
const KEEP = /^(whisper-cli\.exe|whisper\.dll|ggml(-[a-z0-9]+)*\.dll|libopenblas\.dll)$/i;
const DIR = path.join(__dirname, '..', 'vendor', 'whisper');
const PIN = path.join(DIR, 'PINNED.json');
const optional = process.argv.includes('--optional');

const LICENSE = `whisper.cpp ${VERSION} (${RELEASE}) - https://github.com/ggml-org/whisper.cpp
MIT License. Copyright (c) The ggml authors.

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
associated documentation files (the "Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the
following conditions: The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED.

libopenblas.dll - OpenBLAS, BSD 3-Clause License, https://github.com/OpenMathLib/OpenBLAS
The Whisper model weights (downloaded at first use, not shipped) - MIT, OpenAI.
`;

function pinned() {
  try {
    const p = JSON.parse(fs.readFileSync(PIN, 'utf8'));
    return p.release === RELEASE && p.sha256 === ASSET.sha256
      && (p.files || []).every((f) => fs.existsSync(path.join(DIR, f))) ? p : null;
  } catch (e) { return null; }
}

async function main() {
  if (process.platform !== 'win32') {
    console.warn('[whisper] no build is pinned for ' + process.platform + ' - captions are heard by Groq only');
    return;
  }
  if (pinned()) { console.log(`[whisper] ${VERSION} (${RELEASE}) is already in vendor/whisper`); return; }

  const url = `https://github.com/ggml-org/whisper.cpp/releases/download/${RELEASE}/${ASSET.file}`;
  console.log(`[whisper] downloading ${ASSET.file} ${VERSION} (${(ASSET.size / 1048576).toFixed(1)} MiB) ...`);
  const res = await fetch(url, { signal: AbortSignal.timeout(10 * 60 * 1000) });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);

  fs.mkdirSync(DIR, { recursive: true });
  const zip = path.join(DIR, ASSET.file + '.part');
  const hash = crypto.createHash('sha256');
  await pipeline(
    Readable.fromWeb(res.body),
    async function* (chunks) { for await (const chunk of chunks) { hash.update(chunk); yield chunk; } },
    fs.createWriteStream(zip),
  );
  const got = hash.digest('hex');
  if (got !== ASSET.sha256 || fs.statSync(zip).size !== ASSET.size) {
    fs.rmSync(zip, { force: true });
    throw new Error(`${ASSET.file} does not match its pinned checksum (got ${got})`);
  }

  // Unpacked beside the zip under a temporary name, then swapped in, so a half-unpacked copy is never used.
  const unzipper = require('unzipper');
  const tmp = DIR + '.tmp';
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  const files = [];
  const archive = await unzipper.Open.file(zip);
  for (const entry of archive.files) {
    const name = path.basename(entry.path);
    if (entry.type !== 'File' || !/^Release[\\/]/.test(entry.path) || !KEEP.test(name)) continue;
    await pipeline(entry.stream(), fs.createWriteStream(path.join(tmp, name)));
    files.push(name);
  }
  fs.rmSync(zip, { force: true });
  if (!files.includes('whisper-cli.exe')) throw new Error('whisper-cli.exe is not in ' + ASSET.file);
  fs.writeFileSync(path.join(tmp, 'LICENSE.txt'), LICENSE);
  fs.writeFileSync(path.join(tmp, 'PINNED.json'), JSON.stringify({ release: RELEASE, version: VERSION, file: ASSET.file,
    sha256: ASSET.sha256, files: files.sort() }, null, 2));
  fs.rmSync(DIR, { recursive: true, force: true });
  fs.renameSync(tmp, DIR);
  console.log(`[whisper] ${VERSION} (${RELEASE}) is in vendor/whisper - ${files.length} files`);
}

main().catch((e) => {
  if (optional) {
    console.warn(`[whisper] not fetched: ${e.message}. Captions are heard by Groq only until `
      + '"node tools/fetch-whisper.js" succeeds.');
    return;
  }
  console.error(`[whisper] ${e.message}`);
  process.exitCode = 1;
});
