'use strict';

// ════════════════════════════════════════════════════════════════════════════
// MERGE'S OWN PICTURE ENGINES.
//
// Deliberately NOT lib/img-providers.js. That table is the Character page's, and the two pages
// want different things: Character pairs a handful of engines it trusts with a face, and every
// row there earns its place by keeping a person recognisable. Merge wants breadth - whatever
// makes a good frame - and it is the eventual replacement for the Birols tab, which means the
// list here will grow in directions the other one should not follow.
//
// Sharing one table would make every addition here a change to a file the character sheet
// depends on. So this is a second table, and the two are free to disagree. They already do:
// Character lists seedream-4.5 on OpenRouter, and OpenRouter does not route it any more.
//
// WHAT IS SHARED, because it is plumbing and not policy: resolveTask, which understands all
// three aggregators' task ids; the pending pile; the library. Only the choosing lives here.
//
// Shape:
//   ENGINES[id].tiers            the engine's OWN quality words, shown in the panel as they are
//   ENGINES[id].providers[p]     how THAT aggregator is asked, including how the tier is spelt
//   .providers[p].tiers          only when the aggregator cannot do all of them - see qwen-image-2
//   .providers[p].price          dollars per picture, BY TIER. null means nobody has published one
//   .providers[p].submit         from words alone
//   .providers[p].edit           from words and one or more pictures
//   .providers[p].maxRefs        how many pictures that row will take
//
// Every id below was checked against the aggregator itself rather than against documentation:
// Replicate's model endpoint returns the input schema, OpenRouter lists what it routes, and kie
// was asked to make a picture. What could not be confirmed is not here: an engine an aggregator
// cannot really serve is worse than one it does not offer, because the first kind fails after
// the wait.
//
// ── The edit half ───────────────────────────────────────────────────────────
// kie names its edit models inconsistently - `-image-to-image` for the new ones, `-edit` for
// seedream 4.5, `qwen2/image-edit` for that one - and its refusals do not say which field is
// missing. The ids were found by asking: one that does not exist answers 422, one that does
// answers 500 for a missing field.
//
// THE FIELD NAMES ARE A HARDER PROBLEM THAN THEY LOOK, and getting them wrong cost a day of
// generations that ignored their references. kie accepts a body carrying a field it has never
// heard of: no error, a picture comes back, and the reference was never read. So "the task was
// accepted" is not evidence of anything.
//
// What IS evidence divides in two:
//   * a model that only edits REFUSES with no picture ("This field is required"), so a wrong
//     name leaves it still missing and is refused too - acceptance then means the name is right.
//     Seven of the ten are like this;
//   * a model that does both directions under one id accepts anything, and the only proof is
//     LOOKING at the result. nano-banana-2, its lite, and gpt-image-2 are like this, and all
//     three were checked by eye against a reference with an unmistakable subject.
//
// The field names that came back are worth stating, because no two families agree:
//   kie         image_urls (a list) for the seedream three, grok and the two qwen-3s;
//               image_url (one string) for qwen2/image-edit;
//               image_input for nano-banana-2, input_urls for gpt-image-2 - the two that were
//               wrong until a picture proved them
//   Replicate   image_input for Google and ByteDance, input_images for OpenAI,
//               image (one string) for qwen and grok
//   OpenRouter  input_references
//
// maxRefs belongs to the PAIRING and not to the engine, which the same probe proved: grok-imagine
// takes three pictures through kie and exactly one through Replicate, because Replicate's row for
// it holds a single string.
// ════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const axios = require('axios');

const { TEMP_DIR } = require('./config');
const { getSettings } = require('./settings-io');
// The plain Replicate submitter - one model, one input, one prediction id. It exists for exactly
// this: a table that pairs models with aggregators at run time and cannot have a named wrapper
// per row. lib/video-providers.js uses it the same way.
const { createReplicateTask } = require('./helpers');

const KIE_BASE = 'https://api.kie.ai';
const OR_IMAGES = 'https://openrouter.ai/api/v1/images';

// ── What the pictures cost ──────────────────────────────────────────────────
// Dollars per output image, at the engine's own tier. These are LIST prices, read from each
// aggregator on the date below - kie publishes a table in credits and dollars at kie.ai/pricing,
// Replicate carries one per model page, and OpenRouter bills by output token, so its numbers are
// what a real generation actually cost when measured.
//
// ONE PRICE FOR BOTH DIRECTIONS. Editing is charged as the output picture on every aggregator
// here; kie adds a fraction of a cent per input image on two of them - measured against
// OpenRouter, three references moved $0.0672 to $0.0689 - which is below what this shows.
//
// They are shown so a choice can be made with the price in view, and they are the aggregators'
// to change without telling anyone. Treat them as a guide, not as a bill: the panel says "about".
const PRICES_CHECKED = '2026-08-20';

