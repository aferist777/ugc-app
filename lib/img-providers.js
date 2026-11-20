'use strict';

// ════════════════════════════════════════════════════════════════════════════
// ONE IMAGE MODEL, MORE THAN ONE WAY TO REACH IT - the character ladders' matrix (lib/cv2-ladders.js,
// lib/cv2-run.js: New Character's portrait, edits and 4K sheet). The measurement below is why the
// choice of aggregator exists at all.
//
// With one aggregator, one that keeps answering ModelRateLimitError (E003) - as Replicate did for
// google/nano-banana-2 - leaves the character sheet nowhere else to go, so it simply never generates.
// Measured with the same prompt, the same 1K, the same reference:
//
//   Replicate  google/nano-banana-2            E003, twice, in 4s and 42s
//   kie.ai     nano-banana-2                   524 generate task timeout, after 189s
//   OpenRouter google/gemini-3.1-flash-image   an image, twice, in 14s and 20s
//   Replicate  bytedance/seedream-4.5          an image, in 14s   (the control: Replicate is well)
//
// The same model, reached three ways, fails and succeeds independently - because the congestion
// is upstream at Google and each aggregator queues against it differently. So the engine and the
// aggregator are two separate choices, and this file is where that pairing lives.
//
// Shape of the thing:
//   ENGINES[engine].tiers          the engine's OWN quality vocabulary
//   ENGINES[engine].providers[p]   how THAT aggregator is asked, including how the tier is spelt
//
// Only pairings that have been verified against live docs or live calls are listed. An engine
// the aggregator cannot actually serve is worse than one it does not offer, because the first
// one fails after the user has waited. And only those the ladders reach: there is no editor for
// them, so a pairing no stored ladder names is a pairing nobody can use.
// ════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const axios = require('axios');

const { DATA_DIR } = require('./config');
const {
  createNanoBananaProTask, createNanoBananaProTaskMulti, createZImageTurboTask,
  uploadToPublicHost, isOurUpload,
} = require('./helpers');
// Whether a create that failed may have started its task all the same (`unsure`) - the ladder stops on that
// (lib/cv2-run.js) rather than pay the next aggregator for the same picture.
const { said, notStarted } = require('./task-started');
const I18N = require('./i18n');

const KIE_BASE = 'https://api.kie.ai';

function _settings() {
  try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'settings.json'), 'utf8')); }
  catch { return {}; }
}

// ── kie.ai: one job envelope for every model ────────────────────────────────
// { model, input:{...} } -> taskId, and the taskId is polled by the app's resolveTask, which reads
// kie's jobs/recordInfo. Nothing downstream needs to know a kie task from a Replicate one.
async function _kieCreate(model, input) {
  const key = (_settings().kieApiKey || '').trim();
  if (!key) throw new Error(I18N.t('kie.ai API key is not configured (Admin -> API keys)'));
  let res;
  try {
    res = await axios.post(`${KIE_BASE}/api/v1/jobs/createTask`, { model, input }, {
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      timeout: 30000,
    });
  } catch (e) { throw notStarted('kie.ai', e); }
  const d = res.data || {};
  const taskId = d.data && d.data.taskId;
  if (!taskId) {
    // kie says no inside a 200, with a code of its own; a 200 with no task number and no refusal may have started one.
    if (d.code != null && Number(d.code) !== 200) throw Object.assign(new Error(I18N.t('{agg} did not start it: {why}', { agg: 'kie.ai', why: said(d) || I18N.t('code {code}', { code: d.code }) })), { unsure: false });
    throw Object.assign(new Error(I18N.t('{agg} answered without a task number - it may have started it all the same', { agg: 'kie.ai' })), { unsure: true });
  }
  console.log('[img-providers] kie', model, '->', taskId);
  return String(taskId);
}

// Aspects the app speaks, translated per aggregator. Replicate's own helpers already normalize
// their model's quirks; kie wants "auto" where we mean "same as the input".
function _aspect(a) { return (!a || a === 'match_input_image') ? 'auto' : a; }

