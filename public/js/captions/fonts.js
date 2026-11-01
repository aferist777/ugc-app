/* ═══════════════════════════════════════════════════════════════════════════
   CAPTIONS — the fonts the app ships, and only those (phase K5, 2026-10-03).

   They live in public/fonts/captions/ (static TTFs, unmodified, OFL or Apache-2.0 - licences beside them) and
   every one draws the whole Russian alphabet - but the five display faces of the text presets (phase V42,
   the owner's (ц2)): Anton, Bebas Neue, Bangers, Luckiest Guy and Permanent Marker have no Cyrillic, and
   libass would quietly fill the missing letters from Arial, the word coming out in two fonts. Each of them
   names its `twin`, a shipped font with Cyrillic: a line that holds a Cyrillic letter is drawn WHOLE in the
   twin (drawnFamily below - ass.js, place.js and text-fx.js all ask it), never a word in two fonts. The
   render hands the folder to the `ass` filter (fontsdir), the page declares them with @font-face
   (css/caption-fonts.css) - the same files on both sides.

   `family` is the name libass looks the font up by: the font's OWN family name (nameID 1), which for a
   weight-named file is "Montserrat Black", not "Montserrat" - asked for "Montserrat" in bold, libass
   gave Arial. `bold` is what the .ass says: true or false fixed by the file (never fake bold on a font
   that has only one weight), 'style' where a family ships both a regular and a bold file and the
   style's own switch chooses. `line` is the height of the font's line in em (what an .ass Fontsize
   measures), (OS/2 winAscent + winDescent) / unitsPerEm of the file. How wide each letter is lives in
   advances.js, read from the same files (K2, tools/caption-advances.js). `ink` is how much of that line
   the letters leave empty above the tallest ("H", "d", "l") and below the lowest ("g", "j", "p", "q", "y"),
   as fractions of the line - measured on what our ffmpeg's libass draws (phase V30, block 3: a page's
   rectangle on the preview, captions/place.js, is where its letters are, not the whole of its lines).

   Old projects named Windows fonts; they are read as the closest shipped one (the owner's answer 3,
   2026-10-03), Arial as Liberation Sans, which has Arial's metrics.

   THE OWNER'S 80 (phase V68 P4, the owner 2026-11-01/02, (хп9), (хп23), (хп52)-(хп55)): wild, graffiti, horror, pixel...
   faces from google/fonts, laid out by tools/build-fonts.py (tools/fonts-list.json pins each file): a variable file made
   the static font of the weight picked, a font whose licence reserves no name cut to Latin and Cyrillic - none is
   otherwise changed. 41 of them draw no Russian (Pixelify Sans lacks О and П) and name their `twin`, chosen by look from
   the fonts with Cyrillic. Every font has a `group` - its row of chips in the fonts tab (GROUPS; the 21 above are
   `basic`). The fonts tab (captions-view.js, hl-style.js) lays them on a lane as `fonts` - style.js, mix.js.
   ═══════════════════════════════════════════════════════════════════════════ */

export const FONT_DIR = '/fonts/captions/';

