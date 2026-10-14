'use strict';

// ════════════════════════════════════════════════════════════════════════════
// THE AGENTS' LADDER (phase V25, the owner 2026-10-13: "лестница зрения, модели генератора сценариев и писатели должны
// быть одной лестницей ... нужно оставить те модели для лестниц, которые поддерживают изображения на вход").
//
// ONE ordered list of (aggregator, model) steps, tried in turn until one answers, for every agent of the app that
// reads words and pictures and answers within a minute or two:
//   - the chats' writers (lib/mv3-agent.js): the pictures chat's analyst, the video chat's prompts, Kling's first
//     frame, the translations into English (a prompt, a script's lines), the frames chat (the light pass, a frame's prompt, `ideas`),
//     the 3D Studio's description of a place;
//   - every caller of callAIVisionWithFallback (lib/helpers.js): New Character's reading and the sheet's framing, the
//     looks, lookbooks and environments, and the talking head's agents - the mood markup, the frames plan, the
//     animation prompts, reading the look and the place, how a place moves.
// It used to be two ladders - the writers' (behind the pictures chat's gear) and the vision ladder (settings.json
// `cv2Ladders.vision`, no editor since H8) - with two transports that had drifted apart: the writers handed Replicate
// links under `images` for every model, the vision ladder inlined the bytes and named the field per model family.
// The vision ladder's way won.
//
// NOT ON IT, on purpose: the scenario generator (lib/llm-json.js). A five-minute script that timed out may have been
// paid for, and asking the next model would pay twice; and a script is written in a narrator's voice by the model
// chosen for it in the form. The 3D Studio's room layout (lib/kie-claude.js) is that studio's own.
//
// Edited on Admin -> AI settings (GET/PUT /api/ai-settings). Kept where the writers' ladder was, data/mv3-settings.json
// (`agents`) - the file keeps its old name so Export and Import need nothing new; one written before this phase keeps
// its `writer.chain` until the first change, which rewrites it with only `agents`.
// ════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const axios = require('axios');

const { DATA_DIR, KIE_BASE } = require('./config');
const { writeFileAtomic } = require('./atomic-write');
const { getSettings } = require('./settings-io');

const FILE = path.join(DATA_DIR, 'mv3-settings.json');

// Five is the cap, and it is about waiting rather than money: a step that times out costs the wait.
const MAX_STEPS = 5;

// Who can be a step, and with which models. EVERY MODEL HERE SEES PICTURES (the owner): each kie and Replicate id
// answered a real photo through this file's own transport before it was listed (V25 check, 2026-10-13, PLAN.md "Фаза
// V25"). Gemini 2.5 Flash went (the owner's answer 9). Two of the vision ladder's kie models did not answer at all, a
// photo or a sentence, and are not here: `gemini-3-flash` ("The channel is not supported") and
// `gemini-3-5-flash-openai` ("Network error, please try again later", every time) - the second was the old vision
// ladder's second step. kie's ids carry -openai because the bare spellings answer "The model is not supported" -
// inside an HTTP 200.
//
// OpenRouter (the owner's answer 11): an aggregator of the ladder, its models those of the same families its own
// public catalogue lists as taking images (checked 2026-10-13, openrouter.ai/api/v1/models) - NOT asked yet, there is
// no key to ask with; `unproven` says so on the page.
const PROVIDERS = [
  {
    id: 'kie', label: 'kie.ai', key: 'kieApiKey', health: 'kie.ai',
    models: [
      { id: 'gemini-3-8-flash-openai', label: 'Gemini 3.8 Flash' },
      { id: 'gemini-3-7-flash-openai', label: 'Gemini 3.7 Flash' },
      { id: 'gemini-3-6-flash-openai', label: 'Gemini 3.6 Flash' },
    ],
  },
  {
    id: 'replicate', label: 'Replicate', key: 'replicateApiKey', health: 'replicate',
    models: [
      { id: 'google/gemini-3.5-flash', label: 'Gemini 3.5 Flash' },
      { id: 'google/gemini-3-flash', label: 'Gemini 3 Flash' },
      { id: 'openai/gpt-5.6-luna', label: 'GPT-5.6 luna' },
    ],
  },
  {
    // (V25, block 4) Claude directly, through Anthropic's own package (lib/claude.js): the owner's own key, the step
    // he chooses; every one of the three sees pictures.
    id: 'anthropic', label: 'Claude (Anthropic)', key: 'anthropicApiKey', health: 'anthropic',
    models: require('./claude').MODELS.map(m => ({ id: m.id, label: m.label })),
  },
  {
    id: 'openrouter', label: 'OpenRouter', key: 'openRouterApiKey', health: 'openrouter', unproven: true,
    models: [
      { id: 'google/gemini-3.8-flash', label: 'Gemini 3.8 Flash' },
      { id: 'google/gemini-3.7-flash', label: 'Gemini 3.7 Flash' },
      { id: 'google/gemini-3.6-flash', label: 'Gemini 3.6 Flash' },
      { id: 'google/gemini-3.5-flash', label: 'Gemini 3.5 Flash' },
      { id: 'openai/gpt-5.6-luna', label: 'GPT-5.6 luna' },
      { id: 'anthropic/claude-opus-5.5', label: 'Claude Opus 5.5' },
      { id: 'anthropic/claude-sonnet-5.5', label: 'Claude Sonnet 5.5' },
      { id: 'anthropic/claude-haiku-5.5', label: 'Claude Haiku 5.5' },
    ],
  },
];

