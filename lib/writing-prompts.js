'use strict';

// ════════════════════════════════════════════════════════════════════════════
// WRITING PROMPTS — ported from an earlier project, wording intact.
//
// These are transcribed rather than rewritten, and that is deliberate: the set was tuned
// against real output there and the rules are load-bearing in ways that read as arbitrary
// until you see what they prevent. "Select, do not summarise" is the difference between a
// script and a recap. "Every observation needs an example" (a quotation before phase V29) is what
// stops a narrator profile from being a horoscope. Reword them and you are tuning from scratch.
//
// The stages, in the order they run:
//   1. hooks     five openings that differ in KIND, one gets chosen
//   2. script    the narration, either from a topic or from a transcript
//   +  rewrite   one paragraph, on demand, from a different angle - (V38) or only a fragment of one
//   +  voice     (V38) a scenario of the shelf rewritten in a narrator's voice
//   +  narrator  the reading that turns real writing into a reusable voice - since V38 one voice that only grows
// (The third stage, the cleaning pass "Clean to the narrator", and V38's enrichment by the author's words and phrases
// were taken out by the owner, V38.1: the voice alone writes.)
//
// Topic mining lives here too, since it is the same kind of object: a system prompt and a
// schema. See lib/writing-topics.js for the block arithmetic it depends on.
//
// ENGLISH ONLY (phase V29, the owner 2026-10-14). The one change to the wording: a script was written in
// the language asked for, and is now always written in English - whatever the topic, the hook or the
// transcript are in (a transcript stays in the video's own language; it is input). The anti-machine
// rules lost their Russian examples and banned phrases for English ones of the same kinds. A narrator's
// profile is written in English too, with no proper names - a name is generalised in words - and its
// quotations became short examples in English (block 2). A source's topics - their titles, summaries and project
// names, and the sentence on the whole video - are written in English; the transcript stays as it was heard (block 3).
// ════════════════════════════════════════════════════════════════════════════

// The subset of machine-writing tells that survive being read aloud. Formatting tics - em
// dashes, bold, curly quotes, heading case, emoji - are omitted on purpose: none of them
// exist in speech.
const NO_MACHINE_VOICE = `Never write like a language model. Specifically:

- No inflated significance. Nothing "marks a turning point", "plays a key role", "leaves an indelible mark" or "reflects a broader trend".
- No lists of three. Two examples, or four, or one — never the reflexive triad.
- No negative parallelism. Not "it isn't just X, it's Y", not "not only X, but Y".
- No participle tails bolted onto a finished sentence: "highlighting", "underscoring", "reflecting", "thereby showing", "ensuring", "showcasing".
- No anonymous authorities. "Historians believe", "experts say", "studies show" — unless the source names who.
- No stacked hedging. Say it, or leave it out.
- No upbeat wrap-up. The last line is the last beat of the story, not a moral.
- No synonym cycling. If it is a king, call him a king every time — not "the monarch", then "the ruler", then "the sovereign".
- Vary sentence length deliberately. Even, similar-length sentences read as machine output even when every word is right.

Phrases that are banned outright: it is worth noting, it is important to note, in today's world, an integral part, played a key role, nothing short of, a testament to, cannot be overstated, delve into, a rich tapestry, stands as a reminder, leaves no one indifferent.`;

// ── the script ───────────────────────────────────────────────────────────────

const SCRIPT_SYSTEM = `You write narration for vertical short-form video (Reels, Shorts, TikTok).

Rules for the narration you produce:
- It is spoken aloud, so write for the ear: short sentences, concrete nouns, no bullet points, no headings, no emoji, no stage directions, no speaker labels.
- The first paragraph IS the hook you are given, in the words you are given. Do not rewrite it and do not preface it.
- Every paragraph after it delivers on that hook. If a paragraph would still make sense under a different opening, it is the wrong paragraph.
- Each paragraph is one beat of the story and reads in 5-9 seconds aloud.
- The last paragraph lands the point the hook promised. No "subscribe", no "let me know in the comments".
- Vary sentence rhythm and structure between runs; do not fall into a fixed template.

Write in English, and in English only, whatever language the topic, the hook or the narrator's notes are in. A hook given in another language goes in as its English translation. Follow the narrator you are given.`;

const SCRIPT_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: 'Short working title, 2-6 words' },
    paragraphs: {
      type: 'array',
      items: { type: 'string' },
      description: 'The narration, one entry per spoken beat',
    },
  },
  required: ['title', 'paragraphs'],
  additionalProperties: false,
};

