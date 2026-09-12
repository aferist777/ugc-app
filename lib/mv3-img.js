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
// depends on. So this is a second table, and the two are free to disagree. They already do.
//
// WHAT IS SHARED, because it is plumbing and not policy: resolveTask, which understands both
// aggregators' task ids; the pending pile; the library. Only the choosing lives here.
//
// TWO AGGREGATORS, kie.ai and Replicate, and the panel names one outright rather than walking a
// stored order. OpenRouter was a third; it routed two of these models, has no key on the server,
// and is gone.
//
// Shape:
//   ENGINES[id].tiers            the engine's OWN quality words, shown in the panel as they are
//   ENGINES[id].providers[p]     how THAT aggregator is asked, including how the tier is spelt
//   .providers[p].tiers          only when the two aggregators grade it differently - see the gpt row
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
// kie names its edit models inconsistently - `-image-to-image` for the gpt family, `-edit` for
// seedream 4.5, `image-edit` for grok - and its refusals do not say which field is missing. The ids were found by asking: one that does not exist answers 422, one that does
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
//     seedream 4.5 and grok-imagine-image-2 are like this;
//   * a model that does both directions under one id accepts anything, and the only proof is
//     LOOKING at the result. nano-banana-2, its lite and gpt-image-2.5-sunburst are like this.
//
// The field names that came back are worth stating, because no two families agree:
//   kie         image_urls (a list) for seedream and grok-imagine-image-2;
//               image_input for nano-banana-2, input_urls for the gpt family - the two that
//               were wrong until a picture proved them
//   Replicate   image_input for Google and ByteDance, input_images for OpenAI,
//               image (one string) for grok
//
// maxRefs belongs to the PAIRING and not to the engine, which the same probe proved: grok-imagine
// takes three pictures through kie and exactly one through Replicate, because Replicate's row for
// it holds a single string.
// ════════════════════════════════════════════════════════════════════════════

const axios = require('axios');

const { getSettings } = require('./settings-io');
// The plain Replicate submitter - one model, one input, one prediction id. It exists for exactly
// this: a table that pairs models with aggregators at run time and cannot have a named wrapper
// per row. lib/video-providers.js uses it the same way.
const { createReplicateTask } = require('./helpers');

