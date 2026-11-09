'use strict';

/* release.js - a new version of UGC Studio for the owner's friends, through the owner's Cloudflare (phase V83, block
   B3; the owner 2026-11-09: (о4а) "я тестирую у себя на пк. и когда даю команду, что пора публиковать в cloudflare
   то публикуем и друзья получают обновление", (о7) versions 1.x.y with a git tag, (о12) notes from the commits that
   the owner corrects in Russian, (о14а) the signing key with no password, (о17) tags app-v<version>).

     node tools/release.js keygen                 the signing pair: the private key into %USERPROFILE%\.ugc-release\
                                                  (never in git, never inside this folder), the public one into
                                                  desktop/update-key.js - commit that file. Never makes a second pair.
     node tools/release.js notes                  docs/releases/<version>.md - a draft from the commits since the last
                                                  app-v tag, to be corrected before publishing
     node tools/release.js publish [--bump] [--important]
                                                  builds the version FROM THE LAST COMMIT (tools/build-app.js) with the
                                                  next sequence number, starts it once on an empty library in %TEMP%
                                                  (it must come up), sends the files the bucket does not have yet, then
                                                  the signed manifest - friends see it within six hours; tags git
                                                  app-v<version>. --bump raises package.json's patch number and commits
                                                  it first (a version is published once).
     node tools/release.js status                 what the channel holds
     node tools/release.js prune [--keep 3]       deletes the files no release among the last three uses

   Where: the bucket `ugc-updates` on the owner's Cloudflare - the account and the ONE Cloudflare key are READ from
   library/data/settings.json (the owner (о18): the key on Admin of the owner's library; nothing is written there).
   A stand: --store <folder> (the same layout in a folder), --keys <folder> (a throwaway pair), --worktree,
   --version-name, --update-url (baked into the build). The channel is `stable` (the owner (о4а): one channel). */

const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');

const UM = require('../lib/update-manifest');
const { createDirStore, createS3Store } = require('../lib/update-store');

const REPO = path.join(__dirname, '..');
const CHANNEL = 'stable';
const BUCKET = 'ugc-updates';
const DEFAULT_KEYS = path.join(os.homedir(), '.ugc-release');

const argv = process.argv.slice(2);
const cmd = argv[0];
const arg = (name, dflt) => { const i = argv.indexOf(name); return i > 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : dflt; };
const flag = (name) => argv.includes(name);
const say = (s) => console.log('[release] ' + s);

function git(args) {
  const r = spawnSync('git', args, { cwd: REPO, encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) throw new Error('git ' + args.join(' ') + ': ' + (r.stderr || '').trim());
  return r.stdout.trim();
}

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
  delete require.cache[require.resolve(file)];
  const now = { ...require(file), ...fields };
  const text = fs.readFileSync(file, 'utf8')
    .replace(/module\.exports = \{[\s\S]*\};\s*$/, `module.exports = {\n  PUBLIC_KEY: ${JSON.stringify(now.PUBLIC_KEY)},\n  WORKER_URL: ${JSON.stringify(now.WORKER_URL)},\n};\n`);
  fs.writeFileSync(file, text);
}

function keygen() {
  const dir = keysDir();
  if (path.resolve(dir).toLowerCase().startsWith(path.resolve(REPO).toLowerCase() + path.sep)) throw new Error('the private key must not lie inside the program folder');
  const f = path.join(dir, 'signing-key.pem');
  if (fs.existsSync(f)) throw new Error(`a signing key is there already (${f}) - a second one would cut every friend off`);
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

// ── Where ───────────────────────────────────────────────────────────────────
function store() {
  const dir = arg('--store', '');
  if (dir) return createDirStore(path.resolve(dir));
  const settingsFile = path.join(REPO, 'library', 'data', 'settings.json');
  let s = {};
  try { s = JSON.parse(fs.readFileSync(settingsFile, 'utf8')); } catch (e) { throw new Error('the owner\'s settings cannot be read: ' + settingsFile); }
  const token = String(s.cloudflareApiToken || '').trim();
  const tokenId = String(s.cloudflareTokenId || '').trim();
  const account = String(s.r2AccountId || '').trim();
  if (!token || !tokenId || !account) throw new Error('the Cloudflare key on Admin -> API keys has not passed its check (no token id or account)');
  return createS3Store({
    account, bucket: BUCKET,
    key: tokenId, secret: crypto.createHash('sha256').update(token).digest('hex'),
  });
}

// A few at once - the first release sends ten thousand files.
async function pool(items, n, fn) {
  let i = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; await fn(items[k], k); } });
  await Promise.all(workers);
}