export const FONTS = [
  { family: 'Montserrat Black', label: 'Montserrat Black', files: { 400: 'Montserrat-Black.ttf' }, bold: false, line: 1.562, ink: [0.18, 0.16] },
  { family: 'Montserrat ExtraBold', label: 'Montserrat ExtraBold', files: { 400: 'Montserrat-ExtraBold.ttf' }, bold: false, line: 1.562, ink: [0.19, 0.16] },
  { family: 'Montserrat', label: 'Montserrat Bold', files: { 700: 'Montserrat-Bold.ttf' }, bold: true, line: 1.562, ink: [0.20, 0.16] },
  { family: 'Inter Black', label: 'Inter Black', files: { 400: 'Inter-Black.ttf' }, bold: false, line: 1.210, ink: [0.15, 0.02] },
  { family: 'Inter ExtraBold', label: 'Inter ExtraBold', files: { 400: 'Inter-ExtraBold.ttf' }, bold: false, line: 1.210, ink: [0.16, 0.02] },
  { family: 'Inter', label: 'Inter Bold', files: { 700: 'Inter-Bold.ttf' }, bold: true, line: 1.210, ink: [0.16, 0.02] },
  { family: 'Oswald', label: 'Oswald Bold', files: { 700: 'Oswald-Bold.ttf' }, bold: true, line: 1.702, ink: [0.30, 0.10] },
  { family: 'Fira Sans Extra Condensed Black', label: 'Fira Sans Condensed Black', files: { 400: 'FiraSansExtraCondensed-Black.ttf' }, bold: false, line: 1.200, ink: [0.09, 0.03] },
  { family: 'Rubik Black', label: 'Rubik Black', files: { 400: 'Rubik-Black.ttf' }, bold: false, line: 1.252, ink: [0.15, 0.07] },
  { family: 'Rubik Mono One', label: 'Rubik Mono One', files: { 400: 'RubikMonoOne-Regular.ttf' }, bold: false, line: 1.238, ink: [0.17, 0.19] },
  { family: 'Unbounded Black', label: 'Unbounded Black', files: { 400: 'Unbounded-Black.ttf' }, bold: false, line: 1.548, ink: [0.26, 0.06] },
  { family: 'Russo One', label: 'Russo One', files: { 400: 'RussoOne-Regular.ttf' }, bold: false, line: 1.205, ink: [0.18, 0.08] },
  { family: 'Exo 2 Black', label: 'Exo 2 Black', files: { 400: 'Exo2-Black.ttf' }, bold: false, line: 1.469, ink: [0.28, 0.07] },
  // No Cyrillic (phase V42): a line with a Cyrillic letter is drawn in the `twin`.
  { family: 'Anton', label: 'Anton', files: { 400: 'Anton-Regular.ttf' }, bold: false, line: 1.733, ink: [0.32, 0.12], twin: 'Fira Sans Extra Condensed Black' },
  { family: 'Bebas Neue', label: 'Bebas Neue', files: { 400: 'BebasNeue-Regular.ttf' }, bold: false, line: 1.300, ink: [0.19, 0.22], twin: 'Oswald' },
  { family: 'Bangers', label: 'Bangers', files: { 400: 'Bangers-Regular.ttf' }, bold: false, line: 1.757, ink: [0.38, 0.17], twin: 'Rubik Mono One' },
  { family: 'Luckiest Guy', label: 'Luckiest Guy', files: { 400: 'LuckiestGuy-Regular.ttf' }, bold: false, line: 1.226, ink: [0.22, 0.13], twin: 'Rubik Mono One' },
  { family: 'Permanent Marker', label: 'Permanent Marker', files: { 400: 'PermanentMarker-Regular.ttf' }, bold: false, line: 1.427, ink: [0.26, 0.18], twin: 'Rubik Black' },
  { family: 'Liberation Sans', label: 'Liberation Sans (Arial)', files: { 400: 'LiberationSans-Regular.ttf', 700: 'LiberationSans-Bold.ttf' }, bold: 'style', line: 1.117, ink: [0.16, 0.00] },
  { family: 'PT Sans', label: 'PT Sans', files: { 400: 'PT_Sans-Web-Regular.ttf', 700: 'PT_Sans-Web-Bold.ttf' }, bold: 'style', line: 1.294, ink: [0.23, 0.05] },
  { family: 'PT Serif', label: 'PT Serif', files: { 400: 'PT_Serif-Web-Regular.ttf', 700: 'PT_Serif-Web-Bold.ttf' }, bold: 'style', line: 1.325, ink: [0.21, 0.05] },
  // THE OWNER'S 80 (phase V68 P4, (хп9)): made by tools/build-fonts.py from google/fonts; `group` - their group in the fonts
  // tab; `twin` where the file has no Russian alphabet (Pixelify Sans lacks О and П).
  // graffiti
  { family: 'Lacquer', label: 'Lacquer', files: { 400: 'Lacquer-Regular.ttf' }, bold: false, line: 1.707, ink: [0.28, 0.28], group: 'graffiti', twin: 'Rubik Spray Paint' },
  { family: 'Rubik Burned', label: 'Rubik Burned', files: { 400: 'RubikBurned-Regular.ttf' }, bold: false, line: 1.414, ink: [0.23, 0.07], group: 'graffiti' },
  { family: 'Rubik Dirt', label: 'Rubik Dirt', files: { 400: 'RubikDirt-Regular.ttf' }, bold: false, line: 1.414, ink: [0.23, 0.11], group: 'graffiti' },
  { family: 'Rubik Spray Paint', label: 'Rubik Spray Paint', files: { 400: 'RubikSprayPaint-Regular.ttf' }, bold: false, line: 1.414, ink: [0.22, 0.11], group: 'graffiti' },
  { family: 'Rubik Wet Paint', label: 'Rubik Wet Paint', files: { 400: 'RubikWetPaint-Regular.ttf' }, bold: false, line: 1.414, ink: [0.23, -0.03], group: 'graffiti' },
  { family: 'Sedgwick Ave Display', label: 'Sedgwick Ave Display', files: { 400: 'SedgwickAveDisplay-Regular.ttf' }, bold: false, line: 3.106, ink: [0.54, 0.00], group: 'graffiti', twin: 'Rubik Wet Paint' },
  // brush
  { family: 'Comforter Brush', label: 'Comforter Brush', files: { 400: 'ComforterBrush-Regular.ttf' }, bold: false, line: 1.906, ink: [0.19, 0.14], group: 'brush' },
  { family: 'Kaushan Script', label: 'Kaushan Script', files: { 400: 'KaushanScript-Regular.ttf' }, bold: false, line: 1.451, ink: [0.17, 0.00], group: 'brush', twin: 'Lobster' },
  { family: 'Knewave', label: 'Knewave', files: { 400: 'Knewave-Regular.ttf' }, bold: false, line: 1.554, ink: [0.23, 0.04], group: 'brush', twin: 'Lobster' },
  { family: 'Splash', label: 'Splash', files: { 400: 'Splash-Regular.ttf' }, bold: false, line: 2.276, ink: [0.24, 0.23], group: 'brush', twin: 'Comforter Brush' },
  { family: 'Yuji Boku', label: 'Yuji Boku', files: { 400: 'YujiBoku-Regular.ttf' }, bold: false, line: 1.448, ink: [0.33, 0.04], group: 'brush' },
  // marker
  { family: 'Finger Paint', label: 'Finger Paint', files: { 400: 'FingerPaint-Regular.ttf' }, bold: false, line: 1.474, ink: [0.19, 0.00], group: 'marker', twin: 'Underdog' },
  { family: 'Londrina Solid Black', label: 'Londrina Solid Black', files: { 400: 'LondrinaSolid-Black.ttf' }, bold: false, line: 1.156, ink: [0.18, 0.00], group: 'marker', twin: 'Rubik Black' },
  { family: 'Rubik Marker Hatch', label: 'Rubik Marker Hatch', files: { 400: 'RubikMarkerHatch-Regular.ttf' }, bold: false, line: 1.414, ink: [0.23, 0.11], group: 'marker' },
  { family: 'Rubik Scribble', label: 'Rubik Scribble', files: { 400: 'RubikScribble-Regular.ttf' }, bold: false, line: 1.281, ink: [0.18, 0.07], group: 'marker' },
  // comic
  { family: 'Bungee', label: 'Bungee', files: { 400: 'Bungee-Regular.ttf' }, bold: false, line: 2.574, ink: [0.36, 0.33], group: 'comic', twin: 'Rubik Mono One' },
  { family: 'Chewy', label: 'Chewy', files: { 400: 'Chewy-Regular.ttf' }, bold: false, line: 1.282, ink: [0.16, 0.00], group: 'comic', twin: 'Rubik Bubbles' },
  { family: 'Kablammo', label: 'Kablammo', files: { 400: 'Kablammo-Regular.ttf' }, bold: false, line: 1.549, ink: [0.29, 0.12], group: 'comic' },
  { family: 'Rubik Doodle Shadow', label: 'Rubik Doodle Shadow', files: { 400: 'RubikDoodleShadow-Regular.ttf' }, bold: false, line: 1.307, ink: [0.18, 0.07], group: 'comic' },
  { family: 'Shantell Sans ExtraBold', label: 'Shantell Sans ExtraBold', files: { 400: 'ShantellSans-ExtraBold.ttf' }, bold: false, line: 1.730, ink: [0.26, 0.14], group: 'comic' },
  { family: 'Sigmar One', label: 'Sigmar One', files: { 400: 'SigmarOne-Regular.ttf' }, bold: false, line: 1.648, ink: [0.31, 0.16], group: 'comic', twin: 'Seymour One' },
  // horror
  { family: 'Butcherman', label: 'Butcherman', files: { 400: 'Butcherman-Regular.ttf' }, bold: false, line: 1.935, ink: [0.27, 0.28], group: 'horror', twin: 'Rubik Beastly' },
  { family: 'Creepster', label: 'Creepster', files: { 400: 'Creepster-Regular.ttf' }, bold: false, line: 1.169, ink: [0.17, 0.13], group: 'horror', twin: 'Rubik Wet Paint' },
  { family: 'Eater', label: 'Eater', files: { 400: 'Eater-Regular.ttf' }, bold: false, line: 1.864, ink: [0.31, 0.10], group: 'horror', twin: 'Rubik Beastly' },
  { family: 'Metal Mania', label: 'Metal Mania', files: { 400: 'MetalMania-Regular.ttf' }, bold: false, line: 1.238, ink: [0.18, 0.07], group: 'horror', twin: 'Ruslan Display' },
  { family: 'Nosifer', label: 'Nosifer', files: { 400: 'Nosifer-Regular.ttf' }, bold: false, line: 1.740, ink: [0.24, 0.13], group: 'horror', twin: 'Rubik Wet Paint' },
  { family: 'Rubik Beastly', label: 'Rubik Beastly', files: { 400: 'RubikBeastly-Regular.ttf' }, bold: false, line: 1.414, ink: [0.17, 0.07], group: 'horror' },
  // retro
  { family: 'Climate Crisis', label: 'Climate Crisis', files: { 400: 'ClimateCrisis-Regular.ttf' }, bold: false, line: 1.620, ink: [0.34, 0.11], group: 'retro' },
  { family: 'Faster One', label: 'Faster One', files: { 400: 'FasterOne-Regular.ttf' }, bold: false, line: 1.371, ink: [0.28, 0.24], group: 'retro', twin: 'Rubik Glitch' },
  { family: 'Lobster', label: 'Lobster', files: { 400: 'Lobster-Regular.ttf' }, bold: false, line: 1.490, ink: [0.17, 0.16], group: 'retro' },
  { family: 'Monoton', label: 'Monoton', files: { 400: 'Monoton-Regular.ttf' }, bold: false, line: 1.557, ink: [0.23, 0.19], group: 'retro', twin: 'Rubik Vinyl' },
  { family: 'Rubik 80s Fade', label: 'Rubik 80s Fade', files: { 400: 'Rubik80sFade-Regular.ttf' }, bold: false, line: 1.414, ink: [0.23, 0.12], group: 'retro' },
  { family: 'Rubik Vinyl', label: 'Rubik Vinyl', files: { 400: 'RubikVinyl-Regular.ttf' }, bold: false, line: 1.414, ink: [0.19, 0.08], group: 'retro' },
  { family: 'Ruslan Display', label: 'Ruslan Display', files: { 400: 'RuslanDisplay-Regular.ttf' }, bold: false, line: 1.101, ink: [0.16, 0.00], group: 'retro' },
  // pixel
  { family: 'DotGothic16', label: 'DotGothic16', files: { 400: 'DotGothic16-Regular.ttf' }, bold: false, line: 1.448, ink: [0.26, 0.14], group: 'pixel' },
  { family: 'Jacquarda Bastarda 9', label: 'Jacquarda Bastarda 9', files: { 400: 'JacquardaBastarda9-Regular.ttf' }, bold: false, line: 1.312, ink: [0.18, 0.06], group: 'pixel', twin: 'Tiny5' },
  { family: 'Pixelify Sans', label: 'Pixelify Sans Bold', files: { 700: 'PixelifySans-Bold.ttf' }, bold: true, line: 1.211, ink: [0.23, 0.09], group: 'pixel', twin: 'Press Start 2P' },
  { family: 'Press Start 2P', label: 'Press Start 2P', files: { 400: 'PressStart2P-Regular.ttf' }, bold: false, line: 1.374, ink: [0.00, 0.27], group: 'pixel' },
  { family: 'Rubik Pixels', label: 'Rubik Pixels', files: { 400: 'RubikPixels-Regular.ttf' }, bold: false, line: 1.414, ink: [0.24, 0.13], group: 'pixel' },
  { family: 'Tiny5', label: 'Tiny5', files: { 400: 'Tiny5-Regular.ttf' }, bold: false, line: 2.000, ink: [0.44, 0.19], group: 'pixel' },
  // stencil
  { family: 'Big Shoulders Stencil Black', label: 'Big Shoulders Stencil Black', files: { 400: 'BigShouldersStencil-Black.ttf' }, bold: false, line: 1.672, ink: [0.30, 0.09], group: 'stencil', twin: 'Sofia Sans Extra Condensed Black' },
  { family: 'Black Ops One', label: 'Black Ops One', files: { 400: 'BlackOpsOne-Regular.ttf' }, bold: false, line: 1.426, ink: [0.26, 0.11], group: 'stencil', twin: 'Russo One' },
  { family: 'Emblema One', label: 'Emblema One', files: { 400: 'EmblemaOne-Regular.ttf' }, bold: false, line: 1.193, ink: [0.21, 0.03], group: 'stencil', twin: 'Stalinist One' },
  { family: 'Wallpoet', label: 'Wallpoet', files: { 400: 'Wallpoet-Regular.ttf' }, bold: false, line: 1.002, ink: [0.23, 0.00], group: 'stencil', twin: 'Tektur ExtraBold' },
  // hand
  { family: 'Caveat', label: 'Caveat Bold', files: { 700: 'Caveat-Bold.ttf' }, bold: true, line: 1.289, ink: [0.19, 0.04], group: 'hand' },
  { family: 'Hachi Maru Pop', label: 'Hachi Maru Pop', files: { 400: 'HachiMaruPop-Regular.ttf' }, bold: false, line: 1.448, ink: [0.34, 0.06], group: 'hand' },
  { family: 'Marck Script', label: 'Marck Script', files: { 400: 'MarckScript-Regular.ttf' }, bold: false, line: 1.249, ink: [0.07, 0.00], group: 'hand' },
  { family: 'Neucha', label: 'Neucha', files: { 400: 'Neucha.ttf' }, bold: false, line: 1.221, ink: [0.14, 0.00], group: 'hand' },
  { family: 'Special Elite', label: 'Special Elite', files: { 400: 'SpecialElite-Regular.ttf' }, bold: false, line: 1.000, ink: [0.01, 0.06], group: 'hand', twin: 'PT Serif' },
  { family: 'Underdog', label: 'Underdog', files: { 400: 'Underdog-Regular.ttf' }, bold: false, line: 1.156, ink: [0.11, 0.03], group: 'hand' },
  // bubble
  { family: 'Bagel Fat One', label: 'Bagel Fat One', files: { 400: 'BagelFatOne-Regular.ttf' }, bold: false, line: 1.448, ink: [0.27, 0.06], group: 'bubble', twin: 'Seymour One' },
  { family: 'Cherry Bomb One', label: 'Cherry Bomb One', files: { 400: 'CherryBombOne-Regular.ttf' }, bold: false, line: 1.448, ink: [0.32, 0.08], group: 'bubble', twin: 'Rubik Bubbles' },
  { family: 'Coiny', label: 'Coiny', files: { 400: 'Coiny-Regular.ttf' }, bold: false, line: 1.000, ink: [0.06, 0.04], group: 'bubble', twin: 'Seymour One' },
  { family: 'Modak', label: 'Modak', files: { 400: 'Modak-Regular.ttf' }, bold: false, line: 1.506, ink: [0.20, 0.22], group: 'bubble', twin: 'Rubik Bubbles' },
  { family: 'Rubik Bubbles', label: 'Rubik Bubbles', files: { 400: 'RubikBubbles-Regular.ttf' }, bold: false, line: 1.414, ink: [0.22, 0.11], group: 'bubble' },
  { family: 'Rubik Moonrocks', label: 'Rubik Moonrocks', files: { 400: 'RubikMoonrocks-Regular.ttf' }, bold: false, line: 1.414, ink: [0.23, 0.11], group: 'bubble' },
  // condensed
  { family: 'Amatic SC', label: 'Amatic SC Bold', files: { 700: 'AmaticSC-Bold.ttf' }, bold: true, line: 1.404, ink: [0.28, 0.04], group: 'condensed' },
  { family: 'Big Shoulders Display Black', label: 'Big Shoulders Display Black', files: { 400: 'BigShouldersDisplay-Black.ttf' }, bold: false, line: 1.672, ink: [0.30, 0.09], group: 'condensed', twin: 'Sofia Sans Extra Condensed Black' },
  { family: 'Six Caps', label: 'Six Caps', files: { 400: 'SixCaps.ttf' }, bold: false, line: 1.316, ink: [0.20, 0.09], group: 'condensed', twin: 'Sofia Sans Extra Condensed Black' },
  { family: 'Sofia Sans Extra Condensed Black', label: 'Sofia Sans Extra Condensed Black', files: { 400: 'SofiaSansExtraCondensed-Black.ttf' }, bold: false, line: 1.310, ink: [0.25, 0.08], group: 'condensed' },
  { family: 'Yanone Kaffeesatz', label: 'Yanone Kaffeesatz Bold', files: { 700: 'YanoneKaffeesatz-Bold.ttf' }, bold: true, line: 1.342, ink: [0.24, 0.06], group: 'condensed' },
  // gothic
  { family: 'Fruktur', label: 'Fruktur', files: { 400: 'Fruktur-Regular.ttf' }, bold: false, line: 1.604, ink: [0.34, 0.04], group: 'gothic', twin: 'Ruslan Display' },
  { family: 'Grenze Gotisch ExtraBold', label: 'Grenze Gotisch ExtraBold', files: { 400: 'GrenzeGotisch-ExtraBold.ttf' }, bold: false, line: 1.491, ink: [0.31, 0.13], group: 'gothic', twin: 'Ruslan Display' },
  { family: 'New Rocker', label: 'New Rocker', files: { 400: 'NewRocker-Regular.ttf' }, bold: false, line: 1.229, ink: [0.13, 0.00], group: 'gothic', twin: 'Ruslan Display' },
  { family: 'Pirata One', label: 'Pirata One', files: { 400: 'PirataOne-Regular.ttf' }, bold: false, line: 1.285, ink: [0.18, 0.07], group: 'gothic', twin: 'Ruslan Display' },
  { family: 'UnifrakturMaguntia', label: 'UnifrakturMaguntia', files: { 400: 'UnifrakturMaguntia-Book.ttf' }, bold: false, line: 1.035, ink: [0.06, 0.04], group: 'gothic', twin: 'Ruslan Display' },
  // techno
  { family: 'Audiowide', label: 'Audiowide', files: { 400: 'Audiowide-Regular.ttf' }, bold: false, line: 1.275, ink: [0.19, 0.04], group: 'techno', twin: 'Russo One' },
  { family: 'Orbitron Black', label: 'Orbitron Black', files: { 400: 'Orbitron-Black.ttf' }, bold: false, line: 1.254, ink: [0.19, 0.01], group: 'techno', twin: 'Tektur ExtraBold' },
  { family: 'Rubik Glitch', label: 'Rubik Glitch', files: { 400: 'RubikGlitch-Regular.ttf' }, bold: false, line: 1.414, ink: [0.23, 0.11], group: 'techno' },
  { family: 'Stalinist One', label: 'Stalinist One', files: { 400: 'StalinistOne-Regular.ttf' }, bold: false, line: 1.476, ink: [0.23, 0.18], group: 'techno' },
  { family: 'Tektur ExtraBold', label: 'Tektur ExtraBold', files: { 400: 'Tektur-ExtraBold.ttf' }, bold: false, line: 1.300, ink: [0.23, 0.13], group: 'techno' },
  // western
  { family: 'Ewert', label: 'Ewert', files: { 400: 'Ewert-Regular.ttf' }, bold: false, line: 1.243, ink: [0.19, 0.18], group: 'western', twin: 'Ruslan Display' },
  { family: 'Rye', label: 'Rye', files: { 400: 'Rye-Regular.ttf' }, bold: false, line: 1.250, ink: [0.16, 0.00], group: 'western', twin: 'PT Serif' },
  { family: 'Smokum', label: 'Smokum', files: { 400: 'Smokum-Regular.ttf' }, bold: false, line: 1.220, ink: [0.18, 0.01], group: 'western', twin: 'Oswald' },
  { family: 'Ultra', label: 'Ultra', files: { 400: 'Ultra-Regular.ttf' }, bold: false, line: 1.283, ink: [0.23, 0.00], group: 'western', twin: 'Seymour One' },
  // heavy
  { family: 'Dela Gothic One', label: 'Dela Gothic One', files: { 400: 'DelaGothicOne-Regular.ttf' }, bold: false, line: 1.448, ink: [0.26, 0.02], group: 'heavy' },
  { family: 'Rampart One', label: 'Rampart One', files: { 400: 'RampartOne-Regular.ttf' }, bold: false, line: 1.448, ink: [0.26, 0.03], group: 'heavy' },
  { family: 'Reggae One', label: 'Reggae One', files: { 400: 'ReggaeOne-Regular.ttf' }, bold: false, line: 1.448, ink: [0.26, 0.04], group: 'heavy' },
  { family: 'Seymour One', label: 'Seymour One', files: { 400: 'SeymourOne-Regular.ttf' }, bold: false, line: 1.510, ink: [0.23, 0.07], group: 'heavy' },
  { family: 'Train One', label: 'Train One', files: { 400: 'TrainOne-Regular.ttf' }, bold: false, line: 1.448, ink: [0.26, 0.06], group: 'heavy' },
];

