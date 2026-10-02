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
// ════════════════════════════════════════════════════════════════════════════

const axios = require('axios');
const FormData = require('form-data');
const { getSettings } = require('./settings-io');

let ENDPOINT = 'https://api.groq.com/openai/v1/audio/transcriptions';
const MODEL = 'whisper-large-v3';
const AT_ONCE = 2;
const TRIES = 4;
const TIMEOUT_MS = 120000;
const WAIT_MAX_S = 60;

class GroqSttError extends Error {
  constructor(code, message) { super(message); this.code = code; }
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
  if (r.status === 422) return { retry: 'once', err: new GroqSttError('refused', 'Groq: ' + (said || 'could not read the sound')) };
  return { retry: false, err: new GroqSttError('refused', 'Groq: ' + (said || ('HTTP ' + r.status))) };
}

/**
 * @param buf          the sound, encoded (FLAC from lib/captions-job.js)
 * @param opts.language ISO-639-1, or nothing to let Groq detect
 * @param opts.stop     () => true when the caller no longer wants the answer: no further attempt
 * @returns the verbose_json answer: { text, language, duration, segments, words, ... }
 */
async function transcribe(buf, opts) {
  const o = opts || {};
  const key = keyOf();
  if (!key) throw new GroqSttError('no-key', 'No Groq API key - add it on Admin -> API keys.');
  await _enter();
  try {
    let last = null;
    let tried422 = false;
    for (let attempt = 1; attempt <= TRIES; attempt++) {
      if (o.stop && o.stop()) throw new GroqSttError('stopped', 'Stopped.');
      const form = new FormData();
      form.append('file', buf, { filename: o.filename || 'sound.flac', contentType: o.contentType || 'audio/flac' });
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
          timeout: TIMEOUT_MS, maxBodyLength: Infinity, maxContentLength: Infinity,
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
  } finally {
    _leave();
  }
}

// For the test stand only: a fake Groq on 127.0.0.1.
function _setEndpoint(url) { ENDPOINT = String(url); }

module.exports = { transcribe, keyOf, MODEL, GroqSttError, _setEndpoint };