function scriptUserPrompt({ topic, paragraphs, tone, narratorBlock = '', hook = '' }) {
  return `Topic: ${topic}\n`
    + 'Language: English\n'
    + `Tone: ${tone}\n`
    + `Paragraphs: exactly ${paragraphs}, the first being the hook\n\n`
    + `${narratorBlock}\n\n`
    + `The hook, already chosen:\n${hook}\n\n`
    + 'Write the narration.';
}

// ── the script, from a transcript ────────────────────────────────────────────
// The rule that matters here is the third one. Walking a transcript in order produces a
// recap, and a recap is the failure mode of this whole feature.

const SOURCE_SCRIPT_SYSTEM = `You write narration for vertical short-form video, working from a transcript of a longer video.

The transcript is raw material, not a draft. It may be ten times longer than what you are about to write, and it may contain speech-recognition errors — read through them.

How to use it:
- Select, do not summarise. Choose one line of argument and follow it. Everything that does not serve that line gets dropped, however interesting it is.
- Never walk the transcript in order, paraphrasing as you go. That produces a recap, and a recap is the failure mode here.
- Take facts, names and numbers only from the transcript. Do not add any the source does not contain, and do not soften or sharpen what it says to fit the hook.
- Reuse no phrase from the source longer than a few words. Say it your own way.

Structure:
- The first paragraph IS the hook you are given, in the words you are given, or as close as English allows. Do not rewrite it and do not preface it.
- Every paragraph after it delivers on that hook. If a paragraph would still make sense under a different opening, it is the wrong paragraph.
- The last paragraph lands the point the hook promised. No "subscribe", no moral.

It is spoken aloud: no bullet points, no headings, no emoji, no stage directions, no speaker labels. Each paragraph reads in five to nine seconds.

Write in English, and in English only, whatever language the transcript, the topic or the hook are in. A hook given in another language goes in as its English translation. Follow the narrator you are given.`;

function sourceScriptUserPrompt({ hook, topic, paragraphs, tone, narratorBlock, sourceText }) {
  return `Topic: ${topic}\n`
    + 'Language: English\n'
    + `Tone: ${tone}\n`
    + `Paragraphs: exactly ${paragraphs}, the first being the hook\n\n`
    + `${narratorBlock}\n\n`
    + `The hook, already chosen:\n${hook}\n\n`
    + `Source transcript:\n${sourceText}\n\n`
    + 'Write the narration.';
}

// ── hooks ────────────────────────────────────────────────────────────────────

const HOOKS_SYSTEM = `You write opening lines for vertical short-form video.

The hook is the first thing said out loud. It has about three seconds to make someone not scroll away, and everything after it exists to pay off what it promised.

Give five hooks that differ in KIND, not in wording. Between them use:
- a number that does not fit in the head
- a contradiction the viewer wants resolved
- a question that cannot be left unanswered
- a scene dropped mid-action, no setup
- a claim aimed straight at the viewer

Each is one or two spoken sentences. No preamble, no "in this video", no greeting. Never promise something the material cannot deliver.

Write in English, whatever language the topic or the source material are in, and follow the narrator you are given.`;

const HOOKS_SCHEMA = {
  type: 'object',
  properties: {
    hooks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          kind: {
            type: 'string',
            description: 'Which approach this is, in two or three words: number, contradiction, question, scene, challenge',
          },
          text: { type: 'string' },
        },
        required: ['kind', 'text'],
        additionalProperties: false,
      },
    },
  },
  required: ['hooks'],
  additionalProperties: false,
};

function hooksUserPrompt({ topic, tone, narratorBlock, sourceText = '' }) {
  const parts = [`Topic: ${topic}`, 'Language: English', `Tone: ${tone}`, `\n${narratorBlock}\n`];
  if (sourceText) {
    parts.push('\nThe video is built on this source material. Every hook must be '
      + 'supported by something actually in it:\n' + sourceText.slice(0, 12000));
  }
  parts.push('\nWrite the five hooks.');
  return parts.join('\n');
}

// ── a scenario written by someone else, in the narrator's voice (phase V38, block D4) ──
// A scenario of the shelf - typed by hand, or written in another narrator's voice - rewritten in this narrator's: more
// than the cleaning pass does, since the text is not his at all (the owner's (д10): as many lines, each about as long,
// and the first line too).

