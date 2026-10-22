'use strict';

/* build-sfx.js - builds the app's built-in sound set (phase V34.B; docs/local-app/PLAN.md "Фаза V34", V34.1) from
   tools/sfx-list.json: one folder laid out as vendor/sfx/ is, and ONE archive of it - the archive tools/fetch-sfx.js
   installs. Run by hand when the set changes; npm install never runs it:
       node tools/build-sfx.js                    -> <temp>/ugc-sfx-build/out/ and <temp>/ugc-sfx-build/ugc-sfx-<version>.zip
       node tools/build-sfx.js --out <dir> --cache <dir> --only <id,id,...>
   Then the archive is copied to tools/sfx/ (kept in git - the owner's answer; a new version's file takes the old one's
   place, git keeps the old in its history) and its name, size, SHA-256 and number of sounds go into fetch-sfx.js's PIN.

   WHERE THE SOUNDS COME FROM - all CC0 (free to ship inside a program and to sell it; no credit required - credited
   anyway, on Admin -> Thanks and in vendor/sfx/LICENSE.txt):
     - Kenney's audio packs (kenney.nl): each zip pinned by size and SHA-256 in the list's `sources`;
     - Freesound and Wikimedia Commons sounds found through Openverse (api.openverse.org, license=cc0 only): each file is
       the `url` Openverse gave - for Freesound its preview MP3 (~128 kbit/s), for Commons the file itself -, pinned by
       size and SHA-256 in its entry. The build asks Openverse nothing; the files come slowly, one every 1.5 s.
     Not used: BigSoundBank (its robots.txt forbids fetching files), Sonniss, Pixabay, Mixkit (their licences forbid
     shipping their sounds inside a tool), Freesound directly.

   WHAT IS DONE TO EACH SOUND, with the app's own ffmpeg (ffmpeg-static):
     - the silence before it is cut: it starts 3 ms before the first moment within 40 dB of its peak - a sound hits
       exactly where it is dropped on a lane; after it, 10 ms past the last moment within 60 dB of the peak;
     - `max` seconds at most (an ambience 30 s), faded out; `start` skips the head of a recording;
     - one loudness: its loudest 400 ms (EBU R128 momentary) at -18 LUFS, about the level of speech; an ambience as a
       whole (integrated) at -30 LUFS, a bed under speech; never over -1.5 dB true peak (Opus may add a few
       tenths);
     - Opus in Ogg, 128 kbit/s, 48 kHz, mono or stereo as it came, no tags;
     - its waveform: 64 points, each the loudest moment of its 64th, 0..100 of the sound's own loudest.

   IDS NEVER CHANGE: a project points at /sfx/<category>/<id>.ogg. A new version of the set only ADDS entries; an entry
   keeps its id and its category for ever (its name, tags and file may be bettered). The list says which entry is
   what; sfx.json, written here, is what the app reads. */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const FFMPEG = require('ffmpeg-static');
const LIST_FILE = path.join(__dirname, 'sfx-list.json');
const arg = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};
const BASE = path.join(os.tmpdir(), 'ugc-sfx-build');
const OUT = path.resolve(arg('--out', path.join(BASE, 'out')));
const CACHE = path.resolve(arg('--cache', path.join(BASE, 'cache')));
const WORK = path.join(BASE, 'work-' + process.pid);
const ONLY = arg('--only', '') ? new Set(arg('--only', '').split(',')) : null;

const UA = 'UGC-Studio-sfx-build/1.0 (one-time build of a CC0 sound set)';
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const RATE = 48000;
const LEVEL = { loudest: -18, ambience: -30, ceiling: -1.5 };
const POINTS = 64;
const CC0 = { license: 'CC0 1.0', licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/' };

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

// ffmpeg, its output collected; a failure carries the end of what it said.
function ff(args, { allowFail = false } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(FFMPEG, args, { windowsHide: true });
    const out = [];
    let err = '';
    p.stdout.on('data', d => out.push(d));
    p.stderr.on('data', d => { err += d; });
    p.on('error', reject);
    p.on('close', (code) => {
      if (code && !allowFail) return reject(new Error('ffmpeg ' + code + ': ' + err.trim().split('\n').slice(-3).join(' | ')));
      resolve({ out: Buffer.concat(out), err });
    });
  });
}

// Samples as floats - copied into a buffer of their own (a pooled Buffer may not sit on a 4-byte boundary).
const floats = (buf) => new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + (buf.length & ~3)));

