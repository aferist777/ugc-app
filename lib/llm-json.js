'use strict';

// ════════════════════════════════════════════════════════════════════════════
// ONE STRUCTURED-OUTPUT CALL — the floor everything in the writing flow stands on.
//
// Every stage of script generation answers in a shape: five hooks with their kinds, a
// title plus paragraphs, a narrator profile of twelve fields, topics as block indices.
// The app's existing callAI() returns prose and the caller guesses at it - fine for a
// paragraph of image prompt, useless here, where a missing field means a five-stage chain
// fails on stage four with a TypeError.
//
// So this is the OpenAI-compatible json_schema call, ported from an earlier project where it is
// what the whole script step runs on:
//
//   response_format: { type: 'json_schema', json_schema: { name, strict: true, schema } }
//
// Two failures get their own message because both happened often enough there to earn one:
// a model that reasons past the token ceiling and never closes its JSON, and a model that
// ignores the schema and writes prose. Silence on either produces "undefined is not a
// function" three stages later.
//
// NOT a replacement for callAI(). That one has the OpenRouter -> kie.ai cascade and is
// right for everything already using it. There is no cascade here on purpose: a fallback
// model that does not honour json_schema turns a clean refusal into a parse error.
// ════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const axios = require('axios');

const WM = require('./writing-models');

const SETTINGS_FILE = path.join(require('./config').DATA_DIR, 'settings.json');

// Reasoning models spend part of the budget before writing anything, so the ceiling sits
// well above what the visible answer needs. Measured in an earlier project on a comparable call:
// ~370 tokens of answer against 3100-3400 of thinking, varying enough between runs that the
// same request succeeded twice and was cut off mid-JSON on the third. Nothing is paid for
// room left unused.
const MAX_TOKENS = 16000;
const TIMEOUT_MS = 180000;

function _key(field) {
  try {
    const s = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    return String(s[field] || '').trim();
  } catch (e) {
    return '';
  }
}

/**
 * @param {object} o
 * @param {string} o.system   system prompt
 * @param {string} o.user     user prompt
 * @param {object} o.schema   JSON Schema the answer must satisfy
 * @param {string} [o.provider] openrouter | openai   (anthropic is listed but not wired)
 * @param {string} [o.model]
 * @param {string} [o.effort]
 * @param {number} [o.temperature]  omitted -> the provider's default
 * @param {number} [o.maxTokens]
 * @param {string} [o.name]   schema name, for the provider's error messages
 * @returns {Promise<object>} the parsed, schema-shaped answer
 */
async function callJSON(o = {}) {
  const { provider, model, effort } = WM.normalise(o);
  const reg = WM.REGISTRY[provider];

  if (!WM.OPENAI_COMPATIBLE.has(provider)) {
    throw new Error(`${reg.label} needs its own SDK path, which is not wired here yet. `
      + 'Pick OpenRouter, which is what these prompts were written against.');
  }
  const key = _key(reg.keyField);
  if (!key) {
    throw new Error(`No ${reg.label} API key. Add one in Brains (the key popup on Library).`);
  }
  if (!o.system || !o.user || !o.schema) {
    throw new Error('callJSON needs a system prompt, a user prompt and a schema.');
  }

  const payload = {
    model,
    max_tokens: o.maxTokens || MAX_TOKENS,
    messages: [
      { role: 'system', content: o.system },
      { role: 'user', content: o.user },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: { name: o.name || 'result', strict: true, schema: o.schema },
    },
  };
  // Effort is what the dropdown sells, so it is sent rather than swallowed. Providers that
  // do not read `reasoning` ignore an unknown field; the ones that do get the level asked
  // for. It is not folded into the model id, which is how you end up with a model that does
  // not exist.
  if (effort) payload.reasoning = { effort };
  // Sent only when a caller asks for it. Left off, the provider's own default applies, which is
  // right for the stages that should be as steady as they can be; the narrator analysis asks for
  // it explicitly because it is meant to be run several times and give several answers.
  if (o.temperature != null) payload.temperature = Number(o.temperature);

  const headers = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  if (provider === 'openrouter') headers['X-Title'] = 'UGC Character Generator';

  let res;
  try {
    res = await axios.post(`${reg.base}/chat/completions`, payload, { headers, timeout: TIMEOUT_MS });
  } catch (e) {
    const body = e.response && e.response.data;
    const detail = body ? String(typeof body === 'string' ? body : JSON.stringify(body)).slice(0, 300) : e.message;
    throw new Error(`${reg.label} error${e.response ? ' ' + e.response.status : ''}: ${detail}`);
  }

  const choice = res.data && res.data.choices && res.data.choices[0];
  if (!choice) {
    throw new Error(`Unexpected ${reg.label} response: ${JSON.stringify(res.data || {}).slice(0, 300)}`);
  }
  // Checked BEFORE parsing: a truncated answer is invalid JSON too, and "did not return
  // valid JSON" would send you looking at the wrong thing.
  if (choice.finish_reason === 'length') {
    throw new Error(`${model} ran past the token limit without closing its JSON — `
      + 'pick a model that supports structured outputs, or ask for fewer scenes.');
  }
  const content = (choice.message && choice.message.content) || '';
  try {
    return JSON.parse(content);
  } catch (e) {
    throw new Error(`${model} did not return valid JSON: ${String(content).slice(0, 200)}`);
  }
}

module.exports = { callJSON, MAX_TOKENS, TIMEOUT_MS };
