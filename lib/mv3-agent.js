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

const { parseLooseJson } = require('./helpers');
const RULES = require('./mv3-prompt-rules');
const AGENTS = require('./agents');
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

// ── The ladder ──────────────────────────────────────────────────────────────
// (phase V25) The agents' ladder of lib/agents.js - Admin -> AI settings: the writers' own ladder and its transport
// went into it, with the vision ladder New Character and the talking head read pictures with. `images` are public
// URLs (or data: URIs), LOOKED AT in the same call that writes the prompt; they ride with the last user message.
// `{ raw, by, tried }` - an empty answer counts as a refusal: "" sent to a picture model is an empty brief. A step
// whose aggregator has no key, or had it refused at the last check, is stepped over for every writer.
const _write = (messages, images) => AGENTS.ask(messages, { images });

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
// "English" here means: no letter of another script (emoji, digits and marks are fine) - quoted speech included
// since phase V29 (the owner 2026-10-14: everything said is English; spoken words were kept as typed before).
const _english = (s) => !/(?!\p{Script=Latin})\p{L}/u.test(String(s || ''));

// (phase V8) The storyboard prompt's field on the card (lib/mv3-chat.js keeps 6000).
const BOARD_FIELD = 6000;
// Control characters left raw INSIDE the string literals of an answer, escaped - outside them they are only spacing.
function _escapeRaw(raw) {
  const s = String(raw || '');
  let out = '', inStr = false, esc = false;
  for (const ch of s) {
    if (inStr) {
      if (esc) { esc = false; out += ch; continue; }
      if (ch === '\\') { esc = true; out += ch; continue; }
      if (ch === '"') { inStr = false; out += ch; continue; }
      const c = ch.charCodeAt(0);
      if (c < 0x20) { out += ch === '\n' ? '\\n' : ch === '\r' ? '\\r' : ch === '\t' ? '\\t' : '\\u' + c.toString(16).padStart(4, '0'); continue; }
      out += ch;
      continue;
    }
    if (ch === '"') inStr = true;
    out += ch;
  }
  return out;
}

// A storyboard's prompt as the writer answered it: a sheet written as a list of panels is read as its lines; one over the
// card's field is cut at a sentence, never in a word. '' when there is none.
function _boardOf(j) {
  const raw = j && Array.isArray(j.board) ? j.board.map(x => (typeof x === 'string' ? x : x && typeof x === 'object' ? Object.values(x).join(' - ') : '')).filter(Boolean).join('\n')
    : (j && typeof j.board === 'string' ? j.board : '');
  let board = raw.trim();
  if (board.length > BOARD_FIELD) {
    const cut = board.slice(0, BOARD_FIELD);
    const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('.\n'), cut.lastIndexOf('\n'));
    board = (stop > BOARD_FIELD * 0.6 ? cut.slice(0, stop + 1) : cut).trim();
  }
  return board;
}
function _boardAspectOf(j) {
  const VR = require('./mv3-video-rules');
  return j && VR.BOARD_ASPECTS.includes(String(j.boardAspect || '').trim()) ? String(j.boardAspect).trim() : '';
}

