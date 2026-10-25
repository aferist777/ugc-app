'use strict';

// ════════════════════════════════════════════════════════════════════════════
// GROQ WHISPER - one piece of sound in, what Groq heard out (phase K1, 2026-10-03).
//
// `whisper-large-v3`, not the turbo: better on Russian, and at $0.111 an hour of sound a minute of
// video costs a fifth of a cent. Words AND segments are asked for - the words are the captions, the
// segments say where Whisper was guessing (no_speech_prob, avg_logprob, compression_ratio), which is
// how its hallucinations in silence are told apart (public/js/captions/heard.js, cleanWords).
//
// THE ANSWER IS RETURNED AS GROQ GAVE IT. Whoever asked keeps it whole (lib/subs-store.js), so the
// rules that read it can change without paying for it again.
//
// Retries: a 429 waits for `retry-after` when that is a minute or less - longer means the hourly or
// daily audio limit, which no retry will get past, and the person is told how long instead. A 5xx or
// a dropped connection is tried again after a pause; Groq does not charge for those. The form is
// built again for every attempt: a body that has been sent cannot be sent a second time.
//
// AT MOST TWO REQUESTS AT ONCE, for the whole app: the base limit is twenty a minute for the
// organisation, and two projects listening at once must not spend it on each other's retries.
//
// THROUGH R2 (phase V43, the owner 2026-10-25: "встрой слух через R2 и ссылку ... с прямой отправкой как
// запасной"): from the owner's computer an upload to Groq's addresses goes at 30-100 KB/s and is cut off,
// while R2 takes 7 MB/s - so while R2 is configured the piece is put into the bucket under `hearing/`, Groq
// is given a link to it for an hour (`url`) and fetches it itself, and the object is deleted once Groq has
// answered or refused. The sound goes up directly when R2 is not configured, the put fails, or Groq REFUSES
// the link (a 4xx) - never after a try that got no answer (paid once). The link is never written into the
// log or an error: only the object's key. What a closed app left under `hearing/` (older than the link's
// hour) is swept at the next hearing - nothing outside `hearing/` is ever touched: the same bucket holds
// kie's references and the Telegram bot's queue.
// ════════════════════════════════════════════════════════════════════════════

const crypto = require('crypto');
const axios = require('axios');
const FormData = require('form-data');
const { getSettings } = require('./settings-io');
const R2 = require('./r2');

let ENDPOINT = 'https://api.groq.com/openai/v1/audio/transcriptions';
const MODEL = 'whisper-large-v3';
const AT_ONCE = 2;
const TRIES = 4;
const TIMEOUT_MS = 120000;
// (V43) A try waits that long PLUS the time its sound takes to go up at 25 KB/s: from the owner's computer an upload reaches Groq at ~60 KB/s,
// and a ten-minute piece (10.6 MB of FLAC) never made it inside a flat 120 s - every try was cut off.
const UPLINK_MIN_BPS = 25 * 1024;
const WAIT_MAX_S = 60;
const HEAR_PREFIX = 'hearing/';       // (V43) the only folder of the bucket this module writes, lists or deletes in
const LINK_TTL_S = 3600;              // how long Groq's link to a piece works
const SWEEP_EVERY_MS = 3600 * 1000;   // the left-overs looked for at most once an hour

class GroqSttError extends Error {
  constructor(code, message, status) { super(message); this.code = code; if (status) this.status = status; }
}

const keyOf = () => String(getSettings().groqApiKey || '').trim();

// ── The gate ────────────────────────────────────────────────────────────────
let _inside = 0;
const _queue = [];
async function _enter() {
  if (_inside < AT_ONCE) { _inside++; return; }
  await new Promise((resolve) => _queue.push(resolve));
}
function _leave() {
  const next = _queue.shift();
  if (next) next(); else _inside--;
}