// ── Notes ───────────────────────────────────────────────────────────────────
function lastTag() {
  try { return git(['describe', '--tags', '--match', 'app-v*', '--abbrev=0']); } catch (e) { return ''; }
}

function notes(version) {
  const v = version || JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8')).version;
  const since = lastTag();
  const log = git(['log', '--no-merges', '--pretty=%s', since ? `${since}..HEAD` : '-40']).split('\n')
    .filter((s) => s && !/^Docs:/i.test(s));
  const file = path.join(REPO, 'docs', 'releases', `${v}.md`);
  if (fs.existsSync(file)) { say(`${path.relative(REPO, file)} is there already - correct it, it is what friends read`); return file; }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `# UGC Studio ${v}\n\n<!-- Draft from the commits${since ? ' since ' + since : ''}: rewrite it in Russian, short, for a friend. -->\n\n`
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
  if (!ok) throw new Error('the built version did not come up on an empty library - nothing was published');
  say('the built version came up on an empty library');
}

// ── Publish ─────────────────────────────────────────────────────────────────
async function publish() {
  const st = store();
  const priv = readPrivate();
  const pub = publicOf(priv);
  const stand = !!arg('--store', '');
  if (!stand) {
    const appKey = String(require('../desktop/update-key').PUBLIC_KEY || '').trim();
    if (appKey !== pub.trim()) throw new Error('desktop/update-key.js does not hold the public half of this signing key - friends would refuse the update');
    if (git(['status', '--porcelain', '--', 'desktop', 'lib', 'routes', 'public', 'presets-src', 'server.js', 'package.json'])) {
      say('note: there are uncommitted changes - they are NOT in this release (it is built from the last commit)');
    }
  }

  // The channel as it is.
  const had = await st.get(UM.keys.channel(CHANNEL));
  const was = had ? UM.open(had, pub) : null;
  if (was) say(`the channel holds ${was.version} (seq ${was.seq})`);

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
  const version = arg('--version-name', '') || JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8')).version;
  if (!UM.VERSION_NAME.test(version)) throw new Error('not a version name: ' + version);
  if (await st.has(UM.keys.release(version)) >= 0) throw new Error(`${version} is published already - raise the version (--bump)`);
  const seq = (was ? was.seq : 0) + 1;

  // Built from the commit (a stand may take the folder as it is).
  const { build } = require('./build-app');
  const out = path.join(os.tmpdir(), 'ugcb', version);
  const urlKey = arg('--update-url', '');
  const b = build({ out, seq, channel: CHANNEL, worktree: stand && flag('--worktree'), version: arg('--version-name', ''),
    updateKey: stand ? pub : '', updateUrl: stand ? urlKey : '' });
  if (!flag('--no-smoke')) await smokeBuilt(out);

  // The files the bucket does not have yet.
  const list = JSON.parse(fs.readFileSync(path.join(out, 'resources', 'app', 'files.json'), 'utf8')).files;
  const byHash = new Map();
  for (const f of list) if (!byHash.has(f.h)) byHash.set(f.h, f);
  const z = new Map();
  let sent = 0, sentBytes = 0;
  const t0 = Date.now();
  await pool([...byHash.values()], stand ? 4 : 8, async (f) => {
    const key = UM.keys.blob(f.h);
    const size = await st.has(key);
    if (size >= 0) { z.set(f.h, size); return; }
    const gz = zlib.gzipSync(fs.readFileSync(path.join(out, ...f.p.split('/'))), { level: 6 });
    await st.put(key, gz, 'application/gzip');
    z.set(f.h, gz.length);
    sent++; sentBytes += gz.length;
    if (sent % 500 === 0) say(`${sent} files sent (${(sentBytes / 1048576).toFixed(0)} MB)`);
  });
  say(`${sent} new files sent (${(sentBytes / 1048576).toFixed(1)} MB), ${byHash.size - sent} were there; ${((Date.now() - t0) / 1000).toFixed(0)} s`);

  // The signed manifest - the release's first, then the channel's: friends see it from here on.
  const manifest = {
    app: UM.APP, channel: CHANNEL, platform: UM.PLATFORM, seq, version, commit: b.info.commit, date: b.info.date,
    format: b.info.format, important: flag('--important'), notes: notesText(version),
    files: list.map((f) => ({ p: f.p, h: f.h, s: f.s, z: z.get(f.h) })),
  };
  const env = UM.seal(manifest, priv);
  UM.open(env, pub);
  await st.put(UM.keys.release(version), env, 'application/json');
  await st.put(UM.keys.channel(CHANNEL), env, 'application/json');
  say(`published ${version} (seq ${seq}) to ${st.where}`);

  if (!stand) {
    try { git(['tag', `app-v${version}`, b.info.commit]); say(`tagged app-v${version}`); } catch (e) { say('not tagged: ' + e.message); }
  }
  return { version, seq, sent, sentBytes, out };
}

