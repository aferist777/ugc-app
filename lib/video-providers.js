'use strict';

// ════════════════════════════════════════════════════════════════════════════
// THE VIDEO HALF OF THE PROVIDER MATRIX.
//
// lib/img-providers.js has done this for pictures since the day Replicate started answering
// ModelRateLimitError for one model while another aggregator served the same model happily:
// which ENGINE draws it and which AGGREGATOR is asked are two separate choices, because they
// fail separately. Video had no such table. Its engines were scattered - p-video and grok in
// helpers.js, kling avatar in routes/audio.js, veo3 and sora in routes/biroly.js - each with
// its own submit call, its own status endpoint and its own idea of what a duration is.
//
// Shape, deliberately the same as its sibling so the two read alike:
//
//   ENGINES[id].dur                 the engine's OWN length bounds, in seconds
//   ENGINES[id].providers[p]        how THAT aggregator is asked
//   listVideoEngines(dir)           the matrix, shaped for a picker
//   submitVideo({...})              -> { taskId, engine, provider }
//
// ONLY PAIRINGS THAT ARE ACTUALLY EXERCISED ARE LISTED. helpers.js also carries
// createGrokImagineVideoTask, which would put grok on Replicate - it is imported by
// routes/audio.js and called by nothing, and has been since it was written. An untried
// pairing is worse than an absent one, because it fails after the user has waited and paid;
// it goes in here the day it is run successfully, not before.
//
// Durations are the bounds each engine really has, and they differ: p-video takes 1 to 20,
// grok takes 6 to 30. A picker that offered one range for both would be building a request
// the model refuses.
// ════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const axios = require('axios');

const { createPVideoTask, createReplicateTask } = require('./helpers');

const KIE_BASE = 'https://api.kie.ai';

function _settings() {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'settings.json'), 'utf8')); }
  catch { return {}; }
}

// kie.ai: one job envelope for every model, and the taskId it returns is polled by the same
// recordInfo call the app has used since long before this file. Nothing downstream needs to
// know a kie task from a Replicate one - see the status route.
async function _kieCreate(model, input) {
  const key = (_settings().kieApiKey || '').trim();
  if (!key) throw new Error('kie.ai API key is not configured (Brain -> API keys)');
  const res = await axios.post(`${KIE_BASE}/api/v1/jobs/createTask`, { model, input }, {
    headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    timeout: 30000,
  });
  const taskId = res.data && res.data.data && res.data.data.taskId;
  if (!taskId) throw new Error('kie.ai returned no taskId: ' + JSON.stringify(res.data).slice(0, 200));
  console.log('[video-providers] kie', model, '->', taskId);
  return String(taskId);
}

