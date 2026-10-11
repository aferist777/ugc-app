'use strict';

/* fetch-yt-dlp.js - puts the yt-dlp the app ships with into vendor/yt-dlp/.

   npm install runs it (postinstall, with --optional: no network is a warning, not a failed
   install). By hand, after moving the pin:
       node tools/fetch-yt-dlp.js

   One build, the one for this platform, pinned by version AND by SHA-256. The hashes are copied
   from that release's SHA2-256SUMS, so an asset swapped on GitHub after the fact is refused
   rather than shipped. A copy already in place with the right hash is left alone.

   THE NIGHTLY CHANNEL (phase V27, the owner 2026-10-12): yt-dlp's own README calls it "the
   recommended channel for regular users" - the stable one comes out about once a month, and the
   sites it reads change faster than that. Nightly builds are released from their own repository,
   yt-dlp/yt-dlp-nightly-builds, with the same files and the same SHA2-256SUMS.

   To move the pin: the new nightly tag, and its SHA2-256SUMS lines for the three files below.
   This copy stays as it shipped; lib/ytdlp.js keeps a copy in the library current instead. */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');

const REPO = 'yt-dlp/yt-dlp-nightly-builds';
const VERSION = '2026.10.10.233141';
// lib/ytdlp.js looks for the same file names.
const BUILDS = {
  win32:  { file: 'yt-dlp.exe',   sha256: 'e7cafc44db8aa433da8dd78303b9157f2c1dd509c4cbfcd8418081b7e1d26a7a' },
  darwin: { file: 'yt-dlp_macos', sha256: 'c8ee97b3f6aa0fb5cbc3f56d772c0d79dc2c5d3d60f3bf0b240d5dd0d461fd25' },
  linux:  { file: 'yt-dlp_linux', sha256: '60606cef1a65d70f6639a85b45ebb7acf08dbb81831e134dd93939e23ca2b792' },
};
const DIR = path.join(__dirname, '..', 'vendor', 'yt-dlp');
const optional = process.argv.includes('--optional');

async function sha256(file) {
  const hash = crypto.createHash('sha256');
  await pipeline(fs.createReadStream(file), hash);
  return hash.digest('hex');
}

async function main() {
  const build = BUILDS[process.platform];
  if (!build) throw new Error(`no yt-dlp build is pinned for ${process.platform}`);
  const dest = path.join(DIR, build.file);
  if (fs.existsSync(dest) && await sha256(dest) === build.sha256) {
    console.log(`[yt-dlp] ${VERSION} is already in vendor/yt-dlp`);
    return;
  }

  const url = `https://github.com/${REPO}/releases/download/${VERSION}/${build.file}`;
  console.log(`[yt-dlp] downloading ${build.file} ${VERSION} ...`);
  const res = await fetch(url, { signal: AbortSignal.timeout(10 * 60 * 1000) });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);

  fs.mkdirSync(DIR, { recursive: true });
  const part = dest + '.part';
  const hash = crypto.createHash('sha256');
  await pipeline(
    Readable.fromWeb(res.body),
    async function* (chunks) { for await (const chunk of chunks) { hash.update(chunk); yield chunk; } },
    fs.createWriteStream(part),
  );
  const got = hash.digest('hex');
  if (got !== build.sha256) {
    fs.rmSync(part, { force: true });
    throw new Error(`${build.file} does not match its pinned checksum (got ${got})`);
  }
  fs.renameSync(part, dest);   // the same folder, so a rename is safe
  if (process.platform !== 'win32') fs.chmodSync(dest, 0o755);
  console.log(`[yt-dlp] ${VERSION} is in vendor/yt-dlp`);
}

main().catch((e) => {
  if (optional) {
    console.warn(`[yt-dlp] not fetched: ${e.message}. Links stay off until `
      + '"node tools/fetch-yt-dlp.js" succeeds.');
    return;
  }
  console.error(`[yt-dlp] ${e.message}`);
  process.exitCode = 1;
});
