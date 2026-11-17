'use strict';

/* release.js - a new version of UGC Studio on the program's GitHub Releases: built and tested on this computer,
   uploaded on command; each tagged app-v<version>; notes drafted from the commits and corrected by hand; the signing key
   has no password.

     node tools/release.js keygen                 the signing pair: the private key into %USERPROFILE%\.ugc-release\
                                                  (never in git, never inside this folder), the public one into
                                                  desktop/update-key.js - commit that file. Never makes a second pair.
     node tools/release.js notes                  docs/releases/<version>.md - a draft from the commits since the last
                                                  app-v tag, to be rewritten before publishing: it is the release page
                                                  and what the update window shows
     node tools/release.js publish [--bump] [--important] [--seq <n>]
                                                  builds the version FROM THE LAST COMMIT (tools/build-app.js) with the
                                                  next sequence number (the published one's + 1, or --seq), starts it
                                                  once on an empty library in %TEMP% (it must come up), searches it for
                                                  your keys, then lays out the release in %LOCALAPPDATA%\ugc-release\
                                                  <version>\: the zip a person unpacks, the signed manifest of what is in
                                                  it and where (lib/update-manifest.js), the notes. Tags git
                                                  app-v<version>. --bump raises package.json's patch number and commits
                                                  it first (a version is published once). Nothing is sent.
     node tools/release.js upload [--target <commit>] [--history <folder>]
                                                  the laid-out release onto GitHub (`gh release create`, the repository
                                                  of desktop/update-key.js RELEASES): the tag on the PUBLIC commit -
                                                  --target, or the one tools/publish-history.js made of the release's
                                                  commit (its commits.txt, %TEMP%\ugc-public by default). Installed copies
                                                  see it within six hours.
     node tools/release.js status                 what GitHub's latest release is, and the releases laid out here

   A stand: --keys <folder> (a throwaway pair), --update-url <releases address> (baked into the build; publish reads the
   published sequence number there), --worktree, --version-name, --no-smoke, --out <folder> (instead of
   %LOCALAPPDATA%\ugc-release); `upload --dir <folder>` puts the release into a folder tools/fake-releases.js serves. */

const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');

const UM = require('../lib/update-manifest');

const REPO = path.join(__dirname, '..');
const DEFAULT_KEYS = path.join(os.homedir(), '.ugc-release');
const FOLDER = 'UGC Studio';

const argv = process.argv.slice(2);
const cmd = argv[0];
const arg = (name, dflt) => { const i = argv.indexOf(name); return i > 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : dflt; };
const flag = (name) => argv.includes(name);
const say = (s) => console.log('[release] ' + s);
const mb = (b) => (b / 1048576).toFixed(1);

function git(args) {
  const r = spawnSync('git', args, { cwd: REPO, encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) throw new Error('git ' + args.join(' ') + ': ' + (r.stderr || '').trim());
  return r.stdout.trim();
}

const appKey = () => { const f = require.resolve('../desktop/update-key'); delete require.cache[f]; return require(f); };
const releasesUrl = () => (arg('--update-url', '') || appKey().RELEASES || '').replace(/\/+$/, '');
const outRoot = () => path.resolve(arg('--out', path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'ugc-release')));
const versionOf = () => arg('--version-name', '') || JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8')).version;

// ── Keys ────────────────────────────────────────────────────────────────────
const keysDir = () => path.resolve(arg('--keys', DEFAULT_KEYS));
const publicOf = (privatePem) => crypto.createPublicKey(privatePem).export({ type: 'spki', format: 'pem' });

function readPrivate() {
  const f = path.join(keysDir(), 'signing-key.pem');
  if (!fs.existsSync(f)) throw new Error(`no signing key in ${keysDir()} - run "node tools/release.js keygen" once`);
  return fs.readFileSync(f, 'utf8');
}

function writeAppKey(fields) {
  const file = path.join(REPO, 'desktop', 'update-key.js');
  const now = { ...appKey(), ...fields };
  const text = fs.readFileSync(file, 'utf8')
    .replace(/module\.exports = \{[\s\S]*\};\s*$/, `module.exports = {\n  PUBLIC_KEY: ${JSON.stringify(now.PUBLIC_KEY || '')},\n  RELEASES: ${JSON.stringify(now.RELEASES || '')},\n};\n`);
  fs.writeFileSync(file, text);
}

