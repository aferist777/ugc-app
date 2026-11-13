'use strict';

/* pixabay.js - THE STOCK THE B-ROLL ENGINE ASKS. Pixabay's
   official API with the person's free key - `pixabayApiKey` in settings.json, a secret the page never sees (routes/settings.js),
   set on Admin -> API keys. Pixabay takes the key ONLY in the address, so the address is built here and never logged.

   What it is asked: pictures - PHOTOS only, at most 1280 px on the long side (the full size needs
   Pixabay's "full API access", not asked for); videos - FILM only, the 1080p file (`medium`), else 720p (`small`); safe search OFF.
   Vertical and horizontal both - the video API has no orientation to ask for.

   Its terms: every answer is KEPT 24 HOURS (cache/stock/pixabay/) and the same question within them is not asked again
   (100 requests a minute is the limit); "from Pixabay" and the author are shown where its results are (js/merge-v3/broll-view.js);
   a file is downloaded only when it is laid or chosen - never in bulk - and by its id, asked again when the stored link is
   older than a day (Pixabay's `pixabay.com/get/…` links last 24 hours).

     has()                        a key is set
     search({ query, kind, n })   -> items for lib/stock.js
     fetchFile(item)              -> { file, ext } in scratch
     thumbFile(item)              -> a local copy of its picture, for the panel (kept a day)
     probe(key)                   one search - the key's check on Admin */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');
const { getSettings } = require('./settings-io');
const { CACHE_DIR, TEMP_DIR } = require('./config');

const BASE = 'https://pixabay.com/api/';
const KEEP_MS = 24 * 60 * 60 * 1000;
const LINK_MS = 20 * 60 * 60 * 1000;      // a `get/` link is asked for again past this
const TIMEOUT = 20000;

const _key = () => String((getSettings() || {}).pixabayApiKey || '').trim();
const has = () => !!_key();
const _dir = (sub) => { const d = path.join(CACHE_DIR, 'stock', sub); fs.mkdirSync(d, { recursive: true }); return d; };
const _hash = (s) => crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 20);
const _err = (msg, status) => Object.assign(new Error(msg), { status: status || 502 });

// What Pixabay said when it said no - its answer is a line of text ("[ERROR 400] "key" is invalid"), never the address.
function _said(e) {
  const code = e && e.response && e.response.status;
  const d = e && e.response && e.response.data;
  const text = typeof d === 'string' ? d.replace(/\s+/g, ' ').trim().slice(0, 160) : '';
  if (code === 429) return 'Pixabay: too many requests this minute - press again in a moment';
  if (code) return 'Pixabay: ' + (text || 'answered ' + code);
  return 'Pixabay did not answer (' + String((e && e.code) || (e && e.message) || 'no answer').slice(0, 60) + ')';
}

// ── ITS LIMIT: 100 requests a minute (a voiceover of 4.5 minutes - 50 sentences - runs into it). Every request waits for
// a place in the minute - at most PER_MINUTE in any 60 seconds, the
// whole app together - and when Pixabay says how many are left (X-RateLimit-Remaining / -Reset) and that is none, or answers
// 429 anyway, the next waits as long as it says, and the refused one is asked again. `waiting()` says how long, for the field.
const PER_MINUTE = 90;
const WINDOW_MS = 60 * 1000;
const RETRIES = 3;
const _sent = [];                         // when each request of the last minute went
let _until = 0;                           // nothing goes before this moment (Pixabay's reset, or the window full)
const _sleep = (ms) => new Promise(r => setTimeout(r, ms));
/** Seconds the next request to Pixabay still waits - 0 when it goes at once. */
const waiting = () => Math.max(0, Math.ceil((_until - Date.now()) / 1000));
async function _slot() {
  for (;;) {
    const now = Date.now();
    while (_sent.length && now - _sent[0] >= WINDOW_MS) _sent.shift();
    const full = _sent.length >= PER_MINUTE ? _sent[0] + WINDOW_MS + 250 : 0;
    const at = Math.max(_until, full);
    if (at <= now) { _sent.push(now); return; }
    _until = at;
    await _sleep(Math.min(1000, at - now));
  }
}
function _heed(headers) {
  const h = headers || {};
  const left = parseInt(h['x-ratelimit-remaining'], 10);
  const reset = parseInt(h['x-ratelimit-reset'], 10);
  if (Number.isFinite(left) && left <= 1 && Number.isFinite(reset)) _until = Math.max(_until, Date.now() + reset * 1000 + 500);
}

// ONE question to Pixabay, kept a day: the answer is read from cache/stock/pixabay/ while it is younger than KEEP_MS.
async function _ask(kind, params, key) {
  const k = key || _key();
  if (!k) throw _err('no Pixabay key - Admin → API keys', 409);
  const url = BASE + (kind === 'video' ? 'videos/' : '');
  const file = path.join(_dir('pixabay'), _hash(kind + '|' + JSON.stringify(params)) + '.json');
  if (!key) {
    try {
      const st = fs.statSync(file);
      if (Date.now() - st.mtimeMs < KEEP_MS) return { data: JSON.parse(fs.readFileSync(file, 'utf8')), at: st.mtimeMs };
    } catch (e) { /* not kept yet */ }
  }
  let r;
  for (let attempt = 0; ; attempt++) {
    await _slot();
    try {
      r = await axios.get(url, { params: { ...params, key: k }, timeout: TIMEOUT });
      _heed(r.headers);
      break;
    } catch (e) {
      const code = e && e.response && e.response.status;
      // Over the limit after all: wait as long as Pixabay says (a minute when it does not) and ask again - not for the key's
      // check (`key` given), which says so at once.
      if (code === 429 && !key && attempt < RETRIES) {
        const reset = parseInt(((e.response && e.response.headers) || {})['x-ratelimit-reset'], 10);
        _until = Math.max(_until, Date.now() + (Number.isFinite(reset) && reset > 0 ? reset : 60) * 1000 + 500);
        continue;
      }
      throw _err(_said(e));
    }
  }
  if (!r.data || !Array.isArray(r.data.hits)) throw _err('Pixabay answered something else than a list');
  if (!key) { try { fs.writeFileSync(file, JSON.stringify(r.data)); } catch (e) { /* kept or not, it answered */ } }
  return { data: r.data, at: Date.now() };
}

