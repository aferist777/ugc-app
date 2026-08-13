'use strict';

// ════════════════════════════════════════════════════════════════════════════
// YT-DLP — metadata and the whole video, for sources that arrive as a link.
//
// NOT A DEPENDENCY OF THIS APP. yt-dlp is a Python program that lives on the machine, and it
// is found rather than shipped: bundling a 100 MB binary that goes stale in a month, into an
// app that already carries ffmpeg, is a bad trade when a missing one has an honest answer -
// paste the file instead.
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
const { spawn, spawnSync } = require('child_process');
const ffmpegPath = require('ffmpeg-static');

// 1080p is the ceiling: enough to lift a painting or a map out of a frame, and a quarter the
// weight of the same video at full height.
const SOURCE_FORMAT = 'bestvideo[height<=1080]+bestaudio/best[height<=1080]/best';

const BOT_CHECK_TRIES = 3;
const BOT_CHECK_PAUSE_MS = 2000;
const BOT_CHECK_RE = /sign in to confirm you.{0,3}re not a bot/i;
const BOT_CHECK_MARK = 'would not serve this video';

// Where a pip-installed yt-dlp lands on Windows, plus whatever PATH says. An explicit
// YTDLP_PATH wins, for a machine that keeps it somewhere else.
function _candidates() {
  const home = process.env.USERPROFILE || process.env.HOME || '';
  const out = [];
  if (process.env.YTDLP_PATH) out.push(process.env.YTDLP_PATH);
  out.push('yt-dlp.exe', 'yt-dlp');
  if (home) {
    out.push(path.join(home, 'AppData', 'Local', 'Programs', 'Python', 'Python311', 'Scripts', 'yt-dlp.exe'));
    out.push(path.join(home, 'AppData', 'Local', 'Programs', 'Python', 'Python312', 'Scripts', 'yt-dlp.exe'));
    out.push(path.join(home, 'AppData', 'Roaming', 'Python', 'Python311', 'Scripts', 'yt-dlp.exe'));
    out.push(path.join(home, 'AppData', 'Local', 'Microsoft', 'WindowsApps', 'yt-dlp.exe'));
  }
  return out;
}

let _cached = null;

// Cached because it is asked on every ingest and the answer does not change while the process
// lives. `null` means looked and did not find - remembered too, so a missing yt-dlp does not
// re-probe eight paths per request.
function find() {
  if (_cached !== null) return _cached;
  for (const c of _candidates()) {
    try {
      const r = spawnSync(c, ['--version'], { encoding: 'utf8', timeout: 15000, windowsHide: true });
      if (r.status === 0 && String(r.stdout || '').trim()) {
        _cached = { path: c, version: String(r.stdout).trim() };
        return _cached;
      }
    } catch (e) { /* next candidate */ }
  }
  _cached = false;
  return false;
}

function require_() {
  const found = find();
  if (!found) {
    throw new Error('yt-dlp was not found on this machine. Install it (pip install yt-dlp), '
      + 'or download the video yourself and add it with the file upload instead.');
  }
  return found;
}

function _run(args, { onLine, timeout = 3600000 } = {}) {
  const bin = require_().path;
  return new Promise((resolve) => {
    let out = '';
    let err = '';
    const p = spawn(bin, args, { windowsHide: true });
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

// One call, retried only while YouTube throws its random refusal. Any other failure is
// returned at once: retrying a bad URL three times just wastes six seconds.
async function _withRetries(call, onProgress) {
  for (let attempt = 1; attempt <= BOT_CHECK_TRIES; attempt++) {
    const r = await call();
    if (r.code === 0) return r;
    if (!BOT_CHECK_RE.test(r.err || '')) return r;
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
  SOURCE_FORMAT, BOT_CHECK_TRIES, BOT_CHECK_RE, BOT_CHECK_MARK,
  find, info, download,
};
