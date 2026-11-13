'use strict';

// ════════════════════════════════════════════════════════════════════════════
// THE VIDEO MODELS - one record per model x aggregator.
//
// Seven models in ONE dropdown (every model its own line, its own parameters, its own
// price): Grok classic, Grok 1.5, Seedance 2.0 mini, Seedance 2.0, Seedance 2.5, Kling 2.6 and 3.0 motion
// control - each on kie.ai and on Replicate, 14 records. A record knows, from the aggregators' own schemas
// (the snapshots the request-form stand compares against are kept beside it):
//
//   modes        what it can be asked: t2v (words), i2v (a first frame), fl (first + last frame), refs
//                (reference pictures / clips / sounds), motion (a picture driven by a clip - Kling only)
//   limits       how many of each, which formats, megabytes, pixels, shapes, seconds
//   duration, resolutions, aspects, audio      the parameters this record offers
//   promptMax    characters (the shorter of the aggregator's cap and the model's)
//   token(kind, n)   how its prompt names the n-th picture / clip / sound - the agent writes neutral
//                {{image:1}} and render() turns it into this record's syntax
//   price(...)   what a send costs by the aggregator's own formula, from a dated table - an estimate
//                ("≈") until a real record says what was taken (creditsConsumed)
//   build(req)   the request body - the only place a field name is written
//
// Nothing here goes to the network: smoke reads the matrix with no key.
// ════════════════════════════════════════════════════════════════════════════

const KEYS = require('./agg-keys');
const FAKE = require('./fake-agg');

// Every rate below is read from kie's price page; real records agreed with them.
const PRICES_ASOF = '2026-10-09';
const STANDARD_MC_PROMPT = "No distortion, the character's movements are consistent with the video.";

const MODELS = [
  { id: 'grok', label: 'Grok classic', family: 'grok', speaks: true, wait: 45,
    brief: 'Grok classic: quick, cheap clips from words, one picture or up to 7 references on kie.ai - b-roll, inserts, simple motion. Makes its own sound.' },
  { id: 'grok15', label: 'Grok 1.5', family: 'grok', speaks: true, wait: 45,
    brief: 'Grok 1.5: newer Grok - steadier motion, better lips when someone speaks. From words, one picture or up to 7 references on kie.ai (on Replicate it needs one picture).' },
  { id: 'sd2mini', label: 'Seedance 2.0 mini', family: 'seedance', speaks: true, wait: 150,
    brief: 'Seedance 2.0 mini: the cheap Seedance for drafts - words, a first frame, first and last frames, or up to 9 references.' },
  { id: 'sd2', label: 'Seedance 2.0', family: 'seedance', speaks: true, wait: 210,
    brief: 'Seedance 2.0: words, a first frame, first and last frames, or references - up to 9 pictures, 3 clips and 3 sounds.' },
  { id: 'sd25', label: 'Seedance 2.5', family: 'seedance', speaks: true, wait: 270,
    brief: 'Seedance 2.5: the newest Seedance - clips up to 30 s, references up to 30 pictures, 10 clips, 10 sounds. The dearest.' },
  { id: 'kmc26', label: 'Kling 2.6 motion control', family: 'kmc', speaks: false, wait: 480,
    brief: "Kling 2.6 Motion Control: your character copies the moves of the person in the clip, set in your picture's scene. Attach 1 full-body picture + 1 clip (3-30 s)." },
  { id: 'kmc30', label: 'Kling 3.0 motion control', family: 'kmc', speaks: false, wait: 600,
    brief: 'Kling 3.0 Motion Control: same idea, but the face holds better through turns and when partly hidden. Attach 1 full-body picture + 1 clip (3-30 s).' },
];
const _model = (id) => MODELS.find(m => m.id === id) || null;

// ── Limits shared by families ───────────────────────────────────────────────
const IMG_GROK_KIE = { formats: ['jpg', 'png', 'webp'], mb: 10, minPx: 300, maxPx: 4096, ratio: [0.4, 2.5] };
const IMG_GROK15_KIE = { formats: ['jpg', 'png', 'webp'], mb: 20, minPx: 300, maxPx: 4096, ratio: [0.4, 2.5] };
const IMG_GROK_REPL = { formats: ['jpg', 'png', 'webp'], mb: 10, minPx: 300, maxPx: 4000, ratio: [0.4, 2.5] };
// Seedance (BytePlus' own rules, as kie states them; Replicate states none and gets the same).
const IMG_SD = { formats: ['jpg', 'png', 'webp'], mb: 30, minPx: 301, maxPx: 5999, ratio: [0.4, 2.5] };
// Kling motion control: strictly over 340 px (kie 3.0), JPEG or PNG only.
const IMG_KMC = { formats: ['jpg', 'png'], mb: 10, minPx: 341, maxPx: 3850, ratio: [0.4, 2.5] };
// Reference CLIPS and SOUNDS, as lib/video-prep.js makes them for each record. Seedance (BytePlus'
// rules): an mp4 of 409 600-927 408 pixels (9:16 -> 720x1280), 24-60 frames a second; a sound as mp3. Kling motion
// control: MP4 up to 100 MB, each side 341-3850, 2:5 to 5:2 - the long side kept at 1920 (its result is 720p/1080p).
const VID_SD = { mb: 50, area: [409600, 927408], ratio: [0.4, 2.5], fps: [24, 60] };
const AUD_SD = { mb: 15 };
const VID_KMC = { mb: 100, minPx: 341, maxPx: 3850, maxLong: 1920, ratio: [0.4, 2.5], fps: [24, 60] };

