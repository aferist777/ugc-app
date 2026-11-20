'use strict';

// ════════════════════════════════════════════════════════════════════════════
// WHAT A TALKING HEAD IS FILMED WITH - one clip per line either way: the line's frame speaks its read.
//
//   kling avatar     kie.ai's Kling AI Avatar, two tiers (lib/motion-presets.js VIDEO_QUALITIES)
//   omnihuman 2.0    kie.ai's OmniHuman 2.0, one tier - 720p
//
// The model is the PROJECT's (routes/scen3.js _normVideo). Both are asked the same way on kie.ai - jobs/createTask,
// then jobs/recordInfo - and this file is the ONE place their inputs are named (input) and their limits written, as
// lib/video-models.js is for the chats.
//
// OMNIHUMAN'S SOUND is taken from 4 s to 300 s, and the clip it makes is as long as that sound rounded UP to a whole
// second (a 4.28 s read comes back 5.02 s long, billed 5 s). A read shorter than 4 s is padded with silence to 4 s
// (padTo); every OmniHuman clip is cut back to its read when it is filed (cutTo). Its prompt is at most 300 characters (lib/omni-prompt.js fit), its watermark always off.
// ════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const { execFile } = require('child_process');
const MP = require('./motion-presets');
// The interface's words (lib/i18n.js): `about` and the refusals are said to a person; the labels are the models' names.
const I18N = require('./i18n');

const MODELS = [
  { id: 'kling', label: 'kling avatar',
    about: 'One clip per line: the line’s frame speaks its read, lipsynced to it.' },
  { id: 'omnihuman', label: 'omnihuman 2.0',
    about: 'One clip per line: the frame speaks its read, the face, the head, the hands and the body moving with it. 720p; a read under 4 s is billed as 4 s.' },
];

const byId = (id) => MODELS.find(m => m.id === id) || null;

// OmniHuman 2.0 on kie.ai: 14 credits ($0.07) a second of the clip it makes. How kie rounds the seconds is not known,
// so the price said beforehand counts whole seconds rounded UP - the most it can be.
const OMNI = {
  model: 'omnihuman-2-0',
  minSecs: 4, maxSecs: 300,                       // the sound it takes
  audioMB: 15, imageMB: 30,                       // the files it takes
  minPx: 300, maxPx: 6000, minAspect: 0.4, maxAspect: 2.5,   // the picture it takes: each side, width / height
};
const OMNI_QUALITIES = [
  { id: '720p', label: '720p', model: OMNI.model, pricePerSec: 0.07, minAudioSec: OMNI.minSecs, maxAudioSec: OMNI.maxSecs, bill: 'up' },
];
// Kling avatar bills the whole seconds of the read rounded DOWN (a read of 7.97 s is billed 7 s), one at least.
const KLING_QUALITIES = MP.VIDEO_QUALITIES.map(q => ({ ...q, minAudioSec: 0, bill: 'down' }));

/** The qualities a model is made in, each with what a second of it costs, the shortest and longest read it takes and
 *  how its seconds are billed (`bill`: 'down' / 'up'). */
function qualities(id) {
  if (id === 'kling') return KLING_QUALITIES;
  if (id === 'omnihuman') return OMNI_QUALITIES;
  return [];
}
const qualityOf = (id, q) => qualities(id).find(x => x.id === q) || null;

// What the menus offer, for GET /scen3/motion-presets.
const models = () => MODELS.map(m => ({ ...m, about: I18N.t(m.about), qualities: qualities(m.id) }));

/** The seconds a read of `dur` is billed for by this model. */
function billSecs(id, dur) {
  const d = +dur || 0;
  if (id === 'omnihuman') return Math.ceil(Math.max(OMNI.minSecs, d) - 0.001);
  return Math.max(1, Math.floor(d + 0.001));
}

