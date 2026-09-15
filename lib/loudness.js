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
    ], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });

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
// The LOUDEST fragment. Not the median, which was the first answer and the wrong one:
// levelling to the middle pulled half the project DOWN - on one real cut, six of twelve
// fragments, the loudest by 5.5 dB - and handed back a video quieter than its own best part
// for nothing. These are voice reads, so the loudest is not a shout to be tamed; measured on
// that same cut it sat at -25.9 LUFS, which is quiet by any platform's reckoning. There is
// nothing up there to protect anyone from, and everything to gain by bringing the rest to it.
//
// Nothing is ever turned down by this. Only the stragglers move.
function target(values) {
  const v = values.filter(x => isFinite(x));
  return v.length ? Math.max(...v) : null;
}

// How much to lift one fragment, in dB.
//
// TWO LIMITS, and neither is a flat number. The first version capped every correction at
// 9 dB, which suited a median target where corrections are small and quietly ruined a
// loudest-fragment one: on a real cut the two worst fragments needed +10.2 and +10.9, and a
// 9 dB ceiling would have left them audibly short while reporting success.
//
// What actually protects is the TRUE PEAK. A boost is capped so the peak stays under
// CEILING, because raising a quiet read into clipping trades a level problem for a
// distortion one - and the second cannot be undone by turning it down. In practice this
// rarely binds: quiet reads have quiet peaks, and the fragment needing +10.9 dB had 18.8 dB
// of room.
//
// The second is a floor. Below MIN_LUFS there is no voice to lift - a failed read, a file
// of room tone - and amplifying that by twenty-odd dB turns a quiet fault into a loud one.
// Left alone rather than corrected, so it stays obvious.
const MIN_LUFS = -45;
const CEILING = -1.0;    // dBTP

function gainFor(m, targetLufs) {
  if (!m || !isFinite(targetLufs)) return 0;
  if (m.lufs < MIN_LUFS) return 0;
  let g = targetLufs - m.lufs;
  if (g <= 0) return 0;                                  // already the loudest, or level with it
  g = Math.min(g, Math.max(0, CEILING - m.peakDb));
  return Math.round(g * 100) / 100;
}

module.exports = { measure, target, gainFor, MIN_LUFS, CEILING };