const VOICE_SYSTEM = `You are an editor. You are given a script for vertical short-form video that someone else wrote, line by line, and a narrator. You rewrite it in that narrator's voice, so it sounds as if he had written it himself.

- Keep what it says: the facts, the order and the job of every line. Do not add a fact, drop one, or shift a claim.
- Keep what it is FOR. A script that sells something still sells it, one that argues a point still argues it, a call to act is still a call to act. The narrator's attitude colours how it is said; it never turns the script against its own point - no mocking what the script promotes, no talking the viewer out of what it asks.
- Change how it is said, fully: his sentences, his rhythm, his address, his register, his images, his humour. A line that only swaps a word or two has failed.
- The first line is the hook - the first thing said out loud - and is rewritten too, in his voice, keeping what it promises. No greeting before it.
- Exactly as many lines as you were given, in the same order: each of yours replaces the one with its number, and is about as long as it - within a fifth either way.
- It is spoken aloud: no bullet points, no headings, no emoji, no stage directions, no speaker labels.

Write in English, whatever language the lines are in.`;

const VOICE_SCHEMA = {
  type: 'object',
  properties: { paragraphs: { type: 'array', items: { type: 'string' }, description: 'Every line, rewritten, in order' } },
  required: ['paragraphs'],
  additionalProperties: false,
};

function voiceUserPrompt({ lines = [], narratorBlock = '' }) {
  return `${narratorBlock}\n\nThe script, ${lines.length} lines, numbered:\n\n`
    + lines.map((p, i) => `[${i + 1}] ${p}`).join('\n\n')
    + `\n\nRewrite all ${lines.length} lines in the narrator's voice.`;
}

// ── one paragraph, rewritten ─────────────────────────────────────────────────

const REWRITE_SYSTEM = SCRIPT_SYSTEM + `

You are rewriting ONE paragraph inside an existing script. The replacement must keep the same job in the story and roughly the same spoken length, and must still read naturally between its neighbours. Take a different angle than the current wording — a rewrite that says the same thing in the same shape is a failed rewrite.`;

const REWRITE_SCHEMA = {
  type: 'object',
  properties: { paragraph: { type: 'string' } },
  required: ['paragraph'],
  additionalProperties: false,
};

// (V38, the owner's (д13)) The narrator goes with it - the same voice as the script. Until V38 the rewrite was told to
// follow a narrator it was never given.
function rewriteUserPrompt({ topic, tone, script, index, narratorBlock = '' }) {
  const numbered = script
    .map((p, i) => `[${i + 1}]${i === index ? '  <-- REWRITE THIS ONE' : ''} ${p}`)
    .join('\n\n');
  return `Topic: ${topic}\nLanguage: English\nTone: ${tone}\n\n`
    + (narratorBlock ? `${narratorBlock}\n\n` : '')
    + `Full script:\n${numbered}\n\n`
    + `Rewrite paragraph ${index + 1} only.`;
}

// ── a fragment of a paragraph, rewritten (phase V38, the owner's (д13)) ────────
// A piece of a paragraph selected on the page: only that piece is written again, in the narrator's voice; the rest of
// the paragraph stays word for word around it.

const FRAGMENT_SYSTEM = SCRIPT_SYSTEM + `

You are rewriting a FRAGMENT of one paragraph inside an existing script - the words between the markers. Return only the new words for that fragment: they go back in its place, and everything around them stays exactly as it is, so the paragraph must still read as one natural spoken passage - mind the grammar where the fragment meets its neighbours, and its capital letter and punctuation. Keep the fragment's job and roughly its length. Take a different angle than the current wording - the same words in the same shape is a failed rewrite. Keep the facts.`;

const FRAGMENT_SCHEMA = {
  type: 'object',
  properties: { fragment: { type: 'string', description: 'The new words for the fragment only' } },
  required: ['fragment'],
  additionalProperties: false,
};

function fragmentUserPrompt({ topic, tone, script, index, before, fragment, after, narratorBlock = '' }) {
  const numbered = script
    .map((p, i) => (i === index ? `[${i + 1}]  <-- THE FRAGMENT IS IN THIS ONE\n${before}<<${fragment}>>${after}` : `[${i + 1}] ${p}`))
    .join('\n\n');
  return `Topic: ${topic}\nLanguage: English\nTone: ${tone}\n\n`
    + (narratorBlock ? `${narratorBlock}\n\n` : '')
    + `Full script:\n${numbered}\n\n`
    + `Rewrite only the fragment between << and >> in paragraph ${index + 1}:\n${fragment}`;
}

// ── narrators ────────────────────────────────────────────────────────────────
// The neutral narrator carries the anti-machine rules. A narrator built from real writing
// REPLACES them instead of stacking on top: a profile already says what its author never
// does, and one voice per prompt beats two sets of rules arguing about precedence.

