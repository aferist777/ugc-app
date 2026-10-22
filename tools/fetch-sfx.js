'use strict';

/* fetch-sfx.js - lays out the app's built-in sound set in vendor/sfx/ (phase V34.B; docs/local-app/PLAN.md "Фаза V34").

   npm install runs it (postinstall, with --optional: a missing archive is a warning, not a failed install).
   By hand, after moving the pin:
       node tools/fetch-sfx.js

   ONE archive, made by tools/build-sfx.js from tools/sfx-list.json (Kenney's audio packs and CC0 sounds of Freesound
   and Wikimedia Commons found through Openverse - trimmed, levelled, Opus) and KEPT IN GIT, in tools/sfx/ (the owner
   2026-10-22: "Cloudflare не трогать: архив набора звуков положить в репозиторий (git), fetch-sfx.js берёт его
   оттуда") - so nothing is downloaded. Pinned by size and SHA-256: an archive changed after the fact is refused.
   What it lays out:
       vendor/sfx/sfx.json                    the set: categories, and every sound's id, name, category, file, tags,
                                              duration, 64-point waveform, author, licence, page
       vendor/sfx/LICENSE.txt                 the licence (CC0 1.0) and the credits
       vendor/sfx/<category>/<id>.ogg         the sounds (Opus, 48 kHz)
   The set is part of the PROGRAM, not of a library: it is never exported, an update replaces it whole, and the app
   addresses a sound as /sfx/<category>/<id>.ogg (lib/sfx-builtin.js) - ids never change between versions, they are
   only added. vendor/ is not in git and ships with the build, like jassub and whisper. */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PIN = {
  version: 1,
  file: 'sfx/ugc-sfx-1.zip',
  bytes: 19609787,
  sha256: '4a05e2f72e095ceea96f4c108cd4a6151e08f3254e40e63d597d18cd31b4e3b9',
  sounds: 445,
};
const ARCHIVE = path.join(__dirname, PIN.file);
const DIR = path.join(__dirname, '..', 'vendor', 'sfx');
const MARK = path.join(DIR, 'PINNED.json');
const NAME = /^(?:sfx\.json|LICENSE\.txt|[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*\.ogg)$/;
const optional = process.argv.includes('--optional');

async function main() {
  try {
    if (JSON.stringify(JSON.parse(fs.readFileSync(MARK, 'utf8'))) === JSON.stringify(PIN)) { console.log('[sfx] sounds already in place'); return; }
  } catch (e) { /* not there yet */ }

  const buf = fs.readFileSync(ARCHIVE);
  if (buf.length !== PIN.bytes || crypto.createHash('sha256').update(buf).digest('hex') !== PIN.sha256) {
    throw new Error('not the pinned archive: ' + ARCHIVE);
  }
  const zip = await require('unzipper').Open.buffer(buf);
  const files = [];
  for (const e of zip.files) {
    if (e.type !== 'File') continue;
    if (!NAME.test(e.path)) throw new Error('the archive holds ' + e.path);
    files.push([e.path, await e.buffer()]);
  }
  const set = JSON.parse((files.find(([n]) => n === 'sfx.json') || [])[1] || 'null');
  const names = new Set(files.map(([n]) => n));
  if (!set || set.version !== PIN.version || set.sounds.length !== PIN.sounds) throw new Error('the archive is not set ' + PIN.version + ' of ' + PIN.sounds + ' sounds');
  for (const s of set.sounds) if (!names.has(s.file)) throw new Error('the archive lacks ' + s.file);

  // Laid out only once the archive checked whole: a bad one leaves the old copy as it was.
  fs.rmSync(DIR, { recursive: true, force: true });
  for (const [name, data] of files) {
    fs.mkdirSync(path.dirname(path.join(DIR, name)), { recursive: true });
    fs.writeFileSync(path.join(DIR, name), data);
  }
  fs.writeFileSync(MARK, JSON.stringify(PIN));
  console.log('[sfx] ' + PIN.sounds + ' sounds in ' + set.categories.length + ' categories laid out in ' + DIR);
}

main().catch((e) => {
  console[optional ? 'warn' : 'error']('[sfx] ' + e.message);
  if (!optional) process.exit(1);
});
