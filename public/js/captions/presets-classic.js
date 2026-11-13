/* ═══════════════════════════════════════════════════════════════════════════
   CAPTIONS — the Classic presets.

   Written by hand, unlike presets.js (made by a tool), which only adds them to its list. Classic subtitles: no
   spoken-word effect, no arrival, two lines, and the lane cut in `sentences` (style.js CUTS, pages.js SENT) - so
   a Classic tile put on a lane cuts it as classic subtitles by itself, and any other tile, which sets every
   field, puts `pages` back. On picked lines a Classic tile gives the look only: the cut is the lane's.
   Sizes are the height of a line in a 1080x1920 frame, as every preset's.
   ═══════════════════════════════════════════════════════════════════════════ */

export const CLASSIC_CATEGORY = { id: 'classic', label: 'Classic' };

// What every Classic style shares; each preset sets the rest.
const BASE = {
  font: 'Liberation Sans', size: 58, bold: true, italic: false,
  primary: '#ffffff', secondary: '#8a9099', highlight: '#ffe14d',
  outlineColor: '#000000', shadowColor: '#000000', backColor: '#000000',
  backAlpha: 0, shadowAlpha: 0.75, outline: 3, shadow: 0, blur: 0,
  scaleX: 100, scaleY: 100, spacing: 0,
  borderStyle: 'outline', pos: 'bottom', tx: 0, ty: 0,
  wrap: true, wordsPerLine: 0, lines: 2, cut: 'sentences',
  effect: 'none', appear: 'none', casing: 'none', sizeAuto: false, marked: '',
};

export const CLASSIC = [
  // White with a black outline, at the bottom.
  { id: 'cl-white', name: 'Classic White', category: 'classic', style: { ...BASE } },
  // White on a black box at 60%.
  { id: 'cl-box', name: 'Classic Box', category: 'classic', style: { ...BASE, size: 56, borderStyle: 'box', backAlpha: 0.6, outline: 0 } },
  // Yellow with a black outline.
  { id: 'cl-yellow', name: 'Classic Yellow', category: 'classic', style: { ...BASE, primary: '#ffe14d' } },
  // The cinema's: small, not bold, a thin outline and a soft shadow, lower than usual.
  { id: 'cl-cinema', name: 'Cinema', category: 'classic',
    style: { ...BASE, font: 'PT Sans', size: 46, bold: false, outline: 1.5, shadow: 1.5, shadowAlpha: 0.6, blur: 0.6, ty: 0.04 } },
];
