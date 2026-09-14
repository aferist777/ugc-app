'use strict';

// ════════════════════════════════════════════════════════════════════════════
// ONE IMAGE MODEL, THREE WAYS TO REACH IT.
//
// Every image the app makes went through Replicate. That was fine until the day Replicate
// answered ModelRateLimitError (E003) for google/nano-banana-2 and kept answering it: the
// character sheet had nowhere else to go, so it simply never generated. Measured that day, same
// prompt, same 1K, same reference:
//
//   Replicate  google/nano-banana-2            E003, twice, in 4s and 42s
//   kie.ai     nano-banana-2                   524 generate task timeout, after 189s
//   OpenRouter google/gemini-3.1-flash-image   an image, twice, in 14s and 20s
//   Replicate  bytedance/seedream-4.5          an image, in 14s   (the control: Replicate is well)
//
// The same model, reached three ways, fails and succeeds independently - because the congestion
// is upstream at Google and each aggregator queues against it differently. So the engine and the
// aggregator become two separate choices, and this file is where that pairing lives.
//
// Shape of the thing:
//   ENGINES[engine].tiers          the engine's OWN quality vocabulary, shown as-is in the gear
//   ENGINES[engine].providers[p]   how THAT aggregator is asked, including how the tier is spelt
//
// Only pairings that have been verified against live docs or live calls are listed. An engine
// the aggregator cannot actually serve is worse than one it does not offer, because the first
// one fails after the user has waited.
// ════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const axios = require('axios');

const { TEMP_DIR, DATA_DIR } = require('./config');
const {
  createNanoBananaProTask, createNanoBananaProTaskMulti, createQwen2Task, createGptImage2Task,
  createSeedream5LiteTask, createSeedream45Task, createZImageTurboTask, createFlux2MaxTask,
  uploadToPublicHost, hostOfUrl, noteHostFailure,
} = require('./helpers');

const KIE_BASE = 'https://api.kie.ai';
const OR_IMAGES = 'https://openrouter.ai/api/v1/images';

function _settings() {
  try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'settings.json'), 'utf8')); }
  catch { return {}; }
}

// ── kie.ai: one job envelope for every model ────────────────────────────────
// { model, input:{...} } -> taskId, and the taskId is polled by the app's existing resolveTask,
// which has read kie's jobs/recordInfo since long before this file existed. Nothing downstream
// needs to know a kie task from a Replicate one.
async function _kieCreate(model, input) {
  const key = (_settings().kieApiKey || '').trim();
  if (!key) throw new Error('kie.ai API key is not configured (Brain -> API keys)');
  const res = await axios.post(`${KIE_BASE}/api/v1/jobs/createTask`, { model, input }, {
    headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    timeout: 30000,
  });
  const taskId = res.data && res.data.data && res.data.data.taskId;
  if (!taskId) throw new Error('kie.ai returned no taskId: ' + JSON.stringify(res.data).slice(0, 200));
  console.log('[img-providers] kie', model, '->', taskId);
  return String(taskId);
}

// ── OpenRouter: no job, no taskId - the image is IN the reply ───────────────
// POST /api/v1/images answers with base64 after ~15-20s. Every caller in this project polls a
// task, so rather than teach them all a second shape, the bytes are written to temp_files and
// the caller is handed `or:<file>` - a task that is already finished. resolveTask picks it up
// from there. Disk rather than memory on purpose: a restart between the answer and the poll
// would otherwise throw away an image that has already been paid for.
//
// Two failures worth knowing about, both measured:
//   "User location is not supported for the API use"  - the Google AI Studio upstream, which
//       refuses by region. Hence `ignore`: routing to it is a guaranteed 400 for us.
//   "Resource exhausted" (429)                        - Vertex out of capacity. Pinning the
//       upstream (allow_fallbacks:false) turns every request into that, so it is NOT pinned.
// A parked image is claimed by the first poll and deleted there. One that is never polled - the
// page was closed, the caller crashed, a task nobody asked about - would sit in temp_files at a
// megabyte each forever, so anything left after a day goes on the next write. A day is far longer
// than any poll that is still coming.
const _OR_TTL = 24 * 60 * 60 * 1000;
function _sweepOrphans() {
  try {
    const now = Date.now();
    for (const n of fs.readdirSync(TEMP_DIR)) {
      if (!/^or_\d+_\d+\.jpg$/.test(n)) continue;
      const p = path.join(TEMP_DIR, n);
      if (now - fs.statSync(p).mtimeMs > _OR_TTL) {
        fs.unlinkSync(p);
        console.log('[img-providers] swept an unclaimed image:', n);
      }
    }
  } catch (e) {}
}

