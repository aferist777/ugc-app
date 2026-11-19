'use strict';

/* build-app.js - a VERSION FOLDER of the app, the one an installed copy's launcher runs and the updater fills - by a
   script of its own: no electron-builder, every step here.

       node tools/build-app.js [--out <folder>] [--seq <n>] [--channel stable] [--worktree]

   --worktree takes the app's files from the folder as they are (a check before a commit; its version.json says
   "<commit>+worktree") - a release is always built from the commit.

   What it makes (default %TEMP%\ugcb\<version>, short and outside OneDrive - ten thousand files would sync):
     UGC Studio.exe                Electron's own exe under the app's name (node_modules/electron/dist)
     *.dll, *.pak, locales\ ...    the rest of Electron, as it is
     resources\app\                the app: desktop\ lib\ routes\ public\ server.js package.json - from the
                                   LAST COMMIT (`git archive HEAD`), never the working tree, which may hold half-made
                                   edits -, vendor\ (laid out by tools/fetch-*.js, checked here without --optional:
                                   a build with no network must fail, not ship without yt-dlp), node_modules\ - only the
                                   packages package-lock.json does not mark `dev` (no electron, eslint, globals)
     resources\app\launcher\       UGC Studio.exe - the launcher (desktop/launcher/Launcher.cs, compiled here by csc.exe)
     resources\app\version.json    { version, seq, commit, date, format, channel, electron } - lib/app-version.js
     resources\app\files.json      every file of the folder with its sha256 and size - what the updater compares
   No asar (yt-dlp, whisper and ffmpeg are exes; the caption fonts are files libass opens); Electron's default_app.asar
   is left out, so the exe runs resources\app. The runAsNode fuse stays ON: yt-dlp solves YouTube's challenges on the
   app's own Node (lib/ytdlp.js). Nothing at run time writes into this folder - everything goes to the library. */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const REPO = path.join(__dirname, '..');
const APP_PATHS = ['desktop', 'lib', 'routes', 'public', 'server.js', 'package.json', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'licenses'];
const FETCH = ['fetch-yt-dlp', 'fetch-jassub', 'fetch-whisper', 'fetch-3d', 'fetch-mediapipe', 'fetch-sfx', 'fetch-patterns'];
// The vendor/ folders those scripts lay out - the only ones shipped: a folder an earlier program fetched stays out.
const VENDOR = ['yt-dlp', 'jassub', 'whisper', '3d', 'mediapipe', 'sfx', 'patterns'];

const arg = (name, dflt) => { const i = process.argv.indexOf(name); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt; };
const say = (s) => console.log('[build] ' + s);

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { cwd: REPO, encoding: 'utf8', windowsHide: true, maxBuffer: 1 << 26, ...opts });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`${path.basename(cmd)} ${args.slice(0, 3).join(' ')}: ${(r.stderr || r.stdout || '').trim().split('\n').pop()}`);
  return r.stdout;
}

function walk(dir, rel = '', out = []) {
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    const r = rel ? `${rel}/${d.name}` : d.name;
    if (d.isDirectory()) walk(path.join(dir, d.name), r, out);
    else if (d.isFile()) out.push(r);
  }
  return out;
}

function sha256(file) {
  const h = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.allocUnsafe(1 << 20);
  try { for (let n; (n = fs.readSync(fd, buf, 0, buf.length, null)) > 0;) h.update(buf.subarray(0, n)); }
  finally { fs.closeSync(fd); }
  return h.digest('hex');
}

/** desktop/launcher/Launcher.cs -> an exe, by the .NET Framework's own C# compiler (in every Windows; C# 5). That
 *  compiler stamps every exe anew, so a compiled one is kept by its source's hash (%LOCALAPPDATA%\ugc-build\): the
 *  same source gives the same file, and an update does not carry a "new" launcher that is not. */
