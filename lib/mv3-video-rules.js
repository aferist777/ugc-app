'use strict';

// ════════════════════════════════════════════════════════════════════════════
// HOW EACH VIDEO MODEL WANTS TO BE ASKED (phase V2, docs/local-app/PLAN.md "V-E 6") - the writer's system prompt.
//
// In this order: what is true of every video prompt -> the RECIPE (a skill from the catalog, phase V6: its
// structure followed, its [gaps] filled from the person's message) -> the model's own rules, which OUTRANK the
// recipe (a template written for Seedance must not drag "[Image1]" or a thirty-second length into Grok) -> the
// answer as JSON.
//
// References are written NEUTRALLY - {{image:1}}, {{video:1}}, {{audio:1}} - and turned into each aggregator's
// own syntax only when a rung is asked (lib/video-models.js render), so one prompt survives a fallback from kie
// (@Image1) to Replicate ([Image1]).
//
// Spoken lines are NEVER translated (PLAN V-I): a line written in Russian is said in Russian.
//
// Kling motion control has no writer at all: the message box IS its prompt (the owner, 2026-10-05).
// ════════════════════════════════════════════════════════════════════════════

const COMMON = [
  'You write ONE prompt for a VIDEO model, in English, from what a person wrote - in any language - and what they attached.',
  'KEEP every fact the person stated that can be seen or heard; INVENT nothing they did not ask for. If they say only "make her turn", the prompt is about turning.',
  'REFERENCES are named neutrally: {{image:N}}, {{video:N}}, {{audio:N}}, numbered as listed below. Write the name where you mean that thing; never describe what a reference already shows beyond what is needed to say what it is FOR.',
  'SPOKEN WORDS stay in the language they were written in - never translated: write them in double quotes with the language named, e.g. says in Russian: "Привет, как дела?". Keep lines short.',
  'Plain sentences, not a list of keywords. No markdown.',
].join('\n');

const FAMILY = {
  grok: [
    'MODEL: Grok Imagine.',
    'With a picture: the picture is already decided - write what MOVES, not what is there. Subject, then camera, then the scene around, as plain sentences.',
    'One action, not a sequence of three: a short clip carries one thing happening. Be specific about how much and how fast it moves.',
    'Never write what to AVOID: this model reads a negative as an instruction and puts the thing in.',
    'Sound: the model makes its own. If the person asked for a line, music or an ambience, say it in one short sentence at the end.',
    'One paragraph.',
  ].join('\n'),
  seedance: [
    'MODEL: Seedance (ByteDance).',
    'Structure: who and what happens -> where -> how it is filmed (one camera movement per shot) -> style and light.',
    'Several shots in one clip: "Shot 1: ... Shot 2: ..." - only when the person asked for cuts.',
    'With references: say what each one is FOR - "the person from {{image:1}}", "moves like {{video:1}}", "in the room from {{image:2}}". With a first frame, describe the motion from it, not the frame.',
    'No subtitles, captions, logos or watermarks in the picture unless the person asked for text on screen - then quote it exactly.',
    'Dialogue: in double quotes, the language named, the speaker clear.',
  ].join('\n'),
};

const RULES = {
  grok: { family: 'grok' }, grok15: { family: 'grok' },
  sd2mini: { family: 'seedance' }, sd2: { family: 'seedance' }, sd25: { family: 'seedance' },
};

const rulesFor = (model) => RULES[model] || null;

/** What the attachments are, in the order their numbers refer to - the lines the writer reads them by. */
function listing(media) {
  const n = { image: 0, video: 0, audio: 0 };
  return (media || []).map(m => {
    const k = ['image', 'video', 'audio'].includes(m.kind) ? m.kind : 'image';
    n[k]++;
    const role = m.role ? ' - ' + String(m.role).replace(/-/g, ' ') : '';
    const span = k === 'video' && (+m.out > +m.in) ? ' (' + (+m.out - +m.in).toFixed(1) + ' s used)' : '';
    return '{{' + k + ':' + n[k] + '}}' + role + span;
  }).join('\n');
}

/** The writer's whole system prompt for this model, this send. */
function systemFor(model, o) {
  const r = rulesFor(model);
  if (!r) return '';
  const opts = o || {};
  const parts = [COMMON];
  if (opts.skill && String(opts.skill.text || '').trim()) {
    // (phase V6) The builder: the person's message IS the recipe's request with its places filled in, and the recipe
    // is the template it refers to.
    parts.push(opts.recipe
      ? 'RECIPE - the prompt template the person\'s request refers to ("the prompt template below"). Follow its structure and its advice; the request says what the clip is. Where the recipe disagrees with the MODEL rules below, the model rules win:\n' + String(opts.skill.text).trim()
      : 'RECIPE - follow its structure; fill its [gaps] from the person\'s message; where it disagrees with the MODEL rules below, the model rules win:\n' + String(opts.skill.text).trim());
  }
  parts.push(FAMILY[r.family]);
  if (opts.params) {
    const p = opts.params;
    parts.push('THE CLIP: ' + [p.duration ? p.duration + ' seconds' : '', p.aspect ? 'shape ' + p.aspect : '', p.audio === false ? 'no sound' : ''].filter(Boolean).join(', ') + '. Do not write the length or the shape into the prompt - they are settings.');
  }
  if (opts.max) parts.push('At most ' + opts.max + ' characters.');
  return parts.join('\n\n');
}

const ENVELOPE = 'Answer as ONE json object and nothing else: {"prompt": "<the finished prompt>"}. If you cannot tell what the person wants - which attachment is which, or what should happen - answer {"ask": "<one short question, in the language they wrote in>"} instead.';
// The builder (phase V6): the person reads the prompt and edits it before anything is made - so never a question: what
// the request leaves open is decided here, from the attachments and the recipe.
const ENVELOPE_RECIPE = 'Answer as ONE json object and nothing else: {"prompt": "<the finished prompt>"}. Never ask: where the request leaves something open, decide it from the attachments and the recipe. The person reads the prompt and edits it before the video is made.';

// Translation for Kling motion control's prompt (no writer there): the words only, nothing added.
const TRANSLATE = 'Translate the user\'s text into natural English for a video model\'s prompt. Keep every detail, add nothing, explain nothing. Quoted speech stays as written. Answer with the translation only.';

module.exports = { COMMON, FAMILY, rulesFor, systemFor, listing, ENVELOPE, ENVELOPE_RECIPE, TRANSLATE };
