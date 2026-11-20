'use strict';

// ════════════════════════════════════════════════════════════════════════════
// A VIDEO TASK ON AN AGGREGATOR: asked for, followed, fetched.
//
//   submit(pair, request)   -> { taskId }   'fake:v-…' | 'repl:<id>' | kie's bare id
//   poll(taskId)            -> { state: 'pending' | 'success' | 'failed', url?, local?, error?, credits?, late? }
//   fetchTo(url, destAbs)   -> bytes        the result, downloaded once
//   cancel(taskId)          best effort: a Replicate prediction let go of stops (kie has no way to stop one)
//
// Why not lib/helpers.js resolveTask, which the pictures use: it saves a JPEG, recompresses it and makes an
// image thumbnail - a video through it would be ruined. Here, as there, a poll that does not reach the
// aggregator, or reaches it and is turned away, is "still pending": only the aggregator saying THE TASK failed
// ends it at once, and the watcher's own clock ends the rest.
//
// WAS IT STARTED? (lib/task-started.js, shared with the pictures) Only an ANSWER
// says no. A request that got none - a timeout, a reset connection - or a 5xx from the aggregator's edge may
// have started a task nobody will hear of: neither aggregator takes a key that makes asking twice safe, and the
// task's number was only in the answer that was lost. Such a failure is thrown `unsure`, and the ladder stops on
// it (lib/mv3-video-gens.js) rather than pay a second aggregator for the same clip. An answer with a task number
// is followed, whatever else it says.
//
// THE REQUEST IS THE REGISTRY'S (lib/video-models.js): each model x aggregator record builds its own body
// from the neutral request - this file only knows the two envelopes:
//   kie        POST /api/v1/jobs/createTask { model, input }, GET /api/v1/jobs/recordInfo?taskId=
//              (lib/helpers.js readKieRecord reads the envelope; resultJson.resultUrls[0] is the video;
//              creditsConsumed is what it really cost). No callBackUrl, ever: a placeholder would make kie
//              POST the whole task - links to our references - to a stranger.
//   Replicate  POST /v1/models/<owner>/<name>/predictions (every video model is an official one, so no
//              version is needed), GET /v1/predictions/<id>; the output is a URL, a list of them, or an
//              object with one.
// Results expire (kie about 24 h, Replicate about an hour), so they are fetched the moment the task is done.
//
// With the fake aggregator on (lib/fake-agg.js) nobody is asked: the task is a fake: id and the
// "result" a test clip made locally.
// ════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { KIE_BASE, MEDIA } = require('./config');
const { kieHeaders, readKieRecord } = require('./helpers');
const { getSettings } = require('./settings-io');
const FAKE = require('./fake-agg');
const { said: _said, notStarted } = require('./task-started');
const I18N = require('./i18n');

const KIE = KIE_BASE || 'https://api.kie.ai';
const REPL = 'https://api.replicate.com/v1';
const MAX_BYTES = 1024 * 1024 * 1024;          // a result over a gigabyte is not a short clip
const LABEL = { kie: 'kie.ai', replicate: 'Replicate' };

const _replKey = () => String((getSettings() || {}).replicateApiKey || '').trim();

/** The error of a create that failed: `unsure` when it may have started the task all the same. */
const _notStarted = (agg, e) => notStarted(LABEL[agg], e);

async function submit(pair, request) {
  const req = request || {};
  if (FAKE.on()) {
    // One Seedance clip: the test clip is as long as the clip, as the real one would be.
    const one = require('./video-models').byClip(pair, req);
    const secs = one && one.secs > 0 ? (one.duration === -1 ? one.secs : one.duration) : (req.params || {}).duration;
    return { taskId: FAKE.task('v', { prompt: req.prompt, aspect: req.aspect || (req.params || {}).aspect, duration: secs }) };
  }
  const built = pair.build(req);
  if (pair.agg === 'kie') {
    let r;
    try {
      r = await axios.post(KIE + '/api/v1/jobs/createTask', { model: built.model, input: built.input },
        { headers: kieHeaders(), timeout: 30000 });
    } catch (e) { throw _notStarted('kie', e); }
    const d = (r && r.data) || {};
    const taskId = d.data && d.data.taskId;
    if (taskId) return { taskId: String(taskId) };
    // kie answers a refusal INSIDE a 200: { code, msg } - an answer, so nothing was started.
    if (d.code != null && Number(d.code) !== 200) throw new Error(I18N.t('{agg} did not start it: {why}', { agg: 'kie.ai', why: _said(d) || I18N.t('code {code}', { code: d.code }) }));
    throw Object.assign(new Error(I18N.t('{agg} answered without a task number - it may have started it all the same', { agg: 'kie.ai' })), { unsure: true });
  }
  if (pair.agg === 'replicate') {
    const key = _replKey();
    if (!key) throw new Error(I18N.t('{agg} - no key (Admin -> API keys)', { agg: 'Replicate' }));
    let r;
    try {
      r = await axios.post(REPL + '/models/' + built.model + '/predictions', { input: built.input },
        { headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, timeout: 30000 });
    } catch (e) { throw _notStarted('replicate', e); }
    const id = r && r.data && r.data.id;
    if (!id) throw Object.assign(new Error(I18N.t('{agg} answered without a task number - it may have started it all the same', { agg: 'Replicate' })), { unsure: true });
    return { taskId: 'repl:' + id };
  }
  throw new Error(I18N.t('no such aggregator: {agg}', { agg: pair.agg }));
}

// The video's address in whatever envelope it came.
function _url(out) {
  if (!out) return '';
  if (typeof out === 'string') return /^https?:\/\//i.test(out) ? out : '';
  if (Array.isArray(out)) { for (const x of out) { const u = _url(x); if (u) return u; } return ''; }
  if (typeof out === 'object') return _url(out.video || out.url || out.output || out.resultUrls || out.video_url || '');
  return '';
}

