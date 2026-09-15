'use strict';

// ════════════════════════════════════════════════════════════════════════════
// THE ALMANAC — how each model wants to be spoken to.
//
// One rule set per engine, and the engine that was chosen decides which one the rewriting
// agent is handed. That is the whole point: these models do NOT want the same thing, and the
// differences are not stylistic preferences but hard facts about how each one was built.
//
// Three of them are worth stating up front, because they are the ones that quietly ruin a
// prompt written for a different model:
//
//   * grok-imagine reads a negative prompt as words in the prompt, never as a field.
//     "no watermark" as a separate field does nothing; it has to be said inside the sentence.
//   * Gemini's own guide says a keyword list "won't cut it" and asks for narrative prose, while
//     OpenAI's says a skimmable labelled template beats clever syntax. Feed each the other's
//     shape and both get worse.
//   * Seedream's realism comes from asking for FLAWS - sensor noise, handheld softness, no
//     beauty filters. Ask it for perfection and it returns plastic.
//
// WHERE THIS COMES FROM. Every rule below is traceable to a first-hand source, and the `source`
// field on each entry names it. Preference went to the makers' own documentation - Google's
// prompting guide, OpenAI's cookbook, Alibaba's Model Studio docs and the QwenLM repository,
// xAI's API docs - with practitioner guides used only where the makers publish nothing, which
// is most of what is known about Seedream.
//
// WHAT THE AGENT GETS. `system` is the instruction, written to be handed to a text model along
// with what the person typed. It is deliberately narrow: turn this sentence into a prompt THIS
// model will do well with, keep the meaning, invent nothing about the subject. It never decides
// whether to generate - that is the caller's business.
//
// THE WORD COUNTS ARE ABOUT SHAPE, NOT ABOUT PERMISSION. Every range below says how far a SHORT
// request should be grown so it becomes a usable prompt. None of them is a cap. What the writer
// may cut is the PACKAGING - thinking aloud, hedging, repetition, asides that describe nothing
// in the frame. What it may never cut is a fact about the picture. Condense the words, never the
// content.
//
// Kept in Merge's own file, like everything else here. When the gear grows an editor, this is
// what it edits.
// ════════════════════════════════════════════════════════════════════════════

// The shapes a prompt can take. Named because the difference between them is the single
// biggest lever in this file.
const FORM = {
  PROSE: 'prose',            // narrative sentences, a described scene
  BRIEF: 'brief',            // a short design brief: subject, layout, words, style, light
  TEMPLATE: 'template',      // labelled lines, skimmable, order matters
  SLOTS: 'slots',            // a fixed run of slots, camera-crew style
  PLAIN: 'plain',            // one to three plain sentences, no ornament
};

// How exclusions have to be expressed.
const NEG = {
  NONE: 'none',              // ignored by the model; must be phrased positively
  INLINE: 'inline',          // no field, but "no X" inside the prompt is obeyed
  FIELD: 'field',            // a real negative-prompt parameter exists upstream
};

