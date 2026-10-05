'use strict';

// ════════════════════════════════════════════════════════════════════════════
// MERGE — the one that reads what was said and writes what the model wants to hear.
//
// It does ONE thing in two directions: turn a message and its attachments into a prompt for the
// model that was chosen - `think`, for a picture (Animate's `thinkMotion`, which wrote a video's motion and put
// every spoken line into English, went with Animate in phase C4). It does not decide whether to generate, it does not choose the
// model, and it does not invent a subject. The almanac decides HOW to write - this decides
// nothing at all except the wording.
//
// ── Why it is worth the extra call ──────────────────────────────────────────
// The six models do not want the same shape of sentence, and the differences are not
// stylistic: Gemini asks for narrative prose while OpenAI asks for labelled lines, and Seedream
// needs to be asked for flaws or it returns plastic. A person should not have to hold six rule
// sets in their head to type one sentence.
//
// ── What it is NOT allowed to do ────────────────────────────────────────────
// Add a subject, a place or a mood nobody asked for. That is the failure this whole layer is
// one step away from: a rewrite that improves the prompt into a different picture. The
// instruction says so in as many words, and the result is stored beside the original so a
// picture that came out wrong can be argued with rather than guessed about.
//
// ── The numbers rule ────────────────────────────────────────────────────────
// With two or more references attached, a message that never says which is which leaves the
// model to guess - and it guesses badly. Whether the numbers were described is arithmetic, not
// judgement, so it is counted here rather than asked of a model: cheaper, instant, and it gives
// the same answer twice.
// ════════════════════════════════════════════════════════════════════════════

const axios = require('axios');
const { parseLooseJson, kieHeaders } = require('./helpers');
const { getSettings } = require('./settings-io');
const RULES = require('./mv3-prompt-rules');
const SET = require('./mv3-settings');
const FAKE = require('./fake-agg');

// Below this share of the attached pictures being mentioned, the agent asks instead of guessing.
const COVERAGE = 0.3;
// The rule is pointless with one picture: "make it night" with a single reference is perfectly
// clear, and asking "which one?" of one picture is the machine being obtuse.
const ASK_FROM = 2;

// Words that mean a number, in the two languages this app is used in. Ordinals only up to five -
// past that people use digits.
const WORDS = [
  ['1', 'first', 'первое', 'первая', 'первый', 'перв'],
  ['2', 'second', 'второе', 'вторая', 'второй', 'втор'],
  ['3', 'third', 'третье', 'третья', 'третий', 'трет'],
  ['4', 'fourth', 'четвёртое', 'четвертое', 'четвёртая', 'четвертый', 'четверт'],
  ['5', 'fifth', 'пятое', 'пятая', 'пятый', 'пят'],
];

/**
 * Which of the attached pictures the message actually refers to.
 *
 * Digits first, because that is what the numbered badges above the input invite. Words after,
 * because people write "on the second one" as readily as "on 2".
 */
function mentioned(text, n) {
  const t = String(text || '').toLowerCase();
  const hit = [];
  for (let i = 1; i <= n; i++) {
    const forms = WORDS[i - 1] || [String(i)];
    const found = forms.some((w, k) => (k === 0
      // A bare digit, not part of a longer number or a word: "2" yes, "1920s" no.
      ? new RegExp('(^|[^\\d\\w])' + w + '([^\\d\\w]|$)').test(t)
      : t.includes(w)));
    if (found) hit.push(i);
  }
  return hit;
}

function needsNumbers(text, n) {
  if (!n || n < ASK_FROM) return false;
  return (mentioned(text, n).length / n) < COVERAGE;
}