// What an old project - or a preset written for fonts the app cannot ship - named, read as the
// nearest shipped font.
export const ALIASES = {
  'arial': 'Liberation Sans', 'helvetica': 'Liberation Sans', 'ibm plex sans': 'Inter',
  'georgia': 'PT Serif', 'times new roman': 'PT Serif',
  'tahoma': 'PT Sans', 'verdana': 'PT Sans', 'courier new': 'PT Sans',
  'impact': 'Fira Sans Extra Condensed Black',
  'the bold font': 'Montserrat Black', 'komika axis': 'Rubik Mono One', 'poppins': 'Montserrat',
  'orbitron': 'Russo One', 'syne': 'Unbounded Black', 'outfit': 'Montserrat', 'plus jakarta sans': 'Inter',
};

export const FALLBACK = 'Liberation Sans';

// The fonts tab's groups, in their order (V68 P4: the owner's 15 of P1, then the app's own 21).
export const GROUPS = [['graffiti', 'graffiti'], ['brush', 'brush'], ['marker', 'marker'], ['comic', 'comic'], ['horror', 'horror'],
  ['retro', 'retro'], ['pixel', 'pixel'], ['stencil', 'stencil'], ['hand', 'handwritten'], ['bubble', 'bubble'],
  ['condensed', 'condensed'], ['gothic', 'gothic'], ['techno', 'techno'], ['western', 'western'], ['heavy', 'heavy'], ['basic', 'basic']];
