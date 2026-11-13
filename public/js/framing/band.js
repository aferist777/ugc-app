/* band.js - A HALFER BAND'S NUMBERS, one rule.
   The preview (merge-v3/preview-b.js _drawBand), the render (lib/mv3b-render.js bandChain) and the save
   (lib/timeline-shape.js) read a band from here.

   A clip with `halfer` is a strip across the whole width of the frame instead of a picture on it: the source turned a
   quarter at a time, scaled to cover the strip, and the slice `halferKeep` names kept. The numbers and their defaults:
     halferThick  how tall, as a share of the frame (5-100, 40)
     halferPos    where: 100 against the top edge, 0 against the bottom (100)
     halferKeep   which slice survives the crop: 100 is the top at 0 and 180, the right at 90 and 270 (100)
     rotation     0 / 90 / 180 / 270, clockwise (90 - a portrait source lies across the strip)
     feather      the fade on the edges facing INTO the frame, as a share of the band (0.03)
   A band has no placement, framing or effects: it is always the full width. */

// A band percentage: a real number inside its range, or the default when there is none. NULL IS MISSING, not zero:
// Number(null) is 0, which would read an explicit null as "against the bottom".
export const bandPct = (v, dflt, lo = 0) => {
  const n = Number(v);
  return (v != null && Number.isFinite(n)) ? Math.max(lo, Math.min(100, n)) : dflt;
};

/** The band of clip `c` in a frame w x h: { band, y, keep, rot, fade, softTop, softBot } - pixels, a share, degrees. */
export function bandGeom(c, w, h) {
  // Even: yuv420 and overlay both dislike an odd height.
  let band = Math.round(h * bandPct(c.halferThick, 40, 5) / 100);
  if (band % 2) band++;
  band = Math.max(2, Math.min(h, band));
  const y = Math.round((h - band) * (1 - bandPct(c.halferPos, 100) / 100));
  const keep = bandPct(c.halferKeep, 100) / 100;
  const rot = [0, 90, 180, 270].includes(+c.rotation) && c.rotation != null ? +c.rotation : 90;
  // Null is the default softness and 0 is hard - the panel writes a number even at zero.
  const soft = (c.feather == null || !Number.isFinite(+c.feather)) ? 0.03 : Math.max(0, Math.min(0.4, +c.feather));
  const fade = soft > 0 ? Math.max(1, Math.round(band * soft)) : 0;
  // Only the edges that face into the picture: one while the band is parked against an edge, both while it floats.
  return { band, y, keep, rot, fade, softTop: fade > 0 && y > 0, softBot: fade > 0 && y + band < h };
}
