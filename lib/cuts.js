'use strict';

// ════════════════════════════════════════════════════════════════════════════
// CUTS (phase TG, block 7; the owner 2026-10-21: "вариант Б, но в обрезке можно галочкой отобразить оригинал, где бы этот
// кусок не находился и обрезать еще раз и создастся новый файл").
//
// A PIECE CUT OUT OF A VIDEO IS A NEW FILE AND A NEW TILE, filed where the person chose (routes/library.js POST
// /library/cut); the video it was cut from stays exactly as it was. The piece keeps the WHOLE video it came from:
//
//   original: { path, in, out, dur, name }   the whole video's address, the stretch in ITS time, its length and name
//
// so the piece's viewer can show the whole video again and cut another piece from it - again a new file. A piece cut
// from a piece names the first video (the root), with the stretch in that video's time: every piece of one video leads
// to the same whole one.
//
// THE WHOLE VIDEO'S FILE STAYS WHILE ANY PIECE NAMES IT: deleting its tile leaves the file (routes/library.js
// _pathsInUse, routes/references.js, lib/sources-store.js remove); the last piece deleted takes a whole video that
// nothing else holds - no record, no source, no timeline (`dropOrphans`).
//
// Records with files, read here: the clips of VIDEO (data/biroly.json, data/hooks-archive.json), the posts of REFERENCES
// (each file of a post may be a piece: `media[].original`) and the scenario sources (YOUTUBE).
// ════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const { DATA_DIR, MEDIA } = require('./config');
const { toDiskExisting, toUrl } = require('./media');

const VIDEO_RE = /\.(mp4|mov|webm|mkv|m4v)$/i;
const clean = (p) => String(p || '').split('?')[0];

function _json(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return fallback; }
}

// Every record that holds a video file: { where, id, name, path, original, link, post?, file? }.
function records() {
  const out = [];
  const bir = _json(path.join(DATA_DIR, 'biroly.json'), {});
  for (const e of (Array.isArray(bir.archive) ? bir.archive : [])) {
    if (e && e.videoPath) out.push({ where: 'birols', id: String(e.id), name: e.name || '', path: clean(e.videoPath), original: e.original || null, link: e.link || '' });
  }
  const hooks = _json(path.join(DATA_DIR, 'hooks-archive.json'), []);
  for (const h of (Array.isArray(hooks) ? hooks : [])) {
    if (h && h.videoPath) out.push({ where: 'hooks', id: String(h.id || ''), name: h.name || '', path: clean(h.videoPath), original: h.original || null, link: h.link || '' });
  }
  let posts = [];
  try { posts = require('./references-store').read(); } catch (e) { posts = []; }
  for (const p of posts) {
    for (const m of ((p && p.media) || [])) {
      if (m && m.path) out.push({ where: 'references', id: String(p.id), file: String(m.id), name: p.title || '', path: clean(m.path), original: m.original || null, link: p.link || '', post: p });
    }
  }
  let sources = [];
  try { sources = require('./sources-store').list(); } catch (e) { sources = []; }
  for (const s of sources) {
    if (s && s.videoPath) out.push({ where: 'sources', id: String(s.id), name: s.title || '', path: clean(s.videoPath), original: null, link: s.url || '' });
  }
  return out;
}

const _onDisk = (u) => { const abs = toDiskExisting(u); return !!(abs && fs.existsSync(abs)); };

/** The whole video a file was cut from, when it still is on disk - null for a file that is not a piece. */
function originalOf(src) {
  const r = records().find(x => x.path === clean(src) && x.original && x.original.path);
  return r && _onDisk(r.original.path) ? r.original : null;
}

/**
 * Where a cut of `src` is really taken from: its root (the whole video a piece names), and the offset of `src`'s time in
 * the root's. `{ path, at, name, link, post }` - `post` the REFERENCES post the file belongs to, when it does.
 */
function rootOf(src) {
  const all = records();
  let at = 0;
  let cur = clean(src);
  const mine = all.find(x => x.path === cur) || null;
  let name = mine ? mine.name : '';
  for (let i = 0; i < 5; i++) {
    const r = all.find(x => x.path === cur && x.original && x.original.path);
    if (!r || !_onDisk(r.original.path)) break;
    at += +r.original.in || 0;
    cur = clean(r.original.path);
    name = r.original.name || (all.find(x => x.path === cur) || {}).name || name;
  }
  if (!name) name = path.posix.basename(cur).replace(/\.[^.]+$/, '');
  return { path: cur, at, name, link: mine ? mine.link : '', post: mine && mine.post ? mine.post : null };
}

/** Every whole video some piece names - but the pieces of `skip` (record ids, or "<post>:<file>" for a post's file). */
function originalsInUse(skip) {
  const no = new Set((skip || []).map(String));
  const used = new Set();
  for (const r of records()) {
    if (!r.original || !r.original.path) continue;
    if (no.has(r.id) || (r.file && no.has(r.id + ':' + r.file))) continue;
    used.add(clean(r.original.path));
  }
  return used;
}

/** Is this file held by anything: a record's own file, a piece naming it, a source, a timeline. */
function held(u) {
  const p = clean(u);
  for (const r of records()) {
    if (r.path === p) return true;
    if (r.original && clean(r.original.path) === p) return true;
  }
  try { if (require('./timeline-media').usage([p]).length) return true; } catch (e) { return true; }
  return false;
}