const SD_ASPECTS = ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'];

// ── Prices (dated data, not numbers scattered in code) ──────────────────────
// USD per second. Seedance on kie: a send WITH a reference clip is billed at the with-video rate on input +
// output seconds; on Replicate the video-in tier is billed on output seconds only.
const PRICE = {
  'grok@kie': { '480p': 0.012, '720p': 0.0225, '1080p': 0.04 },
  'grok@replicate': { '480p': 0.05, '720p': 0.05 },
  // kie lists 1.5 at the classic's rates - every other seller asks 1.6-2x more, and real records were
  // billed exactly so, 1080p included.
  'grok15@kie': { '480p': 0.012, '720p': 0.0225, '1080p': 0.04 },
  'grok15@replicate': { '480p': 0.08, '720p': 0.08 },
  'sd2mini@kie': { '480p': [0.019, 0.012], '720p': [0.041, 0.025] },
  'sd2mini@replicate': { '480p': [0.04, 0.05], '720p': [0.09, 0.11] },
  'sd2@kie': { '480p': [0.095, 0.057], '720p': [0.205, 0.125], '1080p': [0.51, 0.31] },
  'sd2@replicate': { '480p': [0.08, 0.1], '720p': [0.18, 0.22], '1080p': [0.45, 0.55] },
  'sd25@kie': { '480p': [0.14, 0.085], '720p': [0.315, 0.19], '1080p': [0.79, 0.475] },
  'sd25@replicate': { '480p': [0.1028, 0.4304], '720p': [0.2312, 0.9676] },
  'kmc26@kie': { '720p': 0.055, '1080p': 0.09 },
  'kmc26@replicate': { '720p': 0.07, '1080p': 0.12 },
  'kmc30@kie': { '720p': 0.1, '1080p': 0.135 },
  'kmc30@replicate': { '720p': 0.07, '1080p': 0.12 },
};
// A rate that is a limited-time discount, and when it ends: { 'model@agg': { until: ISO, words } }. After that the rate is
// not known until the price list is read again (by hand) - shown as unknown, never as the old discount, and the default
// aggregator stops counting on it. Empty: Seedance 2.0 mini's "discount" on kie is its
// standing price.
const PRICE_UNTIL = {};
// Billed by the WHOLE seconds that come back, rounded down - kie's Kling motion control: a 4.93 s video was
// billed 4 s, a 5.34 s one 5 s. The video is the clip's length or a little shorter, so the clip's whole
// seconds are the most it costs.
const BILL_WHOLE = { 'kmc26@kie': true, 'kmc30@kie': true };
const _expired = (key) => !!(PRICE_UNTIL[key] && Date.now() >= Date.parse(PRICE_UNTIL[key].until));
const _rates = (key) => (_expired(key) ? {} : (PRICE[key] || {}));

// ── How a prompt names references ───────────────────────────────────────────
const CAP = { image: 'Image', video: 'Video', audio: 'Audio' };
const ORDINAL = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh'];
const TOKEN = {
  // kie does not document Seedance's syntax; its own examples write @Image1 / @Video1 (real runs confirm it).
  seedanceKie: (kind, n) => '@' + CAP[kind] + n,
  seedanceRepl: (kind, n) => '[' + CAP[kind] + n + ']',
  // Grok 1.5 on kie: its page names no syntax for several pictures; a paid run named them in words - "the
  // woman from the first image ... the second image ... the third image" - and each was used. One picture is the clip's
  // start and stays "the picture".
  grokKie: (kind, n, mode) => (mode === 'refs' && kind === 'image' && ORDINAL[n - 1] ? 'the ' + ORDINAL[n - 1] + ' image' : null),
  // Grok classic on kie: its page's own syntax, "@image(n)" (a paid run: three pictures so named, each used).
  grokClassicKie: (kind, n, mode) => (mode === 'refs' && kind === 'image' ? '@image' + n : null),
  none: () => null,
};

// ── The records ─────────────────────────────────────────────────────────────
const _int = (v, d) => (Number.isFinite(+v) ? Math.round(+v) : d);
const _clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const _imgs = (req) => (req.media || []).filter(m => m.kind === 'image');
const _vids = (req) => (req.media || []).filter(m => m.kind === 'video');
const _auds = (req) => (req.media || []).filter(m => m.kind === 'audio');
const _role = (m) => String(m.role || '');
const _span = (m) => Math.max(0, (+m.out || 0) - (+m.in || 0));

// ONE REFERENCE CLIP DECIDES SEEDANCE'S LENGTH AND SHAPE. Seedance 2.5 takes a request
// that changes something in a clip ("replace the woman in @Video1") as EDITING it - kie has no field for the mode, the
// model reads it from the words - and an edit takes only `duration: -1` (kie: "it matches the input video's length"),
// `aspect_ratio: adaptive` and a clip of 4-30 s; anything else fails after the task is made (the journal: 12 s
// and 16:9 sent beside a 9.75 s clip). So with ONE clip every Seedance makes the clip's length in the clip's shape: 2.5 on
// kie by -1 (`clipAuto`), the others by the clip's seconds rounded to a whole one; the column's length and shape are not
// sent. With SEVERAL clips the column's length and shape go, and the prompt says what each clip is for (the writer's
// rules, lib/mv3-video-rules.js).
const ONE_CLIP_LEAST = 4;
/** One Seedance clip: { secs, duration } - its seconds (0 when not known) and the duration this record sends. Else null. */
function byClip(pair, req) {
  if (!pair || pair.family !== 'seedance') return null;
  const vi = _vids(req || {});
  if (vi.length !== 1) return null;
  const secs = _span(vi[0]);
  const p = (req || {}).params || {};
  const d = pair.duration;
  return { secs, duration: pair.clipAuto ? -1 : _clamp(secs > 0 ? Math.round(secs) : _int(p.duration, d.def), d.min, d.max) };
}
/** How long the clip that comes back is: a clip's -1 is the clip's own seconds. */
const _outOf = (one) => (one.duration === -1 ? one.secs : one.duration);
// Seedance 2.5 takes a request with several clips as editing one of them - the
// failure in words: an edit goes with that clip alone.
const EDIT_REFUSED = /duration must be -1/i;
function editWords(pair, error) {
  return pair && pair.family === 'seedance' && EDIT_REFUSED.test(String(error || ''))
    ? pair.label + ' took this as editing a clip - keep only that clip (the length becomes its own) or say what each clip is for' : '';
}