// ── kie.ai: one job envelope for every model ────────────────────────────────
// { model, input } -> taskId, and that taskId is what resolveTask has always polled.
async function _kie(model, input) {
  const key = (getSettings().kieApiKey || '').trim();
  if (!key) throw new Error('kie.ai API key is not configured (Brain -> API keys)');
  const res = await axios.post(KIE_BASE + '/api/v1/jobs/createTask', { model, input }, {
    headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    timeout: 30000,
  });
  const taskId = res.data && res.data.data && res.data.data.taskId;
  if (!taskId) throw new Error('kie.ai returned no taskId: ' + JSON.stringify(res.data).slice(0, 200));
  console.log('[mv3-img] kie', model, '->', taskId);
  return String(taskId);
}

// ── OpenRouter: no job, no taskId - the image is IN the reply ───────────────
// The bytes are parked in temp_files and the caller is handed 'or:<file>', a task that finished
// before it was created. resolveTask claims it from there and deletes it. Disk rather than
// memory: a restart between the answer and the poll would throw away an image already paid for.
const _OR_TTL = 24 * 60 * 60 * 1000;
let _orSeq = 0;

function _sweepOrphans() {
  try {
    const now = Date.now();
    for (const n of fs.readdirSync(TEMP_DIR)) {
      if (!/^mor_\d+_\d+\.jpg$/.test(n)) continue;
      const p = path.join(TEMP_DIR, n);
      if (now - fs.statSync(p).mtimeMs > _OR_TTL) fs.unlinkSync(p);
    }
  } catch (e) {}
}

async function _or(model, body) {
  const key = (getSettings().openRouterApiKey || '').trim();
  if (!key) throw new Error('OpenRouter API key is not configured (Brain -> API keys)');
  const t0 = Date.now();
  const res = await axios.post(OR_IMAGES, Object.assign({ model }, body), {
    headers: {
      Authorization: 'Bearer ' + key, 'Content-Type': 'application/json',
      'HTTP-Referer': 'https://localhost:3000', 'X-Title': 'UGC Merge',
    },
    // This call IS the generation, so it is long - but not unbounded, or a ladder would wait
    // behind a dead socket forever.
    timeout: 240000,
  });
  const d = res.data && res.data.data && res.data.data[0];
  let buf = null;
  if (d && d.b64_json) buf = Buffer.from(d.b64_json, 'base64');
  else if (d && d.url) buf = Buffer.from((await axios.get(d.url, { responseType: 'arraybuffer', timeout: 60000 })).data);
  if (!buf || !buf.length) throw new Error('OpenRouter returned no image: ' + JSON.stringify(res.data).slice(0, 200));

  if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });
  _sweepOrphans();
  const file = 'mor_' + Date.now() + '_' + (++_orSeq) + '.jpg';
  fs.writeFileSync(path.join(TEMP_DIR, file), buf);
  const cost = res.data.usage && res.data.usage.cost;
  console.log('[mv3-img] openrouter', model, ((Date.now() - t0) / 1000).toFixed(1) + 's',
    Math.round(buf.length / 1024) + 'KB', cost != null ? ('$' + cost) : '', '->', file);
  return 'or:' + file;
}

// Google's own upstream refuses by region, so routing to it is a guaranteed 400 here.
const _OR_ROUTE = { ignore: ['google-ai-studio', 'Google AI Studio'] };
// How OpenRouter is handed references.
const _orRefs = (urls) => (urls || []).map(u => ({ type: 'image_url', image_url: { url: u } }));

// ── Aspects: one vocabulary, snapped per provider ───────────────────────────
// Merge speaks eight shapes. No aggregator takes all eight, and they disagree about spelling as
// well as about which exist - so the panel offers one list and each row snaps it to the nearest
// thing its API accepts. Nearest by RATIO rather than by name: asked for 21:9 where only 16:9
// exists, a viewer would rather have the widest thing available than a square.
const ASPECTS = ['9:16', '16:9', '1:1', '4:3', '3:4', '3:2', '2:3', '21:9'];

// The lists each family accepts, named once so rows sharing one cannot drift apart.
const GOOGLE_AR = ['1:1', '1:4', '1:8', '2:3', '3:2', '3:4', '4:1', '4:3', '4:5', '5:4', '8:1', '9:16', '16:9', '21:9'];
const SEEDREAM_AR = ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9'];
const SEEDREAM45_AR = ['1:1', '4:3', '3:4', '4:5', '5:4', '16:9', '9:16', '3:2', '2:3', '21:9', '9:21'];
const QWEN_AR = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '2:1', '1:2'];
const GPT_AR = ['1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16'];

function _ratio(a) {
  const m = String(a || '').match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
  return m ? (+m[1] / +m[2]) : 1;
}

function snap(legal, want) {
  const list = (legal || []).filter(x => /^\d/.test(x));
  if (!list.length) return null;
  if (list.includes(want)) return want;
  const r = _ratio(want);
  let best = list[0];
  for (const c of list) if (Math.abs(_ratio(c) - r) < Math.abs(_ratio(best) - r)) best = c;
  return best;
}

// Pixels for the one engine that has no aspect enum at all. The long side comes from the tier,
// the short from the ratio, and both land on a multiple of 64 because that is the grid these
// models actually work on - asking for 1367 gets 1360 back, and the difference is the model
// quietly correcting you.
function _wh(aspect, long) {
  const r = _ratio(aspect);
  const g = (n) => Math.max(64, Math.min(2048, Math.round(n / 64) * 64));
  return r >= 1 ? [g(long), g(long / r)] : [g(long * r), g(long)];
}