let _orSeq = 0;
async function _orImage(model, body) {
  const key = (_settings().openRouterApiKey || '').trim();
  if (!key) throw new Error('OpenRouter API key is not configured (Brain -> API keys)');
  const t0 = Date.now();
  const res = await axios.post(OR_IMAGES, body, {
    headers: {
      Authorization: 'Bearer ' + key, 'Content-Type': 'application/json',
      'HTTP-Referer': 'https://localhost:3000', 'X-Title': 'UGC Character Generator',
    },
    // Long, because dropping the socket loses an image that has already been paid for - but not
    // unbounded, because this call IS the generation and a cascade cannot wait behind it forever.
    // Measured: 1K and 2K answer in 14-20s; a 4K request did not answer in five minutes and came
    // back a 400 after fifteen. Four minutes is generous for the tiers that work and a decision
    // for the one that does not.
    timeout: 240000,
  });
  const d = res.data && res.data.data && res.data.data[0];
  let buf = null;
  if (d && d.b64_json) buf = Buffer.from(d.b64_json, 'base64');
  else if (d && d.url) buf = Buffer.from((await axios.get(d.url, { responseType: 'arraybuffer', timeout: 60000 })).data);
  if (!buf || !buf.length) throw new Error('OpenRouter returned no image: ' + JSON.stringify(res.data).slice(0, 200));

  if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });
  _sweepOrphans();
  const file = 'or_' + Date.now() + '_' + (++_orSeq) + '.jpg';
  fs.writeFileSync(path.join(TEMP_DIR, file), buf);
  const cost = res.data.usage && res.data.usage.cost;
  console.log('[img-providers] openrouter', model, ((Date.now() - t0) / 1000).toFixed(1) + 's',
    Math.round(buf.length / 1024) + 'KB', cost != null ? ('$' + cost) : '', '->', file);
  return 'or:' + file;
}

// What OpenRouter is told about routing. Only the Google models need it, and they need it badly.
const _OR_ROUTE = { ignore: ['google-ai-studio', 'Google AI Studio'] };

// Aspects the app speaks, translated per aggregator. Replicate's own helpers already normalize
// their model's quirks; kie wants "auto" where we mean "same as the input".
function _aspect(a) { return (!a || a === 'match_input_image') ? 'auto' : a; }

// ── OpenRouter does NOT take "auto" ─────────────────────────────────────────
// Measured, editing a portrait through google/gemini-3.1-flash-image:
//
//   No provider for google/gemini-3.1-flash-image supports the requested parameter(s):
//   ... aspect_ratio "auto" ... Provider rejections: Google: aspect_ratio: not supported.
//   Accepted: 1:1, 1:4, 1:8, 2:3, 3:2, 3:4, 4:1, 4:3, 4:5, 5:4, 8:1, 9:16, 16:9, 21:9
//
// So "same as the input" has to be worked out rather than asked for: the reference is
// measured and snapped to the nearest ratio the list allows. scen3 already had to do this
// for a different reason - several references of different shapes - and reached the same
// answer, which is a fair sign it is the right one.
//
// With no reference there is nothing to measure, and the field is dropped instead of being
// sent as a word the API rejects: a model's own default is closer to "auto" than a 400 is.
const OR_ASPECTS = [
  ['1:1', 1], ['1:4', 0.25], ['1:8', 0.125], ['2:3', 2 / 3], ['3:2', 3 / 2], ['3:4', 3 / 4],
  ['4:1', 4], ['4:3', 4 / 3], ['4:5', 4 / 5], ['5:4', 5 / 4], ['8:1', 8],
  ['9:16', 9 / 16], ['16:9', 16 / 9], ['21:9', 21 / 9],
];
const _ratioCache = new Map();

