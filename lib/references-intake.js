'use strict';

// ════════════════════════════════════════════════════════════════════════════
// THE TELEGRAM QUEUE WORKED THROUGH, INTO REFERENCES.
//
// One item at a time, in the order they came (lib/tg-inbox.js), a pause of five seconds after a link (Instagram does not
// like a program asking quickly). An item cut off by the app closing is taken again at the next start - a download goes on
// from its part. Free: no generation, no Alerts row.
//
// A LINK: read whole first (lib/ytdlp.js post - every video and picture of it, no download), then
//   - the same post here already (its site and id) -> "Already in REFERENCES", nothing fetched
//   - sorted into its folder: Instagram /reel/ -> Reels, else Posts; TikTok /photo/ or only pictures -> Posts, else Videos;
//     YouTube /shorts/ or vertical and 3 minutes at most -> Shorts, else Videos; any other site -> Other
//   - a full YouTube video, or ANY single video longer than 3 minutes, is kept as a TILE: its
//     poster, title and length, nothing downloaded (watched in the app)
//   - else its videos at the best there is (yt-dlp, a carousel's videos by their numbers) and its pictures at full size
//     (the picture's own address from the post's description), each with a thumbnail beside it
// A FILE sent to the bot (a photo or a video, 20 MB at most): fetched from Telegram (getFile) into Files. An album - several
// sent at once, one media_group_id - becomes ONE post, taken once its last part is a few seconds old.
//
// THE ANSWER: the bot's reply to the message is edited to say how each of its items went - "✅ Saved to REFERENCES ·
// Instagram · Reels - @nasa", "❌ Could not take ...: <why>" - in the app's language. Three failures in a row that are
// not the content's (a login wall, a picture-less video...) - Instagram pushing back - and the queue waits half an hour,
// saying so.
// ════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');
const INBOX = require('./tg-inbox');
const REFS = require('./references-store');
const YTDLP = require('./ytdlp');
const { toUrl } = require('./media');
const I18N = require('./i18n');

const PAUSE_LINK_MS = 5000;
const ALBUM_SETTLE_MS = 4000;
const LONG_S = 180;
const BACKOFF_MS = 30 * 60 * 1000;
const VIDEO_RE = /\.(mp4|webm|mkv|mov|m4v)$/i;

let _busy = false;
let _timer = null;
let _pausedUntil = 0;
let _fails = 0;
let _started = false;

const TG = () => require('./telegram');

function _later(ms) {
  clearTimeout(_timer);
  _timer = setTimeout(() => { _timer = null; _next(); }, ms);
  if (_timer.unref) _timer.unref();
}

/** Something was added, or the app started: work the queue. */
function kick() { if (!_busy) _later(50); }

/** At the server's start: what was running when the app closed is waiting again. */
function start() {
  if (_started) return;
  _started = true;
  INBOX.reset();
  _sweepParts();
  kick();
}

