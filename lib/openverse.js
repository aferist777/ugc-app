'use strict';

// ════════════════════════════════════════════════════════════════════════════
// FINDING SOUNDS ONLINE -
// Openverse (api.openverse.org, WordPress), which searches Freesound and Wikimedia Commons at once, WITHOUT a key:
// anonymous use is a few searches a minute and some hundreds a day, so a search is kept for ten minutes and asked again
// only when the words or the page change. ONLY CC0 (`license=cc0`): free in a video, sold or not, no credit owed - kept
// anyway. The screen says "made using Openverse" (their terms).
//
// Openverse is the SECOND way: Freesound is asked directly with the person's
// own key (lib/freesound.js) and Openverse only when there is no key or Freesound did not answer (routes/audio-lib.js).
// Its search can stand answering "504" after 60 s - theirs, not ours. Wikimedia's sounds are
// the source `wikimedia_audio` at Openverse (`wikimedia` is its pictures).
//
//   search(q, page) -> { results: [one], page, pageCount, count }
//   add(id, to: { cat, label }) -> the new record of data/sounds.json   the sound fetched again from Openverse by its id -
//                                    never a link the page sent - checked CC0, its file downloaded once and filed in My
//                                    sounds with where it came from, its author and its licence (`meta.online`)
//   fileFound(one, to, online)    a found sound's file downloaded and filed in My sounds - Openverse's and Freesound's alike
//
// A result: { via, id, title, url, dur, filetype, provider, source, creator, creatorUrl, license, licenseVersion,
//             licenseUrl, landing, attribution, tags, wave }. For Freesound the file is its HQ preview MP3 (~128 kbit/s)
//             - the original needs a Freesound sign-in; enough for an effect.
// ════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { MEDIA } = require('./config');

const BASE = 'https://api.openverse.org/v1/audio/';
const UA = 'UGC-Studio/1.0 (desktop video editor; a person searching CC0 sound effects)';
const HEADERS = { 'User-Agent': UA, Accept: 'application/json' };
const KEEP_MS = 10 * 60 * 1000;
const MAX_BYTES = 40 * 1024 * 1024;

const _cache = new Map();         // "q|page" -> { at, data }
// What the searches of this run found, by id: an "add" takes the sound as Openverse gave it to THIS server - never what
// the page sends - without asking Openverse again (anonymous use is counted). Asked again only for an id not seen.
const _seen = new Map();

function _wave(peaks) {
  if (!Array.isArray(peaks) || !peaks.length) return [];
  const n = 64, out = [];
  for (let i = 0; i < n; i++) {
    const a = Math.floor(i * peaks.length / n), b = Math.max(a + 1, Math.floor((i + 1) * peaks.length / n));
    let m = 0;
    for (let j = a; j < b && j < peaks.length; j++) m = Math.max(m, +peaks[j] || 0);
    out.push(m);
  }
  const top = Math.max(1e-6, ...out);
  return out.map(v => Math.round(v * 100 / top));
}

function _one(r) {
  const tags = (Array.isArray(r.tags) ? r.tags : []).map(t => String((t && t.name) || t || '')).filter(Boolean).slice(0, 20);
  return {
    via: 'openverse', id: String(r.id || ''), title: String(r.title || 'sound').slice(0, 200), url: String(r.url || ''),
    // Openverse's duration is in milliseconds.
    dur: Math.round((+r.duration || 0) / 10) / 100,
    filetype: String(r.filetype || ''), provider: String(r.provider || ''), source: String(r.source || ''),
    creator: String(r.creator || ''), creatorUrl: String(r.creator_url || ''),
    license: String(r.license || ''), licenseVersion: String(r.license_version || ''), licenseUrl: String(r.license_url || ''),
    landing: String(r.foreign_landing_url || ''), attribution: String(r.attribution || '').slice(0, 600),
    tags, wave: _wave(r.peaks),
  };
}

function _said(e) {
  const d = e && e.response && e.response.data;
  const st = e && e.response && e.response.status;
  if (st === 429) return 'Openverse says too many searches for now - wait a minute (anonymous use is limited)';
  if (st === 502 || st === 503 || st === 504 || (e && e.code === 'ECONNABORTED')) return 'the search of Openverse is not answering right now' + (st ? ' (' + st + ')' : '') + ' - try again in a while';
  return 'Openverse did not answer: ' + String((d && (d.detail || d.error)) || (e && e.message) || 'no answer').slice(0, 200);
}

async function search(q, page) {
  const words = String(q || '').trim().slice(0, 200);
  if (!words) throw Object.assign(new Error('type what to look for'), { status: 400 });
  const pg = Math.max(1, Math.min(12, Math.round(+page || 1)));
  const key = words.toLowerCase() + '|' + pg;
  const hit = _cache.get(key);
  if (hit && Date.now() - hit.at < KEEP_MS) return hit.data;
  let r;
  try {
    r = await axios.get(BASE, {
      params: { q: words, license: 'cc0', source: 'freesound,wikimedia_audio', page_size: 20, page: pg, peaks: true, mature: false },
      headers: HEADERS, timeout: 45000,
    });
  } catch (e) {
    throw Object.assign(new Error(_said(e)), { status: 502 });
  }
  const d = r.data || {};
  const data = {
    results: (Array.isArray(d.results) ? d.results : []).map(_one).filter(x => x.id && x.url && x.license === 'cc0'),
    page: pg, pageCount: +d.page_count || 1, count: +d.result_count || 0,
  };
  _cache.set(key, { at: Date.now(), data });
  for (const x of data.results) _seen.set(x.id, x);
  if (_seen.size > 2000) _seen.delete(_seen.keys().next().value);
  if (_cache.size > 60) _cache.delete(_cache.keys().next().value);
  return data;
}

