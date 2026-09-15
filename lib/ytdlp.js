'use strict';

// ════════════════════════════════════════════════════════════════════════════
// YT-DLP — metadata and the whole video, for sources that arrive as a link.
//
// SHIPPED WITH THE APP. tools/fetch-yt-dlp.js puts a pinned, checksummed build in vendor/yt-dlp/
// (npm install runs it; the desktop build carries the folder), so links work on a machine that
// has never seen Python. A yt-dlp installed on the machine is used only when the app has no copy
// of its own - a checkout that skipped npm install - and YTDLP_PATH overrides all of them.
//
// AND KEPT CURRENT. YouTube changes under yt-dlp every few weeks, and the shipped build is only as
// new as the app's last release. So when a call fails for any reason but the bot check below,
// yt-dlp's own updater runs - at most once an hour - on a copy in the library, cache/yt-dlp/
// (the program folder is never written to, and an app update replaces it), and the call is tried
// again if that brought a newer version. The library's copy is used while it is the newer one.
//
// ITS JAVASCRIPT RUNS ON THE APP'S OWN NODE. YouTube hides its streams behind challenges only a
// JavaScript engine solves, and yt-dlp looks for Deno by default, which nobody has. The server is
// already running on Node, so yt-dlp is pointed at process.execPath. Under the desktop shell that
// is Electron, which acts as Node only with ELECTRON_RUN_AS_NODE - set for yt-dlp and nothing
// else. The desktop build must therefore keep Electron's runAsNode fuse on.
//
// THE BOT CHECK IS THE MAIN FACT HERE. YouTube refuses to serve some videos to a program and
// asks for a login instead, and it decides that mostly PER VIDEO, not per attempt: measured in
// an earlier project, one link went through once in thirteen tries while another was served every
// single time. So retrying is nearly useless and the retry loop is deliberately short - a long
// one only makes the dead end slower without making it less dead. Three tries, then a sentence
// telling you to download it yourself and add it as a file.
//
// ffmpeg is passed explicitly. yt-dlp joins the best video and best audio streams with ffmpeg,
// which it looks for on PATH - and this machine has none there. Without --ffmpeg-location the
// download dies at the join with "you have requested merging of multiple formats but ffmpeg is
// not installed", after having downloaded everything.
// ════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const { APP_DIR, CACHE_DIR } = require('./config');

// 1080p is the ceiling: enough to lift a painting or a map out of a frame, and a quarter the
// weight of the same video at full height.
const SOURCE_FORMAT = 'bestvideo[height<=1080]+bestaudio/best[height<=1080]/best';

const BOT_CHECK_TRIES = 3;
const BOT_CHECK_PAUSE_MS = 2000;
const BOT_CHECK_RE = /sign in to confirm you.{0,3}re not a bot/i;
const BOT_CHECK_MARK = 'would not serve this video';

// The build tools/fetch-yt-dlp.js fetches for this platform, and the two copies of it.
const BUILD = { win32: 'yt-dlp.exe', darwin: 'yt-dlp_macos' }[process.platform] || 'yt-dlp_linux';
const SHIPPED = path.join(APP_DIR, 'vendor', 'yt-dlp', BUILD);
const UPDATED = path.join(CACHE_DIR, 'yt-dlp', BUILD);
const UPDATE_EVERY_MS = 60 * 60 * 1000;

const MISSING = 'yt-dlp is missing from this copy of the app (npm install puts it in vendor/yt-dlp). '
  + 'Add the video as a file instead.';

// A yt-dlp that lives on the machine: PATH, then where pip puts it on Windows.
function _machineCandidates() {
  const home = process.env.USERPROFILE || process.env.HOME || '';
  const out = ['yt-dlp.exe', 'yt-dlp'];
  if (home) {
    out.push(path.join(home, 'AppData', 'Local', 'Programs', 'Python', 'Python311', 'Scripts', 'yt-dlp.exe'));
    out.push(path.join(home, 'AppData', 'Local', 'Programs', 'Python', 'Python312', 'Scripts', 'yt-dlp.exe'));
    out.push(path.join(home, 'AppData', 'Roaming', 'Python', 'Python311', 'Scripts', 'yt-dlp.exe'));
    out.push(path.join(home, 'AppData', 'Local', 'Microsoft', 'WindowsApps', 'yt-dlp.exe'));
  }
  return out;
}

// Versions are dates - 2026.08.19, or 2026.08.19.1 for a same-day fix - compared part by part.
function _newer(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0;
  }
  return false;
}