// The file a video is downloaded as: 1080p, else 720p - the largest of Pixabay's sizes whose long side is at most 1920.
// Its names do not say it: `medium` is 2560x1440 for a 4K source, `small` is then the 1080p one.
function _videoFile(h) {
  const v = (h && h.videos) || {};
  const sizes = [v.large, v.medium, v.small, v.tiny].filter(x => x && x.url && +x.width && +x.height);
  const fit = sizes.filter(x => Math.max(+x.width, +x.height) <= 1920);
  return fit.sort((a, b) => Math.max(+b.width, +b.height) - Math.max(+a.width, +a.height))[0] || null;
}
// A hit, as lib/stock.js says an item.
function _item(kind, h, query, at) {
  const user = String(h.user || '');
  const page = String(h.pageURL || '');
  if (kind === 'video') {
    const f = _videoFile(h);
    if (!f) return null;
    const v = h.videos || {};
    return {
      id: 'pixabay:video:' + h.id, site: 'pixabay', kind: 'video', w: +f.width, h: +f.height, dur: +h.duration || 0,
      file: f.url, thumb: (v.tiny && v.tiny.thumbnail) || (v.small && v.small.thumbnail) || f.thumbnail || '',
      preview: (v.tiny && v.tiny.url) || (v.small && v.small.url) || '', page, author: user, tags: String(h.tags || ''), query, at,
    };
  }
  const W = +h.imageWidth || +h.webformatWidth || 0, H = +h.imageHeight || +h.webformatHeight || 0;
  const s = W && H ? Math.min(1, 1280 / Math.max(W, H)) : 1;
  return {
    id: 'pixabay:image:' + h.id, site: 'pixabay', kind: 'image', w: Math.round(W * s), h: Math.round(H * s), dur: 0,
    file: String(h.largeImageURL || h.webformatURL || ''), thumb: String(h.webformatURL || h.previewURL || ''), preview: '',
    page, author: user, tags: String(h.tags || ''), query, at,
  };
}

async function search({ query, kind, n }) {
  const q = String(query || '').replace(/\s+/g, ' ').trim().slice(0, 100);
  if (!q) return [];
  const params = kind === 'video'
    ? { q, video_type: 'film', safesearch: 'false', per_page: Math.max(3, Math.min(200, +n || 12)), lang: 'en' }
    : { q, image_type: 'photo', safesearch: 'false', per_page: Math.max(3, Math.min(200, +n || 12)), lang: 'en' };
  const { data, at } = await _ask(kind, params);
  return data.hits.map(h => _item(kind, h, q, at)).filter(Boolean);
}

// The item as Pixabay says it NOW - by its id (its `get/` links last a day).
async function _fresh(item) {
  const id = String(item.id || '').split(':').pop();
  const kind = item.kind === 'video' ? 'video' : 'image';
  const { data, at } = await _ask(kind, { id });
  const h = data.hits[0];
  if (!h) throw _err('Pixabay has no ' + kind + ' ' + id + ' any more', 404);
  return _item(kind, h, item.query || '', at);
}
async function _link(item, field) {
  let it = item;
  if (!it[field] || !(Date.now() - (+it.at || 0) < LINK_MS)) it = await _fresh(item);
  return it[field];
}

async function _download(url, file) {
  let r;
  try { r = await axios.get(url, { responseType: 'stream', timeout: 120000 }); }
  catch (e) { throw _err(_said(e)); }
  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(file);
    r.data.on('error', reject);
    out.on('error', reject);
    out.on('finish', resolve);
    r.data.pipe(out);
  });
}

async function fetchFile(item) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
  // The link the search gave, while it still opens (a day); past that, Pixabay is asked by the item's id - one request of the
  // minute's hundred, so not for every download.
  const url = await _link(item, 'file');
  if (!url) throw _err('Pixabay gave no file for this ' + item.kind, 404);
  const ext = (/\.(mp4|webm|jpe?g|png|webp)(\?|$)/i.exec(url) || [, item.kind === 'video' ? 'mp4' : 'jpg'])[1].toLowerCase().replace('jpeg', 'jpg');
  const file = path.join(TEMP_DIR, 'pixabay_' + _hash(item.id) + '_' + Date.now() + '.' + ext);
  await _download(url, file);
  return { file, ext: '.' + ext };
}

async function thumbFile(item) {
  const file = path.join(_dir('pixabay-thumbs'), _hash(item.id) + '.jpg');
  try { if (Date.now() - fs.statSync(file).mtimeMs < KEEP_MS) return file; } catch (e) { /* not kept */ }
  const url = await _link(item, 'thumb');
  if (!url) throw _err('no picture of this item', 404);
  await _download(url, file);
  return file;
}

/** The key's check: one search of one photo - "1 234 567 photos" or a refusal in Pixabay's words. */
async function probe(key) {
  const { data } = await _ask('image', { q: 'city', image_type: 'photo', per_page: 3 }, String(key || '').trim());
  return (+data.totalHits || 0) ? 'answers - ' + (+data.total || +data.totalHits).toLocaleString('en-US') + ' photos for "city"' : 'answers';
}

module.exports = { has, search, fetchFile, thumbFile, probe, waiting, PER_MINUTE };