// The writers' ladder as it ran (the owner's answer 8): kie first - cheaper and quicker -, Replicate behind it.
const DEFAULT = [
  { provider: 'kie', model: 'gemini-3-8-flash-openai' },
  { provider: 'replicate', model: 'google/gemini-3.5-flash' },
];

const providerOf = (id) => PROVIDERS.find(p => p.id === id) || null;

// ── The ladder ──────────────────────────────────────────────────────────────
// A step naming a model not on the list is dropped, not mended: the list is what this app has established it can
// reach. Twice the same step is once. Never empty - an empty ladder is every agent of the app silent.
function _fix(list) {
  const seen = new Set();
  const out = [];
  for (const s of (Array.isArray(list) ? list : [])) {
    const p = providerOf(s && s.provider);
    const model = String((s && s.model) || '').trim();
    if (!p || !p.models.some(m => m.id === model)) continue;
    const k = p.id + '|' + model;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ provider: p.id, model });
    if (out.length >= MAX_STEPS) break;
  }
  return out.length ? out : DEFAULT.map(s => Object.assign({}, s));
}

function _stored() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')) || {}; } catch (e) { return {}; }
}

/** The ladder as it runs: the stored one repaired, or the default. */
function ladder() {
  const raw = _stored();
  return _fix(Array.isArray(raw.agents) ? raw.agents : (raw.writer && raw.writer.chain));
}

/** A new order, written whole - the stored thing is an ORDER, and half of one would leave the rest to be guessed. */
function setLadder(list) {
  const agents = _fix(list);
  writeFileAtomic(FILE, JSON.stringify({ agents }, null, 2));
  return agents;
}

// ── Can this aggregator be asked ────────────────────────────────────────────
// '' when it can; otherwise why not, in words. A key is read live (one pasted on Admin counts at once); a refusal is
// the key-health cache's verdict, never a probe here - before the first check nothing is proven, and unknown is not
// down.
function offWhy(providerId) {
  const p = providerOf(providerId);
  if (!p) return 'not an aggregator of this ladder';
  let s = {};
  try { s = getSettings() || {}; } catch (e) { s = {}; }
  if (!String(s[p.key] || '').trim()) return 'no key';
  try {
    const H = require('./keys-health');
    if (H.isDown(p.health)) return 'its key was refused at the last check' + (H.reasonFor(p.health) ? ' (' + H.reasonFor(p.health) + ')' : '');
  } catch (e) { /* no verdict is no refusal */ }
  return '';
}

/** For the page: every aggregator, its models, and whether it can be asked now. */
function state() {
  return {
    ladder: ladder(),
    max: MAX_STEPS,
    providers: PROVIDERS.map(p => ({ id: p.id, label: p.label, unproven: !!p.unproven, off: offWhy(p.id),
                                     models: p.models.map(m => ({ id: m.id, label: m.label })) })),
  };
}

