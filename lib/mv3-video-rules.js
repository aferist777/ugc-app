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
// THE WRITER IS A PROMPT ENGINEER (phase V14, the owner 2026-10-07): it used to keep the person's facts and translate
// them, and improve nothing. Now it works in two layers - THEIR FACTS kept exactly, nothing new in the clip; THE CRAFT
// they left open (camera, light, lens, motion, texture, sound) chosen by it, to serve those facts. A camera instruction
// pasted from the almanac (vhelp.js) is one of their facts.
//
// (phase V15) A sound attached from the picker's voices is listed as a VOICE: a sample of how someone sounds, never a
// sound of the clip. Whose voice it is, the person's message says (the owner: a voice belongs to a character).
//
// (phase V15) The column's STORYBOARD: the writer first writes the sheet's prompt alone (`boardOnly`, the V8 sheet
// rules); the video is written later from the same message with the sheet among the pictures - listed, and named in
// the rules (`sheetAt`), as the storyboard the clip follows.
//
// (phase V16, the owner 2026-10-07) Seedance's FRAMES ("pictures are": the first frame, or the first and the last): the
// writer writes a DETAILED animation from the frames - with the person's words, or deciding the motion itself when
// there are none - and never asks. The prompt OPENS with our sentence, word for word (framesOpening): the clip starts
// exactly on the first frame (and ends exactly on the last) - "it is important", the owner said, that the video model
// is told so. Beside a clip or a sound the frames go as references (Seedance takes frames OR references), named by
// their numbers.
//
// Kling motion control has no writer at all: the message box IS its prompt (the owner, 2026-10-05; again 2026-10-07).
// ════════════════════════════════════════════════════════════════════════════

