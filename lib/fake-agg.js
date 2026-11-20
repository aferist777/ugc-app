// THE FAKE AGGREGATOR. The chats of Merge - pictures and videos - are checked end to end without a
// cent: the analyst answers with a stock line, nothing is uploaded, kie.ai and Replicate are never asked, and the "render" is a picture or a clip made here
// after RENDER_MS. Everything around it is the real thing: the record, its Alerts row, the stages, the
// cross, the watcher, the filing onto the shelf.
//
// ON ONLY WHERE IT CANNOT HURT, decided in the code rather than by whichever .env is lying around: the
// variable must be set, the process must not be the desktop app (Electron), and the library must be
// this checkout's own `local-data/`. A real library can never get a fake picture or lose a real one
// to a fake task.
//
// What a prompt can ask of it, for the paths that are hard to reach otherwise:
//   ?ask   the analyst asks a question instead of writing a prompt
//   ?fail  the render fails ("the fake model refused")
//   ?slow  the render takes 90 s instead of 20
//   ?nsfw  the render is refused by the fake model's moderation (the 'refused' path - no retry)
//
// SOUND too: a task of kind 'a' is music or a sound effect - after RENDER_MS, `count` tones of `duration`
// seconds (mp3), each a note of its own, so two variants are two different files; the generate-audio routes file them
// like real tracks (lib/audio-gens.js).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { APP_DIR, ROOT_DIR } = require('./config');
const I18N = require('./i18n');

const FLAG = 'UGC_VIDEO_FAKE';
let RENDER_MS = 20 * 1000;
const SLOW_MS = 90 * 1000;

function _why() {
  if (String(process.env[FLAG] || '') !== '1') return 'off';
  if (process.versions && process.versions.electron) return 'refused: the desktop app never fakes';
  const own = path.resolve(APP_DIR, 'local-data').toLowerCase();
  if (path.resolve(ROOT_DIR).toLowerCase() !== own) return 'refused: only the checkout\'s own local-data';
  return 'on';
}
const on = () => _why() === 'on';

/** One line for the boot log when the variable is set: whether it took, and why not. */
function bootLine() {
  const w = _why();
  if (w === 'off') return '';
  return w === 'on'
    ? '[boot] FAKE aggregator (' + FLAG + '=1): nothing is sent to kie.ai or Replicate, nothing is uploaded'
    : '[boot] ' + FLAG + ' ignored - ' + w.replace(/^refused: /, '');
}

// What each fake task was asked, so its picture can say so. A task from before a restart is not here
// and gets a plain picture - the id alone carries when it was asked and of what kind.
const _asked = new Map();

/** A task id resolveTask understands (`fake:<kind>-<ms>-<rand>`, safe in a file name after the colon). */
function task(kind, o) {
  const opts = o || {};
  const prompt = String(opts.prompt || '');
  const ms = /\?slow\b/.test(prompt) ? SLOW_MS : RENDER_MS;
  const id = (kind === 'v' ? 'v' : kind === 'a' ? 'a' : 'p') + '-' + Date.now().toString(36) + '-' + (ms === SLOW_MS ? 's' : 'n')
    + crypto.randomBytes(3).toString('hex');
  _asked.set(id, { prompt, aspect: String(opts.aspect || ''), fail: /\?fail\b/.test(prompt), nsfw: /\?nsfw\b/.test(prompt), ms,
                   // -1 is the length the model picks (Seedance on kie): a clip of 6 s here.
                   duration: +opts.duration > 0 ? +opts.duration : (+opts.duration === -1 ? 6 : 5),
                   count: Math.max(1, Math.min(4, Math.round(+opts.count || 1))) });
  return 'fake:' + id;
}

function _sizeOf(aspect, long) {
  const m = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(String(aspect || ''));
  const w = m ? +m[1] : 9, h = m ? +m[2] : 16;
  const even = (n) => Math.max(2, Math.round(n / 2) * 2);
  return w >= h ? { w: long, h: even(long * h / w) } : { w: even(long * w / h), h: long };
}

