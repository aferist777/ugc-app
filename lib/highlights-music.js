'use strict';

/* highlights-music.js - the background music of a highlights project's fragments (phase V33.8, H3; the owner 2026-10-23,
   (п1), (ф3), (ф5): "чтобы пользователь в попапе создания highlights проекта мог выбрать в дропдауне аудио ... если выбрано
   треков несколько наложились на хайлайт. либо один трек на все"; "давай со случайного, но чтобы активная часть музыки была
   во фрагменте хайлайта. типа середина").

   WHAT IS OFFERED: everything in Music -> highlights - its ten mood folders and its root (lib/music-store.js highlights(),
   phase V34.F; GET /api/audio/music/highlights).
   (phase V68 P3, the owner 2026-11-01, (хп6), (хп20), (хп39): "пользователь будет выбирать не конкретно трек, а под конкретный
   тип проекта"; "каждому свой") The popup ticks MOODS, not tracks - and "yours", the root, when it has tracks ((хп51)); the
   press sends `moods` and `ofMoods` turns them into the tracks of those moods (ask.music, the same shape as before, and
   ask.moods). A project of before has ask.music of ticked tracks and no moods - read as it was.
   WHO GETS WHICH (`deal`): ONE track a fragment, none twice while there are tracks left - the moods taken in turn so a mix of
   them is even, each mood's tracks in a shuffled order; past the last track a new round. A fragment keeps its track on its
   record (`music`).
   WHERE IN THE TRACK: not the intro nor the ending but where the music has opened up - its ACTIVE PART, by loudness: the
   track's loudness every half second (cache/music-env/, made again when missing), smoothed over three seconds; active is
   within 6 dB of its loud end (the 90th percentile), the first 12% and the last 8% left out while there is room; a window the
   fragment's length is taken AT RANDOM among the loudest ones inside it. A track shorter than the fragment plays from its
   start and again.
   HOW IT LIES: on the fragment's "audio 2" lane from 0 to its end - a bed (never heard for captions), volume 0.18, rising
   over half a second and fading out over the last one and a half (`clipsFor`, laid by lib/highlights-cut.js layOut). */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { CACHE_DIR } = require('./config');
const { toDiskExisting } = require('./media');
const { writeFileAtomic } = require('./atomic-write');

const VOLUME = 0.18;
const FADE_IN = 0.5;
const FADE_OUT = 1.5;
const STEP = 0.5;            // seconds a loudness point
const SMOOTH = 3;            // seconds the loudness is smoothed over
const BELOW = 6;             // dB under the loud end that still counts as active
const SKIP_HEAD = 0.12, SKIP_TAIL = 0.08;
const NEAR_BEST = 1.5;       // dB: the windows taken at random are within this of the loudest
const MAX_TRACKS = 400;
const YOURS = 'yours';       // (V68 P3, (хп51)) the root of Music -> highlights - the person's own tracks
const ENV_DIR = path.join(CACHE_DIR, 'music-env');
const r2 = (t) => Math.round((+t || 0) * 100) / 100;

function _store() { return require('./music-store'); }

/** Music -> highlights as the popup shows it: { moods: [{ id, label, about, tracks }], root: [tracks] }. */
function offered() {
  const M = _store();
  if (typeof M.highlights !== 'function') return { moods: [], root: [] };
  try { return M.highlights(); } catch (e) { return { moods: [], root: [] }; }
}

/**
 * (V68 P3) The moods ticked in the popup - mood ids of Music -> highlights and `yours` (its root) - as the tracks in them now:
 * { moods: [{ id, label }] - those that have tracks, in the order given; tracks: [{ id, title, path, dur, mood }] }.
 */
function ofMoods(ids) {
  const want = [...new Set((Array.isArray(ids) ? ids : []).map(String).filter(Boolean))];
  const o = offered();
  const moods = [];
  const tracks = [];
  for (const id of want) {
    const m = id === YOURS ? { id: YOURS, label: 'yours', tracks: o.root } : o.moods.find((x) => x.id === id);
    if (!m || !Array.isArray(m.tracks) || !m.tracks.length) continue;
    moods.push({ id, label: String(m.label || id).slice(0, 60) });
    for (const t of m.tracks) {
      if (tracks.length >= MAX_TRACKS || tracks.some((x) => x.id === String(t.id))) continue;
      tracks.push({ id: String(t.id), title: String(t.title || 'track').slice(0, 120), path: String(t.path), dur: +t.dur || 0, mood: id });
    }
  }
  return { moods, tracks };
}

