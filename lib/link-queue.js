'use strict';

// ════════════════════════════════════════════════════════════════════════════
// LINKS ONTO THE SHELF (phase V27, the owner 2026-10-12: "давай все таки на полки медиа, панель library в merge и
// видеочат все таки добавим по ссылке добавление").
//
// One queue on the server for the three places a clip comes in by a link - the Library's Media shelf, Merge's
// Library panel and the video chat's picker. One link at a time, the rest wait; the pages only follow
// (GET /api/links). A page left goes on downloading; the app closed loses what was not in yet (the jobs are
// memory, as the Sources' are) - the link is added again.
//
//   add({ url, kind, project, from, meta }) -> job   kind: birols | uploads | hooks; from: media | merge | chat;
//                                                   meta: the link read already (lib/ytdlp.js info) - a vertical video
//                                                   the Sources window sends onto Uploads (phase V28.1) is not read twice
//   list(ids) -> [job]   get(id) -> job   stop(id) -> job
//
// A job: { id, url, kind, from, state: waiting|running|done|error|stopped, step (in words, yt-dlp's "40% of 23MB ·
// 0:12 left"), name, items: [{ id, name, videoPath, thumbPath, duration, kind }], had, error, at, endAt }.
//
// What a clip becomes is what a FILE brought in becomes there: on Media and Merge's panel the record of
// POST /library/media/record (routes/library.js fileRecord - the kind open, no category, a hook's
// number); from the video chat the record of its own upload (lib/birols-store.js add - Uploads, the project's
// category, its length and size), which the place over the box then holds. Each keeps the link and its key.
//
// The best there is (lib/ytdlp.js), no login. A post of several videos (an Instagram carousel) gives every one of
// them to a shelf - "<name> · 2 of 3" - and its first to the chat's one place. The same video under another spelling
// of its address is on the shelf already: a shelf says where; the chat simply takes that clip.
// ════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { MEDIA } = require('./config');
const YTDLP = require('./ytdlp');

const KINDS = ['birols', 'uploads', 'hooks'];
const FROM = ['media', 'merge', 'chat'];
const KEEP_MS = 60 * 60 * 1000;            // a finished job is answered for an hour, then forgotten
const VIDEO_RE = /\.(mp4|webm|mkv|mov|m4v)$/i;
const KIND_WORD = { birols: 'B-rolls', uploads: 'Uploads', hooks: 'Hooks' };

const _jobs = new Map();
const _waiting = [];
let _current = null;                       // { id, stop }

function _view(j) {
  if (!j) return null;
  const { _stem, _meta, ...rest } = j;
  return { ...rest };
}

function _sweep() {
  const cut = Date.now() - KEEP_MS;
  for (const [id, j] of _jobs) if (j.endAt && j.endAt < cut) _jobs.delete(id);
}

function add({ url, kind, project, from, meta }) {
  _sweep();
  const f = FROM.includes(from) ? from : 'media';
  const j = {
    id: 'lk_' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex'),
    url: String(url || '').trim(),
    // The chat files what it brings in on Uploads, as its own upload does.
    kind: f === 'chat' ? 'uploads' : (KINDS.includes(kind) ? kind : 'uploads'),
    project: String(project || ''),
    from: f,
    state: 'waiting', step: 'waiting', name: '', items: [], had: false, error: '',
    at: new Date().toISOString(), endAt: 0,
    _meta: meta && typeof meta === 'object' ? meta : null,
  };
  _jobs.set(j.id, j);
  _waiting.push(j.id);
  _next();
  return _view(j);
}

function get(id) { return _view(_jobs.get(String(id))); }

function list(ids) {
  _sweep();
  const want = Array.isArray(ids) && ids.length ? ids.map(String) : [..._jobs.keys()];
  return want.map(id => _view(_jobs.get(id))).filter(Boolean);
}

// A waiting one leaves the queue; the running one is killed where it is (yt-dlp, then what it left in work/).
function stop(id) {
  const j = _jobs.get(String(id));
  if (!j) return null;
  if (j.state === 'waiting') {
    const i = _waiting.indexOf(j.id);
    if (i >= 0) _waiting.splice(i, 1);
    _end(j, 'stopped', 'stopped');
  } else if (j.state === 'running' && _current && _current.id === j.id) {
    j.stopping = true;
    if (_current.stop) _current.stop();
  }
  return _view(j);
}

function _end(j, state, step, error) {
  j.state = state;
  j.step = step || state;
  if (error) j.error = error;
  j.endAt = Date.now();
}

function _next() {
  if (_current || !_waiting.length) return;
  const j = _jobs.get(_waiting.shift());
  if (!j) return _next();
  _current = { id: j.id, stop: null };
  _run(j).catch(e => { if (j.state === 'running') _end(j, 'error', 'failed', e.message); })
    .finally(() => { _cleanup(j); _current = null; _next(); });
}

