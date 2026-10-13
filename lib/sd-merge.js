'use strict';

// ════════════════════════════════════════════════════════════════════════════
// THE LINES OF A SEEDANCE TALKING HEAD, MERGED (phase V26.8, part 3, the owner 2026-10-13; docs/local-app/PLAN.md,
// "Фаза V26", block 8).
//
// With a Seedance model and the video field's `merge fragments` ticked, neighbouring lines are filmed as ONE clip each:
// their words joined, their reads joined into one sound. The person ticks it - never by itself - and only once every
// line of the video is read: the reads are what the fragments are measured by. A merged fragment is not edited; to
// change a line, the tick comes off, the line is changed and read, and the tick goes on again - the lines are merged
// again by the rule.
//
// THE RULE: fragments no longer than the model's longest clip (15 s, 30 s on 2.5) - the FEWEST of them, and of the ways
// to make that few, the one with the most even lengths (the owner's answer (с)): the longest fragment as short as it
// can be, then the lengths as close as they can be. A line longer than the clip stays a fragment of its own and is
// marked `tooLong` - it is refused before any money (the owner's answer (р)).
//
// NOTHING IS STORED: the fragments are worked out from the lines each time, so the same lines with the same reads
// always make the same fragments. A fragment's KEY is made of the reads it joins, which is what lets a Seedance clip
// made for it come back when it forms again, and go stale when one of its lines is read again.
//
// THE SOUND of a fragment of several lines is a file of its own beside the reads (`voice/merged/<key>.mp3`), made by
// `build` - each read levelled the way the timeline levels them (up to the loudest read, lib/loudness.js), then joined
// end to end. A fragment of one line is that line's read.
// ════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const { toDisk, toDiskExisting } = require('./media');
const LOUD = require('./loudness');
const TH = require('./th-video');
const MIRROR = require('./frag-mirror');

const VOL_MAX_DB = 12;                    // the ceiling the timeline's own volume has (x4)
const EPS = 1e-6;

/** The longest fragment the project's model takes, in seconds - 0 when it is not a Seedance. */
function capOf(video) {
  const model = String((video || {}).model || '');
  if (!TH.isSeedance(model)) return 0;
  const q = TH.qualities(model)[0];
  return (q && q.maxAudioSec) || 15;
}

// The fewest fragments of a run of lines, each no longer than `cap`, with the most even lengths. Dynamic programming
// over where each fragment ends: (how many, the longest, the sum of squares) compared in that order.
function _split(items, cap) {
  const n = items.length;
  const pre = [0];
  items.forEach(x => pre.push(pre[pre.length - 1] + x.dur));
  const better = (a, b) => a.c < b.c || (a.c === b.c && (a.mx < b.mx - EPS || (Math.abs(a.mx - b.mx) <= EPS && a.sq < b.sq - EPS)));
  const best = new Array(n + 1).fill(null);
  best[0] = { c: 0, mx: 0, sq: 0, from: -1 };
  for (let j = 1; j <= n; j++) {
    for (let i = j - 1; i >= 0; i--) {
      const s = pre[j] - pre[i];
      if (s > cap + EPS) break;
      const b = best[i];
      if (!b) continue;
      const cand = { c: b.c + 1, mx: Math.max(b.mx, s), sq: b.sq + s * s, from: i };
      if (!best[j] || better(cand, best[j])) best[j] = cand;
    }
  }
  const out = [];
  for (let j = n; j > 0; j = best[j].from) out.unshift(items.slice(best[j].from, j));
  return out;
}

const _keyOf = (paths) => crypto.createHash('sha1').update(paths.join('|')).digest('hex').slice(0, 12);
// A read is READ where it is now (it may have moved, lib/moves.js); a joined sound is written where its address says.
const _read = (url) => toDiskExisting(url);
const _disk = (url) => toDisk(url);

/**
 * The merged fragments of a project, as they stand.
 * @returns {{ can: boolean, why: string, cap: number, groups: Array }} - `groups` empty unless `can`. Each group:
 *   { n, key, lines: [index], dur, tooLong, audio (its address), ready (the sound is on disk), paths (the reads) }
 */
function plan(proj) {
  const video = (proj && proj.video) || {};
  const cap = capOf(video);
  if (!cap) return { can: false, why: 'a Seedance model merges the lines', cap: 0, groups: [] };
  const lines = Array.isArray(proj.lines) ? proj.lines : [];
  const live = lines.map((l, i) => i).filter(i => !(lines[i] && lines[i].removed));
  if (!live.length) return { can: false, why: 'the script has no lines', cap, groups: [] };
  const reads = live.map(i => ({ i, take: MIRROR.readOf(lines[i]) }));
  const unread = reads.filter(r => !r.take).length;
  if (unread) return { can: false, why: 'read every line first - ' + unread + (unread === 1 ? ' is' : ' are') + ' not read', cap, groups: [] };

  // Runs of lines that fit, split at the lines too long to fit with anything.
  const items = reads.map(r => ({ i: r.i, dur: +r.take.dur || 0, path: r.take.path }));
  const parts = [];
  let run = [];
  for (const it of items) {
    if (it.dur > cap + EPS) {
      if (run.length) { parts.push(..._split(run, cap)); run = []; }
      parts.push([Object.assign({ tooLong: true }, it)]);
    } else run.push(it);
  }
  if (run.length) parts.push(..._split(run, cap));

  const groups = parts.map((g, k) => {
    const paths = g.map(x => x.path);
    const key = _keyOf(paths);
    const audio = g.length === 1 ? paths[0] : path.posix.dirname(paths[0]) + '/merged/' + key + '.mp3';
    const abs = g.length === 1 ? _read(audio) : _disk(audio);
    return {
      n: k + 1, key, lines: g.map(x => x.i),
      dur: Math.round(g.reduce((s, x) => s + x.dur, 0) * 100) / 100,
      tooLong: !!g[0].tooLong,
      audio, ready: !!(abs && fs.existsSync(abs)), paths,
    };
  });
  return { can: true, why: '', cap, groups };
}