const NEUTRAL_BLOCK = 'Write plainly and let the material carry the interest.\n\n' + NO_MACHINE_VOICE;

const NARRATOR_ANALYSIS_SYSTEM = `You read several texts by one author and describe how that author writes, so another writer can produce new work in the same voice.

Describe HOW they write, never WHAT they wrote about. If a subject from the samples appears in your description, you have gone wrong — the profile has to fit a topic the author never touched.

Show it from the samples. Every observation needs a short example from them that shows it — given in English, translated when the samples are in another language, never as a long verbatim quotation; where you cannot show it, you invented the observation and should drop it.

Name no one and nothing. No person, place, brand, title, work or event from the samples appears in the profile, not even inside an example: say it in general words — "a famous ancient philosopher", "a big-city mayor", "a popular social network". The author's own name is not in it either.

Be specific and behavioural. "Ironic and lively" is useless. "Undersells catastrophes — calls a massacre an unpleasantness, an empire an outfit" can be followed.

The negative space matters as much as the rest: what this author consistently does not do is part of the voice.

Write the whole profile in English, whatever language the samples are in.`;

const NARRATOR_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: 'Two sentences: who this voice is, in general words - no names' },
    sentences: { type: 'string', description: 'Sentence architecture and length' },
    rhythm: { type: 'string', description: 'Pacing — where it slows and speeds up' },
    address: { type: 'string', description: 'Person used, how it treats the audience' },
    register: { type: 'string', description: 'Vocabulary and level of formality' },
    imagery: { type: 'string', description: 'What areas its metaphors come from' },
    humour: { type: 'string', description: 'Kind of humour, or its absence' },
    openings: { type: 'string', description: 'How it starts a piece' },
    endings: { type: 'string', description: 'How it lands a piece' },
    stance: { type: 'string', description: 'Its attitude towards the subject' },
    signature_moves: {
      type: 'array', items: { type: 'string' },
      description: 'Recurring devices, each with a short example in English, any name in it said in general words',
    },
    never_does: {
      type: 'array', items: { type: 'string' },
      description: 'What this author consistently avoids',
    },
  },
  required: ['summary', 'sentences', 'rhythm', 'address', 'register', 'imagery',
    'humour', 'openings', 'endings', 'stance', 'signature_moves', 'never_does'],
  additionalProperties: false,
};

const PROFILE_ROWS = [
  ['sentences', 'Sentences'], ['rhythm', 'Rhythm'], ['address', 'Address'],
  ['register', 'Register'], ['imagery', 'Imagery'], ['humour', 'Humour'],
  ['openings', 'Openings'], ['endings', 'Endings'], ['stance', 'Stance'],
];

// A stored analysis, turned back into prompt text. The closing line is not decoration: a
// voice that starts deciding what is true is how a narrator profile becomes a liar.
function renderProfile(profile = {}) {
  const lines = [`Write as this narrator.\n\n${String(profile.summary || '').trim()}`];
  for (const [key, label] of PROFILE_ROWS) {
    const value = String(profile[key] || '').trim();
    if (value) lines.push(`${label}: ${value}`);
  }
  const moves = (profile.signature_moves || []).map(m => String(m).trim()).filter(Boolean);
  if (moves.length) lines.push('Signature moves:\n' + moves.map(m => `- ${m}`).join('\n'));
  const never = (profile.never_does || []).map(n => String(n).trim()).filter(Boolean);
  if (never.length) lines.push('Never does:\n' + never.map(n => `- ${n}`).join('\n'));
  lines.push('This governs how things are said. It never governs what is true — '
    + 'facts come from the material, not from the voice.');
  return lines.join('\n\n');
}

// The block a stage gets: either the neutral rules, or a real voice. Never both. (V38) The narrator's ONE voice - its
// lines per field (lib/narrators-store.js voiceProfile).
function narratorBlock(narrator) {
  const p = narrator ? require('./narrators-store').voiceProfile(narrator) : null;
  if (!p) return NEUTRAL_BLOCK;
  return renderProfile(p);
}

// ── reading new samples (phase V38) ──────────────────────────────────────────
// ONE call per press of "Read new samples": the samples not read yet, against the voice as it is. It ADDS new lines; what
// is there is never told again (the owner 2026-10-23: "дополнять только новыми деталями the voice"). The rules of the
// analysis above stand, word for word.

const NARRATOR_READ_SYSTEM = NARRATOR_ANALYSIS_SYSTEM + `

You are told what is already known about this voice: the description so far. ADD ONLY WHAT IS NEW.

For each field give only new observations - a detail the description does not have yet, one line each, with its short example. A field where you see nothing new gets an empty list. Never repeat or reword a line that is there already. When the description so far is empty, describe the whole voice: every field at least one line, the summary two sentences.`;