// The question asked when they are not described. Fixed wording rather than a generated one: it
// is the same question every time, and paying a model to phrase it differently each time would
// buy nothing.
function numbersQuestion(text, n) {
  const has = mentioned(text, n);
  const missing = [];
  for (let i = 1; i <= n; i++) if (!has.includes(i)) missing.push(i);
  return has.length
    ? 'You have ' + n + ' pictures attached but only mentioned '
      + has.map(i => '#' + i).join(', ') + '. What should I take from '
      + missing.map(i => '#' + i).join(' and ') + '?'
    : 'There are ' + n + ' pictures attached. Say which is which by number - '
      + 'what should come from #1, what from #2 - and I will make it.';
}

// THE LAST THING THEY SAID, and nothing else.
//
// It began as six turns, which is how a request from three generations ago ends up in today's
// picture: the writer reads the history as part of the brief and folds it in. Something asked
// for once and finished with is not a standing instruction.
//
// One line is enough because the CONTINUITY HERE IS THE PICTURES, not the words. Whatever the
// next message is about is attached above the input - the result of the last generation puts
// itself there, and anything else is one click from the column on the right. So the only job
// left for the text is resolving "the same", "it" or "again", and for that the previous message
// is all there is to resolve against.
function _recent(thread) {
  const said = (Array.isArray(thread) ? thread : [])
    .filter(m => m && m.role === 'user' && String(m.text || '').trim().length > 12);
  const last = said[said.length - 1];
  return last ? 'They said: ' + String(last.text).trim() : '';
}

// ── One rung of the analyst's ladder ────────────────────────────────────────
// Written here rather than borrowed from the helpers' cascade (callAIVisionWithFallback): ask it
// for one model and it answers with whatever it reaches, which is exactly the thing a ladder
// exists to make visible. One rung, one aggregator, one model, one answer or nothing.
//
// `images` are public URLs, and both rungs LOOK at them - in the same call that writes the
// prompt, not a second one. The two aggregators want them in different shapes: kie takes the
// OpenAI vision array, Replicate takes an `images` input. Both were proved against a hosted
// photograph, which each described correctly (2026-09-13).
async function _rung(rung, messages, images) {
  const pics = (images || []).filter(Boolean);
  // LOOKING TAKES LONGER THAN READING. Forty-five seconds was enough for a sentence and not for
  // two photographs: the first rung timed out at exactly 45s on a real two-reference message and
  // the whole thing fell to the second aggregator for no reason but the clock.
  const timeout = pics.length ? 90000 : 45000;
  if (rung.provider === 'kie') {
    // Each kie text model lives at its own endpoint rather than being named in the body.
    // The pictures ride with the LAST user message, which is the one describing them.
    const body = !pics.length ? messages : messages.map((m, i) => {
      if (m.role !== 'user' || i !== messages.length - 1) return m;
      return { role: 'user', content: [{ type: 'text', text: m.content }]
        .concat(pics.map(u => ({ type: 'image_url', image_url: { url: u } }))) };
    });
    const r = await axios.post(
      'https://api.kie.ai/' + rung.model + '/v1/chat/completions',
      { stream: false, messages: body },
      { headers: kieHeaders(), timeout });
    // A REFUSAL ARRIVES INSIDE A 200. "The model is not supported" comes back with the envelope
    // saying so and the status saying nothing - read the choices first and a dead model looks
    // exactly like a shy one, which is how a rung stays broken for a week.
    const env = r.data || {};
    if (env.code != null && Number(env.code) !== 200) throw new Error(env.msg || ('code ' + env.code));
    return String(((env.choices || [{}])[0].message || {}).content || '').trim();
  }
  if (rung.provider === 'replicate') {
    // Not a chat API at all: one prompt in, one string out, and the system half goes in a field
    // whose name depends on who made the model. `Prefer: wait` blocks until it is done rather
    // than handing back an id to poll - an answer takes a few seconds, so waiting is simpler.
    const rkey = (getSettings().replicateApiKey || '').trim();
    if (!rkey) throw new Error('no Replicate key');
    const sys = messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n');
    const said = messages.filter(m => m.role !== 'system').map(m => m.content).join('\n\n');
    const input = { prompt: said };
    input[String(rung.model).startsWith('openai/') ? 'system_prompt' : 'system_instruction'] = sys;
    if (pics.length) input.images = pics;
    const r = await axios.post(
      'https://api.replicate.com/v1/models/' + rung.model + '/predictions',
      { input },
      { headers: { Authorization: 'Bearer ' + rkey, 'Content-Type': 'application/json', Prefer: 'wait=60' },
        timeout });
    let p = r.data || {};
    const deadline = Date.now() + timeout;
    while ((p.status === 'starting' || p.status === 'processing') && Date.now() < deadline) {
      await new Promise(x => setTimeout(x, 2000));
      p = (await axios.get('https://api.replicate.com/v1/predictions/' + p.id,
        { headers: { Authorization: 'Bearer ' + rkey }, timeout: 20000 })).data || {};
    }
    if (p.status !== 'succeeded') throw new Error(p.status + ': ' + String(p.error || '').slice(0, 90));
    // The output arrives as a run of chunks as often as one string.
    return String(Array.isArray(p.output) ? p.output.join('') : (p.output || '')).trim();
  }

  const key = (getSettings().openRouterApiKey || '').trim();
  if (!key) throw new Error('no OpenRouter key');
  const r = await axios.post(
    'https://openrouter.ai/api/v1/chat/completions',
    { model: rung.model, messages, stream: false },
    {
      headers: {
        Authorization: 'Bearer ' + key, 'Content-Type': 'application/json',
        'HTTP-Referer': 'https://localhost:3000', 'X-Title': 'UGC Merge',
      },
      timeout,
    });
  return String(((r.data || {}).choices || [{}])[0].message.content || '').trim();
}