const _shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

/**
 * `tracks` dealt to `n` fragments (V68 P3, (хп39)): one each, none twice while any is left. The moods (`mood` of a track; a
 * project of before has none - one group) are taken in turn from a shuffled order, each mood's tracks shuffled; a mood used up
 * gives its turn to the next that has some; when every track has been dealt, a new round. [null...] for no tracks.
 */
function deal(tracks, n) {
  const list = (tracks || []).filter((t) => t && t.path);
  if (!list.length) return Array.from({ length: n }, () => null);
  const groups = new Map();
  for (const t of list) {
    const g = String(t.mood || '');
    if (!groups.has(g)) groups.set(g, []);
    if (!groups.get(g).some((x) => x.id === t.id)) groups.get(g).push(t);
  }
  const order = _shuffle([...groups.keys()]);
  const decks = new Map();
  const refill = () => { for (const g of order) decks.set(g, _shuffle(groups.get(g).slice())); };
  refill();
  let turn = 0;
  const out = [];
  for (let k = 0; k < n; k++) {
    let g = null;
    for (let i = 0; i < order.length && g == null; i++) {
      const c = order[(turn + i) % order.length];
      if (decks.get(c).length) { g = c; turn = (turn + i + 1) % order.length; }
    }
    if (g == null) { refill(); g = order[turn % order.length]; turn = (turn + 1) % order.length; }
    out.push({ ...decks.get(g).pop() });
  }
  return out;
}

// ── The track's loudness, every half second ─────────────────────────────────
function _envKey(abs) {
  const st = fs.statSync(abs);
  return crypto.createHash('sha1').update(abs.toLowerCase() + '|' + st.size + '|' + Math.round(st.mtimeMs)).digest('hex');
}

