'use strict';

// ════════════════════════════════════════════════════════════════════════════
// THE GENERATOR'S SETTINGS — tone and how many scenes.
//
// (phase V37, the owner 2026-10-23: "из формы сценариев выбор модели убираем. идем по лестнице") Until V37 this was the
// registry behind the generator's Provider / Model / Effort dropdowns (kie.ai, Replicate, Claude - phase F3, V25). The
// scripts are written by the agents' ladder now (lib/agents.js, lib/llm-json.js callLadder), so only the form's own
// settings are left here. A draft or a scenario from before keeps the model its form chose, as a record of what wrote it.
// ════════════════════════════════════════════════════════════════════════════

const DEFAULTS = {
  tone: 'Punchy',
  scenes: 15,
};

// The script step's free-choice list. Ported as-is: it is what the prompts were tuned against,
// and "Wry" asking for a different register than "Punchy" is the point. There is no language to
// choose (phase V29, the owner 2026-10-14): every script is written in English.
const TONES = ['Conversational', 'Documentary', 'Punchy', 'Calm', 'Provocative', 'Wry'];

// A short is no longer pinned to a minute, so the ceiling is generous - 30 scenes of
// narration is several minutes of speech.
const SCENES_MIN = 2;
const SCENES_MAX = 30;

// A request is only run with values the form knows: a tone not on the list is the default, scenes are clamped.
function normalise(opts = {}) {
  const tone = TONES.includes(opts.tone) ? opts.tone : DEFAULTS.tone;
  let scenes = parseInt(opts.scenes, 10);
  if (!Number.isFinite(scenes)) scenes = DEFAULTS.scenes;
  scenes = Math.max(SCENES_MIN, Math.min(SCENES_MAX, scenes));
  return { tone, scenes };
}

module.exports = { DEFAULTS, TONES, SCENES_MIN, SCENES_MAX, normalise };
