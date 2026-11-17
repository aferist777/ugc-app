'use strict';

/* key-scan.js - no key of the publisher's leaves this computer in what is handed out or released.

       node tools/key-scan.js <folder> [<folder> ...]

   What is looked for - by VALUE, never printed:
     keys     every value of a field named like a key, token, secret or password in the publisher's library/data/settings.json,
              library/data/telegram.json, local-data/data/settings.json and local-data/.env, and each one's SHA-256 (the R2
              secret is the SHA-256 of the Cloudflare token); and the shapes of known keys (sk-ant-, r8_, gsk_, AKIA, ghp_,
              AIza, a PEM private key)
     links    the publisher's Cloudflare account id and the public address of the publisher's bucket - not secrets, but
              the publisher's; said, not refused
     paths    this computer's user folder (C:\Users\<name>) - said, not refused
   A media file (pictures, video, sound, fonts, models) is not read: no key is in one. Used by tools/release.js
   (handoff, publish): one of the publisher's keys found stops it, anywhere; a key's SHAPE stops it in our code and in the
   library, and is only said in third-party files - node_modules, vendor and the runtime's .exe / .dll - where public
   examples have it (dotenv's README, a presigned link in ffmpeg-static's install.js, TLS strings in ffmpeg and Electron). */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const REPO = path.join(__dirname, '..');
const NAME = /key|token|secret|pass|auth|cred|sid|bearer/i;
const SKIP = /\.(mp4|mov|mkv|webm|m4v|avi|jpe?g|png|webp|gif|bmp|ico|heic|avif|mp3|wav|m4a|aac|ogg|oga|flac|opus|ttf|otf|woff2?|tflite|task|wasm|glb|gltf|bin|zip|gz|7z|pak|dat)$/i;
const THIRD = /[\\/](node_modules|vendor)[\\/]|\.(exe|dll|node)$/i;
const SHAPES = /(sk-ant-[A-Za-z0-9_-]{10,}|r8_[A-Za-z0-9]{20,}|gsk_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{30,}|AIza[0-9A-Za-z_-]{30,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/;

const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, '')); } catch (e) { return null; } };

/** What is looked for: [{ value, what, kind }] - `what` names the field, never the value. */
function targets() {
  const out = [];
  const seen = new Set();
  const add = (value, what, kind) => {
    const v = String(value || '').trim();
    if (v.length < 8 || /\s/.test(v) || seen.has(v)) return;
    seen.add(v);
    out.push({ value: v, what, kind });
  };
  const walk = (v, p, file) => {
    if (v && typeof v === 'object') { for (const k of Object.keys(v)) walk(v[k], p ? `${p}.${k}` : k, file); return; }
    if (typeof v === 'string' && NAME.test(p)) add(v, `${file}: ${p}`, 'key');
  };
  for (const f of ['library/data/settings.json', 'library/data/telegram.json', 'local-data/data/settings.json', 'local-data/data/telegram.json']) {
    const j = readJson(path.join(REPO, f));
    if (j) walk(j, '', f);
  }
  try {
    for (const line of fs.readFileSync(path.join(REPO, 'local-data', '.env'), 'utf8').split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.+)$/.exec(line);
      if (m && NAME.test(m[1])) add(m[2], `local-data/.env: ${m[1]}`, 'key');
    }
  } catch (e) { /* none */ }
  for (const t of out.slice()) add(crypto.createHash('sha256').update(t.value).digest('hex'), `${t.what} (its SHA-256)`, 'key');
  const s = readJson(path.join(REPO, 'library', 'data', 'settings.json')) || {};
  add(s.r2AccountId, 'the Cloudflare account id', 'link');
  const pub = String(s.r2PublicBase || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  add(pub, 'the bucket\'s public address', 'link');
  add(os.homedir(), 'this computer\'s user folder', 'path');
  add(os.homedir().replace(/\\/g, '/'), 'this computer\'s user folder', 'path');
  add(os.homedir().replace(/\\/g, '\\\\'), 'this computer\'s user folder', 'path');
  return out;
}

/** Every file under the roots read once; answers { files, keys: [{ file, what }], links, paths, shapes }. */
function scan(roots, { list = targets() } = {}) {
  const found = { files: 0, keys: [], links: [], paths: [], shapes: [], thirdParty: [] };
  const walk = (dir) => {
    let ents = [];
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const e of ents) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) { walk(abs); continue; }
      if (!e.isFile() || SKIP.test(e.name)) continue;
      let buf;
      try { buf = fs.readFileSync(abs); } catch (err) { continue; }
      found.files++;
      const text = buf.toString('latin1');
      for (const t of list) {
        if (!text.includes(t.value)) continue;
        const row = { file: abs, what: t.what };
        if (t.kind === 'key') found.keys.push(row);
        else if (t.kind === 'link') found.links.push(row);
        else found.paths.push(row);
      }
      const m = SHAPES.exec(text);
      if (m) (THIRD.test(abs) ? found.thirdParty : found.shapes).push({ file: abs, what: m[0].slice(0, 8) + '…' });
    }
  };
  for (const r of roots) walk(path.resolve(r));
  return found;
}

function report(found, say = console.log) {
  say(`[keys] ${found.files} files read: ${found.keys.length} keys, ${found.shapes.length} key shapes, `
    + `${found.links.length} links to your Cloudflare, ${found.paths.length} paths of this computer`
    + (found.thirdParty.length ? `; ${found.thirdParty.length} key-like strings in third-party files (public examples, not ours)` : ''));
  for (const r of [...found.keys, ...found.shapes].slice(0, 20)) say(`[keys]   KEY ${r.what} in ${r.file}`);
  for (const r of found.links.slice(0, 10)) say(`[keys]   link: ${r.what} in ${r.file}`);
  for (const r of found.paths.slice(0, 10)) say(`[keys]   path: ${r.what} in ${r.file}`);
  return !found.keys.length && !found.shapes.length;
}

if (require.main === module) {
  const roots = process.argv.slice(2);
  if (!roots.length) { console.log('node tools/key-scan.js <folder> [<folder> ...]'); process.exit(2); }
  process.exit(report(scan(roots)) ? 0 : 1);
}

module.exports = { targets, scan, report };
