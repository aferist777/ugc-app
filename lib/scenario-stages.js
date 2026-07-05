'use strict';

// ── Editable scenario-generation stage prompts + per-stage model overrides ──────
// UGC (single-presenter) scenario generation runs 4 stages / 6 LLM calls in
// routes/generate.js -> POST /dialogue/script. This module externalises those
// stage system-prompts as EDITABLE templates and lets each call pick its model.
//
// Templates use two markers so the editor can highlight them:
//   {{param}}          -> substituted at generation time from the Scenario column
//                         params (rendered blue in the editor).
//   [[lock]]...[[/lock]] -> structural text the pipeline relies on (JSON schema,
//                         line-count rules, injected data). The guards are STRIPPED
//                         at generation time; rendered amber in the editor.
//
// The DEFAULTS below reproduce the previous inline prompts VERBATIM (once the
// markers are stripped and params filled), so default generation is unchanged.
// These apply to UGC / solo only; the two-person dialogue path keeps its own
// inline prompts in routes/generate.js.

const fs   = require('fs');
const path = require('path');
const STORE = path.join(__dirname, '..', 'data', 'scenario-prompts.json');

// Default OpenRouter model per call slot (base = Gemini, recolor = Hermes).
const MODEL_DEFAULTS = {
  write:          'google/gemini-3.5-flash',
  recolor:        'nousresearch/hermes-4-405b',
  emotionClean:   'google/gemini-3.5-flash',
  emotionColored: 'nousresearch/hermes-4-405b',
  tagsClean:      'google/gemini-3.5-flash',
  tagsColored:    'nousresearch/hermes-4-405b',
};

// Stage metadata for the config popup (order = display order).
const STAGES = [
  { id: 'write',   label: '1 - Write (clean script)', models: [{ key: 'write',   label: 'Model' }] },
  { id: 'recolor', label: '2 - Recolor (taboo)',      models: [{ key: 'recolor', label: 'Model' }] },
  { id: 'emotion', label: '3 - Emotion analysis',     models: [{ key: 'emotionClean', label: 'Clean' }, { key: 'emotionColored', label: 'Colored' }] },
  { id: 'tags',    label: '4 - Voice-tag placement',  models: [{ key: 'tagsClean',    label: 'Clean' }, { key: 'tagsColored',    label: 'Colored' }] },
];

// Required {{data}} placeholders per stage — the editor warns if one is deleted.
const REQUIRED = {
  write:   [],
  recolor: ['cleanLines'],
  emotion: ['lines'],
  tags:    ['analysis', 'lines'],
};