// Which mode a send is, from what is attached and what each thing is for.
function modeOf(pair, req) {
  if (pair.modes.includes('motion')) return 'motion';
  const im = _imgs(req), vi = _vids(req), au = _auds(req);
  if (!im.length && !vi.length && !au.length) return 't2v';
  const first = im.find(m => _role(m) === 'frame-first');
  const last = im.find(m => _role(m) === 'frame-last');
  if (first && last && pair.modes.includes('fl') && im.length === 2 && !vi.length && !au.length) return 'fl';
  if (first && pair.modes.includes('i2v') && im.length === 1 && !vi.length && !au.length) return 'i2v';
  // A single picture with no role: a reference where the model has references, a first frame where it has not - or
  // where one picture is always the start (Grok 1.5 on kie: references only from two).
  if (im.length === 1 && !vi.length && !au.length && (!pair.modes.includes('refs') || pair.oneIsFrame) && pair.modes.includes('i2v')) return 'i2v';
  return 'refs';
}

function _base(model, agg, extra) {
  const m = _model(model);
  return Object.assign({
    key: model + '@' + agg, model, agg, label: m.label, aggLabel: KEYS.LABEL[agg],
    brief: m.brief, family: m.family, speaks: m.speaks, wait: m.wait,
    limits: { image: IMG_SD, images: 0, videos: 0, audios: 0 },
    promptOptional: false,
    token: TOKEN.none,
  }, extra);
}

const PAIRS = {};
function _add(p) { PAIRS[p.key] = p; }

// THE SAFETY CHECK IS OFF wherever a model has a switch: kie's `nsfw_checker: false`
// ("no additional content filtering") - it takes away kie's own filter only; the model's moderation stays, and Replicate's
// Grok, Seedance and Kling have no switch at all.

// Grok classic on kie: words (6-30 s, its modes), one picture (the clip takes its shape) or up to 7 pictures as
// references - kie's own contradiction ("up to 7" in the API, "only one" on its page) settled by a paid run
// (three pictures named @image1 @image2 @image3, each used); its page: "Only one is supported when the resolution is
// 1080p", and the shape "only applies to multi-image generation mode".
_add(_base('grok', 'kie', {
  modelId: 'grok-imagine/text-to-video | grok-imagine/image-to-video', modes: ['t2v', 'i2v', 'refs'], oneIsFrame: true, token: TOKEN.grokClassicKie,
  limits: { image: IMG_GROK_KIE, images: 7, imagesAt: { '1080p': 1 }, videos: 0, audios: 0 },
  duration: { min: 6, max: 30, def: 6 }, resolutions: ['480p', '720p', '1080p'], resDef: '720p',
  aspects: ['9:16', '16:9', '1:1', '2:3', '3:2'], aspectWithImage: false, aspectWithImages: true,
  extra: { mode: ['normal', 'fun', 'spicy'] }, promptMax: 5000,
  build(req) {
    const p = req.params || {};
    const im = _imgs(req);
    const style = ['normal', 'fun', 'spicy'].includes(p.mode) ? p.mode : 'normal';
    const d = _clamp(_int(p.duration, 6), 6, 30);
    if (!im.length) {
      return { model: 'grok-imagine/text-to-video', input: { prompt: req.prompt, aspect_ratio: p.aspect || '9:16', mode: style, duration: d, resolution: p.resolution || '720p', nsfw_checker: false } };
    }
    // spicy is refused for an outside picture; the duration goes as a string on this endpoint.
    const input = { image_urls: im.map(m => m.url), prompt: req.prompt, mode: style === 'spicy' ? 'normal' : style, duration: String(d), resolution: p.resolution || '720p', nsfw_checker: false };
    if (im.length > 1) input.aspect_ratio = p.aspect || '9:16';
    return { model: 'grok-imagine/image-to-video', input };
  },
}));
_add(_base('grok', 'replicate', {
  modelId: 'xai/grok-imagine-video', modes: ['t2v', 'i2v'],
  limits: { image: IMG_GROK_REPL, images: 1, videos: 0, audios: 0 },
  duration: { min: 1, max: 15, def: 6 }, resolutions: ['480p', '720p'], resDef: '720p',
  aspects: ['9:16', '16:9', '1:1', '4:3', '3:4', '2:3', '3:2'], aspectWithImage: false, promptMax: 4096,
  build(req) {
    const p = req.params || {};
    const im = _imgs(req);
    const input = { prompt: req.prompt, duration: _clamp(_int(p.duration, 6), 1, 15), resolution: p.resolution === '480p' ? '480p' : '720p' };
    // An explicit shape STRETCHES a picture (xAI): with one, 'auto' keeps its own.
    if (im.length) { input.image = im[0].url; input.aspect_ratio = 'auto'; } else input.aspect_ratio = p.aspect || '9:16';
    return { model: 'xai/grok-imagine-video', input };
  },
}));
// Grok 1.5 on kie: words, one picture (the clip takes its shape) or up to 7 pictures as references (kie's
// page: "up to 7 file. Only one is supported when the resolution is 1080p"; a paid run sent three and each was used, another
// made 1080p). From two pictures the shape is a setting again ("invalid if it is a single image").
_add(_base('grok15', 'kie', {
  modelId: 'grok-imagine-video-1-5-preview', modes: ['t2v', 'i2v', 'refs'], oneIsFrame: true, token: TOKEN.grokKie,
  limits: { image: IMG_GROK15_KIE, images: 7, imagesAt: { '1080p': 1 }, videos: 0, audios: 0 },
  duration: { min: 1, max: 15, def: 8 }, resolutions: ['480p', '720p', '1080p'], resDef: '720p',
  aspects: ['9:16', '16:9', '1:1', '2:3', '3:2'], aspectWithImage: false, aspectWithImages: true, promptMax: 4096,
  build(req) {
    const p = req.params || {};
    const im = _imgs(req);
    const res = ['480p', '720p', '1080p'].includes(p.resolution) ? p.resolution : '720p';
    const input = { prompt: req.prompt, resolution: res, duration: _clamp(_int(p.duration, 8), 1, 15), nsfw_checker: false };
    if (im.length) input.image_urls = im.map(m => m.url);
    if (im.length !== 1) input.aspect_ratio = p.aspect || '9:16';
    return { model: 'grok-imagine-video-1-5-preview', input };
  },
}));
_add(_base('grok15', 'replicate', {
  modelId: 'xai/grok-imagine-video-1.5', modes: ['i2v'], needs: { images: 1 },
  limits: { image: IMG_GROK_REPL, images: 1, videos: 0, audios: 0 },
  duration: { min: 1, max: 15, def: 6 }, resolutions: ['480p', '720p'], resDef: '720p',
  aspects: [], aspectWithImage: false, promptMax: 4096,
  build(req) {
    const p = req.params || {};
    const im = _imgs(req);
    return { model: 'xai/grok-imagine-video-1.5', input: { prompt: req.prompt, image: im[0] && im[0].url, duration: _clamp(_int(p.duration, 6), 1, 15), aspect_ratio: 'auto', resolution: p.resolution === '480p' ? '480p' : '720p' } };
  },
}));