async function _orAspect(aspect, urls) {
  const a = _aspect(aspect);
  if (a !== 'auto') return a;                       // an explicit ratio is already legal
  const src = (urls || [])[0];
  if (!src) return null;                            // nothing to measure - send no field

  if (_ratioCache.has(src)) return _ratioCache.get(src);
  try {
    const sharp = require('sharp');
    const buf = Buffer.from((await axios.get(src, { responseType: 'arraybuffer', timeout: 20000 })).data);
    const m = await sharp(buf).metadata();
    if (!m.width || !m.height) throw new Error('no dimensions');
    const r = m.width / m.height;
    let best = OR_ASPECTS[0];
    for (const c of OR_ASPECTS) if (Math.abs(c[1] - r) < Math.abs(best[1] - r)) best = c;
    console.log(`[img-providers] openrouter: reference ${m.width}x${m.height} -> aspect ${best[0]}`);
    _ratioCache.set(src, best[0]);
    return best[0];
  } catch (e) {
    // Not fatal: the field goes away and the model uses its own default. Better a picture
    // in the wrong shape than no picture and a 400.
    console.warn('[img-providers] could not measure the reference for an aspect:', e.message);
    return null;
  }
}

// aspect_ratio is only spelled out when there is something to say. Spread into the body so
// a null simply is not there, rather than being sent as null.
const _orAspectField = (a) => (a ? { aspect_ratio: a } : {});

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
      // Verified live: 14-20s, 1264x848 for a 3:2 1K request, $0.067. NOT the chat/completions
      // path - that one ignores aspect_ratio and hands back a 1024x1024 square.
      openrouter: {
        model: 'google/gemini-3.1-flash-image', t2i: true, i2i: true,
        submit: async ({ prompt, imageUrls, aspect, quality }) => _orImage('google/gemini-3.1-flash-image', {
          model: 'google/gemini-3.1-flash-image', prompt,
          ..._orAspectField(await _orAspect(aspect, imageUrls)),
          resolution: quality, output_format: 'jpeg',
          provider: _OR_ROUTE,
          ...(imageUrls.length ? { input_references: imageUrls.map(u => ({ type: 'image_url', image_url: { url: u } })) } : {}),
        }),
      },
    },
  },

  'seedream4.5': {
    label: 'seedream-4.5', tiers: ['2K', '4K'], def: '2K', t2i: true, i2i: true,
    providers: {
      replicate: {
        model: 'bytedance/seedream-4.5', t2i: true, i2i: true,
        submit: ({ prompt, imageUrls, aspect, quality }) =>
          createSeedream45Task(prompt, imageUrls.length ? imageUrls : null, aspect, undefined, { size: quality }),
      },
      // kie splits by direction and speaks basic/high rather than 2K/4K. Only the text-to-image
      // half is documented, so only that half is offered.
      kie: {
        model: 'seedream/4.5-text-to-image', t2i: true, i2i: false,
        submit: ({ prompt, aspect, quality }) => _kieCreate('seedream/4.5-text-to-image', {
          prompt, aspect_ratio: _aspect(aspect) === 'auto' ? '1:1' : _aspect(aspect),
          quality: quality === '4K' ? 'high' : 'basic', nsfw_checker: false,
        }),
      },
      openrouter: {
        model: 'bytedance-seed/seedream-4.5', t2i: true, i2i: true,
        submit: async ({ prompt, imageUrls, aspect, quality }) => _orImage('bytedance-seed/seedream-4.5', {
          model: 'bytedance-seed/seedream-4.5', prompt,
          ..._orAspectField(await _orAspect(aspect, imageUrls)),
          resolution: quality, output_format: 'jpeg',
          ...(imageUrls.length ? { input_references: imageUrls.map(u => ({ type: 'image_url', image_url: { url: u } })) } : {}),
        }),
      },
    },
  },

  'gptimage2': {
    label: 'gpt-image-2', tiers: ['low', 'medium', 'high'], def: 'high', t2i: true, i2i: true,
    providers: {
      replicate: {
        model: 'openai/gpt-image-2', t2i: true, i2i: true,
        submit: ({ prompt, imageUrls, aspect, quality }) =>
          createGptImage2Task(prompt, imageUrls.length ? imageUrls : null, aspect, { quality }),
      },
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
      openrouter: {
        model: 'openai/gpt-image-2', t2i: true, i2i: true,
        submit: async ({ prompt, imageUrls, aspect, quality }) => _orImage('openai/gpt-image-2', {
          model: 'openai/gpt-image-2', prompt,
          ..._orAspectField(await _orAspect(aspect, imageUrls)),
          quality, output_format: 'jpeg',
          ...(imageUrls.length ? { input_references: imageUrls.map(u => ({ type: 'image_url', image_url: { url: u } })) } : {}),
        }),
      },
    },
  },

  'seedream': {
    label: 'seedream-5-lite', tiers: ['2K', '3K'], def: '2K', t2i: true, i2i: true,
    providers: {
      replicate: {
        model: 'bytedance/seedream-5-lite', t2i: true, i2i: true,
        submit: ({ prompt, imageUrls, aspect, quality }) =>
          createSeedream5LiteTask(prompt, imageUrls.length ? imageUrls : null, aspect, undefined, { size: quality }),
      },
    },
  },

  'flux-2-max': {
    label: 'flux-2-max', tiers: ['0.5 MP', '1 MP', '2 MP', '4 MP'], def: '2 MP', t2i: true, i2i: true,
    providers: {
      // OpenRouter carries flux.2-pro, which is a different model wearing a similar name - so it
      // is not listed here. A fallback that quietly swaps the model is a fallback that lies.
      replicate: {
        model: 'black-forest-labs/flux-2-max', t2i: true, i2i: true,
        submit: ({ prompt, imageUrls, aspect, quality }) =>
          createFlux2MaxTask(prompt, imageUrls.length ? imageUrls : null, aspect, { resolution: quality }),
      },
    },
  },

  'qwen2': {
    label: 'qwen-image-edit-plus', tiers: ['standard'], def: 'standard', t2i: false, i2i: true,
    providers: {
      replicate: {
        model: 'qwen/qwen-image-edit-plus', t2i: false, i2i: true,
        submit: ({ prompt, imageUrls, aspect }) => createQwen2Task(prompt, imageUrls, aspect, undefined, { output_quality: 100 }),
      },
    },
  },
};

