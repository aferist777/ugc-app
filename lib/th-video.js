'use strict';

// ════════════════════════════════════════════════════════════════════════════
// WHAT A TALKING HEAD IS FILMED WITH (phase V26.8, the owner 2026-10-13; docs/local-app/PLAN.md, "Фаза V26", block 8).
//
//   kling avatar        one clip per line: the line's frame speaks its read (lib/motion-presets.js, VIDEO_QUALITIES)
//   seedance 2.0 mini   the lines are clipped by Seedance - one by one, or merged into fragments of up to 15 s
//   seedance 2.0          (30 s on 2.5) when the video field's `merge fragments` is ticked
//   seedance 2.5
//
// The mode is the PROJECT's (the owner: Kling lines run in order, Seedance merges them - the two cannot share a video).
// A Seedance model's qualities and their prices are the video chat's own records (lib/video-models.js - the only
// place a model's fields and rates are written), as kie bills them without a reference clip: kie is where Seedance
// goes first (PREFER there). The ceiling of a fragment is the model's longest clip.
//
// THE SOUND of a Seedance clip, three ways - each said to the person under its menu (the owner's answer (ш)):
//   read     Seedance hears the read of the fragment and voices it itself: lips and sound made together (trial P1:
//            "отличный звук и липсинк").
//   ours     Seedance makes the picture only, silent, moving the lips to the read; the read is the sound - the words
//            are exactly ours (trial P2).
//   sample   Seedance speaks the words itself in the character's voice, from a 10 s sample of it (trial P3).
// Not chosen, it is `read` (SOUND_DEFAULT). It went by the script's language before phase V29 (the owner's answer (ь):
// English - `read`, anything else - `ours`); every script is English now (the owner 2026-10-14).
// ════════════════════════════════════════════════════════════════════════════

const MP = require('./motion-presets');
const VM = require('./video-models');

const MODELS = [
  { id: 'kling', label: 'kling avatar', family: 'kling',
    about: 'One clip per line: the line’s frame speaks its read, lipsynced to it.' },
  { id: 'sd2mini', label: 'seedance 2.0 mini', family: 'seedance',
    about: 'The cheapest Seedance - and the roughest picture. Clips of up to 15 s.' },
  { id: 'sd2', label: 'seedance 2.0', family: 'seedance',
    about: 'Seedance: the person speaks, moves and the camera moves with them. Clips of up to 15 s.' },
  { id: 'sd25', label: 'seedance 2.5', family: 'seedance',
    about: 'The newest Seedance, the closest to the read in time. Clips of up to 30 s - and the dearest.' },
];

const byId = (id) => MODELS.find(m => m.id === id) || null;
const isSeedance = (id) => !!(byId(id) && byId(id).family === 'seedance');

// The qualities a model is made in, each with what a second of it costs and the longest stretch it takes.
function qualities(id) {
  const m = byId(id);
  if (!m) return [];
  if (m.family === 'kling') return MP.VIDEO_QUALITIES;
  const pair = VM.pair(id, 'kie');
  if (!pair) return [];
  return pair.resolutions.map(r => {
    const pr = VM.price(pair, { resolution: r, duration: pair.duration.min }, {});
    return { id: r, label: r, model: pair.modelId, pricePerSec: pr.perSec, maxAudioSec: pair.duration.max };
  }).filter(q => q.pricePerSec != null);
}
const qualityOf = (id, q) => qualities(id).find(x => x.id === q) || null;

// What the menus offer, for GET /scen3/motion-presets.
const models = () => MODELS.map(m => ({ ...m, qualities: qualities(m.id) }));

const SOUNDS = [
  { id: 'read', label: 'Seedance from the read',
    about: 'Seedance hears the read of the fragment and says the words itself - its voice and its lips are made together, and its sound goes on the timeline.' },
  { id: 'ours', label: 'the read as it is',
    about: 'Seedance makes the picture only, silent, moving the lips to the read - the read is the sound, word for word.' },
  { id: 'sample', label: 'Seedance by the voice sample',
    about: 'Seedance says the words itself in the character’s voice, from a 10 s sample of it on the Voices shelf.' },
];
const soundById = (id) => SOUNDS.find(s => s.id === id) || null;

/** The sound a Seedance clip of a project is made with when the person has not chosen one (phase V29: always `read`). */
const SOUND_DEFAULT = 'read';

module.exports = { MODELS, byId, isSeedance, qualities, qualityOf, models, SOUNDS, soundById, SOUND_DEFAULT };