async function thinkVideo(opts) {
  const o = opts || {};
  const text = String(o.text || '').trim();
  if (!text) throw new Error('nothing was said');
  const VR = require('./mv3-video-rules');
  // (phase V6) The builder: the text is a recipe's request with its places filled in. The person reads what comes
  // back before anything is made, so there is no question and no falling back to the words - a request is not a
  // prompt: without an answer the card fails, in words, and is written again.
  const recipe = !!o.recipe;
  // (phase V8) Two steps: the storyboard sheet's prompt and shape too, the sheet being the last picture of the video.
  const two = recipe && !!o.twoStep;
  const k = (Array.isArray(o.media) ? o.media : []).filter(m => m.kind === 'image').length + 1;
  // (phase V15) The column's storyboard: the sheet's prompt alone, before the video - never a question, never the words
  // sent as typed (a message is not a sheet's prompt).
  const boardOnly = !recipe && !!o.boardOnly;
  // (phase V16) The writer stopping for a look: a prompt the person reads and edits - never a question, and without an
  // answer the card fails in words (nothing is sent as typed: the person is waiting for a prompt to look at).
  const review = !recipe && !boardOnly && !!o.review;
  // (phase V15) A plain message whose pictures hold its storyboard sheet: the video follows it.
  const sheetAt = two || boardOnly ? 0 : (Array.isArray(o.media) ? o.media : []).filter(m => m.kind === 'image').findIndex(m => m.role === 'storyboard') + 1;
  // (phase V16) Seedance's frames ({ kind, first, last, asRefs } - routes/mv3-video.js _framesOf): the animation from the
  // first frame (to the last) - never a question, and without an answer nothing is sent (the frames need the writer).
  const frames = !recipe && !boardOnly && o.frames && o.frames.kind ? o.frames : null;
  const sure = recipe || review || !!frames;
  if (FAKE.on()) {
    await new Promise(r => setTimeout(r, /\?slow\b/.test(text) ? 9000 : 1500));
    if (boardOnly) {
      return /\?fail\b/.test(text) ? { fail: 'Fake writer: it could not write the storyboard (?fail in the message)' }
        : { board: '[fake board] 9 numbered panels: ' + text, boardAspect: '16:9', writer: 'fake writer' };
    }
    if (sure && /\?fail\b/.test(text)) return { fail: 'Fake writer: it could not write this one (?fail in the request)' };
    if (!sure && /\?ask\b/.test(text)) return { ask: 'Fake writer: which attachment is the person? (?ask in the message)' };
    const refs = (Array.isArray(o.media) ? o.media : []).filter(m => m.kind === 'image').map((m, i) => '{{image:' + (i + 1) + '}}').join(', ');
    if (two) {
      return { board: '[fake board] 9 numbered panels: ' + text, boardAspect: '16:9', writer: 'fake writer',
               prompt: '[fake] Follow the storyboard {{image:' + k + '}} panel by panel.' + (refs ? ' The people from ' + refs + '.' : '') };
    }
    return { prompt: '[fake] ' + text + (recipe && refs ? ' With ' + refs + '.' : ''), writer: 'fake writer' };
  }
  if (!VR.rulesFor(o.model)) return recipe ? { fail: 'no writer rules for ' + o.model } : { prompt: text, fell: 'no rules for ' + o.model };
  const media = Array.isArray(o.media) ? o.media : [];
  const system = VR.systemFor(o.model, { skill: boardOnly ? null : o.skill, params: o.params, media, max: boardOnly ? 0 : o.max, recipe, twoStep: two, boardIndex: k, boardOnly, sheetAt, frames }) + '\n\n'
    + (boardOnly ? VR.ENVELOPE_BOARD : two ? VR.ENVELOPE_TWO_STEP : recipe ? VR.ENVELOPE_RECIPE : review ? VR.ENVELOPE_REVIEW : frames ? VR.ENVELOPE_FRAMES : VR.ENVELOPE);
  const context = recipe ? '' : _recent(o.thread);
  // (review V8) The sheet has its line among the attachments: the number the video prompt must give it, said once more.
  const sheet = two ? '{{image:' + k + '}} - the storyboard sheet you are writing now (step 1); it goes to the video after the pictures above' : '';
  const user = [
    context ? 'FOR REFERENCE ONLY, the previous message - use it only to resolve words like "it" or "the same":\n' + context + '\n' : '',
    media.length || sheet ? 'Attached, in order:\n' + [media.length ? VR.listing(media, o.seen) : '', sheet].filter(Boolean).join('\n') + '\n' : 'Nothing is attached.\n',
    (recipe ? 'Their request, the recipe\'s places filled in:\n' : boardOnly ? 'What they want - the clip the storyboard is for:\n' : 'What they want:\n') + text,
  ].filter(Boolean).join('\n');
  const wrote = await _write([{ role: 'system', content: system }, { role: 'user', content: user }], o.picUrls || []);
  if (!wrote.raw) {
    if (sure || boardOnly) return { fail: 'no writer answered (' + (wrote.tried || []).join(', ') + ') - nothing was ' + (boardOnly ? 'drawn' : 'made') + '; write it again' };
    if (_english(text)) return { prompt: text, fell: 'no writer answered (' + (wrote.tried || []).join(', ') + ') - sent as typed' };
    return { fail: 'no writer answered (' + (wrote.tried || []).join(', ') + '), and the message is not in English - nothing was sent' };
  }
  // A prompt of several lines often comes back with its line breaks raw inside the JSON string (review V8: a storyboard
  // is a list of panels) - read again with them escaped before the answer is called unusable.
  const j = parseLooseJson(wrote.raw) || parseLooseJson(_escapeRaw(wrote.raw));
  if (boardOnly) {
    if (j && typeof j.ask === 'string' && j.ask.trim() && !_boardOf(j)) return { fail: 'the writer asked instead of writing: ' + j.ask.trim().slice(0, 300) };
    const board = _boardOf(j);
    if (!board) return { fail: 'the writer did not write the storyboard - write it again' };
    return { board, boardAspect: _boardAspectOf(j), writer: wrote.by ? wrote.by.model : '' };
  }
  if (j && typeof j.ask === 'string' && j.ask.trim()) {
    if (sure) return { fail: 'the writer asked instead of writing: ' + j.ask.trim().slice(0, 300) };
    return { ask: j.ask.trim() };
  }
  let prompt = j && typeof j.prompt === 'string' ? j.prompt.trim() : '';
  if (!prompt) {
    if (sure) return { fail: 'the writer answered nothing usable - write it again' };
    if (_english(text)) return { prompt: text, fell: 'the writer answered nothing usable - sent as typed' };
    return { fail: 'the writer answered nothing usable, and the message is not in English - nothing was sent' };
  }
  if (o.max && prompt.length > o.max) {
    const cut = prompt.slice(0, o.max);
    const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
    prompt = (stop > o.max * 0.6 ? cut.slice(0, stop + 1) : cut).trim();
  }
  if (two) {
    // A two-step answer without its sheet is no answer: the card fails in words, and is written again.
    const board = _boardOf(j);
    if (!board) return { fail: 'the writer did not write the storyboard - write it again' };
    return { prompt, board, boardAspect: _boardAspectOf(j), writer: wrote.by ? wrote.by.model : '' };
  }
  return { prompt, writer: wrote.by ? wrote.by.model : '' };
}