const _sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// What Groq said, in words a person can act on.
function _explain(e) {
  const r = e && e.response;
  if (!r) {
    const net = /ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNABORTED|socket hang up|timeout/i
      .test(String((e && (e.code || '')) + ' ' + (e && e.message)));
    return { retry: net, err: new GroqSttError('network', net
      ? 'Could not reach Groq - check the internet connection and press again.'
      : 'Groq: ' + String((e && e.message) || 'no answer').slice(0, 300)) };
  }
  const body = r.data && r.data.error;
  const said = String((body && (body.message || body)) || r.statusText || '').slice(0, 300);
  if (r.status === 401 || r.status === 403) {
    return { retry: false, err: new GroqSttError('bad-key', 'Groq did not accept the API key - check it on Admin -> API keys.') };
  }
  if (r.status === 413) return { retry: false, err: new GroqSttError('too-large', 'This piece of sound is too large for Groq.') };
  if (r.status === 429) {
    const after = Number(r.headers && r.headers['retry-after']);
    if (Number.isFinite(after) && after > WAIT_MAX_S) {
      const min = Math.max(1, Math.ceil(after / 60));
      return { retry: false, err: new GroqSttError('limit', "Groq's audio limit is used up for now - try again in " + min + ' min.') };
    }
    return { retry: true, waitS: Number.isFinite(after) && after > 0 ? after : null,
      err: new GroqSttError('busy', 'Groq is busy (too many requests) - press again in a minute.') };
  }
  if (r.status >= 500) {
    return { retry: true, err: new GroqSttError('down', 'Groq is not answering right now (HTTP ' + r.status + ') - press again in a minute.') };
  }
  if (r.status === 422) return { retry: 'once', err: new GroqSttError('refused', 'Groq: ' + (said || 'could not read the sound'), 422) };
  return { retry: false, err: new GroqSttError('refused', 'Groq: ' + (said || ('HTTP ' + r.status)), r.status) };
}

// ── Through R2 (V43) ────────────────────────────────────────────────────────
const _flying = new Set();            // the keys of pieces being heard now - never swept
let _sweptAt = 0;

// A key of ours, and how old it is by its own name (`hearing/<ms in base 36>-<random>.flac`).
const _ours = (k) => typeof k === 'string' && k.startsWith(HEAR_PREFIX);
const _bornOf = (k) => parseInt(String(k).slice(HEAR_PREFIX.length).split('-')[0], 36) || 0;

// What a closed app left under `hearing/`: deleted once its link has run out. Never awaited by a hearing.
function _sweep() {
  if (Date.now() - _sweptAt < SWEEP_EVERY_MS) return;
  _sweptAt = Date.now();
  R2.listObjects(HEAR_PREFIX).then(async (keys) => {
    const old = keys.filter((k) => _ours(k) && !_flying.has(k) && Date.now() - _bornOf(k) > LINK_TTL_S * 1000);
    for (const k of old) {
      if (!_ours(k)) continue;
      try { await R2.deleteObject(k); } catch (e) { console.warn('[groq] could not sweep ' + k + ': ' + String(e.message || e).slice(0, 120)); }
    }
    if (old.length) console.log('[groq] swept ' + old.length + ' left-over piece(s) from ' + HEAR_PREFIX);
  }).catch((e) => { console.warn('[groq] could not look into ' + HEAR_PREFIX + ': ' + String(e.message || e).slice(0, 120)); });
}

// The piece into R2 and a link to it for an hour, or null (no R2, or it did not take it: the sound goes up directly).
async function _putForLink(buf, o) {
  if (o.direct || !R2.isConfigured()) return null;
  _sweep();
  const objKey = HEAR_PREFIX + Date.now().toString(36) + '-' + crypto.randomBytes(4).toString('hex') + '.flac';
  _flying.add(objKey);
  try {
    await R2.putObject(buf, objKey, o.contentType || 'audio/flac');
    return { objKey, link: R2.linkFor(objKey, LINK_TTL_S) };
  } catch (e) {
    _flying.delete(objKey);
    _drop(objKey);
    console.warn('[groq] R2 did not take the piece (' + objKey + '): ' + String(e.message || e).slice(0, 120) + ' - it goes up directly');
    return null;
  }
}

