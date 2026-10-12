'use strict';

// ════════════════════════════════════════════════════════════════════════════
// YT-DLP — metadata and the whole video, for anything that arrives as a link.
//
// SHIPPED WITH THE APP. tools/fetch-yt-dlp.js puts a pinned, checksummed build in vendor/yt-dlp/
// (npm install runs it; the desktop build carries the folder), so links work on a machine that
// has never seen Python. A yt-dlp installed on the machine is used only when the app has no copy
// of its own - a checkout that skipped npm install - and YTDLP_PATH overrides all of them.
//
// ON THE NIGHTLY CHANNEL, AND KEPT CURRENT (phase V27, the owner 2026-10-12). The sites change
// under yt-dlp every few weeks, its stable channel comes out about once a month, and yt-dlp's own
// README calls nightly "the recommended channel for regular users". So the shipped build is a
// nightly one, and yt-dlp's own updater keeps a copy in the library current - cache/yt-dlp/ (the
// program folder is never written to, and an app update replaces it): 15 s after every start (not
// twice within the hour), every 24 hours while the app is open, after a call that failed for a
// reason that may be yt-dlp's age (at most once an hour), and when Admin -> This computer asks.
// The library's copy is used while it is the newer one. What the last check found is kept beside
// it (state.json), for Admin.
//
// NO LOGIN, ANYWHERE (the owner, 2026-10-12: "Убираем cookies. Вообще"). Every call goes out
// anonymous. Measured 2026-10-11/12: YouTube served every video and short tried, TikTok two of
// three (the third blocked for this country), Instagram 48 reels of 48 - and no pictures, since
// yt-dlp's Instagram reader takes video only. What a site refuses is said in words (_why) with
// "add the video as a file".
//
// ITS JAVASCRIPT RUNS ON THE APP'S OWN NODE. YouTube hides its streams behind challenges only a
// JavaScript engine solves, and yt-dlp looks for Deno by default, which nobody has. The server is
// already running on Node, so yt-dlp is pointed at process.execPath. Under the desktop shell that
// is Electron, which acts as Node only with ELECTRON_RUN_AS_NODE - set for yt-dlp and nothing
// else. The desktop build must therefore keep Electron's runAsNode fuse on.
//
// THE BOT CHECK. YouTube refuses some videos to a program and asks for a login instead, and it
// decides that mostly PER VIDEO, not per attempt: measured in an earlier project, one link went
// through once in thirteen tries while another was served every single time. So retrying is
// nearly useless and the retry loop is deliberately short. Three tries, then a sentence telling
// you to download it yourself and add it as a file.
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
const { writeFileAtomic } = require('./atomic-write');

// THE BEST THERE IS (the owner's answer (g)): yt-dlp's own order - the largest picture, the most
// frames, then the better codec - with ONE rule put in front of it: a standard-range picture before
// an HDR one. An HDR stream is 10-bit BT.2020, and everything downstream (the preview's proxy, the
// render, the models) reads it as ordinary video - washed out. YouTube keeps an SDR version of an
// HDR video at every size, so the rule costs no pixels.
const BEST_SORT = 'hdr:sdr';
const BEST_FORMAT = 'bv*+ba/b';
// Only the voice, for what is read and thrown away (a narrator's sample): the best sound alone.
const AUDIO_FORMAT = 'ba/b';

const BOT_CHECK_TRIES = 3;
const BOT_CHECK_PAUSE_MS = 2000;
const BOT_CHECK_RE = /sign in to confirm you.{0,3}re not a bot/i;
const BOT_CHECK_MARK = 'would not serve this video';

// The build tools/fetch-yt-dlp.js fetches for this platform, and the two copies of it.
const BUILD = { win32: 'yt-dlp.exe', darwin: 'yt-dlp_macos' }[process.platform] || 'yt-dlp_linux';
const SHIPPED = path.join(APP_DIR, 'vendor', 'yt-dlp', BUILD);
const UPDATED = path.join(CACHE_DIR, 'yt-dlp', BUILD);
const STATE = path.join(CACHE_DIR, 'yt-dlp', 'state.json');
const CHANNEL = 'nightly';
const AFTER_FAILURE_MS = 60 * 60 * 1000;
const DAILY_MS = 24 * 60 * 60 * 1000;
// A start right after another (the supervisor restarting a crashed server) does not ask again:
// GitHub answers sixty anonymous questions an hour.
const NOT_TWICE_WITHIN_MS = 60 * 60 * 1000;

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

