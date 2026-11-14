'use strict';

// ════════════════════════════════════════════════════════════════════════════
// THE AGENTS' LADDER.
//
// ONE ordered list of (aggregator, model) steps, tried in turn until one answers, for every agent of the app that
// reads words and pictures and answers within a minute or two:
//   - the chats' writers (lib/mv3-agent.js): the pictures chat's analyst, the video chat's prompts, Kling's first
//     frame, the translations into English (a prompt, a script's lines), the frames chat (the light pass, a frame's prompt, `ideas`),
//     the 3D Studio's description of a place;
//   - every caller of callAIVisionWithFallback (lib/helpers.js): New Character's reading and the sheet's framing, the
//     looks, lookbooks and environments, and the talking head's agents - the mood markup, the frames plan, the
//     animation prompts, reading the look and the place, how a place moves.
//
// The scenario generator is on it too - its hooks, script and rewrites, a source's topics, a
// narrator's reading (lib/llm-json.js callLadder) -, and so the ladder does LONG work as well as short: a call says how
// long it may wait, how long the answer may be, at what effort, and may be cancelled; an answer cut at its length is a
// failure, not a text; and PAID ONCE (`once`) holds on every step - a timeout, a dropped connection, a 5xx, a cut, a
// Replicate run past its time (cancelled) stop the ladder rather than paying the next step for the same work. A refusal
// (kie's filter, Claude's) goes on to the next step - a refusal is not billed.
// The assistant's chat (routes/assistant.js) asks it too, its answer shown as it is written (`stream`, at the end).
// The 3D Studio's room layout (lib/kie-claude.js) is not on it - it is that studio's own.
//
// EFFORT is the caller's: medium for the moments of highlights and the long work above, low
// (the default) for the chats' writers, the pictures and the sound's writer. It reaches the step that has that level -
// Claude's medium or low; GPT's reasoning_effort -; Gemini on kie and Replicate has only low and high, and is left at
// its own default for medium, and for a caller that names none.
//
// Edited on Admin -> AI settings (GET/PUT /api/ai-settings). Kept in data/mv3-settings.json (`agents`).
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

// Who can be a step, and with which models. EVERY MODEL HERE SEES PICTURES: each kie and Replicate id
// answered a real photo through this file's own transport before it was listed. Two kie models did not answer at all, a
// photo or a sentence, and are not here: `gemini-3-flash` ("The channel is not supported") and
// `gemini-3-5-flash-openai` ("Network error, please try again later", every time). kie's ids carry -openai
// because the bare spellings answer "The model is not supported" - inside an HTTP 200.
//
// OpenRouter: an aggregator of the ladder, its models those of the same families its own
// public catalogue lists as taking images (openrouter.ai/api/v1/models) - NOT asked yet, there is
// no key to ask with; `unproven` says so on the page.
//
// `video: true` - the model WATCHES A CLIP, its sound with it: lib/clip-watch.js asks
// only these steps, in the ladder's order, and steps over the rest (Claude takes no video at all). Replicate's two
// Gemini by their live schemas (`videos`, up to 10, up to 45 min each; `video_fps`); OpenRouter's
// Gemini by its documentation (a `video_url` part, our own file as a base64 data URL). kie's Gemini 3.8 Flash by a paid
// probe: a `video_url` part is DROPPED unread (430 tokens in, "please upload the clip"), the clip's
// link as an `image_url` part is watched - 908 tokens in, the clip described right, 0.07 credits; 3.7 and 3.6 not probed.
const PROVIDERS = [
  {
    id: 'kie', label: 'kie.ai', key: 'kieApiKey', health: 'kie.ai',
    models: [
      { id: 'gemini-3-8-flash-openai', label: 'Gemini 3.8 Flash', video: true },
      { id: 'gemini-3-7-flash-openai', label: 'Gemini 3.7 Flash' },
      { id: 'gemini-3-6-flash-openai', label: 'Gemini 3.6 Flash' },
    ],
  },
  {
    id: 'replicate', label: 'Replicate', key: 'replicateApiKey', health: 'replicate',
    models: [
      { id: 'google/gemini-3.5-flash', label: 'Gemini 3.5 Flash', video: true },
      { id: 'google/gemini-3-flash', label: 'Gemini 3 Flash', video: true },
      { id: 'openai/gpt-5.6-luna', label: 'GPT-5.6 luna' },
    ],
  },
  {
    // Claude directly, through Anthropic's own package (lib/claude.js): the person's own key, the step
    // they choose; every one of the three sees pictures.
    id: 'anthropic', label: 'Claude (Anthropic)', key: 'anthropicApiKey', health: 'anthropic',
    models: require('./claude').MODELS.map(m => ({ id: m.id, label: m.label })),
  },
  {
    id: 'openrouter', label: 'OpenRouter', key: 'openRouterApiKey', health: 'openrouter', unproven: true,
    models: [
      { id: 'google/gemini-3.8-flash', label: 'Gemini 3.8 Flash', video: true },
      { id: 'google/gemini-3.7-flash', label: 'Gemini 3.7 Flash', video: true },
      { id: 'google/gemini-3.6-flash', label: 'Gemini 3.6 Flash', video: true },
      { id: 'google/gemini-3.5-flash', label: 'Gemini 3.5 Flash', video: true },
      { id: 'openai/gpt-5.6-luna', label: 'GPT-5.6 luna' },
      { id: 'anthropic/claude-opus-5.5', label: 'Claude Opus 5.5' },
      { id: 'anthropic/claude-sonnet-5.5', label: 'Claude Sonnet 5.5' },
      { id: 'anthropic/claude-haiku-5.5', label: 'Claude Haiku 5.5' },
    ],
  },
];