async function _probe(bin) {
  const r = await _exec(bin, ['--version'], { timeout: 30000 });
  const version = r.code === 0 ? String(r.out).trim() : '';
  return version ? { path: bin, version } : null;
}

let _found = null;

// A promise of { path, version }, or of false. Asked once per run and remembered, "none"
// included: every probe starts a whole Python - over a second for the one-file build.
function find() {
  if (!_found) _found = _locate();
  return _found;
}

async function _locate() {
  if (process.env.YTDLP_PATH) {
    const own = await _probe(process.env.YTDLP_PATH);
    if (own) return own;
  }
  const shipped = fs.existsSync(SHIPPED) ? await _probe(SHIPPED) : null;
  const updated = fs.existsSync(UPDATED) ? await _probe(UPDATED) : null;
  if (updated && (!shipped || _newer(updated.version, shipped.version))) return updated;
  if (shipped) return shipped;
  for (const bin of _machineCandidates()) {
    const found = await _probe(bin);
    if (found) return found;
  }
  return false;
}

let _updating = null;
let _updatedAt = 0;

// yt-dlp's own updater, on the library's copy - made from the shipped build first if there is
// none yet. Resolves true when a newer yt-dlp is now the one found.
function _update(onProgress) {
  if (_updating) return _updating;
  if (Date.now() - _updatedAt < UPDATE_EVERY_MS) return Promise.resolve(false);
  _updatedAt = Date.now();
  _updating = (async () => {
    const before = await find();
    // One that did not come with the app is the machine's to update, not the app's.
    if (!before || (before.path !== SHIPPED && before.path !== UPDATED)) return false;
    if (onProgress) onProgress('Updating yt-dlp');
    try {
      if (before.path === SHIPPED) {
        await fs.promises.mkdir(path.dirname(UPDATED), { recursive: true });
        await fs.promises.copyFile(SHIPPED, UPDATED);
        if (process.platform !== 'win32') await fs.promises.chmod(UPDATED, 0o755);
      }
      const r = await _exec(UPDATED, ['-U'], { timeout: 5 * 60 * 1000 });
      if (r.code !== 0) throw new Error(String(r.err || r.out).trim().split(/\r?\n/).pop() || `exit code ${r.code}`);
      // The updater keeps the build it replaced beside the new one, and nothing runs it again.
      await fs.promises.rm(UPDATED + '.old', { force: true });
    } catch (e) {
      console.warn('[yt-dlp] update failed:', e.message);
      return false;
    }
    _found = null;
    const after = await find();
    const moved = !!after && _newer(after.version, before.version);
    console.log(moved ? `[yt-dlp] updated ${before.version} -> ${after.version}` : `[yt-dlp] ${before.version} is the newest`);
    return moved;
  })().finally(() => { _updating = null; });
  return _updating;
}

// The release that brought JavaScript runtimes in. An older yt-dlp - one found on the machine -
// needs no engine, and would refuse the whole command over the unknown option.
const JS_RUNTIMES_SINCE = '2025.11.12';

// Every extraction call: the yt-dlp found, with the app's own Node as its JavaScript engine.
function _run(args, opts = {}) {
  return find().then((found) => {
    if (!found) throw new Error(MISSING);
    const js = _newer(JS_RUNTIMES_SINCE, found.version) ? [] : ['--js-runtimes', 'node:' + process.execPath];
    const env = process.versions.electron ? { ...process.env, ELECTRON_RUN_AS_NODE: '1' } : process.env;
    return _exec(found.path, [...js, ...args], { ...opts, env });
  });
}

function _exec(bin, args, { onLine, timeout = 3600000, env = process.env } = {}) {
  return new Promise((resolve) => {
    let out = '';
    let err = '';
    const p = spawn(bin, args, { windowsHide: true, env });
    const timer = setTimeout(() => { try { p.kill('SIGKILL'); } catch (e) {} }, timeout);
    p.stdout.on('data', d => {
      const s = String(d);
      out += s;
      if (onLine) s.split(/\r?\n/).forEach(l => { if (l.trim()) onLine(l.trim()); });
    });
    p.stderr.on('data', d => { err = (err + d).slice(-8000); });
    p.on('error', e => { clearTimeout(timer); resolve({ code: -1, out, err: e.message }); });
    p.on('close', code => { clearTimeout(timer); resolve({ code, out, err }); });
  });
}

