'use strict';

// ════════════════════════════════════════════════════════════════════════════
// THE VIDEO MODELS (phase V2, docs/local-app/PLAN.md "V-B") - one record per model x aggregator.
//
// Seven models in ONE dropdown (the owner, 2026-10-05: every model its own line, its own parameters, its own
// price): Grok classic, Grok 1.5, Seedance 2.0 mini, Seedance 2.0, Seedance 2.5, Kling 2.6 and 3.0 motion
// control - each on kie.ai and on Replicate, 14 records. A record knows, from the aggregators' own schemas
// (checked 2026-10-05; the snapshots the request-form stand compares against are kept beside it):
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

const PRICES_ASOF = '2026-10-05';
const STANDARD_MC_PROMPT = "No distortion, the character's movements are consistent with the video.";

const MODELS = [
  { id: 'grok', label: 'Grok classic', family: 'grok', langs: ['en'], speaks: true, wait: 45,
    brief: 'Grok classic: quick, cheap clips from words or one picture - b-roll, inserts, simple motion. Makes its own sound.' },
  { id: 'grok15', label: 'Grok 1.5', family: 'grok', langs: ['en'], speaks: true, wait: 45,
    brief: 'Grok 1.5: newer Grok - steadier motion, better lips when someone speaks. From one picture (on Replicate it needs one).' },
  { id: 'sd2mini', label: 'Seedance 2.0 mini', family: 'seedance', langs: ['en', 'zh'], speaks: true, wait: 150,
    brief: 'Seedance 2.0 mini: the cheap Seedance for drafts - words, a first frame, first and last frames, or up to 9 references.' },
  { id: 'sd2', label: 'Seedance 2.0', family: 'seedance', langs: ['en', 'zh'], speaks: true, wait: 210,
    brief: 'Seedance 2.0: words, a first frame, first and last frames, or references - up to 9 pictures, 3 clips and 3 sounds.' },
  { id: 'sd25', label: 'Seedance 2.5', family: 'seedance', langs: ['en', 'zh'], speaks: true, wait: 270,
    brief: 'Seedance 2.5: the newest Seedance - clips up to 30 s, references up to 30 pictures, 10 clips, 10 sounds. The dearest.' },
  { id: 'kmc26', label: 'Kling 2.6 motion control', family: 'kmc', langs: ['en'], speaks: false, wait: 480,
    brief: "Kling 2.6 Motion Control: your character copies the moves of the person in the clip, set in your picture's scene. Attach 1 full-body picture + 1 clip (3-30 s)." },
  { id: 'kmc30', label: 'Kling 3.0 motion control', family: 'kmc', langs: ['en'], speaks: false, wait: 600,
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
// (phase V7, PLAN V-H) Reference CLIPS and SOUNDS, as lib/video-prep.js makes them for each record. Seedance (BytePlus'
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
  // kie lists 1.5 at the classic's rates - every other seller asks 1.6-2x more; shown as an estimate.
  'grok15@kie': { '480p': 0.012, '720p': 0.0225 },
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
// A rate that is a limited-time discount, and when it ends (kie's own page: "until October 7, 06:00 (UTC)"). After
// that the rate is not known until the price list is read again (by hand, V2) - shown as unknown, never as the old
// discount, and the default aggregator stops counting on it.
const PRICE_UNTIL = {
  'sd2mini@kie': { until: '2026-10-07T06:00:00Z', words: "kie.ai's discount on Seedance 2.0 mini ended on 7 Oct - its new price is not known yet" },
};
const _expired = (key) => !!(PRICE_UNTIL[key] && Date.now() >= Date.parse(PRICE_UNTIL[key].until));
const _rates = (key) => (_expired(key) ? {} : (PRICE[key] || {}));

// ── How a prompt names references ───────────────────────────────────────────
const CAP = { image: 'Image', video: 'Video', audio: 'Audio' };
const TOKEN = {
  // kie does not document Seedance's syntax; its own examples write @Image1 / @Video1 (V10 confirms).
  seedanceKie: (kind, n) => '@' + CAP[kind] + n,
  seedanceRepl: (kind, n) => '[' + CAP[kind] + n + ']',
  none: () => null,
};

// ── The records ─────────────────────────────────────────────────────────────
const _int = (v, d) => (Number.isFinite(+v) ? Math.round(+v) : d);
const _clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const _imgs = (req) => (req.media || []).filter(m => m.kind === 'image');
const _vids = (req) => (req.media || []).filter(m => m.kind === 'video');
const _auds = (req) => (req.media || []).filter(m => m.kind === 'audio');
const _role = (m) => String(m.role || '');

// Which mode a send is, from what is attached and what each thing is for.
function modeOf(pair, req) {
  if (pair.modes.includes('motion')) return 'motion';
  const im = _imgs(req), vi = _vids(req), au = _auds(req);
  if (!im.length && !vi.length && !au.length) return 't2v';
  const first = im.find(m => _role(m) === 'frame-first');
  const last = im.find(m => _role(m) === 'frame-last');
  if (first && last && pair.modes.includes('fl') && im.length === 2 && !vi.length && !au.length) return 'fl';
  if (first && pair.modes.includes('i2v') && im.length === 1 && !vi.length && !au.length) return 'i2v';
  // A single picture with no role: a reference where the model has references, a first frame where it has not.
  if (im.length === 1 && !vi.length && !au.length && !pair.modes.includes('refs') && pair.modes.includes('i2v')) return 'i2v';
  return 'refs';
}

function _base(model, agg, extra) {
  const m = _model(model);
  return Object.assign({
    key: model + '@' + agg, model, agg, label: m.label, aggLabel: KEYS.LABEL[agg],
    brief: m.brief, family: m.family, langs: m.langs, speaks: m.speaks, wait: m.wait,
    limits: { image: IMG_SD, images: 0, videos: 0, audios: 0 },
    promptOptional: false,
    token: TOKEN.none,
  }, extra);
}

const PAIRS = {};
function _add(p) { PAIRS[p.key] = p; }

// Grok classic on kie: words (6-30 s, its modes), or ONE picture until a paid run settles kie's own
// contradiction about seven. With one picture the clip takes the picture's shape.
_add(_base('grok', 'kie', {
  modelId: 'grok-imagine/text-to-video | grok-imagine/image-to-video', modes: ['t2v', 'i2v'],
  limits: { image: IMG_GROK_KIE, images: 1, videos: 0, audios: 0 },
  duration: { min: 6, max: 30, def: 6 }, resolutions: ['480p', '720p', '1080p'], resDef: '720p',
  aspects: ['9:16', '16:9', '1:1', '2:3', '3:2'], aspectWithImage: false,
  extra: { mode: ['normal', 'fun', 'spicy'] }, promptMax: 5000,
  build(req) {
    const p = req.params || {};
    const im = _imgs(req);
    const style = ['normal', 'fun', 'spicy'].includes(p.mode) ? p.mode : 'normal';
    const d = _clamp(_int(p.duration, 6), 6, 30);
    if (!im.length) {
      return { model: 'grok-imagine/text-to-video', input: { prompt: req.prompt, aspect_ratio: p.aspect || '9:16', mode: style, duration: d, resolution: p.resolution || '720p', nsfw_checker: true } };
    }
    // spicy is refused for an outside picture; the duration goes as a string on this endpoint.
    return { model: 'grok-imagine/image-to-video', input: { image_urls: [im[0].url], prompt: req.prompt, mode: style === 'spicy' ? 'normal' : style, duration: String(d), resolution: p.resolution || '720p', nsfw_checker: true } };
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
_add(_base('grok15', 'kie', {
  modelId: 'grok-imagine-video-1-5-preview', modes: ['t2v', 'i2v'],
  limits: { image: IMG_GROK15_KIE, images: 1, videos: 0, audios: 0 },
  duration: { min: 1, max: 15, def: 8 }, resolutions: ['480p', '720p'], resDef: '720p',
  aspects: ['9:16', '16:9', '1:1', '2:3', '3:2'], aspectWithImage: false, promptMax: 4096,
  build(req) {
    const p = req.params || {};
    const im = _imgs(req);
    const input = { prompt: req.prompt, resolution: p.resolution === '480p' ? '480p' : '720p', duration: _clamp(_int(p.duration, 8), 1, 15), nsfw_checker: true };
    if (im.length) input.image_urls = [im[0].url]; else input.aspect_ratio = p.aspect || '9:16';
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
function _sdKie(model, id, o) {
  _add(_base(model, 'kie', Object.assign({
    modelId: id, modes: ['t2v', 'i2v', 'fl', 'refs'], token: TOKEN.seedanceKie,
    aspects: SD_ASPECTS, aspectWithImage: true, audio: { def: true },
    build(req) {
      const p = req.params || {};
      const mode = modeOf(this, req);
      const input = {
        prompt: req.prompt, generate_audio: p.audio !== false, resolution: p.resolution || '720p',
        aspect_ratio: (mode === 'i2v' || mode === 'fl') ? 'adaptive' : (p.aspect || '9:16'),
        duration: _clamp(_int(p.duration, 5), this.duration.min, this.duration.max), nsfw_checker: true,
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
  }, o)));
}
function _sdRepl(model, id, o) {
  _add(_base(model, 'replicate', Object.assign({
    modelId: id, modes: ['t2v', 'i2v', 'fl', 'refs'], token: TOKEN.seedanceRepl,
    aspects: SD_ASPECTS, aspectWithImage: true, audio: { def: true },
    build(req) {
      const p = req.params || {};
      const mode = modeOf(this, req);
      const input = {
        prompt: req.prompt, duration: _clamp(_int(p.duration, 5), this.duration.min, this.duration.max),
        resolution: p.resolution || '720p', generate_audio: p.audio !== false,
        aspect_ratio: (mode === 'i2v' || mode === 'fl') ? 'adaptive' : (p.aspect || '9:16'),
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
_sdKie('sd25', 'bytedance/seedance-2-5', Object.assign({}, SD25, { resolutions: ['480p', '720p', '1080p'], resDef: '720p', promptMax: 30000 }));
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
        // kie documents whose background it keeps; nobody else has the field, and the evidence says the picture's
        // is what comes back - sent explicitly until a paid run proves 'input_video' works (PLAN V-B).
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
    const secs = clip ? Math.min(clip, cap) : 0;
    return { usd: secs ? +(perSec * secs).toFixed(4) : null, perSec, secs, approx: true,
      note: secs ? 'per second of your clip - the most it costs: billed by the seconds that come back' : 'per second of your clip' };
  }
  const out = _clamp(_int(p.duration, pair.duration.def), pair.duration.min, pair.duration.max);
  // kie bills Seedance with a reference clip on the clip's seconds too.
  const secs = (pair.agg === 'kie' && pair.family === 'seedance' && hasVid) ? out + vidIn : out;
  const approx = pair.key === 'grok15@kie' || pair.agg === 'kie';
  return { usd: +(perSec * secs).toFixed(4), perSec, secs, approx,
    note: pair.key === 'grok15@kie' ? "kie's listed rate for 1.5 looks like a mistake - the first real record will show" : '' };
}

// ── Checks before the money ─────────────────────────────────────────────────
/** Throws in words when this record cannot take this request; a rung of the ladder that cannot is skipped. */
function check(pair, req) {
  const r = req || {};
  const im = _imgs(r), vi = _vids(r), au = _auds(r);
  const L = pair.limits;
  if (im.length > L.images) throw new Error(pair.label + ' on ' + pair.aggLabel + ' takes ' + (L.images ? 'up to ' + L.images : 'no') + ' picture' + (L.images === 1 ? '' : 's'));
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
  if (!pair.duration.fromClip && p.duration != null && p.duration !== '') {
    const d = +p.duration;
    if (!(d >= pair.duration.min && d <= pair.duration.max)) throw new Error(pair.label + ' on ' + pair.aggLabel + ' makes ' + pair.duration.min + '-' + pair.duration.max + ' s');
  }
  const mode = modeOf(pair, r);
  const sendsShape = pair.aspects.length && !(im.length && !pair.aspectWithImage) && mode !== 'i2v' && mode !== 'fl';
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
 * With `req` (what is attached): a first frame, or first and last, on Replicate is no REFERENCE - its [Image1]
 * points into reference_images, which such a request does not send - so the frames are called what they are.
 */
function render(pair, prompt, req) {
  const mode = req ? modeOf(pair, req) : 'refs';
  const imgs = req ? _imgs(req) : [];
  const framesOnly = pair.agg === 'replicate' && (mode === 'i2v' || mode === 'fl');
  return String(prompt || '').replace(/\{\{\s*(image|video|audio)\s*:\s*(\d+)\s*\}\}/gi, (_, kind, n) => {
    if (framesOnly && kind.toLowerCase() === 'image') {
      const role = imgs[+n - 1] ? _role(imgs[+n - 1]) : '';
      return role === 'frame-last' ? 'the last frame' : role === 'frame-first' || mode === 'i2v' ? 'the first frame' : 'the picture';
    }
    const t = pair.token(kind.toLowerCase(), +n);
    if (t) return t;
    return kind.toLowerCase() === 'image' ? 'the picture' : kind.toLowerCase() === 'video' ? 'the clip' : 'the sound';
  }).replace(/[ \t]{2,}/g, ' ').trim();
}

// ── Choosing ────────────────────────────────────────────────────────────────
const pair = (model, agg) => PAIRS[model + '@' + agg] || null;
const label = (model) => (_model(model) || { label: model }).label;
// A key is what it takes. The health check's "down" only paints the chip (PLAN V-B): one slow probe would otherwise
// send every clip of the next half hour to the dearer aggregator - and a key that really is refused costs nothing
// to try (the create is refused, the ladder goes on).
const usable = (agg) => FAKE.on() || KEYS.keyed(agg);

/** The aggregator a model goes to when nobody chose: the cheapest, for THIS send, of those with a key. */
function defaultAgg(model, params, req) {
  const can = KEYS.AGGS.map(a => pair(model, a)).filter(p => p && usable(p.agg));
  if (!can.length) return '';
  const cost = (p) => {
    // A real send (`req`): a record that cannot take it is no choice. The matrix (no send yet) ranks by the table.
    if (req) { try { check(p, Object.assign({ prompt: 'xxx' }, req, { params: params || {} })); } catch (e) { return Infinity; } }
    const x = price(p, params || {}, req || {});
    return x.usd != null ? x.usd : x.perSec == null ? Infinity : x.perSec * 10;
  };
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
        limits: { images: p.limits.images, videos: p.limits.videos, audios: p.limits.audios, total: p.limits.total || 0,
                  videoSecs: p.limits.videoSecs || 0, image: p.limits.image,
                  // (phase V7) The page's trim window and checks: one clip's seconds, all the sounds', and Kling's clip
                  // when the character keeps the picture's orientation.
                  clipSecs: p.limits.clipSecs || null, audioSecs: p.limits.audioSecs || 0, videoSecsImage: p.limits.videoSecsImage || 0 },
        duration: p.duration, resolutions: p.resolutions, resDef: p.resDef, aspects: p.aspects,
        audio: p.audio || null, orientation: p.orientation || null, keepSound: !!p.keepSound, extra: p.extra || null,
        promptMax: p.promptMax, promptOptional: p.promptOptional,
        rates: _rates(p.key), priceNote: _expired(p.key) ? PRICE_UNTIL[p.key].words : '',
        tenSeconds: p.duration.fromClip ? price(p, { resolution: p.resDef }, { media: [{ kind: 'video', in: 0, out: 10 }] }) : price(p, { resolution: p.resDef, duration: 10 }, {}),
      }));
      const def = defaultAgg(m.id, {});
      return { id: m.id, label: m.label, brief: m.brief, family: m.family, langs: m.langs, speaks: m.speaks, wait: m.wait,
               defaultAgg: def, usable: !!def, why: def ? '' : noRoute(m.id), records: recs };
    }),
  };
}

module.exports = { MODELS, PAIRS, PRICES_ASOF, STANDARD_MC_PROMPT, pair, label, modeOf, price, check, render,
                   defaultAgg, ladder, noRoute, matrix, usable };