// ── The matrix ──────────────────────────────────────────────────────────────
const ENGINES = {
  'nano-banana-2': {
    label: 'nano-banana-2', tiers: ['1K', '2K', '4K'], def: '2K',
    providers: {
      kie: {
        model: 'nano-banana-2', t2i: true, i2i: true, maxRefs: 3,
        price: { '1K': 0.04, '2K': 0.06, '4K': 0.09 },
        submit: ({ prompt, aspect, quality }) => _kie('nano-banana-2', {
          prompt, aspect_ratio: snap(GOOGLE_AR, aspect),
          resolution: quality, output_format: 'jpg',
        }),
        // image_input, NOT image_urls. This model does both directions under one id, so kie
        // accepts a body with the wrong name, ignores it, and generates from the prompt alone -
        // no error, a picture that looks fine, and nothing to do with the reference. Proved by
        // eye: image_urls returned an unrelated goblin, image_input returned the reference with
        // blue skin.
        edit: ({ prompt, imageUrls, aspect, quality }) => _kie('nano-banana-2', {
          prompt, image_input: imageUrls, aspect_ratio: snap(GOOGLE_AR, aspect),
          resolution: quality, output_format: 'jpg',
        }),
      },
      replicate: {
        model: 'google/nano-banana-2', t2i: true, i2i: true,
        // Published as up to fourteen, which is far past anything attached by hand.
        maxRefs: 14,
        price: { '1K': 0.067, '2K': 0.101, '4K': 0.151 },
        submit: ({ prompt, aspect, quality }) => createReplicateTask('google/nano-banana-2', {
          prompt, aspect_ratio: snap(GOOGLE_AR, aspect),
          resolution: quality, output_format: 'jpg',
        }),
        edit: ({ prompt, imageUrls, aspect, quality }) => createReplicateTask('google/nano-banana-2', {
          prompt, image_input: imageUrls, aspect_ratio: snap(GOOGLE_AR, aspect),
          resolution: quality, output_format: 'jpg',
        }),
      },
      openrouter: {
        model: 'google/gemini-3.1-flash-image', t2i: true, i2i: true, maxRefs: 3,
        // 1K is measured - a real generation billed $0.0672, and the same with three references
        // $0.0689. The other two tiers are Google's list price, because OpenRouter bills by
        // output token and the token count at 2K and 4K has not been measured here.
        price: { '1K': 0.067, '2K': 0.101, '4K': 0.151 }, approx: true,
        submit: ({ prompt, aspect, quality }) => _or('google/gemini-3.1-flash-image', {
          prompt, aspect_ratio: snap(GOOGLE_AR, aspect),
          resolution: quality, output_format: 'jpeg', provider: _OR_ROUTE,
        }),
        edit: ({ prompt, imageUrls, aspect, quality }) => _or('google/gemini-3.1-flash-image', {
          prompt, input_references: _orRefs(imageUrls), aspect_ratio: snap(GOOGLE_AR, aspect),
          resolution: quality, output_format: 'jpeg', provider: _OR_ROUTE,
        }),
      },
    },
  },

  // The lite one has no resolution field at all - one tier, and saying so is better than
  // offering three that do nothing.
  'nano-banana-2-lite': {
    label: 'nano-banana-2-lite', tiers: ['standard'], def: 'standard',
    providers: {
      kie: {
        model: 'nano-banana-2-lite', t2i: true, i2i: true, maxRefs: 10,
        price: { standard: 0.02 },
        submit: ({ prompt, aspect }) => _kie('nano-banana-2-lite', {
          prompt, aspect_ratio: snap(GOOGLE_AR, aspect), output_format: 'jpg',
        }),
        edit: ({ prompt, imageUrls, aspect }) => _kie('nano-banana-2-lite', {
          prompt, image_urls: imageUrls, aspect_ratio: snap(GOOGLE_AR, aspect), output_format: 'jpg',
        }),
      },
      openrouter: {
        model: 'google/gemini-3.1-flash-lite-image', t2i: true, i2i: true, maxRefs: 3,
        price: { standard: 0.0336 },      // measured; three references made it $0.0344
        submit: ({ prompt, aspect }) => _or('google/gemini-3.1-flash-lite-image', {
          prompt, aspect_ratio: snap(GOOGLE_AR, aspect),
          output_format: 'jpeg', provider: _OR_ROUTE,
        }),
        edit: ({ prompt, imageUrls, aspect }) => _or('google/gemini-3.1-flash-lite-image', {
          prompt, input_references: _orRefs(imageUrls), aspect_ratio: snap(GOOGLE_AR, aspect),
          output_format: 'jpeg', provider: _OR_ROUTE,
        }),
      },
    },
  },

  // Replicate ships the pro as a SEPARATE model rather than a setting, so the tier picks the
  // model. kie carries only the plain one, which is why its row says so: offering a `pro` that
  // quietly returns a standard picture would be a setting that lies.
  //
  // ONE REFERENCE, both ways round: kie's edit model takes a single `image_url` and Replicate's
  // takes a single `image`. This is the engine to reach for when there is one picture to change,
  // not several to combine.
  'qwen-image-2': {
    label: 'qwen-image-2', tiers: ['standard', 'pro'], def: 'standard',
    providers: {
      kie: {
        model: 'qwen2/text-to-image', editModel: 'qwen2/image-edit',
        t2i: true, i2i: true, tiers: ['standard'], maxRefs: 1,
        price: { standard: 0.028 },
        submit: ({ prompt, aspect }) => _kie('qwen2/text-to-image', {
          prompt, image_size: snap(QWEN_AR, aspect), output_format: 'jpeg',
        }),
        edit: ({ prompt, imageUrls, aspect }) => _kie('qwen2/image-edit', {
          prompt, image_url: imageUrls[0], image_size: snap(QWEN_AR, aspect), output_format: 'jpeg',
        }),
      },
      replicate: {
        model: 'qwen/qwen-image-2', t2i: true, i2i: true, maxRefs: 1,
        price: { standard: 0.035, pro: 0.075 },
        submit: ({ prompt, aspect, quality }) => createReplicateTask(
          quality === 'pro' ? 'qwen/qwen-image-2-pro' : 'qwen/qwen-image-2',
          { prompt, aspect_ratio: snap(QWEN_AR, aspect) }),
        // match_input_image on purpose: an edit that silently reshapes the picture it was given
        // is an edit nobody asked for.
        edit: ({ prompt, imageUrls, quality }) => createReplicateTask(
          quality === 'pro' ? 'qwen/qwen-image-2-pro' : 'qwen/qwen-image-2',
          { prompt, image: imageUrls[0], match_input_image: true }),
      },
    },
  },

  'qwen-image-3': {
    label: 'qwen-image-3', tiers: ['1K', '2K'], def: '2K',
    providers: {
      kie: {
        model: 'qwen3/text-to-image', editModel: 'qwen3/image-to-image',
        t2i: true, i2i: true, maxRefs: 3,
        price: { '1K': 0.024, '2K': 0.024 },
        submit: ({ prompt, aspect, quality }) => _kie('qwen3/text-to-image', {
          prompt, resolution: quality, image_size: snap(QWEN_AR, aspect), output_format: 'jpeg',
        }),
        edit: ({ prompt, imageUrls, aspect, quality }) => _kie('qwen3/image-to-image', {
          prompt, image_urls: imageUrls, resolution: quality,
          image_size: snap(QWEN_AR, aspect), output_format: 'jpeg',
        }),
      },
    },
  },

  'qwen-image-3-pro': {
    label: 'qwen-image-3-pro', tiers: ['1K', '2K'], def: '2K',
    providers: {
      kie: {
        model: 'qwen3/pro-text-to-image', editModel: 'qwen3/pro-image-to-image',
        t2i: true, i2i: true,
        // Three, by the same field and the same API family as qwen-image-3 above, which was
        // tested at three. This row was only proved at one - if it ever refuses, the ladder
        // has somewhere else to go and this number is the thing to lower.
        maxRefs: 3,
        price: { '1K': 0.032, '2K': 0.06 },
        submit: ({ prompt, aspect, quality }) => _kie('qwen3/pro-text-to-image', {
          prompt, resolution: quality, image_size: snap(QWEN_AR, aspect), output_format: 'jpeg',
        }),
        edit: ({ prompt, imageUrls, aspect, quality }) => _kie('qwen3/pro-image-to-image', {
          prompt, image_urls: imageUrls, resolution: quality,
          image_size: snap(QWEN_AR, aspect), output_format: 'jpeg',
        }),
      },
    },
  },

  // Graded by EFFORT on Replicate and by RESOLUTION on kie - the same three steps wearing
  // different words, which is exactly what a per-provider spelling is for. Worth noticing in
  // the prices: the cheap step is four times cheaper on Replicate, the dear one nearly twice
  // as dear.
  'gpt-image-2': {
    label: 'gpt-image-2', tiers: ['low', 'medium', 'high'], def: 'high',
    providers: {
      kie: {
        model: 'gpt-image-2-text-to-image', editModel: 'gpt-image-2-image-to-image',
        t2i: true, i2i: true, maxRefs: 3,
        price: { low: 0.03, medium: 0.05, high: 0.08 },
        submit: ({ prompt, aspect, quality }) => _kie('gpt-image-2-text-to-image', {
          prompt, aspect_ratio: snap(GPT_AR, aspect),
          resolution: quality === 'low' ? '1K' : quality === 'medium' ? '2K' : '4K',
        }),
        // input_urls, NOT image_urls - and this one takes a picture or not, so a wrong name is
        // accepted and quietly dropped. Proved by eye, like nano-banana-2 above.
        edit: ({ prompt, imageUrls, aspect, quality }) => _kie('gpt-image-2-image-to-image', {
          prompt, input_urls: imageUrls, aspect_ratio: snap(GPT_AR, aspect),
          resolution: quality === 'low' ? '1K' : quality === 'medium' ? '2K' : '4K',
        }),
      },
      replicate: {
        model: 'openai/gpt-image-2', t2i: true, i2i: true, maxRefs: 3,
        price: { low: 0.012, medium: 0.047, high: 0.128 },
        submit: ({ prompt, aspect, quality }) => createReplicateTask('openai/gpt-image-2', {
          prompt, quality, aspect_ratio: snap(GPT_AR, aspect),
          output_format: 'jpeg', output_compression: 92,
        }),
        edit: ({ prompt, imageUrls, aspect, quality }) => createReplicateTask('openai/gpt-image-2', {
          prompt, input_images: imageUrls, quality, aspect_ratio: snap(GPT_AR, aspect),
          output_format: 'jpeg', output_compression: 92,
        }),
      },
    },
  },

  // kie grades this one with a flag rather than a size; Replicate does not grade it at all, so
  // its row carries only the plain tier. What `enable_pro` costs is not published - hence null,
  // which the panel shows as an unknown rather than as free.
  //
  // The two rows differ in what they will take: kie's edit model accepts a list and was proved
  // at three, Replicate's holds one `image` and can never take more.
  'grok-imagine': {
    label: 'grok-imagine', tiers: ['standard', 'pro'], def: 'standard',
    providers: {
      kie: {
        model: 'grok-imagine/text-to-image', editModel: 'grok-imagine/image-to-image',
        t2i: true, i2i: true, maxRefs: 3,
        price: { standard: 0.02, pro: null },
        submit: ({ prompt, aspect, quality }) => _kie('grok-imagine/text-to-image', {
          prompt, aspect_ratio: snap(['2:3', '3:2', '1:1', '16:9', '9:16'], aspect),
          enable_pro: quality === 'pro', nsfw_checker: false,
        }),
        edit: ({ prompt, imageUrls, aspect }) => _kie('grok-imagine/image-to-image', {
          prompt, image_urls: imageUrls,
          aspect_ratio: snap(['2:3', '3:2', '1:1', '16:9', '9:16'], aspect), nsfw_checker: false,
        }),
      },
      replicate: {
        model: 'xai/grok-imagine-image', t2i: true, i2i: true, tiers: ['standard'], maxRefs: 1,
        price: { standard: 0.02 },
        submit: ({ prompt, aspect }) => createReplicateTask('xai/grok-imagine-image', {
          prompt, aspect_ratio: snap(QWEN_AR, aspect),
        }),
        edit: ({ prompt, imageUrls }) => createReplicateTask('xai/grok-imagine-image', {
          prompt, image: imageUrls[0],
        }),
      },
    },
  },

  // The older seedream, kept because it is a different picture and not merely a worse one - and
  // because it is the cheapest of the three at 4K. OpenRouter does not route any seedream at
  // all any more, so this has two aggregators rather than three.
  //
  // kie calls its edit model `-edit` while the newer two use `-image-to-image`. Found by asking
  // rather than by pattern, which is why it is here at all.
  'seedream-4.5': {
    label: 'seedream-4.5', tiers: ['2K', '4K'], def: '2K',
    providers: {
      kie: {
        model: 'seedream/4.5-text-to-image', editModel: 'seedream/4.5-edit',
        t2i: true, i2i: true, maxRefs: 3,
        price: { '2K': 0.0325, '4K': 0.0325 },
        submit: ({ prompt, aspect, quality }) => _kie('seedream/4.5-text-to-image', {
          prompt, aspect_ratio: snap(SEEDREAM45_AR, aspect),
          quality: quality === '4K' ? 'high' : 'basic', output_format: 'jpeg',
        }),
        edit: ({ prompt, imageUrls, aspect, quality }) => _kie('seedream/4.5-edit', {
          prompt, image_urls: imageUrls, aspect_ratio: snap(SEEDREAM45_AR, aspect),
          quality: quality === '4K' ? 'high' : 'basic', output_format: 'jpeg',
        }),
      },
      replicate: {
        model: 'bytedance/seedream-4.5', t2i: true, i2i: true, maxRefs: 3,
        price: { '2K': 0.04, '4K': 0.04 },
        // No output_format on this one - it returns what it returns, and resolveTask stores the
        // bytes under a .jpg name either way.
        submit: ({ prompt, aspect, quality }) => createReplicateTask('bytedance/seedream-4.5', {
          prompt, size: quality, aspect_ratio: snap(SEEDREAM45_AR, aspect),
        }),
        edit: ({ prompt, imageUrls, aspect, quality }) => createReplicateTask('bytedance/seedream-4.5', {
          prompt, image_input: imageUrls, size: quality, aspect_ratio: snap(SEEDREAM45_AR, aspect),
        }),
      },
    },
  },

  'seedream-5-pro': {
    label: 'seedream-5-pro', tiers: ['1K', '2K'], def: '2K',
    providers: {
      kie: {
        model: 'seedream/5-pro-text-to-image', editModel: 'seedream/5-pro-image-to-image',
        t2i: true, i2i: true, maxRefs: 3,
        price: { '1K': 0.035, '2K': 0.07 },
        submit: ({ prompt, aspect, quality }) => _kie('seedream/5-pro-text-to-image', {
          prompt, aspect_ratio: snap(SEEDREAM_AR, aspect),
          quality: quality === '2K' ? 'high' : 'basic', output_format: 'jpeg',
        }),
        edit: ({ prompt, imageUrls, aspect, quality }) => _kie('seedream/5-pro-image-to-image', {
          prompt, image_urls: imageUrls, aspect_ratio: snap(SEEDREAM_AR, aspect),
          quality: quality === '2K' ? 'high' : 'basic', output_format: 'jpeg',
        }),
      },
      replicate: {
        model: 'bytedance/seedream-5-pro', t2i: true, i2i: true, maxRefs: 3,
        price: { '1K': 0.045, '2K': 0.09 },
        submit: ({ prompt, aspect, quality }) => createReplicateTask('bytedance/seedream-5-pro', {
          prompt, size: quality, aspect_ratio: snap(SEEDREAM_AR, aspect), output_format: 'jpeg',
        }),
        edit: ({ prompt, imageUrls, aspect, quality }) => createReplicateTask('bytedance/seedream-5-pro', {
          prompt, image_input: imageUrls, size: quality,
          aspect_ratio: snap(SEEDREAM_AR, aspect), output_format: 'jpeg',
        }),
      },
    },
  },

  'seedream-5-lite': {
    label: 'seedream-5-lite', tiers: ['2K', '3K'], def: '2K',
    providers: {
      // Not listed under a name that could be guessed - the pricing table calls it "seedream 5.0
      // Lite" and the API answers to seedream/5-lite-text-to-image, found by asking. It takes
      // the pro's fields, and it is the cheaper of the two aggregators for this engine.
      kie: {
        model: 'seedream/5-lite-text-to-image', editModel: 'seedream/5-lite-image-to-image',
        t2i: true, i2i: true, maxRefs: 3,
        price: { '2K': 0.0275, '3K': 0.0275 },
        submit: ({ prompt, aspect, quality }) => _kie('seedream/5-lite-text-to-image', {
          prompt, aspect_ratio: snap(SEEDREAM_AR, aspect),
          quality: quality === '3K' ? 'high' : 'basic', output_format: 'jpeg',
        }),
        edit: ({ prompt, imageUrls, aspect, quality }) => _kie('seedream/5-lite-image-to-image', {
          prompt, image_urls: imageUrls, aspect_ratio: snap(SEEDREAM_AR, aspect),
          quality: quality === '3K' ? 'high' : 'basic', output_format: 'jpeg',
        }),
      },
      replicate: {
        model: 'bytedance/seedream-5-lite', t2i: true, i2i: true, maxRefs: 3,
        price: { '2K': 0.035, '3K': 0.035 },
        submit: ({ prompt, aspect, quality }) => createReplicateTask('bytedance/seedream-5-lite', {
          prompt, size: quality, aspect_ratio: snap(SEEDREAM_AR, aspect), output_format: 'jpeg',
        }),
        edit: ({ prompt, imageUrls, aspect, quality }) => createReplicateTask('bytedance/seedream-5-lite', {
          prompt, image_input: imageUrls, size: quality,
          aspect_ratio: snap(SEEDREAM_AR, aspect), output_format: 'jpeg',
        }),
      },
    },
  },

  // NOT the same thing as kie's z-image, which is why that one is not listed as a second
  // provider for this row: turbo is a six-billion-parameter distillation that draws in eight
  // steps, and pairing them would mean a fallback that quietly changes the picture's character.
  // Guidance stays at zero and the steps at eight - that is what distilled means here.
  //
  // The cheapest thing on the list by a long way, and the fastest: eight seconds, measured. And
  // the ONLY one that cannot edit - its schema has no image input at all, so it leaves the list
  // the moment a reference is attached.
  'z-image-turbo': {
    label: 'z-image-turbo', tiers: ['1K', '2K'], def: '1K',
    providers: {
      replicate: {
        model: 'prunaai/z-image-turbo', t2i: true, i2i: false, maxRefs: 0,
        // Billed per output megapixel on a rising scale rather than per picture, so these are
        // worked out from the sizes below rather than quoted.
        price: { '1K': 0.004, '2K': 0.035 }, approx: true,
        submit: ({ prompt, aspect, quality }) => {
          const wh = _wh(aspect, quality === '2K' ? 2048 : 1152);
          return createReplicateTask('prunaai/z-image-turbo', {
            prompt, width: wh[0], height: wh[1],
            num_inference_steps: 8, guidance_scale: 0, go_fast: true,
            output_format: 'jpg', output_quality: 92,
          });
        },
      },
    },
  },
};

