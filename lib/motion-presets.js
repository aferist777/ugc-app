// Scenarios v3 — how the character moves while a fragment is lipsynced.
//
// The whole vocabulary of a talking-head avatar model is one optional `prompt` next to
// the still and the audio. It is not a camera language: the model keeps the person
// exactly where the frame put them, so anything about walking, cuts, zooms or new
// angles is text it will read and ignore. What it does hear is EXPRESSION, HEAD and
// HANDS, and kie's own advice is to keep the prompt short and structured — who is in
// shot, what they feel, how they move.
//
// One preset covers the whole script: the same sentence goes to every fragment. That is
// deliberate rather than lazy — the prompt travels together with the frame, which the
// model can already see, so a per-line rewrite would only restate the picture.

// ── the presets ─────────────────────────────────────────────────────────────
// `prompt` is what reaches the model.
const MOTION_PRESETS = [
  {
    id: 'minimal-natural',
    label: 'Minimal & natural',
    prompt: 'Speaking calmly to camera. Relaxed neutral expression, natural blinking, '
          + 'small head movements on stressed words, shoulders still.',
  },
  {
    id: 'hands',
    label: 'Talking with hands',
    prompt: 'Speaking to camera with easy hand gestures inside the frame, open palms, '
          + 'each gesture landing on a stressed word. Warm engaged expression.',
  },
  {
    id: 'upbeat',
    label: 'Upbeat & energetic',
    prompt: 'Speaking to camera with bright energy. Raised eyebrows, wide alert eyes, '
          + 'quick head accents, frequent small smiles.',
  },
  {
    id: 'explaining',
    label: 'Explaining',
    prompt: 'Explaining to camera. Slight head tilts on each point, brows drawing '
          + 'together in concentration, small enumerating hand movements.',
  },
  {
    id: 'skeptical-convinced',
    label: 'Skeptical to convinced',
    prompt: 'Starts guarded with a slight frown and narrowed eyes, then opens up across '
          + 'the line: brows lift, the expression warms, a small nod at the end.',
  },
  {
    id: 'deadpan',
    label: 'Deadpan straight talk',
    prompt: 'Speaking to camera almost motionless. Steady unwavering gaze, flat serious '
          + 'expression, no smile, minimal head movement.',
  },
];

const DEFAULT_PRESET = 'minimal-natural';

const presetById = (id) => MOTION_PRESETS.find(p => p.id === id) || null;
// What actually reaches the model for a given choice, falling back to the default
// rather than sending nothing: an empty prompt lets the model invent its own idea.
const promptFor = (id) => (presetById(id) || presetById(DEFAULT_PRESET)).prompt;

// ── Kling avatar's qualities ────────────────────────────────────────────────
// Kling avatar's two tiers differ in nothing a user cares about except how sharp the clip is
// and what it costs — so the page asks about QUALITY and resolves the tier here. (Which model
// films a talking head - Kling or a Seedance - is lib/th-video.js.)
//
// maxAudioSec is the real constraint on how long a fragment may be: past it the read is
// refused before it is sent, because the model will not animate it. kie.ai's own listing
// for these avatar models is far above 15s (their Avatar 2.0 page advertises minutes, the
// official Kling API documents 2-300s), so 15 would cost split sentences for nothing. 30 is
// a deliberate half-step: high
// enough to stop breaking ordinary reads, low enough that we are not betting a batch on
// a number no page states for THESE two model ids. Raise it when a longer read renders.
const VIDEO_QUALITIES = [
  { id: '720p',  label: '720p',  model: 'kling/ai-avatar-standard', pricePerSec: 0.04, maxAudioSec: 30 },
  { id: '1080p', label: '1080p', model: 'kling/ai-avatar-pro',      pricePerSec: 0.08, maxAudioSec: 30 },
];

const DEFAULT_QUALITY = '720p';

const qualityById = (id) => VIDEO_QUALITIES.find(q => q.id === id) || null;