/**
 * (phase V17, the owner 2026-10-08) Kling motion control's FIRST FRAME: the picture prompt from the still of the clip
 * ({{video:1}}), the person's pictures ({{image:1}}...) and their words - what to take from which, or nothing. The
 * writer sees the still and the pictures in that order. { prompt, writer } or { fail } - never a question: the person
 * reads the prompt before anything is drawn.
 */
async function thinkFrame(opts) {
  const o = opts || {};
  const n = Math.max(0, Math.round(+o.pictures || 0));
  const text = String(o.text || '').trim();
  if (FAKE.on()) {
    await new Promise(r => setTimeout(r, /\?slow\b/.test(text) ? 9000 : 1500));
    if (/\?fail\b/.test(text)) return { fail: 'Fake writer: it could not write the first frame (?fail in the message)' };
    const refs = Array.from({ length: n }, (x, i) => '{{image:' + (i + 1) + '}}').join(', ');
    return { prompt: '[fake frame] The character from ' + (refs || 'the pictures') + ' in the exact pose of {{video:1}}.' + (text ? ' ' + text : ''), writer: 'fake writer' };
  }
  const VR = require('./mv3-video-rules');
  const seen = o.seen || {};
  const lines = ['{{video:1}} - the still of the clip at the moment chosen: the POSE, the framing, the camera' + (seen.still === false ? ' (you cannot see it: work from the words)' : '')];
  for (let i = 1; i <= n; i++) lines.push('{{image:' + i + '}} - the person\'s picture ' + i + (seen.pics === false ? ' (you cannot see it)' : ''));
  const user = ['Attached, in the order you see them:', ...lines, '',
    text ? 'What they said:\n' + text : '(They said nothing - work out each picture\'s job from what it shows.)'].join('\n');
  const wrote = await _write([{ role: 'system', content: VR.FRAME_RULES + '\n\n' + VR.ENVELOPE_FRAME }, { role: 'user', content: user }], o.picUrls || []);
  if (!wrote.raw) return { fail: 'no writer answered (' + (wrote.tried || []).join(', ') + ') - nothing was drawn; write it again' };
  const j = parseLooseJson(wrote.raw) || parseLooseJson(_escapeRaw(wrote.raw));
  let prompt = j && typeof j.prompt === 'string' ? j.prompt.trim() : '';
  if (!prompt) return { fail: 'the writer answered nothing usable - write it again' };
  // The card keeps 6000 characters of a picture's prompt; one longer is cut at a sentence, never in a word.
  if (prompt.length > 5000) {
    const cut = prompt.slice(0, 5000);
    const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
    prompt = (stop > 3000 ? cut.slice(0, stop + 1) : cut).trim();
  }
  return { prompt, writer: wrote.by ? wrote.by.model : '' };
}

