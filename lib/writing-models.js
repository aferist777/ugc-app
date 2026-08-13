'use strict';

// ════════════════════════════════════════════════════════════════════════════
// WRITING MODELS — the registry behind the Provider / Model / Effort dropdowns.
//
// Ported from an earlier project, where this exact set is what the script step ran on.
// The first model of a provider is its default, and google/gemini-3.5-flash is the
// default overall because it is what those scripts were written with.
//
// Only OpenRouter has a key in this app today (Brains -> OpenRouter API). The other two
// are listed because the registry is the registry; asking for one without its key gets a
// plain "no key" rather than a silent fallback to something else. A model quietly
// substituted is worse than a call that refuses: the text comes back in a voice you did
// not choose and nothing says so.
// ════════════════════════════════════════════════════════════════════════════

const REGISTRY = {
  openrouter: {
    label: 'OpenRouter',
    keyField: 'openRouterApiKey',
    base: 'https://openrouter.ai/api/v1',
    models: [
      'google/gemini-3.5-flash',
      'anthropic/claude-opus-5',
      'openai/gpt-5.5',
      'deepseek/deepseek-v4-pro',
      'nousresearch/hermes-4-405b',
    ],
  },
  anthropic: {
    label: 'Anthropic',
    keyField: 'anthropicApiKey',
    base: null,                    // the SDK path is not ported yet - see below
    models: ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5'],
  },
  openai: {
    label: 'OpenAI',
    keyField: 'openAiApiKey',
    base: 'https://api.openai.com/v1',
    models: ['gpt-5.5', 'gpt-5.4-mini'],
  },
};

// Anthropic speaks its own shape and an earlier project calls it through the official SDK, kept
// deliberately apart from the OpenAI-compatible path. Nothing here pretends otherwise: the
// provider is listed, and choosing it says the path is not wired rather than sending an
// Anthropic model down an OpenAI-shaped request that would fail obscurely.
const OPENAI_COMPATIBLE = new Set(['openrouter', 'openai']);

const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];

const DEFAULTS = {
  provider: 'openrouter',
  model: 'google/gemini-3.5-flash',
  effort: 'high',
  language: 'Russian',
  tone: 'Punchy',
  scenes: 15,
};

// The script step's two free-choice lists. Ported as-is: they are what the prompts were
// tuned against, and "Wry" asking for a different register than "Punchy" is the point.
const LANGUAGES = ['Russian', 'English', 'Spanish', 'German', 'French', 'Portuguese'];
const TONES = ['Conversational', 'Documentary', 'Punchy', 'Calm', 'Provocative', 'Wry'];

// A short is no longer pinned to a minute, so the ceiling is generous - 30 scenes of
// narration is several minutes of speech.
const SCENES_MIN = 2;
const SCENES_MAX = 30;

function providers() {
  return Object.entries(REGISTRY).map(([id, p]) => ({
    id, label: p.label, models: p.models, wired: OPENAI_COMPATIBLE.has(id),
  }));
}

function modelsFor(provider) {
  return (REGISTRY[provider] && REGISTRY[provider].models) || [];
}

// A request is only run with values the registry knows. Anything unknown falls back to the
// default rather than being passed through: an unknown model id reaches the provider as a
// 404 halfway through a five-stage chain, which is the worst place to find out.
function normalise(opts = {}) {
  const provider = REGISTRY[opts.provider] ? opts.provider : DEFAULTS.provider;
  const models = modelsFor(provider);
  const model = models.includes(opts.model) ? opts.model : models[0];
  const effort = EFFORTS.includes(opts.effort) ? opts.effort : DEFAULTS.effort;
  const language = LANGUAGES.includes(opts.language) ? opts.language : DEFAULTS.language;
  const tone = TONES.includes(opts.tone) ? opts.tone : DEFAULTS.tone;
  let scenes = parseInt(opts.scenes, 10);
  if (!Number.isFinite(scenes)) scenes = DEFAULTS.scenes;
  scenes = Math.max(SCENES_MIN, Math.min(SCENES_MAX, scenes));
  return { provider, model, effort, language, tone, scenes };
}

module.exports = {
  REGISTRY, EFFORTS, DEFAULTS, LANGUAGES, TONES,
  SCENES_MIN, SCENES_MAX, OPENAI_COMPATIBLE,
  providers, modelsFor, normalise,
};