// The default ladder: kie first - cheaper and quicker -, Replicate behind it.
const DEFAULT = [
  { provider: 'kie', model: 'gemini-3-8-flash-openai' },
  { provider: 'replicate', model: 'google/gemini-3.5-flash' },
];

const providerOf = (id) => PROVIDERS.find(p => p.id === id) || null;
const _modelOf = (step) => { const p = providerOf(step && step.provider); return p ? p.models.find(m => m.id === step.model) || null : null; };
/** Whether this step watches a clip. */
const watches = (step) => !!(_modelOf(step) || {}).video;

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
  return _fix(raw.agents);
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
                                     models: p.models.map(m => ({ id: m.id, label: m.label, video: !!m.video })) })),
  };
}

// ── The messages ────────────────────────────────────────────────────────────
// OpenAI-shaped throughout: roles, each with a string or a list of {type:'text'} / {type:'image_url'} parts. Pictures
// handed apart (the writers) ride with the LAST user message, which is the one describing them.
// Clips the same way, as `video_url` parts after the pictures - OpenRouter's own shape; each transport turns
// them into its aggregator's field.
function _withImages(messages, images, videos) {
  const pics = (images || []).filter(Boolean);
  const clips = (videos || []).filter(Boolean);
  if (!pics.length && !clips.length) return messages;
  const last = messages.map(m => m && m.role).lastIndexOf('user');
  return messages.map((m, i) => {
    if (i !== last) return m;
    const parts = typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : (m.content || []).slice();
    return { role: 'user', content: parts.concat(pics.map(u => ({ type: 'image_url', image_url: { url: u } })),
                                                 clips.map(u => ({ type: 'video_url', video_url: { url: u } }))) };
  });
}

const _hasImages = (messages) => messages.some(m => Array.isArray(m && m.content) && m.content.some(p => p && p.type === 'image_url'));
const _hasVideos = (messages) => messages.some(m => Array.isArray(m && m.content) && m.content.some(p => p && p.type === 'video_url'));

function _text(raw) {
  if (typeof raw === 'string') return raw.trim();
  if (Array.isArray(raw)) return raw.filter(p => p && p.type === 'text').map(p => p.text || '').join('').trim();
  return '';
}

// ── One step ────────────────────────────────────────────────────────────────
// One aggregator, one model, one answer or nothing - never a cascade of its own, which is what a ladder exists to make
// visible. Each takes the call's own `x`: { timeout, effort, maxTokens, signal }.

const _cancelled = () => Object.assign(new Error('cancelled'), { cancelled: true, unsure: false });
// An answer that stopped at its length limit was written and paid for: a failure, and one that may not be asked again
// of the next step under `once`.
const _cut = (model) => Object.assign(new Error(model + '\'s answer was cut off at its length limit'), { cut: true, unsure: true });
// Gemini on kie and Replicate knows low and high only; medium leaves it to the model.
const _twoLevel = (effort) => (effort === 'low' || effort === 'high' ? effort : '');