/** A prompt no writer touches (Kling motion control's with the writer off, an edited card, a prompt typed in a field): English
 *  words go as typed, others are translated - quoted speech too (phase V29). { text, translated } or { fail } in words. */
async function toEnglish(text) {
  const t = String(text || '').trim();
  if (!t || _english(t)) return { text: t, translated: false };
  if (FAKE.on()) return { text: '[fake translation] ' + t, translated: true };
  const VR = require('./mv3-video-rules');
  const wrote = await _write([{ role: 'system', content: VR.TRANSLATE }, { role: 'user', content: t }], []);
  const out = String(wrote.raw || '').replace(/^```[a-z]*\s*|```$/gi, '').trim();
  if (!out) return { fail: 'the prompt is not in English and no writer could translate it (' + (wrote.tried || []).join(', ') + ') - write it in English' };
  return { text: out, translated: true };
}

/**
 * (phase V29, the owner 2026-10-14: "набранное переводится") LINES OF A SCRIPT typed in another language - a scenario's
 * lines, a talking head's line edited or put in, a paragraph of the generator -, into spoken English. The lines go in
 * one call, numbered, so a line is translated among its neighbours (who "he" is, what "it" was); only the lines that
 * are not English take the answer - an English line stays as typed. The answer must have every line, each one English:
 * otherwise the lines not in English are asked one at a time. { texts, translated: n } or { fail } in words - nothing
 * half-translated is ever saved.
 */
async function toEnglishLines(texts) {
  const all = (Array.isArray(texts) ? texts : []).map(t => String(t == null ? '' : t));
  const foreign = all.map((t, i) => (t.trim() && !_english(t) ? i : -1)).filter(i => i >= 0);
  if (!foreign.length) return { texts: all, translated: 0 };
  if (FAKE.on()) return { texts: all.map((t, i) => (foreign.includes(i) ? '[fake translation] ' + t : t)), translated: foreign.length };
  const VR = require('./mv3-video-rules');
  const user = all.map((t, i) => '[' + (i + 1) + '] ' + t.replace(/\s*\n\s*/g, ' ')).join('\n');
  const wrote = await _write([{ role: 'system', content: VR.TRANSLATE_LINES }, { role: 'user', content: user }], []);
  const j = parseLooseJson(String(wrote.raw || '').replace(/^```[a-z]*\s*|```$/gi, '').trim());
  const got = j && Array.isArray(j.lines) ? j.lines.map(x => String(x == null ? '' : x).trim()) : null;
  const out = all.slice();
  const left = [];
  for (const i of foreign) {
    const t = got && got.length === all.length ? got[i] : '';
    if (t && _english(t)) out[i] = t; else left.push(i);
  }
  for (const i of left) {
    const one = await toEnglish(all[i]);
    if (one.fail || !one.text || !_english(one.text)) {
      return { fail: 'a line is not in English and could not be translated (' + ((wrote.tried || []).join(', ') || 'no writer answered') + ') - write it in English' };
    }
    out[i] = one.text;
  }
  return { texts: out, translated: foreign.length };
}

/**
 * One look through the agents' ladder (lib/agents.js - kie Gemini 3.8 Flash first, Replicate behind it, unless Admin ->
 * AI settings says otherwise): a
 * system prompt, a request and pictures (public addresses, or data: URIs where nothing can host them), plain text
 * back. The 3D Studio's description of an environment (lib/studio3d-env.js) - a job the owner wanted on Gemini,
 * not on the dearer Claude (2026-10-09). Returns { text, by, tried }; text '' when no rung answered.
 */
async function see(system, text, images) {
  const r = await _write([{ role: 'system', content: system }, { role: 'user', content: text }], images || []);
  return { text: r.raw || '', by: r.by || null, tried: r.tried || [] };
}

