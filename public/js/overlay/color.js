/* ═══════════════════════════════════════════════════════════════════════════
   A CLIP'S COLOUR CORRECTION - ONE module
   for the page and the server (js/merge-v3/preview-b.js, inspector.js, timeline-b.js; lib/timeline-shape.js and
   lib/mv3b-render.js require() it, as they do overlay/look.js).

   A clip's own correction - `color: { brightness, contrast, saturation, gamma }` on any clip of a video lane, only what is
   not neutral, the field absent when nothing is (a clip without it is drawn and rendered untouched). A lane's sliders write the same
   value into every clip of it (inspector.js), as its Fit does.

   ONE RULE, IN RGB, for the preview and the render - each channel 0..1, clamped after every step:
     1. saturation  - the W3C saturate matrix (CSS saturate(), SVG feColorMatrix), 0 grey .. 1 as is .. 2 twice;
     2. contrast about the middle and brightness added: v * contrast + 0.5 - 0.5 * contrast + brightness;
     3. gamma: v ^ (1 / gamma) - above 1 lighter, as ffmpeg's eq reads it.
   The preview draws the clip's file through an SVG filter made of these numbers (svgOf: feColorMatrix, then two
   feComponentTransfer - linear, gamma - in sRGB); the render runs the same arithmetic on the clip's picture first, before
   it is framed, cropped, blurred or placed (ffOf: colorchannelmixer, then lutrgb).
   ═══════════════════════════════════════════════════════════════════════════ */

export const COLOR_KEYS = ['brightness', 'contrast', 'saturation', 'gamma'];
// [min, max, neutral, step] of each - the sliders' and the stored value's.
export const COLOR_RANGE = {
  brightness: [-0.5, 0.5, 0, 0.02],
  contrast: [0.5, 1.5, 1, 0.05],
  saturation: [0, 2, 1, 0.05],
  gamma: [0.5, 2, 1, 0.05],
};
export const COLOR_LABEL = { brightness: 'Brightness', contrast: 'Contrast', saturation: 'Saturation', gamma: 'Gamma' };

const _r2 = (v) => Math.round(v * 100) / 100;

/** A clip's correction, every value there - neutral where it has none. */
export function colorOf(c) {
  const v = (c && c.color && typeof c.color === 'object') ? c.color : {};
  const out = {};
  for (const k of COLOR_KEYS) {
    const [lo, hi, mid] = COLOR_RANGE[k];
    const n = +v[k];
    out[k] = (v[k] != null && v[k] !== '' && Number.isFinite(n)) ? Math.max(lo, Math.min(hi, n)) : mid;
  }
  return out;
}

/** What is stored: only the values that are not neutral, in hundredths - or null, and the field is then left off the clip. */
export function normalizeColor(v) {
  if (!v || typeof v !== 'object') return null;
  const all = colorOf({ color: v });
  const out = {};
  for (const k of COLOR_KEYS) {
    const n = _r2(all[k]);
    if (Math.abs(n - COLOR_RANGE[k][2]) > 0.004) out[k] = n;
  }
  return Object.keys(out).length ? out : null;
}

/** Whether a clip's picture is left as it is. */
export const isNeutral = (c) => !normalizeColor(c && c.color);

// The W3C saturate matrix, rows R, G, B over R, G, B.
function _sat(s) {
  return [
    [0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s],
    [0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s],
    [0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s],
  ];
}
const _f = (v) => (Math.round(v * 1e6) / 1e6).toString();

/**
 * The preview's numbers: { key, matrix, slope, intercept, exponent } - `matrix` the feColorMatrix values (20, or null when
 * the saturation is neutral), the linear step and the gamma's exponent; null for a neutral clip. `key` names the filter.
 */
export function svgOf(c) {
  if (isNeutral(c)) return null;
  const k = colorOf(c);
  const m = Math.abs(k.saturation - 1) > 1e-6 ? _sat(k.saturation) : null;
  return {
    key: COLOR_KEYS.map((x) => _f(k[x])).join('_').replace(/[^0-9_-]/g, 'p'),
    matrix: m ? [...m[0], 0, 0, ...m[1], 0, 0, ...m[2], 0, 0, 0, 0, 0, 1, 0].map(_f) : null,
    slope: _f(k.contrast),
    intercept: _f(0.5 - 0.5 * k.contrast + k.brightness),
    exponent: _f(1 / k.gamma),
  };
}

/**
 * The render's filters, the same arithmetic: '' for a neutral clip, else a chain for the clip's input - its picture in RGB
 * with its alpha, the saturation mixed, each channel stretched, clamped and raised to the gamma, back to YUV with the alpha.
 */
export function ffOf(c) {
  if (isNeutral(c)) return '';
  const k = colorOf(c);
  const parts = ['format=gbrap'];
  if (Math.abs(k.saturation - 1) > 1e-6) {
    const m = _sat(k.saturation);
    const n = ['r', 'g', 'b'];
    parts.push('colorchannelmixer=' + n.map((o, i) => n.map((s, j) => o + s + '=' + _f(m[i][j])).join(':')).join(':'));
  }
  const lin = `clip(val/255*${_f(k.contrast)}+${_f(0.5 - 0.5 * k.contrast + k.brightness)},0,1)`;
  const e = `'clip(255*pow(${lin},${_f(1 / k.gamma)}),0,255)'`;
  parts.push(`lutrgb=r=${e}:g=${e}:b=${e}`);
  parts.push('format=yuva420p');
  return parts.join(',');
}
