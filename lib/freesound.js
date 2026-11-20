'use strict';

// ════════════════════════════════════════════════════════════════════════════
// FREESOUND DIRECTLY - the first way to
// find sound effects online; Openverse (lib/openverse.js) is the second, asked when there is no key or Freesound did not
// answer (routes/audio-lib.js).
//
// The API (freesound.org/apiv2, free): a key of the person's own Freesound account (freesound.org/apiv2/apply), kept as
// `freesoundApiKey` in settings.json - a secret the page never sees (routes/settings.js), sent in a header, never in an
// address. 60 requests a minute and 2000 a day, so a search is kept for ten minutes, as Openverse's. ONLY CC0 - the
// filter `license:"Creative Commons 0"`, and every result checked again. The file is the sound's HQ preview MP3
// (~128 kbit/s): previews download with no sign-in (the original needs one) - the same file Openverse gives.
//
//   has()                           whether a key is set
//   search(q, page) -> { results: [one], page, pageCount, count }      `one` shaped as Openverse's (lib/openverse.js)
//   add(id, to: { cat, label })     the sound fetched again by its id (never a link the page sent), checked CC0, filed in
//                                   My sounds with its author and its page (lib/openverse.js fileFound)
//
// A result's id is `fs-<Freesound's number>`, so the route tells the two ways apart by the id alone.
// ════════════════════════════════════════════════════════════════════════════

const axios = require('axios');
const { getSettings } = require('./settings-io');
const I18N = require('./i18n');

const BASE = 'https://freesound.org/apiv2/';
const CC0 = 'license:"Creative Commons 0"';
const FIELDS = 'id,name,url,username,license,duration,type,tags,previews';
const PER_PAGE = 20;
const KEEP_MS = 10 * 60 * 1000;
const CC0_URL = 'https://creativecommons.org/publicdomain/zero/1.0/';

const _cache = new Map();         // "q|page" -> { at, data }
const _seen = new Map();          // what this run's searches found, by id - an "add" takes it as Freesound gave it here

const _key = () => String((getSettings() || {}).freesoundApiKey || '').trim();
const has = () => !!_key();

// Freesound says a licence as its deed's address ("http://creativecommons.org/publicdomain/zero/1.0/") or its name.
const _isCc0 = (l) => /publicdomain\/zero|creative commons 0/i.test(String(l || ''));

function _one(r) {
  const p = r.previews || {};
  const user = String(r.username || '');
  const title = String(r.name || 'sound').replace(/\.(wav|mp3|aiff?|flac|ogg|m4a)$/i, '').slice(0, 200);
  return {
    via: 'freesound', id: 'fs-' + String(r.id || ''), title,
    url: String(p['preview-hq-mp3'] || p['preview-lq-mp3'] || ''),
    dur: Math.round((+r.duration || 0) * 100) / 100,
    filetype: 'mp3', provider: 'freesound', source: 'freesound',
    creator: user, creatorUrl: user ? 'https://freesound.org/people/' + encodeURIComponent(user) + '/' : '',
    license: _isCc0(r.license) ? 'cc0' : String(r.license || ''), licenseVersion: _isCc0(r.license) ? '1.0' : '',
    licenseUrl: _isCc0(r.license) ? CC0_URL : String(r.license || ''),
    landing: String(r.url || ''),
    attribution: '"' + title + '" by ' + (user || 'unknown') + ' (freesound.org) - CC0',
    tags: (Array.isArray(r.tags) ? r.tags : []).map(String).filter(Boolean).slice(0, 20),
    wave: [],
  };
}

function _said(e) {
  const st = e && e.response && e.response.status;
  const d = e && e.response && e.response.data;
  if (st === 401 || st === 403) return I18N.t('Freesound refused the key - check it on Admin -> API keys');
  if (st === 404) return I18N.t('Freesound has no such sound');
  if (st === 429) return I18N.t('Freesound says too many searches for now (60 a minute, 2000 a day) - wait a minute');
  if (!st || st >= 500 || (e && e.code === 'ECONNABORTED')) {
    return st ? I18N.t('Freesound is not answering right now ({status})', { status: st }) : I18N.t('Freesound is not answering right now');
  }
  return I18N.t('Freesound did not answer: {why}', { why: String((d && (d.detail || d.error)) || (e && e.message) || I18N.t('no answer')).slice(0, 200) });
}

function _ask(url, params) {
  const k = _key();
  if (!k) return Promise.reject(Object.assign(new Error(I18N.t('there is no Freesound key - add it on Admin -> API keys')), { status: 400, noKey: true }));
  return axios.get(url, { params, headers: { Authorization: 'Token ' + k, Accept: 'application/json' }, timeout: 20000 });
}

async function search(q, page) {
  const words = String(q || '').trim().slice(0, 200);
  if (!words) throw Object.assign(new Error(I18N.t('type what to look for')), { status: 400 });
  const pg = Math.max(1, Math.min(12, Math.round(+page || 1)));
  const key = words.toLowerCase() + '|' + pg;
  const hit = _cache.get(key);
  if (hit && Date.now() - hit.at < KEEP_MS) return hit.data;
  let r;
  try {
    r = await _ask(BASE + 'search/text/', { query: words, filter: CC0, page: pg, page_size: PER_PAGE, fields: FIELDS });
  } catch (e) {
    if (e.noKey) throw e;
    // A page past the last one is Freesound's 404 "Invalid page": nothing more.
    if (e.response && e.response.status === 404 && pg > 1) r = { data: { results: [], count: 0 } };
    else throw Object.assign(new Error(_said(e)), { status: 502 });
  }
  const d = r.data || {};
  const count = +d.count || 0;
  const data = {
    results: (Array.isArray(d.results) ? d.results : []).map(_one).filter(x => x.id !== 'fs-' && x.url && x.license === 'cc0'),
    page: pg, pageCount: Math.max(1, Math.ceil(count / PER_PAGE)), count,
  };
  _cache.set(key, { at: Date.now(), data });
  for (const x of data.results) _seen.set(x.id, x);
  if (_seen.size > 2000) _seen.delete(_seen.keys().next().value);
  if (_cache.size > 60) _cache.delete(_cache.keys().next().value);
  return data;
}

async function detail(id) {
  const m = /^fs-(\d{1,12})$/.exec(String(id || '').trim());
  if (!m) throw Object.assign(new Error(I18N.t('not a Freesound id')), { status: 400 });
  if (_seen.has(m[0])) return _seen.get(m[0]);
  let r;
  try { r = await _ask(BASE + 'sounds/' + m[1] + '/', { fields: FIELDS }); }
  catch (e) { throw e.noKey ? e : Object.assign(new Error(_said(e)), { status: e.response && e.response.status === 404 ? 404 : 502 }); }
  return _one(r.data || {});
}

async function add(id, to) {
  const one = await detail(id);
  if (one.license !== 'cc0') throw Object.assign(new Error(I18N.t('only CC0 sounds are taken - this one is {license}', { license: one.license || I18N.tc('license', 'unknown') })), { status: 400 });
  if (!/^https:\/\//.test(one.url)) throw Object.assign(new Error(I18N.t('Freesound gave no file for it')), { status: 502 });
  return require('./openverse').fileFound(one, to, {
    via: 'Freesound', id: one.id, provider: 'freesound', source: 'freesound', title: one.title,
    creator: one.creator, creatorUrl: one.creatorUrl, license: one.license, licenseVersion: one.licenseVersion,
    licenseUrl: one.licenseUrl, landing: one.landing, attribution: one.attribution, file: one.url,
    filetype: one.filetype, preview: true,
  });
}

module.exports = { has, search, detail, add, BASE };