async function poll(taskId) {
  const id = String(taskId || '');
  if (id.startsWith('fake:')) {
    const out = await FAKE.resolve(id, MEDIA.work, 'mvid');
    if (out.state === 'success') return { state: 'success', local: out.videoPath };
    return out;
  }
  if (id.startsWith('repl:')) {
    // No key now (cleared on Admin), the key changed (401/403), a task this key cannot see (404), the network:
    // none of them is the TASK failing - it runs on, paid for; asked again, and the watcher's clock ends it.
    const key = _replKey();
    if (!key) return { state: 'pending' };
    let pred;
    try {
      pred = (await axios.get(REPL + '/predictions/' + id.slice(5),
        { headers: { Authorization: 'Bearer ' + key }, timeout: 20000 })).data;
    } catch (e) { return { state: 'pending' }; }
    const status = pred && pred.status;
    if (status === 'failed' || status === 'canceled') return { state: 'failed', error: String((pred && pred.error) || status) };
    if (status !== 'succeeded') return { state: 'pending' };
    const url = _url(pred.output);
    if (!url) return { state: 'failed', error: I18N.t('{agg} finished with no video in its answer', { agg: 'Replicate' }) };
    return { state: 'success', url };
  }
  let env;
  try {
    env = (await axios.get(KIE + '/api/v1/jobs/recordInfo', { params: { taskId: id }, headers: kieHeaders(), timeout: 20000 })).data;
  } catch (e) { return { state: 'pending' }; }
  // kie answers its own code in the envelope, and only 501 is the task failing: 429 too many requests, 455
  // maintenance, 5xx, 401/403 a key changed on Admin, 404/422 a task not visible yet - and anything unknown -
  // are the weather, asked again next time.
  const code = env && env.code != null ? Number(env.code) : 200;
  if (code !== 200 && code !== 501) return { state: 'pending' };
  const read = readKieRecord(env);
  if (read.state === 'failed') {
    // kie gives up on its side after ten minutes of silence (408) - a long Kling clip is the usual case.
    const late = /\b408\b|over 10 minutes/i.test(String(read.error || '')) || String(read.failCode || '') === '408';
    return late ? { state: 'failed', late: true, error: I18N.t('kie.ai gave up after ten minutes with no result (nothing was charged)') }
                : { state: 'failed', error: read.error };
  }
  if (read.state !== 'success') return { state: 'pending' };
  let parsed = null;
  try { parsed = JSON.parse(read.data.resultJson || 'null'); } catch (e) { parsed = null; }
  const url = _url(parsed && (parsed.resultUrls || parsed));
  if (!url) return { state: 'failed', error: I18N.t('{agg} finished with no video in its answer', { agg: 'kie.ai' }) };
  const credits = +read.data.creditsConsumed || 0;
  return { state: 'success', url, credits };
}

const BUSY = new Set(['EPERM', 'EACCES', 'EBUSY']);
const _wait = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * The result, downloaded once into `destAbs` (a temp name first, so a half file never looks finished).
 * An error marked `permanent` will not get better by asking again - the link answered 4xx or a page instead of
 * a video (it expired), or the file is too big; any other is worth another try while the link lives.
 */
async function fetchTo(url, destAbs) {
  fs.mkdirSync(path.dirname(destAbs), { recursive: true });
  const tmp = destAbs + '.part';
  let res;
  try {
    res = await axios({ url, method: 'GET', responseType: 'stream', timeout: 180000, maxContentLength: MAX_BYTES });
  } catch (e) {
    const st = e && e.response && e.response.status;
    const err = new Error(st ? I18N.t('the result link answered {status}', { status: st }) : ((e && e.message) || I18N.t('the result could not be fetched')));
    err.permanent = !!st && st >= 400 && st < 500 && st !== 408 && st !== 429;
    throw err;
  }
  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(tmp);
    let n = 0;
    res.data.on('data', (c) => {
      n += c.length;
      if (n > MAX_BYTES) { res.data.destroy(Object.assign(new Error(I18N.t('the result is over a gigabyte')), { permanent: true })); }
    });
    res.data.on('error', reject);
    // An expired link answers with a page, not a video: never saved as one.
    const type = String((res.headers && res.headers['content-type']) || '');
    if (/text\/html|application\/json/i.test(type)) {
      res.data.destroy();
      reject(Object.assign(new Error(I18N.t('the result link answered {type} instead of a video (it may have expired)', { type })), { permanent: true }));
      return;
    }
    out.on('error', reject);
    out.on('finish', resolve);
    res.data.pipe(out);
  }).catch((e) => { try { fs.unlinkSync(tmp); } catch (x) { /* not there */ } throw e; });
  // A scanner looking at the fresh file holds it for a moment - Windows refuses to rename an open file.
  for (let attempt = 1; ; attempt++) {
    try { fs.renameSync(tmp, destAbs); break; }
    catch (e) {
      if (!BUSY.has(e.code) || attempt >= 7) throw e;
      await _wait(40 * 2 ** (attempt - 1));
    }
  }
  return fs.statSync(destAbs).size;
}

/** Best effort, never throws: a Replicate prediction let go of is cancelled - a running one stops being billed. */
async function cancel(taskId) {
  const id = String(taskId || '');
  if (!id.startsWith('repl:')) return false;
  const key = _replKey();
  if (!key) return false;
  try {
    await axios.post(REPL + '/predictions/' + id.slice(5) + '/cancel', {}, { headers: { Authorization: 'Bearer ' + key }, timeout: 20000 });
    return true;
  } catch (e) { return false; }
}

module.exports = { submit, poll, fetchTo, cancel, _url };
