'use strict';

const path   = require('path');
const fs     = require('fs');
const os     = require('os');
const crypto = require('crypto');
const { KINDS } = require('./layout');

// ── Directories ──────────────────────────────────────────────────────────────
// Two roots. APP_DIR is the program - the code and public/ - and an update replaces it.
// ROOT_DIR is the library: every file the app keeps, and nothing an update may touch. They were
// one folder until the desktop build, which is why a stored web path such as /media/clips/x.mp4 is
// joined onto ROOT_DIR all over the code; that still holds, ROOT_DIR is just no longer where the
// code is. What goes where inside the library is lib/layout.js; lib/media.js turns an address into
// its file and back.
//
// UGC_DATA_DIR names the library. The desktop shell always sets it (desktop/main.js) - built, to
// the folder the exe sits in. Run with plain node and without it, the library is local-data/ in
// the checkout, so nothing is ever written into the code tree. Under Electron that fallback would
// put the library inside the program folder, which an update replaces, so there a missing
// UGC_DATA_DIR stops the start instead.
if (process.versions.electron && !process.env.UGC_DATA_DIR) {
  throw new Error('UGC_DATA_DIR is not set: under the desktop shell the library folder must be named, or the app would write into its own program folder');
}
const APP_DIR          = path.join(__dirname, '..');
const PUBLIC_DIR       = path.join(APP_DIR, 'public');
const ROOT_DIR         = path.resolve(process.env.UGC_DATA_DIR || path.join(APP_DIR, 'local-data'));

// Inside the library (lib/layout.js has the whole shape): data/ for the stores, media/ for
// everything made or brought in - one folder per kind - and cache/ for what is made again when
// it is missing. A file's address mirrors its folder, /media/clips/x.mp4 (lib/media.js).
const DATA_DIR         = path.join(ROOT_DIR, 'data');
const PROJECTS_DIR     = path.join(ROOT_DIR, 'projects');
const MEDIA_DIR        = path.join(ROOT_DIR, 'media');
const CACHE_DIR        = path.join(ROOT_DIR, 'cache');
const LOGS_DIR         = path.join(ROOT_DIR, 'logs');
const BACKUPS_DIR      = path.join(ROOT_DIR, 'backups');
const MEDIA            = Object.freeze(Object.fromEntries(KINDS.map((k) => [k, path.join(MEDIA_DIR, k)])));

// The kinds that were folders of their own before, under the names the code already uses.
// uploads/ is not among them: it held pictures, clips, voices and projects alike, and each
// writer now names the kind it writes (MEDIA.images, MEDIA.work, ...).
const CHARACTERS_DIR   = MEDIA.characters;
const OBRAZY_DIR       = MEDIA.looks;
const LOOKBOOKS_DIR    = MEDIA.lookbooks;
const ENVIRONMENTS_DIR = MEDIA.locations;
const FINALS_DIR       = MEDIA.renders;
const HOOKS_DIR        = MEDIA.hooks;

// Scratch - render intermediates, archives being unpacked, subtitle files, preview proxies - goes
// to the system's temp folder, not the library: all of it is rebuilt on demand, and writing it
// beside the media makes a slow drive slower on every render. One folder per library, so two
// libraries open at once never share scratch. Anything that leaves scratch for the library is
// copied, not renamed, because the two may sit on different drives.
const SCRATCH_DIR      = path.join(os.tmpdir(),
  'ugc-studio-' + crypto.createHash('sha1').update(ROOT_DIR.toLowerCase()).digest('hex').slice(0, 10));
const TEMP_DIR         = path.join(SCRATCH_DIR, 'temp_files');
const TEMP_PUBLIC_DIR  = path.join(SCRATCH_DIR, 'temp_public');
const OBRAZY_FILE      = path.join(DATA_DIR, 'obrazy.json');
const CHARACTERS_DB_FILE = path.join(DATA_DIR, 'characters.json');

// Derived, and made again when missing: /api/thumb's sizes (lib/thumbs.js), previews of the
// shipped mannequins, and the voice samples fetched as voices are browsed.
const THUMBS_CACHE_DIR   = path.join(CACHE_DIR, 'thumbs');
const POSES_CACHE_DIR    = path.join(CACHE_DIR, 'poses');
const VOICE_PREVIEWS_DIR = path.join(CACHE_DIR, 'voice-previews');

