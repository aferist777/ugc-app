'use strict';

// ════════════════════════════════════════════════════════════════════════════
// A SOUND'S WAVEFORM (phase V34.C) - the shape a sound tile draws: 64 points, each the loudest moment of its 64th, 0..100
// of the sound's own loudest - the built-in set's own measure (tools/build-sfx.js), so every tile of SFX and Music draws
// the same way.
//
//   peaks(abs) -> [64 numbers]           read with the app's ffmpeg (8 kHz, one channel); [] when it cannot be read
//   fill()                               the records of SFX -> My sounds (data/sounds.json) and of AUDIO -> Music
//                                        (data/suno-lib.json) with no `wave` yet are measured in the background, one at a
//                                        time, and written in one tick per store at the end - a record deleted meanwhile
//                                        is not brought back. Asked whenever the media shelf lists them (routes/library.js).
// ════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const { spawn } = require('child_process');

const POINTS = 64;
const RATE = 8000;

function peaks(abs) {
  return new Promise((resolve) => {
    if (!abs || !fs.existsSync(abs)) return resolve([]);
    const ffmpegPath = require('ffmpeg-static');
    const p = spawn(ffmpegPath, ['-hide_banner', '-nostdin', '-v', 'error', '-i', abs, '-vn', '-ac', '1', '-ar', String(RATE),
      '-f', 's16le', '-'], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
    const chunks = [];
    let size = 0;
    p.stdout.on('data', (b) => { chunks.push(b); size += b.length; });
    p.on('error', () => resolve([]));
    p.on('close', () => {
      const buf = Buffer.concat(chunks, size);
      const n = Math.floor(buf.length / 2);
      if (n < POINTS) return resolve([]);
      const out = new Array(POINTS).fill(0);
      for (let i = 0; i < POINTS; i++) {
        const a = Math.floor(i * n / POINTS), b = Math.floor((i + 1) * n / POINTS);
        let m = 0;
        for (let j = a; j < b; j++) { const v = Math.abs(buf.readInt16LE(j * 2)); if (v > m) m = v; }
        out[i] = m;
      }
      const top = Math.max(1, ...out);
      resolve(out.map(v => Math.round(v * 100 / top)));
    });
  });
}

let _filling = false;
function fill() {
  if (_filling) return;
  const { toDisk } = require('./media');
  const SND = require('./sounds-store');
  const MUSIC = require('./music-store');
  const stores = [
    { s: SND, key: (r) => r.audioPath },
    { s: MUSIC, key: (r) => r.audioPath },
  ];
  const want = [];
  for (const st of stores) {
    for (const r of st.s.read()) {
      if (!r || !r.id || (Array.isArray(r.wave) && r.wave.length)) continue;
      const abs = toDisk(st.key(r));
      if (abs && fs.existsSync(abs)) want.push({ st, id: String(r.id), abs });
    }
  }
  if (!want.length) return;
  _filling = true;
  (async () => {
    const got = new Map();
    for (const w of want) {
      const pk = await peaks(w.abs);
      if (pk.length) got.set(w.st.s.FILE + '|' + w.id, pk);
    }
    for (const st of stores) {
      const list = st.s.read();
      let n = 0;
      for (const r of list) {
        const pk = r && got.get(st.s.FILE + '|' + String(r.id));
        if (pk && !(Array.isArray(r.wave) && r.wave.length)) { r.wave = pk; n++; }
      }
      if (n) st.s.write(list);
    }
  })().catch(e => console.warn('[audio-wave] not measured:', e.message)).finally(() => { _filling = false; });
}

module.exports = { POINTS, peaks, fill };
