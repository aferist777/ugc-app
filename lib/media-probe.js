'use strict';

/* media-probe.js - what is in a media file: its length, its frame size, and whether it has sound.

   Read off what `ffmpeg -i` prints, because ffprobe is not shipped with ffmpeg-static. ffmpeg exits
   with an error here (no output was asked for), which is expected: the report is written first.

   probe(abs) -> { duration, w, h, audio, fps, vcodec, rotate }   zeros, false and '' when the file cannot be read.
   w and h are the frame as stored; `rotate` (degrees, a phone's .mov) says how it is shown - the video chat's clips
   are prepared as they are SEEN (phase V7, lib/video-prep.js).

   (phase V18.3) WHAT A FILE WAS READ TO HOLD IS REMEMBERED, by its size and its time: the video chat reads a clip when
   it is attached and its send asked again - twice - running ffmpeg each time, half a second on a quiet machine and
   seconds while the preview's proxies were warming, all of it before the message could show. A file changed under the
   same name has another size or time and is read again; one that could not be read is not remembered. */

const fs = require('fs');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');

const SEEN = new Map();
const SEEN_MAX = 400;

async function probe(abs) {
  let key = '';
  try { const st = await fs.promises.stat(abs); key = abs + '|' + st.size + '|' + st.mtimeMs; } catch (e) { /* read as it is */ }
  const hit = key ? SEEN.get(key) : null;
  if (hit) return Object.assign({}, hit);
  const r = await _read(abs);
  if (key && (r.duration > 0 || r.w > 0)) {
    SEEN.set(key, r);
    if (SEEN.size > SEEN_MAX) SEEN.delete(SEEN.keys().next().value);
  }
  return Object.assign({}, r);
}

function _read(abs) {
  return new Promise((resolve) => {
    let out = '';
    let proc;
    try {
      proc = spawn(ffmpegPath, ['-hide_banner', '-i', abs], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    } catch (e) {
      resolve({ duration: 0, w: 0, h: 0, audio: false, fps: 0, vcodec: '', rotate: 0 });
      return;
    }
    proc.stderr.on('data', (c) => { out += c.toString(); });
    proc.on('close', () => {
      const d = out.match(/Duration:\s*(\d+):(\d+):(\d+\.?\d*)/);
      const wh = out.match(/Stream #\d+:\d+.*Video:.*?,\s*(\d{2,5})x(\d{2,5})[\s,]/);
      const vl = (out.match(/Stream #\d+:\d+.*Video:[^\n]*/) || [''])[0];
      const fps = vl.match(/(\d+(?:\.\d+)?)\s*fps/) || vl.match(/(\d+(?:\.\d+)?)\s*tbr/);
      const rot = out.match(/rotation of (-?\d+(?:\.\d+)?) degrees/) || out.match(/\brotate\s*:\s*(-?\d+)/);
      resolve({
        duration: d ? (+d[1] * 3600 + +d[2] * 60 + parseFloat(d[3])) : 0,
        w: wh ? +wh[1] : 0,
        h: wh ? +wh[2] : 0,
        audio: /Stream #\d+:\d+.*:\s*Audio:/.test(out),
        fps: fps ? +fps[1] : 0,
        vcodec: ((vl.match(/Video:\s*(\w+)/) || [])[1]) || '',
        rotate: rot ? +rot[1] : 0,
      });
    });
    proc.on('error', () => resolve({ duration: 0, w: 0, h: 0, audio: false, fps: 0, vcodec: '', rotate: 0 }));
  });
}

module.exports = { probe };
