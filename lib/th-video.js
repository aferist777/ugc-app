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
//            "отличный звук и липсинк"). Wrong words outside English (trial P4).
//   ours     Seedance makes the picture only, silent, moving the lips to the read; the read is the sound - the words
//            are exactly ours (trial P2).
//   sample   Seedance speaks the words itself in the character's voice, from a 10 s sample of it (trial P3).
// Not chosen, it is decided by the script's language (the owner's answer (ь)): English - `read`, anything else - `ours`.
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
    about: 'Seedance hears the read of the fragment and says the words itself - its voice and its lips are made together, and its sound goes on the timeline. In languages other than English it gets words wrong.' },
  { id: 'ours', label: 'the read as it is',
    about: 'Seedance makes the picture only, silent, moving the lips to the read - the read is the sound, word for word. The safe one for a script not in English.' },
  { id: 'sample', label: 'Seedance by the voice sample',
    about: 'Seedance says the words itself in the character’s voice, from a 10 s sample of it on the Voices shelf. In languages other than English it gets words wrong.' },
];
const soundById = (id) => SOUNDS.find(s => s.id === id) || null;

// IS THE SCRIPT IN ENGLISH? The words of the lines in the video, their performance tags left out. Letters that are not
// Latin say "no" at once; Latin letters say "yes" only when enough of the words are the commonest English ones - a
// Spanish or Polish script is Latin too.
const COMMON = new Set(('the a an and or but to of in on at for with from by is are was were be been it its this that these those '
  + 'i me my you your he him his she her we us our they them their not no do does did have has had will would can could '
  + 'just so if what when how why who all about up out get got like one there here then than as').split(' '));
function isEnglish(lines) {
  const text = (Array.isArray(lines) ? lines : [])
    .filter(l => l && !l.removed)
    .map(l => String(l.text || '')).join(' ')
    .replace(/\[[^\]]*\]/g, ' ');
  const letters = text.match(/\p{L}/gu) || [];
  if (!letters.length) return true;
  const latin = letters.filter(ch => /[A-Za-z]/.test(ch)).length;
  if (latin / letters.length < 0.9) return false;
  const words = text.toLowerCase().match(/[a-z']+/g) || [];
  if (!words.length) return true;
  const common = words.filter(w => COMMON.has(w.replace(/'.*$/, ''))).length;
  return common / words.length >= 0.15;
}
/** The sound a Seedance clip of this project is made with when the person has not chosen one. */
const soundAuto = (lines) => (isEnglish(lines) ? 'read' : 'ours');

module.exports = { MODELS, byId, isSeedance, qualities, qualityOf, models, SOUNDS, soundById, isEnglish, soundAuto };