const PROVIDER_LABELS = { kie: 'kie.ai', replicate: 'Replicate', openrouter: 'OpenRouter' };
// kie first because that is where this list of models came from, and because it carries the most
// of them. The gear will make this per-engine and editable; until then it is the order a ladder
// walks when nobody has said otherwise.
const PROVIDER_ORDER = ['kie', 'replicate', 'openrouter'];

// What an aggregator can grade this engine by. Usually the engine's own list; a row says
// otherwise only when it genuinely cannot serve one of them.
function tiersOf(engineId, provider) {
  const e = ENGINES[engineId];
  const p = e && e.providers[provider];
  return (p && p.tiers) || (e && e.tiers) || [];
}

function priceOf(engineId, provider, tier) {
  const e = ENGINES[engineId];
  const p = e && e.providers[provider];
  if (!p || !p.price) return null;
  const v = p.price[tier];
  return v == null ? null : v;
}

const maxRefsOf = (engineId, provider) => {
  const e = ENGINES[engineId];
  const p = e && e.providers[provider];
  return (p && p.i2i) ? (p.maxRefs || 1) : 0;
};

/**
 * Who can serve this engine.
 *
 * `tier` narrows it to aggregators that can grade it that way; `refs` to those that will take
 * that many pictures. Both matter and both are per-pairing: kie has no `pro` for qwen-image-2,
 * and grok-imagine takes three references through kie but one through Replicate.
 */
