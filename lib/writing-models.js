'use strict';

// ════════════════════════════════════════════════════════════════════════════
// WRITING MODELS — the registry behind the generator's Provider / Model / Effort dropdowns.
//
// THE PROVIDERS ARE THE AGGREGATORS THIS APP ALREADY PAYS FOR (phase F3, the owner 2026-09-30):
// kie.ai and Replicate, with the models the app already uses for analysis elsewhere and has seen
// answer - the Merge analyst's and the Character vision ladder's. OpenRouter, Anthropic and OpenAI
// were listed here before; the owner's OpenRouter key stopped being accepted and the other two
// never had a key or a transport. Since phase V25 Anthropic is back: Claude directly, with the
// owner's own key (Admin -> API keys) and Anthropic's own package.
//
// EFFORT IS THE MODEL'S OWN (the owner asked where it applies at all). Each model lists the levels it
// accepts and the name it takes them under - there is no one scale that fits: kie's Gemini chat takes
// `reasoning_effort` low or high; Replicate's Gemini 3 takes `thinking_level` none/low/high;
// Replicate's Gemini 2.5 a token `thinking_budget`; Replicate's GPT `reasoning_effort` none to xhigh.
// The form offers only what the chosen model takes (read from the model ids' own schemas on
// Replicate, 2026-09-30, and kie's documentation).
//
// The first model of a provider is that provider's default; google/gemini-3.5-flash through
// Replicate is the default overall - the model the owner's scripts were first written with.
// ════════════════════════════════════════════════════════════════════════════

// `family` is how lib/llm-json.js calls the model: kie's OpenAI-shaped chat, or a Replicate
// prediction whose fields depend on who made the model.
const REGISTRY = {
  replicate: {
    label: 'Replicate',
    keyField: 'replicateApiKey',
    models: [
      { id: 'google/gemini-3.5-flash', label: 'Gemini 3.5 Flash', family: 'rep-gemini', efforts: ['none', 'low', 'high'], effort: 'high' },
      { id: 'google/gemini-3-flash', label: 'Gemini 3 Flash', family: 'rep-gemini', efforts: ['none', 'low', 'high'], effort: 'high' },
      { id: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash', family: 'rep-gemini-budget', efforts: ['none', 'low', 'medium', 'high'], effort: 'medium' },
      { id: 'openai/gpt-5.6-luna', label: 'GPT-5.6 Luna', family: 'rep-gpt', efforts: ['none', 'low', 'medium', 'high', 'xhigh'], effort: 'medium' },
    ],
  },
  kie: {
    label: 'kie.ai',
    keyField: 'kieApiKey',
    models: [
      { id: 'gemini-3-8-flash-openai', label: 'Gemini 3.8 Flash', family: 'kie-chat', efforts: ['low', 'high'], effort: 'high' },
      { id: 'gemini-3-7-flash-openai', label: 'Gemini 3.7 Flash', family: 'kie-chat', efforts: ['low', 'high'], effort: 'high' },
      { id: 'gemini-3-5-flash-openai', label: 'Gemini 3.5 Flash', family: 'kie-chat', efforts: ['low', 'high'], effort: 'high' },
    ],
  },
  // (phase V25, the owner 2026-10-13: "согласен" - Claude in the generator's list too, chosen in the form like any
  // model, never a fallback.) Anthropic's own API (lib/claude.js); the effort is Claude's own scale, each model's
  // default its own - medium for Opus and Haiku 5.5, high for Sonnet 5.5.
  anthropic: {
    label: 'Claude (Anthropic)',
    keyField: 'anthropicApiKey',
    models: [
      { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', family: 'claude', efforts: ['low', 'medium', 'high', 'xhigh', 'max'], effort: 'medium' },
      { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', family: 'claude', efforts: ['low', 'medium', 'high', 'xhigh', 'max'], effort: 'high' },
      { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', family: 'claude', efforts: ['low', 'medium', 'high', 'xhigh', 'max'], effort: 'medium' },
    ],
  },
};

// Gemini 2.5's effort is a budget of thinking tokens; the levels are these.
const THINKING_BUDGET = { none: 0, low: 1024, medium: 4096, high: 8192 };

const DEFAULTS = {
  provider: 'replicate',
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

/** Every provider with its models, for the page. `keyed` is told by the caller (it reads settings). */
function providers(keyed) {
  return Object.entries(REGISTRY).map(([id, p]) => ({
    id, label: p.label, keyed: keyed ? !!keyed(id) : true,
    models: p.models.map(m => ({ id: m.id, label: m.label, efforts: m.efforts.slice(), effort: m.effort })),
  }));
}

function modelsFor(provider) {
  return ((REGISTRY[provider] && REGISTRY[provider].models) || []).map(m => m.id);
}

function modelInfo(provider, model) {
  return ((REGISTRY[provider] && REGISTRY[provider].models) || []).find(m => m.id === model) || null;
}

// A request is only run with values the registry knows. An unknown provider (a draft written through
// OpenRouter) falls back to the default; an unknown model to the provider's first - or, when the same
// model id exists under the default provider, to that one; an effort the model does not take to the
// model's own default. An unknown id reaching an aggregator is a 404 halfway through a chain.
function normalise(opts = {}) {
  const provider = REGISTRY[opts.provider] ? opts.provider : DEFAULTS.provider;
  const ids = modelsFor(provider);
  const model = ids.includes(opts.model) ? opts.model : ids[0];
  const info = modelInfo(provider, model);
  const effort = info && info.efforts.includes(opts.effort) ? opts.effort : (info ? info.effort : '');
  const language = LANGUAGES.includes(opts.language) ? opts.language : DEFAULTS.language;
  const tone = TONES.includes(opts.tone) ? opts.tone : DEFAULTS.tone;
  let scenes = parseInt(opts.scenes, 10);
  if (!Number.isFinite(scenes)) scenes = DEFAULTS.scenes;
  scenes = Math.max(SCENES_MIN, Math.min(SCENES_MAX, scenes));
  return { provider, model, effort, language, tone, scenes, family: info ? info.family : '' };
}

module.exports = {
  REGISTRY, DEFAULTS, LANGUAGES, TONES, THINKING_BUDGET,
  SCENES_MIN, SCENES_MAX,
  providers, modelsFor, modelInfo, normalise,
};
