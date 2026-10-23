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
// (phase V37, the owner 2026-10-23: "лестница чисто для агентов предназначена. из формы сценариев выбор модели убираем.
// идем по лестнице") The scenario generator is on it too - its hooks, script, cleaning and rewrites, a source's topics, a
// narrator's reading (lib/llm-json.js callLadder) -, and so the ladder does LONG work as well as short: a call says how
// long it may wait, how long the answer may be, at what effort, and may be cancelled; an answer cut at its length is a
// failure, not a text; and PAID ONCE (`once`) holds on every step - a timeout, a dropped connection, a 5xx, a cut, a
// Replicate run past its time (cancelled) stop the ladder rather than paying the next step for the same work. A refusal
// (kie's filter, Claude's) goes on to the next step - a refusal is not billed.
// The 3D Studio's room layout (lib/kie-claude.js) is still that studio's own (the owner's (л5)).
//
// EFFORT is the caller's (the owner's (л1), 2026-10-23): medium for the moments of highlights and everything of V37, low
// (the default) for the chats' writers, the pictures and the sound's writer. It reaches the step that has that level -
// Claude's medium or low; GPT's reasoning_effort -; Gemini on kie and Replicate has only low and high, and is left at
// its own default for medium, and for a caller that names none.
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
// visible. Each takes the call's own `x`: { timeout, effort, maxTokens, signal } (V37).

const _cancelled = () => Object.assign(new Error('cancelled'), { cancelled: true, unsure: false });
// An answer that stopped at its length limit was written and paid for: a failure, and one that may not be asked again
// of the next step under `once`.
const _cut = (model) => Object.assign(new Error(model + '\'s answer was cut off at its length limit'), { cut: true, unsure: true });
// Gemini on kie and Replicate knows low and high only; medium leaves it to the model.
const _twoLevel = (effort) => (effort === 'low' || effort === 'high' ? effort : '');