// Seedance: three mutually exclusive scenarios - frames, or references, or words alone.
// THE LENGTH SEEDANCE PICKS (a talking head by its voice sample):
// kie takes `duration: -1` - the model makes 4-15 s (2.5: up to 30) as the words need and bills the seconds it
// made. `duration.auto` says a record takes it; Replicate's does not, so a request with -1 skips that rung (check).
function _sdKie(model, id, o) {
  _add(_base(model, 'kie', Object.assign({
    modelId: id, modes: ['t2v', 'i2v', 'fl', 'refs'], token: TOKEN.seedanceKie,
    aspects: SD_ASPECTS, aspectWithImage: true, audio: { def: true },
    build(req) {
      const p = req.params || {};
      const mode = modeOf(this, req);
      const one = byClip(this, req);
      const input = {
        prompt: req.prompt, generate_audio: p.audio !== false, resolution: p.resolution || '720p',
        aspect_ratio: (one || mode === 'i2v' || mode === 'fl') ? 'adaptive' : (p.aspect || '9:16'),
        duration: one ? one.duration : _auto(this, p) ? -1 : _clamp(_int(p.duration, 5), this.duration.min, this.duration.max), nsfw_checker: false,
      };
      const im = _imgs(req);
      if (mode === 'i2v') input.first_frame_url = (im.find(m => _role(m) === 'frame-first') || im[0]).url;
      else if (mode === 'fl') { input.first_frame_url = im.find(m => _role(m) === 'frame-first').url; input.last_frame_url = im.find(m => _role(m) === 'frame-last').url; }
      else if (mode === 'refs') {
        if (im.length) input.reference_image_urls = im.map(m => m.url);
        if (_vids(req).length) input.reference_video_urls = _vids(req).map(m => m.url);
        if (_auds(req).length) input.reference_audio_urls = _auds(req).map(m => m.url);
      }
      return { model: id, input };
    },
  }, o, { duration: Object.assign({}, o.duration, { auto: true }) })));
}
function _sdRepl(model, id, o) {
  _add(_base(model, 'replicate', Object.assign({
    modelId: id, modes: ['t2v', 'i2v', 'fl', 'refs'], token: TOKEN.seedanceRepl,
    aspects: SD_ASPECTS, aspectWithImage: true, audio: { def: true },
    build(req) {
      const p = req.params || {};
      const mode = modeOf(this, req);
      const one = byClip(this, req);
      const input = {
        prompt: req.prompt, duration: one ? one.duration : _clamp(_int(p.duration, 5), this.duration.min, this.duration.max),
        resolution: p.resolution || '720p', generate_audio: p.audio !== false,
        aspect_ratio: (one || mode === 'i2v' || mode === 'fl') ? 'adaptive' : (p.aspect || '9:16'),
      };
      const im = _imgs(req);
      if (mode === 'i2v') input.image = (im.find(m => _role(m) === 'frame-first') || im[0]).url;
      else if (mode === 'fl') { input.image = im.find(m => _role(m) === 'frame-first').url; input.last_frame_image = im.find(m => _role(m) === 'frame-last').url; }
      else if (mode === 'refs') {
        if (im.length) input.reference_images = im.map(m => m.url);
        if (_vids(req).length) input.reference_videos = _vids(req).map(m => m.url);
        if (_auds(req).length) input.reference_audios = _auds(req).map(m => m.url);
      }
      return { model: id, input };
    },
  }, o)));
}
// A reference clip is 2-15 s (2.5: 2-30) and all of them together the same at most; the sounds likewise.
const SD_MINI = { limits: { image: IMG_SD, video: VID_SD, audio: AUD_SD, images: 9, videos: 3, audios: 3, total: 12, videoSecs: 15, clipSecs: [2, 15], audioSecs: 15 }, duration: { min: 4, max: 15, def: 5 } };
_sdKie('sd2mini', 'bytedance/seedance-2-mini', Object.assign({}, SD_MINI, { resolutions: ['480p', '720p'], resDef: '720p', promptMax: 20000 }));
_sdRepl('sd2mini', 'bytedance/seedance-2.0-mini', Object.assign({}, SD_MINI, { resolutions: ['480p', '720p'], resDef: '720p', promptMax: 4000 }));
_sdKie('sd2', 'bytedance/seedance-2', Object.assign({}, SD_MINI, { resolutions: ['480p', '720p', '1080p'], resDef: '720p', promptMax: 20000 }));
_sdRepl('sd2', 'bytedance/seedance-2.0', Object.assign({}, SD_MINI, { resolutions: ['480p', '720p', '1080p'], resDef: '720p', promptMax: 4000 }));
const SD25 = { limits: { image: IMG_SD, video: VID_SD, audio: AUD_SD, images: 30, videos: 10, audios: 10, total: 50, videoSecs: 30, clipSecs: [2, 30], audioSecs: 30 }, duration: { min: 4, max: 30, def: 5 } };
// kie's page for Seedance 2.5 says 20480 characters of prompt.
// 2.5 on kie edits a clip: with one clip its length is -1, the clip's own (byClip).
_sdKie('sd25', 'bytedance/seedance-2-5', Object.assign({}, SD25, { resolutions: ['480p', '720p', '1080p'], resDef: '720p', promptMax: 20480, clipAuto: true }));
_sdRepl('sd25', 'bytedance/seedance-2.5', Object.assign({}, SD25, { resolutions: ['480p', '720p'], resDef: '720p', promptMax: 4000 }));