// A file by address, kept in the cache under its SHA-256; one that is not the pinned file is refused.
let lastAsk = 0;
async function pinned(url, bytes, hash, slow) {
  const file = path.join(CACHE, hash);
  if (fs.existsSync(file) && sha256(fs.readFileSync(file)) === hash) return file;
  if (slow) {
    const wait = lastAsk + 1500 - Date.now();
    if (wait > 0) await sleep(wait);
    lastAsk = Date.now();
  }
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(res.status + ' ' + url);
  const buf = Buffer.from(await res.arrayBuffer());
  if ((bytes && buf.length !== bytes) || sha256(buf) !== hash) throw new Error('not the pinned file: ' + url);
  fs.mkdirSync(CACHE, { recursive: true });
  fs.writeFileSync(file, buf);
  return file;
}

// The list, checked: every id well formed and once, every category and source known, every file pinned.
function readList() {
  const list = JSON.parse(fs.readFileSync(LIST_FILE, 'utf8'));
  const cats = new Set(list.categories.map(c => c.id));
  const seen = new Set();
  for (const s of list.sounds) {
    const where = 'sfx-list.json, ' + s.id;
    if (!ID.test(s.id) || seen.has(s.id)) throw new Error(where + ': an id must be unique, lower case, words joined by -');
    seen.add(s.id);
    if (!cats.has(s.category)) throw new Error(where + ': no category ' + s.category);
    if (!s.name || !Array.isArray(s.tags)) throw new Error(where + ': a name and tags');
    const f = s.from || {};
    if (f.source ? !list.sources[f.source] || !f.file : !(f.url && f.sha256 && f.bytes && f.author && f.page)) {
      throw new Error(where + ': `from` is a source and a file, or a pinned url with its author and page');
    }
  }
  for (const c of list.categories) if (!ID.test(c.id)) throw new Error('sfx-list.json: category id ' + c.id);
  return list;
}

// The input as a 48 kHz float WAV in its worker's folder, with as many channels as it has (2 at most).
async function toWav(input, dir) {
  const probe = await ff(['-hide_banner', '-i', input], { allowFail: true });
  const m = /Audio: [^\n]*?\d+ Hz, ([^,\n]+)/.exec(probe.err);
  if (!m) throw new Error('no sound in ' + path.basename(input));
  const channels = m[1].trim() === 'mono' ? 1 : 2;
  const wav = path.join(dir, 'src.wav');
  await ff(['-v', 'error', '-y', '-i', input, '-map', '0:a:0', '-ac', String(channels), '-ar', String(RATE), '-c:a', 'pcm_f32le', wav]);
  const pcm = floats((await ff(['-v', 'error', '-i', wav, '-f', 'f32le', '-'])).out);
  return { wav, channels, pcm };
}

// Where the sound is: its first and last samples worth keeping, by its own peak.
function span(pcm, channels, opts) {
  const frames = Math.floor(pcm.length / channels);
  const amp = (i) => {
    let a = 0;
    for (let c = 0; c < channels; c++) a = Math.max(a, Math.abs(pcm[i * channels + c]));
    return a;
  };
  const from = Math.min(frames, Math.round((opts.start || 0) * RATE));
  let peak = 0;
  for (let i = from; i < frames; i++) peak = Math.max(peak, amp(i));
  if (!peak) throw new Error('silent');
  let a = from;
  while (a < frames && amp(a) < peak * 0.01) a++;          // -40 dB
  let b = frames - 1;
  while (b > a && amp(b) < peak * 0.001) b--;              // -60 dB
  a = Math.max(from, a - Math.round(0.003 * RATE));
  b = Math.min(frames, b + 1 + Math.round(0.010 * RATE));
  let capped = false;
  if (opts.max && b - a > opts.max * RATE) { b = a + Math.round(opts.max * RATE); capped = true; }
  return { a, b, frames, capped };
}

// The loudest 400 ms, the whole and the true peak of a stretch, by ffmpeg's EBU R128 meter - with half a second of
// silence after it: the meter speaks every 100 ms, and a click of 20 ms would otherwise end before it said anything.
async function loudness(wav, a, b) {
  const { err } = await ff(['-hide_banner', '-nostats', '-i', wav, '-af',
    `atrim=start_sample=${a}:end_sample=${b},apad=pad_dur=0.5,ebur128=peak=true`, '-f', 'null', '-']);
  let loudest = -Infinity;
  for (const m of err.matchAll(/ t: [\d.]+\s+TARGET:[^\n]*?M:\s*(-?[\d.]+)/g)) loudest = Math.max(loudest, Number(m[1]));
  const summary = err.slice(err.lastIndexOf('Summary:'));
  const whole = Number((/I:\s+(-?[\d.]+) LUFS/.exec(summary) || [])[1]);
  const tp = Number((/Peak:\s+(-?[\d.]+) dBFS/.exec(summary) || [])[1]);
  if (!Number.isFinite(loudest) || !Number.isFinite(tp)) throw new Error('the loudness meter said nothing');
  return { loudest, whole, tp };
}