const _esc = (s) => String(s).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));

async function _picture(abs, ask) {
  const sharp = require('sharp');
  const { w, h } = _sizeOf(ask.aspect, 1280);
  const hue = parseInt(crypto.createHash('md5').update(ask.prompt || abs).digest('hex').slice(0, 2), 16) * 360 / 256;
  const words = String(ask.prompt || 'fake picture').replace(/\s+/g, ' ').trim();
  const lines = [''];
  for (const word of words.split(' ')) {
    const cur = lines[lines.length - 1];
    if (!cur || (cur + ' ' + word).length <= 30) lines[lines.length - 1] = (cur ? cur + ' ' : '') + word.slice(0, 30);
    else if (lines.length < 6) lines.push(word.slice(0, 30));
    else break;
  }
  const size = Math.round(Math.min(w, h) / 22);
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '">'
    + '<rect width="100%" height="100%" fill="hsl(' + Math.round(hue) + ',45%,32%)"/>'
    + '<text x="50%" y="38%" font-family="sans-serif" font-weight="700" font-size="' + (size * 3)
    + '" fill="#fff" text-anchor="middle">FAKE</text>'
    + lines.map((l, i) => '<text x="50%" y="' + (50 + i * 5) + '%" font-family="sans-serif" font-size="' + size
      + '" fill="#fff" fill-opacity="0.85" text-anchor="middle">' + _esc(l) + '</text>').join('')
    + '</svg>';
  await sharp(Buffer.from(svg)).jpeg({ quality: 85 }).toFile(abs);
}

/** A test clip: moving colour bars and a tone, `duration` seconds, the size of `aspect`. */
function clip(abs, o) {
  const opts = o || {};
  const { w, h } = _sizeOf(opts.aspect, +opts.long || 1280);
  const d = Math.max(1, Math.min(30, +opts.duration || 5));
  const ffmpegPath = require('ffmpeg-static');
  const args = ['-hide_banner', '-nostdin', '-y',
    '-f', 'lavfi', '-i', 'testsrc2=size=' + w + 'x' + h + ':rate=30:duration=' + d,
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=' + d,
    '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '96k',
    '-movflags', '+faststart', '-shortest', abs];
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    let err = '';
    p.stderr.on('data', (b) => { err = (err + b).slice(-2000); });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(abs) : reject(new Error('ffmpeg ' + code + ': ' + err.slice(-300)))));
  });
}

/** A test sound: a tone of `duration` seconds at `freq` Hz, fading in and out, as an mp3. */
function tone(abs, o) {
  const opts = o || {};
  const d = Math.max(0.5, Math.min(360, +opts.duration || 3));
  const f = Math.max(110, Math.min(1760, +opts.freq || 440));
  const ffmpegPath = require('ffmpeg-static');
  const fade = Math.min(0.3, d / 4).toFixed(2);
  const args = ['-hide_banner', '-nostdin', '-y',
    '-f', 'lavfi', '-i', 'sine=frequency=' + f + ':sample_rate=44100:duration=' + d,
    '-af', 'volume=0.4,afade=t=in:d=' + fade + ',afade=t=out:st=' + Math.max(0, d - +fade).toFixed(2) + ':d=' + fade,
    '-c:a', 'libmp3lame', '-b:a', '128k', abs];
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    let err = '';
    p.stderr.on('data', (b) => { err = (err + b).slice(-2000); });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(abs) : reject(new Error('ffmpeg ' + code + ': ' + err.slice(-300)))));
  });
}

/**
 * The poll of a fake task, in resolveTask's own shape: pending until its time is up, then the file is
 * made in `destDir` once (a second poll finds it, as a real download is found) - a picture with its
 * thumbnail for `p-`, a clip for `v-` (`{ state, videoPath }`), `count` tones for `a-` (`{ state, audioPaths }`).
 */