const KIE_BASE = 'https://api.kie.ai';

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
// SIX MODELS, TWO AGGREGATORS. Both halves of every row were proved against the aggregator
// itself rather than against its documentation (2026-09-13):
//
//   kie        every id was asked for a task with an empty body. One that does not exist
//              answers 422 "The model is empty"; all ten of these answered 500 "This field is
//              required", which is the model complaining about the INPUT and therefore proof
//              that it is there. grok-imagine-image-2-0 was taken further, because it refuses
//              until its picture field is named: `image_urls` is the name it accepts.
//   Replicate  every row's input schema was read back from /v1/models/<id>. That is where the
//              tier words below come from, and the safety fields: Replicate VALIDATES its
//              input, so a field that is not in the schema is a 422 and no picture. Only two
//              of the six have one at all.
//
// HOW MANY REFERENCES EACH ROW TAKES, from the source rather than from a guess: kie's own
// playground form counts them out loud ("Add more files (1/14)") - 16 for the gpt model, 14 for
// nano-banana-2 and seedream 4.5, 10 for the lite, 5 for grok's image-edit; and Replicate's
// schemas say it in the field itself - "supports up to 14 images" for the Google pair,
// "List of 1-14" for seedream, a single `image` string for grok, which is one.
// The window offers at most five of them whatever the row allows; the row's own number is what
// decides when it is SMALLER than five.
//
// TURNING MODERATION OFF, engine by engine, because there is no single spelling for it:
//   Replicate  bytedance/seedream-4.5         disable_safety_checker: true
//              openai/gpt-image-2.5-sunburst  moderation: 'low'  (the schema allows auto|low)
//              the other four have no such field, and inventing one would refuse the job
//   kie        nsfw_checker: false on the families that read it - grok and seedream. kie
//              accepts a body carrying a field it has never heard of (no error, a picture, the
//              field ignored), so writing it on every row would only look like it did something
const ENGINES = {
  // Graded by RESOLUTION on kie and by EFFORT on Replicate - the same model wearing two sets of
  // words, which is exactly what a per-provider tier list is for. The engine carries the union;
  // providers[].tiers is what is actually offered once an aggregator is chosen.
  'gpt-image-2.5-sunburst': {
    label: 'gpt-image-2.5-sunburst',
    tiers: ['1K', '2K', '4K', 'low', 'medium', 'high', 'xhigh', 'max', 'auto'], def: '2K',
    providers: {
      kie: {
        model: 'gpt-image-2-5-sunburst-text-to-image',
        editModel: 'gpt-image-2-5-sunburst-image-to-image',
        t2i: true, i2i: true, maxRefs: 16, tiers: ['1K', '2K', '4K'],
        price: { '1K': 0.03, '2K': 0.05, '4K': 0.08 },
        submit: ({ prompt, aspect, quality }) => _kie('gpt-image-2-5-sunburst-text-to-image', {
          prompt, aspect_ratio: snap(GPT_AR, aspect), resolution: quality,
        }),
        // input_urls, inherited from gpt-image-2 - the same family and the same spelling. It is
        // also the same trap: this model takes a picture or does not, so a wrong name is
        // accepted and quietly dropped rather than refused. The first real edit is worth
        // looking at, because nothing else will say.
        edit: ({ prompt, imageUrls, aspect, quality }) => _kie('gpt-image-2-5-sunburst-image-to-image', {
          prompt, input_urls: imageUrls, aspect_ratio: snap(GPT_AR, aspect), resolution: quality,
        }),
      },
      replicate: {
        model: 'openai/gpt-image-2.5-sunburst', t2i: true, i2i: true, maxRefs: 16,
        tiers: ['low', 'medium', 'high', 'xhigh', 'max', 'auto'],
        // `auto` is not a discount: it lands wherever the model decides, and what it costs is
        // the top of the range. Priced as quoted rather than as hoped.
        price: { low: 0.012, medium: 0.047, high: 0.128, xhigh: 0.25, max: 0.50, auto: 0.25 },
        submit: ({ prompt, aspect, quality }) => createReplicateTask('openai/gpt-image-2.5-sunburst', {
          prompt, quality, moderation: 'low', aspect_ratio: snap(GPT_AR, aspect),
          output_format: 'jpeg', output_compression: 92,
        }),
        edit: ({ prompt, imageUrls, aspect, quality }) => createReplicateTask('openai/gpt-image-2.5-sunburst', {
          prompt, input_images: imageUrls, quality, moderation: 'low',
          aspect_ratio: snap(GPT_AR, aspect), output_format: 'jpeg', output_compression: 92,
        }),
      },
    },
  },

  // One grade and one price, both ways round. kie's edit half is `image-edit` rather than the
  // `-image-to-image` the rest of its catalogue uses, and it takes a LIST; Replicate's row holds
  // a single `image` and can never take more than one.
  'grok-imagine-image-2': {
    label: 'grok-imagine-image-2', tiers: ['standard'], def: 'standard',
    providers: {
      kie: {
        model: 'grok-imagine-image-2-0/text-to-image',
        editModel: 'grok-imagine-image-2-0/image-edit',
        t2i: true, i2i: true, maxRefs: 5,
        price: { standard: 0.02 },
        // aspect_ratio is REQUIRED here rather than optional: a prompt on its own is refused.
        submit: ({ prompt, aspect }) => _kie('grok-imagine-image-2-0/text-to-image', {
          prompt, aspect_ratio: snap(QWEN_AR, aspect), nsfw_checker: false,
        }),
        edit: ({ prompt, imageUrls, aspect }) => _kie('grok-imagine-image-2-0/image-edit', {
          prompt, image_urls: imageUrls, aspect_ratio: snap(QWEN_AR, aspect), nsfw_checker: false,
        }),
      },
      replicate: {
        model: 'xai/grok-imagine-image', t2i: true, i2i: true, maxRefs: 1,
        price: { standard: 0.02 },
        submit: ({ prompt, aspect }) => createReplicateTask('xai/grok-imagine-image', {
          prompt, aspect_ratio: snap(QWEN_AR, aspect),
        }),
        edit: ({ prompt, imageUrls, aspect }) => createReplicateTask('xai/grok-imagine-image', {
          prompt, image: imageUrls[0], aspect_ratio: snap(QWEN_AR, aspect),
        }),
      },
    },
  },

  'nano-banana-2': {
    label: 'nano-banana-2', tiers: ['1K', '2K', '4K'], def: '2K',
    providers: {
      kie: {
        model: 'nano-banana-2', t2i: true, i2i: true, maxRefs: 14,
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
    },
  },

  // No resolution field on either side - one tier, and saying so is better than offering three
  // that do nothing.
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
      replicate: {
        model: 'google/nano-banana-2-lite', t2i: true, i2i: true, maxRefs: 14,
        price: { standard: 0.034 },
        submit: ({ prompt, aspect }) => createReplicateTask('google/nano-banana-2-lite', {
          prompt, aspect_ratio: snap(GOOGLE_AR, aspect), output_format: 'jpg',
        }),
        edit: ({ prompt, imageUrls, aspect }) => createReplicateTask('google/nano-banana-2-lite', {
          prompt, image_input: imageUrls, aspect_ratio: snap(GOOGLE_AR, aspect), output_format: 'jpg',
        }),
      },
    },
  },

  // kie calls its edit model `-edit` while the rest of its catalogue uses `-image-to-image`.
  // Found by asking rather than by pattern, which is why it is worth saying.
  'seedream-4.5': {
    label: 'seedream-4.5', tiers: ['2K', '4K'], def: '2K',
    providers: {
      kie: {
        model: 'seedream/4.5-text-to-image', editModel: 'seedream/4.5-edit',
        t2i: true, i2i: true, maxRefs: 14,
        price: { '2K': 0.0325, '4K': 0.0325 },
        submit: ({ prompt, aspect, quality }) => _kie('seedream/4.5-text-to-image', {
          prompt, aspect_ratio: snap(SEEDREAM45_AR, aspect),
          quality: quality === '4K' ? 'high' : 'basic', output_format: 'jpeg', nsfw_checker: false,
        }),
        edit: ({ prompt, imageUrls, aspect, quality }) => _kie('seedream/4.5-edit', {
          prompt, image_urls: imageUrls, aspect_ratio: snap(SEEDREAM45_AR, aspect),
          quality: quality === '4K' ? 'high' : 'basic', output_format: 'jpeg', nsfw_checker: false,
        }),
      },
      replicate: {
        model: 'bytedance/seedream-4.5', t2i: true, i2i: true, maxRefs: 14,
        price: { '2K': 0.04, '4K': 0.04 },
        // No output_format on this one - it returns what it returns, and resolveTask stores the
        // bytes under a .jpg name either way.
        submit: ({ prompt, aspect, quality }) => createReplicateTask('bytedance/seedream-4.5', {
          prompt, size: quality, aspect_ratio: snap(SEEDREAM45_AR, aspect),
          disable_safety_checker: true,
        }),
        edit: ({ prompt, imageUrls, aspect, quality }) => createReplicateTask('bytedance/seedream-4.5', {
          prompt, image_input: imageUrls, size: quality, aspect_ratio: snap(SEEDREAM45_AR, aspect),
          disable_safety_checker: true,
        }),
      },
    },
  },
};

