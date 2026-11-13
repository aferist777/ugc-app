'use strict';

/* fetch-patterns.js - lays out the app's built-in pattern set in vendor/patterns/, as fetch-sfx.js lays out the sounds.

   npm install runs it (postinstall, with --optional: a missing archive is a warning, not a failed install).
   By hand, after moving the pin:
       node tools/fetch-patterns.js

   ONE archive, made by tools/build-patterns.js from tools/patterns-list.json and KEPT IN GIT, in tools/patterns/ - so
   nothing is downloaded. Pinned by size and SHA-256: an archive changed after the fact is refused.
   What it lays out:
       vendor/patterns/patterns.json          the set: every pattern's id, name, file, thumb, size (2160 or 1080 px),
                                              author, licence, source, page, what was changed
       vendor/patterns/LICENSE.txt            the credits (Hero Patterns CC BY 4.0, the CC0 authors)
       vendor/patterns/<id>.png               the seamless tiles, white on transparent
       vendor/patterns/thumbs/<id>.webp       the gallery's tiles
   The set is part of the PROGRAM, not of a library: it is never copied into one, an update replaces it whole, and the
   app addresses a pattern as /patterns/<id>.png (lib/patterns-builtin.js) - ids never change between versions. */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PIN = {
  version: 1,
  file: 'patterns/ugc-patterns-1.zip',
  bytes: 18585016,
  sha256: 'ee2388164de2216c686478472fe0a24b49a3503ec537e402199c664a1352c51b',
  patterns: 25,
};
const ARCHIVE = path.join(__dirname, PIN.file);
const DIR = path.join(__dirname, '..', 'vendor', 'patterns');
const MARK = path.join(DIR, 'PINNED.json');
const NAME = /^(?:patterns\.json|LICENSE\.txt|[a-z0-9]+(?:-[a-z0-9]+)*\.png|thumbs\/[a-z0-9]+(?:-[a-z0-9]+)*\.webp)$/;
const optional = process.argv.includes('--optional');

async function main() {
  try {
    if (JSON.stringify(JSON.parse(fs.readFileSync(MARK, 'utf8'))) === JSON.stringify(PIN)) { console.log('[patterns] patterns already in place'); return; }
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
  const set = JSON.parse((files.find(([n]) => n === 'patterns.json') || [])[1] || 'null');
  const names = new Set(files.map(([n]) => n));
  if (!set || set.version !== PIN.version || set.patterns.length !== PIN.patterns) throw new Error('the archive is not set ' + PIN.version + ' of ' + PIN.patterns + ' patterns');
  for (const p of set.patterns) if (!names.has(p.file) || !names.has(p.thumb)) throw new Error('the archive lacks ' + p.id);

  // Laid out only once the archive checked whole: a bad one leaves the old copy as it was.
  fs.rmSync(DIR, { recursive: true, force: true });
  for (const [name, data] of files) {
    fs.mkdirSync(path.dirname(path.join(DIR, name)), { recursive: true });
    fs.writeFileSync(path.join(DIR, name), data);
  }
  fs.writeFileSync(MARK, JSON.stringify(PIN));
  console.log('[patterns] ' + PIN.patterns + ' patterns laid out in ' + DIR);
}

main().catch((e) => {
  console[optional ? 'warn' : 'error']('[patterns] ' + e.message);
  if (!optional) process.exit(1);
});