// ── The messages ────────────────────────────────────────────────────────────
// OpenAI-shaped throughout: roles, each with a string or a list of {type:'text'} / {type:'image_url'} parts. Pictures
// handed apart (the writers) ride with the LAST user message, which is the one describing them.
function _withImages(messages, images) {
  const pics = (images || []).filter(Boolean);
  if (!pics.length) return messages;
  const last = messages.map(m => m && m.role).lastIndexOf('user');
  return messages.map((m, i) => {
    if (i !== last) return m;
    const parts = typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : (m.content || []).slice();
    return { role: 'user', content: parts.concat(pics.map(u => ({ type: 'image_url', image_url: { url: u } }))) };
  });
}

const _hasImages = (messages) => messages.some(m => Array.isArray(m && m.content) && m.content.some(p => p && p.type === 'image_url'));

function _text(raw) {
  if (typeof raw === 'string') return raw.trim();
  if (Array.isArray(raw)) return raw.filter(p => p && p.type === 'text').map(p => p.text || '').join('').trim();
  return '';
}

// ── One step ────────────────────────────────────────────────────────────────
// One aggregator, one model, one answer or nothing - never a cascade of its own, which is what a ladder exists to make
// visible.

async function _kie(model, messages, timeout) {
  const key = String(getSettings().kieApiKey || '').trim();
  const r = await axios.post(`${KIE_BASE}/${model}/v1/chat/completions`, { stream: false, messages },
    { headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, timeout });
  // A REFUSAL ARRIVES INSIDE A 200: "The model is not supported" comes back with the envelope saying so and the status
  // saying nothing - read the choices first and a dead model looks exactly like a shy one.
  const env = r.data || {};
  if (env.code != null && Number(env.code) !== 200) throw new Error(env.msg || ('code ' + env.code));
  return _text(((env.choices || [])[0] || {}).message ? env.choices[0].message.content : '');
}

// Replicate has no chat API: one prompt in, one string out, and every model names its fields as it likes - verified
// against the live schemas: google/gemini-* take prompt, images[], system_instruction; openai/* take prompt,
// image_input[], system_prompt. The pictures are INLINED as data URIs rather than passed as links: a link handed to
// Replicate failed with "Connection aborted" on flaky hosts, and the bytes are ours already.
const _REPL_WAIT = 60;

function _replDialect(model) {
  return String(model || '').startsWith('openai/')
    ? { image: 'image_input', system: 'system_prompt' }
    : { image: 'images', system: 'system_instruction' };
}

// http(s) -> fetched and inlined; data: -> as is; an address in the library -> read off disk.
async function _asDataUri(src) {
  const s = String(src || '');
  if (!s || s.startsWith('data:')) return s;
  if (/^https?:\/\//i.test(s)) {
    const r = await axios.get(s, { responseType: 'arraybuffer', timeout: 30000 });
    const mime = String(r.headers['content-type'] || 'image/jpeg').split(';')[0];
    return `data:${mime};base64,${Buffer.from(r.data).toString('base64')}`;
  }
  const abs = require('./helpers').resolveLocalMedia(s);
  if (!abs) throw new Error('image not found: ' + s);
  const ext = (abs.split('.').pop() || 'jpg').toLowerCase();
  const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
  return `data:${mime};base64,${fs.readFileSync(abs).toString('base64')}`;
}

function _flatten(messages) {
  const text = [];
  const system = [];
  const images = [];
  for (const m of messages) {
    const into = m && m.role === 'system' ? system : text;
    const c = m && m.content;
    if (typeof c === 'string') { if (c.trim()) into.push(c); continue; }
    for (const part of (Array.isArray(c) ? c : [])) {
      if (!part) continue;
      if (part.type === 'text' && part.text) into.push(String(part.text));
      else if (part.type === 'image_url' && part.image_url && part.image_url.url) images.push(part.image_url.url);
    }
  }
  return { prompt: text.join('\n\n'), system: system.join('\n\n'), images };
}