// Kling motion control: the roles are the fields - one picture (the person AND the place), one clip (the moves).
// No duration (the clip's), no shape (the inputs'), no new sound (the clip's or none). Orientation and quality
// always sent: the aggregators' defaults differ and Replicate's would cut the clip to 10 s or bill pro.
function _kmc(model, agg, id) {
  _add(_base(model, agg, {
    modelId: id, modes: ['motion'], needs: { images: 1, videos: 1 }, promptOptional: true, standardPrompt: STANDARD_MC_PROMPT,
    limits: { image: IMG_KMC, video: VID_KMC, images: 1, videos: 1, audios: 0, videoSecs: 30, videoSecsImage: 10 },
    duration: { fromClip: true, min: 3, max: 30 }, resolutions: ['720p', '1080p'], resDef: '720p',
    aspects: [], orientation: ['video', 'image'], keepSound: agg === 'replicate', promptMax: 2500,
    build(req) {
      const p = req.params || {};
      const orientation = p.orientation === 'image' ? 'image' : 'video';
      const hi = p.resolution === '1080p';
      const img = _imgs(req)[0], vid = _vids(req)[0];
      const prompt = String(req.prompt || '').trim();
      if (agg === 'kie') {
        const input = { input_urls: [img && img.url], video_urls: [vid && vid.url], character_orientation: orientation, mode: hi ? '1080p' : '720p' };
        if (prompt) input.prompt = prompt;
        // kie documents whose background it keeps; nobody else has the field. The picture's, sent explicitly: the clip's
        // ('input_video') does not work - a paid run with a picture on white and a clip before a black
        // curtain came back on white, as 2.6 and every report do. The video is in the picture's place on every record.
        if (model === 'kmc30') input.background_source = 'input_image';
        return { model: id, input };
      }
      return { model: id, input: { prompt, image: img && img.url, video: vid && vid.url, character_orientation: orientation, mode: hi ? 'pro' : 'std', keep_original_sound: p.keepSound !== false } };
    },
  }));
}
_kmc('kmc26', 'kie', 'kling-2.6/motion-control');
_kmc('kmc26', 'replicate', 'kwaivgi/kling-v2.6-motion-control');
_kmc('kmc30', 'kie', 'kling-3.0/motion-control');
_kmc('kmc30', 'replicate', 'kwaivgi/kling-v3-motion-control');

/** Is this a request for the length the model picks (-1), on a record that takes it? */
const _auto = (pair, p) => !!(pair.duration && pair.duration.auto) && +((p || {}).duration) === -1;

// ── Price ───────────────────────────────────────────────────────────────────
/**
 * What one clip costs by the aggregator's formula: { usd, perSec, secs, approx, note } - usd null when the
 * seconds are not known yet (motion control before its clip is attached).
 */
