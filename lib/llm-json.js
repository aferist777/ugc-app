'use strict';

// ════════════════════════════════════════════════════════════════════════════
// ONE STRUCTURED-OUTPUT CALL — the floor everything in the writing flow stands on.
//
// Every stage of script generation answers in a shape: five hooks with their kinds, a title plus
// paragraphs, a narrator profile of twelve fields, topics as block indices. A missing field means a
// five-stage chain failing on stage four with a TypeError, so the shape is checked here, once.
//
// THROUGH kie.ai OR REPLICATE (phase F3, the owner 2026-09-30) - lib/writing-models.js says which
// models and how each takes its effort. Neither aggregator offers these models a strict json_schema
// mode, so:
//   - THE SCHEMA GOES INTO THE PROMPT, descriptions and all (they used to reach the model only
//     through response_format), with the rule to answer with one JSON object and nothing else;
//   - the answer is parsed STRICTLY - an answer that stops before its closing brace was cut off,
//     and is said so, instead of being "repaired" into a shorter script nobody asked for;
//   - its shape is checked against the schema: required fields, types, extra fields dropped.
// There is no fallback to another model: a model quietly substituted writes in a voice nobody chose.
//
// NOT a replacement for callAI() in lib/helpers.js - that one serves the rest of the app.
// ════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const axios = require('axios');

const WM = require('./writing-models');

const SETTINGS_FILE = path.join(require('./config').DATA_DIR, 'settings.json');

// Room for the model to think and then answer: a reasoning model spends part of the budget before
// writing anything, and a thirty-scene script in Russian is long. Nothing is paid for room unused.
const MAX_TOKENS = 32768;
// A long script at a high effort takes minutes; Replicate is asked to wait a minute and then polled.
const TIMEOUT_MS = 300000;
const POLL_MS = 2000;

function _key(field) {
  try { return String(JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'))[field] || '').trim(); }
  catch (e) { return ''; }
}

/** Has this provider a key in the library's settings? */
function hasKey(provider) {
  const reg = WM.REGISTRY[provider];
  return !!(reg && _key(reg.keyField));
}

/**
 * A model choice that can run: the one given when its provider has a key, otherwise the first
 * provider that has one, on its first model. For the calls started away from the form - topic mining,
 * a narrator's reading - which may carry an old choice or none. The form itself never offers a
 * provider without a key.
 */
function runnable(opts = {}) {
  const n = WM.normalise(opts);
  if (hasKey(n.provider)) return opts;
  const other = Object.keys(WM.REGISTRY).find(hasKey);
  return other ? { ...opts, provider: other, model: '', effort: '' } : opts;
}

function _rule(schema) {
  return 'ANSWER FORMAT. Reply with ONE JSON object and nothing else - no words before or after it, '
    + 'no code fences. It must match this JSON Schema exactly: every required field present, no other '
    + 'fields, the types as given. The descriptions say what each field is for.\n'
    + JSON.stringify(schema, null, 1);
}

const _http = (e, label) => {
  const body = e.response && e.response.data;
  const detail = body ? String(typeof body === 'string' ? body : JSON.stringify(body)).slice(0, 300) : e.message;
  return new Error(`${label} error${e.response ? ' ' + e.response.status : ''}: ${detail}`);
};

// kie.ai: each model at its own address, the OpenAI chat shape. It streams unless told not to, and
// a refusal comes back INSIDE a 200 with `code`/`msg` - read that before the choices.
async function _kie(model, key, system, user, effort) {
  const body = { stream: false, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] };
  if (effort) body.reasoning_effort = effort;
  let res;
  try {
    res = await axios.post(`https://api.kie.ai/${model}/v1/chat/completions`, body,
      { headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, timeout: TIMEOUT_MS });
  } catch (e) { throw _http(e, 'kie.ai'); }
  const env = res.data || {};
  if (env.code != null && Number(env.code) !== 200) throw new Error(`kie.ai refused (${env.code}): ${env.msg || 'no reason given'}`);
  const choice = (env.choices || [])[0];
  if (!choice) throw new Error(`Unexpected kie.ai response: ${JSON.stringify(env).slice(0, 300)}`);
  return { text: String((choice.message && choice.message.content) || ''), cut: choice.finish_reason === 'length' };
}

// Replicate: not a chat API - a prediction with one prompt, a system field named by who made the
// model, the effort under its own name. Asked to wait a minute, then polled; cancelled if it runs
// past the deadline, so it does not go on being billed after the page has been told it failed.
function _replicateInput(family, system, user, effort, temperature) {
  if (family === 'rep-gpt') {
    const input = { prompt: user, system_prompt: system, max_completion_tokens: MAX_TOKENS };
    if (effort) input.reasoning_effort = effort;
    return input;
  }
  const input = { prompt: user, system_instruction: system, max_output_tokens: Math.min(65535, MAX_TOKENS) };
  if (family === 'rep-gemini-budget') input.thinking_budget = WM.THINKING_BUDGET[effort] != null ? WM.THINKING_BUDGET[effort] : 4096;
  else if (effort) input.thinking_level = effort;
  if (temperature != null) input.temperature = Number(temperature);
  return input;
}

async function _replicate(model, key, input) {
  const auth = { Authorization: `Bearer ${key}` };
  let p;
  try {
    p = (await axios.post(`https://api.replicate.com/v1/models/${model}/predictions`, { input },
      { headers: { ...auth, 'Content-Type': 'application/json', Prefer: 'wait=60' }, timeout: 75000 })).data || {};
  } catch (e) { throw _http(e, 'Replicate'); }
  const deadline = Date.now() + TIMEOUT_MS;
  while ((p.status === 'starting' || p.status === 'processing') && Date.now() < deadline) {
    await new Promise(x => setTimeout(x, POLL_MS));
    try { p = (await axios.get(`https://api.replicate.com/v1/predictions/${p.id}`, { headers: auth, timeout: 20000 })).data || {}; }
    catch (e) { /* one lost poll is not a failed prediction */ }
  }
  if (p.status === 'starting' || p.status === 'processing') {
    try { await axios.post(`https://api.replicate.com/v1/predictions/${p.id}/cancel`, {}, { headers: auth, timeout: 20000 }); } catch (e) { /* it ends by itself */ }
    throw new Error(`${model} took longer than ${Math.round(TIMEOUT_MS / 60000)} minutes and was cancelled.`);
  }
  if (p.status !== 'succeeded') throw new Error(`${model} ${p.status || 'failed'}: ${String(p.error || '').slice(0, 300)}`);
  const text = Array.isArray(p.output) ? p.output.join('') : String(p.output || '');
  // Nothing at all from a run that succeeded: the whole budget went on thinking. Replicate gives no
  // finish reason, so this is the sign - said as the cut-off it is, not as "not JSON".
  return { text, cut: !text.trim() };
}

// The object inside the answer: code fences and any words around it dropped. An answer whose last
// brace never comes was cut off - by the token limit or the model - and is not guessed at.
function parseAnswer(raw, model) {
  const s = String(raw || '').trim().replace(/^```[a-z]*\s*/i, '').replace(/```\s*$/, '').trim();
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a < 0) throw new Error(`${model} did not answer with JSON: ${s.slice(0, 200)}`);
  if (b < a) throw new Error(`${model}'s answer was cut off before it finished - ask for fewer scenes, or try another model.`);
  const body = s.slice(a, b + 1);
  try { return JSON.parse(body); } catch (e) { /* a trailing comma is the usual reason - one more try */ }
  try { return JSON.parse(body.replace(/,(\s*[}\]])/g, '$1')); } catch (e) {
    if (_unclosed(s.slice(a))) throw new Error(`${model}'s answer was cut off before it finished - ask for fewer scenes, or try another model.`);
    throw new Error(`${model} did not return valid JSON: ${body.slice(0, 200)}`);
  }
}