const PROVIDER_LABELS = { replicate: 'Replicate', kie: 'kie.ai', openrouter: 'OpenRouter' };
const PROVIDER_ORDER = ['replicate', 'kie', 'openrouter'];

// Which aggregators can serve this engine in this direction.
function providersFor(engineId, dir) {
  const e = ENGINES[engineId];
  if (!e) return [];
  return PROVIDER_ORDER.filter(p => e.providers[p] && e.providers[p][dir]);
}

// The whole matrix, shaped for the gear: one list per direction, each engine carrying the
// aggregators that can actually do it. Built from the same table that submits, so the UI cannot
// offer a pairing that fails at submit time.
function listEngines(dir) {
  const out = [];
  for (const [id, e] of Object.entries(ENGINES)) {
    if (!e[dir]) continue;
    const providers = providersFor(id, dir);
    if (!providers.length) continue;
    out.push({ id, label: e.label, tiers: e.tiers, def: e.def, providers });
  }
  return out;
}

function matrix() {
  return {
    providers: PROVIDER_ORDER.map(id => ({ id, label: PROVIDER_LABELS[id] })),
    t2i: { engines: listEngines('t2i') },
    i2i: { engines: listEngines('i2i') },
  };
}

// ── When the failure is about OUR image, not their model ────────────────────
// Measured, submitting gpt-image-2:
//
//   Input validation error: HTTPSConnectionPool(host='i.ibb.co', port=443):
//   Read timed out. (read timeout=10)
//
// Nothing is wrong with the picture, the prompt or the engine. The renderer simply could not pull
// the file off our bucket inside the ten seconds it allows. There is one host now, so the retry
// is no longer a move elsewhere - it is a fresh upload under a new key, which answers the two
// things that actually go wrong: a signature that had nearly run out, and a cached link that
// had gone cold.
function isFetchFailure(e) {
  const parts = [e && e.message];
  try { parts.push(JSON.stringify((e.response && e.response.data) || '')); } catch (x) {}
  const t = parts.join(' ').toLowerCase();
  // 'Connection aborted' / RemoteDisconnected is what a Replicate container reports when the
  // host it was pointed at closes on it - measured: a kling job that died 313ms after starting,
  // with the video on catbox. It read as a model failure and was not one, so the rescue never
  // fired. Same class as the rest: the file is fine, the host is unreachable to THEM.
  return /read timed out|connectionpool|failed to fetch|could not (download|fetch)|unable to (download|fetch)|image fetch failed|error downloading|connection aborted|remotedisconnected|remote end closed/.test(t);
}

