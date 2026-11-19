/* ═══════════════════════════════════════════════════════════════════════════
   A CLIP'S LOOK OVER WHAT IS UNDER IT - ONE module
   for the page and the server (js/merge-v3/preview-b.js, inspector.js, timeline-b.js; lib/timeline-shape.js and
   lib/mv3b-render.js require() it, as they do framing/crop.js).

   `opacity` - how much of a clip of ANY video lane is seen, 0..1; none (the field absent) = 1. On main video the clip
   is over the black bed, so less of it is a darker clip. The preview draws the clip alone on a layer
   and lays the layer at this opacity (preview-b.js _showAs); the render scales the clip's alpha last, just before it
   is overlaid (mv3b-render.js) - the same picture.

   A PATTERN (an address under /patterns/, lib/patterns-builtin.js) ticked in the strip of main video lands at 0.7 (a
   layer of main video - overlay/pattern.js layersOf - with the same opacity and blend mode).

   `blend` - how a clip of a lane ABOVE main mixes with what is under it; none (the field
   absent) = laid over it plainly. On main video it means nothing: under main is black. The preview lays the clip's layer
   with the canvas's own blend mode (`canvas`, the W3C compositing formulas); the render blends the clip, laid on a
   transparent frame, with what is under it by ffmpeg's `blend` in RGB - the backdrop as its first input, as the W3C
   formulas read the backdrop (overlay's light/dark test is the backdrop's) - and lays the result by the clip's alpha
   (its opacity in it). `add` adds the clip's color times its alpha straight (canvas 'lighter'): mixed by the alpha
   afterwards it would not clip as the canvas does. Measured (a frame of the preview against a frame of the
   render): every mode within about 1 of 255 on average; soft light - ffmpeg's formula is close to, not the
   same as, the W3C one - within 1.5-2.8 on average, 16 at most.
   ═══════════════════════════════════════════════════════════════════════════ */

import { t, tc } from '../i18n/t.js';

// `id` is what a clip stores and the render reads (`canvas`, `ff`); `label` and `tip` are only shown - in the interface's
// language (i18n/t.js; the server never shows them).
export const BLENDS = [
  { id: 'none', label: tc('blend', 'None'), canvas: 'source-over', ff: '', tip: t('laid over what is under it') },
  { id: 'screen', label: tc('blend', 'Screen'), canvas: 'screen', ff: 'screen', tip: t('lightens - black vanishes, a glow or a light leak') },
  { id: 'multiply', label: tc('blend', 'Multiply'), canvas: 'multiply', ff: 'multiply', tip: t('darkens - white vanishes, ink or a shadow') },
  { id: 'overlay', label: tc('blend', 'Overlay'), canvas: 'overlay', ff: 'overlay', tip: t('more contrast - light over light, dark over dark') },
  { id: 'soft-light', label: tc('blend', 'Soft light'), canvas: 'soft-light', ff: 'softlight', tip: t('gentle contrast - a soft glow or a tint') },
  { id: 'lighten', label: tc('blend', 'Lighten'), canvas: 'lighten', ff: 'lighten', tip: t('the lighter of the two, pixel by pixel') },
  { id: 'darken', label: tc('blend', 'Darken'), canvas: 'darken', ff: 'darken', tip: t('the darker of the two, pixel by pixel') },
  { id: 'add', label: tc('blend', 'Add'), canvas: 'lighter', ff: 'addition', premultiplied: true, tip: t('adds the light - brighter than screen') },
  { id: 'difference', label: tc('blend', 'Difference'), canvas: 'difference', ff: 'difference', tip: t('the difference - white turns colors inside out') },
];
const _BY = new Map(BLENDS.map(b => [b.id, b]));

/** A clip's blend mode, one of BLENDS - none when it has none. */
export const blendOf = (c) => _BY.get(String((c && c.blend) || 'none')) || _BY.get('none');

/** What is stored: a mode's id, or null for none (the field is then left off the clip). */
export function normalizeBlend(v) {
  const id = String(v || 'none');
  return _BY.has(id) && id !== 'none' ? id : null;
}

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