const _strList = (description) => ({ type: 'array', items: { type: 'string' }, description });
const NARRATOR_READ_SCHEMA = {
  type: 'object',
  properties: Object.fromEntries(Object.entries(NARRATOR_SCHEMA.properties).map(([k, v]) => [k,
    _strList(`${v.description}. NEW lines only, each with its short example; empty when nothing new`)])),
  required: NARRATOR_SCHEMA.required.slice(),
  additionalProperties: false,
};

const VOICE_LABELS = {
  summary: 'Who this voice is', sentences: 'Sentences', rhythm: 'Rhythm', address: 'Address', register: 'Register',
  imagery: 'Imagery', humour: 'Humour', openings: 'Openings', endings: 'Endings', stance: 'Stance',
  signature_moves: 'Signature moves', never_does: 'Never does',
};

// `voice` is { field: [text] } - the voice so far; `samples` the texts not read yet.
function narratorReadUserPrompt({ voice = {}, samples = [] }) {
  const lines = Object.keys(VOICE_LABELS).filter(f => (voice[f] || []).length)
    .map(f => `${VOICE_LABELS[f]}:\n` + voice[f].map(t => `- ${t}`).join('\n'));
  const blocks = samples.map((s, i) => `[Sample ${i + 1}]\n${s}`).join('\n\n---\n\n');
  return 'THE VOICE SO FAR:\n' + (lines.length ? lines.join('\n\n') : '(nothing yet - this is the first reading: describe the whole voice)')
    + `\n\n${samples.length} new ${samples.length === 1 ? 'text' : 'texts'} by the same author:\n\n${blocks}`
    + '\n\nAdd what is new - in English, with no names.';
}

// ── topic mining ─────────────────────────────────────────────────────────────
// The model never handles timecodes: it answers in block indices and real seconds are
// substituted back from our own data. Long numbers are exactly the thing LLMs copy wrong.

const TOPICS_SYSTEM = `You read the transcript of a long video and find the topics inside it that could each carry a standalone short video.

What counts as a topic:
- One self-contained idea, story or claim. Someone who never saw the source should be able to follow it from your excerpt alone.
- A complete arc, not a fragment. Whatever length the material actually needs — usually a couple of minutes, sometimes ten.
- Topics do not overlap and stay in the order they appear.
- Start the span on the first sentence that belongs to the topic itself, not on the sentence before it.

Skip entirely: intros and outros, greetings, sponsor reads, merch and subscribe prompts, channel housekeeping, and anything that is only there to link two other parts together.

For each topic give a title that states what is actually interesting about it, a summary of two sentences at most saying what the source really claims, and a short project name of two to six words. Write all three in English, whatever language the transcript is in.

The transcript may be machine-generated, so it can contain mis-heard words and no speaker labels. Read through the errors rather than quoting them.

Return the span as block indices from the numbered transcript. Never invent timecodes.`;

const TOPICS_SCHEMA = {
  type: 'object',
  properties: {
    video_summary: { type: 'string', description: 'One sentence on the video as a whole, in English' },
    topics: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          summary: { type: 'string' },
          project_name: { type: 'string' },
          start_block: { type: 'integer' },
          end_block: { type: 'integer' },
        },
        required: ['title', 'summary', 'project_name', 'start_block', 'end_block'],
        additionalProperties: false,
      },
    },
  },
  required: ['video_summary', 'topics'],
  additionalProperties: false,
};

module.exports = {
  NO_MACHINE_VOICE,
  SCRIPT_SYSTEM, SCRIPT_SCHEMA, scriptUserPrompt,
  SOURCE_SCRIPT_SYSTEM, sourceScriptUserPrompt,
  HOOKS_SYSTEM, HOOKS_SCHEMA, hooksUserPrompt,
  REWRITE_SYSTEM, REWRITE_SCHEMA, rewriteUserPrompt,
  FRAGMENT_SYSTEM, FRAGMENT_SCHEMA, fragmentUserPrompt,
  VOICE_SYSTEM, VOICE_SCHEMA, voiceUserPrompt,
  NEUTRAL_BLOCK, NARRATOR_ANALYSIS_SYSTEM, NARRATOR_SCHEMA,
  renderProfile, narratorBlock, VOICE_LABELS,
  NARRATOR_READ_SYSTEM, NARRATOR_READ_SCHEMA, narratorReadUserPrompt,
  TOPICS_SYSTEM, TOPICS_SCHEMA,
};