// Every folder a writer may assume is there.
for (const d of [DATA_DIR, PROJECTS_DIR, LOGS_DIR, ...Object.values(MEDIA),
                 CACHE_DIR, VOICE_PREVIEWS_DIR, TEMP_DIR, TEMP_PUBLIC_DIR]) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

// ── API ───────────────────────────────────────────────────────────────────────
const KIE_BASE = 'https://api.kie.ai';

// ── Persistent character (actor) reference sheet ─────────────────────────────
// ONE combined 4K sheet generated automatically on "Save char" (nano-banana-2).
// The active image is used ONLY as an identity reference — its clothing, pose,
// background and props are discarded and replaced with a plain covering coverall
// on white, so the sheet is a clean reusable "blank" of the actor.
// Layout: large portrait close-up + full-body turnaround on a single wide sheet.
// Consumed as the appearance reference for photoshoot/pose generation in
// Scenarios (identity + physique in one image).
const CHAR_SHEET_PROMPT =
  `Single combined character reference sheet of the SAME person from the reference image, ` +
  `everything on ONE wide sheet over a pure white seamless background, arranged side by side: ` +
  `on the LEFT a LARGE head-and-shoulders portrait close-up (front view, calm neutral expression, mouth closed) ` +
  `with clearly readable facial details — face shape, eyes, nose, lips, skin texture, hairline; ` +
  `on the RIGHT the SAME person standing full-body from three angles in a row — front view, side profile view and back view — ` +
  `standing naturally upright with arms relaxed at the sides, feet together, whole body visible head to toe ` +
  `so the height, build and body proportions are clearly readable. ` +
  // A covering coverall, NOT a flesh-toned skin-tight bodysuit. The old wording read as nudity to
  // the provider's classifier and sheets came back as "E005: the input or output was flagged as
  // sensitive" - a hard failure, on the one asset the whole page exists to produce. Ordinary
  // workwear that closes at the neck, wrists and ankles carries no such risk, and a fitted cut
  // keeps the build just as readable, which is the only reason the neutral wardrobe exists.
  `Ignore and discard the clothing, background, pose and props from the reference — instead the person wears a plain ` +
  `matte light-grey long-sleeved coverall that covers the whole body: closed round neckline, sleeves down to the ` +
  `wrists, legs down to the ankles, no patterns, logos or prints. Fitted rather than loose, so the height, build and ` +
  `body proportions stay clearly readable through it (neutral wardrobe). ` +
  `Remove any hat, cap, hood, headscarf, helmet or other headwear — the head must be completely bare with the natural hair fully visible. ` +
  `Faithfully preserve the exact face shape, facial features, skin tone, hair color and hairstyle from the reference. ` +
  // {BODY} is filled per reference by the framing agent (CV2_FRAMING_PROMPT). It used to read
  // "preserve the body proportions and height from the reference", which is a lie when the
  // reference is a head crop: there are no proportions in it, so the model invented an average
  // build and a very heavy or very thin character quietly became neither.
  `{BODY} ` +
  `Every figure on the sheet MUST be the same single person. ` +
  `Soft even studio lighting, no cast shadows on the background. ` +
  `Wide 16:9 format, photorealistic, sharp focus, high detail, no text, no labels, no arrows, no watermarks.`;

