'use strict';

// ════════════════════════════════════════════════════════════════════════════
// A VIDEO TASK ON AN AGGREGATOR (phase V2, docs/local-app/PLAN.md "V-A"): asked for, followed, fetched.
//
//   submit(pair, request)   -> { taskId }   'fake:v-…' | 'repl:<id>' | kie's bare id
//   poll(taskId)            -> { state: 'pending' | 'success' | 'failed', url?, local?, error?, credits? }
//   fetchTo(url, destAbs)   -> bytes        the result, downloaded once
//
// Why not lib/helpers.js resolveTask, which the pictures use: it saves a JPEG, recompresses it and makes an
// image thumbnail - a video through it would be ruined. And its Replicate branch fails a task on a network
// blip; here a poll that does not reach the aggregator is "still pending", and only the row's own time limit
// ends it (the aggregator's own "failed" ends it at once).
//
// THE REQUEST IS THE REGISTRY'S (lib/video-models.js): each model x aggregator record builds its own body
// from the neutral request - this file only knows the two envelopes:
//   kie        POST /api/v1/jobs/createTask { model, input }, GET /api/v1/jobs/recordInfo?taskId=
//              (lib/helpers.js readKieRecord reads the envelope; resultJson.resultUrls[0] is the video;
//              creditsConsumed is what it really cost). No callBackUrl, ever: a placeholder would make kie
//              POST the whole task - links to our references - to a stranger.
//   Replicate  POST /v1/models/<owner>/<name>/predictions (lib/helpers.js createReplicateTask), GET
//              /v1/predictions/<id>; the output is a URL, a list of them, or an object with one.
// Results expire (kie about 24 h, Replicate about an hour), so they are fetched the moment the task is done.
//
// With the fake aggregator on (lib/fake-agg.js, phase V0) nobody is asked: the task is a fake: id and the
// "result" a test clip made locally.
// ════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { KIE_BASE, MEDIA } = require('./config');
const { kieHeaders, readKieRecord, createReplicateTask } = require('./helpers');
const { getSettings } = require('./settings-io');
const FAKE = require('./fake-agg');

const KIE = KIE_BASE || 'https://api.kie.ai';
const MAX_BYTES = 1024 * 1024 * 1024;          // a result over a gigabyte is not a short clip

// kie answers a refusal INSIDE a 200: { code, msg }.
function _kieWords(d) {
  return String((d && (d.msg || d.message)) || '').trim();
}

async function submit(pair, request) {
  const req = request || {};
  if (FAKE.on()) return { taskId: FAKE.task('v', { prompt: req.prompt, aspect: req.aspect || (req.params || {}).aspect, duration: (req.params || {}).duration }) };
  const built = pair.build(req);
  if (pair.agg === 'kie') {
    const r = await axios.post(KIE + '/api/v1/jobs/createTask', { model: built.model, input: built.input },
      { headers: kieHeaders(), timeout: 30000 });
    const d = r.data || {};
    const taskId = d.data && d.data.taskId;
    if (!taskId || (d.code != null && Number(d.code) !== 200)) {
      throw new Error('kie.ai did not start it: ' + (_kieWords(d) || ('code ' + d.code)));
    }
    return { taskId: String(taskId) };
  }
  if (pair.agg === 'replicate') {
    return { taskId: await createReplicateTask(built.model, built.input) };
  }
  throw new Error('no such aggregator: ' + pair.agg);
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
    const key = String((getSettings() || {}).replicateApiKey || '').trim();
    if (!key) return { state: 'failed', error: 'Replicate - no key (Admin -> API keys)' };
    let pred;
    try {
      pred = (await axios.get('https://api.replicate.com/v1/predictions/' + id.slice(5),
        { headers: { Authorization: 'Bearer ' + key }, timeout: 20000 })).data;
    } catch (e) {
      const st = e.response && e.response.status;
      if (st === 401 || st === 403 || st === 404) return { state: 'failed', error: 'Replicate answered ' + st + ' for this task' };
      return { state: 'pending' };          // the network, not the task
    }
    const status = pred && pred.status;
    if (status === 'failed' || status === 'canceled') return { state: 'failed', error: String((pred && pred.error) || status) };
    if (status !== 'succeeded') return { state: 'pending' };
    const url = _url(pred.output);
    if (!url) return { state: 'failed', error: 'Replicate finished with no video in its answer' };
    return { state: 'success', url };
  }
  let env;
  try {
    env = (await axios.get(KIE + '/api/v1/jobs/recordInfo', { params: { taskId: id }, headers: kieHeaders(), timeout: 20000 })).data;
  } catch (e) {
    const st = e.response && e.response.status;
    if (st === 401 || st === 403) return { state: 'failed', error: 'kie.ai answered ' + st + ' for this task' };
    return { state: 'pending' };
  }
  // A busy or failing kie answers its own code in the envelope (429 too many requests, 5xx): that is the weather,
  // not the task - asked again next time. 501 is kie's word for a task that failed.
  const code = env && env.code != null ? Number(env.code) : 200;
  if (code === 429 || (code >= 500 && code !== 501)) return { state: 'pending' };
  const read = readKieRecord(env);
  if (read.state === 'failed') {
    // kie gives up on its side after ten minutes of silence (408) - a long Kling clip is the usual case.
    const late = /\b408\b|over 10 minutes/i.test(String(read.error || '')) || String(read.failCode || '') === '408';
    return { state: 'failed', error: late ? 'kie.ai gave up after ten minutes with no result (nothing was charged) - long motion control clips go better on Replicate' : read.error };
  }
  if (read.state !== 'success') return { state: 'pending' };
  let parsed = null;
  try { parsed = JSON.parse(read.data.resultJson || 'null'); } catch (e) { parsed = null; }
  const url = _url(parsed && (parsed.resultUrls || parsed));
  if (!url) return { state: 'failed', error: 'kie.ai finished with no video in its answer' };
  const credits = +read.data.creditsConsumed || 0;
  return { state: 'success', url, credits };
}

/** The result, downloaded once into `destAbs` (a temp name first, so a half file never looks finished). */
async function fetchTo(url, destAbs) {
  fs.mkdirSync(path.dirname(destAbs), { recursive: true });
  const tmp = destAbs + '.part';
  const res = await axios({ url, method: 'GET', responseType: 'stream', timeout: 180000, maxContentLength: MAX_BYTES });
  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(tmp);
    let n = 0;
    res.data.on('data', (c) => {
      n += c.length;
      if (n > MAX_BYTES) { res.data.destroy(new Error('the result is over a gigabyte')); }
    });
    res.data.on('error', reject);
    // An expired link answers with a page, not a video: never saved as one.
    const type = String((res.headers && res.headers['content-type']) || '');
    if (/text\/html|application\/json/i.test(type)) { res.data.destroy(); reject(new Error('the result link answered ' + type + ' instead of a video (it may have expired)')); return; }
    out.on('error', reject);
    out.on('finish', resolve);
    res.data.pipe(out);
  }).catch((e) => { try { fs.unlinkSync(tmp); } catch (x) { /* not there */ } throw e; });
  fs.renameSync(tmp, destAbs);
  return fs.statSync(destAbs).size;
}

module.exports = { submit, poll, fetchTo, _url };