// Every record of the Media shelf's clips - B-rolls, Uploads, Hooks - that came by a link.
function _onShelf(meta) {
  const BS = require('./birols-store');
  let hooks = [];
  try { const h = JSON.parse(fs.readFileSync(path.join(require('./config').DATA_DIR, 'hooks-archive.json'), 'utf8')); hooks = Array.isArray(h) ? h : []; }
  catch (e) { hooks = []; }
  const same = (r) => r && r.videoPath && ((meta.key && r.linkKey === meta.key) || (r.link && r.link === meta.url));
  const a = BS.read().find(same);
  if (a) return { rec: a, kind: a.source === 'upload' ? 'uploads' : 'birols' };
  const h = hooks.find(same);
  return h ? { rec: h, kind: 'hooks' } : null;
}

function _item(rec, kind) {
  return { id: rec.id, name: rec.name || '', videoPath: rec.videoPath, thumbPath: rec.thumbPath || null,
    duration: +rec.duration || 0, kind };
}

async function _run(j) {
  j.state = 'running';
  j.step = 'reading the link';
  const meta = j._meta || await YTDLP.info(j.url, { onProgress: (s) => { j.step = s; } });
  j.name = meta.label;
  if (j.stopping) return _end(j, 'stopped', 'stopped');

  const had = _onShelf(meta);
  if (had) {
    if (j.from === 'chat') {
      // The place over the box takes the clip that is there already.
      j.items = [_item(had.rec, had.kind)];
      j.had = true;
      return _end(j, 'done', 'on the shelf already');
    }
    return _end(j, 'error', 'on the shelf already',
      `Already on the shelf: "${had.rec.name || meta.label}" in ${KIND_WORD[had.kind] || had.kind}.`);
  }

  fs.mkdirSync(MEDIA.work, { recursive: true });
  const several = meta.count > 1 && j.from !== 'chat';
  j._stem = 'lnk_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex');
  const tpl = path.join(MEDIA.work, j._stem + (several ? '_%(playlist_index)s' : '') + '.%(ext)s');
  j.step = 'starting the download';
  await YTDLP.download(j.url, tpl, {
    onProgress: (s) => { j.step = s; },
    items: meta.count > 1 ? (several ? '1-' + meta.count : '1') : '',
    kill: (stopIt) => { if (_current && _current.id === j.id) _current.stop = stopIt; },
  }).catch((e) => { if (!e.stopped) throw e; });
  if (j.stopping) return _end(j, 'stopped', 'stopped');

  const landed = fs.readdirSync(MEDIA.work).filter(f => f.startsWith(j._stem) && VIDEO_RE.test(f)).sort();
  if (!landed.length) throw new Error('The download finished but left no file behind.');

  j.step = 'putting it on the shelf';
  const VT = require('./video-thumb');
  for (let i = 0; i < landed.length; i++) {
    const videoPath = '/media/work/' + landed[i];
    const name = (meta.label + (landed.length > 1 ? ` · ${i + 1} of ${landed.length}` : '')).slice(0, 120);
    if (j.from === 'chat') {
      // (phase V56, (ги4)) A clip brought into a chat by a link lies in VIDEO -> Uploads itself, as one from this computer.
      const { item } = await require('./birols-store').add(videoPath, {
        kind: 'uploads', name, link: meta.url, linkKey: meta.key,
      });
      if (item) j.items.push(_item(item, 'uploads'));
    } else {
      let thumbPath = null;
      try { thumbPath = (await VT.makeThumb(videoPath)).thumb; } catch (e) { /* a grey tile, not a lost clip */ }
      const { item, kind } = require('../routes/library').fileRecord({
        videoPath, thumbPath, name, kind: j.kind, link: meta.url, linkKey: meta.key,
      });
      j.items.push(_item(item, kind));
    }
  }
  return _end(j, 'done', landed.length > 1 ? `added ${landed.length} clips` : 'added');
}

// What a job leaves in work/ that is not on a shelf - a part, a stream before its join, a stopped download - goes. A
// clip filed is placed out of work/; one whose placing failed is still a record's file here, and stays.
function _cleanup(j) {
  if (!j._stem) return;
  const filed = new Set(j.items.map(i => path.basename(String(i.videoPath || ''))));
  try {
    for (const f of fs.readdirSync(MEDIA.work)) {
      if (f.startsWith(j._stem) && !filed.has(f)) { try { fs.rmSync(path.join(MEDIA.work, f), { force: true }); } catch (e) { /* held */ } }
    }
  } catch (e) { /* no work folder */ }
}

module.exports = { KINDS, add, get, list, stop };