// More brackets opened than closed, strings aside: the answer stopped in the middle.
function _unclosed(s) {
  let depth = 0, inStr = false, esc = false;
  for (const ch of s) {
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') depth--;
  }
  return depth > 0 || inStr;
}

// The answer made to fit the schema, or a sentence saying where it does not: required fields there,
// types as asked (a number where a string is wanted is turned into one; an integer given as "12" is
// read), extra fields dropped.
function conform(schema, value, where = 'answer') {
  const t = schema && schema.type;
  if (t === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${where} is not an object`);
    const out = {};
    for (const k of schema.required || []) if (!(k in value)) throw new Error(`${where} has no "${k}"`);
    for (const [k, sub] of Object.entries(schema.properties || {})) if (k in value) out[k] = conform(sub, value[k], `${where}.${k}`);
    return out;
  }
  if (t === 'array') {
    if (!Array.isArray(value)) throw new Error(`${where} is not a list`);
    return value.map((v, i) => conform(schema.items || {}, v, `${where}[${i}]`));
  }
  if (t === 'string') {
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    throw new Error(`${where} is not text`);
  }
  if (t === 'integer' || t === 'number') {
    const n = Number(value);
    if (!Number.isFinite(n)) throw new Error(`${where} is not a number`);
    return t === 'integer' ? Math.round(n) : n;
  }
  if (t === 'boolean') return !!value;
  return value;
}

/**
 * @param {object} o
 * @param {string} o.system   system prompt
 * @param {string} o.user     user prompt
 * @param {object} o.schema   JSON Schema the answer must satisfy
 * @param {string} [o.provider] kie | replicate
 * @param {string} [o.model]
 * @param {string} [o.effort]
 * @param {number} [o.temperature]  omitted -> the model's default (kie and Replicate's GPT take none)
 * @param {string} [o.name]   what the answer is, for error messages
 * @returns {Promise<object>} the parsed, schema-shaped answer
 */
async function callJSON(o = {}) {
  const { provider, model, effort, family } = WM.normalise(o);
  const reg = WM.REGISTRY[provider];
  const key = _key(reg.keyField);
  if (!key) throw new Error(`No ${reg.label} API key - add it on Admin → API keys.`);
  if (!o.system || !o.user || !o.schema) throw new Error('callJSON needs a system prompt, a user prompt and a schema.');
  const system = o.system + '\n\n' + _rule(o.schema);

  const r = family === 'kie-chat'
    ? await _kie(model, key, system, o.user, effort)
    : await _replicate(model, key, _replicateInput(family, system, o.user, effort, o.temperature));
  if (r.cut) throw new Error(`${model}'s answer was cut off at its token limit - ask for fewer scenes, or a lower effort.`);
  const data = parseAnswer(r.text, model);
  try { return conform(o.schema, data, o.name || 'answer'); }
  catch (e) { throw new Error(`${model} answered in the wrong shape (${e.message}).`); }
}

module.exports = { callJSON, hasKey, runnable, parseAnswer, conform, MAX_TOKENS, TIMEOUT_MS };