function price(pair, params, req) {
  const p = params || {};
  // A resolution this record does not make has no price here - check() refuses it before the money.
  if (p.resolution && !pair.resolutions.includes(p.resolution)) return { usd: null, perSec: null, secs: 0, approx: true, note: pair.label + ' on ' + pair.aggLabel + ' does not make ' + p.resolution };
  if (_expired(pair.key)) return { usd: null, perSec: null, secs: 0, approx: true, note: PRICE_UNTIL[pair.key].words };
  const res = p.resolution || pair.resDef;
  const row = PRICE[pair.key] || {};
  const rate = row[res];
  const vidIn = _vids(req || {}).reduce((s, m) => s + Math.max(0, (+m.out || 0) - (+m.in || 0)), 0);
  const hasVid = _vids(req || {}).length > 0;
  let perSec = Array.isArray(rate) ? rate[hasVid ? 1 : 0] : rate;
  if (perSec == null) return { usd: null, perSec: null, secs: 0, approx: true, note: 'no published price for ' + res };
  if (pair.duration.fromClip) {
    const clip = vidIn || 0;
    const cap = (p.orientation === 'image') ? pair.limits.videoSecsImage : pair.limits.videoSecs;
    const whole = !!BILL_WHOLE[pair.key];
    const secs = clip ? (whole ? Math.max(1, Math.floor(Math.min(clip, cap) + 0.001)) : Math.min(clip, cap)) : 0;
    return { usd: secs ? +(perSec * secs).toFixed(4) : null, perSec, secs, approx: true, whole,
      note: !secs ? 'per second of your clip'
        : whole ? 'per whole second of your clip - the most it costs: billed by the whole seconds that come back, rounded down'
          : 'per second of your clip - the most it costs: billed by the seconds that come back' };
  }
  // One Seedance clip: the video is as long as the clip (2.5 on kie: its -1 makes the clip's seconds).
  const one = byClip(pair, req);
  if (one && one.secs > 0) {
    const out1 = _outOf(one);
    const withIn1 = pair.agg === 'kie';
    return { usd: +(perSec * (withIn1 ? out1 + vidIn : out1)).toFixed(4), perSec, secs: withIn1 ? out1 + vidIn : out1, approx: true, byClip: true,
      note: 'the video is as long as the clip' + (withIn1 ? ' - kie.ai bills the clip\'s seconds too' : '') };
  }
  // The length the model picks: billed by the seconds it made - the longest it makes is the most it costs.
  if (_auto(pair, p)) {
    return { usd: +(perSec * pair.duration.max).toFixed(4), perSec, secs: pair.duration.max, approx: true, auto: true,
      note: 'the length is the model\'s - the most it costs: billed by the seconds it makes' };
  }
  const out = _clamp(_int(p.duration, pair.duration.def), pair.duration.min, pair.duration.max);
  // kie bills Seedance with a reference clip on the clip's seconds too - at most: a run of 5 s + 5 s was billed 9 s.
  const withIn = pair.agg === 'kie' && pair.family === 'seedance' && hasVid;
  const secs = withIn ? out + vidIn : out;
  return { usd: +(perSec * secs).toFixed(4), perSec, secs, approx: pair.agg === 'kie',
    note: withIn ? 'the most it costs: kie.ai has billed a second less' : '' };
}