function _measure(abs) {
  return new Promise((resolve, reject) => {
    const rate = 8000;
    const per = Math.round(rate * STEP);
    const p = spawn(require('ffmpeg-static'), ['-hide_banner', '-nostdin', '-v', 'error', '-i', abs, '-vn', '-ac', '1', '-ar', String(rate),
      '-f', 's16le', '-'], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
    const db = [];
    let acc = 0, cnt = 0, carry = null;
    p.stdout.on('data', (b) => {
      if (carry) { b = Buffer.concat([carry, b]); carry = null; }
      const n = Math.floor(b.length / 2);
      for (let i = 0; i < n; i++) {
        const v = b.readInt16LE(i * 2) / 32768;
        acc += v * v;
        if (++cnt === per) { db.push(Math.round(Math.max(-80, 10 * Math.log10(acc / cnt + 1e-12)) * 10) / 10); acc = 0; cnt = 0; }
      }
      if (b.length % 2) carry = b.subarray(b.length - 1);
    });
    p.on('error', reject);
    p.on('close', (code) => {
      if (cnt > per / 4) db.push(Math.round(Math.max(-80, 10 * Math.log10(acc / cnt + 1e-12)) * 10) / 10);
      if (code !== 0 && !db.length) return reject(new Error('the track could not be read'));
      resolve({ v: 1, step: STEP, dur: r2(db.length * STEP), db });
    });
  });
}

/** { step, dur, db: [...] } of a track's file - kept in cache/music-env/ (made again when missing or changed). */
async function envelope(abs) {
  const file = path.join(ENV_DIR, _envKey(abs) + '.json');
  try { const e = JSON.parse(fs.readFileSync(file, 'utf8')); if (e && e.v === 1 && Array.isArray(e.db)) return e; } catch (err) { /* measured now */ }
  const e = await _measure(abs);
  try { fs.mkdirSync(ENV_DIR, { recursive: true }); writeFileAtomic(file, JSON.stringify(e)); } catch (err) { /* measured again next time */ }
  return e;
}

/**
 * Where in the track a window of `len` seconds starts: at random among the loudest windows inside its active part.
 * `rand` - a number 0..1 (Math.random by default). Returns { at, active: [a, b] } in seconds.
 */
function placeIn(env, len, rand) {
  const R = rand == null ? Math.random() : rand;
  const db = env.db || [];
  const n = db.length;
  const dur = n * STEP;
  if (!n || dur <= len + STEP) return { at: 0, active: [0, dur] };
  const pow = db.map((d) => Math.pow(10, d / 10));
  const k = Math.max(1, Math.round(SMOOTH / STEP));
  const sm = pow.map((_, i) => {
    let s = 0, c = 0;
    for (let j = Math.max(0, i - (k >> 1)); j < Math.min(n, i - (k >> 1) + k); j++) { s += pow[j]; c++; }
    return 10 * Math.log10(s / c + 1e-12);
  });
  const sorted = sm.slice().sort((a, b) => a - b);
  const top = sorted[Math.min(n - 1, Math.floor(n * 0.9))];
  let a = sm.findIndex((d) => d >= top - BELOW);
  let b = n - 1 - sm.slice().reverse().findIndex((d) => d >= top - BELOW);
  if (a < 0) { a = 0; b = n - 1; }
  const w = Math.max(1, Math.round(len / STEP));
  // The intro and the ending left out, while the active part still holds the window.
  const ha = Math.max(a, Math.floor(n * SKIP_HEAD)), hb = Math.min(b, Math.ceil(n * (1 - SKIP_TAIL)) - 1);
  if (hb - ha + 1 >= w) { a = ha; b = hb; }
  if (b - a + 1 < w) {
    // Shorter than the fragment: the window over its middle, inside the track.
    const mid = (a + b + 1) / 2;
    const at = Math.max(0, Math.min(n - w, Math.round(mid - w / 2)));
    return { at: r2(at * STEP), active: [r2(a * STEP), r2((b + 1) * STEP)] };
  }
  // Every window inside it, by its loudness; one of the loudest at random.
  const cum = [0];
  for (let i = 0; i < n; i++) cum.push(cum[i] + pow[i]);
  const cands = [];
  for (let s = a; s + w - 1 <= b; s++) cands.push([s, 10 * Math.log10((cum[s + w] - cum[s]) / w + 1e-12)]);
  const best = Math.max(...cands.map((c) => c[1]));
  const good = cands.filter((c) => c[1] >= best - NEAR_BEST);
  const s = good[Math.min(good.length - 1, Math.floor(R * good.length))][0];
  return { at: r2(s * STEP), active: [r2(a * STEP), r2((b + 1) * STEP)] };
}

/**
 * The clips of a fragment `len` seconds long for its track `t` ({ id, title, path }): from its active part, a bed at 0.18,
 * rising and fading. [] when the track is not there any more (deleted from Music since) - the fragment is made without it.
 */
async function clipsFor(t, len, rand) {
  if (!t || !t.path || !(len > 0)) return [];
  const abs = toDiskExisting(t.path);
  if (!abs || !fs.existsSync(abs)) return [];
  const env = await envelope(abs);
  const dur = +env.dur || +t.dur || 0;
  if (!(dur > 0.5)) return [];
  const base = { src: t.path, name: String(t.title || 'music'), libId: String(t.id || '') || null, srcDur: r2(dur), speed: 1, reversed: false,
    transition: null, animation: null, filter: null, thumb: null, poster: null, volume: VOLUME, bed: true, pairId: null, fit: null, cropAlign: null };
  const out = [];
  if (dur >= len) {
    const at = Math.min(placeIn(env, len, rand).at, Math.max(0, dur - len));
    out.push({ ...base, start: 0, dur: r2(len), trimIn: r2(at), trimOut: r2(Math.max(0, dur - at - len)) });
  } else {
    // Shorter than the fragment: from its start, again and again.
    for (let s = 0; s < len - 0.05; s += dur) {
      const d = Math.min(dur, len - s);
      out.push({ ...base, start: r2(s), dur: r2(d), trimIn: 0, trimOut: r2(Math.max(0, dur - d)) });
    }
  }
  out[0].fadeIn = FADE_IN;
  out[out.length - 1].fadeOut = Math.min(FADE_OUT, out[out.length - 1].dur / 2);
  return out;
}

module.exports = { VOLUME, FADE_IN, FADE_OUT, YOURS, offered, ofMoods, deal, envelope, placeIn, clipsFor };