async function detail(id) {
  const clean = String(id || '').trim();
  if (!/^[0-9a-f-]{8,64}$/i.test(clean)) throw Object.assign(new Error('not an Openverse id'), { status: 400 });
  let r;
  if (_seen.has(clean)) return _seen.get(clean);
  try { r = await axios.get(BASE + encodeURIComponent(clean) + '/', { headers: HEADERS, timeout: 45000 }); }
  catch (e) { throw Object.assign(new Error(_said(e)), { status: 502 }); }
  return _one(r.data || {});
}

const _safe = (s) => String(s || '').replace(/[^A-Za-z0-9 _-]+/g, ' ').trim().replace(/\s+/g, '_').slice(0, 50) || 'sound';

async function add(id, to) {
  const one = await detail(id);
  if (one.license !== 'cc0') throw Object.assign(new Error('only CC0 sounds are taken - this one is ' + (one.license || 'unknown')), { status: 400 });
  if (!/^https:\/\//.test(one.url)) throw Object.assign(new Error('Openverse gave no file for it'), { status: 502 });
  return fileFound(one, to, {
    via: 'Openverse', id: one.id, provider: one.provider, source: one.source, title: one.title,
    creator: one.creator, creatorUrl: one.creatorUrl, license: one.license, licenseVersion: one.licenseVersion,
    licenseUrl: one.licenseUrl, landing: one.landing, attribution: one.attribution, file: one.url,
    filetype: one.filetype, preview: one.source === 'freesound',
  });
}

// Freesound's own number of a sound, from either way it came: Freesound's `fs-123`, or Openverse's page of it.
const _fsNo = (o) => {
  const m = /^fs-(\d+)$/.exec(String((o && o.id) || '')) || /freesound\.org\/people\/[^/]+\/sounds\/(\d+)/i.exec(String((o && o.landing) || ''));
  return m ? m[1] : '';
};

/** A found sound into My sounds: downloaded once, filed with where it came from. Already there (by its id, or the same
 *  Freesound sound found the other way) - that record. `online` is what the record keeps as `meta.online`. */
async function fileFound(one, to, online) {
  const SND = require('./sounds-store');
  const no = _fsNo(one);
  const was = SND.read().find(s => s && s.meta && s.meta.online
    && (s.meta.online.id === one.id || (no && _fsNo(s.meta.online) === no)));
  if (was) return { item: was, added: false };
  const t = to || {};
  const LC = require('./library-cats');
  let cat = null;
  if (t.cat && t.cat !== LC.UNCAT) {
    cat = LC.find('sounds', String(t.cat));
    if (!cat) throw Object.assign(new Error('no such category in My sounds'), { status: 400 });
  }
  let r;
  try {
    r = await axios.get(one.url, { responseType: 'arraybuffer', timeout: 60000, headers: { 'User-Agent': UA }, maxContentLength: MAX_BYTES });
  } catch (e) {
    throw Object.assign(new Error('the sound could not be downloaded: ' + (e.response ? 'status ' + e.response.status : e.message)), { status: 502 });
  }
  const ext = (/\.(mp3|ogg|oga|wav|flac|m4a|opus)(\?|$)/i.exec(one.url) || [])[1] || (one.filetype || 'mp3');
  fs.mkdirSync(MEDIA.work, { recursive: true });
  const name = (online.via === 'Freesound' ? 'fs_' : 'ov_') + _safe(one.title) + '_' + String(one.id).replace(/^fs-/, '').slice(0, 8)
    + '.' + String(ext).toLowerCase();
  const abs = path.join(MEDIA.work, name);
  fs.writeFileSync(abs + '.part', Buffer.from(r.data));
  fs.renameSync(abs + '.part', abs);
  let wave = Array.isArray(one.wave) ? one.wave : [];
  if (!wave.length) { try { wave = await require('./audio-wave').peaks(abs); } catch (e) { wave = []; } }
  const res = await SND.add('/media/work/' + name, {
    name: one.title, categoryId: cat ? cat.id : '', categoryLabel: cat ? '' : String(t.label || '').trim(),
    source: 'online',
    meta: { tags: one.tags || [], online: Object.assign({}, online, { at: new Date().toISOString() }) },
  });
  if (res.item && wave.length) require('./audio-cut').setWave(res.item.id, wave);
  return res;
}

module.exports = { search, detail, add, fileFound, UA,
                   // for a stand: results as Openverse gave them, remembered as a search would
                   _remember: (raw) => { for (const r of raw || []) { const x = _one(r); if (x.id) _seen.set(x.id, x); } } };
