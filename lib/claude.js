'use strict';

// ════════════════════════════════════════════════════════════════════════════
// CLAUDE, DIRECT - for a person who wants the writers to use Anthropic's own API with their own key.
//
// Anthropic's own API through its official package (@anthropic-ai/sdk, pinned), with the key from Admin -> API keys
// (`anthropicApiKey`, read at every call - a key pasted there counts at once). Its work is a step of the agents' ladder
// (lib/agents.js) - which writes the scenario generator's scripts too (lib/llm-json.js callLadder) and answers in the
// assistant's chat as it writes (`stream`); besides, the key-health check asks `probe` (lib/keys-health.js). The 3D Studio's Claude is not this one - it goes through kie
// (lib/kie-claude.js).
//
// What every call does:
//   - EFFORT is the only control of the thinking: Opus 5.5 always thinks and refuses a `thinking` field that turns it
//     off, Sonnet and Haiku 5.5 think adaptively - so no `thinking` is sent, only `output_config.effort`;
//   - Opus 5.5 and Sonnet 5.5 carry Anthropic's SERVER-SIDE FALLBACK (`fallbacks: "default"`, the beta
//     FALLBACK_BETA): a request their safety classifiers decline is answered, in the same call, by
//     the model Anthropic recommends for that kind of refusal. Haiku 5.5 has none (the parameter would only fail);
//   - a refusal that still stands is `stop_reason: "refusal"` - thrown as one (`refused: true`), never read as text;
//   - NO RETRIES inside the package (maxRetries 0): for an agent the ladder is the retry, and a script is never asked
//     twice (a long one that died may have been paid for).
// ════════════════════════════════════════════════════════════════════════════

const AnthropicSDK = require('@anthropic-ai/sdk');
const { getSettings } = require('./settings-io');
const I18N = require('./i18n');

const Anthropic = AnthropicSDK.default || AnthropicSDK;

// A refusal standing at the end, in the interface's language: the model's name and its category (Anthropic's word).
const _declined = (info, cat) => (cat ? I18N.t('{model} declined this ({category})', { model: info.label, category: cat })
  : I18N.t('{model} declined this', { model: info.label }));

// The three offered; Fable 5.1 is not - two and a half times Opus and slower.
const MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', fallback: true },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', fallback: true },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', fallback: false },
];
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

const key = () => {
  let s = {};
  try { s = getSettings() || {}; } catch (e) { s = {}; }
  return String(s.anthropicApiKey || '').trim();
};

const client = (apiKey) => new Anthropic({ apiKey: apiKey || key(), maxRetries: 0 });

// A picture by its address, or - from a data: URI - by its bytes.
function _image(url) {
  const m = /^data:([^;,]+);base64,([\s\S]*)$/.exec(String(url || ''));
  if (m) return { type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } };
  return { type: 'image', source: { type: 'url', url: String(url) } };
}

/**
 * The app's own messages (OpenAI-shaped: roles, a string or {type:'text'} / {type:'image_url'} parts) as Anthropic's:
 * the system text apart, each turn's pictures before its words (Anthropic reads a picture best ahead of what is asked
 * about it).
 */
function fromOpenAI(messages) {
  const system = [];
  const out = [];
  for (const m of (Array.isArray(messages) ? messages : [])) {
    if (!m) continue;
    const parts = typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : (Array.isArray(m.content) ? m.content : []);
    if (m.role === 'system') {
      for (const p of parts) if (p && p.type === 'text' && p.text) system.push(String(p.text));
      continue;
    }
    const pics = [];
    const words = [];
    for (const p of parts) {
      if (!p) continue;
      if (p.type === 'text' && String(p.text || '').trim()) words.push({ type: 'text', text: String(p.text) });
      else if (p.type === 'image_url' && p.image_url && p.image_url.url) pics.push(_image(p.image_url.url));
    }
    if (pics.length || words.length) out.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: pics.concat(words) });
  }
  return { system: system.join('\n\n'), messages: out };
}

/**
 * One call. `{ model, system, messages (Anthropic's), effort, maxTokens, timeout, signal, stream }` ->
 * `{ text, cut, model }` - `cut` when the answer stopped at its token ceiling, `model` the one that answered (another
 * one when the fallback took it). A refusal throws with `refused: true` and the category.
 */