// ── Checks before the money ─────────────────────────────────────────────────
/** Throws in words when this record cannot take this request; a rung of the ladder that cannot is skipped. */
function check(pair, req) {
  const r = req || {};
  const im = _imgs(r), vi = _vids(r), au = _auds(r);
  const L = pair.limits;
  if (im.length > L.images) throw new Error(pair.label + ' on ' + pair.aggLabel + ' takes ' + (L.images ? 'up to ' + L.images : 'no') + ' picture' + (L.images === 1 ? '' : 's'));
  // Fewer pictures at some resolutions - Grok 1.5 on kie takes one at 1080p.
  const atRes = L.imagesAt && (r.params || {}).resolution ? L.imagesAt[r.params.resolution] : null;
  if (atRes != null && im.length > atRes) throw new Error(pair.label + ' on ' + pair.aggLabel + ' takes ' + (atRes ? atRes === 1 ? 'one picture' : 'up to ' + atRes + ' pictures' : 'no pictures') + ' at ' + r.params.resolution);
  if (vi.length > L.videos) throw new Error(pair.label + ' on ' + pair.aggLabel + ' takes ' + (L.videos ? 'up to ' + L.videos : 'no') + ' clip' + (L.videos === 1 ? '' : 's'));
  if (au.length > L.audios) throw new Error(pair.label + ' on ' + pair.aggLabel + ' takes ' + (L.audios ? 'up to ' + L.audios : 'no') + ' sound' + (L.audios === 1 ? '' : 's'));
  if (L.total && im.length + vi.length + au.length > L.total) throw new Error(pair.label + ' takes ' + L.total + ' files at most');
  const need = pair.needs || {};
  if (need.images && im.length < need.images) throw new Error(pair.label + ' on ' + pair.aggLabel + ' needs a picture');
  if (need.videos && vi.length < need.videos) throw new Error(pair.label + ' needs a clip of the moves (3-30 s)');
  if (au.length && !im.length && !vi.length) throw new Error(pair.label + ' takes a sound only beside a picture or a clip');
  const span = (m) => Math.max(0, (+m.out || 0) - (+m.in || 0));
  if (pair.family === 'seedance' && L.videoSecs && vi.length) {
    const total = vi.reduce((s, m) => s + span(m), 0);
    if (total > L.videoSecs + 0.05) throw new Error(pair.label + ' takes ' + L.videoSecs + ' s of reference clips in all');
    const [lo, hi] = L.clipSecs || [0, Infinity];
    if (vi.some(m => span(m) && (span(m) < lo - 0.05 || span(m) > hi + 0.05))) throw new Error(pair.label + ' takes reference clips of ' + lo + '-' + hi + ' s each');
  }
  // One clip is the video's length - Seedance makes 4 s at least, and 2.5's edit takes
  // a clip of 4 s or more.
  const one = byClip(pair, r);
  if (one && one.secs > 0 && one.secs < ONE_CLIP_LEAST - 0.05) throw new Error(pair.label + ' makes the video as long as its clip - choose a part of at least ' + ONE_CLIP_LEAST + ' s');
  if (pair.family === 'seedance' && L.audioSecs && au.length) {
    if (au.reduce((s, m) => s + span(m), 0) > L.audioSecs + 0.05) throw new Error(pair.label + ' takes ' + L.audioSecs + ' s of sound in all');
  }
  if (pair.duration.fromClip && vi.length && span(vi[0])) {
    const secs = span(vi[0]);
    const p0 = r.params || {};
    const cap = p0.orientation === 'image' ? L.videoSecsImage : L.videoSecs;
    if (secs < pair.duration.min - 0.05) throw new Error(pair.label + ' needs a clip of at least ' + pair.duration.min + ' s');
    if (cap && secs > cap + 0.05) throw new Error(pair.label + ' takes ' + cap + ' s of clip at most' + (p0.orientation === 'image' ? ' when it follows the picture' : ''));
  }
  // The parameters as THIS record takes them: a fallback rung is never sent what it does not make (it is skipped).
  const p = r.params || {};
  if (p.resolution && !pair.resolutions.includes(p.resolution)) throw new Error(pair.label + ' on ' + pair.aggLabel + ' does not make ' + p.resolution);
  // With one Seedance clip the column's length is not sent (byClip) - nothing of it to refuse.
  if (!pair.duration.fromClip && !one && p.duration != null && p.duration !== '' && !_auto(pair, p)) {
    const d = +p.duration;
    if (d === -1) throw new Error(pair.label + ' on ' + pair.aggLabel + ' does not pick its own length');
    if (!(d >= pair.duration.min && d <= pair.duration.max)) throw new Error(pair.label + ' on ' + pair.aggLabel + ' makes ' + pair.duration.min + '-' + pair.duration.max + ' s');
  }
  const mode = modeOf(pair, r);
  const sendsShape = pair.aspects.length && !(im.length && !pair.aspectWithImage && !(pair.aspectWithImages && im.length > 1)) && mode !== 'i2v' && mode !== 'fl' && !one;
  if (sendsShape && p.aspect && !pair.aspects.includes(p.aspect)) throw new Error(pair.label + ' on ' + pair.aggLabel + ' does not make ' + p.aspect);
  const words = String(r.prompt || '');
  if (!words.trim() && !pair.promptOptional) throw new Error('say what to make');
  if (words.trim() && words.trim().length < 3) throw new Error('say a little more about what to make');
  if (pair.promptMax && words.length > pair.promptMax) throw new Error(pair.label + ' on ' + pair.aggLabel + ' takes ' + pair.promptMax + ' characters of prompt - this one is ' + words.length);
  return true;
}

// ── Neutral references -> this record's syntax ──────────────────────────────
/**
 * {{image:1}} {{video:2}} {{audio:1}} in the agent's prompt become this record's own names - or plain words.
 * With `req` (what is attached): a first frame, or first and last, on Replicate - and Seedance's on kie (its
 * @Image1 points at nothing) - is no REFERENCE: its token points into the reference pictures, which such a request
 * does not send - so the frames are called what they are, and a frame named twice once its token became words ("the
 * first frame ({{image:1}})") is named once.
 */
function render(pair, prompt, req) {
  const mode = req ? modeOf(pair, req) : 'refs';
  const imgs = req ? _imgs(req) : [];
  const framesOnly = (pair.agg === 'replicate' || pair.family === 'seedance') && (mode === 'i2v' || mode === 'fl');
  const out = String(prompt || '').replace(/\{\{\s*(image|video|audio)\s*:\s*(\d+)\s*\}\}/gi, (_, kind, n) => {
    if (framesOnly && kind.toLowerCase() === 'image') {
      const role = imgs[+n - 1] ? _role(imgs[+n - 1]) : '';
      return role === 'frame-last' ? 'the last frame' : role === 'frame-first' || mode === 'i2v' ? 'the first frame' : 'the picture';
    }
    const t = pair.token(kind.toLowerCase(), +n, mode);
    if (t) return t;
    return kind.toLowerCase() === 'image' ? 'the picture' : kind.toLowerCase() === 'video' ? 'the clip' : 'the sound';
  });
  return (framesOnly ? _onceFrames(out) : out).replace(/[ \t]{2,}/g, ' ').trim();
}
// "the first frame (the first frame)", "the first frame - the first frame -", "the first frame, the first frame",
// "first frame the first frame" -> said once (again while one is left: three in a row).
function _onceFrames(s) {
  let out = String(s);
  for (let i = 0; i < 4; i++) {
    const next = _onceFramesStep(out);
    if (next === out) break;
    out = next;
  }
  return out;
}
function _onceFramesStep(s) {
  return s
    .replace(/\b(the (?:first|last) frame)\s*[(\[]\s*\1\s*[)\]]/gi, '$1')
    .replace(/\b(the (?:first|last) frame)\s*[-\u2013\u2014]\s*\1\s*[-\u2013\u2014]\s*/gi, '$1 ')
    .replace(/\b(the (?:first|last) frame)\s*[,:;\-\u2013\u2014]?\s+\1\b/gi, '$1')
    .replace(/\b((?:first|last) frame)\s+the \1\b/gi, '$1');
}