const PROVIDER_LABELS = { kie: 'kie.ai', replicate: 'Replicate' };
// TWO, and OpenRouter is not one of them. It routed two of these models and nothing else, there
// is no key for it on the server, and the panel now names the aggregator outright rather than
// walking a stored order - so a third that nobody chose was only a way for a picture to come
// from somewhere unexpected. kie first because it carries every model on the list.
const PROVIDER_ORDER = ['kie', 'replicate'];

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
 * that many pictures. Both matter and both are per-pairing: kie grades the gpt model by
 * resolution and Replicate by effort, and grok takes five references through kie but one
 * through Replicate.
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
  // PROVIDER_ORDER, and nothing on top of it. There used to be a stored per-engine order edited
  // behind the gear; the panel names the aggregator outright now, so the only thing left for an
  // order to decide is who catches a refusal - and "the other one" needs no setting.
  return can;
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
      // Every aggregator that carries this engine at all, whatever the direction. `providers`
      // above is only the ones usable for words alone.
      all: PROVIDER_ORDER.filter(p => e.providers[p]),
      // One row per aggregator that carries this engine: the panel reads them for the tiers it
      // may offer, for the price of the pairing that was chosen, and for the line in the waiting
      // bubble. A window that names a different aggregator from the one being charged is worse
      // than a window that names none.
      rows: PROVIDER_ORDER.filter(p => e.providers[p]).map(p => ({
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