/**
 * The ladder, in order, until one of them says something.
 *
 * An empty answer counts as a refusal: a rung that returns nothing has not written a prompt,
 * and treating "" as success would send the picture model an empty brief.
 */
async function _write(messages, images, opts) {
  const chain = (SET.writer().chain || []);
  const tried = [];
  // The video writer (phase V2) steps over a rung whose aggregator has no key or refused it at the last check,
  // instead of spending a timeout on an empty Bearer. The pictures' writer is left as it was.
  const skipDead = !!(opts && opts.skipDead);
  for (const rung of chain) {
    if (skipDead && (rung.provider === 'kie' || rung.provider === 'replicate')) {
      const K = require('./agg-keys');
      if (!K.keyed(rung.provider) || K.down(rung.provider)) { tried.push(rung.provider + '/' + rung.model + ' (no key)'); continue; }
    }
    tried.push(rung.provider + '/' + rung.model);
    try {
      const raw = await _rung(rung, messages, images);
      if (raw) {
        if (tried.length > 1) console.log('[mv3-agent] fell to', rung.model, 'after', tried.slice(0, -1).join(', '));
        return { raw, by: rung };
      }
      console.warn('[mv3-agent]', rung.model, 'answered nothing');
    } catch (e) {
      console.warn('[mv3-agent]', rung.model, 'refused:', (e.response && e.response.status) || e.message);
    }
  }
  return { raw: '', by: null, tried };
}

/**
 * Read the message, write the prompt.
 *
 * Returns one of:
 *   { ask }                             a question, and nothing was generated
 *   { prompt, aspect?, quality?, raw }   the prompt to send, and what was typed beside it
 *
 * A failure here NEVER blocks the picture: if the model is unreachable or answers nonsense, the
 * original words go through unchanged and `fell` says so. Polishing is a convenience, and a
 * convenience that can stop the work is not one.
 */