async function _kie(model, messages, x) {
  const key = String(getSettings().kieApiKey || '').trim();
  // kie's Gemini watches a clip handed as an `image_url` part (its link) - a `video_url` part it drops unread.
  const msgs = _hasVideos(messages) ? messages.map(m => (!Array.isArray(m && m.content) ? m : Object.assign({}, m, {
    content: m.content.map(p => (p && p.type === 'video_url' && p.video_url ? { type: 'image_url', image_url: { url: p.video_url.url } } : p)) }))) : messages;
  const body = { stream: false, messages: msgs };
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
  const videos = [];
  for (const m of messages) {
    const into = m && m.role === 'system' ? system : text;
    const c = m && m.content;
    if (typeof c === 'string') { if (c.trim()) into.push(c); continue; }
    for (const part of (Array.isArray(c) ? c : [])) {
      if (!part) continue;
      if (part.type === 'text' && part.text) into.push(String(part.text));
      else if (part.type === 'image_url' && part.image_url && part.image_url.url) images.push(part.image_url.url);
      else if (part.type === 'video_url' && part.video_url && part.video_url.url) videos.push(part.video_url.url);
    }
  }
  return { prompt: text.join('\n\n'), system: system.join('\n\n'), images, videos };
}

// A clip for OpenRouter: its documentation takes our own file as a base64 data URL.
async function _videoDataUri(src) {
  const s = String(src || '');
  if (!s || s.startsWith('data:')) return s;
  if (/^https?:\/\//i.test(s)) {
    const r = await axios.get(s, { responseType: 'arraybuffer', timeout: 120000 });
    const mime = String(r.headers['content-type'] || 'video/mp4').split(';')[0];
    return `data:${/^video\//.test(mime) ? mime : 'video/mp4'};base64,${Buffer.from(r.data).toString('base64')}`;
  }
  const abs = require('./helpers').resolveLocalMedia(s);
  if (!abs) throw new Error('clip not found: ' + s);
  return `data:video/mp4;base64,${fs.readFileSync(abs).toString('base64')}`;
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
  const { prompt, system, images, videos } = _flatten(messages);
  if (!prompt) throw new Error('nothing to ask');
  const d = _replDialect(model);
  const gpt = String(model || '').startsWith('openai/');
  const input = { prompt };
  if (system) input[d.system] = system;
  if (images.length) input[d.image] = await Promise.all(images.map(_asDataUri));
  // Clips by their public links (R2) - a clip is megabytes, too much for a data URI - and how many frames a
  // second the model looks at. Gemini's own fields (the live schema); a GPT step never gets here with a clip.
  if (videos.length) {
    input.videos = videos;
    if (x.videoFps > 0) input.video_fps = Math.max(0.1, Math.min(60, x.videoFps));
  }
  // The length and the effort when the call names them - under each family's own field names (the live schemas).
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
  // Past its time it is CANCELLED - it would go on being billed - and it may have been paid for: not asked again.
  if (live()) {
    if (p.id) await stop(p.id);
    throw Object.assign(new Error(model + ' took longer than ' + Math.round(x.timeout / 1000) + ' s and was cancelled'), { unsure: true });
  }
  // A refusal is a finished prediction with an error, not a bad status code.
  if (p.status !== 'succeeded') throw new Error(String(p.error || ('prediction ' + (p.status || 'did not finish'))).slice(0, 300));
  // Replicate says no finish reason: an answer as long as its ceiling stopped there - cut. Its metrics name the
  // count `token_output_count`.
  const met = p.metrics || {};
  const outTok = +(met.token_output_count || met.output_token_count) || 0;
  if (x.maxTokens && outTok >= x.maxTokens) throw _cut(model);
  // The output is the STREAM, a list of chunks: joined, not [0].
  return String(Array.isArray(p.output) ? p.output.join('') : (p.output || '')).trim();
}