// ── Choosing ────────────────────────────────────────────────────────────────
const pair = (model, agg) => PAIRS[model + '@' + agg] || null;
const label = (model) => (_model(model) || { label: model }).label;
// A key is what it takes. The health check's "down" only paints the chip: one slow probe would otherwise
// send every clip of the next half hour to the dearer aggregator - and a key that really is refused costs nothing
// to try (the create is refused, the ladder goes on).
const usable = (agg) => FAKE.on() || KEYS.keyed(agg);

// Seedance goes to kie.ai when nobody chose, even where Replicate is cheaper: Replicate
// refused our AI faces on Seedance 2.5 twice ("flagged as sensitive (E005)"), kie let them through every time.
const PREFER = { seedance: 'kie' };

/** The aggregator a model goes to when nobody chose: the family's preferred one, else the cheapest, for THIS send, of
 *  those with a key. */
function defaultAgg(model, params, req) {
  const can = KEYS.AGGS.map(a => pair(model, a)).filter(p => p && usable(p.agg));
  if (!can.length) return '';
  const cost = (p) => {
    // A real send (`req`): a record that cannot take it is no choice. The matrix (no send yet) ranks by the table.
    if (req) { try { check(p, Object.assign({ prompt: 'xxx' }, req, { params: params || {} })); } catch (e) { return Infinity; } }
    const x = price(p, params || {}, req || {});
    return x.usd != null ? x.usd : x.perSec == null ? Infinity : x.perSec * 10;
  };
  const fav = can.find(p => p.agg === PREFER[p.family]);
  if (fav && cost(fav) < Infinity) return fav.agg;
  can.sort((a, b) => cost(a) - cost(b));
  return can[0].agg;
}

/** The rungs of a send: the chosen aggregator first, then the others that carry the model and can be asked. */
function ladder(model, agg) {
  const first = pair(model, agg);
  const out = [];
  if (first && usable(first.agg)) out.push(first);
  for (const a of KEYS.AGGS) {
    const p = pair(model, a);
    if (p && a !== agg && usable(a)) out.push(p);
  }
  return out;
}

function noRoute(model) {
  const m = _model(model);
  if (!m) return 'no such model: ' + model;
  return 'nothing can make ' + m.label + ' now - ' + KEYS.AGGS.map(a => KEYS.why(a)).filter(Boolean).join('; ');
}

/** For the page: every model with its records, parameters, prices and why one cannot be used. No network. */
function matrix() {
  return {
    pricesAsOf: PRICES_ASOF, fake: FAKE.on(), r2: KEYS.r2() || FAKE.on(), aggregators: KEYS.state(),
    standardPrompt: STANDARD_MC_PROMPT,
    models: MODELS.map(m => {
      const recs = KEYS.AGGS.map(a => pair(m.id, a)).filter(Boolean).map(p => ({
        agg: p.agg, aggLabel: p.aggLabel, usable: usable(p.agg), why: usable(p.agg) ? '' : KEYS.why(p.agg),
        modelId: p.modelId, modes: p.modes, needs: p.needs || null,
        limits: { images: p.limits.images, imagesAt: p.limits.imagesAt || null, videos: p.limits.videos, audios: p.limits.audios, total: p.limits.total || 0,
                  videoSecs: p.limits.videoSecs || 0, image: p.limits.image,
                  // The page's trim window and checks: one clip's seconds, all the sounds', and Kling's clip
                  // when the character keeps the picture's orientation.
                  clipSecs: p.limits.clipSecs || null, audioSecs: p.limits.audioSecs || 0, videoSecsImage: p.limits.videoSecsImage || 0 },
        duration: p.duration, resolutions: p.resolutions, resDef: p.resDef, aspects: p.aspects, aspectWithImages: !!p.aspectWithImages,
        billWhole: !!BILL_WHOLE[p.key],
        // One clip decides Seedance's length and shape: its least, and whether it is sent as -1 (the clip's
        // own seconds) or rounded to a whole second.
        oneClip: p.family === 'seedance' ? { least: ONE_CLIP_LEAST, auto: !!p.clipAuto } : null,
        audio: p.audio || null, orientation: p.orientation || null, keepSound: !!p.keepSound, extra: p.extra || null,
        promptMax: p.promptMax, promptOptional: p.promptOptional,
        rates: _rates(p.key), priceNote: _expired(p.key) ? PRICE_UNTIL[p.key].words : '',
        tenSeconds: p.duration.fromClip ? price(p, { resolution: p.resDef }, { media: [{ kind: 'video', in: 0, out: 10 }] }) : price(p, { resolution: p.resDef, duration: 10 }, {}),
      }));
      const def = defaultAgg(m.id, {});
      return { id: m.id, label: m.label, brief: m.brief, family: m.family, speaks: m.speaks, wait: m.wait,
               defaultAgg: def, usable: !!def, why: def ? '' : noRoute(m.id), records: recs };
    }),
  };
}

module.exports = { MODELS, PAIRS, PRICES_ASOF, STANDARD_MC_PROMPT, ONE_CLIP_LEAST, pair, label, modeOf, price, check, render,
                   byClip, editWords, defaultAgg, ladder, noRoute, matrix, usable };