const DEFAULTS = {
  write:
`You are a world-class direct-response UGC copywriter. Write a natural {{lineCount}}-line SINGLE-PERSON spoken monologue for a vertical short-form UGC ad, delivered straight to camera by ONE presenter, following the canon of high-converting UGC: 0-3s HOOK, agitate the pain, a unique mechanism/insight, concrete proof, handle the top objection, future-pace the win, clear payoff/CTA.
PRESENTER role: {{presenter}}. Speak true to this role AND gender (phrasing, references and perspective should fit the gender).
Topic/offer: {{topic}}.
{{productLine}}
Each line = one punchy spoken on-camera sentence, ONE idea, in delivery order.{{lineLength}} Keep this pass CLEAN and brand-safe. [[lock]]Plain spoken words only — do NOT add voice tags or stage directions.[[/lock]]
[[lock]]Return ONLY raw JSON: {"cast":[{"role":"host","name":"{{presenterName}}"}],"lines":[{"speaker":"host","text":"..."}]}. Exactly {{lineCount}} lines. No markdown, no commentary.[[/lock]]`,

  recolor:
`You are a savage short-form UGC copywriter doing an AGGRESSIVE recolor ("arbitrage"). Take the clean monologue below and RECOLOR it to taboo level "{{tabooLevel}}" for the "{{vertical}}" niche — {{tabooDef}}
[[lock]]Keep the SAME line count ({{lineCount}}), the SAME order, and the SAME selling beats;[[/lock]] one presenter ({{presenterName}}). Recolor ONLY wording/voice/energy — never change the order. [[lock]]Plain spoken words only, NO voice tags.[[/lock]]{{sourceBlock}}
[[lock]]Return ONLY raw JSON: {"lines":[{"speaker":"host","text":"..."},...]} with exactly {{lineCount}} lines in the same order. No markdown.[[/lock]]

[[lock]]CLEAN MONOLOGUE:
{{cleanLines}}[[/lock]]`,

  emotion:
`You are a voice-acting director. For the dialogue below, {{toneCtx}}. For EACH line, in ONE short phrase, describe the emotional delivery + any reactions that fit (e.g. an excited open, a hesitant beat, a dry laugh, a whisper for the secret). Keep it consistent with the tone across the whole script.
[[lock]]Return ONLY raw JSON: {"analysis":[{"i":0,"notes":"..."}, ...]} with one entry per line, in order. No markdown.[[/lock]]

[[lock]]DIALOGUE:
{{lines}}[[/lock]]`,

  tags:
`You are preparing dialogue for ElevenLabs v3 TTS. Insert inline audio tags in square brackets into each line to match its delivery notes and the overall tone ({{toneCtx}}). Put 1-3 tags on most lines, each immediately before the words it affects. [[lock]]Keep the spoken words EXACTLY the same — only ADD [tags]. Use ONLY these tags: {{tags}}.[[/lock]]
[[lock]]Return ONLY raw JSON: {"lines":[{"speaker":"host","text":"[tag] ..."},...]} with exactly {{lineCount}} lines in the same speaker order. No markdown.[[/lock]]

[[lock]]DELIVERY NOTES (per line):
{{analysis}}

DIALOGUE:
{{lines}}[[/lock]]`,
};

// ── Editable per-parameter data injected into the stage templates (UGC/solo only) ──
// generate.js feeds these into the {{param}} slots. Defaults reproduce the previous
// hardcoded constants verbatim; the two-person dialogue path keeps its own inline copies.
const PARAM_DATA_DEFAULTS = {
  source:     { wrapper: '\nSOURCE VOICE to mirror (mine its tone, slang and angles; do NOT copy verbatim):\n"""\n{{sourceText}}\n"""\n' },
  tone:       { withTone: 'the desired TONE is "{{tone}}"', noTone: 'infer the natural tone from the content' },
  taboo:      {
    mild:     'light edge: casual slang, mild cheek, a wink. Stay advertiser-safe.',
    spicy:    'bold and provocative: punchy slang, dark humor, hooks pushed hard. No slurs or hate.',
    explicit: 'maximum edge allowed for this niche: raw, crude, taboo-leaning provocation. Still no illegal content, no slurs/hate, no minors.',
    extreme:  'the most extreme edge this niche tolerates: shock-value hooks, savage crude honesty, the darkest humor and rawest provocation - go past explicit. Still no illegal content, no slurs/hate, no minors, no sexual content involving minors.',
  },
  lineLength: { wrapper: ' Each spoken line should be {{value}}.' },
  product:    {
    include:  'PRODUCT to sell: "{{product}}". Weave it in naturally as the solution; build desire and land a soft CTA toward it.',
    exclude:  'Do NOT mention any product or brand — pure value/story dialogue that builds curiosity.',
  },
  tags:       { list: '[happy] [excited] [cheerful] [playfully] [giggles] [chuckles] [laughs] [warmly] [sad] [crying] [sighs] [angry] [shouting] [nervous] [frustrated] [disappointed] [sarcastic] [mischievously] [seriously] [calmly] [confident] [hesitant] [curious] [flirtatious] [gasps] [exhales] [clears throat] [whispers] [snorts] [pauses] [groans] [yawns]' },
};

