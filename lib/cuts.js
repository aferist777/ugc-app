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
// SEVERAL PIECES AT ONCE (phase V81, the owner 2026-11-09): `cutMany` - the fragments drawn over one video (js/cuts/parts.js, the
// rule the page draws them by), each a piece of its own one after another (each filed by the caller as it is made), or ALL
// JOINED into one file in the order of time, the sound faded at each seam (SEAM_FADE). A joined piece keeps
// `original: { path, parts: [{ in, out }], in, out, dur, name }` - its time is not a stretch of the whole video's, so a piece
// cut from it is cut from IT (rootOf stops there). Stopped (`signal`): the pieces made stay, the one being made goes.
//
// Records with files, read here: the clips of VIDEO (data/biroly.json, data/hooks-archive.json), the posts of REFERENCES
// (each file of a post may be a piece: `media[].original`) and the scenario sources (YOUTUBE).
// ════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const { DATA_DIR, MEDIA, ROOT_DIR } = require('./config');
// (phase V43) The app writes and deletes only inside the library - a source's video may stay on the person's disk.
const _inLibrary = (abs) => { const r = path.resolve(ROOT_DIR).toLowerCase(), p = path.resolve(String(abs)).toLowerCase(); return p.startsWith(r + path.sep); };
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
    // (phase V81) A joined piece is its own whole: its seconds are no stretch of the video it was joined from.
    if (Array.isArray(r.original.parts)) break;
    at += +r.original.in || 0;
    cur = clean(r.original.path);
    name = r.original.name || (all.find(x => x.path === cur) || {}).name || name;
  }
  // A whole video whose own tile is gone is still known by its pieces: their `original.name`, their link.
  const piece = all.find(x => x.original && clean(x.original.path) === cur);
  if (!name && piece) name = piece.original.name || '';
  if (!name) name = path.posix.basename(cur).replace(/\.[^.]+$/, '');
  const link = (mine && mine.link) || (piece && piece.link) || '';
  return { path: cur, at, name, link, post: (mine && mine.post) || (piece && piece.post) || null };
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
    if (!abs || !fs.existsSync(abs) || !VIDEO_RE.test(abs) || !_inLibrary(abs)) continue;
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

const OUT_ARGS = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p',
  '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart'];

// One ffmpeg, killed when `signal` says stop (phase V81) - its half-made file goes.
function _run(args, outAbs, signal, what) {
  const ffmpegPath = require('ffmpeg-static');
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) { reject(Object.assign(new Error('stopped'), { stopped: true })); return; }
    const proc = require('child_process').spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    let err = '';
    const stop = () => { try { proc.kill(); } catch (e) { /* gone */ } };
    if (signal) signal.addEventListener('abort', stop, { once: true });
    proc.stderr.on('data', c => { err += c.toString(); if (err.length > 20000) err = err.slice(-4000); });
    proc.on('close', code => {
      if (signal) signal.removeEventListener('abort', stop);
      if (code === 0 && !(signal && signal.aborted)) { resolve(); return; }
      try { fs.rmSync(outAbs, { force: true }); } catch (e) { /* held */ }
      if (signal && signal.aborted) reject(Object.assign(new Error('stopped'), { stopped: true }));
      else reject(new Error('could not ' + what + ': ' + err.slice(-200)));
    });
    proc.on('error', reject);
  });
}

// RE-ENCODED, not stream-copied: a copy can only begin on a keyframe, a second or two from where the handle was put,
// and the whole point of a cut is where.
function encode(srcAbs, a, b, outAbs, signal) {
  return _run(['-hide_banner', '-loglevel', 'error', '-ss', a.toFixed(3), '-t', (b - a).toFixed(3), '-i', srcAbs,
    ...OUT_ARGS, '-y', outAbs], outAbs, signal, 'cut the video');
}

