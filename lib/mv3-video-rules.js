'use strict';

// ════════════════════════════════════════════════════════════════════════════
// HOW EACH VIDEO MODEL WANTS TO BE ASKED (phase V2, docs/local-app/PLAN.md "V-E 6") - the writer's system prompt.
//
// In this order: what is true of every video prompt -> the model's own rules (or the storyboard's, the frames') -> the
// clip's settings -> the answer as JSON.
//
// References are written NEUTRALLY - {{image:1}}, {{video:1}}, {{audio:1}} - and turned into each aggregator's
// own syntax only when a rung is asked (lib/video-models.js render), so one prompt survives a fallback from kie
// (@Image1) to Replicate ([Image1]).
//
// Spoken lines are ENGLISH (phase V29, the owner 2026-10-14 - it was PLAN V-I's "never translated" before): a line
// written in another language is translated and said in English. Nothing goes to a model in another language.
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
// Kling motion control's VIDEO has no writer: with the writer off the message box IS its prompt (the owner, 2026-10-05;
// again 2026-10-07); with it on the writer writes the FIRST FRAME's picture (FRAME_RULES, phase V17) and Kling gets its
// standard prompt.
// ════════════════════════════════════════════════════════════════════════════

const COMMON = [
  'You are a professional prompt engineer for AI video models. From what a person wrote - in any language, in a word or at length - and what they attached, you write ONE prompt in English that gets this model to make the clip they mean, as well as it can be made.',
  'You work in TWO LAYERS.',
  '1. THEIR FACTS - who is in it, what happens, where, every spoken line, any text on screen, what each attachment is for, and whatever they said about the camera, the light or the style. Keep every one exactly, and add no person, animal, product, action or text they did not ask for: if they say only "make her turn", she turns and nothing else happens.',
  '2. THE CRAFT they left open - decide it as a director of photography would, to serve their facts and to agree with what the attachments show: one clear camera movement for the shot and how close it is; the light and the time of day; the lens and the depth of field; how much and how fast things move, beat by beat across the clip; texture and realism; the setting\'s detail - surface, background, atmosphere - where neither their words nor an attachment shows the place; the sound or ambience where the model makes sound. Choose concretely and briefly; never against a fact or an attachment.',
  'A camera instruction they pasted (it often starts "Camera:") is one of their facts: keep it, in its own words, add no second camera movement, and build the rest around it.',
  'REFERENCES are named neutrally: {{image:N}}, {{video:N}}, {{audio:N}}, numbered as listed below. Write the name where you mean that thing; never describe what a reference already shows beyond what is needed to say what it is FOR.',
  'SPOKEN WORDS are English: a line written in another language is translated into natural spoken English, keeping its meaning and tone. Write each line in double quotes, the speaker clear, e.g. she says: "Hi, how are you?". Keep lines short.',
  'Plain sentences, not a list of keywords. No markdown.',
].join('\n');

const FAMILY = {
  grok: [
    'MODEL: Grok Imagine.',
    'With a picture: the picture is already decided - write what MOVES, not what is there. Subject, then camera, then the scene around, as plain sentences.',
    'With SEVERAL pictures they are references, not the first frame: say what each one is FOR - "the woman from {{image:1}}", "in the room from {{image:2}}" - and write the whole shot: who, where, what happens, how it is filmed.',
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
    'Dialogue: in English, in double quotes, the speaker clear.',
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
    // (phase V6) The name an attachment carries - its place in the zone, a voice's name - goes with its role.
    const r = m.role ? String(m.role).replace(/-/g, ' ') : '';
    const name = m.label && String(m.label).toLowerCase() !== r.toLowerCase() ? String(m.label).slice(0, 40) : '';
    const role = name ? ' - ' + name + (r ? ' (' + r + ')' : '') : r ? ' - ' + r : '';
    const span = (k === 'video' || k === 'audio') && (+m.out > +m.in) ? ' (' + (+m.out - +m.in).toFixed(1) + ' s used)' : '';
    // (phase V7) A clip is seen as three of its frames, after the pictures - so its look is known, not guessed.
    // (phase V48) Or WATCHED whole by an agent, its description below the request ('watched').
    const how = seen && Array.isArray(seen.clips) ? seen.clips[n.video - 1] : true;
    const sawClip = how !== false;
    // (phase V16) A frame is said as what it is - where the clip starts, or ends.
    const frame = k === 'image' && m.role === 'frame-first' ? ' - the FIRST FRAME: the clip starts exactly on this picture'
      : k === 'image' && m.role === 'frame-last' ? ' - the LAST FRAME: the clip ends exactly on this picture' : '';
    // (phase V15) A voice is how someone sounds - the message says whose; it is not music or a sound of the clip.
    const voice = k === 'audio' && m.role === 'voice'
      ? ' - a SAMPLE of a voice, not a sound for the clip: the spoken words of the one the message gives it to are said in this voice'
      : k === 'image' && m.role === 'storyboard' ? ' - the STORYBOARD SHEET drawn for this clip: the video follows it panel by panel' : '';
    const look = k === 'video'
      ? (how === 'watched' ? ' - WATCHED whole, with its sound: what happens in it, second by second, is written below the request'
        : sawClip ? ' - you see three of its frames (start, middle, end) after the pictures you see; they are this clip, not pictures of their own'
        : ' - you do not see its frames: work from its role and the request')
      : (k === 'image' && !sawPics ? ' - you cannot see it: work from its role and the request' : '');
    return '{{' + k + ':' + n[k] + '}}' + (frame || role) + span + look + voice;
  }).join('\n');
}