const PARAM_DESC_DEFAULTS = {
  topic:      'The offer / what the ad sells. Injected verbatim as the subject the script is built around.',
  vertical:   'The niche. Steers slang, angles and which source library the recolor mines.',
  source:     'A transcript/style reference the recolor mirrors (tone, slang, angles) without copying. Manage the source texts below.',
  tone:       'The delivery mood the emotion + tag stages aim for. "auto" lets the model infer it from the content.',
  taboo:      'How hard the recolor pushes. Each level below defines what that edge means for the niche.',
  lines:      'How many spoken fragments the script is split into.',
  lineLength: 'Roughly how long each spoken line should be.',
  presenter:  'The on-camera role + gender the monologue is written for.',
  product:    'Whether and how the product is woven into the script.',
};

// Param nav list for the popup. token = how the value reaches the prompt; fields = editable data.
const PARAMS = [
  { id: 'topic',      label: 'Topic / offer', token: '{{topic}}',       fields: [] },
  { id: 'vertical',   label: 'Vertical',      token: '{{vertical}}',    fields: [] },
  { id: 'source',     label: 'Source',        token: '{{sourceBlock}}', sourceMgr: true, fields: [{ key: 'wrapper', label: 'Source-block wrapper (uses {{sourceText}})', rows: 5 }] },
  { id: 'tone',       label: 'Tone',          token: '{{toneCtx}}',     fields: [{ key: 'withTone', label: 'When a tone is set (uses {{tone}})', rows: 2 }, { key: 'noTone', label: 'When tone = auto', rows: 2 }] },
  { id: 'taboo',      label: 'Taboo',         token: '{{tabooDef}}',    fields: [{ key: 'mild', label: 'mild', rows: 2 }, { key: 'spicy', label: 'spicy', rows: 2 }, { key: 'explicit', label: 'explicit', rows: 3 }, { key: 'extreme', label: 'extreme', rows: 3 }] },
  { id: 'lines',      label: 'Lines',         token: '{{lineCount}}',   fields: [] },
  { id: 'lineLength', label: 'Line length',   token: '{{lineLength}}',  fields: [{ key: 'wrapper', label: 'Wrapper (uses {{value}})', rows: 2 }] },
  { id: 'presenter',  label: 'Presenter',     token: '{{presenter}}',   fields: [] },
  { id: 'product',    label: 'Product',       token: '{{productLine}}', fields: [{ key: 'include', label: 'When product is included (uses {{product}})', rows: 3 }, { key: 'exclude', label: 'When no product', rows: 2 }] },
  { id: 'tags',       label: 'Voice tags',    token: '{{tags}}',        fields: [{ key: 'list', label: 'Allowed [tags]', rows: 4 }] },
];

function _load() { try { return JSON.parse(fs.readFileSync(STORE, 'utf8')); } catch { return {}; } }
function _save(o) { const d = path.dirname(STORE); if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(STORE, JSON.stringify(o, null, 2), 'utf8'); }

// The active template for a stage: the saved override, else the default.
function getTemplate(stage) {
  const o = _load();
  const t = o.templates && o.templates[stage];
  return (typeof t === 'string' && t.trim()) ? t : DEFAULTS[stage];
}

// Merged model map (defaults <- saved overrides).
function getModels() {
  const o = _load();
  return { ...MODEL_DEFAULTS, ...(o.models || {}) };
}

// Merged per-param data (defaults <- saved overrides). Used by generate.js (solo path).
function getParams() {
  const o = _load(); const saved = o.paramData || {};
  const out = {};
  for (const k of Object.keys(PARAM_DATA_DEFAULTS)) out[k] = { ...PARAM_DATA_DEFAULTS[k], ...(saved[k] || {}) };
  return out;
}
function getDescriptions() {
  const o = _load();
  return { ...PARAM_DESC_DEFAULTS, ...(o.descriptions || {}) };
}

// Fill {{param}} from vals (missing -> ''), then strip the [[lock]] guards.
function render(tpl, vals) {
  vals = vals || {};
  let s = String(tpl == null ? '' : tpl).replace(/\{\{(\w+)\}\}/g, (_, k) => (vals[k] != null ? String(vals[k]) : ''));
  return s.replace(/\[\[\/?lock\]\]/g, '');
}

