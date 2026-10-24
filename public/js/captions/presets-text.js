/* ═══════════════════════════════════════════════════════════════════════════
   CAPTIONS — THE TEXT PRESETS: titles, hooks, labels, callouts, kinetic type (phase V42; the mockup the owner approved
   2026-10-24, (ц1)). Written by hand.

   A text preset is a look (font, colours, outline, what stands behind) + an entrance + an exit (style.js enter / leave,
   drawn by text-fx.js). It is a BASE like a caption preset (preset-use.js): applying it copies its style, marked with its
   id - but it has NO PLACE (the owner's (ц3)): the line or lane keeps where it was put (TEXT_KEEP). Sizes are pixels of a
   1080-wide frame. `sample` is what its tile says (lib/caption-tiles.js).

   The fonts without Cyrillic (Anton, Bebas Neue, Bangers, Luckiest Guy, Permanent Marker) draw a line with a Cyrillic
   letter in their twin (fonts.js).
   ═══════════════════════════════════════════════════════════════════════════ */

export const TEXT_CATEGORIES = [
  { id: 'headline', label: 'Headline' }, { id: 'hook', label: 'Hook' }, { id: 'label', label: 'Label' },
  { id: 'callout', label: 'Callout' }, { id: 'kinetic', label: 'Kinetic' },
];

/** What a text preset never sets on a line or a lane: where it is (ц3). */
export const TEXT_KEEP = ['pos', 'tx', 'ty'];

// What every text preset says unless it says otherwise: no spoken word, nothing behind, its own size.
const BASE = {
  bold: true, italic: false, outline: 0, shadow: 0, shadowAlpha: 0.75, blur: 0, spacing: 0, scaleX: 100, scaleY: 100,
  primary: '#ffffff', secondary: '#ffffff', highlight: '#ffe14d', outlineColor: '#000000', shadowColor: '#000000',
  backColor: '#000000', backAlpha: 0, borderStyle: 'outline', casing: 'none', effect: 'none', appear: 'none',
  wrap: true, lines: 3, wordsPerLine: 0, sizeAuto: false,
  enter: 'none', enterDur: 0.5, leave: 'none', leaveDur: 0.4, plate: 'none', plateIn: '', plateOut: '', tilt: 0, glow: 0, glowColor: '',
};
const P = (id, name, category, sample, style) => ({ id, name, category, kind: 'text', sample, style: Object.assign({}, BASE, style) });

