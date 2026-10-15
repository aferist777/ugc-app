'use strict';

// ════════════════════════════════════════════════════════════════════════════
// WHERE THE SPEECH ENDS in a clip's own sound (phase V26.8, sixth round, the owner's answer (я6): "конец ячейки - там, где
// в звуке клипа кончается речь"). Seedance makes a clip as long as it is asked, or picks the length itself by the voice
// sample, and the voice may stop well before the picture does: the timeline cell ends where the speech ends, with a
// breath after it (routes/scen3.js _sdCuts), so a silent tail does not hang on the cut.
//
// ffmpeg's silencedetect, read once when the clip lands: a quiet of a quarter of a second or more, under -35 dB, that
// runs to the end of the sound says from when the rest is silence. Probe P7 (2026-10-15): a 6.06 s clip by the voice
// sample was quiet from 5.75 s; the pauses between its lines (0.5 s) are not the end because the speech comes back.
// ════════════════════════════════════════════════════════════════════════════

const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');

const QUIET_DB = -35;
const QUIET_MIN = 0.25;

/**
 * @param {string} file  a clip or a sound on disk
 * @returns {Promise<number>} the second the speech ends at, or 0 - the sound runs to the end, or could not be read
 */
function speechEnd(file) {
  return new Promise((resolve) => {
    let err = '';
    let proc;
    try {
      proc = spawn(ffmpegPath, ['-hide_banner', '-nostdin', '-i', file, '-vn', '-af',
        'silencedetect=noise=' + QUIET_DB + 'dB:d=' + QUIET_MIN, '-f', 'null', '-'],
      { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    } catch (e) { return resolve(0); }
    proc.stderr.on('data', (d) => { err += d; });
    proc.on('error', () => resolve(0));
    proc.on('close', () => resolve(_lastQuiet(err)));
  });
}

// The start of the quiet that runs to the end of the sound, from ffmpeg's own words - 0 when there is none.
function _lastQuiet(log) {
  const m = String(log).match(/Duration:\s*(\d+):(\d+):(\d+\.?\d*)/);
  const dur = m ? (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]) : 0;
  const quiet = [];
  const re = /silence_(start|end):\s*(-?\d+(?:\.\d+)?)/g;
  let x;
  while ((x = re.exec(log))) {
    if (x[1] === 'start') quiet.push({ from: +x[2], to: null });
    else if (quiet.length && quiet[quiet.length - 1].to == null) quiet[quiet.length - 1].to = +x[2];
  }
  const last = quiet[quiet.length - 1];
  if (!last || !(dur > 0)) return 0;
  const toEnd = last.to == null || last.to >= dur - 0.1;
  return toEnd && last.from > 0 ? Math.round(last.from * 100) / 100 : 0;
}

module.exports = { speechEnd, _lastQuiet };