// ── The matrix ──────────────────────────────────────────────────────────────
// tiers/def are the engine's vocabulary. Each provider says how to spell them - `q` arrives as
// one of `tiers`, and the provider entry maps it to whatever its API actually accepts.
const ENGINES = {
  'z-turbo': {
    label: 'z-image-turbo', tiers: ['1K', '2K'], def: '1K', t2i: true, i2i: false,
    // No aspect enum at all: width and height in pixels, capped at 2048. Asked as exact 3:2;
    // the 2K request comes back 2048x1360, which is the model's grid having the last word.
    wh: { '1K': [1152, 768], '2K': [2016, 1344] },
    providers: {
      replicate: {
        model: 'prunaai/z-image-turbo', t2i: true, i2i: false,
        submit: ({ prompt, quality }) => createZImageTurboTask(prompt, {
          width: ENGINES['z-turbo'].wh[quality][0], height: ENGINES['z-turbo'].wh[quality][1],
        }),
      },
    },
  },

  'nano-banana-2': {
    label: 'nano-banana-2', tiers: ['1K', '2K', '4K'], def: '2K', t2i: true, i2i: true,
    providers: {
      replicate: {
        model: 'google/nano-banana-2', t2i: true, i2i: true,
        submit: ({ prompt, imageUrls, aspect, quality }) => (imageUrls.length > 1
          ? createNanoBananaProTaskMulti(prompt, imageUrls, aspect, undefined, { resolution: quality })
          : createNanoBananaProTask(prompt, imageUrls[0] || null, aspect, { resolution: quality })),
      },
      // Same field names as Replicate's, which is not a coincidence - both are passing through
      // Google's own schema. Verified live: the submit is accepted and answers a taskId.
      kie: {
        model: 'nano-banana-2', t2i: true, i2i: true,
        submit: ({ prompt, imageUrls, aspect, quality }) => _kieCreate('nano-banana-2', {
          prompt, image_input: imageUrls, aspect_ratio: _aspect(aspect),
          resolution: quality, output_format: 'jpg',
        }),
      },
    },
  },

  'gptimage2': {
    label: 'gpt-image-2', tiers: ['low', 'medium', 'high'], def: 'high', t2i: true, i2i: true,
    providers: {
      // kie grades this one by resolution instead of effort, and splits by direction.
      kie: {
        model: 'gpt-image-2-*', t2i: true, i2i: true,
        submit: ({ prompt, imageUrls, aspect, quality }) => {
          const res = quality === 'low' ? '1K' : quality === 'medium' ? '2K' : '4K';
          return imageUrls.length
            ? _kieCreate('gpt-image-2-image-to-image', { prompt, input_urls: imageUrls, aspect_ratio: _aspect(aspect), resolution: res })
            : _kieCreate('gpt-image-2-text-to-image', { prompt, aspect_ratio: _aspect(aspect), resolution: res });
        },
      },
    },
  },
};

// Two aggregators for the character pictures; Merge's pictures have their own table (lib/mv3-img.js).
const PROVIDER_LABELS = { replicate: 'Replicate', kie: 'kie.ai' };
const PROVIDER_ORDER = ['replicate', 'kie'];

// Which aggregators can serve this engine in this direction.
function providersFor(engineId, dir) {
  const e = ENGINES[engineId];
  if (!e) return [];
  return PROVIDER_ORDER.filter(p => e.providers[p] && e.providers[p][dir]);
}

// ── When the failure is about OUR image, not their model ────────────────────
// Measured, submitting gpt-image-2:
//
//   Input validation error: HTTPSConnectionPool(host='i.ibb.co', port=443):
//   Read timed out. (read timeout=10)
//
// Nothing is wrong with the picture, the prompt or the engine. The renderer simply could not pull
// the file off our bucket inside the ten seconds it allows. There is one host, so the retry
// is a fresh upload under a new key, which answers the two
// things that actually go wrong: a signature that had nearly run out, and a cached link that
// had gone cold.
function isFetchFailure(e) {
  const parts = [e && e.message];
  try { parts.push(JSON.stringify((e.response && e.response.data) || '')); } catch (x) {}
  const t = parts.join(' ').toLowerCase();
  // 'Connection aborted' / RemoteDisconnected is what a Replicate container reports when the
  // host it was pointed at closes on it - measured: a kling job that died 313ms after starting,
  // with the video on catbox. It reads as a model failure and is not one. Same class as the rest: the file is fine, the host is unreachable to THEM.
  return /read timed out|connectionpool|failed to fetch|could not (download|fetch)|unable to (download|fetch)|image fetch failed|error downloading|connection aborted|remotedisconnected|remote end closed/.test(t);
}