async function _openrouter(model, messages, x) {
  const key = String(getSettings().openRouterApiKey || '').trim();
  // A clip goes inline, as its documentation takes our own file.
  const msgs = _hasVideos(messages) ? await Promise.all(messages.map(async (m) => (!Array.isArray(m && m.content) ? m
    : Object.assign({}, m, { content: await Promise.all(m.content.map(async (p) => (p && p.type === 'video_url' && p.video_url
      ? { type: 'video_url', video_url: { url: await _videoDataUri(p.video_url.url) } } : p))) })))) : messages;
  const body = { model, messages: msgs, stream: false };
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
// goes on. The package's own errors carry a `status` and no `response`: a 5xx (not 529, "overloaded", which is
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

// What a call asks of every step: { timeout, effort, maxTokens, signal }; `videoFps` - how many frames a
// second a clip is looked at, where the aggregator lets that be said. Watching a clip takes minutes, not seconds.
const _callOf = (o, msgs) => ({ timeout: o.timeout || (_hasVideos(msgs) ? 300000 : _hasImages(msgs) ? 90000 : 45000), effort: o.effort || '',
  maxTokens: o.maxTokens > 0 ? Math.round(o.maxTokens) : 0, signal: o.signal || null, videoFps: +o.videoFps > 0 ? +o.videoFps : 0 });

// A step that got NO ANSWER - a timeout, a dropped connection, a 5xx - may have been read and billed all the
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
 * PAID ONCE (`once` - a long read, the moments of an hour of video): a step that got no answer STOPS the
 * ladder - the next one is not asked to read the same thing again, at a price - and the answer says so (`unsure`).
 * So does an answer cut at its length, and a Replicate run past its time.
 * `onStep(step)` is told each step just before it is asked.
 * The call's own `timeout` (each step's), `effort` (low by default), `maxTokens` (the
 * answer's ceiling; Claude's 16 000 by default) and `signal` (a cancel - thrown as `{ cancelled: true }`, the next step
 * never asked). `cut: step` in the answer when the ladder stopped on a cut one.
 * `videos` - clips by their public links: only the steps that watch video are asked (`watches`), the others are
 * stepped over in `tried`; `videoFps` how closely. `accept(raw)` - '' when the answer will do, else why not: an answer
 * that will not do is that step's failure and the ladder goes on (it was answered - not unsure).
 */