// Versions are dates - 2026.08.19, 2026.08.19.1 for a same-day fix, 2026.10.10.233141 for a
// nightly - compared part by part.
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

// ── Keeping it current ──────────────────────────────────────────────────────

function _readState() {
  try { return JSON.parse(fs.readFileSync(STATE, 'utf8')) || {}; } catch (e) { return {}; }
}

function _keepState(s) {
  try {
    fs.mkdirSync(path.dirname(STATE), { recursive: true });
    writeFileAtomic(STATE, JSON.stringify(s, null, 2));
  } catch (e) { console.warn('[yt-dlp] could not keep what the check found:', e.message); }
}

let _updating = null;
let _failedAt = 0;

// yt-dlp's own updater, on the library's copy - made from the shipped build first if there is
// none yet - switched to (and kept on) the nightly channel. Resolves true when a newer yt-dlp is
// now the one found. `why` says who asked: 'failure' is held to once an hour, the others go.
function _update(onProgress, why = 'failure') {
  if (_updating) return _updating;
  if (why === 'failure') {
    if (Date.now() - _failedAt < AFTER_FAILURE_MS) return Promise.resolve(false);
    _failedAt = Date.now();
  }
  _updating = (async () => {
    const before = await find();
    const at = new Date().toISOString();
    // One that did not come with the app is the machine's to update, not the app's.
    if (!before || (before.path !== SHIPPED && before.path !== UPDATED)) {
      _keepState({ checkedAt: at, why, result: 'skipped', from: before ? before.version : '', to: '',
        error: before ? 'this yt-dlp is not the app\'s own copy - it is updated where it was installed' : MISSING });
      return false;
    }
    if (onProgress) onProgress('Updating yt-dlp');
    try {
      if (before.path === SHIPPED) {
        await fs.promises.mkdir(path.dirname(UPDATED), { recursive: true });
        await fs.promises.copyFile(SHIPPED, UPDATED);
        if (process.platform !== 'win32') await fs.promises.chmod(UPDATED, 0o755);
      }
      const r = await _exec(UPDATED, ['--update-to', CHANNEL], { timeout: 5 * 60 * 1000 });
      if (r.code !== 0) throw new Error(String(r.err || r.out).trim().split(/\r?\n/).pop() || `exit code ${r.code}`);
      // The updater keeps the build it replaced beside the new one, and nothing runs it again.
      await fs.promises.rm(UPDATED + '.old', { force: true });
    } catch (e) {
      console.warn('[yt-dlp] update failed:', e.message);
      _keepState({ checkedAt: at, why, result: 'failed', from: before.version, to: '', error: e.message });
      return false;
    }
    _found = null;
    const after = await find();
    const moved = !!after && _newer(after.version, before.version);
    console.log(moved ? `[yt-dlp] updated ${before.version} -> ${after.version}` : `[yt-dlp] ${before.version} is the newest`);
    _keepState({ checkedAt: at, why, result: moved ? 'updated' : 'newest', from: before.version,
      to: after ? after.version : '', error: '' });
    return moved;
  })().finally(() => { _updating = null; });
  return _updating;
}

// Admin -> This computer: which yt-dlp, whose copy, and what the last check found.
async function status() {
  const found = await find();
  const s = _readState();
  let copy = '';
  if (found) {
    copy = found.path === UPDATED ? 'library' : found.path === SHIPPED ? 'app'
      : (process.env.YTDLP_PATH && found.path === process.env.YTDLP_PATH) ? 'env' : 'machine';
  }
  return {
    available: !!found, version: found ? found.version : '', copy, channel: CHANNEL,
    checking: !!_updating,
    checkedAt: s.checkedAt || '', why: s.why || '', result: s.result || '',
    from: s.from || '', to: s.to || '', error: s.error || '',
  };
}