// ── The frames chat of a talking head (phase V26.5, routes/scen3-fchat.js) ──
// What each attached picture IS, in the words the model is told - by the place it was put in.
const FRAME_ROLES = {
  character: 'the character reference sheet - several views of ONE person: take only that person (face, hair, body, clothes), never the sheet itself, its panels, its several views or its white backdrop',
  place: 'the place - the location the person is in: its architecture, furniture, colours, depth and light',
  frame: 'the frame being changed - keep everything in it that the words do not change',
  extra: 'an extra picture - what it is and what to take from it is in the words; an object from it is drawn exactly as it looks (shape, colours, labels, real size, no invented lettering)',
  '': 'an extra picture - what it is for is in the words',
};
/** The pictures as the model is told of them, in order: "image 1 is ...". */
function frameListing(roles) {
  return (roles || []).map((r, i) => 'image ' + (i + 1) + ' is ' + (FRAME_ROLES[r] || FRAME_ROLES['']) + '.').join(' ');
}
const LIGHT_RULES = [
  'You turn a person\'s words about ONE photograph - a frame of a talking-head video ad - into a clear prompt for an image model.',
  'Write in English, whatever language the words are in. Keep their meaning exactly: add no object, person, light, mood or camera move they did not ask for.',
  'Say plainly, by number, what is taken from which picture ("image 1", "image 2"...): the pictures are listed below with what each one is.',
  'One paragraph of plain sentences, no lists, no headings.',
  'Answer as ONE json object and nothing else: {"prompt": "<the prompt>"}',
].join('\n');

/**
 * (phase V26.5) The frames chat with the writer OFF (the owner's answer (g)): a light pass - the words into English and the
 * pictures named, nothing more - and the frame is drawn at once. { prompt, writer } or, when no writer answers, the words
 * as typed with our sentence about the pictures ({ prompt, fell }). Never a question.
 */
async function frameLight(opts) {
  const o = opts || {};
  const text = String(o.text || '').trim();
  const roles = Array.isArray(o.roles) ? o.roles : [];
  const listing = frameListing(roles);
  const edge = o.edge ? ' ' + o.edge : '';
  if (FAKE.on()) {
    await new Promise(r => setTimeout(r, /\?slow\b/.test(text) ? 9000 : 800));
    return { prompt: '[fake light] ' + text + (listing ? ' ' + listing : '') + edge, writer: 'fake writer' };
  }
  const user = (listing ? 'The pictures, in order: ' + listing + '\n\n' : 'Nothing is attached.\n\n') + 'Their words:\n' + text;
  const wrote = await _write([{ role: 'system', content: LIGHT_RULES }, { role: 'user', content: user }], []);
  const j = wrote.raw ? (parseLooseJson(wrote.raw) || parseLooseJson(_escapeRaw(wrote.raw))) : null;
  const prompt = j && typeof j.prompt === 'string' ? j.prompt.trim() : '';
  if (!prompt) {
    const why = wrote.raw ? 'the writer answered nothing usable' : 'no writer answered (' + (wrote.tried || []).join(', ') + ')';
    return { prompt: (text + (listing ? '\n\n' + listing : '') + edge).trim(), fell: why + ' - sent as typed, the pictures named' };
  }
  return { prompt: prompt + edge, writer: wrote.by ? wrote.by.model : '' };
}

/**
 * (phase V26.5) The frames chat with the writer ON: the frame's whole prompt, by the frame's rules - the person from the
 * sheet and nothing else of it, the place and its light, the edge, the mood when the words say none, the covered face
 * and the clothes as the look was read, realism - in the shape the chosen image model wants (its rules, the almanac). The
 * person reads it and edits it before anything is drawn, so it is never a question and never the words as typed:
 * { prompt, writer } or { fail }. `facts` - routes/scen3.js fchatFacts; `picUrls` - the pictures to look at, in order.
 */