function providersFor(engineId, tier, refs) {
  const e = ENGINES[engineId];
  if (!e) return [];
  const n = +refs || 0;
  const can = PROVIDER_ORDER.filter(p => {
    const row = e.providers[p];
    if (!row) return false;
    if (n > 0 ? !(row.i2i && (row.maxRefs || 1) >= n) : !row.t2i) return false;
    return !tier || tiersOf(engineId, p).includes(tier);
  });
  // WHO CAN is this file's business; WHAT ORDER is the gear's. The stored order is applied on
  // top of what is possible, so an engine that gains an aggregator gains it here without
  // anybody editing a setting, and one that loses it drops out of the stored order silently.
  try { return require('./mv3-settings').ladderFor(engineId, can); }
  catch (e2) { return can; }
}

// The gear's order, applied to any list of providers. Kept here so listEngines and providersFor
// cannot answer differently about the same engine.
function order(engineId, list) {
  try { return require('./mv3-settings').ladderFor(engineId, list); }
  catch (e) { return list; }
}

// The whole matrix, shaped for the panel. Built from the same rows that submit, so the panel
// cannot offer a pairing that fails at submit time - and it carries the prices, so a choice can
// be made with them in view.
//
// ONE LIST rather than one per direction. Which engines are usable depends on how many pictures
// are attached at that moment, and that changes with every attachment - so the panel is given
// the facts and does the narrowing itself, instead of asking again on every click.
function listEngines() {
  const out = [];
  for (const id of Object.keys(ENGINES)) {
    const e = ENGINES[id];
    const providers = Object.keys(e.providers).filter(p => PROVIDER_ORDER.includes(p));
    if (!providers.length) continue;
    out.push({
      id, label: e.label, tiers: e.tiers, def: e.def,
      providers: providersFor(id),
      // Every aggregator that carries this engine at all, whatever the direction - what the
      // gear reorders. providers above is only the ones usable for words alone.
      all: order(id, PROVIDER_ORDER.filter(p => e.providers[p])),
      // IN THE ORDER THEY WILL ACTUALLY BE TRIED, not the table's own. The panel reads these
      // rows for the price, for "served by" and for the line in the waiting bubble - so built
      // in the table's order they told somebody kie.ai while the server was calling Replicate.
      // A window that names a different aggregator from the one being charged is worse than a
      // window that names none.
      rows: order(id, PROVIDER_ORDER.filter(p => e.providers[p])).map(p => ({
        provider: p, label: PROVIDER_LABELS[p], model: e.providers[p].model,
        editModel: e.providers[p].editModel || (e.providers[p].i2i ? e.providers[p].model : ''),
        t2i: !!e.providers[p].t2i, i2i: !!e.providers[p].i2i, maxRefs: maxRefsOf(id, p),
        tiers: tiersOf(id, p), price: e.providers[p].price || null,
        approx: !!e.providers[p].approx,
      })),
    });
  }
  return out;
}