async function _kie(model, messages, x) {
  const key = String(getSettings().kieApiKey || '').trim();
  const body = { stream: false, messages };
  if (_twoLevel(x.effort)) body.reasoning_effort = _twoLevel(x.effort);
  let r;
  try {
    r = await axios.post(`${KIE_BASE}/${model}/v1/chat/completions`, body,
      { headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, timeout: x.timeout, signal: x.signal });
  } catch (e) {
    if (x.signal && x.signal.aborted) throw _cancelled();
    throw e;
  }
  // A REFUSAL ARRIVES INSIDE A 200: "The model is not supported" comes back with the envelope saying so and the status
  // saying nothing - read the choices first and a dead model looks exactly like a shy one.
  const env = r.data || {};
  if (env.code != null && Number(env.code) !== 200) throw new Error(env.msg || ('code ' + env.code));
  const choice = (env.choices || [])[0] || {};
  if (String(choice.finish_reason || '') === 'length') throw _cut(model);
  return _text(choice.message ? choice.message.content : '');
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

const _sleep = (ms, signal) => new Promise((resolve, reject) => {
  if (signal && signal.aborted) { reject(_cancelled()); return; }
  const t = setTimeout(() => { if (signal) signal.removeEventListener('abort', off); resolve(); }, ms);
  const off = () => { clearTimeout(t); reject(_cancelled()); };
  if (signal) signal.addEventListener('abort', off, { once: true });
});

async function _replicate(model, messages, x) {
  const key = String(getSettings().replicateApiKey || '').trim();
  const auth = { Authorization: 'Bearer ' + key };
  const { prompt, system, images } = _flatten(messages);
  if (!prompt) throw new Error('nothing to ask');
  const d = _replDialect(model);
  const gpt = String(model || '').startsWith('openai/');
  const input = { prompt };
  if (system) input[d.system] = system;
  if (images.length) input[d.image] = await Promise.all(images.map(_asDataUri));
  // (V37) The length and the effort when the call names them - under each family's own field names (lib/writing-models.js).
  if (x.maxTokens) { if (gpt) input.max_completion_tokens = x.maxTokens; else input.max_output_tokens = Math.min(65535, x.maxTokens); }
  if (x.effort) { if (gpt) input.reasoning_effort = x.effort; else if (_twoLevel(x.effort)) input.thinking_level = _twoLevel(x.effort); }
  const stop = async (id) => {
    try { await axios.post(`https://api.replicate.com/v1/predictions/${id}/cancel`, {}, { headers: auth, timeout: 20000 }); } catch (e) { /* it ends by itself */ }
  };
  // A call that can be cancelled is not asked to wait: its id comes back at once, so a cancel knows what to stop. The
  // create itself is not aborted - dropped halfway, the prediction could exist with nobody holding its id.
  const r = await axios.post(`https://api.replicate.com/v1/models/${model}/predictions`, { input }, {
    headers: { ...auth, 'Content-Type': 'application/json',
               // Blocks until it is done rather than handing back an id to poll - an answer takes seconds.
               ...(x.signal ? {} : { Prefer: `wait=${Math.max(5, Math.min(_REPL_WAIT, Math.floor(x.timeout / 1000)))}` }) },
    timeout: x.signal ? 75000 : x.timeout,
  });
  let p = r.data || {};
  const live = () => p.status === 'starting' || p.status === 'processing';
  const deadline = Date.now() + x.timeout;
  while (live() && Date.now() < deadline) {
    try { await _sleep(x.signal ? 1000 : 2000, x.signal); }
    catch (e) { if (p.id) await stop(p.id); throw e; }
    try {
      p = (await axios.get(`https://api.replicate.com/v1/predictions/${p.id}`, { headers: auth, timeout: 20000 })).data || {};
    } catch (e) { /* one lost poll is not a failed prediction */ }
  }
  // (V37) Past its time it is CANCELLED - it would go on being billed - and it may have been paid for: not asked again.
  if (live()) {
    if (p.id) await stop(p.id);
    throw Object.assign(new Error(model + ' took longer than ' + Math.round(x.timeout / 1000) + ' s and was cancelled'), { unsure: true });
  }
  // A refusal is a finished prediction with an error, not a bad status code.
  if (p.status !== 'succeeded') throw new Error(String(p.error || ('prediction ' + (p.status || 'did not finish'))).slice(0, 300));
  // The output is the STREAM, a list of chunks: joined, not [0].
  return String(Array.isArray(p.output) ? p.output.join('') : (p.output || '')).trim();
}

async function _openrouter(model, messages, x) {
  const key = String(getSettings().openRouterApiKey || '').trim();
  const body = { model, messages, stream: false };
  if (x.maxTokens) body.max_tokens = x.maxTokens;
  let r;
  try {
    r = await axios.post('https://openrouter.ai/api/v1/chat/completions', body, {
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json',
                 'HTTP-Referer': 'https://localhost', 'X-Title': 'UGC Studio' },
      timeout: x.timeout, signal: x.signal,
    });
  } catch (e) {
    if (x.signal && x.signal.aborted) throw _cancelled();
    throw e;
  }
  const d = r.data || {};
  if (d.error) throw new Error((d.error && d.error.message) || 'refused');
  const choice = (d.choices || [])[0] || {};
  if (String(choice.finish_reason || '') === 'length') throw _cut(model);
  return _text(choice.message ? choice.message.content : '');
}

// Claude: the thinking kept short (effort `low`) unless the call asks for more - an agent answers in seconds, and a
// writer's prompt is not a proof. A long answer (a ceiling above 16 000) is STREAMED: the package will not hold a large
// ceiling open without a stream. A refusal that Anthropic's own fallback did not take is a failed step, and the ladder
// goes on. (V37) The package's own errors carry a `status` and no `response`: a 5xx (not 529, "overloaded", which is
// turned away unread) or a lost connection may have been read and billed - unsure.
async function _anthropic(model, messages, x) {
  const C = require('./claude');
  const m = C.fromOpenAI(messages);
  const maxTokens = x.maxTokens || 16000;
  let r;
  try {
    r = await C.ask({ model, system: m.system, messages: m.messages, effort: x.effort || 'low', maxTokens, timeout: x.timeout,
      signal: x.signal, stream: maxTokens > 16000 });
  } catch (e) {
    if (x.signal && x.signal.aborted) throw _cancelled();
    if (e && e.refused) throw Object.assign(e, { unsure: false });
    const st = e && typeof e.status === 'number' ? e.status : 0;
    if (st) throw Object.assign(e, { unsure: st >= 500 && st !== 529 });
    if (e && /timeout|connection|aborted|socket/i.test(String(e.name || '') + ' ' + String(e.message || ''))) throw Object.assign(e, { unsure: true });
    throw e;
  }
  if (r.cut) throw _cut(model);
  return r.text;
}

