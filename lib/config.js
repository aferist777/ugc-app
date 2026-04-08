'use strict';

const path = require('path');
const fs   = require('fs');

// ── Directories ──────────────────────────────────────────────────────────────
const ROOT_DIR         = path.join(__dirname, '..');
const UPLOADS_DIR      = path.join(ROOT_DIR, 'uploads');
const LOOKBOOKS_DIR    = path.join(ROOT_DIR, 'lookbooks');
const CHARACTERS_DIR   = path.join(ROOT_DIR, 'characters');
const ENVIRONMENTS_DIR = path.join(ROOT_DIR, 'environments');
const ARCHIVE_DIR      = path.join(ROOT_DIR, 'archive');
const SCENARIOS_DIR    = path.join(ROOT_DIR, 'scenarios');
const DETAILS_DIR      = path.join(ROOT_DIR, 'details');
const LOGS_DIR         = path.join(ROOT_DIR, 'logs');
const LOG_FILE         = path.join(LOGS_DIR, 'generation_log.txt');

const ARCHIVE_SUBDIRS = ['character', 'lookbook', 'environment'];

const GALLERY_MAP = {
  'characters':   { dir: CHARACTERS_DIR,   archiveSub: 'character' },
  'lookbooks':    { dir: LOOKBOOKS_DIR,    archiveSub: 'lookbook' },
  'environments': { dir: ENVIRONMENTS_DIR, archiveSub: 'environment' },
};

// Ensure all dirs exist at startup
for (const d of [UPLOADS_DIR, LOOKBOOKS_DIR, CHARACTERS_DIR, ENVIRONMENTS_DIR,
                 ARCHIVE_DIR, SCENARIOS_DIR, DETAILS_DIR, LOGS_DIR]) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}
for (const sub of ARCHIVE_SUBDIRS) {
  const p = path.join(ARCHIVE_DIR, sub);
  if (!fs.existsSync(p)) fs.mkdirSync(p);
}

// ── API ───────────────────────────────────────────────────────────────────────
const KIE_BASE = 'https://api.kie.ai';

// ── Skin analysis params ──────────────────────────────────────────────────────
const SKIN_PARAMS = [
  'visible pores', 'fine micro-texture', 'organic acne marks', 'non-repeating marks',
  'uneven pigmentation', 'subtle redness', 'natural oil sheen', 'acne scars',
  'bare skin', 'fine lines', 'subtle under-eye texture', 'visible veins',
  'fine wrinkles', 'skin texture',
];
const NO_RETOUCH = [
  'unretouched', 'no smoothing', 'no airbrushing',
  'no beauty filters', 'no retouching', 'no plastic skin',
];

// ── Prompts ───────────────────────────────────────────────────────────────────
const EXTRACT_CLOTHING_PROMPT =
  `Flat lay product photograph of every clothing item and accessory worn by the person in the reference image. ` +
  `Show each garment and accessory as individual items laid flat: tops, bottoms, dresses, jackets, shoes, bags, hats, jewelry, belts, scarves — every visible piece. ` +
  `Pure white background. Absolutely no human body, no face, no skin, no mannequin, no model, no watermarks, no shadows. ` +
  `For each item add a clean annotation: a short straight thin black arrow pointing to it with a concise 2-word English label (e.g. "linen blazer", "silk scarf", "leather belt", "ankle boots"). ` +
  `Labels in clean black sans-serif text with white outline for contrast. Arrows are thin black lines with a small arrowhead. ` +
  `Clean product photography, sharp focus, high detail, 1:1 square format.`;

const EXTRACT_BG_PROMPT =
  `Extract and reconstruct only the background environment from this reference image. ` +
  `Remove all people, models, and human figures completely — leave zero trace of any person. ` +
  `Show only the setting: walls, floors, furniture, decor, scenery, sky, architecture. ` +
  `Seamlessly fill any areas where people were removed. ` +
  `Wide establishing shot, 16:9 landscape format, 4K ultra-high resolution, photorealistic.`;

const APPLY_LOOKBOOK_PROMPT =
  `Dress the person from the first reference image in the exact outfit shown in the second reference image. ` +
  `Preserve the person's face, skin tone, hair, and body proportions exactly as in the first image. ` +
  `Replace all clothing with every item from the second reference image. ` +
  `Maintain the same pose, background, and lighting from the first image. ` +
  `Photorealistic, high quality, 4k.`;

const APPLY_ENV_PROMPT =
  `Place the person from the first image into the environment shown in the second image. ` +
  `Keep the person's appearance, clothing, and pose identical. ` +
  `Blend the lighting and shadows naturally so the person looks like they belong in that environment. ` +
  `No other people, no text, no watermarks. Photorealistic, 9:16 portrait format.`;

module.exports = {
  ROOT_DIR, UPLOADS_DIR, LOOKBOOKS_DIR, CHARACTERS_DIR, ENVIRONMENTS_DIR,
  ARCHIVE_DIR, SCENARIOS_DIR, DETAILS_DIR, LOGS_DIR, LOG_FILE,
  ARCHIVE_SUBDIRS, GALLERY_MAP, KIE_BASE,
  SKIN_PARAMS, NO_RETOUCH,
  EXTRACT_CLOTHING_PROMPT, EXTRACT_BG_PROMPT, APPLY_LOOKBOOK_PROMPT, APPLY_ENV_PROMPT,
};