// (phase V47, the owner's answers (д4), (д4.2)) SEVERAL CLIPS beside Seedance: each is a reference the prompt says what it
// is for. A prompt that changes one of them reads to Seedance 2.5 as EDITING that clip, and an edit takes only the clip's
// own length - beside other clips, with the column's length, it is refused.
const SEVERAL_CLIPS = 'SEVERAL CLIPS - each one is a reference: say what it is FOR - "moves like {{video:1}}", "in the room from {{video:2}}", "the camera moves like in {{video:3}}". Never write the prompt as a change to one of them ("replace the woman in {{video:1}}", "change the background of {{video:2}}"): the model takes that as editing that clip, and an edit beside other clips is refused. What they want changed in a clip is written as a new clip made from the references.';

// (phase V48, the owner 2026-10-25) THE CLIPS WATCHED WHOLE (lib/clip-watch.js): their descriptions come below the request,
// and a replacement is written from them - which person, then what they do and say, each at its moment. Seedance 2.0 does
// not follow seconds and may break on them (V26.8, the owner's (я9)): its beats are tied to the words and to one another;
// 2.5 may be told a moment. `boardOnly` - the column's storyboard: the panels follow the clip's beats.
function watchedRules(model, boardOnly) {
  if (boardOnly) {
    return 'THE CLIPS WERE WATCHED: each clip listed as watched is described below the request, from its whole part with its sound - who is in it (each person by a letter), what each one does and says and when, the camera, the place. It is what the clip shows: the panels follow its beats in their order, never a guess.';
  }
  return [
    'THE CLIPS WERE WATCHED: each clip listed as watched is described below the request, from its whole part with its sound - who is in it (each person by a letter), what each one does and says and when, the camera, the place and the light, the sounds. It is what the clip shows: build on it, never on a guess.',
    'A REPLACEMENT - a character from a picture in place of someone of the clip ("my character in this video", "replace the woman"): say which person of the clip is replaced, in words the model can see - where they are in the frame, what they wear; their look is the picture\'s now, so write nothing of the replaced face, hair or clothes. Then what they do, beat by beat in the clip\'s order, each action at its moment - the body, the hands, the head and the eyes, what they hold, where they move - and every line they say, word for word in double quotes. Here this IS what the clip is for, and it is written out. '
      + (model === 'sd25' ? 'A beat may carry its moment, "at about 3 s".' : 'Tie each beat to the words said on it or to the beat before it ("as she says ...", "then") - no seconds: this model does not follow them.'),
    'Everything else of the clip - the other people, the place, the camera, the light, the sound - stays as it is: name it only where the replacement touches it.',
    'Several clips: what each one is FOR comes from what its description says it holds.',
    'Never copy a description whole into the prompt: take what the clip being written needs, within its length.',
  ].join('\n');
}

/** The writer's whole system prompt for this model, this send. `o.media`: what is attached (phase V47: one Seedance clip
 *  is the clip's length and shape; several are references). */