const TRANSPORT = { kie: _kie, replicate: _replicate, anthropic: _anthropic, openrouter: _openrouter };

// What a call asks of every step: { timeout, effort, maxTokens, signal } (V37).
const _callOf = (o, msgs) => ({ timeout: o.timeout || (_hasImages(msgs) ? 90000 : 45000), effort: o.effort || '',
  maxTokens: o.maxTokens > 0 ? Math.round(o.maxTokens) : 0, signal: o.signal || null });

/** One step, as it is - for a check of a model; the agents ask through `ask`. */
async function askStep(step, messages, opts) {
  const o = opts || {};
  const msgs = _withImages(messages, o.images);
  const go = TRANSPORT[step && step.provider];
  if (!go) throw new Error('no transport for ' + (step && step.provider));
  return go(step.model, msgs, _callOf(o, msgs));
}

// (phase V33.1) A step that got NO ANSWER - a timeout, a dropped connection, a 5xx - may have been read and billed all the
// same: lib/task-started.js says which failures those are. Claude's own package names its own (lib/claude.js hands a status
// on as `response`; a connection or a timeout comes with none).
function _unsure(e) {
  if (e && typeof e.unsure === 'boolean') return e.unsure;
  if (e && !e.response && /timeout|connection/i.test(String(e.name || '') + ' ' + String(e.message || ''))) return true;
  return !!require('./task-started').notStarted('the agent', e).unsure;
}

/**
 * The ladder, in order, until one of them says something: `{ raw, by: {provider, model}, tried }`, or `raw: ''` with
 * what each step said in `tried`. An empty answer counts as a refusal - "" is not a prompt.
 *
 * LOOKING TAKES LONGER THAN READING: 45 s is enough for a sentence and not for two photographs (the first rung timed out
 * at exactly 45 s on a real two-reference message), so a message with pictures waits 90 s unless its caller says.
 *
 * PAID ONCE (`once`, phase V33.1 - a long read, the moments of an hour of video): a step that got no answer STOPS the
 * ladder - the next one is not asked to read the same thing again, at a price - and the answer says so (`unsure`).
 * (V37) So does an answer cut at its length, and a Replicate run past its time.
 * `onStep(step)` is told each step just before it is asked.
 * (V37) The call's own `timeout` (each step's), `effort` (low by default, as every agent asked before), `maxTokens` (the
 * answer's ceiling; Claude's 16 000 by default) and `signal` (a cancel - thrown as `{ cancelled: true }`, the next step
 * never asked). `cut: step` in the answer when the ladder stopped on a cut one.
 */
async function ask(messages, opts) {
  const o = opts || {};
  const msgs = _withImages(Array.isArray(messages) ? messages : [], o.images);
  const x = _callOf(o, msgs);
  const tried = [];
  for (const step of ladder()) {
    if (x.signal && x.signal.aborted) throw _cancelled();
    const who = step.provider + '/' + step.model;
    const off = offWhy(step.provider);
    if (off) { tried.push(who + ' - skipped, ' + off); continue; }
    try {
      if (o.onStep) o.onStep(step);
      const raw = await TRANSPORT[step.provider](step.model, msgs, x);
      if (x.signal && x.signal.aborted) throw _cancelled();
      if (raw) {
        if (tried.length) console.log('[agents] fell to', who, 'after', tried.join(' | '));
        return { raw, by: step, tried: tried.concat(who) };
      }
      tried.push(who + ' - answered nothing');
      console.warn('[agents]', who, 'answered nothing');
    } catch (e) {
      if ((e && e.cancelled) || (x.signal && x.signal.aborted)) throw _cancelled();
      const why = String((e.response && e.response.data && ((e.response.data.error && e.response.data.error.message) || e.response.data.msg
        || e.response.data.detail)) || (e.response && e.response.status) || e.message).slice(0, 140);
      tried.push(who + ' - ' + why);
      console.warn('[agents]', who, 'failed:', why);
      if (o.once && _unsure(e)) return { raw: '', by: null, tried, unsure: step, ...(e && e.cut ? { cut: step } : {}) };
    }
  }
  return { raw: '', by: null, tried };
}

module.exports = { FILE, MAX_STEPS, PROVIDERS, DEFAULT, ladder, setLadder, offWhy, state, ask, askStep };