const COMMON = [
  'You are a professional prompt engineer for AI video models. From what a person wrote - in any language, in a word or at length - and what they attached, you write ONE prompt in English that gets this model to make the clip they mean, as well as it can be made.',
  'You work in TWO LAYERS.',
  '1. THEIR FACTS - who is in it, what happens, where, every spoken line, any text on screen, what each attachment is for, and whatever they said about the camera, the light or the style. Keep every one exactly, and add no person, animal, product, action or text they did not ask for: if they say only "make her turn", she turns and nothing else happens.',
  '2. THE CRAFT they left open - decide it as a director of photography would, to serve their facts and to agree with what the attachments show: one clear camera movement for the shot and how close it is; the light and the time of day; the lens and the depth of field; how much and how fast things move, beat by beat across the clip; texture and realism; the setting\'s detail - surface, background, atmosphere - where neither their words nor an attachment shows the place; the sound or ambience where the model makes sound. Choose concretely and briefly; never against a fact or an attachment.',
  'A camera instruction they pasted (it often starts "Camera:") is one of their facts: keep it, in its own words, add no second camera movement, and build the rest around it.',
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
// `seen` (review V7): what the writer was really sent - { pics: false } when the pictures could not be shown, and
// `clips[i]` false for a clip whose three frames could not be; without it everything listed is taken as shown.
function listing(media, seen) {
  const n = { image: 0, video: 0, audio: 0 };
  const sawPics = !seen || seen.pics !== false;
  return (media || []).map(m => {
    const k = ['image', 'video', 'audio'].includes(m.kind) ? m.kind : 'image';
    n[k]++;
    // (phase V6) The name of a recipe's slot goes with its role - a floor plan and the renders are both "location".
    const r = m.role ? String(m.role).replace(/-/g, ' ') : '';
    const name = m.label && String(m.label).toLowerCase() !== r.toLowerCase() ? String(m.label).slice(0, 40) : '';
    const role = name ? ' - ' + name + (r ? ' (' + r + ')' : '') : r ? ' - ' + r : '';
    const span = (k === 'video' || k === 'audio') && (+m.out > +m.in) ? ' (' + (+m.out - +m.in).toFixed(1) + ' s used)' : '';
    // (phase V7) A clip is seen as three of its frames, after the pictures - so its look is known, not guessed.
    const sawClip = !seen || !Array.isArray(seen.clips) || seen.clips[n.video - 1] !== false;
    // (phase V16) A frame is said as what it is - where the clip starts, or ends.
    const frame = k === 'image' && m.role === 'frame-first' ? ' - the FIRST FRAME: the clip starts exactly on this picture'
      : k === 'image' && m.role === 'frame-last' ? ' - the LAST FRAME: the clip ends exactly on this picture' : '';
    // (phase V15) A voice is how someone sounds - the message says whose; it is not music or a sound of the clip.
    const voice = k === 'audio' && m.role === 'voice'
      ? ' - a SAMPLE of a voice, not a sound for the clip: the spoken words of the one the message gives it to are said in this voice'
      : k === 'image' && m.role === 'storyboard' ? ' - the STORYBOARD SHEET drawn for this clip: the video follows it panel by panel' : '';
    const look = k === 'video'
      ? (sawClip ? ' - you see three of its frames (start, middle, end) after the pictures you see; they are this clip, not pictures of their own'
        : ' - you do not see its frames: work from its role and the request')
      : (k === 'image' && !sawPics ? ' - you cannot see it: work from its role and the request' : '');
    return '{{' + k + ':' + n[k] + '}}' + (frame || role) + span + look + voice;
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
  // (phase V8) A two-step recipe: a storyboard sheet first, the video from it - both prompts in one answer.
  if (opts.twoStep) parts.push(twoStepRules(opts.boardIndex || 1, (opts.params || {}).duration));
  // (phase V15) The column's storyboard: the sheet's prompt alone - the video model's own rules are for later.
  if (opts.boardOnly) parts.push(boardOnlyRules((opts.params || {}).duration));
  else parts.push(FAMILY[r.family]);
  // (phase V16) Seedance's frames: the animation from the first frame (to the last).
  if (opts.frames && !opts.boardOnly && !opts.twoStep) parts.push(framesRules(opts.frames, (opts.params || {}).duration));
  // (phase V15) A sheet among the pictures of a plain message: the video follows it.
  if (!opts.twoStep && !opts.boardOnly && opts.sheetAt > 0) parts.push(sheetRule(opts.sheetAt));
  if (opts.params) {
    const p = opts.params;
    parts.push((opts.boardOnly ? 'THE CLIP the sheet is for: ' : 'THE CLIP: ') + [p.duration ? p.duration + ' seconds' : '', p.aspect ? 'shape ' + p.aspect : '', p.audio === false ? 'no sound' : ''].filter(Boolean).join(', ')
      + (opts.boardOnly ? '.' : '. Do not write the length or the shape into the prompt - they are settings.'));
  }
  if (opts.max) parts.push((opts.twoStep ? 'The video prompt: at most ' : 'At most ') + opts.max + ' characters.');
  return parts.join('\n\n');
}

const ENVELOPE = 'Answer as ONE json object and nothing else: {"prompt": "<the finished prompt>"}. If you cannot tell what the person wants - which attachment is which, or what should happen - answer {"ask": "<one short question, in the language they wrote in>"} instead.';
// (phase V8, PLAN V-G) TWO STEPS: a picture model draws a storyboard sheet, then the video model follows it. The sheet's
// shapes are the ones the picture model makes (lib/mv3-img.js ASPECTS); the sheet comes to the video as the LAST picture.
const BOARD_ASPECTS = ['9:16', '16:9', '1:1', '4:3', '3:4', '3:2', '2:3', '21:9'];
// (review V8) What the picture model is told is the picture model's own grammar (lib/mv3-prompt-rules.js nano-banana-2):
// references as "Image N", words in quotes are DRAWN, and a thing named to be avoided is put in - so the sheet is
// described as what it shows. These rules outrank the recipe: the storyboard template's own structure asks for
// information cards and annotations, which would be drawn on the sheet and carried into the clip.
const BOARD_CHARS = 4000;
const sheetRules = (secs) => 'THE STORYBOARD PROMPT, for a picture model: one single-page sheet of numbered, clean panels in reading order, '
  + (+secs > 0 ? 'as many as fit ' + (+secs) + ' seconds at 1.5-3 seconds a panel (the length is a setting and wins over any length in the request), never more than 15'
               : 'at most 15, one per beat of 1.5-3 seconds of the clip')
  + '. Each panel a clear frame of its beat - who, what, where, how it is framed - with the same people, clothes and place in every panel. Name the attached pictures Image 1, Image 2 and so on, in the order they are listed (never {{image:N}} in this prompt), and say what each one carries onto the sheet. The sheet is pictures only: the one writing on it anywhere is each panel\'s number in a corner, plain gutters between the panels. Describe speech as what is seen - a person talking to the camera - and never put words in quotes in this prompt: this model draws quoted words onto the picture. Say what the sheet shows, never what it must not - this model draws what it is told to avoid. At most ' + BOARD_CHARS + ' characters. Choose the sheet\'s shape from ' + BOARD_ASPECTS.join(', ') + ' to fit the grid of panels.';
const twoStepRules = (k, secs) => [
  'TWO STEPS - these rules OUTRANK the recipe and the request wherever they differ (a request for one prompt still gets both): a picture model first draws a STORYBOARD SHEET, then the video model makes the clip from it. Write BOTH prompts.',
  sheetRules(secs),
  'THE VIDEO PROMPT: the storyboard sheet is {{image:' + k + '}} - it comes after the attached pictures; write {{image:' + k + '}} where you mean the sheet, and the attached pictures by their own {{image:N}} for what each is for. Tell the model to follow the sheet panel by panel, from the first to the last, over the length of the clip, and describe the movement between the panels, not the panels again.',
].join('\n');
// (phase V15) The column's storyboard, step 1: the sheet alone. These rules outrank the message where they differ - a
// message asking for one prompt still gets the sheet's.
const boardOnlyRules = (secs) => [
  'A STORYBOARD FIRST - these rules OUTRANK the message wherever they differ: a picture model draws a STORYBOARD SHEET for the clip the person describes, and the video is written later from the same message with the sheet attached. Write ONLY the storyboard prompt now: their facts in every panel, the craft - framing, light, the beat of each panel - chosen for them.',
  sheetRules(secs),
].join('\n');
// (phase V15) A plain message whose pictures hold the sheet drawn for it: the clip follows it.
const sheetRule = (k) => 'THE STORYBOARD: {{image:' + k + '}} is a storyboard sheet of numbered panels drawn for this clip from the same message. Tell the model to follow it panel by panel, from the first to the last, over the length of the clip, and write the movement between the panels, not the panels again; the other pictures keep what each is for.';
// (phase V16, the owner 2026-10-07) FRAMES: `fr` = { kind: 'first' | 'fl', first, last, asRefs } - the numbers of the
// frames among the pictures, and whether they go as references (beside a clip or a sound). The writer does not write
// the opening sentence: it is ours (framesOpening), put before its prompt word for word.
function framesRules(fr, secs) {
  const fl = fr.kind === 'fl';
  const A = '{{image:' + fr.first + '}}', B = '{{image:' + fr.last + '}}';
  return [
    'FRAMES - these rules OUTRANK the message wherever they differ. ' + A + ' is the FIRST FRAME: the clip starts exactly on that picture.'
      + (fl ? ' ' + B + ' is the LAST FRAME: the clip ends exactly on that picture.' : ''),
    'Write a DETAILED animation prompt ' + (fl ? 'for the way from the first frame to the last' : 'for what happens from the first frame on') + ', beat by beat over the clip\'s '
      + (+secs > 0 ? (+secs) + ' seconds' : 'length') + ': who moves, how much and how fast; the face, the hands and the body; what the camera does; the light, if it changes; the sound.',
    fl ? 'Everything that differs between the two frames happens on screen, in an order that reads as natural: nothing jumps, nothing appears from nowhere, and the last beat lands exactly on the last frame.'
      : 'Continue what the picture holds: one natural movement that follows from it.',
    'The people, their faces, their clothes and the place stay exactly as the frames show them. Describe what CHANGES, not what the frames already show, and add no person or object the frames do not hold unless the message asks for one.',
    'If the message says little or nothing, decide yourself a natural motion that fits ' + (fl ? 'both frames and leads from one to the other' : 'the frame') + '.',
    fr.asRefs ? 'The frames go to the model as reference pictures beside the clips and sounds here: name them ' + A + (fl ? ' and ' + B : '') + ' wherever you mean them. A clip is what the message names it for - a movement to follow, a performance; if it does not say, it is the sample of the motion. A sound is what the message names it for - a voice, music, an effect; if it does not say, it is the sound of the clip.' : '',
    'Do NOT open with the frames: the sentence saying that the clip starts exactly on the first frame' + (fl ? ' and ends exactly on the last' : '') + ' is put before your prompt word for word. Begin with what happens.',
  ].filter(Boolean).join('\n');
}
// The sentence a frames prompt OPENS with - ours, so the video model is told the same way every time. In the model's
// own frames mode the frames are no references - they are named in words (lib/video-models.js render); beside a clip
// or a sound they are references, named by their numbers.
function framesOpening(fr) {
  if (!fr || !fr.kind) return '';
  const A = '{{image:' + fr.first + '}}', B = '{{image:' + fr.last + '}}';
  if (fr.asRefs) {
    return fr.kind === 'fl'
      ? A + ' is the first frame and ' + B + ' is the last frame: the video starts exactly on ' + A + ' and ends exactly on ' + B + '.'
      : A + ' is the first frame: the video starts exactly on ' + A + ' and moves on from it.';
  }
  return fr.kind === 'fl'
    ? 'The video starts exactly on the first frame and ends exactly on the last frame.'
    : 'The video starts exactly on the first frame - the picture given is its very first frame - and moves on from it.';
}
// (phase V16) Frames with the writer off: written all the same, and sent as written - never a question.
const ENVELOPE_FRAMES = 'Answer as ONE json object and nothing else: {"prompt": "<the finished prompt>"}. Never ask: where the message leaves something open, decide it from the frames and the attachments. The prompt goes to the video model as it is.';
// (phase V16) The writer stopping for a look (the plain chat with the writer on): never a question - the person reads
// the prompt and edits it before the video is made.
const ENVELOPE_REVIEW = 'Answer as ONE json object and nothing else: {"prompt": "<the finished prompt>"}. Never ask: where the message leaves something open, decide it from the attachments. The person reads the prompt and edits it before the video is made.';
// (phase V15) The column's storyboard: the sheet's prompt alone, never a question - the person sees the sheet before
// anything else is made.
const ENVELOPE_BOARD = 'Answer as ONE json object and nothing else: {"board": "<the storyboard sheet prompt>", "boardAspect": "<one of the sheet shapes>"}. Never ask: where the message leaves something open, decide it from the attachments. The person sees the sheet before the video is made.';
const ENVELOPE_TWO_STEP = 'Answer as ONE json object and nothing else: {"board": "<the storyboard sheet prompt>", "boardAspect": "<one of the sheet shapes>", "prompt": "<the video prompt>"}. Never ask: where the request leaves something open, decide it from the attachments and the recipe. The person reads both prompts and edits them before anything is made.';

// The builder (phase V6): the person reads the prompt and edits it before anything is made - so never a question: what
// the request leaves open is decided here, from the attachments and the recipe.
const ENVELOPE_RECIPE = 'Answer as ONE json object and nothing else: {"prompt": "<the finished prompt>"}. Never ask: where the request leaves something open, decide it from the attachments and the recipe. The person reads the prompt and edits it before the video is made.';

// Translation for Kling motion control's prompt (no writer there): the words only, nothing added.
const TRANSLATE = 'Translate the user\'s text into natural English for a video model\'s prompt. Keep every detail, add nothing, explain nothing. Quoted speech stays as written. Answer with the translation only.';

// (phase V6, PLAN V-I) The builder's 中文 box: a finished English prompt into Chinese for Seedance. What must not change -
// the references and every quoted line (spoken words are never translated) - reaches the translator as markers.
const TO_CHINESE = 'Translate this video model prompt into natural Simplified Chinese, as Chinese prompts for the Seedance video model are written. Keep every detail, add nothing, explain nothing. Markers like ⟦1⟧ stand for references and quoted lines: keep every marker exactly as it is, once, where it belongs in the sentence. Answer with the translation only.';

module.exports = { COMMON, FAMILY, rulesFor, systemFor, listing, ENVELOPE, ENVELOPE_RECIPE, ENVELOPE_TWO_STEP, ENVELOPE_BOARD, ENVELOPE_REVIEW, ENVELOPE_FRAMES,
                   BOARD_ASPECTS, BOARD_CHARS, framesOpening, TRANSLATE, TO_CHINESE };
