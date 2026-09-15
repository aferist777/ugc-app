'use strict';

/* media-probe.js - what is in a media file: its length, its frame size, and whether it has sound.

   Read off what `ffmpeg -i` prints, because ffprobe is not shipped with ffmpeg-static. ffmpeg exits
   with an error here (no output was asked for), which is expected: the report is written first.

   probe(abs) -> { duration, w, h, audio }   zeros and false when the file cannot be read */

const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');

function probe(abs) {
  return new Promise((resolve) => {
    let out = '';
    let proc;
    try {
      proc = spawn(ffmpegPath, ['-hide_banner', '-i', abs], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    } catch (e) {
      resolve({ duration: 0, w: 0, h: 0, audio: false });
      return;
    }
    proc.stderr.on('data', (c) => { out += c.toString(); });
    proc.on('close', () => {
      const d = out.match(/Duration:\s*(\d+):(\d+):(\d+\.?\d*)/);
      const wh = out.match(/Stream #\d+:\d+.*Video:.*?,\s*(\d{2,5})x(\d{2,5})[\s,]/);
      resolve({
        duration: d ? (+d[1] * 3600 + +d[2] * 60 + parseFloat(d[3])) : 0,
        w: wh ? +wh[1] : 0,
        h: wh ? +wh[2] : 0,
        audio: /Stream #\d+:\d+.*:\s*Audio:/.test(out),
      });
    });
    proc.on('error', () => resolve({ duration: 0, w: 0, h: 0, audio: false }));
  });
}

module.exports = { probe };