function matrix() {
  // Each engine's own prompting rule travels with it. Required late so this file stays the
  // table of WHAT CAN BE ASKED and lib/mv3-prompt-rules.js stays the table of HOW TO ASK - two
  // different kinds of fact that change for different reasons.
  let rules = {};
  try { rules = require('./mv3-prompt-rules'); } catch (e) {}
  const engines = listEngines().map(e => {
    const r = rules.rulesFor ? rules.rulesFor(e.id) : null;
    return !r ? e : Object.assign({}, e, {
      rule: {
        form: r.form, negatives: r.negatives, sweetSpot: r.sweetSpot,
        formula: r.formula, editFormula: r.editFormula, refFormula: r.refFormula,
        text: r.text, weakness: r.weakness, checklist: r.checklist || [],
        strengths: r.strengths || [], source: r.source || [],
      },
    });
  });
  return {
    providers: PROVIDER_ORDER.map(id => ({ id, label: PROVIDER_LABELS[id] })),
    aspects: ASPECTS,
    engines,
    pricesChecked: PRICES_CHECKED,
  };
}

// What an aggregator actually said, dug out of whichever envelope it used. axios's own message
// ("Request failed with status code 422") tells nobody anything.
function reasonOf(e) {
  const d = (e && e.response && e.response.data) || null;
  return (d && (d.detail || d.msg || d.message || (d.error && d.error.message)))
      || (e && e.message) || 'unknown error';
}