// The parameter vocabulary each engine speaks, in the shape the popup renders from. Kept
// here rather than in the page for the same reason the submit is: one table, and a control
// the model does not have cannot be drawn.
const ENGINES = {
  'p-video': {
    label: 'p-video',
    i2v: true,
    dur: { min: 1, max: 20, def: 5 },
    params: [
      { key: 'resolution', label: 'resolution', type: 'select', options: ['480p', '720p', '1080p'], def: '720p' },
      { key: 'fps', label: 'fps', type: 'select', options: ['16', '24', '30'], def: '24' },
      { key: 'draft', label: 'draft', type: 'toggle', def: false,
        hint: 'faster and rougher - for trying a prompt out' },
      { key: 'prompt_upsampling', label: 'expand prompt', type: 'toggle', def: true,
        hint: 'the model rewrites the prompt richer before generating' },
    ],
    providers: {
      replicate: {
        model: 'prunaai/p-video', i2v: true,
        submit: ({ prompt, imageUrl, params }) => createPVideoTask(prompt, imageUrl, null, params),
      },
    },
  },

  'grok-imagine': {
    label: 'Grok Imagine',
    i2v: true,
    dur: { min: 6, max: 30, def: 6 },
    params: [
      { key: 'resolution', label: 'resolution', type: 'select', options: ['480p', '720p'], def: '480p' },
      { key: 'mode', label: 'mode', type: 'select', options: ['normal', 'fun', 'spicy'], def: 'normal',
        hint: 'normal - standard, fun - more movement, spicy - internal images only' },
    ],
    providers: {
      kie: {
        model: 'grok-imagine/image-to-video', i2v: true,
        submit: ({ prompt, imageUrl, params }) => _kieCreate('grok-imagine/image-to-video', {
          image_urls: [imageUrl],
          prompt: prompt || undefined,
          // kie wants these as strings; sending a number is a 400 that reads like a model error.
          duration: String(params.duration),
          resolution: params.resolution || '480p',
          aspect_ratio: params.aspect_ratio || '9:16',
          mode: params.mode || 'normal',
        }),
      },
    },
  },

  // ── Motion control ────────────────────────────────────────────────────────
  // A different shape of job: a picture AND a video, and the person in the picture performs
  // what the person in the video does. Both models take the same two inputs and neither has
  // a duration field - the result is exactly as long as the reference clip, which is why the
  // window shows a trimmer instead of a slider and prices by the second of what was trimmed.
  //
  // character_orientation is SENT EXPLICITLY, always 'video'. Replicate defaults it to
  // 'image', and that caps the result at 10 seconds; 'video' is what allows 30. A default
  // that quietly costs two thirds of the length is not one to inherit.
  //
  // The tier is spelt differently by each aggregator - Replicate takes std/pro, kie takes
  // 720p/1080p - which is exactly what the provider half of this table is for. The window
  // says 720 and 1080 either way.
  //
  // ONE UNRESOLVED THING, and it is kie's: its docs describe mode as "use 'std' for 720p or
  // 'pro' for 1080p" in prose while every example request and the stated value list say
  // 720p/1080p. Both pages agree with the examples, so that is what goes out; if a live
  // submit comes back complaining about mode, the fix is the tier map below and nothing else.
  'kling-3-motion': {
    label: 'Kling 3 \u00b7 motion control',
    i2v: true,
    needsVideo: true,
    promptOptional: true,
    // No dur: the length is the trimmed segment's. The bounds the models impose on that clip.
    clip: { min: 3, max: 30, maxMB: 100 },
    // Quality alone. background_source and keep_original_sound were here and are gone: both
    // already default to what this window would have asked for - the background comes from the
    // reference clip, its sound is kept - so each was a control whose only setting was the one
    // it already had. Their defaults still go out; nothing has been turned off.
    params: [
      { key: 'quality', label: 'quality', type: 'select', options: ['720p', '1080p'], def: '720p' },
    ],
    providers: {
      replicate: {
        model: 'kwaivgi/kling-v3-motion-control', i2v: true,
        price: { '720p': 0.07, '1080p': 0.12 },
        tier: { '720p': 'std', '1080p': 'pro' },
        submit: ({ prompt, imageUrl, videoUrl, params }) => createReplicateTask('kwaivgi/kling-v3-motion-control', {
          image: imageUrl,
          video: videoUrl,
          prompt: prompt || '',
          mode: params.quality === '1080p' ? 'pro' : 'std',
          character_orientation: 'video',
          keep_original_sound: params.keep_sound !== false,
        }),
      },
      kie: {
        model: 'kling-3.0/motion-control', i2v: true,
        price: { '720p': 0.10, '1080p': 0.135 },
        submit: ({ prompt, imageUrl, videoUrl, params }) => _kieCreate('kling-3.0/motion-control', {
          input_urls: [imageUrl],
          video_urls: [videoUrl],
          prompt: prompt || undefined,
          mode: params.quality === '1080p' ? '1080p' : '720p',
          character_orientation: 'video',
          background_source: params.background || 'input_video',
        }),
      },
    },
  },

  'kling-2.6-motion': {
    label: 'Kling 2.6 \u00b7 motion control',
    i2v: true,
    needsVideo: true,
    promptOptional: true,
    clip: { min: 3, max: 30, maxMB: 100 },
    // Same as 3.0 above: keep_original_sound is on by default and was a switch with one
    // position. Dropped here too rather than left on 2.6 alone, which would be a control that
    // appears and disappears between two models for no reason anyone could name.
    params: [
      { key: 'quality', label: 'quality', type: 'select', options: ['720p', '1080p'], def: '720p' },
    ],
    providers: {
      replicate: {
        model: 'kwaivgi/kling-v2.6-motion-control', i2v: true,
        price: { '720p': 0.07, '1080p': 0.12 },
        tier: { '720p': 'std', '1080p': 'pro' },
        submit: ({ prompt, imageUrl, videoUrl, params }) => createReplicateTask('kwaivgi/kling-v2.6-motion-control', {
          image: imageUrl,
          video: videoUrl,
          prompt: prompt || '',
          mode: params.quality === '1080p' ? 'pro' : 'std',
          character_orientation: 'video',
          keep_original_sound: params.keep_sound !== false,
        }),
      },
      kie: {
        // The cheaper of the two here, where 3.0 is cheaper on Replicate - so the price has
        // to belong to the PAIR, not to the model.
        model: 'kling-2.6/motion-control', i2v: true,
        price: { '720p': 0.055, '1080p': 0.09 },
        submit: ({ prompt, imageUrl, videoUrl, params }) => _kieCreate('kling-2.6/motion-control', {
          input_urls: [imageUrl],
          video_urls: [videoUrl],
          prompt: prompt || undefined,
          mode: params.quality === '1080p' ? '1080p' : '720p',
          character_orientation: 'video',
        }),
      },
    },
  },
};