export const TEXT_PRESETS = [
  // ── Headline: a big title ──
  // The highlights title's look since V33.3 (captions/title.js): white on a dark box.
  P('tx-dark-plate', 'Dark Plate', 'headline', 'How I made $10K in 30 days', { font: 'Montserrat ExtraBold', size: 92,
    borderStyle: 'box', outline: 14, backAlpha: 0.8, enter: 'pop', enterDur: 0.35, leave: 'fade', leaveDur: 0.3 }),
  P('tx-impact', 'Impact', 'headline', 'HOW I MADE $10K', { font: 'Anton', size: 150, outline: 6, shadow: 5, shadowAlpha: 0.6,
    casing: 'upper', enter: 'zoom', enterDur: 0.45, leave: 'zoom', leaveDur: 0.35 }),
  P('tx-bebas-wide', 'Bebas Wide', 'headline', 'THE MORNING ROUTINE', { font: 'Bebas Neue', size: 150, spacing: 5, shadow: 4, shadowAlpha: 0.45,
    enter: 'stretch', enterDur: 0.7, leave: 'stretch', leaveDur: 0.45 }),
  P('tx-yellow-box', 'Yellow Box', 'headline', '5 mistakes to avoid', { font: 'Montserrat Black', size: 96, primary: '#111111', casing: 'upper',
    borderStyle: 'box', outline: 14, backColor: '#ffe14d', backAlpha: 1, enter: 'wipe', enterDur: 0.45, leave: 'wipe', leaveDur: 0.35 }),
  P('tx-white-pill', 'White Pill', 'headline', 'My honest review', { font: 'Montserrat ExtraBold', size: 88, primary: '#111111',
    plate: 'pill', backColor: '#ffffff', backAlpha: 1, enter: 'grow', enterDur: 0.45, leave: 'shrink', leaveDur: 0.3 }),
  P('tx-cinematic', 'Cinematic', 'headline', 'Chapter one', { font: 'PT Serif', size: 100, primary: '#f5f1e8', spacing: 6, casing: 'upper',
    shadow: 3, shadowAlpha: 0.5, enter: 'blur', enterDur: 0.8, leave: 'blur', leaveDur: 0.6 }),

  // ── Hook: the first seconds ──
  P('tx-wait', 'Wait For It', 'hook', 'WAIT FOR IT', { font: 'Bangers', size: 160, primary: '#ffe14d', outline: 10, shadow: 9, shadowAlpha: 0.95,
    spacing: 2, tilt: 4, enter: 'drop', enterDur: 0.75, leave: 'pop', leaveDur: 0.35 }),
  P('tx-stop', 'Stop Scrolling', 'hook', 'STOP SCROLLING', { font: 'Anton', size: 130,
    borderStyle: 'box', outline: 14, backColor: '#e11d48', backAlpha: 1, enter: 'glitch', enterDur: 0.55, leave: 'glitch', leaveDur: 0.35 }),
  P('tx-comic', 'Comic Pop', 'hook', 'NO WAY!', { font: 'Luckiest Guy', size: 150, outline: 9, shadow: 8, shadowAlpha: 1,
    enter: 'letters-pop', enterDur: 0.7, leave: 'letters', leaveDur: 0.45 }),
  P('tx-neon', 'Neon', 'hook', 'Watch till the end', { font: 'Montserrat Black', size: 104, primary: '#effdff', outline: 2, outlineColor: '#22e4ff',
    casing: 'upper', glow: 5, glowColor: '#22e4ff', enter: 'flicker', enterDur: 0.65, leave: 'flicker', leaveDur: 0.4 }),
  P('tx-punch', 'Punch', 'hook', 'WHAT?!', { font: 'Anton', size: 220, outline: 6, shadow: 6, shadowAlpha: 0.7,
    enter: 'zoom', enterDur: 0.28, leave: 'fall', leaveDur: 0.45 }),
  P('tx-did-you-know', 'Did You Know', 'hook', 'Did you know?', { font: 'Rubik Black', size: 92,
    plate: 'round', backColor: '#7c3aed', backAlpha: 1, enter: 'swing', enterDur: 0.6, leave: 'sink', leaveDur: 0.35 }),

  // ── Label: a small line at the side or below ──
  P('tx-lower-third', 'Lower Third', 'label', 'Sarah · founder', { font: 'Inter', size: 60, primary: '#111111',
    plate: 'tag', backColor: '#ffffff', backAlpha: 1, highlight: '#ef4444', enter: 'from-left', enterDur: 0.45, leave: 'to-left', leaveDur: 0.35 }),
  P('tx-blue-tag', 'Blue Tag', 'label', 'New video', { font: 'Inter Black', size: 54, casing: 'upper', spacing: 2,
    plate: 'pill', backColor: '#2563eb', backAlpha: 1, enter: 'pop', enterDur: 0.3, leave: 'fade', leaveDur: 0.25 }),
  P('tx-clean', 'Clean', 'label', 'Day 1 of 30', { font: 'Inter', size: 70, shadow: 3, shadowAlpha: 0.6,
    enter: 'rise', enterDur: 0.45, leave: 'fade', leaveDur: 0.3 }),
  P('tx-place-time', 'Place & Time', 'label', 'PARIS · 7:00 AM', { font: 'Bebas Neue', size: 90, spacing: 8, highlight: '#ffffff',
    enter: 'typewriter', enterDur: 0.75, leave: 'fade', leaveDur: 0.3 }),
  P('tx-day-counter', 'Day Counter', 'label', 'Day 12', { font: 'Montserrat Black', size: 84, primary: '#111111', casing: 'upper',
    borderStyle: 'box', outline: 12, backColor: '#ffffff', backAlpha: 1, enter: 'mask-rise', enterDur: 0.45, leave: 'mask-sink', leaveDur: 0.35,
    plateIn: 'wipe', plateOut: 'wipe' }),
  P('tx-step', 'Step', 'label', 'Step 1: prep', { font: 'Oswald', size: 84, casing: 'upper', spacing: 3,
    plate: 'underline', backColor: '#ffe14d', backAlpha: 1, enter: 'rise', enterDur: 0.45, leave: 'fade', leaveDur: 0.3,
    plateIn: 'wipe', plateOut: 'wipe' }),

  // ── Callout: a word or a phrase pointed at ──
  P('tx-highlighter', 'Highlighter', 'callout', 'this changed everything', { font: 'Montserrat ExtraBold', size: 88, primary: '#111111',
    plate: 'marker', backColor: '#ffe14d', backAlpha: 1, enter: 'fade', enterDur: 0.45, leave: 'fade', leaveDur: 0.3, plateIn: 'wipe' }),
  P('tx-underline', 'Underline', 'callout', 'best decision ever', { font: 'Montserrat Black', size: 88,
    plate: 'underline', backColor: '#ef4444', backAlpha: 1, enter: 'rise', enterDur: 0.45, leave: 'rise', leaveDur: 0.3,
    plateIn: 'wipe', plateOut: 'wipe' }),
  P('tx-red-pill', 'Red Pill', 'callout', "Don't do this", { font: 'Montserrat ExtraBold', size: 84,
    plate: 'pill', backColor: '#ef4444', backAlpha: 1, enter: 'grow', enterDur: 0.4, leave: 'pop', leaveDur: 0.35 }),
  P('tx-marker-pen', 'Marker Pen', 'callout', 'Game changer', { font: 'Permanent Marker', size: 130, shadow: 4, shadowAlpha: 0.5,
    tilt: 3, enter: 'wipe', enterDur: 0.7, leave: 'fade', leaveDur: 0.35 }),
  P('tx-circled', 'Circled', 'callout', '$10K', { font: 'Montserrat Black', size: 130, outline: 4,
    plate: 'circle', backColor: '#ef4444', backAlpha: 1, enter: 'pop', enterDur: 0.45, leave: 'fade', leaveDur: 0.3, plateIn: 'wipe' }),
  P('tx-sticker', 'Sticker', 'callout', 'MUST TRY', { font: 'Luckiest Guy', size: 110, primary: '#111111',
    plate: 'sticker', backColor: '#ffffff', backAlpha: 1, tilt: 5, enter: 'swing', enterDur: 0.55, leave: 'shrink', leaveDur: 0.3 }),

  // ── Kinetic: the letters and the words move ──
  P('tx-typewriter', 'Typewriter', 'kinetic', 'Day 1 of 30', { font: 'Rubik Mono One', size: 70,
    enter: 'typewriter', enterDur: 0.8, leave: 'backspace', leaveDur: 0.55 }),
  P('tx-word-rise', 'Word Rise', 'kinetic', 'This is how I did it', { font: 'Montserrat Black', size: 100, outline: 5, casing: 'upper',
    enter: 'words', enterDur: 0.65, leave: 'words', leaveDur: 0.45 }),
  P('tx-letter-drop', 'Letter Drop', 'kinetic', 'BOOM', { font: 'Bangers', size: 210, outline: 7, shadow: 7, shadowAlpha: 1, spacing: 3,
    enter: 'letters-drop', enterDur: 0.9, leave: 'letters-fall', leaveDur: 0.6 }),
  P('tx-glitch', 'Glitch', 'kinetic', 'ERROR 404', { font: 'Rubik Mono One', size: 96,
    enter: 'glitch', enterDur: 0.65, leave: 'glitch', leaveDur: 0.4 }),
  P('tx-slot', 'Slot', 'kinetic', 'THE NEW\nRECORD', { font: 'Anton', size: 150, primary: '#ffe14d',
    enter: 'mask-rise', enterDur: 0.55, leave: 'mask-sink', leaveDur: 0.4 }),
  P('tx-stretch', 'Stretch', 'kinetic', 'SO GOOD', { font: 'Bebas Neue', size: 200, spacing: 2,
    enter: 'stretch', enterDur: 0.7, leave: 'zoom', leaveDur: 0.4 }),
  P('tx-word-pop', 'Word Pop', 'kinetic', "You won't believe it", { font: 'Montserrat Black', size: 100, outline: 6, casing: 'upper',
    enter: 'words-pop', enterDur: 0.7, leave: 'pop', leaveDur: 0.3 }),
];

const BY = new Map(TEXT_PRESETS.map((p) => [p.id, p]));
/** The text preset of an id, or null. */
export const textPresetOf = (id) => BY.get(String(id || '')) || null;