// (phase V81) The fragments joined in the order given, into one file. Up to JOIN_INPUTS fragments each is an input of its own
// (read from its moment, exactly) and the sound fades out and in at every seam; more - one input and select/aselect, the
// render's way (lib/mv3b-render.js runSelect). The graph goes in a file: a long one would pass Windows' command line.
const JOIN_INPUTS = 40;
async function encodeJoined(srcAbs, parts, hasSound, outAbs, signal) {
  const { SEAM_FADE } = require('../public/js/cuts/parts.js');
  const f3 = (v) => (+v).toFixed(3);
  const args = ['-hide_banner', '-loglevel', 'error'];
  let graph = '';
  if (parts.length <= JOIN_INPUTS) {
    parts.forEach((p) => args.push('-ss', f3(p.in), '-t', f3(p.out - p.in), '-i', srcAbs));
    const ins = [];
    parts.forEach((p, i) => {
      const len = p.out - p.in;
      graph += `[${i}:v:0]setpts=PTS-STARTPTS[v${i}];`;
      if (hasSound) {
        const fd = Math.min(SEAM_FADE, len / 4);
        graph += `[${i}:a:0]asetpts=PTS-STARTPTS,aformat=channel_layouts=stereo,afade=t=in:d=${f3(fd)},`
          + `afade=t=out:st=${f3(Math.max(0, len - fd))}:d=${f3(fd)}[a${i}];`;
        ins.push(`[v${i}][a${i}]`);
      } else ins.push(`[v${i}]`);
    });
    graph += ins.join('') + `concat=n=${parts.length}:v=1:a=${hasSound ? 1 : 0}[v]` + (hasSound ? '[a]' : '');
  } else {
    args.push('-i', srcAbs);
    // Half open - between() takes the frame on the end too, a frame a piece too many.
    const when = parts.map((p) => `gte(t,${f3(p.in)})*lt(t,${f3(p.out)})`).join('+');
    graph = `[0:v:0]select='${when}',setpts=N/FRAME_RATE/TB[v]`;
    if (hasSound) graph += `;[0:a:0]aselect='${when}',asetpts=N/SR/TB[a]`;
  }
  const { TEMP_DIR } = require('./config');
  fs.mkdirSync(TEMP_DIR, { recursive: true });
  const script = path.join(TEMP_DIR, 'join_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6) + '.txt');
  fs.writeFileSync(script, graph);
  try {
    await _run([...args, '-filter_complex_script', script, '-map', '[v]', ...(hasSound ? ['-map', '[a]'] : []),
      ...OUT_ARGS, '-y', outAbs], outAbs, signal, 'join the pieces');
  } finally {
    try { fs.rmSync(script, { force: true }); } catch (e) { /* held */ }
  }
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
async function cut(src, a, b, opts) {
  const o = opts || {};
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
  const outAbs = _outFile(rootAbs);
  await encode(rootAbs, A, B, outAbs, o.signal);
  const got = await probe(outAbs);
  return {
    videoPath: toUrl(outAbs),
    dur: Math.round((got.dur || (B - A)) * 100) / 100, w: got.w, h: got.h,
    original: { path: root.path, in: A, out: B, dur: Math.round(full * 100) / 100, name: String(root.name || '').slice(0, 120) },
    name: (String(root.name || 'video').slice(0, 90) + (o.label ? ' · ' + String(o.label).slice(0, 40) : '')
      + ' · ' + mmss(A) + '–' + mmss(B)),
    root,
  };
}

// A new piece's file in media/work/: the whole video's name, "_cut_", the moment and a few random letters - two pieces of
// one press are made within a millisecond of each other (phase V81).
function _outFile(rootAbs) {
  fs.mkdirSync(MEDIA.work, { recursive: true });
  const base = path.basename(rootAbs, path.extname(rootAbs)).replace(/_cut_[a-z0-9]+$/i, '').slice(0, 80);
  return path.join(MEDIA.work, base + '_cut_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5) + '.mp4');
}

/**
 * (phase V81) The fragments `parts` ([{ in, out, label? }] in `src`'s own seconds - js/cuts/parts.js normParts) cut out of
 * `src`: `join` - one file of all of them in the order of time; else each a piece of its own, one after another. Every piece
 * made is handed to `onPart(made, i, n)` (awaited - the caller files it) as cut() returns it; `onTotal(n)` first. Stopped by
 * `signal`: what was made stays, the rest is not made (throws { stopped: true }).
 */
async function cutMany(src, parts, opts) {
  const o = opts || {};
  const P = require('../public/js/cuts/parts.js');
  const abs0 = toDiskExisting(clean(src));
  if (!abs0 || !fs.existsSync(abs0) || !VIDEO_RE.test(abs0)) {
    const e = new Error('that video is not on disk'); e.status = 410; throw e;
  }
  const root = rootOf(src);
  const rootAbs = toDiskExisting(root.path);
  if (!rootAbs || !fs.existsSync(rootAbs)) { const e = new Error('the whole video is not on disk'); e.status = 410; throw e; }
  const full = (await probe(rootAbs)).dur;
  const list = P.normParts((parts || []).map((p) => ({ in: root.at + (+p.in || 0), out: root.at + (+p.out || 0), label: p.label })), full);
  if (!list.length) { const e = new Error('draw a fragment of at least ' + P.MIN_PART + ' seconds first'); e.status = 400; throw e; }
  if (!o.join) {
    if (typeof o.onTotal === 'function') o.onTotal(list.length);
    for (let i = 0; i < list.length; i++) {
      if (o.signal && o.signal.aborted) throw Object.assign(new Error('stopped'), { stopped: true });
      const p = list[i];
      const made = await cut(src, p.in - root.at, p.out - root.at, { signal: o.signal, label: p.label });
      if (typeof o.onPart === 'function') await o.onPart(made, i, list.length);
    }
    return { n: list.length };
  }
  if (typeof o.onTotal === 'function') o.onTotal(1);
  const hasSound = (await require('./audio-tracks').tracksOf(rootAbs)).length > 0;
  const outAbs = _outFile(rootAbs);
  await encodeJoined(rootAbs, list, hasSound, outAbs, o.signal);
  const got = await probe(outAbs);
  const len = P.joinedLen(list);
  const made = {
    videoPath: toUrl(outAbs),
    dur: Math.round((got.dur || len) * 100) / 100, w: got.w, h: got.h,
    original: { path: root.path, parts: list.map((p) => ({ in: p.in, out: p.out })), in: list[0].in, out: list[list.length - 1].out,
      dur: Math.round(full * 100) / 100, name: String(root.name || '').slice(0, 120) },
    name: String(root.name || 'video').slice(0, 90) + ' · ' + list.length + (list.length === 1 ? ' piece' : ' pieces') + ' · ' + mmss(len),
    root,
  };
  if (typeof o.onPart === 'function') await o.onPart(made, 0, 1);
  return { n: 1 };
}

module.exports = { records, originalOf, rootOf, originalsInUse, held, dropOrphans, probe, cut, cutMany, mmss };
