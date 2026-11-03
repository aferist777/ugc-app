/* ═══════════════════════════════════════════════════════════════════════════
   FRAMING — THE STREAMER'S CAMERA in a shot (phase V69 P12b, the owner 2026-11-03, (хп82), (хп101), (хп102); docs/local-app/plan/
   "Фаза V69", П9 and П12б). A stream of a game shows the streamer's webcam as a small window in a corner over the game; a short
   of it is TWO BANDS - the camera on top, a third of the frame's height, and the game below, two thirds, from the middle of the
   film at its full height - both standing still for the shot.

   What tells the camera: a face SMALLER than MAX_FACE of the film's width (a face of the game or of a video reacted to that
   fills the screen is not one), STAYING IN ITS PLACE - its middle wanders less than STILL of the width and the height over the shot:
   the webcam's window is fixed, the head in it turns and leans (measured on the stand's test clip: up to 0.07 of the width), the
   faces of a game or of another video move across the screen and are cut - and there in at least SHARE of the shot's frames.
   Pure: path.js plan() ("camera + game" in the inspector) and active.js planActive() (the stream kind) both ask it.
   ═══════════════════════════════════════════════════════════════════════════ */

export const MAX_FACE = 0.08;     // the share of the width a webcam's face stays under ((хп75)'s line)
export const MIN_FACE = 0.015;    // narrower is noise
export const STILL = 0.08;        // its middle wanders less than this (a share of the width / the height) - p10 to p90
export const SHARE = 0.5;         // and it is there in this share of the shot's frames
export const BAND_FACE = 3;       // the camera's band shows this many face heights of the film (the face about a third of it)
export const BAND_MIN = 0.15, BAND_MAX = 0.6;
const NEAR = 0.08;                // a sighting this close to a place's middle so far (a share of the width / height) is that place

const q = (a, p) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0; };

/**
 * The camera of frames i0..i1 (each a list of [x, y, w, h, score] - fractions of the film), or null:
 * { x, y } its face's middle, h the face's height (shares of the film), band - the camera band's height (a share of the
 * film's height, BAND_FACE face heights).
 */
export function camOf(frames, i0, i1) {
  const n = Math.max(1, i1 - i0);
  const places = [];
  for (let i = i0; i < i1; i++) {
    const seen = new Set();
    for (const b of (frames[i] || [])) {
      if (!b || !(b[2] >= MIN_FACE) || !(b[2] < MAX_FACE)) continue;
      const x = b[0] + b[2] / 2, y = b[1] + b[3] / 2;
      let p = places.find((z) => Math.abs(z.x - x) < NEAR && Math.abs(z.y - y) < NEAR);
      if (!p) { p = { x, y, xs: [], ys: [], hs: [], frames: new Set() }; places.push(p); }
      if (seen.has(p)) continue;
      seen.add(p);
      p.xs.push(x); p.ys.push(y); p.hs.push(b[3]); p.frames.add(i);
      // The place's middle follows its sightings - a head that leans stays its place.
      p.x += (x - p.x) / p.xs.length; p.y += (y - p.y) / p.ys.length;
    }
  }
  const best = places.sort((a, b) => b.frames.size - a.frames.size)[0];
  if (!best || best.frames.size < Math.max(2, SHARE * n)) return null;
  if (q(best.xs, 0.9) - q(best.xs, 0.1) > STILL || q(best.ys, 0.9) - q(best.ys, 0.1) > STILL) return null;
  const h = q(best.hs, 0.5);
  return { x: q(best.xs, 0.5), y: q(best.ys, 0.5), h, band: Math.min(BAND_MAX, Math.max(BAND_MIN, h * BAND_FACE)) };
}

/** The game's window below the camera: the share of the film's width it shows at the full height - from the middle. */
export function gameW(srcW, srcH, aspect) {
  if (!(srcW > 0) || !(srcH > 0)) return 1;
  return Math.min(1, (srcH * (aspect > 0 ? aspect : 9 / 16) * 3 / 2) / srcW);
}
/** The camera's window on top: its width as a share of the film's, for a band `band` of the film's height. */
export function camW(band, srcW, srcH, aspect) {
  if (!(srcW > 0) || !(srcH > 0)) return 1;
  return Math.min(1, (band * srcH * (aspect > 0 ? aspect : 9 / 16) * 3) / srcW);
}