async function think(opts) {
  const o = opts || {};
  const text = String(o.text || '').trim();
  // The pictures themselves, as public URLs, in the order they are numbered above the input.
  // The count still matters on its own - the numbers rule below is arithmetic and runs before
  // anything is asked of a model - but the analyst now SEES them.
  const pics = (Array.isArray(o.refUrls) ? o.refUrls : []).filter(Boolean);
  const refs = pics.length || (+o.refs || 0);
  const engine = String(o.engine || '');
  const rule = RULES.rulesFor(engine);

  if (!text) throw new Error('nothing was said');
  if (needsNumbers(text, refs)) return { ask: numbersQuestion(text, refs) };
  // The fake aggregator's analyst (phase V0): the numbers rule above is arithmetic and stays real.
  if (FAKE.on()) return FAKE.think(text);
  if (!rule) return { prompt: text, raw: text, fell: 'no rule for ' + engine };

  const system = RULES.systemFor(engine, { refs });
  const envelope = [
    'Answer as ONE json object and nothing else.',
    '{"prompt": "<the finished prompt>"',
    o.aspects && o.aspects.length ? ', "aspect": "<one of: ' + o.aspects.join(', ') + '>"' : '',
    o.tiers && o.tiers.length ? ', "quality": "<one of: ' + o.tiers.join(', ') + '>"' : '',
    '}',
    'Include "aspect" or "quality" ONLY if the person actually said something about the shape or',
    'the size of the picture. If they did not, leave them out - the panel has their own settings',
    'and yours would overwrite a deliberate choice.',
  ].filter(Boolean).join(' ');

  const context = _recent(o.thread);
  const user = [
    // Framed as hard as it can be framed. The failure this prevents is real and was measured: a
    // "put it on his shoulder" from three generations earlier reappearing in a picture that had
    // nothing to do with shoulders.
    context ? 'FOR REFERENCE ONLY, the previous message. Use it ONLY to work out what words like'
      + ' "it", "the same", "again" or "that one" point at. NEVER carry anything from it into the'
      + ' new picture: if the new message does not mention a thing, that thing is NOT in the'
      + ' picture, however recently it was asked for.\n' + context + '\n' : '',
    refs ? 'There ' + (refs === 1 ? 'is 1 picture' : 'are ' + refs + ' pictures')
      + ' attached, numbered from 1. This is an edit of what is attached.\n' : '',
    'What they want now:\n' + text,
  ].filter(Boolean).join('\n');

  // Down the writer's own ladder. Merge's, not the app's: this is the one call in the pipeline
  // whose taste shows in every picture.
  const messages = [
    { role: 'system', content: system + '\n\n' + envelope },
    { role: 'user', content: user },
  ];
  const wrote = await _write(messages, pics);
  if (!wrote.raw) {
    return { prompt: text, raw: text, fell: 'every writer refused (' + (wrote.tried || []).join(', ') + ')' };
  }
  const raw = wrote.raw;

  const j = parseLooseJson(raw);
  const written = j && typeof j.prompt === 'string' ? j.prompt.trim() : '';
  if (!written) return { prompt: text, raw: text, fell: 'the writer answered with nothing usable' };

  // The cap is the model's, and a prompt over it is refused by the aggregator rather than
  // trimmed - so it is trimmed here, at a sentence, rather than mid-word.
  let prompt = written;
  if (rule.maxChars && prompt.length > rule.maxChars) {
    const cut = prompt.slice(0, rule.maxChars);
    const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
    prompt = (stop > rule.maxChars * 0.6 ? cut.slice(0, stop + 1) : cut).trim();
  }
  if (rule.suffix && !prompt.endsWith(rule.suffix.trim())) prompt += rule.suffix;

  const out = { prompt, raw: text, writer: wrote.by ? wrote.by.model : '' };
  // Only what they actually asked for - see the envelope note.
  if (j.aspect && (o.aspects || []).includes(j.aspect)) out.aspect = j.aspect;
  if (j.quality && (o.tiers || []).includes(j.quality)) out.quality = j.quality;
  return out;
}