// Same bytes, a new link. There is one host, so this is a fresh upload under a new key - the
// useful answer to "they could not
// fetch it": a signature with its full life ahead of it rather than one that may have run out,
// and a URL the cache cannot hand back stale. forceFresh is what stops it doing exactly that.
async function _rehost(urls) {
  const out = [];
  for (const u of urls) {
    // Logged whether or not it is ours: "the renderer cannot read the reference" is invisible
    // otherwise, and a link from somewhere else failing is worth seeing too.
    console.warn('[img-providers] the renderer could not read', String(u).slice(0, 80),
      isOurUpload(u) ? '- uploading it again' : '- not ours, uploading a copy');
    const buf = Buffer.from((await axios.get(u, { responseType: 'arraybuffer', timeout: 30000 })).data);
    const fresh = await uploadToPublicHost(buf, { forceFresh: true });
    console.warn('[img-providers] rehosted ->', fresh.slice(0, 60));
    out.push(fresh);
  }
  return out;
}

// ── The one submit ──────────────────────────────────────────────────────────
// Returns a taskId the app's resolveTask understands, whichever aggregator served it:
// 'repl:<id>' from Replicate, a bare id from kie.ai.
//
// It repairs rather than refuses: a remembered pairing can name an aggregator that no longer
// carries the engine, and stranding the page on it would be worse than substituting and saying
// so in the log. What it will NOT do is silently change the engine - that is the caller's
// decision, and quietly generating with a different model is how a character stops looking like
// themselves.
async function submitImage({ engine, provider, prompt, imageUrls, aspect, quality }) {
  const urls = (Array.isArray(imageUrls) ? imageUrls : (imageUrls ? [imageUrls] : [])).filter(Boolean);
  const dir = urls.length ? 'i2i' : 't2i';
  const e = ENGINES[engine];
  if (!e) throw new Error(I18N.t('unknown engine: {engine}', { engine }));
  const usable = providersFor(engine, dir);
  if (!usable.length) throw new Error(dir === 'i2i' ? I18N.t('{model} cannot do image-to-image', { model: e.label }) : I18N.t('{model} cannot do text-to-image', { model: e.label }));
  const p = usable.includes(provider) ? provider : usable[0];
  if (provider && p !== provider) {
    console.warn('[img-providers]', provider, 'has no', engine, dir, '- using', p);
  }
  const q = e.tiers.includes(quality) ? quality : e.def;
  const label = PROVIDER_LABELS[p] || p;

  // Every failure leaves here saying whether the task may have started all the same (`unsure`,
  // lib/task-started.js): an ANSWER that says no started nothing; no answer - a timeout, a reset, a 5xx,
  // a 200 without a task number - may have, and the ladder stops on it.
  let taskId;
  try {
    taskId = await e.providers[p].submit({ prompt, imageUrls: urls, aspect, quality: q });
  } catch (err) {
    const why = notStarted(label, err);
    // One second chance, and only for the one failure a second chance can fix: the renderer
    // could not read the reference off the host we chose - an answer, so asking the same aggregator
    // again cannot pay twice. Anything else is theirs, not ours.
    if (why.unsure || !urls.length || !isFetchFailure(err)) throw why;
    console.warn('[img-providers]', p, 'could not fetch the reference -', reasonOf(err));
    let fresh;
    try {
      fresh = await _rehost(urls);
    } catch (e2) {
      // If the file cannot be uploaded again, the ORIGINAL reason is the one worth carrying: "the
      // renderer could not read the reference" explains the failure, while "timeout downloading
      // it back" is only this rescue attempt's own footnote.
      console.warn('[img-providers] rehost failed too:', e2.message);
      throw why;
    }
    try { taskId = await e.providers[p].submit({ prompt, imageUrls: fresh, aspect, quality: q }); }
    catch (err2) { throw notStarted(label, err2); }
  }
  if (!taskId) throw Object.assign(new Error(I18N.t('{agg} answered without a task number - it may have started it all the same', { agg: label })), { unsure: true });
  return { taskId, provider: p, engine, quality: q };
}

// What an aggregator actually said, dug out of whichever envelope it used. Replicate puts it in
// data.detail, kie in data.msg, others in data.error.message - and axios's own message
// ("Request failed with status code 422") tells nobody anything.
function reasonOf(e) {
  const d = (e && e.response && e.response.data) || null;
  return (d && (d.detail || d.msg || (d.error && d.error.message))) || (e && e.message) || I18N.t('unknown error');
}

module.exports = {
  ENGINES, PROVIDER_LABELS, PROVIDER_ORDER, providersFor,
  submitImage, reasonOf,
  // Exported for the poll-time half of the cascade: Replicate accepts a job and only discovers it
  // cannot read the reference a minute later, so the rehost has to be reachable from there too.
  rehost: _rehost,
  isFetchFailure,   // exported so the rule can be checked against a real error rather than guessed at
};