const RULES = {
  // ── Google, the Gemini image family ──────────────────────────────────────
  // Google's own guide is unusually explicit, and two of its rules are the opposite of what
  // the Stable-Diffusion habit teaches: describe narratively rather than in keywords, and
  // never say what you do not want.
  'nano-banana-2': {
    label: 'nano-banana-2 (Gemini 3.1 Flash Image)',
    form: FORM.PROSE,
    negatives: NEG.NONE,
    maxChars: 20000,
    sweetSpot: 'grow a short request to 60-200 words',
    strengths: ['text inside the picture', 'up to 14 references', 'world knowledge', 'conversational editing'],
    weakness: 'a keyword list gets a generic picture - it wants a described scene',
    formula: '[Subject] + [Action] + [Location/context] + [Composition] + [Style]',
    editFormula: '[what to change, starting with a strong verb] + [what must stay exactly the same]',
    refFormula: '[Reference images] + [Relationship instruction] + [New scenario]',
    text: 'Put the words in double quotes and name the typeface: "GLOW" in a flowing brush script.',
    checklist: [
      'Describe the scene in sentences, not as a list of tags.',
      'Say what you want, never what you do not: "empty street", not "no cars".',
      'Camera, lens and film stock are understood - "low angle, f/1.8, 1980s color film".',
      'When editing, name what must stay unchanged as explicitly as what changes.',
      'Give each reference a job: this one is the structure, that one is the texture.',
    ],
    system: [
      'You rewrite a picture request into a prompt for Gemini 3.1 Flash Image (nano-banana-2).',
      'Write ONE narrative paragraph describing the finished picture as if to a',
      'photographer - around 60-200 words for a short request, longer if they described more. Follow the order: subject, what it is doing, where, how it is framed, in what',
      'style. Use concrete materials, lighting and camera language (angle, lens, film stock).',
      'NEVER write what should be absent - phrase every constraint positively ("an empty street",',
      'not "no cars"). Put any words that must appear IN the picture in double quotes and name the',
      'typeface. If references are attached, say what each one contributes and what must be carried',
      'over unchanged. Do not invent a subject the request did not mention. Answer with the prompt',
      'and nothing else.',
    ].join(' '),
    source: [
      'https://cloud.google.com/blog/products/ai-machine-learning/ultimate-prompting-guide-for-nano-banana',
      'https://blog.google/products-and-platforms/products/gemini/prompting-tips-nano-banana-pro/',
    ],
  },

  // Same family, smaller model. The guidance is the family's; what changes is the ambition -
  // it holds fewer instructions at once, so the paragraph is shorter and the scene simpler.
  'nano-banana-2-lite': {
    label: 'nano-banana-2-lite (Gemini 3.1 Flash Lite Image)',
    form: FORM.PROSE,
    negatives: NEG.NONE,
    maxChars: 20000,
    sweetSpot: 'grow a short request to 40-120 words',
    strengths: ['fast', 'cheap', 'up to 10 references'],
    weakness: 'holds fewer instructions at once than its full sibling - one clear idea per picture',
    formula: '[Subject] + [Action] + [Location/context] + [Composition] + [Style]',
    editFormula: '[what to change, starting with a strong verb] + [what must stay exactly the same]',
    refFormula: '[Reference images] + [Relationship instruction] + [New scenario]',
    text: 'Words in double quotes, kept short - long strings are where the small model slips.',
    checklist: [
      'One clear idea per picture; it does not juggle three instructions well.',
      'Sentences, not tags.',
      'Positive phrasing only.',
      'Keep any text in the picture to a few words.',
    ],
    system: [
      'You rewrite a picture request into a prompt for Gemini 3.1 Flash Lite Image.',
      'Write ONE paragraph - around 40-120 words for a short request, longer if they described more - covering subject, action, place, framing and style, in that order.',
      'Keep it to a single clear idea - this model does not hold several instructions at once.',
      'Phrase every constraint positively; never say what should be absent. Words that must appear',
      'in the picture go in double quotes and should be short. Do not invent a subject the request',
      'did not mention. Answer with the prompt and nothing else.',
    ].join(' '),
    source: ['https://cloud.google.com/blog/products/ai-machine-learning/ultimate-prompting-guide-for-nano-banana'],
  },

  // ── OpenAI ───────────────────────────────────────────────────────────────
  // The one model in this table whose own documentation asks for STRUCTURE rather than prose,
  // and the one where explicit exclusions are recommended rather than discouraged.
  'gpt-image-2.5-sunburst': {
    label: 'gpt-image-2.5-sunburst',
    form: FORM.TEMPLATE,
    negatives: NEG.INLINE,
    maxChars: 32000,
    sweetSpot: 'a labelled block of 5-9 short lines',
    strengths: ['instruction following', 'text in the picture', 'edits that keep the rest still'],
    weakness: 'an unbounded brief invites a second subject, a drifting face, or a watermark-shaped mark',
    formula: 'scene/background -> subject -> key details -> constraints, as labelled lines, plus what the picture is FOR',
    editFormula: 'change only X. Keep everything else the same: [list what must not move]',
    refFormula: 'Image 1: [what it is]. Image 2: [what it is]. [How they combine]',
    text: 'Literal words in quotes or ALL CAPS; spell hard names letter by letter; ask for medium or high quality when the text is small.',
    checklist: [
      'Short labelled lines beat one long paragraph.',
      'Say what the picture is for - an ad, a UI mock, a diagram - it sets the polish.',
      'Exclusions are worth stating: no watermark, no extra text, no logos.',
      'On every edit, repeat the list of what must stay - it stops drift between rounds.',
      'Say "photorealistic" outright when that is what is wanted.',
    ],
    system: [
      'You rewrite a picture request into a prompt for OpenAI gpt-image-2.',
      'Answer as a labelled block, one item per line, in this order: PURPOSE (what the',
      'picture is for), SCENE, SUBJECT, DETAILS (materials, light, camera), TEXT (any words to',
      'render, in quotes, with their typography), AVOID (things that must not appear - watermarks,',
      'extra text, second subjects). Be concrete about materials and shapes. If references are',
      'attached, name them as "Image 1: ...", "Image 2: ..." and say how they combine. If this is',
      'an edit, state the single change and then list everything that must stay exactly as it is.',
      'Do not invent a subject the request did not mention. Answer with the prompt and nothing else.',
    ].join(' '),
    source: [
      'https://developers.openai.com/cookbook/examples/multimodal/image-gen-models-prompting-guide',
      'https://fal.ai/learn/tools/prompting-gpt-image-2',
    ],
  },

  // ── ByteDance, the Seedream family ───────────────────────────────────────
  // The realism model, and the one with the least obvious rule: ask it for FLAWS. Beginners ask
  // for perfection and get plastic.
  'seedream-4.5': {
    label: 'seedream-4.5',
    form: FORM.PROSE,
    negatives: NEG.INLINE,
    maxChars: 5000,
    sweetSpot: '2-4 sentences',
    strengths: ['photographic texture', 'edits that keep the frame still', 'up to six references'],
    weakness: 'long fine print in the picture comes out garbled',
    formula: '[subject + action + setting] + [style] + [light] + [details]',
    editFormula: '[verb] + [object] + [attributes], one change at a time: "replace the background with ..., keeping the light"',
    refFormula: 'Give each one a job: "Image 1 for the character, Image 2 for the background, style from Image 3"',
    text: 'Quote the exact string and say where it sits. Keep it short.',
    checklist: [
      'Complete sentences; it reasons through instructions rather than matching tags.',
      'One change per run when editing - stacked edits cannot be told apart afterwards.',
      'Concise beats ornate: this family understands plain description well.',
      'Say what to keep as well as what to change.',
    ],
    system: [
      'You rewrite a picture request into a prompt for Seedream 4.5.',
      'Write complete sentences - two to four for a short request, more if they described more - covering subject and what it is doing, the setting, the light,',
      'the style, then the details that matter. Plain, concrete description - it reasons through',
      'sentences rather than matching tags. If this is an edit, name ONE change with the verb first',
      '("replace the background with ..."), then say what must be preserved. If references are',
      'attached, give each a job by number. Quote any words that must appear in the picture and say',
      'where they sit, keeping them short. Do not invent a subject the request did not mention.',
      'Answer with the prompt and nothing else.',
    ].join(' '),
    source: [
      'https://www.atlabs.ai/blog/seedream4o-prompting-guide',
      'https://www.veed.io/learn/seedream-4-prompting-guide',
    ],
  },

  // ── xAI ──────────────────────────────────────────────────────────────────
  // The typography model. It plans the layout the way a designer would before it draws, so the
  // prompt reads as a brief rather than a description.
  'grok-imagine-image-2': {
    label: 'grok-imagine-image-2',
    form: FORM.BRIEF,
    negatives: NEG.INLINE,
    maxChars: 5000,
    sweetSpot: 'a brief of 40-120 words',
    strengths: ['typography and layout', 'posters and infographics', 'up to five references with roles'],
    weakness: 'vague text instructions produce invented words - name them exactly',
    formula: '[subject] + [layout: where things sit] + [exact words in quotes] + [style] + [light]',
    editFormula: 'one region, one change, and say what stays: "keep the light, the shadows and everything else exactly as it is"',
    refFormula: 'Say what each reference carries: "Image 1 is the product, keep its shape and label; Image 2 sets the palette"',
    text: 'The words in quotes render as written. Name them exactly rather than describing them.',
    checklist: [
      'Write it as a design brief, not a caption.',
      'Say where things sit in the frame, not only what they are.',
      'Any words in the picture go in quotes, spelled exactly.',
      'One region, one change, when editing.',
      'Give every reference a stated role.',
    ],
    system: [
      'You rewrite a picture request into a prompt for Grok Imagine.',
      'Write it as a design brief - around 40-120 words for a short request, longer if they described more: what is in the frame, where each thing',
      'sits, the exact words to render (in double quotes, spelled precisely), the style, and the',
      'light. Layout matters as much as subject - say where things are. If references are attached,',
      'state what each one carries ("Image 1 is the product, keep its shape and label"). If this is',
      'an edit, name one region and one change, then say what stays exactly as it is. Do not invent',
      'a subject the request did not mention. Answer with the prompt and nothing else.',
    ].join(' '),
    source: [
      'https://docs.x.ai/developers/model-capabilities/images/generation',
      'https://morphic.com/resources/how-to/grok-imagine-image-2-guide',
    ],
  },
};