function keygen() {
  const dir = keysDir();
  if (path.resolve(dir).toLowerCase().startsWith(path.resolve(REPO).toLowerCase() + path.sep)) throw new Error('the private key must not lie inside the program folder');
  const f = path.join(dir, 'signing-key.pem');
  if (fs.existsSync(f)) throw new Error(`a signing key is there already (${f}) - a second one would cut every installed copy off`);
  const pair = UM.keyPair();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(f, pair.privateKey, { mode: 0o600 });
  fs.writeFileSync(path.join(dir, 'public.pem'), pair.publicKey);
  if (!flag('--keys')) {
    writeAppKey({ PUBLIC_KEY: pair.publicKey });
    say('the public key is in desktop/update-key.js - commit it');
  }
  say(`the private key: ${f} - copy it onto a flash drive and keep it there; it is never sent anywhere`);
}

// ── Notes ───────────────────────────────────────────────────────────────────
function lastTag() {
  try { return git(['describe', '--tags', '--match', 'app-v*', '--abbrev=0']); } catch (e) { return ''; }
}

function notes(version) {
  const v = version || versionOf();
  const since = lastTag();
  const log = git(['log', '--no-merges', '--pretty=%s', since ? `${since}..HEAD` : '-40']).split('\n')
    .filter((s) => s && !/^Docs:/i.test(s));
  const file = path.join(REPO, 'docs', 'releases', `${v}.md`);
  if (fs.existsSync(file)) { say(`${path.relative(REPO, file)} is there already - correct it, it is the release page`); return file; }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `# UGC Studio ${v}\n\n<!-- Draft from the commits${since ? ' since ' + since : ''}: rewrite it - short, in English; it is the release page and the update window. -->\n\n`
    + log.map((s) => `- ${s}`).join('\n') + '\n');
  say(`draft: ${path.relative(REPO, file)} (${log.length} commits) - rewrite it before publishing`);
  return file;
}

function notesText(version) {
  const file = path.join(REPO, 'docs', 'releases', `${version}.md`);
  if (!fs.existsSync(file)) return '';
  return fs.readFileSync(file, 'utf8').replace(/<!--[\s\S]*?-->/g, '').replace(/^# .*\n/, '').trim();
}

// ── The built version comes up ──────────────────────────────────────────────
// On an empty library in %TEMP%, as `node`-run server.js of the build would not show the shell's part: the exe itself,
// its server answering. Then it is closed and the library deleted.
async function smokeBuilt(out) {
  const lib = fs.mkdtempSync(path.join(os.tmpdir(), 'ugcr-'));
  const exe = path.join(out, 'UGC Studio.exe');
  const env = { ...process.env, UGC_DATA_DIR: lib };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(exe, [], { cwd: out, env, stdio: 'ignore', windowsHide: true });
  const logf = path.join(lib, 'logs', 'app.log');
  let url = '';
  for (let i = 0; i < 240 && !url; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const m = /the server is up at (http:\/\/127\.0\.0\.1:\d+)/.exec((() => { try { return fs.readFileSync(logf, 'utf8'); } catch (e) { return ''; } })());
    if (m) url = m[1];
  }
  let ok = false;
  if (url) { try { ok = (await fetch(url + '/api/ui-state')).ok && (await fetch(url + '/home')).ok; } catch (e) { ok = false; } }
  spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
  await new Promise((r) => setTimeout(r, 1500));
  try { fs.rmSync(lib, { recursive: true, force: true, maxRetries: 5 }); } catch (e) { /* %TEMP% */ }
  if (!ok) throw new Error('the built version did not come up on an empty library - nothing was laid out');
  say('the built version came up on an empty library');
}

// ── The zip ─────────────────────────────────────────────────────────────────
const HOW_TO = (version) => [
  `UGC Studio ${version} - how to start`,
  '',
  '1. Put the folder "UGC Studio" somewhere of your own, for example C:\\UGC Studio - not inside a folder OneDrive',
  '   syncs (the Desktop and Documents often are): your library will grow to gigabytes.',
  '2. Open "UGC Studio.exe" in it. The program is not signed, so Windows may say "Windows protected your PC":',
  '   press "More info", then "Run anyway". The first start can take up to a minute.',
  '3. In the app, open Admin -> API keys and enter your own keys (Guide, chapter 12 "Keys and prices", says which).',
  '4. Updates come by themselves: when a new version is downloaded, a chip "Update ..." appears in the top strip -',
  '   press it, then "Restart and update".',
  '',
  'The folder "library" (made at the first start) is yours: everything you make is kept in it.',
  'The folders "versions" and "updates" are the program and its updates.',
  'From an older copy: close it, delete its folder "updates" (only the old updates\' own files), then unpack this zip into',
  'the folder that HOLDS the old "UGC Studio" (C:\\ for C:\\UGC Studio) - the two "UGC Studio" folders merge; replace the',
  'files when asked. "library" stays where it is.',
  'If something does not start, the logs are updates\\launcher.log and library\\logs\\app.log.',
  '',
].join('\r\n');

function makeZip(zipFile, entries) {
  const archiver = require('archiver');
  return new Promise((resolve, reject) => {
    const sink = fs.createWriteStream(zipFile);
    const a = archiver('zip', { zlib: { level: 6 } });
    sink.on('close', resolve);
    sink.on('error', reject);
    a.on('error', reject);
    a.on('warning', reject);
    a.pipe(sink);
    for (const e of entries) {
      if (e.file) a.file(e.file, { name: e.name });
      else a.append(e.data, { name: e.name });
    }
    a.finalize();
  });
}

/** Where each entry's bytes lie in a zip: name -> { o, z, m, s } (no zip64 - a release is far below 4 GB). */
function zipIndex(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const tailLen = Math.min(size, 65557);
    const tail = Buffer.alloc(tailLen);
    fs.readSync(fd, tail, 0, tailLen, size - tailLen);
    let e = -1;
    for (let i = tailLen - 22; i >= 0; i--) if (tail.readUInt32LE(i) === 0x06054b50) { e = i; break; }
    if (e < 0) throw new Error('the zip has no end record');
    const count = tail.readUInt16LE(e + 10);
    const cdSize = tail.readUInt32LE(e + 12);
    const cdOff = tail.readUInt32LE(e + 16);
    if (count === 0xffff || cdOff === 0xffffffff || cdSize === 0xffffffff) throw new Error('the zip is a zip64 - not read here');
    const cd = Buffer.alloc(cdSize);
    fs.readSync(fd, cd, 0, cdSize, cdOff);
    const lh = Buffer.alloc(30);
    const entries = new Map();
    for (let p = 0, k = 0; k < count; k++) {
      if (cd.readUInt32LE(p) !== 0x02014b50) throw new Error('the zip\'s directory is broken');
      const m = cd.readUInt16LE(p + 10);
      const z = cd.readUInt32LE(p + 20);
      const s = cd.readUInt32LE(p + 24);
      const n = cd.readUInt16LE(p + 28);
      const x = cd.readUInt16LE(p + 30);
      const c = cd.readUInt16LE(p + 32);
      const off = cd.readUInt32LE(p + 42);
      const name = cd.toString('utf8', p + 46, p + 46 + n);
      fs.readSync(fd, lh, 0, 30, off);
      if (lh.readUInt32LE(0) !== 0x04034b50) throw new Error('the zip\'s entry has no header: ' + name);
      entries.set(name, { o: off + 30 + lh.readUInt16LE(26) + lh.readUInt16LE(28), z, m, s });
      p += 46 + n + x + c;
    }
    return { size, entries };
  } finally {
    fs.closeSync(fd);
  }
}