// The button on Admin: a check now, whatever the clock says.
async function checkNow() {
  await _update(null, 'asked');
  return status();
}

let _ticking = null;

// From the server's start (server.js, 15 s in): a check now unless one ran within the hour, then
// a look every hour whether a day has passed since the last - a computer that slept through the
// night is checked when it wakes, not a day after.
function startChecks() {
  if (_ticking) return;
  const last = Date.parse(_readState().checkedAt || '') || 0;
  if (Date.now() - last >= NOT_TWICE_WITHIN_MS) _update(null, 'start').catch(() => {});
  _ticking = setInterval(() => {
    const at = Date.parse(_readState().checkedAt || '') || 0;
    if (Date.now() - at >= DAILY_MS) _update(null, 'daily').catch(() => {});
  }, 60 * 60 * 1000);
  _ticking.unref();
}

// ── Calling it ──────────────────────────────────────────────────────────────

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

// `kill` (optional) receives a function that stops the program - a download the person stopped.
//
// THE WHOLE TREE. The one-file build is a launcher that unpacks Python and starts yt-dlp as ITS child: killing the
// launcher left the child downloading on, with nobody waiting for it (measured 2026-10-12, a stopped 680 MB download
// went on). On Windows taskkill takes the tree; elsewhere the launcher passes SIGTERM on to its child.
function _killTree(p) {
  if (!p || !p.pid) return;
  if (process.platform === 'win32') {
    try { spawn('taskkill', ['/pid', String(p.pid), '/T', '/F'], { windowsHide: true }); }
    catch (e) { try { p.kill('SIGKILL'); } catch (e2) { /* gone */ } }
    return;
  }
  try { p.kill('SIGTERM'); } catch (e) { /* gone */ }
  setTimeout(() => { try { p.kill('SIGKILL'); } catch (e) { /* gone */ } }, 3000).unref();
}