const PROVIDER_LABELS = { replicate: 'Replicate', kie: 'kie.ai' };
const PROVIDER_ORDER = ['replicate', 'kie'];

// Which aggregators can serve this engine in this direction.
function providersFor(engineId, dir) {
  const e = ENGINES[engineId];
  if (!e) return [];
  return PROVIDER_ORDER.filter(p => e.providers[p] && e.providers[p][dir]);
}

// The matrix, shaped for the picker: one entry per engine that can do this direction, each
// carrying the aggregators that can actually do it, its length bounds and its parameters.
// Built from the same table that submits, so the UI cannot offer a pairing that fails.
function listVideoEngines(dir) {
  const out = [];
  for (const [id, e] of Object.entries(ENGINES)) {
    if (!e[dir]) continue;
    const providers = providersFor(id, dir);
    if (!providers.length) continue;
    out.push({
      id, label: e.label,
      // dur is absent on a motion-control model and that absence is the signal: there is no
      // length to choose, only a segment to cut.
      dur: e.dur || null,
      needsVideo: !!e.needsVideo,
      promptOptional: !!e.promptOptional,
      clip: e.clip || null,
      // Parameters an aggregator does not have are dropped rather than shown greyed: the
      // window would otherwise offer background_source on Replicate, which has no such field.
      params: (e.params || []).map(sp => ({ ...sp, only: sp.only || null })),
      providers: providers.map(p => ({
        id: p, label: PROVIDER_LABELS[p],
        price: e.providers[p].price || null,
      })),
    });
  }
  return out;
}

// Submit, with the duration clamped to what this engine really takes. Clamped rather than
// refused: the popper already limits its slider to the same bounds, so a value outside them
// is a stale form rather than a decision, and losing the press would be the worse answer.
async function submitVideo({ engine, provider, prompt, imageUrl, videoUrl, params = {} }) {
  const e = ENGINES[engine];
  if (!e) throw new Error('unknown video engine: ' + engine);
  const dir = 'i2v';
  const usable = providersFor(engine, dir);
  if (!usable.length) throw new Error(e.label + ' cannot do image-to-video');
  const p = usable.includes(provider) ? provider : usable[0];
  if (provider && p !== provider) {
    console.warn('[video-providers]', provider, 'has no', engine, dir, '- using', p);
  }
  if (e.needsVideo && !videoUrl) throw new Error(e.label + ' needs a reference video');
  if (!e.promptOptional && !prompt) throw new Error('a prompt is required');

  // A motion-control model has no duration to set - the result is as long as the clip it was
  // given - so there is nothing to clamp and nothing to send.
  let duration = null;
  if (e.dur) {
    const wanted = Math.round(Number(params.duration) || e.dur.def);
    duration = Math.max(e.dur.min, Math.min(e.dur.max, wanted));
  }

  const taskId = await e.providers[p].submit({
    prompt, imageUrl, videoUrl,
    // 9:16 unless the caller says otherwise: the timeline is vertical, and a 16:9 result
    // arrives letterboxed into the frame. Ignored by models that take a video's shape instead.
    params: duration == null ? { aspect_ratio: '9:16', ...params } : { aspect_ratio: '9:16', ...params, duration },
  });
  if (!taskId) throw new Error(PROVIDER_LABELS[p] + ' returned no taskId');
  return { taskId: String(taskId), engine, provider: p, duration };
}

module.exports = { ENGINES, PROVIDER_LABELS, PROVIDER_ORDER, providersFor, listVideoEngines, submitVideo };
