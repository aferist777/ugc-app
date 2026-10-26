/* ═══════════════════════════════════════════════════════════════════════════
   A CLIP'S CROP (phase V51, point 1, the owner 2026-10-26) - ONE module for the page and the server
   (lib/timeline-shape.js and lib/mv3b-render.js require() it, as they do framing/path.js).

   `crop: { x, y, w, h }` - a piece of the clip's FILE in shares of its width and height, cut FIRST:
   past it the clip behaves as if the file were that piece. `off: true` - the frame is remembered and
   not applied (PiP switched off takes the crop with it, the Crop tick brings it back - (пр43)).
   ═══════════════════════════════════════════════════════════════════════════ */

// The smallest piece, in shares of the file: a frame narrower than this is a slip of the mouse.
export const MIN = 0.02;

const r4 = (v) => Math.round(v * 10000) / 10000;

/** The crop as it may be stored, or null for none. Every side inside the file, never smaller than MIN. */
export function normalize(c) {
  if (!c || typeof c !== 'object') return null;
  let x = +c.x, y = +c.y, w = +c.w, h = +c.h;
  if (![x, y, w, h].every(Number.isFinite)) return null;
  w = r4(Math.max(MIN, Math.min(1, w)));
  h = r4(Math.max(MIN, Math.min(1, h)));
  x = r4(Math.max(0, Math.min(1 - w, x)));
  y = r4(Math.max(0, Math.min(1 - h, y)));
  const out = { x, y, w, h };
  if (c.off) out.off = true;
  return out;
}

/** The crop a clip is cut by now - null when it has none or it is switched off. */
export function active(clip) {
  const k = clip && clip.crop;
  return (k && !k.off && +k.w > 0 && +k.h > 0) ? k : null;
}
