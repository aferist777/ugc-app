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
// `prompt` is what reaches the model. `note` is for the human choosing, and never
// leaves the page.
const MOTION_PRESETS = [
  {
    id: 'minimal-natural',
    label: 'Minimal & natural',
    prompt: 'Speaking calmly to camera. Relaxed neutral expression, natural blinking, '
          + 'small head movements on stressed words, shoulders still.',
    note: 'Barely moves. The safest choice, and the closest to a real phone selfie.',
  },
  {
    id: 'hands',
    label: 'Talking with hands',
    prompt: 'Speaking to camera with easy hand gestures inside the frame, open palms, '
          + 'each gesture landing on a stressed word. Warm engaged expression.',
    note: 'Gestures punctuate the beat. Wants a frame with room beside the hands.',
  },
  {
    id: 'upbeat',
    label: 'Upbeat & energetic',
    prompt: 'Speaking to camera with bright energy. Raised eyebrows, wide alert eyes, '
          + 'quick head accents, frequent small smiles.',
    note: 'For the hook and the payoff, where the read is already lifted.',
  },
  {
    id: 'explaining',
    label: 'Explaining',
    prompt: 'Explaining to camera. Slight head tilts on each point, brows drawing '
          + 'together in concentration, small enumerating hand movements.',
    note: 'For the proof: the trials, the ingredients, the how-it-works line.',
  },
  {
    id: 'skeptical-convinced',
    label: 'Skeptical to convinced',
    prompt: 'Starts guarded with a slight frown and narrowed eyes, then opens up across '
          + 'the line: brows lift, the expression warms, a small nod at the end.',
    note: 'An arc inside one fragment, so it needs a line long enough to turn.',
  },
  {
    id: 'deadpan',
    label: 'Deadpan straight talk',
    prompt: 'Speaking to camera almost motionless. Steady unwavering gaze, flat serious '
          + 'expression, no smile, minimal head movement.',
    note: 'For a warning or a hard fact — stillness reads as certainty.',
  },
];

const DEFAULT_PRESET = 'minimal-natural';

const presetById = (id) => MOTION_PRESETS.find(p => p.id === id) || null;
// What actually reaches the model for a given choice, falling back to the default
// rather than sending nothing: an empty prompt lets the model invent its own idea.
const promptFor = (id) => (presetById(id) || presetById(DEFAULT_PRESET)).prompt;

// ── the model behind the section ─────────────────────────────────────────────
// Kling is the only lipsync wired up, and its two tiers differ in nothing a user cares
// about except how sharp the clip is and what it costs — so the page asks about
// QUALITY and resolves the tier here.
//
// maxAudioSec is the real constraint on how long a fragment may be: past it the read is
// refused before it is sent, because the model will not animate it. It sat at 15s and
// nothing longer was ever attempted — the guard is what kept the longest read in the
// whole store at 14.9s. kie.ai's own listing for these avatar models is far above that
// (their Avatar 2.0 page advertises minutes, the official Kling API documents 2-300s),
// so 15 was costing us split sentences for nothing. 30 is a deliberate half-step: high
// enough to stop breaking ordinary reads, low enough that we are not betting a batch on
// a number no page states for THESE two model ids. Raise it when a longer read renders.
const VIDEO_MODELS = [
  { id: 'kling', label: 'Kling AI Avatar', provider: 'kie.ai' },
];

const VIDEO_QUALITIES = [
  { id: '720p',  label: '720p',  model: 'kling/ai-avatar-standard', pricePerSec: 0.04, maxAudioSec: 30 },
  { id: '1080p', label: '1080p', model: 'kling/ai-avatar-pro',      pricePerSec: 0.08, maxAudioSec: 30 },
];

const DEFAULT_QUALITY = '720p';

const qualityById = (id) => VIDEO_QUALITIES.find(q => q.id === id) || null;

module.exports = {
  MOTION_PRESETS, DEFAULT_PRESET, presetById, promptFor,
  VIDEO_MODELS, VIDEO_QUALITIES, DEFAULT_QUALITY, qualityById, 
};
