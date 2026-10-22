'use strict';

// ════════════════════════════════════════════════════════════════════════════
// CUTTING A PIECE OUT OF A SOUND (phase V34.C; the owner 2026-10-22, (з8): "вырезка тоже нужна") - as a video's piece is
// cut (lib/cuts.js): A PIECE IS A NEW SOUND, filed in the category of SFX -> My sounds the person chose; the sound it was
// cut from is not touched - a built-in one, one of their own, or a track of AUDIO -> Music.
//
// The piece keeps where it came from (`meta.original: { path, in, out, dur, name }`), and a piece of a piece names the
// first sound with the stretch in ITS time - so "the whole sound" is always one press away while it is there. (A sound
// is small: the whole one is not kept back from deleting for its pieces' sake, as a video is.)
//
//   cut(src, a, b, to: { cat, label }) -> the new record of data/sounds.json
// ════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { MEDIA } = require('./config');
const { toDiskExisting, toUrl } = require('./media');

const AUDIO_RE = /\.(mp3|wav|m4a|aac|ogg|oga|opus|flac|webm)$/i;
const clean = (p) => String(p || '').split('?')[0];

// Seconds as the name says them: short sounds to a tenth, long ones as m:ss.
const say = (s, long) => (long
  ? Math.floor(s / 60) + ':' + String(Math.round(s % 60)).padStart(2, '0')
  : (Math.round(s * 10) / 10).toFixed(1));

/** The whole sound a piece names, and the offset of `src`'s time in it. */
function rootOf(src) {
  const SND = require('./sounds-store');
  let cur = clean(src), at = 0;
  const mine = SND.findByPath(cur);
  let name = mine ? mine.name : '';
  for (let i = 0; i < 5; i++) {
    const r = SND.findByPath(cur);
    const o = r && r.meta && r.meta.original;
    if (!o || !o.path) break;
    const abs = toDiskExisting(o.path);
    if (!abs || !fs.existsSync(abs)) break;
    at += +o.in || 0;
    cur = clean(o.path);
    name = o.name || name;
  }
  if (!name) {
    const b = require('./sfx-builtin').byPath(cur);
    const m = !b && require('./music-store').read().find(t => t && clean(t.audioPath) === cur);
    name = (b && b.name) || (m && m.title) || path.posix.basename(cur).replace(/\.[^.]+$/, '');
  }
  return { path: cur, at, name };
}

function _encode(srcAbs, a, b, outAbs) {
  const ffmpegPath = require('ffmpeg-static');
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-ss', a.toFixed(3), '-t', (b - a).toFixed(3), '-i', srcAbs,
      '-vn', '-c:a', 'libmp3lame', '-q:a', '2', '-y', outAbs], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    let err = '';
    p.stderr.on('data', (c) => { err += c.toString(); });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error('could not cut the sound: ' + err.slice(-200)))));
  });
}

async function cut(src, a, b, to) {
  const abs0 = toDiskExisting(clean(src));
  if (!abs0 || !fs.existsSync(abs0) || !AUDIO_RE.test(abs0)) throw Object.assign(new Error('that sound is not on disk'), { status: 410 });
  const root = rootOf(src);
  const rootAbs = toDiskExisting(root.path);
  if (!rootAbs || !fs.existsSync(rootAbs)) throw Object.assign(new Error('the whole sound is not on disk'), { status: 410 });
  const full = (await require('./media-probe').probe(rootAbs)).duration || 0;
  const A = Math.max(0, Math.round((root.at + (+a || 0)) * 1000) / 1000);
  const B = Math.min(full || Infinity, Math.round((root.at + (+b || 0)) * 1000) / 1000);
  if (!(B - A >= 0.1)) throw Object.assign(new Error('the piece has to be at least 0.1 seconds long'), { status: 400 });
  fs.mkdirSync(MEDIA.work, { recursive: true });
  const base = path.basename(rootAbs, path.extname(rootAbs)).replace(/_cut_[a-z0-9]+$/i, '').slice(0, 60);
  const outAbs = path.join(MEDIA.work, base + '_cut_' + Date.now().toString(36) + '.mp3');
  await _encode(rootAbs, A, B, outAbs);
  const long = full >= 60;
  const name = (String(root.name || 'sound').slice(0, 80) + ' · ' + say(A, long) + '–' + say(B, long) + (long ? '' : ' s'));
  const t = to || {};
  const LC = require('./library-cats');
  const cat = t.cat && t.cat !== LC.UNCAT ? LC.find('sounds', String(t.cat)) : null;
  if (t.cat && t.cat !== LC.UNCAT && !cat) {
    try { fs.rmSync(outAbs, { force: true }); } catch (e) { /* held */ }
    throw Object.assign(new Error('no such category in My sounds'), { status: 400 });
  }
  let wave = [];
  try { wave = await require('./audio-wave').peaks(outAbs); } catch (e) { wave = []; }
  const { item } = await require('./sounds-store').add(toUrl(outAbs), {
    name, categoryId: cat ? cat.id : '', source: 'cut',
    meta: { original: { path: root.path, in: A, out: B, dur: Math.round(full * 100) / 100, name: String(root.name || '').slice(0, 120) } },
  });
  if (item && wave.length) _setWave(item.id, wave);
  return item;
}

// The tile's waveform on the record, written in one tick.
function _setWave(id, wave) {
  const SND = require('./sounds-store');
  const l = SND.read();
  const r = l.find(x => x && x.id === id);
  if (!r) return;
  r.wave = wave;
  SND.write(l);
}

module.exports = { cut, rootOf, setWave: _setWave };