// What every rewrite is told, whatever the model. Kept apart from the per-model instruction so
// the things that are true everywhere are written once.
const COMMON = [
  'You are rewriting one picture request into a prompt.',
  '',
  'KEEP EVERY VISUAL FACT, CUT EVERYTHING ELSE. Every object, person, garment, colour, action,',
  'place, mood and detail they said they want to SEE must appear in the finished prompt - what',
  'looks like a small detail to you is often the whole reason they are asking. What you may cut',
  'is the packaging around those facts: greetings, thinking aloud, hedging ("maybe", "something',
  'like"), repetition, and asides that describe nothing in the frame. Condense the WORDS, never',
  'the CONTENT. And do not ADD a subject, a place, a mood or a story they did not ask for.',
  '',
  'THE LENGTH GUIDANCE BELOW IS ABOUT SHAPE, NOT ABOUT HOW MUCH THEY MAY SAY. It describes the',
  'size a SHORT request should be grown to, so a bare sentence becomes a usable prompt. It is',
  'never a cap on their content: if they described more things than that range holds, the prompt',
  'is simply longer. Losing something they asked to see in order to hit a word count is the one',
  'mistake you must never make.',
  '',
  'Write in English. Answer with the prompt itself - no preamble, no explanation, no quotes',
  'around the whole thing.',
].join(' ');