async function thinkShot(opts) {
  const o = opts || {};
  const text = String(o.text || '').trim();
  const roles = Array.isArray(o.roles) ? o.roles : [];
  const f = o.facts || {};
  const listing = frameListing(roles);
  const edge = f.edge ? 'FRAMING: ' + f.edge.rule + (f.edge.cut ? ' ' + f.edge.cut : '') : '';
  if (FAKE.on()) {
    await new Promise(r => setTimeout(r, /\?slow\b/.test(text) ? 9000 : 1500));
    if (/\?fail\b/.test(text)) return { fail: 'Fake writer: it could not write the frame (?fail in the message)' };
    return { prompt: '[fake frame writer] ' + text + (listing ? ' ' + listing : '') + (edge ? ' ' + edge : ''), writer: 'fake writer' };
  }
  const engine = String(o.engine || '');
  const rule = RULES.rulesFor(engine);
  const changing = roles.indexOf('frame') + 1;
  const rules = [
    'THIS PICTURE IS A FRAME OF A TALKING-HEAD VIDEO AD: one real person in one real place, the still a clip of the video starts from. Where the person is in the place and what their body, hands, head and eyes do is what the person\'s words say.',
    'THE PICTURES, by number - name them by number in the prompt and do not describe in words what they already show: ' + (listing || 'none.'),
    roles.includes('character') ? 'THE PERSON: exactly the person of the character sheet - that face, hair, skin, body and clothes. One person in the picture and no other. Nothing else of the sheet: not its framing, not its several views, not its white backdrop.' : '',
    f.covered ? 'THE FACE IS COVERED, and this outranks anything about the face: ' + f.covered + ' Keep the covering exactly as on the sheet; never invent, uncover or show a face the sheet does not show.' : '',
    f.clothes ? 'THE CLOTHES, as a checklist of what must survive from the sheet (copy them from it; these words only name what must not drift): ' + f.clothes : '',
    roles.includes('place') ? 'THE PLACE: the location of its picture - its architecture, furniture, colours and depth around and behind the person. ' + (f.light || '') : '',
    roles.includes('extra') ? 'THE EXTRA PICTURES: what each is and what to take from it is in the words - an object drawn exactly as on its picture (shape, colours, labels, real size, never invented lettering), a pose or a look copied only as far as the words say.' : '',
    f.mood ? 'THE MOOD of the video is "' + f.mood.label + '" - unless the words say otherwise, the face: ' + f.mood.face + ' The body: ' + f.mood.gestures : '',
    edge ? 'THE FRAME\'S EDGE, said at the end of the prompt as it stands here: ' + edge : 'THE FRAME\'S EDGE: how much of the person is in the picture is what the words say.',
    changing ? 'IMAGE ' + changing + ' IS THE FRAME BEING CHANGED: write a short edit instruction - "Using the provided image ' + changing + ', change only <what the words ask>. Keep everything else exactly the same: the person, the clothes, the place, the light, the framing." - not a description of the whole picture.' : '',
    'Realism: ' + (f.real || 'a real photograph of a real person, not a render.') + ' No text, no captions, no logos, no watermark. The picture is ' + (f.format === '16:9' ? 'horizontal, 16:9' : 'vertical, 9:16') + '.',
    'Write the prompt in English whatever language the words are in, and add nothing they did not ask for beyond these rules.',
  ].filter(Boolean).join('\n');
  const system = [RULES.systemFor(engine, { refs: roles.length }) || '', rules, 'Answer as ONE json object and nothing else: {"prompt": "<the finished prompt>"}'].filter(Boolean).join('\n\n');
  const context = _recent(o.thread);
  const user = [
    context ? 'FOR REFERENCE ONLY, the previous message - use it only to resolve words like "it" or "the same":\n' + context + '\n' : '',
    'What they want:\n' + text,
  ].filter(Boolean).join('\n');
  const wrote = await _write([{ role: 'system', content: system }, { role: 'user', content: user }], o.picUrls || []);
  if (!wrote.raw) return { fail: 'no writer answered (' + (wrote.tried || []).join(', ') + ') - nothing was drawn; write it again' };
  const j = parseLooseJson(wrote.raw) || parseLooseJson(_escapeRaw(wrote.raw));
  let prompt = j && typeof j.prompt === 'string' ? j.prompt.trim() : '';
  if (!prompt) return { fail: 'the writer answered nothing usable - write it again' };
  if (rule && rule.maxChars && prompt.length > rule.maxChars) {
    const cut = prompt.slice(0, rule.maxChars);
    const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
    prompt = (stop > rule.maxChars * 0.6 ? cut.slice(0, stop + 1) : cut).trim();
  }
  if (rule && rule.suffix && !prompt.endsWith(rule.suffix.trim())) prompt += rule.suffix;
  return { prompt, writer: wrote.by ? wrote.by.model : '' };
}

/**
 * (phase V26.5, the owner 2026-10-10) The frames chat's `ideas`: the agent LOOKS at the person's sheet and the place (or the
 * frame being changed) and the extra pictures, and proposes SIX first frames in words, as varied as the place allows -
 * other corners, other furniture, other ways of holding the body (the owner, after the first look) - in English.
 * { ideas: [...] } or { fail }. Fractions of a cent, not a generation: no Alerts row.
 */