function _exec(bin, args, { onLine, timeout = 3600000, env = process.env, kill } = {}) {
  return new Promise((resolve) => {
    let out = '';
    let err = '';
    const p = spawn(bin, args, { windowsHide: true, env });
    const stop = () => _killTree(p);
    if (kill) kill(stop);
    const timer = setTimeout(stop, timeout);
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

// WHAT A SITE REFUSED, IN WORDS. yt-dlp's own lines advise cookies and bug reports, which here
// lead nowhere: there is no login, and the person needs to know what to do instead. A refusal of
// the CONTENT (a login wall, a picture post, a country block, a private or removed video) is not
// yt-dlp's age either, so it does not start an update.
const REFUSALS = [
  [/(empty media response|not granting access|login required|log in to|sign in to|requires? (a )?login|use --cookies|account is private|inappropriate for some users|age.?restricted)/i,
    'the site shows this only to people who are signed in'],
  [/(there is no video in this post|no video formats found)/i, 'there is no video in this post - pictures are not taken'],
  [/(ip address is blocked|not available in your country|geo.?restrict|blocked in your country|not made this video available in your country)/i,
    'the site blocks this video for this country'],
  [/private video/i, 'the video is private'],
  [/unsupported url/i, 'this site is not one the app can read'],
  [/(http error 404|video unavailable|has been removed|does not exist|no longer available|post isn't available|page not found)/i,
    'the video is gone or unavailable'],
];

function _refusal(text) {
  for (const [re, words] of REFUSALS) if (re.test(text || '')) return words;
  return '';
}

// The last ERROR line, without its "[site] id:" head and its "please report this issue" tail.
function _errorLine(text) {
  const lines = String(text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const e = lines.filter(l => /^ERROR:/.test(l)).pop() || lines.pop() || '';
  return e.replace(/^ERROR:\s*/, '').replace(/^\[[^\]]+\]\s*[^:]*:\s*/, '')
    .replace(/;?\s*please report this issue.*$/i, '').replace(/\s*Confirm you are on the latest version.*$/i, '')
    .trim().slice(0, 240);
}

function _failure(lead, text) {
  const why = _refusal(text);
  const e = new Error(lead + (why || _errorLine(text) || 'yt-dlp gave no reason') + '. Add the video as a file instead.');
  e.refused = !!why;
  return e;
}

// One call, retried while YouTube throws its random refusal. Any other failure may be the site
// having moved on without this yt-dlp, so it is updated and the call gets another go - once: the
// update after a failure runs at most hourly. A refusal of the content is returned at once.
async function _withRetries(call, onProgress) {
  for (let attempt = 1; attempt <= BOT_CHECK_TRIES; attempt++) {
    const r = await call();
    if (r.code === 0 || r.stopped) return r;
    if (!BOT_CHECK_RE.test(r.err || '')) {
      if (_refusal(r.err)) return r;
      return (await _update(onProgress)) ? _withRetries(call, onProgress) : r;
    }
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

// A post that holds several videos (an Instagram carousel) comes back as a playlist of them. Those
// sites only - a playlist anywhere else is a channel, a list or a search, and fetching it would
// fetch hundreds of files.
const POSTS = new Set(['Instagram']);

// A name for the record. Instagram calls every reel "Video by <account>"; its caption says more.
function _label(raw) {
  const title = String(raw.title || '').trim();
  const caption = String(raw.description || '').split(/\r?\n/).map(s => s.trim()).find(Boolean) || '';
  const who = raw.uploader || raw.channel || '';
  if ((!title || /^(video|post) by /i.test(title)) && caption) {
    const c = caption.length > 80 ? caption.slice(0, 79).trimEnd() + '…' : caption;
    return who ? who + ' — ' + c : c;
  }
  return title || 'Untitled';
}

// WHAT THE DOWNLOAD WILL BE (phase V28.1): the frame, whether there is a picture at all, and the weight - read off the
// formats yt-dlp picks for the download itself. Asked without the download's format settings, yt-dlp describes a
// different, smaller format (measured on the owner's 25-minute video: 83 MB described, 219 MB downloaded); with them,
// 218.3 MB. `video` is false for a sound alone, null when the site did not say.
function _measures(raw) {
  const fmts = Array.isArray(raw.requested_formats) && raw.requested_formats.length ? raw.requested_formats : [raw];
  const vf = fmts.find(f => f && f.vcodec && f.vcodec !== 'none');
  const video = vf ? true : (fmts.every(f => f && f.vcodec === 'none') ? false : null);
  const width = Number(raw.width || (vf && vf.width) || 0);
  const height = Number(raw.height || (vf && vf.height) || 0);
  let bytes = fmts.reduce((n, f) => n + (Number(f && (f.filesize || f.filesize_approx)) || 0), 0)
    || Number(raw.filesize || raw.filesize_approx || 0);
  if (!bytes && raw.tbr && raw.duration) bytes = Math.round(raw.tbr * 1000 / 8 * raw.duration);
  return { video, width, height, bytes };
}

async function info(url, { onProgress } = {}) {
  const args = ['--dump-single-json', '--no-warnings', '--no-progress', '--no-playlist',
    '-f', BEST_FORMAT, '-S', BEST_SORT, url];
  const r = await _withRetries(() => _run(args, { timeout: 180000 }), onProgress);
  if (r.code !== 0) throw _failure('Could not read that link: ', r.err);
  let raw;
  try { raw = JSON.parse(r.out); }
  catch (e) { throw new Error('yt-dlp returned something that is not JSON for that link.'); }

  // --no-playlist already asks for the single video, but a channel or playlist URL with no
  // video in it still comes back as a playlist object.
  let count = 1;
  if (raw._type === 'playlist') {
    const entries = (raw.entries || []).filter(Boolean);
    if (!POSTS.has(raw.extractor_key) || !entries.length) {
      throw new Error('That link is a playlist or a channel. Give me a single video.');
    }
    count = entries.length;
    // The post's own name and caption, the first video's measures.
    raw = { ...entries[0], title: raw.title || entries[0].title, description: raw.description || entries[0].description,
      uploader: raw.uploader || entries[0].uploader, webpage_url: raw.webpage_url || url, id: raw.id || entries[0].id };
  }

  const site = String(raw.extractor_key || raw.extractor || '');
  return {
    videoId: raw.id || '',
    // The same video under every spelling of its address (youtu.be, /shorts/, ?si=…): what a
    // repeated link is known by.
    key: site && raw.id ? (site + ':' + raw.id).toLowerCase() : '',
    site,
    url: raw.webpage_url || url,
    title: raw.title || 'Untitled',
    label: _label(raw),
    channel: raw.uploader || raw.channel || '',
    duration: Number(raw.duration || 0),
    description: String(raw.description || '').slice(0, 4000),
    language: String(raw.language || '').split('-')[0],
    ext: raw.ext || 'mp4',
    count,
    ..._measures(raw),
  };
}

// "00:30", "1:02:03" -> seconds; "Unknown" -> null.
function _etaSeconds(s) {
  if (!s || !/^\d+(:\d+)*$/.test(s)) return null;
  return s.split(':').reduce((n, p) => n * 60 + Number(p), 0);
}

const PCT_RE = /\[download\]\s+([\d.]+)%\s+of\s+~?\s*([\d.]+\s*\w+)(?:\s+at\s+([^\s]+))?(?:\s+ETA\s+([^\s]+))?/i;
const ITEM_RE = /\[download\]\s+Downloading item (\d+) of (\d+)/i;
const MERGE_RE = /\[Merger\]|Merging formats/i;

// The whole video, into `outTemplate` (the caller names it), at the best there is - or its sound
// alone (`audioOnly`). `items` ("1-3") takes those videos of a post that holds several; without
// it, one. Progress reports what is LEFT rather than a bare percentage: a percentage says
// nothing about whether to wait or go and do something else. `kill` receives the stop.
// `onProgress(words, { pct, eta })` - the second argument, the share done (0..1) and the seconds left (null when yt-dlp
// does not know), is for a caller that draws a bar (phase V28.1, a source being added).
// A download cut off (the app closed, a lost connection) and asked for again under the same name goes on from what
// it had: yt-dlp keeps the `.part` and continues it by default.
async function download(url, outTemplate, { onProgress, audioOnly = false, items = '', kill } = {}) {
  const ffDir = ffmpegPath ? path.dirname(ffmpegPath) : '';
  const args = audioOnly
    ? ['-f', AUDIO_FORMAT]
    : ['-f', BEST_FORMAT, '-S', BEST_SORT, '--merge-output-format', 'mp4'];
  args.push('-o', outTemplate, '--no-warnings', '--newline');
  args.push(...(items ? ['--yes-playlist', '--playlist-items', String(items)] : ['--no-playlist']));
  if (ffDir) args.push('--ffmpeg-location', ffDir);
  args.push(url);

  let stopped = false;
  let item = '';
  const r = await _withRetries(async () => {
    const res = await _run(args, {
      kill: kill ? (stop) => kill(() => { stopped = true; stop(); }) : undefined,
      onLine: (line) => {
        if (!onProgress) return;
        const it = ITEM_RE.exec(line);
        if (it) { item = `video ${it[1]} of ${it[2]} · `; return; }
        const m = PCT_RE.exec(line);
        if (m) {
          const eta = m[4] ? ` · ${m[4]} left` : '';
          const speed = m[3] ? ` at ${m[3]}` : '';
          onProgress(`${item}Downloading · ${Math.round(parseFloat(m[1]))}% of ${m[2].replace(/\s+/g, '')}${speed}${eta}`,
            { pct: Math.min(1, parseFloat(m[1]) / 100), eta: _etaSeconds(m[4]) });
          return;
        }
        if (MERGE_RE.test(line)) onProgress(item + 'Joining video and audio');
      },
    });
    if (stopped) res.stopped = true;
    return res;
  }, onProgress);

  if (stopped) { const e = new Error('Stopped.'); e.stopped = true; throw e; }
  if (r.code !== 0) throw _failure('The download failed: ', r.err);
  return r.out;
}

module.exports = {
  BEST_FORMAT, BEST_SORT, AUDIO_FORMAT, BOT_CHECK_TRIES, BOT_CHECK_RE, BOT_CHECK_MARK, MISSING, CHANNEL,
  find, info, download, status, checkNow, startChecks,
};