// ── the mood of the narration ───────────────────────────────────────────────
// THE EMOTION OF THE WHOLE VIDEO, chosen once per project - and ONE
// vocabulary for everything made from it:
//
//   label     the menu
//   about     the one line under the menu, for the person choosing
//   brief     what the tagger is told: the arc of the read, where a tag earns its place, what to
//             leave plain (routes/scen3.js, _tagPrompt)
//   tags      the ONLY ElevenLabs v3 tags the tagger may put on this mood's lines. Wide on purpose,
//             two dozen each: a narrow list forces the same four tags onto every line, and the
//             discipline comes from the brief. Every one is a tag ElevenLabs v3 knows - a tag
//             the model does not know is liable to be SPOKEN.
//   face      the expression, for the frames and the animation of the person. It says how the face
//             LOOKS, never that the mouth is still while the person is talking: what they say is
//             said out loud, and a prompt that stills the mouth fights the lipsync.
//   gestures  the body and the hands, for the same
//   gloss     a few words on how the body moves, for the menu of gestures a Seedance talking head is
//             filmed by (the project's mood by default, another mood's when picked)
//   motion    that way of moving in full - the head, the hands, the body - for the writer of a Seedance
//             talking head's prompt; `gestures` stays the one sentence Kling's writer reads
const MOODS = [
  { id: 'sincere', label: 'Calm and sincere', gloss: 'small, close to the body',
    motion: { head: 'The head stays mostly level and still; slow, small nods on the words that matter; a slight tilt while a thought is weighed.',
      hands: 'The hands low and relaxed, close to the body; now and then one opens a little, palm up, on a key point, then settles again.',
      body: 'Shoulders loose and down, an open, unhurried posture; the weight steady, a slow lean toward the lens on the sentence that carries the claim.' },
    about: 'Unhurried and honest, like telling a friend. For claims that need to sound true.',
    brief: 'Someone explaining something they know well, with nothing to prove. The voice stays level throughout; persuasion comes from pacing, not volume. Put pauses before the claims that matter so they have room to land, and soft emphasis on the single word that carries each sentence. No laughter, no rising energy, nothing performed - the moment it sounds like selling, the read has failed.',
    tags: ['calm', 'natural tone', 'conversational tone', 'slow and deliberate', 'slows down', 'softly', 'quietly', 'earnestly', 'convincingly', 'firmly', 'brief pause', 'pauses', 'long pause', 'after a moment', 'soft emphasis', 'emphasized', 'deep breath', 'exhale slowly', 'confident', 'reflective', 'grateful', 'understated', 'warmly'],
    face: 'Warm eyes, relaxed brows, soft half-smiles; the face listens as much as it speaks, and nothing is performed.',
    gestures: 'Relaxed open posture, small natural hand movements close to the body, slow nods on the points that matter, no big moves.' },
  { id: 'excited', label: 'Energetic, excited', gloss: 'big gestures on the stressed words',
    motion: { head: 'Quick head accents on the stressed words, the chin lifting with the good news; small fast nods; the head is never fully still.',
      hands: 'Big, lively gestures in front of the chest landing on the stressed words - hands opening wide, a point at the lens, a quick clap or a fist on the payoff.',
      body: 'The whole body a little forward and up, leaning in toward the camera; bouncy, energetic shifts of weight; the shoulders lift with the excitement.' },
    about: 'Loud, fast, delighted - the classic discovery read. Energy climbs to the end.',
    brief: 'Someone who has just found something that works and cannot keep it to themselves. Energy climbs across the script: the opening is a hook, the middle is the discovery, the end is the recommendation. Put the loudest tags where the good news actually lands, not on the setup. A laugh belongs where something is genuinely funny, never as decoration. Do not stack two energy tags on one sentence - it reads as shouting.',
    tags: ['excited', 'happy', 'overjoyed', 'energetically', 'bursting with excitement', 'loudly', 'voice rising', 'picks up pace', 'rapid-fire', 'strong emphasis', 'emphasized', 'stress on next word', 'laughs softly', 'chuckles', 'giggles', 'sharp inhale', 'gasp', 'suddenly excited', 'triumphant', 'grateful', 'hopeful', 'playful', 'confident', 'determined', 'relieved'],
    face: 'Lifted brows, bright wide eyes, frequent real smiles that reach the eyes, quick expressive changes with the words.',
    gestures: 'Bigger hand gestures landing on the stressed words, quick head accents, leaning in toward the camera, the whole body a little forward.' },
  { id: 'explaining', label: 'Explaining, matter-of-fact', gloss: 'counting points on the fingers',
    motion: { head: 'A steady head with slight tilts on each new point; a small nod when a point lands; a brief glance aside to think, then straight back to the lens.',
      hands: 'Small enumerating movements in front of the body - counting on the fingers, a flat hand laying out a point, both hands shaping a simple idea.',
      body: 'Upright, composed and still, the shoulders square to the camera; no fidgeting, the weight settled.' },
    about: 'Clear and focused, one point after another. For how-it-works scripts.',
    brief: 'Someone walking a friend through how a thing works, step by step, with nothing to sell. Even pace, clear emphasis on the term or number each sentence turns on, a short pause before a new point so the steps stay apart. Warm but not excited; a small acknowledgement when a point lands is as far as it goes. Most lines stay plain - the structure is the performance.',
    tags: ['natural tone', 'conversational tone', 'calm', 'slow and deliberate', 'slows down', 'emphasized', 'soft emphasis', 'stress on next word', 'brief pause', 'pauses', 'after a moment', 'thinking', 'confident', 'earnestly', 'convincingly', 'firmly', 'curious', 'deep breath', 'clears throat', 'warmly'],
    face: 'A steady head and an attentive face, brows drawing together on the key points, the odd nod, an easy small smile between points.',
    gestures: 'Small enumerating hand movements - counting on the fingers, a flat hand laying out a point - kept in front of the body; steady, no fidgeting.' },
  { id: 'skeptic', label: 'From skeptic to believer', gloss: 'arms crossed, opening up later',
    motion: { head: 'At first a slight head shake, the chin pulled back, a raised-eyebrow look; later the head comes forward and nods slowly and warmly.',
      hands: 'At first the arms crossed or a hand on the hip, a small dismissive wave; later the arms open and one hand comes up to underline the point.',
      body: 'Guarded and closed at first, leaning back a little; across the clip it opens up - the shoulders drop, the body turns fully to the lens and leans in.' },
    about: 'Doubt first, then it lands. The turn is the whole point - needs both halves of the arc.',
    brief: 'The read is a turn, and the turn is the whole point. The first part is guarded - flat, slow, unimpressed, with the doubt audible. Somewhere in the middle something gives, and from there the voice opens up: warmer, quicker, willing. Mark the moment the doubt breaks with a single tag and nothing else, so the change is heard rather than announced. Never put an enthusiastic tag before the turn, or there is no arc.',
    tags: ['skeptical', 'suspicious', 'uneasy', 'hesitant', 'deadpan', 'dry tone', 'scoffs', 'slow and deliberate', 'hesitates', 'pauses', 'long pause', 'thinking', 'realization dawning', 'suddenly serious', 'suddenly excited', 'voice softens', 'becoming emotional', 'relieved', 'convincingly', 'earnestly', 'confident', 'picks up pace', 'emphasized', 'sharp inhale'],
    face: 'Guarded at first - narrowed eyes, a slight frown, an unsmiling mouth, a raised eyebrow - and opening line by line until the last lines are relaxed, convinced and smiling.',
    gestures: 'Arms crossed or a hand on the hip early on, a shrug, a dismissive small wave; later the arms open, the shoulders drop, a hand comes up to underline the point they now believe.' },
  { id: 'serious', label: 'Serious, a warning', gloss: 'almost still',
    motion: { head: 'The head steady and level, the gaze unbroken into the lens; at most one slow, deliberate nod on the warning.',
      hands: 'The hands still, low or loosely together; one slow, deliberate gesture on the warning itself, then still again.',
      body: 'Upright and still, square to the camera, no swaying; the stillness itself carries the weight.' },
    about: 'Grave and still. Stillness reads as certainty - for a warning or a hard truth.',
    brief: 'Someone saying something that matters and knows it. Slow, level, a little quieter than normal, with a pause before the sentence that carries the warning and firm emphasis on the one word in it. No warmth to soften it, no rising energy, no rush - urgency here is weight, not speed. Most lines plain; the few tags are pauses and emphasis.',
    tags: ['serious', 'firmly', 'assertively', 'commanding tone', 'determined', 'slow and deliberate', 'slows down', 'quietly', 'softly', 'brief pause', 'pauses', 'long pause', 'strong emphasis', 'emphasized', 'stress on next word', 'deep breath', 'exhale slowly', 'tense', 'worried', 'understated', 'suddenly serious'],
    face: 'A flat serious expression, a steady unbroken gaze into the lens, no smiling; the brows set, and the mouth at rest between sentences - while the words are spoken it articulates them fully.',
    gestures: 'Minimal movement - the head steady, the hands still or one slow deliberate gesture on the warning itself; the stillness is the point.' },
  { id: 'funny', label: 'Playful, with humour', gloss: 'loose hands, a shrug on the punchline',
    motion: { head: 'Quick, playful head tilts; a deadpan hold before the punchline, then a small tilt or shake with a grin.',
      hands: 'Loose, expressive hands - a finger raised for the \"but\", a palms-up shrug on the punchline, a small flick of the wrist on an aside.',
      body: 'Relaxed and loose, a little bounce; the shoulders shrug on the punchline; a casual lean, as if sharing a joke with a friend.' },
    about: 'Light and playful, with comic timing - a beat of deadpan before the grin.',
    brief: 'Someone who finds the situation funny and lets the audience in on it. The humour is in the timing: a dry, deadpan setup, a beat, then the line lands with a small laugh or a lift. Put the funny tags on the punchlines and the admissions, never on the product itself, and keep the rest plain so the marked moments are heard. One dry aside lands better than three; nothing loud.',
    tags: ['playful', 'deadpan', 'dry tone', 'understated', 'sarcastic', 'scoffs', 'chuckles', 'giggles', 'laughs softly', 'snorts', 'nervous laugh', 'sigh', 'exhales', 'muttering to self', 'trails off', 'pauses', 'brief pause', 'warmly', 'happy', 'casual tone', 'conversational tone', 'drawn out', 'mutters'],
    face: 'A raised eyebrow, a smirk held a beat too long, deadpan stillness before a grin, eyes that give the joke away first.',
    gestures: 'Expressive hands, quick head tilts, a shrug on the punchline, a finger raised for the "but" - loose and light, nothing stiff.' },
  { id: 'personal', label: 'Personal story, emotional', gloss: 'a hand to the chest, quiet',
    motion: { head: 'Soft movements: the head tilts gently, the eyes drop for a moment on the hard part, then lift back to the lens.',
      hands: 'A hand to the chest or the neck on the feeling; the hands still and close during the pauses; small, careful gestures.',
      body: 'Shoulders soft and a little rounded, close and quiet; a breath visible in the chest before the hard part.' },
    about: 'Vulnerable and intimate - a story that costs something to tell.',
    brief: 'Someone telling a personal story to one person, not an audience. Quiet and close; the voice softens on the hard part and may catch, with a pause or a breath before it, and lifts a little on the relief at the end. Nothing performed and nothing loud - the emotion is in what is held back. Tags go on the turns of feeling only; the rest stays plain and natural.',
    tags: ['softly', 'quietly', 'voice softens', 'becoming emotional', 'reflective', 'sigh', 'exhales', 'deep breath', 'exhale slowly', 'hesitates', 'pauses', 'long pause', 'after a moment', 'trails off', 'searching for words', 'earnestly', 'grateful', 'hopeful', 'relieved', 'warmly', 'natural tone', 'conversational tone', 'embarrassed'],
    face: 'Soft expressions that follow the feeling of the words - eyes down for a moment on the hard part, a breath, a small brave smile on the relief; nothing held for the camera.',
    gestures: 'A hand to the chest or the neck, the head tilting, shoulders soft, a pause with the hands still before the hard part; close and quiet.' },
  { id: 'provocative', label: 'Provocative, challenging', gloss: 'leaning in, a pointed finger',
    motion: { head: 'The chin raised, a challenging tilt of the head; a slow shake of the head at the other side; a sharp nod on the punchline.',
      hands: 'A pointed finger toward the lens or a flat hand cutting the air on the challenge words; a dismissive flick at the other side.',
      body: 'Leaning in toward the camera, confident and squared up; a sharp move forward on the punchline.' },
    about: 'Bold and confrontational - a challenge thrown at the viewer, with a knowing smirk.',
    brief: 'Someone who is sure they are right and dares the listener to disagree. Assertive and quick, dry rather than loud, with hard emphasis on the challenge words and a beat before the punchline. A scoff or a dry laugh where the other side’s view is dismissed; a sudden seriousness where the real point lands. Keep it sharp: no warmth, no hedging, and never two heavy tags on one sentence.',
    tags: ['assertively', 'firmly', 'commanding tone', 'confident', 'determined', 'deadpan', 'dry tone', 'sarcastic', 'scoffs', 'strong emphasis', 'emphasized', 'stress on next word', 'repeats for emphasis', 'picks up pace', 'voice rising', 'loudly', 'cuts sentence short', 'brief pause', 'pauses', 'suddenly serious', 'playful', 'chuckles'],
    face: 'A challenging look straight into the lens, a raised chin, a knowing smirk, one eyebrow up; the eyes never leave the viewer.',
    gestures: 'Leaning in, a pointed finger or a flat hand cutting the air on the challenge, a slow shake of the head at the other side, a sharp gesture on the punchline.' },
];
const DEFAULT_MOOD = 'sincere';
const moodById = (id) => MOODS.find(m => m.id === id) || null;

module.exports = {
  MOTION_PRESETS, DEFAULT_PRESET, presetById, promptFor,
  VIDEO_QUALITIES, DEFAULT_QUALITY, qualityById,
  MOODS, DEFAULT_MOOD, moodById,
};