// Snapshot for the config popup.
function getConfig() {
  const o = _load();
  const models = { ...MODEL_DEFAULTS, ...(o.models || {}) };
  return {
    modelDefaults: MODEL_DEFAULTS,
    models,
    stages: STAGES.map(s => ({
      id: s.id, label: s.label, models: s.models,
      template: getTemplate(s.id),
      defaultTemplate: DEFAULTS[s.id],
      required: REQUIRED[s.id] || [],
      isDefault: !(o.templates && typeof o.templates[s.id] === 'string' && o.templates[s.id].trim()),
    })),
    params: (() => {
      const P = getParams(), D = getDescriptions();
      return PARAMS.map(p => ({
        id: p.id, label: p.label, token: p.token, sourceMgr: !!p.sourceMgr,
        desc: D[p.id] || '', descIsDefault: !(o.descriptions && typeof o.descriptions[p.id] === 'string'),
        defaultDesc: PARAM_DESC_DEFAULTS[p.id] || '',
        dataIsDefault: !(o.paramData && o.paramData[p.id]),
        fields: (p.fields || []).map(f => ({ key: f.key, label: f.label, rows: f.rows || 2, value: (P[p.id] && P[p.id][f.key] != null) ? P[p.id][f.key] : '', default: (PARAM_DATA_DEFAULTS[p.id] && PARAM_DATA_DEFAULTS[p.id][f.key] != null) ? PARAM_DATA_DEFAULTS[p.id][f.key] : '' })),
      }));
    })(),
  };
}

// Persist a partial { models:{slot:id}, templates:{stage:text|null} } patch.
// A model equal to its default, or a template equal to (or emptying to) the
// default, is dropped so the store only holds genuine overrides.
function saveConfig(body) {
  const o = _load();
  body = body || {};
  if (body.models && typeof body.models === 'object') {
    const m = { ...(o.models || {}), ...body.models };
    for (const k of Object.keys(m)) {
      if (!MODEL_DEFAULTS.hasOwnProperty(k) || !m[k] || m[k] === MODEL_DEFAULTS[k]) delete m[k];
    }
    if (Object.keys(m).length) o.models = m; else delete o.models;
  }
  if (body.templates && typeof body.templates === 'object') {
    const t = { ...(o.templates || {}) };
    for (const k of Object.keys(body.templates)) {
      if (!DEFAULTS.hasOwnProperty(k)) continue;
      const v = body.templates[k];
      if (v == null || String(v).trim() === '' || String(v) === DEFAULTS[k]) delete t[k];
      else t[k] = String(v);
    }
    if (Object.keys(t).length) o.templates = t; else delete o.templates;
  }
  if (body.descriptions && typeof body.descriptions === 'object') {
    const d = { ...(o.descriptions || {}) };
    for (const k of Object.keys(body.descriptions)) {
      if (!PARAM_DESC_DEFAULTS.hasOwnProperty(k)) continue;
      const v = body.descriptions[k];
      if (v == null || String(v) === PARAM_DESC_DEFAULTS[k]) delete d[k]; else d[k] = String(v);
    }
    if (Object.keys(d).length) o.descriptions = d; else delete o.descriptions;
  }
  if (body.paramData && typeof body.paramData === 'object') {
    const pd = { ...(o.paramData || {}) };
    for (const k of Object.keys(body.paramData)) {
      if (!PARAM_DATA_DEFAULTS.hasOwnProperty(k)) continue;
      const merged = { ...(pd[k] || {}), ...(body.paramData[k] || {}) };
      for (const fk of Object.keys(merged)) { if (!PARAM_DATA_DEFAULTS[k].hasOwnProperty(fk) || merged[fk] === PARAM_DATA_DEFAULTS[k][fk]) delete merged[fk]; }
      if (Object.keys(merged).length) pd[k] = merged; else delete pd[k];
    }
    if (Object.keys(pd).length) o.paramData = pd; else delete o.paramData;
  }
  _save(o);
  return getConfig();
}

module.exports = { DEFAULTS, MODEL_DEFAULTS, STAGES, REQUIRED, PARAMS, PARAM_DATA_DEFAULTS, PARAM_DESC_DEFAULTS, getTemplate, getModels, getParams, getDescriptions, render, getConfig, saveConfig };