// Same bytes, a new link. There is one host now, so this is no longer a move to somewhere else -
// it is a fresh upload under a new key, which is still the useful answer to "they could not
// fetch it": a signature with its full life ahead of it rather than one that may have run out,
// and a URL the cache cannot hand back stale. forceFresh is what stops it doing exactly that.
async function _rehost(urls) {
  const out = [];
  for (const u of urls) {
    // Recorded, not rerouted: with one host there is nowhere to route to, and the log line is
    // the thing that makes "the renderer cannot read our bucket" visible at all.
    noteHostFailure(u);
    const buf = Buffer.from((await axios.get(u, { responseType: 'arraybuffer', timeout: 30000 })).data);
    const fresh = await uploadToPublicHost(buf, { forceFresh: true });
    console.warn('[img-providers] rehosted', hostOfUrl(u) || u.slice(0, 40), '->', fresh.slice(0, 60));
    out.push(fresh);
  }
  return out;
}

// ── The one submit ──────────────────────────────────────────────────────────
// Returns a taskId the app's resolveTask understands, whichever aggregator served it:
// 'repl:<id>' from Replicate, a bare id from kie.ai, 'or:<file>' from OpenRouter.
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
  if (!e) throw new Error('unknown engine: ' + engine);
  const usable = providersFor(engine, dir);
  if (!usable.length) throw new Error(e.label + ' cannot do ' + (dir === 'i2i' ? 'image-to-image' : 'text-to-image'));
  const p = usable.includes(provider) ? provider : usable[0];
  if (provider && p !== provider) {
    console.warn('[img-providers]', provider, 'has no', engine, dir, '- using', p);
  }
  const q = e.tiers.includes(quality) ? quality : e.def;

  let taskId;
  try {
    taskId = await e.providers[p].submit({ prompt, imageUrls: urls, aspect, quality: q });
  } catch (err) {
    // One second chance, and only for the one failure a second chance can fix: the renderer
    // could not read the reference off the host we chose. Anything else is theirs, not ours.
    if (!urls.length || !isFetchFailure(err)) throw err;
    console.warn('[img-providers]', p, 'could not fetch the reference -', reasonOf(err));
    let fresh;
    try {
      fresh = await _rehost(urls);
    } catch (e2) {
      // If the file cannot be moved, the ORIGINAL reason is the one worth carrying: "the renderer
      // could not read i.ibb.co" explains the failure, while "timeout downloading from i.ibb.co"
      // is only this rescue attempt's own footnote.
      console.warn('[img-providers] rehost failed too:', e2.message);
      throw err;
    }
    taskId = await e.providers[p].submit({ prompt, imageUrls: fresh, aspect, quality: q });
  }
  if (!taskId) throw new Error(PROVIDER_LABELS[p] + ' returned no taskId');
  return { taskId, provider: p, engine, quality: q };
}

