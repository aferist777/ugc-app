/* A SOUND CLIP'S PITCH (phase V76, the owner 2026-11-06; docs/local-app/plan/, "Фаза V76", (тн1)-(тн10)) - ONE module for the
   page and the server (js/merge-v3/pitch-rows.js, preview-b.js, timeline-b.js, hl-group.js; lib/timeline-shape.js,
   lib/pitch-copy.js and lib/mv3b-render.js require() it, as they do overlay/color.js).

   `pitch: { st, shift }` on a clip of an audio lane: `st` semitones, -12..+12, whole ((тн1) а); `shift` - the timbre moves with
   the pitch (a tape sped up or slowed down) instead of being kept (the same voice, higher or lower; (тн3) а, kept by default).
   The field is absent at 0 - a clip without it sounds byte for byte as before. The speed is apart: it changes the tempo and
   keeps whatever pitch the clip has.

   HOW IT SOUNDS - one rule for the preview and the render: the server makes a COPY of the clip's file with its pitch moved,
   rubberband in the app's ffmpeg (filterOf), as long as the file to the sample (lib/pitch-copy.js, kept in cache/pitch/); the
   preview plays it and the render takes it as the clip's input. A copy is made once per file, pitch and timbre.

   The presets ((тн2), the owner: «оставить») from the lowest up: Giant and Chipmunk move the timbre, the rest keep it. No
   "male <-> female": rubberband does not move the timbre apart from the pitch - it would be the same person, higher. */

export const PITCH_MIN = -12;
export const PITCH_MAX = 12;

export const PRESETS = [
  { id: 'giant', label: 'Giant', st: -12, shift: true },
  { id: 'deep', label: 'Deep', st: -7 },
  { id: 'lower', label: 'Lower', st: -4 },
  { id: 'bitlower', label: 'A bit lower', st: -2 },
  { id: 'original', label: 'Original', st: 0 },
  { id: 'bithigher', label: 'A bit higher', st: 2 },
  { id: 'higher', label: 'Higher', st: 4 },
  { id: 'bright', label: 'Bright', st: 7 },
  { id: 'chipmunk', label: 'Chipmunk', st: 12, shift: true },
];

/** What is stored: { st } or { st, shift: true } - or null at 0, and the field is then left off the clip. */
export function normalizePitch(v) {
  if (!v || typeof v !== 'object') return null;
  const n = Math.round(+v.st);
  if (!Number.isFinite(n) || n === 0) return null;
  const st = Math.max(PITCH_MIN, Math.min(PITCH_MAX, n));
  return v.shift ? { st, shift: true } : { st };
}

/** A clip's pitch, always an answer: { st, shift } - 0 and false where it has none. */
export function pitchOf(c) {
  const p = normalizePitch(c && c.pitch);
  return p ? { st: p.st, shift: !!p.shift } : { st: 0, shift: false };
}

/** Whether a clip sounds at another pitch than its file. */
export const isPitched = (c) => !!normalizePitch(c && c.pitch);

/** The preset a pitch is - its id - or 'custom'. */
export function presetOf(p) {
  const st = Math.round(+((p && p.st) || 0));
  const shift = !!(p && p.shift);
  const hit = PRESETS.find((x) => x.st === st && (st === 0 || !!x.shift === shift));
  return hit ? hit.id : 'custom';
}

/** A preset's pitch, as a clip stores it (null for Original). */
export function presetPitch(id) {
  const p = PRESETS.find((x) => x.id === id);
  return p ? normalizePitch({ st: p.st, shift: p.shift }) : null;
}

/** The slider's words: "+4 st", "0 st", "−7 st". */
export const stLabel = (st) => (+st > 0 ? '+' : +st < 0 ? '−' : '') + Math.abs(Math.round(+st || 0)) + ' st';

/** How many times higher. */
export const ratioOf = (st) => Math.pow(2, (+st || 0) / 12);

/** The ffmpeg filter that moves it - '' for none. */
export function filterOf(v) {
  const p = normalizePitch(v);
  if (!p) return '';
  return 'rubberband=pitch=' + ratioOf(p.st).toFixed(6) + ':formant=' + (p.shift ? 'shifted' : 'preserved');
}

/** A short tag of it, for a key or a file name: 'p4', 'p-7s'; '' for none. */
export function tagOf(v) {
  const p = normalizePitch(v);
  return p ? 'p' + p.st + (p.shift ? 's' : '') : '';
}