function systemFor(model, o) {
  const r = rulesFor(model);
  if (!r) return '';
  const opts = o || {};
  // (phase V47) One Seedance clip decides the length and the shape (lib/video-models.js byClip): the column's are not sent.
  const clips = (Array.isArray(opts.media) ? opts.media : []).filter(m => m && m.kind === 'video');
  const oneClip = r.family === 'seedance' && clips.length === 1 ? clips[0] : null;
  const clipSecs = oneClip && +oneClip.out > +oneClip.in ? Math.round((+oneClip.out - +oneClip.in) * 10) / 10 : 0;
  const secs = oneClip ? clipSecs : (opts.params || {}).duration;
  const parts = [COMMON];
  // (phase V15) The column's storyboard: the sheet's prompt alone - the video model's own rules are for later.
  if (opts.boardOnly) parts.push(boardOnlyRules(secs));
  else parts.push(FAMILY[r.family]);
  // (phase V16) Seedance's frames: the animation from the first frame (to the last).
  if (opts.frames && !opts.boardOnly) parts.push(framesRules(opts.frames, secs));
  // (phase V15) A sheet among the pictures of a plain message: the video follows it.
  if (!opts.boardOnly && opts.sheetAt > 0) parts.push(sheetRule(opts.sheetAt));
  if (r.family === 'seedance' && clips.length > 1 && !opts.boardOnly) parts.push(SEVERAL_CLIPS);
  // (phase V48) Clips an agent watched whole: the writer writes from their descriptions.
  if (r.family === 'seedance' && opts.watched > 0) parts.push(watchedRules(model, !!opts.boardOnly));
  if (opts.params) {
    const p = opts.params;
    const size = oneClip ? ['as long as {{video:1}}' + (clipSecs ? ' (' + clipSecs + ' seconds)' : ''), 'in its shape']
      : [p.duration ? p.duration + ' seconds' : '', p.aspect ? 'shape ' + p.aspect : ''];
    parts.push((opts.boardOnly ? 'THE CLIP the sheet is for: ' : 'THE CLIP: ') + size.concat(p.audio === false ? 'no sound' : '').filter(Boolean).join(', ')
      + (opts.boardOnly ? '.' : '. Do not write the length or the shape into the prompt - they are settings.'));
  }
  if (opts.max) parts.push('At most ' + opts.max + ' characters.');
  return parts.join('\n\n');
}

const ENVELOPE = 'Answer as ONE json object and nothing else: {"prompt": "<the finished prompt>"}. If you cannot tell what the person wants - which attachment is which, or what should happen - answer {"ask": "<one short question, in English>"} instead.';
// (phase V8, PLAN V-G) TWO STEPS: a picture model draws a storyboard sheet, then the video model follows it. The sheet's
// shapes are the ones the picture model makes (lib/mv3-img.js ASPECTS); the sheet comes to the video as the LAST picture.
const BOARD_ASPECTS = ['9:16', '16:9', '1:1', '4:3', '3:4', '3:2', '2:3', '21:9'];
// (review V8) What the picture model is told is the picture model's own grammar (lib/mv3-prompt-rules.js nano-banana-2):
// references as "Image N", words in quotes are DRAWN, and a thing named to be avoided is put in - so the sheet is
// described as what it shows: information cards and annotations would be drawn on the sheet and carried into the clip.
const BOARD_CHARS = 4000;
const sheetRules = (secs) => 'THE STORYBOARD PROMPT, for a picture model: one single-page sheet of numbered, clean panels in reading order, '
  + (+secs > 0 ? 'as many as fit ' + (+secs) + ' seconds at 1.5-3 seconds a panel (the length is a setting and wins over any length in the request), never more than 15'
               : 'at most 15, one per beat of 1.5-3 seconds of the clip')
  + '. Each panel a clear frame of its beat - who, what, where, how it is framed - with the same people, clothes and place in every panel. Name the attached pictures Image 1, Image 2 and so on, in the order they are listed (never {{image:N}} in this prompt), and say what each one carries onto the sheet. The sheet is pictures only: the one writing on it anywhere is each panel\'s number in a corner, plain gutters between the panels. Describe speech as what is seen - a person talking to the camera - and never put words in quotes in this prompt: this model draws quoted words onto the picture. Say what the sheet shows, never what it must not - this model draws what it is told to avoid. At most ' + BOARD_CHARS + ' characters. Choose the sheet\'s shape from ' + BOARD_ASPECTS.join(', ') + ' to fit the grid of panels.';
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