/** A font's group in the fonts tab. */
export const groupOf = (f) => (f && f.group) || 'basic';

const BY = new Map(FONTS.map(f => [f.family.toLowerCase(), f]));

/** The shipped font a name stands for: itself, its alias, or the fallback. */
export function fontOf(name) {
  const k = String(name == null ? '' : name).trim().toLowerCase();
  return BY.get(k) || BY.get((ALIASES[k] || '').toLowerCase()) || BY.get(FALLBACK.toLowerCase());
}

/** The family a style's font is stored and drawn as. */
export const familyOf = (name) => fontOf(name).family;

// A letter of the Cyrillic alphabets (phase V42).
const CYRILLIC = /[Ѐ-ӿ]/;

/**
 * The family a line saying `text` is DRAWN in: its style's font - or, where that font has no Cyrillic and the line holds a
 * Cyrillic letter, the font's twin (phase V42, the owner's (ц2)): the whole line, never a word in two fonts.
 */
export function drawnFamily(name, text) {
  const f = fontOf(name);
  return f.twin && CYRILLIC.test(String(text == null ? '' : text)) ? f.twin : f.family;
}

/** A style as a line saying `text` is drawn: the same object when its font draws every letter, else a copy in the twin. */
export function withTwin(st, text) {
  if (!st) return st;
  const fam = drawnFamily(st.font, text);
  return fam === fontOf(st.font).family ? st : Object.assign({}, st, { font: fam });
}

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