async function make(entry, input, dir) {
  const opts = entry.cut || {};
  const ambience = entry.category === 'ambience';
  const { wav, channels, pcm } = await toWav(input, dir);
  const { a, b, frames, capped } = span(pcm, channels, { start: opts.start, max: opts.max || (ambience ? 30 : 0) });
  const lv = await loudness(wav, a, b);
  const quiet = !Number.isFinite(lv.whole) || lv.whole <= -69;
  let gain = ambience && !quiet ? LEVEL.ambience - lv.whole : LEVEL.loudest - lv.loudest;
  gain = Math.max(-40, Math.min(40, Math.min(gain, LEVEL.ceiling - lv.tp)));
  const len = (b - a) / RATE;
  const filters = [`atrim=start_sample=${a}:end_sample=${b}`, 'asetpts=PTS-STARTPTS', `volume=${gain.toFixed(2)}dB`];
  if (ambience) filters.push('afade=t=in:d=0.25');
  else if (a > 0) filters.push('afade=t=in:d=0.002');
  const fadeOut = capped ? Math.min(ambience ? 0.75 : 0.5, len * 0.1) : (b < frames ? 0.01 : 0);
  if (fadeOut) filters.push(`afade=t=out:st=${(len - fadeOut).toFixed(4)}:d=${fadeOut}`);

  const file = entry.category + '/' + entry.id + '.ogg';
  const dest = path.join(OUT, file);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  await ff(['-v', 'error', '-y', '-i', wav, '-af', filters.join(','), '-ac', String(channels), '-ar', String(RATE),
    '-c:a', 'libopus', '-b:a', '128k', '-map_metadata', '-1', '-fflags', '+bitexact', '-flags:a', '+bitexact', dest]);

  // What came out: its length and its waveform.
  const made = floats((await ff(['-v', 'error', '-i', dest, '-ac', '1', '-ar', String(RATE), '-f', 'f32le', '-'])).out);
  const peaks = new Array(POINTS).fill(0);
  for (let i = 0; i < made.length; i++) {
    const k = Math.min(POINTS - 1, Math.floor(i * POINTS / made.length));
    peaks[k] = Math.max(peaks[k], Math.abs(made[i]));
  }
  const top = Math.max(...peaks) || 1;
  return {
    file,
    duration: Math.round(made.length / RATE * 1000) / 1000,
    channels,
    peaks: peaks.map(v => Math.round(v / top * 100)),
    gain: Math.round(gain * 10) / 10,
  };
}

function credits(list, sounds) {
  const lines = [
    `UGC Studio - the built-in sound set, version ${list.version} (${sounds.length} sounds)`,
    '',
    'Every sound here is CC0 1.0 (https://creativecommons.org/publicdomain/zero/1.0/): free to use, change, ship and',
    'sell, with no credit required. Credited with thanks all the same. Each sound\'s author and page are in sfx.json.',
    'The files were trimmed, levelled and re-encoded to Opus by tools/build-sfx.js.',
    '',
  ];
  for (const [id, src] of Object.entries(list.sources)) {
    const n = sounds.filter(s => s.from.source === id).length;
    if (n) lines.push(`${src.title} by ${src.author} - ${src.page} - ${n} sounds`);
  }
  const found = sounds.filter(s => !s.from.source);
  if (found.length) {
    lines.push('', 'Found with Openverse (https://openverse.org) - made using Openverse:');
    const by = new Map();
    for (const s of found) {
      const key = s.from.provider + '\t' + s.from.author;
      by.set(key, (by.get(key) || 0) + 1);
    }
    for (const [key, n] of [...by].sort()) {
      const [provider, author] = key.split('\t');
      lines.push(`  ${author} (${provider === 'freesound' ? 'Freesound' : 'Wikimedia Commons'}) - ${n}`);
    }
  }
  return lines.join('\n') + '\n';
}

async function zip(dir, sounds, file, date) {
  const archiver = require('archiver');
  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(file);
    const a = archiver('zip', { store: true });
    out.on('close', resolve);
    a.on('error', reject);
    a.pipe(out);
    // Buffers, not a.file(): archiver stats files four at a time and adds them as the stats come back, so the order -
    // and the archive's hash - changed from build to build. Appended in this order, the same set makes the same zip.
    for (const name of ['sfx.json', 'LICENSE.txt', ...sounds.map(s => s.file).sort()]) {
      a.append(fs.readFileSync(path.join(dir, name)), { name, date });
    }
    a.finalize();
  });
}