async function _replicate(model, messages, timeout) {
  const key = String(getSettings().replicateApiKey || '').trim();
  const { prompt, system, images } = _flatten(messages);
  if (!prompt) throw new Error('nothing to ask');
  const d = _replDialect(model);
  const input = { prompt };
  if (system) input[d.system] = system;
  if (images.length) input[d.image] = await Promise.all(images.map(_asDataUri));
  const r = await axios.post(`https://api.replicate.com/v1/models/${model}/predictions`, { input }, {
    headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json',
               // Blocks until it is done rather than handing back an id to poll - an answer takes seconds.
               Prefer: `wait=${Math.max(5, Math.min(_REPL_WAIT, Math.floor(timeout / 1000)))}` },
    timeout,
  });
  let p = r.data || {};
  const deadline = Date.now() + timeout;
  while ((p.status === 'starting' || p.status === 'processing') && Date.now() < deadline) {
    await new Promise(x => setTimeout(x, 2000));
    p = (await axios.get(`https://api.replicate.com/v1/predictions/${p.id}`,
      { headers: { Authorization: 'Bearer ' + key }, timeout: 20000 })).data || {};
  }
  // A refusal is a finished prediction with an error, not a bad status code.
  if (p.status !== 'succeeded') throw new Error(String(p.error || ('prediction ' + (p.status || 'did not finish'))).slice(0, 300));
  // The output is the STREAM, a list of chunks: joined, not [0].
  return String(Array.isArray(p.output) ? p.output.join('') : (p.output || '')).trim();
}

async function _openrouter(model, messages, timeout) {
  const key = String(getSettings().openRouterApiKey || '').trim();
  const r = await axios.post('https://openrouter.ai/api/v1/chat/completions', { model, messages, stream: false }, {
    headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json',
               'HTTP-Referer': 'https://localhost', 'X-Title': 'UGC Studio' },
    timeout,
  });
  const d = r.data || {};
  if (d.error) throw new Error((d.error && d.error.message) || 'refused');
  return _text(((d.choices || [])[0] || {}).message ? d.choices[0].message.content : '');
}

// Claude: the thinking kept short (effort `low`) - an agent answers in seconds, and a writer's prompt is not a proof.
// A refusal that Anthropic's own fallback did not take is a failed step, and the ladder goes on.
async function _anthropic(model, messages, timeout) {
  const C = require('./claude');
  const m = C.fromOpenAI(messages);
  const r = await C.ask({ model, system: m.system, messages: m.messages, effort: 'low', maxTokens: 16000, timeout });
  return r.text;
}

const TRANSPORT = { kie: _kie, replicate: _replicate, anthropic: _anthropic, openrouter: _openrouter };

/** One step, as it is - for a check of a model; the agents ask through `ask`. */
async function askStep(step, messages, opts) {
  const o = opts || {};
  const msgs = _withImages(messages, o.images);
  const timeout = o.timeout || (_hasImages(msgs) ? 90000 : 45000);
  const go = TRANSPORT[step && step.provider];
  if (!go) throw new Error('no transport for ' + (step && step.provider));
  return go(step.model, msgs, timeout);
}

/**
 * The ladder, in order, until one of them says something: `{ raw, by: {provider, model}, tried }`, or `raw: ''` with
 * what each step said in `tried`. An empty answer counts as a refusal - "" is not a prompt.
 *
 * LOOKING TAKES LONGER THAN READING: 45 s is enough for a sentence and not for two photographs (the first rung timed out
 * at exactly 45 s on a real two-reference message), so a message with pictures waits 90 s unless its caller says.
 */
async function ask(messages, opts) {
  const o = opts || {};
  const msgs = _withImages(Array.isArray(messages) ? messages : [], o.images);
  const timeout = o.timeout || (_hasImages(msgs) ? 90000 : 45000);
  const tried = [];
  for (const step of ladder()) {
    const who = step.provider + '/' + step.model;
    const off = offWhy(step.provider);
    if (off) { tried.push(who + ' - skipped, ' + off); continue; }
    try {
      const raw = await TRANSPORT[step.provider](step.model, msgs, timeout);
      if (raw) {
        if (tried.length) console.log('[agents] fell to', who, 'after', tried.join(' | '));
        return { raw, by: step, tried: tried.concat(who) };
      }
      tried.push(who + ' - answered nothing');
      console.warn('[agents]', who, 'answered nothing');
    } catch (e) {
      const why = String((e.response && e.response.data && ((e.response.data.error && e.response.data.error.message) || e.response.data.msg
        || e.response.data.detail)) || (e.response && e.response.status) || e.message).slice(0, 140);
      tried.push(who + ' - ' + why);
      console.warn('[agents]', who, 'failed:', why);
    }
  }
  return { raw: '', by: null, tried };
}

module.exports = { FILE, MAX_STEPS, PROVIDERS, DEFAULT, ladder, setLadder, offWhy, state, ask, askStep };