/**
 * The whole videos of pieces just deleted (their records gone already) that nothing holds any more: deleted, each with
 * what is derived from it (lib/relocate.js siblingsOf). Returns the names of the files removed.
 */
function dropOrphans(paths) {
  const { siblingsOf } = require('./relocate');
  const removed = [];
  for (const u of new Set((paths || []).filter(Boolean).map(clean))) {
    if (held(u)) continue;
    const abs = toDiskExisting(u);
    if (!abs || !fs.existsSync(abs) || !VIDEO_RE.test(abs)) continue;
    let derived = [];
    try { derived = siblingsOf(abs, path.basename(abs)).map(([a]) => a); } catch (e) { derived = []; }
    try { fs.rmSync(abs, { force: true }); removed.push(path.basename(abs)); } catch (e) { continue; }
    for (const d of derived) { try { fs.rmSync(d, { force: true }); } catch (e) { /* held */ } }
  }
  return removed;
}

// ── ffmpeg ───────────────────────────────────────────────────────────────────
// The length and the frame of a file, from ffmpeg's own report.
function probe(abs) {
  const ffmpegPath = require('ffmpeg-static');
  return new Promise((resolve) => {
    const proc = require('child_process').spawn(ffmpegPath, ['-hide_banner', '-i', abs], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    let out = '';
    proc.stderr.on('data', c => { out += c.toString(); });
    proc.on('close', () => {
      const d = out.match(/Duration:\s*(\d+):(\d+):(\d+\.?\d*)/);
      const v = out.match(/Video:[^\n]*?\s(\d{2,5})x(\d{2,5})[\s,]/);
      let w = v ? +v[1] : 0, h = v ? +v[2] : 0;
      // A phone's clip stored on its side says so in its rotation.
      if (/rotate\s*:\s*-?(90|270)/.test(out) || /rotation of -?(90|270)/.test(out)) [w, h] = [h, w];
      resolve({ dur: d ? (+d[1] * 3600 + +d[2] * 60 + parseFloat(d[3])) : 0, w, h });
    });
    proc.on('error', () => resolve({ dur: 0, w: 0, h: 0 }));
  });
}

// RE-ENCODED, not stream-copied: a copy can only begin on a keyframe, a second or two from where the handle was put,
// and the whole point of a cut is where.
function encode(srcAbs, a, b, outAbs) {
  const ffmpegPath = require('ffmpeg-static');
  return new Promise((resolve, reject) => {
    const proc = require('child_process').spawn(ffmpegPath, [
      '-hide_banner', '-loglevel', 'error',
      '-ss', a.toFixed(3), '-t', (b - a).toFixed(3), '-i', srcAbs,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', '-y', outAbs,
    ], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    let err = '';
    proc.stderr.on('data', c => { err += c.toString(); });
    proc.on('close', code => code === 0 ? resolve() : reject(new Error('could not cut the video: ' + err.slice(-200))));
    proc.on('error', reject);
  });
}

const mmss = (s) => {
  const t = Math.max(0, Math.round(+s || 0));
  return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0');
};

/**
 * Cut `src` from `a` to `b` (seconds in src's own time) into a new file in media/work/ - taken from the ROOT, so a piece
 * of a piece is one generation from the whole video. Returns { videoPath, dur, w, h, original, name, root } - the caller
 * files it (and so moves it out of work/).
 */
async function cut(src, a, b) {
  const abs0 = toDiskExisting(clean(src));
  if (!abs0 || !fs.existsSync(abs0) || !VIDEO_RE.test(abs0)) {
    const e = new Error('that video is not on disk'); e.status = 410; throw e;
  }
  const root = rootOf(src);
  const rootAbs = toDiskExisting(root.path);
  if (!rootAbs || !fs.existsSync(rootAbs)) { const e = new Error('the whole video is not on disk'); e.status = 410; throw e; }
  const full = (await probe(rootAbs)).dur;
  const A = Math.max(0, Math.round((root.at + (+a || 0)) * 100) / 100);
  const B = Math.min(full || Infinity, Math.round((root.at + (+b || 0)) * 100) / 100);
  if (!(B - A >= 0.3)) { const e = new Error('the piece has to be at least 0.3 seconds long'); e.status = 400; throw e; }
  fs.mkdirSync(MEDIA.work, { recursive: true });
  const base = path.basename(rootAbs, path.extname(rootAbs)).replace(/_cut_[a-z0-9]+$/i, '').slice(0, 80);
  const outAbs = path.join(MEDIA.work, base + '_cut_' + Date.now().toString(36) + '.mp4');
  await encode(rootAbs, A, B, outAbs);
  const got = await probe(outAbs);
  return {
    videoPath: toUrl(outAbs),
    dur: Math.round((got.dur || (B - A)) * 100) / 100, w: got.w, h: got.h,
    original: { path: root.path, in: A, out: B, dur: Math.round(full * 100) / 100, name: String(root.name || '').slice(0, 120) },
    name: (String(root.name || 'video').slice(0, 90) + ' · ' + mmss(A) + '–' + mmss(B)),
    root,
  };
}

module.exports = { records, originalOf, rootOf, originalsInUse, held, dropOrphans, probe, cut, mmss };