// ── Character v2: the appearance analyzer ────────────────────────────────────
// Sits in front of every reference generation on the Character v2 page: it reads the reference
// image together with whatever the user typed (in any language) and answers with the prompt
// material, so the generator never sees raw user text.
//
// The appearance-only rule is enforced HERE rather than hoped for downstream. It is not a
// stylistic preference: the working image feeds the 4K reference sheet, which deliberately
// discards clothing, background and pose and replaces them with a covering coverall on white. Anything outside appearance would be thrown away one step later, so asking for it is
// refused now, plainly, instead of being silently dropped.
//
// It also refuses what the frame cannot show. A bone leg on a head-and-shoulders crop has
// nowhere to appear; saying so beats generating something that ignores the request.
//
// `who` describes the person AFTER the change, in the same shape the page's own prompt uses, so
// it drops straight into the house template. `change` repeats the change as an instruction, for
// the path that edits a photo in place rather than building a portrait from scratch.
const CV2_APPEARANCE_PROMPT =
  `You prepare prompt material for an image generator from a reference photo of a person.\n\n` +
  `The user's request (may be empty, may be in any language):\n"""{USER_TEXT}"""\n\n` +
  `Answer with ONE JSON object and nothing else. Either:\n` +
  `{"ok":true,"who":"...","change":"..."}\n` +
  `or, if the request cannot be honoured:\n` +
  `{"ok":false,"reason":"one short sentence in English"}\n\n` +
  `"who": a compact English description of the person as they should look AFTER the requested ` +
  `change, in exactly this shape and order, omitting anything you cannot see:\n` +
  `"<age band> <gender>, <ethnicity>, <build> build, <skin tone> skin. Hair: <colour>, <length>, ` +
  `<style>. Eyes: <colour>, <shape>. <face shape> face, <eyebrows> eyebrows, <facial hair>, ` +
  `<makeup> makeup. Marks: <scars, tattoos, piercings, freckles>."\n` +
  `Describe only what a person looks like. Never mention clothing, background, pose, framing, ` +
  `camera, lighting or props, not even to say they stay the same.\n\n` +
  `"change": the requested change as a short English instruction ("bald", "heavier build", ` +
  `"replace the left leg with a bone prosthetic"). Empty string if the user asked for nothing.\n\n` +
  `Refuse with ok:false when the request:\n` +
  `- concerns clothing, shoes, hats, accessories, background, location, pose or props;\n` +
  `- concerns a body part that is NOT visible in this image (say which part, and that it is ` +
  `outside the frame);\n` +
  `- asks for a facial expression, a different person, or an age the face cannot support;\n` +
  `- is not about physical appearance at all.\n\n` +
  `Permanent physical traits only: hair, skin, eyes, face and head shape, facial hair, eyebrows, ` +
  `makeup, scars, tattoos, piercings, freckles, body build and limbs, including prosthetic or ` +
  `non-human ones. An empty request is not a refusal - answer ok:true with an empty change.`;

// ── Character v2: the framing agent, for the reference sheet ──────────────────
// Runs on the identity image just before a sheet is generated, and answers one question the
// sheet prompt cannot answer for itself: is the body actually in this picture?
//
// It matters because the sheet shows the whole body from three angles. Given a full-body source
// the right instruction is "preserve what you see"; given a head crop that instruction is
// meaningless, and the model fills the gap with an average build - so a very heavy or very thin
// character silently became neither. Told which case it is, the prompt can either preserve or
// construct, and the build it constructs is the one this agent read.
const CV2_FRAMING_PROMPT =
  `You are looking at a reference photo of a person that will be turned into a character sheet ` +
  `showing their whole body from three angles.\n\n` +
  `Answer with ONE JSON object and nothing else:\n` +
  `{"full":true,"visible":"...","figure":"..."}\n\n` +
  `"full": true ONLY if the entire body is visible, head to feet. A photo cut off at the waist, ` +
  `the chest or the shoulders is false.\n` +
  `"visible": what is actually in frame, in a few words - "head and shoulders only", "waist up", ` +
  `"whole body".\n` +
  `"figure": the person's build and height as a short English phrase, the way it should read on ` +
  `the sheet: "heavy, wide build, short", "very slim, long-limbed, tall", "athletic, broad ` +
  `shoulders, average height". If the body is not visible, give your best reading from the face, ` +
  `neck and shoulders.\n\n` +
  `Describe the body only. Never mention clothing, background, pose or props.`;

module.exports = {
  APP_DIR, PUBLIC_DIR, ROOT_DIR, DATA_DIR, PROJECTS_DIR, MEDIA_DIR, MEDIA, CACHE_DIR, LOGS_DIR, BACKUPS_DIR,
  THUMBS_CACHE_DIR, POSES_CACHE_DIR, TEMP_DIR, TEMP_PUBLIC_DIR,
  CHARACTERS_DIR, OBRAZY_DIR, LOOKBOOKS_DIR, ENVIRONMENTS_DIR, FINALS_DIR, HOOKS_DIR,
  OBRAZY_FILE, CHARACTERS_DB_FILE,
  KIE_BASE,
  CHAR_SHEET_PROMPT, CV2_APPEARANCE_PROMPT, CV2_FRAMING_PROMPT,
};