async function frameIdeas(opts) {
  const o = opts || {};
  const roles = Array.isArray(o.roles) ? o.roles : [];
  const f = o.facts || {};
  if (FAKE.on()) {
    await new Promise(r => setTimeout(r, 1200));
    const extras = roles.filter(r => r === 'extra').length;
    return { ideas: ['[fake idea 1] Standing by the window, one hand on the sill, looking into the lens.',
      '[fake idea 2] Sitting on the edge of the sofa, elbows on the knees, leaning toward the camera.',
      '[fake idea 3] Squatting by the low shelf in the corner, forearms on the knees, eyes up to the lens.',
      '[fake idea 4] Perched on the kitchen counter, one leg drawn up, half turned to the camera.',
      '[fake idea 5] Leaning back against the door frame, arms crossed, a half smile.',
      '[fake idea 6] Seated at the table' + (extras ? ', holding the thing from image 3 up to the lens' : ', a mug in both hands') + ', eyes on the viewer.'] };
  }
  const listing = frameListing(roles);
  const edge = f.edge ? 'The frame\'s edge is fixed: ' + f.edge.rule + (f.edge.cut ? ' ' + f.edge.cut : '') + ' Plan only what this shot shows: ' + f.edge.visible + '.' : 'How much of the person is in the frame is yours to choose in each idea.';
  const system = [
    'You are the director of photography of a UGC talking-head video ad: one real person speaks to the camera in one real place. You propose FIRST FRAMES - the stills its clips start from.',
    'The pictures, in order: ' + (listing || 'none.'),
    'Look at them and propose SIX first frames of THIS person in THIS place, as different from one another as the place allows. Each is one or two plain sentences: WHERE in this place the person is, the POSE, what the hands do' + (roles.includes('extra') ? ' (with the things in the extra pictures where they fit - each named by its image number)' : '') + ', where the eyes go (mostly into the lens), and what of the place is seen behind them.',
    'VARY THEM: six different spots of the place - its corners, by the window, by the door, at the table, on or by its furniture - and six different ways of holding the body, USING the place: sitting on a chair, on a stool, on the edge of the sofa or the bed, on the windowsill, squatting or crouching, perched on a counter or a table, leaning on a wall, a door frame or a counter, half lying, kneeling, walking in or turning mid-step. At most ONE of them simply standing.',
    'Only what is physically possible in this place and with these clothes.' + (f.covered ? ' The face is covered (' + f.covered + ') - plan nothing the face would have to show.' : ''),
    f.mood ? 'The mood of the video is "' + f.mood.label + '": the face - ' + f.mood.face + ' The body - ' + f.mood.gestures : '',
    edge,
    'Everything in English. Answer as ONE json object and nothing else: {"ideas": ["...", "...", "...", "...", "...", "..."]}',
  ].filter(Boolean).join('\n');
  const wrote = await _write([{ role: 'system', content: system }, { role: 'user', content: 'Six first frames, please.' }], o.picUrls || []);
  if (!wrote.raw) return { fail: 'no writer answered (' + (wrote.tried || []).join(', ') + ')' };
  const j = parseLooseJson(wrote.raw) || parseLooseJson(_escapeRaw(wrote.raw));
  const ideas = (j && Array.isArray(j.ideas) ? j.ideas : []).map(x => String(typeof x === 'string' ? x : (x && (x.idea || x.text)) || '').trim()).filter(Boolean).slice(0, 8);
  if (!ideas.length) return { fail: 'the writer answered nothing usable - ask again' };
  return { ideas, writer: wrote.by ? wrote.by.model : '' };
}

/**
 * (phase V26.8, part 4, the owner 2026-10-13) THE PERFORMANCE AND THE CAMERA of one line of a Seedance talking head
 * (lib/sd-prompt.js puts our parts around it - the pictures, the speech, the place, the sound). The writer SEES the
 * frame the clip begins on ({{image:1}}) and the character sheet ({{image:2}}), is told the line with its delivery
 * notes, the mood's face and the chosen way of moving - head, hands, body - and writes, beat by beat ON THE WORDS, what
 * the person does, starting from the pose of the frame, then the one continuous shot. NO SECONDS (the sixth round, the
 * owner's answer (я9): Seedance 2.0 does not follow time codes and may break on them, and 2.5 needs none for one line).
 * One request per line. { body, writer } or { fail } - never a question: the person reads and edits the prompt.
 * `facts`: { dur (0 - Seedance picks the length), lines: [{words, tagged}], mood: {label, face}, gestures: {label,
 * head, hands, body}, selfie, covered, clothes }.
 */
