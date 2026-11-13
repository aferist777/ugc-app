/* A SOUND CLIP'S PITCH - ONE module for the
   page and the server (js/merge-v3/pitch-rows.js, preview-b.js, timeline-b.js, hl-group.js; lib/timeline-shape.js,
   lib/pitch-copy.js and lib/mv3b-render.js require() it, as they do overlay/color.js).

   `pitch: { st, shift }` on a clip of an audio lane: `st` semitones, -12..+12, whole; `shift` - the timbre moves with
   the pitch (a tape sped up or slowed down) instead of being kept (the same voice, higher or lower; kept by default).
   The field is absent at 0 - a clip without it plays its file untouched. The speed is apart: it changes the tempo and
   keeps whatever pitch the clip has.

   HOW IT SOUNDS - one rule for the preview and the render: the server makes a COPY of the clip's file with its pitch moved,
   rubberband in the app's ffmpeg (filterOf), as long as the file to the sample (lib/pitch-copy.js, kept in cache/pitch/); the
   preview plays it and the render takes it as the clip's input. A copy is made once per file, pitch and timbre.

   No presets (a list would only repeat the slider) - the semitones and the timbre are all. */

export const PITCH_MIN = -12;
export const PITCH_MAX = 12;

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