/** The length the read is padded to before it is sent - 0 when it goes as it is. */
const padSecs = (id, dur) => (id === 'omnihuman' && (+dur || 0) < OMNI.minSecs ? OMNI.minSecs : 0);

/**
 * WHAT KIE IS SENT for one line: the hosted frame, the hosted read and the prompt, in the model's own field names.
 * OmniHuman's watermark is off whatever the settings say.
 */
function input(id, o) {
  const s = o || {};
  if (id === 'omnihuman') {
    return { image_urls: [String(s.image || '')], audio_url: String(s.audio || ''),
      prompt: require('./omni-prompt').fit(s.prompt), enable_watermark: false };
  }
  return { image_url: String(s.image || ''), audio_url: String(s.audio || ''), prompt: String(s.prompt || '') };
}

/** Why the frame cannot go to this model, in words - '' when it can. `m`: { width, height, bytes }. */
function frameRefusal(id, m) {
  if (id !== 'omnihuman') return '';
  const w = +((m || {}).width) || 0;
  const h = +((m || {}).height) || 0;
  if (!w || !h) return I18N.t('the frame could not be read');
  if (Math.min(w, h) < OMNI.minPx || Math.max(w, h) > OMNI.maxPx) {
    return I18N.t('the frame is {w}×{h} px - OmniHuman takes {min} to {max} px a side', { w, h, min: OMNI.minPx, max: OMNI.maxPx });
  }
  const a = w / h;
  if (a < OMNI.minAspect || a > OMNI.maxAspect) return I18N.t('the frame is too narrow or too wide for OmniHuman ({w}×{h})', { w, h });
  if ((+((m || {}).bytes) || 0) > OMNI.imageMB * 1024 * 1024) return I18N.t('the frame is over {mb} MB - OmniHuman takes less', { mb: OMNI.imageMB });
  return '';
}
/** Why the read cannot go to this model, in words - '' when it can. `bytes` of the file that is sent. */
function readRefusal(id, bytes) {
  if (id !== 'omnihuman') return '';
  return (+bytes || 0) > OMNI.audioMB * 1024 * 1024 ? I18N.t('the read is over {mb} MB - OmniHuman takes less', { mb: OMNI.audioMB }) : '';
}

// ── the read padded, the clip cut back ──────────────────────────────────────
function _ffmpeg(args) {
  return new Promise((resolve, reject) => {
    execFile(require('ffmpeg-static'), ['-hide_banner', '-loglevel', 'error', '-y', ...args],
      { timeout: 180000, windowsHide: true },
      (err, _out, errText) => (err ? reject(new Error(String(errText || err.message).trim().slice(0, 300))) : resolve()));
  });
}

/** The read `src` with silence after it up to `secs`, written to `dst` as WAV (exact to the sample). */
async function padTo(src, dst, secs) {
  await _ffmpeg(['-i', src, '-af', 'apad=whole_dur=' + (+secs).toFixed(3), '-c:a', 'pcm_s16le', dst]);
  return dst;
}

/**
 * The clip at `abs` cut to its first `secs` - frame accurate - and made playable in the browser in the same pass
 * (H.264 main, yuv420p, AAC, faststart - the settings of lib/helpers.js normalizeVideoForBrowser), in place.
 */
async function cutTo(abs, secs) {
  const tmp = abs + '.cut.mp4';
  try {
    await _ffmpeg(['-i', abs, '-t', (+secs).toFixed(3),
      '-c:v', 'libx264', '-profile:v', 'main', '-level', '4.0', '-pix_fmt', 'yuv420p', '-crf', '19', '-preset', 'veryfast',
      '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-movflags', '+faststart', tmp]);
  } catch (e) {
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch (e2) { /* nothing to tidy */ }
    throw e;
  }
  fs.renameSync(tmp, abs);
  return abs;
}

module.exports = { MODELS, byId, OMNI, qualities, qualityOf, models, billSecs, padSecs, input, frameRefusal, readRefusal, padTo, cutTo };