async function main() {
  const list = readList();
  const chosen = list.sounds.filter(s => !ONLY || ONLY.has(s.id));
  fs.rmSync(OUT, { recursive: true, force: true });

  const packs = {};
  const zipOf = async (id) => {
    if (!packs[id]) {
      const src = list.sources[id];
      const file = await pinned(src.url, src.bytes, src.sha256, false);
      const archive = await require('unzipper').Open.file(file);
      packs[id] = new Map(archive.files.map(e => [e.path, e]));
    }
    return packs[id];
  };

  // The packs and the found files first, one after another (the found ones slowly); then four sounds at a time.
  const failed = [];
  const inputs = new Map();
  for (const s of chosen) {
    try {
      if (s.from.source) {
        const e = (await zipOf(s.from.source)).get(s.from.file);
        if (!e) throw new Error('no ' + s.from.file + ' in ' + s.from.source);
        inputs.set(s.id, e);
      } else {
        inputs.set(s.id, await pinned(s.from.url, s.from.bytes, s.from.sha256, true));
      }
    } catch (e) {
      failed.push(s.id + ': ' + e.message);
    }
  }
  if (failed.length) {
    console.error('[sfx] not fetched:\n  ' + failed.join('\n  '));
    process.exit(1);
  }

  const made = new Array(chosen.length);
  let next = 0;
  let done = 0;
  const worker = async (n) => {
    const dir = path.join(WORK, String(n));
    fs.mkdirSync(dir, { recursive: true });
    while (next < chosen.length) {
      const i = next++;
      const s = chosen[i];
      try {
        let input = inputs.get(s.id);
        if (typeof input !== 'string') {
          const buf = await input.buffer();
          input = path.join(dir, 'in' + path.extname(s.from.file));
          fs.writeFileSync(input, buf);
        }
        made[i] = await make(s, input, dir);
        if (++done % 25 === 0) console.log(`[sfx] ${done}/${chosen.length}`);
      } catch (e) {
        failed.push(s.id + ': ' + e.message);
      }
    }
  };
  await Promise.all([0, 1, 2, 3].map(worker));
  fs.rmSync(WORK, { recursive: true, force: true });
  const sounds = chosen.map((s, i) => {
    const m = made[i];
    if (!m) return null;
    const src = s.from.source ? list.sources[s.from.source] : null;
    return {
      id: s.id, name: s.name, category: s.category, file: m.file, tags: s.tags,
      duration: m.duration, channels: m.channels, peaks: m.peaks,
      author: src ? src.author : s.from.author,
      authorUrl: src ? src.authorUrl : (s.from.authorUrl || ''),
      ...CC0,
      source: src ? 'Kenney' : (s.from.provider === 'freesound' ? 'Freesound' : 'Wikimedia Commons'),
      url: src ? src.page : s.from.page,
      via: src ? 'kenney.nl, ' + src.title : 'Openverse',
      original: src ? s.from.file : s.from.title,
      from: s.from,
    };
  }).filter(Boolean);
  if (failed.length) {
    console.error('[sfx] not made:\n  ' + failed.join('\n  '));
    process.exit(1);
  }

  const date = new Date(list.built + 'T00:00:00Z');
  fs.writeFileSync(path.join(OUT, 'LICENSE.txt'), credits(list, sounds));
  const json = {
    format: 1,
    version: list.version,
    built: list.built,
    categories: list.categories.map(c => ({ id: c.id, name: c.name, count: sounds.filter(s => s.category === c.id).length })),
    sources: Object.entries(list.sources).map(([id, s]) => ({ id, title: s.title, author: s.author, page: s.page }))
      .concat([{ id: 'openverse', title: 'Openverse', author: 'Openverse (WordPress)', page: 'https://openverse.org' }]),
    sounds: sounds.map(({ from, ...s }) => s),
  };
  fs.writeFileSync(path.join(OUT, 'sfx.json'), JSON.stringify(json));
  const archive = path.join(path.dirname(OUT), `ugc-sfx-${list.version}.zip`);
  await zip(OUT, sounds, archive, date);
  const buf = fs.readFileSync(archive);
  const mb = (n) => (n / 1048576).toFixed(1) + ' MB';
  console.log(`[sfx] ${sounds.length} sounds in ${OUT}`);
  for (const c of json.categories) console.log(`  ${c.name}: ${c.count}`);
  console.log(`[sfx] ${archive}\n  bytes: ${buf.length} (${mb(buf.length)})\n  sha256: ${sha256(buf)}`);
}

main().catch((e) => {
  console.error('[sfx] ' + e.message);
  process.exit(1);
});