/** Every file of the manifest read back from the zip the way the updater reads it - its sha256 must be the one listed. */
function checkZip(zipFile, files) {
  const fd = fs.openSync(zipFile, 'r');
  try {
    for (const f of files) {
      const raw = Buffer.allocUnsafe(f.z);
      fs.readSync(fd, raw, 0, f.z, f.o);
      const data = f.m === 8 ? zlib.inflateRawSync(raw) : raw;
      if (crypto.createHash('sha256').update(data).digest('hex') !== f.h) throw new Error('the zip does not give back ' + f.p);
    }
  } finally {
    fs.closeSync(fd);
  }
}

// ── What is published ───────────────────────────────────────────────────────
async function published(pub) {
  const base = releasesUrl();
  if (!base) return null;
  const r = await fetch(`${base}/latest/download/${UM.MANIFEST}`, { signal: AbortSignal.timeout(30000) });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`${base} answered ${r.status}`);
  return UM.open(Buffer.from(await r.arrayBuffer()), pub);
}

// ── Publish: the release laid out here ──────────────────────────────────────
async function publish() {
  const priv = readPrivate();
  const pub = publicOf(priv);
  const stand = !!arg('--update-url', '');
  if (!stand) {
    if (String(appKey().PUBLIC_KEY || '').trim() !== pub.trim()) throw new Error('desktop/update-key.js does not hold the public half of this signing key - installed copies would refuse the update');
    if (!appKey().RELEASES) throw new Error('desktop/update-key.js names no RELEASES page');
    if (git(['status', '--porcelain', '--', 'desktop', 'lib', 'routes', 'public', 'server.js', 'package.json'])) {
      say('note: there are uncommitted changes - they are NOT in this release (it is built from the last commit)');
    }
  }

  let was = null;
  try { was = await published(pub); } catch (e) {
    if (!arg('--seq', '')) throw new Error(`the published release cannot be read (${e.message}) - give --seq <n>`);
    say(`note: the published release cannot be read (${e.message}) - seq ${arg('--seq', '')} as given`);
  }
  if (was) say(`the latest published release is ${was.version} (seq ${was.seq})`);
  if (flag('--bump')) {
    const pf = path.join(REPO, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pf, 'utf8'));
    const parts = String(pkg.version).split('.').map(Number);
    parts[2] = (parts[2] || 0) + 1;
    pkg.version = parts.join('.');
    fs.writeFileSync(pf, JSON.stringify(pkg, null, 2) + '\n');
    git(['commit', '-m', `Release ${pkg.version}`, '--', 'package.json']);
    say(`package.json -> ${pkg.version}, committed`);
  }
  const version = versionOf();
  if (!UM.VERSION_NAME.test(version)) throw new Error('not a version name: ' + version);
  if (was && was.version === version) throw new Error(`${version} is published already - raise the version (--bump)`);
  const seq = Number(arg('--seq', '')) || (was ? was.seq : 0) + 1;
  if (was && seq <= was.seq) throw new Error(`seq ${seq} is not above the published ${was.seq}`);

  // Built from the commit (a stand may take the folder as it is).
  const { build } = require('./build-app');
  const out = path.join(os.tmpdir(), 'ugcb', version);
  const b = build({ out, seq, channel: 'stable', worktree: stand && flag('--worktree'), version: arg('--version-name', ''),
    updateKey: stand ? pub : '', updateUrl: stand ? releasesUrl() : '' });
  if (!flag('--no-smoke')) await smokeBuilt(out);
  // No key of the publisher's in the program that goes out.
  const KS = require('./key-scan');
  if (!KS.report(KS.scan([out]), say)) throw new Error('a key of yours is in the built program - nothing was laid out');

  // The zip: UGC Studio\ - the launcher, versions\<version>\ and versions\current.json, the how-to.
  const dir = path.join(outRoot(), version);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const zipFile = path.join(dir, UM.zipName(version));
  const own = JSON.parse(fs.readFileSync(path.join(out, 'resources', 'app', 'files.json'), 'utf8'));
  const list = own.files;
  const inVersion = (p) => `${FOLDER}/versions/${version}/${p}`;
  const t0 = Date.now();
  await makeZip(zipFile, [
    { name: `${FOLDER}/UGC Studio.exe`, file: path.join(out, 'resources', 'app', 'launcher', 'UGC Studio.exe') },
    { name: `${FOLDER}/How to start.txt`, data: Buffer.from(HOW_TO(version), 'utf8') },
    { name: `${FOLDER}/versions/current.json`, data: Buffer.from(JSON.stringify({ current: version, previous: null, tries: 0, bad: [] })) },
    ...list.map((f) => ({ name: inVersion(f.p), file: path.join(out, ...f.p.split('/')) })),
    { name: inVersion('resources/app/files.json'), file: path.join(out, 'resources', 'app', 'files.json') },
  ]);
  const idx = zipIndex(zipFile);
  say(`${path.basename(zipFile)}: ${idx.entries.size} entries, ${mb(idx.size)} MB, ${((Date.now() - t0) / 1000).toFixed(0)} s`);

  const files = list.map((f) => {
    const e = idx.entries.get(inVersion(f.p));
    if (!e || e.s !== f.s) throw new Error('the zip does not hold ' + f.p + ' as built');
    return { p: f.p, h: f.h, s: f.s, o: e.o, z: e.z, m: e.m };
  });
  checkZip(zipFile, files);
  say('every file reads back from the zip by its place, sha256 as built');

  const manifest = {
    app: UM.APP, platform: UM.PLATFORM, seq, version, tag: UM.tagOf(version), commit: b.info.commit, date: b.info.date,
    format: b.info.format, important: flag('--important'), notes: notesText(version),
    zip: { name: path.basename(zipFile), size: idx.size }, files,
  };
  const env = UM.seal(manifest, priv);
  UM.open(env, pub);
  fs.writeFileSync(path.join(dir, UM.MANIFEST), env);
  fs.writeFileSync(path.join(dir, 'notes.md'), (notesText(version) || `UGC Studio ${version}`) + '\n');
  say(`laid out ${version} (seq ${seq}, commit ${b.info.commit.slice(0, 12)}) in ${dir} - nothing sent; "upload" puts it on GitHub`);

  if (!stand) {
    try { git(['tag', UM.tagOf(version), b.info.commit]); say(`tagged ${UM.tagOf(version)}`); } catch (e) { say('not tagged: ' + e.message); }
  }
  return { version, seq, dir, zip: zipFile, out };
}