// What a download cut off by the app closing left in REFERENCES' folders - yt-dlp's parts and the streams before their
// join - unless it is a waiting item's, whose download goes on from it.
function _sweepParts() {
  const root = require('./config').MEDIA.references;
  const keep = INBOX.read().items.filter(i => i.state === 'waiting').map(i => String(i.id).replace(/^tg_/, ''));
  const walk = (d) => {
    let list = [];
    try { list = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
    for (const e of list) {
      const abs = path.join(d, e.name);
      if (e.isDirectory()) walk(abs);
      else if (/\.(part|ytdl)$|\.part-Frag\d+|\.f\d+\.[a-z0-9]+$|\.temp\.[a-z0-9]+$/i.test(e.name) && !keep.some(k => e.name.includes(k))) {
        try { fs.rmSync(abs, { force: true }); } catch (err) { /* held: next start */ }
      }
    }
  };
  walk(root);
}

// An album's part waits until the album's last part is a few seconds old - they arrive one message each.
function _ready(it, all) {
  if (!it.group) return true;
  const parts = all.filter(x => x.group === it.group && x.chatId === it.chatId);
  const newest = Math.max(...parts.map(x => Date.parse(x.at) || 0));
  return Date.now() - newest >= ALBUM_SETTLE_MS;
}

async function _next() {
  if (_busy) return;
  if (Date.now() < _pausedUntil) { _later(_pausedUntil - Date.now()); return; }
  const all = INBOX.read().items;
  const waiting = all.filter(i => i.state === 'waiting');
  const it = waiting.find(i => _ready(i, all));
  if (!it) { if (waiting.length) _later(1500); return; }
  _busy = true;
  let wait = 300;
  const batch = it.group && it.kind === 'file'
    ? waiting.filter(x => x.kind === 'file' && x.group === it.group && x.chatId === it.chatId)
    : [it];
  for (const b of batch) INBOX.update(b.id, (x) => { x.state = 'running'; });
  try {
    const words = it.kind === 'link' ? await _link(it) : await _files(batch);
    for (const b of batch) INBOX.update(b.id, (x) => { x.state = 'done'; x.result = words; x.endAt = new Date().toISOString(); });
    if (it.kind === 'link') _fails = 0;
  } catch (e) {
    const why = String((e && e.message) || e).replace(/\s+/g, ' ').slice(0, 300);
    if (e && e.duplicate) {
      // Here already: nothing went wrong, nothing was fetched.
      for (const b of batch) INBOX.update(b.id, (x) => { x.state = 'done'; x.dup = true; x.result = why; x.endAt = new Date().toISOString(); });
    } else {
      for (const b of batch) INBOX.update(b.id, (x) => { x.state = 'error'; x.error = why; x.endAt = new Date().toISOString(); });
    }
    console.warn('[references] could not take', it.kind === 'link' ? it.url : 'a file', '-', why);
    // Not the content's fault (a refusal of the content is `refused`): three in a row, and the queue rests.
    if (it.kind === 'link' && !e.refused && !e.duplicate) {
      if (++_fails >= 3) {
        _fails = 0;
        _pausedUntil = Date.now() + BACKOFF_MS;
        const st = TG().readState();
        if (st.chat) TG().say(st.chat.id, I18N.t('⏸ The sites refused three links in a row - the queue waits half an hour, then goes on by itself.'));
      }
    }
  } finally {
    for (const b of batch) await _answer(b);
    if (it.kind === 'link') wait = PAUSE_LINK_MS;
    _busy = false;
    _later(wait);
  }
}

// ── a link ─────────────────────────────────────────────────────────────────
function _classify(meta, url) {
  const site = String(meta.site || '').toLowerCase();
  const u = String(url) + ' ' + String(meta.url || '');
  if (site.includes('instagram')) return { source: 'instagram', folder: /\/reels?\//i.test(u) ? 'reels' : 'posts' };
  if (site.includes('tiktok')) {
    return { source: 'tiktok', folder: (/\/photo\//i.test(u) || meta.items.every(i => i.type === 'photo')) ? 'posts' : 'videos' };
  }
  if (site.includes('youtube')) {
    const short = /\/shorts\//i.test(u) || (meta.duration > 0 && meta.duration <= LONG_S && meta.h > meta.w);
    return { source: 'youtube', folder: short ? 'shorts' : 'videos' };
  }
  return { source: 'other', folder: '' };
}

// The files' name is the queue item's own: taken again after the app closed midway, the same item downloads under the
// same name - yt-dlp goes on from its part, or finds the file a download that outlived the app finished.
const _stem = (source, it) => source + '_' + String(it.id).replace(/^tg_/, '');

async function _fetch(url) {
  const r = await axios.get(url, { responseType: 'arraybuffer', timeout: 120000, maxContentLength: 200 * 1024 * 1024 });
  return Buffer.from(r.data);
}

// A picture into `dir` as <name>.<its own kind>, its thumbnail beside it.
async function _savePhoto(buf, dir, name) {
  const pic = await require('./image-in').sendable(buf);
  const abs = path.join(dir, name + '.' + pic.ext);
  fs.writeFileSync(abs, pic.buf);
  const thumbAbs = path.join(dir, 'thumbs', name + '.jpg');
  try { await require('./helpers').createThumbnail(abs, thumbAbs); } catch (e) { /* a grey tile, not a lost picture */ }
  let w = 0, h = 0;
  try { const m = await require('sharp')(pic.buf).metadata(); w = m.width || 0; h = m.height || 0; } catch (e) { /* unknown */ }
  return { id: crypto.randomBytes(4).toString('hex'), type: 'photo', path: toUrl(abs),
    thumb: fs.existsSync(thumbAbs) ? toUrl(thumbAbs) : null, w, h, dur: 0, size: pic.buf.length };
}

// A video already in `dir`: its thumbnail, its frame and length.
async function _videoMedia(abs) {
  const url = toUrl(abs);
  let thumb = null;
  try { thumb = (await require('./video-thumb').makeThumb(url)).thumb; } catch (e) { /* a grey tile */ }
  const p = await require('./media-probe').probe(abs);
  const rot = Math.abs(Number(p.rotate) || 0) % 180 === 90;
  return { id: crypto.randomBytes(4).toString('hex'), type: 'video', path: url, thumb,
    w: rot ? p.h : p.w, h: rot ? p.w : p.h, dur: Math.round((p.duration || 0) * 10) / 10, size: fs.statSync(abs).size };
}

async function _link(it) {
  const meta = await YTDLP.post(it.url);
  INBOX.update(it.id, (x) => { x.what = meta.label.slice(0, 80); });
  const had = REFS.byLinkKey(meta.key);
  if (had) {
    const e = new Error(I18N.t('Already in REFERENCES · {where}: {title}', { where: REFS.labelOf(had.source, had.folder), title: had.title }));
    e.duplicate = true;
    throw e;
  }
  // A YouTube video downloaded as a source already is in REFERENCES -> YouTube -> Videos too.
  const SRC = require('./sources-store');
  const asSource = meta.key && SRC.list().find(s => s && s.linkKey === meta.key && s.videoPath && SRC.fromYouTube(s));
  if (asSource) {
    const e = new Error(I18N.t('Already in REFERENCES · YouTube · Videos: {title}', { title: asSource.title || meta.label }));
    e.duplicate = true;
    throw e;
  }
  const { source, folder } = _classify(meta, it.url);
  const dir = REFS.dirOf(source, folder);
  const stem = _stem(source, it);
  const videos = meta.items.filter(i => i.type === 'video');
  const photos = meta.items.filter(i => i.type === 'photo');
  const single = meta.items.length === 1 && videos.length === 1;
  const base = {
    source, folder, title: meta.label, author: meta.author, link: meta.url, linkKey: meta.key,
    caption: meta.description, note: it.note || '', origin: it.origin || '', postedAt: meta.postedAt,
  };

  // A full YouTube video, or any single video over three minutes: a tile - its poster, nothing downloaded.
  const dur = single ? (videos[0].dur || meta.duration) : 0;
  if (single && ((source === 'youtube' && folder === 'videos') || dur > LONG_S)) {
    let poster = null;
    const thumbUrl = videos[0].thumbUrl;
    if (thumbUrl) {
      try {
        const abs = path.join(dir, 'thumbs', stem + '_poster.jpg');
        const buf = await require('sharp')(await _fetch(thumbUrl)).resize(1280, 1280, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
        fs.writeFileSync(abs, buf);
        poster = toUrl(abs);
      } catch (e) { /* a grey tile */ }
    }
    const p = REFS.add({ ...base, media: [], poster,
      remote: { site: meta.site, id: meta.id, url: meta.url, title: meta.title, dur, w: meta.w, h: meta.h } });
    return I18N.t('Added to REFERENCES · {where} - {title} ({dur}, not downloaded: watch it in the app)', { where: REFS.labelOf(source, folder), title: p.title, dur: _dur(dur) });
  }

  const media = [];
  try {
    await _fetchAll(it, meta, dir, stem, videos, photos, media);
  } catch (e) {
    // Nothing half-made is left behind: the parts, the joined streams, the thumbnails of what came.
    _sweep(dir, stem);
    throw e;
  }
  const p = REFS.add({ ...base, media, remote: null, poster: (media[0] && media[0].thumb) || null });
  const said = { where: REFS.labelOf(source, folder), what: _what(media), author: p.author };
  return p.author ? I18N.t('Saved to REFERENCES · {where} - {what} · {author}', said) : I18N.t('Saved to REFERENCES · {where} - {what}', said);
}

function _sweep(dir, stem) {
  for (const d of [dir, path.join(dir, 'thumbs')]) {
    try { for (const f of fs.readdirSync(d)) if (f.startsWith(stem)) fs.rmSync(path.join(d, f), { force: true }); }
    catch (e) { /* nothing there */ }
  }
}

async function _fetchAll(it, meta, dir, stem, videos, photos, media) {
  if (videos.length) {
    const several = meta.items.length > 1;
    const tpl = path.join(dir, stem + (several ? '_%(playlist_index)s' : '') + '.%(ext)s');
    await YTDLP.download(it.url, tpl, {
      items: several ? videos.map(v => v.index).join(',') : '',
      onProgress: (s) => INBOX.update(it.id, (x) => { x.step = s; }),
    });
    const landed = fs.readdirSync(dir).filter(f => f.startsWith(stem) && VIDEO_RE.test(f));
    if (!landed.length) throw new Error(I18N.t('The download finished but left no file behind.'));
    for (const f of landed) {
      const m = await _videoMedia(path.join(dir, f));
      const n = /_(\d+)\.[^.]+$/.exec(f);
      m.index = n ? Number(n[1]) : 1;
      media.push(m);
    }
  }
  for (const ph of photos) {
    const m = await _savePhoto(await _fetch(ph.thumbUrl), dir, stem + '_' + ph.index);
    m.index = ph.index;
    media.push(m);
  }
  media.sort((a, b) => a.index - b.index);
  for (const m of media) delete m.index;
}

// ── files sent to the bot ──────────────────────────────────────────────────
async function _files(batch) {
  const dir = REFS.dirOf('files', '');
  const stem = _stem('tg', batch[0]);
  const media = [];
  let n = 0;
  try {
    for (const it of batch.slice().sort((a, b) => a.messageId - b.messageId)) {
      n++;
      const { buf, ext } = await TG().fetchFile(it.fileId, it.botId);
      const name = stem + '_' + n;
      if (it.media === 'photo') media.push(await _savePhoto(buf, dir, name));
      else {
        const abs = path.join(dir, name + '.' + (ext && /^(mp4|mov|webm|mkv|m4v)$/i.test(ext) ? ext.toLowerCase() : 'mp4'));
        fs.writeFileSync(abs, buf);
        media.push(await _videoMedia(abs));
      }
    }
  } catch (e) { _sweep(dir, stem); throw e; }
  const note = batch.map(b => b.note).find(Boolean) || '';
  const origin = batch.map(b => b.origin).find(Boolean) || '';
  const when = new Date().toISOString().slice(0, 10);
  // The post's name, written in the interface's language as it is made.
  const what = note || (batch.length > 1 ? I18N.t('Album') : (media[0].type === 'photo' ? I18N.t('Photo') : I18N.t('Video')));
  const title = (origin ? I18N.t('{what} from {origin} · {when}', { what, origin, when })
    : I18N.t('{what} from Telegram · {when}', { what, when })).slice(0, 120);
  REFS.add({ source: 'files', folder: '', title, author: origin, link: '', linkKey: '', caption: '', note, origin,
    postedAt: '', media, remote: null, poster: (media[0] && media[0].thumb) || null });
  return I18N.t('Saved to REFERENCES · Files - {what}', { what: _what(media) });
}

function _what(media) {
  const v = media.filter(m => m.type === 'video').length;
  const p = media.filter(m => m.type === 'photo').length;
  return [p ? I18N.tn(p, '{n} photo', '{n} photos') : '', v ? I18N.tn(v, '{n} video', '{n} videos') : ''].filter(Boolean).join(', ')
    || I18N.t('nothing');
}
function _dur(s) {
  s = Math.round(Number(s) || 0);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0');
}

// ── the bot's answer, edited ───────────────────────────────────────────────
// Every item of the message the bot answered, one line each.
async function _answer(item) {
  // Read again: the reply's id may have been written after the item was picked.
  const items = INBOX.read().items;
  const it = items.find(x => x.id === item.id) || item;
  if (!it.replyId || !it.chatId) return;
  // The items of one message are the items of one update.
  const all = items.filter(x => x.updateId === it.updateId);
  const lines = all.map((x) => {
    if (x.state === 'done') return (x.dup ? 'ℹ️ ' : '✅ ') + x.result;
    if (x.state === 'error') {
      return x.what || x.url ? I18N.t('❌ Could not take {what}: {why}', { what: x.what || x.url, why: x.error })
        : I18N.t('❌ Could not take it: {why}', { why: x.error });
    }
    const what = x.what || x.url || (x.media === 'photo' ? I18N.t('photo') : x.media === 'video' ? I18N.t('video') : I18N.t('file'));
    return x.state === 'running' ? I18N.t('⏳ Taking {what}', { what }) : I18N.t('⏳ In the queue: {what}', { what });
  });
  try { await TG().answer(it.chatId, it.messageId, it.replyId, lines.join('\n')); } catch (e) { /* the item is filed either way */ }
}

module.exports = { kick, start };