async function status() {
  const st = store();
  const pub = publicOf(readPrivate());
  const had = await st.get(UM.keys.channel(CHANNEL));
  if (!had) { say('the channel is empty'); return null; }
  const m = UM.open(had, pub);
  say(`${CHANNEL}: ${m.version} (seq ${m.seq}, ${m.date}, ${m.files.length} files${m.important ? ', important' : ''})`);
  const rel = await st.list('releases/');
  say(`releases: ${rel.map((r) => r.key.split('/')[1]).join(', ')}`);
  return m;
}

async function prune() {
  const st = store();
  const pub = publicOf(readPrivate());
  const keep = Math.max(1, Number(arg('--keep', '3')) || 3);
  const rels = [];
  for (const r of await st.list('releases/')) {
    try { rels.push(UM.open(await st.get(r.key), pub)); } catch (e) { say(`${r.key} is not readable - its files are kept`); return; }
  }
  rels.sort((a, b) => b.seq - a.seq);
  const kept = rels.slice(0, keep);
  const chan = await st.get(UM.keys.channel(CHANNEL));
  if (chan) kept.push(UM.open(chan, pub));
  const used = new Set(kept.flatMap((m) => m.files.map((f) => f.h)));
  const blobs = await st.list('blobs/');
  const drop = blobs.filter((b) => !used.has(b.key.slice('blobs/'.length)));
  await pool(drop, 8, (b) => st.del(b.key));
  say(`kept the files of ${kept.map((m) => m.version).filter((v, i, a) => a.indexOf(v) === i).join(', ')}; ${drop.length} files deleted (${(drop.reduce((s, b) => s + b.size, 0) / 1048576).toFixed(1)} MB)`);
  return drop.length;
}

async function main() {
  if (cmd === 'keygen') return keygen();
  if (cmd === 'notes') return notes();
  if (cmd === 'publish') return publish();
  if (cmd === 'status') return status();
  if (cmd === 'prune') return prune();
  console.log('node tools/release.js keygen | notes | publish [--bump] [--important] | status | prune [--keep 3]');
  return null;
}

if (require.main === module) {
  main().catch((e) => { console.error('[release] ' + e.message); process.exit(1); });
}

module.exports = { publicOf, store, notes };