/** The rule set for an engine, or null when there is none. */
const rulesFor = (engineId) => RULES[engineId] || null;

/**
 * The instruction to hand a rewriting agent for THIS engine, in THIS direction.
 *
 * The direction matters: an edit is a different kind of sentence from a description, and every
 * model in this table words it differently - a strong verb first for Gemini, "change only X" for
 * gpt-image-2, one region and one change for grok and seedream.
 */
function systemFor(engineId, opts) {
  const r = RULES[engineId];
  if (!r) return null;
  const o = opts || {};
  const refs = +o.refs || 0;
  const out = [COMMON, r.system];

  if (refs > 0 && r.editFormula) {
    out.push('There ' + (refs === 1 ? 'is 1 reference picture' : 'are ' + refs + ' reference pictures')
      + ' attached, numbered from 1. ' + r.refFormula + '.'
      + ' The request is an EDIT of what is attached: ' + r.editFormula + '.');
    if (refs >= 2) {
      out.push('The person may refer to pictures by number; keep those numbers as they wrote them.');
    }
  }
  if (r.maxChars) out.push('The finished prompt must be under ' + r.maxChars + ' characters.');
  if (r.negatives === NEG.NONE) {
    out.push('Remember: this model cannot be told what to avoid. Every constraint must name'
      + ' something present.');
  }
  return out.join('\n\n');
}

module.exports = { RULES, FORM, NEG, COMMON, rulesFor, systemFor };