// One call, retried while YouTube throws its random refusal. Any other failure may be YouTube
// having moved on without this yt-dlp, so it is updated and the call gets another go - once: the
// update runs at most hourly. Otherwise the failure is returned at once, since retrying a bad URL
// three times just wastes six seconds.
async function _withRetries(call, onProgress) {
  for (let attempt = 1; attempt <= BOT_CHECK_TRIES; attempt++) {
    const r = await call();
    if (r.code === 0) return r;
    if (!BOT_CHECK_RE.test(r.err || '')) return (await _update(onProgress)) ? _withRetries(call, onProgress) : r;
    if (attempt === BOT_CHECK_TRIES) {
      const e = new Error(`YouTube ${BOT_CHECK_MARK} to the app — it asked for a login on all `
        + `${BOT_CHECK_TRIES} attempts. Download the video yourself and add it as a file instead.`);
      e.botCheck = true;
      throw e;
    }
    if (onProgress) onProgress(`YouTube refused — retrying ${attempt}/${BOT_CHECK_TRIES - 1}`);
    await new Promise(res => setTimeout(res, BOT_CHECK_PAUSE_MS));
  }
  throw new Error('unreachable');
}

// The cookie jar is passed as a path, never read here: this module runs a program, and whether
// a session exists is a question for lib/yt-cookies.js. Absent, the calls go out anonymous -
// which is exactly when YouTube asks for a login.
function _cookieArgs(cookies) {
  return cookies ? ['--cookies', cookies] : [];
}

async function info(url, { onProgress, cookies = '' } = {}) {
  const args = ['--dump-single-json', '--no-warnings', '--no-progress', '--no-playlist',
    ..._cookieArgs(cookies), url];
  const r = await _withRetries(() => _run(args, { timeout: 180000 }), onProgress);
  if (r.code !== 0) {
    throw new Error('Could not read that link: ' + String(r.err || '').trim().slice(0, 200));
  }
  let raw;
  try { raw = JSON.parse(r.out); }
  catch (e) { throw new Error('yt-dlp returned something that is not JSON for that link.'); }

  // --no-playlist already asks for the single video, but a channel or playlist URL with no
  // video in it still comes back as a playlist object, and downloading that would fetch
  // hundreds of files.
  if (raw._type === 'playlist') throw new Error('That link is a playlist. Give me a single video.');

  return {
    videoId: raw.id || '',
    url: raw.webpage_url || url,
    title: raw.title || 'Untitled',
    channel: raw.uploader || raw.channel || '',
    duration: Number(raw.duration || 0),
    description: String(raw.description || '').slice(0, 4000),
    language: String(raw.language || '').split('-')[0],
    ext: raw.ext || 'mp4',
  };
}

const PCT_RE = /\[download\]\s+([\d.]+)%\s+of\s+~?\s*([\d.]+\s*\w+)(?:\s+at\s+([^\s]+))?(?:\s+ETA\s+([^\s]+))?/i;
const MERGE_RE = /\[Merger\]|Merging formats/i;

// The whole video, into `outDir`, named by the caller. Progress reports what is LEFT rather
// than a bare percentage: a percentage says nothing about whether to wait or go and do
// something else.
async function download(url, outTemplate, { onProgress, cookies = '' } = {}) {
  const ffDir = ffmpegPath ? path.dirname(ffmpegPath) : '';
  const args = [
    '-f', SOURCE_FORMAT,
    '-o', outTemplate,
    '--no-playlist', '--no-warnings', '--newline',
    '--merge-output-format', 'mp4',
    ..._cookieArgs(cookies),
  ];
  if (ffDir) args.push('--ffmpeg-location', ffDir);
  args.push(url);

  const r = await _withRetries(() => _run(args, {
    onLine: (line) => {
      if (!onProgress) return;
      const m = PCT_RE.exec(line);
      if (m) {
        const eta = m[4] ? ` · ${m[4]} left` : '';
        const speed = m[3] ? ` at ${m[3]}` : '';
        onProgress(`Downloading · ${Math.round(parseFloat(m[1]))}% of ${m[2].replace(/\s+/g, '')}${speed}${eta}`);
        return;
      }
      if (MERGE_RE.test(line)) onProgress('Joining video and audio');
    },
  }), onProgress);

  if (r.code !== 0) {
    throw new Error('The download failed: ' + String(r.err || '').trim().slice(-300));
  }
  return r.out;
}

module.exports = {
  SOURCE_FORMAT, BOT_CHECK_TRIES, BOT_CHECK_RE, BOT_CHECK_MARK, MISSING,
  find, info, download,
};
