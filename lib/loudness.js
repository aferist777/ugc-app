'use strict';

// ════════════════════════════════════════════════════════════════════════════
// HOW LOUD IS THIS FRAGMENT, REALLY.
//
// Voice fragments come back from ElevenLabs at inconsistent levels - one read lands at a
// comfortable volume, the next one noticeably under it. Laid end to end that is the worst
// kind of audio fault: not quiet, but STEPPED, and a step is what makes someone reach for
// the volume knob in the middle of a video.
//
// The fix has to be measured per fragment and applied BEFORE they are concatenated.
// Normalising the finished mix would settle its average and leave every step inside it
// exactly where it was.
//
// EBU R128 rather than peak. Peak says how close a file came to clipping, which has almost
// nothing to do with how loud it sounds - a breathy read can peak higher than a firm one
// and still sit under it. `loudnorm` in analysis mode reports integrated loudness in LUFS,
// which is the number that matches what an ear reports.
//
// One pass, print_format=json, no output written. On a ten-second read it is near
// instant; the cache below is for re-imports of a project whose fragments have not changed.
// ════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');

// Keyed by path + mtime + size: a regenerated read reuses its filename, so the name alone
// would hand back the loudness of the take it replaced.
const _cache = new Map();
const MAX_CACHE = 500;

function _key(fp) {
  try {
    const s = fs.statSync(fp);
    return fp + '|' + s.mtimeMs + '|' + s.size;
  } catch (e) {
    return null;
  }
}

/**
 * Integrated loudness of one file.
 * @returns {Promise<{lufs:number, peakDb:number, lra:number}|null>} null when it cannot be read
 */
function measure(absPath) {
  const k = _key(absPath);
  if (!k) return Promise.resolve(null);
  if (_cache.has(k)) return Promise.resolve(_cache.get(k));

  return new Promise((resolve) => {
    let err = '';
    const proc = spawn(ffmpegPath, [
      '-hide_banner', '-nostats',
      '-i', absPath,
      '-af', 'loudnorm=print_format=json',
      '-f', 'null', '-',
    ], { stdio: ['ignore', 'ignore', 'pipe'] });

    proc.stderr.on('data', (d) => { err += d; });
    proc.on('error', () => resolve(null));
    proc.on('close', () => {
      // The JSON is the LAST brace-block on stderr, after all the usual banner noise.
      const start = err.lastIndexOf('{');
      const end = err.lastIndexOf('}');
      if (start < 0 || end < start) return resolve(null);
      let j;
      try { j = JSON.parse(err.slice(start, end + 1)); } catch (e) { return resolve(null); }
      const lufs = parseFloat(j.input_i);
      const peakDb = parseFloat(j.input_tp);
      // -inf comes back for silence, and a silent fragment must not be "corrected" by
      // amplifying its noise floor into the mix.
      if (!isFinite(lufs) || lufs < -70) return resolve(null);
      const out = { lufs, peakDb: isFinite(peakDb) ? peakDb : 0, lra: parseFloat(j.input_lra) || 0 };
      if (_cache.size > MAX_CACHE) _cache.clear();
      _cache.set(k, out);
      resolve(out);
    });
  });
}

// ── What to level everything TO ─────────────────────────────────────────────
// The MEDIAN, not the mean. Asked for "the average", and the median is the honest reading
// of that intent: one unusually quiet take drags a mean down and would make every other
// fragment quieter to match a mistake. The median moves the outliers to the crowd instead.
function target(values) {
  const v = values.filter(x => isFinite(x)).slice().sort((a, b) => a - b);
  if (!v.length) return null;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

// How much to lift or drop one fragment, in dB.
//
// TWO LIMITS, and both matter. A correction bigger than MAX_DB means the measurement is
// probably describing something other than the voice - a fragment of near-silence, a read
// with the microphone knocked - and silently amplifying it by 20 dB turns a quiet mistake
// into a loud one. And the boost is capped so the true peak stays under CEILING: raising a
// quiet fragment into clipping trades a level problem for a distortion problem, which is
// worse because it cannot be undone by turning it down.
const MAX_DB = 9;
const CEILING = -1.0;    // dBTP

function gainFor(m, targetLufs) {
  if (!m || !isFinite(targetLufs)) return 0;
  let g = targetLufs - m.lufs;
  g = Math.max(-MAX_DB, Math.min(MAX_DB, g));
  if (g > 0) g = Math.min(g, Math.max(0, CEILING - m.peakDb));
  return Math.round(g * 100) / 100;
}

const toLinear = (db) => Math.pow(10, (+db || 0) / 20);

module.exports = { measure, target, gainFor, toLinear, MAX_DB, CEILING };