// One sound of several reads: each lifted by its own gain, joined end to end, written beside them.
function _join(inputs, gains, outAbs) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(outAbs), { recursive: true });
    const tmp = outAbs.replace(/\.mp3$/i, '') + '.part.mp3';
    const args = ['-hide_banner', '-loglevel', 'error', '-y'];
    inputs.forEach(f => args.push('-i', f));
    const chain = inputs.map((_, k) => '[' + k + ':a]aresample=44100,aformat=channel_layouts=mono,volume=' + gains[k] + 'dB[a' + k + ']').join(';')
      + ';' + inputs.map((_, k) => '[a' + k + ']').join('') + 'concat=n=' + inputs.length + ':v=0:a=1[out]';
    args.push('-filter_complex', chain, '-map', '[out]', '-c:a', 'libmp3lame', '-b:a', '160k', tmp);
    let err = '';
    const proc = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    proc.stderr.on('data', (d) => { err += d; });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code !== 0 || !fs.existsSync(tmp)) return reject(new Error('the reads could not be joined' + (err ? ': ' + err.trim().slice(0, 160) : '')));
      try { fs.renameSync(tmp, outAbs); } catch (e) { return reject(e); }
      resolve(outAbs);
    });
  });
}

/**
 * Make the sound of every merged fragment that has none yet. Seconds: ffmpeg on a few short files.
 * @returns {Promise<{ made: number, failed: Array<{n, error}> }>}
 */
async function build(proj) {
  const pl = plan(proj);
  const want = pl.groups.filter(g => g.lines.length > 1 && !g.ready);
  if (!want.length) return { made: 0, failed: [] };
  // Levelled to the loudest read of the whole video, as the timeline levels them (lib/frag-mirror.js).
  const all = [...new Set(pl.groups.flatMap(g => g.paths))];
  const lufs = new Map();
  for (const p of all) {
    let m = null;
    try { m = await LOUD.measure(_read(p)); } catch (e) { m = null; }
    lufs.set(p, m);
  }
  const loudest = [...lufs.values()].reduce((a, m) => (m && m.lufs != null && (a == null || m.lufs > a) ? m.lufs : a), null);
  const failed = [];
  let made = 0;
  for (const g of want) {
    try {
      const inputs = g.paths.map(_read);
      if (inputs.some(f => !f || !fs.existsSync(f))) throw new Error('a read of this fragment is missing from disk');
      const gains = g.paths.map(p => Math.min(VOL_MAX_DB, loudest == null ? 0 : (LOUD.gainFor(lufs.get(p), loudest) || 0)));
      await _join(inputs, gains, _disk(g.audio));
      made++;
    } catch (e) {
      failed.push({ n: g.n, error: e.message });
    }
  }
  return { made, failed };
}

/**
 * (phase V26.8, part 4) THE FRAGMENTS SEEDANCE FILMS, whichever way the lines are: the merged fragments when `merge` is
 * ticked and they can be merged, else every line that is read as a fragment of its own (the owner's answer (ъ)) - each
 * with the same shape as a merged one: { n, key, lines, dur, tooLong, audio, ready, paths, merged }. A line not read yet
 * is no fragment: there is nothing to film it to. [] for a project that is not filmed by Seedance.
 */
function fragments(proj) {
  const video = (proj && proj.video) || {};
  const cap = capOf(video);
  if (!cap) return [];
  if (video.merge) {
    const pl = plan(proj);
    if (pl.can) return pl.groups.map(g => Object.assign({}, g, { merged: true }));
  }
  const lines = Array.isArray(proj.lines) ? proj.lines : [];
  const out = [];
  let n = 0;
  lines.forEach((l, i) => {
    if (l && l.removed) return;
    n++;
    const take = MIRROR.readOf(l);
    if (!take) return;
    const abs = _read(take.path);
    out.push({
      n, key: _keyOf([take.path]), lines: [i], dur: Math.round((+take.dur || 0) * 100) / 100,
      tooLong: (+take.dur || 0) > cap + EPS, audio: take.path, ready: !!(abs && fs.existsSync(abs)), paths: [take.path], merged: false,
    });
  });
  return out;
}

module.exports = { capOf, plan, build, fragments, _split };
