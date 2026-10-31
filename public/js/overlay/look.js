/* ═══════════════════════════════════════════════════════════════════════════
   A CLIP'S LOOK OVER WHAT IS UNDER IT (phase V65, the owner 2026-10-31; docs/local-app/plan/, "Фаза V65") - ONE module
   for the page and the server (js/merge-v3/preview-b.js, inspector.js, timeline-b.js; lib/timeline-shape.js and
   lib/mv3b-render.js require() it, as they do framing/crop.js).

   `opacity` - how much of a clip of ANY video lane is seen, 0..1; none (the field absent) = 1. On main video the clip
   is over the black bed, so less of it is a darker clip (the owner's (пз6)). The preview draws the clip alone on a layer
   and lays the layer at this opacity (preview-b.js _showAs); the render scales the clip's alpha last, just before it
   is overlaid (mv3b-render.js) - the same picture.

   A PATTERN (IMAGES -> Patterns, lib/patterns-builtin.js - an address under /patterns/) lands at 0.7 (the owner's (пз7)).
   ═══════════════════════════════════════════════════════════════════════════ */

export const PATTERN_OPACITY = 0.7;

/** Whether an address is one of the app's own patterns. */
export const isPattern = (src) => String(src || '').split('?')[0].startsWith('/patterns/');

/** A clip's opacity, 0..1 - 1 when it has none. */
export function opacityOf(c) {
  const v = c ? c.opacity : null;
  if (v == null || v === '') return 1;
  const n = +v;
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 1;
}

/** What is stored: a hundredth of 0..1, or null for fully seen (the field is then left off the clip). */
export function normalizeOpacity(v) {
  if (v == null || v === '') return null;
  const n = +v;
  if (!Number.isFinite(n)) return null;
  const r = Math.round(Math.max(0, Math.min(1, n)) * 100) / 100;
  return r >= 1 ? null : r;
}