// ── The video writer (phase V2, docs/local-app/PLAN.md "V-E 6") ──────────────
// One call: the message, what is attached (listed in the order their neutral names count), the pictures
// themselves for it to SEE, the model's rules (lib/mv3-video-rules.js) and a recipe when a catalog skill was
// used. It answers a prompt with neutral references, or a question.
//
// No silent fallback into money: when no writer answers, the words go as typed ONLY if they are already
// English - a prompt in another language sent to a model that reads English pays for a misunderstanding.
// "English" here means: no letter of another script outside quoted speech (emoji, digits and marks are fine).
const _english = (s) => !/(?!\p{Script=Latin})\p{L}/u.test(String(s || '').replace(/"[^"]*"|«[^»]*»/g, ''));

async function thinkVideo(opts) {
  const o = opts || {};
  const text = String(o.text || '').trim();
  if (!text) throw new Error('nothing was said');
  const VR = require('./mv3-video-rules');
  if (FAKE.on()) {
    await new Promise(r => setTimeout(r, 1500));
    if (/\?ask\b/.test(text)) return { ask: 'Fake writer: which attachment is the person? (?ask in the message)' };
    return { prompt: '[fake] ' + text, writer: 'fake writer' };
  }
  if (!VR.rulesFor(o.model)) return { prompt: text, fell: 'no rules for ' + o.model };
  const media = Array.isArray(o.media) ? o.media : [];
  const system = VR.systemFor(o.model, { skill: o.skill, params: o.params, max: o.max }) + '\n\n' + VR.ENVELOPE;
  const context = _recent(o.thread);
  const user = [
    context ? 'FOR REFERENCE ONLY, the previous message - use it only to resolve words like "it" or "the same":\n' + context + '\n' : '',
    media.length ? 'Attached, in order:\n' + VR.listing(media) + '\n' : 'Nothing is attached.\n',
    'What they want:\n' + text,
  ].filter(Boolean).join('\n');
  const wrote = await _write([{ role: 'system', content: system }, { role: 'user', content: user }], o.picUrls || [], { skipDead: true });
  if (!wrote.raw) {
    if (_english(text)) return { prompt: text, fell: 'no writer answered (' + (wrote.tried || []).join(', ') + ') - sent as typed' };
    return { fail: 'no writer answered (' + (wrote.tried || []).join(', ') + '), and the message is not in English - nothing was sent' };
  }
  const j = parseLooseJson(wrote.raw);
  if (j && typeof j.ask === 'string' && j.ask.trim()) return { ask: j.ask.trim() };
  let prompt = j && typeof j.prompt === 'string' ? j.prompt.trim() : '';
  if (!prompt) {
    if (_english(text)) return { prompt: text, fell: 'the writer answered nothing usable - sent as typed' };
    return { fail: 'the writer answered nothing usable, and the message is not in English - nothing was sent' };
  }
  if (o.max && prompt.length > o.max) {
    const cut = prompt.slice(0, o.max);
    const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
    prompt = (stop > o.max * 0.6 ? cut.slice(0, stop + 1) : cut).trim();
  }
  return { prompt, writer: wrote.by ? wrote.by.model : '' };
}

/** Kling motion control's prompt, which no writer touches: English words go as typed, others are translated. */
async function toEnglish(text) {
  const t = String(text || '').trim();
  if (!t || _english(t)) return { text: t, translated: false };
  if (FAKE.on()) return { text: '[fake translation] ' + t, translated: true };
  const VR = require('./mv3-video-rules');
  const wrote = await _write([{ role: 'system', content: VR.TRANSLATE }, { role: 'user', content: t }], [], { skipDead: true });
  const out = String(wrote.raw || '').replace(/^```[a-z]*\s*|```$/gi, '').trim();
  if (!out) return { fail: 'the prompt is not in English and no writer could translate it (' + (wrote.tried || []).join(', ') + ') - write it in English' };
  return { text: out, translated: true };
}

module.exports = { think, thinkVideo, toEnglish, english: _english, mentioned, needsNumbers, numbersQuestion, COVERAGE, ASK_FROM };