function compileLauncher(cs, icon, exe) {
  const fw = path.join(process.env.SystemRoot || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
  const src = crypto.createHash('sha256').update(fs.readFileSync(cs)).update(fs.readFileSync(icon)).digest('hex').slice(0, 16);
  const cacheDir = path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'ugc-build');
  const cached = path.join(cacheDir, `launcher-${src}.exe`);
  fs.mkdirSync(path.dirname(exe), { recursive: true });
  if (!fs.existsSync(cached)) {
    if (!fs.existsSync(fw)) throw new Error('the C# compiler of the .NET Framework is not there: ' + fw);
    fs.mkdirSync(cacheDir, { recursive: true });
    // /codepage:65001 - the source is UTF-8 without a mark, and its Russian messages would be read in the system's code page
    run(fw, ['/nologo', '/target:winexe', '/optimize+', '/codepage:65001', '/win32icon:' + icon, '/r:System.Web.Extensions.dll',
      '/r:System.Windows.Forms.dll', '/out:' + cached, cs]);
  }
  fs.copyFileSync(cached, exe);
  return exe;
}

/** The production packages: every package-lock entry not marked dev, present on the disk (an optional one for
 *  another platform is not), a nested one only when its parent is not already taken whole. */
function prodPackages() {
  const lock = JSON.parse(fs.readFileSync(path.join(REPO, 'package-lock.json'), 'utf8'));
  if (lock.lockfileVersion < 2) throw new Error('package-lock.json is too old to read (lockfileVersion ' + lock.lockfileVersion + ')');
  const keys = Object.entries(lock.packages || {})
    .filter(([k, p]) => k && !p.dev && fs.existsSync(path.join(REPO, k)))
    .map(([k]) => k).sort();
  return keys.filter((k) => !keys.some((o) => o !== k && k.startsWith(o + '/')));
}

/**
 * opts: { out, seq, channel, worktree, version, updateKey, updateUrl } - the last three for stands only: another
 * version name than package.json's, and the public key (PEM) and releases address baked into desktop/update-key.js.
 */
