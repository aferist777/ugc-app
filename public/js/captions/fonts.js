/* ═══════════════════════════════════════════════════════════════════════════
   CAPTIONS — the fonts the app ships, and only those (phase K5, 2026-10-03).

   They live in public/fonts/captions/ (static TTFs, unmodified, OFL - licences beside them) and every
   one draws the whole Russian alphabet: a font without it is not shipped, because libass quietly fills
   missing letters from Arial and the word comes out in two fonts. The render hands the folder to the
   `ass` filter (fontsdir), the page declares them with @font-face (css/caption-fonts.css) - the same
   files on both sides.

   `family` is the name libass looks the font up by: the font's OWN family name (nameID 1), which for a
   weight-named file is "Montserrat Black", not "Montserrat" - asked for "Montserrat" in bold, libass
   gave Arial. `bold` is what the .ass says: true or false fixed by the file (never fake bold on a font
   that has only one weight), 'style' where a family ships both a regular and a bold file and the
   style's own switch chooses. `line` is the height of the font's line in em (what an .ass Fontsize
   measures), `up`/`low` the average advance of an UPPER and a lower case letter in em - measured once
   from the files, for cutting pages to a width (K2) on the server and the page alike.

   Old projects named Windows fonts; they are read as the closest shipped one (the owner's answer 3,
   2026-10-03), Arial as Liberation Sans, which has Arial's metrics.
   ═══════════════════════════════════════════════════════════════════════════ */

export const FONT_DIR = '/fonts/captions/';

export const FONTS = [
  { family: 'Montserrat Black', label: 'Montserrat Black', files: { 400: 'Montserrat-Black.ttf' }, bold: false, line: 1.562, up: 0.656, low: 0.561 },
  { family: 'Montserrat ExtraBold', label: 'Montserrat ExtraBold', files: { 400: 'Montserrat-ExtraBold.ttf' }, bold: false, line: 1.562, up: 0.648, low: 0.548 },
  { family: 'Montserrat', label: 'Montserrat Bold', files: { 700: 'Montserrat-Bold.ttf' }, bold: true, line: 1.562, up: 0.640, low: 0.537 },
  { family: 'Inter Black', label: 'Inter Black', files: { 400: 'Inter-Black.ttf' }, bold: false, line: 1.210, up: 0.606, low: 0.507 },
  { family: 'Inter ExtraBold', label: 'Inter ExtraBold', files: { 400: 'Inter-ExtraBold.ttf' }, bold: false, line: 1.210, up: 0.604, low: 0.501 },
  { family: 'Inter', label: 'Inter Bold', files: { 700: 'Inter-Bold.ttf' }, bold: true, line: 1.210, up: 0.602, low: 0.496 },
  { family: 'Oswald', label: 'Oswald Bold', files: { 700: 'Oswald-Bold.ttf' }, bold: true, line: 1.702, up: 0.486, low: 0.423 },
  { family: 'Fira Sans Extra Condensed Black', label: 'Fira Sans Condensed Black', files: { 400: 'FiraSansExtraCondensed-Black.ttf' }, bold: false, line: 1.200, up: 0.441, low: 0.390 },
  { family: 'Rubik Black', label: 'Rubik Black', files: { 400: 'Rubik-Black.ttf' }, bold: false, line: 1.252, up: 0.610, low: 0.529 },
  { family: 'Rubik Mono One', label: 'Rubik Mono One', files: { 400: 'RubikMonoOne-Regular.ttf' }, bold: false, line: 1.238, up: 0.850, low: 0.850 },
  { family: 'Unbounded Black', label: 'Unbounded Black', files: { 400: 'Unbounded-Black.ttf' }, bold: false, line: 1.548, up: 0.767, low: 0.656 },
  { family: 'Russo One', label: 'Russo One', files: { 400: 'RussoOne-Regular.ttf' }, bold: false, line: 1.205, up: 0.607, low: 0.524 },
  { family: 'Exo 2 Black', label: 'Exo 2 Black', files: { 400: 'Exo2-Black.ttf' }, bold: false, line: 1.469, up: 0.568, low: 0.499 },
  { family: 'Liberation Sans', label: 'Liberation Sans (Arial)', files: { 400: 'LiberationSans-Regular.ttf', 700: 'LiberationSans-Bold.ttf' }, bold: 'style', line: 1.117, up: 0.594, low: 0.471 },
  { family: 'PT Sans', label: 'PT Sans', files: { 400: 'PT_Sans-Web-Regular.ttf', 700: 'PT_Sans-Web-Bold.ttf' }, bold: 'style', line: 1.294, up: 0.525, low: 0.433 },
  { family: 'PT Serif', label: 'PT Serif', files: { 400: 'PT_Serif-Web-Regular.ttf', 700: 'PT_Serif-Web-Bold.ttf' }, bold: 'style', line: 1.325, up: 0.580, low: 0.475 },
];

// What an old project - or a preset written for fonts the app cannot ship - named, read as the
// nearest shipped font.
export const ALIASES = {
  'arial': 'Liberation Sans', 'helvetica': 'Liberation Sans', 'ibm plex sans': 'Inter',
  'georgia': 'PT Serif', 'times new roman': 'PT Serif',
  'tahoma': 'PT Sans', 'verdana': 'PT Sans', 'courier new': 'PT Sans',
  'impact': 'Fira Sans Extra Condensed Black', 'anton': 'Fira Sans Extra Condensed Black',
  'bebas neue': 'Oswald',
  'the bold font': 'Montserrat Black', 'komika axis': 'Rubik Mono One', 'bangers': 'Rubik Mono One',
  'luckiest guy': 'Rubik Mono One', 'poppins': 'Montserrat',
  'orbitron': 'Russo One', 'syne': 'Unbounded Black', 'outfit': 'Montserrat', 'plus jakarta sans': 'Inter',
};

export const FALLBACK = 'Liberation Sans';

const BY = new Map(FONTS.map(f => [f.family.toLowerCase(), f]));

/** The shipped font a name stands for: itself, its alias, or the fallback. */
export function fontOf(name) {
  const k = String(name == null ? '' : name).trim().toLowerCase();
  return BY.get(k) || BY.get((ALIASES[k] || '').toLowerCase()) || BY.get(FALLBACK.toLowerCase());
}

/** The family a style's font is stored and drawn as. */
export const familyOf = (name) => fontOf(name).family;

/** What the .ass says for a style: the family and its Bold flag (-1 / 0). */
export function assFace(name, bold) {
  const f = fontOf(name);
  const b = f.bold === 'style' ? !!bold : !!f.bold;
  return { family: f.family, bold: b ? -1 : 0 };
}

/** The CSS weight a canvas draws a style's font with - the weight its @font-face is declared at. */
export function cssWeight(name, bold) {
  const f = fontOf(name);
  if (f.bold === 'style') return bold ? 700 : 400;
  return f.bold ? 700 : 400;
}

/** Every file, for a renderer that is handed fonts rather than a folder (JASSUB, K4). */
export const fontFiles = () => FONTS.flatMap(f => Object.values(f.files)).map(x => FONT_DIR + x);