async function ask(messages, opts) {
  const o = opts || {};
  const msgs = _withImages(Array.isArray(messages) ? messages : [], o.images, o.videos);
  const x = _callOf(o, msgs);
  const clips = _hasVideos(msgs);
  const tried = [];
  for (const step of ladder()) {
    if (x.signal && x.signal.aborted) throw _cancelled();
    const who = step.provider + '/' + step.model;
    if (clips && !watches(step)) { tried.push(who + ' - skipped, it does not watch video'); continue; }
    const off = offWhy(step.provider);
    if (off) { tried.push(who + ' - skipped, ' + off); continue; }
    try {
      if (o.onStep) o.onStep(step);
      const raw = await TRANSPORT[step.provider](step.model, msgs, x);
      if (x.signal && x.signal.aborted) throw _cancelled();
      const bad = raw && typeof o.accept === 'function' ? String(o.accept(raw) || '') : '';
      if (bad) {
        tried.push(who + ' - ' + bad.slice(0, 140));
        console.warn('[agents]', who, 'answered, not taken:', bad.slice(0, 140));
        continue;
      }
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

// ════════════════════════════════════════════════════════════════════════════
// AN ANSWER AS IT IS WRITTEN - the assistant's chat (routes/assistant.js).
//
// The step the person chose first, then the ladder's steps in order - but only while NOTHING has been written: a step
// that fails before its first word hands over to the next; one that fails after it ends the answer there, what was
// written kept and the reason beside it. A cancel ends it where it is.
//
// Each aggregator's own stream, read as Server-Sent Events. What one or two real messages to each showed:
//   kie         an OpenAI stream in a few large pieces; its price in credits on the last event (`credits_consumed`).
//   Replicate   a prediction with `stream: true` and its own stream address; a piece may repeat the whole text so far,
//               and the stream stays open for a minute after `done` - so it is closed at `done`, and the text kept is
//               the prediction's own output once it has ended. Its metrics count tokens; no price comes back.
//   Claude      fine pieces through Anthropic's package (lib/claude.js stream), the conversation cached.
//   OpenRouter  an OpenAI stream by its documentation, its cost in the usage of the last event - not asked yet.
// ════════════════════════════════════════════════════════════════════════════

const KIE_USD_PER_CREDIT = 0.005;

/** "Gemini 3.8 Flash · kie.ai" - a step in words. */
function labelOf(step) {
  const p = providerOf(step && step.provider);
  const m = _modelOf(step);
  return m ? m.label + ' · ' + p.label : String((step && step.model) || '');
}

// One stream's events: { event, data } - `data` the event's lines joined.
async function* _sse(body) {
  const dec = new TextDecoder();
  let buf = '';
  let ev = { event: '', data: [] };
  const take = () => { const out = ev.data.length || ev.event ? { event: ev.event, data: ev.data.join('\n') } : null; ev = { event: '', data: [] }; return out; };
  for await (const chunk of body) {
    buf += dec.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      let line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (line.endsWith('\r')) line = line.slice(0, -1);
      if (line === '') { const out = take(); if (out) yield out; continue; }
      if (line.startsWith(':')) continue;
      if (line.startsWith('event:')) ev.event = line.slice(6).trim();
      else if (line.startsWith('data:')) ev.data.push(line.slice(5).replace(/^ /, ''));
    }
  }
  const out = take();
  if (out) yield out;
}

// The clocks of one step: no first word within `firstMs`, or the whole answer longer than `timeout`, stops it; so does
// the caller's cancel. `why()` says which.
function _guard(x) {
  const ac = new AbortController();
  let why = '';
  const stop = (w) => { if (!why) why = w; ac.abort(); };
  const onCancel = () => stop('cancelled');
  if (x.signal) { if (x.signal.aborted) stop('cancelled'); else x.signal.addEventListener('abort', onCancel, { once: true }); }
  let first = setTimeout(() => stop('no word in ' + Math.round(x.firstMs / 1000) + ' s'), x.firstMs);
  const all = setTimeout(() => stop('the answer took longer than ' + Math.round(x.timeout / 1000) + ' s'), x.timeout);
  return {
    signal: ac.signal,
    word: () => { if (first) { clearTimeout(first); first = 0; } },
    end: () => { clearTimeout(first); clearTimeout(all); if (x.signal) x.signal.removeEventListener('abort', onCancel); },
    why: () => why,
  };
}

// A reply that is not a stream: a refusal in words (thrown), or - an aggregator that answered whole - its JSON.
async function _notStream(res) {
  if (res.ok && /event-stream/i.test(res.headers.get('content-type') || '')) return null;
  const raw = await res.text().catch(() => '');
  let j = null;
  try { j = JSON.parse(raw); } catch (e) { j = null; }
  if (!res.ok) {
    const msg = j ? ((j.error && (j.error.message || j.error)) || j.msg || j.detail || j.title) : raw;
    throw Object.assign(new Error(String(msg || ('HTTP ' + res.status)).slice(0, 300)), { status: res.status });
  }
  if (j && j.code != null && Number(j.code) !== 200) throw new Error(String(j.msg || ('code ' + j.code)));
  if (j && j.error) throw new Error(String(j.error.message || j.error));
  return j || {};
}

// An OpenAI-shaped stream (kie, OpenRouter): its pieces, a cut, the usage and the price where it says one.
async function _openaiStream(res, out, r, priceOf) {
  const whole = await _notStream(res);
  if (whole) {
    const c = (whole.choices || [])[0] || {};
    out.delta(_text(c.message ? c.message.content : ''));
    if (String(c.finish_reason || '') === 'length') r.cut = true;
    return r;
  }
  for await (const ev of _sse(res.body)) {
    if (ev.data === '[DONE]') break;
    let j;
    try { j = JSON.parse(ev.data); } catch (e) { continue; }
    if (j.code != null && Number(j.code) !== 200) throw new Error(String(j.msg || ('code ' + j.code)));
    if (j.error) throw new Error(String(j.error.message || j.error));
    const c = (j.choices || [])[0];
    if (c && c.delta && typeof c.delta.content === 'string') out.delta(c.delta.content);
    if (c && String(c.finish_reason || '') === 'length') r.cut = true;
    if (j.usage) r.usage = { in: +j.usage.prompt_tokens || 0, out: +j.usage.completion_tokens || 0 };
    const usd = priceOf(j);
    if (usd != null) r.usd = usd;
  }
  return r;
}

async function _kieStream(model, messages, x, out) {
  const key = String(getSettings().kieApiKey || '').trim();
  const body = { stream: true, stream_options: { include_usage: true }, messages };
  if (_twoLevel(x.effort)) body.reasoning_effort = _twoLevel(x.effort);
  const res = await fetch(`${KIE_BASE}/${model}/v1/chat/completions`, {
    method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: x.guard.signal });
  return _openaiStream(res, out, { usage: null, usd: null, cut: false },
    (j) => (j.credits_consumed != null ? (+j.credits_consumed || 0) * KIE_USD_PER_CREDIT : null));
}

async function _openrouterStream(model, messages, x, out) {
  const key = String(getSettings().openRouterApiKey || '').trim();
  const body = { model, messages, stream: true, usage: { include: true } };
  if (x.maxTokens) body.max_tokens = x.maxTokens;
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST', body: JSON.stringify(body), signal: x.guard.signal,
    headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://localhost', 'X-Title': 'UGC Studio' } });
  return _openaiStream(res, out, { usage: null, usd: null, cut: false },
    (j) => (j.usage && j.usage.cost != null ? +j.usage.cost || 0 : null));
}

// Replicate takes one prompt: a conversation goes as its turns in words, the system text apart.
function _transcript(messages) {
  const system = [];
  const turns = [];
  for (const m of messages) {
    const t = _text(m && m.content);
    if (!t) continue;
    if (m.role === 'system') system.push(t);
    else turns.push({ who: m.role === 'assistant' ? 'Assistant' : 'User', t });
  }
  const prompt = turns.length === 1 ? turns[0].t : turns.map(x => x.who + ': ' + x.t).join('\n\n');
  return { prompt, system: system.join('\n\n') };
}

async function _replicateStream(model, messages, x, out) {
  const key = String(getSettings().replicateApiKey || '').trim();
  const auth = { Authorization: 'Bearer ' + key };
  const { prompt, system } = _transcript(messages);
  if (!prompt) throw new Error('nothing to ask');
  const d = _replDialect(model);
  const gpt = String(model || '').startsWith('openai/');
  const input = { prompt };
  if (system) input[d.system] = system;
  if (x.maxTokens) { if (gpt) input.max_completion_tokens = x.maxTokens; else input.max_output_tokens = Math.min(65535, x.maxTokens); }
  if (x.effort) { if (gpt) input.reasoning_effort = x.effort; else if (_twoLevel(x.effort)) input.thinking_level = _twoLevel(x.effort); }
  // The create is not aborted: dropped halfway, the prediction could run with nobody holding its id.
  const r0 = await fetch(`https://api.replicate.com/v1/models/${model}/predictions`, {
    method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ input, stream: true }) });
  const p = await r0.json().catch(() => ({}));
  if (!r0.ok || !p.id) throw Object.assign(new Error(String(p.detail || p.title || ('HTTP ' + r0.status)).slice(0, 300)), { status: r0.status });
  const cancel = () => fetch(`https://api.replicate.com/v1/predictions/${p.id}/cancel`, { method: 'POST', headers: auth }).catch(() => {});
  let text = '';
  let failed = '';
  try {
    const su = p.urls && p.urls.stream;
    if (su) {
      const s = await fetch(su, { headers: { Accept: 'text/event-stream', 'Cache-Control': 'no-store' }, signal: x.guard.signal });
      for await (const ev of _sse(s.body)) {
        if (ev.event === 'output' && ev.data) {
          // A piece that repeats the text so far is the whole text again.
          if (text.length >= 20 && ev.data.length >= text.length && ev.data.startsWith(text.slice(0, 20))) { text = ev.data; out.replace(text); }
          else { text += ev.data; out.delta(ev.data); }
        } else if (ev.event === 'error') { failed = ev.data || 'the model failed'; break; }
        else if (ev.event === 'done') break;
      }
      // Leaving the loop closes the stream - it would stay open a minute after `done`.
    }
    // The prediction as it ended: its output is the text kept.
    let fin = {};
    for (let i = 0; i < 120; i++) {
      fin = await fetch(`https://api.replicate.com/v1/predictions/${p.id}`, { headers: auth, signal: x.guard.signal }).then(r => r.json()).catch((e) => { if (x.guard.signal.aborted) throw e; return {}; });
      if (fin.status === 'succeeded' || fin.status === 'failed' || fin.status === 'canceled') break;
      await _sleep(1000, x.guard.signal);
    }
    if (fin.status !== 'succeeded') throw new Error(String(failed || fin.error || ('prediction ' + (fin.status || 'did not finish'))).slice(0, 300));
    const final = String(Array.isArray(fin.output) ? fin.output.join('') : (fin.output || ''));
    if (final.trim() && final !== text) out.replace(final);
    const met = fin.metrics || {};
    return { usage: { in: +met.token_input_count || 0, out: +(met.token_output_count || met.output_token_count) || 0 }, usd: null, cut: false };
  } catch (e) {
    if (x.guard.signal.aborted) await cancel();
    throw e;
  }
}