// ── Upload: the laid-out release onto GitHub (or a stand's folder) ──────────
function laidOut(version) {
  const dir = path.join(outRoot(), version);
  const env = path.join(dir, UM.MANIFEST);
  if (!fs.existsSync(env)) throw new Error(`no release of ${version} is laid out in ${dir} - "publish" first`);
  const m = UM.open(fs.readFileSync(env), publicOf(readPrivate()));
  const zip = path.join(dir, m.zip.name);
  if (!fs.existsSync(zip) || fs.statSync(zip).size !== m.zip.size) throw new Error(`${zip} is not the zip the manifest names`);
  return { dir, m, env, zip, notes: path.join(dir, 'notes.md') };
}

function gh(args) {
  const r = spawnSync('gh', args, { cwd: REPO, encoding: 'utf8', windowsHide: true, maxBuffer: 1 << 24 });
  if (r.error) throw r.error;
  return r;
}

async function upload() {
  const version = argv[1] && !argv[1].startsWith('--') ? argv[1] : versionOf();
  const { m, env, zip, notes: notesFile } = laidOut(version);

  const to = arg('--dir', '');
  if (to) {
    const d = path.join(path.resolve(to), m.tag);
    fs.mkdirSync(d, { recursive: true });
    fs.copyFileSync(zip, path.join(d, m.zip.name));
    fs.copyFileSync(env, path.join(d, UM.MANIFEST));
    fs.writeFileSync(path.join(path.resolve(to), 'latest.txt'), m.tag);
    say(`${m.tag} put into ${d} - the latest there`);
    return m;
  }

  const hit = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/releases$/.exec(releasesUrl());
  if (!hit) throw new Error('desktop/update-key.js RELEASES is not a GitHub releases page: ' + releasesUrl());
  const repo = hit[1];
  let target = arg('--target', '');
  if (!target) {
    const map = path.join(path.resolve(arg('--history', path.join(os.tmpdir(), 'ugc-public'))), 'commits.txt');
    if (!fs.existsSync(map)) throw new Error(`no ${map} - run tools/publish-history.js first, or give --target <public commit>`);
    const line = fs.readFileSync(map, 'utf8').split('\n').find((l) => l.startsWith(m.commit + ' '));
    if (!line) throw new Error(`the release's commit ${m.commit.slice(0, 12)} is not in ${map} - publish the history from it first`);
    target = line.split(' ')[1].trim();
  }
  if (gh(['release', 'view', m.tag, '--repo', repo]).status === 0) throw new Error(`${repo} has a release ${m.tag} already`);
  say(`${m.tag} -> ${repo} at ${target.slice(0, 12)}: ${path.basename(zip)} (${mb(m.zip.size)} MB) and ${UM.MANIFEST}`);
  const r = gh(['release', 'create', m.tag, zip, env, '--repo', repo, '--target', target,
    '--title', `UGC Studio ${m.version}`, '--notes-file', notesFile]);
  if (r.status !== 0) throw new Error('gh release create: ' + (r.stderr || r.stdout || '').trim());
  say((r.stdout || '').trim());

  // What installed copies will read.
  const now = await published(publicOf(readPrivate()));
  if (!now || now.seq !== m.seq) throw new Error(`GitHub's latest release does not answer ${m.version} yet (${now ? now.version : 'none'})`);
  say(`installed copies read ${now.version} (seq ${now.seq}) from ${releasesUrl()}`);
  return m;
}

async function status() {
  const pub = publicOf(readPrivate());
  const m = await published(pub);
  say(m ? `${releasesUrl()}: ${m.version} (seq ${m.seq}, ${m.date}, ${m.files.length} files, zip ${mb(m.zip.size)} MB${m.important ? ', important' : ''})`
    : `${releasesUrl()}: nothing published`);
  let here = [];
  try { here = fs.readdirSync(outRoot()).filter((d) => fs.existsSync(path.join(outRoot(), d, UM.MANIFEST))); } catch (e) { here = []; }
  say(`laid out in ${outRoot()}: ${here.join(', ') || 'none'}`);
  return m;
}

async function main() {
  if (cmd === 'keygen') return keygen();
  if (cmd === 'notes') return notes();
  if (cmd === 'publish') return publish();
  if (cmd === 'upload') return upload();
  if (cmd === 'status') return status();
  console.log('node tools/release.js keygen | notes | publish [--bump] [--important] [--seq <n>] | upload [--target <commit>] | status');
  return null;
}

if (require.main === module) {
  main().catch((e) => { console.error('[release] ' + e.message); process.exit(1); });
}

module.exports = { publicOf, notes, zipIndex, checkZip, makeZip };
