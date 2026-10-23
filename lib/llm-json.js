'use strict';

// ════════════════════════════════════════════════════════════════════════════
// ONE STRUCTURED-OUTPUT CALL — the floor everything in the writing flow stands on.
//
// Every stage of script generation answers in a shape: five hooks with their kinds, a title plus
// paragraphs, a narrator profile of twelve fields, topics as block indices. A missing field means a
// five-stage chain failing on stage four with a TypeError, so the shape is checked here, once.
//
// BY THE AGENTS' LADDER (phase V37, the owner 2026-10-23: "лестница чисто для агентов предназначена. из формы
// сценариев выбор модели убираем. идем по лестнице"): the generator's stages, a source's topics and a narrator's reading
// are asked of Admin -> AI settings' ladder (lib/agents.js) - no model is chosen in a form any more (until V37 they were:
// kie.ai, Replicate or Claude, from the generator's Provider / Model / Effort). None of its models is offered a strict
// json_schema mode, so:
//   - THE SCHEMA GOES INTO THE PROMPT, descriptions and all, with the rule to answer with one JSON object and nothing else;
//   - the answer is parsed STRICTLY - an answer that stops before its closing brace was cut off, and is said so, instead
//     of being "repaired" into a shorter script nobody asked for;
//   - its shape is checked against the schema: required fields, types, extra fields dropped.
// PAID ONCE: a step that did not finish, or stopped at its length, stops the ladder - a script that may have been paid
// for is not written again by the next model by itself; a refusal goes on to the next step (lib/agents.js `once`).
// ════════════════════════════════════════════════════════════════════════════

// A long script at effort medium takes minutes: every step may take five.
const TIMEOUT_MS = 300000;
// Room for the model to think and then answer: a thirty-scene script in Russian is long, and nothing is paid for room
// unused (Claude streams it; Replicate's Gemini takes up to 65 535).
const LONG_TOKENS = 64000;

function _rule(schema) {
  return 'ANSWER FORMAT. Reply with ONE JSON object and nothing else - no words before or after it, '
    + 'no code fences. It must match this JSON Schema exactly: every required field present, no other '
    + 'fields, the types as given. The descriptions say what each field is for.\n'
    + JSON.stringify(schema, null, 1);
}

// A CANCELLED CALL (phase G1, the owner 2026-09-30: a cross beside the countdown - "the balance is spent, but it is
// kopecks"): the error says `cancelled`, so a caller can tell it from a failure.
const _cancelled = () => Object.assign(new Error('cancelled'), { cancelled: true });

// The object inside the answer: code fences and any words around it dropped. An answer whose last
// brace never comes was cut off - by the token limit or the model - and is not guessed at.
function parseAnswer(raw, model) {
  const s = String(raw || '').trim().replace(/^```[a-z]*\s*/i, '').replace(/```\s*$/, '').trim();
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a < 0) throw new Error(`${model} did not answer with JSON: ${s.slice(0, 200)}`);
  if (b < a) throw new Error(`${model}'s answer was cut off before it finished - ask for fewer scenes and press again.`);
  const body = s.slice(a, b + 1);
  try { return JSON.parse(body); } catch (e) { /* a trailing comma is the usual reason - one more try */ }
  try { return JSON.parse(body.replace(/,(\s*[}\]])/g, '$1')); } catch (e) {
    if (_unclosed(s.slice(a))) throw new Error(`${model}'s answer was cut off before it finished - ask for fewer scenes and press again.`);
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
 * The call by the AGENTS' LADDER: the schema in the system prompt, the answer read strictly and made to fit it, every
 * step asked for long work - five minutes, a ceiling of 64 000 tokens, the effort asked (medium - the owner's (л1)),
 * cancellable. Paid once (above).
 * @param {object} o  { system, user, schema, name, effort = 'medium', signal, onStep }
 * @returns {Promise<{ data: object, by: { provider, model } }>} the schema-shaped answer, and the step that wrote it
 */
async function callLadder(o = {}) {
  if (!o.system || !o.user || !o.schema) throw new Error('callLadder needs a system prompt, a user prompt and a schema.');
  if (o.signal && o.signal.aborted) throw _cancelled();
  const ans = await require('./agents').ask(
    [{ role: 'system', content: o.system + '\n\n' + _rule(o.schema) }, { role: 'user', content: o.user }],
    { once: true, timeout: TIMEOUT_MS, effort: o.effort || 'medium', maxTokens: LONG_TOKENS, signal: o.signal || null, onStep: o.onStep });
  if (o.signal && o.signal.aborted) throw _cancelled();
  if (!ans.raw) {
    if (ans.cut) throw new Error(`${ans.cut.model}'s answer was cut off at its length limit - ask for fewer scenes and press again.`);
    if (ans.unsure) {
      throw Object.assign(new Error(`The agent did not finish (${ans.unsure.provider} / ${ans.unsure.model}) - it may have been paid for, `
        + 'so the next one was not asked by itself; press again to ask once more.'), { unsure: true });
    }
    throw new Error('No agent of the ladder could answer (Admin → AI settings): ' + (ans.tried || []).join(' | ').slice(0, 400));
  }
  const model = ans.by.model;
  const data = parseAnswer(ans.raw, model);
  let value;
  try { value = conform(o.schema, data, o.name || 'answer'); }
  catch (e) { throw new Error(`${model} answered in the wrong shape (${e.message}).`); }
  return { data: value, by: { provider: ans.by.provider, model } };
}

module.exports = { callLadder, parseAnswer, conform, TIMEOUT_MS };