// (phase V17, the owner 2026-10-08) KLING MOTION CONTROL'S FIRST FRAME: a picture model (nano-banana-2) redraws a still of
// the clip with the person's character in it, and Kling then moves that picture with the clip from that moment. The writer
// sees the still and the person's pictures and writes the picture's prompt - what comes from which picture as the person
// said it, or worked out from the pictures - and above all the character in the still's pose.
const FRAME_RULES = [
  'You write ONE prompt for a picture model (nano-banana-2) that redraws a still of a video clip with the person\'s character in it. A video model (Kling motion control) then moves that picture with the clip from this very moment, so the picture you describe is the FIRST FRAME of the video.',
  'REFERENCES: {{video:1}} is the still of the clip; {{image:1}}, {{image:2}} and on are the person\'s own pictures, numbered as they attached them - when they say "the first picture" they mean {{image:1}}. Write these names where you mean the pictures; they are turned into the picture model\'s own.',
  'In this order of importance:',
  '1. THE POSE - above everything: the character is in EXACTLY the pose of the person in {{video:1}} - the body, the arms and legs, the turn of the head and the gaze - with the same framing, camera angle, lens and shot size, the figure the same size and in the same place in the frame. The video starts from this frame and follows the clip\'s moves from it.',
  '2. WHAT COMES FROM WHERE, as the person said it: when their words say which picture gives what - the character from one, the place from another, clothes or a thing from a third ("put the hat from the third on her head", "dress him in the jacket from picture 2") - pass it on exactly, each picture by its reference with its job, and never mix them up.',
  '3. When they said nothing about it, work out each picture\'s job from what it shows: a person is the character - the face, hair, body AND their clothes, the look; a place without people is the setting; clothes alone go on the character; an object goes where it naturally belongs, or where the words put it. With two pictures it is most often a character and a place, or a character and clothes.',
  '4. With no picture of a place, the setting of {{video:1}} stays exactly as it is - the room, the furniture, the light: only the person changes.',
  '5. The person of the clip is replaced entirely - nothing of their face, hair or clothes stays - and the frame shows one person, the character, unless the words ask for more.',
  'Describe the finished picture as ONE paragraph of plain sentences, 80-200 words: who, in which pose, wearing what, where, how it is framed and lit. Say what is there, never what is not - this model draws what it is told to avoid. Nothing is written on the picture.',
].join('\n');
const ENVELOPE_FRAME = 'Answer as ONE json object and nothing else: {"prompt": "<the picture prompt>"}. Never ask: where the words leave something open, decide it from the pictures. The person reads the prompt and edits it before the picture is drawn.';

// Translation for Kling motion control's prompt (the writer off - no writer there): the words only, nothing added.
// (phase V29, the owner 2026-10-14) Quoted speech is translated too: everything a model hears or says is English.
const TRANSLATE = 'Translate the user\'s text into natural English for a video model\'s prompt. Keep every detail, add nothing, explain nothing. Quoted speech is translated too, and stays in quotes. Keep references like {{image:1}} exactly as they are. Answer with the translation only.';

// (phase V29) Lines of a spoken script typed in another language (lib/mv3-agent.js toEnglishLines): numbered, all of them,
// so each is translated among its neighbours; JSON back, one entry per line.
const TRANSLATE_LINES = 'You translate the lines of a short video\'s spoken script into natural spoken English, as a native speaker would say them aloud. You get the lines numbered [1], [2]...; translate each one where it stands, keeping its meaning, its tone and its register - add nothing, drop nothing, explain nothing. A line already in English comes back as it is. Anything in square brackets inside a line is a direction for the voice: keep it as it is. Answer as ONE json object and nothing else: {"lines": ["<line 1>", "<line 2>", ...]} - exactly as many lines as you were given, in the same order.';

module.exports = { COMMON, FAMILY, rulesFor, systemFor, listing, watchedRules, ENVELOPE, ENVELOPE_BOARD, ENVELOPE_REVIEW, ENVELOPE_FRAMES,
                   BOARD_ASPECTS, BOARD_CHARS, framesOpening, FRAME_RULES, ENVELOPE_FRAME, TRANSLATE, TRANSLATE_LINES };