// ── One pairing, one try ────────────────────────────────────────────────────
// Returns a taskId resolveTask understands, whichever aggregator served it: a bare id from
// kie.ai, 'repl:<id>' from Replicate, 'or:<file>' from OpenRouter.
//
// It repairs rather than refuses. A remembered pairing can name an aggregator that no longer
// carries the engine, a tier that one carries and another does not, or one that will not take
// as many references as were attached - and stranding the panel on it would be worse than
// substituting and saying so in the log. What it will NOT do is silently change the ENGINE -
// that is the caller's decision.
async function submitImage(opts) {
  const engine = opts.engine;
  const e = ENGINES[engine];
  if (!e) throw new Error('unknown engine: ' + engine);
  const urls = (Array.isArray(opts.imageUrls) ? opts.imageUrls : (opts.imageUrls ? [opts.imageUrls] : []))
    .filter(Boolean);

  let q = e.tiers.includes(opts.quality) ? opts.quality : e.def;
  // Prefer keeping the tier: if the asked-for aggregator cannot grade this way but another can,
  // the other one gets it. Only when nobody can is the tier itself given up.
  let usable = providersFor(engine, q, urls.length);
  if (!usable.length) {
    usable = providersFor(engine, null, urls.length);
    if (!usable.length) {
      throw new Error(urls.length
        ? e.label + ' cannot take ' + urls.length + ' reference' + (urls.length > 1 ? 's' : '')
        : e.label + ' has no aggregator');
    }
    const was = q;
    q = tiersOf(engine, usable[0])[0];
    console.warn('[mv3-img] no aggregator does', engine, 'at', was, '- using', q);
  }
  const p = usable.includes(opts.provider) ? opts.provider : usable[0];
  if (opts.provider && p !== opts.provider) {
    console.warn('[mv3-img]', opts.provider, 'cannot do', engine, 'at', q, '- using', p);
  }
  if (!tiersOf(engine, p).includes(q)) q = tiersOf(engine, p)[0];
  const a = ASPECTS.includes(opts.aspect) ? opts.aspect : '9:16';

  const row = e.providers[p];
  const args = { prompt: String(opts.prompt || '').trim(), aspect: a, quality: q, imageUrls: urls };
  const taskId = urls.length ? await row.edit(args) : await row.submit(args);
  if (!taskId) throw new Error(PROVIDER_LABELS[p] + ' returned no taskId');
  return {
    taskId, provider: p, engine, quality: q, aspect: a, refs: urls.length,
    model: (urls.length && row.editModel) || row.model, price: priceOf(engine, p, q),
  };
}

