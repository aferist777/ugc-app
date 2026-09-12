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

const { createReplicateTask } = require('./helpers');

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
//
// TWO ENGINES, BOTH GROK, BOTH ON BOTH AGGREGATORS. Everything read off the source rather than
// remembered (2026-09-13): kie publishes its catalogue at /api/v1/models and prints each form
// on the model's own page, and Replicate answers with the input schema and the price.
//
//   kie   grok-imagine/image-to-video      480p 2.4 cr/s, 720p 4.5, 1080p 8  ($0.012 / $0.0225
//                                          / $0.04 a second). ONE picture - the form says so in
//                                          as many words - plus mode fun|normal|spicy, and
//                                          spicy is refused for an uploaded picture and quietly
//                                          becomes normal. SIX TO THIRTY SECONDS: the prose does
//                                          not say so, the form's own control does, and asking
//                                          for five is answered "Value must be within the
//                                          specified range" with no hint of which value.
//   kie   grok-imagine-video-1-5-preview   480p 2.4 cr/s, 720p 4.5; 1080p is on the form and
//                                          not in the price list, so it is priced as unknown
//                                          rather than as a guess. Up to 7 pictures; this
//                                          window sends the one being animated.
//   repl  xai/grok-imagine-video           $0.05 a second, flat. 480p or 720p, and no 1080p in
//                                          the schema at all.
//   repl  xai/grok-imagine-video-1.5       $0.08 a second, flat. 480p or 720p.
//
// Both 1.5 rows make their own audio, which is the reason to reach for them.
//
// PER-PROVIDER OPTIONS, because the resolutions genuinely differ: kie has 1080p and Replicate
// does not, and offering it on a Replicate row would be a 422 after the wait. `optionsBy` is
// how a parameter says that; the window reads it for whichever aggregator is chosen.
const ENGINES = {
  'grok-imagine-video': {
    label: 'Grok Imagine Video',
    i2v: true,
    // THE LENGTH IS THE AGGREGATOR'S BUSINESS, not the engine's, and here they genuinely
    // disagree: kie's form takes 6 to 30 seconds, Replicate's schema 1 to 15. `dur` is what an
    // aggregator with nothing of its own inherits; durBy is read first.
    dur: { min: 6, max: 30, def: 6 },
    durBy: { replicate: { min: 1, max: 15, def: 5 } },
    params: [
      { key: 'resolution', label: 'resolution', type: 'select',
        options: ['480p', '720p'], optionsBy: { kie: ['480p', '720p', '1080p'] }, def: '480p' },
      { key: 'mode', label: 'mode', type: 'select', options: ['normal', 'fun', 'spicy'], def: 'normal',
        only: ['kie'],
        hint: 'normal - standard, fun - more movement, spicy - only for pictures made at kie' },
    ],
    providers: {
      kie: {
        model: 'grok-imagine/image-to-video', i2v: true,
        price: { '480p': 0.012, '720p': 0.0225, '1080p': 0.04 },
        submit: ({ prompt, imageUrl, params }) => _kieCreate('grok-imagine/image-to-video', {
          image_urls: [imageUrl],
          prompt: prompt || undefined,
          // kie wants these as strings; sending a number is a 400 that reads like a model error.
          duration: String(params.duration),
          resolution: params.resolution || '480p',
          aspect_ratio: params.aspect_ratio || '9:16',
          mode: params.mode || 'normal',
          nsfw_checker: false,
        }),
      },
      replicate: {
        model: 'xai/grok-imagine-video', i2v: true,
        // Per second of OUTPUT, whatever the resolution - so both tiers carry the same rate
        // rather than one of them being left null and read as unknown.
        price: { '480p': 0.05, '720p': 0.05 },
        submit: ({ prompt, imageUrl, params }) => createReplicateTask('xai/grok-imagine-video', {
          image: imageUrl,
          prompt: prompt || undefined,
          duration: params.duration,
          resolution: params.resolution === '1080p' ? '720p' : (params.resolution || '480p'),
          aspect_ratio: params.aspect_ratio || '9:16',
        }),
      },
    },
  },

  'grok-imagine-video-1.5': {
    label: 'Grok Imagine Video 1.5',
    i2v: true,
    // One to fifteen on both sides of this one; eight is kie's own default, five is Replicate's.
    dur: { min: 1, max: 15, def: 8 },
    durBy: { replicate: { min: 1, max: 15, def: 5 } },
    params: [
      { key: 'resolution', label: 'resolution', type: 'select',
        options: ['480p', '720p'], optionsBy: { kie: ['480p', '720p', '1080p'] }, def: '480p' },
    ],
    providers: {
      kie: {
        model: 'grok-imagine-video-1-5-preview', i2v: true,
        // 1080p is on their form and absent from their price list. null is "nobody has
        // published one", which the window says out loud instead of inventing a number.
        price: { '480p': 0.012, '720p': 0.0225, '1080p': null },
        submit: ({ prompt, imageUrl, params }) => _kieCreate('grok-imagine-video-1-5-preview', {
          image_urls: [imageUrl],
          prompt: prompt || undefined,
          duration: String(params.duration),
          resolution: params.resolution || '480p',
          aspect_ratio: params.aspect_ratio || '9:16',
          nsfw_checker: false,
        }),
      },
      replicate: {
        model: 'xai/grok-imagine-video-1.5', i2v: true,
        price: { '480p': 0.08, '720p': 0.08 },
        submit: ({ prompt, imageUrl, params }) => createReplicateTask('xai/grok-imagine-video-1.5', {
          image: imageUrl,
          prompt: prompt || undefined,
          duration: params.duration,
          resolution: params.resolution === '1080p' ? '720p' : (params.resolution || '480p'),
          aspect_ratio: params.aspect_ratio || '9:16',
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
      // length to choose, only a segment to cut. durBy overrides it for the aggregators that
      // take a different range - the window reads the one it is pointed at.
      dur: e.dur || null,
      durBy: e.durBy || null,
      needsVideo: !!e.needsVideo,
      promptOptional: !!e.promptOptional,
      clip: e.clip || null,
      // Parameters an aggregator does not have are dropped rather than shown greyed, and a
      // parameter whose CHOICES differ between them carries both lists: kie has a 1080p the
      // Replicate rows have never heard of, and offering it there would be a 422 after the wait.
      params: (e.params || []).map(sp => ({ ...sp, only: sp.only || null, optionsBy: sp.optionsBy || null })),
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
    const bounds = (e.durBy && e.durBy[p]) || e.dur;
    const wanted = Math.round(Number(params.duration) || bounds.def);
    duration = Math.max(bounds.min, Math.min(bounds.max, wanted));
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