function _drop(objKey) {
  _flying.delete(objKey);
  if (!_ours(objKey)) return;
  R2.deleteObject(objKey).catch((e) => { console.warn('[groq] could not delete ' + objKey + ': ' + String(e.message || e).slice(0, 120)); });
}

// An error said with the link in it says the object's key instead.
function _hidden(e, via) {
  if (!e || !via || typeof e.message !== 'string') return e;
  e.message = e.message.split(via.link).join(via.objKey).replace(/https?:\/\/\S*X-Amz-Signature=\S*/gi, via.objKey);
  return e;
}

/**
 * @param buf          the sound, encoded (FLAC from lib/captions-job.js)
 * @param opts.language ISO-639-1, or nothing to let Groq detect
 * @param opts.stop     () => true when the caller no longer wants the answer: no further attempt
 * @param opts.direct   (V43) true: straight up to Groq, never through R2
 * @returns the verbose_json answer: { text, language, duration, segments, words, ... }
 */
async function transcribe(buf, opts) {
  const o = opts || {};
  const key = keyOf();
  if (!key) throw new GroqSttError('no-key', 'No Groq API key - add it on Admin -> API keys.');
  await _enter();
  try {
    // (V43) Through R2 while it is configured; directly when it is not, did not take it, or Groq refused the link.
    const via = await _putForLink(buf, o);
    if (via) {
      try {
        return await _ask(key, { url: via.link }, o, TIMEOUT_MS);
      } catch (e) {
        _hidden(e, via);
        const refused = e instanceof GroqSttError && e.code === 'refused' && e.status >= 400 && e.status < 500;
        if (!refused) throw e;
        console.warn('[groq] the link to ' + via.objKey + ' was refused (' + String(e.message).slice(0, 160) + ') - the piece goes up directly');
      } finally {
        _drop(via.objKey);
      }
    }
    return await _ask(key, { file: buf }, o, TIMEOUT_MS + Math.round((buf.length || 0) / UPLINK_MIN_BPS * 1000));
  } finally {
    _leave();
  }
}

// One request, tried as the rules above say: the sound as `file` (sent up) or as `url` (fetched by Groq).
async function _ask(key, what, o, timeout) {
  let last = null;
  let tried422 = false;
  for (let attempt = 1; attempt <= TRIES; attempt++) {
    if (o.stop && o.stop()) throw new GroqSttError('stopped', 'Stopped.');
    const form = new FormData();
    if (what.url) form.append('url', what.url);
    else form.append('file', what.file, { filename: o.filename || 'sound.flac', contentType: o.contentType || 'audio/flac' });
    form.append('model', MODEL);
    form.append('response_format', 'verbose_json');
    // The brackets are part of the name: without them Groq answers "unknown param".
    form.append('timestamp_granularities[]', 'word');
    form.append('timestamp_granularities[]', 'segment');
    form.append('temperature', '0');
    if (o.language) form.append('language', String(o.language));
    try {
      const r = await axios.post(ENDPOINT, form, {
        headers: { ...form.getHeaders(), Authorization: 'Bearer ' + key },
        timeout, maxBodyLength: Infinity, maxContentLength: Infinity,
      });
      if (!r.data || typeof r.data !== 'object') throw new GroqSttError('refused', 'Groq answered with something that is not a transcript.');
      return r.data;
    } catch (e) {
      if (e instanceof GroqSttError) throw e;
      const x = _explain(e);
      last = x.err;
      if (x.retry === 'once') { if (tried422) throw x.err; tried422 = true; continue; }
      if (!x.retry || attempt === TRIES) throw x.err;
      await _sleep(x.waitS ? Math.min(WAIT_MAX_S, x.waitS) * 1000 : 2000 * Math.pow(2, attempt - 1));
    }
  }
  throw last || new GroqSttError('refused', 'Groq did not answer.');
}

// For the test stand only: a fake Groq on 127.0.0.1.
function _setEndpoint(url) { ENDPOINT = String(url); }

module.exports = { transcribe, keyOf, MODEL, GroqSttError, _setEndpoint };
