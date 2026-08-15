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

const { createPVideoTask } = require('./helpers');

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
      id, label: e.label, dur: e.dur, params: e.params || [],
      providers: providers.map(p => ({ id: p, label: PROVIDER_LABELS[p] })),
    });
  }
  return out;
}

// Submit, with the duration clamped to what this engine really takes. Clamped rather than
// refused: the popper already limits its slider to the same bounds, so a value outside them
// is a stale form rather than a decision, and losing the press would be the worse answer.
async function submitVideo({ engine, provider, prompt, imageUrl, params = {} }) {
  const e = ENGINES[engine];
  if (!e) throw new Error('unknown video engine: ' + engine);
  const dir = 'i2v';
  const usable = providersFor(engine, dir);
  if (!usable.length) throw new Error(e.label + ' cannot do image-to-video');
  const p = usable.includes(provider) ? provider : usable[0];
  if (provider && p !== provider) {
    console.warn('[video-providers]', provider, 'has no', engine, dir, '- using', p);
  }
  const wanted = Math.round(Number(params.duration) || e.dur.def);
  const duration = Math.max(e.dur.min, Math.min(e.dur.max, wanted));

  const taskId = await e.providers[p].submit({
    prompt, imageUrl,
    // 9:16 unless the caller says otherwise: the timeline is vertical, and a 16:9 result
    // arrives letterboxed into the frame.
    params: { aspect_ratio: '9:16', ...params, duration },
  });
  if (!taskId) throw new Error(PROVIDER_LABELS[p] + ' returned no taskId');
  return { taskId: String(taskId), engine, provider: p, duration };
}

module.exports = { ENGINES, PROVIDER_LABELS, PROVIDER_ORDER, providersFor, listVideoEngines, submitVideo };