async function thinkTalk(opts) {
  const o = opts || {};
  const f = o.facts || {};
  const rows = Array.isArray(f.lines) ? f.lines : [];
  if (FAKE.on()) {
    await new Promise(r => setTimeout(r, 900));
    return { body: '[fake performance] At the start the person stands as in {{image:1}}. ' + rows.map(r => 'On "' + r.words.split(' ').slice(0, 3).join(' ') + '" a small nod.').join(' ') + ' Camera: one continuous shot, a subtle handheld drift.', writer: 'fake writer' };
  }
  const VR = require('./mv3-video-rules');
  const g = f.gestures || {};
  const m = f.mood || {};
  const system = [
    'You are a professional prompt engineer for the Seedance video model. You write for a UGC talking-head video ad: one real person speaking to the camera in one real place, in ONE continuous shot' + (f.dur > 0 ? ' of about ' + Math.round(f.dur) + ' seconds' : '') + '.',
    VR.FAMILY.seedance,
    'THE PICTURES: {{image:1}} is the instant the clip begins - the person, the clothes, the place and the framing; {{image:2}} is a character sheet of the same person from several sides. Do not describe what they show; name them only where you must, by these names.',
    'ALREADY WRITTEN BY US, around your text - do NOT write any of it again: what the pictures are; the voice, the lip sync and the spoken words; how the place moves in the background; the sound.',
    'YOU WRITE THE PERFORMANCE AND THE CAMERA, as plain sentences in English, with NO seconds and no time codes - Seedance does not follow them: each movement is tied to the words it comes on (on "two years" ...).',
    '- FIRST, AT THE START, THE POSE OF {{image:1}} in one sentence: where the hands, the head and the body are in that picture - the clip begins exactly on it.',
    '- THEN BEAT BY BEAT, the beats following the words of the line: what the face does (' + (m.face || 'natural') + '); the head (' + (g.head || 'small natural movements') + '); the hands (' + (g.hands || 'small natural gestures') + '); the body (' + (g.body || 'relaxed') + '). Each movement fits the words it comes on. Words in [brackets] in the delivery notes are how the line is performed - act them, never say them.',
    '- THE GAZE: into the lens; now and then, where a thought turns, the eyes flick away for a beat and come straight back.',
    '- THE CAMERA, last, in one sentence: ONE continuous shot, no cut, no zoom jump, a light movement only - ' + (f.selfie ? 'the phone held at arm\'s length by the person, the arm in the frame as in {{image:1}}, a subtle handheld shake' : 'almost locked, a very subtle handheld drift or a slow push-in') + ' - and the framing of {{image:1}} kept.',
    f.covered ? 'THE FACE IS COVERED (' + f.covered + '): it stays covered exactly as on the pictures; never uncover it.' : '',
    f.clothes ? 'THE CLOTHES stay exactly as on the sheet: ' + f.clothes : '',
    'No subtitles, captions, logos or text in the picture. Present tense. Plain sentences, no lists, no headings, at most 250 words.',
    'Answer as ONE json object and nothing else: {"prompt": "<the performance and the camera>"}',
  ].filter(Boolean).join('\n');
  const user = 'The line of this clip:\n'
    + rows.map(r => '"' + r.words + '"' + (r.tagged && r.tagged !== r.words ? '\n   delivery notes: ' + r.tagged : '')).join('\n')
    + '\n\nThe mood of the video: ' + (m.label || '-') + '. The way the body moves: ' + (g.label || '-') + '.';
  const wrote = await _write([{ role: 'system', content: system }, { role: 'user', content: user }], o.picUrls || []);
  if (!wrote.raw) return { fail: 'no writer answered (' + (wrote.tried || []).join(', ') + ') - write it again' };
  const j = parseLooseJson(wrote.raw) || parseLooseJson(_escapeRaw(wrote.raw));
  const body = j && typeof j.prompt === 'string' ? j.prompt.trim() : '';
  if (!body) return { fail: 'the writer answered nothing usable - write it again' };
  return { body: body.slice(0, 6000), writer: wrote.by ? wrote.by.model : '' };
}

module.exports = { think, thinkVideo, thinkFrame, frameLight, thinkShot, frameIdeas, thinkTalk, frameListing, FRAME_ROLES, toEnglish, toEnglishLines, see, english: _english, mentioned, needsNumbers, numbersQuestion, COVERAGE, ASK_FROM,
                   // for the stands: the raw line breaks of an answer
                   _escapeRaw };