// ── The cascade ─────────────────────────────────────────────────────────────
// The same engine through every aggregator that carries it, starting with the one asked for. An
// error is only worth showing once there is nowhere left to try. onAttempt fires after each
// failure with what went wrong and who is next, so the panel can say "kie could not - trying
// Replicate" instead of going quiet.
async function submitWithFallback(opts) {
  const engine = opts.engine;
  const skip = opts.skip || [];
  const e = ENGINES[engine];
  if (!e) throw new Error('unknown engine: ' + engine);
  const urls = (Array.isArray(opts.imageUrls) ? opts.imageUrls : (opts.imageUrls ? [opts.imageUrls] : []))
    .filter(Boolean);
  const q = e.tiers.includes(opts.quality) ? opts.quality : e.def;
  // The ladder walks only aggregators that can honour the tier AND take the references, falling
  // back to whoever can take the references when none can do both - the same rule submitImage
  // applies, applied once here so the order is right.
  const all = providersFor(engine, q, urls.length).length
    ? providersFor(engine, q, urls.length)
    : providersFor(engine, null, urls.length);
  if (!all.length) {
    throw new Error(urls.length
      ? e.label + ' cannot take ' + urls.length + ' reference' + (urls.length > 1 ? 's' : '')
      : e.label + ' has no aggregator');
  }

  const order = [opts.provider].concat(all.filter(p => p !== opts.provider))
    .filter((p, i, a) => all.includes(p) && a.indexOf(p) === i && skip.indexOf(p) < 0);
  if (!order.length) throw new Error('every aggregator for ' + engine + ' has already been tried');

  const tried = [];
  let last = null;
  for (let i = 0; i < order.length; i++) {
    const p = order[i];
    tried.push(p);
    try {
      const sub = await submitImage(Object.assign({}, opts, { provider: p }));
      if (i > 0) console.log('[mv3-img] fell back to', p, 'after', tried.slice(0, -1).join(', '));
      return Object.assign({}, sub, { tried });
    } catch (err) {
      last = err;
      const why = reasonOf(err);
      console.warn('[mv3-img]', engine, '@' + p, 'failed:', String(why).slice(0, 160));
      const next = order[i + 1] || null;
      if (opts.onAttempt) {
        try {
          await opts.onAttempt({
            provider: p, error: why, next, label: PROVIDER_LABELS[p],
            nextLabel: next ? PROVIDER_LABELS[next] : '',
          });
        } catch (x) {}
      }
    }
  }
  throw last || new Error('no aggregator could take it');
}

module.exports = {
  ENGINES, PROVIDER_LABELS, PROVIDER_ORDER, ASPECTS, PRICES_CHECKED,
  providersFor, tiersOf, priceOf, maxRefsOf, listEngines, matrix,
  submitImage, submitWithFallback, reasonOf, snap,
};