async function _anthropicStream(model, messages, x, out) {
  const C = require('./claude');
  const m = C.fromOpenAI(messages);
  try {
    const r = await C.stream({ model, system: m.system, messages: m.messages, effort: x.effort || 'low', maxTokens: x.maxTokens || 16000,
      signal: x.guard.signal }, (t) => out.delta(t));
    const u = r.usage || {};
    return { usage: { in: +u.input_tokens || 0, out: +u.output_tokens || 0, cacheRead: +u.cache_read_input_tokens || 0,
                      cacheWrite: +u.cache_creation_input_tokens || 0 }, usd: r.usd, cut: !!r.cut };
  } catch (e) {
    // The package's own errors carry their words in `error`.
    if (e && e.error && e.error.error && e.error.error.message) e.message = e.error.error.message;
    throw e;
  }
}

const STREAM = { kie: _kieStream, replicate: _replicateStream, anthropic: _anthropicStream, openrouter: _openrouterStream };

const _whyOf = (e) => String((e && e.response && e.response.data && ((e.response.data.error && e.response.data.error.message)
  || e.response.data.msg || e.response.data.detail)) || (e && e.message) || 'failed').slice(0, 200);

/**
 * One answer, written as it comes. `messages` OpenAI-shaped (words only). `o`:
 *   step        { provider, model } - asked first; then the ladder, while nothing is written
 *   onStep(step)       a step is about to be asked
 *   onDelta(piece)     a piece of the text; onReplace(text) - the whole text so far, written anew (Replicate)
 *   signal      a cancel: the answer ends where it is (`stopped`)
 *   effort      low by default; maxTokens; firstMs (90 s) - the wait for the first word; timeout (5 min) - the whole answer
 * -> { text, by, tried, usage: { in, out, cacheRead?, cacheWrite? } | null, usd: number | null, cut, stopped, error }
 *    `usd` null where the aggregator says no price.
 */