// What an aggregator actually said, dug out of whichever envelope it used. Replicate puts it in
// data.detail, kie in data.msg, OpenRouter in data.error.message - and axios's own message
// ("Request failed with status code 422") tells nobody anything.
function reasonOf(e) {
  const d = (e && e.response && e.response.data) || null;
  return (d && (d.detail || d.msg || (d.error && d.error.message))) || (e && e.message) || 'unknown error';
}

// ── The cascade ─────────────────────────────────────────────────────────────
// The same model, tried through every aggregator that carries it, starting with the one that was
// asked for. An error is only worth showing once there is nowhere left to try.
//
// This is the difference between "Input validation error: HTTPSConnectionPool ... Read timed out"
// and nothing at all happening: nano-banana-2 is on all three, so a Replicate that cannot fetch
// the reference, a kie.ai that times out and a Google that is out of capacity have to ALL be true
// before anyone hears about it.
//
// onAttempt fires after each failure with what went wrong and who is next, so a page can say
// "Replicate could not - trying kie.ai" instead of stopping.
async function submitWithFallback(opts) {
  const { engine, provider, onAttempt, skip = [] } = opts;
  const urls = (Array.isArray(opts.imageUrls) ? opts.imageUrls : (opts.imageUrls ? [opts.imageUrls] : [])).filter(Boolean);
  const all = providersFor(engine, urls.length ? 'i2i' : 't2i');
  if (!all.length) throw new Error((ENGINES[engine] ? ENGINES[engine].label : engine) + ' has no aggregator for this');

  // Asked-for first, then the rest in their usual order; anything already tried is not tried again.
  const order = [provider, ...all.filter(p => p !== provider)]
    .filter((p, i, a) => all.includes(p) && a.indexOf(p) === i && !skip.includes(p));
  if (!order.length) throw new Error('every aggregator for ' + engine + ' has already been tried');

  const tried = [];
  let last = null;
  for (let i = 0; i < order.length; i++) {
    const p = order[i];
    tried.push(p);
    try {
      const sub = await submitImage({ ...opts, provider: p });
      if (i > 0) console.log('[img-providers] fell back to', p, 'after', tried.slice(0, -1).join(', '));
      return { ...sub, tried };
    } catch (e) {
      last = e;
      const why = reasonOf(e);
      console.warn('[img-providers]', engine, '@' + p, 'failed:', String(why).slice(0, 160));
      const next = order[i + 1] || null;
      if (onAttempt) {
        try { await onAttempt({ provider: p, error: why, next, label: PROVIDER_LABELS[p], nextLabel: next ? PROVIDER_LABELS[next] : '' }); }
        catch (x) {}
      }
    }
  }
  throw last || new Error('no aggregator could take it');
}

module.exports = {
  ENGINES, PROVIDER_LABELS, PROVIDER_ORDER, providersFor, listEngines, matrix,
  submitImage, submitWithFallback, reasonOf,
  // Exported for the poll-time half of the cascade: Replicate accepts a job and only discovers it
  // cannot read the reference a minute later, so the rehost has to be reachable from there too.
  rehost: _rehost,
  isFetchFailure,   // exported so the rule can be checked against a real error rather than guessed at
};