async function resolve(taskId, destDir, prefix) {
  const id = String(taskId || '').replace(/^fake:/, '');
  const m = /^([pva])-([0-9a-z]+)-([sn])[0-9a-f]+$/.exec(id);
  if (!m) return { state: 'failed', error: I18N.t('not a fake task: {id}', { id: taskId }) };
  const ask = _asked.get(id) || { prompt: '', aspect: '', fail: false, ms: m[3] === 's' ? SLOW_MS : RENDER_MS, duration: 5, count: 1 };
  if (Date.now() - parseInt(m[2], 36) < ask.ms) return { state: 'pending' };
  if (ask.fail) return { state: 'failed', error: I18N.t('the fake model refused (?fail in the prompt)') };
  if (ask.nsfw) return { state: 'failed', error: 'output video flagged as sensitive by the fake moderation (?nsfw in the prompt)' };
  fs.mkdirSync(destDir, { recursive: true });
  const rel = path.relative(ROOT_DIR, destDir).split(path.sep).join('/');
  const existing = fs.readdirSync(destDir).find(f => f.includes(id));
  if (m[1] === 'a') {
    const out = [];
    for (let i = 1; i <= (ask.count || 1); i++) {
      const name = prefix + '_' + id + '_' + i + '.mp3';
      const abs = path.join(destDir, name);
      if (!fs.existsSync(abs)) await tone(abs, { duration: ask.duration, freq: [440, 554, 659, 880][(i - 1) % 4] });
      out.push('/' + rel + '/' + name);
    }
    return { state: 'success', audioPaths: out };
  }
  if (m[1] === 'v') {
    const name = existing || (prefix + '_' + id + '.mp4');
    if (!existing) await clip(path.join(destDir, name), ask);
    return { state: 'success', videoPath: '/' + rel + '/' + name };
  }
  const name = existing || (prefix + '_' + id + '.jpg');
  if (!existing) {
    const abs = path.join(destDir, name);
    await _picture(abs, ask);
    const { createThumbnail } = require('./helpers');
    try { await createThumbnail(abs, path.join(destDir, 'thumbs', name)); } catch (e) { console.warn('[fake-agg] thumb:', e.message); }
  }
  return { state: 'success', imagePath: '/' + rel + '/' + name };
}

/** The analyst's stock answer, after a moment - or its question, when the prompt says ?ask. */
async function think(text) {
  await new Promise(r => setTimeout(r, 1500));
  if (/\?ask\b/.test(text)) return { ask: 'Fake analyst: which of the pictures is the person? (?ask in the message)' };
  return { prompt: '[fake] ' + text, raw: text, writer: 'fake analyst' };
}

/** Attachments are not uploaded: the local address stands in for the public link. */
const host = (clean) => 'fake-host:' + clean;

/** The watcher's stock description of a clip `secs` long (lib/clip-watch.js) - in the parts a real one has. */
function watch(secs) {
  const s = Math.max(0.5, +secs || 5);
  const a = (s / 3).toFixed(1), b = (2 * s / 3).toFixed(1), e = s.toFixed(1);
  return ['LENGTH: ' + e + ' s',
    'PEOPLE:',
    '- A: [fake] a woman in her twenties, long dark hair, slim, in a red coat and jeans, in the middle of the frame, seen the whole clip.',
    'PLACE AND LIGHT: [fake] a city square by day, a fountain behind her, soft overcast light.',
    'CAMERA: [fake] a medium shot at eye level, a slow push-in, no cuts.',
    'TIMELINE:',
    '0.0-' + a + ' s: A looks into the lens and waves with her right hand.',
    a + '-' + b + ' s: A says "Hi, look at this!" and points to her left.',
    b + '-' + e + ' s: A turns to her left and walks out of the frame.',
    'SOUND: [fake] street ambience, no music.'].join('\n');
}

module.exports = { on, bootLine, task, resolve, think, clip, tone, host, watch, FLAG,
                   // for the stand: a render in a moment rather than in 20 s
                   _setRenderMs: (ms) => { RENDER_MS = ms; } };