function build(opts = {}) {
  const t0 = Date.now();
  const WORKTREE = !!opts.worktree;
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));
  const version = opts.version || pkg.version;
  const out = path.resolve(opts.out || path.join(os.tmpdir(), 'ugcb', version));
  if (out.startsWith(path.resolve(REPO) + path.sep)) throw new Error('the version folder must not be inside the program folder');

  // 1. vendor/ complete - each fetcher checks its pinned files and downloads only what is missing.
  for (const f of FETCH) run(process.execPath, [path.join('tools', f + '.js')], { stdio: ['ignore', 'pipe', 'pipe'] });
  say('vendor/ checked');

  // 2. The commit, and what of the app differs from it in the working tree (not shipped - said, so it is no surprise).
  const head = run('git', ['rev-parse', 'HEAD']).trim();
  const dirty = run('git', ['status', '--porcelain', '--', ...APP_PATHS]).trim();
  if (dirty) say((WORKTREE ? 'IN this build, not committed' : 'not in this build (uncommitted)') + ':\n' + dirty.split('\n').map((l) => '        ' + l).join('\n'));
  const commit = WORKTREE && dirty ? head + '+worktree' : head;

  // 3. Electron under the app's name.
  fs.rmSync(out, { recursive: true, force: true });
  const dist = path.join(REPO, 'node_modules', 'electron', 'dist');
  fs.cpSync(dist, out, { recursive: true, filter: (src) => path.basename(src) !== 'default_app.asar' });
  fs.renameSync(path.join(out, 'electron.exe'), path.join(out, 'UGC Studio.exe'));
  const electron = JSON.parse(fs.readFileSync(path.join(REPO, 'node_modules', 'electron', 'package.json'), 'utf8')).version;

  // 4. The app from the commit - or, with --worktree (checks of a change before it is committed; never a release), the
  //    files git knows or would add, as they are in the folder now.
  const app = path.join(out, 'resources', 'app');
  fs.mkdirSync(app, { recursive: true });
  if (WORKTREE) {
    const listed = run('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', ...APP_PATHS]).split('\0').filter(Boolean);
    for (const r of listed) {
      const src = path.join(REPO, r);
      if (!fs.existsSync(src)) continue;          // deleted, not yet committed
      fs.mkdirSync(path.dirname(path.join(app, r)), { recursive: true });
      fs.copyFileSync(src, path.join(app, r));
    }
  } else {
    const tar = path.join(out, 'app.tar');
    run('git', ['archive', '--format=tar', '-o', tar, commit, '--', ...APP_PATHS]);
    // Windows' own tar (bsdtar): Git's GNU tar reads "C:\..." as a remote host.
    const TAR = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
    run(TAR, ['-xf', tar, '-C', app]);
    fs.rmSync(tar, { force: true });
  }

  // 4a. A stand's key and releases address (never a release's: tools/release.js passes neither).
  if (opts.updateKey || opts.updateUrl) {
    const baked = { PUBLIC_KEY: opts.updateKey || '', RELEASES: opts.updateUrl || '' };
    fs.writeFileSync(path.join(app, 'desktop', 'update-key.js'),
      `'use strict';\n// Baked in by tools/build-app.js for a stand.\nmodule.exports = ${JSON.stringify(baked, null, 2)};\n`);
  }

  // 4b. The launcher, compiled from this version's own source: it travels with every version,
  //     and the app puts it in the UGC Studio folder when the one there differs (desktop/home.js).
  compileLauncher(path.join(app, 'desktop', 'launcher', 'Launcher.cs'), path.join(app, 'desktop', 'icon.ico'), path.join(app, 'launcher', 'UGC Studio.exe'));

  // 5. vendor/ and the production node_modules from this checkout.
  // dereference: a checkout whose vendor/ or node_modules/ is a junction to another copies the files, not the link.
  for (const v of VENDOR) fs.cpSync(path.join(REPO, 'vendor', v), path.join(app, 'vendor', v), { recursive: true, dereference: true });
  const left = fs.readdirSync(path.join(REPO, 'vendor')).filter((v) => !VENDOR.includes(v));
  if (left.length) say('vendor/ left out (no fetch script lays it out): ' + left.join(', '));
  const pkgs = prodPackages();
  for (const k of pkgs) fs.cpSync(path.join(REPO, k), path.join(app, k), { recursive: true, dereference: true });

  // 6. What this version is, and every file of it.
  const seq = Number(opts.seq) || 0;
  const LF = require('../lib/library-format');
  const info = { version, seq, commit, date: new Date().toISOString(), format: LF.FORMAT, channel: opts.channel || 'stable', electron };
  fs.writeFileSync(path.join(app, 'version.json'), JSON.stringify(info, null, 2));
  const files = walk(out).filter((r) => r !== 'resources/app/files.json').sort();
  let bytes = 0;
  const list = files.map((r) => { const abs = path.join(out, r); const s = fs.statSync(abs).size; bytes += s; return { p: r, h: sha256(abs), s }; });
  fs.writeFileSync(path.join(app, 'files.json'), JSON.stringify({ version, seq, commit, files: list }));

  say(`UGC Studio ${version} (${commit.slice(0, 12)}, Electron ${electron}) -> ${out}`);
  say(`${list.length} files, ${(bytes / 1048576).toFixed(0)} MB; ${pkgs.length} packages; ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  return { out, info, files: list.length, bytes };
}

if (require.main === module) {
  try {
    const keyFile = arg('--update-key', '');
    build({
      out: arg('--out', ''), seq: arg('--seq', '0'), channel: arg('--channel', 'stable'), worktree: process.argv.includes('--worktree'),
      version: arg('--version-name', ''), updateKey: keyFile ? fs.readFileSync(keyFile, 'utf8') : '', updateUrl: arg('--update-url', ''),
    });
  } catch (e) { console.error('[build] ' + e.message); process.exit(1); }
}

module.exports = { build, prodPackages, sha256, walk, compileLauncher };