async function stream(messages, opts) {
  const o = opts || {};
  const msgs = Array.isArray(messages) ? messages : [];
  const x = { timeout: o.timeout || 300000, firstMs: o.firstMs || 90000, effort: o.effort || 'low',
              maxTokens: o.maxTokens > 0 ? Math.round(o.maxTokens) : 0 };
  const steps = [];
  if (o.step && _modelOf(o.step)) steps.push({ provider: o.step.provider, model: o.step.model });
  for (const s of ladder()) if (!steps.some(t => t.provider === s.provider && t.model === s.model)) steps.push(s);
  const tried = [];
  for (const step of steps) {
    if (o.signal && o.signal.aborted) return { text: '', by: null, tried, usage: null, usd: null, stopped: true };
    const who = step.provider + '/' + step.model;
    const off = offWhy(step.provider);
    if (off) { tried.push(who + ' - skipped, ' + off); continue; }
    const g = _guard({ timeout: x.timeout, firstMs: x.firstMs, signal: o.signal });
    let text = '';
    const out = {
      delta: (t) => { if (!t) return; g.word(); text += t; if (o.onDelta) o.onDelta(t); },
      replace: (t) => { g.word(); text = String(t || ''); if (o.onReplace) o.onReplace(text); },
    };
    if (o.onStep) o.onStep(step);
    try {
      const r = await STREAM[step.provider](step.model, msgs, Object.assign({}, x, { guard: g }), out);
      g.end();
      if (g.why()) throw new Error(g.why());
      if (!text.trim()) { tried.push(who + ' - answered nothing'); continue; }
      return { text, by: step, tried: tried.concat(who), usage: r.usage || null, usd: r.usd != null ? r.usd : null, cut: !!r.cut };
    } catch (e) {
      g.end();
      const usd = e && e.usd != null ? e.usd : null;
      if (g.why() === 'cancelled' || (o.signal && o.signal.aborted)) {
        return { text, by: text ? step : null, tried, usage: null, usd, stopped: true };
      }
      const why = g.why() || _whyOf(e);
      tried.push(who + ' - ' + why);
      console.warn('[agents] stream', who, 'failed:', why);
      if (text.trim()) return { text, by: step, tried, usage: null, usd, error: why };
    }
  }
  return { text: '', by: null, tried, usage: null, usd: null, error: tried.length ? 'no model answered' : 'no model can be asked - add a key on Admin -> API keys' };
}

module.exports = { FILE, MAX_STEPS, PROVIDERS, DEFAULT, ladder, setLadder, offWhy, state, ask, watches, stream, labelOf };