async function ask(o) {
  const info = MODELS.find(m => m.id === o.model);
  if (!info) throw new Error(I18N.t('not a Claude model of this app: {model}', { model: o.model }));
  const apiKey = key();
  if (!apiKey) throw new Error(I18N.t('no Claude key - add it on Admin -> API keys'));
  const params = { model: info.id, max_tokens: o.maxTokens || 16000, messages: o.messages };
  if (o.system) params.system = o.system;
  if (o.effort) params.output_config = { effort: o.effort };
  if (info.fallback) { params.betas = [FALLBACK_BETA]; params.fallbacks = 'default'; }
  const opts = {};
  if (o.timeout) opts.timeout = o.timeout;
  if (o.signal) opts.signal = o.signal;
  const c = client(apiKey);
  const api = info.fallback ? c.beta.messages : c.messages;
  // A long answer is STREAMED: an open request of minutes is one a proxy may drop, and the package refuses a large
  // ceiling without a stream.
  const msg = o.stream ? await api.stream(params, opts).finalMessage() : await api.create(params, opts);
  if (msg.stop_reason === 'refusal') {
    const cat = msg.stop_details && msg.stop_details.category;
    throw Object.assign(new Error(_declined(info, cat)), { refused: true, category: cat || '' });
  }
  const text = (msg.content || []).filter(b => b && b.type === 'text').map(b => b.text || '').join('').trim();
  return { text, cut: msg.stop_reason === 'max_tokens', model: msg.model || info.id };
}

// Anthropic's own prices, dollars per million tokens: input, output, a cache read, a cache write (five minutes).
const PRICES = {
  'claude-opus-5-5': { in: 4, out: 20, read: 0.2, write: 5 },
  'claude-sonnet-5-5': { in: 2, out: 10, read: 0.2, write: 2.5 },
  'claude-haiku-5-5': { in: 0.1, out: 0.5, read: 0.01, write: 0.125 },
};

/** What one answer cost in dollars by its usage and the model that wrote it - 0 for a model with no price here. */
function costOf(model, usage) {
  const p = PRICES[model];
  const u = usage || {};
  if (!p) return 0;
  return ((+u.input_tokens || 0) * p.in + (+u.output_tokens || 0) * p.out
    + (+u.cache_read_input_tokens || 0) * p.read + (+u.cache_creation_input_tokens || 0) * p.write) / 1e6;
}

/**
 * One answer WRITTEN AS IT COMES - the assistant's chat. `o` as ask's, `onText(piece)` told each piece of the text.
 * The whole conversation is cached (`cache_control` on the request: the last block is the mark), so the next turn reads
 * the history at a tenth of its price; a prefix under the model's least is simply not cached.
 * -> { text, cut, model, usage, usd }. A refusal still standing at the end throws `refused`, with what was written in
 * `text` on the error.
 */
async function stream(o, onText) {
  const info = MODELS.find(m => m.id === o.model);
  if (!info) throw new Error(I18N.t('not a Claude model of this app: {model}', { model: o.model }));
  const apiKey = key();
  if (!apiKey) throw new Error(I18N.t('no Claude key - add it on Admin -> API keys'));
  const params = { model: info.id, max_tokens: o.maxTokens || 16000, messages: o.messages, cache_control: { type: 'ephemeral' } };
  if (o.system) params.system = o.system;
  if (o.effort) params.output_config = { effort: o.effort };
  if (info.fallback) { params.betas = [FALLBACK_BETA]; params.fallbacks = 'default'; }
  const opts = {};
  if (o.timeout) opts.timeout = o.timeout;
  if (o.signal) opts.signal = o.signal;
  const c = client(apiKey);
  const api = info.fallback ? c.beta.messages : c.messages;
  let text = '';
  const st = api.stream(params, opts);
  st.on('text', (t) => { if (!t) return; text += t; if (onText) onText(t); });
  const msg = await st.finalMessage();
  const usage = msg.usage || {};
  const usd = costOf(msg.model || info.id, usage);
  if (msg.stop_reason === 'refusal') {
    const cat = msg.stop_details && msg.stop_details.category;
    throw Object.assign(new Error(_declined(info, cat)), { refused: true, category: cat || '', text, usage, usd });
  }
  return { text, cut: msg.stop_reason === 'max_tokens', model: msg.model || info.id, usage, usd };
}

/** The free check of a key (the models list) - for lib/keys-health.js. The words on success; throws as axios would. */
async function probe(apiKey) {
  try {
    const page = await client(apiKey).models.list({ limit: 20 });
    const ids = ((page && page.data) || []).map(m => m.id);
    const ours = MODELS.filter(m => ids.includes(m.id)).length;
    return ids.length ? (ours === MODELS.length ? I18N.t('Opus, Sonnet and Haiku 5.5 open') : I18N.t('{n} of the three models open', { n: ours })) : I18N.t('active');
  } catch (e) {
    // Shaped like an axios error, so the health check words it the way it words every other provider.
    if (e && e.status) throw Object.assign(new Error(e.message), { response: { status: e.status, data: e.error || {} } });
    throw e;
  }
}

module.exports = { MODELS, PRICES, fromOpenAI, ask, stream, costOf, probe, key };
